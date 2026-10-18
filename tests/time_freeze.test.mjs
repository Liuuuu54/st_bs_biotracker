// 时间推进开关：关掉就冻结整条时间轴——追踪模型看不到也用不了 bsPassedTime，其余工具照常；
// 回忆、梦境不结算，时间线穿越不推进时间。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, applyToolCallsResult } from '../scripts/tools.js';
import { getTrackerToolDefinitions } from '../scripts/tracker.js';
import { buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';

function setup(timeFlowEnabled) {
  const ctx = { chatId: 'time-freeze', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.timeFlowEnabled = timeFlowEnabled;
  const chatState = state.getChatState(ctx, settings);
  const female = state.createDefaultFemaleState('甲');
  female.initialized = true;
  female.profile.base.age = 24;
  chatState.characters['甲'] = female;
  return { ctx, settings, chatState };
}

test('时间推进预设开着，追踪模型拿得到 bsPassedTime', () => {
  const { settings } = setup(undefined);
  assert.equal(state.getSettings({ extensionSettings: {}, saveSettingsDebounced() {} }).timeFlowEnabled, true);
  assert.ok(getTrackerToolDefinitions(settings, {}).some((tool) => tool.name === 'bsPassedTime'));
});

test('冻结时追踪模型看不到 bsPassedTime；照叫也被忽略，其余工具照常', () => {
  const { ctx, settings } = setup(false);
  assert.ok(!getTrackerToolDefinitions(settings, {}).some((tool) => tool.name === 'bsPassedTime'));
  applyToolCallsResult(ctx, { tool_calls: [
    { name: 'bsPassedTime', arguments: { day: 3 } },
    { name: 'bsUpdateCharacterStatus', arguments: { female: '甲', libido: 40 } },
  ] }, 'frozen');
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  const [time, status] = chatState.lastOperationLogs;
  assert.equal(time.applied, false);
  assert.match(time.message, /冻结/);
  assert.equal(Number(chatState.minutesPassed) || 0, 0, '时间没有前进');
  assert.equal(status.applied, true, JSON.stringify(status));
});

test('冻结不挡使用者手动推进', () => {
  const { chatState } = setup(false);
  const result = applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.equal(result.applied, true);
  assert.equal(chatState.minutesPassed, 1440);
});

test('追踪提示：冻结时换成冻结说明；平常有穿越不推进的规则；回忆梦境不结算两边都有', () => {
  const frozen = buildTrackerSystemPrompt('', null, { time_frozen: true });
  assert.match(frozen, /\[时间已冻结\]/);
  assert.doesNotMatch(frozen, /\[bsPassedTime 强制规则\]/);
  const normal = buildTrackerSystemPrompt('', null, {});
  assert.match(normal, /\[bsPassedTime 强制规则\]/);
  assert.match(normal, /时间线穿越/);
  for (const prompt of [frozen, normal]) assert.match(prompt, /回忆、倒叙、梦境/);
});
