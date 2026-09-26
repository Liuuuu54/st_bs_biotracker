// 子宫像素图的绘制层：把 computeUterusLayout 的结果画到 96×120 的画布上。
// 画法沿用 Sol 6 试作。只画、不算版面；动画以每 180 毫秒一帧推进，
// 只在画面可见时跑，系统设定减少动态效果或关闭动画时只画静态图。
import { UTERUS_CANVAS, wombRadius } from './uterus_layout.js';

const BASE_PALETTE = Object.freeze({
  bg: '#1c1726', void: '#140f1b', frame: '#47283d', wallDark: '#803b58', wall: '#c85f78', wallLight: '#ee9290',
  wallTense: '#ec586d', shine: '#ffd0a4', cavity: '#672d51', cavityDeep: '#421d3d', fluid: '#b980aa',
  fluidLight: '#e5adc9', water: '#a5c9de', waterLight: '#e4f5f1', sac: '#ffd0b0', shadow: '#72455f',
  fetus: '#f8ae96', fetusLight: '#ffe0ad', egg: '#f8d9b0', eggShade: '#ae778c', signal: '#ffe27d',
  blood: '#b94460', lining: '#f3a891', ovaryHot: '#ae4557', ovaryGlow: '#ffd079',
});

// 配色选项 C：肉色色阶固定，各主题只做轻微的色调偏移（混入比例很小）
const THEME_TINTS = Object.freeze({
  retro: ['#b8c46a', 0.14],
  cultivation: ['#86b88a', 0.12],
  fantasy: ['#c9a0ff', 0.1],
  'cyber-egypt': ['#d9b84a', 0.12],
  wasteland: ['#c8a060', 0.16],
  sakura: ['#ff9ec4', 0.12],
  holo: ['#5fd3e0', 0.14],
  gothic: ['#4a2d63', 0.2],
  steampunk: ['#b87333', 0.14],
  eldritch: ['#3fae8c', 0.14],
  ink: ['#8a8a8a', 0.3],
  iphone: ['#ffffff', 0],
  constructivism: ['#d33a2c', 0.1],
});

const FRAME_MS = 180;
const CUE_MS = 2400;
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

export function getUterusPalette(themeName) {
  const [tint, amount] = THEME_TINTS[themeName] || ['#ffffff', 0];
  const palette = {};
  for (const [key, color] of Object.entries(BASE_PALETTE)) palette[key] = amount ? mixColor(color, tint, amount) : color;
  return palette;
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

// ---- 胎儿图块：5 胚型 × 3 孕期，画在 32×32 的离屏画布上并快取 ----
function paintSprite(ctx, P, type, stage) {
  const { px, ellipse, line, ring } = makePen(ctx, P);
  const s = 10;
  const cx = 16;
  const cy = 16;
  if (type === '卵生' || (type === '卵胎生' && stage === 0) || (type === '胎转卵生' && stage === 2)) {
    ellipse(cx, cy, s * 0.72, s * 0.89, P.eggShade);
    ellipse(cx - 1, cy - 1, s * 0.65, s * 0.8, P.egg);
    ellipse(cx - 2, cy - 3, s * 0.36, s * 0.48, P.fetusLight);
    if (type === '卵胎生') { ellipse(cx - 2, cy, 2, 2, P.fetus); px(cx - 3, cy - 1, 1, 1, P.shine); }
    if (stage > 0) {
      for (let a = 220; a < 330; a += 22) {
        const r = (a * Math.PI) / 180;
        px(cx + Math.cos(r) * s * 0.58, cy + Math.sin(r) * s * 0.75, 2, 1, P.shine);
      }
    }
    if (stage === 2) { line(cx - 3, cy - 2, cx, cy + 1, P.wallDark); line(cx, cy + 1, cx + 3, cy - 2, P.wallDark); }
    if (type === '胎转卵生') { line(cx - 5, cy - 2, cx - 1, cy + 2, P.wallDark); line(cx + 1, cy + 2, cx + 5, cy - 3, P.wallDark); }
  } else if (type === '卵胎生' && stage === 1) {
    ellipse(cx, cy, s * 0.75, s * 0.84, P.eggShade);
    ellipse(cx, cy + 1, s * 0.62, s * 0.7, P.egg);
    ellipse(cx + 2, cy + 2, s * 0.37, s * 0.37, P.fetus);
    ellipse(cx - 3, cy - 3, s * 0.32, s * 0.33, P.fetusLight);
    px(cx - 4, cy - 3, 1, 1, P.cavityDeep);
    line(cx - 6, cy - 5, cx - 2, cy - 2, P.wallDark);
    line(cx - 2, cy - 2, cx + 2, cy - 6, P.wallDark);
    px(cx + 6, cy - 4, 2, 2, P.egg);
    px(cx - 7, cy + 4, 2, 1, P.eggShade);
  } else if (type === '不定型') {
    ellipse(cx, cy, s * 0.72, s * 0.65, P.wall);
    ellipse(cx - 3, cy - 1, s * 0.43, s * 0.53, P.fetus);
    ellipse(cx + 3, cy + 2, s * 0.43, s * 0.44, P.fetusLight);
    for (let a = 0; a < 360; a += 60) {
      const r = (a * Math.PI) / 180;
      px(cx + Math.cos(r) * s * 0.8, cy + Math.sin(r) * s * 0.72, 2, 2, P.shine);
    }
    px(cx - 3, cy - 2, 1, 1, P.cavityDeep);
    px(cx + 3, cy, 1, 1, P.cavityDeep);
    if (stage === 1) { ellipse(cx + 5, cy - 4, 2, 2, P.fetusLight); px(cx + 6, cy - 5, 1, 1, P.shine); }
    if (stage === 2) {
      line(cx - 6, cy + 4, cx - 9, cy + 6, P.wallLight);
      line(cx + 5, cy - 4, cx + 9, cy - 7, P.wallLight);
      ellipse(cx, cy - 6, 2, 2, P.shine);
    }
  } else if (stage === 0) {
    ellipse(cx + 1, cy + 2, s * 0.5, s * 0.47, P.fetus);
    ellipse(cx - 3, cy - 2, s * 0.37, s * 0.39, P.fetusLight);
    px(cx - 5, cy - 3, 2, 1, P.shine);
    px(cx + 4, cy + 4, 2, 2, P.wallDark);
  } else {
    // 卷曲的胎儿：大头、弓背、腹部、两截短肢
    ellipse(cx + 3, cy + 3, s * 0.47, s * 0.48, P.wallDark);
    ellipse(cx + 1, cy + 1, s * 0.48, s * 0.48, P.fetus);
    ellipse(cx - 4, cy - 4, s * 0.42, s * 0.42, P.fetusLight);
    ellipse(cx - 5, cy - 5, s * 0.23, s * 0.2, P.shine);
    px(cx - 6, cy - 3, 1, 1, P.cavityDeep);
    line(cx + 2, cy + 3, cx + 5, cy + 6, P.fetusLight);
    line(cx - 1, cy + 6, cx - 4, cy + 7, P.fetusLight);
    line(cx + 5, cy + 6, cx + 7, cy + 2, P.fetusLight);
    if (stage === 2) { px(cx + 5, cy + 4, 3, 2, P.fetusLight); px(cx - 4, cy + 7, 2, 2, P.wallLight); }
    if (type === '卵胎生') { px(cx - 7, cy + 6, 2, 1, P.eggShade); px(cx + 7, cy - 5, 2, 1, P.eggShade); }
    if (type === '胎转卵生') {
      ring(cx, cy, s * 0.82, s * 0.82, P.eggShade, [45, 135]);
      for (let j = -2; j <= 2; j += 2) px(cx + j, cy + 7, 1, 1, P.eggShade);
    }
  }
}

/** 胎儿图块采用斜向构图；胎生姿态要转 -135° 才是头朝宫口 */
function usesFetalPose(type, stage) {
  return type === '胎生' || (type === '卵胎生' && stage === 2) || (type === '胎转卵生' && stage < 2);
}

function createSpriteCache(P) {
  const cache = new Map();
  return (type, stage) => {
    const key = `${type}|${stage}`;
    if (!cache.has(key)) {
      const off = document.createElement('canvas');
      off.width = 32;
      off.height = 32;
      const ctx = off.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      paintSprite(ctx, P, type, stage);
      cache.set(key, off);
    }
    return cache.get(key);
  };
}

/** 给胎儿卡画缩图（32×32） */
export function drawFetusThumb(canvas, sprite, angle, themeName) {
  const P = getUterusPalette(themeName);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P.cavityDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const off = createSpriteCache(P)(sprite.type, sprite.stage);
  const base = usesFetalPose(sprite.type, sprite.stage) ? -135 : 0;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(((angle + base) * Math.PI) / 180);
  ctx.drawImage(off, -12, -12, 24, 24);
  ctx.restore();
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
export function createUterusRenderer(canvas, { themeName = 'retro', animated = true } = {}) {
  canvas.width = UTERUS_CANVAS.width;
  canvas.height = UTERUS_CANVAS.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  let P = getUterusPalette(themeName);
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
    drawObstruction(tick);
    drawCue(tick);
    // 刻度与超出显示数
    for (let i = 0; i < 8; i += 1) {
      px(4, 35 + i * 8, i % 2 ? 2 : 4, 1, P.wallDark);
      px(88, 35 + i * 8, i % 2 ? 2 : 4, 1, P.wallDark);
    }
    if (layout.hiddenCount > 0) pen.glyphs(`+${layout.hiddenCount}`, 80 - String(layout.hiddenCount).length * 4, 112, P.signal);
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

  function membraneRing(cx, cy, rx, ry, color, coverage, gap) {
    for (let a = 0; a < 360; a += 3) {
      if (gap && a >= gap[0] && a <= gap[1]) continue;
      if (((a / 3) * 37 + 17) % 100 >= coverage * 100) continue;
      const r = (a * Math.PI) / 180;
      pen.px(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry, 1, 1, color);
    }
  }

  function drawSac(sac, breath) {
    const resistance = sac.durability;
    if (resistance <= 0) return;
    const outer = Math.max(0, Math.min(1, (resistance - 20) / 80));
    const inner = resistance >= 30 ? 1 : 0.25 + (0.75 * resistance) / 30;
    const opening = resistance < 30 ? ((30 - resistance) / 30) * 100 : 0;
    const gap = opening ? [20, 20 + opening] : null;
    const cy = sac.cy + breath;
    membraneRing(sac.cx, cy, sac.rx + 1, sac.ry + 1, P.shadow, outer, gap);
    membraneRing(sac.cx, cy, sac.rx, sac.ry, P.sac, inner, gap);
    for (let i = 0; i < 8; i += 1) {
      if ((i * 37 + 13) % 100 >= resistance) continue;
      const r = ((15 + i * 45) * Math.PI) / 180;
      pen.px(sac.cx + Math.cos(r) * (sac.rx + 2), cy + Math.sin(r) * (sac.ry + 2), 1, 1, P.sac);
    }
  }

  function breathOf(fetus, tick) {
    return wantsMotion() ? Math.floor((tick + fetus.index * 450) / 1200) % 2 : 0;
  }

  function drawSprite(x, y, size, sprite, angle, squeeze = 1) {
    const off = spriteOf(sprite.type, sprite.stage);
    const base = usesFetalPose(sprite.type, sprite.stage) ? -135 : 0;
    const w = Math.max(1, Math.round((32 * size * squeeze) / 10));
    const h = Math.max(1, Math.round((32 * size) / 10));
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(((angle + base) * Math.PI) / 180);
    ctx.drawImage(off, -Math.round(w / 2), -Math.round(h / 2), w, h);
    ctx.restore();
  }

  function drawFetuses(tick) {
    const breaths = new Map(layout.fetuses.map((fetus) => [fetus.embryoId, breathOf(fetus, tick)]));
    for (const sac of layout.sacs) drawSac(sac, breaths.get(sac.embryoIds[0]) || 0);
    for (let i = layout.fetuses.length - 1; i >= 0; i -= 1) {
      const fetus = layout.fetuses[i];
      const y = fetus.y + breaths.get(fetus.embryoId);
      drawSprite(fetus.x, y, fetus.size, fetus.sprite, fetus.angle, fetus.squeeze);
      fetus.inner.forEach((inner, k) => {
        pen.ring(fetus.x + k * 2, y, inner.size * 0.9 + 1, inner.size * 0.9 + 1, P.sac);
        drawSprite(fetus.x + k * 2, y, inner.size, inner.sprite, inner.angle);
      });
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
      membraneRing(fetus.x, fetus.y, rx + 1, ry + 1, P.shadow, 1, [55, 125]);
      membraneRing(fetus.x, fetus.y, rx, ry, P.sac, 1, [55, 125]);
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
    setTheme(name) {
      P = getUterusPalette(name);
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
