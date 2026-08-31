import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall, syncManualMenstrualStageTransition } from '../scripts/tools.js';
import { createDefaultFemaleState } from '../scripts/state.js';

function makeState(stage = '卵泡期') {
  return {
    characters: {
      F: {
        ...createDefaultFemaleState('F'),
        initialized: true,
        profile: {
          ...createDefaultFemaleState('F').profile,
          base: {
            ...createDefaultFemaleState('F').profile.base,
            stage,
            race: '人类',
            vitality: 100,
            eggs: 0,
          },
          bio: {
            ...createDefaultFemaleState('F').profile.bio,
            impregnationDifficulty: 1,
            breedTolerance: 1,
            orgasmOvulationAmount: 0,
          },
        },
      },
    },
  };
}

function add(state, male, amount, race = '人类') {
  applyToolCall(state, { name: 'bsAddSperm', arguments: { female: 'F', male, race, amount, ejaculatedInside: true, protected: false } });
}

test('精液进入只登记 candidate，不立即受精；洗澡和排精不撤销资格', () => {
  const state = makeState();
  add(state, 'A', 20);
  let profile = state.characters.F.profile;
  assert.equal(profile.pregnant.fetuses.length, 0);
  assert.deepEqual(profile.base.conceptionCandidates, [{ male: 'A', race: '人类', derivedType: null, competitionWeight: 20 }]);

  applyToolCall(state, { name: 'bsDrainSperm', arguments: { female: 'F', amount: 20 } });
  profile = state.characters.F.profile;
  assert.deepEqual(profile.base.sperms, []);
  assert.equal(profile.base.conceptionCandidates.length, 1);
});

test('同一男性同周期合并竞争权重，父系快照保留 derivedType', () => {
  const state = makeState();
  add(state, 'A', 20, '[血族]人类');
  add(state, 'B', 10, '精灵');
  add(state, 'A', 15, '[血族]人类');
  const candidates = state.characters.F.profile.base.conceptionCandidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], { male: 'A', race: '人类', derivedType: '血族', competitionWeight: 35 });
  assert.equal(candidates[1].competitionWeight, 10);
});

test('排卵统一逐卵结算，多人可重复成为父源，结算后清空 candidates', () => {
  const state = makeState('排卵期');
  add(state, 'A', 30);
  add(state, 'B', 20);
  add(state, 'C', 10);
  state.characters.F.profile.base.eggs = 3;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    applyToolCall(state, { name: 'bsPassedTime', arguments: { day: 1 } });
  } finally {
    Math.random = originalRandom;
  }
  const profile = state.characters.F.profile;
  assert.equal(profile.base.eggs, 0);
  assert.deepEqual(profile.base.conceptionCandidates, []);
  assert.deepEqual(profile.pregnant.fetuses.map((fetus) => fetus.fathers), ['A', 'A', 'A', 'A']);
});

test('排卵结算后发生的性交不加入已结束的本次竞争', () => {
  const state = makeState('排卵期');
  state.characters.F.profile.base.eggs = 1;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    applyToolCall(state, { name: 'bsPassedTime', arguments: { day: 1 } });
  } finally {
    Math.random = originalRandom;
  }
  add(state, 'B', 20);
  assert.deepEqual(state.characters.F.profile.base.conceptionCandidates, []);
  assert.equal(state.characters.F.profile.pregnant.fetuses.length, 0);
});

test('手动进入卵泡期时清空上一周期竞争来源并允许新周期登记', () => {
  const state = makeState('排卵期');
  add(state, 'A', 20);
  state.characters.F.profile.cooldown.naturalConceptionResolved = true;

  applyToolCall(state, { name: 'bsSetMenstrualPhases', arguments: { female: 'F', stage: '卵泡期' } });
  let profile = state.characters.F.profile;
  assert.deepEqual(profile.base.conceptionCandidates, []);
  assert.equal(profile.cooldown.naturalConceptionResolved, false);

  add(state, 'B', 10);
  profile = state.characters.F.profile;
  assert.deepEqual(profile.base.conceptionCandidates, [{ male: 'B', race: '人类', derivedType: null, competitionWeight: 10 }]);
});

test('默认新状态包含空 candidate 池；手动进入排卵期时从残留精液建立候选', () => {
  const character = createDefaultFemaleState('F');
  assert.deepEqual(character.profile.base.conceptionCandidates, []);
  character.profile.base.sperms = [{ male: 'Old', race: '人类', derivedType: null, value: 20 }];
  assert.deepEqual(character.profile.base.conceptionCandidates, []);

  const state = { characters: { F: { ...character, initialized: true } } };
  applyToolCall(state, { name: 'bsSetMenstrualPhases', arguments: { female: 'F', stage: '排卵期' } });
  assert.deepEqual(state.characters.F.profile.base.conceptionCandidates, [{
    male: 'Old', race: '人类', derivedType: null, competitionWeight: 20,
  }]);
});

test('完整变量面板直接改为排卵期时重置结算状态并补建候选', () => {
  const character = createDefaultFemaleState('F');
  character.profile.base.stage = '黄体期';
  character.profile.base.sperms = [
    { male: 'A', race: '人类', derivedType: null, value: 20 },
  ];
  character.profile.cooldown.naturalConceptionResolved = true;
  character.profile.base.stage = '排卵期';
  syncManualMenstrualStageTransition(character, '黄体期');

  assert.equal(character.profile.cooldown.naturalConceptionResolved, false);
  assert.equal(character.profile.cooldown.naturalOvulationUsed, false);
  assert.deepEqual(character.profile.base.conceptionCandidates, [{
    male: 'A', race: '人类', derivedType: null, competitionWeight: 20,
  }]);
});

test('完整变量面板重复保存排卵期不会重新开启已结算窗口', () => {
  const character = createDefaultFemaleState('F');
  character.profile.base.stage = '排卵期';
  character.profile.cooldown.naturalConceptionResolved = true;
  syncManualMenstrualStageTransition(character, '排卵期');

  assert.equal(character.profile.cooldown.naturalConceptionResolved, true);
});

test('完整变量面板只修改 eggs 不会重置自然受精结算状态', () => {
  const character = createDefaultFemaleState('F');
  character.profile.base.stage = '排卵期';
  character.profile.base.eggs = 2;
  character.profile.cooldown.naturalConceptionResolved = true;
  const previousStage = character.profile.base.stage;
  character.profile.base.eggs = 3;
  syncManualMenstrualStageTransition(character, previousStage);

  assert.equal(character.profile.base.eggs, 3);
  assert.equal(character.profile.cooldown.naturalConceptionResolved, true);
});