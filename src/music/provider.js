const crypto = require('crypto');
const netease = require('../../music-netease');
const { DEMO_CATALOG } = require('./demo-catalog');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchTrack(requested, resolved) {
  const requestedTitle = normalize(requested?.title);
  const resolvedTitle = normalize(resolved?.title);
  const requestedArtist = normalize(requested?.artist);
  const resolvedArtist = normalize(resolved?.artist);
  const titleMatches = requestedTitle && resolvedTitle && (
    requestedTitle === resolvedTitle || requestedTitle.includes(resolvedTitle) || resolvedTitle.includes(requestedTitle)
  );
  const artistMatches = !requestedArtist || !resolvedArtist || (
    requestedArtist === resolvedArtist || requestedArtist.includes(resolvedArtist) || resolvedArtist.includes(requestedArtist)
  );
  return Boolean(titleMatches && artistMatches);
}

async function validateCandidates(candidates, provider, options = {}) {
  const limit = Math.min(Number(options.limit || 20), 20);
  const excluded = options.excludeIds || new Set();
  const accepted = [];
  const seen = new Set();
  let cursor = 0;

  async function run() {
    while (accepted.length < limit && cursor < candidates.length) {
      const index = cursor++;
      const candidate = candidates[index];
      const resolved = await provider.searchTrack(candidate.title, candidate.artist);
      const id = String(resolved?.id || '');
      if (!resolved || !matchTrack(candidate, resolved) || excluded.has(id) || seen.has(id)) continue;
      const playable = await provider.checkPlayable(resolved.id);
      if (!playable || seen.has(id)) continue;
      const enriched = typeof provider.enrichTrack === 'function'
        ? await provider.enrichTrack(resolved)
        : resolved;
      if (seen.has(id)) continue;
      seen.add(id);
      accepted.push({ index, track: { ...(enriched || resolved), provider: provider.name } });
    }
  }

  const concurrency = Math.max(1, Number(options.concurrency || 5));
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, run));
  return accepted.sort((left, right) => left.index - right.index).slice(0, limit).map(item => item.track);
}

function seededOffset(seed, length) {
  const hash = crypto.createHash('sha256').update(String(seed || 'this-moment')).digest();
  return hash.readUInt32BE(0) % length;
}

function createDemoProvider() {
  return {
    name: 'demo',
    recommend({ limit = 40, excludeIds = new Set(), seed = '' } = {}) {
      const offset = seededOffset(seed, DEMO_CATALOG.length);
      const rotated = [...DEMO_CATALOG.slice(offset), ...DEMO_CATALOG.slice(0, offset)];
      return rotated.filter(track => !excludeIds.has(track.id)).slice(0, limit).map(track => ({ ...track }));
    },
    async searchTrack(title, artist) {
      return DEMO_CATALOG.find(track => matchTrack({ title, artist }, track)) || null;
    },
    async checkPlayable(id) { return DEMO_CATALOG.some(track => track.id === id); },
    async resolvePlaybackUrl(id) { return DEMO_CATALOG.find(track => track.id === id)?.previewUrl || null; },
  };
}

function createNeteaseProvider() {
  return {
    name: 'netease',
    async searchTrack(title, artist) { return netease.searchSong(`${title} ${artist}`, { enrich: false }); },
    async checkPlayable(id) { return netease.isSongPlayable(id); },
    async enrichTrack(track) { return (await netease.getSongDetail(track.id)) || track; },
    async resolvePlaybackUrl(id) { return netease.getPlaybackUrl(id); },
  };
}

function createMusicProvider(config = {}) {
  return config.demoMode ? createDemoProvider() : createNeteaseProvider();
}

module.exports = {
  normalize,
  matchTrack,
  validateCandidates,
  createDemoProvider,
  createNeteaseProvider,
  createMusicProvider,
};
