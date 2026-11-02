// 原生工具调用：工具定义放进请求的 tools 参数，模型直接回 tool_calls，不再靠正文里的一段 JSON。
// 各家对 response_format 的支持参差（原版 SillyTavern 的自定义来源甚至不转发它），
// tools 却是 SillyTavern、TauriTavern 与主流中转都会原样转发的参数。
// - 追踪：每个动作一个工具，另加提交检查清单的工具。
// - 备装、起始着衣：一个提交工具交整份结果，参数沿用追踪工具的衣物定义。
// 四种 API 格式都启用（直连时由 api.js 翻成各家的工具格式）；上游不认 tools、模型没用工具、
// 或调用没发完时，由 api.js 退回原本的文本 JSON 协议，所以任何渠道都不会比以前差。

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
    '- 这是唯一的一次回复：你不会收到任何工具结果，也没有下一轮。必须在这一次回复里同时发出本轮全部的工具调用，不要只调用一个就停下等结果。',
    '- 可以同时调用多个工具，同一个工具也可以调用多次；调用的先后顺序就是执行顺序（例如先调用 bsPassedTime）。',
    `- 在同一次回复的最后调用一次 ${CHARACTER_CHECKS_TOOL_NAME}，提交上文所说的 character_checks；它表示本轮的调用已经全部发出。`,
    `- 没有任何状态需要更新时，只调用 ${CHARACTER_CHECKS_TOOL_NAME}。`,
  ].join('\n');
}

/** 参数可能是 JSON 字符串或对象；解析不了就原样留下，由各流程的方案决定怎么处理（追踪整批退回、提交工具当作没交） */
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

/** 回包里的具名工具调用 [{ name, args }]（args 已尝试解析）；一个都没有时回传 null */
function collectToolCalls(data) {
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') return null;
  const rawCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
    ? message.tool_calls
    : (message.function_call ? [{ function: message.function_call }] : []);
  const calls = [];
  for (const call of rawCalls) {
    const fn = call?.function && typeof call.function === 'object' ? call.function : call;
    const name = String(fn?.name || '').trim();
    if (name) calls.push({ name, args: parseToolArguments(fn?.arguments) });
  }
  return calls.length ? calls : null;
}

/** 工具调用转成追踪器原本的 { tool_calls, character_checks } */
function toTrackerResult(calls) {
  const toolCalls = [];
  const checks = [];
  let checksReported = false;
  for (const { name, args } of calls) {
    if (name === CHARACTER_CHECKS_TOOL_NAME) {
      checksReported = true;
      const list = args && typeof args === 'object' ? (args.checks ?? args.character_checks) : null;
      if (Array.isArray(list)) checks.push(...list);
      continue;
    }
    toolCalls.push({ name, arguments: args });
  }
  const result = { tool_calls: toolCalls };
  // 调用了检查清单工具就带上 character_checks（参数坏了是空清单）：api.js 以它判断本轮的调用已经发完
  if (checksReported) result.character_checks = checks;
  return result;
}

/**
 * 读回包里的原生工具调用，转成追踪器原本的 { tool_calls, character_checks }。
 * 没有任何具名工具调用时回传 null，由调用方改看正文或退回文本协议。
 */
export function readNativeToolCalls(data) {
  const calls = collectToolCalls(data);
  return calls ? toTrackerResult(calls) : null;
}

function isTrackerResultShape(value) {
  return Boolean(value) && typeof value === 'object'
    && (Array.isArray(value.tool_calls) || Array.isArray(value.character_checks));
}

function isJsonObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 追踪的方案。read 回传 { result }（可用）、{ invalid, toolCalls }（有参数解析不了）、
 * { incomplete, toolCalls }（调用没发完）或 null（没用工具）。
 * - 任一工具（含检查清单）的参数解析不了就整批不用：派发下去那一项会被工具层略过，该楼却已标成追踪完成。
 * - 检查清单工具是「本轮调用已全部发出」的标记：有调用却没交检查清单，多半是模型调用一个就停下
 *   等工具结果（实测 GPT、Kimi 常这样），其余更新全落掉了，不能用这份残缺结果。
 */
function buildTrackerToolPlan(payload) {
  const tools = buildNativeTrackerTools(payload?.available_tools);
  if (!tools.length) return null;
  return {
    tools,
    instruction: buildNativeToolInstruction(),
    omitPayloadKeys: ['available_tools'],
    read(data) {
      const calls = collectToolCalls(data);
      if (!calls) return null;
      const invalid = calls.filter((call) => !isJsonObject(call.args));
      if (invalid.length) return { invalid: true, toolCalls: invalid.map((call) => call.name) };
      const native = toTrackerResult(calls);
      return Array.isArray(native.character_checks) ? { result: native } : { incomplete: true, toolCalls: native.tool_calls };
    },
    acceptsContent: isTrackerResultShape,
  };
}

export const WARDROBE_PREP_TOOL_NAME = 'bsSubmitWardrobePrep';
export const STARTING_OUTFIT_TOOL_NAME = 'bsSubmitStartingOutfit';

function findToolSchema(toolDefinitions, name) {
  const tool = (Array.isArray(toolDefinitions) ? toolDefinitions : []).find((entry) => entry?.name === name);
  return isJsonObject(tool?.input_schema) ? tool.input_schema : null;
}

/** 备装的提交工具：参数就是文本协议的 { items, remove }，衣物结构取自 bsAddWardrobeItem，丢弃的 id 取自 bsRemoveWardrobeItem */
export function buildWardrobePrepSubmitTool(toolDefinitions) {
  const item = findToolSchema(toolDefinitions, 'bsAddWardrobeItem')?.properties?.item;
  const itemId = findToolSchema(toolDefinitions, 'bsRemoveWardrobeItem')?.properties?.itemId;
  if (!item || !itemId) return null;
  return {
    name: WARDROBE_PREP_TOOL_NAME,
    description: '提交本次备装结果，只调用一次。items 是要新增或更新的衣物；remove 是要丢掉的既有衣物 id 与原因。没有要新增或丢掉的就给空数组。',
    parameters: {
      type: 'object',
      properties: {
        items: { type: 'array', items: item },
        remove: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: itemId, reason: { type: 'string' } },
            required: ['id', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['items', 'remove'],
      additionalProperties: false,
    },
  };
}

/** 起始着衣的提交工具：参数就是文本协议的 { currentOutfit }，main 与 accessories 的结构取自 bsChangeOutfit */
export function buildStartingOutfitSubmitTool(toolDefinitions) {
  const outfit = findToolSchema(toolDefinitions, 'bsChangeOutfit')?.properties;
  if (!outfit?.main || !outfit?.accessories) return null;
  return {
    name: STARTING_OUTFIT_TOOL_NAME,
    description: '提交这名角色此刻的起始着衣，只调用一次。nude=true 表示全裸，此时不给 main 与 accessories。',
    parameters: {
      type: 'object',
      properties: {
        currentOutfit: {
          type: 'object',
          properties: {
            nude: { type: 'boolean' },
            main: outfit.main,
            accessories: outfit.accessories,
            wearState: outfit.wearState || { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['currentOutfit'],
      additionalProperties: false,
    },
  };
}

/** 接在提交类流程的系统提示词末尾：系统提示词仍要求输出 JSON，这里说明改由工具参数交这份 JSON */
function buildSubmitToolInstruction(name) {
  return [
    '[本次输出方式：工具调用]',
    `- 调用一次 ${name} 提交结果：它的参数就是上文要求输出的那份 JSON（结构、字段与取值规则都照上文），不要在正文里输出 JSON。`,
    '- 这是唯一的一次回复，不会收到工具结果，也没有下一轮：整份结果在这一次调用里交完。',
  ].join('\n');
}

/** 提交类流程的方案：只有一个工具，调用一次就是整份结果，不会有调用没发完的情况 */
function buildSubmitToolPlan(tool) {
  const name = String(tool?.name || '').trim();
  if (!name || !isJsonObject(tool.parameters)) return null;
  return {
    tools: [{ type: 'function', function: { name, description: String(tool.description || ''), parameters: tool.parameters } }],
    instruction: buildSubmitToolInstruction(name),
    omitPayloadKeys: [],
    read(data) {
      const call = readNativeToolCalls(data)?.tool_calls.find((entry) => entry.name === name);
      // 参数解析不了（原样留下的字符串）就当没交，改发文本请求
      return call && isJsonObject(call.arguments) ? { result: call.arguments } : null;
    },
    acceptsContent: isJsonObject,
  };
}

/**
 * 这次请求的原生工具调用方案：tools、接在系统提示词末尾的说明、要从用户消息里拿掉的栏位、读回包的方式。
 * options.nativeSubmitTool（备装、起始着衣）给一个提交工具；options.nativeTools=true 是追踪。
 * 没有可用方案时回传 null，照旧走文本 JSON。
 */
export function resolveNativeToolPlan(options, payload) {
  if (options?.nativeSubmitTool) return buildSubmitToolPlan(options.nativeSubmitTool);
  if (options?.nativeTools === true && !payload?.target_character) return buildTrackerToolPlan(payload);
  return null;
}

/** 上游明确拒绝了请求参数（多半是不认 tools）：只有这种情况才改用文本协议，鉴权、限流、服务端错误照常报错重试 */
export function isNativeToolRejection(error) {
  const status = Number(error?.status);
  return status === 400 || status === 422;
}
