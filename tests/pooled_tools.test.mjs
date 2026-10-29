import assert from 'node:assert/strict';
import test from 'node:test';
import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { normalizeSireRecord } from '../scripts/sires.js';

const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function fixture({ eggs = 1, threshold = .08, pooled = true } = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('母方');
  mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race: '人类', bodySize: 4, stage: '卵泡期', days: 3, eggs });
  mother.profile.cooldown.naturalOvulationUsed = true;
  chat.characters['母方'] = mother;
  chat.sires.A = normalizeSireRecord({ race: '人类', spermQuality: 1, bodySize: 4 });
  chat.sires.B = normalizeSireRecord({ race: '人类', spermQuality: 4, bodySize: 4 });
  if (pooled) {
    enablePooledConception(mother.profile.base, 0, { seed: 'native-tool-pool-fixture' });
    for (const egg of mother.profile.base.spermPool.eggs) egg.threshold = egg.remainingHazard = threshold;
  }
  return chat;
}
function deposit(chat, amount, male = 'A') {
  assert.equal(call(chat, 'bsAddSperm', { female: '母方', male, race: '人类', action: 'insert', amount: 0 }).applied, true);
  assert.equal(call(chat, 'bsAddSperm', { female: '母方', male, race: '人类', action: 'deposit', amount }).applied, true);
}
const baseOf = (chat) => chat.characters['母方'].profile.base;
const fetusOf = (chat) => chat.characters['母方'].profile.pregnant.fetuses[0];
const residual = (chat) => baseOf(chat).spermContacts.reduce((sum, source) => sum + source.value, 0);

// This suite exercises the actual public tool dispatcher, not only the pool helper.
test('pooled public tools: 24h / 24×1h / 1440×1min yield identical minute, father and frozen fetus', () => {
  const initial = fixture(); deposit(initial, 20);
  const outcomes = [];
  for (const [n, patch] of [[1, { hour: 24 }], [24, { hour: 1 }], [1440, { minute: 1 }]]) {
    const chat = JSON.parse(JSON.stringify(initial));
    const receipts = [];
    for (let i = 0; i < n; i++) {
      const result = call(chat, 'bsPassedTime', patch);
      assert.equal(result.applied, true); receipts.push(...result.conceptionEvents);
    }
    assert.equal(chat.minutesPassed, 1440); assert.equal(receipts.length, 1);
    assert.equal(receipts[0].minute, fetusOf(chat).pooledConception.minute);
    outcomes.push({ fetus: fetusOf(chat), receipts, residual: residual(chat) });
  }
  assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(outcomes[0], outcomes[2]);
  assert.ok(outcomes[0].receipts[0].minute < 1440);
});
test('pooled public tools: a real 20 deposit and two same-minute 10 deposits share probability/residue/event', () => {
  const a = fixture(), b = fixture(); deposit(a, 20); deposit(b, 10); deposit(b, 10);
  const preview = (chat) => calculateFertilizationPreview({ model: 'pooled-v1', eggRace: '人类',
    elapsedDays: 1, spermSources: baseOf(chat).spermContacts });
  near(preview(a).successChance, preview(b).successChance);
  const aa = call(a, 'bsPassedTime', { hour: 24 }), bb = call(b, 'bsPassedTime', { hour: 24 });
  near(residual(a), residual(b));
  assert.equal(aa.conceptionEvents[0].minute, bb.conceptionEvents[0].minute);
  assert.equal(fetusOf(a).fathers, fetusOf(b).fathers);
  assert.equal(baseOf(a).spermContacts.length, 1); assert.equal(baseOf(b).spermContacts.length, 2);
});
test('pooled tool deposit freezes each quality despite same-name later registration changes', () => {
  const chat = fixture({ eggs: 0 }); deposit(chat, 20, 'A');
  chat.sires.A.spermQuality = 4; deposit(chat, 20, 'A');
  assert.deepEqual(baseOf(chat).spermContacts.map((x) => x.quality), [1, 4]);
  assert.equal(call(chat, 'bsPassedTime', { hour: 1 }).applied, true);
  assert.deepEqual(baseOf(chat).spermContacts.map((x) => x.quality), [1, 4]);
});
test('pooled actual tool + JSON restart preserve thresholds, event minute and father', () => {
  const chat = fixture(); deposit(chat, 20, 'A'); deposit(chat, 20, 'B');
  const uninterrupted = JSON.parse(JSON.stringify(chat));
  call(uninterrupted, 'bsPassedTime', { hour: 24 });
  call(chat, 'bsPassedTime', { minute: 60 });
  const reloaded = JSON.parse(JSON.stringify(chat)); call(reloaded, 'bsPassedTime', { minute: 1380 });
  assert.deepEqual(fetusOf(reloaded), fetusOf(uninterrupted));
  assert.deepEqual(baseOf(reloaded).spermPool.eggs, baseOf(uninterrupted).spermPool.eggs);
});
test('pooled actual tool has physical clearance without eggs and in postpartum state', () => {
  const chat = fixture({ eggs: 0 }); deposit(chat, 20);
  Object.assign(baseOf(chat), { stage: '产后恢复', days: 1 });
  const result = call(chat, 'bsPassedTime', { hour: 24 });
  assert.equal(result.applied, true); assert.deepEqual(result.conceptionEvents, []); near(residual(chat), 10);
});
test('pooled complete source exhaustion retains causal source for pending embryo and emergency operation', () => {
  const chat = fixture(); deposit(chat, 20);
  call(chat, 'bsPassedTime', { day: 2 });
  const fetus = fetusOf(chat); assert.ok(fetus); near(residual(chat), 0);
  assert.ok(baseOf(chat).spermContacts.some((source) => fetus.contactIds.includes(source.id)));
  chat.reproductiveSettings = { emergencyEffectiveness: 1 };
  const saved = Math.random; Math.random = () => 0;
  try {
    const result = call(chat, 'bsAbortion', { female: '母方', purpose: 'emergency' });
    assert.equal(result.applied, true); assert.equal(chat.characters['母方'].profile.pregnant.fetuses.length, 0);
  } finally { Math.random = saved; }
});
test('pooled drain uses per-contact quality and preserves mass, unlike legacy floor rounding', () => {
  const chat = fixture({ eggs: 0 }); deposit(chat, 20, 'A'); deposit(chat, 20, 'B');
  const before = residual(chat);
  const result = call(chat, 'bsDrainSperm', { female: '母方', amount: 10 });
  assert.equal(result.applied, true); assert.match(result.message, /实际排出/);
  const contacts = baseOf(chat).spermContacts;
  assert.ok(contacts[0].value < contacts[1].value, 'lower quality is removed more readily');
  near(result.drainResult.before, before);
  near(result.drainResult.remaining, residual(chat));
  near(result.drainResult.removed + result.drainResult.remaining, before);
  assert.equal(result.drainResult.sources.length, 2);
  assert.ok(residual(chat) < before);
});
test('pooled real full-capacity deposit splitting is invariant across serialized tool calls', () => {
  const original = fixture({ eggs: 0 }); deposit(original, 100, 'A');
  const one = JSON.parse(JSON.stringify(original)); deposit(one, 20, 'B');
  let two = JSON.parse(JSON.stringify(original)); deposit(two, 10, 'B');
  two = JSON.parse(JSON.stringify(two)); deposit(two, 10, 'B');
  const grouped = (chat, male) => baseOf(chat).spermContacts.filter((x) => x.male === male).reduce((sum, x) => sum + x.value, 0);
  near(grouped(one, 'A'), grouped(two, 'A')); near(grouped(one, 'B'), grouped(two, 'B'));
});
test('pooled prolific species keep companion eggs invariant when one donor dose is split', () => {
  const make = () => {
    const chat = fixture({ threshold: 1e-5 });
    Object.assign(baseOf(chat), { race: '群居虫人', bloodline: { '群居虫人': 1 }, bloodlineSource: 'pure' });
    return chat;
  };
  const one = make(), two = make(); deposit(one, 20); deposit(two, 10); deposit(two, 10);
  call(one, 'bsPassedTime', { minute: 1 }); call(two, 'bsPassedTime', { minute: 1 });
  assert.ok(fetusOf(one).companionEggCount > 0);
  assert.equal(fetusOf(one).companionEggCount, fetusOf(two).companionEggCount);
  assert.equal(fetusOf(one).pooledConception.minute, fetusOf(two).pooledConception.minute);
  assert.equal(fetusOf(one).fathers, fetusOf(two).fathers);
});
test('pooled superfetation preserves the existing nested-host gates and hidden-event visual rule', () => {
  const chat = fixture({ pooled: false });
  Object.assign(baseOf(chat), { stage: '孕早期', days: 0,
    sperms: [{ male: 'A', race: '人类', value: 150, quality: 1, bodySize: 4 }] });
  const pregnant = chat.characters['母方'].profile.pregnant;
  Object.assign(pregnant, { pregnantDays: 60, effectivePregnantDays: 60,
    fetuses: [{ embryoId: 1, fathers: 'A', race: '人类', gender: '女', embryoType: '胎生', weight: 1.6,
      affinity: 0, tendencyAngle: 0, amnionDurability: 100, tags: [] }] });
  enablePooledConception(baseOf(chat), 0, { seed: 'nested-fixture' });
  for (const egg of baseOf(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
  const result = call(chat, 'bsPassedTime', { minute: 1 });
  assert.equal(result.conceptionEvents.length, 1);
  const nested = chat.characters['母方'].profile.pregnant.fetuses.find((fetus) => fetus.pooledConception);
  assert.ok(nested.tags.includes('superfetation')); assert.ok(nested.tags.includes('nested'));
  assert.equal(nested.nestedInEmbryoId, 1);
  assert.notEqual(chat.characters['母方'].profile.visualCue?.type, 'fertilization');
});
test('experimental time limit rejects atomically; legacy mode does not acquire pooled state', () => {
  const pooled = fixture(), before = JSON.stringify(pooled);
  assert.equal(call(pooled, 'bsPassedTime', { day: 32 }).applied, false);
  assert.equal(JSON.stringify(pooled), before);
  const legacy = fixture({ eggs: 0, pooled: false }); deposit(legacy, 20);
  const result = call(legacy, 'bsPassedTime', { hour: 1 });
  assert.equal(result.applied, true); assert.equal('conceptionEvents' in result, false);
  assert.equal('spermPool' in baseOf(legacy), false);
});
