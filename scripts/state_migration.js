import { normalizeExperience, psychologySide } from './reproductive.js';
import {
  RACE_PHYSIOLOGY_PROFILES,
  computePostpartumRecoveryDays,
  getRaceComponents,
  getRecoveryCoefficientByRace,
} from './race_config.js';

/**
 * 聊天存档结构版本。1.0.0～1.0.5 的存档没有这个栏位，视为 1。
 * 升版时在这里加一段 v(n) → v(n+1) 的角色迁移，并让 CHAT_STATE_SCHEMA_VERSION 跟着加一。
 */
export const CHAT_STATE_SCHEMA_VERSION = 4;

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

  const legacy = averageTolerance(base.race, (part) => Number(LEGACY_BREED_TOLERANCE_V1[part]));
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

const CHARACTER_MIGRATIONS = Object.freeze({
  1: migrateCharacterV1ToV2,
  2: migrateCharacterV2ToV3,
  3: migrateCharacterV3ToV4,
});

export function getChatStateSchemaVersion(chatState) {
  const version = Number(chatState?.schemaVersion);
  return Number.isInteger(version) && version >= 1 ? version : 1;
}

/** 把一组角色从 fromVersion 逐版迁到最新；角色物件就地修改 */
export function migrateCharacters(characters, fromVersion) {
  if (!characters || typeof characters !== 'object') return;
  for (let version = fromVersion; version < CHAT_STATE_SCHEMA_VERSION; version += 1) {
    const migrate = CHARACTER_MIGRATIONS[version];
    if (!migrate) continue;
    for (const character of Object.values(characters)) migrate(character);
  }
}
