import { normalizeSpermQuality } from './sires.js';

// 只排序临时数列，不排序来源记录；补偿求和减少拆记录、换顺序的浮点差异。
function sum(values) {
  values.sort((a, b) => a - b);
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += total >= value ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
}

// 非负物理量直接补偿求和；真实合计溢出时汇总为 Infinity，内部解另行缩放。
function physicalTotal(values) {
  const total = sum([...values]);
  return Number.isFinite(total) ? total : Infinity;
}

/**
 * 连续主动排出：dVi/da = -(Vi / ΣV) * qi^(-1/4)，a 是绝对尝试量。
 * 只复制来源并更新 value；不合并记录、不改品质快照及其他元数据。
 * blocked 仍是已进入的物理量，和其他来源一样参与排出。
 * 无时间、持久状态、受精计算、取整或单次比例上限；零量记录也保留。
 *
 * 令 ri=qi^(1/4)，Vi=Vi0*exp(-z/ri)，则
 * a=ΣVi0*ri*(1-exp(-z/ri))，全清所需 effort=ΣVi0*ri。
 * 对这个严格单调的一元方程求根，即可让分操作与一次操作等效。
 * 返回 sources、排出前后物理总量、实际移除量、消耗 effort 及原始全清 effort。
 */
export function drainSpermSources(sources, amount) {
  const rows = (Array.isArray(sources) ? sources : []).map((source) => {
    const value = Number(source?.value);
    return { ...source, value: Number.isFinite(value) && value > 0 ? value : 0 };
  });
  const roots = rows.map((source) => normalizeSpermQuality(source.quality) ** 0.25);
  const scale = rows.reduce((largest, source) => Math.max(largest, source.value), 0);
  const weighted = rows.map((source, i) => scale > 0 ? (source.value / scale) * roots[i] : 0);
  const capacity = sum([...weighted]);
  const effortToClear = physicalTotal(rows.map((source, i) => source.value * roots[i]));
  const attempted = Number(amount);
  const effort = Number.isFinite(attempted) && attempted > 0 ? attempted : 0;
  let values = rows.map((source) => source.value);

  if (scale > 0 && effort > 0) {
    if (effort >= effortToClear) {
      values = rows.map(() => 0);
    } else {
      const fraction = (effort / scale) / capacity;
      // 临近全清时先在原始 effort 单位做差，避免 1-a/A 提前舍入成零。
      const remaining = Number.isFinite(effortToClear)
        ? ((effortToClear - effort) / scale) / capacity : 1 - fraction;
      const live = rows.map((source, i) => ({ value: source.value, root: roots[i], weight: weighted[i] / capacity }))
        .filter((source) => source.value > 0);
      if (live.every((source) => source.root === live[0].root)) {
        // 同品质退化成线性按比例排出；品质 1 即原来的连续数量语义。
        const factor = fraction <= 0.5 ? 1 - fraction : remaining;
        values = rows.map((source) => source.value * factor);
      } else if (fraction > 0) {
        const early = fraction <= 0.5;
        const target = early ? fraction : remaining;
        const log = early ? -Math.log1p(-fraction) : -Math.log(remaining);
        let lo = 0;
        let hi = live.reduce((largest, source) => Math.max(largest, source.root), 0) * log;
        let z = hi / 2;
        // 有界牛顿法：前半程用 expm1 保住小移除量，后半程直接解剩余量。
        for (let iteration = 0; iteration < 96; iteration++) {
          const evaluated = sum(live.map((source) => source.weight * (early
            ? -Math.expm1(-z / source.root) : Math.exp(-z / source.root))));
          const delta = evaluated - target;
          if (Math.abs(delta) <= 4 * Number.EPSILON * target) break;
          if ((early && delta < 0) || (!early && delta > 0)) lo = z;
          else hi = z;
          const derivative = sum(live.map((source) => source.weight * Math.exp(-z / source.root) / source.root));
          const next = z - delta / (early ? derivative : -derivative);
          z = next > lo && next < hi ? next : lo + (hi - lo) / 2;
          if (hi - lo <= Number.EPSILON * Math.max(hi, Number.MIN_VALUE)) break;
        }
        values = rows.map((source, i) => source.value * Math.exp(-z / roots[i]));
      }
    }
  }

  return {
    sources: rows.map((source, i) => ({ ...source, value: values[i] })),
    totalBefore: physicalTotal(rows.map((source) => source.value)),
    totalAfter: physicalTotal(values),
    removed: physicalTotal(rows.map((source, i) => Math.max(0, source.value - values[i]))),
    effortUsed: Math.min(effort, effortToClear),
    effortToClear,
  };
}
