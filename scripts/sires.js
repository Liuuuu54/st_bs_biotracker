// 精方档案：可长期追踪的精液提供者（男主、{{user}}、转正的路人）。一次性对象不建档，
// 只存在精液纪录与胎儿／孩子的父方快照里；建档后 bsAddSperm 以名字命中时由档案带入种族、衍生类型与体型。
//
// 同名同时是已注册卵方（扶她）时，种族、血统、衍生类型、年龄、体型、在场一律读卵方，
// 精方档案只留精方专属栏位（精子品质）；描述也放在卵方那份。
import { descriptionListToObject, getStaleDescriptionFields, normalizeDescriptionList, parseDescriptionGuideFields } from './descriptions.js';
import { clampIndividualBodySize } from './body_size.js';
import { getBloodlineInfo, parseRaceDescriptor } from './race_config.js';
import { getTalentLabel, normalizeTalentList, resolveSkillDefinition } from './skill_config.js';

export const SIRE_SOURCES = Object.freeze(['manual', 'card', 'father']);
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
 * 精子品质给模型看的分级描述，顺带影射雄风；只影射，体型契合仍看体型。一般（0.5–1.5）不写。
 */
export function describeSpermQuality(value) {
  const quality = normalizeSpermQuality(value);
  if (quality < 0.5) return '精水稀薄，阳物平平';
  if (quality < 1.5) return '';
  if (quality < 3) return '精力旺盛，阳物粗壮';
  return '精力极旺，阳物雄伟，一次就能灌满';
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
  return {
    race,
    bloodline: ancestry.bloodline,
    bloodlineSource: ancestry.bloodlineSource,
    derivedType: value.derivedType ? String(value.derivedType).trim() || null : (parsed.derivedType || null),
    age: Number.isFinite(age) && age > 0 ? age : null,
    bodySize: clampIndividualBodySize(value.bodySize),
    isHere: value.isHere !== false,
    descriptions: {
      normalDescription: normalizeDescriptionList(value.descriptions?.normalDescription, minutesPassed),
    },
    source: SIRE_SOURCES.includes(value.source) ? value.source : 'manual',
    spermQuality: normalizeSpermQuality(value.spermQuality),
    // 精方只有天赋（资质），没有技能：技能要靠追踪锻炼，精方不追踪
    talents: normalizeTalentList(value.talents),
    createdAt: Math.max(0, Number(value.createdAt) || 0),
  };
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
  chatState.sires[key] = normalizeSireRecord({ spermQuality: sire.spermQuality, source: sire.source, createdAt: sire.createdAt });
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
    const virility = describeSpermQuality(record.spermQuality);
    const summary = {
      name,
      race: formatSireRace(record),
      ...(record.age ? { age: record.age } : {}),
      ...(record.bodySize ? { bodySize: record.bodySize } : {}),
      ...(virility ? { virility } : {}),
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
  }, now);
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
