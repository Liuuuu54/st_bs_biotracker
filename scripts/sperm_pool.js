/**
 * 无依赖混合池模型，时间单位为游戏日，来源保留 male、id、race 等上游元数据。
 * blocked === true 表示已进入后失活：仍占容量并参与物理清除，但受精率为零。
 * 从未进入的物料由调用方省略，不应标记成 blocked 后加入池中。
 * 卵子/孕期门控、事件时序、随机抽样与持久化均由上游负责。
 */

const DECAY = 10;
const BASE_RATE = 0.3;

function quality(value) {
  // 与 sires.js 的 normalizeSpermQuality 保持一致，避免引入宿主依赖。
  const q = Number(value);
  return Number.isFinite(q) && q > 0 ? Math.max(0.25, Math.min(4, q)) : 1;
}

function amount(value) {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function unit(value) {
  const u = Number(value);
  return Number.isFinite(u) && u > 0 ? u : 1;
}

function days(value) {
  const t = Number(value);
  return t > 0 ? t : 0;
}

// 仅排序临时数值项，不改变来源数组；补偿求和保证排列重现性与索引稳定。
function sum(values) {
  values.sort((a, b) => a - b);
  let total = 0;
  let error = 0;
  for (const value of values) {
    const next = total + value;
    error += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + error;
}

function copySources(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => ({
    ...source, value: amount(source?.value), quality: quality(source?.quality),
  }));
}

function prepare(sources, volumeFactor, qualityExponent = 0.5, clearance = DECAY) {
  const rows = copySources(sources);
  // 自然清除保持原有数值路径；主动排出使用 q^(1/4)。
  const roots = rows.map((source) => qualityExponent === 0.5
    ? Math.sqrt(source.quality) : Math.sqrt(Math.sqrt(source.quality)));
  const live = rows.map((source, i) => ({ value: source.value, root: roots[i] })).filter((row) => row.value > 0);
  const scale = Math.max(0, ...live.map((row) => row.value));
  const weighted = live.map((row) => (row.value / scale) * row.root);
  const normalizedMass = sum([...weighted]);
  const u = unit(volumeFactor);
  const scaledVolume = scale / u;
  const effective = sum(live.map((row) => row.value * row.root));
  const directLifetime = effective / u / clearance;
  return {
    rows, roots, live, u,
    lifetime: Number.isFinite(directLifetime) ? directLifetime
      : (Number.isFinite(scaledVolume) ? scaledVolume / clearance : scale / clearance / u) * normalizedMass,
    uniform: live.length === 0 || live.every((row) => row.root === live[0].root),
    weights: weighted.map((value) => value / normalizedMass),
  };
}

/** 求解 sum Vi*sqrt(qi)*exp(-z/sqrt(qi)) = L0*(1-fraction)。
 * 前段用 expm1 保留微小损失；耗尽附近直接求剩余量以避免相消。
 * Newton 步始终限制在已证明包含解的区间内。
 */
function latent(pool, fraction, remaining = 1 - fraction) {
  const { live, weights } = pool;
  const maxRoot = Math.max(...live.map((row) => row.root));
  let lo = 0;
  let hi = -maxRoot * (fraction <= 0.5 ? Math.log1p(-fraction) : Math.log(remaining));
  let z = hi / 2;
  const early = fraction <= 0.5;
  const target = early ? fraction : remaining;
  for (let iteration = 0; iteration < 80; iteration++) {
    const terms = live.map((row, i) => weights[i] * (early
      ? -Math.expm1(-z / row.root) : Math.exp(-z / row.root)));
    const value = sum(terms);
    const delta = value - target;
    if (Math.abs(delta) <= 4 * Number.EPSILON * target) return z;
    if ((early && delta < 0) || (!early && delta > 0)) lo = z;
    else hi = z;
    const derivative = sum(live.map((row, i) => weights[i] * Math.exp(-z / row.root) / row.root));
    const next = z - delta / (early ? derivative : -derivative);
    z = next > lo && next < hi ? next : (lo + hi) / 2;
    if (hi - lo <= Number.EPSILON * Math.max(hi, Number.MIN_VALUE)) return z;
  }
  return z;
}

function valuesAt(pool, fraction, remaining = 1 - fraction) {
  if (!(remaining > 0)) return pool.rows.map(() => 0);
  if (!(fraction > 0)) return pool.rows.map((source) => source.value);
  if (pool.uniform) return pool.rows.map((source) => source.value * remaining);
  const z = latent(pool, fraction, remaining);
  return pool.rows.map((source, i) => source.value * Math.exp(-z / pool.roots[i]));
}

/** 物理清除 dVi/dt = -10*U*(Vi/sum V)/sqrt(qi)。
 * 包括 blocked 体积在内，L=sum Vi*sqrt(qi) 每日严格减少 10*U。
 * 混合品质通过单一潜变量求解；同品质时各源量线性下降。
 */
export function advanceSpermPool(sources, elapsedDays, { volumeFactor = 1 } = {}) {
  const pool = prepare(sources, volumeFactor);
  const t = days(elapsedDays);
  const fraction = t > 0 && pool.lifetime > 0 ? Math.min(1, t / pool.lifetime) : 0;
  const values = valuesAt(pool, fraction);
  return pool.rows.map((source, i) => ({ ...source, value: values[i] }));
}

/** 瞬时主动排出，绝对努力量 a 不代表时间或体型缩放剂量。
 * dVi/da = -(Vi/sum V)/q_i^(1/4)，无单次比例上限或舍入；
 * 一次或多次施加相同总努力量产生相同物理状态。
 * 失活物料仍具物理体积；从未进入的物料不加入池中。
 * 卵子、随机与孕期状态不属于此纯函数。
 */
export function drainSpermPool(sources, attemptAmount) {
  if (!Number.isFinite(attemptAmount) || attemptAmount < 0) {
    throw new RangeError('Sperm drain effort must be finite and nonnegative.');
  }
  const physical = (Array.isArray(sources) ? sources : []).map((source) =>
    source?.fertilityStatus === 'not-entered' ? { ...source, value: 0 } : source);
  const pool = prepare(physical, 1, 0.25, 1);
  const fraction = pool.lifetime > 0 ? Math.min(1, attemptAmount / pool.lifetime) : 0;
  const values = valuesAt(pool, fraction);
  const after = pool.rows.map((source, i) => ({ ...source, value: values[i] }));
  const details = pool.rows.map((source, sourceIndex) => ({
    sourceIndex, id: source.id ?? null, male: source.male ?? '', quality: source.quality,
    before: source.value, removed: Math.max(0, source.value - values[sourceIndex]),
    remaining: values[sourceIndex],
  }));
  return { sources: after, attempted: attemptAmount,
    before: sum(details.map((source) => source.before)),
    removed: sum(details.map((source) => source.removed)),
    remaining: sum(details.map((source) => source.remaining)), details };
}

/** 先填充剩余容量，再让输入流经连续混合池。
 * 满池后旧源量乘 exp(-excess/C)，新源保留量为 C*(-expm1(-excess/C))。
 * 原有超容量部分先按比例排出，视作容量变化事件。
 * spilled 计物理溢出量而非风险；incoming 是一个实际进入来源。
 * 返回副本保留零量来源。
 */
export function depositSpermPool(sources, incoming, capacity) {
  const rows = copySources(sources);
  const added = copySources([incoming])[0];
  const total = sum(rows.map((source) => source.value));
  const numericCapacity = Number(capacity);
  const cap = numericCapacity > 0 ? numericCapacity : 0;
  if (cap === Infinity) return { sources: [...rows, added], spilled: 0 };
  if (cap === 0) {
    return { sources: [...rows, added].map((source) => ({ ...source, value: 0 })), spilled: total + added.value };
  }
  const shrink = total > cap ? cap / total : 1;
  const current = Math.min(total, cap);
  const fill = Math.min(added.value, Math.max(0, cap - current));
  const excess = added.value - fill;
  const factor = Math.exp(-excess / cap);
  const retained = -cap * Math.expm1(-excess / cap);
  return {
    sources: [
      ...rows.map((source) => ({ ...source, value: source.value * shrink * factor })),
      { ...added, value: fill * factor + retained },
    ],
    // 满池时每进入一个体积单位恰好置换一个体积单位。
    spilled: Math.max(0, total - cap) + excess,
  };
}

function pairingRates(rows, sourceRates) {
  return rows.map((source, i) => source.blocked === true ? 0
    : sourceRates[i] === undefined ? 1 : amount(sourceRates[i]));
}

function activeDose(pool, values) {
  const scale = Math.max(0, ...values.map((value, i) => pool.rows[i].blocked === true ? 0 : value));
  if (!(scale > 0)) return { effective: 0, shares: values.map(() => 0) };
  const weighted = values.map((value, i) => pool.rows[i].blocked === true ? 0 : (value / scale) * pool.roots[i]);
  const total = sum([...weighted]);
  return { effective: (scale / pool.u) * total, shares: weighted.map((value) => value / total) };
}

function ratesAt(pool, values, pairing) {
  const { effective, shares } = activeDose(pool, values);
  const dose = Math.min(2, Math.sqrt(effective / 20));
  return shares.map((share, i) => BASE_RATE * dose * share * pairing[i]);
}

/** sourceRates[i] 是配对系数（1/difficulty），不是最终概率。
 * 缺省系数为 1，显式非有限值或负值为零。
 * 不兼容但仍活性的物料保留在活性剂量分母中，仅 blocked 物料排除。
 */
export function getSpermPoolRates(sources, { volumeFactor = 1, sourceRates = [] } = {}) {
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const rates = ratesAt(pool, pool.rows.map((source) => source.value), pairing);
  return pool.rows.map((source, sourceIndex) => ({ ...source, sourceIndex, rate: rates[sourceIndex] }));
}

// 线性下降 X 下 min(2,sqrt(X/20)) 的精确积分。
// 使用时长和端点均值，避免相近幂相减。
function doseIntegral(start, end, duration) {
  if (!(start > 0) || !(duration > 0)) return 0;
  // 有限源量相加可能溢出；此时未饱和尾段相对总寿命小于双精度分辨率。
  if (start === Infinity || end >= 80) return 2 * duration;
  if (start > 80) {
    const capped = duration * ((start - 80) / (start - end));
    return 2 * capped + doseIntegral(80, end, duration - capped);
  }
  const a = Math.sqrt(start);
  const b = Math.sqrt(Math.max(0, end));
  return duration * (2 / (3 * Math.sqrt(20))) * (start + a * b + end) / (a + b);
}

// 时间系数绑定到当前锚点；分段调用应沿用锚点，或同时平移 initial。
function timeScale(options) {
  const initial = Number(options?.initial ?? 1);
  const slope = Number(options?.slopePerDay ?? 0);
  return { initial: Number.isFinite(initial) ? initial : 1, slope: Number.isFinite(slope) ? slope : 0 };
}

function scaleAt(clock, t) {
  return Math.max(0, clock.initial + clock.slope * t);
}

function riskEnd(pool, clock) {
  if (clock.slope < 0) return Math.min(pool.lifetime, Math.max(0, clock.initial / -clock.slope));
  return clock.initial <= 0 && clock.slope === 0 ? 0 : pool.lifetime;
}

// 同品质时有效份额恒定；全部物料有效且配对率相同时，总剂量也严格线性下降。
function linearProfile(pool, pairing) {
  const physical = pool.rows.map((source, i) => i).filter((i) => pool.rows[i].value > 0);
  const dose = activeDose(pool, pool.rows.map((source) => source.value));
  if (pool.uniform) return {
    start: dose.effective, coefficient: BASE_RATE * sum(dose.shares.map((share, i) => share * pairing[i])),
  };
  if (physical.every((i) => pool.rows[i].blocked !== true && pairing[i] === pairing[physical[0]])) {
    return { start: dose.effective, coefficient: BASE_RATE * pairing[physical[0]] };
  }
  return null;
}

// 对 sqrt(线性剂量) × 非负线性时间系数解析积分；端点多项式避免相近幂相减。
function scaledDoseIntegral(start, duration, lifetime, clock) {
  if (!(start > 0) || !(duration > 0)) return 0;
  if (clock.initial === 1 && clock.slope === 0) {
    return doseIntegral(start, start * Math.max(0, 1 - duration / lifetime), duration);
  }
  const lo = clock.slope > 0 ? Math.max(0, -clock.initial / clock.slope) : 0;
  const hi = clock.slope < 0 ? Math.min(duration, clock.initial / -clock.slope) : duration;
  if (!(hi > lo) || (clock.slope === 0 && !(clock.initial > 0))) return 0;
  const capTime = start > 80 ? lifetime * (1 - 80 / start) : 0;
  const cuts = [lo, ...(capTime > lo && capTime < hi ? [capTime] : []), hi];
  let area = 0;
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    const sa = scaleAt(clock, a), sb = scaleAt(clock, b);
    if (b <= capTime) {
      area += (b - a) * (sa + sb);
    } else {
      const x = start * Math.max(0, 1 - a / lifetime);
      const y = start * Math.max(0, 1 - b / lifetime);
      if (!(x > 0)) continue;
      const r = Math.sqrt(y / x);
      const denominator = 15 * (1 + r) ** 2;
      const left = 2 * (3 + 6 * r + 4 * r ** 2 + 2 * r ** 3) / denominator;
      const right = 2 * (2 + 4 * r + 6 * r ** 2 + 3 * r ** 3) / denominator;
      area += (b - a) * Math.sqrt(x / 20) * (sa * left + sb * right);
    }
  }
  return area;
}

// Dormand–Prince 5(4)：预览联合积分 Hi 与生存加权 Wi；风险模式仅积分一个总 H。
// 两种模式共用物理时钟与误差控制，但风险模式既不构造 Wi，也不积分分源 Hi。
const RK_A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const RK_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const RK_B = [...RK_A[6], 0];
const RK_ERROR = [35 / 384 - 5179 / 57600, 0, 500 / 1113 - 7571 / 16695,
  125 / 192 - 393 / 640, -2187 / 6784 + 92097 / 339200, 11 / 84 - 187 / 2100, -1 / 40];

function integrateRisks(pool, duration, pairing, riskOnly = false, clock = timeScale()) {
  const n = pool.rows.length;
  const fraction = Math.min(1, duration / pool.lifetime);
  // t=T*y*(2-y) 平滑耗尽端点；再归一化到 x∈[0,1]，保留极短时间窗精度。
  const endY = fraction / (1 + Math.sqrt(1 - fraction));
  const derivative = (x, state) => {
    const y = endY * x;
    const remaining = (1 - y) ** 2;
    const values = valuesAt(pool, y * (2 - y), remaining);
    const rates = ratesAt(pool, values, pairing);
    const t = duration * x * ((2 - y) / (2 - endY));
    const jacobian = duration * (2 * (1 - y) / (2 - endY)) * scaleAt(clock, t);
    if (riskOnly) return [sum(rates) * jacobian];
    const survival = Math.exp(-Math.max(0, sum(state.slice(0, n))));
    return [...rates.map((rate) => rate * jacobian), ...rates.map((rate) => survival * rate * jacobian)];
  };
  // 显式拆开剂量 cap 和时间系数归零处，避免跨折点步进误判误差。
  const initialDose = activeDose(pool, pool.rows.map((source) => source.value));
  const finalDose = activeDose(pool, valuesAt(pool, fraction));
  const boundaries = [];
  if (initialDose.effective > 80 && finalDose.effective < 80) {
    const activeIndices = pool.rows.map((source, i) => i).filter((i) => pool.rows[i].value > 0 && pool.rows[i].blocked !== true);
    const activePool = {
      live: activeIndices.map((i) => ({ value: pool.rows[i].value, root: pool.roots[i] })),
      weights: activeIndices.map((i) => initialDose.shares[i]),
    };
    const rest = 80 / initialDose.effective;
    const z = latent(activePool, 1 - rest, rest);
    const removed = sum(pool.live.map((row, i) => pool.weights[i] * -Math.expm1(-z / row.root)));
    const restPhysical = sum(pool.live.map((row, i) => pool.weights[i] * Math.exp(-z / row.root)));
    const cut = removed / (1 + Math.sqrt(restPhysical)) / endY;
    if (cut > 0 && cut < 1) boundaries.push(cut);
  }
  const scaleZero = -clock.initial / clock.slope;
  if (scaleZero > 0 && scaleZero < duration) {
    const cutFraction = scaleZero / pool.lifetime;
    const cut = (cutFraction / (1 + Math.sqrt(1 - cutFraction))) / endY;
    if (cut > 0 && cut < 1) boundaries.push(cut);
  }
  boundaries.push(1);
  boundaries.sort((a, b) => a - b);
  const cuts = boundaries.filter((cut, i) => i === 0 || cut !== boundaries[i - 1]);
  let boundaryIndex = 0;
  let state = Array(riskOnly ? 1 : 2 * n).fill(0);
  let x = 0;
  let step = 0.1;
  const peakScale = Math.max(scaleAt(clock, 0), scaleAt(clock, duration));
  const scale = Math.min(1, duration * sum(ratesAt(pool, pool.rows.map((source) => source.value), pairing)) * peakScale);
  const absoluteTolerance = Math.max(Number.MIN_VALUE, 1e-13 * scale / (riskOnly ? 1 : Math.max(1, n)));
  for (let attempt = 0; x < 1; attempt++) {
    if (attempt >= 10000) throw new Error('Sperm pool risk integration did not converge');
    const distance = cuts[boundaryIndex] - x;
    step = Math.min(step, distance);
    const stages = [];
    for (let stage = 0; stage < 7; stage++) {
      const trial = state.map((value, i) => value + step * sum(RK_A[stage].map((a, j) => a * stages[j][i])));
      stages.push(derivative(x + RK_C[stage] * step, trial));
    }
    const next = state.map((value, i) => value + step * sum(RK_B.map((b, j) => b * stages[j][i])));
    let error = 0;
    for (let i = 0; i < state.length; i++) {
      const delta = step * sum(RK_ERROR.map((b, j) => b * stages[j][i]));
      const tolerance = absoluteTolerance + 2e-12 * Math.max(Math.abs(state[i]), Math.abs(next[i]));
      error = Math.max(error, Math.abs(delta) / tolerance);
    }
    if (error <= 1) {
      state = next;
      if (step === distance) x = cuts[boundaryIndex++];
      else x += step;
    }
    if (step <= Number.EPSILON * 8 && error > 1) throw new Error('Sperm pool integration step underflow');
    step *= error === 0 ? 5 : Math.max(0.1, Math.min(5, 0.9 * error ** -0.2));
  }
  return riskOnly ? Math.max(0, state[0]) : { hazards: state.slice(0, n), wins: state.slice(n) };
}

function totalRisk(pool, duration, pairing, clock) {
  const t = Math.min(duration, riskEnd(pool, clock));
  if (!(t > 0) || !pool.rows.some((source, i) => source.value > 0 && pairing[i] > 0)) return 0;
  const profile = linearProfile(pool, pairing);
  return profile
    ? profile.coefficient * scaledDoseIntegral(profile.start, t, pool.lifetime, clock)
    : integrateRisks(pool, t, pairing, true, clock);
}

/** 只计算累计总风险，不积分分源审计量 Hi 或竞争获胜量 Wi。
 * 参数在锚点内固定；timeScale 可选，按锚点起算 max(0, initial+slopePerDay*t)。
 * 剩余物理量始终推进完整 elapsedDays，即使时间系数已归零。
 */
export function integrateSpermPoolRisk(sources, elapsedDays, {
  volumeFactor = 1, sourceRates = [], timeScale: scale,
} = {}) {
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const hazard = totalRisk(pool, Math.min(days(elapsedDays), pool.lifetime), pairing, timeScale(scale));
  return { hazard, successChance: -Math.expm1(-hazard),
    remainingSources: advanceSpermPool(pool.rows, elapsedDays, { volumeFactor: pool.u }) };
}

// 常量时间系数的线性剂量可直接反解；expm1/log1p 保留极小预算与耗尽端点。
function inverseLinearRisk(profile, lifetime, target, initial) {
  const coefficient = profile.coefficient * initial;
  const tailFraction = Math.min(1, 80 / profile.start);
  const tailDuration = lifetime * tailFraction;
  const capDuration = lifetime * (1 - tailFraction);
  const cappedHazard = 2 * coefficient * capDuration;
  if (target <= cappedHazard) return target / (2 * coefficient);
  const tailDose = Math.min(80, profile.start);
  const tailHazard = coefficient * tailDuration * (2 / 3) * Math.sqrt(tailDose / 20);
  const fraction = Math.min(1, (target - cappedHazard) / tailHazard);
  return capDuration + tailDuration * -Math.expm1((2 / 3) * Math.log1p(-fraction));
}

/** 返回 H(t) 首次达到 targetHazard 的锚点相对天数；全寿命未达到则返回 null。
 * 求根上界只由物理寿命及时间系数归零时刻决定，与调用窗口无关。
 * 零或负预算返回 0；正无穷和 NaN 返回 null；精确耗尽预算返回精确端点。
 */
export function findSpermPoolCrossing(sources, targetHazard, {
  volumeFactor = 1, sourceRates = [], timeScale: scale,
} = {}) {
  const target = Number(targetHazard);
  if (target <= 0) return 0;
  if (!Number.isFinite(target)) return null;
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const clock = timeScale(scale);
  const end = riskEnd(pool, clock);
  if (!(end > 0)) return null;
  const full = totalRisk(pool, end, pairing, clock);
  if (!(full > 0)) return null;
  // 独立闭式预算与积分端点可能相差几个 ulp；只在浮点舍入带内视为同一端点。
  if (target > full) return target - full <= 8 * Number.EPSILON * target ? end : null;
  if (target === full) return end;
  const profile = linearProfile(pool, pairing);
  if (profile && clock.slope === 0 && clock.initial > 0) {
    return Math.min(end, inverseLinearRisk(profile, pool.lifetime, target, clock.initial));
  }
  let lo = clock.slope > 0 ? Math.max(0, -clock.initial / clock.slope) : 0;
  let hi = end;
  const firstRate = sum(ratesAt(pool, pool.rows.map((source) => source.value), pairing)) * scaleAt(clock, 0);
  let t;
  if (firstRate > 0) {
    t = Math.min(end / 2, target / firstRate);
  } else if (clock.slope > 0) {
    // 延迟起效处 H 是二阶小量；用局部二次反解起步，避免极小预算依赖漫长二分。
    const onsetValues = valuesAt(pool, Math.min(1, lo / pool.lifetime));
    const onsetRate = sum(ratesAt(pool, onsetValues, pairing));
    const offset = Math.SQRT2 * Math.sqrt((target / onsetRate) / clock.slope);
    t = lo + Math.min((hi - lo) / 2, offset);
  } else {
    t = (lo + hi) / 2;
  }
  for (let iteration = 0; iteration < 96; iteration++) {
    const h = totalRisk(pool, t, pairing, clock);
    const delta = h - target;
    if (Math.abs(delta) <= 8 * Number.EPSILON * target) return t;
    if (delta < 0) lo = t;
    else hi = t;
    const values = valuesAt(pool, Math.min(1, t / pool.lifetime));
    const rate = sum(ratesAt(pool, values, pairing)) * scaleAt(clock, t);
    const next = t - delta / rate;
    t = next > lo && next < hi ? next : lo + (hi - lo) / 2;
    if (hi - lo <= 4 * Number.EPSILON * Math.max(hi, Number.MIN_VALUE)) return t;
  }
  return t;
}

/** 单个无新输入风险窗的确定性预览。
 * hazard=sum Hi，successChance=-expm1(-hazard)。
 * Hi 仅为审计积分；winChance 是竞争风险质量
 * Wi=integral exp(-H(t))*lambda_i(t) dt，winnerWeight=Wi/successChance。
 * 连续窗口的 Wi 按 Wi(first)+exp(-Hfirst)*Wi(second) 合成。
 * 可选 timeScale 与纯风险接口相同，未传时保持原有预览行为。
 */
export function integrateSpermPool(sources, elapsedDays, {
  volumeFactor = 1, sourceRates = [], timeScale: scale,
} = {}) {
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const clock = timeScale(scale);
  const duration = Math.min(days(elapsedDays), riskEnd(pool, clock));
  let hazards = pool.rows.map(() => 0);
  let wins = pool.rows.map(() => 0);
  if (duration > 0 && pool.rows.some((source, i) => source.value > 0 && pairing[i] > 0)) {
    if (pool.uniform) {
      const { effective: start, shares } = activeDose(pool, pool.rows.map((source) => source.value));
      const area = scaledDoseIntegral(start, duration, pool.lifetime, clock);
      hazards = shares.map((share, i) => BASE_RATE * area * share * pairing[i]);
      const h = sum([...hazards]);
      const p = -Math.expm1(-h);
      wins = hazards.map((value) => h > 0 ? p * (value / h) : 0);
    } else {
      ({ hazards, wins } = integrateRisks(pool, duration, pairing, false, clock));
    }
  }
  hazards = hazards.map((value) => Math.max(0, value));
  const hazard = sum([...hazards]);
  const successChance = -Math.expm1(-hazard);
  wins = wins.map((value) => Math.max(0, value));
  const winMass = sum([...wins]);
  // 将积分舍入误差校正到精确生存恒等式 sum Wi=P。
  // 这里只缩放积分得到的 Wi，而非通常不同的累计 Hi。
  const correction = winMass > 0 ? successChance / winMass : 0;
  return {
    hazard,
    successChance,
    sources: pool.rows.map((source, sourceIndex) => {
      const winChance = wins[sourceIndex] * correction;
      return { ...source, sourceIndex, hazard: hazards[sourceIndex], winChance,
        winnerWeight: successChance > 0 ? winChance / successChance : 0 };
    }),
    remainingSources: advanceSpermPool(pool.rows, elapsedDays, { volumeFactor: pool.u }),
  };
}
