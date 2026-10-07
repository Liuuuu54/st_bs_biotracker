// 混血多胎：孕期取最长那一胎；第二产程逐胎用正在娩出那胎自己的分娩难度，第一、三产程沿用平均。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, resolveLaborPhaseHours } from '../scripts/tools.js';
import { getRacePhysiologyProfile } from '../scripts/race_config.js';

function pregnantWith(races) {
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('母');
  character.initialized = true;
  character.profile.base.age = 25;
  character.profile.base.stage = '孕早期';
  character.profile.pregnant.pregnantDays = 30;
  character.profile.pregnant.effectivePregnantDays = 30;
  character.profile.pregnant.fetuses = races.map((race, index) => ({
    embryoId: index + 1, race, fathers: '父', weight: 1, tendencyAngle: 0, gender: '女',
  }));
  chatState.characters['母'] = character;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  return chatState.characters['母'].profile;
}

test('混血多胎的孕期取最长（最慢）的那一胎', () => {
  const profile = pregnantWith(['人类', '怪鸟类']);
  assert.equal(profile.bio.gestationSpeciesSpeed, 1, '人类 280 天与怪鸟类 14 天同怀，按人类的孕期');
  const dragon = pregnantWith(['人类', '西方龙']);
  assert.equal(dragon.bio.gestationSpeciesSpeed, getRacePhysiologyProfile('西方龙').gestationSpeciesSpeed);
});

test('第二产程按正在娩出那一胎的分娩难度，同族多胎与原本相同', () => {
  const stage2 = (profile) => resolveLaborPhaseHours(profile, '第二产程', '胎体娩出');
  const human = pregnantWith(['人类']);
  const giant = pregnantWith(['巨人']);
  const ratio = getRacePhysiologyProfile('巨人').birthDifficulty / getRacePhysiologyProfile('人类').birthDifficulty;
  assert.ok(Math.abs(stage2(giant) / stage2(human) - ratio) < 1e-9);

  // 人类与巨人各一：平均难度只用在第一、三产程，第二产程看当下先露的那胎
  const mixed = pregnantWith(['人类', '巨人']);
  const presenting = mixed.pregnant.fetuses[0];
  const own = getRacePhysiologyProfile(presenting.race).birthDifficulty * 1.08;
  assert.ok(Math.abs(stage2(mixed) / stage2(human) - own / getRacePhysiologyProfile('人类').birthDifficulty) < 1e-9);
  const average = (getRacePhysiologyProfile('人类').birthDifficulty + getRacePhysiologyProfile('巨人').birthDifficulty) / 2 * 1.08;
  assert.ok(Math.abs(mixed.bio.birthDifficulty - average) < 1e-9, '母体整体的分娩难度仍是平均乘胎数修正');

  // 同族双胎：逐胎难度等于平均，结果与改动前一致
  const twins = pregnantWith(['人类', '人类']);
  assert.ok(Math.abs(stage2(twins) / stage2(human) - 1.08) < 1e-9);
});
