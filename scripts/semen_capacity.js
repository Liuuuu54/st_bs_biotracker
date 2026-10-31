// 子宫当下装得下多少精液。子宫图的液面、精液卡的「当前／最大」与时间推进、射精时的溢出共用这一套，
// 画面与引擎才不会各说各话。只读角色状态，不依赖绘图或工具模组。
import { LABOR_STAGES } from './stage_config.js';
import { getUterusVolumeFactor } from './body_size.js';
import { getCompanionEggBulk, getFetalBulkRatioByRace } from './race_config.js';

export const FULL_TERM_DAYS = 280;
export const EMPTY_STAGES = Object.freeze(['月经期', '乏情期', '卵泡期', '排卵期', '黄体期', '产后恢复', '假孕期']);
export const GESTATION_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '回归期', ...LABOR_STAGES]);

const SEMEN_CAPACITY_FLOOR = 25;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** 宫压分四级：平稳、上升、紧绷、颤动 */
export function getPressureLevel(ratio) {
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.4) return 1;
  return 0;
}

/** 未孕时的内膜厚度随阶段与阶段内进度变化 */
export function getEmptyLining(stage, progress) {
  const p = clamp(progress, 0, 1);
  const table = {
    月经期: Math.round(7 - 2 * p),
    乏情期: 5,
    卵泡期: 5 + Math.round(2 * p),
    排卵期: 7,
    黄体期: 7 + Math.round(p),
    产后恢复: 6 + Math.round(1 - p),
    假孕期: 6 + Math.round(2 * p),
  };
  return table[stage] ?? 6;
}

/**
 * 当下能装多少精液，以未孕、内膜一般（排卵期）为 100；受孕加成在总量 80 封顶，满了之后只剩画面。
 * - 未孕：内膜越厚越小，约 75～125。
 * - 假孕：荷尔蒙让内膜偏厚，85 → 75。
 * - 产后恢复：子宫虽大但满是恶露，可用空间只略多，120 → 100。
 * - 怀孕（浸满）：子宫容积 ×（1 − 佔满率）。子宫随孕程与胎重、胎数撑大；
 *   胎儿与羊膜囊佔去的比例随孕周上升，足月单胎约八成，多胎再多佔一些。足月单胎 1.0 刚好 100。
 * 宫压越高越小，最多七折。最后乘女方子宫容积倍率（人类 4 级为 1，每级翻倍）。
 */
export function getSemenCapacity({ gestating, emptyStage, emptyLining, emptyProgress, days, fetuses, pressureLevel, volumeFactor = 1 }) {
  const pressureFactor = 1 - 0.1 * clamp(finite(pressureLevel), 0, 3);
  let capacity;
  if (gestating && fetuses.length > 0) {
    const n = fetuses.length;
    const t = clamp(days / FULL_TERM_DAYS, 0, 1.25);
    const averageSize = fetuses.reduce((sum, fetus) => {
      const eggs = Math.max(0, Math.floor(finite(fetus?.companionEggCount)));
      return sum + clamp(finite(fetus?.weight, 1), 0.33, 3) * getFetalBulkRatioByRace(fetus?.race, fetus?.bloodline) + (eggs > 0 ? eggs * getCompanionEggBulk(fetus?.race, fetus?.bloodline) : 0);
    }, 0) / n;
    const stretch = Math.min(1.6, t * averageSize) ** 1.7 * (1 + 0.45 * (n - 1));
    const volume = 100 * (1 + 4 * stretch);
    const occupied = Math.min(0.95, 0.8 * Math.min(1, t) ** 1.5 + 0.05 * (n - 1) * t);
    capacity = volume * (1 - occupied);
  } else if (emptyStage === '假孕期') {
    capacity = 85 - 10 * clamp(emptyProgress, 0, 1);
  } else if (emptyStage === '产后恢复') {
    capacity = 120 - 20 * clamp(emptyProgress, 0, 1);
  } else {
    capacity = 100 - (finite(emptyLining, 7) - 7) * 12.5;
  }
  const volume = Number.isFinite(Number(volumeFactor)) && Number(volumeFactor) > 0 ? Number(volumeFactor) : 1;
  return Math.max(SEMEN_CAPACITY_FLOOR * volume, Math.round(capacity * pressureFactor) * volume);
}

/** 占着子宫的胎儿：已着床、没被包在别的胎儿体内的 */
export function getUterusOccupyingFetuses(profile) {
  const stage = String(profile?.base?.stage || '').trim();
  if (!GESTATION_STAGES.includes(stage)) return [];
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  return fetuses.filter((fetus) => fetus && !fetus.pendingImplantation && !(fetus.nestedInEmbryoId && !fetus.nestedReleased));
}

/**
 * 由角色状态直接算容量。pressureCap 是当下宫压上限，stageProgress 是阶段内进度（0–1）；
 * 两者由呼叫端提供（引擎与画面各自已有算法），这里不重算。
 */
export function getProfileSemenCapacity(profile, { pressureCap = 50, stageProgress = 0 } = {}) {
  const base = profile?.base || {};
  const stage = String(base.stage || '').trim();
  const gestating = GESTATION_STAGES.includes(stage);
  const emptyStage = !gestating && EMPTY_STAGES.includes(stage) ? stage : null;
  const emptyProgress = clamp(finite(stageProgress), 0, 1);
  const pressureRatio = clamp(finite(base.uterinePressure) / Math.max(1, finite(pressureCap, 50)), 0, 1);
  return getSemenCapacity({
    gestating,
    emptyStage,
    emptyLining: emptyStage ? getEmptyLining(emptyStage, emptyProgress) : 7,
    emptyProgress,
    days: gestating ? Math.max(0, finite(profile?.pregnant?.effectivePregnantDays)) : 0,
    fetuses: getUterusOccupyingFetuses(profile),
    pressureLevel: getPressureLevel(pressureRatio),
    volumeFactor: getUterusVolumeFactor(base),
  });
}
