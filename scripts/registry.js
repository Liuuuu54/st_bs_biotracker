import { normalizeExperience, initializeCognitionRecords, normalizeReproductiveSettings, psychologySide } from './reproductive.js';
import { callOpenAICompatible } from './api.js';
import { getEffectiveSettings } from './card_settings.js';
import { isRealisticWorld } from './world_mode.js';
import { buildEmbryoTypeLorePrompt } from './embryo_prompt_context.js';
import { buildRaceCatalogBlock, buildRegistryRacePhysiologyPrompt, buildWorldBaselineBlock } from './race_prompt_context.js';
import { DEFAULT_DIARY_WRITING_PROMPT, DEFAULT_REGISTRY_DESCRIPTION_GUIDES } from './registry_config.js';
import { clampIndividualBodySize, getExpectedBodySize, sampleBodySize } from './body_size.js';
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
  computePostpartumRecoveryDays,
  getEmbryoTypeByRace,
  getMergedRacePhysiologyProfile,
  getBloodlineInfo,
  deriveFetusAncestry,
  getRecoveryCoefficientByRace,
  getRaceComponents,
  getRaceDescriptorComponents,
  parseRaceDescriptor,
  rollCompanionEggCount,
} from './race_config.js';
import {
  DEFAULT_WARDROBE_PREP_PROMPT,
  buildRecentMessages,
  createDefaultFemaleState,
  getCharacterCard,
  getGestationEffectiveSpeed,
  getGestationSpeciesSpeed,
  getCharacterWorldBookName,
  isSkillSystemEnabled,
  isWardrobeSystemEnabled,
  projectWorldbook,
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
import { canLoadHostWorldInfo, getHostChat, getHostWorldBook, loadHostWorldInfo } from './host.js';
import {
  normalizeNextSkillId,
  normalizeSkillCatalog,
  normalizeSkillList,
  normalizeTalentList,
  registerSkillDefinition,
  resolveSkillDefinition,
} from './skill_config.js';
import { resolveWardrobeItemRef, sanitizeWearState } from './wardrobe_config.js';
import { applyToolCall, BACK_SIDES, calculateDerivedInheritanceProgress, canHostNestedPregnancy, ensureNaturalNoticeSample, isFetusKnownToCharacter, writeDiaryEntry } from './tools.js';
import { EXTENSION_MONTH_DAYS, FIRST_EXTENSION_UNTIL_DAYS, GESTATION_SPEED_MAX, GESTATION_SPEED_MIN, POSTTERM_START_DAYS, PREGNANCY_STAGE_DAYS } from './stage_config.js';

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
  if (!value || typeof value !== 'object') return null;
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

  return projectWorldbook(value, keepEntry);
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
  const side = options.psychologySide || null;
  return [
    buildWorldBaselineBlock(settings?.worldBaselinePrompt),
    '你是 AIRP 角色单侧心情推演器。只推指定的当前侧，不预先生成另一侧。',
    `本次唯一目标是「${String(options.targetName || '').trim()}」，target_character 必须逐字一致。`,
    side ? `本次只输出 ${side}，另一侧省略。` : '当前非孕用 mens，真孕/假孕/产程/回归用 preg；只选一侧。恢复期无当前有效侧，不提前建立下一轮 mens。',
    '依据角色资料、关系、处境、近期剧情、当前 cognitionRecords、日记、孩子和长期经验建立新侧，不能复用上一胎心理。',
    '知道怀孕、接受本次怀孕、母职信心与展现倾向分开。不把模型看到的实际父源/胎数/孕程当成角色已知。',
    '尚未感知妊娠时，不凭空生成孕妇心态，无依据的轴保持 null；null 不等于 0。知情后才补推缺项。',
    '想受孕不等于接纳每次妊娠；生过孩子不等于想再生。已知或相信敌对父源可影响态度，秘密真相不可影响。',
    'confidence 是母职信心，不是产科知识或认知准确度；bonding 是接纳与联结，不强制恋孕、自我牺牲或决定留下孩子；stance 是展现倾向，不等于已告知谁。',
    '本次初始化不受日常 ±1～3 的 delta 限制。数值为 0～100 或 null，不写心理 bool，不改 cognitionRecords。',
    ...Object.entries(PSY_MENS_FIELDS).map(([key, field]) => `mens.${key}_value: ${field.definition}`),
    ...Object.entries(PSY_PREG_FIELDS).map(([key, field]) => `preg.${key}_value: ${field.definition}`),
    `只生成当前侧三轴 × 六阶段的 stageProfiles，阶段键 ${PSY_STAGE_KEYS.join(', ')}。每段为角色专属表现，不照抄默认标签。`,
    '只输出 JSON：{target_character,pregnancy_status:"mens|preg|unknown",confidence:0,evidence:[],mens或preg:{对应三项 *_value:数值或null},stageProfiles:{当前侧:{各轴:{各阶段键:表现文字}}},notes:"说明"}。另一侧不输出。',
    options.customNotes ? `角色补充设定：${sanitizePromptText(options.customNotes)}` : '',
    options.breedingInferencePrompt ? `额外推演提示：${sanitizePromptText(options.breedingInferencePrompt)}` : '',
  ].filter(Boolean).join('\n');
}

// 示例里的档位写成可选项而不是具体值：写具体值时模型常原样照抄，孕妇装也被存成 fitted
const STARTING_OUTFIT_SAMPLE = '{"nude":false,"main":{"name":"string","note":"string","parts":[],"fitProfile":{"masking":"very_low|low|medium|high","support":"none|normal|strong","capacity":"tight|fitted|stretch|loose","convenience":"inconvenient|normal|convenient"}},"accessories":[{"name":"string","note":"string","category":"underwear|outerwear|footwear|headwear|ornament|support|other","effects":[]}],"wearState":"整齐"}';

/** 衣物四维档位要跟文字描述对得上：新增衣物的三个流程与 tracker 共用 */
export const WARDROBE_FIT_CONSISTENCY_RULE = 'fitProfile 必须与 name、note 的描述一致，逐项判断，不要照抄示例：写明宽松、宽大、孕妇装、罩衫的 capacity 用 stretch 或 loose，修身、紧身、孕前旧衣用 fitted 或 tight；有托腹或承托设计的 support 用 strong；长款、宽摆能遮住腹部的 masking 用 medium 以上。';


export function buildWardrobePrepSystemPrompt(settings, options = {}) {
  const userPrompt = String(options.wardrobePrepPrompt || settings?.wardrobePrepPrompt || '').trim();
  return [
    '你是 AIRP 角色备装器。代入 payload.target_character 的身份、处境与身体状态（payload.existing_state），按用户要求整理她的长期衣柜：补充衣物，必要时汰换穿不下或不再适合的衣物。不改变当前穿着。',
    '根据用户要求选择最必要的项目；用户明确列出要补的项目时只补那些，未指定数量时一般补充 2-4 项，避免为每个角色创建庞大专属衣柜。',
    '只有用户要求整理、汰换、丢掉不合身衣物时才输出 remove。判断依据是 payload.existing_wardrobe 里衣物的 fitProfile 与角色现况：例如孕中后期 capacity=tight／fitted 的修身衣物通常穿不下，support=none 的衣物撑不住沉重的胸腹。',
    'remove 只能引用 payload.existing_wardrobe 里既有衣物的 id，并写出 reason；不得丢掉 payload.existing_outfit 正在穿的衣物，也不得引用 id=0。',
    '只输出 JSON，不要输出额外解释。',
    'JSON 顶层结构必须是：{"items": [...], "remove": [{"id": 1, "reason": "string"}]}。没有要新增或丢掉的就给空数组。',
    'main 是完整基础套装，可附 parts，并使用 fitProfile 档位。accessory 使用 category 与最多两项 effects。',
    'fitProfile：masking=very_low/low/medium/high，support=none/normal/strong，capacity=tight/fitted/stretch/loose，convenience=inconvenient/normal/convenient。',
    WARDROBE_FIT_CONSISTENCY_RULE,
    'category：underwear/outerwear/footwear/headwear/ornament/support/other。effects：masking/support/capacity/convenience 加 _up 或 _down。',
    'note 只写稳定外观与来源，不写当前反应或怀孕变化。不要输出数值四维。',
    '[用户备装要求]',
    userPrompt || '无',
  ].join('\n');
}


/** 起始着衣的规则：单独生成与一次注册共用 */
function buildStartingOutfitRuleLines(outfitPrompt = '') {
  return [
    'currentOutfit 是这名角色此刻身上的起始着衣：一套完整基础衣着 main 加上正在穿戴的配件 accessories，不要顺便生成整个衣柜。',
    '依角色卡、世界观与当下处境设计穿着，包括它合不合身：例如已显怀的孕妇仍硬穿孕前的修身衣服时，fitProfile 如实填这件衣服原本的档位（capacity=tight 等），系统会依孕期自动算出它被撑紧的程度；穿着的当下状态写进 wearState。',
    'main 使用 name/note/parts/fitProfile。fitProfile 档位：masking=very_low/low/medium/high，support=none/normal/strong，capacity=tight/fitted/stretch/loose，convenience=inconvenient/normal/convenient。',
    WARDROBE_FIT_CONSISTENCY_RULE,
    'accessories 的 category 为 underwear/outerwear/footwear/headwear/ornament/support/other，effects 最多两项，使用 masking/support/capacity/convenience 加 _up 或 _down（例如丝袜、孕妇托腹带、外套）。',
    'category 只是分类标签，不是清单：只列有特色、会被描写到，或会影响遮蔽／承托／容身／方便的配件，通常 0～3 件；普通内衣、袜子等没有特色的不必列。',
    'note 只写颜色、材质、版型、长短、图案与来源等稳定外观，不写角色感受、怀孕反应或衣物当下状态。',
    'wearState 是 12 字内的穿着状态标签，例如 整齐、扣子绷紧、衣衫不整。',
    '明确全裸时填 nude=true，此时不列 main 与 accessories。',
    outfitPrompt ? '严格遵守 payload.outfit_prompt 的起始着衣细则。' : '',
  ].filter(Boolean);
}

export function buildStartingOutfitSystemPrompt(options = {}) {
  return [
    '你是 AIRP 角色起始着衣设计器。只为 payload.target_character 决定此刻身上穿着什么，参考 payload.existing_state 的阶段、孕程与描述。',
    ...buildStartingOutfitRuleLines(options.outfitPrompt),
    '只输出 JSON，不要输出额外解释。',
    `JSON 顶层结构必须是：{"currentOutfit": ${STARTING_OUTFIT_SAMPLE}}`,
  ].join('\n');
}

/** 起始着衣的结构检查；接受外层包着 currentOutfit 的写法 */
export function sanitizeStartingOutfit(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.currentOutfit !== undefined ? raw.currentOutfit : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('起始着衣必须是 JSON 对象');
  const nude = source.nude === true;
  const main = !nude && source.main && typeof source.main === 'object' && !Array.isArray(source.main) ? source.main : null;
  if (!nude && !main) throw new Error('起始着衣需要 main，或 nude=true 表示全裸');
  const accessories = nude ? [] : (Array.isArray(source.accessories) ? source.accessories : []);
  return {
    nude,
    ...(main ? { main } : {}),
    accessories,
    wearState: sanitizeWearState(source.wearState),
  };
}

/**
 * 把起始着衣写成角色当前穿着：衣物以名称收进长期衣柜（同名即更新），再整套换上，配件以这份清单为准。
 * 任一步失败就整份不写
 */
export function applyStartingOutfit(chatState, targetName, raw) {
  const outfit = sanitizeStartingOutfit(raw);
  if (!chatState.characters?.[targetName]) throw new Error(`起始着衣需要已注册角色：${targetName}`);
  const workingState = { ...chatState, characters: { ...chatState.characters } };
  const calls = [];
  if (outfit.main) calls.push({ name: 'bsAddWardrobeItem', arguments: { female: targetName, item: { ...outfit.main, id: undefined, slot: 'main' } } });
  for (const accessory of outfit.accessories) {
    calls.push({ name: 'bsAddWardrobeItem', arguments: { female: targetName, item: { ...accessory, id: undefined, slot: 'accessory' } } });
  }
  calls.push({
    name: 'bsChangeOutfit',
    arguments: {
      female: targetName,
      mainItemId: outfit.nude ? 0 : String(outfit.main.name || '').trim(),
      accessoryItemIds: outfit.accessories.map((item) => String(item?.name || '').trim()),
      wearState: outfit.wearState,
    },
  });
  for (const call of calls) {
    const result = applyToolCall(workingState, call);
    if (!result?.applied) throw new Error(result?.message || '起始着衣写入失败');
  }
  chatState.characters[targetName] = workingState.characters[targetName];
  return outfit;
}

export async function runRegistryOutfitInference(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  if (!isWardrobeSystemEnabled(settings)) throw new Error('着衣系统已在系统页关闭');
  const chatState = getChatState(ctx, settings);
  const requestedTargetName = String(options.targetName || '').trim();
  if (!requestedTargetName) throw new Error('起始着衣生成需要 targetName');
  const targetName = resolveRegisteredCharacterName(chatState, requestedTargetName);
  if (!targetName) throw new Error(`起始着衣生成需要已注册角色：${requestedTargetName}`);
  const outfitPrompt = String(options.outfitPrompt !== undefined ? options.outfitPrompt : (settings.registryOutfitPrompt || '')).trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    reason: 'outfit_inference',
    customNotes: '',
    userInstruction: outfitPrompt,
  });
  payload.outfit_prompt = outfitPrompt;
  const result = await callOpenAICompatible(settings, payload, buildStartingOutfitSystemPrompt({ outfitPrompt }), { flow: 'outfit' });
  return sanitizeStartingOutfit(result);
}

export function sanitizeWardrobePrepResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('备装必须返回 JSON 对象');
  const items = Array.isArray(result?.items) ? result.items : (Array.isArray(result?.wardrobe?.items) ? result.wardrobe.items : []);
  const remove = (Array.isArray(result?.remove) ? result.remove : [])
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({ id: entry.id, reason: String(entry.reason || '').trim() }));
  if (items.length <= 0 && remove.length <= 0) throw new Error('备装结果没有要新增或丢掉的衣物');
  return { items, remove };
}

/**
 * 把备装结果写进角色衣柜：先丢后加。正在穿的、id=0、衣柜里找不到的丢弃项跳过并回报；
 * 任一新增失败就整份不写
 */
export function applyWardrobePrepResult(chatState, targetName, raw) {
  const prep = sanitizeWardrobePrepResult(raw);
  const character = chatState.characters?.[targetName];
  if (!character?.profile) throw new Error(`备装需要已注册角色：${targetName}`);
  const outfit = character.profile.outfit || {};
  const wornIds = new Set([
    ...(outfit.mainItemId === null || outfit.mainItemId === undefined ? [] : [Number(outfit.mainItemId)]),
    ...(Array.isArray(outfit.accessoryItemIds) ? outfit.accessoryItemIds.map(Number) : []),
  ]);
  const ownedItems = Array.isArray(character.profile.wardrobe?.items) ? character.profile.wardrobe.items : [];
  const workingState = { ...chatState, characters: { ...chatState.characters } };
  const report = { added: [], removed: [], skipped: [] };
  for (const entry of prep.remove) {
    const target = resolveWardrobeItemRef(ownedItems, entry.id);
    if (!target || target.id === 0) {
      report.skipped.push(`找不到衣物 ${JSON.stringify(entry.id ?? null)}`);
      continue;
    }
    if (wornIds.has(target.id)) {
      report.skipped.push(`${target.name}（正在穿）`);
      continue;
    }
    const result = applyToolCall(workingState, { name: 'bsRemoveWardrobeItem', arguments: { female: targetName, itemId: target.id } });
    if (!result?.applied) throw new Error(result?.message || `丢掉 ${target.name} 失败`);
    report.removed.push({ name: target.name, reason: entry.reason });
  }
  for (const item of prep.items) {
    if (Number(item?.id) === 0 || String(item?.id || '').trim() === 'nude') continue;
    const result = applyToolCall(workingState, { name: 'bsAddWardrobeItem', arguments: { female: targetName, item } });
    if (!result?.applied) throw new Error(result?.message || '备装新增失败');
    report.added.push(String(item?.name || '').trim());
  }
  chatState.characters[targetName] = workingState.characters[targetName];
  return report;
}

async function runBreedingInference(settings, payload, options = {}) {
  const systemPrompt = options.breedingInferenceSystemPrompt || buildBreedingInferenceSystemPrompt(settings, options);
  recordBreedingInferenceRequestDebug(systemPrompt, payload);
  try {
    const rawResult = await callBreedingWithStageRetry(settings, payload, systemPrompt, options);
    const result = normalizeBreedingInferenceResult(rawResult);
    // 角色卡、最近对话中会同时出现 user 与其他人物；target_character 是 UI 的
    // 明确输入，不能把模型回传的猜测当成目标来源，否则结果会显示成 user。
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      result.target_character = String(payload?.target_character || '').trim();
    }
    const side = options.psychologySide || (result?.preg ? 'preg' : result?.mens ? 'mens' : null);
    if (!side) throw new Error('繁育推演缺少当前心理侧。');
    if (!result[side] || typeof result[side] !== 'object') throw new Error('繁育推演未输出指定侧。');
    const stageProfiles = pickBreedingStageProfiles(result, side);
    delete result[side === 'preg' ? 'mens' : 'preg'];
    result.pregnancy_status = side;
    const missing = getMissingPsychologyStageProfileKeys(stageProfiles, side);
    if (missing.length > 0) {
      throw new Error(`繁育推演缺少当前侧 3x6 stageProfiles：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? `…共 ${missing.length} 项` : ''}。模型回传开头：${JSON.stringify(rawResult ?? null).slice(0, 240)}`);
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

function getMissingPsychologyStageProfileKeys(stageProfiles, side) {
  const missing = [];
  const groups = [
    ['mens', PSY_MENS_FIELDS],
    ['preg', PSY_PREG_FIELDS],
  ];
  for (const [groupKey, fieldConfig] of groups) {
    if (groupKey !== side) continue;
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
      fatherBodySize: options.sourceChildContext.child?.fatherBodySize ?? null,
      gender: options.sourceChildContext.child?.gender ?? null,
      race: options.sourceChildContext.child?.race ?? null,
      derivedType: options.sourceChildContext.child?.derivedType ?? null,
      age: options.sourceChildContext.child?.age ?? null,
      birthWeightRatio: options.sourceChildContext.child?.birthWeightRatio ?? null,
      birthCompanionEggCount: options.sourceChildContext.child?.birthCompanionEggCount ?? null,
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
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  if (!isWardrobeSystemEnabled(settings)) throw new Error('着衣系统已在系统页关闭');
  const chatState = getChatState(ctx, settings);
  const requestedTargetName = String(options.targetName || '').trim();
  if (!requestedTargetName) throw new Error('备装需要 targetName');
  const targetName = resolveRegisteredCharacterName(chatState, requestedTargetName);
  if (!targetName) throw new Error(`备装需要已注册角色：${requestedTargetName}`);
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const wardrobePrepPrompt = String(options.wardrobePrepPrompt || settings.wardrobePrepPrompt || '').trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    ...options,
    targetName,
    reason: options.reason || 'wardrobe_prep_inference',
    customNotes,
    declaredRace,
    userInstruction: wardrobePrepPrompt,
  });
  payload.wardrobe_prep_prompt = wardrobePrepPrompt;
  payload.existing_wardrobe = chatState.characters[targetName]?.profile?.wardrobe || null;
  payload.existing_outfit = chatState.characters[targetName]?.profile?.outfit || null;
  const systemPrompt = options.wardrobePrepSystemPrompt || buildWardrobePrepSystemPrompt(settings, { ...options, wardrobePrepPrompt });
  const result = await callOpenAICompatible(settings, payload, systemPrompt, { flow: 'wardrobe' });
  return sanitizeWardrobePrepResult(result);
}

export async function runRegistryDiaryInference(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
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
    ...buildDiaryRuleLines(requestedDate),
    '只输出 JSON：{"time":"日期标题","content":"日记正文"}。',
  ].join('\n');
  const result = await callOpenAICompatible(settings, payload, systemPrompt, { flow: 'diary' });
  const time = String(result?.time || requestedDate || '').trim();
  const content = String(result?.content || '').trim();
  if (!time || !content) throw new Error('日记生成结果缺少 time 或 content');
  return { time, content };
}

export async function runRegistryBreedingInference(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  const chatState = getChatState(ctx, settings);
  const targetName = resolveRegistryTargetName(ctx, options.targetName);
  const initialProfile = chatState.characters[targetName]?.profile;
  const initialSide = initialProfile ? psychologySide(initialProfile.base?.stage) : null;
  const initialGeneration = initialProfile?.psychology?.generation;
  if (initialProfile && !initialSide) throw new Error('恢复期不初始化心理，请等待恢复结束');
  if (initialSide) options = { ...options, psychologySide: initialSide };
  const liveProvider = globalThis.SillyTavern?.getContext;
  const useLiveContext = typeof liveProvider === 'function' && getChatKey(liveProvider()) === getChatKey(ctx);
  const captureAnchor = (context) => JSON.stringify({ chat: getChatKey(context),
    length: getHostChat(context).length, swipe: getHostChat(context).at(-1)?.swipe_id,
    messages: buildRecentMessages(context, settings) });
  const anchor = captureAnchor(ctx);
  const requireCurrent = () => {
    const liveContext = useLiveContext ? liveProvider() : ctx;
    const current = chatState.characters[targetName]?.profile;
    if (captureAnchor(liveContext) !== anchor || (initialProfile &&
      (psychologySide(current?.base?.stage) !== initialSide || current?.psychology?.generation !== initialGeneration))) {
      const error = new Error('繁育推演期间聊天、分支或适用侧已变化，结果已丢弃，请重新推演');
      error.code = 'BS_REPRODUCTIVE_STALE';
      throw error;
    }
  };
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
  const subject = chatState.characters[targetName]?.profile;
  if (subject) payload.existing_state = { name: targetName, profile: {
    base: { stage: subject.base?.stage }, cognitionRecords: subject.cognitionRecords || [],
    diary: subject.diary || [], experience: subject.experience || {},
    children: (subject.children || []).map(({ name, selectedFather, age }) => ({ name, selectedFather, age })),
    psychology: initialSide ? { [initialSide]: subject.psychology?.[initialSide] || {} } : undefined,
    descriptions: { normalDescription: subject.descriptions?.normalDescription },
  } };
  payload.initial_cognition_records = options.initialCognitionRecords || [];
  payload.psychology_side = options.psychologySide || null;
  requireCurrent();
  const result = await runBreedingInference(settings, payload, {
    ...options,
    targetName,
    customNotes,
    declaredRace,
    breedingInferencePrompt,
    sourceChildContext,
  });
  requireCurrent();
  return result;
}

const pendingPsychologyRequests = new Set();

// Triggered by a successful tracking event, never by loading an old chat.
export async function inferPendingPsychology(ctx, settings, chatState, isCurrent = () => true) {
  for (const [name, character] of Object.entries(chatState.characters || {})) {
    const psychology = character.profile?.psychology;
    const side = psychology?.pendingSide;
    if (!psychology?.enabled || !side || character.profile.base?.isHere === false) continue;
    const generation = psychology.generation || 0;
    const key = `${getChatKey(ctx)}:${name}:${generation}`;
    if (pendingPsychologyRequests.has(key)) continue;
    pendingPsychologyRequests.add(key);
    try {
      const result = await runRegistryBreedingInference(ctx, { targetName: name, psychologySide: side });
      const current = chatState.characters[name]?.profile?.psychology;
      if (!isCurrent() || current?.generation !== generation || current?.pendingSide !== side
        || psychologySide(chatState.characters[name]?.profile?.base?.stage) !== side) continue;
      const config = side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
      const normalized = normalizePsychologyGroup(result[side], config, { stageProfiles: result.stageProfiles[side] });
      if (current.supplementOnly) {
        for (const field of Object.keys(config)) {
          if (current[side]?.[`${field}_value`] !== null && current[side]?.[`${field}_value`] !== undefined) {
            normalized[`${field}_value`] = current[side][`${field}_value`];
          }
        }
      }
      current[side] = normalizePsychologyGroup(normalized, config, { stageProfiles: result.stageProfiles[side] });
      current.stageProfiles = { ...(current.stageProfiles || {}), [side]: result.stageProfiles[side] };
      current.activeSide = side;
      current.pendingSide = null;
      delete current.supplementOnly;
      delete current.inferenceError;
    } catch (error) {
      const current = chatState.characters[name]?.profile?.psychology;
      if (error.code !== 'BS_REPRODUCTIVE_STALE' && isCurrent() && current?.generation === generation) current.inferenceError = '单侧推演失败，保持未知；下次追踪可重试。';
      console.warn('[BS BioTracker] 单侧心理推演失败', error);
    } finally {
      pendingPsychologyRequests.delete(key);
    }
  }
}


// 写实世界只有人类：血脉比例、衍生、伴生卵与非人示例都用不到，比照追踪提示词整行拿掉
const REALISTIC_REGISTRY_DROPPED_LINES = [
  '- base.bloodline:', '- 若 base.derivedType 不为 null', '- 混血:', '- 衍生种族:', '- 子类物种:', '- 复杂种族:',
  '- companionEggCount:', '- 精灵怀孕500天:', '{如果角色不是人类',
];

function dropRealisticRegistryLines(prompt) {
  return prompt.split('\n').filter((line) => !REALISTIC_REGISTRY_DROPPED_LINES.some((prefix) => line.trimStart().startsWith(prefix))).join('\n');
}

export function buildRegistrySystemPrompt(settings, options = {}) {
  // 注册页的「此角色使用妊娠变速」：没勾就不让模型写变速，免得把「怀很久／过了预产期」都塞进倍率
  const useGestationModifier = options.useGestationModifier === true;
  const sliderMultiplier = useGestationModifier && options.gestationModifierMultiplier !== undefined && options.gestationModifierMultiplier !== null
    ? Number(options.gestationModifierMultiplier)
    : NaN;
  const includeBreedingPsychology = Boolean(options.includeBreedingPsychology);
  const guides = {
    ...DEFAULT_REGISTRY_DESCRIPTION_GUIDES,
    ...(settings?.registryDescriptionGuides || {}),
    ...(options.descriptionGuides || {}),
  };
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings?.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const sourceChild = options.payload?.source_child || null;
  // 写实世界只有人类：名录、种族生理与胚型说明都不送
  const realisticWorld = isRealisticWorld(settings);
  const embryoTypeLorePrompt = realisticWorld ? '' : buildEmbryoTypeLorePrompt(options.payload || {}, { includeAllIfEmpty: true });
  const racePhysiologyPrompt = realisticWorld ? '' : buildRegistryRacePhysiologyPrompt(options.payload || {}, { selection: settings?.raceCatalogSelection || null });
  // 注册是一次性请求，附上辨识提示帮模型在形近种族间选对（人鱼／鱼人、精灵／妖精）
  const raceCatalogPrompt = realisticWorld ? '' : buildRaceCatalogBlock({
    withHints: true,
    selection: settings?.raceCatalogSelection || null,
  });
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
    buildWorldBaselineBlock(settings?.worldBaselinePrompt),
    racePhysiologyPrompt,
    raceCatalogPrompt,
    '你是 AIRP 角色注册初始化器。',
    realisticWorld ? '本故事为写实世界，只有人类：base.race 一律填 人类，不填 bloodline 与衍生类型。' : '',
    '只在用户明确要求注册指定角色时工作，不得擅自新增其他角色。',
    '根据角色卡、用户要求、已有资料，输出角色初始化 JSON。',
    sourceChild ? '本次注册来源为已有角色的孩子。payload.source_child 是固定事实：base.race 必须沿用其 race／derivedType；其 talents 会由系统确定性继承。你只能参考这些天赋塑造初始化内容，不得删除、改名、换向或重算天赋。' : '',
    includeBreedingPsychology
      ? 'payload.breeding_inference 是已确认的繁育推演。必须优先把它当作繁育心理初稿，再结合角色资料校正，不要无故忽略。'
      : '本次未启用繁育心理推演：不要输出、补全或推断任何繁育阶段人格字段，保留角色卡原有的阶段人设与表现。',
    '你只需要填写角色注册时真正需要声明的内容，不需要补充其他无关信息。',
    '不要扩写额外分类，不要发散到注册步骤之外的内容。',
    '你只需要填写以下声明内容：',
    '1. 角色基础注册：base.age、base.race、base.bodySize、base.vitalityLevel、base.psyStressLevel、base.libido、base.uterinePressure、base.latestSexDays、base.penetrationState、base.penetrationSource、base.sperms、metabolism',
    '2. 情感与妊娠经验：experience',
    ...(includeBreedingPsychology ? ['3. 繁育心理：psychology.mens 或 psychology.preg（二选一，互斥）'] : []),
    '4. 既有孩子记录：children',
    '5. 初登场即怀孕：pregnant.gestationalAgeDays（或 pregnantDays）、pregnant.fetusesCount、pregnant.fetuses；正在延产再加 pregnant.extensionCount',
    '6. 文字描述栏位：descriptions',
    '如果资料不足，可以省略字段或给 null（base.age 除外）；不要为了凑完整而编造。',
    embryoTypeLorePrompt,
    '以下字段定义、参数说明、注意事项与示例，均视为必要规则：',
    '【1. 角色基础注册】',
    '参数说明：',
    `- base.race: 纯种/混血/衍生种族/子类物种，保留原始写法，若故事为现代写实，种族统一填人类即可${declaredRace ? `。【重要】用户已明确指定，必须强制填写為：${declaredRace}` : ''}`,
    '- base.bloodline: 原文写明血脉比例时，可把比例直接写进 base.race，或另填 bloodline 对象（键与 race 成分一致，值为0到1、合计1）。其余成分已知就写全，例如祖母是精灵、其余祖辈是人类：race="1/4精灵x3/4人类"（或 race="精灵x人类"、bloodline={"精灵":0.25,"人类":0.75}）。其余成分不详就只写已知那一份，例如「八分之一龙血，其余血统不详」：race="1/8西方龙"，系统会把剩下的87.5%记为未知；不得擅自补成人类。没有比例依据就省略；系统会标为比例推定。衍生类型不占种族血脉份额。',
    '- base.vitalityLevel: 1-7，默认语义为 一推就倒(1)-身怀病弱(2)-难产体态(3)-均衡活力(4)-安产体态(5)-经过锻炼(6)-无坚不摧(7)',
    '- base.psyStressLevel: 1-7，默认语义为 情感丧失麻木不仁(1)-内向压抑冷感(2)-情绪平缓理性(3)-情绪均衡稳定(4)-情绪丰富敏感(5)-强烈波动焦躁(6)-极端情绪精神异常(7)',
    '- base.age: 必填，不得省略或填 null。依角色卡、世界书与对话推断实际年龄；长生种只写外表年龄时，按设定推估实际岁数；资料完全没有提到时，按外貌、身分与经历推估一个合理年龄。',
    '- base.bodySize: 常态（人态）的个体体型，1–7 级，人类为 4，可带一位小数。依角色卡写明的身高或身材换算：约 30 cm＝1.5、120 cm＝2.5、150 cm＝3.5、170 cm＝4、190 cm＝4.5、220 cm＝5、250 cm＝5.5、4 m＝6、6 m 以上＝7，锚点之间按比例内插；萝莉体型约 3–3.5，八尺约 5.3。半人马、拉弥亚等大型下半身看整体量体，以种族体型为准再增减。能变形的种族只填常态，变化态由系统按种族推算。未成年角色填当下的体型。卡上没写身材就省略，系统按种族分布抽取；种族体型为依个体时（怪兽类、怪鸟类、怪鱼类、植物族、真菌族、独居虫族、心魇）必须按子项或描述填写；种族体型为可变时省略。',
    '- base.libido: 初始性欲。非妊娠上限100；妊娠後会随孕期提升，临产最后一天上限可达150。若角色开场就在发情、催情、强欲状态，可给较高值。',
    '- base.uterinePressure: 初始宫压。非妊娠上限50；妊娠後会随进度平滑提升，臨產期上限达150。【危险警告】孕早期与孕中期前期上限极低，超过15便极易触发流产警告！除非开局正在临盆或剧烈腹痛，否则强烈建议填 0。',
    '- base.latestSexDays: 距最近一次性行为经过的天数。若 experience.latestSexPartner 有意义，建议一并填写；若已超过最近一月经周期或无从判断，可为 null。',
    '- base.penetrationState / penetrationSource: 当前可受孕生殖道的插入状态（idle/inserted/spent）与来源；一般开场为 idle/null，插入不等于射精。',
    '- base.sperms: 体内残留精液来源列表。适用于刚性交结束、仍有精液残留的开局；每项包含 male、race、value，value 建议 10-30（每天自动衰减 10）。race 可直接写 [衍生]种族，系统会自动拆出 derivedType。',
    '- metabolism: 初始需求状态。普通种族上限皆為150，包含 excretion、hunger、sleep、milk、odor、companionship，分别表示泄意、饿意、困意、乳意、臭意、伴意；excretion（泄意）同时包含排尿与排便需求；milk 在普通周期表示乳房胀敏或周期不适，在妊娠、假孕或产后恢复阶段也可表示泌乳需求。',
    '- 若 base.derivedType 不为 null，则 metabolism 可填写 flux（范围 -150 到 150），并保留该衍生类型未抵免的普通需求。flux 是衍生种族专用的单一极性需求值：正值与负值分别代表两种相反的释放需求，绝对值越高需求越强。',
    '- pregnant.nutrition 是妊娠供养力盈余/赤字，由需求照料累积（需求在「高」时彻底处理 +1、拖到「爆」-1，按种族折算），每周参与胎儿体重结算，不作为 metabolism 排解阻塞来源。',
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
    '- emotionalMates: 多人交往名单，无则 []',
    '- marriageMates: 多人婚姻名单，无则 []',
    '- pregnantExperience: 怀孕经验次数',
    '- naturalBirthExperience: 自然产经验次数',
    '- surgicalBirthExperience: 手术产经验次数',
    '- miscarriageExperience: 已成立妊娠的自然/非人工流产次数，旧版妊娠损失归入流产；abortionExperience: 堕胎次数。两者分开。',
    '示例：',
    '- 高中女生: {"experience":{"virginity":"前男友","emotionalMates":["{{user_name}}"],"pregnantExperience":0}}',
    '- 媚魔女仆: {"experience":{"virginity":"前任主人","emotionalMates":[],"pregnantExperience":5,"naturalBirthExperience":3,"surgicalBirthExperience":0,"miscarriageExperience":2}}',
    '- 守贞人妻: {"experience":{"virginity":"丈夫","latestSexPartner":"丈夫","emotionalMates":["丈夫"],"marriageMates":["丈夫"],"pregnantExperience":3,"naturalBirthExperience":0,"surgicalBirthExperience":2,"miscarriageExperience":0}}',
    '- 刚做爱开局: {"base":{"latestSexDays":0,"sperms":[{"male":"丈夫","race":"[不死-僵尸]人类","value":30}]},"experience":{"latestSexPartner":"丈夫"}}',
    '【3. 繁育心理】',
    '参数说明：',
    '- 若 payload.breeding_inference 存在，先采用其中对应 mens 或 preg 的数值作为心理起始点；只有当角色资料与繁育推演明显冲突时才调整。',
    '- 若 payload.breeding_inference.stageProfiles 存在，必须原样写入 profile.psychology.stageProfiles，除非需要修正明显错误或空缺。',
    '- 繁育心理是角色长期繁育人格底盘，不是临时情绪。注册时应让它能支撑后续 bsUpdatePsychology 的小幅推演。',
    '- psychology.mens 与 psychology.preg 互斥，不要同时填写。',
    '- 你主要填写 *_value，数值范围为 0-100；*_interpret 可省略，系统会按阶段自动补全。没有依据的值填 null，不能把未知补成 0。不再使用心理布林旗标。',
    '- psychology.stageProfiles 用来保存该角色专属 当前侧 3 轴 × 6 阶段解释。结构为 psychology.stageProfiles.mens.{mastery,desire,autonomy}.{0,1_25,26_50,51_75,76_100,100_plus} 与 psychology.stageProfiles.preg.{confidence,bonding,stance}.{0,1_25,26_50,51_75,76_100,100_plus}。',
    '非怀孕使用以下定义与阶段预览：',
    ...psyMensLines,
    ...psyMensBoolLines,
    '怀孕使用以下定义与阶段预览：',
    ...psyPregLines,
    ...psyPregBoolLines,
    '- 非孕侧 mastery（掌控）、desire（欲望）、autonomy（自主）；孕侧 confidence（母职信心）、bonding（接纳与联结）、stance（社会展现）。恢复期不初始化任何一侧。',
    '- 只初始化实际当前侧并输出该侧三轴的全部六阶段专属解释；不得预写另一侧。角色主观判断仅依 initial_cognition_records 与可知剧情，不能把实际胎数、父方当作角色知识。',
    '【4. 既有孩子记录】',
    '参数说明：每个孩子对象包含 name、fathers、gender、race、age。',
    '示例：',
    '- [{"name":"冬月 露花","fathers":"前夫","gender":"女","race":"人类","age":5}]',
    '【5. 初登场即怀孕】',
    '参数说明：',
    '- pregnant.gestationalAgeDays: 发育到哪里，换算成人类产科孕周的天数（从末次月经起算）。资料写“孕8周/怀孕8周”填 56；写“受孕后8周/胚胎发育8周”需再加 14；写“足月”约 280、“逾期两周”约 294、“怀胎一年仍未生”约 365。一般只填这个。',
    '- pregnant.pregnantDays: 实际已经怀了多少天。只有资料给出的是经过时间、又没有说发育到哪里时才填，例如「精灵怀孕500天」、受诅咒「怀胎三年」；系统会乘上种族妊娠速度与 bio.gestationModifierMultiplier 换算发育进度。两者都填时以 gestationalAgeDays 为准。',
    '- 不要填写 pregnant.effectivePregnantDays；系统会自动换算。',
    '- pregnant.extensionCount: 只在资料明确写角色已过预产期、正被某种手段（医疗、法术、契约等）延后生产时填，表示已经延产几次（≥1）；gestationalAgeDays 应至少 294（42 周），写得不足时系统会当作刚满 42 周。没有延产就省略。单纯过了预产期还没生是逾期，不要填。',
    '- base.uterineAtony: 子宫乏力级数，反复延产留下的后遗症；只在资料明确描写多次延产导致子宫松弛无力时填，省略时系统按延产次数推定（次数减 1）。',
    '- pregnant.fetusesCount: 这次怀孕的怀胎数',
    '- pregnant.fetuses: 每个胎儿包含 fathers、provider、race、gender、embryoType；也可填写 companionEggCount、weight、tendencyAngle、backSide、affinity',
    '- companionEggCount: 这一胎伴随的背景卵数量（伴生卵），它们不会发育，也不建立胎儿卡或孩子；不是 fetusesCount。一整群十枚卵、只有一名能长大时，就是一张胎儿卡加 9 枚伴生卵。不确定时省略，由系统依种族抽取。胎生与胎转卵生恒为 0。',
    '- 胎儿可带 tags 标注特殊来历，只接受这几个：identical（同卵）、superfetation（异期复孕）、nested（孕中孕）、rebirth（胎内回归）。代孕不必标——给了 provider 就会自动识别。写不出对应支撑栏位的标签会被撤销，宁可不标也不要留一个指向虚空的关系。',
    '- 嵌合体不必标 tags——给了 chimera 就会自动识别。chimera = { sourceCount: 融合前的受精卵数, fatherSources: [父方名字…], maternalSources: [遗传母方名字…], genderSources: [各来源的性别…] }；父方与母方名字加起来不足两个会被撤销，因为那不成其为嵌合。',
    '- identical：同卵的几胎都标上即可，系统会自动把它们归为同一组；只标一胎会被撤销。',
    '- superfetation：必须一并给 conceivedAtDays（这一胎受精时，母体已经怀了多少有效孕日），会被夹进这次妊娠的范围内。它比同腹其他胎儿晚受精、发育落后。',
    '- nested：这一胎长在另一颗胎儿体内。除了 conceivedAtDays，还要给 nestedInIndex＝宿主在 fetuses 阵列里的下标（从 0 起算，不能指自己）。它的母亲是那颗胎儿，出生后承载者会同时生下孩子与孙辈。宿主只能是胎生、胎转卵生或不定型的胎儿（卵生在壳里、卵胎生在卵膜里，进不去）。',
    '- rebirth：一名已出生的角色回到子宫里成为这一胎，fathers 写那个人的名字（可以是 user）。适合「开场就已经在角色子宫里」的设定。产出后是全新个体，与原来那个人不是同一笔资料。',
    '- revealed：这一胎角色本人知不知道。省略时系统按孕龄自动判定（异期复孕进孕中期才知道、孕中孕要到孕晚期）；想让角色暂时不知情就明确给 false。',
    '- provider: 代孕母方、寄生等提供者名称，正常情况下为 null',
    '- weight: 胎儿体重/发育量倍率，范围 0.33-3.0；不确定可省略，系统会补 1.0',
    '- backSide: 胎背朝母体哪一侧，只能是 左前／右前／左后／右后 之一（左后、右后即枕后位，胎儿的脸朝母体腹侧）；资料没写就省略，系统会随机补值。',
    '- tendencyAngle: 胎位/趋向角度，范围 0-360；不确定可省略，系统会随机补值。角度映射必须固定为：0/360=正常头位/正位，180=完全臀位/倒位，90或270=横位；不要把 180 写成头位',
    '- affinity: 胎儿对母体的亲和/排斥倾向，范围 -50 到 50；正值亲和，负值排斥，不确定可省略',
    '示例：',
    '- 人类怀单胎8周，正常头位示例: {"pregnant":{"gestationalAgeDays":56,"fetusesCount":1,"fetuses":[{"fathers":"丈夫","provider":null,"race":"人类","gender":"男","embryoType":"胎生","weight":1.0,"tendencyAngle":0,"affinity":10}]}}',
    '- 精灵怀孕500天: {"base":{"race":"精灵"},"pregnant":{"pregnantDays":500,"fetusesCount":1,"fetuses":[{"fathers":"伴侣","provider":null,"race":"精灵","gender":"女","embryoType":"胎生"}]}}',
    '- 妖怪猫又怀双胎20周: {"pregnant":{"gestationalAgeDays":140,"fetusesCount":2,"fetuses":[{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"},{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"}]}}',
    '- 被延产圣术拖到孕 50 周仍未生: {"pregnant":{"gestationalAgeDays":350,"extensionCount":1,"fetusesCount":1,"fetuses":[{"fathers":"丈夫","provider":null,"race":"人类","gender":"女","embryoType":"胎生"}]}}',
    '- 代孕情节: {"pregnant":{"gestationalAgeDays":84,"fetusesCount":1,"fetuses":[{"fathers":"委托人","provider":"代孕者A","race":"人类","gender":"女","embryoType":"胎生"}]}}',
    ...(useGestationModifier ? [
      '【5.1 妊娠變速类补充设定（仅在存在特殊变速效果时填写 bio）】',
      '参数说明：',
      '- bio.gestationModifierMultiplier: 特殊妊娠速度修正倍率。大于 1 为加速，小于 1 为减速，0 为冻结；只影响注册之后的推进速度。目前发育到哪里仍填 pregnant.gestationalAgeDays，不会被倍率换算。',
      '- 倍率与延产的分别：整个孕期本来就长或短用倍率，约为 280 ÷ 总孕期天数：怀胎三年才足月约 0.26，地母神祝福十天就怀满十个月约 28（倍率范围 0.03～30，0 为冻结）；正常长到足月、过了预产期才被某种手段拖着不生用延产（pregnant.extensionCount）。不要用倍率表现「过了预产期还不生」。',
      '- bio.gestationModifierName: 该倍率效果的名称，例如祝福、诅咒、体质、术式。',
      '- bio.gestationModifierDescription: 对该倍率来源与表现的简短说明。',
      '- 这组 bio 字段是可选的特殊效果，不是一般妊娠的必填资料。普通人类孕妇、常规妊娠、种族原生孕期速度都不要填写。',
      '- 禁止用 bio 填写 gestationModifierMultiplier=1 的默认占位内容，例如「常规妊娠」「标准人类妊娠生理周期」；没有特殊变速效果就整个省略 bio。',
      '- 仅当资料明确存在持续生效且倍率不为 1 的祝福、诅咒、体质、术式、冻结或延长效果时填写；未怀孕角色也可保留此类明确效果。',
      '示例：',
      '- 被祝福的冒险者妊娠加快: {"bio":{"gestationModifierMultiplier":1.5,"gestationModifierName":"丰饶祝福","gestationModifierDescription":"受女神祝福后，妊娠期间胎儿发育明显加快，孕期反应也会更早显现。"}}',
      '- 红尘之力导致孕期极端延长，即使当前未怀孕也应保留: {"bio":{"gestationModifierMultiplier":0.001,"gestationModifierName":"红尘织命","gestationModifierDescription":"受红尘之力影响，若进入妊娠，孕期推进速度仅为常规人类的千分之一，整体妊娠期会被极度拉长。"}}',
      ...(Number.isFinite(sliderMultiplier)
        ? [`使用者已在注册页用拉杆设定这名角色的变速倍率为 ${sliderMultiplier}${sliderMultiplier === 0 ? '（冻结）' : ''}：bio.gestationModifierMultiplier 一律以此为准，不必自行估算；请依资料填写 bio.gestationModifierName 与 bio.gestationModifierDescription，说明这份变速的来源与表现。若资料只写了经过时间（例如怀胎三年），pregnant.pregnantDays 会按这个倍率换算发育进度。`]
        : ['使用者已确认这名角色使用妊娠变速：必须依资料填写 bio.gestationModifierMultiplier、bio.gestationModifierName、bio.gestationModifierDescription，倍率不可为 1。']),
    ] : [
      '【5.1 妊娠变速】',
      '使用者没有为这名角色开启妊娠变速：不要输出 bio.gestationModifierMultiplier、gestationModifierName、gestationModifierDescription，输出了也会被忽略。',
      '即使资料写怀孕很久，也按种族正常孕期理解：发育到哪里填 pregnant.gestationalAgeDays；过了预产期仍未生是逾期，被某种手段拖着不生用 pregnant.extensionCount。',
    ]),
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
    '若提供了角色补充设定，必须优先视为该角色已明确声明的特征，并在推演与注册相关字段中如实体现；不要忽略，也不要擅自扩写超出原意的内容。',
    ...(useGestationModifier ? [
      '若角色补充设定明确描述的是一种未来也会持续生效、且倍率不为 1 的妊娠体质、祝福、诅咒、冻结或延长效果，即使角色当前未怀孕，也必须写入 bio.gestationModifierMultiplier、bio.gestationModifierName、bio.gestationModifierDescription；普通妊娠不得补写 bio。',
    ] : []),
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
    '      "bodySize": 4,',
    '      "libido": 0,',
    '      "uterinePressure": 0,',
    '      "latestSexDays": 0,',
    '      "penetrationState": "idle",',
    '      "penetrationSource": null,',
    '      "sperms": [],',
    '      "vitalityLevel": 4,',
    '      "psyStressLevel": 4',
    '    },',
    '    "pregnant": {',
    '      "gestationalAgeDays": 0,',
    '      "fetusesCount": 0,',
    '      "fetuses": [',
    '        {',
    '          "fathers": "string|null",',
    '          "provider": "string|null",',
    '          "race": "string|null",',
    '          "gender": "string|null",',
    '          "embryoType": "string|null",',
    '          "companionEggCount": 0,',
    '          "weight": 1.0,',
    '          "tendencyAngle": 0,',
    '          "backSide": "左前",',
    '          "affinity": 0',
    '        }',
    '      ]',
    '    },',
    '    "experience": {',
    '      "virginity": "string|null",',
    '      "latestSexPartner": "string|null",',
    '      "emotionalMates": ["string"],',
    '      "marriageMates": ["string"],',
    '      "pregnantExperience": 0,',
    '      "naturalBirthExperience": 0,',
    '      "surgicalBirthExperience": 0,',
    '      "miscarriageExperience": 0,',
    '      "abortionExperience": 0',
    '    },',
    ...JSON.stringify({ psychology: (() => {
      const side = options.breedingInference?.preg ? 'preg' : 'mens';
      const config = side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
      return { [side]: Object.fromEntries(Object.keys(config).map((axis) => [`${axis}_value`, null])),
        stageProfiles: { [side]: Object.fromEntries(Object.keys(config).map((axis) => [axis, Object.fromEntries(PSY_STAGE_KEYS.map((key) => [key, '角色专属解释']))])) } };
    })() }, null, 2).split('\n').slice(1, -1).map((line, index, lines) => `    ${line}${index === lines.length - 1 ? ',' : ''}`),
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
  const finalPrompt = includeBreedingPsychology ? prompt : stripBreedingPsychologySections(prompt);
  return realisticWorld ? dropRealisticRegistryLines(finalPrompt) : finalPrompt;
}

function stripBreedingPsychologySections(prompt) {
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
  'emotionalMates',
  'marriageMates',
  'pregnantExperience',
  'naturalBirthExperience',
  'surgicalBirthExperience',
  'miscarriageExperience',
  'abortionExperience',
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

/**
 * 嵌合体的三组来源阵列。空的来源等于没有嵌合——只留一个来源的嵌合体是自相矛盾的，
 * 与其留半套资料让族谱画出残缺的边，不如整个撤掉。
 */
function sanitizeChimera(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const list = (input) => (Array.isArray(input) ? input.map((item) => String(item || '').trim()).filter(Boolean) : []);
  const fatherSources = list(value.fatherSources);
  const maternalSources = list(value.maternalSources);
  const genderSources = list(value.genderSources);
  if (fatherSources.length + maternalSources.length < 2) return undefined;
  const sourceCount = Math.max(2, Math.floor(Number(value.sourceCount)) || Math.max(fatherSources.length, maternalSources.length, 2));
  return { sourceCount, fatherSources, maternalSources, genderSources };
}

function sanitizeChildren(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const parsed = parseRaceDescriptor(item.race);
      return {
        name: item.name ?? item.babyName ?? null,
        selectedFather: item.selectedFather == null ? null : String(item.selectedFather).trim() || null,
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
        ...getBloodlineInfo(parsed.race, item.bloodline ?? parsed.bloodline, item.bloodlineSource),
        derivedType: item.derivedType ?? parsed.derivedType ?? null,
        fatherRace: item.fatherRace ?? null,
        fatherBloodline: item.fatherBloodline ?? null,
        fatherBloodlineSource: item.fatherBloodlineSource ?? null,
        fatherDerivedType: item.fatherDerivedType ?? null,
        age: item.age ?? null,
        birthWeightRatio: Number.isFinite(Number(item.birthWeightRatio)) ? clampNumber(item.birthWeightRatio, 0.33, 3.0, 1.0) : null,
        birthCompanionEggCount: Number.isFinite(Number(item.birthCompanionEggCount))
          ? Math.max(0, Math.min(12499, Math.round(Number(item.birthCompanionEggCount))))
          : 0,
        birthAffinity: Number.isFinite(Number(item.birthAffinity)) ? clampNumber(item.birthAffinity, -50, 50, 0) : null,
        id: item.id ?? createChildId(),
        registeredAs: item.registeredAs ?? null,
        talents: normalizeTalentList(item.talents),
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
        ...getBloodlineInfo(parsed.race, item.bloodline ?? parsed.bloodline, item.bloodlineSource),
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
          ...(item.bloodline || parsed.bloodline ? getBloodlineInfo(parsed.race, item.bloodline ?? parsed.bloodline, item.bloodlineSource) : {}),
          fatherRace: explicitFatherRace,
          fatherBloodline: item.fatherBloodline ?? parseRaceDescriptor(item.fatherRace).bloodline ?? null,
          fatherBloodlineSource: item.fatherBloodlineSource ?? null,
          fatherDerivedType: item.fatherDerivedType ?? parsed.derivedType ?? null,
          gender: item.gender ?? null,
          embryoType: item.embryoType ?? null,
          companionEggCount: Number.isFinite(Number(item.companionEggCount))
            ? Math.max(0, Math.min(12499, Math.round(Number(item.companionEggCount))))
            : undefined,
          // 嵌合体：多套来源无法从别处推导，模型不给就等于没有这回事
          chimera: sanitizeChimera(item.chimera),
          maternalDerivedTypeProgress: Number.isFinite(Number(item.maternalDerivedTypeProgress)) ? clampNumber(item.maternalDerivedTypeProgress, -100, 100, 0) : undefined,
          weight: Number.isFinite(Number(item.weight)) ? clampNumber(item.weight, 0.33, 3.0, 1.0) : undefined,
          tendencyAngle: Number.isFinite(Number(item.tendencyAngle)) ? clampNumber(item.tendencyAngle, 0, 360, 0) : undefined,
          backSide: BACK_SIDES.includes(item.backSide) ? item.backSide : undefined,
          affinity: Number.isFinite(Number(item.affinity)) ? clampNumber(item.affinity, -50, 50, 0) : undefined,
          // 特殊来历：让角色卡开场就能是同卵双胞胎、异期复孕、孕中孕或胎内回归。
          // 只放行目录内的标签，支撑栏位在 normalizeRegisteredFetusTags 里对齐。
          tags: sanitizeFetusTagList(item.tags),
          conceivedAtDays: Number.isFinite(Number(item.conceivedAtDays)) ? Number(item.conceivedAtDays) : undefined,
          identicalGroup: Number.isFinite(Number(item.identicalGroup)) ? Math.floor(Number(item.identicalGroup)) : undefined,
          nestedInIndex: Number.isFinite(Number(item.nestedInIndex)) ? Math.floor(Number(item.nestedInIndex)) : undefined,
          revealed: item.revealed === undefined ? undefined : Boolean(item.revealed),
          talents: normalizeTalentList(item.talents),
        };
      })
    : [];
  const gestationalAgeDays = Number(value.gestationalAgeDays);
  const extensionCount = Math.floor(Number(value.extensionCount));
  return {
    pregnantDays: Number.isFinite(Number(value.pregnantDays)) ? Number(value.pregnantDays) : 0,
    ...(Number.isFinite(gestationalAgeDays) && gestationalAgeDays > 0 ? { gestationalAgeDays } : {}),
    ...(Number.isFinite(extensionCount) && extensionCount > 0 ? { extensionCount: Math.min(99, extensionCount) } : {}),
    fetusesCount: Number.isFinite(Number(value.fetusesCount)) ? Number(value.fetusesCount) : fetuses.length,
    fetuses,
  };
}

function sanitizeRegistryBio(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const multiplier = Number(value.gestationModifierMultiplier);
  if (!Number.isFinite(multiplier)) return null;
  const normalizedMultiplier = clampNumber(multiplier, 0, GESTATION_SPEED_MAX, 1);
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
 * 玩家在注册页勾选的特殊胎儿来历。
 *
 * 分两条路走，因为这几种来历需要的资料量差很多：
 * - 只需要一个名字的（胎内回归、代孕／托卵）走硬套：玩家填名字，程式直接写进结果，
 *   不依赖模型愿不愿意照做。
 * - 需要模型编出胎儿结构的（嵌合、同卵、异期复孕、孕中孕）走提示：勾了就往注册提示词里
 *   加一段明确指示。玩家的勾选没办法凭空生出两个真实的血统来源，硬套只会造出假资料。
 *
 * 两条路最后都会流经 normalizeRegisteredFetusTags，所以不管走哪条都不会留下自相矛盾的状态。
 */
export const SPECIAL_FETUS_HINTS = {
  chimera: '这次妊娠里要有一颗嵌合体胎儿：两颗以上的受精卵在著床前融合成一个个体。请给它 chimera = { sourceCount, fatherSources, maternalSources, genderSources }，来源名字要取自角色卡里真实存在的人，父方与母方名字合计至少两个。',
  identical: '这次妊娠里要有一对同卵双胞胎：至少两颗胎儿都标上 tags: ["identical"]，两者的 fathers 与 race 必须一致。',
  superfetation: '这次妊娠里要有一颗异期复孕的胎儿：它在母体已经怀孕之后才受精或植入。给它 tags: ["superfetation"] 与 conceivedAtDays（受精或植入当下母体已怀的有效孕日，必须小于目前孕龄），它比同腹其他胎儿发育落后。',
  nested: '这次妊娠里要有一颗孕中孕的胎儿：它长在另一颗胎儿体内。给它 tags: ["nested"]、conceivedAtDays，以及 nestedInIndex＝宿主在 fetuses 阵列里的下标。宿主本身必须是一颗正常胎儿。',
};

/** 勾选转成追加给模型的指示；没勾任何一项时回传空字串 */
export function buildSpecialFetusNotes(request) {
  if (!request || typeof request !== 'object') return '';
  const lines = [];
  const rebirth = String(request.rebirth || '').trim();
  if (rebirth) {
    lines.push('这次妊娠里要有一颗胎内回归的胎儿：' + rebirth + ' 这个人已经回到子宫里成为其中一胎，请把这一胎的 fathers 写成「' + rebirth + '」并标上 tags: ["rebirth"]。');
  }
  const surrogacy = String(request.surrogacy || '').trim();
  if (surrogacy) {
    lines.push('这次妊娠是代孕／托卵：卵来自 ' + surrogacy + '，承载者只提供子宫、不是遗传母亲。请把这一胎的 provider 写成「' + surrogacy + '」。');
  }
  for (const key of Array.isArray(request.hints) ? request.hints : []) {
    if (SPECIAL_FETUS_HINTS[key]) lines.push(SPECIAL_FETUS_HINTS[key]);
  }
  if (lines.length === 0) return '';
  return ['【特殊胎儿来历】使用者已指定以下设定，请务必在 pregnant.fetuses 里实现：']
    .concat(lines.map((line) => '- ' + line))
    .join('\n');
}

/**
 * 硬套只需要一个名字的两类来历。
 *
 * 只在模型真的产出了胎儿时才动手：没有妊娠却硬塞一胎，就得连孕龄、种族、胚胎型态一起编，
 * 那已经不是「确保玩家的勾选生效」而是伪造资料了。产不出来时留给呼叫端提醒玩家。
 */
export function applyRequestedSpecialFetus(result, request) {
  if (!request || typeof request !== 'object') return false;
  const rebirth = String(request.rebirth || '').trim();
  const surrogacy = String(request.surrogacy || '').trim();
  if (!rebirth && !surrogacy) return false;
  const fetuses = result?.profile?.pregnant?.fetuses;
  if (!Array.isArray(fetuses)) return false;
  const target = fetuses.find((item) => item && typeof item === 'object');
  if (!target) return false;
  if (rebirth) {
    target.fathers = rebirth;
    target.tags = sanitizeFetusTagList((Array.isArray(target.tags) ? target.tags : []).concat('rebirth'));
  }
  if (surrogacy) target.provider = surrogacy;
  return true;
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
  // 母体的编号计数器接在现有最大号后面，之后的新胎才不会撞号
  pregnant.nextEmbryoId = fetuses.reduce((max, fetus) => Math.max(max, Number(fetus.embryoId) || 0), 0) + 1;

  // 孕中孕：模型给的是阵列索引（它写不出内部编号），换成宿主的 embryoId
  for (const [index, fetus] of fetuses.entries()) {
    const target = Number(fetus.nestedInIndex);
    delete fetus.nestedInIndex;
    const valid = Number.isInteger(target) && target >= 0 && target < fetuses.length && target !== index;
    if (valid) fetus.nestedInEmbryoId = fetuses[target].embryoId;
    if (!fetus.nestedInEmbryoId) fetus.tags = fetus.tags.filter((tag) => tag !== 'nested');
  }
  // 宿主自己也是被套的那颗时整条链不成立，一起撤掉；
  // 宿主是卵生（在壳里）或卵胎生（在卵膜里）也进不去，退回普通异期胎
  for (const fetus of fetuses) {
    if (!fetus.nestedInEmbryoId) continue;
    const host = fetuses.find((item) => item.embryoId === fetus.nestedInEmbryoId);
    if (!host || host.nestedInEmbryoId || !canHostNestedPregnancy(host)) {
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
      // 与运行期同一把尺：一般异期胎在孕中期（14 周）揭晓，孕中孕在孕晚期（28 周）
      const threshold = fetus.nestedInEmbryoId
        ? PREGNANCY_STAGE_DAYS.孕早期 + PREGNANCY_STAGE_DAYS.孕中期
        : PREGNANCY_STAGE_DAYS.孕早期;
      fetus.revealed = effectiveDays >= threshold;
    }
    if (!fetus.revealed) delete fetus.revealed;
  }

  for (const fetus of fetuses) if (fetus.tags.length === 0) delete fetus.tags;
}

function normalizeRegisteredPregnancy(profile, chatState) {
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((item) => ({ ...item })) : [];
  if (fetuses.length === 0) return;
  const motherRace = parseRaceDescriptor(profile?.base?.race || '人类').race || '人类';

  pregnant.fetuses = fetuses.map((fetus) => {
    // 只有显式给出父系时才按「父系x母系」重算；否则信任 race 原样，
    // 避免把已完整的胎儿种族再跟承载者混一次（代孕/移植胚胎会因此被改血统）
    const explicitFatherRace = parseRaceDescriptor(fetus?.fatherRace || '').race || null;
    const fatherRace = explicitFatherRace;
    const provider = String(fetus?.provider || '').trim();
    const eggBase = provider ? chatState?.characters?.[provider]?.profile?.base
      : fetus.tags?.includes('nested') ? null : profile.base;
    const fatherBase = chatState?.characters?.[fetus?.fathers]?.profile?.base;
    // 代孕且卵源未知时信任胎儿资料，绝不能拿承载者补成遗传母亲。
    const ancestry = fetus.bloodline || fetus.chimera || !explicitFatherRace || !eggBase
      ? { race: fetus?.race || motherRace, ...getBloodlineInfo(fetus?.race || motherRace, fetus?.bloodline, fetus?.bloodlineSource) }
      : deriveFetusAncestry(eggBase, { race: explicitFatherRace, ...getBloodlineInfo(explicitFatherRace,
        fetus.fatherBloodline ?? fatherBase?.bloodline, fetus.fatherBloodlineSource ?? fatherBase?.bloodlineSource) });
    const fetusRace = ancestry.race;
    const motherBloodline = eggBase ? getBloodlineInfo(eggBase.race || motherRace, eggBase.bloodline, eggBase.bloodlineSource).bloodline : null;
    const embryoType = fetus?.embryoType || getEmbryoTypeByRace(fetusRace, ancestry.bloodline, motherBloodline);
    const companionEggCount = embryoType === '胎生' || embryoType === '胎转卵生'
      ? 0
      : (Number.isFinite(Number(fetus?.companionEggCount))
        ? Math.max(0, Math.min(12499, Math.round(Number(fetus.companionEggCount))))
        : rollCompanionEggCount(fetusRace, Math.random, 20, ancestry.bloodline, motherBloodline));
    return {
      ...fetus,
      ...ancestry,
      fatherRace,
      embryoType,
      companionEggCount,
      weight: Number.isFinite(Number(fetus?.weight)) ? clampNumber(fetus.weight, 0.33, 3.0, 1.0) : 1.0,
      tendencyAngle: Number.isFinite(Number(fetus?.tendencyAngle)) ? clampNumber(fetus.tendencyAngle, 0, 360, 0) : randomInt(0, 360),
      backSide: BACK_SIDES.includes(fetus?.backSide) ? fetus.backSide : BACK_SIDES[randomInt(0, BACK_SIDES.length - 1)],
      affinity: Number.isFinite(Number(fetus?.affinity)) ? clampNumber(fetus.affinity, -50, 50, 0) : 0,
    };
  });
  // 孕中孕的遗传母亲是宿主胎儿；先完成普通胎儿，避免阵列顺序影响比例。
  for (const [index, original] of fetuses.entries()) {
    if (original.bloodline || original.chimera || !original.tags?.includes('nested') || !original.fatherRace) continue;
    const hostIndex = Number(original.nestedInIndex);
    const host = pregnant.fetuses[hostIndex];
    if (!Number.isInteger(hostIndex) || hostIndex === index || !host || host.tags?.includes('nested') || !canHostNestedPregnancy(host)) continue;
    const fatherBase = chatState?.characters?.[original.fathers]?.profile?.base;
    const ancestry = deriveFetusAncestry(host, {
      race: original.fatherRace,
      ...getBloodlineInfo(original.fatherRace, original.fatherBloodline ?? fatherBase?.bloodline,
        original.fatherBloodlineSource ?? fatherBase?.bloodlineSource),
    });
    Object.assign(pregnant.fetuses[index], ancestry);
    if (!original.embryoType) pregnant.fetuses[index].embryoType = getEmbryoTypeByRace(ancestry.race, ancestry.bloodline, host.bloodline);
  }
  pregnant.fetusesCount = pregnant.fetuses.length;
  // 发育进度（gestationalAgeDays）直接就是有效孕日，实际天数反推；没给才用实际天数乘妊娠速度。
  // 变速倍率是 0（冻结）时不能拿来换算，否则卡上写足月也会被乘回孕早期，退回只看种族速度
  const effectiveSpeed = getGestationEffectiveSpeed(profile);
  const gestationSpeed = effectiveSpeed > 0
    ? clampNumber(effectiveSpeed, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0)
    : clampNumber(getGestationSpeciesSpeed(profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0);
  const gestationalAgeDays = Number(pregnant.gestationalAgeDays);
  if (Number.isFinite(gestationalAgeDays) && gestationalAgeDays > 0) {
    pregnant.effectivePregnantDays = Math.max(1, gestationalAgeDays);
    const statedElapsed = Number(pregnant.pregnantDays);
    pregnant.pregnantDays = Number.isFinite(statedElapsed) && statedElapsed > 0
      ? Math.max(1, Math.floor(statedElapsed))
      : Math.max(1, Math.round(gestationalAgeDays / gestationSpeed));
  } else {
    // 只给实际天数（例如「怀胎三年」）：乘上种族速度与特殊变速倍率换算成发育进度。
    // 倍率是 0（冻结）时没有速度可乘，退回只看种族速度
    pregnant.pregnantDays = Math.max(1, Math.floor(Number(pregnant.pregnantDays) || 1));
    pregnant.effectivePregnantDays = Math.max(1, pregnant.pregnantDays * gestationSpeed);
  }
  delete pregnant.gestationalAgeDays;
  // 延产中：发育至少到逾期才算数；第一次延到 52 周，已超过就和之后一样再延 28 天
  const extensionCount = Math.max(0, Math.floor(Number(pregnant.extensionCount) || 0));
  // 资料写明在延产，但孕周写不到 42 周（多半把「过了预产期」也当延产）：延产必定已逾期，拉到刚满 42 周
  if (extensionCount > 0 && pregnant.effectivePregnantDays < POSTTERM_START_DAYS) {
    pregnant.effectivePregnantDays = POSTTERM_START_DAYS;
    pregnant.pregnantDays = Math.max(pregnant.pregnantDays, Math.round(POSTTERM_START_DAYS / gestationSpeed));
  }
  if (extensionCount > 0) {
    pregnant.extensionCount = extensionCount;
    pregnant.extensionUntilDays = extensionCount === 1 && pregnant.effectivePregnantDays < FIRST_EXTENSION_UNTIL_DAYS
      ? FIRST_EXTENSION_UNTIL_DAYS
      : pregnant.effectivePregnantDays + EXTENSION_MONTH_DAYS;
    const base = profile.base || {};
    if (!Number.isFinite(Number(base.uterineAtony)) || Number(base.uterineAtony) <= 0) base.uterineAtony = extensionCount - 1;
    profile.base = base;
  } else {
    pregnant.extensionCount = 0;
    pregnant.extensionUntilDays = null;
  }
  const motherDerivedType = profile?.base?.derivedType ? String(profile.base.derivedType) : null;
  const gestationModifierMultiplier = clampNumber(profile?.bio?.gestationModifierMultiplier, 0, GESTATION_SPEED_MAX, 1);
  for (const fetus of pregnant.fetuses) {
    if (Number.isFinite(Number(fetus?.maternalDerivedTypeProgress))) continue;
    const conceivedAtDays = Math.max(0, Number(fetus?.conceivedAtDays) || 0);
    const elapsedDays = Math.max(0, pregnant.pregnantDays - (conceivedAtDays / gestationSpeed));
    fetus.maternalDerivedTypeProgress = calculateDerivedInheritanceProgress({
      currentProgress: 0,
      affinity: fetus?.affinity,
      motherDerivedType,
      fatherDerivedType: fetus?.fatherDerivedType,
      fetusRace: fetus?.race,
      fetusBloodline: fetus?.bloodline,
      passedDays: elapsedDays,
      gestationModifierMultiplier,
    });
  }
  for (const fetus of pregnant.fetuses) fetus.amnionDurability = 100;
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
      if (parsed.bloodline) Object.assign(nextBase, getBloodlineInfo(nextBase.race, parsed.bloodline, 'explicit'));
    }
    if (profile.base.bloodline !== undefined) Object.assign(nextBase, getBloodlineInfo(nextBase.race ?? baseProfile.base.race, profile.base.bloodline, profile.base.bloodlineSource));
    if (profile.base.derivedType !== undefined) nextBase.derivedType = profile.base.derivedType === null ? null : String(profile.base.derivedType || '').trim() || null;
    if (profile.base.age !== undefined) {
      const age = Number(profile.base.age);
      if (Number.isFinite(age)) nextBase.age = age;
    }
    if (profile.base.bodySize !== undefined) {
      const bodySize = clampIndividualBodySize(profile.base.bodySize);
      if (bodySize !== null) nextBase.bodySize = bodySize;
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
    if (profile.base.penetrationState !== undefined || profile.base.penetrationSource !== undefined) {
      const penetrationState = ['idle', 'inserted', 'spent'].includes(profile.base.penetrationState)
        ? profile.base.penetrationState
        : 'idle';
      const penetrationSource = String(profile.base.penetrationSource || '').trim();
      nextBase.penetrationState = penetrationState !== 'idle' && penetrationSource ? penetrationState : 'idle';
      nextBase.penetrationSource = nextBase.penetrationState === 'idle' ? null : penetrationSource;
    }
    if (profile.base.sperms !== undefined) {
      nextBase.sperms = sanitizeRegistrySperms(profile.base.sperms);
    }
    if (profile.base.vitalityLevel !== undefined) {
      const vitalityLevel = Number(profile.base.vitalityLevel);
      if (Number.isFinite(vitalityLevel)) nextBase.vitalityLevel = Math.max(1, Math.min(7, Math.round(vitalityLevel)));
    }
    if (profile.base.uterineAtony !== undefined) {
      const uterineAtony = Number(profile.base.uterineAtony);
      if (Number.isFinite(uterineAtony)) nextBase.uterineAtony = Math.max(0, Math.min(9, Math.floor(uterineAtony)));
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

/**
 * 注册时先按单胎定一个产后恢复天数；真正的分娩／流产会按当下重算。
 * 注册在产后恢复中的角色，最近那一次分娩不算「之前的分娩」。
 */
function getRegisteredRecoveryDays(profile) {
  const experience = profile?.experience || {};
  const births = clampNumber(experience.naturalBirthExperience, 0, 999, 0) + clampNumber(experience.surgicalBirthExperience, 0, 999, 0);
  const inPostpartum = String(profile?.base?.stage || '') === '产后恢复';
  return computePostpartumRecoveryDays({
    recoveryCoefficient: getRecoveryCoefficientByRace(profile?.base?.race, profile?.base?.bloodline),
    vitalityLevel: profile?.base?.vitalityLevel,
    priorBirths: inPostpartum ? Math.max(0, births - 1) : births,
    fetusCount: 1,
  });
}

export function applyRegistryResult(chatState, result, { allowBreedingPsychology = true, useGestationModifier = true, gestationModifierMultiplier = null, initialCognitionRecords = undefined, bodySizeParents = [], random = Math.random } = {}) {
  const name = String(result?.name || '').trim();
  if (!name) throw new Error('注册结果缺少角色名称');
  const current = chatState.characters[name];
  const base = current && typeof current === 'object' ? current : createDefaultFemaleState(name);
  const sanitizedProfile = sanitizeRegistryProfile(result.profile, base.profile);
  if (!allowBreedingPsychology) delete sanitizedProfile.psychology;
  // 注册页没勾「使用妊娠变速」：模型就算写了变速也不采用，倍率会在下面重设回 1
  if (!useGestationModifier) delete sanitizedProfile.bio;
  // 勾了而且用拉杆设定了倍率：倍率以拉杆为准，模型只负责效果名称与说明；拉到 1 就等于没有变速
  else if (gestationModifierMultiplier !== null && gestationModifierMultiplier !== undefined && Number.isFinite(Number(gestationModifierMultiplier))) {
    const multiplier = clampNumber(Number(gestationModifierMultiplier), 0, GESTATION_SPEED_MAX, 1);
    const rawBio = result?.profile?.bio && typeof result.profile.bio === 'object' ? result.profile.bio : {};
    if (Math.abs(multiplier - 1) <= 0.000001) delete sanitizedProfile.bio;
    else {
      sanitizedProfile.bio = {
        gestationModifierMultiplier: multiplier,
        gestationModifierName: rawBio.gestationModifierName === null ? '' : String(rawBio.gestationModifierName || '').trim(),
        gestationModifierDescription: rawBio.gestationModifierDescription === null ? '' : String(rawBio.gestationModifierDescription || '').trim(),
      };
    }
  }
  const seededRecords = initialCognitionRecords === undefined ? undefined : initializeCognitionRecords(initialCognitionRecords, Number(chatState.minutesPassed) || 0);
  const effectiveRace = sanitizedProfile.base?.race ?? base.profile.base.race;
  const ancestry = getBloodlineInfo(effectiveRace, sanitizedProfile.base?.bloodline
    ?? (effectiveRace === base.profile.base.race ? base.profile.base.bloodline : null),
    sanitizedProfile.base?.bloodlineSource ?? base.profile.base.bloodlineSource);
  const mergedRaceProfile = getMergedRacePhysiologyProfile(effectiveRace, ancestry.bloodline);
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
        ...ancestry,
        // 卡上没写身材时按种族（与已知父母）的体型分布抽一次；可变与依个体抽不出来，留空
        bodySize: sanitizedProfile.base?.bodySize
          ?? (effectiveRace === base.profile.base.race ? clampIndividualBodySize(base.profile.base.bodySize) : null)
          ?? sampleBodySize(getExpectedBodySize(effectiveRace, ancestry.bloodline, bodySizeParents), random),
        vitality: getVitalityInitByLevel(sanitizedProfile.base?.vitalityLevel ?? base.profile.base.vitalityLevel),
        psyStress: getPsyStressInitByLevel(sanitizedProfile.base?.psyStressLevel ?? base.profile.base.psyStressLevel),
      },
      pregnant: {
        ...base.profile.pregnant,
        ...(sanitizedProfile.pregnant || {}),
        // 注册会从 1 重新编胎儿号，旧的发动体质可能刚好对上同一个编号：这次妊娠重抽
        ...(sanitizedProfile.pregnant ? { termReadiness: undefined, noticeSample: undefined, experienceBeforePregnancy: undefined } : {}),
      },
      experience: {
        ...base.profile.experience,
        ...(sanitizedProfile.experience || {}),
      },
      cognitionRecords: seededRecords ?? base.profile.cognitionRecords ?? [],
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
        // 注册按角色卡重新判定特殊变速：结果里没有，就代表没有，不能沿用上一次注册留下的倍率
        ...(sanitizedProfile.bio || { gestationModifierMultiplier: 1, gestationModifierName: '', gestationModifierDescription: '' }),
      },
      metabolism: {
        ...base.profile.metabolism,
        ...(sanitizedProfile.metabolism || {}),
      },
    },
    updatedAt: Date.now(),
  };
  if (Array.isArray(nextCharacter.profile?.pregnant?.fetuses) && nextCharacter.profile.pregnant.fetuses.length > 0) {
    normalizeRegisteredPregnancy(nextCharacter.profile, chatState);
  }
  nextCharacter.profile.bio = {
    ...nextCharacter.profile.bio,
    // 原本就在产后恢复、重新注册后仍在产后恢复：沿用分娩当下定好的天数
    recoveryDays: base.initialized && base.profile?.base?.stage === '产后恢复' && nextCharacter.profile.base?.stage === '产后恢复'
      ? clampNumber(base.profile?.bio?.recoveryDays, 1, 9999, 56)
      : getRegisteredRecoveryDays(nextCharacter.profile),
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
  const synchronized = syncCharacterStageFromProfile(nextCharacter);
  if (allowBreedingPsychology && Object.keys(nextPsychology.stageProfiles || {}).length) {
    const side = psychologySide(synchronized.profile.base?.stage);
    nextPsychology.enabled = true;
    nextPsychology.activeSide = side;
    nextPsychology.pendingSide = null;
    if (side) {
      const opposite = side === 'preg' ? 'mens' : 'preg';
      nextPsychology[opposite] = {};
      delete nextPsychology.stageProfiles[opposite];
    } else {
      nextPsychology.mens = {};
      nextPsychology.preg = {};
    }
  }
  chatState.characters[name] = normalizeCharacterPsychologyState(synchronized);
  ensureNaturalNoticeSample(chatState.characters[name].profile, chatState.reproductiveSettings);
  return chatState.characters[name];
}

/**
 * 初始技能／天赋的规则。技能页与「一次注册」共用，两边才不会走样。
 * fetusSource：'payload' 为技能页（胎儿来自 payload.target_fetuses）；'output' 为一次注册（胎儿是这次输出的 profile.pregnant.fetuses）
 */
function buildSkillRuleLines(options = {}) {
  const skillPrompt = String(options.skillPrompt || '').trim();
  const skillBaselinePrompt = String(options.skillBaselinePrompt || '').trim();
  const inheritedTalentsLocked = Boolean(options.inheritedTalentsLocked);
  const emptyCatalog = Boolean(options.emptyCatalog);
  const hasFetuses = Boolean(options.hasFetuses);
  const fromOutput = options.fetusSource === 'output';
  const fetusGuide = '依父母双方种族与血统、父方与母方的技能／天赋、胎儿对母体的亲和（正亲和较常长成擅长，负亲和较常长成苦手）与剧情判断。'
    + '胎儿还没出生，天赋宜浅：通常 level 在 -2 到 2 之间，除非设定明确，否则不要超过 ±3；不是每一胎都需要天赋。'
    + '规则与 initialTalents 相同：skill 必须能在图鉴或本次 skillDefinitions 中找到。';
  return [
    skillBaselinePrompt
      ? '严格遵守 payload.skill_baseline_prompt：它是本聊天的高优先级技能基准，决定允许辨识与建立的技能类型。即使图鉴已有被基准排除的技能，也不得因此为角色配置、建立或发展该类技能；既有资料无需删除。'
      : '本聊天未设置额外技能基准，按角色资料与技能图鉴谨慎判断。',
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
    hasFetuses && fromOutput
      ? '【胎儿天赋】若这名角色怀有胎儿，可在 fetusTalents 为胎儿配置先天天赋；fetusIndex 是该胎在你这次输出的 profile.pregnant.fetuses 中的位置（从 0 起算）。' + fetusGuide
      : '',
    hasFetuses && !fromOutput
      ? '【胎儿天赋】payload.target_fetuses 是这名角色腹中目前可见的胎儿（fetusIndex 从 0 起算）。可在 fetusTalents 为胎儿配置先天天赋：' + fetusGuide
        + '某胎若已有 talents，你输出的清单会整份取代它，要保留的请照抄；不想改动的胎儿就不要列出。'
      : '',
    skillPrompt ? '严格参考 payload.initial_skill_prompt 的额外要求。' : '用户没有提供额外要求，请仅依现有角色资料谨慎判断。',
    `输出前请逐条自检：initialSkills、initialTalents${hasFetuses ? '、fetusTalents' : ''} 里的每一个 skill，都必须能在 payload.skill_catalog 或本次 skillDefinitions 中找到完全相同的名称。`
      + '对不上的条目会被系统丢弃，请在输出前补上定义或删掉该条目。',
  ].filter(Boolean);
}

export function buildRegistrySkillSystemPrompt(options = {}) {
  const hasFetuses = Boolean(options.hasFetuses);
  return [
    '你是 AIRP 角色初始技能与天赋配置器。只处理 payload.target_character。',
    '根据角色卡、世界书、最近对话、已注册角色状态及用户提示，生成可供用户确认的初始技能／天赋 JSON。',
    ...buildSkillRuleLines({ ...options, fetusSource: 'payload' }),
    '只输出 JSON，不要输出解释或 Markdown。结构必须是：',
    '{',
    '  "skillDefinitions": [{"name":"string","description":"string"}],',
    '  "initialSkills": [{"skill":"技能精确名称或ID","level":1,"exp":0}],',
    hasFetuses
      ? '  "initialTalents": [{"skill":"技能精确名称或ID","level":0,"exp":0}],'
      : '  "initialTalents": [{"skill":"技能精确名称或ID","level":0,"exp":0}]',
    hasFetuses ? '  "fetusTalents": [{"fetusIndex":0,"talents":[{"skill":"技能精确名称或ID","level":1,"exp":0}]}]' : '',
    '}',
    '没有项目的数组也必须输出为空数组。',
  ].filter(Boolean).join('\n');
}

/** 日记写作规则。日记页与「一次注册」共用 */
function buildDiaryRuleLines(requestedDate = '') {
  return [
    '只为 payload.target_character 写一篇事后回顾式日记，不得替其他角色写。',
    '结合角色资料、现有状态、最近聊天与既有日记，使用第一人称，保持角色语气与认知边界。',
    '不要把日记写成即时旁白、系统总结或数值清单。',
    '严格遵守 payload.diary_writing_prompt。',
    requestedDate
      ? 'time 必须使用 payload.requested_diary_date。'
      : 'payload.requested_diary_date 为空时，请依故事上下文自行填写合适的日期标题；不要使用现实系统日期。',
  ];
}

/**
 * 「一次注册」附加在注册提示词后面的段落：同一次请求顺便产出第一篇日记与初始技能／天赋，
 * 省下日记与技能各自再送一次角色卡、世界书与聊天的成本
 */
export function buildRegistryBundlePrompt(options = {}) {
  const includeOutfit = options.includeOutfit === true;
  const includeSkills = options.includeSkills !== false;
  const parts = [includeOutfit ? '起始着衣' : '', '第一篇日记', includeSkills ? '初始技能／天赋' : ''].filter(Boolean);
  return [
    `【附带：${parts.join('、')}】`,
    `这次注册同时要产出这名角色的${parts.join('、')}，放在同一个 JSON 的顶层（与 name、profile 并列），${parts.length > 1 ? '每一项都必须输出' : '必须输出'}：`,
    includeOutfit ? `"currentOutfit": ${STARTING_OUTFIT_SAMPLE}` : '',
    '"diary": {"time":"日期标题","content":"日记正文"}',
    includeSkills ? '"skillSetup": {"skillDefinitions":[{"name":"string","description":"string"}],"initialSkills":[{"skill":"技能精确名称或ID","level":1,"exp":0}],"initialTalents":[{"skill":"技能精确名称或ID","level":0,"exp":0}],"fetusTalents":[{"fetusIndex":0,"talents":[{"skill":"技能精确名称或ID","level":1,"exp":0}]}]}' : '',
    ...(includeOutfit ? ['[起始着衣规则]', ...buildStartingOutfitRuleLines(options.outfitPrompt)] : []),
    '[日记规则]',
    ...buildDiaryRuleLines(options.requestedDate),
    `日记写的是注册当下这名角色的事后回顾，内容必须与你这次输出的 profile 一致（阶段、怀孕与否、${includeOutfit ? '衣着、' : ''}处境）。`,
    ...(includeSkills ? [
      '[技能／天赋规则]',
      ...buildSkillRuleLines({ ...options, hasFetuses: true, fetusSource: 'output' }),
      'skillSetup 里没有项目的数组也必须输出为空数组。',
    ] : []),
  ].filter(Boolean).join('\n');
}

/** 角色腹中目前可见的胎儿：已着床、角色自己知道的（未揭晓的异期胎、孕中孕内胎不算）。fetusIndex 依这个顺序 */
function getVisibleRegistryFetuses(character) {
  const fetuses = Array.isArray(character?.profile?.pregnant?.fetuses) ? character.profile.pregnant.fetuses : [];
  return fetuses.filter((fetus) => isFetusKnownToCharacter(fetus));
}

/** 把角色目前的技能、天赋与可见胎儿的天赋写成技能页可编辑、可再写入的 JSON（技能以名称表示） */
export function buildSkillSetupEditorValue(chatState, targetName) {
  const character = chatState.characters?.[targetName];
  const catalog = normalizeSkillCatalog(chatState.skillCatalog);
  const named = (list) => (Array.isArray(list) ? list : []).map((entry) => ({
    skill: resolveSkillDefinition(catalog, entry.skillId)?.name ?? entry.skillId,
    level: entry.level,
    exp: entry.exp,
  }));
  const fetusTalents = getVisibleRegistryFetuses(character)
    .map((fetus, fetusIndex) => ({ fetusIndex, talents: named(normalizeTalentList(fetus.talents)) }))
    .filter((entry) => entry.talents.length > 0);
  return {
    skillDefinitions: [],
    initialSkills: named(character?.profile?.skills),
    initialTalents: named(character?.profile?.talents),
    ...(fetusTalents.length > 0 ? { fetusTalents } : {}),
  };
}

function sanitizeRegistrySkillInferenceResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('技能／天赋生成结果必须是 JSON 对象');
  const fields = ['skillDefinitions', 'initialSkills', 'initialTalents', 'fetusTalents'];
  for (const field of fields) {
    if (result[field] !== undefined && !Array.isArray(result[field])) throw new Error(`${field} 必须是数组`);
  }
  return {
    skillDefinitions: Array.isArray(result.skillDefinitions) ? result.skillDefinitions : [],
    initialSkills: Array.isArray(result.initialSkills) ? result.initialSkills : [],
    initialTalents: Array.isArray(result.initialTalents) ? result.initialTalents : [],
    fetusTalents: Array.isArray(result.fetusTalents) ? result.fetusTalents : [],
  };
}

export async function runRegistrySkillInference(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  if (!isSkillSystemEnabled(settings)) throw new Error('技能系统已在系统页关闭');
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
  payload.skill_baseline_prompt = String(chatState.skillBaselinePrompt || '').trim();
  payload.skill_catalog = normalizeSkillCatalog(chatState.skillCatalog);
  payload.existing_skill_setup = {
    skills: normalizeSkillList(chatState.characters[targetName]?.profile?.skills),
    talents: normalizeTalentList(chatState.characters[targetName]?.profile?.talents),
  };
  const inheritedTalentsLocked = Boolean(chatState.characters[targetName]?.profile?.childSource);
  payload.inherited_talents_locked = inheritedTalentsLocked;
  const visibleFetuses = getVisibleRegistryFetuses(chatState.characters[targetName]);
  if (visibleFetuses.length > 0) {
    payload.target_fetuses = visibleFetuses.map((fetus, fetusIndex) => ({
      fetusIndex,
      gender: fetus.gender || null,
      race: fetus.race || null,
      fathers: fetus.fathers || null,
      fatherRace: fetus.fatherRace || null,
      embryoType: fetus.embryoType || null,
      affinity: Number.isFinite(Number(fetus.affinity)) ? Number(fetus.affinity) : 0,
      talents: normalizeTalentList(fetus.talents),
    }));
  }
  const systemPrompt = options.skillSystemPrompt
    || buildRegistrySkillSystemPrompt({
      skillPrompt,
      skillBaselinePrompt: payload.skill_baseline_prompt,
      inheritedTalentsLocked,
      // 图鉴为空＝本次是这个聊天的第一个角色，所有引用都只能来自本次 skillDefinitions
      emptyCatalog: payload.skill_catalog.length === 0,
      hasFetuses: visibleFetuses.length > 0,
    });
  const result = await callOpenAICompatible(settings, payload, systemPrompt, { flow: 'skill' });
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
  const fetusTalents = result?.fetusTalents ?? [];
  if (!Array.isArray(definitions)) throw new Error('注册结果的 skillDefinitions 必须是数组');
  if (!Array.isArray(fetusTalents)) throw new Error('注册结果的 fetusTalents 必须是数组');
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

  // 胎儿天赋：只改有列出的胎儿，整份取代；解析不到的技能与对不上的胎儿编号一并回报
  if (fetusTalents.length > 0) {
    const visibleFetuses = getVisibleRegistryFetuses(character);
    const skipped = report && typeof report === 'object' && Array.isArray(report.skipped) ? report.skipped : [];
    let fetusCount = 0;
    for (const entry of fetusTalents) {
      const index = Number(entry?.fetusIndex);
      const fetus = Number.isInteger(index) ? visibleFetuses[index] : null;
      if (!fetus) {
        skipped.push(`胎儿#${entry?.fetusIndex ?? '(空白)'}`);
        continue;
      }
      const normalized = normalizeInitialSkillTalentConfig({ talents: entry?.talents }, workingState.skillCatalog);
      skipped.push(...normalized.skipped);
      fetus.talents = normalized.talents;
      fetusCount += 1;
    }
    if (report && typeof report === 'object') {
      report.skipped = skipped;
      report.fetusCount = fetusCount;
    }
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

  const next = normalizeCharacterPsychologyState(JSON.parse(JSON.stringify(current)));
  const side = psychologySide(next.profile.base?.stage);
  if (!side) throw new Error('恢复期不初始化月经或妊娠心理');
  if (!inference[side]) throw new Error('繁育推演与当前生理侧不符，请重新推演');
  const stageProfiles = normalizePsychologyStageProfiles({ [side]: inference.stageProfiles?.[side] });
  const missing = getMissingPsychologyStageProfileKeys(stageProfiles, side);
  if (missing.length) throw new Error('繁育推演缺少当前侧 3x6 阶段解释');
  const config = side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
  next.profile.psychology = {
    enabled: true, activeSide: side, pendingSide: null,
    generation: (Number(next.profile.psychology.generation) || 0) + 1,
    mens: {}, preg: {}, stageProfiles,
    [side]: normalizePsychologyGroup(inference[side], config, { stageProfiles: stageProfiles[side] }),
  };
  next.updatedAt = Date.now();
  chatState.characters[name] = next;
  return chatState.characters[name];
}

export function applyRegistryBreedingInference(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
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
  Object.assign(character.profile.base, getBloodlineInfo(character.profile.base.race, resolved.child.bloodline, resolved.child.bloodlineSource));
  character.profile.bio = character.profile.bio && typeof character.profile.bio === 'object' ? character.profile.bio : {}; Object.assign(character.profile.bio, getMergedRacePhysiologyProfile(character.profile.base.race, character.profile.base.bloodline) || {});
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

/** 从注册结果拿出一次注册附带的日记与技能（不让它们混进角色资料） */
function takeRegistryBundle(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { diary: null, skillSetup: null, currentOutfit: null };
  const pick = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
  const diary = pick(result.diary);
  const skillSetup = pick(result.skillSetup);
  // 模型偶尔会把着衣塞进 profile 里，一并取出
  const currentOutfit = pick(result.currentOutfit) || pick(result.profile?.currentOutfit);
  delete result.diary;
  delete result.skillSetup;
  delete result.currentOutfit;
  if (pick(result.profile)) delete result.profile.currentOutfit;
  return { diary, skillSetup, currentOutfit };
}

/**
 * 先把附带的新技能定义登记进工作用图鉴，再把胎儿天赋挂到这次输出的胎儿上（依输出顺序的 fetusIndex）。
 * 图鉴等注册成功后才写回；定义不合格、名称对不上、胎儿编号不存在的都跳过并回报
 */
function prepareBundleSkills(chatState, result, skillSetup, report) {
  let catalog = normalizeSkillCatalog(chatState.skillCatalog);
  let nextSkillId = normalizeNextSkillId(catalog, chatState.nextSkillId);
  report.skipped = Array.isArray(report.skipped) ? report.skipped : [];
  report.fetusCount = 0;
  if (!skillSetup) return { catalog, nextSkillId };
  const definitions = Array.isArray(skillSetup.skillDefinitions) ? skillSetup.skillDefinitions.slice(0, 20) : [];
  for (const definition of definitions) {
    const registered = registerSkillDefinition(catalog, definition && typeof definition === 'object' ? definition : {}, nextSkillId);
    if (!registered.ok) {
      report.skipped.push(`定义「${String(definition?.name || '(空白)')}」`);
      continue;
    }
    catalog = registered.catalog;
    nextSkillId = registered.nextSkillId;
  }
  const fetuses = Array.isArray(result?.profile?.pregnant?.fetuses) ? result.profile.pregnant.fetuses : [];
  for (const entry of (Array.isArray(skillSetup.fetusTalents) ? skillSetup.fetusTalents : [])) {
    const index = Number(entry?.fetusIndex);
    const fetus = Number.isInteger(index) ? fetuses[index] : null;
    if (!fetus || typeof fetus !== 'object') {
      report.skipped.push(`胎儿#${entry?.fetusIndex ?? '(空白)'}`);
      continue;
    }
    const normalized = normalizeInitialSkillTalentConfig({ talents: entry?.talents }, catalog);
    report.skipped.push(...normalized.skipped);
    fetus.talents = normalized.talents;
    report.fetusCount += 1;
  }
  return { catalog, nextSkillId };
}

/** 角色注册完成后，写入附带的起始着衣、技能／天赋与第一篇日记 */
function applyRegistryBundle(chatState, targetName, bundleOutput, workingSkills, report) {
  if (bundleOutput.includeOutfit) {
    try {
      report.outfit = bundleOutput.currentOutfit ? applyStartingOutfit(chatState, targetName, bundleOutput.currentOutfit) : null;
      if (!report.outfit) report.outfitError = '模型没有给出起始着衣';
    } catch (error) {
      report.outfitError = String(error?.message || error);
    }
  }
  chatState.skillCatalog = workingSkills.catalog;
  chatState.nextSkillId = workingSkills.nextSkillId;
  if (bundleOutput.skillSetup) {
    const skillReport = {};
    applyRegistrySkillSetup(chatState, targetName, {
      skillDefinitions: [],
      initialSkills: Array.isArray(bundleOutput.skillSetup.initialSkills) ? bundleOutput.skillSetup.initialSkills : [],
      initialTalents: Array.isArray(bundleOutput.skillSetup.initialTalents) ? bundleOutput.skillSetup.initialTalents : [],
    }, skillReport);
    report.skipped.push(...(skillReport.skipped || []));
    report.skillsWritten = true;
  }
  const diary = bundleOutput.diary;
  if (diary && String(diary.time || '').trim() && String(diary.content || '').trim()) {
    const written = writeDiaryEntry(chatState, targetName, diary, { replaceSameDay: true });
    if (written.applied) report.diary = { time: String(diary.time).trim(), content: String(diary.content).trim() };
    else report.diaryError = written.message;
  } else {
    report.diaryError = '模型没有给出日记';
  }
  return chatState.characters[targetName];
}

export async function runRegistry(ctx, options = {}) {
  if (options.initialCognitionRecords !== undefined) initializeCognitionRecords(options.initialCognitionRecords);
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  const chatState = getChatState(ctx, settings);
  const targetName = resolveRegistryTargetName(ctx, options.targetName);
  // 玩家勾的特殊来历分两半：需要模型编出胎儿结构的走提示词，只需要名字的在结果回来后硬套
  const specialFetus = options.specialFetus || null;
  const baseNotes = String(options.customNotes !== undefined ? options.customNotes : (settings.registryCustomNotes || '')).trim();
  const customNotes = [baseNotes, buildSpecialFetusNotes(specialFetus)].filter(Boolean).join('\n\n');
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
  payload.initial_cognition_records = options.initialCognitionRecords || [];
  if (includeBreedingPsychology) payload.breeding_inference = options.breedingInference;
  // 一次注册：日记与技能的规则、图鉴随同这次请求送出
  const bundle = options.bundle && typeof options.bundle === 'object' ? options.bundle : null;
  const bundleSkills = Boolean(bundle) && isSkillSystemEnabled(settings);
  const bundleOutfit = Boolean(bundle) && isWardrobeSystemEnabled(settings);
  if (bundleOutfit) payload.outfit_prompt = String(bundle.outfitPrompt || '').trim();
  if (bundleSkills) {
    payload.skill_baseline_prompt = String(chatState.skillBaselinePrompt || '').trim();
    payload.skill_catalog = normalizeSkillCatalog(chatState.skillCatalog);
    payload.initial_skill_prompt = String(bundle.skillPrompt || '').trim();
  }
  if (bundle) {
    payload.diary_writing_prompt = String(bundle.diaryWritingPrompt || settings.diaryWritingPrompt || DEFAULT_DIARY_WRITING_PROMPT).trim();
    payload.requested_diary_date = String(bundle.requestedDate || '').trim() || null;
  }
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
  const basePrompt = options.systemPrompt || buildRegistrySystemPrompt(settings, { ...options, customNotes, declaredRace, payload, includeBreedingPsychology });
  const systemPrompt = bundle
    ? `${basePrompt}\n\n${buildRegistryBundlePrompt({
      includeSkills: bundleSkills,
      includeOutfit: bundleOutfit,
      outfitPrompt: payload.outfit_prompt || '',
      skillPrompt: payload.initial_skill_prompt,
      skillBaselinePrompt: payload.skill_baseline_prompt,
      emptyCatalog: !payload.skill_catalog?.length,
      requestedDate: payload.requested_diary_date || '',
    })}`
    : basePrompt;
  recordRegistryRequestDebug(systemPrompt, payload);
  try {
    const result = await callOpenAICompatible(
      settings,
      payload,
      systemPrompt,
      { flow: 'registry' },
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
      Object.assign(result.profile.base, getBloodlineInfo(result.profile.base.race, sourceChildContext.child.bloodline, sourceChildContext.child.bloodlineSource));
      if (sourceChildContext.child.derivedType) result.profile.base.derivedType = String(sourceChildContext.child.derivedType);
      else delete result.profile.base.derivedType;
    }
    // 使用者已经明确指定要注册谁，模型不得改名。
    // 显式比例同样由用户锁定，不能依赖模型把 1/4 再说成「混血」后丢失份额。
    const declared = parseRaceDescriptor(options.declaredRace);
    if (!sourceChildContext && declared.bloodline) {
      result.profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
      result.profile.base = result.profile.base && typeof result.profile.base === 'object' ? result.profile.base : {};
      result.profile.base.race = declared.race;
      Object.assign(result.profile.base, getBloodlineInfo(declared.race, declared.bloodline, 'explicit'));
      if (declared.derivedType) result.profile.base.derivedType = declared.derivedType;
    }
    // payload 里同时有角色卡与 target_character，模型常把角色卡名当成 name 回传，
    // 于是角色被注册成卡片名而不是输入的名字（重新注册一次又「好了」，其实只是这次没抽到）。
    result.name = targetName;
    const bundleOutput = bundle ? takeRegistryBundle(result) : null;
    if (bundleOutput && !bundleSkills) bundleOutput.skillSetup = null;
    if (bundleOutput) bundleOutput.includeOutfit = bundleOutfit;
    const bundleReport = options.bundleReport && typeof options.bundleReport === 'object' ? options.bundleReport : {};
    // 胎儿天赋要趁胎儿还是这次输出的顺序时挂上去：注册的正规化与特殊来历可能调整胎儿阵列
    const workingSkills = bundleOutput ? prepareBundleSkills(chatState, result, bundleOutput.skillSetup, bundleReport) : null;
    applyRequestedSpecialFetus(result, specialFetus);
    recordRegistryResultDebug(result);
    chatState.reproductiveSettings = normalizeReproductiveSettings(settings.reproductiveSettings);
    let character = applyRegistryResult(chatState, result, {
      allowBreedingPsychology: includeBreedingPsychology,
      useGestationModifier: options.useGestationModifier === true,
      gestationModifierMultiplier: options.gestationModifierMultiplier ?? null,
      initialCognitionRecords: options.initialCognitionRecords,
      bodySizeParents: sourceChildContext ? [
        { race: sourceChildContext.child?.fatherRace, bodySize: sourceChildContext.child?.fatherBodySize },
        { race: chatState.characters[sourceChildContext.motherName]?.profile?.base?.race, bodySize: chatState.characters[sourceChildContext.motherName]?.profile?.base?.bodySize },
      ] : [],
    });
    if (sourceChildContext) character = applyRegistryChildInheritance(chatState, targetName, requestedSource).character;
    if (bundleOutput) character = applyRegistryBundle(chatState, targetName, bundleOutput, workingSkills, bundleReport);
    recordChatStateSnapshot(ctx, chatState, { reason: 'registry' });
    saveSettings(ctx);
    return character;
  } catch (error) {
    recordRegistryResultDebug(null, error);
    throw error;
  }
}

// ── 繁育推演 stageProfiles 的容错 ─────────────────────────
// 不同模型常把 3×6 阶段解释写成别的形状：少了侧别一层、塞进 mens／preg 里、
// 阶段键写成 1-25、100+。这里全部接受；仍有缺漏就带着缺项重问一次，两次都缺才报错。

function canonicalStageKey(key) {
  const text = String(key ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[-~～–—至到]/g, '_');
  if (/^(>|＞)?100(\+|＋|_?plus|以上|_)$/.test(text) || text === '>100' || text === '＞100') return '100_plus';
  return text;
}

function canonicalStageField(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
  return Object.fromEntries(Object.entries(field).map(([key, value]) => [
    canonicalStageKey(key),
    value && typeof value === 'object' && !Array.isArray(value) ? (value.text ?? value.description ?? value.desc ?? '') : value,
  ]));
}

function canonicalStageGroup(group) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return null;
  return Object.fromEntries(Object.entries(group).map(([axis, field]) => [String(axis).replace(/_(value|interpret|stages?)$/, ''), canonicalStageField(field)]));
}

export function pickBreedingStageProfiles(result, side) {
  const fields = side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
  const sideBlock = result?.[side] && typeof result[side] === 'object' ? result[side] : {};
  const candidates = [
    result?.stageProfiles?.[side],
    sideBlock.stageProfiles?.[side],
    sideBlock.stageProfiles,
    result?.stageProfiles,
    result?.stage_profiles?.[side],
    result?.stage_profiles,
  ];
  let best = {};
  let bestMissing = Infinity;
  for (const candidate of candidates) {
    const group = canonicalStageGroup(candidate);
    if (!group || !Object.keys(fields).some((axis) => group[axis])) continue;
    const normalized = normalizePsychologyStageProfiles({ [side]: group });
    const missing = getMissingPsychologyStageProfileKeys(normalized, side).length;
    if (missing < bestMissing) {
      best = normalized;
      bestMissing = missing;
    }
  }
  return best;
}

async function callBreedingWithStageRetry(settings, payload, systemPrompt, options = {}) {
  const ask = (prompt) => callOpenAICompatible(settings, payload, prompt, { flow: 'breeding' });
  const first = await ask(systemPrompt);
  const result = normalizeBreedingInferenceResult(first);
  const side = options.psychologySide || (result?.preg ? 'preg' : result?.mens ? 'mens' : null);
  if (!side) return first;
  const missing = getMissingPsychologyStageProfileKeys(pickBreedingStageProfiles(result, side), side);
  if (missing.length === 0) return first;
  const fields = Object.keys(side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS);
  const correction = [
    `上一次输出缺少 stageProfiles 的 ${missing.length} 项（例如 ${missing.slice(0, 3).join('、')}）。请重新输出完整 JSON。`,
    `stageProfiles 必须写成 {"${side}":{${fields.map((axis) => `"${axis}":{${PSY_STAGE_KEYS.map((key) => `"${key}":"……"`).join(',')}}`).join(',')}}}，三轴 × 六阶段全部填写，键名逐字一致。`,
  ].join('\n');
  return ask(`${systemPrompt}\n${correction}`);
}
