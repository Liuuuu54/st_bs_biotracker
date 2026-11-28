// 育儿袋（1.6.0）：孕体特写下腹的一道袋口，产后恢复期袋里有幼体时下腹鼓起。纯计算，不碰 DOM。
// 画法照预览页 previews/pouch-closeup-preview.html（使用者 2026-11-28 定案）：
//   - 袋口以上照当下的身体，袋口以下整片换成一定胎量的孕肚（下腹连同短裤一起被撑鼓）；背侧轮廓在袋口上下各 8 列平滑过渡。
//   - 借的胎量随产后恢复从 84 天长到 136 天，袋唇落差（袋口那列往前凸几格）不超过 2＋3×恢复进度，凸太多就把胎量往回收。
//   - 袋口：彎月缝，从前缘开始、中心对齐胯部，宽＝两倍的（胯部 − 前缘），不超过肚子宽的八成五；不画进侧腹阴影。
//     空袋又怀孕时顺着孕肚的弧往下弯，孕肚越大袋口占的比例越短、弯得越浅。
//   - 不画肚脐。胎形的幼体偶尔从袋口探出一段黑影扁弧再缩回，随恢复越来越宽；蛋、不定型不探头。
// 动画器（belly_anim.js）在成图时呼叫 buildPouchScene 换掉静止画面，每一格再呼叫 paintPouchPeek 画探头。

import { BELLY_DEFAULT_PALETTE } from './belly_render.js';
import { getBaseRaceName, pickDominantRaceName } from './race_config.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const hexToRgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const mixHex = (a, b, t) => `#${hexToRgb(a).map((v, k) => Math.round(v + (hexToRgb(b)[k] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const rgba = (hex) => { const [r, g, b] = hexToRgb(hex); return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; };

/** 预设有育儿袋的种族（使用者 2026-11-27）：袋兽族、甲壳族（腹下抱卵瓣）与奇美拉系 8 族 */
export const POUCH_DEFAULT_RACES = Object.freeze(new Set(['袋兽族', '甲壳族', '奇美拉', '鵺', '狮鹫', '斯芬克斯', '白泽', '麒麟', '鸡蛇族', '枭熊']));

/** 种族预设有没有育儿袋（混血取占比最大的那一族，子项照基种族） */
export function getPouchDefault(race, bloodline = null) {
  const name = getBaseRaceName(pickDominantRaceName(race || '人类', bloodline) || race || '人类');
  return POUCH_DEFAULT_RACES.has(name) ? 'on' : 'off';
}

/**
 * 特写要不要画育儿袋、袋里有什么。display.pouch 是外观子页的选择（null 照种族）；
 * 只有产后恢复期、这次有活产（base.pouchBrood）时袋里有幼体。没有袋回传 null。
 */
export function getPouchView(base = {}, display = {}) {
  const choice = display?.pouch === 'on' || display?.pouch === 'off' ? display.pouch : getPouchDefault(base.race, base.bloodline);
  if (choice !== 'on') return null;
  const brood = base.stage === '产后恢复' && base.pouchBrood && Number(base.pouchBrood.count) >= 1
    ? { count: Math.round(Number(base.pouchBrood.count)), kind: ['fetus', 'egg', 'blob'].includes(base.pouchBrood.kind) ? base.pouchBrood.kind : 'fetus' }
    : null;
  return { brood };
}

// 袋里的东西撑成几胎的孕肚：胎、蛋照数量（最多 3），不定型算 2
const broodCount = (brood) => (brood.kind === 'blob' ? 2 : clamp(brood.count, 1, 3));

/**
 * 换掉动画器的静止画面：回传 { rest, layers, pouch }。
 * state.pouch = { brood: { count, kind } | null, recovery: 0–1 }。
 */
export function buildPouchScene(layout, painter, state, palette) {
  const { width: W, height: H } = layout.grid;
  const FRAME = painter.frame;
  const pouch = state.pouch || {};
  const recovery = clamp(Number(pouch.recovery) || 0, 0, 1);
  const brood = pouch.brood || null;
  const base = { ...state, navel: 'none' };
  const flatRest = layout.layout(base);
  const flatLayers = painter.paintLayers(flatRest, palette);
  const bodyAt = (rest, x, y) => x >= 0 && y >= 0 && x < W && y < H && rest.label[y * W + x] !== 0;
  const frontOf = (rest, y) => { let x = 0; while (x < W && !bodyAt(rest, x, y)) x += 1; return x; };
  const backOf = (rest, y) => { let x = W - 1; while (x > 0 && !bodyAt(rest, x, y)) x -= 1; return x; };

  // 量肚子：一律用穿着衣服的当下身体（胸衣下缘到短裤上缘之间、前缘是皮肤的那段最长的列）
  const clothed = base.showShorts && base.showBra ? flatRest : layout.layout({ ...base, showShorts: true, showBra: true, strapless: true, release: undefined });
  const { SKIN } = layout.labels;
  let top = 0;
  let bottom = -1;
  for (let y = 0; y < H; y += 1) {
    const x = frontOf(clothed, y);
    const skin = (row) => { const f = frontOf(clothed, row); for (let k = 0; k < 3 && f + k < W; k += 1) if (clothed.label[row * W + f + k] === SKIN) return true; return false; };
    if (x >= W || !skin(y)) continue;
    let e = y;
    while (e + 1 < H && frontOf(clothed, e + 1) < W && skin(e + 1)) e += 1;
    if (e - y > bottom - top) { top = y; bottom = e; }
    y = e;
  }
  let tip = top;
  for (let y = top; y <= bottom; y += 1) if (frontOf(clothed, y) < frontOf(clothed, tip)) tip = y;
  const pregnant = !brood && (Number(state.days) || 0) > 0 && state.hormStage === 'pregnant';
  // 袋口高度：平肚时在肚子七成高；怀孕时肚子是个圆顶，从最凸的那一列往下三成
  const cut = pregnant ? Math.round(tip + (bottom - tip) * 0.3) : Math.round(top + (bottom - top) * 0.7);

  // 胯部：从同体型、没怀孕、穿短裤的身体量短裤两道褶线收成 V 的最底一列（大肚子会盖住褶线）
  const probe = painter.paint(layout.layout({ ...base, hormStage: 'cycle', days: 0, pressure: 0, count: 1, laborPhase: 'none', showShorts: true, showBra: true, strapless: true, release: undefined, ghost: undefined }), BELLY_DEFAULT_PALETTE);
  const crease = rgba(BELLY_DEFAULT_PALETTE.crease);
  const probePixels = probe.pixels;
  let crotch = null;
  for (let y = FRAME.height - 1; y > FRAME.height * 0.6 && crotch === null; y -= 1) {
    const xs = [];
    for (let x = 0; x < FRAME.width; x += 1) if (probePixels[y * FRAME.width + x] === crease) xs.push(x);
    if (xs.length >= 2) crotch = (xs[0] + xs.at(-1)) / 2 - probe.offsetX;
  }

  // 袋里有幼体：袋口以下换成孕肚（落差太大就少借几天）
  let fullRest = null;
  let fullLayers = null;
  if (brood) {
    const limit = 2 + 3 * recovery;
    const flatFront = frontOf(flatRest, cut);
    const fullState = { ...base, hormStage: 'pregnant', count: broodCount(brood), weight: 1, pressure: Number.NaN, laborPhase: 'none', stageProgress: 20, ghost: undefined };
    for (let days = Math.round(84 + 52 * recovery); ; days -= 6) {
      fullRest = layout.layout({ ...fullState, days });
      if (flatFront - frontOf(fullRest, cut) <= limit || days <= 56) break;
    }
    // 产后刚开始时肚子还没缩回去，比袋子鼓：照当下的身体，只画张开的袋口
    if (frontOf(fullRest, cut) >= flatFront) fullRest = null;
    else fullLayers = painter.paintLayers(fullRest, palette);
  }

  const N = W * H;
  const rest = fullRest ? { ...flatRest, label: flatRest.label.slice(), tone: flatRest.tone.slice(), owner: flatRest.owner.slice(), visibleBelly: flatRest.visibleBelly.slice() } : flatRest;
  const layers = { ...flatLayers, under: flatLayers.under.slice(), belly: flatLayers.belly.slice(), nipples: flatLayers.nipples.slice() };
  const arrays = (from, to) => [[from.label, to.label], [from.tone, to.tone], [from.owner, to.owner], [from.visibleBelly, to.visibleBelly]];
  if (fullRest) {
    const start = cut * W;
    for (const [src, dst] of [...arrays(fullRest, rest), [fullLayers.under, layers.under], [fullLayers.belly, layers.belly], [fullLayers.nipples, layers.nipples]]) dst.set(src.subarray(start, N), start);
    // 背侧过渡：袋口上下各 8 列，从当下的背线平滑地换成孕肚的背线（两边都推一部分），腰线才是一条连续的曲线
    const span = 8;
    const smooth = (k) => k * k * (3 - 2 * k);
    const targets = [rest.label, rest.tone, rest.owner, rest.visibleBelly, layers.under, layers.belly];
    for (let y = Math.max(0, cut - span); y < Math.min(H, cut + span); y += 1) {
      const flatBack = backOf(flatRest, y);
      const fullBack = backOf(fullRest, y);
      const target = Math.round(flatBack + (fullBack - flatBack) * smooth((y - (cut - span)) / (2 * span)));
      const current = y < cut ? flatBack : fullBack;
      const shift = target - current;
      if (!shift) continue;
      const front = frontOf(y < cut ? flatRest : fullRest, y);
      const from = Math.round(front + (current - front) * 0.7);
      for (const list of targets) {
        const row = list.slice(y * W, (y + 1) * W);
        for (let x = from; x < W; x += 1) list[y * W + x] = row[clamp(x - shift, from, W - 1)];
      }
    }
    // 两张取景框取联集，画框的位移照联集重算
    const a = flatLayers.view;
    const b = fullLayers.view;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const view = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
    Object.assign(layers, { view, offsetX: Math.floor((FRAME.width - view.w) / 2) - view.x, offsetY: FRAME.height - view.h - view.y });
    rest.view = view;
  }

  // ── 袋口 ──
  // 皮肤照成图的标记与明暗阶判断（不看画上去的颜色）：妊娠纹、孕中线、轮廓线不会把袋口截断；最外一圈描边不算
  const pixelAt = (x, y) => { const i = y * W + x; return layers.belly[i] || layers.under[i]; };
  const skinAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rest.label[y * W + x] === SKIN && pixelAt(x, y) !== layers.line;
  const toneAt = (x, y) => Math.min(rest.tone[y * W + x], layers.skin.length - 1);
  const put = (x, y, hex) => {
    x = Math.round(x); y = Math.round(y);
    if (!skinAt(x, y)) return;
    const i = y * W + x;
    if (layers.belly[i]) layers.belly[i] = rgba(hex); else layers.under[i] = rgba(hex);
  };
  const S = palette.skin;
  const open = Boolean(brood);
  // 孕肚越大（胎量：足月单胎＝1，每多一胎 +35%，最多 2），袋口占肚子的比例越短、弯得越浅
  const bulk = pregnant ? Math.min(2, ((Number(state.days) || 0) / 280) * (1 + 0.35 * (Math.max(1, Number(state.count) || 1) - 1))) : 0;
  const rowInfo = (row) => {
    let l = 0;
    while (l < W && !skinAt(l, row)) l += 1;
    l += 1;
    let e = l;
    while (e < W && skinAt(e, row)) e += 1;
    const wanted = Math.round(Math.max(10, Math.min(Math.round((e - l) * 0.85), Math.round(2 * ((crotch ?? l + 14) - l)))) * (1 - 0.3 * bulk));
    // 从前缘往后、没进侧腹阴影（最暗两阶）的长度
    let lit = 0;
    while (lit < wanted && skinAt(l + lit, row) && (lit < wanted * 0.5 || toneAt(l + lit, row) > 1)) lit += 1;
    return { left: l, wanted, lit };
  };
  // 大肚子时袋口那一列可能已经进到肚子底面的阴影：往上找到最凸处，亮面够长（八成）就开在那里
  let slitRow = cut;
  let info = rowInfo(slitRow);
  if (!open) for (let row = cut - 1; row >= tip && info.lit < info.wanted * 0.8; row -= 1) {
    const next = rowInfo(row);
    if (next.lit > info.lit) { slitRow = row; info = next; }
  }
  const left = info.left;
  let width = info.wanted;
  // 顺着肚子的弧往下弯：最低点在四成处；深度跟袋口宽成比例，孕肚越大越浅
  const sag = open ? 2.4 : Math.max(1.4, width * Math.max(0.03, 0.13 - 0.05 * bulk));
  const slitY = (v) => slitRow + Math.round(sag * Math.sin(Math.PI * Math.pow(clamp(v, 0, 1), 0.8)));
  // 尾端不画进侧腹阴影：过了一半碰到最暗的两阶或离开皮肤就收尾
  for (let k = 0; k <= width; k += 1) {
    const x = left + k;
    const y = slitY(k / width);
    if (!skinAt(x, y) || (k > width * 0.5 && toneAt(x, y) <= 1)) { width = Math.max(6, k - 1); break; }
  }
  // 袋里有东西：袋唇下方两列暗一阶（被袋唇盖住），中段张开两格
  if (open) for (let k = 0; k <= width; k += 1) {
    const x = left + k;
    for (let d = 2; d <= 3; d += 1) { const y = slitY(k / width) + d; if (skinAt(x, y)) { const tone = toneAt(x, y); if (tone > 0) put(x, y, S[Math.max(1, tone - 1)]); } }
  }
  for (let k = 0; k <= width; k += 1) {
    const v = k / width;
    const x = left + k;
    const y = slitY(v);
    put(x, y - 1, S[4]);
    put(x, y, v < 0.05 || v > 0.95 ? S[1] : palette.crease);
    if (open && v > 0.14 && v < 0.86) put(x, y + 1, palette.crease);
  }

  // 探头只有胎形：弧宽随恢复从袋口的一成长到七成，高度从 2 格长到约 5 格
  const peek = brood?.kind === 'fetus' ? {
    cx: left + width * 0.42, row: slitRow, left, width, rx: Math.max(2, width * (0.06 + 0.32 * recovery)), ry: 2.2 + 2.6 * recovery,
    slit: Array.from({ length: width + 1 }, (_, k) => slitY(k / width)),
    rim: rgba(S[3]), shadow: rgba(mixHex(palette.crease, '#000000', 0.25)),
  } : null;
  return { rest, layers, pouch: { row: slitRow, left, width, crotch, peek } };
}

/**
 * 探头（每一格）：约 5 秒一次、1.6 秒内从袋口冒出一段扁弧再缩回。
 * at(x, y) 把格点座标换成画框座标（跟着孕肚一起动），put(fx, fy, color) 写画框。
 */
export function paintPouchPeek(peek, now, at, put) {
  if (!peek) return;
  const cycle = (now / 1000) % 5;
  const rise = cycle < 1.6 ? Math.sin(Math.PI * cycle / 1.6) : 0;
  if (rise <= 0.1) return;
  const lift = rise * peek.ry;
  for (let x = Math.floor(peek.cx - peek.rx); x <= Math.ceil(peek.cx + peek.rx); x += 1) {
    const dx = (x - peek.cx) / peek.rx;
    if (Math.abs(dx) > 1) continue;
    const slit = peek.slit[clamp(Math.round(x - peek.left), 0, peek.slit.length - 1)];
    const top = Math.round(slit - lift * Math.sqrt(1 - dx * dx));
    for (let y = top; y < slit; y += 1) { const [fx, fy] = at(x, y); put(fx, fy, y === top ? peek.rim : peek.shadow); }
  }
}
