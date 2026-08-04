const test = require('node:test');
const assert = require('node:assert/strict');

const { routeIntent } = require('../src/domain/intent');
const { resolveEnvironment, coldStartDirection } = require('../src/domain/environment');
const { RecommendationPlanSchema } = require('../src/domain/recommendation-schema');

test('routes refresh, refinement, cold start, and recommendation intents', () => {
  assert.equal(routeIntent('换一批', true), 'refresh');
  assert.equal(routeIntent('再轻松一点，但保持有精神', true), 'refine');
  assert.equal(routeIntent('来点音乐', false), 'cold_start');
  assert.equal(routeIntent('上班路上有点困，提神但别太吵', false), 'recommend');
});

test('resolves defaults and lets explicit user weather override the simulator', () => {
  const now = new Date('2026-08-01T08:20:00+08:00');
  const fallback = resolveEnvironment('', {}, now);
  assert.equal(fallback.city, '上海');
  assert.equal(fallback.weather, '晴朗');
  assert.equal(fallback.localTime, now.toISOString());

  const resolved = resolveEnvironment('现在下雨，想听点松弛的', {
    city: '深圳',
    weather: '晴朗',
    localTime: '2026-08-01T21:00:00+08:00',
  }, now);
  assert.equal(resolved.weather, '下雨');
  assert.equal(resolved.city, '深圳');
});

test('maps cold-start environment into an executable music direction', () => {
  const direction = coldStartDirection({
    city: '深圳',
    weather: '下雨',
    localTime: '2026-08-01T23:30:00+08:00',
  });
  assert.ok(direction.atmosphere.includes('有空间感'));
  assert.equal(direction.energy, '中低');
  assert.ok(direction.rhythm.includes('低起伏'));
});

test('strictly validates structured recommendation plans', () => {
  const valid = RecommendationPlanSchema.safeParse({
    intent: 'recommend',
    direction: {
      atmosphere: ['明亮', '清晰'],
      energy: '中高但不过强',
      rhythm: ['活跃', '稳定'],
    },
    title: '清醒一点，慢慢出发',
    description: '上海的早晨正在醒来，困意里需要一点明亮的推动。这些歌保持活跃稳定的节奏，但不会过分吵闹。',
    candidates: [{ title: 'Yellow', artist: 'Coldplay' }],
  });
  assert.equal(valid.success, true);
  assert.equal(RecommendationPlanSchema.safeParse({ intent: 'recommend' }).success, false);
  assert.equal(RecommendationPlanSchema.safeParse({
    ...valid.data,
    candidates: [],
  }).success, false);
  assert.equal(RecommendationPlanSchema.safeParse(`prefix ${JSON.stringify(valid.data)}`).success, false);
});
