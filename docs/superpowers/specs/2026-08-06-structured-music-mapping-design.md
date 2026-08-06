# this moment — 结构化音乐映射与候选约束设计

**日期：**2026-08-06

**状态：**用户已口头确认，待规格文档审阅

**目标：**修复新主题被误判为上一轮微调、风格与人声约束在候选阶段漂移、网易云实体匹配过宽等问题；建立“风格簇 + 艺人别名 + 结构化约束 + 候选审计”的歌曲映射机制。

## 1. 背景与问题

当前推荐链路为：

```text
用户输入与环境
→ 正则意图路由
→ DeepSeek 一次生成音乐方向、推荐语和候选歌曲
→ 网易云按歌名与歌手搜索
→ 名称匹配、去重和可播校验
→ 音乐卡片
```

该链路已经能够完成自然语言推荐和真实音源验证，但存在三个已由真实历史数据确认的问题。

### 1.1 新主题被误判为微调

当前 `REFINE` 正则包含“一点、一些”。只要会话存在历史卡片，下列新请求都会被错误分类为 `refine`：

- “我现在想听一点 underground rapper 的歌”；
- “早上想听一点嘻哈音乐”。

实际历史中，“underground rapper”请求因此继承了上一张中文旋律说唱卡片，最终生成 Lu1、小老虎、直火帮等偏传统中文独立说唱候选，没有进入用户期望的当代中文网络地下说唱方向。

### 1.2 明确约束只存在于自然语言中

历史连续请求：

```text
来点 R&B
→ 我不想听男生 R&B 歌手的
```

模型生成的标题和推荐语已经正确理解“女性 R&B”，但当前 Schema 没有 `genres`、`vocals`、`languages`、`artists` 或 `avoid` 字段。模型候选从“女性 R&B”漂移到普通女声流行后，网易云层无法识别曲风错误，因此《红色高跟鞋》等弱匹配歌曲进入卡片。

### 1.3 平台实体匹配无法解释且过于宽松

当前网易云搜索只取第一个结果，歌手名使用双向包含判断。真实历史中，“田馥甄”候选匹配到了“田馥甄的小迷妹”。系统也没有保存模型原始候选及淘汰原因，因此无法回答某位艺人是未被模型生成、搜索失败、版本错误、不可播放，还是被历史规则排除。

## 2. 设计原则

1. 用户本轮明确表达始终高于历史、风格默认和全局品味。
2. 新主题不继承无关的上一轮风格和约束。
3. 连续调整按字段继承，不再把整张卡片作为模糊自然语言上下文继承。
4. 场景与风格先映射到结构化字段，再调用模型生成候选。
5. 艺人锚点用于描述风格，不要求每张卡片必须包含锚点艺人。
6. 模型声明不是平台事实；可确认的硬约束必须在候选校验阶段执行。
7. 无法满足硬约束时少返回，不使用弱匹配歌曲补满。
8. 保存候选接受和拒绝代码，不保存模型思维链或隐藏推理。
9. 保持每轮一次正常 DeepSeek 调用；结构修复仍最多一次，不进行第二轮补歌。
10. 保持网易云作为唯一真实音源，不引入其他平台补齐。

## 3. 方案选择

### 3.1 未采用：只修改 `taste.md`

将 skiboyvv 和 africakid 写入自然语言偏好改动最小，但无法解决意图误判、字段继承、曲风硬约束、实体别名和候选诊断问题。模型仍可能临场漂移。

### 3.2 采用：风格簇 + 艺人别名 + 结构化约束

新增一个确定性音乐分类层：

```text
用户输入
→ 意图与显式约束解析
→ 风格别名和艺人别名解析
→ 按字段合并上一轮上下文
→ 构建统一模型输入
→ DeepSeek 生成候选
→ 结构化约束校验
→ 网易云多结果实体匹配和可播校验
→ 候选审计
→ 卡片
```

### 3.3 暂不采用：完整音频特征数据库

BPM、响度、动态范围、音色特征和歌曲 embedding 可以进一步提高匹配准确度，但需要独立的数据源和离线分析链路，不属于本地 Demo 本轮范围。

## 4. 领域模型

### 4.1 意图

继续使用四个意图，但收紧定义：

| 意图 | 定义 |
| --- | --- |
| `cold_start` | 无历史且只有宽泛请求 |
| `recommend` | 新主题，或可以脱离上一轮独立成立的明确请求 |
| `refine` | 明确依赖上一轮，并修改其中部分字段 |
| `refresh` | 完全继承上一轮有效方向和约束，只更换歌曲 |

“一点、一些”不再作为独立的 `refine` 证据。

强 `refine` 证据包括：

- “再安静一点”；
- “更有精神一点”；
- “保持这个方向”；
- “别这么伤感”；
- “还是刚才那种，但……”；
- 省略主题且必须依赖上一轮才能理解的调整语句。

强 `refresh` 证据包括：

- “换一批”；
- “这个方向再来一组”；
- “推荐点别的，但保持刚才的感觉”。

出现明确新曲风、艺人或可独立成立的音乐需求时，默认视为新主题，除非句子同时明确要求继承上一轮。

### 4.2 结构化约束

每轮生成 `constraints`：

```json
{
  "style_clusters": ["cn_internet_underground"],
  "genres": ["hip-hop/rap"],
  "languages": ["zh"],
  "vocals": [],
  "artists": [],
  "artist_anchors": ["skiboyvv", "africakid"],
  "avoid": [],
  "source": {
    "style_clusters": "user",
    "genres": "user",
    "languages": "default",
    "vocals": null,
    "artists": null,
    "artist_anchors": "taxonomy",
    "avoid": null
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `style_clusters` | 产品内部风格簇，不直接展示给用户 |
| `genres` | 用户明确或风格簇确认的曲风 |
| `languages` | 中文、英文等语言要求 |
| `vocals` | `female`、`male`、`mixed`、`instrumental` 等人声条件 |
| `artists` | 用户明确要求的艺人 |
| `artist_anchors` | 描述风格的参考艺人，不强制入选 |
| `avoid` | 男声、Live、Remix、特定艺人或其他排除项 |
| `source` | 每个字段的来源，不允许把默认值描述成用户要求 |

来源枚举为：

- `user`：用户本轮明确表达；
- `inherited`：从上一轮有效字段继承；
- `taxonomy`：由确定性风格簇提供；
- `default`：系统或全局品味默认；
- `null`：该字段未限定。

### 4.3 候选结构

DeepSeek 每个候选输出：

```json
{
  "title": "歌曲名",
  "artist": "歌手名",
  "style_clusters": ["cn_internet_underground"],
  "genres": ["hip-hop/rap"],
  "language": "zh",
  "vocal": "male",
  "version": "original"
}
```

这些字段表示模型声明，用于候选前置筛选和审计，不作为不可质疑的平台事实。能够由确定性别名表、用户明确艺人列表或网易云实体信息确认的条件仍需独立校验。

## 5. 风格分类层

新增独立模块负责：

1. 风格别名归一化；
2. 艺人别名归一化；
3. 风格簇默认语言、曲风和艺人锚点；
4. 显式艺人对默认风格簇的覆盖；
5. 为 Prompt 提供结构化、可测试的已确认输入。

### 5.1 中文网络地下说唱风格簇

内部 ID：

```text
cn_internet_underground
```

触发表达包括：

- `underground rapper`；
- `underground rap`；
- `中文地下说唱`；
- `中文网络说唱`；
- `UDG rapper`；
- `UDG 风格`。

当用户没有指定国家、语言或艺人时，该风格簇默认中文优先。

核心风格锚点：

- `龙飘飘skiboyvv`，规范搜索名优先使用 `skiboyvv`；
- `africakid`。

扩展参考集合：

- `R!R!Riot`；
- `Alyway`；
- `Yaka`；
- `nato`；
- `ATM Hanson`；
- `DARK9COMMUNITY`；
- `UDG Records`。

扩展参考集合用于帮助模型理解当代中文网络地下、pluggnb、trap 和相关新生代互联网说唱语境，不是固定歌单，也不是全部必须出现。

公开资料验证：

- [MusicBrainz 将龙飘飘skiboyvv标识为 Chinese rapper](https://musicbrainz.org/artist/a02181c2-6feb-42f8-a4d2-41d3a4bdab00/recordings?standalone=1)；
- [Apple Music 的 skiboyvv 相似艺人包含 africakid、nato、DARK9COMMUNITY、Alyway、Yaka、R!R!Riot](https://music.apple.com/my/artist/skiboyvv/1615067300)；
- [Apple Music 的 africakid 相似艺人包含 R!R!Riot、Mula Sakee、skiboyvv、Yaka、Alyway、UDG Records 等](https://music.apple.com/us/artist/africakid/1784655288)；
- [Spotify 将 africakid 关联到 CN underground、ASIAN UNDERGROUND 和中文 drain/hyperpop/trap/plugnb 歌单语境](https://open.spotify.com/artist/0T3txFkkvO5AI6skW9mHzY)。

### 5.2 艺人别名

第一批别名：

```text
龙飘飘
龙飘飘skiboyvv
skiboyvv
→ canonical_artist_id = skiboyvv
→ display_name = 龙飘飘skiboyvv
→ search_names = ["skiboyvv", "龙飘飘skiboyvv"]
```

直接搜索“龙飘飘”存在与经典华语女歌手同名冲突，因此不得把裸名称作为唯一搜索词。

```text
aficakid
africa kid
africakid
→ canonical_artist_id = africakid
→ display_name = africakid
→ search_names = ["africakid"]
```

别名匹配忽略大小写和常规空白，但不会对任意艺人进行模糊包含替换。

### 5.3 明确艺人覆盖中文默认

系统保持中文优先的全局品味，但用户本轮明确点名的艺人或地区高于该默认。

```text
用户：“来点 underground rapper”
→ 中文优先
→ cn_internet_underground
```

```text
用户：“来点 Yeat、fakemink 这种”
→ 明确艺人高于中文默认
→ 海外/欧美新地下参考方向
```

```text
用户：“中文为主，但要像 Yeat 这种感觉”
→ languages = ["zh"]，source = user
→ artist_anchors 包含 Yeat，source = user
→ 寻找具有相近方向的中文候选
```

“覆盖中文默认”只对当前字段和当前轮生效，不永久修改全局偏好。

## 6. 上下文合并

### 6.1 字段优先级

```text
用户本轮明确表达
> 上一轮同字段有效值
> 风格簇默认
> taste.md 全局软偏好
> 未限定
```

不同字段分别合并，禁止因为继承 `genres` 而无条件继承上一轮 `vocals`、`artists` 或 `avoid`。

### 6.2 新主题

新主题清除上一轮不相关的风格和约束。

```text
上一轮：女性 R&B
本轮：我想听 underground rapper

结果：
- 清除 R&B
- 清除女性人声
- 进入 cn_internet_underground
- 中文优先
```

### 6.3 微调

微调只改变用户点名字段。

```text
上一轮：R&B，男女人声混合
本轮：不要男歌手

结果：
- genres = ["r&b"]，source = inherited
- vocals = ["female"]，source = user
- avoid = ["male_vocal"]，source = user
```

### 6.4 换一批

`refresh` 完全继承有效方向和约束，但排除上一张卡片和近期歌曲。不得重新从默认映射推导风格。

### 6.5 独立成立的负向请求

“我不想听男生 R&B 歌手的”即使没有上一轮也能独立解析为：

```json
{
  "genres": ["r&b"],
  "vocals": ["female"],
  "avoid": ["male_vocal"]
}
```

不要求必须把它分类为 `refine` 才能理解其约束。

## 7. Prompt 与 Schema

### 7.1 Prompt 输入

Prompt 不再只注入上一张卡片的方向和歌曲，而是注入：

```json
{
  "intent": "recommend",
  "user_input": "我现在想听一点 underground rapper 的歌",
  "environment": {},
  "effective_direction": {},
  "effective_constraints": {},
  "taxonomy_context": {
    "style_cluster": "cn_internet_underground",
    "artist_anchors": ["龙飘飘skiboyvv", "africakid"],
    "related_references": []
  },
  "recent_tracks": [],
  "target_track_count": 8,
  "candidate_track_count": 32
}
```

`taste.md` 继续作为软偏好，但必须在 Prompt 中明确：

- 用户明确条件是硬约束；
- 风格簇比全局中文/英文比例更具体；
- 艺人锚点描述声音方向，不要求固定出现；
- 不得用传统独立说唱替代当代网络地下风格；
- 不得用普通女声流行替代女性 R&B。

### 7.2 模型输出

模型一次返回：

1. 音乐方向；
2. 标题和两句推荐语；
3. 带声明字段的有序候选歌曲。

意图、生效约束和字段来源由确定性领域层生成并持久化，是模型的只读输入。模型不得重新分类意图、删除硬约束或把默认来源改写成用户来源，严格输出 Schema 也不接收这些字段。

输出必须通过严格 Zod Schema。结构失败时允许一次仅修复 JSON 和字段的调用；修复提示要求保持本轮方向和候选意图，不执行补歌。

## 8. 候选校验

候选校验分为三层。

### 8.1 模型声明预检

对用户明确硬约束执行预检：

- 明确 R&B 时，候选 `genres` 必须包含 `r&b`；
- 明确女性歌手时，候选 `vocal` 必须是 `female`，或候选艺人在确定性艺人资料中被确认；
- 明确纯音乐时，候选 `vocal` 必须为 `instrumental`；
- 明确中文时，候选语言不得声明为非中文；
- 明确排除 Live/Remix 时，候选版本不得冲突。

模型声明缺失或冲突时拒绝候选，不用弱匹配结果补满。

### 8.2 网易云实体搜索

网易云 `/cloudsearch` 从 `limit=1` 改为获取前 5 项。实体匹配计算可解释分数：

- 标准化歌曲名完全相等：最高标题分；
- 删除括号版本信息后相等：次高标题分；
- 短标题不得只凭包含关系匹配；
- 规范艺人名完全相等或命中明确别名：最高艺人分；
- 合作艺人列表包含目标艺人：允许，但需按分隔后的独立艺人比较；
- 任意字符串包含不再足以证明艺人相同；
- Live、Remix、伴奏、翻唱和原版根据本轮版本约束加减分；
- 低于阈值的搜索结果全部拒绝。

同名冲突使用艺人别名提供的 `search_names` 逐个搜索，优先规范搜索名。例如 `skiboyvv` 优先于裸名称“龙飘飘”。

### 8.3 可播和历史校验

保持现有原则：

- 平台歌曲 ID 去重；
- 排除近期卡片中的歌曲；
- 获取实际播放地址；
- 只有可播放歌曲才获取完整详情并进入卡片；
- 最终保持模型候选的相对顺序；
- 达到目标数量后停止；
- 不足目标数量时返回实际数量。

## 9. 候选审计

新增候选审计记录，供本地诊断使用，不在正常 UI 展示。

```json
{
  "card_id": "uuid",
  "candidate_index": 0,
  "requested_title": "歌曲名",
  "requested_artist": "歌手名",
  "resolved_track_id": "12345",
  "resolved_title": "平台歌曲名",
  "resolved_artist": "平台艺人名",
  "result": "accepted",
  "reason": null
}
```

拒绝原因使用固定代码：

| 代码 | 含义 |
| --- | --- |
| `genre_mismatch` | 模型声明与明确曲风冲突 |
| `vocal_mismatch` | 人声条件冲突 |
| `language_mismatch` | 语言条件冲突 |
| `version_mismatch` | Live/Remix/伴奏等版本冲突 |
| `artist_excluded` | 命中用户排除艺人 |
| `search_miss` | 网易云前 5 项无可接受实体 |
| `artist_mismatch` | 歌曲名接近但艺人不符 |
| `duplicate` | 本卡片重复平台 ID |
| `recently_used` | 命中近期排除 ID |
| `unavailable` | 无可用播放地址 |
| `accepted` | 成功进入合格集合 |

审计不得保存：

- DeepSeek 隐藏思维链；
- API Key、Cookie 或鉴权头；
- 网易云原始完整响应；
- TTS 或其他无关上游数据。

## 10. 持久化

### 10.1 生效约束

每个 turn 保存 `constraints_json`。旧数据库迁移时默认 `{}`，不得根据旧卡片标题反向猜测约束。

卡片恢复后应包含：

- `intent`；
- `direction`；
- `constraints`；
- `tracks`。

### 10.2 候选审计表

新增 `candidate_audits` 表，使用 `card_id + candidate_index` 作为稳定关联。只有成功创建卡片的轮次持久化审计；整轮模型失败时不创建空卡片或孤立审计记录。

数据库迁移必须兼容现有 SQLite 数据，不删除历史卡片。

## 11. 错误与降级

1. 未识别风格词：保留用户原话交给模型，不继承无关上一轮，不自动创建未知风格锚点。
2. 锚点歌曲不可播放：继续相似艺人，不强制锚点入选。
3. 硬约束后不足 8 首：返回实际数量和通用不足提示。
4. 网易云搜索无可信实体：记录 `search_miss`，继续下一候选。
5. 艺人同名冲突无法解决：拒绝候选，不选择分数较低的同名艺人。
6. 候选审计写入失败：推荐事务失败并回滚卡片，避免卡片和审计状态不一致；公开错误保持通用，不暴露数据库细节。
7. 老卡片没有 `constraints`：恢复为空对象，后续新主题正常处理；只有明确微调老卡片时才继承其现有 `direction`，不猜测缺失约束。

## 12. 测试与验收

### 12.1 意图路由

- 有历史时，“我现在想听一点 underground rapper 的歌”必须为 `recommend`；
- 有历史时，“早上想听一点嘻哈音乐”必须为 `recommend`；
- “再安静一点”必须为 `refine`；
- “保持这个方向，但更有精神”必须为 `refine`；
- “换一批”必须为 `refresh`。

### 12.2 风格分类与别名

- `underground rapper` 在无地区提示时映射到 `cn_internet_underground`；
- `龙飘飘`、`龙飘飘skiboyvv`、`skiboyvv` 映射到同一 canonical artist；
- 搜索名优先使用 `skiboyvv`；
- `aficakid`、`Africa Kid`、`Africakid` 映射到 `africakid`；
- 点名 Yeat 或 fakemink 时，中文默认不得成为硬语言约束；
- “中文为主，但像 Yeat”同时保留中文语言约束和 Yeat 风格锚点。

### 12.3 上下文合并

- “来点 R&B → 不要男歌手”继承 R&B，增加女性人声和男声排除；
- “女性 R&B → underground rapper”清除 R&B 和女性人声约束；
- `refresh` 完全继承有效约束；
- 每个字段的 `source` 正确且独立。

### 12.4 Schema 与 Prompt

- Prompt 包含 `effective_constraints` 和 taxonomy context；
- Candidate Schema 拒绝无效枚举和额外字段；
- 模型输出试图重写意图、约束或字段来源时被严格 Schema 拒绝；
- 模型输出中普通流行候选声明不得通过明确 R&B 约束；
- 两次 Schema 失败后整轮失败，不保存卡片。

### 12.5 网易云实体匹配

- 第 1 项错误、第 2–5 项存在正确实体时能选中正确项；
- “田馥甄”不得匹配“田馥甄的小迷妹”；
- 合作歌曲的独立艺人列表允许目标艺人命中；
- `龙飘飘`搜索使用 `skiboyvv`规范名，避免经典女歌手同名结果；
- Live、Remix 和原版按约束正确评分或拒绝；
- 不可播放歌曲不得进入卡片。

### 12.6 候选审计

- 每个处理过的候选都有一个接受或拒绝代码；
- 审计能够区分 `search_miss`、`artist_mismatch`、`unavailable` 和历史重复；
- 审计中不出现凭据、Cookie、上游完整响应或模型隐藏推理；
- 卡片保存与候选审计在同一事务中完成。

### 12.7 完整回归案例

案例一：

```text
上一轮：中文旋律嘻哈
本轮：我现在想听一点 underground rapper 的歌
```

验收：本轮是新主题，映射到 `cn_internet_underground`，Prompt 包含 skiboyvv 和 africakid 风格锚点，不继承上一轮的“旋律说唱、平稳鼓点”。

案例二：

```text
来点 R&B
→ 我不想听男生 R&B 歌手的
```

验收：第二轮保留 R&B，女性人声成为硬约束；普通女声流行候选被拒绝，不用《红色高跟鞋》类弱匹配歌曲填满。

案例三：

```text
来点 Yeat、fakemink 这种
```

验收：明确艺人高于中文默认，不强行生成中文 70% 的候选。

案例四：

```text
中文为主，但想要像 Yeat 这种感觉
```

验收：中文是用户硬约束，Yeat 是风格锚点；模型生成中文候选，不直接把海外艺人作为主体填充。

## 13. 文件边界

| 文件 | 职责 |
| --- | --- |
| `src/domain/intent.js` | 收紧新主题、微调和换一批路由 |
| `src/domain/music-taxonomy.js` | 风格簇、风格别名、艺人别名和规范搜索名 |
| `src/domain/constraints.js` | 从本轮输入解析并按字段合并约束 |
| `src/domain/recommendation-schema.js` | 约束和候选声明 Schema |
| `context.js` | 构建结构化 Prompt 输入 |
| `llm.js` | 使用新 Schema，保持一次正常调用和一次结构修复 |
| `src/music/provider.js` | 候选预检、多结果实体评分和审计结果 |
| `music-netease.js` | 返回前 5 项紧凑搜索结果，保留缓存和限流 |
| `src/recommendation/pipeline.js` | 编排约束、候选校验、审计和卡片事务 |
| `state.js` | 约束字段、候选审计表和兼容迁移 |
| `user/taste.md` | 保持中文优先软偏好，说明其不得覆盖用户明确条件 |
| `test/` | 意图、分类、合并、Schema、实体匹配、审计和完整链路回归 |
| `docs/current-model-and-song-mapping.md` | 实施完成后更新为新机制说明 |

## 14. 非目标

本轮不做：

- Spotify、Apple Music、QQ 音乐或其他平台补歌；
- 向量数据库；
- 歌曲音频下载和声学特征分析；
- 自动改写长期用户画像；
- 用户可视化编辑完整风格分类树；
- 第二轮模型补歌；
- 在页面展示模型推理；
- 强制每张卡片包含 skiboyvv 或 africakid；
- 建立覆盖全部音乐类型的全球曲风百科。

## 15. 完成标准

- 新主题中的“一点、一些”不再触发错误继承；
- `underground rapper` 默认进入中文当代网络地下说唱风格簇；
- skiboyvv 和 africakid 作为风格锚点而非固定歌曲；
- 艺人别名和同名冲突得到确定性处理；
- 用户点名海外艺人时覆盖中文软默认；
- R&B、人声、语言、艺人和版本要求可结构化保存与继承；
- 明确硬约束在候选阶段执行，不用弱匹配歌曲补满；
- 网易云检查前 5 项并使用严格实体评分；
- 每个候选存在可解释的接受或拒绝代码；
- 老数据库和历史卡片可以无损升级；
- 所有新增测试和现有测试通过；
- 不保存或展示模型思维链，不暴露任何凭据。
