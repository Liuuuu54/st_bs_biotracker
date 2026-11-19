// 胎儿生长型：胎量（肚子装了多少）随自身孕龄怎么长。
// 每一型足月（自身孕龄 280 天）一律为 1，所以足月的孕肚锚点（单胎 7、双胎 8.5…）与出生胎重不变；
// 各型差在「什么时候长得快」。份量只增不减。魔力、灵魂之类别的成长不进公式，写在种族短敘述里。

import { DUE_DATE_DAYS } from './stage_config.js';

export const FETAL_GROWTH_SHAPES = Object.freeze(['human', 'early', 'even', 'late', 'peak', 'valley']);
export const FETAL_GROWTH_SHAPE_LABELS = Object.freeze({
  human: '人类型',
  early: '早熟型',
  even: '均匀型',
  late: '晚成型',
  peak: '中段型',
  valley: '两段型',
});
export const FETAL_GROWTH_SHAPE_HINTS = Object.freeze({
  human: '孕早几乎不长、孕中加速、孕晚暴涨',
  early: '一开始就长得快，越长越慢',
  even: '等速增长',
  late: '比人类更集中在最后一段',
  peak: '孕中段一口气长大，前后两端都慢',
  valley: '孕早长一段、孕中停住、孕晚再长一段',
});

/** 未写生长型时依胚型给预设 */
const EMBRYO_TYPE_DEFAULT_SHAPES = Object.freeze({
  胎生: 'human',
  卵生: 'early',
  卵胎生: 'even',
  胎转卵生: 'valley',
  不定型: 'even',
});

/** 控制点：t（自身孕龄 ÷ 280）＝ 0.25、0.5、0.75 时的份量；两端固定 0 与 1 */
const SHAPE_POINTS = Object.freeze({
  human: [0.03, 0.2, 0.55],
  early: [0.4, 0.7, 0.9],
  even: [0.25, 0.5, 0.75],
  late: [0.02, 0.1, 0.4],
  peak: [0.08, 0.5, 0.92],
  valley: [0.3, 0.4, 0.55],
});

/** 足月后的成长速度：从足月当下的斜率 g′(1) 以 28 天为时间常数，平滑降到 g′(1) × 0.25 */
const OVERDUE_EASE_DAYS = 28;
const OVERDUE_FLOOR = 0.25;

const KNOTS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

/** Fritsch–Carlson 单调三次插值的切线：保证控制点之间只增不减、不超调 */
function monotoneTangents(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return m;
}

const CURVES = Object.freeze(Object.fromEntries(FETAL_GROWTH_SHAPES.map((shape) => {
  const ys = [0, ...SHAPE_POINTS[shape], 1];
  return [shape, Object.freeze({ ys: Object.freeze(ys), m: Object.freeze(monotoneTangents(KNOTS, ys)) })];
})));

function segment(t) {
  let i = 0;
  while (i < KNOTS.length - 2 && t > KNOTS[i + 1]) i += 1;
  return i;
}

/** 0 ≤ t ≤ 1 的份量与斜率（斜率单位：每 280 天的份量） */
function evaluate(curve, t) {
  const i = segment(t);
  const h = KNOTS[i + 1] - KNOTS[i];
  const u = (t - KNOTS[i]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const { ys, m } = curve;
  const value = (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  const slope = ((6 * u2 - 6 * u) * ys[i] + (3 * u2 - 4 * u + 1) * h * m[i] + (-6 * u2 + 6 * u) * ys[i + 1] + (3 * u2 - 2 * u) * h * m[i + 1]) / h;
  return { value, slope: Math.max(0, slope) };
}

export function normalizeFetalGrowthShape(shape) {
  const key = String(shape || '').trim();
  return FETAL_GROWTH_SHAPES.includes(key) ? key : null;
}

export function getDefaultFetalGrowthShape(embryoType) {
  return EMBRYO_TYPE_DEFAULT_SHAPES[String(embryoType || '')] || 'human';
}

const curveOf = (shape) => CURVES[normalizeFetalGrowthShape(shape) || 'human'];
const ageOf = (ownAge) => Math.max(0, Number(ownAge) || 0);

/** 份量：自身孕龄 ownAge 天时占足月的比例；足月为 1，逾期照缓升继续长 */
export function getFetalGrowth(ownAge, shape) {
  const days = ageOf(ownAge);
  const curve = curveOf(shape);
  if (days <= DUE_DATE_DAYS) return evaluate(curve, days / DUE_DATE_DAYS).value;
  const tau = days - DUE_DATE_DAYS;
  const start = evaluate(curve, 1).slope;
  const floor = start * OVERDUE_FLOOR;
  const eased = OVERDUE_EASE_DAYS * (1 - Math.exp(-tau / OVERDUE_EASE_DAYS));
  return 1 + (start * eased + floor * (tau - eased)) / DUE_DATE_DAYS;
}

/** 成长速度：每 280 天的份量增加（份量对 t 的斜率）。整个孕期的积分为 1 */
export function getFetalGrowthRate(ownAge, shape) {
  const days = ageOf(ownAge);
  const curve = curveOf(shape);
  if (days <= DUE_DATE_DAYS) return evaluate(curve, days / DUE_DATE_DAYS).slope;
  const start = evaluate(curve, 1).slope;
  const ease = Math.exp(-(days - DUE_DATE_DAYS) / OVERDUE_EASE_DAYS);
  return start * ease + start * OVERDUE_FLOOR * (1 - ease);
}

/**
 * 一胎踢起来有多用力（孕体特写的动画与生殖疼痛共用，画面与数值才一致）：
 * size 胎量（份量 × 胎重 × 份量倍率）、weight 胎重、healthPct 健康 0–100（50 平常）、uterinePct 宫压占上限 0–100、
 * vigorHard 活力档的力道倍率（活力档还没有资料，一律是「一般」的 1）。回传 0 到约 2.6。
 */
export function getFetalKickStrength({ size = 0, weight = 1, healthPct = 50, uterinePct = 0, vigorHard = 1 } = {}) {
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  // 力道：胎量 0.2（约孕 20 周）起变大，足月后再长一点到顶
  const grown = clamp01((Number(size) - 0.2) / 0.97);
  const health = Math.max(0, Math.min(2, Number(healthPct) / 50));
  const hard = Math.max(0.5, Math.min(1.2, 0.6 + 0.4 * health));
  return Math.min(2.2, (0.35 + 1.4 * grown) * Math.max(0.1, Number(weight) || 1) ** 0.3 * (1 + 0.25 * (Number(uterinePct) || 0) / 100)) * vigorHard * hard;
}

/**
 * 母体负担的孕龄项：0.5 × 成长速度。原本是直线的 t（整个孕期累积 0.5），
 * 任何生长型的成长速度积分都是 1，乘 0.5 后整个孕期的总负担不变，只是挪到长得快的那段。
 */
export function getFetalLoadFactor(ownAge, shape) {
  return 0.5 * getFetalGrowthRate(ownAge, shape);
}
