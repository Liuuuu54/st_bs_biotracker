// MVU 额外模型解析兼容门控测试：验证追踪请求在 MVU 变量更新结束前会被推迟。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __mvuGateStateForTest,
  getMainflowContextSnapshot,
  isMvuExtraAnalysisEnabled,
  shouldWaitForMvuExtraAnalysis,
} from '../scripts/tracker.js';
import { buildSignature } from '../scripts/state.js';

const MVU_EXTRA_WAIT_GRACE_MS = 4000;

function makeCtx(overrides = {}) {
  return {
    chatId: 'mvu-gate-chat',
    chat: [
      { id: 1, is_user: true, mes: '你好' },
      { id: 2, is_user: false, name: '角色', mes: '你好呀' },
    ],
    extensionSettings: {},
    ...overrides,
  };
}

function makeSettings(overrides = {}) {
  return { mvuExtraAnalysisCompat: true, ...overrides };
}

function makeMvuSettings(overrides = {}) {
  return {
    更新方式: '额外模型解析',
    额外模型解析配置: { 启用自动请求: true },
    ...overrides,
  };
}

function resetGate() {
  __mvuGateStateForTest.lastEndedKey = '';
  __mvuGateStateForTest.lastEndedContentKey = '';
  __mvuGateStateForTest.lastEndedAt = 0;
  __mvuGateStateForTest.pendingKey = '';
  __mvuGateStateForTest.pendingContentKey = '';
  __mvuGateStateForTest.pendingSince = 0;
  __mvuGateStateForTest.announced = false;
  // fetchHooked/eventInstalled 不重置：钩子只装一次，避免嵌套包装
  __mvuGateStateForTest.generateInFlight = 0;
  __mvuGateStateForTest.lastGenerateStartedAt = 0;
  __mvuGateStateForTest.sawGenerateThisRound = false;
  __mvuGateStateForTest.everSawMvuSignal = false;
  delete globalThis.Mvu;
  delete globalThis.parent?.Mvu;
}

function setDuring(during) {
  globalThis.Mvu = { isDuringExtraAnalysis: () => during };
}

test('未配置 MVU 时既不启用也不等待', () => {
  resetGate();
  const ctx = makeCtx();
  assert.equal(isMvuExtraAnalysisEnabled(ctx, makeSettings()), false);
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), false);
});

test('MVU 更新方式为随AI输出时不等待', () => {
  resetGate();
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings({ 更新方式: '随AI输出' }) },
  });
  assert.equal(isMvuExtraAnalysisEnabled(ctx, makeSettings()), false);
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), false);
});

test('关闭兼容开关后即使 MVU 配置了额外解析也不等待', () => {
  resetGate();
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  assert.equal(isMvuExtraAnalysisEnabled(ctx, makeSettings({ mvuExtraAnalysisCompat: false })), false);
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings({ mvuExtraAnalysisCompat: false })), false);
});

test('额外模型解析未开启自动请求时视为不等待', () => {
  resetGate();
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings({ 额外模型解析配置: { 启用自动请求: false } }) },
  });
  assert.equal(isMvuExtraAnalysisEnabled(ctx, makeSettings()), false);
});

test('旧版字段 自动触发额外模型解析=false 同样视为不等待', () => {
  resetGate();
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: { 更新方式: '额外模型解析', 自动触发额外模型解析: false } },
  });
  assert.equal(isMvuExtraAnalysisEnabled(ctx, makeSettings()), false);
});

test('额外模型解析开启且正文出完时先等待（宽限期），MVU 未开始则等待', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  assert.equal(isMvuExtraAnalysisEnabled(ctx, settings), true);
  // 第一次评估：MVU 可能还没收到消息，宽限期内应等待
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 宽限期未过仍等待
  __mvuGateStateForTest.pendingSince = Date.now() - MVU_EXTRA_WAIT_GRACE_MS + 500;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
});

test('MVU 正在解析中即使超过宽限期也持续等待', () => {
  resetGate();
  setDuring(true);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 已等 10 秒仍处于解析中 → 继续等
  __mvuGateStateForTest.pendingSince = Date.now() - 10000;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
});

test('MVU 变量更新结束事件新鲜时放行', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  // 先进入等待
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 模拟 VARIABLE_UPDATE_ENDED 事件处理器写入（含内容指纹）
  const roundKey = `${ctx.chatId}:${ctx.chat.length}:assistant:${ctx.chat[ctx.chat.length - 1].id}`;
  const contentKey = buildSignature(ctx, ctx.chat.length);
  __mvuGateStateForTest.lastEndedKey = roundKey;
  __mvuGateStateForTest.lastEndedContentKey = contentKey;
  __mvuGateStateForTest.lastEndedAt = Date.now();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
});

test('同一 id 被重掷/编辑（内容变化）后不再复用上一轮结束事件', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 上一轮结束事件：同 id 同长度，但内容指纹是旧内容
  const roundKey = `${ctx.chatId}:${ctx.chat.length}:assistant:${ctx.chat[ctx.chat.length - 1].id}`;
  __mvuGateStateForTest.lastEndedKey = roundKey;
  __mvuGateStateForTest.lastEndedContentKey = `stale-content-fingerprint-${Date.now()}`;
  __mvuGateStateForTest.lastEndedAt = Date.now();
  // 内容指纹不一致 → 不视为已结束，继续等待
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
});

test('重掷/编辑后旧等待窗口过期也必须重新等待（pendingSince 重排）', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  // 先进入等待，随后旧窗口过期
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  __mvuGateStateForTest.pendingSince = Date.now() - 30000;
  // 同 id 同长度、内容变化（模拟重掷）——新 ctx 的 contentKey 与旧轮不同
  const changedCtx = makeCtx({
    chat: [
      { id: 1, is_user: true, mes: '你好' },
      { id: 2, is_user: false, name: '角色', mes: '重掷后的新正文内容' },
    ],
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  // 内容指纹变化 → 视为新轮次、重置等待窗口 → 即使旧窗口过期也不放行
  assert.equal(shouldWaitForMvuExtraAnalysis(changedCtx, settings), true);
  // 新窗口重新计时：未过期仍等待，过期后才放行
  __mvuGateStateForTest.pendingSince = Date.now() - MVU_EXTRA_WAIT_GRACE_MS - 1000;
  assert.equal(shouldWaitForMvuExtraAnalysis(changedCtx, settings), false);
});

test('宽限期超时且 MVU 从未解析时放行', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 超过宽限期仍未开始解析（例如首楼 MVU 跳过）→ 放行
  __mvuGateStateForTest.pendingSince = Date.now() - MVU_EXTRA_WAIT_GRACE_MS - 1000;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
});

test('尾楼是用户消息（after_user 时机）时不等待', () => {
  resetGate();
  setDuring(true);
  const ctx = makeCtx({
    chat: [
      { id: 1, is_user: true, mes: '你好' },
      { id: 2, is_user: false, name: '角色', mes: '你好呀' },
      { id: 3, is_user: true, mes: '再来一轮' },
    ],
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), false);
});

test('事件已结束但时间过久（上一轮残留）时重新走宽限期等待', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings() },
  });
  const settings = makeSettings();
  const roundKey = `${ctx.chatId}:${ctx.chat.length}:assistant:${ctx.chat[ctx.chat.length - 1].id}`;
  // 残留事件：30 秒前结束（模拟上一轮），不应直接放行
  __mvuGateStateForTest.lastEndedKey = roundKey;
  __mvuGateStateForTest.lastEndedAt = Date.now() - 30000;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
});

test('TT 场景：读不到 MVU 设置但 Mvu 全局在解析中 → 等待', () => {
  resetGate();
  setDuring(true);
  const ctx = makeCtx(); // 无 mvu_settings，模拟 TT 读不到设置
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), true);
});

test('MVU 全局存在但未在解析（读不到设置）→ 宽限期等待，超时放行', () => {
  resetGate();
  setDuring(false);
  const ctx = makeCtx(); // 无 mvu_settings
  const settings = makeSettings();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 超过宽限期仍未开始解析 → 放行
  __mvuGateStateForTest.pendingSince = Date.now() - 5000;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
});

test('读不到设置且完全没有 Mvu 全局 → 不等待', () => {
  resetGate();
  const ctx = makeCtx();
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), false);
});

test('额外模型解析但自动请求关闭 → 门控直接放行', () => {
  resetGate();
  setDuring(true); // 即使正处于解析中，自动关闭时也不该等待
  const ctx = makeCtx({
    extensionSettings: { mvu_settings: makeMvuSettings({ 额外模型解析配置: { 启用自动请求: false } }) },
  });
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, makeSettings()), false);
});

test('TT 场景：读不到设置、无 Mvu，但有额外生成请求在飞行 → 等待', () => {
  resetGate();
  const ctx = makeCtx(); // 无 mvu_settings、无 Mvu 全局
  const settings = makeSettings();
  // 首次评估：未看到信号
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
  // MVU 的额外解析请求开始飞行（fetch 钩子观测到）
  __mvuGateStateForTest.generateInFlight = 1;
  __mvuGateStateForTest.lastGenerateStartedAt = Date.now();
  __mvuGateStateForTest.sawGenerateThisRound = true;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
});

test('生成请求结束后放行', () => {
  resetGate();
  const ctx = makeCtx();
  const settings = makeSettings();
  // 请求在飞行 → 等待
  __mvuGateStateForTest.generateInFlight = 1;
  __mvuGateStateForTest.sawGenerateThisRound = true;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 请求完成 → 放行（MVU 变量已更新）
  __mvuGateStateForTest.generateInFlight = 0;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
});

test('见过 MVU 信号后，无信号轮次走宽限期等待', () => {
  resetGate();
  const ctx = makeCtx();
  const settings = makeSettings();
  // 之前某轮见过生成请求（everSaw 为 true）
  __mvuGateStateForTest.everSawMvuSignal = true;
  // 本轮还没看到请求（MVU 可能还没开始）→ 宽限期内等待
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), true);
  // 超过宽限期仍未出现信号 → 放行
  __mvuGateStateForTest.pendingSince = Date.now() - 5000;
  assert.equal(shouldWaitForMvuExtraAnalysis(ctx, settings), false);
});

test('mainflow 快照绑定当前聊天：跨聊天/无绑定一律拒绝', () => {
  const snapshotKey = '__bs_biotracker_mainflow_context_snapshot__';
  const messages = [{ role: 'user', content: 'hi' }];
  const ctxA = { chatId: 'chat-a' };
  const ctxB = { chatId: 'chat-b' };
  globalThis[snapshotKey] = { chatKey: 'chat-a', messages };
  try {
    assert.ok(getMainflowContextSnapshot(ctxA), '同聊天快照应可用');
    assert.equal(getMainflowContextSnapshot(ctxB), null, '跨聊天快照应拒绝');
    globalThis[snapshotKey] = { messages }; // 旧格式：无 chatKey 绑定
    assert.equal(getMainflowContextSnapshot(ctxA), null, '无绑定旧格式应拒绝');
  } finally {
    delete globalThis[snapshotKey];
  }
});
