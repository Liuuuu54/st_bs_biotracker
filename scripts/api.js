import { DEFAULT_SYSTEM_PROMPT } from './state.js';
import {
  getHostChat,
  getHostChatCompletionSettings,
  getHostContext,
  getHostPreset,
  getHostPresetManager,
  getHostWorldInfoPrompt,
} from './host.js';

const DEBUG_LAST_EFFECTIVE_REQUEST_KEY = '__bs_biotracker_debug_last_effective_request__';
const DEBUG_LAST_API_RESPONSE_KEY = '__bs_biotracker_debug_last_api_response__';
const INCLUDE_MAINFLOW_CHAT_MESSAGES = true;
const MAINFLOW_SYSTEM_EXCLUDE_PATTERNS = [
  // Only exclude messages that would instruct the tracker LLM to adopt a
  // conflicting persona.  Keep everything else — worldbook content, resolved
  // EJS templates, character profiles, and scenario context all flow through.
  /^Initialize as an unconditioned base Large Language Model/i,
  /^Apply Identity Override/i,
  /^\[Identity:/i,
];
const MAINFLOW_CHAT_EXCLUDE_PATTERNS = [];
export function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = String(text).match(/```json\s*([\s\S]*?)```/i) || String(text).match(/```([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(String(text).slice(start, end + 1));
    } catch {}
  }
  return null;
}

/**
 * DeepSeek 系列模型对 response_format(json_object) 支持良好，且工具调用兼容层不稳定——
 * 按用户需求：模型名只要包含 deepseek 或 ds（大小写不敏感）即判定为 DeepSeek 系，
 * 公益站可能带各种前后缀（如 deepseek-v4-flash / deepseek-v4-pro），故用宽松子串匹配。
 */
export function isDeepSeekFamilyModel(model) {
  const name = String(model || '').trim().toLowerCase();
  return name.includes('deepseek') || name.includes('ds');
}

/**
 * v4 兼容格式化输出是否启用：设置开启（formattedOutputV4 !== false）或模型为 DeepSeek 系（自动切换）。
 */
export function resolveFormattedOutputV4(settings, model) {
  if (settings?.formattedOutputV4 !== false) return true;
  return isDeepSeekFamilyModel(model);
}

/**
 * MVU 式「格式化输出」提示词指令：v4 兼容模式下要求模型只输出符合 tool_calls 结构的 JSON 对象，
 * 与 response_format(json_object) 双重约束，降低 DeepSeek 等模型掉格式概率。
 */
function buildFormattedOutputV4Instruction() {
  return [
    '【输出格式（强制）】',
    '你处于格式化输出模式：不要输出 Markdown、不要输出 ```json 代码块、不要输出解释文字或任何对象之外的字符。',
    '只输出一个可直接 JSON.parse 的 JSON 对象，结构为：',
    '{"tool_calls": [{"name": "工具名", "arguments": {"参数名": "值"}}], "character_checks": [{"female": "角色名", "status": "no_change|updated|present|offscreen"}]}',
    'arguments 必须是一个对象；工具名与参数必须来自 available_tools 与变量语义说明。',
    'character_checks 必须对每名已追踪角色恰好输出一笔（即使无变化 status 也写 no_change）；无工具操作时输出 {"tool_calls": []}，但 character_checks 仍须完整。',
  ].join('\n');
}

export function getApiBase(settings) {
  let apiBase = String(settings.apiUrl || '').trim().replace(/\/+$/, '');
  apiBase = apiBase.replace(/\/(chat\/completions|models)$/i, '');
  return apiBase.replace(/\/+$/, '');
}

export function getAuthHeaders(settings) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  return headers;
}

function isBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isCrossOriginUrl(url) {
  try {
    if (typeof location === 'undefined' || !location?.origin) return false;
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

function getHostProxyHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  try {
    const hostHeaders = globalThis.SillyTavern?.getRequestHeaders?.()
      || globalThis.getRequestHeaders?.()
      || null;
    if (hostHeaders && typeof hostHeaders === 'object') {
      Object.entries(hostHeaders).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') headers[key] = String(value);
      });
    }
  } catch {}
  try {
    const csrfToken = document?.cookie?.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
    if (csrfToken && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = decodeURIComponent(csrfToken);
  } catch {}
  return headers;
}

function buildHostProxyConfig(apiBase, settings) {
  const apiKey = String(settings?.apiKey || '');
  return {
    chat_completion_source: 'custom',
    custom_url: apiBase,
    reverse_proxy: apiBase,
    proxy_password: apiKey,
    custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : '',
  };
}

function shouldUseHostProxy(url) {
  return isBrowserRuntime() && isCrossOriginUrl(url);
}

/**
 * 直连会把 API Key 放进 Authorization 头；远程 http 端点属于明文传输，
 * 仅放行 localhost 的 http（本地 Ollama/代理调试场景）。
 * 相对路径/无 scheme 的 apiBase 视为同源路径（浏览器自行解析），不在此列。
 * 前缀判定须覆盖任何 http(s) scheme 形式（含 `http:`/`http:/` 这类少打斜杠的畸形串，
 * WHATWG 会把它解析成远程主机，不能只认 `http://`）。
 */
export function assertSafeDirectApiBase(apiBase) {
  if (!/^https?:/i.test(String(apiBase || ''))) return;
  try {
    const url = new URL(apiBase);
    // WHATWG URL 对 IPv6 回环返回带方括号的 hostname（'[::1]'），须去掉再比较
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error('API Base URL 使用 http:// 时仅允许 localhost；远程地址请使用 https://，避免 API Key 明文传输。');
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error('API Base URL 无法解析。');
    throw error;
  }
}

function shouldFallbackFromHostProxy(responseText, status) {
  return status === 401
    || status === 403
    || status === 404
    || status === 405
    || status === 429
    || (status >= 500 && status <= 599)
    || /cannot\s+post|not\s+found|no\s+route|ENOENT/i.test(String(responseText || ''));
}

export const DEFAULT_API_TIMEOUT_MS = 180000;
export const API_TIMEOUT_MIN_MS = 1000;
export const API_TIMEOUT_MAX_MS = 1800000;
const API_TIMEOUT_MARKER = '__bs_biotracker_timeout__';

/** 请求超时（毫秒）：0 或负值表示不限制 */
export function resolveApiTimeoutMs(settings) {
  const raw = Number(settings?.apiTimeoutMs);
  if (!Number.isFinite(raw)) return DEFAULT_API_TIMEOUT_MS;
  if (raw <= 0) return 0;
  return Math.max(API_TIMEOUT_MIN_MS, Math.min(API_TIMEOUT_MAX_MS, Math.floor(raw)));
}

/** 模型列表只是探测请求，不需要等满整个追踪超时 */
function resolveModelListTimeoutMs(settings) {
  const limit = resolveApiTimeoutMs(settings);
  if (limit <= 0) return 60000;
  return Math.min(limit, 60000);
}

export function isApiTimeoutError(error) {
  return error?.[API_TIMEOUT_MARKER] === true;
}

function createApiTimeoutError(timeoutMs) {
  const error = new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应，已自动终止。可在设置中调整「请求超时」。`);
  error[API_TIMEOUT_MARKER] = true;
  return error;
}

const API_DEADLINE_MARKER = '__bs_biotracker_deadline__';

export function isApiDeadlineError(error) {
  return error?.[API_DEADLINE_MARKER] === true;
}

function createApiDeadlineError(deadlineMs) {
  const error = new Error(`分析已超过总时限 ${Math.round(deadlineMs / 1000)} 秒（含重试），已自动终止。`);
  error[API_DEADLINE_MARKER] = true;
  return error;
}

/**
 * 一整轮分析（含全部重试与各自的 JSON 纠错子请求）的总时限。
 *
 * 单次超时管的是「一个请求多久没响应」；总时限管的是「重试叠加后整轮最多跑多久」。
 * 没有它时：单次超时设为 0（不限制）会让某次请求永远挂着；即便设了超时，
 * 4 次尝试 × 2 个子请求也可能累计到十几分钟，手动按钮全程锁死无法终止。
 * 单次超时为 0 时按默认超时估算总时限，保证再怎样也有个终点。
 */
export function resolveOverallDeadlineMs(settings) {
  const perRequest = resolveApiTimeoutMs(settings);
  const base = perRequest > 0 ? perRequest : DEFAULT_API_TIMEOUT_MS;
  return base * (GLOBAL_API_MAX_RETRIES + 1);
}

async function fetchText(url, options = {}) {
  const { timeoutMs, externalSignal, deadlineMs, ...fetchOptions } = options;
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
  const canAbort = typeof AbortController === 'function';
  const controller = canAbort && (limitMs > 0 || externalSignal) ? new AbortController() : null;
  let timer = null;
  let timedOut = false;
  let externalAborted = false;
  let onExternalAbort = null;
  if (controller) {
    fetchOptions.signal = controller.signal;
    if (limitMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller.abort();
        } catch {}
      }, limitMs);
    }
    if (externalSignal) {
      // 总时限触发时，正在飞的这个请求也要一起中止，否则单次超时为 0 时它会永远挂着
      if (externalSignal.aborted) {
        externalAborted = true;
        try {
          controller.abort();
        } catch {}
      } else {
        onExternalAbort = () => {
          externalAborted = true;
          try {
            controller.abort();
          } catch {}
        };
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
  }
  try {
    const response = await fetch(url, fetchOptions);
    const responseText = await response.text().catch((error) => (
      `[failed to read response text: ${String(error?.message || error)}]`
    ));
    return { response, responseText };
  } catch (error) {
    // 总时限优先：它触发时单次超时可能也顺带 abort，但要归因到「整轮超时」
    if (externalAborted) throw createApiDeadlineError(Number(deadlineMs) || 0);
    if (timedOut) throw createApiTimeoutError(limitMs);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onExternalAbort && externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function requestHostProxyModelList(apiBase, settings) {
  return fetchText('/api/backends/chat-completions/status', {
    method: 'POST',
    headers: getHostProxyHeaders(),
    body: JSON.stringify(buildHostProxyConfig(apiBase, settings)),
    cache: 'no-cache',
    timeoutMs: resolveModelListTimeoutMs(settings),
  });
}

async function requestHostProxyChatCompletion(apiBase, settings, requestBody, runContext = {}) {
  const proxyBody = {
    messages: requestBody.messages,
    model: requestBody.model,
    temperature: requestBody.temperature,
    top_p: requestBody.top_p,
    top_k: requestBody.top_k,
    frequency_penalty: requestBody.frequency_penalty,
    presence_penalty: requestBody.presence_penalty,
    max_tokens: requestBody.max_tokens,
    seed: requestBody.seed,
    response_format: requestBody.response_format,
    stream: false,
    ...buildHostProxyConfig(apiBase, settings),
  };
  Object.keys(proxyBody).forEach((key) => {
    if (proxyBody[key] === undefined) delete proxyBody[key];
  });
  return fetchText('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: getHostProxyHeaders(),
    body: JSON.stringify(proxyBody),
    cache: 'no-cache',
    timeoutMs: resolveApiTimeoutMs(settings),
    externalSignal: runContext.signal || null,
    deadlineMs: runContext.deadlineMs || 0,
  });
}

function buildJsonRetryInstruction() {
  return [
    '你上一条回复不是合法 JSON。',
    '现在请重新作答，并且只输出一个可直接 JSON.parse 的 JSON 对象。',
    '不要输出 Markdown，不要输出 ```json，不要输出解释文字，不要输出对象之外的任何字符。',
  ].join('\n');
}

function summarizeModelText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '模型返回为空字符串';
  return normalized.slice(0, 300);
}

const GLOBAL_API_MAX_RETRIES = 3;

/** 可被信号中断的等待：总时限在重试间隔期间触发时，不必把这几秒也白等完 */
function sleepMs(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Number(ms) || 0));
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

function isNonRetriableApiError(error) {
  // 超时已经等满一整轮，立刻重试只会把卡住的时间乘上重试次数
  if (isApiTimeoutError(error)) return true;
  // 总时限触发意味着整轮已经没有时间预算了，不能再开新一轮
  if (isApiDeadlineError(error)) return true;
  const message = String(error?.message || error || '');
  // 配置/鉴权类错误重试无意义
  return /请先填写|尚未配置|API URL 或模型名称|无法解析|仅允许 localhost|401|403|Unauthorized|invalid.?api.?key|Incorrect API key/i.test(message);
}

/**
 * 全局自动重试：首次失败后按 1s/2s/3s 间隔再试，最多 3 次（合计最多 4 轮）。
 * 计数按「总轮次」显示（1/4…4/4），避免出现「3/3 满了却还有一轮在跑」的误解。
 * overallSignal 触发（总时限到）时立刻停手，不再开新一轮。
 */
async function withGlobalApiRetries(task, options = {}) {
  const maxRetries = Math.max(0, Math.min(10, Math.floor(Number(options.maxRetries ?? GLOBAL_API_MAX_RETRIES) || 0)));
  const label = String(options.label || 'API');
  const overallSignal = options.overallSignal || null;
  const totalTries = maxRetries + 1;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (overallSignal?.aborted) {
      lastError = createApiDeadlineError(Number(options.deadlineMs) || 0);
      break;
    }
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (isNonRetriableApiError(error) || attempt >= maxRetries) break;
      const delay = 1000 * (attempt + 1);
      console.warn(`[BS BioTracker] ${label} 第 ${attempt + 1}/${totalTries} 次失败，将在 ${delay}ms 后重试`, error);
      try {
        globalThis.toastr?.warning?.(`${label} 第 ${attempt + 1}/${totalTries} 次失败，${Math.round(delay / 1000)}s 后重试`, '[BS BioTracker]');
      } catch {}
      await sleepMs(delay, overallSignal);
    }
  }
  throw lastError;
}

function sanitizeTransportString(value) {
  const text = String(value ?? '');
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        result += text[index] + text[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue;
    result += text[index];
  }
  return result;
}

function sanitizeTransportValue(value) {
  if (typeof value === 'string') return sanitizeTransportString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTransportValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeTransportValue(item)]),
    );
  }
  return value;
}

function recordEffectiveRequestDebug(source, presetName, sampling, messages, body) {
  globalThis[DEBUG_LAST_EFFECTIVE_REQUEST_KEY] = {
    capturedAt: Date.now(),
    source: String(source || 'unknown'),
    presetName: String(presetName || '').trim(),
    sampling: sampling && typeof sampling === 'object' ? sanitizeTransportValue(sampling) : {},
    body: body && typeof body === 'object' ? sanitizeTransportValue(body) : null,
  };
}

function getSillyTavernContext() {
  return getHostContext();
}

function shouldApplyAsyncPreset(settings) {
  const customPresetName = String(settings?.trackerPresetName || '').trim();
  return !!settings?.useStPresetForAsync || !!customPresetName;
}

function pickFiniteNumber(...values) {
  for (const value of values) {
    const next = Number(value);
    if (Number.isFinite(next)) return next;
  }
  return null;
}

function normalizeChatRole(value, fallback = 'system') {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'system' || role === 'user' || role === 'assistant') return role;
  return fallback;
}

function normalizeMainflowSnapshotMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === 'object' && String(message.content || '').trim())
    .map((message) => ({
      role: normalizeChatRole(message.role, 'user'),
      content: sanitizeTransportString(message.content || ''),
      ...(message.name ? { name: String(message.name) } : {}),
    }));
}

function shouldKeepMainflowSystemMessage(content) {
  const text = sanitizeTransportString(content || '').trim();
  if (!text) return false;
  return !MAINFLOW_SYSTEM_EXCLUDE_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldKeepMainflowChatMessage(content) {
  const text = sanitizeTransportString(content || '').trim();
  if (!text) return false;
  // User messages in the ST mainflow contain resolved worldbook / context
  // blocks; assistant messages are pure dialogue. Keep only the former.
  if (/>\s*<world_info[\s>]/i.test(text)) return true;
  if (/>\s*<game_setting[\s>]/i.test(text)) return true;
  if (/>\s*<chathistory[\s>]/i.test(text)) return true;
  if (/>\s*<world_logic[\s>]/i.test(text)) return true;
  if (text.length > 2000) return true;
  return false;
}

function filterRecentMessagesForMainflowCopy(recentMessages, settings = null) {
  const originalMessages = Array.isArray(recentMessages) ? recentMessages : [];
  const filteredMessages = originalMessages.filter((message) => {
    if (!message || typeof message !== 'object') return false;
    if (message.role === 'user') return true;
    return shouldKeepMainflowChatMessage(message.text || message.content || '');
  });
  const trimmedMessages = filteredMessages.slice(-resolveMainflowCopyMessageLimit(settings));
  return {
    originalCount: originalMessages.length,
    filteredCount: filteredMessages.length,
    retainedCount: trimmedMessages.length,
    strippedCount: Math.max(0, originalMessages.length - filteredMessages.length),
    messages: trimmedMessages,
  };
}

function resolveMainflowCopyMessageLimit(settings) {
  return Math.max(2, Number(settings?.contextSize) || 12);
}

function buildPayloadWithMainflowCopy(payload, settings = null) {
  if (!payload || typeof payload !== 'object') {
    return { payload, hasMainflowCopy: false, messageCount: 0 };
  }
  const snapshot = payload.mainflow_context_snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return { payload, hasMainflowCopy: false, messageCount: 0 };
  }

  const normalizedMessages = normalizeMainflowSnapshotMessages(snapshot.messages);
  const copiedMessages = normalizedMessages.filter((message) => message.role !== 'system');
  const copiedSystemMessages = normalizedMessages.filter((message) => message.role === 'system');
  const filteredMessages = INCLUDE_MAINFLOW_CHAT_MESSAGES
    ? copiedMessages.filter((message) => shouldKeepMainflowChatMessage(message.content))
    : [];
  const filteredSystemMessages = copiedSystemMessages.filter((message) => shouldKeepMainflowSystemMessage(message.content));
  const trimmedMessages = filteredMessages.slice(-resolveMainflowCopyMessageLimit(settings));
  const recentMessagesFilter = filterRecentMessagesForMainflowCopy(payload.recent_messages, settings);
  const { mainflow_context_snapshot: _discarded, ...restPayload } = payload;
  if (trimmedMessages.length === 0 && filteredSystemMessages.length === 0) {
    return {
      payload: recentMessagesFilter.originalCount > 0
        ? {
            ...restPayload,
            recent_messages: recentMessagesFilter.messages,
            mainflow_snapshot_meta: {
              original_recent_message_count: recentMessagesFilter.originalCount,
              filtered_recent_message_count: recentMessagesFilter.filteredCount,
              retained_recent_message_count: recentMessagesFilter.retainedCount,
              stripped_recent_messages: recentMessagesFilter.strippedCount,
            },
          }
        : restPayload,
      hasMainflowCopy: false,
      messageCount: 0,
    };
  }

  return {
    hasMainflowCopy: true,
    messageCount: trimmedMessages.length + filteredSystemMessages.length,
    payload: {
      ...restPayload,
      recent_messages: recentMessagesFilter.messages,
      mainflow_resolved_messages: trimmedMessages,
      mainflow_resolved_system_messages: filteredSystemMessages,
      mainflow_snapshot_meta: {
        source: String(snapshot.source || 'unknown'),
        captured_at: Number(snapshot.capturedAt || 0) || null,
        model: String(snapshot.model || '').trim() || null,
        original_message_count: normalizedMessages.length,
        copied_message_count: copiedMessages.length,
        filtered_message_count: filteredMessages.length,
        retained_message_count: trimmedMessages.length,
        copied_system_message_count: copiedSystemMessages.length,
        retained_system_message_count: filteredSystemMessages.length,
        stripped_messages: Math.max(0, copiedMessages.length - filteredMessages.length),
        stripped_system_messages: Math.max(0, copiedSystemMessages.length - filteredSystemMessages.length),
        original_recent_message_count: recentMessagesFilter.originalCount,
        filtered_recent_message_count: recentMessagesFilter.filteredCount,
        retained_recent_message_count: recentMessagesFilter.retainedCount,
        stripped_recent_messages: recentMessagesFilter.strippedCount,
      },
    },
  };
}

function resolveWithStMacros(text, stCtx) {
  const raw = String(text ?? '');
  if (!raw) return '';
  try {
    if (typeof stCtx?.substituteParamsExtended === 'function') {
      const resolved = stCtx.substituteParamsExtended(raw);
      if (typeof resolved === 'string') return resolved;
    }
  } catch {}
  try {
    if (typeof stCtx?.substituteParams === 'function') {
      const resolved = stCtx.substituteParams(raw);
      if (typeof resolved === 'string') return resolved;
    }
  } catch {}
  return raw;
}

function resolvePayloadValueWithStMacros(value, stCtx) {
  if (typeof value === 'string') return resolveWithStMacros(value, stCtx);
  if (Array.isArray(value)) return value.map((item) => resolvePayloadValueWithStMacros(item, stCtx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolvePayloadValueWithStMacros(item, stCtx)]),
    );
  }
  return value;
}

async function buildResolvedWorldInfo(stCtx) {
  const chat = getHostChat(stCtx);
  const maxContext = Number(stCtx?.maxContext || getHostChatCompletionSettings(stCtx)?.openai_max_context || 0);
  try {
    const result = await getHostWorldInfoPrompt(stCtx, chat, maxContext > 0 ? maxContext : undefined, true);
    if (!result) return null;
    const before = sanitizeTransportString(result?.worldInfoBefore || '').trim();
    const after = sanitizeTransportString(result?.worldInfoAfter || '').trim();
    const combined = [before, after].filter(Boolean).join('\n').trim();
    if (!before && !after && !combined) return null;
    return { before, after, combined };
  } catch (error) {
    console.warn('[BS BioTracker] failed to resolve world info prompt', error);
    return null;
  }
}

async function buildResolvedAsyncPayload(payload, stCtx, settings = null) {
  const resolvedWithMacros = resolvePayloadValueWithStMacros(payload, stCtx);
  if (resolvedWithMacros?.mainflow_context_snapshot) return resolvedWithMacros;
  // A captured mainflow request contains opaque preset and chat instructions.
  // It is only a runtime signal and must never be forwarded to async analysis.
  const { mainflow_context_snapshot: _discarded, ...resolvedPayload } = resolvedWithMacros;
  if (!settings?.trackerWorldbookMode) return resolvedPayload;
  if (settings?.trackerWorldbookMode !== 'mainflow') return resolvedPayload;
  const resolvedWorldInfo = await buildResolvedWorldInfo(stCtx);
  if (!resolvedWorldInfo) return resolvedPayload;
  return {
    ...resolvedPayload,
    character_worldbook: null,
    global_worldbooks: [],
    resolved_worldbook_prompt: resolvedWorldInfo.combined,
    resolved_worldbook_before: resolvedWorldInfo.before,
    resolved_worldbook_after: resolvedWorldInfo.after,
  };
}

function resolvePresetName(settings, stCtx = null) {
  const explicitName = String(settings?.trackerPresetName || '').trim();
  if (explicitName) return explicitName;
  if (!settings?.useStPresetForAsync) return '';
  const context = stCtx || getSillyTavernContext();
  try {
    const pm = getHostPresetManager(context, 'openai');
    if (pm && typeof pm.getSelectedPresetName === 'function') {
      const currentName = String(pm.getSelectedPresetName() || '').trim();
      if (currentName) return currentName;
    }
  } catch {}
  const runtimeName = String(getHostChatCompletionSettings(context)?.preset_settings_openai || '').trim();
  return runtimeName;
}

async function getResolvedPreset(settings) {
  if (!shouldApplyAsyncPreset(settings)) return null;
  try {
    const stCtx = getSillyTavernContext();
    const presetName = resolvePresetName(settings, stCtx);
    if (!presetName) return null;

    let preset = null;
    const pm = getHostPresetManager(stCtx, 'openai');
    if (pm && typeof pm.getCompletionPresetByName === 'function') {
      preset = pm.getCompletionPresetByName(presetName) || null;
    }
    if (!preset) preset = await getHostPreset(presetName, stCtx);
    if (!preset || typeof preset !== 'object') return null;
    return { presetName, preset };
  } catch (error) {
    console.warn('[BS BioTracker] failed to resolve ST preset', error);
    return null;
  }
}

function buildPresetSamplingBodyFromPreset(preset) {
  const other = preset?.other && typeof preset.other === 'object' ? preset.other : {};
  const utilityPrompts = preset?.utilityPrompts && typeof preset.utilityPrompts === 'object' ? preset.utilityPrompts : {};
  const settings = preset?.settings && typeof preset.settings === 'object' ? preset.settings : {};
  const body = {};
  const temperature = pickFiniteNumber(settings.temperature, other.temp_openai, other.temp, other.temperature);
  const topP = pickFiniteNumber(settings.top_p, other.top_p_openai, other.top_p);
  const topK = pickFiniteNumber(settings.top_k, other.top_k);
  const frequencyPenalty = pickFiniteNumber(settings.frequency_penalty, other.freq_pen_openai, other.frequency_penalty, other.freq_pen);
  const presencePenalty = pickFiniteNumber(settings.presence_penalty, other.pres_pen_openai, other.presence_penalty, other.pres_pen);
  const maxTokens = pickFiniteNumber(settings.max_completion_tokens, other.openai_max_tokens, other.max_tokens);
  const seed = pickFiniteNumber(utilityPrompts.seed, other.seed);
  if (temperature !== null) body.temperature = temperature;
  if (topP !== null) body.top_p = topP;
  if (topK !== null) body.top_k = Math.max(0, Math.floor(topK));
  if (frequencyPenalty !== null) body.frequency_penalty = frequencyPenalty;
  if (presencePenalty !== null) body.presence_penalty = presencePenalty;
  if (maxTokens !== null && maxTokens > 0) body.max_tokens = Math.max(1, Math.floor(maxTokens));
  if (seed !== null && seed >= 0) body.seed = Math.floor(seed);
  return body;
}

async function requestChatCompletion(apiBase, settings, body, runContext = {}) {
  const logApiDebug = (phase, details = {}) => {
    try {
      const label = `[BS BioTracker][API debug] ${phase}`;
      if (typeof console.groupCollapsed === 'function') console.groupCollapsed(label);
      else console.log(label);
      Object.entries(details).forEach(([key, value]) => console.log(key, value));
      if (typeof console.groupEnd === 'function') console.groupEnd();
    } catch {}
  };

  const postBody = async (requestBody, attempt = 'primary') => {
    const previousAsyncFlag = globalThis.__bs_biotracker_async_request__;
    globalThis.__bs_biotracker_async_request__ = true;
    const url = `${apiBase}/chat/completions`;
    const useHostProxy = shouldUseHostProxy(url);
    if (!useHostProxy) assertSafeDirectApiBase(apiBase);
    let transport = useHostProxy ? 'host-proxy' : 'direct';
    let requestText = '';
    try {
      requestText = JSON.stringify(requestBody);
      logApiDebug(`request:${attempt}`, {
        transport,
        url: useHostProxy ? '/api/backends/chat-completions/generate' : url,
        apiBase,
        requestBody,
        requestText,
        requestTextLength: requestText.length,
      });
      let response;
      let responseText;
      if (useHostProxy) {
        let proxyError = null;
        try {
          ({ response, responseText } = await requestHostProxyChatCompletion(apiBase, settings, requestBody, runContext));
        } catch (error) {
          proxyError = error;
          logApiDebug(`proxy_error:${attempt}`, { proxyError: error });
          // 代理已经等满超时（或整轮时限已到），直连只会再卡一次同样的时长
          if (isApiTimeoutError(error) || isApiDeadlineError(error)) throw error;
        }
        if (proxyError || (!response.ok && shouldFallbackFromHostProxy(responseText, response.status))) {
          transport = proxyError ? 'direct-after-proxy-error' : `direct-after-proxy-${response.status}`;
          // 回退直连同样会把 Key 放进 Authorization 头：远程 http 必须拒绝
          assertSafeDirectApiBase(apiBase);
          ({ response, responseText } = await fetchText(url, {
            method: 'POST',
            headers: getAuthHeaders(settings),
            body: requestText,
            timeoutMs: resolveApiTimeoutMs(settings),
            externalSignal: runContext.signal || null,
            deadlineMs: runContext.deadlineMs || 0,
          }));
        }
      } else {
        ({ response, responseText } = await fetchText(url, {
          method: 'POST',
          headers: getAuthHeaders(settings),
          body: requestText,
          timeoutMs: resolveApiTimeoutMs(settings),
          externalSignal: runContext.signal || null,
          deadlineMs: runContext.deadlineMs || 0,
        }));
      }
      globalThis[DEBUG_LAST_API_RESPONSE_KEY] = {
        capturedAt: Date.now(),
        attempt,
        transport,
        url: transport === 'host-proxy' ? '/api/backends/chat-completions/generate' : url,
        status: response.status,
        ok: response.ok,
        responseText,
        requestText,
      };
      logApiDebug(`response:${attempt}`, {
        transport,
        url: transport === 'host-proxy' ? '/api/backends/chat-completions/generate' : url,
        status: response.status,
        ok: response.ok,
        responseText,
        requestText,
      });
      return { response, responseText, requestText };
    } catch (error) {
      logApiDebug(`error:${attempt}`, {
        transport,
        url,
        requestBody,
        requestText,
        error,
      });
      if (isApiTimeoutError(error) || isApiDeadlineError(error)) throw error;
      throw new Error(`无法连接到 API。请检查 Base URL、API Key、服务是否启动；浏览器环境会优先通过酒馆后端代理。原始错误: ${String(error?.message || error)}`);
    } finally {
      globalThis.__bs_biotracker_async_request__ = previousAsyncFlag;
    }
  };

  let result = await postBody(body, 'primary');
  let response = result.response;
  let responseText = result.responseText;
  let errorText = response.ok ? '' : responseText;

  if (!response.ok && response.status === 400 && body.response_format) {
    const fallbackBody = {
      model: body.model,
      temperature: body.temperature,
      top_p: body.top_p,
      top_k: body.top_k,
      frequency_penalty: body.frequency_penalty,
      presence_penalty: body.presence_penalty,
      max_tokens: body.max_tokens,
      seed: body.seed,
      messages: body.messages,
    };
    result = await postBody(fallbackBody, 'without_response_format');
    response = result.response;
    responseText = result.responseText;
    errorText = response.ok ? '' : responseText;
  }

  const invalidArgument = response.status === 400 && /invalid argument|badRequest/i.test(errorText);
  if (!response.ok && invalidArgument) {
    const minimalBody = {
      model: body.model,
      messages: body.messages,
    };
    result = await postBody(minimalBody, 'minimal');
    response = result.response;
    responseText = result.responseText;
    errorText = response.ok ? '' : responseText;
  }

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${errorText.slice(0, 300)}`);
  }
  try {
    return JSON.parse(responseText);
  } catch (error) {
    logApiDebug('parse_error', {
      status: response.status,
      responseText,
      error,
    });
    throw error;
  }
}

function hasPresetToggleOverrides(settings) {
  if (!shouldApplyAsyncPreset(settings)) return false;
  const presetName = resolvePresetName(settings);
  if (!presetName) return false;
  const presetOverrides = settings?.trackerPromptToggleOverrides?.[presetName];
  return !!presetOverrides && Object.keys(presetOverrides).length > 0;
}

export async function fetchModelList(settings) {
  const apiBase = getApiBase(settings);
  if (!apiBase) throw new Error('请先填写 API Base URL');
  let response;
  let responseText = '';
  const url = `${apiBase}/models`;
  const useHostProxy = shouldUseHostProxy(url);
  if (!useHostProxy) assertSafeDirectApiBase(apiBase);
  let transport = useHostProxy ? 'host-proxy' : 'direct';
  try {
    if (useHostProxy) {
      let proxyError = null;
      try {
        ({ response, responseText } = await requestHostProxyModelList(apiBase, settings));
      } catch (error) {
        proxyError = error;
        console.warn('[BS BioTracker] host proxy model list failed, trying direct', error);
      }
      if (proxyError || (!response.ok && shouldFallbackFromHostProxy(responseText, response.status))) {
        transport = proxyError ? 'direct-after-proxy-error' : `direct-after-proxy-${response.status}`;
        // 回退直连同样会带 Authorization 头：远程 http 必须拒绝
        assertSafeDirectApiBase(apiBase);
        ({ response, responseText } = await fetchText(url, { method: 'GET', headers: getAuthHeaders(settings), timeoutMs: resolveModelListTimeoutMs(settings) }));
      }
    } else {
      ({ response, responseText } = await fetchText(url, { method: 'GET', headers: getAuthHeaders(settings), timeoutMs: resolveModelListTimeoutMs(settings) }));
    }
  } catch (error) {
    throw new Error(`模型列表连接失败（${transport}）。请检查 Base URL / API Key；也可手动填写模型名称后直接使用追踪/注册。原始错误: ${String(error?.message || error)}`);
  }
  if (!response.ok) {
    throw new Error(`模型列表请求失败 ${response.status}（${transport}）: ${responseText.slice(0, 240)}。如果此 API 不支持 /models，可手动填写模型名称。`);
  }
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`模型列表响应不是 JSON（${transport}）: ${responseText.slice(0, 180)}`);
  }
  if (data && typeof data === 'object' && data.data == null && data.models == null && data.response) {
    try {
      const nested = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;
      if (nested && typeof nested === 'object') data = nested;
    } catch {}
  }
  const modelItems = Array.isArray(data?.data)
    ? data.data
    : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
  const models = modelItems
    .map((item) => (typeof item === 'string'
      ? item.trim()
      : String(item?.id || item?.name || item?.model || '').trim()))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  if (models.length === 0) throw new Error('API 有响应，但没有返回可用模型；可手动填写模型名称。');
  return models;
}

function isPromptEnabled(prompt, presetOverrides = {}) {
  if (!prompt || typeof prompt !== 'object') return false;
  if (Object.hasOwn(presetOverrides, prompt.identifier)) return !!presetOverrides[prompt.identifier];
  return prompt.enabled !== false;
}

function buildPresetMessagesFromPrompts(prompts, presetOverrides, baseSystemPrompt, payloadText, stCtx = null) {
  const orderedMessages = [];
  const inChatMessages = [];

  for (const prompt of Array.isArray(prompts) ? prompts : []) {
    if (!isPromptEnabled(prompt, presetOverrides)) continue;
    const content = sanitizeTransportString(resolveWithStMacros(prompt?.content || '', stCtx)).trim();
    if (!content || prompt?.marker) continue;
    const isInChat = Number(prompt?.injection_position) === 1;
    const promptRole = normalizeChatRole(prompt?.role, prompt?.system_prompt ? 'system' : 'system');
    const target = isInChat ? inChatMessages : orderedMessages;
    target.push({
      role: promptRole,
      content,
      _depth: Number.isFinite(Number(prompt?.injection_depth)) ? Number(prompt.injection_depth) : 0,
      _order: Number.isFinite(Number(prompt?.injection_order)) ? Number(prompt.injection_order) : 0,
    });
  }

  inChatMessages.sort((a, b) => (a._depth - b._depth) || (a._order - b._order));

  const merged = [{ role: 'system', content: baseSystemPrompt }];
  orderedMessages.forEach((message) => merged.push({ role: message.role, content: message.content }));
  inChatMessages.forEach((message) => merged.push({ role: message.role, content: message.content }));
  merged.push({ role: 'user', content: payloadText });
  return merged;
}

async function buildPresetEnvelope(settings, baseSystemPrompt, payloadText) {
  try {
    const resolved = await getResolvedPreset(settings);
    if (!resolved) return null;
    const stCtx = getSillyTavernContext();
    const { presetName, preset } = resolved;
    const overrides = settings?.trackerPromptToggleOverrides || {};
    const presetOverrides = overrides[presetName] || {};
    const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
    const messages = buildPresetMessagesFromPrompts(prompts, presetOverrides, baseSystemPrompt, payloadText, stCtx);
    const sampling = buildPresetSamplingBodyFromPreset(preset);
    return { presetName, messages, sampling };
  } catch (error) {
    console.warn('[BS BioTracker] failed to build preset envelope', error);
    return null;
  }
}

export async function callOpenAICompatible(settings, payload, systemPrompt = DEFAULT_SYSTEM_PROMPT) {
  const apiBase = getApiBase(settings);
  const model = String(settings.model || '').trim();
  const stCtx = getSillyTavernContext();
  const resolvedPayload = await buildResolvedAsyncPayload(payload, stCtx, settings);
  const mainflowCopy = buildPayloadWithMainflowCopy(resolvedPayload, settings);
  const safePayload = sanitizeTransportValue(mainflowCopy.payload);
  const safeSystemPrompt = sanitizeTransportString(resolveWithStMacros(systemPrompt || DEFAULT_SYSTEM_PROMPT, stCtx));
  const baseMessages = [
    { role: 'system', content: safeSystemPrompt },
    { role: 'user', content: JSON.stringify(safePayload) },
  ];
  if (!apiBase || !model) throw new Error('API URL 或模型名称尚未配置');

  const payloadText = JSON.stringify(safePayload);
  // Never stage an internal payload in the active chat to resolve presets: hosts
  // and extensions may persist that synthetic message as visible chat content.
  const presetEnvelope = shouldApplyAsyncPreset(settings)
    ? await buildPresetEnvelope(settings, safeSystemPrompt, payloadText)
    : null;
  let effectiveMessages = presetEnvelope?.messages?.length ? presetEnvelope.messages : baseMessages;
  const stPresetSampling = presetEnvelope?.sampling || {};
  const effectivePresetName = presetEnvelope?.presetName || '';
  // 格式化输出(v4兼容)：response_format.type = json_object + 提示词内嵌输出结构指令。
  // 模型为 DeepSeek 系时自动启用（用户需求），其余模型遵循设置开关。
  // 注意：v4 指令只在 tracker 流程注入——registry/日记/备装/技能/繁育推演各自声明了
  // 不同的 JSON 结构（profile/wardrobe/diary 等），注入 tool_calls 指令会压过它们的 schema。
  const useFormattedOutputV4 = resolveFormattedOutputV4(settings, model);
  const isTrackerFlow = !safePayload?.target_character;
  if (useFormattedOutputV4 && isTrackerFlow && effectiveMessages[0]?.role === 'system') {
    effectiveMessages = [
      { role: 'system', content: `${effectiveMessages[0].content}\n\n${buildFormattedOutputV4Instruction()}` },
      ...effectiveMessages.slice(1),
    ];
  }
  const body = {
    model,
    temperature: 0.2,
    ...stPresetSampling,
    messages: effectiveMessages,
    ...(useFormattedOutputV4 ? { response_format: { type: 'json_object' } } : {}),
  };
  recordEffectiveRequestDebug(
    `${safePayload?.target_character ? 'registry' : 'tracker'}${mainflowCopy.hasMainflowCopy ? '-mainflow-copy' : (safePayload?.resolved_worldbook_prompt ? '-mainflow-worldinfo' : '')}${useFormattedOutputV4 ? '' : '-no-response-format'}`,
    effectivePresetName,
    stPresetSampling,
    effectiveMessages,
    body,
  );
  const callLabel = safePayload?.target_character ? '注册请求' : '追踪请求';

  // 整轮总时限：一个信号统管全部重试与子请求，到点后中止在飞的 fetch 并停止重试，
  // 让手动按钮无论后端多离谱都能在有限时间内解禁。单次超时为 0 时它是唯一的终点保障。
  const deadlineMs = resolveOverallDeadlineMs(settings);
  const overallController = typeof AbortController === 'function' ? new AbortController() : null;
  let overallTimer = null;
  if (overallController && deadlineMs > 0) {
    overallTimer = setTimeout(() => {
      try {
        overallController.abort();
      } catch {}
    }, deadlineMs);
  }
  const runContext = { signal: overallController?.signal || null, deadlineMs };

  try {
    return await withGlobalApiRetries(async (globalAttempt) => {
      const data = await requestChatCompletion(apiBase, settings, body, runContext);
      const content = data?.choices?.[0]?.message?.content || '';
      let parsed = extractJson(content);
      if (parsed && typeof parsed === 'object') return parsed;

      // 同一轮全局尝试内：先做一次「请只输出 JSON」纠错请求
      const retryBody = {
        model,
        temperature: 0.1,
        ...stPresetSampling,
        messages: [
          ...effectiveMessages,
          { role: 'assistant', content: String(content || '') },
          { role: 'user', content: buildJsonRetryInstruction() },
        ],
        ...(useFormattedOutputV4 ? { response_format: { type: 'json_object' } } : {}),
      };
      const retryData = await requestChatCompletion(apiBase, settings, retryBody, runContext);
      const retryContent = retryData?.choices?.[0]?.message?.content || '';
      parsed = extractJson(retryContent);
      if (parsed && typeof parsed === 'object') return parsed;

      throw new Error(
        `模型没有返回可解析的 JSON（全局尝试 ${globalAttempt + 1}/${GLOBAL_API_MAX_RETRIES + 1}）。原始回覆：${summarizeModelText(retryContent || content)}`,
      );
    }, { label: callLabel, overallSignal: overallController?.signal || null, deadlineMs });
  } finally {
    if (overallTimer) clearTimeout(overallTimer);
  }
}
