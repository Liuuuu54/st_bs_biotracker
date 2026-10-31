import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceSpermPool, integrateSpermPoolRisk, findSpermPoolCrossing } from '../scripts/sperm_pool.js';
import { enablePooledConception, advancePooledConception, syncPooledEggs,
  depositPooledSource, invalidatePooledSegment } from '../scripts/pooled_reproduction.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 2e-10) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const mixed = () => [
  { id: 1, male: '甲', value: 29, quality: 0.25, genetic: { allele: '旧', unknown: null } },
  { id: 2, male: '甲', value: 24, quality: 4, genetic: { allele: '新' } },
  { id: 3, male: '乙', value: 41, quality: 2, genetic: { allele: '乙' } },
];
const sourceRate = (source) => source.id === 2 ? 7 : 11;
function make(sources = mixed(), eggs = 4, minute = 0) {
  const base = { spermContacts: copy(sources), sperms: [], eggs };
  enablePooledConception(base, minute, { seed: '连续事件锚点' });
  return base;
}
function setBudgets(base, times, options = {}) {
  times.forEach((days, index) => {
    const hazard = integrateSpermPoolRisk(base.spermContacts, days, options).hazard;
    Object.assign(base.spermPool.eggs[index], { threshold: hazard, remainingHazard: hazard });
  });
}

test('任意小数分段与JSON恢复保持完整receipt、父方、分钟、冻结快照及最终锚点完全相同', () => {
  const original = make();
  const whole = copy(original);
  let slices = copy(original);
  const options = { sourceRate, volumeFactor: 1.3 };
  const expected = advancePooledConception(whole, 2800.125, options);
  const actual = [];
  for (const until of [0.125, 1.73, 17.6, 59.999, 60.001, 378.25, 719.3, 1440.75, 2800.125]) {
    slices = copy(slices);
    actual.push(...advancePooledConception(slices, until, options));
  }
  assert.ok(expected.length > 0);
  assert.deepEqual(actual, expected);
  assert.deepEqual(slices, whole);
  assert.ok(actual.every((event) => event.atMinute > 0 && event.minute === Math.ceil(event.atMinute)));
  actual.forEach((event) => close(event.atMinute, event.eventOffsetDays * 1440));
  assert.equal(slices.spermPool.segment.anchorMinute, 0);
});

test('超过31天的整段只读取每源一次系数，不枚举固定分钟', () => {
  const base = make(mixed(), 2, 0.75);
  let calls = 0;
  const events = advancePooledConception(base, 100000000.125, { sourceRate: () => { calls += 1; return 30; } });
  assert.equal(calls, 3);
  assert.equal(base.spermPool.lastMinute, 100000000.125);
  assert.ok(base.spermContacts.every((source) => source.value === 0));
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.atMinute < 31 * 1440));
});

test('参数或来源变更在当前时刻重建锚点，保留卵的剩余风险预算', () => {
  const base = make(mixed(), 1);
  Object.assign(base.spermPool.eggs[0], { threshold: 100, remainingHazard: 100 });
  advancePooledConception(base, 13.25, { sourceRate });
  const changes = [
    { options: { sourceRate, volumeFactor: 1.7 } },
    { options: { sourceRate: () => 2, volumeFactor: 1.7 } },
    { mutate: () => { base.spermContacts[0].blocked = true; }, options: { sourceRate: () => 2, volumeFactor: 1.7 } },
    { mutate: () => { base.spermContacts[1].genetic.allele = '外部冻结快照变更'; }, options: { sourceRate: () => 2, volumeFactor: 1.7 } },
    { options: { sourceRate: () => 2, volumeFactor: 1.7, canFertilize: false } },
    { options: { sourceRate: () => 2, volumeFactor: 1.7, canFertilize: true } },
  ];
  for (const { mutate, options } of changes) {
    mutate?.();
    const cursor = base.spermPool.lastMinute;
    const budget = base.spermPool.eggs[0].remainingHazard;
    const physical = copy(base.spermContacts);
    advancePooledConception(base, cursor + 0.375, options);
    assert.equal(base.spermPool.segment.anchorMinute, cursor);
    assert.equal(base.spermPool.segment.eggs[0].remainingHazard, budget);
    assert.equal(base.spermPool.eggs[0].threshold, 100);
    const sourceRates = physical.map(options.sourceRate);
    const hazard = options.canFertilize === false ? 0 : integrateSpermPoolRisk(physical, 0.375 / 1440,
      { volumeFactor: options.volumeFactor, sourceRates }).hazard;
    close(base.spermPool.eggs[0].remainingHazard, budget - hazard);
  }
});

test('卵变化和真实注入显式失效；主动失效及旧JSON无锚点继续保留预算与单调身份', () => {
  let base = make(mixed(), 1);
  Object.assign(base.spermPool.eggs[0], { threshold: 20, remainingHazard: 20 });
  advancePooledConception(base, 12.125, { sourceRate });
  const originalBudget = base.spermPool.eggs[0].remainingHazard;
  base.eggs = 2;
  syncPooledEggs(base, 12.125);
  assert.equal(base.spermPool.segment, undefined);
  assert.equal(base.spermPool.eggs[0].remainingHazard, originalBudget);
  advancePooledConception(base, 12.25, { sourceRate });
  const beforeDeposit = base.spermPool.eggs[0].remainingHazard;
  depositPooledSource(base, { male: '丙', value: 2.5, quality: 4, genetic: { allele: '丙' } }, 100, 12.25);
  assert.equal(base.spermPool.segment, undefined);
  assert.equal(base.spermPool.eggs[0].remainingHazard, beforeDeposit);
  advancePooledConception(base, 12.375, { sourceRate });
  const current = base.spermPool.eggs[0].remainingHazard;
  invalidatePooledSegment(base);
  base = copy(base);
  advancePooledConception(base, 12.5, { sourceRate });
  assert.equal(base.spermPool.segment.anchorMinute, 12.375);
  assert.equal(base.spermPool.segment.eggs[0].remainingHazard, current);
  assert.equal(base.spermContacts.at(-1).id, 4);
  assert.deepEqual(base.spermContacts.at(-1).genetic, { allele: '丙' });
});

test('同线性时间风险在小时、分钟及任意切片中沿原锚点推进', () => {
  const baseline = make(mixed(), 4, 5.125);
  const whole = copy(baseline);
  const initial = 2;
  const slopePerDay = -1.3;
  const optionsAt = (cursor) => ({ sourceRate, timeScale: { initial: initial + slopePerDay * ((cursor - 5.125) / 1440), slopePerDay } });
  const expected = advancePooledConception(whole, 2000.75, optionsAt(5.125));
  for (const step of [1, 60, 127.375]) {
    let sliced = copy(baseline);
    const actual = [];
    for (let cursor = 5.125; cursor < 2000.75;) {
      const until = Math.min(2000.75, cursor + step);
      actual.push(...advancePooledConception(sliced, until, optionsAt(cursor)));
      sliced = copy(sliced);
      cursor = until;
    }
    assert.deepEqual(actual, expected);
    assert.deepEqual(sliced, whole);
    assert.equal(sliced.spermPool.segment.anchorMinute, 5.125);
  }
  assert.ok(expected.length > 0);
});

test('首事件暂停准确返回连续时刻，同刻多卵一起结算后仍使用原锚点', () => {
  const base = make([{ id: 1, male: '甲', value: 50, quality: 1 }], 3, 10.125);
  const options = { sourceRates: [8] };
  setBudgets(base, [0.2, 0.2, 0.5], options);
  const whole = copy(base);
  const expected = advancePooledConception(whole, 1450.125, { sourceRate: () => 8 });
  const first = advancePooledConception(base, 1450.125, { sourceRate: () => 8, stopAtFirstEvent: true });
  assert.equal(first.length, 2);
  assert.equal(first[0].atMinute, first[1].atMinute);
  assert.equal(base.spermPool.lastMinute, first[0].atMinute);
  close(base.spermPool.lastMinute, 10.125 + 0.2 * 1440);
  assert.equal(base.eggs, 1);
  assert.equal(base.spermPool.segment.anchorMinute, 10.125);
  const second = advancePooledConception(base, 1450.125, { sourceRate: () => 8, stopAtFirstEvent: true });
  assert.equal(second.length, 1);
  close(base.spermPool.lastMinute, 10.125 + 0.5 * 1440);
  assert.deepEqual([...first, ...second], expected);
  assert.deepEqual(advancePooledConception(base, 1450.125, { sourceRate: () => 8, stopAtFirstEvent: true }), []);
  assert.deepEqual(base, whole);
});

test('精确物理耗尽端点采用左极限父方权重并保留真实零量快照', () => {
  const base = make([{ id: 1, male: '低品质', value: 2, quality: 0.25 },
    { id: 2, male: '高品质', value: 2, quality: 4 }], 1);
  const budget = integrateSpermPoolRisk(base.spermContacts, Number.MAX_VALUE).hazard;
  Object.assign(base.spermPool.eggs[0], { threshold: budget, remainingHazard: budget });
  const crossing = findSpermPoolCrossing(base.spermContacts, budget);
  const [event] = advancePooledConception(base, crossing * 1440 + 1);
  assert.equal(event.atMinute, crossing * 1440);
  assert.equal(event.winner.male, '高品质');
  assert.equal(event.winner.value, 0);
  assert.equal(event.poolPhysicalAmount, 0);
  assert.ok(event.candidateContributions.every((source) => source.rate === 0));
});

test('连续时刻整分钟首穿稳定ceil且在该边界前的小数调用不提前派发', () => {
  const base = make([{ id: 1, male: '甲', value: 20, quality: 1 }], 1, 0.25);
  setBudgets(base, [0.75 / 1440]);
  const whole = copy(base);
  assert.deepEqual(advancePooledConception(base, 0.999), []);
  const actual = advancePooledConception(base, 1);
  const expected = advancePooledConception(whole, 1);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].minute, 1);
  close(actual[0].atMinute, 1);
  assert.deepEqual(actual, expected);
});

test('旧余量多行保留各自冻结快照，缺失历史接触时间不补造成启用时刻', () => {
  const base = { eggs: 0, spermContacts: [{ id: 9, male: '甲', value: 3, quality: 4, genetic: { allele: '甲' } }],
    sperms: [{ male: '甲', value: 3, quality: 4, genetic: { allele: '甲' } },
      { male: '甲', value: 6, quality: 0.25, genetic: { allele: '乙' } },
      { male: '甲', value: 4, quality: 2, genetic: { allele: '丙' }, minutesPassed: 17.5 }] };
  enablePooledConception(base, 500.25, { seed: 1 });
  const legacy = base.spermContacts.filter((source) => source.pooledLegacy);
  assert.equal(legacy.length, 2);
  assert.equal(legacy.find((source) => source.genetic.allele === '乙').value, 6);
  assert.equal(legacy.find((source) => source.genetic.allele === '乙').minutesPassed, undefined);
  assert.equal(legacy.find((source) => source.genetic.allele === '丙').minutesPassed, 17.5);
  assert.equal(base.spermPool.migration.legacyResidualSources, 2);
  assert.equal(base.spermContacts.reduce((sum, source) => sum + source.value, 0), 13);
  const start = copy(base.spermContacts);
  advancePooledConception(base, 501.125);
  assert.deepEqual(base.spermContacts, advanceSpermPool(start, 0.875 / 1440));
});
