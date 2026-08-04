const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('DeepSeek defaults use the current flash model', () => {
  const llmSource = fs.readFileSync(path.join(root, 'llm.js'), 'utf8');
  const exampleEnv = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.match(llmSource, /DEEPSEEK_MODEL\s*\|\|\s*['"]deepseek-v4-flash['"]/);
  assert.match(exampleEnv, /^DEEPSEEK_MODEL=deepseek-v4-flash$/m);
});
