import { describe, expect, it } from "vitest";
import { MockRecommendationGateway } from "../src/gateways/MockRecommendationGateway";

describe("MockRecommendationGateway", () => {
  it("bootstraps a connected Shanghai environment with one card", async () => {
    const result = await new MockRecommendationGateway(0).bootstrap();

    expect(result.service.status).toBe("connected");
    expect(result.environment.city).toBe("上海");
    expect(result.cards).toHaveLength(1);
  });

  it("generates three tracks and ready narration for a prompt", async () => {
    const prompt = "夜里开车，想听安静但不困的歌";
    const result = await new MockRecommendationGateway(0).generate(prompt);

    expect(result.prompt).toBe(prompt);
    expect(result.tracks).toHaveLength(3);
    expect(result.ttsStatus).toBe("ready");
  });

  it("marks a failed card narration as ready when retried", async () => {
    await expect(
      new MockRecommendationGateway(0).retryNarration("card-failed"),
    ).resolves.toEqual({ cardId: "card-failed", status: "ready" });
  });
});
