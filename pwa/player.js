(function exposePlayer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThisMomentPlayer = api;
}(typeof window !== 'undefined' ? window : globalThis, function playerFactory() {
  class PlayerState {
    constructor() {
      this.queue = [];
      this.cardId = null;
      this.index = -1;
      this.failedResolves = new Map();
    }

    replaceQueue(cardId, tracks, startIndex = 0) {
      this.cardId = cardId;
      this.queue = Array.isArray(tracks) ? [...tracks] : [];
      this.index = this.queue.length ? Math.min(Math.max(startIndex, 0), this.queue.length - 1) : -1;
      this.failedResolves.clear();
      return this.current();
    }

    current() { return this.index >= 0 ? this.queue[this.index] || null : null; }

    next() {
      if (this.index < 0 || this.index >= this.queue.length - 1) return null;
      this.index += 1;
      return this.current();
    }

    previous() {
      if (this.index <= 0) return this.current();
      this.index -= 1;
      return this.current();
    }

    onPlaybackError() {
      const track = this.current();
      if (!track) return 'stop';
      const failures = this.failedResolves.get(track.id) || 0;
      if (failures === 0) {
        this.failedResolves.set(track.id, 1);
        return 'refresh';
      }
      this.failedResolves.set(track.id, 2);
      return 'stop';
    }
  }

  return { PlayerState };
}));
