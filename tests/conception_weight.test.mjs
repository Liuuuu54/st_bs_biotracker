// 1.3.0 起受孕时机与天生变异（对数常态、标准差 0.13，截在 ±3 个标准差）从初始胎重移到胎儿健康的上限，
// 初始胎重只剩性别与体型系数；大小差异在孕期随健康长出来。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { calculateOffspringPreview } from '../scripts/calculator.js';
import { CONCEPTION_STAGE_WEIGHTS, CONCEPTION_WEIGHT_LOG_SD } from '../scripts/body_size.js';
import { getConceptionTimingFactor, sampleFetalInitialHealth } from '../scripts/fetal_health.js';
import { getConceptionWeight } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('初始胎重只看性别与体型：没有阶段系数，也不再抽天生变异', () => {
  assert.equal(getConceptionWeight('无', 1), 1);
  assert.ok(Math.abs(getConceptionWeight('男', 1) - 1.05) < 1e-9);
  assert.ok(Math.abs(getConceptionWeight('女', 1.22) - 1.22 / 1.05) < 1e-9);
});

test('初始健康的天生变异接近人类新生儿：对数标准差约 0.13，夹在 35～70', () => {
  const random = seeded(20261020);
  const logs = Array.from({ length: 6000 }, () => Math.log(sampleFetalInitialHealth({ stage: '排卵期', random }) / 50));
  const mean = logs.reduce((sum, x) => sum + x, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / logs.length);
  assert.equal(CONCEPTION_WEIGHT_LOG_SD, 0.13);
  assert.ok(Math.abs(mean) < 0.01, `平均 ${mean}`);
  assert.ok(Math.abs(sd - 0.13) < 0.008, `标准差 ${sd}`);
  assert.equal(sampleFetalInitialHealth({ stage: '排卵期', random: () => 0 }), 70, '+3 个标准差夹到 70');
  assert.equal(sampleFetalInitialHealth({ quality: 4, stage: '黄体期', random: () => 0 }), 70, '高品质也只到 70，一律从平稳起步');
  assert.equal(sampleFetalInitialHealth({ quality: 0.25, stage: '乏情期', random: () => 0.5 }), 35, '低品质夹到 35');
});

test('受孕时机系数 = 0.5 ＋ 0.5 × 旧阶段系数；精子品质乘 品质^0.25', () => {
  assert.deepEqual({ ...CONCEPTION_STAGE_WEIGHTS }, { 乏情期: 0.6, 月经期: 0.75, 卵泡期: 0.9, 排卵期: 1.0, 黄体期: 1.1 });
  assert.deepEqual(['乏情期', '月经期', '卵泡期', '排卵期', '黄体期', '产后恢复'].map(getConceptionTimingFactor), [0.8, 0.875, 0.95, 1, 1.05, 1]);
  const at = (quality, stage) => sampleFetalInitialHealth({ quality, stage, random: () => 0.5 });
  assert.ok(Math.abs(at(2, '排卵期') / at(1, '排卵期') - 2 ** 0.25) < 0.01);
  assert.ok(Math.abs(at(2, '乏情期') / at(2, '排卵期') - 0.8) < 0.01);
});

test('计算器：初始胎重只看性别与体型；另列初始健康的范围与受孕时机系数', () => {
  const human = calculateOffspringPreview({ eggRace: '人类', spermRace: '人类', conceptionStage: '黄体期' });
  const { min, max, typical } = human.fetalWeightRange;
  assert.equal(typical, 1);
  assert.ok(Math.abs(max - 1.05) < 1e-9 && Math.abs(min - 1 / 1.05) < 1e-9);
  assert.equal(human.healthTimingFactor, 1.05);
  assert.ok(Math.abs(human.healthInitialRange.typical - 52.5) < 1e-9);
  assert.ok(Math.abs(Math.log(human.healthInitialRange.max / human.healthInitialRange.typical) - 0.26) < 1e-9);
  assert.equal(calculateOffspringPreview({ eggRace: '人类', spermRace: '人类', conceptionStage: '乏情期' }).healthInitialRange.min, 35, '夹到 35');
});

test('计算机的胎重系数与引擎同一套：双方都有体型看体型差，有一方体型可变就退回承载耐受', async () => {
  const { resolveConceptionWeightRatio } = await import('../scripts/body_size.js');
  const { getMergedRaceBodySize, getMergedRacePhysiologyProfile } = await import('../scripts/race_config.js');
  const giant = getMergedRaceBodySize('巨人').bodySize;
  const human = getMergedRaceBodySize('人类').bodySize;
  const bySize = calculateOffspringPreview({ eggRace: '人类', spermRace: '巨人', conceptionStage: '排卵期' });
  assert.equal(bySize.weightRatioBasis, 'bodySize');
  assert.ok(Math.abs(bySize.breedWeightRatio - 2 ** ((giant - human) * 0.25)) < 1e-9);
  assert.equal(bySize.breedWeightRatio, resolveConceptionWeightRatio({ race: '人类' }, { race: '巨人' }).ratio);

  const slime = calculateOffspringPreview({ eggRace: '人类', spermRace: '史萊姆', conceptionStage: '排卵期' });
  assert.equal(slime.weightRatioBasis, 'breedTolerance', '史莱姆体型可变，算不出体型差');
  const m = getMergedRacePhysiologyProfile('人类').breedTolerance;
  const f = getMergedRacePhysiologyProfile('史萊姆').breedTolerance;
  const expected = Math.max(0.5, Math.min(2, 2 ** ((f - m) / (f + m))));
  assert.ok(Math.abs(slime.breedWeightRatio - expected) < 1e-9);
  assert.ok(Math.abs(slime.fetalWeightRange.typical - expected) < 1e-9, '中心值就是体型系数');
});
