// 子宫像素图的绘制层：把 computeUterusLayout 的结果画到 96×120 的画布上。
// 画法沿用 Sol 6 试作。只画、不算版面；动画以每 180 毫秒一帧推进，
// 只在画面可见时跑，系统设定减少动态效果或关闭动画时只画静态图。
import { buildFetusGrid, hasFluidSac, membraneLevel } from './fetus_sprite.js';
import { quantizeAngle, UTERUS_CANVAS, wombRadius } from './uterus_layout.js';

const BASE_PALETTE = Object.freeze({
  bg: '#1c1726', void: '#140f1b', frame: '#47283d', wallDark: '#803b58', wall: '#c85f78', wallLight: '#ee9290',
  wallTense: '#ec586d', shine: '#ffd0a4', cavity: '#672d51', cavityDeep: '#421d3d', fluid: '#b980aa',
  fluidLight: '#e5adc9', water: '#a5c9de', waterLight: '#e4f5f1', sac: '#ffd0b0', shadow: '#72455f',
  fetus: '#f8ae96', fetusLight: '#ffe0ad', egg: '#f8d9b0', eggShade: '#ae778c', signal: '#ffe27d',
  blood: '#b94460', lining: '#f3a891', ovaryHot: '#ae4557', ovaryGlow: '#ffd079',
});

const FRAME_MS = 180;
const CUE_MS = 2400;
export const EMOTE_MS = 1400;
const RUPTURE_MS = 2800;

function hexToRgb(hex) {
  const value = String(hex || '').trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

export function mixColor(from, to, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return `#${a.map((v, i) => Math.round(v * (1 - t) + b[i] * t).toString(16).padStart(2, '0')).join('')}`;
}

/** 读 CSS 的颜色字串（#rgb、#rrggbb、rgb()、rgba()）；半透明的叠在黑底上当成实色 */
function parseCssColor(value) {
  const text = String(value || '').trim();
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const alpha = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
    return `#${[r, g, b].map((v) => Math.round((Number(v) || 0) * alpha).toString(16).padStart(2, '0')).join('')}`;
  }
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) ? text : null;
}

// 配色选项 C：子宫与胎儿维持肉色，往主题的代表色偏；背景、刻度直接由代表色调出来。
// 代表色取萤幕、文字、边框三者里最饱和的一个：浅色主题的萤幕近乎白，色相其实在文字色上（例如 sakura 的深粉）。
// 胎儿、卵、胎囊只偏一半，保持好认；警示黄与羊水不偏
const FLESH_TINT = 0.16;
const FETUS_TINT = 0.08;
const FETUS_KEYS = new Set(['fetus', 'fetusLight', 'egg', 'eggShade', 'sac']);
const FIXED_KEYS = new Set(['signal', 'water', 'waterLight']);

function chromaOf(hex) {
  const rgb = hexToRgb(hex);
  return Math.max(...rgb) - Math.min(...rgb);
}

/** 保留色相、把最亮的通道缩放到 level，得到亮度一致的颜色 */
function toBrightness(hex, level) {
  const rgb = hexToRgb(hex);
  const top = Math.max(1, ...rgb);
  return `#${rgb.map((v) => Math.round((v * level) / top).toString(16).padStart(2, '0')).join('')}`;
}

function pickThemeHue(theme) {
  const candidates = [theme.screen, theme.text, theme.border].map(parseCssColor).filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, color) => (chromaOf(color) > chromaOf(best) ? color : best));
}

/**
 * 各主题自己的子宫配色，对应主题的创作背景。只给几组锚点，其余颜色由 themedPalette 推出：
 * flesh 宫壁（暗、中、亮）、cavity 宫腔（底、深）、fetus 胎儿（底、亮、高光）、egg 卵（壳、暗面）、
 * membrane 膜线（底、亮）、sac 胎囊、blood 经血与充血、glow 卵巢发光；ink 是眼睛与斑纹的线色，
 * signal 覆盖警示色，brush 开启水墨的笔触后处理。仿真与废土本来就是单色萤幕，走单色调；iPhone 走肉色写实
 */
const THEME_WOMB_PALETTES = Object.freeze({
  // 修仙：玉器。深绿碧玉的宫壁、羊脂白玉的胎儿、金镶玉的膜，经血用朱砂
  cultivation: {
    bg: '#10261f', void: '#0a1a15', tick: '#4db6ac',
    flesh: ['#245842', '#4f8f6f', '#94c7a6'], cavity: ['#173a30', '#0e271f'],
    fetus: ['#e6ecd6', '#f6f7ec', '#ffffff'], egg: ['#dfe8cf', '#86ad93'],
    membrane: ['#c8a94f', '#f0dca0'], sac: '#a8d8c0', blood: '#b8392f', glow: '#f0dca0', ink: '#2f5d49',
  },
  // 奇幻：羊皮卷手抄本。皮革与棕红墨的宫壁、羊皮纸的胎儿、金箔的膜
  fantasy: {
    bg: '#2b1d14', void: '#1a110b', tick: '#c9a25a',
    flesh: ['#5e2a20', '#9c4a36', '#d4886a'], cavity: ['#3a2619', '#26170e'],
    fetus: ['#f2e2bf', '#fbf1d9', '#fffaf0'], egg: ['#efdcb2', '#8b6a3e'],
    membrane: ['#d4af37', '#f5dc8a'], sac: '#b89a6a', blood: '#8b1e1e', glow: '#f5dc8a', ink: '#4a2c1a',
  },
  // 埃及（赛博 2077）：黄蓝霓虹。金黄的宫壁、青色发光的胎儿与膜、深海军蓝的宫腔；警示改桃红，免得撞宫壁的黄
  'cyber-egypt': {
    bg: '#06121f', void: '#030a12', tick: '#00f2ff',
    flesh: ['#7a5a00', '#d4af37', '#fce94f'], cavity: ['#0a2238', '#051626'],
    fetus: ['#7ff6ff', '#d8feff', '#ffffff'], egg: ['#d4f8ff', '#2e8fa3'],
    membrane: ['#00f2ff', '#a8fbff'], sac: '#00b8d4', blood: '#ff2a6d', glow: '#fcee0a', ink: '#003a45', signal: '#ff2a6d',
  },
  // 樱花（翻盖机）：粉白软绵绵。淡粉的背景与宫腔、白胎儿配粉色阴影、玫瑰色的眼睛，整体低对比
  sakura: {
    bg: '#fff0f5', void: '#ffe1eb', tick: '#f48fb1',
    flesh: ['#ec7fa6', '#f7b3cb', '#fde1eb'], cavity: ['#f8c6d7', '#f2afc6'],
    fetus: ['#fffafc', '#ffffff', '#ffffff'], egg: ['#fff5f9', '#f3a2bf'],
    membrane: ['#c48bd8', '#ecd4f5'], sac: '#ffffff', blood: '#e91e63', glow: '#ffffff', ink: '#c2185b', signal: '#ffb300',
  },
  // 全息：青色投影，膜带洋红的虹彩
  holo: {
    bg: '#020d18', void: '#010710', tick: '#4adfff',
    flesh: ['#0a5a7a', '#1fa8d0', '#7fe8ff'], cavity: ['#04213a', '#021428'],
    fetus: ['#c8fbff', '#f2feff', '#ffffff'], egg: ['#bff6ff', '#3a8fb0'],
    membrane: ['#e27dff', '#ffc8ff'], sac: '#5ad8ff', blood: '#ff4fd8', glow: '#8df7ff', ink: '#0a4a66',
  },
  // 哥特：中二吸血鬼。黑底、血红天鹅绒的宫壁、苍白象牙的胎儿、红眼睛、银紫的膜
  gothic: {
    bg: '#0d0508', void: '#060204', tick: '#8f3f4b',
    flesh: ['#4a0d1a', '#8b1a2e', '#c43a4e'], cavity: ['#1a0610', '#0c0308'],
    fetus: ['#e9dde8', '#fbf4f7', '#ffffff'], egg: ['#e8dde6', '#6b2a44'],
    membrane: ['#b9a7c9', '#e6dcef'], sac: '#5c1f33', blood: '#b0001e', glow: '#ff3355', ink: '#c8102e',
  },
  // 蒸汽：黄铜机械。红铜的宫壁、黄铜象牙的胎儿、铜绿的膜
  steampunk: {
    bg: '#1d1510', void: '#120c08', tick: '#d1a85a',
    flesh: ['#5a2e18', '#a0552b', '#d98a4e'], cavity: ['#2a1c12', '#1a110b'],
    fetus: ['#f0d9a8', '#fbeccb', '#fff6e0'], egg: ['#e8cf9a', '#8a6a2d'],
    membrane: ['#3fa38a', '#8fd6c0'], sac: '#b88a3d', blood: '#8a1f12', glow: '#ffcf6b', ink: '#4a2f1f',
  },
  // 克系：触手。章鱼紫的宫壁、深渊青黑的宫腔、病态骨白偏绿的胎儿、生物萤光青的膜，经血是紫色体液
  eldritch: {
    bg: '#070b0a', void: '#030605', tick: '#68d6c2',
    flesh: ['#3b2240', '#6e3f78', '#b27ab8'], cavity: ['#0e2422', '#081614'],
    fetus: ['#cfe3c8', '#e9f5e2', '#f7fff2'], egg: ['#b9d8c6', '#3b5e57'],
    membrane: ['#68d6c2', '#b8fff0'], sac: '#2e5c54', blood: '#6a2360', glow: '#68d6c2', ink: '#1b3b36',
  },
  // 水墨：宣纸底、淡墨的宫腔、浓墨的宫壁，警示用朱砂；另外画完再做一次笔触处理（飞白与晕染）
  ink: {
    bg: '#f3ead8', void: '#e6dbc4', tick: '#1f2522',
    flesh: ['#1f2522', '#4b514c', '#8a8d86'], cavity: ['#dcd3bf', '#cbc2ab'],
    fetus: ['#faf6ec', '#ffffff', '#ffffff'], egg: ['#f6f0e2', '#8a8d86'],
    membrane: ['#5c6660', '#9aa39c'], sac: '#b9b3a2', blood: '#b23a2e', glow: '#b23a2e', ink: '#1f2522', signal: '#c0392b', brush: true,
  },
  // 建构：苏联构成主义海报。米色海报底、黑宫腔、红宫壁、米白胎儿，大块平涂
  constructivism: {
    bg: '#e2dccb', void: '#cfc7b2', tick: '#141414',
    flesh: ['#141414', '#b62525', '#e0584a'], cavity: ['#2a2a2a', '#141414'],
    fetus: ['#ece3cf', '#f7f1e3', '#ffffff'], egg: ['#ece3cf', '#8a8577'],
    membrane: ['#c9c3b3', '#ffffff'], sac: '#b62525', blood: '#b62525', glow: '#ece3cf', ink: '#141414',
  },
});

/** 从主题锚点推出整组色盘 */
function themedPalette(spec) {
  const [fleshDark, flesh, fleshLight] = spec.flesh;
  const [cavity, cavityDeep] = spec.cavity;
  const [fetus, fetusLight, shine] = spec.fetus;
  return {
    bg: spec.bg,
    void: spec.void,
    tick: spec.tick,
    frame: mixColor(fleshDark, '#000000', 0.35),
    wallDark: fleshDark,
    wall: flesh,
    wallLight: fleshLight,
    wallTense: mixColor(flesh, spec.blood, 0.45),
    shine,
    cavity,
    cavityDeep,
    fluid: mixColor(cavity, fleshLight, 0.45),
    fluidLight: mixColor(cavity, fetusLight, 0.6),
    water: spec.membrane[0],
    waterLight: spec.membrane[1],
    sac: spec.sac,
    shadow: mixColor(cavityDeep, fleshDark, 0.5),
    fetus,
    fetusLight,
    egg: spec.egg[0],
    eggShade: spec.egg[1],
    signal: spec.signal || BASE_PALETTE.signal,
    blood: spec.blood,
    lining: fleshLight,
    ovaryHot: spec.blood,
    ovaryGlow: spec.glow,
    ...(spec.ink ? { ink: spec.ink } : {}),
    ...(spec.brush ? { brush: true } : {}),
  };
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// 保留原色的项目：警示黄要一眼看得到，不跟着主题变单色
const RAMP_FIXED_KEYS = new Set(['signal']);
// 代表色彩度低于这个值（近乎黑白的主题）就改用灰阶
const RAMP_GRAY_CHROMA = 40;

/**
 * 单色调配色：每个颜色依亮度对应到主题代表色的一条明暗色阶（最暗 → 代表色中间调 → 最浅的淡色），
 * 亮暗关系不变，所以胎儿、宫壁、羊水泡、卵壳仍分得开，整张图变成同一个色系（像 Game Boy）
 */
function rampPalette(hue) {
  const base = chromaOf(hue) < RAMP_GRAY_CHROMA ? '#8c8c8c' : hue;
  const dark = toBrightness(base, 34);
  const mid = toBrightness(base, 176);
  const light = mixColor(toBrightness(base, 255), '#ffffff', 0.72);
  const palette = {};
  for (const [key, color] of Object.entries(BASE_PALETTE)) {
    if (RAMP_FIXED_KEYS.has(key)) {
      palette[key] = color;
      continue;
    }
    const t = Math.max(0, Math.min(1, (luminance(color) - 0.06) / 0.86));
    palette[key] = t < 0.5 ? mixColor(dark, mid, t / 0.5) : mixColor(mid, light, (t - 0.5) / 0.5);
  }
  palette.bg = toBrightness(base, 46);
  palette.void = toBrightness(base, 26);
  palette.tick = toBrightness(base, 120);
  return palette;
}

/**
 * @param theme { name, screen, text, border }：主题名与当下的 --bsbt-lcd-bg、--bsbt-lcd-text、--bsbt-border-color。
 *        有专属配色的主题用 THEME_WOMB_PALETTES；仿真、废土这类单色萤幕整张换成代表色的单色调；
 *        iPhone 维持肉色的写实配色（只往代表色轻微偏）。给不出颜色时退回原本的深紫肉色配色
 */
export function getUterusPalette(theme = {}) {
  if (THEME_WOMB_PALETTES[theme.name]) return themedPalette(THEME_WOMB_PALETTES[theme.name]);
  const hue = pickThemeHue(theme);
  if (hue && theme.name && theme.name !== 'iphone') return rampPalette(hue);
  const palette = {};
  for (const [key, color] of Object.entries(BASE_PALETTE)) {
    const amount = !hue || FIXED_KEYS.has(key) ? 0 : FETUS_KEYS.has(key) ? FETUS_TINT : FLESH_TINT;
    palette[key] = amount ? mixColor(color, hue, amount) : color;
  }
  palette.tick = BASE_PALETTE.wallDark;
  if (hue) {
    palette.bg = toBrightness(hue, 46);
    palette.void = toBrightness(hue, 26);
    palette.tick = toBrightness(hue, 120);
  }
  return palette;
}

// ---- 水墨笔触：整张画完后再处理一次 ----
// 飞白：浓墨像素贴着浅色的地方，按固定规律掉成纸色，像干笔擦过；
// 晕染：紧贴浓墨的浅色像素往墨色渗一点。规律只看座标，每帧相同，不会闪
function inkBrush(ctx, P) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  const lum = (i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  const dark = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) dark[p] = lum(p * 4) < 0.4 ? 1 : 0;
  const paper = hexToRgb(P.bg);
  const ink = hexToRgb(P.ink || '#1f2522');
  const noise = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      const near = (dx, dy) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < width && ny < height ? dark[ny * width + nx] : 0;
      };
      const darkNeighbors = near(1, 0) + near(-1, 0) + near(0, 1) + near(0, -1);
      if (dark[p]) {
        // 笔画边缘（有浅色邻居）才会飞白
        if (darkNeighbors < 4 && noise(x, y) < 0.22) {
          d[i] = Math.round(d[i] * 0.3 + paper[0] * 0.7);
          d[i + 1] = Math.round(d[i + 1] * 0.3 + paper[1] * 0.7);
          d[i + 2] = Math.round(d[i + 2] * 0.3 + paper[2] * 0.7);
        }
      } else if (darkNeighbors > 0 && noise(y, x) < 0.5) {
        const t = 0.12 * darkNeighbors;
        d[i] = Math.round(d[i] * (1 - t) + ink[0] * t);
        d[i + 1] = Math.round(d[i + 1] * (1 - t) + ink[1] * t);
        d[i + 2] = Math.round(d[i + 2] * (1 - t) + ink[2] * t);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

// ---- 像素小字：数字、+、! 用 3×5 点阵，不用 fillText（会被抗锯齿糊掉） ----
const GLYPHS = Object.freeze({
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], '+': ['000', '010', '111', '010', '000'], '!': ['010', '010', '010', '000', '010'],
});

// ---- 性别像素图标（8×8），给胎儿卡用 ----
const GENDER_ICONS = Object.freeze({
  男: ['....####', '......##', '.....#.#', '.###.#..', '#...#...', '#...#...', '#...#...', '.###....'],
  女: ['..###...', '.#...#..', '.#...#..', '.#...#..', '..###...', '...#....', '.#####..', '...#....'],
  双: ['.#...#..', '.##.##..', '..###...', '.#...#..', '.#...#..', '..###...', '...#....', '.#####..'],
  无: ['..###...', '.#..##..', '.#.#.#..', '.##..#..', '..###...', '........', '........', '........'],
});

export function drawGenderIcon(canvas, gender, color = '#ffd0a4') {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rows = GENDER_ICONS[String(gender || '').trim()] || GENDER_ICONS.无;
  ctx.fillStyle = color;
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') ctx.fillRect(x, y, 1, 1); }));
}

/** 画笔：所有座标取整，只用填色矩形 */
function makePen(ctx, P) {
  const px = (x, y, w = 1, h = 1, color = P.wall) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    ctx.fillStyle = color;
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y += 1) {
      const q = 1 - ((y - cy) / ry) ** 2;
      if (q < 0) continue;
      const hw = Math.floor(rx * Math.sqrt(q));
      ctx.fillRect(Math.round(cx - hw), y, hw * 2 + 1, 1);
    }
  };
  const line = (x0, y0, x1, y1, color) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let guard = 0; guard < 400; guard += 1) {
      px(x0, y0, 1, 1, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  };
  const ring = (cx, cy, rx, ry, color, skip = null) => {
    for (let a = 0; a < 360; a += 3) {
      if (skip && a > skip[0] && a < skip[1]) continue;
      const r = (a * Math.PI) / 180;
      px(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry, 1, 1, color);
    }
  };
  const glyphs = (text, x, y, color) => {
    [...String(text)].forEach((ch, i) => {
      const rows = GLYPHS[ch];
      if (!rows) return;
      rows.forEach((row, dy) => [...row].forEach((c, dx) => { if (c === '1') px(x + i * 4 + dx, y + dy, 1, 1, color); }));
    });
  };
  return { px, ellipse, line, ring, glyphs };
}

// ---- 胎儿、卵与不定型都由 fetus_sprite.js 栅格化成色调代号，这里只负责上色与快取 ----

/** 色调代号 → 主题颜色；没有外框，只靠色调分部件 */
function fetusTones(P) {
  return {
    head: mixColor(P.fetus, P.fetusLight, 0.55),
    body: P.fetus,
    shade: mixColor(P.fetus, P.wallDark, 0.3),
    cord: mixColor(P.fetus, P.fetusLight, 0.35),
    face: P.ink || mixColor(P.fetus, P.cavityDeep, 0.7),
    shell: P.eggShade,
    shellLight: P.egg,
    gap: P.cavity,
    // 整颗卵的壳（碎壳与成形中的壳另用 shell）
    eggShell: P.egg,
    shellShade: mixColor(P.egg, P.eggShade, 0.45),
    yolk: mixColor(P.fetusLight, P.signal, 0.4),
    ghost: mixColor(P.egg, P.eggShade, 0.32),
    speck: P.ink ? mixColor(P.eggShade, P.ink, 0.4) : mixColor(P.egg, P.eggShade, 0.6),
    shine: mixColor(P.egg, '#ffffff', 0.55),
    // 不定型
    blob: mixColor(P.fetus, P.wall, 0.4),
    blobShade: mixColor(mixColor(P.fetus, P.wall, 0.4), P.wallDark, 0.35),
    core: mixColor(P.fetusLight, P.shine, 0.3),
    // 胎转卵生：蛋壳上的结晶格；硬化后贴在蛋上的羊膜（蒙在殼上的膜色与外缘膜线，与羊水囊膜线同色）
    lattice: mixColor(P.eggShade, P.water, 0.3),
    eggFilm: mixColor(P.egg, P.water, 0.3),
    filmShade: mixColor(mixColor(P.egg, P.water, 0.3), P.eggShade, 0.45),
    membrane: mixColor(P.water, P.cavity, 0.2),
    membraneThin: mixColor(P.water, P.cavity, 0.55),
  };
}

const FETUS_CACHE_LIMIT = 160;

/**
 * 图块快取：依大小、方向、镜像、朝向、挤压、贴卵羊膜与空隙色直接栅格化，
 * 回传 { canvas, anchorX, anchorY, bounds }，画的时候不再旋转缩放
 */
function createSpriteCache(P) {
  const fetal = new Map();
  const tones = fetusTones(P);
  return {
    fetus(spec) {
      const gap = spec.gap || tones.gap;
      const key = [spec.type, spec.stage, spec.height, spec.angle, spec.mirror ? 1 : 0, spec.posterior ? 1 : 0, spec.squeeze.toFixed(2), membraneLevel(spec.membrane), spec.nestedHost ? 1 : 0, gap].join('|');
      if (!fetal.has(key)) {
        if (fetal.size >= FETUS_CACHE_LIMIT) fetal.clear();
        const grid = buildFetusGrid(spec);
        const off = document.createElement('canvas');
        off.width = grid.width;
        off.height = grid.height;
        const ctx = off.getContext('2d');
        const filled = (x, y) => Boolean(grid.cells[y]?.[x]);
        const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        grid.cells.forEach((row, y) => row.forEach((tone, x) => {
          if (tone) {
            ctx.fillStyle = tones[tone];
            ctx.fillRect(x, y, 1, 1);
            box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
            box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
          } else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
            // 一圈与背景同色的空隙：在底色上看不出来，叠到别的胎儿上时切出一道缝，多胎才分得开。
            // 背景是羊膜囊时用羊水色，孕早还没有囊或已破水时用宫腔色
            ctx.fillStyle = gap;
            ctx.fillRect(x, y, 1, 1);
          }
        }));
        // 本体范围（相对于锚点），羊膜囊依它贴合
        const bounds = { x0: box.x0 - grid.anchorX, y0: box.y0 - grid.anchorY, x1: box.x1 - grid.anchorX, y1: box.y1 - grid.anchorY };
        fetal.set(key, { canvas: off, anchorX: grid.anchorX, anchorY: grid.anchorY, bounds });
      }
      return fetal.get(key);
    },
  };
}

/** 胎儿本体的像素高度：layout 的 size 以 32 格图块为基准 */
function fetusHeightFor(size) {
  return Math.max(6, Math.round((32 * size) / 10 * 0.66));
}

// ---- 亲和特效：只在胎儿详细点缩图时，在缩图里的胎儿头上冒出像素表情 ----
const EMOTE_ICONS = Object.freeze({
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  sparkle: ['..#..', '..#..', '#####', '..#..', '..#..'],
  drop: ['..#..', '.###.', '#####', '#####', '.###.'],
  anger: ['.#.#.', '##.##', '.....', '##.##', '.#.#.'],
  dot: ['##', '##'],
});

const EMOTE_COLORS = Object.freeze({ heart: '#ff6f9c', sparkle: '#ffe27d', drop: '#7fc4ff', anger: '#e8323c', dot: '#ffffff' });

function stamp(ctx, name, x, y) {
  const rows = EMOTE_ICONS[name];
  ctx.fillStyle = EMOTE_COLORS[name];
  const ox = Math.round(x - rows[0].length / 2);
  const oy = Math.round(y - rows.length / 2);
  rows.forEach((row, dy) => [...row].forEach((c, dx) => { if (c === '#') ctx.fillRect(ox + dx, oy + dy, 1, 1); }));
}

/**
 * 画一格亲和特效。(x, y) 是胎儿头顶，t 是 0～1 的播放进度。
 * 依恋：三颗爱心往上飘；亲近：一颗爱心加闪光；平淡：「…」依序出现；疏离：汗滴滑下；排斥：怒筋闪动
 */
export function drawAffinityEmote(ctx, band, x, y, t) {
  const rise = Math.round(t * 6);
  if (band === 2) {
    [[-6, 0], [0, 0.18], [6, 0.36]].forEach(([dx, delay]) => {
      const local = t - delay;
      if (local < 0 || local > 0.8) return;
      stamp(ctx, 'heart', x + dx, y - 3 - Math.round(local * 10));
    });
  } else if (band === 1) {
    stamp(ctx, 'heart', x, y - 3 - rise);
    if (Math.floor(t * 8) % 2 === 0) stamp(ctx, 'sparkle', x + 6, y - 7 - rise);
  } else if (band === 0) {
    const shown = Math.min(3, Math.floor(t * 4) + 1);
    for (let i = 0; i < shown; i += 1) stamp(ctx, 'dot', x - 4 + i * 4, y - 4);
  } else if (band === -1) {
    stamp(ctx, 'drop', x + 5, y - 5 + Math.round(t * 5));
  } else if (Math.floor(t * 10) % 3 !== 2) {
    stamp(ctx, 'anger', x + 4, y - 4);
  }
}

/** 给胎儿详细画缩图（32×32）；emote 有值时在头顶叠一格亲和特效（排斥会让缩图轻微抖动） */
export function drawFetusThumb(canvas, sprite, angle, theme, emote = null) {
  const P = getUterusPalette(theme);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P.cavityDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const shake = emote && emote.band === -2 ? (Math.floor(emote.t * 12) % 2 ? 1 : -1) : 0;
  const cx = Math.round(canvas.width / 2 + shake);
  const cy = Math.round(canvas.height / 2 + (emote ? 3 : 0));
  const spec = { type: sprite.type, stage: sprite.stage, height: 20, angle: quantizeAngle(angle), mirror: Boolean(sprite.mirror), posterior: Boolean(sprite.posterior), squeeze: 1 };
  const { canvas: off, anchorX, anchorY } = createSpriteCache(P).fetus(spec);
  ctx.drawImage(off, cx - anchorX, cy - anchorY);
  if (emote) drawAffinityEmote(ctx, emote.band, canvas.width / 2, 9, emote.t);
}

// 亲和五级：≥25 依恋、5～24 亲近、-4～4 平淡、-24～-5 疏离、≤-25 排斥（-25 是病理性挤进入口的门槛）
export function getAffinityBand(affinity) {
  const value = Number(affinity) || 0;
  if (value >= 25) return 2;
  if (value >= 5) return 1;
  if (value > -5) return 0;
  if (value > -25) return -1;
  return -2;
}

export const AFFINITY_WORDS = Object.freeze({ 2: '依恋', 1: '亲近', 0: '平淡', '-1': '疏离', '-2': '排斥' });

/**
 * 建立一个子宫图绘制器。canvas 只在建立时设定尺寸一次。
 * @returns {{ setLayout, setTheme, playCue, setAnimated, destroy, canvas }}
 */
export function createUterusRenderer(canvas, { theme = {}, animated = true } = {}) {
  canvas.width = UTERUS_CANVAS.width;
  canvas.height = UTERUS_CANVAS.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  let P = getUterusPalette(theme);
  let pen = makePen(ctx, P);
  let spriteOf = createSpriteCache(P);
  let layout = null;
  let cue = null;
  let wantsAnimation = animated;
  let visible = true;
  let timer = 0;
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(tick = performance.now()) {
    if (!layout) return;
    const { px } = pen;
    px(0, 0, UTERUS_CANVAS.width, UTERUS_CANVAS.height, P.bg);
    drawUterus(tick);
    ctx.save();
    cavityPath();
    ctx.clip();
    drawFluid();
    drawEmptyStage();
    drawFetuses(tick);
    ctx.restore();
    drawFrontWall();
    drawMenstrualFlow(tick);
    drawSemenLeak(tick);
    drawObstruction(tick);
    drawCue(tick);
    // 刻度与超出显示数
    for (let i = 0; i < 8; i += 1) {
      px(4, 35 + i * 8, i % 2 ? 2 : 4, 1, P.tick);
      px(88, 35 + i * 8, i % 2 ? 2 : 4, 1, P.tick);
    }
    if (layout.hiddenCount > 0) pen.glyphs(`+${layout.hiddenCount}`, 80 - String(layout.hiddenCount).length * 4, 112, P.signal);
    if (P.brush) inkBrush(ctx, P);
  }

  function liningTone() {
    const { emptyStage, pressureLevel } = layout;
    if (!emptyStage) return pressureLevel >= 2 ? P.wallTense : P.wallLight;
    return { 月经期: P.blood, 卵泡期: P.wallLight, 排卵期: P.shine, 黄体期: P.lining, 产后恢复: P.blood, 假孕期: P.lining }[emptyStage] || P.wallLight;
  }

  function wallTone() {
    return layout.pressureLevel >= 2 ? P.wallTense : layout.pressureLevel >= 1 ? P.wallLight : P.wall;
  }

  function paintWomb(pad, shift, color) {
    const { womb } = layout;
    for (let y = Math.ceil(womb.cy + shift - womb.ry - pad); y <= Math.floor(womb.cy + shift + womb.ry + pad); y += 1) {
      const r = wombRadius(womb, y, pad, shift);
      if (r) pen.px(womb.cx - r, y, r * 2 + 1, 1, color);
    }
  }

  function outlineWomb(pad, shift, color) {
    const { womb } = layout;
    for (let y = Math.ceil(womb.cy + shift - womb.ry - pad); y <= Math.floor(womb.cy + shift + womb.ry + pad); y += 1) {
      const r = wombRadius(womb, y, pad, shift);
      if (r) { pen.px(womb.cx - r, y, 1, 1, color); pen.px(womb.cx + r, y, 1, 1, color); }
    }
  }

  function traceWomb(pad, shift) {
    const { womb } = layout;
    const top = Math.ceil(womb.cy + shift - womb.ry - pad);
    const bottom = Math.floor(womb.cy + shift + womb.ry + pad);
    ctx.moveTo(womb.cx, top);
    for (let y = top; y <= bottom; y += 1) ctx.lineTo(womb.cx - wombRadius(womb, y, pad, shift), y);
    for (let y = bottom; y >= top; y -= 1) ctx.lineTo(womb.cx + wombRadius(womb, y, pad, shift), y);
    ctx.closePath();
  }

  function cavityPath() {
    const { womb, tract, wallInset } = layout;
    ctx.beginPath();
    traceWomb(-wallInset, 4);
    ctx.rect(womb.cx - 3, womb.bottom - 6, 6, tract.canalBottom - womb.bottom + 6);
  }

  function drawUterus(tick) {
    const { px, line, ellipse } = pen;
    const { womb, tract, wallInset, libidoHeat, pressureLevel } = layout;
    const { cx, cy, rx, ry, top } = womb;
    // 输卵管与卵巢：卵巢随性欲变红，接近上限时中心发黄光
    const tubeY = top + Math.round(ry * 0.48);
    const ovaryOuter = mixColor(P.wallDark, P.ovaryHot, libidoHeat);
    const ovaryInner = mixColor(P.wallLight, P.ovaryGlow, libidoHeat);
    for (const side of [-1, 1]) {
      const start = cx + side * wombRadius(womb, tubeY);
      const end = cx + side * Math.min(42, rx + 10);
      line(start, tubeY, end, tubeY - 5, P.wallDark);
      line(start, tubeY - 1, end, tubeY - 6, P.wallLight);
      ellipse(end, tubeY - 6, 4, 5, ovaryOuter);
      ellipse(end - side, tubeY - 7, 2, 3, ovaryInner);
      px(end - side, tubeY - 8, 1, 1, P.shine);
    }
    // 子宫颈（孕晚期变短）与产道
    px(cx - 8, tract.neckTop, 16, tract.neckLength + 1, P.wallDark);
    px(cx - 7, tract.neckTop, 14, tract.neckLength, P.wall);
    px(cx - 4, tract.canalTop, 8, 22, P.wallDark);
    px(cx - 3, tract.canalTop, 6, 21, P.cavityDeep);
    px(cx - 6, tract.canalTop + 4, 2, 13, P.wallLight);
    px(cx + 4, tract.canalTop + 4, 2, 13, P.wallLight);
    // 子宫壁与宫腔
    paintWomb(3, 0, P.frame);
    paintWomb(1, 0, P.wallDark);
    paintWomb(0, 0, wallTone());
    paintWomb(-3, 1, liningTone());
    paintWomb(-wallInset + 2, 2, P.cavity);
    paintWomb(-wallInset, 4, P.cavityDeep);
    for (let y = top + wallInset + 1; y < cy + ry - wallInset; y += 3) {
      for (let x = cx - rx + wallInset; x < cx + rx - wallInset; x += 3) {
        if (Math.abs(x - cx) < wombRadius(womb, y, -wallInset, 4) - 2 && (x * 13 + y * 7) % 5 === 0) px(x, y, 1, 1, P.cavity);
      }
    }
    outlineWomb(-3, 1, layout.emptyStage ? liningTone() : (pressureLevel >= 2 ? P.wallLight : P.shine));
    // 孕晚期胎儿把子宫壁顶出 1～2 像素
    if (layout.lateBulge) {
      for (const fetus of layout.fetuses) {
        if (fetus.descent >= 1) continue;
        for (let dy = -5; dy <= 5; dy += 1) {
          const y = Math.round(fetus.y + dy);
          const edge = wombRadius(womb, y);
          if (!edge) continue;
          for (const side of [-1, 1]) {
            const reach = side * (fetus.x - cx) + fetus.size * fetus.squeeze * 0.9;
            if (reach < edge - 3) continue;
            const bump = Math.max(1, 2 - Math.floor(Math.abs(dy) / 4));
            for (let d = 1; d <= bump; d += 1) px(cx + side * (edge + d), y, 1, 1, d === bump ? P.wallDark : P.wall);
            px(cx + side * (edge - 1), y, 1, 1, P.wallLight);
          }
        }
        if (Math.abs(fetus.x - cx) < rx * 0.35 && fetus.y - fetus.size < top + 18) {
          const x = Math.max(cx - rx + 5, Math.min(cx + rx - 5, Math.round(fetus.x)));
          const offset = (x - cx) / (rx + 2);
          const localTop = Math.round(cy - (ry + 2) * Math.sqrt(Math.max(0, 1 - offset * offset)));
          px(x - 1, localTop, 3, 1, P.wallDark);
          px(x - 2, localTop + 1, 5, 1, P.wall);
          px(x - 3, localTop + 2, 7, 1, P.wallLight);
        }
      }
    }
    // 宫压颤动：只有侧壁每 1.5 秒抖一下
    if (pressureLevel >= 3 && wantsMotion()) {
      const phase = tick % 1500;
      if (phase < 320) {
        const shift = phase < 160 ? 1 : -1;
        for (let y = cy - 7; y <= cy + 7; y += 2) {
          const edge = wombRadius(womb, y, 1);
          px(cx - edge - 1 + shift, y, 1, 2, P.wallTense);
          px(cx + edge + 1 + shift, y, 1, 2, P.wallTense);
        }
      }
    }
  }

  function drawFluid() {
    const { womb, wallInset, fluidHeight } = layout;
    if (!fluidHeight) return;
    const innerRy = womb.ry - wallInset;
    const bottom = womb.cy + 4 + innerRy - 1;
    const level = bottom - fluidHeight + 1;
    const left = womb.cx - womb.rx + wallInset;
    const right = womb.cx + womb.rx - wallInset;
    for (let y = level; y <= bottom; y += 1) {
      for (let x = left; x < right; x += 1) if ((x + y * 2) % 4 < 2) pen.px(x, y, 1, 1, P.fluid);
    }
    for (let x = left; x < right; x += 3) pen.px(x, Math.min(bottom, level + (x % 2)), 2, 1, P.fluidLight);
  }

  function menstrualIntensity() {
    return Math.max(0, Math.sin(Math.PI * (0.08 + 0.92 * layout.emptyProgress)));
  }

  function drawEmptyStage() {
    const { emptyStage, emptyProgress, womb, wallInset } = layout;
    if (!emptyStage) return;
    const cx = womb.cx;
    const cy = womb.cy + 4;
    if (emptyStage === '月经期') {
      const marks = Math.ceil(menstrualIntensity() * 5);
      for (let i = 0; i < marks; i += 1) pen.px(cx - 4 + i * 2, cy + 2 + (i % 3) * 3, 1, 2, P.blood);
    } else if (emptyStage === '黄体期' || emptyStage === '假孕期') {
      const edge = Math.max(1, womb.rx - wallInset - 2);
      for (let y = cy - 5; y <= cy + 6; y += 3) { pen.px(cx - edge, y, 1, 1, P.lining); pen.px(cx + edge, y + 1, 1, 1, P.lining); }
    } else if (emptyStage === '产后恢复') {
      const marks = Math.round(7 * (1 - emptyProgress));
      for (let i = 0; i < marks; i += 1) pen.px(cx - 5 + ((i * 3) % 10), cy - 5 + ((i * 7) % 12), 1, 2, i % 2 ? P.blood : P.wallLight);
    }
  }

  function drawMenstrualFlow(tick) {
    if (layout.emptyStage !== '月经期') return;
    const intensity = menstrualIntensity();
    const drops = intensity < 0.05 ? 0 : Math.ceil(intensity * 4);
    const { womb, tract } = layout;
    const start = womb.bottom + 2;
    const end = Math.min(119, tract.canalBottom + 7);
    for (let i = 0; i < drops; i += 1) {
      const travel = ((wantsMotion() ? tick : 0) / 1600 + i / drops) % 1;
      const y = Math.round(start + (end - start) * travel);
      const x = womb.cx + (i % 3) - 1;
      const out = y >= tract.canalBottom;
      pen.px(x, y, out ? 2 : 1, out ? 2 : 3, P.blood);
      if (out) pen.px(x + 1, y + 1, 1, 1, P.wallLight);
    }
  }

  // 精液到容量时从宫口缓慢渗出，比经血（1.6 秒）与破水演出（2.8 秒）都慢；溢出越多同时渗出越多。
  // 未孕灌满：一轮 4.2 秒、最多 3 滴；怀孕浸满：宫颈有黏液栓，一轮 6 秒、最多 2 滴。只是画面，精液量不减
  const SEMEN_LEAK_MS = 4200;
  const SOAKED_LEAK_MS = 6000;

  function drawSemenLeak(tick) {
    if (!layout.semenFull) return;
    const soaked = layout.semenSoaked;
    const period = soaked ? SOAKED_LEAK_MS : SEMEN_LEAK_MS;
    const drops = 1 + Math.round(layout.semenOverflow * (soaked ? 1 : 2));
    const { womb, tract } = layout;
    const start = womb.bottom + 1;
    const end = Math.min(119, tract.canalBottom + 5);
    for (let i = 0; i < drops; i += 1) {
      const travel = ((wantsMotion() ? tick : 0) / period + i / drops) % 1;
      // 先慢后快：黏稠的液体在宫口积一下才往下掉
      const eased = travel * travel;
      const y = Math.round(start + (end - start) * eased);
      const x = womb.cx + (i % 2 === 0 ? 0 : (i % 4 === 1 ? 1 : -1));
      const out = y >= tract.canalBottom;
      // 浸满时滴得更细：只有一像素
      pen.px(x, y, 1, soaked ? 1 : 2, P.fluidLight);
      if (!out && !soaked) pen.px(x, y - 1, 1, 1, P.fluid);
    }
    // 宫口挂着一小滴
    pen.px(womb.cx, tract.canalBottom, 1, 1, P.fluidLight);
  }

  function breathOf(fetus, tick) {
    return wantsMotion() ? Math.floor((tick + fetus.index * 450) / 1200) % 2 : 0;
  }

  function fetusSpec(size, sprite, angle, squeeze = 1, gap = null, membrane = 100, nestedHost = false) {
    return {
      type: sprite.type, stage: sprite.stage, height: fetusHeightFor(size), angle,
      mirror: Boolean(sprite.mirror), posterior: Boolean(sprite.posterior), squeeze: Math.round(squeeze * 20) / 20,
      membrane, nestedHost,
      ...(gap ? { gap } : {}),
    };
  }

  function drawSprite(x, y, size, sprite, angle, squeeze = 1, gap = null, membrane = 100, nestedHost = false) {
    // 依大小、胎位角、胎背方位与挤压直接栅格化，1:1 贴上，不做旋转缩放；membrane 给贴在卵上的羊膜用
    const { canvas: off, anchorX, anchorY } = spriteOf.fetus(fetusSpec(size, sprite, angle, squeeze, gap, membrane, nestedHost));
    ctx.drawImage(off, Math.round(x) - anchorX, Math.round(y) - anchorY);
  }

  // ---- 羊膜囊（水泡）：实心的羊水色加一条连续膜线，贴合实际画出的胎儿，由后往前与胎儿交替画 ----
  function bubbleColors() {
    // 精液浸满时，膜线沾上一层精液色，看得出囊外被浸着
    const soak = layout.semenSoaked ? 0.45 : 0;
    return {
      fluid: mixColor(P.cavity, P.fluidLight, 0.2),
      thinFluid: mixColor(P.cavity, P.fluidLight, 0.1),
      // 膜线用偏羊水的冷色，才不会被看成胎儿的轮廓
      membrane: mixColor(mixColor(P.water, P.cavity, 0.2), P.fluidLight, soak),
      thinMembrane: mixColor(mixColor(P.water, P.cavity, 0.55), P.fluidLight, soak),
    };
  }

  /** 这个囊的成员实际画出来的范围（含呼吸位移），外扩一点成椭圆 */
  function bubbleGeometry(members, breaths) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const fetus of members) {
      const y = fetus.y + (breaths.get(fetus.embryoId) || 0);
      const b = spriteOf.fetus(fetusSpec(fetus.size, fetus.sprite, fetus.angle, fetus.squeeze, null, 100, fetus.inner.length > 0)).bounds;
      x0 = Math.min(x0, Math.round(fetus.x) + b.x0);
      x1 = Math.max(x1, Math.round(fetus.x) + b.x1);
      y0 = Math.min(y0, Math.round(y) + b.y0);
      y1 = Math.max(y1, Math.round(y) + b.y1);
    }
    return { cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, rx: ((x1 - x0 + 1) / 2) * 1.12 + 1.5, ry: ((y1 - y0 + 1) / 2) * 1.12 + 1.5 };
  }

  /**
   * 耐久 ≥ 60 整圈实线；30～60 膜线开始缺口；< 30 底部开口、羊水变淡；≤ 0 已破不画。
   * 回传这个囊的羊水色，给里面胎儿的空隙用。fill=false 只画膜线（破水演出叠在胎儿上用）
   */
  function drawBubble({ cx, cy, rx, ry }, durability, { fill = true } = {}) {
    if (durability <= 0) return null;
    const C = bubbleColors();
    const thin = durability < 30;
    const fluid = thin ? C.thinFluid : C.fluid;
    const membrane = durability < 60 ? C.thinMembrane : C.membrane;
    const opening = thin ? ((30 - durability) / 30) * 120 : 0;
    const gapRatio = durability >= 60 ? 0 : durability >= 30 ? 0.2 + ((60 - durability) / 30) * 0.3 : 0.5;
    const inside = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
    const xa = Math.floor(cx - rx);
    const xb = Math.ceil(cx + rx);
    const ya = Math.floor(cy - ry);
    const yb = Math.ceil(cy + ry);
    for (let y = ya; y <= yb; y += 1) {
      for (let x = xa; x <= xb; x += 1) {
        if (!inside(x, y)) continue;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        if (!edge) {
          if (fill) pen.px(x, y, 1, 1, fluid);
          continue;
        }
        // 膜线：底部（朝宫口）开口；变薄时按角度规律留缺口
        const deg = ((Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI + 360) % 360;
        const broken = (opening && Math.abs(deg - 90) <= opening / 2)
          || (gapRatio && ((Math.floor(deg / 9) * 37 + 11) % 100) < gapRatio * 100);
        if (broken) {
          if (fill) pen.px(x, y, 1, 1, fluid);
          continue;
        }
        pen.px(x, y, 1, 1, membrane);
      }
    }
    return fluid;
  }

  function drawFetuses(tick) {
    const breaths = new Map(layout.fetuses.map((fetus) => [fetus.embryoId, breathOf(fetus, tick)]));
    const sacOf = new Map();
    for (const sac of layout.sacs) for (const id of sac.embryoIds) sacOf.set(id, sac);
    const drawnSacs = new Map();
    for (let i = layout.fetuses.length - 1; i >= 0; i -= 1) {
      const fetus = layout.fetuses[i];
      const sac = sacOf.get(fetus.embryoId);
      if (sac && !drawnSacs.has(sac)) {
        const members = layout.fetuses.filter((item) => sac.embryoIds.includes(item.embryoId));
        // 胎转卵生孕晚的羊膜已硬化、贴在卵上（画在卵里），没有羊水囊可画
        const fluid = members.some((item) => hasFluidSac(item.sprite.type, item.sprite.stage));
        drawnSacs.set(sac, fluid ? drawBubble(bubbleGeometry(members, breaths), sac.durability) : null);
      }
      const y = fetus.y + breaths.get(fetus.embryoId);
      const nestedHost = fetus.inner.length > 0;
      drawSprite(fetus.x, y, fetus.size, fetus.sprite, fetus.angle, fetus.squeeze, (sac && drawnSacs.get(sac)) || null, sac ? sac.durability : fetus.amnion, nestedHost);
      // 内胎被宿主身体或蛋壳遮住，只以鼓起的体型和挤眼表情表示孕中孕。
    }
  }

  function drawFrontWall() {
    const { womb, tract, wallInset } = layout;
    const { px } = pen;
    outlineWomb(-wallInset + 1, 4, wallTone());
    outlineWomb(-wallInset, 4, P.wallDark);
    px(womb.cx - 8, tract.neckTop + 1, 2, tract.neckLength - 1, P.wallDark);
    px(womb.cx + 6, tract.neckTop + 1, 2, tract.neckLength - 1, P.wallDark);
    px(womb.cx - 6, tract.neckTop + 1, 1, tract.neckLength - 1, P.wallLight);
    px(womb.cx + 5, tract.neckTop + 1, 1, tract.neckLength - 1, P.wallLight);
    px(womb.cx - 6, tract.canalTop, 2, 17, P.wallLight);
    px(womb.cx + 4, tract.canalTop, 2, 17, P.wallLight);
  }

  // 阻塞：卡住的胎儿外框换警示色闪烁，位置标记依类型不同
  function drawObstruction(tick) {
    const { obstruction } = layout;
    if (!obstruction) return;
    const on = !wantsMotion() || Math.floor(tick / 360) % 2 === 0;
    const stuck = layout.fetuses.filter((fetus) => obstruction.embryoIds.includes(fetus.embryoId));
    const { womb, tract } = layout;
    for (const fetus of stuck) {
      if (on) {
        const r = Math.max(3, Math.round(fetus.size * 0.75));
        pen.ring(fetus.x, fetus.y, Math.round(r * fetus.squeeze) + 1, r + 1, P.signal);
      }
    }
    const mark = (x, y) => pen.glyphs('!', x, y, on ? P.signal : P.wallTense);
    if (obstruction.type === 'shoulder_dystocia') {
      mark(womb.cx - 11, tract.canalTop + 8);
      mark(womb.cx + 8, tract.canalTop + 8);
    } else if (obstruction.type === 'transverse') {
      const fetus = stuck[0];
      if (fetus) {
        pen.px(fetus.x - fetus.size - 3, fetus.y, 3, 1, on ? P.signal : P.wallTense);
        pen.px(fetus.x + fetus.size + 1, fetus.y, 3, 1, on ? P.signal : P.wallTense);
      }
      mark(womb.cx - 1, womb.bottom - 4);
    } else {
      if (obstruction.type === 'twin_lock' && stuck.length === 2) pen.line(stuck[0].x, stuck[0].y, stuck[1].x, stuck[1].y, on ? P.signal : P.wallTense);
      mark(womb.cx - 1, womb.bottom - 4);
    }
  }

  // ---- 事件演出 ----
  function shaft(tip) {
    const { womb, tract } = layout;
    const bottom = Math.min(120, tract.canalBottom);
    const headY = Math.min(bottom - 5, Math.round(tip));
    pen.px(womb.cx - 4, headY + 2, 9, bottom - headY - 2, P.wallDark);
    pen.px(womb.cx - 3, headY + 3, 7, bottom - headY - 3, P.wallLight);
    pen.ellipse(womb.cx, headY + 2, 4, 3, P.fetusLight);
    pen.px(womb.cx - 2, headY, 3, 1, P.shine);
  }

  function divisionCells(cx, cy, count, k) {
    const positions = {
      1: [[0, 0]], 2: [[-3, 0], [3, 0]], 4: [[-3, -3], [3, -3], [-3, 3], [3, 3]],
      8: [[-5, -4], [0, -5], [5, -4], [-5, 1], [0, 1], [5, 1], [-3, 6], [3, 6]],
    };
    for (const [dx, dy] of positions[count]) {
      const r = Math.round((count === 8 ? 2 : 3) * k);
      pen.ellipse(cx + dx * k, cy + dy * k, r, r, P.fetusLight);
      pen.px(cx + dx * k - 1, cy + dy * k - 1, 1, 1, P.shine);
    }
  }

  // 小窗特写：右上角，约占画面一半（左上角留给胎儿卡按钮）；k 把 Sol 6 的 38×38 构图等比放大
  function cueInset(type, elapsed) {
    const { px, ellipse, ring, line } = pen;
    const x = UTERUS_CANVAS.width - 3 - 48;
    const y = 3;
    const W = 48;
    const H = 52;
    const k = 1.25;
    const cx = x + Math.round(W / 2);
    const cy = y + Math.round(H / 2);
    const p = Math.min(1, elapsed / 1200);
    px(x - 2, y - 2, W + 4, H + 4, P.frame);
    px(x, y, W, H, P.void);
    px(x + 1, y + 1, W - 2, 1, P.wallDark);
    px(x + 1, y + H - 2, W - 2, 1, P.wallDark);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 2, W - 2, H - 4);
    ctx.clip();
    if (type === 'ovulation') {
      ellipse(x + W - 10, y + H - 16, 11 * k, 13 * k, P.wallDark);
      ellipse(x + W - 11, y + H - 17, 9 * k, 11 * k, P.wall);
      ellipse(x + W - 16, y + H - 23, 4 * k, 4 * k, P.wallLight);
      px(x + W - 17, y + H - 24, 2, 1, P.shine);
      const eggX = x + W - 22 - Math.round(16 * p);
      ellipse(eggX, y + H - 25, 3 * k, 3 * k, P.egg);
      px(eggX - 1, y + H - 26, 1, 1, P.shine);
    } else if (type === 'implantation' || type === 'implantationFailed') {
      const failed = type === 'implantationFailed';
      if (failed) ctx.globalAlpha = elapsed < 1100 ? 1 : Math.max(0, 1 - (elapsed - 1100) / 1100);
      const count = elapsed < 450 ? 1 : elapsed < 900 ? 2 : elapsed < 1350 ? 4 : 8;
      if (failed) {
        divisionCells(cx, cy, elapsed < 450 ? 1 : 2, k);
        if (elapsed >= 1100) for (let i = 0; i < 5; i += 1) px(cx - 12 + i * 6, cy + 14 + (i % 2), 1, 1, P.shadow);
      } else divisionCells(cx, cy, count, k);
      ctx.globalAlpha = 1;
    } else if (type === 'fertilization') {
      ring(cx, cy, 12 * k, 12 * k, P.eggShade);
      ellipse(cx, cy, 11 * k, 11 * k, P.egg);
      ellipse(cx, cy, 5 * k, 5 * k, P.wallLight);
      px(cx - 4, cy - 5, 2, 2, P.shine);
      for (let i = 0; i < 11; i += 1) {
        const a = (i * Math.PI * 2) / 11;
        const r = (21 - 7 * Math.min(1, elapsed / 1050)) * k;
        const sx = cx + Math.cos(a) * r;
        const sy = cy + Math.sin(a) * r;
        ellipse(sx, sy, 1, 2, P.fetusLight);
        line(sx + Math.cos(a) * 2, sy + Math.sin(a) * 2, sx + Math.cos(a) * 5, sy + Math.sin(a) * 5, P.fluidLight);
      }
    } else if (type === 'surrogacy') {
      ellipse(cx, y + 17, 14 * k, 10 * k, P.wallDark);
      ellipse(cx, y + 17, 11 * k, 7 * k, P.cavityDeep);
      px(cx - 6, y + 25, 12, 6, P.wall);
      px(cx - 4, y + 28, 8, H - 30, P.wallDark);
      px(cx - 2, y + 28, 4, H - 30, P.cavityDeep);
      for (let i = 0; i < 3; i += 1) {
        if (elapsed < i * 540) continue;
        const progress = Math.max(0, Math.min(1, (elapsed - i * 540) / 1050));
        const ey = y + H - 6 - Math.round((H - 23) * progress);
        const inChamber = Math.max(0, (progress - 0.68) / 0.32);
        const ex = cx + Math.round((i - 1) * 10 * inChamber) + Math.round(Math.sin(progress * Math.PI * 4 + i) * Math.min(1, 1 - inChamber));
        ring(ex, ey, 2, 2, P.sac);
        px(ex, ey, 1, 1, P.fetusLight);
        px(ex + (Math.floor(progress * 8) % 3) - 1, ey - 1, 1, 1, P.shine);
      }
    } else if (type === 'chimera') {
      const sep = Math.round(12 * (1 - p));
      if (elapsed < 1300) {
        for (const side of [-1, 1]) { ring(cx + side * sep, cy, 6, 6, P.eggShade); ellipse(cx + side * sep, cy, 5, 5, P.fetusLight); }
      } else {
        ring(cx, cy, 9, 9, P.eggShade);
        ellipse(cx, cy, 8, 8, P.fetusLight);
        line(cx, cy - 5, cx, cy + 5, P.eggShade);
      }
    } else if (type === 'rebirth') {
      const curl = Math.min(1, elapsed / 1650);
      if (elapsed < 1750) {
        const off = document.createElement('canvas');
        off.width = 32;
        off.height = 32;
        const offCtx = off.getContext('2d');
        const offPen = makePen(offCtx, P);
        offPen.ellipse(16, 6 + Math.round(4 * curl), 3, 3, P.fetusLight);
        offPen.ellipse(16, 17, 4, 6, P.fetus);
        offPen.line(13, 13, 7 + Math.round(7 * curl), 17 + Math.round(2 * curl), P.fetusLight);
        offPen.line(19, 13, 25 - Math.round(7 * curl), 17 + Math.round(2 * curl), P.fetusLight);
        offPen.line(14, 21, 10 + Math.round(5 * curl), 29 - Math.round(8 * curl), P.fetusLight);
        offPen.line(18, 21, 22 - Math.round(5 * curl), 29 - Math.round(8 * curl), P.fetusLight);
        const size = Math.round(40 - 21 * curl);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(curl * Math.PI * 1.7);
        ctx.globalAlpha = elapsed < 1150 ? 1 : Math.max(0, 1 - (elapsed - 1150) / 600);
        ctx.drawImage(off, -Math.round(size / 2), -Math.round(size / 2), size, size);
        ctx.restore();
      }
      if (elapsed >= 1050) {
        ctx.globalAlpha = Math.min(1, (elapsed - 1050) / 650);
        ellipse(cx + 2, cy + 3, 6, 6, P.fetus);
        ellipse(cx - 3, cy - 2, 5, 5, P.fetusLight);
        px(cx - 6, cy - 3, 1, 1, P.cavityDeep);
        line(cx + 5, cy + 6, cx + 1, cy + 8, P.fetusLight);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawRupture(elapsed) {
    const fetus = layout.fetuses.find((item) => item.presenting) || layout.fetuses[0];
    const { womb, tract, wallInset } = layout;
    const sourceX = fetus ? fetus.x : womb.cx;
    const rx = fetus ? Math.round(fetus.size * fetus.squeeze) + 2 : 4;
    const ry = fetus ? fetus.size + 2 : 4;
    const sourceY = fetus ? fetus.y + ry - 1 : womb.bottom - 4;
    const outlet = [];
    ctx.save();
    cavityPath();
    ctx.clip();
    if (fetus && elapsed < 850) {
      // 破掉的膜：只剩膜线，底部裂开
      drawBubble(bubbleGeometry([fetus], new Map()), 5, { fill: false });
      pen.px(sourceX - 2, sourceY, 2, 1, P.waterLight);
      pen.px(sourceX + 1, sourceY + 1, 2, 1, P.waterLight);
    }
    const end = Math.min(119, tract.canalBottom + 7);
    for (let i = 0; i < 20; i += 1) {
      const age = elapsed - i * 62;
      if (age < 0 || age > 1750) continue;
      const progress = Math.min(1, age / 1550);
      const y = Math.round(sourceY + (end - sourceY) * progress);
      let x = Math.round(sourceX + (womb.cx - sourceX) * progress + Math.sin(i * 2.3) * (1 - progress) * Math.min(4, rx * 0.3));
      if (y >= womb.bottom) x = Math.max(womb.cx - 2, Math.min(womb.cx + 2, x));
      else {
        const edge = Math.max(1, wombRadius(womb, y, -wallInset, 4) - 1);
        x = Math.max(womb.cx - edge, Math.min(womb.cx + edge, x));
      }
      const w = i % 4 === 0 ? 2 : 1;
      const h = i % 3 === 0 ? 3 : 2;
      const color = i % 3 ? P.water : P.waterLight;
      pen.px(x, y, w, h, color);
      if (y >= tract.canalBottom) outlet.push([x, y, w, h, color]);
    }
    ctx.restore();
    for (const [x, y, w, h, color] of outlet) pen.px(x, y, w, h, color);
  }

  function drawCue(tick) {
    if (!cue) return;
    const elapsed = Math.max(0, tick - cue.start);
    if (elapsed > (cue.type === 'rupture' ? RUPTURE_MS : CUE_MS)) { cue = null; return; }
    const { womb, tract } = layout;
    if (cue.type === 'rupture') drawRupture(elapsed);
    else if (cue.type === 'insert') {
      const phase = Math.floor(elapsed / 180) % 4;
      shaft(tract.canalTop + (phase === 1 || phase === 2 ? 0 : 8));
      if (phase === 1 || phase === 2) { pen.px(womb.cx - 8, tract.canalTop + 3, 2, 1, P.shine); pen.px(womb.cx + 7, tract.canalTop + 3, 2, 1, P.shine); }
    } else if (cue.type === 'ejaculate') {
      shaft(tract.canalTop + 1);
      ctx.save();
      cavityPath();
      ctx.clip();
      for (let i = 0; i < 13; i += 1) {
        const release = elapsed - i * 75;
        if (release < 0) continue;
        const travel = Math.min(35, release / 45);
        const spread = Math.min(3, travel / 7);
        const x = womb.cx + Math.round(Math.sin(i * 2.4 + travel * 0.3) * spread);
        pen.px(x, tract.canalTop + 2 - travel, i % 3 ? 1 : 2, i % 3 ? 1 : 2, i % 2 ? P.shine : P.fluidLight);
      }
      ctx.restore();
    } else cueInset(cue.type, elapsed);
  }

  // ---- 播放控制 ----
  function wantsMotion() {
    return wantsAnimation && !reducedMotion;
  }

  function needsTicking() {
    return Boolean(cue) || (wantsMotion() && visible);
  }

  function loop() {
    timer = 0;
    if (!layout || !canvas.isConnected) return;
    frame(performance.now());
    if (needsTicking()) timer = setTimeout(loop, FRAME_MS);
  }

  function kick() {
    if (timer) clearTimeout(timer);
    timer = 0;
    loop();
  }

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) kick();
    })
    : null;
  observer?.observe(canvas);
  const onVisibility = () => {
    visible = document.visibilityState === 'visible';
    if (visible) kick();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    canvas,
    setLayout(next) {
      layout = next;
      kick();
    },
    setTheme(next) {
      P = getUterusPalette(next);
      pen = makePen(ctx, P);
      spriteOf = createSpriteCache(P);
      kick();
    },
    setAnimated(value) {
      wantsAnimation = Boolean(value);
      kick();
    },
    /** 事件演出不受「关闭动画」影响：它只播一次，是资讯而不是装饰；减少动态效果时则跳过 */
    playCue(type) {
      if (reducedMotion) return false;
      cue = { type, start: performance.now() };
      kick();
      return true;
    },
    destroy() {
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
