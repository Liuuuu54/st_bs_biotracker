// 繁殖季的相位：一季（活动周期 × 每季轮数 ＋ 乏情）里走到哪里，用 0～1 的比例表示，
// 倍率不同的两人才能对齐。只有乏情天数 > 0 的物种有季节；人类与多数物种回传 null。
//
// 用途：
// - 注册卵方时对齐主血统相同的已注册者（只对齐在不在乏情、本季第几轮，见 deriveMenstrualStageState）
// - 精方的季节时钟：seasonOrigin ＋ 故事时间推算，建档时同样对齐
// 只在注册／建档当下对齐一次，之后各自漂移。
import { getMergedRacePhysiologyProfile, getWeightedRaceParts } from './race_config.js';
import { DORMANCY_STAGE, MENSTRUAL_STAGE_DAYS } from './stage_config.js';

const MINUTES_PER_DAY = 24 * 60;
const ACTIVE_STAGES = Object.freeze(Object.keys(MENSTRUAL_STAGE_DAYS));

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

/** 一季的形状（天）。bio 形状：menstrualLengthRatio、dormancyDays、seasonCycles；没有乏情回传 null */
export function getSeasonShape(bio = {}) {
  const dormancy = Math.max(0, Number(bio?.dormancyDays) || 0);
  if (!(dormancy > 0)) return null;
  const ratio = clampNumber(bio?.menstrualLengthRatio, 0.1, 20, 1);
  const cycles = Math.max(1, Math.round(Number(bio?.seasonCycles) || 1));
  const cycleLength = ACTIVE_STAGES.reduce((sum, stage) => sum + MENSTRUAL_STAGE_DAYS[stage] * ratio, 0);
  const active = cycleLength * cycles;
  return { ratio, cycles, cycleLength, active, dormancy, total: active + dormancy };
}

/** 种族（混血按血统加权）的季节形状 */
export function getRaceSeasonShape(race, bloodline = null) {
  return getSeasonShape(getMergedRacePhysiologyProfile(race || '人类', bloodline) || {});
}

/**
 * 主血统：血统比例最大的成分，同分取先出现的。衍生类型看基底种族、子项并入母类
 * （getWeightedRaceParts 已把「怪兽类-狼」并成「怪兽类」）。
 */
export function getMainBloodline(race, bloodline = null) {
  let best = null;
  for (const part of getWeightedRaceParts(race || '', bloodline)) {
    if (!best || part.weight > best.weight + 1e-9) best = part;
  }
  return best?.name || '';
}

/** 卵方当下的季节相位；不在月经周期（怀孕、产后等）或没有季节回传 null */
export function getCharacterSeasonPhase(profile) {
  const base = profile?.base || {};
  const stage = String(base.stage || '');
  const shape = getSeasonShape(profile?.bio);
  if (!shape) return null;
  const days = Math.max(0, Number(base.days) || 0);
  let elapsed;
  if (stage === DORMANCY_STAGE) {
    elapsed = shape.active + Math.min(days, shape.dormancy);
  } else if (ACTIVE_STAGES.includes(stage)) {
    const round = Math.min(shape.cycles - 1, Math.max(0, Math.floor(Number(base.seasonCycle) || 0)));
    const index = ACTIVE_STAGES.indexOf(stage);
    const before = ACTIVE_STAGES.slice(0, index).reduce((sum, item) => sum + MENSTRUAL_STAGE_DAYS[item] * shape.ratio, 0);
    elapsed = round * shape.cycleLength + before + Math.min(days, MENSTRUAL_STAGE_DAYS[stage] * shape.ratio);
  } else {
    return null;
  }
  return Math.max(0, Math.min(0.999999, elapsed / shape.total));
}

/** seasonOrigin 是否已设定（null 不能当 0 分钟） */
export function hasSeasonOrigin(record) {
  const value = record?.seasonOrigin;
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function fraction(value) {
  return value - Math.floor(value);
}

/** 精方（时钟推算）当下的季节相位；没有季节或还没有起点回传 null */
export function getSireSeasonPhase(record, minutesPassed) {
  const shape = getRaceSeasonShape(record?.race, record?.bloodline);
  if (!shape || !hasSeasonOrigin(record)) return null;
  return fraction(((Number(minutesPassed) || 0) - Number(record.seasonOrigin)) / (shape.total * MINUTES_PER_DAY));
}

/** 由相位反推精方的季节起点：现在正好走到 phase */
export function getSeasonOriginForPhase(shape, phase, minutesPassed) {
  return Math.round((Number(minutesPassed) || 0) - phase * shape.total * MINUTES_PER_DAY);
}

/** 名字的固定杂凑（0～1）：没有对齐对象时的起点，主档与楼层快照迁移结果一致 */
export function hashPhase(text) {
  let hash = 2166136261;
  for (const char of String(text || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * 找对齐对象：主血统相同、有季节、目前在月经周期中的已注册卵方（注册先后顺序，取最早的一位），
 * 其次是主血统相同、已有季节起点的精方（createdAt 最早）。扶她的精方档案不算（她的季节读卵方）。
 * 回传 { phase, name, kind } 或 null。
 */
export function findSeasonReference(chatState, { race, bloodline = null, excludeName = '', minutesPassed = null } = {}) {
  const main = getMainBloodline(race, bloodline);
  if (!main) return null;
  const now = minutesPassed ?? (Number(chatState?.minutesPassed) || 0);
  const characters = chatState?.characters || {};
  for (const [name, character] of Object.entries(characters)) {
    if (name === excludeName || character?.initialized === false) continue;
    const base = character?.profile?.base;
    if (!base || getMainBloodline(base.race, base.bloodline) !== main) continue;
    const phase = getCharacterSeasonPhase(character.profile);
    if (phase !== null) return { phase, name, kind: 'character' };
  }
  const sires = Object.entries(chatState?.sires || {})
    .filter(([name, record]) => name !== excludeName
      && !Object.prototype.hasOwnProperty.call(characters, name)
      && hasSeasonOrigin(record)
      && getMainBloodline(record.race, record.bloodline) === main)
    .sort((a, b) => (Number(a[1].createdAt) || 0) - (Number(b[1].createdAt) || 0));
  for (const [name, record] of sires) {
    const phase = getSireSeasonPhase(record, now);
    if (phase !== null) return { phase, name, kind: 'sire' };
  }
  return null;
}

/**
 * 精方的季节起点：有对齐对象就对齐，没有就用名字杂凑。没有季节的种族与扶她回传 null。
 */
export function resolveSireSeasonOrigin(chatState, name, record, minutesPassed = null) {
  const key = String(name || '').trim();
  if (Object.prototype.hasOwnProperty.call(chatState?.characters || {}, key)) return null;
  const shape = getRaceSeasonShape(record?.race, record?.bloodline);
  if (!shape) return null;
  const now = minutesPassed ?? (Number(chatState?.minutesPassed) || 0);
  const reference = findSeasonReference(chatState, { race: record?.race, bloodline: record?.bloodline, excludeName: key, minutesPassed: now });
  return getSeasonOriginForPhase(shape, reference ? reference.phase : hashPhase(key), now);
}

/**
 * 存档升到 v12 时补精方的季节起点（主档与每一层快照都用这个）；已有的不动。
 * characters 用同一份状态里的卵方对齐。
 */
export function assignMissingSireSeasonOrigins(state) {
  const sires = state?.sires;
  if (!sires || typeof sires !== 'object') return;
  const now = Number(state.minutesPassed) || 0;
  const pending = Object.entries(sires)
    .filter(([, record]) => record && typeof record === 'object' && !hasSeasonOrigin(record))
    .sort((a, b) => (Number(a[1].createdAt) || 0) - (Number(b[1].createdAt) || 0));
  for (const [name, record] of pending) {
    const origin = resolveSireSeasonOrigin(state, name, record, now);
    if (origin !== null) record.seasonOrigin = origin;
  }
}
