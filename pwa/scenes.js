(function exposeScenes(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThisMomentScenes = api;
}(typeof window !== 'undefined' ? window : globalThis, function scenesFactory() {
  const DEFAULT_SCENE_ID = 'rain-night';

  // 环境字段（label/city/weather/hour/minute/prompt）与 server.js 的 PRESETS 按 id 一一对应，
  // 后端返回时以后端为准；这里的副本只在预设接口不可用时兜底。visual 只存在于前端。
  const SCENES = [
    {
      id: 'rain-night', label: '雨夜·回家路上', city: '深圳', weather: '下雨', hour: 21, minute: 0,
      prompt: '坐车回家有点累，想听点舒服但别太伤感的歌',
      visual: {
        weather: 'rain', gradient: 0.18, // gradient：纵向渐变占比，>0 时 colorB 在下方，<0 时在上方
        colorA: [0.012, 0.045, 0.075], colorB: [0.035, 0.17, 0.25],
        bokehColors: [[1.0, 0.36, 0.1], [1.0, 0.16, 0.08], [0.22, 0.6, 1.0], [1.0, 0.72, 0.36]],
        bokeh: 0.95, blur: 0.85, intensity: 0.75, grain: 0.055, vignette: 0.6,
        accent: '#38bdf8', panelAlpha: 0.38, image: null,
        fallbackCss: 'radial-gradient(circle at 24% 62%, rgba(255,106,40,.42), transparent 22%), radial-gradient(circle at 70% 54%, rgba(255,62,34,.34), transparent 18%), radial-gradient(circle at 52% 70%, rgba(64,150,255,.26), transparent 24%), linear-gradient(180deg, #03111b 0%, #0a3247 58%, #041521 100%)',
      },
    },
    {
      id: 'clear-morning', label: '晴·早高峰', city: '上海', weather: '晴朗', hour: 8, minute: 0,
      prompt: '上班路上有点困，想提神但别太吵',
      visual: {
        weather: 'clear', gradient: -0.3,
        colorA: [0.93, 0.83, 0.66], colorB: [1.0, 0.95, 0.85],
        bokehColors: [[1.0, 0.86, 0.55], [1.0, 0.95, 0.8]],
        bokeh: 0.3, blur: 0.25, intensity: 0.55, grain: 0.035, vignette: 0.22,
        accent: '#f6d27a', panelAlpha: 0.7, image: null,
        fallbackCss: 'radial-gradient(circle at 12% 8%, rgba(255,246,214,.95), transparent 42%), linear-gradient(128deg, rgba(255,232,170,.5) 0%, transparent 46%), linear-gradient(180deg, #f8e7c4 0%, #ecd3a2 100%)',
      },
    },
    {
      id: 'cloudy-dusk', label: '多云·傍晚', city: '杭州', weather: '多云', hour: 17, minute: 30,
      prompt: '下班前的一点空档，想听点松弛的歌',
      visual: {
        weather: 'cloudy', gradient: 0.62,
        colorA: [0.52, 0.45, 0.68], colorB: [0.96, 0.68, 0.56],
        bokehColors: [[1.0, 0.76, 0.6], [0.8, 0.68, 0.96]],
        bokeh: 0.1, blur: 0.6, intensity: 0.45, grain: 0.04, vignette: 0.35,
        accent: '#f3b0a4', panelAlpha: 0.58, image: null,
        fallbackCss: 'radial-gradient(ellipse at 50% 96%, rgba(255,186,150,.9), transparent 62%), linear-gradient(180deg, #7c6fa8 0%, #b08fb8 46%, #f0ad92 100%)',
      },
    },
    {
      id: 'heat-highway', label: '高温·午后高速', city: '苏州', weather: '高温', hour: 14, minute: 0,
      prompt: '高速上还要开很久，想听点有精神但别太炸的歌',
      visual: {
        weather: 'heat', gradient: -0.6,
        colorA: [0.86, 0.6, 0.3], colorB: [1.0, 0.9, 0.72],
        bokehColors: [[1.0, 0.82, 0.5], [1.0, 0.94, 0.82]],
        bokeh: 0.16, blur: 0.3, intensity: 0.6, grain: 0.045, vignette: 0.3,
        accent: '#ffa44f', panelAlpha: 0.7, image: null,
        fallbackCss: 'radial-gradient(circle at 88% 10%, rgba(255,255,240,.98), rgba(255,226,160,.5) 16%, transparent 42%), linear-gradient(180deg, #fbe6bb 0%, #eab877 62%, #d8964f 100%)',
      },
    },
    {
      id: 'snow-night', label: '雪夜·安静街道', city: '北京', weather: '雪天', hour: 22, minute: 0,
      prompt: '下雪的晚上，想听点安静又温暖的',
      visual: {
        weather: 'snow', gradient: 0.2,
        colorA: [0.02, 0.04, 0.1], colorB: [0.07, 0.13, 0.27],
        bokehColors: [[1.0, 0.74, 0.34], [1.0, 0.84, 0.52], [0.95, 0.62, 0.3]],
        bokeh: 0.6, blur: 0.7, intensity: 0.7, grain: 0.05, vignette: 0.55,
        accent: '#ffd08a', panelAlpha: 0.4, image: null,
        fallbackCss: 'radial-gradient(circle at 22% 58%, rgba(255,196,96,.42), transparent 20%), radial-gradient(circle at 76% 46%, rgba(255,210,128,.32), transparent 17%), linear-gradient(180deg, #050a1a 0%, #122347 62%, #070d20 100%)',
      },
    },
    {
      id: 'cold-dawn', label: '寒冷·起雾清晨', city: '哈尔滨', weather: '寒冷', hour: 6, minute: 30,
      prompt: '很冷的早上，车里刚热起来，想慢慢醒过来',
      visual: {
        weather: 'fog', gradient: -0.4,
        colorA: [0.23, 0.31, 0.4], colorB: [0.62, 0.7, 0.78],
        bokehColors: [[1.0, 0.8, 0.56], [0.86, 0.93, 1.0]],
        bokeh: 0.75, blur: 0.8, intensity: 0.6, grain: 0.05, vignette: 0.4,
        accent: '#bcd6ea', panelAlpha: 0.56, image: null,
        fallbackCss: 'radial-gradient(circle at 64% 40%, rgba(255,214,160,.3), transparent 26%), linear-gradient(180deg, #7f95a8 0%, #b9c7d2 52%, #6f8496 100%)',
      },
    },
  ];

  const WEATHER_TO_SCENE = {
    '下雨': 'rain-night', '晴朗': 'clear-morning', '多云': 'cloudy-dusk',
    '高温': 'heat-highway', '雪天': 'snow-night', '寒冷': 'cold-dawn',
  };

  function getScene(id) {
    return SCENES.find(scene => scene.id === id) || SCENES.find(scene => scene.id === DEFAULT_SCENE_ID);
  }

  function pickRandomScene(currentId, rng = Math.random) {
    const candidates = SCENES.filter(scene => scene.id !== currentId);
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(rng() * candidates.length)));
    return candidates[index];
  }

  // 真实天气映射到最接近的场景；「未知」等无法映射时返回 null，调用方保留当前画面。
  function sceneIdForWeather(weather) {
    return WEATHER_TO_SCENE[weather] || null;
  }

  function sceneClock(scene) {
    return `${String(scene.hour).padStart(2, '0')}:${String(scene.minute || 0).padStart(2, '0')}`;
  }

  return { SCENES, DEFAULT_SCENE_ID, getScene, pickRandomScene, sceneIdForWeather, sceneClock };
}));
