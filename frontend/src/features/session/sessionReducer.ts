import type { RecommendationCard, TtsStatus } from "../../domain/models";

export interface UserMessage {
  id: string;
  text: string;
  createdAt: string;
}

export type ConversationEntry =
  | ({ kind: "user" } & UserMessage)
  | { kind: "recommendation"; card: RecommendationCard };

export interface SessionState {
  entries: ConversationEntry[];
  isGenerating: boolean;
  error: string | null;
}

export type SessionAction =
  | { type: "bootstrap"; cards: RecommendationCard[] }
  | { type: "submit"; message: UserMessage }
  | { type: "generated"; card: RecommendationCard }
  | { type: "failed"; message: string }
  | { type: "tts-status"; cardId: string; status: TtsStatus };

export const initialSessionState: SessionState = {
  entries: [],
  isGenerating: false,
  error: null,
};

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "bootstrap":
      return {
        ...state,
        entries: action.cards.map((card) => ({ kind: "recommendation", card })),
      };
    case "submit":
      return {
        ...state,
        entries: [...state.entries, { kind: "user", ...action.message }],
        isGenerating: true,
        error: null,
      };
    case "generated":
      return {
        ...state,
        entries: [...state.entries, { kind: "recommendation", card: action.card }],
        isGenerating: false,
      };
    case "failed":
      return {
        ...state,
        isGenerating: false,
        error: action.message,
      };
    case "tts-status": {
      let changed = false;
      const entries = state.entries.map((entry) => {
        if (entry.kind !== "recommendation" || entry.card.id !== action.cardId) {
          return entry;
        }

        changed = true;
        return {
          ...entry,
          card: { ...entry.card, ttsStatus: action.status },
        };
      });

      return changed ? { ...state, entries } : state;
    }
  }
}
