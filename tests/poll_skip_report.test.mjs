// 轮询跳过原因显形：自动独有的静默早退必须在面板留下原因，
// 否则“自动不可用、手动可用”时无从定位。状态是模块级暂态，
// 不改写最后一次真实追踪结果；同聊天＋同原因＋同文案＋同来源才去重。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import {
  __pollWaitByChatForTest,
  clearPollWaitStatus,
  getPollWaitStatus,
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
  __pollWaitByChatForTest.clear();
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

test('recordPollSkip 首报写入暂态，不动最后一次真实结果', () => {
  const { ctx, settings } = makeCtx();
  const { deps, renders } = makeDeps();
  const chatState = state.getChatState(ctx, settings);
  chatState.lastRawResult = { message: '真实追踪结果', tool_calls: [{ name: 'bsSetCharacterPresence' }] };
  chatState.lastOperationLogs = [{ name: 'bsSetCharacterPresence', applied: true }];

  const first = recordPollSkip(ctx, deps, 'no_pending_history', '没有新的可追踪内容，自动追踪待命中。');
  assert.deepEqual(first, { skipped: true, reason: 'no_pending_history' });
  assert.equal(getPollWaitStatus(ctx)?.message, '没有新的可追踪内容，自动追踪待命中。');
  assert.equal(chatState.lastRawResult.message, '真实追踪结果', '待命提示不得冲掉真实结果');
  assert.equal(chatState.lastOperationLogs.length, 1, '执行日志不得被清空');
  assert.equal(renders.length, 1);

  const second = recordPollSkip(ctx, deps, 'no_pending_history', '没有新的可追踪内容，自动追踪待命中。');
  assert.deepEqual(second, { skipped: true, reason: 'no_pending_history' });
  assert.equal(renders.length, 1, '同聊天同原因同文案不重复渲染');
});

test('recordPollSkip 文案或来源变化时刷新（同原因也刷新）', () => {
  const { ctx } = makeCtx();
  const { deps, renders } = makeDeps();

  recordPollSkip(ctx, deps, 'host_generation_in_flight', '宿主生成事件未闭合（1 层），自动追踪等待中。', { source: 'depth' });
  assert.equal(renders.length, 1);
  // 同原因、层数变化 → 文案变化，必须刷新
  recordPollSkip(ctx, deps, 'host_generation_in_flight', '宿主生成事件未闭合（2 层），自动追踪等待中。', { source: 'depth' });
  assert.equal(renders.length, 2);
  assert.match(getPollWaitStatus(ctx)?.message || '', /2 层/);
  // 同原因同文案、来源切换（事件计数→停止按钮）→ 必须刷新
  recordPollSkip(ctx, deps, 'host_generation_in_flight', '宿主生成事件未闭合（2 层），自动追踪等待中。', { source: 'dataset' });
  assert.equal(renders.length, 3);

  const other = makeCtx('skip-report-other-chat');
  recordPollSkip(other.ctx, deps, 'host_generation_in_flight', '宿主生成事件未闭合（2 层），自动追踪等待中。', { source: 'depth' });
  assert.equal(renders.length, 4, '换聊天重新写');
});

test('runTracker 宿主忙碌时面板留下原因（事件计数一路），不动真实结果', async () => {
  const { ctx, settings } = makeCtx();
  const { deps } = makeDeps();
  const chatState = state.getChatState(ctx, settings);
  chatState.lastRawResult = { message: '真实追踪结果', tool_calls: [] };
  ctx.eventSource.emit('generation_started');
  assert.equal(__hostRunStateForTest.generationDepth, 1);

  const outcome = await runTracker(ctx, deps, 'poll');
  assert.deepEqual(outcome, { skipped: true, reason: 'host_generation_in_flight' });
  assert.equal(getPollWaitStatus(ctx)?.message, '宿主生成事件未闭合（1 层），自动追踪等待中。');
  assert.equal(getPollWaitStatus(ctx)?.source, 'depth');
  assert.equal(chatState.lastRawResult.message, '真实追踪结果');
});

test('runTracker 宿主忙碌时面板留下原因（停止按钮旗标一路）', async () => {
  const { ctx } = makeCtx();
  const { deps } = makeDeps();
  globalThis.document = { body: { dataset: { generating: 'true' } } };
  try {
    const outcome = await runTracker(ctx, deps, 'poll');
    assert.deepEqual(outcome, { skipped: true, reason: 'host_generation_in_flight' });
    assert.equal(getPollWaitStatus(ctx)?.message, '宿主仍在生成中（停止按钮未释放），自动追踪等待中。');
    assert.equal(getPollWaitStatus(ctx)?.source, 'dataset');
  } finally {
    delete globalThis.document;
  }
});

test('poll 未启用时面板留下原因，不动真实结果', async () => {
  const { ctx, settings } = makeCtx();
  settings.enabled = false;
  const { deps } = makeDeps();
  const chatState = state.getChatState(ctx, settings);
  chatState.lastRawResult = { message: '真实追踪结果', tool_calls: [] };

  const outcome = await poll(ctx, deps);
  assert.deepEqual(outcome, { skipped: true, reason: 'disabled' });
  assert.equal(getPollWaitStatus(ctx)?.message, '自动追踪未启用（在设置中开启后生效）。');
  assert.equal(chatState.lastRawResult.message, '真实追踪结果');
});

test('clearPollWaitStatus 清掉暂态提示（真实开跑后调用）', () => {
  const { ctx } = makeCtx();
  const { deps } = makeDeps();
  recordPollSkip(ctx, deps, 'no_pending_history', '没有新的可追踪内容，自动追踪待命中。');
  assert.ok(getPollWaitStatus(ctx));
  clearPollWaitStatus(ctx);
  assert.equal(getPollWaitStatus(ctx), null);
});

test('早退改写 lastRawResult 时旧待命提示一并清除', async () => {
  const { ctx, settings } = makeCtx();
  const { deps } = makeDeps();
  recordPollSkip(ctx, deps, 'host_generation_in_flight', '宿主生成事件未闭合（1 层），自动追踪等待中。', { source: 'depth' });
  assert.ok(getPollWaitStatus(ctx));
  ctx.chat = [];
  const outcome = await runTracker(ctx, deps, 'poll');
  assert.deepEqual(outcome, { skipped: true, reason: 'empty_chat' });
  const chatState = state.getChatState(ctx, settings);
  assert.equal(chatState.lastRawResult.message, '当前对话没有可分析的消息，已跳过追踪。');
  assert.equal(getPollWaitStatus(ctx), null, '旧等待行不得压在新结果上');
});

test('暂态按聊天隔离，只保留最近若干个', () => {
  const { deps } = makeDeps();
  // 直接用最小 ctx：makeCtx 自带 resetGates 会清空 Map，不适合测淘汰
  const first = { chatId: 'skip-report-evict-first' };
  recordPollSkip(first, deps, 'no_pending_history', '待命。');
  for (let i = 0; i < 60; i += 1) {
    recordPollSkip({ chatId: `skip-report-evict-${i}` }, deps, 'no_pending_history', '待命。');
  }
  assert.ok(__pollWaitByChatForTest.size <= 50, `实际 ${__pollWaitByChatForTest.size}`);
  assert.equal(getPollWaitStatus(first), null, '最早的聊天先被淘汰');
});

test('dry-run 的 generation_started 不计入忙碌（宿主只发 STARTED 不发 ENDED）', async () => {
  const { ctx } = makeCtx();
  const { deps } = makeDeps();
  // 两家宿主的 dry-run（token 计数）都带 dryRun=true 尾参，且从不显示停止按钮，
  // hideStopButton 的 NOOP 守卫会吞掉 ENDED；计入就等于卡到 600 秒自愈
  ctx.eventSource.emit('generation_started', 'quiet', { quiet_prompt: '计数' }, true);
  assert.equal(__hostRunStateForTest.generationDepth, 0, 'dry-run 不得计数');
  ctx.eventSource.emit('generation_started', 'quiet', { quiet_prompt: '计数' }, true);
  assert.equal(__hostRunStateForTest.generationDepth, 0, '多次 dry-run 也不得累积');

  const outcome = await runTracker(ctx, deps, 'poll');
  assert.notEqual(outcome?.reason, 'host_generation_in_flight', 'dry-run 不得挡住自动追踪');
});

test('dry-run 之后真生成仍照常计数', async () => {
  const { ctx } = makeCtx();
  const { deps } = makeDeps();
  ctx.eventSource.emit('generation_started', 'quiet', {}, true);
  assert.equal(__hostRunStateForTest.generationDepth, 0);
  ctx.eventSource.emit('generation_started', 'normal', {});
  assert.equal(__hostRunStateForTest.generationDepth, 1);

  const outcome = await runTracker(ctx, deps, 'poll');
  assert.deepEqual(outcome, { skipped: true, reason: 'host_generation_in_flight' });
});
