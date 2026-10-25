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

test('all thirteen derived types use distinct inheritance speeds', () => {
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
    咒缚: 3,
  };
  assert.equal(DERIVED_TYPE_RACES.length, 13);
  assert.deepEqual(
    Object.fromEntries(DERIVED_TYPE_RACES.map((name) => [name, getDerivedTypeInheritanceProfile(name).inheritanceSpeed])),
    Object.fromEntries(DERIVED_TYPE_RACES.map((name) => [name, expected[name]])),
  );
  assert.equal(new Set(Object.values(expected)).size, 13);
});

// 净拉力 1 时 140 天走到判定线：只有母方有衍生时另有无竞争底力 0.5，亲密度 −15（拉力 0.5）加上底力刚好是 1
test('net pull 1 reaches but does not cross the threshold at 140 days', () => {
  const baseline = {
    currentProgress: 0,
    affinity: -15,
    motherDerivedType: '魔导',
    fetusRace: '人类',
  };
  assert.equal(calculateDerivedInheritanceProgress({ ...baseline, passedDays: 140 }), DERIVED_INHERITANCE_THRESHOLD);
  assert.ok(calculateDerivedInheritanceProgress({ ...baseline, passedDays: 141 }) > DERIVED_INHERITANCE_THRESHOLD);
});

// 1.2.0 起孕期拉锯：母胎亲密度往母方拉（M = 1 + 亲密度/30），与胎父的契合度往父方拉（P = 2 × 契合度）
test('only the father has a derived type: the side with the stronger pull wins', () => {
  const common = { currentProgress: 0, affinity: 0, fatherDerivedType: '魔导', fetusRace: '人类', passedDays: 14 };
  // 母无父有：父方另有无竞争底力 0.5
  assert.equal(calculateDerivedInheritanceProgress({ ...common, paternalFit: 0 }), 3.75, '没有契合时母方 1 对父方底力 0.5，偏向不遗传');
  assert.equal(calculateDerivedInheritanceProgress({ ...common, paternalFit: 0.25 }), 0, '契合 25% 时两边拉平');
  assert.equal(calculateDerivedInheritanceProgress({ ...common, paternalFit: 0.75 }), -7.5, '契合 75% 时父方胜出');
  assert.ok(calculateDerivedInheritanceProgress({ ...common, fatherDerivedType: '血族', paternalFit: 0.12 }) < 0, '强势衍生（×1.9）的底力就拉得过中立的母亲');
});

test('different derived types get no uncontested pull', async () => {
  const { calculateDerivedInheritancePreview } = await import('../scripts/calculator.js');
  assert.equal(calculateDerivedInheritancePreview({ motherDerivedType: '魔导', fatherDerivedType: '修炼', affinity: 0, paternalFit: 0 }).uncontestedPull, 0);
  assert.equal(calculateDerivedInheritancePreview({ motherDerivedType: '魔导', affinity: 0 }).uncontestedPull, 0.5);
});

test('different derived types: affection pulls to the mother, familiarity to the father, and the direction can flip', () => {
  const common = { affinity: 0, motherDerivedType: '魔导', fatherDerivedType: '修炼', fetusRace: '人类', passedDays: 14 };
  const towardFather = calculateDerivedInheritanceProgress({ ...common, currentProgress: 20, paternalFit: 0.9 });
  assert.ok(towardFather < 20, '契合度高时已偏母方的轴也会被拉回父方');
  const loved = calculateDerivedInheritanceProgress({ ...common, currentProgress: -20, affinity: 50, paternalFit: 0.9 });
  assert.ok(loved > -20, '母亲很疼时又被拉回母方');
});

test('same derived type on both sides: both pulls point the same way', () => {
  const common = { currentProgress: 0, motherDerivedType: '魔导', fatherDerivedType: '魔导', fetusRace: '人类', passedDays: 14 };
  assert.equal(calculateDerivedInheritanceProgress({ ...common, affinity: 0, paternalFit: 0.5 }), 18.75, '母 1 + 父 1 + 同型底力 0.5');
});

test('species gestation speed and temporary modifier scale inheritance time', () => {
  const common = {
    currentProgress: 0,
    affinity: -15,
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
