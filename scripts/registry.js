import { callOpenAICompatible } from './api.js';
import { buildEmbryoTypeLorePrompt } from './embryo_prompt_context.js';
import { buildRaceCatalogBlock, buildRegistryRacePhysiologyPrompt } from './race_prompt_context.js';
import { DEFAULT_DIARY_WRITING_PROMPT, DEFAULT_REGISTRY_DESCRIPTION_GUIDES } from './registry_config.js';
import {
  buildEmptyPsychologyGroup,
  normalizePsychologyGroup,
  normalizePsychologyStageProfiles,
  PSY_STAGE_KEYS,
  PSY_MENS_FIELDS,
  PSY_MENS_BOOL_FIELDS,
  PSY_PREG_FIELDS,
  PSY_PREG_BOOL_FIELDS,
} from './registry_psy_config.js';
import {
  getEmbryoTypeByRace,
  getMergedRacePhysiologyProfile,
  getRaceComponents,
  getRaceDescriptorComponents,
  parseRaceDescriptor,
} from './race_config.js';
import {
  DEFAULT_WARDROBE_PREP_PROMPT,
  buildRecentMessages,
  createDefaultFemaleState,
  getCharacterCard,
  getGestationEffectiveSpeed,
  getGestationSpeciesSpeed,
  getCharacterWorldBookName,
  getCharacterWorldBookNameViaSTscript,
  getActiveGlobalWorldBookNames,
  getCharacterAdditionalWorldBookNames,
  getChatKey,
  getChatState,
  getPsyStressInitByLevel,
  getSettings,
  getWorldbookEntryDisplayName,
  loadCharacterAdditionalWorldBooks,
  createChildId,
  loadGlobalWorldBook,
  normalizeCharacterPsychologyState,
  recordChatStateSnapshot,
  resolveRegisteredCharacterName,
  syncCharacterStageFromProfile,
  getVitalityInitByLevel,
  saveSettings,
  worldbookSelectionMatches,
} from './state.js';
import { sanitizeFetusTagList } from './fetus_tags.js';
import { canLoadHostWorldInfo, getHostWorldBook, loadHostWorldInfo } from './host.js';
import {
  normalizeNextSkillId,
  normalizeSkillCatalog,
  normalizeSkillList,
  normalizeTalentList,
  registerSkillDefinition,
  resolveSkillDefinition,
} from './skill_config.js';

const DEBUG_LAST_REGISTRY_REQUEST_KEY = '__bs_biotracker_debug_last_registry_request__';
const DEBUG_LAST_REGISTRY_RESULT_KEY = '__bs_biotracker_debug_last_registry_result__';
const DEBUG_LAST_BREEDING_INFERENCE_REQUEST_KEY = '__bs_biotracker_debug_last_breeding_inference_request__';
const DEBUG_LAST_BREEDING_INFERENCE_RESULT_KEY = '__bs_biotracker_debug_last_breeding_inference_result__';
const ST_USER_TARGET_ALIASES = new Set(['user', '{user}', '{{user}}', '<user>']);

/**
 * 角色名输入允许直接使用 ST 的 user 宏。这个名称会成为 state 的实际 key，
 * 所以必须在推演、注册和套用的每一条入口统一解析，不能只靠 API payload 展开。
 */
export function resolveRegistryTargetName(ctx, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let resolved = raw;
  for (const method of ['substituteParamsExtended', 'substituteParams']) {
    try {
      const next = ctx?.[method]?.(raw);
      if (typeof next === 'string' && next.trim()) {
        resolved = next.trim();
        break;
      }
    } catch {}
  }
  const userName = String(ctx?.name1 || '').trim();
  if (ST_USER_TARGET_ALIASES.has(resolved.toLowerCase()) || ST_USER_TARGET_ALIASES.has(raw.toLowerCase())) {
    return userName || resolved;
  }
  return resolved;
}

function normalizeWorldbookMode(value) {
  const mode = String(value || 'exclude').trim();
  if (mode === 'mainflow' || mode === 'allowlist_all' || mode === 'exclude') return mode;
  return 'exclude';
}

async function getCharacterWorldBook(ctx) {
  const card = getCharacterCard(ctx);
  if (card?.worldBook) return card.worldBook;
  const boundWorldBookName = getCharacterWorldBookName(ctx) || await getCharacterWorldBookNameViaSTscript();
  if (boundWorldBookName && canLoadHostWorldInfo(ctx)) {
    try {
      return await loadHostWorldInfo(ctx, boundWorldBookName);
    } catch (error) {
      console.warn('[BS BioTracker] loadWorldInfo failed', error);
    }
  }
  try {
    return await getHostWorldBook(boundWorldBookName || 'Current Chat', 'character');
  } catch (error) {
    console.warn('[BS BioTracker] getCharacterWorldBook failed', error);
  }
  return null;
}

function parseRegistryWorldbookExcludeNames(settings) {
  return new Set(
    String(settings?.trackerWorldbookExcludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseRegistryWorldbookIncludeNames(settings) {
  return new Set(
    String(settings?.trackerWorldbookIncludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseRegistryGlobalWorldbookExcludeNames(settings) {
  return new Set(
    String(settings?.trackerGlobalWorldbookExcludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseRegistryGlobalWorldbookIncludeNames(settings) {
  return new Set(
    String(settings?.trackerGlobalWorldbookIncludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function formatGlobalWorldbookSelectionName(bookName, entryName) {
  return `${String(bookName || '').trim()} :: ${String(entryName || '').trim()}`;
}

function normalizeWorldbookKeywords(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function buildWorldbookActivationText(recentMessages = []) {
  return (Array.isArray(recentMessages) ? recentMessages : [])
    .map((message) => `${message?.name || ''}\n${message?.text || ''}`)
    .join('\n')
    .toLowerCase();
}

function getWorldbookEntryActivationMode(entry) {
  const mode = String(entry?.activationMode || '').trim().toLowerCase();
  if (mode) return mode;
  if (entry?.constant === true || entry?.always === true) return 'always';
  if (entry?.selective === true || normalizeWorldbookKeywords(entry?.key).length > 0 || normalizeWorldbookKeywords(entry?.keys).length > 0) return 'keyword';
  return '';
}

function worldbookKeywordMatches(entry, activationText) {
  if (!activationText) return false;
  const primaryKeys = [
    ...normalizeWorldbookKeywords(entry?.key),
    ...normalizeWorldbookKeywords(entry?.keys),
  ];
  if (primaryKeys.length === 0) return false;
  const primaryMatched = primaryKeys.some((keyword) => activationText.includes(keyword.toLowerCase()));
  if (!primaryMatched) return false;

  const secondaryKeys = [
    ...normalizeWorldbookKeywords(entry?.keysecondary),
    ...normalizeWorldbookKeywords(entry?.keySecondary),
    ...normalizeWorldbookKeywords(entry?.secondary_keys),
    ...normalizeWorldbookKeywords(entry?.secondaryKeys),
  ];
  if (entry?.selective === true && secondaryKeys.length > 0) {
    return secondaryKeys.some((keyword) => activationText.includes(keyword.toLowerCase()));
  }
  return true;
}

function filterRegistryWorldbookEntries(value, excludedNames, settings = null, recentMessages = [], options = {}) {
  if (!value || typeof value !== 'object') return value;
  const mode = normalizeWorldbookMode(settings?.trackerWorldbookMode);
  const globalBookName = String(options.globalBookName || '').trim();
  // characterScopeLists：附加知识书带书名前缀，但白名单仍走角色侧名单
  const includedNames = globalBookName && options.characterScopeLists !== true
    ? parseRegistryGlobalWorldbookIncludeNames(settings)
    : parseRegistryWorldbookIncludeNames(settings);
  const activationText = mode === 'mainflow' ? buildWorldbookActivationText(recentMessages) : '';

  const normalizeEntryName = (entry) => getWorldbookEntryDisplayName(entry);

  const keepEntry = (entry) => {
    const name = normalizeEntryName(entry);
    const selectionName = globalBookName ? formatGlobalWorldbookSelectionName(globalBookName, name) : name;
    if (mode === 'allowlist_all') return Boolean(name) && worldbookSelectionMatches(includedNames, selectionName, name);
    if (entry?.enabled === false || entry?.disable === true) return false;
    if (name && worldbookSelectionMatches(excludedNames, selectionName, name)) return false;
    if (mode === 'mainflow') {
      const activationMode = getWorldbookEntryActivationMode(entry);
      if (activationMode === 'always' || activationMode === 'constant') return true;
      if (activationMode === 'keyword' || activationMode === 'selective') return worldbookKeywordMatches(entry, activationText);
      return false;
    }
    if (!excludedNames || excludedNames.size === 0) return true;
    return true;
  };

  if (Array.isArray(value.entries)) {
    return {
      ...value,
      entries: value.entries.filter(keepEntry),
    };
  }

  if (value.entries && typeof value.entries === 'object') {
    return {
      ...value,
      entries: Object.fromEntries(
        Object.entries(value.entries).filter(([, entry]) => keepEntry(entry)),
      ),
    };
  }

  return value;
}

async function getFilteredGlobalWorldbooks(ctx, settings, recentMessages = []) {
  const boundName = String(getCharacterWorldBookName(ctx) || await getCharacterWorldBookNameViaSTscript() || '').trim();
  try {
    const names = (await getActiveGlobalWorldBookNames()).filter((name) => name !== boundName);
    const excludedNames = parseRegistryGlobalWorldbookExcludeNames(settings);
    const books = await Promise.all(names.map(async (name) => {
      try {
        const worldBook = await loadGlobalWorldBook(ctx, name);
        return filterRegistryWorldbookEntries(worldBook || null, excludedNames, settings, recentMessages, { globalBookName: name });
      } catch (error) {
        console.warn(`[BS BioTracker] load global worldbook "${name}" for registry failed`, error);
        return null;
      }
    }));
    return books.filter((book) => book && ((Array.isArray(book.entries) && book.entries.length > 0) || (book.entries && typeof book.entries === 'object' && Object.keys(book.entries).length > 0)));
  } catch (error) {
    console.warn('[BS BioTracker] load active global worldbooks for registry failed', error);
    return [];
  }
}

// 附加知识书走角色侧排除名单，条目以「书名 :: 条目名」参与匹配
async function getCharacterAdditionalWorldbooksForRegistry(ctx, settings, recentMessages = []) {
  const excludedNames = parseRegistryWorldbookExcludeNames(settings);
  return loadCharacterAdditionalWorldBooks(ctx, {
    recentMessages,
    filterBook: (worldBook, bookName, messages) => filterRegistryWorldbookEntries(
      worldBook,
      excludedNames,
      settings,
      messages,
      { globalBookName: bookName, characterScopeLists: true },
    ),
  });
}

function mergeRegistryWorldbookLists(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const book of Array.isArray(list) ? list : []) {
      if (!book || typeof book !== 'object') continue;
      const key = String(book.name || '').trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(book);
    }
  }
  return merged;
}

function recordRegistryRequestDebug(systemPrompt, payload) {
  globalThis[DEBUG_LAST_REGISTRY_REQUEST_KEY] = {
    capturedAt: Date.now(),
    systemPrompt,
    payload,
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ],
  };
}

function recordRegistryResultDebug(result, error = null) {
  globalThis[DEBUG_LAST_REGISTRY_RESULT_KEY] = {
    capturedAt: Date.now(),
    ok: !error,
    result: result ?? null,
    error: error ? String(error?.message || error) : null,
  };
}

function recordBreedingInferenceRequestDebug(systemPrompt, payload) {
  globalThis[DEBUG_LAST_BREEDING_INFERENCE_REQUEST_KEY] = {
    capturedAt: Date.now(),
    systemPrompt,
    payload,
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ],
  };
}

function recordBreedingInferenceResultDebug(result, error = null) {
  globalThis[DEBUG_LAST_BREEDING_INFERENCE_RESULT_KEY] = {
    capturedAt: Date.now(),
    ok: !error,
    result: result ?? null,
    error: error ? String(error?.message || error) : null,
  };
}

/**
 * 提示词插值防线：剥离换行、闭合标签与控制字符——注册提示词模板内插的
 * declared_race/custom_notes/user_instruction 来自用户输入，含换行或闭合标签可破坏模板行。
 * 与 race_prompt_context.sanitizePromptText 同规则。
 */
function sanitizePromptText(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/<\//g, '<\\/')
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f]/g, ' ')
    .trim();
}

export function buildBreedingInferenceSystemPrompt(settings, options = {}) {
  const targetName = String(options.targetName || '').trim();
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings?.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const breedingInferencePrompt = String(options.breedingInferencePrompt || '').trim();
  const sourceChild = options.sourceChildContext?.child || null;
  const psyMensLines = Object.entries(PSY_MENS_FIELDS).map(([key, value]) => `- mens.${key}_value: ${value.definition}`);
  const psyMensBoolLines = Object.entries(PSY_MENS_BOOL_FIELDS).map(([key, value]) => `- mens.${key}: ${value.definition}`);
  const psyPregLines = Object.entries(PSY_PREG_FIELDS).map(([key, value]) => `- preg.${key}_value: ${value.definition}`);
  const psyPregBoolLines = Object.entries(PSY_PREG_BOOL_FIELDS).map(([key, value]) => `- preg.${key}: ${value.definition}`);
  const stageKeysText = PSY_STAGE_KEYS.join(', ');
  return [
    '你是 AIRP 角色繁育推演器。',
    '你的任务不是注册角色，而是在注册前根据角色卡、世界书、最近对话与用户补充，推演该角色的繁育心理底盘。',
    targetName ? `本次唯一目标是「${targetName}」。target_character 必须逐字填写「${targetName}」，不得填写 user、角色卡名或任何其他角色。` : '',
    '繁育推演描述的是较稳定的人格、经历、认知与关系倾向，不是当下短暂情绪；不要因为角色刚害羞、刚哭、刚受伤就大幅改写长期心理轴。',
    '若资料能支持判断，必须给出数值；只有完全没有线索时才使用 null。',
    '如果角色当前未怀孕或没有明确初登场怀孕迹象，填写 mens；如果角色当前已怀孕、假孕、产兆前驱或产程中，填写 preg。mens 与 preg 二选一，另一项用 null。',
    '启用 mens 时，必须同时推演 isChaste 与 hasContraception；启用 preg 时，必须同时推演 knowsFatherSource 与 hasProfessionalPrenatalCare。',
    '数值范围为 0-100。0 是极端封闭/否认/失控，50 是普通中性，100 是极端掌控/执迷/展现。不要使用 100+，注册阶段只给 0-100 起始点。',
    declaredRace ? `用户已声明角色种族倾向：${sanitizePromptText(declaredRace)}` : '',
    sourceChild ? '本次角色来源为已出生孩子。payload.source_child 是其固定出生资料与既有天赋；必须用来判断长期人格、母子关系及成长背景，不得改写其种族或天赋。' : '',
    customNotes ? `角色补充设定：${sanitizePromptText(customNotes)}` : '',
    breedingInferencePrompt ? `额外推演提示：${sanitizePromptText(breedingInferencePrompt)}` : '',
    'mens 字段定义：',
    ...psyMensLines,
    ...psyMensBoolLines,
    'preg 字段定义：',
    ...psyPregLines,
    ...psyPregBoolLines,
    '推演准则：',
    '- mastery/cognition 主要看角色对自身生理、医学/魔法知识、经验与冷静程度。',
    '- desire 主要看角色对受孕、承接种子、繁衍使命、避孕与恐惧怀孕的长期态度。',
    '- autonomy 主要看角色在亲密关系与权力互动中的主动/被动、支配/顺从倾向。',
    '- bonding 主要看母性、责任感、对胎儿的接纳或排斥，不等同于是否喜欢伴侣。',
    '- stance 主要看角色如何处理孕妇身份的社会风险、公开程度、资源调度与身份利益。',
    '- 布林字段是当前状态判定，不属于 6x6 阶段表；必须根据角色设定、最近剧情、医疗/魔法条件与关系线索合理推断，不确定时填 false。',
    '- isChaste 代表当前保持贞洁取向、未发生性关系，或处于稳定单一性伴侣关系；若角色已有多对象关系、频繁性接触、被设定为非单伴侣，或资料无法确认单一关系，应填 false。',
    '- hasContraception 代表当前确有稳定生效中的避孕措施；不要因为角色“不想怀孕”就自动视为 true。',
    '- knowsFatherSource 代表角色能明确判断或相信胎儿父源；多对象、记忆缺口、魔法混淆或刻意隐瞒时应谨慎。',
    '- hasProfessionalPrenatalCare 代表已有持续、专业、可信的产检或等价照护；一次性的民间判断或自我猜测不算 true。',
    `- stageProfiles 必须保存 6 轴 × 6 阶段的角色专属解释。每个轴都必须包含这些阶段键：${stageKeysText}。`,
    '- stageProfiles 的六个阶段只代表数值区间：0=极低或封闭，1_25=低位倾向，26_50=中低到中性，51_75=中高位倾向，76_100=高位强化，100_plus=超常或不可逆倾向。',
    '- stageProfiles 的文字必须从角色资料重新诠释：写她在该区间会如何理解、掩饰、表达、合理化、抗拒或推进繁育相关变化。',
    '- 不要使用任何预设阶段名、模板标签、括号式总称或分级标题；每段文本必须直接进入角色专属表现。',
    '- 不要复述字段定义，不要写通用人群说明，不要把每段开头写成同一种固定句式。',
    '- 即使当前只使用 mens 或 preg，也要同时生成 mens 与 preg 全部 6 轴阶段表，供未来阶段切换后继续推演。',
    '只输出 JSON，不要输出解释文字。JSON 结构必须是：',
    '{',
    '  "target_character": "string",',
    '  "pregnancy_status": "mens|preg|unknown",',
    '  "confidence": 0,',
    '  "evidence": ["string"],',
    '  "mens": {',
    '    "mastery_value": 0,',
    '    "desire_value": 0,',
    '    "autonomy_value": 0,',
    '    "isChaste": false,',
    '    "hasContraception": false',
    '  },',
    '  "preg": {',
    '    "cognition_value": 0,',
    '    "bonding_value": 0,',
    '    "stance_value": 0,',
    '    "knowsFatherSource": false,',
    '    "hasProfessionalPrenatalCare": false',
    '  },',
    '  "stageProfiles": {',
    '    "mens": {',
    '      "mastery": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '      "desire": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '      "autonomy": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" }',
    '    },',
    '    "preg": {',
    '      "cognition": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '      "bonding": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '      "stance": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" }',
    '    }',
    '  },',
    '  "notes": "string"',
    '}',
    '如果使用 mens，preg 必须为 null；如果使用 preg，mens 必须为 null。',
  ].filter(Boolean).join('\n');
}

export function buildWardrobePrepSystemPrompt(settings, options = {}) {
  const userPrompt = String(options.wardrobePrepPrompt || settings?.wardrobePrepPrompt || '').trim();
  const mainCount = Math.max(1, Math.min(12, Math.floor(Number(options.wardrobePrepMainCount ?? settings?.wardrobePrepMainCount ?? 3) || 3)));
  const accessoryCount = Math.max(0, Math.min(12, Math.floor(Number(options.wardrobePrepAccessoryCount ?? settings?.wardrobePrepAccessoryCount ?? 3) || 0)));
  return [
    '你是 AIRP 角色衣柜备装初始化器。',
    '你只为 payload.target_character 生成衣柜 JSON，不得新增其他角色。',
    '根据角色卡、世界书、最近对话、已注册状态、normalDescription/pregnantDescription 与衣柜记录中的服装线索，推断该角色合理拥有的长期衣物与当前穿着。',
    `默认生成 ${mainCount} 套 main 主件、${accessoryCount} 件 accessory 配件；main 的计数单位是完整套装，不是单件。若用户额外提示指定更合理的数量或场景，可在接近该数量的范围内微调。`,
    '只输出 JSON，不要输出额外解释。',
    'JSON 顶层结构必须是：',
    '{',
    '  "wardrobe": { "items": [] },',
    '  "outfit": { "mainItemId": 1, "accessoryItemIds": [], "temporaryItems": [] }',
    '}',
    'wardrobe.items 只放长期衣柜，不要放系统保留的 id=0，也不要放病服、借来的外套、旅馆睡衣等临时衣物。',
    '临时衣物如确实是当前穿着，放入 outfit.temporaryItems，并让 outfit.mainItemId 或 accessoryItemIds 指向其中 id；否则 temporaryItems 输出空数组。',
    '每件衣物必须包含 id/name/note/slot/masking/support/capacity/convenience；main 主件可附 parts 数组列出组成部件名（如 ["白衬衫","牛仔裤"]，连身装可省略）；accessory 配件可附 layer（inner=贴身内衣等穿在主件之下，outer=外搭，默认 outer）。',
    'note 只写衣物稳定外观与来源：颜色、材质、版型、长短、固定开口、图案、制服/病服/借装来源等。皮肤暴露、开衩、透肤、深领等稳定外观写在 note。禁止写当前穿着反应、角色感受、近期身体变化、怀孕/胀痛/压胸/勒红/变紧/显怀等动态状态；这些由四维、pregFit 与当轮叙事推导。',
    'id 必须使用正整数，从 1 开始递增且不可重复；0 保留给全裸。name 使用中文或角色设定中的自然名称。',
    'slot 只能是 main 或 accessory。main 是可独立穿着的完整基础套装：一般必须把上衣与下着合并为同一个 main（连身裙、连体衣等一体式服装除外），name 与 note 都要同时写出上下身；不得把卫衣/T恤与牛仔裤/裙子拆成彼此互斥的多个 main，也不得把下着塞进 accessory。main 的四维按整套效果评分。accessory 才是可独立叠加在 main 上的外套、鞋履、帽子、饰品、托腹带等配件补正。',
    '可独立穿脱的外层（毛衣、开衫、外套、罩衫、披肩等罩在基础套装外面的衣物）不要并入 main 或写进 parts，应拆成 layer=outer 的 accessory，这样剧情中单独脱掉时才有机械表达；main 只保留脱掉外层后仍成立的基础层。',
    '四维数值范围 -10 到 10：masking=掩盖身体曲线、孕肚、胸腹变化的程度；support=对胸、腹、腰、重心的承托程度，高表示托得住但可能偏束，低表示松散；capacity=容许体型变化的程度；convenience=行动、穿脱、如厕、哺乳或排解需求的方便程度。',
    '主件通常使用 0 到 10；配件单项只能 -3 到 3，通常只影响 1-2 个最相关维度，其他维度必须填 0，避免把配件写成整套服装。',
    '配件例：外套可提高 masking；托腹带可提高 support 或 capacity；高跟鞋可降低 convenience；鞋履通常不应大幅提高 support，除非 note 明确是矫正/固定用途。',
    '配件中通常应包含 1-2 件 layer=inner 的贴身衣物（如内衣），其四维补正同样遵守 -3 到 3 的配件规则。',
    'outfit.mainItemId 必须是 wardrobe.items 或 outfit.temporaryItems 中 slot=main 的 id；若无法判断当前穿着，选择最日常的一件主件。',
    'outfit.accessoryItemIds 只能包含 slot=accessory 的 id；未知则空数组。',
    '[用户额外备装提示]',
    userPrompt || '无',
  ].join('\n');
}

function sanitizeWardrobePrepResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('备装推演必须返回 JSON 对象');
  const items = Array.isArray(result?.wardrobe?.items) ? result.wardrobe.items : [];
  if (items.length <= 0) throw new Error('备装推演缺少 wardrobe.items');
  const outfit = result?.outfit && typeof result.outfit === 'object' && !Array.isArray(result.outfit) ? result.outfit : null;
  if (!outfit) throw new Error('备装推演缺少 outfit');
  return {
    wardrobe: { items },
    outfit: {
      mainItemId: Number.isInteger(Number(outfit.mainItemId)) ? Number(outfit.mainItemId) : 0,
      accessoryItemIds: Array.isArray(outfit.accessoryItemIds) ? outfit.accessoryItemIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id >= 0) : [],
      temporaryItems: Array.isArray(outfit.temporaryItems) ? outfit.temporaryItems : [],
    },
  };
}

async function runBreedingInference(settings, payload, options = {}) {
  const systemPrompt = options.breedingInferenceSystemPrompt || buildBreedingInferenceSystemPrompt(settings, options);
  recordBreedingInferenceRequestDebug(systemPrompt, payload);
  try {
    const rawResult = await callOpenAICompatible(settings, payload, systemPrompt);
    const result = normalizeBreedingInferenceResult(rawResult);
    // 角色卡、最近对话中会同时出现 user 与其他人物；target_character 是 UI 的
    // 明确输入，不能把模型回传的猜测当成目标来源，否则结果会显示成 user。
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      result.target_character = String(payload?.target_character || '').trim();
    }
    const stageProfiles = normalizePsychologyStageProfiles(result?.stageProfiles);
    const missing = getMissingPsychologyStageProfileKeys(stageProfiles);
    if (missing.length > 0) {
      throw new Error(`繁育推演缺少 6x6 stageProfiles：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '...' : ''}`);
    }
    const labelLeaks = getPsychologyStageProfileLabelLeaks(stageProfiles);
    if (labelLeaks.length > 0) {
      throw new Error(`繁育推演 stageProfiles 使用了默认阶段标签，请重新诠释：${labelLeaks.slice(0, 12).join(', ')}${labelLeaks.length > 12 ? '...' : ''}`);
    }
    result.stageProfiles = stageProfiles;
    recordBreedingInferenceResultDebug(result);
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch (error) {
    recordBreedingInferenceResultDebug(null, error);
    throw error;
  }
}

export function normalizeBreedingInferenceResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const psychology = result.psychology && typeof result.psychology === 'object' && !Array.isArray(result.psychology)
    ? result.psychology
    : {};
  const profilePsychology = result.profile?.psychology && typeof result.profile.psychology === 'object' && !Array.isArray(result.profile.psychology)
    ? result.profile.psychology
    : {};
  return {
    ...result,
    ...(result.mens === undefined && (psychology.mens || profilePsychology.mens) ? { mens: psychology.mens || profilePsychology.mens } : {}),
    ...(result.preg === undefined && (psychology.preg || profilePsychology.preg) ? { preg: psychology.preg || profilePsychology.preg } : {}),
    ...(result.stageProfiles === undefined && (psychology.stageProfiles || profilePsychology.stageProfiles)
      ? { stageProfiles: psychology.stageProfiles || profilePsychology.stageProfiles }
      : {}),
  };
}

function getMissingPsychologyStageProfileKeys(stageProfiles) {
  const missing = [];
  const groups = [
    ['mens', PSY_MENS_FIELDS],
    ['preg', PSY_PREG_FIELDS],
  ];
  for (const [groupKey, fieldConfig] of groups) {
    for (const field of Object.keys(fieldConfig || {})) {
      for (const stageKey of PSY_STAGE_KEYS) {
        if (!String(stageProfiles?.[groupKey]?.[field]?.[stageKey] || '').trim()) {
          missing.push(`${groupKey}.${field}.${stageKey}`);
        }
      }
    }
  }
  return missing;
}

function getPsychologyStageProfileLabelLeaks(stageProfiles) {
  const leaks = [];
  const groups = [
    ['mens', PSY_MENS_FIELDS],
    ['preg', PSY_PREG_FIELDS],
  ];
  for (const [groupKey, fieldConfig] of groups) {
    for (const [field, config] of Object.entries(fieldConfig || {})) {
      for (const stageKey of PSY_STAGE_KEYS) {
        const label = String(config?.stages?.[stageKey]?.meaning || '').trim();
        const text = String(stageProfiles?.[groupKey]?.[field]?.[stageKey] || '').trim();
        if (!label || !text) continue;
        const normalizedText = text.replace(/^[「『“"']+/, '').trim();
        if (
          normalizedText === label
          || normalizedText.startsWith(`${label}，`)
          || normalizedText.startsWith(`${label},`)
          || normalizedText.startsWith(`${label}。`)
          || normalizedText.startsWith(`${label}：`)
          || normalizedText.startsWith(`${label}:`)
          || normalizedText.startsWith(`${label} `)
        ) {
          leaks.push(`${groupKey}.${field}.${stageKey}=${label}`);
        }
      }
    }
  }
  return leaks;
}

async function buildRegistryPayload(ctx, settings, chatState, options = {}) {
  const targetName = String(options.targetName || '').trim();
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  if (!targetName) throw new Error('runRegistry 需要 targetName');
  const currentCharacter = getCharacterCard(ctx);
  const recentMessages = buildRecentMessages(ctx, settings);
  const rawCharacterWorldBook = await getCharacterWorldBook(ctx);
  const characterWorldBook = filterRegistryWorldbookEntries(
    rawCharacterWorldBook,
    parseRegistryWorldbookExcludeNames(settings),
    settings,
    recentMessages,
  );
  const payloadWorldBook = characterWorldBook;
  const payloadGlobalWorldbooks = await getFilteredGlobalWorldbooks(ctx, settings, recentMessages);
  // 附加知识书（charLore.extraBooks）与主世界书分离，旧版只读主书会漏掉
  const payloadAdditionalWorldbooks = await getCharacterAdditionalWorldbooksForRegistry(ctx, settings, recentMessages);
  const sourceChild = options.sourceChildContext
    ? {
      mother: options.sourceChildContext.motherName,
      childIndex: options.sourceChildContext.childIndex,
      name: options.sourceChildContext.child?.name ?? null,
      fathers: options.sourceChildContext.child?.fathers ?? null,
      gender: options.sourceChildContext.child?.gender ?? null,
      race: options.sourceChildContext.child?.race ?? null,
      derivedType: options.sourceChildContext.child?.derivedType ?? null,
      age: options.sourceChildContext.child?.age ?? null,
      birthWeightRatio: options.sourceChildContext.child?.birthWeightRatio ?? null,
      birthAffinity: options.sourceChildContext.child?.birthAffinity ?? null,
      talents: normalizeTalentList(options.sourceChildContext.child?.talents).map((talent) => {
        const definition = resolveSkillDefinition(chatState.skillCatalog, talent.skillId);
        return {
          ...talent,
          name: definition?.name || `未知技能 #${talent.skillId}`,
          description: definition?.description || '',
        };
      }),
    }
    : null;
  return {
    reason: options.reason || 'manual_registry',
    chat_id: getChatKey(ctx),
    current_character: {
      ...currentCharacter,
      worldBook: payloadWorldBook,
    },
    character_description: currentCharacter.description || '',
    character_worldbook_name: payloadWorldBook ? (getCharacterWorldBookName(ctx) || null) : null,
    character_worldbook: payloadWorldBook,
    character_additional_worldbook_names: await getCharacterAdditionalWorldBookNames(ctx),
    global_worldbooks: mergeRegistryWorldbookLists(payloadGlobalWorldbooks, payloadAdditionalWorldbooks),
    target_character: targetName,
    existing_state: chatState.characters[targetName] || null,
    recent_messages: recentMessages,
    custom_notes: customNotes,
    declared_race: declaredRace || null,
    source_child: sourceChild,
    user_instruction: String(options.userInstruction || '').trim(),
  };
}

export async function runRegistryWardrobeInference(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const requestedTargetName = String(options.targetName || '').trim();
  if (!requestedTargetName) throw new Error('备装推演需要 targetName');
  const targetName = resolveRegisteredCharacterName(chatState, requestedTargetName);
  if (!targetName) throw new Error(`备装推演需要已注册角色：${requestedTargetName}`);
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const wardrobePrepPrompt = String(options.wardrobePrepPrompt || settings.wardrobePrepPrompt || '').trim();
  const wardrobePrepMainCount = Math.max(1, Math.min(12, Math.floor(Number(options.wardrobePrepMainCount ?? settings.wardrobePrepMainCount ?? 3) || 3)));
  const wardrobePrepAccessoryCount = Math.max(0, Math.min(12, Math.floor(Number(options.wardrobePrepAccessoryCount ?? settings.wardrobePrepAccessoryCount ?? 3) || 0)));
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    reason: options.reason || 'wardrobe_prep_inference',
    customNotes,
    declaredRace,
    userInstruction: wardrobePrepPrompt,
  });
  payload.wardrobe_prep_prompt = wardrobePrepPrompt;
  payload.wardrobe_prep_main_count = wardrobePrepMainCount;
  payload.wardrobe_prep_accessory_count = wardrobePrepAccessoryCount;
  payload.existing_wardrobe = chatState.characters[targetName]?.profile?.wardrobe || null;
  payload.existing_outfit = chatState.characters[targetName]?.profile?.outfit || null;
  const systemPrompt = options.wardrobePrepSystemPrompt || buildWardrobePrepSystemPrompt(settings, { ...options, wardrobePrepPrompt, wardrobePrepMainCount, wardrobePrepAccessoryCount });
  const result = await callOpenAICompatible(settings, payload, systemPrompt);
  return sanitizeWardrobePrepResult(result);
}

export async function runRegistryDiaryInference(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const requestedTargetName = String(options.targetName || '').trim();
  if (!requestedTargetName) throw new Error('日记生成需要 targetName');
  const targetName = resolveRegisteredCharacterName(chatState, requestedTargetName);
  if (!targetName) throw new Error(`日记生成需要已注册角色：${requestedTargetName}`);
  const diaryWritingPrompt = String(options.diaryWritingPrompt || settings.diaryWritingPrompt || DEFAULT_DIARY_WRITING_PROMPT).trim();
  const requestedDate = String(options.requestedDate || '').trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    reason: 'diary_inference',
    userInstruction: diaryWritingPrompt,
  });
  payload.diary_writing_prompt = diaryWritingPrompt;
  payload.requested_diary_date = requestedDate || null;
  payload.existing_character_state = chatState.characters[targetName];
  const systemPrompt = [
    '你是 AIRP 角色主观日记写作者。',
    '只为 payload.target_character 写一篇事后回顾式日记，不得替其他角色写。',
    '结合角色资料、现有状态、最近聊天与既有日记，使用第一人称，保持角色语气与认知边界。',
    '不要把日记写成即时旁白、系统总结或数值清单。',
    '严格遵守 payload.diary_writing_prompt。',
    requestedDate
      ? 'time 必须使用 payload.requested_diary_date。'
      : 'payload.requested_diary_date 为空时，请依故事上下文自行填写合适的日期标题；不要使用现实系统日期。',
    '只输出 JSON：{"time":"日期标题","content":"日记正文"}。',
  ].join('\n');
  const result = await callOpenAICompatible(settings, payload, systemPrompt);
  const time = String(result?.time || requestedDate || '').trim();
  const content = String(result?.content || '').trim();
  if (!time || !content) throw new Error('日记生成结果缺少 time 或 content');
  return { time, content };
}

export async function runRegistryBreedingInference(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const targetName = resolveRegistryTargetName(ctx, options.targetName);
  if (!targetName) throw new Error('繁育推演需要 targetName');
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  const requestedSource = options.sourceChild || null;
  const sourceChildContext = requestedSource ? resolveRegistryChildSource(chatState, requestedSource) : null;
  if (requestedSource && !sourceChildContext) throw new Error('找不到选择的孩子来源，请重新选择。');
  const declaredRace = sourceChildContext
    ? `${sourceChildContext.child.derivedType ? `[${sourceChildContext.child.derivedType}]` : ''}${String(sourceChildContext.child.race || '未知')}`
    : String(options.declaredRace || '').trim();
  const breedingInferencePrompt = String(options.breedingInferencePrompt || '').trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    reason: options.reason || 'breeding_inference',
    customNotes,
    declaredRace,
    breedingInferencePrompt,
    sourceChildContext,
    userInstruction: breedingInferencePrompt,
  });
  payload.breeding_inference_prompt = breedingInferencePrompt;
  return runBreedingInference(settings, payload, {
    ...options,
    targetName,
    customNotes,
    declaredRace,
    breedingInferencePrompt,
    sourceChildContext,
  });
}


export function buildRegistrySystemPrompt(settings, options = {}) {
  const includeBreedingPsychology = Boolean(options.includeBreedingPsychology);
  const guides = {
    ...DEFAULT_REGISTRY_DESCRIPTION_GUIDES,
    ...(settings?.registryDescriptionGuides || {}),
    ...(options.descriptionGuides || {}),
  };
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings?.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const sourceChild = options.payload?.source_child || null;
  const embryoTypeLorePrompt = buildEmbryoTypeLorePrompt(options.payload || {}, { includeAllIfEmpty: true });
  const racePhysiologyPrompt = buildRegistryRacePhysiologyPrompt(options.payload || {});
  // 注册是一次性请求，附上辨识提示帮模型在形近种族间选对（人鱼／鱼人、精灵／妖精）
  const raceCatalogPrompt = settings?.raceCatalogInPrompt === false ? '' : buildRaceCatalogBlock({ withHints: true });
  const psyMensLines = Object.entries(PSY_MENS_FIELDS).flatMap(([key, value]) => [
    `- psychology.mens.${key}_value: ${value.definition}`,
    `  阶段预览: ${value.preview}`,
  ]);
  const psyMensBoolLines = Object.entries(PSY_MENS_BOOL_FIELDS).map(([key, value]) => `- psychology.mens.${key}: ${value.definition}`);
  const psyPregLines = Object.entries(PSY_PREG_FIELDS).flatMap(([key, value]) => [
    `- psychology.preg.${key}_value: ${value.definition}`,
    `  阶段预览: ${value.preview}`,
  ]);
  const psyPregBoolLines = Object.entries(PSY_PREG_BOOL_FIELDS).map(([key, value]) => `- psychology.preg.${key}: ${value.definition}`);
  const prompt = [
    racePhysiologyPrompt,
    raceCatalogPrompt,
    '你是 AIRP 角色注册初始化器。',
    '只在用户明确要求注册指定角色时工作，不得擅自新增其他角色。',
    '根据角色卡、用户要求、已有资料，输出角色初始化 JSON。',
    sourceChild ? '本次注册来源为已有角色的孩子。payload.source_child 是固定事实：base.race 必须沿用其 race／derivedType；其 talents 会由系统确定性继承。你只能参考这些天赋塑造初始化内容，不得删除、改名、换向或重算天赋。' : '',
    includeBreedingPsychology
      ? 'payload.breeding_inference 是已确认的繁育推演。必须优先把它当作繁育心理初稿，再结合角色资料校正，不要无故忽略。'
      : '本次未启用繁育心理推演：不要输出、补全或推断任何繁育阶段人格字段，保留角色卡原有的阶段人设与表现。',
    '你只需要填写角色注册时真正需要声明的内容，不需要补充其他无关信息。',
    '不要扩写额外分类，不要发散到注册步骤之外的内容。',
    '你只需要填写以下声明内容：',
    '1. 角色基础注册：base.age、base.race、base.vitalityLevel、base.psyStressLevel、base.libido、base.uterinePressure、base.latestSexDays、base.sperms、metabolism',
    '2. 情感与妊娠经验：experience',
    ...(includeBreedingPsychology ? ['3. 繁育心理：psychology.mens 或 psychology.preg（二选一，互斥）'] : []),
    '4. 既有孩子记录：children',
    '5. 初登场即怀孕：pregnant.pregnantDays、pregnant.fetusesCount、pregnant.fetuses',
    '6. 文字描述栏位：descriptions',
    '如果资料不足，可以省略字段或给 null；不要为了凑完整而编造。',
    embryoTypeLorePrompt,
    '以下字段定义、参数说明、注意事项与示例，均视为必要规则：',
    '【1. 角色基础注册】',
    '参数说明：',
    `- base.race: 纯种/混血/衍生种族/子类物种，保留原始写法，若故事为现代写实，种族统一填人类即可${declaredRace ? `。【重要】用户已明确指定，必须强制填写為：${declaredRace}` : ''}`,
    '- base.vitalityLevel: 1-7，默认语义为 一推就倒(1)-身怀病弱(2)-难产体态(3)-均衡活力(4)-安产体态(5)-经过锻炼(6)-无坚不摧(7)',
    '- base.psyStressLevel: 1-7，默认语义为 情感丧失麻木不仁(1)-内向压抑冷感(2)-情绪平缓理性(3)-情绪均衡稳定(4)-情绪丰富敏感(5)-强烈波动焦躁(6)-极端情绪精神异常(7)',
    '- base.age: 角色年龄',
    '- base.libido: 初始性欲。非妊娠上限100；妊娠後会随孕期提升，临产最后一天上限可达150。若角色开场就在发情、催情、强欲状态，可给较高值。',
    '- base.uterinePressure: 初始宫压。非妊娠上限50；妊娠後会随进度平滑提升，臨產期上限达150。【危险警告】孕早期与孕中期前期上限极低，超过15便极易触发流产警告！除非开局正在临盆或剧烈腹痛，否则强烈建议填 0。',
    '- base.latestSexDays: 距最近一次性行为经过的天数。若 experience.latestSexPartner 有意义，建议一并填写；若已超过最近一月经周期或无从判断，可为 null。',
    '- base.sperms: 体内残留精液来源列表。适用于刚性交结束、仍有精液残留的开局；每项包含 male、race、value，value 建议 10-30（每天自动衰减 10）。race 可直接写 [衍生]种族，系统会自动拆出 derivedType。',
    '- metabolism: 初始需求状态。普通种族上限皆為150，包含 excretion、hunger、sleep、milk、odor、companionship，分别表示泄意、饿意、困意、乳意、臭意、伴意；excretion（泄意）同时包含排尿与排便需求；milk 在普通周期表示乳房胀敏或周期不适，在妊娠、假孕或产后恢复阶段也可表示泌乳需求。',
    '- 若 base.derivedType 不为 null，则 metabolism 可填写 flux（范围 -150 到 150），并保留该衍生类型未抵免的普通需求。flux 是衍生种族专用的单一极性需求值：正值与负值分别代表两种相反的释放需求，绝对值越高需求越强。',
    '- pregnant.nutrition 是妊娠供养力盈余/赤字，专注参与胎儿体重/供养结算，不作为 metabolism 排解阻塞来源。',
    '注意：vitalityLevel 与 psyStressLevel 是角色内在特质等级，不根据当前疲劳、刚哭过、当下崩溃等暂时状态调整。',
    '注意：base.vitality 与 base.psyStress 不由你直接填写，系统会根据 vitalityLevel 与 psyStressLevel 自动计算初始值。',
    '示例：',
    '- 人类少女: {"base":{"race":"人类","vitalityLevel":4,"psyStressLevel":4,"age":18,"libido":12,"uterinePressure":0}}',
    '- 混血: {"base":{"race":"天使x恶魔","vitalityLevel":5,"psyStressLevel":3,"age":25,"libido":35,"uterinePressure":3}}',
    '- 衍生种族: {"base":{"race":"[血族]人类","vitalityLevel":2,"psyStressLevel":5,"age":150,"libido":28,"uterinePressure":0}}',
    '- 子类物种: {"base":{"race":"鱼人-鲸族","vitalityLevel":6,"psyStressLevel":2,"age":30,"libido":20,"uterinePressure":0}}',
    '- 复杂种族: {"base":{"race":"[不死-僵尸]兽耳族-九尾狐","vitalityLevel":7,"psyStressLevel":1,"age":1000,"libido":60,"uterinePressure":20}}',
    '【2. 情感与妊娠经验】',
    '参数说明：',
    '- virginity: 初次性对象名称，处女时为 null',
    '- latestSexPartner: 最新性对象，仅在最近一月经周期(ex: 人类28天)内仍有意义，否则可为 null',
    '- 若填写 latestSexPartner，最好同时填写 base.latestSexDays，表示距离最近一次性行为过去了几天',
    '- emotionalMate: 情感对象，无则 null',
    '- marriageMate: 婚姻对象，无则 null',
    '- pregnantExperience: 怀孕经验次数',
    '- naturalBirthExperience: 自然产经验次数',
    '- surgicalBirthExperience: 手术产经验次数',
    '- miscarriageExperience: 流产/堕胎次数',
    '示例：',
    '- 高中女生: {"experience":{"virginity":"前男友","emotionalMate":"{{user_name}}","pregnantExperience":0}}',
    '- 魅魔女仆: {"experience":{"virginity":"前任主人","emotionalMate":null,"pregnantExperience":5,"naturalBirthExperience":3,"surgicalBirthExperience":0,"miscarriageExperience":2}}',
    '- 守贞人妻: {"experience":{"virginity":"丈夫","latestSexPartner":"丈夫","emotionalMate":"丈夫","marriageMate":"丈夫","pregnantExperience":3,"naturalBirthExperience":0,"surgicalBirthExperience":2,"miscarriageExperience":0}}',
    '- 刚做爱开局: {"base":{"latestSexDays":0,"sperms":[{"male":"丈夫","race":"[不死-僵尸]人类","value":30}]},"experience":{"latestSexPartner":"丈夫"}}',
    '【3. 繁育心理】',
    '参数说明：',
    '- 若 payload.breeding_inference 存在，先采用其中对应 mens 或 preg 的数值作为心理起始点；只有当角色资料与繁育推演明显冲突时才调整。',
    '- 若 payload.breeding_inference.stageProfiles 存在，必须原样写入 profile.psychology.stageProfiles，除非需要修正明显错误或空缺。',
    '- 繁育心理是角色长期繁育人格底盘，不是临时情绪。注册时应让它能支撑后续 bsUpdatePsychology 的小幅推演。',
    '- 非怀孕角色只填写 psychology.mens，包含 mastery_value、mastery_interpret、desire_value、desire_interpret、autonomy_value、autonomy_interpret，以及 isChaste、hasContraception。',
    '- 怀孕角色只填写 psychology.preg，包含 cognition_value、cognition_interpret、bonding_value、bonding_interpret、stance_value、stance_interpret，以及 knowsFatherSource、hasProfessionalPrenatalCare。',
    '- psychology.mens 与 psychology.preg 互斥，不要同时填写。',
    '- 你主要填写 *_value，数值范围为 0-100；*_interpret 可省略，系统会按阶段自动补全。布林旗标只填 true/false。',
    '- psychology.stageProfiles 用来保存该角色专属 6 轴 × 6 阶段解释。结构为 psychology.stageProfiles.mens.{mastery,desire,autonomy}.{0,1_25,26_50,51_75,76_100,100_plus} 与 psychology.stageProfiles.preg.{cognition,bonding,stance}.{0,1_25,26_50,51_75,76_100,100_plus}。',
    '非怀孕使用以下定义与阶段预览：',
    ...psyMensLines,
    ...psyMensBoolLines,
    '怀孕使用以下定义与阶段预览：',
    ...psyPregLines,
    ...psyPregBoolLines,
    '示例：',
    '- 非怀孕: {"psychology":{"mens":{"mastery_value":62,"desire_value":38,"autonomy_value":71,"isChaste":true,"hasContraception":true}}}',
    '- 怀孕: {"psychology":{"preg":{"cognition_value":58,"bonding_value":84,"stance_value":47,"knowsFatherSource":true,"hasProfessionalPrenatalCare":false}}}',
    '【4. 既有孩子记录】',
    '参数说明：每个孩子对象包含 name、fathers、gender、race、age。',
    '示例：',
    '- [{"name":"冬月 露花","fathers":"前夫","gender":"女","race":"人类","age":5}]',
    '【5. 初登场即怀孕】',
    '参数说明：',
    '- pregnant.pregnantDays: 这次妊娠的孕龄天数，等同产科从末次月经/本族等价周期起点计算的孕周天数；若资料写“孕8周/怀孕8周”填 56，若明确写“受孕后8周/胚胎发育8周”，需再加上本族等价排卵前偏移。',
    '- 不要填写 pregnant.effectivePregnantDays；系统会依据孕龄、角色种族妊娠速度与 bio.gestationModifierMultiplier 自动换算有效妊娠天数。',
    '- pregnant.fetusesCount: 这次怀孕的怀胎数',
    '- pregnant.fetuses: 每个胎儿包含 fathers、provider、race、gender、embryoType；也可填写 weight、tendencyAngle、affinity',
    '- 胎儿可带 tags 标注特殊来历，只接受这几个：identical（同卵）、superfetation（异期复孕）、nested（孕中孕）、rebirth（胎内回归）。代孕不必标——给了 provider 就会自动识别。写不出对应支撑栏位的标签会被撤销，宁可不标也不要留一个指向虚空的关系。',
    '- identical：同卵的几胎都标上即可，系统会自动把它们归为同一组；只标一胎会被撤销。',
    '- superfetation：必须一并给 conceivedAtDays（这一胎受精时，母体已经怀了多少有效孕日），会被夹进这次妊娠的范围内。它比同腹其他胎儿晚受精、发育落后。',
    '- nested：这一胎长在另一颗胎儿体内。除了 conceivedAtDays，还要给 nestedInIndex＝宿主在 fetuses 阵列里的下标（从 0 起算，不能指自己）。它的母亲是那颗胎儿，出生后承载者会同时生下女儿与外孙。',
    '- rebirth：一名已出生的角色回到子宫里成为这一胎，fathers 写那个人的名字（可以是 user）。适合「开场就已经在角色子宫里」的设定。产出后是全新个体，与原来那个人不是同一笔资料。',
    '- revealed：这一胎角色本人知不知道。省略时系统按孕龄自动判定（异期复孕进孕中期才知道、孕中孕要到孕晚期）；想让角色暂时不知情就明确给 false。',
    '- provider: 代孕母方、寄生等提供者名称，正常情况下为 null',
    '- weight: 胎儿体重/发育量倍率，范围 0.33-3.0；不确定可省略，系统会补 1.0',
    '- tendencyAngle: 胎位/趋向角度，范围 0-360；不确定可省略，系统会随机补值。角度映射必须固定为：0/360=正常头位/正位，180=完全臀位/倒位，90或270=横位；不要把 180 写成头位',
    '- affinity: 胎儿对母体的亲和/排斥倾向，范围 -50 到 50；正值亲和，负值排斥，不确定可省略',
    '示例：',
    '- 人类怀单胎8周，正常头位示例: {"pregnant":{"pregnantDays":56,"fetusesCount":1,"fetuses":[{"fathers":"丈夫","provider":null,"race":"人类","gender":"男","embryoType":"胎生","weight":1.0,"tendencyAngle":0,"affinity":10}]}}',
    '- 精灵怀孕500天: {"base":{"race":"精灵"},"pregnant":{"pregnantDays":500,"fetusesCount":1,"fetuses":[{"fathers":"伴侣","provider":null,"race":"精灵","gender":"女","embryoType":"胎生"}]}}',
    '- 妖怪猫又怀双胎20周: {"pregnant":{"pregnantDays":140,"fetusesCount":2,"fetuses":[{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"},{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"}]}}',
    '- 代孕情节: {"pregnant":{"pregnantDays":84,"fetusesCount":1,"fetuses":[{"fathers":"委托人","provider":"代孕者A","race":"人类","gender":"女","embryoType":"胎生"}]}}',
    '【5.1 妊娠變速类补充设定（仅在存在特殊变速效果时填写 bio）】',
    '参数说明：',
    '- bio.gestationModifierMultiplier: 特殊妊娠速度修正倍率。大于 1 为加速，小于 1 为减速，0 为冻结；初始怀孕仍只填 pregnant.pregnantDays（孕龄），系统会用倍率换算 effectivePregnantDays。',
    '- bio.gestationModifierName: 该倍率效果的名称，例如祝福、诅咒、体质、术式。',
    '- bio.gestationModifierDescription: 对该倍率来源与表现的简短说明。',
    '- 这组 bio 字段是可选的特殊效果，不是一般妊娠的必填资料。普通人类孕妇、常规妊娠、种族原生孕期速度都不要填写。',
    '- 禁止用 bio 填写 gestationModifierMultiplier=1 的默认占位内容，例如「常规妊娠」「标准人类妊娠生理周期」；没有特殊变速效果就整个省略 bio。',
    '- 仅当资料明确存在持续生效且倍率不为 1 的祝福、诅咒、体质、术式、冻结或延长效果时填写；未怀孕角色也可保留此类明确效果。',
    '示例：',
    '- 被祝福的冒险者妊娠加快: {"bio":{"gestationModifierMultiplier":1.5,"gestationModifierName":"丰饶祝福","gestationModifierDescription":"受女神祝福后，妊娠期间胎儿发育明显加快，孕期反应也会更早显现。"}}',
    '- 红尘之力导致孕期极端延长，即使当前未怀孕也应保留: {"bio":{"gestationModifierMultiplier":0.001,"gestationModifierName":"红尘织命","gestationModifierDescription":"受红尘之力影响，若进入妊娠，孕期推进速度仅为常规人类的千分之一，整体妊娠期会被极度拉长。"}}',
    '【6. 文字描述栏位】',
    '参数说明：descriptions 包含 normalDescription、pregnantDescription。',
    'normalDescription 与 pregnantDescription 必须使用旧版格式：字段名|描述内容;;字段名|描述内容;;...字段名|描述内容;;。',
    '只能用 | 分隔字段名与描述内容，只能用 ;; 分隔字段；每个字段都要保留字段名，结尾也要补 ;;。',
    '不要改成自然段、不要换行、不要写成纯长文。',
    '示例：状态|处于饥饿与寒冷的边缘，精神高度焦虑且带有防御性;;表情|戴着苍白口罩，眼神涣散且带病态妆容;;行动|蜷缩在自动贩卖机旁躲雨，机械地刷手机;;',
    '以下规则文本由用户自定义，注册时应严格遵守。',
    '[normalDescription]',
    String(guides.normalDescription || DEFAULT_REGISTRY_DESCRIPTION_GUIDES.normalDescription),
    '[pregnantDescription]',
    String(guides.pregnantDescription || DEFAULT_REGISTRY_DESCRIPTION_GUIDES.pregnantDescription),
    `【${includeBreedingPsychology ? 7 : 6}. 角色补充设定】`,
    customNotes ? customNotes : '无',
    '若提供了角色补充设定，必须优先视为该角色已明确声明的特征，并在推演、注册与备装相关字段中如实体现；不要忽略，也不要擅自扩写超出原意的内容。',
    '若角色补充设定明确描述的是一种未来也会持续生效、且倍率不为 1 的妊娠体质、祝福、诅咒、冻结或延长效果，即使角色当前未怀孕，也必须写入 bio.gestationModifierMultiplier、bio.gestationModifierName、bio.gestationModifierDescription；普通妊娠不得补写 bio。',
    '注意：未怀孕角色不要硬填 pregnantDescription；描述内容应遵守旧系统文字栏位语义，不要换行。',
    '只输出 JSON，不要输出额外解释。',
    '【name】必须原样填写 payload.target_character，一字不差。那是用户指定要注册的角色名；即使它与角色卡名不同，也不得改用角色卡名、别名或称谓。',
    'JSON 结构必须是：',
    '{',
    '  "name": "string",',
    '  "profile": {',
    '    "base": {',
    '      "age": 0,',
    '      "race": "string",',
    '      "libido": 0,',
    '      "uterinePressure": 0,',
    '      "latestSexDays": 0,',
    '      "sperms": [],',
    '      "vitalityLevel": 4,',
    '      "psyStressLevel": 4',
    '    },',
    '    "pregnant": {',
    '      "pregnantDays": 0,',
    '      "fetusesCount": 0,',
    '      "fetuses": [',
    '        {',
    '          "fathers": "string|null",',
    '          "provider": "string|null",',
    '          "race": "string|null",',
    '          "gender": "string|null",',
    '          "embryoType": "string|null",',
    '          "weight": 1.0,',
    '          "tendencyAngle": 0,',
    '          "affinity": 0',
    '        }',
    '      ]',
    '    },',
    '    "experience": {',
    '      "virginity": "string|null",',
    '      "latestSexPartner": "string|null",',
    '      "emotionalMate": "string|null",',
    '      "marriageMate": "string|null",',
    '      "pregnantExperience": 0,',
    '      "naturalBirthExperience": 0,',
    '      "surgicalBirthExperience": 0,',
    '      "miscarriageExperience": 0',
    '    },',
    '    "psychology": {',
    '      "mens": {',
    '        "mastery_value": 0,',
    '        "mastery_interpret": "string",',
    '        "desire_value": 0,',
    '        "desire_interpret": "string",',
    '        "autonomy_value": 0,',
    '        "autonomy_interpret": "string",',
    '        "isChaste": false,',
    '        "hasContraception": false',
    '      },',
    '      "preg": {',
    '        "cognition_value": 0,',
    '        "cognition_interpret": "string",',
    '        "bonding_value": 0,',
    '        "bonding_interpret": "string",',
    '        "stance_value": 0,',
    '        "stance_interpret": "string",',
    '        "knowsFatherSource": false,',
    '        "hasProfessionalPrenatalCare": false',
    '      },',
    '      "stageProfiles": {',
    '        "mens": {',
    '          "mastery": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '          "desire": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '          "autonomy": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" }',
    '        },',
    '        "preg": {',
    '          "cognition": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '          "bonding": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" },',
    '          "stance": { "0": "string", "1_25": "string", "26_50": "string", "51_75": "string", "76_100": "string", "100_plus": "string" }',
    '        }',
    '      }',
    '    },',
    '    "metabolism": {',
    '      "excretion": 0,',
    '      "hunger": 0,',
    '      "sleep": 0,',
    '      "milk": 0,',
    '      "odor": 0,',
    '      "companionship": 0',
    '    },',
    '    "children": [],',
    '    "descriptions": {',
    '      "normalDescription": "string",',
    '      "pregnantDescription": "string"',
    '    }',
    '  }',
    '}',
    '允许省略不确定或不适用的声明字段，但不要编造系统字段。',
    '如果角色不是孕妇，pregnant 使用默认空结构或省略。',
    '如果角色没有孩子，children 返回 [] 或省略。',
    '如果角色没有明确经验背景，experience 只填能确定的部分。',
  ].join('\n');
  if (includeBreedingPsychology) return prompt;
  return prompt
    .replace(/【3\. 繁育心理】[\s\S]*?(?=【4\. 既有孩子记录】)/, '')
    .replace(/\n\s*"psychology": \{[\s\S]*?\n\s*\},\n\s*"metabolism": \{/, '\n    "metabolism": {')
    .replace('4. 既有孩子记录：children', '3. 既有孩子记录：children')
    .replace('5. 初登场即怀孕：', '4. 初登场即怀孕：')
    .replace('6. 文字描述栏位：descriptions', '5. 文字描述栏位：descriptions')
    .replace('【4. 既有孩子记录】', '【3. 既有孩子记录】')
    .replace('【5. 初登场即怀孕】', '【4. 初登场即怀孕】')
    .replace('【5.1 妊娠變速类补充设定', '【4.1 妊娠變速类补充设定')
    .replace('【6. 文字描述栏位】', '【5. 文字描述栏位】');
}

const EXPERIENCE_FIELDS = [
  'virginity',
  'latestSexPartner',
  'emotionalMate',
  'marriageMate',
  'pregnantExperience',
  'naturalBirthExperience',
  'surgicalBirthExperience',
  'miscarriageExperience',
];

const DESCRIPTION_FIELDS = ['normalDescription', 'pregnantDescription'];
const METABOLISM_FIELDS = ['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship', 'flux'];

function clampNumber(value, min, max, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function randomInt(min, max) {
  const nextMin = Math.ceil(min);
  const nextMax = Math.floor(max);
  return Math.floor(Math.random() * (nextMax - nextMin + 1)) + nextMin;
}

function getRegistryMenstrualCycleLength(profile) {
  const ratio = clampNumber(profile?.bio?.menstrualLengthRatio, 0.1, 20, 1);
  return Math.max(1, Math.round(28 * ratio));
}

function pickObjectFields(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of allowedFields) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

function sanitizeChildren(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const parsed = parseRaceDescriptor(item.race);
      return {
        name: item.name ?? item.babyName ?? null,
        fathers: item.fathers ?? null,
        provider: item.provider ?? null,
        // 多母源/嵌合体的来源字段必须原样保留，否则手动转交会失去归属依据
        providerSources: Array.isArray(item.providerSources)
          ? [...item.providerSources]
          : (item.provider ? String(item.provider).split(/\s*[×Xx]\s*/).map((part) => part.trim()).filter(Boolean) : undefined),
        chimera: item.chimera && typeof item.chimera === 'object' && !Array.isArray(item.chimera)
          ? {
            ...item.chimera,
            fatherSources: Array.isArray(item.chimera.fatherSources) ? [...item.chimera.fatherSources] : item.chimera.fatherSources,
            maternalSources: Array.isArray(item.chimera.maternalSources) ? [...item.chimera.maternalSources] : item.chimera.maternalSources,
            genderSources: Array.isArray(item.chimera.genderSources) ? [...item.chimera.genderSources] : item.chimera.genderSources,
          }
          : undefined,
        gender: item.gender ?? null,
        race: parsed.race || null,
        derivedType: item.derivedType ?? parsed.derivedType ?? null,
        fatherRace: item.fatherRace ?? null,
        fatherDerivedType: item.fatherDerivedType ?? null,
        age: item.age ?? null,
        birthWeightRatio: Number.isFinite(Number(item.birthWeightRatio)) ? clampNumber(item.birthWeightRatio, 0.33, 3.0, 1.0) : null,
        birthAffinity: Number.isFinite(Number(item.birthAffinity)) ? clampNumber(item.birthAffinity, -50, 50, 0) : null,
        id: item.id ?? createChildId(),
        registeredAs: item.registeredAs ?? null,
        talents: normalizeTalentList(item.talents ?? item.inheritedTalents),
      };
    });
}

function sanitizeRegistrySperms(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const parsed = parseRaceDescriptor(item.race);
      const derivedTypeRaw = item.derivedType === undefined ? parsed.derivedType : item.derivedType;
      return {
        male: item.male === null ? null : String(item.male || '').trim() || null,
        race: parsed.race || null,
        derivedType: derivedTypeRaw === null ? null : String(derivedTypeRaw || '').trim() || null,
        value: clampNumber(item.value, 0, 9999, 0),
      };
    })
    .filter((item) => item.male && item.race && item.value > 0);
}

function sanitizePregnant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fetuses = Array.isArray(value.fetuses)
    ? value.fetuses
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const parsed = parseRaceDescriptor(item.race);
        // race 是胎儿的完整种族（父系x母系，或纯种），模型按提示词示例填写。
        // fatherRace 只在模型显式给出时保留；缺失时置 null，normalize 会原样信任 race，
        // 否则代孕/移植胚胎会被硬塞进承载者的血统。
        const explicitFatherRace = item.fatherRace !== undefined && item.fatherRace !== null
          ? parseRaceDescriptor(item.fatherRace).race || null
          : null;
        return {
          fathers: item.fathers ?? null,
          provider: item.provider ?? null,
          race: parsed.race || null,
          fatherRace: explicitFatherRace,
          fatherDerivedType: item.fatherDerivedType ?? parsed.derivedType ?? null,
          gender: item.gender ?? null,
          embryoType: item.embryoType ?? null,
          maternalDerivedTypeProgress: Number.isFinite(Number(item.maternalDerivedTypeProgress)) ? clampNumber(item.maternalDerivedTypeProgress, -100, 100, 0) : undefined,
          weight: Number.isFinite(Number(item.weight)) ? clampNumber(item.weight, 0.33, 3.0, 1.0) : undefined,
          tendencyAngle: Number.isFinite(Number(item.tendencyAngle)) ? clampNumber(item.tendencyAngle, 0, 360, 0) : undefined,
          affinity: Number.isFinite(Number(item.affinity)) ? clampNumber(item.affinity, -50, 50, 0) : undefined,
          // 特殊来历：让角色卡开场就能是同卵双胞胎、异期复孕、孕中孕或胎内回归。
          // 只放行目录内的标签，支撑栏位在 normalizeRegisteredFetusTags 里对齐。
          tags: sanitizeFetusTagList(item.tags),
          conceivedAtDays: Number.isFinite(Number(item.conceivedAtDays)) ? Number(item.conceivedAtDays) : undefined,
          identicalGroup: Number.isFinite(Number(item.identicalGroup)) ? Math.floor(Number(item.identicalGroup)) : undefined,
          nestedInIndex: Number.isFinite(Number(item.nestedInIndex)) ? Math.floor(Number(item.nestedInIndex)) : undefined,
          revealed: item.revealed === undefined ? undefined : Boolean(item.revealed),
          talents: normalizeTalentList(item.talents ?? item.inheritedTalents),
        };
      })
    : [];
  return {
    pregnantDays: Number.isFinite(Number(value.pregnantDays)) ? Number(value.pregnantDays) : 0,
    fetusesCount: Number.isFinite(Number(value.fetusesCount)) ? Number(value.fetusesCount) : fetuses.length,
    fetuses,
  };
}

function sanitizeRegistryBio(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const multiplier = Number(value.gestationModifierMultiplier);
  if (!Number.isFinite(multiplier)) return null;
  const normalizedMultiplier = clampNumber(multiplier, 0, 20, 1);
  if (Math.abs(normalizedMultiplier - 1) <= 0.000001) return null;
  return {
    gestationModifierMultiplier: normalizedMultiplier,
    gestationModifierName: value.gestationModifierName === null ? '' : String(value.gestationModifierName || '').trim(),
    gestationModifierDescription: value.gestationModifierDescription === null ? '' : String(value.gestationModifierDescription || '').trim(),
  };
}

function sanitizeDiaryEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      time: String(item.time || '').trim(),
      content: String(item.content || '').trim(),
    }))
    .filter((item) => item.time && item.content);
}

function getRegistryEmbryoTypeRecoveryCoefficient(embryoType) {
  switch (String(embryoType || '胎生')) {
    case '卵生':
      return 0.6;
    case '卵胎生':
      return 0.4;
    case '胎转卵生':
      return 1.0;
    case '不定型':
      return 0.8;
    case '胎生':
    default:
      return 0.2;
  }
}

function deriveRegisteredFetusRace(motherRace, fatherRace) {
  const motherParts = getRaceDescriptorComponents(motherRace);
  const fatherParts = getRaceDescriptorComponents(fatherRace);
  const combined = [...fatherParts, ...motherParts].filter(Boolean);
  if (combined.length === 0) return '人类';
  const unique = [];
  for (const part of combined) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join('x');
}

/**
 * 把注册时给的特殊胎儿标签整理成自洽状态。
 *
 * 让模型直接写 tags 是有意的——「开场就已经在角色子宫里」这类设定没有别的表达方式。
 * 代价是它可能写出自相矛盾的组合，所以这里逐项对齐：落单的同卵会被撤掉标签、
 * 指不到宿主的孕中孕会被撤掉标签、异期复孕的受精点会被夹进合法范围。
 * 宁可少一个标签，也不要留一个指向虚空的关系。
 */
function normalizeRegisteredFetusTags(pregnant) {
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return;

  fetuses.forEach((fetus, index) => {
    if (!Number.isInteger(Number(fetus.embryoId)) || Number(fetus.embryoId) <= 0) fetus.embryoId = index + 1;
    fetus.tags = sanitizeFetusTagList(fetus.tags);
  });

  // 孕中孕：模型给的是阵列索引（它写不出内部编号），换成宿主的 embryoId
  for (const [index, fetus] of fetuses.entries()) {
    const target = Number(fetus.nestedInIndex);
    delete fetus.nestedInIndex;
    const valid = Number.isInteger(target) && target >= 0 && target < fetuses.length && target !== index;
    if (valid) fetus.nestedInEmbryoId = fetuses[target].embryoId;
    if (!fetus.nestedInEmbryoId) fetus.tags = fetus.tags.filter((tag) => tag !== 'nested');
  }
  // 宿主自己也是被套的那颗时整条链不成立，一起撤掉
  for (const fetus of fetuses) {
    if (!fetus.nestedInEmbryoId) continue;
    const host = fetuses.find((item) => item.embryoId === fetus.nestedInEmbryoId);
    if (!host || host.nestedInEmbryoId) {
      delete fetus.nestedInEmbryoId;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'nested');
    }
  }

  // 同卵：标了却没给组别时自动分同一组；组内只有自己的撤掉标签
  const lonely = fetuses.filter((fetus) => fetus.tags.includes('identical') && !fetus.identicalGroup);
  if (lonely.length >= 2) for (const fetus of lonely) fetus.identicalGroup = lonely[0].embryoId;
  for (const fetus of fetuses) {
    const group = Number(fetus.identicalGroup);
    const mates = group ? fetuses.filter((item) => Number(item.identicalGroup) === group) : [];
    if (mates.length >= 2) {
      if (!fetus.tags.includes('identical')) fetus.tags = sanitizeFetusTagList([...fetus.tags, 'identical']);
    } else {
      delete fetus.identicalGroup;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'identical');
    }
  }

  // 异期复孕：受精点必须落在这次妊娠之内，且与标签互相对齐
  const effectiveDays = Math.max(0, Number(pregnant.effectivePregnantDays) || 0);
  for (const fetus of fetuses) {
    const conceivedAt = Number(fetus.conceivedAtDays);
    if (Number.isFinite(conceivedAt) && conceivedAt > 0) {
      fetus.conceivedAtDays = Math.min(Math.max(conceivedAt, 0), Math.max(effectiveDays - 1, 0));
      fetus.tags = sanitizeFetusTagList([...fetus.tags, 'superfetation']);
    } else {
      delete fetus.conceivedAtDays;
      fetus.tags = fetus.tags.filter((tag) => tag !== 'superfetation' && tag !== 'nested');
      delete fetus.nestedInEmbryoId;
    }
  }

  // 模型没说藏不藏时，照运行期的规则判定：一般异期胎进孕中期揭晓，孕中孕要到孕晚期
  for (const fetus of fetuses) {
    if (!fetus.conceivedAtDays) { delete fetus.revealed; continue; }
    if (fetus.revealed === undefined) {
      const threshold = fetus.nestedInEmbryoId ? 189 : 84;
      fetus.revealed = effectiveDays >= threshold;
    }
    if (!fetus.revealed) delete fetus.revealed;
  }

  for (const fetus of fetuses) if (fetus.tags.length === 0) delete fetus.tags;
}

function normalizeRegisteredPregnancy(profile) {
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((item) => ({ ...item })) : [];
  if (fetuses.length === 0) return;
  const motherRace = parseRaceDescriptor(profile?.base?.race || '人类').race || '人类';

  pregnant.fetuses = fetuses.map((fetus) => {
    // 只有显式给出父系时才按「父系x母系」重算；否则信任 race 原样，
    // 避免把已完整的胎儿种族再跟承载者混一次（代孕/移植胚胎会因此被改血统）
    const explicitFatherRace = parseRaceDescriptor(fetus?.fatherRace || '').race || null;
    const fatherRace = explicitFatherRace;
    const fetusRace = explicitFatherRace
      ? (explicitFatherRace === motherRace ? motherRace : deriveRegisteredFetusRace(motherRace, explicitFatherRace))
      : (fetus?.race ? parseRaceDescriptor(fetus.race).race || motherRace : motherRace);
    return {
      ...fetus,
      race: fetusRace,
      fatherRace,
      embryoType: fetus?.embryoType || getEmbryoTypeByRace(fetusRace),
      weight: Number.isFinite(Number(fetus?.weight)) ? clampNumber(fetus.weight, 0.33, 3.0, 1.0) : 1.0,
      tendencyAngle: Number.isFinite(Number(fetus?.tendencyAngle)) ? clampNumber(fetus.tendencyAngle, 0, 360, 0) : randomInt(0, 360),
      affinity: Number.isFinite(Number(fetus?.affinity)) ? clampNumber(fetus.affinity, -50, 50, 0) : 0,
    };
  });
  pregnant.fetusesCount = pregnant.fetuses.length;
  pregnant.pregnantDays = Math.max(1, Math.floor(Number(pregnant.pregnantDays) || 1));
  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0.1, 20, 1.0);
  pregnant.effectivePregnantDays = Math.max(1, pregnant.pregnantDays * gestationSpeed);
  pregnant.amnionDurability = 100;
  // 必须排在 effectivePregnantDays 算出来之后：受精点要夹进这次妊娠的范围，
  // 揭晓与否也要拿它跟门槛比
  normalizeRegisteredFetusTags(pregnant);

  const bio = profile.bio || {};
  const motherBreedTolerance = clampNumber(bio.breedTolerance, 0.1, 100, 1.0);
  pregnant.fetalEnergyDrain = pregnant.fetuses.reduce((sum, fetus) => {
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    // 与运行期一致：异期胎用自己的孕龄，不按先来者的进度算负担
    const ownAge = Math.max(0, pregnant.effectivePregnantDays - (Number(fetus?.conceivedAtDays) || 0));
    const ageInDays = ownAge * weight;
    const fetalAgeWeeks = ageInDays / 7;
    const fetalLoad = fetalAgeWeeks / 40;
    return sum + (fetalLoad / motherBreedTolerance);
  }, 0);

  const experience = profile.experience || {};
  experience.pregnantExperience = Math.max(1, clampNumber(experience.pregnantExperience, 0, 999, 0));
  profile.experience = experience;

  const recoveryBase = Math.max(1, Math.round(clampNumber(bio.recoveryDays, 1, 9999, 56)));
  const totalWeight = pregnant.fetuses.reduce((sum, fetus) => sum + clampNumber(fetus?.weight, 0.33, 3.0, 1.0), 0);
  const recoveryAccumulator = pregnant.fetuses.reduce((sum, fetus) => {
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    return sum + (weight * getRegistryEmbryoTypeRecoveryCoefficient(fetus?.embryoType));
  }, 0);
  const averageRecovery = recoveryAccumulator / Math.max(totalWeight, 0.5);
  const fetusCountModifier = 1 + (Math.max(0, pregnant.fetuses.length - 1) * 0.12);
  profile.bio = {
    ...bio,
    recoveryDays: Math.max(1, Math.round(recoveryBase * (1 + averageRecovery) * fetusCountModifier)),
  };
  profile.pregnant = pregnant;
}

function sanitizePsy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stageProfiles = normalizePsychologyStageProfiles(value.stageProfiles);
  const mens = normalizePsychologyGroup(value.mens, PSY_MENS_FIELDS, {
    includeDefaults: false,
    booleanFields: PSY_MENS_BOOL_FIELDS,
    stageProfiles: stageProfiles.mens,
  });
  const preg = normalizePsychologyGroup(value.preg, PSY_PREG_FIELDS, {
    includeDefaults: false,
    booleanFields: PSY_PREG_BOOL_FIELDS,
    stageProfiles: stageProfiles.preg,
  });
  const hasStageProfiles = Object.keys(stageProfiles).length > 0;
  if (preg) return { preg, ...(hasStageProfiles ? { stageProfiles } : {}) };
  if (mens) return { mens, ...(hasStageProfiles ? { stageProfiles } : {}) };
  return hasStageProfiles ? { stageProfiles } : null;
}

function sanitizeMeter(value, { min = 0, max = 999 } = {}) {
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.max(min, Math.min(max, Math.round(next)));
}

function sanitizeRegistryProfile(profile, baseProfile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return {};
  const sanitized = {};
  if (profile.base && typeof profile.base === 'object' && !Array.isArray(profile.base)) {
    const nextBase = {};
    if (profile.base.race !== undefined) {
      const parsed = parseRaceDescriptor(profile.base.race);
      nextBase.race = parsed.race || baseProfile.base.race;
      if (profile.base.derivedType === undefined && parsed.derivedType !== null) nextBase.derivedType = parsed.derivedType;
    }
    if (profile.base.derivedType !== undefined) nextBase.derivedType = profile.base.derivedType === null ? null : String(profile.base.derivedType || '').trim() || null;
    if (profile.base.age !== undefined) {
      const age = Number(profile.base.age);
      if (Number.isFinite(age)) nextBase.age = age;
    }
    if (profile.base.libido !== undefined) {
      const libido = sanitizeMeter(profile.base.libido, { min: 0, max: 150 });
      if (libido !== null) nextBase.libido = libido;
    }
    if (profile.base.uterinePressure !== undefined) {
      const uterinePressure = sanitizeMeter(profile.base.uterinePressure, { min: 0, max: 150 });
      if (uterinePressure !== null) nextBase.uterinePressure = uterinePressure;
    }
    if (profile.base.latestSexDays !== undefined) {
      const latestSexDays = Number(profile.base.latestSexDays);
      if (Number.isFinite(latestSexDays)) nextBase.latestSexDays = Math.max(-1, Math.round(latestSexDays));
      else if (profile.base.latestSexDays === null) nextBase.latestSexDays = null;
    }
    if (profile.base.sperms !== undefined) {
      nextBase.sperms = sanitizeRegistrySperms(profile.base.sperms);
    }
    if (profile.base.vitalityLevel !== undefined) {
      const vitalityLevel = Number(profile.base.vitalityLevel);
      if (Number.isFinite(vitalityLevel)) nextBase.vitalityLevel = Math.max(1, Math.min(7, Math.round(vitalityLevel)));
    }
    if (profile.base.psyStressLevel !== undefined) {
      const psyStressLevel = Number(profile.base.psyStressLevel);
      if (Number.isFinite(psyStressLevel)) nextBase.psyStressLevel = Math.max(1, Math.min(7, Math.round(psyStressLevel)));
    }
    if (Object.keys(nextBase).length > 0) sanitized.base = nextBase;
  }

  const experience = pickObjectFields(profile.experience, EXPERIENCE_FIELDS);
  if (Object.keys(experience).length > 0) sanitized.experience = experience;

  const metabolism = pickObjectFields(profile.metabolism, METABOLISM_FIELDS);
  if (Object.keys(metabolism).length > 0) {
    const nextMetabolism = {};
    for (const [key, value] of Object.entries(metabolism)) {
      const meter = key === 'flux'
        ? sanitizeMeter(value, { min: -150, max: 150 })
        : sanitizeMeter(value, { min: 0, max: 150 });
      if (meter !== null) nextMetabolism[key] = meter;
    }
    if (Object.keys(nextMetabolism).length > 0) sanitized.metabolism = nextMetabolism;
  }

  if (profile.psychology !== undefined) {
    const psychology = sanitizePsy(profile.psychology);
    if (psychology) sanitized.psychology = psychology;
  }

  if (profile.children !== undefined) sanitized.children = sanitizeChildren(profile.children);

  if (profile.pregnant !== undefined) sanitized.pregnant = sanitizePregnant(profile.pregnant);

  if (profile.bio !== undefined) {
    const bio = sanitizeRegistryBio(profile.bio);
    if (bio) sanitized.bio = bio;
  }

  if (profile.diary !== undefined) sanitized.diary = sanitizeDiaryEntries(profile.diary);

  const descriptions = pickObjectFields(profile.descriptions, DESCRIPTION_FIELDS);
  if (Object.keys(descriptions).length > 0) sanitized.descriptions = descriptions;

  return sanitized;
}

export function applyRegistryResult(chatState, result, { allowBreedingPsychology = true } = {}) {
  const name = String(result?.name || '').trim();
  if (!name) throw new Error('注册结果缺少角色名称');
  const current = chatState.characters[name];
  const base = current && typeof current === 'object' ? current : createDefaultFemaleState(name);
  const sanitizedProfile = sanitizeRegistryProfile(result.profile, base.profile);
  if (!allowBreedingPsychology) delete sanitizedProfile.psychology;
  const effectiveRace = sanitizedProfile.base?.race ?? base.profile.base.race;
  const mergedRaceProfile = getMergedRacePhysiologyProfile(effectiveRace);
  const basePsychology = normalizeCharacterPsychologyState(base).profile.psychology;
  const stageProfiles = Object.keys(sanitizedProfile.psychology?.stageProfiles || {}).length > 0
    ? sanitizedProfile.psychology.stageProfiles
    : (basePsychology.stageProfiles || {});
  const nextPsychology = sanitizedProfile.psychology?.preg
    ? {
      stageProfiles,
      mens: buildEmptyPsychologyGroup(PSY_MENS_FIELDS, PSY_MENS_BOOL_FIELDS),
      preg: {
        ...buildEmptyPsychologyGroup(PSY_PREG_FIELDS, PSY_PREG_BOOL_FIELDS),
        ...normalizePsychologyGroup(sanitizedProfile.psychology.preg, PSY_PREG_FIELDS, {
          booleanFields: PSY_PREG_BOOL_FIELDS,
          stageProfiles: stageProfiles.preg,
        }),
      },
    }
    : sanitizedProfile.psychology?.mens
      ? {
        stageProfiles,
        mens: {
          ...buildEmptyPsychologyGroup(PSY_MENS_FIELDS, PSY_MENS_BOOL_FIELDS),
          ...normalizePsychologyGroup(sanitizedProfile.psychology.mens, PSY_MENS_FIELDS, {
            booleanFields: PSY_MENS_BOOL_FIELDS,
            stageProfiles: stageProfiles.mens,
          }),
        },
        preg: buildEmptyPsychologyGroup(PSY_PREG_FIELDS, PSY_PREG_BOOL_FIELDS),
      }
      : {
        ...basePsychology,
        stageProfiles,
      };
  const nextCharacter = {
    ...base,
    name,
    initialized: true,
    profile: {
      ...base.profile,
      ...sanitizedProfile,
      base: {
        ...base.profile.base,
        ...(sanitizedProfile.base || {}),
        vitality: getVitalityInitByLevel(sanitizedProfile.base?.vitalityLevel ?? base.profile.base.vitalityLevel),
        psyStress: getPsyStressInitByLevel(sanitizedProfile.base?.psyStressLevel ?? base.profile.base.psyStressLevel),
      },
      pregnant: {
        ...base.profile.pregnant,
        ...(sanitizedProfile.pregnant || {}),
      },
      experience: {
        ...base.profile.experience,
        ...(sanitizedProfile.experience || {}),
      },
      diary: sanitizedProfile.diary ?? base.profile.diary,
      skills: normalizeSkillList(base.profile.skills),
      talents: normalizeTalentList(base.profile.talents),
      psychology: nextPsychology,
      descriptions: {
        ...base.profile.descriptions,
        ...(sanitizedProfile.descriptions || {}),
      },
      bio: {
        ...base.profile.bio,
        ...(mergedRaceProfile || {}),
        ...(sanitizedProfile.bio || {}),
      },
      metabolism: {
        ...base.profile.metabolism,
        ...(sanitizedProfile.metabolism || {}),
      },
    },
    updatedAt: Date.now(),
  };
  if (Array.isArray(nextCharacter.profile?.pregnant?.fetuses) && nextCharacter.profile.pregnant.fetuses.length > 0) {
    normalizeRegisteredPregnancy(nextCharacter.profile);
  }
  nextCharacter.profile.bio = {
    ...nextCharacter.profile.bio,
    gestationEffectiveSpeed: clampNumber(
      getGestationEffectiveSpeed(nextCharacter.profile),
      0,
      20,
      getGestationSpeciesSpeed(nextCharacter.profile),
    ),
  };
  const latestSexDays = Number(nextCharacter.profile?.base?.latestSexDays);
  if (Number.isFinite(latestSexDays) && latestSexDays >= 0) {
    const cycleLength = getRegistryMenstrualCycleLength(nextCharacter.profile);
    if (latestSexDays >= cycleLength) {
      nextCharacter.profile.base.latestSexDays = -1;
    }
  }
  chatState.characters[name] = syncCharacterStageFromProfile(normalizeCharacterPsychologyState(nextCharacter));
  return chatState.characters[name];
}

export function buildRegistrySkillSystemPrompt(options = {}) {
  const skillPrompt = String(options.skillPrompt || '').trim();
  const inheritedTalentsLocked = Boolean(options.inheritedTalentsLocked);
  const emptyCatalog = Boolean(options.emptyCatalog);
  return [
    '你是 AIRP 角色初始技能与天赋配置器。只处理 payload.target_character。',
    '根据角色卡、世界书、最近对话、已注册角色状态及用户提示，生成可供用户确认的初始技能／天赋 JSON。',
    emptyCatalog
      ? '注意：payload.skill_catalog 目前是空的（这是本聊天的第一个角色）。因此 initialSkills 与 initialTalents 用到的每一个技能，都必须由你在本次 skillDefinitions 中完整定义，没有任何既有技能可以复用。'
      : '先查阅 payload.skill_catalog。语义适合的技能必须复用其精确 name 或 id，不得用近义词建立重复技能。',
    emptyCatalog
      ? '每个新定义必须同时提供 name 与明确说明技能范围的 description，缺一不可。'
      : '只有现有图鉴确实无法表达所需技能时，才能放入 skillDefinitions；每个新定义必须同时提供 name 与明确说明技能范围的 description。',
    'initialSkills 与 initialTalents 的 skill 必须使用图鉴中的精确 name/id，或本次 skillDefinitions 中的新技能精确 name。',
    '【天赋同样需要技能作为载体】天赋不是独立的性格标签，而是「对某个技能的先天擅长／苦手」。'
      + '因此 initialTalents 引用的技能若不在 payload.skill_catalog 中，必须先在本次 skillDefinitions 里定义它，否则该天赋会被丢弃。'
      + '若某个先天特质无法对应到一个明确的技能，就不要写成天赋。',
    '技能 level 为 1-10。天赋 level 为 -5 到 5：正数为擅长，负数为苦手，0 为尚未形成。',
    '技能与天赋共用经验曲线 requiredExp(level)=100*level*level；Lv0 形成擅长／苦手 Lv1 均需 100 EXP。',
    inheritedTalentsLocked ? 'payload.existing_skill_setup.talents 是孩子出生后保留的既有天赋，属于固定继承内容。必须参考它们配置技能，不得在 initialTalents 中输出同一技能的不同等级、方向或经验。' : '',
    '没有充分依据的项目不要添加；不得把性格、身体状态或一次性事件滥列为技能。',
    skillPrompt ? '严格参考 payload.initial_skill_prompt 的额外要求。' : '用户没有提供额外要求，请仅依现有角色资料谨慎判断。',
    '输出前请逐条自检：initialSkills 与 initialTalents 里的每一个 skill，都必须能在 payload.skill_catalog 或本次 skillDefinitions 中找到完全相同的名称。'
      + '对不上的条目会被系统丢弃，请在输出前补上定义或删掉该条目。',
    '只输出 JSON，不要输出解释或 Markdown。结构必须是：',
    '{',
    '  "skillDefinitions": [{"name":"string","description":"string"}],',
    '  "initialSkills": [{"skill":"技能精确名称或ID","level":1,"exp":0}],',
    '  "initialTalents": [{"skill":"技能精确名称或ID","level":0,"exp":0}]',
    '}',
    '没有项目的数组也必须输出为空数组。',
  ].join('\n');
}

function sanitizeRegistrySkillInferenceResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('技能／天赋生成结果必须是 JSON 对象');
  const fields = ['skillDefinitions', 'initialSkills', 'initialTalents'];
  for (const field of fields) {
    if (result[field] !== undefined && !Array.isArray(result[field])) throw new Error(`${field} 必须是数组`);
  }
  return {
    skillDefinitions: Array.isArray(result.skillDefinitions) ? result.skillDefinitions : [],
    initialSkills: Array.isArray(result.initialSkills) ? result.initialSkills : [],
    initialTalents: Array.isArray(result.initialTalents) ? result.initialTalents : [],
  };
}

export async function runRegistrySkillInference(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const requestedTargetName = String(options.targetName || '').trim();
  if (!requestedTargetName) throw new Error('技能／天赋生成需要 targetName');
  const targetName = resolveRegisteredCharacterName(chatState, requestedTargetName);
  if (!targetName) throw new Error(`技能／天赋生成需要已注册角色：${requestedTargetName}`);
  const skillPrompt = String(options.skillPrompt !== undefined ? options.skillPrompt : (settings.registrySkillPrompt || '')).trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    customNotes: '',
    reason: 'skill_talent_inference',
    userInstruction: skillPrompt,
  });
  payload.initial_skill_prompt = skillPrompt;
  payload.skill_catalog = normalizeSkillCatalog(chatState.skillCatalog);
  payload.existing_skill_setup = {
    skills: normalizeSkillList(chatState.characters[targetName]?.profile?.skills),
    talents: normalizeTalentList(chatState.characters[targetName]?.profile?.talents),
  };
  const inheritedTalentsLocked = Boolean(chatState.characters[targetName]?.profile?.childSource);
  payload.inherited_talents_locked = inheritedTalentsLocked;
  const systemPrompt = options.skillSystemPrompt
    || buildRegistrySkillSystemPrompt({
      skillPrompt,
      inheritedTalentsLocked,
      // 图鉴为空＝本次是这个聊天的第一个角色，所有引用都只能来自本次 skillDefinitions
      emptyCatalog: payload.skill_catalog.length === 0,
    });
  const result = await callOpenAICompatible(settings, payload, systemPrompt);
  return sanitizeRegistrySkillInferenceResult(result);
}

/**
 * 把模型给的初始技能／天赋对齐到技能图鉴。
 *
 * 解析不到的条目会被跳过而不是整份作废：模型很容易在 initialTalents 里引用
 * 一个没有一并写进 skillDefinitions 的技能名（注册「第一个」角色时图鉴还是空的，
 * 没有既有技能可复用，特别容易发生）。旧版任何一条解析失败就抛错，
 * 于是整组技能与天赋一起丢失——使用者看到的就是「提示技能不存在」而且天赋角标不出现。
 *
 * 跳过的条目会收集在 skipped 里，交由呼叫端提示，不静默吞掉。
 */
export function normalizeInitialSkillTalentConfig(config, catalog) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { skills: [], talents: [], skipped: [] };
  const skipped = [];
  const resolveId = (entry) => {
    const reference = entry?.skillId ?? entry?.skill ?? entry?.name;
    const definition = resolveSkillDefinition(catalog, reference);
    if (!definition) {
      skipped.push(String(reference || '(空白)'));
      return null;
    }
    return definition.id;
  };
  const mapEntries = (list) => (Array.isArray(list) ? list : [])
    .map((entry) => ({ skillId: resolveId(entry), level: entry?.level, exp: entry?.exp }))
    .filter((entry) => entry.skillId !== null);
  const skills = normalizeSkillList(mapEntries(config.skills));
  const talents = normalizeTalentList(mapEntries(config.talents));
  return { skills, talents, skipped };
}

export function applyInitialSkillTalentConfig(chatState, targetName, config, report = null) {
  const name = String(targetName || '').trim();
  const current = chatState.characters?.[name];
  if (!name || !current) throw new Error(`找不到已注册角色：${name || '(空白)'}`);
  const normalized = normalizeInitialSkillTalentConfig(config, chatState.skillCatalog);
  // 解析不到的条目已被跳过，交给呼叫端提示使用者
  if (report && typeof report === 'object') report.skipped = normalized.skipped || [];
  const next = {
    ...current,
    profile: {
      ...(current.profile || {}),
      skills: normalized.skills,
      talents: normalized.talents,
    },
    updatedAt: Date.now(),
  };
  chatState.characters[name] = normalizeCharacterPsychologyState(next);
  return chatState.characters[name];
}

export function applyRegistrySkillSetup(chatState, targetName, result, report = null) {
  const name = String(targetName || '').trim();
  if (!name || !chatState.characters?.[name]) throw new Error(`找不到已注册角色：${name || '(空白)'}`);
  const workingState = {
    ...chatState,
    characters: { ...(chatState.characters || {}) },
    skillCatalog: normalizeSkillCatalog(chatState.skillCatalog),
    nextSkillId: normalizeNextSkillId(chatState.skillCatalog, chatState.nextSkillId),
  };
  const definitions = result?.skillDefinitions ?? [];
  const initialSkills = result?.initialSkills ?? [];
  const initialTalents = result?.initialTalents ?? [];
  if (!Array.isArray(definitions)) throw new Error('注册结果的 skillDefinitions 必须是数组');
  if (!Array.isArray(initialSkills)) throw new Error('注册结果的 initialSkills 必须是数组');
  if (!Array.isArray(initialTalents)) throw new Error('注册结果的 initialTalents 必须是数组');
  if (definitions.length > 20) throw new Error('单次注册最多可新增 20 项技能定义');
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error('skillDefinitions 每一项都必须是对象');
    }
    const registered = registerSkillDefinition(
      workingState.skillCatalog,
      definition,
      workingState.nextSkillId,
    );
    if (!registered.ok) throw new Error(registered.message || '新增技能定义失败');
    workingState.skillCatalog = registered.catalog;
    workingState.nextSkillId = registered.nextSkillId;
  }
  const childSource = workingState.characters[name]?.profile?.childSource;
  const resolvedChildSource = childSource ? resolveRegistryChildSource(workingState, childSource) : null;
  const inheritedTalentSource = Array.isArray(childSource?.inheritedTalents)
    ? childSource.inheritedTalents
    : (resolvedChildSource?.child?.talents ?? workingState.characters[name]?.profile?.talents);
  const inheritedTalents = normalizeTalentList(inheritedTalentSource);
  let character = applyInitialSkillTalentConfig(workingState, name, {
    skills: initialSkills,
    talents: initialTalents,
  }, report);
  if (childSource) {
    character.profile.childSource = {
      motherName: String(childSource.motherName || '').trim(),
      childIndex: Number(childSource.childIndex),
      inheritedTalents,
    };
  }
  if (inheritedTalents.length > 0) {
    const inheritedIds = new Set(inheritedTalents.map((entry) => entry.skillId));
    character.profile.talents = normalizeTalentList([
      ...character.profile.talents.filter((entry) => !inheritedIds.has(entry.skillId)),
      ...inheritedTalents,
    ]);
    workingState.characters[name] = character;
  }

  chatState.skillCatalog = workingState.skillCatalog;
  chatState.nextSkillId = workingState.nextSkillId;
  chatState.characters[name] = character;
  return character;
}

export function applyBreedingInferenceResult(chatState, targetName, inference) {
  const name = String(targetName || '').trim();
  if (!name) throw new Error('applyBreedingInferenceResult 需要 targetName');
  const current = chatState.characters?.[name];
  if (!current) throw new Error(`找不到已注册角色：${name}`);
  if (!inference || typeof inference !== 'object' || Array.isArray(inference)) throw new Error('缺少可套用的繁育推演');

  const next = normalizeCharacterPsychologyState({
    ...current,
    profile: {
      ...(current.profile || {}),
      psychology: current.profile?.psychology || {},
    },
  });
  const psychology = next.profile.psychology || {};
  const stageProfiles = Object.keys(inference.stageProfiles || {}).length > 0
    ? normalizePsychologyStageProfiles(inference.stageProfiles)
    : (psychology.stageProfiles || {});

  const mens = inference.mens && typeof inference.mens === 'object'
    ? normalizePsychologyGroup(inference.mens, PSY_MENS_FIELDS, {
      booleanFields: PSY_MENS_BOOL_FIELDS,
      stageProfiles: stageProfiles.mens,
    })
    : normalizePsychologyGroup(psychology.mens, PSY_MENS_FIELDS, {
      booleanFields: PSY_MENS_BOOL_FIELDS,
      stageProfiles: stageProfiles.mens,
    });
  const preg = inference.preg && typeof inference.preg === 'object'
    ? normalizePsychologyGroup(inference.preg, PSY_PREG_FIELDS, {
      booleanFields: PSY_PREG_BOOL_FIELDS,
      stageProfiles: stageProfiles.preg,
    })
    : normalizePsychologyGroup(psychology.preg, PSY_PREG_FIELDS, {
      booleanFields: PSY_PREG_BOOL_FIELDS,
      stageProfiles: stageProfiles.preg,
    });

  next.profile.psychology = {
    mens,
    preg,
    stageProfiles,
  };
  next.updatedAt = Date.now();
  chatState.characters[name] = syncCharacterStageFromProfile(normalizeCharacterPsychologyState(next));
  return chatState.characters[name];
}

export function applyRegistryBreedingInference(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const targetName = resolveRegistryTargetName(ctx, options.targetName);
  const character = applyBreedingInferenceResult(chatState, targetName, options.breedingInference);
  recordChatStateSnapshot(ctx, chatState, { reason: 'breeding_inference_apply' });
  saveSettings(ctx);
  return character;
}

export function resolveRegistryChildSource(chatState, source = {}) {
  const motherName = String(source?.motherName || '').trim();
  const childIndex = Number(source?.childIndex);
  if (!motherName || !Number.isInteger(childIndex) || childIndex < 0) return null;
  const mother = chatState?.characters?.[motherName];
  const children = Array.isArray(mother?.profile?.children) ? mother.profile.children : [];
  const child = children[childIndex];
  return child && typeof child === 'object' ? { motherName, childIndex, mother, child } : null;
}

export function applyRegistryChildInheritance(chatState, targetName, source = {}) {
  const resolved = resolveRegistryChildSource(chatState, source);
  const name = String(targetName || '').trim();
  const character = chatState?.characters?.[name];
  if (!resolved) throw new Error('找不到选择的孩子来源。');
  if (!character?.profile) throw new Error(`找不到已注册角色：${name || '(空白)'}`);
  character.profile.base = character.profile.base && typeof character.profile.base === 'object' ? character.profile.base : {};
  character.profile.base.race = String(resolved.child.race || '未知');
  if (resolved.child.derivedType) character.profile.base.derivedType = String(resolved.child.derivedType);
  else delete character.profile.base.derivedType;
  character.profile.talents = normalizeTalentList(resolved.child.talents);
  character.profile.childSource = {
    motherName: resolved.motherName,
    childIndex: resolved.childIndex,
    inheritedTalents: normalizeTalentList(resolved.child.talents),
  };
  resolved.child.registeredAs = name;
  character.updatedAt = Date.now();
  return { character, source: resolved };
}

export async function runRegistry(ctx, options = {}) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const targetName = resolveRegistryTargetName(ctx, options.targetName);
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  if (!targetName) throw new Error('runRegistry 需要 targetName');
  const requestedSource = options.sourceChild || null;
  const sourceChildContext = requestedSource ? resolveRegistryChildSource(chatState, requestedSource) : null;
  if (requestedSource && !sourceChildContext) throw new Error('找不到选择的孩子来源，请重新选择。');
  if (sourceChildContext?.child?.registeredAs) throw new Error(`这个孩子已经注册为 ${sourceChildContext.child.registeredAs}。`);
  if (sourceChildContext && chatState.characters[targetName]) throw new Error(`角色名 ${targetName} 已被使用，不能覆盖为孩子角色。`);
  const fixedChildRace = sourceChildContext
    ? `${sourceChildContext.child.derivedType ? `[${sourceChildContext.child.derivedType}]` : ''}${String(sourceChildContext.child.race || '未知')}`
    : '';
  const declaredRace = fixedChildRace || String(options.declaredRace || '').trim();
  const includeBreedingPsychology = Boolean(options.breedingInference);
  const payload = await buildRegistryPayload(ctx, settings, chatState, { ...options, customNotes, declaredRace, sourceChildContext });
  payload.breeding_psychology_enabled = includeBreedingPsychology;
  if (includeBreedingPsychology) payload.breeding_inference = options.breedingInference;
  try {
    const currentCharacterText = JSON.stringify(payload.current_character) || '';
    const characterWorldBookText = JSON.stringify(payload.character_worldbook) || '';
    const recentMessagesText = JSON.stringify(payload.recent_messages) || '';
    const breedingInferenceText = JSON.stringify(payload.breeding_inference) || '';
    const payloadText = JSON.stringify(payload) || '';
    const worldbookEntries = Array.isArray(payload.character_worldbook?.entries)
      ? payload.character_worldbook.entries.length
      : (Array.isArray(payload.character_worldbook?.worldBook?.entries) ? payload.character_worldbook.worldBook.entries.length : 0);
    console.log('[BS BioTracker][registry] payload size', {
      target_character: targetName,
      current_character_chars: currentCharacterText.length,
      character_worldbook_chars: characterWorldBookText.length,
      character_worldbook_entries: worldbookEntries,
      recent_messages_chars: recentMessagesText.length,
      breeding_inference_chars: breedingInferenceText.length,
      payload_chars: payloadText.length,
    });
  } catch (error) {
    console.warn('[BS BioTracker][registry] payload size debug failed', error);
  }
  const systemPrompt = options.systemPrompt || buildRegistrySystemPrompt(settings, { ...options, customNotes, declaredRace, payload, includeBreedingPsychology });
  recordRegistryRequestDebug(systemPrompt, payload);
  try {
    const result = await callOpenAICompatible(
      settings,
      payload,
      systemPrompt,
    );
    if (
      options.breedingInference?.stageProfiles
      && result
      && typeof result === 'object'
      && !Array.isArray(result)
    ) {
      result.profile = result.profile && typeof result.profile === 'object' && !Array.isArray(result.profile)
        ? result.profile
        : {};
      result.profile.psychology = result.profile.psychology && typeof result.profile.psychology === 'object' && !Array.isArray(result.profile.psychology)
        ? result.profile.psychology
        : {};
      if (!result.profile.psychology.stageProfiles) {
        result.profile.psychology.stageProfiles = options.breedingInference.stageProfiles;
      }
    }
    if (sourceChildContext?.child?.registeredAs) throw new Error(`这个孩子已经注册为 ${sourceChildContext.child.registeredAs}。`);
    if (sourceChildContext && chatState.characters[targetName]) throw new Error(`角色名 ${targetName} 已在注册请求期间被使用。`);
    if (sourceChildContext && result && typeof result === 'object' && !Array.isArray(result)) {
      result.name = targetName;
      result.profile = result.profile && typeof result.profile === 'object' && !Array.isArray(result.profile) ? result.profile : {};
      result.profile.base = result.profile.base && typeof result.profile.base === 'object' && !Array.isArray(result.profile.base) ? result.profile.base : {};
      result.profile.base.race = String(sourceChildContext.child.race || '未知');
      if (sourceChildContext.child.derivedType) result.profile.base.derivedType = String(sourceChildContext.child.derivedType);
      else delete result.profile.base.derivedType;
    }
    // 使用者已经明确指定要注册谁，模型不得改名。
    // payload 里同时有角色卡与 target_character，模型常把角色卡名当成 name 回传，
    // 于是角色被注册成卡片名而不是输入的名字（重新注册一次又「好了」，其实只是这次没抽到）。
    result.name = targetName;
    recordRegistryResultDebug(result);
    let character = applyRegistryResult(chatState, result, { allowBreedingPsychology: includeBreedingPsychology });
    if (sourceChildContext) character = applyRegistryChildInheritance(chatState, targetName, requestedSource).character;
    recordChatStateSnapshot(ctx, chatState, { reason: 'registry' });
    saveSettings(ctx);
    return character;
  } catch (error) {
    recordRegistryResultDebug(null, error);
    throw error;
  }
}
