const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { NarrationController } = require('../pwa/narration');

test('browser build exposes NarrationController', () => {
  const narrationPath = path.join(__dirname, '..', 'pwa', 'narration.js');
  const source = fs.readFileSync(narrationPath, 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  assert.equal(typeof context.window.NarrationController, 'function');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeAudio({
  playError = null,
  playPromise = null,
  pauseError = null,
  removeSourceError = null,
  loadError = null,
} = {}) {
  const listeners = new Map();

  return {
    src: '',
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    removeAttributeCalls: 0,
    loadCalls: 0,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    async play() {
      this.playCalls += 1;
      if (playError) throw playError;
      this.paused = false;
      if (playPromise) await playPromise;
    },
    pause() {
      this.pauseCalls += 1;
      if (pauseError) throw pauseError;
      this.paused = true;
    },
    removeAttribute(name) {
      this.removeAttributeCalls += 1;
      if (removeSourceError) throw removeSourceError;
      if (name === 'src') this.src = '';
    },
    load() {
      this.loadCalls += 1;
      if (loadError) throw loadError;
    },
    emit(name) {
      if (name === 'ended') this.paused = true;
      for (const listener of [...(listeners.get(name) || [])]) listener();
    },
    listeners(name) {
      return [...(listeners.get(name) || [])];
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
  };
}

function readyCard(id, ttsUrl = `/${id}.mp3`) {
  return { id, ttsStatus: 'ready', ttsUrl };
}

test('autoplay handles only the latest ready card once, including concurrent callbacks', async () => {
  const created = [];
  const pendingPlay = deferred();
  const controller = new NarrationController({
    createAudio(url) {
      const audio = fakeAudio({ playPromise: pendingPlay.promise });
      audio.src = url;
      created.push(audio);
      return audio;
    },
  });

  controller.setLatestCardId('new');
  assert.equal(await controller.autoplay(readyCard('old')), 'skipped');

  const card = readyCard('new');
  const firstAttempt = controller.autoplay(card);
  const duplicateAttempt = controller.autoplay(card);

  assert.equal(await duplicateAttempt, 'skipped');
  assert.equal(created.length, 1);
  assert.equal(created[0].playCalls, 1);

  pendingPlay.resolve();
  assert.equal(await firstAttempt, 'playing');
  assert.equal(await controller.autoplay(card), 'skipped');
  assert.equal(created.length, 1);
});

test('changing the latest card invalidates and disposes its pending autoplay', async () => {
  const pendingPlay = deferred();
  const audio = fakeAudio({ playPromise: pendingPlay.promise });
  audio.src = '/old.mp3';
  const oldCard = readyCard('old');
  const controller = new NarrationController({ createAudio: () => audio });

  controller.setLatestCardId(oldCard.id);
  const attempt = controller.autoplay(oldCard);
  controller.setLatestCardId('new');

  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.src, '');
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('error'), 0);

  pendingPlay.resolve();
  assert.equal(await attempt, 'stopped');
  assert.equal(oldCard.ttsPlaybackStatus, undefined);
});

test('automatic-attempt bookkeeping remains bounded to the latest card', async () => {
  const controller = new NarrationController({ isSongPlaying: () => true });
  const firstCard = readyCard('first');
  const secondCard = readyCard('second');

  controller.setLatestCardId(firstCard.id);
  assert.equal(await controller.autoplay(firstCard), 'skipped');
  assert.deepEqual([...controller.autoHandled], ['first']);

  controller.setLatestCardId(secondCard.id);
  assert.deepEqual([...controller.autoHandled], []);
  assert.equal(await controller.autoplay(secondCard), 'skipped');
  controller.setLatestCardId(secondCard.id);
  assert.deepEqual([...controller.autoHandled], ['second']);
});

test('a missing or pending TTS URL does not consume the later ready autoplay opportunity', async () => {
  const urls = [];
  const controller = new NarrationController({
    createAudio(url) {
      urls.push(url);
      return fakeAudio();
    },
  });
  controller.setLatestCardId('card');

  const card = { id: 'card', ttsStatus: 'pending', ttsUrl: null };
  assert.equal(await controller.autoplay(card), 'skipped');
  card.ttsUrl = '/too-early.mp3';
  assert.equal(await controller.autoplay(card), 'skipped');

  card.ttsStatus = 'ready';
  card.ttsUrl = '/ready.mp3';
  assert.equal(await controller.autoplay(card), 'playing');
  assert.deepEqual(urls, ['/ready.mp3']);
});

test('song playback has priority and consumes the automatic narration opportunity', async () => {
  const songPlayer = { paused: false, src: '/song.mp3' };
  let narrationCreated = 0;
  const controller = new NarrationController({
    createAudio() {
      narrationCreated += 1;
      return fakeAudio();
    },
    isSongPlaying: () => !songPlayer.paused,
  });
  const card = readyCard('card');
  controller.setLatestCardId(card.id);

  assert.equal(await controller.autoplay(card), 'skipped');
  songPlayer.paused = true;
  assert.equal(await controller.autoplay(card), 'skipped');
  assert.equal(narrationCreated, 0);
  assert.deepEqual(songPlayer, { paused: true, src: '/song.mp3' });
});

test('policy-blocked autoplay can be retried manually and returns to ready when ended', async () => {
  const states = [];
  const blockedAudio = fakeAudio({ playError: Object.assign(new Error('play() failed'), { name: 'NotAllowedError' }) });
  const manualAudio = fakeAudio();
  const audios = [blockedAudio, manualAudio];
  const card = readyCard('card');
  const controller = new NarrationController({
    createAudio: () => audios.shift(),
    onStateChange(changedCard, status) {
      states.push([changedCard.id, status]);
    },
  });
  controller.setLatestCardId(card.id);

  assert.equal(await controller.autoplay(card), 'blocked');
  assert.equal(card.ttsPlaybackStatus, 'blocked');
  assert.equal(await controller.play(card), 'playing');
  assert.equal(card.ttsPlaybackStatus, 'playing');
  manualAudio.emit('ended');
  assert.equal(card.ttsPlaybackStatus, 'ready');
  assert.deepEqual(states, [['card', 'blocked'], ['card', 'playing'], ['card', 'ready']]);
});

test('classifies only known browser interaction policy failures as blocked', async t => {
  const blockedErrors = [
    Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    Object.assign(new Error('sandbox denied'), { name: 'SecurityError' }),
    new Error("play() failed because the user didn't interact with the document first"),
    new Error('Playback requires a user gesture'),
  ];
  const genericErrors = [
    new Error('autoplay service timed out'),
    new Error('upstream response mentioned NotAllowedError'),
    Object.assign(new Error('request aborted'), { name: 'AbortError' }),
    Object.assign(new Error('network unavailable'), { name: 'NetworkError' }),
  ];

  for (const [index, error] of blockedErrors.entries()) {
    await t.test(`blocked ${index + 1}: ${error.name}`, async () => {
      const audio = fakeAudio({ playError: error });
      audio.src = '/voice.mp3';
      const card = readyCard(`blocked-${index}`);
      const controller = new NarrationController({ createAudio: () => audio });
      assert.equal(await controller.play(card), 'blocked');
      assert.equal(card.ttsPlaybackStatus, 'blocked');
      assert.equal(audio.src, '');
      assert.equal(audio.listenerCount('ended'), 0);
      assert.equal(audio.listenerCount('error'), 0);
    });
  }

  for (const [index, error] of genericErrors.entries()) {
    await t.test(`failed ${index + 1}: ${error.name}`, async () => {
      const audio = fakeAudio({ playError: error });
      audio.src = '/voice.mp3';
      const card = readyCard(`failed-${index}`);
      const controller = new NarrationController({ createAudio: () => audio });
      assert.equal(await controller.play(card), 'failed');
      assert.equal(card.ttsPlaybackStatus, 'failed');
      assert.equal(audio.src, '');
      assert.equal(audio.listenerCount('ended'), 0);
      assert.equal(audio.listenerCount('error'), 0);
    });
  }
});

test('throwing state observers cannot reject autoplay or release its active audio', async () => {
  const reports = [];
  const unhandled = [];
  const audio = fakeAudio();
  audio.src = '/card.mp3';
  const card = readyCard('card');
  const controller = new NarrationController({
    createAudio: () => audio,
    onStateChange() { throw new Error('state observer failed'); },
    onStatus() { throw new Error('status observer failed'); },
    onObserverError(error, observer) { reports.push([observer, error.message]); },
  });
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    controller.setLatestCardId(card.id);
    void controller.autoplay(card);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
    assert.equal(card.ttsPlaybackStatus, 'playing');
    controller.stop();
    assert.equal(audio.pauseCalls, 1);
    assert.equal(card.ttsPlaybackStatus, 'ready');
    assert.deepEqual(reports, [
      ['onStateChange', 'state observer failed'],
      ['onStatus', 'status observer failed'],
      ['onStateChange', 'state observer failed'],
      ['onStatus', 'status observer failed'],
    ]);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('manual narration uses its own audio, reports generic failure, and never mutates the song player', async () => {
  const songPlayer = { src: '/song.mp3', paused: false, volume: 0.8 };
  const narrationAudio = fakeAudio({ playError: new Error('network failed') });
  const card = readyCard('card');
  const controller = new NarrationController({
    createAudio(url) {
      narrationAudio.src = url;
      return narrationAudio;
    },
    isSongPlaying: () => !songPlayer.paused,
  });

  assert.equal(await controller.play(card), 'failed');
  assert.equal(card.ttsPlaybackStatus, 'failed');
  assert.equal(narrationAudio.src, '');
  assert.equal(narrationAudio.playCalls, 1);
  assert.deepEqual(songPlayer, { src: '/song.mp3', paused: false, volume: 0.8 });
});

test('stop safely disposes a pending play before its promise resolves', async () => {
  const pendingPlay = deferred();
  const audio = fakeAudio({ playPromise: pendingPlay.promise });
  audio.src = '/card.mp3';
  const card = readyCard('card');
  const controller = new NarrationController({ createAudio: () => audio });

  const attempt = controller.play(card);
  controller.stop();
  pendingPlay.resolve();

  assert.equal(await attempt, 'stopped');
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.src, '');
  assert.equal(card.ttsPlaybackStatus, undefined);
});

test('a pending play cannot overwrite a newer manual play when it resolves', async () => {
  const pendingPlay = deferred();
  const firstAudio = fakeAudio({ playPromise: pendingPlay.promise });
  const secondAudio = fakeAudio();
  const audios = [firstAudio, secondAudio];
  const firstCard = readyCard('first');
  const secondCard = readyCard('second');
  const controller = new NarrationController({ createAudio: () => audios.shift() });

  const firstAttempt = controller.play(firstCard);
  assert.equal(await controller.play(secondCard), 'playing');
  pendingPlay.resolve();

  assert.equal(await firstAttempt, 'stopped');
  assert.equal(firstCard.ttsPlaybackStatus, undefined);
  assert.equal(secondCard.ttsPlaybackStatus, 'playing');
  assert.equal(firstAudio.pauseCalls, 1);
  controller.stop();
  assert.equal(secondAudio.pauseCalls, 1);
});

test('stop pauses and clears active narration, resets playing state, and is idempotent', async () => {
  const states = [];
  const audio = fakeAudio();
  const card = readyCard('card');
  const controller = new NarrationController({
    createAudio(url) {
      audio.src = url;
      return audio;
    },
    onStateChange(changedCard, status) {
      states.push([changedCard.id, status]);
    },
  });

  assert.equal(await controller.play(card), 'playing');
  controller.stop();
  controller.stop();

  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.src, '');
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('error'), 0);
  assert.equal(card.ttsPlaybackStatus, 'ready');
  assert.deepEqual(states, [['card', 'playing'], ['card', 'ready']]);
});

test('ended returns the active card to ready and stale audio events cannot change newer state', async () => {
  const states = [];
  const firstAudio = fakeAudio();
  const secondAudio = fakeAudio();
  const audios = [firstAudio, secondAudio];
  const firstCard = readyCard('first');
  const secondCard = readyCard('second');
  const controller = new NarrationController({
    createAudio: () => audios.shift(),
    onStateChange(card, status) {
      states.push([card.id, status]);
    },
  });

  assert.equal(await controller.play(firstCard), 'playing');
  assert.equal(await controller.play(secondCard), 'playing');
  firstAudio.emit('ended');
  firstAudio.emit('error');
  assert.equal(secondCard.ttsPlaybackStatus, 'playing');

  secondAudio.emit('ended');
  assert.equal(secondCard.ttsPlaybackStatus, 'ready');
  assert.equal(secondAudio.listenerCount('ended'), 0);
  assert.equal(secondAudio.listenerCount('error'), 0);
  assert.deepEqual(states, [
    ['first', 'playing'],
    ['first', 'ready'],
    ['second', 'playing'],
    ['second', 'ready'],
  ]);
});

test('captured stale handler identities cannot dispose or update newer narration', async () => {
  const states = [];
  const firstAudio = fakeAudio();
  const secondAudio = fakeAudio();
  const audios = [firstAudio, secondAudio];
  const firstCard = readyCard('first');
  const secondCard = readyCard('second');
  const controller = new NarrationController({
    createAudio: () => audios.shift(),
    onStateChange(card, status) { states.push([card.id, status]); },
  });

  assert.equal(await controller.play(firstCard), 'playing');
  const [staleEnded] = firstAudio.listeners('ended');
  const [staleError] = firstAudio.listeners('error');
  assert.equal(await controller.play(secondCard), 'playing');
  const stateCount = states.length;

  staleEnded();
  staleError();

  assert.equal(states.length, stateCount);
  assert.equal(secondCard.ttsPlaybackStatus, 'playing');
  controller.stop();
  assert.equal(secondAudio.pauseCalls, 1);
});

test('media cleanup failures are contained and do not reject playback failure handling', async () => {
  const audio = fakeAudio({
    playError: new Error('network failed'),
    pauseError: new Error('pause failed'),
    removeSourceError: new Error('remove src failed'),
    loadError: new Error('load failed'),
  });
  audio.src = '/card.mp3';
  const card = readyCard('card');
  const controller = new NarrationController({ createAudio: () => audio });

  assert.equal(await controller.play(card), 'failed');
  assert.equal(card.ttsPlaybackStatus, 'failed');
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('error'), 0);
  assert.equal(audio.removeAttributeCalls, 1);
  assert.equal(audio.loadCalls, 1);
  assert.equal(audio.src, '');
});

test('an active audio error reports failed and removes its listeners', async () => {
  const audio = fakeAudio();
  const card = readyCard('card');
  const controller = new NarrationController({ createAudio: () => audio });

  assert.equal(await controller.play(card), 'playing');
  audio.emit('error');

  assert.equal(card.ttsPlaybackStatus, 'failed');
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('error'), 0);
  assert.equal(audio.src, '');
  controller.stop();
  assert.equal(audio.pauseCalls, 1);
});
