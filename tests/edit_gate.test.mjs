// 手动修改尾楼后的重追判断：追踪时记下正文，改了以后先问决策模型要不要重追；
// 以及编辑框开着时不追踪（开了「自动保存编辑」时每打一个字都会写回正文）。
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import * as state from '../scripts/state.js';
import {
  runTracker,
  installHostRunWatchers,
  __editGateRunsForTest,
  __hostRunStateForTest,
  __mvuGateStateForTest,
  __pollWaitByChatForTest,
} from '../scripts/tracker.js';
import {
  buildEditGateRequestBody,
  classifyTailEdit,
  describeEditGateUrlProblem,
  EDIT_GATE_MAX_CHANGED_CHARS,
  EDIT_GATE_TOPICS,
  interpretEditGateResponse,
  normalizeEditGateKeepFloors,
  normalizeEditGateThresholdPercent,
  requestEditGateDecision,
} from '../scripts/edit_gate.js';
import { isOwnRequest } from '../scripts/own_requests.js';

const ORIGINAL_FETCH = globalThis.fetch;
const AFTER_AI_SETTLE_MS = 1400;
const DECISION_URL = 'https://decision.invalid/v1/systemone';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sleepPastSettle = () => sleep(AFTER_AI_SETTLE_MS + 200);

const TRACKED_TEXT = '夜里下着雨。雷恩没有戴避孕套，最后在她体内射精。艾琳喘息着抱紧了他。';

beforeEach(() => {
  __editGateRunsForTest.clear();
  __pollWaitByChatForTest.clear();
});

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
  delete globalThis.document;
});

function decisionAnswers(changed) {
  const answers = {};
  for (const key of Object.keys(EDIT_GATE_TOPICS)) {
    const p = Number(changed[key] ?? 0.02);
    answers[key] = { choice: p >= 0.5 ? '改变了' : '没改变', probabilities: { 改变了: p, 没改变: 1 - p } };
  }
  return { answers, usage: { input_tokens: 900 } };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

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
  run.absorbedReplacementStamps.clear();
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
  installHostRunWatchers(ctx);
}

/**
 * 追踪请求回一次「经过 2 小时」，决策请求按 decide() 回答；两边分开计数。
 * editGate: true 时开启修改判断并填好接口。
 */
function makeCtx({ editGate = true, decide = () => jsonResponse(decisionAnswers({})) } = {}) {
  const toasts = [];
  globalThis.toastr = {
    info: (msg) => { toasts.push(['info', String(msg)]); },
    success: (msg) => { toasts.push(['success', String(msg)]); },
    warning: (msg) => { toasts.push(['warning', String(msg)]); },
    error: (msg) => { toasts.push(['error', String(msg)]); },
    clear: () => {},
  };
  const ctx = {
    chatId: 'edit-gate-chat',
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
  settings.apiUrl = 'https://example.invalid/v1';
  settings.apiKey = 'k';
  settings.model = 'test-model';
  if (editGate) {
    settings.editGateEnabled = true;
    settings.editGateApiUrl = DECISION_URL;
    settings.editGateApiKey = 'decision-key';
    settings.editGateModel = 'decision-model';
  }
  state.getChatState(ctx, settings).characters['艾拉'] = { ...state.createDefaultFemaleState('艾拉'), initialized: true };
  const counter = { tracker: 0, decision: 0, decisionBodies: [] };
  globalThis.fetch = async (url, init) => {
    if (String(url) === DECISION_URL) {
      counter.decision += 1;
      counter.decisionBodies.push(JSON.parse(init.body));
      return decide(init);
    }
    counter.tracker += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 2 } }] }) } }] });
  };
  resetAllGates(ctx);
  return { ctx, counter, toasts, settings };
}

const deps = { renderStatusPanel() {}, updateMainFlowPrompt() {} };

function chatStateOf(ctx) {
  return state.getChatState(ctx, state.getSettings(ctx));
}

async function trackOneReply(ctx, text = TRACKED_TEXT, extra = {}) {
  ctx.chat.push({ is_user: true, name: 'User', mes: '继续' });
  await runTracker(ctx, deps, 'poll');
  ctx.chat.push({ is_user: false, name: 'Alice', mes: text, swipe_id: 0, ...extra });
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
}

/** 用铅笔改尾楼：改 mes、宿主发编辑事件；随后等正文稳定再轮询 */
async function editTail(ctx, text) {
  ctx.chat[ctx.chat.length - 1].mes = text;
  ctx.eventSource.emit('message_edited', ctx.chat.length - 1);
  await runTracker(ctx, deps, 'poll'); // settle 重新计时
  await sleepPastSettle();
  return runTracker(ctx, deps, 'poll');
}

async function setupTracked(options) {
  const env = makeCtx(options);
  await runTracker(env.ctx, deps, 'manual');
  await trackOneReply(env.ctx);
  env.counter.tracker = 0;
  env.toasts.length = 0;
  env.minutesAfterTrack = chatStateOf(env.ctx).minutesPassed;
  return env;
}

// ---- 纯函数 ----

test('不问模型就能定的改动：原样、只动空白标点沿用；续写、大改直接重追；其余交给模型', () => {
  assert.equal(classifyTailEdit(TRACKED_TEXT, TRACKED_TEXT), 'same');
  assert.equal(classifyTailEdit(TRACKED_TEXT, TRACKED_TEXT.replace('。雷恩', '，雷恩').replace('射精。', '射精！ ')), 'cosmetic');
  assert.equal(classifyTailEdit(TRACKED_TEXT, `${TRACKED_TEXT}\n\n天亮了，她换上了睡衣。`), 'append');
  assert.equal(classifyTailEdit(`${TRACKED_TEXT}\n`, `${TRACKED_TEXT}\n天亮了。`), 'append');
  const huge = '他'.repeat(EDIT_GATE_MAX_CHANGED_CHARS + 1);
  assert.equal(classifyTailEdit(TRACKED_TEXT, TRACKED_TEXT.replace('夜里下着雨。', huge)), 'too_large');
  assert.equal(classifyTailEdit(TRACKED_TEXT, TRACKED_TEXT.replace('在她体内射精', '射在了她的小腹上')), 'needs_decision');
  assert.equal(classifyTailEdit(TRACKED_TEXT, TRACKED_TEXT.replace('夜里下着雨。', '')), 'needs_decision');
});

test('决策请求按六类事实逐项提问，只带改动的那一段与少量上下文', () => {
  const before = `${'前文'.repeat(200)}${TRACKED_TEXT}`;
  const after = before.replace('在她体内射精', '射在了她的小腹上');
  const body = buildEditGateRequestBody('m', before, after);
  assert.equal(body.model, 'm');
  assert.deepEqual(Object.keys(body.questions), ['sex', 'contraception', 'time', 'clothing', 'presence', 'body']);
  for (const question of Object.values(body.questions)) {
    assert.equal(question.type, 'choice');
    assert.deepEqual(Object.keys(question.criteria), ['改变了', '没改变']);
  }
  assert.match(body.state, /【修改前这一处写的是】在她体内射精/);
  assert.match(body.state, /【修改后这一处写的是】射在了她的小腹上/);
  assert.ok(body.state.length < 800, '前面 400 字的前文只带上 120 字上下文');
});

test('任意一项「改变了」达到 0.6 就重追；回答缺项算失败；数组形式的概率也读得出', () => {
  assert.equal(interpretEditGateResponse(decisionAnswers({ time: 0.59 })).retrack, false);
  assert.equal(interpretEditGateResponse(decisionAnswers({ time: 0.6 })).retrack, true, '正好 0.6 也重追');
  const verdict = interpretEditGateResponse(decisionAnswers({ sex: 0.97, time: 0.6 }));
  assert.equal(verdict.retrack, true);
  assert.deepEqual(verdict.changedTopics, ['sex', 'time']);
  const arrayForm = decisionAnswers({});
  arrayForm.answers.body = { choice: '改变了', probabilities: [{ choice: '改变了', probability: 0.8 }, { choice: '没改变', probability: 0.2 }] };
  assert.equal(interpretEditGateResponse(arrayForm).retrack, true);
  const choiceOnly = decisionAnswers({});
  choiceOnly.answers.clothing = { choice: '改变了' };
  assert.equal(interpretEditGateResponse(choiceOnly).retrack, true);
  const missing = decisionAnswers({});
  delete missing.answers.presence;
  assert.throws(() => interpretEditGateResponse(missing), /presence/);
  assert.throws(() => interpretEditGateResponse({}), /没有返回回答/);
});

test('决策请求直连自定义地址、带 Bearer、标成本插件自己的请求；HTTP 错误与超时都抛错', async () => {
  const settings = { editGateApiUrl: DECISION_URL, editGateApiKey: ' secret ', editGateModel: 'decision-model' };
  let seen = null;
  const ok = await requestEditGateDecision(settings, 'a在体内', 'a在体外', {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return jsonResponse(decisionAnswers({ sex: 0.9 }));
    },
  });
  assert.equal(ok.retrack, true);
  assert.equal(seen.url, DECISION_URL);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(seen.init.body).model, 'decision-model');
  assert.ok(isOwnRequest(seen.init), 'MVU / 主流快照的 fetch 拦截要跳过它');

  await assert.rejects(
    requestEditGateDecision(settings, 'a', 'b', { fetchImpl: async () => jsonResponse('quota exceeded', 429) }),
    /HTTP 429/,
  );
  await assert.rejects(
    requestEditGateDecision(settings, 'a', 'b', {
      timeoutMs: 30,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    }),
    /秒内没有回应/,
  );
  await assert.rejects(
    requestEditGateDecision({ ...settings, editGateApiUrl: 'http://8.8.8.8/v1/systemone' }, 'a', 'b', { fetchImpl: async () => jsonResponse({}) }),
    /http/i,
  );
  await assert.rejects(requestEditGateDecision({ ...settings, editGateModel: '' }, 'a', 'b'), /没有填好/);
});

// ---- 追踪流程 ----

test('编辑框开着时不追踪，保存（关掉编辑框）后才追', async () => {
  const { ctx, counter } = await setupTracked({ editGate: false });
  globalThis.document = { querySelector: (selector) => (selector === '#curEditTextarea' ? {} : null) };
  // 自动保存编辑：每打一个字都写回 mes
  for (const text of ['夜里下着雨。雷', '夜里下着雨。雷恩戴', '夜里下着雨。雷恩戴了套。']) {
    ctx.chat[ctx.chat.length - 1].mes = text;
    await sleepPastSettle();
    const result = await runTracker(ctx, deps, 'poll');
    assert.equal(result.reason, 'message_editing');
  }
  assert.equal(counter.tracker, 0, '编辑过程中一次都不追');

  delete globalThis.document;
  ctx.eventSource.emit('message_edited', ctx.chat.length - 1);
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.tracker, 1, '编辑完成后照常追踪一次');
});

test('改动没动到生理事实：问一次决策模型，沿用上次结果、不重追，这一楼追踪出的状态也不丢', async () => {
  const { ctx, counter, toasts, minutesAfterTrack } = await setupTracked();
  assert.equal(minutesAfterTrack, 240);

  const pending = await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着雨，壁炉里的柴火噼啪作响。'));
  assert.equal(pending.reason, 'edit_gate_pending');
  assert.equal(counter.decision, 1);
  assert.match(counter.decisionBodies[0].state, /【修改后这一处写的是】，壁炉里的柴火噼啪作响/);
  await sleep(10);
  const adopted = await runTracker(ctx, deps, 'poll');
  assert.equal(adopted.reason, 'edit_adopted');
  assert.equal(counter.tracker, 0, '不重发追踪');

  const chatState = chatStateOf(ctx);
  assert.equal(chatState.snapshots.at(-1).reason, 'edit_adopted');
  assert.equal(chatState.lastProcessedSignature, state.buildSignature(ctx, ctx.chat.length));
  assert.equal(chatState.minutesPassed, 240, '这一楼推进的 2 小时还在');
  assert.ok(toasts.some(([kind, msg]) => kind === 'info' && msg.includes('沿用上次的追踪结果')));

  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.tracker, 0, '之后的轮询保持静默');
  assert.equal(counter.decision, 1, '同一处改动只问一次');
  assert.equal(chatStateOf(ctx).minutesPassed, 240);
});

test('再改一次仍拿追踪时那一版来比，几次小改累积不会漏', async () => {
  const { ctx, counter } = await setupTracked();
  await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  await sleep(10);
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.decision, 1);

  await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。').replace('在她体内射精', '射在了她的小腹上'));
  assert.equal(counter.decision, 2);
  const state2 = counter.decisionBodies[1].state;
  assert.match(state2, /【修改前这一处写的是】[^\n]*在她体内射精/);
  assert.doesNotMatch(state2, /【修改前这一处写的是】[^\n]*大雨/, '修改前取追踪时的正文');
});

test('决策模型判为要重追时照常追踪，并按新正文重新记下', async () => {
  const { ctx, counter } = await setupTracked({ decide: () => jsonResponse(decisionAnswers({ sex: 0.97 })) });
  const edited = TRACKED_TEXT.replace('在她体内射精', '射在了她的小腹上');
  await editTail(ctx, edited);
  assert.equal(counter.decision, 1);
  await sleep(10);
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.tracker, 1, '照常重追一次');
  const chatState = chatStateOf(ctx);
  assert.equal(chatState.snapshots.at(-1).reason, 'tracker');
  assert.equal(chatState.editGateBaselines.at(-1).text, edited);
  assert.equal(chatState.minutesPassed, 240, '回到这一楼之前的状态再按新正文追踪（不重复叠加）');
});

test('判断失败（HTTP 错误）时提示一下，照常重追', async () => {
  const { ctx, counter, toasts } = await setupTracked({ decide: () => jsonResponse('quota exceeded', 429) });
  await editTail(ctx, TRACKED_TEXT.replace('在她体内射精', '射在了她的小腹上'));
  await sleep(10);
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.decision, 1);
  assert.equal(counter.tracker, 1);
  assert.ok(toasts.some(([kind, msg]) => kind === 'warning' && msg.includes('修改判断失败') && msg.includes('429')));
});

test('只动空白或标点：不问模型直接沿用；在末尾接着写：不问模型直接重追', async () => {
  const { ctx, counter, toasts } = await setupTracked();
  const result = await editTail(ctx, TRACKED_TEXT.replace('。雷恩', '，雷恩'));
  assert.equal(result.reason, 'edit_adopted');
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 0);
  assert.ok(toasts.some(([, msg]) => msg.includes('只改了空白或标点')));

  await editTail(ctx, `${TRACKED_TEXT}\n天亮了，艾琳换上了睡衣。`);
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 1);
});

test('没开修改判断或没填好接口：不发决策请求，照常重追；没开时也不记正文', async () => {
  const off = await setupTracked({ editGate: false });
  assert.equal(chatStateOf(off.ctx).editGateBaselines, undefined);
  await editTail(off.ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  assert.equal(off.counter.decision, 0);
  assert.equal(off.counter.tracker, 1);

  const unconfigured = await setupTracked();
  unconfigured.settings.editGateModel = '';
  await editTail(unconfigured.ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  assert.equal(unconfigured.counter.decision, 0);
  assert.equal(unconfigured.counter.tracker, 1);
});

test('重新生成的同位置讯息（生成时刻不同）不当作编辑，照常重追', async () => {
  const env = makeCtx();
  await runTracker(env.ctx, deps, 'manual');
  await trackOneReply(env.ctx, TRACKED_TEXT, { gen_started: '2026-10-31T10:00:00.000Z' });
  env.counter.tracker = 0;
  const { ctx, counter } = env;
  ctx.chat[ctx.chat.length - 1] = {
    is_user: false, name: 'Alice', swipe_id: 0, gen_started: '2026-10-31T10:05:00.000Z',
    mes: TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'),
  };
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  await runTracker(ctx, deps, 'poll');
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 1);
});

test('手动分析不经过修改判断', async () => {
  const { ctx, counter } = await setupTracked();
  ctx.chat[ctx.chat.length - 1].mes = TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。');
  await runTracker(ctx, deps, 'manual');
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 1);
});

test('数据库正文替换被静默吸收时，这一楼追踪出的状态不丢', async () => {
  const { ctx, counter } = await setupTracked({ editGate: false });
  await sleep(20);
  const last = ctx.chat[ctx.chat.length - 1];
  last.mes = `${TRACKED_TEXT}（润色后）`;
  last.extra = { _acu_last_optimized_at: Date.now() };
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  const result = await runTracker(ctx, deps, 'poll');
  assert.equal(result.reason, 'silent_tail_replacement');
  assert.equal(counter.tracker, 0);
  assert.equal(chatStateOf(ctx).minutesPassed, 240);
});

test('沿用过的编辑之后再来一次数据库正文替换，同样静默吸收', async () => {
  const { ctx, counter } = await setupTracked();
  await editTail(ctx, TRACKED_TEXT.replace('。雷恩', '，雷恩'));
  assert.equal(chatStateOf(ctx).snapshots.at(-1).reason, 'edit_adopted');
  await sleep(20);
  const last = ctx.chat[ctx.chat.length - 1];
  last.mes = `${last.mes}（润色后）`;
  last.extra = { _acu_last_optimized_at: Date.now() };
  await runTracker(ctx, deps, 'poll');
  await sleepPastSettle();
  const result = await runTracker(ctx, deps, 'poll');
  assert.equal(result.reason, 'silent_tail_replacement');
  assert.equal(counter.tracker, 0);
  assert.equal(counter.decision, 0);
  assert.equal(chatStateOf(ctx).minutesPassed, 240);
});

test('记下的正文与这一楼最新的追踪快照对不上时（旧的一份），不拿它来比，照常重追', async () => {
  const { ctx, counter } = await setupTracked();
  const baseline = chatStateOf(ctx).editGateBaselines.at(-1);
  baseline.boundarySignature = 'stale';
  baseline.text = TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。');
  await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 1);
});

test('接口地址的提示：没填不提示，非 http(s) 与明文 http 公网地址要提示', () => {
  assert.equal(describeEditGateUrlProblem(''), '');
  assert.equal(describeEditGateUrlProblem(DECISION_URL), '');
  assert.equal(describeEditGateUrlProblem('http://127.0.0.1:5000/v1/systemone'), '');
  assert.match(describeEditGateUrlProblem('aihubmix.com/v1/systemone'), /http/);
  assert.match(describeEditGateUrlProblem('http://8.8.8.8/v1/systemone'), /http/i);
});

test('高级参数规整：保留楼层 1–10（默认 3），判断门槛 1–99%（默认 60）', () => {
  assert.equal(normalizeEditGateKeepFloors(undefined), 3);
  assert.equal(normalizeEditGateKeepFloors(''), 3);
  assert.equal(normalizeEditGateKeepFloors(0), 1);
  assert.equal(normalizeEditGateKeepFloors(99), 10);
  assert.equal(normalizeEditGateKeepFloors('4.7'), 4);
  assert.equal(normalizeEditGateThresholdPercent(undefined), 60);
  assert.equal(normalizeEditGateThresholdPercent(''), 60);
  assert.equal(normalizeEditGateThresholdPercent(0), 1);
  assert.equal(normalizeEditGateThresholdPercent(120), 99);
  assert.equal(normalizeEditGateThresholdPercent('75'), 75);
});

test('判断门槛按设置：门槛调到 99% 时 0.97 也沿用，调到 30% 时 0.35 就重追', async () => {
  const base = { editGateApiUrl: DECISION_URL, editGateApiKey: 'k', editGateModel: 'm' };
  const answer = (p) => async () => jsonResponse(decisionAnswers({ sex: p }));
  assert.equal((await requestEditGateDecision({ ...base, editGateThresholdPercent: 99 }, 'a', 'b', { fetchImpl: answer(0.97) })).retrack, false);
  assert.equal((await requestEditGateDecision({ ...base, editGateThresholdPercent: 30 }, 'a', 'b', { fetchImpl: answer(0.35) })).retrack, true);
  assert.equal((await requestEditGateDecision(base, 'a', 'b', { fetchImpl: answer(0.59) })).retrack, false, '没设时用 60%');
});

async function trackTwoRepliesThenDeleteLatest(keepFloors) {
  const env = await setupTracked();
  env.settings.editGateKeepFloors = keepFloors;
  const firstReplyCount = env.ctx.chat.length;
  await trackOneReply(env.ctx, '第二轮回复：两人吃过早饭后出发了。');
  assert.equal(env.counter.tracker, 1);
  env.ctx.chat.length = firstReplyCount; // 删掉最新的使用者楼层与 AI 回复
  await runTracker(env.ctx, deps, 'poll');
  env.counter.tracker = 0;
  return env;
}

test('保留最近几楼的正文：删掉最新一楼后改更早那楼，仍能判断', async () => {
  const { ctx, counter } = await trackTwoRepliesThenDeleteLatest(3);
  assert.ok(chatStateOf(ctx).editGateBaselines.some((item) => item.text === TRACKED_TEXT));
  await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  assert.equal(counter.decision, 1);
  assert.match(counter.decisionBodies[0].state, /【修改前这一处写的是】/);
  await sleep(10);
  const result = await runTracker(ctx, deps, 'poll');
  assert.equal(result.reason, 'edit_adopted');
  assert.equal(counter.tracker, 0);
});

test('只保留 1 楼时，删掉最新一楼后再改更早那楼，照常重追', async () => {
  const { ctx, counter } = await trackTwoRepliesThenDeleteLatest(1);
  assert.deepEqual(chatStateOf(ctx).editGateBaselines.map((item) => item.text), ['第二轮回复：两人吃过早饭后出发了。']);
  await editTail(ctx, TRACKED_TEXT.replace('夜里下着雨。', '夜里下着大雨。'));
  assert.equal(counter.decision, 0);
  assert.equal(counter.tracker, 1);
});

test('重新追踪更早那楼后，已删掉的更晚楼层的正文一并作废', async () => {
  const { ctx } = await trackTwoRepliesThenDeleteLatest(3);
  const count = ctx.chat.length;
  await runTracker(ctx, deps, 'manual');
  const counts = chatStateOf(ctx).editGateBaselines.map((item) => item.messageCount);
  assert.equal(counts.at(-1), count);
  assert.ok(counts.every((value) => value <= count), `不该留着已删掉楼层的正文：${counts.join(',')}`);
});
