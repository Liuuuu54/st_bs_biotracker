// embryoId 由母体的 pregnant.nextEmbryoId 发号：只增不减、跨胎次不归零、永不重用。
// 先露胎、孕中孕宿主与出生编号都靠它跨时间指认同一胎，重号会让引用悄悄指到别的胎儿。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: '原父', race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});

function setup(stage, pregnant) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 20, uterinePressure: 10,
        psyStress: 30, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { gestationSpeciesSpeed: 1, gestationEffectiveSpeed: 1, birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { pregnantDays: 0, effectivePregnantDays: 0, fetuses: [], fetusesCount: 0, ...pregnant },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const inject = (chatState, args) => applyToolCall(chatState, {
  name: 'bsDebugInjectPregnancy',
  arguments: { female: 'A', father: '父', race: '人类', fetusCount: 1, genders: '女', ...args },
});

test('减胎后新胚胎不接手被移除那胎的号码', () => {
  const chatState = setup('孕早期', {
    pregnantDays: 25, effectivePregnantDays: 25, fetusesCount: 2,
    fetuses: [fetus(1), fetus(2)],
  });
  assert.equal(applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', fetusIndex: 1 } }).applied, true);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1]);
  const result = inject(chatState, { mode: 'superfetation' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1, 3], '2 已发过，不得重发');
});

test('计数器跨胎次不归零：上一胎用过的号码不会在下一胎重现', () => {
  const chatState = setup('卵泡期', { nextEmbryoId: 7 });
  const result = inject(chatState, { mode: 'normal', equivalentDays: 20, fetusCount: 2, genders: '男,女' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [7, 8]);
  assert.equal(P(chatState).pregnant.nextEmbryoId, 9);
});

test('手动写入的高号码会把计数器往上推，之后不会撞号', () => {
  const chatState = setup('孕早期', {
    pregnantDays: 25, effectivePregnantDays: 25, fetusesCount: 1, nextEmbryoId: 2,
    fetuses: [fetus(10)],
  });
  const result = inject(chatState, { mode: 'superfetation' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [10, 11]);
});

test('同卵分裂与嵌合融合都从计数器取新号，融合结果不沿用来源号码', () => {
  const chatState = setup('卵泡期', { nextEmbryoId: 5 });
  const result = inject(chatState, {
    mode: 'normal', father: '甲,乙', race: '人类,人类', fetusCount: 2, genders: '男,女',
    equivalentDays: 20, forceChimera: true, forceIdentical: true,
  });
  assert.equal(result.applied, true, result.message);
  const ids = P(chatState).pregnant.fetuses.map((f) => f.embryoId);
  assert.equal(new Set(ids).size, ids.length, '号码不重复');
  assert.ok(ids.every((id) => id > 6), `来源胚胎 5、6 被融合后不得再出现：${ids}`);
});
