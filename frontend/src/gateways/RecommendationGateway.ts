import type {
  BootstrapData,
  RecommendationCard,
} from "../domain/models";

export interface RecommendationGateway {
  bootstrap(): Promise<BootstrapData>;
  generate(prompt: string): Promise<RecommendationCard>;
  retryNarration(cardId: string): Promise<{ cardId: string; status: "ready" }>;
}
