const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { WebSocket } = require('ws');

const { createApp } = require('../server');
const defaultTts = require('../tts');

const PUBLIC_TTS_ERROR = '推荐语音暂不可用，可稍后重试。';
const HASHED_MP3 = '0123456789abcdef0123456789abcdef.mp3';
const OTHER_HASHED_MP3 = 'abcdef0123456789abcdef0123456789.mp3';
const MPEG_FRAME = Buffer.alloc(52);
Buffer.from([0xff, 0xe3, 0x10, 0x00]).copy(MPEG_FRAME);
const VALID_MP3 = Buffer.concat([
  Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  MPEG_FRAME,
]);

function fakeCard(sessionId = 's1') {
  return {
    id: 'card-1', sessionId, title: '这一刻', description: '推荐语。', provider: 'demo',
    ttsStatus: 'failed', tracks: [{ id: 'demo-001', provider: 'demo', title: '小宇', artist: '张震岳' }],
  };
}

function serverDependencies(overrides = {}) {
  const card = overrides.card || fakeCard();
  const repository = overrides.repository || {
    listCards: () => [card],
    getCard: id => id === card.id ? card : null,
    updateTts: (_id, update) => {
      card.ttsStatus = update.status;
      card.ttsUrl = update.url || null;
      card.ttsError = update.error || null;
    },
    recordPlayEvent: () => {},
  };
  return {
    repository,
    pipeline: { generate: async () => card },
    musicProvider: { name: 'demo', resolvePlaybackUrl: async () => null },
    demoMode: true,
    ...overrides,
  };
}

async function listen(instance) {
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${instance.server.address().port}`;
}

function waitForSocketEvent(socket, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = data => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (!predicate(event)) return;
      cleanup();
      resolve(event);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function configuredFromIsolatedEnvironment(environment) {
  const ttsPath = path.join(__dirname, '..', 'tts.js');
  const result = spawnSync(process.execPath, [
    '-e',
    `const tts = require(${JSON.stringify(ttsPath)}); process.stdout.write(String(tts.isVolcengineConfigured()));`,
  ], { env: environment, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout === 'true';
}

test('status uses safe injected TTS configuration derived from supported auth modes', async t => {
  const configurations = [
    {
      name: 'legacy credentials',
      configured: configuredFromIsolatedEnvironment({
        VOLCENGINE_TTS_APP_ID: 'test-app-id',
        VOLCENGINE_TTS_ACCESS_TOKEN: 'test-access-token',
        VOLCENGINE_TTS_RESOURCE_ID: 'test-resource-id',
        VOLCENGINE_TTS_VOICE_TYPE: 'test-voice-type',
      }),
      expected: true,
    },
    {
      name: 'incomplete legacy credentials',
      configured: configuredFromIsolatedEnvironment({
        VOLCENGINE_TTS_APP_ID: 'test-app-id',
        VOLCENGINE_TTS_RESOURCE_ID: 'test-resource-id',
        VOLCENGINE_TTS_VOICE_TYPE: 'test-voice-type',
      }),
      expected: false,
    },
    {
      name: 'API key credentials',
      configured: configuredFromIsolatedEnvironment({
        VOLCENGINE_TTS_API_KEY: 'test-api-key',
        VOLCENGINE_TTS_RESOURCE_ID: 'test-resource-id',
        VOLCENGINE_TTS_VOICE_TYPE: 'test-voice-type',
      }),
      expected: true,
    },
  ];

  for (const configuration of configurations) {
    let overrideCalls = 0;
    const instance = createApp(serverDependencies({
      ttsConfigured: () => {
        overrideCalls += 1;
        return configuration.configured;
      },
    }));
    const base = await listen(instance);
    t.after(() => instance.close());

    const response = await fetch(`${base}/api/status`);
    const status = await response.json();

    assert.equal(response.status, 200, configuration.name);
    assert.equal(status.ttsConfigured, configuration.expected, configuration.name);
    assert.equal(overrideCalls, 1, configuration.name);
    assert.deepEqual(Object.keys(status).sort(), [
      'llmConfigured', 'mode', 'musicProvider', 'name', 'ok', 'ttsConfigured',
    ]);
    assert.doesNotMatch(JSON.stringify(status), /app.?id|access.?token|api.?key|secret|header|endpoint/i);
  }

  const explicitFalse = createApp(serverDependencies({ ttsConfigured: false }));
  const base = await listen(explicitFalse);
  t.after(() => explicitFalse.close());
  assert.equal((await (await fetch(`${base}/api/status`)).json()).ttsConfigured, false);

  const explicitTrue = createApp(serverDependencies({ ttsConfigured: true }));
  t.after(() => explicitTrue.close());
  assert.equal(explicitTrue.dependencies.tts, defaultTts);
});

test('unconfigured TTS uses the public fallback only in demo mode', async t => {
  const demo = createApp(serverDependencies({ demoMode: true, ttsConfigured: false }));
  t.after(() => demo.close());
  assert.notEqual(demo.dependencies.tts, defaultTts);
  await assert.rejects(
    demo.dependencies.tts.synthesize('recommendation'),
    error => error.message === PUBLIC_TTS_ERROR
  );

  const live = createApp(serverDependencies({ demoMode: false, ttsConfigured: false }));
  t.after(() => live.close());
  assert.equal(live.dependencies.tts, defaultTts);

  const injectedTts = { synthesize: async () => 'injected.mp3' };
  const injected = createApp(serverDependencies({
    demoMode: false, ttsConfigured: false, tts: injectedTts,
  }));
  t.after(() => injected.close());
  assert.equal(injected.dependencies.tts, injectedTts);
});

test('queued generation failures broadcast only fixed public copy', async t => {
  const upstreamDetail = 'provider 401 token=credential-fragment X-Api-Key /private/model/error.json';
  const instance = createApp(serverDependencies({
    pipeline: { generate: async () => { throw new Error(upstreamDetail); } },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());

  const socket = new WebSocket(`${base.replace('http', 'ws')}/stream?sessionId=failure-session`);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const failedEvent = waitForSocketEvent(socket, event => event.type === 'failed');

  const response = await fetch(`${base}/api/recommendations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'failure-session', userInput: '来点音乐' }),
  });
  const body = await response.json();
  const event = await failedEvent;
  const publicPayload = JSON.stringify({ body, event });

  assert.equal(response.status, 202);
  assert.deepEqual(event, {
    type: 'failed', sessionId: 'failure-session', jobId: body.jobId,
    error: '生成失败，请稍后重试。',
  });
  assert.equal(publicPayload.includes(upstreamDetail), false);
  assert.doesNotMatch(publicPayload, /credential-fragment|X-Api-Key|\/private\/model|provider 401/);
});

test('internally created pipeline receives the configured artifact trust boundary', t => {
  const ttsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-pipeline-cache-test-'));
  t.after(() => fs.rmSync(ttsCacheDir, { recursive: true, force: true }));
  let instance;

  assert.doesNotThrow(() => {
    instance = createApp(serverDependencies({
      pipeline: undefined,
      llm: { generatePlan: async () => { throw new Error('unused'); } },
      tts: { synthesize: async () => { throw new Error('unused'); } },
      ttsCacheDir,
    }));
  });
  t.after(() => instance?.close());

  assert.equal(instance.dependencies.pipeline.dependencies.ttsArtifact.root, path.resolve(ttsCacheDir));
});

test('TTS retry publishes one ready update and returns a servable MP3 URL', async t => {
  const card = fakeCard('retry-session');
  const ttsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-tts-cache-test-'));
  const audio = VALID_MP3;
  const audioPath = path.join(ttsCacheDir, HASHED_MP3);
  fs.writeFileSync(audioPath, audio);
  t.after(() => fs.rmSync(ttsCacheDir, { recursive: true, force: true }));
  const updates = [];
  let synthesisOptions;
  const repository = {
    listCards: () => [card],
    getCard: id => id === card.id ? card : null,
    updateTts: (_id, update) => {
      updates.push(update);
      card.ttsStatus = update.status;
      card.ttsUrl = update.url || null;
      card.ttsError = update.error || null;
    },
    recordPlayEvent: () => {},
  };
  const instance = createApp(serverDependencies({
    card,
    repository,
    ttsConfigured: true,
    ttsCacheDir,
    tts: {
      synthesize: async (_text, options) => {
        synthesisOptions = options;
        return audioPath;
      },
    },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());

  const events = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/stream?sessionId=retry-session`);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', data => events.push(JSON.parse(data.toString())));

  const response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  const result = await response.json();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(response.status, 200);
  assert.deepEqual(result, { ttsStatus: 'ready', ttsUrl: `/api/tts/${HASHED_MP3}` });
  assert.deepEqual(updates, [
    { status: 'pending', url: null, error: null },
    { status: 'ready', url: `/api/tts/${HASHED_MP3}`, error: null },
  ]);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, `/api/tts/${HASHED_MP3}`);
  assert.deepEqual(synthesisOptions, {
    role: 'recommendation', cacheDir: path.resolve(ttsCacheDir),
  });
  assert.deepEqual(events.filter(event => event.type === 'tts-ready'), [{
    type: 'tts-ready', sessionId: 'retry-session', cardId: 'card-1',
    ttsUrl: `/api/tts/${HASHED_MP3}`,
  }]);

  const audioResponse = await fetch(`${base}${result.ttsUrl}`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(audioResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(audioResponse.headers.get('cache-control') || '', /immutable/);
  assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), audio);
});

test('retry and serving reject untrusted artifact names, paths, contents, and symlinks', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'server-artifact-security-test-'));
  const ttsCacheDir = path.join(parent, 'cache');
  fs.mkdirSync(ttsCacheDir);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const textPath = path.join(ttsCacheDir, HASHED_MP3);
  const outsidePath = path.join(parent, OTHER_HASHED_MP3);
  const symlinkPath = path.join(ttsCacheDir, OTHER_HASHED_MP3);
  const arbitraryPath = path.join(ttsCacheDir, 'retry_voice.mp3');
  fs.writeFileSync(textPath, Buffer.from('not audio'));
  fs.writeFileSync(outsidePath, VALID_MP3);
  fs.writeFileSync(arbitraryPath, VALID_MP3);
  fs.symlinkSync(outsidePath, symlinkPath);

  const card = fakeCard('security-session');
  const updates = [];
  let synthesizedPath = outsidePath;
  const repository = {
    listCards: () => [card],
    getCard: id => id === card.id ? card : null,
    updateTts: (_id, update) => updates.push(update),
    recordPlayEvent: () => {},
  };
  const instance = createApp(serverDependencies({
    card, repository, ttsCacheDir, ttsConfigured: true,
    tts: { synthesize: async () => synthesizedPath },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());

  let response = await fetch(`${base}/api/tts/${HASHED_MP3}`);
  assert.equal(response.status, 404);
  response = await fetch(`${base}/api/tts/${OTHER_HASHED_MP3}`);
  assert.equal(response.status, 404);
  response = await fetch(`${base}/api/tts/retry_voice.mp3`);
  assert.equal(response.status, 400);
  response = await fetch(`${base}/api/tts/%2e%2e%2fREADME.md`);
  assert.notEqual(response.status, 200);

  response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: PUBLIC_TTS_ERROR });

  synthesizedPath = arbitraryPath;
  response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: PUBLIC_TTS_ERROR });
  assert.equal(updates.filter(update => update.status === 'failed')
    .every(update => update.error === PUBLIC_TTS_ERROR), true);
});

test('serving rejects a cache-root symlink swap and preserves the outside artifact', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'server-root-swap-test-'));
  const ttsCacheDir = path.join(parent, 'cache');
  const movedRoot = path.join(parent, 'original-cache');
  const outsideRoot = path.join(parent, 'outside');
  const outsideArtifact = path.join(outsideRoot, HASHED_MP3);
  fs.mkdirSync(ttsCacheDir);
  fs.mkdirSync(outsideRoot);
  const instance = createApp(serverDependencies({ ttsCacheDir }));
  const base = await listen(instance);
  t.after(() => instance.close());
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  fs.writeFileSync(outsideArtifact, VALID_MP3);
  fs.renameSync(ttsCacheDir, movedRoot);
  fs.symlinkSync(outsideRoot, ttsCacheDir);

  const response = await fetch(`${base}/api/tts/${HASHED_MP3}`);

  assert.notEqual(response.status, 200);
  assert.deepEqual(fs.readFileSync(outsideArtifact), VALID_MP3);
});

test('concurrent successful retries share one attempt and later retry runs after cleanup', async t => {
  const card = fakeCard('concurrent-session');
  const ttsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-retry-concurrency-test-'));
  const audioPath = path.join(ttsCacheDir, HASHED_MP3);
  fs.writeFileSync(audioPath, VALID_MP3);
  t.after(() => fs.rmSync(ttsCacheDir, { recursive: true, force: true }));
  const updates = [];
  let synthCalls = 0;
  let getCardCalls = 0;
  let followerReachedResolve;
  const followerReached = new Promise(resolve => { followerReachedResolve = resolve; });
  let firstStartedResolve;
  const firstStarted = new Promise(resolve => { firstStartedResolve = resolve; });
  const releaseFirst = deferred();
  const repository = {
    listCards: () => [card],
    getCard: id => {
      getCardCalls += 1;
      if (getCardCalls === 2) followerReachedResolve();
      return id === card.id ? card : null;
    },
    updateTts: (_id, update) => updates.push(update),
    recordPlayEvent: () => {},
  };
  const instance = createApp(serverDependencies({
    card, repository, ttsCacheDir, ttsConfigured: true,
    tts: {
      async synthesize() {
        synthCalls += 1;
        if (synthCalls === 1) {
          firstStartedResolve();
          await releaseFirst.promise;
        }
        return audioPath;
      },
    },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());
  const events = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/stream?sessionId=concurrent-session`);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', data => events.push(JSON.parse(data.toString())));

  const firstResponse = fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  await firstStarted;
  const secondResponse = fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  await followerReached;
  releaseFirst.resolve();
  const responses = await Promise.all([firstResponse, secondResponse]);
  const bodies = await Promise.all(responses.map(response => response.json()));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(synthCalls, 1);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(updates, [
    { status: 'pending', url: null, error: null },
    { status: 'ready', url: `/api/tts/${HASHED_MP3}`, error: null },
  ]);
  assert.equal(events.filter(event => event.type === 'tts-ready').length, 1);

  const laterResponse = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  assert.equal(laterResponse.status, 200);
  assert.equal(synthCalls, 2);
  assert.deepEqual(updates.slice(2), [
    { status: 'pending', url: null, error: null },
    { status: 'ready', url: `/api/tts/${HASHED_MP3}`, error: null },
  ]);
});

test('concurrent retry cannot let a would-be follower failure overwrite owner success', async t => {
  const card = fakeCard('owner-session');
  const ttsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-retry-owner-test-'));
  const audioPath = path.join(ttsCacheDir, HASHED_MP3);
  fs.writeFileSync(audioPath, VALID_MP3);
  t.after(() => fs.rmSync(ttsCacheDir, { recursive: true, force: true }));
  const updates = [];
  let synthCalls = 0;
  let getCardCalls = 0;
  let followerReachedResolve;
  const followerReached = new Promise(resolve => { followerReachedResolve = resolve; });
  const releaseOwner = deferred();
  let ownerStartedResolve;
  const ownerStarted = new Promise(resolve => { ownerStartedResolve = resolve; });
  const repository = {
    listCards: () => [card],
    getCard: id => {
      getCardCalls += 1;
      if (getCardCalls === 2) followerReachedResolve();
      return id === card.id ? card : null;
    },
    updateTts: (_id, update) => updates.push(update),
    recordPlayEvent: () => {},
  };
  const instance = createApp(serverDependencies({
    card, repository, ttsCacheDir, ttsConfigured: true,
    tts: {
      async synthesize() {
        synthCalls += 1;
        if (synthCalls > 1) throw new Error('follower failure must never run');
        ownerStartedResolve();
        await releaseOwner.promise;
        return audioPath;
      },
    },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());

  const firstResponse = fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  await ownerStarted;
  const secondResponse = fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  await followerReached;
  releaseOwner.resolve();
  const responses = await Promise.all([firstResponse, secondResponse]);

  assert.equal(synthCalls, 1);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.deepEqual(updates.map(update => update.status), ['pending', 'ready']);
  assert.equal(updates.some(update => update.status === 'failed'), false);
});

test('TTS retry failure returns and stores only the fixed public message', async t => {
  const card = fakeCard('retry-session');
  const updates = [];
  const upstreamDetail = 'provider 401 X-Api-Access-Key=credential-fragment /private/cache/raw.mp3';
  const repository = {
    listCards: () => [card],
    getCard: id => id === card.id ? card : null,
    updateTts: (_id, update) => updates.push(update),
    recordPlayEvent: () => {},
  };
  const instance = createApp(serverDependencies({
    card,
    repository,
    ttsConfigured: true,
    tts: { synthesize: async () => { throw new Error(upstreamDetail); } },
  }));
  const base = await listen(instance);
  t.after(() => instance.close());

  const events = [];
  const socket = new WebSocket(`${base.replace('http', 'ws')}/stream?sessionId=retry-session`);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', data => events.push(JSON.parse(data.toString())));

  const response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  const result = await response.json();
  await new Promise(resolve => setImmediate(resolve));
  const serialized = JSON.stringify({ result, updates });

  assert.equal(response.status, 503);
  assert.deepEqual(result, { error: PUBLIC_TTS_ERROR });
  assert.deepEqual(updates, [
    { status: 'pending', url: null, error: null },
    { status: 'failed', url: null, error: PUBLIC_TTS_ERROR },
  ]);
  assert.deepEqual(events.filter(event => event.type === 'tts-failed'), [{
    type: 'tts-failed', sessionId: 'retry-session', cardId: 'card-1',
    error: PUBLIC_TTS_ERROR,
  }]);
  assert.equal(serialized.includes(upstreamDetail), false);
  assert.doesNotMatch(serialized, /credential-fragment|X-Api-Access-Key|\/private\/cache|provider 401/);
});

test('serves status, presets, validates requests, and completes async jobs', async t => {
  const cards = new Map();
  const repository = {
    listCards: sessionId => [...cards.values()].filter(card => card.sessionId === sessionId),
    getCard: id => cards.get(id) || null,
    updateTts: () => {},
    recordPlayEvent: () => {},
  };
  const pipeline = {
    async generate(input) {
      const card = fakeCard(input.sessionId);
      cards.set(card.id, card);
      return card;
    },
  };
  const musicProvider = { name: 'demo', resolvePlaybackUrl: async id => `https://audio.test/${id}.mp3` };
  let resolvedLocation;
  const weatherResolver = async location => {
    resolvedLocation = location;
    return ({
    city: '', localTime: '2026-08-04T20:30:00+08:00', weather: '多云',
    temperatureC: 27.2, apparentTemperatureC: 29.1, source: 'automatic',
    });
  };
  const instance = createApp({ repository, pipeline, musicProvider, weatherResolver, demoMode: true, tts: { synthesize: async () => '/tmp/a.mp3' } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => instance.close());
  const base = `http://127.0.0.1:${instance.server.address().port}`;

  let response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'demo');

  response = await fetch(`${base}/api/environment-presets`);
  assert.equal((await response.json()).presets.length, 6);

  response = await fetch(`${base}/api/environment/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: 31.2, longitude: 121.5 }),
  });
  const automaticEnvironment = await response.json();
  assert.equal(response.status, 200);
  assert.equal(automaticEnvironment.weather, '多云');
  assert.deepEqual(resolvedLocation, { latitude: 31.2, longitude: 121.5 });
  assert.equal('latitude' in automaticEnvironment, false);
  assert.equal('longitude' in automaticEnvironment, false);

  response = await fetch(`${base}/api/environment/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: 999, longitude: 121.5 }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${base}/api/recommendations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', userInput: 'x'.repeat(501), environment: {} }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${base}/api/recommendations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', userInput: '来点音乐', environment: {} }),
  });
  assert.equal(response.status, 202);
  assert.ok((await response.json()).jobId);
  await new Promise(resolve => setTimeout(resolve, 20));

  response = await fetch(`${base}/api/cards?sessionId=s1`);
  assert.equal((await response.json()).cards[0].id, 'card-1');
  response = await fetch(`${base}/api/cards/card-1`);
  assert.equal((await response.json()).card.title, '这一刻');

  response = await fetch(`${base}/api/playback/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'demo', trackId: 'demo-001' }),
  });
  assert.equal((await response.json()).url, 'https://audio.test/demo-001.mp3');

  assert.equal((await fetch(`${base}/api/tts/../../README.md`)).status, 404);
  response = await fetch(`${base}/api/netease/status`);
  assert.equal((await response.json()).required, false);
});
