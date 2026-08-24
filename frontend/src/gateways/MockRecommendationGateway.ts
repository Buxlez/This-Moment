import type { BootstrapData, RecommendationCard } from "../domain/models";
import type {
  NarrationRetryResult,
  RecommendationGateway,
} from "./RecommendationGateway";
import { demoBootstrapData, demoCard } from "./fixtures";

export class MockRecommendationGateway implements RecommendationGateway {
  constructor(private readonly delayMs = 450) {}

  async bootstrap(): Promise<BootstrapData> {
    await this.wait();
    return this.clone(demoBootstrapData);
  }

  async generate(prompt: string): Promise<RecommendationCard> {
    await this.wait();
    return this.clone({
      ...demoCard,
      id: `card-${Date.now()}`,
      prompt,
      headline: "为此刻重新排好的一组歌",
      createdAt: new Date().toISOString(),
    });
  }

  async retryNarration(cardId: string): Promise<NarrationRetryResult> {
    await this.wait();
    return { cardId, status: "ready" };
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, this.delayMs);
    });
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
