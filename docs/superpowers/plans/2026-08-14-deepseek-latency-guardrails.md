# DeepSeek Latency Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound DeepSeek recommendation latency by disabling thinking, capping output at 4000 tokens, enforcing a 45-second timeout, and preventing layered retries.

**Architecture:** Add dependency injection to `createLiveLlm` so its client and request behavior can be tested without network access. Configure transport-level latency limits once on the OpenAI-compatible client, then keep the existing two-attempt loop only around JSON parsing and Schema validation.

**Tech Stack:** Node.js, CommonJS, OpenAI JavaScript SDK, Zod, `node:test`.

---

## File map

- Create `test/llm-live.test.js`: verify client options, request parameters, and retry classification with an injected fake client.
- Modify `llm.js`: inject client construction dependencies, add latency parameters, and separate API failures from output-repair retries.

### Task 1: Add DeepSeek request guardrails

**Files:**
- Create: `test/llm-live.test.js`
- Modify: `llm.js`

- [ ] **Step 1: Write the failing client and request parameter test**

Create `test/llm-live.test.js` with a valid plan fixture, fake OpenAI client, and this test:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createLiveLlm } = require('../llm');

function validPlan() {
  return {
    intent: 'recommend',
    direction: { atmosphere: ['温柔'], energy: '中等', rhythm: ['稳定'] },
    title: '午后的轻律动',
    description: '温柔里带一点轻快节拍，让午后的注意力慢慢回来，也不会打扰手上的工作。',
    candidates: [{ title: '小半', artist: '陈粒' }],
  };
}

function input() {
  return {
    userInput: '午后工作想听温柔但有节奏的歌',
    environment: { city: '上海', weather: '晴朗', timeOfDay: '午后' },
    previousCard: null,
    intent: 'recommend',
    candidateCount: 16,
    excludeTracks: [],
  };
}

function harness(responses) {
  const clientOptions = [];
  const requests = [];
  let cursor = 0;
  class FakeOpenAI {
    constructor(options) {
      clientOptions.push(options);
      this.chat = {
        completions: {
          create: async request => {
            requests.push(request);
            const response = responses[cursor++];
            if (response instanceof Error) throw response;
            return response;
          },
        },
      };
    }
  }
  const llm = createLiveLlm({
    OpenAIClient: FakeOpenAI,
    env: {
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
    },
  });
  return { llm, clientOptions, requests };
}

function completion(content) {
  return { choices: [{ finish_reason: 'stop', message: { content } }] };
}

test('live DeepSeek calls disable thinking and apply bounded client options', async () => {
  const { llm, clientOptions, requests } = harness([
    completion(JSON.stringify(validPlan())),
  ]);

  const result = await llm.generatePlan(input());

  assert.equal(result.title, '午后的轻律动');
  assert.deepEqual(clientOptions, [{
    apiKey: 'test-key',
    baseURL: 'https://api.deepseek.com',
    timeout: 45_000,
    maxRetries: 0,
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'deepseek-v4-flash');
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.equal(requests[0].max_tokens, 4000);
  assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  assert.equal(requests[0].stream, false);
});
```

- [ ] **Step 2: Run the parameter test and verify RED**

Run:

```bash
node --test --test-name-pattern='bounded client options' test/llm-live.test.js
```

Expected: FAIL because `createLiveLlm` does not accept the injected environment/client and the request lacks the new parameters.

- [ ] **Step 3: Implement injected configuration and request guardrails**

Change `createLiveLlm` in `llm.js` to accept dependencies and apply the approved options:

```js
function createLiveLlm({ OpenAIClient = OpenAI, env = process.env } = {}) {
  if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const client = new OpenAIClient({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    timeout: 45_000,
    maxRetries: 0,
  });
```

Use `env.DEEPSEEK_MODEL` and add the request parameters:

```js
model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
thinking: { type: 'disabled' },
max_tokens: 4000,
response_format: { type: 'json_object' },
stream: false,
```

- [ ] **Step 4: Run the parameter test and verify GREEN**

Run:

```bash
node --test --test-name-pattern='bounded client options' test/llm-live.test.js
```

Expected: one passing test.

### Task 2: Restrict retries to invalid structured output

**Files:**
- Modify: `test/llm-live.test.js`
- Modify: `llm.js`

- [ ] **Step 1: Add failing retry-classification tests**

Append to `test/llm-live.test.js`:

```js
test('live DeepSeek does not retry transport or API failures', async () => {
  const transportError = new Error('request timed out');
  const { llm, requests } = harness([transportError, completion(JSON.stringify(validPlan()))]);

  await assert.rejects(() => llm.generatePlan(input()), error => error === transportError);
  assert.equal(requests.length, 1);
});

test('live DeepSeek retries invalid structured output once', async () => {
  const { llm, requests } = harness([
    completion('{not-json'),
    completion(JSON.stringify(validPlan())),
  ]);

  const result = await llm.generatePlan(input());

  assert.equal(result.title, '午后的轻律动');
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[1].content, /上次输出不符合 Schema/);
});

test('live DeepSeek stops after two invalid structured outputs', async () => {
  const { llm, requests } = harness([
    completion(''),
    completion(JSON.stringify({ intent: 'recommend' })),
  ]);

  await assert.rejects(() => llm.generatePlan(input()), /连续两次未通过结构校验/);
  assert.equal(requests.length, 2);
});
```

- [ ] **Step 2: Run retry tests and verify RED**

Run:

```bash
node --test --test-name-pattern='transport|structured output' test/llm-live.test.js
```

Expected: the transport test fails because the current outer loop retries the thrown API error.

- [ ] **Step 3: Separate network calls from parsing and validation**

Refactor `generatePlan` in `llm.js` so only parsing failures continue the loop:

```js
for (let attempt = 0; attempt < 2; attempt += 1) {
  const completion = await client.chat.completions.create({
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: '你是 this moment 的音乐方向编辑。只输出严格 JSON，不要 Markdown。' },
      { role: 'user', content: attempt ? `${prompt}\n\n上次输出不符合 Schema，请修复后只输出 JSON。` : prompt },
    ],
    thinking: { type: 'disabled' },
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    stream: false,
  });
  const raw = completion.choices?.[0]?.message?.content || '';
  try {
    return RecommendationPlanSchema.parse(JSON.parse(raw));
  } catch (error) {
    lastError = error;
  }
}
```

The `await client.chat.completions.create(...)` call remains outside the parsing `try`, so transport/API exceptions propagate after one request.

- [ ] **Step 4: Run all live LLM tests and verify GREEN**

Run:

```bash
node --test test/llm-live.test.js
```

Expected: all four tests pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add llm.js test/llm-live.test.js
git commit -m "perf: bound DeepSeek recommendation latency"
```

### Task 3: Full verification and live comparison

**Files:**
- Verify: `llm.js`, `test/llm-live.test.js`

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: exit code 0, zero failed/cancelled tests.

- [ ] **Step 2: Run syntax and diff checks**

Run:

```bash
node --check llm.js
node --check test/llm-live.test.js
git diff --check HEAD~1..HEAD
git diff HEAD~1..HEAD -- llm.js test/llm-live.test.js
```

Expected: syntax and whitespace checks exit 0; diff contains only approved client options, retry classification, and tests.

- [ ] **Step 3: Merge locally and verify again**

Fast-forward the verified feature branch into `this-moment`, preserving unrelated dirty files, then run:

```bash
npm test
```

Expected: all tests pass on the merged branch.

- [ ] **Step 4: Restart and verify the local service**

```bash
launchctl kickstart -k "gui/$(id -u)/com.thismoment.demo"
curl --fail --silent http://localhost:8080/api/status
```

Expected: the service reports live mode with LLM and TTS configured.

- [ ] **Step 5: Perform three controlled browser trials**

Submit three ordinary prompts one at a time. For each, record submit time and the new card's server `createdAt`; verify no request exceeds the 45-second API boundary unless it is a structured-output repair attempt. Verify each successful card has no more than 8 tracks and TTS remains asynchronous.

- [ ] **Step 6: Report measured results honestly**

Report all three card latencies and failures/timeouts. Do not report only the fastest trial, and do not expose prompts, API keys, cookies, raw model output, playback URLs, or TTS headers.
