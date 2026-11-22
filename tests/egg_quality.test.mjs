// 卵子品质（1.5.3）：体质 → 基准、当下 → 这一轮、这一轮 → 着床／起始健康／胎重／周期浮动
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cycleLengthSpread, eggQualityFromVitalityLevel, eggWeightFactor, getEggQualityTier, implantationFailChance,
  normalizeEggQuality, rollCycleEgg,
} from '../scripts/egg_quality.js';
import * as state from '../scripts/state.js';
import { migrateCharacters } from '../scripts/state_migration.js';
import { applyToolCall, getStageLimit, startNewCycle } from '../scripts/tools.js';

test('与精子品质同一把尺：0.25～4，分级文字照同一组门槛', () => {
  assert.equal(normalizeEggQuality(9), 4);
  assert.equal(normalizeEggQuality(0.01), 0.25);
  assert.equal(normalizeEggQuality('x'), 1);
  assert.deepEqual([0.3, 0.7, 1, 2, 3.5].map(getEggQualityTier), ['很差', '偏弱', '一般', '良好', '极佳']);
  assert.deepEqual([1, 4, 7].map(eggQualityFromVitalityLevel), [0.5, 1, 1.6]);
});

test('着床失败率：标准约 5%，越差越高，夹在 0.5%～60%', () => {
  assert.ok(Math.abs(implantationFailChance(1) - 0.05) < 1e-9);
  assert.ok(Math.abs(implantationFailChance(0.25) - 0.4) < 1e-9);
  assert.ok(implantationFailChance(4) >= 0.005 && implantationFailChance(4) < 0.01);
  assert.ok(implantationFailChance(2) < implantationFailChance(1));
});

test('胎重系数小幅：0.85～1.15', () => {
  assert.equal(eggWeightFactor(1), 1);
  assert.ok(eggWeightFactor(4) <= 1.15 && eggWeightFactor(4) > 1);
  assert.ok(eggWeightFactor(0.25) >= 0.85 && eggWeightFactor(0.25) < 1);
});

test('掷这一轮：同一颗种子同一个结果；健康的人周期完全规律，体质差或情压爆表才乱', () => {
  const a = rollCycleEgg(1, { seed: 's1' });
  assert.deepEqual(a, rollCycleEgg(1, { seed: 's1' }));
  assert.equal(a.lengthFactor, 1, '基准 1、状态正常：长度系数 1');
  assert.equal(cycleLengthSpread(1), 0);
  assert.ok(cycleLengthSpread(0.25) > cycleLengthSpread(0.5));
  const stressed = rollCycleEgg(1, { psyStress: 190, stressCap: 200, seed: 's1' });
  assert.ok(stressed.quality < a.quality, '情压爆表往下拉');
  assert.notEqual(rollCycleEgg(0.25, { seed: 's2' }).lengthFactor, 1, '卵子品质差：周期会浮动');
});

function setup(eggQuality, stage = '月经期') {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage, days: 0, eggQuality, cycleEggQuality: eggQuality, vitality: 100, psyStress: 0 });
  chat.characters.A = ch;
  return chat;
}

test('开新一轮时掷：进卵泡期那一刻更新这一轮的卵与长度系数', () => {
  const chat = setup(0.25);
  applyToolCall(chat, { name: 'bsPassedTime', arguments: { day: 6 } });
  const base = chat.characters.A.profile.base;
  assert.equal(base.stage, '卵泡期');
  assert.ok(base.cycleLengthFactor !== 1, '卵子品质差，这一轮长度有浮动');
  assert.ok(Math.abs(getStageLimit(chat.characters.A.profile, '卵泡期') - 9 * base.cycleLengthFactor) < 1e-9);
  startNewCycle(chat.characters.A.profile, 99999);
  assert.ok(base.cycleEggQuality >= 0.25 && base.cycleEggQuality <= 4);
});

test('迁移 v18 → v19：照活力等级补基准，这一轮照基准、周期规律', () => {
  const characters = { A: { profile: { base: { vitalityLevel: 2 } } }, B: { profile: { base: { vitalityLevel: 6, eggQuality: 3 } } } };
  migrateCharacters(characters, 18);
  assert.deepEqual([characters.A.profile.base.eggQuality, characters.A.profile.base.cycleEggQuality, characters.A.profile.base.cycleLengthFactor], [0.7, 0.7, 1]);
  assert.equal(characters.B.profile.base.eggQuality, 3, '已有的保留');
});

test('卵子品质的文字：天生生育力一般不写，这一轮只写与平常不同处与月经准不准（1.5.3）', async () => {
  const { describeFertility, describeCycleCondition } = await import('../scripts/egg_quality.js');
  assert.equal(describeFertility(0.3), '体质孱弱，不易怀上，怀上了也不稳');
  assert.equal(describeFertility(0.7), '生育力偏弱');
  assert.equal(describeFertility(1), '');
  assert.equal(describeFertility(2), '生育力旺盛，容易受孕');
  assert.equal(describeFertility(4), '极易受孕');
  assert.equal(describeCycleCondition({ eggQuality: 1, cycleEggQuality: 1 }), '');
  assert.equal(describeCycleCondition({ eggQuality: 1, cycleEggQuality: 0.7 }), '这一轮的卵比平常差');
  assert.equal(describeCycleCondition({ eggQuality: 1, cycleEggQuality: 2, boosted: true }), '这一轮受了助孕，卵比平常好');
  assert.equal(describeCycleCondition({ eggQuality: 0.3, cycleEggQuality: 0.3 }), '月经常常不准，可能提早或延后几天');
});

test('卵子品质的文字送到追踪与主线；怀孕时不送', async () => {
  const state = await import('../scripts/state.js');
  const { buildMainFlowPrompt, buildTrackerPayload } = await import('../scripts/tracker.js');
  const ctx = { chatId: 'egg-text', chat: [{ is_user: false, name: 'N', mes: '旅途中。' }], characters: [], name1: 'U', name2: 'N', extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  const ch = state.createDefaultFemaleState('朵拉');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '黄体期', age: 34, eggQuality: 0.4, cycleEggQuality: 0.25 });
  chatState.characters['朵拉'] = ch;
  const tracked = buildTrackerPayload(ctx, settings, 'manual').existing_state['朵拉'].profile.base;
  assert.equal(tracked.fertility, '体质孱弱，不易怀上，怀上了也不稳');
  assert.equal(tracked.cycleCondition, '这一轮的卵比平常差；月经常常不准，可能提早或延后几天');
  assert.equal(tracked.eggQuality, 0.4, '追踪模型照旧有数字');
  const narrated = JSON.parse(buildMainFlowPrompt(ctx, settings).match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\/').join('</'))['朵拉'].profile.base;
  assert.equal(narrated.fertility, tracked.fertility);
  assert.equal(narrated.cycleCondition, tracked.cycleCondition);
  assert.equal(narrated.eggQuality, undefined, '主线只有文字');
  ch.profile.base.stage = '孕中期';
  const pregnant = buildTrackerPayload(ctx, settings, 'manual').existing_state['朵拉'].profile.base;
  assert.equal(pregnant.fertility, undefined);
});
