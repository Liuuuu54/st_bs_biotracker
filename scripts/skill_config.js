export const SKILL_MAX_LEVEL = 10;
export const TALENT_MAX_LEVEL = 5;
export const SKILL_HISTORY_LIMIT = 100;

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_EXP_INPUT = 1000000;

export const SKILL_PRESET_GROUPS = Object.freeze({
  development: Object.freeze({
    label: '部位开发',
    entries: Object.freeze([
      { name: '口腔开发', description: '口腔、舌与咽喉对相关刺激的经验与身体熟悉度。' },
      { name: '胸部开发', description: '胸部与乳首对相关刺激的经验与身体熟悉度。' },
      { name: '性器开发', description: '外阴、阴蒂与阴道对相关刺激的经验与身体熟悉度。' },
      { name: '子宫开发', description: '子宫与宫颈深处对相关刺激的经验与身体熟悉度。' },
      { name: '后庭开发', description: '后庭对相关刺激的经验与身体熟悉度。' },
      { name: '尿道开发', description: '尿道对相关刺激的经验与身体熟悉度。' },
    ]),
  }),
  behavior: Object.freeze({
    label: '行为与倾向',
    entries: Object.freeze([
      { name: '前戏', description: '爱抚、亲吻与正式性行为前的感官互动经验。' },
      { name: '侍奉', description: '以身体或行动取悦、服侍他人的经验与熟练度。' },
      { name: '自慰', description: '角色主动刺激自身以取得性快感的经验与熟练度。' },
      { name: '露出', description: '在可能被观看、发现或公开的情境中暴露身体的经验。' },
      { name: '拘束', description: '行动、姿势或身体部位受到束缚与限制的性体验。' },
      { name: 'M倾向', description: '只在明确从被支配、羞辱或疼痛中获得快感、期待或主动接受时成长；单纯遭受不算。' },
      { name: 'S倾向', description: '只在明确享受支配、羞辱或施加疼痛，并表现出偏好或主动追求时成长。' },
      { name: '情趣玩具', description: '在性刺激或调教中使用情趣玩具的经验与熟练度。' },
      { name: '多人行为', description: '同一情境中有三人或以上参与的性互动经验。' },
    ]),
  }),
});

function cleanText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : '';
}

function clampInteger(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeLookupText(value) {
  return cleanText(value, MAX_NAME_LENGTH).replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function requiredExp(level) {
  const safeLevel = clampInteger(level, 1, SKILL_MAX_LEVEL, 1);
  return 100 * safeLevel * safeLevel;
}

export function normalizeSkillDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = clampInteger(value.id, 1, Number.MAX_SAFE_INTEGER, 0);
  const name = cleanText(value.name, MAX_NAME_LENGTH);
  const description = cleanText(value.description, MAX_DESCRIPTION_LENGTH);
  if (!id || !name || !description) return null;
  return { id, name, description };
}

export function normalizeSkillCatalog(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    const definition = normalizeSkillDefinition(entry);
    if (!definition) continue;
    const sameId = result.find((item) => item.id === definition.id);
    const sameName = result.find((item) => normalizeLookupText(item.name) === normalizeLookupText(definition.name));
    if (sameId || sameName) continue;
    result.push(definition);
  }
  return result.sort((left, right) => left.id - right.id);
}

export function resolveSkillDefinition(catalogValue, reference) {
  const catalog = normalizeSkillCatalog(catalogValue);
  const numeric = Number(reference);
  if (Number.isInteger(numeric) && numeric > 0) {
    const byId = catalog.find((item) => item.id === numeric);
    if (byId) return byId;
  }
  const lookup = normalizeLookupText(reference);
  if (!lookup) return null;
  return catalog.find((item) => normalizeLookupText(item.name) === lookup) || null;
}

export function normalizeNextSkillId(catalogValue, value) {
  const minimum = normalizeSkillCatalog(catalogValue).reduce((max, item) => Math.max(max, item.id), 0) + 1;
  return Math.max(minimum, clampInteger(value, 1, Number.MAX_SAFE_INTEGER, minimum));
}

export function registerSkillDefinition(catalogValue, input = {}, nextSkillIdValue = undefined) {
  const catalog = normalizeSkillCatalog(catalogValue);
  const nextSkillId = normalizeNextSkillId(catalog, nextSkillIdValue);
  const name = cleanText(input.name, MAX_NAME_LENGTH);
  const description = cleanText(input.description, MAX_DESCRIPTION_LENGTH);
  if (!name) return { ok: false, catalog, nextSkillId, message: '技能名称不能为空。' };
  if (!description) return { ok: false, catalog, nextSkillId, message: '新增技能时必须填写定义描述。' };
  const existing = resolveSkillDefinition(catalog, name);
  if (existing) return { ok: true, catalog, nextSkillId, definition: existing, created: false };
  const definition = { id: nextSkillId, name, description };
  catalog.push(definition);
  return { ok: true, catalog, nextSkillId: nextSkillId + 1, definition, created: true };
}

export function updateSkillDefinition(catalogValue, reference, input = {}) {
  const catalog = normalizeSkillCatalog(catalogValue);
  const definition = resolveSkillDefinition(catalog, reference);
  if (!definition) return { ok: false, catalog, message: '找不到要修改的技能定义。' };
  const name = cleanText(input.name, MAX_NAME_LENGTH);
  const description = cleanText(input.description, MAX_DESCRIPTION_LENGTH);
  if (!name) return { ok: false, catalog, message: '技能名称不能为空。' };
  if (!description) return { ok: false, catalog, message: '技能描述 Prompt 不能为空。' };
  const duplicate = catalog.find((item) => item.id !== definition.id && normalizeLookupText(item.name) === normalizeLookupText(name));
  if (duplicate) return { ok: false, catalog, message: `技能名称「${name}」已存在。` };
  const updated = { id: definition.id, name, description };
  return {
    ok: true,
    catalog: catalog.map((item) => item.id === definition.id ? updated : item),
    definition: updated,
    message: `已更新技能定义「${name}」。`,
  };
}

export function importSkillPresetGroup(catalogValue, nextSkillIdValue, groupKey) {
  const preset = SKILL_PRESET_GROUPS[groupKey];
  let catalog = normalizeSkillCatalog(catalogValue);
  let nextSkillId = normalizeNextSkillId(catalog, nextSkillIdValue);
  let created = 0;
  if (!preset) return { catalog, nextSkillId, created };
  for (const entry of preset.entries) {
    const result = registerSkillDefinition(catalog, entry, nextSkillId);
    catalog = result.catalog;
    nextSkillId = result.nextSkillId;
    if (result.created) created += 1;
  }
  return { catalog, nextSkillId, created };
}

export function removeSkillDefinition(catalogValue, reference) {
  const catalog = normalizeSkillCatalog(catalogValue);
  const definition = resolveSkillDefinition(catalog, reference);
  if (!definition) return { ok: false, catalog, message: '找不到要删除的技能定义。' };
  return {
    ok: true,
    catalog: catalog.filter((item) => item.id !== definition.id),
    definition,
    message: `已删除技能定义「${definition.name}」。`,
  };
}

export function normalizeSkillHistory(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const skillId = clampInteger(entry.skillId, 1, Number.MAX_SAFE_INTEGER, 0);
    const fromLevel = clampInteger(entry.fromLevel, 0, SKILL_MAX_LEVEL, 0);
    const toLevel = clampInteger(entry.toLevel, 1, SKILL_MAX_LEVEL, 1);
    const reason = cleanText(entry.reason, MAX_DESCRIPTION_LENGTH);
    const source = entry.source === 'manual' ? 'manual' : 'story';
    const timestamp = clampInteger(entry.timestamp, 0, Number.MAX_SAFE_INTEGER, 0);
    if (!skillId || toLevel <= fromLevel || !reason) continue;
    result.push({ skillId, fromLevel, toLevel, reason, source, timestamp });
  }
  return result.slice(-SKILL_HISTORY_LIMIT);
}

export function appendSkillHistory(value, event) {
  return normalizeSkillHistory([...normalizeSkillHistory(value), event]);
}

export function normalizeSkillEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const skillId = clampInteger(value.skillId ?? value.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!skillId) return null;
  let level = clampInteger(value.level, 1, SKILL_MAX_LEVEL, 1);
  let exp = clampInteger(value.exp, 0, MAX_EXP_INPUT, 0);
  while (level < SKILL_MAX_LEVEL && exp >= requiredExp(level)) {
    exp -= requiredExp(level);
    level += 1;
  }
  if (level >= SKILL_MAX_LEVEL) exp = 0;
  return { skillId, level, exp };
}

export function normalizeSkillList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    const skill = normalizeSkillEntry(entry);
    if (!skill) continue;
    const duplicate = result.find((item) => item.skillId === skill.skillId);
    if (!duplicate) result.push(skill);
    else if (skill.level > duplicate.level || (skill.level === duplicate.level && skill.exp > duplicate.exp)) {
      Object.assign(duplicate, skill);
    }
  }
  return result;
}

export function addSkillExperience(value, amount) {
  const skill = normalizeSkillEntry(value);
  if (!skill) return null;
  let gain = clampInteger(amount, 0, MAX_EXP_INPUT, 0);
  while (skill.level < SKILL_MAX_LEVEL && gain > 0) {
    const need = requiredExp(skill.level) - skill.exp;
    if (gain < need) {
      skill.exp += gain;
      gain = 0;
    } else {
      gain -= need;
      skill.level += 1;
      skill.exp = 0;
    }
  }
  if (skill.level >= SKILL_MAX_LEVEL) skill.exp = 0;
  return skill;
}

// 天赋以一条可跨越 0 的有符号进度轴运算：负侧为苦手，正侧为擅长。
// Lv0 → ±Lv1 固定需要 100；之后沿用 requiredExp(当前绝对等级)。
export function talentLevelThreshold(level) {
  const target = clampInteger(level, 0, TALENT_MAX_LEVEL, 0);
  if (target <= 0) return 0;
  let total = 100;
  for (let current = 1; current < target; current += 1) total += requiredExp(current);
  return total;
}

export function talentStateToPoints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  if (Number.isFinite(Number(value.points))) {
    const cap = talentLevelThreshold(TALENT_MAX_LEVEL);
    return clampInteger(value.points, -cap, cap, 0);
  }
  const level = clampInteger(value.level, -TALENT_MAX_LEVEL, TALENT_MAX_LEVEL, 0);
  let exp = clampInteger(value.exp, -MAX_EXP_INPUT, MAX_EXP_INPUT, 0);
  if (level > 0) exp = Math.abs(exp);
  if (level < 0) exp = -Math.abs(exp);
  const sign = level === 0 ? Math.sign(exp) : Math.sign(level);
  if (sign === 0) return 0;
  const magnitude = talentLevelThreshold(Math.abs(level)) + Math.abs(exp);
  const cap = talentLevelThreshold(TALENT_MAX_LEVEL);
  return sign * Math.min(cap, magnitude);
}

export function talentPointsToState(skillIdValue, pointsValue) {
  const skillId = clampInteger(skillIdValue, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!skillId) return null;
  const cap = talentLevelThreshold(TALENT_MAX_LEVEL);
  const points = clampInteger(pointsValue, -cap, cap, 0);
  const sign = Math.sign(points);
  const magnitude = Math.abs(points);
  let absoluteLevel = 0;
  for (let level = 1; level <= TALENT_MAX_LEVEL; level += 1) {
    if (magnitude < talentLevelThreshold(level)) break;
    absoluteLevel = level;
  }
  const level = absoluteLevel === 0 ? 0 : sign * absoluteLevel;
  const expMagnitude = absoluteLevel >= TALENT_MAX_LEVEL ? 0 : magnitude - talentLevelThreshold(absoluteLevel);
  return {
    skillId,
    level,
    exp: expMagnitude === 0 ? 0 : sign * expMagnitude,
  };
}

export function normalizeTalentEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const skillId = clampInteger(value.skillId ?? value.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!skillId) return null;
  return talentPointsToState(skillId, talentStateToPoints(value));
}

export function normalizeTalentList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    const talent = normalizeTalentEntry(entry);
    if (!talent) continue;
    const duplicate = result.find((item) => item.skillId === talent.skillId);
    if (!duplicate) result.push(talent);
    else if (Math.abs(talentStateToPoints(talent)) > Math.abs(talentStateToPoints(duplicate))) Object.assign(duplicate, talent);
  }
  return result;
}

export function addTalentExperience(value, amount) {
  const talent = normalizeTalentEntry(value);
  if (!talent) return null;
  const delta = clampInteger(amount, -MAX_EXP_INPUT, MAX_EXP_INPUT, 0);
  return talentPointsToState(talent.skillId, talentStateToPoints(talent) + delta);
}

export function getTalentLabel(value) {
  const talent = normalizeTalentEntry(value);
  if (!talent || talent.level === 0) return '尚未形成';
  return talent.level > 0 ? `擅长 Lv${talent.level}` : `苦手 Lv${Math.abs(talent.level)}`;
}
