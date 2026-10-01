// 妊娠速度上下界（v1.0.7）：种族速度 × 变速倍率夹在 0.03～30 之间，倍率 0 另外代表冻结。
// 注册页勾「此角色使用妊娠变速」时以拉杆的倍率为准，模型只写效果名称与说明。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { GESTATION_SPEED_MAX, GESTATION_SPEED_MIN } from '../scripts/stage_config.js';
import { applyRegistryResult, buildRegistrySystemPrompt } from '../scripts/registry.js';
import { applyToolCall } from '../scripts/tools.js';

test('有效速度夹在 0.03～30，倍率 0 是冻结', () => {
  assert.equal(GESTATION_SPEED_MIN, 0.03);
  assert.equal(GESTATION_SPEED_MAX, 30);
  const speed = (species, modifier) => state.getGestationEffectiveSpeed({ bio: { gestationSpeciesSpeed: species, gestationModifierMultiplier: modifier } });
  assert.equal(speed(1, 28), 28);
  assert.equal(speed(20, 28), 30, '种族速度 × 倍率超过上限要夹住');
  assert.equal(speed(1, 0.03), 0.03);
  assert.equal(speed(1, 0), 0);
});

function pregnantHuman(modifier) {
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  Object.assign(character.profile.base, { stage: '孕早期', days: 20, race: '人类', isHere: true });
  Object.assign(character.profile.bio, { gestationSpeciesSpeed: 1, gestationModifierMultiplier: modifier, birthDifficulty: 1, breedTolerance: 1, identicalProbability: 0 });
  character.profile.pregnant.pregnantDays = 20;
  character.profile.pregnant.effectivePregnantDays = 20;
  character.profile.pregnant.fetuses = [{ embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, backSide: 'left_anterior', affinity: 0, amnionDurability: 100 }];
  character.profile.pregnant.fetusesCount = 1;
  chatState.characters.A = character;
  return chatState;
}

test('×28（十天怀满）逐小时推进：照常走完孕期并进入产程，不会卡住或出错', () => {
  const chatState = pregnantHuman(28);
  const stages = new Set();
  for (let hour = 0; hour < 24 * 30 && !['第一产程', '第二产程', '第三产程', '产后恢复'].includes(chatState.characters.A.profile.base.stage); hour += 1) {
    const result = applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
    assert.notEqual(result.applied, false, result.message);
    stages.add(chatState.characters.A.profile.base.stage);
  }
  for (const stage of ['孕中期', '孕晚期', '临产期']) assert.ok(stages.has(stage), `应经过${stage}，实际 ${[...stages].join('→')}`);
  assert.ok(['产兆前驱', '第一产程', '第二产程', '第三产程', '产后恢复'].some((stage) => stages.has(stage)), '一个月内应已发动');
});

test('×0.03（约 25 年）推进一年：只走约 11 个有效孕日，胎重不会因为供养被放大', () => {
  const chatState = pregnantHuman(0.03);
  for (let week = 0; week < 52; week += 1) applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 7 } });
  const profile = chatState.characters.A.profile;
  assert.ok(Math.abs(profile.pregnant.effectivePregnantDays - (20 + 364 * 0.03)) < 0.01);
  assert.equal(profile.base.stage, '孕早期');
  assert.ok(profile.pregnant.fetuses[0].weight <= 1.2, `胎重 ${profile.pregnant.fetuses[0].weight}`);
});

const human = (pregnant, extra = {}) => ({
  base: { race: '人类', vitalityLevel: 4 },
  pregnant: { fetusesCount: 1, fetuses: [{ fathers: '甲', race: '人类', gender: '女', embryoType: '胎生' }], ...pregnant },
  ...extra,
});

test('注册：勾了变速时倍率以拉杆为准，模型只写名称与说明', () => {
  const chatState = state.createEmptyChatState();
  const character = applyRegistryResult(chatState, {
    name: 'R',
    profile: human({ pregnantDays: 1095 }, { bio: { gestationModifierMultiplier: 0.5, gestationModifierName: '三年之孕', gestationModifierDescription: '胎儿发育极慢' } }),
  }, { useGestationModifier: true, gestationModifierMultiplier: 0.255 });
  assert.equal(character.profile.bio.gestationModifierMultiplier, 0.255, '用拉杆的 0.255，不用模型的 0.5');
  assert.equal(character.profile.bio.gestationModifierName, '三年之孕');
  assert.ok(Math.abs(character.profile.pregnant.effectivePregnantDays - 1095 * 0.255) < 0.01);
  assert.equal(character.profile.base.stage, '临产期');

  const flat = applyRegistryResult(state.createEmptyChatState(), { name: 'R', profile: human({ gestationalAgeDays: 100 }) }, { useGestationModifier: true, gestationModifierMultiplier: 1 });
  assert.equal(flat.profile.bio.gestationModifierMultiplier, 1, '拉杆停在 1 等于没有变速');

  const prompt = buildRegistrySystemPrompt({}, { useGestationModifier: true, gestationModifierMultiplier: 28 });
  assert.match(prompt, /用拉杆设定这名角色的变速倍率为 28/);
});
