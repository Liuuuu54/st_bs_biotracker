import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { buildMainFlowPrompt, buildTrackerPayload } from '../scripts/tracker.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { enablePooledConception, isPooledConception, projectPooledSperms } from '../scripts/pooled_reproduction.js';

const root = new URL('../', import.meta.url);
const controller = await readFile(new URL('index.js', root), 'utf8');
const html = await readFile(new URL('settings.html', root), 'utf8');
const tracker = await readFile(new URL('scripts/tracker.js', root), 'utf8');

// Execute exact controller bodies with host/UI dependencies injected, not a browser E2E.
function controllerFunction(name, nextName, dependencies) {
  const start = controller.indexOf(`function ${name}(`);
  const end = controller.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `controller function ${name} exists`);
  const names = Object.keys(dependencies);
  return new Function(...names, `${controller.slice(start, end)}; return ${name};`)(...Object.values(dependencies));
}

function setup() {
  let saves = 0;
  const ctx = {
    chatId: 'pooled-ui-contract', characters: [], name1: 'U', name2: 'A',
    chat: [{ name: 'A', is_user: false, mes: '旅途中。' }],
    extensionSettings: {}, saveSettingsDebounced() { saves += 1; }, async saveSettings() { saves += 1; },
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  Object.assign(character.profile.base, {
    age: 24, stage: '排卵期', days: 0, eggs: 1, isHere: true,
    sperms: [{ male: 'M', race: '人类', value: 20, quality: 1 }],
    spermContacts: [{ id: 7, male: 'M', race: '人类', value: 20, quality: 1, qualityAtDeposit: 1 }],
  });
  chatState.characters.A = character;
  chatState.minutesPassed = 123;
  state.getChatState(ctx, settings);
  return { ctx, settings, chatState, character, saves: () => saves };
}

test('full-state pooled opt-in is an explicit, disabled-by-default control with no downgrade toggle', () => {
  assert.match(html, /id="bs-bt-full-state-enable-pooled"[^>]*type="button"[^>]*disabled>启用实验性混合池/);
  assert.match(controller, /import \{ enablePooledConception, isPooledConception \} from '\.\/scripts\/pooled_reproduction\.js'/);
  assert.match(controller, /getElementById\('bs-bt-full-state-enable-pooled'\)\?\.addEventListener\('click',[\s\S]*?enableSelectedPooledConception\(ctx\)/);
  assert.doesNotMatch(controller, /disablePooledConception|spermPool\s*=\s*null/);
  assert.match(html, /快照.*24.*无一键降级/);
  assert.match(tracker, /delete profile\.base\.spermPool/);
  assert.match(tracker, /delete profile\.base\?\.spermContacts/);
});

test('full-state button disables missing selection, sire selection and already-enabled characters', () => {
  const { ctx, character } = setup();
  for (const [name, kind, enabled, disabled] of [
    ['', 'character', false, true], ['A', 'sire', false, true],
    ['A', 'character', false, false], ['A', 'character', true, true],
  ]) {
    if (enabled) enablePooledConception(character.profile.base, 123, { seed: 'controls' });
    const nodes = new Map();
    const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } };
    const update = controllerFunction('updateFullStateControls', 'updateFullStateSubpage', {
      document, selectedFullStateName: name, selectedFullStateKind: kind,
      getChatState: state.getChatState, getSettings: state.getSettings, isPooledConception,
    });
    update(ctx);
    const button = nodes.get('bs-bt-full-state-enable-pooled');
    assert.equal(button.disabled, disabled, `${name || 'none'}/${kind}/${enabled}`);
    assert.equal(button.textContent, enabled ? '实验性混合池已启用' : '启用实验性混合池');
  }
});

test('explicit opt-in preserves pre/post snapshots and saves before rendering, with idempotent repeated clicks', async () => {
  const { ctx, chatState, character, saves } = setup();
  const before = structuredClone(character);
  const events = [];
  const status = [];
  const enable = controllerFunction('enableSelectedPooledConception', 'applyFullStateManualEdit', {
    selectedFullStateName: 'A', selectedFullStateKind: 'character',
    getSettings: state.getSettings, getChatState: state.getChatState, isPooledConception,
    recordChatStateSnapshot(...args) { events.push(args[2].reason); return state.recordChatStateSnapshot(...args); },
    enablePooledConception(...args) { events.push('enable'); assert.equal(args[1], 123); return enablePooledConception(...args); },
    saveSettings(...args) { events.push('save'); return state.saveSettings(...args); },
    renderStatusPanel() { events.push('renderStatus'); }, renderFullStatePage() { events.push('renderFull'); },
    updateMainFlowPrompt() {}, resetPoller() {}, trackerDeps: {},
    setFullStateEditStatus(...args) { status.push(args); },
  });
  assert.equal(isPooledConception(character.profile.base), false, 'setup does not opt in');
  enable(ctx);
  assert.deepEqual(events, ['before_enable_pooled_conception', 'enable', 'manual_enable_pooled_conception', 'save', 'renderStatus', 'renderFull']);
  assert.equal(isPooledConception(character.profile.base), true);
  await state.saveSettingsNow(ctx); // flush the existing host save harness, not a fake disk assertion
  assert.ok(saves() > 0);
  const snapshots = state.listChatStateSnapshots(chatState);
  const pre = snapshots.find((entry) => entry.reason === 'before_enable_pooled_conception');
  const post = snapshots.find((entry) => entry.reason === 'manual_enable_pooled_conception');
  assert.deepEqual(state.getSnapshotCharacter(chatState, pre.index, 'A').profile.base, before.profile.base);
  assert.equal(state.getSnapshotCharacter(chatState, post.index, 'A').profile.base.spermPool.model, 'pooled-v1');
  assert.equal(status.at(-1)[1], 'success');
  const persisted = JSON.stringify(character);
  enable(ctx);
  assert.equal(events.length, 6);
  assert.equal(JSON.stringify(character), persisted, 'repeated click never downgrades/reseeds');
});

function panelPreview(base, immune = {}) {
  const start = controller.indexOf("  const stage = String(base.stage || '未设定');", controller.indexOf('function buildTrackCharacterViewModel('));
  const end = controller.indexOf('  const rawFetuses = ', start);
  assert.ok(start > 0 && end > start);
  let options;
  const result = new Function('base', 'bio', 'immune', 'MENSTRUAL_STAGES', 'isPooledConception', 'getUterusVolumeFactor', 'calculateFertilizationPreview',
    `${controller.slice(start, end)}; return { conceptionPreview, totalSperm };`)(
    base, {}, immune, ['卵泡期', '排卵期', '黄体期', '月经期'], isPooledConception, () => 1,
    (args) => { options = args; return calculateFertilizationPreview(args); },
  );
  return { ...result, options };
}

test('legacy panel preview keeps its original calculator arguments and aggregate presentation', () => {
  const { character } = setup();
  const base = character.profile.base;
  const original = { eggRace: base.race, impregnationDifficulty: undefined, elapsedDays: 1, chanceFactor: 1, spermSources: base.sperms, uterusVolumeFactor: 1 };
  const { options, conceptionPreview, totalSperm } = panelPreview(base, { crossSpecies: true });
  assert.deepEqual(options, original, 'legacy does not silently gain a model or immune override');
  assert.deepEqual(conceptionPreview, calculateFertilizationPreview(original));
  assert.equal(totalSperm, 20);
  assert.match(controller, /sperms: Array\.isArray\(base\.sperms\) \? base\.sperms : \[\]/);
});

test('pooled panel reads canonical contacts and passes model, 24h and the existing crossSpecies switch', () => {
  const { character } = setup();
  const base = character.profile.base;
  enablePooledConception(base, 123, { seed: 'panel' });
  base.sperms = []; // stale view must not suppress the canonical preview
  const { options, conceptionPreview, totalSperm } = panelPreview(base, { crossSpecies: true });
  assert.equal(options.spermSources, base.spermContacts);
  assert.equal(options.model, 'pooled-v1');
  assert.equal(options.crossSpecies, true);
  assert.equal(options.elapsedDays, 1);
  assert.ok(conceptionPreview.successChance > 0);
  assert.equal(totalSperm, 0, 'ring total remains the aggregate, not a reinterpreted quality-weighted volume');
  assert.equal(panelPreview(base, {}).options.crossSpecies, false);
});

test('legacy sperm prompt projection remains unchanged, including upstream extension fields', () => {
  const { ctx, settings, character } = setup();
  const sperm = character.profile.base.sperms[0];
  Object.assign(sperm, { legacyExtension: 'LEGACY_EXTENSION', sourceIds: [99], pooledView: 'LEGACY_FIELD', qualityAtDeposit: 2 });
  state.getChatState(ctx, settings);
  const before = structuredClone(sperm);
  const payload = buildTrackerPayload(ctx, settings);
  const mainflow = buildMainFlowPrompt(ctx, settings);
  assert.deepEqual(payload.existing_state.A.profile.base.sperms[0], before);
  const narrated = JSON.parse(mainflow.match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\\/').join('</'));
  assert.deepEqual(narrated.A.profile.base.sperms[0], before);
  assert.deepEqual(character.profile.base.sperms[0], before);
});

test('actual tracker payload and mainflow prompt exclude pool randomness, source histories and non-whitelisted audits without mutating saved state', () => {
  const { ctx, settings, chatState, character } = setup();
  const profile = character.profile;
  enablePooledConception(profile.base, 123, { seed: 'PRIVATE_POOL_SEED' });
  profile.base.spermPool.privateIndex = 'PRIVATE_INTERNAL_INDEX';
  profile.base.spermPool.eggs[0].threshold = 987654321.12345;
  Object.assign(profile.base.spermContacts[0], {
    privateContact: 'PRIVATE_CONTACT_SNAPSHOT', arbitraryAudit: { token: 'PRIVATE_AGGREGATE_AUDIT' },
    blocked: true, bodySize: 1.75,
  });
  projectPooledSperms(profile.base); // reproduce the real contact -> aggregate prompt bypass
  assert.equal(profile.base.sperms[0].privateContact, 'PRIVATE_CONTACT_SNAPSHOT');
  assert.deepEqual(profile.base.sperms[0].sourceIds, [7]);
  assert.equal(profile.base.sperms[0].pooledView, true);
  profile.base.sperms[0].qualityAtDeposit = 'PRIVATE_AGGREGATE_QUALITY_AUDIT';
  profile.base.stage = '孕早期';
  const audit = { model: 'pooled-v1', minute: 120, eggId: 'PRIVATE_EGG_ID', winnerContactId: 'PRIVATE_WINNER_ID', seed: 'PRIVATE_AUDIT_SEED', threshold: 'PRIVATE_AUDIT_THRESHOLD' };
  profile.pregnant.fetuses = [{ name: '胎儿', embryoId: 1, weight: 1, race: '人类', pooledConception: audit, conceptionEvent: { draw: 'PRIVATE_FETAL_RANDOM' } }];
  profile.children = [{ name: '孩子', pooledConception: { ...audit, minute: 100 }, conceptionEvent: { draw: 'PRIVATE_CHILD_RANDOM' } }];
  const offscreen = structuredClone(character);
  offscreen.name = 'B';
  offscreen.profile.base.isHere = false;
  chatState.characters.B = offscreen;
  // The host normalizes bloodlines/talents lazily; settle that pre-existing behavior first.
  state.getChatState(ctx, settings);
  const before = JSON.stringify(chatState.characters);
  const payload = buildTrackerPayload(ctx, settings);
  const mainflow = buildMainFlowPrompt(ctx, settings);
  const json = JSON.stringify(payload);
  for (const serialized of [json, mainflow]) {
    assert.doesNotMatch(serialized, /spermPool|spermContacts|nextSpermContactId|conceptionEvent|PRIVATE_|987654321\.12345/);
    assert.doesNotMatch(serialized, /"(?:eggId|winnerContactId|remainingHazard|threshold|sourceIds|pooledView|qualityAtDeposit|privateContact|arbitraryAudit)"/);
  }
  const promptSperm = payload.existing_state.A.profile.base.sperms[0];
  assert.deepEqual(promptSperm, {
    male: 'M', race: '人类', bloodline: { 人类: 1 }, bloodlineSource: 'pure',
    bodySize: 1.75, quality: 1, value: 20, blocked: true,
  });
  const narrated = JSON.parse(mainflow.match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\\/').join('</'));
  assert.deepEqual(narrated.A.profile.base.sperms[0], promptSperm);
  assert.deepEqual(payload.existing_state.A.profile.pregnant.fetuses[0].pooledConception, { minute: 120 });
  assert.deepEqual(payload.existing_state.A.profile.children[0].pooledConception, { minute: 100 });
  assert.equal(payload.existing_state.B.offscreen, true);
  assert.equal(payload.existing_state.B.profile.base.spermPool, undefined);
  assert.equal(JSON.stringify(chatState.characters), before, 'prompt projection leaves persisted randomness/history intact');
});
