# This Moment — React + ASTRYX 独立前端设计

**日期：**2026-08-24

**状态：**已由用户逐段确认，待书面审阅

## 1. 目标

在不修改现有前端、后端和测试的前提下，新建一套独立的 React 前端。新版完整保留现有 Demo 的功能，但使用 ASTRYX 设计系统重新组织页面结构和交互。

新版先以 mock 数据完成页面和交互，再通过现有 HTTP API 与 WebSocket 接入真实后端。接入过程中仍只修改新前端目录，使用 Vite 开发服务器代理解决本地联调，不要求后端改变接口或静态资源服务方式。

## 2. 不可变边界

本轮只新增和修改 `frontend/`，另允许新增本设计文档与后续实施计划。下列现有内容不得修改：

- `pwa/` 原生前端；
- `server.js` 及其他现有后端实现；
- `test/` 现有测试；
- 现有启动命令、端口和根路径行为；
- 现有数据库、TTS 缓存和本地凭据。

开发期间，原版继续运行在现有地址。新版使用独立的 Vite 开发端口。是否将正式根路径切换到 React 不属于本轮范围，必须在新版完整验收后另行设计和授权。

## 3. 技术栈

- React 19；
- TypeScript；
- Vite；
- `@astryxdesign/core`；
- `@astryxdesign/theme-neutral`；
- `@stylexjs/stylex`，仅用于满足 ASTRYX 运行依赖；页面不使用 `xstyle`；
- Vitest；
- React Testing Library；
- Mock Service Worker，拦截 HTTP 请求并支持可控的 mock 场景。

ASTRYX Neutral Theme 在 React 入口接入。入口必须导入：

```ts
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
```

应用根节点由 ASTRYX `Theme` 包裹，并使用 `@astryxdesign/theme-neutral/built` 导出的 `neutralTheme`。

## 4. 总体架构

新版作为根仓库中的独立应用存在：

```text
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── app/             应用入口、主题与顶层错误边界
│   ├── domain/          前端领域模型和事件类型
│   ├── gateways/        Mock 与 Live 数据入口
│   ├── features/        环境、推荐会话、TTS、播放器
│   ├── components/      跨功能的组合组件
│   └── test/            测试工具与 fixtures
└── tests/               页面级和契约测试
```

页面组件不直接调用 `fetch`、`WebSocket`、`Audio` 或浏览器定位 API。所有外部能力通过可替换 gateway 或功能 hook 提供，使 mock 与 live 模式共用同一套页面组件。

## 5. 页面框架

ASTRYX 的 `ai-chat` 模板只作为结构参考，不直接复制全部功能。产品属于单一对话流，不使用 SideNav 或 TopNav。页面从外向内由以下区域构成：

1. 页面顶部：品牌、服务连接状态、环境摘要与环境编辑入口；
2. 中央对话流：用户需求、生成状态、推荐结果与历史卡片；
3. 固定输入区：音乐需求输入与发送按钮；
4. 条件式持久播放器：有当前歌曲时显示在页面底部。

桌面端采用居中的受限宽度对话流，避免文本和歌曲行横向拉伸。移动端保持单列，缩小密度并将播放器拆成两行，但不移除任何操作。

## 6. ASTRYX 组件约定

页面遵循 `AGENTS.md` 中 ASTRYX 规则：

- 使用 `Layout`、`LayoutContent`、`LayoutHeader`、`LayoutFooter` 建立页面框架；
- 使用 `ChatLayout`、`ChatMessageList`、`ChatMessage`、`ChatMessageBubble` 表达对话；
- 使用 `ChatComposer` 与相关输入、发送组件构建需求输入区；
- 使用 `Section`、`VStack`、`HStack` 和 `Grid` 组织内容；
- 推荐结果是一个独立的 AI 结果区块；歌曲集合使用 `List` 行，不给每首歌套 `Card`；
- 服务、WebSocket 和 TTS 状态使用带文字的 `StatusDot`；`Badge` 只用于数量；
- 持续错误使用 `Banner`；短暂的播放或操作反馈使用 `useToast`；
- 使用 ASTRYX `Button`、`Icon`、文本和进度类组件组合播放器；
- 优先使用组件 props；需要自定义时只使用 ASTRYX token；
- 不使用原始 `<div>` 或 `<span>` 进行布局，不写硬编码颜色和内部间距。

实施时，每使用一个 ASTRYX 组件前都必须运行 `npx astryx component <Name>` 核对真实 props，不根据名称猜测 API。

## 7. 功能模块

### 7.1 环境信息

负责城市、天气、当地时间、温度、体感温度、环境来源与预设选择。自动定位和手动输入之间保持现有优先级。定位失败不阻塞用户手动提交。

### 7.2 推荐会话

负责 session ID、历史卡片、用户消息、生成状态、有限轮询和 WebSocket 更新。`sessionId` 继续保存在 `localStorage`。WebSocket 断开不会清空已经渲染的对话；重连期间轮询继续兜底。

### 7.3 推荐语播放

负责 `pending`、`ready`、`playing`、`blocked` 与 `failed` 状态。只对当前会话中最新生成的推荐尝试自动播放一次。若用户已经播放歌曲，迟到的 TTS 不抢占歌曲。浏览器阻止自动播放时显示手动入口，不循环重试。

### 7.4 歌曲播放器

负责当前歌曲、推荐队列、播放状态、上一首、下一首、进度、静音和音量。播放 URL 只在用户发起播放时解析。播放事件以非阻塞方式上报；上报失败不停止音频。

## 8. Gateway 与数据模型

页面依赖统一的 `RecommendationGateway`，其职责包括：

- 获取服务状态；
- 获取环境预设；
- 解析环境；
- 获取会话卡片；
- 提交推荐请求；
- 订阅会话事件；
- 重试 TTS；
- 解析歌曲播放地址；
- 上报播放事件。

`MockRecommendationGateway` 使用固定 fixtures 和可控计时器模拟生成、TTS 就绪、断线、失败和重试。`LiveRecommendationGateway` 调用现有 `/api/*` 并连接 `/stream`。

页面只消费规范化后的领域模型。Mock 与 Live gateway 必须通过同一套契约测试，确保返回值、错误类型和事件语义一致。

## 9. 模式切换与本地联调

使用前端环境变量选择 gateway：

```text
VITE_DATA_MODE=mock
VITE_DATA_MODE=live
```

默认开发模式为 mock。live 模式中，Vite 将 `/api` HTTP 请求和 `/stream` WebSocket 代理到现有后端地址。前端不得复制或暴露 `.env` 中的服务端凭据。

## 10. 关键数据流

### Mock 页面阶段

1. 应用从 mock gateway 加载服务状态、环境预设和历史卡片；
2. 用户提交需求，页面立即显示用户消息和生成进度；
3. mock gateway 按可控顺序发送推荐完成与 TTS 状态事件；
4. 推荐区块、歌曲列表和播放器完成全流程交互验证。

### Live 接入阶段

1. 应用从现有状态、环境和卡片接口初始化；
2. 用户提交请求后，由 WebSocket 事件驱动进度和卡片更新；
3. 有限轮询负责补偿慢任务或漏收的 WebSocket 事件；
4. TTS 与歌曲播放沿用现有端点和交互语义；
5. Mock 与 Live 只替换 gateway，不替换页面组件。

## 11. 错误处理

- 初始化失败：保留页面输入和已有内容，顶部显示可重试 `Banner`；
- 推荐失败：在对应用户消息后显示系统错误消息，保留用户原文；
- WebSocket 断开：使用 `StatusDot` 显示重连状态，有限轮询继续运行；
- TTS 失败：只更新推荐语区域并提供重试，不影响歌曲；
- 自动播放被阻止：切换到手动播放推荐语，不自动重复尝试；
- 歌曲解析或播放失败：显示 Toast，保留列表及其他歌曲操作；
- 播放事件上报失败：静默保留音频播放；
- 所有用户可见错误使用固定中文文案，不显示上游响应、堆栈或凭据。

## 12. 测试策略

所有新增测试位于 `frontend/`，不修改现有 `test/`。

### 单元测试

- API 数据规范化；
- 推荐会话 reducer；
- 有限轮询与清理；
- WebSocket 事件去重和迟到事件处理；
- TTS 自动播放一次及不抢占歌曲；
- 歌曲队列、上一首、下一首和进度状态。

### 组件测试

- 输入、发送、禁用与重复请求保护；
- 用户消息、生成进度和推荐结果顺序；
- 环境编辑与预设选择；
- TTS 各状态及重试入口；
- 歌曲选择与持久播放器；
- 错误 Banner、系统消息和 Toast。

### 契约与集成测试

- Mock 与 Live gateway 返回相同领域模型；
- HTTP 端点、请求体和响应映射匹配现有后端；
- WebSocket 断开、重连、重复事件与迟到事件；
- mock 模式完整用户流程；
- live 模式通过 Vite proxy 与现有服务联调。

### 完成前验证

- TypeScript 类型检查；
- Vitest 全量测试；
- Vite 生产构建；
- ASTRYX 自检：无原始布局 `<div>/<span>`、无硬编码颜色或内部间距、无猜测的组件 props；
- 桌面与移动浏览器流程；
- 原版 `localhost:8080` 仍可访问且行为不变。

## 13. 实施阶段

### 阶段一：独立工程与 mock 页面

在 `frontend/` 建立 React、TypeScript、Vite、ASTRYX 和测试基础设施，接入 Neutral Theme，完成所有页面区域及 mock 交互。

### 阶段二：真实数据接入

实现 Live gateway、Vite HTTP/WebSocket proxy、轮询补偿、真实播放器和 TTS 状态流。此阶段仍不改动后端。

### 阶段三：并行验收

同时运行旧版和 React 新版，逐项比较功能、错误状态、移动端行为与性能。发现问题只在 `frontend/` 修复。

正式入口切换不包含在上述阶段中。

## 14. 完成标准

- `frontend/` 可独立安装、启动、测试和构建；
- mock 模式覆盖完整推荐、TTS 和歌曲播放交互；
- live 模式可通过代理使用现有全部后端能力；
- 现有功能在 React 新版中完整保留；
- 页面遵循 ASTRYX 组件、主题、布局与 token 约定；
- 桌面端与移动端可用；
- 错误不会清空对话、阻塞无关功能或泄露内部信息；
- 原前端、后端、测试和启动流程没有任何修改。
