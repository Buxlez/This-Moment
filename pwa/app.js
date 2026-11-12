(function bootThisMoment() {
  'use strict';

  const {
    RequestGate, TtsState, PollController, reconcileCard, narrationView, captureCardUiState, restoreCardUiState,
    selectGenerationCards, syncNarrationControl, activateNarrationControl,
  } = window.ThisMomentAppModel;
  const GENERATION_POLL_CONFIG = Object.freeze({
    initialDelay: 3000,
    retryDelays: Object.freeze([4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000]),
  });
  const $ = selector => document.querySelector(selector);
  const elements = {
    form: $('#recommendationForm'), input: $('#momentInput'), send: $('#sendButton'),
    feed: $('#conversationFeed'), sceneCanvas: $('#sceneCanvas'), sceneEnv: $('#sceneEnv'),
    scenePanel: $('#scenePanel'), sceneBackdrop: $('#sceneBackdrop'), sceneGrid: $('#sceneGrid'),
    sceneButton: $('#sceneButton'), randomScene: $('#randomSceneButton'), immersive: $('#immersiveButton'), scrollTop: $('#scrollTopButton'),
    realWeather: $('#realWeatherButton'), environmentSource: $('#environmentSource'),
    mode: $('#modePill'), progress: $('#progressPanel'), progressTitle: $('#progressTitle'), progressNumber: $('#progressNumber'), progressBar: $('#progressBar'),
    pendingMessage: $('#pendingUserMessage'), pendingMeta: $('#pendingMessageMeta'),
    cards: $('#cards'), empty: $('#emptyState'), toast: $('#toast'),
    player: $('#playerShell'), audio: $('#audio'), playerCover: $('#playerCover'), playerTitle: $('#playerTitle'), playerArtist: $('#playerArtist'),
    play: $('#playButton'), previous: $('#previousButton'), next: $('#nextButton'), seek: $('#seekInput'), current: $('#currentTime'), duration: $('#durationTime'), queue: $('#queuePosition'), mute: $('#muteButton'),
  };
  const playerState = new window.ThisMomentPlayer.PlayerState();
  const selectionGate = new RequestGate();
  const ttsState = new TtsState();
  const sessionId = localStorage.getItem('thisMoment.sessionId') || crypto.randomUUID();
  localStorage.setItem('thisMoment.sessionId', sessionId);
  const state = {
    cards: new Map(), presets: [], generating: false, socket: null, toastTimer: null,
    pendingEnvironment: null, automaticEnvironment: null, hydrating: true, queuedSocketEvents: [],
    historyHydrated: false,
    sceneId: null, scenePromptFill: '', renderer: null, renderedCardIds: new Set(),
  };
  const Scenes = window.ThisMomentScenes;
  const DEFAULT_PLACEHOLDER = elements.input.getAttribute('placeholder') || '';
  const REAL_WEATHER_HINT = elements.environmentSource.textContent;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compactLayoutQuery = window.matchMedia('(max-width: 1024px)');
  const narration = new window.NarrationController({
    createAudio: url => new Audio(url),
    isSongPlaying: () => Boolean(playerState.current()) && !elements.audio.paused && !elements.audio.ended,
    onStatus(cardId, status) {
      const card = state.cards.get(cardId);
      if (!card) return;
      card.ttsPlaybackStatus = status;
      updateNarrationCard(card);
    },
    onObserverError: error => showToast(error.message || '推荐语状态更新失败。'),
  });
  const generationPoller = new PollController({
    task: pollGeneration,
    retryDelays: GENERATION_POLL_CONFIG.retryDelays,
    onComplete: finishPolledGeneration,
    onExhausted() {
      state.generating = false;
      elements.send.disabled = false;
      elements.progress.hidden = true;
      showToast('未收到新推荐，请检查连接后重试。');
    },
  });

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `请求失败 (${response.status})`);
    return body;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3200);
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDuration(milliseconds) {
    if (milliseconds === null || milliseconds === undefined) return '--:--';
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function environmentMeta(value = {}, fallbackDate = new Date()) {
    const parts = [formatTime(value.localTime || fallbackDate)];
    if (value.city) parts.push(value.city);
    if (value.weather) parts.push(value.weather);
    if (Number.isFinite(Number(value.temperatureC))) parts.push(`${Math.round(Number(value.temperatureC))}°`);
    if (value.source === 'manual') parts.push('手动');
    return parts.filter(Boolean).join(' · ');
  }

  // ---------- 场景：环境数据 + 背景视觉 ----------

  function sceneList() {
    if (!state.presets.length) return Scenes.SCENES;
    // 环境字段以后端预设为准；后端出现前端不认识的 id 时，视觉参数回退到 rain-night。
    return state.presets.map(preset => ({ ...preset, minute: preset.minute || 0, visual: Scenes.getScene(preset.id).visual }));
  }

  function currentScene() {
    const scenes = sceneList();
    return scenes.find(scene => scene.id === state.sceneId) || scenes.find(scene => scene.id === Scenes.DEFAULT_SCENE_ID) || scenes[0];
  }

  function sceneLocalTime(scene) {
    const date = new Date();
    date.setHours(scene.hour, scene.minute || 0, 0, 0);
    const offset = -date.getTimezoneOffset();
    const pad = number => String(Math.abs(number)).padStart(2, '0');
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    return `${local}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }

  function environment() {
    const automatic = state.automaticEnvironment;
    if (automatic) {
      return {
        city: automatic.city || '当前位置',
        weather: automatic.weather || '未知',
        localTime: automatic.localTime || new Date().toISOString(),
        temperatureC: automatic.temperatureC,
        apparentTemperatureC: automatic.apparentTemperatureC,
        timezone: automatic.timezone,
        source: 'automatic',
      };
    }
    const scene = currentScene();
    return { city: scene.city, weather: scene.weather, localTime: sceneLocalTime(scene), source: 'preset' };
  }

  function readStoredSceneId() {
    try { return localStorage.getItem('tm.scene'); } catch (_error) { return null; }
  }

  function storeSceneId(id) {
    try { localStorage.setItem('tm.scene', id); } catch (_error) { /* 隐私模式下不记忆场景。 */ }
  }

  function accentSoft(hex, alpha) {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#38bdf8';
    const channel = offset => parseInt(value.slice(offset, offset + 2), 16);
    return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${alpha})`;
  }

  function applySceneVisual(scene, { immediate = false } = {}) {
    const { visual } = scene;
    const root = document.documentElement.style;
    root.setProperty('--scene-accent', visual.accent);
    root.setProperty('--scene-accent-soft', accentSoft(visual.accent, 0.16));
    root.setProperty('--scene-fallback', visual.fallbackCss);
    root.setProperty('--panel-alpha', String(visual.panelAlpha));
    state.renderer?.setScene(visual, { transitionMs: immediate ? 0 : 900 });
  }

  function clockText(localTime) {
    const match = String(localTime || '').match(/T(\d{2}:\d{2})/);
    return match ? match[1] : formatTime(localTime || new Date());
  }

  function renderSceneState() {
    const automatic = state.automaticEnvironment;
    const scene = currentScene();
    if (automatic) {
      const parts = [automatic.city || '当前位置', automatic.weather || '未知', clockText(automatic.localTime)];
      if (Number.isFinite(Number(automatic.temperatureC))) parts.push(`${Math.round(Number(automatic.temperatureC))}°`);
      elements.sceneEnv.textContent = parts.join(' · ');
    } else {
      elements.sceneEnv.textContent = `${scene.city} · ${scene.weather} · ${Scenes.sceneClock(scene)}`;
    }
    elements.realWeather.classList.toggle('active', Boolean(automatic));
    elements.sceneGrid.querySelectorAll('.scene-card').forEach(card => {
      const active = !automatic && card.dataset.id === scene.id;
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  // D2：只在输入框为空（或仍是上一个场景自动填入的示例句）时填入；用户打过字就只换 placeholder。
  function offerScenePrompt(scene) {
    const typed = elements.input.value;
    if (!typed.trim() || typed === state.scenePromptFill) {
      elements.input.value = scene.prompt;
      state.scenePromptFill = scene.prompt;
      elements.input.placeholder = DEFAULT_PLACEHOLDER;
      resizeComposer();
    } else {
      elements.input.placeholder = scene.prompt;
    }
  }

  function selectScene(id, { fillPrompt = true, immediate = false, persist = true } = {}) {
    const scenes = sceneList();
    const scene = scenes.find(item => item.id === id) || currentScene();
    state.sceneId = scene.id;
    state.automaticEnvironment = null;
    elements.environmentSource.textContent = REAL_WEATHER_HINT;
    if (persist) storeSceneId(scene.id);
    applySceneVisual(scene, { immediate });
    if (fillPrompt) offerScenePrompt(scene);
    renderSceneState();
  }

  function renderSceneGrid() {
    elements.sceneGrid.replaceChildren(...sceneList().map(scene => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'scene-card';
      card.dataset.id = scene.id;
      const thumb = document.createElement('span');
      thumb.className = 'scene-thumb';
      thumb.style.backgroundImage = scene.visual.fallbackCss;
      const copy = document.createElement('span');
      copy.className = 'scene-card-copy';
      const name = document.createElement('strong'); name.textContent = scene.label;
      const meta = document.createElement('small'); meta.textContent = `${scene.city} · ${scene.weather} · ${Scenes.sceneClock(scene)}`;
      copy.append(name, meta);
      card.append(thumb, copy);
      card.addEventListener('click', () => {
        selectScene(scene.id);
        if (compactLayoutQuery.matches) setScenePanelOpen(false);
      });
      return card;
    }));
    renderSceneState();
  }

  function setScenePanelOpen(open) {
    elements.scenePanel.hidden = !open;
    elements.sceneBackdrop.hidden = !open;
    elements.sceneButton.setAttribute('aria-expanded', String(open));
  }

  function setImmersive(active) {
    document.body.classList.toggle('is-immersive', active);
    elements.immersive.setAttribute('aria-pressed', String(active));
    elements.immersive.setAttribute('aria-label', active ? '退出沉浸模式' : '沉浸模式');
    if (active) setScenePanelOpen(false);
  }

  function applyAutomaticEnvironment(resolved) {
    state.automaticEnvironment = resolved;
    const mappedId = Scenes.sceneIdForWeather(resolved.weather);
    if (mappedId) {
      state.sceneId = mappedId;
      applySceneVisual(currentScene());
    }
    const summary = [resolved.city || '当前位置', resolved.weather || '未知'];
    if (Number.isFinite(Number(resolved.temperatureC))) summary.push(`${Math.round(Number(resolved.temperatureC))}°`);
    const apparent = Number.isFinite(Number(resolved.apparentTemperatureC)) ? `，体感 ${Math.round(Number(resolved.apparentTemperatureC))}°` : '';
    elements.environmentSource.textContent = `已用真实天气：${summary.join(' · ')}${apparent}`;
    renderSceneState();
  }

  // D1：真实天气收在场景面板最后一行，只在用户点击时才请求定位。
  async function resolveAutomaticEnvironment() {
    if (!navigator.geolocation) {
      elements.environmentSource.textContent = '浏览器不支持定位，继续使用当前场景';
      return;
    }
    elements.environmentSource.textContent = '正在定位…';
    elements.realWeather.disabled = true;
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 6000, maximumAge: 10 * 60 * 1000,
      }));
      const resolved = await api('/api/environment/resolve', {
        method: 'POST',
        body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      });
      applyAutomaticEnvironment(resolved);
    } catch (_error) {
      elements.environmentSource.textContent = '没拿到真实天气，继续使用当前场景';
    } finally {
      elements.realWeather.disabled = false;
    }
  }

  function startSceneRenderer() {
    const create = window.ThisMomentSceneRenderer?.createSceneRenderer;
    const fallback = () => { state.renderer = null; elements.sceneCanvas.hidden = true; };
    state.renderer = create
      ? create(elements.sceneCanvas, {
        dprCap: 1, staticFrame: reducedMotionQuery.matches, onContextLost: fallback,
        onFirstFrame: () => elements.sceneCanvas.classList.add('is-ready'),
      })
      : null;
    if (!state.renderer) fallback();
  }

  function progress(event) {
    const wasHidden = elements.progress.hidden;
    elements.progress.hidden = false;
    elements.progressTitle.textContent = event.label || '理解这一刻';
    elements.progressNumber.textContent = String(event.progress || 18);
    elements.progressBar.style.width = `${event.progress || 18}%`;
    const order = ['understanding', 'candidates', 'validating', 'composing'];
    const currentIndex = Math.max(0, order.indexOf(event.stage));
    document.querySelectorAll('.progress-steps li').forEach((item, index) => {
      item.classList.toggle('active', index === currentIndex);
      item.classList.toggle('done', index < currentIndex);
    });
    if (wasHidden) elements.progress.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function finishProgress() {
    elements.progressNumber.textContent = '100';
    elements.progressBar.style.width = '100%';
    elements.progressTitle.textContent = '这一刻已经准备好';
    setTimeout(() => { elements.progress.hidden = true; }, 650);
  }

  function directionRow(label, value) {
    const row = document.createElement('div');
    row.className = 'direction-row';
    const name = document.createElement('span'); name.textContent = label;
    const content = document.createElement('strong'); content.textContent = Array.isArray(value) ? value.join(' · ') : value;
    row.append(name, content);
    return row;
  }

  function staticButton(label, className) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.textContent = label;
    return button;
  }

  function createCover(track, className = 'track-cover') {
    const cover = document.createElement('div');
    cover.className = className;
    if (track?.coverUrl) {
      const image = document.createElement('img');
      image.src = track.coverUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        cover.replaceChildren(document.createTextNode(String(track.title || '音').slice(0, 1)));
      }, { once: true });
      cover.append(image);
    } else {
      cover.textContent = String(track?.title || '音').slice(0, 1);
    }
    return cover;
  }

  function isCurrentTrack(card, track) {
    const current = playerState.current();
    return playerState.cardId === card.id && String(current?.id || '') === String(track?.id || '');
  }

  function createTrackRow(card, track, index) {
    const row = document.createElement('div');
    row.className = `track-row${index >= 6 ? ' is-hidden' : ''}${isCurrentTrack(card, track) ? ' is-current' : ''}`;
    row.dataset.ownerCardId = card.id;
    row.dataset.trackId = track.id;
    const cover = createCover(track);
    const name = document.createElement('div'); name.className = 'track-name';
    const title = document.createElement('strong'); title.textContent = track.title;
    const artist = document.createElement('span'); artist.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
    name.append(title, artist);
    const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = formatDuration(track.durationMs);
    const play = document.createElement('button'); play.type = 'button'; play.className = 'track-play'; play.setAttribute('aria-label', `播放 ${track.title}`);
    play.dataset.uiKey = `track-${track.id}`;
    play.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z"/></svg>';
    play.addEventListener('click', () => {
      if (isCurrentTrack(card, track) && !elements.audio.paused) elements.audio.pause();
      else playTrack(card, index);
    });
    row.append(cover, name, duration, play);
    return row;
  }

  function createCard(card) {
    const turn = document.createElement('article');
    turn.className = 'conversation-turn';
    turn.dataset.cardId = card.id;
    turn.dataset.userPrompt = card.userInput || '';

    const userWrap = document.createElement('div'); userWrap.className = 'user-message-wrap';
    const user = document.createElement('p'); user.className = 'message-user'; user.textContent = card.userInput || '来点适合此刻的音乐';
    const meta = document.createElement('span'); meta.className = 'message-meta'; meta.textContent = environmentMeta(card.environment, card.createdAt);
    userWrap.append(user, meta);

    const assistant = document.createElement('div'); assistant.className = 'assistant-message';
    const avatar = document.createElement('span'); avatar.className = 'assistant-avatar'; avatar.textContent = 'AI'; avatar.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div'); copy.className = 'recommendation-copy';
    const eyebrow = document.createElement('p'); eyebrow.className = 'recommendation-eyebrow'; eyebrow.textContent = '为这一刻推荐';
    const title = document.createElement('h2'); title.textContent = card.title || '这一刻的歌';
    const description = document.createElement('p'); description.textContent = card.description;
    copy.append(eyebrow, title, description); assistant.append(avatar, copy);

    const article = document.createElement('div');
    article.className = 'music-card';
    const heading = document.createElement('div'); heading.className = 'card-heading';
    const songCount = document.createElement('span'); songCount.className = 'song-count'; songCount.textContent = `推荐歌曲 · ${card.tracks.length}`;
    const headingMeta = document.createElement('div'); headingMeta.className = 'card-heading-meta';
    const provider = document.createElement('strong'); provider.textContent = card.provider === 'demo' ? '本地演示音源' : '网易云音乐';
    const cardTime = document.createElement('span'); cardTime.textContent = formatDate(card.createdAt);
    headingMeta.append(provider, cardTime); heading.append(songCount, headingMeta); article.append(heading);

    if (card.warning) {
      const warning = document.createElement('p'); warning.className = 'card-warning'; warning.textContent = card.warning; article.append(warning);
    }
    const list = document.createElement('div'); list.className = 'track-list';
    (card.tracks || []).forEach((track, index) => list.append(createTrackRow(card, track, index)));
    article.append(list);
    const footer = document.createElement('div'); footer.className = 'card-footer';
    const source = document.createElement('div'); source.className = 'card-source';
    const badge = document.createElement('span'); badge.className = 'source-badge'; badge.textContent = card.provider === 'demo' ? '演示音源' : '网易云';
    const view = narrationView(card);
    const sourceText = document.createElement('span'); sourceText.className = 'narration-status'; sourceText.textContent = `${card.tracks.length} 首 · ${view.statusText}`;
    sourceText.setAttribute('role', 'status');
    sourceText.setAttribute('aria-live', 'polite');
    source.append(badge, sourceText);
    const expand = staticButton(card.tracks.length > 6 ? `查看全部 ${card.tracks.length} 首` : '已显示全部', 'expand-button');
    expand.disabled = card.tracks.length <= 6;
    expand.dataset.uiKey = 'tracks';
    expand.dataset.expanded = 'false';
    expand.addEventListener('click', () => {
      const expanding = expand.dataset.expanded !== 'true';
      expand.dataset.expanded = String(expanding);
      syncTrackExpansion(expand, expanding);
    });
    footer.append(source, expand); article.append(footer);

    const actions = document.createElement('div'); actions.className = 'card-followups';
    const speak = staticButton(view.label, 'secondary-action narration-control');
    syncNarrationControl(speak, view);
    speak.dataset.uiKey = 'narration';
    const refine = staticButton('再轻松一点', 'text-action');
    refine.dataset.uiKey = 'refine';
    const refresh = staticButton('换一批', 'text-action');
    refresh.dataset.uiKey = 'refresh';
    speak.addEventListener('click', () => handleNarrationAction(card));
    refine.addEventListener('click', () => submitPrompt('再轻松一点，但保持有精神'));
    refresh.addEventListener('click', () => submitPrompt('换一批'));
    actions.append(speak, refine, refresh);

    const reason = document.createElement('details'); reason.className = 'recommendation-reason';
    reason.dataset.uiKey = 'reason';
    const reasonSummary = document.createElement('summary'); reasonSummary.textContent = '查看推荐依据';
    reasonSummary.dataset.uiKey = 'reason-summary';
    const directions = document.createElement('div'); directions.className = 'direction-list';
    directions.append(
      directionRow('氛围', card.direction?.atmosphere || []),
      directionRow('能量', card.direction?.energy || '未指定'),
      directionRow('节奏', card.direction?.rhythm || []),
    );
    reason.append(reasonSummary, directions);

    turn.append(userWrap, assistant, article, actions, reason);
    return turn;
  }

  function handleNarrationAction(card) {
    activateNarrationControl(card, {
      retry: () => { void retryTts(card); },
      play: () => { void narration.play(card); },
    });
  }

  function syncTrackExpansion(button, expanded) {
    const article = button.closest('.music-card');
    if (!article) return;
    button.dataset.expanded = String(expanded);
    article.querySelectorAll('.track-row').forEach((row, index) => row.classList.toggle('is-hidden', !expanded && index >= 6));
    button.textContent = expanded ? '收起歌曲' : `查看全部 ${article.querySelectorAll('.track-row').length} 首`;
  }

  function findCardElement(cardId) {
    return [...elements.cards.querySelectorAll('[data-card-id]')]
      .find(element => String(element.dataset.cardId) === String(cardId)) || null;
  }

  function updateNarrationCard(card) {
    const element = findCardElement(card.id);
    if (!element) return;
    const view = narrationView(card);
    const status = element.querySelector('.narration-status');
    const control = element.querySelector('.narration-control');
    if (status) status.textContent = `${card.tracks.length} 首 · ${view.statusText}`;
    if (control) syncNarrationControl(control, view);
  }

  function renderCards() {
    const uiState = captureCardUiState(elements.cards);
    const cards = [...state.cards.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    elements.empty.hidden = cards.length > 0;
    const turns = cards.map(createCard);
    turns.forEach(turn => {
      if (!state.hydrating && !state.renderedCardIds.has(turn.dataset.cardId)) turn.classList.add('is-new');
      state.renderedCardIds.add(turn.dataset.cardId);
    });
    elements.cards.replaceChildren(...turns);
    restoreCardUiState(elements.cards, uiState, { onExpanded: syncTrackExpansion });
    updatePlayingRows();
  }

  function reconcileSnapshots(snapshots) {
    const newCards = [];
    (snapshots || []).forEach(snapshot => {
      const existing = state.cards.get(snapshot.id);
      if (existing) reconcileCard(existing, snapshot, ttsState);
      else {
        const card = { ...snapshot };
        state.cards.set(card.id, card);
        newCards.push(card);
      }
    });
    return newCards;
  }

  function applyTtsReady(card, ttsUrl, options = {}) {
    const result = ttsState.applyReady(card, ttsUrl, options);
    if (!result.accepted) return result;
    updateNarrationCard(card);
    if (card.id === narration.latestCardId && ttsState.claimAutoplay(card)) void narration.autoplay(card);
    return result;
  }

  function completeCard(snapshot) {
    const existing = state.cards.get(snapshot.id);
    const card = existing ? reconcileCard(existing, snapshot, ttsState) : { ...snapshot };
    if (!existing) state.cards.set(card.id, card);
    narration.setLatestCardId(card.id);
    renderCards();
    if (card.ttsStatus === 'ready' && card.ttsUrl) applyTtsReady(card, card.ttsUrl);
  }

  async function submitPrompt(prompt) {
    if (state.generating) return showToast('上一个音乐方向还在生成，稍等一下。');
    const userInput = String(prompt || elements.input.value).trim();
    if (!userInput) return elements.input.focus();
    if (prompt) elements.input.value = userInput;
    const submittedEnvironment = environment();
    state.pendingEnvironment = submittedEnvironment;
    elements.pendingMessage.textContent = userInput;
    elements.pendingMeta.textContent = environmentMeta(submittedEnvironment);
    state.generating = true; elements.send.disabled = true;
    progress({ stage: 'understanding', label: '理解这一刻', progress: 18 });
    try {
      await api('/api/recommendations', {
        method: 'POST',
        body: JSON.stringify({ sessionId, userInput, environment: submittedEnvironment }),
      });
      elements.input.value = '';
      resizeComposer();
      generationPoller.start(GENERATION_POLL_CONFIG.initialDelay);
    } catch (error) {
      state.generating = false; elements.send.disabled = false; elements.progress.hidden = true; showToast(error.message);
    }
  }

  async function pollGeneration() {
    if (!state.generating) return { done: true, value: null };
    const { cards } = await api(`/api/cards?sessionId=${encodeURIComponent(sessionId)}`);
    const newCards = reconcileSnapshots(cards);
    const generationCards = selectGenerationCards(newCards, { historyHydrated: state.historyHydrated });
    renderCards();
    return { done: generationCards.length > 0, value: generationCards };
  }

  function finishPolledGeneration(newCards) {
    if (!newCards?.length || !state.generating) return;
    const card = [...newCards].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
    narration.setLatestCardId(card.id);
    newCards.forEach(item => {
      if (item !== card && item.ttsStatus === 'ready' && item.ttsUrl) ttsState.applyReady(item, item.ttsUrl);
    });
    if (card.ttsStatus === 'ready' && card.ttsUrl) applyTtsReady(card, card.ttsUrl);
    state.generating = false;
    elements.send.disabled = false;
    finishProgress();
  }

  function handleSocketEvent(event) {
    if (event.type === 'progress') progress(event);
    if (event.type === 'complete') {
      generationPoller.cancel();
      completeCard(event.card); state.generating = false; elements.send.disabled = false; finishProgress();
      setTimeout(() => document.querySelector(`[data-card-id="${CSS.escape(event.card.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }
    if (event.type === 'failed') {
      generationPoller.cancel();
      state.generating = false; elements.send.disabled = false; elements.progress.hidden = true; showToast(event.error || '生成失败。');
    }
    if (event.type === 'tts-ready') {
      const card = state.cards.get(event.cardId);
      if (card) applyTtsReady(card, event.ttsUrl);
    }
    if (event.type === 'tts-failed') {
      const card = state.cards.get(event.cardId);
      if (card) {
        const result = ttsState.applyFailed(card, event.error || null);
        if (result.accepted) updateNarrationCard(card);
      }
    }
  }

  function connectSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/stream?sessionId=${encodeURIComponent(sessionId)}`);
    state.socket = socket;
    socket.addEventListener('message', message => {
      try {
        const event = JSON.parse(message.data);
        if (state.hydrating) state.queuedSocketEvents.push(event);
        else handleSocketEvent(event);
      } catch { /* Ignore malformed events. */ }
    });
    socket.addEventListener('close', () => setTimeout(connectSocket, 1800));
  }

  async function retryTts(card) {
    const retryToken = ttsState.beginRetry(card);
    updateNarrationCard(card);
    try {
      const result = await api(`/api/cards/${encodeURIComponent(card.id)}/tts/retry`, { method: 'POST' });
      if (result.ttsStatus === 'ready') applyTtsReady(card, result.ttsUrl, { retryToken });
      else {
        const reduced = ttsState.applyFailed(card, result.error, { retryToken });
        if (reduced.accepted) updateNarrationCard(card);
      }
    } catch (error) {
      const result = ttsState.applyFailed(card, error.message, { retryToken });
      if (result.accepted) {
        updateNarrationCard(card);
        showToast(error.message || '推荐语重试失败。');
      }
    }
  }

  async function playTrack(card, index) {
    narration.stop();
    playerState.replaceQueue(card.id, card.tracks, index);
    await playCurrent();
  }

  function updatePlayer(track) {
    elements.player.classList.remove('is-empty');
    elements.playerTitle.textContent = track?.title || '还没有播放音乐';
    elements.playerArtist.textContent = track?.artist || '从一张卡片开始';
    elements.queue.textContent = track ? `${playerState.index + 1} / ${playerState.queue.length}` : '0 / 0';
    const accent = /^hsl\([^)]+\)$/.test(track?.accent || '') ? track.accent : '';
    elements.playerCover.style.background = accent || '';
    elements.playerCover.replaceChildren();
    if (track?.coverUrl) {
      const image = document.createElement('img');
      image.src = track.coverUrl; image.alt = '';
      image.addEventListener('error', () => { elements.playerCover.textContent = String(track.title).slice(0, 1); }, { once: true });
      elements.playerCover.append(image);
    } else {
      elements.playerCover.textContent = track ? String(track.title).slice(0, 1) : 'tm';
    }
    updatePlayingRows();
  }

  function updatePlayingRows() {
    const current = playerState.current();
    document.querySelectorAll('.track-row').forEach(row => {
      const isCurrent = row.dataset.ownerCardId === playerState.cardId && String(row.dataset.trackId) === String(current?.id || '');
      row.classList.toggle('is-current', isCurrent);
      const button = row.querySelector('.track-play');
      if (button) button.setAttribute('aria-label', isCurrent && !elements.audio.paused ? `暂停 ${current.title}` : `播放 ${row.querySelector('.track-name strong')?.textContent || '歌曲'}`);
    });
  }

  function resizeComposer() {
    elements.input.style.height = 'auto';
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 132)}px`;
  }

  async function playCurrent() {
    const track = playerState.current();
    if (!track) { stopSong(); return; }
    const cardId = playerState.cardId;
    stopSong();
    const request = selectionGate.begin(cardId, track.id);
    try {
      const { url } = await api('/api/playback/resolve', {
        method: 'POST', body: JSON.stringify({ provider: track.provider, trackId: track.id }), signal: request.signal,
      });
      if (!ownsCurrentSelection(request)) return;
      updatePlayer(track);
      elements.audio.src = url;
      await elements.audio.play();
      if (!ownsCurrentSelection(request)) return;
      elements.player.classList.add('is-playing');
      api('/api/play-events', { method: 'POST', body: JSON.stringify({ sessionId, cardId, trackId: track.id, type: 'play' }) }).catch(() => {});
    } catch (error) {
      if (!ownsCurrentSelection(request)) return;
      stopSong();
      if (error?.name !== 'AbortError') showToast(error.message || '这首歌暂时无法播放。');
    }
  }

  function ownsCurrentSelection(request) {
    return selectionGate.owns(request, playerState.cardId, playerState.current()?.id);
  }

  function nextTrack() { narration.stop(); if (playerState.next()) playCurrent(); else stopSong(); }
  function previousTrack() { narration.stop(); playerState.previous(); playCurrent(); }
  function stopSong() {
    selectionGate.invalidate();
    elements.audio.pause();
    elements.audio.removeAttribute('src');
    elements.audio.load();
    elements.audio.currentTime = 0;
    elements.seek.value = '0';
    elements.current.textContent = '0:00';
    elements.player.classList.remove('is-playing');
    updatePlayingRows();
  }

  elements.form.addEventListener('submit', event => { event.preventDefault(); submitPrompt(); });
  elements.input.addEventListener('input', resizeComposer);
  elements.input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { elements.input.value = button.dataset.prompt; elements.input.focus(); }));
  elements.play.addEventListener('click', () => {
    if (!playerState.current()) return showToast('先从音乐卡片选一首歌。');
    if (elements.audio.paused) {
      narration.stop();
      if (elements.audio.getAttribute('src')) elements.audio.play().catch(error => showToast(error.message));
      else playCurrent();
    } else elements.audio.pause();
  });
  elements.previous.addEventListener('click', previousTrack);
  elements.next.addEventListener('click', nextTrack);
  elements.audio.addEventListener('play', () => { elements.player.classList.add('is-playing'); elements.play.setAttribute('aria-label', '暂停'); updatePlayingRows(); });
  elements.audio.addEventListener('pause', () => { elements.player.classList.remove('is-playing'); elements.play.setAttribute('aria-label', '播放'); updatePlayingRows(); });
  elements.audio.addEventListener('ended', stopSong);
  elements.audio.addEventListener('error', () => {
    if (!elements.audio.getAttribute('src')) return;
    const action = playerState.onPlaybackError();
    if (action === 'refresh') playCurrent();
    if (action === 'stop') { showToast('播放地址仍不可用，请手动选择其他歌曲。'); stopSong(); }
  });
  elements.audio.addEventListener('timeupdate', () => {
    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    elements.seek.value = duration ? String((elements.audio.currentTime / duration) * 100) : '0';
    elements.current.textContent = formatDuration(elements.audio.currentTime * 1000);
    elements.duration.textContent = formatDuration(duration * 1000);
    syncSeekFill();
  });
  elements.seek.addEventListener('input', () => {
    if (Number.isFinite(elements.audio.duration)) elements.audio.currentTime = elements.audio.duration * (Number(elements.seek.value) / 100);
  });
  function syncSeekFill() { elements.seek.style.setProperty('--seek-progress', `${Number(elements.seek.value) || 0}%`); }
  elements.seek.addEventListener('input', syncSeekFill);
  elements.audio.addEventListener('emptied', () => elements.seek.style.setProperty('--seek-progress', '0%'));
  elements.mute.addEventListener('click', () => { elements.audio.muted = !elements.audio.muted; elements.mute.setAttribute('aria-label', elements.audio.muted ? '取消静音' : '静音'); });

  async function initialize() {
    connectSocket();
    const results = await Promise.allSettled([
      api('/api/status'), api('/api/environment-presets'), api(`/api/cards?sessionId=${encodeURIComponent(sessionId)}`),
    ]);
    if (results[0].status === 'fulfilled') {
      const status = results[0].value;
      elements.mode.classList.add('live');
      const modeLabel = status.mode === 'demo' ? '本地演示音源' : '实时网易云音源';
      elements.mode.title = modeLabel;
      const modeText = elements.mode.querySelector('.sr-only');
      if (modeText) modeText.textContent = modeLabel;
    }
    if (results[1].status === 'fulfilled') { state.presets = results[1].value.presets || []; renderSceneGrid(); }
    if (results[2].status === 'fulfilled') {
      reconcileSnapshots(results[2].value.cards);
      state.historyHydrated = true;
      state.cards.forEach(card => {
        if (card.ttsStatus === 'ready' && card.ttsUrl) ttsState.applyReady(card, card.ttsUrl);
      });
      renderCards();
    }
    state.hydrating = false;
    state.queuedSocketEvents.splice(0).forEach(handleSocketEvent);
    if (results.some(result => result.status === 'rejected')) showToast('部分状态暂时未连接，可刷新页面重试。');
  }

  document.addEventListener('click', event => {
    if (elements.scenePanel.hidden) return;
    if (elements.scenePanel.contains(event.target) || elements.sceneButton.contains(event.target)) return;
    setScenePanelOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!elements.scenePanel.hidden) { setScenePanelOpen(false); elements.sceneButton.focus(); }
    else if (document.body.classList.contains('is-immersive')) setImmersive(false);
  });
  elements.sceneButton.addEventListener('click', () => setScenePanelOpen(elements.scenePanel.hidden));
  elements.randomScene.addEventListener('click', () => selectScene(Scenes.pickRandomScene(state.sceneId).id));
  elements.immersive.addEventListener('click', () => setImmersive(!document.body.classList.contains('is-immersive')));
  elements.scrollTop.addEventListener('click', () => {
    elements.feed.scrollTo({ top: 0, behavior: reducedMotionQuery.matches ? 'auto' : 'smooth' });
  });
  elements.realWeather.addEventListener('click', resolveAutomaticEnvironment);
  window.addEventListener('pointermove', event => {
    state.renderer?.setPointer(event.clientX / window.innerWidth, event.clientY / window.innerHeight, true);
  }, { passive: true });
  ['pointerleave', 'pointercancel', 'blur'].forEach(type => window.addEventListener(type, () => state.renderer?.setPointer(0, 0, false)));
  document.documentElement.addEventListener('pointerleave', () => state.renderer?.setPointer(0, 0, false));

  startSceneRenderer();
  renderSceneGrid();
  selectScene(readStoredSceneId() || Scenes.DEFAULT_SCENE_ID, { fillPrompt: false, immediate: true, persist: false });
  resizeComposer();
  initialize();
}());
