// 衍生转化（1.5.0）：bsRecordExperience action=transform 的纯计算部分——转化种类、遗传轴重新对位、血脉排斥的扣量。
// 套用到角色、时间推进、通知都在 tools.js；这里不碰 chatState。

import { DERIVED_TYPE_RACES, canonicalizeDerivedTypeName, getBaseDerivedTypeName } from './race_config.js';

/** 转化经历最多留几笔 */
export const DERIVED_TRANSFORM_LOG_CAP = 10;
/** 瞬间转化时排斥危机的基准时长（日历小时，再除以母体妊娠变速），最少 6 小时 */
export const REJECTION_BASE_HOURS = 72;
export const REJECTION_MIN_HOURS = 6;
/** 每胎总扣量的基准（健康点） */
export const REJECTION_BASE_LOSS = 30;
/** 整段危机合计的母体症状 */
export const REJECTION_PRESSURE_TOTAL = 15;
export const REJECTION_AMNION_TOTAL = 10;
/** 活力额外消耗（每故事小时）：转化中、排斥危机中 */
export const TRANSFORMING_VITALITY_PER_HOUR = 0.4;
export const REJECTION_VITALITY_PER_HOUR = 0.6;
/** 排斥危机中的生殖疼痛：2 + 1.2 × 最惨那一胎的每小时扣量，介于 2～8（越短越急越痛） */
export const REJECTION_PAIN_MIN = 2;
export const REJECTION_PAIN_MAX = 8;
export const REJECTION_PAIN_PER_LOSS_RATE = 1.2;

/** 排斥危机的疼痛强度（未加个人差异） */
export function getRejectionPainLevel(crisis) {
  const totalHours = Number(crisis?.totalHours);
  if (!(totalHours > 0)) return 0;
  const worst = Object.values(crisis?.losses || {}).reduce((top, entry) => Math.max(top, Number(entry?.total) || 0), 0);
  return Math.max(REJECTION_PAIN_MIN, Math.min(REJECTION_PAIN_MAX, REJECTION_PAIN_MIN + REJECTION_PAIN_PER_LOSS_RATE * (worst / totalHours)));
}
/** 危机中的亲近（bonding）另外加健康：slight／significant／severe */
export const REJECTION_BONDING_HEALTH = Object.freeze({ slight: 3, significant: 6, severe: 10 });
/** 熬过排斥的胎儿亲密度 +2 */
export const REJECTION_SURVIVOR_AFFINITY = 2;

/** 规范化后的衍生类型（可带子项）；空字串、null 表示没有衍生。名录没有的大类回传 undefined */
export function resolveDerivedTypeInput(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '无' || text === '無' || text.toLowerCase() === 'none') return null;
  const canonical = canonicalizeDerivedTypeName(text);
  return DERIVED_TYPE_RACES.includes(getBaseDerivedTypeName(canonical)) ? canonical : undefined;
}

const baseOf = (type) => (type ? getBaseDerivedTypeName(type) : null);

/**
 * 转化种类：gain 无 → 有、refine 同类再转化（大类不变、换子项）、switch 换大类、purge 有 → 无、same 完全相同
 */
export function classifyDerivedTransform(fromType, toType) {
  const from = fromType || null;
  const to = toType || null;
  if (from === to) return 'same';
  if (!from) return 'gain';
  if (!to) return 'purge';
  return baseOf(from) === baseOf(to) ? 'refine' : 'switch';
}

/** 只有换大类与去衍生、而且在妊娠中，才会引起血脉排斥 */
export function causesRejection(kind) {
  return kind === 'switch' || kind === 'purge';
}

/**
 * 母亲的衍生从 X 改成 Y 时，这一胎的遗传轴重新对位（计划 §3.7）：
 * 胎儿原本偏向哪一型、偏多少，用新的母父组合重新表示——那一型现在是母亲的记正值、是胎父的记负值、
 * 母父同型记正值、已经没有人拉的归 0；双亲原本同型 X、母亲转走时只留父亲那一半（−p/2）。只比大类。
 */
export function remapInheritanceProgress(progress, { oldType = null, newType = null, fatherType = null } = {}) {
  const p = Math.max(-100, Math.min(100, Number(progress) || 0));
  const x = baseOf(oldType);
  const y = baseOf(newType);
  const f = baseOf(fatherType);
  if (x === y) return p;
  const oldSame = Boolean(x && f && x === f);
  // 原本偏向的那一型与程度
  let leanType = null;
  let amount = Math.abs(p);
  if (oldSame) leanType = p >= 0 ? x : null;
  else if (p > 0) leanType = x;
  else if (p < 0) leanType = f;
  // 胎父没有衍生、胎儿偏父方（不遗传衍生）：母亲有新衍生时照旧偏父方，去衍生后两边都没有了
  if (p < 0 && !f && !oldSame) return y ? p : 0;
  if (!leanType || amount === 0) return 0;
  // 双亲原本同型 X、母亲转走：留父亲那一半，改记成偏父 X
  if (oldSame && leanType === x && y !== x) return -amount / 2;
  const newSame = Boolean(y && f && y === f);
  if (leanType === y) return amount; // 现在是母亲的（同型时也记正值）
  if (leanType === f) return newSame ? amount : -amount;
  return 0; // 舊 X、胎父不是 X：没人拉了
}

/**
 * 舊血脈係數（计划 §3.7 表）：偏向舊 X 的程度 p 时为 1 + p/30；胎父是新型 Y 而胎儿偏 Y 时减轻 max(0.5, 1 − |p|/150)；其余为 1。
 */
export function getLegacyCoefficient(progress, { oldType = null, newType = null, fatherType = null } = {}) {
  const p = Math.max(-100, Math.min(100, Number(progress) || 0));
  const x = baseOf(oldType);
  const y = baseOf(newType);
  const f = baseOf(fatherType);
  if (x && p > 0) return 1 + p / 30;
  if (y && f === y && p < 0) return Math.max(0.5, 1 - Math.abs(p) / 150);
  return 1;
}

/** 亲密度系数：clamp(1 + affinity/30, 0.5, 3)；负亲密度加重，最多 2 倍 */
export function getAffinityCoefficient(affinity) {
  return Math.max(0.5, Math.min(3, 1 + (Number(affinity) || 0) / 30));
}

/** 每胎总扣量：30 × 舊血脈係數 ÷ 亲密度系数 × 耐受系数，被包着的内胎减半 */
export function getRejectionLoss({ progress = 0, affinity = 0, oldType = null, newType = null, fatherType = null, harmFactor = 1, nested = false } = {}) {
  const legacy = getLegacyCoefficient(progress, { oldType, newType, fatherType });
  const loss = (REJECTION_BASE_LOSS * legacy) / getAffinityCoefficient(affinity) * Math.max(0, Number(harmFactor) || 0) * (nested ? 0.5 : 1);
  return Math.round(loss * 100) / 100;
}

/** 危机时长：有转化时间就跟着走（最少 6 小时）；瞬间转化时 72 ÷ max(1, 母体妊娠变速)，最少 6 小时 */
export function getRejectionHours(hours, gestationSpeed = 1) {
  const h = Number(hours);
  if (Number.isFinite(h) && h > 0) return Math.max(REJECTION_MIN_HOURS, h);
  return Math.max(REJECTION_MIN_HOURS, REJECTION_BASE_HOURS / Math.max(1, Number(gestationSpeed) || 1));
}

/** 转化经历一笔：{ time, from, to, kind, source, sourceKind, method } */
export function buildDerivedTransformRecord({ time = '', from = null, to = null, kind, partner = '', content = '', minutesPassed = 0 } = {}) {
  const source = String(partner || '').trim();
  return {
    time: String(time || '').trim(),
    minutesPassed: Math.max(0, Number(minutesPassed) || 0),
    from: from || null,
    to: to || null,
    kind,
    ...(source ? { source, sourceKind: 'person' } : { sourceKind: 'other' }),
    method: String(content || '').trim(),
  };
}

export function normalizeDerivedTransformLog(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object' && ['gain', 'refine', 'switch', 'purge'].includes(item.kind))
    .slice(-DERIVED_TRANSFORM_LOG_CAP);
}

/** 给人看的一句：「被卡蜜拉以初拥转化为血族」「以九转金丹去掉了修炼」 */
export function describeDerivedTransform(record) {
  if (!record) return '';
  const to = record.to || '无衍生';
  const from = record.from || '无衍生';
  const by = record.source ? `被${record.source}` : '';
  const how = record.method ? `（${record.method}）` : '';
  if (record.kind === 'purge') return `${by}去掉了${from}${how}`;
  if (record.kind === 'refine') return `${by}由${from}转为${to}${how}`;
  if (record.kind === 'switch') return `${by}由${from}转化为${to}${how}`;
  return `${by}转化为${to}${how}`;
}
