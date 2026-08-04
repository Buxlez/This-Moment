const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { pipeline } = require('stream/promises');
const { createTtsArtifactStore } = require('./tts-artifact');

const CACHE_DIR = path.join(__dirname, 'cache/tts');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const activeSynthesis = new Map();

const VOLCENGINE_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const VOLCENGINE_DEFAULT_TIMEOUT_MS = 30000;
const VOLCENGINE_DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const VOLCENGINE_DEFAULT_ADDITIONS = JSON.stringify({
  disable_markdown_filter: true,
  enable_language_detector: true,
  enable_latex_tn: true,
  disable_default_bit_rate: true,
  max_length_to_filter_parenthesis: 0,
  cache_config: {
    text_type: 1,
    use_cache: true,
  },
});

function volcengineValue(options, optionName, envName) {
  return options[optionName] || process.env[envName] || '';
}

function validateVolcengineEndpoint(value = VOLCENGINE_DEFAULT_ENDPOINT) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Volcengine TTS credentials may only be sent to the official HTTPS endpoint.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'openspeech.bytedance.com' ||
    url.port !== '' ||
    url.pathname !== '/api/v3/tts/unidirectional' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Volcengine TTS credentials may only be sent to the official HTTPS endpoint.');
  }
  return true;
}

function buildVolcengineHeaders(options = {}) {
  const apiKey = volcengineValue(options, 'apiKey', 'VOLCENGINE_TTS_API_KEY');
  const appId = volcengineValue(options, 'appId', 'VOLCENGINE_TTS_APP_ID');
  const accessToken = volcengineValue(options, 'accessToken', 'VOLCENGINE_TTS_ACCESS_TOKEN');
  const resourceId = volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID');
  const requestId = options.requestId || crypto.randomUUID();

  if (!resourceId) {
    throw new Error('VOLCENGINE_TTS_RESOURCE_ID not set');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'Connection': 'keep-alive',
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  } else if (appId && accessToken) {
    headers['X-Api-App-Id'] = appId;
    headers['X-Api-Access-Key'] = accessToken;
  } else {
    throw new Error(
      'Volcengine TTS credentials not set: provide VOLCENGINE_TTS_API_KEY or both VOLCENGINE_TTS_APP_ID and VOLCENGINE_TTS_ACCESS_TOKEN'
    );
  }

  return headers;
}

function isVolcengineConfigured(options = {}) {
  const apiKey = volcengineValue(options, 'apiKey', 'VOLCENGINE_TTS_API_KEY');
  const appId = volcengineValue(options, 'appId', 'VOLCENGINE_TTS_APP_ID');
  const accessToken = volcengineValue(options, 'accessToken', 'VOLCENGINE_TTS_ACCESS_TOKEN');
  const resourceId = volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID');
  const voiceType = volcengineValue(options, 'voiceType', 'VOLCENGINE_TTS_VOICE_TYPE');

  return Boolean(resourceId && voiceType && (apiKey || (appId && accessToken)));
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSetting(value) {
  if (typeof value === 'string') {
    try {
      return stableStringify(JSON.parse(value));
    } catch {
      return JSON.stringify(value);
    }
  }
  return stableStringify(value);
}

function validateMp3Output(format, encoding) {
  const requested = [format, encoding].filter(value => value != null && value !== '');
  if (requested.some(value => String(value).toLowerCase() !== 'mp3')) {
    throw new Error('Only MP3 TTS output is supported');
  }
}

function effectiveVolcengineSettings(options = {}) {
  const format = options.format || process.env.VOLCENGINE_TTS_FORMAT || 'mp3';
  validateMp3Output(format, options.encoding);
  return {
    additions: options.additions || process.env.VOLCENGINE_TTS_ADDITIONS || VOLCENGINE_DEFAULT_ADDITIONS,
    format,
    resourceId: volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID'),
    sampleRate: Number(options.sampleRate || process.env.VOLCENGINE_TTS_SAMPLE_RATE || 24000),
  };
}

function cacheIdentity(text, provider, options) {
  const role = options.role || 'station';
  const voice = getVoiceForProvider(provider, options);
  let settings;

  if (provider === 'volcengine') {
    const effective = effectiveVolcengineSettings(options);
    settings = {
      additions: canonicalSetting(effective.additions),
      format: String(effective.format).toLowerCase(),
      resource: effective.resourceId,
      sampleRate: effective.sampleRate,
    };
  } else if (provider === 'fish') {
    validateMp3Output(options.format || 'mp3', options.encoding);
    settings = { format: 'mp3', bitrate: 128, resource: voice };
  } else {
    validateMp3Output(options.format || 'mp3', options.encoding);
    settings = {
      format: 'mp3',
      model: options.model || process.env.KOKORO_MODEL || 'kokoro',
      resource: (options.baseUrl || process.env.KOKORO_API_BASE || 'http://127.0.0.1:8880').replace(/\/+$/, ''),
    };
  }

  return { provider, role, voice, text, ...settings };
}

function cachePath(text, provider = process.env.TTS_PROVIDER || 'volcengine', options = {}) {
  const cacheDir = path.resolve(options.cacheDir || CACHE_DIR);
  const identity = cacheIdentity(text, provider, options);
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, `${md5(stableStringify(identity))}.mp3`);
}

function synthesize(text, options = {}) {
  const provider = options.provider || process.env.TTS_PROVIDER || 'volcengine';
  let cached;
  try {
    cached = cachePath(text, provider, options);
  } catch (error) {
    return Promise.reject(error);
  }
  const active = activeSynthesis.get(cached);
  if (active) return active;

  const artifactStore = createTtsArtifactStore(path.dirname(cached));

  const synthesis = (async () => {
    try {
      await artifactStore.validateGeneratedArtifact(cached);
      console.log(`[TTS] 缓存命中 → ${path.basename(cached)}`);
      return cached;
    } catch (error) {
      if (error.code !== 'TTS_ARTIFACT_NOT_FOUND'
        && error.code !== 'INVALID_TTS_ARTIFACT_AUDIO') throw error;
    }

    const preview = text.slice(0, 40) + (text.length > 40 ? '…' : '');
    console.log(`[TTS] 合成中 (${provider}${options.role ? `/${options.role}` : ''})：“${preview}”`);
    const startAt = Date.now();
    if (provider === 'volcengine') {
      await synthesizeVolcengine(text, cached, options);
    } else if (provider === 'fish') {
      await synthesizeFish(text, cached, options);
    } else {
      await synthesizeKokoro(text, cached, options);
    }

    await artifactStore.validateGeneratedArtifact(cached);

    console.log(`[TTS] 完成 (${((Date.now() - startAt) / 1000).toFixed(1)}s) → ${path.basename(cached)}`);
    return cached;
  });

  let pending;
  pending = synthesis().finally(() => {
    if (activeSynthesis.get(cached) === pending) {
      activeSynthesis.delete(cached);
    }
  });
  activeSynthesis.set(cached, pending);
  return pending;
}

function getVoiceForProvider(provider, options = {}) {
  if (provider === 'fish') return options.voiceId || process.env.FISH_VOICE_ID || '';
  if (provider === 'volcengine') return options.voiceType || process.env.VOLCENGINE_TTS_VOICE_TYPE || '';
  return options.voice || process.env.KOKORO_VOICE || '';
}

function buildVolcenginePayload(text, options = {}) {
  const voiceType = options.voiceType || process.env.VOLCENGINE_TTS_VOICE_TYPE;
  if (!voiceType) {
    throw new Error('VOLCENGINE_TTS_VOICE_TYPE not set');
  }
  const settings = effectiveVolcengineSettings(options);

  return {
    req_params: {
      text,
      speaker: voiceType,
      additions: settings.additions,
      audio_params: {
        format: settings.format,
        sample_rate: settings.sampleRate,
      },
    },
  };
}

function volcengineSensitiveValues(options = {}) {
  return [
    volcengineValue(options, 'apiKey', 'VOLCENGINE_TTS_API_KEY'),
    volcengineValue(options, 'appId', 'VOLCENGINE_TTS_APP_ID'),
    volcengineValue(options, 'accessToken', 'VOLCENGINE_TTS_ACCESS_TOKEN'),
    volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID'),
    options.requestId,
  ].filter(Boolean).map(String);
}

function boundedVolcengineDetail(value, options = {}) {
  let detail = String(value == null ? '' : value);
  const secrets = volcengineSensitiveValues(options);
  for (const secret of secrets) {
    detail = detail.split(secret).join('[redacted]');
  }
  return detail.slice(0, 2000);
}

function volcengineErrorReadLimit(options = {}) {
  const longestSecret = volcengineSensitiveValues(options).reduce(
    (longest, secret) => Math.max(longest, Buffer.byteLength(secret)),
    0
  );
  return 2000 + longestSecret;
}

function parseVolcengineEvent(raw, options = {}) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Volcengine TTS returned invalid streaming JSON: ${boundedVolcengineDetail(error.message, options)}`
    );
  }

  let completed = false;
  if (msg.code != null) {
    const code = Number(msg.code);
    if (code === 20000000) {
      completed = true;
    } else if (code !== 0) {
      const detail = boundedVolcengineDetail(`${msg.code}: ${msg.message || ''}`, options);
      throw new Error(`Volcengine TTS response error ${detail}`);
    }
  }

  let audio;
  if (typeof msg.data === 'string' && msg.data) {
    const decoded = Buffer.from(msg.data, 'base64');
    if (decoded.length > 0) audio = decoded;
  }
  return { audio, completed };
}

function effectiveMaxFrameBytes(options = {}) {
  const configured = options.maxFrameBytes ?? (
    process.env.VOLCENGINE_TTS_MAX_FRAME_BYTES || VOLCENGINE_DEFAULT_MAX_FRAME_BYTES
  );
  const maxFrameBytes = Number(configured);
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw new Error('Volcengine TTS maximum JSON frame size must be a positive integer');
  }
  return maxFrameBytes;
}

function createJsonFrameParser(onFrame, options = {}) {
  const maxFrameBytes = effectiveMaxFrameBytes(options);
  let depth = 0;
  let escaped = false;
  let frame = '';
  let frameBytes = 0;
  let inString = false;

  function append(ch) {
    frameBytes += Buffer.byteLength(ch);
    if (frameBytes > maxFrameBytes) {
      throw new Error(
        `Volcengine TTS JSON frame exceeds maximum size of ${maxFrameBytes} bytes`
      );
    }
    frame += ch;
  }

  return {
    push(text) {
      for (const ch of text) {
        if (depth === 0) {
          if (/\s/.test(ch)) continue;
          if (ch !== '{') {
            throw new Error(
              `Volcengine TTS returned invalid streaming JSON framing: ${boundedVolcengineDetail(ch, options)}`
            );
          }
          depth = 1;
          frameBytes = 0;
          append(ch);
          continue;
        }

        append(ch);
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            onFrame(frame);
            frame = '';
            frameBytes = 0;
          }
        }
      }
    },
    finish() {
      if (depth !== 0 || inString || frame) {
        throw new Error('Volcengine TTS stream ended with an incomplete JSON frame');
      }
    },
  };
}

function uniqueTempPath(outPath) {
  return `${outPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
}

function removeTempFile(tempPath) {
  try {
    fs.unlinkSync(tempPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function publishTempFile(tempPath, outPath) {
  fs.renameSync(tempPath, outPath);
}

function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function createVolcengineAbortContext(options = {}) {
  const configured = options.timeoutMs ?? (
    process.env.VOLCENGINE_TTS_TIMEOUT_MS || VOLCENGINE_DEFAULT_TIMEOUT_MS
  );
  const timeoutMs = Number(configured);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('Volcengine TTS timeout must be a non-negative number');
  }

  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) forwardAbort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const timer = timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Volcengine TTS timed out after ${timeoutMs}ms`));
    }, timeoutMs)
    : null;

  let abortListener;
  const aborted = new Promise((_, reject) => {
    abortListener = () => {
      if (timedOut) {
        reject(new Error(`Volcengine TTS timed out after ${timeoutMs}ms`));
      } else {
        reject(new Error('Volcengine TTS request aborted'));
      }
    };
    if (controller.signal.aborted) abortListener();
    else controller.signal.addEventListener('abort', abortListener, { once: true });
  });

  return {
    signal: controller.signal,
    race(promise) {
      return Promise.race([Promise.resolve(promise), aborted]);
    },
    timedOut() {
      return timedOut;
    },
    timeoutMs,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (externalSignal && !externalSignal.aborted) {
        externalSignal.removeEventListener('abort', forwardAbort);
      }
      controller.signal.removeEventListener('abort', abortListener);
    },
  };
}

function chunkBytes(chunk) {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

async function readBoundedBody(body, limit, abortContext) {
  if (!body) return '';
  const chunks = [];
  let remaining = limit;

  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (remaining > 0) {
        const part = await abortContext.race(reader.read());
        if (part.done) break;
        const bytes = chunkBytes(part.value);
        chunks.push(bytes.subarray(0, remaining));
        remaining -= Math.min(bytes.length, remaining);
        if (remaining === 0) {
          await abortContext.race(reader.cancel());
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const iterator = body[Symbol.asyncIterator]();
    while (remaining > 0) {
      const part = await abortContext.race(iterator.next());
      if (part.done) break;
      const bytes = chunkBytes(part.value);
      chunks.push(bytes.subarray(0, remaining));
      remaining -= Math.min(bytes.length, remaining);
      if (remaining === 0) {
        if (typeof iterator.return === 'function') {
          await abortContext.race(iterator.return());
        }
        break;
      }
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function synthesizeVolcengine(text, outPath, options = {}) {
  const endpoint = options.endpoint || process.env.VOLCENGINE_TTS_ENDPOINT || VOLCENGINE_DEFAULT_ENDPOINT;
  validateVolcengineEndpoint(endpoint);
  const headers = buildVolcengineHeaders(options);
  const fetchImpl = options.fetchImpl || fetch;
  const abortContext = createVolcengineAbortContext(options);
  const tempPath = uniqueTempPath(outPath);
  let audioBytes = 0;
  let completed = false;
  let responseComplete = false;
  let responseIterator;
  let tempFd;

  try {
    let res;
    try {
      res = await abortContext.race(fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildVolcenginePayload(text, options)),
        signal: abortContext.signal,
      }));
    } catch (error) {
      if (abortContext.timedOut()) throw error;
      if (abortContext.signal.aborted) {
        throw new Error('Volcengine TTS request aborted');
      }
      throw new Error(
        `Volcengine TTS request failed: ${boundedVolcengineDetail(error && error.message ? error.message : error, options)}`
      );
    }

    if (!res.ok) {
      let err = '';
      try {
        if (res.body) {
          err = await readBoundedBody(
            res.body,
            volcengineErrorReadLimit(options),
            abortContext
          );
        }
      } catch (error) {
        if (abortContext.timedOut() || abortContext.signal.aborted) throw error;
      }
      const detail = boundedVolcengineDetail(`${res.status}: ${err}`, options);
      throw new Error(`Volcengine TTS error ${detail}`);
    }

    const decoder = new TextDecoder();
    const parser = createJsonFrameParser(raw => {
      const event = parseVolcengineEvent(raw, options);
      if (event.audio) {
        if (tempFd === undefined) tempFd = fs.openSync(tempPath, 'wx');
        writeAllSync(tempFd, event.audio);
        audioBytes += event.audio.length;
      }
      if (event.completed) completed = true;
    }, options);

    if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
      throw new Error('Volcengine TTS response body is not streamable');
    }
    responseIterator = res.body[Symbol.asyncIterator]();
    while (true) {
      let part;
      try {
        part = await abortContext.race(responseIterator.next());
      } catch (error) {
        if (abortContext.timedOut() || abortContext.signal.aborted) throw error;
        throw new Error(
          `Volcengine TTS stream failed: ${boundedVolcengineDetail(error && error.message ? error.message : error, options)}`
        );
      }
      if (part.done) {
        responseComplete = true;
        break;
      }
      parser.push(decoder.decode(part.value, { stream: true }));
    }

    parser.push(decoder.decode());
    parser.finish();

    if (!completed) {
      throw new Error('Volcengine TTS stream ended without a terminal completion event');
    }
    if (audioBytes === 0) {
      throw new Error('Volcengine TTS returned no audio data');
    }

    fs.closeSync(tempFd);
    tempFd = undefined;
    publishTempFile(tempPath, outPath);
    return outPath;
  } catch (error) {
    if (responseIterator && !responseComplete && typeof responseIterator.return === 'function') {
      try {
        await abortContext.race(responseIterator.return());
      } catch {}
    }
    if (tempFd !== undefined) {
      try {
        fs.closeSync(tempFd);
      } catch {}
      tempFd = undefined;
    }
    removeTempFile(tempPath);
    throw error;
  } finally {
    abortContext.cleanup();
  }
}

async function synthesizeFish(text, outPath, options = {}) {
  const apiKey = options.apiKey || process.env.FISH_API_KEY;
  const voiceId = options.voiceId || process.env.FISH_VOICE_ID;

  if (!apiKey || !voiceId) {
    throw new Error('FISH_API_KEY or FISH_VOICE_ID not set');
  }

  const body = JSON.stringify({
    text,
    reference_id: voiceId,
    format: 'mp3',
    mp3_bitrate: 128,
  });

  const tempPath = uniqueTempPath(outPath);
  try {
    const response = await new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: 'api.fish.audio',
        path: '/v1/tts',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(requestOptions, resolve);
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (response.statusCode !== 200) {
      const err = await readBoundedBody(response, 2000, {
        race(promise) { return promise; },
      }).catch(() => '');
      const safeDetail = err.split(apiKey).join('[redacted]').slice(0, 2000);
      throw new Error(`Fish Audio TTS error ${response.statusCode}: ${safeDetail}`);
    }

    await pipeline(response, fs.createWriteStream(tempPath, { flags: 'wx' }));
    publishTempFile(tempPath, outPath);
    return outPath;
  } catch (error) {
    removeTempFile(tempPath);
    throw error;
  }
}

async function synthesizeKokoro(text, outPath, options = {}) {
  const baseUrl = (options.baseUrl || process.env.KOKORO_API_BASE || 'http://127.0.0.1:8880').replace(/\/+$/, '');
  const voice = options.voice || process.env.KOKORO_VOICE || 'zf_xiaoxiao';
  const model = options.model || process.env.KOKORO_MODEL || 'kokoro';
  const fetchImpl = options.fetchImpl || fetch;
  const tempPath = uniqueTempPath(outPath);

  try {
    const res = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      const err = res.body
        ? await readBoundedBody(res.body, 2000, { race(promise) { return promise; } }).catch(() => '')
        : '';
      throw new Error(`Kokoro TTS error ${res.status}: ${err}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tempPath, buffer, { flag: 'wx' });
    publishTempFile(tempPath, outPath);
    return outPath;
  } catch (error) {
    removeTempFile(tempPath);
    throw error;
  }
}

module.exports = {
  synthesize,
  cachePath,
  buildVolcengineHeaders,
  isVolcengineConfigured,
  validateVolcengineEndpoint,
};
