// 需求照料的点数：在「高」处理到「无」+1，拖到「爆」−1、停在爆每满 24 小时再 −1，「满」中性。
// 点数按种族归一化（需求项数、加分再除以 1+fetalEnergyDrain），计分当下按各胎孕龄与位置拆给每胎，
// 换成胎儿健康（1.3.0）：加分 × FETAL_CARE_GAIN_SCALE、扣分 × FETAL_CARE_LOSS_SCALE，再乘孕速与该胎上限 / 100。
// 每周按健康换算胎重、再往上限一半回归。旧的妊娠症状扣分与母胎互动已移除；需求免疫时健康冻结。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { FETAL_CARE_GAIN_SCALE as G, FETAL_CARE_LOSS_SCALE as L } from '../scripts/fetal_health.js';
import { buildRacePhysiologyPrompt } from '../scripts/prompts/rules.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const needs = (over = {}) => ({ excretion: 0, hunger: 0, sleep: 0, milk: 0, odor: 0, companionship: 0, ...over });

function one({ base = {}, pregnant = {}, metabolism = {}, immune = {} } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters['A'] = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '孕中期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 0,
        vitalityLevel: 4, psyStressLevel: 4,
        eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1 },
      pregnant: {
        pregnantDays: 120, effectivePregnantDays: 120, fetusesCount: 1,
        fetalEnergyDrain: 0, nutritionBurst: {},
        fetuses: [{ embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0 }],
        ...pregnant,
      },
      experience: {}, immune, metabolism: needs(metabolism),
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters['A'].profile;
/** 各胎健康相对初值 50 的变化加总（上限都是 100） */
const total = (chatState) => Math.round((P(chatState).pregnant.fetuses || []).reduce((sum, fetus) => sum + ((fetus.health ?? 50) - 50), 0) * 10000) / 10000;
const near0 = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-3, `${label} ${actual} ≠ ${expected}`);
const excrete = (chatState, options) => applyToolCall(chatState, { name: 'bsExcreteMetabolism', arguments: { female: 'A', options } });
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });

test('需求在「高」处理到「无」+1', () => {
  const chatState = one({ metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 60 });
  near0(total(chatState), G);
});

for (const [label, amount] of [['中', 20], ['低', 40]]) {
  test(`只处理到「${label}」不加分：半处理的回升周期短，不能比处理干净更划算`, () => {
    const chatState = one({ metabolism: { hunger: 80 } });
    excrete(chatState, { hunger: amount });
    assert.equal(total(chatState), 0);
  });
}

test('加分除以 (1 + fetalEnergyDrain)：需求涨得快的母体不该更容易养出巨胎', () => {
  const chatState = one({ metabolism: { hunger: 80 }, pregnant: { fetalEnergyDrain: 1 } });
  excrete(chatState, { hunger: 60 });
  near0(total(chatState), G / 2);
});

test('只处理一点、仍停在「高」不加分', () => {
  const chatState = one({ metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 2 });
  assert.equal(total(chatState), 0);
});

test('「满」是中性区：处理下来也不加分', () => {
  const chatState = one({ metabolism: { hunger: 110 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(total(chatState), 0);
});

test('进入「爆」扣一次；停在爆不重复扣；降下来再爆才会再扣', () => {
  const chatState = one({ metabolism: { sleep: 130 } });
  touch(chatState);
  near0(total(chatState), -L);
  touch(chatState);
  near0(total(chatState), -L, '停在爆只扣一次');
  excrete(chatState, { sleep: 60 });
  P(chatState).metabolism.sleep = 140;
  touch(chatState);
  near0(total(chatState), -2 * L, '降到爆以下后重新上膛');
});

test('停在爆每满 24 小时再扣一次；长时间跳跃按天数扣', () => {
  // 钉死随机：妊娠扩容若抽中伴意，容量升到 200、爆的门槛随之升到 166，141 会掉回满
  Math.random = () => 0.99;
  const chatState = one({ immune: {}, metabolism: { companionship: 140 } });
  touch(chatState);
  near0(total(chatState), -L);
  const passHours = (hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });
  passHours(23);
  near0(total(chatState), -L, '未满 24 小时不重复扣');
  passHours(1);
  near0(total(chatState), -2 * L);
  passHours(72);
  near0(total(chatState), -5 * L);
});

test('单次推进超过 7 天，停在爆的扣分最多算 7 天份', () => {
  Math.random = () => 0.99;
  const chatState = one({ immune: {}, metabolism: { companionship: 140 }, pregnant: { pregnantDays: 112.5, effectivePregnantDays: 112.5 } });
  touch(chatState);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 6 } });
  // 6 天里没跨周结算：建档 −L，再 6 天 −6L
  near0(P(chatState).pregnant.fetuses[0].health - 50, -7 * L);
  const long = one({ immune: {}, metabolism: { companionship: 140 }, pregnant: { pregnantDays: 112.5, effectivePregnantDays: 112.5 } });
  touch(long);
  const before = P(long).pregnant.fetuses[0].health;
  applyToolCall(long, { name: 'bsPassedTime', arguments: { day: 30 } });
  assert.ok(P(long).pregnant.fetuses[0].health > before - 8 * L, '一次跳 30 天没有扣 30 天份');
});

test('从未同步过的角色：当下已在爆的需求不追扣', () => {
  const chatState = one({ metabolism: { sleep: 130 }, pregnant: { nutritionBurst: undefined } });
  touch(chatState);
  near0(total(chatState), 0);
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, { sleep: 0 });
});

test('进食连带把泄意推上爆：同一次处理内一加一扣', () => {
  const chatState = one({ metabolism: { hunger: 80, excretion: 120 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(P(chatState).metabolism.excretion >= 125, true);
  near0(total(chatState), G - L, '一加一扣：扣分比加分重');
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, { excretion: 0 });
});

test('flux 按绝对值判定；血族只剩 5 项需求，点数按 6/5 折算', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { flux: -80 } });
  excrete(chatState, { flux: 60 });
  assert.equal(P(chatState).metabolism.flux, -20);
  near0(total(chatState), 1.2 * G);
});

test('被衍生类型抵免的需求不参与', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { hunger: 140 } });
  touch(chatState);
  near0(total(chatState), 0);
});

test('需求免疫：需求照料不影响胎儿健康', () => {
  const chatState = one({ immune: { metabolism: true }, metabolism: { sleep: 130 } });
  P(chatState).pregnant.fetuses[0].health = 53;
  touch(chatState);
  excrete(chatState, { sleep: 60 });
  near0(total(chatState), 3);
});

test('非妊娠阶段不计分', () => {
  const chatState = one({ base: { stage: '卵泡期' }, pregnant: { fetuses: [], fetusesCount: 0 }, metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 60 });
  near0(total(chatState), 0);
});

test('母体安抚只改亲和，不改健康', () => {
  Math.random = () => 0.99;
  const chatState = one();
  applyToolCall(chatState, { name: 'bsFetalEvent', arguments: { female: 'A', time: '当天', kind: 'bonding', change: 'slight_increase', content: '轻抚' } });
  near0(total(chatState), 0);
});

test('时间推进没有妊娠症状扣分', () => {
  Math.random = () => 0;
  const chatState = one({ base: { vitality: 0 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 3 } });
  near0(total(chatState), 0);
});

test('需求免疫的角色，本人的衍生需求说明不进 prompt；非免疫照发', () => {
  const payload = (profile) => ({ existing_state: { A: { name: 'A', profile } } });
  const hidden = buildRacePhysiologyPrompt(payload({ base: { race: '人类', derivedType: '血族' }, immune: { metabolism: true }, metabolism: {} }));
  assert.doesNotMatch(hidden, /衍生需求补充设定/);
  const offscreen = buildRacePhysiologyPrompt(payload({ base: { race: '人类', derivedType: '血族' } }));
  assert.match(offscreen, /衍生需求补充设定/, '幕外投影本来就不带 metabolism，不能因此误判为免疫');
  const shown = buildRacePhysiologyPrompt(payload({ base: { race: '人类', derivedType: '血族' }, metabolism: {} }));
  assert.match(shown, /衍生需求补充设定/);
});

test('免疫角色腹中胎儿的父系衍生类型仍照发', () => {
  const prompt = buildRacePhysiologyPrompt({
    existing_state: {
      A: {
        name: 'A',
        profile: {
          base: { race: '人类' },
          immune: { metabolism: true },
          pregnant: { fetuses: [{ race: '人类', fatherDerivedType: '血族' }] },
        },
      },
    },
  });
  assert.match(prompt, /衍生需求补充设定/);
});

// ── 分池与周结算 ─────────────────────────────────────────
const fetusAt = (over = {}) => ({ embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, ...over });
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-3, `${label}: ${actual} ≠ ${expected}`);
/** 这一胎分到的健康（相对初值 50） */
const got = (fetus) => (fetus.health ?? 50) - 50;
/** 孕 140 天，饿意在「高」处理干净得 1 点，看它怎么拆给各胎 */
function gainOnce(fetuses, amount = 60) {
  const chatState = one({ metabolism: { hunger: 80 }, pregnant: { pregnantDays: 140, effectivePregnantDays: 140, fetuses, fetusesCount: fetuses.length } });
  excrete(chatState, { hunger: amount });
  return chatState;
}
function loseOnce(fetuses) {
  const chatState = one({ metabolism: { sleep: 130 }, pregnant: { pregnantDays: 140, effectivePregnantDays: 140, fetuses, fetusesCount: fetuses.length } });
  touch(chatState);
  return chatState;
}
/** 孕 139.5 天推进 12 小时，跨过第 20 周触发一次结算 */
function settle(fetuses) {
  Math.random = () => 0.99;
  const chatState = one({ pregnant: { pregnantDays: 139.5, effectivePregnantDays: 139.5, fetuses, fetusesCount: fetuses.length } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 12 } });
  return P(chatState).pregnant.fetuses;
}

test('分池：计分当下按孕龄拆给各胎，异期胎分得较少', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2, conceivedAtDays: 70, tags: ['superfetation'], revealed: true })]);
  const [first, late] = P(chatState).pregnant.fetuses;
  near(got(first), G * 2 / 3, '孕龄 140');
  near(got(late), G / 3, '孕龄 70');
  assert.equal('nutrition' in P(chatState).pregnant, false, '母体层不保存');
  assert.equal('nutrition' in first, false, '旧的每周供养池已换成健康');
});

test('分池：待着床的胚胎还没接上供养，不分', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2, conceivedAtDays: 139, pendingImplantation: true })]);
  const [first, pending] = P(chatState).pregnant.fetuses;
  near(got(first), G, '全给已着床那胎');
  assert.equal(pending.health, undefined);
});

test('分池：宫顶胎盈余分得最多、亏损分得最少', () => {
  const twins = () => [fetusAt({ embryoId: 1, descentStage: -3 }), fetusAt({ embryoId: 2, descentStage: -1 })];
  const [topGain, lowGain] = P(gainOnce(twins())).pregnant.fetuses;
  near(got(topGain) / got(lowGain), 1.5 / 0.8, '盈余按位置');
  const [topLoss, lowLoss] = P(loseOnce(twins())).pregnant.fetuses;
  near(got(topLoss) / got(lowLoss), (1 / 1.5) / (1 / 0.8), '亏损取倒数');
  assert.ok(Math.abs(got(topLoss)) < Math.abs(got(lowLoss)));
});

test('分池：孕中孕内胎跟随宿主的位置', () => {
  const chatState = gainOnce([
    fetusAt({ embryoId: 1, descentStage: -3 }),
    fetusAt({ embryoId: 2, descentStage: -1 }),
    fetusAt({ embryoId: 3, nestedInEmbryoId: 1, descentStage: -1 }),
  ]);
  const [host, , inner] = P(chatState).pregnant.fetuses;
  near(got(inner), got(host), '内胎与宿主同位置同孕龄');
});

test('周结算：按健康比例换算胎重，再往上限一半拉回两成；同健康时既有大小比例不变', () => {
  const [a, b] = settle([fetusAt({ embryoId: 1, weight: 1, health: 70 }), fetusAt({ embryoId: 2, weight: 1.5, health: 70 })]);
  near(a.weight, Math.exp((0.7 - 0.5) * 0.06), '健康 70%');
  near(b.weight / a.weight, 1.5, '大小比例');
  near(a.health, 70 + (50 - 70) * 0.2, '周回归');
});

test('周结算：单周变化封顶，健康满档与见底各是 ±0.03', () => {
  near(settle([fetusAt({ health: 100 })])[0].weight, Math.exp(0.03), '满档');
  near(settle([fetusAt({ health: 0 })])[0].weight, Math.exp(-0.03), '见底');
  near(settle([fetusAt({ health: 50 })])[0].weight, 1, '一半时照标准曲线');
});

test('分池：三胎以上时中间最差、两端最好（中间 0.9、两端 1.2）', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 }), fetusAt({ embryoId: 3 })]);
  const [left, middle, right] = P(chatState).pregnant.fetuses;
  near(got(left), got(right), '两端对称');
  near(got(middle) / got(left), 0.9 / 1.2, '中间与两端的比例');
  const [lossLeft, lossMiddle] = P(loseOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 }), fetusAt({ embryoId: 3 })])).pregnant.fetuses;
  assert.ok(Math.abs(got(lossMiddle)) > Math.abs(got(lossLeft)), '亏损时中间先亏');
});

test('分池：双胎没有中间，左右位置不影响分配', () => {
  const [a, b] = P(gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 })])).pregnant.fetuses;
  near(got(a), got(b), '双胎平分');
});
