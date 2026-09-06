// 正文替换静默吸收回归：数据库经 setChatMessages 改写尾楼并盖 `_acu_last_optimized_at`
// 时，追踪不得重发；没有该戳记的改写（手动编辑、其它静默写回者）一律照常追踪。
// 判据特意不用内存事件计数——页面重载会让计数归零、把编辑误吞（评审 F1）。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import {
  runTracker,
  installHostRunWatchers,
  __hostRunStateForTest,
  __mvuGateStateForTest,
} from '../scripts/tracker.js';
import { buildSignature } from '../scripts/state.js';

const ORIGINAL_FETCH = globalThis.fetch;
const AFTER_AI_SETTLE_MS = 1400;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sleepPastSettle = () => sleep(AFTER_AI_SETTLE_MS + 200);

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
  delete globalThis.document;
  delete globalThis.Mvu;
});

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

function resetAllGates(ctx) {
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
  gate.sawGenerateThisRound = false;
  gate.everSawMvuSignal = false;
  if (ctx?.eventSource) installHostRunWatchers(ctx);
}

/** 数据库正文替换的真实形状：覆写 mes + 在 extra 盖毫秒戳 */
function simulateReplacement(message, newText) {
  message.mes = newText;
  if (!message.extra || typeof message.extra !== 'object') message.extra = {};
  message.extra._acu_last_optimized_at = Date.now();
  message.extra._acu_original_content = message.extra._acu_original_content || newText;
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
    },
  };
}

function makeCtx() {
  const toasts = [];
  globalThis.toastr = {
    info: (msg, title) => { toasts.push(['info', msg, title]); },
    success: (msg, title) => { toasts.push(['success', msg, title]); },
    clear: () => {},
  };
  const ctx = {
    chatId: 'silent-replace-chat',
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
    },
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.enabled = true;
  settings.triggerTiming = 'after_ai';
  settings.apiUrl = 'https://example.invalid/v1';
  settings.apiKey = 'k';
  settings.model = 'test-model';
  state.getChatState(ctx, settings).characters['艾拉'] = {
    name: '艾拉', initialized: true, profile: { base: {} },
  };
  const counter = { requests: 0 };
  globalThis.fetch = async () => {
    counter.requests += 1;
    return okResponse();
  };
  resetAllGates(ctx);
  return { ctx, counter, toasts, settings };
}

const deps = { renderStatusPanel() {}, updateMainFlowPrompt() {} };

function chatStateOf(ctx) {
  return state.getChatState(ctx, state.getSettings(ctx));
}

async function trackOneReply(ctx) {
  ctx.chat.push({ is_user: true, name: 'User', mes: '继续' });
  await runTracker(ctx, deps, 'poll'); // 使用者楼层只记 skip 快照
  ctx.chat.push({ is_user: false, name: 'Alice', mes: '完整正文', swipe_id: 0 });
  await runTracker(ctx, deps, 'poll'); // 建立 settle 基线
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll'); // 触发真正的一次追踪
}

async function replaceTail(ctx, text) {
  await sleep(20); // 让替换戳记严格晚于回执时刻
  simulateReplacement(ctx.chat[ctx.chat.length - 1], text);
  await runTracker(ctx, deps, 'poll'); // settle 重新计时
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll'); // 吸收/重追踪发生在这里
}

test('带替换戳记的同楼层改写被静默吸收，不重发请求也不弹提示', async () => {
  const { ctx, counter, toasts } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1, '一轮回复先追踪一次');
  toasts.length = 0;

  await replaceTail(ctx, '完整正文（变量渲染后）');
  assert.equal(counter.requests, 1, '正文替换不得触发第二轮追踪');
  assert.equal(toasts.filter((t) => String(t[1]).includes('追踪')).length, 0, '吸收过程必须全程静默');

  const chatState = chatStateOf(ctx);
  const last = chatState.snapshots[chatState.snapshots.length - 1];
  assert.equal(last.reason, 'silent_replace');
  assert.equal(last.messageCount, 3);
  assert.equal(chatState.lastProcessedSignature, buildSignature(ctx, 3));

  // 第二轮替换写回（shujuku-rebuild 在 ended 后还会复跑一次）
  await replaceTail(ctx, '完整正文（变量渲染后 v2）');
  assert.equal(counter.requests, 1, '连续多次替换逐次静默吸收');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 1, '吸收后长期保持静默');
});

test('页面重载后也无事件计数的世界：无戳记的内容改动（手动编辑）照常追踪', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);

  // 手动编辑/任何不盖替换戳的改写——即使监听器全新装载（模拟重载）也必须重追踪
  await sleep(20);
  ctx.chat[2].mes = '使用者手改过的正文';
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '没有替换戳 => 不是正文替换 => 照常追踪');
});

test('swipe 变化（切抽卡）即便楼层带着旧替换戳也照常追踪', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);
  simulateReplacement(ctx.chat[2], '完整正文（第一轮替换）');
  ctx.chat[2].mes = '该楼的另一张抽卡结果';
  ctx.chat[2].swipe_id = 1;
  await sleep(20);
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, 'swipe 身份变化不能当作静默替换吸收');
});

test('请求在飞时替换落地（戳晚于发出）：沿用结果重锚，不作废重发', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  let releaseFetch;
  let holdNextFetch = true;
  globalThis.fetch = async () => {
    counter.requests += 1;
    if (holdNextFetch) {
      holdNextFetch = false;
      await new Promise((resolve) => { releaseFetch = resolve; });
    }
    return okResponse();
  };

  ctx.chat.push({ is_user: true, name: 'User', mes: '继续' });
  await runTracker(ctx, deps, 'poll');
  ctx.chat.push({ is_user: false, name: 'Alice', mes: '完整正文', swipe_id: 0 });
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  const runPromise = runTracker(ctx, deps, 'poll');
  await sleep(50); // 让 fetch 真正在飞

  await sleep(20);
  simulateReplacement(ctx.chat[2], '完整正文（变量渲染后）');
  releaseFetch();
  await runPromise;
  assert.equal(counter.requests, 1, '在飞期间的替换不该引发第二轮请求');
  const chatState = chatStateOf(ctx);
  assert.equal(chatState.lastProcessedSignature, buildSignature(ctx, 3), '要按替换后的新正文重新锚定');

  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 1, '重锚之后不再重复追踪');
});

test('请求在飞时发生无戳改写（手改/其它写回）：维持原作废逻辑', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  let releaseFetch;
  let holdNextFetch = true;
  globalThis.fetch = async () => {
    counter.requests += 1;
    if (holdNextFetch) {
      holdNextFetch = false;
      await new Promise((resolve) => { releaseFetch = resolve; });
    }
    return okResponse();
  };

  ctx.chat.push({ is_user: true, name: 'User', mes: '继续' });
  await runTracker(ctx, deps, 'poll');
  ctx.chat.push({ is_user: false, name: 'Alice', mes: '完整正文', swipe_id: 0 });
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  const runPromise = runTracker(ctx, deps, 'poll');
  await sleep(50);

  ctx.chat[2].mes = '使用者在分析期间手改了正文';
  releaseFetch();
  await runPromise;
  assert.equal(counter.requests, 1);
  // 作废路径：该楼从未处理成功，lastProcessedSignature 不能推进到改后签名
  const chatState = chatStateOf(ctx);
  assert.notEqual(chatState.lastProcessedSignature, buildSignature(ctx, 3));

  await runTracker(ctx, deps, 'poll'); // 下一轮重放，补上这次追踪
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '作废后照常补追');
});

test('旧存档快照没有锚点字段时维持现行为（带戳替换也照常重追）', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  const chatState = chatStateOf(ctx);
  const snap = chatState.snapshots[chatState.snapshots.length - 1];
  delete snap.anchorVersion;
  delete snap.tailMessageId;
  delete snap.tailSwipeId;
  delete snap.tailName;

  await sleep(20);
  simulateReplacement(ctx.chat[0], '被替换改写的旧楼正文（带戳）');
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 1, '没有锚点 => 不敢静默 => 维持原本的重追踪行为');
});

test('替换戳早于回执时间（历史残留）不吸收——防吃掉戳后合法改动', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);

  // 楼层带着很早以前的替换戳（例如插件开启前就被替换过）；之后正文被合法改动
  if (!ctx.chat[2].extra) ctx.chat[2].extra = {};
  ctx.chat[2].extra._acu_last_optimized_at = Date.now() - 60000;
  await sleep(20);
  ctx.chat[2].mes = '之后的合法改动';
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '戳早于回执 => 不能当作本轮替换吸收');
});

test('真机回归：无 id 楼层（ST/TT 实际形状）同样吸收；message_id 存在时参与比对', async () => {
  // 本文件所有消息刻意不带 id：ST/TT 落库的消息对象本来就没有 id 字段，
  // 曾经锚点以 id 为必要条件，导致真机上吸收永远不触发、替换后必多追一轮。
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);
  for (const floor of ctx.chat) assert.equal('id' in floor, false, '测试消息必须保持无 id 的真机形状');

  await replaceTail(ctx, '完整正文（变量渲染后）');
  assert.equal(counter.requests, 1, '无 id 楼层的替换必须被吸收');

  // 视图带 message_id 时：一致则吸收，不一致则拒绝（防删楼后复用同位置）
  await replaceTail(ctx, '完整正文（变量渲染后 v2）');
  assert.equal(counter.requests, 1);
  ctx.chat[2].message_id = 999;
  await sleep(20);
  simulateReplacement(ctx.chat[2], '完整正文（变量渲染后 v3）');
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  // 锚点里没有 message_id（建锚时楼层无该字段），当前楼层单方面出现 id：
  // lenient 规则只在两边都有且不等时拒绝，单边出现不拒绝，仍吸收
  assert.equal(counter.requests, 1, '单边 message_id 不应破坏吸收');
});

// ---- 评审点名：替换戳与编辑的绑定 ----
// 「追踪完成 → 替换 → 下次轮询吸收之前用户手动编辑」：编辑不动替换戳，
// 若只看「戳晚于回执」会把编辑一起吞掉。编辑事件计数与戳值前进必须同时成立。

test('替换落库后、吸收之前用户手动编辑：编辑事件否决吸收，照常追踪', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);

  await sleep(20);
  simulateReplacement(ctx.chat[2], '完整正文（变量渲染后）');
  // 下一次轮询之前用户手改（宿主发 message_edited）
  ctx.eventSource.emit('message_edited');
  ctx.chat[2].mes = '完整正文（变量渲染后）+ 用户微调';
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '替换后的手动编辑不得被吸收');
});

test('请求在飞时先替换、再手动修改：编辑事件否决沿用，作废重跑', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  let releaseFetch;
  let holdNextFetch = true;
  globalThis.fetch = async () => {
    counter.requests += 1;
    if (holdNextFetch) {
      holdNextFetch = false;
      await new Promise((resolve) => { releaseFetch = resolve; });
    }
    return okResponse();
  };

  ctx.chat.push({ is_user: true, name: 'User', mes: '继续' });
  await runTracker(ctx, deps, 'poll');
  ctx.chat.push({ is_user: false, name: 'Alice', mes: '完整正文', swipe_id: 0 });
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  const runPromise = runTracker(ctx, deps, 'poll');
  await sleep(50);

  await sleep(20);
  simulateReplacement(ctx.chat[2], '完整正文（变量渲染后）');
  ctx.eventSource.emit('message_edited');
  ctx.chat[2].mes = '完整正文（变量渲染后）+ 用户微调';
  releaseFetch();
  await runPromise;
  assert.equal(counter.requests, 1, '在飞这轮不作废即不重发');
  const chatState = chatStateOf(ctx);
  assert.notEqual(chatState.lastProcessedSignature, buildSignature(ctx, 3), '带编辑的改写必须作废，不得推进回执');

  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '作废后下一轮照常补追（编辑内容被追踪到）');
});

test('吸收之后手动编辑：戳值未前进否决吸收，照常追踪', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);
  await replaceTail(ctx, '完整正文（变量渲染后）');
  assert.equal(counter.requests, 1, '纯替换先被吸收');

  await sleep(20);
  ctx.chat[2].mes = '用户在吸收之后手改';
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '吸收后编辑（戳不前进）必须重追踪');
});

test('页面重载（计数归零）后手动编辑：持久化计数回填仍能否决吸收', async () => {
  const { ctx, counter, settings } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;
  await trackOneReply(ctx);
  assert.equal(counter.requests, 1);

  await sleep(20);
  simulateReplacement(ctx.chat[2], '完整正文（变量渲染后）');
  // 模拟重载：内存计数归零，持久化计数（回执时写入）保留；回填后用户编辑 → 前进
  assert.ok(Number(settings.hostMutSeqCounter) >= 0, '回执应已持久化编辑计数');
  __hostRunStateForTest.mutSeq = 0;
  ctx.eventSource.emit('message_edited'); // 重载后的手动编辑
  ctx.chat[2].mes = '完整正文（变量渲染后）+ 重载后手改';
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 2, '重载后的编辑不得被静默吞掉');
});

