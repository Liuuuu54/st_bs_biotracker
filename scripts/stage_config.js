export const MENSTRUAL_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期']);

export const PREGNANCY_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期']);

export const LABOR_STAGES = Object.freeze(['第一产程', '第二产程', '第三产程']);

export const MENSTRUAL_STAGE_DAYS = Object.freeze({
  卵泡期: 9,
  排卵期: 2,
  黄体期: 12,
  月经期: 5,
});

/**
 * 产科孕日（从末次月经起算，受精当下已约 14 天）：孕早期到 12 周末、孕中期到 28 周、
 * 孕晚期到 37 周足月，临产期 37～42 周（40 周＝预产期落在其中），满 42 周才算逾期（过期妊娠）
 */
export const PREGNANCY_STAGE_DAYS = Object.freeze({
  孕早期: 84,
  孕中期: 112,
  孕晚期: 63,
  临产期: 35,
});

/** 预产期（40 周）：胎儿成长、胎量与衣着压力的「足月＝1」都以它为准，不随临产期长度变动 */
export const DUE_DATE_DAYS = 280;

/** 足月起点（37 周）：临产期开始，宫压起自行累积 */
export const TERM_START_DAYS = PREGNANCY_STAGE_DAYS.孕早期 + PREGNANCY_STAGE_DAYS.孕中期 + PREGNANCY_STAGE_DAYS.孕晚期;

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
