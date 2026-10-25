// Shared reproductive data contracts. Beliefs never overwrite physiological facts.
export const COGNITION_METHODS = Object.freeze(['perception', 'guess', 'informed', 'test', 'prenatal']);
export const EXPERIENCE_ACTIONS = Object.freeze(['cognition', 'date', 'breakup', 'marry', 'divorce', 'child', 'claim']);
export const REPRODUCTIVE_DEFAULTS = Object.freeze({
  condomCapacity: 50, condomReliability: 0.95,
  emergencyEffectiveness: 0.8,
  noticeBaseDays: 42, noticeMinDays: 28, noticeMaxDays: 280, noticeSpread: 0.6,
  noticeFetalWeight: 0.15, experienceCap: 10,
  noticeExperienceH: 0, noticeExperienceM: 0, noticeExperienceA: 0, noticeExperienceU: 0,
  laborExperienceM: 0, laborExperienceA: 0,
  noticeExperienceMin: 0.75, noticeExperienceMax: 1.25,
  laborExperienceMin: 0.9, laborExperienceMax: 1.1,
  // 契合度（精方计划 §6.5）：有效次数的半衰期、「还不熟悉」的基准值 c、同一场插入的去重间隔
  intimacyHalfLifeDays: 90, intimacyBaseline: 3, intimacyDedupeHours: 6,
});

export function normalizeReproductiveSettings(value = {}) {
  const result = { ...REPRODUCTIVE_DEFAULTS };
  for (const key of Object.keys(result)) {
    const n = value[key];
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = n;
  }
  for (const key of ['condomReliability', 'emergencyEffectiveness']) result[key] = Math.max(0, Math.min(1, result[key]));
  for (const key of ['condomCapacity', 'noticeFetalWeight']) result[key] = Math.max(0, result[key]);
  for (const key of ['noticeSpread', 'experienceCap']) result[key] = Math.max(0.001, result[key]);
  result.intimacyHalfLifeDays = Math.max(1, result.intimacyHalfLifeDays);
  result.intimacyBaseline = Math.max(0, result.intimacyBaseline);
  result.intimacyDedupeHours = Math.max(0, result.intimacyDedupeHours);
  result.noticeMinDays = Math.max(0, result.noticeMinDays);
  result.noticeMaxDays = Math.max(result.noticeMinDays, result.noticeMaxDays);
  result.noticeBaseDays = Math.max(result.noticeMinDays, Math.min(result.noticeMaxDays, result.noticeBaseDays));
  for (const prefix of ['notice', 'labor']) {
    result[`${prefix}ExperienceMin`] = Math.max(0.001, Math.min(1, result[`${prefix}ExperienceMin`]));
    result[`${prefix}ExperienceMax`] = Math.max(1, result[`${prefix}ExperienceMax`]);
  }
  return result;
}

// 可靠度只给模型分级、不给数字：它要知道这个世界的套子牢不牢、有没有事后药，但不该自己去算成败。0 即本世界没有这种手段
export function contraceptionLevels(value = {}) {
  const config = normalizeReproductiveSettings(value);
  const grade = (rate, [poor, unreliable]) => (rate <= 0 ? 'none' : rate >= 1 ? 'certain' : rate < poor ? 'poor' : rate < unreliable ? 'unreliable' : 'reliable');
  return {
    condom: grade(config.condomReliability, [0.5, 0.9]),
    emergency: grade(config.emergencyEffectiveness, [0.4, 0.7]),
  };
}

export function normalizeMateList(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
}

export function normalizeExperience(value = {}) {
  const result = { ...value, emotionalMates: normalizeMateList(value.emotionalMates), marriageMates: normalizeMateList(value.marriageMates) };
  delete result.emotionalMate;
  delete result.marriageMate;
  for (const key of ['pregnantExperience', 'naturalBirthExperience', 'surgicalBirthExperience', 'miscarriageExperience', 'abortionExperience']) {
    result[key] = Math.max(0, Math.floor(Number(value[key]) || 0));
  }
  // Fold the retired v4 preview bucket into miscarriage once; never retain a live bucket.
  result.miscarriageExperience += Math.max(0, Math.floor(Number(value.unclassifiedLossExperience) || 0));
  delete result.unclassifiedLossExperience;
  return result;
}

export function normalizeCognitionRecords(value) {
  return (Array.isArray(value) ? value : []).filter((x) => x && COGNITION_METHODS.includes(x.method)
    && typeof x.time === 'string' && x.time.trim() && typeof x.content === 'string' && x.content.trim())
    .map((x) => ({ ...x, time: x.time.trim(), content: x.content.trim() }));
}

export function initializeCognitionRecords(records, minutesPassed = 0) {
  if (!Array.isArray(records) || normalizeCognitionRecords(records).length !== records.length) throw new Error('初始認知紀錄須為 time／method／content 有效的陣列。');
  return normalizeCognitionRecords(records).map((x, index) => ({
    time: x.time, method: x.method, content: x.content,
    id: `registration:${index}`, sequence: index + 1, source: 'registration',
    minutesPassed, storyDayIndex: Math.floor(minutesPassed / 1440),
  }));
}

export function psychologySide(stage) {
  if (stage === '产后恢复') return null;
  return /孕|产兆|产程|延产|回归/.test(String(stage || '')) ? 'preg' : 'mens';
}

export function refreshCognition(profile) {
  profile.cognitionRecords = [];
  profile.cognitionCycle = (Number(profile.cognitionCycle) || 0) + 1;
  profile.reproductiveOperations = (profile.reproductiveOperations || []).filter((x) => x.action !== 'cognition');
}

/** 胎父认定纪录：只增不改的白描，跟着胎儿与孩子长期保留；不合格的项目丢掉 */
export function normalizePaternityClaims(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x === 'object' && typeof x.content === 'string' && x.content.trim())
    .map((x) => ({
      time: String(x.time || '').trim(),
      content: x.content.trim(),
      minutesPassed: Math.max(0, Number(x.minutesPassed) || 0),
      ...(x.source ? { source: String(x.source) } : {}),
    }));
}

/**
 * 胎儿或孩子心里认定的父亲与纪录；对外说法写在纪录里。认定不改遗传真相（fathers），也不代表任何人知道真相。
 * 同一来源（同一则讯息重新追踪）只记一次，比照认知纪录。
 */
function recordPaternityClaim(target, args, time, source, minutesPassed) {
  const claims = normalizePaternityClaims(target.paternityClaims);
  if (source && claims.some((x) => x.source === source)) return false;
  claims.push({ time, content: args.content.trim(), minutesPassed, ...(source ? { source } : {}) });
  target.paternityClaims = claims;
  if (Object.hasOwn(args, 'selectedFather')) target.selectedFather = args.selectedFather === null ? null : args.selectedFather.trim();
  return true;
}

export function recordExperience(chatState, args, source = '', { resolveFetus = (fetuses, index) => fetuses[index] } = {}) {
  const fail = (message) => ({ applied: false, message: `bsRecordExperience skipped: ${message}` });
  if (typeof args?.female !== 'string' || !args.female.trim()) return fail('female 必填。');
  const female = args.female.trim();
  const character = Object.hasOwn(chatState.characters || {}, female) ? chatState.characters[female] : null;
  if (!character) return fail('未知角色。');
  const { action, time } = args;
  if (!EXPERIENCE_ACTIONS.includes(action) || typeof time !== 'string' || !time.trim()) return fail('action 或 time 无效。');
  const fields = action === 'cognition' ? ['method', 'content']
    : action === 'child' ? ['childIndex', 'name']
      : action === 'claim' ? ['fetusIndex', 'childIndex', 'content', 'selectedFather'] : ['partner'];
  const allowed = new Set(['female', 'action', 'time', ...fields]);
  if (Object.keys(args).some((x) => !allowed.has(x))) return fail('含不属于该 action 的参数。');
  const nonempty = (x) => typeof x === 'string' && x.trim().length > 0;
  if (action === 'cognition' && (!COGNITION_METHODS.includes(args.method) || !nonempty(args.content))) return fail('method 或 content 无效。');
  if (!['cognition', 'child', 'claim'].includes(action) && !nonempty(args.partner)) return fail('partner 必填。');
  if (action === 'child') {
    if (!Number.isInteger(args.childIndex) || !character.profile?.children?.[args.childIndex] || args.childIndex < 0) return fail('childIndex 无效。');
    if (!nonempty(args.name)) return fail('name 无效。');
  }
  if (action === 'claim') {
    const hasFetus = Object.hasOwn(args, 'fetusIndex');
    if (hasFetus === Object.hasOwn(args, 'childIndex')) return fail('fetusIndex 与 childIndex 须二择一。');
    if (!nonempty(args.content)) return fail('content 必填。');
    if (Object.hasOwn(args, 'selectedFather') && args.selectedFather !== null && !nonempty(args.selectedFather)) return fail('selectedFather 无效。');
    if (hasFetus) {
      const fetuses = Array.isArray(character.profile?.pregnant?.fetuses) ? character.profile.pregnant.fetuses : [];
      if (!Number.isInteger(args.fetusIndex) || args.fetusIndex < 0 || !resolveFetus(fetuses, args.fetusIndex)) return fail('fetusIndex 无效。');
    } else if (!Number.isInteger(args.childIndex) || args.childIndex < 0 || !character.profile?.children?.[args.childIndex]) return fail('childIndex 无效。');
  }
  const next = JSON.parse(JSON.stringify(character));
  const profile = next.profile;
  const minutesPassed = Math.max(0, Number(chatState.minutesPassed) || 0);
  if (action === 'cognition') {
    profile.cognitionRecords = normalizeCognitionRecords(profile.cognitionRecords);
    if (source && profile.cognitionRecords.some((x) => x.source === source)) return { applied: false, unchanged: true, message: '认知来源已记录。' };
    const sequence = (profile.cognitionRecords.at(-1)?.sequence || 0) + 1;
    profile.cognitionRecords.push({ id: `${profile.cognitionCycle || 0}:${sequence}`, sequence, source: source || 'manual',
      time: time.trim(), method: args.method, content: args.content.trim(), minutesPassed, storyDayIndex: Math.floor(minutesPassed / 1440) });
    const psy = profile.psychology;
    const side = psychologySide(profile.base?.stage);
    if (psy?.enabled && side && Object.values(psy[side] || {}).some((x) => x === null)) {
      psy.pendingSide = side;
      psy.supplementOnly = true;
      psy.generation = (Number(psy.generation) || 0) + 1;
    }
  } else if (action === 'child') {
    profile.children[args.childIndex].name = args.name.trim();
  } else if (action === 'claim') {
    // next 是深拷贝：在拷贝里重新解析同一胎，才不会写到原物件上
    const target = Object.hasOwn(args, 'fetusIndex')
      ? resolveFetus(profile.pregnant.fetuses, args.fetusIndex)
      : profile.children[args.childIndex];
    if (!recordPaternityClaim(target, args, time.trim(), source, minutesPassed)) return { applied: false, unchanged: true, message: '认定来源已记录。' };
  } else {
    profile.experience = normalizeExperience(profile.experience);
    const field = ['date', 'breakup'].includes(action) ? 'emotionalMates' : 'marriageMates';
    const add = ['date', 'marry'].includes(action);
    const partner = args.partner.trim();
    const present = profile.experience[field].includes(partner);
    if (present === add) return { applied: false, unchanged: true, message: '关系未变更。' };
    profile.experience[field] = add ? [...profile.experience[field], partner] : profile.experience[field].filter((x) => x !== partner);
  }
  chatState.characters[female] = next;
  return { applied: true, message: action === 'cognition' ? '认知已记录；不代表内容客观正确。' : action === 'child' ? '孩子资料已更新。'
    : action === 'claim' ? '胎父认定已记录；不改遗传父方，也不代表任何人知道真相。' : '关系已更新。' };
}

export function syncPsychologyLifecycle(profile, previousStage, menstrualEntry = false) {
  const psychology = profile?.psychology;
  if (!psychology || !(psychology.enabled || Object.keys(psychology.stageProfiles || {}).length)) return;
  psychology.enabled = true;
  const stage = profile.base?.stage;
  const side = psychologySide(stage);
  const previousSide = psychologySide(previousStage);
  const newRound = (stage === '月经期' || menstrualEntry) && ['产后恢复', '假孕期'].includes(previousStage);
  if (side !== previousSide || newRound) {
    psychology.generation = (Number(psychology.generation) || 0) + 1;
    psychology.activeSide = side;
    if (side) {
      psychology[side] = {};
      delete psychology.stageProfiles?.[side];
      psychology.pendingSide = side;
    } else psychology.pendingSide = null;
  } else if (psychology.activeSide === undefined) psychology.activeSide = side;
}

export function experienceSnapshot(experience, includesCurrent = false) {
  const e = normalizeExperience(experience);
  const H = Math.max(0, e.pregnantExperience - (includesCurrent ? 1 : 0));
  const M = e.miscarriageExperience, A = e.abortionExperience, U = 0;
  return { H, M, A, U, complete: H >= M + A + U };
}

export function experienceFactor(snapshot, config, kind) {
  if (!snapshot?.complete) return 1;
  const g = (x) => Math.log1p(Math.min(Math.max(0, x), config.experienceCap));
  let power = 0;
  if (kind === 'notice') {
    power = config.noticeExperienceH * g(snapshot.H - snapshot.M - snapshot.A - snapshot.U)
      + config.noticeExperienceM * g(snapshot.M) + config.noticeExperienceA * g(snapshot.A) + config.noticeExperienceU * g(snapshot.U);
  } else power = config.laborExperienceM * g(snapshot.M) + config.laborExperienceA * g(snapshot.A);
  return Math.max(config[`${kind}ExperienceMin`], Math.min(config[`${kind}ExperienceMax`], Math.exp(power)));
}

export function naturalNoticeDays(sample, fetalCount) {
  const c = sample.config;
  const vitality = [1, 0.85, 0.93, 1, 1, 1, 1.08, 1.15][sample.vitalityLevel] || 1;
  const stress = [1, 1.15, 1.08, 1, 1, 0.93, 0.85, 0.85][sample.psyStressLevel] || 1;
  const days = c.noticeBaseDays * Math.exp(c.noticeSpread * sample.z) * vitality * stress
    / ((1 + c.noticeFetalWeight * Math.log(Math.max(1, fetalCount))) * experienceFactor(sample.experience, c, 'notice'));
  return Math.max(c.noticeMinDays, Math.min(c.noticeMaxDays, days));
}
