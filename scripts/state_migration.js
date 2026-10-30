import { normalizeExperience, psychologySide } from './reproductive.js';
import { DESCRIPTION_FIELDS, normalizeDescriptionList } from './descriptions.js';
import {
  RACE_PHYSIOLOGY_PROFILES,
  canonicalizeRaceDescriptor,
  canonicalizeRaceName,
  computePostpartumRecoveryDays,
  getRaceComponents,
  getBloodlineInfo,
  getRecoveryCoefficientByRace,
  getWeightedRaceParts,
} from './race_config.js';
import { MENSTRUAL_STAGE_DAYS } from './stage_config.js';

/**
 * 聊天存档结构版本。1.0.0～1.0.5 的存档没有这个栏位，视为 1。
 * 升版时在这里加一段 v(n) → v(n+1) 的角色迁移，并让 CHAT_STATE_SCHEMA_VERSION 跟着加一。
 */
export const CHAT_STATE_SCHEMA_VERSION = 11;

/**
 * 1.0.6 之前的内置承载耐受。那时产后恢复天数除以承载耐受，
 * 卵生、不定型、胎转卵生的耐受被灌高来抵消胚型系数；1.0.6 起恢复期与耐受解绑，内置值改回原意。
 * 迁移只认这份旧表：角色的耐受仍等于旧内置值，才视为「没被自订过」而换成新内置值。
 */
const LEGACY_BREED_TOLERANCE_V1 = Object.freeze({
  人类: 1, 精灵: 0.33, 兽耳族: 3, 怪兽类: 3, 袋兽族: 0.01, 哥布林: 1, 兽人: 2, 矮人: 1, 半身人: 2,
  半人马: 0.5, 巨人: 1, 媚魔: 3, 雪族: 0.8, 夜叉: 0.8, 妖狐: 0.5, 貓又: 1.5, 月兔族: 2.5, 杜拉罕: 3,
  鸟人: 1, 怪鸟类: 2, 植物亚人: 1, 社会虫族: 4, 蜥蜴人: 2.5, 触手怪: 5, 妖精: 1, 真菌亚人: 1,
  海蛞蝓族: 0.25, 龟族: 0.8, 甲壳族: 1.6, 宝箱怪: 3.6, 阿拉克涅: 4, 百足姬: 4, 天狗: 1.5, 深潜者: 3,
  狗头人: 1.2, 人鱼: 0.75, 鱼人: 1, 怪鱼类: 2, 海妖: 0.3, 独居虫族: 1, 蛇人: 2, 蛙人: 1, 眼魔: 0.75,
  水母族: 0.5, 海马族: 0.4, 河童: 1.5, 梅杜莎: 1, 西方龙: 10, 东方龙: 1 / 3, 狮鹫族: 9, 天使: 7, 恶魔: 7,
  奇美拉: 12, 麒麟: 0.8, 凤凰: 0.5, 白泽: 0.4, 独角兽: 8, 空鲸: 10, 星繭族: 1, 修格斯: 12, 史萊姆: 8,
  石像鬼: 4, 烛灵: 2, 人偶: 2, 心魇: 0.8, 夢魔: 3, 宝石人: 2, 奈米丛族: 6, 元素灵: 5, 灯神: 6, 影魔: 5,
  活体铠甲: 2, 伪人: 2,
});
const LEGACY_BREED_TOLERANCE_BY_NAME = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_BREED_TOLERANCE_V1).map(([race, value]) => [canonicalizeRaceName(race), value]),
));

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function isClose(a, b) {
  return Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < 1e-6;
}

/** 混血与注册时一样取各成分算术平均；有成分不在旧表里就不动（多半是自订种族） */
function averageTolerance(race, table) {
  const parts = getRaceComponents(race);
  if (parts.length === 0) return null;
  const values = parts.map((part) => table(part));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getToleranceCountModifier(fetusCount) {
  return Math.max(0.6, 1 - ((Math.max(1, fetusCount) - 1) * 0.04));
}

/**
 * v1 → v2：
 * 1. 承载耐受仍是旧内置值的，换成新内置值（怀孕中连胎数修正一起重算）；自订过的不动。
 * 2. 产后恢复天数不再存在孕期快照里；不在产后恢复的角色按新公式（单胎）重算，
 *    正在产后恢复的保留原天数，不打断进行中的恢复。
 */
function migrateCharacterV1ToV2(character) {
  const profile = character?.profile;
  if (!profile || typeof profile !== 'object') return;
  const base = profile.base || {};
  const bio = profile.bio && typeof profile.bio === 'object' ? profile.bio : (profile.bio = {});
  const fetusCount = Array.isArray(profile.pregnant?.fetuses) ? profile.pregnant.fetuses.length : 0;
  const originalBio = character.runtime?.originalPregnancyBio;

  const legacy = averageTolerance(base.race, (part) => Number(LEGACY_BREED_TOLERANCE_BY_NAME[part]));
  const next = averageTolerance(base.race, (part) => Number(RACE_PHYSIOLOGY_PROFILES[part]?.breedTolerance));
  if (legacy !== null && next !== null && !isClose(legacy, next)) {
    const modifier = getToleranceCountModifier(fetusCount);
    if (originalBio && (isClose(originalBio.breedTolerance, legacy) || isClose(originalBio.breedTolerance, clamp(legacy, 0.1, 100, legacy)))) {
      originalBio.breedTolerance = clamp(next, 0.1, 100, 1);
      bio.breedTolerance = fetusCount > 0 ? clamp(originalBio.breedTolerance * modifier, 0.1, 100, 1) : originalBio.breedTolerance;
    } else if (!originalBio && isClose(bio.breedTolerance, legacy)) {
      bio.breedTolerance = next;
    } else if (!originalBio && fetusCount > 0 && isClose(bio.breedTolerance, clamp(legacy * modifier, 0.1, 100, legacy))) {
      // 孕中但孕期快照已丢失（例如从楼层快照还原）：耐受停在「旧值 × 胎数修正」
      bio.breedTolerance = clamp(next * modifier, 0.1, 100, 1);
    }
  }

  if (originalBio) delete originalBio.recoveryDays;
  if (String(base.stage || '') !== '产后恢复') {
    const experience = profile.experience || {};
    bio.recoveryDays = computePostpartumRecoveryDays({
      recoveryCoefficient: getRecoveryCoefficientByRace(base.race),
      vitalityLevel: base.vitalityLevel,
      priorBirths: clamp(experience.naturalBirthExperience, 0, 999, 0) + clamp(experience.surgicalBirthExperience, 0, 999, 0),
      fetusCount: 1,
    });
  }
}

/**
 * v2 → v3（1.0.7 延产）：补上延产次数、本次延产到期日与子宫乏力级数。
 * 旧存档不可能处在延产期，一律从「没延产过、没有乏力」开始。
 */
function migrateCharacterV2ToV3(character) {
  const profile = character?.profile;
  if (!profile || typeof profile !== 'object') return;
  const pregnant = profile.pregnant && typeof profile.pregnant === 'object' ? profile.pregnant : (profile.pregnant = {});
  const base = profile.base && typeof profile.base === 'object' ? profile.base : (profile.base = {});
  if (!Number.isInteger(pregnant.extensionCount)) pregnant.extensionCount = 0;
  if (pregnant.extensionUntilDays === undefined) pregnant.extensionUntilDays = null;
  if (!Number.isFinite(Number(base.uterineAtony))) base.uterineAtony = 0;
}

function migrateCharacterV3ToV4(character) {
  const profile = character?.profile;
  if (!profile || profile.reproductiveMigration?.version === 4) return;
  const old = JSON.parse(JSON.stringify({ experience: profile.experience || {}, psychology: profile.psychology || {} }));
  profile.reproductiveMigration = { version: 4, original: old };
  const e = profile.experience || {};
  profile.experience = normalizeExperience({ ...e,
    emotionalMates: e.emotionalMates ?? (e.emotionalMate ? [e.emotionalMate] : []),
    marriageMates: e.marriageMates ?? (e.marriageMate ? [e.marriageMate] : []),
    abortionExperience: e.abortionExperience ?? 0,
  });
  profile.cognitionRecords = profile.cognitionRecords || [];
  const psy = profile.psychology || {};
  const enabled = Object.keys(psy.stageProfiles || {}).length > 0;
  const side = psychologySide(profile.base?.stage);
  psy.enabled = enabled;
  psy.activeSide = side;
  for (const group of ['mens', 'preg']) {
    for (const key of ['isChaste', 'hasContraception', 'knowsFatherSource', 'hasProfessionalPrenatalCare']) delete psy[group]?.[key];
  }
  delete psy.preg?.cognition_value;
  delete psy.preg?.cognition_interpret;
  if (psy.stageProfiles) delete psy.stageProfiles.preg;
  if (enabled && side === 'preg') {
    psy.preg = { confidence_value: 50, bonding_value: 50, stance_value: 50 };
    delete psy.stageProfiles?.mens;
  } else psy.preg = {};
  profile.psychology = psy;
  for (const child of (profile.children || [])) if (child.selectedFather === undefined) child.selectedFather = null;
}

export function normalizeCharacterBloodlines(character) {
  const profile = character?.profile;
  if (!profile || typeof profile !== 'object') return;
  const list = (value) => Array.isArray(value) ? value : [];
  const records = [profile.base, ...list(profile.base?.sperms), ...list(profile.base?.spermContacts),
    ...list(profile.pregnant?.fetuses), ...list(profile.children)];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || seen.has(record)) continue;
    seen.add(record);
    records.push(...list(record.contactEmbryos));
    if (!record.race) continue;
    Object.assign(record, getBloodlineInfo(record.race, record.bloodline, record.bloodlineSource));
    if (record.fatherRace) {
      const father = getBloodlineInfo(record.fatherRace, record.fatherBloodline, record.fatherBloodlineSource);
      record.fatherBloodline = father.bloodline;
      record.fatherBloodlineSource = father.bloodlineSource;
    }
  }
}

/**
 * v6 → v7（1.1.4 改名）：把存下的种族字串与血统比例的键换成新名（百足姬→百足氏等，见 RACE_RENAMES），
 * 繁体或混写的内置名称一并收敛成规范字形。只认栏位名：race、*Race 是种族字串，bloodline、*Bloodline 是比例表；
 * 名字与人物（fathers、provider 等）不动。查不到的自订种族原样保留。
 */
function isRaceKey(key) {
  return key === 'race' || /^[a-z]+Race$/.test(key);
}

function isBloodlineKey(key) {
  return key === 'bloodline' || /^[a-z]+Bloodline$/.test(key);
}

function renameBloodlineKeys(bloodline) {
  const result = {};
  for (const [name, value] of Object.entries(bloodline)) {
    const key = canonicalizeRaceName(name);
    result[key] = typeof value === 'number' && typeof result[key] === 'number' ? result[key] + value : value;
  }
  return result;
}

function renameRacesDeep(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) renameRacesDeep(item, seen);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && isRaceKey(key)) node[key] = canonicalizeRaceDescriptor(value);
    else if (value && typeof value === 'object' && !Array.isArray(value) && isBloodlineKey(key)) node[key] = renameBloodlineKeys(value);
    else renameRacesDeep(value, seen);
  }
}

function migrateCharacterV6ToV7(character) {
  renameRacesDeep(character);
}

/**
 * v9 → v10（1.2.1 改名）：植物族→怪植类、真菌族→怪菌类、社会虫族→群居虫人、独居虫族→独居虫人，
 * 做法与 v6 → v7 相同。精方档案不在角色里，由 state.js 另外对 sires 呼叫 renameStoredRaces。
 */
export function renameStoredRaces(node) {
  renameRacesDeep(node);
}

/**
 * 1.1.5：描述从「字段名|内容;;」字串改成 [{ name, value, updatedAt }]。
 * 切不出字段名的段落整段收进「未分类」；updatedAt 记为迁移当下的系统时钟，免得一升级就全部被点名。
 */
function migrateCharacterV7ToV8(character, { minutesPassed = 0 } = {}) {
  const profile = character?.profile;
  if (!profile || typeof profile !== 'object') return;
  const descriptions = profile.descriptions && typeof profile.descriptions === 'object' && !Array.isArray(profile.descriptions)
    ? profile.descriptions
    : {};
  profile.descriptions = Object.fromEntries(DESCRIPTION_FIELDS.map((field) => [field, normalizeDescriptionList(descriptions[field], minutesPassed)]));
}

/**
 * 1.2.3 以前的内置经期倍率：这些物种改成「活动周期＋乏情」（长周期、季节性繁殖），
 * 倍率可能不变（妖狐 1 → 1 加乏情）。只列有改动的物种，其余物种没有乏情、每季一轮。
 */
const LEGACY_MENSTRUAL_RATIO_V10 = Object.freeze({
  天使: 13, 恶魔: 13, 西方龙: 4, 东方龙: 4, 狮鹫: 3.5,
  精灵: 3, 卓尔: 3, 妖精: 3, 甲壳族: 3, 斯芬克斯: 3, 空鲸: 3, 宝石人: 3, 羽蛇: 3,
  兽耳族: 0.75, 米诺陶族: 0.75, 萨堤尔族: 0.75, 月兔: 0.5, 妖狐: 1, 化狸: 0.75, 镰鼬: 0.75, 赛尔克族: 1, 鲛人: 1, 蛇人: 1, 龟族: 2, 华根蕴桃: 1.5,
  半人马: 1, 独角兽: 1.5, 天马: 1.5, 半人鹿: 1.25, 貓又: 0.75, 地狱犬: 1.5,
  鸟族: 1, 天狗: 1, 赛壬: 1, 爱那温: 1, 蜥蜴人: 0.75, 鱼人: 2, 蝾螈族: 1, 蛙族: 0.5, 海马族: 1.5, 绒虫族: 1.5,
  巨人: 2, 杜拉罕: 2, 魔族: 2, 海德拉: 2, 修格斯: 2, 夺心魔: 2, 眼魔: 2,
  麒麟: 1.75, 凤凰: 1.75, 白泽: 1.75, 米戈: 1.5, 深潜者: 1.5, 星繭族: 1.5, 灯神: 1.5, 梅杜莎: 1.5,
});

/** 按血统加权内置值；有成分不是内置物种（自订或未收录）就回 null，不动 */
function weightedBuiltinValue(parts, valueOf) {
  if (parts.length === 0 || parts.some((part) => !RACE_PHYSIOLOGY_PROFILES[part.name])) return null;
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  if (!(total > 0)) return null;
  return parts.reduce((sum, part) => sum + part.weight * valueOf(part.name), 0) / total;
}

/**
 * v10 → v11（1.2.3 乏情期）：经期倍率仍等于旧内置值的角色，换成新倍率、乏情天数与每季轮数；百科或手动改过的不动。
 * 正在活动周期某一期中间的，已过天数按新旧倍率等比缩放，免得一迁移就跳过整段经期。
 */
function migrateCharacterV10ToV11(character) {
  const profile = character?.profile;
  if (!profile || typeof profile !== 'object') return;
  const base = profile.base || {};
  const bio = profile.bio && typeof profile.bio === 'object' ? profile.bio : null;
  if (!bio) return;
  const parts = getWeightedRaceParts(base.race, base.bloodline);
  if (!parts.some((part) => LEGACY_MENSTRUAL_RATIO_V10[part.name])) return;
  const legacy = weightedBuiltinValue(parts, (name) => LEGACY_MENSTRUAL_RATIO_V10[name] ?? RACE_PHYSIOLOGY_PROFILES[name].menstrualLengthRatio);
  const nextRatio = weightedBuiltinValue(parts, (name) => RACE_PHYSIOLOGY_PROFILES[name].menstrualLengthRatio);
  const nextDormancy = weightedBuiltinValue(parts, (name) => Number(RACE_PHYSIOLOGY_PROFILES[name].dormancyDays) || 0);
  const nextSeasonCycles = weightedBuiltinValue(parts, (name) => Number(RACE_PHYSIOLOGY_PROFILES[name].seasonCycles) || 1);
  if (legacy === null || nextRatio === null || !isClose(bio.menstrualLengthRatio, legacy)) return;
  if (MENSTRUAL_STAGE_DAYS[String(base.stage || '')]) {
    base.days = clamp(base.days, 0, 9999, 0) * (nextRatio / legacy);
  }
  bio.menstrualLengthRatio = nextRatio;
  bio.dormancyDays = nextDormancy;
  bio.seasonCycles = nextSeasonCycles;
}

const CHARACTER_MIGRATIONS = Object.freeze({
  1: migrateCharacterV1ToV2,
  2: migrateCharacterV2ToV3,
  3: migrateCharacterV3ToV4,
  4: normalizeCharacterBloodlines,
  6: migrateCharacterV6ToV7,
  7: migrateCharacterV7ToV8,
  9: migrateCharacterV6ToV7,
  10: migrateCharacterV10ToV11,
});

export function getChatStateSchemaVersion(chatState) {
  const version = Number(chatState?.schemaVersion);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}

/**
 * 把一组角色从 fromVersion 逐版迁到最新；角色物件就地修改。
 * context.minutesPassed 是这组角色所在的系统时钟（聊天本体或该层快照），需要时间戳的迁移用它。
 */
export function migrateCharacters(characters, fromVersion, context = {}) {
  if (!characters || typeof characters !== 'object') return;
  for (let version = fromVersion; version < CHAT_STATE_SCHEMA_VERSION; version += 1) {
    const migrate = CHARACTER_MIGRATIONS[version];
    if (!migrate) continue;
    for (const character of Object.values(characters)) migrate(character, context);
  }
}
