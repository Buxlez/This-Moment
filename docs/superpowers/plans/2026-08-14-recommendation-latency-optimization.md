# Recommendation Latency Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the recommendation critical path by generating 16 candidates, allowing rate-limited Netease requests to overlap, and removing song-detail enrichment.

**Architecture:** Keep the existing recommendation pipeline and provider boundaries. Change the pipeline's candidate budget, make the Netease scheduler serialize only request starts instead of whole requests, and return compact search results after playability validation without calling the detail endpoint.

**Tech Stack:** Node.js, CommonJS, `node:test`, OpenAI-compatible DeepSeek client, local Netease sidecar.

---

## File map

- Modify `src/recommendation/pipeline.js`: calculate a 16-item candidate budget for the default 8-track card.
- Modify `music-netease.js`: rate-limit request starts without serializing request completion.
- Modify `src/music/provider.js`: stop enriching accepted search results with song details.
- Modify `test/pipeline.test.js`: lock the candidate budget to 16.
- Modify `test/music.test.js`: cover overlapping scheduled requests and absence of detail enrichment.

### Task 1: Reduce the model candidate budget

**Files:**
- Modify: `test/pipeline.test.js`
- Modify: `src/recommendation/pipeline.js`

- [ ] **Step 1: Change the pipeline assertion to the desired 16 candidates**

In `test/pipeline.test.js`, update the default-card test assertion:

```js
assert.equal(calls[0].candidateCount, 16);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='default 8-track card' test/pipeline.test.js
```

Expected: FAIL with `32 !== 16`.

- [ ] **Step 3: Implement the smaller candidate budget**

In `src/recommendation/pipeline.js`, replace the current multiplier:

```js
const candidateTrackCount = Math.min(targetTrackCount * 2, 16);
```

- [ ] **Step 4: Run the focused pipeline tests and verify GREEN**

Run:

```bash
node --test test/pipeline.test.js
```

Expected: all pipeline tests pass, including 8 returned tracks and one model call.

- [ ] **Step 5: Commit the candidate-budget change**

```bash
git add src/recommendation/pipeline.js test/pipeline.test.js
git commit -m "perf: reduce recommendation candidate budget"
```

### Task 2: Stop fetching song details during validation

**Files:**
- Modify: `test/music.test.js`
- Modify: `src/music/provider.js`

- [ ] **Step 1: Replace the enrichment expectation with a no-detail contract**

Replace the current `candidate validation enriches only tracks confirmed playable` test in `test/music.test.js` with:

```js
test('candidate validation returns compact results without fetching details', async () => {
  const enriched = [];
  const provider = {
    name: 'netease',
    async searchTrack(title, artist) { return { id: title, title, artist, album: '搜索专辑' }; },
    async checkPlayable(id) { return id === '可播'; },
    async enrichTrack(track) {
      enriched.push(track.id);
      return { ...track, coverUrl: 'https://example.test/cover.jpg' };
    },
  };

  const tracks = await validateCandidates([
    { title: '不可播', artist: '甲' },
    { title: '可播', artist: '乙' },
  ], provider, { concurrency: 1 });

  assert.deepEqual(enriched, []);
  assert.equal(tracks[0].album, '搜索专辑');
  assert.equal(tracks[0].coverUrl, undefined);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='without fetching details' test/music.test.js
```

Expected: FAIL because `enrichTrack` is called with `可播`.

- [ ] **Step 3: Return the compact resolved track directly**

In `src/music/provider.js`, replace the enrichment block in `validateCandidates`:

```js
if (seen.has(id)) continue;
seen.add(id);
accepted.push({ index, track: { ...resolved, provider: provider.name } });
```

Remove `enrichTrack` from `createNeteaseProvider` so the production provider no longer exposes an unused detail-loading path:

```js
function createNeteaseProvider() {
  return {
    name: 'netease',
    async searchTrack(title, artist) { return netease.searchSong(`${title} ${artist}`, { enrich: false }); },
    async checkPlayable(id) { return netease.isSongPlayable(id); },
    async resolvePlaybackUrl(id) { return netease.getPlaybackUrl(id); },
  };
}
```

- [ ] **Step 4: Run music and pipeline tests and verify GREEN**

Run:

```bash
node --test test/music.test.js test/pipeline.test.js
```

Expected: all tests pass and the no-detail test records zero enrichment calls.

- [ ] **Step 5: Commit the no-detail change**

```bash
git add src/music/provider.js test/music.test.js
git commit -m "perf: skip recommendation track detail lookup"
```

### Task 3: Allow rate-limited requests to overlap

**Files:**
- Modify: `test/music.test.js`
- Modify: `music-netease.js`

- [ ] **Step 1: Add a regression test for overlapping request execution**

Add after the existing scheduler interval test in `test/music.test.js`:

```js
test('netease request scheduler does not wait for an earlier request to finish', async () => {
  let clock = 0;
  const starts = [];
  let releaseFirst;
  const firstFinished = new Promise(resolve => { releaseFirst = resolve; });
  const schedule = netease.createRequestScheduler({
    minIntervalMs: 350,
    now: () => clock,
    sleep: async milliseconds => { clock += milliseconds; },
  });

  const first = schedule(async () => {
    starts.push(clock);
    await firstFinished;
    return 'first';
  });
  const second = schedule(async () => {
    starts.push(clock);
    return 'second';
  });

  assert.equal(await second, 'second');
  assert.deepEqual(starts, [0, 350]);
  releaseFirst();
  assert.equal(await first, 'first');
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
node --test --test-name-pattern='does not wait for an earlier request' test/music.test.js
```

Expected: the test remains pending or is cancelled because the second request cannot start until `firstFinished` resolves under the current scheduler. Use Node's reported cancelled/pending result as the RED evidence.

- [ ] **Step 3: Serialize only start reservations**

Replace `createRequestScheduler` in `music-netease.js` with:

```js
function createRequestScheduler({
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  now = Date.now,
  sleep: wait = sleep,
} = {}) {
  let lastStartedAt = null;
  let startTail = Promise.resolve();
  return function schedule(operation) {
    const start = startTail.then(async () => {
      if (lastStartedAt !== null) {
        const remaining = Math.max(0, lastStartedAt + minIntervalMs - now());
        if (remaining) await wait(remaining);
      }
      lastStartedAt = now();
    });
    startTail = start.catch(() => {});
    return start.then(operation);
  };
}
```

This keeps start order and the 350ms interval while allowing an operation to remain in flight after the next start reservation is released.

- [ ] **Step 4: Run scheduler and candidate validation tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern='scheduler|candidate validation' test/music.test.js
```

Expected: all matching tests pass, including the existing minimum-interval assertion and the new overlap assertion.

- [ ] **Step 5: Commit the scheduler change**

```bash
git add music-netease.js test/music.test.js
git commit -m "perf: overlap rate-limited Netease requests"
```

### Task 4: Full verification and local runtime check

**Files:**
- Verify only: `music-netease.js`, `src/music/provider.js`, `src/recommendation/pipeline.js`, `test/music.test.js`, `test/pipeline.test.js`

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: exit code 0 with zero failed or cancelled tests.

- [ ] **Step 2: Run syntax and whitespace checks**

Run:

```bash
node --check music-netease.js
node --check src/music/provider.js
node --check src/recommendation/pipeline.js
node --check test/music.test.js
node --check test/pipeline.test.js
git diff --check HEAD~3..HEAD
```

Expected: every command exits 0 with no output.

- [ ] **Step 3: Review the exact production diff**

Run:

```bash
git diff HEAD~3..HEAD -- music-netease.js src/music/provider.js src/recommendation/pipeline.js test/music.test.js test/pipeline.test.js
```

Expected: only the three approved performance changes and their tests are present.

- [ ] **Step 4: Restart the existing local service**

Use the existing macOS user service rather than creating a second server:

```bash
launchctl kickstart -k "gui/$(id -u)/com.thismoment.demo"
```

Expected: `launchctl print` reports `state = running`, and port 8080 has one listener.

- [ ] **Step 5: Verify the public status and page**

Run:

```bash
curl --fail --silent http://localhost:8080/api/status
curl --fail --silent --output /dev/null http://localhost:8080/
```

Expected: status JSON reports `ok: true` in live mode and both commands exit 0.

- [ ] **Step 6: Perform one user-visible recommendation check**

Submit one ordinary prompt from the existing browser page. Verify that a card appears, contains no more than 8 playable tracks, missing detail fields use existing placeholders, and TTS becomes ready without blocking the card.

- [ ] **Step 7: Record actual stage timings without exposing credentials**

Use the browser request start and `complete` WebSocket event timestamps to report end-to-end card latency. Do not print `.env`, access tokens, cookies, playback URLs, or TTS request headers.
