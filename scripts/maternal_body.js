// 母胎分配与孕期身体（1.3.1，见 plan/MATERNAL_FETAL_ALLOCATION_PLAN.md §0）。
//
// 单向的链：
//   母体倾向 ＋ 每胎索取 → 本胎 α（只决定母体留多少）→ 体重（脂肪储备）→ 外溢到臀与胸
//   胸部增长倾向 → 胸（荷尔蒙），臀部增长倾向 → 臀（骨盆变宽）：个人体质，与 α 无关
// 每胎索取、本胎 α、孕期增量都即时算出、不存；只存基准、倾向，与产后待回落的那一份。
import { getMergedRacePhysiologyProfile } from './race_config.js';
import { DUE_DATE_DAYS } from './stage_config.js';

export const BODY_BASE_DEFAULTS = Object.freeze({ build: 50, bust: 40, hip: 50 });
export const BODY_BASE_MAX = 100;
/** 胸部孕期可到 150（N 罩杯）：每 10 一个罩杯，0＝AAA、40＝C、100＝I */
export const BUST_MAX = 150;

export const ALLOCATION_BIAS_SD = 0.3;
export const BUST_GAIN_MEAN = 1.5;
export const BUST_GAIN_MAX = 3;
export const HIP_GAIN_MEAN = 0.5;
export const HIP_GAIN_MAX = 2;
/** 增长倾向的个体差异：平均 × e^(0.3z) */
export const BODY_GAIN_LOG_SD = 0.3;

/** 每胎索取：同族 1，耐受差距越大越吃力（不分方向），上限 2；再乘核型 */
export const DEMAND_TOLERANCE_SLOPE = 0.25;
export const DEMAND_MAX = 2;
export const DEMAND_NUCLEUS = Object.freeze({ androgenesis: 1.25, gynogenesis: 0.8 });
/** 本胎 α ＝ 母体倾向 ＋ 0.5 ×（平均索取 − 1） */
export const ALPHA_DEMAND_WEIGHT = 0.5;

/** α 作用在胎儿健康与需求（§0.3） */
export const DRAIN_BIAS_WEIGHT = 0.25;
export const FETAL_GAIN_ALPHA_WEIGHT = 0.4;
export const FETAL_LOSS_ALPHA_WEIGHT = 0.4;
export const TARGET_ALPHA_SHIFT = 8;
export const TARGET_MIN = 10;
export const TARGET_MAX = 90;

/** 身体增量（§0.4） */
export const BUILD_GAIN_AT_TERM = 8;
export const BUILD_THINNING_WEIGHT = 0.4;
export const FAT_SPILL_HIP = 0.4;
export const FAT_SPILL_BUST = 0.15;
export const BULK_DRIVE_MAX = 2;
export const BODY_PROGRESS_MAX = 1.25;
/** 假孕只长到孕早期结束的程度 */
export const PSEUDO_PREGNANCY_PROGRESS_CAP = 84 / DUE_DATE_DAYS;
export const BUILD_CARE_FACTORS = Object.freeze({
  abusive: 0.3, neglect: 0.6, unaware: 0.9, normal: 1, attentive: 1.2, devoted: 1.5,
});

/** 产后留存（§0.5）：其余在产后恢复期间线性回落 */
export const BODY_RETENTION = Object.freeze({ build: 0.3, bust: 0.25, hip: 0.4 });

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashUnit(text) {
  let hash = 2166136261;
  for (const char of String(text || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 0.5) / 4294967297;
}

function normalFromUniforms(u, v) {
  return Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, u))) * Math.cos(2 * Math.PI * v);
}

function traitsFromNormals(zBias, zBust, zHip) {
  const z = (value) => Math.max(-3, Math.min(3, value));
  return {
    allocationBias: round(clamp(ALLOCATION_BIAS_SD * z(zBias), -1, 1, 0), 2),
    bustGain: round(clamp(BUST_GAIN_MEAN * Math.exp(BODY_GAIN_LOG_SD * z(zBust)), 0, BUST_GAIN_MAX, BUST_GAIN_MEAN), 2),
    hipGain: round(clamp(HIP_GAIN_MEAN * Math.exp(BODY_GAIN_LOG_SD * z(zHip)), 0, HIP_GAIN_MAX, HIP_GAIN_MEAN), 2),
  };
}

/** 角色卡没写时抽样：母体倾向 N(0, 0.3)，胸臀增长倾向 平均 × e^(0.3z) */
export function sampleBodyTraits(random = Math.random) {
  const n = () => normalFromUniforms(random(), random());
  return traitsFromNormals(n(), n(), n());
}

/**
 * 按名字固定抽样：预设角色、存档迁移与楼层快照都用它，同一个名字每次得到同一组值，
 * 快照还原时不会和主档对不上。
 */
export function deterministicBodyTraits(name) {
  const key = String(name || '');
  const n = (tag) => normalFromUniforms(hashUnit(`${key}#${tag}#u`), hashUnit(`${key}#${tag}#v`));
  return traitsFromNormals(n('bias'), n('bust'), n('hip'));
}

/**
 * 新角色 base 的身体栏位：中性预设（母体倾向 0、增长倾向取平均）。
 * 个体差异在注册时抽样或照角色卡填（registry.js），旧档迁移按名字固定抽样。
 */
export function createBodyBaseFields() {
  return { ...BODY_BASE_DEFAULTS, allocationBias: 0, bustGain: BUST_GAIN_MEAN, hipGain: HIP_GAIN_MEAN };
}

/** 读 base 的身体基准与倾向（缺栏位时退回预设，读的时候夹值） */
export function getBodyBaseline(base = {}) {
  return {
    build: clamp(base?.build, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.build),
    bust: clamp(base?.bust, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.bust),
    hip: clamp(base?.hip, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.hip),
    allocationBias: clamp(base?.allocationBias, -1, 1, 0),
    bustGain: clamp(base?.bustGain, 0, BUST_GAIN_MAX, BUST_GAIN_MEAN),
    hipGain: clamp(base?.hipGain, 0, HIP_GAIN_MAX, HIP_GAIN_MEAN),
  };
}

/** 补齐缺的身体栏位（就地修改）；迁移与注册用。身材上次改变的年龄（bsGrowBody 的门槛）填当下年龄 */
export function ensureBodyBaseFields(base, name = '', { force = false } = {}) {
  if (!base || typeof base !== 'object') return base;
  // force（v14→v15 迁移）：旧档载入时已先和新预设合并，栏位是中性预设值而不是缺栏位，
  // 所以倾向一律按名字重抽、锚点一律填当下年龄；体重、胸、臀维持预设
  if ((force || !Number.isFinite(Number(base.bodyChangedAtAge))) && Number.isFinite(Number(base.age))) base.bodyChangedAtAge = Number(base.age);
  const traits = deterministicBodyTraits(name);
  for (const [key, value] of Object.entries(BODY_BASE_DEFAULTS)) {
    if (!Number.isFinite(Number(base[key]))) base[key] = value;
  }
  for (const key of ['allocationBias', 'bustGain', 'hipGain']) {
    if (force || !Number.isFinite(Number(base[key]))) base[key] = traits[key];
  }
  return base;
}

// ---- 母胎分配 ----

function getRaceTolerance(race, bloodline) {
  return clamp(getMergedRacePhysiologyProfile(String(race || ''), bloodline ?? null)?.breedTolerance, 0.01, 100, 1);
}

function getDemandNucleusFactor(fetus) {
  const tags = Array.isArray(fetus?.tags) ? fetus.tags : [];
  const andro = tags.includes('androgenesis');
  const gyno = tags.includes('gynogenesis');
  // 嵌合胎两种核型都有时互相抵消，当一般
  if (andro && !gyno) return DEMAND_NUCLEUS.androgenesis;
  if (gyno && !andro) return DEMAND_NUCLEUS.gynogenesis;
  return 1;
}

/**
 * 每胎索取：这一胎向母体要多少。由母体族与胎儿族承载耐受的差距推得，不分方向
 * （人类怀龙胎、龙娘怀人类胎都比同族吃力），再乘核型（父系基因多要、母系基因克制）。不存。
 * 两边都读种族表（混血按血脉加权）：母体当下的 bio.breedTolerance 在多胎时会打折，
 * 拿它比会让同族双胎也算成跨族。
 */
export function getFetusDemand(profile, fetus) {
  const mother = getRaceTolerance(profile?.base?.race, profile?.base?.bloodline);
  const child = getRaceTolerance(fetus?.race, fetus?.bloodline);
  const gap = Math.abs(Math.log2(mother / child));
  return round(Math.min(DEMAND_MAX, 1 + DEMAND_TOLERANCE_SLOPE * gap) * getDemandNucleusFactor(fetus), 4);
}

function getFetusOwnAge(profile, fetus) {
  const eff = clamp(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  return Math.max(0, eff - clamp(fetus?.conceivedAtDays, 0, 9999, 0));
}

/**
 * 本胎 α：−1 偏养母 ～ +1 偏养宝。母体倾向加上各胎索取（按自身孕龄 × 胎重加权）偏离 1 的部分。
 * 没有着床的胎儿（假孕、未孕）时就是母体倾向。
 */
export function getAllocationAlpha(profile) {
  const bias = clamp(profile?.base?.allocationBias, -1, 1, 0);
  const fetuses = (Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [])
    .filter((fetus) => fetus && !fetus.pendingImplantation);
  if (fetuses.length === 0) return round(bias, 4);
  let weightSum = 0;
  let demandSum = 0;
  for (const fetus of fetuses) {
    const weight = getFetusOwnAge(profile, fetus) * clamp(fetus?.weight, 0.33, 3, 1);
    weightSum += weight;
    demandSum += weight * getFetusDemand(profile, fetus);
  }
  const meanDemand = weightSum > 0
    ? demandSum / weightSum
    : fetuses.reduce((sum, fetus) => sum + getFetusDemand(profile, fetus), 0) / fetuses.length;
  return round(clamp(bias + ALPHA_DEMAND_WEIGHT * (meanDemand - 1), -1, 1, bias), 4);
}

export function getAllocationText(alpha) {
  const value = clamp(alpha, -1, 1, 0);
  if (Math.abs(value) < 0.2) return '平衡';
  const side = value < 0 ? '偏养母' : '偏养宝';
  return Math.abs(value) >= 0.6 ? `极度${side}` : side;
}

/** 胎儿消耗的倍率：每胎乘索取由调用端处理，这里是总和乘的母体倾向项 */
export function getDrainBiasFactor(profile) {
  return 1 + DRAIN_BIAS_WEIGHT * clamp(profile?.base?.allocationBias, -1, 1, 0);
}

/** 照料加分给胎儿的倍率 */
export function getFetalGainAllocationFactor(alpha) {
  return 1 + FETAL_GAIN_ALPHA_WEIGHT * clamp(alpha, -1, 1, 0);
}

/** 爆的扣分给胎儿的倍率：偏养宝时母体先扛 */
export function getFetalLossAllocationFactor(alpha) {
  return 1 - FETAL_LOSS_ALPHA_WEIGHT * clamp(alpha, -1, 1, 0);
}

/** 周回归目标：产前护理目标 ＋ 8α，夹在 10～90 */
export function shiftCareTarget(target, alpha) {
  return clamp(Number(target) + TARGET_ALPHA_SHIFT * clamp(alpha, -1, 1, 0), TARGET_MIN, TARGET_MAX, Number(target));
}

/** 母体份额：偏养母 1.75、平衡 1、偏养宝 0.25 */
export function getMaternalShare(alpha) {
  return 1 - 0.75 * clamp(alpha, -1, 1, 0);
}

// ---- 孕期身体增量 ----

/** 逾期、延产期超过 280 的部分只算一半，上限 1.25 */
export function getBodyProgress(effectivePregnantDays) {
  const days = clamp(effectivePregnantDays, 0, 99999, 0);
  if (days <= DUE_DATE_DAYS) return days / DUE_DATE_DAYS;
  return Math.min(BODY_PROGRESS_MAX, 1 + 0.5 * ((days - DUE_DATE_DAYS) / DUE_DATE_DAYS));
}

/** 胎量带动：单胎 1、双胎 √2、三胎 √3，最多 2；胎量是 tools.js getFetalBulk */
export function getBulkDrive(bulk, progress) {
  if (!(progress > 0) || !(bulk > 0)) return 1;
  return clamp(Math.sqrt(bulk / Math.min(1, progress)), 1, BULK_DRIVE_MAX, 1);
}

/**
 * 三项孕期增量（体重、胸、臀，单位与基准相同）。
 * input：{ progress, bulkDrive, alpha, care, averageHealthRatio, bustGain, hipGain }
 * - 体重 ＝ 8 × 母体份额 × 护理系数 × p − 偏养宝消瘦（偏养宝又照料差、胎儿健康低时母体被榨瘦）
 * - 胸 ＝ 10 × 胸部倾向 × 胎量带动 × p^0.7 ＋ 0.15 × 体重增量（荷尔蒙长得早，加脂肪外溢）
 * - 臀 ＝ 10 × 臀部倾向 × 胎量带动 × p^1.2 ＋ 0.4 × 体重增量（骨盆长得晚，孕期脂肪偏好堆在臀腿）
 */
export function computeBodyIncrements(input = {}) {
  const p = clamp(input.progress, 0, BODY_PROGRESS_MAX, 0);
  if (p <= 0) return { build: 0, bust: 0, hip: 0 };
  const alpha = clamp(input.alpha, -1, 1, 0);
  const drive = clamp(input.bulkDrive, 1, BULK_DRIVE_MAX, 1);
  const care = BUILD_CARE_FACTORS[input.care] ?? BUILD_CARE_FACTORS.normal;
  const health = clamp(input.averageHealthRatio, 0, 1, 0.5) * 100;
  const thinning = Math.max(0, alpha) * Math.max(0, 50 - health) * BUILD_THINNING_WEIGHT * p;
  const build = BUILD_GAIN_AT_TERM * getMaternalShare(alpha) * care * p - thinning;
  const bust = 10 * clamp(input.bustGain, 0, BUST_GAIN_MAX, BUST_GAIN_MEAN) * drive * p ** 0.7 + FAT_SPILL_BUST * build;
  const hip = 10 * clamp(input.hipGain, 0, HIP_GAIN_MAX, HIP_GAIN_MEAN) * drive * p ** 1.2 + FAT_SPILL_HIP * build;
  return { build: round(build, 2), bust: round(bust, 2), hip: round(hip, 2) };
}

/** 基准＋增量，夹在范围内（胸 0～150，其余 0～100） */
export function combineBody(baseline, increments = {}) {
  return {
    build: round(clamp(baseline.build + (Number(increments.build) || 0), 0, BODY_BASE_MAX, baseline.build), 2),
    bust: round(clamp(baseline.bust + (Number(increments.bust) || 0), 0, BUST_MAX, baseline.bust), 2),
    hip: round(clamp(baseline.hip + (Number(increments.hip) || 0), 0, BODY_BASE_MAX, baseline.hip), 2),
  };
}

/** 产后待回落的那一份：随恢复进度线性归零 */
export function decayPostpartumBody(remainder, recoveryProgress) {
  const left = 1 - clamp(recoveryProgress, 0, 1, 0);
  const value = remainder && typeof remainder === 'object' ? remainder : {};
  return {
    build: round((Number(value.build) || 0) * left, 2),
    bust: round((Number(value.bust) || 0) * left, 2),
    hip: round((Number(value.hip) || 0) * left, 2),
  };
}

/** 妊娠结束时拆成留存（加回基准）与回落（产后递减）两份 */
export function splitPregnancyEndIncrements(increments = {}) {
  const retained = {};
  const remainder = {};
  for (const key of ['build', 'bust', 'hip']) {
    const value = Number(increments[key]) || 0;
    retained[key] = round(value * BODY_RETENTION[key], 2);
    remainder[key] = round(value - retained[key], 2);
  }
  return { retained, remainder };
}

// ---- 体态（半人形、非人形）----

/**
 * 角色的体态（race_config 的 bodyPlan：humanoid 人形、hybrid 半人形、beast 非人形、any 形体不定），混血按血脉合并。
 * 身材都是「人类等效值」：半人形指人身上半部（或化人形时），形体不定指平常最常维持的形态；
 * 非人形没有罩杯与臀可言，只用体重比例。
 */
export function getBodyPlan(base = {}) {
  return getMergedRacePhysiologyProfile(String(base?.race || ''), base?.bloodline ?? null)?.bodyPlan || 'humanoid';
}

export function hasHumanFigure(base = {}) {
  return getBodyPlan(base) !== 'beast';
}

// ---- 文字刻度（不给百分比）----

const CUP_LETTERS = ['AAA', 'AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

export function getCupLabel(bust) {
  const index = Math.round(clamp(bust, 0, BUST_MAX, BODY_BASE_DEFAULTS.bust) / 10);
  return CUP_LETTERS[Math.max(0, Math.min(CUP_LETTERS.length - 1, index))];
}

/** 体重 × 活力：量由体重比例给，肉还是肌肉由活力等级给 */
export function getBuildText(build, vitalityLevel) {
  const value = clamp(build, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.build);
  const fit = clamp(vitalityLevel, 1, 7, 4) >= 5;
  const soft = clamp(vitalityLevel, 1, 7, 4) <= 3;
  if (value < 20) return fit ? '精瘦' : soft ? '纤弱' : '纤瘦';
  if (value < 40) return fit ? '精实' : soft ? '纤弱' : '偏瘦';
  if (value < 60) return fit ? '结实匀称' : soft ? '柔弱匀称' : '匀称';
  if (value < 80) return fit ? '壮硕' : soft ? '丰腴绵软' : '丰满';
  return fit ? '厚实壮硕' : soft ? '肥软' : '丰硕';
}

export function getHipText(hip) {
  const value = clamp(hip, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.hip);
  if (value < 25) return '窄';
  if (value < 45) return '偏窄';
  if (value < 60) return '适中';
  if (value < 80) return '丰满';
  return '宽大丰满';
}

/** 胸部比孕前大了多少（增量的罩杯数，四舍五入到半个） */
export function getBustGrowthText(increment) {
  const cups = Math.round((Number(increment) || 0) / 5) / 2;
  if (cups < 0.5) return '';
  return `比孕前大了约${cups}个罩杯`;
}

// ---- 衣柜算子（只改 outfit.pregFit.gap，不改孕肚大小与身体）----

/**
 * 显怀系数：同样的孕肚大小，多早藏不住。只乘在遮蔽那一维。
 * 高挑、结实、丰腴、大胸的人较晚显怀，瘦小、经产的人较早。夹 0.6～1.4。
 * input：{ sigma（同族标准差）, vitalityLevel, build, bust（当下，含孕期增量）, births }
 */
export function getShowingFactor(input = {}) {
  const sigma = clamp(input.sigma, -3, 3, 0);
  const level = clamp(input.vitalityLevel, 1, 7, 4);
  const build = clamp(input.build, 0, BODY_BASE_MAX, BODY_BASE_DEFAULTS.build);
  const bust = clamp(input.bust, 0, BUST_MAX, BODY_BASE_DEFAULTS.bust);
  const births = Math.max(0, Number(input.births) || 0);
  const height = -0.06 * sigma;
  const muscle = -0.05 * (level - 4);
  const weight = build < 40 ? 0.1 * ((40 - build) / 40) : build > 60 ? -0.2 * ((build - 60) / 40) : 0;
  const parity = Math.min(0.25, 0.1 * births);
  const chest = bust > 50 ? -Math.min(0.2, 0.03 * ((bust - 50) / 10)) : 0;
  return round(clamp(1 + height + muscle + weight + parity + chest, 0.6, 1.4, 1), 4);
}

/** 足月前人人都会藏不住：孕程 60%→100% 之间系数平滑收敛到 1 */
export function getShowingConvergence(effectivePregnantDays) {
  const x = clamp((clamp(effectivePregnantDays, 0, 99999, 0) / DUE_DATE_DAYS - 0.6) / 0.4, 0, 1, 0);
  return x * x * (3 - 2 * x);
}

export function getEffectiveShowingFactor(factor, effectivePregnantDays) {
  const t = getShowingConvergence(effectivePregnantDays);
  return round(clamp(factor, 0.6, 1.4, 1) * (1 - t) + t, 4);
}

/** 胸部孕期增量压承托：每长一个罩杯 −0.75，最多 −3（胸罩撑不住） */
export function getBustSupportPenalty(bustIncrement) {
  const cups = Math.max(0, Number(bustIncrement) || 0) / 10;
  return round(Math.min(3, 0.75 * cups), 2);
}
