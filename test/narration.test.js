const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { NarrationController } = require('../pwa/narration');

test('browser build exposes NarrationController and loads between player and app', () => {
  const narrationPath = path.join(__dirname, '..', 'pwa', 'narration.js');
  const source = fs.readFileSync(narrationPath, 'utf8');
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  assert.equal(typeof context.window.NarrationController, 'function');

  const html = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'index.html'), 'utf8');
  const playerIndex = html.indexOf('<script src="/player.js"></script>');
  const narrationIndex = html.indexOf('<script src="/narration.js"></script>');
  const appIndex = html.indexOf('<script src="/app.js"></script>');
  assert.ok(playerIndex >= 0);
  assert.ok(narrationIndex > playerIndex);
  assert.ok(appIndex > narrationIndex);
});

function fakeAudio({ playError = null, playPromise = null } = {}) {
  const listeners = new Map();

  return {
    src: '',
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
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
      if (playPromise) await playPromise;
      this.paused = false;
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    emit(name) {
      for (const listener of [...(listeners.get(name) || [])]) listener();
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
  let resolvePlay;
  const firstPlay = new Promise(resolve => { resolvePlay = resolve; });
  const controller = new NarrationController({
    createAudio(url) {
      const audio = fakeAudio({ playPromise: firstPlay });
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

  resolvePlay();
  assert.equal(await firstAttempt, 'playing');
  assert.equal(await controller.autoplay(card), 'skipped');
  assert.equal(created.length, 1);
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
  assert.equal(narrationAudio.src, '/card.mp3');
  assert.equal(narrationAudio.playCalls, 1);
  assert.deepEqual(songPlayer, { src: '/song.mp3', paused: false, volume: 0.8 });
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

test('an active audio error reports failed and removes its listeners', async () => {
  const audio = fakeAudio();
  const card = readyCard('card');
  const controller = new NarrationController({ createAudio: () => audio });

  assert.equal(await controller.play(card), 'playing');
  audio.emit('error');

  assert.equal(card.ttsPlaybackStatus, 'failed');
  assert.equal(audio.listenerCount('ended'), 0);
  assert.equal(audio.listenerCount('error'), 0);
  controller.stop();
  assert.equal(audio.pauseCalls, 0);
});
