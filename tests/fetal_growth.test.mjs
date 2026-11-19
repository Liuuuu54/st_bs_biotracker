// 1.4.1 胎儿生长型：各型足月为 1、只增不减，快慢段落在对的孕期；负担跟成长速度走；混血取最大族、平手随母。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FETAL_GROWTH_SHAPES,
  getDefaultFetalGrowthShape,
  getFetalGrowth,
  getFetalGrowthRate,
  getFetalLoadFactor,
} from '../scripts/fetal_growth.js';
import {
  ALL_BUILTIN_RACES,
  getFetalGrowthShapeByRace,
  getRacePhysiologyProfile,
  sanitizeRacePhysiologyProfilePatch,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { calculatePregnantBellySize, getFetalBulk } from '../scripts/tools.js';

const near = (actual, expected, eps = 1e-6, message = '') => assert.ok(Math.abs(actual - expected) < eps, `${message} ${actual} ≠ ${expected}`);

test('每一型足月都是 1、零天是 0，份量只增不减', () => {
  for (const shape of FETAL_GROWTH_SHAPES) {
    near(getFetalGrowth(0, shape), 0, 1e-9, shape);
    near(getFetalGrowth(280, shape), 1, 1e-9, shape);
    let previous = -1;
    for (let day = 0; day <= 420; day += 0.5) {
      const value = getFetalGrowth(day, shape);
      assert.ok(value >= previous - 1e-12, `${shape} 在第 ${day} 天倒退`);
      previous = value;
    }
  }
});

test('成长速度在孕期内积分为 1，所以负担（0.5 × 速度）的总量与旧的直线相同', () => {
  for (const shape of FETAL_GROWTH_SHAPES) {
    let area = 0;
    for (let day = 0.25; day < 280; day += 0.5) area += getFetalLoadFactor(day, shape) * 0.5 / 280;
    near(area, 0.5, 0.005, shape);
  }
});

test('各型的快慢段落在对的孕期', () => {
  const at = (week, shape) => getFetalGrowth(week * 7, shape);
  const rate = (week, shape) => getFetalGrowthRate(week * 7, shape);
  // 人类型：孕早几乎不长，孕晚暴涨
  assert.ok(at(14, 'human') < 0.1);
  assert.ok(rate(37, 'human') > rate(20, 'human') && rate(20, 'human') > rate(10, 'human'));
  // 早熟型：一开始就快，越长越慢
  assert.ok(at(14, 'early') > 0.5 && rate(5, 'early') > rate(35, 'early'));
  // 均匀型：孕期内等速
  near(at(20, 'even'), 0.5, 1e-9);
  // 晚成型比人类更晚
  assert.ok(at(28, 'late') < at(28, 'human') && rate(39, 'late') > rate(39, 'human'));
  // 中段型：中段最快，两端慢
  assert.ok(rate(20, 'peak') > rate(5, 'peak') && rate(20, 'peak') > rate(38, 'peak'));
  // 两段型：孕早、孕晚长，孕中停滞
  assert.ok(rate(5, 'valley') > rate(20, 'valley') && rate(38, 'valley') > rate(20, 'valley'));
});

test('逾期照缓升继续长，速度从足月的斜率平滑降下来', () => {
  for (const shape of FETAL_GROWTH_SHAPES) {
    const term = getFetalGrowthRate(280, shape);
    near(getFetalGrowthRate(280.0001, shape), term, 1e-3, `${shape} 足月前后连续`);
    const later = getFetalGrowthRate(280 + 140, shape);
    assert.ok(later < term && later > term * 0.25 - 1e-9, shape);
  }
  // 早熟、中段几乎不长；晚成长最多
  assert.ok(getFetalGrowth(364, 'early') < 1.1 && getFetalGrowth(364, 'peak') < 1.1);
  assert.ok(getFetalGrowth(364, 'late') > getFetalGrowth(364, 'human'));
});

test('胚型预设与内置例外', () => {
  assert.deepEqual(['胎生', '卵生', '卵胎生', '胎转卵生', '不定型'].map(getDefaultFetalGrowthShape), ['human', 'early', 'even', 'valley', 'even']);
  assert.equal(getFetalGrowthShapeByRace('人类'), 'human');
  assert.equal(getFetalGrowthShapeByRace('鸟族'), 'early');
  assert.equal(getFetalGrowthShapeByRace('华根蕴桃'), 'valley', '桃子是双 S 生长');
  assert.equal(getFetalGrowthShapeByRace('熊人族'), 'late', '熊延迟着床');
  assert.equal(getFetalGrowthShapeByRace('天使'), 'human', '胎转卵生的人形上位种族');
  for (const race of ALL_BUILTIN_RACES) assert.ok(FETAL_GROWTH_SHAPES.includes(getFetalGrowthShapeByRace(race)), race);
});

test('混血取占比最大那一族的型，平手随母', () => {
  assert.equal(getFetalGrowthShapeByRace('鸟族x人类', { 鸟族: 0.75, 人类: 0.25 }), 'early', '占比大者');
  assert.equal(getFetalGrowthShapeByRace('鸟族x人类', { 鸟族: 0.25, 人类: 0.75 }), 'human');
  // 平手：取母体血统里有的那一族
  assert.equal(getFetalGrowthShapeByRace('鸟族x人类', { 鸟族: 0.5, 人类: 0.5 }, '鸟族'), 'early');
  assert.equal(getFetalGrowthShapeByRace('鸟族x人类', { 鸟族: 0.5, 人类: 0.5 }, '人类'), 'human');
  // 平手而且都不是母体的族：用母体自己的型
  assert.equal(getFetalGrowthShapeByRace('鸟族x人鱼', { 鸟族: 0.5, 人鱼: 0.5 }, '西方龙'), 'valley');
});

test('百科可以改生长型，非法值丢弃', () => {
  assert.deepEqual(sanitizeRacePhysiologyProfilePatch({ fetalGrowthShape: 'peak' }), { fetalGrowthShape: 'peak' });
  assert.equal(sanitizeRacePhysiologyProfilePatch({ fetalGrowthShape: 'zigzag' }), null);
  try {
    setRacePhysiologyOverrides({ 人类: { fetalGrowthShape: 'late' } });
    assert.equal(getFetalGrowthShapeByRace('人类'), 'late');
    assert.equal(getRacePhysiologyProfile('人类').fetalGrowthShape, 'late');
  } finally {
    setRacePhysiologyOverrides({});
  }
});

test('孕肚：足月锚点不变，过程照生长型；同孕周早熟型的蛋比人类胎大', () => {
  const belly = (race, days) => calculatePregnantBellySize({ pregnant: { effectivePregnantDays: days, fetuses: [{ race, weight: 1 }] } });
  near(belly('人类', 280), 7, 1e-9);
  assert.ok(belly('鸟族', 140) > belly('人类', 140));
  assert.ok(belly('熊人族', 140) < belly('人类', 140));
  // 熊人族幼崽小（份量 0.4），足月单胎约 6.1；卡玛佐兹幼仔大（1.4），约 7.6
  near(belly('熊人族', 280), 6.1, 1e-9);
  near(belly('卡玛佐兹', 280), 7.6, 1e-9);
  near(getFetalBulk({ pregnant: { effectivePregnantDays: 140, fetuses: [{ weight: 1 }] } }), getFetalGrowth(140, 'human'), 1e-12);
});

test('种族提示词：生长型的说明只出一次，各种族块只写型名；百科单页才写全', async () => {
  const { buildRacePhysiologyPrompt, buildSingleRacePhysiologyText } = await import('../scripts/prompts/rules.js');
  const character = (race, fetusRace) => ({ profile: { base: { race, sperms: [] }, pregnant: { fetuses: fetusRace ? [{ race: fetusRace, fatherRace: fetusRace }] : [] }, children: [] } });
  const prompt = buildRacePhysiologyPrompt({ existing_state: { A: character('人类', '熊人族'), B: character('精灵'), C: character('鸟族') } });
  assert.equal(prompt.split('[胎儿生长型定义]').length - 1, 1);
  for (const label of ['人类型：', '晚成型：', '早熟型：']) assert.equal(prompt.split(label).length - 1, 1, label);
  assert.ok(!prompt.includes('均匀型：'), '没用到的型不送');
  assert.match(prompt, /- 胎儿生长型: 人类型\n/);
  assert.match(buildSingleRacePhysiologyText('鸟族'), /胎儿生长型: 早熟型，一开始就长得快/);
});

test('胎动感知看胎量：人类型约孕 18–19 周，经产妇早一点；早熟型的蛋更早，份量小的熊人族更晚', async () => {
  const { canFeelFetalMovement, getFetusBulk } = await import('../scripts/tools.js');
  const mother = (days, race = '人类', extra = {}) => ({
    base: { stage: days < 98 ? '孕早期' : days < 196 ? '孕中期' : '孕晚期', race: '人类' },
    experience: extra.experience || {},
    pregnant: { effectivePregnantDays: days, fetuses: [{ embryoId: 1, race, weight: 1 }] },
  });
  assert.equal(canFeelFetalMovement(mother(7 * 17)), false);
  assert.equal(canFeelFetalMovement(mother(7 * 19)), true);
  assert.equal(canFeelFetalMovement(mother(7 * 17, '人类', { experience: { naturalBirthExperience: 1 } })), true, '经产妇早一点');
  assert.equal(canFeelFetalMovement(mother(7 * 10, '鸟族')), true, '早熟型 10 周就够大');
  assert.equal(canFeelFetalMovement(mother(7 * 24, '熊人族')), false, '幼崽极小、晚成型');
  const profile = mother(140);
  assert.ok(Math.abs(getFetusBulk(profile, profile.pregnant.fetuses[0]) - 0.2) < 1e-9, '胎量 ＝ 份量 × 胎重 × 份量倍率');
});
