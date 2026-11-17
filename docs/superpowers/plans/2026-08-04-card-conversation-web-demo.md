# Card Conversation Web Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `this moment` 桌面网页改造成卡片式对话体验，同时保留环境模拟、推荐进度、连续微调、TTS 和队列播放能力。

**Architecture:** 前端继续使用原生 HTML、CSS、JavaScript，页面重组为单列对话舞台，推荐请求表现为“用户消息、环境快照、AI 推荐语、歌曲卡片”。服务端新增自动天气解析契约，并优化网易云搜索、可播放校验和详情补全顺序；环境和推荐依据使用原生折叠控件渐进披露，固定输入和播放器组成底部双层 Dock。

**Tech Stack:** Node.js、Express、原生 HTML/CSS/JavaScript、Node.js test runner、Playwright CLI。

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `test/ui.test.js` | Create | 锁定对话结构、可访问性、卡片渲染和桌面响应式边界 |
| `pwa/index.html` | Replace | 对话舞台、环境折叠区、固定输入与播放器语义结构 |
| `pwa/styles.css` | Replace | 暖白桌面、紫色消息气泡、白色音乐卡片和响应式布局 |
| `pwa/app.js` | Modify | 渲染用户消息、环境快照、封面、播放态、推荐依据和快捷微调 |
| `src/environment/open-meteo.js` | Create | 将浏览器位置即时解析为天气、温度、体感与当地时间 |
| `music-netease.js` | Modify | 分离歌曲搜索和详情补全，降低频率限制风险 |
| `netease-session.js` | Modify | 兼容 sidecar 登录状态缺少 profile 的情况，避免重复扫码 |

### Task 1: 锁定静态界面契约

- [x] **Step 1:** 创建 `test/ui.test.js`，读取三个 PWA 文件并断言 `conversationFeed`、`composerDock`、`environment-disclosure`、`aria-live`、`maxlength="500"`、设计变量、键盘焦点和 1024 px 桌面断点存在。
- [x] **Step 2:** 运行 `node --test test/ui.test.js`，确认因缺少新结构而失败。
- [x] **Step 3:** 替换 `pwa/index.html` 和 `pwa/styles.css`，保留现有 JavaScript 依赖的接口 ID。
- [x] **Step 4:** 再次运行测试并确认通过。

### Task 2: 对话化卡片渲染

- [x] **Step 1:** 扩展 `test/ui.test.js`，断言 `pwa/app.js` 渲染 `message-user`、`message-meta`、`recommendation-copy`、`track-cover`、`recommendation-reason`、`is-current` 和 `dataset.userPrompt`。
- [x] **Step 2:** 运行测试并确认因缺少渲染契约而失败。
- [x] **Step 3:** 修改 `pwa/app.js`，每张历史卡片渲染用户气泡、当轮环境、AI 推荐语、歌曲封面列表、原生依据折叠区和卡片操作。
- [x] **Step 4:** 播放、暂停或换曲时更新当前歌曲行与底部播放器；缺少封面和 TTS 时诚实降级。
- [x] **Step 5:** 运行 `node --test test/ui.test.js` 和 `npm test`。

### Task 3: 浏览器交互和视觉验收

- [x] **Step 1:** 启动本地 Demo，使用 Playwright CLI 打开页面并获取可访问性快照。
- [x] **Step 2:** 验收环境展开、示例输入、提交、进度、歌曲展开、单曲播放、播放全部、连续微调和换一批。
- [x] **Step 3:** 在 1440×1000 和 1024×900 视口检查对话关系、横向溢出、固定 Dock 遮挡和键盘焦点。
- [x] **Step 4:** 保存最终桌面截图到 `output/playwright/`，复查后运行一次完整 `npm test`。

### Task 4: 真实 DeepSeek 与网易云链路

- [x] **Step 1:** 验证 DeepSeek `deepseek-v4-flash` 的结构化推荐输出。
- [x] **Step 2:** 网易云搜索后校验真实播放地址，并仅为可播歌曲补充封面、专辑和时长。
- [x] **Step 3:** 兼容 sidecar 的 `profile-missing` 状态，复用本地 Cookie，避免每次启动重复扫码。
- [x] **Step 4:** 在浏览器中生成真实卡片，确认封面加载，并实际播放歌曲。

### Task 5: 自动天气与隐私降级

- [x] **Step 1:** 新增 Open-Meteo 天气码、温度边界和带时区时间的单元测试。
- [x] **Step 2:** 新增 `/api/environment/resolve`，严格校验坐标且不返回、不持久化精确位置。
- [x] **Step 3:** 浏览器请求定位并显示天气、温度、体感和当地时间；拒绝时保留手动环境。
- [x] **Step 4:** 使用新加坡坐标完成真实 Open-Meteo 和顶部环境 UI 验收。

### Task 6: 云端推荐语音

- [ ] **Step 1:** 配置火山引擎 TTS API Key。
- [ ] **Step 2:** 验证推荐语合成、缓存、播放全部前置朗读和失败降级。
