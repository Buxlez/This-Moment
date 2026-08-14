const OpenAI = require('openai');
const { RecommendationPlanSchema } = require('./src/domain/recommendation-schema');
const { coldStartDirection } = require('./src/domain/environment');
const { DEMO_CATALOG } = require('./src/music/demo-catalog');
const { buildRecommendationContext } = require('./context');

function demoDirection(userInput, environment, previousCard, intent) {
  const text = String(userInput || '');
  if ((intent === 'refine' || intent === 'refresh') && previousCard?.direction) {
    const inherited = JSON.parse(JSON.stringify(previousCard.direction));
    if (/轻松|放松|安静|轻一点/.test(text)) {
      inherited.atmosphere = [...new Set([...inherited.atmosphere, '轻松', '舒展'])];
      inherited.energy = intent === 'refine' ? '中等' : inherited.energy;
    }
    return inherited;
  }
  if (/困|提神|有精神/.test(text)) {
    return { atmosphere: ['明亮', '清晰'], energy: '中高但不过强', rhythm: ['活跃', '稳定'] };
  }
  if (/累|放松|舒服|舒缓/.test(text)) {
    return { atmosphere: ['放松', '不过度低沉'], energy: '中低', rhythm: ['舒缓', '稳定'] };
  }
  if (/夜景|氛围/.test(text)) {
    return { atmosphere: ['都市', '有空间感'], energy: '中低至中等', rhythm: ['流动', '不过强'] };
  }
  return coldStartDirection(environment);
}

function demoCopy({ environment, userInput, intent, direction }) {
  const moment = environment.weather === '下雨' ? '雨声把城市放慢了一些' : '光线正好，城市也慢慢醒来';
  const title = intent === 'refresh' ? '还是这个方向，换个开场' : intent === 'refine' ? '轻一点，精神还在' :
    direction.energy.includes('高') ? '清醒一点，慢慢出发' : '在这一刻，把声音放松';
  const request = String(userInput || '').replace(/[。.!！]+$/g, '').slice(0, 22);
  return {
    title,
    description: `${environment.city}的${moment}，${request ? `“${request}”的感受被留住了` : '就从此刻的环境开始'}。音乐会保持${direction.energy}的能量和${direction.rhythm.join('、')}的节奏，给当下留一点余地。`,
  };
}

function createDemoLlm() {
  return {
    async generatePlan({ userInput, environment, previousCard, intent, candidateCount = 40, excludeTracks = [] }) {
      const direction = demoDirection(userInput, environment, previousCard, intent);
      const copy = demoCopy({ environment, userInput, intent, direction });
      const excluded = new Set(excludeTracks.map(String));
      const candidates = DEMO_CATALOG.filter(track => !excluded.has(track.id)).slice(0, candidateCount)
        .map(track => ({ title: track.title, artist: track.artist }));
      return RecommendationPlanSchema.parse({ intent, direction, ...copy, candidates });
    },
  };
}

function createLiveLlm({ OpenAIClient = OpenAI, env = process.env } = {}) {
  if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const client = new OpenAIClient({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    timeout: 45_000,
    maxRetries: 0,
  });
  return {
    async generatePlan(input) {
      const prompt = buildRecommendationContext(input);
      let lastError;
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
        } catch (error) { lastError = error; }
      }
      throw new Error(`模型输出连续两次未通过结构校验：${lastError?.message || '未知错误'}`);
    },
  };
}

function createLlm({ demoMode = false } = {}) {
  return demoMode ? createDemoLlm() : createLiveLlm();
}

module.exports = { createLlm, createDemoLlm, createLiveLlm, demoDirection, demoCopy };
