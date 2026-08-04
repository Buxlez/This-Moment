# this moment

`this moment` 是一个卡片式对话音乐推荐 Demo。你只需说一句当下的状态，它会结合当前时间、天气和演示品味，默认生成一张 8 首音乐卡片；真实音源不足时会如实显示已确认数量。新的微调和“换一批”会继续堆叠，旧卡片不会被覆盖。

## 直接运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm start
```

然后打开 [http://localhost:8080](http://localhost:8080)。

未配置密钥时默认进入“本地演示音源”：推荐、进度、8 首卡片、微调、换一批、历史恢复和播放器都可完整体验。音源会明确标记为“演示音源”，不会伪装成网易云校验结果。未配置云端 TTS 时，推荐语仍保留为文字，可配置后手动重试生成语音。

浏览器允许定位后，页面会通过 Open-Meteo 自动显示当前天气、温度、体感温度和当地时间。精确坐标只用于当次天气请求，不会持久化；拒绝定位时可以继续使用页面内的手动环境和六个预设。

## 接入真实服务

复制环境变量模板：

```bash
cp .env.example .env
```

然后至少设置：

```dotenv
DEMO_MODE=false
DEEPSEEK_API_KEY=your_key
MUSIC_PROVIDER=netease
```

`npm start` 会检查并启动本地 NeteaseCloudMusicApi sidecar。没有可用 Cookie 时，会生成 `data/netease/qr-login.html`，使用网易云音乐 App 扫码后将 Cookie 保存在本地 `data/` 中。

如需云端推荐语音，推荐使用火山引擎的 APP ID + Access Token 双请求头鉴权：

```dotenv
VOLCENGINE_TTS_APP_ID=your_app_id
VOLCENGINE_TTS_ACCESS_TOKEN=your_access_token
VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0
VOLCENGINE_TTS_VOICE_TYPE=zh_female_vv_uranus_bigtts
VOLCENGINE_TTS_FORMAT=mp3
VOLCENGINE_TTS_SAMPLE_RATE=24000
```

`VOLCENGINE_TTS_SECRET_KEY` 不参与鉴权，无需配置。如账号支持，也可只用 `VOLCENGINE_TTS_API_KEY` 作为另一种鉴权方式；两种方式都必须同时配置资源 ID 和音色。所有凭据只保存在服务端 `.env` 中，不得放入前端；公开状态接口仅返回“是否已配置”的布尔值，不暴露鉴权方式或任何凭据细节。

对接时请参考火山引擎官方的[单向流式 TTS 文档](https://docs.volcengine.com/docs/6561/2528925?lang=zh)和[双请求头鉴权文档](https://www.volcengine.com/docs/6561/2534847?lang=zh)。旧版双请求头模式使用 `X-Api-App-Id` 和 `X-Api-Access-Key`；`Secret Key` 不使用。

## 播放行为

最新生成的推荐卡片就绪后，页面会自动尝试一次推荐语旁白。如浏览器的自动播放策略拦截，界面会保留点击播放控件。TTS 失败时只显示安全的稍后重试提示，可手动重试，不会向页面返回上游错误或凭据细节。

歌曲始终由用户手动点击播放，播放结束后不会自动切到下一首；选择任何歌曲时会立即停止推荐语旁白。

## 验证

```bash
npm test
```

测试覆盖意图路由、环境优先级、Open-Meteo 映射、LLM Schema、音乐匹配去重与详情补全、SQLite 恢复、TTS 降级、HTTP 契约、对话 UI 和播放队列。

## 项目结构

- `server.js`：Express、WebSocket、任务串行和 API 契约。
- `src/recommendation/pipeline.js`：候选、音源校验、持久化和 TTS。
- `src/environment/open-meteo.js`：无需密钥的自动天气解析与产品天气词汇映射。
- `src/domain/`：意图、环境优先级和严格 Schema。
- `src/music/`：单音源接口、歌曲匹配与显式演示目录。
- `state.js`：会话、轮次、卡片、曲目和播放事件的 SQLite 仓库。
- `pwa/`：无构建步骤的响应式单页界面和 `HTMLAudioElement` 播放器。
- `user/taste.md` 与 `user/mood-rules.md`：只读演示配置。

## 来源与边界

本 Demo 以 [bingyanglu/Claudio-FM](https://github.com/bingyanglu/Claudio-FM) `v1.1.1` 的代码形态为技术起点，锁定提交为 `4939b1adc5ddc5ed1289a1e93cd0235b98634abe`，并保留了上游 Git 历史。

截至该锁定版本，上游仓库未提供明确 LICENSE。本改造仅用于本地内部原型验证，不代表已获得公开发布、部署或商业使用授权。在对外演示、分发、部署或商业化前，必须先取得作者许可，或替换来源代码。音乐播放能力同样只用于本地原型验证。
