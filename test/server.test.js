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

test('TTS retry publishes one ready update and returns a servable MP3 URL', async t => {
  const card = fakeCard('retry-session');
  const ttsCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-tts-cache-test-'));
  const audio = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x54, 0x54, 0x53]);
  const audioPath = path.join(ttsCacheDir, 'retry_voice.mp3');
  fs.writeFileSync(audioPath, audio);
  t.after(() => fs.rmSync(ttsCacheDir, { recursive: true, force: true }));
  const updates = [];
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
    tts: { synthesize: async () => audioPath },
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
  assert.deepEqual(result, { ttsStatus: 'ready', ttsUrl: '/api/tts/retry_voice.mp3' });
  assert.deepEqual(updates, [{ status: 'ready', url: '/api/tts/retry_voice.mp3', error: null }]);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/api/tts/retry_voice.mp3');
  assert.deepEqual(events.filter(event => event.type === 'tts-ready'), [{
    type: 'tts-ready', sessionId: 'retry-session', cardId: 'card-1',
    ttsUrl: '/api/tts/retry_voice.mp3',
  }]);

  const audioResponse = await fetch(`${base}${result.ttsUrl}`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), audio);
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

  const response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
  const result = await response.json();
  const serialized = JSON.stringify({ result, updates });

  assert.equal(response.status, 503);
  assert.deepEqual(result, { error: PUBLIC_TTS_ERROR });
  assert.deepEqual(updates, [{ status: 'failed', error: PUBLIC_TTS_ERROR }]);
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
