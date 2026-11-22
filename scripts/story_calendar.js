// 日历页（1.5.2）：把一位角色的生理阶段排到故事时间轴上。
// 往后是推算（照现在的阶段与天数，用引擎同一套阶段长度往前排）；往前用楼层快照回推（每份快照起推到下一份快照）。
// 纯计算：复制档案再推，不改任何状态，不掷骰（受孕、假孕、生产时机这类机率事件一律不推算）。
import { DORMANCY_STAGE, DUE_DATE_DAYS, LABOR_STAGES, MENSTRUAL_STAGES, PREGNANCY_STAGE_DAYS } from './stage_config.js';
import { getGestationEffectiveSpeed } from './state.js';
import { applySeasonAnchor, getNextMenstrualStage, getPseudoPregnancyLimit, getStageLimit } from './tools.js';

const MINUTES_PER_DAY = 24 * 60;
const MAX_SEGMENTS = 2000;
const PREGNANCY_BOUNDS = (() => {
  let total = 0;
  return ['孕早期', '孕中期', '孕晚期', '临产期'].map((stage) => {
    total += PREGNANCY_STAGE_DAYS[stage];
    return { stage, end: total };
  });
})();

/**
 * 日历只画重点（像经期 app）：月经、排卵（季节性物种就是发情）、孕期、逾期、产后恢复、假孕。
 * 卵泡、黄体、乏情留白，季节性物种一年里只有繁殖季那几格有颜色；产兆、产程、回归看机率或只是过渡，不画，点格子的细节照列。
 * 逾期另一个颜色，过了预产期几天一眼看得出；往后的逾期推不出何时生，只画到今天。
 */
export const CALENDAR_STAGE_GROUPS = Object.freeze([
  { key: 'menses', label: '月经', stages: ['月经期'] },
  { key: 'ovulation', label: '排卵／发情', stages: ['排卵期'] },
  { key: 'pregnancy', label: '孕期', stages: ['孕早期', '孕中期', '孕晚期', '临产期'] },
  { key: 'overdue', label: '逾期／延产', stages: ['逾期', '延产期'] },
  { key: 'postpartum', label: '产后恢复', stages: ['产后恢复'] },
  { key: 'pseudo', label: '假孕', stages: ['假孕期'] },
]);

export function stageGroupOf(stage) {
  return CALENDAR_STAGE_GROUPS.find((group) => group.stages.includes(stage))?.key || '';
}

const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/**
 * 从 fromMinutes 那刻的档案往后排到 toMinutes。
 * 回传 { segments: [{ stage, start, end, open? }], marks: [{ kind: 'due', at }] }；
 * open＝这段的结束时间推不出来（产程、逾期这类看机率的），一路画到 toMinutes。
 */
export function projectStageTimeline(profile, fromMinutes, toMinutes) {
  const segments = [];
  const marks = [];
  if (!profile?.base || !(toMinutes > fromMinutes)) return { segments, marks };
  const p = clone(profile);
  p.base = p.base || {};
  p.pregnant = p.pregnant || {};
  let t = fromMinutes;
  // 繁殖季定锚：与引擎同一套（已在乏情、还没算过锚点时从乏情开始那刻对齐）
  if (p.base.stage === DORMANCY_STAGE && !Number.isFinite(Number(p.base.seasonDormancyDays))) applySeasonAnchor(p, fromMinutes - Math.max(0, num(p.base.days)) * MINUTES_PER_DAY);
  const push = (stage, days, open = false) => {
    const end = open ? toMinutes : Math.min(toMinutes, t + Math.max(0, days) * MINUTES_PER_DAY);
    const last = segments[segments.length - 1];
    if (last && last.stage === stage && last.end === t) last.end = end;
    else segments.push({ stage, start: t, end, ...(open ? { open: true } : {}) });
    t = end;
  };
  for (let guard = 0; t < toMinutes && guard < MAX_SEGMENTS; guard += 1) {
    const stage = String(p.base.stage || '').trim();
    const days = Math.max(0, num(p.base.days));
    if (!stage) break;
    if (MENSTRUAL_STAGES.includes(stage)) {
      const limit = getStageLimit(p, stage);
      if (limit === null) { push(stage, 0, true); break; }
      const left = Math.max(0, limit - days);
      if (left > 0) push(stage, left);
      if (t >= toMinutes) break;
      if (stage === '月经期') applySeasonAnchor(p, t);
      p.base.stage = getNextMenstrualStage(p, stage) || '卵泡期';
      if (p.base.stage !== DORMANCY_STAGE) delete p.base.seasonDormancyDays;
      p.base.days = 0;
      continue;
    }
    if (stage === '产后恢复' || stage === '假孕期') {
      const limit = stage === '产后恢复' ? getStageLimit(p, stage) : getPseudoPregnancyLimit(p);
      const used = stage === '产后恢复' ? days : Math.max(0, num(p.pregnant.pregnantDays));
      const left = Math.max(0, num(limit) - used);
      if (left > 0) push(stage, left);
      if (t >= toMinutes) break;
      p.base.stage = '月经期';
      p.base.days = 0;
      p.base.seasonCycle = Math.max(0, Math.floor(num(p.base.seasonCycle)));
      continue;
    }
    if (['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期'].includes(stage)) {
      const speed = Math.max(0, num(getGestationEffectiveSpeed(p), 1));
      const effective = Math.max(0, num(p.pregnant.effectivePregnantDays));
      const extension = p.pregnant.extensionUntilDays;
      if (speed <= 0) { push(stage, 0, true); break; }
      // 预产期（40 周）那天打记号；临产期里随时可能发动，之后的日子都是「可能」
      if (effective < DUE_DATE_DAYS) marks.push({ kind: 'due', at: t + ((DUE_DATE_DAYS - effective) / speed) * MINUTES_PER_DAY });
      let e = effective;
      for (const bound of PREGNANCY_BOUNDS) {
        if (e >= bound.end) continue;
        push(bound.stage, (bound.end - e) / speed);
        e = bound.end;
        if (t >= toMinutes) break;
      }
      if (t >= toMinutes) break;
      if (extension !== null && extension !== undefined && Number.isFinite(Number(extension)) && Number(extension) > e) {
        // 延产期限：到这天进产兆前驱（除非再延产）；超出画的范围时由 marks 的范围过滤掉
        marks.push({ kind: 'extension', at: t + ((Number(extension) - e) / speed) * MINUTES_PER_DAY });
        push('延产期', (Number(extension) - e) / speed);
        if (t < toMinutes) push('产兆前驱', 0, true);
      } else {
        push('逾期', 0, true);
      }
      break;
    }
    // 产兆、产程、回归以小时计且看机率：画到底，不往后推
    push(stage, 0, true);
    break;
  }
  return { segments, marks: marks.filter((mark) => mark.at >= fromMinutes && mark.at <= toMinutes) };
}

/**
 * 一位角色的整条时间轴：快照回推的「纪录」＋现在起的「推算」。
 * records：[{ minutes, profile }]（快照，旧到新）；current：{ minutes, profile }。
 */
export function buildStageTimeline(records, current, toMinutes) {
  const segments = [];
  const marks = [];
  const sorted = (Array.isArray(records) ? records : [])
    .filter((item) => item?.profile && Number.isFinite(Number(item.minutes)) && Number(item.minutes) < current.minutes)
    .sort((a, b) => a.minutes - b.minutes);
  sorted.forEach((item, index) => {
    const until = Math.min(index + 1 < sorted.length ? sorted[index + 1].minutes : current.minutes, toMinutes);
    if (until <= item.minutes) return;
    const part = projectStageTimeline(item.profile, item.minutes, until);
    segments.push(...part.segments.map((segment) => ({ ...segment, recorded: true })));
  });
  if (current?.profile && toMinutes > current.minutes) {
    const part = projectStageTimeline(current.profile, current.minutes, toMinutes);
    segments.push(...part.segments.map((segment) => ({ ...segment, predicted: true })));
    marks.push(...part.marks);
  }
  return { segments, marks, firstMinutes: segments[0]?.start ?? current?.minutes ?? 0 };
}

/** 某一天（[dayStart, dayStart + 1 天)）占最多时间的阶段，以及当天换了哪些阶段 */
export function stageOnDay(timeline, dayStart) {
  const dayEnd = dayStart + MINUTES_PER_DAY;
  let best = null;
  let bestSpan = 0;
  const changes = [];
  const segments = timeline?.segments || [];
  segments.forEach((segment, index) => {
    if (segment.end <= dayStart || segment.start >= dayEnd) return;
    const span = Math.min(segment.end, dayEnd) - Math.max(segment.start, dayStart);
    if (span > bestSpan) { best = segment; bestSpan = span; }
    // 纪录接推算、快照接快照的地方阶段没变，不算转入
    if (index > 0 && segment.start > dayStart && segment.start < dayEnd && segments[index - 1].stage !== segment.stage) changes.push(segment.stage);
  });
  const marks = (timeline?.marks || []).filter((mark) => mark.at >= dayStart && mark.at < dayEnd).map((mark) => mark.kind);
  return best ? { stage: best.stage, group: stageGroupOf(best.stage), predicted: best.predicted === true, open: best.open === true, changes, marks } : (marks.length ? { stage: '', group: '', changes, marks } : null);
}
