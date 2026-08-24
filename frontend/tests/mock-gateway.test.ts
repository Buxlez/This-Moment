import { afterEach, describe, expect, it, vi } from "vitest";
import { MockRecommendationGateway } from "../src/gateways/MockRecommendationGateway";
import { bootstrapFixture, demoTracks } from "../src/gateways/fixtures";

describe("MockRecommendationGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bootstraps a connected Shanghai environment with one card", async () => {
    const result = await new MockRecommendationGateway(0).bootstrap();

    expect(result.service.status).toBe("connected");
    expect(result.environment.city).toBe("上海");
    expect(result.cards).toHaveLength(1);
    expect(result).toEqual(bootstrapFixture);
  });

  it("generates three tracks and ready narration for a prompt", async () => {
    const prompt = "夜里开车，想听安静但不困的歌";
    const result = await new MockRecommendationGateway(0).generate(prompt);

    expect(result.prompt).toBe(prompt);
    expect(result.tracks).toHaveLength(3);
    expect(result.tracks.map(({ id }) => id)).toEqual(["track-1", "track-2", "track-3"]);
    expect(demoTracks.map(({ id }) => id)).toEqual(["track-1", "track-2", "track-3"]);
    expect(result.ttsStatus).toBe("ready");
  });

  it("deep clones nested tracks so returned mutations do not affect fixtures", async () => {
    const gateway = new MockRecommendationGateway(0);
    const first = await gateway.bootstrap();

    expect(first.cards[0].tracks[0]).not.toBe(demoTracks[0]);
    first.cards[0].tracks[0].title = "Mutated title";

    const later = await gateway.bootstrap();
    expect(demoTracks[0].title).toBe("Night Cruising");
    expect(later.cards[0].tracks[0].title).toBe("Night Cruising");
    expect(later.cards[0].tracks[0]).not.toBe(first.cards[0].tracks[0]);
  });

  it("generates distinct IDs concurrently even when Date.now is frozen", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);

    try {
      const gateway = new MockRecommendationGateway(0);
      const [first, second] = await Promise.all([
        gateway.generate("first"),
        gateway.generate("second"),
      ]);

      expect(first.id).not.toBe(second.id);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps delayed operations pending until delayMs elapses", async () => {
    vi.useFakeTimers();
    const pending = new MockRecommendationGateway(100).bootstrap();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(99);
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(1);
    await pending;
    expect(settled).toBe(true);
  });

  it("marks a failed card narration as ready when retried", async () => {
    await expect(
      new MockRecommendationGateway(0).retryNarration("card-failed"),
    ).resolves.toEqual({ cardId: "card-failed", status: "ready" });
  });
});
