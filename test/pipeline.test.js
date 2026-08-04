const test = require('node:test');
const assert = require('node:assert/strict');

const { createRecommendationPipeline } = require('../src/recommendation/pipeline');

function plan(count, offset = 0) {
  return {
    intent: 'recommend',
    direction: { atmosphere: ['明亮', '清晰'], energy: '中高但不过强', rhythm: ['活跃', '稳定'] },
    title: '清醒一点，慢慢出发',
    description: '上海的早晨正在醒来，让困意里多一点明亮的推动。节奏会保持活跃和稳定，但不会过分吵闹。',
    candidates: Array.from({ length: count }, (_, index) => ({ title: `Song ${offset + index}`, artist: `Artist ${offset + index}` })),
  };
}

function harness({ playable = 20, previous = null, ttsRejects = false, ttsArtifact } = {}) {
  const events = [];
  const calls = [];
  let activeSearches = 0;
  let maxActiveSearches = 0;
  let saved;
  const repository = {
    listCards: () => previous ? [previous] : [],
    saveCard: card => { saved = card; return card; },
    updateTts: () => {},
  };
  const llm = {
    async generatePlan(input) {
      calls.push(input);
      return calls.length === 1 ? plan(40) : plan(30, 100);
    },
  };
  const musicProvider = {
    name: 'fake',
    async searchTrack(title, artist) {
      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
      await Promise.resolve();
      activeSearches -= 1;
      const index = Number(title.replace('Song ', ''));
      if (index >= playable && index < 100) return null;
      return { id: `id-${index}`, title, artist, provider: 'fake', album: '', durationMs: 180000 };
    },
    async checkPlayable() { return true; },
  };
  const pipeline = createRecommendationPipeline({
    repository,
    llm,
    musicProvider,
    tts: {
      synthesize: async () => ttsRejects
        ? Promise.reject(new Error('tts offline'))
        : '/tmp/0123456789abcdef0123456789abcdef.mp3',
    },
    ttsArtifact: ttsArtifact || {
      root: '/tmp',
      validateArtifactPath: async filePath => ({ filename: filePath.split('/').pop() }),
    },
    emit: event => events.push(event),
    now: () => new Date('2026-08-01T00:20:00.000Z'),
  });
  return { pipeline, events, calls, saved: () => saved, maxActiveSearches: () => maxActiveSearches };
}

test('requires an explicit TTS artifact validator', () => {
  const { pipeline } = harness();
  assert.throws(
    () => createRecommendationPipeline({ ...pipeline.dependencies, ttsArtifact: undefined }),
    /TTS artifact|validator/i
  );
});

test('passes the trusted cache root to TTS synthesis', async () => {
  const { pipeline } = harness();
  let synthesisOptions;
  pipeline.dependencies.tts.synthesize = async (_text, options) => {
    synthesisOptions = options;
    return '/tmp/0123456789abcdef0123456789abcdef.mp3';
  };

  await pipeline.generate({ sessionId: 's1', userInput: '来点音乐', environment: {} });

  assert.deepEqual(synthesisOptions, { role: 'recommendation', cacheDir: '/tmp' });
});

test('emits documented stage order and persists the default 8-track card', async () => {
  const { pipeline, events, calls, saved, maxActiveSearches } = harness();
  const card = await pipeline.generate({ sessionId: 's1', userInput: '提神但别太吵', environment: { city: '上海', weather: '晴朗' } });
  assert.equal(calls[0].candidateCount, 32);
  assert.equal(calls.length, 1);
  assert.equal(card.tracks.length, 8);
  assert.equal(maxActiveSearches(), 2);
  assert.equal(saved().id, card.id);
  assert.deepEqual(events.filter(event => event.type === 'progress').map(event => event.stage), [
    'understanding', 'candidates', 'validating', 'composing',
  ]);
  assert.ok(events.some(event => event.type === 'complete'));
});

test('does not call the model again and reports an honest under-8 warning', async () => {
  const { pipeline, calls } = harness({ playable: 5 });
  const card = await pipeline.generate({ sessionId: 's1', userInput: '来点音乐', environment: {} });
  assert.equal(calls.length, 1);
  assert.equal(card.tracks.length, 5);

  const under = harness({ playable: 0 });
  under.pipeline.dependencies.musicProvider.searchTrack = async () => null;
  const sparse = await under.pipeline.generate({ sessionId: 's2', userInput: '来点音乐', environment: {} });
  assert.equal(under.calls.length, 1);
  assert.equal(sparse.tracks.length, 0);
  assert.match(sparse.warning, /暂时只找到/);
});

test('refinement excludes previous tracks and TTS failure does not reject the card', async () => {
  const previous = {
    id: 'previous',
    direction: { atmosphere: ['清晰'], energy: '中等', rhythm: ['稳定'] },
    tracks: [{ id: 'id-1', title: 'Old', artist: 'Artist' }],
  };
  const { pipeline, calls, events } = harness({ previous, ttsRejects: true });
  const card = await pipeline.generate({ sessionId: 's1', userInput: '再轻松一点', environment: {} });
  assert.equal(card.intent, 'refine');
  assert.ok(calls[0].excludeTracks.includes('id-1'));
  assert.equal(card.ttsError, '推荐语音暂不可用，可稍后重试。');
  assert.deepEqual(events.find(event => event.type === 'tts-failed'), {
    sessionId: 's1', type: 'tts-failed', cardId: card.id,
    error: '推荐语音暂不可用，可稍后重试。',
  });
});

test('rejects a synthesized path that fails the artifact trust boundary', async () => {
  const upstreamDetail = 'outside cache /private/credential-fragment.mp3';
  const { pipeline, events } = harness({
    ttsArtifact: {
      root: '/tmp',
      validateArtifactPath: async () => { throw new Error(upstreamDetail); },
    },
  });

  const card = await pipeline.generate({ sessionId: 's1', userInput: '来点音乐', environment: {} });

  assert.equal(card.ttsStatus, 'failed');
  assert.equal(card.ttsUrl, null);
  assert.equal(card.ttsError, '推荐语音暂不可用，可稍后重试。');
  assert.equal(JSON.stringify(events).includes(upstreamDetail), false);
});
