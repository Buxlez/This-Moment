const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVolcengineHeaders,
  isVolcengineConfigured,
  synthesize,
  validateVolcengineEndpoint,
} = require('../tts');

const VOLCENGINE_ENV_NAMES = [
  'VOLCENGINE_TTS_API_KEY',
  'VOLCENGINE_TTS_APP_ID',
  'VOLCENGINE_TTS_ACCESS_TOKEN',
  'VOLCENGINE_TTS_RESOURCE_ID',
  'VOLCENGINE_TTS_VOICE_TYPE',
];

async function withoutVolcengineEnv(run) {
  const previous = Object.fromEntries(
    VOLCENGINE_ENV_NAMES.map(name => [name, process.env[name]])
  );

  for (const name of VOLCENGINE_ENV_NAMES) delete process.env[name];

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('buildVolcengineHeaders uses legacy app ID and access token without a secret key', () => {
  const headers = buildVolcengineHeaders({
    appId: 'legacy-app-id',
    accessToken: 'legacy-access-token',
    resourceId: 'resource-id',
    requestId: 'request-id',
    secretKey: 'must-never-be-used',
  });

  assert.equal(headers['X-Api-App-Id'], 'legacy-app-id');
  assert.equal(headers['X-Api-Access-Key'], 'legacy-access-token');
  assert.equal(headers['X-Api-Resource-Id'], 'resource-id');
  assert.equal(headers['X-Api-Request-Id'], 'request-id');
  assert.equal(headers['X-Api-Key'], undefined);
  assert.equal(JSON.stringify(headers).includes('must-never-be-used'), false);
  assert.equal(Object.keys(headers).some(key => /secret/i.test(key)), false);
});

test('buildVolcengineHeaders gives API key auth precedence over legacy credentials', () => {
  const headers = buildVolcengineHeaders({
    apiKey: 'new-api-key',
    appId: 'legacy-app-id',
    accessToken: 'legacy-access-token',
    resourceId: 'resource-id',
    requestId: 'request-id',
  });

  assert.equal(headers['X-Api-Key'], 'new-api-key');
  assert.equal(headers['X-Api-App-Id'], undefined);
  assert.equal(headers['X-Api-Access-Key'], undefined);
});

test('incomplete legacy authentication is unconfigured and rejects before fetch', async () => {
  await withoutVolcengineEnv(async () => {
    let fetchCalled = false;
    const options = {
      provider: 'volcengine',
      appId: 'legacy-app-id',
      resourceId: 'resource-id',
      voiceType: 'voice-type',
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('fetch should not be called');
      },
    };

    assert.equal(isVolcengineConfigured(options), false);
    await assert.rejects(
      synthesize(`incomplete-legacy-auth-${Date.now()}`, options),
      /VOLCENGINE|credentials|authentication/i
    );
    assert.equal(fetchCalled, false);
  });
});

test('validateVolcengineEndpoint accepts only the official HTTPS TTS endpoint', () => {
  assert.equal(
    validateVolcengineEndpoint('https://openspeech.bytedance.com/api/v3/tts/unidirectional'),
    true
  );
  assert.throws(
    () => validateVolcengineEndpoint('http://openspeech.bytedance.com/api/v3/tts/unidirectional'),
    /official HTTPS endpoint/
  );
  assert.throws(
    () => validateVolcengineEndpoint('https://example.com/api/v3/tts/unidirectional'),
    /official HTTPS endpoint/
  );
});
