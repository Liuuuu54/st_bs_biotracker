// 全域角色库：已注册卵方与精方的基础资料存在全域设定（settings.characterLibrary），在别的聊天手动带入，
// 不必再花一次模型呼叫重新注册。同名的卵方与精方（扶她、使用者本人）存在同一笔。
// 只存基础资料：怀孕、经期、经验、心理、衣柜、日记、精方存量与季节等进度不存，带入后照新聊天重新开始。
// 角色库是快照，不自动同步：带入后两边各自变化，要更新就再存一次。
import { applyRegistryResult } from './registry.js';
import { parseDescriptionGuideFields } from './descriptions.js';
import { DEFAULT_REGISTRY_DESCRIPTION_GUIDES } from './prompts/rules.js';
import { getSireRecord, normalizeSireRecord, upsertSireRecord } from './sires.js';
import { normalizeNextSkillId, normalizeSkillCatalog, normalizeTalentList, registerSkillDefinition, resolveSkillDefinition, talentPointsToState, talentStateToPoints } from './skill_config.js';

const EGG_BASE_FIELDS = Object.freeze(['race', 'bloodline', 'bloodlineSource', 'derivedType', 'age', 'bodySize', 'sheathOffset', 'vitalityLevel', 'psyStressLevel']);
const EGG_IMMUNE_FIELDS = Object.freeze(['metabolism', 'miscarriage', 'realisticLabor', 'crossSpecies']);
const SIRE_FIELDS = Object.freeze(['race', 'bloodline', 'bloodlineSource', 'derivedType', 'age', 'bodySize', 'spermQuality', 'swordOffset', 'alwaysPeak', 'fetalGuard']);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function getCharacterLibrary(settings) {
  if (!settings.characterLibrary || typeof settings.characterLibrary !== 'object' || Array.isArray(settings.characterLibrary)) {
    settings.characterLibrary = {};
  }
  return settings.characterLibrary;
}

/** 下拉选单用：名字、存入时间、有没有卵方／精方与各自的种族 */
export function listLibraryEntries(settings) {
  return Object.entries(getCharacterLibrary(settings))
    .filter(([, entry]) => entry && typeof entry === 'object' && (entry.egg || entry.sire))
    .map(([name, entry]) => ({
      name,
      savedAt: Number(entry.savedAt) || 0,
      egg: entry.egg ? { race: entry.egg.base?.race || '' } : null,
      sire: entry.sire ? { race: entry.sire.race || entry.egg?.base?.race || '' } : null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh'));
}

/** 天赋按技能 ID 存，ID 只在各自聊天的技能图鉴里有效；进角色库时换成名称与说明 */
function talentsToPortable(talents, catalog) {
  return normalizeTalentList(talents).map((talent) => {
    const definition = resolveSkillDefinition(catalog, talent.skillId);
    return definition ? { name: definition.name, description: definition.description, points: talentStateToPoints(talent) } : null;
  }).filter((item) => item && item.points !== 0);
}

/** 带入时按名称找这个聊天的技能，没有就照存下的说明建一个 */
function talentsFromPortable(list, chatState) {
  const talents = [];
  for (const item of Array.isArray(list) ? list : []) {
    const registered = registerSkillDefinition(chatState.skillCatalog, { name: item?.name, description: item?.description }, chatState.nextSkillId);
    if (!registered.ok) continue;
    chatState.skillCatalog = normalizeSkillCatalog(registered.catalog);
    chatState.nextSkillId = normalizeNextSkillId(chatState.skillCatalog, registered.nextSkillId);
    const talent = talentPointsToState(registered.definition.id, item.points);
    if (talent) talents.push(talent);
  }
  return normalizeTalentList(talents);
}

/**
 * 描述只存稳定的栏位：范本里打星号的（状态、表情、行动等）是当下的即时状态，
 * 例如「孕中期身子沉了几分」，带进别的聊天就矛盾了，由那边的追踪重新写。
 * 卵方另外不存跟着生殖阶段变的栏位（腹部、症状）：孕肚、孕吐之类带进没怀孕的聊天一样矛盾。
 */
const EGG_STATEFUL_DESCRIPTION_FIELDS = Object.freeze(['腹部', '症状']);

function descriptionsToPortable(list, guides, extraExcluded = []) {
  const starred = (guide) => parseDescriptionGuideFields(guide).filter((field) => field.starred).map((field) => field.name);
  const excluded = new Set([...guides.flatMap(starred), ...extraExcluded]);
  return (Array.isArray(list) ? list : [])
    .map((entry) => ({ name: String(entry?.name || '').trim(), value: String(entry?.value || '').trim() }))
    .filter((entry) => entry.name && entry.value && !excluded.has(entry.name));
}

/** 使用者的范本加上预设范本：旧版范本没有星号，预设范本的即时栏位照样排除 */
function guidesOf(settings, key) {
  return [settings?.registryDescriptionGuides?.[key], DEFAULT_REGISTRY_DESCRIPTION_GUIDES[key]].filter(Boolean);
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) if (source?.[field] !== undefined) result[field] = clone(source[field]);
  return result;
}

/** 已注册卵方 → 角色库（覆写这一笔的卵方部分，精方部分保留） */
export function saveEggToLibrary(settings, chatState, name) {
  const key = String(name || '').trim();
  const character = chatState?.characters?.[key];
  if (!key || !character?.initialized) return { saved: false, message: `${key || '这名角色'}还没有注册。` };
  const profile = character.profile || {};
  const library = getCharacterLibrary(settings);
  library[key] = {
    ...(library[key] || {}),
    egg: {
      base: pick(profile.base, EGG_BASE_FIELDS),
      immune: pick(profile.immune, EGG_IMMUNE_FIELDS),
      descriptions: { normalDescription: descriptionsToPortable(profile.descriptions?.normalDescription, guidesOf(settings, 'normalDescription'), EGG_STATEFUL_DESCRIPTION_FIELDS) },
      talents: talentsToPortable(profile.talents, chatState.skillCatalog),
    },
    savedAt: Date.now(),
  };
  return { saved: true, message: `已把卵方 ${key} 存入角色库。` };
}

/** 精方档案 → 角色库；扶她的精方档案只有精方专属栏位，种族等基础资料看卵方那部分 */
export function saveSireToLibrary(settings, chatState, name) {
  const key = String(name || '').trim();
  const sire = getSireRecord(chatState, key);
  if (!key || !sire) return { saved: false, message: `${key || '这名精方'}还没有精方档案。` };
  const library = getCharacterLibrary(settings);
  library[key] = {
    ...(library[key] || {}),
    sire: {
      ...pick(sire, SIRE_FIELDS),
      descriptions: { normalDescription: descriptionsToPortable(sire.descriptions?.normalDescription, guidesOf(settings, 'sireDescription')) },
      talents: talentsToPortable(sire.talents, chatState.skillCatalog),
    },
    savedAt: Date.now(),
  };
  return { saved: true, message: `已把精方 ${key} 存入角色库。` };
}

export function deleteLibraryEntry(settings, name) {
  const library = getCharacterLibrary(settings);
  const key = String(name || '').trim();
  if (!Object.prototype.hasOwnProperty.call(library, key)) return false;
  delete library[key];
  return true;
}

/**
 * 角色库 → 这个聊天。先卵方再精方（扶她的精方档案要在卵方注册之后才会只留精方栏位）。
 * 这个聊天已有同名卵方或精方的那一部分不带入，免得盖掉这里的进度。
 */
export function importLibraryEntry(chatState, settings, name, { random = Math.random } = {}) {
  const key = String(name || '').trim();
  const entry = getCharacterLibrary(settings)[key];
  if (!entry || (!entry.egg && !entry.sire)) return { egg: false, sire: false, message: `角色库里没有 ${key || '这个名字'}。` };
  const notes = [];
  let egg = false;
  let sire = false;
  if (entry.egg) {
    if (chatState.characters?.[key]?.initialized) {
      notes.push(`这个聊天已注册卵方 ${key}，没有带入卵方`);
    } else {
      const base = clone(entry.egg.base) || {};
      applyRegistryResult(chatState, {
        name: key,
        profile: { base, descriptions: { normalDescription: clone(entry.egg.descriptions?.normalDescription) || [] } },
      }, { allowBreedingPsychology: false, useGestationModifier: false, random });
      const profile = chatState.characters[key].profile;
      profile.immune = { ...(profile.immune || {}), ...(clone(entry.egg.immune) || {}) };
      const talents = talentsFromPortable(entry.egg.talents, chatState);
      if (talents.length > 0) profile.talents = talents;
      egg = true;
    }
  }
  if (entry.sire) {
    if (getSireRecord(chatState, key)) {
      notes.push(`这个聊天已有精方 ${key}，没有带入精方`);
    } else {
      const source = entry.sire;
      const result = upsertSireRecord(chatState, key, {
        race: source.race,
        age: source.age ?? null,
        bodySize: source.bodySize ?? null,
        spermQuality: source.spermQuality ?? 1,
        swordOffset: source.swordOffset ?? 0,
        alwaysPeak: source.alwaysPeak === true,
        fetalGuard: source.fetalGuard === true,
        isHere: true,
        descriptions: clone(source.descriptions?.normalDescription) || [],
        talents: talentsFromPortable(source.talents, chatState),
      }, { source: 'library' });
      if (result.applied !== false) {
        // 建档时改种族会清掉血脉与衍生类型，这里照角色库补回（扶她的精方档案不存这些）
        const record = chatState.sires[key];
        if (!chatState.characters?.[key] && record) {
          chatState.sires[key] = normalizeSireRecord({
            ...record,
            bloodline: source.bloodline ?? record.bloodline,
            bloodlineSource: source.bloodlineSource ?? record.bloodlineSource,
            derivedType: source.derivedType ?? record.derivedType,
          }, Number(chatState.minutesPassed) || 0);
        }
        sire = true;
      } else {
        notes.push(result.message);
      }
    }
  }
  const done = [egg ? '卵方' : '', sire ? '精方' : ''].filter(Boolean).join('与');
  return { egg, sire, message: [done ? `已带入 ${key} 的${done}。` : '', ...notes].filter(Boolean).join('；') };
}
