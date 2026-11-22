// 卵子品质（1.5.3）：与精子品质同一把尺（0.25～4，1＝一般）。
// 一条链：体质（活力等级）→ 个人基准；当下的活力、情压 → 只在掷「这一轮」时往下拉；
// 这一轮的品质 → 着床成不成功、胎儿的起始健康与胎重、这一轮周期的长短浮动。
// 纯计算，不碰状态；掷骰用固定种子，重新追踪同一段结果相同。

export const EGG_QUALITY_MIN = 0.25;
export const EGG_QUALITY_MAX = 4;

/** 体质对应的个人基准：旧存档迁移与注册时模型没写时用 */
const EGG_QUALITY_BY_VITALITY_LEVEL = Object.freeze({ 1: 0.5, 2: 0.7, 3: 0.85, 4: 1, 5: 1.2, 6: 1.4, 7: 1.6 });

/** 这一轮围着基准的浮动（对数常态的标准差）与当下状态的折扣 */
const CYCLE_LOG_SD = 0.2;
const LOW_VITALITY_RATIO = 0.3;
const HIGH_STRESS_RATIO = 0.8;
const LOW_VITALITY_FACTOR = 0.8;
const HIGH_STRESS_FACTOR = 0.8;

/** 着床失败率：标准（1）约 5%，0.5 约 14%，0.25 约 40%，2 约 1.8% */
const IMPLANT_FAIL_AT_ONE = 0.05;
const IMPLANT_FAIL_EXPONENT = 1.5;
const IMPLANT_FAIL_MIN = 0.005;
const IMPLANT_FAIL_MAX = 0.6;

/** 周期浮动：品质 1 以上完全规律；每差一半加 8.5%（0.5 约 ±8.5%，0.25 约 ±17%） */
const CYCLE_SPREAD_STEADY = 0;
const CYCLE_SPREAD_PER_HALVING = 0.085;

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};
const round2 = (value) => Math.round(value * 100) / 100;

export function normalizeEggQuality(value, fallback = 1) {
  return round2(clamp(value, EGG_QUALITY_MIN, EGG_QUALITY_MAX, fallback));
}

export function eggQualityFromVitalityLevel(level) {
  return EGG_QUALITY_BY_VITALITY_LEVEL[Math.round(Number(level))] ?? 1;
}

/** 字串种子 → [0,1) 的乱数函数（mulberry32） */
export function seededRandom(seedText) {
  let h = 1779033703 ^ String(seedText).length;
  for (const char of String(seedText)) {
    h = Math.imul(h ^ char.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 掷这一轮的卵：基准 × e^N(0, 0.2)，当下活力低于上限 30%、情压高于上限 80% 各打八折。
 * 回传 { quality, lengthFactor }：这一轮的品质与周期长度系数（同一次掷，同一颗种子）。
 */
export function rollCycleEgg(base, { vitality = null, vitalityCap = null, psyStress = null, stressCap = null, seed = '' } = {}) {
  const random = seededRandom(`egg|${seed}`);
  const personal = normalizeEggQuality(base);
  // 体质与当下状态：决定这一轮乱不乱（不含骰子，健康的人每轮都规律）
  let conditioned = personal;
  if (Number.isFinite(Number(vitality)) && Number(vitalityCap) > 0 && Number(vitality) / Number(vitalityCap) < LOW_VITALITY_RATIO) conditioned *= LOW_VITALITY_FACTOR;
  if (Number.isFinite(Number(psyStress)) && Number(stressCap) > 0 && Number(psyStress) / Number(stressCap) > HIGH_STRESS_RATIO) conditioned *= HIGH_STRESS_FACTOR;
  // 这一轮的卵：再加上骰子
  const quality = normalizeEggQuality(conditioned * Math.exp(CYCLE_LOG_SD * Math.max(-2.5, Math.min(2.5, standardNormal(random)))));
  const spread = cycleLengthSpread(conditioned);
  const lengthFactor = spread > 0 ? Math.round((1 + spread * (random() * 2 - 1)) * 1000) / 1000 : 1;
  return { quality, lengthFactor };
}

/** 这一轮周期长度会浮动多少（比例）：日历画范围用 */
export function cycleLengthSpread(quality) {
  const q = normalizeEggQuality(quality);
  return q >= 1 ? CYCLE_SPREAD_STEADY : CYCLE_SPREAD_STEADY + CYCLE_SPREAD_PER_HALVING * Math.log2(1 / q);
}

/** 着床失败率 */
export function implantationFailChance(quality) {
  const q = normalizeEggQuality(quality);
  return clamp(IMPLANT_FAIL_AT_ONE * q ** -IMPLANT_FAIL_EXPONENT, IMPLANT_FAIL_MIN, IMPLANT_FAIL_MAX, IMPLANT_FAIL_AT_ONE);
}

/** 胎重系数：好卵偏重、差卵偏轻，0.85～1.15 */
export function eggWeightFactor(quality) {
  return clamp(normalizeEggQuality(quality) ** 0.1, 0.85, 1.15, 1);
}

/**
 * 卵子品质给模型看的文字（1.5.3），与精方的 virility／condition 同一种做法：
 * fertility 只讲天生的生育力（看个人基准），一般（0.8–1.5）不写；
 * cycleCondition 只讲这一轮与平常不同的地方，以及她自己察觉得到的「月经准不准」。
 */
export function describeFertility(quality) {
  const q = normalizeEggQuality(quality);
  if (q < 0.5) return '体质孱弱，不易怀上，怀上了也不稳';
  if (q < 0.8) return '生育力偏弱';
  if (q < 1.5) return '';
  if (q < 3) return '生育力旺盛，容易受孕';
  return '极易受孕';
}

export function describeCycleCondition({ eggQuality = 1, cycleEggQuality = null, boosted = false } = {}) {
  const base = normalizeEggQuality(eggQuality);
  const cycle = normalizeEggQuality(cycleEggQuality ?? base);
  const parts = [];
  if (boosted) parts.push('这一轮受了助孕，卵比平常好');
  else if (cycle < base * 0.75) parts.push('这一轮的卵比平常差');
  else if (cycle > base * 1.33) parts.push('这一轮的卵比平常好');
  if (cycleLengthSpread(base) > 0) parts.push('月经常常不准，可能提早或延后几天');
  return parts.join('；');
}

/** 分级文字（与精子品质同一组门槛） */
export function getEggQualityTier(quality) {
  const q = normalizeEggQuality(quality);
  if (q < 0.5) return '很差';
  if (q < 0.8) return '偏弱';
  if (q < 1.5) return '一般';
  if (q < 3) return '良好';
  return '极佳';
}
