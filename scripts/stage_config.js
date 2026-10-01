export const MENSTRUAL_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期']);

export const PREGNANCY_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期']);

export const LABOR_STAGES = Object.freeze(['第一产程', '第二产程', '第三产程']);

export const MENSTRUAL_STAGE_DAYS = Object.freeze({
  卵泡期: 9,
  排卵期: 2,
  黄体期: 12,
  月经期: 5,
});

/**
 * 产科孕日（从末次月经起算，受精当下已约 14 天），照《妇产科学》第 9 版：
 * 孕早期未满 14 周、孕中期 14～27 周 6 天、孕晚期 28 周起；
 * 再切出临产期 37～42 周（40 周＝预产期落在其中），满 42 周才算逾期（过期妊娠）
 */
export const PREGNANCY_STAGE_DAYS = Object.freeze({
  孕早期: 98,
  孕中期: 98,
  孕晚期: 63,
  临产期: 35,
});

/** 预产期（40 周）：胎儿成长、胎量与衣着压力的「足月＝1」都以它为准，不随临产期长度变动 */
export const DUE_DATE_DAYS = 280;

/** 足月起点（37 周）：临产期开始，宫压起自行累积 */
export const TERM_START_DAYS = PREGNANCY_STAGE_DAYS.孕早期 + PREGNANCY_STAGE_DAYS.孕中期 + PREGNANCY_STAGE_DAYS.孕晚期;

/** 逾期起点（42 周）：延产期的天数也从这里起算，跨多次延产连续计数 */
export const POSTTERM_START_DAYS = TERM_START_DAYS + PREGNANCY_STAGE_DAYS.临产期;

/**
 * 延产：逾期（或由逾期发动的产兆前驱）第一次延产延到 52 周，
 * 之后每次在延产期满进入的产兆前驱再延 28 天。延产期是「黏住」的阶段：
 * 有到期日（pregnant.extensionUntilDays）就一律是延产期，不再按孕日推算成逾期。
 */
/**
 * 妊娠速度（种族速度 × 特殊变速倍率）的上下界：最快 30 倍（约 9 天怀满），最慢 0.03 倍（约 25 年）。
 * 变速倍率另外允许 0，代表冻结；冻结不算在下界里。
 */
export const GESTATION_SPEED_MIN = 0.03;
export const GESTATION_SPEED_MAX = 30;

export const FIRST_EXTENSION_UNTIL_DAYS = 364;
export const EXTENSION_MONTH_DAYS = 28;

export const LABOR_STAGE_BASE_HOURS = Object.freeze({
  第一产程: 12,
  第二产程: 2,
  第三产程: 0.5,
});

export const LABOR_STAGE_INCREMENT = Object.freeze({
  第一产程: 1.5,
  第二产程: 2,
  第三产程: 0.5,
});

export const FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE = Object.freeze({
  reductionPerBirth: 0.15,
  maxCount: 3,
  minMultiplier: 0.55,
});

export const LABOR_POSTPARTUM_OBSERVATION_HOURS = 2;
