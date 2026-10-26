// 性爱纪录与契合度（1.2.0，精方计划第 4 期）。
//
// 卵方的 profile.intimacy 以对象名字为键，只存汇总值，不存逐次纪录：
//   { count, effective, lastMinutes, lastInsertMinutes, sessionGain, compatLabel }
// count 是累计次数（不衰减）；effective 是乘过相容倍率、按半衰期衰减的有效次数。
// 契合度 = 有效次数ᵢ ÷ (Σ有效次数 + 基准值 c)：一夜情一次 1/(1+3) = 25%，不设门檻。
// 只计 bsAddSperm（可受孕生殖道的插入），一次性对象也照名字累计。全部由系统计算，模型只读结果。
import { normalizeReproductiveSettings } from './reproductive.js';
import { normalizeSpermQuality } from './sires.js';

/** 鞘与剑的差 → 相容倍率；差 ≥ 2.5 只剩疼痛，不累积 */
const COMPAT_BANDS = Object.freeze([
  { max: 0.5, multiplier: 1 },
  { max: 1.5, multiplier: 0.7 },
  { max: 2.5, multiplier: 0.4 },
  { max: Infinity, multiplier: 0 },
]);

/** 经产扩张：每次自然分娩永久 +0.125 级，最多 +1；剖腹产不扩张。由次数推算，不另存栏位 */
export function getSheathStretch(experience) {
  const births = Math.max(0, Math.floor(Number(experience?.naturalBirthExperience) || 0));
  return Math.min(1, 0.125 * births);
}

/**
 * 体型契合结果 → 相容倍率。可变体型、魔法消弭体型差、体型未知都当作完全相容：
 * 没有资料可依时不扣分。
 */
export function getCompatMultiplier(fit) {
  if (!fit || fit.bridged || fit.variable) return 1;
  const gap = Math.abs(Number(fit.gap) || 0);
  return COMPAT_BANDS.find((band) => gap < band.max).multiplier;
}

export function getIntimacyConfig(reproductiveSettings) {
  const config = normalizeReproductiveSettings(reproductiveSettings || {});
  return {
    halfLifeMinutes: Math.max(1, config.intimacyHalfLifeDays) * 1440,
    baseline: Math.max(0, config.intimacyBaseline),
    dedupeMinutes: Math.max(0, config.intimacyDedupeHours) * 60,
  };
}

function decayTo(record, now, halfLifeMinutes) {
  const elapsed = Math.max(0, now - (Number(record.lastMinutes) || 0));
  record.effective = (Number(record.effective) || 0) * 0.5 ** (elapsed / halfLifeMinutes);
  record.lastMinutes = now;
}

function ensureIntimacy(profile) {
  if (!profile.intimacy || typeof profile.intimacy !== 'object' || Array.isArray(profile.intimacy)) profile.intimacy = {};
  return profile.intimacy;
}

/**
 * 插入：同一对象在去重间隔内（预设 6 小时，从上一次插入算起）重复 insert 视为同一场，
 * 次数与相容倍率都不再加——模型换姿势、中途换人常重复呼叫 insert。
 * 回传这次有没有算成新的一场。
 */
export function recordIntimacyInsert(profile, partner, { minutesPassed = 0, compat = 1, compatLabel = null, reproductiveSettings = null } = {}) {
  const name = String(partner || '').trim();
  if (!profile || !name) return false;
  const { halfLifeMinutes, dedupeMinutes } = getIntimacyConfig(reproductiveSettings);
  const now = Math.max(0, Number(minutesPassed) || 0);
  const intimacy = ensureIntimacy(profile);
  const record = intimacy[name] && typeof intimacy[name] === 'object' ? intimacy[name] : { count: 0, effective: 0, lastMinutes: now };
  decayTo(record, now, halfLifeMinutes);
  const last = Number(record.lastInsertMinutes);
  const sameSession = Number.isFinite(last) && now - last < dedupeMinutes;
  record.lastInsertMinutes = now;
  if (!sameSession) {
    record.count = (Number(record.count) || 0) + 1;
    record.effective += compat;
    record.sessionGain = compat;
    if (compatLabel) record.compatLabel = compatLabel;
  }
  intimacy[name] = record;
  return !sameSession;
}

/**
 * 精液实际进入体内（套子挡住、体外都不算）：契合累积 +0.25 × log₂(品质)，品质 0.25／1／4 为 −0.5／0／+0.5。
 * 负值最多扣到这一场插入加上去的量，单场合计不低于 0。回传实际加减的量。
 */
export function recordIntimacySemen(profile, partner, { minutesPassed = 0, quality = 1, reproductiveSettings = null } = {}) {
  const name = String(partner || '').trim();
  const record = profile?.intimacy?.[name];
  if (!record) return 0;
  const { halfLifeMinutes } = getIntimacyConfig(reproductiveSettings);
  decayTo(record, Math.max(0, Number(minutesPassed) || 0), halfLifeMinutes);
  const bonus = 0.25 * Math.log2(normalizeSpermQuality(quality));
  const applied = bonus < 0 ? Math.max(bonus, -(Number(record.sessionGain) || 0)) : bonus;
  record.effective = Math.max(0, record.effective + applied);
  record.sessionGain = (Number(record.sessionGain) || 0) + applied;
  return applied;
}

/** 契合度排行：衰减到现在再算比例，由高到低；不改存档 */
export function getIntimacyRanking(profile, { minutesPassed = 0, reproductiveSettings = null } = {}) {
  const entries = Object.entries(profile?.intimacy && typeof profile.intimacy === 'object' ? profile.intimacy : {});
  if (entries.length === 0) return [];
  const { halfLifeMinutes, baseline } = getIntimacyConfig(reproductiveSettings);
  const now = Math.max(0, Number(minutesPassed) || 0);
  const decayed = entries.map(([name, record]) => {
    const elapsed = Math.max(0, now - (Number(record?.lastMinutes) || 0));
    return { name, effective: (Number(record?.effective) || 0) * 0.5 ** (elapsed / halfLifeMinutes), count: Number(record?.count) || 0, compatLabel: record?.compatLabel || null, elapsedMinutes: elapsed };
  });
  const total = decayed.reduce((sum, item) => sum + item.effective, 0);
  return decayed
    .map((item) => ({ ...item, fit: total + baseline > 0 ? item.effective / (total + baseline) : 0 }))
    .sort((a, b) => b.fit - a.fit);
}

/**
 * 契合度的称呼与五格：一夜情一次是 25%，落在「初识」。
 * 门槛是契合度（份额），不是次数，所以同样的次数，对象越多越分散。
 */
export const INTIMACY_LEVELS = Object.freeze([
  { min: 0.7, name: '刻骨', pips: 5 },
  { min: 0.5, name: '默契', pips: 4 },
  { min: 0.3, name: '熟悉', pips: 3 },
  { min: 0.15, name: '初识', pips: 2 },
  { min: 0, name: '生疏', pips: 1 },
]);

export function getIntimacyLevel(fit) {
  const value = Math.max(0, Number(fit) || 0);
  return INTIMACY_LEVELS.find((level) => value >= level.min) || INTIMACY_LEVELS[INTIMACY_LEVELS.length - 1];
}

/** 给模型看的一行：前三名与「身体最熟悉谁」；只描述身体记忆，不代表感情。没有值得一提的回空字串 */
export function formatIntimacyPromptLine(ranking) {
  const top = (Array.isArray(ranking) ? ranking : []).filter((item) => item.fit >= 0.005).slice(0, 3);
  if (top.length === 0) return '';
  const list = top.map((item) => `${item.name} ${Math.round(item.fit * 100)}%`).join('、');
  return `${list}；身体最熟悉 ${top[0].name}`;
}
