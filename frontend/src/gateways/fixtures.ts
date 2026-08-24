import type {
  BootstrapData,
  RecommendationCard,
  Track,
} from "../domain/models";

export const demoTracks: Track[] = [
  { id: "track-night-cruising", title: "Night Cruising", artist: "Fishmans", durationMs: 361000 },
  { id: "track-midnight-pretenders", title: "Midnight Pretenders", artist: "Tomoko Aran", durationMs: 342000 },
  { id: "track-aruarian-dance", title: "Aruarian Dance", artist: "Nujabes", durationMs: 250000 },
];

export const demoCard: RecommendationCard = {
  id: "card-1",
  prompt: "坐车回家有点累，想听舒服但别太伤感的歌",
  headline: "给回家路上的柔和夜色",
  narration: "把疲惫放轻一点，但不让情绪继续下坠。这三首歌有温度，也留着刚好的清醒。",
  ttsStatus: "ready",
  createdAt: "2026-08-24T20:30:00+08:00",
  tracks: demoTracks,
};

export const demoBootstrapData: BootstrapData = {
  service: { status: "connected", label: "Mock 已连接" },
  environment: {
    city: "上海",
    weather: "多云",
    localTime: "2026-08-24T20:30",
    temperatureC: 27,
    apparentTemperatureC: 29,
    source: "automatic",
  },
  cards: [demoCard],
};
