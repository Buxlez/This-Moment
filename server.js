require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createRepository } = require('./state');
const { createMusicProvider } = require('./src/music/provider');
const { createLlm } = require('./llm');
const { createRecommendationPipeline } = require('./src/recommendation/pipeline');
const defaultTts = require('./tts');
const { createTtsArtifactStore } = require('./tts-artifact');
const { resolveCookie, verifyLoginStatus } = require('./netease-session');
const { resolveOpenMeteoWeather } = require('./src/environment/open-meteo');

const PUBLIC_TTS_ERROR = '推荐语音暂不可用，可稍后重试。';
const PUBLIC_GENERATION_ERROR = '生成失败，请稍后重试。';

const PRESETS = [
  { id: 'shanghai-morning', label: '上海·晴朗早晨', icon: '☀︎', city: '上海', weather: '晴朗', hour: 8, prompt: '上班路上有点困，想提神但别太吵' },
  { id: 'shenzhen-rain', label: '深圳·雨夜回家', icon: '☲', city: '深圳', weather: '下雨', hour: 21, prompt: '坐车回家有点累，想听点舒服但别太伤感的歌' },
  { id: 'suzhou-drive', label: '苏州·长途驾驶', icon: '→', city: '苏州', weather: '晴朗', hour: 15, prompt: '高速上还要开很久，想听点有精神但别太炸的歌' },
  { id: 'xiamen-weekend', label: '厦门·周末上午', icon: '◌', city: '厦门', weather: '晴朗', hour: 10, prompt: '周末开车出去玩，想听点轻松、有公路感的歌' },
  { id: 'shenzhen-night', label: '深圳·城市夜景', icon: '◐', city: '深圳', weather: '晴朗', hour: 22, prompt: '坐车看夜景，想听点有氛围但别太吵的歌' },
  { id: 'random', label: '随机一刻', icon: '✦', city: '上海', weather: '多云', hour: 17, prompt: '来点音乐' },
];

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function localTimeForHour(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const pad = number => String(Math.abs(number)).padStart(2, '0');
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

function createApp(overrides = {}) {
  const demoMode = overrides.demoMode ?? bool(process.env.DEMO_MODE, !process.env.DEEPSEEK_API_KEY);
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const ownRepository = !overrides.repository;
  const repository = overrides.repository || createRepository(process.env.STATE_DB_PATH);
  const musicProvider = overrides.musicProvider || createMusicProvider({ demoMode });
  const weatherResolver = overrides.weatherResolver || resolveOpenMeteoWeather;
  const configuredOverride = overrides.ttsConfigured;
  const ttsConfigured = configuredOverride === undefined
    ? defaultTts.isVolcengineConfigured()
    : Boolean(typeof configuredOverride === 'function' ? configuredOverride() : configuredOverride);
  const tts = overrides.tts || (demoMode && !ttsConfigured
    ? { synthesize: async () => { throw new Error(PUBLIC_TTS_ERROR); } }
    : defaultTts);
  const ttsCacheDir = path.resolve(overrides.ttsCacheDir || path.join(__dirname, 'cache', 'tts'));
  const ttsArtifact = createTtsArtifactStore(ttsCacheDir);
  const clients = new Map();
  const sessionQueues = new Map();
  const ttsRetryAttempts = new Map();

  function broadcast(event) {
    const payload = JSON.stringify(event);
    for (const [client, sessionId] of clients.entries()) {
      if (client.readyState === 1 && (!event.sessionId || sessionId === event.sessionId)) client.send(payload);
    }
  }

  function retryCardTts(card) {
    const existing = ttsRetryAttempts.get(card.id);
    if (existing) return existing;

    const attempt = (async () => {
      repository.updateTts(card.id, { status: 'pending', url: null, error: null });
      try {
        const ttsPath = await tts.synthesize(card.description, {
          role: 'recommendation', cacheDir: ttsArtifact.root,
        });
        const artifact = await ttsArtifact.validateArtifactPath(ttsPath);
        const url = `/api/tts/${artifact.filename}`;
        repository.updateTts(card.id, { status: 'ready', url, error: null });
        broadcast({ type: 'tts-ready', sessionId: card.sessionId, cardId: card.id, ttsUrl: url });
        return { status: 200, body: { ttsStatus: 'ready', ttsUrl: url } };
      } catch (_error) {
        repository.updateTts(card.id, { status: 'failed', url: null, error: PUBLIC_TTS_ERROR });
        broadcast({
          type: 'tts-failed', sessionId: card.sessionId, cardId: card.id,
          error: PUBLIC_TTS_ERROR,
        });
        return { status: 503, body: { error: PUBLIC_TTS_ERROR } };
      }
    })();

    let owned;
    owned = attempt.finally(() => {
      if (ttsRetryAttempts.get(card.id) === owned) ttsRetryAttempts.delete(card.id);
    });
    ttsRetryAttempts.set(card.id, owned);
    return owned;
  }

  const pipeline = overrides.pipeline || createRecommendationPipeline({
    repository,
    llm: overrides.llm || createLlm({ demoMode }),
    musicProvider,
    tts,
    ttsArtifact,
    emit: broadcast,
    progressDelayMs: demoMode ? 180 : 0,
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '24kb' }));

  app.get('/api/status', (_req, res) => {
    res.json({
      ok: true,
      name: 'this moment',
      mode: demoMode ? 'demo' : 'live',
      musicProvider: musicProvider.name,
      llmConfigured: demoMode || Boolean(process.env.DEEPSEEK_API_KEY),
      ttsConfigured,
    });
  });

  app.get('/api/environment-presets', (_req, res) => {
    res.json({ presets: PRESETS.map(preset => ({ ...preset, localTime: localTimeForHour(preset.hour) })) });
  });

  app.post('/api/environment/resolve', async (req, res) => {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: '无效的位置坐标。' });
    }
    try {
      const environment = await weatherResolver({ latitude, longitude });
      const { latitude: _latitude, longitude: _longitude, ...safeEnvironment } = environment || {};
      return res.json(safeEnvironment);
    } catch (_error) {
      return res.status(502).json({ error: '暂时无法获取当前天气，可使用手动环境。' });
    }
  });

  app.get('/api/cards', (req, res) => {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ error: '缺少 sessionId。' });
    return res.json({ cards: repository.listCards(sessionId) });
  });

  app.get('/api/cards/:cardId', (req, res) => {
    const card = repository.getCard(req.params.cardId);
    return card ? res.json({ card }) : res.status(404).json({ error: '未找到音乐卡片。' });
  });

  app.post('/api/recommendations', (req, res) => {
    const sessionId = String(req.body?.sessionId || '').trim();
    const userInput = String(req.body?.userInput || '').trim();
    const environment = req.body?.environment || {};
    if (!sessionId || sessionId.length > 100) return res.status(400).json({ error: '无效的会话标识。' });
    if (!userInput || userInput.length > 500) return res.status(400).json({ error: '请输入 1–500 个字符的音乐需求。' });
    const jobId = crypto.randomUUID();
    const previous = sessionQueues.get(sessionId) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      broadcast({ type: 'job-started', sessionId, jobId });
      try {
        await pipeline.generate({ sessionId, userInput, environment });
      } catch (_error) {
        broadcast({ type: 'failed', sessionId, jobId, error: PUBLIC_GENERATION_ERROR });
      }
    }).finally(() => {
      if (sessionQueues.get(sessionId) === queued) sessionQueues.delete(sessionId);
    });
    sessionQueues.set(sessionId, queued);
    return res.status(202).json({ jobId, status: 'queued' });
  });

  app.post('/api/playback/resolve', async (req, res) => {
    const trackId = String(req.body?.trackId || '');
    const provider = String(req.body?.provider || '');
    if (!trackId || provider !== musicProvider.name) return res.status(400).json({ error: '无效的音源或歌曲 ID。' });
    const url = await musicProvider.resolvePlaybackUrl(trackId);
    return url ? res.json({ url, expiresIn: demoMode ? null : 1200 }) : res.status(404).json({ error: '播放地址暂不可用。' });
  });

  app.post('/api/play-events', (req, res) => {
    const { sessionId, cardId, trackId, type } = req.body || {};
    if (!sessionId || !type) return res.status(400).json({ error: '缺少播放事件字段。' });
    repository.recordPlayEvent({ sessionId, cardId, trackId, type });
    return res.status(204).end();
  });

  app.post('/api/cards/:cardId/tts/retry', async (req, res) => {
    const card = repository.getCard(req.params.cardId);
    if (!card) return res.status(404).json({ error: '未找到音乐卡片。' });
    const result = await retryCardTts(card);
    return res.status(result.status).json(result.body);
  });

  app.get('/api/tts/:filename', async (req, res) => {
    const filename = req.params.filename;
    if (!ttsArtifact.isValidFilename(filename)) return res.status(400).end();
    let opened;
    try {
      opened = await ttsArtifact.openArtifact(filename);
    } catch (_error) {
      return res.status(404).end();
    }

    res.status(200);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(opened.stats.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    const stream = opened.handle.createReadStream({ autoClose: true });
    const abortStream = () => stream.destroy();
    res.once('close', abortStream);
    stream.once('close', () => res.off('close', abortStream));
    stream.once('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    return stream.pipe(res);
  });

  app.get('/api/netease/status', async (_req, res) => {
    if (demoMode) return res.json({ required: false, connected: false, loggedIn: false, source: 'demo' });
    const resolved = resolveCookie();
    const status = await verifyLoginStatus({ cookie: resolved.cookie });
    return res.json({ required: true, connected: status.reason !== 'network-error', loggedIn: status.valid, source: resolved.source });
  });

  app.use(express.static(path.join(__dirname, 'pwa'), { extensions: ['html'] }));

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/stream') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', (ws, request) => {
    const sessionId = new URL(request.url, 'http://localhost').searchParams.get('sessionId') || '';
    clients.set(ws, sessionId);
    ws.send(JSON.stringify({ type: 'connected', sessionId }));
    ws.on('close', () => clients.delete(ws));
  });

  function close() {
    for (const client of clients.keys()) client.terminate();
    wss.close();
    if (server.listening) server.close();
    if (ownRepository) repository.close();
  }

  return { app, server, wss, close, dependencies: { repository, pipeline, musicProvider, tts } };
}

if (require.main === module) {
  const instance = createApp();
  const port = Number(process.env.PORT || 8080);
  instance.server.listen(port, () => {
    const mode = instance.dependencies.musicProvider.name === 'demo' ? '演示模式' : '实时音源';
    console.log(`[this moment] ${mode}已启动 → http://localhost:${port}`);
  });
  const shutdown = () => { instance.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp, PRESETS, localTimeForHour };
