// 胎重天生的变异：对数常态分布，标准差 0.13（人类新生儿体重的实际变异），所有种族共用，截在 ±3 个标准差。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { calculateOffspringPreview } from '../scripts/calculator.js';
import { CONCEPTION_STAGE_WEIGHTS, CONCEPTION_WEIGHT_LOG_SD } from '../scripts/body_size.js';
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

test('受孕胎重的波动接近人类新生儿：对数标准差约 0.13，重 20% 以上约 8%', () => {
  Math.random = seeded(20261020);
  const logs = Array.from({ length: 6000 }, () => Math.log(getConceptionWeight('排卵期', '无', 1)));
  const mean = logs.reduce((sum, x) => sum + x, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / logs.length);
  assert.equal(CONCEPTION_WEIGHT_LOG_SD, 0.13);
  assert.ok(Math.abs(mean) < 0.01, `平均 ${mean}`);
  assert.ok(Math.abs(sd - 0.13) < 0.008, `标准差 ${sd}`);
  const heavy = logs.filter((x) => x >= Math.log(1.2)).length / logs.length;
  assert.ok(heavy > 0.06 && heavy < 0.10, `重 20% 以上占 ${heavy}`);
});

test('截在 ±3 个标准差，不会抽出极端值；体型系数照常乘上去', () => {
  Math.random = () => 0;
  assert.ok(Math.abs(getConceptionWeight('排卵期', '无', 1) - Math.exp(0.13 * 3)) < 1e-9);
  assert.ok(Math.abs(getConceptionWeight('排卵期', '无', 1.22) - Math.exp(0.13 * 3) * 1.22) < 1e-9);
});

test('计算器的初始胎重范围是约 95% 会落在的 ±2 个标准差', () => {
  const human = calculateOffspringPreview({ eggRace: '人类', spermRace: '人类', conceptionStage: '排卵期' });
  const { min, max, typical } = human.fetalWeightRange;
  assert.ok(Math.abs(Math.log(max / typical) - (2 * 0.13 + Math.log(1.05))) < 1e-6, `max ${max}`);
  assert.ok(Math.abs(Math.log(typical / min) - (2 * 0.13 + Math.log(1.05))) < 1e-6, `min ${min}`);
});

test('受精阶段系数以排卵期为基准 1.0：自然受孕几乎都在排卵期，正常妊娠的胎重平均回到 1.0；产后恢复不会受孕，不列', () => {
  assert.deepEqual({ ...CONCEPTION_STAGE_WEIGHTS }, { 月经期: 0.75, 卵泡期: 0.9, 排卵期: 1.0, 黄体期: 1.1 });
  Math.random = seeded(7);
  const logs = Array.from({ length: 4000 }, () => Math.log(getConceptionWeight('排卵期', '无', 1)));
  const mean = Math.exp(logs.reduce((sum, x) => sum + x, 0) / logs.length);
  assert.ok(Math.abs(mean - 1) < 0.01, `排卵期受孕的几何平均 ${mean}`);
  Math.random = () => 0.5;
  assert.ok(Math.abs(getConceptionWeight('产后恢复', '无', 1) / getConceptionWeight('排卵期', '无', 1) - 1) < 1e-9, '表外阶段按 1.0');
  const preview = calculateOffspringPreview({ eggRace: '人类', spermRace: '人类', conceptionStage: '黄体期' });
  assert.ok(Math.abs(preview.fetalWeightRange.typical - 1.1) < 1e-9, '计算机与引擎共用同一张表');
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
  assert.ok(Math.abs(slime.fetalWeightRange.typical - expected) < 1e-9, '排卵期基准 1.0，中心值就是系数');
});
