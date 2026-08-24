import type { Track } from "../../domain/models";

export interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  progress: number;
  volume: number;
  isMuted: boolean;
}

export type PlayerAction =
  | { type: "reset" }
  | { type: "select"; track: Track; queue: Track[] }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "progress"; value: number }
  | { type: "volume"; value: number }
  | { type: "mute" };

export const initialPlayerState: PlayerState = {
  currentTrack: null,
  queue: [],
  isPlaying: false,
  progress: 0,
  volume: 70,
  isMuted: false,
};

function normalizePercent(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "reset":
      return initialPlayerState;
    case "select":
      return {
        ...state,
        currentTrack: action.track,
        queue: [...action.queue],
        isPlaying: true,
        progress: 0,
      };
    case "toggle":
      return { ...state, isPlaying: !state.isPlaying };
    case "progress": {
      const progress = normalizePercent(action.value);
      return progress === null ? state : { ...state, progress };
    }
    case "volume": {
      const volume = normalizePercent(action.value);
      return volume === null ? state : { ...state, volume, isMuted: false };
    }
    case "mute":
      return { ...state, isMuted: !state.isMuted };
    case "next":
    case "previous": {
      if (!state.currentTrack || state.queue.length === 0) {
        return state;
      }

      const currentIndex = state.queue.findIndex((track) => track.id === state.currentTrack?.id);
      if (currentIndex === -1) {
        return state;
      }

      const offset = action.type === "next" ? 1 : -1;
      const nextIndex = (currentIndex + offset + state.queue.length) % state.queue.length;
      return {
        ...state,
        currentTrack: state.queue[nextIndex],
        isPlaying: true,
        progress: 0,
      };
    }
  }
}
