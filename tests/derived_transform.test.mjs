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
  const both = getTrackerToolDefinitions({ specialTools: { transformDerivedType: false, transformBody: false } }).find((tool) => tool.name === 'bsRecordExperience');
  const realistic = getTrackerToolDefinitions({ realisticWorld: true }).find((tool) => tool.name === 'bsRecordExperience');
  assert.ok(on.input_schema.properties.action.enum.includes('transform'));
  assert.ok(on.input_schema.properties.body);
  // 只关衍生转化：身体转化还在，transform 留着、拿掉 derivedType 与那段说明
  assert.ok(off.input_schema.properties.action.enum.includes('transform'));
  assert.equal(off.input_schema.properties.derivedType, undefined);
  assert.ok(off.input_schema.properties.body);
  assert.ok(!off.description.includes('transform 记血脉'));
  assert.ok(off.description.includes('transform 的 body 记身体转化'));
  // 写实世界同样只拿掉衍生转化
  assert.ok(realistic.input_schema.properties.body && !realistic.input_schema.properties.derivedType);
  // 两个都关：整个 transform 拿掉
  assert.ok(!both.input_schema.properties.action.enum.includes('transform'));
  assert.equal(both.input_schema.properties.body, undefined);
  assert.equal(both.input_schema.properties.hours, undefined);
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

test('精方年龄：0 岁有效（刚出生的孩子注册成精方），没填才是未知、也不会跟着长大', async () => {
  const { normalizeSireRecord, advanceSireAges } = await import('../scripts/sires.js');
  assert.equal(normalizeSireRecord({ race: '人类', age: 0 }).age, 0);
  assert.equal(normalizeSireRecord({ race: '人类', age: null }).age, null);
  assert.equal(normalizeSireRecord({ race: '人类' }).age, null);
  const chatState = { sires: { 新生: normalizeSireRecord({ race: '人类', age: 0 }), 无名: normalizeSireRecord({ race: '人类' }) } };
  advanceSireAges(chatState, 365);
  assert.equal(chatState.sires.新生.age, 1);
  assert.equal(chatState.sires.无名.age, null);
});

test('1.5.1 纯精方转化：瞬间改档案、有 hours 时转化中到点才改，族谱连得到', async () => {
  const { normalizeSireRecord } = await import('../scripts/sires.js');
  const { buildLineageGraph } = await import('../scripts/lineage.js');
  const chatState = setup({ stage: '卵泡期' });
  chatState.sires = { 雷恩: normalizeSireRecord({ race: '人类', age: 30 }), 卡蜜拉: normalizeSireRecord({ race: '人类', derivedType: '血族', age: 900 }) };
  const instant = applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: '雷恩', action: 'transform', time: '第1天', derivedType: '魔导', content: '觉醒魔力' } });
  assert.equal(instant.applied, true, instant.message);
  assert.equal(chatState.sires.雷恩.derivedType, '魔导');
  const slow = applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: '雷恩', action: 'transform', time: '第2天', derivedType: '血族', partner: '卡蜜拉', content: '被初拥', hours: 10 } });
  assert.equal(slow.applied, true, slow.message);
  assert.equal(chatState.sires.雷恩.derivedType, '魔导');
  assert.ok(chatState.sires.雷恩.transforming);
  pass(chatState, 11);
  assert.equal(chatState.sires.雷恩.derivedType, '血族');
  assert.equal(chatState.sires.雷恩.transforming, undefined);
  assert.equal(chatState.sires.雷恩.derivedTransforms.length, 2);
  const graph = buildLineageGraph(chatState);
  const leon = graph.nodes.find((node) => node.name === '雷恩');
  assert.ok(leon?.transformedBy?.some((entry) => entry.name === '卡蜜拉' && entry.id));
  assert.ok(graph.nodes.find((node) => node.name === '卡蜜拉')?.transformed?.some((entry) => entry.name === '雷恩'));
});

test('1.5.1 性转：长出阴茎变扶她、失去子宫后只剩精方、再长回子宫恢复原档；只剩一样时不能再失去', async () => {
  const { buildLineageGraph } = await import('../scripts/lineage.js');
  const chatState = setup({ stage: '卵泡期', derivedType: '魔导' });
  P(chatState).base.age = 24;
  P(chatState).children = [{ id: 'k1', name: '小A', gender: '女', race: '人类', fathers: '凯', age: 2, talents: [] }];
  const body = (b, extra = {}) => applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'transform', time: '某日', body: b, content: '秘药', ...extra } });
  assert.equal(body('loseWomb').applied, false, '没有阴茎时不能失去子宫');
  assert.equal(applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'transform', time: '某日', body: 'gainSword', derivedType: '血族', content: 'x' } }).applied, false, '一次只做一件');
  const g = body('gainSword');
  assert.equal(g.applied, true, g.message);
  assert.ok(chatState.sires.A, '扶她：同名精方档');
  const lose = body('loseWomb');
  assert.equal(lose.applied, true, lose.message);
  assert.equal(chatState.characters.A, undefined, '卵方档停用');
  assert.ok(chatState.dormant.characters.A, '保留在停用区');
  assert.equal(chatState.sires.A.race, '人类');
  assert.equal(chatState.sires.A.derivedType, '魔导');
  assert.equal(chatState.sires.A.age, 24);
  assert.ok(buildLineageGraph(chatState).nodes.some((node) => node.name === '小A'), '子女照样在族谱');
  assert.equal(body('loseSword').applied, false, '只剩阴茎时不能再失去');
  // 有 hours：挂在精方档上，时间推进到点才恢复卵方
  const back = body('gainWomb', { hours: 5 });
  assert.equal(back.applied, true, back.message);
  assert.equal(chatState.characters.A, undefined);
  pass(chatState, 6);
  assert.ok(chatState.characters.A, '恢复原本的卵方档');
  assert.equal(P(chatState).base.stage, '卵泡期');
  assert.equal(P(chatState).children.length, 1);
  assert.equal(chatState.dormant.characters.A, undefined);
  assert.ok(P(chatState).derivedTransforms.some((r) => r.body === 'loseWomb'));
});

test('1.5.1 性转：怀孕与产后恢复中不能失去子宫；纯精方长出子宫会新建卵方档', async () => {
  const { normalizeSireRecord } = await import('../scripts/sires.js');
  const chatState = setup({ stage: '产后恢复' });
  chatState.sires = { A: normalizeSireRecord({ spermQuality: 1 }), 雷恩: normalizeSireRecord({ race: '精灵', age: 120, descriptions: { normalDescription: [{ name: '外貌', value: '银发' }] } }) };
  const blocked = applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'transform', time: 'x', body: 'loseWomb', content: 'x' } });
  assert.equal(blocked.applied, false);
  assert.match(blocked.message, /产后恢复/);
  const created = applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { female: '雷恩', action: 'transform', time: 'x', body: 'gainWomb', content: '禁术' } });
  assert.equal(created.applied, true, created.message);
  const egg = chatState.characters.雷恩;
  assert.ok(egg?.profile, '新建卵方档');
  assert.equal(egg.profile.base.race, '精灵');
  assert.equal(egg.profile.base.stage, '卵泡期');
  assert.equal(egg.profile.base.age, 120);
  assert.ok(chatState.sires.雷恩, '精方档留着（变扶她）');
});


test('1.5.1 日记变短：旧预设自动换新、改写过的不动；主线每人只送最近 2 篇', async () => {
  const rules = await import('../scripts/prompts/rules.js');
  const { getSettings } = await import('../scripts/state.js');
  assert.doesNotMatch(rules.DEFAULT_DIARY_WRITING_PROMPT, /至少三段/);
  assert.match(rules.DEFAULT_DIARY_WRITING_PROMPT, /100–150 字/);
  const legacy = getSettings({ extensionSettings: { bs_biotracker: { diaryWritingPrompt: rules.LEGACY_DIARY_WRITING_PROMPT } }, saveSettingsDebounced() {} });
  assert.equal(legacy.diaryWritingPrompt, rules.DEFAULT_DIARY_WRITING_PROMPT);
  const custom = getSettings({ extensionSettings: { bs_biotracker: { diaryWritingPrompt: '写长一点，五段。' } }, saveSettingsDebounced() {} });
  assert.equal(custom.diaryWritingPrompt, '写长一点，五段。');
  const diary = [1, 2, 3, 4, 5].map((n) => ({ time: `第${n}日`, content: `日记${n}` }));
  const projected = rules.projectNarrativeState({ A: { profile: { base: { stage: '卵泡期' }, diary } } });
  assert.deepEqual(projected.A.profile.diary.map((entry) => entry.time), ['第4日', '第5日']);
});
