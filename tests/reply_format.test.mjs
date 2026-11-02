// 回复格式四选一：原生聊天消息（正文写 JSON）、格式化输出（response_format.json_object）、
// 工具调用退回原生消息、工具调用退回格式化输出。取代旧的「格式化输出」开关（formattedOutputV4）、
// 「工具调用」勾选（nativeToolCalls）与「退回时用格式化输出」勾选（toolFallbackFormatted），旧设定自动迁移。
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { callOpenAICompatible, isDeepSeekFamilyModel, shouldInjectV4Instruction, shouldUseResponseFormat, __nativeToolsDisabledForTest, __responseFormatRejectedForTest } from '../scripts/api.js';
import * as state from '../scripts/state.js';

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  __nativeToolsDisabledForTest.clear();
  __responseFormatRejectedForTest.clear();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
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

function textJsonResponse(result) {
  return { choices: [{ message: { content: JSON.stringify(result) } }] };
}

function installDirectFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  };
  return calls;
}

const SETTINGS = { apiUrl: 'https://api.example.test/v1', apiKey: 'secret', model: 'chat-model' };
const TOOL_DEFINITIONS = [{ name: 'bsPassedTime', description: '推进时间', input_schema: { type: 'object', properties: { hour: { type: 'integer' } } } }];
const trackerPayload = () => ({ tracked_females: ['艾拉'], recent_messages: [], available_tools: TOOL_DEFINITIONS });

// ---- 设定 ----

test('回复格式只认四个值；缺值时按旧设定推断，都没有就是格式化输出', () => {
  assert.deepEqual(Object.values(state.REPLY_FORMATS), ['plain', 'formatted', 'tools', 'tools_formatted']);
  for (const value of ['plain', 'formatted', 'tools', 'tools_formatted']) assert.equal(state.normalizeReplyFormat(value), value);
  assert.equal(state.normalizeReplyFormat('tools', { toolFallbackFormatted: true }), 'tools_formatted', '旧的「退回时用格式化输出」勾选');
  assert.equal(state.normalizeReplyFormat('plain', { toolFallbackFormatted: true }), 'plain');
  assert.equal(state.normalizeReplyFormat(undefined), 'formatted');
  assert.equal(state.normalizeReplyFormat('json'), 'formatted');
  assert.equal(state.normalizeReplyFormat(undefined, { formattedOutputV4: false }), 'plain');
  assert.equal(state.normalizeReplyFormat(undefined, { formattedOutputV4: true }), 'formatted');
  assert.equal(state.normalizeReplyFormat(undefined, { nativeToolCalls: true }), 'tools');
  assert.equal(state.normalizeReplyFormat('plain', { nativeToolCalls: true }), 'plain', '已有回复格式时不看旧设定');
  assert.equal(state.DEFAULT_SETTINGS.replyFormat, 'formatted');
});

test('读设定时把旧开关迁移成回复格式，并删掉旧键', () => {
  const cases = [
    [{ formattedOutputV4: false }, 'plain'],
    [{ formattedOutputV4: true }, 'formatted'],
    [{ nativeToolCalls: true }, 'tools'],
    [{ replyFormat: 'tools', toolFallbackFormatted: true }, 'tools_formatted'],
    [{ replyFormat: 'tools', toolFallbackFormatted: false }, 'tools'],
    [{}, 'formatted'],
  ];
  for (const [legacy, expected] of cases) {
    const ctx = { chatId: 'reply-format-migrate', extensionSettings: { bs_biotracker: { ...legacy, chatStates: {} } }, saveSettingsDebounced() {} };
    const settings = state.getSettings(ctx);
    assert.equal(settings.replyFormat, expected, JSON.stringify(legacy));
    assert.equal('formattedOutputV4' in settings, false);
    assert.equal('nativeToolCalls' in settings, false);
    assert.equal('toolFallbackFormatted' in settings, false);
  }
});

test('API 配置组保存回复格式；旧配置组按旧的格式化输出开关迁移', () => {
  const [legacyOff, legacyOn, current] = state.normalizeApiProfiles([
    { name: '旧关', apiUrl: 'a', formattedOutputV4: false },
    { name: '旧开', apiUrl: 'b', formattedOutputV4: true },
    { name: '新', apiUrl: 'c', replyFormat: 'tools' },
  ]);
  assert.equal(legacyOff.replyFormat, 'plain');
  assert.equal(legacyOn.replyFormat, 'formatted');
  assert.equal(current.replyFormat, 'tools');
  assert.equal('formattedOutputV4' in legacyOff, false);
});

test('格式化输出的闸门：只有选格式化输出才带 response_format；DeepSeek 系另注入结构指令', () => {
  assert.equal(isDeepSeekFamilyModel('deepseek-chat'), true);
  assert.equal(isDeepSeekFamilyModel('DeepSeek-R1'), true);
  assert.equal(isDeepSeekFamilyModel('ds-chat'), false, 'ds 子串不应命中');
  assert.equal(isDeepSeekFamilyModel('gpt-4o-mini'), false);

  assert.equal(shouldUseResponseFormat({}), true, '默认格式化输出');
  assert.equal(shouldUseResponseFormat({ replyFormat: 'formatted' }), true);
  assert.equal(shouldUseResponseFormat({ replyFormat: 'plain' }), false);
  assert.equal(shouldUseResponseFormat({ replyFormat: 'tools' }), false);
  assert.equal(shouldUseResponseFormat({ replyFormat: 'tools_formatted' }), true, '退回格式化输出：不带工具的请求附加');
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }), false, '旧设定照样认');
  assert.equal(shouldInjectV4Instruction({}, 'deepseek-chat'), true);
  assert.equal(shouldInjectV4Instruction({}, 'gpt-4o-mini'), false);
  assert.equal(shouldInjectV4Instruction({ replyFormat: 'plain' }, 'deepseek-chat'), false);
  assert.equal(shouldInjectV4Instruction({ replyFormat: 'tools' }, 'deepseek-chat'), false);
});

// ---- 请求 ----

test('格式化输出：主请求与「请只输出 JSON」纠错请求都带 response_format；DeepSeek 只在追踪注入结构指令', async () => {
  const calls = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: '不是 JSON' } }] }),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted', model: 'deepseek-chat' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.equal(call.body.tools, undefined);
  }
  assert.match(calls[0].body.messages[0].content, /【输出格式（强制）】/);

  const registry = installDirectFetch([jsonResponse(textJsonResponse({ name: '艾拉' }))]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted', model: 'deepseek-chat' }, { target_character: '艾拉' }, 'SYSTEM', { flow: 'registry' });
  assert.deepEqual(registry[0].body.response_format, { type: 'json_object' });
  assert.equal(registry[0].body.messages[0].content, 'SYSTEM', '其他流程各有自己的 JSON 结构，不注入追踪的结构指令');

  const other = installDirectFetch([jsonResponse(textJsonResponse({ tool_calls: [] }))]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(other[0].body.messages[0].content, 'SYSTEM', '非 DeepSeek 模型不注入');
});

test('格式化输出：上游回 400 时去掉 response_format 再送一次', async () => {
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'response_format is not supported' } }, 400),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  const result = await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted' }, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.deepEqual(result, { tool_calls: [] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.equal(calls[1].body.response_format, undefined);
});

test('格式化输出：Responses 直连写成 text.format', async () => {
  const calls = installDirectFetch([jsonResponse({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"tool_calls":[]}' }] }] })]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted', apiFormat: 'openai_responses' }, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.deepEqual(calls[0].body.text, { format: { type: 'json_object' } });
});

test('原生聊天消息：不带 response_format、不带 tools，DeepSeek 也不注入结构指令', async () => {
  const calls = installDirectFetch([jsonResponse(textJsonResponse({ tool_calls: [] }))]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'plain', model: 'deepseek-chat' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[0].body.tools, undefined);
  assert.equal(calls[0].body.messages[0].content, 'SYSTEM');

  const responses = installDirectFetch([jsonResponse({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"tool_calls":[]}' }] }] })]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'plain', apiFormat: 'openai_responses' }, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(responses[0].body.text, undefined);
});

test('工具调用：有工具的流程带 tools；没有工具的流程与退回的文本请求都按原生聊天消息发', async () => {
  const tracker = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: '没什么要更新的。' } }] }),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'tools', model: 'deepseek-chat' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(tracker.length, 2);
  assert.ok(tracker[0].body.tools);
  assert.equal(tracker[0].body.response_format, undefined);
  assert.equal(tracker[1].body.tools, undefined);
  assert.equal(tracker[1].body.response_format, undefined, '退回的文本请求不带 response_format');
  assert.equal(tracker[1].body.messages[0].content, 'SYSTEM', '也不注入格式化输出的结构指令');

  const registry = installDirectFetch([jsonResponse(textJsonResponse({ name: '艾拉' }))]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'tools' }, { target_character: '艾拉' }, 'SYSTEM', { flow: 'registry' });
  assert.equal(registry[0].body.tools, undefined);
  assert.equal(registry[0].body.response_format, undefined);
});

// ---- 工具调用退回格式化输出 ----

test('工具调用退回格式化输出：带工具的请求不带 response_format，退回的文本请求与没有工具的流程带上', async () => {
  const settings = { ...SETTINGS, replyFormat: 'tools_formatted' };

  const tracker = installDirectFetch([
    jsonResponse({ choices: [{ message: { content: '没什么要更新的。' } }] }),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.equal(tracker.length, 2);
  assert.ok(tracker[0].body.tools);
  assert.equal(tracker[0].body.response_format, undefined, '带工具的请求不加 response_format');
  assert.equal(tracker[1].body.tools, undefined);
  assert.deepEqual(tracker[1].body.response_format, { type: 'json_object' });

  const registry = installDirectFetch([jsonResponse(textJsonResponse({ name: '艾拉' }))]);
  await callOpenAICompatible(settings, { target_character: '艾拉' }, 'SYSTEM', { flow: 'registry' });
  assert.deepEqual(registry[0].body.response_format, { type: 'json_object' });
});

test('API 配置组保存两种工具调用；旧的「退回时用格式化输出」勾选迁移成退回格式化输出', () => {
  const [noFallback, fallback, legacy] = state.normalizeApiProfiles([
    { name: '甲', apiUrl: 'a', replyFormat: 'tools' },
    { name: '乙', apiUrl: 'b', replyFormat: 'tools_formatted' },
    { name: '丙', apiUrl: 'c', replyFormat: 'tools', toolFallbackFormatted: true },
  ]);
  assert.equal(noFallback.replyFormat, 'tools');
  assert.equal(fallback.replyFormat, 'tools_formatted');
  assert.equal(legacy.replyFormat, 'tools_formatted');
  assert.equal('toolFallbackFormatted' in legacy, false);
  assert.equal('toolFallbackFormatted' in state.DEFAULT_SETTINGS, false);
});

test('工具调用退回格式化输出也会先试工具：追踪、备装、起始着衣照样带 tools', async () => {
  assert.equal(state.usesNativeToolCalls('tools'), true);
  assert.equal(state.usesNativeToolCalls('tools_formatted'), true);
  assert.equal(state.usesNativeToolCalls('formatted'), false);
  assert.equal(state.usesNativeToolCalls('plain'), false);
  const calls = installDirectFetch([jsonResponse({ choices: [{ message: { tool_calls: [
    { id: 'c1', type: 'function', function: { name: 'bsReportCharacterChecks', arguments: '{"checks":[]}' } },
  ] } }] })]);
  const result = await callOpenAICompatible({ ...SETTINGS, replyFormat: 'tools_formatted' }, trackerPayload(), 'SYSTEM', { flow: 'tracker', nativeTools: true });
  assert.deepEqual(result, { tool_calls: [], character_checks: [] });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].body.tools);
  assert.equal(calls[0].body.response_format, undefined);
});

// ---- 格式化输出被拒：退回原生聊天消息并记住 ----

const RESPONSES_TEXT_REPLY = { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"tool_calls":[]}' }] }] };

test('格式化输出被 400 拒绝、只拿掉 response_format 就成功：本次会话里这个模型不再带', async () => {
  const settings = { ...SETTINGS, replyFormat: 'formatted', reasoningEffort: 'high' };
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'response_format is not supported' } }, 400),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.equal(calls[1].body.response_format, undefined);
  assert.equal(calls[1].body.reasoning_effort, 'high', '只拿掉 response_format，其他参数不动');

  const again = installDirectFetch([jsonResponse(textJsonResponse({ name: '艾拉' }))]);
  await callOpenAICompatible(settings, { target_character: '艾拉' }, 'SYSTEM', { flow: 'registry' });
  assert.equal(again.length, 1);
  assert.equal(again[0].body.response_format, undefined, '同一个模型的其他流程也不再带');

  const otherModel = installDirectFetch([jsonResponse(textJsonResponse({ tool_calls: [] }))]);
  await callOpenAICompatible({ ...settings, model: 'other-model' }, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.deepEqual(otherModel[0].body.response_format, { type: 'json_object' }, '换了模型照样带');
});

test('拿掉 response_format 仍是 400：照旧版连同其他采样参数一起拿掉再试，不记住', async () => {
  const settings = { ...SETTINGS, replyFormat: 'formatted', reasoningEffort: 'high' };
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'unknown parameter' } }, 400),
    jsonResponse({ error: { message: 'unknown parameter' } }, 400),
    jsonResponse(textJsonResponse({ tool_calls: [] })),
  ]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.reasoning_effort, 'high');
  assert.equal(calls[2].body.response_format, undefined);
  assert.equal(calls[2].body.reasoning_effort, undefined, '第二次退回只留基本采样参数');
  assert.equal(__responseFormatRejectedForTest.size, 0, '不能断定是 response_format 的问题');

  const again = installDirectFetch([jsonResponse(textJsonResponse({ tool_calls: [] }))]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.deepEqual(again[0].body.response_format, { type: 'json_object' });
});

test('格式化输出：Responses 直连的 text.format 被 400 拒绝也退回并记住', async () => {
  const settings = { ...SETTINGS, replyFormat: 'formatted', apiFormat: 'openai_responses' };
  const calls = installDirectFetch([
    jsonResponse({ error: { message: "Unsupported parameter: 'text.format'" } }, 400),
    jsonResponse(RESPONSES_TEXT_REPLY),
  ]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.text, { format: { type: 'json_object' } });
  assert.equal(calls[1].body.text, undefined);

  const again = installDirectFetch([jsonResponse(RESPONSES_TEXT_REPLY)]);
  await callOpenAICompatible(settings, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(again[0].body.text, undefined);
});

test('没真的送出 response_format 的格式（Claude Messages）：400 照常报错重试，不当成格式化输出被拒', async () => {
  const calls = installDirectFetch([
    jsonResponse({ error: { message: 'overloaded' } }, 400),
    jsonResponse({ content: [{ type: 'text', text: '{"tool_calls":[]}' }] }),
  ]);
  await callOpenAICompatible({ ...SETTINGS, replyFormat: 'formatted', apiFormat: 'claude_messages' }, trackerPayload(), 'SYSTEM', { flow: 'tracker' });
  assert.equal(calls.length, 2);
  assert.equal(__responseFormatRejectedForTest.size, 0);
});
