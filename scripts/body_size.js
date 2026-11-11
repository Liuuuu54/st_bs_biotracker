import {
  BODY_SIZE_INDIVIDUAL,
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  getMergedRaceBodySize,
  getMergedRacePhysiologyProfile,
  getRaceComponents,
  getRacePhysiologyProfile,
} from './race_config.js';

/**
 * 个体体型：角色身上的 base.bodySize（1–7 级的小数，记常态）。
 * 种族层级的平均、标准差与变化态见 race_config.js 的 getMergedRaceBodySize。
 * 体型差不限制插入、射精与受孕；女方体型决定子宫容积（见 getUterusVolumeFactor）。
 */

export function clampIndividualBodySize(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(Math.max(BODY_SIZE_MIN, Math.min(BODY_SIZE_MAX, num)) * 10) / 10;
}

/** 父母里属于依个体种族的成分，以该父母的个体体型代入（孩子的体型才不会忽略大蟑螂父亲） */
function collectIndividualSizes(parents = []) {
  const totals = new Map();
  for (const parent of parents) {
    const size = clampIndividualBodySize(parent?.bodySize);
    if (size === null) continue;
    for (const component of getRaceComponents(parent?.race || '')) {
      if (getRacePhysiologyProfile(component)?.bodySize !== BODY_SIZE_INDIVIDUAL) continue;
      const entry = totals.get(component) || { sum: 0, count: 0 };
      entry.sum += size;
      entry.count += 1;
      totals.set(component, entry);
    }
  }
  return totals.size > 0 ? Object.fromEntries([...totals].map(([name, { sum, count }]) => [name, sum / count])) : null;
}

/** 种族（与可选的父母个体体型）推出的体型分布 */
export function getExpectedBodySize(race, bloodline = null, parents = []) {
  return getMergedRaceBodySize(race, bloodline, { individualSizes: collectIndividualSizes(parents) });
}

function randomNormal(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 从体型分布抽一个个体体型；可变与依个体抽不出来，回传 null */
export function sampleBodySize({ bodySize, bodySizeSd } = {}, random = Math.random) {
  if (typeof bodySize !== 'number' || !Number.isFinite(bodySize)) return null;
  const sd = Number.isFinite(Number(bodySizeSd)) ? Math.max(0, Number(bodySizeSd)) : 0;
  return clampIndividualBodySize(bodySize + sd * randomNormal(random));
}

/**
 * 某人当下常态的体型：个体值优先，没有就用种族平均。
 * kind：fixed（有数值）、variable（可变，与任何对象都恰好契合）、unknown（依个体却没有个体值）
 */
export function resolveBodySize({ race, bloodline = null, bodySize = null } = {}) {
  const individual = clampIndividualBodySize(bodySize);
  const merged = getMergedRaceBodySize(race || '', bloodline);
  if (individual !== null) return { kind: 'fixed', size: individual, merged };
  if (typeof merged.bodySize === 'number') return { kind: 'fixed', size: merged.bodySize, merged };
  if (merged.bodySize === BODY_SIZE_INDIVIDUAL) return { kind: 'unknown', size: null, merged };
  // 全部成分都未收录时没有资料可依，视为未知而不是可变
  if (getRaceComponents(race || '').every((part) => !getRacePhysiologyProfile(part))) return { kind: 'unknown', size: null, merged };
  return { kind: 'variable', size: null, merged };
}

/**
 * 个体体型偏离种族平均几个标准差（σ）。没有个体值、可变或种族没有标准差时为 0。
 * 显怀系数与像素图用它表现高挑或娇小。
 */
export function getBodySizeSigma(base) {
  const individual = clampIndividualBodySize(base?.bodySize);
  if (individual === null) return 0;
  const merged = getMergedRaceBodySize(base?.race || '', base?.bloodline ?? null);
  const mean = Number(merged?.bodySize);
  const sd = Number(merged?.bodySizeSd);
  if (!Number.isFinite(mean) || !(sd > 0)) return 0;
  return Math.max(-3, Math.min(3, (individual - mean) / sd));
}

/**
 * 体型的容积倍率：人类 4 级为 1，每差一级翻倍（1 级 0.125 … 7 级 8）。
 * 子宫装得下多少精液、每天排掉多少，以及一次射精的建议量都按它缩放。
 */
export function getBodySizeVolumeFactor(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) return 1;
  return 2 ** (Math.min(BODY_SIZE_MAX, Math.max(BODY_SIZE_MIN, value)) - 4);
}

/**
 * 子宫容积倍率，看女方常态体型：同体型的一对，精液留存天数与受孕难易都与人类一样。
 * 可变或未知体型视为 1。
 */
export function getUterusVolumeFactor(base) {
  const resolved = resolveBodySize({ race: base?.race, bloodline: base?.bloodline, bodySize: base?.bodySize });
  return resolved.kind === 'fixed' ? getBodySizeVolumeFactor(resolved.size) : 1;
}

/**
 * 变化态体型 = 种族变化态 +（个体常态 − 种族常态），截在 1–7。
 * 没有变化态的种族回传 null，由呼叫端决定如何提示。
 */
export function getAltFormBodySize(resolved) {
  if (resolved?.kind !== 'fixed') return null;
  const alt = resolved.merged?.altFormBodySize;
  if (typeof alt !== 'number') return null;
  const mean = typeof resolved.merged.bodySize === 'number' ? resolved.merged.bodySize : resolved.size;
  return clampIndividualBodySize(alt + (resolved.size - mean));
}

/**
 * 胎重天生的变异：对数常态分布的标准差。0.13 约是人类新生儿体重的实际变异（约 68% 落在 ±14% 内，
 * 重 20% 以上的巨大儿约 8%）；所有种族共用。
 */
export const CONCEPTION_WEIGHT_LOG_SD = 0.13;

/**
 * 受精当下的周期阶段对胎重的影响。胎重 1.0 是「这位母体正常妊娠的胎重」（巨人纯血正常妊娠也是 1.0），
 * 自然受孕几乎都在排卵期，所以以排卵期为基准，相邻阶段差一成上下；乏情期是异种精液强行诱发的排卵，比月经期更弱。产后恢复期认知系统清空、不会受孕，不列。
 * 不在表里的阶段（例如异期复孕时的孕期阶段）按 1.0。
 */
export const CONCEPTION_STAGE_WEIGHTS = Object.freeze({
  乏情期: 0.6,
  月经期: 0.75,
  卵泡期: 0.9,
  排卵期: 1.0,
  黄体期: 1.1,
});

export function getConceptionStageWeight(stage) {
  return CONCEPTION_STAGE_WEIGHTS[String(stage || '')] ?? 1.0;
}

/** 受精胎重系数的范围；体型与承载耐受两套算法共用 */
export const CONCEPTION_WEIGHT_RATIO_MIN = 0.5;
export const CONCEPTION_WEIGHT_RATIO_MAX = 2;
const CONCEPTION_WEIGHT_PER_LEVEL = 0.25;

/**
 * 受精胎重的体型系数 = 2^((父方 − 母方) × 0.25)，截在 0.5–2。
 * 胎儿在子宫里主要受母体限制（Walton & Hammond 的夏尔马 × 设得兰小马互配），父方体型只部分影响。
 * 母方看承载者（代孕时子宫才是限制），双方都看常态；任一方可变或体型未知时回传 null，由呼叫端改用承载耐受。
 */
export function getBodySizeWeightRatio(mother, father) {
  const motherSize = resolveBodySize(mother);
  const fatherSize = resolveBodySize(father);
  if (motherSize.kind !== 'fixed' || fatherSize.kind !== 'fixed') return null;
  const ratio = 2 ** ((fatherSize.size - motherSize.size) * CONCEPTION_WEIGHT_PER_LEVEL);
  return Math.max(CONCEPTION_WEIGHT_RATIO_MIN, Math.min(CONCEPTION_WEIGHT_RATIO_MAX, ratio));
}

function clampBreedTolerance(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.1, Math.min(100, number)) : 1;
}

/**
 * 受精胎重系数，引擎与异种百科计算机共用，两套算法同在 0.5–2、不叠加（免得巨人既高耐受又大被重复放大）：
 * - 双方体型都有数值时看体型差（getBodySizeWeightRatio）
 * - 任一方可变、或依个体又没记体型时，退回承载耐受的强弱：2^强弱，强弱 =（父 − 母）／（父 + 母），介于 −1 与 1
 * mother／father：{ race, bloodline, bodySize, breedTolerance }；breedTolerance 省略时用种族值。
 * 回传 { ratio, basis }，basis 是 bodySize 或 breedTolerance。
 */
export function resolveConceptionWeightRatio(mother = {}, father = {}) {
  const sizeRatio = getBodySizeWeightRatio(mother, father);
  if (sizeRatio !== null) return { ratio: sizeRatio, basis: 'bodySize' };
  const toleranceOf = (party) => clampBreedTolerance(party?.breedTolerance ?? getMergedRacePhysiologyProfile(party?.race || '', party?.bloodline ?? null)?.breedTolerance);
  const motherTolerance = toleranceOf(mother);
  const fatherTolerance = toleranceOf(father);
  const dominance = (fatherTolerance - motherTolerance) / Math.max(motherTolerance + fatherTolerance, 0.1);
  const ratio = Math.max(CONCEPTION_WEIGHT_RATIO_MIN, Math.min(CONCEPTION_WEIGHT_RATIO_MAX, 2 ** dominance));
  return { ratio, basis: 'breedTolerance' };
}

// 体型差分段：精方较大写「容纳」，卵方较大写「充实」
const BODY_SIZE_FIT_BANDS = Object.freeze([
  { max: 0.5, label: '恰好契合', maleLarger: '', femaleLarger: '' },
  { max: 1.5, label: '略有落差', maleLarger: '需要适应', femaleLarger: '略嫌不足' },
  { max: 2.5, label: '明显不合', maleLarger: '伴随不适与撑胀', femaleLarger: '难以充实' },
  { max: 4, label: '极不相称', maleLarger: '极难容纳，强行进行会疼痛', femaleLarger: '几乎感受不到' },
  { max: Infinity, label: '体型悬殊', maleLarger: '几乎不可能容纳', femaleLarger: '几乎无法交合' },
]);

function formatLevel(value) {
  return `${Math.round(value * 10) / 10} 级`;
}

/** 剑的偏移：−2～+2，步长 0.5；剑 ＝ 精方体型 ＋ 偏移，体型缩放（变化态、抽样）时跟着缩放 */
export const SWORD_OFFSET_MIN = -2;
export const SWORD_OFFSET_MAX = 2;
/** 鞘的偏移：−1～+1，步长 0.25；代表实际舒适的深度（子宫后倾、子宫颈偏低等都写成负的） */
export const SHEATH_OFFSET_MIN = -1;
export const SHEATH_OFFSET_MAX = 1;
/** 个体身高对鞘长的影响：鞘与身高只有弱相关，高个子比矮个子浅是常见的 */
export const SHEATH_BODY_SIZE_WEIGHT = 0.25;

function normalizeOffset(value, min, max, step) {
  const num = Number(value);
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(num)) return 0;
  return Math.max(min, Math.min(max, Math.round(num / step) * step)) || 0;
}

export function normalizeSwordOffset(value) {
  return normalizeOffset(value, SWORD_OFFSET_MIN, SWORD_OFFSET_MAX, 0.5);
}

export function normalizeSheathOffset(value) {
  return normalizeOffset(value, SHEATH_OFFSET_MIN, SHEATH_OFFSET_MAX, 0.25);
}

/** 剑偏移的文字分级（介面与提示词共用）：比同体型的人大或小；short 时 0 写「相称」 */
export function describeSwordOffset(value, { short = false } = {}) {
  const offset = normalizeSwordOffset(value);
  if (offset >= 1.5) return '硕大';
  if (offset >= 0.5) return '偏大';
  if (offset <= -1.5) return '短小';
  if (offset <= -0.5) return '偏小';
  return short ? '相称' : '与体型相称';
}

/** 鞘偏移的文字分级：实际舒适的深度比同体型的人深或浅；经产扩张另写 */
export function describeSheathOffset(value, stretch = 0) {
  const offset = normalizeSheathOffset(value);
  const depth = offset >= 0.75 ? '很深' : offset >= 0.25 ? '偏深' : offset <= -0.75 ? '很浅' : offset <= -0.25 ? '偏浅' : '适中';
  const extra = Math.max(0, Number(stretch) || 0);
  return extra > 0 ? `${depth}，经产后${extra >= 0.5 ? '明显' : '略'}松宽` : depth;
}

/** 剑：精方当下的体型（变化态取 formSize）＋ 偏移 */
export function getSwordSize(male, offset = 0) {
  if (male?.kind !== 'fixed') return null;
  return (male.formSize ?? male.size) + normalizeSwordOffset(offset);
}

/**
 * 鞘（有效）：种族平均 ＋ 0.25 ×（个体 − 种族平均）＋ 偏移 ＋ 经产扩张。
 * 跨物种仍随体型缩放；变化态的平均与个体都换成变化态。依个体的种族没有平均，直接用个体值。
 */
export function getSheathSize(female, { offset = 0, stretch = 0 } = {}) {
  if (female?.kind !== 'fixed') return null;
  const size = female.formSize ?? female.size;
  const merged = female.merged || {};
  const mean = female.altForm
    ? (typeof merged.altFormBodySize === 'number' ? merged.altFormBodySize : size)
    : (typeof merged.bodySize === 'number' ? merged.bodySize : size);
  return mean + SHEATH_BODY_SIZE_WEIGHT * (size - mean) + normalizeSheathOffset(offset) + Math.max(0, Number(stretch) || 0);
}

/**
 * 插入时的尺寸契合（剑对鞘）。female／male 是 resolveBodySize 的结果加上本次是否变化态；
 * femaleOffset 是鞘偏移、maleOffset 是剑偏移，femaleStretch 是经产扩张。
 * 回传 null 表示资料不足（依个体又没给体型），不写体型差。
 */
export function describeBodySizeFit({ female, male, sizeBridge = false, femaleStretch = 0, femaleOffset = 0, maleOffset = 0 } = {}) {
  if (sizeBridge) return { label: '恰好契合', gap: 0, bridged: true, text: '体型契合：本次以魔法、变形等手段消弭体型差，恰好契合。' };
  if (female?.kind === 'variable' || male?.kind === 'variable') {
    return { label: '恰好契合', gap: 0, variable: true, text: '体型契合：可变体型配合对象，恰好契合。' };
  }
  if (female?.kind !== 'fixed' || male?.kind !== 'fixed') return null;
  // 经产扩张只加在鞘那一侧（见 intimacy.js 的 getSheathStretch）
  const stretch = Math.max(0, Number(femaleStretch) || 0);
  const sheathOffset = normalizeSheathOffset(femaleOffset);
  const swordOffset = normalizeSwordOffset(maleOffset);
  const femaleSize = getSheathSize(female, { offset: sheathOffset, stretch });
  const maleSize = getSwordSize(male, swordOffset);
  const diff = maleSize - femaleSize;
  const gap = Math.round(Math.abs(diff) * 10) / 10;
  const band = BODY_SIZE_FIT_BANDS.find((item) => gap < item.max);
  // 给模型看的是文字：鞘偏浅、剑偏大，不写偏移数字
  const femaleNotes = [
    ...(sheathOffset !== 0 ? [`鞘${describeSheathOffset(sheathOffset)}`] : []),
    ...(stretch > 0 ? [`含经产扩张 +${Math.round(stretch * 1000) / 1000}`] : []),
  ];
  const sizes = `卵方 ${formatLevel(femaleSize)}${female.altForm ? '（变化态）' : ''}${femaleNotes.length > 0 ? `，${femaleNotes.join('，')}` : ''}，精方 ${formatLevel(maleSize)}${male.altForm ? '（变化态）' : ''}${swordOffset !== 0 ? `，剑${describeSwordOffset(swordOffset)}` : ''}`;
  if (!band.maleLarger) return { label: band.label, gap, text: `体型契合：${band.label}（${sizes}）。` };
  const detail = diff > 0 ? `精方较大，${band.maleLarger}` : `卵方较大，${band.femaleLarger}`;
  return { label: band.label, gap, text: `体型契合：${band.label}，${detail}（${sizes}）。只影响叙述，不限制交合与受孕。` };
}
