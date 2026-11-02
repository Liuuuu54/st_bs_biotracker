// 原生工具调用：追踪把工具定义放进 tools 参数、直接读回包的工具调用；备装与起始着衣各用一个提交工具，
// 参数沿用追踪工具的衣物定义。四种 API 格式都适用；上游不认 tools、模型没用工具、或调用没发完时
// 退回原本的文本 JSON 协议。格式化输出（response_format）已移除。
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { callOpenAICompatible, __nativeToolsDisabledForTest } from '../scripts/api.js';
import {
  buildNativeTrackerTools,
  buildStartingOutfitSubmitTool,
  buildWardrobePrepSubmitTool,
  CHARACTER_CHECKS_TOOL_NAME,
  isNativeToolRejection,
  readNativeToolCalls,
} from '../scripts/native_tools.js';
import { TOOL_DEFINITIONS as REAL_TOOL_DEFINITIONS } from '../scripts/tools.js';

const ORIGINAL_GLOBALS = {
  fetch: globalThis.fetch,
  window: globalThis.window,
  document: globalThis.document,
  location: globalThis.location,
  SillyTavern: globalThis.SillyTavern,
};

beforeEach(() => {
  __nativeToolsDisabledForTest.clear();
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
  replyFormat: 'tools',
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

test('读回包：调用了检查清单工具就带 character_checks（参数坏了是空清单），没调用就不带', () => {
  const badChecks = readNativeToolCalls({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":1}' } },
    { type: 'function', function: { name: CHARACTER_CHECKS_TOOL_NAME, arguments: '{"checks":"艾拉没变化"}' } },
  ] } }] });
  assert.deepEqual(badChecks.character_checks, []);

  const noChecks = readNativeToolCalls({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":1}' } },
  ] } }] });
  assert.equal('character_checks' in noChecks, false);
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

test('400 不是因为工具（文本请求也被拒，例如账号区域限制）：不记为不支持工具，下次照样先试', async () => {
  const regionError = jsonResponse({ error: { message: 'This Go model requires Global regions.' } }, 400);
  const calls = installDirectFetch([regionError]);
  await assert.rejects(
    callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true }),
    /400/,
  );
  assert.equal(__nativeToolsDisabledForTest.size, 0);
  assert.equal(calls.filter((call) => call.body.tools).length, 1, '同一次调用里只试一次 tools，之后的重试直接走文本');
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
  assert.equal(__nativeToolsDisabledForTest.size, 0, '没被上游拒绝，下次照样先试 tools');
});

test('有工具调用却没交检查清单（模型调用一个就停下等结果）：不用这份残缺结果，同一次改用文本 JSON，之后这个模型直接走文本', async () => {
  const textResult = {
    tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 2 } }, { name: 'bsUpdateCharacterStatus', arguments: { female: '艾拉' } }],
    character_checks: [{ female: '艾拉', status: 'updated' }],
  };
  const calls = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":2}' } },
    ] }, finish_reason: 'tool_calls' }] }),
    jsonResponse(textJsonResponse(textResult)),
  ]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.tools);
  assert.equal(calls[1].body.tools, undefined);
  assert.ok(JSON.parse(calls[1].body.messages.at(-1).content).available_tools, '文本协议带回工具定义');

  const again = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(again.length, 1);
  assert.equal(again[0].body.tools, undefined, '本次会话里这个模型不再试 tools');
});

test('有工具调用却没交检查清单、改发的文本请求也失败：不记为文本模型，下次照样先试 tools', async () => {
  const calls = installDirectFetch([
    jsonResponse({ choices: [{ message: { tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":2}' } },
    ] } }] }),
    jsonResponse({ error: { message: 'bad request' } }, 400),
  ]);
  await assert.rejects(
    callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true }),
    /400/,
  );
  assert.equal(calls.filter((call) => call.body.tools).length, 1);
  assert.equal(__nativeToolsDisabledForTest.size, 0);
});

test('模型没用工具、但正文是追踪 JSON：直接采用，不再多发请求', async () => {
  const textResult = { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 3 } }] };
  const calls = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  const result = await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 1);
});

test('回复格式不是「工具调用」（默认是格式化输出）：追踪请求照旧走文本 JSON，不带 tools', async () => {
  const state = await import('../scripts/state.js');
  assert.equal(state.DEFAULT_SETTINGS.replyFormat, 'formatted');
  const textResult = { tool_calls: [], character_checks: [] };
  for (const settings of [{ ...SETTINGS, replyFormat: undefined }, { ...SETTINGS, replyFormat: 'plain' }, { ...SETTINGS, replyFormat: 'formatted' }]) {
    const calls = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
    await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.tools, undefined);
    assert.equal(calls[0].body.messages[0].content, 'SYSTEM', '系统提示词不加工具调用说明');
    assert.ok(JSON.parse(calls[0].body.messages.at(-1).content).available_tools, '工具定义照旧放在用户消息里');
  }
});

test('非追踪流程与没要求原生工具时：照旧走文本 JSON，不带 tools 也不带 response_format', async () => {
  const textResult = { tool_calls: [] };
  const registry = installDirectFetch([jsonResponse(textJsonResponse({ items: [] }))]);
  await callOpenAICompatible(SETTINGS, { target_character: '艾拉', available_tools: TOOL_DEFINITIONS }, 'SYSTEM', { flow: 'registry' });
  assert.equal(registry[0].body.tools, undefined);
  assert.equal(registry[0].body.response_format, undefined);

  const notAsked = installDirectFetch([jsonResponse(textJsonResponse(textResult))]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(notAsked[0].body.tools, undefined, '没要求原生工具就不带');
});

test('OpenAI Responses 直连：工具写成 Responses 的函数格式（strict=false），回包的 function_call 项读回来', async () => {
  const calls = installDirectFetch([jsonResponse({
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'bsPassedTime', arguments: '{"hour":2}' },
      { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: CHARACTER_CHECKS_TOOL_NAME, arguments: '{"checks":[{"female":"艾拉","status":"updated"}]}' },
    ],
  })]);
  const result = await callOpenAICompatible({ ...SETTINGS, apiFormat: 'openai_responses' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls[0].url, 'https://api.example.test/v1/responses');
  const body = calls[0].body;
  assert.deepEqual(body.tools[0], { type: 'function', name: 'bsPassedTime', description: '推进时间', parameters: TOOL_DEFINITIONS[0].input_schema, strict: false });
  assert.equal(body.tools.at(-1).name, CHARACTER_CHECKS_TOOL_NAME);
  assert.equal(body.text, undefined);
  assert.equal(JSON.parse(body.input.at(-1).content).available_tools, undefined);
  assert.deepEqual(result, { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 2 } }], character_checks: [{ female: '艾拉', status: 'updated' }] });
});

test('Claude Messages 直连：工具写成 name / input_schema，回包的 tool_use 块读回来', async () => {
  const calls = installDirectFetch([jsonResponse({
    content: [
      { type: 'text', text: '我来更新状态。' },
      { type: 'tool_use', id: 'toolu_1', name: 'bsPassedTime', input: { hour: 2 } },
      { type: 'tool_use', id: 'toolu_2', name: CHARACTER_CHECKS_TOOL_NAME, input: { checks: [{ female: '艾拉', status: 'updated' }] } },
    ],
    stop_reason: 'tool_use',
  })]);
  const result = await callOpenAICompatible({ ...SETTINGS, apiFormat: 'claude_messages' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls[0].url, 'https://api.example.test/v1/messages');
  const body = calls[0].body;
  assert.deepEqual(body.tools[0], { name: 'bsPassedTime', description: '推进时间', input_schema: TOOL_DEFINITIONS[0].input_schema });
  assert.equal(body.tools.at(-1).name, CHARACTER_CHECKS_TOOL_NAME);
  assert.equal(body.tool_choice, undefined);
  assert.equal(JSON.parse(body.messages.at(-1).content).available_tools, undefined);
  assert.match(body.system, new RegExp(CHARACTER_CHECKS_TOOL_NAME));
  assert.deepEqual(result, { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 2 } }], character_checks: [{ female: '艾拉', status: 'updated' }] });
});

test('Gemini Interactions 直连：工具写成 function 步骤格式，requires_action 的 function_call 读回来、不因没有文字报错', async () => {
  const calls = installDirectFetch([jsonResponse({
    status: 'requires_action',
    steps: [
      { type: 'function_call', id: 'call_1', name: 'bsPassedTime', arguments: { hour: 2 } },
      { type: 'function_call', id: 'call_2', name: CHARACTER_CHECKS_TOOL_NAME, arguments: { checks: [{ female: '艾拉', status: 'updated' }] } },
    ],
  })]);
  const result = await callOpenAICompatible({ ...SETTINGS, apiUrl: 'https://gemini.example.test/v1beta', apiFormat: 'gemini_interactions' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls[0].url, 'https://gemini.example.test/v1beta/interactions');
  const body = calls[0].body;
  assert.deepEqual(body.tools[0], { type: 'function', name: 'bsPassedTime', description: '推进时间', parameters: TOOL_DEFINITIONS[0].input_schema });
  assert.equal(body.tools.at(-1).name, CHARACTER_CHECKS_TOOL_NAME);
  assert.deepEqual(result, { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 2 } }], character_checks: [{ female: '艾拉', status: 'updated' }] });
});

test('原生格式下模型没用工具：照样退回文本 JSON（Gemini 只回文字也不算失败）', async () => {
  const textResult = { tool_calls: [], character_checks: [] };
  const calls = installDirectFetch([
    jsonResponse({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '没有变化。' }] }] }),
    jsonResponse({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(textResult) }] }] }),
  ]);
  const result = await callOpenAICompatible({ ...SETTINGS, apiUrl: 'https://gemini.example.test/v1beta', apiFormat: 'gemini_interactions' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, textResult);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.tools);
  assert.equal(calls[1].body.tools, undefined);
  assert.ok(JSON.parse(calls[1].body.input.at(-1).content[0].text).available_tools, '文本协议带回工具定义');
});

test('TauriTavern 格式感知代理：tools 以 OpenAI 格式交给后端翻译，回来的 OpenAI 结构原样读', async () => {
  const calls = [];
  globalThis.__TAURITAVERN__ = {};
  globalThis.window = {};
  globalThis.document = { cookie: '' };
  globalThis.location = { origin: 'http://tauri.localhost', href: 'http://tauri.localhost/' };
  globalThis.SillyTavern = { getContext: () => null, getRequestHeaders: () => ({}) };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(nativeToolResponse());
  };
  try {
    for (const apiFormat of ['openai_responses', 'claude_messages', 'gemini_interactions']) {
      calls.length = 0;
      const result = await callOpenAICompatible({ ...SETTINGS, apiFormat }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
      assert.equal(calls.length, 1, apiFormat);
      assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
      assert.equal(calls[0].body.custom_api_format, apiFormat);
      assert.equal(calls[0].body.tools[0].type, 'function');
      assert.equal(calls[0].body.tools[0].function.name, 'bsPassedTime');
      assert.deepEqual(result.tool_calls.map((call) => call.name), ['bsPassedTime', 'bsUpdateCharacterStatus'], apiFormat);
      assert.deepEqual(result.character_checks, [{ female: '艾拉', status: 'updated' }], apiFormat);
    }
  } finally {
    delete globalThis.__TAURITAVERN__;
  }
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
  Object.assign(settings, { enabled: true, apiUrl: 'https://api.example.test/v1', apiKey: 'k', model: 'tool-model', replyFormat: 'tools' });
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

// ---- 备装与起始着衣：一个提交工具交整份结果 ----

const REAL_SCHEMAS = Object.fromEntries(REAL_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.input_schema]));
const WARDROBE_TOOL = buildWardrobePrepSubmitTool(REAL_TOOL_DEFINITIONS);
const OUTFIT_TOOL = buildStartingOutfitSubmitTool(REAL_TOOL_DEFINITIONS);
const FIT = { masking: 'medium', support: 'normal', capacity: 'loose', convenience: 'normal' };

function submitToolResponse(name, args) {
  return { choices: [{ message: { content: null, tool_calls: [
    { id: 's1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ] }, finish_reason: 'tool_calls' }] };
}

test('备装与起始着衣的提交工具：参数沿用追踪工具的衣物定义，档位枚举一致', () => {
  assert.equal(WARDROBE_TOOL.name, 'bsSubmitWardrobePrep');
  const wardrobe = WARDROBE_TOOL.parameters;
  assert.deepEqual(wardrobe.properties.items.items, REAL_SCHEMAS.bsAddWardrobeItem.properties.item);
  assert.deepEqual(wardrobe.properties.remove.items.properties.id, REAL_SCHEMAS.bsRemoveWardrobeItem.properties.itemId);
  assert.equal(wardrobe.properties.remove.items.properties.reason.type, 'string');
  assert.deepEqual(wardrobe.required, ['items', 'remove']);

  assert.equal(OUTFIT_TOOL.name, 'bsSubmitStartingOutfit');
  const current = OUTFIT_TOOL.parameters.properties.currentOutfit;
  assert.deepEqual(current.properties.main, REAL_SCHEMAS.bsChangeOutfit.properties.main);
  assert.deepEqual(current.properties.accessories, REAL_SCHEMAS.bsChangeOutfit.properties.accessories);
  assert.deepEqual(current.properties.wearState, REAL_SCHEMAS.bsChangeOutfit.properties.wearState);
  assert.equal(current.properties.nude.type, 'boolean');
  assert.deepEqual(OUTFIT_TOOL.parameters.required, ['currentOutfit']);

  assert.equal(buildWardrobePrepSubmitTool([]), null, '找不到衣物定义就不提供工具');
  assert.equal(buildStartingOutfitSubmitTool([]), null);
});

test('备装：选了工具调用时只带一个提交工具，调用的参数就是结果', async () => {
  const prep = { items: [{ name: '孕妇连衣裙', note: '浅蓝棉质', slot: 'main', fitProfile: FIT }], remove: [{ id: 3, reason: '孕后期穿不下' }] };
  const calls = installDirectFetch([jsonResponse(submitToolResponse(WARDROBE_TOOL.name, prep))]);
  const result = await callOpenAICompatible(SETTINGS, { target_character: '艾拉', existing_wardrobe: null }, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL });
  assert.deepEqual(result, prep);
  assert.equal(calls.length, 1);
  const body = calls[0].body;
  assert.deepEqual(body.tools.map((tool) => tool.function.name), [WARDROBE_TOOL.name]);
  assert.deepEqual(body.tools[0].function.parameters, WARDROBE_TOOL.parameters);
  assert.match(body.messages[0].content, /^SYSTEM/);
  assert.match(body.messages[0].content, new RegExp(WARDROBE_TOOL.name));
  assert.equal(JSON.parse(body.messages.at(-1).content).target_character, '艾拉', '用户消息照旧');
});

test('提交工具：没选工具调用不带 tools；模型直接回 JSON 照用；回一段话退回文本请求', async () => {
  const prep = { items: [], remove: [{ id: 2, reason: '撑破了' }] };
  const payload = { target_character: '艾拉' };
  const off = installDirectFetch([jsonResponse(textJsonResponse(prep))]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'plain' }, payload, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL });
  assert.equal(off.length, 1);
  assert.equal(off[0].body.tools, undefined);
  assert.equal(off[0].body.messages[0].content, 'SYSTEM');

  const jsonReply = installDirectFetch([jsonResponse(textJsonResponse(prep))]);
  assert.deepEqual(await callOpenAICompatible(SETTINGS, payload, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL }), prep);
  assert.equal(jsonReply.length, 1);

  const prose = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: '好的，我来整理衣柜。' } }] }),
    jsonResponse(textJsonResponse(prep)),
  ]);
  assert.deepEqual(await callOpenAICompatible(SETTINGS, payload, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL }), prep);
  assert.equal(prose.length, 2);
  assert.equal(prose[1].body.tools, undefined);
  assert.equal(prose[1].body.messages[0].content, 'SYSTEM', '文本请求用原本的系统提示词');
});

test('追踪的「调用没发完」只让追踪改用文本；上游拒绝 tools 则其他流程也改用文本', async () => {
  installDirectFetch([
    jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"hour":1}' } }] } }] }),
    jsonResponse(textJsonResponse({ tool_calls: [], character_checks: [] })),
  ]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  const prep = { items: [], remove: [] };
  const wardrobe = installDirectFetch([jsonResponse(submitToolResponse(WARDROBE_TOOL.name, prep))]);
  await callOpenAICompatible(SETTINGS, { target_character: '艾拉' }, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL });
  assert.ok(wardrobe[0].body.tools, '同一个模型的备装照样先试提交工具');

  __nativeToolsDisabledForTest.clear();
  installDirectFetch([
    jsonResponse({ error: { message: 'tools is not supported' } }, 400),
    jsonResponse(textJsonResponse(prep)),
  ]);
  await callOpenAICompatible(SETTINGS, { target_character: '艾拉' }, 'SYSTEM', { flow: 'wardrobe', nativeSubmitTool: WARDROBE_TOOL });
  const tracker = installDirectFetch([jsonResponse(textJsonResponse({ tool_calls: [] }))]);
  await callOpenAICompatible(SETTINGS, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(tracker.length, 1);
  assert.equal(tracker[0].body.tools, undefined, '上游不认 tools，追踪也直接走文本');
});

test('备装与起始着衣全流程：请求带上提交工具，回来的结果照常校验', async () => {
  const state = await import('../scripts/state.js');
  const { runRegistryOutfitInference, runRegistryWardrobeInference } = await import('../scripts/registry.js');
  const ctx = {
    chatId: 'native-submit-chat',
    name1: '雷恩',
    name2: '艾拉',
    characterId: 0,
    characters: [{ name: '艾拉', description: '旅行中的冒险者', avatar: 'ella.png' }],
    chat: [{ is_user: true, name: '雷恩', mes: '去成衣店看看吧。' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  Object.assign(settings, { apiUrl: 'https://api.example.test/v1', apiKey: 'k', model: 'tool-model', replyFormat: 'tools' });
  state.getChatState(ctx, settings).characters['艾拉'] = { ...state.createDefaultFemaleState('艾拉'), initialized: true };
  const outfit = { nude: false, main: { name: '旅行斗篷套装', note: '深绿羊毛', parts: ['斗篷', '长裙'], fitProfile: FIT }, accessories: [], wearState: '整齐' };
  const prep = { items: [{ name: '孕妇连衣裙', note: '浅蓝棉质', slot: 'main', fitProfile: FIT }], remove: [] };
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    const name = body.tools?.[0]?.function?.name;
    return jsonResponse(name === OUTFIT_TOOL.name
      ? submitToolResponse(name, { currentOutfit: outfit })
      : submitToolResponse(name, prep));
  };

  assert.deepEqual(await runRegistryOutfitInference(ctx, { targetName: '艾拉' }), outfit);
  assert.deepEqual(await runRegistryWardrobeInference(ctx, { targetName: '艾拉' }), prep);
  assert.deepEqual(bodies.map((body) => body.tools.map((tool) => tool.function.name)), [[OUTFIT_TOOL.name], [WARDROBE_TOOL.name]]);
});
