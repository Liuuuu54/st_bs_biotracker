import { normalizeExperience, initializeCognitionRecords, normalizePaternityClaims, normalizeReproductiveSettings, psychologySide } from './reproductive.js';
import { getWorldbookEntryActivationMode, worldbookEntryKeywordsMatch } from './worldbook_match.js';
import { callOpenAICompatible } from './api.js';
import { buildStartingOutfitSubmitTool, buildWardrobePrepSubmitTool } from './native_tools.js';
import { getEffectiveSettings } from './card_settings.js';
import { buildBreedingInferenceSystemPrompt, buildDiaryRuleLines, buildRegistryBundlePrompt, buildRegistrySkillSystemPrompt, buildRegistrySystemPrompt, buildSireExtractionSystemPrompt, buildSpecialFetusNotes, buildStartingOutfitSystemPrompt, buildWardrobePrepSystemPrompt, DEFAULT_DIARY_WRITING_PROMPT, QUICKENING_RULE, SPECIAL_FETUS_HINTS, WARDROBE_FIT_CONSISTENCY_RULE } from './prompts/rules.js';
import { clampIndividualBodySize, getExpectedBodySize, normalizeSheathOffset, normalizeSwordOffset, sampleBodySize } from './body_size.js';
import { findSeasonReference } from './season_phase.js';
import { descriptionListToObject, normalizeDescriptionList } from './descriptions.js';
import { getSireRecord, normalizeSpermQuality, pruneFutaSireRecord } from './sires.js';
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
  normalizeWorldbookMode,
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
import { applyToolCall, TOOL_DEFINITIONS, BACK_SIDES, calculateDerivedInheritanceProgress, canHostNestedPregnancy, ensureNaturalNoticeSample, isFetusKnownToCharacter, writeDiaryEntry } from './tools.js';
import { EXTENSION_MONTH_DAYS, FIRST_EXTENSION_UNTIL_DAYS, GESTATION_SPEED_MAX, GESTATION_SPEED_MIN, MENSTRUAL_STAGES, POSTTERM_START_DAYS, PREGNANCY_STAGE_DAYS } from './stage_config.js';
export { QUICKENING_RULE, buildBreedingInferenceSystemPrompt, WARDROBE_FIT_CONSISTENCY_RULE, buildWardrobePrepSystemPrompt, buildStartingOutfitSystemPrompt, buildSireExtractionSystemPrompt, buildRegistrySystemPrompt, SPECIAL_FETUS_HINTS, buildSpecialFetusNotes, buildRegistrySkillSystemPrompt, buildRegistryBundlePrompt };

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

function filterRegistryWorldbookEntries(value, excludedNames, settings = null, recentMessages = [], options = {}) {
  if (!value || typeof value !== 'object') return null;
  const mode = normalizeWorldbookMode(settings?.trackerWorldbookMode);
  const globalBookName = String(options.globalBookName || '').trim();
  // characterScopeLists：附加知识书带书名前缀，但白名单仍走角色侧名单
  const includedNames = globalBookName && options.characterScopeLists !== true
    ? parseRegistryGlobalWorldbookIncludeNames(settings)
    : parseRegistryWorldbookIncludeNames(settings);
  const normalizeEntryName = (entry) => getWorldbookEntryDisplayName(entry);

  const keepEntry = (entry) => {
    const name = normalizeEntryName(entry);
    const selectionName = globalBookName ? formatGlobalWorldbookSelectionName(globalBookName, name) : name;
    if (mode === 'allowlist_all') return Boolean(name) && worldbookSelectionMatches(includedNames, selectionName, name);
    if (entry?.enabled === false || entry?.disable === true) return false;
    if (name && worldbookSelectionMatches(excludedNames, selectionName, name)) return false;
    const activationMode = getWorldbookEntryActivationMode(entry);
    if (activationMode === 'always' || activationMode === 'constant') return true;
    if (activationMode === 'keyword' || activationMode === 'selective') return worldbookEntryKeywordsMatch(entry, recentMessages);
    return false;
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
  const result = await callOpenAICompatible(settings, payload, buildStartingOutfitSystemPrompt({ outfitPrompt }), {
    flow: 'outfit',
    // 回复格式选了工具调用时改用一个提交工具交结果，衣物结构沿用追踪工具的定义
    nativeSubmitTool: buildStartingOutfitSubmitTool(TOOL_DEFINITIONS),
  });
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
  const result = await callOpenAICompatible(settings, payload, systemPrompt, {
    flow: 'wardrobe',
    nativeSubmitTool: buildWardrobePrepSubmitTool(TOOL_DEFINITIONS),
  });
  return sanitizeWardrobePrepResult(result);
}

/** 模型回传的精方档案 → 精方表单的值；数值不合理就当没给 */
export function sanitizeSireExtractionResult(result) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const age = Number(value.age);
  // 品质没给（null）就不填表单，保留使用者原本的值；给了就夹在 0.25–4
  const quality = value.spermQuality === null || value.spermQuality === undefined || value.spermQuality === '' ? NaN : Number(value.spermQuality);
  const descriptions = value.descriptions && typeof value.descriptions === 'object' && !Array.isArray(value.descriptions)
    ? Object.entries(value.descriptions)
      .map(([name, text]) => ({ name: String(name || '').replace(/^\*/, '').trim(), value: String(text ?? '').trim() }))
      .filter((entry) => entry.name && entry.value)
    : [];
  return {
    age: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
    bodySize: clampIndividualBodySize(value.bodySize),
    swordOffset: value.swordOffset === null || value.swordOffset === undefined || value.swordOffset === '' || !Number.isFinite(Number(value.swordOffset))
      ? null
      : normalizeSwordOffset(value.swordOffset),
    spermQuality: Number.isFinite(quality) && quality > 0 ? normalizeSpermQuality(quality) : null,
    isHere: value.isHere !== false,
    descriptions,
  };
}

export async function runRegistrySireExtraction(ctx, options = {}) {
  const settings = getEffectiveSettings(ctx, getSettings(ctx));
  const chatState = getChatState(ctx, settings);
  const targetName = String(options.targetName || '').trim();
  if (!targetName) throw new Error('精方抽取需要 targetName');
  const declaredRace = String(options.declaredRace || '').trim() || '人类';
  const userInstruction = String(options.userInstruction || '').trim();
  const payload = await buildRegistryPayload(ctx, settings, chatState, {
    targetName,
    reason: 'sire_extraction',
    customNotes: '',
    declaredRace,
    userInstruction,
  });
  // 卵方状态与精方无关；有旧档案时附上，让模型在原有描述上补
  payload.existing_state = null;
  payload.existing_sire = getSireRecord(chatState, targetName);
  payload.father_snapshot = options.prefill ? {
    race: options.prefill.race ?? null,
    bloodline: options.prefill.bloodline ?? null,
    derivedType: options.prefill.derivedType ?? null,
    bodySize: options.prefill.bodySize ?? null,
  } : null;
  // 天赋只能用这个聊天的技能图鉴；技能系统关着就不问
  const withTalents = isSkillSystemEnabled(settings) && Array.isArray(chatState.skillCatalog) && chatState.skillCatalog.length > 0;
  if (withTalents) payload.skill_catalog = chatState.skillCatalog.map((skill) => ({ name: skill.name, description: skill.description }));
  const systemPrompt = buildSireExtractionSystemPrompt(settings, { declaredRace, userInstruction, withTalents });
  const result = await callOpenAICompatible(settings, payload, systemPrompt, { flow: 'sire' });
  const sanitized = sanitizeSireExtractionResult(result);
  // 天赋按名字对到图鉴，对不上的略过；没问天赋时回 null，注册时保留原本的
  if (!withTalents) return { ...sanitized, talents: null, skippedTalents: [] };
  const resolved = normalizeInitialSkillTalentConfig({ talents: Array.isArray(result?.talents) ? result.talents : [] }, chatState.skillCatalog);
  return { ...sanitized, talents: resolved.talents, skippedTalents: resolved.skipped };
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
    base: { stage: subject.base?.stage },
    // 胎动感知看孕周：只给阶段的话，孕中期 14–20 周分不出来
    ...(Number(subject.pregnant?.effectivePregnantDays) > 0 ? { pregnant: { gestationalWeeks: Math.floor(Number(subject.pregnant.effectivePregnantDays) / 7) } } : {}),
    cognitionRecords: subject.cognitionRecords || [],
    diary: subject.diary || [], experience: subject.experience || {},
    children: (subject.children || []).map(({ name, selectedFather, age }) => ({ name, selectedFather, age })),
    psychology: initialSide ? { [initialSide]: subject.psychology?.[initialSide] || {} } : undefined,
    descriptions: { normalDescription: descriptionListToObject(subject.descriptions?.normalDescription) },
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
        fatherBodySize: clampIndividualBodySize(item.fatherBodySize),
        ...(normalizePaternityClaims(item.paternityClaims).length ? { paternityClaims: normalizePaternityClaims(item.paternityClaims) } : {}),
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
          // 特殊来历：让角色卡开场就能是同卵多胎、异期复孕、孕中孕或胎内回归。
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
// 一颗受精卵自然分裂最多 4 胎（见 tools.js 的著床分裂）
const MAX_IDENTICAL_GROUP_SIZE = 4;
// 同卵是同一颗受精卵：这些遗传栏位整组必须一致
const IDENTICAL_SHARED_KEYS = ['fathers', 'provider', 'race', 'bloodline', 'bloodlineSource', 'fatherRace', 'fatherBloodline', 'fatherBloodlineSource', 'fatherDerivedType', 'gender', 'embryoType'];

/** 平均切成每组不超过上限的几组：7 → 4+3、5 → 3+2、9 → 3+3+3 */
function chunkIdenticalMembers(members) {
  const groupCount = Math.ceil(members.length / MAX_IDENTICAL_GROUP_SIZE);
  const chunks = [];
  let start = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const size = Math.floor(members.length / groupCount) + (index < members.length % groupCount ? 1 : 0);
    chunks.push(members.slice(start, start + size));
    start += size;
  }
  return chunks;
}

/** 超过上限的组拆成几组：先按性别分开（XY 四胞胎＋XX 三胞胎这类写法），再平均切 */
function splitOversizedIdenticalGroup(members) {
  if (members.length <= MAX_IDENTICAL_GROUP_SIZE) return [members];
  const byGender = new Map();
  for (const fetus of members) {
    const key = String(fetus.gender ?? '');
    if (!byGender.has(key)) byGender.set(key, []);
    byGender.get(key).push(fetus);
  }
  const chunks = [];
  const leftovers = [];
  for (const bucket of byGender.values()) {
    if (bucket.length >= 2) chunks.push(...chunkIdenticalMembers(bucket));
    else leftovers.push(...bucket);
  }
  if (leftovers.length >= 2) chunks.push(...chunkIdenticalMembers(leftovers));
  else if (leftovers.length === 1) {
    // 落单的那胎并进还有空位的最小一组，跟着该组统一；都满了才独立成单胎
    const roomy = chunks.filter((chunk) => chunk.length < MAX_IDENTICAL_GROUP_SIZE).sort((a, b) => a.length - b.length)[0];
    if (roomy) roomy.push(leftovers[0]);
    else chunks.push(leftovers);
  }
  return chunks;
}

/**
 * 同卵分组：模型可用 identicalGroup 区分不同受精卵；只标 identical 没给组别的，
 * 按父方、种族、性别自动成组。每组超过 4 胎时自动拆组，组内遗传栏位以第一胎为准，
 * 组号统一换成组内第一胎的 embryoId，免得模型给的数字撞号。落单的撤掉标签。
 */
function normalizeRegisteredIdenticalGroups(fetuses) {
  const groups = new Map();
  for (const fetus of fetuses) {
    const group = Number(fetus.identicalGroup);
    let key = null;
    if (Number.isInteger(group) && group > 0) key = `group:${group}`;
    else if (fetus.tags.includes('identical')) key = `auto:${JSON.stringify([fetus.fathers, fetus.provider, fetus.race, fetus.gender])}`;
    delete fetus.identicalGroup;
    fetus.tags = fetus.tags.filter((tag) => tag !== 'identical');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fetus);
  }
  for (const members of groups.values()) {
    for (const chunk of splitOversizedIdenticalGroup(members)) {
      if (chunk.length < 2) continue;
      const [leader] = chunk;
      for (const fetus of chunk) {
        for (const key of IDENTICAL_SHARED_KEYS) {
          if (fetus === leader) continue;
          if (leader[key] === undefined) delete fetus[key];
          else fetus[key] = leader[key] && typeof leader[key] === 'object' ? structuredClone(leader[key]) : leader[key];
        }
        fetus.identicalGroup = leader.embryoId;
        fetus.tags = sanitizeFetusTagList([...fetus.tags, 'identical']);
      }
    }
  }
}

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

  normalizeRegisteredIdenticalGroups(fetuses);

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
    if (profile.base.sheathOffset !== undefined && profile.base.sheathOffset !== null) {
      nextBase.sheathOffset = normalizeSheathOffset(profile.base.sheathOffset);
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
      // 模型给的是 { 字段名: 内容 }（旧字串格式也接受），存档统一转成带 updatedAt 的阵列；重新注册以新结果取代该栏
      descriptions: {
        ...base.profile.descriptions,
        ...Object.fromEntries(Object.entries(sanitizedProfile.descriptions || {})
          .map(([field, value]) => [field, normalizeDescriptionList(value, Number(chatState.minutesPassed) || 0)])),
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
  // 第一次注册：预设状态的月经阶段是按人类（没有乏情）抽的，要照这个角色的物种重抽，
  // 乏情占比高的物种才会照时间比例落在乏情期。重新注册已有角色就沿用原本的阶段。
  if (!current?.initialized && !sanitizedProfile.base?.stage && MENSTRUAL_STAGES.includes(String(nextCharacter.profile.base?.stage || ''))) {
    nextCharacter.profile.base.stage = '';
  }
  // 同族季节对齐（1.2.4）：主血统相同、有季节的已注册者在不在乏情、第几轮，新角色跟着对齐一次；
  // 只有阶段交给系统推导时才用得到（重新注册的角色沿用原本的阶段）
  const seasonReference = findSeasonReference(chatState, {
    race: nextCharacter.profile.base?.race,
    bloodline: nextCharacter.profile.base?.bloodline,
    excludeName: name,
  });
  const synchronized = syncCharacterStageFromProfile(nextCharacter, { seasonPhase: seasonReference ? seasonReference.phase : null });
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
  // 同名精方档案（扶她）此后一律以卵方为准，只留精子品质
  pruneFutaSireRecord(chatState, name);
  return chatState.characters[name];
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
    // 注册页手动指定了鞘偏移就以使用者为准，盖过模型的判断
    if (options.sheathOffset !== null && options.sheathOffset !== undefined && Number.isFinite(Number(options.sheathOffset))) {
      result.profile = result.profile && typeof result.profile === 'object' ? result.profile : {};
      result.profile.base = result.profile.base && typeof result.profile.base === 'object' ? result.profile.base : {};
      result.profile.base.sheathOffset = Number(options.sheathOffset);
    }
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
