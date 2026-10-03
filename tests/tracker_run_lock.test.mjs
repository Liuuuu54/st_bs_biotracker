// 回归测试：请求挂起导致运行锁永久卡住时，看门狗必须放行后续分析。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { runTracker, RUN_RUNTIME_KEY, RUN_STARTED_AT_KEY } from '../scripts/tracker.js';
import { getChatState, getSettings } from '../scripts/state.js';

function makeCtx() {
  return {
    chatId: 'lock-chat',
    chat: [{ is_user: false, is_system: false, name: '角色', mes: '一段剧情。' }],
    extensionSettings: {},
    saveSettingsDebounced: () => {},
  };
}

function makeDeps() {
  return {
    renderStatusPanel: () => {},
    updateMainFlowPrompt: () => {},
  };
}

afterEach(() => {
  globalThis[RUN_RUNTIME_KEY] = null;
  globalThis[RUN_STARTED_AT_KEY] = 0;
});

test('a fresh run lock still blocks a second concurrent tracker run', async () => {
  globalThis[RUN_RUNTIME_KEY] = 'run-token';
  globalThis[RUN_STARTED_AT_KEY] = Date.now();

  const result = await runTracker(makeCtx(), makeDeps(), 'manual');

  assert.deepEqual(result, { skipped: true, reason: 'already_running' });
});

test('a run lock older than the timeout budget is released instead of blocking forever', async () => {
  globalThis[RUN_RUNTIME_KEY] = 'stuck-token';
  // 默认 180s 超时 + 120s 余量，取远超上限的时间点模拟挂死的请求
  globalThis[RUN_STARTED_AT_KEY] = Date.now() - 3600000;

  const result = await runTracker(makeCtx(), makeDeps(), 'manual');

  assert.notEqual(result.reason, 'already_running');
  assert.equal(result.reason, 'no_registered_targets');
});

test('a run lock with no recorded start time is treated as stale', async () => {
  globalThis[RUN_RUNTIME_KEY] = 'orphan-token';
  globalThis[RUN_STARTED_AT_KEY] = 0;

  const result = await runTracker(makeCtx(), makeDeps(), 'manual');

  assert.notEqual(result.reason, 'already_running');
});

test('a blocked poll or manual run keeps the previous run results for the next-turn prompt', async () => {
  const ctx = makeCtx();
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const logs = [{ name: 'bsAddSperm', applied: true, message: 'hasCondom=true, condomFailed=true' }];
  chatState.lastOperationLogs = logs;
  chatState.lastRawResult = { message: 'previous run', tool_calls: [] };
  globalThis[RUN_RUNTIME_KEY] = 'psychology-wait';
  globalThis[RUN_STARTED_AT_KEY] = Date.now();

  for (const reason of ['poll', 'manual']) {
    const result = await runTracker(ctx, makeDeps(), reason);
    assert.equal(result.reason, 'already_running');
    assert.deepEqual(getChatState(ctx, settings).lastOperationLogs, logs);
    assert.equal(getChatState(ctx, settings).lastRawResult.message, 'previous run');
  }
});
