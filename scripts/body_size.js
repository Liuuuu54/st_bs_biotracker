import {
  BODY_SIZE_INDIVIDUAL,
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  getMergedRaceBodySize,
  getRaceComponents,
  getRacePhysiologyProfile,
} from './race_config.js';

/**
 * 个体体型：角色身上的 base.bodySize（1–7 级的小数，记常态）。
 * 种族层级的平均、标准差与变化态见 race_config.js 的 getMergedRaceBodySize。
 * 体型差只影响叙述，不限制插入、射精与受孕。
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

/**
 * 插入时的体型契合。female／male 是 resolveBodySize 的结果加上本次是否变化态。
 * 回传 null 表示资料不足（依个体又没给体型），不写体型差。
 */
export function describeBodySizeFit({ female, male, sizeBridge = false } = {}) {
  if (sizeBridge) return { label: '恰好契合', gap: 0, bridged: true, text: '体型契合：本次以魔法、变形等手段消弭体型差，恰好契合。' };
  if (female?.kind === 'variable' || male?.kind === 'variable') {
    return { label: '恰好契合', gap: 0, variable: true, text: '体型契合：可变体型配合对象，恰好契合。' };
  }
  if (female?.kind !== 'fixed' || male?.kind !== 'fixed') return null;
  const femaleSize = female.formSize ?? female.size;
  const maleSize = male.formSize ?? male.size;
  const diff = maleSize - femaleSize;
  const gap = Math.round(Math.abs(diff) * 10) / 10;
  const band = BODY_SIZE_FIT_BANDS.find((item) => gap < item.max);
  const sizes = `卵方 ${formatLevel(femaleSize)}${female.altForm ? '（变化态）' : ''}，精方 ${formatLevel(maleSize)}${male.altForm ? '（变化态）' : ''}`;
  if (!band.maleLarger) return { label: band.label, gap, text: `体型契合：${band.label}（${sizes}）。` };
  const detail = diff > 0 ? `精方较大，${band.maleLarger}` : `卵方较大，${band.femaleLarger}`;
  return { label: band.label, gap, text: `体型契合：${band.label}，${detail}（${sizes}）。只影响叙述，不限制交合与受孕。` };
}
