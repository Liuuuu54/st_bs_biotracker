// 1.3.0 胎儿健康：量表、bsFetalEvent、事件堆与送出窗口、见底中断、孩子摘要、v13 迁移、认知纪录上限。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { projectNarrativeState } from '../scripts/prompts/rules.js';
import { normalizeReproductiveSettings } from '../scripts/reproductive.js';
import { CARD_REPRODUCTIVE_FIELDS } from '../scripts/card_settings.js';
import {
  buildCognitionWindow, buildFetalEventWindow, buildPrenatalSummary, compactFetalEvents, getFetalHealthTier, normalizeRecordLimits,
} from '../scripts/fetal_health.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0,
  health: 50, ...over,
});

function setup({ stage = '孕中期', days = 120, fetuses = [fetus(1)], base = {}, immune = { metabolism: true }, settings = {}, minutesPassed = 0 } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.minutesPassed = minutesPassed;
  chatState.reproductiveSettings = normalizeReproductiveSettings(settings);
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 20, uterinePressure: 0, psyStress: 0,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1 },
      pregnant: { pregnantDays: days, effectivePregnantDays: days, fetusesCount: fetuses.length, fetalEnergyDrain: 0, nutritionBurst: {}, fetuses },
      experience: {}, immune, metabolism: {}, cooldown: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const F = (chatState) => P(chatState).pregnant.fetuses;
const event = (chatState, args, sourceId = '') => applyToolCall(chatState, {
  name: 'bsFetalEvent', sourceId, arguments: { female: 'A', time: '王历三年霜月七日', content: '一句白描', ...args },
});
const nextDay = (chatState) => { chatState.minutesPassed += 1440; };
const round4 = (value) => Math.round(value * 1e4) / 1e4;
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${label} ${actual} ≠ ${expected}`);

// ── 事件效果 ─────────────────────────────────────────

test('伤害作用于全部已着床胎儿，未着床的不受影响；毒物在孕早期 ×1.5', () => {
  const chatState = setup({ stage: '孕早期', days: 40, fetuses: [fetus(1), fetus(2), fetus(3, { pendingImplantation: true, health: undefined })] });
  const result = event(chatState, { kind: 'substance', change: 'significant_decrease' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(F(chatState).map((item) => item.health), [38, 38, undefined]);
  assert.match(P(chatState).notify.secondly, /腹中胎儿受到有害物质影响（明显）/);
});

test('fetusIndex 只动那一胎；每胎上限一律 100；increase/decrease 不改伤害与照料的方向', () => {
  const chatState = setup({ fetuses: [fetus(1), fetus(2, { health: 60 })] });
  event(chatState, { kind: 'illness', change: 'slight_increase', fetusIndex: 1 });
  assert.equal(F(chatState)[0].health, 50);
  near(F(chatState)[1].health, 60 - 3, '轻微 −3');
  event(chatState, { kind: 'rest', change: 'significant_decrease', fetusIndex: 0 });
  assert.equal(F(chatState)[0].health, 58, '照料一律加');
});

test('外伤：孕晚期 ×1.3，另加宫压（整个子宫一次）', () => {
  const chatState = setup({ stage: '孕晚期', days: 220, fetuses: [fetus(1), fetus(2)] });
  event(chatState, { kind: 'trauma', change: 'severe_decrease' });
  near(F(chatState)[0].health, 50 - 18 * 1.3);
  assert.equal(P(chatState).base.uterinePressure, 15);
  assert.match(P(chatState).notify.secondly, /宫压随之升高/);
  assert.equal(P(chatState).pregnant.fetalEvents[0].pressure, 15);
});

test('照料不超过 100；孕中孕被包着的那一胎伤害减半', () => {
  const chatState = setup({ fetuses: [fetus(1, { health: 98 }), fetus(2, { nestedInEmbryoId: 1 })] });
  event(chatState, { kind: 'medicine', change: 'significant_increase', fetusIndex: 0 });
  assert.equal(F(chatState)[0].health, 100);
  nextDay(chatState);
  event(chatState, { kind: 'curse', change: 'significant_decrease' });
  near(F(chatState)[1].health, 50 - 8 * 0.5);
});

// ── 防刷 ─────────────────────────────────────────

test('同一天同一 kind 只结算一次，第二次只留纪录；隔天照常', () => {
  const chatState = setup();
  event(chatState, { kind: 'substance', change: 'slight_decrease' });
  const again = event(chatState, { kind: 'substance', change: 'severe_decrease' });
  assert.equal(again.applied, true);
  assert.match(again.message, /already counted today/);
  assert.equal(F(chatState)[0].health, 47);
  assert.equal(P(chatState).pregnant.fetalEvents[1].counted, false);
  event(chatState, { kind: 'illness', change: 'slight_decrease' });
  assert.equal(F(chatState)[0].health, 44, '不同 kind 照算');
  nextDay(chatState);
  event(chatState, { kind: 'substance', change: 'slight_decrease' });
  assert.equal(F(chatState)[0].health, 41, '伤害不递减');
});

test('照料 7 天内重复递减 1/(1+n)，每天最多 +10', () => {
  const chatState = setup();
  event(chatState, { kind: 'rest', change: 'significant_increase' });
  nextDay(chatState);
  event(chatState, { kind: 'rest', change: 'significant_increase' });
  near(F(chatState)[0].health, 50 + 8 + 4);
  event(chatState, { kind: 'medicine', change: 'severe_increase' });
  near(F(chatState)[0].health, 50 + 8 + 10, '当天已用 4，只剩 6');
  for (let day = 0; day < 8; day += 1) nextDay(chatState);
  const before = F(chatState)[0].health;
  event(chatState, { kind: 'rest', change: 'slight_increase' });
  near(F(chatState)[0].health, before + 3, '7 天之后不再递减');
});

test('亲和：每天最多 ±2，延产期 ±4；同一 kind 递减', () => {
  const chatState = setup();
  event(chatState, { kind: 'bonding', change: 'severe_increase' });
  assert.equal(F(chatState)[0].affinity, 2);
  nextDay(chatState);
  event(chatState, { kind: 'bonding', change: 'severe_increase' });
  assert.equal(F(chatState)[0].affinity, 3, '第二次 ×1/2');
  const extended = setup({ stage: '延产期', days: 300 });
  event(extended, { kind: 'bonding', change: 'severe_increase' });
  assert.equal(F(extended)[0].affinity, 4);
});

test('亲近与疏离：方向看类别，change 只看程度；一定要给 change；情压不影响结果', () => {
  const chatState = setup({ base: { psyStress: 400 } });
  event(chatState, { kind: 'bonding', change: 'significant_decrease' });
  assert.equal(F(chatState)[0].affinity, 1, '亲近一律加');
  assert.match(P(chatState).notify.secondly, /更亲近了（明显）/);
  const cold = setup();
  event(cold, { kind: 'estrangement', change: 'significant_increase' });
  assert.equal(F(cold)[0].affinity, -1, '疏离一律减');
  assert.match(P(cold).notify.secondly, /疏远了/);
  assert.match(event(setup(), { kind: 'bonding' }).message, /change must be/);
});

test('1.3.0 开发期间用过的 soothe／fetal_reaction 读到时按方向换成亲近或疏离', async () => {
  const { normalizeFetalEventList } = await import('../scripts/fetal_health.js');
  const base = { time: '一日', content: '一句', effects: {}, counted: true };
  const list = normalizeFetalEventList([
    { ...base, kind: 'soothe', change: 'slight_increase' },
    { ...base, kind: 'soothe', change: 'significant_decrease', failed: true },
    { ...base, kind: 'fetal_reaction', change: 'slight_decrease' },
    { ...base, kind: 'fetal_reaction' },
  ]);
  assert.deepEqual(list.map((item) => item.kind), ['bonding', 'estrangement', 'estrangement', 'bonding']);
  assert.equal('failed' in list[1], false);
});

test('同一来源（同一则讯息重新追踪）只记一次；没有已着床胎儿时拒绝', () => {
  const chatState = setup();
  event(chatState, { kind: 'substance', change: 'slight_decrease' }, 'msg-1:0');
  assert.equal(event(chatState, { kind: 'substance', change: 'slight_decrease' }, 'msg-1:0').unchanged, true);
  assert.equal(P(chatState).pregnant.fetalEvents.length, 1);
  const none = setup({ fetuses: [fetus(1, { pendingImplantation: true })] });
  assert.equal(event(none, { kind: 'rest', change: 'slight_increase' }).applied, false);
  assert.match(event(setup(), { kind: 'bogus', change: 'slight_increase' }).message, /unknown kind/);
});

// ── 事件堆与窗口 ─────────────────────────────────────────

test('事件堆超过上限时最旧、没钉选的并进摘要；钉选超过上限保留最新的', () => {
  const chatState = setup({ settings: { fetalEventCap: 10, recordPinCap: 2 } });
  for (let day = 0; day < 13; day += 1) {
    event(chatState, { kind: 'rest', change: 'slight_increase', time: `第${day + 1}日`, pin: day < 3 });
    nextDay(chatState);
  }
  const pregnant = P(chatState).pregnant;
  assert.equal(pregnant.fetalEvents.length, 10);
  assert.equal(pregnant.fetalEventSummary.count, 3);
  assert.equal(pregnant.fetalEvents.filter((item) => item.pin).length, 2);
  assert.deepEqual(pregnant.fetalEvents.filter((item) => item.pin).map((item) => item.time), ['第2日', '第3日']);
  assert.equal(pregnant.fetalEventSummary.from, '第1日');
});

test('送出窗口：最近几条加钉选，更早的一行摘要；今天已结算的 kind', () => {
  const pregnant = { fetalEvents: [] };
  for (let i = 0; i < 8; i += 1) {
    pregnant.fetalEvents.push({ time: `第${i}日`, kind: i % 2 ? 'rest' : 'substance', content: `事${i}`, storyDayIndex: i, effects: { 1: { health: 1 } }, counted: true, pin: i === 1 });
  }
  const window = buildFetalEventWindow(pregnant, { fetalEventWindow: 3 }, { minutesPassed: 7 * 1440, labelFetuses: () => '第1胎' });
  assert.deepEqual(window.events.map((item) => item.time), ['第1日', '第5日', '第6日', '第7日']);
  assert.match(window.earlier, /^更早 4 条：有害物质3、充分休养1（第0日～第4日）$/);
  assert.deepEqual(window.countedToday, ['rest']);
  const none = buildFetalEventWindow(pregnant, { fetalEventWindow: 0 }, { labelFetuses: () => '' });
  assert.deepEqual(none.events.map((item) => item.time), ['第1日'], '窗口 0 只送钉选');
});

test('设定：五个条数夹在范围内，可以绑卡', () => {
  assert.deepEqual(normalizeRecordLimits({ fetalEventCap: 3, fetalEventWindow: 99, cognitionCap: 500, cognitionWindow: -1, recordPinCap: 4.6 }),
    { fetalEventCap: 10, fetalEventWindow: 30, cognitionCap: 200, cognitionWindow: 0, recordPinCap: 5 });
  const defaults = normalizeReproductiveSettings();
  assert.deepEqual([defaults.fetalEventCap, defaults.fetalEventWindow, defaults.cognitionCap, defaults.cognitionWindow, defaults.recordPinCap], [30, 5, 40, 8, 5]);
  for (const key of ['fetalEventCap', 'fetalEventWindow', 'cognitionCap', 'cognitionWindow', 'recordPinCap']) assert.ok(CARD_REPRODUCTIVE_FIELDS.includes(key));
});

test('改小上限不会立刻删纪录，下一次写入才压缩', () => {
  // 窗口开到 30：全部都在窗口里，只看保存上限（按批并进摘要另有测试）
  const chatState = setup({ settings: { fetalEventWindow: 30 } });
  for (let day = 0; day < 15; day += 1) { event(chatState, { kind: 'rest', change: 'slight_increase' }); nextDay(chatState); }
  chatState.reproductiveSettings = normalizeReproductiveSettings({ fetalEventCap: 10, fetalEventWindow: 30 });
  assert.equal(P(chatState).pregnant.fetalEvents.length, 15);
  event(chatState, { kind: 'rest', change: 'slight_increase' });
  assert.equal(P(chatState).pregnant.fetalEvents.length, 10);
  assert.equal(P(chatState).pregnant.fetalEventSummary.count, 6);
});

// ── 孩子摘要与妊娠结束 ─────────────────────────────────────────

test('出生时孩子只留摘要（压缩过的部分也算），事件堆清掉', () => {
  const chatState = setup({ stage: '孕晚期', days: 250, settings: { fetalEventCap: 10 } });
  for (let day = 0; day < 12; day += 1) { event(chatState, { kind: 'rest', change: 'slight_increase' }); nextDay(chatState); }
  event(chatState, { kind: 'substance', change: 'severe_decrease', content: '她在酒馆喝了半夜' });
  nextDay(chatState);
  event(chatState, { kind: 'substance', change: 'slight_decrease', content: '喝了一杯' });
  assert.ok(P(chatState).pregnant.fetalEventSummary.count > 0);
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A' } });
  const child = P(chatState).children[0];
  assert.equal(child.prenatalSummary.harm, 2);
  assert.equal(child.prenatalSummary.care, 12);
  assert.deepEqual(child.prenatalSummary.worst, { kind: 'substance', content: '她在酒馆喝了半夜' });
  assert.ok(child.prenatalSummary.birthHealthRatio > 0 && child.prenatalSummary.birthHealthRatio < 1);
  assert.deepEqual(P(chatState).pregnant.fetalEvents, []);
  assert.equal(P(chatState).pregnant.fetalEventSummary, undefined);
});

test('被防刷挡下的事件不算进孩子摘要', () => {
  const pregnant = { fetalEvents: [
    { time: 'a', kind: 'substance', content: 'x', effects: { 1: { health: -3 } }, counted: true },
    { time: 'a', kind: 'substance', content: 'y', effects: {}, counted: false },
  ] };
  compactFetalEvents(pregnant, {});
  assert.equal(buildPrenatalSummary(pregnant, fetus(1)).harm, 1);
});

// ── 周结算与见底 ─────────────────────────────────────────

const passWeek = (chatState) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 7 } });

test('见底：第一次周结算只警告，下一次仍见底才流产；单胎整个妊娠结束', () => {
  const chatState = setup({ stage: '孕中期', days: 120, fetuses: [fetus(1, { health: 2 })] });
  passWeek(chatState);
  assert.equal(P(chatState).base.stage, '孕中期');
  assert.equal(F(chatState)[0].healthWarned, true);
  assert.match(P(chatState).notify.thirdly, /健康已到危急，下一次周结算仍未好转就会流产/);
  F(chatState)[0].health = 3;
  passWeek(chatState);
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).experience.miscarriageExperience, 1);
  assert.match(P(chatState).notify.secondly, /健康衰竭，流产了/);
});

test('见底后回升就解除警告', () => {
  const chatState = setup({ fetuses: [fetus(1, { health: 2 })] });
  passWeek(chatState);
  F(chatState)[0].health = 40;
  passWeek(chatState);
  assert.equal(F(chatState)[0].healthWarned, undefined);
  assert.equal(P(chatState).base.stage, '孕中期');
});

test('多胎孕早中期只吸收见底那一胎（连同它体内的孕中孕）；不知道的那胎不曝光', () => {
  Math.random = () => 0.99; // 不让自然胎动换左右，编号才固定
  const chatState = setup({ fetuses: [fetus(1), fetus(2, { health: 2, healthWarned: true }), fetus(3, { nestedInEmbryoId: 2 })] });
  F(chatState)[1].health = 1;
  passWeek(chatState);
  assert.deepEqual(F(chatState).map((item) => item.embryoId), [1]);
  assert.match(P(chatState).notify.secondly, /第2胎停止发育，被母体吸收了/);
  const hidden = setup({ stage: '孕早期', days: 60, fetuses: [fetus(1), fetus(2, { health: 1, healthWarned: true, conceivedAtDays: 30, revealed: false })] });
  passWeek(hidden);
  assert.equal(F(hidden).length, 1);
  assert.match(P(hidden).notify.secondly, /少量出血/);
  assert.doesNotMatch(P(hidden).notify.secondly, /第2胎/);
});

test('孕晚期见底改为早产；流产免疫停在 1%', () => {
  const late = setup({ stage: '孕晚期', days: 220, fetuses: [fetus(1, { health: 1, healthWarned: true })] });
  passWeek(late);
  assert.equal(P(late).base.stage, '产兆前驱');
  assert.match(P(late).notify.secondly, /提早出现了分娩前兆/);
  const immune = setup({ fetuses: [fetus(1, { health: 0, healthWarned: true })], immune: { metabolism: true, miscarriage: true } });
  passWeek(immune);
  assert.equal(P(immune).base.stage, '孕中期');
  assert.ok(F(immune)[0].health >= 1);
});

test('一次跳很多周：每周各结算一次，没有照料也没有疏忽时收敛到一半', () => {
  const chatState = setup({ fetuses: [fetus(1, { health: 90 })] });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 84 } });
  assert.ok(Math.abs(F(chatState)[0].health - 50) < 3, `健康 ${F(chatState)[0].health}`);
  assert.equal(getFetalHealthTier(F(chatState)[0]).label, '平稳');
  assert.ok(F(chatState)[0].weight > 1, '先前健壮的那几周长得比标准多');
});

// ── 受精、同卵、迁移 ─────────────────────────────────────────

test('v12 → v13：每周供养池换成健康（50 ＋ 池换算），母胎互动冷却丢掉，事件堆从空开始', () => {
  const ctx = { chatId: 'v13', characters: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const old = setup({ fetuses: [fetus(1, { health: undefined, nutrition: 20 }), fetus(2, { health: undefined, nutrition: -10 })] });
  old.schemaVersion = 12;
  P(old).cooldown = { maternalFetalInteractionUsed: true };
  delete P(old).pregnant.fetalEvents;
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 14);
  const [a, b] = migrated.characters.A.profile.pregnant.fetuses;
  assert.equal('healthMax' in a, false);
  near(a.health, 50 + 20 * 0.18);
  near(b.health, 50 - 10 * 0.9);
  assert.equal('nutrition' in a, false);
  assert.deepEqual(migrated.characters.A.profile.pregnant.fetalEvents, []);
  assert.equal('maternalFetalInteractionUsed' in migrated.characters.A.profile.cooldown, false);
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  near(migrated.characters.A.profile.pregnant.fetuses[0].health, 50 + 20 * 0.18, '快照一并迁移');
});

test('1.3.0 开发期间各胎上限不同：读到时按比例换成 100 分制，刻度不变', async () => {
  const { normalizeFetalHealthFields } = await import('../scripts/fetal_health.js');
  const old = normalizeFetalHealthFields({ healthMax: 120, health: 90 });
  assert.deepEqual(old, { health: 75 });
  assert.equal(getFetalHealthTier(old).label, '健壮');
});

test('工具清单：bsFetalEvent 取代 bsMaternalFetalInteraction', () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.name);
  assert.ok(names.includes('bsFetalEvent'));
  assert.equal(names.includes('bsMaternalFetalInteraction'), false);
  const assist = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsAssistFetalPosition');
  assert.ok(assist.input_schema.properties.action.enum.includes('sibling'));
});

// ── 提示词 ─────────────────────────────────────────

function trackerProfile(chatState) {
  const ctx = {
    chatId: 'fh-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'fh-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state.A.profile;
}

test('追踪视角：每胎只送健康刻度，没有数值；事件只送窗口；主线不送事件', () => {
  const chatState = setup({ fetuses: [fetus(1, { health: 80 }), fetus(2, { health: 9 })] });
  event(chatState, { kind: 'substance', change: 'slight_decrease', fetusIndex: 1, pin: true });
  const profile = trackerProfile(chatState);
  assert.deepEqual(profile.pregnant.fetuses.map((item) => item.health), ['健壮', '危急']);
  assert.equal('healthMax' in profile.pregnant.fetuses[0], false);
  assert.equal('nutrition' in profile.pregnant, false);
  assert.deepEqual(profile.pregnant.fetalEvents.events.map((item) => [item.kind, item.target, item.pin]), [['substance', '第2胎', true]]);
  assert.deepEqual(profile.pregnant.fetalEvents.countedToday, ['substance']);
  const narrative = projectNarrativeState({ A: { name: 'A', profile } });
  assert.equal('fetalEvents' in narrative.A.profile.pregnant, false);
  assert.equal(narrative.A.profile.pregnant.fetuses[0].health, '健壮');
});

const care = (chatState, prenatalCare, female = 'A') => applyToolCall(chatState, {
  name: 'bsRecordExperience', arguments: { female, action: 'cognition', time: '一日', method: 'prenatal', content: '产婆确认有孕', prenatalCare },
});

test('产前护理：随认知设定，跟着这次妊娠；没有已着床胎儿时只记认知；不合法的档位拒绝', () => {
  const chatState = setup();
  assert.equal(care(chatState, 'attentive').applied, true);
  assert.equal(P(chatState).pregnant.prenatalCare, 'attentive');
  assert.equal(P(chatState).cognitionRecords.length, 1);
  assert.match(care(chatState, 'diligent').message, /prenatalCare 须为/);
  const early = setup({ stage: '孕早期', days: 3, fetuses: [fetus(1, { pendingImplantation: true })] });
  const result = care(early, 'neglect');
  assert.equal(result.applied, true);
  assert.match(result.message, /没有记下/);
  assert.equal('prenatalCare' in P(early).pregnant, false);
  assert.equal(P(early).cognitionRecords.length, 1);
  assert.match(applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'date', time: '一日', partner: '乙', prenatalCare: 'normal' } }).message, /不属于该 action/);
});

test('产前护理改周回归的目标：用心往 60、疏忽往 35、没设定往 50；妊娠结束时清掉', () => {
  const run = (level) => {
    const chatState = setup();
    if (level) care(chatState, level);
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 84 } });
    return F(chatState)[0];
  };
  const [attentive, neglect, none] = [run('attentive'), run('neglect'), run(null)];
  assert.ok(Math.abs(attentive.health - 60) < 1.5, `用心 ${attentive.health}`);
  assert.ok(Math.abs(neglect.health - 35) < 1.5, `疏忽 ${neglect.health}`);
  assert.ok(Math.abs(none.health - 50) < 1e-6, `没设定 ${none.health}`);
  assert.ok(attentive.weight > 1 && neglect.weight < 1 && none.weight === 1);
  const ended = setup({ fetuses: [fetus(1, { health: 2 })] });
  care(ended, 'neglect');
  passWeek(ended);
  F(ended)[0].health = 1;
  passWeek(ended);
  assert.equal(P(ended).base.stage, '产后恢复');
  assert.equal('prenatalCare' in P(ended).pregnant, false);
});

const withPsychology = (chatState, side, values) => {
  P(chatState).psychology = { enabled: true, activeSide: side, stageProfiles: { mens: {}, preg: {} }, [side]: values };
  return chatState;
};
const feel = (chatState, psychology, extra = {}) => applyToolCall(chatState, {
  name: 'bsRecordExperience', arguments: { female: 'A', action: 'cognition', time: '一日', method: 'perception', content: '她对着肚子发了一会儿呆', psychology, ...extra },
});

test('心理变化挂在认知纪录上：轻微 2、明显 5、严重 10，方向看 increase／decrease，效果记在那一条', () => {
  const chatState = withPsychology(setup(), 'preg', { confidence_value: 40, acceptance_value: 50, stance_value: 95 });
  const result = feel(chatState, { acceptance: 'significant_increase', confidence: 'slight_decrease', stance: 'severe_increase' });
  assert.equal(result.applied, true);
  const preg = P(chatState).psychology.preg;
  assert.deepEqual([preg.confidence_value, preg.acceptance_value, preg.stance_value], [38, 55, 100]);
  assert.match(preg.acceptance_interpret, /\S/);
  assert.deepEqual(P(chatState).cognitionRecords.at(-1).psychology, { confidence: -2, acceptance: 5, stance: 5 });
  assert.match(result.message, /心理变化：/);
});

test('心理变化只动当前这一侧；同一轴同一个故事日只算一次；格式不对整条拒绝', () => {
  const chatState = withPsychology(setup(), 'preg', { confidence_value: 40, acceptance_value: 50, stance_value: 50 });
  const wrongSide = feel(chatState, { desire: 'slight_increase' });
  assert.match(wrongSide.message, /不属于目前的妊娠心理/);
  assert.equal(P(chatState).cognitionRecords.at(-1).psychology, undefined, '认知照记，心理不动');
  feel(chatState, { acceptance: 'slight_increase' });
  const again = feel(chatState, { acceptance: 'severe_increase', confidence: 'slight_increase' });
  assert.match(again.message, /接受今天已经变动过/);
  assert.deepEqual([P(chatState).psychology.preg.acceptance_value, P(chatState).psychology.preg.confidence_value], [52, 42]);
  nextDay(chatState);
  feel(chatState, { acceptance: 'slight_increase' });
  assert.equal(P(chatState).psychology.preg.acceptance_value, 54, '隔天照常');
  const count = P(chatState).cognitionRecords.length;
  assert.match(feel(chatState, { acceptance: 'up' }).message, /psychology 须为/);
  assert.match(feel(chatState, {}).message, /psychology 须为/);
  assert.equal(P(chatState).cognitionRecords.length, count);
});

test('v13 → v14：妊娠侧的 bonding 改名 acceptance（数值、解释、专属阶段解释、认知上的变化），快照一并迁移', async () => {
  const { migrateCharacters } = await import('../scripts/state_migration.js');
  const characters = { A: { name: 'A', profile: {
    psychology: { enabled: true, activeSide: 'preg', preg: { confidence_value: 40, bonding_value: 66, bonding_interpret: '旧解释', stance_value: 20 }, stageProfiles: { preg: { bonding: { '51_75': '专属' } } } },
    cognitionRecords: [{ time: '一日', method: 'perception', content: '一句', psychology: { bonding: 2 } }],
  } } };
  migrateCharacters(characters, 13);
  const psy = characters.A.profile.psychology;
  assert.deepEqual([psy.preg.acceptance_value, psy.preg.acceptance_interpret, 'bonding_value' in psy.preg], [66, '旧解释', false]);
  assert.deepEqual(psy.stageProfiles.preg, { acceptance: { '51_75': '专属' } });
  assert.deepEqual(characters.A.profile.cognitionRecords[0].psychology, { acceptance: 2 });

  // 楼层快照是相对新版预设角色的差异：还原后新键先是 null，旧值仍要搬过去（真机上踩过）
  const ctx = { chatId: 'v14', characters: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const old = setup();
  P(old).psychology = { enabled: true, activeSide: 'preg', preg: { confidence_value: 52, bonding_value: 70, stance_value: 35 }, stageProfiles: { preg: { bonding: { '51_75': '专属' } } } };
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  // 旧版写的快照带着 bonding（新版记录快照时会先正规化掉，这里手动补回旧版的样子）
  old.snapshots[0].stateSnapshot.characters.A.profile.psychology.preg.bonding_value = 70;
  old.schemaVersion = 13;
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.characters.A.profile.psychology.preg.acceptance_value, 70);
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.equal(migrated.characters.A.profile.psychology.preg.acceptance_value, 70, '快照还原后仍是 70');
  assert.equal('bonding_value' in migrated.characters.A.profile.psychology.preg, false);
});

test('未孕时动 mens 三轴；不限于怀孕的心境经历用 experience 记；没有独立的心理工具', () => {
  const chatState = withPsychology(setup({ stage: '卵泡期', days: 0, fetuses: [] }), 'mens', { mastery_value: 30, desire_value: 30, autonomy_value: 30 });
  feel(chatState, { desire: 'significant_increase' });
  assert.equal(P(chatState).psychology.mens.desire_value, 35);
  const result = feel(chatState, { autonomy: 'significant_increase' }, { method: 'experience', content: '那一夜她第一次翻身压住他，自己定了节奏' });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).cognitionRecords.at(-1).method, 'experience');
  assert.equal(P(chatState).psychology.mens.autonomy_value, 35);
  assert.equal(TOOL_DEFINITIONS.some((tool) => tool.name === 'bsUpdatePsychology'), false);
  assert.equal(applyToolCall(chatState, { name: 'bsUpdatePsychology', arguments: { female: 'A', options: { mens: { desire: 2 } } } }).applied, false);
});

test('追踪页的认知摘要一行：次数、方式、日期与要点；没有摘要回空字串', async () => {
  const { describeCognitionSummary } = await import('../scripts/fetal_health.js');
  assert.equal(describeCognitionSummary(null), '');
  const line = describeCognitionSummary({ count: 3, methods: { prenatal: 2, guess: 1 }, from: '霜月一日', to: '霜月九日', notes: '产婆说胎位正' });
  assert.match(line, /^更早 3 条：/);
  assert.match(line, /要点：产婆说胎位正/);
});

test('追踪视角：设定过产前护理才送文字，没设定不送', () => {
  const chatState = setup();
  assert.equal('prenatalCare' in trackerProfile(chatState).pregnant, false);
  care(chatState, 'neglect');
  assert.equal(trackerProfile(chatState).pregnant.prenatalCare, '疏忽');
});

test('认知纪录：pin、保存上限与送出窗口；进月经刷新时摘要一起清掉', () => {
  const chatState = setup({ settings: { cognitionCap: 10, cognitionWindow: 2 } });
  const record = (i, pin = false) => applyToolCall(chatState, {
    name: 'bsRecordExperience', sourceId: `c${i}`,
    arguments: { female: 'A', action: 'cognition', time: `第${i}日`, method: i % 2 ? 'guess' : 'perception', content: `认知${i}`, ...(pin ? { pin } : {}) },
  });
  for (let i = 0; i < 12; i += 1) record(i, i === 3);
  const profile = P(chatState);
  // 窗口外累积到 5 条（第0、1、2、4、5日）时整批并进摘要
  assert.deepEqual(profile.cognitionRecords.map((item) => item.time), ['第3日', '第6日', '第7日', '第8日', '第9日', '第10日', '第11日']);
  assert.equal(profile.cognitionSummary.count, 5);
  const window = buildCognitionWindow(profile.cognitionRecords, profile.cognitionSummary, chatState.reproductiveSettings);
  assert.deepEqual(window.records.map((item) => item.time), ['第3日', '第10日', '第11日']);
  assert.match(window.earlier, /^更早 9 条：/);
  const view = trackerProfile(chatState);
  assert.deepEqual(view.cognitionRecords.map((item) => item.time), ['第3日', '第10日', '第11日']);
  assert.equal(view.cognitionRecords[0].pin, true);
  assert.match(view.cognitionEarlier, /更早 9 条/);
  assert.equal('cognitionSummary' in view, false);
  assert.match(applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'cognition', time: 'x', method: 'guess', content: 'y', pin: 'yes' } }).message, /pin 须为布尔值/);
});

// ── 耐受：母体体质 × 胎儿顽强度 ─────────────────────────────────────────

test('耐受系数：母体活力等级 7 ×0.5、1 ×1.5；精子品质^−0.5 夹在 0.5～1.5', async () => {
  const { getMaternalResilience, getFetusQualityTenacity, getFetalHarmFactor, describeFetalResilience } = await import('../scripts/fetal_health.js');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(getMaternalResilience), [1.5, 1.3, 1.15, 1, 0.85, 0.7, 0.5]);
  assert.equal(getMaternalResilience(undefined), 1);
  assert.deepEqual([0.25, 1, 4, undefined].map((q) => getFetusQualityTenacity({ spermQuality: q })), [1.5, 1, 0.5, 1]);
  assert.equal(getFetalHarmFactor({ base: { vitalityLevel: 7 } }, { spermQuality: 4 }), 0.25);
  assert.deepEqual([0.25, 0.6, 1, 1.29, 1.3, 2.25].map(describeFetalResilience), ['顽强', '顽强', '', '', '脆弱', '脆弱']);
});

test('胎儿顽强度另看胎儿族的繁育耐受^−0.3（夹 0.6～1.4）与核型：雄核 ×0.75、雌核 ×1.33', async () => {
  const { getFetalHarmBreakdown, getFetusSpeciesTenacity, getFetusNucleusTenacity } = await import('../scripts/fetal_health.js');
  const mother = { base: { vitalityLevel: 4 } };
  near(getFetusSpeciesTenacity({ race: '人类' }), 1, '人类');
  near(getFetusSpeciesTenacity({ race: '人类x米诺陶族' }), round4(3 ** -0.3), '混血取平均耐受 3');
  near(getFetusSpeciesTenacity({ race: '袋兽族' }), 1.4, '夹到 1.4');
  near(getFetusSpeciesTenacity({}), 1, '没有种族当 1');
  assert.equal(getFetusNucleusTenacity({ tags: ['androgenesis'] }), 0.75);
  assert.equal(getFetusNucleusTenacity({ tags: ['gynogenesis', 'identical'] }), 1.33);
  assert.equal(getFetusNucleusTenacity({ tags: ['identical'] }), 1);
  assert.equal(getFetusNucleusTenacity({ tags: ['androgenesis', 'gynogenesis'] }), 1, '嵌合胎两种核型都有时抵消');
  assert.deepEqual(getFetalHarmBreakdown(mother, { race: '哥布林', tags: ['androgenesis'], spermQuality: 1 }), { maternal: 1, quality: 1, species: 1, nucleus: 0.75, factor: 0.75 });
  assert.equal(getFetalHarmBreakdown(mother, { race: '人类', tags: ['gynogenesis'] }).factor, 1.33);
  // 总值夹在 0.2～2.5
  assert.equal(getFetalHarmBreakdown({ base: { vitalityLevel: 7 } }, { race: '米诺陶族', tags: ['androgenesis'], spermQuality: 4 }).factor, 0.2);
  assert.equal(getFetalHarmBreakdown({ base: { vitalityLevel: 1 } }, { race: '袋兽族', tags: ['gynogenesis'], spermQuality: 0.25 }).factor, 2.5);
});

test('雄核孽种：真实受孕的哥布林胎带 androgenesis，喝酒扣得比人类胎少（×0.75）', () => {
  Math.random = () => 0.5;
  const goblin = setup({ stage: '卵泡期', days: 0, fetuses: [] });
  assert.equal(applyToolCall(goblin, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: '哥布林甲', race: '哥布林' } }).applied, true);
  assert.equal(F(goblin)[0].race, '哥布林');
  assert.ok(F(goblin)[0].tags.includes('androgenesis'));
  Object.assign(F(goblin)[0], { health: 50, spermQuality: 1 });
  P(goblin).base.stage = '孕中期';
  const human = setup({ fetuses: [fetus(1)] });
  event(goblin, { kind: 'substance', change: 'significant_decrease' });
  event(human, { kind: 'substance', change: 'significant_decrease' });
  near(50 - F(goblin)[0].health, (50 - F(human)[0].health) * 0.75);
  const view = trackerProfile(setup({ base: { vitalityLevel: 6 }, fetuses: [fetus(1, { race: '哥布林', tags: ['androgenesis'] })] }));
  assert.equal(view.pregnant.fetuses[0].resilience, '顽强', '6 级 ×0.7 × 雄核 0.75 = 0.525');
  const gyno = trackerProfile(setup({ base: { vitalityLevel: 3 }, fetuses: [fetus(1, { tags: ['gynogenesis'] })] }));
  assert.equal(gyno.pregnant.fetuses[0].resilience, '脆弱', '3 级 ×1.15 × 雌核 1.33 = 1.53');
});

test('伤害事件与疏忽扣分乘耐受系数，照料加分不乘', () => {
  const strong = setup({ base: { vitalityLevel: 7 }, fetuses: [fetus(1, { spermQuality: 4 })] });
  event(strong, { kind: 'substance', change: 'significant_decrease' });
  near(F(strong)[0].health, 50 - 8 * 0.25);
  nextDay(strong);
  event(strong, { kind: 'rest', change: 'significant_increase' });
  near(F(strong)[0].health, 50 - 2 + 8, '照料照常');

  const weak = setup({ base: { vitalityLevel: 1 }, fetuses: [fetus(1, { spermQuality: 0.25 })], immune: {} });
  P(weak).metabolism = { excretion: 0, hunger: 0, sleep: 140, milk: 0, odor: 0, companionship: 0 };
  P(weak).pregnant.nutritionBurst = {};
  applyToolCall(weak, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
  const strongNeglect = setup({ base: { vitalityLevel: 7 }, fetuses: [fetus(1, { spermQuality: 4 })], immune: {} });
  P(strongNeglect).metabolism = { excretion: 0, hunger: 0, sleep: 140, milk: 0, odor: 0, companionship: 0 };
  applyToolCall(strongNeglect, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
  near((50 - F(weak)[0].health) / (50 - F(strongNeglect)[0].health), 2.25 / 0.25, '疏忽扣分按耐受系数比例');
});

test('受孕时记下精子品质快照；追踪视角只在明显偏离时送顽强／脆弱', () => {
  const chatState = setup({ base: { vitalityLevel: 7 }, fetuses: [fetus(1, { spermQuality: 4 }), fetus(2, { spermQuality: 0.25 })] });
  const profile = trackerProfile(chatState);
  assert.equal(profile.pregnant.fetuses[0].resilience, '顽强');
  assert.equal('resilience' in profile.pregnant.fetuses[1], false, '7 级 × 品质 0.25 是 ×0.75，一般不送');
  assert.equal('spermQuality' in profile.pregnant.fetuses[0], false, '数值不外露');
  const warned = setup({ fetuses: [fetus(1, { health: 5, healthWarned: true, healthWarnedAt: 118 })] });
  const warnedView = trackerProfile(warned).pregnant.fetuses[0];
  assert.equal(warnedView.health, '危急');
  assert.equal('healthWarnedAt' in warnedView, false, '警告时刻也不外露');
  const weak = trackerProfile(setup({ base: { vitalityLevel: 1 }, fetuses: [fetus(1)] }));
  assert.equal(weak.pregnant.fetuses[0].resilience, '脆弱');
});

// ── 按孕周结算与搶救缓冲 ─────────────────────────────────────────

test('周结算按孕周：孕速 20 的物种一个日历天就结算约 3 次，胎重成长与人类每孕周相同', () => {
  Math.random = () => 0.99;
  const bird = setup({ base: { race: '怪鸟类' }, days: 140, fetuses: [fetus(1, { race: '怪鸟类', health: 90 })] });
  P(bird).bio.gestationSpeciesSpeed = 20;
  applyToolCall(bird, { name: 'bsPassedTime', arguments: { hour: 24 } });
  const weeks = P(bird).pregnant.healthSettledWeek - 20;
  assert.ok(weeks >= 2 && weeks <= 3, `结算 ${weeks} 次`);
  near(F(bird)[0].weight, Math.exp(0.024 + 0.0192 + (weeks === 3 ? 0.01536 : 0)), '每孕周 Δ =（比例 − 0.5）× 0.06');
});

test('搶救缓冲：快孕物种见底警告后要过满 1 个日历天，下一次结算仍见底才中断', () => {
  Math.random = () => 0.99;
  const bird = setup({ base: { race: '怪鸟类' }, days: 140, fetuses: [fetus(1, { race: '怪鸟类', health: 0 })] });
  P(bird).bio.gestationSpeciesSpeed = 20;
  const hold = () => { F(bird)[0].health = 0; };
  applyToolCall(bird, { name: 'bsPassedTime', arguments: { hour: 12 } });
  assert.equal(P(bird).base.stage, '孕中期');
  assert.equal(F(bird)[0].healthWarned, true);
  const warnedAt = F(bird)[0].healthWarnedAt;
  hold();
  applyToolCall(bird, { name: 'bsPassedTime', arguments: { hour: 10 } });
  assert.equal(P(bird).base.stage, '孕中期', '警告后还不到一天，不中断');
  assert.equal(F(bird)[0].healthWarnedAt, warnedAt);
  hold();
  applyToolCall(bird, { name: 'bsPassedTime', arguments: { hour: 16 } });
  assert.equal(P(bird).base.stage, '产后恢复', '过满一天后仍见底就流产');
});

// ── 胎儿守护（精方作弊）─────────────────────────────────────────

test('胎儿守护：父方在场、母体在场时每小时回复 2%，只回到一半；高于一半不动', async () => {
  const { normalizeSireRecord } = await import('../scripts/sires.js');
  const chatState = setup({ fetuses: [fetus(1, { health: 10 }), fetus(2, { health: 80 }), fetus(3, { health: 10, fathers: '乙' })] });
  chatState.sires.甲 = normalizeSireRecord({ race: '人类', fetalGuard: true, isHere: true });
  // 胎动会调换阵列里的左右顺序，按 embryoId 取
  const byId = (id) => F(chatState).find((item) => item.embryoId === id);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 10 } });
  near(byId(1).health, 30, '10 小时 +20');
  near(byId(2).health, 80, '高于一半不动');
  near(byId(3).health, 10, '别人的胎不受影响');
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 20 } });
  near(byId(1).health, 50, '回到一半为止');
});

test('胎儿守护的条件：没勾、父方离场、母体离场都不回复；嵌合胎有一位父方在场就算', async () => {
  const { normalizeSireRecord, upsertSireRecord } = await import('../scripts/sires.js');
  const run = (sire, base = {}, over = {}) => {
    const chatState = setup({ base, fetuses: [fetus(1, { health: 10, ...over })] });
    if (sire) chatState.sires.甲 = normalizeSireRecord({ race: '人类', ...sire });
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 5 } });
    return F(chatState)[0].health;
  };
  near(run({ fetalGuard: false, isHere: true }), 10, '没勾');
  near(run({ fetalGuard: true, isHere: false }), 10, '父方离场');
  near(run({ fetalGuard: true, isHere: true }, { isHere: false }), 10, '母体离场');
  near(run({ fetalGuard: true, isHere: true }, {}, { fathers: '乙×甲', chimera: { sourceCount: 2, fatherSources: ['乙', '甲'] } }), 20, '嵌合胎');
  // 使用者勾的开关跟着档案走；模型的整理结果带不进来
  const chatState = setup();
  upsertSireRecord(chatState, '甲', { race: '人类', fetalGuard: true });
  assert.equal(chatState.sires.甲.fetalGuard, true);
  upsertSireRecord(chatState, '甲', { race: '人类' });
  assert.equal(chatState.sires.甲.fetalGuard, true, '没给就保留');
  const { sanitizeSireExtractionResult } = await import('../scripts/registry.js');
  assert.equal(sanitizeSireExtractionResult({ fetalGuard: true }).fetalGuard, undefined);
});

test('胎儿守护挡得住见底：警告中的胎儿在场回复后，下一次周结算解除警告、不流产', async () => {
  const { normalizeSireRecord } = await import('../scripts/sires.js');
  const chatState = setup({ days: 125, fetuses: [fetus(1, { health: 0, healthWarned: true, healthWarnedAt: 118 })] });
  P(chatState).pregnant.healthSettledWeek = 17;
  chatState.sires.甲 = normalizeSireRecord({ race: '人类', fetalGuard: true, isHere: true });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  assert.equal(P(chatState).base.stage, '孕中期');
  assert.equal(F(chatState)[0].healthWarned, undefined);
  assert.ok(F(chatState)[0].health > 10);
});

test('追踪视角：守护中的胎儿带 guarded，离场就不带', async () => {
  const { normalizeSireRecord } = await import('../scripts/sires.js');
  const chatState = setup();
  chatState.sires.甲 = normalizeSireRecord({ race: '人类', fetalGuard: true, isHere: true });
  assert.equal(trackerProfile(chatState).pregnant.fetuses[0].guarded, '父方甲在场庇护');
  chatState.sires.甲.isHere = false;
  assert.equal('guarded' in trackerProfile(chatState).pregnant.fetuses[0], false);
});
