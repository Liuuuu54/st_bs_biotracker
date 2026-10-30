// 连续主动排出的独立数值验证与性质测试；不经过工具、时间或持久池模型。
import assert from 'node:assert/strict';
import test from 'node:test';

import { drainSpermSources } from '../scripts/sperm_drain.js';

function close(actual, expected, label = '', relative = 2e-12, absolute = 1e-13) {
  assert.ok(Number.isFinite(actual), `${label} 应为有限数：${actual}`);
  assert.ok(Math.abs(actual - expected) <= Math.max(absolute, relative * Math.abs(expected)),
    `${label} 实际 ${actual}，预期 ${expected}`);
}

function compareSources(actual, expected, relative = 2e-12, absolute = 1e-13) {
  assert.equal(actual.length, expected.length);
  actual.forEach((source, i) => close(source.value, expected[i].value, `来源 ${i}`, relative, absolute));
}

const weighted = (sources) => sources.reduce((total, source) => total + source.value * source.quality ** 0.25, 0);

// 独立参考：直接对题定 dVi/da 做固定步长 RK4，不使用指数变换或 helper 的任何中间量。
function rk4(sources, effort, steps = 24000) {
  let values = sources.map((source) => source.value);
  const rates = sources.map((source) => source.quality ** -0.25);
  const derivative = (current) => {
    const total = current.reduce((a, b) => a + b, 0);
    return current.map((value, i) => -value / total * rates[i]);
  };
  const h = effort / steps;
  const offset = (current, k, factor) => current.map((value, i) => value + k[i] * factor);
  for (let step = 0; step < steps; step++) {
    const k1 = derivative(values);
    const k2 = derivative(offset(values, k1, h / 2));
    const k3 = derivative(offset(values, k2, h / 2));
    const k4 = derivative(offset(values, k3, h));
    values = values.map((value, i) => value + h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6);
  }
  return sources.map((source, i) => ({ ...source, value: values[i] }));
}

// q=0.25 与 q=4 的排出指数恰为 2:1，可独立化成 Ay²+By=C 的二次闭式解。
function twoQualityClosedForm(low, high, effort) {
  const a = low * (Math.SQRT2 / 2);
  const b = high * Math.SQRT2;
  const remaining = Math.max(0, a + b - effort);
  const y = 2 * remaining / (b + Math.sqrt(b * b + 4 * a * remaining));
  return [low * y * y, high * y];
}

test('品质 1 保留按比例排出的原始连续语义，不取整且默认品质等效', () => {
  const sources = [{ value: 31.125 }, { value: 78.875, quality: 1 }];
  for (const effort of [0, 0.001, 1, 42.75, 109.999, 110, 1e100]) {
    const result = drainSpermSources(sources, effort);
    const ratio = Math.max(0, 1 - effort / 110);
    sources.forEach((source, i) => close(result.sources[i].value, source.value * ratio));
    close(result.effortToClear, 110);
    close(result.removed, Math.min(110, effort));
  }
  assert.equal(drainSpermSources([{ value: 10 }], 0.125).sources[0].value, 9.875);
});

test('单来源及同品质多来源服从线性 closed form，尝试量超过原体积仍继续排出', () => {
  for (const quality of [0.25, 0.5, 1, 2, 4]) {
    const sources = [{ value: 17.25, quality }, { value: 42.75, quality }];
    const capacity = 60 * quality ** 0.25;
    for (const effort of [0, 0.5, 35, 60, capacity * 0.999, capacity, capacity * 100]) {
      const result = drainSpermSources(sources, effort);
      const expectedTotal = Math.max(0, 60 - effort * quality ** -0.25);
      close(result.totalAfter, expectedTotal);
      result.sources.forEach((source, i) => close(source.value, expectedTotal * sources[i].value / 60));
      close(result.effortToClear, capacity);
    }
    const solo = drainSpermSources([{ value: 40, quality }], 13);
    close(solo.sources[0].value, 40 - 13 * quality ** -0.25);
  }
  const high = drainSpermSources([{ value: 40, quality: 4 }], 50);
  close(high.totalAfter, 40 - 50 / Math.SQRT2);
  assert.ok(high.totalAfter < 40 - 40 / Math.SQRT2, '超过原体积的 effort 应继续排出，而非单次截在 40');
  assert.equal(drainSpermSources([{ value: 40, quality: 4 }], 80).totalAfter, 0);
});

test('混合品质与独立二次 closed form 一致，接近全清时仍保留正残留', () => {
  const sources = [{ value: 29, quality: 0.25 }, { value: 71, quality: 4 }];
  const capacity = weighted(sources);
  for (const fraction of [1e-9, 0.01, 0.25, 0.5, 0.8, 0.999, 1 - 1e-10]) {
    const effort = capacity * fraction;
    const result = drainSpermSources(sources, effort);
    const expected = twoQualityClosedForm(29, 71, effort);
    // 接近全清时要从约 140 的总量减出 1e-8 的差，双精度只剩约百万分之一的相对精度（随 V8 版本的 exp／log 尾数而变）；绝对容差放到 1e-12，物理上仍是零误差
    result.sources.forEach((source, i) => close(source.value, expected[i], `闭式来源 ${i}`, 1e-11, 1e-12));
    assert.ok(result.sources.every((source) => source.value > 0), '全清之前不按阈值删除正残留');
  }
});

test('混合品质直接 RK4 数值解验证，blocked 物理量同样参与方程', () => {
  const fixtures = [
    [{ value: 20, quality: 0.25 }, { value: 70, quality: 4 }],
    [{ value: 8.75, quality: 0.6 }, { value: 16, quality: 1 }, { value: 51.25, quality: 2.8, blocked: true }],
    [{ value: 0.01, quality: 4 }, { value: 12, quality: 0.25 }, { value: 3.333, quality: 1.7 }],
  ];
  for (const sources of fixtures) {
    for (const fraction of [0.2, 0.7, 0.95]) {
      const effort = weighted(sources) * fraction;
      compareSources(drainSpermSources(sources, effort).sources, rk4(sources, effort), 2e-10, 2e-11);
    }
  }
});

test('微小 effort 的导数满足 dVi/da=-Vi/ΣV*q^-1/4', () => {
  const sources = [{ value: 17, quality: 0.25 }, { value: 29, quality: 1.5 }, { value: 54, quality: 4 }];
  const effort = 1e-4;
  const result = drainSpermSources(sources, effort);
  sources.forEach((source, i) => {
    const observed = (result.sources[i].value - source.value) / effort;
    close(observed, -source.value / 100 * source.quality ** -0.25, `导数 ${i}`, 2e-6, 1e-8);
  });
});

test('加权剩余 effort 线性减少，全清 effort 为 ΣVi*q^1/4 而不是 ΣVi', () => {
  const sources = [{ value: 11, quality: 0.25 }, { value: 31, quality: 1 }, { value: 58, quality: 4 }];
  const capacity = weighted(sources);
  for (const fraction of [0, 0.01, 0.25, 0.5, 0.9, 0.999999]) {
    const effort = capacity * fraction;
    const result = drainSpermSources(sources, effort);
    close(result.effortToClear, capacity);
    close(weighted(result.sources), capacity - effort, '剩余加权 effort', 3e-11, 1e-13);
    close(result.effortUsed, effort);
    close(result.totalBefore, result.totalAfter + result.removed);
  }
  const cleared = drainSpermSources(sources, drainSpermSources(sources, 0).effortToClear);
  assert.ok(cleared.sources.every((source) => source.value === 0));
  assert.equal(cleared.totalAfter, 0);
  close(cleared.effortUsed, capacity);
  assert.ok(drainSpermSources(sources, 100).totalAfter > 0, '高品质混合物尝试量等于体积尚未全清');
});

test('同一总 effort 一次、两次、数百小次等效，包括跨过全清点', () => {
  const sources = [{ id: 'a', value: 21.5, quality: 0.25 }, { id: 'b', value: 78.5, quality: 4, blocked: true }];
  const capacity = weighted(sources);
  for (const fraction of [0.001, 0.3, 0.8, 0.999, 1.5]) {
    const effort = capacity * fraction;
    const once = drainSpermSources(sources, effort).sources;
    const twice = drainSpermSources(drainSpermSources(sources, effort * 0.37).sources, effort * 0.63).sources;
    compareSources(twice, once, 8e-12, 1e-12);
    let repeated = sources;
    for (let step = 0; step < 300; step++) repeated = drainSpermSources(repeated, effort / 300).sources;
    compareSources(repeated, once, 2e-9, 2e-11);
  }
});

test('同品质来源拆成独立记录与合并记录等效，但记录与元数据保持独立', () => {
  const metadata = { custom: ['原样保留'] };
  const merged = [{ id: 'a', value: 40, quality: 0.25 }, { id: 'b', value: 60, quality: 4 }];
  const split = [
    { id: 'a1', value: 1, quality: 0.25, metadata },
    { id: 'a2', value: 7.75, quality: 0.25, blocked: true },
    { id: 'a3', value: 31.25, quality: 0.25, race: '其他' },
    { id: 'b1', value: 23, quality: 4 }, { id: 'b2', value: 37, quality: 4 },
  ];
  for (const effort of [0, 5, 50, 99.9, 110, 1e9]) {
    const once = drainSpermSources(merged, effort).sources;
    const result = drainSpermSources(split, effort);
    assert.equal(result.sources.length, split.length);
    close(result.sources.slice(0, 3).reduce((total, source) => total + source.value, 0), once[0].value);
    close(result.sources.slice(3).reduce((total, source) => total + source.value, 0), once[1].value);
    result.sources.forEach((source, i) => {
      const { value: before, ...originalMetadata } = split[i];
      const { value: after, ...returnedMetadata } = source;
      assert.deepEqual(returnedMetadata, originalMetadata);
    });
  }
});

test('记录顺序不影响结果，重复名字与不同品质快照均不合并', () => {
  const sources = [
    { id: 'a', male: '同名', value: 0.1, quality: 0.25 },
    { id: 'b', male: '同名', value: 2e5, quality: 4 },
    { id: 'c', male: '其他', value: 13.25, quality: 1.7 },
    { id: 'd', male: '同名', value: 0, quality: 2 },
  ];
  const effort = weighted(sources) * 0.85;
  const baseline = drainSpermSources(sources, effort);
  for (const order of [[3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1]]) {
    const result = drainSpermSources(order.map((i) => sources[i]), effort);
    result.sources.forEach((source, i) => {
      assert.equal(source.id, sources[order[i]].id);
      close(source.value, baseline.sources[order[i]].value, source.id, 1e-14, 1e-20);
    });
  }
});

test('输入与所有元数据不变，输出记录是副本；blocked 不成为物理豁免', () => {
  const detail = Object.freeze({ ancestry: Object.freeze(['A', 'B']) });
  const sources = Object.freeze([
    Object.freeze({ id: 'a', male: '甲', race: '人类', value: 40, quality: 4, blocked: true, detail }),
    Object.freeze({ id: 'b', male: '乙', value: 40, quality: 4, marker: '独立记录' }),
    Object.freeze({ id: 'z', value: 0, quality: '0.25', blocked: true, extra: 7 }),
  ]);
  const snapshot = structuredClone(sources);
  for (const effort of [0, 10, 1e100]) {
    const result = drainSpermSources(sources, effort);
    assert.notStrictEqual(result.sources, sources);
    result.sources.forEach((source, i) => {
      assert.notStrictEqual(source, sources[i]);
      const { value, ...metadata } = source;
      const { value: originalValue, ...originalMetadata } = sources[i];
      assert.deepEqual(metadata, originalMetadata);
    });
    assert.strictEqual(result.sources[0].detail, detail, '只复制记录，不重建不透明元数据');
    close(result.sources[0].value, result.sources[1].value, 'blocked 和普通同量同品质记录等量排出');
  }
  assert.deepEqual(sources, snapshot);
});

test('品质按现有范围归一化，缺省或无效品质按 1；不改输入的品质元数据', () => {
  const cases = [
    [undefined, 1], [null, 1], [0, 1], [-3, 1], [NaN, 1], [Infinity, 1], ['坏值', 1],
    [0.0001, 0.25], [0.25, 0.25], [0.8, 0.8], [4, 4], [1e200, 4], ['2', 2],
  ];
  for (const [quality, normalized] of cases) {
    const result = drainSpermSources([{ value: 17, quality }], 3);
    close(result.sources[0].value, 17 - 3 * normalized ** -0.25);
    close(result.effortToClear, 17 * normalized ** 0.25);
    assert.equal(result.sources[0].quality, quality);
  }
});

test('空输入、零量记录和无效物理量均稳定为零；无效尝试量不排出', () => {
  for (const sources of [undefined, null, {}, []]) {
    assert.deepEqual(drainSpermSources(sources, 10), {
      sources: [], totalBefore: 0, totalAfter: 0, removed: 0, effortUsed: 0, effortToClear: 0,
    });
  }
  const zeros = [0, -1, undefined, NaN, Infinity, '坏值'].map((value, i) => ({ id: i, value, blocked: true }));
  const zeroResult = drainSpermSources(zeros, 100);
  assert.equal(zeroResult.sources.length, zeros.length);
  assert.ok(zeroResult.sources.every((source) => source.value === 0));
  assert.equal(zeroResult.effortToClear, 0);
  assert.equal(zeroResult.removed, 0);
  for (const effort of [0, -1, undefined, null, NaN, Infinity, -Infinity, '坏值']) {
    const sources = [{ value: 9.125, quality: 4, blocked: true }];
    const result = drainSpermSources(sources, effort);
    assert.deepEqual(result.sources, sources);
    assert.equal(result.removed, 0);
    assert.equal(result.effortUsed, 0);
  }
  close(drainSpermSources([{ value: '10', quality: 1 }], '2.5').totalAfter, 7.5);
});

test('极小和极大物理量具有相同缩放结果，不引入绝对残留阈值或体积上限', () => {
  const sources = [{ value: 0.37, quality: 0.25 }, { value: 0.63, quality: 4 }];
  const effort = 0.61;
  const baseline = drainSpermSources(sources, effort);
  for (const scale of [1e-280, 1e-150, 1e-12, 1e12, 1e150, 1e280]) {
    const result = drainSpermSources(sources.map((source) => ({ ...source, value: source.value * scale })), effort * scale);
    result.sources.forEach((source, i) => close(source.value / scale, baseline.sources[i].value, `缩放 ${scale}`, 5e-13, 1e-15));
    close(result.effortToClear / scale, baseline.effortToClear);
    assert.ok(result.sources.every((source) => source.value > 0));
  }
  const tiny = drainSpermSources([{ value: 1e-300, quality: 4 }], 1e-301);
  close(tiny.totalAfter / 1e-300, 1 - 0.1 / Math.SQRT2);
  assert.ok(tiny.totalAfter > 0);
});

test('非常小的 effort 不污染混合解，全清前一个浮点量级仍有正物理量', () => {
  const sources = [{ value: 3, quality: 0.25 }, { value: 7, quality: 4 }];
  const capacity = drainSpermSources(sources, 0).effortToClear;
  const tiny = drainSpermSources(sources, 1e-280);
  compareSources(tiny.sources, sources, 0, 0);
  const effort = capacity * (1 - 8 * Number.EPSILON);
  const result = drainSpermSources(sources, effort);
  assert.ok(result.sources.every((source) => source.value > 0));
  close(weighted(result.sources), capacity - effort, '极近全清剩余 effort', 2e-12, 1e-28);
});

test('多个极大有限来源即使合计溢出，内部连续解仍是有限物理量', () => {
  const scale = 8e307;
  const sources = [{ value: scale, quality: 0.25 }, { value: scale, quality: 4 }, { value: scale, quality: 1 }];
  const effort = 1e308;
  const result = drainSpermSources(sources, effort);
  const baseline = drainSpermSources(sources.map((source) => ({ ...source, value: 1 })), effort / scale);
  assert.equal(result.totalBefore, Infinity, '只有真实总量超出双精度表示范围时汇总才为 Infinity');
  assert.equal(result.effortToClear, Infinity);
  result.sources.forEach((source, i) => close(source.value / scale, baseline.sources[i].value));
  assert.ok(result.sources.every((source) => source.value >= 0 && Number.isFinite(source.value)));
});

test('体积合计溢出但低品质全清 effort 仍有限，按 effort 全清而非按体积限幅', () => {
  const sources = [{ value: 1e308, quality: 0.25 }, { value: 1e308, quality: 0.25 }];
  const partial = drainSpermSources(sources, 1e308);
  assert.equal(partial.totalBefore, Infinity);
  close(partial.effortToClear / 1e308, Math.SQRT2);
  partial.sources.forEach((source) => close(source.value / 1e308, 1 - 1 / Math.SQRT2));
  const cleared = drainSpermSources(sources, partial.effortToClear);
  assert.deepEqual(cleared.sources.map((source) => source.value), [0, 0]);
  assert.equal(cleared.effortUsed, partial.effortToClear);
});

test('确定性混合样本覆盖分操作、拆记录、单调性和 effort 守恒', () => {
  let seed = 20261030;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let sample = 0; sample < 80; sample++) {
    const sources = Array.from({ length: 2 + sample % 5 }, (_, id) => ({
      id, value: 0.001 + random() * 100, quality: 0.25 + random() * 3.75, blocked: id % 2 === 0,
    }));
    const capacity = weighted(sources);
    const effort = capacity * (0.001 + random() * 0.998);
    const once = drainSpermSources(sources, effort);
    const splitEffort = drainSpermSources(drainSpermSources(sources, effort * 0.4).sources, effort * 0.6);
    compareSources(splitEffort.sources, once.sources, 2e-11, 1e-12);
    close(weighted(once.sources), capacity - effort, '随机样本 effort 守恒', 2e-11, 1e-12);
    const pieces = sources.flatMap((source) => [
      { ...source, value: source.value * 0.2, part: 1 }, { ...source, value: source.value * 0.8, part: 2 },
    ]);
    const divided = drainSpermSources(pieces, effort);
    sources.forEach((source, i) => {
      close(divided.sources[i * 2].value + divided.sources[i * 2 + 1].value, once.sources[i].value);
      assert.ok(once.sources[i].value >= 0 && once.sources[i].value <= source.value);
    });
    const later = drainSpermSources(sources, Math.min(capacity, effort * 1.05));
    later.sources.forEach((source, i) => assert.ok(source.value <= once.sources[i].value, '增加 effort 后残留单调不增'));
  }
});
