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
      || name === 'SecurityError'
      || /\buser (?:did not|didn't|has not|hasn't) interact(?:ed)?\b/i.test(message)
      || /\brequires? (?:a )?user gesture\b/i.test(message)
      || /\buser gesture (?:is )?required\b/i.test(message)
      || /\bwithout (?:a )?user gesture\b/i.test(message);
  }

  class NarrationController {
    constructor({
      createAudio,
      isSongPlaying = () => false,
      onStateChange,
      onStatus,
      onObserverError,
    } = {}) {
      this.createAudio = createAudio || (url => new root.Audio(url));
      this.isSongPlaying = isSongPlaying;
      this.onStateChange = onStateChange || (() => {});
      this.onStatus = onStatus || (() => {});
      this.onObserverError = onObserverError || (() => {});
      this.latestCardId = null;
      this.latestGeneration = 0;
      this.autoHandled = new Set();
      this.active = null;
    }

    setLatestCardId(cardId) {
      if (cardId === this.latestCardId) return;

      this.latestCardId = cardId;
      this.latestGeneration += 1;
      this.autoHandled.clear();

      const entry = this.active;
      if (entry?.automatic && !entry.playing && entry.card.id !== cardId) {
        this.dispose(entry);
      }
    }

    async autoplay(card) {
      if (!hasReadyUrl(card)
        || card.id !== this.latestCardId
        || this.autoHandled.has(card.id)) {
        return 'skipped';
      }

      this.autoHandled.add(card.id);
      if (this.isSongPlaying()) return 'skipped';
      return this.start(card, {
        automatic: true,
        generation: this.latestGeneration,
      });
    }

    async play(card) {
      return this.start(card, { automatic: false, generation: null });
    }

    async start(card, { automatic, generation }) {
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
        automatic,
        generation,
        playing: false,
        disposed: false,
        onEnded: null,
        onError: null,
      };

      entry.onEnded = () => {
        if (this.active !== entry) return;
        this.dispose(entry);
        this.setState(card, 'ready');
      };
      entry.onError = () => {
        if (this.active !== entry) return;
        this.dispose(entry);
        this.setState(card, 'failed');
      };

      try {
        audio.addEventListener('ended', entry.onEnded);
        audio.addEventListener('error', entry.onError);
      } catch (error) {
        this.dispose(entry);
        this.setState(card, 'failed');
        return 'failed';
      }
      this.active = entry;

      let mediaError = null;
      try {
        await audio.play();
      } catch (error) {
        mediaError = error;
      }

      if (!this.ownsCompletion(entry)) {
        if (this.active === entry) this.dispose(entry);
        return 'stopped';
      }

      if (mediaError) {
        this.dispose(entry);
        const status = isPolicyBlock(mediaError) ? 'blocked' : 'failed';
        this.setState(card, status);
        return status;
      }

      entry.playing = true;
      this.setState(card, 'playing');
      return 'playing';
    }

    stop() {
      const entry = this.active;
      if (!entry) return;

      this.dispose(entry);
      if (entry.playing) this.setState(entry.card, 'ready');
    }

    ownsCompletion(entry) {
      if (this.active !== entry || entry.disposed) return false;
      if (!entry.automatic) return true;
      return entry.generation === this.latestGeneration
        && entry.card.id === this.latestCardId;
    }

    dispose(entry) {
      if (!entry || entry.disposed) return;
      entry.disposed = true;

      this.safeMediaCall(() => entry.audio.removeEventListener('ended', entry.onEnded));
      this.safeMediaCall(() => entry.audio.removeEventListener('error', entry.onError));
      if (this.active === entry) this.active = null;

      if (entry.audio.paused !== true && typeof entry.audio.pause === 'function') {
        this.safeMediaCall(() => entry.audio.pause());
      }

      let sourceRemoved = false;
      if (typeof entry.audio.removeAttribute === 'function') {
        sourceRemoved = this.safeMediaCall(() => entry.audio.removeAttribute('src'));
      }
      if (!sourceRemoved && 'src' in entry.audio) {
        this.safeMediaCall(() => { entry.audio.src = ''; });
      }
      if (typeof entry.audio.load === 'function') {
        this.safeMediaCall(() => entry.audio.load());
      }
    }

    safeMediaCall(callback) {
      try {
        callback();
        return true;
      } catch (_error) {
        return false;
      }
    }

    setState(card, status) {
      card.ttsPlaybackStatus = status;
      this.notifyObserver('onStateChange', () => this.onStateChange(card, status));
      this.notifyObserver('onStatus', () => this.onStatus(card.id, status));
    }

    notifyObserver(name, callback) {
      try {
        callback();
      } catch (error) {
        try {
          this.onObserverError(error, name);
        } catch (_reportError) {
          // Observer reporting must never affect media ownership or playback state.
        }
      }
    }
  }

  return { NarrationController };
}));
