import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSpermPool,
  depositSpermPool,
  getSpermPoolRates,
  integrateSpermPool,
} from '../scripts/sperm_pool.js';

const row = (id, value, quality = 1, extra = {}) => ({ id, male: id, race: 'human', value, quality, ...extra });
const total = (rows) => rows.reduce((a, source) => a + source.value, 0);
const effective = (rows) => rows.reduce((a, source) => a + source.value * Math.sqrt(source.quality), 0);
const near = (actual, expected, tolerance = 2e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
};
const aggregate = (rows, field = 'value') => {
  const result = {};
  for (const source of rows) result[source.male] = (result[source.male] || 0) + source[field];
  return result;
};
const sameGroups = (left, right, field = 'value', tolerance = 2e-9) => {
  const a = aggregate(left, field), b = aggregate(right, field);
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) near(a[id] || 0, b[id] || 0, tolerance);
};
const checkRiskMass = (result, tolerance = 2e-11) => {
  near(result.sources.reduce((a, source) => a + source.hazard, 0), result.hazard, tolerance);
  near(result.sources.reduce((a, source) => a + source.winChance, 0), result.successChance, tolerance);
  near(result.successChance, -Math.expm1(-result.hazard), tolerance);
  near(result.sources.reduce((a, source) => a + source.winnerWeight, 0), result.successChance > 0 ? 1 : 0, tolerance);
  for (const source of result.sources) {
    assert.ok(source.hazard >= 0 && source.winChance >= 0 && source.winnerWeight >= 0);
    near(source.winChance, source.winnerWeight * result.successChance, tolerance);
  }
};

// 独立时间域 RK4：直接积分物理量 Vi、风险 Hi 与胜出质量 Wi，
// 不复用生产代码的隐变量求根、时钟变换或自适应积分系数。
// 样例终止于耗尽之前，固定网格参考解在这段内保持光滑。
function reference(sources, duration, volumeFactor, sourceRates, steps = 8192) {
  const n = sources.length;
  let state = [...sources.map((source) => source.value), ...Array(2 * n).fill(0)];
  const derivative = (s) => {
    const volume = s.slice(0, n).reduce((a, b) => a + b, 0);
    const active = sources.map((source, i) => source.blocked ? 0 : s[i] * Math.sqrt(source.quality) / volumeFactor);
    const x = active.reduce((a, b) => a + b, 0);
    const dose = Math.min(2, Math.sqrt(x / 20));
    const lambdas = active.map((v, i) => x > 0 ? 0.3 * dose * v / x * sourceRates[i] : 0);
    const survival = Math.exp(-s.slice(n, 2 * n).reduce((a, b) => a + b, 0));
    return [
      ...sources.map((source, i) => -10 * volumeFactor * s[i] / volume / Math.sqrt(source.quality)),
      ...lambdas,
      ...lambdas.map((value) => survival * value),
    ];
  };
  const h = duration / steps;
  const shifted = (a, k, factor) => a.map((value, i) => value + factor * k[i]);
  for (let j = 0; j < steps; j++) {
    const k1 = derivative(state);
    const k2 = derivative(shifted(state, k1, h / 2));
    const k3 = derivative(shifted(state, k2, h / 2));
    const k4 = derivative(shifted(state, k3, h));
    state = state.map((value, i) => value + h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
  }
  return { values: state.slice(0, n), hazards: state.slice(n, 2 * n), wins: state.slice(2 * n) };
}

test('same-q 20 versus 10+10: one physical drain, one risk, proportional winners', () => {
  const whole = [row('A', 20)];
  const split = [row('A1', 10, 1, { male: 'A' }), row('A2', 10, 1, { male: 'A' })];
  const a = integrateSpermPool(whole, 1), b = integrateSpermPool(split, 1);
  near(total(a.remainingSources), 10);
  near(total(b.remainingSources), 10);
  near(a.hazard, 0.4 * (1 - 0.5 ** 1.5));
  near(a.successChance, 0.2278516959866678);
  near(a.hazard, b.hazard);
  near(a.successChance, b.successChance);
  near(b.sources[0].winnerWeight, 0.5);
  sameGroups(a.sources, b.sources, 'winChance');
  checkRiskMass(a);
  checkRiskMass(b);
});

test('split invariance for 1..100 records, qualities, pairing coefficients and labels', () => {
  for (const q of [0.25, 0.3, 1, 2, 4]) for (const count of [1, 2, 4, 10, 100]) {
    const whole = [row('A', 20, q)];
    const split = Array.from({ length: count }, (_, i) => row(`a${i}`, 20 / count, q, { male: 'A' }));
    const a = integrateSpermPool(whole, 1, { sourceRates: [0.7] });
    const b = integrateSpermPool(split, 1, { sourceRates: Array(count).fill(0.7) });
    near(a.hazard, b.hazard);
    near(a.successChance, b.successChance);
    sameGroups(a.remainingSources, b.remainingSources);
    sameGroups(a.sources, b.sources, 'winChance');
  }
  const distinct = integrateSpermPool([row('B', 10), row('C', 10)], 1);
  near(distinct.successChance, integrateSpermPool([row('A', 20)], 1).successChance);
});

test('quality normalization exactly matches upstream numeric coercion, range and fallback', () => {
  const raw = [undefined, null, '', NaN, Infinity, -1, 0, 0.01, '2', 8];
  const expected = [1, 1, 1, 1, 1, 1, 1, 0.25, 2, 4];
  const result = advanceSpermPool(raw.map((q, i) => row(String(i), 1, q)), 0);
  assert.deepEqual(result.map((source) => source.quality), expected);
  assert.deepEqual(advanceSpermPool([row('neg', -2), row('nan', NaN), row('inf', Infinity), row('zero', -0)], 0)
    .map((source) => source.value), [0, 0, 0, 0]);
});

test('instant rates use active effective shares and pairing coefficients, with no dose floor', () => {
  const rows = [row('A', 10, 0.25), row('B', 10, 4), row('blocked', 100, 4, { blocked: true }), row('zero', 0)];
  const rates = getSpermPoolRates(rows, { sourceRates: [0.4, 1.2, 5, 1] });
  const dose = Math.sqrt(25 / 20);
  near(rates[0].rate, 0.3 * dose * 5 / 25 * 0.4);
  near(rates[1].rate, 0.3 * dose * 20 / 25 * 1.2);
  near(rates[2].rate, 0);
  near(rates[3].rate, 0);
  assert.deepEqual(rates.map((source) => source.sourceIndex), [0, 1, 2, 3]);
  near(getSpermPoolRates([row('tiny', 1e-16)])[0].rate, 0.3 * Math.sqrt(1e-16 / 20), 1e-24);
  near(getSpermPoolRates([row('large', 1e9)])[0].rate, 0.6);
  assert.deepEqual(getSpermPoolRates([row('a', 20), row('b', 20), row('c', 20)], { sourceRates: [0, Infinity, -1] })
    .map((source) => source.rate), [0, 0, 0]);
});

test('blocked means inactivated entered volume: physical denominator, capacity and clearance retained', () => {
  const rows = [row('active', 10), row('inactive', 10, 1, { blocked: true })];
  const after = advanceSpermPool(rows, 1);
  near(after[0].value, 5); // 不为零：失活体积仍属于总物理量。
  near(after[1].value, 5);
  const result = integrateSpermPool(rows, 1);
  near(result.sources[1].hazard, 0);
  near(result.sources[1].winChance, 0);
  near(result.sources[0].winnerWeight, 1);
  assert.ok(result.successChance > integrateSpermPool([row('active', 10)], 1).successChance);
  const overflow = depositSpermPool(rows, row('new', 10), 20);
  near(overflow.spilled, 10);
  near(total(overflow.sources), 20);
  assert.ok(overflow.sources[1].value > 0);
  // 未入体材料应缺席，不是额外隐藏的失活来源。
  assert.equal(integrateSpermPool([], 1).sources.length, 0);
});

test('zero pairing is not blocked: active incompatible material remains in dose shares', () => {
  const rows = [row('compatible', 20), row('incompatible', 20)];
  const unblocked = getSpermPoolRates(rows, { sourceRates: [1, 0] });
  const blocked = getSpermPoolRates([rows[0], { ...rows[1], blocked: true }], { sourceRates: [1, 0] });
  near(unblocked[0].rate, 0.3 * Math.sqrt(2) / 2);
  near(blocked[0].rate, 0.3);
});

test('mixed-quality implicit clearance conserves linear weighted mass and enriches high q', () => {
  const rows = [row('low', 20, 0.25), row('high', 20, 4), row('off', 8, 0.8, { blocked: true })];
  const before = effective(rows);
  for (const volumeFactor of [0.125, 1, 8]) {
    const dt = before / (10 * volumeFactor) * 0.77;
    const after = advanceSpermPool(rows, dt, { volumeFactor });
    near(effective(after), before - 10 * volumeFactor * dt);
    assert.ok(after[1].value / after[0].value > 1);
    assert.ok(after.every((source, i) => source.value >= 0 && source.value <= rows[i].value));
    assert.deepEqual(advanceSpermPool(rows, before / (10 * volumeFactor), { volumeFactor }).map((source) => source.value), [0, 0, 0]);
  }
});

test('mixed q/r and blocked fixtures match independent physical time-domain RK4', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4), row('C', 9, 0.8, { blocked: true }), row('D', 6, 1.3)];
  for (const volumeFactor of [0.3, 1, 2]) {
    const opts = { volumeFactor, sourceRates: [2.5, 0.2, 9, 0.9] };
    const result = integrateSpermPool(rows, 0.76, opts);
    const expected = reference(rows, 0.76, volumeFactor, opts.sourceRates);
    for (let i = 0; i < rows.length; i++) {
      near(result.remainingSources[i].value, expected.values[i], 3e-10);
      near(result.sources[i].hazard, expected.hazards[i], 3e-10);
      near(result.sources[i].winChance, expected.wins[i], 3e-10);
    }
    checkRiskMass(result);
  }
});

test('mixed-quality winner weights are causal Wi/P, not normalized cumulative Hi', () => {
  const rows = [row('early-low-q', 20, 0.25), row('late-high-q', 20, 4)];
  const options = { sourceRates: [8, 1] };
  const result = integrateSpermPool(rows, 4, options);
  checkRiskMass(result);
  assert.ok(result.sources[0].winnerWeight > result.sources[0].hazard / result.hazard + 0.03);
  // 在耗尽前直接独立积分，同时验证存活概率加权。
  const partial = integrateSpermPool(rows, 3, options);
  const expected = reference(rows, 3, 1, options.sourceRates, 16384);
  near(partial.sources[0].winChance, expected.wins[0], 5e-10);
  near(partial.sources[1].winChance, expected.wins[1], 5e-10);
});

test('early/late exclusive-risk fixture: equal Hi yields 73.1059%, not 50%', () => {
  const initial = [row('A', 1000), row('B', 1000, 1, { blocked: true })];
  const first = integrateSpermPool(initial, 1 / 0.6);
  const second = integrateSpermPool(first.remainingSources.map((source) => ({ ...source, blocked: source.id === 'A' })), 1 / 0.6);
  near(first.hazard, 1);
  near(second.hazard, 1);
  const wa = first.sources[0].winChance;
  const wb = Math.exp(-first.hazard) * second.sources[1].winChance;
  near(wa + wb, -Math.expm1(-2));
  near(wa / (wa + wb), 1 / (1 + Math.exp(-1)));
  assert.ok(wa / (wa + wb) > 0.731);
});

test('a+b semi-group: residuals, cumulative Hi and survival-composed Wi', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4), row('C', 8, 0.5, { blocked: true })];
  const opts = { volumeFactor: 1.4, sourceRates: [0.4, 1.2, 5] };
  const whole = integrateSpermPool(rows, 0.76, opts);
  const first = integrateSpermPool(rows, 0.27, opts);
  const second = integrateSpermPool(first.remainingSources, 0.49, opts);
  near(whole.hazard, first.hazard + second.hazard);
  for (let i = 0; i < rows.length; i++) {
    near(whole.remainingSources[i].value, second.remainingSources[i].value);
    near(whole.sources[i].hazard, first.sources[i].hazard + second.sources[i].hazard);
    near(whole.sources[i].winChance, first.sources[i].winChance + Math.exp(-first.hazard) * second.sources[i].winChance);
  }
});

test('mixed-q splitting and permutations retain sourceIndex/pairing mapping', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4), row('C', 6, 1.2, { blocked: true })];
  const coefficients = [0.4, 1.2, 6];
  const expected = integrateSpermPool(rows, 1.1, { sourceRates: coefficients });
  for (const permutation of [[2, 0, 1], [1, 2, 0], [2, 1, 0]]) {
    const reordered = permutation.map((i) => rows[i]);
    const rates = getSpermPoolRates(reordered, { sourceRates: permutation.map((i) => coefficients[i]) });
    const result = integrateSpermPool(reordered, 1.1, { sourceRates: permutation.map((i) => coefficients[i]) });
    near(result.hazard, expected.hazard, 2e-12);
    sameGroups(result.remainingSources, expected.remainingSources, 'value', 2e-12);
    sameGroups(result.sources, expected.sources, 'winChance', 2e-12);
    result.sources.forEach((source, i) => {
      assert.equal(source.sourceIndex, i);
      assert.equal(source.id, reordered[i].id);
      assert.equal(rates[i].sourceIndex, i);
    });
  }
  const split = [row('A1', 6.5, 0.3, { male: 'A' }), row('A2', 6.5, 0.3, { male: 'A' }), rows[1], rows[2]];
  const result = integrateSpermPool(split, 1.1, { sourceRates: [0.4, 0.4, 1.2, 6] });
  near(result.hazard, expected.hazard);
  sameGroups(result.remainingSources, expected.remainingSources);
  sameGroups(result.sources, expected.sources, 'winChance');
});

test('full-pool continuous overflow: one addition equals serialized partial additions', () => {
  const initial = [row('old', 20, 0.25)];
  const once = depositSpermPool(initial, row('new', 20, 4), 20);
  const first = depositSpermPool(initial, row('new1', 10, 4, { male: 'new' }), 20);
  const twice = depositSpermPool(JSON.parse(JSON.stringify(first.sources)), row('new2', 10, 4, { male: 'new' }), 20);
  near(once.sources[0].value, 20 / Math.E);
  near(once.sources[1].value, 20 * -Math.expm1(-1));
  near(total(once.sources), 20);
  near(once.spilled, 20);
  near(once.spilled, first.spilled + twice.spilled);
  sameGroups(once.sources, twice.sources);
  near(integrateSpermPool(once.sources, 1).hazard, integrateSpermPool(twice.sources, 1).hazard);
});

test('partly full pool arbitrary split inputs preserve composition and physical conservation', () => {
  const initial = [row('old', 5, 0.5)];
  const once = depositSpermPool(initial, row('new', 30, 4), 20);
  let state = initial, spilled = 0;
  for (let i = 0; i < 6; i++) {
    const next = depositSpermPool(state, row(`new${i}`, 5, 4, { male: 'new' }), 20);
    state = next.sources;
    spilled += next.spilled;
  }
  sameGroups(once.sources, state);
  near(once.spilled, spilled);
  for (const v0 of [0, 5, 19, 20, 30]) for (const incoming of [0, 0.1, 10, 100]) {
    const result = depositSpermPool([row('old', v0)], row('new', incoming), 20);
    near(v0 + incoming, total(result.sources) + result.spilled);
    assert.ok(total(result.sources) <= 20 + 1e-12);
    assert.ok(result.spilled >= 0);
  }
});

test('zero capacity, zero inflow, reduced capacity and unlimited capacity are explicit', () => {
  const initial = [row('A', 15), row('B', 15, 4, { blocked: true })];
  const zero = depositSpermPool(initial, row('new', 7), 0);
  near(total(zero.sources), 0);
  near(zero.spilled, 37);
  const shrunk = depositSpermPool(initial, row('zero', 0), 20);
  near(shrunk.sources[0].value, 10);
  near(shrunk.sources[1].value, 10);
  near(shrunk.spilled, 10);
  const unlimited = depositSpermPool(initial, row('new', 7), Infinity);
  near(total(unlimited.sources), 37);
  near(unlimited.spilled, 0);
  const tiny = depositSpermPool([row('full', 20)], row('tiny', 1e-20), 20);
  near(tiny.sources[1].value, 1e-20, 1e-35);
  near(tiny.spilled, 1e-20, 1e-35);
});

test('micro quantities smoothly approach zero with no minimum probability or ghost exposure', () => {
  let previous = Infinity;
  for (const value of [1e-3, 1e-6, 1e-10, 1e-20, 1e-100]) {
    const result = integrateSpermPool([row('tiny', value)], 1);
    const expectedH = 0.3 * (value / 10) * (2 / 3) * Math.sqrt(value / 20);
    near(result.hazard / expectedH, 1, 1e-12);
    assert.ok(result.successChance < previous);
    assert.equal(result.remainingSources[0].value, 0);
    checkRiskMass(result);
    previous = result.successChance;
  }
  const empty = integrateSpermPool(advanceSpermPool([row('A', 20)], 2), 10);
  assert.equal(empty.hazard, 0);
  assert.equal(empty.successChance, 0);
});

test('uniform and mixed quantities scale with U; dose cap stays 2', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4)];
  const expected = integrateSpermPool(rows, 0.9, { sourceRates: [0.4, 1.2] });
  for (const volumeFactor of [0.01, 0.25, 8, 100]) {
    const scaled = rows.map((source) => ({ ...source, value: source.value * volumeFactor }));
    const result = integrateSpermPool(scaled, 0.9, { volumeFactor, sourceRates: [0.4, 1.2] });
    near(result.hazard, expected.hazard);
    near(result.successChance, expected.successChance);
    for (let i = 0; i < rows.length; i++) near(result.remainingSources[i].value / volumeFactor, expected.remainingSources[i].value);
  }
  near(integrateSpermPool([row('cap', 50, 4)], 1).hazard, 0.6);
  near(integrateSpermPool([row('cap', 100, 4)], 1).hazard, 0.6);
});

test('exact dose-cap crossing and mixed exhaustion endpoints remain integrable', () => {
  const capped = integrateSpermPool([row('A', 90)], 3);
  // 有效量从90降至60：先有一天触顶，再对后两天的平方根剂量积分。
  const expected = 0.6 + 0.3 / 10 * (2 / (3 * Math.sqrt(20))) * (80 ** 1.5 - 60 ** 1.5);
  near(capped.hazard, expected);
  const rows = [row('A', 8, 0.25), row('B', 3, 4), row('off', 2, 1, { blocked: true })];
  const lifetime = effective(rows) / 10;
  const exact = integrateSpermPool(rows, lifetime, { sourceRates: [0.3, 2, 9] });
  const beyond = integrateSpermPool(rows, lifetime * 100, { sourceRates: [0.3, 2, 9] });
  near(exact.hazard, beyond.hazard);
  assert.ok(exact.remainingSources.every((source) => source.value === 0));
  checkRiskMass(exact);
  const before = integrateSpermPool(rows, lifetime * (1 - 1e-10), { sourceRates: [0.3, 2, 9] });
  near(exact.hazard, before.hazard, 1e-10);
});

test('no risk, zero/invalid elapsed time, and empty input have consistent output shapes', () => {
  const rows = [row('A', 20), row('blocked', 20, 4, { blocked: true })];
  for (const t of [0, -1, NaN]) {
    const result = integrateSpermPool(rows, t);
    assert.equal(result.hazard, 0);
    assert.deepEqual(result.remainingSources, rows);
    checkRiskMass(result);
  }
  for (const volumeFactor of [0, -1, NaN, Infinity]) {
    near(integrateSpermPool(rows, 1, { volumeFactor }).hazard, integrateSpermPool(rows, 1).hazard);
  }
  const closed = integrateSpermPool(rows, 1, { sourceRates: [0, 1] });
  assert.equal(closed.hazard, 0);
  assert.ok(total(closed.remainingSources) < total(rows));
  assert.deepEqual(advanceSpermPool([], 10), []);
  assert.deepEqual(getSpermPoolRates([]), []);
  assert.deepEqual(integrateSpermPool([], 10), { hazard: 0, successChance: 0, sources: [], remainingSources: [] });
});

test('all four APIs preserve metadata and inputs, including frozen objects and sourceRates', () => {
  const snapshot = Object.freeze({ lineage: ['human'], signature: 'frozen-at-deposit' });
  const rows = Object.freeze([
    Object.freeze(row('A', 13, 0.3, { snapshot, createdAt: 42 })),
    Object.freeze(row('B', 17, 4, { snapshot, blocked: true })),
  ]);
  const incoming = Object.freeze(row('new', 10, 2, { snapshot }));
  const sourceRates = Object.freeze([0.4, 1.2]);
  const before = JSON.stringify(rows);
  const advanced = advanceSpermPool(rows, 0.7);
  const deposited = depositSpermPool(rows, incoming, 35);
  const rates = getSpermPoolRates(rows, { sourceRates });
  const integrated = integrateSpermPool(rows, 0.7, { sourceRates });
  for (const output of [advanced, deposited.sources, rates, integrated.sources, integrated.remainingSources]) {
    assert.notEqual(output, rows);
    for (let i = 0; i < rows.length; i++) {
      assert.notEqual(output[i], rows[i]);
      assert.equal(output[i].id, rows[i].id);
      assert.equal(output[i].male, rows[i].male);
      assert.equal(output[i].race, rows[i].race);
      assert.equal(output[i].snapshot, snapshot);
    }
  }
  assert.equal(JSON.stringify(rows), before);
  assert.equal(incoming.value, 10);
  assert.deepEqual(sourceRates, [0.4, 1.2]);
});

test('mixed q with equal pairing has analytic total H across saturation and exhaustion', () => {
  const primitive = (x) => 2 * Math.min(80, x) ** 1.5 / (3 * Math.sqrt(20)) + 2 * Math.max(0, x - 80);
  for (const blocked of [false, true]) {
    // 此闭式只适用于全部物理材料均活性的情况。
    const rows = [row('low', 60, 0.25), row('high', 70, 4)];
    const r = blocked ? 0 : 0.75;
    for (const duration of [0.1, 9, 12, 17, 100]) {
      const result = integrateSpermPool(rows, duration, { sourceRates: [r, r] });
      const start = effective(rows);
      const end = Math.max(0, start - 10 * duration);
      near(result.hazard, 0.3 * r * (primitive(start) - primitive(end)) / 10, 4e-10);
      checkRiskMass(result);
    }
  }
});

test('day/hour/minute subdivisions reproduce physical mass and integrated competing risks', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4), row('inactive', 3, 0.8, { blocked: true })];
  const options = { sourceRates: [0.4, 1.2, 3] };
  const expected = integrateSpermPool(rows, 1, options);
  for (const chunks of [24, 1440]) {
    let state = rows;
    let h = 0;
    const hi = rows.map(() => 0), wi = rows.map(() => 0);
    for (let k = 0; k < chunks; k++) {
      const result = integrateSpermPool(state, 1 / chunks, options);
      for (let i = 0; i < rows.length; i++) {
        hi[i] += result.sources[i].hazard;
        wi[i] += Math.exp(-h) * result.sources[i].winChance;
      }
      h += result.hazard;
      state = JSON.parse(JSON.stringify(result.remainingSources));
    }
    near(h, expected.hazard);
    for (let i = 0; i < rows.length; i++) {
      near(state[i].value, expected.remainingSources[i].value);
      near(hi[i], expected.sources[i].hazard);
      near(wi[i], expected.sources[i].winChance);
    }
  }
});

test('seeded mixed-pool properties: conservation, order, semi-group and dose scaling', () => {
  let seed = 0x72657473;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let fixture = 0; fixture < 32; fixture++) {
    const rows = Array.from({ length: 2 + fixture % 4 }, (_, i) => row(String(i), 0.1 + 25 * random(), 0.25 + 3.75 * random(), { blocked: random() < 0.2 }));
    const sourceRates = rows.map(() => 2 * random());
    const volumeFactor = 0.2 + 3 * random();
    const lifetime = effective(rows) / (10 * volumeFactor);
    const dt = lifetime * (0.05 + 0.9 * random());
    const options = { volumeFactor, sourceRates };
    const whole = integrateSpermPool(rows, dt, options);
    const first = integrateSpermPool(rows, dt * 0.37, options);
    const last = integrateSpermPool(first.remainingSources, dt * 0.63, options);
    const reversed = integrateSpermPool([...rows].reverse(), dt, { volumeFactor, sourceRates: [...sourceRates].reverse() });
    near(whole.hazard, first.hazard + last.hazard);
    near(whole.hazard, reversed.hazard, 5e-12);
    near(effective(whole.remainingSources), effective(rows) - 10 * volumeFactor * dt);
    for (let i = 0; i < rows.length; i++) {
      near(whole.remainingSources[i].value, last.remainingSources[i].value);
      near(whole.sources[i].winChance, first.sources[i].winChance + Math.exp(-first.hazard) * last.sources[i].winChance);
    }
    checkRiskMass(whole);
  }
});

test('mixed micro pools retain relative accuracy and finite huge sources retain bounded rates', () => {
  const rows = [row('A', 13, 0.3), row('B', 17, 4)];
  const expected = integrateSpermPool(rows, 100, { sourceRates: [0.4, 1.2] });
  for (const scale of [1e-6, 1e-12, 1e-20]) {
    const tiny = integrateSpermPool(rows.map((source) => ({ ...source, value: source.value * scale })), 1, { sourceRates: [0.4, 1.2] });
    // 未触顶时，速率随体积平方根缩放，存续时间随体积缩放。
    near(tiny.hazard / (expected.hazard * scale ** 1.5), 1, 2e-9);
    checkRiskMass(tiny);
  }
  const huge = [row('A', 1e308, 4), row('B', 1e308, 4)];
  const rates = getSpermPoolRates(huge);
  near(rates[0].rate, 0.3);
  near(rates[1].rate, 0.3);
  near(integrateSpermPool(huge, 1).hazard, 0.6);
});
