// 精方档案：可长期追踪的精液提供者（男主、{{user}}、转正的路人）。一次性对象不建档，
// 只存在精液纪录与胎儿／孩子的父方快照里；建档后 bsAddSperm 以名字命中时由档案带入种族、衍生类型与体型。
//
// 同名同时是已注册卵方（扶她）时，种族、血统、衍生类型、年龄、体型、在场一律读卵方，
// 精方档案只留精方专属栏位（精子品质）；描述也放在卵方那份。
import { descriptionListToObject, getStaleDescriptionFields, normalizeDescriptionList, parseDescriptionGuideFields } from './descriptions.js';
import { clampIndividualBodySize, describeSwordOffset, normalizeSwordOffset } from './body_size.js';
import { getBloodlineInfo, getDerivedTypeSireCycleProfile, getMergedRacePhysiologyProfile, parseRaceDescriptor } from './race_config.js';
import { normalizeReproductiveSettings } from './reproductive.js';
import { getRaceSeasonShape, getSireSeasonPhase, hashPhase, hasSeasonOrigin, resolveSireSeasonOrigin } from './season_phase.js';
import { DORMANCY_STAGE } from './stage_config.js';
import { getTalentLabel, normalizeTalentList, resolveSkillDefinition } from './skill_config.js';

export const SIRE_SOURCES = Object.freeze(['manual', 'card', 'father', 'library']);
export const SPERM_QUALITY_MIN = 0.25;
export const SPERM_QUALITY_MAX = 4;

/** 存档是 JSON，读回来是普通物件；与 characters 一样重建成 null-proto，名字直接作键 */
export function createEmptySires() {
  return Object.create(null);
}

/**
 * 精子品质的三个作用，指数见精方计划 §5：同量的有效量 ×q^0.5、每天流失 ×q^-0.5（留存久）、
 * 排出 ×q^-0.25（难洗）。品质 1 时都是 1，与没有品质的旧纪录完全相同。
 */
export function getSpermQualityFactors(value) {
  const quality = normalizeSpermQuality(value);
  return { quality, amount: quality ** 0.5, decay: quality ** -0.5, drain: quality ** -0.25 };
}

/**
 * 精子品质给模型看的分级描述（virility）：只讲天生体质，也就是精力与繁殖力，看档案品质。
 * 精液此刻的稀稠与多寡交给 condition（存量、季节、精力高峰），两边才不会一个说浓稠、一个说稀。
 * 不影射阳物（阳物大小是剑偏移）。一般（0.5–1.5）不写。
 */
export function describeSpermQuality(value) {
  const quality = normalizeSpermQuality(value);
  if (quality < 0.5) return '体质孱弱，不易使人受孕';
  if (quality < 1.5) return '';
  if (quality < 3) return '精力旺盛，繁殖力强';
  return '精力极旺，繁殖力惊人';
}

function normalizeReserve(value) {
  const num = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(num)) return 1;
  return Math.max(0, Math.min(1, num));
}

const MINUTES_PER_DAY = 24 * 60;
/** 非繁殖季的品质倍率：不归零，多数雄性全年仍有生育力 */
export const SIRE_OFF_SEASON_FACTOR = 0.6;
/** 季节交界的过渡（天）：两侧各 1.5 天线性过渡，避免一天之内跳变 */
const SEASON_RAMP_DAYS = 1.5;
/** 精方精力周期一轮的长度（人类天数，再乘经期倍率）；幅度与形状看衍生类型 */
export const SPERMATOGENESIS_DAYS = 74;

/**
 * 精方周期在一轮里某一点的品质系数，fraction 是 0～1，波峰在正中间。
 * 峰期天数 0：平滑起伏，系数 ＝ (1＋幅度)^(−cos 2πf)，波峰 ×(1＋幅度)、波谷 ÷(1＋幅度)。
 * 峰期天数 > 0：平时为 1，只有正中间那几天按 cos² 冲高到 1＋幅度（易感期这类）。
 */
export function getSpermCycleFactor(fraction, { amplitude = 0.1, peakDays = 0, cycleDays = SPERMATOGENESIS_DAYS } = {}) {
  const f = ((Number(fraction) % 1) + 1) % 1;
  const a = Math.max(0, Number(amplitude) || 0);
  const peak = Math.max(0, Number(peakDays) || 0);
  if (!(peak > 0)) return (1 + a) ** (-Math.cos(2 * Math.PI * f));
  const distance = Math.abs(f - 0.5) * cycleDays;
  if (distance >= peak / 2) return 1;
  return 1 + a * Math.cos(Math.PI * distance / peak) ** 2;
}
/** 禁欲：超过这些天后每天 −1%，最低 0.85 */
const ABSTINENCE_GRACE_DAYS = 7;
const ABSTINENCE_DAILY_LOSS = 0.01;
const ABSTINENCE_FLOOR = 0.85;

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** 季节相位 → 季节系数；回传 { factor, inSeason, daysLeft } */
function getSeasonFactorAt(shape, phase) {
  const t = phase * shape.total;
  const middle = (1 + SIRE_OFF_SEASON_FACTOR) / 2;
  if (t < shape.active) {
    const distance = Math.min(t, shape.active - t);
    return { factor: distance >= SEASON_RAMP_DAYS ? 1 : lerp(middle, 1, distance / SEASON_RAMP_DAYS), inSeason: true, daysLeft: shape.active - t, elapsed: t, length: shape.active, day: t, active: shape.active, total: shape.total };
  }
  const distance = Math.min(t - shape.active, shape.total - t);
  return {
    factor: distance >= SEASON_RAMP_DAYS ? SIRE_OFF_SEASON_FACTOR : lerp(middle, SIRE_OFF_SEASON_FACTOR, distance / SEASON_RAMP_DAYS),
    inSeason: false,
    daysLeft: shape.total - t,
    elapsed: t - shape.active,
    length: shape.dormancy,
    day: t,
    active: shape.active,
    total: shape.total,
  };
}

/**
 * 精方当下的有效精子品质与分项。没有精方档案（一次性对象）回传 null，呼叫端按品质 1。
 * 有效品质 ＝ 档案品质 × 季节 × 精力周期 × 存量 × 禁欲，夹在 0.25～4。
 * 扶她的季节读她卵方那一份：在乏情期就是非繁殖季（不过渡）。
 */
export function getSireQualityState(chatState, name, { minutesPassed = null } = {}) {
  const key = String(name || '').trim();
  const record = getSireRecord(chatState, key);
  if (!record) return null;
  const now = minutesPassed ?? (Number(chatState?.minutesPassed) || 0);
  const character = chatState?.characters && Object.prototype.hasOwnProperty.call(chatState.characters, key)
    ? chatState.characters[key]
    : null;
  const race = character?.profile?.base?.race ?? record.race;
  const bloodline = character?.profile?.base?.bloodline ?? record.bloodline;
  const derivedType = character ? character.profile?.base?.derivedType : record.derivedType;
  const ratio = Math.max(0.1, Math.min(20, Number(character?.profile?.bio?.menstrualLengthRatio
    ?? getMergedRacePhysiologyProfile(race || '人类', bloodline)?.menstrualLengthRatio) || 1));
  const config = normalizeReproductiveSettings(chatState?.reproductiveSettings);

  let season = { factor: 1, inSeason: null, daysLeft: null, elapsed: null, length: null };
  if (character) {
    const bio = character.profile?.bio || {};
    if (Number(bio.dormancyDays) > 0) {
      season = character.profile?.base?.stage === DORMANCY_STAGE
        ? { factor: SIRE_OFF_SEASON_FACTOR, inSeason: false, daysLeft: null, elapsed: null, length: null }
        : { factor: 1, inSeason: true, daysLeft: null, elapsed: null, length: null };
    }
  } else {
    const shape = getRaceSeasonShape(race, bloodline);
    const phase = shape ? getSireSeasonPhase(record, now) : null;
    if (shape && phase !== null) season = getSeasonFactorAt(shape, phase);
  }

  // 起点：有季节起点就跟着它（同族一起），再按名字错开，免得每位精方一建档就在同一个位置
  const cycleOrigin = hasSeasonOrigin(record) ? Number(record.seasonOrigin) : (Number(record.createdAt) || 0);
  const cycleDays = SPERMATOGENESIS_DAYS * ratio;
  const cycleElapsed = (now - cycleOrigin) / MINUTES_PER_DAY + hashPhase(key) * cycleDays;
  const cycleDay = ((cycleElapsed % cycleDays) + cycleDays) % cycleDays;
  const cycleProfile = getDerivedTypeSireCycleProfile(derivedType);
  const cycleShape = {
    amplitude: cycleProfile.sireCycleAmplitude,
    peakDays: cycleProfile.sireCyclePeakDays,
    cycleDays,
    prompt: cycleProfile.sireCyclePrompt,
  };
  const cycle = getSpermCycleFactor(cycleDay / cycleDays, cycleShape);

  const hours = Math.max(0, now - (Number(record.reserveAt) || 0)) / 60;
  const halfLife = config.sireReserveHalfLifeHours * ratio;
  const reserve = 1 - (1 - normalizeReserve(record.reserve)) * 0.5 ** (hours / halfLife);
  const freshness = 0.5 + 0.5 * reserve;
  const restDays = hours / 24;
  const abstinence = restDays > ABSTINENCE_GRACE_DAYS
    ? Math.max(ABSTINENCE_FLOOR, 1 - ABSTINENCE_DAILY_LOSS * (restDays - ABSTINENCE_GRACE_DAYS))
    : 1;

  const quality = normalizeSpermQuality(record.spermQuality);
  if (record.alwaysPeak) {
    return {
      quality,
      effective: quality,
      alwaysPeak: true,
      season: 1,
      inSeason: null,
      seasonDaysLeft: null,
      seasonElapsed: null,
      seasonLength: null,
      cycle: 1,
      cycleDay,
      cycleDays,
      cycleShape,
      reserve: 1,
      freshness: 1,
      abstinence: 1,
      restDays,
    };
  }
  const effective = normalizeSpermQuality(quality * season.factor * cycle * freshness * abstinence);
  return {
    quality,
    alwaysPeak: false,
    effective,
    season: season.factor,
    inSeason: season.inSeason,
    seasonDaysLeft: season.daysLeft,
    // 这一段（繁殖季或非繁殖季）已过天数与总长；扶她与无季节物种为 null
    seasonElapsed: season.elapsed,
    seasonLength: season.length,
    // 整季时间轴：现在是一季的第几天、活动季多长、整季多长（画时间轴用）
    seasonDay: season.day ?? null,
    seasonActive: season.active ?? null,
    seasonTotal: season.total ?? null,
    cycle,
    cycleDay,
    cycleDays,
    cycleShape,
    reserve,
    freshness,
    abstinence,
    restDays,
  };
}

/** 射精：存量扣掉一部分，从这一刻重新起算回复。没有档案回传 null */
export function consumeSireReserve(chatState, name, { minutesPassed = null } = {}) {
  const key = String(name || '').trim();
  const record = getSireRecord(chatState, key);
  if (!record) return null;
  const now = minutesPassed ?? (Number(chatState?.minutesPassed) || 0);
  const state = getSireQualityState(chatState, key, { minutesPassed: now });
  if (state.alwaysPeak) {
    record.reserve = 1;
    record.reserveAt = now;
    return 1;
  }
  const drain = normalizeReproductiveSettings(chatState?.reproductiveSettings).sireReserveDrain;
  record.reserve = Math.max(0, Math.min(1, state.reserve * (1 - drain)));
  record.reserveAt = now;
  return record.reserve;
}

/** 给模型看的精方状态（摘要行）：存量偏低、禁欲太久、季节；都平常就回空字串 */
export function describeSireCondition(state) {
  if (!state) return '';
  const parts = [];
  // 存量低就是精液变稀、量也少：模型照这句写射精描写与 amount
  if (state.reserve < 0.5) parts.push('刚连射多次，存量很低，精液稀薄、量明显变少');
  else if (state.reserve < 0.8) parts.push('刚射过不久，存量偏低，精液比平时稀、量偏少');
  else if (state.abstinence < 1) parts.push('禁欲太久，精液积存但活力略降');
  // 精力周期冲到高峰才写：有衍生类型的短叙述就用它（易感期、发情期…），没有就写通用的；平时 ±10% 的起伏不写
  const amplitude = Number(state.cycleShape?.amplitude) || 0;
  const peakFloor = state.cycleShape?.peakDays > 0 ? 1 + amplitude * 0.5 : 1.3;
  if (amplitude > 0 && state.cycle >= Math.max(1.05, peakFloor)) {
    parts.push(String(state.cycleShape?.prompt || '').trim() || '正值精力高峰，精液浓稠量多');
  }
  if (state.inSeason === true) parts.push('正值繁殖季');
  if (state.inSeason === false) parts.push('非繁殖季，精力较弱');
  return parts.join('；');
}

/** 精子品质的短分级（介面用，一般也写出来）：稀薄／偏弱／一般／旺盛／极旺 */
export function getSpermQualityTier(value) {
  const quality = normalizeSpermQuality(value);
  if (quality < 0.5) return '稀薄';
  if (quality < 0.8) return '偏弱';
  if (quality < 1.5) return '一般';
  if (quality < 3) return '旺盛';
  return '极旺';
}

export function normalizeSpermQuality(value) {
  const quality = Number(value);
  if (!Number.isFinite(quality) || quality <= 0) return 1;
  return Math.max(SPERM_QUALITY_MIN, Math.min(SPERM_QUALITY_MAX, quality));
}

export function normalizeSireRecord(raw, minutesPassed = 0) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed = parseRaceDescriptor(value.race || '人类');
  const race = parsed.race || '人类';
  const ancestry = getBloodlineInfo(race, value.bloodline ?? parsed.bloodline ?? null, value.bloodlineSource || null);
  const age = Number(value.age);
  const changedAt = Number(value.bodyChangedAtAge);
  return {
    race,
    bloodline: ancestry.bloodline,
    bloodlineSource: ancestry.bloodlineSource,
    derivedType: value.derivedType ? String(value.derivedType).trim() || null : (parsed.derivedType || null),
    age: Number.isFinite(age) && age > 0 ? age : null,
    // 身材上次改变时的年龄（bsGrowBody 的门槛，1.3.1）；没有时从当下年龄起算
    bodyChangedAtAge: Number.isFinite(changedAt) && changedAt > 0 ? changedAt : (Number.isFinite(age) && age > 0 ? age : null),
    bodySize: clampIndividualBodySize(value.bodySize),
    isHere: value.isHere !== false,
    descriptions: {
      normalDescription: normalizeDescriptionList(value.descriptions?.normalDescription, minutesPassed),
    },
    source: SIRE_SOURCES.includes(value.source) ? value.source : 'manual',
    spermQuality: normalizeSpermQuality(value.spermQuality),
    // 剑偏移（1.2.4）：剑 ＝ 体型 ＋ 偏移；扶她也存在精方这份
    swordOffset: normalizeSwordOffset(value.swordOffset),
    // 存量：上次射精后剩下的比例与记下它的分钟数，目前存量按时间惰性推算（getSireQualityState）
    reserve: normalizeReserve(value.reserve),
    reserveAt: value.reserveAt !== null && value.reserveAt !== undefined && Number.isFinite(Number(value.reserveAt))
      ? Math.max(0, Number(value.reserveAt))
      : Math.max(0, Number(value.createdAt) || 0),
    // 作弊：当下品质恒等于档案品质，不受季节、精力周期、存量与禁欲影响；只有使用者在注册页能开。要改品质到变量页改档案
    alwaysPeak: value.alwaysPeak === true,
    // 作弊：胎儿守护。这位精方在场时，他的胎儿健康慢慢回到平稳（见 isSireGuarding）；只有使用者在注册页能开
    fetalGuard: value.fetalGuard === true,
    // 季节时钟起点（分钟）；没有季节的种族与扶她为 null
    seasonOrigin: hasSeasonOrigin(value) ? Math.round(Number(value.seasonOrigin)) : null,
    // 精方只有天赋（资质），没有技能：技能要靠追踪锻炼，精方不追踪
    talents: normalizeTalentList(value.talents),
    createdAt: Math.max(0, Number(value.createdAt) || 0),
  };
}

/** 推进时间时精方也跟着长大（1.3.1 起；以前停在建档时的年龄）；没填年龄的维持 null */
export function advanceSireAges(chatState, days) {
  const sires = chatState?.sires;
  if (!sires || typeof sires !== 'object' || !(Number(days) > 0)) return;
  for (const record of Object.values(sires)) {
    const age = Number(record?.age);
    if (Number.isFinite(age) && age > 0) record.age = age + Number(days) / 365;
  }
}

export function normalizeSires(raw, minutesPassed = 0) {
  const sires = createEmptySires();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sires;
  for (const [key, value] of Object.entries(raw)) {
    const name = String(key || '').trim();
    if (!name || !value || typeof value !== 'object') continue;
    sires[name] = normalizeSireRecord(value, minutesPassed);
  }
  return sires;
}

export function getSireRecord(chatState, name) {
  const key = String(name || '').trim();
  const sires = chatState?.sires;
  if (!key || !sires || typeof sires !== 'object') return null;
  return Object.prototype.hasOwnProperty.call(sires, key) ? sires[key] : null;
}

/**
 * 精方的生理资料：同名卵方优先（扶她读卵方），其次精方档案；都没有回传 null（一次性对象）。
 * 回传的 base 只含建档会带入的栏位，spermQuality 一律取精方档案（卵方没有这个栏位）。
 */
export function resolveSireBase(chatState, name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const sire = getSireRecord(chatState, key);
  const character = chatState?.characters && Object.prototype.hasOwnProperty.call(chatState.characters, key)
    ? chatState.characters[key]
    : null;
  const quality = normalizeSpermQuality(sire?.spermQuality);
  const swordOffset = normalizeSwordOffset(sire?.swordOffset);
  if (character?.profile?.base) {
    const base = character.profile.base;
    return {
      kind: 'character',
      base: {
        race: base.race,
        bloodline: base.bloodline,
        bloodlineSource: base.bloodlineSource,
        derivedType: base.derivedType ? String(base.derivedType) : null,
        bodySize: base.bodySize,
        age: base.age,
        isHere: base.isHere !== false,
      },
      spermQuality: quality,
      swordOffset,
    };
  }
  if (sire) {
    return {
      kind: 'sire',
      base: {
        race: sire.race,
        bloodline: sire.bloodline,
        bloodlineSource: sire.bloodlineSource,
        derivedType: sire.derivedType,
        bodySize: sire.bodySize,
        age: sire.age,
        isHere: sire.isHere !== false,
      },
      spermQuality: quality,
      swordOffset,
    };
  }
  return null;
}

/**
 * 扶她：同名卵方注册后，精方档案只留精方专属栏位（精子品质）。
 * 先建精方、后注册卵方时，档案里的种族、体型、描述、天赋都清掉，一律以卵方为准，免得留着旧资料。
 */
export function pruneFutaSireRecord(chatState, name) {
  const key = String(name || '').trim();
  const sire = getSireRecord(chatState, key);
  if (!sire || !chatState?.characters || !Object.prototype.hasOwnProperty.call(chatState.characters, key)) return false;
  chatState.sires[key] = normalizeSireRecord({
    spermQuality: sire.spermQuality,
    swordOffset: sire.swordOffset,
    alwaysPeak: sire.alwaysPeak,
    fetalGuard: sire.fetalGuard,
    reserve: sire.reserve,
    reserveAt: sire.reserveAt,
    source: sire.source,
    createdAt: sire.createdAt,
  });
  return true;
}

/** 先天天赋的来源：同名卵方（含扶她）读卵方，其次精方档案；一次性对象没有 */
export function getParentTalents(chatState, name) {
  const key = String(name || '').trim();
  if (!key) return [];
  const character = chatState?.characters && Object.prototype.hasOwnProperty.call(chatState.characters, key)
    ? chatState.characters[key]
    : null;
  if (character) return normalizeTalentList(character.profile?.talents);
  return normalizeTalentList(getSireRecord(chatState, key)?.talents);
}

function formatSireRace(record) {
  const race = String(record?.race || '人类');
  return record?.derivedType ? `[${record.derivedType}]${race}` : race;
}

/** 胎儿守护（作弊）：这位精方开了守护且在场；扶她看卵方本人在不在场 */
export function isSireGuarding(chatState, name) {
  const sire = getSireRecord(chatState, name);
  if (sire?.fetalGuard !== true) return false;
  return resolveSireBase(chatState, name)?.base?.isHere !== false;
}

/** 胎儿的遗传父方：嵌合胎取全部来源，其余拆 fathers（「甲×乙」） */
export function getFetusFatherNames(fetus) {
  const sources = Array.isArray(fetus?.chimera?.fatherSources) ? fetus.chimera.fatherSources : [];
  const names = sources.length > 0 ? sources : String(fetus?.fathers || '').split('×');
  return [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
}

/** 正在守护这一胎的父方名字（嵌合胎有一位在场就算）；没有回空字串 */
export function getGuardingSire(chatState, fetus) {
  return getFetusFatherNames(fetus).find((name) => isSireGuarding(chatState, name)) || '';
}

/** 当前胎儿的遗传父方与认定父亲：嵌合胎的「A × B」拆开 */
function collectFetusFatherNames(chatState) {
  const names = new Set();
  for (const character of Object.values(chatState?.characters || {})) {
    for (const fetus of (Array.isArray(character?.profile?.pregnant?.fetuses) ? character.profile.pregnant.fetuses : [])) {
      for (const part of String(fetus?.fathers || '').split('×')) if (part.trim()) names.add(part.trim());
      if (fetus?.selectedFather) names.add(String(fetus.selectedFather).trim());
    }
  }
  return names;
}

/**
 * 送进追踪与主流的精方清单。只送这一轮用得到的，不送整张表：
 * - 在场：完整档案与描述；带 * 的字段超过一天没更新时列在 staleFields
 * - 不在场：只有是当前胎儿的父亲／认定父亲，或最近讯息提到名字时，才送一行摘要（不送描述）
 * 同名卵方（扶她）已在角色状态里，不重复送。
 */
export function buildSirePromptEntries(chatState, { recentText = '', guide = '', minutesPassed = null } = {}) {
  const sires = chatState?.sires;
  if (!sires || typeof sires !== 'object') return [];
  const now = minutesPassed != null && Number.isFinite(Number(minutesPassed)) ? Number(minutesPassed) : (Number(chatState?.minutesPassed) || 0);
  const starred = new Set(parseDescriptionGuideFields(guide).filter((field) => field.starred).map((field) => field.name));
  const fathers = collectFetusFatherNames(chatState);
  const text = String(recentText || '');
  const entries = [];
  for (const [name, record] of Object.entries(sires)) {
    if (chatState?.characters && Object.prototype.hasOwnProperty.call(chatState.characters, name)) continue;
    const qualityState = getSireQualityState(chatState, name, { minutesPassed: now });
    // 天生体质看档案品质；此刻的状态（存量、季节、高峰）在 condition
    const virility = describeSpermQuality(record.spermQuality);
    const condition = describeSireCondition(qualityState);
    const summary = {
      name,
      race: formatSireRace(record),
      ...(record.age ? { age: Math.round(record.age * 100) / 100 } : {}),
      // 只给追踪模型判断能不能用 bsGrowBody；主线拿掉
      ...(record.bodyChangedAtAge ? { bodyChangedAtAge: Math.round(record.bodyChangedAtAge * 100) / 100 } : {}),
      ...(record.bodySize ? { bodySize: record.bodySize } : {}),
      ...(virility ? { virility } : {}),
      ...(condition ? { condition } : {}),
      // 剑只送文字：模型看不懂偏移数字
      ...(record.swordOffset ? { sword: describeSwordOffset(record.swordOffset) } : {}),
    };
    if (record.isHere !== false) {
      const list = record.descriptions?.normalDescription || [];
      // 天赋给模型看名字与方向，不给经验数字
      const talents = (record.talents || [])
        .filter((talent) => talent.level !== 0)
        .map((talent) => `${resolveSkillDefinition(chatState?.skillCatalog, talent.skillId)?.name || `技能 #${talent.skillId}`}（${getTalentLabel(talent)}）`);
      const stale = getStaleDescriptionFields(list, now).filter((field) => starred.has(field));
      entries.push({
        ...summary,
        isHere: true,
        descriptions: descriptionListToObject(list),
        ...(talents.length > 0 ? { talents } : {}),
        ...(stale.length > 0 ? { staleFields: stale } : {}),
      });
    } else if (fathers.has(name) || (name && text.includes(name))) {
      entries.push({ ...summary, isHere: false });
    }
  }
  return entries;
}

/**
 * 注册页建立或更新精方。内容没变的描述字段保留原本的 updatedAt，免得一存档就把「行动」刷成刚更新。
 * 同名卵方（扶她）只存精方专属栏位，种族、体型、描述一律以卵方为准。
 */
export function upsertSireRecord(chatState, name, fields = {}, { source = 'manual' } = {}) {
  const key = String(name || '').trim();
  if (!chatState || !key) return { applied: false, message: '请先填写精方名字。' };
  if (!chatState.sires || typeof chatState.sires !== 'object') chatState.sires = createEmptySires();
  const now = Number(chatState.minutesPassed) || 0;
  const previous = getSireRecord(chatState, key);
  const isFuta = Boolean(chatState.characters && Object.prototype.hasOwnProperty.call(chatState.characters, key));
  const previousList = previous?.descriptions?.normalDescription || [];
  const nextList = isFuta ? [] : (fields.descriptions || []).map((entry) => {
    const old = previousList.find((item) => item.name === entry.name);
    return { name: entry.name, value: entry.value, updatedAt: old && old.value === entry.value ? old.updatedAt : now };
  });
  chatState.sires[key] = normalizeSireRecord({
    ...(previous || {}),
    ...(fields.spermQuality !== undefined && fields.spermQuality !== null ? { spermQuality: fields.spermQuality } : {}),
    ...(fields.swordOffset !== undefined && fields.swordOffset !== null ? { swordOffset: fields.swordOffset } : {}),
    ...(typeof fields.alwaysPeak === 'boolean' ? { alwaysPeak: fields.alwaysPeak } : {}),
    ...(typeof fields.fetalGuard === 'boolean' ? { fetalGuard: fields.fetalGuard } : {}),
    ...(isFuta ? {} : {
      race: fields.race || previous?.race || '人类',
      bloodline: fields.race ? null : previous?.bloodline,
      bloodlineSource: fields.race ? null : previous?.bloodlineSource,
      derivedType: fields.race ? null : previous?.derivedType,
      age: fields.age,
      bodySize: fields.bodySize,
      isHere: fields.isHere,
      ...(fields.talents !== undefined ? { talents: fields.talents } : {}),
    }),
    descriptions: { normalDescription: nextList },
    source: previous?.source || source,
    createdAt: previous ? previous.createdAt : now,
    ...(previous ? {} : { reserve: 1, reserveAt: now }),
  }, now);
  // 季节起点：新建档或改了种族时，对齐主血统相同的已注册者（只在这时对齐一次）；扶她读卵方，不存
  const record = chatState.sires[key];
  const raceChanged = Boolean(previous && !isFuta && fields.race && previous.race !== record.race);
  if (isFuta) record.seasonOrigin = null;
  else if (!previous || raceChanged || !hasSeasonOrigin(record)) record.seasonOrigin = resolveSireSeasonOrigin(chatState, key, record, now);
  const verb = previous ? '已更新' : '已建立';
  return {
    applied: true,
    created: !previous,
    message: isFuta
      ? `${verb}精方 ${key}：同名卵方已注册（扶她），种族、体型、在场与描述读卵方。`
      : `${verb}精方 ${key}（${formatSireRaceDescriptor(chatState.sires[key])}）。`,
  };
}

export function deleteSireRecord(chatState, name) {
  const key = String(name || '').trim();
  if (!getSireRecord(chatState, key)) return { applied: false, message: `没有名为 ${key} 的精方。` };
  delete chatState.sires[key];
  return { applied: true, message: `已删除精方 ${key}；既有胎儿与孩子保留当时的父方快照。` };
}

/** 档案转回注册页的种族栏：明确比例的混血写成「精灵25%x人类75%」，再加衍生前缀，存回去能还原 */
export function formatSireRaceDescriptor(record) {
  const race = String(record?.race || '人类');
  const entries = Object.entries(record?.bloodline || {});
  const body = entries.length > 1 && record?.bloodlineSource !== 'estimated'
    ? entries.map(([name, share]) => `${name}${Number((share * 100).toFixed(2))}%`).join('x')
    : race;
  return record?.derivedType ? `[${record.derivedType}]${body}` : body;
}
