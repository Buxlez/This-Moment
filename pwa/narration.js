(function exposeNarration(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.NarrationController = api.NarrationController;
    root.ThisMomentNarration = api;
  }
}(typeof window !== 'undefined' ? window : globalThis, function narrationFactory(root) {
  function hasReadyUrl(card) {
    if (!card?.ttsUrl) return false;
    return card.ttsStatus === undefined || card.ttsStatus === 'ready';
  }

  function isPolicyBlock(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return name === 'NotAllowedError'
      || /NotAllowedError|autoplay|user (gesture|interaction)/i.test(message);
  }

  class NarrationController {
    constructor({ createAudio, isSongPlaying = () => false, onStateChange, onStatus } = {}) {
      this.createAudio = createAudio || (url => new root.Audio(url));
      this.isSongPlaying = isSongPlaying;
      this.onStateChange = onStateChange || (() => {});
      this.onStatus = onStatus || (() => {});
      this.latestCardId = null;
      this.autoHandled = new Set();
      this.active = null;
    }

    setLatestCardId(cardId) {
      this.latestCardId = cardId;
    }

    async autoplay(card) {
      if (!hasReadyUrl(card)
        || card.id !== this.latestCardId
        || this.autoHandled.has(card.id)) {
        return 'skipped';
      }

      this.autoHandled.add(card.id);
      if (this.isSongPlaying()) return 'skipped';
      return this.play(card);
    }

    async play(card) {
      if (!hasReadyUrl(card)) return 'unavailable';

      this.stop();

      let audio;
      try {
        audio = this.createAudio(card.ttsUrl);
      } catch (error) {
        this.setState(card, 'failed');
        return 'failed';
      }

      const entry = {
        audio,
        card,
        playing: false,
        onEnded: null,
        onError: null,
      };

      entry.onEnded = () => {
        if (this.active !== entry) return;
        this.release(entry);
        this.setState(card, 'ready');
      };
      entry.onError = () => {
        if (this.active !== entry) return;
        this.release(entry);
        this.setState(card, 'failed');
      };

      audio.addEventListener('ended', entry.onEnded);
      audio.addEventListener('error', entry.onError);
      this.active = entry;

      try {
        await audio.play();
        if (this.active !== entry) return 'stopped';
        entry.playing = true;
        this.setState(card, 'playing');
        return 'playing';
      } catch (error) {
        if (this.active !== entry) return 'stopped';
        this.release(entry);
        const status = isPolicyBlock(error) ? 'blocked' : 'failed';
        this.setState(card, status);
        return status;
      }
    }

    stop() {
      const entry = this.active;
      if (!entry) return;

      this.release(entry);
      if (typeof entry.audio.pause === 'function') entry.audio.pause();
      if (typeof entry.audio.removeAttribute === 'function') {
        entry.audio.removeAttribute('src');
      } else if ('src' in entry.audio) {
        entry.audio.src = '';
      }
      if (entry.playing) this.setState(entry.card, 'ready');
    }

    release(entry) {
      entry.audio.removeEventListener('ended', entry.onEnded);
      entry.audio.removeEventListener('error', entry.onError);
      if (this.active === entry) this.active = null;
    }

    setState(card, status) {
      card.ttsPlaybackStatus = status;
      this.onStateChange(card, status);
      this.onStatus(card.id, status);
    }
  }

  return { NarrationController };
}));
