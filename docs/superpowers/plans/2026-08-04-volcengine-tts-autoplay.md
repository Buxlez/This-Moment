# Volcengine Recommendation TTS Autoplay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the existing Volcengine streaming TTS adapter with legacy APP ID + Access Token authentication, automatically play the newest card's recommendation once, and never automatically start a song.

**Architecture:** Keep TTS asynchronous: the recommendation card is persisted and rendered before synthesis completes. Extend the server adapter to choose new API-key auth or legacy dual-header auth, coalesce identical synthesis requests, and cache MP3 files; add a small browser-side narration controller that owns recommendation audio separately from the music player and applies latest-card, one-attempt, non-interruption, and autoplay-blocked rules.

**Tech Stack:** Node.js 20+, CommonJS, Express 4, WebSocket, native Fetch/Streams, native HTML/CSS/JavaScript, `HTMLAudioElement`, Node test runner.

---

## File map

| Path | Responsibility |
| --- | --- |
| `tts.js` | Volcengine auth selection, fixed endpoint validation, streaming response parsing, MP3 cache, in-flight request coalescing |
| `test/tts.test.js` | Adapter auth, safe failure, chunk parsing, cache, and concurrency coverage |
| `pwa/narration.js` | Testable recommendation-audio state and autoplay policy |
| `test/narration.test.js` | Latest-card, one-attempt, song-priority, blocked-autoplay, and manual replay coverage |
| `pwa/player.js` | Music-only queue; remove TTS-first preference and play-all sequence |
| `pwa/app.js` | Wire TTS WebSocket events to narration, remove play-all behavior, keep songs user-initiated |
| `pwa/index.html` | Load narration controller and remove the obsolete TTS-first switch |
| `pwa/styles.css` | Recommendation speech status/button and non-clickable song-count heading |
| `server.js` | Correct TTS configured status and retry behavior for either auth mode |
| `test/player.test.js` | Music queue remains manually controlled |
| `test/server.test.js` | Status does not expose credentials; retry success/failure contract |
| `test/ui.test.js` | Static UI contract: no play-all control, narration script/button remains |
| `.env.example` | Example legacy auth variable names only |
| `README.md` | Setup, behavior, fallback, and security notes |

The repository already contains unrelated uncommitted work. Every commit below must stage only the files listed in its task. Never stage `.env`, `data/netease/`, `cache/tts/`, SQLite files, or unrelated changes.

### Task 1: Add legacy Volcengine dual-header authentication

**Files:**
- Modify: `tts.js:9-12,122-145,260`
- Create: `test/tts.test.js`

- [ ] **Step 1: Write failing authentication tests**

Create `test/tts.test.js` with focused tests that pass explicit options instead of mutating process-wide credentials:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVolcengineHeaders,
  isVolcengineConfigured,
  validateVolcengineEndpoint,
} = require('../tts');

test('builds legacy dual-header authentication from APP ID and Access Token', () => {
  const headers = buildVolcengineHeaders({
    appId: 'app-test',
    accessToken: 'token-test',
    secretKey: 'secret-must-not-be-sent',
    resourceId: 'seed-tts-2.0',
    requestId: 'request-test',
  });

  assert.equal(headers['X-Api-App-Id'], 'app-test');
  assert.equal(headers['X-Api-Access-Key'], 'token-test');
  assert.equal(headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  assert.equal(headers['X-Api-Request-Id'], 'request-test');
  assert.equal(headers['X-Api-Key'], undefined);
  assert.equal(JSON.stringify(headers).includes('secret-must-not-be-sent'), false);
});

test('prefers new API key auth when both auth modes are configured', () => {
  const headers = buildVolcengineHeaders({
    apiKey: 'new-api-key', appId: 'legacy-app', accessToken: 'legacy-token',
    resourceId: 'seed-tts-2.0', requestId: 'request-test',
  });
  assert.equal(headers['X-Api-Key'], 'new-api-key');
  assert.equal(headers['X-Api-App-Id'], undefined);
  assert.equal(headers['X-Api-Access-Key'], undefined);
});

test('rejects incomplete legacy auth before sending a request', () => {
  assert.throws(() => buildVolcengineHeaders({
    appId: 'app-only', resourceId: 'seed-tts-2.0', requestId: 'request-test',
  }), /API key or APP ID \+ Access Token/);
  assert.equal(isVolcengineConfigured({
    appId: 'app-only', resourceId: 'seed-tts-2.0', voiceType: 'voice-test',
  }), false);
});

test('accepts only the official HTTPS Volcengine TTS endpoint', () => {
  assert.equal(validateVolcengineEndpoint('https://openspeech.bytedance.com/api/v3/tts/unidirectional'), true);
  assert.throws(() => validateVolcengineEndpoint('http://openspeech.bytedance.com/api/v3/tts/unidirectional'), /official HTTPS endpoint/);
  assert.throws(() => validateVolcengineEndpoint('https://example.test/collect'), /official HTTPS endpoint/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test test/tts.test.js
```

Expected: FAIL because `buildVolcengineHeaders`, `isVolcengineConfigured`, and `validateVolcengineEndpoint` are not exported.

- [ ] **Step 3: Implement the minimal credential resolver and endpoint guard**

Add these functions to `tts.js`; the `options` values take precedence so tests never need real credentials:

```js
function volcengineValue(options, optionName, envName) {
  return options[optionName] || process.env[envName] || '';
}

function validateVolcengineEndpoint(value = VOLCENGINE_DEFAULT_ENDPOINT) {
  const url = new URL(value);
  if (url.protocol !== 'https:'
    || url.hostname !== 'openspeech.bytedance.com'
    || url.pathname !== '/api/v3/tts/unidirectional') {
    throw new Error('Volcengine TTS credentials may only be sent to the official HTTPS endpoint.');
  }
  return true;
}

function buildVolcengineHeaders(options = {}) {
  const apiKey = volcengineValue(options, 'apiKey', 'VOLCENGINE_TTS_API_KEY');
  const appId = volcengineValue(options, 'appId', 'VOLCENGINE_TTS_APP_ID');
  const accessToken = volcengineValue(options, 'accessToken', 'VOLCENGINE_TTS_ACCESS_TOKEN');
  const resourceId = volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID');
  if (!resourceId || (!apiKey && !(appId && accessToken))) {
    throw new Error('Volcengine TTS API key or APP ID + Access Token and resource ID are required.');
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': options.requestId || crypto.randomUUID(),
    'Connection': 'keep-alive',
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  else {
    headers['X-Api-App-Id'] = appId;
    headers['X-Api-Access-Key'] = accessToken;
  }
  return headers;
}

function isVolcengineConfigured(options = {}) {
  const apiKey = volcengineValue(options, 'apiKey', 'VOLCENGINE_TTS_API_KEY');
  const appId = volcengineValue(options, 'appId', 'VOLCENGINE_TTS_APP_ID');
  const accessToken = volcengineValue(options, 'accessToken', 'VOLCENGINE_TTS_ACCESS_TOKEN');
  const resourceId = volcengineValue(options, 'resourceId', 'VOLCENGINE_TTS_RESOURCE_ID');
  const voiceType = volcengineValue(options, 'voiceType', 'VOLCENGINE_TTS_VOICE_TYPE');
  return Boolean(resourceId && voiceType && (apiKey || (appId && accessToken)));
}
```

In `synthesizeVolcengine`, validate the endpoint before constructing headers and replace the hard-coded `X-Api-Key` header object:

```js
const endpoint = options.endpoint || process.env.VOLCENGINE_TTS_ENDPOINT || VOLCENGINE_DEFAULT_ENDPOINT;
validateVolcengineEndpoint(endpoint);
const headers = buildVolcengineHeaders(options);
const fetchImpl = options.fetchImpl || fetch;
const res = await fetchImpl(endpoint, {
  method: 'POST', headers, body: JSON.stringify(buildVolcenginePayload(text, options)),
});
```

Export the three helpers for focused tests. Do not read `VOLCENGINE_SECRET_KEY` anywhere.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test test/tts.test.js
npm test
```

Expected: authentication tests PASS and the existing suite remains green.

- [ ] **Step 5: Commit only auth changes**

```bash
git add tts.js test/tts.test.js
git commit -m "feat: support legacy volcengine tts auth"
```

### Task 2: Harden streaming output, cache, and concurrent synthesis

**Files:**
- Modify: `tts.js:11-46,122-187,260`
- Modify: `test/tts.test.js`

- [ ] **Step 1: Add failing streaming and concurrency tests**

Append tests using temporary cache directories and fake fetch responses. Use `Readable.from` so JSON objects can cross network chunks:

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { synthesize, synthesizeVolcengine } = require('../tts');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'this-moment-tts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function successResponse(chunks) {
  return { ok: true, status: 200, body: Readable.from(chunks) };
}

test('reassembles JSON split across chunks into one MP3', async t => {
  const outPath = path.join(tempDir(t), 'voice.mp3');
  const first = Buffer.from('ID3-one').toString('base64');
  const second = Buffer.from('-two').toString('base64');
  const wire = `${JSON.stringify({ code: 0, data: first })}${JSON.stringify({ code: 0, data: second })}`;
  const fetchImpl = async () => successResponse([wire.slice(0, 17), wire.slice(17, 41), wire.slice(41)]);

  await synthesizeVolcengine('测试推荐语', outPath, {
    appId: 'app', accessToken: 'token', resourceId: 'seed-tts-2.0',
    voiceType: 'voice-test', fetchImpl,
  });

  assert.equal(fs.readFileSync(outPath).toString(), 'ID3-one-two');
});

test('coalesces concurrent synthesis for the same cache key', async t => {
  const cacheDir = tempDir(t);
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    await Promise.resolve();
    const data = Buffer.from('ID3-audio').toString('base64');
    return successResponse([JSON.stringify({ code: 0, data })]);
  };
  const options = {
    appId: 'app', accessToken: 'token', resourceId: 'seed-tts-2.0',
    voiceType: 'voice-test', fetchImpl, cacheDir,
  };

  const [first, second] = await Promise.all([
    synthesize('同一句推荐语', options),
    synthesize('同一句推荐语', options),
  ]);

  assert.equal(first, second);
  assert.equal(fetches, 1);
  assert.ok(fs.statSync(first).size > 0);
});

test('does not retain a failed in-flight synthesis or empty cache file', async t => {
  const cacheDir = tempDir(t);
  let attempts = 0;
  const options = {
    appId: 'app', accessToken: 'token', resourceId: 'seed-tts-2.0',
    voiceType: 'voice-test', cacheDir,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 500, async text() { return '{"message":"temporary"}'; } };
      return successResponse([JSON.stringify({ code: 0, data: Buffer.from('ID3-ok').toString('base64') })]);
    },
  };
  await assert.rejects(synthesize('失败后重试', options), /status 500/);
  const output = await synthesize('失败后重试', options);
  assert.equal(attempts, 2);
  assert.ok(fs.statSync(output).size > 0);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
node --test test/tts.test.js
```

Expected: FAIL because `synthesizeVolcengine` is not exported, `cacheDir` is ignored, and duplicate synthesis is not coalesced.

- [ ] **Step 3: Implement cache directory injection and in-flight coalescing**

Use a module-level map keyed by the final output path:

```js
const activeSynthesis = new Map();

function cachePath(text, provider = process.env.TTS_PROVIDER || 'volcengine', options = {}) {
  const directory = options.cacheDir || CACHE_DIR;
  fs.mkdirSync(directory, { recursive: true });
  const voice = getVoiceForProvider(provider, options);
  const role = options.role || 'station';
  return path.join(directory, `${md5(`${role}:${provider}:${voice}:${text}`)}.mp3`);
}

function hasUsableCache(filePath) {
  try { return fs.statSync(filePath).size > 0; } catch { return false; }
}
```

In `synthesize`, replace the existing local `promise` flow with the complete sequence below so a non-empty file wins first, duplicate calls share one provider promise, and the pending entry is always removed:

```js
if (hasUsableCache(cached)) return Promise.resolve(cached);
if (activeSynthesis.has(cached)) return activeSynthesis.get(cached);

let providerPromise;
if (provider === 'volcengine') {
  providerPromise = synthesizeVolcengine(text, cached, options);
} else if (provider === 'fish') {
  providerPromise = synthesizeFish(text, cached, options);
} else {
  providerPromise = synthesizeKokoro(text, cached, options);
}

const pending = providerPromise
  .then(filePath => {
    if (!hasUsableCache(filePath)) throw new Error('TTS output file is empty');
    return filePath;
  })
  .catch(error => {
    try { fs.unlinkSync(cached); } catch (unlinkError) {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    }
    throw error;
  })
  .finally(() => activeSynthesis.delete(cached));
activeSynthesis.set(cached, pending);
return pending;
```

Make `synthesizeVolcengine` use `options.fetchImpl || fetch`. Replace the raw upstream-body error with a bounded message and never include headers:

```js
if (!res.ok) {
  const detail = String(await res.text().catch(() => '')).slice(0, 2000);
  throw new Error(`Volcengine TTS status ${res.status}${detail ? `: ${detail}` : ''}`);
}
```

Export `synthesizeVolcengine` for adapter tests.

- [ ] **Step 4: Verify streaming, cache, and full regression tests**

```bash
node --test test/tts.test.js
npm test
node --check tts.js
```

Expected: all TTS tests PASS, the full suite PASSes, and syntax validation exits 0.

- [ ] **Step 5: Commit the adapter reliability changes**

```bash
git add tts.js test/tts.test.js
git commit -m "fix: harden volcengine tts streaming cache"
```

### Task 3: Create a recommendation narration controller

**Files:**
- Create: `pwa/narration.js`
- Create: `test/narration.test.js`
- Modify: `pwa/index.html:144-145`

- [ ] **Step 1: Write failing narration policy tests**

Create `test/narration.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { NarrationController } = require('../pwa/narration');

function fakeAudio({ rejects = false } = {}) {
  const listeners = new Map();
  return {
    paused: true,
    pauseCalls: 0,
    addEventListener(name, callback) { listeners.set(name, callback); },
    async play() { this.paused = false; if (rejects) throw new Error('NotAllowedError'); },
    pause() { this.paused = true; this.pauseCalls += 1; },
    emit(name) { listeners.get(name)?.(); },
  };
}

test('autoplays only the latest card and only once', async () => {
  const played = [];
  const controller = new NarrationController({
    createAudio: url => { played.push(url); return fakeAudio(); },
    isSongPlaying: () => false,
  });
  controller.setLatestCardId('new');
  assert.equal(await controller.autoplay({ id: 'old', ttsUrl: '/old.mp3' }), 'skipped');
  assert.equal(await controller.autoplay({ id: 'new', ttsUrl: '/new.mp3' }), 'playing');
  assert.equal(await controller.autoplay({ id: 'new', ttsUrl: '/new.mp3' }), 'skipped');
  assert.deepEqual(played, ['/new.mp3']);
});

test('does not interrupt a song for late narration', async () => {
  const controller = new NarrationController({ createAudio: () => fakeAudio(), isSongPlaying: () => true });
  controller.setLatestCardId('card');
  assert.equal(await controller.autoplay({ id: 'card', ttsUrl: '/voice.mp3' }), 'skipped');
});

test('reports blocked autoplay and still permits manual replay', async () => {
  const statuses = [];
  let calls = 0;
  const controller = new NarrationController({
    createAudio: () => fakeAudio({ rejects: calls++ === 0 }),
    isSongPlaying: () => false,
    onStatus: (cardId, status) => statuses.push([cardId, status]),
  });
  controller.setLatestCardId('card');
  assert.equal(await controller.autoplay({ id: 'card', ttsUrl: '/voice.mp3' }), 'blocked');
  assert.equal(await controller.play({ id: 'card', ttsUrl: '/voice.mp3' }), 'playing');
  assert.ok(statuses.some(([, status]) => status === 'blocked'));
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node --test test/narration.test.js
```

Expected: FAIL because `pwa/narration.js` does not exist.

- [ ] **Step 3: Implement the UMD-compatible controller**

Create `pwa/narration.js` with the same browser/CommonJS wrapper as `pwa/player.js`:

```js
(function exposeNarration(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThisMomentNarration = api;
}(typeof window !== 'undefined' ? window : globalThis, function narrationFactory() {
  class NarrationController {
    constructor({ createAudio, isSongPlaying = () => false, onStatus = () => {} } = {}) {
      this.createAudio = createAudio || (url => new Audio(url));
      this.isSongPlaying = isSongPlaying;
      this.onStatus = onStatus;
      this.latestCardId = null;
      this.autoHandled = new Set();
      this.audio = null;
      this.cardId = null;
    }

    setLatestCardId(cardId) { this.latestCardId = cardId; }

    async autoplay(card) {
      if (!card?.ttsUrl || card.id !== this.latestCardId || this.autoHandled.has(card.id)) return 'skipped';
      this.autoHandled.add(card.id);
      if (this.isSongPlaying()) return 'skipped';
      return this.play(card);
    }

    async play(card) {
      if (!card?.ttsUrl) return 'unavailable';
      this.stop();
      const audio = this.createAudio(card.ttsUrl);
      this.audio = audio;
      this.cardId = card.id;
      audio.addEventListener('ended', () => {
        if (this.audio === audio) {
          this.audio = null;
          this.cardId = null;
        }
        this.onStatus(card.id, 'ready');
      }, { once: true });
      audio.addEventListener('error', () => {
        if (this.audio === audio) {
          this.audio = null;
          this.cardId = null;
        }
        this.onStatus(card.id, 'failed');
      }, { once: true });
      try {
        await audio.play();
        this.onStatus(card.id, 'playing');
        return 'playing';
      } catch (_error) {
        if (this.audio === audio) {
          this.audio = null;
          this.cardId = null;
        }
        this.onStatus(card.id, 'blocked');
        return 'blocked';
      }
    }

    stop() {
      const stoppedCardId = this.cardId;
      if (this.audio && !this.audio.paused) this.audio.pause();
      this.audio = null;
      this.cardId = null;
      if (stoppedCardId) this.onStatus(stoppedCardId, 'ready');
    }
  }

  return { NarrationController };
}));
```

Load `/narration.js` after `/player.js` and before `/app.js` in `pwa/index.html`.

- [ ] **Step 4: Run focused and full tests**

```bash
node --test test/narration.test.js
npm test
```

Expected: narration policy tests and all existing tests PASS.

- [ ] **Step 5: Commit the isolated controller**

```bash
git add pwa/narration.js pwa/index.html test/narration.test.js
git commit -m "feat: add recommendation narration controller"
```

### Task 4: Wire automatic narration and remove automatic song playback

**Files:**
- Modify: `pwa/player.js:5-66`
- Modify: `pwa/app.js:5-21,267-316,381-442,503-514`
- Modify: `pwa/index.html:136-145`
- Modify: `pwa/styles.css` at `.play-all` and `.tts-switch` rules
- Modify: `test/player.test.js:34-42`
- Modify: `test/ui.test.js`

- [ ] **Step 1: Replace the obsolete player and UI tests with the new contract**

In `test/player.test.js`, delete the `play-all order includes recommendation speech` test and add a test proving music navigation changes only when an explicit method is called:

```js
test('a finished track does not advance the music queue implicitly', () => {
  const state = new PlayerState();
  state.replaceQueue('card-1', tracks(), 0);
  assert.equal(state.current().id, '1');
  assert.equal(state.current().id, '1');
  assert.equal(state.next().id, '2');
});
```

In `test/ui.test.js`, add static contract assertions:

```js
test('recommendation narration is independent from manually played songs', () => {
  const html = read('pwa/index.html');
  const app = read('pwa/app.js');
  assert.match(html, /src="\/narration\.js"/);
  assert.doesNotMatch(html, /ttsFirstToggle|播放全部时先读推荐语/);
  assert.doesNotMatch(app, /playAllCard|playerState\.ttsFirst/);
  assert.match(app, /narration\.autoplay\(card\)/);
  assert.match(app, /elements\.audio\.addEventListener\('ended', stopCurrentTrack\)/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test/player.test.js test/ui.test.js
```

Expected: FAIL because play-all and the TTS-first switch still exist and song `ended` still calls `nextTrack`.

- [ ] **Step 3: Make `PlayerState` music-only**

Remove `ttsFirst`, `setTtsFirst`, and `playAllSequence` from `PlayerState`. Keep `replaceQueue`, `current`, `next`, `previous`, and playback URL recovery unchanged; next/previous remain explicit user controls.

- [ ] **Step 4: Wire narration state into `pwa/app.js`**

Remove `elements.ttsFirst`, its initialization, and its change listener. After creating `playerState`, create one narration controller:

```js
const narration = new window.ThisMomentNarration.NarrationController({
  isSongPlaying: () => Boolean(playerState.current() && !elements.audio.paused),
  onStatus(cardId, status) {
    const card = state.cards.get(cardId);
    if (!card) return;
    card.ttsPlaybackStatus = status;
    renderCards();
  },
});
```

Because `state` is referenced by the callback, declare `state` before constructing `narration`.

When handling `complete`, mark that new card as the only autoplay candidate:

```js
addCard(event.card);
narration.setLatestCardId(event.card.id);
```

When handling `tts-ready`, update and render the card, then start a best-effort autoplay without awaiting it:

```js
if (event.type === 'tts-ready') {
  card.ttsStatus = 'ready';
  card.ttsUrl = event.ttsUrl;
  renderCards();
  narration.autoplay(card);
}
```

Do not call autoplay for cards loaded from `/api/cards`; reopening historical cards must stay silent.

- [ ] **Step 5: Replace play-all UI with narration status and manual song controls**

In `createCard`, replace the `.play-all` button with a non-clickable song count:

```js
const trackCount = document.createElement('strong');
trackCount.className = 'card-track-count';
trackCount.textContent = `歌曲 · ${card.tracks.length}`;
heading.append(trackCount, headingMeta);
```

Build the narration button from card state:

```js
const narrationLabel = card.ttsStatus === 'failed' ? '重试推荐语'
  : card.ttsPlaybackStatus === 'blocked' ? '点击播放推荐语'
    : card.ttsPlaybackStatus === 'playing' ? '正在播放推荐语'
      : card.ttsStatus === 'ready' ? '播放推荐语' : '正在生成推荐语';
const speak = staticButton(narrationLabel, 'secondary-action');
speak.disabled = card.ttsStatus === 'pending' || card.ttsPlaybackStatus === 'playing';
speak.addEventListener('click', () => (
  card.ttsStatus === 'failed' ? retryTts(card) : narration.play(card)
));
```

Add `retryTts(card)` using the existing endpoint; after success update the card and call `narration.play(card)` while the click activation is fresh:

```js
async function retryTts(card) {
  try {
    const result = await api(`/api/cards/${encodeURIComponent(card.id)}/tts/retry`, { method: 'POST' });
    card.ttsStatus = result.ttsStatus;
    card.ttsUrl = result.ttsUrl;
    renderCards();
    await narration.play(card);
  } catch (error) { showToast(error.message); }
}
```

Delete `browserSpeak`, `speakCard`, and `playAllCard`; cloud TTS failure must not silently substitute a different browser voice.

- [ ] **Step 6: Give manual music priority and stop at song end**

At the beginning of `playTrack`, call `narration.stop()` so an explicit song click wins. Replace the `ended` listener with a stop-only handler:

```js
function stopCurrentTrack() {
  elements.player.classList.remove('is-playing');
  elements.play.setAttribute('aria-label', '播放');
  updatePlayingRows();
}

elements.audio.addEventListener('ended', stopCurrentTrack);
```

Do not call `nextTrack` from `ended`. Keep the next and previous buttons wired to explicit clicks.

- [ ] **Step 7: Remove obsolete HTML and CSS**

Delete the `ttsFirstToggle` label from `.dock-meta`. Replace the `.play-all` and `.play-all-icon` rules with:

```css
.card-track-count { color: var(--ink); font-size: 14px; font-weight: 760; }
.track-play svg { width: 16px; height: 16px; fill: currentColor; }
.dock-meta { justify-content: center; }
```

Delete all `.tts-switch` rules. Preserve the individual `.track-play` controls and accessible focus states.

- [ ] **Step 8: Verify focused, full, and syntax tests**

```bash
node --test test/player.test.js test/narration.test.js test/ui.test.js
npm test
node --check pwa/player.js
node --check pwa/narration.js
node --check pwa/app.js
```

Expected: all tests PASS; app, player, and narration scripts parse successfully.

- [ ] **Step 9: Commit the interaction change**

```bash
git add pwa/player.js pwa/narration.js pwa/app.js pwa/index.html pwa/styles.css test/player.test.js test/narration.test.js test/ui.test.js
git commit -m "feat: autoplay recommendation narration only"
```

### Task 5: Align server status, retry behavior, and setup documentation

**Files:**
- Modify: `server.js:50-52,75-83,154-169`
- Modify: `test/server.test.js`
- Modify: `.env.example:6-13`
- Modify: `README.md:36-45`

- [ ] **Step 1: Add failing server contract tests**

Extend `test/server.test.js` with an explicit `ttsConfigured` override and capture repository updates:

```js
test('reports TTS configured without exposing auth details', async t => {
  const repository = {
    listCards: () => [], getCard: () => null, updateTts: () => {}, recordPlayEvent: () => {},
  };
  const instance = createApp({
    repository, demoMode: false, ttsConfigured: true,
    pipeline: { generate: async () => {} },
    musicProvider: { name: 'netease', resolvePlaybackUrl: async () => null },
    weatherResolver: async () => ({}),
    tts: { synthesize: async () => '/tmp/voice.mp3' },
  });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => instance.close());
  const response = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/status`);
  const status = await response.json();
  assert.equal(status.ttsConfigured, true);
  assert.equal(JSON.stringify(status).includes('appId'), false);
  assert.equal(JSON.stringify(status).includes('accessToken'), false);
  assert.equal(JSON.stringify(status).includes('auth'), false);
});
```

In the existing HTTP test, make `updateTts` record calls, then verify the successful retry contract:

```js
const ttsUpdates = [];
repository.updateTts = (cardId, update) => ttsUpdates.push({ cardId, update });
response = await fetch(`${base}/api/cards/card-1/tts/retry`, { method: 'POST' });
const retry = await response.json();
assert.equal(response.status, 200);
assert.deepEqual(retry, { ttsStatus: 'ready', ttsUrl: '/api/tts/a.mp3' });
assert.deepEqual(ttsUpdates.at(-1), {
  cardId: 'card-1',
  update: { status: 'ready', url: '/api/tts/a.mp3', error: null },
});
```

Add a separate failure test with a rejecting adapter:

```js
test('keeps TTS retry errors generic and non-blocking', async t => {
  const card = fakeCard();
  const updates = [];
  const repository = {
    listCards: () => [card], getCard: id => id === card.id ? card : null,
    updateTts: (cardId, update) => updates.push({ cardId, update }), recordPlayEvent: () => {},
  };
  const instance = createApp({
    repository, demoMode: true,
    pipeline: { generate: async () => card },
    musicProvider: { name: 'demo', resolvePlaybackUrl: async () => null },
    weatherResolver: async () => ({}),
    tts: { synthesize: async () => { throw new Error('upstream sensitive detail'); } },
  });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => instance.close());
  const response = await fetch(`http://127.0.0.1:${instance.server.address().port}/api/cards/card-1/tts/retry`, { method: 'POST' });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, '推荐语音暂不可用，可稍后重试。');
  assert.equal(JSON.stringify(body).includes('sensitive'), false);
  assert.equal(updates.at(-1).update.status, 'failed');
});
```

- [ ] **Step 2: Run server tests and verify RED**

```bash
node --test test/server.test.js
```

Expected: FAIL because `createApp` ignores `ttsConfigured` and production status checks only `VOLCENGINE_TTS_API_KEY`.

- [ ] **Step 3: Use the adapter's complete configuration predicate**

In `createApp`:

```js
const ttsConfigured = overrides.ttsConfigured ?? defaultTts.isVolcengineConfigured();
const tts = overrides.tts || (demoMode && !ttsConfigured
  ? { synthesize: async () => { throw new Error('演示模式未配置云端推荐语音。'); } }
  : defaultTts);
```

Return only `ttsConfigured` in `/api/status`; do not return auth mode, app ID, resource ID, voice ID, or any key fragment.

Change the retry endpoint's fixed public 503 response to `推荐语音暂不可用，可稍后重试。`. Internally it may use a sanitized status/code for diagnostics, but it must not return `error.message` from Volcengine.

- [ ] **Step 4: Document configuration names without real credentials**

Update `.env.example`:

```dotenv
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_ENDPOINT=https://openspeech.bytedance.com/api/v3/tts/unidirectional
# New console: set API key. Legacy console: leave API key empty and set both fields below.
VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_APP_ID=
VOLCENGINE_TTS_ACCESS_TOKEN=
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_TTS_VOICE_TYPE=zh_female_vv_uranus_bigtts
VOLCENGINE_TTS_FORMAT=mp3
VOLCENGINE_TTS_SAMPLE_RATE=24000
```

Update README to state that recommendation narration is synthesized asynchronously, the newest narration attempts one autoplay, songs stay manual, blocked autoplay shows a button, and Secret Key is not used by this endpoint. Link the official [single-direction HTTP TTS](https://docs.volcengine.com/docs/6561/2528925?lang=zh) and [legacy auth](https://www.volcengine.com/docs/6561/2534847?lang=zh) pages.

- [ ] **Step 5: Run server and full tests**

```bash
node --test test/server.test.js test/tts.test.js
npm test
git diff --check
```

Expected: all tests PASS and whitespace validation produces no output.

- [ ] **Step 6: Commit server and documentation changes**

```bash
git add server.js test/server.test.js .env.example README.md
git commit -m "docs: configure recommendation tts playback"
```

### Task 6: Configure the ignored local credentials and perform live acceptance

**Files:**
- Modify locally but never stage: `.env`
- Generate locally but never stage: `cache/tts/*.mp3`
- Possible evidence artifact: `output/playwright/volcengine-tts-autoplay.png`

- [ ] **Step 1: Confirm sensitive paths are ignored before writing**

```bash
git check-ignore -v .env cache/tts/test.mp3
```

Expected: both paths match `.gitignore`. If either does not, stop and fix ignore rules in a separate reviewed change before writing credentials.

- [ ] **Step 2: Populate only required legacy fields in `.env`**

Use the APP ID and Access Token supplied by the user at execution time. Do not copy them into this plan, shell history, test fixtures, logs, screenshots, or commits. In the ignored `.env`, set `VOLCENGINE_TTS_APP_ID` to the supplied APP ID and `VOLCENGINE_TTS_ACCESS_TOKEN` to the supplied Access Token, alongside these non-secret settings:

```dotenv
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_TTS_VOICE_TYPE=zh_female_vv_uranus_bigtts
VOLCENGINE_TTS_FORMAT=mp3
VOLCENGINE_TTS_SAMPLE_RATE=24000
```

Do not store the supplied Secret Key because the selected endpoint does not use it. Set `.env` permissions to owner read/write only and verify with `ls -l .env` without printing its contents.

- [ ] **Step 3: Run a direct real adapter smoke test**

Run a Node command that loads `.env` and calls `tts.synthesize` with a short, non-sensitive Chinese sentence. Do not print environment values or request headers:

```bash
node -e "require('dotenv').config(); require('./tts').synthesize('今天的节奏可以轻一点，让音乐慢慢带你进入状态。', { role: 'recommendation' }).then(file => console.log(require('path').basename(file))).catch(error => { console.error(error.message); process.exitCode = 1; })"
```

Expected: prints only a hashed `.mp3` basename and exits 0. Verify the file is non-empty with `find cache/tts -name '*.mp3' -size +0c`; do not dump binary content.

If the voice is unauthorized, use the user's enabled official female voice ID from the Volcengine voice library, update only `VOLCENGINE_TTS_VOICE_TYPE` in `.env`, and rerun once. Do not guess a sequence of voice IDs.

- [ ] **Step 4: Restart the app and verify safe status**

Restart `npm start`, then run:

```bash
curl -sS http://localhost:8080/api/status
```

Expected: `ttsConfigured` is `true`; the JSON contains no credentials, auth type, resource ID, or voice ID. Startup and request logs contain no real APP ID or Access Token.

- [ ] **Step 5: Perform real browser acceptance**

In the local web app:

1. Submit `我现在有点累，想听点温柔但不低落的歌`.
2. Confirm the card appears before TTS finishes and shows a pending narration state.
3. Confirm the newest card attempts to play the gentle female recommendation once when `tts-ready` arrives.
4. If the browser blocks autoplay, confirm the button changes to `点击播放推荐语` and succeeds after one click.
5. Confirm narration end leaves every song paused.
6. Click one song and confirm only the explicit click starts music.
7. Let the song finish and confirm the next song does not start automatically.
8. Generate a second card while the first card exists; confirm only the second card is an autoplay candidate.
9. Start a song before a card's TTS becomes ready; confirm late narration does not interrupt it.
10. Capture one screenshot showing the ready/playing narration state without secrets or browser developer panels.

- [ ] **Step 6: Run final verification and inspect repository safety**

```bash
npm test
node --check tts.js
node --check server.js
node --check pwa/player.js
node --check pwa/narration.js
node --check pwa/app.js
git diff --check
git status --short
git check-ignore -v .env cache/tts/*.mp3
```

Expected: tests and syntax checks PASS; `.env` and generated MP3 files remain ignored; no credential file is staged or tracked.

Do not claim completion if real synthesis, autoplay/fallback behavior, or manual-only song behavior has not been observed.
