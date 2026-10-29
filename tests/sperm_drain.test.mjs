import assert from 'node:assert/strict';
import test from 'node:test';
import { drainSpermPool } from '../scripts/sperm_pool.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { applyToolCall } from '../scripts/tools.js';
import * as state from '../scripts/state.js';

const near = (a, b, eps = 2e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const sum = (rows) => rows.reduce((n, row) => n + row.value, 0);
const source = (id, value, quality = 1, extra = {}) => ({ id, male: id, race: '人类', value, quality, ...extra });
const clone = (x) => JSON.parse(JSON.stringify(x));
const effortToEmpty = (rows) => rows.reduce((n, row) => n + row.value * Math.sqrt(Math.sqrt(row.quality)), 0);
function conserved(result) {
  near(result.before, result.removed + result.remaining);
  near(result.remaining, sum(result.sources));
  near(result.removed, result.details.reduce((n, row) => n + row.removed, 0));
  const weightedBefore = result.details.reduce((n, row) => n + row.before * row.quality ** .25, 0);
  const effortUsed = result.details.reduce((n, row) => n + row.removed * row.quality ** .25, 0);
  near(effortUsed, Math.min(result.attempted, weightedBefore));
  for (const row of result.details) near(row.before, row.removed + row.remaining);
  assert.ok(result.sources.every((row) => Number.isFinite(row.value) && row.value >= 0));
}

// Independent RK4 directly in the effort domain: no production implicit root reused.
function reference(rows, effort, steps = 4000) {
  let values = rows.map((row) => row.value);
  const h = effort / steps;
  const f = (v) => {
    const V = v.reduce((n, x) => n + x, 0);
    return v.map((x, i) => V > 0 ? -(x / V) / rows[i].quality ** .25 : 0);
  };
  for (let step = 0; step < steps; step++) {
    const a = f(values), b = f(values.map((x, i) => x + h * a[i] / 2));
    const c = f(values.map((x, i) => x + h * b[i] / 2));
    const d = f(values.map((x, i) => x + h * c[i]));
    values = values.map((x, i) => x + h * (a[i] + 2 * b[i] + 2 * c[i] + d[i]) / 6);
  }
  return values;
}

for (const q of [.25, 1, 4]) test(`active effort uses q^(-1/4), quality ${q}`, () => {
  const result = drainSpermPool([source('A', 40, q)], 20);
  near(result.remaining, Math.max(0, 40 - 20 / q ** .25)); conserved(result);
});
test('40/q4: one 20 and two 10 efforts both leave 25.85786437626905', () => {
  const rows = [source('A', 40, 4)];
  const one = drainSpermPool(rows, 20);
  const first = drainSpermPool(rows, 10), two = drainSpermPool(clone(first.sources), 10);
  near(one.remaining, 25.85786437626905); near(two.remaining, one.remaining);
  near(first.removed + two.removed, one.removed); conserved(one); conserved(two);
});
test('effort is not capped by current volume: 80 once and 20 four times both clear q4', () => {
  const rows = [source('A', 40, 4)];
  const one = drainSpermPool(rows, 80);
  let four = rows;
  for (let i = 0; i < 4; i++) four = drainSpermPool(four, 20).sources;
  assert.equal(one.remaining, 0); assert.equal(sum(four), 0);
  assert.equal(one.sources.length, 1); assert.equal(one.sources[0].id, 'A');
});
test('mixed quarter-root closed form is independent of scalar solver and operation splitting', () => {
  const rows = [source('low', 20, .25), source('high', 20, 4)];
  const one = drainSpermPool(rows, 20), two = drainSpermPool(drainSpermPool(rows, 10).sources, 10);
  const lowRoot = .25 ** .25, highRoot = 4 ** .25;
  const target = effortToEmpty(rows) - 20;
  const x = (-20 * highRoot + Math.sqrt((20 * highRoot) ** 2 + 80 * lowRoot * target)) / (40 * lowRoot);
  near(one.sources[0].value, 20 * x * x);
  near(one.sources[1].value, 20 * x);
  near(one.remaining, 19.554967333523752);
  for (let i = 0; i < 2; i++) near(one.sources[i].value, two.sources[i].value);
  reference(rows, 20).forEach((v, i) => near(one.sources[i].value, v)); conserved(one);
});
test('mixed-quality sources match independent effort-domain RK4', () => {
  const rows = [source('A', 17, .3), source('B', 13, 2), source('C', 9, 4, { blocked: true })];
  const result = drainSpermPool(rows, 14);
  reference(rows, 14).forEach((v, i) => near(result.sources[i].value, v)); conserved(result);
});
test('one physical record split into 1..100 preserves active removal and subsequent prediction', () => {
  for (const q of [.25, .3, 1, 2, 4]) for (const n of [1, 2, 4, 10, 100]) {
    const one = drainSpermPool([source('A', 40, q)], 20);
    const split = drainSpermPool(Array.from({ length: n }, (_, i) => source(`part-${i}`, 40 / n, q, { male: 'A' })), 20);
    near(one.remaining, split.remaining); near(one.removed, split.removed);
    const preview = (rows) => calculateFertilizationPreview({ model: 'pooled-v1', eggRace: '人类', elapsedDays: 1, spermSources: rows });
    near(preview(one.sources).successChance, preview(split.sources).successChance);
  }
});
test('same effort a+b and separate a then b agree across mixed qualities and JSON persistence', () => {
  const rows = [source('A', 12.5, .25), source('B', 37.5, 4), source('C', 9, 1)];
  const one = drainSpermPool(rows, 25.3);
  const first = drainSpermPool(rows, 7.1), two = drainSpermPool(clone(first.sources), 18.2);
  for (let i = 0; i < rows.length; i++) near(one.sources[i].value, two.sources[i].value);
  near(one.removed, first.removed + two.removed); conserved(one); conserved(two);
});
test('permutation preserves results while returning original source order', () => {
  const rows = [source('A', 20, .25), source('B', 20, 4), source('C', 7, .3)];
  const one = drainSpermPool(rows, 20), permuted = drainSpermPool([rows[2], rows[0], rows[1]], 20);
  near(one.remaining, permuted.remaining);
  for (const row of one.sources) near(row.value, permuted.sources.find((x) => x.id === row.id).value);
  assert.deepEqual(permuted.sources.map((x) => x.id), ['C', 'A', 'B']);
});
test('known effort-to-empty boundary, near-empty effort and huge finite effort are consistent', () => {
  const rows = [source('A', 20, .25), source('B', 20, 4)];
  const clear = effortToEmpty(rows);
  assert.equal(drainSpermPool(rows, clear).remaining, 0);
  assert.equal(drainSpermPool(rows, clear + 1).remaining, 0);
  assert.equal(drainSpermPool(rows, Number.MAX_VALUE).remaining, 0);
  const almost = drainSpermPool(rows, clear - 1e-7);
  assert.ok(almost.remaining > 0); conserved(almost);
});
test('empty pool, zero effort identity and decimal residue do not acquire floor loss', () => {
  const rows = [source('A', .4, 1)];
  assert.deepEqual(drainSpermPool(rows, 0).sources, rows);
  near(drainSpermPool(rows, .1).remaining, .3);
  const empty = drainSpermPool([], 80); assert.equal(empty.removed, 0); assert.equal(empty.remaining, 0);
});
test('invalid mathematical effort is rejected rather than clamped into another action', () => {
  for (const a of [-1, NaN, Infinity, -Infinity, '20']) assert.throws(() => drainSpermPool([], a), RangeError);
});
test('inactivated material still drains; not-entered material has zero physical weight', () => {
  const rows = [source('inactive', 20, 1, { blocked: true, fertilityStatus: 'inactivated' }),
    source('active', 20, 1), source('outside', 99, 4, { fertilityStatus: 'not-entered', blocked: true })];
  const result = drainSpermPool(rows, 10);
  assert.equal(result.before, 40); near(result.sources[0].value, 15); near(result.sources[1].value, 15);
  assert.equal(result.sources[2].value, 0); assert.equal(result.sources[0].blocked, true); conserved(result);
});
test('inputs and frozen donor metadata are not mutated or replaced by current donor values', () => {
  const rows = Object.freeze([Object.freeze(source('A', 20, 4,
    { bloodline: Object.freeze({ 人类: 1 }), donorNull: null, minutesPassed: 23, blocked: true }))]);
  const result = drainSpermPool(rows, 100);
  assert.equal(rows[0].value, 20); assert.equal(result.sources[0].value, 0);
  for (const field of ['id', 'male', 'race', 'quality', 'bloodline', 'donorNull', 'minutesPassed', 'blocked']) {
    assert.deepEqual(result.sources[0][field], rows[0][field]);
  }
});
test('seeded mixed-pool effort semi-group and conservation properties', () => {
  let seed = 932741;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 32; i++) {
    const qs = [.25, .3, 1, 2, 4];
    const rows = Array.from({ length: 2 + i % 6 }, (_, j) => source(`s${j}`, .2 + rand() * 50, qs[Math.floor(rand() * qs.length)], { blocked: rand() < .3 }));
    const A = effortToEmpty(rows) * .61, firstAmount = A * .37;
    const one = drainSpermPool(rows, A), first = drainSpermPool(rows, firstAmount);
    const two = drainSpermPool(first.sources, A - firstAmount);
    near(one.remaining, two.remaining); conserved(one); conserved(two);
    for (let j = 0; j < rows.length; j++) near(one.sources[j].value, two.sources[j].value);
  }
});

const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
function fixture({ rows = [source('A', 40, 4)], eggs = 1, stage = '卵泡期' } = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('母方'); mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race: '人类', bodySize: 4, stage, days: 3, eggs, sperms: clone(rows) });
  mother.profile.cooldown.naturalOvulationUsed = true;
  chat.characters['母方'] = mother;
  enablePooledConception(mother.profile.base, 0, { seed: 'active-drain-native' });
  for (const egg of mother.profile.base.spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
  // Normalize upstream lazy metadata before comparing effects of the drain itself.
  call(chat, 'bsPassedTime', { minute: 0 });
  return chat;
}
const base = (chat) => chat.characters['母方'].profile.base;
const drain = (chat, amount) => call(chat, 'bsDrainSperm', { female: '母方', amount });
const volumes = (chat) => base(chat).spermContacts.map((x) => x.value);

test('actual tool: one 20 vs serialized two 10 returns the same removal and residue', () => {
  const one = fixture(), two = fixture();
  const a = drain(one, 20), b = drain(two, 10);
  const reloaded = clone(two), c = drain(reloaded, 10);
  assert.equal(a.applied, true); assert.equal(b.applied, true); assert.equal(c.applied, true);
  near(a.drainResult.remaining, 25.85786437626905); near(a.drainResult.remaining, c.drainResult.remaining);
  near(a.drainResult.removed, b.drainResult.removed + c.drainResult.removed);
  near(sum(base(one).spermContacts), sum(base(reloaded).spermContacts));
  assert.equal(a.drainResult.minute, 0); assert.equal(one.minutesPassed, 0); assert.match(a.message, /尝试量 20/);
});
test('actual tool: over-current-volume effort can clear in one call, matching four calls', () => {
  const one = fixture(), four = fixture();
  assert.equal(drain(one, 80).drainResult.remaining, 0);
  for (let i = 0; i < 4; i++) drain(four, 20);
  assert.deepEqual(volumes(one), volumes(four));
  assert.equal(base(one).spermContacts.length, 1); assert.equal(base(one).sperms.length, 0);
});
test('actual tool: mixed-quality attempts split identically and each receipt conserves mass', () => {
  const rows = [source('low', 20, .25), source('high', 20, 4, { blocked: true })];
  const one = fixture({ rows }), two = fixture({ rows });
  const a = drain(one, 20), b = drain(two, 10), c = drain(two, 10);
  near(a.drainResult.remaining, 19.554967333523752); near(c.drainResult.remaining, a.drainResult.remaining);
  for (const result of [a, b, c]) {
    const r = result.drainResult; near(r.before, r.removed + r.remaining);
    near(r.removed, r.sources.reduce((n, x) => n + x.removed, 0));
  }
  // Legacy aggregate IDs are reassigned during forward migration; donor identity remains stable.
  assert.equal(base(one).spermContacts.find((x) => x.male === 'high').blocked, true);
});
test('actual tool: active removal does not change clock, egg budgets, identity or source snapshots', () => {
  const chat = fixture();
  const eggsBefore = clone(base(chat).spermPool), beforeClock = chat.minutesPassed;
  const snapshot = clone(base(chat).spermContacts[0]);
  drain(chat, 20);
  assert.equal(chat.minutesPassed, beforeClock); assert.deepEqual(base(chat).spermPool, eggsBefore);
  const after = { ...base(chat).spermContacts[0], value: snapshot.value };
  assert.deepEqual(after, snapshot);
  assert.equal(base(chat).eggs, 1);
});
test('actual tool: drain before clock prevents later risk; drain after clock keeps the existing embryo', () => {
  const before = fixture(), after = fixture();
  drain(before, 80); const beforeTick = call(before, 'bsPassedTime', { minute: 1 });
  assert.equal(beforeTick.conceptionEvents.length, 0); assert.equal(before.characters['母方'].profile.pregnant.fetuses.length, 0);
  const afterTick = call(after, 'bsPassedTime', { minute: 1 }); assert.equal(afterTick.conceptionEvents.length, 1);
  const fetuses = clone(after.characters['母方'].profile.pregnant.fetuses), budget = clone(base(after).spermPool);
  drain(after, 80);
  assert.deepEqual(after.characters['母方'].profile.pregnant.fetuses, fetuses);
  assert.deepEqual(base(after).spermPool, budget); assert.equal(after.minutesPassed, 1);
  assert.equal(base(after).spermContacts[0].value, 0); assert.equal(base(after).spermContacts[0].id, fetuses[0].contactIds[0]);
});
test('actual tool: empty, no eggs, pregnant and postpartum pools all allow instantaneous removal', () => {
  for (const stage of ['卵泡期', '孕早期', '产后恢复']) {
    const chat = fixture({ stage, eggs: 0 });
    const result = drain(chat, 20); assert.equal(result.applied, true); near(result.drainResult.remaining, 25.85786437626905);
    assert.equal(chat.minutesPassed, 0); assert.equal(base(chat).stage, stage);
  }
  const empty = fixture({ rows: [], eggs: 0 }), result = drain(empty, 20);
  assert.equal(result.applied, true); assert.equal(result.drainResult.removed, 0); assert.equal(result.drainResult.remaining, 0);
});
test('actual tool: changed current donor quality does not rewrite deposited quality during a drain', () => {
  const chat = fixture(); chat.sires.A = { race: '人类', spermQuality: .25 };
  near(drain(chat, 20).drainResult.remaining, 25.85786437626905);
  assert.equal(base(chat).spermContacts[0].quality, 4);
});
test('actual tool: body size does not silently multiply the absolute effort', () => {
  const a = fixture(), b = fixture(); base(b).bodySize = 7;
  near(drain(a, 20).drainResult.remaining, drain(b, 20).drainResult.remaining);
});
test('legacy remains legacy: q4 amount80 still follows the original result until explicit opt-in', () => {
  const chat = fixture(); delete base(chat).spermPool;
  const result = drain(chat, 80);
  assert.equal(result.applied, true); assert.equal('drainResult' in result, false);
  assert.equal(base(chat).sperms[0].value, 11);
});
test('actual tool rejects invalid amounts with no physical or budget mutation', () => {
  const chat = fixture();
  for (const amount of [0, -1, NaN, Infinity]) {
    const before = clone(base(chat));
    assert.equal(drain(chat, amount).applied, false); assert.deepEqual(base(chat), before);
  }
});
