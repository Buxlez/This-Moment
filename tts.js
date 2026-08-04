const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const CACHE_DIR = path.join(__dirname, 'cache/tts');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const activeSynthesis = new Map();

const VOLCENGINE_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

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

function cachePath(text, provider = process.env.TTS_PROVIDER || 'volcengine', options = {}) {
  const voice = getVoiceForProvider(provider, options);
  const role = options.role || 'station';
  const cacheDir = path.resolve(options.cacheDir || CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, `${md5(`${role}:${provider}:${voice}:${text}`)}.mp3`);
}

function synthesize(text, options = {}) {
  const provider = options.provider || process.env.TTS_PROVIDER || 'volcengine';
  const cached = cachePath(text, provider, options);
  if (isUsableCache(cached)) {
    console.log(`[TTS] 缓存命中 → ${path.basename(cached)}`);
    return Promise.resolve(cached);
  }

  const active = activeSynthesis.get(cached);
  if (active) return active;

  const preview = text.slice(0, 40) + (text.length > 40 ? '…' : '');
  console.log(`[TTS] 合成中 (${provider}${options.role ? `/${options.role}` : ''})："${preview}"`);
  const startAt = Date.now();

  const synthesis = (async () => {
    try {
      if (provider === 'volcengine') {
        await synthesizeVolcengine(text, cached, options);
      } else if (provider === 'fish') {
        await synthesizeFish(text, cached, options);
      } else {
        await synthesizeKokoro(text, cached, options);
      }

      if (!isUsableCache(cached)) {
        throw new Error(`${provider} TTS did not produce a usable audio cache file`);
      }

      console.log(`[TTS] 完成 (${((Date.now() - startAt) / 1000).toFixed(1)}s) → ${path.basename(cached)}`);
      return cached;
    } catch (error) {
      removeCacheFile(cached);
      throw error;
    }
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

function isUsableCache(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function removeCacheFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[TTS] 无法清理失败的缓存文件 → ${path.basename(filePath)}`);
    }
  }
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

  return {
    req_params: {
      text,
      speaker: voiceType,
      additions: options.additions || process.env.VOLCENGINE_TTS_ADDITIONS || JSON.stringify({
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
        format: options.format || process.env.VOLCENGINE_TTS_FORMAT || 'mp3',
        sample_rate: Number(options.sampleRate || process.env.VOLCENGINE_TTS_SAMPLE_RATE || 24000),
      },
    },
  };
}

function boundedVolcengineDetail(value) {
  return String(value == null ? '' : value).slice(0, 2000);
}

function collectVolcengineAudio(line, audioChunks) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Volcengine TTS returned invalid streaming JSON: ${boundedVolcengineDetail(error.message)}`
    );
  }

  if (msg.code != null) {
    const code = Number(msg.code);
    if (code !== 0 && code !== 20000000) {
      const detail = boundedVolcengineDetail(`${msg.code}: ${msg.message || ''}`);
      throw new Error(`Volcengine TTS response error ${detail}`);
    }
  }

  if (typeof msg.data === 'string' && msg.data) {
    const audio = Buffer.from(msg.data, 'base64');
    if (audio.length > 0) audioChunks.push(audio);
  }
}

async function synthesizeVolcengine(text, outPath, options = {}) {
  const endpoint = options.endpoint || process.env.VOLCENGINE_TTS_ENDPOINT || VOLCENGINE_DEFAULT_ENDPOINT;
  validateVolcengineEndpoint(endpoint);
  const headers = buildVolcengineHeaders(options);
  const fetchImpl = options.fetchImpl || fetch;
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildVolcenginePayload(text, options)),
    });
  } catch (error) {
    throw new Error(
      `Volcengine TTS request failed: ${boundedVolcengineDetail(error && error.message ? error.message : error)}`
    );
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    const detail = boundedVolcengineDetail(`${res.status}: ${err}`);
    throw new Error(`Volcengine TTS error ${detail}`);
  }

  const audioChunks = [];
  let buffer = '';
  const decoder = new TextDecoder();

  const iterator = res.body[Symbol.asyncIterator]();
  while (true) {
    let part;
    try {
      part = await iterator.next();
    } catch (error) {
      throw new Error(
        `Volcengine TTS stream failed: ${boundedVolcengineDetail(error && error.message ? error.message : error)}`
      );
    }
    if (part.done) break;

    buffer += decoder.decode(part.value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      collectVolcengineAudio(buffer.slice(0, newlineIndex), audioChunks);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  buffer += decoder.decode();
  collectVolcengineAudio(buffer, audioChunks);

  if (!audioChunks.length) {
    throw new Error('Volcengine TTS returned no audio data');
  }

  fs.writeFileSync(outPath, Buffer.concat(audioChunks));
  return outPath;
}

function synthesizeFish(text, outPath, options = {}) {
  const apiKey = options.apiKey || process.env.FISH_API_KEY;
  const voiceId = options.voiceId || process.env.FISH_VOICE_ID;

  if (!apiKey || !voiceId) {
    return Promise.reject(new Error('FISH_API_KEY or FISH_VOICE_ID not set'));
  }

  const body = JSON.stringify({
    text,
    reference_id: voiceId,
    format: 'mp3',
    mp3_bitrate: 128,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.fish.audio',
      path: '/v1/tts',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', d => { err += d; });
        res.on('end', () => reject(new Error(`Fish Audio TTS error ${res.statusCode}: ${err}`)));
        return;
      }
      const out = fs.createWriteStream(outPath);
      res.pipe(out);
      out.on('finish', () => resolve(outPath));
      out.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function synthesizeKokoro(text, outPath, options = {}) {
  const baseUrl = (options.baseUrl || process.env.KOKORO_API_BASE || 'http://127.0.0.1:8880').replace(/\/+$/, '');
  const voice = options.voice || process.env.KOKORO_VOICE || 'zf_xiaoxiao';
  const model = options.model || process.env.KOKORO_MODEL || 'kokoro';

  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
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
    const err = await res.text().catch(() => '');
    throw new Error(`Kokoro TTS error ${res.status}: ${err}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = {
  synthesize,
  cachePath,
  buildVolcengineHeaders,
  isVolcengineConfigured,
  validateVolcengineEndpoint,
};
