// 追踪流程的原生工具调用：工具定义放进请求的 tools 参数，模型直接回 tool_calls，
// 不再靠正文里的一段 JSON。各家对 response_format 的支持参差（原版 SillyTavern 的自定义来源
// 甚至不转发它），tools 却是 SillyTavern、TauriTavern 与主流中转都会原样转发的参数。
// 只在 OpenAI 兼容格式下启用；上游不认 tools、或模型没用工具时，由 api.js 退回原本的
// 文本 JSON 协议，所以任何渠道都不会比以前差。

/** 提交逐角色检查清单（原本的 character_checks）的工具；不派发给工具层 */
export const CHARACTER_CHECKS_TOOL_NAME = 'bsReportCharacterChecks';

const CHARACTER_CHECKS_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: CHARACTER_CHECKS_TOOL_NAME,
    description: '提交本轮的逐角色检查清单：对 tracked_females 中每名角色恰好写一笔检查结论。只记录结论，不改变任何状态；真正的更新仍要用其他工具。每轮最后调用一次。',
    parameters: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              female: { type: 'string' },
              status: { type: 'string', enum: ['no_change', 'updated', 'present', 'offscreen'] },
            },
            required: ['female', 'status'],
          },
        },
      },
      required: ['checks'],
    },
  },
});

/** 追踪工具定义（name / description / input_schema）转成 OpenAI 的 tools 参数，末尾加上检查清单工具 */
export function buildNativeTrackerTools(toolDefinitions) {
  const tools = (Array.isArray(toolDefinitions) ? toolDefinitions : [])
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name.trim())
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name.trim(),
        description: String(tool.description || ''),
        parameters: tool.input_schema && typeof tool.input_schema === 'object'
          ? tool.input_schema
          : { type: 'object', properties: {} },
      },
    }));
  return tools.length ? [...tools, CHARACTER_CHECKS_TOOL] : [];
}

/** 接在系统提示词末尾：系统提示词可由使用者自订，里面写的仍是文本 JSON 的输出格式，这里说明本轮改用工具调用 */
export function buildNativeToolInstruction() {
  return [
    '[本轮输出方式：工具调用]',
    '- 本轮的可用工具已通过请求的 tools 参数提供（即上文所说的 available_tools），请直接用工具调用完成更新，不要在正文里输出 JSON。',
    '- 本轮要做的更新一次全部发出：可以同时调用多个工具，同一个工具也可以调用多次；调用的先后顺序就是执行顺序（例如先调用 bsPassedTime）。',
    `- 最后调用一次 ${CHARACTER_CHECKS_TOOL_NAME}，提交上文所说的 character_checks。`,
    `- 没有任何状态需要更新时，只调用 ${CHARACTER_CHECKS_TOOL_NAME}。`,
  ].join('\n');
}

/** 参数可能是 JSON 字符串或对象；解析不了就原样留下，交给工具层按参数缺失报错 */
function parseToolArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : raw;
  } catch {
    return raw;
  }
}

/**
 * 读回包里的原生工具调用，转成追踪器原本的 { tool_calls, character_checks }。
 * 没有任何具名工具调用时回传 null，由调用方改看正文或退回文本协议。
 */
export function readNativeToolCalls(data) {
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') return null;
  const rawCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
    ? message.tool_calls
    : (message.function_call ? [{ function: message.function_call }] : []);
  const toolCalls = [];
  let checks = null;
  let named = 0;
  for (const call of rawCalls) {
    const fn = call?.function && typeof call.function === 'object' ? call.function : call;
    const name = String(fn?.name || '').trim();
    if (!name) continue;
    named += 1;
    const args = parseToolArguments(fn?.arguments);
    if (name === CHARACTER_CHECKS_TOOL_NAME) {
      const list = args && typeof args === 'object' ? (args.checks ?? args.character_checks) : null;
      if (Array.isArray(list)) checks = [...(checks || []), ...list];
      continue;
    }
    toolCalls.push({ name, arguments: args });
  }
  if (!named) return null;
  const result = { tool_calls: toolCalls };
  if (checks) result.character_checks = checks;
  return result;
}

/** 上游明确拒绝了请求参数（多半是不认 tools）：只有这种情况才改用文本协议，鉴权、限流、服务端错误照常报错重试 */
export function isNativeToolRejection(error) {
  const status = Number(error?.status);
  return status === 400 || status === 422;
}
