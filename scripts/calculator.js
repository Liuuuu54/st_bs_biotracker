import {
  deriveFetusRace,
  getClutchSizeMeanByRace,
  getDerivedTypeInheritanceProfile,
  getEmbryoTypeByRace,
  getFetusInheritanceTag,
  getMergedRacePhysiologyProfile,
  getRaceComponents,
  getRaceInheritanceMode,
  getSpermDoseClutchMultiplier,
  getSpermDoseDifficultyBonus,
} from './race_config.js';
import { MENSTRUAL_STAGE_DAYS, MENSTRUAL_STAGES } from './stage_config.js';

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isSameRaceGroup(raceA, raceB) {
  const left = getRaceComponents(raceA).map(String).sort();
  const right = getRaceComponents(raceB).map(String).sort();
  return left.length > 0 && right.length > 0
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

/**
 * 只计算一次自然受精判定的概率，不抽随机数、不写角色状态。
 * 多精源先计算整体受精率，再按各精源的 chance 权重分配胜出率，避免阵列顺序偏差。
 */
export function calculateFertilizationPreview({
  eggRace = '人类',
  impregnationDifficulty = null,
  elapsedDays = 1,
  chanceFactor = 1,
  spermSources = [],
} = {}) {
  const eggProfile = getMergedRacePhysiologyProfile(eggRace) || {};
  const femaleDifficulty = impregnationDifficulty === null || impregnationDifficulty === undefined || impregnationDifficulty === ''
    ? clampNumber(eggProfile.impregnationDifficulty, 0.1, 100, 1)
    : clampNumber(impregnationDifficulty, 0.1, 100, 1);
  const validSources = (Array.isArray(spermSources) ? spermSources : [])
    .map((source, index) => ({
      ...source,
      sourceIndex: index,
      race: String(source?.race || '人类'),
      value: clampNumber(source?.value, 0, 999999, 0),
    }))
    .filter((source) => source.value > 0);
  const totalSperm = validSources.reduce((sum, source) => sum + source.value, 0);
  const spermDoseBonus = getSpermDoseDifficultyBonus(totalSperm);
  const sources = validSources.map((source) => {
    const share = totalSperm > 0 ? source.value / totalSperm : 0;
    const maleProfile = getMergedRacePhysiologyProfile(source.race) || {};
    const maleDifficulty = clampNumber(maleProfile.impregnationDifficulty, 0.1, 100, 1);
    const sameRace = isSameRaceGroup(eggRace, source.race);
    let effectiveDifficulty = sameRace ? femaleDifficulty : femaleDifficulty + maleDifficulty;
    const eggEmbryoType = getEmbryoTypeByRace(eggRace);
    const spermEmbryoType = getEmbryoTypeByRace(source.race);
    const embryoTypeMismatch = eggEmbryoType !== spermEmbryoType;
    if (embryoTypeMismatch) effectiveDifficulty *= 1.5;
    effectiveDifficulty /= spermDoseBonus;

    const baseChance = clampNumber(
      (Math.max(0, Number(elapsedDays) || 0) * 12 * 0.5) / effectiveDifficulty,
      0.001,
      1,
      0.001,
    );
    const chance = clampNumber(baseChance * share * Math.max(0, Number(chanceFactor) || 0), 0, 1, 0);
    return {
      ...source,
      share,
      maleDifficulty,
      sameRace,
      embryoTypeMismatch,
      effectiveDifficulty,
      chance,
    };
  });

  const failureChance = sources.reduce((remaining, source) => remaining * (1 - source.chance), 1);
  const successChance = 1 - failureChance;
  const totalChanceWeight = sources.reduce((sum, source) => sum + source.chance, 0);
  const weightedSources = sources.map((source) => ({
    ...source,
    winnerWeight: totalChanceWeight > 0 ? source.chance / totalChanceWeight : 0,
    winChance: totalChanceWeight > 0 ? successChance * source.chance / totalChanceWeight : 0,
  }));

  return {
    eggRace,
    femaleDifficulty,
    totalSperm,
    spermDoseBonus,
    sources: weightedSources,
    totalChanceWeight,
    successChance,
    failureChance,
  };
}

export function calculateImplantationDays(cycleLength = 28) {
  return Math.max(1, (6 * clampNumber(cycleLength, 0.1, 9999, 28)) / 28);
}

export function calculateRaceImplantationDays(race = '人类') {
  const profile = getMergedRacePhysiologyProfile(race) || {};
  const ratio = clampNumber(profile.menstrualLengthRatio, 0.1, 20, 1);
  const cycleLength = MENSTRUAL_STAGES.reduce((sum, stage) => (
    sum + Math.max(1, (Number(MENSTRUAL_STAGE_DAYS[stage]) || 0) * ratio)
  ), 0);
  return calculateImplantationDays(cycleLength || 28);
}

export function calculateImplantationPreview({ cycleLength = 28, vitality = 100, elapsedDays = 0 } = {}) {
  const requiredDays = calculateImplantationDays(cycleLength);
  const elapsed = Math.max(0, Number(elapsedDays) || 0);
  return {
    requiredDays,
    elapsedDays: elapsed,
    remainingDays: Math.max(0, requiredDays - elapsed),
    ready: elapsed >= requiredDays,
    successChance: clampNumber(vitality, 0, 200, 100) >= 100
      ? 1
      : clampNumber(vitality, 0, 100, 100) / 100,
  };
}

export function calculateOffspringPreview({
  eggRace = '人类',
  spermRace = '人类',
  spermValue = 20,
  conceptionStage = '排卵期',
} = {}) {
  const fetusRace = deriveFetusRace(eggRace, spermRace);
  const embryoType = getEmbryoTypeByRace(fetusRace);
  const clutchSizeMean = getClutchSizeMeanByRace(fetusRace);
  const clutchMultiplier = getSpermDoseClutchMultiplier(spermValue);
  const adjustedMean = clutchSizeMean <= 1 ? 1 : clutchSizeMean * clutchMultiplier;
  const clutchRange = clutchSizeMean <= 1
    ? { min: 1, typical: 1, max: 1 }
    : {
      min: Math.max(1, Math.min(12500, Math.round(adjustedMean * 0.9))),
      typical: Math.max(1, Math.min(12500, Math.round(adjustedMean))),
      // 正式抽取为 [0.9, 1.1)，上界不含 1.1；这里列出实际可抽到的最大整数。
      max: Math.max(1, Math.min(12500, Math.ceil((adjustedMean * 1.1) + 0.5) - 1)),
    };
  const profile = getMergedRacePhysiologyProfile(fetusRace) || {};
  const eggProfile = getMergedRacePhysiologyProfile(eggRace) || {};
  const spermProfile = getMergedRacePhysiologyProfile(spermRace) || {};
  const gestationSpeciesSpeed = clampNumber(profile.gestationSpeciesSpeed, 0.1, 20, 1);
  const components = getRaceComponents(fetusRace);
  const embryoTypeSource = components.reduce((slowest, race) => {
    const speed = clampNumber(getMergedRacePhysiologyProfile(race)?.gestationSpeciesSpeed, 0.1, 20, 1);
    if (!slowest || speed < slowest.speed) return { race, speed };
    return slowest;
  }, null);
  const eggBreedTolerance = clampNumber(eggProfile.breedTolerance, 0.1, 100, 1);
  const spermBreedTolerance = clampNumber(spermProfile.breedTolerance, 0.1, 100, 1);
  const dominance = (spermBreedTolerance - eggBreedTolerance)
    / Math.max(eggBreedTolerance + spermBreedTolerance, 0.1);
  const breedWeightRatio = clampNumber(1 + (dominance * 0.65), 0.625, 1.6, 1);
  const stageWeight = {
    黄体期: 1.2,
    排卵期: 1.1,
    卵泡期: 1,
    产后恢复: 1 / 1.1,
    月经期: 1 / 1.2,
  }[String(conceptionStage || '')] || 1;
  const genderRatio = Object.prototype.hasOwnProperty.call(profile, 'genderRatio') ? profile.genderRatio : undefined;
  const sexMultipliers = genderRatio === null || Number(genderRatio) === -1
    ? [1]
    : Number(genderRatio) <= 0
      ? [1 / 1.05]
      : Number(genderRatio) >= 100
        ? [1.05]
        : [1 / 1.05, 1.05];
  const weightCandidates = sexMultipliers.flatMap((sexMultiplier) => [
    stageWeight * Math.exp(-0.083) * sexMultiplier * breedWeightRatio,
    stageWeight * Math.exp(0.083) * sexMultiplier * breedWeightRatio,
  ]).map((value) => clampNumber(value, 0.33, 3, 1));
  const fetalWeightRange = {
    min: Math.min(...weightCandidates),
    typical: clampNumber(stageWeight * breedWeightRatio, 0.33, 3, 1),
    max: Math.max(...weightCandidates),
  };
  return {
    eggRace,
    spermRace,
    eggInheritanceMode: getRaceInheritanceMode(eggRace),
    spermInheritanceMode: getRaceInheritanceMode(spermRace),
    fetusRace,
    inheritanceTag: getFetusInheritanceTag(eggRace, spermRace),
    embryoType,
    embryoTypeSource: embryoTypeSource?.race || fetusRace,
    gestationSpeciesSpeed,
    gestationDays: 280 / gestationSpeciesSpeed,
    genderRatio,
    implantationDays: calculateRaceImplantationDays(eggRace),
    identicalProbability: clampNumber(profile.identicalProbability, 0, 100, 5),
    conceptionStage,
    breedWeightRatio,
    fetalWeightRange,
    clutchSizeMean,
    clutchMultiplier,
    adjustedClutchMean: adjustedMean,
    clutchRange,
  };
}

export const DERIVED_INHERITANCE_THRESHOLD = 75;
export const DERIVED_INHERITANCE_BASELINE_DAYS = 140;

export function getDerivedInheritanceSeed(motherDerivedType, fatherDerivedType) {
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  if (!mother && !father) return { affinity: 0, progress: 0 };
  if (mother && father && mother === father) return { affinity: 30, progress: 30 };
  if (mother && father && mother !== father) return { affinity: -30, progress: -30 };
  return { affinity: 15, progress: 0 };
}

function getDerivedInheritanceDirection(currentProgress, motherDerivedType, fatherDerivedType) {
  if (currentProgress !== 0) return Math.sign(currentProgress);
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  if (mother && !father) return 1;
  if (!mother && father) return -1;
  if (mother && father) return mother === father ? 1 : -1;
  return 0;
}

function getDerivedInheritanceRate({
  currentProgress = 0,
  affinity = 0,
  motherDerivedType = null,
  fatherDerivedType = null,
  fetusRace = '人类',
  gestationModifierMultiplier = 1,
} = {}) {
  const progress = clampNumber(currentProgress, -100, 100, 0);
  const direction = getDerivedInheritanceDirection(progress, motherDerivedType, fatherDerivedType);
  const activeDerivedType = direction > 0 ? motherDerivedType : fatherDerivedType;
  if (direction === 0 || !activeDerivedType) {
    return { progress, direction, activeDerivedType: null, dailyDelta: 0 };
  }
  const alignedAffinity = direction * clampNumber(affinity, -50, 50, 0);
  const affinityFactor = clampNumber(1 + (alignedAffinity / 30), 0, 3, 1);
  const inheritanceSpeed = clampNumber(
    getDerivedTypeInheritanceProfile(activeDerivedType)?.inheritanceSpeed,
    0.2,
    3,
    1,
  );
  const speciesSpeed = clampNumber(
    getMergedRacePhysiologyProfile(fetusRace)?.gestationSpeciesSpeed,
    0.1,
    20,
    1,
  );
  const modifier = clampNumber(gestationModifierMultiplier, 0, 20, 1);
  const dailyDelta = direction * (DERIVED_INHERITANCE_THRESHOLD / DERIVED_INHERITANCE_BASELINE_DAYS)
    * speciesSpeed * modifier * affinityFactor * inheritanceSpeed;
  return { progress, direction, activeDerivedType, dailyDelta };
}

/**
 * 推进一胎的衍生遗传轴。人类孕期、亲合度 0、遗传速度 1 时，
 * 从 0 走到判定线恰需 140 天；分娩判定采用严格越线。
 */
export function calculateDerivedInheritanceProgress({
  currentProgress = 0,
  affinity = 0,
  motherDerivedType = null,
  fatherDerivedType = null,
  fetusRace = '人类',
  passedDays = 0,
  gestationModifierMultiplier = 1,
} = {}) {
  const { progress, dailyDelta } = getDerivedInheritanceRate({
    currentProgress,
    affinity,
    motherDerivedType,
    fatherDerivedType,
    fetusRace,
    gestationModifierMultiplier,
  });
  const elapsedDays = Math.max(0, Number(passedDays) || 0);
  if (dailyDelta === 0 || elapsedDays <= 0) return progress;
  return clampNumber(progress + (dailyDelta * elapsedDays), -100, 100, progress);
}

export function calculateDerivedInheritancePreview(options = {}) {
  const { progress, direction, activeDerivedType, dailyDelta } = getDerivedInheritanceRate(options);
  const nextProgress = calculateDerivedInheritanceProgress(options);
  const distance = direction > 0
    ? DERIVED_INHERITANCE_THRESHOLD - progress
    : direction < 0 ? progress + DERIVED_INHERITANCE_THRESHOLD : 0;
  const exactDaysToThreshold = direction && Math.abs(dailyDelta) > 0
    ? Math.max(0, distance / Math.abs(dailyDelta))
    : null;
  return {
    direction,
    activeDerivedType: activeDerivedType || null,
    currentProgress: progress,
    nextProgress,
    dailyDelta,
    exactDaysToThreshold,
    wholeDaysToInherit: exactDaysToThreshold === null
      ? null
      : exactDaysToThreshold <= 0 ? 0 : Math.floor(exactDaysToThreshold) + 1,
    inheritedType: nextProgress > DERIVED_INHERITANCE_THRESHOLD
      ? (options.motherDerivedType || null)
      : nextProgress < -DERIVED_INHERITANCE_THRESHOLD
        ? (options.fatherDerivedType || null)
        : null,
  };
}
