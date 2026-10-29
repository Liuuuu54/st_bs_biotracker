import { getSpermQualityFactors } from './sires.js';
import {
  deriveFetusRace,
  deriveFetusAncestry,
  getBloodlineInfo,
  getCompanionEggsMeanByRace,
  getDerivedTypeInheritanceProfile,
  getEmbryoTypeByRace,
  getFetusInheritanceTag,
  getMergedRacePhysiologyProfile,
  getRaceComponents,
  getRaceInheritanceMode,
  getSpermDoseCompanionMultiplier,
  getSpermDoseDifficultyBonus,
} from './race_config.js';
import { GESTATION_SPEED_MAX, GESTATION_SPEED_MIN, MENSTRUAL_STAGE_DAYS } from './stage_config.js';
import { CONCEPTION_WEIGHT_LOG_SD, getConceptionStageWeight, resolveConceptionWeightRatio } from './body_size.js';

export const SPERM_DECAY_PER_DAY = 10;
export const CROSS_RACE_DIFFICULTY_MULTIPLIER = 1.5;
export const EMBRYO_TYPE_MISMATCH_MULTIPLIER = 1.25;
/**
 * 受精率常数：每颗卵的机率 = 1 − e^(−k × 有效暴露天数 ÷ 有效难度)。
 * 以「人类在排卵期同房一次（精液量 20）整个周期受孕约 30%」校准，见 plan/FERTILIZATION_CALIBRATION_PLAN.md。
 */
export const FERTILIZATION_RATE = 0.3;

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
 * 精液以固定速度线性流失。受精判定发生在整段时间推进之前，因此必须在这里截断
 * 实际可暴露时长；否则只剩 1 的残留在推进 1 天时仍会被当成完整作用一整天。
 */
export function calculateSpermExposure(value, elapsedDays, decayPerDay = SPERM_DECAY_PER_DAY) {
  const startingValue = clampNumber(value, 0, 999999, 0);
  const requestedDays = Math.max(0, Number(elapsedDays) || 0);
  const decay = clampNumber(decayPerDay, 0.000001, 999999, SPERM_DECAY_PER_DAY);
  const exposureDays = Math.min(requestedDays, startingValue / decay);
  const endingValue = Math.max(0, startingValue - (decay * exposureDays));
  const exposureAmountDays = ((startingValue + endingValue) / 2) * exposureDays;
  return { startingValue, endingValue, exposureDays, exposureAmountDays };
}

/**
 * 只计算一次自然受精判定的概率，不抽随机数、不写角色状态。
 * 多精源先计算整体受精率，再按各精源的 chance 权重分配胜出率，避免阵列顺序偏差。
 * uterusVolumeFactor 是女方子宫容积倍率（见 body_size.js）：每天排掉的量与剂量加成都按容积换算，
 * 同体型的一对与人类一样难易。
 */
export function calculateFertilizationPreview({
  eggRace = '人类',
  impregnationDifficulty = null,
  elapsedDays = 1,
  chanceFactor = 1,
  spermSources = [],
  uterusVolumeFactor = 1,
  // 卵方万族相容（immune.crossSpecies）：异族与胚型不同都不加难度，与同族一样只看卵方
  crossSpecies = false,
} = {}) {
  const volumeFactor = clampNumber(uterusVolumeFactor, 0.01, 100, 1);
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
    .filter((source) => source.value > 0)
    .map((source) => {
      // 精子品质：留存时间按每天流失 ×q^-0.5 算真实的暴露天数，再把有效量 ×q^0.5；量与时间各分一半效果
      const factors = getSpermQualityFactors(source.quality);
      const exposure = calculateSpermExposure(source.value, elapsedDays, SPERM_DECAY_PER_DAY * volumeFactor * factors.decay);
      return { ...source, quality: factors.quality, ...exposure, exposureAmountDays: exposure.exposureAmountDays * factors.amount };
    })
    .filter((source) => source.exposureDays > 0);
  const totalSperm = validSources.reduce((sum, source) => sum + source.value, 0);
  const effectiveExposureDays = validSources.reduce((max, source) => Math.max(max, source.exposureDays), 0);
  const totalExposureAmountDays = validSources.reduce((sum, source) => sum + source.exposureAmountDays, 0);
  const effectiveTotalSperm = effectiveExposureDays > 0
    ? totalExposureAmountDays / effectiveExposureDays
    : 0;
  const spermDoseBonus = getSpermDoseDifficultyBonus(effectiveTotalSperm / volumeFactor);
  const sources = validSources.map((source) => {
    const share = totalExposureAmountDays > 0 ? source.exposureAmountDays / totalExposureAmountDays : 0;
    const maleProfile = getMergedRacePhysiologyProfile(source.race, source.bloodline) || {};
    const maleDifficulty = clampNumber(maleProfile.impregnationDifficulty, 0.1, 100, 1);
    const sameRace = crossSpecies || isSameRaceGroup(eggRace, source.race);
    let effectiveDifficulty = sameRace
      ? femaleDifficulty
      : Math.sqrt(femaleDifficulty * maleDifficulty) * CROSS_RACE_DIFFICULTY_MULTIPLIER;
    const eggEmbryoType = getEmbryoTypeByRace(eggRace);
    const spermEmbryoType = getEmbryoTypeByRace(source.race);
    const embryoTypeMismatch = !crossSpecies && eggEmbryoType !== spermEmbryoType;
    if (embryoTypeMismatch) effectiveDifficulty *= EMBRYO_TYPE_MISMATCH_MULTIPLIER;
    effectiveDifficulty /= spermDoseBonus;

    // 指数饱和：暴露越久越接近必中但不会顶到 1，难度照比例拉长所需的暴露。
    // 旧式「天数 × 6 ÷ 难度」在人类身上暴露 4 小时就封顶 100%，每颗卵必定受精。
    const baseChance = clampNumber(
      1 - Math.exp(-FERTILIZATION_RATE * effectiveExposureDays / effectiveDifficulty),
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
    effectiveTotalSperm,
    effectiveExposureDays,
    totalExposureAmountDays,
    spermDoseBonus,
    uterusVolumeFactor: volumeFactor,
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
  // 只算活动周期：休眠期不影响着床
  const cycleLength = Object.values(MENSTRUAL_STAGE_DAYS).reduce((sum, days) => (
    sum + Math.max(1, (Number(days) || 0) * ratio)
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
  const ancestry = deriveFetusAncestry(eggRace, spermRace);
  const fetusRace = ancestry.race;
  const motherBloodline = getBloodlineInfo(eggRace).bloodline;
  const embryoType = getEmbryoTypeByRace(fetusRace, ancestry.bloodline, motherBloodline);
  // 伴生卵在「整群＝伴生卵＋1」的尺度上乘倍率与波动，取整后再减一，与正式抽取一致
  const companionEggsMean = getCompanionEggsMeanByRace(fetusRace, ancestry.bloodline, motherBloodline);
  const companionMultiplier = getSpermDoseCompanionMultiplier(spermValue);
  const adjustedClutch = (companionEggsMean + 1) * companionMultiplier;
  const toEggs = (clutch) => Math.max(0, Math.min(12499, clutch - 1));
  const companionRange = companionEggsMean <= 0
    ? { min: 0, typical: 0, max: 0 }
    : {
      min: toEggs(Math.round(adjustedClutch * 0.9)),
      typical: toEggs(Math.round(adjustedClutch)),
      // 正式抽取为 [0.9, 1.1)，上界不含 1.1；这里列出实际可抽到的最大整数。
      max: toEggs(Math.ceil((adjustedClutch * 1.1) + 0.5) - 1),
    };
  const profile = getMergedRacePhysiologyProfile(fetusRace, ancestry.bloodline) || {};
  const gestationSpeciesSpeed = clampNumber(profile.gestationSpeciesSpeed, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1);
  const components = getRaceComponents(fetusRace);
  const embryoTypeSource = components.reduce((slowest, race) => {
    const speed = clampNumber(getMergedRacePhysiologyProfile(race)?.gestationSpeciesSpeed, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1);
    if (!slowest || speed < slowest.speed) return { race, speed };
    return slowest;
  }, null);
  // 与引擎同一套：双方种族都有数值体型时看体型差，否则退回承载耐受（见 body_size.js）；计算机只有种族，用种族平均体型
  const { ratio: breedWeightRatio, basis: weightRatioBasis } = resolveConceptionWeightRatio({ race: eggRace }, { race: spermRace });
  const stageWeight = getConceptionStageWeight(conceptionStage);
  const genderRatio = Object.prototype.hasOwnProperty.call(profile, 'genderRatio') ? profile.genderRatio : undefined;
  const sexMultipliers = genderRatio === null || Number(genderRatio) === -1
    ? [1]
    : Number(genderRatio) <= 0
      ? [1 / 1.05]
      : Number(genderRatio) >= 100
        ? [1.05]
        : [1 / 1.05, 1.05];
  const weightCandidates = sexMultipliers.flatMap((sexMultiplier) => [
    // 胎重波动是对数常态分布（见 body_size.js 的 CONCEPTION_WEIGHT_LOG_SD），这里给约 95% 会落在的范围（±2 个标准差）
    stageWeight * Math.exp(-2 * CONCEPTION_WEIGHT_LOG_SD) * sexMultiplier * breedWeightRatio,
    stageWeight * Math.exp(2 * CONCEPTION_WEIGHT_LOG_SD) * sexMultiplier * breedWeightRatio,
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
    bloodline: ancestry.bloodline,
    bloodlineSource: ancestry.bloodlineSource,
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
    weightRatioBasis,
    fetalWeightRange,
    companionEggsMean,
    companionMultiplier,
    companionRange,
  };
}

export const DERIVED_INHERITANCE_THRESHOLD = 75;
export const DERIVED_INHERITANCE_BASELINE_DAYS = 140;
// 无竞争底力：只有一方有衍生、或双方同型时，那条血脉另得 0.5 × 遗传速度的拉力
export const DERIVED_UNCONTESTED_PULL = 0.5;

/**
 * 受孕初值：亲密度一律从 0 起（只代表母子感情，不再随衍生组合变号）；
 * 遗传轴只有双方衍生相同时先给 +30 的起跑，其余从 0 开始由孕期拉锯决定方向。
 */
export function getDerivedInheritanceSeed(motherDerivedType, fatherDerivedType) {
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  return { affinity: 0, progress: mother && father && mother === father ? 30 : 0 };
}

function getDerivedTypeSpeed(derivedType) {
  if (!derivedType) return 1;
  return clampNumber(getDerivedTypeInheritanceProfile(derivedType)?.inheritanceSpeed, 0.2, 3, 1);
}

/**
 * 孕期拉锯（精方计划 §6.9）：母胎亲密度往母方拉、与胎父的契合度往父方拉，方向可以中途翻转。
 * - 母方拉力 M = clamp(1 + 亲密度/30, 0, 3) × 母方衍生的遗传速度
 * - 父方拉力 P = 2 × 契合度 × 父方衍生的遗传速度
 * - 无竞争底力 B = 0.5 × 该衍生的遗传速度：只有一方有衍生时加给那一方；双方同型时也加（两条血脉一致）
 * - 双方衍生相同：两边都往同一个衍生拉，每天 +基准 ×(M + P + B)
 * - 其余：每天 基准 ×(M − P)（加上有衍生那一方的 B），正值偏母方、负值偏父方；没有衍生的那一方越线就是不遗传衍生
 * - 双方异型不加底力，两边硬拼
 * 基准 = 75/140 天 × 胎儿种族妊娠速度 × 妊娠变速：拉力 1 时 140 天走到判定线，与旧版相同。
 */
function getDerivedInheritanceRate({
  currentProgress = 0,
  affinity = 0,
  paternalFit = 0,
  motherDerivedType = null,
  fatherDerivedType = null,
  fetusRace = '人类',
  fetusBloodline = null,
  gestationModifierMultiplier = 1,
} = {}) {
  const progress = clampNumber(currentProgress, -100, 100, 0);
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  const maternalPull = clampNumber(1 + (clampNumber(affinity, -50, 50, 0) / 30), 0, 3, 1) * getDerivedTypeSpeed(mother);
  const paternalPull = 2 * clampNumber(paternalFit, 0, 1, 0) * getDerivedTypeSpeed(father);
  if (!mother && !father) {
    return { progress, direction: 0, activeDerivedType: null, dailyDelta: 0, maternalPull, paternalPull };
  }
  const speciesSpeed = clampNumber(
    getMergedRacePhysiologyProfile(fetusRace, fetusBloodline)?.gestationSpeciesSpeed,
    GESTATION_SPEED_MIN,
    GESTATION_SPEED_MAX,
    1,
  );
  const modifier = clampNumber(gestationModifierMultiplier, 0, GESTATION_SPEED_MAX, 1);
  const baseRate = (DERIVED_INHERITANCE_THRESHOLD / DERIVED_INHERITANCE_BASELINE_DAYS) * speciesSpeed * modifier;
  const sameType = Boolean(mother && father && mother === father);
  // 没有对手衍生竞争的那一方另得一份不看感情、契合的底力
  const baseShare = DERIVED_UNCONTESTED_PULL;
  const maternalBase = mother && (!father || sameType) ? baseShare * getDerivedTypeSpeed(mother) : 0;
  const paternalBase = father && !mother ? baseShare * getDerivedTypeSpeed(father) : 0;
  const totalMaternal = maternalPull + maternalBase;
  const totalPaternal = paternalPull + paternalBase;
  const dailyDelta = baseRate * (sameType ? totalMaternal + totalPaternal : totalMaternal - totalPaternal);
  const direction = Math.sign(dailyDelta);
  const activeDerivedType = direction > 0 ? mother : direction < 0 ? father : null;
  return { progress, direction, activeDerivedType, dailyDelta, maternalPull: totalMaternal, paternalPull: totalPaternal, uncontestedPull: maternalBase + paternalBase, sameType };
}

/**
 * 推进一胎的衍生遗传轴。人类孕期、亲合度 0、遗传速度 1 时，
 * 从 0 走到判定线恰需 140 天；分娩判定采用严格越线。
 */
export function calculateDerivedInheritanceProgress({
  currentProgress = 0,
  affinity = 0,
  paternalFit = 0,
  motherDerivedType = null,
  fatherDerivedType = null,
  fetusRace = '人类',
  fetusBloodline = null,
  passedDays = 0,
  gestationModifierMultiplier = 1,
} = {}) {
  const { progress, dailyDelta } = getDerivedInheritanceRate({
    currentProgress,
    affinity,
    paternalFit,
    motherDerivedType,
    fatherDerivedType,
    fetusRace,
    fetusBloodline,
    gestationModifierMultiplier,
  });
  const elapsedDays = Math.max(0, Number(passedDays) || 0);
  if (dailyDelta === 0 || elapsedDays <= 0) return progress;
  return clampNumber(progress + (dailyDelta * elapsedDays), -100, 100, progress);
}

export function calculateDerivedInheritancePreview(options = {}) {
  const { progress, direction, activeDerivedType, dailyDelta, maternalPull, paternalPull, uncontestedPull } = getDerivedInheritanceRate(options);
  const nextProgress = calculateDerivedInheritanceProgress(options);
  const distance = direction > 0
    ? DERIVED_INHERITANCE_THRESHOLD - progress
    : direction < 0 ? progress + DERIVED_INHERITANCE_THRESHOLD : 0;
  const exactDaysToThreshold = direction && Math.abs(dailyDelta) > 0
    ? Math.max(0, distance / Math.abs(dailyDelta))
    : null;
  return {
    direction,
    maternalPull,
    paternalPull,
    uncontestedPull,
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
