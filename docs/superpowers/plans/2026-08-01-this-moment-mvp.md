# this moment MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Claudio-FM 锁定版本上完成一个本地单用户 MVP：用户选择天气并说一句模糊诉求，系统按 Claudio 的 Context → DeepSeek → 网易云链路生成最多 20 首可播放歌曲的推荐卡片，并为卡片推荐语提供轻量 TTS。

**Architecture:** 保留 Claudio-FM 的单体 Node.js 架构、Express HTTP、WebSocket、SQLite、本地 Markdown 用户画像、OpenAI-compatible DeepSeek、NeteaseCloudMusicApi sidecar、网易云二维码登录和火山引擎 TTS。只增加天气预设、卡片持久化和卡片播放器；不加入新的语义中间层、Demo Provider、真实天气 API、第二轮模型补选或 `yt-dlp` 回退。

**Tech Stack:** Node.js 20+、Express 4、`ws`、`better-sqlite3`、OpenAI SDK、NeteaseCloudMusicApi、Volcengine TTS、原生 HTML/CSS/JavaScript、Node.js test runner。

**Locked upstream:** `bingyanglu/Claudio-FM@4939b1adc5ddc5ed1289a1e93cd0235b98634abe`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `weather.js` | Create | 六种天气预设、默认值和输入校验 |
| `context.js` | Modify | 按 Claudio 方式拼接画像、规则、时间、天气、历史和请求 |
| `prompts/dj-persona.md` | Modify | 从连续电台主持人改为单张推荐卡片的输出契约 |
| `user/taste.md` | Modify | MVP 可编辑听歌偏好 |
| `user/mood-rules.md` | Modify | 情绪与场景推歌规则 |
| `llm.js` | Modify | DeepSeek JSON 解析、字段校验、一次格式修复 |
| `claude.js` | Modify | 保留 Claudio 兼容入口并统一返回结构 |
| `music.js` | Modify | 固定网易云解析，移除 `yt-dlp` 回退 |
| `music-netease.js` | Modify | 搜索、元数据、可播放 URL 和按 ID 刷新 URL |
| `recommendation.js` | Create | 有序并发搜索、匹配、去重、近期排除、最多 20 首 |
| `state.js` | Modify | messages、plays、cards、card_tracks、TTS 状态 |
| `recommendation-service.js` | Create | 从用户输入到持久化卡片及异步 TTS 的完整编排 |
| `router.js` | Modify | 只保留 Claudio 式简单指令与自然语言推荐分流 |
| `server.js` | Modify | HTTP/WebSocket 契约和依赖装配 |
| `scripts/start.js` | Modify | 网易云 sidecar、二维码登录引导和主服务启动 |
| `tts.js` | Modify | 仅合成推荐卡片两句文案并缓存 MP3 |
| `pwa/player.js` | Create/Replace | 推荐语前奏、顺序队列、单曲和整卡播放 |
| `pwa/app.js` | Create/Replace | 页面状态、接口调用、WebSocket 更新和卡片渲染 |
| `pwa/index.html` | Replace | 单页 Demo 结构 |
| `pwa/styles.css` | Create/Replace | 响应式视觉和交互状态 |
| `test/*.test.js` | Create/Replace | 纯函数、数据库、服务、接口和播放器测试 |
| `.env.example` | Modify | 仅保留 DeepSeek、网易云和火山 TTS 必要变量 |
| `.gitignore` | Modify | 保护密钥、Cookie、SQLite 和 TTS 缓存 |
| `README.md` | Modify | 启动、登录、验收、来源和许可边界 |

---

### Task 1: 固定基线并清理与最终方案冲突的原型

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Delete after coverage replacement: `src/domain/environment.js`, `src/domain/intent.js`, `src/domain/recommendation-schema.js`, `src/music/demo-catalog.js`, `src/music/provider.js`, `src/recommendation/pipeline.js`
- Delete after import removal: `music-yt-dlp.js`
- Delete after import removal: `scheduler.js`
- Replace tests: `test/domain.test.js`, `test/music.test.js`, `test/pipeline.test.js`

- [ ] **Step 1: 核对上游基线和当前改动，不覆盖现有工作**

Run:

```bash
git rev-parse HEAD
git remote get-url upstream
git status --short
```

Expected: HEAD 为 `4939b1adc5ddc5ed1289a1e93cd0235b98634abe`，upstream 为 Claudio-FM，工作区改动清单可见。

- [ ] **Step 2: 先写架构边界测试并确认 RED**

在 `test/architecture.test.js` 断言生产代码不存在 `DEMO_MODE`、`demo-catalog`、`yt-dlp`、`Shanghai`、`refill`，并断言服务端不再加载 scheduler、来电 TTS 或原电台 bridge，`package.json` 不再依赖只为旧原型引入的 `zod`。

Run: `node --test test/architecture.test.js`

Expected: FAIL，并精确列出仍存在的旧原型边界。

- [ ] **Step 3: 清除冲突实现，保留 Claudio 原始适配器**

移除 Demo Provider、显式意图分类、上海默认环境、第二次大模型补选、scheduler、原电台 bridge、来电 TTS 和 `yt-dlp` 回退。将仍有价值的测试迁移到后续模块后再删除旧文件，避免先删覆盖。

- [ ] **Step 4: 补齐本地敏感文件忽略规则**

`.gitignore` 至少包含：

```gitignore
.env
*.sqlite
data/netease/
cache/tts/
*.log
.playwright-cli/
output/
```

- [ ] **Step 5: 运行边界测试并提交**

Run: `node --test test/architecture.test.js`

Expected: PASS。

```bash
git add .gitignore README.md package.json package-lock.json yarn.lock test/architecture.test.js
git add -u music-yt-dlp.js scheduler.js
git commit -m "refactor: align MVP with Claudio architecture"
```

---

### Task 2: 实现六种可选择天气预设

**Files:**
- Create: `weather.js`
- Create: `test/weather.test.js`

- [ ] **Step 1: 写失败测试**

覆盖：固定六项、默认 `sunny`、非法 ID 回退 `sunny`、返回给 Prompt 的文字稳定、调用方不能修改预设数组。

Run: `node --test test/weather.test.js`

Expected: FAIL because `weather.js` does not exist.

- [ ] **Step 2: 实现最小天气模块**

导出 `WEATHER_PRESETS`、`DEFAULT_WEATHER_ID`、`listWeatherPresets()`、`resolveWeather(id)`：

```js
const WEATHER_PRESETS = Object.freeze([
  { id: 'sunny', label: '晴朗', prompt: '页面模拟天气：晴朗，整体明亮、轻松。' },
  { id: 'cloudy', label: '多云', prompt: '页面模拟天气：多云，整体柔和、平稳。' },
  { id: 'light_rain', label: '小雨', prompt: '页面模拟天气：小雨，环境松弛、有空间感。' },
  { id: 'heavy_rain', label: '大雨', prompt: '页面模拟天气：大雨，环境包裹感强，外界噪声较明显。' },
  { id: 'hot', label: '炎热', prompt: '页面模拟天气：炎热，希望听感清爽、轻盈。' },
  { id: 'cold', label: '寒冷', prompt: '页面模拟天气：寒冷，希望听感温暖、舒展。' },
]);
```

- [ ] **Step 3: 验证并提交**

Run: `node --test test/weather.test.js`

Expected: 5 tests pass.

```bash
git add weather.js test/weather.test.js
git commit -m "feat: add selectable weather presets"
```

---

### Task 3: 按 Claudio 方式重建推荐上下文

**Files:**
- Modify: `context.js`
- Modify: `prompts/dj-persona.md`
- Modify: `user/taste.md`
- Modify: `user/mood-rules.md`
- Modify: `user/routines.md`
- Create: `test/context.test.js`

- [ ] **Step 1: 写失败测试**

使用临时 Markdown 内容和假 state，断言 Prompt 依序包含：系统人格、`taste.md`、`routines.md`、`mood-rules.md`、电脑当前时间、所选天气、最近 20 条播放、最近 8 条消息、上一张卡片、当前输入和 JSON 契约。Prompt 必须明确“用户原话中出现的天气优先于页面预设”；断言没有 `atmosphere`、`energy`、`rhythm` 中间字段。

Run: `node --test test/context.test.js`

Expected: FAIL because the current context omits weather/previous card or uses the old radio contract.

- [ ] **Step 2: 实现单一入口**

实现：

```js
async function buildRecommendationPrompt({
  userInput,
  weather,
  previousCard,
  now = new Date(),
  state,
})
```

结尾要求模型只返回：

```json
{
  "title": "卡片标题",
  "say": "两句话、45 至 70 个中文字符的推荐语",
  "play": ["歌曲名 - 歌手名"],
  "reason": "内部简短说明"
}
```

`play` 要求约 30 个候选；`reason` 只存储、不在首屏突出展示。

- [ ] **Step 3: 调整画像文件**

保留 Claudio 的 Markdown 可编辑机制；写入用于 MVP 演示的真实偏好和情绪规则，避免把规则硬编码进 JavaScript。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/context.test.js`

Expected: all context tests pass.

```bash
git add context.js prompts/dj-persona.md user test/context.test.js
git commit -m "feat: compose Claudio-style recommendation context"
```

---

### Task 4: 收紧 DeepSeek 输出解析并只重试一次格式错误

**Files:**
- Modify: `llm.js`
- Modify: `claude.js`
- Create: `test/llm.test.js`

- [ ] **Step 1: 写失败测试**

覆盖：合法对象、Markdown code fence 包裹 JSON、缺少 `title/say/play/reason`、`play` 非字符串数组、推荐语不是两句或不在 45–70 中文字符范围、首次格式错误后修复成功、连续两次失败后抛出可读错误。

Run: `node --test test/llm.test.js`

Expected: FAIL on the current loose parser.

- [ ] **Step 2: 实现原生校验器**

导出：

```js
function validateRecommendation(value) {}
async function generateRecommendation(prompt, { callModel } = {}) {}
```

`generateRecommendation` 第一次失败时向同一模型追加“只修复 JSON 结构，不改变选歌意图”，最多再调用一次。不得发起第二轮补歌请求。

- [ ] **Step 3: 保留 Claudio 的模型接入方式**

DeepSeek 继续通过 OpenAI-compatible SDK 调用；`claude.js` 仅作为 Claudio 原有 CLI 兼容适配器，二者最终经过同一校验器。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/llm.test.js`

Expected: all LLM unit tests pass without network access.

```bash
git add llm.js claude.js test/llm.test.js
git commit -m "feat: validate recommendation model output"
```

---

### Task 5: 固定网易云搜索、匹配和播放校验

**Files:**
- Modify: `music.js`
- Modify: `music-netease.js`
- Create: `recommendation.js`
- Create: `test/recommendation.test.js`

- [ ] **Step 1: 写失败测试**

为网易云调用注入假 HTTP client，覆盖：按模型候选顺序返回、歌名/歌手标准化匹配、同一网易云 ID 去重、排除最近 24 小时进入队列的歌曲和上一张卡片、不可播放歌曲过滤、同一主歌手最多连续 2 首、并发上限为 4、结果最多 20 首、没有达到 20 首时直接返回已有结果并附带数量不足警告。

Run: `node --test test/recommendation.test.js`

Expected: FAIL because the ordered resolver does not exist.

- [ ] **Step 2: 扩展网易云适配器**

`music-netease.js` 统一返回：

```js
{
  id,
  title,
  artists,
  album,
  coverUrl,
  durationMs,
  playbackUrl,
  provider: 'netease',
}
```

提供 `searchTrack(query)`、`getPlayableTrack(candidate)` 和 `getTrackById(id)`；播放 URL 在真正播放前可按 ID 刷新，避免缓存短期 URL。

- [ ] **Step 3: 实现有序并发解析器**

导出：

```js
async function resolveRecommendations({
  candidates,
  recentTrackIds,
  previousTrackIds,
  getPlayableTrack,
  limit = 20,
  concurrency = 4,
}) {}
```

搜索可并发，但最终结果必须保持模型候选顺序；不得使用 `yt-dlp` 或其它音乐源补位。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/recommendation.test.js`

Expected: all resolver tests pass and the max observed concurrency is 4.

```bash
git add music.js music-netease.js recommendation.js test/recommendation.test.js
git commit -m "feat: resolve recommendations through Netease only"
```

---

### Task 6: 为推荐卡片扩展 SQLite 状态

**Files:**
- Modify: `state.js`
- Create: `test/state.test.js`

- [ ] **Step 1: 写失败测试**

使用 `:memory:` 数据库，保存两轮 messages、plays、card 和 3 首有顺序的 tracks，关闭并使用临时文件重开；断言顺序、天气、用户输入、推荐文案、内部 reason、TTS 状态完整恢复。覆盖不存在卡片和重复网易云 ID 的行为。

Run: `node --test test/state.test.js`

Expected: FAIL because cards/card_tracks are not yet supported by the Claudio state module.

- [ ] **Step 2: 将默认单例改为可测试工厂**

实现 `createState(dbPath = process.env.STATE_DB || 'this-moment.sqlite')`，同时保留默认导出，避免破坏 Claudio 现有调用点。

- [ ] **Step 3: 添加幂等表结构**

```sql
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_input TEXT NOT NULL,
  weather_id TEXT NOT NULL,
  title TEXT NOT NULL,
  say TEXT NOT NULL,
  reason TEXT NOT NULL,
  warning TEXT,
  tts_status TEXT NOT NULL DEFAULT 'pending',
  tts_filename TEXT,
  tts_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS card_tracks (
  card_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  netease_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT,
  cover_url TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (card_id, position),
  UNIQUE (card_id, netease_id)
);
```

- [ ] **Step 4: 暴露所需查询**

实现 `saveMessage`、`recentMessages(8)`、`recordPlay`、`recentPlays(20)`、`recentPlayIdsSince(24)`、`saveCard`、`getCard`、`listCards`、`getLatestCard`、`updateCardTts`。继续保留 Claudio 的 `prefs` 表，用来保存最近天气和“播放全部时先播推荐语”开关。

- [ ] **Step 5: 验证并提交**

Run: `node --test test/state.test.js`

Expected: all in-memory and reopen tests pass.

```bash
git add state.js test/state.test.js
git commit -m "feat: persist recommendation cards and tracks"
```

---

### Task 7: 编排一轮完整推荐并异步生成 TTS

**Files:**
- Create: `recommendation-service.js`
- Modify: `tts.js`
- Create: `test/recommendation-service.test.js`

- [ ] **Step 1: 写失败测试**

注入 fake state、model、Netease resolver、TTS 和 broadcaster，断言严格顺序：保存用户消息 → 拼 Context → 调模型一次 → 网易云解析 → 保存卡片 → 返回卡片 → 后台 TTS。验证 TTS 拒绝时卡片仍成功且状态变为 `failed`；验证没有可播放歌曲时返回明确错误且不保存空卡片。

Run: `node --test test/recommendation-service.test.js`

Expected: FAIL because the service does not exist.

- [ ] **Step 2: 实现服务工厂**

```js
function createRecommendationService({
  state,
  buildPrompt,
  generate,
  resolveTracks,
  synthesize,
  broadcast,
}) {}
```

服务对外提供 `recommend({ userInput, weatherId })` 和 `retryTts(cardId)`。进度事件固定为：`understanding`、`searching`、`validating`、`composing`、`complete`。

- [ ] **Step 3: 限定 TTS 文本和缓存**

`tts.js` 只接收已校验的 `say`，以“文本 + 音色 + 语速”的 SHA-256 作为缓存键，输出到 `cache/tts/<64位哈希>.mp3`。不得对用户输入、歌曲名或逐首介绍进行合成；已有非空 MP3 直接复用。

- [ ] **Step 4: 验证并提交**

Run: `node --test test/recommendation-service.test.js`

Expected: service tests pass, including non-blocking TTS failure.

```bash
git add recommendation-service.js tts.js test/recommendation-service.test.js
git commit -m "feat: orchestrate card recommendation and narration"
```

---

### Task 8: 收敛 HTTP 与 WebSocket 契约

**Files:**
- Modify: `router.js`
- Modify: `server.js`
- Modify: `netease-session.js`
- Create: `test/server.test.js`

- [ ] **Step 1: 写失败接口测试**

用临时端口和 fake dependencies 覆盖：

```text
POST /api/chat
GET  /api/cards
GET  /api/cards/:id
GET  /api/weather-presets
POST /api/playback/resolve
POST /api/cards/:id/tts/retry
GET  /api/tts/:filename
GET  /api/now
GET  /api/next
WS   /stream
```

同时覆盖空输入、超过 500 字的输入、未知天气、未知卡片、非法歌曲 ID、目录穿越文件名、上游失败和 JSON 错误体。

Run: `node --test test/server.test.js`

Expected: FAIL against the radio-oriented server.

- [ ] **Step 2: 将 server 改为可测试组合根**

导出 `createHttpServer(dependencies)`，只有 `require.main === module` 时才读取 `.env`、打开真实 SQLite、连接网易云和监听端口。`POST /api/chat` 返回已持久化卡片；TTS 状态通过 WebSocket 后续更新。

- [ ] **Step 3: 安全提供 TTS 文件**

只接受与 `^[a-f0-9]{64}\\.mp3$` 匹配的 basename，并确认文件位于 `cache/tts`。禁止把 Cookie、API key、网易云临时播放 URL写入日志或接口错误体。

- [ ] **Step 4: 保留 Claudio 的登录能力**

继续复用 `netease-session.js` 的二维码登录、本地 Cookie、状态轮询和敏感信息脱敏；不要新建账号系统。

- [ ] **Step 5: 验证并提交**

Run: `node --test test/server.test.js`

Expected: all HTTP and WebSocket contract tests pass without external network calls.

```bash
git add router.js server.js netease-session.js test/server.test.js
git commit -m "feat: expose this moment API and event stream"
```

---

### Task 9: 保留一键启动与网易云二维码登录

**Files:**
- Modify: `scripts/start.js`
- Modify: `scripts/netease-login.js`
- Modify: `scripts/netease-status.js`
- Modify: `.env.example`
- Create: `test/start.test.js`

- [ ] **Step 1: 写失败测试**

把进程启动和 HTTP 探测作为注入依赖，覆盖：已有 sidecar 时不重复启动；未运行时执行 `npx NeteaseCloudMusicApi@latest`；等待健康检查后才启动主服务；未登录时显示二维码入口；`NETEASE_AUTO_START=false` 时给出清晰提示。

Run: `node --test test/start.test.js`

Expected: FAIL until startup logic is separated from process side effects.

- [ ] **Step 2: 保留 Claudio 启动顺序并更新配置**

`.env.example` 使用：

```dotenv
PORT=8080
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
MUSIC_PROVIDER=netease
NETEASE_API_BASE=http://127.0.0.1:3000
NETEASE_AUTO_START=true
NETEASE_REQUIRED=true
NETEASE_LOGIN_BOOTSTRAP=true
NETEASE_LEVEL=standard
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_RESOURCE_ID=volc.service_type.10029
VOLCENGINE_TTS_VOICE_TYPE=zh_female_shuangkuaisisi_moon_bigtts
```

不得保留 `DEMO_MODE`、真实天气 API 或 `yt-dlp` 配置。

- [ ] **Step 3: 验证并提交**

Run: `node --test test/start.test.js`

Expected: all startup tests pass.

```bash
git add scripts .env.example test/start.test.js
git commit -m "feat: preserve Claudio local startup flow"
```

---

### Task 10: 实现推荐语前奏与卡片播放队列

**Files:**
- Replace: `pwa/player.js`
- Create: `test/player.test.js`

- [ ] **Step 1: 写失败播放器测试**

覆盖：单曲点击立即播放；“播放全部”在 TTS ready 时生成 `[narration, track1...trackN]`；TTS pending/failed 时只生成歌曲队列；TTS 播完自动进入第 1 首；歌曲播放前刷新网易云 URL 并记录 play；刷新失败跳过该曲；上一首/下一首边界；队尾停止；新卡片替换旧队列。

Run: `node --test test/player.test.js`

Expected: FAIL until the queue behavior exactly matches the approved flow.

- [ ] **Step 2: 实现可在 Node 和浏览器复用的播放器核心**

采用 UMD/CommonJS 兼容导出，至少包含：

```js
function buildPlaySequence(card, { includeNarration = true } = {}) {}
function nextIndex(sequence, currentIndex) {}
function createPlayerController({ audio, resolveTrack, onState }) {}
```

推荐语不自动播放；只有用户点击“播放推荐语”或“播放全部”才播放音频。

- [ ] **Step 3: 验证并提交**

Run: `node --test test/player.test.js`

Expected: all player state tests pass.

```bash
git add pwa/player.js test/player.test.js
git commit -m "feat: add narration-first card playback"
```

---

### Task 11: 替换为最小可演示网页

**Files:**
- Replace: `pwa/index.html`
- Replace: `pwa/app.js`
- Replace: `pwa/styles.css`
- Keep/Create: `pwa/assets/placeholder-cover.svg`
- Create: `test/ui-smoke.test.js`

- [ ] **Step 1: 写失败 UI smoke test**

读取静态文件并断言存在这些稳定挂载点：`weather-presets`、`recommendation-form`、`recommendation-input`、`recommendation-status`、`cards`、`player`、`narration-audio`、`track-audio`；断言六种天气由 `/api/weather-presets` 获取，而非在 HTML 复制一套数据。

Run: `node --test test/ui-smoke.test.js`

Expected: FAIL against the current prototype markup or duplicated preset data.

- [ ] **Step 2: 实现单页流程**

页面只保留：品牌、网易云登录状态与当前时间、六种天气、自然语言输入、四段进度、最新推荐卡片、历史卡片、固定播放器。默认晴朗；按钮文案包含“给我推荐”“播放推荐语”“播放全部”“换一批”。每首歌显示封面、歌名、歌手和播放按钮；每张卡片默认展示前 6 首，并可展开最多 20 首。

- [ ] **Step 3: 接通接口与 WebSocket**

提交时禁用表单并显示进度；收到卡片立即渲染；收到 `tts.ready` 或 `tts.failed` 更新按钮状态；刷新页面从 `/api/cards` 恢复历史。对服务端文本统一使用 `textContent`，不通过 `innerHTML` 注入。

- [ ] **Step 4: 完成可访问性和响应式底线**

所有交互使用 `<button>`/`<form>`；播放器提供暂停/继续、上一首、下一首和进度拖动；提供 visible focus、`aria-live`、键盘操作、`prefers-reduced-motion`；在 390px 和 1440px 宽度无水平滚动。

- [ ] **Step 5: 验证并提交**

Run:

```bash
node --test test/ui-smoke.test.js test/player.test.js
node --check pwa/app.js
```

Expected: all tests pass and syntax check exits 0.

```bash
git add pwa test/ui-smoke.test.js
git commit -m "feat: build this moment recommendation interface"
```

---

### Task 12: 全链路验收、文档和来源边界

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-01-this-moment-mvp-design.md`
- Verify: all production and test files

- [ ] **Step 1: 运行全部自动化检查**

Run:

```bash
yarn test
node --check server.js
node --check scripts/start.js
node --check pwa/app.js
git diff --check
```

Expected: 0 test failures, all syntax checks exit 0, no whitespace errors.

- [ ] **Step 2: 使用真实本地服务启动**

Run: `yarn start`

Expected: NeteaseCloudMusicApi sidecar healthy; login status visible; app listens at `http://localhost:8080`. If DeepSeek, Netease login, or TTS credentials are absent, the UI must state which real dependency is unavailable; it must not silently substitute fake recommendations or audio.

- [ ] **Step 3: 验证基础接口**

Run:

```bash
curl -s http://localhost:8080/api/weather-presets
curl -s http://localhost:8080/api/cards
```

Expected: first response contains exactly six presets with `sunny` first; second response is a JSON array.

- [ ] **Step 4: 完成人工验收脚本**

在桌面和 390px 手机宽度分别验证：

1. 默认天气为晴朗，切到小雨。
2. 输入“上班路上有点困，想提神但别太吵”。
3. 观察“正在理解 → 正在找歌 → 正在确认播放 → 正在整理卡片”。
4. 得到 1–20 首真实网易云可播放歌曲，候选不足时不伪造补满。
5. 单曲点击可播；“播放全部”在 TTS 完成后先播推荐语再播第 1 首。
6. 输入“再安静一点”，新卡片能参考最近消息和上一张卡片并避开重复歌曲。
7. 刷新页面后两张卡片仍存在。
8. 模拟 TTS 失败，音乐卡片和歌曲播放仍正常。

- [ ] **Step 5: 完成 README**

写清：Node 版本、`yarn install`、环境变量、`yarn start`、网易云二维码登录、DeepSeek 和火山 TTS 配置、测试命令、故障排查、SQLite/Cookie/TTS 缓存位置。

README 必须注明：基于 `bingyanglu/Claudio-FM@4939b1a` 改造；上游当前未提供明确 LICENSE；本版本只用于本地内部原型，不公开分发或商业使用。

- [ ] **Step 6: 最终提交前检查**

Run:

```bash
git status --short
git diff --stat
git log --oneline --decorate -12
```

Expected: only intended files are modified; secrets、Cookie、SQLite、MP3、日志和截图均未暂存。

```bash
git add README.md docs/superpowers/specs/2026-08-01-this-moment-mvp-design.md
git commit -m "docs: document local MVP setup and attribution"
```

---

## Final acceptance gate

本计划只有同时满足以下条件才算完成：

- 推荐路径是 `taste/rules/history/time/weather/input → DeepSeek → 网易云验证 → card`；
- 没有显式氛围/能量/节奏中间层；
- 没有 Demo Provider、真实天气 API、`yt-dlp` 回退或第二轮模型补选；
- 天气恰好六种，默认晴朗；
- 每张卡片最多 20 首真实网易云歌曲，可单曲播放和整卡顺序播放；
- TTS 只朗读两句推荐语，不自动播放，失败不阻塞音乐；
- 最近消息、最近播放和上一张卡片进入下一轮 Context；
- SQLite 能在重启后恢复卡片；
- 真实依赖不可用时明确报错，不伪造成功；
- 自动测试、语法检查、真实本地验收和 README 均完成。
