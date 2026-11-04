// 实验性显式启用适配器；旧生殖模型始终保持原入口。
import { advanceSpermPool, depositSpermPool, getSpermPoolRates,
  integrateSpermPoolRisk, findSpermPoolCrossing } from './sperm_pool.js';

const MINUTES_PER_DAY = 1440;
const clone = (value) => JSON.parse(JSON.stringify(value));
const amount = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, value)) : 0;
const quality = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(0.25, Math.min(4, value)) : 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const idKey = (source) => `${typeof source.id}:${String(source.id)}`;
const sourceOrder = (a, b) => compare(idKey(a), idKey(b));

function minute(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError('Pooled time must be a finite nonnegative minute.');
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
// 身份编号、体积、时间和视图字段不属于精方冻结的生物学快照。
const BOOKKEEPING = new Set(['id', 'sourceId', 'sourceIndex', 'sourceIds', 'pooledView', 'value', 'volume', 'minutesPassed', 'createdMinute',
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

/** 仅从当前时间向前迁移；不补掷历史事件，也不回查精方现状。 */
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
  // 接触量是权威；只补未覆盖的旧余量，不按空汇总缩减接触量。
  const covered = new Map();
  const knownSnapshots = new Map();
  for (const source of contacts) {
    covered.set(source.male, (covered.get(source.male) || 0) + source.value);
    const key = stableJSON([source.male, snapshotSignature(source)]);
    knownSnapshots.set(key, (knownSnapshots.get(key) || 0) + source.value);
  }
  const aggregate = new Map();
  for (const source of residues.sort((a, b) => compare(stableJSON(a), stableJSON(b)))) {
    if (!aggregate.has(source.male)) aggregate.set(source.male, []);
    aggregate.get(source.male).push(source);
  }
  for (const [male, rows] of aggregate) {
    const residual = Math.max(0, rows.reduce((sum, source) => sum + source.value, 0) - (covered.get(male) || 0));
    if (!(residual > 0)) continue;
    // 同父多行先扣相同快照的已知量，再按剩余比例对账，保留每行遗传和品质。
    const remaining = rows.map((source) => {
      const key = stableJSON([male, snapshotSignature(source)]);
      const matched = Math.min(source.value, knownSnapshots.get(key) || 0);
      knownSnapshots.set(key, (knownSnapshots.get(key) || 0) - matched);
      return { ...source, value: source.value - matched };
    });
    const total = remaining.reduce((sum, source) => sum + source.value, 0);
    for (const source of remaining) {
      if (!(source.value > 0)) continue;
      // 迁移时间只记在池的 epoch；旧行缺失接触时间时保持未知。
      contacts.push({ ...source, id: undefined, value: source.value * residual / total, pooledLegacy: true });
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

/** 宿主调度真实排卵和每日卵损失后，在此同步镜像。 */
export function syncPooledEggs(base, nowMinute) {
  if (!isPooledConception(base)) return [];
  const pool = sameMinute(base, nowMinute);
  const target = Math.floor(amount(base.eggs));
  if (target !== pool.eggs.length) invalidatePooledSegment(base);
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

/** 仅生成父方汇总视图；汇总品质始终不回写独立接触记录。 */
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

/** 只在已结算时刻注入，避免隐式推进丢失事件或守卫。 */
export function depositPooledSource(base, source, capacity, nowMinute) {
  sameMinute(base, nowMinute);
  const incoming = cleanSource(source);
  incoming.minutesPassed = nowMinute;
  // 新注入记录重新分配身份，编号不依赖当前非零记录数。
  delete incoming.id;
  delete incoming.sourceId;
  allocateSourceId(base, incoming, new Set(base.spermContacts.map(idKey)));
  const result = depositSpermPool([...base.spermContacts].sort(sourceOrder), incoming, capacity);
  // 零体积接触仍保留待定胎儿、事后避孕和精方审计的关联。
  base.spermContacts = result.sources.sort(sourceOrder);
  invalidatePooledSegment(base);
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
  // 剂量消费者读取同语义快照的物理总量，而非登记上的单行拆分量。
  // 同快照的零配对率成员也计入；配对系数不会消除物理体积。
  const groupPhysicalAmount = sources.filter((source) => String(source.male ?? '') === male.key
    && snapshotSignature(source) === group.key).reduce((sum, source) => sum + source.value, 0);
  return { winner, groupPhysicalAmount };
}

// 检查点仅用于发现外部变更；物理状态和预算始终由持久锚点推导。
function stateSignature(base) {
  return stableJSON({ sources: [...base.spermContacts].sort(sourceOrder), eggs: base.spermPool.eggs });
}

/** 外部真实事件可主动清除锚点；当前卵预算和物理状态原样保留。 */
export function invalidatePooledSegment(base) {
  if (isPooledConception(base)) delete base.spermPool.segment;
}

function createSegment(base, volumeFactor, sourceRates, canFertilize, timeScale) {
  const pool = base.spermPool;
  const sources = clone([...base.spermContacts].sort(sourceOrder));
  const options = { volumeFactor, sourceRates, timeScale };
  const active = canFertilize && getSpermPoolRates(sources, options).some((source) => source.rate > 0);
  const eggs = pool.eggs.map((egg) => ({ ...clone(egg), crossingDays: active
    ? findSpermPoolCrossing(sources, egg.remainingHazard, options) : null }));
  return { anchorMinute: pool.lastMinute, sources, volumeFactor, sourceRates, canFertilize,
    timeScale, eggs, stateSignature: stateSignature(base) };
}

// 首穿反解的末位误差不应把精确整数边界展示为下一分钟。
function displayMinute(atMinute) {
  const nearest = Math.round(atMinute);
  return Math.abs(atMinute - nearest) <= 16 * Number.EPSILON * Math.max(1, atMinute)
    ? nearest : Math.ceil(atMinute);
}

// 精确耗尽端点的瞬时率全为零；父方使用趋近该端点的权重极限。
function endpointWinnerRates(segment, rates) {
  if (rates.some((source) => source.rate > 0)) return rates;
  const eligible = segment.sources.map((source, i) => source.value > 0 && source.blocked !== true
    && segment.sourceRates[i] > 0);
  const highest = Math.max(0, ...segment.sources.map((source, i) => eligible[i] ? source.quality : 0));
  return rates.map((source, i) => ({ ...source, rate: eligible[i] && segment.sources[i].quality === highest
    ? segment.sources[i].value * segment.sourceRates[i] : 0 }));
}

/** 参数固定段直接推进；宿主在真实阶段、条件、注入和排出事件处分段调用。
 * sourceRate 提供每源固定系数；系数、源快照、卵和守卫变更自动重建锚点。
 * 同段所有物理状态、风险和首穿均从持久锚点求解，调用切片与 JSON 恢复不改变事件。
 * 这里只返回事件；胎儿创建和生理阶段调度仍归宿主。
 */
export function advancePooledConception(base, toMinute, { volumeFactor = 1, sourceRate = () => 1, canFertilize = true,
  timeScale = { initial: 1, slopePerDay: 0 }, stopAtFirstEvent = false } = {}) {
  minute(toMinute);
  if (!isPooledConception(base)) return [];
  const pool = poolOf(base);
  if (toMinute < pool.lastMinute) throw new RangeError('Pooled time must not move backwards.');
  if (!(typeof volumeFactor === 'number' && Number.isFinite(volumeFactor) && volumeFactor > 0)) throw new RangeError('Pooled volumeFactor must be positive and finite.');
  const scale = { initial: timeScale.initial ?? 1, slopePerDay: timeScale.slopePerDay ?? 0 };
  if (!Number.isFinite(scale.initial) || !Number.isFinite(scale.slopePerDay)) throw new RangeError('Pooled timeScale must be finite.');
  syncPooledEggs(base, pool.lastMinute);
  if (toMinute === pool.lastMinute) return [];
  const sourceRates = [...base.spermContacts].sort(sourceOrder).map((source) => amount(sourceRate(clone(source))));
  const enabled = Boolean(canFertilize);
  let segment = pool.segment;
  // 宿主传当前时刻的线性系数；同轨迹继续保留原截距，舍入差异不触发重建。
  const predictedScale = segment?.timeScale && segment.timeScale.initial
    + segment.timeScale.slopePerDay * ((pool.lastMinute - segment.anchorMinute) / MINUTES_PER_DAY);
  const sameScale = segment?.timeScale?.slopePerDay === scale.slopePerDay
    && Math.abs(predictedScale - scale.initial) <= 64 * Number.EPSILON * Math.max(1, Math.abs(predictedScale), Math.abs(scale.initial));
  if (!segment || segment.volumeFactor !== volumeFactor || segment.canFertilize !== enabled || !sameScale
    || stableJSON(segment.sourceRates) !== stableJSON(sourceRates) || segment.stateSignature !== stateSignature(base)) {
    segment = pool.segment = createSegment(base, volumeFactor, sourceRates, enabled, scale);
  }
  const anchorEggs = new Map(segment.eggs.map((egg) => [egg.eggId, egg]));
  let settledMinute = toMinute;
  if (stopAtFirstEvent) {
    for (const egg of pool.eggs) {
      const crossing = anchorEggs.get(egg.eggId).crossingDays;
      if (crossing !== null) settledMinute = Math.min(settledMinute, segment.anchorMinute + crossing * MINUTES_PER_DAY);
    }
  }
  const duration = (settledMinute - segment.anchorMinute) / MINUTES_PER_DAY;
  const options = { volumeFactor: segment.volumeFactor, sourceRates: segment.sourceRates, timeScale: segment.timeScale };
  const integral = enabled && pool.eggs.length > 0
    ? integrateSpermPoolRisk(segment.sources, duration, options) : null;
  const events = [];
  const survivors = [];
  for (const egg of pool.eggs) {
    const anchored = anchorEggs.get(egg.eggId);
    const atMinute = anchored.crossingDays === null ? null
      : segment.anchorMinute + anchored.crossingDays * MINUTES_PER_DAY;
    if (atMinute !== null && atMinute <= settledMinute) {
      const eventSources = advanceSpermPool(segment.sources, anchored.crossingDays, options);
      const rates = getSpermPoolRates(eventSources, options);
      const { winner, groupPhysicalAmount } = chooseWinner(eventSources, endpointWinnerRates(segment, rates), pool.seed, egg.eggId);
      const scaleAtEvent = Math.max(0, segment.timeScale.initial + segment.timeScale.slopePerDay * anchored.crossingDays);
      events.push({ eggId: egg.eggId, atMinute, minute: displayMinute(atMinute), winner, winnerSpermId: winner.id,
        winnerPhysicalAmount: groupPhysicalAmount,
        poolPhysicalAmount: eventSources.reduce((sum, source) => sum + source.value, 0),
        activePhysicalAmount: eventSources.reduce((sum, source) => sum + (source.blocked === true ? 0 : source.value), 0),
        hazard: anchored.threshold, successChance: -Math.expm1(-anchored.threshold), model: pool.model,
        eventOffsetDays: anchored.crossingDays, minuteHazard: anchored.remainingHazard,
        candidateContributions: rates.map((entry) => ({ spermId: entry.id, male: entry.male, rate: entry.rate * scaleAtEvent })) });
    } else {
      egg.remainingHazard = Math.max(0, anchored.remainingHazard - (integral?.hazard ?? 0));
      survivors.push(egg);
    }
  }
  events.sort((a, b) => compare(a.atMinute, b.atMinute) || compare(a.eggId, b.eggId));
  pool.eggs = survivors;
  base.eggs = survivors.length;
  // 受精不消耗池体积，也不重建锚点；事件之后继续沿同一物理轨迹推进。
  base.spermContacts = (integral?.remainingSources
    ?? advanceSpermPool(segment.sources, duration, options)).sort(sourceOrder);
  pool.lastMinute = settledMinute;
  segment.stateSignature = stateSignature(base);
  projectPooledSperms(base);
  return events;
}
