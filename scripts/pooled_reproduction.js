// Experimental opt-in state adapter. Legacy reproduction never calls this module implicitly.
import { advanceSpermPool, depositSpermPool, getSpermPoolRates, integrateSpermPool } from './sperm_pool.js';

const MINUTES_PER_DAY = 1440;
const clone = (value) => JSON.parse(JSON.stringify(value));
const amount = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, value)) : 0;
const quality = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(0.25, Math.min(4, value)) : 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const idKey = (source) => `${typeof source.id}:${String(source.id)}`;
const sourceOrder = (a, b) => compare(idKey(a), idKey(b));

function minute(value) {
  if (!Number.isSafeInteger(value)) throw new RangeError('Pooled time must be a safe integer minute.');
  return value;
}
function poolOf(base) {
  if (!isPooledConception(base)) throw new Error('Enable pooled-v1 before changing pooled state.');
  return base.spermPool;
}
function sameMinute(base, nowMinute) {
  const pool = poolOf(base);
  if (minute(nowMinute) !== pool.lastMinute) throw new RangeError('Advance pooled state to the event minute before changing it.');
  return pool;
}
function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
// Administrative identity/volume/time are not a donor's frozen biological semantics.
const BOOKKEEPING = new Set(['id', 'sourceId', 'sourceIndex', 'value', 'volume', 'minutesPassed', 'createdMinute',
  'depositedMinute', 'timestamp', 'legacy', 'pooledLegacy', 'rate', 'hazard', 'winChance', 'winnerWeight']);
function snapshotSignature(source) {
  return stableJSON(Object.fromEntries(Object.entries(source).filter(([key]) => !BOOKKEEPING.has(key))));
}
function randomUnit(seed, eggId, role) {
  const text = stableJSON([seed, eggId, role]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return ((hash >>> 0) + 0.5) / 4294967296;
}
function makeSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}
function cleanSource(source) {
  const result = clone(source);
  result.male = String(result.male ?? '');
  result.value = result.fertilityStatus === 'not-entered' ? 0 : amount(source.value);
  result.quality = quality(source.qualityAtDeposit ?? source.quality ?? source.q);
  result.qualityAtDeposit = result.quality;
  if (result.fertilityStatus === 'inactivated' || result.fertilityStatus === 'not-entered') result.blocked = true;
  return result;
}
function allocateSourceId(base, source, used) {
  const pool = base.spermPool;
  if ((typeof source.id === 'string' && source.id.length > 0) || Number.isSafeInteger(source.id)) {
    if (!used.has(idKey(source))) {
      used.add(idKey(source));
      source.sourceId = source.id;
      return;
    }
  }
  do {
    if (pool.sourceSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Pooled source sequence exhausted.');
    source.id = ++pool.sourceSequence;
  } while (used.has(idKey(source)));
  source.sourceId = source.id;
  used.add(idKey(source));
  base.nextSpermContactId = pool.sourceSequence;
}

export function isPooledConception(base) {
  return base?.spermPool?.model === 'pooled-v1';
}

/** Forward-only migration at the present epoch; no historical rolls or donor lookups. */
export function enablePooledConception(base, nowMinutes = 0, { seed } = {}) {
  minute(nowMinutes);
  if (isPooledConception(base)) return base.spermPool;
  const actualSeed = seed === undefined ? makeSeed() : seed;
  if (!['string', 'number'].includes(typeof actualSeed) || (typeof actualSeed === 'number' && !Number.isFinite(actualSeed))) {
    throw new TypeError('Pooled seed must be a finite number or string.');
  }
  const contacts = (Array.isArray(base.spermContacts) ? base.spermContacts : [])
    .filter((source) => source && typeof source === 'object' && !Array.isArray(source)).map(cleanSource);
  const residues = (Array.isArray(base.sperms) ? base.sperms : [])
    .filter((source) => source && typeof source === 'object' && !Array.isArray(source)).map(cleanSource);
  const numericIds = contacts.map((source) => source.id).filter((id) => Number.isSafeInteger(id) && id >= 0);
  base.spermPool = { model: 'pooled-v1', epochMinute: nowMinutes, lastMinute: nowMinutes, seed: actualSeed,
    sourceSequence: Math.max(0, Number.isSafeInteger(base.nextSpermContactId) ? base.nextSpermContactId : 0, ...numericIds),
    eggSequence: 0, eggs: [], migration: { legacyResidualSources: 0, blockedContactsPreserved: contacts.filter((source) => source.blocked).length } };
  // Contacts are authoritative. Only uncovered aggregate residue becomes a legacy snapshot.
  const covered = new Map();
  for (const source of contacts) covered.set(source.male, (covered.get(source.male) || 0) + source.value);
  const aggregate = new Map();
  for (const source of residues) {
    const previous = aggregate.get(source.male);
    if (previous) previous.value += source.value;
    else aggregate.set(source.male, { ...source });
  }
  for (const source of aggregate.values()) {
    const residual = Math.max(0, source.value - (covered.get(source.male) || 0));
    if (residual > 0) {
      contacts.push({ ...source, id: undefined, value: residual, minutesPassed: nowMinutes, pooledLegacy: true });
      base.spermPool.migration.legacyResidualSources += 1;
    }
  }
  contacts.sort((a, b) => compare(stableJSON(a), stableJSON(b)));
  const used = new Set();
  for (const source of contacts) allocateSourceId(base, source, used);
  base.nextSpermContactId = base.spermPool.sourceSequence;
  base.spermContacts = contacts.sort(sourceOrder);
  syncPooledEggs(base, nowMinutes);
  for (const egg of base.spermPool.eggs) egg.legacy = true;
  projectPooledSperms(base);
  return base.spermPool;
}

/** The caller schedules actual ovulation and daily egg loss, then reconciles the mirror. */
export function syncPooledEggs(base, nowMinute) {
  if (!isPooledConception(base)) return [];
  const pool = sameMinute(base, nowMinute);
  const target = Math.floor(amount(base.eggs));
  pool.eggs.sort((a, b) => compare(a.createdMinute, b.createdMinute) || compare(a.eggId, b.eggId));
  if (target < pool.eggs.length) pool.eggs.splice(0, pool.eggs.length - target);
  while (pool.eggs.length < target) {
    if (pool.eggSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Pooled egg sequence exhausted.');
    const eggId = ++pool.eggSequence;
    const threshold = -Math.log1p(-randomUnit(pool.seed, eggId, 'threshold'));
    pool.eggs.push({ eggId, createdMinute: nowMinute, threshold, remainingHazard: threshold });
  }
  base.eggs = pool.eggs.length;
  return pool.eggs;
}

/** View-only male aggregation; no aggregate quality ever flows back into contacts. */
export function projectPooledSperms(base) {
  if (!isPooledConception(base)) return base.sperms;
  const groups = new Map();
  for (const source of [...base.spermContacts].sort(sourceOrder)) {
    if (!(source.value > 0)) continue;
    const key = String(source.male ?? '');
    if (!groups.has(key)) groups.set(key, { first: source, value: 0, effective: 0, ids: [] });
    const group = groups.get(key);
    group.value += source.value;
    group.effective += source.value * Math.sqrt(source.quality);
    group.ids.push(source.id);
  }
  base.sperms = [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([male, group]) => {
    const result = { ...clone(group.first), male, value: group.value,
      quality: (group.effective / group.value) ** 2, sourceIds: group.ids, pooledView: true };
    delete result.id;
    delete result.sourceId;
    delete result.qualityAtDeposit;
    return result;
  });
  return base.sperms;
}

/** Deposit only at the settled minute: implicit advancement would discard events/guards. */
export function depositPooledSource(base, source, capacity, nowMinute) {
  sameMinute(base, nowMinute);
  const incoming = cleanSource(source);
  incoming.minutesPassed = nowMinute;
  // Incoming user IDs are never reused; identity allocation is independent of live length.
  delete incoming.id;
  delete incoming.sourceId;
  allocateSourceId(base, incoming, new Set(base.spermContacts.map(idKey)));
  const result = depositSpermPool([...base.spermContacts].sort(sourceOrder), incoming, capacity);
  // Zero-volume contacts still link pending fetuses to contraception and donor audits.
  base.spermContacts = result.sources.sort(sourceOrder);
  projectPooledSperms(base);
  return { spilled: result.spilled };
}

function chooseWeighted(entries, draw) {
  const positive = entries.filter((entry) => entry.weight > 0).sort((a, b) => compare(a.key, b.key));
  const total = positive.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) throw new Error('Crossed pooled hazard has no active winner.');
  let remainder = draw * total;
  for (const entry of positive) {
    remainder -= entry.weight;
    if (remainder < 0) return entry;
  }
  return positive.at(-1);
}
function chooseWinner(sources, rates, seed, eggId) {
  const males = new Map();
  for (let i = 0; i < sources.length; i += 1) {
    const weight = rates[i].rate;
    if (!(weight > 0)) continue;
    const source = sources[i];
    const key = String(source.male ?? '');
    if (!males.has(key)) males.set(key, { key, weight: 0, snapshots: new Map() });
    const male = males.get(key);
    male.weight += weight;
    const signature = snapshotSignature(source);
    if (!male.snapshots.has(signature)) male.snapshots.set(signature, { key: signature, weight: 0, sources: [] });
    const group = male.snapshots.get(signature);
    group.weight += weight;
    group.sources.push({ key: idKey(source), weight, source });
  }
  const male = chooseWeighted([...males.values()], randomUnit(seed, eggId, 'male'));
  const group = chooseWeighted([...male.snapshots.values()], randomUnit(seed, eggId, 'snapshot'));
  const winner = clone(chooseWeighted(group.sources, randomUnit(seed, eggId, 'source')).source);
  // Dose consumers need the physical semantic group, not the bookkeeping source split.
  // Include matching zero-rate members too; a pairing coefficient does not erase volume.
  const groupPhysicalAmount = sources.filter((source) => String(source.male ?? '') === male.key
    && snapshotSignature(source) === group.key).reduce((sum, source) => sum + source.value, 0);
  return { winner, groupPhysicalAmount };
}

/** Canonical absolute one-minute grid makes API slicing and JSON restart immaterial.
 * sourceRate is a deterministic, side-effect-free multiplier, frozen for each minute.
 * Returns events only; fetal creation and physiological phase scheduling belong to tools.
 */
export function advancePooledConception(base, toMinute, { volumeFactor = 1, sourceRate = () => 1, canFertilize = true } = {}) {
  minute(toMinute);
  if (!isPooledConception(base)) return [];
  const pool = poolOf(base);
  if (toMinute < pool.lastMinute) throw new RangeError('Pooled time must not move backwards.');
  if (!(typeof volumeFactor === 'number' && Number.isFinite(volumeFactor) && volumeFactor > 0)) throw new RangeError('Pooled volumeFactor must be positive and finite.');
  syncPooledEggs(base, pool.lastMinute);
  const events = [];
  while (pool.lastMinute < toMinute) {
    const start = [...base.spermContacts].sort(sourceOrder);
    const duration = 1 / MINUTES_PER_DAY;
    const active = canFertilize && pool.eggs.length > 0 && start.some((source) => source.value > 0);
    if (active) {
      const sourceRates = start.map((source) => amount(sourceRate(clone(source))));
      const options = { volumeFactor, sourceRates };
      const integral = integrateSpermPool(start, duration, options);
      const survivors = [];
      const minuteEvents = [];
      for (const egg of pool.eggs) {
        if (integral.hazard > 0 && egg.remainingHazard <= integral.hazard) {
          let lower = 0;
          let upper = duration;
          for (let step = 0; step < 38; step += 1) {
            const middle = (lower + upper) / 2;
            if (integrateSpermPool(start, middle, options).hazard >= egg.remainingHazard) upper = middle;
            else lower = middle;
          }
          const eventSources = advanceSpermPool(start, upper, { volumeFactor });
          const rates = getSpermPoolRates(eventSources, options);
          const { winner, groupPhysicalAmount } = chooseWinner(eventSources, rates, pool.seed, egg.eggId);
          minuteEvents.push({ eggId: egg.eggId, minute: pool.lastMinute + 1, winner, winnerSpermId: winner.id,
            winnerPhysicalAmount: groupPhysicalAmount,
            poolPhysicalAmount: eventSources.reduce((sum, source) => sum + source.value, 0),
            activePhysicalAmount: eventSources.reduce((sum, source) => sum + (source.blocked === true ? 0 : source.value), 0),
            hazard: egg.threshold, successChance: -Math.expm1(-egg.threshold), model: pool.model,
            eventOffsetDays: upper, minuteHazard: egg.remainingHazard,
            candidateContributions: rates.map((entry) => ({ spermId: entry.id, male: entry.male, rate: entry.rate })) });
        } else {
          egg.remainingHazard -= integral.hazard;
          survivors.push(egg);
        }
      }
      minuteEvents.sort((a, b) => compare(a.eventOffsetDays, b.eventOffsetDays) || compare(a.eggId, b.eggId));
      events.push(...minuteEvents);
      pool.eggs = survivors;
      base.spermContacts = integral.remainingSources.sort(sourceOrder);
    } else {
      base.spermContacts = advanceSpermPool(start, duration, { volumeFactor }).sort(sourceOrder);
    }
    pool.lastMinute += 1;
    base.eggs = pool.eggs.length;
  }
  projectPooledSperms(base);
  return events;
}
