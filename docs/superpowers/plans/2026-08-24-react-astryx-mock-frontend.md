# React + ASTRYX Mock Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently runnable React + ASTRYX mock frontend in `frontend/` without changing the existing PWA, backend, tests, or startup flow.

**Architecture:** The new Vite application owns its package and build configuration. UI components consume typed domain models and a mock gateway; reducers own conversation and player state, while ASTRYX owns all page layout and visual styling. This phase stops at a complete mock experience and deliberately does not connect the existing backend.

**Tech Stack:** React 19, TypeScript 7, Vite 8, ASTRYX Core 0.4.7, ASTRYX Neutral Theme 0.4.7, Vitest 4, React Testing Library

---

## Scope Guard

Implementation may create or modify only files under `frontend/`. Do not edit `pwa/`, `server.js`, `test/`, the root `package.json`, either root lockfile, or any existing startup script. The only file outside `frontend/` created for this phase is this implementation plan.

The finished mock must demonstrate environment editing, conversation submission, generated recommendation content, narration state transitions, song selection, and a persistent player. HTTP, WebSocket, geolocation, real audio, and live TTS are deferred to the live-integration plan.

## File Map

```text
frontend/
├── index.html                         Vite HTML entry
├── package.json                       Independent dependencies and scripts
├── package-lock.json                  Independent npm lockfile
├── tsconfig.json                      Project references
├── tsconfig.app.json                  Application/test compiler options
├── vite.config.ts                     React plugin and Vitest configuration
├── src/
│   ├── main.tsx                       CSS imports and React mount
│   ├── app/App.tsx                    Theme boundary and page entry
│   ├── domain/models.ts               Shared UI domain types
│   ├── gateways/RecommendationGateway.ts
│   ├── gateways/fixtures.ts           Stable mock data
│   ├── gateways/MockRecommendationGateway.ts
│   ├── features/session/sessionReducer.ts
│   ├── features/player/playerReducer.ts
│   ├── features/experience/useMockExperience.ts
│   ├── components/EnvironmentHeader.tsx
│   ├── components/RecommendationMessage.tsx
│   ├── components/PlayerDock.tsx
│   ├── components/MockExperiencePage.tsx
│   └── test/setup.ts                  Browser API test shims
└── tests/
    ├── mock-gateway.test.ts
    ├── session-reducer.test.ts
    ├── player-reducer.test.ts
    ├── environment-header.test.tsx
    ├── recommendation-message.test.tsx
    ├── player-dock.test.tsx
    └── mock-experience.test.tsx
```

### Task 1: Create the isolated Vite test harness

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.app.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/test/setup.ts`

- [ ] **Step 1: Create the independent package manifest**

Create `frontend/package.json`:

```json
{
  "name": "this-moment-react",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false"
  },
  "dependencies": {
    "@astryxdesign/core": "0.4.7",
    "@astryxdesign/theme-neutral": "0.4.7",
    "@stylexjs/stylex": "0.19.0",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.6",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@vitejs/plugin-react": "6.1.0",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Create TypeScript and Vite configuration**

Create `frontend/tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

Create `frontend/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Create `frontend/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {port: 5173, strictPort: true},
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
  },
});
```

- [ ] **Step 3: Create the HTML entry and test shims**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>this moment · React preview</title>
  </head>
  <body>
    <main id="root"></main>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve() {}
}

Object.defineProperty(window, 'ResizeObserver', {value: ResizeObserverStub});
Object.defineProperty(window, 'IntersectionObserver', {value: IntersectionObserverStub});
Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }),
});
```

- [ ] **Step 4: Install only inside the new application**

Run: `cd frontend && npm install`

Expected: `frontend/package-lock.json` is created and npm reports zero installation failures.

- [ ] **Step 5: Commit the isolated harness**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/tsconfig.app.json frontend/vite.config.ts frontend/index.html frontend/src/test/setup.ts
git commit -m "build: scaffold isolated React frontend"
```

### Task 2: Define the domain contract and mock gateway

**Files:**
- Create: `frontend/tests/mock-gateway.test.ts`
- Create: `frontend/src/domain/models.ts`
- Create: `frontend/src/gateways/RecommendationGateway.ts`
- Create: `frontend/src/gateways/fixtures.ts`
- Create: `frontend/src/gateways/MockRecommendationGateway.ts`

- [ ] **Step 1: Write the failing gateway contract test**

Create `frontend/tests/mock-gateway.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {MockRecommendationGateway} from '../src/gateways/MockRecommendationGateway';

describe('MockRecommendationGateway', () => {
  it('returns stable bootstrap data and a generated recommendation', async () => {
    const gateway = new MockRecommendationGateway(0);
    const initial = await gateway.bootstrap();

    expect(initial.service.status).toBe('connected');
    expect(initial.environment.city).toBe('上海');
    expect(initial.cards).toHaveLength(1);

    const card = await gateway.generate('夜里开车，想听安静但不困的歌');
    expect(card.prompt).toBe('夜里开车，想听安静但不困的歌');
    expect(card.tracks).toHaveLength(3);
    expect(card.ttsStatus).toBe('ready');
  });

  it('moves a failed narration back to ready', async () => {
    const gateway = new MockRecommendationGateway(0);
    await expect(gateway.retryNarration('card-failed')).resolves.toEqual({
      cardId: 'card-failed',
      status: 'ready',
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `cd frontend && npm test -- tests/mock-gateway.test.ts`

Expected: FAIL because `MockRecommendationGateway` does not exist.

- [ ] **Step 3: Implement the shared models and gateway interface**

Create `frontend/src/domain/models.ts`:

```ts
export type ServiceStatus = 'connected' | 'reconnecting' | 'offline';
export type TtsStatus = 'pending' | 'ready' | 'playing' | 'blocked' | 'failed';

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
  source: 'automatic' | 'manual';
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
```

Create `frontend/src/gateways/RecommendationGateway.ts`:

```ts
import type {BootstrapData, RecommendationCard} from '../domain/models';

export interface RecommendationGateway {
  bootstrap(): Promise<BootstrapData>;
  generate(prompt: string): Promise<RecommendationCard>;
  retryNarration(cardId: string): Promise<{cardId: string; status: 'ready'}>;
}
```

- [ ] **Step 4: Implement stable fixtures and the mock gateway**

Create `frontend/src/gateways/fixtures.ts`:

```ts
import type {BootstrapData, RecommendationCard, Track} from '../domain/models';

export const demoTracks: Track[] = [
  {id: 'track-1', title: 'Night Cruising', artist: 'Fishmans', durationMs: 361000},
  {id: 'track-2', title: 'Midnight Pretenders', artist: 'Tomoko Aran', durationMs: 342000},
  {id: 'track-3', title: 'Aruarian Dance', artist: 'Nujabes', durationMs: 250000},
];

export const demoCard: RecommendationCard = {
  id: 'card-1',
  prompt: '坐车回家有点累，想听舒服但别太伤感的歌',
  headline: '给回家路上的柔和夜色',
  narration: '把疲惫放轻一点，但不让情绪继续下坠。这三首歌有温度，也留着刚好的清醒。',
  ttsStatus: 'ready',
  createdAt: '2026-08-24T20:30:00+08:00',
  tracks: demoTracks,
};

export const bootstrapFixture: BootstrapData = {
  service: {status: 'connected', label: 'Mock 已连接'},
  environment: {
    city: '上海',
    weather: '多云',
    localTime: '2026-08-24T20:30',
    temperatureC: 27,
    apparentTemperatureC: 29,
    source: 'automatic',
  },
  cards: [demoCard],
};
```

Create `frontend/src/gateways/MockRecommendationGateway.ts`:

```ts
import type {BootstrapData, RecommendationCard} from '../domain/models';
import type {RecommendationGateway} from './RecommendationGateway';
import {bootstrapFixture, demoCard} from './fixtures';

const wait = (milliseconds: number) => new Promise<void>(resolve => {
  window.setTimeout(resolve, milliseconds);
});

export class MockRecommendationGateway implements RecommendationGateway {
  constructor(private readonly delayMs = 450) {}

  async bootstrap(): Promise<BootstrapData> {
    await wait(this.delayMs);
    return structuredClone(bootstrapFixture);
  }

  async generate(prompt: string): Promise<RecommendationCard> {
    await wait(this.delayMs);
    return {
      ...structuredClone(demoCard),
      id: `card-${Date.now()}`,
      prompt,
      headline: '为此刻重新排好的一组歌',
      createdAt: new Date().toISOString(),
    };
  }

  async retryNarration(cardId: string): Promise<{cardId: string; status: 'ready'}> {
    await wait(this.delayMs);
    return {cardId, status: 'ready'};
  }
}
```

- [ ] **Step 5: Run the gateway test and verify green**

Run: `cd frontend && npm test -- tests/mock-gateway.test.ts`

Expected: 2 tests pass.

- [ ] **Step 6: Commit the domain boundary**

```bash
git add frontend/src/domain frontend/src/gateways frontend/tests/mock-gateway.test.ts
git commit -m "feat: add typed mock recommendation gateway"
```

### Task 3: Build the conversation reducer

**Files:**
- Create: `frontend/tests/session-reducer.test.ts`
- Create: `frontend/src/features/session/sessionReducer.ts`

- [ ] **Step 1: Write the reducer tests**

Create `frontend/tests/session-reducer.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {demoCard} from '../src/gateways/fixtures';
import {initialSessionState, sessionReducer} from '../src/features/session/sessionReducer';

describe('sessionReducer', () => {
  it('keeps the user message while a recommendation is generated', () => {
    const state = sessionReducer(initialSessionState, {
      type: 'submit',
      message: {id: 'message-1', text: '来点安静的歌', createdAt: '2026-08-24T20:40:00+08:00'},
    });

    expect(state.isGenerating).toBe(true);
    expect(state.entries[0]).toMatchObject({kind: 'user', text: '来点安静的歌'});
  });

  it('appends a recommendation and updates only its narration status', () => {
    const generated = sessionReducer(initialSessionState, {type: 'generated', card: demoCard});
    const updated = sessionReducer(generated, {
      type: 'tts-status',
      cardId: demoCard.id,
      status: 'playing',
    });

    expect(updated.isGenerating).toBe(false);
    expect(updated.entries[0]).toMatchObject({
      kind: 'recommendation',
      card: {ttsStatus: 'playing'},
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm test -- tests/session-reducer.test.ts`

Expected: FAIL because `sessionReducer` does not exist.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/features/session/sessionReducer.ts`:

```ts
import type {RecommendationCard, TtsStatus} from '../../domain/models';

export interface UserMessage {
  id: string;
  text: string;
  createdAt: string;
}

export type ConversationEntry =
  | ({kind: 'user'} & UserMessage)
  | {kind: 'recommendation'; card: RecommendationCard};

export interface SessionState {
  entries: ConversationEntry[];
  isGenerating: boolean;
  error: string | null;
}

export const initialSessionState: SessionState = {
  entries: [],
  isGenerating: false,
  error: null,
};

export type SessionAction =
  | {type: 'bootstrap'; cards: RecommendationCard[]}
  | {type: 'submit'; message: UserMessage}
  | {type: 'generated'; card: RecommendationCard}
  | {type: 'failed'; message: string}
  | {type: 'tts-status'; cardId: string; status: TtsStatus};

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'bootstrap':
      return {
        ...state,
        entries: action.cards.map(card => ({kind: 'recommendation' as const, card})),
      };
    case 'submit':
      return {
        ...state,
        entries: [...state.entries, {kind: 'user', ...action.message}],
        isGenerating: true,
        error: null,
      };
    case 'generated':
      return {
        ...state,
        entries: [...state.entries, {kind: 'recommendation', card: action.card}],
        isGenerating: false,
      };
    case 'failed':
      return {...state, isGenerating: false, error: action.message};
    case 'tts-status':
      return {
        ...state,
        entries: state.entries.map(entry => entry.kind === 'recommendation' && entry.card.id === action.cardId
          ? {...entry, card: {...entry.card, ttsStatus: action.status}}
          : entry),
      };
  }
}
```

- [ ] **Step 4: Run the reducer test**

Run: `cd frontend && npm test -- tests/session-reducer.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the conversation state**

```bash
git add frontend/src/features/session/sessionReducer.ts frontend/tests/session-reducer.test.ts
git commit -m "feat: model mock conversation state"
```

### Task 4: Build the player reducer

**Files:**
- Create: `frontend/tests/player-reducer.test.ts`
- Create: `frontend/src/features/player/playerReducer.ts`

- [ ] **Step 1: Write the player behavior tests**

Create `frontend/tests/player-reducer.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {demoTracks} from '../src/gateways/fixtures';
import {initialPlayerState, playerReducer} from '../src/features/player/playerReducer';

describe('playerReducer', () => {
  it('starts a selected song and keeps its queue', () => {
    const state = playerReducer(initialPlayerState, {
      type: 'select',
      track: demoTracks[1],
      queue: demoTracks,
    });

    expect(state.currentTrack?.id).toBe('track-2');
    expect(state.isPlaying).toBe(true);
    expect(state.queue).toHaveLength(3);
  });

  it('moves to the next and previous queue entries', () => {
    const selected = playerReducer(initialPlayerState, {
      type: 'select',
      track: demoTracks[1],
      queue: demoTracks,
    });
    expect(playerReducer(selected, {type: 'next'}).currentTrack?.id).toBe('track-3');
    expect(playerReducer(selected, {type: 'previous'}).currentTrack?.id).toBe('track-1');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm test -- tests/player-reducer.test.ts`

Expected: FAIL because `playerReducer` does not exist.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/features/player/playerReducer.ts`:

```ts
import type {Track} from '../../domain/models';

export interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  progress: number;
  volume: number;
  isMuted: boolean;
}

export const initialPlayerState: PlayerState = {
  currentTrack: null,
  queue: [],
  isPlaying: false,
  progress: 0,
  volume: 70,
  isMuted: false,
};

export type PlayerAction =
  | {type: 'select'; track: Track; queue: Track[]}
  | {type: 'toggle'}
  | {type: 'next'}
  | {type: 'previous'}
  | {type: 'progress'; value: number}
  | {type: 'volume'; value: number}
  | {type: 'mute'};

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  if (action.type === 'select') {
    return {...state, currentTrack: action.track, queue: action.queue, isPlaying: true, progress: 0};
  }
  if (action.type === 'toggle') return {...state, isPlaying: !state.isPlaying};
  if (action.type === 'progress') return {...state, progress: action.value};
  if (action.type === 'volume') return {...state, volume: action.value, isMuted: false};
  if (action.type === 'mute') return {...state, isMuted: !state.isMuted};

  const index = state.queue.findIndex(track => track.id === state.currentTrack?.id);
  if (index < 0 || state.queue.length === 0) return state;
  const delta = action.type === 'next' ? 1 : -1;
  const nextIndex = (index + delta + state.queue.length) % state.queue.length;
  return {...state, currentTrack: state.queue[nextIndex], isPlaying: true, progress: 0};
}
```

- [ ] **Step 4: Run the player tests**

Run: `cd frontend && npm test -- tests/player-reducer.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the player state**

```bash
git add frontend/src/features/player/playerReducer.ts frontend/tests/player-reducer.test.ts
git commit -m "feat: model mock player controls"
```

### Task 5: Build the ASTRYX presentation components

**Files:**
- Create: `frontend/tests/environment-header.test.tsx`
- Create: `frontend/tests/recommendation-message.test.tsx`
- Create: `frontend/tests/player-dock.test.tsx`
- Create: `frontend/src/components/EnvironmentHeader.tsx`
- Create: `frontend/src/components/RecommendationMessage.tsx`
- Create: `frontend/src/components/PlayerDock.tsx`

- [ ] **Step 1: Write the component tests**

Create `frontend/tests/environment-header.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {EnvironmentHeader} from '../src/components/EnvironmentHeader';
import {bootstrapFixture} from '../src/gateways/fixtures';

describe('EnvironmentHeader', () => {
  it('shows status and reveals editable environment fields', async () => {
    const user = userEvent.setup();
    render(<EnvironmentHeader
      service={bootstrapFixture.service}
      environment={bootstrapFixture.environment}
      onEnvironmentChange={vi.fn()}
    />);

    expect(screen.getByText('Mock 已连接')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '调整环境'}));
    expect(screen.getByRole('textbox', {name: '城市'})).toHaveValue('上海');
    expect(screen.getByRole('button', {name: /天气/})).toBeInTheDocument();
  });
});
```

Create `frontend/tests/recommendation-message.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {RecommendationMessage} from '../src/components/RecommendationMessage';
import {demoCard} from '../src/gateways/fixtures';

describe('RecommendationMessage', () => {
  it('renders songs as list rows and exposes narration and play actions', async () => {
    const user = userEvent.setup();
    const onPlayTrack = vi.fn();
    const onNarrationAction = vi.fn();
    render(<RecommendationMessage
      card={demoCard}
      onPlayTrack={onPlayTrack}
      onNarrationAction={onNarrationAction}
    />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', {name: '播放 Night Cruising'}));
    await user.click(screen.getByRole('button', {name: '播放推荐语'}));
    expect(onPlayTrack).toHaveBeenCalledWith(demoCard.tracks[0], demoCard.tracks);
    expect(onNarrationAction).toHaveBeenCalledWith(demoCard.id);
  });
});
```

Create `frontend/tests/player-dock.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {PlayerDock} from '../src/components/PlayerDock';
import {demoTracks} from '../src/gateways/fixtures';
import {initialPlayerState} from '../src/features/player/playerReducer';

describe('PlayerDock', () => {
  it('stays hidden without a song and exposes controls with a selected song', () => {
    const {rerender} = render(<PlayerDock state={initialPlayerState} dispatch={vi.fn()} />);
    expect(screen.queryByLabelText('歌曲播放器')).not.toBeInTheDocument();

    rerender(<PlayerDock state={{...initialPlayerState, currentTrack: demoTracks[0], queue: demoTracks, isPlaying: true}} dispatch={vi.fn()} />);
    expect(screen.getByLabelText('歌曲播放器')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '暂停'})).toBeInTheDocument();
    expect(screen.getByRole('slider', {name: '播放进度'})).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and confirm missing-component failures**

Run: `cd frontend && npm test -- tests/environment-header.test.tsx tests/recommendation-message.test.tsx tests/player-dock.test.tsx`

Expected: FAIL because the three components do not exist.

- [ ] **Step 3: Implement the environment header with verified ASTRYX props**

Create `frontend/src/components/EnvironmentHeader.tsx`:

```tsx
import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import type {EnvironmentState, ServiceState} from '../domain/models';

interface EnvironmentHeaderProps {
  service: ServiceState;
  environment: EnvironmentState;
  onEnvironmentChange: (environment: EnvironmentState) => void;
}

const weatherOptions = ['晴朗', '多云', '下雨', '高温', '寒冷', '雪天'].map(value => ({value, label: value}));

export function EnvironmentHeader({service, environment, onEnvironmentChange}: EnvironmentHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const statusVariant = service.status === 'connected' ? 'success' : service.status === 'reconnecting' ? 'warning' : 'error';

  return <LayoutHeader hasDivider role="banner">
    <VStack gap={3}>
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <VStack gap={0.5}>
          <Heading level={1}>this moment</Heading>
          <Text type="supporting">AI MUSIC EDITOR</Text>
        </VStack>
        <HStack gap={2} align="center" wrap="wrap">
          <HStack gap={1} align="center">
            <StatusDot variant={statusVariant} label={service.label} isPulsing={service.status === 'reconnecting'} />
            <Text type="supporting">{service.label}</Text>
          </HStack>
          <Text>{environment.city} · {environment.weather} · {environment.temperatureC}°</Text>
          <Button label="调整环境" variant="ghost" onClick={() => setIsOpen(value => !value)} />
        </HStack>
      </HStack>
      {isOpen ? <Section variant="muted" padding={4}>
        <HStack gap={3} align="end" wrap="wrap">
          <TextInput
            label="城市"
            value={environment.city}
            onChange={city => onEnvironmentChange({...environment, city, source: 'manual'})}
          />
          <Selector
            label="天气"
            options={weatherOptions}
            value={environment.weather}
            onChange={weather => onEnvironmentChange({...environment, weather, source: 'manual'})}
          />
          <TextInput
            label="当地时间"
            value={environment.localTime}
            onChange={localTime => onEnvironmentChange({...environment, localTime, source: 'manual'})}
          />
        </HStack>
      </Section> : null}
    </VStack>
  </LayoutHeader>;
}
```

- [ ] **Step 4: Implement the recommendation message and song rows**

Create `frontend/src/components/RecommendationMessage.tsx`:

```tsx
import {Button} from '@astryxdesign/core/Button';
import {ChatMessage, ChatMessageBubble} from '@astryxdesign/core/Chat';
import {Heading} from '@astryxdesign/core/Heading';
import {HStack} from '@astryxdesign/core/HStack';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {Thumbnail} from '@astryxdesign/core/Thumbnail';
import {VStack} from '@astryxdesign/core/VStack';
import type {RecommendationCard, Track} from '../domain/models';

interface RecommendationMessageProps {
  card: RecommendationCard;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onNarrationAction: (cardId: string) => void;
}

function formatDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function RecommendationMessage({card, onPlayTrack, onNarrationAction}: RecommendationMessageProps) {
  const ttsVariant = card.ttsStatus === 'failed' ? 'error' : card.ttsStatus === 'pending' ? 'warning' : 'success';
  const narrationLabel = card.ttsStatus === 'failed' ? '重试推荐语' : card.ttsStatus === 'playing' ? '正在播放推荐语' : '播放推荐语';

  return <ChatMessage sender="assistant" name="AI 音乐编辑">
    <ChatMessageBubble variant="ghost" width="100%">
      <Section variant="muted" padding={4}>
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>{card.headline}</Heading>
            <Text>{card.narration}</Text>
          </VStack>
          <HStack gap={2} align="center">
            <StatusDot variant={ttsVariant} label={`推荐语：${card.ttsStatus}`} isPulsing={card.ttsStatus === 'pending'} />
            <Text type="supporting">推荐语：{card.ttsStatus}</Text>
            <Button
              label={narrationLabel}
              variant="secondary"
              size="sm"
              isDisabled={card.ttsStatus === 'pending' || card.ttsStatus === 'playing'}
              onClick={() => onNarrationAction(card.id)}
            />
          </HStack>
          <List hasDividers density="balanced" header={<Heading level={3}>为你选的歌</Heading>}>
            {card.tracks.map(track => <ListItem
              key={track.id}
              label={track.title}
              description={track.artist}
              startContent={<Thumbnail src={track.coverUrl} alt={`${track.title} 封面`} label={track.title} />}
              endContent={<HStack gap={2} align="center">
                <Text type="supporting" hasTabularNumbers>{formatDuration(track.durationMs)}</Text>
                <Button label={`播放 ${track.title}`} size="sm" variant="ghost" onClick={() => onPlayTrack(track, card.tracks)} />
              </HStack>}
            />)}
          </List>
        </VStack>
      </Section>
    </ChatMessageBubble>
  </ChatMessage>;
}
```

- [ ] **Step 5: Implement the persistent mock player**

Create `frontend/src/components/PlayerDock.tsx`:

```tsx
import type {Dispatch} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/HStack';
import {Section} from '@astryxdesign/core/Section';
import {Slider} from '@astryxdesign/core/Slider';
import {Text} from '@astryxdesign/core/Text';
import {Thumbnail} from '@astryxdesign/core/Thumbnail';
import {VStack} from '@astryxdesign/core/VStack';
import type {PlayerAction, PlayerState} from '../features/player/playerReducer';

interface PlayerDockProps {
  state: PlayerState;
  dispatch: Dispatch<PlayerAction>;
}

export function PlayerDock({state, dispatch}: PlayerDockProps) {
  if (!state.currentTrack) return null;
  const track = state.currentTrack;

  return <Section variant="section" padding={3} dividers={['top']} aria-label="歌曲播放器">
    <HStack gap={3} align="center" justify="between" wrap="wrap">
      <HStack gap={2} align="center">
        <Thumbnail src={track.coverUrl} alt={`${track.title} 封面`} label={track.title} />
        <VStack gap={0.5}>
          <Text weight="semibold">{track.title}</Text>
          <Text type="supporting">{track.artist}</Text>
        </VStack>
      </HStack>
      <HStack gap={1} align="center">
        <Button label="上一首" variant="ghost" size="sm" onClick={() => dispatch({type: 'previous'})} />
        <Button label={state.isPlaying ? '暂停' : '播放'} variant="primary" size="sm" onClick={() => dispatch({type: 'toggle'})} />
        <Button label="下一首" variant="ghost" size="sm" onClick={() => dispatch({type: 'next'})} />
      </HStack>
      <Slider
        label="播放进度"
        isLabelHidden
        width="100%"
        value={state.progress}
        onChange={value => dispatch({type: 'progress', value: value as number})}
        valueDisplay="none"
      />
      <HStack gap={2} align="center">
        <Button label={state.isMuted ? '取消静音' : '静音'} variant="ghost" size="sm" onClick={() => dispatch({type: 'mute'})} />
        <Slider
          label="音量"
          isLabelHidden
          value={state.isMuted ? 0 : state.volume}
          onChange={value => dispatch({type: 'volume', value: value as number})}
          valueDisplay="none"
        />
      </HStack>
    </HStack>
  </Section>;
}
```

- [ ] **Step 6: Run the component tests**

Run: `cd frontend && npm test -- tests/environment-header.test.tsx tests/recommendation-message.test.tsx tests/player-dock.test.tsx`

Expected: 3 tests pass.

- [ ] **Step 7: Commit the ASTRYX components**

```bash
git add frontend/src/components/EnvironmentHeader.tsx frontend/src/components/RecommendationMessage.tsx frontend/src/components/PlayerDock.tsx frontend/tests/environment-header.test.tsx frontend/tests/recommendation-message.test.tsx frontend/tests/player-dock.test.tsx
git commit -m "feat: compose Astryx music recommendation UI"
```

### Task 6: Connect the mock experience state

**Files:**
- Create: `frontend/src/features/experience/useMockExperience.ts`
- Create: `frontend/src/components/MockExperiencePage.tsx`
- Create: `frontend/tests/mock-experience.test.tsx`

- [ ] **Step 1: Write the full-page interaction test**

Create `frontend/tests/mock-experience.test.tsx`:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {MockExperiencePage} from '../src/components/MockExperiencePage';
import {MockRecommendationGateway} from '../src/gateways/MockRecommendationGateway';

describe('MockExperiencePage', () => {
  it('submits a prompt, renders a recommendation, and opens the player', async () => {
    const user = userEvent.setup();
    render(<MockExperiencePage gateway={new MockRecommendationGateway(0)} />);

    expect(await screen.findByText('给回家路上的柔和夜色')).toBeInTheDocument();
    const composer = screen.getByLabelText('音乐需求');
    await user.click(composer);
    await user.keyboard('夜里开车，想听安静但不困的歌');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('为此刻重新排好的一组歌')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', {name: '播放 Night Cruising'}).at(-1)!);
    expect(screen.getByLabelText('歌曲播放器')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npm test -- tests/mock-experience.test.tsx`

Expected: FAIL because `MockExperiencePage` does not exist.

- [ ] **Step 3: Implement the experience hook**

Create `frontend/src/features/experience/useMockExperience.ts`:

```ts
import {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import type {EnvironmentState, ServiceState, Track} from '../../domain/models';
import type {RecommendationGateway} from '../../gateways/RecommendationGateway';
import {initialPlayerState, playerReducer} from '../player/playerReducer';
import {initialSessionState, sessionReducer} from '../session/sessionReducer';

export function useMockExperience(gateway: RecommendationGateway) {
  const [session, sessionDispatch] = useReducer(sessionReducer, initialSessionState);
  const [player, playerDispatch] = useReducer(playerReducer, initialPlayerState);
  const [service, setService] = useState<ServiceState>({status: 'reconnecting', label: '正在准备 Mock'});
  const [environment, setEnvironment] = useState<EnvironmentState>({
    city: '上海', weather: '多云', localTime: '', temperatureC: 27,
    apparentTemperatureC: 29, source: 'automatic',
  });
  const [composerValue, setComposerValue] = useState('');
  const narrationTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    gateway.bootstrap().then(data => {
      if (!active) return;
      setService(data.service);
      setEnvironment(data.environment);
      sessionDispatch({type: 'bootstrap', cards: data.cards});
    }).catch(() => {
      if (active) setService({status: 'offline', label: 'Mock 初始化失败'});
    });
    return () => {
      active = false;
      if (narrationTimer.current !== null) window.clearTimeout(narrationTimer.current);
    };
  }, [gateway]);

  const submit = useCallback(async (rawValue: string) => {
    const prompt = rawValue.trim();
    if (!prompt || session.isGenerating) return;
    setComposerValue('');
    sessionDispatch({
      type: 'submit',
      message: {id: crypto.randomUUID(), text: prompt, createdAt: new Date().toISOString()},
    });
    try {
      sessionDispatch({type: 'generated', card: await gateway.generate(prompt)});
    } catch {
      sessionDispatch({type: 'failed', message: '没有生成新的推荐，请重试。'});
    }
  }, [gateway, session.isGenerating]);

  const actOnNarration = useCallback(async (cardId: string) => {
    const entry = session.entries.find(item => item.kind === 'recommendation' && item.card.id === cardId);
    if (!entry || entry.kind !== 'recommendation') return;
    if (entry.card.ttsStatus === 'failed') {
      sessionDispatch({type: 'tts-status', cardId, status: 'pending'});
      await gateway.retryNarration(cardId);
      sessionDispatch({type: 'tts-status', cardId, status: 'ready'});
      return;
    }
    if (entry.card.ttsStatus !== 'ready') return;
    sessionDispatch({type: 'tts-status', cardId, status: 'playing'});
    narrationTimer.current = window.setTimeout(() => {
      sessionDispatch({type: 'tts-status', cardId, status: 'ready'});
    }, 900);
  }, [gateway, session.entries]);

  const playTrack = useCallback((track: Track, queue: Track[]) => {
    playerDispatch({type: 'select', track, queue});
  }, []);

  return {
    session, player, service, environment, composerValue,
    setEnvironment, setComposerValue, submit, actOnNarration, playTrack, playerDispatch,
  };
}
```

- [ ] **Step 4: Implement the page composition**

Create `frontend/src/components/MockExperiencePage.tsx`:

```tsx
import {ChatComposer, ChatComposerInput, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList} from '@astryxdesign/core/Chat';
import {Heading} from '@astryxdesign/core/Heading';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import type {RecommendationGateway} from '../gateways/RecommendationGateway';
import {useMockExperience} from '../features/experience/useMockExperience';
import {EnvironmentHeader} from './EnvironmentHeader';
import {PlayerDock} from './PlayerDock';
import {RecommendationMessage} from './RecommendationMessage';

interface MockExperiencePageProps {
  gateway: RecommendationGateway;
}

export function MockExperiencePage({gateway}: MockExperiencePageProps) {
  const experience = useMockExperience(gateway);
  const composer = <VStack gap={2}>
    <PlayerDock state={experience.player} dispatch={experience.playerDispatch} />
    <ChatComposer
      value={experience.composerValue}
      onChange={experience.setComposerValue}
      onSubmit={experience.submit}
      placeholder="说感受、场景或想要的状态"
      isDisabled={experience.session.isGenerating}
      input={<ChatComposerInput
        label="音乐需求"
        value={experience.composerValue}
        onChange={experience.setComposerValue}
        onSubmit={experience.submit}
        isDisabled={experience.session.isGenerating}
        placeholder="说感受、场景或想要的状态"
      />}
    />
  </VStack>;

  return <Layout
    height="fill"
    contentWidth={960}
    header={<EnvironmentHeader
      service={experience.service}
      environment={experience.environment}
      onEnvironmentChange={experience.setEnvironment}
    />}
    content={<LayoutContent padding={0} role="main">
      <ChatLayout density="spacious" composer={composer}>
        <ChatMessageList density="spacious" isStreaming={experience.session.isGenerating}>
          {experience.session.entries.map(entry => entry.kind === 'user'
            ? <ChatMessage key={entry.id} sender="user">
                <ChatMessageBubble>{entry.text}</ChatMessageBubble>
              </ChatMessage>
            : <RecommendationMessage
                key={entry.card.id}
                card={entry.card}
                onPlayTrack={experience.playTrack}
                onNarrationAction={experience.actOnNarration}
              />)}
          {experience.session.isGenerating ? <ChatMessage sender="system">
            <ChatMessageBubble variant="ghost">正在理解这一刻并整理歌曲…</ChatMessageBubble>
          </ChatMessage> : null}
          {experience.session.error ? <ChatMessage sender="system">
            <ChatMessageBubble variant="ghost">{experience.session.error}</ChatMessageBubble>
          </ChatMessage> : null}
        </ChatMessageList>
      </ChatLayout>
    </LayoutContent>}
  />;
}
```

- [ ] **Step 5: Run the full-page interaction test**

Run: `cd frontend && npm test -- tests/mock-experience.test.tsx`

Expected: 1 test passes and the composer submission creates a second recommendation.

- [ ] **Step 6: Commit the mock interaction flow**

```bash
git add frontend/src/features/experience/useMockExperience.ts frontend/src/components/MockExperiencePage.tsx frontend/tests/mock-experience.test.tsx
git commit -m "feat: connect complete mock recommendation flow"
```

### Task 7: Add the theme boundary and browser entry

**Files:**
- Create: `frontend/src/app/App.tsx`
- Create: `frontend/src/main.tsx`

- [ ] **Step 1: Extend the page test to render through the themed app**

Update the import and render in `frontend/tests/mock-experience.test.tsx`:

```tsx
import {App} from '../src/app/App';

render(<App gateway={new MockRecommendationGateway(0)} />);
```

- [ ] **Step 2: Run the test and confirm the missing App failure**

Run: `cd frontend && npm test -- tests/mock-experience.test.tsx`

Expected: FAIL because `src/app/App.tsx` does not exist.

- [ ] **Step 3: Implement the theme boundary**

Create `frontend/src/app/App.tsx`:

```tsx
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {MockExperiencePage} from '../components/MockExperiencePage';
import type {RecommendationGateway} from '../gateways/RecommendationGateway';
import {MockRecommendationGateway} from '../gateways/MockRecommendationGateway';

interface AppProps {
  gateway?: RecommendationGateway;
}

export function App({gateway = new MockRecommendationGateway()}: AppProps) {
  return <Theme theme={neutralTheme} mode="system">
    <MockExperiencePage gateway={gateway} />
  </Theme>;
}
```

Create `frontend/src/main.tsx`:

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import {App} from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('React root element is missing.');

createRoot(root).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 4: Run the themed interaction test**

Run: `cd frontend && npm test -- tests/mock-experience.test.tsx`

Expected: 1 test passes.

- [ ] **Step 5: Commit the entry point**

```bash
git add frontend/src/app/App.tsx frontend/src/main.tsx frontend/tests/mock-experience.test.tsx
git commit -m "feat: mount Astryx neutral themed app"
```

### Task 8: Verify the mock frontend without touching the original app

**Files:**
- Inspect: `frontend/src/**/*.tsx`
- Inspect: repository status

- [ ] **Step 1: Run the complete frontend test suite**

Run: `cd frontend && npm test`

Expected: 10 tests pass across 7 test files with zero failures.

- [ ] **Step 2: Run TypeScript checking**

Run: `cd frontend && npm run typecheck`

Expected: exit code 0 and no TypeScript diagnostics.

- [ ] **Step 3: Run the production build**

Run: `cd frontend && npm run build`

Expected: exit code 0 and generated files under `frontend/dist/`.

- [ ] **Step 4: Run the ASTRYX source audit**

Run:

```bash
rg -n '<(div|span)(\s|>)|#[0-9A-Fa-f]{3,8}|\b[0-9]+px\b|xstyle=' frontend/src --glob '*.tsx'
```

Expected: no matches in application source. Matches inside ASTRYX dependencies are irrelevant because the audit is scoped to `frontend/src`.

- [ ] **Step 5: Confirm the protected original files did not change**

Run:

```bash
git status --short -- pwa server.js test package.json package-lock.json yarn.lock
```

Expected: no new changes caused by this implementation. Pre-existing root changes must be recorded before execution and compared after execution; do not stage, revert, or include them in frontend commits.

- [ ] **Step 6: Start the preview and perform browser checks**

Run: `cd frontend && npm run dev`

Expected: Vite serves the React preview at `http://127.0.0.1:5173/` while the existing app remains available at its original address.

Verify in the browser:

1. Brand, service state, environment summary, existing recommendation, song rows, and composer render.
2. Environment fields open and accept edits.
3. Submitting a new prompt appends the user message, shows generation progress, and adds a recommendation.
4. Playing a song reveals the persistent player; previous, pause, next, progress, mute, and volume controls respond.
5. Playing narration changes its status temporarily and does not start a song.
6. At a phone-sized viewport, content remains single-column and controls wrap without horizontal scrolling.
