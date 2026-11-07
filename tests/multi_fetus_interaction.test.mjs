// v1.1.1 多胎胎间：大幅转向会被相邻胎儿挡住或带动；两胎互踢、推挤、依偎（1.3.0 起是 bsAssistFetalPosition action=sibling）。
// 不存新资料，只改角度与左右顺序，每个故事小时一次。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });
/** 依序回传给定的随机数，用完后回传 0.99（不触发任何机率事件） */
const rolls = (...values) => { Math.random = () => (values.length > 0 ? values.shift() : 0.99); };

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, descentStage: -2, backSide: '左前',
  affinity: 0, amnionDurability: 100, ...over,
});

function setup(fetuses, { days = 280, stage = '孕晚期' } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 0,
        psyStress: 10, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: { pregnantDays: days, effectivePregnantDays: days, fetusesCount: fetuses.length, fetuses, fetalEnergyDrain: 1 },
      experience: {}, immune: {}, metabolism: {}, cooldown: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const F = (chatState) => P(chatState).pregnant.fetuses;
const rotate = (chatState, fetusIndex, targetAngle) => applyToolCall(chatState, {
  name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'rotate', fetusIndex, targetAngle },
});
const sibling = (chatState, interaction, extra = {}) => applyToolCall(chatState, {
  name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'sibling', interaction, ...extra },
});

test('crowded twins: a big turn can be blocked by the neighbor and then nothing changes', () => {
  // 足月双胎胎量 2 → 拥挤度 0.6，挡住机率 0.6 × 1/(1+1) = 0.3
  const chatState = setup([fetus(1, { tendencyAngle: 180 }), fetus(2, { tendencyAngle: 0 })]);
  const snapshot = () => JSON.stringify({ fetuses: F(chatState), vitality: P(chatState).base.vitality, notify: P(chatState).notify });
  const before = snapshot();
  rolls(0.29);
  const result = rotate(chatState, 0, 0);
  assert.equal(result.applied, false);
  assert.match(result.message, /第2胎挡住了转身的空间/);
  assert.equal(snapshot(), before, '被挡住时状态完全不变');

  rolls(0.31, 0.99);
  assert.equal(rotate(chatState, 0, 0).applied, true, '机率之外照常转');
  assert.equal(F(chatState)[0].tendencyAngle, 0);
  assert.equal(F(chatState)[1].tendencyAngle, 0, '没有被带动');
});

test('a turn that is not blocked can drag the neighbor along, more so inside a shared sac', () => {
  let chatState = setup([fetus(1, { tendencyAngle: 180 }), fetus(2, { tendencyAngle: 90 })]);
  rolls(0.99, 0);
  const result = rotate(chatState, 0, 0);
  assert.equal(result.applied, true, result.message);
  assert.equal(F(chatState)[1].tendencyAngle, 90 - 54, '180° 转到 0° 走 −180°，邻胎跟着转 30%');
  assert.match(P(chatState).notify.secondly || result.message, /第2胎也被带着转了一点/);

  chatState = setup([fetus(1, { tendencyAngle: 90, identicalGroup: 1 }), fetus(2, { tendencyAngle: 90, identicalGroup: 1 })]);
  rolls(0.99, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true);
  assert.equal(F(chatState)[1].tendencyAngle, 90 - 45, '同囊跟着转 50%');
});

test('small turns, single babies and an empty-feeling early womb are never blocked', () => {
  let chatState = setup([fetus(1, { tendencyAngle: 20 }), fetus(2)]);
  rolls(0, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true, '20° 以内不碰邻胎');
  assert.equal(F(chatState)[1].tendencyAngle, 0);

  chatState = setup([fetus(1, { tendencyAngle: 180 })]);
  rolls(0, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true, '单胎不受影响');

  chatState = setup([fetus(1, { tendencyAngle: 180 }), fetus(2)], { days: 60, stage: '孕早期' });
  rolls(0, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true, '胎量很小时不挤');
});

test('engaged or still-hidden neighbors take space but are never dragged or named', () => {
  let chatState = setup([fetus(1, { tendencyAngle: 180 }), fetus(2, { tendencyAngle: 10, descentStage: 0 })], { stage: '第一产程' });
  rolls(0.99, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true);
  assert.equal(F(chatState)[1].descentStage, 0, '邻胎确实在入盆位置');
  assert.equal(F(chatState)[1].tendencyAngle, 10, '入盆的邻胎不被带动');

  // 孕中孕后来才怀上、还没揭晓的那一胎
  chatState = setup([fetus(1, { tendencyAngle: 180 }), fetus(2, { tendencyAngle: 90, conceivedAtDays: 20, revealed: false })]);
  rolls(0);
  const blocked = rotate(chatState, 0, 0);
  assert.equal(blocked.applied, false);
  assert.match(blocked.message, /旁边的胎儿挡住/);
  assert.doesNotMatch(blocked.message, /第2胎/);
  rolls(0.99, 0);
  assert.equal(rotate(chatState, 0, 0).applied, true);
  assert.equal(F(chatState)[1].tendencyAngle, 90, '未揭晓的胎儿不被带动');
});

test('sibling kick turns the other twin a little and leaves affinity alone', () => {
  const chatState = setup([fetus(1, { affinity: 5 }), fetus(2, { tendencyAngle: 100, affinity: -3 })]);
  rolls(0, 0, 0.5, 0.2);
  const result = sibling(chatState, 'kick');
  assert.equal(result.applied, true, result.message);
  assert.equal(F(chatState)[1].tendencyAngle, 85, '被踢的第 2 胎偏转 15°');
  assert.deepEqual(F(chatState).map((f) => f.affinity), [5, -3], '不碰母胎亲和');
  assert.match(P(chatState).notify.secondly, /第1胎踢了第2胎一脚/);
});

test('sibling shoving can swap sides; snuggling changes nothing but the notice', () => {
  let chatState = setup([fetus(1), fetus(2)]);
  rolls(0, 0.9);
  assert.equal(sibling(chatState, 'shove').applied, true);
  assert.deepEqual(F(chatState).map((f) => f.embryoId), [2, 1], '换了左右');
  assert.match(P(chatState).notify.secondly, /第2胎和第1胎推挤起来，两胎换了左右位置/, '用换位前的编号（第 2 胎是推的一方）');

  chatState = setup([fetus(1, { descentStage: 0 }), fetus(2)]);
  rolls(0, 0.9);
  assert.equal(sibling(chatState, 'shove').applied, true);
  assert.deepEqual(F(chatState).map((f) => f.embryoId), [1, 2], '已入盆就挤不动');
  assert.match(P(chatState).notify.secondly, /位置没变/);

  chatState = setup([fetus(1, { tendencyAngle: 30 }), fetus(2, { tendencyAngle: 200 })]);
  const before = JSON.stringify(F(chatState));
  assert.equal(sibling(chatState, 'cuddle').applied, true);
  assert.equal(JSON.stringify(F(chatState)), before);
  assert.match(P(chatState).notify.secondly, /依偎在一起/);
});

test('sibling: fetusIndex picks the actor, otherFetusIndex the target; they must be neighbors', () => {
  const chatState = setup([fetus(1), fetus(2, { tendencyAngle: 100 }), fetus(3, { tendencyAngle: 200 })]);
  rolls(0, 0.2);
  const result = sibling(chatState, 'kick', { fetusIndex: 2, otherFetusIndex: 1 });
  assert.equal(result.applied, true, result.message);
  assert.match(P(chatState).notify.secondly, /第3胎踢了第2胎一脚/);
  assert.equal(F(chatState)[2].tendencyAngle, 200, '动手的一胎不动');

  const far = setup([fetus(1), fetus(2), fetus(3)]);
  const rejected = sibling(far, 'kick', { fetusIndex: 0, otherFetusIndex: 2 });
  assert.equal(rejected.applied, false);
  assert.match(rejected.message, /not next to each other/);

  const self = sibling(setup([fetus(1), fetus(2)]), 'cuddle', { fetusIndex: 0, otherFetusIndex: 0 });
  assert.equal(self.applied, false);

  // 只给动手的一胎：对象取它旁边的一胎
  const one = setup([fetus(1), fetus(2)]);
  assert.equal(sibling(one, 'cuddle', { fetusIndex: 1 }).applied, true);
  assert.match(P(one).notify.secondly, /第2胎和第1胎依偎/);
});

test('sibling interaction is once per story hour and needs two known neighbors', () => {
  const chatState = setup([fetus(1), fetus(2)]);
  assert.equal(sibling(chatState, 'cuddle').applied, true);
  assert.equal(sibling(chatState, 'cuddle').applied, false, '同一小时不能再互动');
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.equal(sibling(chatState, 'cuddle').applied, true, '推进满一小时后重置');
  assert.equal(applyToolCall(chatState, { name: 'bsFetalEvent', arguments: { female: 'A', time: '当天', kind: 'bonding', change: 'slight_increase', content: '轻抚肚子' } }).applied, true,
    '不占胎儿事件的额度');

  assert.equal(sibling(setup([fetus(1)]), 'cuddle').applied, false, '单胎没有对象');
  assert.equal(sibling(setup([fetus(1), fetus(2, { conceivedAtDays: 20, revealed: false })]), 'cuddle').applied, false, '未揭晓的胎儿不被选中');
  assert.match(sibling(setup([fetus(1), fetus(2)]), 'bogus').message, /interaction=kick, shove or cuddle/);
  assert.match(applyToolCall(setup([fetus(1), fetus(2)]), { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'sibling', change: 'slight_increase' } }).message,
    /Unsupported tool/, '旧工具已移除');
});
