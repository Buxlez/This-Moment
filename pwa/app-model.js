(function exposeAppModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThisMomentAppModel = api;
}(typeof window !== 'undefined' ? window : globalThis, function appModelFactory() {
  class RequestGate {
    constructor({ createAbortController } = {}) {
      this.createAbortController = createAbortController || (() => (
        typeof AbortController === 'function' ? new AbortController() : null
      ));
      this.generation = 0;
      this.active = null;
    }

    begin(cardId, trackId) {
      this.cancelActive();
      this.generation += 1;
      let controller = null;
      try { controller = this.createAbortController(); } catch (_error) { controller = null; }
      const request = {
        generation: this.generation,
        cardId: String(cardId),
        trackId: String(trackId),
        controller,
        signal: controller?.signal,
      };
      this.active = request;
      return request;
    }

    invalidate() {
      this.cancelActive();
      this.generation += 1;
      this.active = null;
    }

    owns(request, cardId, trackId) {
      return Boolean(request)
        && this.active === request
        && request.generation === this.generation
        && request.cardId === String(cardId)
        && request.trackId === String(trackId);
    }

    cancelActive() {
      try { this.active?.controller?.abort(); } catch (_error) { /* Abort is best effort. */ }
    }
  }

  class TtsState {
    constructor() {
      this.generations = new Map();
      this.activeRetries = new Map();
      this.readyUrls = new Map();
      this.autoplayUrls = new Map();
    }

    beginRetry(card) {
      const cardId = String(card.id);
      const generation = (this.generations.get(cardId) || 0) + 1;
      const token = { cardId, generation };
      this.generations.set(cardId, generation);
      this.activeRetries.set(cardId, token);
      this.readyUrls.delete(cardId);
      this.autoplayUrls.delete(cardId);
      card.ttsStatus = 'pending';
      card.ttsUrl = null;
      card.ttsError = null;
      return token;
    }

    hasActiveRetry(cardId) {
      return this.activeRetries.has(String(cardId));
    }

    isCurrentRetry(token) {
      return Boolean(token) && this.activeRetries.get(String(token.cardId)) === token;
    }

    applyReady(card, ttsUrl, { retryToken } = {}) {
      const safeTtsUrl = normalizeTtsUrl(ttsUrl);
      if (!safeTtsUrl) return { accepted: false, becameReady: false };
      if (!this.acceptSource(card, retryToken)) return { accepted: false, becameReady: false };
      const cardId = String(card.id);
      const becameReady = this.readyUrls.get(cardId) !== safeTtsUrl;
      this.readyUrls.set(cardId, safeTtsUrl);
      card.ttsStatus = 'ready';
      card.ttsUrl = safeTtsUrl;
      card.ttsError = null;
      return { accepted: true, becameReady };
    }

    applyFailed(card, error, { retryToken } = {}) {
      if (!this.acceptSource(card, retryToken)) return { accepted: false, becameReady: false };
      if (!retryToken && card.ttsStatus === 'ready') return { accepted: false, becameReady: false };
      card.ttsStatus = 'failed';
      card.ttsUrl = null;
      card.ttsError = error || null;
      this.readyUrls.delete(String(card.id));
      return { accepted: true, becameReady: false };
    }

    claimAutoplay(card) {
      if (card.ttsStatus !== 'ready' || !card.ttsUrl) return false;
      const cardId = String(card.id);
      if (this.autoplayUrls.get(cardId) === card.ttsUrl) return false;
      this.autoplayUrls.set(cardId, card.ttsUrl);
      return true;
    }

    acceptSource(card, retryToken) {
      const cardId = String(card.id);
      if (retryToken) {
        if (!this.isCurrentRetry(retryToken) || retryToken.cardId !== cardId) return false;
        this.activeRetries.delete(cardId);
        return true;
      }
      return !this.hasActiveRetry(cardId);
    }
  }

  function normalizeTtsUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const candidate = value.trim();
    try {
      const parsed = new URL(candidate, 'https://this-moment.invalid');
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null;
    } catch (_error) {
      return null;
    }
  }

  class PollController {
    constructor({
      task,
      schedule = (callback, delay) => setTimeout(callback, delay),
      cancelSchedule = handle => clearTimeout(handle),
      retryDelays = [1600, 2400, 4000],
      onComplete = () => {},
      onExhausted = () => {},
    } = {}) {
      this.task = task;
      this.schedule = schedule;
      this.cancelSchedule = cancelSchedule;
      this.retryDelays = [...retryDelays];
      this.onComplete = onComplete;
      this.onExhausted = onExhausted;
      this.generation = 0;
      this.timer = null;
      this.active = false;
      this.attempts = 0;
      this.lastError = null;
    }

    start(initialDelay = 0) {
      this.cancel();
      this.active = true;
      this.attempts = 0;
      this.lastError = null;
      const generation = this.generation;
      this.scheduleRun(generation, initialDelay);
    }

    cancel() {
      if (this.timer !== null) {
        try { this.cancelSchedule(this.timer); } catch (_error) { /* Timer cleanup is best effort. */ }
      }
      this.timer = null;
      this.active = false;
      this.generation += 1;
    }

    scheduleRun(generation, delay) {
      this.timer = this.schedule(() => {
        this.timer = null;
        void this.run(generation);
      }, delay);
    }

    async run(generation) {
      if (!this.active || generation !== this.generation) return;
      this.attempts += 1;
      let result = null;
      try {
        result = await this.task();
      } catch (error) {
        this.lastError = error;
      }
      if (!this.active || generation !== this.generation) return;
      if (result?.done) {
        this.active = false;
        this.onComplete(result.value);
        return;
      }
      if (this.attempts > this.retryDelays.length) {
        this.active = false;
        this.onExhausted(this.lastError);
        return;
      }
      this.scheduleRun(generation, this.retryDelays[this.attempts - 1]);
    }
  }

  function reconcileCard(existing, snapshot, ttsState) {
    const synthesisKeys = new Set(['ttsStatus', 'ttsUrl', 'ttsError', 'ttsPlaybackStatus']);
    Object.entries(snapshot || {}).forEach(([key, value]) => {
      if (!synthesisKeys.has(key)) existing[key] = value;
    });

    if (!snapshot || ttsState.hasActiveRetry(existing.id) || !Object.hasOwn(snapshot, 'ttsStatus')) return existing;
    if (snapshot.ttsStatus === 'ready' && snapshot.ttsUrl) {
      ttsState.applyReady(existing, snapshot.ttsUrl);
    } else if (existing.ttsStatus !== 'ready' && existing.ttsStatus !== 'failed') {
      existing.ttsStatus = snapshot.ttsStatus;
      existing.ttsUrl = snapshot.ttsUrl || null;
      existing.ttsError = snapshot.ttsError || null;
    }
    return existing;
  }

  function narrationView(card) {
    if (card.ttsPlaybackStatus === 'playing') {
      return { label: '正在播放推荐语', disabled: true, action: null, statusText: '正在播放推荐语' };
    }
    if (card.ttsPlaybackStatus === 'blocked') {
      return { label: '点击播放推荐语', disabled: false, action: 'play', statusText: '推荐语等待点击播放' };
    }
    if (card.ttsStatus === 'failed') {
      return { label: '重试推荐语', disabled: false, action: 'retry', statusText: '推荐语生成失败' };
    }
    if (card.ttsPlaybackStatus === 'failed' && card.ttsStatus === 'ready' && card.ttsUrl) {
      return { label: '重新播放推荐语', disabled: false, action: 'play', statusText: '推荐语播放失败' };
    }
    if (card.ttsStatus === 'ready' && card.ttsUrl) {
      return { label: '播放推荐语', disabled: false, action: 'play', statusText: '推荐语已就绪' };
    }
    return { label: '推荐语生成中', disabled: true, action: null, statusText: '推荐语生成中' };
  }

  function syncNarrationControl(control, view) {
    control.textContent = view.label;
    control.setAttribute('aria-disabled', String(view.disabled));
  }

  function activateNarrationControl(card, { play = () => {}, retry = () => {} } = {}) {
    const view = narrationView(card);
    if (view.disabled || !view.action) return false;
    if (view.action === 'play') play(card);
    if (view.action === 'retry') retry(card);
    return true;
  }

  function captureCardUiState(root) {
    const cards = [...root.querySelectorAll('[data-card-id]')].map(card => ({
      cardId: String(card.dataset.cardId),
      openKeys: [...card.querySelectorAll('details[data-ui-key]')]
        .filter(element => element.open)
        .map(element => element.dataset.uiKey),
      expandedKeys: [...card.querySelectorAll('[data-ui-key][data-expanded]')]
        .filter(element => element.dataset.expanded === 'true')
        .map(element => element.dataset.uiKey),
    }));
    const activeElement = root.ownerDocument?.activeElement;
    const activeCard = activeElement?.closest?.('[data-card-id]');
    const focus = activeCard && activeElement?.dataset?.uiKey
      ? { cardId: String(activeCard.dataset.cardId), key: activeElement.dataset.uiKey }
      : null;
    return { cards, focus };
  }

  function restoreCardUiState(root, snapshot, { onExpanded = () => {} } = {}) {
    const cards = [...root.querySelectorAll('[data-card-id]')];
    (snapshot?.cards || []).forEach(saved => {
      const card = cards.find(element => String(element.dataset.cardId) === saved.cardId);
      if (!card) return;
      card.querySelectorAll('details[data-ui-key]').forEach(element => {
        element.open = saved.openKeys.includes(element.dataset.uiKey);
      });
      card.querySelectorAll('[data-ui-key][data-expanded]').forEach(element => {
        const expanded = saved.expandedKeys.includes(element.dataset.uiKey);
        element.dataset.expanded = String(expanded);
        onExpanded(element, expanded);
      });
    });
    if (!snapshot?.focus) return;
    const focusCard = cards.find(element => String(element.dataset.cardId) === snapshot.focus.cardId);
    const target = [...(focusCard?.querySelectorAll('[data-ui-key]') || [])]
      .find(element => element.dataset.uiKey === snapshot.focus.key);
    target?.focus?.();
  }

  function selectGenerationCards(cards, { historyHydrated } = {}) {
    return historyHydrated ? [...(cards || [])] : [];
  }

  return {
    RequestGate, TtsState, PollController, reconcileCard, narrationView, captureCardUiState, restoreCardUiState,
    selectGenerationCards, syncNarrationControl, activateNarrationControl,
  };
}));
