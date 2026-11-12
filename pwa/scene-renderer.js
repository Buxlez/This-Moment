/*
 * This Moment 天气场景渲染器（原生 WebGL2，无第三方依赖）。
 *
 * 着色器全部为本项目自行编写：水滴用的是通用做法（按列/网格放置水滴、由水滴形状得到法线、
 * 按法线偏移采样坐标），没有移植或改写任何第三方着色器代码。
 *
 * 两个 pass：
 *   1. 底图：域扭曲 fbm 双色流体 + 柔光斑 + 场景专属底层元素，渲染到半分辨率 FBO（带 mipmap）。
 *   2. 合成：对底图做模糊采样，叠加天气层（雨/雪/雾/热浪/浮尘），最后暗角 + 颗粒。
 */
(function exposeSceneRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ThisMomentSceneRenderer = api;
}(typeof window !== 'undefined' ? window : globalThis, function sceneRendererFactory() {
  const KIND = { rain: 0, snow: 1, fog: 2, heat: 3, clear: 4, cloudy: 5 };
  const MAX_BOKEH_COLORS = 4;
  const SLOW_FRAME_MS = 24;
  const SLOW_FRAMES_TO_DOWNGRADE = 45;
  const MAX_QUALITY_LEVEL = 3;
  const RENDER_SCALES = [1, 1, 0.75, 0.5];
  const FOG_REFORM_SECONDS = 5;

  const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

  const NOISE = `
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return sum;
}`;

  const BASE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uBokeh[${MAX_BOKEH_COLORS}];
uniform int uBokehCount;
uniform float uBokehAmt;
uniform float uIntensity;
uniform float uGradient;
uniform int uKind;
out vec4 outColor;
${NOISE}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  float t = uTime;

  // 域扭曲的双色流体
  vec2 warp = vec2(fbm(p * 1.3 + vec2(0.0, t * 0.02)), fbm(p * 1.3 + vec2(5.2, 1.3 - t * 0.015)));
  float fluid = fbm(p * 1.1 + 1.8 * warp + vec2(t * 0.01, 0.0));
  float blend = smoothstep(0.25, 0.8, fluid);
  // uGradient > 0：colorB 在下方；< 0：colorB 在上方
  float vertical = uGradient > 0.0 ? 1.0 - uv.y : uv.y;
  blend = mix(blend, vertical, abs(uGradient));
  vec3 col = mix(uColorA, uColorB, blend);

  if (uKind == 5) {
    // 多云：大块云影缓慢移动
    float cloud = fbm(p * vec2(0.8, 1.5) + vec2(t * 0.014, 0.0) + warp * 0.6);
    float shade = smoothstep(0.42, 0.74, cloud);
    col = mix(col, col * 0.68 + vec3(0.03, 0.02, 0.07), shade * 0.7);
    col += vec3(1.0, 0.84, 0.74) * smoothstep(0.62, 0.3, cloud) * 0.07;
  } else if (uKind == 4) {
    // 晴：从左上角斜射进来的光束和漏光
    vec2 q = p - vec2(-0.12, 1.14);
    float ang = atan(q.y, q.x);
    float len = length(q);
    float rays = smoothstep(0.38, 0.86, vnoise(vec2(ang * 9.0, t * 0.035)));
    rays *= smoothstep(2.1, 0.25, len);
    col *= 0.86;
    col += vec3(1.0, 0.93, 0.74) * rays * 0.26;
    col += vec3(1.0, 0.95, 0.8) * exp(-len * 1.5) * 0.42;
  } else if (uKind == 3) {
    // 高温：地平线、路面和迎面而来的车道线（给热浪扭曲提供可见的参照物）
    float horizon = 0.46;
    if (uv.y < horizon) {
      float depth = (horizon - uv.y) / horizon;
      vec3 road = mix(uColorA * 0.72, uColorA * 0.4, depth);
      float xr = (uv.x - 0.5) / (0.04 + depth * 0.9);
      float edgeLine = smoothstep(0.04, 0.02, abs(abs(xr) - 0.36));
      float dash = smoothstep(0.03, 0.012, abs(xr)) * step(0.5, fract(1.1 / (depth + 0.06) + t * 1.4));
      road += vec3(1.0, 0.93, 0.8) * (edgeLine * 0.45 + dash * 0.6) * smoothstep(0.02, 0.22, depth);
      col = mix(col, road, smoothstep(horizon, horizon - 0.035, uv.y));
    }
    // 右上角的镜头眩光：光核、光晕、横向拉丝和几枚鬼影
    vec2 sun = vec2(asp * 0.9, 0.9);
    float d = length(p - sun);
    vec3 flare = vec3(1.0, 0.96, 0.84) * (exp(-d * 6.0) * 0.95 + exp(-d * 1.5) * 0.3);
    flare += vec3(1.0, 0.9, 0.7) * exp(-abs(p.y - sun.y) * 46.0) * exp(-abs(p.x - sun.x) * 1.6) * 0.34;
    vec2 axis = vec2(asp * 0.5, 0.5) - sun;
    for (int g = 0; g < 3; g++) {
      float fg = float(g);
      vec2 gc = sun + axis * (0.55 + fg * 0.42);
      float gr = 0.03 + fg * 0.022;
      float gd = length(p - gc);
      flare += vec3(1.0, 0.72 + fg * 0.1, 0.46) * smoothstep(gr, gr * 0.72, gd) * (0.05 + 0.03 * smoothstep(gr * 0.6, gr, gd));
    }
    col += flare * uIntensity;
  }

  // 缓慢漂移的柔光斑：窗外的灯
  bool night = uKind == 0 || uKind == 1;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    vec2 c = vec2(hash1(fi * 1.7 + 0.3), hash1(fi * 2.9 + 7.1));
    c.y = night ? mix(0.22, 0.72, c.y) : mix(0.12, 0.88, c.y);
    c.x *= asp;
    c += 0.035 * vec2(sin(t * 0.07 * (0.5 + hash1(fi + 3.0)) + fi * 2.1), cos(t * 0.05 * (0.5 + hash1(fi + 9.0)) + fi));
    float r = mix(0.024, 0.085, hash1(fi * 5.3 + 1.9));
    float d = length(p - c);
    float disc = smoothstep(r, r * 0.84, d);
    float rim = smoothstep(r * 0.62, r, d) * disc;
    float flicker = 0.78 + 0.22 * sin(t * (0.3 + hash1(fi + 11.0)) + fi * 4.0);
    int ci = int(mod(floor(hash1(fi * 3.7 + 2.2) * float(uBokehCount)), float(uBokehCount)));
    glow += uBokeh[ci] * (disc * 0.5 + rim * 0.38) * flicker * mix(0.35, 1.0, hash1(fi * 3.1 + 5.0));
  }
  if (night) {
    // 夜景：地面一带的漫反射光
    float band = exp(-pow((uv.y - 0.4) * 3.4, 2.0));
    glow += mix(uBokeh[0], uBokeh[min(1, uBokehCount - 1)], vnoise(vec2(p.x * 1.6, t * 0.05))) * band * 0.16;
  }
  vec3 lit = clamp(glow * uBokehAmt * (0.6 + uIntensity), 0.0, 1.0);
  col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - lit);

  outColor = vec4(col, 1.0);
}`;

  const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uTrail;
uniform vec2 uRes;
uniform vec2 uBaseRes;
uniform float uTime;
uniform float uSceneTime;
uniform float uBlur;
uniform float uGrain;
uniform float uVignette;
uniform float uAlpha;
uniform int uKind;
uniform int uLayers;
out vec4 outColor;
${NOISE}

// 颗粒用整数哈希（lowbias32 这类公开的位混合做法），sin 哈希在逐像素坐标上会出现规则纹理
float pixelHash(vec2 pixel, float frame) {
  uint h = uint(pixel.x) * 1664525u + uint(pixel.y) * 1013904223u + uint(frame) * 374761393u;
  h ^= h >> 16; h *= 0x7feb352du;
  h ^= h >> 15; h *= 0x846ca68bu;
  h ^= h >> 16;
  return float(h) / 4294967295.0;
}

vec3 sharp(vec2 uv) { return textureLod(uBase, uv, 0.0).rgb; }

// 隔着玻璃的虚化：取较高的 mip 级别，再做几个错开的采样把方块感抹掉
vec3 soft(vec2 uv, float amount) {
  float lod = clamp(amount, 0.0, 1.2) * 4.6;
  vec2 o = exp2(lod) * 0.8 / uBaseRes;
  vec3 c = textureLod(uBase, uv, lod).rgb * 0.36;
  c += textureLod(uBase, uv + vec2(o.x, o.y * 0.45), lod).rgb * 0.16;
  c += textureLod(uBase, uv + vec2(-o.x * 0.45, o.y), lod).rgb * 0.16;
  c += textureLod(uBase, uv + vec2(-o.x, -o.y * 0.45), lod).rgb * 0.16;
  c += textureLod(uBase, uv + vec2(o.x * 0.45, -o.y), lod).rgb * 0.16;
  return c;
}

// q：到水滴中心的归一化偏移（|q| = 1 是水滴边缘）。累加折射法线、遮罩和明暗。
void addDrop(vec2 q, float vis, inout vec2 n, inout float m, inout float light) {
  float d = length(q);
  float k = smoothstep(1.0, 0.82, d) * vis;
  if (k <= 0.0) return;
  n += q * k;
  m = max(m, k);
  float spec = smoothstep(0.32, 0.0, length(q - vec2(-0.34, 0.38)));
  float rim = smoothstep(0.45, 1.0, d);
  light += k * (0.9 * spec - 0.5 * rim);
}

// 静止的小水珠：每个网格单元最多一颗，带出现/蒸发的生命周期
void beads(vec2 p, float scale, float t, float seed, float keep, inout vec2 n, inout float m, inout float light) {
  vec2 g = p * scale;
  g.x += hash1(floor(g.y) * 3.7 + seed) * 7.0;   // 每行错开，避免看出网格
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash2(id + seed);
  float h2 = hash2(id + seed + 71.3);
  float h3 = hash2(id + seed + 19.7);
  if (h2 < 0.48) return;
  float r = mix(0.06, 0.23, h3 * h3 * h3);
  vec2 c = r + (1.0 - 2.0 * r) * vec2(h, hash2(id + seed + 41.9));
  float life = fract(h * 7.0 + t * mix(0.015, 0.05, h3));
  float vis = smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.8, life) * keep;
  addDrop((f - c) / r, vis, n, m, light);
}

// 下滑的大雨滴：每列一颗，走走停停地从上滑到下，身后留一道擦净玻璃的水痕和一串残留小水珠
void runners(vec2 p, float cols, float t, float seed, inout vec2 n, inout float m, inout float light, inout float trail) {
  float cw = 1.0 / cols;
  float gx = p.x / cw;
  float ci = floor(gx);
  float fx = fract(gx);
  float hc = hash1(ci * 1.731 + seed);
  float speed = mix(0.05, 0.12, hash1(ci * 3.17 + seed + 2.0));
  float cyc = t * speed + hc * 10.0;
  float lap = floor(cyc);
  float ph = fract(cyc);
  float hk = hash1(ci * 7.7 + lap * 1.3 + seed);
  if (hk < 0.38) return;
  float prog = ph - 0.82 * sin(ph * 25.1327) / 25.1327;
  float yd = 1.16 - prog * 1.5;
  float amp = 0.15;
  float fq = 9.0 + 6.0 * hk;
  float xoff = 0.5 + (hk - 0.5) * 0.36;
  float xd = xoff + amp * sin(yd * fq + hk * 30.0);
  float xt = xoff + amp * sin(p.y * fq + hk * 30.0);
  float r = cw * mix(0.15, 0.26, hash1(hk * 91.7));
  vec2 d = vec2((fx - xd) * cw, p.y - yd);
  d.y *= 0.76;
  d.x *= 1.0 + 0.55 * smoothstep(0.0, r * 1.5, d.y);
  addDrop(d / r, 1.0, n, m, light);

  float above = p.y - yd;
  float dxTrail = (fx - xt) * cw;
  float tr = smoothstep(r * 0.6, r * 0.22, abs(dxTrail)) * smoothstep(0.0, r * 0.9, above) * smoothstep(0.55, 0.03, above);
  trail = max(trail, tr);
  float rr = r * 0.3 * smoothstep(0.6, 0.0, above);
  if (rr > 0.0005 && above > 0.0) {
    vec2 dd = vec2(dxTrail + (hash1(floor(above * 42.0) + hk * 9.0) - 0.5) * r * 0.35, (fract(above * 42.0) - 0.5) / 42.0);
    addDrop(dd / rr, smoothstep(0.03, 0.08, above) * smoothstep(0.5, 0.12, above), n, m, light);
  }
}

float flakes(vec2 p, float scale, float fall, float t, float seed, float size, float softness) {
  vec2 g = p * scale;
  g.y += t * fall;
  g.x += sin(t * 0.35 + g.y * 0.55 + seed) * 0.38 + t * 0.08;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash2(id + seed);
  if (h < 0.32) return 0.0;
  vec2 c = (vec2(hash2(id + seed + 3.1), hash2(id + seed + 5.9)) - 0.5) * 0.64;
  float r = size * mix(0.55, 1.0, hash2(id + seed + 7.7));
  return smoothstep(r, r * softness, length(f - c));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  float t = uTime;
  vec3 col;

  if (uKind == 0) {
    vec2 n = vec2(0.0);
    float m = 0.0;
    float light = 0.0;
    float trail = 0.0;
    runners(p, 9.0, t, 0.0, n, m, light, trail);
    if (uLayers > 1) runners(p + vec2(0.37, 0.0), 15.0, t * 1.12 + 40.0, 5.0, n, m, light, trail);
    float keep = 1.0 - trail;
    beads(p, 24.0, t, 1.0, keep, n, m, light);
    if (uLayers > 1) {
      beads(p + 3.1, 47.0, t, 2.0, keep, n, m, light);
      beads(p + 7.3, 12.0, t * 0.6, 3.0, keep, n, m, light);
    }
    m = clamp(m, 0.0, 1.0);
    col = soft(uv, uBlur * (1.0 - 0.72 * trail)) * (1.0 + 0.1 * trail);
    vec2 ruv = uv - n * vec2(1.0 / asp, 1.0) * 0.07;
    col = mix(col, sharp(ruv) * 1.12, m);
    col *= 1.0 + min(light, 0.0);
    col += max(light, 0.0) * vec3(0.86, 0.93, 1.0) * 0.4;
  } else if (uKind == 1) {
    // 边缘的霜：噪声阈值随场景时间慢慢向内长
    float edge = min(min(uv.x, 1.0 - uv.x) * asp, min(uv.y, 1.0 - uv.y));
    float grow = 0.022 + 0.085 * (1.0 - exp(-uSceneTime / 40.0));
    float frostNoise = fbm(p * 9.0) * 0.55 + vnoise(p * 46.0) * 0.3 + vnoise(p * 140.0) * 0.15;
    float frost = smoothstep(grow, grow * 0.15, edge + (frostNoise - 0.5) * grow * 1.7);
    col = soft(uv, uBlur * (1.0 + 0.5 * frost));
    float far = flakes(p, 26.0, 1.3, t, 11.0, 0.085, 0.3);
    float mid = flakes(p, 13.0, 1.5, t, 23.0, 0.105, 0.35);
    float near = uLayers > 1 ? flakes(p, 5.5, 1.25, t, 37.0, 0.16, 0.05) : 0.0;
    col += vec3(0.86, 0.91, 1.0) * (far * 0.42 + mid * 0.7 + near * 0.34);
    float crystal = 0.5 + 0.3 * vnoise(p * 120.0) + 0.2 * vnoise(p * 300.0);
    col = mix(col, vec3(0.78, 0.87, 0.98) * crystal, frost * 0.5);
  } else if (uKind == 2) {
    // 整块起雾的玻璃；uTrail 里是手指擦过的痕迹
    float wipe = smoothstep(0.04, 0.55, texture(uTrail, uv).r);
    float density = fbm(p * 2.6 + vec2(0.0, t * 0.012));
    vec3 fogged = mix(soft(uv, uBlur), vec3(0.75, 0.8, 0.85), 0.26 + 0.2 * density);
    fogged *= 0.9 + 0.1 * smoothstep(0.0, 0.5, uv.y);
    fogged += (pixelHash(floor(gl_FragCoord.xy / 2.0), 0.0) - 0.5) * 0.02;
    vec3 wiped = soft(uv, 0.1) * 0.94;
    col = mix(fogged, wiped, wipe);
    col += wipe * (1.0 - wipe) * 0.22 * vec3(0.9, 0.95, 1.0);
  } else if (uKind == 3) {
    // 画面下半部分的热浪
    float haze = smoothstep(0.6, 0.06, uv.y);
    vec2 huv = uv + haze * vec2(
      sin(uv.y * 115.0 - t * 3.1) * 0.0038 + sin(uv.y * 39.0 + t * 1.7) * 0.003,
      sin(uv.x * 31.0 + t * 2.2) * 0.0026);
    col = soft(huv, uBlur * (1.0 + 0.5 * haze));
  } else if (uKind == 4) {
    // 空气里的浮尘，越靠近光束越亮
    col = soft(uv, uBlur);
    float dust = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 g = p * (15.0 + fi * 12.0) + vec2(t * (0.05 + fi * 0.03), -t * (0.035 + fi * 0.02)) + fi * 13.7;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash2(id + fi * 3.3);
      vec2 c = (vec2(h, hash2(id + 9.1 + fi)) - 0.5) * 0.7;
      c += 0.08 * vec2(sin(t * 0.6 + h * 30.0), cos(t * 0.5 + h * 17.0));
      float r = mix(0.035, 0.075, hash2(id + 4.4));
      float twinkle = 0.55 + 0.45 * sin(t * 1.3 + h * 40.0);
      dust += smoothstep(r, r * 0.2, length(f - c)) * step(0.55, h) * twinkle * (1.0 - fi * 0.35);
    }
    float inBeam = smoothstep(1.9, 0.3, length(p - vec2(-0.12, 1.14)));
    col += vec3(1.0, 0.97, 0.88) * dust * (0.18 + 0.5 * inBeam);
  } else {
    col = soft(uv, uBlur);
  }

  // 调色：暗角 + 颗粒
  vec2 vc = (uv - 0.5) * vec2(1.05, 1.0);
  float vig = smoothstep(0.95, 0.25, length(vc));
  col *= mix(1.0, 0.35 + 0.65 * vig, uVignette);
  col += (pixelHash(gl_FragCoord.xy, floor(t * 24.0)) - 0.5) * uGrain;
  outColor = vec4(clamp(col, 0.0, 1.0), uAlpha);
}`;

  const TRAIL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uActive;
uniform float uDecay;
uniform float uAspect;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float value = max(texture(uPrev, uv).r - uDecay, 0.0);
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 a = vec2(uFrom.x * uAspect, uFrom.y);
  vec2 b = vec2(uTo.x * uAspect, uTo.y);
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float dist = length(p - a - ab * h);
  float brush = smoothstep(0.075, 0.03, dist) * uActive;
  outColor = vec4(vec3(max(value, brush)), 1.0);
}`;

  // 预留给 scene.image（D5：以后换成模糊过的实拍图）：把图片按 cover 方式铺进底图 FBO
  const IMAGE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uRes;
uniform float uImageAspect;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 scale = asp > uImageAspect ? vec2(1.0, uImageAspect / asp) : vec2(asp / uImageAspect, 1.0);
  vec2 iuv = (uv - 0.5) * scale + 0.5;
  outColor = vec4(texture(uImage, vec2(iuv.x, 1.0 - iuv.y)).rgb, 1.0);
}`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`scene shader compile failed: ${log}`);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource, uniformNames) {
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`scene program link failed: ${log}`);
    }
    const uniforms = {};
    uniformNames.forEach(name => { uniforms[name] = gl.getUniformLocation(program, name); });
    return { program, uniforms };
  }

  function createTarget(gl, mipmapped) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    return { texture, framebuffer, width: 0, height: 0 };
  }

  function resizeTarget(gl, target, width, height) {
    if (target.width === width && target.height === height) return false;
    target.width = width;
    target.height = height;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  function createSceneRenderer(canvas, options = {}) {
    const dprCap = options.dprCap || 1;
    const staticFrame = Boolean(options.staticFrame);
    let gl = null;
    try {
      gl = canvas && canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'low-power', preserveDrawingBuffer: false,
      });
    } catch (_error) {
      gl = null;
    }
    if (!gl) return null;

    let programs;
    try {
      programs = {
        base: createProgram(gl, VERTEX, BASE_FRAGMENT, [
          'uRes', 'uTime', 'uColorA', 'uColorB', 'uBokeh', 'uBokehCount', 'uBokehAmt', 'uIntensity', 'uGradient', 'uKind',
        ]),
        composite: createProgram(gl, VERTEX, COMPOSITE_FRAGMENT, [
          'uBase', 'uTrail', 'uRes', 'uBaseRes', 'uTime', 'uSceneTime', 'uBlur', 'uGrain', 'uVignette', 'uAlpha', 'uKind', 'uLayers',
        ]),
        trail: createProgram(gl, VERTEX, TRAIL_FRAGMENT, ['uPrev', 'uSize', 'uFrom', 'uTo', 'uActive', 'uDecay', 'uAspect']),
        image: createProgram(gl, VERTEX, IMAGE_FRAGMENT, ['uImage', 'uRes', 'uImageAspect']),
      };
    } catch (error) {
      if (typeof console !== 'undefined') console.warn(error.message);
      return null;
    }

    const vao = gl.createVertexArray();
    const base = createTarget(gl, true);
    const trails = [createTarget(gl, false), createTarget(gl, false)];
    let trailIndex = 0;
    let trailDirty = false;

    const startedAt = performance.now();
    const pointer = { x: 0.5, y: 0.5, lastX: 0.5, lastY: 0.5, active: false, wasActive: false };
    let current = null;
    let previous = null;
    let transition = null;
    let raf = 0;
    let paused = false;
    let destroyed = false;
    let lastFrameAt = 0;
    let quality = 0;
    let slowFrames = 0;
    let warmupFrames = 60;
    let fogDecayDebt = 0;
    let firstFrameDone = false;
    const frameTimes = [];

    function prepareScene(visual) {
      const colors = new Float32Array(MAX_BOKEH_COLORS * 3);
      const list = (visual.bokehColors || []).slice(0, MAX_BOKEH_COLORS);
      list.forEach((color, index) => colors.set(color, index * 3));
      const scene = {
        visual,
        kind: KIND[visual.weather] ?? KIND.cloudy,
        bokehColors: colors,
        bokehCount: Math.max(1, list.length),
        startedAt: performance.now(),
        image: null,
      };
      if (visual.image) loadImage(scene, visual.image);
      return scene;
    }

    function loadImage(scene, url) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (destroyed) return;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        scene.image = { texture, aspect: image.naturalWidth / Math.max(1, image.naturalHeight) };
        requestRender();
      };
      image.src = url;
    }

    function releaseScene(scene) {
      if (scene?.image) gl.deleteTexture(scene.image.texture);
    }

    function resize() {
      const scale = RENDER_SCALES[quality];
      const ratio = Math.min(window.devicePixelRatio || 1, dprCap) * scale;
      const width = Math.max(2, Math.round((canvas.clientWidth || window.innerWidth) * ratio));
      const height = Math.max(2, Math.round((canvas.clientHeight || window.innerHeight) * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      resizeTarget(gl, base, Math.max(2, width >> 1), Math.max(2, height >> 1));
      const trailWidth = Math.max(2, width >> 2);
      const trailHeight = Math.max(2, height >> 2);
      trails.forEach(target => resizeTarget(gl, target, trailWidth, trailHeight));
    }

    function usesFog() {
      return current?.kind === KIND.fog || previous?.kind === KIND.fog;
    }

    function updateTrail(dt) {
      const fog = usesFog();
      if (!fog && !trailDirty) return;
      let decay = 1;
      if (fog) {
        // 8 位纹理：把衰减量攒够 1/255 再扣，否则高刷新率下会被舍入掉、雾永远回不来
        fogDecayDebt += dt / FOG_REFORM_SECONDS;
        const steps = Math.floor(fogDecayDebt * 255);
        decay = steps / 255;
        fogDecayDebt -= decay;
      }
      const drawing = fog && pointer.active;
      const source = trails[trailIndex];
      const target = trails[1 - trailIndex];
      const { program, uniforms } = programs.trail;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform1i(uniforms.uPrev, 0);
      gl.uniform2f(uniforms.uSize, target.width, target.height);
      const fromX = pointer.wasActive ? pointer.lastX : pointer.x;
      const fromY = pointer.wasActive ? pointer.lastY : pointer.y;
      gl.uniform2f(uniforms.uFrom, fromX, 1 - fromY);
      gl.uniform2f(uniforms.uTo, pointer.x, 1 - pointer.y);
      gl.uniform1f(uniforms.uActive, drawing ? 1 : 0);
      gl.uniform1f(uniforms.uDecay, decay);
      gl.uniform1f(uniforms.uAspect, target.width / target.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      trailIndex = 1 - trailIndex;
      trailDirty = fog;
      pointer.lastX = pointer.x;
      pointer.lastY = pointer.y;
      pointer.wasActive = drawing;
    }

    function drawScene(scene, alpha, seconds, now) {
      const { visual } = scene;
      gl.bindFramebuffer(gl.FRAMEBUFFER, base.framebuffer);
      gl.viewport(0, 0, base.width, base.height);
      gl.disable(gl.BLEND);
      if (scene.image) {
        const { program, uniforms } = programs.image;
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, scene.image.texture);
        gl.uniform1i(uniforms.uImage, 0);
        gl.uniform2f(uniforms.uRes, base.width, base.height);
        gl.uniform1f(uniforms.uImageAspect, scene.image.aspect);
      } else {
        const { program, uniforms } = programs.base;
        gl.useProgram(program);
        gl.uniform2f(uniforms.uRes, base.width, base.height);
        gl.uniform1f(uniforms.uTime, seconds);
        gl.uniform3fv(uniforms.uColorA, visual.colorA);
        gl.uniform3fv(uniforms.uColorB, visual.colorB);
        gl.uniform3fv(uniforms.uBokeh, scene.bokehColors);
        gl.uniform1i(uniforms.uBokehCount, scene.bokehCount);
        gl.uniform1f(uniforms.uBokehAmt, visual.bokeh ?? 0.5);
        gl.uniform1f(uniforms.uIntensity, visual.intensity ?? 0.6);
        gl.uniform1f(uniforms.uGradient, visual.gradient ?? 0);
        gl.uniform1i(uniforms.uKind, scene.kind);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, base.texture);
      gl.generateMipmap(gl.TEXTURE_2D);

      const { program, uniforms } = programs.composite;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, base.texture);
      gl.uniform1i(uniforms.uBase, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, trails[trailIndex].texture);
      gl.uniform1i(uniforms.uTrail, 1);
      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform2f(uniforms.uBaseRes, base.width, base.height);
      gl.uniform1f(uniforms.uTime, seconds);
      gl.uniform1f(uniforms.uSceneTime, staticFrame ? 60 : (now - scene.startedAt) / 1000);
      gl.uniform1f(uniforms.uBlur, visual.blur ?? 0.6);
      gl.uniform1f(uniforms.uGrain, visual.grain ?? 0.04);
      gl.uniform1f(uniforms.uVignette, visual.vignette ?? 0.4);
      gl.uniform1f(uniforms.uAlpha, alpha);
      gl.uniform1i(uniforms.uKind, scene.kind);
      gl.uniform1i(uniforms.uLayers, quality >= 1 ? 1 : 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }

    function trackPerformance(frameMs) {
      if (frameMs > 250) { slowFrames = 0; return; }
      frameTimes.push(frameMs);
      if (frameTimes.length > 180) frameTimes.shift();
      if (warmupFrames > 0) { warmupFrames -= 1; return; }
      slowFrames = frameMs > SLOW_FRAME_MS ? slowFrames + 1 : 0;
      if (slowFrames >= SLOW_FRAMES_TO_DOWNGRADE && quality < MAX_QUALITY_LEVEL) {
        // 自动降一档：先减少雨滴/雪花层数，再降低渲染分辨率
        quality += 1;
        slowFrames = 0;
        warmupFrames = 30;
      }
    }

    function render(now) {
      if (destroyed || !current || gl.isContextLost()) return;
      const dt = lastFrameAt ? Math.min(0.1, (now - lastFrameAt) / 1000) : 1 / 60;
      if (!staticFrame && lastFrameAt) trackPerformance(now - lastFrameAt);
      lastFrameAt = now;
      resize();
      gl.bindVertexArray(vao);
      const seconds = staticFrame ? 12 : (now - startedAt) / 1000;
      updateTrail(staticFrame ? 0 : dt);

      let progress = 1;
      if (transition) {
        progress = Math.min(1, (now - transition.startedAt) / transition.duration);
        if (progress >= 1) {
          releaseScene(previous);
          previous = null;
          transition = null;
        }
      }
      if (previous) {
        drawScene(previous, 1, seconds, now);
        const eased = progress * progress * (3 - 2 * progress);
        drawScene(current, Math.max(0.001, eased), seconds, now);
      } else {
        drawScene(current, 1, seconds, now);
      }
    }

    function tick(now) {
      raf = 0;
      render(now);
      if (!firstFrameDone && current) {
        firstFrameDone = true;
        options.onFirstFrame?.();
      }
      if (!staticFrame || transition) schedule();
    }

    function schedule() {
      if (raf || paused || destroyed || document.hidden) return;
      raf = requestAnimationFrame(tick);
    }

    function requestRender() {
      lastFrameAt = staticFrame ? 0 : lastFrameAt;
      schedule();
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrameAt = 0;
    }

    function onVisibility() {
      if (document.hidden) stop();
      else schedule();
    }

    function onContextLost(event) {
      event.preventDefault();
      stop();
      destroyed = true;
      options.onContextLost?.();
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', requestRender);
    canvas.addEventListener('webglcontextlost', onContextLost);

    return {
      setScene(visual, { transitionMs = 900 } = {}) {
        if (destroyed || !visual) return;
        const next = prepareScene(visual);
        if (current && transitionMs > 0 && !staticFrame) {
          // 过渡中途再切换：直接丢掉更早的那一层，从当前画面淡到新场景
          releaseScene(previous);
          previous = current;
          transition = { startedAt: performance.now(), duration: transitionMs };
        } else {
          releaseScene(previous);
          releaseScene(current);
          previous = null;
          transition = null;
        }
        current = next;
        requestRender();
      },
      setPointer(x, y, active) {
        if (active) {
          pointer.x = Math.min(1, Math.max(0, x));
          pointer.y = Math.min(1, Math.max(0, y));
        }
        pointer.active = Boolean(active);
      },
      setPaused(value) {
        paused = Boolean(value);
        if (paused) stop();
        else schedule();
      },
      stats() {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        return {
          quality,
          renderScale: RENDER_SCALES[quality],
          running: Boolean(raf),
          medianFrameMs: sorted.length ? sorted[sorted.length >> 1] : null,
          size: [canvas.width, canvas.height],
        };
      },
      destroy() {
        stop();
        destroyed = true;
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', requestRender);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        releaseScene(previous);
        releaseScene(current);
        [base, ...trails].forEach(target => {
          gl.deleteTexture(target.texture);
          gl.deleteFramebuffer(target.framebuffer);
        });
        Object.values(programs).forEach(entry => gl.deleteProgram(entry.program));
        gl.deleteVertexArray(vao);
      },
    };
  }

  return { createSceneRenderer, KIND };
}));
