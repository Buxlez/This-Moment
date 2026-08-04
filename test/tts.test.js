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
        JSON.stringify({ code: 20000000, message: 'started' }),
        ...fragments.map(fragment => JSON.stringify({
          code: 20000000,
          data: Buffer.from(fragment).toString('base64'),
        })),
        JSON.stringify({ code: 20000000, message: 'finished' }),
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
        JSON.stringify({
          code: 20000000,
          data: Buffer.from('ID3-shared').toString('base64'),
        }),
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
          JSON.stringify({ code: 20000000, message: 'finished without audio' }),
        ]);
      }
      return streamingResponse([
        JSON.stringify({
          code: 20000000,
          data: Buffer.from('ID3-retry').toString('base64'),
        }),
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
