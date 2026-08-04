const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop UI is structured as an accessible card conversation', () => {
  const html = read('pwa/index.html');

  assert.match(html, /id="conversationFeed"/);
  assert.match(html, /class="composer-dock"/);
  assert.match(html, /<details[^>]*class="environment-disclosure"/);
  assert.match(html, /id="progressPanel"[^>]*aria-live="polite"/);
  assert.match(html, /id="momentInput"[^>]*maxlength="500"/);
  assert.doesNotMatch(html, /class="opening"/);
});

test('conversation cards expose artwork, user prompts, rationale and playback state', () => {
  const app = read('pwa/app.js');

  assert.match(app, /message-user/);
  assert.match(app, /message-meta/);
  assert.match(app, /recommendation-copy/);
  assert.match(app, /track-cover/);
  assert.match(app, /recommendation-reason/);
  assert.match(app, /is-current/);
  assert.match(app, /dataset\.userPrompt/);
});

test('environment UI attempts private automatic weather and keeps manual fallback', () => {
  const html = read('pwa/index.html');
  const app = read('pwa/app.js');

  assert.match(html, /id="environmentSource"/);
  assert.match(html, /id="temperatureValue"/);
  assert.match(app, /navigator\.geolocation/);
  assert.match(app, /\/api\/environment\/resolve/);
  assert.match(app, /apparentTemperatureC/);
  assert.match(app, /source:\s*['"]manual['"]/);
});

test('visual layer defines tokens, desktop conversation and focus affordances', () => {
  const css = read('pwa/styles.css');

  assert.match(css, /--accent-violet:/);
  assert.match(css, /--card-radius:/);
  assert.match(css, /\.conversation-feed/);
  assert.match(css, /\.message-user/);
  assert.match(css, /\.composer-dock/);
  assert.match(css, /\.track-cover/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 1024px\)/);
});

test('frontend loads player, narration, then application scripts', () => {
  const html = read('pwa/index.html');
  const scripts = [...html.matchAll(/<script src="\/(player|narration|app-model|app)\.js"><\/script>/g)].map(match => match[1]);

  assert.deepEqual(scripts, ['player', 'narration', 'app-model', 'app']);
});

test('track resolution is abortable and every asynchronous mutation is ownership-gated', () => {
  const app = read('pwa/app.js');
  const playback = app.slice(app.indexOf('async function playCurrent()'), app.indexOf('function nextTrack()'));

  assert.match(app, /new RequestGate\(\)/);
  assert.match(playback, /stopSong\(\)[\s\S]*selectionGate\.begin\(cardId, track\.id\)/);
  assert.match(playback, /signal:\s*request\.signal/);
  assert.ok((playback.match(/ownsCurrentSelection\(request\)/g) || []).length >= 3);
  assert.match(playback, /if \(!ownsCurrentSelection\(request\)\) return;[\s\S]*updatePlayer\(track\)/);
  assert.match(playback, /catch \(error\)\s*\{\s*if \(!ownsCurrentSelection\(request\)\) return;/);
});

test('music controls are manual-only and a song click stops narration', () => {
  const html = read('pwa/index.html');
  const app = read('pwa/app.js');
  const css = read('pwa/styles.css');

  assert.doesNotMatch(html, /ttsFirstToggle|tts-switch|\u64ad\u653e\u5168\u90e8/);
  assert.doesNotMatch(app, /ttsFirst|playAllCard|playAllSequence|speakCard|browserSpeak|speechSynthesis|SpeechSynthesisUtterance/);
  assert.doesNotMatch(css, /tts-switch|play-all/);
  assert.match(app, /\u63a8\u8350\u6b4c\u66f2\s*\u00b7\s*\$\{card\.tracks\.length\}/);
  assert.match(app, /function playTrack\(card, index\)\s*\{\s*narration\.stop\(\)/);
  assert.match(app, /elements\.audio\.addEventListener\(['"]ended['"],\s*stopSong\)/);
  assert.doesNotMatch(app, /elements\.audio\.addEventListener\(['"]ended['"],\s*nextTrack\)/);
});

test('narration integration autoplays only a newly completed latest card', () => {
  const app = read('pwa/app.js');
  const stateIndex = app.indexOf('const state =');
  const controllerIndex = app.indexOf('new window.NarrationController');

  assert.ok(stateIndex >= 0 && controllerIndex > stateIndex, 'state must exist before narration callbacks');
  assert.match(app, /new window\.NarrationController\(\{[\s\S]*createAudio:\s*url\s*=>\s*new Audio\(url\)[\s\S]*isSongPlaying:/);
  assert.match(app, /onStatus\(cardId, status\)[\s\S]*state\.cards\.get\(cardId\)[\s\S]*updateNarrationCard\(card\)/);
  assert.match(app, /setLatestCardId\(card\.id\)[\s\S]*applyTtsReady\(card, card\.ttsUrl\)/);
  assert.match(app, /function applyTtsReady[\s\S]*card\.id === narration\.latestCardId[\s\S]*claimAutoplay\(card\)[\s\S]*narration\.autoplay\(card\)/);
  assert.match(app, /event\.type === ['"]tts-ready['"][\s\S]*applyTtsReady\(card, event\.ttsUrl\)/);
  assert.doesNotMatch(app, /initialize\(\)[\s\S]*setLatestCardId/);
});

test('TTS readiness has one reducer path and retry responses are generation-gated', () => {
  const app = read('pwa/app.js');
  const retry = app.slice(app.indexOf('async function retryTts(card)'), app.indexOf('async function playTrack(card, index)'));
  const socketTts = app.slice(app.indexOf("if (event.type === 'tts-ready')"), app.indexOf('function connectSocket()'));

  assert.match(app, /const \{[\s\S]*TtsState[\s\S]*reconcileCard[\s\S]*narrationView[\s\S]*\} = window\.ThisMomentAppModel/);
  assert.match(app, /function applyTtsReady\(card, ttsUrl, options = \{\}\)/);
  assert.match(socketTts, /applyTtsReady\(card, event\.ttsUrl\)/);
  assert.doesNotMatch(socketTts, /ttsPlaybackStatus\s*=/);
  assert.match(retry, /ttsState\.beginRetry\(card\)/);
  assert.match(retry, /applyTtsReady\(card, result\.ttsUrl, \{ retryToken \}\)/);
  assert.match(retry, /ttsState\.applyFailed\(card, [^,]+, \{ retryToken \}\)/);
  assert.doesNotMatch(retry, /narration\.play\(/);
});

test('hydration reconciles card identity before replaying queued socket events', () => {
  const app = read('pwa/app.js');
  const initialize = app.slice(app.indexOf('async function initialize()'), app.indexOf("document.addEventListener('click'"));

  assert.match(app, /hydrating:\s*true/);
  assert.match(app, /queuedSocketEvents:\s*\[\]/);
  assert.match(app, /reconcileCard\(existing, snapshot, ttsState\)/);
  assert.match(app, /if \(state\.hydrating\) state\.queuedSocketEvents\.push\(event\)/);
  assert.match(initialize, /reconcileSnapshots\([^)]+\)[\s\S]*state\.hydrating = false[\s\S]*queuedSocketEvents\.splice\(0\).*handleSocketEvent/);
});

test('generation fallback polling is bounded and always unwedge the form on exhaustion', () => {
  const app = read('pwa/app.js');

  assert.match(app, /new PollController\(\{[\s\S]*retryDelays:\s*\[[^\]]+\]/);
  assert.match(app, /generationPoller\.start\(1800\)/);
  assert.match(app, /onExhausted\([^)]*\)\s*\{[\s\S]*state\.generating = false[\s\S]*elements\.send\.disabled = false[\s\S]*elements\.progress\.hidden = true[\s\S]*showToast\(/);
  assert.doesNotMatch(app, /pollTimer\s*=\s*setTimeout\(refreshCards/);
});

test('fallback polling excludes restored history from the active generation', () => {
  const app = read('pwa/app.js');
  const poll = app.slice(app.indexOf('async function pollGeneration()'), app.indexOf('function finishPolledGeneration'));

  assert.match(app, /generationStartedAt:\s*null/);
  assert.match(app, /state\.generationStartedAt = Date\.now\(\)/);
  assert.match(poll, /newCards\.filter\(card => isCardFromGeneration\(card, state\.generationStartedAt\)\)/);
});

test('narration transitions update one keyed card in place with a live status', () => {
  const app = read('pwa/app.js');
  const callback = app.slice(app.indexOf('onStatus(cardId, status)'), app.indexOf('onObserverError'));
  const updater = app.slice(app.indexOf('function updateNarrationCard(card)'), app.indexOf('function renderCards()'));
  const ready = app.slice(app.indexOf('function applyTtsReady'), app.indexOf('function completeCard'));

  assert.match(app, /sourceText\.className = ['"]narration-status['"]/);
  assert.match(app, /sourceText\.setAttribute\(['"]role['"], ['"]status['"]\)/);
  assert.match(app, /sourceText\.setAttribute\(['"]aria-live['"], ['"]polite['"]\)/);
  assert.match(app, /speak\.dataset\.uiKey = ['"]narration['"]/);
  assert.match(updater, /narrationView\(card\)[\s\S]*narration-status[\s\S]*narration-control/);
  assert.doesNotMatch(callback, /renderCards\(/);
  assert.doesNotMatch(ready, /renderCards\(/);
});

test('structural card rendering captures and restores focus, rationale, and expansion', () => {
  const app = read('pwa/app.js');
  const render = app.slice(app.indexOf('function renderCards()'), app.indexOf('function reconcileSnapshots'));

  assert.match(render, /captureCardUiState\(elements\.cards\)/);
  assert.match(render, /restoreCardUiState\(elements\.cards, uiState/);
  assert.match(app, /reason\.dataset\.uiKey = ['"]reason['"]/);
  assert.match(app, /expand\.dataset\.uiKey = ['"]tracks['"]/);
  assert.match(app, /expand\.dataset\.expanded = String\(expanding\)/);
});

test('cards expose accessible narration states and retry through the existing endpoint', () => {
  const app = read('pwa/app.js');
  const appModel = read('pwa/app-model.js');
  const retry = app.slice(app.indexOf('async function retryTts(card)'), app.indexOf('async function playTrack(card, index)'));

  for (const label of ['\u63a8\u8350\u8bed\u751f\u6210\u4e2d', '\u6b63\u5728\u64ad\u653e\u63a8\u8350\u8bed', '\u64ad\u653e\u63a8\u8350\u8bed', '\u70b9\u51fb\u64ad\u653e\u63a8\u8350\u8bed', '\u91cd\u8bd5\u63a8\u8350\u8bed']) {
    assert.match(appModel, new RegExp(label));
  }
  assert.match(retry, /async function retryTts\(card\)/);
  assert.match(retry, /\/api\/cards\/\$\{encodeURIComponent\(card\.id\)\}\/tts\/retry/);
  assert.match(retry, /ttsState\.beginRetry\(card\)[\s\S]*applyTtsReady\(card, result\.ttsUrl, \{ retryToken \}\)/);
  assert.match(retry, /catch \(error\)\s*\{[\s\S]*ttsState\.applyFailed\(card, error\.message, \{ retryToken \}\)/);
  assert.doesNotMatch(retry, /narration\.play\(/);
});
