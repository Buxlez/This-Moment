const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MIN_INTERVAL_MS = 350;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const PLAYABLE_TTL_MS = 2 * 60 * 1000;
const DETAIL_TTL_MS = 30 * 60 * 1000;
const { getNeteaseConfig, redactSensitiveText, requestNeteaseJson } = require('./netease-session');

const searchCache = new Map();
const playableCache = new Map();
const detailCache = new Map();
const searchInFlight = new Map();
const playableInFlight = new Map();
const detailInFlight = new Map();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function createRequestScheduler({
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  now = Date.now,
  sleep: wait = sleep,
} = {}) {
  let lastStartedAt = null;
  let startTail = Promise.resolve();
  return function schedule(operation) {
    const start = startTail.then(async () => {
      if (lastStartedAt !== null) {
        const remaining = Math.max(0, lastStartedAt + minIntervalMs - now());
        if (remaining) await wait(remaining);
      }
      lastStartedAt = now();
    });
    startTail = start.catch(() => {});
    return start.then(operation);
  };
}

const scheduleNeteaseRequest = createRequestScheduler();

function cacheEnabled(options) {
  return options.cache ?? !options.requestJson;
}

function cacheNow(options) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function readCache(cache, key, options) {
  if (!cacheEnabled(options)) return { hit: false, value: null };
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= cacheNow(options)) {
    if (entry) cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

function writeCache(cache, key, value, ttlMs, options) {
  if (cacheEnabled(options)) cache.set(key, { value, expiresAt: cacheNow(options) + ttlMs });
  return value;
}

function getCachedValue(cache, inFlight, key, ttlMs, options, operation) {
  const cached = readCache(cache, key, options);
  if (cached.hit) return Promise.resolve(cached.value);
  if (!cacheEnabled(options)) return operation();

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = Promise.resolve()
    .then(operation)
    .then(value => writeCache(cache, key, value, ttlMs, options))
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

function clearCaches() {
  searchCache.clear();
  playableCache.clear();
  detailCache.clear();
  searchInFlight.clear();
  playableInFlight.clear();
  detailInFlight.clear();
}

function isRateLimitError(error) {
  return error?.status === 405 || error?.status === 429 || /HTTP (405|429)\b/.test(String(error?.message || ''));
}

async function requestWithRetry(operation, options = {}) {
  const retries = Number(options.retries ?? 2);
  const wait = options.sleep || sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= retries) throw error;
      await wait(700 * (2 ** attempt));
    }
  }
}

function getConfig() {
  const { baseUrl, cookie } = getNeteaseConfig();
  return { baseUrl, cookie };
}

async function requestJson(path, params = {}) {
  const { baseUrl, cookie } = getConfig();
  if (!baseUrl) return null;
  return requestNeteaseJson(path, params, { baseUrl, cookie, timeoutMs: DEFAULT_TIMEOUT_MS });
}

function runNeteaseRequest(path, params, options = {}) {
  const request = options.requestJson || requestJson;
  const schedule = options.schedule || (options.requestJson ? operation => operation() : scheduleNeteaseRequest);
  return requestWithRetry(() => schedule(() => request(path, params)), options);
}

function normalizeSong(raw) {
  if (!raw) return null;

  const artists = raw.artists || raw.ar || [];
  return {
    id: raw.id,
    title: raw.name,
    artist: artists.map(a => a.name).filter(Boolean).join(', '),
    album: raw.album?.name || raw.al?.name || '',
    coverUrl: raw.album?.picUrl || raw.al?.picUrl || null,
    durationMs: raw.duration || raw.dt || null,
    provider: 'netease',
  };
}

async function requestPlaybackUrl(id, options = {}) {
  const data = await runNeteaseRequest('/song/url/v1', {
    id,
    level: process.env.NETEASE_LEVEL || 'standard',
  }, options);
  return data?.data?.[0]?.url || null;
}

async function getPlaybackUrl(id, options = {}) {
  if (!id) return null;
  try {
    return await requestPlaybackUrl(id, options);
  } catch (err) {
    (options.logger || console).warn('[netease] playback resolve failed:', redactSensitiveText(err.message));
    return null;
  }
}

async function searchSong(query, options = {}) {
  const key = String(query || '').trim().toLowerCase();
  try {
    const compactSong = await getCachedValue(searchCache, searchInFlight, key, SEARCH_TTL_MS, options, async () => {
      const data = await runNeteaseRequest('/cloudsearch', {
        keywords: query,
        type: 1,
        limit: 1,
      }, options);
      return normalizeSong(data?.result?.songs?.[0]);
    });
    if (!compactSong) return null;
    if (options.enrich === false) return compactSong;

    return (await getSongDetail(compactSong.id, options)) || compactSong;
  } catch (err) {
    (options.logger || console).warn('[netease] search failed:', redactSensitiveText(err.message));
    return null;
  }
}

async function getSongDetail(id, options = {}) {
  if (!id) return null;
  const key = String(id);
  try {
    return await getCachedValue(detailCache, detailInFlight, key, DETAIL_TTL_MS, options, async () => {
      const detail = await runNeteaseRequest('/song/detail', { ids: id }, options);
      return normalizeSong(detail?.songs?.[0]);
    });
  } catch (err) {
    console.warn('[netease] detail failed:', redactSensitiveText(err.message));
    return null;
  }
}

async function isSongPlayable(id, options = {}) {
  if (!id) return false;
  const key = String(id);
  try {
    return await getCachedValue(playableCache, playableInFlight, key, PLAYABLE_TTL_MS, options, async () => (
      Boolean(await requestPlaybackUrl(id, options))
    ));
  } catch (err) {
    (options.logger || console).warn('[netease] playback resolve failed:', redactSensitiveText(err.message));
    return false;
  }
}

async function getStreamUrl(query, options = {}) {
  const { baseUrl } = getConfig();
  if (!baseUrl) return null;

  const song = await searchSong(query, options);
  if (!song?.id) return null;

  try {
    const data = await runNeteaseRequest('/song/url/v1', {
      id: song.id,
      level: process.env.NETEASE_LEVEL || 'standard',
    }, options);
    const item = data?.data?.[0];
    const url = item?.url;
    if (!url) {
      console.warn(`[netease] no playable url: ${song.title} - ${song.artist || 'unknown'}`);
      return null;
    }
    return url;
  } catch (err) {
    console.warn('[netease] url failed:', redactSensitiveText(err.message));
    return null;
  }
}

async function getLyrics(id, options = {}) {
  if (!id) return null;

  try {
    const data = await runNeteaseRequest('/lyric', { id }, options);
    const lrc = data?.lrc?.lyric || '';
    const translated = data?.tlyric?.lyric || '';
    if (!lrc && !translated) return null;
    return { lrc, translated };
  } catch (err) {
    console.warn('[netease] lyric failed:', redactSensitiveText(err.message));
    return null;
  }
}

async function getTrack(query, options = {}) {
  const { baseUrl } = getConfig();
  if (!baseUrl) return null;

  const song = await searchSong(query, options);
  if (!song?.id) return null;

  try {
    const data = await runNeteaseRequest('/song/url/v1', {
      id: song.id,
      level: process.env.NETEASE_LEVEL || 'standard',
    }, options);
    const item = data?.data?.[0];
    const streamUrl = item?.url;
    if (!streamUrl) {
      console.warn(`[netease] no playable url: ${song.title} - ${song.artist || 'unknown'}`);
      return null;
    }

    return {
      ...song,
      query,
      streamUrl,
      lyrics: await getLyrics(song.id, options),
    };
  } catch (err) {
    console.warn('[netease] track failed:', redactSensitiveText(err.message));
    return null;
  }
}

module.exports = {
  clearCaches,
  createRequestScheduler,
  getStreamUrl,
  getTrack,
  searchSong,
  getSongDetail,
  getLyrics,
  getPlaybackUrl,
  isSongPlayable,
  requestWithRetry,
};
