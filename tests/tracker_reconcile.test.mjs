// 回归测试：分析途中删除／改写讯息时的对账行为。
// 实测情境：新一楼正在分析时把该楼删掉 → 结果被套用到已删除的楼，
// 之后「立即分析」卡住，且超时后轮询无限重发。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { isFailedAutoRetryBlocked, runTracker } from '../scripts/tracker.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
});

function makeCtx(messages) {
  return {
    chatId: 'reconcile-chat',
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

test('auto retry is blocked while the conversation is unchanged, even if an inner message failed', () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first' },
    { is_user: false, name: 'Alice', mes: 'second' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();

  // 失败发生在「中间那一楼」——旧版只比对尾楼签名，于是永远挡不住，轮询无限重发
  chatState.lastFailedSignature = state.buildSignature(ctx, 1);
  chatState.lastFailedChatSignature = state.buildSignature(ctx, ctx.chat.length);
  assert.equal(isFailedAutoRetryBlocked(ctx, chatState), true, '对话没变就不该自动重试');

  // 对话一有变动就恢复自动重试
  ctx.chat.push({ is_user: false, name: 'Alice', mes: 'third' });
  assert.equal(isFailedAutoRetryBlocked(ctx, chatState), false);
});

test('legacy chat states without the chat signature keep the old tail behaviour', () => {
  const ctx = makeCtx([{ is_user: false, name: 'Alice', mes: 'only' }]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  chatState.lastFailedChatSignature = '';
  chatState.lastFailedSignature = state.buildSignature(ctx, ctx.chat.length);
  assert.equal(isFailedAutoRetryBlocked(ctx, chatState), true);
});

test('a result whose message was deleted mid-request is discarded instead of applied', async () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'kept message' },
    { is_user: false, name: 'Alice', mes: 'doomed message' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {} } };
  const snapshotsBefore = chatState.snapshots.length;

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    // 请求往返途中使用者删掉了正在分析的那一楼
    ctx.chat.splice(1, 1);
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }],
    });
  };

  const result = await runTracker(ctx, makeDeps(), 'manual');

  assert.equal(requests, 1);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'message_changed_during_run');
  // 结果作废：不得写入已删除那楼的处理进度，也不得留下与聊天对不起来的快照
  assert.equal(chatState.lastProcessedSignature, '');
  assert.equal(chatState.snapshots.length, snapshotsBefore);
  assert.match(String(chatState.lastRawResult?.message || ''), /已作废/);
});

test('an untouched message still applies and records its snapshot normally', async () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'kept message' },
    { is_user: false, name: 'Alice', mes: 'stable message' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {} } };
  const snapshotsBefore = chatState.snapshots.length;

  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }],
  });

  const result = await runTracker(ctx, makeDeps(), 'manual');

  assert.equal(result.skipped, false);
  assert.equal(chatState.lastProcessedSignature, state.buildSignature(ctx, ctx.chat.length));
  assert.equal(chatState.snapshots.length > snapshotsBefore, true);
});

function makeLongChat(count) {
  return Array.from({ length: count }, (_, index) => ({
    is_user: false,
    name: 'Alice',
    mes: `message ${index}`,
  }));
}

/**
 * 轮询走 after_ai 时要先通过「AI 讯息已稳定」的判定：
 * 第一次呼叫只会记下待观察的签名，把时间戳往前拨即可视为已稳定。
 */
async function primeSettledPoll(ctx, chatState) {
  await runTracker(ctx, makeDeps(), 'poll');
  chatState.pendingAssistantUpdatedAt = Date.now() - 60000;
}

test('a long chat without snapshots replays a bounded window instead of every message', async () => {
  const ctx = makeCtx(makeLongChat(200));
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  settings.contextSize = 12;
  settings.triggerTiming = 'after_ai';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {} } };
  chatState.snapshots = [];

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
  };

  await primeSettledPoll(ctx, chatState);
  chatState.snapshots = [];
  requests = 0;
  await runTracker(ctx, makeDeps(), 'poll');

  // 旧版会从第 0 楼一路跑满 200 次请求，正是「卡半小时没动静」的成因
  assert.equal(requests > 0, true, '应该确实有分析发生');
  assert.equal(requests <= settings.contextSize, true, `回放应受上限约束，实际发出 ${requests} 次请求`);
});

test('a lost snapshot resumes from the last processed message rather than from zero', async () => {
  const ctx = makeCtx(makeLongChat(50));
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  settings.contextSize = 12;
  settings.triggerTiming = 'after_ai';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {} } };

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
  };

  await primeSettledPoll(ctx, chatState);
  // 快照没了，但我们知道上次处理到第 48 楼为止
  chatState.snapshots = [];
  chatState.lastProcessedSignature = state.buildSignature(ctx, 48);
  requests = 0;
  await runTracker(ctx, makeDeps(), 'poll');

  // 只需补跑第 48、49 两楼
  assert.equal(requests, 2, `应只补跑剩下的两楼，实际 ${requests} 次`);
});

test('a snapshot whose boundary message was replaced is no longer treated as matching', () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first' },
    { is_user: false, name: 'Alice', mes: 'original latest' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 2, reason: 'tracker' });
  assert.equal(state.getLatestMatchingSnapshot(ctx, chatState)?.messageCount, 2, '内容未变时应该匹配');

  // 使用者删掉最新一楼，之后又产生了新的一楼：长度恰好相同，但内容已经不是同一段对话
  ctx.chat[1] = { is_user: false, name: 'Alice', mes: 'different latest' };
  assert.equal(state.getLatestMatchingSnapshot(ctx, chatState), null, '边界讯息已改变，不该当成匹配');
});

test('legacy snapshots without a boundary signature still match on message count', () => {
  const ctx = makeCtx([{ is_user: false, name: 'Alice', mes: 'only' }]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 1, reason: 'tracker' });
  // 模拟旧存档：没有这个栏位
  delete chatState.snapshots[0].boundarySignature;
  ctx.chat[0] = { is_user: false, name: 'Alice', mes: 'rewritten' };
  assert.equal(state.getLatestMatchingSnapshot(ctx, chatState)?.messageCount, 1, '无从比对时应沿用旧行为');
});

test('an unloaded sparse-view boundary does not falsely invalidate a snapshot', () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first' },
    { is_user: false, name: 'Alice', mes: 'second' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 2, reason: 'tracker' });

  // TT 的稀疏视图：长度仍是 2，但该位置尚未载入
  const sparse = new Array(2);
  sparse[0] = ctx.chat[0];
  ctx.chat = sparse;
  assert.equal(state.getLatestMatchingSnapshot(ctx, chatState)?.messageCount, 2, '未载入不等于内容不同，不该误判失效');
});

test('boundary signatures survive snapshot repacking', () => {
  const ctx = makeCtx([{ is_user: false, name: 'Alice', mes: 'first' }]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  for (let index = 1; index <= 6; index += 1) {
    ctx.chat[index - 1] = { is_user: false, name: 'Alice', mes: `message ${index}` };
    state.recordChatStateSnapshot(ctx, chatState, { messageCount: index, reason: 'tracker' });
  }
  assert.equal(
    chatState.snapshots.every((snapshot) => String(snapshot.boundarySignature || '').length > 0),
    true,
    '重新打包后仍应保留边界签名',
  );
});

test('state checkpoints merge into message and current swipe extras', () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first', extra: { otherExtension: { keep: true } } },
    {
      is_user: false,
      name: 'Alice',
      mes: 'second',
      swipe_id: 1,
      swipe_info: [{ extra: { old: true } }, { extra: { swipeExtension: 'keep' } }],
    },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');

  const snapshot = state.recordChatStateSnapshot(ctx, chatState, { messageCount: 2, reason: 'tracker' });
  const checkpoint = ctx.chat[1].extra?.[state.CHAT_CHECKPOINT_KEY];
  assert.equal(checkpoint?.messageCount, 2);
  assert.deepEqual(ctx.chat[0].extra, { otherExtension: { keep: true } });
  assert.deepEqual(ctx.chat[1].swipe_info[1].extra.swipeExtension, 'keep');
  assert.deepEqual(ctx.chat[1].swipe_info[1].extra[state.CHAT_CHECKPOINT_KEY], checkpoint);
  assert.equal(snapshot.snapshotMode, 'full');
});

test('tail deletion restores the latest surviving floor checkpoint and drops deleted snapshots', () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first' },
    { is_user: false, name: 'Alice', mes: 'second' },
    { is_user: false, name: 'Alice', mes: 'deleted tail' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  chatState.characters.Alice.profile.base.days = 2;
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 2, reason: 'tracker' });
  chatState.characters.Alice.profile.base.days = 3;
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 3, reason: 'tracker' });

  ctx.chat.pop();
  assert.equal(state.reconcileMessageCheckpoints(ctx, chatState), true);
  const surviving = state.getLatestMatchingSnapshot(ctx, chatState);
  assert.equal(surviving?.messageCount, 2);
  state.restoreChatStateFromSnapshot(chatState, surviving);
  assert.equal(chatState.characters.Alice.profile.base.days, 2);
  assert.equal(chatState.snapshots.some((item) => item.messageCount > 2), false);
});

test('malformed floor checkpoint is ignored without replacing valid sidecar state', () => {
  const ctx = makeCtx([{ is_user: false, name: 'Alice', mes: 'only', extra: {
    [state.CHAT_CHECKPOINT_KEY]: { version: 1, messageCount: 1, snapshot: 'not-an-object' },
  } }]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  chatState.characters.Alice.profile.base.days = 7;
  assert.equal(state.reconcileMessageCheckpoints(ctx, chatState), false);
  assert.equal(chatState.characters.Alice.profile.base.days, 7);
  assert.equal(chatState.snapshots.length, 0);
});

test('manual analysis always sends the current tail even when it already has a snapshot', async () => {
  const ctx = makeCtx([
    { is_user: false, name: 'Alice', mes: 'first' },
    { is_user: false, name: 'Alice', mes: 'current tail' },
  ]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = {
    ...state.createDefaultFemaleState('艾拉'),
    initialized: true,
  };
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 2, reason: 'tracker' });

  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
  };

  const result = await runTracker(ctx, makeDeps(), 'manual');
  assert.deepEqual(result, { skipped: false, processedCount: 1, triggeredCount: 1, toolCalls: [] });
  assert.equal(requests, 1);
  assert.equal(result.skipped, false);
  assert.equal(result.triggeredCount, 1);
});

test('legacy operations with function-style calls apply a presence update', async () => {
  const ctx = makeCtx([{ is_user: false, name: 'Alice', mes: '艾拉回到队伍身边。' }]);
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  const chatState = state.getChatState(ctx, settings);
  chatState.characters['艾拉'] = {
    name: '艾拉', initialized: true, profile: { base: { isHere: false } },
  };

  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: JSON.stringify({
      character_checks: [{ female: '艾拉', status: 'present' }],
      operations: [{
        function: {
          name: 'bsSetCharacterPresence',
          arguments: JSON.stringify({ female: '艾拉', isPresent: true }),
        },
      }],
    }) } }],
  });

  await runTracker(ctx, makeDeps(), 'manual');
  assert.equal(chatState.characters['艾拉'].profile.base.isHere, true);
  assert.equal(chatState.lastOperationLogs[0]?.applied, true, chatState.lastOperationLogs[0]?.message);
  assert.equal(chatState.lastOperationLogs[0]?.name, 'bsSetCharacterPresence');
  assert.deepEqual(chatState.lastRawResult?.character_checks, [{ female: '艾拉', status: 'present' }]);
  assert.deepEqual(chatState.lastRawResult?.character_check_coverage?.missing, []);
});
