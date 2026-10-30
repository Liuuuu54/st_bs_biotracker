import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePooledTimeline } from '../scripts/pooled_timeline.js';
import { enablePooledConception, projectPooledSperms } from '../scripts/pooled_reproduction.js';
import { integrateSpermPoolRisk } from '../scripts/sperm_pool.js';
import { MENSTRUAL_STAGE_DAYS } from '../scripts/stage_config.js';

// 这些模拟回调只证明调度顺序和钟，不代替宿主真实生物学验收。
const DAY = 1440;
const copy = (value) => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 2e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
function make({ stage = '卵泡期', days = 0, eggs = 0, sources = [], minute = 0,
  fertilizationDays = 0, pregnantDays = 0, effectiveDays = 0, fetuses = [] } = {}) {
  const profile = { base: { stage, days, eggs, fertilizationDays, spermContacts: sources, sperms: [], vitality: 77 },
    pregnant: { pregnantDays, effectivePregnantDays: effectiveDays, fetuses }, cooldown: {}, bio: { untouched: 42 },
    metabolism: { untouched: 12 } };
  enablePooledConception(profile.base, minute, { seed: '时间线固定种子' });
  return profile;
}
function mockHooks(trace = [], overrides = {}) {
  return {
    stageLimit: (_, stage) => MENSTRUAL_STAGE_DAYS[stage] ?? ({ 产后恢复: 2, 假孕期: 3 })[stage] ?? null,
    implantationDays: () => 2,
    gestationSpeed: () => 1,
    superfetationWindowDays: () => 90,
    sourceRate: () => 1,
    onConception: (profile, events, context) => {
      trace.push({ type: '受精', ...context, pregnantDays: profile.pregnant.pregnantDays,
        effectiveDays: profile.pregnant.effectivePregnantDays, stageDays: profile.base.days,
        events: events.map(({ eggId, atMinute, minute }) => ({ eggId, atMinute, minute })) });
      for (const event of events) profile.pregnant.fetuses.push({ eggId: event.eggId,
        ...(context.superfetation ? { pendingImplantation: true } : {}) });
    },
    onImplantation: (profile, context) => {
      trace.push({ type: '着床', ...context });
      if (context.superfetation) {
        for (const fetus of profile.pregnant.fetuses) delete fetus.pendingImplantation;
      } else {
        profile.base.stage = '孕早期';
        profile.base.days = 14;
        profile.pregnant.pregnantDays = 14;
        profile.pregnant.effectivePregnantDays = 14;
      }
      profile.base.fertilizationDays = 0;
    },
    onPhaseChange: (profile, context) => {
      trace.push({ type: '阶段', ...context });
      if (context.to === '卵泡期') profile.cooldown.naturalOvulationUsed = false;
      if (context.to === '月经期') {
        profile.base.eggs = 0;
        profile.base.spermContacts = profile.base.spermContacts.map((source) => ({ ...source, value: 0 }));
        profile.pregnant.fetuses = [];
        profile.base.fertilizationDays = 0;
        profile.pregnant.pregnantDays = 0;
        profile.pregnant.effectivePregnantDays = 0;
        projectPooledSperms(profile.base);
      }
      if (context.from === '孕早期' && context.to !== '孕早期') {
        profile.pregnant.fetuses = profile.pregnant.fetuses.filter((fetus) => !fetus.pendingImplantation);
        profile.base.fertilizationDays = 0;
      }
      return context.to;
    },
    onOvulation: (profile, atMinute) => {
      trace.push({ type: '排卵', atMinute });
      profile.base.eggs += 1;
      profile.cooldown.naturalOvulationUsed = true;
    },
    onFusion: (_, context) => trace.push({ type: '融合', ...context }),
    ...overrides,
  };
}
function setThreshold(profile, index, days, options = {}) {
  const hazard = integrateSpermPoolRisk(profile.base.spermContacts, days, options).hazard;
  Object.assign(profile.base.spermPool.eggs[index], { threshold: hazard, remainingHazard: hazard });
}
const source = () => ({ id: 1, male: '甲', value: 1000, quality: 1 });

test('起点必须对齐混合池且零跨度保持状态', () => {
  const profile = make();
  const before = copy(profile);
  assert.equal(advancePooledTimeline(profile, { fromMinute: 0, toMinute: 0 }).spans.length, 0);
  assert.deepEqual(profile, before);
  assert.throws(() => advancePooledTimeline(profile, { fromMinute: 1, toMinute: 2 }), /lastMinute/);
  assert.throws(() => advancePooledTimeline(profile, { fromMinute: 0, toMinute: -1 }), /分钟区间/);
  assert.throws(() => advancePooledTimeline({ base: {} }, { fromMinute: 0, toMinute: 2 }), /pooled-v1/);
});

test('空物料全年只按阶段和必要卵事件推进而不逐小时扫描', () => {
  const profile = make();
  const trace = [];
  let capacities = 0;
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 365 * DAY }, mockHooks(trace, {
    onCapacity: () => { capacities += 1; },
  }));
  assert.ok(plan.spans.length < 110);
  assert.ok(capacities < 112);
  assert.ok(plan.transitions.length > 45);
  assert.ok(trace.filter((event) => event.type === '排卵').length >= 12);
  assert.equal(profile.base.spermPool.lastMinute, 365 * DAY);
  assert.equal(plan.enteredFollicular, true);
  assert.equal(plan.pregnancyMinutes, 0);
  assert.deepEqual(profile.metabolism, { untouched: 12 });
  assert.deepEqual(profile.bio, { untouched: 42 });
  assert.equal(profile.base.vitality, 77);
});

test('入排卵期与全日同刻也等待严格后继全日且不受旧卵数影响', () => {
  for (const eggs of [0, 2]) {
    const profile = make({ days: 8, eggs });
    const trace = [];
    advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace));
    assert.equal(profile.base.stage, '排卵期');
    assert.equal(trace.filter((event) => event.type === '排卵').length, 0);
    advancePooledTimeline(profile, { fromMinute: DAY, toMinute: 2 * DAY }, mockHooks(trace));
    const ovulations = trace.filter((event) => event.type === '排卵');
    assert.equal(ovulations.length, 1);
    assert.equal(ovulations[0].atMinute, 2 * DAY);
  }
});

test('非排卵自然阶段按日carry失卵且无物料仍结算', () => {
  const profile = make({ eggs: 3, minute: 100 });
  const plan = advancePooledTimeline(profile, { fromMinute: 100, toMinute: 111, dayCarryMinutes: 1430 }, mockHooks());
  assert.equal(profile.base.eggs, 2);
  assert.equal(plan.spans[0].toMinute, 110);
  assert.equal(profile.base.spermPool.eggs.length, 2);
});

test('起始月经无受精并在第一个全小时清空物理量保留接触', () => {
  const profile = make({ stage: '月经期', eggs: 2, sources: [source()] });
  const trace = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 1000, hourCarryMinutes: 50 }, mockHooks(trace));
  assert.equal(plan.spans[0].toMinute, 10);
  assert.equal(plan.spans.length, 2);
  assert.equal(profile.base.eggs, 0);
  assert.equal(profile.base.spermContacts.length, 1);
  assert.equal(profile.base.spermContacts[0].value, 0);
  assert.equal(profile.base.sperms.length, 0);
  assert.equal(trace.filter((event) => event.type === '受精').length, 0);
});

test('连续受精时刻先更新生殖钟展示取ceil且首胎才启动等待', () => {
  const profile = make({ eggs: 1, sources: [source()] });
  setThreshold(profile, 0, 0.123456);
  const trace = [];
  advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace));
  const conception = trace.find((event) => event.type === '受精');
  close(conception.atMinute, 0.123456 * DAY);
  close(conception.stageDays, 0.123456);
  assert.equal(conception.events[0].minute, Math.ceil(conception.atMinute));
  close(profile.base.spermPool.timelineImplantStartMinute, conception.atMinute);
  close(profile.base.fertilizationDays, 1 - 0.123456);
});

test('新受精等待期按首胎真实时刻启动且着床后仅剩余跨度计孕钟', () => {
  const profile = make({ eggs: 1, sources: [source()] });
  setThreshold(profile, 0, 0.25);
  const trace = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 2 * DAY }, mockHooks(trace, {
    implantationDays: () => 1,
  }));
  close(plan.implantationEvents[0].atMinute, 1.25 * DAY);
  close(plan.pregnancyMinutes, 0.75 * DAY);
  close(profile.pregnant.pregnantDays, 14.75);
  close(profile.pregnant.effectivePregnantDays, 14.75);
  assert.equal(profile.base.fertilizationDays, 0);
  assert.equal('timelineImplantStartMinute' in profile.base.spermPool, false);
});

test('已有等待从fertilizationDays还原锚点且追加受精不重启', () => {
  const profile = make({ eggs: 1, sources: [source()], fetuses: [{ eggId: '旧胎' }], fertilizationDays: 0.75 });
  setThreshold(profile, 0, 0.1);
  const trace = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace, {
    implantationDays: () => 1,
  }));
  close(plan.implantationEvents[0].atMinute, 0.25 * DAY);
  close(plan.pregnancyMinutes, 0.75 * DAY);
  assert.equal(profile.pregnant.fetuses.length, 2);
  assert.equal(trace.filter((event) => event.type === '着床').length, 1);
});

test('共用等待锚和融合去重跨JSON恢复保持首胎到期', () => {
  const initial = make({ eggs: 0, fetuses: [{ eggId: 1 }], fertilizationDays: 0.25 });
  const trace = [];
  advancePooledTimeline(initial, { fromMinute: 0, toMinute: DAY }, mockHooks(trace));
  const restored = copy(initial);
  close(restored.base.spermPool.timelineImplantStartMinute, -0.25 * DAY);
  advancePooledTimeline(restored, { fromMinute: DAY, toMinute: 2 * DAY }, mockHooks(trace));
  const fusion = trace.filter((event) => event.type === '融合');
  assert.equal(fusion.length, 1);
  close(fusion[0].atMinute, 0.75 * DAY);
  const implantation = trace.find((event) => event.type === '着床');
  close(implantation.atMinute, 1.75 * DAY);
});

test('满一天融合边界只查一次且之后的新普通受精立刻重查', () => {
  const profile = make({ eggs: 1, sources: [source()], fetuses: [{ eggId: '旧胎' }], fertilizationDays: 0.5 });
  setThreshold(profile, 0, 0.75);
  const trace = [];
  advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace, { implantationDays: () => 3 }));
  const fusion = trace.filter((event) => event.type === '融合');
  assert.equal(fusion.length, 2);
  close(fusion[0].atMinute, 0.5 * DAY);
  close(fusion[1].atMinute, 0.75 * DAY);
});

test('异期首事件立即改变孕速并让后续受精读取当前连续孕龄', () => {
  const initial = make({ stage: '孕早期', days: 55.5, eggs: 2, sources: [source()],
    pregnantDays: 55.5, effectiveDays: 55.5, fetuses: [{ eggId: '主胎' }] });
  const scale = { initial: 0.35 * (1 - 55.5 / 90), slopePerDay: -0.35 / 90 };
  setThreshold(initial, 0, 0.1, { timeScale: scale });
  setThreshold(initial, 1, 0.3, { timeScale: scale });
  const run = (sliced) => {
    let profile = copy(initial);
    const trace = [];
    const hooks = mockHooks(trace, { gestationSpeed: (value) => value.pregnant.fetuses.length > 1 ? 0.2 : 1,
      implantationDays: () => 10 });
    if (sliced) {
      let from = 0;
      for (const to of [30, 149, 700, DAY, 3 * DAY]) {
        advancePooledTimeline(profile, { fromMinute: from, toMinute: to,
          dayCarryMinutes: from % DAY, hourCarryMinutes: from % 60 }, hooks);
        profile = copy(profile);
        from = to;
      }
    } else advancePooledTimeline(profile, { fromMinute: 0, toMinute: 3 * DAY }, hooks);
    return { profile, events: trace.filter((event) => event.type === '受精') };
  };
  const whole = run(false);
  const sliced = run(true);
  assert.equal(whole.events.length, 2);
  close(whole.events[0].atMinute, 0.1 * DAY);
  close(whole.events[0].effectiveDays, 55.6);
  close(whole.events[1].effectiveDays, 55.6 + (whole.events[1].atMinute / DAY - 0.1) * 0.2);
  for (let index = 0; index < whole.events.length; index += 1) {
    close(whole.events[index].atMinute, sliced.events[index].atMinute);
    close(whole.events[index].effectiveDays, sliced.events[index].effectiveDays);
  }
  close(whole.profile.pregnant.effectivePregnantDays, sliced.profile.pregnant.effectivePregnantDays);
  assert.equal(whole.profile.base.eggs, 0);
});

test('异期窗口线性风险到W归零而物理清除继续且孕期无每日卵损失', () => {
  const profile = make({ stage: '孕早期', days: 89, eggs: 1, sources: [source()],
    pregnantDays: 89, effectiveDays: 89, fetuses: [{ eggId: '主胎' }] });
  const original = copy(profile.base.spermContacts);
  Object.assign(profile.base.spermPool.eggs[0], { threshold: 1e6, remainingHazard: 1e6 });
  const scale = { initial: 0.35 * (1 - 89 / 90), slopePerDay: -0.35 / 90 };
  const expected = integrateSpermPoolRisk(original, 3, { timeScale: scale });
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 3 * DAY }, mockHooks());
  close(plan.spans[0].toMinute, DAY);
  close(profile.base.spermPool.eggs[0].remainingHazard, 1e6 - expected.hazard);
  close(profile.base.spermContacts[0].value, 970);
  assert.equal(profile.base.eggs, 1);
});

test('孕日56窗口与全部孕阶段边界分段并累计准确孕期分钟', () => {
  const profile = make({ stage: '孕早期', days: 55, pregnantDays: 55, effectiveDays: 55,
    fetuses: [{ eggId: '主胎' }] });
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 250 * DAY }, mockHooks());
  assert.deepEqual(plan.spans.map((span) => Math.round(span.effectiveDaysEnd)), [56, 90, 98, 196, 259, 294, 305]);
  assert.deepEqual(plan.transitions.map((event) => event.to), ['孕中期', '孕晚期', '临产期', '逾期']);
  assert.equal(plan.pregnancyMinutes, 250 * DAY);
  assert.equal(profile.base.stage, '逾期');
  close(profile.base.days, 11);
});

test('已到期异期着床优先同刻孕中期边界以免被阶段清理', () => {
  const profile = make({ stage: '孕早期', days: 97, pregnantDays: 97, effectiveDays: 97,
    fertilizationDays: 0.75, fetuses: [{ eggId: '主胎' }, { eggId: '新胎', pendingImplantation: true }] });
  const trace = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 0.5 * DAY }, mockHooks(trace, {
    gestationSpeed: () => 4, implantationDays: () => 1,
  }));
  assert.equal(plan.implantationEvents.length, 1);
  assert.equal(plan.implantationEvents[0].superfetation, true);
  close(plan.implantationEvents[0].atMinute, 0.25 * DAY);
  assert.equal(profile.pregnant.fetuses.length, 2);
  assert.deepEqual(trace.filter((event) => ['着床', '阶段'].includes(event.type)).map((event) => event.type), ['着床', '阶段']);
});

test('着床尚未到期先到孕中期则阶段回调仅清本批并撤销等待锚', () => {
  const profile = make({ stage: '孕早期', days: 97, pregnantDays: 97, effectiveDays: 97,
    fertilizationDays: 0.5, fetuses: [{ eggId: '主胎' }, { eggId: '新胎', pendingImplantation: true }] });
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks([], {
    gestationSpeed: () => 4, implantationDays: () => 2,
  }));
  assert.equal(plan.implantationEvents.length, 0);
  assert.equal(profile.pregnant.fetuses.length, 1);
  assert.equal(profile.base.fertilizationDays, 0);
  assert.equal('timelineImplantStartMinute' in profile.base.spermPool, false);
});

test('普通着床优先同刻月经边界而不是先被冲走', () => {
  const profile = make({ stage: '黄体期', days: 11.5, fertilizationDays: 1.5, fetuses: [{ eggId: 1 }] });
  const trace = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace));
  assert.equal(plan.implantationEvents.length, 1);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(trace.some((event) => event.type === '阶段' && event.to === '月经期'), false);
  close(plan.pregnancyMinutes, 0.5 * DAY);
});

test('阶段回调可原位进入假孕且用hook期限结束而不死循环', () => {
  const profile = make({ stage: '黄体期', days: 11.5 });
  const trace = [];
  const standard = mockHooks(trace);
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 2 * DAY }, mockHooks(trace, {
    stageLimit: (_, stage) => stage === '假孕期' ? 0.5 : MENSTRUAL_STAGE_DAYS[stage],
    onPhaseChange: (value, context) => {
      if (context.from === '黄体期' && context.to === '月经期') {
        value.base.stage = '假孕期';
        value.pregnant.pregnantDays = 0;
        return;
      }
      return standard.onPhaseChange(value, context);
    },
  }));
  assert.deepEqual(plan.transitions.map((event) => event.to), ['假孕期', '月经期']);
  assert.equal(profile.base.stage, '月经期');
  close(profile.base.days, 1);
  assert.equal(profile.pregnant.pregnantDays, 0);
});

test('恢复期限由hook决定而未知和产程钟留给主batch', () => {
  const recovery = make({ stage: '产后恢复', days: 1.5 });
  const plan = advancePooledTimeline(recovery, { fromMinute: 0, toMinute: DAY }, mockHooks());
  close(plan.transitions[0].atMinute, 0.5 * DAY);
  for (const stage of ['未知阶段', '第一产程', '产兆前驱']) {
    const profile = make({ stage, days: 7, eggs: 1, sources: [source()], pregnantDays: 280, effectiveDays: 280 });
    profile.pregnant.laborHours = 4;
    const otherPlan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks());
    assert.equal(profile.base.days, 7);
    assert.equal(profile.pregnant.pregnantDays, 280);
    assert.equal(profile.pregnant.effectivePregnantDays, 280);
    assert.equal(profile.pregnant.laborHours, 4);
    assert.equal(profile.base.eggs, 1);
    assert.equal(profile.base.spermContacts[0].value, 0);
    assert.equal(otherPlan.spans.length, 1);
    assert.equal(otherPlan.pregnancyMinutes, 0);
  }
});

test('冻结孕速不制造孕日边界但真实等待仍继续', () => {
  const profile = make({ stage: '孕早期', days: 55, pregnantDays: 55, effectiveDays: 55,
    fertilizationDays: 0.5, fetuses: [{ eggId: '主胎' }, { eggId: '新胎', pendingImplantation: true }] });
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 2 * DAY }, mockHooks([], {
    gestationSpeed: () => 0, implantationDays: () => 1,
  }));
  close(plan.implantationEvents[0].atMinute, 0.5 * DAY);
  close(profile.pregnant.pregnantDays, 57);
  close(profile.pregnant.effectivePregnantDays, 55);
  assert.equal(plan.transitions.length, 0);
});

test('独立容量台阶在真实边界回调且不制造阶段或卵事件', () => {
  const profile = make({ sources: [source()] });
  const trace = [];
  const capacityChecks = [];
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: DAY }, mockHooks(trace, {
    nextCapacityMinute: (_, now) => [100, 300].find((boundary) => boundary > now) ?? Infinity,
    onCapacity: (value, now) => {
      capacityChecks.push(now);
      if (now === 100) value.base.spermContacts[0].value = Math.min(value.base.spermContacts[0].value, 50);
    },
  }));
  assert.deepEqual(plan.spans.map((span) => span.toMinute), [100, 300, DAY]);
  assert.deepEqual(capacityChecks, [0, 100, 300, DAY]);
  assert.equal(trace.length, 0);
  assert.equal(plan.transitions.length, 0);
  assert.equal(profile.base.eggs, 0);
  close(profile.base.spermContacts[0].value, 50 - (DAY - 100) / DAY * 10);
});

test('空池月经日事件在不规则切片及JSON后与整段一致', () => {
  const initial = make({ days: 8.25, eggs: 2 });
  const whole = copy(initial);
  const wholeTrace = [];
  advancePooledTimeline(whole, { fromMinute: 0, toMinute: 80 * DAY,
    dayCarryMinutes: 333, hourCarryMinutes: 33 }, mockHooks(wholeTrace));
  let sliced = copy(initial);
  const slicedTrace = [];
  let from = 0;
  for (const to of [17, 199, DAY, 13000, 37000, 80000, 80 * DAY]) {
    advancePooledTimeline(sliced, { fromMinute: from, toMinute: to,
      dayCarryMinutes: (333 + from) % DAY, hourCarryMinutes: (33 + from) % 60 }, mockHooks(slicedTrace));
    sliced = copy(sliced);
    from = to;
  }
  assert.equal(whole.base.stage, sliced.base.stage);
  assert.equal(whole.base.eggs, sliced.base.eggs);
  close(whole.base.days, sliced.base.days);
  const eventKey = (event) => `${event.type}:${event.from ?? ''}:${event.to ?? ''}`;
  assert.deepEqual(wholeTrace.map(eventKey), slicedTrace.map(eventKey));
  for (let index = 0; index < wholeTrace.length; index += 1) close(wholeTrace[index].atMinute, slicedTrace[index].atMinute);
});

test('延产到期交阶段hook转前驱而后续产程钟留宿主', () => {
  const profile = make({ stage: '延产期', days: 69, pregnantDays: 363, effectiveDays: 363,
    fetuses: [{ eggId: '主胎' }] });
  profile.pregnant.extensionUntilDays = 364;
  const plan = advancePooledTimeline(profile, { fromMinute: 0, toMinute: 2 * DAY }, mockHooks());
  assert.equal(plan.transitions[0].to, '产兆前驱');
  close(plan.transitions[0].atMinute, DAY);
  close(plan.pregnancyMinutes, DAY);
  close(profile.pregnant.effectivePregnantDays, 364);
});
