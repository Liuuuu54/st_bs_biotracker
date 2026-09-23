// 供养力只来自需求照料：在「高」时处理掉 +1，拖到「爆」−1，「满」中性。
// 旧的妊娠症状扣分与母胎互动补分已移除；需求免疫时供养力冻结且不进 prompt。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
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
        fetalEnergyDrain: 0.1, amnionDurability: 100, nutrition: 0, nutritionBurst: [],
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
const excrete = (chatState, options) => applyToolCall(chatState, { name: 'bsExcreteMetabolism', arguments: { female: 'A', options } });
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });

test('需求在「高」处理到「高」以下 +1', () => {
  const chatState = one({ metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 40 });
  assert.equal(P(chatState).pregnant.nutrition, 1);
});

test('只处理一点、仍停在「高」不加分', () => {
  const chatState = one({ metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 2 });
  assert.equal(P(chatState).pregnant.nutrition, 0);
});

test('「满」是中性区：处理下来也不加分', () => {
  const chatState = one({ metabolism: { hunger: 110 } });
  excrete(chatState, { hunger: 60 });
  assert.equal(P(chatState).pregnant.nutrition, 0);
});

test('进入「爆」扣一次；停在爆不重复扣；降下来再爆才会再扣', () => {
  const chatState = one({ metabolism: { sleep: 130 } });
  touch(chatState);
  assert.equal(P(chatState).pregnant.nutrition, -1);
  touch(chatState);
  assert.equal(P(chatState).pregnant.nutrition, -1, '停在爆只扣一次');
  excrete(chatState, { sleep: 60 });
  P(chatState).metabolism.sleep = 140;
  touch(chatState);
  assert.equal(P(chatState).pregnant.nutrition, -2, '降到爆以下后重新上膛');
});

test('从未同步过的角色：当下已在爆的需求不追扣', () => {
  const chatState = one({ metabolism: { sleep: 130 }, pregnant: { nutritionBurst: undefined } });
  touch(chatState);
  assert.equal(P(chatState).pregnant.nutrition, 0);
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, ['sleep']);
});

test('进食连带把泄意推上爆：同一次处理内一加一扣', () => {
  const chatState = one({ metabolism: { hunger: 80, excretion: 120 } });
  excrete(chatState, { hunger: 40 });
  assert.equal(P(chatState).metabolism.excretion >= 125, true);
  assert.equal(P(chatState).pregnant.nutrition, 0);
  assert.deepEqual(P(chatState).pregnant.nutritionBurst, ['excretion']);
});

test('flux 按绝对值判定：负极在「高」解放下来也 +1', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { flux: -80 } });
  excrete(chatState, { flux: 50 });
  assert.equal(P(chatState).metabolism.flux, -30);
  assert.equal(P(chatState).pregnant.nutrition, 1);
});

test('被衍生类型抵免的需求不参与', () => {
  const chatState = one({ base: { derivedType: '血族' }, metabolism: { hunger: 140 } });
  touch(chatState);
  assert.equal(P(chatState).pregnant.nutrition, 0);
});

test('需求免疫：供养力完全冻结', () => {
  const chatState = one({ immune: { metabolism: true }, metabolism: { sleep: 130 }, pregnant: { nutrition: 3 } });
  touch(chatState);
  excrete(chatState, { sleep: 60 });
  assert.equal(P(chatState).pregnant.nutrition, 3);
});

test('非妊娠阶段不计分', () => {
  const chatState = one({ base: { stage: '卵泡期' }, pregnant: { fetuses: [], fetusesCount: 0 }, metabolism: { hunger: 80 } });
  excrete(chatState, { hunger: 40 });
  assert.equal(P(chatState).pregnant.nutrition, 0);
});

test('母胎互动不再改变供养力', () => {
  Math.random = () => 0.99;
  const chatState = one({ pregnant: { nutrition: 0 } });
  applyToolCall(chatState, { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'maternal' } });
  assert.equal(P(chatState).pregnant.nutrition, 0);
  assert.equal('symptomReliefPending' in P(chatState).pregnant, false);
});

test('时间推进不再有妊娠症状扣供养力', () => {
  Math.random = () => 0;
  const chatState = one({ base: { vitality: 0 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 3 } });
  assert.equal(P(chatState).pregnant.nutrition, 0);
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
