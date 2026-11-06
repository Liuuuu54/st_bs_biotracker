// 1.2.5 胎儿健康：量表、bsFetalEvent、事件堆与送出窗口、见底中断、孩子摘要、v13 迁移、认知纪录上限。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { projectNarrativeState } from '../scripts/tracker_prompt_context.js';
import { normalizeReproductiveSettings } from '../scripts/reproductive.js';
import { CARD_REPRODUCTIVE_FIELDS } from '../scripts/card_settings.js';
import {
  buildCognitionWindow, buildFetalEventWindow, buildPrenatalSummary, compactFetalEvents, getFetalHealthTier, normalizeRecordLimits,
} from '../scripts/fetal_health.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0,
  healthMax: 100, health: 50, ...over,
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
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${label} ${actual} ≠ ${expected}`);

// ── 事件效果 ─────────────────────────────────────────

test('伤害作用于全部已着床胎儿，未着床的不受影响；毒物在孕早期 ×1.5', () => {
  const chatState = setup({ stage: '孕早期', days: 40, fetuses: [fetus(1), fetus(2), fetus(3, { pendingImplantation: true, health: undefined, healthMax: undefined })] });
  const result = event(chatState, { kind: 'substance', change: 'significant_decrease' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(F(chatState).map((item) => item.health), [38, 38, undefined]);
  assert.match(P(chatState).notify.secondly, /腹中胎儿受到有害物质影响（明显）/);
});

test('fetusIndex 只动那一胎；健康按上限等比；increase/decrease 不改伤害与照料的方向', () => {
  const chatState = setup({ fetuses: [fetus(1), fetus(2, { healthMax: 120, health: 60 })] });
  event(chatState, { kind: 'illness', change: 'slight_increase', fetusIndex: 1 });
  assert.equal(F(chatState)[0].health, 50);
  near(F(chatState)[1].health, 60 - 3 * 1.2, '轻微 −3 × 上限 1.2');
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

test('照料不超过先天上限；孕中孕被包着的那一胎伤害减半', () => {
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
  event(chatState, { kind: 'fetal_reaction', change: 'severe_increase' });
  assert.equal(F(chatState)[0].affinity, 2);
  nextDay(chatState);
  event(chatState, { kind: 'fetal_reaction', change: 'severe_decrease' });
  assert.equal(F(chatState)[0].affinity, 1, '第二次 ×1/2');
  const extended = setup({ stage: '延产期', days: 300 });
  event(extended, { kind: 'fetal_reaction', change: 'severe_increase' });
  assert.equal(F(extended)[0].affinity, 4);
});

test('母体安抚：不收 change，系统抽方向；心理压力高时失败、亲和不变', () => {
  assert.match(event(setup(), { kind: 'soothe', change: 'slight_increase' }).message, /does not take change/);
  Math.random = () => 0;
  const chatState = setup({ base: { psyStress: 400 } });
  event(chatState, { kind: 'soothe' });
  assert.equal(F(chatState)[0].affinity, 0);
  assert.match(P(chatState).notify.secondly, /没有回应/);
  assert.equal(P(chatState).pregnant.fetalEvents[0].failed, true);
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
  const chatState = setup();
  for (let day = 0; day < 15; day += 1) { event(chatState, { kind: 'rest', change: 'slight_increase' }); nextDay(chatState); }
  chatState.reproductiveSettings = normalizeReproductiveSettings({ fetalEventCap: 10 });
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
  const old = setup({ fetuses: [fetus(1, { healthMax: undefined, health: undefined, nutrition: 20 }), fetus(2, { healthMax: undefined, health: undefined, nutrition: -10 })] });
  old.schemaVersion = 12;
  P(old).cooldown = { maternalFetalInteractionUsed: true };
  delete P(old).pregnant.fetalEvents;
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 13);
  const [a, b] = migrated.characters.A.profile.pregnant.fetuses;
  assert.equal(a.healthMax, 100);
  near(a.health, 50 + 20 * 0.18);
  near(b.health, 50 - 10 * 0.9);
  assert.equal('nutrition' in a, false);
  assert.deepEqual(migrated.characters.A.profile.pregnant.fetalEvents, []);
  assert.equal('maternalFetalInteractionUsed' in migrated.characters.A.profile.cooldown, false);
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.equal(migrated.characters.A.profile.pregnant.fetuses[0].healthMax, 100, '快照一并迁移');
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

test('认知纪录：pin、保存上限与送出窗口；进月经刷新时摘要一起清掉', () => {
  const chatState = setup({ settings: { cognitionCap: 10, cognitionWindow: 2 } });
  const record = (i, pin = false) => applyToolCall(chatState, {
    name: 'bsRecordExperience', sourceId: `c${i}`,
    arguments: { female: 'A', action: 'cognition', time: `第${i}日`, method: i % 2 ? 'guess' : 'perception', content: `认知${i}`, ...(pin ? { pin } : {}) },
  });
  for (let i = 0; i < 12; i += 1) record(i, i === 3);
  const profile = P(chatState);
  assert.equal(profile.cognitionRecords.length, 10);
  assert.equal(profile.cognitionSummary.count, 2);
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
