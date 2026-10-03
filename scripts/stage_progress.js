// Progress reads physiological clocks and shares limits with the engine; never advances time.
import { LABOR_STAGES, PREGNANCY_STAGE_DAYS, POSTTERM_START_DAYS } from './stage_config.js';
import { getStageLimit, getPseudoPregnancyLimit, getProdromalInitialHours, getLaborPhaseForStage, resolveLaborPhaseHours } from './tools.js';

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getStageProgress(profile) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const stage = String(base.stage || '').trim();
  const days = Math.max(0, number(base.days));
  if (LABOR_STAGES.includes(stage)) {
    const phase = getLaborPhaseForStage(stage, pregnant.laborPhase);
    const hours = Math.max(0, Math.min(9999, number(pregnant.effectiveLaborHours)));
    if (stage === '第一产程') {
      const max = resolveLaborPhaseHours(profile, stage, phase, pregnant.fetuses || [], { fullStage: true });
      const offset = phase === '活跃期' ? max * 0.5 : phase === '过渡期' ? max * 0.85 : 0;
      return { label: '产程进度', value: offset + hours, max, unit: 'h', phase };
    }
    if (stage === '第三产程') {
      const organ = resolveLaborPhaseHours(profile, stage, '供养器官娩出');
      const observation = resolveLaborPhaseHours(profile, stage, '产后观察');
      return { label: '产程进度', value: (phase === '产后观察' ? organ : 0) + hours, max: organ + observation, unit: 'h', phase };
    }
    return { label: '产程进度', value: hours, max: resolveLaborPhaseHours(profile, stage, phase), unit: 'h', phase };
  }
  if (stage === '产兆前驱') {
    const max = getProdromalInitialHours(profile);
    const remaining = Math.max(0, Math.min(9999, number(pregnant.prodromalRemainingHours, max)));
    return { label: '前驱进展', value: Math.max(0, max - remaining), max, unit: 'h' };
  }
  if (Object.hasOwn(PREGNANCY_STAGE_DAYS, stage)) {
    return { label: '阶段进度', value: days, max: PREGNANCY_STAGE_DAYS[stage], unit: 'd' };
  }
  if (stage === '逾期') return { label: '逾期时长', value: days, unbounded: true, unit: 'd' };
  if (stage === '延产期') {
    const raw = pregnant.extensionUntilDays;
    const until = number(raw, NaN);
    return raw !== null && raw !== undefined && until >= POSTTERM_START_DAYS
      ? { label: '延产进度', value: days, max: until - POSTTERM_START_DAYS, unit: 'd', emptyLabel: '延产期限已到' }
      : { label: '延产时长', value: days, unbounded: true, unit: 'd' };
  }
  if (stage === '假孕期') {
    return { label: '假孕进度', value: Math.max(0, number(pregnant.pregnantDays)), max: getPseudoPregnancyLimit(profile), unit: 'd' };
  }
  if (stage === '回归期') {
    const state = pregnant.wombReturn;
    if (!state || state.totalHours === null || state.totalHours === undefined || !Number.isFinite(Number(state.totalHours))) return null;
    const max = Math.max(0, Math.min(99999, number(state.totalHours)));
    const remaining = Math.max(0, Math.min(99999, number(state.remainingHours)));
    return { label: '回归进度', value: Math.max(0, max - remaining), max, unit: 'h', emptyLabel: '回归已完成' };
  }
  const limit = getStageLimit(profile, stage);
  if (limit !== null) {
    return { label: stage === '产后恢复' ? '恢复进度' : '阶段进度', value: days, max: limit, unit: 'd', emptyLabel: '无需恢复' };
  }
  return null;
}

export function formatProgressNumber(value) {
  return String(Math.round((Math.max(0, number(value)) + Number.EPSILON) * 100) / 100);
}
