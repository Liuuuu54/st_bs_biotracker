// 追踪流程改用原生工具调用：OpenAI 兼容格式下把工具定义放进 tools 参数、直接读回包的 tool_calls；
// 上游不认 tools、或模型没用工具时退回原本的文本 JSON 协议。格式化输出（response_format）已移除。
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { callOpenAICompatible, __nativeToolsRejectedForTest } from '../scripts/api.js';
import {
  buildNativeTrackerTools,
  CHARACTER_CHECKS_TOOL_NAME,
  isNativeToolRejection,
  readNativeToolCalls,
} from '../scripts/native_tools.js';

const ORIGINAL_GLOBALS = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  SillyTavern: globalThis.SillyTavern,
};

beforeEach(() => {
  __nativeToolsRejectedForTest.clear();
});

afterEach(() => {
  Object.entries(ORIGINAL_GLOBALS).forEach(([key, value]) => {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  });
  delete globalThis.__bs_biotracker_host_proxy_disabled__;
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof data === 'string' ? data : JSON.stringify(data);
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'bsPassedTime',
    description: '推进时间',
    input_schema: { type: 'object', properties: { hour: { type: 'integer' } }, additionalProperties: false },
  },
  {
    name: 'bsUpdateCharacterStatus',
    description: '更新状态',
    input_schema: { type: 'object', properties: { female: { type: 'string' } }, required: ['female'] },
  },
];

function trackerPayload() {
  return { tracked_females: ['艾拉'], recent_messages: [], available_tools: TOOL_DEFINITIONS };
}

const SETTINGS = {
  apiUrl: 'https://api.example.test/v1',
  apiKey: 'secret',
  model: 'tool-model',
};

function nativeToolResponse() {
  return {
    choices: [{
      message: {
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":2}' } },
          { id: 'c2', type: 'function', function: { name: 'bsUpdateCharacterStatus', arguments: { female: '艾拉', options: { libido: 5 } } } },
          {
            id: 'c3',
            type: 'function',
            function: { name: CHARACTER_CHECKS_TOOL_NAME, arguments: JSON.stringify({ checks: [{ female: '艾拉', status: 'updated' }] }) },
          },
        ],
      },
      finish_reason: 'tool_calls',
    }],
  };
}

function textJsonResponse(result) {
  return { choices: [{ message: { content: JSON.stringify(result) } }] };
}

/** node 里没有 window，请求直连上游；按顺序回给定的回包并记下请求体 */
function installDirectFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof next === 'function' ? next() : next;
  };
  return calls;
}

// ---- 纯函数 ----

test('追踪工具定义转成 OpenAI 的 tools 参数，末尾加上提交逐角色检查的工具', () => {
  const tools = buildNativeTrackerTools(TOOL_DEFINITIONS);
  assert.deepEqual(tools.map((tool) => tool.function.name), ['bsPassedTime', 'bsUpdateCharacterStatus', CHARACTER_CHECKS_TOOL_NAME]);
  assert.equal(tools[0].type, 'function');
  assert.equal(tools[0].function.description, '推进时间');
  assert.deepEqual(tools[0].function.parameters, TOOL_DEFINITIONS[0].input_schema);
  const checks = tools.at(-1).function.parameters;
  assert.equal(checks.properties.checks.type, 'array');
  assert.deepEqual(checks.required, ['checks']);
  assert.deepEqual(buildNativeTrackerTools([]), [], '没有可用工具时不发 tools');
});

test('读回包里的工具调用：字符串与对象参数都认，检查清单单独取出，顺序不变', () => {
  const result = readNativeToolCalls(nativeToolResponse());
  assert.deepEqual(result.tool_calls, [
    { name: 'bsPassedTime', arguments: { hour: 2 } },
    { name: 'bsUpdateCharacterStatus', arguments: { female: '艾拉', options: { libido: 5 } } },
  ]);
  assert.deepEqual(result.character_checks, [{ female: '艾拉', status: 'updated' }]);
});

test('读回包：只交了检查清单也算有效；旧式 function_call 也认；坏参数原样留给工具层报错', () => {
  const checksOnly = readNativeToolCalls({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: CHARACTER_CHECKS_TOOL_NAME, arguments: '{"checks":[{"female":"艾拉","status":"no_change"}]}' } },
  ] } }] });
  assert.deepEqual(checksOnly, { tool_calls: [], character_checks: [{ female: '艾拉', status: 'no_change' }] });

  const legacy = readNativeToolCalls({ choices: [{ message: { function_call: { name: 'bsPassedTime', arguments: '{"hour":1}' } } }] });
  assert.deepEqual(legacy.tool_calls, [{ name: 'bsPassedTime', arguments: { hour: 1 } }]);

  const broken = readNativeToolCalls({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":' } },
  ] } }] });
  assert.deepEqual(broken.tool_calls, [{ name: 'bsPassedTime', arguments: '{"hour":' }]);
});

test('读回包：没有工具调用回传 null', () => {
  assert.equal(readNativeToolCalls({ choices: [{ message: { content: '今天没有变化' } }] }), null);
  assert.equal(readNativeToolCalls({ choices: [{ message: { tool_calls: [] } }] }), null);
  assert.equal(readNativeToolCalls({ choices: [{ message: { tool_calls: [{ function: { name: '' } }] } }] }), null);
  assert.equal(readNativeToolCalls(null), null);
});

test('只有上游明确拒绝请求参数（400 / 422）才算不认 tools', () => {
  for (const status of [400, 422]) assert.equal(isNativeToolRejection({ status }), true, String(status));
  for (const status of [401, 403, 404, 429, 500, 502, undefined]) assert.equal(isNativeToolRejection({ status }), false, String(status));
});

// ---- 请求流程 ----

test('追踪请求：OpenAI 兼容格式下带 tools，不带 response_format，用户消息里不再重复工具定义', async () => {
  const calls = installDirectFetch([jsonResponse(nativeToolResponse())]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/v1/chat/completions');
  const body = calls[0].body;
  assert.deepEqual(body.tools.map((tool) => tool.function.name), ['bsPassedTime', 'bsUpdateCharacterStatus', CHARACTER_CHECKS_TOOL_NAME]);
  assert.equal(body.response_format, undefined);
  assert.equal(body.tool_choice, undefined, '用 auto（不传）：开思考的模型不接受强制调用');
  const userPayload = JSON.parse(body.messages.at(-1).content);
  assert.equal(userPayload.available_tools, undefined);
  assert.deepEqual(userPayload.tracked_females, ['艾拉']);
  assert.match(body.messages[0].content, /^SYSTEM/);
  assert.match(body.messages[0].content, new RegExp(CHARACTER_CHECKS_TOOL_NAME));

  assert.deepEqual(result.tool_calls.map((call) => call.name), ['bsPassedTime', 'bsUpdateCharacterStatus']);
  assert.deepEqual(result.character_checks, [{ female: '艾拉', status: 'updated' }]);
});

test('上游拒绝 tools（400）：同一次改用文本 JSON 再要，之后这个模型直接走文本', async () => {
  const textResult = { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 1 } }], character_checks: [] };
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'Unrecognized request argument supplied: tools' } }, 400),
    jsonResponse(textJsonResponse(textResult)),
  ]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.tools);
  assert.equal(calls[1].body.tools, undefined);
  assert.deepEqual(JSON.parse(calls[1].body.messages.at(-1).content).available_tools.map((tool) => tool.name), ['bsPassedTime', 'bsUpdateCharacterStatus']);
  assert.equal(calls[1].body.messages[0].content, 'SYSTEM', '文本协议沿用原本的系统提示词');

  const again = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(again.length, 1);
  assert.equal(again[0].body.tools, undefined, '被拒过的模型本次会话不再试 tools');

  const otherModel = installDirectFetch([jsonResponse(nativeToolResponse())]);
  await callOpenAICompatible({ ...SETTINGS, model: 'other-model' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.ok(otherModel[0].body.tools, '换了模型照样先试 tools');
});

test('模型没用工具、正文也不是 JSON：退回文本 JSON 再要一次', async () => {
  const textResult = { tool_calls: [], character_checks: [{ female: '艾拉', status: 'no_change' }] };
  const calls = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: '这一轮没有需要更新的地方。' } }] }),
    jsonResponse(textJsonResponse(textResult)),
  ]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.tools, undefined);
  assert.equal(__nativeToolsRejectedForTest.size, 0, '没被上游拒绝，下次照样先试 tools');
});

test('模型没用工具、但正文是追踪 JSON：直接采用，不再多发请求', async () => {
  const textResult = { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 3 } }] };
  const calls = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 1);
});

test('其他 API 格式与非追踪流程：照旧走文本 JSON，不带 tools 也不带 response_format', async () => {
  const textResult = { tool_calls: [] };
  const responses = installDirectFetch([jsonResponse({ output_text: JSON.stringify(textResult) })]);
  await callOpenAICompatible({ ...SETTINGS, apiFormat: 'openai_responses' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(responses[0].body.tools, undefined);
  assert.equal(responses[0].body.text, undefined);
  assert.ok(JSON.parse(responses[0].body.input.at(-1).content).available_tools, '其他格式照旧在用户消息里带工具定义');

  const registry = installDirectFetch([jsonResponse(textJsonResponse({ items: [] }))]);
  await callOpenAICompatible(SETTINGS, { target_character: '艾拉', available_tools: TOOL_DEFINITIONS }, 'SYSTEM', { flow: 'registry' });
  assert.equal(registry[0].body.tools, undefined);
  assert.equal(registry[0].body.response_format, undefined);

  const notAsked = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(notAsked[0].body.tools, undefined, '没要求原生工具就不带');
});

test('原版 SillyTavern 后端代理：tools 跟着转发，不再带 response_format', async () => {
  const calls = [];
  globalThis.window = {};
  globalThis.document = { cookie: 'csrf_token=test-csrf' };
  globalThis.location = { origin: 'http://localhost:8000', href: 'http://localhost:8000/' };
  globalThis.SillyTavern = { getContext: () => null, getRequestHeaders: () => ({}) };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(nativeToolResponse());
  };
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
  assert.equal(calls[0].body.chat_completion_source, 'custom');
  assert.deepEqual(calls[0].body.tools.map((tool) => tool.function.name).at(-1), CHARACTER_CHECKS_TOOL_NAME);
  assert.equal('response_format' in calls[0].body, false);
  assert.equal(result.tool_calls.length, 2);
});

test('追踪全流程：模型用原生工具调用回包，状态照常结算，检查清单照常记下', async () => {
  const state = await import('../scripts/state.js');
  const { runTracker } = await import('../scripts/tracker.js');
  const ctx = {
    chatId: 'native-tools-chat',
    chat: [
      { is_user: true, name: 'User', mes: '我们休息一下吧。' },
      { is_user: false, name: 'Alice', mes: '两人在旅店里休息了两个小时。', swipe_id: 0 },
    ],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  Object.assign(settings, { enabled: true, apiUrl: 'https://api.example.test/v1', apiKey: 'k', model: 'tool-model' });
  state.getChatState(ctx, settings).characters['艾拉'] = { ...state.createDefaultFemaleState('艾拉'), initialized: true };
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonResponse({ choices: [{ message: { tool_calls: [
      { id: 'a', type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":2}' } },
      { id: 'b', type: 'function', function: { name: CHARACTER_CHECKS_TOOL_NAME, arguments: '{"checks":[{"female":"艾拉","status":"updated"}]}' } },
    ] } }] });
  };

  await runTracker(ctx, { renderStatusPanel() {}, updateMainFlowPrompt() {} }, 'manual');

  assert.equal(bodies.length, 1);
  assert.ok(bodies[0].tools.some((tool) => tool.function.name === 'bsPassedTime'), '追踪请求带上了 tools');
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  assert.equal(chatState.minutesPassed, 120);
  assert.deepEqual(chatState.lastRawResult.tool_calls.map((call) => call.name), ['bsPassedTime']);
  assert.deepEqual(chatState.lastRawResult.character_checks, [{ female: '艾拉', status: 'updated' }]);
});

test('上游回「invalid argument」拒绝 tools 时，不退成丢掉工具定义的最小请求，而是改用完整的文本协议', async () => {
  const textResult = { tool_calls: [] };
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'Invalid argument: tools is not supported' } }, 400),
    jsonResponse(textJsonResponse(textResult)),
  ]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.tools, undefined);
  assert.ok(JSON.parse(calls[1].body.messages.at(-1).content).available_tools, '第二个请求要带回工具定义');
});
