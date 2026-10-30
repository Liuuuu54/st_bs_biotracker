// 只调度生殖事件；角色的代谢、心理与产程仍由宿主整批推进。
import { MENSTRUAL_STAGES, MENSTRUAL_STAGE_DAYS, PREGNANCY_STAGES, PREGNANCY_STAGE_DAYS,
  POSTTERM_START_DAYS } from './stage_config.js';
import { advancePooledConception, invalidatePooledSegment, isPooledConception,
  projectPooledSperms, syncPooledEggs } from './pooled_reproduction.js';

const DAY = 1440;
const nonnegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const isPregnant = (stage) => PREGNANCY_STAGES.includes(stage);
const isNatural = (stage) => MENSTRUAL_STAGES.includes(stage);
const retained = (stage) => isNatural(stage) || isPregnant(stage) || ['产后恢复', '假孕期'].includes(stage);
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
const reached = (now, target) => now >= target || close(now, target);
const finiteLimit = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
  ? Math.max(0, Number(value)) : Infinity;
const pregnancyBounds = [];
let pregnancyTotal = 0;
for (const [stage, days] of Object.entries(PREGNANCY_STAGE_DAYS)) {
  pregnancyBounds.push({ stage, start: pregnancyTotal, end: pregnancyTotal += days });
}

function pregnancyState(effectiveDays, pregnant) {
  if (pregnant.extensionUntilDays !== null && pregnant.extensionUntilDays !== undefined
    && Number.isFinite(Number(pregnant.extensionUntilDays))) {
    return { stage: '延产期', days: Math.max(0, effectiveDays - POSTTERM_START_DAYS) };
  }
  const entry = pregnancyBounds.find(({ end }) => effectiveDays < end && !close(effectiveDays, end));
  return entry ? { stage: entry.stage, days: Math.max(0, effectiveDays - entry.start) }
    : { stage: '逾期', days: Math.max(0, effectiveDays - pregnancyTotal) };
}

function pendingKind(profile) {
  const stage = String(profile.base.stage || '');
  const fetuses = Array.isArray(profile.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  if (isPregnant(stage)) return fetuses.some((fetus) => fetus?.pendingImplantation) ? 'superfetation' : null;
  return isNatural(stage) && fetuses.length > 0 ? 'normal' : null;
}

/**
 * hooks 负责真实生物学：阶段期限、着床期限、孕速、异期窗口、每源配对率和事件效果。
 * sourceRate 不含异期公共线性倍率；volumeFactor 可选，缺省为一。
 * onPhaseChange 可返回实际阶段或原位改 stage（例如转入假孕）；月经清理由该回调负责。
 * onConception 创建胎儿并更新生物参数；onImplantation 必须结清当前共用等待批次。
 * onFusion 只在满一天及之后的新普通受精检查；nextCapacityMinute 返回下一绝对分钟或无穷。
 * onCapacity 按宿主签名决定是否裁剪；调用切片终点本身不构成新的容量事件。
 * 所有回调在连续 atMinute 调用；展示分钟由适配器的 minute 字段给出。
 */
export function advancePooledTimeline(profile, { fromMinute, toMinute, dayCarryMinutes = 0,
  hourCarryMinutes = 0 }, hooks = {}) {
  if (![fromMinute, toMinute].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || toMinute < fromMinute) throw new RangeError('生殖时间线需要有限、非负且递增的分钟区间。');
  const base = profile?.base;
  if (!isPooledConception(base)) throw new Error('生殖时间线需要已启用的 pooled-v1 状态。');
  const pool = base.spermPool;
  if (!close(pool.lastMinute, fromMinute)) throw new RangeError('时间线起点必须等于混合池 lastMinute。');
  const pregnant = profile.pregnant || (profile.pregnant = {});
  const plan = { spans: [], transitions: [], enteredFollicular: false, implantationEvents: [],
    clockAdvanced: true, pregnancyMinutes: 0 };
  if (fromMinute === toMinute) return plan;
  let now = pool.lastMinute;
  const carryDay = nonnegative(dayCarryMinutes) % DAY;
  const carryHour = nonnegative(hourCarryMinutes) % 60;
  const stageLimit = (stage) => finiteLimit(hooks.stageLimit
    ? hooks.stageLimit(profile, stage) : MENSTRUAL_STAGE_DAYS[stage]);
  const speedOf = () => nonnegative(hooks.gestationSpeed ? hooks.gestationSpeed(profile) : 1);
  const nextCalendar = (period, carry) => {
    const elapsed = carry + now - fromMinute;
    // 抵达过的整日边界不再安排第二次；浮点末位只用于边界识别。
    const index = Math.floor(elapsed / period + 32 * Number.EPSILON * Math.max(1, Math.abs(elapsed / period))) + 1;
    return fromMinute + index * period - carry;
  };
  const recordTransition = (from) => {
    const to = String(base.stage || '');
    if (from !== to) {
      plan.transitions.push({ from, to, atMinute: now });
      if (to === '卵泡期') plan.enteredFollicular = true;
    }
  };
  const changePhase = (to, days = 0) => {
    const from = String(base.stage || '');
    base.days = days;
    const actual = hooks.onPhaseChange?.(profile, { from, to, atMinute: now });
    base.stage = typeof actual === 'string' ? actual : (String(base.stage || '') !== from ? base.stage : to);
    recordTransition(from);
    invalidatePooledSegment(base);
    syncPooledEggs(base, now);
  };
  const waiting = () => {
    const kind = pendingKind(profile);
    if (kind) {
      if (!Number.isFinite(pool.timelineImplantStartMinute)) {
        pool.timelineImplantStartMinute = now - nonnegative(base.fertilizationDays) * DAY;
      }
      base.fertilizationDays = Math.max(0, (now - pool.timelineImplantStartMinute) / DAY);
    } else {
      delete pool.timelineImplantStartMinute;
      delete pool.timelineFusionStartMinute;
      if (isNatural(String(base.stage || '')) || isPregnant(String(base.stage || ''))) base.fertilizationDays = 0;
    }
    return kind;
  };
  const clearPhysical = (clearEggs = true) => {
    if (clearEggs) base.eggs = 0;
    // 接触记录保留，即使其物理体积归零。
    base.spermContacts = (base.spermContacts || []).map((source) => ({ ...source, value: 0 }));
    invalidatePooledSegment(base);
    syncPooledEggs(base, now);
    projectPooledSperms(base);
  };
  const settleFusion = (newConception = false) => {
    if (waiting() !== 'normal' || !reached(nonnegative(base.fertilizationDays), 1)) return;
    if (!newConception && pool.timelineFusionStartMinute === pool.timelineImplantStartMinute) return;
    // 事件模型把旧的「超过一天」统一为满一天边界；之后只有新受精才重查融合。
    hooks.onFusion?.(profile, { atMinute: now });
    pool.timelineFusionStartMinute = pool.timelineImplantStartMinute;
    waiting();
  };
  const settleImmediate = () => {
    // 回调可以改走假孕；重新读取实际阶段，不再追逐原来的月经目标。
    const seen = new Set();
    while (true) {
      const stage = String(base.stage || '');
      const key = `${stage}:${base.days}:${pregnant.effectivePregnantDays}:${pregnant.pregnantDays}:${pendingKind(profile)}`;
      if (seen.has(key)) throw new Error('阶段回调没有消耗已到期的阶段边界。');
      seen.add(key);
      // 同刻固定次序：既有批次融合、着床，然后才是阶段结束。
      settleFusion();
      const kind = waiting();
      if (kind) {
        const due = pool.timelineImplantStartMinute + finiteLimit(hooks.implantationDays?.(profile)) * DAY;
        if (reached(now, due)) {
          const from = String(base.stage || '');
          const event = { atMinute: now, superfetation: kind === 'superfetation' };
          if (!hooks.onImplantation) throw new Error('到期着床事件需要 onImplantation 回调。');
          hooks.onImplantation(profile, event);
          plan.implantationEvents.push(event);
          delete pool.timelineImplantStartMinute;
          delete pool.timelineFusionStartMinute;
          base.fertilizationDays = 0;
          recordTransition(from);
          invalidatePooledSegment(base);
          syncPooledEggs(base, now);
          if (pendingKind(profile) === kind) throw new Error('onImplantation 必须结清当前等待批次。');
          continue;
        }
      }
      if (isPregnant(stage)) {
        const derived = pregnancyState(nonnegative(pregnant.effectivePregnantDays), pregnant);
        if (derived.stage !== stage) {
          changePhase(derived.stage, derived.days);
          continue;
        }
        base.days = derived.days;
        if (stage === '延产期' && reached(nonnegative(pregnant.effectivePregnantDays), Number(pregnant.extensionUntilDays))) {
          changePhase('产兆前驱');
          continue;
        }
      } else if (isNatural(stage) || stage === '产后恢复' || stage === '假孕期') {
        const limit = stageLimit(stage);
        const age = stage === '假孕期' ? nonnegative(pregnant.pregnantDays) : nonnegative(base.days);
        if (Number.isFinite(limit) && reached(age, limit)) {
          const next = isNatural(stage) ? MENSTRUAL_STAGES[(MENSTRUAL_STAGES.indexOf(stage) + 1) % MENSTRUAL_STAGES.length] : '月经期';
          changePhase(next, Math.max(0, age - limit));
          continue;
        }
      }
      break;
    }
  };

  settleImmediate();
  while (now < toMinute) {
    hooks.onCapacity?.(profile, now);
    syncPooledEggs(base, now);
    const stage = String(base.stage || '');
    const pregnantStage = isPregnant(stage);
    const speed = pregnantStage ? speedOf() : 0;
    const effectiveStart = nonnegative(pregnant.effectivePregnantDays);
    const pregnantStart = nonnegative(pregnant.pregnantDays);
    const daysStart = nonnegative(base.days);
    const kind = waiting();
    // 旧规则在非留存阶段只清物料，不额外发明产程失卵规则。
    if (!retained(stage)) clearPhysical(false);
    let end = toMinute;
    // 容量台阶是独立生殖边界，不触发阶段切换或日卵事件。
    const nextCapacity = finiteLimit(hooks.nextCapacityMinute?.(profile, now));
    if (nextCapacity > now && !close(nextCapacity, now)) end = Math.min(end, nextCapacity);
    let dayEvent = Infinity;
    let hourEvent = Infinity;
    if (isNatural(stage) || stage === '产后恢复' || stage === '假孕期') {
      const age = stage === '假孕期' ? pregnantStart : daysStart;
      end = Math.min(end, now + Math.max(0, stageLimit(stage) - age) * DAY);
    }
    if (pregnantStage && speed > 0) {
      const windowDays = nonnegative(hooks.superfetationWindowDays?.(profile));
      const boundaries = [56, windowDays, ...pregnancyBounds.map(({ end: boundary }) => boundary)];
      if (stage === '延产期') boundaries.push(finiteLimit(pregnant.extensionUntilDays));
      for (const boundary of boundaries) {
        if (boundary > effectiveStart && !close(boundary, effectiveStart)) {
          end = Math.min(end, now + (boundary - effectiveStart) / speed * DAY);
        }
      }
    }
    if (kind) {
      end = Math.min(end, pool.timelineImplantStartMinute + finiteLimit(hooks.implantationDays?.(profile)) * DAY);
      if (kind === 'normal' && pool.timelineFusionStartMinute !== pool.timelineImplantStartMinute) {
        end = Math.min(end, pool.timelineImplantStartMinute + DAY);
      }
    }
    if (isNatural(stage) && stage !== '月经期'
      && (stage === '排卵期' ? !profile.cooldown?.naturalOvulationUsed : nonnegative(base.eggs) > 0)) {
      dayEvent = nextCalendar(DAY, carryDay);
      end = Math.min(end, dayEvent);
    }
    if (stage === '月经期' && (nonnegative(base.eggs) > 0 || (base.spermContacts || []).some((source) => source.value > 0))) {
      hourEvent = nextCalendar(60, carryHour);
      end = Math.min(end, hourEvent);
    }
    const windowDays = stage === '孕早期' ? nonnegative(hooks.superfetationWindowDays?.(profile)) : 0;
    const superfetation = windowDays > effectiveStart;
    const canFertilize = (isNatural(stage) && stage !== '月经期') || superfetation;
    const events = advancePooledConception(base, end, {
      volumeFactor: hooks.volumeFactor ? hooks.volumeFactor(profile) : 1,
      sourceRate: (source) => hooks.sourceRate ? hooks.sourceRate(profile, source) : 1,
      canFertilize,
      timeScale: superfetation ? { initial: 0.35 * (1 - effectiveStart / windowDays),
        slopePerDay: -0.35 * speed / windowDays } : { initial: 1, slopePerDay: 0 },
      stopAtFirstEvent: true,
    });
    const stopped = pool.lastMinute;
    if (stopped < now || (stopped === now && events.length === 0)) throw new Error('混合池调度没有推进时间或产生事件。');
    const spanDays = (stopped - now) / DAY;
    // 先把钟推进到真实受精时刻，新胎创建时才会读取正确孕龄。
    if (pregnantStage) {
      pregnant.pregnantDays = pregnantStart + spanDays;
      pregnant.effectivePregnantDays = effectiveStart + spanDays * speed;
      base.days = daysStart + spanDays * speed;
      plan.pregnancyMinutes += stopped - now;
    } else if (stage === '假孕期') {
      pregnant.pregnantDays = pregnantStart + spanDays;
    } else if (isNatural(stage) || stage === '产后恢复') base.days = daysStart + spanDays;
    if (stopped > now) plan.spans.push({ fromMinute: now, toMinute: stopped, stage,
      daysStart, daysEnd: nonnegative(base.days), pregnantDaysStart: pregnantStart,
      pregnantDaysEnd: nonnegative(pregnant.pregnantDays), effectiveDaysStart: effectiveStart,
      effectiveDaysEnd: nonnegative(pregnant.effectivePregnantDays), gestationSpeed: speed });
    now = stopped;
    waiting();
    if (events.length > 0) {
      const from = String(base.stage || '');
      if (!hooks.onConception) throw new Error('受精事件需要 onConception 回调。');
      hooks.onConception(profile, events, { stage, atMinute: now, superfetation });
      // 第一颗才启动本批共用等待钟；后来的受精事件沿用首颗的持久锚点。
      if (!kind && pendingKind(profile)) {
        pool.timelineImplantStartMinute = now;
        base.fertilizationDays = 0;
      }
      recordTransition(from);
      waiting();
      settleFusion(true);
    }
    // 日事件按刚结束跨度的旧阶段结算；新入排卵期等严格后继的全日事件。
    if (reached(now, hourEvent) && stage === '月经期') clearPhysical();
    if (reached(now, dayEvent)) {
      if (stage === '排卵期' && !profile.cooldown?.naturalOvulationUsed) hooks.onOvulation?.(profile, now);
      else if (isNatural(stage) && stage !== '排卵期' && stage !== '月经期') base.eggs = Math.max(0, nonnegative(base.eggs) - 1);
      syncPooledEggs(base, now);
    }
    settleImmediate();
  }
  hooks.onCapacity?.(profile, now);
  syncPooledEggs(base, now);
  return plan;
}
