const EMPTY_LIST = Object.freeze([]);
const HOST_CHAT_VIEW_CACHE = new WeakMap();
const HOST_STABLE_CHAT_ID_CACHE = new WeakMap();
const TAURI_HISTORY_PAGE_SIZE = 200;
const TAURI_STATE_NAMESPACE = 'bs-biotracker';
const TAURI_STATE_KEY = 'chat-state-v1';
const TAURI_STATE_SAVE_DELAY_MS = 250;
const TAURI_STATE_SAVE_QUEUE = new Map();
const TAURI_STATE_KNOWN_MISSING_IDS = new Set();
const TAURI_STATE_LOAD_INFLIGHT = new Map();
// 已经确认过存档内容（读到了资料，或确认过没有存档）的聊天。
// 在确认之前绝不允许用空状态回写 sidecar，详见 shouldSkipBlankHostChatStateSave。
const TAURI_STATE_HYDRATED_IDS = new Set();
const TAURI_HANDLE_WAIT_TIMEOUT_MS = 3000;
const TAURI_HANDLE_WAIT_INTERVAL_MS = 100;
const HOST_EVENT_TYPE_KEYS = Object.freeze({
  appReady: 'APP_READY',
  chatChanged: 'CHAT_CHANGED',
  chatCreated: 'CHAT_CREATED',
  chatDeleted: 'CHAT_DELETED',
  groupChatCreated: 'GROUP_CHAT_CREATED',
  groupChatDeleted: 'GROUP_CHAT_DELETED',
});

export function getHostKind() {
  if (globalThis.__TAURITAVERN__) return 'tauritavern';
  if (globalThis.Luker?.getContext) return 'luker';
  return 'sillytavern';
}

export function getHostContext() {
  try {
    return globalThis.Luker?.getContext?.() || globalThis.SillyTavern?.getContext?.() || null;
  } catch (error) {
    console.warn('[BS BioTracker] unable to read host context', error);
    return null;
  }
}

export async function getHostAgentRunBarrier(ctx, message) {
  if (getHostKind() !== 'tauritavern') return { state: 'not_applicable', runId: '' };
  const runId = String(message?.extra?.tauritavern?.agent?.runId || '').trim();
  if (!runId) return { state: 'not_applicable', runId: '' };
  const ready = globalThis.__TAURITAVERN__?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  const agentApi = getTauriTavernApi()?.agent;
  if (typeof agentApi?.readEvents !== 'function') return { state: 'pending', runId };
  try {
    const result = await agentApi.readEvents({ runId, limit: 500 });
    const events = Array.isArray(result?.events) ? result.events : [];
    const types = new Set(events.map((event) => String(event?.type || '')));
    if (types.has('run_completed')) return { state: 'completed', runId };
    if (types.has('run_cancelled') || types.has('run_failed')) return { state: 'aborted', runId };
    return { state: 'pending', runId };
  } catch (error) {
    console.warn('[BS BioTracker] unable to read TauriTavern agent run events', error);
    return { state: 'pending', runId };
  }
}

export function subscribeHostEvent(ctx, eventName, handler) {
  const eventSource = ctx?.eventSource;
  const eventTypeKey = HOST_EVENT_TYPE_KEYS[eventName];
  const eventType = eventTypeKey ? ctx?.event_types?.[eventTypeKey] : null;
  if (!eventSource || !eventType || typeof eventSource.on !== 'function' || typeof handler !== 'function') return null;
  const safeHandler = (...args) => {
    try {
      const result = handler(...args);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error(`[BS BioTracker] host event ${eventName} failed`, error));
      }
    } catch (error) {
      console.error(`[BS BioTracker] host event ${eventName} failed`, error);
    }
  };
  eventSource.on(eventType, safeHandler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (typeof eventSource.off === 'function') eventSource.off(eventType, safeHandler);
  };
}

export function replaceHostEventSubscription(ctx, eventName, previousUnsubscribe, handler) {
  if (typeof previousUnsubscribe === 'function') previousUnsubscribe();
  return subscribeHostEvent(ctx, eventName, handler);
}

export function getHostChat(ctx) {
  const cached = ctx && typeof ctx === 'object' ? HOST_CHAT_VIEW_CACHE.get(ctx) : null;
  if (cached?.chatId === getHostChatId(ctx) && Array.isArray(cached.messages)) return cached.messages;
  return Array.isArray(ctx?.chat) ? ctx.chat : EMPTY_LIST;
}

export function hasAbsoluteHostChatView(ctx) {
  const cached = ctx && typeof ctx === 'object' ? HOST_CHAT_VIEW_CACHE.get(ctx) : null;
  return Boolean(cached?.chatId === getHostChatId(ctx) && cached.absolute === true);
}

function assignHistoryPage(target, page) {
  const startIndex = Math.max(0, Number(page?.startIndex) || 0);
  const messages = Array.isArray(page?.messages) ? page.messages : EMPTY_LIST;
  for (let index = 0; index < messages.length; index += 1) {
    target[startIndex + index] = messages[index];
  }
}

export async function refreshHostChatView(ctx, options = {}) {
  if (getHostKind() !== 'tauritavern') return getHostChat(ctx);
  const ready = globalThis.__TAURITAVERN__?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  const api = getTauriTavernApi()?.chat;
  if (!api?.current?.windowInfo || !api?.current?.handle) return getHostChat(ctx);

  const info = await api.current.windowInfo();
  const totalCount = Math.max(0, Number(info?.totalCount) || 0);
  const contextSize = Math.max(2, Number(options.contextSize) || 12);
  const resumeIndexes = Array.isArray(options.resumeIndexes) ? options.resumeIndexes : [options.afterIndex];
  const afterIndex = resumeIndexes.reduce((latest, value) => {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index <= totalCount && index > latest ? index : latest;
  }, 0);
  const requiredStartIndex = Math.max(0, afterIndex - contextSize);
  const minimumTailSize = Math.max(contextSize, totalCount - requiredStartIndex);
  const handle = api.current.handle();
  const startChatId = getHostChatId(ctx);
  let page = await handle.history.tail({ limit: Math.min(TAURI_HISTORY_PAGE_SIZE, Math.max(1, minimumTailSize)) });
  const messages = new Array(totalCount);
  assignHistoryPage(messages, page);

  while (page?.hasMoreBefore && Number(page.startIndex) > requiredStartIndex) {
    // 分页期间宿主可能被切走：若当前聊天已变，直接放弃本次结果
    page = await handle.history.before(page, { limit: TAURI_HISTORY_PAGE_SIZE });
    assignHistoryPage(messages, page);
    if (getHostChatId(ctx) !== startChatId) break;
  }

  // 中途切换聊天 → 旧数据不写缓存，通知调用方本轮作废重试
  const endChatId = getHostChatId(ctx);
  if (endChatId !== startChatId) return refreshHostChatView(ctx, options);

  HOST_CHAT_VIEW_CACHE.set(ctx, {
    absolute: true,
    chatId: startChatId,
    messages,
    loadedStartIndex: Math.max(0, Number(page?.startIndex) || 0),
    totalCount,
  });
  return messages;
}

export function getHostCharacters(ctx) {
  return Array.isArray(ctx?.characters) ? ctx.characters : EMPTY_LIST;
}

export function getHostChatId(ctx) {
  const fallbackId = getFallbackHostChatId(ctx);
  if (getHostKind() === 'tauritavern') {
    const cached = ctx && typeof ctx === 'object' ? HOST_STABLE_CHAT_ID_CACHE.get(ctx) : null;
    if (cached?.fallbackId === fallbackId && cached.stableId) return cached.stableId;
  }
  return fallbackId;
}

function getFallbackHostChatId(ctx) {
  try {
    const currentChatId = ctx?.getCurrentChatId?.();
    if (currentChatId !== undefined && currentChatId !== null && String(currentChatId)) {
      return String(currentChatId);
    }
  } catch (error) {
    console.warn('[BS BioTracker] unable to read current chat id', error);
  }
  if (ctx?.chatId !== undefined && ctx?.chatId !== null && String(ctx.chatId)) return String(ctx.chatId);
  return `${ctx?.characterId ?? 'char'}:${ctx?.groupId ?? 'solo'}`;
}

export async function resolveHostChatId(ctx) {
  const fallbackId = getFallbackHostChatId(ctx);
  if (getHostKind() !== 'tauritavern') return fallbackId;
  const cached = ctx && typeof ctx === 'object' ? HOST_STABLE_CHAT_ID_CACHE.get(ctx) : null;
  if (cached?.fallbackId === fallbackId && cached.stableId) return cached.stableId;
  const ready = globalThis.__TAURITAVERN__?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  const handle = getCurrentTauriChatHandle();
  if (typeof handle?.stableId !== 'function') return fallbackId;
  try {
    const stableId = String(await handle.stableId() || '').trim();
    if (!stableId) return fallbackId;
    if (ctx && typeof ctx === 'object') HOST_STABLE_CHAT_ID_CACHE.set(ctx, { fallbackId, stableId });
    return stableId;
  } catch (error) {
    console.warn('[BS BioTracker] unable to resolve TauriTavern stable chat id', error);
    return fallbackId;
  }
}

export function getHostExtensionSettings(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') ctx.extensionSettings = {};
  return ctx.extensionSettings;
}

export function saveHostSettings(ctx) {
  try {
    ctx?.saveSettingsDebounced?.();
  } catch (error) {
    console.warn('[BS BioTracker] unable to save host settings', error);
  }
}

export function getHostChatCompletionSettings(ctx = null) {
  const runtime = ctx || getHostContext();
  const settings = runtime?.chatCompletionSettings;
  return settings && typeof settings === 'object' ? settings : null;
}

export function canLoadHostWorldInfo(ctx) {
  return typeof ctx?.loadWorldInfo === 'function';
}

export async function loadHostWorldInfo(ctx, name) {
  if (!canLoadHostWorldInfo(ctx)) return null;
  return ctx.loadWorldInfo(String(name || ''));
}

export async function getHostWorldBook(name, scope = 'global') {
  const worldBookApi = globalThis.ST_API?.worldBook;
  if (typeof worldBookApi?.get !== 'function') return null;
  const result = await worldBookApi.get({ name: String(name || ''), scope: String(scope || 'global') });
  return result?.worldBook || null;
}

export async function getHostWorldInfoPrompt(ctx, chat, maxContext, includeNames = true) {
  if (typeof ctx?.getWorldInfoPrompt !== 'function') return null;
  return ctx.getWorldInfoPrompt(chat, maxContext, includeNames);
}

export function getHostPresetManager(ctx = null, apiId = 'openai') {
  const runtime = ctx || getHostContext();
  if (typeof runtime?.getPresetManager !== 'function') return null;
  return runtime.getPresetManager(apiId);
}

export async function listHostPresets() {
  const presetApi = globalThis.ST_API?.preset;
  return typeof presetApi?.list === 'function' ? presetApi.list() : null;
}

export async function getHostPreset(name, ctx = null) {
  const presetName = String(name || '').trim();
  if (!presetName) return null;
  const presetApi = globalThis.ST_API?.preset;
  if (typeof presetApi?.get === 'function') {
    const result = await presetApi.get({ name: presetName });
    if (result?.preset && typeof result.preset === 'object') return result.preset;
  }
  if (globalThis.openai_settings && typeof globalThis.openai_settings === 'object') {
    const preset = globalThis.openai_settings[presetName];
    if (preset && typeof preset === 'object') return preset;
  }
  const settings = getHostChatCompletionSettings(ctx);
  if (settings?.[presetName] && typeof settings[presetName] === 'object') return settings[presetName];
  if (settings?.presets?.[presetName] && typeof settings.presets[presetName] === 'object') return settings.presets[presetName];
  return null;
}

export async function registerHostExtensionMenuItem(options) {
  const uiApi = globalThis.ST_API?.ui;
  if (typeof uiApi?.registerExtensionsMenuItem !== 'function') return false;
  await uiApi.registerExtensionsMenuItem(options);
  return true;
}

export function getTauriTavernApi() {
  const api = globalThis.__TAURITAVERN__?.api;
  return api && typeof api === 'object' ? api : null;
}

function cloneHostValue(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getCurrentTauriChatHandle() {
  const api = getTauriTavernApi()?.chat;
  return typeof api?.current?.handle === 'function' ? api.current.handle() : null;
}

/**
 * 保守判空：只有确认不含任何用户资料才算空。
 * 判错方向要偏「非空」——把真资料误判为空会导致存档被洗掉，反之只是多写一次。
 * 不复用 state.js 的 isChatStateEffectivelyEmpty，因为 state.js 依赖本模块，反向 import 会成环。
 */
function isHostChatStateBlank(chatState) {
  if (!chatState || typeof chatState !== 'object') return true;
  const characters = chatState.characters;
  if (characters && typeof characters === 'object' && Object.keys(characters).length > 0) return false;
  if (Array.isArray(chatState.skillCatalog) && chatState.skillCatalog.length > 0) return false;
  if (Array.isArray(chatState.snapshots) && chatState.snapshots.length > 0) return false;
  return true;
}

/**
 * 防止空状态覆盖既有存档。
 *
 * TT／Luker 上 chatStates 不进全局设置，per-chat sidecar 是唯一真源，每次重开都靠 hydrate 读回来。
 * 一旦 hydrate 没成功（store 未就绪、宿主抛 Failed to resolve active character id 等），
 * 内存里就是一份刚建出来的空状态；而 getChatState 归一化时会顺手 saveSettings，
 * 把这份空状态按 handle 写进该聊天的 sidecar，真正的注册资料就此被洗掉。
 *
 * 因此：没确认过这个聊天存了什么之前，空状态一律不写。
 * 确认过之后（读到资料，或确认没有存档）才放行，使用者主动「清除」仍能正常落盘。
 */
function shouldSkipBlankHostChatStateSave(chatId, chatState) {
  if (!isHostChatStateBlank(chatState)) return false;
  return !TAURI_STATE_HYDRATED_IDS.has(chatId);
}

/**
 * 是否已经确认过当前聊天的存档内容。
 * 原生宿主不依赖 sidecar，永远视为已确认；TT／Luker 未确认時代表这次载入没有定论，
 * 呼叫端应该稍后重试，而不是把面板当成「没有注册角色」。
 */
export function isHostChatStateConfirmed(ctx) {
  const hostKind = getHostKind();
  if (hostKind !== 'tauritavern' && hostKind !== 'luker') return true;
  return TAURI_STATE_HYDRATED_IDS.has(getHostChatId(ctx));
}

/**
 * 等待当前聊天的 store 句柄就绪。
 * 重开存档时 TT 主体可能已经 ready，但该聊天的 handle 还没挂上；
 * 原本直接当成「没有存档」返回，面板就会显示成未注册。这里给一段有限等待。
 */
/**
 * 先确认 sidecar 是否存在，避免直接 getJson 触发宿主的 not-found 弹窗。
 *
 * TauriTavern 把 store 读取 miss 当成后端错误：新聊天第一次探测时，
 * 使用者会看到一个红色的「后端错误 Failed to get chat store json …」，
 * 虽然不影响功能，但很吓人。后端其实提供了 list_character_chat_store_keys，
 * 只是前端包装的方法名未知，因此这里做特性探测：
 * 探得到就先列 key 再决定要不要读；探不到就回退成原本的直接读取。
 *
 * @returns {Promise<boolean|null>} true/false 为确定结果，null 表示无从检查
 */
async function tauriChatStoreHasKey(handle, namespace, key) {
  const store = handle?.store;
  if (!store) return null;
  const lister = [store.listKeys, store.list, store.keys, store.listJsonKeys]
    .find((candidate) => typeof candidate === 'function');
  if (!lister) return null;
  try {
    const result = await lister.call(store, { namespace });
    const keys = Array.isArray(result)
      ? result
      : (Array.isArray(result?.keys) ? result.keys : null);
    if (!keys) return null;
    return keys.some((entry) => String(entry?.key ?? entry) === key);
  } catch {
    // 列举本身失败就当作无从检查，交回原本的读取路径
    return null;
  }
}

async function waitForTauriChatStoreHandle(timeoutMs = TAURI_HANDLE_WAIT_TIMEOUT_MS) {
  let handle = getCurrentTauriChatHandle();
  if (typeof handle?.store?.getJson === 'function') return handle;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TAURI_HANDLE_WAIT_INTERVAL_MS));
    handle = getCurrentTauriChatHandle();
    if (typeof handle?.store?.getJson === 'function') return handle;
  }
  return null;
}

export async function loadHostChatState(ctx = null) {
  const hostKind = getHostKind();
  if (hostKind === 'luker') {
    const runtime = ctx || getHostContext();
    if (typeof runtime?.getChatState !== 'function') return null;
    try {
      const stored = await runtime.getChatState(TAURI_STATE_NAMESPACE);
      // 读到了（无论有没有资料）就算确认过内容，之后才允许写空
      TAURI_STATE_HYDRATED_IDS.add(getHostChatId(ctx));
      if (stored?.version === 1 && stored.chatState && typeof stored.chatState === 'object') return cloneHostValue(stored.chatState);
    } catch (error) {
      // 读取失败＝内容未知，保持未确认状态，避免拿空的覆盖掉
      console.warn('[BS BioTracker] unable to load Luker chat state', error);
    }
    return null;
  }
  if (hostKind !== 'tauritavern') return null;
  const ready = globalThis.__TAURITAVERN__?.ready || globalThis.__TAURITAVERN_MAIN_READY__;
  if (ready && typeof ready.then === 'function') await ready;
  // 句柄还没挂上时不当成「没有存档」：等一小段时间，超时则维持未确认让呼叫端重试
  const handle = await waitForTauriChatStoreHandle();
  if (!handle) return null;
  // TT surfaces every backend store miss as an error toast, so remember chats
  // without stored state and skip repeat probes until our own save creates one.
  const chatId = await resolveHostChatId(ctx);
  if (TAURI_STATE_KNOWN_MISSING_IDS.has(chatId)) {
    TAURI_STATE_HYDRATED_IDS.add(chatId);
    return null;
  }
  const inflight = TAURI_STATE_LOAD_INFLIGHT.get(chatId);
  if (inflight) return inflight;
  const loadPromise = (async () => {
    // 能事先确认不存在时就不要读，省下宿主那个吓人的 not-found 错误弹窗
    const exists = await tauriChatStoreHasKey(handle, TAURI_STATE_NAMESPACE, TAURI_STATE_KEY);
    if (exists === false) {
      TAURI_STATE_KNOWN_MISSING_IDS.add(chatId);
      TAURI_STATE_HYDRATED_IDS.add(chatId);
      return null;
    }
    try {
      const stored = await handle.store.getJson({ namespace: TAURI_STATE_NAMESPACE, key: TAURI_STATE_KEY });
      // 读到了（无论有没有资料）就算确认过内容，之后才允许写空
      TAURI_STATE_HYDRATED_IDS.add(chatId);
      if (stored?.version === 1 && stored.chatState && typeof stored.chatState === 'object') {
        return cloneHostValue(stored.chatState);
      }
    } catch (error) {
      if (/not found/i.test(String(error?.message || error))) {
        // 确认这个聊天没有存档，写空无害
        TAURI_STATE_KNOWN_MISSING_IDS.add(chatId);
        TAURI_STATE_HYDRATED_IDS.add(chatId);
      } else {
        // 其它错误＝内容未知（store 未就绪、宿主报错等），保持未确认，避免拿空的覆盖掉
        console.warn('[BS BioTracker] unable to load TauriTavern chat state', error);
      }
    }
    return null;
  })();
  TAURI_STATE_LOAD_INFLIGHT.set(chatId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    TAURI_STATE_LOAD_INFLIGHT.delete(chatId);
  }
}

export function scheduleHostChatStateSave(ctx, chatState) {
  const hostKind = getHostKind();
  if (!chatState || typeof chatState !== 'object') return;
  if (hostKind === 'luker') {
    if (typeof ctx?.updateChatState !== 'function') return;
    const chatId = getHostChatId(ctx);
    if (shouldSkipBlankHostChatStateSave(chatId, chatState)) return;
    const previous = TAURI_STATE_SAVE_QUEUE.get(chatId);
    if (previous?.timer) clearTimeout(previous.timer);
    const payload = { version: 1, chatState: cloneHostValue(chatState) };
    const timer = setTimeout(async () => {
      const queued = TAURI_STATE_SAVE_QUEUE.get(chatId);
      if (!queued || queued.timer !== timer) return;
      TAURI_STATE_SAVE_QUEUE.delete(chatId);
      try {
        await queued.ctx.updateChatState(TAURI_STATE_NAMESPACE, () => queued.payload);
      } catch (error) {
        console.warn('[BS BioTracker] unable to save Luker chat state', error);
      }
    }, TAURI_STATE_SAVE_DELAY_MS);
    TAURI_STATE_SAVE_QUEUE.set(chatId, { ctx, payload, timer });
    return;
  }
  if (hostKind !== 'tauritavern') return;
  const handle = getCurrentTauriChatHandle();
  if (typeof handle?.store?.setJson !== 'function') return;
  const chatId = getHostChatId(ctx);
  if (shouldSkipBlankHostChatStateSave(chatId, chatState)) return;
  TAURI_STATE_KNOWN_MISSING_IDS.delete(chatId);
  const previous = TAURI_STATE_SAVE_QUEUE.get(chatId);
  if (previous?.timer) clearTimeout(previous.timer);
  const payload = { version: 1, chatState: cloneHostValue(chatState) };
  const timer = setTimeout(async () => {
    const queued = TAURI_STATE_SAVE_QUEUE.get(chatId);
    if (!queued || queued.timer !== timer) return;
    TAURI_STATE_SAVE_QUEUE.delete(chatId);
    try {
      await queued.handle.store.setJson({
        namespace: TAURI_STATE_NAMESPACE,
        key: TAURI_STATE_KEY,
        value: queued.payload,
      });
    } catch (error) {
      console.warn('[BS BioTracker] unable to save TauriTavern chat state', error);
    }
  }, TAURI_STATE_SAVE_DELAY_MS);
  TAURI_STATE_SAVE_QUEUE.set(chatId, { handle, payload, timer });
}
