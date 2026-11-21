// 衍生转化（1.5.0）：bsRecordExperience action=transform——转化种类、遗传轴重新对位、转化中、血脉排斥。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  causesRejection, classifyDerivedTransform, getLegacyCoefficient, getRejectionHours, getRejectionLoss, remapInheritanceProgress, resolveDerivedTypeInput,
} from '../scripts/derived_transform.js';
import { calculateDerivedInheritanceProgress } from '../scripts/calculator.js';
import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { getTrackerToolDefinitions } from '../scripts/tracker.js';

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, descentStage: -2, health: 50, healthMax: 100, maternalDerivedTypeProgress: 0, ...over,
});

function setup({ stage = '孕中期', derivedType = '血族', fetuses = [], effectiveDays = 150 } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', derivedType, vitality: 150, libido: 0, uterinePressure: 10,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: { pregnantDays: effectiveDays, effectivePregnantDays: effectiveDays, fetusesCount: fetuses.length, fetuses },
      experience: {}, immune: { metabolism: true }, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const transform = (chatState, args) => applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'transform', time: '第3天', content: '被卡蜜拉初拥', ...args } });
const pass = (chatState, hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });

test('转化种类：无→有、同类换子项、换大类、去衍生、相同', () => {
  assert.equal(classifyDerivedTransform(null, '血族'), 'gain');
  assert.equal(classifyDerivedTransform('血族', '血族-真祖'), 'refine');
  assert.equal(classifyDerivedTransform('血族', '修炼'), 'switch');
  assert.equal(classifyDerivedTransform('血族', null), 'purge');
  assert.equal(classifyDerivedTransform('血族', '血族'), 'same');
  assert.equal(causesRejection('refine'), false);
  assert.equal(causesRejection('switch'), true);
  assert.equal(resolveDerivedTypeInput(''), null);
  assert.equal(resolveDerivedTypeInput('血族-真祖'), '血族-真祖');
  assert.equal(resolveDerivedTypeInput('不存在的类'), undefined);
});

test('遗传轴重新对位（计划 §3.7 表）', () => {
  const r = (p, f, from = '血族', to = '修炼') => remapInheritanceProgress(p, { oldType: from, newType: to, fatherType: f });
  assert.equal(r(40, null), 0, '胎父无衍生、偏旧 X：归 0');
  assert.equal(r(-20, null), -20, '胎父无衍生、偏父方：照旧');
  assert.equal(r(-30, '魔导'), -30, '胎父另一种、偏父方：照旧');
  assert.equal(r(40, '魔导'), 0, '胎父另一种、偏旧 X：归 0');
  assert.equal(r(60, '血族'), -30, '双亲原本同型 X：留父亲那一半');
  assert.equal(r(40, '修炼'), 0, '胎父是新型、偏旧 X：归 0');
  assert.equal(r(-70, '修炼'), 70, '胎父是新型、偏新型：同型模式下记正值');
  assert.equal(remapInheritanceProgress(-70, { oldType: null, newType: '修炼', fatherType: '修炼' }), 70, '无→有也要对位');
  assert.equal(remapInheritanceProgress(40, { oldType: '血族', newType: '血族-真祖', fatherType: null }), 40, '同类换子项不变');
});

test('扣量：舊血脈、亲密度（负值加重）、内胎减半、时长', () => {
  assert.equal(getRejectionLoss({ progress: 0 }), 30);
  assert.equal(getRejectionLoss({ progress: 30, oldType: '血族' }), 60);
  assert.equal(getRejectionLoss({ progress: 30, oldType: '血族', affinity: 15 }), 40);
  assert.equal(getRejectionLoss({ progress: 0, affinity: -15 }), 60);
  assert.equal(getRejectionLoss({ progress: 0, nested: true }), 15);
  assert.equal(getLegacyCoefficient(-75, { oldType: '血族', newType: '修炼', fatherType: '修炼' }), 0.5);
  assert.equal(getRejectionHours(0, 1), 72);
  assert.equal(getRejectionHours(0, 20), 6);
  assert.equal(getRejectionHours(30, 1), 30);
});

test('同型只比大类：血族-真祖的母亲与血族的胎父算同型', () => {
  const args = { currentProgress: 30, affinity: 0, paternalFit: 1, fatherDerivedType: '血族', fetusRace: '人类', passedDays: 10 };
  assert.equal(calculateDerivedInheritanceProgress({ ...args, motherDerivedType: '血族-真祖' }), calculateDerivedInheritanceProgress({ ...args, motherDerivedType: '血族' }));
});

test('瞬间转化：改衍生、记经历与来源、精方同名档案一起改', () => {
  const chatState = setup({ stage: '卵泡期', derivedType: null });
  chatState.sires = { A: { name: 'A', derivedType: null } };
  const result = transform(chatState, { derivedType: '血族', partner: '卡蜜拉' });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).base.derivedType, '血族');
  assert.equal(P(chatState).derivedTransforms.at(-1).source, '卡蜜拉');
  assert.equal(P(chatState).derivedTransforms.at(-1).kind, 'gain');
  assert.equal(chatState.sires.A.derivedType, '血族');
  assert.equal(transform(chatState, { derivedType: '血族' }).applied, false, '相同的拒绝');
});

test('拒绝：产程中、回归期、名录外', () => {
  assert.equal(transform(setup({ stage: '第一产程' }), { derivedType: '修炼' }).applied, false);
  assert.equal(transform(setup({ stage: '回归期' }), { derivedType: '修炼' }).applied, false);
  assert.equal(transform(setup({ stage: '卵泡期' }), { derivedType: '不存在的类' }).applied, false);
});

test('同类换子项、无→有：怀孕中不排斥，只记一笔胎儿事件', () => {
  const chatState = setup({ fetuses: [fetus(1)] });
  assert.equal(transform(chatState, { derivedType: '血族-真祖' }).applied, true);
  assert.equal(P(chatState).pregnant.rejectionCrisis, undefined);
  assert.ok(P(chatState).pregnant.fetalEvents.some((event) => event.content.includes('血族-真祖')));
});

test('怀孕中换大类：开始血脉排斥，72 小时后照健康定生死、熬过的亲密度 +2', () => {
  const chatState = setup({ fetuses: [fetus(1, { maternalDerivedTypeProgress: 75, health: 50 }), fetus(2, { health: 50 })] });
  const result = transform(chatState, { derivedType: '修炼' });
  assert.match(result.message, /血脉排斥/);
  const crisis = P(chatState).pregnant.rejectionCrisis;
  assert.equal(crisis.totalHours, 72);
  assert.ok(crisis.losses['1'].total > crisis.losses['2'].total, '偏旧血脉的那胎扣得多');
  pass(chatState, 36);
  const mid = P(chatState).pregnant;
  assert.ok(mid.rejectionCrisis.remainingHours < 72);
  assert.ok(mid.fetuses.every((item) => item.health >= 1));
  pass(chatState, 40);
  const after = P(chatState).pregnant;
  assert.equal(after.rejectionCrisis, undefined, '危机结束');
  // 偏旧血脉 +75 的那胎（扣 105）撑不过：孕中期多胎只吸收那一胎；另一胎熬过
  assert.equal(after.fetuses.length, 1);
  assert.equal(after.fetuses[0].embryoId, 2);
  assert.ok(after.fetuses[0].affinity >= 2);
});

test('转化要时间：转化中、期间不能再转，时间到才改衍生', () => {
  const chatState = setup({ stage: '卵泡期', derivedType: null });
  assert.equal(transform(chatState, { derivedType: '血族', hours: 10 }).applied, true);
  assert.equal(P(chatState).base.derivedType, null);
  assert.equal(P(chatState).base.transforming.to, '血族');
  assert.equal(transform(chatState, { derivedType: '修炼' }).applied, false);
  pass(chatState, 6);
  assert.equal(P(chatState).base.derivedType, null);
  pass(chatState, 5);
  assert.equal(P(chatState).base.derivedType, '血族');
  assert.equal(P(chatState).base.transforming, undefined);
});

test('衍生转化关掉时，追踪工具里拿掉 transform', () => {
  const on = getTrackerToolDefinitions({}).find((tool) => tool.name === 'bsRecordExperience');
  const off = getTrackerToolDefinitions({ specialTools: { transformDerivedType: false } }).find((tool) => tool.name === 'bsRecordExperience');
  assert.ok(on.input_schema.properties.action.enum.includes('transform'));
  assert.ok(!off.input_schema.properties.action.enum.includes('transform'));
  assert.equal(off.input_schema.properties.derivedType, undefined);
  assert.ok(!off.description.includes('transform 记血脉'));
});

test('1.5.0 bsTrainSkill define：图鉴没有的新技能同一次调用登记并觉醒', () => {
  const chatState = setup({ stage: '卵泡期' });
  const result = applyToolCall(chatState, { name: 'bsTrainSkill', arguments: { female: 'A', skill: '剑术', skillExp: 0, awaken: true, reason: '初次握剑', define: { description: '以长剑攻防的实战技巧。' } } });
  assert.equal(result.applied, true, result.message);
  assert.ok(chatState.skillCatalog.some((item) => item.name === '剑术'));
  assert.equal(P(chatState).skills.length, 1);
  // 没给 define 的未知技能照旧拒绝
  assert.equal(applyToolCall(chatState, { name: 'bsTrainSkill', arguments: { female: 'A', skill: '弓术', skillExp: 0, awaken: true, reason: 'x' } }).applied, false);
});

test('1.5.0 bsTrainSkill define：训练会被拒时不登记进图鉴', () => {
  const chatState = setup({ stage: '卵泡期' });
  const call = (over) => applyToolCall(chatState, { name: 'bsTrainSkill', arguments: { female: 'A', skill: '阴茎开发', skillExp: 10, awaken: true, reason: '练习', define: { description: '阴茎的开发。', body: 'sword' }, ...over } });
  assert.equal(call({}).applied, false, '纯卵方不能有精方专属技能');
  assert.equal(call({ reason: '', define: { description: 'x' } }).applied, false);
  assert.equal(call({ awaken: false, define: { description: 'x' } }).applied, false);
  assert.equal((chatState.skillCatalog || []).some((item) => item.name === '阴茎开发'), false);
});

test('1.5.0 没送的工具，系统提示里提到它的那句也拿掉', async () => {
  const { buildTrackerSystemPrompt, DEFAULT_SYSTEM_PROMPT } = await import('../scripts/prompts/rules.js');
  const off = buildTrackerSystemPrompt(DEFAULT_SYSTEM_PROMPT, null, { available_tools: [{ name: 'bsAbortion' }] });
  assert.equal(off.includes('bsExtendPregnancy（action=extend）'), false);
  assert.equal(off.includes('立即结束分娩用 bsChildbirth'), false);
  assert.ok(off.includes('流产用 bsAbortion；角色在场状态变化'));
  const on = buildTrackerSystemPrompt(DEFAULT_SYSTEM_PROMPT, null, { available_tools: [{ name: 'bsChildbirth' }, { name: 'bsExtendPregnancy' }] });
  assert.ok(on.includes('立即结束分娩用 bsChildbirth'));
  assert.ok(on.includes('bsExtendPregnancy（action=extend）'));
});

test('排斥危机中胎儿没了（流产、分娩）：危机跟着撤掉，不留在产后恢复', () => {
  const chatState = setup({ fetuses: [fetus(1, { health: 80 })] });
  transform(chatState, { derivedType: '修炼', hours: 24 });
  assert.ok(P(chatState).pregnant.rejectionCrisis);
  const result = applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', purpose: 'termination', reason: '测试' } });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).pregnant.rejectionCrisis, undefined);
});

test('排斥的疼痛照急缓：越短越痛；回归期撑满之痛随剩余时间消退', async () => {
  const { getRejectionPainLevel } = await import('../scripts/derived_transform.js');
  const { getReproductivePain } = await import('../scripts/tools.js');
  assert.equal(getRejectionPainLevel({ totalHours: 6, losses: { 1: { total: 30 } } }), 8);
  assert.equal(getRejectionPainLevel({ totalHours: 24, losses: { 1: { total: 30 } } }), 3.5);
  assert.equal(getRejectionPainLevel({ totalHours: 72, losses: { 1: { total: 30 } } }), 2.5);
  const womb = (remainingHours) => getReproductivePain({ base: { stage: '回归期', vitalityLevel: 4, psyStressLevel: 4 }, pregnant: { fetuses: [], wombReturn: { totalHours: 10, remainingHours } } });
  assert.equal(womb(10).level, 6);
  assert.equal(womb(5).level, 3);
  assert.equal(womb(0), null);
});

test('一次生完时，先露的那一胎记成第 1 胎，其余照下降深浅', () => {
  const chatState = setup({ stage: '第二产程', fetuses: [fetus(1, { gender: '男', descentStage: -1 }), fetus(2, { gender: '女', descentStage: 1 })] });
  P(chatState).pregnant.presentingEmbryoId = 2;
  P(chatState).pregnant.laborPhase = '胎体下降';
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A', mode: 'natural' } });
  assert.equal(result.applied, true, result.message);
  const kids = P(chatState).children;
  assert.equal(kids.find((kid) => kid.birth?.order === 1)?.gender, '女');
  assert.equal(kids.find((kid) => kid.birth?.order === 2)?.gender, '男');
});
