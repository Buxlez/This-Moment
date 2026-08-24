import { describe, expect, it } from "vitest";
import {
  initialSessionState,
  sessionReducer,
} from "../src/features/session/sessionReducer";
import type { RecommendationCard } from "../src/domain/models";

const card = (id: string, ttsStatus: RecommendationCard["ttsStatus"] = "ready"): RecommendationCard => ({
  id,
  prompt: "夜里开车",
  headline: `Card ${id}`,
  narration: "适合夜间驾驶的音乐推荐。",
  ttsStatus,
  createdAt: "2026-08-24T00:00:00.000Z",
  tracks: [],
});

describe("sessionReducer", () => {
  it("submit keeps the user message and starts generating", () => {
    const message = {
      id: "message-1",
      text: "夜里开车，想听安静但不困的歌",
      createdAt: "2026-08-24T00:00:00.000Z",
    };

    const result = sessionReducer(initialSessionState, {
      type: "submit",
      message,
    });

    expect(result).toEqual({
      entries: [{ kind: "user", ...message }],
      isGenerating: true,
      error: null,
    });
  });

  it("generated appends a card, stops generating, and tts-status updates only that card", () => {
    const generated = sessionReducer(
      { ...initialSessionState, isGenerating: true },
      { type: "generated", card: card("card-1") },
    );

    const result = sessionReducer(generated, {
      type: "tts-status",
      cardId: "card-1",
      status: "playing",
    });

    expect(generated.isGenerating).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: "recommendation",
      card: { id: "card-1", ttsStatus: "playing" },
    });
  });

  it("preserves identities when tts-status does not match an entry", () => {
    const userEntry = {
      kind: "user" as const,
      id: "message-1",
      text: "播放轻音乐",
      createdAt: "2026-08-24T00:00:00.000Z",
    };
    const recommendationEntry = { kind: "recommendation" as const, card: card("card-1") };
    const state = {
      entries: [userEntry, recommendationEntry],
      isGenerating: false,
      error: "previous error",
    };

    const result = sessionReducer(state, {
      type: "tts-status",
      cardId: "missing-card",
      status: "playing",
    });

    expect(result).toBe(state);
    expect(result.entries[0]).toBe(userEntry);
    expect(result.entries[1]).toBe(recommendationEntry);
  });
});
