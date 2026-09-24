// 先露胎与阵列顺序分离：出生对象由 presentingEmbryoId 指认、按身分移除，
// 阵列顺序（未来的左右位置）不再等于出生顺序；laborBirthNumber 只是出生计数。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, fathers, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});

function laboring({ phase = '胎体娩出', presentingEmbryoId = null, fetuses, pressure = 100, birthNumber = 1 } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '第二产程', days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0,
        uterinePressure: pressure, psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [],
        fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: 280, effectivePregnantDays: 280, fetusesCount: fetuses.length, fetuses,
        fetalEnergyDrain: 1, amnionDurability: 0, laborPhase: phase, laborBirthNumber: birthNumber,
        laborHours: 0, effectiveLaborHours: 0, presentingEmbryoId,
      },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const pass = (chatState, hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });

test('生下的是先露胎，不是阵列第一个；出生后清空先露引用', () => {
  Math.random = () => 0.99;
  const chatState = laboring({ presentingEmbryoId: 2, fetuses: [fetus(1, '甲'), fetus(2, '乙')] });
  pass(chatState, 1);
  assert.deepEqual(P(chatState).children.map((child) => child.fathers), ['乙']);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1]);
  assert.equal(P(chatState).pregnant.laborPhase, '间歇期');
});

test('间歇期结束开始下一胎下降时重新锁定先露胎，出生计数加一', () => {
  Math.random = () => 0.99;
  const chatState = laboring({ phase: '间歇期', fetuses: [fetus(3, '丙'), fetus(4, '丁')] });
  pass(chatState, 1);
  assert.equal(P(chatState).pregnant.laborPhase, '胎体下降');
  assert.equal(P(chatState).pregnant.laborBirthNumber, 2);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 3);
});

test('先露胎锁定后，阵列换位不会改变出生对象', () => {
  Math.random = () => 0.99;
  const chatState = laboring({ presentingEmbryoId: 1, fetuses: [fetus(1, '甲'), fetus(2, '乙')] });
  P(chatState).pregnant.fetuses.reverse();
  pass(chatState, 1);
  assert.deepEqual(P(chatState).children.map((child) => child.fathers), ['甲']);
});

test('高宫压快速娩出也只生先露胎', () => {
  Math.random = () => 0.99;
  const chatState = laboring({ phase: '胎体下降', presentingEmbryoId: 2, pressure: 9999, fetuses: [fetus(1, '甲'), fetus(2, '乙')] });
  pass(chatState, 1);
  assert.deepEqual(P(chatState).children.map((child) => child.fathers), ['乙']);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1]);
});

test('未锁定时不选孕中孕内胎与待着床胚胎', () => {
  Math.random = () => 0.99;
  const chatState = laboring({
    phase: '间歇期',
    fetuses: [
      fetus(5, '内', { nestedInEmbryoId: 6 }),
      fetus(7, '晚', { pendingImplantation: true }),
      fetus(6, '宿主'),
    ],
  });
  pass(chatState, 1);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 6);
});

test('先露胎被移除（减胎）后引用立即清空，不留悬空编号', () => {
  const chatState = laboring({ phase: '胎体下降', presentingEmbryoId: 2, fetuses: [fetus(1, '甲'), fetus(2, '乙')] });
  P(chatState).base.stage = '孕晚期';
  const result = applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', fetusIndex: 1 } });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null);
});

test('新建角色不再带 laborFetusIndex；旧栏位载入时移除', () => {
  const chatState = laboring({ fetuses: [fetus(1, '甲')] });
  P(chatState).pregnant.laborFetusIndex = 3;
  const normalized = state.normalizeCharacterPsychologyState(chatState.characters.A);
  assert.equal('laborFetusIndex' in normalized.profile.pregnant, false);
  const fresh = state.createEmptyChatState();
  assert.equal(JSON.stringify(fresh).includes('laborFetusIndex'), false);
});

test('bsAbortion 的 fetusIndex 按 prompt 可见列表解析，不会减掉未揭晓的异期胎', () => {
  const chatState = laboring({ fetuses: [
    fetus(1, '隐', { conceivedAtDays: 200, tags: ['superfetation'] }),
    fetus(2, '甲'),
    fetus(3, '乙'),
  ] });
  P(chatState).base.stage = '孕晚期';
  const result = applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', fetusIndex: 0 } });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1, 3], '可见列表的第 0 胎是 2');
  assert.equal(applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', fetusIndex: 1 } }).applied, false, '可见的只剩一胎，下标 1 越界');
});
