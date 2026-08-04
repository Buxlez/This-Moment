const WEATHER_RULES = [
  [/(暴雨|大雨|小雨|下雨|雨天|雨夜)/, '下雨'],
  [/(下雪|雪天|雪夜)/, '雪天'],
  [/(寒冷|很冷|降温|冷天)/, '寒冷'],
  [/(高温|炎热|闷热|很热)/, '高温'],
  [/(多云|阴天|阴沉)/, '多云'],
  [/(晴朗|晴天|天晴)/, '晴朗'],
];

function resolveEnvironment(userInput, submitted = {}, now = new Date()) {
  const text = String(userInput || '');
  const explicitWeather = WEATHER_RULES.find(([pattern]) => pattern.test(text));
  return {
    city: String(submitted.city || '上海').trim().slice(0, 30) || '上海',
    localTime: submitted.localTime || now.toISOString(),
    weather: explicitWeather?.[1] || submitted.weather || '晴朗',
  };
}

function localHour(localTime) {
  const match = String(localTime || '').match(/T(\d{2}):/);
  if (match) return Number(match[1]);
  const value = new Date(localTime);
  return Number.isNaN(value.getTime()) ? 12 : value.getHours();
}

function coldStartDirection(environment = {}) {
  const hour = localHour(environment.localTime);
  let direction;
  if (hour >= 5 && hour < 9) {
    direction = { atmosphere: ['清新', '明亮'], energy: '中高', rhythm: ['轻快', '稳定'] };
  } else if (hour >= 9 && hour < 17) {
    direction = { atmosphere: ['自然', '容易进入状态'], energy: '中等', rhythm: ['自然', '稳定'] };
  } else if (hour >= 17 && hour < 22) {
    direction = { atmosphere: ['放松', '温和'], energy: '中等', rhythm: ['舒展', '稳定'] };
  } else {
    direction = { atmosphere: ['安静', '克制'], energy: '中低', rhythm: ['舒缓', '低起伏'] };
  }

  if (environment.weather === '下雨') {
    direction.atmosphere = [...new Set([...direction.atmosphere, '松弛', '有空间感'])];
    direction.energy = '中低';
    direction.rhythm = [...new Set([...direction.rhythm, '低起伏'])];
  } else if (environment.weather === '晴朗') {
    direction.atmosphere = [...new Set([...direction.atmosphere, '轻松'])];
  } else if (environment.weather === '雪天') {
    direction = { atmosphere: ['安静', '温暖'], energy: '中低', rhythm: ['舒缓', '低起伏'] };
  }

  return direction;
}

module.exports = { resolveEnvironment, coldStartDirection, localHour };
