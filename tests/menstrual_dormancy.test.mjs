// 休眠期：长周期物种月经后的静止期，不排卵、不受孕；经期倍率只管活动周期，着床前与产科偏移不受休眠影响
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { getMergedRacePhysiologyProfile, getRacePhysiologyProfile } from '../scripts/race_config.js';
import { applyToolCall, getStageLimit } from '../scripts/tools.js';
import { calculateRaceImplantationDays } from '../scripts/calculator.js';
import { buildSingleRacePhysiologyText, describeRaceFieldValue } from '../scripts/race_prompt_context.js';
import { migrateCharacters } from '../scripts/state_migration.js';

function setup(race, stage = '月经期', days = 0) {
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  character.profile.base.age = 22;
  character.profile.base.race = race;
  character.profile.bio = { ...character.profile.bio, ...getRacePhysiologyProfile(race) };
  character.profile.base.stage = stage;
  character.profile.base.days = days;
  chatState.characters.A = character;
  return chatState;
}

const pass = (chatState, day) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day } });
const base = (chatState) => chatState.characters.A.profile.base;

test('长周期物种的倍率降回活动周期，其余长度转成休眠；人类与没写的物种为 0，混血按血统加权', () => {
  assert.deepEqual(
    [getRacePhysiologyProfile('天使').menstrualLengthRatio, getRacePhysiologyProfile('天使').dormancyDays],
    [1.5, 322],
  );
  assert.equal(getRacePhysiologyProfile('人类').dormancyDays, 0);
  assert.equal(getRacePhysiologyProfile('哥布林').dormancyDays, 0, '没写的内置物种补 0');
  assert.equal(getRacePhysiologyProfile('哥布林').seasonCycles, 1);
  assert.deepEqual([getRacePhysiologyProfile('兽耳族').dormancyDays, getRacePhysiologyProfile('兽耳族').seasonCycles], [120, 3], '兽娘一年两次发情季');
  for (const race of ['米诺陶族', '萨堤尔族', '月兔']) assert.equal(getRacePhysiologyProfile(race).seasonCycles, 3, race);
  assert.equal(getMergedRacePhysiologyProfile('天使x人类').dormancyDays, 161);
  assert.equal(calculateRaceImplantationDays('天使'), 9, '着床前只看活动周期 42 天');
});

test('月经期结束进入休眠期，休眠满了才进卵泡期；没有休眠的人类直接进卵泡期', () => {
  const angel = setup('天使');
  pass(angel, 8);
  assert.equal(base(angel).stage, '休眠期');
  assert.equal(getStageLimit(angel.characters.A.profile, '休眠期'), 322);
  pass(angel, 321);
  assert.equal(base(angel).stage, '休眠期');
  pass(angel, 1);
  assert.equal(base(angel).stage, '卵泡期');

  const human = setup('人类');
  pass(human, 6);
  assert.equal(base(human).stage, '卵泡期');
});

test('休眠期不留卵；可用 bsSetMenstrualPhases 切入', () => {
  const chatState = setup('天使', '卵泡期');
  const result = applyToolCall(chatState, { name: 'bsSetMenstrualPhases', arguments: { female: 'A', stage: '休眠期' } });
  assert.equal(result.applied, true);
  base(chatState).eggs = 2;
  pass(chatState, 1);
  assert.equal(base(chatState).stage, '休眠期');
  assert.equal(base(chatState).eggs, 0);
});

test('名录与百科编辑器报出休眠天数', () => {
  assert.match(buildSingleRacePhysiologyText('天使'), /经期长度: 42天左右；月经后另有约 322 天休眠期（不排卵、不受孕），约 364 天才有一次受孕机会/);
  assert.match(buildSingleRacePhysiologyText('人类'), /经期长度: 28天左右\n/);
  assert.match(describeRaceFieldValue('dormancyDays', 322), /休眠约 322 天/);
  assert.match(describeRaceFieldValue('dormancyDays', 0), /没有休眠期/);
});

test('v10 存档迁移：倍率仍是旧内置值的换成新倍率与休眠，期中天数等比缩放；改过的与无关物种不动', () => {
  const make = (race, ratio, stage = '月经期', days = 26) => {
    const character = state.createDefaultFemaleState(race);
    character.profile.base.race = race;
    character.profile.base.bloodline = null;
    character.profile.base.stage = stage;
    character.profile.base.days = days;
    character.profile.bio.menstrualLengthRatio = ratio;
    return character;
  };
  const characters = {
    angel: make('天使', 13),
    custom: make('天使', 5),
    half: make('精灵x人类', 2),
    human: make('人类', 1),
    fox: make('妖狐', 1, '黄体期', 5),
    horse: make('半人马', 1),
  };
  migrateCharacters(characters, 10);
  assert.equal(characters.angel.profile.bio.menstrualLengthRatio, 1.5);
  assert.equal(characters.angel.profile.bio.dormancyDays, 322);
  assert.equal(characters.angel.profile.base.days, 3, '月经期 65 天的第 26 天 → 7.5 天的第 3 天');
  assert.equal(characters.custom.profile.bio.menstrualLengthRatio, 5);
  assert.equal(characters.custom.profile.bio.dormancyDays, 0);
  assert.equal(characters.half.profile.bio.menstrualLengthRatio, 1.125);
  assert.equal(characters.half.profile.bio.dormancyDays, 147.5);
  assert.equal(characters.human.profile.bio.menstrualLengthRatio, 1);
  assert.equal(characters.human.profile.base.days, 26);
  assert.deepEqual([characters.fox.profile.bio.menstrualLengthRatio, characters.fox.profile.bio.dormancyDays, characters.fox.profile.bio.seasonCycles], [1, 337, 1]);
  assert.equal(characters.fox.profile.base.days, 5, '倍率没变的只补休眠，天数不动');
  assert.deepEqual([characters.horse.profile.bio.menstrualLengthRatio, characters.horse.profile.bio.seasonCycles], [0.75, 8]);
});

test('繁殖季内连续多轮：没跑满轮数就直接回卵泡期，跑满才休眠并归零', () => {
  const horse = setup('半人马');
  base(horse).seasonCycle = 6;
  pass(horse, 4);
  assert.equal(base(horse).stage, '卵泡期');
  assert.equal(base(horse).seasonCycle, 7);
  pass(horse, 18);
  assert.equal(base(horse).stage, '月经期');
  pass(horse, 4);
  assert.equal(base(horse).stage, '休眠期');
  assert.equal(base(horse).seasonCycle, 0);

  const fox = setup('妖狐');
  pass(fox, 6);
  assert.equal(base(fox).stage, '休眠期', '一年一次的狐每轮都休眠');
  assert.match(buildSingleRacePhysiologyText('半人马'), /21天左右；繁殖季连续约 8 轮（约 168 天，每轮都能受孕），之后休眠约 197 天/);
  assert.equal(Math.round(getMergedRacePhysiologyProfile('半人马x人类').seasonCycles * 10) / 10, 4.5);
});
