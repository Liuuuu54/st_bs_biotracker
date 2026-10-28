import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceSpermPool, getSpermPoolRates, integrateSpermPool } from '../scripts/sperm_pool.js';
import { isPooledConception, enablePooledConception, syncPooledEggs, projectPooledSperms,
  depositPooledSource, advancePooledConception } from '../scripts/pooled_reproduction.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const total = (base) => base.spermContacts.reduce((sum, source) => sum + source.value, 0);
const close = (a, b, tolerance = 2e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
function make(sources, { eggs = 1, seed = 'reproducible', minute = 0 } = {}) {
  const base = { eggs, sperms: [], spermContacts: sources };
  enablePooledConception(base, minute, { seed });
  return base;
}
function outcome(events) {
  return events.map(({ eggId, minute, winner, winnerSpermId }) => ({ eggId, minute, male: winner.male,
    race: winner.race, quality: winner.quality, bloodline: winner.bloodline, genetic: winner.genetic, winnerSpermId }));
}
function semanticOutcome(events) {
  return outcome(events).map(({ winnerSpermId, ...event }) => event);
}

// These tests import the actual pure kernel, never a mock or substitute implementation.
test('legacy opt-in boundary: helpers leave the old model untouched', () => {
  const base = { eggs: 2, sperms: [{ male: 'A', value: 20 }] };
  const before = copy(base);
  assert.equal(isPooledConception(base), false);
  assert.deepEqual(advancePooledConception(base, 1440), []);
  assert.deepEqual(syncPooledEggs(base, 0), []);
  assert.equal(projectPooledSperms(base), base.sperms);
  assert.deepEqual(base, before);
  assert.throws(() => depositPooledSource(base, { value: 1 }, 20, 0), /Enable/);
});

test('only explicit first enable draws entropy, with crypto preferred and one fallback draw', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalRandom = Math.random;
  let cryptoCalls = 0;
  let fallbackCalls = 0;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (array) => {
      cryptoCalls += 1;
      array[0] = 123456;
      return array;
    } } });
    Math.random = () => { fallbackCalls += 1; return 0.5; };
    const base = { eggs: 2, spermContacts: [], sperms: [] };
    enablePooledConception(base);
    enablePooledConception(base);
    syncPooledEggs(base, 0);
    depositPooledSource(base, { male: 'A', value: 1, quality: 1 }, 20, 0);
    advancePooledConception(base, 1);
    assert.equal(cryptoCalls, 1);
    assert.equal(fallbackCalls, 0);
    assert.equal(base.spermPool.seed, 123456);
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const fallback = { eggs: 1, spermContacts: [], sperms: [] };
    enablePooledConception(fallback);
    enablePooledConception(fallback);
    advancePooledConception(fallback, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(fallback.spermPool.seed, 2147483648);
    make([], { seed: 'explicit' });
    assert.equal(fallbackCalls, 1);
  } finally {
    Math.random = originalRandom;
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('migration prefers frozen contacts and supplements only uncovered legacy residue', () => {
  const base = { eggs: 2, nextSpermContactId: 41,
    spermContacts: [{ id: 7, male: 'A', value: 3, quality: 4, genetic: { token: 'old' } },
      { id: 9, male: 'A', value: 2, quality: 0.25 }],
    sperms: [{ male: 'A', value: 9, quality: 1 }, { male: 'B', value: 2 }] };
  const pool = enablePooledConception(base, 500, { seed: 99 });
  assert.equal(total(base), 11);
  assert.deepEqual(base.spermContacts.find((source) => source.id === 7).genetic, { token: 'old' });
  assert.equal(base.spermContacts.find((source) => source.id === 7).quality, 4);
  assert.equal(base.spermContacts.find((source) => source.male === 'A' && source.pooledLegacy).value, 4);
  assert.equal(pool.migration.legacyResidualSources, 2);
  assert.ok(base.spermContacts.filter((source) => source.pooledLegacy).every((source) => source.id > 41));
  assert.equal(pool.lastMinute, 500);
  assert.ok(pool.eggs.every((egg) => egg.legacy && egg.createdMinute === 500));
  const state = copy(base);
  assert.equal(enablePooledConception(base, 800, { seed: 'ignored' }), pool);
  assert.deepEqual(base, state);
  assert.equal(advancePooledConception(base, 500).length, 0);
});

test('migration never scales down authoritative contacts to stale aggregate values', () => {
  const base = { eggs: 0, spermContacts: [{ id: 1, male: 'A', value: 20, quality: 4 }], sperms: [{ male: 'A', value: 2, quality: 1 }] };
  enablePooledConception(base, 0, { seed: 0 });
  assert.equal(total(base), 20);
  assert.equal(base.sperms[0].value, 20);
});

test('strict source sanitization prevents NaN/Infinity and keeps explicit null genetic snapshots', () => {
  const base = make([{ id: 1, male: 'A', value: Infinity, quality: NaN },
    { id: 2, male: 'B', value: -1, quality: Infinity },
    { id: 3, male: 'C', value: '20', quality: '4' },
    { id: 4, male: 'D', value: 1, quality: 900, bloodline: null }]);
  assert.deepEqual(base.spermContacts.map((source) => source.value), [0, 0, 0, 1]);
  assert.deepEqual(base.spermContacts.map((source) => source.quality), [1, 1, 1, 4]);
  assert.equal(base.spermContacts.at(-1).bloodline, null);
  assert.doesNotMatch(JSON.stringify(base), /NaN|Infinity/);
  assert.equal(advancePooledConception(base, 1).length, 0);
});

test('eggs have stable seeded budgets, oldest-first removal and monotonic identities', () => {
  const base = make([], { eggs: 3, seed: 'eggs' });
  const original = copy(base.spermPool.eggs);
  base.eggs = 2;
  syncPooledEggs(base, 0);
  assert.deepEqual(base.spermPool.eggs, original.slice(1));
  base.eggs = 4;
  syncPooledEggs(base, 0);
  assert.deepEqual(base.spermPool.eggs.slice(0, 2), original.slice(1));
  assert.deepEqual(base.spermPool.eggs.map((egg) => egg.eggId), [2, 3, 4, 5]);
  const compare = make([], { eggs: 5, seed: 'eggs' });
  assert.deepEqual(base.spermPool.eggs.map((egg) => egg.threshold), compare.spermPool.eggs.slice(1).map((egg) => egg.threshold));
  base.eggs = 0;
  syncPooledEggs(base, 0);
  base.eggs = 1;
  syncPooledEggs(base, 0);
  assert.equal(base.spermPool.eggs[0].eggId, 6);
  assert.throws(() => syncPooledEggs(base, 1), /event minute/);
});

test('same physical 20 versus 10+10 retains volume, hazard, integer event minute and father', () => {
  for (let seed = 0; seed < 12; seed += 1) {
    const whole = make([{ id: 1, male: 'A', race: 'human', value: 20, quality: 1 }], { eggs: 3, seed });
    const split = make([{ id: 2, male: 'A', race: 'human', value: 10, quality: 1 }, { id: 3, male: 'A', race: 'human', value: 10, quality: 1 }], { eggs: 3, seed });
    const options = { sourceRate: () => 8 };
    const a = advancePooledConception(whole, 1440, options);
    const b = advancePooledConception(split, 1440, options);
    close(total(whole), total(split));
    assert.deepEqual(semanticOutcome(a), semanticOutcome(b));
    a.forEach((event, i) => {
      close(event.winnerPhysicalAmount, b[i].winnerPhysicalAmount);
      close(event.poolPhysicalAmount, b[i].poolPhysicalAmount);
      close(event.activePhysicalAmount, b[i].activePhysicalAmount);
      close(event.winnerPhysicalAmount, event.winner.value);
      close(b[i].winnerPhysicalAmount, 2 * b[i].winner.value);
      assert.equal(b[i].winnerSpermId, b[i].winner.id);
    });
    assert.equal(whole.eggs, split.eggs);
    whole.spermPool.eggs.forEach((egg, i) => close(egg.remainingHazard, split.spermPool.eggs[i].remainingHazard));
  }
});

const mixed = () => [
  { id: 4, male: 'A', race: 'human', value: 20, quality: 0.25, genetic: { allele: 'old', unknown: null } },
  { id: 8, male: 'A', race: 'elf', value: 15, quality: 4, genetic: { allele: 'new' } },
  { id: 12, male: 'B', race: 'human', value: 35, quality: 2, genetic: { allele: 'B' } },
];
const pairing = (source) => source.race === 'elf' ? 3 : 8;

test('mixed-quality day/hour/minute slicing and JSON restart are exactly identical', () => {
  const baseline = make(mixed(), { eggs: 5, seed: 'slicing' });
  const day = copy(baseline);
  const hour = copy(baseline);
  let minutes = copy(baseline);
  const opts = { volumeFactor: 1.2, sourceRate: pairing };
  const expected = advancePooledConception(day, 1440, opts);
  const hourly = [];
  for (let minute = 60; minute <= 1440; minute += 60) hourly.push(...advancePooledConception(hour, minute, opts));
  const minutely = [];
  for (let minute = 1; minute <= 1440; minute += 1) {
    if ([17, 60, 719, 1000].includes(minute)) minutes = copy(minutes);
    minutely.push(...advancePooledConception(minutes, minute, opts));
  }
  assert.ok(expected.length > 0, 'fixture must exercise actual fertilization');
  assert.deepEqual(hourly, expected);
  assert.deepEqual(minutely, expected);
  assert.deepEqual(hour, day);
  assert.deepEqual(minutes, day);
});

test('canonical source permutation leaves events, winner snapshots and persisted state identical', () => {
  const a = make(mixed(), { eggs: 6, seed: 'order' });
  const b = make(mixed().reverse(), { eggs: 6, seed: 'order' });
  b.spermContacts.reverse();
  const eventsA = advancePooledConception(a, 600, { sourceRate: pairing });
  const eventsB = advancePooledConception(b, 600, { sourceRate: pairing });
  assert.deepEqual(eventsA, eventsB);
  assert.deepEqual(a, b);
});

test('splitting one frozen semantic snapshot preserves seeded male/snapshot selection', () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const whole = make(mixed(), { eggs: 2, seed });
    const rows = mixed();
    const old = rows.shift();
    const split = make([...rows, { ...old, id: 20, value: 5 }, { ...old, id: 21, value: 15 }], { eggs: 2, seed });
    const options = { sourceRate: () => 30 };
    assert.deepEqual(semanticOutcome(advancePooledConception(whole, 240, options)), semanticOutcome(advancePooledConception(split, 240, options)));
  }
});

test('winnerPhysicalAmount is the event-time male/snapshot group, without changing the source winner', () => {
  const sources = [
    { id: 1, male: 'A', value: 7, quality: 1, genetic: { allele: 'same' }, minutesPassed: 0 },
    { id: 2, male: 'A', value: 13, quality: 1, genetic: { allele: 'same' }, minutesPassed: 5 },
    { id: 3, male: 'A', value: 27, quality: 4, genetic: { allele: 'same' } },
    { id: 4, male: 'A', value: 17, quality: 1, genetic: { allele: 'different' } },
    { id: 5, male: 'B', value: 26, quality: 1, genetic: { allele: 'same' } },
    { id: 6, male: 'blocked', value: 10, quality: 2, genetic: { allele: 'blocked' }, blocked: true },
  ];
  for (const selectedId of [1, 3, 4, 5]) {
    const base = make(sources, { seed: `group-${selectedId}` });
    const start = copy(base.spermContacts);
    const sourceRate = (source) => source.id === selectedId ? 1000 : 0;
    const options = { sourceRates: start.map(sourceRate) };
    const threshold = integrateSpermPool(start, 1 / 1440, options).hazard / 2;
    Object.assign(base.spermPool.eggs[0], { threshold, remainingHazard: threshold });
    const [event] = advancePooledConception(base, 1, { sourceRate });
    const eventSources = advanceSpermPool(start, event.eventOffsetDays);
    const actualWinner = eventSources.find((source) => source.id === event.winnerSpermId);
    assert.equal(event.winnerSpermId, selectedId);
    assert.deepEqual(event.winner, actualWinner);
    const group = eventSources.filter((source) => source.male === actualWinner.male
      && source.quality === actualWinner.quality && source.genetic.allele === actualWinner.genetic.allele);
    close(event.winnerPhysicalAmount, group.reduce((sum, source) => sum + source.value, 0));
    close(event.poolPhysicalAmount, eventSources.reduce((sum, source) => sum + source.value, 0));
    close(event.activePhysicalAmount, eventSources.filter((source) => source.blocked !== true).reduce((sum, source) => sum + source.value, 0));
    assert.ok(event.winnerPhysicalAmount < event.activePhysicalAmount);
    assert.ok(event.activePhysicalAmount < event.poolPhysicalAmount);
    close(event.poolPhysicalAmount - event.activePhysicalAmount, eventSources.find((source) => source.id === 6).value);
    if (selectedId === 1) {
      assert.equal(group.length, 2);
      // The second same-snapshot contact has zero pairing risk but still physical volume.
      assert.ok(event.winnerPhysicalAmount > event.winner.value);
    } else assert.equal(group.length, 1);
  }
});

test('mixed q snapshots stay separate and projection uses a physical weighted quality', () => {
  const base = make([], { eggs: 0 });
  const old = { male: 'A', value: 10, quality: 0.25, genetic: { marker: 'old' }, bloodline: null };
  depositPooledSource(base, old, 100, 0);
  old.genetic.marker = 'mutated';
  depositPooledSource(base, { male: 'A', value: 10, quality: 4, genetic: { marker: 'new' } }, 100, 0);
  assert.deepEqual(base.spermContacts.map((source) => source.quality), [0.25, 4]);
  assert.deepEqual(base.spermContacts.map((source) => source.genetic.marker), ['old', 'new']);
  assert.equal(base.spermContacts[0].bloodline, null);
  assert.equal(base.sperms[0].quality, 1.5625);
  base.sperms[0].quality = 4;
  projectPooledSperms(base);
  assert.equal(base.spermContacts[0].quality, 0.25);
});

test('continuous full-pool overflow agrees for 20 versus 10+10 across JSON commits', () => {
  const initial = make([{ id: 7, male: 'old', value: 20, quality: 1 }], { eggs: 0 });
  const a = copy(initial);
  let b = copy(initial);
  const incoming = { male: 'new', value: 20, quality: 4, genetic: { allele: 'frozen' } };
  const spillA = depositPooledSource(a, incoming, 20, 0).spilled;
  const first = depositPooledSource(b, { ...incoming, value: 10 }, 20, 0).spilled;
  b = copy(b);
  const second = depositPooledSource(b, { ...incoming, value: 10 }, 20, 0).spilled;
  close(spillA, first + second);
  close(total(a), 20);
  close(total(b), 20);
  for (const male of ['old', 'new']) close(a.sperms.find((source) => source.male === male).value, b.sperms.find((source) => source.male === male).value);
  assert.equal(b.spermContacts.filter((source) => source.male === 'new').length, 2);
  const previous = b.spermPool.sourceSequence;
  advancePooledConception(b, 10000, { canFertilize: false });
  assert.equal(b.spermContacts.length, 3);
  assert.ok(b.spermContacts.every((source) => source.value === 0));
  assert.deepEqual(b.sperms, []);
  depositPooledSource(b, incoming, 0, 10000);
  depositPooledSource(b, incoming, 20, 10000);
  assert.equal(b.spermContacts.length, 5);
  assert.equal(b.spermContacts.find((source) => source.value > 0).id, previous + 2);
  assert.equal(b.nextSpermContactId, previous + 2);
});

test('zero-volume canonical contacts retain winner linkage and frozen snapshots after drainage and overflow', () => {
  let base = make([{ id: 70, male: 'old', race: 'human', value: 0.001, quality: 4,
    bloodline: null, genetic: { marker: 'historical' } }], { seed: 'retain-history' });
  const threshold = integrateSpermPool(base.spermContacts, 1 / 1440).hazard / 2;
  Object.assign(base.spermPool.eggs[0], { threshold, remainingHazard: threshold });
  const [event] = advancePooledConception(base, 1);
  assert.equal(event.winnerSpermId, 70);
  // Active risk advancement has already exhausted this tiny source in the same minute.
  assert.equal(base.spermContacts.length, 1);
  assert.equal(base.spermContacts[0].value, 0);
  assert.deepEqual(base.sperms, []);
  const historical = copy(base.spermContacts[0]);
  base = copy(base);
  advancePooledConception(base, 10, { canFertilize: false });
  assert.deepEqual(base.spermContacts.find((source) => source.id === event.winnerSpermId), historical);
  assert.deepEqual(historical.genetic, { marker: 'historical' });
  assert.equal(historical.bloodline, null);
  const next = base.spermPool.sourceSequence + 1;
  depositPooledSource(base, { male: 'overflow', value: 5, quality: 1, genetic: { marker: 'zero-capacity' } }, 0, 10);
  assert.equal(base.spermContacts.find((source) => source.id === next).value, 0);
  assert.deepEqual(base.spermContacts.find((source) => source.id === next).genetic, { marker: 'zero-capacity' });
  depositPooledSource(base, { male: 'new', value: 2, quality: 1 }, 10, 10);
  assert.equal(base.spermContacts.find((source) => source.male === 'new').id, next + 1);
  assert.equal(base.spermPool.sourceSequence, next + 1);
  assert.equal(base.nextSpermContactId, next + 1);
  assert.deepEqual(base.spermContacts.find((source) => source.id === event.winnerSpermId), historical);
  assert.deepEqual(base.sperms.map((source) => source.male), ['new']);
  assert.ok(getSpermPoolRates(base.spermContacts).filter((source) => source.value === 0).every((source) => source.rate === 0));
});

test('no eggs and guarded fertility both keep physical clearance running', () => {
  const empty = make([{ id: 1, male: 'A', value: 20, quality: 1 }], { eggs: 0 });
  assert.deepEqual(advancePooledConception(empty, 1440), []);
  close(total(empty), 10);
  const guarded = make([{ id: 1, male: 'A', value: 20, quality: 1 }]);
  const egg = copy(guarded.spermPool.eggs[0]);
  assert.deepEqual(advancePooledConception(guarded, 1440, { canFertilize: false }), []);
  close(total(guarded), 10);
  assert.deepEqual(guarded.spermPool.eggs[0], egg);
});

test('zero pairing closes risk and new eggs receive no exposure from before their creation', () => {
  const base = make([{ id: 1, male: 'A', value: 20, quality: 1 }], { eggs: 0 });
  advancePooledConception(base, 600);
  base.eggs = 1;
  syncPooledEggs(base, 600);
  const budget = base.spermPool.eggs[0].remainingHazard;
  advancePooledConception(base, 1200, { sourceRate: () => 0 });
  assert.equal(base.spermPool.eggs[0].remainingHazard, budget);
  close(total(base), 20 - 10 * 1200 / 1440);
  const before = copy(base.spermContacts);
  const expected = integrateSpermPool(before, 1 / 1440).hazard;
  advancePooledConception(base, 1201);
  close(base.spermPool.eggs[0].remainingHazard, budget - expected);
});

test('blocked/inactivated material occupies volume and clears, but has zero risk', () => {
  const base = make([{ id: 1, male: 'blocked', value: 20, quality: 1, blocked: true },
    { id: 2, male: 'inactive', value: 20, quality: 1, fertilityStatus: 'inactivated' },
    { id: 3, male: 'absent', value: 20, quality: 1, fertilityStatus: 'not-entered' }]);
  const before = copy(base.spermPool.eggs);
  assert.equal(total(base), 40);
  assert.deepEqual(advancePooledConception(base, 1440, { sourceRate: () => 100 }), []);
  close(total(base), 30);
  assert.deepEqual(base.spermPool.eggs, before);
  assert.equal(base.spermContacts.find((source) => source.male === 'absent').value, 0);
  assert.equal(base.sperms.find((source) => source.male === 'absent'), undefined);
  const spill = depositPooledSource(base, { male: 'new', value: 10, quality: 1 }, 30, 1440).spilled;
  close(spill, 10);
  close(total(base), 30);
});

test('event uses instantaneous first-crossing lambda, not accumulated source hazards', () => {
  const base = make([{ id: 1, male: 'A', value: 0.001, quality: 0.25 }, { id: 2, male: 'B', value: 0.001, quality: 4 }], { seed: 'eventtime' });
  const start = copy(base.spermContacts);
  const integral = integrateSpermPool(start, 1 / 1440);
  const threshold = integral.hazard * 0.9;
  Object.assign(base.spermPool.eggs[0], { threshold, remainingHazard: threshold });
  const [event] = advancePooledConception(base, 1);
  assert.equal(event.minute, 1);
  assert.ok(event.eventOffsetDays > 0 && event.eventOffsetDays < 1 / 1440);
  const rates = getSpermPoolRates(advanceSpermPool(start, event.eventOffsetDays));
  assert.deepEqual(event.candidateContributions.map((source) => source.rate), rates.map((source) => source.rate));
  close(integrateSpermPool(start, event.eventOffsetDays).hazard, threshold, 1e-10);
  const instant = rates[0].rate / (rates[0].rate + rates[1].rate);
  const accumulated = integral.sources[0].hazard / integral.hazard;
  assert.ok(Math.abs(instant - accumulated) > 0.005, 'fixture distinguishes instantaneous and integrated allocation');
  assert.equal(base.eggs, 0);
});

test('exact minute threshold crossing is settled before events at that boundary', () => {
  const base = make([{ id: 1, male: 'old', value: 20, quality: 1 }]);
  const h = integrateSpermPool(base.spermContacts, 1 / 1440).hazard;
  Object.assign(base.spermPool.eggs[0], { threshold: h, remainingHazard: h });
  const events = advancePooledConception(base, 1);
  depositPooledSource(base, { male: 'new', value: 20, quality: 4 }, 100, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].minute, 1);
  assert.equal(events[0].winner.male, 'old');
  assert.equal(base.eggs, 0);
});

test('backwards/fractional time throws without silently recalculating or redrawing', () => {
  const base = make([{ id: 1, male: 'A', value: 20, quality: 1 }], { minute: 10 });
  const before = copy(base);
  assert.throws(() => advancePooledConception(base, 9), /backwards/);
  assert.throws(() => advancePooledConception(base, 10.5), /integer minute/);
  assert.throws(() => depositPooledSource(base, { value: 1 }, 30, 11), /event minute/);
  assert.deepEqual(base, before);
  assert.deepEqual(advancePooledConception(base, 10), []);
  assert.deepEqual(base, before);
});
