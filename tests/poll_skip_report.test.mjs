// 轮询跳过原因显形：自动独有的静默早退必须在面板留下原因，
// 否则“自动不可用、手动可用”时无从定位。只在原因变化时写一次。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import {
  __pollSkipReportForTest,
  poll,
  recordPollSkip,
  runTracker,
  installHostRunWatchers,
  __hostRunStateForTest,
  __mvuGateStateForTest,
} from '../scripts/tracker.js';

function makeFakeEventBus() {
  const handlers = new Map();
  return {
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    emit(name, ...args) {
      (handlers.get(name) || []).forEach((handler) => handler(...args));
    },
  };
}

function resetGates(ctx) {
  const run = __hostRunStateForTest;
  run.listenersInstalled = false;
  run.generationDepth = 0;
  run.generationBusySince = 0;
  run.mutSeq = 0;
  run.ctxRef = null;
  const gate = __mvuGateStateForTest;
  gate.lastEndedKey = '';
  gate.lastEndedContentKey = '';
  gate.lastEndedAt = 0;
  gate.pendingKey = '';
  gate.pendingContentKey = '';
  gate.pendingSince = 0;
  gate.generateInFlight = 0;
  gate.lastGenerateStartedAt = 0;
  gate.sawGenerateThisRound = false;
  gate.everSawMvuSignal = false;
  __pollSkipReportForTest.chatKey = '';
  __pollSkipReportForTest.reason = '';
  delete globalThis.Mvu;
  delete globalThis.document;
  if (ctx?.eventSource) installHostRunWatchers(ctx);
}

function makeCtx(chatId = 'skip-report-chat') {
  const ctx = {
    chatId,
    chat: [{ is_user: false, name: 'Alice', mes: 'previous reply', swipe_id: 0 }],
    extensionSettings: {},
    saveSettingsDebounced() {},
    eventSource: makeFakeEventBus(),
    eventTypes: {
      GENERATION_STARTED: 'generation_started',
      GENERATION_STOPPED: 'generation_stopped',
      GENERATION_ENDED: 'generation_ended',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_UPDATED: 'message_updated',
    },
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.enabled = true;
  settings.triggerTiming = 'after_ai';
  state.getChatState(ctx, settings).characters['艾拉'] = {
    name: '艾拉', initialized: true, profile: { base: {} },
  };
  resetGates(ctx);
  return { ctx, settings };
}

function makeDeps() {
  const renders = [];
  return { deps: { renderStatusPanel() { renders.push(1); }, updateMainFlowPrompt() {} }, renders };
}

test('recordPollSkip 首报写入面板，同原因重复不再写', () => {
  const { ctx, settings } = makeCtx();
  const { deps, renders } = makeDeps();
  const chatState = state.getChatState(ctx, settings);

  const first = recordPollSkip(ctx, chatState, deps, 'no_pending_history', '没有新的可追踪内容，自动追踪待命中。');
  assert.deepEqual(first, { skipped: true, reason: 'no_pending_history' });
  assert.equal(chatState.lastRawResult.message, '没有新的可追踪内容，自动追踪待命中。');
  assert.equal(renders.length, 1);

  const second = recordPollSkip(ctx, chatState, deps, 'no_pending_history', '没有新的可追踪内容，自动追踪待命中。');
  assert.deepEqual(second, { skipped: true, reason: 'no_pending_history' });
  assert.equal(renders.length, 1, '同聊天同原因不重复写');
});

test('recordPollSkip 原因变化或换聊天时重新写', () => {
  const { ctx, settings } = makeCtx();
  const { deps, renders } = makeDeps();
  const chatState = state.getChatState(ctx, settings);

  recordPollSkip(ctx, chatState, deps, 'message_not_settled', '等待 AI 正文稳定后再追踪。');
  assert.equal(renders.length, 1);
  recordPollSkip(ctx, chatState, deps, 'host_generation_in_flight', '宿主仍在生成中，自动追踪等待中。');
  assert.equal(renders.length, 2);
  assert.equal(chatState.lastRawResult.message, '宿主仍在生成中，自动追踪等待中。');

  const other = makeCtx('skip-report-other-chat');
  const otherState = state.getChatState(other.ctx, other.settings);
  recordPollSkip(other.ctx, otherState, deps, 'host_generation_in_flight', '宿主仍在生成中，自动追踪等待中。');
  assert.equal(renders.length, 3, '换聊天重新写');
});

test('runTracker 宿主忙碌时面板留下原因', async () => {
  const { ctx } = makeCtx();
  const { deps } = makeDeps();
  ctx.eventSource.emit('generation_started');
  assert.equal(__hostRunStateForTest.generationDepth, 1);

  const outcome = await runTracker(ctx, deps, 'poll');
  assert.deepEqual(outcome, { skipped: true, reason: 'host_generation_in_flight' });
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  assert.equal(chatState.lastRawResult.message, '宿主仍在生成中，自动追踪等待中。');
});

test('poll 未启用时面板留下原因', async () => {
  const { ctx, settings } = makeCtx();
  settings.enabled = false;
  const { deps } = makeDeps();

  const outcome = await poll(ctx, deps);
  assert.deepEqual(outcome, { skipped: true, reason: 'disabled' });
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  assert.equal(chatState.lastRawResult.message, '自动追踪未启用（在设置中开启后生效）。');
});
