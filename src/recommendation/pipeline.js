const crypto = require('node:crypto');
const { routeIntent } = require('../domain/intent');
const { resolveEnvironment } = require('../domain/environment');
const { validateCandidates } = require('../music/provider');

const PUBLIC_TTS_ERROR = '推荐语音暂不可用，可稍后重试。';

function createRecommendationPipeline(dependencies) {
  const {
    repository, llm, musicProvider, tts, ttsArtifact,
    emit = () => {}, now = () => new Date(), progressDelayMs = 0,
  } = dependencies;
  if (!ttsArtifact || typeof ttsArtifact.validateArtifactPath !== 'function'
    || typeof ttsArtifact.root !== 'string') {
    throw new Error('A TTS artifact validator is required.');
  }
  const targetTrackCount = Math.max(1, Math.min(Number(dependencies.targetTrackCount || 8), 20));
  const candidateTrackCount = Math.min(targetTrackCount * 2, 16);
  const pauseForProgress = () => progressDelayMs ? new Promise(resolve => setTimeout(resolve, progressDelayMs)) : Promise.resolve();

  async function generate({ sessionId, userInput, environment = {} }) {
    const recentCards = repository.listCards(sessionId, 2);
    const previousCard = recentCards[0] || null;
    const intent = routeIntent(userInput, Boolean(previousCard));
    const resolvedEnvironment = resolveEnvironment(userInput, environment, now());
    const excludeTracks = recentCards.flatMap(card => card.tracks.map(track => String(track.id)));
    const excludedIds = new Set(excludeTracks);
    const publish = event => emit({ sessionId, ...event });

    publish({ type: 'progress', stage: 'understanding', label: '理解这一刻', progress: 18 });
    await pauseForProgress();
    const firstPlan = await llm.generatePlan({
      sessionId, userInput, environment: resolvedEnvironment, previousCard, intent,
      candidateCount: candidateTrackCount, excludeTracks,
    });
    publish({ type: 'progress', stage: 'candidates', label: '生成候选歌曲', progress: 42 });
    await pauseForProgress();
    publish({ type: 'progress', stage: 'validating', label: '核对真实音源', progress: 68 });
    await pauseForProgress();

    const tracks = await validateCandidates(firstPlan.candidates, musicProvider, {
      limit: targetTrackCount, concurrency: 2, excludeIds: excludedIds,
    });

    publish({ type: 'progress', stage: 'composing', label: '整理音乐卡片', progress: 90 });
    await pauseForProgress();
    const createdAt = now().toISOString();
    const card = {
      id: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      sessionId,
      userInput,
      intent,
      environment: resolvedEnvironment,
      direction: firstPlan.direction,
      title: firstPlan.title,
      description: firstPlan.description,
      provider: musicProvider.name,
      status: 'ready',
      warning: tracks.length < targetTrackCount ? `暂时只找到 ${tracks.length} 首可确认播放的歌曲，已如实保留。` : null,
      ttsStatus: 'pending',
      ttsUrl: null,
      ttsError: null,
      tracks,
      createdAt,
    };
    repository.saveCard(card);
    publish({ type: 'complete', card });

    try {
      const ttsPath = await tts.synthesize(card.description, {
        role: 'recommendation', cacheDir: ttsArtifact.root,
      });
      const artifact = await ttsArtifact.validateArtifactPath(ttsPath);
      const ttsUrl = `/api/tts/${artifact.filename}`;
      card.ttsStatus = 'ready';
      card.ttsUrl = ttsUrl;
      repository.updateTts(card.id, { status: 'ready', url: ttsUrl, error: null });
      publish({ type: 'tts-ready', cardId: card.id, ttsUrl });
    } catch (_error) {
      card.ttsStatus = 'failed';
      card.ttsError = PUBLIC_TTS_ERROR;
      repository.updateTts(card.id, { status: 'failed', error: card.ttsError });
      publish({ type: 'tts-failed', cardId: card.id, error: card.ttsError });
    }
    return card;
  }

  return { generate, dependencies };
}

module.exports = { createRecommendationPipeline };
