// 回归测试：使用者回报「after_ai + 串流输出时，自己送出讯息也会触发一次追踪」。
// 触发时机不符的楼层只记一笔 skip 快照、不发任何请求，这轮必须全程静默。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { runTracker } from '../scripts/tracker.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
});

function makeCtx(messages) {
  return {
    chatId: 'toast-chat',
    chat: messages,
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
}

function makeDeps() {
  return { renderStatusPanel() {}, updateMainFlowPrompt() {} };
}

function jsonResponse(data) {
  return { ok: true, status: 200, async text() { return JSON.stringify(data); } };
}

/** 记录所有 toast 呼叫 */
function installToastrSpy() {
  const calls = [];
  globalThis.toastr = {
    info: (message) => { calls.push(['info', message]); return { id: calls.length }; },
    success: (message) => { calls.push(['success', message]); return { id: calls.length }; },
    error: (message) => { calls.push(['error', message]); return { id: calls.length }; },
    warning: (message) => { calls.push(['warning', message]); return { id: calls.length }; },
    clear: () => { calls.push(['clear', '']); },
  };
  return calls;
}

function setupChat(messages) {
  const ctx = makeCtx(messages);
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.enabled = true;
  settings.triggerTiming = 'after_ai';
  settings.apiUrl = 'https://example.invalid/v1';
  settings.apiKey = 'k';
  settings.model = 'test-model';
  // 没有已注册角色会在更早的闸门就返回（no_registered_targets），走不到追踪流程
  state.getChatState(ctx, settings).characters['艾拉'] = {
    name: '艾拉', initialized: true, profile: { base: {} },
  };
  return { ctx, settings };
}

test('after_ai：AI 那楼追踪完之后，使用者送出讯息不该再弹任何提示', async () => {
  const { ctx } = setupChat([{ is_user: false, name: 'Alice', mes: 'ai reply' }]);

  // 先让 AI 那楼正常走完一轮追踪，留下快照
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
  };
  await runTracker(ctx, makeDeps(), 'manual');
  assert.equal(requests, 1, 'AI 楼层应正常触发一次追踪');

  // 使用者接着送出讯息：这轮只该记一笔 skip 快照
  const calls = installToastrSpy();
  globalThis.fetch = async () => {
    throw new Error('after_ai 下不该为使用者讯息发出追踪请求');
  };
  ctx.chat.push({ is_user: true, name: 'User', mes: 'my input' });

  await runTracker(ctx, makeDeps(), 'poll');

  const shown = calls.filter(([kind]) => kind !== 'clear');
  assert.deepEqual(shown, [], `使用者送出讯息不该有任何提示，实际: ${JSON.stringify(shown)}`);
});

test('触发时机不符的楼层不计入实际触发数', async () => {
  const { ctx } = setupChat([{ is_user: false, name: 'Alice', mes: 'ai reply' }]);

  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }],
  });
  await runTracker(ctx, makeDeps(), 'manual');

  installToastrSpy();
  globalThis.fetch = async () => {
    throw new Error('不该发出请求');
  };
  ctx.chat.push({ is_user: true, name: 'User', mes: 'my input' });

  const result = await runTracker(ctx, makeDeps(), 'poll');
  if (result && result.skipped === false) {
    assert.equal(result.triggeredCount, 0, '不符触发时机的楼层不该计入实际触发');
  }
});

test('tracker request failures show an error toast instead of a completion toast', async () => {
  const { ctx } = setupChat([{ is_user: false, name: 'Alice', mes: 'ai reply' }]);
  const calls = installToastrSpy();
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async text() { return 'Forbidden'; },
  });

  await assert.rejects(
    runTracker(ctx, makeDeps(), 'manual'),
    /API 403/,
  );

  const shown = calls.filter(([kind]) => kind !== 'clear');
  assert.equal(shown.some(([kind, message]) => kind === 'success' && /追踪完成/.test(message)), false);
  assert.equal(shown.some(([kind, message]) => kind === 'error' && /API 403/.test(message)), true);
});
