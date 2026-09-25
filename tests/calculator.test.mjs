import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateDerivedInheritancePreview,
  calculateFertilizationPreview,
  calculateImplantationPreview,
  calculateOffspringPreview,
  calculateRaceImplantationDays,
  calculateSpermExposure,
  getDerivedInheritanceSeed,
} from '../scripts/calculator.js';

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
  assert.equal(result.sources[0].chance, 0.5);
  assert.ok(Math.abs(result.sources[0].winChance - 0.375) < 1e-12);
  assert.ok(Math.abs(result.sources[1].winChance - 0.375) < 1e-12);
  assert.ok(Math.abs(result.successChance - 0.75) < 1e-12);
});

test('fertilization calculator allows sufficiently favorable conditions to reach certainty', () => {
  const result = calculateFertilizationPreview({
    eggRace: '人类',
    elapsedDays: 1,
    spermSources: [{ race: '人类', value: 20 }],
  });
  assert.equal(result.sources[0].chance, 1);
  assert.equal(result.successChance, 1);
  assert.equal(result.failureChance, 0);
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
  assert.ok(Math.abs(trace.successChance - 0.3) < 1e-12);
});

test('cross-race difficulty uses a moderate geometric penalty instead of adding both difficulties', () => {
  const result = calculateFertilizationPreview({
    eggRace: '人类',
    elapsedDays: 0.1,
    spermSources: [{ race: '石像鬼', value: 20 }],
  });
  const source = result.sources[0];
  const formerAdditiveDifficulty = (result.femaleDifficulty + source.maleDifficulty) * 1.5 / result.spermDoseBonus;
  assert.equal(source.sameRace, false);
  assert.equal(source.embryoTypeMismatch, true);
  assert.ok(source.effectiveDifficulty < formerAdditiveDifficulty);
  assert.ok(result.successChance > 0.1, '异种受精不应被双重难度压到极低');
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
  assert.equal(hybrid.identicalProbability, 3.5);
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
