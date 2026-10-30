import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceSpermPool,
  findSpermPoolCrossing,
  getSpermPoolRates,
  integrateSpermPool,
  integrateSpermPoolRisk,
} from '../scripts/sperm_pool.js';

const row = (id, value, quality = 1, extra = {}) => ({ id, value, quality, ...extra });
const near = (actual, expected, tolerance = 2e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
};
const lifetime = (sources, u = 1) => sources.reduce((s, r) => s + r.value * Math.sqrt(r.quality), 0) / (10 * u);

// 独立物理时间域 RK4：直接推进 Vi 与总 H，不调用生产 latent、积分器或任何风险 API。
// 参考窗严格早于物理耗尽；网格只用于独立测试，不参与实际事件调度。
function reference(sources, duration, options = {}, steps = 8192) {
  const { volumeFactor: u = 1, sourceRates = sources.map(() => 1), timeScale = {} } = options;
  const { initial = 1, slopePerDay = 0 } = timeScale;
  const n = sources.length;
  let state = [...sources.map((r) => r.value), 0];
  const derivative = (t, values) => {
    const volume = values.slice(0, n).reduce((a, b) => a + b, 0);
    const effective = sources.map((r, i) => r.blocked ? 0 : values[i] * Math.sqrt(r.quality) / u);
    const dose = effective.reduce((a, b) => a + b, 0);
    const rate = dose > 0 ? 0.3 * Math.min(2, Math.sqrt(dose / 20))
      * effective.reduce((a, b, i) => a + b * sourceRates[i], 0) / dose
      * Math.max(0, initial + slopePerDay * t) : 0;
    return [...sources.map((r, i) => -10 * u * values[i] / (volume * Math.sqrt(r.quality))), rate];
  };
  const h = duration / steps;
  const shift = (s, k, v) => s.map((x, i) => x + v * k[i]);
  for (let j = 0; j < steps; j++) {
    const t = j * h;
    const k1 = derivative(t, state);
    const k2 = derivative(t + h / 2, shift(state, k1, h / 2));
    const k3 = derivative(t + h / 2, shift(state, k2, h / 2));
    const k4 = derivative(t + h, shift(state, k3, h));
    state = state.map((x, i) => x + h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
  }
  return { hazard: state[n], values: state.slice(0, n) };
}

// 独立闭式原函数：用常数项与 x、x^(3/2)、x^(5/2) 的代数积分验证线性时钟。
// 测试数据远离相消区；极短窗另用瞬时导数与无时间系数闭式验证。
function closedScaledRisk(start, duration, totalDays, initial, slope) {
  const decay = start / totalDays;
  const stop = Math.min(duration, totalDays, slope < 0 ? initial / -slope : Infinity);
  const begin = slope > 0 ? Math.max(0, -initial / slope) : 0;
  if (!(stop > begin)) return 0;
  const capTime = Math.max(0, (start - 80) / decay);
  const capEnd = Math.min(stop, capTime);
  let area = capEnd > begin ? 2 * (initial * (capEnd - begin) + slope * (capEnd ** 2 - begin ** 2) / 2) : 0;
  const a = Math.max(begin, capEnd);
  if (stop > a) {
    const c = initial + slope * start / decay;
    const primitive = (x) => (c * 2 / 3 * x ** 1.5 - slope / decay * 2 / 5 * x ** 2.5) / (decay * Math.sqrt(20));
    area += primitive(start - decay * a) - primitive(start - decay * stop);
  }
  return 0.3 * area;
}

test('纯风险输出没有竞争向量，默认物理、blocked 与配对语义保持一致', () => {
  const sources = [row('low', 13, 0.3), row('high', 17, 4), row('off', 9, 0.8, { blocked: true })];
  const options = { sourceRates: [2.5, 0.2, 9], volumeFactor: 0.7 };
  for (const t of [0, 1e-12, 0.76, lifetime(sources, 0.7), 1e9, Infinity]) {
    const actual = integrateSpermPoolRisk(sources, t, options);
    const preview = integrateSpermPool(sources, t, options);
    assert.deepEqual(Object.keys(actual).sort(), ['hazard', 'remainingSources', 'successChance']);
    near(actual.hazard, preview.hazard, 3e-11);
    near(actual.successChance, -Math.expm1(-actual.hazard), 1e-15);
    assert.deepEqual(actual.remainingSources, advanceSpermPool(sources, t, options));
  }
  assert.equal(integrateSpermPoolRisk(sources, 2, { sourceRates: [0, 0, 1] }).hazard, 0);
  assert.ok(integrateSpermPoolRisk(sources, 1).remainingSources[2].value > 0);
});

test('同品质首穿直接反解：独立闭式覆盖极小预算、cap 与精确耗尽', () => {
  const sources = [row('a', 20)];
  for (const expected of [1e-20, 1e-12, 0.01, 0.7, 1.9, 1.99999]) {
    const budget = 0.4 * -Math.expm1(1.5 * Math.log1p(-expected / 2));
    const actual = findSpermPoolCrossing(sources, budget);
    // 耗尽附近导数趋零，输入预算的一次舍入会被反函数条件数放大。
    const conditioning = 4 * Number.EPSILON * budget / (0.3 * Math.sqrt(1 - expected / 2));
    near(actual, expected, Math.max(conditioning, 8e-15 * Math.max(expected, Number.MIN_VALUE)));
  }
  near(findSpermPoolCrossing(sources, 0.4), 2, 1e-15);
  assert.equal(findSpermPoolCrossing(sources, 0.4 * (1 + 1e-12)), null);
  const cap = [row('cap', 90)];
  near(findSpermPoolCrossing(cap, 0.3), 0.5, 1e-15);
  near(findSpermPoolCrossing(cap, 0.6), 1, 1e-14);
  const budget = 0.6 + 0.3 * 2 / (30 * Math.sqrt(20)) * (80 ** 1.5 - 60 ** 1.5);
  near(findSpermPoolCrossing(cap, budget), 3, 2e-14);
});

test('同品质含blocked、零配对和品质体型缩放的反解仍使用真实物理寿命', () => {
  const sources = [row('a', 10, 4), row('zero-pair', 10, 4), row('off', 20, 4, { blocked: true })];
  const options = { volumeFactor: 2, sourceRates: [2, 0, 7] };
  // 活性有效剂量从20起，物理寿命4天；总配对均值为1。
  const expected = 1.3;
  const budget = 0.3 * 4 * 2 / 3 * (1 - (1 - expected / 4) ** 1.5);
  near(findSpermPoolCrossing(sources, budget, options), expected, 2e-14);
  near(integrateSpermPoolRisk(sources, expected, options).hazard, budget, 2e-14);
});

test('混合品质首穿与标量风险吻合独立物理RK4，不以生产helper算期望', () => {
  const sources = [row('a', 13, 0.3), row('b', 17, 4), row('blocked', 9, 0.8, { blocked: true }), row('c', 6, 1.3)];
  for (const volumeFactor of [0.3, 1, 2]) {
    for (const clock of [{ initial: 1, slopePerDay: 0 }, { initial: 1.4, slopePerDay: -0.7 }]) {
      const options = { volumeFactor, sourceRates: [2.5, 0.2, 9, 0.9], timeScale: clock };
      const expectedTime = 0.76;
      const expected = reference(sources, expectedTime, options);
      const risk = integrateSpermPoolRisk(sources, expectedTime, options);
      near(risk.hazard, expected.hazard, 3e-11);
      near(findSpermPoolCrossing(sources, expected.hazard, options), expectedTime, 3e-10);
      for (let i = 0; i < sources.length; i++) near(risk.remainingSources[i].value, expected.values[i], 3e-10);
    }
  }
});

test('不等配对混合池跨剂量cap折点，标量风险和首穿吻合独立RK4', () => {
  const sources = [row('low', 60, 0.25), row('high', 70, 4), row('off', 40, 1, { blocked: true })];
  const options = { sourceRates: [0.4, 1.3, 7], timeScale: { initial: 1.4, slopePerDay: -0.05 } };
  const expected = reference(sources, 15, options, 32768);
  assert.ok(expected.values[0] * 0.5 + expected.values[1] * 2 < 80);
  near(integrateSpermPoolRisk(sources, 15, options).hazard, expected.hazard, 3e-9);
  near(findSpermPoolCrossing(sources, expected.hazard, options), 15, 2e-8);
});

test('无事件固定参数风险可加，锚点首穿与调用切片无关', () => {
  const sources = [row('a', 13, 0.3), row('b', 17, 4), row('off', 8, 0.5, { blocked: true })];
  const options = { volumeFactor: 1.4, sourceRates: [0.4, 1.2, 5] };
  const whole = integrateSpermPoolRisk(sources, 0.76, options);
  const first = integrateSpermPoolRisk(sources, 0.27, options);
  const last = integrateSpermPoolRisk(first.remainingSources, 0.49, options);
  near(whole.hazard, first.hazard + last.hazard, 2e-12);
  const independentBudget = reference(sources, 0.6, options).hazard;
  const crossing = findSpermPoolCrossing(sources, independentBudget, options);
  near(crossing, 0.6, 3e-10);
  const tailCrossing = findSpermPoolCrossing(first.remainingSources, independentBudget - first.hazard, options);
  near(0.27 + tailCrossing, crossing, 2e-11);
  // 不传调用终点；所有短窗只比较同一锚点上的唯一首穿结果。
  for (const end of [0.1, 0.3, 0.6, 0.76, 1, 1e8]) {
    const again = findSpermPoolCrossing(sources, independentBudget, options);
    assert.equal(again, crossing);
    assert.equal(again <= end, crossing <= end);
  }
});

test('混合品质等配对且无blocked时，总风险具有独立线性有效剂量闭式', () => {
  const sources = [row('low', 60, 0.25), row('high', 70, 4)];
  const primitive = (x) => 2 * Math.min(80, x) ** 1.5 / (3 * Math.sqrt(20)) + 2 * Math.max(0, x - 80);
  for (const duration of [1e-5, 0.1, 9, 12, 17, 100000]) {
    const expected = 0.3 * 0.75 * (primitive(170) - primitive(Math.max(0, 170 - 10 * duration))) / 10;
    near(integrateSpermPoolRisk(sources, duration, { sourceRates: [0.75, 0.75] }).hazard, expected, 4e-12);
    if (duration < 17) near(findSpermPoolCrossing(sources, expected, { sourceRates: [0.75, 0.75] }), duration, 5e-13);
  }
});

test('线性时间系数闭式覆盖cap、归零、延迟起效与上升，首穿使用固定有效终点', () => {
  for (const start of [20, 90]) {
    const sources = [row('a', start)];
    for (const clock of [
      { initial: 1.2, slopePerDay: -0.3 },
      { initial: 0.2, slopePerDay: 0.4 },
      { initial: -0.2, slopePerDay: 0.4 },
      { initial: 2, slopePerDay: 0 },
    ]) {
      const options = { timeScale: clock };
      for (const duration of [0.75, 1.5, 1e8]) {
        const expected = closedScaledRisk(start, duration, start / 10, clock.initial, clock.slopePerDay);
        near(integrateSpermPoolRisk(sources, duration, options).hazard, expected, 2e-12);
        near(integrateSpermPool(sources, duration, options).hazard, expected, 2e-12);
      }
      const time = 0.9;
      const budget = closedScaledRisk(start, time, start / 10, clock.initial, clock.slopePerDay);
      near(findSpermPoolCrossing(sources, budget, options), time, 1e-11);
    }
  }
  const sources = [row('a', 90)];
  const options = { timeScale: { initial: 1, slopePerDay: -2 } };
  const full = 0.6 * (0.5 - 0.5 ** 2);
  near(integrateSpermPoolRisk(sources, 1e9, options).hazard, full, 1e-15);
  assert.equal(findSpermPoolCrossing(sources, full, options), 0.5);
  assert.equal(findSpermPoolCrossing(sources, full + 1e-12, options), null);
  assert.equal(integrateSpermPoolRisk(sources, 9, options).remainingSources[0].value, 0);
});

test('线性时间系数跨锚点平移后可加；预览仍按竞争风险而非累计Hi分配', () => {
  const sources = [row('low', 20, 0.25), row('high', 20, 4), row('off', 4, 0.8, { blocked: true })];
  const options = { sourceRates: [8, 1, 3], timeScale: { initial: 1.2, slopePerDay: -0.2 } };
  const whole = integrateSpermPoolRisk(sources, 2.5, options);
  const first = integrateSpermPoolRisk(sources, 0.7, options);
  const shifted = { ...options, timeScale: { initial: 1.2 - 0.2 * 0.7, slopePerDay: -0.2 } };
  const last = integrateSpermPoolRisk(first.remainingSources, 1.8, shifted);
  near(whole.hazard, first.hazard + last.hazard, 2e-11);
  const preview = integrateSpermPool(sources, 2.5, options);
  near(preview.hazard, whole.hazard, 2e-11);
  assert.ok(preview.sources[0].winnerWeight > preview.sources[0].hazard / preview.hazard + 0.02);
  near(preview.sources.reduce((s, r) => s + r.winChance, 0), preview.successChance, 1e-14);
  const expected = reference(sources, 1.3, options);
  const crossing = findSpermPoolCrossing(sources, expected.hazard, options);
  near(crossing, 1.3, 4e-10);
  near(0.7 + findSpermPoolCrossing(first.remainingSources, expected.hazard - first.hazard, shifted), crossing, 3e-11);
});

test('精确端点、极小池与极大长跳稳定，不引入分钟扫描或幽灵风险', () => {
  const sources = [row('a', 8, 0.25), row('b', 3, 4), row('off', 2, 1, { blocked: true })];
  const options = { sourceRates: [0.3, 2, 9] };
  const end = lifetime(sources);
  const full = integrateSpermPoolRisk(sources, end, options).hazard;
  assert.equal(findSpermPoolCrossing(sources, full, options), end);
  assert.equal(findSpermPoolCrossing(sources, full * (1 + 1e-10), options), null);
  assert.equal(integrateSpermPoolRisk(sources, Number.MAX_VALUE, options).hazard, full);
  near(findSpermPoolCrossing(sources, full * (1 - 1e-9), options), end, 3e-6);
  for (const volume of [1e-12, 1e-30, 1e-100]) {
    const expectedTime = volume / 20;
    const totalHazard = 0.3 * volume / 10 * 2 / 3 * Math.sqrt(volume / 20);
    const budget = totalHazard * (1 - 0.5 ** 1.5);
    near(findSpermPoolCrossing([row('tiny', volume)], budget) / expectedTime, 1, 1e-14);
    near(integrateSpermPoolRisk([row('tiny', volume)], Number.MAX_VALUE).hazard / totalHazard, 1, 1e-14);
  }
  const huge = [row('huge', 1e308, 4)];
  near(integrateSpermPoolRisk(huge, 1).hazard, 0.6, 1e-15);
  near(findSpermPoolCrossing(huge, 0.3), 0.5, 1e-15);
  for (const t of [0, -1, NaN]) assert.equal(integrateSpermPoolRisk(sources, t).hazard, 0);
  for (const input of [0, -1]) assert.equal(findSpermPoolCrossing(sources, input), 0);
  for (const input of [NaN, Infinity]) assert.equal(findSpermPoolCrossing(sources, input), null);
  assert.equal(findSpermPoolCrossing([], 1), null);
  assert.equal(findSpermPoolCrossing(sources, 1, { sourceRates: [0, 0, 1] }), null);
});

test('混合池线性时钟跨归零与延迟起效折点吻合独立RK4', () => {
  const sources = [row('a', 15, 0.25), row('b', 18, 4), row('off', 6, 1, { blocked: true })];
  for (const clock of [
    { initial: -0.5, slopePerDay: 1 },
    { initial: 0.5, slopePerDay: -1 },
    { initial: -1, slopePerDay: -1 },
    { initial: 0, slopePerDay: 0 },
  ]) {
    const options = { sourceRates: [0.4, 1.3, 7], timeScale: clock };
    const expected = reference(sources, 1, options);
    const actual = integrateSpermPoolRisk(sources, 1, options);
    near(actual.hazard, expected.hazard, 3e-11);
    near(integrateSpermPool(sources, 1, options).hazard, expected.hazard, 3e-11);
    if (expected.hazard > 0 && clock.slopePerDay > 0) {
      near(findSpermPoolCrossing(sources, expected.hazard, options), 1, 4e-10);
    }
  }
  // 起点零系数时 H≈0.15*t²，极小预算也应直接从二次局部估计起步。
  const options = { timeScale: { initial: 0, slopePerDay: 1 } };
  for (const expectedTime of [1e-12, 1e-30, 1e-100]) {
    const budget = 0.15 * expectedTime ** 2;
    near(findSpermPoolCrossing([row('a', 20)], budget, options) / expectedTime, 1, 2e-12);
  }
});

test('新API保留冻结输入、品质归一化与缺省参数，并不混淆零配对和blocked', () => {
  const metadata = Object.freeze({ tag: 'anchor' });
  const sources = Object.freeze([
    Object.freeze(row('a', 20, '4', { metadata })),
    Object.freeze(row('b', 10, 0.01, { metadata, blocked: true })),
  ]);
  const options = Object.freeze({ sourceRates: Object.freeze([0.4, 9]), timeScale: Object.freeze({ initial: 1, slopePerDay: 0 }) });
  const before = JSON.stringify(sources);
  const result = integrateSpermPoolRisk(sources, 0.7, options);
  assert.equal(result.remainingSources[0].quality, 4);
  assert.equal(result.remainingSources[1].quality, 0.25);
  assert.equal(result.remainingSources[0].metadata, metadata);
  assert.ok(findSpermPoolCrossing(sources, result.hazard, options) > 0);
  assert.equal(JSON.stringify(sources), before);
  near(integrateSpermPoolRisk([row('a', 20)], 1, { timeScale: { initial: NaN, slopePerDay: Infinity } }).hazard,
    0.4 * (1 - 0.5 ** 1.5), 1e-14);
  const rate = getSpermPoolRates([row('a', 20), row('zero', 20)], { sourceRates: [1, 0] })[0].rate;
  near(rate, 0.3 * Math.sqrt(2) / 2, 1e-15);
});
