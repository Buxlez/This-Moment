# Leapmotor Demo Taste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the demo taste profile so recommendations default to lively, singable, car-friendly music while remaining diverse and subordinate to the user's current request.

**Architecture:** Keep the recommendation pipeline unchanged. Replace only the Markdown configuration consumed by `context.js`, then verify the file contract and the assembled model prompt.

**Tech Stack:** Markdown, Node.js built-in assertions, Git

---

### Task 1: Rewrite the demo taste profile

**Files:**
- Modify: `user/taste.md`
- Reference: `docs/superpowers/specs/2026-08-13-leapmotor-demo-taste-design.md`

- [ ] **Step 1: Record the existing user-owned diff**

Run `git diff -- user/taste.md`.

Expected: the current uncommitted quiet/atmospheric profile is visible. Do not restore the Git version and do not modify `user/mood-rules.md`.

- [ ] **Step 2: Replace `user/taste.md` with the approved profile**

Use this complete content:

```markdown
# 零跑车主演示品味

这是一份用于标准 PRD 演示的默认选曲画像，不代表所有零跑车主。它只提供软偏好；用户本轮明确提出的语言、风格、情绪、年代、歌手或场景要求始终拥有最高优先级。

## 核心听感

- 偏好热闹、好唱、容易带动车内气氛的歌曲。
- 旋律直接、节奏鲜明、有容易记住和跟唱的副歌。
- 默认约六成中高能量、四成中等或舒缓能量，保持起伏，不持续轰炸。
- 熟悉歌曲与新歌并存，不把推荐做成纯热榜或纯小众歌单。

## 多元方向

- 华语流行、流行摇滚、经典金曲、城市民谣与华语 R&B。
- 轻电子、旋律说唱、欧美及日韩热门流行。
- 适合驾驶的影视、综艺、动漫与游戏 OST。
- 不固定语言比例、年龄、性别或家庭结构；根据用户本轮要求灵活调整。

## 场景倾向

- 日常通勤：节奏清楚、提神但不过度刺激。
- 朋友同行与周末出游：增强强副歌、熟悉度和跟唱感。
- 长途驾驶：热闹歌曲与舒缓歌曲交替，避免听觉疲劳。
- 夜间、拥堵或用户明确想放松：主动降低能量和密度。

## 避免

- 把“闹一点”简单理解为高响度、重低音或全程强刺激。
- 连续堆叠高密度歌曲、短视频热歌或刻板“土嗨”曲目。
- 同一卡片里歌手、语言、年代或曲风过度集中。
- 根据天气机械推断情绪，或让默认画像覆盖用户当次表达。
```

- [ ] **Step 3: Verify the Markdown contract**

Run:

```bash
node -e "const fs=require('node:fs');const assert=require('node:assert/strict');const s=fs.readFileSync('user/taste.md','utf8');for(const x of ['热闹、好唱','约六成中高能量','华语流行','轻电子','长途驾驶','用户本轮明确'])assert.ok(s.includes(x),x);assert.ok(!s.includes('中文约占七成'));console.log('taste contract: PASS')"
```

Expected: `taste contract: PASS`.

### Task 2: Verify prompt integration and repository scope

**Files:**
- Verify: `context.js`
- Verify: `user/taste.md`

- [ ] **Step 1: Verify the assembled recommendation prompt**

Run this Node script with `buildRecommendationContext`, using the current input `今天只想听安静的钢琴曲`. Assert that the prompt contains `热闹、好唱`, `用户本轮明确提出`, `# 用户本轮原话（最高优先级）`, and the exact current input.

Expected: print `prompt integration: PASS`. This confirms the lively profile is available to the model while the current request remains explicitly highest priority.

- [ ] **Step 2: Check formatting and scope**

Run `git diff --check -- user/taste.md` followed by `git status --short`.

Expected: no formatting errors; `user/taste.md` is modified, while existing unrelated working-tree changes remain untouched.

- [ ] **Step 3: Commit only the taste rewrite**

```bash
git add user/taste.md
git commit -m "config: diversify leapmotor demo taste"
```

Expected: one commit containing only `user/taste.md`.
