// 回归测试：使用者回报「after_ai + 串流输出时，一轮发出两次追踪请求」。
//
// 宿主在串流开始时会先补一个空的助手楼层，内容要过一阵子才写进 mes。
// 空字串会「稳定」地空着，而串流守卫只比对内容有没有变化，于是撑过 settle
// 时间后被误判成已完成，对着空白楼层先发一次，串流真的写入后再发一次。
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

const AFTER_AI_SETTLE_MS = 1400;
const sleepPastSettle = () => new Promise((resolve) => { setTimeout(resolve, AFTER_AI_SETTLE_MS + 200); });

function makeDeps() {
  return { renderStatusPanel() {}, updateMainFlowPrompt() {} };
}

function setup() {
  const ctx = {
    chatId: 'streaming-chat',
    chat: [{ is_user: false, name: 'Alice', mes: 'previous reply' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.enabled = true;
  settings.triggerTiming = 'after_ai';
  settings.apiUrl = 'https://example.invalid/v1';
  settings.apiKey = 'k';
  settings.model = 'test-model';
  // 没有已注册角色会在更早的闸门就返回（no_registered_targets）
  state.getChatState(ctx, settings).characters['艾拉'] = {
    name: '艾拉', initialized: true, profile: { base: {} },
  };

  const state_ = { requests: 0 };
  globalThis.fetch = async () => {
    state_.requests += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
      },
    };
  };
  return { ctx, counter: state_ };
}

test('串流一轮只发出一次追踪请求，空白助手楼层不触发', async () => {
  const { ctx, counter } = setup();
  // 先把既有的 AI 楼层追踪完，留下快照
  await runTracker(ctx, makeDeps(), 'manual');
  counter.requests = 0;

  // 使用者送出讯息
  ctx.chat.push({ is_user: true, name: 'User', mes: 'my input' });
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '使用者楼层不该发请求');

  // 宿主补上空的助手楼层，内容还没写进来
  ctx.chat.push({ is_user: false, name: 'Alice', mes: '' });
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '空白助手楼层第一次轮询不该发请求');

  // 关键：空字串「稳定」地撑过 settle 时间，也不能被当成串流已完成
  await sleepPastSettle();
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '空白楼层撑过 settle 仍不该发请求');
  await sleepPastSettle();
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '空白楼层再等一轮仍不该发请求');

  // 串流结束，内容写入
  ctx.chat[2].mes = '真正的回覆内容';
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '内容刚变动时应重新计时，不该立刻发请求');

  await sleepPastSettle();
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 1, '内容稳定后应追踪一次');

  // 不该重发
  await sleepPastSettle();
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 1, `整轮只该发一次请求，实际 ${counter.requests} 次`);
});

test('内容为纯空白的助手楼层同样不触发', async () => {
  const { ctx, counter } = setup();
  await runTracker(ctx, makeDeps(), 'manual');
  counter.requests = 0;

  ctx.chat.push({ is_user: false, name: 'Alice', mes: '   \n  ' });
  await runTracker(ctx, makeDeps(), 'poll');
  await sleepPastSettle();
  await runTracker(ctx, makeDeps(), 'poll');
  assert.equal(counter.requests, 0, '纯空白内容不该触发追踪');
});
