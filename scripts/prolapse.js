// 宫脱（1.6.0）。base.prolapse 是 0–4 的小数：整数部分是分级，小数是往下一级的进度。
// 来源：第二产程在高宫压（≥ 66%）下用力、阴道娩出、剑比鞘大的插入、剧情（bsRecordExperience prolapse）。单纯宫压高不会脱。
// 回复：分级 III 以下每天自然回一点（臀部增长倾向越高越快、种族恢复系数越大越慢）；
// III 以上要先推回（reduce），托住（support）期间来源减半、回复加倍、III 以上也能慢慢回；修复（repair）归零但要休养。
// 孕中期起子宫大到卡在骨盆上方，分级最多显示 II，累积照算，生完才掉出来。

export const PROLAPSE_MAX = 4;
export const PROLAPSE_LABELS = Object.freeze(['正常位置', 'I 度·在通道内下降', 'II 度·接近外口', 'III 度·明显突出外口', 'IV 度·通道近乎完全外翻']);
export const PROLAPSE_STRAIN = Object.freeze({ strain_slight: 0.25, strain_significant: 0.6, strain_severe: 1.2 });
export const PROLAPSE_ACTIONS = Object.freeze([...Object.keys(PROLAPSE_STRAIN), 'reduce', 'support', 'repair']);

const PUSH_STRAIN_PER_HOUR = 0.05; // 第二产程：× 宫压比例 ×（1 ＋ 疲劳／100），宫压未达门槛不算
const PUSH_PRESSURE_THRESHOLD = 0.66; // 与自然发动产程同一条线
const DELIVERY_STRAIN = 0.2; // 每阴道娩出一胎 × 胎重倍率
const DELIVERY_INJURY_STRAIN = Object.freeze({ stuck: 0.5, rushed: 0.3 });
const BIG_FETUS_WEIGHT = 1.3;
const BIG_FETUS_STRAIN = 0.3;
const SWORD_STRAIN = Object.freeze([[4, 0.6], [2.5, 0.3], [1.5, 0.1]]); // 剑比鞘大多少级 → 加多少：明显不合 0.1、极不相称 0.3、体型悬殊 0.6
const DAILY_RECOVERY = 0.15;
const REDUCE_TO = 2.5;
const SUPPORT_DEFAULT_HOURS = 14 * 24;
const REPAIR_REST_DAYS = 28;
const POSTPARTUM_FACTOR = 1.5;
const OUTSIDE = 3;

const BULKY_PREGNANCY_STAGES = new Set(['孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '第一产程', '第二产程']);

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const round = (value) => Math.round(value * 1000) / 1000;

export function getProlapseValue(profile) {
  return clamp(profile?.base?.prolapse, 0, PROLAPSE_MAX, 0);
}

/** 画面与文字用的分级：孕中期起最多 II */
export function getProlapseGrade(profile) {
  const grade = Math.floor(getProlapseValue(profile));
  return BULKY_PREGNANCY_STAGES.has(String(profile?.base?.stage || '')) ? Math.min(2, grade) : grade;
}

// now 为 null（产程里拿不到故事时间）时不看托住、休养的期限
function supportActive(profile, now) {
  if (now === null || now === undefined) return false;
  return clamp(profile?.base?.prolapseSupportUntil, 0, Number.MAX_SAFE_INTEGER, 0) > now;
}

function restActive(profile, now) {
  if (now === null || now === undefined) return false;
  return clamp(profile?.base?.prolapseRestUntil, 0, Number.MAX_SAFE_INTEGER, 0) > now;
}

/** 易脱系数：自然产次（每次 +10%，最多 ×2）× 子宫乏力（每级 +10%）× 产后恢复期 ×1.5 × 托住减半 × 修复后休养 ×2 */
export function getProlapseSusceptibility(profile, now = 0) {
  const births = clamp(profile?.experience?.naturalBirthExperience, 0, 999, 0);
  const atony = clamp(profile?.base?.uterineAtony, 0, 99, 0);
  let factor = Math.min(2, 1 + 0.1 * births) * (1 + 0.1 * Math.floor(atony));
  if (profile?.base?.stage === '产后恢复') factor *= POSTPARTUM_FACTOR;
  if (supportActive(profile, now)) factor *= 0.5;
  if (restActive(profile, now)) factor *= 2;
  return factor;
}

/**
 * 加重宫脱。raw 是未乘易脱系数的量；immune.prolapse 挡掉。
 * 回传 { added, before, after, crossed }，crossed 是这次跨进的新分级（没有就 null）。
 */
export function addProlapse(profile, raw, { now = 0, scaled = true } = {}) {
  const before = getProlapseValue(profile);
  const amount = Math.max(0, Number(raw) || 0) * (scaled ? getProlapseSusceptibility(profile, now) : 1);
  if (!profile?.base || profile?.immune?.prolapse || amount <= 0) return { added: 0, before, after: before, crossed: null };
  const after = Math.min(PROLAPSE_MAX, before + amount);
  profile.base.prolapse = round(after);
  const crossed = Math.floor(after) > Math.floor(before) ? Math.floor(after) : null;
  return { added: round(after - before), before, after, crossed };
}

/** 自然回复的臀部系数：0.75 ＋ 0.5 × 臀部增长倾向（0 → 0.75、平均 0.5 → 1、2 → 1.75） */
export function getProlapseHipFactor(profile) {
  return 0.75 + 0.5 * clamp(profile?.base?.hipGain, 0, 2, 0.5);
}

/**
 * 每次时间推进：第二产程在高宫压下用力会加重；没在用力的时间自然回复。
 * input：{ hours, now, pressureRatio, pushing, pushFatigue, recoveryCoefficient }
 */
export function applyProlapseTick(profile, input = {}) {
  const hours = Math.max(0, Number(input.hours) || 0);
  if (!profile?.base || hours <= 0) return { crossed: null, recovered: 0 };
  const now = Math.max(0, Number(input.now) || 0);
  const ratio = clamp(input.pressureRatio, 0, 1, 0);
  const straining = Boolean(input.pushing) && ratio >= PUSH_PRESSURE_THRESHOLD;
  const raw = straining ? PUSH_STRAIN_PER_HOUR * ratio * (1 + clamp(input.pushFatigue, 0, 100, 0) / 100) * hours : 0;
  const result = addProlapse(profile, raw, { now });
  let recovered = 0;
  const value = getProlapseValue(profile);
  const supported = supportActive(profile, now);
  if (!input.pushing && value > 0 && (value < OUTSIDE || supported)) {
    const coefficient = Math.max(0.1, Number(input.recoveryCoefficient) || 1);
    const perDay = DAILY_RECOVERY * getProlapseHipFactor(profile) / coefficient * (supported ? 2 : 1);
    // 没托住时自然回复停在 III 以下，不会把外翻的自己缩回去
    const next = Math.max(0, value - perDay * hours / 24);
    profile.base.prolapse = round(next);
    recovered = round(value - next);
  }
  if (profile.base.prolapse === 0) {
    if (!supported) delete profile.base.prolapseSupportUntil;
    if (!restActive(profile, now)) delete profile.base.prolapseRestUntil;
  }
  return { crossed: result.crossed, recovered };
}

/** 阴道娩出一批胎儿：每胎 0.2 × 胎重，胎重过 1.3 另加，产伤另加 */
export function applyDeliveryProlapse(profile, born, { now = null } = {}) {
  const list = Array.isArray(born) ? born : [];
  let raw = 0;
  for (const fetus of list) {
    const weight = clamp(fetus?.weight, 0.33, 3, 1);
    raw += DELIVERY_STRAIN * Math.max(1, weight);
    if (weight > BIG_FETUS_WEIGHT) raw += BIG_FETUS_STRAIN;
    for (const code of Array.isArray(fetus?.laborRecord?.injuries) ? fetus.laborRecord.injuries : []) raw += DELIVERY_INJURY_STRAIN[code] || 0;
  }
  return addProlapse(profile, raw, { now });
}

/** 插入时剑比鞘大（diff ＝ 剑 − 鞘，级）：明显不合起才加 */
export function getSwordProlapseStrain(diff) {
  const value = Number(diff);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return (SWORD_STRAIN.find(([min]) => value >= min) || [0, 0])[1];
}

/**
 * 剧情处理（bsRecordExperience action=prolapse）。回传 { ok, message }。
 * strain_*：加重；reduce：III 以上推回到 II；support：托住 hours（预设 14 天）；repair：归零并休养 28 天。
 */
export function applyProlapseAction(profile, action, { now = 0, hours } = {}) {
  if (!profile?.base) return { ok: false, message: 'no profile' };
  const before = getProlapseValue(profile);
  const label = (value) => PROLAPSE_LABELS[Math.floor(value)];
  if (PROLAPSE_STRAIN[action] !== undefined) {
    if (profile.immune?.prolapse) return { ok: false, message: '宫脱免疫，不会加重' };
    const result = addProlapse(profile, PROLAPSE_STRAIN[action], { now });
    return { ok: true, message: `宫脱 ${label(before)} → ${label(result.after)}` };
  }
  if (action === 'reduce') {
    if (before < OUTSIDE) return { ok: false, message: `${label(before)}，没有脱出外口，不必推回` };
    profile.base.prolapse = REDUCE_TO;
    return { ok: true, message: `推回：${label(before)} → ${label(REDUCE_TO)}；不托住的话宫压、用力还会让它再掉出来` };
  }
  if (action === 'support') {
    const span = Number(hours) > 0 ? Number(hours) : SUPPORT_DEFAULT_HOURS;
    profile.base.prolapseSupportUntil = Math.round(now + span * 60);
    return { ok: true, message: `托住 ${Math.round(span / 24 * 10) / 10} 天：期间加重减半、回复加倍，脱出外口的也能慢慢回去` };
  }
  if (action === 'repair') {
    profile.base.prolapse = 0;
    profile.base.prolapseRestUntil = Math.round(now + REPAIR_REST_DAYS * 1440);
    delete profile.base.prolapseSupportUntil;
    return { ok: true, message: `修复：${label(before)} → 正常位置；之后 ${REPAIR_REST_DAYS} 天要休养，期间更容易再脱` };
  }
  return { ok: false, message: `prolapse 必须是 ${PROLAPSE_ACTIONS.join('、')}` };
}

/**
 * 孕早期子宫还在骨盆里，脱到 III 度以上宫颈外露、容易受伤感染：每天扣每一胎的健康（流产仍只走健康见底）。
 * 回传这段时间每胎要扣的健康；不适用回 0。
 */
export const PROLAPSE_EARLY_HEALTH_PER_DAY = 2;
export function getProlapsePregnancyHealthDrain(profile, hours) {
  if (String(profile?.base?.stage || '') !== '孕早期') return 0;
  if (getProlapseValue(profile) < OUTSIDE) return 0;
  return PROLAPSE_EARLY_HEALTH_PER_DAY * Math.max(0, Number(hours) || 0) / 24;
}

/** 第一产程：宫颈露在外面水肿，扩张变慢（III 度 ×1.15、IV 度 ×1.2） */
export function getProlapseFirstStageFactor(profile) {
  const grade = Math.floor(getProlapseValue(profile));
  return grade >= 4 ? 1.2 : grade >= OUTSIDE ? 1.15 : 1;
}

/** 尿池容量：II 起每级少一成（压力性尿失禁） */
export function getProlapseUrineFactor(profile) {
  return 1 - 0.1 * Math.max(0, getProlapseGrade(profile) - 1);
}

/** 给模型看的文字；0 级回空字串 */
export function describeProlapse(profile, now = 0) {
  const grade = getProlapseGrade(profile);
  if (grade <= 0) return '';
  const raw = Math.floor(getProlapseValue(profile));
  const parts = [PROLAPSE_LABELS[grade]];
  if (raw > grade) parts.push('子宫被孕肚撑在骨盆上方，生产后会掉出来');
  if (grade === 1) parts.push('下腹坠胀，久站、提重物时明显');
  if (grade === 2) parts.push('站着用力时宫颈会顶到入口，躺下会缩回一点，咳嗽打喷嚏容易漏尿');
  if (grade >= 3) parts.push('宫颈露在外口外，走路会摩擦，不会自己缩回去，要推回去再托住');
  if (grade >= 3 && profile?.base?.stage === '孕早期') parts.push('孕早期宫颈外露容易受伤感染，胎儿会慢慢受损');
  if (raw >= 3 && profile?.base?.stage === '第一产程') parts.push('宫颈水肿，扩张比平常慢');
  if (supportActive(profile, now)) parts.push('目前有托住');
  if (restActive(profile, now)) parts.push('修复后休养中，容易再脱');
  return parts.join('；');
}
