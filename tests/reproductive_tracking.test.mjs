import assert from 'node:assert/strict';
import test from 'node:test';
import * as state from '../scripts/state.js';
import { applyToolCall, ensureNaturalNoticeSample, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { applyRegistryResult, applyBreedingInferenceResult, inferPendingPsychology, runRegistryBreedingInference, runRegistry, buildRegistrySystemPrompt, buildBreedingInferenceSystemPrompt } from '../scripts/registry.js';
import { migrateCharacters } from '../scripts/state_migration.js';
import { buildTrackerPayload, buildMainFlowPrompt } from '../scripts/tracker.js';
import { normalizeReproductiveSettings, naturalNoticeDays, experienceFactor, experienceSnapshot, normalizeExperience } from '../scripts/reproductive.js';

function setup(stage = '卵泡期') {
  const s = state.createEmptyChatState();
  s.characters.A = state.createDefaultFemaleState('A');
  s.characters.A.initialized = true;
  s.characters.A.profile.base.stage = stage;
  s.characters.A.profile.base.days = 0;
  s.characters.A.profile.base.psyStress = 0;
  s.characters.A.profile.base.libido = 0;
  return s;
}
const call = (s, name, args, sourceId) => applyToolCall(s, { name, arguments: args, sourceId });
const record = (s, patch = {}, source) => call(s, 'bsRecordExperience', { female: 'A', action: 'cognition', time: '王历三年', method: 'guess', content: '我猜怀了五胎，父方是未知的丙。', ...patch }, source);
const deposit = (s, hasCondom, amount = 20, source) => {
  call(s, 'bsAddSperm', { female: 'A', male: 'B', race: '人类', action: 'insert', amount: 0, hasCondom });
  return call(s, 'bsAddSperm', { female: 'A', male: 'B', race: '人类', action: 'deposit', amount }, source);
};

test('six actions require female; branch errors are atomic; guesses do not create physiology', () => {
  const s = setup('假孕期');
  const before = JSON.stringify(s.characters.A.profile);
  for (const patch of [{ female: undefined }, { female: '' }, { female: 'unknown' }, { partner: 'B' }, { method: 'bogus' }, { content: '' }]) assert.equal(record(s, patch).applied, false);
  assert.equal(JSON.stringify(s.characters.A.profile), before);
  assert.equal(record(s).applied, true);
  assert.equal(s.characters.A.profile.pregnant.fetuses.length, 0);
  assert.equal(s.characters.A.profile.cognitionRecords[0].storyDayIndex, 0);
  s.minutesPassed = 3000;
  assert.equal(record(s, { content: '现在相信没怀孕。' }).applied, true);
  assert.equal(s.characters.A.profile.cognitionRecords[1].storyDayIndex, 2);
});

test('source retries are idempotent; a new source can add a same-day change of mind', () => {
  const s = setup();
  record(s, {}, 'floor:1:0');
  assert.equal(record(s, {}, 'floor:1:0').applied, false);
  record(s, { content: '改口：相信自己没孕。' }, 'floor:1:1');
  assert.equal(s.characters.A.profile.cognitionRecords.length, 2);
});

test('relationships are independent lists and cannot overwrite backend counts', () => {
  const s = setup();
  for (const [action, partner] of [['date', 'B'], ['date', 'C'], ['marry', 'B'], ['marry', 'C'], ['breakup', 'B'], ['divorce', 'B']]) {
    assert.equal(call(s, 'bsRecordExperience', { female: 'A', action, time: '第六日', partner }).applied, true);
  }
  assert.deepEqual(s.characters.A.profile.experience.emotionalMates, ['C']);
  assert.deepEqual(s.characters.A.profile.experience.marriageMates, ['C']);
  assert.equal(record(s, { pregnantExperience: 100 }).applied, false);
  assert.equal(TOOL_DEFINITIONS.some((x) => ['bsNameChild', 'bsUpdateExperience'].includes(x.name)), false);
});

test('child identity differs from genetic fathers; omitted and null fields stay distinct', () => {
  const s = setup('产后恢复');
  s.characters.A.profile.children = [{ name: '原名', fathers: 'B', race: '人类' }];
  const args = { female: 'A', action: 'child', time: '今日', childIndex: 0 };
  call(s, 'bsRecordExperience', { ...args, selectedFather: '未注册的丙' });
  call(s, 'bsRecordExperience', { ...args, name: '新名' });
  assert.equal(s.characters.A.profile.children[0].selectedFather, '未注册的丙');
  call(s, 'bsRecordExperience', { ...args, selectedFather: null });
  assert.equal(s.characters.A.profile.children[0].fathers, 'B');
  assert.equal(s.characters.A.profile.children[0].selectedFather, null);
  assert.equal(call(s, 'bsRecordExperience', { ...args, childIndex: '0', name: '坏' }).applied, false);
});

test('actual menstrual entry clears once; new menstrual records survive later ticks', () => {
  const s = setup();
  record(s);
  call(s, 'bsSetMenstrualPhases', { female: 'A', stage: '月经期' });
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
  record(s, { method: 'perception', content: '认为出血是月经。' });
  call(s, 'bsPassedTime', { minute: 1 });
  assert.equal(s.characters.A.profile.cognitionRecords.length, 1);
});

test('large advances crossing menstrual boundaries still clear records', () => {
  const s = setup('卵泡期');
  record(s);
  call(s, 'bsPassedTime', { day: 70 });
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
});

test('pseudo interception retains records; forced exit always refreshes', () => {
  const s = setup('黄体期');
  record(s);
  s.characters.A.profile.base.psyStress = 150;
  s.characters.A.profile.base.libido = 90;
  s.characters.A.profile.experience.latestSexPartner = 'B';
  s.characters.A.profile.base.latestSexDays = 0;
  call(s, 'bsPassedTime', { day: 15 });
  assert.equal(s.characters.A.profile.base.stage, '假孕期');
  assert.equal(s.characters.A.profile.cognitionRecords.length, 1);
  call(s, 'bsSetMenstrualPhases', { female: 'A', stage: '卵泡期' });
  assert.equal(s.characters.A.profile.base.stage, '月经期');
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
});

test('recovery cannot conceive; zero-day and manual exits pass through menstruation', () => {
  const s = setup('产后恢复');
  record(s);
  deposit(s, false);
  s.characters.A.profile.base.eggs = 10;
  s.characters.A.profile.bio.recoveryDays = 0;
  call(s, 'bsPassedTime', { minute: 1 });
  assert.equal(s.characters.A.profile.base.stage, '月经期');
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
  assert.equal(s.characters.A.profile.pregnant.fetuses.length, 0);
});

test('condom boundaries preserve old residue and source retries never reroll or redeposit', () => {
  const s = setup();
  deposit(s, false, 10);
  s.reproductiveSettings = { condomCapacity: 20, condomReliability: 1 };
  const result = deposit(s, true, 20, 'protected-deposit');
  assert.equal(result.applied, true);
  assert.equal(s.characters.A.profile.lastCondomResult.enteredAmount, 0);
  assert.equal(s.characters.A.profile.base.sperms[0].value, 10);
  assert.equal(call(s, 'bsAddSperm', { female: 'A', male: 'B', race: '人类', action: 'deposit', amount: 20 }, 'protected-deposit').applied, false);
  deposit(s, true, 21);
  assert.equal(s.characters.A.profile.base.sperms[0].value, 31);
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
});

test('emergency contraception blocks past contacts without removing residue or protecting new contacts', () => {
  const s = setup();
  s.reproductiveSettings = { emergencyEffectiveness: 1 };
  deposit(s, false);
  assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }, 'pill:1').applied, true);
  assert.equal(s.characters.A.profile.base.spermContacts[0].blocked, true);
  assert.equal(s.characters.A.profile.base.sperms[0].value, 20);
  assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }, 'pill:1').applied, false);
  deposit(s, false);
  assert.equal(s.characters.A.profile.base.spermContacts[1].blocked, false);
  assert.equal(s.characters.A.profile.experience.abortionExperience, 0);
});

test('emergency expiry fails; legacy missing contact timestamps and implanted pregnancies reject', () => {
  const s = setup();
  s.reproductiveSettings = { emergencyEffectiveness: 1 };
  deposit(s, false);
  s.minutesPassed = 6 * 1440;
  call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' });
  assert.equal(s.characters.A.profile.base.spermContacts[0].blocked, false);
  delete s.characters.A.profile.base.spermContacts;
  assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }).applied, false);
  s.characters.A.profile.base.stage = '孕早期';
  assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }).applied, false);
});

test('migration counts old losses as miscarriages, preserves evidence and neutralizes preg once', () => {
  const s = setup('孕早期');
  s.characters.A.profile.experience = { pregnantExperience: 5, miscarriageExperience: 3, emotionalMate: 'B', marriageMate: 'C' };
  s.characters.A.profile.psychology = { preg: { cognition_value: 80, bonding_value: 90, stance_value: 10, knowsFatherSource: true }, stageProfiles: { preg: { cognition: { 0: '旧文' } } } };
  migrateCharacters(s.characters, 3);
  state.normalizeCharacterPsychologyState(s.characters.A);
  const p = s.characters.A.profile;
  assert.equal(p.experience.unclassifiedLossExperience, undefined);
  assert.equal(p.experience.miscarriageExperience, 3);
  assert.deepEqual(p.experience.emotionalMates, ['B']);
  assert.equal(p.psychology.preg.confidence_value, 50);
  assert.equal(p.psychology.preg.bonding_value, 50);
  assert.equal(p.reproductiveMigration.original.psychology.preg.knowsFatherSource, true);
  assert.equal(p.cognitionRecords.length, 0);
  p.psychology.preg.confidence_value = 70;
  migrateCharacters(s.characters, 4);
  assert.equal(p.psychology.preg.confidence_value, 70);
});

test('registration seeds arbitrary story dates independently of diary and menstruation', () => {
  const s = setup('月经期');
  const initial = [{ time: '王历元年', method: 'guess', content: '误认腹部变大是发胖。' }];
  applyRegistryResult(s, { name: 'A', profile: { base: { stage: '月经期' } } }, { allowBreedingPsychology: false, initialCognitionRecords: initial });
  assert.equal(s.characters.A.profile.cognitionRecords[0].source, 'registration');
  assert.equal(s.characters.A.profile.cognitionRecords[0].minutesPassed, 0);
  assert.throws(() => applyRegistryResult(s, { name: 'A', profile: {} }, { initialCognitionRecords: [{ time: '', method: 'guess', content: 'a' }] }));
});

test('profile snapshots restore cognition, relationship, result and replay state together', () => {
  const s = setup();
  record(s, {}, 'floor1');
  const ctx = { chatId: 'reproductive', chat: [{ mes: '第1楼', name: 'A', is_user: false }] };
  state.recordChatStateSnapshot(ctx, s, { messageCount: 1 });
  call(s, 'bsSetMenstrualPhases', { female: 'A', stage: '月经期' });
  const past = state.getSnapshotCharacter(s, 0, 'A');
  assert.equal(past.profile.cognitionRecords.length, 1);
  assert.equal(past.profile.reproductiveOperations[0].source, 'floor1');
});

test('only present characters inject cognition, independently of psychology and diary', () => {
  const ctx = { chatId: 'reproductive-prompt', chat: [], characters: [], name1: '用户', name2: 'A' };
  const settings = state.getSettings(ctx);
  settings.diaryRecentLimit = 0;
  const s = state.getChatState(ctx, settings);
  s.characters = setup().characters;
  record(s);
  assert.match(buildMainFlowPrompt(ctx, settings), /我猜怀了五胎/);
  s.characters.A.profile.base.isHere = false;
  assert.doesNotMatch(JSON.stringify(buildTrackerPayload(ctx, settings).existing_state), /我猜怀了五胎/);
  assert.equal(s.characters.A.profile.cognitionRecords.length, 1);
});

test('unknown psychology never accumulates delta; crossing sides schedules once', () => {
  const s = setup();
  s.characters.A.profile.psychology = { enabled: true, activeSide: 'mens', stageProfiles: { mens: {} }, mens: { mastery_value: null } };
  assert.equal(call(s, 'bsUpdatePsychology', { female: 'A', options: { mens: { mastery: 2 } } }).applied, false);
  call(s, 'bsSetMenstrualPhases', { female: 'A', stage: '假孕期' });
  const psy = s.characters.A.profile.psychology;
  assert.equal(psy.pendingSide, 'preg');
  const generation = psy.generation;
  call(s, 'bsPassedTime', { minute: 1 });
  assert.equal(s.characters.A.profile.psychology.generation, generation);
  assert.match(buildBreedingInferenceSystemPrompt({}, { targetName: 'A', psychologySide: 'preg' }), /只输出 preg/);
});

test('natural cue sample is independent, persistent and never writes beliefs', () => {
  const s = setup('孕早期');
  const p = s.characters.A.profile;
  p.pregnant.fetuses = [{ embryoId: 1 }];
  p.pregnant.effectivePregnantDays = 70;
  p.experience.pregnantExperience = 1;
  const sample = ensureNaturalNoticeSample(p);
  assert.equal(sample.experience.H, 0);
  assert.equal(ensureNaturalNoticeSample(p), sample);
  p.base.vitalityLevel = 1;
  assert.equal(ensureNaturalNoticeSample(p).vitalityLevel, sample.vitalityLevel);
  assert.ok(naturalNoticeDays(sample, 10) >= sample.config.noticeMinDays);
  assert.equal(p.cognitionRecords.length, 0);
  assert.equal(experienceFactor(experienceSnapshot({ pregnantExperience: 1, miscarriageExperience: 3 }), normalizeReproductiveSettings({ noticeExperienceM: 1 }), 'notice'), 1);
});

test('late natural cue can wait until the 280-day conception-age postterm boundary without creating beliefs', () => {
  const config = normalizeReproductiveSettings();
  const sample = { config, z: 10, vitalityLevel: 4, psyStressLevel: 4,
    experience: experienceSnapshot({}), obstetricOffsetDays: 14 };
  assert.equal(naturalNoticeDays(sample, 1), 280);
  const ctx = { chatId: 'late-natural-cue', chat: [], characters: [], name1: '用户', name2: 'A' };
  const settings = state.getSettings(ctx);
  const s = state.getChatState(ctx, settings);
  s.characters = setup('临产期').characters;
  const p = s.characters.A.profile;
  p.pregnant.fetuses = [{ embryoId: 1 }];
  p.pregnant.noticeSample = sample;
  p.pregnant.effectivePregnantDays = 293;
  assert.doesNotMatch(JSON.stringify(buildTrackerPayload(ctx, settings).existing_state), /naturalPregnancyCue/);
  p.base.stage = '逾期';
  p.pregnant.effectivePregnantDays = 294;
  assert.match(JSON.stringify(buildTrackerPayload(ctx, settings).existing_state), /naturalPregnancyCue/);
  assert.deepEqual(p.cognitionRecords, []);
  assert.equal(p.pregnant.noticeSample, sample);
});

function stageProfiles(side) {
  return { [side]: Object.fromEntries((side === 'mens' ? ['mastery', 'desire', 'autonomy'] : ['confidence', 'bonding', 'stance']).map((axis) => [axis,
    Object.fromEntries(['0', '1_25', '26_50', '51_75', '76_100', '100_plus'].map((stage) => [stage, `此角色在 ${axis} ${stage} 的专属表现`]))])) };
}

test('termination and miscarriage count separately; preimplantation attempts count neither', () => {
  for (const purpose of ['termination', 'miscarriage']) {
    const s = setup('孕早期');
    s.characters.A.profile.pregnant.fetuses = [{ embryoId: 1, fathers: 'B', race: '人类' }];
    s.characters.A.profile.pregnant.effectivePregnantDays = 35;
    s.characters.A.profile.pregnant.pregnantDays = 35;
    assert.equal(call(s, 'bsAbortion', { female: 'A', purpose }).applied, true);
    const e = s.characters.A.profile.experience;
    assert.equal(e.abortionExperience, purpose === 'termination' ? 1 : 0);
    assert.equal(e.miscarriageExperience, purpose === 'miscarriage' ? 1 : 0);
  }
});

test('partial emergency success removes only matching embryos and never rerolls a retried attempt', () => {
  const s = setup();
  deposit(s, false); deposit(s, false);
  const contacts = s.characters.A.profile.base.spermContacts;
  s.characters.A.profile.pregnant.fetuses = contacts.map((x, i) => ({ embryoId: i + 1, fathers: 'B', contactIds: [x.id] }));
  s.characters.A.profile.base.fertilizationDays = 1;
  call(s, 'bsUpdateCharacterStatus', { female: 'A', options: {} });
  const original = Math.random;
  let draws = 0;
  Math.random = () => ++draws === 1 ? 0 : .99;
  try {
    call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }, 'attempt:0');
    const p = s.characters.A.profile;
    assert.equal(p.pregnant.fetuses.length, 1);
    assert.deepEqual(p.pregnant.fetuses[0].contactIds, [contacts[1].id]);
    assert.equal(p.base.sperms[0].value, 40);
    assert.equal(p.experience.abortionExperience, 0);
    assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }, 'attempt:0').unchanged, true);
    assert.equal(draws, 2);
  } finally { Math.random = original; }
});

test('partial emergency success reconstructs the surviving chimera constituent', () => {
  const s = setup(); deposit(s, false); deposit(s, false);
  const contacts = s.characters.A.profile.base.spermContacts;
  const parts = contacts.map((x, i) => ({ embryoId: i + 1, fathers: `父${i}`, race: '人类', contactIds: [x.id] }));
  s.characters.A.profile.pregnant.fetuses = [{ embryoId: 3, fathers: '父0 × 父1', contactIds: contacts.map((x) => x.id), contactEmbryos: parts, chimera: {} }];
  call(s, 'bsUpdateCharacterStatus', { female: 'A', options: {} });
  const original = Math.random; let draws = 0;
  Math.random = () => ++draws === 1 ? 0 : .99;
  try {
    call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' });
    const fetus = s.characters.A.profile.pregnant.fetuses[0];
    assert.equal(fetus.fathers, '父1');
    assert.equal(fetus.embryoId, 3);
    assert.equal(fetus.chimera, undefined);
  } finally { Math.random = original; }
});

test('reregistration preserves omitted experience counters and initializes only the applicable side', () => {
  const s = setup(); s.characters.A.profile.experience.abortionExperience = 3;
  const inference = { mens: { mastery_value: 30 }, stageProfiles: stageProfiles('mens') };
  applyRegistryResult(s, { name: 'A', profile: { psychology: inference } });
  assert.equal(s.characters.A.profile.experience.abortionExperience, 3);
  assert.equal(s.characters.A.profile.psychology.activeSide, 'mens');
  assert.equal(s.characters.A.profile.psychology.preg.confidence_value, null);
  applyBreedingInferenceResult(s, 'A', inference);
  assert.deepEqual(Object.keys(s.characters.A.profile.psychology.stageProfiles), ['mens']);
  const before = JSON.stringify(s.characters.A);
  assert.throws(() => applyBreedingInferenceResult(s, 'A', { preg: {}, stageProfiles: stageProfiles('preg') }));
  assert.equal(JSON.stringify(s.characters.A), before);
  const prompt = buildRegistrySystemPrompt({}, { includeBreedingPsychology: true, breedingInference: inference });
  assert.doesNotMatch(prompt, /isChaste|hasContraception|knowsFatherSource|hasProfessionalPrenatalCare|cognition_value/);
});

test('legacy packed floors retain single mates and merged losses during schema migration', () => {
  const ctx = { chatId: 'legacy-reproductive-floor', chat: [], extensionSettings: {} };
  const settings = state.getSettings(ctx); const s = setup();
  s.schemaVersion = 3;
  s.characters.A.profile.experience = { emotionalMate: 'B', marriageMate: 'C', miscarriageExperience: 4 };
  // Packed v3 deltas omit every new v4 field; inject the authentic legacy experience patch.
  state.recordChatStateSnapshot(ctx, s, { messageCount: 0 });
  s.snapshots[0].stateSnapshot.characters.A.profile.experience = { emotionalMate: 'B', marriageMate: 'C', miscarriageExperience: 4 };
  settings.chatStates[ctx.chatId] = s;
  const migrated = state.getChatState(ctx, settings);
  const past = state.getSnapshotCharacter(migrated, 0, 'A').profile.experience;
  assert.deepEqual(past.emotionalMates, ['B']);
  assert.deepEqual(past.marriageMates, ['C']);
  assert.equal(past.unclassifiedLossExperience, undefined);
  assert.equal(past.miscarriageExperience, 4);
});

test('pending psychology discards stale replies and retries malformed replies without inventing zero', async () => {
  const ctx = { chatId: 'pending-psychology', chat: [], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx); settings.apiUrl = 'https://example.test/v1'; settings.model = 'test';
  const s = state.getChatState(ctx, settings); s.characters = setup().characters;
  s.characters.A.profile.psychology = { enabled: true, pendingSide: 'mens', activeSide: 'mens', generation: 1, mens: {}, preg: {}, stageProfiles: {} };
  const original = globalThis.fetch;
  let valid = true; let onRequest = () => {};
  globalThis.fetch = async () => {
    onRequest();
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid ? {
      mens: { mastery_value: 60, desire_value: null, autonomy_value: 40 }, stageProfiles: stageProfiles('mens')
    } : { mens: { mastery_value: 0 } }) } }] }) };
  };
  try {
    await inferPendingPsychology(ctx, settings, s, () => false);
    assert.equal(s.characters.A.profile.psychology.pendingSide, 'mens');
    onRequest = () => { s.characters.A.profile.psychology.generation += 1; };
    await inferPendingPsychology(ctx, settings, s);
    assert.equal(s.characters.A.profile.psychology.pendingSide, 'mens');
    onRequest = () => {}; valid = false;
    await inferPendingPsychology(ctx, settings, s);
    assert.equal(s.characters.A.profile.psychology.mens.mastery_value, null);
    assert.match(s.characters.A.profile.psychology.inferenceError, /失败/);
    valid = true;
    await inferPendingPsychology(ctx, settings, s);
    assert.equal(s.characters.A.profile.psychology.pendingSide, null);
    assert.equal(s.characters.A.profile.psychology.mens.mastery_value, 60);
    assert.equal(s.characters.A.profile.psychology.mens.desire_value, null);
  } finally { globalThis.fetch = original; }
});


test('manual inference rejects chat switches and same-text swipe changes', async () => {
  const originalFetch = globalThis.fetch, originalST = globalThis.SillyTavern;
  const ctx = { chatId: 'manual-psychology', chat: [{ is_user: false, mes: '相同正文', swipe_id: 0 }], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} };
  let live = ctx;
  globalThis.SillyTavern = { getContext: () => live };
  const settings = state.getSettings(ctx); settings.apiUrl = 'https://example.test/v1'; settings.model = 'test';
  const s = state.getChatState(ctx, settings); s.characters = setup().characters;
  let mutate = () => { live = { ...ctx, chatId: 'other-chat' }; };
  globalThis.fetch = async () => {
    mutate();
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ mens: { mastery_value: 60 }, stageProfiles: stageProfiles('mens') }) } }] }) };
  };
  try {
    await assert.rejects(runRegistryBreedingInference(ctx, { targetName: 'A' }), { code: 'BS_REPRODUCTIVE_STALE' });
    live = ctx; mutate = () => { ctx.chat[0].swipe_id = 1; };
    await assert.rejects(runRegistryBreedingInference(ctx, { targetName: 'A' }), { code: 'BS_REPRODUCTIVE_STALE' });
    assert.notEqual(s.characters.A.profile.psychology.mens.mastery_value, 60);
  } finally { globalThis.fetch = originalFetch; globalThis.SillyTavern = originalST; }
});

test('notice and labor samples keep their pregnancy history after removing the first embryo', () => {
  const s = setup('临产期'); const p = s.characters.A.profile;
  p.pregnant.fetuses = [{ embryoId: 1, fathers: 'B', race: '人类', gender: '女' }, { embryoId: 2, fathers: 'C', race: '人类', gender: '女' }];
  p.pregnant.pregnantDays = 266; p.pregnant.effectivePregnantDays = 266;
  p.experience.pregnantExperience = 5; p.experience.miscarriageExperience = 2;
  p.pregnant.termReadiness = { embryoId: 1, value: 2 };
  const sample = ensureNaturalNoticeSample(p);
  assert.equal(sample.experience.H, 4);
  call(s, 'bsAbortion', { female: 'A', fetusIndex: 0, purpose: 'termination' });
  call(s, 'bsPassedTime', { hour: 1 });
  const next = s.characters.A.profile.pregnant;
  assert.deepEqual(next.termReadiness, { embryoId: 1, value: 2 });
  assert.deepEqual(next.noticeSample, sample);
  assert.deepEqual(next.experienceBeforePregnancy, sample.experience);
});


test('pseudo expiry carries overflow through menstruation and refreshes even if it reenters pseudo', () => {
  const s = setup('假孕期');
  const p = s.characters.A.profile;
  p.pregnant.pregnantDays = 84;
  record(s);
  call(s, 'bsPassedTime', { day: 8 });
  assert.equal(s.characters.A.profile.base.stage, '卵泡期');
  assert.equal(s.characters.A.profile.cognitionRecords.length, 0);
  const repeat = setup('假孕期'); const q = repeat.characters.A.profile;
  q.pregnant.pregnantDays = 84; q.base.psyStress = 150; q.base.libido = 90;
  q.experience.latestSexPartner = 'B';
  q.psychology = { enabled: true, activeSide: 'preg', generation: 1, preg: { confidence_value: 75 }, stageProfiles: stageProfiles('preg') };
  record(repeat);
  call(repeat, 'bsPassedTime', { day: 40 });
  assert.equal(repeat.characters.A.profile.base.stage, '假孕期');
  assert.equal(repeat.characters.A.profile.cognitionRecords.length, 0);
  assert.equal(repeat.characters.A.profile.psychology.pendingSide, 'preg');
  assert.equal(repeat.characters.A.profile.psychology.generation, 2);
});


test('plain and bundled registration preserve author seeds over model guesses and use saved notice settings', async () => {
  const original = globalThis.fetch;
  const ctx = { chatId: 'seeded-registration', chat: [], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx); settings.apiUrl = 'https://example.test/v1'; settings.model = 'test';
  settings.reproductiveSettings = { noticeBaseDays: 60 };
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    name: 'wrong-name', profile: { base: { race: '人类', stage: '孕早期' }, pregnant: { gestationalAgeDays: 56, fetuses: [{ race: '人类', gender: '女', fathers: 'B' }] },
      cognitionRecords: [{ time: '自动', method: 'prenatal', content: '模型补的真相' }] }, diary: { time: '今日', content: '今天的日记' }
  }) } }] }) });
  try {
    for (const [targetName, bundle] of [['A', null], ['C', {}]]) {
      const seeds = [{ time: '古历旅途第六日', method: 'guess', content: '她以为自己没有怀孕。' }];
      const character = await runRegistry(ctx, { targetName, bundle, initialCognitionRecords: seeds });
      assert.equal(character.profile.cognitionRecords.length, 1);
      assert.equal(character.profile.cognitionRecords[0].content, seeds[0].content);
      assert.equal(character.profile.cognitionRecords[0].source, 'registration');
      assert.equal(character.profile.pregnant.noticeSample.config.noticeBaseDays, 60);
      assert.equal(character.profile.psychology.enabled, undefined);
    }
  } finally { globalThis.fetch = original; }
});

test('user aliases resolve for relationships and selected identity without changing genetic fathers', () => {
  const original = globalThis.SillyTavern;
  globalThis.SillyTavern = { getContext: () => ({ name1: 'A' }) };
  try {
    const s = setup(); s.characters.A.profile.children = [{ name: '孩子', fathers: 'B' }];
    const args = { female: '{{user}}', action: 'date', time: '今日', partner: '{{user}}' };
    assert.equal(call(s, 'bsRecordExperience', args, 'alias-date').applied, true);
    assert.equal(call(s, 'bsRecordExperience', args, 'alias-date').unchanged, true);
    assert.deepEqual(s.characters.A.profile.experience.emotionalMates, ['A']);
    call(s, 'bsRecordExperience', { female: 'A', action: 'child', time: '今日', childIndex: 0, selectedFather: '{{user}}' });
    assert.equal(s.characters.A.profile.children[0].selectedFather, 'A');
    assert.equal(s.characters.A.profile.children[0].fathers, 'B');
  } finally { globalThis.SillyTavern = original; }
});


test('prompt projection shows only the current psychology side and no replay or contact internals', () => {
  const ctx = { chatId: 'projection-side', chat: [], characters: [], name1: '用户', name2: 'A' };
  const settings = state.getSettings(ctx); const s = state.getChatState(ctx, settings); s.characters = setup().characters;
  s.characters.A.profile.psychology = { enabled: true, mens: { mastery_value: 65 }, preg: { confidence_value: 99 }, stageProfiles: stageProfiles('mens') };
  record(s, {}, 'internal-source-fingerprint');
  s.lastOperationLogs = [{ name: 'bsAbortion', arguments: { female: 'A' }, applied: true, message: '事后尝试已结算：失败，仍有受精可能。' }];
  const profile = buildTrackerPayload(ctx, settings).existing_state.A.profile;
  assert.equal(profile.psychology.mens.mastery_value, 65);
  assert.equal(profile.psychology.preg, undefined);
  assert.equal(profile.psychology.stageProfiles, undefined);
  assert.equal(profile.cognitionRecords[0].source, undefined);
  assert.equal(profile.cognitionRecords[0].content, s.characters.A.profile.cognitionRecords[0].content);
  assert.equal(s.characters.A.profile.cognitionRecords[0].source, 'internal-source-fingerprint');
  const prompt = buildMainFlowPrompt(ctx, settings);
  assert.match(prompt, /上轮已结算的生殖操作结果/);
  assert.match(prompt, /事后尝试已结算：失败/);
  assert.match(prompt, /这不是角色已知的事实/);
  s.characters.A.profile.base.isHere = false;
  assert.doesNotMatch(buildMainFlowPrompt(ctx, settings), /事后尝试已结算：失败/);
  assert.equal(profile.reproductiveOperations, undefined);
  assert.equal(profile.base.spermContacts, undefined);
  assert.equal(s.characters.A.profile.psychology.preg.confidence_value, 99);
});


test('emergency window follows actual implantation duration and ignores the obsolete global override', () => {
  for (const [ratio, days] of [[1, 6], [2, 12], [0.5, 3]]) {
    const s = setup();
    s.characters.A.profile.bio.menstrualLengthRatio = ratio;
    s.reproductiveSettings = { emergencyEffectiveness: 1, emergencyWindowMinutes: 1 };
    deposit(s, false);
    s.minutesPassed = days * 1440 / 2;
    call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' });
    const settled = s.characters.A.profile.lastEmergencyResult;
    assert.equal(settled.windowMinutes, days * 1440);
    assert.equal(settled.outcomes[0].probability, 0.5);
    assert.equal(normalizeReproductiveSettings(s.reproductiveSettings).emergencyWindowMinutes, undefined);
  }
});

test('emergency probability is zero at or beyond species implantation time', () => {
  for (const elapsed of [3 * 1440, 3 * 1440 + 1]) {
    const s = setup();
    s.characters.A.profile.bio.menstrualLengthRatio = 0.5;
    s.reproductiveSettings = { emergencyEffectiveness: 1 };
    deposit(s, false);
    s.minutesPassed = elapsed;
    assert.equal(call(s, 'bsAbortion', { female: 'A', purpose: 'emergency' }).applied, true);
    assert.equal(s.characters.A.profile.lastEmergencyResult.outcomes[0].probability, 0);
    assert.equal(s.characters.A.profile.base.spermContacts[0].blocked, false);
  }
});


test('retired loss bucket folds once for schema-4 profiles and packed floors without resetting psychology', () => {
  const ctx = { chatId: 'retired-loss-v4', chat: [], extensionSettings: {} };
  const settings = state.getSettings(ctx); const s = setup('孕早期');
  s.characters.A.profile.experience = { pregnantExperience: 8, miscarriageExperience: 2, abortionExperience: 1, unclassifiedLossExperience: 3 };
  s.characters.A.profile.psychology = { preg: { confidence_value: 72 } };
  s.characters.A.profile.reproductiveMigration = { version: 4, original: { experience: { miscarriageExperience: 3 } } };
  state.recordChatStateSnapshot(ctx, s, { messageCount: 0 });
  s.snapshots[0].stateSnapshot.characters.A.profile.experience = { pregnantExperience: 8, miscarriageExperience: 2, abortionExperience: 1, unclassifiedLossExperience: 3 };
  settings.chatStates[ctx.chatId] = s;
  for (let i = 0; i < 2; i++) {
    const current = state.getChatState(ctx, settings);
    for (const p of [current.characters.A.profile, state.getSnapshotCharacter(current, 0, 'A').profile]) {
      assert.equal(p.experience.miscarriageExperience, 5);
      assert.equal(p.experience.abortionExperience, 1);
      assert.equal(Object.hasOwn(p.experience, 'unclassifiedLossExperience'), false);
    }
    assert.equal(current.characters.A.profile.psychology.preg.confidence_value, 72);
  }
  const normalized = normalizeExperience({ miscarriageExperience: 2, unclassifiedLossExperience: 3 });
  assert.deepEqual(normalizeExperience(normalized), normalized);
  assert.deepEqual(experienceSnapshot({ pregnantExperience: 8, miscarriageExperience: 2, unclassifiedLossExperience: 3, abortionExperience: 1 }), { H: 8, M: 5, A: 1, U: 0, complete: true });
});
