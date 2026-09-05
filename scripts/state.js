import { DEFAULT_DIARY_WRITING_PROMPT, DEFAULT_REGISTRY_DESCRIPTION_GUIDES } from './registry_config.js';
import {
  buildEmptyPsychologyGroup,
  normalizePsychologyGroup,
  normalizePsychologyStageProfiles,
  PSY_MENS_FIELDS,
  PSY_MENS_BOOL_FIELDS,
  PSY_PREG_FIELDS,
  PSY_PREG_BOOL_FIELDS,
} from './registry_psy_config.js';
import { LABOR_STAGES, MENSTRUAL_STAGES, MENSTRUAL_STAGE_DAYS, PREGNANCY_STAGE_DAYS, PREGNANCY_STAGES } from './stage_config.js';
import { normalizeNextSkillId, normalizeSkillCatalog, normalizeSkillHistory, normalizeSkillList, normalizeTalentList } from './skill_config.js';
import {
  createDefaultWardrobeItem,
  normalizeTemporaryOutfitItems,
  normalizeWardrobeItem,
  normalizeWardrobeItemId,
  sanitizeWearState,
} from './wardrobe_config.js';
import {
  canLoadHostWorldInfo,
  getHostChat,
  getHostChatId,
  getHostCharacters,
  getHostContext,
  getHostExtensionSettings,
  getHostKind,
  getHostWorldBook,
  hasAbsoluteHostChatView,
  loadHostWorldInfo,
  loadHostChatState,
  resolveHostChatId,
  saveHostSettings,
  scheduleHostChatStateSave,
} from './host.js';

export const MODULE_NAME = 'bs_biotracker';
const MAX_CHAT_STATE_SNAPSHOTS = 24;
const MAX_RAW_RESULT_TEXT_LENGTH = 600;
const MAX_SNAPSHOT_DEBUG_ITEMS = 24;
const MIN_CHAT_INHERIT_MESSAGE_COUNT = 2;
const MESSAGE_DIGEST_SEED = 2166136261;
const SNAPSHOT_FULL_INTERVAL = 8;
const SNAPSHOT_PATCH_SIZE_RATIO = 0.85;
const SNAPSHOT_DELETE_SENTINEL_KEY = '__bs_bt_deleted__';
const SNAPSHOT_ARRAY_APPEND_KEY = '__bs_bt_array_append__';
const RESTORED_SNAPSHOT_RUNTIME_KEY = Symbol('bsBtRestoredSnapshotKey');
let worldInfoModulePromise = null;

export const THEME_CONFIG = {
  retro: {},
  cultivation: {},
  fantasy: {},
  'cyber-egypt': {},
  wasteland: {},
  sakura: {},
  holo: {},
  gothic: {},
  steampunk: {},
  eldritch: {},
  ink: {},
  constructivism: {},
  iphone: {},
};

export const DEFAULT_WARDROBE_PREP_PROMPT = [
  '请根据角色卡、世界书、最近对话、已注册状态与当前服装描述，为指定角色准备衣柜 JSON。',
  '默认生成 3 件 main 主件、3 件 accessory 配件；若用户在本提示中指定数量、风格、场景或禁忌，请优先遵守。',
  '主件应覆盖角色常用日常服、较正式/外出服、睡衣或居家服等；配件可包含外套、托腹带、鞋履、披肩、制服配件、贴身内衣等。',
  'note 只写衣物稳定外观与来源：颜色、材质、版型、长短、固定开口、图案、制服/病服/借装来源等。皮肤暴露、开衩、透肤、深领等稳定外观写在 note。禁止写当前穿着反应、角色感受、近期身体变化、怀孕/胀痛/压胸/勒红/变紧/显怀等动态状态；这些由四维、pregFit 与当轮叙事推导。',
  '每件衣物字段必须为 id/name/note/slot/masking/support/capacity/convenience；主件可附 parts 数组列出组成部件名（如 ["白衬衫","牛仔裤"]，连身装可省略）；配件可附 layer（inner=贴身内衣等穿在主件之下，outer=外搭，默认 outer），通常应生成 1-2 件 layer=inner 的贴身衣物配件。',
  '可独立穿脱的外层（毛衣、开衫、外套、罩衫、披肩等）不要并入 main 或写进 parts，应拆成 layer=outer 的配件；main 只保留脱掉外层后仍成立的基础层。',
  'slot 只能是 main 或 accessory；main 是主件，只能穿一件；accessory 可叠加，但只是补正。',
  '四维均为 -10 到 10；主件通常使用 0 到 10。配件单项只能 -3 到 3，通常只影响 1-2 个维度，其他维度必须填 0。旧的 contour/unsupported 若出现在资料中，会被视为 masking/support 的反向旧字段。',
  'masking=掩盖身体曲线、孕肚、胸腹变化的程度；support=对胸、腹、腰、重心的承托程度，高表示托得住但可能偏束，低表示松散；capacity=容许体型变化的程度；convenience=行动、穿脱、如厕、哺乳或排解需求的方便程度。',
  'id 必须使用整数；0 是系统保留默认主件，表示全裸，不要放入 wardrobe.items。长期衣柜 id 从 1 开始递增。',
  'outfit.mainItemId 请选择一件最符合当前叙事/注册描述的主件；outfit.accessoryItemIds 选择当前已穿戴配件，未知则空数组。',
  'temporaryItems 只用于病服、借装、旅馆睡衣等临时衣物；备装长期衣柜时通常输出空数组。',
].join('\n');


export const DEFAULT_SYSTEM_PROMPT = [
  '你是 AIRP 角色生理状态追踪器的工具调度器。',
  '工具参数中的 female 指「孕育者」——被追踪的承载方，不限定性别；扶她、孕夫、雄性孕育系（如海龙人）同样使用该字段。',
  '你要根据角色卡、最近对话、已有状态，决定这次应调用哪些工具更新状态。',
  '只输出 JSON，不要输出额外解释。',
  'JSON 结构必须是：',
  '{',
  '  "tool_calls": [',
  '    {',
  '      "name": "string",',
  '      "arguments": {}',
  '    }',
  '  ],',
  '  "character_checks": [',
  '    { "female": "string", "status": "no_change|updated|present|offscreen" }',
  '  ]',
  '}',
  'character_checks 是逐角色检查清单：必须对 tracked_females 中每名角色恰好输出一笔；只写本轮检查结论，不直接改变状态。真正更新仍必须用 tool_calls。',
  '可用工具会通过 available_tools 传入。只能调用其中存在的工具，参数名必须完全匹配。',
  '没有足够依据时，tool_calls 返回空数组。',
  '如果对话明确发生了时间流逝，优先调用 bsPassedTime。',
  '如果只是活力、情压、性欲、宫压波动，使用 bsUpdateCharacterStatus。',
  '如果只是心理数值变化，使用 bsUpdatePsychology；其数值参数一律表示变化量(delta)而不是目标值，例如当前为 78 时传 2 会变成 80。应优先做单一心理项的小幅调整，单次建议只动一个字段，幅度尽量控制在 ±1 到 ±3，±5 已属于偏大变化。每名角色在每个新小时内仅允许一次成功的 bsUpdatePsychology 变化，重复调用会被跳过。如果只是经验或关系记录变化，使用 bsUpdateExperience。',
  '如果只是描述文字变化，使用 bsSetDescription。',
  '剧情中出现穿上、脱下、更衣、借穿、被脱除、淋湿更换、洗浴后重新着装等衣着变化时，必须用 bsChangeOutfit 同步当前穿着；只更新衣着描述文字而不换装是错误的。角色获得新长期衣物用 bsAddWardrobeItem，永久失去衣物用 bsRemoveWardrobeItem。',
  '性交留精用 bsAddSperm；排出残留精液用 bsDrainSperm；缓解生理需求用 bsExcreteMetabolism。',
  '跨日、重大事件或 notify 提醒时，可用 bsWriteDiary 为角色追加主观日记。',
  '月经阶段、排卵期、假孕期切换用 bsSetMenstrualPhases；不要用它覆盖正在进行的受精、真妊娠或产程。',
  '流产用 bsAbortion；立即结束分娩用 bsChildbirth；角色在场状态变化用 bsSetCharacterPresence，参数必须为 female 和 isPresent（布尔值 true/false，不要使用 isHere）。角色明确回到当前场景、重新同行或参与当前互动时应设为 true；明确离开、失联或转为幕外时才设为 false。',
  '母胎互动用 bsMaternalFetalInteraction；每名角色在每个新小时内仅允许一次成功的母胎互动变化，重复调用会被跳过。direction=fetal 时须传 change，表示胎儿对母体的亲近或排斥并改变 affinity，不补充营养。direction=maternal 时不传 change，表示母体安抚胎儿，系统随机判定 affinity 变化；若成功且有待安抚不适，小幅变化补回 1 点营养，大幅变化补回 2 点营养。若处于产兆前驱则表示分娩抵抗。',
  '不要编造怀孕天数、胎数、流产、分娩或其他高影响事件。',
].join('\n');

export const API_FORMATS = Object.freeze({
  OPENAI_COMPAT: 'openai_compat',
  CLAUDE_MESSAGES: 'claude_messages',
  OPENAI_RESPONSES: 'openai_responses',
  GEMINI_INTERACTIONS: 'gemini_interactions',
});

export function normalizeApiFormat(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === API_FORMATS.OPENAI_RESPONSES || raw === 'responses' || raw === 'openai_responses' || raw === 'custom_openai_responses') return API_FORMATS.OPENAI_RESPONSES;
  if (raw === API_FORMATS.CLAUDE_MESSAGES || raw === 'claude' || raw === 'messages' || raw === 'claude_messages' || raw === 'custom_claude_messages' || raw === 'anthropic') return API_FORMATS.CLAUDE_MESSAGES;
  if (raw === API_FORMATS.GEMINI_INTERACTIONS || raw === 'gemini' || raw === 'interactions' || raw === 'gemini_interactions') return API_FORMATS.GEMINI_INTERACTIONS;
  return API_FORMATS.OPENAI_COMPAT;
}

export function getApiEndpointSuffix(format) {
  switch (normalizeApiFormat(format)) {
    case API_FORMATS.OPENAI_RESPONSES: return '/responses';
    case API_FORMATS.CLAUDE_MESSAGES: return '/messages';
    case API_FORMATS.GEMINI_INTERACTIONS: return '/interactions';
    case API_FORMATS.OPENAI_COMPAT:
    default: return '/chat/completions';
  }
}

export function getApiUrlForFormat(apiBase, format) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  const fmt = normalizeApiFormat(format);
  // Google AI 原生端点必须带 API 版本；base 已以 /v1 或 /v1beta 结尾时直接拼接（与 TauriTavern build_gemini_url 一致）
  if (fmt === API_FORMATS.GEMINI_INTERACTIONS && !/\/(v1|v1beta)$/i.test(base)) {
    return `${base}/v1beta/interactions`;
  }
  return `${base}${getApiEndpointSuffix(fmt)}`;
}

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'retro',
  deviceSize: 'phone',
  fontSize: 'standard',
  // 只有 iphone 主题会读这三项：其余 12 套是固定美术风格，配色是主题本身的一部分
  iphoneBase: 'light',
  iphoneAccent: '#0a84ff',
  iphoneCase: '#c8c2b8',
  iphoneFont: 'system',
  enabled: false,
  useStPresetForAsync: false,
  trackerPresetName: '',
  trackerPromptToggles: {},
  trackerPromptToggleOverrides: {},
  apiUrl: '',
  apiFormat: API_FORMATS.OPENAI_COMPAT,
  apiKey: '',
  model: 'gpt-4.1-mini',
  modelOptions: [],
  formattedOutputV4: true,
  mvuExtraAnalysisCompat: true,
  raceCatalogInPrompt: true,
  triggerTiming: 'after_ai',
  pollMs: 1800,
  apiTimeoutMs: 180000,
  contextSize: 12,
  trackerTokenBudget: 4096,
  requireFullDescriptionUpdates: false,
  lukerMultiAgentManualOnly: true,
  diaryRecentLimit: 5,
  diaryWritingPrompt: DEFAULT_DIARY_WRITING_PROMPT,
  wardrobePrepPrompt: '',
  wardrobePrepMainCount: 3,
  wardrobePrepAccessoryCount: 3,
  targetNames: '',
  trackerWorldbookMode: 'exclude',
  trackerWorldbookExcludeNames: '',
  trackerWorldbookIncludeNames: '',
  trackerGlobalWorldbookExcludeNames: '',
  trackerGlobalWorldbookIncludeNames: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  registryCustomNotes: '',
  registrySkillPrompt: '',
  registryDescriptionGuides: DEFAULT_REGISTRY_DESCRIPTION_GUIDES,
  racePhysiologyOverrides: {},
  derivedTypeOverrides: {},
  chatStates: {},
});

const VITALITY_CAPS = Object.freeze({
  1: 50,
  2: 75,
  3: 100,
  4: 125,
  5: 150,
  6: 175,
  7: 200,
});

const PSY_STRESS_CAPS = Object.freeze({
  1: 20,
  2: 50,
  3: 80,
  4: 110,
  5: 140,
  6: 170,
  7: 200,
});

function clampLevel(value, fallback = 4) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(1, Math.min(7, Math.round(next)));
}

function sanitizeNumber(value, { min = -999999, max = 999999 } = {}) {
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.max(min, Math.min(max, next));
}

function pickFirstString(obj, paths) {
  for (const path of paths) {
    const keys = String(path || '').split('.');
    let current = obj;
    for (const key of keys) {
      if (!current || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = current[key];
    }
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return '';
}

function normalizePsychologyState(value) {
  const stageProfiles = normalizePsychologyStageProfiles(value?.stageProfiles);
  return {
    mens: normalizePsychologyGroup(value?.mens, PSY_MENS_FIELDS, { booleanFields: PSY_MENS_BOOL_FIELDS, stageProfiles: stageProfiles.mens }),
    preg: normalizePsychologyGroup(value?.preg, PSY_PREG_FIELDS, { booleanFields: PSY_PREG_BOOL_FIELDS, stageProfiles: stageProfiles.preg }),
    stageProfiles,
  };
}

function normalizeWardrobeState(value) {
  const items = [];
  for (const source of (Array.isArray(value?.items) ? value.items : [])) {
    const item = normalizeWardrobeItem(source);
    if (!item || items.some((existing) => existing.id === item.id)) continue;
    items.push(item);
  }
  if (!items.some((item) => item.id === 0)) items.unshift(createDefaultWardrobeItem());
  return { enabled: Boolean(value?.enabled), items };
}

function normalizePregFitState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalizeGap = (gapValue) => {
    const next = Number(gapValue);
    if (!Number.isFinite(next)) return 0;
    return Math.max(-20, Math.min(20, next));
  };
  const gapSource = value.gap && typeof value.gap === 'object' ? value.gap : {};
  return {
    pregWearPressure: Math.max(0, Math.min(10, Number(value.pregWearPressure) || 0)),
    gap: {
      masking: normalizeGap(gapSource.masking ?? gapSource.covering),
      support: normalizeGap(gapSource.support),
      capacity: normalizeGap(gapSource.capacity),
      convenience: normalizeGap(gapSource.convenience),
    },
  };
}

function normalizeOutfitState(value, wardrobe) {
  const wardrobeItems = Array.isArray(wardrobe?.items) ? wardrobe.items : [];
  const temporaryItems = normalizeTemporaryOutfitItems(value?.temporaryItems);
  const availableItems = [...wardrobeItems, ...temporaryItems];
  const hasItem = (id, slot = '') => availableItems.some((item) => item.id === id && (!slot || item.slot === slot));
  const requestedMainId = normalizeWardrobeItemId(value?.mainItemId, 0);
  const mainItemId = hasItem(requestedMainId, 'main') ? requestedMainId : 0;
  const accessoryItemIds = Array.isArray(value?.accessoryItemIds)
    ? value.accessoryItemIds
      .map((item) => normalizeWardrobeItemId(item))
      .filter((id, index, list) => id !== null && list.indexOf(id) === index && hasItem(id, 'accessory'))
    : [];
  return {
    mainItemId,
    accessoryItemIds,
    temporaryItems,
    wearState: sanitizeWearState(value?.wearState),
    pregFit: normalizePregFitState(value?.pregFit),
  };
}

// v0.8.5 起衣着状态由 outfit.wearState 与 currentWearText 承担；
// 旧版备装写入的两个描述子字段会与机械穿着脱节，载入时一次性剥离。
const REMOVED_OUTFIT_DESCRIPTION_FIELD_NAMES = new Set([
  '衣着动态', '衣着動態', '衣著动态', '衣著動態',
  '衣着自评', '衣著自評', '衣着自評', '衣著自评', '服装自评', '服裝自評',
]);

function stripRemovedOutfitDescriptionFields(text) {
  const source = String(text || '');
  if (!source.includes('|')) return source;
  const entries = source.split(';;').filter((entry) => entry.trim());
  const kept = entries.filter((entry) => {
    const separatorIndex = entry.indexOf('|');
    const name = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : '';
    return !REMOVED_OUTFIT_DESCRIPTION_FIELD_NAMES.has(name);
  });
  if (kept.length === entries.length) return source;
  return kept.length > 0 ? `${kept.join(';;')};;` : '';
}

export function normalizeCharacterPsychologyState(characterState) {
  if (!characterState || typeof characterState !== 'object') return characterState;
  if (!characterState.profile || typeof characterState.profile !== 'object') return characterState;
  characterState.profile.psychology = normalizePsychologyState(characterState.profile.psychology);
  characterState.profile.skills = normalizeSkillList(characterState.profile.skills);
  characterState.profile.talents = normalizeTalentList(characterState.profile.talents);
  characterState.profile.skillHistory = normalizeSkillHistory(characterState.profile.skillHistory);
  if (characterState.profile.childSource && typeof characterState.profile.childSource === 'object' && !Array.isArray(characterState.profile.childSource)) {
    const motherName = String(characterState.profile.childSource.motherName || '').trim();
    const childIndex = Number(characterState.profile.childSource.childIndex);
    if (motherName && Number.isInteger(childIndex) && childIndex >= 0) {
      const normalizedChildSource = {
        motherName,
        childIndex,
      };
      if (Array.isArray(characterState.profile.childSource.inheritedTalents)) {
        normalizedChildSource.inheritedTalents = normalizeTalentList(characterState.profile.childSource.inheritedTalents);
      }
      characterState.profile.childSource = normalizedChildSource;
    } else {
      delete characterState.profile.childSource;
    }
  }
  if (Array.isArray(characterState.profile.children)) {
    characterState.profile.children = characterState.profile.children.map((child) => {
      const next = { ...child, talents: normalizeTalentList(child?.talents ?? child?.inheritedTalents) };
      delete next.inheritedTalents;
      return next;
    });
  }
  if (Array.isArray(characterState.profile.pregnant?.fetuses)) {
    characterState.profile.pregnant.fetuses = characterState.profile.pregnant.fetuses.map((fetus) => {
      const next = { ...fetus, talents: normalizeTalentList(fetus?.talents ?? fetus?.inheritedTalents) };
      delete next.inheritedTalents;
      return next;
    });
  }
  if (characterState.profile.wardrobe?.enabled) {
    characterState.profile.wardrobe = normalizeWardrobeState(characterState.profile.wardrobe);
    characterState.profile.outfit = normalizeOutfitState(characterState.profile.outfit, characterState.profile.wardrobe);
  } else {
    delete characterState.profile.wardrobe;
    delete characterState.profile.outfit;
  }
  const descriptions = characterState.profile.descriptions;
  if (descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)) {
    for (const key of ['normalDescription', 'pregnantDescription']) {
      if (typeof descriptions[key] === 'string' && descriptions[key]) {
        descriptions[key] = stripRemovedOutfitDescriptionFields(descriptions[key]);
      }
    }
  }
  const metabolism = characterState.profile.metabolism;
  if (metabolism && typeof metabolism === 'object' && !Array.isArray(metabolism)) {
    if (metabolism.excretion === undefined && (metabolism.urine !== undefined || metabolism.stool !== undefined)) {
      metabolism.excretion = sanitizeNumber((Number(metabolism.urine) || 0) + (Number(metabolism.stool) || 0), { min: 0, max: 150 }) ?? 0;
    }
    if (metabolism.companionship === undefined) metabolism.companionship = 0;
    delete metabolism.urine;
    delete metabolism.stool;
  }
  const pregnant = characterState.profile.pregnant;
  if (pregnant && pregnant.acceleration === undefined) {
    pregnant.acceleration = null;
  }
  if (pregnant && pregnant.expansion === undefined) {
    pregnant.expansion = null;
  }
  if (pregnant && pregnant.symptomReliefPending === undefined) {
    pregnant.symptomReliefPending = characterState.profile.cooldown?.pregnancySymptomActive ? 1 : 0;
  }
  if (pregnant?.blockage?.key === 'stool') pregnant.blockage.key = 'excretion';
  if (pregnant?.blockage?.key === 'urine') {
    if (!pregnant.acceleration) {
      pregnant.acceleration = { ...pregnant.blockage, key: 'excretion' };
    }
    pregnant.blockage = null;
  }
  if (
    pregnant?.blockage?.key
    && pregnant.blockage.key === pregnant.acceleration?.key
  ) {
    pregnant.acceleration = null;
  }
  if (
    pregnant?.expansion?.key
    && (pregnant.expansion.key === pregnant.blockage?.key || pregnant.expansion.key === pregnant.acceleration?.key)
  ) {
    pregnant.expansion = null;
  }
  if (metabolism && typeof metabolism === 'object' && !Array.isArray(metabolism)) {
    const expansionKey = String(pregnant?.expansion?.key || '');
    for (const key of ['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship']) {
      if (metabolism[key] === undefined) continue;
      metabolism[key] = sanitizeNumber(metabolism[key], { min: 0, max: expansionKey === key ? 200 : 150 }) ?? 0;
    }
    if (metabolism.flux !== undefined) {
      const flux = Number(metabolism.flux) || 0;
      const expandedFlux = (flux > 0 && expansionKey === 'fluxPositive') || (flux < 0 && expansionKey === 'fluxNegative');
      metabolism.flux = sanitizeNumber(flux, { min: expandedFlux ? -200 : -150, max: expandedFlux ? 200 : 150 }) ?? 0;
    }
  }
  if (characterState.profile.cooldown && typeof characterState.profile.cooldown === 'object') {
    delete characterState.profile.cooldown.laborResistanceUsed;
    delete characterState.profile.cooldown.pregnancySymptomActive;
  }
  return characterState;
}

export function getVitalityInitByLevel(level) {
  return VITALITY_CAPS[clampLevel(level)] || VITALITY_CAPS[4];
}

export function getPsyStressInitByLevel(level) {
  return Math.floor((PSY_STRESS_CAPS[clampLevel(level)] || PSY_STRESS_CAPS[4]) / 2);
}

function randomInt(min, max) {
  const nextMin = Math.ceil(min);
  const nextMax = Math.floor(max);
  return Math.floor(Math.random() * (nextMax - nextMin + 1)) + nextMin;
}

export function deriveMenstrualStageState() {
  const stage = MENSTRUAL_STAGES[randomInt(0, MENSTRUAL_STAGES.length - 1)];
  const days = randomInt(0, MENSTRUAL_STAGE_DAYS[stage]);
  return { stage, days };
}

export function derivePregnancyStageState(pregnantDays, gestationSpeed = 1) {
  const actualPregnantDays = Math.max(0, Number(pregnantDays) || 0);
  const speed = Math.max(0.1, Number(gestationSpeed) || 1);
  const stageNames = ['孕早期', '孕中期', '孕晚期', '临产期'];
  let totalPregnancyDays = 0;
  for (const stageName of stageNames) totalPregnancyDays += PREGNANCY_STAGE_DAYS[stageName] / speed;

  if (actualPregnantDays > totalPregnancyDays) {
    return {
      stage: '逾期',
      days: actualPregnantDays - totalPregnancyDays,
    };
  }

  let stage = '孕早期';
  let baseDays = 0;
  let currentStageDays = 0;
  for (const stageName of stageNames) {
    const stageLimit = PREGNANCY_STAGE_DAYS[stageName] / speed;
    const nextBaseDays = baseDays + stageLimit;
    if (actualPregnantDays >= baseDays && actualPregnantDays <= baseDays + stageLimit) {
      stage = stageName;
      currentStageDays = actualPregnantDays - baseDays;
      break;
    }
    baseDays = nextBaseDays;
  }
  return { stage, days: currentStageDays };
}

export function getGestationSpeciesSpeed(profile) {
  const baseSpeed = Number(profile?.bio?.gestationSpeciesSpeed);
  if (Number.isFinite(baseSpeed) && baseSpeed > 0) return Math.max(0.1, Math.min(20, baseSpeed));
  return 1;
}

export function getGestationModifierMultiplier(profile) {
  const multiplier = Number(profile?.bio?.gestationModifierMultiplier);
  if (Number.isFinite(multiplier) && multiplier >= 0) return Math.max(0, Math.min(20, multiplier));
  return 1;
}

export function getGestationEffectiveSpeed(profile) {
  const hasSpeciesSpeed = Number.isFinite(Number(profile?.bio?.gestationSpeciesSpeed));
  const hasModifierMultiplier = Number.isFinite(Number(profile?.bio?.gestationModifierMultiplier));
  if (hasSpeciesSpeed || hasModifierMultiplier) {
    return Math.max(0, Math.min(20, getGestationSpeciesSpeed(profile) * getGestationModifierMultiplier(profile)));
  }
  const effectiveSpeed = Number(profile?.bio?.gestationEffectiveSpeed);
  if (Number.isFinite(effectiveSpeed) && effectiveSpeed >= 0) return Math.max(0, Math.min(20, effectiveSpeed));
  return 1;
}

export function syncCharacterStageFromProfile(characterState) {
  const next = characterState;
  const profile = next?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const bio = profile.bio || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const currentStage = String(base.stage || '');

  if (fetuses.length > 0) {
    const pregnantDays = Math.max(0, Number(pregnant.pregnantDays) || 0);
    const effectivePregnantDays = Math.max(0, Number(pregnant.effectivePregnantDays) || 0);
    // 刚移入／刚受精时 fertilizationDays 可以正好是 0；只要产科孕日仍为 0，就尚未着床。
    if (pregnantDays <= 0 && effectivePregnantDays <= 0) {
      const fallbackStage = PREGNANCY_STAGES.includes(currentStage) ? '排卵期' : currentStage;
      next.profile.base = {
        ...base,
        stage: fallbackStage || '排卵期',
        days: Math.max(0, Number(base.days) || 0),
      };
      return next;
    }

    if (currentStage === '产兆前驱' || LABOR_STAGES.includes(currentStage)) {
      next.profile.base = {
        ...base,
        days: Math.max(0, Number(base.days) || 0),
      };
      return next;
    }

    const derived = derivePregnancyStageState(pregnant.effectivePregnantDays, 1);
    next.profile.base = {
      ...base,
      stage: derived.stage,
      days: derived.days,
    };
    return next;
  }

  if (
    MENSTRUAL_STAGES.includes(currentStage)
    || currentStage === '假孕期'
    || currentStage === '产兆前驱'
    || currentStage === '产后恢复'
    || LABOR_STAGES.includes(currentStage)
    || currentStage === '无经期'
    || currentStage === '未激活'
    // 胎内回归的过渡阶段：不列进来会掉到下面的 deriveMenstrualStageState，
    // 被重设成月经阶段，回归状态就此消失
    || currentStage === '回归期'
  ) {
    next.profile.base = {
      ...base,
      days: Math.max(0, Number(base.days) || 0),
    };
    return next;
  }

  const derived = deriveMenstrualStageState();
  next.profile.base = {
    ...base,
    stage: derived.stage,
    days: derived.days,
  };
  return next;
}

export function getContextSafe() {
  return getHostContext();
}

export function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createSnapshotDeleteSentinel() {
  return { [SNAPSHOT_DELETE_SENTINEL_KEY]: true };
}

function isSnapshotDeleteSentinel(value) {
  return isPlainObject(value) && value[SNAPSHOT_DELETE_SENTINEL_KEY] === true;
}

function createSnapshotArrayAppendPatch(previousList, nextList) {
  if (!Array.isArray(previousList) || !Array.isArray(nextList)) return null;
  if (nextList.length <= previousList.length) return null;
  for (let index = 0; index < previousList.length; index += 1) {
    if (!areSnapshotArrayItemsEqual(previousList[index], nextList[index])) return null;
  }
  return {
    [SNAPSHOT_ARRAY_APPEND_KEY]: true,
    length: previousList.length,
    items: cloneValue(nextList.slice(previousList.length)),
  };
}

function isSnapshotArrayAppendPatch(value) {
  return isPlainObject(value)
    && value[SNAPSHOT_ARRAY_APPEND_KEY] === true
    && Number.isInteger(value.length)
    && Array.isArray(value.items);
}

function applySnapshotArrayAppendPatch(previousValue, patch) {
  const base = Array.isArray(previousValue) ? cloneValue(previousValue).slice(0, Math.max(0, patch.length)) : [];
  return base.concat(cloneValue(patch.items));
}

function areSnapshotArrayItemsEqual(left, right) {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function areSnapshotArraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!areSnapshotArrayItemsEqual(left[index], right[index])) return false;
  }
  return true;
}

/**
 * 孩子记录的稳定标识。此前只能用「母亲名 + children 阵列索引」引用，
 * 改名或搬移孩子都会让引用失联（搬移时得手动修正索引）。
 * 有了 id，血缘关系图与注册来源都能靠它连线。
 */
export function createChildId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyChatState() {
  return {
    lastAttemptedSignature: '',
    lastProcessedSignature: '',
    lastFailedSignature: '',
    // 失败当下「整段对话」的签名，用来判断是否该挡下自动重试
    lastFailedChatSignature: '',
    lastRunAt: 0,
    sceneSummary: '',
    minutesPassed: 0,
    skillCatalog: [],
    nextSkillId: 1,
    // null-proto：角色名直接作键，模型吐出 constructor/toString/__proto__ 之类的名字时
    // 不会取到继承来的内建属性（那会让本该 skip 的调用变成拿函数当角色对象崩掉）
    characters: Object.create(null),
    lastRawResult: null,
    lastOperationLogs: [],
    snapshots: [],
  };
}

export function createDefaultFemaleState(name = '') {
  const vitalityLevel = 4;
  const psyStressLevel = 4;
  const character = {
    name: String(name || '').trim(),
    initialized: false,
    profile: {
      cooldown: {
        orgasmOvulationUsed: false,
        naturalOvulationUsed: false,
        pregnancyPressureWarning: false,
        psychologyUpdateUsed: false,
        maternalFetalInteractionUsed: false,
      },
      base: {
        isHere: true,
        days: 0,
        fertilizationDays: 0,
        latestSexDays: null,
        age: 15,
        stage: null,
        race: '人类',
        derivedType: null,
        sperms: [],
        eggs: 0,
        libido: 0,
        uterinePressure: 0,
        vitality: getVitalityInitByLevel(vitalityLevel),
        psyStress: getPsyStressInitByLevel(psyStressLevel),
        vitalityLevel,
        psyStressLevel,
      },
      pregnant: {
        pregnantDays: 0,
        effectivePregnantDays: 0,
        laborHours: 0,
        effectiveLaborHours: 0,
        laborPhase: null,
        laborFetusIndex: 0,
        laborPain: 0,
        prodromalOriginStage: null,
        prodromalRemainingHours: 0,
        prodromalDelayProgressHours: 0,
        fetusesCount: 0,
        fetalEnergyDrain: 0,
        amnionDurability: 0,
        nutrition: 0,
        symptomReliefPending: 0,
        blockage: null,
        acceleration: null,
        expansion: null,
        fetuses: [],
      },
      experience: {
        virginity: null,
        latestSexPartner: null,
        emotionalMate: null,
        marriageMate: null,
        pregnantExperience: 0,
        naturalBirthExperience: 0,
        surgicalBirthExperience: 0,
        miscarriageExperience: 0,
      },
      psychology: {
        mens: buildEmptyPsychologyGroup(PSY_MENS_FIELDS, PSY_MENS_BOOL_FIELDS),
        preg: buildEmptyPsychologyGroup(PSY_PREG_FIELDS, PSY_PREG_BOOL_FIELDS),
        stageProfiles: {},
      },
      children: [],
      skills: [],
      talents: [],
      skillHistory: [],
      diary: [],
      bio: {
        menstrualLengthRatio: 1.0,
        gestationSpeciesSpeed: 1.0,
        gestationEffectiveSpeed: 1.0,
        gestationModifierMultiplier: 1.0,
        gestationModifierName: '',
        gestationModifierDescription: '',
        birthDifficulty: 1.0,
        breedTolerance: 1.0,
        impregnationDifficulty: 1.0,
        orgasmOvulationAmount: 1,
        identicalProbability: 5,
        recoveryDays: 56,
      },
      metabolism: {
        excretion: 0,
        hunger: 0,
        sleep: 0,
        milk: 0,
        odor: 0,
        companionship: 0,
        flux: 0,
      },
      descriptions: {
        normalDescription: '',
        pregnantDescription: '',
      },
      notify: {
        firstly: '',
        secondly: '',
        thirdly: '',
      },
      immune: {
        metabolism: false,
        miscarriage: false,
        realisticLabor: false,
      },
    },
  };
  return syncCharacterStageFromProfile(normalizeCharacterPsychologyState(character));
}

export function getSettings(ctx) {
  const root = getHostExtensionSettings(ctx);
  if (!root) throw new Error('[BS BioTracker] host extension settings are unavailable');
  let shouldSave = false;
  if (!root[MODULE_NAME]) root[MODULE_NAME] = cloneValue(DEFAULT_SETTINGS);
  const settings = root[MODULE_NAME];
  const useHostChatStore = ['tauritavern', 'luker'].includes(getHostKind());
  if (useHostChatStore) {
    // TT/Luker 下 chatStates 与宿主 sidecar 绑定，属性描述符可能特殊（旧数据/宿主注入）。
    // 重定义失败不该拖垮整个设置读取——否则连主题切换这种纯 UI 操作都会「点了没反应」。
    try {
      const descriptor = Object.getOwnPropertyDescriptor(settings, 'chatStates');
      const runtimeChatStates = descriptor && descriptor.enumerable === false && settings.chatStates && typeof settings.chatStates === 'object'
        ? settings.chatStates
        : {};
      if (descriptor) delete settings.chatStates;
      Object.defineProperty(settings, 'chatStates', {
        value: runtimeChatStates,
        writable: true,
        configurable: true,
        enumerable: false,
      });
      if (!descriptor || descriptor.enumerable !== false) shouldSave = true;
    } catch (error) {
      console.warn('[BS BioTracker] unable to normalize chatStates for host store, continuing', error);
    }
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (useHostChatStore && key === 'chatStates') continue;
    if (settings[key] === undefined) {
      settings[key] = cloneValue(value);
      shouldSave = true;
    }
  }
  if (!settings.chatStates || typeof settings.chatStates !== 'object') {
    settings.chatStates = {};
    shouldSave = true;
  }
  if (!Array.isArray(settings.modelOptions)) {
    settings.modelOptions = [];
    shouldSave = true;
  }
  if (!String(settings.diaryWritingPrompt || '').trim()) {
    settings.diaryWritingPrompt = DEFAULT_DIARY_WRITING_PROMPT;
    shouldSave = true;
  }
  const rawWardrobePrepMainCount = Number(settings.wardrobePrepMainCount);
  const wardrobePrepMainCount = Math.max(1, Math.min(12, Math.floor(Number.isFinite(rawWardrobePrepMainCount) ? rawWardrobePrepMainCount : DEFAULT_SETTINGS.wardrobePrepMainCount)));
  if (settings.wardrobePrepMainCount !== wardrobePrepMainCount) {
    settings.wardrobePrepMainCount = wardrobePrepMainCount;
    shouldSave = true;
  }
  const rawWardrobePrepAccessoryCount = Number(settings.wardrobePrepAccessoryCount);
  const wardrobePrepAccessoryCount = Math.max(0, Math.min(12, Math.floor(Number.isFinite(rawWardrobePrepAccessoryCount) ? rawWardrobePrepAccessoryCount : DEFAULT_SETTINGS.wardrobePrepAccessoryCount)));
  if (settings.wardrobePrepAccessoryCount !== wardrobePrepAccessoryCount) {
    settings.wardrobePrepAccessoryCount = wardrobePrepAccessoryCount;
    shouldSave = true;
  }
  const rawDiaryRecentLimit = Number(settings.diaryRecentLimit);
  const diaryRecentLimit = Math.max(0, Math.min(20, Math.floor(Number.isFinite(rawDiaryRecentLimit) ? rawDiaryRecentLimit : DEFAULT_SETTINGS.diaryRecentLimit)));
  if (settings.diaryRecentLimit !== diaryRecentLimit) {
    settings.diaryRecentLimit = diaryRecentLimit;
    shouldSave = true;
  }
  const rawApiTimeoutMs = Number(settings.apiTimeoutMs);
  const apiTimeoutMs = !Number.isFinite(rawApiTimeoutMs)
    ? DEFAULT_SETTINGS.apiTimeoutMs
    : (rawApiTimeoutMs <= 0 ? 0 : Math.max(1000, Math.min(1800000, Math.floor(rawApiTimeoutMs))));
  if (settings.apiTimeoutMs !== apiTimeoutMs) {
    settings.apiTimeoutMs = apiTimeoutMs;
    shouldSave = true;
  }
  const rawTrackerTokenBudget = Number(settings.trackerTokenBudget);
  const trackerTokenBudget = Math.max(500, Math.min(100000, Math.floor(Number.isFinite(rawTrackerTokenBudget) ? rawTrackerTokenBudget : DEFAULT_SETTINGS.trackerTokenBudget)));
  if (settings.trackerTokenBudget !== trackerTokenBudget) {
    settings.trackerTokenBudget = trackerTokenBudget;
    shouldSave = true;
  }
  const requireFullDescriptionUpdates = settings.requireFullDescriptionUpdates === true;
  if (settings.requireFullDescriptionUpdates !== requireFullDescriptionUpdates) {
    settings.requireFullDescriptionUpdates = requireFullDescriptionUpdates;
    shouldSave = true;
  }
  const lukerMultiAgentManualOnly = settings.lukerMultiAgentManualOnly !== false;
  if (settings.lukerMultiAgentManualOnly !== lukerMultiAgentManualOnly) {
    settings.lukerMultiAgentManualOnly = lukerMultiAgentManualOnly;
    shouldSave = true;
  }
  if (!settings.registryDescriptionGuides || typeof settings.registryDescriptionGuides !== 'object') {
    settings.registryDescriptionGuides = cloneValue(DEFAULT_REGISTRY_DESCRIPTION_GUIDES);
    shouldSave = true;
  } else {
    const existingGuides = { ...settings.registryDescriptionGuides };
    delete existingGuides['close' + 'upDescription'];
    const mergedGuides = {
      ...cloneValue(DEFAULT_REGISTRY_DESCRIPTION_GUIDES),
      ...existingGuides,
    };
    if (JSON.stringify(mergedGuides) !== JSON.stringify(settings.registryDescriptionGuides)) shouldSave = true;
    settings.registryDescriptionGuides = mergedGuides;
  }
  const normalizedApiFormat = normalizeApiFormat(settings.apiFormat);
  if (settings.apiFormat !== normalizedApiFormat) {
    settings.apiFormat = normalizedApiFormat;
    shouldSave = true;
  }
  if (shouldSave) saveHostSettings(ctx);
  return settings;
}

export function saveSettings(ctx) {
  saveHostSettings(ctx);
  const root = getHostExtensionSettings(ctx);
  const chatState = root?.[MODULE_NAME]?.chatStates?.[getChatKey(ctx)];
  if (chatState) scheduleHostChatStateSave(ctx, chatState);
}

export async function hydrateChatStateFromHost(ctx, settings) {
  if (!settings?.chatStates || typeof settings.chatStates !== 'object') return false;
  const initialKey = await resolveHostChatId(ctx);
  const localState = settings.chatStates[initialKey];
  if (localState && !isChatStateEffectivelyEmpty(localState)) return false;
  const storedState = await loadHostChatState(ctx);
  if (!storedState || isChatStateEffectivelyEmpty(storedState)) return false;
  // 载入过程本身可能才等到宿主句柄就绪，这时稳定 id 才算得出来。
  // 必须用最终的 key 落盘：否则资料会留在 fallback key 下，
  // 而面板之后是用稳定 id 去读的，等于载入了却还是显示「没有注册角色」。
  const chatKey = await resolveHostChatId(ctx);
  settings.chatStates[chatKey] = storedState;
  saveHostSettings(ctx);
  return true;
}

export function getChatKey(ctx) {
  return getHostChatId(ctx);
}

export function getChatState(ctx, settings) {
  const chatKey = getChatKey(ctx);
  if (!settings.chatStates[chatKey]) settings.chatStates[chatKey] = createEmptyChatState();
  const chatState = settings.chatStates[chatKey];
  let shouldSave = false;
  // 存量状态迁移：早期 characters 是普通 {}，读取时重建为 null-proto
  const rawCharacters = chatState.characters;
  if (!rawCharacters || typeof rawCharacters !== 'object') {
    chatState.characters = Object.create(null);
    shouldSave = true;
  } else if (Object.getPrototypeOf(rawCharacters) !== null) {
    const migrated = Object.create(null);
    for (const key of Object.keys(rawCharacters)) {
      migrated[key] = rawCharacters[key];
    }
    chatState.characters = migrated;
    shouldSave = true;
  }
  // 存量迁移：早期的孩子记录没有 id，补上后血缘引用才不依赖阵列索引
  for (const character of Object.values(chatState.characters)) {
    const children = character?.profile?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (child && typeof child === 'object' && !child.id) {
        child.id = createChildId();
        shouldSave = true;
      }
    }
  }
  const normalizedSkillCatalog = normalizeSkillCatalog(chatState.skillCatalog);
  if (JSON.stringify(chatState.skillCatalog || []) !== JSON.stringify(normalizedSkillCatalog)) shouldSave = true;
  chatState.skillCatalog = normalizedSkillCatalog;
  const normalizedNextSkillId = normalizeNextSkillId(chatState.skillCatalog, chatState.nextSkillId);
  if (chatState.nextSkillId !== normalizedNextSkillId) shouldSave = true;
  chatState.nextSkillId = normalizedNextSkillId;
  if (!Array.isArray(chatState.snapshots)) chatState.snapshots = [];
  if (!Array.isArray(chatState.lastOperationLogs)) chatState.lastOperationLogs = [];
  const sanitizedCurrentPayload = sanitizeSnapshotPayload(chatState);
  if (
    chatState.lastAttemptedSignature !== sanitizedCurrentPayload.lastAttemptedSignature
    || chatState.lastProcessedSignature !== sanitizedCurrentPayload.lastProcessedSignature
    || JSON.stringify(chatState.lastRawResult || null) !== JSON.stringify(sanitizedCurrentPayload.lastRawResult || null)
    || JSON.stringify(chatState.lastOperationLogs || []) !== JSON.stringify(sanitizedCurrentPayload.lastOperationLogs || [])
  ) {
    chatState.lastAttemptedSignature = sanitizedCurrentPayload.lastAttemptedSignature;
    chatState.lastProcessedSignature = sanitizedCurrentPayload.lastProcessedSignature;
    chatState.lastRawResult = sanitizedCurrentPayload.lastRawResult;
    chatState.lastOperationLogs = sanitizedCurrentPayload.lastOperationLogs;
    shouldSave = true;
  }
  if (compactChatStateSnapshots(chatState)) shouldSave = true;
  if (chatState.snapshots.length > MAX_CHAT_STATE_SNAPSHOTS) {
    trimChatStateSnapshots(chatState);
    shouldSave = true;
  }
  if (needsRepackChatStateSnapshots(chatState) && repackChatStateSnapshots(chatState)) shouldSave = true;
  if (shouldSave) saveSettings(ctx);
  const canRestoreSnapshot = getHostKind() !== 'tauritavern' || hasAbsoluteHostChatView(ctx);
  const latestSnapshot = canRestoreSnapshot ? getLatestMatchingSnapshot(ctx, chatState) : null;
  if (latestSnapshot) {
    const latestSnapshotKey = getSnapshotRuntimeKey(latestSnapshot);
    if (chatState[RESTORED_SNAPSHOT_RUNTIME_KEY] !== latestSnapshotKey) {
      restoreChatStateFromSnapshot(chatState, latestSnapshot);
      markRestoredSnapshot(chatState, latestSnapshot);
    }
  }
  const characters = chatState.characters;
  if (characters && typeof characters === 'object') {
    for (const item of Object.values(characters)) {
      normalizeCharacterPsychologyState(item);
      if (item?.profile && !Array.isArray(item.profile.diary)) item.profile.diary = [];
    }
  }
  return chatState;
}

export function isChatStateEffectivelyEmpty(chatState) {
  if (!chatState || typeof chatState !== 'object') return true;
  const hasCharacters = Object.keys(chatState.characters || {}).length > 0;
  const hasSkillCatalog = Array.isArray(chatState.skillCatalog) && chatState.skillCatalog.length > 0;
  const hasConsumedSkillIds = Number(chatState.nextSkillId) > 1;
  const hasSnapshots = Array.isArray(chatState.snapshots) && chatState.snapshots.length > 0;
  const hasSceneSummary = Boolean(String(chatState.sceneSummary || '').trim());
  const hasMinutesPassed = Number(chatState.minutesPassed) > 0;
  return !(hasCharacters || hasSkillCatalog || hasConsumedSkillIds || hasSnapshots || hasSceneSummary || hasMinutesPassed);
}

export function inheritChatStateFromMatchingChat(ctx, settings) {
  const chatKey = getChatKey(ctx);
  const currentChat = getHostChat(ctx);
  if (!chatKey || currentChat.length === 0) return { inherited: false, reason: 'empty_chat' };
  if (currentChat.length < MIN_CHAT_INHERIT_MESSAGE_COUNT) return { inherited: false, reason: 'chat_too_short' };

  if (!settings.chatStates || typeof settings.chatStates !== 'object') settings.chatStates = {};
  if (!settings.chatStates[chatKey]) settings.chatStates[chatKey] = createEmptyChatState();
  const currentState = settings.chatStates[chatKey];
  if (!isChatStateEffectivelyEmpty(currentState)) return { inherited: false, reason: 'state_exists' };

  const currentMessageCount = currentChat.length;
  const digestCache = new Map();
  const getDigestForCount = (count) => {
    if (!digestCache.has(count)) digestCache.set(count, buildMessageDigest(ctx, count));
    return digestCache.get(count);
  };
  let bestMatch = null;

  for (const [candidateKey, candidateState] of Object.entries(settings.chatStates)) {
    if (candidateKey === chatKey || !candidateState || typeof candidateState !== 'object') continue;
    compactChatStateSnapshots(candidateState);
    const candidateSnapshots = Array.isArray(candidateState.snapshots) ? candidateState.snapshots : [];
    for (const snapshot of candidateSnapshots) {
      const count = Number.isInteger(snapshot?.messageCount) ? snapshot.messageCount : 0;
      if (count <= 0 || count !== currentMessageCount) continue;
      if (String(snapshot?.messageDigest || '') !== getDigestForCount(count)) continue;
      if (!bestMatch || count > bestMatch.count || (count === bestMatch.count && (snapshot.createdAt || 0) > (bestMatch.snapshot?.createdAt || 0))) {
        bestMatch = { candidateKey, candidateState, snapshot, count };
      }
    }
  }

  if (!bestMatch?.snapshot) return { inherited: false, reason: 'no_matching_snapshot' };

  const inheritedSnapshots = (Array.isArray(bestMatch.candidateState.snapshots) ? bestMatch.candidateState.snapshots : [])
    .filter((snapshot) => {
      const count = Number.isInteger(snapshot?.messageCount) ? snapshot.messageCount : 0;
      if (count <= 0 || count > currentMessageCount) return false;
      return String(snapshot?.messageDigest || '') === getDigestForCount(count);
    })
    .map((snapshot) => cloneValue(snapshot));

  currentState.snapshots = inheritedSnapshots;
  trimChatStateSnapshots(currentState);
  restoreChatStateFromSnapshot(currentState, bestMatch.snapshot);

  return {
    inherited: true,
    fromChatKey: bestMatch.candidateKey,
    messageCount: bestMatch.count,
  };
}

function hasWorldBookEntries(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (Array.isArray(value.entries)) return value.entries.length > 0;
  return Boolean(value.entries && typeof value.entries === 'object' && Object.keys(value.entries).length > 0);
}

export function getCharacterCard(ctx) {
  const card = getResolvedCharacter(ctx)?.card;
  if (!card) return {};
  return {
    name: card.name || '',
    description: card.description || '',
    personality: card.personality || '',
    scenario: card.scenario || '',
    first_mes: card.first_mes || '',
    mes_example: card.mes_example || '',
    worldBook: hasWorldBookEntries(card.worldBook) ? card.worldBook : null,
  };
}

export function getCharacterWorldBookName(ctx) {
  const card = getResolvedCharacter(ctx)?.card;
  if (!card || typeof card !== 'object') return '';
  return pickFirstString(card, [
    'data.extensions.world',
    'data.extensions.worldbook',
    'extensions.world',
    'extensions.worldbook',
    'world',
    'character_book',
    'worldBook.name',
  ]);
}

/**
 * 清洗世界书条目显示名。
 * 数据库 skill 化后 comment 常变成「条目名\n\n<!-- ACU_SKILL_META_START ... -->」；
 * 若直接用整段 comment，排除名单按行拆分会把名字拆碎，导致勾选后匹配失败。
 */
export function sanitizeWorldbookEntryDisplayName(value) {
  let text = String(value ?? '');
  if (!text) return '';
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/ACU_SKILL_META_(?:START|END)/gi, ' ');
  const firstLine = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return String(firstLine || '').trim();
}

export function getWorldbookEntryDisplayName(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string' || typeof entry === 'number') {
    return sanitizeWorldbookEntryDisplayName(entry);
  }
  if (typeof entry !== 'object') return '';
  const raw = entry.name || entry.comment || entry.title || entry.displayName || entry.uid || '';
  return sanitizeWorldbookEntryDisplayName(raw);
}

/** 排除/白名单匹配：完整「书名 :: 条目名」或裸条目名任一命中即可 */
export function worldbookSelectionMatches(selectedSet, selectionName, entryName = '') {
  if (!selectedSet || typeof selectedSet.has !== 'function') return false;
  const full = String(selectionName || '').trim();
  const bare = String(entryName || '').trim();
  if (full && selectedSet.has(full)) return true;
  if (bare && selectedSet.has(bare)) return true;
  if (full.includes(' :: ')) {
    const onlyEntry = full.split(' :: ').slice(1).join(' :: ').trim();
    if (onlyEntry && selectedSet.has(onlyEntry)) return true;
  }
  return false;
}

export function getCharacterAvatarBaseName(ctx) {
  const card = getResolvedCharacter(ctx)?.card;
  if (!card || typeof card !== 'object') return '';
  const avatar = pickFirstString(card, ['avatar', 'data.avatar', 'img', 'filename']);
  if (avatar) return avatar.replace(/\.[^/.]+$/, '').trim();
  return String(card.name || '').trim();
}

export function getResolvedCharacter(ctx) {
  const characters = getHostCharacters(ctx);
  const directId = Number.isInteger(ctx?.characterId) ? ctx.characterId : null;
  if (directId !== null && characters[directId]) {
    return { id: directId, card: characters[directId], source: 'characterId' };
  }

  const assistantMessages = getHostChat(ctx)
    .filter((message) => message && !message.is_user && !message.is_system)
    .slice()
    .reverse();
  const preferredNames = [];
  for (const message of assistantMessages) {
    const name = String(message?.name || '').trim();
    if (name && !preferredNames.includes(name)) preferredNames.push(name);
  }
  const fallbackName = String(ctx?.name2 || '').trim();
  if (fallbackName && !preferredNames.includes(fallbackName)) preferredNames.push(fallbackName);

  for (const targetName of preferredNames) {
    const matchedId = characters.findIndex((item) => String(item?.name || '').trim() === targetName);
    if (matchedId >= 0) {
      return { id: matchedId, card: characters[matchedId], source: 'chatName' };
    }
  }
  return { id: null, card: null, source: 'none' };
}

export async function getCharacterWorldBookNameViaSTscript() {
  if (typeof globalThis.STscript !== 'function') return '';
  try {
    const result = await globalThis.STscript('/getcharbook');
    const name = String(result?.pipe ?? result ?? '').trim();
    return name;
  } catch (error) {
    console.warn('[BS BioTracker] /getcharbook failed', error);
    return '';
  }
}

async function getWorldInfoModule() {
  if (globalThis.__bsBtWorldInfoModuleOverride__ !== undefined) return globalThis.__bsBtWorldInfoModuleOverride__;
  if (!worldInfoModulePromise) {
    const moduleUrl = new URL('../../../../world-info.js', import.meta.url).href;
    worldInfoModulePromise = import(moduleUrl).catch((error) => {
      console.warn('[BS BioTracker] import world-info module failed', error);
      return null;
    });
  }
  return worldInfoModulePromise;
}

function pushWorldBookNames(target, list) {
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item || '').trim();
    if (name && !target.includes(name)) target.push(name);
  }
}

/** 世界书设置对象的候选来源：正规扩展与酒馆助手 iframe 注入环境的布局都覆盖 */
function collectWorldInfoRoots(worldInfoModule = null) {
  const roots = [];
  const pushRoot = (root) => {
    if (root && typeof root === 'object' && !roots.includes(root)) roots.push(root);
  };
  pushRoot(worldInfoModule?.world_info);
  try { pushRoot(globalThis.world_info); } catch {}
  try { pushRoot(globalThis.world_info_settings?.world_info); } catch {}
  try { pushRoot(globalThis.power_user?.world_info); } catch {}
  try {
    const ctx = getHostContext();
    pushRoot(ctx?.world_info);
    pushRoot(ctx?.worldInfoSettings?.world_info);
  } catch {}
  try {
    const parentWin = globalThis.parent && globalThis.parent !== globalThis ? globalThis.parent : null;
    if (parentWin) {
      pushRoot(parentWin.world_info);
      pushRoot(parentWin.world_info_settings?.world_info);
    }
  } catch {}
  return roots;
}

export async function getActiveGlobalWorldBookNames() {
  const names = [];

  // 1) 经典 ST：world-info.js 模组的 selected_world_info（酒馆助手 iframe 注入时常 import 失败）
  const worldInfoModule = await getWorldInfoModule();
  pushWorldBookNames(names, worldInfoModule?.selected_world_info);

  // 2) 运行时全局
  try { pushWorldBookNames(names, globalThis.selected_world_info); } catch {}

  // 3) world_info.globalSelect（ST/TT 设置里的启用全域书）
  for (const root of collectWorldInfoRoots(worldInfoModule)) {
    pushWorldBookNames(names, root?.globalSelect);
  }

  // 4) 页面上的全域世界书多选框（若存在）
  try {
    const select = document.querySelector?.('#world_info');
    if (select?.selectedOptions) {
      pushWorldBookNames(names, Array.from(select.selectedOptions).map((option) => option.textContent || option.label || option.value));
    }
  } catch {}

  // 5) 酒馆助手 API
  for (const fn of [globalThis.getLorebookSettings, globalThis.TavernHelper?.getLorebookSettings]) {
    if (typeof fn !== 'function') continue;
    try {
      const lorebookSettings = await Promise.resolve(fn());
      pushWorldBookNames(names, lorebookSettings?.selected_global_lorebooks);
      pushWorldBookNames(names, lorebookSettings?.selected_world_info);
    } catch {}
  }

  return names;
}

function matchCharLoreEntry(entry, avatarBaseName, cardName) {
  if (!entry || typeof entry !== 'object') return false;
  const entryName = String(entry.name || '').trim();
  if (!entryName) return false;
  const entryBaseName = entryName.replace(/\.[^/.]+$/, '');
  if (avatarBaseName && (entryName === avatarBaseName || entryBaseName === avatarBaseName)) return true;
  if (cardName && (entryName === cardName || entryBaseName === cardName)) return true;
  return false;
}

/**
 * 角色附加知识书（charLore / extraBooks）名称列表。
 * 与主世界书 data.extensions.world 分开存储，旧版只读主书会漏掉。
 */
export async function getCharacterAdditionalWorldBookNames(ctx) {
  const names = [];

  // 1) 酒馆助手 API（iframe 注入环境；可能为 async）
  for (const fn of [globalThis.getCharLorebooks, globalThis.TavernHelper?.getCharLorebooks]) {
    if (typeof fn !== 'function') continue;
    try {
      const books = await Promise.resolve(fn({ type: 'all' }));
      if (books && typeof books === 'object') {
        pushWorldBookNames(names, books.additional);
        pushWorldBookNames(names, books.extraBooks);
      }
    } catch {}
  }

  // 2) world_info.charLore（world-info 模组与各运行时全局）
  const worldInfoModule = await getWorldInfoModule();
  const avatarBaseName = getCharacterAvatarBaseName(ctx);
  const cardName = String(getResolvedCharacter(ctx)?.card?.name || '').trim();
  for (const root of collectWorldInfoRoots(worldInfoModule)) {
    if (!Array.isArray(root?.charLore)) continue;
    const entry = root.charLore.find((item) => matchCharLoreEntry(item, avatarBaseName, cardName));
    if (entry) pushWorldBookNames(names, entry.extraBooks);
  }

  // 主世界书名不要混进附加列表
  const primary = String(getCharacterWorldBookName(ctx) || '').trim();
  return names.filter((name) => name && name !== primary);
}

/**
 * 加载角色附加知识书，返回带 source 标记的书列表。
 * filterBook 由调用方注入，避免 state ↔ registry/tracker 循环依赖。
 */
export async function loadCharacterAdditionalWorldBooks(ctx, { loadBook, filterBook, recentMessages = [] } = {}) {
  const names = await getCharacterAdditionalWorldBookNames(ctx);
  if (!names.length) return [];
  const load = typeof loadBook === 'function' ? loadBook : async (name) => loadGlobalWorldBook(ctx, name);
  const books = await Promise.all(names.map(async (name) => {
    try {
      let worldBook = await load(name);
      if (!worldBook) return null;
      if (typeof filterBook === 'function') worldBook = filterBook(worldBook, name, recentMessages);
      if (!worldBook) return null;
      const hasEntries = (Array.isArray(worldBook.entries) && worldBook.entries.length > 0)
        || (worldBook.entries && typeof worldBook.entries === 'object' && Object.keys(worldBook.entries).length > 0);
      if (!hasEntries) return null;
      return { ...worldBook, name, source: 'character_additional' };
    } catch (error) {
      console.warn(`[BS BioTracker] load character additional worldbook "${name}" failed`, error);
      return null;
    }
  }));
  return books.filter(Boolean);
}

export async function loadGlobalWorldBook(ctx, name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;
  if (canLoadHostWorldInfo(ctx)) {
    try {
      return await loadHostWorldInfo(ctx, normalizedName);
    } catch (error) {
      console.warn(`[BS BioTracker] load active global worldbook "${normalizedName}" failed`, error);
    }
  }
  try {
    const worldBook = await getHostWorldBook(normalizedName, 'global');
    if (worldBook) return worldBook;
  } catch (error) {
    console.warn(`[BS BioTracker] host get active global worldbook "${normalizedName}" failed`, error);
  }
  // 附加知识书有时只能按 character scope 取到
  try {
    const worldBook = await getHostWorldBook(normalizedName, 'character');
    if (worldBook) return worldBook;
  } catch {}
  return null;
}

export function getTargetNames(ctx, settings) {
  const names = String(settings.targetNames || '')
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

export function getRegisteredTargetNames(ctx, settings, chatState = null) {
  const state = chatState || getChatState(ctx, settings);
  return Object.entries(state?.characters || {})
    .filter(([, item]) => item?.initialized)
    .map(([name]) => name);
}

/**
 * 追踪重点是提示模型优先检查的角色，不是过滤器；未点名的已注册角色仍会同步推进。
 */
export function getPriorityCharacterNames(ctx, settings, chatState = null) {
  const state = chatState || getChatState(ctx, settings);
  const targetNames = getTargetNames(ctx, settings);
  if (targetNames.length === 0) return [];
  return targetNames
    .map((name) => resolveRegisteredCharacterName(state, name))
    .filter((name, index, list) => name && list.indexOf(name) === index);
}

function normalizeCharacterLookupName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function resolveRegisteredCharacterName(chatState, targetName, options = {}) {
  const requireInitialized = options.requireInitialized !== false;
  const rawName = String(targetName || '').trim();
  if (!rawName) return '';
  const characters = chatState?.characters && typeof chatState.characters === 'object' ? chatState.characters : {};
  const isUsable = (entry) => entry && (!requireInitialized || entry.initialized === true);
  if (isUsable(characters[rawName])) return rawName;
  const normalized = normalizeCharacterLookupName(rawName);
  for (const [name, entry] of Object.entries(characters)) {
    if (!isUsable(entry)) continue;
    if (normalizeCharacterLookupName(name) === normalized) return name;
    if (normalizeCharacterLookupName(entry?.name) === normalized) return name;
  }
  return '';
}

export function buildRecentMessages(ctx, settings, endIndexExclusive = null) {
  const count = Math.max(2, Number(settings.contextSize) || 12);
  const chat = getHostChat(ctx);
  const end = Number.isInteger(endIndexExclusive) ? Math.max(0, Math.min(chat.length, endIndexExclusive)) : chat.length;
  return chat.slice(Math.max(0, end - count), end).map((message) => ({
    name: message.name || (message.is_user ? ctx.name1 : ctx.name2) || '',
    role: message.is_user ? 'user' : 'assistant',
    text: String(message.mes || ''),
  }));
}

export function buildMessageSignature(ctx, message) {
  if (!message) return '';
  return [
    message.is_user ? 'user' : 'assistant',
    String(message.name || (message.is_user ? ctx.name1 : ctx.name2) || ''),
    String(message.mes || ''),
  ].join('|');
}

function hashStringFNV1a(value, seed = MESSAGE_DIGEST_SEED) {
  let hash = seed >>> 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function foldMessageSignatureDigest(seed, signature) {
  let hash = seed >>> 0;
  hash ^= hashStringFNV1a(signature, MESSAGE_DIGEST_SEED);
  hash = Math.imul(hash, 16777619) >>> 0;
  return hash >>> 0;
}

export function buildMessageDigest(ctx, endIndexExclusive = null) {
  const chat = getHostChat(ctx);
  const end = Number.isInteger(endIndexExclusive) ? Math.max(0, Math.min(chat.length, endIndexExclusive)) : chat.length;
  let hash = MESSAGE_DIGEST_SEED;
  for (let index = 0; index < end; index += 1) {
    hash = foldMessageSignatureDigest(hash, buildMessageSignature(ctx, chat[index]));
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 快照涵盖到的最后一则讯息的签名（杂凑过，避免快照膨胀）。
 *
 * 不用整段前缀 digest：TT 的聊天视图是稀疏阵列（`new Array(totalCount)` 只填入已载入的窗口），
 * 对 0..count 做前缀杂凑会把未载入的洞一起算进去，结果随载入范围而变。
 * 边界这一则才是决定快照有效性的关键，而且通常就在已载入范围内。
 */
export function buildBoundaryMessageSignature(ctx, messageCount) {
  const chat = getHostChat(ctx);
  const index = Math.floor(Number(messageCount) || 0) - 1;
  if (index < 0 || index >= chat.length) return '';
  const message = chat[index];
  // 稀疏视图未载入处取不到讯息，回传空字串代表「无从比对」
  if (!message) return '';
  return hashStringFNV1a(buildMessageSignature(ctx, message)).toString(16).padStart(8, '0');
}

/**
 * 快照的边界讯息是否仍与当前聊天一致。
 *
 * 只比 messageCount 会让「删楼后长度恰好对上」的旧快照被当成完全匹配，
 * 于是从一个内容已经不同的基准继续跑，后续对账一路错下去。
 *
 * 但两种情况无从比对：旧快照没有这个栏位；TT 稀疏视图该位置尚未载入。
 * 这时维持原本只比 messageCount 的行为——宁可放行，也不要误判为失效而触发不必要的整段回放。
 */
function isSnapshotBoundaryIntact(ctx, snapshot, messageCount) {
  const recorded = String(snapshot?.boundarySignature || '');
  if (!recorded) return true;
  const current = buildBoundaryMessageSignature(ctx, messageCount);
  if (!current) return true;
  return recorded === current;
}

function buildMessageDigestFromSignatures(signatures, endIndexExclusive = null) {
  const list = Array.isArray(signatures) ? signatures : [];
  const end = Number.isInteger(endIndexExclusive) ? Math.max(0, Math.min(list.length, endIndexExclusive)) : list.length;
  let hash = MESSAGE_DIGEST_SEED;
  for (let index = 0; index < end; index += 1) {
    hash = foldMessageSignatureDigest(hash, list[index]);
  }
  return hash.toString(16).padStart(8, '0');
}

function createSnapshotCharacterBaseline(name = '') {
  return {
    name: String(name || '').trim(),
    initialized: false,
    profile: {
      cooldown: {
        orgasmOvulationUsed: false,
        naturalOvulationUsed: false,
        pregnancyPressureWarning: false,
        psychologyUpdateUsed: false,
        maternalFetalInteractionUsed: false,
      },
      base: {
        isHere: true,
        days: 0,
        fertilizationDays: 0,
        latestSexDays: null,
        age: 15,
        stage: null,
        race: '人类',
        derivedType: null,
        sperms: [],
        eggs: 0,
        libido: 0,
        uterinePressure: 0,
        vitality: getVitalityInitByLevel(4),
        psyStress: getPsyStressInitByLevel(4),
        vitalityLevel: 4,
        psyStressLevel: 4,
      },
      pregnant: {
        pregnantDays: 0,
        effectivePregnantDays: 0,
        laborHours: 0,
        effectiveLaborHours: 0,
        laborPhase: null,
        laborFetusIndex: 0,
        laborPain: 0,
        prodromalOriginStage: null,
        prodromalRemainingHours: 0,
        prodromalDelayProgressHours: 0,
        fetusesCount: 0,
        fetalEnergyDrain: 0,
        amnionDurability: 0,
        nutrition: 0,
        symptomReliefPending: 0,
        blockage: null,
        acceleration: null,
        expansion: null,
        fetuses: [],
      },
      experience: {
        virginity: null,
        latestSexPartner: null,
        emotionalMate: null,
        marriageMate: null,
        pregnantExperience: 0,
        naturalBirthExperience: 0,
        surgicalBirthExperience: 0,
        miscarriageExperience: 0,
      },
      psychology: {
        mens: buildEmptyPsychologyGroup(PSY_MENS_FIELDS, PSY_MENS_BOOL_FIELDS),
        preg: buildEmptyPsychologyGroup(PSY_PREG_FIELDS, PSY_PREG_BOOL_FIELDS),
        stageProfiles: {},
      },
      children: [],
      skills: [],
      talents: [],
      skillHistory: [],
      diary: [],
      bio: {
        menstrualLengthRatio: 1.0,
        gestationSpeciesSpeed: 1.0,
        gestationEffectiveSpeed: 1.0,
        gestationModifierMultiplier: 1.0,
        gestationModifierName: '',
        gestationModifierDescription: '',
        birthDifficulty: 1.0,
        breedTolerance: 1.0,
        impregnationDifficulty: 1.0,
        orgasmOvulationAmount: 1,
        identicalProbability: 5,
        recoveryDays: 56,
      },
      metabolism: {
        excretion: 0,
        hunger: 0,
        sleep: 0,
        flux: 0,
        milk: 0,
        odor: 0,
        companionship: 0,
      },
      descriptions: {
        normalDescription: '',
        pregnantDescription: '',
      },
      notify: {
        firstly: '',
        secondly: '',
        thirdly: '',
      },
      immune: {
        metabolism: false,
        miscarriage: false,
        realisticLabor: false,
      },
    },
  };
}

function compactSnapshotRecord(value) {
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === '') continue;
    result[key] = entry;
  }
  return result;
}

function compactSnapshotArrayEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => compactSnapshotRecord(item));
}

function normalizeCharacterForSnapshot(character, name = '') {
  const next = cloneValue(character || {});
  next.name = String(next.name || name || '').trim();
  next.initialized = Boolean(next.initialized);
  next.profile = next.profile && typeof next.profile === 'object' ? next.profile : {};
  next.profile.psychology = normalizePsychologyState(next.profile.psychology);
  next.profile.base = next.profile.base && typeof next.profile.base === 'object' ? next.profile.base : {};
  next.profile.pregnant = next.profile.pregnant && typeof next.profile.pregnant === 'object' ? next.profile.pregnant : {};
  next.profile.children = compactSnapshotArrayEntries(next.profile.children);
  next.profile.diary = compactSnapshotArrayEntries(next.profile.diary);
  next.profile.pregnant.fetuses = compactSnapshotArrayEntries(next.profile.pregnant.fetuses);
  next.profile.base.sperms = compactSnapshotArrayEntries(next.profile.base.sperms);
  next.profile.descriptions = compactSnapshotRecord(next.profile.descriptions || {});
  next.profile.notify = compactSnapshotRecord(next.profile.notify || {});
  delete next.updatedAt;
  delete next.runtime;
  return next;
}

function packSnapshotCharacters(characters) {
  const source = characters && typeof characters === 'object' ? characters : {};
  const packed = {};
  for (const [name, item] of Object.entries(source)) {
    const normalized = normalizeCharacterForSnapshot(item, name);
    const baseline = createSnapshotCharacterBaseline(normalized.name || name);
    const patch = buildStateDeltaPatch(baseline, normalized);
    packed[name] = patch && typeof patch === 'object' ? patch : {};
  }
  return packed;
}

function unpackSnapshotCharacters(characters, format = '') {
  if (!characters || typeof characters !== 'object') return {};
  const unpacked = {};
  for (const [name, item] of Object.entries(characters)) {
    if (format === 'default_delta_v1') {
      const baseline = createSnapshotCharacterBaseline(name);
      const restored = applyStateDeltaPatch(baseline, item && typeof item === 'object' ? item : {});
      unpacked[name] = normalizeCharacterPsychologyState(restored);
      continue;
    }
    unpacked[name] = normalizeCharacterPsychologyState(cloneValue(item));
  }
  return unpacked;
}

function exportChatStateSnapshotPayload(chatState) {
  return {
    snapshotSchema: 'packed_v2',
    charactersFormat: 'default_delta_v1',
    skillCatalog: normalizeSkillCatalog(chatState.skillCatalog),
    nextSkillId: normalizeNextSkillId(chatState.skillCatalog, chatState.nextSkillId),
    lastAttemptedSignature: sanitizeStoredSignature(chatState.lastAttemptedSignature),
    lastProcessedSignature: sanitizeStoredSignature(chatState.lastProcessedSignature),
    lastRunAt: chatState.lastRunAt || 0,
    sceneSummary: chatState.sceneSummary || '',
    minutesPassed: chatState.minutesPassed || 0,
    characters: packSnapshotCharacters(chatState.characters),
    lastRawResult: summarizeRawResult(chatState.lastRawResult),
    lastOperationLogs: summarizeOperationLogs(chatState.lastOperationLogs),
  };
}

function sanitizeStoredSignature(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 120) return text;
  return `hash:${hashStringFNV1a(text, MESSAGE_DIGEST_SEED).toString(16).padStart(8, '0')}`;
}

function normalizeSnapshotToolArguments(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? summarizeSnapshotDebugValue(parsed) : value.slice(0, MAX_RAW_RESULT_TEXT_LENGTH);
    } catch {
      return value.slice(0, MAX_RAW_RESULT_TEXT_LENGTH);
    }
  }
  if (value && typeof value === 'object') return summarizeSnapshotDebugValue(value);
  return value;
}

function summarizeSnapshotDebugValue(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, MAX_RAW_RESULT_TEXT_LENGTH);
  if (!value || typeof value !== 'object') return value;
  if (depth >= 8) return '[Object]';
  if (Array.isArray(value)) return value.slice(0, MAX_SNAPSHOT_DEBUG_ITEMS).map((item) => summarizeSnapshotDebugValue(item, depth + 1));
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = summarizeSnapshotDebugValue(child, depth + 1);
  }
  return result;
}

export function summarizeRawResult(value) {
  if (!value || typeof value !== 'object') return null;
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls.map((call) => {
        const item = { name: String(call?.name || '') };
        const args = normalizeSnapshotToolArguments(call?.arguments);
        if (args !== undefined) item.arguments = args;
        return item;
      })
    : [];
  const characterChecks = Array.isArray(value.character_checks)
    ? value.character_checks.slice(0, MAX_SNAPSHOT_DEBUG_ITEMS).map((check) => ({
        female: String(check?.female || ''),
        status: String(check?.status || ''),
      }))
    : [];
  const coverage = value.character_check_coverage && typeof value.character_check_coverage === 'object'
    ? summarizeSnapshotDebugValue(value.character_check_coverage)
    : undefined;
  const message = typeof value.message === 'string' ? value.message.slice(0, MAX_RAW_RESULT_TEXT_LENGTH) : undefined;
  const error = typeof value.error === 'string' ? value.error.slice(0, MAX_RAW_RESULT_TEXT_LENGTH) : undefined;
  const result = {};
  if (message) result.message = message;
  if (error) result.error = error;
  if (toolCalls.length > 0) result.tool_calls = toolCalls;
  if (characterChecks.length > 0) result.character_checks = characterChecks;
  if (coverage) result.character_check_coverage = coverage;
  return Object.keys(result).length > 0 ? result : null;
}

export function summarizeOperationLogs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SNAPSHOT_DEBUG_ITEMS).map((item) => {
    const log = {
      name: String(item?.name || ''),
      applied: Boolean(item?.applied),
      message: String(item?.message || '').slice(0, MAX_RAW_RESULT_TEXT_LENGTH),
    };
    if (item?.notify && typeof item.notify === 'object') log.notify = summarizeSnapshotDebugValue(item.notify);
    const args = normalizeSnapshotToolArguments(item?.arguments);
    if (args !== undefined) log.arguments = args;
    return log;
  });
}

function sanitizeSnapshotPayload(payload) {
  const next = cloneValue(payload || createEmptyChatState());
  next.skillCatalog = normalizeSkillCatalog(next.skillCatalog);
  next.nextSkillId = normalizeNextSkillId(next.skillCatalog, next.nextSkillId);
  next.lastAttemptedSignature = sanitizeStoredSignature(next.lastAttemptedSignature);
  next.lastProcessedSignature = sanitizeStoredSignature(next.lastProcessedSignature);
  next.lastRawResult = summarizeRawResult(next.lastRawResult);
  next.lastOperationLogs = summarizeOperationLogs(next.lastOperationLogs);
  return next;
}

function buildStateDeltaPatch(previousValue, nextValue) {
  if (previousValue === nextValue) return undefined;
  if (Array.isArray(previousValue) || Array.isArray(nextValue)) {
    if (areSnapshotArraysEqual(previousValue, nextValue)) return undefined;
    const appendPatch = createSnapshotArrayAppendPatch(previousValue, nextValue);
    return appendPatch || cloneValue(nextValue);
  }
  if (!isPlainObject(previousValue) || !isPlainObject(nextValue)) {
    return JSON.stringify(previousValue) === JSON.stringify(nextValue) ? undefined : cloneValue(nextValue);
  }

  const patch = {};
  let changed = false;
  const keys = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)]);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
      patch[key] = createSnapshotDeleteSentinel();
      changed = true;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(previousValue, key)) {
      patch[key] = cloneValue(nextValue[key]);
      changed = true;
      continue;
    }
    const childPatch = buildStateDeltaPatch(previousValue[key], nextValue[key]);
    if (childPatch !== undefined) {
      patch[key] = childPatch;
      changed = true;
    }
  }
  return changed ? patch : undefined;
}

function applyStateDeltaPatch(previousValue, deltaPatch) {
  if (deltaPatch === undefined) return cloneValue(previousValue);
  if (isSnapshotDeleteSentinel(deltaPatch)) return undefined;
  if (isSnapshotArrayAppendPatch(deltaPatch)) return applySnapshotArrayAppendPatch(previousValue, deltaPatch);
  if (Array.isArray(deltaPatch) || !isPlainObject(deltaPatch)) return cloneValue(deltaPatch);

  const base = isPlainObject(previousValue) ? cloneValue(previousValue) : {};
  for (const [key, value] of Object.entries(deltaPatch)) {
    if (isSnapshotDeleteSentinel(value)) {
      delete base[key];
      continue;
    }
    const nextValue = applyStateDeltaPatch(base[key], value);
    if (nextValue === undefined) delete base[key];
    else base[key] = nextValue;
  }
  return base;
}

function getSerializedSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function shouldStoreFullSnapshot(snapshotIndex, fullPayload, deltaPatch) {
  if (snapshotIndex <= 0) return true;
  if (snapshotIndex % SNAPSHOT_FULL_INTERVAL === 0) return true;
  if (deltaPatch === undefined) return false;
  const fullSize = getSerializedSize(fullPayload);
  const patchSize = getSerializedSize(deltaPatch);
  if (!Number.isFinite(fullSize) || fullSize <= 0) return true;
  return patchSize >= Math.floor(fullSize * SNAPSHOT_PATCH_SIZE_RATIO);
}

function trimChatStateSnapshots(chatState) {
  if (!Array.isArray(chatState?.snapshots)) return;
  if (chatState.snapshots.length <= MAX_CHAT_STATE_SNAPSHOTS) return;
  compactChatStateSnapshots(chatState);
  const startIndex = chatState.snapshots.length - MAX_CHAT_STATE_SNAPSHOTS;
  const materializedFirstPayload = materializeSnapshotPayloadAt(chatState.snapshots, startIndex);
  chatState.snapshots = chatState.snapshots.slice(startIndex);
  if (chatState.snapshots[0]) {
    chatState.snapshots[0] = {
      messageCount: Number.isInteger(chatState.snapshots[0].messageCount) ? chatState.snapshots[0].messageCount : 0,
      messageDigest: String(chatState.snapshots[0].messageDigest || ''),
      boundarySignature: String(chatState.snapshots[0].boundarySignature || ''),
      reason: String(chatState.snapshots[0].reason || 'state'),
      createdAt: Number(chatState.snapshots[0].createdAt || Date.now()),
      anchorVersion: Number(chatState.snapshots[0].anchorVersion) || 0,
      tailMessageId: String(chatState.snapshots[0].tailMessageId || ''),
      tailSwipeId: String(chatState.snapshots[0].tailSwipeId || ''),
      tailName: String(chatState.snapshots[0].tailName || ''),
      snapshotMode: 'full',
      stateSnapshot: materializedFirstPayload,
    };
  }
}

function findSnapshotIndex(chatState, snapshot) {
  const snapshots = Array.isArray(chatState?.snapshots) ? chatState.snapshots : [];
  if (!snapshot || typeof snapshot !== 'object') return -1;
  const directIndex = snapshots.indexOf(snapshot);
  if (directIndex >= 0) return directIndex;
  return snapshots.findIndex((item) =>
    item
    && item.createdAt === snapshot.createdAt
    && item.messageCount === snapshot.messageCount
    && item.reason === snapshot.reason
    && String(item.messageDigest || '') === String(snapshot.messageDigest || ''));
}

function materializeSnapshotPayloadAt(snapshots, index, cache = new Map()) {
  if (!Array.isArray(snapshots) || index < 0 || index >= snapshots.length) return createEmptyChatState();
  if (cache.has(index)) return cloneValue(cache.get(index));

  const snapshot = snapshots[index];
  let payload;
  if (snapshot?.snapshotMode === 'patch') {
    const previousPayload = materializeSnapshotPayloadAt(snapshots, index - 1, cache);
    payload = applyStateDeltaPatch(previousPayload, snapshot.stateDelta || {});
  } else {
    payload = snapshot?.stateSnapshot ? cloneValue(snapshot.stateSnapshot) : createEmptyChatState();
  }

  cache.set(index, cloneValue(payload));
  return payload;
}

function createStoredSnapshotState(snapshots, payload, metadata = {}, cache = new Map()) {
  const snapshotIndex = Array.isArray(snapshots) ? snapshots.length : 0;
  const normalizedPayload = sanitizeSnapshotPayload(payload);
  const previousPayload = snapshotIndex > 0 ? materializeSnapshotPayloadAt(snapshots, snapshotIndex - 1, cache) : null;
  const deltaPatch = previousPayload ? buildStateDeltaPatch(previousPayload, normalizedPayload) : undefined;
  const baseRecord = {
    messageCount: Number.isInteger(metadata.messageCount) ? Math.max(0, metadata.messageCount) : 0,
    messageDigest: String(metadata.messageDigest || ''),
    boundarySignature: String(metadata.boundarySignature || ''),
    reason: String(metadata.reason || 'state'),
    createdAt: Number(metadata.createdAt || Date.now()),
    // 靜默正文替換識別錨點（anchorVersion 1）：記錄邊界樓層的身分。舊快照沒有
    // 這些欄位（anchorVersion 0）→ 永遠走原本的判定，零回歸。
    anchorVersion: Number(metadata.anchorVersion) || 0,
    tailMessageId: metadata.tailMessageId === undefined || metadata.tailMessageId === null ? '' : String(metadata.tailMessageId),
    tailSwipeId: metadata.tailSwipeId === undefined || metadata.tailSwipeId === null ? '' : String(metadata.tailSwipeId),
    tailName: metadata.tailName === undefined || metadata.tailName === null ? '' : String(metadata.tailName),
  };

  if (shouldStoreFullSnapshot(snapshotIndex, normalizedPayload, deltaPatch)) {
    return {
      ...baseRecord,
      snapshotMode: 'full',
      stateSnapshot: normalizedPayload,
    };
  }

  return {
    ...baseRecord,
    snapshotMode: 'patch',
    stateDelta: deltaPatch || {},
  };
}

function compactChatStateSnapshots(chatState) {
  if (!Array.isArray(chatState?.snapshots)) return false;
  let changed = false;
  for (const snapshot of chatState.snapshots) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    if (!Number.isInteger(snapshot.messageCount)) {
      snapshot.messageCount = Array.isArray(snapshot.messageSignatures) ? snapshot.messageSignatures.length : 0;
      changed = true;
    }
    if (!snapshot.messageDigest && Array.isArray(snapshot.messageSignatures)) {
      snapshot.messageDigest = buildMessageDigestFromSignatures(snapshot.messageSignatures, snapshot.messageCount);
      changed = true;
    }
    if (!snapshot.snapshotMode) {
      snapshot.snapshotMode = snapshot.stateDelta ? 'patch' : 'full';
      changed = true;
    }
    if (Array.isArray(snapshot.messageSignatures)) {
      delete snapshot.messageSignatures;
      changed = true;
    }
  }
  return changed;
}

function needsRepackChatStateSnapshots(chatState) {
  if (!Array.isArray(chatState?.snapshots) || chatState.snapshots.length === 0) return false;
  return chatState.snapshots.some((snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.snapshotMode) return true;
    if (Array.isArray(snapshot.messageSignatures)) return true;
    return false;
  });
}

function repackChatStateSnapshots(chatState) {
  if (!Array.isArray(chatState?.snapshots) || chatState.snapshots.length === 0) return false;
  compactChatStateSnapshots(chatState);

  const originalSnapshots = chatState.snapshots;
  const sourceCache = new Map();
  const repackedSnapshots = [];
  const repackedCache = new Map();
  let changed = false;

  for (let index = 0; index < originalSnapshots.length; index += 1) {
    const snapshot = originalSnapshots[index];
    const payload = materializeSnapshotPayloadAt(originalSnapshots, index, sourceCache);
    const stored = createStoredSnapshotState(repackedSnapshots, payload, {
      messageCount: snapshot?.messageCount,
      messageDigest: snapshot?.messageDigest,
      boundarySignature: snapshot?.boundarySignature,
      reason: snapshot?.reason,
      createdAt: snapshot?.createdAt,
      anchorVersion: snapshot?.anchorVersion,
      tailMessageId: snapshot?.tailMessageId,
      tailSwipeId: snapshot?.tailSwipeId,
      tailName: snapshot?.tailName,
    }, repackedCache);
    repackedSnapshots.push(stored);
    repackedCache.set(repackedSnapshots.length - 1, cloneValue(payload));

    if (
      stored.snapshotMode !== snapshot?.snapshotMode
      || JSON.stringify(stored.stateSnapshot ?? stored.stateDelta ?? null) !== JSON.stringify(snapshot?.stateSnapshot ?? snapshot?.stateDelta ?? null)
    ) {
      changed = true;
    }
  }

  if (changed) chatState.snapshots = repackedSnapshots;
  return changed;
}

function getSnapshotRuntimeKey(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  return [
    Number.isInteger(snapshot.messageCount) ? snapshot.messageCount : 0,
    String(snapshot.messageDigest || ''),
    String(snapshot.reason || ''),
    Number(snapshot.createdAt || 0),
  ].join('|');
}

function markRestoredSnapshot(chatState, snapshot) {
  if (!chatState || typeof chatState !== 'object') return;
  Object.defineProperty(chatState, RESTORED_SNAPSHOT_RUNTIME_KEY, {
    value: getSnapshotRuntimeKey(snapshot),
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

export function restoreChatStateFromSnapshot(chatState, snapshot) {
  if (!snapshot) return;
  const snapshotIndex = findSnapshotIndex(chatState, snapshot);
  const payload = snapshotIndex >= 0
    ? materializeSnapshotPayloadAt(chatState.snapshots, snapshotIndex)
    : (snapshot?.stateSnapshot ? cloneValue(snapshot.stateSnapshot) : createEmptyChatState());
  chatState.lastAttemptedSignature = payload.lastAttemptedSignature || '';
  chatState.lastProcessedSignature = payload.lastProcessedSignature || '';
  chatState.lastRunAt = payload.lastRunAt || 0;
  chatState.sceneSummary = payload.sceneSummary || '';
  chatState.minutesPassed = payload.minutesPassed || 0;
  if (payload.skillCatalog !== undefined) chatState.skillCatalog = normalizeSkillCatalog(payload.skillCatalog);
  if (payload.nextSkillId !== undefined) chatState.nextSkillId = normalizeNextSkillId(chatState.skillCatalog, payload.nextSkillId);
  chatState.characters = unpackSnapshotCharacters(payload.characters, payload.charactersFormat || '');
  chatState.lastRawResult = payload.lastRawResult || null;
  chatState.lastOperationLogs = Array.isArray(payload.lastOperationLogs) ? payload.lastOperationLogs : [];
}

export function recordChatStateSnapshot(ctx, chatState, options = {}) {
  if (!Array.isArray(chatState.snapshots)) chatState.snapshots = [];
  const messageCount = Number.isInteger(options.messageCount)
    ? Math.max(0, options.messageCount)
    : getHostChat(ctx).length;
  const snapshot = createStoredSnapshotState(
    chatState.snapshots,
    exportChatStateSnapshotPayload(chatState),
    {
      messageCount,
      messageDigest: hasAbsoluteHostChatView(ctx) ? '' : buildMessageDigest(ctx, messageCount),
      // 前缀 digest 在 TT 稀疏视图下无法计算，边界签名两种宿主都能用
      boundarySignature: buildBoundaryMessageSignature(ctx, messageCount),
      reason: String(options.reason || 'state'),
      createdAt: Date.now(),
      anchorVersion: options.anchorVersion,
      tailMessageId: options.tailMessageId,
      tailSwipeId: options.tailSwipeId,
      tailName: options.tailName,
    },
  );
  chatState.snapshots.push(snapshot);
  trimChatStateSnapshots(chatState);
  markRestoredSnapshot(chatState, snapshot);
  return snapshot;
}

export function getLatestMatchingSnapshot(ctx, chatState, messageCount = null) {
  compactChatStateSnapshots(chatState);
  const chatLength = getHostChat(ctx).length;
  const requestedCount = Number.isInteger(messageCount)
    ? Math.max(0, Math.min(chatLength, messageCount))
    : null;
  const snapshots = Array.isArray(chatState.snapshots) ? chatState.snapshots : [];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    const count = Number.isInteger(snapshot?.messageCount) ? snapshot.messageCount : 0;
    if (requestedCount !== null) {
      if (count !== requestedCount) continue;
    } else if (count > chatLength) {
      continue;
    }
    // 长度对上还不够：边界讯息被删除或改写时，这个快照的基准已经不成立
    if (!isSnapshotBoundaryIntact(ctx, snapshot, count)) continue;
    return snapshot;
  }
  return null;
}

export function buildSignature(ctx, endIndexExclusive = null) {
  const chat = getHostChat(ctx);
  const end = Number.isInteger(endIndexExclusive) ? Math.max(0, Math.min(chat.length, endIndexExclusive)) : chat.length;
  const last = chat[end - 1];
  if (!last) return '';
  const content = String(last.mes || '');
  return [
    getChatKey(ctx),
    end,
    last.is_user ? 'user' : 'assistant',
    String(last.name || ''),
    content.length,
    hashStringFNV1a(content, MESSAGE_DIGEST_SEED).toString(16).padStart(8, '0'),
  ].join('|');
}

export function shouldTriggerForMessage(settings, lastMessage) {
  if (!lastMessage) return false;
  if (settings.triggerTiming === 'after_ai') return !lastMessage.is_user;
  if (settings.triggerTiming === 'after_user') return !!lastMessage.is_user;
  return false;
}
