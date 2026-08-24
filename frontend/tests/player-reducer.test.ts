import { describe, expect, it } from "vitest";
import { demoTracks } from "../src/gateways/fixtures";
import {
  initialPlayerState,
  playerReducer,
} from "../src/features/player/playerReducer";

describe("playerReducer", () => {
  it("selects a track, queue, and starts playback", () => {
    const result = playerReducer(initialPlayerState, {
      type: "select",
      track: demoTracks[1],
      queue: demoTracks,
    });

    expect(result.currentTrack?.id).toBe("track-2");
    expect(result.isPlaying).toBe(true);
    expect(result.progress).toBe(0);
    expect(result.queue).toHaveLength(3);
  });

  it("advances to the next track and wraps to the first track", () => {
    const selected = playerReducer(initialPlayerState, {
      type: "select",
      track: demoTracks[1],
      queue: demoTracks,
    });

    const next = playerReducer(selected, { type: "next" });
    expect(next.currentTrack?.id).toBe("track-3");
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);

    const wrapped = playerReducer(next, { type: "next" });
    expect(wrapped.currentTrack?.id).toBe("track-1");
  });

  it("moves to the previous track and wraps to the last track", () => {
    const selected = playerReducer(initialPlayerState, {
      type: "select",
      track: demoTracks[1],
      queue: demoTracks,
    });

    const previous = playerReducer(selected, { type: "previous" });
    expect(previous.currentTrack?.id).toBe("track-1");
    expect(previous.isPlaying).toBe(true);
    expect(previous.progress).toBe(0);

    const wrapped = playerReducer(previous, { type: "previous" });
    expect(wrapped.currentTrack?.id).toBe("track-3");
  });

  it("handles playback, progress, volume, and mute controls", () => {
    const selected = playerReducer(initialPlayerState, {
      type: "select",
      track: demoTracks[0],
      queue: demoTracks,
    });

    const toggled = playerReducer(selected, { type: "toggle" });
    const progressed = playerReducer(toggled, { type: "progress", value: 42 });
    const muted = playerReducer(progressed, { type: "mute" });
    const adjusted = playerReducer(muted, { type: "volume", value: 35 });

    expect(toggled.isPlaying).toBe(false);
    expect(progressed.progress).toBe(42);
    expect(muted.isMuted).toBe(true);
    expect(adjusted).toMatchObject({ volume: 35, isMuted: false });
  });

  it("resets every player field to its initial state", () => {
    const selected = playerReducer(initialPlayerState, {
      type: "select",
      track: demoTracks[0],
      queue: demoTracks,
    });
    const changed = playerReducer(selected, {type: "progress", value: 42});

    expect(playerReducer(changed, {type: "reset"})).toEqual(initialPlayerState);
  });

  it("clamps progress and volume percentages to the valid range", () => {
    const progressed = playerReducer(initialPlayerState, { type: "progress", value: -10 });
    const progressMax = playerReducer(initialPlayerState, { type: "progress", value: 120 });
    const volumeMin = playerReducer(initialPlayerState, { type: "volume", value: -10 });
    const volumeMax = playerReducer(initialPlayerState, { type: "volume", value: 120 });

    expect(progressed.progress).toBe(0);
    expect(progressMax.progress).toBe(100);
    expect(volumeMin.volume).toBe(0);
    expect(volumeMax.volume).toBe(100);
  });

  it("preserves state identity for non-finite progress and volume values", () => {
    const mutedState = { ...initialPlayerState, isMuted: true };

    expect(playerReducer(initialPlayerState, { type: "progress", value: Number.NaN })).toBe(
      initialPlayerState,
    );
    expect(playerReducer(mutedState, { type: "volume", value: Number.POSITIVE_INFINITY })).toBe(
      mutedState,
    );
  });

  it("copies the queue so source-array mutations do not alter player state", () => {
    const sourceQueue = [...demoTracks];
    const result = playerReducer(initialPlayerState, {
      type: "select",
      track: sourceQueue[1],
      queue: sourceQueue,
    });

    sourceQueue.pop();

    expect(result.queue).toHaveLength(3);
    expect(result.queue).not.toBe(sourceQueue);
  });

  it("preserves state identity when navigation cannot find a current track", () => {
    const state = {
      ...initialPlayerState,
      currentTrack: demoTracks[0],
      queue: [demoTracks[1]],
    };

    expect(playerReducer(state, { type: "next" })).toBe(state);
    expect(playerReducer(state, { type: "previous" })).toBe(state);
    expect(playerReducer(initialPlayerState, { type: "next" })).toBe(initialPlayerState);
    expect(playerReducer(initialPlayerState, { type: "previous" })).toBe(initialPlayerState);
  });
});
