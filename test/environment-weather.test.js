const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOpenMeteoWeather, mapWeatherCode } = require('../src/environment/open-meteo');

test('maps Open-Meteo conditions into the product weather vocabulary', () => {
  assert.equal(mapWeatherCode(0, 26), '晴朗');
  assert.equal(mapWeatherCode(3, 26), '多云');
  assert.equal(mapWeatherCode(63, 26), '下雨');
  assert.equal(mapWeatherCode(75, -2), '雪天');
  assert.equal(mapWeatherCode(0, 35), '高温');
  assert.equal(mapWeatherCode(2, 3), '寒冷');
});

test('resolves weather without returning or retaining precise coordinates', async () => {
  let requestedUrl = '';
  const fetchImpl = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      async json() {
        return {
          utc_offset_seconds: 28800,
          timezone: 'Asia/Shanghai',
          current: {
            time: '2026-08-04T21:15',
            temperature_2m: 28.4,
            apparent_temperature: 31.2,
            weather_code: 61,
          },
        };
      },
    };
  };

  const result = await resolveOpenMeteoWeather({ latitude: 31.2304, longitude: 121.4737 }, { fetchImpl });

  assert.match(requestedUrl, /api\.open-meteo\.com/);
  assert.deepEqual(result, {
    city: '',
    localTime: '2026-08-04T21:15:00+08:00',
    weather: '下雨',
    temperatureC: 28.4,
    apparentTemperatureC: 31.2,
    timezone: 'Asia/Shanghai',
    source: 'automatic',
  });
  assert.equal('latitude' in result, false);
  assert.equal('longitude' in result, false);
});
