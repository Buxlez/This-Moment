const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

function mapWeatherCode(code, temperatureC) {
  const numericCode = Number(code);
  if ([71, 73, 75, 77, 85, 86].includes(numericCode)) return '雪天';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(numericCode)) return '下雨';
  if (Number(temperatureC) >= 32) return '高温';
  if (Number(temperatureC) <= 5) return '寒冷';
  if ([0, 1].includes(numericCode)) return '晴朗';
  if ([2, 3, 45, 48].includes(numericCode)) return '多云';
  return '未知';
}

function offsetSuffix(offsetSeconds = 0) {
  const totalMinutes = Math.round(Number(offsetSeconds) / 60);
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(totalMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function localTimeWithOffset(localTime, offsetSeconds) {
  const time = String(localTime || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time)) return new Date().toISOString();
  const withSeconds = time.length === 16 ? `${time}:00` : time;
  return `${withSeconds}${offsetSuffix(offsetSeconds)}`;
}

async function resolveOpenMeteoWeather({ latitude, longitude }, { fetchImpl = global.fetch } = {}) {
  const url = new URL(OPEN_METEO_URL);
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code',
    timezone: 'auto',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo 请求失败 (${response.status})`);
    const data = await response.json();
    const current = data?.current;
    if (!current) throw new Error('Open-Meteo 未返回当前天气。');
    return {
      city: '',
      localTime: localTimeWithOffset(current.time, data.utc_offset_seconds),
      weather: mapWeatherCode(current.weather_code, current.temperature_2m),
      temperatureC: Number(current.temperature_2m),
      apparentTemperatureC: Number(current.apparent_temperature),
      timezone: String(data.timezone || ''),
      source: 'automatic',
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolveOpenMeteoWeather, mapWeatherCode, localTimeWithOffset };
