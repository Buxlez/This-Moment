import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import type {
  EnvironmentState,
  ServiceState,
  Track,
} from "../../domain/models";
import {
  initialPlayerState,
  playerReducer,
  type PlayerAction,
} from "../player/playerReducer";
import {
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionState,
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

type MockSessionAction = SessionAction | {type: "gateway-reset"};

interface RequestOwner {
  epoch: number;
  token: symbol;
}

interface NarrationPlayback {
  cardId: string;
  epoch: number;
  timerId: number;
}

function ownsRequest(
  currentOwner: RequestOwner | null | undefined,
  expectedOwner: RequestOwner,
): boolean {
  return (
    currentOwner?.epoch === expectedOwner.epoch &&
    currentOwner.token === expectedOwner.token
  );
}

function mockSessionReducer(
  state: SessionState,
  action: MockSessionAction,
): SessionState {
  return action.type === "gateway-reset"
    ? initialSessionState
    : sessionReducer(state, action);
}

export function useMockExperience(gateway: RecommendationGateway) {
  const [session, sessionDispatch] = useReducer(
    mockSessionReducer,
    initialSessionState,
  );
  const [player, rawPlayerDispatch] = useReducer(
    playerReducer,
    initialPlayerState,
  );
  const [service, setService] = useState(initialService);
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [composerValue, setComposerValue] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const isMountedRef = useRef(false);
  const isBootstrapReadyRef = useRef(false);
  const epochRef = useRef(0);
  const generationOwnerRef = useRef<RequestOwner | null>(null);
  const retryOwnersRef = useRef(new Map<string, RequestOwner>());
  const narrationRef = useRef<NarrationPlayback | null>(null);
  const playerStateRef = useRef(player);
  playerStateRef.current = player;

  const clearNarration = useCallback((restoreReady: boolean) => {
    const narration = narrationRef.current;
    if (!narration) {
      return;
    }

    window.clearTimeout(narration.timerId);
    narrationRef.current = null;
    if (
      restoreReady &&
      isMountedRef.current &&
      narration.epoch === epochRef.current
    ) {
      sessionDispatch({
        type: "tts-status",
        cardId: narration.cardId,
        status: "ready",
      });
    }
  }, []);

  useEffect(() => {
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    let isCurrent = true;
    isMountedRef.current = true;
    isBootstrapReadyRef.current = false;
    generationOwnerRef.current = null;
    retryOwnersRef.current.clear();
    clearNarration(false);
    setIsBootstrapping(true);
    setService(initialService);
    setEnvironment(initialEnvironment);
    setComposerValue("");
    sessionDispatch({type: "gateway-reset"});

    const ownsBootstrap = () =>
      isCurrent && isMountedRef.current && epochRef.current === epoch;

    void gateway.bootstrap().then(
      (bootstrap) => {
        if (!ownsBootstrap()) {
          return;
        }

        setService(bootstrap.service);
        setEnvironment(bootstrap.environment);
        sessionDispatch({type: "bootstrap", cards: bootstrap.cards});
        isBootstrapReadyRef.current = true;
        setIsBootstrapping(false);
      },
      () => {
        if (!ownsBootstrap()) {
          return;
        }

        setService({status: "offline", label: "Mock 初始化失败"});
        isBootstrapReadyRef.current = true;
        setIsBootstrapping(false);
      },
    );

    return () => {
      isCurrent = false;
      isMountedRef.current = false;
      isBootstrapReadyRef.current = false;
      generationOwnerRef.current = null;
      retryOwnersRef.current.clear();
      clearNarration(false);
    };
  }, [clearNarration, gateway]);

  const submit = useCallback(
    async (input: string) => {
      const prompt = input.trim();
      if (
        !prompt ||
        !isBootstrapReadyRef.current ||
        generationOwnerRef.current !== null ||
        session.isGenerating
      ) {
        return;
      }

      const owner: RequestOwner = {
        epoch: epochRef.current,
        token: Symbol("generation"),
      };
      generationOwnerRef.current = owner;
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
        if (
          isMountedRef.current &&
          epochRef.current === owner.epoch &&
          ownsRequest(generationOwnerRef.current, owner)
        ) {
          sessionDispatch({type: "generated", card});
        }
      } catch {
        if (
          isMountedRef.current &&
          epochRef.current === owner.epoch &&
          ownsRequest(generationOwnerRef.current, owner)
        ) {
          sessionDispatch({type: "failed", message: generationError});
        }
      } finally {
        if (ownsRequest(generationOwnerRef.current, owner)) {
          generationOwnerRef.current = null;
        }
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
        const owner: RequestOwner = {
          epoch: epochRef.current,
          token: Symbol("narration-retry"),
        };
        retryOwnersRef.current.set(cardId, owner);
        sessionDispatch({type: "tts-status", cardId, status: "pending"});
        try {
          await gateway.retryNarration(cardId);
          if (
            isMountedRef.current &&
            epochRef.current === owner.epoch &&
            ownsRequest(retryOwnersRef.current.get(cardId), owner)
          ) {
            sessionDispatch({type: "tts-status", cardId, status: "ready"});
          }
        } catch {
          if (
            isMountedRef.current &&
            epochRef.current === owner.epoch &&
            ownsRequest(retryOwnersRef.current.get(cardId), owner)
          ) {
            sessionDispatch({type: "tts-status", cardId, status: "failed"});
          }
        } finally {
          if (ownsRequest(retryOwnersRef.current.get(cardId), owner)) {
            retryOwnersRef.current.delete(cardId);
          }
        }
        return;
      }

      if (
        (entry.card.ttsStatus !== "ready" &&
          entry.card.ttsStatus !== "blocked") ||
        playerStateRef.current.isPlaying ||
        narrationRef.current !== null
      ) {
        return;
      }

      const narration: NarrationPlayback = {
        cardId,
        epoch: epochRef.current,
        timerId: 0,
      };
      sessionDispatch({type: "tts-status", cardId, status: "playing"});
      narration.timerId = window.setTimeout(() => {
        if (narrationRef.current !== narration) {
          return;
        }

        narrationRef.current = null;
        if (
          isMountedRef.current &&
          epochRef.current === narration.epoch
        ) {
          sessionDispatch({type: "tts-status", cardId, status: "ready"});
        }
      }, 900);
      narrationRef.current = narration;
    },
    [gateway, session.entries],
  );

  const playerDispatch = useCallback<Dispatch<PlayerAction>>(
    (action) => {
      const currentPlayer = playerStateRef.current;
      const startsSong =
        action.type === "select" ||
        action.type === "next" ||
        action.type === "previous" ||
        (action.type === "toggle" && !currentPlayer.isPlaying);

      if (startsSong) {
        clearNarration(true);
      }

      playerStateRef.current = playerReducer(currentPlayer, action);
      rawPlayerDispatch(action);
    },
    [clearNarration],
  );

  const playTrack = useCallback(
    (track: Track, queue: Track[]) => {
      playerDispatch({type: "select", track, queue});
    },
    [playerDispatch],
  );

  return {
    session,
    player,
    playerDispatch,
    service,
    environment,
    setEnvironment,
    composerValue,
    setComposerValue,
    isBootstrapping,
    submit,
    narrationAction,
    playTrack,
  };
}
