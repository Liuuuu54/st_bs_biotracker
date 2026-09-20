import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateDerivedInheritanceProgress,
  DERIVED_INHERITANCE_THRESHOLD,
} from '../scripts/tools.js';
import {
  DERIVED_TYPE_RACES,
  getDerivedTypeInheritanceProfile,
} from '../scripts/race_config.js';

test('all twelve derived types use distinct inheritance speeds', () => {
  const expected = {
    神祇: 0.25,
    机械: 0.5,
    器灵: 0.65,
    修炼: 0.8,
    魔导: 1.0,
    序列: 1.1,
    妖怪: 1.25,
    兽化: 1.4,
    变异: 1.55,
    星际: 1.7,
    血族: 1.9,
    不死: 2.5,
  };
  assert.equal(DERIVED_TYPE_RACES.length, 12);
  assert.deepEqual(
    Object.fromEntries(DERIVED_TYPE_RACES.map((name) => [name, getDerivedTypeInheritanceProfile(name).inheritanceSpeed])),
    Object.fromEntries(DERIVED_TYPE_RACES.map((name) => [name, expected[name]])),
  );
  assert.equal(new Set(Object.values(expected)).size, 12);
});

test('neutral human inheritance reaches but does not cross the threshold at 140 days', () => {
  const baseline = {
    currentProgress: 0,
    affinity: 0,
    motherDerivedType: '魔导',
    fetusRace: '人类',
  };
  assert.equal(calculateDerivedInheritanceProgress({ ...baseline, passedDays: 140 }), DERIVED_INHERITANCE_THRESHOLD);
  assert.ok(calculateDerivedInheritanceProgress({ ...baseline, passedDays: 141 }) > DERIVED_INHERITANCE_THRESHOLD);
});

test('single paternal inheritance starts from zero in the paternal direction', () => {
  const progress = calculateDerivedInheritanceProgress({
    currentProgress: 0,
    affinity: 0,
    fatherDerivedType: '魔导',
    fetusRace: '人类',
    passedDays: 14,
  });
  assert.ok(progress < 0);
  assert.equal(progress, -7.5);
});

test('species gestation speed and temporary modifier scale inheritance time', () => {
  const common = {
    currentProgress: 0,
    affinity: 0,
    motherDerivedType: '魔导',
    passedDays: 140,
  };
  const human = calculateDerivedInheritanceProgress({ ...common, fetusRace: '人类' });
  const elf = calculateDerivedInheritanceProgress({ ...common, fetusRace: '精灵' });
  const acceleratedElf = calculateDerivedInheritanceProgress({
    ...common,
    fetusRace: '精灵',
    gestationModifierMultiplier: 2,
  });
  const frozen = calculateDerivedInheritanceProgress({
    ...common,
    fetusRace: '人类',
    gestationModifierMultiplier: 0,
  });

  assert.equal(human, 75);
  assert.equal(elf, 37.5, '精灵孕期为人类两倍，同样实际天数只传一半');
  assert.equal(acceleratedElf, human, '两倍妊娠倍率抵消两倍物种孕期');
  assert.equal(frozen, 0);
});
