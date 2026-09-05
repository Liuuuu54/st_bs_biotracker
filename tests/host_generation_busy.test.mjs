// 主生成忙碌闸门回归：串流（含 MVU 额外解析在飞）期间绝不发出追踪请求。
//
// 使用者在 TT 实测回报：開異步追蹤 + MVU 額外模型解析時，「主連接刚开始吐字」就会
// 被追一轮。根因是宿主串流期间按 chunk 把半成品写进 mes（首帧还是 '...' 占位），
// chunk 间隙一超过 settle 窗就被误判成说完。修法是轮询先查宿主忙碌态，忙则整轮跳过。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import {
  runTracker,
  isHostGenerationBusy,
  installHostRunWatchers,
  __hostRunStateForTest,
  __mvuGateStateForTest,
} from '../scripts/tracker.js';

const ORIGINAL_FETCH = globalThis.fetch;
const AFTER_AI_SETTLE_MS = 1400;
const sleepPastSettle = () => new Promise((resolve) => { setTimeout(resolve, AFTER_AI_SETTLE_MS + 200); });

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
  delete globalThis.document;
  delete globalThis.Mvu;
  delete globalThis.__bs_biotracker_host_busy_stale_ms__;
  delete globalThis.__bs_biotracker_host_mvu_busy_max_ms__;
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

function resetRunState(ctx) {
  const run = __hostRunStateForTest;
  run.listenersInstalled = false;
  run.generationDepth = 0;
  run.generationBusySince = 0;
  __mvuGateStateForTest.generateInFlight = 0;
  if (ctx?.eventSource) installHostRunWatchers(ctx);
}

function makeCtx(overrides = {}) {
  const ctx = {
    chatId: 'busy-chat',
    chat: [{ id: 1, is_user: false, name: 'Alice', mes: 'previous reply', swipe_id: 0 }],
    extensionSettings: {},
    saveSettingsDebounced() {},
    eventSource: makeFakeEventBus(),
    eventTypes: {
      GENERATION_STARTED: 'generation_started',
      GENERATION_STOPPED: 'generation_stopped',
      GENERATION_ENDED: 'generation_ended',
    },
    ...overrides,
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
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool_calls: [] }) } }] });
      },
    };
  };
  resetRunState(ctx);
  return { ctx, counter };
}

const deps = { renderStatusPanel() {}, updateMainFlowPrompt() {} };

function setGenerating(value) {
  globalThis.document = value === null
    ? { body: { dataset: {} } }
    : { body: { dataset: { generating: value ? 'true' : 'false' } } };
}

test('宿主的停止按钮旗标亮着时，即便内容早已稳定也不发追踪', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  ctx.chat.push({ id: 2, is_user: true, name: 'User', mes: 'my input' });
  ctx.chat.push({ id: 3, is_user: false, name: 'Alice', mes: '开头几个字', swipe_id: 0 });
  // 串流刚开始：宿主把半截正文写进来后就卡在两个 chunk 的间隙里
  setGenerating(true);
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 0, '主生成在飞时不该发追踪');

  setGenerating(false);
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 1, '主生成结束且内容稳定后恰好补发一次');
});

test('streamingProcessor 不再作为信号源（getContext 一次性快照不可靠）', () => {
  const probeCtx = { chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  setGenerating(false);
  probeCtx.streamingProcessor = { isFinished: false };
  assert.equal(isHostGenerationBusy(probeCtx), false, '该字段是加载时的旧引用，不该据此冻结追踪');
});

test('generation_started / ended 事件对驱动忙碌态；漏收 ended 时看门狗放行', async () => {
  const { ctx } = makeCtx();
  setGenerating(false);
  assert.equal(isHostGenerationBusy(ctx), false);
  ctx.eventSource.emit('generation_started');
  assert.equal(isHostGenerationBusy(ctx), true, '收到 started 就该视为在飞');
  ctx.eventSource.emit('generation_ended');
  assert.equal(isHostGenerationBusy(ctx), false, 'ended 清计数');

  // 群組/工具嵌套会多次 started、只在最后一并 ended；若 ended 全程漏收，
  // 卡死追踪的时间必须被 staleness 上限截断（测试注入 60ms）
  globalThis.__bs_biotracker_host_busy_stale_ms__ = 60;
  ctx.eventSource.emit('generation_started');
  assert.equal(isHostGenerationBusy(ctx), true);
  await new Promise((resolve) => { setTimeout(resolve, 90); });
  assert.equal(isHostGenerationBusy(ctx), false, '超上限后自愈');
  // stopped 也是权威结束信号
  ctx.eventSource.emit('generation_started');
  ctx.eventSource.emit('generation_stopped');
  assert.equal(isHostGenerationBusy(ctx), false);
});

test('嵌套生成只收到一次 ended 时，深度整体清空而非残留', () => {
  const { ctx } = makeCtx();
  setGenerating(false);
  ctx.eventSource.emit('generation_started');
  ctx.eventSource.emit('generation_started');
  ctx.eventSource.emit('generation_started');
  ctx.eventSource.emit('generation_ended');
  assert.equal(isHostGenerationBusy(ctx), false, '宿主自认结束事件权威：清空全部残留深度');
});

test('MVU 在飞信号不再进入忙碌闸门（修复两分钟延迟的回归点）', () => {
  // 旧实现把「带 MVU 特征的 fetch 在飞 / isDuringExtraAnalysis」当忙碌信号，而
  // 数据库正文替换/填表请求的 body 也含 <UpdateVariable>，被误命中后整条数据库
  // 后处理排到追踪前面，TT 实测拖出约两分钟。现在忙碌只看宿主自身信号。
  const { ctx } = makeCtx();
  setGenerating(false);
  globalThis.Mvu = { isDuringExtraAnalysis: () => true };
  assert.equal(isHostGenerationBusy(ctx), false, 'MVU 标志不该冻结忙碌闸门');
  globalThis.Mvu = undefined;
  __mvuGateStateForTest.generateInFlight = 3;
  assert.equal(isHostGenerationBusy(ctx), false, '特征请求在飞也不该冻结忙碌闸门');
  // 但真·宿主生成仍然要拦
  __mvuGateStateForTest.generateInFlight = 0;
  ctx.eventSource.emit('generation_started');
  assert.equal(isHostGenerationBusy(ctx), true, '宿主 generation 在飞仍是忙碌');
});

test('串流中途到主+MVU 解析全部结束，整段只追踪一次', async () => {
  const { ctx, counter } = makeCtx();
  await runTracker(ctx, deps, 'manual');
  counter.requests = 0;

  // 使用者发送 → 宿主开始流式出字
  ctx.chat.push({ id: 2, is_user: true, name: 'User', mes: '继续' });
  setGenerating(true);
  ctx.chat.push({ id: 3, is_user: false, name: 'Alice', mes: '...', swipe_id: 0 });
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 0);
  await sleepPastSettle();
  ctx.chat[2].mes = '出到一半的正文，后面还有';
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 0, '串流中途即使内容“稳定”了也不追');

  // 主生成结束。数据库/MVU 的在飞特征请求由兼容门控 shouldWaitForMvuExtraAnalysis
  // 处理（不再是忙碌闸门），这里验证它仍会挡住抢发、且整体只追踪一次
  setGenerating(false);
  ctx.chat[2].mes = '完整正文';
  __mvuGateStateForTest.generateInFlight = 1;
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 0, '特征请求在飞时由兼容门控挡住，不抢发');
  __mvuGateStateForTest.generateInFlight = 0;
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.requests, 1, '都结束后恰好一次');
});
