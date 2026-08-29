export const MENSTRUAL_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期']);

export const PREGNANCY_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期']);

export const LABOR_STAGES = Object.freeze(['第一产程', '第二产程', '第三产程']);

export const MENSTRUAL_STAGE_DAYS = Object.freeze({
  卵泡期: 9,
  排卵期: 2,
  黄体期: 12,
  月经期: 5,
});

export const PREGNANCY_STAGE_DAYS = Object.freeze({
  孕早期: 84,
  孕中期: 105,
  孕晚期: 63,
  临产期: 28,
});

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
