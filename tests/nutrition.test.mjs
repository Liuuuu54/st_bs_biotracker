// 供养力只来自需求照料：在「高」时处理到「无」+1，拖到「爆」−1、停在爆每满 24 小时再 −1，「满」中性。
// 点数按种族归一化（需求项数、加分再除以 1+fetalEnergyDrain），计分当下按各胎孕龄与位置拆进每胎的 nutrition，
// 每周各自换算成胎重。
// 旧的妊娠症状扣分与母胎互动补分已移除；需求免疫时供养力冻结且不进 prompt。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, getPregnancyNutritionTotal } from '../scripts/tools.js';
import { buildRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';

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
const total = (chatState) => getPregnancyNutritionTotal(P(chatState).pregnant);
const excrete = (chatState, options) => applyToolCall(chatState, { name: 'bsExcreteMetabolism', arguments: { female: 'A', options } });
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });

test('需求在「高」处理到「无」+1', () => {
  const chatState = one({ metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(total(chatState), 1);
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
  assert.equal(total(chatState), 0.5);
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
  assert.equal(total(chatState), -1);
  touch(chatState);
  assert.equal(total(chatState), -1, '停在爆只扣一次');
  excrete(chatState, { sleep: 60 });
  P(chatState).metabolism.sleep = 140;
  touch(chatState);
  assert.equal(total(chatState), -2, '降到爆以下后重新上膛');
});

test('停在爆每满 24 小时再扣一次；长时间跳跃按天数扣', () => {
  // 钉死随机：妊娠扩容若抽中伴意，容量升到 200、爆的门槛随之升到 166，141 会掉回满
  Math.random = () => 0.99;
  const chatState = one({ immune: {}, metabolism: { companionship: 140 } });
  touch(chatState);
  assert.equal(total(chatState), -1);
  const passHours = (hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });
  passHours(23);
  assert.equal(total(chatState), -1, '未满 24 小时不重复扣');
  passHours(1);
  assert.equal(total(chatState), -2);
  passHours(72);
  assert.equal(total(chatState), -5);
});

test('从未同步过的角色：当下已在爆的需求不追扣', () => {
  const chatState = one({ metabolism: { sleep: 130 }, pregnant: { nutritionBurst: undefined } });
  touch(chatState);
  assert.equal(total(chatState), 0);
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, { sleep: 0 });
});

test('进食连带把泄意推上爆：同一次处理内一加一扣', () => {
  const chatState = one({ metabolism: { hunger: 80, excretion: 120 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(P(chatState).metabolism.excretion >= 125, true);
  assert.equal(total(chatState), 0);
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, { excretion: 0 });
});

test('flux 按绝对值判定；血族只剩 4 项需求，点数按 6/4 折算', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { flux: -80 } });
  excrete(chatState, { flux: 60 });
  assert.equal(P(chatState).metabolism.flux, -20);
  assert.equal(total(chatState), 1.5);
});

test('被衍生类型抵免的需求不参与', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { hunger: 140 } });
  touch(chatState);
  assert.equal(total(chatState), 0);
});

test('需求免疫：供养力完全冻结', () => {
  const chatState = one({ immune: { metabolism: true }, metabolism: { sleep: 130 } });
  P(chatState).pregnant.fetuses[0].nutrition = 3;
  touch(chatState);
  excrete(chatState, { sleep: 60 });
  assert.equal(total(chatState), 3);
});

test('非妊娠阶段不计分', () => {
  const chatState = one({ base: { stage: '卵泡期' }, pregnant: { fetuses: [], fetusesCount: 0 }, metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(total(chatState), 0);
});

test('母胎互动不再改变供养力', () => {
  Math.random = () => 0.99;
  const chatState = one();
  applyToolCall(chatState, { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'maternal' } });
  assert.equal(total(chatState), 0);
});

test('时间推进不再有妊娠症状扣供养力', () => {
  Math.random = () => 0;
  const chatState = one({ base: { vitality: 0 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 3 } });
  assert.equal(total(chatState), 0);
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

test('分池：计分当下按孕龄拆给各胎，异期胎分得较少；prompt 只看加总', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2, conceivedAtDays: 70, tags: ['superfetation'], revealed: true })]);
  const [first, late] = P(chatState).pregnant.fetuses;
  near(first.nutrition, 2 / 3, '孕龄 140');
  near(late.nutrition, 1 / 3, '孕龄 70');
  assert.equal(total(chatState), 1);
  assert.equal('nutrition' in P(chatState).pregnant, false, '母体层不再保存');
});

test('分池：待着床的胚胎还没接上供养，不分', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2, conceivedAtDays: 139, pendingImplantation: true })]);
  const [first, pending] = P(chatState).pregnant.fetuses;
  near(first.nutrition, 1, '全给已着床那胎');
  assert.equal(pending.nutrition, undefined);
});

test('分池：宫顶胎盈余分得最多、亏损分得最少', () => {
  const twins = () => [fetusAt({ embryoId: 1, descentStage: -3 }), fetusAt({ embryoId: 2, descentStage: -1 })];
  const [topGain, lowGain] = P(gainOnce(twins())).pregnant.fetuses;
  near(topGain.nutrition / lowGain.nutrition, 1.5 / 0.8, '盈余按位置');
  const [topLoss, lowLoss] = P(loseOnce(twins())).pregnant.fetuses;
  near(topLoss.nutrition / lowLoss.nutrition, (1 / 1.5) / (1 / 0.8), '亏损取倒数');
  assert.ok(Math.abs(topLoss.nutrition) < Math.abs(lowLoss.nutrition));
});

test('分池：孕中孕内胎跟随宿主的位置', () => {
  const chatState = gainOnce([
    fetusAt({ embryoId: 1, descentStage: -3 }),
    fetusAt({ embryoId: 2, descentStage: -1 }),
    fetusAt({ embryoId: 3, nestedInEmbryoId: 1, descentStage: -1 }),
  ]);
  const [host, , inner] = P(chatState).pregnant.fetuses;
  near(inner.nutrition, host.nutrition, '内胎与宿主同位置同孕龄');
});

test('周结算：每胎把自己的份额换算成胎重后归零；同份额时既有大小比例不变', () => {
  const [a, b] = settle([fetusAt({ embryoId: 1, weight: 1, nutrition: 20 }), fetusAt({ embryoId: 2, weight: 1.5, nutrition: 20 })]);
  near(a.weight, Math.exp(20 * 0.0005), '20 点');
  near(b.weight / a.weight, 1.5, '大小比例');
  assert.equal(a.nutrition, 0);
  assert.equal(b.nutrition, 0);
});

test('周结算：单周变化封顶，亏空再深也不会跌穿', () => {
  near(settle([fetusAt({ nutrition: 1000 })])[0].weight, Math.exp(0.03), '盈余封顶');
  near(settle([fetusAt({ nutrition: -1000 })])[0].weight, Math.exp(-0.03), '亏损封顶');
});

test('分池：三胎以上时中间最差、两端最好（中间 0.9、两端 1.2）', () => {
  const chatState = gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 }), fetusAt({ embryoId: 3 })]);
  const [left, middle, right] = P(chatState).pregnant.fetuses;
  near(left.nutrition, right.nutrition, '两端对称');
  near(middle.nutrition / left.nutrition, 0.9 / 1.2, '中间与两端的比例');
  const [lossLeft, lossMiddle] = P(loseOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 }), fetusAt({ embryoId: 3 })])).pregnant.fetuses;
  assert.ok(Math.abs(lossMiddle.nutrition) > Math.abs(lossLeft.nutrition), '亏损时中间先亏');
});

test('分池：双胎没有中间，左右位置不影响分配', () => {
  const [a, b] = P(gainOnce([fetusAt({ embryoId: 1 }), fetusAt({ embryoId: 2 })])).pregnant.fetuses;
  near(a.nutrition, b.nutrition, '双胎平分');
});
