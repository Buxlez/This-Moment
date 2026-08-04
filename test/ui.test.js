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
  const scripts = [...html.matchAll(/<script src="\/(player|narration|app)\.js"><\/script>/g)].map(match => match[1]);

  assert.deepEqual(scripts, ['player', 'narration', 'app']);
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
  assert.match(app, /onStatus\(cardId, status\)[\s\S]*state\.cards\.get\(cardId\)[\s\S]*renderCards\(\)/);
  assert.match(app, /setLatestCardId\(card\.id\)[\s\S]*narration\.autoplay\(card\)/);
  assert.match(app, /event\.type === ['"]tts-ready['"][\s\S]*card\.id === narration\.latestCardId[\s\S]*narration\.autoplay\(card\)/);
  assert.doesNotMatch(app, /initialize\(\)[\s\S]*setLatestCardId/);
});

test('cards expose accessible narration states and retry through the existing endpoint', () => {
  const app = read('pwa/app.js');
  const retry = app.slice(app.indexOf('async function retryTts(card)'), app.indexOf('async function playTrack(card, index)'));

  for (const label of ['\u63a8\u8350\u8bed\u751f\u6210\u4e2d', '\u6b63\u5728\u64ad\u653e\u63a8\u8350\u8bed', '\u64ad\u653e\u63a8\u8350\u8bed', '\u70b9\u51fb\u64ad\u653e\u63a8\u8350\u8bed', '\u91cd\u8bd5\u63a8\u8350\u8bed']) {
    assert.match(app, new RegExp(label));
  }
  assert.match(retry, /async function retryTts\(card\)/);
  assert.match(retry, /\/api\/cards\/\$\{encodeURIComponent\(card\.id\)\}\/tts\/retry/);
  assert.match(retry, /card\.ttsStatus\s*=\s*['"]pending['"][\s\S]*card\.ttsStatus\s*=\s*result\.ttsStatus[\s\S]*narration\.play\(card\)/);
  assert.match(retry, /catch \(error\)\s*\{[\s\S]*card\.ttsStatus\s*=\s*['"]failed['"]/);
});
