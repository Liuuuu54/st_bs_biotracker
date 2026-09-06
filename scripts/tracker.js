import { callOpenAICompatible, resolveOverallDeadlineMs } from './api.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from './tracker_prompt_context.js';
import { DEFAULT_WEAR_STATE, sanitizeWearState } from './wardrobe_config.js';
import { applyToolCallsResult, isFetusKnownToCharacter, TOOL_DEFINITIONS } from './tools.js';
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
  restoreChatStateFromSnapshot,
  saveSettings,
  shouldTriggerForMessage,
  worldbookSelectionMatches,
} from './state.js';
import { getDerivedTypeMetabolismExemptions } from './race_config.js';
import { LABOR_STAGES, PREGNANCY_STAGES } from './stage_config.js';
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

export function isMvuExtraAnalysisEnabled(ctx, _settings) {
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

export function installMvuGateListener(ctx) {
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

export function shouldWaitForMvuExtraAnalysis(ctx, _settings) {
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
    // 避免旧 pendingSince 过期导致宽限路径立即放行。
    // 但正文替换的落库同样会改变内容指纹：它的戳记晚于等待起点时只更新指纹、
    // 不重排等待起点，否则每次替换都会把宽限续满，MVU 结束后的追踪被越推越晚。
    mvuGateState.pendingContentKey = contentKey;
    if (!isReplacementAfter({ stampedAt: mvuGateState.pendingSince }, last)) {
      mvuGateState.pendingSince = now;
      mvuGateState.sawGenerateThisRound = false;
    }
  }

  // 信号 1：MVU 全局 API 报告正在解析
  const during = mvuCapable && mvu.isDuringExtraAnalysis() === true;
  // 信号 2：正文之后仍有非本插件的生成请求在飞行——仅作旧版 MVU（没有
  // isDuringExtraAnalysis 全局）的兜底。请求特征会被误命中：数据库正文替换/
  // 填表的请求体嵌着含 <UpdateVariable>、json_patch 字样的正文与提示词，全局
  // 标志可得时不再采信它，否则兼容门控会串行等完数据库一整条后处理管线
  // （TT 实测一分钟以上的延迟）。
  const generateActive = !mvuCapable && mvuGateState.generateInFlight > 0;
  // 生成请求只作为本轮「在飞」等待信号，不参与 everSawMvuSignal——
  // 否则普通 ST 主流请求也会让设备被标记为「见过 MVU 信号」，导致每轮白等宽限
  if (during) mvuGateState.everSawMvuSignal = true;

  // 结束事件与评估之间正文若被替换改写过（指纹对不上），只要替换戳晚于结束事件，
  // 说明 MVU 的产物已落定、无需再等宽限——直接放行，在最终正文上只追一轮
  const endedKeyMatch = mvuGateState.lastEndedKey === roundKey;
  const replacementAfterEnd = endedKeyMatch
    && isReplacementAfter({ stampedAt: mvuGateState.lastEndedAt }, last);
  const waiting = resolveMvuGateWaiting(roundKey, contentKey, now, during || generateActive, replacementAfterEnd);
  // 等待全程静默：MVU 解析结束紧接着就是追踪提示，中间再弹一条等待提示纯属噪音；
  // 排查时看 console 即可
  if (waiting) console.debug('[BS BioTracker] MVU 額外解析尚未結束，本輪追蹤推遲');
  return waiting;
}

function resolveMvuGateWaiting(roundKey, contentKey, now, signalActive, replacementAfterEnd) {
  if (signalActive) return now - mvuGateState.pendingSince < MVU_EXTRA_MAX_WAIT_MS;
  // 本轮变量更新已结束（事件新鲜且内容指纹一致）→ 放行
  if (mvuGateState.lastEndedKey === roundKey
    && now - mvuGateState.lastEndedAt < MVU_EXTRA_ENDED_STALE_MS
    && (mvuGateState.lastEndedContentKey === contentKey || replacementAfterEnd)) return false;
  // 从没见过任何 MVU 信号（非 MVU 卡）→ 不等待；见过 → 宽限期内等信号出现
  if (!mvuGateState.everSawMvuSignal) return false;
  return now - mvuGateState.pendingSince < MVU_EXTRA_WAIT_GRACE_MS;
}

// ---- 主生成忙碌闸门 / 静默正文替换吸收 ----
// 「异步追踪 + MVU 额外模型解析 + 数据库正文替换」同时开启时，一轮回复会被追三遍：
// 主生成没完就对着残缺正文抢发一轮（宿主串流期间按 chunk 往 mes 写半成品，
// chunk 间隙一超过 settle 稳定窗就被判成「说完了」）、正文替换用
// setChatMessages 原地静默改写同楼层 mes 又不发任何宿主事件，快照的边界签名
// 失配被当成新内容又追一轮。对应两条规则：
// 1. 轮询在「宿主主生成在飞」时不发追踪。判据只用两个权威信号源的并集：
//    停止按钮 DOM 旗标（document.body.dataset.generating，ST/TT 同源，重掷/
//    续写/群成员/借道 Generate 的生成都会点亮）与未闭合的 generation_started
//    事件（带超时自愈）。不使用 ctx.streamingProcessor：插件持有的是加载时的
//    一次性 getContext() 快照，该字段指望不上。也不把「带 MVU 特征的 fetch 在
//    飞」当忙碌信号：正文替换与填表请求的 body 本就会嵌进含 <UpdateVariable>
//    的正文，被特征命中，TT 实测会把整条数据库后处理排进追踪前面、拖出约两
//    分钟延迟。MVU 额外模型解析的等待仍由既有兼容门控负责（TT 走带停止按钮的
//    Generate 管线，dataset 信号同样会覆盖它这一程）；兼容开关语义原样不变。
// 2. 正文替换会把毫秒时间戳 `_acu_last_optimized_at` 写进该楼层的 extra——
//    shujuku 与 shujuku-rebuild 皆然，只有正文替换写它、随消息持久化、跨页面
//    重载有效。楼层已有追踪回执、且该时间戳晚于回执时，正文差异就是替换改写：
//    就地重锚签名、不重发请求（恒开、无提示）。手动编辑、重掷、续写、换楼层都
//    不会盖出这个时间戳，照常走追踪路径；若宿主事件计数之类的内存态一律不作为
//    判据（重载即归零，会把编辑后的合法改动误判成「无痕」而吞掉）。将来若出现
//    不打此标记的其他静默写回者，宁可多追一轮也不漏，方向安全。

const HOST_BUSY_STALE_MS_KEY = '__bs_biotracker_host_busy_stale_ms__';
/** 两个数据库正文替换落库时在楼层 extra 上盖的毫秒时间戳（唯一写者） */
const CONTENT_REPLACEMENT_MARK_KEY = '_acu_last_optimized_at';

const hostRunState = {
  listenersInstalled: false,
  generationDepth: 0,
  generationBusySince: 0,
  // 编辑/抽卡事件计数：吸收判定要求「回执之后没有编辑事件」。持久化到
  // settings.hostMutSeqCounter 并在载入时回填，重载后继续单调递增——纯内存
  // 计数重载归零会把「重载后的手动编辑」误判成无痕而吞掉追踪。
  mutSeq: 0,
  ctxRef: null,
};
export const __hostRunStateForTest = hostRunState;
// 与 MVU 门控同法：挂到全局方便在真实宿主的 console 里排查触发问题
globalThis.__bs_biotracker_debug_host_run__ = hostRunState;

function resolveHostEventName(ctx, typeKey, fallback) {
  const types = ctx?.eventTypes || ctx?.event_types;
  const resolved = types?.[typeKey];
  return typeof resolved === 'string' && resolved ? resolved : fallback;
}

function markHostGenerationStart() {
  hostRunState.generationDepth += 1;
  if (hostRunState.generationDepth === 1) hostRunState.generationBusySince = Date.now();
}

function markHostGenerationEnd() {
  // 宿主 GENERATION_ENDED 只在停止按钮真的从显示转隐藏时发、嵌套不去重：一轮群里
  // 连续生成可能 STARTED 多次、ENDED 一次。把 ended/stopped 当作「宿主自认生成
  // 已全部结束」的权威信号直接清空深度（dataset 旗标仍是独立信号，真在飞时
  // 不会假清空），否则计数只增不减会把追踪卡死到看门狗上限。
  hostRunState.generationDepth = 0;
  hostRunState.generationBusySince = 0;
}

function bumpHostMutSeq() {
  hostRunState.mutSeq += 1;
  // 立即持久化：编辑事件是低频人工操作，直接存不心疼；不存的话「编辑后未及
  // 保存就重载」会让下一会话的回填值偏小、编辑痕迹丢失
  try {
    const ctx = hostRunState.ctxRef;
    if (ctx) {
      getSettings(ctx).hostMutSeqCounter = hostRunState.mutSeq;
      saveSettings(ctx);
    }
  } catch {}
}

/** 从持久化存档回填编辑计数（重载后 max(内存, 存档) 起步，保持单调）。 */
export function hydrateHostMutSeq(settings) {
  const persisted = Number(settings?.hostMutSeqCounter);
  if (Number.isFinite(persisted) && persisted > hostRunState.mutSeq) hostRunState.mutSeq = persisted;
}

export function installHostRunWatchers(ctx) {
  if (hostRunState.listenersInstalled) return;
  const source = ctx?.eventSource;
  if (!source || typeof source.on !== 'function') return;
  hostRunState.ctxRef = ctx;
  // 无论订到第几个都标记为已安装、不再重试：宿主 eventSource.on 实际不会抛，
  // 万一抛了也只可能缺一腿，重复叠加监听反而会把深度计数订乱
  hostRunState.listenersInstalled = true;
  try {
    source.on(resolveHostEventName(ctx, 'GENERATION_STARTED', 'generation_started'), markHostGenerationStart);
    source.on(resolveHostEventName(ctx, 'GENERATION_STOPPED', 'generation_stopped'), markHostGenerationEnd);
    source.on(resolveHostEventName(ctx, 'GENERATION_ENDED', 'generation_ended'), markHostGenerationEnd);
    source.on(resolveHostEventName(ctx, 'MESSAGE_EDITED', 'message_edited'), bumpHostMutSeq);
    source.on(resolveHostEventName(ctx, 'MESSAGE_SWIPED', 'message_swiped'), bumpHostMutSeq);
  } catch (error) {
    console.warn('[BS BioTracker] 無法訂閱宿主生成/編輯事件', error);
  }
}

function hostDatasetGenerating() {
  try {
    return globalThis.document?.body?.dataset?.generating === 'true';
  } catch {
    return false;
  }
}

/**
 * 宿主主生成是否仍在进行（不该发追踪）：停止按钮 DOM 旗标与未闭合的
 * generation started 两源并集，任一即忙；事件源带超时自愈。
 * 特意不含任何「插件级 fetch 观测」信号：数据库正文替换/填表的请求体常嵌着
 * 含 <UpdateVariable> 的正文，会被 MVU 特征误命中，把它们当作忙碌会把追踪
 * 排到整条数据库后处理之后（TT 实测拖出约两分钟的延迟）。MVU 额外模型解析
 * 的等待由既有的兼容门控 shouldWaitForMvuExtraAnalysis 负责（TT 上它走带停止
 * 按钮的 Generate 管线，dataset 信号同样会覆盖其在飞阶段），兼容开关语义不动。
 */
export function isHostGenerationBusy(ctx) {
  if (hostDatasetGenerating()) return true;
  if (hostRunState.generationDepth > 0) {
    const staleMs = Number(globalThis[HOST_BUSY_STALE_MS_KEY]) || 600000;
    if (Date.now() - hostRunState.generationBusySince > staleMs) {
      // 漏收 ended（页面切换/宿主早隐藏停止按钮）时不能永久卡死追踪
      hostRunState.generationDepth = 0;
      hostRunState.generationBusySince = 0;
    } else {
      return true;
    }
  }
  return false;
}

/** 楼层上正文替换盖的毫秒时间戳；没盖过返回 0。 */
function readReplacementMarkMs(message) {
  const raw = Number(message?.extra?.[CONTENT_REPLACEMENT_MARK_KEY]);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function getFloorAnchorFields(message) {
  return {
    anchorVersion: 1,
    // ST/TT 的消息对象没有 id 字段（只有 MVU 的 setChatMessages 形参叫 message_id，
    // 且那是传参不是落库字段）：有就比对、没有就跳过该项，绝不能以它为必要条件
    tailMessageId: message?.id === undefined || message?.id === null
      ? (message?.message_id === undefined || message?.message_id === null ? '' : String(message.message_id))
      : String(message.id),
    tailSwipeId: message?.swipe_id === undefined || message?.swipe_id === null ? '' : String(message.swipe_id),
    tailName: String(message?.name || ''),
    // 盖锚时刻的编辑计数与当时已见的替换戳值：吸收要求「之后没有编辑事件」
    // 且「戳值相对锚点前进过」——只认戳晚于回执会把「替换后的手动编辑」一起吞掉
    hostMutSeq: hostRunState.mutSeq,
    replacementStamp: readReplacementMarkMs(message),
    // 内存侧锚点时刻（在飞比对用）；快照持久化侧用 createdAt
    stampedAt: Date.now(),
  };
}

function sameFloorIdentity(stamp, currentFloor) {
  if (!currentFloor) return false;
  // id 两边都有才比：都没有（ST/TT 真机常态）时不以此拒绝
  const stampId = String(stamp?.tailMessageId || '');
  const currentId = String(currentFloor.id ?? currentFloor.message_id ?? '');
  if (stampId && currentId && stampId !== currentId) return false;
  if (String(currentFloor.swipe_id ?? '') !== String(stamp?.tailSwipeId ?? '')) return false;
  // 旧快照没有 tailName 时跳过该项（v1 锚点继续有效，不做版本迁移）
  const stampName = String(stamp?.tailName || '');
  if (stampName && String(currentFloor.name || '') !== stampName) return false;
  return true;
}

/**
 * 楼层当前的替换戳是否「相对锚点前进过」= 锚点之后确有新的替换写回。
 * 锚点带 replacementStamp（吸收快照记录了当时已见的戳值）时要求戳值严格大于它
 * ——戳没前进而内容变了必然不是替换（是编辑或其他写回者），不得吸收；
 * 旧锚点没有该字段（tracker 回执）时回退「戳晚于锚点时刻」判定。
 */
function isReplacementAfter(snapshot, currentFloor) {
  const stamp = readReplacementMarkMs(currentFloor);
  if (!stamp) return false;
  const lastSeen = Number(snapshot?.replacementStamp);
  if (Number.isFinite(lastSeen) && lastSeen > 0) return stamp > lastSeen;
  const anchorAtMs = Number(snapshot?.createdAt) || Number(snapshot?.stampedAt);
  if (!anchorAtMs) return false;
  return stamp > anchorAtMs;
}

function findReplacementAnchorSnapshot(chatState, count) {
  const snapshots = Array.isArray(chatState?.snapshots) ? chatState.snapshots : [];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    const reason = String(snapshot?.reason || '');
    if (reason !== 'tracker' && reason !== 'silent_replace') continue;
    if (Number(snapshot?.messageCount) !== count) continue;
    return snapshot;
  }
  return null;
}

/**
 * 数据库正文替换的静默吸收：追踪回执所在楼层带着「相对锚点前进过的替换戳」、
 * 且锚点之后没有编辑/抽卡事件时，就地重锚快照与 lastProcessedSignature，
 * 下一轮不再发出追踪请求。返回 true = 本轮轮询已被吸收。恒生效、无开关、无提示。
 * 只认「戳晚于回执」会把「替换后用户又手动编辑」一起吞掉（编辑不动戳），
 * 因此编辑事件计数与戳值前进是必要条件；两者皆有持久化，跨重载成立。
 */
export function tryAdoptSilentTailReplacement(ctx, settings, chatState) {
  hydrateHostMutSeq(settings);
  const chat = getHostChat(ctx);
  const count = chat.length;
  if (count <= 0) return false;
  const last = chat[count - 1];
  if (!last || last.is_user) return false;
  if (!readReplacementMarkMs(last)) return false;
  const currentSignature = buildSignature(ctx, count);
  if (currentSignature && currentSignature === String(chatState?.lastProcessedSignature || '')) return false;
  const snapshot = findReplacementAnchorSnapshot(chatState, count);
  if (!snapshot || Number(snapshot.anchorVersion) !== 1) return false;
  if (!sameFloorIdentity(snapshot, last)) return false;
  if (!isReplacementAfter(snapshot, last)) return false;
  const stampSeq = Number(snapshot.hostMutSeq);
  if (Number.isFinite(stampSeq) && stampSeq >= 0 && hostRunState.mutSeq > stampSeq) return false;
  if (isHostGenerationBusy(ctx)) return false;
  settings.hostMutSeqCounter = hostRunState.mutSeq;
  recordChatStateSnapshot(ctx, chatState, {
    messageCount: count,
    reason: 'silent_replace',
    ...getFloorAnchorFields(last),
  });
  chatState.lastProcessedSignature = currentSignature;
  saveSettings(ctx);
  console.debug('[BS BioTracker] 偵測到正文替換回寫（替换戳前进且无编辑事件），已重新锚定，未重發請求');
  return true;
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
      fetuses: pregnant.fetuses.filter(isFetusKnownToCharacter).map((fetus) => {
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
          fetusesCount: hasFetuses ? pregnant.fetuses.filter(isFetusKnownToCharacter).length : 0,
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
    return {
      ...value,
      entries: value.entries.filter(keepEntry),
    };
  }

  if (value.entries && typeof value.entries === 'object') {
    const filteredEntries = Object.fromEntries(
      Object.entries(value.entries).filter(([, entry]) => keepEntry(entry)),
    );
    return {
      ...value,
      entries: filteredEntries,
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

export function getMainflowContextSnapshot(ctx) {
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
        content: String(message.content || ''),
        name: message.name ? String(message.name) : undefined,
      }))
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
  let mainflowContextSnapshot = useMainflowMode ? getMainflowContextSnapshot(ctx) : null;
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
  if (chatLength <= 0) {
    return { nextMessageIndex: 0 };
  }
  const replayStart = Math.max(0, chatLength - 1);
  const baseSnapshot = replayStart > 0 ? getLatestMatchingSnapshot(ctx, chatState, replayStart) : null;
  if (baseSnapshot) {
    restoreChatStateFromSnapshot(chatState, baseSnapshot);
  }
  return { nextMessageIndex: replayStart };
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
  // 记下发出请求那一刻楼层的样子与编辑计数：返回时正文若有变化，用它区分
  // 「重掷/编辑/删楼的合法改动」与「正文替换的静默改写（替换戳前进且无编辑事件）」
  hydrateHostMutSeq(settings);
  const preCallFloorStamp = getFloorAnchorFields(chat[messageIndex]);
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
  const postCallSignature = buildSignature(ctx, messageIndex + 1);
  // 在飞期间正文被改写：只有「替换戳相对发出时前进、且没有编辑/抽卡事件、
  // 同楼层同身份」才算正文替换（分析对象仍是替换前正文，结果对剧情有效）——
  // 沿用结果、就地重锚；替换后又手改（编辑事件）、或重掷/删楼照旧作废整份结果。
  const currentFloorAfterCall = getHostChat(ctx)[messageIndex];
  const silentReplacementDuringRun = postCallSignature !== attemptedSignature
    && getHostChat(ctx).length === messageIndex + 1
    && sameFloorIdentity(preCallFloorStamp, currentFloorAfterCall)
    && isReplacementAfter(preCallFloorStamp, currentFloorAfterCall)
    && hostRunState.mutSeq === preCallFloorStamp.hostMutSeq
    && !isHostGenerationBusy(ctx);
  if (postCallSignature !== attemptedSignature && !silentReplacementDuringRun) {
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
  if (silentReplacementDuringRun) {
    console.debug('[BS BioTracker] 追踪进行期间正文被静默替换，沿用本次结果并改按替换后正文重新锚定');
  }

  const result = normalizeTrackerResult(rawResult);
  result.character_check_coverage = buildCharacterCheckCoverage(payload.tracked_females, result.character_checks);
  applyToolCallsResult(ctx, result);
  chatState.lastProcessedSignature = silentReplacementDuringRun ? postCallSignature : attemptedSignature;
  chatState.lastFailedSignature = '';
  chatState.lastFailedChatSignature = '';
  settings.hostMutSeqCounter = hostRunState.mutSeq;
  recordChatStateSnapshot(ctx, chatState, {
    messageCount: messageIndex + 1,
    reason: 'tracker',
    ...getFloorAnchorFields(getHostChat(ctx)[messageIndex]),
  });
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
  if (reason === 'poll' && isHostGenerationBusy(ctx)) {
    // 主连接没说完话就绝不追踪：从根上消灭「开始吐字时抢发一轮」
    return { skipped: true, reason: 'host_generation_in_flight' };
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
  if (reason === 'poll' && tryAdoptSilentTailReplacement(ctx, settings, chatState)) {
    // 正文替换的无痕改写：静默重锚，不发请求也不弹任何提示
    return { skipped: true, reason: 'silent_tail_replacement' };
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
    globalThis.toastr?.error?.(String(error?.message || error), '[BS BioTracker]');
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
  // 变量更新结束事件监听同样必须提前装：忙碌闸门会跳过解析期间的门控评估，
  // 若等第一次评估才订事件，mag_variable_update_ended 早已错过、只能靠宽限干等
  installMvuGateListener(ctx);
  // 宿主 generation/编辑/swipe 事件监听同样只装一次：忙碌闸门与静默替换判定都靠它
  installHostRunWatchers(ctx);
  const settings = getSettings(ctx);
  globalThis[POLL_RUNTIME_KEY] = setInterval(() => {
    deps.updateClock(settings);
    poll(ctx, deps).catch((error) => console.error('[BS BioTracker] poll failed', error));
  }, Math.max(800, Number(settings.pollMs) || DEFAULT_SETTINGS.pollMs));
}
