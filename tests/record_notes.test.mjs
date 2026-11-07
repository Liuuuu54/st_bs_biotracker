// 纪录堆压缩：近 7 天的胎儿事件不并进摘要（防洗分要看原始纪录）；并进去的排进 pending，
// 追踪结束时整理成要点（notes），之后送给追踪模型的摘要行附上要点。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { normalizeReproductiveSettings } from '../scripts/reproductive.js';
import { buildCognitionWindow, buildFetalEventWindow, compactRecordPile, RECORD_NOTES_PENDING_CAP } from '../scripts/fetal_health.js';
import { applyRecordNotesResult, buildRecordNotesPayload, summarizePendingRecords } from '../scripts/record_notes.js';
import { buildRecordNotesSystemPrompt } from '../scripts/prompts/rules.js';

const REAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = REAL_FETCH; });

const fetus = (embryoId) => ({ embryoId, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, healthMax: 100, health: 50 });

function setup(settings = { fetalEventCap: 10, fetalEventWindow: 2, recordPinCap: 2, cognitionCap: 10, cognitionWindow: 2 }) {
  const chatState = state.createEmptyChatState();
  chatState.reproductiveSettings = normalizeReproductiveSettings(settings);
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: { stage: '孕中期', days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 20, uterinePressure: 0, psyStress: 0,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1 },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1 },
      pregnant: { pregnantDays: 120, effectivePregnantDays: 120, fetusesCount: 2, fetalEnergyDrain: 0, nutritionBurst: {}, fetuses: [fetus(1), fetus(2)] },
      experience: {}, immune: { metabolism: true }, metabolism: {}, cooldown: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
let source = 0;
const event = (chatState, args) => applyToolCall(chatState, {
  name: 'bsFetalEvent', sourceId: `s${source += 1}`, arguments: { female: 'A', time: `第${Math.floor(chatState.minutesPassed / 1440)}日`, content: '一句', ...args },
});
const day = (chatState, days = 1) => { chatState.minutesPassed += days * 1440; };

test('近 7 天的事件不并进摘要，记得太密时暂时超过上限；过了 7 天窗口外的整批并', () => {
  const chatState = setup();
  for (let i = 0; i < 13; i += 1) event(chatState, { kind: 'fetal_reaction', change: 'slight_increase' });
  assert.equal(P(chatState).pregnant.fetalEvents.length, 13);
  assert.equal(P(chatState).pregnant.fetalEventSummary, undefined);
  day(chatState, 8);
  event(chatState, { kind: 'rest', change: 'slight_increase' });
  // 窗口 2：窗口外的 12 条都已超过 7 天，整批并进摘要
  assert.equal(P(chatState).pregnant.fetalEvents.length, 2);
  assert.equal(P(chatState).pregnant.fetalEventSummary.count, 12);
  assert.equal(P(chatState).pregnant.fetalEventSummary.pending.length, 12);
});

test('窗口外累积到 5 条才整批并：不到 5 条时留着；钉选不算', () => {
  const chatState = setup({ fetalEventCap: 30, fetalEventWindow: 2, recordPinCap: 2 });
  for (let i = 0; i < 6; i += 1) {
    event(chatState, { kind: 'fetal_reaction', change: 'slight_increase', content: `第${i}条`, ...(i === 0 ? { pin: true } : {}) });
    day(chatState, 8);
  }
  // 窗口外：第1～3条（第0条钉选）= 3 条，不到 5 条
  assert.equal(P(chatState).pregnant.fetalEvents.length, 6);
  event(chatState, { kind: 'fetal_reaction', change: 'slight_increase', content: '第6条' });
  day(chatState, 8);
  event(chatState, { kind: 'fetal_reaction', change: 'slight_increase', content: '第7条' });
  // 窗口外：第1～5条 = 5 条，整批并
  assert.deepEqual(P(chatState).pregnant.fetalEvents.map((item) => item.content), ['第0条', '第6条', '第7条']);
  assert.equal(P(chatState).pregnant.fetalEventSummary.count, 5);
});

test('压缩不再让递减与同日一次失效：被挤出去的照料仍在 7 天内', () => {
  const chatState = setup();
  event(chatState, { kind: 'medicine', change: 'significant_increase' });
  day(chatState);
  event(chatState, { kind: 'medicine', change: 'significant_increase' });
  for (let i = 0; i < 12; i += 1) event(chatState, { kind: 'fetal_reaction', change: 'slight_increase' });
  day(chatState);
  const before = P(chatState).pregnant.fetuses[0].health;
  event(chatState, { kind: 'medicine', change: 'significant_increase' });
  // 7 天内第三次：8 × 1/(1+2)
  assert.ok(Math.abs(P(chatState).pregnant.fetuses[0].health - before - 8 / 3) < 0.01, `${P(chatState).pregnant.fetuses[0].health - before}`);
  const view = buildFetalEventWindow(P(chatState).pregnant, chatState.reproductiveSettings, { minutesPassed: chatState.minutesPassed });
  assert.deepEqual(view.countedToday, ['medicine']);
});

test('全部钉选或全部在 7 天内时：先并最旧的非保留条目，都保留就停', () => {
  const fold = (summary, item) => ({ count: (summary?.count || 0) + 1, last: item.id });
  const list = [{ id: 1, pin: true }, { id: 2, pin: true }, { id: 3, keep: true }];
  const summary = compactRecordPile(list, null, { cap: 1, pinCap: 5, keep: (item) => item.keep }, fold);
  assert.deepEqual(list.map((item) => item.id), [3]);
  assert.equal(summary.count, 2);
  const kept = [{ id: 1, keep: true }, { id: 2, keep: true }];
  assert.equal(compactRecordPile(kept, null, { cap: 1, pinCap: 5, keep: (item) => item.keep }, fold), null);
  assert.equal(kept.length, 2);
});

test('pending 只留最新的上限条', () => {
  const chatState = setup({ fetalEventCap: 10, fetalEventWindow: 2, recordPinCap: 0 });
  for (let i = 0; i < RECORD_NOTES_PENDING_CAP + 15; i += 1) {
    event(chatState, { kind: 'fetal_reaction', change: 'slight_increase', content: `第${i}条` });
    day(chatState, 8);
  }
  const pending = P(chatState).pregnant.fetalEventSummary.pending;
  assert.equal(pending.length, RECORD_NOTES_PENDING_CAP);
  // 留的是最新并进去的：最后一条 pending 是还在纪录堆里那几条的前一条
  const stored = P(chatState).pregnant.fetalEvents.map((item) => Number(item.content.match(/\d+/)[0]));
  assert.equal(pending.at(-1).content, `第${Math.min(...stored) - 1}条`);
});

function overflow(chatState) {
  event(chatState, { kind: 'checkup', change: 'slight_increase', fetusIndex: 0, content: '产婆说第1胎胎盘偏低，不可提重物' });
  for (let i = 0; i < 10; i += 1) {
    day(chatState, 8);
    event(chatState, { kind: 'fetal_reaction', change: 'slight_increase' });
  }
  for (let i = 0; i < 12; i += 1) {
    applyToolCall(chatState, { name: 'bsRecordExperience', sourceId: `c${i}`, arguments: { female: 'A', action: 'cognition', time: `第${i}日`, method: i === 0 ? 'test' : 'guess', content: i === 0 ? '验孕棒两道线，确定怀孕了' : `第${i}个想法` } });
  }
}

test('整理请求的内容：事件用已知编号与中文类别，认知用得知方式；没有 pending 不送', () => {
  const chatState = setup();
  assert.equal(buildRecordNotesPayload('A', P(chatState)), null);
  overflow(chatState);
  const payload = buildRecordNotesPayload('A', P(chatState));
  assert.equal(payload.target_character, 'A');
  assert.deepEqual(payload.fetal_events.folded[0], { time: '第0日', kind: '产检治疗', change: '轻微增加', target: '第1胎', content: '产婆说第1胎胎盘偏低，不可提重物' });
  assert.equal(payload.fetal_events.previous_notes, '');
  assert.deepEqual(payload.cognition.folded[0], { time: '第0日', method: '检测', content: '验孕棒两道线，确定怀孕了' });
  assert.equal(payload.cognition.folded.length, 10);
  assert.match(buildRecordNotesSystemPrompt(), /照她的理解写，错的也照错的写/);
});

test('套用整理结果：写进 notes、清掉送出的 pending、截断过长；摘要行附上要点', () => {
  const chatState = setup();
  overflow(chatState);
  const profile = P(chatState);
  const payload = buildRecordNotesPayload('A', profile);
  // 等待期间又并进一条：只清掉送出去的
  profile.cognitionSummary.pending.push({ time: '新', method: 'guess', content: '新的' });
  const applied = applyRecordNotesResult(profile, payload, { fetal_event_notes: '第1胎胎盘偏低，产婆嘱咐不可提重物。', cognition_notes: `她验孕确认怀孕。${'很长'.repeat(400)}` });
  assert.deepEqual(applied, ['fetal_events', 'cognition']);
  assert.equal(profile.pregnant.fetalEventSummary.pending, undefined);
  assert.deepEqual(profile.cognitionSummary.pending.map((item) => item.content), ['新的']);
  assert.equal(profile.cognitionSummary.notes.length, 300);
  const events = buildFetalEventWindow(profile.pregnant, chatState.reproductiveSettings, { minutesPassed: chatState.minutesPassed });
  assert.match(events.earlier, /^更早 \d+ 条：.*。要点：第1胎胎盘偏低，产婆嘱咐不可提重物。$/);
  const cognition = buildCognitionWindow(profile.cognitionRecords, profile.cognitionSummary, chatState.reproductiveSettings);
  assert.match(cognition.earlier, /要点：她验孕确认怀孕。/);
});

test('模型漏了一项或给的不是字串：那一项的 pending 原样保留', () => {
  const chatState = setup();
  overflow(chatState);
  const profile = P(chatState);
  const payload = buildRecordNotesPayload('A', profile);
  assert.deepEqual(applyRecordNotesResult(profile, payload, { fetal_event_notes: 3 }), []);
  assert.ok(profile.pregnant.fetalEventSummary.pending.length > 0);
  assert.ok(profile.cognitionSummary.pending.length > 0);
});

test('summarizePendingRecords：每个有 pending 的角色一次请求，带目标角色；失败不抛错、pending 留着', async () => {
  const chatState = setup();
  overflow(chatState);
  const settings = { apiUrl: 'https://notes.example.test/v1', apiKey: 'k', model: 'm' };
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fetal_event_notes: '要点甲', cognition_notes: '要点乙' }) } }] }); } };
  };
  await summarizePendingRecords(settings, chatState);
  assert.equal(bodies.length, 1);
  const user = JSON.parse(bodies[0].messages.find((message) => message.role === 'user').content);
  assert.equal(user.target_character, 'A');
  assert.doesNotMatch(bodies[0].messages[0].content, /tool_calls/);
  assert.equal(P(chatState).pregnant.fetalEventSummary.notes, '要点甲');
  assert.equal(P(chatState).cognitionSummary.notes, '要点乙');
  assert.equal(P(chatState).cognitionSummary.pending, undefined);

  // 没有 pending 就不发请求
  await summarizePendingRecords(settings, chatState);
  assert.equal(bodies.length, 1);

  const failing = setup();
  overflow(failing);
  globalThis.fetch = async () => ({ ok: false, status: 500, async text() { return 'boom'; } });
  await summarizePendingRecords(settings, failing); // API 层会先重试 3 次（约 6 秒）
  assert.ok(P(failing).pregnant.fetalEventSummary.pending.length > 0);

  // 请求回来时聊天已换掉：结果作废
  const stale = setup();
  overflow(stale);
  globalThis.fetch = async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: '{"fetal_event_notes":"x"}' } }] }); } });
  await summarizePendingRecords(settings, stale, () => false);
  assert.equal(P(stale).pregnant.fetalEventSummary.notes, undefined);
});
