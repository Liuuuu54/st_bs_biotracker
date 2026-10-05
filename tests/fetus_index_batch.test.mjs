// 同一批工具呼叫里，fetusIndex 依模型收到 payload 时的可见顺序解读：
// 前面的工具（减胎、时间推进的胎动换位）改变阵列后，后面的下标仍指向原本那一胎。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, applyToolCallsResult } from '../scripts/tools.js';

afterEach(() => { delete globalThis.SillyTavern; });

function setup() {
  const ctx = { chatId: 'fetus-index-batch', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  const f = state.createDefaultFemaleState('甲');
  f.initialized = true;
  f.profile.base.age = 24;
  chatState.characters['甲'] = f;
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 3, equivalentDays: 120 } });
  return { ctx, chatState };
}

test('a later fetusIndex in the same batch still points at the fetus the model saw', () => {
  const { ctx, chatState } = setup();
  const [a, b, c] = chatState.characters['甲'].profile.pregnant.fetuses.map((fetus) => fetus.embryoId);
  applyToolCallsResult(ctx, { tool_calls: [
    { name: 'bsAbortion', arguments: { female: '甲', purpose: 'termination', fetusIndex: 0 } },
    { name: 'bsAbortion', arguments: { female: '甲', purpose: 'termination', fetusIndex: 2 } },
  ] }, 'batch');
  const logs = state.getChatState(ctx, state.getSettings(ctx)).lastOperationLogs;
  assert.deepEqual(logs.map((log) => log.applied), [true, true], JSON.stringify(logs));
  const left = state.getChatState(ctx, state.getSettings(ctx)).characters['甲'].profile.pregnant.fetuses.map((fetus) => fetus.embryoId);
  assert.deepEqual(left, [b], `expected only the middle fetus to remain, not ${left} (a=${a}, c=${c})`);
});

test('an index whose fetus is already gone in this batch is refused instead of hitting another fetus', () => {
  const { ctx } = setup();
  applyToolCallsResult(ctx, { tool_calls: [
    { name: 'bsAbortion', arguments: { female: '甲', purpose: 'termination', fetusIndex: 1 } },
    { name: 'bsAbortion', arguments: { female: '甲', purpose: 'termination', fetusIndex: 1 } },
  ] }, 'batch-twice');
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  assert.deepEqual(chatState.lastOperationLogs.map((log) => log.applied), [true, false]);
  assert.equal(chatState.characters['甲'].profile.pregnant.fetuses.length, 2);
});
