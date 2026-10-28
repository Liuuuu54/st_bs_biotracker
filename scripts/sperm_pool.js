/**
 * Dependency-free mixed-pool model; time is measured in days.
 * Sources retain their upstream metadata (male, id, race, etc.). `blocked === true`
 * means material entered the pool and was subsequently inactivated: it still
 * occupies capacity and participates in physical clearance, but has zero rate.
 * Material that never entered must be omitted by the caller, not marked blocked.
 * Egg/pregnancy guards, event timing, random draws and persistence belong upstream.
 */

const DECAY = 10;
const BASE_RATE = 0.3;

function quality(value) {
  // Keep in sync with sires.js normalizeSpermQuality, without its host imports.
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

// Sort only temporary numeric summands, never the authoritative source array.
// Compensated summation makes permutations reproducible without changing indices.
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

function prepare(sources, volumeFactor) {
  const rows = copySources(sources);
  const roots = rows.map((source) => Math.sqrt(source.quality));
  const live = rows.map((source, i) => ({ value: source.value, root: roots[i] })).filter((row) => row.value > 0);
  const scale = Math.max(0, ...live.map((row) => row.value));
  const weighted = live.map((row) => (row.value / scale) * row.root);
  const normalizedMass = sum([...weighted]);
  const u = unit(volumeFactor);
  const scaledVolume = scale / u;
  const effective = sum(live.map((row) => row.value * row.root));
  const directLifetime = effective / u / DECAY;
  return {
    rows, roots, live, u,
    lifetime: Number.isFinite(directLifetime) ? directLifetime
      : (Number.isFinite(scaledVolume) ? scaledVolume / DECAY : scale / DECAY / u) * normalizedMass,
    uniform: live.length === 0 || live.every((row) => row.root === live[0].root),
    weights: weighted.map((value) => value / normalizedMass),
  };
}

/** Solve sum Vi*sqrt(qi)*exp(-z/sqrt(qi)) = L0*(1-fraction).
 * Early times use expm1 to retain tiny losses; near exhaustion solve remaining
 * mass directly to avoid cancellation. Newton steps stay inside a proven bracket.
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

/** Physical clearance dVi/dt = -10*U*(Vi/sum V)/sqrt(qi).
 * L=sum Vi*sqrt(qi) decreases exactly at 10*U per day, including blocked volume.
 * A single latent variable gives the mixed-quality solution; equal q is linear.
 */
export function advanceSpermPool(sources, elapsedDays, { volumeFactor = 1 } = {}) {
  const pool = prepare(sources, volumeFactor);
  const t = days(elapsedDays);
  const fraction = t > 0 && pool.lifetime > 0 ? Math.min(1, t / pool.lifetime) : 0;
  const values = valuesAt(pool, fraction);
  return pool.rows.map((source, i) => ({ ...source, value: values[i] }));
}

/** Fill spare capacity, then stream incoming through a continuously mixed pool.
 * Once full, old quantities multiply by exp(-excess/C); retained new material
 * is C*(-expm1(-excess/C)). Existing over-capacity volume is first proportionally
 * expelled (a capacity-change event). `spilled` counts physical volume, not risk.
 * Incoming is ONE actual entered source. Zero sources remain in the returned copy.
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
    // At full capacity each unit entering displaces exactly one physical unit.
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

/** sourceRates[i] is a pairing coefficient (1/difficulty), NOT a final chance.
 * Missing coefficients default to 1; explicit nonfinite/negative coefficients
 * are zero. Incompatible but still active material remains in the active-dose
 * denominator; only blocked material is excluded from that denominator.
 */
export function getSpermPoolRates(sources, { volumeFactor = 1, sourceRates = [] } = {}) {
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const rates = ratesAt(pool, pool.rows.map((source) => source.value), pairing);
  return pool.rows.map((source, sourceIndex) => ({ ...source, sourceIndex, rate: rates[sourceIndex] }));
}

// Exact integral of min(2,sqrt(X/20)) for linearly declining X. The expression
// uses duration and endpoint means rather than subtracting nearly equal powers.
function doseIntegral(start, end, duration) {
  if (!(start > 0) || !(duration > 0)) return 0;
  if (end >= 80) return 2 * duration;
  if (start > 80) {
    const capped = duration * ((start - 80) / (start - end));
    return 2 * capped + doseIntegral(80, end, duration - capped);
  }
  const a = Math.sqrt(start);
  const b = Math.sqrt(Math.max(0, end));
  return duration * (2 / (3 * Math.sqrt(20))) * (start + a * b + end) / (a + b);
}

// Dormand-Prince 5(4), jointly integrating Hi'=lambda_i and
// Wi'=exp(-sum Hi)*lambda_i. No nested quadrature or Hi-normalized paternity.
const RK_A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const RK_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const RK_B = [...RK_A[6], 0];
const RK_ERROR = [35 / 384 - 5179 / 57600, 0, 500 / 1113 - 7571 / 16695,
  125 / 192 - 393 / 640, -2187 / 6784 + 92097 / 339200, 11 / 84 - 187 / 2100, -1 / 40];

function integrateRisks(pool, duration, pairing) {
  const n = pool.rows.length;
  const fraction = Math.min(1, duration / pool.lifetime);
  // t=T*y*(2-y) smooths the square-root endpoint at common pool exhaustion.
  // Integrate x=y/yEnd in [0,1] so arbitrarily short windows retain precision.
  const endY = fraction / (1 + Math.sqrt(1 - fraction));
  const derivative = (x, state) => {
    const y = endY * x;
    const remaining = (1 - y) ** 2;
    const values = valuesAt(pool, y * (2 - y), remaining);
    const rates = ratesAt(pool, values, pairing);
    const jacobian = duration * (2 * (1 - y) / (2 - endY));
    const survival = Math.exp(-Math.max(0, sum(state.slice(0, n))));
    return [...rates.map((rate) => rate * jacobian), ...rates.map((rate) => survival * rate * jacobian)];
  };
  // Split at the dose-cap kink explicitly: an adaptive step can otherwise
  // straddle the kink with misleadingly small embedded error estimates.
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
  boundaries.push(1);
  let boundaryIndex = 0;
  let state = Array(2 * n).fill(0);
  let x = 0;
  let step = 0.1;
  const scale = Math.min(1, duration * sum(ratesAt(pool, pool.rows.map((source) => source.value), pairing)));
  const absoluteTolerance = Math.max(Number.MIN_VALUE, 1e-13 * scale / Math.max(1, n));
  for (let attempt = 0; x < 1; attempt++) {
    if (attempt >= 10000) throw new Error('Sperm pool risk integration did not converge');
    const distance = boundaries[boundaryIndex] - x;
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
      if (step === distance) x = boundaries[boundaryIndex++];
      else x += step;
    }
    if (step <= Number.EPSILON * 8 && error > 1) throw new Error('Sperm pool integration step underflow');
    step *= error === 0 ? 5 : Math.max(0.1, Math.min(5, 0.9 * error ** -0.2));
  }
  return { hazards: state.slice(0, n), wins: state.slice(n) };
}

/** Deterministic no-new-input projection for one risk window.
 * hazard=sum Hi, successChance=-expm1(-hazard).
 * Each Hi is an audit integral only. winChance is the competing-risk mass
 * Wi=integral exp(-H(t))*lambda_i(t) dt; winnerWeight=Wi/successChance.
 * For consecutive windows, combine Wi as Wi(first)+exp(-Hfirst)*Wi(second).
 */
export function integrateSpermPool(sources, elapsedDays, { volumeFactor = 1, sourceRates = [] } = {}) {
  const pool = prepare(sources, volumeFactor);
  const pairing = pairingRates(pool.rows, sourceRates);
  const duration = Math.min(days(elapsedDays), pool.lifetime);
  let hazards = pool.rows.map(() => 0);
  let wins = pool.rows.map(() => 0);
  if (duration > 0 && pool.rows.some((source, i) => source.value > 0 && pairing[i] > 0)) {
    if (pool.uniform) {
      const { effective: start, shares } = activeDose(pool, pool.rows.map((source) => source.value));
      const area = doseIntegral(start, start * Math.max(0, 1 - duration / pool.lifetime), duration);
      hazards = shares.map((share, i) => BASE_RATE * area * share * pairing[i]);
      const h = sum([...hazards]);
      const p = -Math.expm1(-h);
      wins = hazards.map((value) => h > 0 ? p * (value / h) : 0);
    } else {
      ({ hazards, wins } = integrateRisks(pool, duration, pairing));
    }
  }
  hazards = hazards.map((value) => Math.max(0, value));
  const hazard = sum([...hazards]);
  const successChance = -Math.expm1(-hazard);
  wins = wins.map((value) => Math.max(0, value));
  const winMass = sum([...wins]);
  // Correct quadrature roundoff to the exact survival identity sum Wi=P.
  // This rescales integrated Wi, not the generally different cumulative Hi.
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
