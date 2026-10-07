import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateDerivedInheritancePreview,
  calculateFertilizationPreview,
  calculateImplantationPreview,
  calculateOffspringPreview,
  calculateRaceImplantationDays,
  calculateSpermExposure,
  FERTILIZATION_RATE,
  getDerivedInheritanceSeed,
} from '../scripts/calculator.js';
import { getSpermDoseDifficultyBonus } from '../scripts/race_config.js';

test('fertilization calculator removes source-order bias while preserving source shares', () => {
  const result = calculateFertilizationPreview({
    eggRace: '人类',
    elapsedDays: 1,
    spermSources: [
      { race: '人类', value: 20 },
      { race: '人类', value: 20 },
    ],
  });
  assert.equal(result.totalSperm, 40);
  assert.equal(result.sources.length, 2);
  const [first, second] = result.sources;
  assert.equal(first.chance, second.chance, '同量同族的两个精源机率相同');
  assert.ok(Math.abs(result.successChance - (1 - (1 - first.chance) ** 2)) < 1e-12);
  assert.ok(Math.abs(first.winChance - result.successChance / 2) < 1e-12);
  assert.ok(Math.abs(second.winChance - result.successChance / 2) < 1e-12);
});
test('fertilization chance saturates toward certainty without capping at it', () => {
  const day = calculateFertilizationPreview({ eggRace: '人类', elapsedDays: 1, spermSources: [{ race: '人类', value: 20 }] });
  assert.ok(day.successChance > 0.2 && day.successChance < 0.4, '人类同房后一天的单卵受精率应在合理区间');
  const easy = calculateFertilizationPreview({ eggRace: '星繭族', elapsedDays: 1, spermSources: [{ race: '星繭族', value: 40 }] });
  assert.ok(easy.successChance > day.successChance, '易孕物种更高');
  assert.ok(easy.successChance < 1, '再有利也不会封顶到必中');
  const longer = calculateFertilizationPreview({ eggRace: '人类', elapsedDays: 2, spermSources: [{ race: '人类', value: 20 }] });
  assert.ok(longer.successChance > day.successChance, '暴露越久越高');
});
test('fertilization uses only the time before residual sperm naturally reaches zero', () => {
  assert.deepEqual(calculateSpermExposure(1, 1), {
    startingValue: 1,
    endingValue: 0,
    exposureDays: 0.1,
    exposureAmountDays: 0.05,
  });
  const trace = calculateFertilizationPreview({
    eggRace: '人类',
    elapsedDays: 1,
    spermSources: [{ race: '人类', value: 1 }],
  });
  assert.equal(trace.effectiveExposureDays, 0.1);
  assert.equal(trace.effectiveTotalSperm, 0.5);
  const expected = 1 - Math.exp(-FERTILIZATION_RATE * 0.1 / (1 / getSpermDoseDifficultyBonus(0.5)));
  assert.ok(Math.abs(trace.successChance - expected) < 1e-12, '只按残留实际存在的 0.1 天计算');
});
test('cross-race difficulty uses a moderate geometric penalty instead of adding both difficulties', () => {
  const result = calculateFertilizationPreview({
    eggRace: '人类',
    elapsedDays: 1,
    spermSources: [{ race: '石像鬼', value: 20 }],
  });
  const source = result.sources[0];
  const formerAdditiveDifficulty = (result.femaleDifficulty + source.maleDifficulty) * 1.5 / result.spermDoseBonus;
  assert.equal(source.sameRace, false);
  assert.equal(source.embryoTypeMismatch, true);
  assert.ok(source.effectiveDifficulty < formerAdditiveDifficulty);
  const additiveChance = 1 - Math.exp(-FERTILIZATION_RATE * result.effectiveExposureDays / formerAdditiveDifficulty);
  assert.ok(result.successChance > additiveChance, '异种受精不应被双重难度压得更低');
  const sameRace = calculateFertilizationPreview({ eggRace: '人类', elapsedDays: 1, spermSources: [{ race: '人类', value: 20 }] });
  assert.ok(result.successChance < sameRace.successChance, '异种仍比同族难');
});
test('fertilization calculator uses race difficulty when override is blank', () => {
  const automatic = calculateFertilizationPreview({
    eggRace: '精灵',
    impregnationDifficulty: null,
    elapsedDays: 0.01,
    spermSources: [{ race: '精灵', value: 20 }],
  });
  const explicit = calculateFertilizationPreview({
    eggRace: '精灵',
    impregnationDifficulty: automatic.femaleDifficulty,
    elapsedDays: 0.01,
    spermSources: [{ race: '精灵', value: 20 }],
  });
  assert.equal(automatic.sources[0].chance, explicit.sources[0].chance);
});

test('implantation calculator reports deadline and vitality chance', () => {
  const result = calculateImplantationPreview({ cycleLength: 35, vitality: 60, elapsedDays: 7 });
  assert.equal(result.requiredDays, 7.5);
  assert.equal(result.remainingDays, 0.5);
  assert.equal(result.ready, false);
  assert.equal(result.successChance, 0.6);
  assert.equal(calculateRaceImplantationDays('人类'), 6);
});

test('offspring calculator keeps companion-free species at 0 and previews prolific pure species', () => {
  const human = calculateOffspringPreview({ eggRace: '人类', spermRace: '人类', spermValue: 999 });
  assert.deepEqual(human.companionRange, { min: 0, typical: 0, max: 0 });

  const fish = calculateOffspringPreview({ eggRace: '怪鱼类', spermRace: '怪鱼类', spermValue: 20 });
  assert.equal(fish.fetusRace, '怪鱼类');
  assert.equal(fish.companionEggsMean, 32);
  assert.deepEqual(fish.companionRange, { min: 29, typical: 32, max: 35 });

  const dog = calculateOffspringPreview({ eggRace: '狗头人', spermRace: '狗头人', spermValue: 20 });
  assert.deepEqual(dog.companionRange, { min: 1, typical: 1, max: 1 }, 'range mirrors rounding of [0.9, 1.1)');
  assert.equal(calculateOffspringPreview({ eggRace: '史萊姆', spermRace: '史萊姆' }).genderRatio, null);

  const hybrid = calculateOffspringPreview({
    eggRace: '人类',
    spermRace: '精灵',
    conceptionStage: '排卵期',
  });
  assert.equal(hybrid.implantationDays, 6);
  assert.equal(hybrid.identicalProbability, 1.5, '人类 1% 与精灵 2% 的平均');
  assert.ok(hybrid.fetalWeightRange.min < hybrid.fetalWeightRange.typical);
  assert.ok(hybrid.fetalWeightRange.max > hybrid.fetalWeightRange.typical);
});

test('derived calculator exposes conception seed and strict threshold day', () => {
  assert.deepEqual(getDerivedInheritanceSeed('魔导', '魔导'), { affinity: 30, progress: 30 });
  const result = calculateDerivedInheritancePreview({
    currentProgress: 0,
    affinity: 0,
    motherDerivedType: '魔导',
    fetusRace: '人类',
    passedDays: 140,
  });
  assert.equal(result.nextProgress, 75);
  assert.equal(result.wholeDaysToInherit, 141);
  assert.equal(result.inheritedType, null);
});
