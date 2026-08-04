const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RequestGate, TtsState, PollController, reconcileCard, narrationView, captureCardUiState, restoreCardUiState,
  selectGenerationCards, syncNarrationControl, activateNarrationControl,
} = require('../pwa/app-model');

test('request gate aborts the previous selection and rejects stale ownership', () => {
  const controllers = [];
  const gate = new RequestGate({
    createAbortController() {
      const controller = { signal: {}, aborted: false, abort() { this.aborted = true; } };
      controllers.push(controller);
      return controller;
    },
  });

  const first = gate.begin('card-1', 'track-1');
  const second = gate.begin('card-1', 'track-2');

  assert.equal(controllers[0].aborted, true);
  assert.equal(gate.owns(first, 'card-1', 'track-1'), false);
  assert.equal(gate.owns(second, 'card-1', 'track-2'), true);
  assert.equal(gate.owns(second, 'card-2', 'track-2'), false);
});

test('request gate remains usable when AbortController is unavailable', () => {
  const gate = new RequestGate({ createAbortController: () => { throw new Error('unsupported'); } });

  const request = gate.begin('card-1', 'track-1');

  assert.equal(request.signal, undefined);
  assert.equal(gate.owns(request, 'card-1', 'track-1'), true);
  gate.invalidate();
  assert.equal(gate.owns(request, 'card-1', 'track-1'), false);
});

test('out-of-order resolve completion commits only the current selection', async () => {
  const gate = new RequestGate({ createAbortController: () => null });
  const pending = [];
  const commits = [];
  const deferred = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const settle = async (request, promise) => {
    try {
      const value = await promise;
      if (gate.owns(request, request.cardId, request.trackId)) commits.push(value);
    } catch (error) {
      if (gate.owns(request, request.cardId, request.trackId)) commits.push(error.message);
    }
  };

  const first = gate.begin('card-1', 'track-1');
  const firstSettle = settle(first, deferred());
  const second = gate.begin('card-1', 'track-2');
  const secondSettle = settle(second, deferred());
  pending[1].resolve('second-url');
  pending[0].reject(new Error('stale failure'));
  await Promise.all([firstSettle, secondSettle]);

  assert.deepEqual(commits, ['second-url']);
});

test('ready reduction is idempotent and never overwrites playback state', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'pending', ttsUrl: null, ttsPlaybackStatus: 'playing' };

  const first = tts.applyReady(card, '/voice.mp3');
  const duplicate = tts.applyReady(card, '/voice.mp3');

  assert.deepEqual(first, { accepted: true, becameReady: true });
  assert.deepEqual(duplicate, { accepted: true, becameReady: false });
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/voice.mp3');
  assert.equal(card.ttsPlaybackStatus, 'playing');
});

test('an already-ready completed card still creates one reducer transition', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'ready', ttsUrl: '/voice.mp3' };

  assert.equal(tts.applyReady(card, card.ttsUrl).becameReady, true);
  assert.equal(tts.applyReady(card, card.ttsUrl).becameReady, false);
});

test('autoplay initiation can be claimed only once per ready URL', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'pending', ttsUrl: null };
  tts.applyReady(card, '/voice.mp3');

  assert.equal(tts.claimAutoplay(card), true);
  assert.equal(tts.claimAutoplay(card), false);
  const retryToken = tts.beginRetry(card);
  tts.applyReady(card, '/voice-2.mp3', { retryToken });
  assert.equal(tts.claimAutoplay(card), true);
});

test('retry generations reject stale successes and failures', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'failed', ttsUrl: null, ttsError: 'offline' };
  const first = tts.beginRetry(card);
  const second = tts.beginRetry(card);

  assert.equal(tts.applyReady(card, '/old.mp3', { retryToken: first }).accepted, false);
  assert.equal(tts.applyFailed(card, 'old failure', { retryToken: first }).accepted, false);
  assert.equal(card.ttsStatus, 'pending');
  assert.deepEqual(tts.applyReady(card, '/new.mp3', { retryToken: second }), { accepted: true, becameReady: true });
  assert.equal(tts.applyFailed(card, 'late failure', { retryToken: first }).accepted, false);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/new.mp3');
});

test('socket synthesis events defer to an active retry response', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'failed', ttsUrl: null };
  const retryToken = tts.beginRetry(card);

  assert.equal(tts.applyReady(card, '/socket.mp3').accepted, false);
  assert.equal(card.ttsStatus, 'pending');
  assert.equal(tts.applyReady(card, '/response.mp3', { retryToken }).accepted, true);
  assert.equal(card.ttsUrl, '/response.mp3');
});

test('malformed ready responses do not consume current retry ownership', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'failed', ttsUrl: null, ttsError: 'offline' };
  const retryToken = tts.beginRetry(card);

  assert.equal(tts.applyReady(card, '   ', { retryToken }).accepted, false);
  assert.equal(tts.applyReady(card, 'javascript:alert(1)', { retryToken }).accepted, false);
  assert.equal(tts.hasActiveRetry(card.id), true);
  assert.equal(card.ttsStatus, 'pending');
  assert.equal(card.ttsUrl, null);

  assert.deepEqual(
    tts.applyReady(card, '/api/tts/voice.mp3', { retryToken }),
    { accepted: true, becameReady: true },
  );
  assert.equal(tts.hasActiveRetry(card.id), false);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/api/tts/voice.mp3');
});

test('reconciliation preserves identity, playback state, and monotonic ready synthesis', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', title: 'Old', ttsStatus: 'pending', ttsUrl: null, ttsPlaybackStatus: 'playing' };
  const identity = card;
  tts.applyReady(card, '/voice.mp3');

  const result = reconcileCard(card, {
    id: 'card-1', title: 'Fresh metadata', ttsStatus: 'pending', ttsUrl: null, ttsPlaybackStatus: undefined,
  }, tts);

  assert.equal(result, identity);
  assert.equal(card.title, 'Fresh metadata');
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/voice.mp3');
  assert.equal(card.ttsPlaybackStatus, 'playing');
});

test('a failed event remains terminal when a stale poll snapshot still says pending', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'pending', ttsUrl: null, ttsError: null };
  tts.applyFailed(card, 'provider unavailable');

  reconcileCard(card, {
    id: 'card-1', ttsStatus: 'pending', ttsUrl: null, ttsError: null,
  }, tts);

  assert.equal(card.ttsStatus, 'failed');
  assert.equal(card.ttsUrl, null);
  assert.equal(card.ttsError, 'provider unavailable');
});

test('event and poll interleavings preserve terminal state while current retries can resolve', () => {
  const tts = new TtsState();
  const card = { id: 'card-1', ttsStatus: 'pending', ttsUrl: null, ttsError: null };
  tts.applyReady(card, '/event-ready.mp3');
  reconcileCard(card, { id: 'card-1', ttsStatus: 'pending', ttsUrl: null }, tts);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/event-ready.mp3');

  const failedRetry = tts.beginRetry(card);
  assert.equal(card.ttsStatus, 'pending');
  reconcileCard(card, { id: 'card-1', ttsStatus: 'ready', ttsUrl: '/stale.mp3' }, tts);
  assert.equal(card.ttsStatus, 'pending');
  assert.equal(tts.applyFailed(card, 'retry failed', { retryToken: failedRetry }).accepted, true);
  reconcileCard(card, { id: 'card-1', ttsStatus: 'pending', ttsUrl: null }, tts);
  assert.equal(card.ttsStatus, 'failed');
  assert.equal(card.ttsError, 'retry failed');

  const readyRetry = tts.beginRetry(card);
  assert.equal(tts.applyReady(card, '/retry-ready.mp3', { retryToken: readyRetry }).accepted, true);
  assert.equal(card.ttsStatus, 'ready');
  assert.equal(card.ttsUrl, '/retry-ready.mp3');
});

test('narration view distinguishes synthesis retry from playback replay', () => {
  assert.deepEqual(
    narrationView({ ttsStatus: 'failed', ttsUrl: null, ttsPlaybackStatus: 'failed' }),
    { label: '重试推荐语', disabled: false, action: 'retry', statusText: '推荐语生成失败' },
  );
  assert.deepEqual(
    narrationView({ ttsStatus: 'ready', ttsUrl: '/voice.mp3', ttsPlaybackStatus: 'failed' }),
    { label: '重新播放推荐语', disabled: false, action: 'play', statusText: '推荐语播放失败' },
  );
});

test('narration control keeps focus and ignores activation while aria-disabled', () => {
  const document = { activeElement: null };
  const attributes = new Map();
  const control = {
    disabled: false,
    textContent: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) || null; },
    focus() { document.activeElement = this; },
  };
  const card = { id: 'card-1', ttsStatus: 'ready', ttsUrl: '/voice.mp3', ttsPlaybackStatus: 'ready' };
  const calls = [];

  syncNarrationControl(control, narrationView(card));
  control.focus();
  card.ttsPlaybackStatus = 'playing';
  syncNarrationControl(control, narrationView(card));
  const activated = activateNarrationControl(card, {
    play: () => calls.push('play'),
    retry: () => calls.push('retry'),
  });

  assert.equal(document.activeElement, control);
  assert.equal(control.disabled, false);
  assert.equal(control.getAttribute('aria-disabled'), 'true');
  assert.equal(control.textContent, '正在播放推荐语');
  assert.equal(activated, false);
  assert.deepEqual(calls, []);
});

test('poll controller retries with backoff and completes after a later success', async () => {
  const scheduled = [];
  const delays = [];
  const outcomes = [{ done: false }, new Error('offline'), { done: true, value: 'card' }];
  const completions = [];
  const exhausted = [];
  const poller = new PollController({
    task: async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    schedule(callback, delay) { scheduled.push(callback); delays.push(delay); return callback; },
    cancelSchedule() {},
    retryDelays: [10, 20, 40],
    onComplete: value => completions.push(value),
    onExhausted: error => exhausted.push(error),
  });

  poller.start(5);
  while (scheduled.length) {
    scheduled.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.deepEqual(delays, [5, 10, 20]);
  assert.deepEqual(completions, ['card']);
  assert.deepEqual(exhausted, []);
  assert.equal(poller.active, false);
});

test('poll controller exhausts its budget once and becomes inactive', async () => {
  const scheduled = [];
  const exhausted = [];
  const poller = new PollController({
    task: async () => { throw new Error('still offline'); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancelSchedule() {},
    retryDelays: [10, 20],
    onExhausted: error => exhausted.push(error.message),
  });

  poller.start();
  while (scheduled.length) {
    scheduled.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.deepEqual(exhausted, ['still offline']);
  assert.equal(poller.attempts, 3);
  assert.equal(poller.active, false);
});

test('card UI capture and restore preserves open, expanded, and focused controls', () => {
  const document = { activeElement: null };
  function control(key, extra = {}) {
    return {
      dataset: { uiKey: key, ...extra },
      focus() { document.activeElement = this; },
      closest() { return this.card; },
    };
  }
  function card(id, { open = false, expanded = false } = {}) {
    const reason = { dataset: { uiKey: 'reason' }, open };
    const expander = control('tracks', { expanded: String(expanded) });
    const narration = control('narration');
    const value = {
      dataset: { cardId: id }, reason, expander, narration,
      querySelectorAll(selector) {
        if (selector === 'details[data-ui-key]') return [reason];
        if (selector === '[data-ui-key][data-expanded]') return [expander];
        if (selector === '[data-ui-key]') return [reason, expander, narration];
        return [];
      },
    };
    expander.card = value;
    narration.card = value;
    return value;
  }
  const before = card('card-1', { open: true, expanded: true });
  document.activeElement = before.narration;
  const oldRoot = { ownerDocument: document, querySelectorAll: () => [before] };
  const snapshot = captureCardUiState(oldRoot);
  const after = card('card-1');
  const newRoot = { ownerDocument: document, querySelectorAll: () => [after] };
  const restoredExpanded = [];

  restoreCardUiState(newRoot, snapshot, {
    onExpanded: (element, expanded) => restoredExpanded.push([element.dataset.uiKey, expanded]),
  });

  assert.equal(after.reason.open, true);
  assert.equal(after.expander.dataset.expanded, 'true');
  assert.deepEqual(restoredExpanded, [['tracks', true]]);
  assert.equal(document.activeElement, after.narration);
});

test('failed hydration never attributes a recently created historical card to fallback generation', () => {
  const historical = {
    id: 'old-card', createdAt: '2026-08-05T09:59:57.000Z', ttsStatus: 'ready', ttsUrl: '/old.mp3',
  };

  assert.equal(typeof selectGenerationCards, 'function');
  assert.deepEqual(selectGenerationCards([historical], { historyHydrated: false }), []);
});

test('failed hydration renders a newly observed ready card as manual-only', () => {
  const readyCard = {
    id: 'new-card', createdAt: '2026-08-05T10:00:01.000Z', ttsStatus: 'ready', ttsUrl: '/new.mp3',
  };

  assert.equal(typeof selectGenerationCards, 'function');
  assert.deepEqual(selectGenerationCards([readyCard], { historyHydrated: false }), []);
  assert.deepEqual(narrationView(readyCard), {
    label: '播放推荐语', disabled: false, action: 'play', statusText: '推荐语已就绪',
  });
  assert.deepEqual(selectGenerationCards([readyCard], { historyHydrated: true }), [readyCard]);
});
