// 胎儿健康（1.3.0）：每胎一条量表与胎儿事件堆。
//
// 量表：每胎上限一律 100。受精时的初始值 = 50 × 精子品质^0.25 × 受孕时机系数 × 天生变异，夹在 35～70（一律从平稳起步）。
// 当前值吃两个来源：母体需求照料的加减分（tools.js 按孕龄与位置分给各胎）与胎儿事件（bsFetalEvent）。
// 每跨一个周结算：先按当下健康换算胎重、检查见底，再往 50 拉回两成（周回归；产前护理用心或疏忽时改往 60 或 35），
// 所以长时间没人照料也没人疏忽，会收敛到「平稳」，不会饿死。
//
// 事件堆比照认知纪录：每次妊娠保存上限条，超过时最旧、没钉选的并进摘要；送给追踪模型的只有窗口。
import { CONCEPTION_WEIGHT_LOG_SD, getConceptionStageWeight } from './body_size.js';
import { getMergedRacePhysiologyProfile } from './race_config.js';

export const FETAL_HEALTH_BASE = 100;
export const FETAL_HEALTH_INITIAL_RATIO = 0.5;
/** 每个孕周往上限一半拉回的比例 */
export const FETAL_HEALTH_REVERSION = 0.2;
/** 胎重换算：每周 Δ = (健康比例 − 0.5) × 斜率 × 孕速，封顶 ±上限 × 孕速 */
export const FETAL_HEALTH_WEIGHT_SLOPE = 0.06;
export const FETAL_HEALTH_WEEKLY_WEIGHT_CAP = 0.03;
/** 见底门槛：周结算时 ≤ 上限的 10% 先警告，下一次周结算仍见底才中断 */
export const FETAL_HEALTH_BOTTOM_RATIO = 0.1;
/** 搶救缓冲：警告之后至少过这么多日历天，见底才会中断（快孕物种一个孕周只有几小时，剧情要来得及救） */
export const FETAL_HEALTH_RESCUE_DAYS = 1;
/** 流产免疫或无法中断的阶段：见底也只停在 1% */
export const FETAL_HEALTH_FLOOR_RATIO = 0.01;
/**
 * 需求照料点数换成健康的比例（再乘孕速）。用真实引擎校准：
 * 照料良好一周约 +10 点，换算后单胎足月胎重与 1.2.4 相近；
 * 完全不管一周约 −24 点，约 4 个孕周见底。扣分比加分重，是「疏于照料会出事」的设计。
 */
export const FETAL_CARE_GAIN_SCALE = 0.18;
export const FETAL_CARE_LOSS_SCALE = 0.9;
/** 单次时间推进里，停在「爆」的扣分最多算 7 天份：长时间跳过代表镜头外照常生活 */
export const FETAL_BURST_MAX_DAYS_PER_PASS = 7;

const MAX_SD_LIMIT = 3;
const MINUTES_PER_DAY = 1440;

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 与 tools.js 的抽样同一写法：测试常把 Math.random 固定成 0，不能用重抽的回圈 */
function standardNormal(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 受孕时机系数：0.5 ＋ 0.5 × 旧的胎重阶段系数（乏情 0.8、月经 0.875、卵泡 0.95、排卵 1、黄体 1.05） */
export function getConceptionTimingFactor(stage) {
  return round(0.5 + 0.5 * getConceptionStageWeight(stage), 4);
}

/** 初始健康的范围：一律落在平稳，先天底子靠周回归慢慢淡掉，长期的差别交给顽强度 */
export const FETAL_HEALTH_INITIAL_MIN = 35;
export const FETAL_HEALTH_INITIAL_MAX = 70;

/** 受精时抽初始健康；quality 是射精当下的精子品质快照 */
export function sampleFetalInitialHealth({ quality = 1, stage = '排卵期', random = Math.random } = {}) {
  const q = clamp(quality, 0.25, 4, 1);
  const z = Math.max(-MAX_SD_LIMIT, Math.min(MAX_SD_LIMIT, standardNormal(random)));
  const value = FETAL_HEALTH_BASE * FETAL_HEALTH_INITIAL_RATIO * q ** 0.25 * getConceptionTimingFactor(stage) * Math.exp(CONCEPTION_WEIGHT_LOG_SD * z);
  return round(clamp(value, FETAL_HEALTH_INITIAL_MIN, FETAL_HEALTH_INITIAL_MAX, FETAL_HEALTH_BASE * FETAL_HEALTH_INITIAL_RATIO), 1);
}

/** 新胎儿的量表栏位 */
export function createFetalHealthFields(initial) {
  return { health: round(clamp(initial, 0, FETAL_HEALTH_BASE, FETAL_HEALTH_BASE * FETAL_HEALTH_INITIAL_RATIO), 2) };
}

/**
 * 补齐与正规化量表栏位（就地修改）。旧胎儿（1.2.4 以前）的 nutrition 是本周供养池：
 * 当前值 = 50 ＋ 池 × 照料换算比例。1.3.0 开发期间各胎上限不同（healthMax），按比例换算成 100 分制。
 */
export function normalizeFetalHealthFields(fetus) {
  if (!fetus || typeof fetus !== 'object') return fetus;
  const max = FETAL_HEALTH_BASE;
  if (!Number.isFinite(Number(fetus.health))) {
    const pool = Number(fetus.nutrition) || 0;
    const scale = pool >= 0 ? FETAL_CARE_GAIN_SCALE : FETAL_CARE_LOSS_SCALE;
    fetus.health = round(max * FETAL_HEALTH_INITIAL_RATIO + pool * scale, 2);
  } else if ('healthMax' in fetus) {
    const oldMax = clamp(fetus.healthMax, 1, 1000, max);
    fetus.health = round(Number(fetus.health) / oldMax * max, 2);
  }
  delete fetus.healthMax;
  fetus.health = round(clamp(fetus.health, 0, max, max * FETAL_HEALTH_INITIAL_RATIO), 2);
  delete fetus.nutrition;
  if (fetus.healthWarned !== true) {
    delete fetus.healthWarned;
    delete fetus.healthWarnedAt;
  }
  if (fetus.healthCollapsed !== true) delete fetus.healthCollapsed;
  return fetus;
}

/**
 * 耐受系数：乘在疏忽扣分与伤害事件上（照料加分不乘），越小越耐，总值夹在 0.2～2.5。
 * = 母体体质（活力等级 1～7）× 胎儿顽强度（精子品质 × 胎儿族繁育耐受 × 核型）。
 * 挺着肚子冒险的强壮母体、打不掉的魔丸与孽种。7 级 × 品质 4 的人类胎是 ×0.25：
 * 完全不处理需求也只停在三成左右，不会见底。
 * 母体自己的繁育耐受不进这里：它已经管胎儿负担（需求涨多快），再乘一次就是重复计算；
 * 胎儿那一族的耐受只管这一胎本身强不强。
 */
export const MATERNAL_RESILIENCE_BY_VITALITY_LEVEL = Object.freeze({ 1: 1.5, 2: 1.3, 3: 1.15, 4: 1, 5: 0.85, 6: 0.7, 7: 0.5 });

export function getMaternalResilience(vitalityLevel) {
  return MATERNAL_RESILIENCE_BY_VITALITY_LEVEL[Math.round(clamp(vitalityLevel, 1, 7, 4))];
}

export const FETAL_HARM_FACTOR_MIN = 0.2;
export const FETAL_HARM_FACTOR_MAX = 2.5;
/** 核型：雄核发生（孽种，父方核型压过母体）较顽强，雌核发生（只承母系）较脆弱 */
export const FETAL_NUCLEUS_TENACITY = Object.freeze({ androgenesis: 0.75, gynogenesis: 1.33 });

/** 精子品质：受孕时的快照（fetus.spermQuality，没有就当 1）^−0.5，夹在 0.5～1.5 */
export function getFetusQualityTenacity(fetus) {
  return clamp(clamp(fetus?.spermQuality, 0.25, 4, 1) ** -0.5, 0.5, 1.5, 1);
}

/** 胎儿族：按胎儿自己的种族与血脉（核型已决定它随谁、混血取平均）的繁育耐受^−0.3，夹在 0.6～1.4 */
export function getFetusSpeciesTenacity(fetus) {
  const tolerance = getMergedRacePhysiologyProfile(String(fetus?.race || ''), fetus?.bloodline ?? null)?.breedTolerance;
  return round(clamp(clamp(tolerance, 0.01, 100, 1) ** -0.3, 0.6, 1.4, 1), 4);
}

export function getFetusNucleusTenacity(fetus) {
  const tags = Array.isArray(fetus?.tags) ? fetus.tags : [];
  const andro = tags.includes('androgenesis');
  const gyno = tags.includes('gynogenesis');
  // 嵌合胎两种核型都有时互相抵消，当一般
  if (andro && !gyno) return FETAL_NUCLEUS_TENACITY.androgenesis;
  if (gyno && !andro) return FETAL_NUCLEUS_TENACITY.gynogenesis;
  return 1;
}

/** 胎儿顽强度 = 精子品质 × 胎儿族 × 核型 */
export function getFetusTenacity(fetus) {
  return getFetusQualityTenacity(fetus) * getFetusSpeciesTenacity(fetus) * getFetusNucleusTenacity(fetus);
}

/** 分项（追踪页提示用）：maternal、quality、species、nucleus 与夹值后的 factor */
export function getFetalHarmBreakdown(profile, fetus) {
  const maternal = getMaternalResilience(profile?.base?.vitalityLevel);
  const quality = getFetusQualityTenacity(fetus);
  const species = getFetusSpeciesTenacity(fetus);
  const nucleus = getFetusNucleusTenacity(fetus);
  const factor = round(clamp(maternal * quality * species * nucleus, FETAL_HARM_FACTOR_MIN, FETAL_HARM_FACTOR_MAX, 1), 4);
  return { maternal, quality: round(quality, 4), species, nucleus, factor };
}

export function getFetalHarmFactor(profile, fetus) {
  return getFetalHarmBreakdown(profile, fetus).factor;
}

/**
 * 胎儿守护（精方作弊）：父方在场时每小时回复上限的 2%，只回到一半（平稳）为止。
 * 只保命、不加速长大：健康一半时胎重照标准曲线长。高于一半时不动。
 */
export const FETAL_GUARD_REGEN_PER_HOUR = 0.02;

export function applyFetalGuardRegen(fetus, hours) {
  const max = FETAL_HEALTH_BASE;
  const half = max * FETAL_HEALTH_INITIAL_RATIO;
  const health = clamp(fetus?.health, 0, max, half);
  if (!(Number(hours) > 0) || health >= half) return 0;
  fetus.health = round(Math.min(half, health + max * FETAL_GUARD_REGEN_PER_HOUR * Number(hours)), 4);
  return fetus.health - health;
}

/** 给模型看的文字：只在明显偏离时给（顽强／脆弱），一般不送 */
export function describeFetalResilience(factor) {
  if (factor <= 0.6) return '顽强';
  if (factor >= 1.3) return '脆弱';
  return '';
}

export function getFetalHealthRatio(fetus) {
  const max = FETAL_HEALTH_BASE;
  return clamp(Number(fetus?.health) / max, 0, 1, FETAL_HEALTH_INITIAL_RATIO);
}

export const FETAL_HEALTH_TIERS = Object.freeze([
  { key: 'strong', label: '健壮', min: 0.75 },
  { key: 'stable', label: '平稳', min: 0.4 },
  { key: 'weak', label: '虚弱', min: FETAL_HEALTH_BOTTOM_RATIO + 1e-9 },
  { key: 'critical', label: '危急', min: -Infinity },
]);

export function getFetalHealthTier(fetus) {
  const ratio = getFetalHealthRatio(fetus);
  return FETAL_HEALTH_TIERS.find((tier) => ratio >= tier.min) || FETAL_HEALTH_TIERS.at(-1);
}

/** 把照料点数加到一胎；扣到 0 为止、加到 100 为止 */
export function addFetalHealth(fetus, amount) {
  const max = FETAL_HEALTH_BASE;
  const before = clamp(fetus?.health, 0, max, max * FETAL_HEALTH_INITIAL_RATIO);
  fetus.health = round(clamp(before + amount, 0, max, before), 4);
  return fetus.health - before;
}

/**
 * 产前护理：角色知道（或相信）自己怀孕后，整体怎么养胎——饮食、作息、休养、产检的日常习惯。
 * 由模型照剧情用 bsRecordExperience（cognition 附 prenatalCare）设定，跟着这次妊娠，妊娠结束时清掉；
 * 没设定（包括还不知道怀孕）一律当一般。它只改周回归往哪里拉：镜头外的长时间推进也照这个养，
 * 单独作用不会让胎儿见底，也没有点数可刷；需求照料与胎儿事件照常叠在上面。
 * 用真实引擎校准（人类单胎、需求不计分，逐日或一次跳 60 天结果相同）：足月胎重疏忽约 0.77、一般 1、用心约 1.19，
 * 与「需求拖到满才处理」约 0.8、「一到高就处理」约 1.2 同一个量级。
 */
export const PRENATAL_CARE_LEVELS = Object.freeze({
  neglect: { label: '疏忽', target: 35 },
  normal: { label: '一般', target: 50 },
  attentive: { label: '用心', target: 60 },
});

export function getPrenatalCareKey(pregnant) {
  const key = pregnant?.prenatalCare;
  return typeof key === 'string' && Object.hasOwn(PRENATAL_CARE_LEVELS, key) ? key : 'normal';
}

export function getPrenatalCareTarget(pregnant) {
  return PRENATAL_CARE_LEVELS[getPrenatalCareKey(pregnant)].target;
}

/**
 * 一次周结算（一个孕周，所有物种同一把尺）。顺序：按这一周累积的健康换算胎重 → 见底检查 → 周回归。
 * at 是这次结算当下的妊娠日历天数（pregnantDays），用来量搶救缓冲：警告之后要过满 1 个日历天，
 * 下一次结算仍见底才中断。target 是周回归的目标（产前护理决定，一般为 50）。
 * 回传 'warned'（刚见底）、'collapsed'（待中断）或 ''。
 */
export function settleFetalHealthWeek(fetus, { at = null, target = FETAL_HEALTH_BASE * FETAL_HEALTH_INITIAL_RATIO } = {}) {
  const max = FETAL_HEALTH_BASE;
  const health = clamp(fetus?.health, 0, max, max * FETAL_HEALTH_INITIAL_RATIO);
  const cap = FETAL_HEALTH_WEEKLY_WEIGHT_CAP;
  const delta = clamp((health / max - 0.5) * FETAL_HEALTH_WEIGHT_SLOPE, -cap, cap, 0);
  // 以指数换算：亏空再深也只会逐步变小，不会跌穿成负值
  fetus.weight = clamp((Number(fetus.weight) || 1) * Math.exp(delta), 0.33, 3.0, 1);
  const now = Number.isFinite(Number(at)) && at !== null ? Number(at) : null;
  let outcome = '';
  if (health <= max * FETAL_HEALTH_BOTTOM_RATIO) {
    if (fetus.healthWarned) {
      const since = Number(fetus.healthWarnedAt);
      // 旧资料没有警告时刻、或拿不到时刻时不卡缓冲
      if (now === null || !Number.isFinite(since) || now - since >= FETAL_HEALTH_RESCUE_DAYS - 1e-9) {
        fetus.healthCollapsed = true;
        outcome = 'collapsed';
      }
    } else {
      fetus.healthWarned = true;
      if (now !== null) fetus.healthWarnedAt = round(now, 4);
      outcome = 'warned';
    }
  } else {
    delete fetus.healthWarned;
    delete fetus.healthWarnedAt;
    delete fetus.healthCollapsed;
  }
  const goal = clamp(target, 0, max, max * FETAL_HEALTH_INITIAL_RATIO);
  fetus.health = round(health + (goal - health) * FETAL_HEALTH_REVERSION, 4);
  return outcome;
}

// ───────────────────────── 胎儿事件 ─────────────────────────

// 亲和与健康同一个做法：类别决定方向（亲近＋、疏离－；伤害－、照料＋），change 只看程度
export const FETAL_EVENT_KINDS = Object.freeze({
  bonding: { group: 'affinity', label: '母胎亲近', sign: 1 },
  estrangement: { group: 'affinity', label: '母胎疏离', sign: -1 },
  substance: { group: 'harm', label: '有害物质', sensitivity: 'toxic' },
  trauma: { group: 'harm', label: '腹部外伤', sensitivity: 'physical', pressure: true },
  overexertion: { group: 'harm', label: '过劳或剧烈运动', sensitivity: 'physical', pressure: true },
  illness: { group: 'harm', label: '生病发烧', sensitivity: 'toxic' },
  curse: { group: 'harm', label: '诅咒或腐化', sensitivity: 'toxic' },
  other_harm: { group: 'harm', label: '其他伤害' },
  medicine: { group: 'care', label: '安胎药或补品' },
  checkup: { group: 'care', label: '产检治疗' },
  rest: { group: 'care', label: '充分休养' },
  blessing: { group: 'care', label: '祝福或治疗魔法' },
  other_care: { group: 'care', label: '其他照料' },
});

export const FETAL_EVENT_CHANGES = Object.freeze([
  'slight_increase', 'significant_increase', 'severe_increase',
  'slight_decrease', 'significant_decrease', 'severe_decrease',
]);

const CHANGE_LABELS = Object.freeze({
  slight_increase: '轻微增加', significant_increase: '明显增加', severe_increase: '大幅增加',
  slight_decrease: '轻微减少', significant_decrease: '明显减少', severe_decrease: '大幅减少',
});
const MAGNITUDE_LABELS = Object.freeze({ slight: '轻微', significant: '明显', severe: '严重' });

/** 健康变化（上限一律 100）；严重一次约等于疏于照料一周 */
export const FETAL_EVENT_HEALTH = Object.freeze({ slight: 3, significant: 8, severe: 18 });
export const FETAL_EVENT_AFFINITY = Object.freeze({ slight: 0.5, significant: 1, severe: 2 });
/** 外伤、过劳另加宫压 */
export const FETAL_EVENT_PRESSURE = Object.freeze({ slight: 3, significant: 8, severe: 15 });
/** 每胎每个故事日的上限 */
export const FETAL_EVENT_DAILY_AFFINITY_CAP = 2;
export const FETAL_EVENT_DAILY_CARE_CAP = 10;
/** 亲和与正面健康事件：同一 kind 在最近 7 天内的第 n 次 × 1/(1+n) */
export const FETAL_EVENT_DECAY_DAYS = 7;
/** 孕中孕被包着的那一胎，健康事件减半 */
export const FETAL_EVENT_NESTED_FACTOR = 0.5;

const SENSITIVITY = Object.freeze({
  toxic: { early: 1.5, mid: 1, late: 0.7 },
  physical: { early: 0.7, mid: 1, late: 1.3 },
});

export function getChangeMagnitude(change) {
  const key = String(change || '').split('_')[0];
  return Object.hasOwn(FETAL_EVENT_HEALTH, key) ? key : '';
}

export function getChangeSign(change) {
  return String(change || '').endsWith('_decrease') ? -1 : 1;
}

export function describeFetalEventChange(change) {
  return CHANGE_LABELS[change] || '';
}

export function describeFetalEventMagnitude(change) {
  return MAGNITUDE_LABELS[getChangeMagnitude(change)] || '';
}

/** 孕期分段：孕早期最敏感于毒物，孕晚期起（含产兆前驱、产程、延产期）最怕外伤 */
export function getFetalEventPhase(stage) {
  const text = String(stage || '');
  if (text === '孕早期') return 'early';
  if (text === '孕中期' || text === '回归期') return 'mid';
  return 'late';
}

export function getFetalEventSensitivity(kind, stage) {
  const table = SENSITIVITY[FETAL_EVENT_KINDS[kind]?.sensitivity];
  return table ? table[getFetalEventPhase(stage)] : 1;
}

export function getStoryDayIndex(minutesPassed) {
  return Math.floor(Math.max(0, Number(minutesPassed) || 0) / MINUTES_PER_DAY);
}

// ───────────────────────── 纪录堆：上限、钉选、窗口 ─────────────────────────

export const RECORD_LIMIT_DEFAULTS = Object.freeze({
  fetalEventCap: 30,
  fetalEventWindow: 5,
  cognitionCap: 40,
  cognitionWindow: 8,
  recordPinCap: 5,
});

export const RECORD_LIMIT_RANGES = Object.freeze({
  fetalEventCap: [10, 200],
  fetalEventWindow: [0, 30],
  cognitionCap: [10, 200],
  cognitionWindow: [0, 30],
  recordPinCap: [0, 10],
});

export function normalizeRecordLimits(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(RECORD_LIMIT_DEFAULTS)) {
    const [min, max] = RECORD_LIMIT_RANGES[key];
    result[key] = Math.round(clamp(value?.[key], min, max, fallback));
  }
  return result;
}

/**
 * 压缩纪录堆（就地修改 list，回传更新后的摘要）：
 * 钉选超过上限时保留最新的；超过保存上限时最旧、没钉选的并进摘要（全都钉选时并最旧的）。
 * keep(item) 为真的不并：胎儿事件的防洗分（同日一次、7 天递减、每日上限）要看原始纪录，
 * 近 7 天的一律留着，记得太密时暂时超过上限。
 * window 与 batch：送出窗口外（不在最近 window 条、没钉选、不必保留）的条目累积到 batch 条，就整批并进摘要，
 * 模型看不到内容、只剩次数的条目最多 batch − 1 条。保存上限照样是硬上限。
 */
export function compactRecordPile(list, summary, { cap, pinCap, keep = () => false, window = null, batch = 0 }, fold) {
  if (!Array.isArray(list)) return summary || null;
  const pinned = list.filter((item) => item?.pin === true);
  for (const item of pinned.slice(0, Math.max(0, pinned.length - pinCap))) delete item.pin;
  let next = summary || null;
  if (window !== null && batch > 0) {
    const tail = new Set(window > 0 ? list.slice(-window) : []);
    const outside = list.filter((item) => !tail.has(item) && item?.pin !== true && !keep(item));
    if (outside.length >= batch) {
      for (const item of outside) {
        list.splice(list.indexOf(item), 1);
        next = fold(next, item);
      }
    }
  }
  while (list.length > cap) {
    let index = list.findIndex((item) => item?.pin !== true && !keep(item));
    if (index < 0) index = list.findIndex((item) => !keep(item));
    if (index < 0) break;
    const [removed] = list.splice(index, 1);
    next = fold(next, removed);
  }
  return next;
}

/**
 * 并进摘要的纪录先排进 pending，追踪结束时由整理请求（record_notes.js）连同旧的 notes 改写成新的 notes。
 * 整理失败就留着下次再送；一直失败时只留最新的这么多条（次数统计照样完整）。
 */
export const RECORD_NOTES_PENDING_CAP = 40;
/** 窗口外累积到这么多条就整批并进摘要、整理一次要点 */
export const RECORD_NOTES_BATCH = 5;
/** 整理出来的要点字数上限（超过的截断） */
export const RECORD_NOTES_MAX_CHARS = 300;

function appendPending(summary, item) {
  return [...(Array.isArray(summary?.pending) ? summary.pending : []), item].slice(-RECORD_NOTES_PENDING_CAP);
}

/** 要点接在机械摘要后面；没整理过就只有次数与日期 */
function withNotes(line, notes) {
  const text = typeof notes === 'string' ? notes.trim() : '';
  return text ? `${line}。要点：${text}` : line;
}

/** 窗口：最近 recent 条，加上所有钉选，按时间先后；其余（含已并进摘要的）只在摘要行出现 */
export function selectRecordWindow(list, recent) {
  const items = Array.isArray(list) ? list : [];
  const tail = new Set(recent > 0 ? items.slice(-recent) : []);
  const shown = items.filter((item) => tail.has(item) || item?.pin === true);
  const hidden = items.filter((item) => !shown.includes(item));
  return { shown, hidden };
}

function spanText(from, to) {
  if (!from && !to) return '';
  return from === to || !to ? `（${from}）` : `（${from}～${to}）`;
}

function countText(counts, labelOf) {
  return Object.entries(counts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${labelOf(key)}${count}`)
    .join('、');
}

// ───────────────────────── 胎儿事件堆 ─────────────────────────

/**
 * 1.3.0 开发期间用过的亲和类别：soothe（母体安抚，系统抽方向）与 fetal_reaction（胎儿亲近或排斥）。
 * 读到时按方向换成亲近或疏离（没有方向的当亲近），纪录不丢。
 */
const LEGACY_AFFINITY_KINDS = new Set(['soothe', 'fetal_reaction']);

function migrateLegacyAffinityEvent(item) {
  if (!item || typeof item !== 'object' || !LEGACY_AFFINITY_KINDS.has(item.kind)) return item;
  const { failed: _failed, ...rest } = item;
  return { ...rest, kind: String(item.change || '').endsWith('_decrease') ? 'estrangement' : 'bonding' };
}

export function normalizeFetalEventList(value) {
  return (Array.isArray(value) ? value : []).map(migrateLegacyAffinityEvent).filter((item) => item && typeof item === 'object'
    && Object.hasOwn(FETAL_EVENT_KINDS, item.kind) && typeof item.time === 'string' && item.time.trim()
    && typeof item.content === 'string' && item.content.trim());
}

function emptyEventSummary() {
  return { count: 0, kinds: {}, from: '', to: '', byEmbryo: {} };
}

/** 一条事件对某胎的效果；没有效果（被防洗分挡下）的不算次数 */
function eventEffectOn(event, embryoId) {
  return event?.effects?.[embryoId] || null;
}

function foldEmbryoTally(tally, event, embryoId) {
  const effect = eventEffectOn(event, embryoId);
  if (!effect || event.counted === false) return tally;
  const group = FETAL_EVENT_KINDS[event.kind]?.group;
  const next = { harm: 0, care: 0, ...(tally || {}) };
  if (group === 'harm' && Number(effect.health) < 0) {
    next.harm += 1;
    if (!next.worst || Number(effect.health) < Number(next.worst.health)) {
      next.worst = { kind: event.kind, content: event.content, health: Number(effect.health) };
    }
  }
  if (group === 'care' && Number(effect.health) > 0) next.care += 1;
  return next;
}

export function foldFetalEventIntoSummary(summary, event) {
  const next = summary && typeof summary === 'object' ? { ...emptyEventSummary(), ...summary } : emptyEventSummary();
  next.count += 1;
  next.kinds = { ...next.kinds, [event.kind]: (Number(next.kinds?.[event.kind]) || 0) + 1 };
  if (!next.from) next.from = event.time;
  next.to = event.time;
  next.byEmbryo = { ...next.byEmbryo };
  for (const id of Object.keys(event?.effects || {})) next.byEmbryo[id] = foldEmbryoTally(next.byEmbryo[id], event, id);
  next.pending = appendPending(next, {
    time: event.time, kind: event.kind, ...(event.change ? { change: event.change } : {}),
    scope: event.scope, embryoIds: Array.isArray(event.embryoIds) ? event.embryoIds : [], content: event.content,
  });
  return next;
}

/** minutesPassed：当下的聊天分钟数；近 7 天（递减窗口）的事件不并进摘要 */
export function compactFetalEvents(pregnant, limits, minutesPassed = null) {
  const { fetalEventCap, fetalEventWindow, recordPinCap } = normalizeRecordLimits(limits);
  pregnant.fetalEvents = normalizeFetalEventList(pregnant.fetalEvents);
  const since = minutesPassed !== null && Number.isFinite(Number(minutesPassed))
    ? Number(minutesPassed) - FETAL_EVENT_DECAY_DAYS * 1440 : null;
  const keep = since === null ? () => false : (event) => Number(event?.minutesPassed) > since;
  pregnant.fetalEventSummary = compactRecordPile(pregnant.fetalEvents, pregnant.fetalEventSummary || null,
    { cap: fetalEventCap, pinCap: recordPinCap, keep, window: fetalEventWindow, batch: RECORD_NOTES_BATCH }, foldFetalEventIntoSummary);
  if (!pregnant.fetalEventSummary) delete pregnant.fetalEventSummary;
}

/** 事件的对象文字：全部胎儿写「全部」，其余按角色已知的编号（visibleFetuses 是已知的胎儿，依阵列顺序） */
export function labelFetalEventTarget(event, visibleFetuses = []) {
  if (event?.scope === 'all') return '全部';
  const ids = Array.isArray(event?.embryoIds) ? event.embryoIds : [];
  const labels = ids.map((id) => visibleFetuses.findIndex((fetus) => fetus?.embryoId === id))
    .map((index) => (index >= 0 ? `第${index + 1}胎` : '已不在的胎儿'));
  return labels.join('、') || '胎儿';
}

/** 出生时孩子身上只留摘要：伤害几次、照料几次、最严重的一件、出生时的健康比例（压缩过的部分也算进去） */
export function buildPrenatalSummary(pregnant, fetus) {
  const id = String(fetus?.embryoId ?? '');
  let tally = pregnant?.fetalEventSummary?.byEmbryo?.[id] || null;
  for (const event of normalizeFetalEventList(pregnant?.fetalEvents)) tally = foldEmbryoTally(tally, event, id);
  return {
    harm: Number(tally?.harm) || 0,
    care: Number(tally?.care) || 0,
    worst: tally?.worst ? { kind: tally.worst.kind, content: tally.worst.content } : null,
    birthHealthRatio: round(getFetalHealthRatio(fetus), 2),
  };
}

export function describeFetalEventKind(kind) {
  return FETAL_EVENT_KINDS[kind]?.label || kind;
}

/**
 * 送给追踪模型的事件窗口。labelFetuses(event) 回传「第1胎」「全部」之类的对象文字（只用角色已知的编号）。
 * 回传 { events, earlier, countedToday } 或 null（没有任何事件）。
 */
export function buildFetalEventWindow(pregnant, limits, { minutesPassed = 0, labelFetuses = () => '' } = {}) {
  const { fetalEventWindow } = normalizeRecordLimits(limits);
  const list = normalizeFetalEventList(pregnant?.fetalEvents);
  const summary = pregnant?.fetalEventSummary;
  if (list.length === 0 && !(summary?.count > 0)) return null;
  const { shown, hidden } = selectRecordWindow(list, fetalEventWindow);
  const events = shown.map((event) => ({
    time: event.time,
    kind: event.kind,
    ...(event.change ? { change: event.change } : {}),
    target: labelFetuses(event),
    content: event.content,
    ...(event.pin ? { pin: true } : {}),
    ...(event.counted === false ? { counted: false } : {}),
  }));
  let earlier = summary && summary.count > 0 ? { ...summary } : null;
  for (const event of hidden) earlier = foldFetalEventIntoSummary(earlier, event);
  const today = getStoryDayIndex(minutesPassed);
  const countedToday = [...new Set(list
    .filter((event) => event.counted !== false && Number(event.storyDayIndex) === today)
    .map((event) => event.kind))];
  return {
    events,
    ...(earlier ? { earlier: withNotes(`更早 ${earlier.count} 条：${countText(earlier.kinds, describeFetalEventKind)}${spanText(earlier.from, earlier.to)}`, summary?.notes) } : {}),
    ...(countedToday.length ? { countedToday } : {}),
  };
}

// ───────────────────────── 认知纪录 ─────────────────────────

export const COGNITION_METHOD_LABELS = Object.freeze({
  perception: '亲历／自觉', guess: '猜测／自算', informed: '被告知', test: '检测', prenatal: '诊察', experience: '经历／心境',
});

export function foldCognitionIntoSummary(summary, record) {
  const next = summary && typeof summary === 'object' ? { count: 0, methods: {}, from: '', to: '', ...summary } : { count: 0, methods: {}, from: '', to: '' };
  next.count += 1;
  next.methods = { ...next.methods, [record.method]: (Number(next.methods?.[record.method]) || 0) + 1 };
  if (!next.from) next.from = record.time;
  next.to = record.time;
  next.pending = appendPending(next, { time: record.time, method: record.method, content: record.content });
  return next;
}

/** 认知纪录堆压缩（profile 就地修改） */
export function compactCognitionRecords(profile, limits) {
  const { cognitionCap, cognitionWindow, recordPinCap } = normalizeRecordLimits(limits);
  if (!Array.isArray(profile.cognitionRecords)) profile.cognitionRecords = [];
  profile.cognitionSummary = compactRecordPile(profile.cognitionRecords, profile.cognitionSummary || null,
    { cap: cognitionCap, pinCap: recordPinCap, window: cognitionWindow, batch: RECORD_NOTES_BATCH }, foldCognitionIntoSummary);
  if (!profile.cognitionSummary) delete profile.cognitionSummary;
}

/** 送出窗口：最近几条加钉选；更早的给一行摘要：次数与日期，整理过的再附要点（照角色的理解写，不更正成事实） */
export function buildCognitionWindow(records, summary, limits) {
  const { cognitionWindow } = normalizeRecordLimits(limits);
  const { shown, hidden } = selectRecordWindow(Array.isArray(records) ? records : [], cognitionWindow);
  let earlier = summary && summary.count > 0 ? { ...summary } : null;
  for (const record of hidden) earlier = foldCognitionIntoSummary(earlier, record);
  return {
    records: shown,
    earlier: earlier
      ? withNotes(`更早 ${earlier.count} 条：${countText(earlier.methods, (key) => COGNITION_METHOD_LABELS[key] || key)}${spanText(earlier.from, earlier.to)}`, summary?.notes)
      : '',
  };
}

/** 认知纪录摘要（已并进摘要的部分）的一行文字，追踪页用；没有就回空字串 */
export function describeCognitionSummary(summary) {
  if (!summary || !(summary.count > 0)) return '';
  return withNotes(`更早 ${summary.count} 条：${countText(summary.methods, (key) => COGNITION_METHOD_LABELS[key] || key)}${spanText(summary.from, summary.to)}`, summary.notes);
}

/** 事件堆摘要（已并进摘要的部分）的一行文字；没有就回空字串 */
export function describeFetalEventSummary(summary) {
  if (!summary || !(summary.count > 0)) return '';
  return withNotes(`更早 ${summary.count} 条：${countText(summary.kinds, describeFetalEventKind)}${spanText(summary.from, summary.to)}`, summary.notes);
}

/** 孩子身上的孕期摘要，给族谱与注册页看 */
export function describePrenatalSummary(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const parts = [`受伤害 ${Number(summary.harm) || 0} 次`, `受照料 ${Number(summary.care) || 0} 次`];
  if (summary.worst?.kind) parts.push(`最重的一次：${describeFetalEventKind(summary.worst.kind)}${summary.worst.content ? `（${summary.worst.content}）` : ''}`);
  if (Number.isFinite(Number(summary.birthHealthRatio))) parts.push(`出生时健康 ${Math.round(Number(summary.birthHealthRatio) * 100)}%`);
  return parts.join('，');
}
