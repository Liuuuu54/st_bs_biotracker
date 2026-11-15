// 孕体特写的动画：状态改变时才算一次静止画面（belly_layout.js 成图＋belly_render.js 分层上色），
// 之后每一格只用「逐列位移」把静止画面搬到新位置，再叠上局部的效果，不重算成图。纯计算，不碰 DOM：
// tick(now) 回传画框大小的像素阵列，贴到 canvas 与排程（requestAnimationFrame）由呼叫端做。
//
// 条件在就一直循环的：
//   呼吸（活力、性欲、饿意、困意调节奏与深度）、胎动（每胎依份量、活力档、健康自己动）、
//   产程宫缩与用力（laborPhase 在产程各阶段时照间隔反复来）、产后宫缩痛、
//   哈欠与打瞌睡（困意）、扭动与短裤湿痕（泄意）、咕噜波纹（饿意）、漏奶与胸衣湿斑（乳意）、臭烟（臭意）。
// 由事件触发的（trigger）：
//   kick／big／roll：指定某一胎踢一下、用力一踢、翻身；
//   sibling：两胎互动（kick 踢、shove 推挤、cuddle 依偎），两胎的位置先后有动静；
//   falseContraction：假宫缩，接下来几分钟内不规律地来几次后自己停；
//   contraction：照当下产程阶段来一次；spray：喷乳（高潮等）。
//
// 节奏、幅度的数值移植自预览页 PREGNANCY_TRACE_NUDE.html。

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const NEED_FULL = 100 / 150;
const NEED_BURST = 125 / 150;
/** 需求（占上限的百分比）超过某一级多少：该级为 0，上限为 1 */
const needPast = (value, level) => clamp(((value ?? 0) / 100 - level) / (1 - level), 0, 1);
const MID_PRESSURE = 0.5 + 0.5 ** 1.35 * 5 + 0.5 * 1.5;

/** 胎儿活力四档：安静、一般、好动、激烈（次数、力道、用力一踢的比例） */
export const BELLY_FETAL_VIGOR = Object.freeze([
  { often: 0.4, hard: 0.7, big: 0 }, { often: 1, hard: 1, big: 0 }, { often: 1.8, hard: 1.25, big: 0 }, { often: 2.5, hard: 1.45, big: 0.35 },
]);
/** 宫缩的节奏（画面时间，秒）：间隔、长度、强度；calm 不影响呼吸，push 可用力 */
export const BELLY_LABOR = Object.freeze({
  braxton: { gap: [25, 70], dur: [6, 9], str: 0.35, calm: true },
  prodromal: { gap: [15, 40], dur: [8, 10], str: 0.5 },
  latent: { gap: [22, 26], dur: [8, 9], str: 0.55 },
  active: { gap: [15, 17], dur: [10, 11], str: 0.75 },
  transition: { gap: [10, 12], dur: [11, 12], str: 0.95 },
  descent: { gap: [12, 14], dur: [11, 12], str: 0.95, push: true },
  delivery: { gap: [12, 14], dur: [12, 13], str: 1, push: true },
  interval: { gap: [28, 32], dur: [7, 8], str: 0.5 },
  placenta: { gap: [18, 22], dur: [7, 8], str: 0.5, push: true },
});
/** 假宫缩一次触发后持续的时间（毫秒）：期间照 braxton 的间隔不规律地来 */
export const BELLY_BRAXTON_EPISODE_MS = 180000;
const DROP = { prodromal: 0.6, latent: 0.8, active: 0.8, transition: 0.8, descent: 1, delivery: 1, interval: 1 };
const contractionCurve = (t) => (t < 0.4 ? Math.sin(Math.PI / 2 * t / 0.4) : t < 0.6 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (t - 0.6) / 0.4));
const pushEfficiency = (fatigue) => (fatigue <= 60 ? 1 : Math.max(0.2, 1 - (fatigue - 60) / 40 * 0.8));
const yawnCurve = (t) => (t < 0.43 ? Math.sin(Math.PI / 2 * t / 0.43) : t < 0.66 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (t - 0.66) / 0.34));
const nodCurve = (t) => (t < 0.9 ? (t / 0.9) ** 2 : 1 - (t - 0.9) / 0.1);
// 4×4 有序抖动：宫缩加深的明暗随强度逐格换上
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// 决定静止画面的状态栏位：这些变了才重算成图
const SHAPE_KEYS = ['sigma', 'cup', 'build', 'hip', 'days', 'count', 'weight', 'pressure', 'showBra', 'showShorts', 'strapless',
  'hormStage', 'stageProgress', 'births', 'milk', 'libido', 'noMilk', 'laborPhase', 'ghost'];
const STILL = Object.freeze({ lift: 0, nippleLift: 0, jiggle: 0, nod: 0, squirm: 0, contraction: 0, push: 0, bumps: [], ripples: [] });

/**
 * @param layout createBellyLayout() 的结果
 * @param painter createBellyPainter(layout) 的结果
 * @param options { random: 乱数来源（测试用） }
 */
export function createBellyAnimator(layout, painter, { random = Math.random } = {}) {
  const { width: W, height: H, step: STEP, x0: X0, y0: Y0 } = layout.grid;
  const { SKIN, BRA, SHORTS } = layout.labels;
  const FRAME = painter.frame;
  const SIZE = FRAME.width * FRAME.height;
  const out = new Uint32Array(SIZE);
  // 画框每一格是从静止画面的哪一格搬来的（没有就是 −1），局部效果据此查明暗与材质
  const source = new Int32Array(SIZE);
  const rowMap = new Int16Array(H);
  const bellyRowMap = new Int16Array(H);
  const nippleRowMap = new Int16Array(H);
  const shiftX = new Int16Array(H);
  const bellyShiftX = new Int16Array(H);
  const nippleShiftX = new Int16Array(H);
  const moveYAt = new Float32Array(H);
  const between = ([a, b]) => a + (b - a) * random();
  const stats = { scenes: 0, ticks: 0, firmBuilds: 0 };

  let state = null;
  let palette;
  let scene = null;
  let shapeKey = '';
  // 孕前虚影平常不画：按住画面（滑鼠或手指）时才浮现
  let ghostShown = false;
  const motion = {
    phase: 0, last: 0, bumps: [], jiggles: [], bounces: [], squirms: [], yawns: [], nods: [], contractions: [], growls: [], drops: [], sprays: [], smokes: [],
    quiet: [], nextKick: 0, nextSquirm: 0, nextYawn: 0, nextNod: 0, nextContraction: 0, nextGrowl: 0, nextDrop: 0, nextSmoke: 0, braxtonUntil: 0, queue: [],
  };

  function buildScene() {
    const rest = layout.layout(state);
    const layers = painter.paintLayers(rest, palette);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (rest.visibleBelly[y * W + x]) { if (top < 0) top = y; bottom = y; break; }
    // 每列孕肚看得见的前后缘（胎动的位置用）
    const span = Array.from({ length: H }, (_, y) => { let l = -1; let r = -1; for (let x = 0; x < W; x += 1) if (rest.visibleBelly[y * W + x]) { if (l < 0) l = x; r = x; } return l < 0 ? null : [l, r]; });
    scene = { rest, layers, rows: rest.fig.rows, bellyTop: top, bellyBottom: bottom, span, firm: null, ghost: ghostOutline(rest) };
    motion.drops = [];
    stats.scenes += 1;
  }
  /**
   * 孕前虚影：state.ghost = { cup, build, hip }（孕前的身材）时，用同一套轮廓、孕肚 0 算一张外形，
   * 孕前的身体是虚的：外轮廓画成虚线、身体范围铺上斜条纹，叠在特写上；没有条纹的地方就是长出来的。
   * 静止不动；与当下几乎相同时不画。
   */
  function ghostOutline(rest) {
    const ghost = state.ghost;
    if (!ghost) return null;
    const before = layout.layout({ ...state, cup: ghost.cup, build: ghost.build, hip: ghost.hip, pressure: 0, days: 0, hormStage: 'cycle', laborPhase: 'none', ghost: undefined });
    const view = rest.view;
    const edge = (frame, x, y) => {
      const i = y * W + x;
      if (!frame.label[i]) return false;
      return x === 0 || x === W - 1 || y === H - 1 || !frame.label[i - 1] || !frame.label[i + 1] || !frame.label[i + W] || (y > view.y && !frame.label[i - W]);
    };
    const cells = [];
    const hatch = [];
    let apart = 0;
    for (let y = view.y; y < view.y + view.h; y += 1) for (let x = view.x; x < view.x + view.w; x += 1) {
      if (!edge(before, x, y)) continue;
      // 落在当下轮廓上的那几格不必画；虚线每三格空一格
      if (edge(rest, x, y)) continue;
      apart += 1;
      // 外轮廓也用点：隔一格点一点
      if ((x + y) % 2 === 0) cells.push(y * W + x);
    }
    if (apart < 12) return null;
    // 点阵虚影：孕前的身体是虚的那一个。孕前身体的范围用斜向排列的点铺出条纹（叠在现在的身体上），
    // 没有条纹的地方就是长出来的（孕肚、长大的胸与臀）
    for (let y = view.y; y < view.y + view.h; y += 1) for (let x = view.x; x < view.x + view.w; x += 1) {
      const i = y * W + x;
      // 点阵：沿斜线每隔一格点一点，远看是斜条纹，近看是一颗颗的点（不是实线）
      if (before.label[i] && (x + y) % 4 === 0 && x % 2 === 0) hatch.push(i);
    }
    return { outline: Int32Array.from(cells), hatch: Int32Array.from(hatch) };
  }

  /** 宫缩时孕肚变硬：打光的起伏加深三分之一。第一次宫缩时才多算一张孕肚层 */
  function firmBelly() {
    if (!scene.firm) {
      const hard = layout.compose({ ...scene.rest.fig, firm: 1 });
      scene.firm = painter.paintLayers(hard, palette).belly;
      stats.firmBuilds += 1;
    }
    return scene.firm;
  }

  /** 设定状态。形状没变时只换动作参数，不重算静止画面 */
  function setState(next, nextPalette) {
    const key = JSON.stringify(SHAPE_KEYS.map((name) => next[name]));
    const changed = !scene || key !== shapeKey || nextPalette !== palette;
    state = { vitality: 70, libido: 10, hunger: 20, sleep: 20, excretion: 20, uterine: 20, stress: 20, odor: 20, milk: 20, laborPhase: 'none', laborEffort: 'rest', pushFatigue: 0, vigor: 1, ...next };
    palette = nextPalette;
    if (changed) { shapeKey = key; buildScene(); }
  }

  // ---- 胎儿 ----
  /** 每一胎：{ size 份量, weight 胎重, vigor 活力档 0–3, health 健康 0–100, canMove, zone: {v,w} 在孕肚上的位置 } */
  function fetusList() {
    if (Array.isArray(state.fetuses)) return state.fetuses;
    const count = Math.max(1, Number(state.count) || 1);
    const size = (Number(state.days) || 0) / 280 * (Number(state.weight) || 1);
    return Array.from({ length: count }, () => ({ size, vigor: state.vigor ?? 1 }));
  }
  const afterBirth = () => state.laborPhase === 'placenta' || state.hormStage === 'postpartum';
  function fetalPace(fetus, total) {
    if (afterBirth() || fetus.canMove === false) return null;
    const size = fetus.size ?? 0;
    const quick = clamp((size - 0.42) / 0.28, 0, 1);
    if (quick <= 0) return null;
    const crowd = clamp((scene.rest.fig.bulk - 0.5) / 2.5, 0, 1);
    const eased = quick * quick * (3 - 2 * quick);
    const vigor = BELLY_FETAL_VIGOR[fetus.vigor ?? 1] ?? BELLY_FETAL_VIGOR[1];
    // 胎儿健康（0–100，50 是平常）：虚弱的胎动得少而轻，健壮的多而有力
    const health = clamp((fetus.health ?? 50) / 50, 0, 2);
    const often = clamp(health, 0.3, 1.3);
    const hard = clamp(0.6 + 0.4 * health, 0.5, 1.2);
    // 预览页的「× 胎数^0.6」是整窝的次数：平均摊给每一胎
    const perMinute = 8 * eased * (1 - 0.55 * crowd) * total ** 0.6 / total * (1 + 0.3 * state.stress / 100) * vigor.often * often;
    const grown = clamp((size - 0.5) / 0.6, 0, 1);
    const weight = fetus.weight ?? state.weight ?? 1;
    const amp = Math.min(2.2, (0.35 + 1.4 * grown) * weight ** 0.3 * (1 + 0.25 * state.uterine / 100)) * vigor.hard * hard;
    return { perMinute, amp, big: vigor.big };
  }
  /** 某一胎在孕肚正面的位置：v 由上到下 0–1，w 由前缘往背侧 0–1。没指定时依顺序由上到下分段 */
  function zoneOf(index, total) {
    const zone = fetusList()[index]?.zone;
    return { v: zone?.v ?? (index + 0.5) / total, w: zone?.w ?? null };
  }
  function addBump(index, kind, now, { toward = null, away = false, scale = 1 } = {}) {
    const list = fetusList();
    const fetus = list[index];
    if (!fetus) return false;
    const pace = fetalPace(fetus, list.length);
    if (!pace) return false;
    const zone = zoneOf(index, list.length);
    const v = zone.v + (random() - 0.5) * 0.3 / list.length;
    const around = (fallback) => (zone.w === null ? fallback : clamp(zone.w + (random() - 0.5) * 0.2, 0, 1));
    // toward：朝另一胎实际所在的方向滑过去（互动用；上下与前后都算，两胎不必挨着）。away：反过来，被对方挤开
    const other = toward === null ? null : zoneOf(toward, list.length);
    const side = away ? -1 : 1;
    const drift = other === null ? (random() < 0.5 ? -1 : 1) * 0.25 / list.length : (other.v - zone.v) * 0.6 * side;
    const lean = other === null ? null : ((other.w ?? 0.5) - (zone.w ?? 0.5)) * 0.6 * side;
    const amp = pace.amp * scale;
    if (kind === 'big') {
      motion.bumps.push({ start: now, dur: 380, v, w: around(random() < 0.4 ? 0 : 0.2 + random() * 0.5), drift: 0, driftW: 0, sigma: 2.3, amp: amp * 1.7, crease: true, fetus: index });
      motion.jiggles.push({ start: now + 120, size: Math.min(1.6, 0.5 + amp * 0.45) });
      spray(now + 120);
    } else if (kind === 'roll') {
      motion.bumps.push({ start: now, dur: 1600, v, w: around(0.2 + random() * 0.4), drift, driftW: lean === null ? (random() - 0.5) * 0.4 : lean, sigma: 3.5, amp: amp * 1.2, fetus: index });
    } else {
      motion.bumps.push({ start: now, dur: 450, v, w: around(random() < 0.25 ? 0 : 0.15 + random() * 0.65), drift: toward === null ? 0 : drift * 0.4, driftW: lean === null ? 0 : lean * 0.4, sigma: 1.6, amp, fetus: index });
    }
    return true;
  }
  /** 两胎互动：踢（一方用力、另一方缩一下再回踢）、推挤（一方滑过去、另一方被挤开）、依偎（两边轻轻靠拢）。两胎各在自己的位置上动，不必挨着 */
  function sibling(actor, target, interaction, now) {
    const list = fetusList();
    if (actor === target || !list[actor] || !list[target]) return false;
    if (!fetalPace(list[actor], list.length) || !fetalPace(list[target], list.length)) return false;
    const later = (delay, index, kind, options) => motion.queue.push({ at: now + delay, index, kind, options });
    if (interaction === 'kick') {
      addBump(actor, 'big', now, { toward: target });
      later(500, target, 'roll', { toward: actor, scale: 0.8 });
      later(1500, target, 'kick', { toward: actor });
    } else if (interaction === 'shove') {
      addBump(actor, 'roll', now, { toward: target });
      later(700, target, 'roll', { toward: actor, away: true, scale: 0.9 });
      later(2000, actor, 'kick', { toward: target, scale: 0.8 });
    } else if (interaction === 'cuddle') {
      addBump(actor, 'roll', now, { toward: target, scale: 0.5 });
      later(900, target, 'roll', { toward: actor, scale: 0.5 });
    } else return false;
    return true;
  }

  // ---- 宫缩 ----
  function afterpains() {
    if ((state.laborPhase && state.laborPhase !== 'none') || state.hormStage !== 'postpartum') return null;
    const q = clamp((state.stageProgress ?? 0) / 100, 0, 1);
    return q >= 0.3 ? null : { gap: [30, 60], dur: [7, 9], str: 0.3 * (1 - q / 0.3) + 0.08, calm: true };
  }
  function contract(now, phase) {
    const ph = phase || BELLY_LABOR[state.laborPhase] || afterpains() || { dur: [8, 10], str: 0.6 };
    motion.contractions.push({ start: now, dur: between(ph.dur) * 1000, str: ph.str, calm: !!ph.calm });
  }
  function laborNow(now) {
    let c = 0;
    let p = 0;
    let calm = true;
    for (const k of motion.contractions) {
      const t = (now - k.start) / k.dur;
      if (t < 0 || t > 1) continue;
      const v = k.str * contractionCurve(t);
      if (v > c) { c = v; calm = k.calm; }
      if (state.laborEffort === 'push' && !k.calm) {
        const n = k.dur > 9500 ? 3 : 2;
        for (let j = 0; j < n; j += 1) { const mid = 0.3 + j * 0.55 / (n - 1); const u = (t - mid) / 0.14 + 0.5; if (u > 0 && u < 1) p = Math.max(p, Math.sin(Math.PI * u) * pushEfficiency(state.pushFatigue)); }
      }
    }
    return { c, p, calm };
  }

  function breathing() {
    const v = state.vitality / 100;
    const l = state.libido / 100;
    const hu = needPast(state.hunger, NEED_FULL);
    const sl = needPast(state.sleep, NEED_FULL);
    const dr = DROP[state.laborPhase] || 0;
    return {
      rpm: clamp(15 + 15 * l - 4 * (1 - v) - 2 * hu - 3 * sl, 10, 32),
      depth: clamp((1 + 0.5 * l) * (0.75 + 0.25 * v) * (1 - 0.25 * hu) * (1 + 0.25 * sl) * (1 + 0.2 * dr), 0.35, 1.6),
      tired: v < 0.4,
    };
  }

  // ---- 乳意 ----
  const milkFill = () => (state.noMilk ? 0 : clamp((state.milk ?? 0) / 100, 0, 1));
  const milkFlow = () => (state.noMilk ? 0 : state.hormStage === 'postpartum' ? 1 : state.hormStage === 'pseudo' ? 0.6 : state.hormStage === 'cycle' ? 0 : clamp(((Number(state.days) || 0) - 112) / 168, 0, 1));
  const clothedTop = () => state.showBra !== false;
  /** 一滴奶的路径（静止画面上算一次）：近侧沿轮廓流再落下，远侧流到乳下折；穿胸衣时从下摆滴出 */
  function milkPath(spot, near, clothed) {
    const L = scene.rest.label;
    const edge = (y) => { for (let x = 0; x < W; x += 1) if (L[y * W + x]) return x; return -1; };
    const path = [];
    let x = Math.round(near ? spot.edge ?? spot.x : spot.x);
    let y = Math.round(spot.y) + 1;
    if (clothed) { if (near) x += 1; while (y < H && L[y * W + x] === BRA) y += 1; }
    if (near && !clothed) {
      let free = false;
      for (; y < H && path.length < 60; y += 1) {
        if (!free) { const e = edge(y); if (e < 0) break; if (e > x || path.length >= 15) free = true; else { x = e; path.push([x, y, 0]); continue; } }
        if (L[y * W + x]) { path.push([x, y - 1, 2]); break; }
        path.push([x, y, 1]);
      }
    } else {
      const lobe = !near && !clothed ? scene.rest.fig._lobes?.list?.[1] : null;
      for (let k = 0; y < H && k < (clothed ? 12 : 30); y += 1, k += 1) {
        const v = L[y * W + x];
        if (!v) { path.push([x, y, 1]); continue; }
        if (v !== SKIN || (lobe && !lobe[y * W + x])) { path.push([x, y - 1, 2]); break; }
        path.push([x, y, 0]);
      }
    }
    let t = 600;
    const times = path.map(([, , how]) => (t += how === 1 ? 40 : 200));
    return { path, times, end: t + 900 };
  }
  function spawnMilk(now) {
    const spots = scene.rest.nipples;
    if (!spots.length) return;
    const clothed = clothedTop();
    if (clothed && milkFill() < NEED_BURST) return;
    const near = clothed || spots.length < 2 || random() < 0.6;
    const spot = near ? spots[0] : spots[1];
    const p = milkPath(spot, near, clothed);
    if (!p.path.length) return;
    motion.drops.push({ start: now, bead: clothed ? null : [Math.round(near ? (spot.edge ?? spot.x) - 1 : spot.x), Math.round(spot.y)], ...p });
  }
  /** 喷乳：没穿上衣、会泌乳、乳意过「满」时，两侧乳头往前喷出几点 */
  function spray(now) {
    const [near, far] = scene.rest.nipples;
    if (!near || clothedTop() || !milkFlow() || milkFill() < NEED_FULL) return false;
    const jet = (x, y, n, speed) => { for (let k = 0; k < n; k += 1) motion.sprays.push({ start: now, x, y, vx: -speed * (0.6 + random() * 0.7), vy: -(1 + random() * 4), life: 500 + random() * 400 }); };
    jet(near.edge != null ? near.edge - 1 : Math.round(near.x) - 1, Math.round(near.y), 8, 14);
    if (far) jet(Math.round(far.x) - 1, Math.round(far.y), 6, 7);
    return true;
  }

  /** 推进排程：到时间的胎动、宫缩、哈欠、打瞌睡、扭动、咕噜、漏奶、臭烟各自发生 */
  function advance(now) {
    const dt = motion.last ? Math.min(500, now - motion.last) : 0;
    motion.last = now;
    const lab = laborNow(now);
    const drowsy = needPast(state.sleep, NEED_BURST);
    const laborBreath = (lab.calm ? 0 : 1.2 * lab.c) + 0.4 * clamp((state.pushFatigue - 60) / 40, 0, 1) * (state.laborPhase !== 'none' ? 1 : 0);
    motion.phase += dt / 60000 * breathing().rpm * (1 + 0.25 * drowsy * Math.sin(now / 2300) * Math.sin(now / 3700)) * (1 + laborBreath) * 2 * Math.PI;
    motion.bumps = motion.bumps.filter((k) => now - k.start < k.dur);
    motion.jiggles = motion.jiggles.filter((j) => now - j.start < 1200);
    motion.bounces = motion.bounces.filter((b) => now - b.start < 1200);
    motion.squirms = motion.squirms.filter((q) => now - q.start < 900);
    motion.yawns = motion.yawns.filter((e) => now - e.start < e.dur);
    motion.nods = motion.nods.filter((e) => now - e.start < e.dur);
    motion.contractions = motion.contractions.filter((k) => now - k.start < k.dur);
    motion.growls = motion.growls.filter((g) => now - g.start < g.dur);
    motion.drops = motion.drops.filter((d) => now - d.start < d.end);
    motion.sprays = motion.sprays.filter((p) => now - p.start < p.life);
    motion.smokes = motion.smokes.filter((p) => now - p.start < p.life);
    // 互动里排在后面的动作
    motion.queue = motion.queue.filter((item) => { if (now < item.at) return true; addBump(item.index, item.kind, now, item.options); return false; });
    // 胎动：整窝的次数合起来排，到时间时依各胎的次数比例抽一胎
    const list = fetusList();
    // 事件正在演的那一胎（与演完后的一小段空档）不排待机的胎动，免得随机的小踢盖过事件
    const paces = list.map((fetus, index) => ((motion.quiet[index] || 0) > now ? null : fetalPace(fetus, list.length)));
    const perMinute = paces.reduce((sum, pace) => sum + (pace ? pace.perMinute : 0), 0);
    if (perMinute <= 0) motion.nextKick = 0;
    else {
      if (!motion.nextKick) motion.nextKick = now + 60000 / perMinute * (0.5 + random());
      if (now >= motion.nextKick) {
        let pick = random() * perMinute;
        let index = 0;
        for (let i = 0; i < paces.length; i += 1) { if (!paces[i]) continue; index = i; pick -= paces[i].perMinute; if (pick <= 0) break; }
        addBump(index, random() < paces[index].big ? 'big' : 'kick', now);
        motion.nextKick = now + 60000 / perMinute * (0.5 + random());
      }
    }
    const every = (key, on, rate, fire) => {
      if (!on || rate <= 0) { motion[key] = 0; return; }
      if (!motion[key]) motion[key] = now + 60000 / rate * (0.3 + 0.7 * random());
      if (now >= motion[key]) { fire(); motion[key] = now + 60000 / rate * (0.5 + random()); }
    };
    every('nextSquirm', state.excretion / 100 >= NEED_FULL, (1 + 7 * needPast(state.excretion, NEED_FULL)) * (1 + state.uterine / 100) * (1 + 0.5 * (DROP[state.laborPhase] || 0)),
      () => motion.squirms.push({ start: now, size: (random() < 0.5 ? -1 : 1) * (0.6 + 0.6 * needPast(state.excretion, NEED_FULL)) }));
    every('nextYawn', state.sleep / 100 >= NEED_FULL, 1 + 3 * needPast(state.sleep, NEED_FULL),
      () => { motion.yawns.push({ start: now, dur: 3500 }); motion.bounces.push({ start: now + 0.66 * 3500, size: 0.9 }); });
    every('nextNod', state.sleep / 100 >= NEED_BURST, 1 + 3 * needPast(state.sleep, NEED_BURST),
      () => { motion.nods.push({ start: now, dur: 2800 }); motion.bounces.push({ start: now + 0.9 * 2800, size: 1.6 }); });
    // overlays: false 时不叠需求类的效果（咕噜、漏奶、湿痕、臭烟），只留身体的动作
    const effects = state.overlays !== false;
    every('nextGrowl', effects && state.hunger / 100 >= NEED_FULL, 1 + 9 * needPast(state.hunger, NEED_FULL), () => motion.growls.push({ start: now, dur: 1100 + random() * 500 }));
    every('nextSmoke', effects && state.odor / 100 >= NEED_FULL, 12 + 48 * needPast(state.odor, NEED_FULL), () => {
      const from = ['arm', 'crotch', 'seat', 'fold'][Math.floor(random() * 4)];
      for (let k = 0; k < 2; k += 1) motion.smokes.push({ start: now + k * 250, life: 3500, from, seed: random() * 6.3 });
    });
    const flow = milkFlow();
    const fill = milkFill();
    every('nextDrop', effects && flow > 0 && fill >= NEED_FULL, flow * (fill >= NEED_BURST ? 6 + 108 * (fill - NEED_BURST) : 1.5 + 27 * (fill - NEED_FULL)), () => spawnMilk(now));
    // 宫缩：产程各阶段、产后宫缩痛照间隔反复来；假宫缩在触发后的一段时间内（或 laborPhase 设成 braxton 时）也是
    const phase = BELLY_LABOR[state.laborPhase] || (now < motion.braxtonUntil ? BELLY_LABOR.braxton : null) || afterpains();
    if (!phase) motion.nextContraction = 0;
    else {
      if (!motion.nextContraction) motion.nextContraction = now + between(phase.gap) * 1000 * 0.4;
      if (now >= motion.nextContraction) { contract(now, phase); motion.nextContraction = now + between(phase.gap) * 1000; }
    }
  }

  /** 这一刻的动作量（格） */
  function motionNow(now) {
    const b = breathing();
    const cycle = Math.floor(motion.phase / (2 * Math.PI));
    const sigh = b.tired && cycle % 6 === 5 ? 1.8 : 1;
    const breath = b.depth * sigh * (0.5 - 0.5 * Math.cos(motion.phase));
    const wobble = (list, at) => list.reduce((n, j) => { const t = at - j.start; return t < 0 ? n : n + j.size * Math.exp(-t / 260) * Math.sin(2 * Math.PI * t / 180); }, 0);
    const jiggle = wobble(motion.jiggles, now);
    const bounce = wobble(motion.bounces, now);
    // 乳头比乳房慢半拍（软组织跟不上晃动），而且甩得更开
    const lagged = wobble(motion.jiggles, now - 70) + wobble(motion.bounces, now - 70);
    const squirm = motion.squirms.reduce((n, q) => { const t = now - q.start; return t < 0 ? n : n + q.size * Math.exp(-t / 220) * Math.sin(2 * Math.PI * t / 170); }, 0);
    const along = (list, curve) => list.reduce((n, e) => { const t = (now - e.start) / e.dur; return t < 0 || t > 1 ? n : n + curve(t); }, 0);
    const lab = laborNow(now);
    const steady = Math.max(breath * (lab.calm ? 1 : 1 - 0.5 * lab.c), 0.9 * lab.p) + 2.2 * along(motion.yawns, yawnCurve);
    return {
      lift: steady + 0.7 * (jiggle + bounce), nippleLift: steady + 0.7 * 1.3 * lagged,
      jiggle, nod: Math.min(1, along(motion.nods, nodCurve)), squirm: squirm + 0.35 * lab.p * Math.sin(2 * Math.PI * now / 110),
      contraction: lab.c, push: lab.p,
      bumps: motion.bumps.map((k) => { const t = clamp((now - k.start) / k.dur, 0, 1); const swell = Math.sin(Math.PI * t); return { v: k.v + k.drift * t, w: k.w + k.driftW * t, sigma: k.sigma, amp: k.amp * swell, crease: k.crease ? swell : 0, fetus: k.fetus }; }),
      ripples: motion.growls.map((g) => (now - g.start) / g.dur).filter((t) => t >= 0 && t <= 1),
    };
  }

  // 目的列 ← 来源列：来源列各自搬到新位置后，空出来的目的列沿用下一个来源列，重叠的由后面的盖过
  function fillRowMap(map, destOf) {
    map.fill(-1);
    let last = -1;
    for (let s = 0; s < H; s += 1) {
      const d = destOf(s);
      for (let y = Math.max(0, last + 1); y <= d && y < H; y += 1) map[y] = s;
      if (d >= 0 && d < H) map[d] = s;
      last = Math.max(last, d);
    }
  }

  /** 用位移把静止画面搬成这一刻的画面，再叠上局部效果 */
  function compose(m, now) {
    const { layers, rows, bellyTop, bellyBottom, span, rest } = scene;
    const { view, offsetX, offsetY } = layers;
    const liftAt = (lift, y) => lift * clamp((rows.ubRow + 4 - y) / 8, 0, 1);
    const nodAt = (y) => m.nod * clamp((rows.waistRow - y) / Math.max(1, rows.waistRow - rows.neckRow), 0, 1);
    const squirmAt = (y) => m.squirm * clamp((y - rows.waistRow) / Math.max(1, rows.hipRow - rows.waistRow), 0, 1);
    const moveX = (y, lift = m.lift) => -0.4 * liftAt(lift, y) - 1.5 * nodAt(y) + squirmAt(y);
    const moveY = (y, lift = m.lift) => -liftAt(lift, y) + 1.2 * nodAt(y);
    // 孕肚另外的位移：呼吸时略往前、用力一踢后的晃动、宫缩往上收并往前凸、用力往下压
    const bellyMove = (y) => {
      const v = bellyBottom > bellyTop ? clamp((y - bellyTop) / (bellyBottom - bellyTop), 0, 1) : 0;
      const c = m.contraction;
      const p = m.push;
      return [
        -0.2 * m.lift * Math.exp(-0.5 * ((y - rows.navelRow) / 22) ** 2) - 0.5 * m.jiggle - (c + 1.2 * p) * Math.sin(Math.PI * v),
        0.6 * m.jiggle - 1.6 * c * (1 - v) + 1.8 * p * (1 - v) * Math.min(1, 2 * v + 0.3),
      ];
    };
    for (let y = 0; y < H; y += 1) {
      moveYAt[y] = moveY(y);
      shiftX[y] = Math.round(moveX(y));
      bellyShiftX[y] = Math.round(moveX(y) + bellyMove(y)[0]);
      nippleShiftX[y] = Math.round(moveX(y, m.nippleLift));
    }
    fillRowMap(rowMap, (s) => Math.round(s + moveYAt[s]));
    fillRowMap(bellyRowMap, (s) => Math.round(s + moveYAt[s] + bellyMove(s)[1]));
    fillRowMap(nippleRowMap, (s) => Math.round(s + moveY(s, m.nippleLift)));
    out.fill(layers.background);
    source.fill(-1);
    const { under, nipples } = layers;
    const soft = layers.belly;
    const firmness = clamp(m.contraction, 0, 1);
    const hard = firmness > 0.02 ? firmBelly() : null;
    for (let y = view.y; y < view.y + view.h; y += 1) {
      const fy = y + offsetY;
      if (fy < 0 || fy >= FRAME.height) continue;
      const s = rowMap[y];
      const sb = bellyRowMap[y];
      const sn = nippleRowMap[y];
      for (let x = view.x; x < view.x + view.w; x += 1) {
        const fx = x + offsetX;
        if (fx < 0 || fx >= FRAME.width) continue;
        const at = fy * FRAME.width + fx;
        if (s >= 0) { const sx = x - shiftX[s]; if (sx >= 0 && sx < W) { const pixel = under[s * W + sx]; if (pixel) { out[at] = pixel; source[at] = s * W + sx; } } }
        if (sb >= 0) {
          const sx = x - bellyShiftX[sb];
          if (sx >= 0 && sx < W) {
            const i = sb * W + sx;
            const pixel = hard && BAYER[(sb & 3) * 4 + (sx & 3)] < firmness * 16 ? hard[i] || soft[i] : soft[i];
            if (pixel) { out[at] = pixel; source[at] = i; }
          }
        }
        if (sn >= 0) { const sx = x - nippleShiftX[sn]; if (sx >= 0 && sx < W) { const pixel = nipples[sn * W + sx]; if (pixel) { out[at] = pixel; source[at] = -1; } } }
      }
    }
    // 孕前虚影：叠在身体上面（孕前的身体比较小，画在后面会整个被盖住），自己不跟着动
    if (ghostShown && scene.ghost) for (const list of [scene.ghost.hatch, scene.ghost.outline]) for (const i of list) { const fx = i % W + offsetX; const fy = Math.floor(i / W) + offsetY; if (fx >= 0 && fx < FRAME.width && fy >= 0 && fy < FRAME.height && (list === scene.ghost.outline || out[fy * FRAME.width + fx] !== layers.background)) out[fy * FRAME.width + fx] = layers.ghost; }
    // 格点座标的一点（静止位置）现在在画框的哪一格
    const framed = (x, y) => { const row = clamp(Math.round(y), 0, H - 1); return [Math.round(x) + shiftX[row] + offsetX, Math.round(y + moveYAt[row]) + offsetY]; };
    const inView = (fx, fy) => fx >= view.x + offsetX && fx < view.x + view.w + offsetX && fy >= Math.max(0, view.y + offsetY) && fy < FRAME.height;
    const put = (fx, fy, color) => { if (inView(fx, fy)) out[fy * FRAME.width + fx] = color; };
    const material = (at) => (source[at] < 0 ? 0 : rest.label[source[at]]);
    /** 把这一格皮肤的明暗改一阶（轮廓、线条、肚脐不改） */
    const shade = (at, by) => {
      const from = source[at];
      if (from < 0 || rest.label[from] !== SKIN) return false;
      const tone = Math.min(rest.tone[from], layers.skin.length - 1);
      if (out[at] !== layers.skin[tone]) return false;
      out[at] = layers.skin[clamp(tone + by, 1, layers.skin.length - 1)];
      return true;
    };

    // 胎动鼓包：孕肚表面上的一点，朝光的一侧（左上）亮一阶、背光的一侧暗一阶；落在前缘的还把轮廓推出去；
    // 用力一踢把皮肤撑紧，鼓包背光那一侧多一圈折痕
    const hits = [];
    for (const bump of m.bumps) {
      if (bellyTop < 0 || bump.amp <= 0.05) continue;
      const row = Math.round(bellyTop + (bellyBottom - bellyTop) * (0.06 + 0.88 * clamp(bump.v, 0, 1)));
      const edge = span[row];
      if (!edge) continue;
      const w = clamp(bump.w ?? 0, 0, 1);
      const cx = Math.round(edge[0] + (edge[1] - edge[0]) * 0.75 * w) + bellyShiftX[row] + offsetX;
      const cy = row + Math.round(moveYAt[row] + bellyMove(row)[1]) + offsetY;
      hits.push({ x: cx, y: cy, fetus: bump.fetus, amp: bump.amp });
      const radius = Math.ceil(bump.sigma * 3);
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const fx = cx + dx;
          const fy = cy + dy;
          if (fx < 0 || fx >= FRAME.width || fy < 0 || fy >= FRAME.height) continue;
          const at = fy * FRAME.width + fx;
          if (source[at] < 0 || !rest.visibleBelly[source[at]]) continue;
          const distance = Math.hypot(dx, dy);
          const slope = bump.amp * (-(dx + dy) / (bump.sigma * Math.SQRT2)) * Math.exp(-(distance * distance) / (2 * bump.sigma * bump.sigma));
          const ring = bump.crease > 0.3 && dx + dy > 0 && Math.abs(distance - 1.9 * bump.sigma) < 0.6;
          const lit = ring ? -1 : slope > 0.3 ? 1 : slope < -0.3 ? -1 : 0;
          if (lit) shade(at, lit);
        }
      }
      if (w <= 0.12) {
        for (let dy = -Math.ceil(bump.sigma * 2); dy <= Math.ceil(bump.sigma * 2); dy += 1) {
          const reach = Math.min(2, Math.round(bump.amp * Math.exp(-(dy * dy) / (2 * bump.sigma * bump.sigma))));
          const fy = cy + dy;
          if (reach <= 0 || fy < 0 || fy >= FRAME.height) continue;
          let front = -1;
          for (let fx = 0; fx < FRAME.width; fx += 1) { const from = source[fy * FRAME.width + fx]; if (from >= 0) { front = rest.visibleBelly[from] ? fx : -1; break; } }
          if (front < reach) continue;
          const inner = out[fy * FRAME.width + front + 1];
          for (let k = 0; k < reach; k += 1) out[fy * FRAME.width + front - k] = inner;
          out[fy * FRAME.width + front - reach] = layers.line;
        }
      }
    }

    // 咕噜（饿意）：肚脐上方一小块椭圆里，几道斜的波纹往背侧跑过去；孕肚越大这一块越往胸下、往侧腹移
    if (m.ripples.length) {
      const fig = rest.fig;
      const gnx = (fig.navel[0] - X0) / STEP;
      const gny = (fig.navel[1] - Y0) / STEP;
      const up = clamp((fig.pressure - MID_PRESSURE) / (7 - MID_PRESSURE), 0, 1);
      const k = fig.size || 1;
      const low = gny - 0.35 * Math.max(0, gny - rows.ubRow);
      const y0 = low + (rows.ubRow + 4 - low) * up;
      const row = clamp(Math.round(y0), 0, H - 1);
      let front = -1;
      let back = -1;
      for (let x = 0; x < W; x += 1) if (rest.owner[row * W + x] === 1 || rest.owner[row * W + x] === 3) { if (front < 0) front = x; back = x; }
      const x0 = gnx + 3 + (front >= 0 ? (front + (back - front) * 0.3 - gnx - 3) * up : 0);
      const rx = (8 - 2 * up) * k;
      const ry = (5 - 2 * up) * k;
      const [cx, cy] = framed(x0, y0);
      for (const t of m.ripples) {
        const swell = Math.sin(Math.PI * t);
        const phase = 2 * Math.PI * 3 * t;
        for (let dy = -Math.ceil(ry * 1.5); dy <= ry * 1.5; dy += 1) {
          for (let dx = -Math.ceil(rx * 1.5); dx <= rx * 1.5; dx += 1) {
            const fx = cx + dx;
            const fy = cy + dy;
            if (fx < 0 || fx >= FRAME.width || fy < 0 || fy >= FRAME.height) continue;
            const wave = swell * Math.exp(-2 * ((dx / rx) ** 2 + (dy / ry) ** 2)) * Math.sin(2 * Math.PI * (dx + 0.35 * dy) / (4 * k) - phase);
            if (wave > 0.3) shade(fy * FRAME.width + fx, 1); else if (wave < -0.3) shade(fy * FRAME.width + fx, -1);
          }
        }
      }
    }

    // 胸衣湿斑（乳意过「满」）：两个乳头上的深色斑，越满越大
    const flow = milkFlow();
    const fill = milkFill();
    const effects = state.overlays !== false;
    if (effects && clothedTop() && flow > 0 && fill >= NEED_FULL) {
      const r = 1 + 3 * clamp((fill - NEED_FULL) / (1 - NEED_FULL), 0, 1);
      for (const spot of rest.nipples) {
        const [cx, cy] = framed(spot.x, spot.y);
        for (let dy = -Math.ceil(r); dy <= r; dy += 1) for (let dx = -Math.ceil(r); dx <= r; dx += 1) {
          const fx = cx + dx;
          const fy = cy + dy;
          if (!inView(fx, fy) || material(fy * FRAME.width + fx) !== BRA) continue;
          const d = Math.hypot(dx, dy * 1.2);
          if (d <= r) out[fy * FRAME.width + fx] = d > r - 1 ? layers.bra[1] : layers.bra[0];
        }
      }
    }
    // 奶滴：先在乳头凝成一珠，再沿皮肤流（留下一道亮的湿痕），离开皮肤后落下
    for (const drop of motion.drops) {
      const t = now - drop.start;
      if (drop.bead && t < drop.times[0] + 200) { const [fx, fy] = framed(...drop.bead); put(fx, fy, layers.milk[0]); if (t > 300) put(fx, fy + 1, layers.milk[1]); continue; }
      let at = -1;
      drop.path.forEach(([x, y, how], index) => {
        const since = t - drop.times[index];
        if (since < 0) return;
        at = index;
        if (how === 0 && since < 1500) { const [fx, fy] = framed(x, y); if (inView(fx, fy) && material(fy * FRAME.width + fx) === SKIN) out[fy * FRAME.width + fx] = layers.skin[4]; }
      });
      if (at >= 0 && t < drop.end) { const [x, y, how] = drop.path[at]; const [fx, fy] = framed(x, y); put(fx, fy, layers.milk[0]); if (how === 0) put(fx, fy - 1, layers.milk[1]); }
    }
    for (const p of motion.sprays) {
      const t = (now - p.start) / 1000;
      if (t < 0 || t * 1000 > p.life) continue;
      const [fx, fy] = framed(p.x + p.vx * t, p.y + p.vy * t + 20 * t * t);
      put(fx, fy, layers.milk[t < 0.2 ? 0 : 1]);
    }

    // 短裤湿痕（泄意过「爆」）：胯下一块深色，越急越大
    const groin = rest.fig.restGroin;
    if (effects && state.showShorts !== false && groin && state.excretion / 100 >= NEED_BURST) {
      const r = 1 + 4 * needPast(state.excretion, NEED_BURST);
      const tip = groin.points.reduce((a, p) => (p[1] > a[1] ? p : a));
      const [gx, gy] = rest.fig.warpPoint([(tip[0] - X0) / STEP, (tip[1] - Y0) / STEP]);
      const [cx, cy] = framed(gx, gy - 1);
      for (let dy = -Math.ceil(r); dy <= r; dy += 1) for (let dx = -Math.ceil(r * 1.3); dx <= r * 1.3; dx += 1) {
        const fx = cx + dx;
        const fy = cy + dy;
        if (!inView(fx, fy) || material(fy * FRAME.width + fx) !== SHORTS) continue;
        const d = Math.hypot(dx / 1.3, dy);
        if (d <= r) out[fy * FRAME.width + fx] = d > r - 1 ? layers.shorts[1] : layers.shorts[0];
      }
    }

    // 臭烟（臭意过「满」）：从腋下、胯下前方、臀部、肚子下缘冒出，往身体外侧飘、往上升；过「爆」再加波浪状的臭味线
    if (effects && (motion.smokes.length || state.odor / 100 >= NEED_BURST)) {
      const filled = (fx, fy) => fx >= 0 && fx < FRAME.width && fy >= 0 && fy < FRAME.height && source[fy * FRAME.width + fx] >= 0;
      const backOf = (fy) => { for (let fx = FRAME.width - 1; fx >= 0; fx -= 1) if (filled(fx, fy)) return fx; return -1; };
      const frontOf = (fy) => { for (let fx = 0; fx < FRAME.width; fx += 1) if (filled(fx, fy)) return fx; return -1; };
      const top = Math.max(0, view.y + offsetY);
      const tip = groin ? (() => { const low = groin.points.reduce((a, p) => (p[1] > a[1] ? p : a)); return framed(...rest.fig.warpPoint([(low[0] - X0) / STEP, (low[1] - Y0) / STEP])); })() : null;
      const origin = (from) => {
        if (from === 'arm') { const fy = top + 12; return [backOf(fy) + 1, fy, 1]; }
        if (from === 'seat') { const fy = FRAME.height - 6; return [backOf(fy) + 1, fy, 1]; }
        if (!tip) return null;
        if (from === 'crotch') { const fy = Math.min(FRAME.height - 2, tip[1] - 3); return [frontOf(fy) - 1, fy, -1]; }
        for (let fy = tip[1] - 3; fy > top; fy -= 1) { const from2 = source[fy * FRAME.width + tip[0]]; if (from2 >= 0 && rest.visibleBelly[from2]) return [tip[0] - 4, fy + 1, -1]; }
        return null;
      };
      for (const puff of motion.smokes) {
        const t = (now - puff.start) / puff.life;
        if (t < 0 || t > 1) continue;
        const from = origin(puff.from);
        if (!from || from[0] < 1) continue;
        const [x0, y0, dir] = from;
        for (let k = 0; k < 5; k += 1) {
          const a = t * puff.life / 1000 - 0.12 * k;
          if (a < 0) continue;
          const fx = Math.round(x0 + dir * 1.5 * a + 1.2 * Math.sin(a * 5 + puff.seed));
          const fy = Math.round(y0 - 5 * a);
          if (t > 0.7 && (fx + fy) % 2) continue;
          const color = layers.smoke[Math.min(2, (k >> 1) + (t > 0.7 ? 1 : 0))];
          put(fx, fy, color);
          if (t < 0.7) put(fx + dir, fy, color);
        }
      }
      if (state.odor / 100 >= NEED_BURST) {
        for (const name of ['arm', 'crotch']) {
          const from = origin(name);
          if (!from || from[0] < 1) continue;
          const [x0, y0, dir] = from;
          for (let j = 0; j < 3; j += 1) {
            const ph = ((now / 1000 + j * 0.6) % 2) / 2;
            for (let k = 0; k < 5; k += 1) { const fy = Math.round(y0 - 2 - ph * 10 - k); const fx = Math.round(x0 + dir * (2 + 3 * j) + Math.sin((fy + now / 150) * 0.9)); if (ph < 0.8 || k % 2) put(fx, fy, layers.smoke[1]); }
          }
        }
      }
    }
    return hits;
  }

  /**
   * 推进到 now（毫秒）并画出这一格。
   * @returns { pixels, width, height, bumps: 这一格的胎动位置（画框座标，含是哪一胎）, motion }
   */
  function tick(now, { still = false } = {}) {
    if (!scene) throw new Error('belly animator: setState() 尚未呼叫');
    stats.ticks += 1;
    if (!still) advance(now);
    const m = still ? STILL : motionNow(now);
    const bumps = compose(m, now);
    return { pixels: out, width: FRAME.width, height: FRAME.height, bumps, motion: m };
  }

  /**
   * 事件：
   *   kick／big／roll：{ fetus } 指定那一胎踢一下、用力一踢、翻身；
   *   sibling：{ actor, target, interaction: 'kick'|'shove'|'cuddle' } 两胎互动；
   *   falseContraction：假宫缩，现在来一次，之后 episodeMs（预设三分钟）内不规律地再来几次；episodeMs 给 0 就只播一次；
   *   contraction：照当下产程阶段来一次；spray：喷乳；
   *   orgasm：高潮（乳摇三下、孕肚绷紧一次、会泌乳时喷乳）；thrust：{ count, reach } 抽送几下（每下乳摇、孕肚轻晃；reach 为真时最下面的一胎被顶得晃、之后回踢）。
   */
  function trigger(type, { fetus = 0, actor = 0, target = 1, interaction = 'kick', episodeMs = BELLY_BRAXTON_EPISODE_MS, count = 3, reach = false, now = motion.last || 0 } = {}) {
    if (!scene) return false;
    // 事件盖过待机胎动：那一胎在事件演完后再安静 2.5 秒；互动的两胎都是
    const hush = (index, ms) => { motion.quiet[index] = Math.max(motion.quiet[index] || 0, now + ms); };
    if (type === 'kick' || type === 'big' || type === 'roll') {
      if (!addBump(fetus, type, now)) return false;
      hush(fetus, (type === 'roll' ? 1600 : type === 'big' ? 1300 : 450) + 2500);
      return true;
    }
    if (type === 'sibling') {
      if (!sibling(actor, target, interaction, now)) return false;
      hush(actor, 3600 + 2500);
      hush(target, 3600 + 2500);
      return true;
    }
    if (type === 'falseContraction') {
      contract(now, BELLY_LABOR.braxton);
      motion.braxtonUntil = now + episodeMs;
      motion.nextContraction = episodeMs > 0 ? now + between(BELLY_LABOR.braxton.gap) * 1000 : 0;
      return true;
    }
    if (type === 'contraction') { contract(now); return true; }
    if (type === 'orgasm') {
      // 高潮：乳房连着弹三下（一下比一下小）、孕肚短暂绷紧一次（不影响呼吸）、会泌乳时喷乳
      [[0, 1.4], [350, 0.9], [700, 0.6]].forEach(([delay, size]) => motion.bounces.push({ start: now + delay, size }));
      motion.contractions.push({ start: now, dur: 3000, str: 0.25, calm: true });
      spray(now + 150);
      return true;
    }
    if (type === 'thrust') {
      // 抽送：每一下乳房弹一下、孕肚轻晃一下
      const times = Math.max(1, count);
      for (let k = 0; k < times; k += 1) { motion.bounces.push({ start: now + k * 360, size: 0.6 }); motion.jiggles.push({ start: now + k * 360, size: 0.3 }); }
      // 顶得到宫颈口时（reach）：最靠近宫颈口（最下面）而且会动的那一胎每一下被顶得晃一下，抽送停了之后回踢一脚
      if (reach) {
        const list = fetusList();
        let low = -1;
        list.forEach((fetus, index) => { if (fetalPace(fetus, list.length) && (low < 0 || zoneOf(index, list.length).v > zoneOf(low, list.length).v)) low = index; });
        if (low >= 0) {
          for (let k = 0; k < times; k += 1) motion.queue.push({ at: now + k * 360 + 120, index: low, kind: 'kick', options: { scale: 0.5 } });
          motion.queue.push({ at: now + times * 360 + 500, index: low, kind: 'kick', options: {} });
          hush(low, times * 360 + 950 + 2500);
        }
      }
      return true;
    }
    if (type === 'spray') return spray(now);
    return false;
  }

  /** 现在有没有事件的动作还在播（呼叫端可据此决定要不要继续排下一格） */
  const busy = () => motion.bumps.length + motion.jiggles.length + motion.bounces.length + motion.squirms.length + motion.yawns.length + motion.nods.length
    + motion.contractions.length + motion.growls.length + motion.drops.length + motion.sprays.length + motion.smokes.length + motion.queue.length > 0;

  /** 按住画面时浮现孕前虚影，放开就收起来 */
  const showGhost = (shown) => { ghostShown = Boolean(shown); };

  return { frame: FRAME, setState, tick, trigger, busy, showGhost, stats, get scene() { return scene; }, motion };
}
