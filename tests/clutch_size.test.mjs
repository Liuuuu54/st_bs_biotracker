import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  getClutchSizeMeanByRace,
  getEmbryoTypeByRace,
  getRacePhysiologyProfile,
  rollClutchSizeForRace,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';
import { TRACKER_VARIABLE_GUIDE_PROMPT } from '../scripts/tracker_prompt_context.js';

afterEach(() => setRacePhysiologyOverrides({}));

test('只有明确列出的种族具有多卵群均值，单卵种族保持 1', () => {
  const expected = {
    触手怪: 10, 宝箱怪: 8, 海妖: 16, 狗头人: 2,
    蛇人: 1, 人鱼: 1, 深潜者: 1, 史萊姆: 4,
  };
  for (const [race, mean] of Object.entries(expected)) {
    assert.equal(getRacePhysiologyProfile(race).clutchSizeMean, mean, race);
  }
  assert.equal(getClutchSizeMeanByRace('妖精'), 1);
  assert.equal(getClutchSizeMeanByRace('鸟人'), 1);
});

test('混血先由最长孕期决定胚型，再决定是否计算几何平均', () => {
  // 人类孕期长于怪鸟类，所以此混血先落到胎生，卵群必须硬固定为 1。
  assert.equal(getEmbryoTypeByRace('怪鸟类x人类'), '胎生');
  assert.equal(getClutchSizeMeanByRace('怪鸟类x人类'), 1);

  // 两者均为卵生，所有成分（包括均值）参与几何平均。
  assert.equal(getEmbryoTypeByRace('怪鸟类x蜥蜴人'), '卵生');
  assert.ok(Math.abs(getClutchSizeMeanByRace('怪鸟类x蜥蜴人') - Math.sqrt(4 * 12)) < 0.000001);
});

test('百科覆写会改变卵群计算，均值 1 永远不会被随机成 2', () => {
  setRacePhysiologyOverrides({ 怪鸟类: { clutchSizeMean: 8 } });
  assert.equal(getClutchSizeMeanByRace('怪鸟类'), 8);
  assert.equal(rollClutchSizeForRace('怪鸟类', () => 0), 6);
  assert.equal(rollClutchSizeForRace('怪鸟类', () => 1), 10);
  assert.equal(rollClutchSizeForRace('妖精', () => 1), 1);
});

test('高产卵群分娩仍只建立一名族谱后代', () => {
  const chatState = {
    characters: {
      孕母: {
        name: '孕母', initialized: true,
        profile: {
          base: { stage: '临产期', days: 1, race: '触手怪', vitality: 100, vitalityLevel: 4, psyStressLevel: 4 },
          bio: {}, immune: {}, experience: {}, metabolism: {}, cooldown: {},
          pregnant: {
            fetuses: [{ fathers: '异形', race: '触手怪', gender: '无性', embryoType: '不定型', clutchSize: 10, weight: 1 }],
            fetusesCount: 1, pregnantDays: 56,
          },
        },
      },
    },
  };
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '孕母' } });
  assert.equal(result.applied, true);
  const profile = chatState.characters['孕母'].profile;
  assert.equal(profile.children.length, 1, '不得按十枚卵建立十名孩子');
  assert.equal(profile.children[0].birthClutchSize, 10);
  assert.match(profile.notify.secondly, /10枚卵.*1名有效后代/);
});

test('提示词明确区分卵群、胎儿卡与祖谱人数', () => {
  const prompt = buildRacePhysiologyPrompt({
    existing_state: { A: { profile: { base: { race: '触手怪' }, pregnant: { fetuses: [] } } } },
  });
  assert.match(prompt, /\[卵群资料定义\]/);
  assert.match(prompt, /不是 fetusesCount/);
  assert.match(prompt, /只建立一名有效后代/);
  assert.match(TRACKER_VARIABLE_GUIDE_PROMPT, /fetuses\[\*\]\.clutchSize/);
  assert.match(TRACKER_VARIABLE_GUIDE_PROMPT, /children\[\*\]\.birthClutchSize/);
});
