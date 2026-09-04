import { API_FORMATS, DEFAULT_SYSTEM_PROMPT, getApiUrlForFormat, normalizeApiFormat } from './state.js';
import {
  getHostChat,
  getHostChatCompletionSettings,
  getHostContext,
  getHostKind,
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
 * DeepSeek 系模型对 response_format(json_object) 支持好，但工具调用兼容层不稳定，
 * 掉格式概率明显高于其他模型，需要额外注入输出结构指令。
 * 只匹配 deepseek——原始实现还匹配子串 ds，会误伤名字里恰好含 ds 的其他模型。
 */
export function isDeepSeekFamilyModel(model) {
  return String(model || '').trim().toLowerCase().includes('deepseek');
}

/** 是否附加 response_format.json_object：完全听使用者的开关（渠道不支持时要能关掉）。 */
export function shouldUseResponseFormat(settings, _model) {
  return settings?.formattedOutputV4 !== false;
}

/** 是否注入 v4 结构指令：开关开着且模型是 DeepSeek 系才注入。 */
export function shouldInjectV4Instruction(settings, model) {
  return shouldUseResponseFormat(settings, model) && isDeepSeekFamilyModel(model);
}

/** v4 兼容模式的输出结构指令，与 response_format 双重约束降低掉格式概率。 */
function buildFormattedOutputV4Instruction() {
  return [
    '【输出格式（强制）】',
    '你处于格式化输出模式：不要输出 Markdown、不要输出代码块、不要输出解释文字或任何对象之外的字符。',
    '只输出一个可直接 JSON.parse 的 JSON 对象，结构为：',
    '{"tool_calls": [{"name": "工具名", "arguments": {"参数名": "值"}}], "character_checks": [{"female": "角色名", "status": "no_change|updated|present|offscreen"}]}',
    'arguments 必须是一个对象；工具名与参数必须来自 available_tools 与变量语义说明。',
    'character_checks 必须对每名已追踪角色恰好输出一笔（即使无变化 status 也写 no_change）；无工具操作时输出 {"tool_calls": []}，但 character_checks 仍须完整。',
  ].join('\n');
}

export function getApiBase(settings) {
  let apiBase = String(settings.apiUrl || '').trim().replace(/\/+$/, '');
  apiBase = apiBase.replace(/\/(chat\/completions|models|responses|messages|interactions)$/i, '');
  return apiBase.replace(/\/+$/, '');
}

export function getAuthHeaders(settings) {
  const headers = { 'Content-Type': 'application/json' };
  const key = settings.apiKey ? String(settings.apiKey) : '';
  const format = normalizeApiFormat(settings?.apiFormat);
  if (format === API_FORMATS.CLAUDE_MESSAGES) {
    if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers['x-api-key'] = key;
    }
  } else if (format === API_FORMATS.GEMINI_INTERACTIONS) {
    // Google AI 认证走 x-goog-api-key（TauriTavern apply_gemini_auth 同规则）
    if (key) headers['x-goog-api-key'] = key;
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

/**
 * 宿主代理对非 OpenAI 兼容格式的支持：
 * TauriTavern 后端读取 payload.custom_api_format，按 openai_responses.rs / claude
 * builder 在服务端翻译 messages → /responses | /messages 上游请求；
 * 原版 SillyTavern 后端不理解 custom_api_format，非 compat 格式改走 /proxy/ 透传
 * 或浏览器直连（见 postBody 的传输选择）。
 */
function hostSupportsFormatAwareProxy() {
  try {
    return getHostKind() === 'tauritavern';
  } catch {
    return false;
  }
}

/**
 * 把最近一次真实请求打到 UI（连接状态栏），TT 桌面端没有控制台也能看到端点与状态码。
 */
function traceRequestToUi(method, url, status, transport = '') {
  if (typeof document === 'undefined') return;
  try {
    const node = document.getElementById('bs-bt-connect-status');
    if (!node) return;
    const suffix = status ? ` → HTTP ${status}` : '';
    const via = transport ? `（${transport}）` : '';
    node.textContent = `最近请求：${method} ${url}${suffix}${via}`;
  } catch {}
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

/**
 * 上游识别用 User-Agent（仅注入后端代理路径，见 buildHostProxyConfig）：
 * 不带版本避免与 manifest.json 漂移，仓库 URL 供提供商核对来源。
 */
const PLUGIN_USER_AGENT = 'BS-BioTracker (+https://github.com/Liuuuu54/st_bs_biotracker)';

function buildHostProxyConfig(apiBase, settings) {
  const apiKey = String(settings?.apiKey || '');
  const format = normalizeApiFormat(settings?.apiFormat);
  const headerLines = [];
  if (apiKey) {
    if (format === API_FORMATS.GEMINI_INTERACTIONS) {
      // Google AI 认 x-goog-api-key；Authorization: Bearer 会被当成 OAuth 而 401
      headerLines.push(`x-goog-api-key: ${apiKey}`);
    } else if (format === API_FORMATS.CLAUDE_MESSAGES) {
      headerLines.push(
        `Authorization: Bearer ${apiKey}`,
        `x-api-key: ${apiKey}`,
        'anthropic-version: 2023-06-01',
      );
    } else {
      headerLines.push(`Authorization: Bearer ${apiKey}`);
    }
  }
  // 原版 ST 后端用 node-fetch 发上游请求，默认 UA 是通用的 "node-fetch"；
  // 部分提供商（如 OpenCode Go）拿 UA 做反欺诈信号，泛用 bot UA 可能被拦。
  // custom_include_headers 会在 ST 后端合并进上游请求头（mergeObjectWithYaml），
  // 足以覆盖默认值。TauriTavern 后端自带产品 UA（TauriTavern/<ver>）且
  // additional headers 最后应用，注入这里会把产品 UA 顶掉，故 TT 跳过。
  if (!hostSupportsFormatAwareProxy()) {
    headerLines.push(`User-Agent: ${PLUGIN_USER_AGENT}`);
  }
  return {
    chat_completion_source: 'custom',
    custom_url: apiBase,
    reverse_proxy: apiBase,
    proxy_password: apiKey,
    custom_include_headers: headerLines.join('\n'),
  };
}

/**
 * 直连会把 API Key 放进 Authorization 头，代理路径同样把 key 交给 ST 后端转发，
 * 所以两条路都要校验：远程 http 属于明文传输，一律拒绝。
 * 内网地址（localhost / 私网段 / 链路本地）放行——在另一台机器跑 ollama、
 * koboldcpp 是常规用法，封掉会直接让这些人不能用。
 * 相对路径/无 scheme 视为同源，交给浏览器自行解析。
 */
export function assertSafeDirectApiBase(apiBase) {
  const raw = String(apiBase || '').trim();
  if (!raw) return;
  if (!/^https?:/i.test(raw)) {
    // 显式的非 http(s) scheme 一律拒绝：代理路径会把 URL 交给 ST 后端服务端 fetch，
    // file:// / gopher:// 之类会让它变成 SSRF 放大器
    const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
    if (schemeMatch) {
      const rest = raw.slice(schemeMatch[0].length);
      // 'localhost:8000' / 'api.example.com:8080' 是无 scheme 的 host:port，放行
      const isPortOnly = /^\d+$/.test(rest);
      if (!isPortOnly) {
        throw new Error('API Base URL 仅支持 http:// 或 https://，其他协议一律拒绝。');
      }
    }
    return;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API Base URL 无法解析。');
  }
  if (url.protocol !== 'http:') return;
  // WHATWG URL 对 IPv6 返回带方括号的 hostname
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/^::ffff:/, '').toLowerCase();
  if (!isLocalNetworkHost(host)) {
    throw new Error('API Base URL 使用 http:// 时仅允许本机或内网地址；公网地址请改用 https://，避免 API Key 明文传输。');
  }
}

/** 本机/内网主机判定：这些地址上的 http 明文不出本地网络，放行。 */
function isLocalNetworkHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::') return true;
  // IPv6 链路本地 fe80::/10 与唯一本地 fc00::/7
  if (host.includes(':')) {
    const first = host.split(':')[0];
    return /^fe[89ab]/.test(first) || /^f[cd]/.test(first);
  }
  const parts = host.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // 链路本地
  return false;
}

/**
 * 错误文本脱敏：API 响应体可能回显 Authorization/key/token，
 * 拼进错误消息（toastr/UI 可见）前剥离。
 */
function sanitizeErrorText(text) {
  return String(text || '')
    .replace(/("?(?:authorization|api[-_]?key|proxy[-_]?password|token)"?\s*[:=]\s*")[^"]{4,}(")/gi, '$1***$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1***')
    .slice(0, 300);
}

const HOST_PROXY_DISABLED_KEY = '__bs_biotracker_host_proxy_disabled__';

/**
 * 宿主代理鉴权失败（401/403）通常是 CSRF token 对不上，重整页面前不会自己好。
 * 每次请求都先撞一次代理只会在 ST 后端刷出一整串 ForbiddenError，而实际流量
 * 早就靠直连成功了——使用者看不到异常，伺服器 log 却被灌爆。
 * 撞到一次就整个 session 停用代理，直接走直连。
 */
function disableHostProxyForSession(status, responseText) {
  if (globalThis[HOST_PROXY_DISABLED_KEY]) return;
  globalThis[HOST_PROXY_DISABLED_KEY] = true;
  const isCsrf = /csrf/i.test(String(responseText || ''));
  console.warn(
    `[BS BioTracker] 宿主代理返回 ${status}${isCsrf ? '（CSRF token 无效）' : ''}，本次工作阶段改走直连。`
    + (isCsrf ? ' 硬重整页面（Ctrl+Shift+R）可恢复代理；在此之前不会再打代理，避免 ST 后端持续记录 ForbiddenError。' : ''),
  );
}

function shouldUseHostProxy(url) {
  if (globalThis[HOST_PROXY_DISABLED_KEY]) return false;
  return isBrowserRuntime() && isCrossOriginUrl(url);
}

function shouldFallbackFromHostProxy(responseText, status) {
  // 不含 429：上游限流时再直连一次等于对已限流的端点翻倍施压，
  // 而浏览器跨域直连多半又会 CORS 失败，白白多打一次
  return status === 401
    || status === 403
    || status === 404
    || status === 405
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

async function requestHostProxyChatCompletion(apiBase, settings, requestBody, runContext = {}, apiFormat = API_FORMATS.OPENAI_COMPAT) {
  const formatAware = apiFormat && apiFormat !== API_FORMATS.OPENAI_COMPAT;
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
    // 非 compat 格式交给宿主后端按 custom_api_format 翻译；response_format 不在其中
    ...(formatAware ? { custom_api_format: apiFormat } : { response_format: requestBody.response_format }),
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
  return /请先填写|尚未配置|API URL 或模型名称|无法解析|仅允许本机或内网|其他协议一律拒绝|401|403|Unauthorized|invalid.?api.?key|Incorrect API key/i.test(message);
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

function buildResponsesInput(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => {
    const role = String(m?.role || 'user').toLowerCase();
    const content = String(m?.content ?? '');
    if (role === 'system') return { role: 'developer', content };
    if (role === 'developer') return { role: 'developer', content };
    if (role === 'assistant') return { role: 'assistant', content };
    return { role: 'user', content };
  });
}

function extractResponsesText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' && item.role === 'assistant') {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const part of content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
        if (typeof part?.text === 'string') return part.text;
      }
    }
  }
  if (typeof data?.choices?.[0]?.message?.content === 'string') return data.choices[0].message.content;
  return '';
}

function buildClaudeMessagesBody(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let system = '';
  const claudeMessages = [];
  for (const m of messages) {
    const role = String(m?.role || '').toLowerCase();
    const content = String(m?.content ?? '');
    if (role === 'system') {
      system = system ? `${system}\n\n${content}` : content;
    } else if (role === 'assistant') {
      claudeMessages.push({ role: 'assistant', content });
    } else {
      claudeMessages.push({ role: 'user', content });
    }
  }
  const out = {
    model: body.model,
    max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
    messages: claudeMessages,
  };
  if (system) out.system = system;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (body.top_k !== undefined) out.top_k = body.top_k;
  return out;
}

function extractClaudeText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data?.content === 'string') return data.content;
  const content = Array.isArray(data.content) ? data.content : [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') return part.text;
    if (typeof part?.text === 'string') return part.text;
  }
  if (typeof data?.choices?.[0]?.message?.content === 'string') return data.choices[0].message.content;
  return '';
}

function normalizeResponsesData(data) {
  const text = extractResponsesText(data);
  return { choices: [{ message: { content: text } }] };
}

function normalizeClaudeData(data) {
  const text = extractClaudeText(data);
  return { choices: [{ message: { content: text } }] };
}

/**
 * Gemini Interactions API 请求体（参照 TauriTavern gemini_interactions.rs）：
 * messages → steps（user_input / model_output + text block），system 合并为
 * system_instruction，采样参数进 generation_config。插件只发纯文本，不涉及
 * tool / 媒体 block；response_format 仅在有 json_schema 时才会出现，这里省略。
 */
function buildGeminiInteractionsBody(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts = [];
  const steps = [];
  for (const m of messages) {
    const role = String(m?.role || '').toLowerCase();
    const text = String(m?.content ?? '');
    if (role === 'system' || role === 'developer') {
      if (text.trim()) systemParts.push(text.trim());
    } else if (role === 'assistant') {
      if (text.trim()) steps.push({ type: 'model_output', content: [{ type: 'text', text }] });
    } else {
      steps.push({ type: 'user_input', content: [{ type: 'text', text }] });
    }
  }
  const request = {
    model: body.model,
    input: steps,
    stream: false,
    store: false,
  };
  if (systemParts.length) request.system_instruction = systemParts.join('\n\n');
  const generationConfig = {};
  if (Number.isFinite(body.temperature)) generationConfig.temperature = body.temperature;
  if (Number.isFinite(body.top_p)) generationConfig.top_p = body.top_p;
  if (Number.isFinite(body.top_k) && body.top_k > 0) generationConfig.top_k = Math.floor(body.top_k);
  const maxTokens = Number.isFinite(body.max_tokens) ? body.max_tokens : body.max_completion_tokens;
  if (Number.isFinite(maxTokens) && maxTokens > 0) generationConfig.max_output_tokens = Math.floor(maxTokens);
  if (Object.keys(generationConfig).length) request.generation_config = generationConfig;
  return request;
}

/**
 * 非流式 Interactions 回覆。
 * 直连 / ST /proxy 拿到原生 {status, steps}；TT 格式感知代理会先正规化成
 * OpenAI {choices:[{message:{content}}]}（见 normalize_gemini_interactions_response），
 * 那种回包没有 steps，必须走 choices 回退，否则内容会被读成空字符串。
 */
function extractGeminiInteractionsText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data?.choices?.[0]?.message?.content === 'string') {
    return data.choices[0].message.content;
  }
  const status = String(data.status || '');
  if (status === 'failed') {
    throw new Error(`Gemini Interactions 回传失败：${String(data?.error?.message || 'unknown error')}`);
  }
  if (status && status !== 'completed' && status !== 'requires_action' && status !== 'incomplete') {
    throw new Error(`Gemini Interactions 未正常完成（status: ${status}）`);
  }
  const steps = Array.isArray(data.steps) ? data.steps : [];
  let text = '';
  for (const step of steps) {
    if (step?.type !== 'model_output') continue;
    const content = Array.isArray(step.content) ? step.content : [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
    }
  }
  if (!text) {
    throw new Error(`Gemini Interactions 回覆没有可消费的文本（status: ${status || 'unknown'}）`);
  }
  return text;
}

function normalizeGeminiInteractionsData(data) {
  return { choices: [{ message: { content: extractGeminiInteractionsText(data) } }] };
}

/** 直连时按格式转换请求体；宿主代理走格式感知翻译时用不到（后端自己转）。 */
function buildDirectPayload(fmt, requestBody) {
  if (fmt === API_FORMATS.OPENAI_RESPONSES) {
    const input = buildResponsesInput(requestBody.messages);
    const payload = {
      model: requestBody.model,
      input,
      store: false,
      temperature: requestBody.temperature,
      top_p: requestBody.top_p,
      seed: requestBody.seed,
    };
    if (requestBody.max_tokens) payload.max_output_tokens = requestBody.max_tokens;
    if (requestBody.max_completion_tokens) payload.max_output_tokens = requestBody.max_completion_tokens;
    if (requestBody.response_format?.type === 'json_object') {
      payload.text = { format: { type: 'json_object' } };
    }
    return payload;
  }
  if (fmt === API_FORMATS.CLAUDE_MESSAGES) {
    return buildClaudeMessagesBody(requestBody);
  }
  if (fmt === API_FORMATS.GEMINI_INTERACTIONS) {
    return buildGeminiInteractionsBody(requestBody);
  }
  return requestBody;
}

async function requestChatCompletion(apiBase, settings, body, runContext = {}) {
  const logApiDebug = (phase, details = {}) => {
    if (!globalThis.__bs_biotracker_debug_api__) return;
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
    const fmt = normalizeApiFormat(settings?.apiFormat);
    const upstreamUrl = getApiUrlForFormat(apiBase, fmt);
    const isCompat = fmt === API_FORMATS.OPENAI_COMPAT;
    // TT 后端按 custom_api_format 在服务端翻译；原版 ST 后端不认得这个字段
    const formatAwareProxy = !isCompat && hostSupportsFormatAwareProxy();
    // ST/Luker 的 /proxy/<url> 透传代理：服务端原样转发绕开 CORS（需 config.yaml 开启 enableCorsProxy，未开启返回 404）
    const transparentProxyUrl = !isCompat && !formatAwareProxy && isBrowserRuntime() && isCrossOriginUrl(upstreamUrl)
      ? `/proxy/${upstreamUrl}`
      : null;
    const canUseHostProxy = shouldUseHostProxy(upstreamUrl) && (isCompat || formatAwareProxy);
    let transport = canUseHostProxy
      ? (formatAwareProxy ? 'host-proxy-formatted' : 'host-proxy')
      : (transparentProxyUrl ? 'host-proxy-transparent' : 'direct');
    let url = canUseHostProxy ? '/api/backends/chat-completions/generate' : (transparentProxyUrl || upstreamUrl);
    const payloadForTransport = canUseHostProxy ? requestBody : buildDirectPayload(fmt, requestBody);
    assertSafeDirectApiBase(apiBase);
    let requestText = '';
    try {
      requestText = JSON.stringify(payloadForTransport);
      logApiDebug(`request:${attempt}`, {
        transport,
        url,
        apiBase,
        format: fmt,
        requestBody: payloadForTransport,
        requestText,
        requestTextLength: requestText.length,
      });
      let response;
      let responseText;
      if (canUseHostProxy) {
        let proxyError = null;
        try {
          ({ response, responseText } = await requestHostProxyChatCompletion(apiBase, settings, requestBody, runContext, fmt));
        } catch (error) {
          proxyError = error;
          logApiDebug(`proxy_error:${attempt}`, { proxyError: error });
          if (isApiTimeoutError(error) || isApiDeadlineError(error)) throw error;
        }
        if (proxyError || (!response.ok && shouldFallbackFromHostProxy(responseText, response.status))) {
          transport = proxyError ? 'direct-after-proxy-error' : `direct-after-proxy-${response.status}`;
          url = upstreamUrl;
          if (!proxyError && (response.status === 401 || response.status === 403)) {
            disableHostProxyForSession(response.status, responseText);
          }
          ({ response, responseText } = await fetchText(upstreamUrl, {
            method: 'POST',
            headers: getAuthHeaders(settings),
            body: requestText,
            timeoutMs: resolveApiTimeoutMs(settings),
            externalSignal: runContext.signal || null,
            deadlineMs: runContext.deadlineMs || 0,
          }));
        }
      } else if (transparentProxyUrl) {
        let proxyError = null;
        try {
          ({ response, responseText } = await fetchText(transparentProxyUrl, {
            method: 'POST',
            headers: getHostProxyHeaders(getAuthHeaders(settings)),
            body: requestText,
            timeoutMs: resolveApiTimeoutMs(settings),
            externalSignal: runContext.signal || null,
            deadlineMs: runContext.deadlineMs || 0,
          }));
        } catch (error) {
          proxyError = error;
          logApiDebug(`transparent_proxy_error:${attempt}`, { proxyError: error });
          if (isApiTimeoutError(error) || isApiDeadlineError(error)) throw error;
        }
        if (proxyError || (!response.ok && shouldFallbackFromHostProxy(responseText, response.status))) {
          transport = proxyError ? 'direct-after-proxy-error' : `direct-after-proxy-${response.status}`;
          url = upstreamUrl;
          ({ response, responseText } = await fetchText(upstreamUrl, {
            method: 'POST',
            headers: getAuthHeaders(settings),
            body: requestText,
            timeoutMs: resolveApiTimeoutMs(settings),
            externalSignal: runContext.signal || null,
            deadlineMs: runContext.deadlineMs || 0,
          }));
        }
      } else {
        ({ response, responseText } = await fetchText(upstreamUrl, {
          method: 'POST',
          headers: getAuthHeaders(settings),
          body: requestText,
          timeoutMs: resolveApiTimeoutMs(settings),
          externalSignal: runContext.signal || null,
          deadlineMs: runContext.deadlineMs || 0,
        }));
      }
      traceRequestToUi('POST', upstreamUrl, response.status, transport);
      if (globalThis.__bs_biotracker_debug_api__) {
        globalThis[DEBUG_LAST_API_RESPONSE_KEY] = {
          capturedAt: Date.now(),
          attempt,
          transport,
          format: fmt,
          url,
          status: response.status,
          ok: response.ok,
          responseText,
          requestText,
        };
      }
      logApiDebug(`response:${attempt}`, {
        transport,
        url,
        status: response.status,
        ok: response.ok,
        responseText,
        requestText,
      });
      return { response, responseText, requestText, format: fmt };
    } catch (error) {
      traceRequestToUi('POST', upstreamUrl, 0, transport);
      logApiDebug(`error:${attempt}`, {
        transport,
        url,
        requestBody: payloadForTransport,
        requestText,
        error,
      });
      if (isApiTimeoutError(error) || isApiDeadlineError(error)) throw error;
      throw new Error(`无法连接到 API。请检查 Base URL、API Key、服务是否启动；浏览器环境会优先通过酒馆后端代理。若使用原版 SillyTavern 且渠道不允许浏览器直连（CORS 拦截），可在 config.yaml 设置 corsProxy.enabled: true 后重启，让酒馆服务器代为转发。原始错误: ${String(error?.message || error)}`);
    } finally {
      globalThis.__bs_biotracker_async_request__ = previousAsyncFlag;
    }
  };

  let result = await postBody(body, 'primary');
  let response = result.response;
  let responseText = result.responseText;
  let errorText = response.ok ? '' : responseText;
  const isResponses = result.format === API_FORMATS.OPENAI_RESPONSES;
  const isClaude = result.format === API_FORMATS.CLAUDE_MESSAGES;
  const isGemini = result.format === API_FORMATS.GEMINI_INTERACTIONS;
  const isNonCompatFormat = isResponses || isClaude || isGemini;

  if (!response.ok && response.status === 400 && body.response_format && !isNonCompatFormat) {
    const fallbackBody = {
      model: body.model,
      temperature: body.temperature,
      top_p: body.top_p,
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
  if (!response.ok && invalidArgument && !isNonCompatFormat) {
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
    throw new Error(`API ${response.status}［实际请求: ${getApiUrlForFormat(apiBase, result.format)}］: ${sanitizeErrorText(errorText)}`);
  }
  try {
    const parsed = JSON.parse(responseText);
    if (isResponses) return normalizeResponsesData(parsed);
    if (isClaude) return normalizeClaudeData(parsed);
    if (isGemini) return normalizeGeminiInteractionsData(parsed);
    return parsed;
  } catch (error) {
    logApiDebug('parse_error', {
      status: response.status,
      responseText,
      error,
    });
    throw error;
  }
}

export async function fetchModelList(settings) {
  const apiBase = getApiBase(settings);
  if (!apiBase) throw new Error('请先填写 API Base URL');
  let response;
  let responseText = '';
  const url = `${apiBase}/models`;
  assertSafeDirectApiBase(apiBase);
  const useHostProxy = shouldUseHostProxy(url);
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
        if (!proxyError && (response.status === 401 || response.status === 403)) {
          disableHostProxyForSession(response.status, responseText);
        }
        ({ response, responseText } = await fetchText(url, { method: 'GET', headers: getAuthHeaders(settings), timeoutMs: resolveModelListTimeoutMs(settings) }));
      }
    } else {
      ({ response, responseText } = await fetchText(url, { method: 'GET', headers: getAuthHeaders(settings), timeoutMs: resolveModelListTimeoutMs(settings) }));
    }
    traceRequestToUi('GET', url, response?.status, transport);
  } catch (error) {
    traceRequestToUi('GET', url, 0, transport);
    throw new Error(`模型列表连接失败（${transport}）。请检查 Base URL / API Key；也可手动填写模型名称后直接使用追踪/注册。原始错误: ${String(error?.message || error)}`);
  }
  if (!response.ok) {
    throw new Error(`模型列表请求失败 ${response.status}（${transport}）: ${sanitizeErrorText(responseText)}。如果此 API 不支持 /models，可手动填写模型名称。`);
  }
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`模型列表响应不是 JSON（${transport}）: ${sanitizeErrorText(responseText)}`);
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
  // 格式化输出(v4兼容)：response_format.type = json_object（无 json_schema），可在设置关闭。
  // DeepSeek 系额外注入输出结构指令——但只在追踪流程注入：registry/日记/备装/技能/
  // 繁育推演各自声明了不同的 JSON 结构，注入 tool_calls 指令会压过它们的 schema。
  const useFormattedOutputV4 = shouldUseResponseFormat(settings, model);
  const isTrackerFlow = !safePayload?.target_character;
  const injectV4Instruction = shouldInjectV4Instruction(settings, model) && isTrackerFlow;
  if (injectV4Instruction && effectiveMessages[0]?.role === 'system') {
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
    `${safePayload?.target_character ? 'registry' : 'tracker'}${mainflowCopy.hasMainflowCopy ? '-mainflow-copy' : (safePayload?.resolved_worldbook_prompt ? '-mainflow-worldinfo' : '')}${useFormattedOutputV4 ? '' : '-no-response-format'}${injectV4Instruction ? '-v4-instruction' : ''}`,
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
