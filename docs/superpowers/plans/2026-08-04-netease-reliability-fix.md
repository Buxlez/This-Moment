# Netease Reliability Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让有效网易云账号被正确识别，并在限流条件下从扩大后的候选池稳定获得尽可能多的真实可播放歌曲。

**Architecture:** 登录检测在 `/login/status` 之后使用 `/user/account` 兜底。网易云客户端集中负责请求节流、限流重试和短期缓存；推荐校验以两个工作线程逐步处理 32 首候选，达到 8 首后停止领取新任务。

**Tech Stack:** Node.js、NeteaseCloudMusicApi、DeepSeek、Node.js test runner、Playwright CLI。

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `netease-session.js` | Modify | 登录状态双接口识别 |
| `music-netease.js` | Modify | 节流、重试、缓存和可注入测试边界 |
| `src/music/provider.js` | Modify | 候选逐步校验与达到目标后提前停止 |
| `src/recommendation/pipeline.js` | Modify | 32 首候选与并发 2 的产品配置 |
| `test/netease-session.test.js` | Modify | 登录兜底回归测试 |
| `test/music.test.js` | Modify | 重试、缓存、节流和提前停止测试 |
| `test/pipeline.test.js` | Modify | 候选数量和并发契约测试 |

### Task 1: 登录状态兜底

**Files:**
- Modify: `netease-session.js`
- Test: `test/netease-session.test.js`

- [x] **Step 1: Write the failing test**

新增注入式请求测试：`/login/status` 返回空 profile，`/user/account` 返回 `{ account: { id: 17788957037 } }`，断言 `verifyLoginStatus` 返回 `{ valid: true, userId: 17788957037, reason: 'account-fallback' }`。

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/netease-session.test.js`  
Expected: FAIL，因为当前函数不会调用 `/user/account`。

- [x] **Step 3: Implement the fallback**

让 `verifyLoginStatus({ requestJson })` 支持注入请求函数；先检查 `/login/status`，profile 缺失时检查 `/user/account` 的 `account.id`，两个接口都失败时保留脱敏错误原因。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/netease-session.test.js`  
Expected: PASS。

### Task 2: 限流退避与短期缓存

**Files:**
- Modify: `music-netease.js`
- Test: `test/music.test.js`

- [x] **Step 1: Write failing retry tests**

通过注入 `requestJson` 和 `sleep` 模拟第一次抛出带 `status=405` 的错误、第二次成功；断言调用 2 次并等待一次。再模拟 `status=500`，断言只调用 1 次。

- [x] **Step 2: Run retry tests and verify red**

Run: `node --test test/music.test.js`  
Expected: FAIL，因为当前搜索失败后直接返回 `null`。

- [x] **Step 3: Implement minimal retry helper**

实现 `requestWithRetry(operation, { sleep, retries: 2 })`，只重试 `405` 和 `429`，退避 700 ms、1400 ms。让搜索、播放校验和详情查询通过该 helper 调用。

- [x] **Step 4: Write and verify failing cache tests**

同一查询连续调用两次，断言底层搜索只执行一次；同一歌曲可播判断和详情查询也分别只执行一次。

- [x] **Step 5: Implement TTL caches**

加入进程内 Map 缓存：搜索 10 分钟、可播结果 2 分钟、详情 30 分钟。提供仅测试使用的 `clearCaches()`，播放器解析真实 URL 时不复用 URL 本身。

- [x] **Step 6: Write and verify failing pacing test**

注入 `now` 与 `sleep`，连续两个请求应在第二个请求前补足 350 ms；断言 sleep 收到缺失的间隔。

- [x] **Step 7: Implement shared request pacing**

所有网易云 HTTP 操作进入同一个 Promise 队列，相邻开始时间至少相隔 350 ms；队列中的失败不能阻塞后续请求。

- [x] **Step 8: Run focused tests**

Run: `node --test test/music.test.js`  
Expected: PASS，无未处理警告。

### Task 3: 候选提前停止与 32 首候选池

**Files:**
- Modify: `src/music/provider.js`
- Modify: `src/recommendation/pipeline.js`
- Test: `test/music.test.js`
- Test: `test/pipeline.test.js`

- [x] **Step 1: Write failing early-stop test**

准备 12 个全部可播的候选，以 `limit: 8, concurrency: 2` 调用 `validateCandidates`；断言返回 8 首且搜索调用次数小于 12。

- [x] **Step 2: Run test and verify red**

Run: `node --test test/music.test.js`  
Expected: FAIL，因为当前 `mapLimit` 会处理所有候选。

- [x] **Step 3: Implement worker-pool early stop**

两个 worker 在结果达到 limit 后停止领取新索引；按原候选索引排序，继续执行匹配、排除和去重。已开始的第二个 worker 最多允许多完成一首，但最终结果严格截断到 8。

- [x] **Step 4: Write failing pipeline contract test**

断言 LLM 收到 `candidateCount: 32`，验证器配置为 `concurrency: 2`，默认目标仍为 8。

- [x] **Step 5: Update pipeline configuration**

将候选数从 `targetTrackCount * 2` 改为 `targetTrackCount * 4`，并发从 4 改为 2；不增加第二次模型调用。

- [x] **Step 6: Run focused and full tests**

Run: `node --test test/music.test.js test/pipeline.test.js && npm test`  
Expected: all PASS。

### Task 4: 真实 SVIP 验收

**Files:**
- Modify: `docs/superpowers/plans/2026-08-04-netease-reliability-fix.md`（勾选完成项）
- Create: `output/playwright/netease-reliability-live.png`

- [x] **Step 1: Restart live services**

停止当前 `npm start` 会话并重启，确认日志显示 `/user/account` 兜底识别出的账号，且不要求重复扫码。

- [x] **Step 2: Verify status API**

请求 `/api/netease/status`，确认 `connected: true`、`loggedIn: true`，响应不包含 Cookie。

- [x] **Step 3: Generate a fresh recommendation**

在全新浏览器会话输入“我现在有点困了”，等待任务完成；检查未恢复的 `405` 数量、真实歌曲数量和封面网络加载。

- [x] **Step 4: Verify playback**

点击第一首，确认 `<audio>` 的 `paused` 为 `false`、`currentTime` 增长、当前歌曲行高亮且底部播放器出现。

- [x] **Step 5: Save screenshot and run final verification**

保存 `output/playwright/netease-reliability-live.png`；运行 `npm test`、语法检查、`git diff --check`，并确认干净浏览器控制台 0 error。

## Implementation discoveries

- 旧 `/search` 端点在账号冷却期间持续返回 `405`，而 `/cloudsearch` 同时可用；实现已测试先行切换到 `/cloudsearch`。
- NeteaseCloudMusicApi sidecar 不会把传入的 HTTP `Cookie` Header用于模块请求，必须使用 `cookie` 参数。此前二维码虽然成功，业务请求仍落到匿名账号；修复后识别到真实非匿名 VIP 账号。
- 真实验收得到 8 首歌曲、8 张有效封面，第一首音频可播放且当前行与底部播放器同步。
