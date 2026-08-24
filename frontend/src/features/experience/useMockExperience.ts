import {useCallback, useEffect, useReducer, useRef, useState} from "react";
import type {
  EnvironmentState,
  ServiceState,
  Track,
} from "../../domain/models";
import {
  initialPlayerState,
  playerReducer,
} from "../player/playerReducer";
import {
  initialSessionState,
  sessionReducer,
} from "../session/sessionReducer";
import type {RecommendationGateway} from "../../gateways/RecommendationGateway";

const initialService: ServiceState = {
  status: "reconnecting",
  label: "正在准备 Mock",
};

const initialEnvironment: EnvironmentState = {
  city: "上海",
  weather: "多云",
  localTime: "2026-08-24T20:30",
  temperatureC: 27,
  apparentTemperatureC: 29,
  source: "automatic",
};

const generationError = "没有生成新的推荐，请重试。";

export function useMockExperience(gateway: RecommendationGateway) {
  const [session, sessionDispatch] = useReducer(
    sessionReducer,
    initialSessionState,
  );
  const [player, playerDispatch] = useReducer(playerReducer, initialPlayerState);
  const [service, setService] = useState(initialService);
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [composerValue, setComposerValue] = useState("");
  const isActiveRef = useRef(false);
  const generationInFlightRef = useRef(false);
  const narrationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let isCurrent = true;
    isActiveRef.current = true;

    void gateway.bootstrap().then(
      (bootstrap) => {
        if (!isCurrent) {
          return;
        }

        setService(bootstrap.service);
        setEnvironment(bootstrap.environment);
        sessionDispatch({type: "bootstrap", cards: bootstrap.cards});
      },
      () => {
        if (!isCurrent) {
          return;
        }

        setService({status: "offline", label: "Mock 初始化失败"});
      },
    );

    return () => {
      isCurrent = false;
      isActiveRef.current = false;
      if (narrationTimerRef.current !== null) {
        window.clearTimeout(narrationTimerRef.current);
        narrationTimerRef.current = null;
      }
    };
  }, [gateway]);

  const submit = useCallback(
    async (input: string) => {
      const prompt = input.trim();
      if (!prompt || generationInFlightRef.current || session.isGenerating) {
        return;
      }

      generationInFlightRef.current = true;
      setComposerValue("");
      sessionDispatch({
        type: "submit",
        message: {
          id: `message-${crypto.randomUUID()}`,
          text: prompt,
          createdAt: new Date().toISOString(),
        },
      });

      try {
        const card = await gateway.generate(prompt);
        if (isActiveRef.current) {
          sessionDispatch({type: "generated", card});
        }
      } catch {
        if (isActiveRef.current) {
          sessionDispatch({type: "failed", message: generationError});
        }
      } finally {
        generationInFlightRef.current = false;
      }
    },
    [gateway, session.isGenerating],
  );

  const narrationAction = useCallback(
    async (cardId: string) => {
      const entry = session.entries.find(
        (candidate) =>
          candidate.kind === "recommendation" && candidate.card.id === cardId,
      );

      if (!entry || entry.kind !== "recommendation") {
        return;
      }

      if (entry.card.ttsStatus === "failed") {
        sessionDispatch({type: "tts-status", cardId, status: "pending"});
        try {
          await gateway.retryNarration(cardId);
          if (isActiveRef.current) {
            sessionDispatch({type: "tts-status", cardId, status: "ready"});
          }
        } catch {
          if (isActiveRef.current) {
            sessionDispatch({type: "tts-status", cardId, status: "failed"});
          }
        }
        return;
      }

      if (
        entry.card.ttsStatus !== "ready" ||
        player.isPlaying ||
        narrationTimerRef.current !== null
      ) {
        return;
      }

      sessionDispatch({type: "tts-status", cardId, status: "playing"});
      narrationTimerRef.current = window.setTimeout(() => {
        narrationTimerRef.current = null;
        if (isActiveRef.current) {
          sessionDispatch({type: "tts-status", cardId, status: "ready"});
        }
      }, 900);
    },
    [gateway, player.isPlaying, session.entries],
  );

  const playTrack = useCallback((track: Track, queue: Track[]) => {
    playerDispatch({type: "select", track, queue});
  }, []);

  return {
    session,
    sessionDispatch,
    player,
    playerDispatch,
    service,
    environment,
    setEnvironment,
    composerValue,
    setComposerValue,
    submit,
    narrationAction,
    playTrack,
  };
}
