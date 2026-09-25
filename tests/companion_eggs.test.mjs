// 伴生卵：每个独立有效胚胎伴随的背景卵（旧「卵群」减去那一名有效后代）。
// 不发育、不建立胎儿卡或孩子；同卵分裂平分、嵌合相加、出生时随该胎排出。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import {
  getCompanionEggsMeanByRace,
  getEmbryoTypeByRace,
  getRacePhysiologyProfile,
  getSpermDoseCompanionMultiplier,
  getSpermDoseDifficultyBonus,
  rollCompanionEggCount,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';
import { TRACKER_VARIABLE_GUIDE_PROMPT } from '../scripts/tracker_prompt_context.js';

const REAL_RANDOM = Math.random;
afterEach(() => {
  setRacePhysiologyOverrides({});
  Math.random = REAL_RANDOM;
});

test('只有明确列出的种族有伴生卵，其余为 0', () => {
  const expected = {
    触手怪: 3, 宝箱怪: 7, 海妖: 10, 怪鱼类: 32, 狗头人: 1,
    蛇人: 0, 人鱼: 0, 深潜者: 0, 史萊姆: 3,
  };
  for (const [race, mean] of Object.entries(expected)) {
    assert.equal(getRacePhysiologyProfile(race).companionEggsMean, mean, race);
  }
  assert.equal(getCompanionEggsMeanByRace('妖精'), 0);
  assert.equal(getCompanionEggsMeanByRace('鸟人'), 0);
});

test('混血先由最长孕期决定胚型，再在整群尺度上做几何平均', () => {
  // 人类孕期长于怪鸟类，此混血先落到胎生，伴生卵硬固定为 0。
  assert.equal(getEmbryoTypeByRace('怪鸟类x人类'), '胎生');
  assert.equal(getCompanionEggsMeanByRace('怪鸟类x人类'), 0);
  // 两者均为卵生：整群 4 与 5 的几何平均再减一
  assert.equal(getEmbryoTypeByRace('怪鸟类x蜥蜴人'), '卵生');
  assert.ok(Math.abs(getCompanionEggsMeanByRace('怪鸟类x蜥蜴人') - (Math.sqrt(4 * 5) - 1)) < 0.000001);
});

test('百科覆写会改变伴生卵计算；均值 0 永远不会被随机成 1', () => {
  setRacePhysiologyOverrides({ 怪鸟类: { companionEggsMean: 7 } });
  assert.equal(getCompanionEggsMeanByRace('怪鸟类'), 7);
  assert.equal(rollCompanionEggCount('怪鸟类', () => 0), 6);
  assert.equal(rollCompanionEggCount('怪鸟类', () => 1), 8);
  assert.equal(rollCompanionEggCount('妖精', () => 1, 1000), 0);
});

test('精液有效量影响受孕难度与伴生卵，但不会突破 0 的硬规则', () => {
  assert.equal(getSpermDoseCompanionMultiplier(10), 0.75);
  assert.equal(getSpermDoseCompanionMultiplier(20), 1);
  assert.equal(getSpermDoseCompanionMultiplier(30), 1.25);
  assert.equal(getSpermDoseCompanionMultiplier(40), 1.5);
  assert.equal(getSpermDoseCompanionMultiplier(1000), 1.5, '剂量倍率必须封顶');
  assert.equal(getSpermDoseDifficultyBonus(5), 0.5);
  assert.equal(getSpermDoseDifficultyBonus(20), 1);
  assert.equal(getSpermDoseDifficultyBonus(80), 2);
  assert.equal(getSpermDoseDifficultyBonus(1000), 2, '受孕加成必须封顶');

  assert.equal(rollCompanionEggCount('怪鸟类', () => 0.5, 10), 2);
  assert.equal(rollCompanionEggCount('怪鸟类', () => 0.5, 20), 3);
  assert.equal(rollCompanionEggCount('怪鸟类', () => 0.5, 40), 5);
  assert.equal(rollCompanionEggCount('妖精', () => 0.5, 40), 0);
});

const oneMother = (fetuses, stage = '临产期') => ({
  characters: {
    孕母: {
      name: '孕母', initialized: true,
      profile: {
        base: { stage, days: 1, race: '触手怪', vitality: 100, vitalityLevel: 4, psyStressLevel: 4 },
        bio: {}, immune: {}, experience: {}, metabolism: {}, cooldown: {},
        pregnant: { fetuses, fetusesCount: fetuses.length, pregnantDays: 56 },
      },
    },
  },
});

test('手术产：只建立有效后代，伴生卵一起排出并记在出生背景', () => {
  const chatState = oneMother([{ fathers: '异形', race: '触手怪', gender: '无性', embryoType: '不定型', companionEggCount: 9, weight: 1 }]);
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '孕母' } });
  assert.equal(result.applied, true);
  const profile = chatState.characters['孕母'].profile;
  assert.equal(profile.children.length, 1, '不得按十枚卵建立十名孩子');
  assert.equal(profile.children[0].birthCompanionEggCount, 9);
  assert.match(profile.notify.secondly, /生下了1个孩子，并排出9枚伴生卵/);
});

test('没有伴生卵时通知省略', () => {
  const chatState = oneMother([{ fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', companionEggCount: 0, weight: 1 }]);
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '孕母' } });
  const profile = chatState.characters['孕母'].profile;
  assert.equal(profile.children[0].birthCompanionEggCount, 0);
  assert.doesNotMatch(profile.notify.secondly, /伴生卵/);
});

test('第二产程逐胎娩出：每胎只排出自己的伴生卵，不互相挪用', () => {
  Math.random = () => 0.99;
  const chatState = oneMother([
    { embryoId: 1, fathers: '甲', race: '触手怪', gender: '无性', embryoType: '卵生', companionEggCount: 3, weight: 1, descentStage: 2 },
    { embryoId: 2, fathers: '乙', race: '触手怪', gender: '无性', embryoType: '卵生', companionEggCount: 7, weight: 1 },
  ], '第二产程');
  const profile = chatState.characters['孕母'].profile;
  Object.assign(profile.pregnant, { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1, pregnantDays: 280, effectivePregnantDays: 280 });
  Object.assign(profile.base, { uterinePressure: 120, age: 24, isHere: true });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  const after = chatState.characters['孕母'].profile;
  // 触手怪分娩很快，一小时内可能两胎都生完；逐一核对各自带出的伴生卵
  const first = after.children.find((child) => child.fathers === '甲');
  assert.equal(first.birthCompanionEggCount, 3);
  assert.match(String(after.notify.secondly), /同时排出3枚伴生卵/);
  const second = after.children.find((child) => child.fathers === '乙') || after.pregnant.fetuses.find((fetus) => fetus.fathers === '乙');
  assert.equal(second.birthCompanionEggCount ?? second.companionEggCount, 7, '另一胎的伴生卵不被挪用');
});

function inject(args) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 0, isHere: true, age: 24, race: '触手怪', vitality: 100, libido: 20, uterinePressure: 10,
        psyStress: 30, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { gestationSpeciesSpeed: 1, gestationEffectiveSpeed: 1, birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { pregnantDays: 0, effectivePregnantDays: 0, fetuses: [], fetusesCount: 0 },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  const result = applyToolCall(chatState, {
    name: 'bsDebugInjectPregnancy',
    arguments: { female: 'A', father: '父', race: '触手怪', fetusCount: 1, genders: '无', equivalentDays: 20, ...args },
  });
  assert.equal(result.applied, true, result.message);
  return chatState.characters.A.profile.pregnant.fetuses;
}

test('同卵分裂不重新抽签：原卡的伴生卵以整数平分给整组，总和不变', () => {
  Math.random = () => 0.5;
  const fetuses = inject({ forceIdentical: true });
  assert.equal(fetuses.length, 2);
  const counts = fetuses.map((fetus) => fetus.companionEggCount);
  assert.equal(counts[0] + counts[1], rollCompanionEggCount('触手怪', () => 0.5, 20), '总和等于分裂前那一次抽签');
  assert.ok(Math.abs(counts[0] - counts[1]) <= 1, '整数平分');
});

test('嵌合不重新抽签：新胎承接两边伴生卵的总和', () => {
  Math.random = () => 0.5;
  const fetuses = inject({ fetusCount: 2, father: '甲,乙', race: '触手怪,触手怪', genders: '无,无', forceChimera: true });
  assert.equal(fetuses.length, 1);
  assert.equal(fetuses[0].companionEggCount, rollCompanionEggCount('触手怪', () => 0.5, 20) * 2);
});

test('提示词明确区分伴生卵、胎儿卡与祖谱人数', () => {
  const prompt = buildRacePhysiologyPrompt({
    existing_state: { A: { profile: { base: { race: '触手怪' }, pregnant: { fetuses: [] } } } },
  });
  assert.match(prompt, /\[伴生卵定义\]/);
  assert.match(prompt, /只建立那一名有效后代/);
  assert.match(prompt, /典型伴生卵数量: 3/);
  assert.match(TRACKER_VARIABLE_GUIDE_PROMPT, /fetuses\[\*\]\.companionEggCount/);
  assert.match(TRACKER_VARIABLE_GUIDE_PROMPT, /children\[\*\]\.birthCompanionEggCount/);
  assert.doesNotMatch(TRACKER_VARIABLE_GUIDE_PROMPT, /clutchSize/);
});
