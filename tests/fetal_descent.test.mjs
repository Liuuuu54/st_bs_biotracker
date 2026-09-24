// descentStage 的资料层：各阶段上限、新胎起点、以及 reconcileFetalDescent 维持的空间不变量。
// -3 宫顶、-2 宫内自由、-1 子宫低位、0 入盆、1 进入产道、2 着冠、3 先露部已出。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, ...over,
});

function setup(stage, fetuses, pregnant = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 10,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: 150, effectivePregnantDays: 150, fetusesCount: fetuses.length, fetuses, fetalEnergyDrain: 1,
        laborPhase: null, laborBirthNumber: 0, laborHours: 0, effectiveLaborHours: 0, presentingEmbryoId: null,
        prodromalRemainingHours: 48, ...pregnant,
      },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
const depths = (chatState) => P(chatState).pregnant.fetuses.map((f) => f.descentStage);

test('缺值的胎儿从宫内自由 -2 起算；待着床胚胎没有位置', () => {
  const chatState = setup('孕中期', [fetus(1), fetus(2, { pendingImplantation: true, descentStage: -1 })]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-2, undefined]);
});

test('孕期最多到子宫低位 -1，不能入盆；最高是宫顶 -3', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: 0 }), fetus(2, { descentStage: 2 }), fetus(3, { descentStage: -7 })]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-1, -1, -3]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null, '孕期没有胎儿能到入口，不会锁定先露');
});

test('产兆前驱可入盆至 0；第二产程可到 3', () => {
  const prodromal = setup('产兆前驱', [fetus(1, { descentStage: 2 })]);
  touch(prodromal);
  assert.deepEqual(depths(prodromal), [0]);
  const second = setup('第二产程', [fetus(1, { descentStage: 3 })], { laborPhase: '胎体娩出', presentingEmbryoId: 1 });
  touch(second);
  assert.deepEqual(depths(second), [3]);
});

test('有胎儿到达入口而尚无先露胎时，锁定最深者（同值取编号小者）；入口只容一胎', () => {
  const chatState = setup('产兆前驱', [fetus(5, { descentStage: 0 }), fetus(3, { descentStage: 0 }), fetus(4, { descentStage: -1 })]);
  touch(chatState);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 3);
  assert.deepEqual(depths(chatState), [-1, 0, -1], '另一胎被挡回子宫低位');
});

test('已锁定的先露胎优先占用入口，不因他胎更深而被取代', () => {
  const chatState = setup('第二产程', [fetus(1, { descentStage: 2 }), fetus(2, { descentStage: 1 })], { laborPhase: '胎体下降', presentingEmbryoId: 2 });
  touch(chatState);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 2);
  assert.deepEqual(depths(chatState), [-1, 1]);
});

test('包在宿主体内的内胎与宿主同步；已被生出的内胎保有自己的位置', () => {
  const chatState = setup('孕晚期', [
    fetus(1, { descentStage: -3 }),
    fetus(2, { nestedInEmbryoId: 1, descentStage: -1 }),
    fetus(3, { nestedInEmbryoId: 1, nestedReleased: true, amnionDurability: 0, descentStage: -1 }),
  ]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-3, -3, -1]);
});

test('退回妊娠阶段时上限随之收回：入口上的胎儿退到子宫低位，先露锁定释放', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: 0 })], { presentingEmbryoId: 1 });
  touch(chatState);
  assert.deepEqual(depths(chatState), [-1]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null);
});

test('产兆前驱中先露胎被托回负值区域就释放锁定，由仍在入口者接手', () => {
  const chatState = setup('产兆前驱', [fetus(1, { descentStage: -1 }), fetus(2, { descentStage: 0 })], { presentingEmbryoId: 1 });
  touch(chatState);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 2);
});
