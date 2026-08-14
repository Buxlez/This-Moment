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
