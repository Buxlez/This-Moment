export type ServiceStatus = "connected" | "reconnecting" | "offline";

export type TtsStatus = "pending" | "ready" | "playing" | "blocked" | "failed";

export interface ServiceState {
  status: ServiceStatus;
  label: string;
}

export interface EnvironmentState {
  city: string;
  weather: string;
  localTime: string;
  temperatureC: number;
  apparentTemperatureC: number;
  source: "automatic" | "manual";
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  coverUrl?: string;
}

export interface RecommendationCard {
  id: string;
  prompt: string;
  headline: string;
  narration: string;
  ttsStatus: TtsStatus;
  createdAt: string;
  tracks: Track[];
}

export interface BootstrapData {
  service: ServiceState;
  environment: EnvironmentState;
  cards: RecommendationCard[];
}
