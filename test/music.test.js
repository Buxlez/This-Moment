const test = require('node:test');
const assert = require('node:assert/strict');

const { matchTrack, validateCandidates, createDemoProvider } = require('../src/music/provider');
const { DEMO_CATALOG } = require('../src/music/demo-catalog');
const { requestNeteaseJson } = require('../netease-session');
const netease = require('../music-netease');

test('matches normalized song titles and artists but rejects wrong artists', () => {
  assert.equal(matchTrack(
    { title: 'Wake Me Up!', artist: 'Avicii' },
    { title: 'Wake Me Up', artist: 'Avicii' },
  ), true);
  assert.equal(matchTrack(
    { title: '小宇', artist: '张震岳' },
    { title: '小宇 (Live)', artist: '张震岳' },
  ), true);
  assert.equal(matchTrack(
    { title: 'Yellow', artist: 'Coldplay' },
    { title: 'Yellow', artist: 'Katherine Ho' },
  ), false);
});

test('validates candidates in order, removes duplicates, and caps at 20', async () => {
  const provider = {
    name: 'fake',
    async searchTrack(title, artist) {
      const index = Number(title.replace('Song ', ''));
      return { id: `id-${index % 22}`, title, artist, provider: 'fake', durationMs: 180000 };
    },
    async checkPlayable() { return true; },
  };
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    title: `Song ${index}`,
    artist: 'Artist',
  }));
  const tracks = await validateCandidates(candidates, provider, { limit: 20, concurrency: 4 });
  assert.equal(tracks.length, 20);
  assert.deepEqual(tracks.map(track => track.title), candidates.slice(0, 20).map(track => track.title));
});

test('demo provider returns stable catalog metadata and respects exclusions', async () => {
  const provider = createDemoProvider();
  const excluded = new Set(DEMO_CATALOG.slice(0, 20).map(track => track.id));
  const selected = provider.recommend({ limit: 20, excludeIds: excluded, seed: '雨夜' });
  assert.equal(selected.length, 20);
  assert.ok(selected.every(track => !excluded.has(track.id)));
  assert.equal((await provider.resolvePlaybackUrl(selected[0].id)).includes('soundhelix'), true);
});

test('netease search enriches the compact search result with detail metadata', async () => {
  const calls = [];
  const requestJson = async (path) => {
    calls.push(path);
    if (path === '/cloudsearch') {
      return { result: { songs: [{ id: 42, name: '途中', artists: [{ name: '陈鸿宇' }], album: { name: '简略专辑' } }] } };
    }
    if (path === '/song/detail') {
      return { songs: [{ id: 42, name: '途中', ar: [{ name: '陈鸿宇' }], al: { name: '浓烟下的诗歌电台', picUrl: 'https://example.test/cover.jpg' }, dt: 259000 }] };
    }
    return null;
  };

  const track = await netease.searchSong('途中 陈鸿宇', { requestJson });

  assert.deepEqual(calls, ['/cloudsearch', '/song/detail']);
  assert.equal(track.coverUrl, 'https://example.test/cover.jpg');
  assert.equal(track.album, '浓烟下的诗歌电台');
  assert.equal(track.durationMs, 259000);
});

test('netease search can defer artwork enrichment until playability is confirmed', async () => {
  const calls = [];
  const requestJson = async path => {
    calls.push(path);
    return { result: { songs: [{ id: 42, name: '途中', artists: [{ name: '陈鸿宇' }], album: { name: '简略专辑' } }] } };
  };

  const track = await netease.searchSong('途中 陈鸿宇', { requestJson, enrich: false });

  assert.deepEqual(calls, ['/cloudsearch']);
  assert.equal(track.title, '途中');
  assert.equal(track.coverUrl, null);
});

test('candidate validation returns compact results without fetching details', async () => {
  const enriched = [];
  const provider = {
    name: 'netease',
    async searchTrack(title, artist) { return { id: title, title, artist, album: '搜索专辑' }; },
    async checkPlayable(id) { return id === '可播'; },
    async enrichTrack(track) { enriched.push(track.id); return { ...track, coverUrl: 'https://example.test/cover.jpg' }; },
  };

  const tracks = await validateCandidates([
    { title: '不可播', artist: '甲' },
    { title: '可播', artist: '乙' },
  ], provider, { concurrency: 1 });

  assert.deepEqual(enriched, []);
  assert.equal(tracks[0].album, '搜索专辑');
  assert.equal(tracks[0].coverUrl, undefined);
});

test('netease retries a rate-limited search with backoff', async () => {
  let attempts = 0;
  const waits = [];
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 405,
        async text() { return JSON.stringify({ message: 'Cheating' }); },
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ result: { songs: [{ id: 42, name: '途中', artists: [{ name: '陈鸿宇' }] }] } });
      },
    };
  };
  const requestJson = (pathname, params) => requestNeteaseJson(pathname, params, { fetchImpl });

  const track = await netease.searchSong('途中 陈鸿宇', {
    requestJson, enrich: false, sleep: async milliseconds => waits.push(milliseconds), cache: false,
  });

  assert.equal(track.id, 42);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [700]);
});

test('netease does not retry non-rate-limit errors', async () => {
  let attempts = 0;
  const requestJson = async () => {
    attempts += 1;
    const error = new Error('HTTP 500');
    error.status = 500;
    throw error;
  };

  const track = await netease.searchSong('不会成功', {
    requestJson, enrich: false, sleep: async () => {}, cache: false, logger: { warn() {} },
  });

  assert.equal(track, null);
  assert.equal(attempts, 1);
});

test('netease caches search, playability and detail metadata independently', async () => {
  netease.clearCaches();
  const calls = { search: 0, playback: 0, detail: 0 };
  const requestJson = async pathname => {
    if (pathname === '/cloudsearch') {
      calls.search += 1;
      return { result: { songs: [{ id: 42, name: '途中', artists: [{ name: '陈鸿宇' }] }] } };
    }
    if (pathname === '/song/url/v1') {
      calls.playback += 1;
      return { data: [{ id: 42, url: 'https://audio.test/42.mp3' }] };
    }
    if (pathname === '/song/detail') {
      calls.detail += 1;
      return { songs: [{ id: 42, name: '途中', ar: [{ name: '陈鸿宇' }], al: { name: '专辑', picUrl: 'https://image.test/42.jpg' } }] };
    }
    throw new Error(`unexpected endpoint: ${pathname}`);
  };
  const options = { requestJson, cache: true, schedule: operation => operation() };

  await netease.searchSong('途中 陈鸿宇', { ...options, enrich: false });
  await netease.searchSong('途中 陈鸿宇', { ...options, enrich: false });
  await netease.isSongPlayable(42, options);
  await netease.isSongPlayable(42, options);
  await netease.getSongDetail(42, options);
  await netease.getSongDetail(42, options);

  assert.deepEqual(calls, { search: 1, playback: 1, detail: 1 });
});

test('netease does not cache a transient playability request failure', async () => {
  netease.clearCaches();
  let attempts = 0;
  const requestJson = async pathname => {
    assert.equal(pathname, '/song/url/v1');
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('HTTP 500');
      error.status = 500;
      throw error;
    }
    return { data: [{ id: 42, url: 'https://audio.test/42.mp3' }] };
  };
  const options = {
    requestJson,
    cache: true,
    schedule: operation => operation(),
    logger: { warn() {} },
  };

  assert.equal(await netease.isSongPlayable(42, options), false);
  assert.equal(await netease.isSongPlayable(42, options), true);
  assert.equal(attempts, 2);
});

test('netease coalesces concurrent cache misses for the same search', async () => {
  netease.clearCaches();
  let calls = 0;
  let releaseRequest;
  const pendingResponse = new Promise(resolve => { releaseRequest = resolve; });
  const requestJson = async pathname => {
    assert.equal(pathname, '/cloudsearch');
    calls += 1;
    return pendingResponse;
  };
  const options = {
    requestJson,
    cache: true,
    enrich: false,
    schedule: operation => operation(),
  };

  const first = netease.searchSong('途中 陈鸿宇', options);
  const second = netease.searchSong('途中 陈鸿宇', options);
  await Promise.resolve();

  assert.equal(calls, 1);
  releaseRequest({ result: { songs: [{ id: 42, name: '途中', artists: [{ name: '陈鸿宇' }] }] } });
  const [firstTrack, secondTrack] = await Promise.all([first, second]);
  assert.equal(firstTrack.id, 42);
  assert.equal(secondTrack.id, 42);
});

test('netease request scheduler keeps a minimum start interval', async () => {
  let clock = 0;
  const starts = [];
  const waits = [];
  const schedule = netease.createRequestScheduler({
    minIntervalMs: 350,
    now: () => clock,
    sleep: async milliseconds => { waits.push(milliseconds); clock += milliseconds; },
  });

  await Promise.all([
    schedule(async () => { starts.push(clock); return 'first'; }),
    schedule(async () => { starts.push(clock); return 'second'; }),
  ]);

  assert.deepEqual(starts, [0, 350]);
  assert.deepEqual(waits, [350]);
});

test('candidate validation stops taking work after reaching the target', async () => {
  let searches = 0;
  const candidates = Array.from({ length: 12 }, (_, index) => ({ title: `Song ${index}`, artist: `Artist ${index}` }));
  const provider = {
    name: 'fake',
    async searchTrack(title, artist) {
      searches += 1;
      await Promise.resolve();
      return { id: title, title, artist };
    },
    async checkPlayable() { return true; },
  };

  const tracks = await validateCandidates(candidates, provider, { limit: 8, concurrency: 2 });

  assert.equal(tracks.length, 8);
  assert.ok(searches < candidates.length, `expected early stop, searched ${searches}`);
});
