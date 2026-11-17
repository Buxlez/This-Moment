# Structured Music Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prompt-only song mapping with deterministic intent routing, a Chinese internet-underground taxonomy, field-level constraints, stricter NetEase entity matching, and auditable candidate rejection reasons.

**Architecture:** A new taxonomy module normalizes style and artist aliases; a constraints module extracts current-turn requirements and merges them field-by-field with prior state. Deterministic intent and constraints become authoritative LLM inputs, while the model returns direction, copy, and tagged candidates. Candidate validation checks hard constraints, searches the top five NetEase results, scores exact entities, verifies playback, and persists fixed audit codes with the card.

**Tech Stack:** Node.js 20+, CommonJS, Zod, better-sqlite3, OpenAI-compatible DeepSeek API, NeteaseCloudMusicApi, Node test runner.

---

## File map

| File | Change | Responsibility |
| --- | --- | --- |
| `src/domain/intent.js` | Modify | Distinguish new topics from true refinements |
| `src/domain/music-taxonomy.js` | Create | Style clusters, artist aliases, canonical search names |
| `src/domain/constraints.js` | Create | Explicit constraint extraction and field-level inheritance |
| `src/domain/recommendation-schema.js` | Modify | Strict candidate declarations and model plan schema |
| `context.js` | Modify | Structured authoritative prompt input |
| `llm.js` | Modify | New model output contract for demo and live modes |
| `music-netease.js` | Modify | Cached top-five compact search results |
| `src/music/provider.js` | Modify | Constraint preflight, entity scoring, audits, ordered validation |
| `state.js` | Modify | Compatible constraints migration and candidate audit persistence |
| `src/recommendation/pipeline.js` | Modify | Integrate routing, constraints, validation, audit transaction |
| `user/taste.md` | Modify carefully | Preserve existing uncommitted edits; clarify soft default boundary |
| `README.md` | Modify | Document the new mapping and diagnostics |
| `docs/current-model-and-song-mapping.md` | Modify | Replace current-mechanism limitations with implemented behavior |
| `test/domain.test.js` | Modify | Intent and schema regressions |
| `test/taxonomy.test.js` | Create | Style and artist normalization |
| `test/constraints.test.js` | Create | Extraction, source tracking, inheritance |
| `test/context.test.js` | Create | Prompt authority boundary |
| `test/music.test.js` | Modify | Multi-result search, scoring, filtering, audits |
| `test/state.test.js` | Modify | Migration, constraints, audit transaction |
| `test/pipeline.test.js` | Modify | End-to-end mapping regressions |

## Working-tree safety

The workspace already contains user-owned uncommitted changes in `user/taste.md`, `user/mood-rules.md`, the earlier hybrid design, and unrelated documents. Each task must stage only the files it names. Before modifying `user/taste.md`, inspect its current diff and append the targeted rule without restoring or replacing the user's content.

---

### Task 1: Correct intent routing for explicit new topics

**Files:**
- Modify: `test/domain.test.js`
- Modify: `src/domain/intent.js`

- [ ] **Step 1: Write failing intent regression tests**

Replace the existing intent test with explicit option-object calls and add the two production regressions:

```js
test('routes explicit new topics separately from true refinements', () => {
  const history = { hasPreviousCard: true };

  assert.equal(routeIntent('我现在想听一点 underground rapper 的歌', {
    ...history, hasExplicitTopic: true,
  }), 'recommend');
  assert.equal(routeIntent('早上想听一点嘻哈音乐', {
    ...history, hasExplicitTopic: true,
  }), 'recommend');
  assert.equal(routeIntent('再安静一点', {
    ...history, hasExplicitTopic: false,
  }), 'refine');
  assert.equal(routeIntent('保持这个方向，但更有精神', {
    ...history, hasExplicitTopic: false,
  }), 'refine');
  assert.equal(routeIntent('换一批', history), 'refresh');
  assert.equal(routeIntent('来点音乐', {
    hasPreviousCard: false, hasExplicitTopic: false,
  }), 'cold_start');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/domain.test.js
```

Expected: FAIL because `routeIntent` still accepts a boolean and treats “一点” as refinement evidence.

- [ ] **Step 3: Implement explicit-topic-aware routing**

Replace `src/domain/intent.js` with:

```js
const BROAD_REQUEST = /^\s*(来|放|听|推荐|给我)?\s*(点|一点|些)?\s*(音乐|歌|歌曲)\s*(吧|听听)?[!！.。、,，?？\s]*$/;
const REFRESH = /(换一批|再换|换些|换点|重新来|另一批|这个方向再来|保持.{0,8}换)/;
const REFINE = /(再.{0,12}(一点|一些|点|些)|更.{0,12}(一点|一些|点|些)|保持(这个|刚才|原来|上一轮)|还是(刚才|这个|原来)|别这么|不要这么|稍微)/;

function routeIntent(userInput, options = {}) {
  const text = String(userInput || '').trim();
  const hasPreviousCard = typeof options === 'boolean'
    ? options
    : Boolean(options.hasPreviousCard);
  const hasExplicitTopic = typeof options === 'object'
    && Boolean(options.hasExplicitTopic);

  if (hasPreviousCard && REFRESH.test(text)) return 'refresh';
  if (hasPreviousCard && !hasExplicitTopic && REFINE.test(text)) return 'refine';
  if (!hasPreviousCard && BROAD_REQUEST.test(text)) return 'cold_start';
  return 'recommend';
}

module.exports = { routeIntent };
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test test/domain.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit only the routing change**

```bash
git add src/domain/intent.js test/domain.test.js
git commit -m "fix: separate new music topics from refinements"
```

---

### Task 2: Add the deterministic music taxonomy

**Files:**
- Create: `test/taxonomy.test.js`
- Create: `src/domain/music-taxonomy.js`

- [ ] **Step 1: Write failing taxonomy tests**

Create `test/taxonomy.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeArtist,
  searchNamesForArtist,
  resolveMusicTaxonomy,
} = require('../src/domain/music-taxonomy');

test('normalizes the Chinese underground anchor aliases', () => {
  assert.equal(canonicalizeArtist('龙飘飘'), 'skiboyvv');
  assert.equal(canonicalizeArtist('龙飘飘skiboyvv'), 'skiboyvv');
  assert.equal(canonicalizeArtist('SKIBOYVV'), 'skiboyvv');
  assert.deepEqual(searchNamesForArtist('龙飘飘'), [
    'skiboyvv', '龙飘飘skiboyvv',
  ]);
  assert.equal(canonicalizeArtist('aficakid'), 'africakid');
  assert.equal(canonicalizeArtist('Africa Kid'), 'africakid');
});

test('maps ambiguous underground requests to the Chinese internet cluster', () => {
  const result = resolveMusicTaxonomy('我现在想听一点 underground rapper 的歌');
  assert.deepEqual(result.styleClusters, ['cn_internet_underground']);
  assert.deepEqual(result.genres, ['hip-hop/rap']);
  assert.deepEqual(result.languages, ['zh']);
  assert.deepEqual(result.artistAnchors, ['skiboyvv', 'africakid']);
  assert.equal(result.hasExplicitTopic, true);
});

test('lets named overseas references override the Chinese soft default', () => {
  const overseas = resolveMusicTaxonomy('来点 Yeat、fakemink 这种');
  assert.deepEqual(overseas.styleClusters, ['global_new_wave_underground']);
  assert.deepEqual(overseas.languages, []);
  assert.deepEqual(overseas.artistAnchors, ['yeat', 'fakemink']);

  const chinese = resolveMusicTaxonomy('中文为主，但想要像 Yeat 这种感觉');
  assert.deepEqual(chinese.styleClusters, ['cn_internet_underground']);
  assert.deepEqual(chinese.languages, ['zh']);
  assert.deepEqual(chinese.artistAnchors, ['yeat']);
});

test('maps named Chinese anchors into the Chinese internet cluster', () => {
  const result = resolveMusicTaxonomy('我想听 aficakid 的歌');
  assert.deepEqual(result.styleClusters, ['cn_internet_underground']);
  assert.deepEqual(result.mentionedArtists, ['africakid']);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test/taxonomy.test.js
```

Expected: FAIL with `Cannot find module '../src/domain/music-taxonomy'`.

- [ ] **Step 3: Implement the taxonomy module**

Create `src/domain/music-taxonomy.js`:

```js
const ARTISTS = [
  {
    id: 'skiboyvv',
    displayName: '龙飘飘skiboyvv',
    aliases: ['龙飘飘', '龙飘飘skiboyvv', 'skiboyvv'],
    searchNames: ['skiboyvv', '龙飘飘skiboyvv'],
  },
  {
    id: 'africakid',
    displayName: 'africakid',
    aliases: ['aficakid', 'africa kid', 'africakid'],
    searchNames: ['africakid'],
  },
  { id: 'yeat', displayName: 'Yeat', aliases: ['yeat'], searchNames: ['Yeat'] },
  { id: 'fakemink', displayName: 'fakemink', aliases: ['fake mink', 'fakemink'], searchNames: ['fakemink'] },
];

const STYLE_CLUSTERS = {
  cn_internet_underground: {
    id: 'cn_internet_underground',
    genres: ['hip-hop/rap'],
    languages: ['zh'],
    artistAnchors: ['skiboyvv', 'africakid'],
    relatedReferences: [
      'R!R!Riot', 'Alyway', 'Yaka', 'nato', 'ATM Hanson',
      'DARK9COMMUNITY', 'UDG Records',
    ],
  },
  global_new_wave_underground: {
    id: 'global_new_wave_underground',
    genres: ['hip-hop/rap'],
    languages: [],
    artistAnchors: ['yeat', 'fakemink'],
    relatedReferences: [],
  },
};

function normalizeLookup(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function findArtist(value) {
  const key = normalizeLookup(value);
  return ARTISTS.find(artist => artist.aliases.some(alias => normalizeLookup(alias) === key)) || null;
}

function canonicalizeArtist(value) {
  return findArtist(value)?.id || String(value || '').trim();
}

function searchNamesForArtist(value) {
  const artist = findArtist(value);
  return artist ? [...artist.searchNames] : [String(value || '').trim()].filter(Boolean);
}

function mentionedArtists(text) {
  const normalized = normalizeLookup(text);
  return ARTISTS.filter(artist => artist.aliases.some(alias => normalized.includes(normalizeLookup(alias))));
}

function resolveMusicTaxonomy(userInput) {
  const text = String(userInput || '');
  const mentioned = mentionedArtists(text);
  const namedOverseas = mentioned.filter(artist => ['yeat', 'fakemink'].includes(artist.id));
  const namedChinese = mentioned.filter(artist => ['skiboyvv', 'africakid'].includes(artist.id));
  const explicitChinese = /(中文|华语|国语|中国)/i.test(text);
  const underground = /(underground|地下说唱|网络说唱|udg)/i.test(text);

  let cluster = null;
  if (namedOverseas.length && !explicitChinese) cluster = STYLE_CLUSTERS.global_new_wave_underground;
  else if (namedChinese.length) cluster = STYLE_CLUSTERS.cn_internet_underground;
  else if (underground || namedOverseas.length) cluster = STYLE_CLUSTERS.cn_internet_underground;

  const artistAnchors = namedOverseas.length
    ? namedOverseas.map(artist => artist.id)
    : cluster?.artistAnchors || [];

  return {
    styleClusters: cluster ? [cluster.id] : [],
    genres: cluster?.genres || [],
    languages: explicitChinese ? ['zh'] : cluster?.languages || [],
    artistAnchors,
    relatedReferences: cluster?.relatedReferences || [],
    mentionedArtists: mentioned.map(artist => artist.id),
    hasExplicitTopic: Boolean(cluster || mentioned.length),
  };
}

module.exports = {
  ARTISTS,
  STYLE_CLUSTERS,
  canonicalizeArtist,
  searchNamesForArtist,
  resolveMusicTaxonomy,
};
```

- [ ] **Step 4: Run taxonomy tests and verify GREEN**

Run:

```bash
node --test test/taxonomy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the taxonomy**

```bash
git add src/domain/music-taxonomy.js test/taxonomy.test.js
git commit -m "feat: add structured music taxonomy"
```

---

### Task 3: Extract and merge field-level constraints

**Files:**
- Create: `test/constraints.test.js`
- Create: `src/domain/constraints.js`

- [ ] **Step 1: Write failing extraction and inheritance tests**

Create `test/constraints.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeExplicitConstraints,
  mergeConstraints,
} = require('../src/domain/constraints');

test('extracts R&B and female-vocal hard constraints', () => {
  const result = analyzeExplicitConstraints('我不想听男生 rnb 歌手的');
  assert.deepEqual(result.constraints.genres, ['r&b']);
  assert.deepEqual(result.constraints.vocals, ['female']);
  assert.deepEqual(result.constraints.avoid, ['male_vocal']);
  assert.equal(result.constraints.source.genres, 'user');
  assert.equal(result.constraints.source.vocals, 'user');
  assert.equal(result.hasExplicitTopic, true);
});

test('inherits only missing fields for a true refinement', () => {
  const previous = {
    styleClusters: [], genres: ['r&b'], languages: [], vocals: ['mixed'],
    artists: [], artistAnchors: [], avoid: [],
    source: { genres: 'user', vocals: 'default' },
  };
  const explicit = analyzeExplicitConstraints('不要男歌手').constraints;
  const merged = mergeConstraints({ intent: 'refine', previous, explicit });

  assert.deepEqual(merged.genres, ['r&b']);
  assert.deepEqual(merged.vocals, ['female']);
  assert.deepEqual(merged.avoid, ['male_vocal']);
  assert.equal(merged.source.genres, 'inherited');
  assert.equal(merged.source.vocals, 'user');
});

test('clears unrelated prior constraints for a new topic', () => {
  const previous = {
    styleClusters: [], genres: ['r&b'], languages: [], vocals: ['female'],
    artists: [], artistAnchors: [], avoid: ['male_vocal'], source: {},
  };
  const explicit = analyzeExplicitConstraints('我想听一点 underground rapper 的歌').constraints;
  const merged = mergeConstraints({ intent: 'recommend', previous, explicit });

  assert.deepEqual(merged.styleClusters, ['cn_internet_underground']);
  assert.deepEqual(merged.genres, ['hip-hop/rap']);
  assert.deepEqual(merged.vocals, []);
  assert.equal(merged.avoid.includes('male_vocal'), false);
});

test('keeps user Chinese language with a named overseas style anchor', () => {
  const explicit = analyzeExplicitConstraints('中文为主，但想要像 Yeat 这种感觉').constraints;
  assert.deepEqual(explicit.languages, ['zh']);
  assert.deepEqual(explicit.artistAnchors, ['yeat']);
  assert.equal(explicit.source.languages, 'user');
  assert.equal(explicit.source.artistAnchors, 'user');
});

test('distinguishes a requested artist from a style reference', () => {
  const requested = analyzeExplicitConstraints('我想听 aficakid 的歌').constraints;
  assert.deepEqual(requested.artists, ['africakid']);
  assert.equal(requested.source.artists, 'user');

  const reference = analyzeExplicitConstraints('想听像 africakid 这种感觉').constraints;
  assert.deepEqual(reference.artists, []);
  assert.deepEqual(reference.artistAnchors, ['africakid']);
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
node --test test/constraints.test.js
```

Expected: FAIL with `Cannot find module '../src/domain/constraints'`.

- [ ] **Step 3: Implement extraction and field-level merging**

Create `src/domain/constraints.js`:

```js
const { resolveMusicTaxonomy } = require('./music-taxonomy');

const FIELDS = [
  'styleClusters', 'genres', 'languages', 'vocals',
  'artists', 'artistAnchors', 'avoid',
];

function emptyConstraints() {
  return {
    styleClusters: [], genres: [], languages: [], vocals: [],
    artists: [], artistAnchors: [], avoid: [], source: {},
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function analyzeExplicitConstraints(userInput) {
  const text = String(userInput || '');
  const lower = text.toLowerCase();
  const taxonomy = resolveMusicTaxonomy(text);
  const constraints = emptyConstraints();
  const isStyleReference = /(像|类似|这种|风格|感觉)/i.test(text);
  const excludesNamedArtist = /(不要|避开|不想听)/i.test(text);

  if (taxonomy.styleClusters.length) {
    constraints.styleClusters = taxonomy.styleClusters;
    constraints.source.styleClusters = 'user';
  }
  if (taxonomy.genres.length) {
    constraints.genres = taxonomy.genres;
    constraints.source.genres = 'user';
  }
  if (/r\s*&\s*b|rnb|节奏布鲁斯/i.test(text)) {
    constraints.genres = ['r&b'];
    constraints.source.genres = 'user';
  }
  if (/(嘻哈|说唱|hip[ -]?hop|rapper|rap\b)/i.test(text) && !constraints.genres.length) {
    constraints.genres = ['hip-hop/rap'];
    constraints.source.genres = 'user';
  }
  if (/(中文|华语|国语|中国)/i.test(text)) {
    constraints.languages = ['zh'];
    constraints.source.languages = 'user';
  } else if (/(英文歌|英语歌|欧美歌)/i.test(text)) {
    constraints.languages = ['en'];
    constraints.source.languages = 'user';
  } else if (taxonomy.languages.length) {
    constraints.languages = taxonomy.languages;
    constraints.source.languages = 'default';
  }
  if (/(不想听|不要|避开).{0,4}(男生|男歌手|男声)|女歌手|女声/i.test(text)) {
    constraints.vocals = ['female'];
    constraints.avoid = unique([...constraints.avoid, 'male_vocal']);
    constraints.source.vocals = 'user';
    constraints.source.avoid = 'user';
  } else if (/(不想听|不要|避开).{0,4}(女生|女歌手|女声)|男歌手|男声/i.test(text)) {
    constraints.vocals = ['male'];
    constraints.avoid = unique([...constraints.avoid, 'female_vocal']);
    constraints.source.vocals = 'user';
    constraints.source.avoid = 'user';
  }
  if (/(纯音乐|无人声|器乐)/i.test(text)) {
    constraints.vocals = ['instrumental'];
    constraints.source.vocals = 'user';
  }
  if (/(不要|别来|避开).{0,4}(live|现场版)/i.test(lower)) {
    constraints.avoid = unique([...constraints.avoid, 'live']);
    constraints.source.avoid = 'user';
  }

  constraints.artistAnchors = taxonomy.artistAnchors;
  if (taxonomy.artistAnchors.length) {
    constraints.source.artistAnchors = taxonomy.mentionedArtists.length
      ? 'user'
      : 'taxonomy';
  }
  if (taxonomy.mentionedArtists.length && !isStyleReference && !excludesNamedArtist) {
    constraints.artists = taxonomy.mentionedArtists;
    constraints.source.artists = 'user';
  }
  if (taxonomy.mentionedArtists.length && excludesNamedArtist) {
    constraints.avoid = unique([
      ...constraints.avoid,
      ...taxonomy.mentionedArtists.map(artist => `artist:${artist}`),
    ]);
    constraints.source.avoid = 'user';
  }

  return {
    constraints,
    taxonomy,
    hasExplicitTopic: taxonomy.hasExplicitTopic || constraints.genres.length > 0,
  };
}

function mergeConstraints({ intent, previous = {}, explicit }) {
  const result = emptyConstraints();
  const inherits = intent === 'refine' || intent === 'refresh';

  for (const field of FIELDS) {
    const current = explicit?.[field] || [];
    const prior = previous?.[field] || [];
    result[field] = current.length ? unique(current) : inherits ? unique(prior) : [];
    if (current.length) result.source[field] = explicit.source?.[field] || 'user';
    else if (inherits && prior.length) result.source[field] = 'inherited';
  }

  return result;
}

module.exports = {
  FIELDS,
  emptyConstraints,
  analyzeExplicitConstraints,
  mergeConstraints,
};
```

- [ ] **Step 4: Run constraint tests and verify GREEN**

Run:

```bash
node --test test/constraints.test.js test/taxonomy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the constraint layer**

```bash
git add src/domain/constraints.js test/constraints.test.js
git commit -m "feat: add field-level recommendation constraints"
```

---

### Task 4: Make intent and constraints authoritative LLM inputs

**Files:**
- Modify: `test/domain.test.js`
- Create: `test/context.test.js`
- Modify: `src/domain/recommendation-schema.js`
- Modify: `context.js`
- Modify: `llm.js`

- [ ] **Step 1: Write failing Schema and prompt tests**

Update the valid plan in `test/domain.test.js` so the model no longer returns `intent` and each candidate declares its properties:

```js
const validPlan = {
  direction: {
    atmosphere: ['明亮', '清晰'],
    energy: '中高但不过强',
    rhythm: ['活跃', '稳定'],
  },
  title: '清醒一点，慢慢出发',
  description: '上海的早晨正在醒来，困意里需要一点明亮的推动。这些歌保持活跃稳定的节奏，但不会过分吵闹。',
  candidates: [{
    title: 'Yellow', artist: 'Coldplay',
    styleClusters: ['global_new_wave_underground'],
    genres: ['hip-hop/rap'], language: 'en', vocal: 'male', version: 'original',
  }],
};

assert.equal(RecommendationPlanSchema.safeParse(validPlan).success, true);
assert.equal(RecommendationPlanSchema.safeParse({
  ...validPlan, intent: 'recommend',
}).success, false);
```

Create `test/context.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecommendationContext } = require('../context');

test('serializes deterministic intent and constraints as read-only model input', () => {
  const prompt = buildRecommendationContext({
    environment: { city: '上海', weather: '晴朗' },
    userInput: '我现在想听一点 underground rapper 的歌',
    intent: 'recommend',
    effectiveConstraints: {
      styleClusters: ['cn_internet_underground'],
      genres: ['hip-hop/rap'], languages: ['zh'],
      artistAnchors: ['skiboyvv', 'africakid'], source: {},
    },
    taxonomyContext: {
      styleClusters: ['cn_internet_underground'],
      artistAnchors: ['skiboyvv', 'africakid'], relatedReferences: ['R!R!Riot'],
    },
    previousEffectiveContext: null,
    candidateCount: 32,
    excludeTracks: [],
  });

  assert.match(prompt, /cn_internet_underground/);
  assert.match(prompt, /skiboyvv/);
  assert.match(prompt, /africakid/);
  assert.match(prompt, /意图和约束是只读输入/);
  assert.doesNotMatch(prompt, /"intent":"recommend\|cold_start/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/domain.test.js test/context.test.js
```

Expected: FAIL because the old Schema requires `intent`, candidates lack declarations, and the context builder uses the old input shape.

- [ ] **Step 3: Implement strict candidate declarations**

Replace `src/domain/recommendation-schema.js` with:

```js
const { z } = require('zod');

const DirectionSchema = z.object({
  atmosphere: z.array(z.string().trim().min(1)).min(1).max(5),
  energy: z.string().trim().min(1).max(30),
  rhythm: z.array(z.string().trim().min(1)).min(1).max(5),
}).strict();

const CandidateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  artist: z.string().trim().min(1).max(120),
  styleClusters: z.array(z.string().trim().min(1).max(80)).max(4),
  genres: z.array(z.string().trim().min(1).max(60)).max(6),
  language: z.enum(['zh', 'en', 'mixed', 'instrumental', 'unknown']),
  vocal: z.enum(['female', 'male', 'mixed', 'instrumental', 'unknown']),
  version: z.enum(['original', 'live', 'remix', 'cover', 'instrumental', 'unknown']),
}).strict();

const RecommendationPlanSchema = z.object({
  direction: DirectionSchema,
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(2).max(220),
  candidates: z.array(CandidateSchema).min(1).max(70),
}).strict();

module.exports = { DirectionSchema, CandidateSchema, RecommendationPlanSchema };
```

- [ ] **Step 4: Implement structured context and update LLM adapters**

Change `buildRecommendationContext` to serialize a single confirmed-input object and a model-only output contract:

```js
function buildRecommendationContext({
  environment, userInput, intent, effectiveConstraints,
  taxonomyContext, previousEffectiveContext, candidateCount,
  excludeTracks = [],
}) {
  const confirmed = {
    intent,
    userInput,
    environment,
    effectiveConstraints,
    taxonomyContext,
    previousEffectiveContext,
    excludedTrackIds: excludeTracks,
    candidateCount,
  };
  return [
    '# 固定边界',
    '你是 this moment 的音乐方向编辑。已确认的意图和约束是只读输入，不得重写、删除或改变来源。',
    '艺人锚点用于说明风格，不要求每张卡片必须包含锚点艺人。不得用普通女声流行替代女性 R&B，也不得用传统独立说唱替代 cn_internet_underground。',
    '# 演示品味（只作为软偏好）', readRequired('taste.md'),
    '# 情绪规则', readRequired('mood-rules.md'),
    '# 已确认输入', JSON.stringify(confirmed),
    '# 严格 JSON 输出',
    JSON.stringify({
      direction: { atmosphere: [''], energy: '', rhythm: [''] },
      title: '',
      description: '两句话，45-70个中文字符',
      candidates: [{
        title: '', artist: '', styleClusters: [], genres: [],
        language: 'zh|en|mixed|instrumental|unknown',
        vocal: 'female|male|mixed|instrumental|unknown',
        version: 'original|live|remix|cover|instrumental|unknown',
      }],
    }),
  ].join('\n\n');
}
```

In `llm.js`, remove `intent` from both parsed model plans. Change the demo adapter signature to destructure `effectiveConstraints = {}` and add deterministic declarations from those constraints:

```js
async generatePlan({
  userInput, environment, previousEffectiveContext, intent,
  effectiveConstraints = {}, candidateCount = 40, excludeTracks = [],
}) {
  const previousCard = previousEffectiveContext
    ? { direction: previousEffectiveContext.direction }
    : null;
  const direction = demoDirection(userInput, environment, previousCard, intent);
  const copy = demoCopy({ environment, userInput, intent, direction });
  const excluded = new Set(excludeTracks.map(String));
const candidates = DEMO_CATALOG
  .filter(track => !excluded.has(track.id))
  .slice(0, candidateCount)
  .map(track => ({
    title: track.title,
    artist: track.artist,
    styleClusters: effectiveConstraints.styleClusters || [],
    genres: effectiveConstraints.genres || [],
    language: effectiveConstraints.languages?.[0] || 'unknown',
    vocal: effectiveConstraints.vocals?.[0] || 'unknown',
    version: 'original',
  }));
return RecommendationPlanSchema.parse({ direction, ...copy, candidates });
}
```

Update the live system message to:

```js
{ role: 'system', content: '你是 this moment 的音乐方向编辑。只输出严格 JSON；不要输出或改写意图、约束、来源、Markdown 或思维链。' }
```

- [ ] **Step 5: Run focused and existing LLM tests**

Run:

```bash
node --test test/domain.test.js test/context.test.js test/config.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the model contract**

```bash
git add src/domain/recommendation-schema.js context.js llm.js test/domain.test.js test/context.test.js
git commit -m "feat: make recommendation constraints authoritative"
```

---

### Task 5: Return the top five NetEase search entities

**Files:**
- Modify: `test/music.test.js`
- Modify: `music-netease.js`

- [ ] **Step 1: Write a failing multi-result search test**

Add to `test/music.test.js`:

```js
test('netease returns up to five compact search candidates', async () => {
  const requestJson = async (path, params) => {
    assert.equal(path, '/cloudsearch');
    assert.equal(params.limit, 5);
    return {
      result: {
        songs: [
          { id: 1, name: '同名错误', artists: [{ name: '其他人' }] },
          { id: 2, name: '目标歌曲', artists: [{ name: '目标歌手' }] },
        ],
      },
    };
  };

  const songs = await netease.searchSongs('目标歌曲 目标歌手', {
    requestJson, cache: false,
  });
  assert.deepEqual(songs.map(song => song.id), [1, 2]);
  assert.deepEqual(songs[1].artists, ['目标歌手']);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/music.test.js
```

Expected: FAIL because `searchSongs` is not exported.

- [ ] **Step 3: Implement cached compact multi-result search**

Add `artists` to `normalizeSong` and introduce `searchSongs` while keeping `searchSong` as a compatibility wrapper:

```js
function normalizeSong(raw) {
  if (!raw) return null;
  const artistRows = raw.artists || raw.ar || [];
  const artists = artistRows.map(artist => artist.name).filter(Boolean);
  return {
    id: raw.id,
    title: raw.name,
    artist: artists.join(', '),
    artists,
    album: raw.album?.name || raw.al?.name || '',
    coverUrl: raw.album?.picUrl || raw.al?.picUrl || null,
    durationMs: raw.duration || raw.dt || null,
    provider: 'netease',
  };
}

async function searchSongs(query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 5), 10));
  const key = `${String(query || '').trim().toLowerCase()}::${limit}`;
  try {
    return await getCachedValue(searchCache, searchInFlight, key, SEARCH_TTL_MS, options, async () => {
      const data = await runNeteaseRequest('/cloudsearch', {
        keywords: query, type: 1, limit,
      }, options);
      return (data?.result?.songs || []).map(normalizeSong).filter(Boolean);
    });
  } catch (error) {
    (options.logger || console).warn('[netease] search failed:', redactSensitiveText(error.message));
    return [];
  }
}

async function searchSong(query, options = {}) {
  const compactSong = (await searchSongs(query, { ...options, limit: 1 }))[0] || null;
  if (!compactSong || options.enrich === false) return compactSong;
  return (await getSongDetail(compactSong.id, options)) || compactSong;
}
```

Export `searchSongs` alongside `searchSong`.

- [ ] **Step 4: Run music tests and verify GREEN**

Run:

```bash
node --test test/music.test.js
```

Expected: PASS, including existing cache, retry, and scheduler tests.

- [ ] **Step 5: Commit multi-result search**

```bash
git add music-netease.js test/music.test.js
git commit -m "feat: search multiple netease song entities"
```

---

### Task 6: Add constraint preflight, strict entity scoring, and audits

**Files:**
- Modify: `test/music.test.js`
- Modify: `src/music/provider.js`

- [ ] **Step 1: Write failing entity and hard-constraint tests**

Add tests for the two observed regressions:

```js
test('does not match a requested artist to a fan-account substring', () => {
  assert.equal(matchTrack(
    { title: '你就不要想起我', artist: '田馥甄' },
    { title: '你就不要想起我', artist: '田馥甄的小迷妹', artists: ['田馥甄的小迷妹'] },
  ), false);
});

test('chooses the best entity from the top five results', async () => {
  const provider = {
    name: 'netease',
    async searchTracks() {
      return [
        { id: 'wrong', title: '目标歌曲', artist: '其他歌手', artists: ['其他歌手'] },
        { id: 'right', title: '目标歌曲', artist: '目标歌手', artists: ['目标歌手'] },
      ];
    },
    async checkPlayable() { return true; },
    async enrichTrack(track) { return track; },
  };
  const result = await validateCandidates([{
    title: '目标歌曲', artist: '目标歌手', styleClusters: [], genres: ['r&b'],
    language: 'zh', vocal: 'female', version: 'original',
  }], provider, {
    limit: 1,
    constraints: { genres: ['r&b'], vocals: ['female'], source: { genres: 'user', vocals: 'user' } },
  });
  assert.equal(result.tracks[0].id, 'right');
  assert.equal(result.audits[0].result, 'accepted');
});

test('rejects ordinary pop declarations from a hard R&B request before search', async () => {
  let searches = 0;
  const provider = {
    name: 'fake',
    async searchTracks() { searches += 1; return []; },
    async checkPlayable() { return true; },
  };
  const result = await validateCandidates([{
    title: '红色高跟鞋', artist: '蔡健雅', styleClusters: [], genres: ['pop'],
    language: 'zh', vocal: 'female', version: 'original',
  }], provider, {
    constraints: { genres: ['r&b'], source: { genres: 'user' } },
  });
  assert.equal(searches, 0);
  assert.deepEqual(result.tracks, []);
  assert.equal(result.audits[0].reason, 'genre_mismatch');
});

test('rejects traditional underground declarations from the Chinese internet cluster', async () => {
  const provider = { name: 'fake', async searchTracks() { return []; }, async checkPlayable() { return true; } };
  const result = await validateCandidates([{
    title: '旧派地下候选', artist: '某说唱歌手',
    styleClusters: ['cn_traditional_underground'], genres: ['hip-hop/rap'],
    language: 'zh', vocal: 'male', version: 'original',
  }], provider, {
    constraints: {
      styleClusters: ['cn_internet_underground'],
      source: { styleClusters: 'user' },
    },
  });
  assert.equal(result.audits[0].reason, 'style_mismatch');
});

test('prefers the original entity when live versions are excluded', async () => {
  const provider = {
    name: 'netease',
    async searchTracks() {
      return [
        { id: 'live', title: '目标歌曲 (Live)', artist: '目标歌手', artists: ['目标歌手'] },
        { id: 'original', title: '目标歌曲', artist: '目标歌手', artists: ['目标歌手'] },
      ];
    },
    async checkPlayable() { return true; },
    async enrichTrack(track) { return track; },
  };
  const result = await validateCandidates([{
    title: '目标歌曲', artist: '目标歌手', styleClusters: [], genres: [],
    language: 'zh', vocal: 'female', version: 'original',
  }], provider, {
    limit: 1,
    constraints: { avoid: ['live'], source: { avoid: 'user' } },
  });
  assert.equal(result.tracks[0].id, 'original');
});
```

- [ ] **Step 2: Run music tests and verify RED**

Run:

```bash
node --test test/music.test.js
```

Expected: FAIL because artist containment still passes and `validateCandidates` returns an array without audits.

- [ ] **Step 3: Implement exact artist identities and candidate preflight**

Add these helpers to `src/music/provider.js`:

```js
const { canonicalizeArtist, searchNamesForArtist } = require('../domain/music-taxonomy');

function splitArtists(track) {
  const values = Array.isArray(track?.artists) && track.artists.length
    ? track.artists
    : String(track?.artist || '').split(/\s*(?:,|，|、|&|\/|\bfeat\.?\b|\bft\.?\b)\s*/i);
  return values.map(canonicalizeArtist).map(normalize).filter(Boolean);
}

function detectVersion(title) {
  const text = String(title || '').toLowerCase();
  if (/\b(?:live)\b|现场版|演唱会/.test(text)) return 'live';
  if (/\bremix\b|重混/.test(text)) return 'remix';
  if (/伴奏|instrumental/.test(text)) return 'instrumental';
  if (/翻唱|cover/.test(text)) return 'cover';
  return 'original';
}

function titleScore(requested, resolved) {
  const left = normalize(requested);
  const right = normalize(resolved);
  if (!left || !right) return 0;
  if (left === right) return 60;
  if (Math.min(left.length, right.length) < 4) return 0;
  return left.includes(right) || right.includes(left) ? 35 : 0;
}

function scoreTrackMatch(requested, resolved, constraints = {}) {
  const score = titleScore(requested?.title, resolved?.title);
  if (!score) return 0;
  const requestedArtists = splitArtists(requested);
  const resolvedArtists = splitArtists(resolved);
  if (!requestedArtists.length || !resolvedArtists.length) return 0;
  if (!requestedArtists.some(artist => resolvedArtists.includes(artist))) return 0;
  const version = detectVersion(resolved.title);
  if (constraints.avoid?.includes(version)) return 0;
  const versionBonus = requested.version === version ? 10 : 0;
  return score + 50 + versionBonus;
}

function selectBestMatch(requested, results, constraints = {}) {
  const versionCompatible = results.filter(track => !constraints.avoid?.includes(detectVersion(track.title)));
  if (results.length && !versionCompatible.length) return { track: null, reason: 'version_mismatch' };
  const ranked = versionCompatible
    .map(track => ({ track, score: scoreTrackMatch(requested, track, constraints) }))
    .filter(item => item.score >= 85)
    .sort((left, right) => right.score - left.score);
  return ranked.length
    ? { track: ranked[0].track, reason: null }
    : { track: null, reason: 'artist_mismatch' };
}

function matchTrack(requested, resolved) {
  return scoreTrackMatch(requested, resolved) >= 85;
}

function hardSource(constraints, field) {
  return ['user', 'inherited'].includes(constraints?.source?.[field]);
}

function candidateConstraintFailure(candidate, constraints = {}) {
  if (hardSource(constraints, 'styleClusters')
    && constraints.styleClusters?.length
    && !constraints.styleClusters.some(style => candidate.styleClusters.includes(style))) return 'style_mismatch';
  if (hardSource(constraints, 'genres')
    && constraints.genres?.length
    && !constraints.genres.some(genre => candidate.genres.includes(genre))) return 'genre_mismatch';
  if (hardSource(constraints, 'vocals')
    && constraints.vocals?.length
    && !constraints.vocals.includes(candidate.vocal)) return 'vocal_mismatch';
  if (hardSource(constraints, 'languages')
    && constraints.languages?.length
    && !constraints.languages.includes(candidate.language)) return 'language_mismatch';
  if (hardSource(constraints, 'artists')
    && constraints.artists?.length
    && !splitArtists(candidate).some(artist => constraints.artists.map(normalize).includes(artist))) return 'artist_mismatch';
  if ((constraints.avoid || []).some(value => value.startsWith('artist:')
    && splitArtists(candidate).includes(normalize(value.slice('artist:'.length))))) return 'artist_excluded';
  if (constraints.avoid?.includes(candidate.version)) return 'version_mismatch';
  return null;
}
```

- [ ] **Step 4: Refactor ordered validation to return tracks and audits**

Update `validateCandidates` so each candidate produces one fixed audit result:

```js
async function validateCandidates(candidates, provider, options = {}) {
  const limit = Math.min(Number(options.limit || 20), 20);
  const excluded = options.excludeIds || new Set();
  const constraints = options.constraints || {};
  const accepted = [];
  const audits = [];
  const seen = new Set();
  let cursor = 0;

  async function run() {
    while (accepted.length < limit && cursor < candidates.length) {
      const index = cursor++;
      const candidate = candidates[index];
      const failedConstraint = candidateConstraintFailure(candidate, constraints);
      if (failedConstraint) {
        audits.push({ candidateIndex: index, candidate, result: 'rejected', reason: failedConstraint });
        continue;
      }

      const searchNames = searchNamesForArtist(candidate.artist);
      const results = [];
      for (const artist of searchNames) {
        const found = typeof provider.searchTracks === 'function'
          ? await provider.searchTracks(candidate.title, artist)
          : [await provider.searchTrack(candidate.title, artist)].filter(Boolean);
        results.push(...found);
        if (selectBestMatch(candidate, results, constraints).track) break;
      }
      if (!results.length) {
        audits.push({ candidateIndex: index, candidate, result: 'rejected', reason: 'search_miss' });
        continue;
      }
      const selected = selectBestMatch(candidate, results, constraints);
      const resolved = selected.track;
      if (!resolved) {
        audits.push({ candidateIndex: index, candidate, result: 'rejected', reason: selected.reason });
        continue;
      }
      const id = String(resolved.id || '');
      if (excluded.has(id)) {
        audits.push({ candidateIndex: index, candidate, resolved, result: 'rejected', reason: 'recently_used' });
        continue;
      }
      if (seen.has(id)) {
        audits.push({ candidateIndex: index, candidate, resolved, result: 'rejected', reason: 'duplicate' });
        continue;
      }
      if (!await provider.checkPlayable(resolved.id)) {
        audits.push({ candidateIndex: index, candidate, resolved, result: 'rejected', reason: 'unavailable' });
        continue;
      }
      const enriched = typeof provider.enrichTrack === 'function'
        ? await provider.enrichTrack(resolved)
        : resolved;
      if (accepted.length >= limit) {
        audits.push({ candidateIndex: index, candidate, resolved: enriched || resolved, result: 'rejected', reason: 'limit_reached' });
        continue;
      }
      if (seen.has(id)) {
        audits.push({ candidateIndex: index, candidate, resolved: enriched || resolved, result: 'rejected', reason: 'duplicate' });
        continue;
      }
      seen.add(id);
      accepted.push({ index, track: { ...(enriched || resolved), provider: provider.name } });
      audits.push({ candidateIndex: index, candidate, resolved: enriched || resolved, result: 'accepted', reason: null });
    }
  }

  const concurrency = Math.max(1, Number(options.concurrency || 5));
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, run));
  return {
    tracks: accepted.sort((left, right) => left.index - right.index).slice(0, limit).map(item => item.track),
    audits: audits.sort((left, right) => left.candidateIndex - right.candidateIndex),
  };
}
```

Update providers to expose `searchTracks`:

```js
async searchTracks(title, artist) {
  return netease.searchSongs(`${title} ${artist}`, { limit: 5 });
}
```

Implement the demo provider's equivalent method as:

```js
async searchTracks(title, artist) {
  return DEMO_CATALOG.filter(track => matchTrack({ title, artist }, track));
}
```

- [ ] **Step 5: Update existing music assertions and verify GREEN**

Change existing callers from:

```js
const tracks = await validateCandidates(candidates, provider, options);
```

to:

```js
const { tracks } = await validateCandidates(candidates, provider, options);
```

Run:

```bash
node --test test/music.test.js
```

Expected: PASS with strict artist identities, top-five selection, hard constraint rejection, early stop, and deterministic audit order.

- [ ] **Step 6: Commit validation and audits**

```bash
git add src/music/provider.js test/music.test.js
git commit -m "feat: audit constrained music candidate validation"
```

---

### Task 7: Persist constraints and candidate audits compatibly

**Files:**
- Modify: `test/state.test.js`
- Modify: `state.js`

- [ ] **Step 1: Write failing persistence and migration tests**

Extend the existing card fixture with:

```js
constraints: {
  styleClusters: ['cn_internet_underground'],
  genres: ['hip-hop/rap'], languages: ['zh'], vocals: [],
  artists: [], artistAnchors: ['skiboyvv', 'africakid'], avoid: [],
  source: { styleClusters: 'user', genres: 'user', languages: 'default' },
},
```

Save audits with the card and assert them after reopen:

```js
repository.saveCard(card, { candidateAudits: [{
  candidateIndex: 0,
  candidate: { title: 'First', artist: 'A' },
  resolved: { id: 'demo-1', title: 'First', artist: 'A' },
  result: 'accepted', reason: null,
}] });

assert.deepEqual(repository.getCard('card-1').constraints.genres, ['hip-hop/rap']);
assert.deepEqual(repository.listCandidateAudits('card-1'), [{
  candidateIndex: 0,
  requestedTitle: 'First',
  requestedArtist: 'A',
  resolvedTrackId: 'demo-1',
  resolvedTitle: 'First',
  resolvedArtist: 'A',
  result: 'accepted',
  reason: null,
}]);
```

Import `better-sqlite3` in the test and add a complete legacy migration case:

```js
const Database = require('better-sqlite3');

test('migrates legacy turns and hydrates missing constraints as empty', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'this-moment-legacy-state-'));
  const dbPath = path.join(directory, 'legacy.sqlite');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      user_input TEXT NOT NULL,
      environment_json TEXT NOT NULL,
      intent TEXT NOT NULL,
      direction_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      turn_id TEXT NOT NULL REFERENCES turns(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      warning TEXT,
      tts_status TEXT NOT NULL DEFAULT 'idle',
      tts_url TEXT,
      tts_error TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO sessions VALUES ('s1', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    INSERT INTO turns VALUES ('t1', 's1', '来点音乐', '{}', 'recommend', '{}', '2026-08-01T00:00:00.000Z');
    INSERT INTO cards VALUES ('c1', 's1', 't1', '旧卡片', '旧推荐语', 'demo', 'ready', NULL, 'idle', NULL, NULL, '2026-08-01T00:00:00.000Z');
  `);
  legacy.close();

  const repository = createRepository(dbPath);
  try {
    const columns = repository.db.prepare('PRAGMA table_info(turns)').all().map(column => column.name);
    assert.ok(columns.includes('constraints_json'));
    assert.deepEqual(repository.getCard('c1').constraints, {});
  } finally {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rolls back the card when an audit row violates the audit contract', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'this-moment-audit-rollback-'));
  const dbPath = path.join(directory, 'state.sqlite');
  const repository = createRepository(dbPath);
  try {
    assert.throws(() => repository.saveCard(cardFixture(), {
      candidateAudits: [{
        candidateIndex: 0,
        candidate: { title: 'First', artist: 'A' },
        resolved: null,
        result: 'invalid',
        reason: 'search_miss',
      }],
    }), /CHECK constraint/i);
    assert.equal(repository.getCard('card-1'), null);
  } finally {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
```

Extract the existing card literal into a local `cardFixture()` helper so both persistence tests use an independent object.

- [ ] **Step 2: Run state tests and verify RED**

Run:

```bash
node --test test/state.test.js
```

Expected: FAIL because constraints and candidate audits are not persisted.

- [ ] **Step 3: Add compatible schema migration and audit table**

After the existing `db.exec`, add:

```js
const turnColumns = new Set(db.prepare('PRAGMA table_info(turns)').all().map(column => column.name));
if (!turnColumns.has('constraints_json')) {
  db.exec("ALTER TABLE turns ADD COLUMN constraints_json TEXT NOT NULL DEFAULT '{}'");
}
db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_audits (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    candidate_index INTEGER NOT NULL,
    requested_title TEXT NOT NULL,
    requested_artist TEXT NOT NULL,
    resolved_track_id TEXT,
    resolved_title TEXT,
    resolved_artist TEXT,
    result TEXT NOT NULL CHECK(result IN ('accepted', 'rejected')),
    reason TEXT,
    PRIMARY KEY (card_id, candidate_index)
  );
`);
```

Add `constraints_json` to the turn insert and card query. Parse it as `constraints` in `hydrateCard`.

- [ ] **Step 4: Save audits in the card transaction and expose a reader**

Prepare the audit statements next to the track statements:

```js
const clearAudits = db.prepare('DELETE FROM candidate_audits WHERE card_id = ?');
const insertAudit = db.prepare(`
  INSERT INTO candidate_audits
    (card_id, candidate_index, requested_title, requested_artist,
     resolved_track_id, resolved_title, resolved_artist, result, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

Change `saveCardTransaction` from `card =>` to `({ card, candidateAudits }) =>`, retain the existing session, turn, card, and track statements unchanged, and append this block after the track loop:

```js
  clearAudits.run(card.id);
  for (const audit of candidateAudits) {
    insertAudit.run(
      card.id,
      audit.candidateIndex,
      audit.candidate.title,
      audit.candidate.artist,
      audit.resolved?.id ? String(audit.resolved.id) : null,
      audit.resolved?.title || null,
      audit.resolved?.artist || null,
      audit.result,
      audit.reason,
    );
  }
```

Expose:

```js
saveCard(card, { candidateAudits = [] } = {}) {
  saveCardTransaction({ card, candidateAudits });
  return this.getCard(card.id);
},
listCandidateAudits(cardId) {
  return db.prepare(`
    SELECT candidate_index, requested_title, requested_artist,
      resolved_track_id, resolved_title, resolved_artist, result, reason
    FROM candidate_audits WHERE card_id = ? ORDER BY candidate_index ASC
  `).all(cardId).map(row => ({
    candidateIndex: row.candidate_index,
    requestedTitle: row.requested_title,
    requestedArtist: row.requested_artist,
    resolvedTrackId: row.resolved_track_id,
    resolvedTitle: row.resolved_title,
    resolvedArtist: row.resolved_artist,
    result: row.result,
    reason: row.reason,
  }));
},
```

- [ ] **Step 5: Run state tests and verify GREEN**

Run:

```bash
node --test test/state.test.js
```

Expected: PASS for new and legacy databases.

- [ ] **Step 6: Commit persistence changes**

```bash
git add state.js test/state.test.js
git commit -m "feat: persist recommendation constraints and audits"
```

---

### Task 8: Integrate structured mapping into the recommendation pipeline

**Files:**
- Modify: `test/pipeline.test.js`
- Modify: `src/recommendation/pipeline.js`

- [ ] **Step 1: Upgrade the pipeline harness and add failing regressions**

Update the test `plan()` candidates to include required declarations:

```js
candidates: Array.from({ length: count }, (_, index) => ({
  title: `Song ${offset + index}`,
  artist: `Artist ${offset + index}`,
  styleClusters: [], genres: ['hip-hop/rap'],
  language: 'zh', vocal: 'male', version: 'original',
})),
```

Change the fake provider to expose `searchTracks`, and change fake repository `saveCard` to capture its options. Add:

```js
test('treats an underground request containing 一点 as a new structured topic', async () => {
  const previous = {
    id: 'previous',
    direction: { atmosphere: ['旋律说唱'], energy: '中等', rhythm: ['平稳鼓点'] },
    constraints: { genres: ['r&b'], vocals: ['female'], avoid: ['male_vocal'], source: {} },
    tracks: [{ id: 'old', title: 'Old', artist: 'Artist' }],
  };
  const { pipeline, calls, saved } = harness({ previous });
  await pipeline.generate({
    sessionId: 's1',
    userInput: '我现在想听一点 underground rapper 的歌',
    environment: {},
  });

  assert.equal(calls[0].intent, 'recommend');
  assert.deepEqual(calls[0].effectiveConstraints.styleClusters, ['cn_internet_underground']);
  assert.deepEqual(calls[0].effectiveConstraints.artistAnchors, ['skiboyvv', 'africakid']);
  assert.deepEqual(calls[0].effectiveConstraints.vocals, []);
  assert.equal(calls[0].previousEffectiveContext, null);
  assert.deepEqual(saved().constraints.styleClusters, ['cn_internet_underground']);
});

test('inherits R&B while making female vocals a hard refinement', async () => {
  const previous = {
    id: 'previous', direction: {},
    constraints: {
      styleClusters: [], genres: ['r&b'], languages: [], vocals: ['mixed'],
      artists: [], artistAnchors: [], avoid: [], source: { genres: 'user' },
    },
    tracks: [],
  };
  const { pipeline, calls } = harness({ previous });
  await pipeline.generate({ sessionId: 's1', userInput: '不要男歌手', environment: {} });

  assert.equal(calls[0].intent, 'refine');
  assert.deepEqual(calls[0].effectiveConstraints.genres, ['r&b']);
  assert.deepEqual(calls[0].effectiveConstraints.vocals, ['female']);
  assert.deepEqual(calls[0].effectiveConstraints.avoid, ['male_vocal']);
});
```

- [ ] **Step 2: Run pipeline tests and verify RED**

Run:

```bash
node --test test/pipeline.test.js
```

Expected: FAIL because the pipeline does not analyze, merge, pass, persist, or validate constraints.

- [ ] **Step 3: Integrate taxonomy and constraints before the model call**

Import:

```js
const { analyzeExplicitConstraints, mergeConstraints } = require('../domain/constraints');
```

At the start of `generate`, replace intent creation with:

```js
const analyzed = analyzeExplicitConstraints(userInput);
const intent = routeIntent(userInput, {
  hasPreviousCard: Boolean(previousCard),
  hasExplicitTopic: analyzed.hasExplicitTopic,
});
const effectiveConstraints = mergeConstraints({
  intent,
  previous: previousCard?.constraints || {},
  explicit: analyzed.constraints,
});
const previousEffectiveContext = ['refine', 'refresh'].includes(intent) && previousCard
  ? { direction: previousCard.direction, constraints: previousCard.constraints || {} }
  : null;
```

Call the LLM with:

```js
const firstPlan = await llm.generatePlan({
  sessionId,
  userInput,
  environment: resolvedEnvironment,
  intent,
  effectiveConstraints,
  taxonomyContext: analyzed.taxonomy,
  previousEffectiveContext,
  candidateCount: candidateTrackCount,
  excludeTracks,
});
```

- [ ] **Step 4: Integrate validated tracks and audit persistence**

Replace the validation call with:

```js
const { tracks, audits } = await validateCandidates(firstPlan.candidates, musicProvider, {
  limit: targetTrackCount,
  concurrency: 2,
  excludeIds: excludedIds,
  constraints: effectiveConstraints,
});
```

Add `constraints: effectiveConstraints` to the card, and persist without broadcasting audits:

```js
repository.saveCard(card, { candidateAudits: audits });
publish({ type: 'complete', card });
```

- [ ] **Step 5: Update existing assertions and verify focused GREEN**

Update existing pipeline fake provider calls and assertions for `{ tracks, audits }`. Run:

```bash
node --test test/pipeline.test.js test/domain.test.js test/constraints.test.js test/taxonomy.test.js test/context.test.js test/music.test.js test/state.test.js
```

Expected: PASS.

- [ ] **Step 6: Run server and UI contract regressions**

Run:

```bash
node --test test/server.test.js test/app-model.test.js test/ui.test.js
```

Expected: PASS. Candidate audits must not appear in card API responses or WebSocket `complete` events.

- [ ] **Step 7: Commit pipeline integration**

```bash
git add src/recommendation/pipeline.js test/pipeline.test.js
git commit -m "feat: integrate structured song mapping pipeline"
```

---

### Task 9: Update the mapping documentation without overwriting user changes

**Files:**
- Modify carefully: `user/taste.md`
- Modify: `README.md`
- Modify: `docs/current-model-and-song-mapping.md`

- [ ] **Step 1: Inspect user-owned diffs before editing**

Run:

```bash
git diff -- user/taste.md user/mood-rules.md
```

Expected: the existing Chinese 70% preference and rewritten mood rules remain visible. Do not restore either file.

- [ ] **Step 2: Append the soft-default boundary to `user/taste.md`**

Append exactly:

```markdown

# 风格默认边界

- “underground rapper”未指定地区时，默认理解为当代中文网络地下说唱，以 skiboyvv、africakid 为风格锚点，不强制每轮包含锚点本人。
- 用户明确点名 Yeat、fakemink 或其他海外艺人时，本轮明确参照高于中文默认。
- 用户说“中文为主，但像 Yeat”时，中文是硬约束，Yeat 只作为风格参照。
- 用户明确指定曲风、人声、语言、艺人或版本时，这些条件高于本文件的所有软偏好。
```

- [ ] **Step 3: Update README architecture and diagnostics**

Add a “结构化歌曲映射” section describing:

```markdown
## 结构化歌曲映射

系统先确定新主题、微调或换一批，再按字段解析曲风、语言、人声、艺人、版本和排除条件。`underground rapper` 在没有地区提示时默认进入当代中文网络地下风格簇，以 skiboyvv 和 africakid 为风格锚点；明确点名海外艺人时以本轮要求为准。

DeepSeek 只生成音乐方向、推荐语和带声明字段的候选，不能改写确定性意图和硬约束。网易云会检查前五个搜索实体、严格核对独立艺人名称、验证播放地址，并保存固定的候选接受或拒绝代码。硬约束后的可播歌曲不足 8 首时返回实际数量，不使用弱匹配歌曲补满。
```

- [ ] **Step 4: Revise the detailed mapping document**

Update `docs/current-model-and-song-mapping.md` so it states the implemented behavior rather than the previous limitations:

- intent no longer treats “一点、一些” as standalone refinement evidence;
- constraints are persisted field-by-field;
- Chinese internet-underground taxonomy and aliases are deterministic;
- model candidates carry declarations;
- NetEase checks five entities and exact artist identities;
- candidate audits explain filtering;
- audio features and vector retrieval remain out of scope.

- [ ] **Step 5: Review documentation diff and commit only intended files**

Run:

```bash
git diff --check -- user/taste.md README.md docs/current-model-and-song-mapping.md
```

Expected: no whitespace errors.

Commit:

```bash
git add user/taste.md README.md docs/current-model-and-song-mapping.md
git commit -m "docs: explain structured music mapping"
```

---

### Task 10: Complete final verification and live smoke checks

**Files:**
- Verify only; modify tests or implementation only if a failing check reveals a root cause covered by the specification.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run JavaScript syntax checks**

Run:

```bash
find . -path './node_modules' -prune -o -path './.git' -prune -o -name '*.js' -type f -print0 | xargs -0 -n1 node --check
```

Expected: exit code 0 and no syntax diagnostics.

- [ ] **Step 3: Verify the staged and unstaged boundaries**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. User-owned unrelated files remain untouched and unstaged.

- [ ] **Step 4: Run a live underground recommendation in an isolated session**

With the existing local service running in live mode, submit:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/recommendations \
  -H 'content-type: application/json' \
  --data '{"sessionId":"mapping-smoke-underground","userInput":"我现在想听一点 underground rapper 的歌","environment":{"city":"上海","weather":"晴朗"}}'
```

Poll without exposing credentials:

```bash
curl -sS 'http://127.0.0.1:8080/api/cards?sessionId=mapping-smoke-underground'
```

Expected: the card has `intent: "recommend"`, constraints include `cn_internet_underground`, and the recommendation direction is not inherited from an unrelated prior card.

- [ ] **Step 5: Run a live two-turn R&B constraint check**

Submit “来点 R&B”, wait for its card, then submit “不要男歌手” using the same isolated session ID. Query the cards and candidate audits from SQLite without printing secrets.

Expected:

- second card retains `genres: ["r&b"]`;
- second card has `vocals: ["female"]` and `avoid: ["male_vocal"]`;
- rejected non-R&B candidates use `genre_mismatch`;
- no fan-account substring is accepted as the requested artist;
- fewer than 8 valid songs is acceptable.

- [ ] **Step 6: Restart the persistent service on the verified HEAD**

Use the repository's existing launch mechanism, then verify:

```bash
curl -fsS http://127.0.0.1:8080/api/status
```

Expected: HTTP 200 with live/demo mode, music provider, LLM configuration, and TTS configuration booleans only.

- [ ] **Step 7: Record final evidence**

Report:

- full test count and pass count;
- syntax-check result;
- live underground card intent and style cluster;
- live R&B inherited constraints;
- accepted/rejected audit counts by reason;
- any live-provider limitations without exposing raw upstream responses or credentials.

---

## Plan self-review checklist

- Every requirement in `docs/superpowers/specs/2026-08-06-structured-music-mapping-design.md` maps to a task above.
- New behavior begins with a failing test and an observed RED result.
- Deterministic intent and constraints never become model-authoritative output.
- User explicit requirements outrank taxonomy and `taste.md` defaults.
- `skiboyvv` avoids the classic-singer name collision; `aficakid` normalizes to `africakid`.
- NetEase remains the only real music source and no second model fill call is introduced.
- Candidate audit data excludes model reasoning, credentials, cookies, and raw provider payloads.
- Existing uncommitted user changes are preserved and staged selectively.
