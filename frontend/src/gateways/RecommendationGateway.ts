import type {
  BootstrapData,
  RecommendationCard,
} from "../domain/models";

export interface NarrationRetryResult {
  cardId: string;
  status: "ready";
}

export interface RecommendationGateway {
  bootstrap(): Promise<BootstrapData>;
  generate(prompt: string): Promise<RecommendationCard>;
  retryNarration(cardId: string): Promise<NarrationRetryResult>;
}
