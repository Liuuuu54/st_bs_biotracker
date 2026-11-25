// 泄意、食意的隐性两池（1.5.4）：显示一池（比较急的那个），底下尿／便、饥／渴分开累积与解除
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, getAvailablePregnancySymptomKeys, syncNeedTotals } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function one(stage = '卵泡期', metabolism = {}, base = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage, age: 24, race: '人类', ...base });
  ch.profile.metabolism = { ...ch.profile.metabolism, ...metabolism };
  syncNeedTotals(ch.profile);
  chat.characters.A = ch;
  return chat;
}
const M = (chat) => chat.characters.A.profile.metabolism;
const excrete = (chat, options) => applyToolCall(chat, { name: 'bsExcreteMetabolism', arguments: { female: 'A', options } });

test('旧存档只有一池：整个值落在主池（尿、饥），另一池从 0 开始', () => {
  const chat = one('卵泡期', { excretion: 100, hunger: 60, urine: undefined, stool: undefined, food: undefined, thirst: undefined });
  assert.deepEqual([M(chat).urine, M(chat).stool, M(chat).food, M(chat).thirst], [100, 0, 60, 0]);
  assert.equal(M(chat).excretion, 100);
});

test('显示的泄意是比较急的那一池；差不多时标 both，明显时标主导', () => {
  const chat = one('卵泡期', { urine: 30, stool: 110, food: 50, thirst: 55 });
  assert.equal(M(chat).excretion, 110);
  assert.equal(M(chat).excretionLead, 'stool');
  assert.equal(M(chat).hunger, 55);
  assert.equal(M(chat).hungerLead, 'both');
});

test('上大号只清便池、小便只清尿池；没给种类就清比较急的那一池', () => {
  const chat = one('卵泡期', { urine: 120, stool: 90 });
  excrete(chat, { excretion: 200, excretionKind: 'poop' });
  assert.deepEqual([M(chat).urine, M(chat).stool], [120, 0]);
  excrete(chat, { excretion: 50 });
  assert.equal(M(chat).urine, 70, '没给种类：清主导的尿池');
});

test('喝水解渴、加尿意；吃东西解饿、加便意', () => {
  const chat = one('卵泡期', { food: 80, thirst: 80 });
  excrete(chat, { hunger: 60, hungerKind: 'drink' });
  assert.equal(M(chat).thirst, 20);
  assert.equal(M(chat).urine, 30);
  assert.equal(M(chat).stool, 0);
  excrete(chat, { hunger: 60, hungerKind: 'eat' });
  assert.equal(M(chat).food, 20);
  assert.equal(M(chat).stool, 30);
});

test('提醒写主导的那一池：便意', () => {
  const chat = one('卵泡期', { urine: 0, stool: 140 });
  applyToolCall(chat, { name: 'bsPassedTime', arguments: { minute: 10 } });
  assert.match(chat.characters.A.profile.notify.thirdly, /便意:/);
});

test('孕期子宫压着膀胱：宫压越高尿池越小（满宫压剩六成）', () => {
  const chat = one('孕晚期', { urine: 140 }, { uterinePressure: 0 });
  chat.characters.A.profile.pregnant = { ...chat.characters.A.profile.pregnant, pregnantDays: 230, effectivePregnantDays: 230, fetuses: [{ embryoId: 1, race: '人类', weight: 1 }] };
  applyToolCall(chat, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { uterinePressure: 999 } } });
  syncNeedTotals(chat.characters.A.profile);
  assert.equal(M(chat).urine, 90);
  assert.equal(M(chat).excretionCap, 90);
});

test('孕期症状只落在合理的池：扩容没有尿池，快积没有便池', () => {
  const profile = one('孕中期').characters.A.profile;
  assert.ok(!getAvailablePregnancySymptomKeys(profile, 'expansion').includes('urine'));
  assert.ok(getAvailablePregnancySymptomKeys(profile, 'expansion').includes('stool'));
  assert.ok(!getAvailablePregnancySymptomKeys(profile, 'acceleration').includes('stool'));
  assert.ok(getAvailablePregnancySymptomKeys(profile, 'blockage').includes('stool'));
});

test('便秘（便池阻塞）：上大号只清得掉一部分；旧存档的泄意阻塞当便秘', () => {
  const chat = one('孕中期', { stool: 100 });
  chat.characters.A.profile.pregnant = { ...chat.characters.A.profile.pregnant, blockage: { key: 'excretion', severity: 0.5 } };
  excrete(chat, { excretion: 100, excretionKind: 'poop' });
  assert.equal(M(chat).stool, 50);
});

test('代谢豁免：血族豁免泄意与食意，两池一起归零', () => {
  const chat = one('卵泡期', { urine: 80, stool: 80, food: 80, thirst: 80 }, { derivedType: '血族' });
  syncNeedTotals(chat.characters.A.profile);
  assert.deepEqual([M(chat).urine, M(chat).stool, M(chat).food, M(chat).thirst, M(chat).excretion, M(chat).hunger], [0, 0, 0, 0, 0, 0]);
});

// ---- 1.5.4：bsAdjustMetabolism（八意分级增减）与随时间累积 ----
const adjust = (chat, options, reason = '测试') => applyToolCall(chat, { name: 'bsAdjustMetabolism', arguments: { female: 'A', options, reason } });
const pass = (chat, hour) => applyToolCall(chat, { name: 'bsPassedTime', arguments: { hour } });

test('分级增减：幅度照容量的 15%／40%／80%，加减同一种写法', () => {
  const chat = one('卵泡期', { urine: 0, stool: 100, food: 0, thirst: 0, sleep: 0, odor: 0, companionship: 0 });
  const result = adjust(chat, { urine: 'significant_increase', stool: 'severe_decrease', odor: 'slight_increase', companionship: 'severe_increase' });
  assert.equal(result.applied, true);
  assert.match(result.message, /原因：测试/);
  assert.equal(M(chat).urine, 60);
  assert.equal(M(chat).stool, 0);
  assert.ok(M(chat).odor >= 22.5, '臭意加了 22.5，另有排便的连锁');
  assert.equal(M(chat).companionship, 120);
  assert.equal(M(chat).excretion, 60);
  assert.equal(M(chat).excretionLead, 'urine');
});

test('汤算吃也算喝：降饿加便、降渴加尿，连锁照旧', () => {
  const chat = one('卵泡期', { urine: 0, stool: 0, food: 90, thirst: 90 });
  adjust(chat, { food: 'significant_decrease', thirst: 'significant_decrease' }, '喝了一碗蘑菇浓汤');
  assert.equal(M(chat).food, 30);
  assert.equal(M(chat).thirst, 30);
  assert.equal(M(chat).urine, 30);
  assert.equal(M(chat).stool, 30);
});

test('认不出的分级与旧的数字写法', () => {
  const chat = one('卵泡期', { urine: 100 });
  assert.equal(adjust(chat, { urine: 'a_lot' }).applied, false);
  assert.equal(M(chat).urine, 100);
  // 数字照旧当成排解
  assert.equal(adjust(chat, { excretion: 40, excretionKind: 'pee' }).applied, true);
  assert.equal(M(chat).urine, 60);
  // 旧工具名照样认得
  assert.equal(excrete(chat, { excretion: 60, excretionKind: 'pee' }).applied, true);
  assert.equal(M(chat).urine, 0);
});

test('主动加的不乘快积；豁免的项不动', () => {
  const chat = one('孕早期', { urine: 0 });
  chat.characters.A.profile.pregnant.acceleration = { key: 'urine', severity: 0.5 };
  adjust(chat, { urine: 'slight_increase' });
  assert.ok(Math.abs(M(chat).urine - 0.15 * chat.characters.A.profile.metabolism.excretionCap) < 1e-6 || M(chat).urine <= 22.5);
});

test('八意随时间累积：尿 8 小时到满，便要一天多', () => {
  const chat = one('卵泡期', { urine: 0, stool: 0, food: 0, thirst: 0, sleep: 0, odor: 0, companionship: 0 });
  pass(chat, 8);
  assert.ok(Math.abs(M(chat).urine - 100) < 0.5, `尿 ${M(chat).urine}`);
  assert.ok(Math.abs(M(chat).thirst - 200 / 3) < 0.5);
  assert.ok(Math.abs(M(chat).food - 50) < 0.5);
  assert.ok(M(chat).stool < 25);
  assert.ok(M(chat).sleep > 40 && M(chat).sleep < 50);
  assert.ok(M(chat).odor > 5 && M(chat).odor < 12);
  assert.equal(M(chat).excretionLead, 'urine');
});

test('一次推进 12 小时以上算照常生活：各项落在「上次处理后又过了多久」，最多停在中', () => {
  const chat = one('卵泡期', { urine: 140, stool: 0, food: 10, thirst: 0, sleep: 0, odor: 0, companionship: 0 });
  pass(chat, 30);
  // 30 小时：尿每 4 小时一次（余 2 小时）、渴每 3 小时（余 0）、饿每 5 小时（余 0）、便每天（余 6）、醒 16 小时（余 14）、洗澡每天（余 6）、见人三天（余 30）
  assert.equal(M(chat).urine, 25);
  assert.equal(M(chat).thirst, 0);
  assert.equal(M(chat).food, 0);
  assert.ok(Math.abs(M(chat).stool - 100 / 36 * 6) < 0.01);
  assert.equal(M(chat).sleep, 60, '困 14 小时是 77.8，压在中');
  assert.ok(Math.abs(M(chat).odor - 6.25) < 0.01);
  assert.ok(Math.abs(M(chat).companionship - 100 / 168 * 30) < 0.01);
  // 跳不同长度，落点就不同
  const other = one('卵泡期', {});
  pass(other, 75);
  assert.notDeepEqual([M(other).urine, M(other).food, M(other).stool], [M(chat).urine, M(chat).food, M(chat).stool]);
});

test('照常生活的间隔跟着种族步调：冷血好几天才吃一次', () => {
  const chat = one('卵泡期', { food: 120 }, { race: '蛇人', bodySize: 4 });
  pass(chat, 72);
  // 冷血饿 ×0.15：间隔 5 / 0.15 ≈ 33 小时，72 小时余 5.3 小时 → 很低
  assert.ok(M(chat).food < 10, `food ${M(chat).food}`);
  assert.ok(M(chat).food > 0);
});

test('人不在场：不累积，离开够久也当作照常生活', () => {
  const chat = one('卵泡期', { urine: 130, food: 0 }, { isHere: false });
  pass(chat, 6);
  assert.equal(M(chat).urine, 130);
  assert.equal(M(chat).food, 0);
  pass(chat, 22);
  // 离开 22 小时：尿每 4 小时一次，余 2 小时 → 25
  assert.equal(M(chat).urine, 25);
});

// ---- 1.5.4：种族代谢步调、体型系数、水栖与独居 ----
import { getMergedMetabolismPace, getBuiltinRacePhysiologyProfile, ALL_BUILTIN_RACES } from '../scripts/race_config.js';
import { getBodySizePaceFactor } from '../scripts/body_size.js';

test('内置种族都有代谢型；分布照定稿表', () => {
  const counts = {};
  for (const race of ALL_BUILTIN_RACES) {
    const type = getBuiltinRacePhysiologyProfile(race).metabolismType;
    counts[type] = (counts[type] || 0) + 1;
  }
  assert.deepEqual(counts, { warm: 39, fast: 12, cold: 27, absorb: 13, spirit: 18, inert: 12 });
  assert.equal(ALL_BUILTIN_RACES.filter((race) => getBuiltinRacePhysiologyProfile(race).aquatic).length, 16);
  assert.equal(ALL_BUILTIN_RACES.filter((race) => getBuiltinRacePhysiologyProfile(race).solitary).length, 32);
});

test('冷血吃得慢、水栖渴得慢、独居伴意慢', () => {
  const human = one('卵泡期', { food: 0, thirst: 0, companionship: 0 });
  const lamia = one('卵泡期', { food: 0, thirst: 0, companionship: 0 }, { race: '蛇人', bodySize: 4 });
  const mermaid = one('卵泡期', { food: 0, thirst: 0 }, { race: '人鱼', bodySize: 4 });
  for (const chat of [human, lamia, mermaid]) pass(chat, 10);
  assert.ok(Math.abs(M(lamia).food - M(human).food * 0.15) < 0.01);
  assert.ok(Math.abs(M(lamia).companionship - M(human).companionship * 0.3) < 0.01, '蛇人独居');
  assert.ok(Math.abs(M(mermaid).thirst - M(human).thirst * 0.15) < 0.01, '冷血 0.5 × 水栖 0.3');
});

test('体型系数：每级体积翻倍，代谢照 1/4 次方变慢；只乘吃喝尿便', () => {
  assert.equal(getBodySizePaceFactor(4), 1);
  assert.ok(Math.abs(getBodySizePaceFactor(7) - 2 ** -0.75) < 1e-9);
  assert.ok(Math.abs(getBodySizePaceFactor(1) - 2 ** 0.75) < 1e-9);
  const small = one('卵泡期', { food: 0, sleep: 0 }, { bodySize: 2 });
  const normal = one('卵泡期', { food: 0, sleep: 0 }, { bodySize: 4 });
  pass(small, 8);
  pass(normal, 8);
  assert.ok(Math.abs(M(small).food / M(normal).food - Math.SQRT2) < 0.01);
  assert.ok(Math.abs(M(small).sleep - M(normal).sleep) < 1e-6, '困不看体型');
});

test('混血：倍率按血统加权，水栖与独居取占比最大的那一族，平手随母', () => {
  const half = getMergedMetabolismPace('1/2人类x1/2蛇人');
  assert.ok(Math.abs(half.food - 0.575) < 1e-6);
  assert.equal(getMergedMetabolismPace('3/4人鱼x1/4人类').aquatic, true);
  assert.equal(getMergedMetabolismPace('1/4人鱼x3/4人类').aquatic, false);
  // 平手：不知道母方就取种族文字里排在前面的
  assert.equal(getMergedMetabolismPace('1/2人类x1/2熊人族').solitary, false);
  assert.equal(getMergedMetabolismPace('1/2熊人族x1/2人类').solitary, true);
  // 知道母方就随母
  assert.equal(getMergedMetabolismPace('1/2人类x1/2熊人族', null, '熊人族').solitary, true);
});

test('百科覆写：自订代谢型与标签会被保留', async () => {
  const { sanitizeRacePhysiologyProfilePatch } = await import('../scripts/race_config.js');
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ metabolismType: 'cold', aquatic: true, solitary: false }), { metabolismType: 'cold', aquatic: true, solitary: false });
  assert.equal(sanitizeRacePhysiologyProfilePatch({ metabolismType: 'lava' }), null);
});

test('孕期负担照胎儿的代谢型：怀鸟族胎饿得勤、怀魔像胎几乎不吃；不乘母亲的代谢型', async () => {
  const { getPregnancyLoadPace } = await import('../scripts/tools.js');
  const pregnantWith = (motherRace, fetusRaces) => {
    const chat = one('卵泡期', {}, { race: motherRace, bodySize: 4 });
    assert.equal(applyToolCall(chat, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M', fetusCount: fetusRaces.length, equivalentDays: 120 } }).applied, true);
    const fetuses = chat.characters.A.profile.pregnant.fetuses;
    fetusRaces.forEach((race, index) => { fetuses[index].race = race; fetuses[index].bloodline = null; });
    return getPregnancyLoadPace(chat.characters.A.profile);
  };
  assert.ok(Math.abs(pregnantWith('人类', ['鸟族']).food - 1.5) < 1e-6);
  assert.ok(Math.abs(pregnantWith('人类', ['魔像']).food - 0.1) < 1e-6);
  // 冷血母亲怀人类胎：孕期多出来的饿照人类胎算（1），不乘母亲的 0.15
  assert.ok(Math.abs(pregnantWith('蛇人', ['人类']).food - 1) < 1e-6);
  // 两胎不同种族：照索取量加权，落在两者之间
  const mixed = pregnantWith('人类', ['鸟族', '魔像']).food;
  assert.ok(mixed > 0.1 && mixed < 1.5, `mixed ${mixed}`);
});

test('孕期负担是基本速度的一部分：单胎约 +三成，不再叠成两倍', () => {
  const chat = one('卵泡期', { food: 0, thirst: 0, sleep: 0 }, { race: '人类', bodySize: 4 });
  applyToolCall(chat, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M', fetusCount: 1, equivalentDays: 270 } });
  const p = chat.characters.A.profile;
  Object.assign(p.pregnant, { blockage: null, acceleration: null, expansion: null });
  Object.assign(p.metabolism, { food: 0, thirst: 0, sleep: 0, urine: 0, stool: 0 });
  syncNeedTotals(p);
  const drain = p.pregnant.fetalEnergyDrain;
  pass(chat, 4);
  // 4 小时的基本饿 25，孕期多 25 × 0.3 × 耗能（耗能还会随孕龄略变，留一点余地）
  const ratio = M(chat).food / 25;
  assert.ok(ratio > 1.1 && ratio < 1 + 0.3 * drain + 0.15, `food ×${ratio}，耗能 ${drain}`);
});

test('睡饱一觉退回最近一次推进一半的累积；先降困再推进也认；跳 12 小时以上不退', () => {
  const sleepThen = (order, hours) => {
    const chat = one('卵泡期', { food: 0, thirst: 0, urine: 0, stool: 0, sleep: 0 });
    if (order === 'after') { pass(chat, hours); adjust(chat, { sleep: 'severe_decrease' }); }
    else { adjust(chat, { sleep: 'severe_decrease' }); pass(chat, hours); }
    return M(chat);
  };
  const awake = one('卵泡期', { food: 0, thirst: 0, urine: 0, stool: 0 });
  pass(awake, 8);
  const after = sleepThen('after', 8);
  const before = sleepThen('before', 8);
  for (const key of ['food', 'urine']) {
    // 降困另有连锁：解掉的困 ×0.1 加回饿与渴（这里约 +4.4），所以只看尿最准，饿留一点余地
    const slack = key === 'food' ? 5 : 0.6;
    assert.ok(Math.abs(after[key] - M(awake)[key] / 2) < slack, `${key} 后降 ${after[key]} vs ${M(awake)[key]}`);
    assert.ok(Math.abs(before[key] - M(awake)[key] / 2) < slack, `${key} 先降 ${before[key]}`);
  }
  // 小睡退四分之一
  const nap = one('卵泡期', { urine: 0, sleep: 0 });
  pass(nap, 8);
  adjust(nap, { sleep: 'significant_decrease' });
  assert.ok(Math.abs(M(nap).urine - 100 * 0.75) < 0.6, `nap ${M(nap).urine}`);
  // 一次跳 12 小时以上是照常生活，不再退
  const long = one('卵泡期', { food: 0, sleep: 100 });
  pass(long, 30);
  const settled = M(long).food;
  adjust(long, { sleep: 'severe_decrease' });
  assert.ok(M(long).food >= settled - 0.01);
});

test('衍生种族的极性需求随时间沿目前方向偏，约两天到满；照常生活一天解放一次', () => {
  const chat = one('卵泡期', { flux: -10 }, { derivedType: '修炼', psyStress: 100 });
  pass(chat, 10);
  assert.ok(Math.abs(M(chat).flux - (-10 - 100 / 48 * 10)) < 0.01, `flux ${M(chat).flux}`);
  const fresh = one('卵泡期', { flux: 0 }, { derivedType: '修炼', psyStress: 100 });
  pass(fresh, 6);
  assert.ok(M(fresh).flux > 0, '0 时往正');
  const long = one('卵泡期', { flux: 140 }, { derivedType: '修炼', psyStress: 100 });
  pass(long, 30);
  // 30 小时：一天解放一次，余 6 小时 → 12.5
  assert.ok(Math.abs(M(long).flux - 12.5) < 0.01, `long ${M(long).flux}`);
});

test('睡着时困意不再涨：先降困再推进，醒来不会比睡前更困', () => {
  const chat = one('卵泡期', { sleep: 90, urine: 0 });
  adjust(chat, { sleep: 'severe_decrease' });
  const afterRelief = M(chat).sleep;
  pass(chat, 8);
  assert.ok(Math.abs(M(chat).sleep - afterRelief) < 0.5, `醒来困 ${M(chat).sleep}，睡前 ${afterRelief}`);
  // 小睡：困意涨的一半退掉
  const nap = one('卵泡期', { sleep: 0 });
  adjust(nap, { sleep: 'significant_decrease' });
  pass(nap, 4);
  assert.ok(Math.abs(M(nap).sleep - 100 / 18 * 4 * 0.5) < 0.5, `nap ${M(nap).sleep}`);
});

test('孕期胃口不看母亲的承载耐受：耗能乘回耐受，耐受低的母亲不会被叠成好几倍', async () => {
  const { getPregnancyAppetite } = await import('../scripts/tools.js');
  // 实机第五轮：精灵（耐受 0.32）怀双胎，耗能 4.07；胃口应约 1.3，与耐受 1、耗能 1.3 的母亲相同
  const frail = getPregnancyAppetite({ pregnant: { fetalEnergyDrain: 4.07 }, bio: { breedTolerance: 0.32 } });
  const sturdy = getPregnancyAppetite({ pregnant: { fetalEnergyDrain: 1.3024 }, bio: { breedTolerance: 1 } });
  assert.ok(Math.abs(frail - sturdy) < 1e-6, `${frail} vs ${sturdy}`);
  assert.equal(getPregnancyAppetite({ pregnant: {}, bio: {} }), 0);
});

test('连锁不套快积：频尿时喝水加的尿意照原量，快积只管随时间累积', () => {
  const chat = one('孕早期', { urine: 0, thirst: 80 });
  const p = chat.characters.A.profile;
  p.pregnant.acceleration = { key: 'urine', severity: 0.5 };
  Object.assign(p.pregnant, { blockage: null, expansion: null });
  adjust(chat, { thirst: 'significant_decrease' });
  // 渴降 60 → 尿 +30，不乘频尿的 1.5
  assert.ok(Math.abs(M(chat).urine - 30) < 0.01, `urine ${M(chat).urine}`);
});

// ---- 1.5.4：泌乳与承载耐受脱钩、照胚型与孕肚、母体倾向、产乳体质 ----
import { getMergedLactation } from '../scripts/race_config.js';

test('泌乳量照胚型：胎生 > 卵胎生 > 不定型 > 胎转卵生 > 卵生；混血加权', () => {
  const order = ['人类', '人鱼', '史萊姆', '西方龙', '鸟族'].map((race) => getMergedLactation(race));
  assert.deepEqual(order, [1, 0.6, 0.5, 0.4, 0.3]);
  assert.equal(getMergedLactation('米诺陶族'), 1, '不给个别种族特例');
  assert.ok(Math.abs(getMergedLactation('1/2人类x1/2西方龙') - 0.7) < 1e-9);
});

test('产乳体质（作弊）：不怀孕也产乳；与承载耐受无关；偏养母乳多', () => {
  const milkAfter = (base, { lactating = true, tolerance = null } = {}) => {
    const chat = one('卵泡期', { milk: 0 }, { bustGain: 1.5, ...base });
    const p = chat.characters.A.profile;
    p.immune = { ...(p.immune || {}), lactating };
    if (tolerance !== null) p.bio.breedTolerance = tolerance;
    pass(chat, 3);
    return M(chat).milk;
  };
  assert.equal(milkAfter({}, { lactating: false }), 0, '没有体质、没怀孕：不产乳');
  const plain = milkAfter({ allocationBias: 0 });
  assert.ok(plain > 0);
  assert.ok(Math.abs(milkAfter({ allocationBias: -1 }) / plain - 1.4) < 0.01, '偏养母 ×1.4');
  assert.ok(Math.abs(milkAfter({ allocationBias: 1 }) / plain - 0.6) < 0.01, '偏养宝 ×0.6');
  assert.ok(Math.abs(milkAfter({ allocationBias: 0 }, { tolerance: 8 }) - plain) < 1e-6, '耐受不影响乳量');
});

test('胸部增长倾向是泌乳的荷尔蒙体质：÷1.5，夹在 0.5～2', () => {
  const milkWith = (bustGain) => {
    const chat = one('卵泡期', { milk: 0 }, { bustGain, allocationBias: 0 });
    chat.characters.A.profile.immune = { ...(chat.characters.A.profile.immune || {}), lactating: true };
    pass(chat, 3);
    return M(chat).milk;
  };
  const mean = milkWith(1.5);
  assert.ok(Math.abs(milkWith(3) / mean - 2) < 0.01, '牛娘体质 ×2');
  assert.ok(Math.abs(milkWith(0) / mean - 0.5) < 0.01, '非人形最少 ×0.5');
});

test('怀孕的乳意跟着胎数（不看胎量），产乳体质再叠一份', () => {
  const pregnantMilk = (count, lactating = false) => {
    const chat = one('卵泡期', {}, { race: '人类', bodySize: 4, bustGain: 1.5, allocationBias: 0 });
    applyToolCall(chat, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M', fetusCount: count, equivalentDays: 250 } });
    const p = chat.characters.A.profile;
    p.immune = { ...(p.immune || {}), lactating };
    Object.assign(p.pregnant, { blockage: null, acceleration: null, expansion: null });
    p.metabolism.milk = 0;
    pass(chat, 5);
    return M(chat).milk;
  };
  const single = pregnantMilk(1);
  const twins = pregnantMilk(2);
  assert.ok(Math.abs(twins / single - 2 ** 0.8) < 0.15, `双胎 ${twins} vs 单胎 ${single}`);
  assert.ok(pregnantMilk(1, true) > single, '产乳体质叠加');
});

test('乳意的速度：产后单胎约 6 小时满、产乳体质约 10 小时、孕晚期约两天；照常生活约三小时喂一次', async () => {
  const { MILK_HOURLY_BASE } = await import('../scripts/tools.js');
  assert.ok(Math.abs(MILK_HOURLY_BASE - 100 / 6) < 1e-9);
  // 产乳体质、平均体质：每小时 100/6 × 0.6 = 10
  const chat = one('卵泡期', { milk: 0 }, { bustGain: 1.5, allocationBias: 0 });
  chat.characters.A.profile.immune = { ...(chat.characters.A.profile.immune || {}), lactating: true };
  pass(chat, 5);
  assert.ok(Math.abs(M(chat).milk - 50) < 0.5, `5 小时 ${M(chat).milk}`);
  // 跳两天：照常生活，三小时喂一次，48 小时余 0 → 0
  pass(chat, 48);
  assert.ok(M(chat).milk < 1, `跳两天后 ${M(chat).milk}`);
  pass(chat, 20);
  // 20 小时：余 2 小时 → 20
  assert.ok(Math.abs(M(chat).milk - 20) < 0.5, `再跳 20 小时 ${M(chat).milk}`);
});
