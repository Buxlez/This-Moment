const test = require('node:test');
const assert = require('node:assert/strict');

const { SCENES, DEFAULT_SCENE_ID, getScene, pickRandomScene, sceneIdForWeather, sceneClock } = require('../pwa/scenes');
const { PRESETS, localTimeForHour } = require('../server');

const BACKEND_WEATHER = ['晴朗', '多云', '下雨', '高温', '寒冷', '雪天', '未知'];
const VISUAL_WEATHER = ['rain', 'snow', 'fog', 'heat', 'clear', 'cloudy'];

test('there are exactly six scenes covering every known backend weather once', () => {
  assert.equal(SCENES.length, 6);
  assert.equal(new Set(SCENES.map(scene => scene.id)).size, 6);
  SCENES.forEach(scene => assert.ok(BACKEND_WEATHER.includes(scene.weather), `${scene.id} weather ${scene.weather}`));
  assert.deepEqual(
    [...new Set(SCENES.map(scene => scene.weather))].sort(),
    BACKEND_WEATHER.filter(weather => weather !== '未知').sort(),
  );
  assert.equal(getScene(DEFAULT_SCENE_ID).id, 'rain-night');
  assert.equal(getScene('missing-scene').id, 'rain-night');
});

test('every scene carries complete visual parameters', () => {
  SCENES.forEach(scene => {
    const { visual } = scene;
    assert.ok(VISUAL_WEATHER.includes(visual.weather), `${scene.id} visual weather`);
    [visual.colorA, visual.colorB, ...visual.bokehColors].forEach(color => {
      assert.equal(color.length, 3);
      color.forEach(channel => assert.ok(channel >= 0 && channel <= 1));
    });
    assert.ok(visual.bokehColors.length >= 1 && visual.bokehColors.length <= 4);
    ['blur', 'intensity', 'grain', 'vignette', 'bokeh', 'panelAlpha'].forEach(key => {
      assert.ok(visual[key] >= 0 && visual[key] <= 1, `${scene.id} ${key}`);
    });
    assert.match(visual.accent, /^#[0-9a-f]{6}$/i);
    assert.match(visual.fallbackCss, /gradient\(/);
    assert.ok('image' in visual);
  });
  assert.equal(new Set(SCENES.map(scene => scene.visual.weather)).size, 6);
});

test('pickRandomScene never returns the current scene', () => {
  for (const scene of SCENES) {
    for (let step = 0; step < 200; step += 1) {
      assert.notEqual(pickRandomScene(scene.id, () => step / 200).id, scene.id);
    }
    assert.notEqual(pickRandomScene(scene.id, () => 0.999999).id, scene.id);
    assert.notEqual(pickRandomScene(scene.id, () => 1).id, scene.id);
  }
  for (let step = 0; step < 500; step += 1) assert.notEqual(pickRandomScene('rain-night').id, 'rain-night');
  assert.ok(pickRandomScene(undefined));
});

test('scene ids and environment fields match the server presets one to one', () => {
  assert.deepEqual(SCENES.map(scene => scene.id).sort(), PRESETS.map(preset => preset.id).sort());
  PRESETS.forEach(preset => {
    const scene = SCENES.find(item => item.id === preset.id);
    for (const key of ['label', 'city', 'weather', 'hour', 'minute', 'prompt']) {
      assert.equal(scene[key], preset[key], `${preset.id}.${key}`);
    }
    assert.equal(typeof preset.icon, 'string');
  });
  assert.equal(PRESETS.some(preset => preset.id === 'random'), false);
});

test('real weather maps to the closest scene and preset times support minutes', () => {
  SCENES.forEach(scene => assert.equal(sceneIdForWeather(scene.weather), scene.id));
  assert.equal(sceneIdForWeather('未知'), null);
  assert.equal(sceneClock(getScene('cloudy-dusk')), '17:30');
  assert.equal(sceneClock(getScene('cold-dawn')), '06:30');
  assert.match(localTimeForHour(17, 30), /T17:30:00[+-]\d{2}:\d{2}$/);
  assert.match(localTimeForHour(6), /T06:00:00[+-]\d{2}:\d{2}$/);
});
