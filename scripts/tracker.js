import { callOpenAICompatible, resolveOverallDeadlineMs } from './api.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from './tracker_prompt_context.js';
import { DEFAULT_WEAR_STATE, sanitizeWearState } from './wardrobe_config.js';
import { applyToolCallsResult, TOOL_DEFINITIONS } from './tools.js';
import {
  buildRecentMessages,
  buildSignature,
  cloneValue,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  getCharacterCard,
  getCharacterWorldBookName,
  getCharacterWorldBookNameViaSTscript,
  getActiveGlobalWorldBookNames,
  getCharacterAdditionalWorldBookNames,
  getChatKey,
  getChatState,
  getPriorityCharacterNames,
  getRegisteredTargetNames,
  getSettings,
  getLatestMatchingSnapshot,
  getWorldbookEntryDisplayName,
  hydrateChatStateFromHost,
  loadCharacterAdditionalWorldBooks,
  loadGlobalWorldBook,
  recordChatStateSnapshot,
  reconcileMessageCheckpoints,
  restoreChatStateFromSnapshot,
  saveSettings,
  shouldTriggerForMessage,
  worldbookSelectionMatches,
} from './state.js';
import { getDerivedTypeMetabolismExemptions } from './race_config.js';
import { LABOR_STAGES, PREGNANCY_STAGES } from './stage_config.js';
import { readMemorySource } from './memory_sources.js';
import { canLoadHostWorldInfo, getHostAgentRunBarrier, getHostChat, getHostExtensionSettings, getHostKind, loadHostWorldInfo, refreshHostChatView } from './host.js';

export const POLL_RUNTIME_KEY = '__bs_biotracker_poll__';
export const RUN_RUNTIME_KEY = '__bs_biotracker_running__';
export const RUN_STARTED_AT_KEY = '__bs_biotracker_running_started_at__';
/** 单条消息之外的准备工作（世界书、宿主上下文）也算在看门狗里，留一段余量 */
const RUN_WATCHDOG_MARGIN_MS = 120000;
const UPDATE_CUE_EVENT = 'bs-biotracker:update-cue';
const AFTER_AI_SETTLE_MS = 1400;
const MAINFLOW_CONTEXT_SNAPSHOT_KEY = '__bs_biotracker_mainflow_context_snapshot__';
const DEBUG_LAST_TRACKER_REQUEST_KEY = '__bs_biotracker_debug_last_tracker_request__';
const DEBUG_LAST_TRACKER_RESULT_KEY = '__bs_biotracker_debug_last_tracker_result__';
const DEBUG_MVU_GATE_KEY = '__bs_biotracker_debug_mvu_gate__';

// ---- MVU 额外模型解析兼容 ----
// MVU 变量框架开启「额外模型解析」时，正文出完后会再调一次 API 更新变量；
// 此时立刻发追踪请求会与 MVU 的更新请求重复消耗额度。
// 检测到该模式时，把追踪请求推迟到本轮变量更新结束（或确认本轮不会解析）后再发送。
// MVU 自己导出了事件常数表（Mvu.events），优先读它；读不到（MVU 尚未初始化）
// 才退回字面量——字面量只是兜底，事件名以 MVU 当前版本导出的为准
const MVU_VARIABLE_UPDATE_ENDED_EVENT = 'mag_variable_update_ended';
function getMvuVariableUpdateEndedEvent() {
  const exported = getMvuApi()?.events?.VARIABLE_UPDATE_ENDED;
  return typeof exported === 'string' && exported ? exported : MVU_VARIABLE_UPDATE_ENDED_EVENT;
}
/** 等待 MVU 开始解析的宽限期：宽限期内未开始即视为本轮不会解析 */
const MVU_EXTRA_WAIT_GRACE_MS = 4000;
/** 单轮等待的异常保护上限 */
const MVU_EXTRA_MAX_WAIT_MS = 120000;
/** 变量更新结束事件超过该时长即视为上一轮残留，防止重掷/改写后误放行 */
const MVU_EXTRA_ENDED_STALE_MS = 15000;

const mvuGateState = {
  eventInstalled: false,
  lastEndedKey: '',
  lastEndedContentKey: '',
  lastEndedAt: 0,
  pendingKey: '',
  pendingContentKey: '',
  pendingSince: 0,
  // 提示只在每个聊天第一次真正等待时弹一次：逐轮提示在长对话里等同于噪音
  announcedChatKey: '',
  // fetch 钩子观测：正文之后出现的额外生成请求（MVU 额外模型解析的硬信号）
  fetchHooked: false,
  generateInFlight: 0,
  lastGenerateStartedAt: 0,
  sawGenerateThisRound: false,
  everSawMvuSignal: false,
};
// 仅测试用：允许用例直接读写门控状态
export const __mvuGateStateForTest = mvuGateState;
// 门控状态挂到全局，方便在真实 ST 的 console 里排查等待判定；
// 只有轮次键与消息签名（长度+哈希），不含聊天原文，故无需像 API 调试那样加开关
globalThis[DEBUG_MVU_GATE_KEY] = mvuGateState;

/** 心跳：每处理完一条消息就刷新，避免长队列被看门狗误判为卡死 */
function markTrackerRunProgress() {
  globalThis[RUN_STARTED_AT_KEY] = Date.now();
}

/**
 * 看门狗：请求若因为宿主代理挂起而永不返回，运行锁会一直留在 true，
 * 之后所有手动/自动分析都会被 already_running 挡掉。超过整轮总时限即视为死锁并放行。
 * 以总时限（含全部重试）为准，避免误判还在合法重试的长轮次、让 poll 抢跑造成并发。
 */
function isTrackerRunStale(settings) {
  const startedAt = Number(globalThis[RUN_STARTED_AT_KEY]);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  const limitMs = resolveOverallDeadlineMs(settings) + RUN_WATCHDOG_MARGIN_MS;
  return Date.now() - startedAt > limitMs;
}

function getTrackerResumeIndexes(ctx, settings) {
  const chatKey = getChatKey(ctx);
  const snapshots = settings?.chatStates?.[chatKey]?.snapshots;
  if (!Array.isArray(snapshots)) return [0];
  return snapshots.map((snapshot) => {
    const count = Number(snapshot?.messageCount);
    return Number.isInteger(count) && count >= 0 ? count : null;
  }).filter((count) => count !== null);
}

/**
 * 失败后是否该挡下自动重试。
 *
 * 旧版只拿「失败那一楼的签名」去比「整段对话最后一楼的签名」：
 * 重放中间楼失败时两者永远对不上，于是轮询会无限重发同一个失败请求
 * （删掉最新一楼后特别容易触发，因为回放会从较早的楼开始）。
 * 改为记录失败当下整段对话的签名——只要对话没有任何变化，重试必然重复同一个失败。
 * 对话一有变动（新楼、改写、删楼）签名就变，自动重试随即恢复；手动分析不受此限。
 */
export function isFailedAutoRetryBlocked(ctx, chatState) {
  const chat = getHostChat(ctx);
  if (chat.length === 0) return false;
  const currentChatSignature = buildSignature(ctx, chat.length);
  const failedChatSignature = String(chatState?.lastFailedChatSignature || '');
  if (failedChatSignature) return failedChatSignature === currentChatSignature;
  // 旧存档没有这个栏位时，沿用原本的尾楼比对
  const failedSignature = String(chatState?.lastFailedSignature || '');
  if (!failedSignature) return false;
  return failedSignature === currentChatSignature;
}

function getMvuApi() {
  // MVU 把全局对象挂到顶层 window（window.parent.Mvu / window.Mvu）
  const mvu = globalThis.Mvu || globalThis.parent?.Mvu;
  return mvu && typeof mvu === 'object' ? mvu : null;
}

export function getMvuSettings(ctx) {
  // TT 的 ctx.extensionSettings 与 SillyTavern.extensionSettings 未必是同一对象，
  // 多源读取，取第一个能用的
  const candidates = [
    getHostExtensionSettings(ctx)?.mvu_settings,
    globalThis.SillyTavern?.extensionSettings?.mvu_settings,
    globalThis.Luker?.getContext?.()?.extensionSettings?.mvu_settings,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

export function isMvuExtraAnalysisEnabled(ctx, settings) {
  if (settings.mvuExtraAnalysisCompat === false) return false;
  const mvuSettings = getMvuSettings(ctx);
  if (!mvuSettings) return false;
  if (mvuSettings.更新方式 !== '额外模型解析') return false;
  // 旧版字段名为 自动触发额外模型解析，新版为 额外模型解析配置.启用自动请求
  const autoRequest = mvuSettings.额外模型解析配置?.启用自动请求 ?? mvuSettings.自动触发额外模型解析;
  return autoRequest !== false;
}

function getMvuRoundKey(ctx) {
  const chat = getHostChat(ctx);
  const last = chat[chat.length - 1];
  if (!last) return '';
  const lastId = last?.id !== undefined && last?.id !== null ? String(last.id) : '';
  return `${getChatKey(ctx)}:${chat.length}:${last.is_user ? 'user' : 'assistant'}:${lastId}`;
}

// 含内容签名的轮次指纹：同 id 被重掷/编辑后内容变化，指纹随之变化，
// 防止上一轮的「变量更新结束」事件被误当作新轮次已完成
function getMvuContentKey(ctx) {
  return buildSignature(ctx, getHostChat(ctx).length);
}

function installMvuGateListener(ctx) {
  if (mvuGateState.eventInstalled) return;
  const handler = () => {
    const key = getMvuRoundKey(ctx);
    if (!key) return;
    mvuGateState.lastEndedKey = key;
    mvuGateState.lastEndedContentKey = getMvuContentKey(ctx);
    mvuGateState.lastEndedAt = Date.now();
  };
  let installed = false;
  const eventName = getMvuVariableUpdateEndedEvent();
  try {
    // MVU 自身的 eventEmit/eventOn 走同一套全局事件通道，优先使用；拿不到时退回宿主 eventSource
    if (typeof globalThis.eventOn === 'function') {
      globalThis.eventOn(eventName, handler);
      installed = true;
    } else if (ctx?.eventSource && typeof ctx.eventSource.on === 'function') {
      ctx.eventSource.on(eventName, handler);
      installed = true;
    }
  } catch (error) {
    console.warn('[BS BioTracker] 无法订阅 MVU 变量更新事件', error);
  }
  mvuGateState.eventInstalled = installed;
}

function notifyMvuGateWaiting(ctx) {
  const chatKey = getChatKey(ctx);
  if (!chatKey || mvuGateState.announcedChatKey === chatKey) return;
  mvuGateState.announcedChatKey = chatKey;
  try {
    globalThis.toastr?.info?.('检测到 MVU 额外模型解析请求，等待变量更新完成后再追踪', '[BS BioTracker] MVU 兼容');
  } catch {
    // 无 toastr 的环境静默即可
  }
}

function isGenerateFetchRequest(input) {
  let url = '';
  try {
    if (typeof input === 'string') url = input;
    else if (input && typeof input === 'object' && 'url' in input) url = String(input.url);
    else if (input) url = String(input);
  } catch {}
  return /\/api\/backends\/chat-completions\/generate/.test(url);
}

/**
 * 从 fetch 参数解析请求体（init.body 字符串 JSON）。
 * Request 对象（.json()）是异步的，钩子里同步判断拿不到，保守返回 null——
 * 拿不到 body 时不判定为 MVU 请求（宁可漏判也不误判普通卡）。
 */
function parseFetchBody(init) {
  try {
    const raw = init?.body;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return null;
}

/**
 * 判断该生成请求是否是 MVU 额外模型解析（而非 ST 主线生成）：
 * 只有请求体带 MVU 特征才计为 MVU 信号——否则普通 ST 卡的主线生成请求
 * 会被误判为「MVU 额外解析」而弹出等待提示并延迟追踪（用户实测误报）。
 * MVU 特征（invoke_extra_model.ts 实证）：`遵循<must>指令`（硬编码 user_input，
 * 以消息 content 进入 messages）、`<UpdateVariable>`（extra_model_task.txt 字面标签）、
 * `json_patch`（v4 格式化输出 task）。不用 `<must>` 单标签/自造词——普通卡
 * 系统提示词也可能含 `<must>...` 标签，会误判。
 */
export function isMvuExtraAnalysisRequest(input, init) {
  if (!isGenerateFetchRequest(input)) return false;
  const body = parseFetchBody(init);
  if (!body || typeof body !== 'object') return false;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const textParts = [
    body.user_input,
    ...messages.map((message) => {
      const content = message?.content;
      return typeof content === 'string' ? content : '';
    }),
  ].filter(Boolean).join('\n');
  return /遵循<must>指令|<UpdateVariable>|json_patch/i.test(textParts);
}

/**
 * 观测非本插件发出的生成请求（MVU 额外模型解析/其他扩展的二次调用）。
 * 不依赖 MVU 的设置或全局对象——TT 下这些常常读不到，
 * 但 MVU 的请求必然走页面里的 fetch，这是最可靠的运行时信号。
 * 本插件自己的请求带 __bs_biotracker_async_request__ 标记，不计数。
 */
export function installMvuFetchHook() {
  if (mvuGateState.fetchHooked || typeof globalThis.fetch !== 'function') return;
  const innerFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (...args) => {
    // 只观测「确实带 MVU 特征」的额外解析请求——普通 ST 主线生成请求
    // 也走同一 generate 端点，若不加特征过滤会把无 MVU 卡误判为 MVU 环境
    if (!globalThis.__bs_biotracker_async_request__ && isMvuExtraAnalysisRequest(args[0], args[1])) {
      mvuGateState.generateInFlight += 1;
      mvuGateState.lastGenerateStartedAt = Date.now();
      mvuGateState.sawGenerateThisRound = true;
      try {
        return await innerFetch(...args);
      } finally {
        mvuGateState.generateInFlight -= 1;
        if (mvuGateState.generateInFlight < 0) mvuGateState.generateInFlight = 0;
      }
    }
    return innerFetch(...args);
  };
  mvuGateState.fetchHooked = true;
}

export function shouldWaitForMvuExtraAnalysis(ctx, settings) {
  if (settings.mvuExtraAnalysisCompat === false) return false;
  const chat = getHostChat(ctx);
  const last = chat[chat.length - 1];
  // after_user 等时机下 MVU 的解析早已完成，无需等待
  if (!last || last.is_user) return false;

  // fetch 钩子必须在首次评估前就装好：否则正文后第一时间启动的 MVU 请求会被漏观测
  installMvuFetchHook();

  const mvuSettings = getMvuSettings(ctx);
  const method = mvuSettings?.更新方式;
  // 能读到设置且明确是随AI输出 → 不需要等待
  if (method === '随AI输出') return false;
  // 能读到设置且明确是额外模型解析但未开启自动请求 → 本轮不会自动解析，直接放行
  if (method === '额外模型解析') {
    const autoRequest = mvuSettings?.额外模型解析配置?.启用自动请求 ?? mvuSettings?.自动触发额外模型解析;
    if (autoRequest === false) return false;
  }
  const mvu = getMvuApi();
  const mvuCapable = mvu && typeof mvu.isDuringExtraAnalysis === 'function';
  // 三种信号源全部不可用（fetch 被禁用、无 Mvu、设置读不到）→ 无从判断
  if (!mvuGateState.fetchHooked && !mvuCapable && method !== '额外模型解析') return false;
  if (mvuCapable) mvuGateState.everSawMvuSignal = true;
  if (method === '额外模型解析') mvuGateState.everSawMvuSignal = true;

  installMvuGateListener(ctx);
  const roundKey = getMvuRoundKey(ctx);
  const contentKey = getMvuContentKey(ctx);
  if (!roundKey || !contentKey) return false;
  const now = Date.now();
  if (mvuGateState.pendingKey !== roundKey) {
    mvuGateState.pendingKey = roundKey;
    mvuGateState.pendingContentKey = contentKey;
    mvuGateState.pendingSince = now;
    mvuGateState.sawGenerateThisRound = false;
  } else if (mvuGateState.pendingContentKey !== contentKey) {
    // 同 id 消息被重掷/编辑：内容已变，视为新轮次，重新开启等待窗口，
    // 避免旧 pendingSince 过期导致宽限路径立即放行
    mvuGateState.pendingContentKey = contentKey;
    mvuGateState.pendingSince = now;
    mvuGateState.sawGenerateThisRound = false;
  }

  // 信号 1：MVU 全局 API 报告正在解析
  const during = mvuCapable && mvu.isDuringExtraAnalysis() === true;
  // 信号 2：正文之后仍有非本插件的生成请求在飞行（MVU 额外解析/重试等）
  const generateActive = mvuGateState.generateInFlight > 0;
  // 生成请求只作为本轮「在飞」等待信号，不参与 everSawMvuSignal——
  // 否则普通 ST 主流请求也会让设备被标记为「见过 MVU 信号」，导致每轮白等宽限
  if (during) mvuGateState.everSawMvuSignal = true;

  const waiting = resolveMvuGateWaiting(roundKey, contentKey, now, during || generateActive);
  // 提示只在真的推迟了追踪时才弹：先前无条件按「更新方式=额外模型解析」提示，
  // 会在本轮解析早已结束、根本没等待的情况下也弹一次
  if (waiting) notifyMvuGateWaiting(ctx);
  return waiting;
}

function resolveMvuGateWaiting(roundKey, contentKey, now, signalActive) {
  if (signalActive) return now - mvuGateState.pendingSince < MVU_EXTRA_MAX_WAIT_MS;
  // 本轮变量更新已结束（事件新鲜且内容指纹一致）→ 放行
  if (mvuGateState.lastEndedKey === roundKey
    && mvuGateState.lastEndedContentKey === contentKey
    && now - mvuGateState.lastEndedAt < MVU_EXTRA_ENDED_STALE_MS) return false;
  // 从没见过任何 MVU 信号（非 MVU 卡）→ 不等待；见过 → 宽限期内等信号出现
  if (!mvuGateState.everSawMvuSignal) return false;
  return now - mvuGateState.pendingSince < MVU_EXTRA_WAIT_GRACE_MS;
}

function normalizeWorldbookMode(value) {
  const mode = String(value || 'exclude').trim();
  if (mode === 'mainflow' || mode === 'allowlist_all' || mode === 'exclude') return mode;
  return 'exclude';
}

function getVitalityLevelText(level) {
  const levels = {
    1: '一推就倒',
    2: '身怀病弱',
    3: '难产体态',
    4: '均衡活力',
    5: '安产体态',
    6: '经过锻炼',
    7: '无坚不摧',
  };
  return levels[Math.max(1, Math.min(7, Math.round(Number(level) || 4)))] || '未知';
}

function getPsyStressLevelText(level) {
  const levels = {
    1: '情感丧失、麻木不仁',
    2: '内向压抑、冷感',
    3: '情绪平缓、理性',
    4: '情绪均衡、稳定',
    5: '情绪丰富、敏感',
    6: '强烈波动、焦躁',
    7: '极端情绪、精神异常',
  };
  return levels[Math.max(1, Math.min(7, Math.round(Number(level) || 4)))] || '未知';
}

function getTendencyAngleText(angle) {
  const value = Number(angle);
  if (!Number.isFinite(value)) return '未知';
  if ((value >= 0 && value <= 15) || (value >= 345 && value <= 360)) return '正位(↓)';
  if ((value >= 165 && value <= 195)) return '倒位(↑)';
  if ((value >= 75 && value <= 105)) return '横位(←)';
  if ((value >= 255 && value <= 285)) return '横位(→)';
  if (value > 15 && value < 75) return '斜位(↗)';
  if (value > 105 && value < 165) return '斜位(↖)';
  if (value > 195 && value < 255) return '斜位(↙)';
  if (value > 285 && value < 345) return '斜位(↘)';
  return '斜位';
}

function getDiaryRecentLimit(settings, characterCount) {
  const singleLimit = Math.max(0, Math.min(20, Math.floor(Number(settings?.diaryRecentLimit) || 0)));
  if (singleLimit <= 0) return 0;
  return characterCount > 1 ? Math.max(1, Math.floor(singleLimit / 2)) : singleLimit;
}

function hasPreparedWardrobe(existingState = {}) {
  return Object.values(existingState || {}).some((item) => item?.profile?.wardrobe?.enabled === true);
}

export function hasBreedingPsychology(existingState = {}) {
  return Object.values(existingState || {}).some((item) => {
    const stageProfiles = item?.profile?.psychology?.stageProfiles;
    return stageProfiles && typeof stageProfiles === 'object' && !Array.isArray(stageProfiles)
      && Object.keys(stageProfiles).length > 0;
  });
}

/** 与 applyRuptureMembranes 允许的阶段一致：更早的阶段羊膜恒不破 */
function hasRupturableStage(existingState = {}) {
  return Object.values(existingState || {}).some((item) => (
    ['产兆前驱', '第一产程', '第二产程'].includes(String(item?.profile?.base?.stage || ''))
  ));
}

export function getTrackerToolDefinitions(settings, existingState = {}) {
  const diaryEnabled = Math.max(0, Math.min(20, Math.floor(Number(settings?.diaryRecentLimit) || 0))) > 0;
  const wardrobeEnabled = hasPreparedWardrobe(existingState);
  const psychologyEnabled = hasBreedingPsychology(existingState);
  const hiddenTools = new Set();
  if (!diaryEnabled) hiddenTools.add('bsWriteDiary');
  if (!psychologyEnabled) hiddenTools.add('bsUpdatePsychology');
  // 破水只在产兆前驱与前两个产程有意义；平时挂着只是占用模型的注意力
  if (!hasRupturableStage(existingState)) hiddenTools.add('bsRuptureMembranes');
  if (!wardrobeEnabled) {
    hiddenTools.add('bsAddWardrobeItem');
    hiddenTools.add('bsRemoveWardrobeItem');
    hiddenTools.add('bsChangeOutfit');
  }
  return TOOL_DEFINITIONS.filter((tool) => !hiddenTools.has(tool?.name));
}

function getRecentDiaryEntries(profile, limit) {
  if (limit <= 0 || !Array.isArray(profile?.diary)) return [];
  return profile.diary.slice(-limit);
}

function shouldSendPregnantState(base = {}, pregnant = {}) {
  const stage = String(base.stage || '');
  const hasFetuses = Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0;
  return hasFetuses
    || PREGNANCY_STAGES.includes(stage)
    || stage === '产兆前驱'
    || LABOR_STAGES.includes(stage)
    || stage === '产后恢复'
    || stage === '假孕期';
}

function getPromptFacingMetabolismSymptoms(pregnant = {}) {
  const result = {};
  for (const symptomType of ['blockage', 'acceleration', 'expansion']) {
    const symptom = pregnant[symptomType];
    if (!symptom || typeof symptom !== 'object') continue;
    const key = String(symptom.key || '').trim();
    if (!key) continue;
    result[symptomType] = {
      key,
      severity: Number.isFinite(Number(symptom.severity)) ? Number(symptom.severity) : 0,
    };
  }
  return result;
}

function getPromptFacingLaborState(base = {}, pregnant = {}) {
  const stage = String(base.stage || '');
  if (stage !== '产兆前驱' && !LABOR_STAGES.includes(stage)) return {};
  return {
    laborHours: Number.isFinite(Number(pregnant.laborHours)) ? Number(pregnant.laborHours) : 0,
    effectiveLaborHours: Number.isFinite(Number(pregnant.effectiveLaborHours)) ? Number(pregnant.effectiveLaborHours) : 0,
    laborPhase: pregnant.laborPhase ?? null,
    laborFetusIndex: Number.isFinite(Number(pregnant.laborFetusIndex)) ? Number(pregnant.laborFetusIndex) : 0,
    laborPain: Number.isFinite(Number(pregnant.laborPain)) ? Number(pregnant.laborPain) : 0,
  };
}

function getOutfitCurrentWearText(profile) {
  const wardrobe = profile?.wardrobe;
  const outfit = profile?.outfit;
  if (!wardrobe?.enabled || !outfit || typeof outfit !== 'object') return '';
  const availableItems = [
    ...(Array.isArray(wardrobe.items) ? wardrobe.items : []),
    ...(Array.isArray(outfit.temporaryItems) ? outfit.temporaryItems : []),
  ];
  const findItem = (id) => availableItems.find((entry) => entry?.id === id) || null;
  const itemName = (id) => {
    const found = findItem(id);
    if (found?.name) return String(found.name);
    return id === 0 ? '全裸' : `未知衣物#${id}`;
  };
  const mainId = outfit.mainItemId ?? 0;
  const wearState = sanitizeWearState(outfit.wearState);
  const stateSuffix = wearState !== DEFAULT_WEAR_STATE ? `（${wearState}）` : '';
  const accessoryIds = Array.isArray(outfit.accessoryItemIds) ? outfit.accessoryItemIds : [];
  const innerNames = [];
  const outerNames = [];
  for (const id of accessoryIds) {
    (findItem(id)?.layer === 'inner' ? innerNames : outerNames).push(itemName(id));
  }
  if (mainId === 0 && (innerNames.length > 0 || outerNames.length > 0)) {
    return `仅着：${[...innerNames, ...outerNames].join(' + ')}${stateSuffix}`;
  }
  const base = [itemName(mainId) + stateSuffix, ...outerNames].join(' + ');
  return innerNames.length > 0 ? `${base}（内着：${innerNames.join('、')}）` : base;
}

function buildSlimWardrobeItem(entry) {
  return {
    id: entry?.id,
    name: entry?.name,
    slot: entry?.slot,
    ...(entry?.layer ? { layer: entry.layer } : {}),
  };
}

// 四维数值只在孕期窗口（真妊娠/产兆前驱/产程/产后恢复）有机械消费者（pregFit）；
// 窗口外的 payload 衣物瘦身为 id/name/slot/note，四维仍保存在持久化状态中。
function isWearFitWindowActive(base = {}) {
  const stage = String(base?.stage || '');
  return PREGNANCY_STAGES.includes(stage)
    || stage === '产兆前驱'
    || LABOR_STAGES.includes(stage)
    || stage === '产后恢复';
}

function buildNarrativeWardrobeItem(entry) {
  return {
    id: entry?.id,
    name: entry?.name,
    slot: entry?.slot,
    note: entry?.note,
    ...(Array.isArray(entry?.parts) && entry.parts.length > 0 ? { parts: entry.parts } : {}),
    ...(entry?.layer ? { layer: entry.layer } : {}),
  };
}

function buildPromptFacingCharacterState(item, diaryLimit = 0) {
  const next = cloneValue(item);
  const profile = next?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const immune = profile.immune || {};
  const metabolism = profile.metabolism || {};
  const hasFetuses = Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0;
  const sendPregnantState = shouldSendPregnantState(base, pregnant);

  profile.base = {
    ...base,
    vitalityLevelText: getVitalityLevelText(base.vitalityLevel),
    psyStressLevelText: getPsyStressLevelText(base.psyStressLevel),
  };

  if (!sendPregnantState) {
    delete profile.pregnant;
  } else if (Array.isArray(pregnant.fetuses)) {
    profile.pregnant = {
      pregnantDays: Number.isFinite(Number(pregnant.pregnantDays)) ? Number(pregnant.pregnantDays) : 0,
      effectivePregnantDays: Number.isFinite(Number(pregnant.effectivePregnantDays)) ? Number(pregnant.effectivePregnantDays) : 0,
      ...getPromptFacingLaborState(base, pregnant),
      amnionDurability: Number.isFinite(Number(pregnant.amnionDurability)) ? Number(pregnant.amnionDurability) : 0,
      ...(hasFetuses ? { nutrition: Number.isFinite(Number(pregnant.nutrition)) ? Number(pregnant.nutrition) : 0 } : {}),
      ...(hasFetuses ? { symptomReliefPending: Number.isFinite(Number(pregnant.symptomReliefPending)) ? Number(pregnant.symptomReliefPending) : 0 } : {}),
      ...getPromptFacingMetabolismSymptoms(pregnant),
      fetuses: pregnant.fetuses.map((fetus) => {
        const { embryoId: _embryoId, fusionCheckedWith: _fusionCheckedWith, ...visibleFetus } = fetus;
        return {
          ...visibleFetus,
          tendencyAngleText: getTendencyAngleText(fetus?.tendencyAngle),
          race: undefined,
        };
      }),
    };
  } else {
    profile.pregnant = {
      pregnantDays: Number.isFinite(Number(pregnant.pregnantDays)) ? Number(pregnant.pregnantDays) : 0,
      effectivePregnantDays: Number.isFinite(Number(pregnant.effectivePregnantDays)) ? Number(pregnant.effectivePregnantDays) : 0,
      ...getPromptFacingLaborState(base, pregnant),
      amnionDurability: Number.isFinite(Number(pregnant.amnionDurability)) ? Number(pregnant.amnionDurability) : 0,
      ...getPromptFacingMetabolismSymptoms(pregnant),
      fetuses: [],
    };
  }

  if (base.derivedType) {
    const exemptions = new Set(getDerivedTypeMetabolismExemptions(base.derivedType));
    const includeNeed = (key) => (exemptions.has(key) ? {} : { [key]: metabolism[key] ?? 0 });
    profile.metabolism = {
      flux: Number.isFinite(Number(metabolism.flux)) ? Number(metabolism.flux) : 0,
      ...includeNeed('excretion'),
      ...includeNeed('hunger'),
      ...includeNeed('sleep'),
      ...includeNeed('milk'),
      ...includeNeed('odor'),
      ...includeNeed('companionship'),
    };
  } else {
    profile.metabolism = {
      excretion: metabolism.excretion ?? 0,
      hunger: metabolism.hunger ?? 0,
      sleep: metabolism.sleep ?? 0,
      milk: metabolism.milk ?? 0,
      odor: metabolism.odor ?? 0,
      companionship: metabolism.companionship ?? 0,
    };
  }

  if (profile.wardrobe?.enabled && profile.outfit && typeof profile.outfit === 'object') {
    profile.outfit.currentWearText = getOutfitCurrentWearText(profile);
    if (!isWearFitWindowActive(base)) {
      profile.wardrobe.items = (Array.isArray(profile.wardrobe.items) ? profile.wardrobe.items : []).map(buildNarrativeWardrobeItem);
      if (Array.isArray(profile.outfit.temporaryItems)) {
        profile.outfit.temporaryItems = profile.outfit.temporaryItems.map((entry) => ({ ...buildNarrativeWardrobeItem(entry), source: entry?.source }));
      }
    }
  }

  delete profile.bio;
  delete profile.immune;
  delete profile.cooldown;
  if (immune.metabolism) delete profile.metabolism;
  if (!hasBreedingPsychology({ current: item })) delete profile.psychology;
  profile.diary = getRecentDiaryEntries(item?.profile || {}, diaryLimit);

  delete next.updatedAt;
  delete next.runtime;

  next.profile = profile;
  return next;
}

function buildOffscreenCharacterState(item, diaryLimit = 0) {
  const profile = item?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const hasFetuses = Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0;
  const sendPregnantState = shouldSendPregnantState(base, pregnant);
  return {
    name: item?.name || '',
    initialized: Boolean(item?.initialized),
    offscreen: true,
    profile: {
      base: {
        isHere: false,
        stage: base.stage ?? null,
        days: base.days ?? 0,
        age: base.age ?? null,
        race: base.race ?? null,
        derivedType: base.derivedType ?? null,
      },
      ...(sendPregnantState ? {
        pregnant: {
          pregnantDays: pregnant.pregnantDays ?? 0,
          effectivePregnantDays: pregnant.effectivePregnantDays ?? 0,
          ...getPromptFacingLaborState(base, pregnant),
          fetusesCount: hasFetuses ? pregnant.fetuses.length : 0,
          ...getPromptFacingMetabolismSymptoms(pregnant),
        },
      } : {}),
      ...(profile.wardrobe?.enabled ? {
        wardrobe: {
          enabled: true,
          items: (Array.isArray(profile.wardrobe.items) ? profile.wardrobe.items : []).map(buildSlimWardrobeItem),
        },
        outfit: {
          mainItemId: profile.outfit?.mainItemId ?? 0,
          accessoryItemIds: Array.isArray(profile.outfit?.accessoryItemIds) ? [...profile.outfit.accessoryItemIds] : [],
          wearState: sanitizeWearState(profile.outfit?.wearState),
          ...(Array.isArray(profile.outfit?.temporaryItems) && profile.outfit.temporaryItems.length > 0
            ? { temporaryItems: profile.outfit.temporaryItems.map(buildSlimWardrobeItem) }
            : {}),
          currentWearText: getOutfitCurrentWearText(profile),
        },
      } : {}),
      diary: getRecentDiaryEntries(profile, diaryLimit),
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      talents: Array.isArray(profile.talents) ? profile.talents : [],
      skillHistory: Array.isArray(profile.skillHistory) ? profile.skillHistory.slice(-10) : [],
      notify: Object.values(notify).some((value) => String(value || '').trim()) ? notify : undefined,
    },
  };
}

function buildTrackerStateView(existingState, settings = null) {
  const characterCount = Object.keys(existingState || {}).length;
  const diaryLimit = getDiaryRecentLimit(settings, characterCount);
  return Object.fromEntries(
    Object.entries(existingState).map(([name, item]) => {
      if (item?.profile?.base?.isHere === false) return [name, buildOffscreenCharacterState(item, diaryLimit)];
      return [name, buildPromptFacingCharacterState(item, diaryLimit)];
    }),
  );
}

function parseTrackerWorldbookExcludeNames(settings) {
  return new Set(
    String(settings?.trackerWorldbookExcludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseTrackerWorldbookIncludeNames(settings) {
  return new Set(
    String(settings?.trackerWorldbookIncludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseTrackerGlobalWorldbookExcludeNames(settings) {
  return new Set(
    String(settings?.trackerGlobalWorldbookExcludeNames || '')
      .split(/\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseTrackerGlobalWorldbookIncludeNames(settings) {
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

function projectWorldbookEntryForTracker(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const content = entry.content ?? entry.text ?? entry.value ?? '';
  if (!content) return null;
  // Worldbook activation fields (constant, depth, recursion, probability,
  // match*, etc.) are ST runtime configuration, not story context. Send only
  // the readable title and cleaned prose to the tracker.
  return {
    name: getWorldbookEntryDisplayName(entry),
    content,
  };
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

function filterTrackerWorldbookEntries(value, excludedNames, settings = null, recentMessages = [], options = {}) {
  if (!value || typeof value !== 'object') return value;
  const mode = normalizeWorldbookMode(settings?.trackerWorldbookMode);
  const globalBookName = String(options.globalBookName || '').trim();
  // characterScopeLists：附加知识书带书名前缀，但白名单仍走角色侧名单
  const includedNames = globalBookName && options.characterScopeLists !== true
    ? parseTrackerGlobalWorldbookIncludeNames(settings)
    : parseTrackerWorldbookIncludeNames(settings);
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
    const entries = value.entries
      .filter(keepEntry)
      .map((entry) => projectWorldbookEntryForTracker(entry))
      .filter(Boolean);
    return {
      name: String(value.name || globalBookName || '').trim(),
      entries,
    };
  }

  if (value.entries && typeof value.entries === 'object') {
    const entries = Object.entries(value.entries)
      .filter(([, entry]) => keepEntry(entry))
      .map(([, entry]) => projectWorldbookEntryForTracker(entry))
      .filter(Boolean);
    return {
      name: String(value.name || globalBookName || '').trim(),
      entries,
    };
  }

  return value;
}

async function getFilteredGlobalWorldbooks(ctx, settings, recentMessages = []) {
  const boundName = String(getCharacterWorldBookName(ctx) || await getCharacterWorldBookNameViaSTscript() || '').trim();
  try {
    const names = (await getActiveGlobalWorldBookNames()).filter((name) => name !== boundName);
    const excludedNames = parseTrackerGlobalWorldbookExcludeNames(settings);
    const books = await Promise.all(names.map(async (name) => {
      try {
        const worldBook = await loadGlobalWorldBook(ctx, name);
        return filterTrackerWorldbookEntries(worldBook || null, excludedNames, settings, recentMessages, { globalBookName: name });
      } catch (error) {
        console.warn(`[BS BioTracker] load global worldbook "${name}" for tracker failed`, error);
        return null;
      }
    }));
    return books.filter((book) => book && ((Array.isArray(book.entries) && book.entries.length > 0) || (book.entries && typeof book.entries === 'object' && Object.keys(book.entries).length > 0)));
  } catch (error) {
    console.warn('[BS BioTracker] load active global worldbooks for tracker failed', error);
    return [];
  }
}

// 附加知识书走角色侧排除名单，条目以「书名 :: 条目名」参与匹配
async function getCharacterAdditionalWorldbooksForTracker(ctx, settings, recentMessages = []) {
  const excludedNames = parseTrackerWorldbookExcludeNames(settings);
  return loadCharacterAdditionalWorldBooks(ctx, {
    recentMessages,
    filterBook: (worldBook, bookName, messages) => filterTrackerWorldbookEntries(
      worldBook,
      excludedNames,
      settings,
      messages,
      { globalBookName: bookName, characterScopeLists: true },
    ),
  });
}

function mergeTrackerWorldbookLists(...lists) {
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

export function getMainflowContextSnapshot(ctx, settings = null) {
  const snapshot = globalThis[MAINFLOW_CONTEXT_SNAPSHOT_KEY];
  if (!snapshot || typeof snapshot !== 'object') return null;
  // 快照必须绑定当前聊天：无绑定（旧格式）或绑定不一致的快照一律视为失效
  const snapshotChatKey = String(snapshot.chatKey || '');
  if (!snapshotChatKey || snapshotChatKey !== getChatKey(ctx)) return null;
  const messages = Array.isArray(snapshot.messages)
    ? snapshot.messages
      .filter((message) => message && typeof message === 'object' && String(message.content || '').trim())
      .map((message) => ({
        role: String(message.role || 'user'),
        content: message.content || '',
        name: message.name ? String(message.name) : undefined,
      }))
      .filter((message) => message.content.trim())
    : [];
  if (messages.length === 0) return null;
  return {
    source: String(snapshot.source || 'st_request'),
    capturedAt: Number(snapshot.capturedAt || 0) || null,
    model: snapshot.model ? String(snapshot.model) : '',
    messages,
  };
}

export function buildTrackerPayload(ctx, settings, reason = 'manual', endIndexExclusive = null) {
  const currentCharacter = getCharacterCard(ctx);
  const chatState = getChatState(ctx, settings);
  const existingState = chatState.characters || {};
  const recentMessages = buildRecentMessages(ctx, settings, endIndexExclusive);
  const useMainflowMode = normalizeWorldbookMode(settings?.trackerWorldbookMode) === 'mainflow';
  let mainflowContextSnapshot = useMainflowMode ? getMainflowContextSnapshot(ctx, settings) : null;
  if (mainflowContextSnapshot && settings?.useStPresetForAsync) {
    mainflowContextSnapshot = {
      ...mainflowContextSnapshot,
      messages: mainflowContextSnapshot.messages.filter((m) => m.role !== 'system'),
    };
    if (mainflowContextSnapshot.messages.length === 0) mainflowContextSnapshot = null;
  }
  const filteredWorldBook = filterTrackerWorldbookEntries(
    currentCharacter.worldBook || null,
    parseTrackerWorldbookExcludeNames(settings),
    settings,
    recentMessages,
  );
  const payloadWorldBook = mainflowContextSnapshot ? null : filteredWorldBook;
  const diaryEnabled = getDiaryRecentLimit(settings, Object.keys(existingState || {}).length) > 0;
  const psychologyEnabled = hasBreedingPsychology(existingState);
  return {
    reason,
    chat_id: getChatKey(ctx),
    current_character: {
      ...currentCharacter,
      worldBook: payloadWorldBook,
    },
    character_description: currentCharacter.description || '',
    character_worldbook_name: getCharacterWorldBookName(ctx) || null,
    character_worldbook: payloadWorldBook,
    mainflow_context_snapshot: mainflowContextSnapshot,
    tracked_females: getRegisteredTargetNames(ctx, settings, chatState),
    priority_character_names: getPriorityCharacterNames(ctx, settings, chatState),
    skill_catalog: Array.isArray(chatState.skillCatalog) ? chatState.skillCatalog : [],
    existing_state: buildTrackerStateView(existingState, settings),
    available_tools: getTrackerToolDefinitions(settings, existingState),
    diary_enabled: diaryEnabled,
    race_catalog_enabled: settings?.raceCatalogInPrompt !== false,
    require_full_description_updates: settings?.requireFullDescriptionUpdates === true,
    ...(psychologyEnabled ? { breeding_psychology_enabled: true } : {}),
    wardrobe_enabled: hasPreparedWardrobe(existingState),
    recent_messages: recentMessages,
  };
}

export function buildMainFlowPrompt(ctx, settings) {
  const chatState = getChatState(ctx, settings);
  reconcileChatStateSnapshots(ctx, chatState, settings);
  return buildMainFlowStatePrompt(buildTrackerPayload(ctx, settings, 'mainflow'));
}

function normalizeTrackerCall(call) {
  if (!call || typeof call !== 'object') return call;
  const functionCall = call.function && typeof call.function === 'object' ? call.function : null;
  return {
    ...call,
    name: String(call.name || call.tool_name || call.tool || call.operation || functionCall?.name || '').trim(),
    arguments: call.arguments ?? call.args ?? call.parameters ?? call.params ?? functionCall?.arguments ?? {},
  };
}

function getTrackerToolCalls(result) {
  const candidates = [
    result?.tool_calls,
    result?.toolCalls,
    result?.calls,
    result?.operations,
    result?.actions,
    result?.data?.tool_calls,
    result?.data?.toolCalls,
    result?.data?.operations,
  ];
  const calls = candidates.find((value) => Array.isArray(value));
  return Array.isArray(calls) ? calls.map(normalizeTrackerCall) : [];
}

function getCharacterChecks(result) {
  const candidates = [
    result?.character_checks,
    result?.characterChecks,
    result?.checks,
    result?.data?.character_checks,
    result?.data?.characterChecks,
  ];
  const checks = candidates.find((value) => Array.isArray(value));
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({
    female: String(check?.female || check?.name || '').trim(),
    status: String(check?.status || check?.result || '').trim(),
  })).filter((check) => check.female);
}

function buildCharacterCheckCoverage(expectedNames, checks) {
  const expected = [...new Set((Array.isArray(expectedNames) ? expectedNames : []).map((name) => String(name || '').trim()).filter(Boolean))];
  const checked = [...new Set((Array.isArray(checks) ? checks : []).map((check) => String(check?.female || '').trim()).filter(Boolean))];
  return {
    expected,
    checked,
    missing: expected.filter((name) => !checked.includes(name)),
  };
}

function normalizeTrackerResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Tracker response must be a JSON object.');
  }
  return {
    ...result,
    tool_calls: getTrackerToolCalls(result),
    character_checks: getCharacterChecks(result),
  };
}

/**
 * 用 lastProcessedSignature 定位「上次处理到哪一楼」。
 * 快照因为删楼／改写而失效时，仍能靠它找到续跑点，不必从第 0 楼重来。
 */
function findProcessedResumeCount(ctx, chatState, chatLength) {
  const processed = String(chatState?.lastProcessedSignature || '');
  if (!processed) return null;
  for (let count = chatLength; count >= 1; count -= 1) {
    if (buildSignature(ctx, count) === processed) return count;
  }
  return null;
}

function reconcileChatStateSnapshots(ctx, chatState, settings) {
  const matchedSnapshot = getLatestMatchingSnapshot(ctx, chatState);
  if (matchedSnapshot) {
    restoreChatStateFromSnapshot(chatState, matchedSnapshot);
    return { nextMessageIndex: matchedSnapshot.messageCount };
  }
  // 没有可用快照时绝不从第 0 楼重跑整个聊天：每一楼都是一次 LLM 请求，
  // 长对话可以跑上几十分钟看起来完全卡死；而且缺少基准可回滚，
  // 从头重放等于把历史变化重复叠加到当前状态上。
  // 回放上限取 contextSize——payload 本来就只带这么多条，更早的楼没有对应上下文可分析。
  const chatLength = getHostChat(ctx).length;
  const budget = Math.max(1, Math.floor(Number(settings?.contextSize) || DEFAULT_SETTINGS.contextSize));
  const floorIndex = Math.max(0, chatLength - budget);
  const resumeCount = findProcessedResumeCount(ctx, chatState, chatLength);
  if (resumeCount !== null) return { nextMessageIndex: Math.max(resumeCount, floorIndex) };
  return { nextMessageIndex: floorIndex };
}

function prepareManualReplay(ctx, chatState, chatLength) {
  // 手动分析始终重跑当前尾楼；reconcile 只负责先恢复尾删后的基准状态。
  reconcileChatStateSnapshots(ctx, chatState, { contextSize: DEFAULT_SETTINGS.contextSize });
  return { nextMessageIndex: Math.max(0, chatLength - 1) };
}

function hasPendingChatHistory(ctx, chatState) {
  const matchedSnapshot = getLatestMatchingSnapshot(ctx, chatState);
  const currentLength = getHostChat(ctx).length;
  return !matchedSnapshot || matchedSnapshot.messageCount !== currentLength;
}

function emitTrackerUpdateCue(detail = {}) {
  globalThis.dispatchEvent?.(new CustomEvent(UPDATE_CUE_EVENT, { detail }));
}

// ---- 追踪进行中提示 ----
// 浮球脉动是「事后」才闪、且无变化时不闪，面板里的状态文字在手机上也看不见，
// 于是整轮追踪期间没有任何可见反馈。用一条常驻 toast 顶住，结束时换成结果提示。
let trackerBusyToast = null;

function showTrackerBusyToast() {
  if (trackerBusyToast) return;
  try {
    // timeOut/extendedTimeOut = 0：不自动消失，由本轮结束时显式清掉
    trackerBusyToast = globalThis.toastr?.info?.('追踪更新中…', '[BS BioTracker]', {
      timeOut: 0,
      extendedTimeOut: 0,
    }) || null;
  } catch {
    trackerBusyToast = null;
  }
}

function clearTrackerBusyToast() {
  if (!trackerBusyToast) return;
  try {
    globalThis.toastr?.clear?.(trackerBusyToast);
  } catch {
    // toastr 缺失或已被宿主清空时无需处理
  }
  trackerBusyToast = null;
}

function notifyTrackerDone(hasChanges) {
  try {
    globalThis.toastr?.success?.(
      hasChanges ? '追踪完成，状态已更新' : '追踪完成，本轮无状态变化',
      '[BS BioTracker]',
      { timeOut: 3000 },
    );
  } catch {
    // 无 toastr 的环境静默即可
  }
}

function recordTrackerRequestDebug(systemPrompt, payload) {
  globalThis[DEBUG_LAST_TRACKER_REQUEST_KEY] = {
    capturedAt: Date.now(),
    systemPrompt,
    payload,
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ],
  };
}

function recordTrackerResultDebug(result, error = null) {
  globalThis[DEBUG_LAST_TRACKER_RESULT_KEY] = {
    capturedAt: Date.now(),
    ok: !error,
    result: result ?? null,
    error: error ? String(error?.message || error) : null,
  };
}

function buildStreamingGuardSignature(ctx) {
  const chat = getHostChat(ctx);
  const last = chat[chat.length - 1];
  if (!last) return '';
  const content = String(last.mes || '');
  return [
    getChatKey(ctx),
    chat.length,
    last.is_user ? 'user' : 'assistant',
    String(last.name || ''),
    content.length,
    content.slice(0, 180),
    content.slice(-120),
  ].join('|');
}

function isAfterAiMessageSettled(ctx, settings, chatState) {
  if (settings.triggerTiming !== 'after_ai') return true;
  const chat = getHostChat(ctx);
  const lastMessage = chat[chat.length - 1];
  if (!lastMessage || lastMessage.is_user) {
    delete chatState.pendingAssistantSignature;
    delete chatState.pendingAssistantUpdatedAt;
    return true;
  }

  // 串流开始时宿主会先补上一个空的助手楼层，内容要过一阵子才写进 mes。
  // 空字串会「稳定」地空着，而 buildStreamingGuardSignature 只比对内容有没有变，
  // 于是撑过 settle 时间后被误判成已完成，对着空白楼层发出一次无意义的追踪请求
  // （使用者回报的「串流一开始就触发一次」）。空白助手楼层一律视为尚未就绪。
  if (!String(lastMessage.mes || '').trim()) {
    delete chatState.pendingAssistantSignature;
    delete chatState.pendingAssistantUpdatedAt;
    return false;
  }

  const signature = buildStreamingGuardSignature(ctx);
  const now = Date.now();
  if (chatState.pendingAssistantSignature !== signature) {
    chatState.pendingAssistantSignature = signature;
    chatState.pendingAssistantUpdatedAt = now;
    saveSettings(ctx);
    return false;
  }

  const updatedAt = Number(chatState.pendingAssistantUpdatedAt || 0);
  if (!Number.isFinite(updatedAt) || now - updatedAt < AFTER_AI_SETTLE_MS) return false;
  return true;
}

async function processTrackerMessage(ctx, settings, chatState, deps, reason, messageIndex) {
  const chat = getHostChat(ctx);
  const message = chat[messageIndex];
  const shouldTrigger = reason === 'manual' ? true : shouldTriggerForMessage(settings, message);
  if (!shouldTrigger) {
    // 触发时机不符的楼层只记一笔 skip 快照，不发请求；这是纯记帐流程，必须全程静默
    recordChatStateSnapshot(ctx, chatState, { messageCount: messageIndex + 1, reason: 'skip' });
    saveSettings(ctx);
    return { triggered: false };
  }

  // 确定要发请求了才亮提示：after_ai 下使用者自己发言也会走一轮空跑，
  // 在 runTracker 开头就亮会让使用者看到「输入时也在追踪」的假象
  showTrackerBusyToast();

  const payload = buildTrackerPayload(ctx, settings, reason, messageIndex + 1);
  const memoryResult = await readMemorySource({
    ctx,
    source: settings.memorySource,
    recentMessages: payload.recent_messages,
    databaseWorldbookName: settings.databaseWorldbookName,
    animaRecallCount: settings.animaRecallCount,
  });
  if (memoryResult.text) {
    payload.memory_source = memoryResult.source;
    payload.memory_context = memoryResult.text;
  }
  if (payload.mainflow_context_snapshot) {
    payload.character_worldbook_name = null;
  } else if (!payload.character_worldbook && !payload.character_worldbook_name) {
    payload.character_worldbook_name = await getCharacterWorldBookNameViaSTscript();
  }
  if (!payload.character_worldbook && payload.character_worldbook_name && canLoadHostWorldInfo(ctx)) {
    try {
      const loadedWorldBook = await loadHostWorldInfo(ctx, payload.character_worldbook_name);
      payload.character_worldbook = filterTrackerWorldbookEntries(
        loadedWorldBook || null,
        parseTrackerWorldbookExcludeNames(settings),
        settings,
        payload.recent_messages,
      );
    } catch (error) {
      console.warn('[BS BioTracker] loadWorldInfo for tracker failed', error);
    }
  }
  if (payload.mainflow_context_snapshot) {
    payload.character_additional_worldbook_names = [];
    payload.global_worldbooks = [];
  } else {
    const additionalBooks = await getCharacterAdditionalWorldbooksForTracker(ctx, settings, payload.recent_messages);
    const globalBooks = await getFilteredGlobalWorldbooks(ctx, settings, payload.recent_messages);
    payload.character_additional_worldbook_names = await getCharacterAdditionalWorldBookNames(ctx);
    // 附加知识书与全局启用书合并传输，按书名去重
    payload.global_worldbooks = mergeTrackerWorldbookLists(globalBooks, additionalBooks);
  }
  chatState.lastRunAt = Date.now();
  const attemptedSignature = buildSignature(ctx, messageIndex + 1);
  chatState.lastAttemptedSignature = attemptedSignature;
  saveSettings(ctx);
  const systemPrompt = buildTrackerSystemPrompt(settings.systemPrompt || DEFAULT_SYSTEM_PROMPT, settings.registryDescriptionGuides || null, payload);
  recordTrackerRequestDebug(systemPrompt, payload);
  const rawResult = await callOpenAICompatible(
    settings,
    payload,
    systemPrompt
  );
  recordTrackerResultDebug(rawResult);

  // 请求往返期间使用者可能删除或改写了这一楼。此时结果已经不对应任何现存讯息，
  // 照样套用会把状态写到不存在的楼上，还会记下一个与聊天对不起来的快照，
  // 后续对账便一路错下去。先把宿主视图刷新到最新再比对签名，不一致就整份作废。
  try {
    await refreshHostChatView(ctx, {
      resumeIndexes: getTrackerResumeIndexes(ctx, settings),
      contextSize: settings.contextSize,
    });
  } catch (error) {
    console.warn('[BS BioTracker] 分析后刷新聊天视图失败，改用现有视图比对', error);
  }
  if (buildSignature(ctx, messageIndex + 1) !== attemptedSignature) {
    console.warn('[BS BioTracker] 该消息在分析期间被修改或删除，本次结果已作废');
    chatState.lastRawResult = {
      message: '该消息在分析期间被修改或删除，本次结果已作废，未写入任何状态。',
      tool_calls: [],
    };
    chatState.lastOperationLogs = [];
    chatState.lastAttemptedSignature = '';
    saveSettings(ctx);
    return { discarded: true };
  }

  const result = normalizeTrackerResult(rawResult);
  result.character_check_coverage = buildCharacterCheckCoverage(payload.tracked_females, result.character_checks);
  applyToolCallsResult(ctx, result);
  chatState.lastProcessedSignature = attemptedSignature;
  chatState.lastFailedSignature = '';
  chatState.lastFailedChatSignature = '';
  recordChatStateSnapshot(ctx, chatState, { messageCount: messageIndex + 1, reason: 'tracker', bindToMessage: true });
  saveSettings(ctx);
  return { discarded: false, triggered: true };
}

export async function runTracker(ctx, deps, reason = 'manual') {
  const settings = getSettings(ctx);
  await hydrateChatStateFromHost(ctx, settings);
  await refreshHostChatView(ctx, {
    resumeIndexes: getTrackerResumeIndexes(ctx, settings),
    contextSize: settings.contextSize,
  });
  const chatState = getChatState(ctx, settings);
  reconcileMessageCheckpoints(ctx, chatState);
  const registeredTargets = getRegisteredTargetNames(ctx, settings, chatState);
  const chat = getHostChat(ctx);
  const lastMessage = chat[chat.length - 1];
  if (!lastMessage) {
    chatState.lastRawResult = {
      message: '当前对话没有可分析的消息，已跳过追踪。',
      tool_calls: [],
    };
    chatState.lastOperationLogs = [];
    saveSettings(ctx);
    deps.renderStatusPanel(ctx);
    return { skipped: true, reason: 'empty_chat' };
  }
  if (globalThis[RUN_RUNTIME_KEY]) {
    if (!isTrackerRunStale(settings)) {
      chatState.lastRawResult = {
        message: '已有一轮追踪请求正在执行，本次请求未重复发送。',
        tool_calls: [],
      };
      chatState.lastOperationLogs = [];
      saveSettings(ctx);
      deps.renderStatusPanel(ctx);
      return { skipped: true, reason: 'already_running' };
    }
    console.warn('[BS BioTracker] 上一轮追踪已超时未结束，强制释放运行锁');
    globalThis[RUN_RUNTIME_KEY] = null;
  }
  if (registeredTargets.length === 0) {
    chatState.lastRawResult = {
      message: '尚无已注册角色，跳过分析。',
      tool_calls: [],
    };
    chatState.lastOperationLogs = [];
    saveSettings(ctx);
    deps.renderStatusPanel(ctx);
    deps.updateMainFlowPrompt?.(ctx);
    return { skipped: true, reason: 'no_registered_targets' };
  }
  if (reason === 'poll' && getHostKind() === 'luker' && settings.lukerMultiAgentManualOnly !== false) {
    chatState.lastRawResult = {
      message: 'Luker 多智能体安全模式已开启，自动追踪暂停；请在编排完成后手动分析。',
      tool_calls: [],
    };
    chatState.lastOperationLogs = [];
    saveSettings(ctx);
    deps.renderStatusPanel(ctx);
    return { skipped: true, reason: 'luker_multi_agent_manual' };
  }
  if (reason === 'poll') {
    const agentBarrier = await getHostAgentRunBarrier(ctx, lastMessage);
    if (agentBarrier.state === 'pending') {
      chatState.lastRawResult = {
        message: `TauriTavern Agent run ${agentBarrier.runId} 尚未完成，自动追踪将等待最终提交。`,
        tool_calls: [],
      };
      chatState.lastOperationLogs = [];
      saveSettings(ctx);
      deps.renderStatusPanel(ctx);
      return { skipped: true, reason: 'agent_run_pending' };
    }
    if (agentBarrier.state === 'aborted') {
      chatState.lastRawResult = {
        message: `TauriTavern Agent run ${agentBarrier.runId} 已取消或失败，未自动追踪该提交；可手动分析。`,
        tool_calls: [],
      };
      chatState.lastOperationLogs = [];
      saveSettings(ctx);
      deps.renderStatusPanel(ctx);
      return { skipped: true, reason: 'agent_run_aborted' };
    }
  }
  if (reason === 'poll' && !isAfterAiMessageSettled(ctx, settings, chatState)) {
    return { skipped: true, reason: 'message_not_settled' };
  }
  if (reason === 'poll' && !hasPendingChatHistory(ctx, chatState)) {
    return { skipped: true, reason: 'no_pending_history' };
  }
  if (reason === 'poll' && shouldWaitForMvuExtraAnalysis(ctx, settings)) {
    return { skipped: true, reason: 'waiting_mvu_extra_analysis' };
  }
  if (reason === 'poll' && isFailedAutoRetryBlocked(ctx, chatState)) {
    return { skipped: true, reason: 'failed_message_blocked' };
  }
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  globalThis[RUN_RUNTIME_KEY] = runToken;
  markTrackerRunProgress();
  try {
    const { nextMessageIndex } =
      reason === 'manual' ? prepareManualReplay(ctx, chatState, chat.length) : reconcileChatStateSnapshots(ctx, chatState, settings);
    let processedCount = 0;
    let triggeredCount = 0;
    let discarded = false;
    for (let index = nextMessageIndex; index < chat.length; index += 1) {
      markTrackerRunProgress();
      const outcome = await processTrackerMessage(ctx, settings, chatState, deps, reason, index);
      // 聊天在分析途中被改动：后面的索引已经不可信，交给下一轮重新对账
      if (outcome?.discarded) {
        discarded = true;
        break;
      }
      if (outcome?.triggered) triggeredCount += 1;
      processedCount += 1;
    }
    deps.renderStatusPanel(ctx);
    deps.updateMainFlowPrompt?.(ctx);
    if (discarded) return { skipped: true, reason: 'message_changed_during_run', processedCount };
    if (reason === 'poll' && processedCount === 0) return;
    const toolCalls = Array.isArray(chatState.lastRawResult?.tool_calls) ? chatState.lastRawResult.tool_calls : [];
    emitTrackerUpdateCue({
      hasChanges: toolCalls.length > 0,
      processedCount,
      reason,
    });
    clearTrackerBusyToast();
    // 整轮都是 skip 记帐时不提示——使用者没有发起任何追踪，不该看到「追踪完成」
    if (triggeredCount > 0) notifyTrackerDone(toolCalls.length > 0);
    return { skipped: false, processedCount, triggeredCount, toolCalls };
  } catch (error) {
    console.error('[BS BioTracker] runTracker failed', error);
    recordTrackerResultDebug(null, error);
    chatState.lastFailedSignature = chatState.lastAttemptedSignature || buildSignature(ctx, chat.length);
    // 记下失败当下「整段对话」的签名：只要对话没变，自动重试就该被挡住。
    // 失败可能发生在回放的中间楼，只比对尾楼会让轮询无限重发。
    chatState.lastFailedChatSignature = buildSignature(ctx, getHostChat(ctx).length);
    chatState.lastRawResult = {
      error: String(error?.message || error),
      tool_calls: [],
    };
    chatState.lastOperationLogs = [];
    saveSettings(ctx);
    deps.renderStatusPanel(ctx);
    globalThis.toastr?.error?.(`追踪失败：${String(error?.message || error)}`, '[BS BioTracker]');
    throw error;
  } finally {
    // 中途放弃（对话被改动）与失败路径都会走到这里，常驻提示不能留在屏幕上
    clearTrackerBusyToast();
    // 被看门狗判死的旧轮次可能在新一轮开始后才走到这里，不能清掉别人的锁
    if (globalThis[RUN_RUNTIME_KEY] === runToken) {
      globalThis[RUN_RUNTIME_KEY] = null;
      globalThis[RUN_STARTED_AT_KEY] = 0;
    }
  }
}

export async function poll(ctx, deps) {
  const settings = getSettings(ctx);
  if (!settings.enabled) return;
  await runTracker(ctx, deps, 'poll');
}

export function resetPoller(ctx, deps) {
  if (globalThis[POLL_RUNTIME_KEY]) clearInterval(globalThis[POLL_RUNTIME_KEY]);
  // 尽早安装 MVU 生成请求钩子，避免正文后第一时间启动的 MVU 请求漏观测
  installMvuFetchHook();
  const settings = getSettings(ctx);
  globalThis[POLL_RUNTIME_KEY] = setInterval(() => {
    deps.updateClock(settings);
    poll(ctx, deps).catch((error) => console.error('[BS BioTracker] poll failed', error));
  }, Math.max(800, Number(settings.pollMs) || DEFAULT_SETTINGS.pollMs));
}
