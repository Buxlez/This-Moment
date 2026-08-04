const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  buildVolcengineHeaders,
  cachePath,
  isVolcengineConfigured,
  synthesize,
  validateVolcengineEndpoint,
} = require('../tts');

const VOLCENGINE_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

const VOLCENGINE_ENV_NAMES = [
  'VOLCENGINE_TTS_API_KEY',
  'VOLCENGINE_TTS_APP_ID',
  'VOLCENGINE_TTS_ACCESS_TOKEN',
  'VOLCENGINE_TTS_RESOURCE_ID',
  'VOLCENGINE_TTS_VOICE_TYPE',
  'VOLCENGINE_TTS_ENDPOINT',
  'VOLCENGINE_TTS_REQUEST_ID',
  'VOLCENGINE_TTS_ADDITIONS',
  'VOLCENGINE_TTS_FORMAT',
  'VOLCENGINE_TTS_SAMPLE_RATE',
  'VOLCENGINE_TTS_TIMEOUT_MS',
  'VOLCENGINE_TTS_MAX_FRAME_BYTES',
];

async function withoutVolcengineEnv(run) {
  const previous = Object.fromEntries(
    VOLCENGINE_ENV_NAMES.map(name => [name, process.env[name]])
  );

  for (const name of VOLCENGINE_ENV_NAMES) delete process.env[name];

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withTemporaryCache(run) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-cache-test-'));

  try {
    return await run(cacheDir);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
}

function streamingResponse(lines, boundaries = [1, 5, 11, 19, 37, 61]) {
  const body = Buffer.from(`${lines.join('\n')}\n`);
  const chunks = [];
  let offset = 0;

  for (const boundary of boundaries) {
    const nextOffset = Math.min(boundary, body.length);
    if (nextOffset > offset) chunks.push(body.subarray(offset, nextOffset));
    offset = nextOffset;
  }
  if (offset < body.length) chunks.push(body.subarray(offset));

  return {
    ok: true,
    status: 200,
    body: Readable.from(chunks),
  };
}

function webStreamingResponse(text, boundaries = [1, 4, 9, 17, 31, 53]) {
  const body = new TextEncoder().encode(text);
  const chunks = [];
  let offset = 0;

  for (const boundary of boundaries) {
    const nextOffset = Math.min(boundary, body.length);
    if (nextOffset > offset) chunks.push(body.slice(offset, nextOffset));
    offset = nextOffset;
  }
  if (offset < body.length) chunks.push(body.slice(offset));

  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status: 200 });
}

function audioEvent(fragment, extra = {}) {
  return JSON.stringify({
    code: 0,
    data: Buffer.from(fragment).toString('base64'),
    ...extra,
  });
}

function completionEvent(extra = {}) {
  return JSON.stringify({ code: 20000000, ...extra });
}

function volcengineOptions(cacheDir, fetchImpl) {
  return {
    provider: 'volcengine',
    cacheDir,
    fetchImpl,
    apiKey: 'test-api-key',
    resourceId: 'test-resource-id',
    requestId: 'test-request-id',
    voiceType: 'test-voice',
  };
}

test('buildVolcengineHeaders uses legacy app ID and access token without a secret key', async () => {
  await withoutVolcengineEnv(() => {
    const headers = buildVolcengineHeaders({
      appId: 'legacy-app-id',
      accessToken: 'legacy-access-token',
      resourceId: 'resource-id',
      requestId: 'request-id',
      secretKey: 'must-never-be-used',
    });

    assert.equal(headers['X-Api-App-Id'], 'legacy-app-id');
    assert.equal(headers['X-Api-Access-Key'], 'legacy-access-token');
    assert.equal(headers['X-Api-Resource-Id'], 'resource-id');
    assert.equal(headers['X-Api-Request-Id'], 'request-id');
    assert.equal(headers['X-Api-Key'], undefined);
    assert.equal(JSON.stringify(headers).includes('must-never-be-used'), false);
    assert.equal(Object.keys(headers).some(key => /secret/i.test(key)), false);
  });
});

test('buildVolcengineHeaders gives API key auth precedence over legacy credentials', async () => {
  await withoutVolcengineEnv(() => {
    const headers = buildVolcengineHeaders({
      apiKey: 'new-api-key',
      appId: 'legacy-app-id',
      accessToken: 'legacy-access-token',
      resourceId: 'resource-id',
      requestId: 'request-id',
    });

    assert.equal(headers['X-Api-Key'], 'new-api-key');
    assert.equal(headers['X-Api-App-Id'], undefined);
    assert.equal(headers['X-Api-Access-Key'], undefined);
  });
});

test('buildVolcengineHeaders generates a fresh request ID unless one is explicit', async () => {
  await withoutVolcengineEnv(() => {
    process.env.VOLCENGINE_TTS_REQUEST_ID = 'ambient-request-id';
    const options = { apiKey: 'api-key', resourceId: 'resource-id' };
    const first = buildVolcengineHeaders(options)['X-Api-Request-Id'];
    const second = buildVolcengineHeaders(options)['X-Api-Request-Id'];
    const explicit = buildVolcengineHeaders({
      ...options,
      requestId: 'explicit-request-id',
    })['X-Api-Request-Id'];

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
    assert.equal(explicit, 'explicit-request-id');
  });
});

test('incomplete legacy authentication is unconfigured and rejects before fetch', async () => {
  await withoutVolcengineEnv(async () => {
    let fetchCalled = false;
    const options = {
      provider: 'volcengine',
      appId: 'legacy-app-id',
      resourceId: 'resource-id',
      voiceType: 'voice-type',
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('fetch should not be called');
      },
    };

    assert.equal(isVolcengineConfigured(options), false);
    await assert.rejects(
      synthesize(`incomplete-legacy-auth-${Date.now()}`, options),
      /VOLCENGINE|credentials|authentication/i
    );
    assert.equal(fetchCalled, false);
  });
});

test('validateVolcengineEndpoint accepts only the official HTTPS TTS endpoint', async () => {
  await withoutVolcengineEnv(() => {
    assert.equal(
      validateVolcengineEndpoint('https://openspeech.bytedance.com/api/v3/tts/unidirectional'),
      true
    );

    const rejectedEndpoints = [
      'http://openspeech.bytedance.com/api/v3/tts/unidirectional',
      'https://example.com/api/v3/tts/unidirectional',
      'https://openspeech.bytedance.com:8443/api/v3/tts/unidirectional',
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional?debug=1',
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional#fragment',
      'https://user@openspeech.bytedance.com/api/v3/tts/unidirectional',
      'not a url',
    ];

    for (const endpoint of rejectedEndpoints) {
      assert.throws(
        () => validateVolcengineEndpoint(endpoint),
        /official HTTPS endpoint/,
        endpoint
      );
    }
  });
});

test('synthesize assembles Volcengine NDJSON audio split across arbitrary stream chunks', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const fragments = ['ID3-', 'one-', 'two'];
    let request;
    const fetchImpl = async (endpoint, options) => {
      request = { endpoint, options };
      return streamingResponse([
        JSON.stringify({ code: 0, message: 'started' }),
        ...fragments.map(fragment => audioEvent(fragment)),
        completionEvent({ message: 'finished' }),
      ]);
    };

    const output = await synthesize('streamed response', volcengineOptions(cacheDir, fetchImpl));

    assert.equal(path.dirname(output), cacheDir);
    assert.deepEqual(fs.readFileSync(output), Buffer.from('ID3-one-two'));
    assert.equal(request.endpoint, VOLCENGINE_ENDPOINT);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers['X-Api-Key'], 'test-api-key');
    assert.equal(request.options.headers['X-Api-Resource-Id'], 'test-resource-id');
    assert.equal(request.options.headers['X-Api-Request-Id'], 'test-request-id');
    assert.equal(request.options.headers['X-Api-App-Id'], undefined);
    assert.deepEqual(JSON.parse(request.options.body), {
      req_params: {
        text: 'streamed response',
        speaker: 'test-voice',
        additions: JSON.stringify({
          disable_markdown_filter: true,
          enable_language_detector: true,
          enable_latex_tn: true,
          disable_default_bit_rate: true,
          max_length_to_filter_parenthesis: 0,
          cache_config: {
            text_type: 1,
            use_cache: true,
          },
        }),
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
        },
      },
    });
  }));
});

test('concurrent synthesis for one cache key shares a single Volcengine request', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return streamingResponse([
        audioEvent('ID3-shared'),
        completionEvent(),
      ]);
    };
    const options = volcengineOptions(cacheDir, fetchImpl);

    const [first, second] = await Promise.all([
      synthesize('shared request', options),
      synthesize('shared request', options),
    ]);

    assert.equal(fetchCalls, 1);
    assert.equal(first, second);
    assert.deepEqual(fs.readFileSync(first), Buffer.from('ID3-shared'));
  }));
});

test('failed synthesis removes unusable cache state and permits a clean retry', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return streamingResponse([
          completionEvent({ message: 'finished without audio' }),
        ]);
      }
      return streamingResponse([
        audioEvent('ID3-retry'),
        completionEvent(),
      ]);
    };
    const options = volcengineOptions(cacheDir, fetchImpl);
    const target = cachePath('retry after failure', 'volcengine', options);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.alloc(0));

    await assert.rejects(
      synthesize('retry after failure', options),
      /no audio|empty|usable/i
    );
    assert.equal(fs.existsSync(target), false);

    const output = await synthesize('retry after failure', options);
    assert.equal(fetchCalls, 2);
    assert.equal(output, target);
    assert.deepEqual(fs.readFileSync(output), Buffer.from('ID3-retry'));
  }));
});

test('synthesize parses adjacent JSON frames from a WHATWG response across byte chunks', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const frames = [
      JSON.stringify({ code: 0, message: 'braces { } and quote " plus slash \\ stay inside' }),
      audioEvent('ID3-adjacent-'),
      audioEvent('frames'),
      completionEvent({ message: 'done' }),
    ];
    const fetchImpl = async () => webStreamingResponse(` \n${frames.join('')} \t`);

    const output = await synthesize(
      'adjacent response frames',
      volcengineOptions(cacheDir, fetchImpl)
    );

    assert.deepEqual(fs.readFileSync(output), Buffer.from('ID3-adjacent-frames'));
  }));
});

test('audio followed by clean EOF without completion is not published', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const options = volcengineOptions(
      cacheDir,
      async () => streamingResponse([audioEvent('ID3-incomplete')])
    );
    const target = cachePath('missing completion', 'volcengine', options);

    await assert.rejects(
      synthesize('missing completion', options),
      /completion|terminal/i
    );

    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  }));
});

test('cache identity includes canonical MP3 output settings', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const base = volcengineOptions(cacheDir, async () => { throw new Error('unused'); });
    const first = cachePath('identity', 'volcengine', {
      ...base,
      additions: JSON.stringify({ beta: 2, alpha: 1 }),
    });
    const equivalent = cachePath('identity', 'volcengine', {
      ...base,
      additions: JSON.stringify({ alpha: 1, beta: 2 }),
    });
    const differentRate = cachePath('identity', 'volcengine', {
      ...base,
      sampleRate: 48000,
      additions: JSON.stringify({ alpha: 1, beta: 2 }),
    });
    const differentResource = cachePath('identity', 'volcengine', {
      ...base,
      resourceId: 'another-resource',
      additions: JSON.stringify({ alpha: 1, beta: 2 }),
    });
    assert.equal(first, equivalent);
    assert.notEqual(first, differentRate);
    assert.notEqual(first, differentResource);
    assert.equal(path.extname(first), '.mp3');
  }));
});

test('non-MP3 format or encoding rejects before fetch without creating cache files', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls++;
      return streamingResponse([audioEvent('unexpected'), completionEvent()]);
    };

    await assert.rejects(
      synthesize('wav format', {
        ...volcengineOptions(cacheDir, fetchImpl),
        format: 'wav',
      }),
      /MP3/i
    );
    await assert.rejects(
      synthesize('wav encoding', {
        ...volcengineOptions(cacheDir, fetchImpl),
        encoding: 'wav',
      }),
      /MP3/i
    );

    assert.equal(fetchCalls, 0);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  }));
});

test('concurrent requests with different sample rates use separate synthesis work', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let fetchCalls = 0;
    const fetchImpl = async (_endpoint, request) => {
      fetchCalls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      const sampleRate = JSON.parse(request.body).req_params.audio_params.sample_rate;
      return streamingResponse([
        audioEvent(`ID3-${sampleRate}`),
        completionEvent(),
      ]);
    };

    const [lowRate, highRate] = await Promise.all([
      synthesize('rate-specific', {
        ...volcengineOptions(cacheDir, fetchImpl),
        sampleRate: 24000,
      }),
      synthesize('rate-specific', {
        ...volcengineOptions(cacheDir, fetchImpl),
        sampleRate: 48000,
      }),
    ]);

    assert.equal(fetchCalls, 2);
    assert.notEqual(lowRate, highRate);
    assert.deepEqual(fs.readFileSync(lowRate), Buffer.from('ID3-24000'));
    assert.deepEqual(fs.readFileSync(highRate), Buffer.from('ID3-48000'));
  }));
});

test('failed synthesis removes only its temp file and preserves a concurrently published cache', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let observedPartialTemp = false;
    let target;
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      body: Readable.from((async function* () {
        yield Buffer.from(audioEvent('ID3-partial'));
        await new Promise(resolve => setImmediate(resolve));
        observedPartialTemp = fs.readdirSync(cacheDir).some(name =>
          name.startsWith(`${path.basename(target)}.`) && name.endsWith('.tmp')
        );
        fs.writeFileSync(target, Buffer.from('ID3-concurrent-winner'));
        throw new Error('stream failed after partial audio');
      })()),
    });
    const options = volcengineOptions(cacheDir, fetchImpl);
    target = cachePath('atomic failure', 'volcengine', options);

    await assert.rejects(synthesize('atomic failure', options), /stream failed/i);

    assert.equal(observedPartialTemp, true);
    assert.deepEqual(fs.readFileSync(target), Buffer.from('ID3-concurrent-winner'));
    assert.deepEqual(
      fs.readdirSync(cacheDir).filter(name => name.endsWith('.tmp')),
      []
    );
  }));
});

test('HTTP error response detail is bounded while the response body is read', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let cancelled = false;
    let emitted = false;
    const body = new ReadableStream({
      pull(controller) {
        if (!emitted) {
          emitted = true;
          controller.enqueue(new TextEncoder().encode('x'.repeat(5000)));
          return;
        }
        controller.enqueue(new TextEncoder().encode('must-not-be-read'));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = async () => new Response(body, { status: 500 });
    let failure;

    try {
      await synthesize('bounded error body', volcengineOptions(cacheDir, fetchImpl));
    } catch (error) {
      failure = error;
    }

    assert.ok(failure);
    assert.match(failure.message, /Volcengine TTS error 500/);
    assert.ok(failure.message.length <= 2040, failure.message.length);
    assert.equal(cancelled, true);
  }));
});

test('request timeout clears in-flight state so the same cache key can retry', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
        return streamingResponse([audioEvent('too-late'), completionEvent()]);
      }
      return streamingResponse([audioEvent('ID3-after-timeout'), completionEvent()]);
    };
    const options = {
      ...volcengineOptions(cacheDir, fetchImpl),
      timeoutMs: 5,
    };
    let firstFailure;

    try {
      await synthesize('timeout retry', options);
    } catch (error) {
      firstFailure = error;
    }
    options.timeoutMs = 100;
    const output = await synthesize('timeout retry', options);

    assert.ok(firstFailure);
    assert.match(firstFailure.message, /timed out/i);
    assert.equal(fetchCalls, 2);
    assert.deepEqual(fs.readFileSync(output), Buffer.from('ID3-after-timeout'));
  }));
});

test('oversized JSON frame fails at the configured limit without publishing files', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const oversizedFrame = `{"code":0,"message":"${'x'.repeat(100)}`;
    const options = {
      ...volcengineOptions(
        cacheDir,
        async () => webStreamingResponse(oversizedFrame)
      ),
      maxFrameBytes: 64,
    };

    await assert.rejects(
      synthesize('oversized frame', options),
      /JSON frame.*(?:64|large|limit|size)/i
    );

    assert.deepEqual(fs.readdirSync(cacheDir), []);
  }));
});

test('provider stream is cancelled when frame consumption fails', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          code: 40000001,
          message: 'provider rejected request',
        })));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = async () => new Response(body, { status: 200 });

    await assert.rejects(
      synthesize('cancel failed stream', volcengineOptions(cacheDir, fetchImpl)),
      /response error/i
    );

    assert.equal(cancelled, true);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  }));
});

test('credential values crossing the detail boundary are redacted before truncation', async () => {
  await withoutVolcengineEnv(() => withTemporaryCache(async cacheDir => {
    const apiKey = 'SENSITIVE_HEADER_TOKEN_ABC123';
    const body = `${'x'.repeat(1992)}${apiKey}tail`;
    const fetchImpl = async () => new Response(body, { status: 500 });
    let failure;

    try {
      await synthesize('boundary redaction', {
        ...volcengineOptions(cacheDir, fetchImpl),
        apiKey,
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure);
    assert.equal(failure.message.includes(apiKey), false);
    assert.equal(failure.message.includes(apiKey.slice(0, 3)), false);
    assert.ok(failure.message.length <= 2040, failure.message.length);
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  }));
});
