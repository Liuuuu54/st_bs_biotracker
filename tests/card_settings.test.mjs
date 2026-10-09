import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sanitizeCardSettings, getCardSettings, getEffectiveSettings, syncCardSettings,
  getSettingSource, importCardSkillSeed, exportCardSkillSeed, updateCardSettings, canWriteCardSettings,
} from '../scripts/card_settings.js';
import * as state from '../scripts/state.js';
import { getEmbryoTypeByRace, getMergedRacePhysiologyProfile, getDerivedTypeInheritanceProfile } from '../scripts/race_config.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { applyToolCallsResult } from '../scripts/tools.js';

const clone = value => structuredClone(value);
const seed = () => ({ version: 1, skills: { catalog: [{ name: '剑术', description: '长剑实战。', id: 999, level: 10 }], baselinePrompt: '只追踪冒险。' } });
function context(value = seed()) {
  delete globalThis.__TAURITAVERN__;
  delete globalThis.Luker;
  const ctx = {
    characterId: 0, chatId: 'card-test', name2: '测试卡', chat: [],
    characters: [{ name: '测试卡', avatar: 'card-test.png', data: { extensions: { bs_biotracker: value, other: { keep: 1 } } } }],
    extensionSettings: {}, saveSettingsDebounced() {},
    async writeExtensionField(id, key, value) {
      const extensions = this.characters[id].data.extensions;
      if (value === '__@@UNSET@@__') delete extensions[key];
      else extensions[key] = clone(value);
    },
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return ctx;
}

test('card schema rejects unknown versions, dangerous keys, invalid types and numeric strings', () => {
  assert.equal(sanitizeCardSettings({ version: 2 }), null);
  assert.equal(sanitizeCardSettings({}), null);
  const raw = JSON.parse('{"version":1,"apiKey":"not-exported","racePhysiologyOverrides":{"__proto__":{"polluted":true},"人类":{"genderRatio":null,"breedTolerance":"3","embryoType":"wrong","recoveryCoefficient":-5,"unknown":1}},"reproductiveSettings":{"condomReliability":0,"emergencyEffectiveness":"1","noticeBaseDays":1},"worldBaselinePrompt":{},"skills":{"catalog":[{"name":"剑术","description":"定义","id":999,"level":10},{"name":"剑术","description":"重复"},{"name":{},"description":"无效"}],"baselinePrompt":"冒险"}}');
  const clean = sanitizeCardSettings(raw);
  assert.deepEqual(clean.racePhysiologyOverrides, { 人类: { genderRatio: null, recoveryCoefficient: 0.01 } });
  assert.deepEqual(clean.reproductiveSettings, { condomReliability: 0 });
  assert.deepEqual(clean.skills, { catalog: [{ name: '剑术', description: '定义' }], baselinePrompt: '冒险' });
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.worldBaselinePrompt, undefined);
  assert.equal({}.polluted, undefined);
});

test('effective values merge by field, preserve explicit zero and empty baseline/catalog, and never change globals', () => {
  const ctx = context({ version: 1, racePhysiologyOverrides: { 人类: { embryoType: '卵生' } }, derivedTypeOverrides: { 血族: { inheritanceSpeed: 0 } }, reproductiveSettings: { condomReliability: 0 }, raceCatalogSelection: { races: [], derivedTypes: [] }, worldBaselinePrompt: '' });
  const settings = state.getSettings(ctx);
  Object.assign(settings, { racePhysiologyOverrides: { 人类: { breedTolerance: 3 } }, derivedTypeOverrides: { 血族: { introductionLine: '全域短句' } }, reproductiveSettings: { condomCapacity: 90, condomReliability: 1 }, worldBaselinePrompt: '全域基准', raceCatalogSelection: { races: ['精灵'], derivedTypes: ['血族'] } });
  const before = clone(settings);
  const effective = syncCardSettings(ctx, settings);
  assert.equal(getEmbryoTypeByRace('人类'), '卵生');
  assert.equal(getMergedRacePhysiologyProfile('人类').breedTolerance, 3);
  assert.equal(getDerivedTypeInheritanceProfile('血族').inheritanceSpeed, 0);
  assert.deepEqual(effective.reproductiveSettings.condomCapacity, 90);
  assert.equal(effective.reproductiveSettings.condomReliability, 0);
  assert.equal(effective.worldBaselinePrompt, '');
  assert.deepEqual(effective.raceCatalogSelection, { races: [], derivedTypes: [] });
  assert.deepEqual(settings, before);
  assert.equal(getSettingSource(ctx, settings, 'reproductiveSettings', undefined, 'condomCapacity'), '全域覆盖');
  assert.equal(getSettingSource(ctx, settings, 'reproductiveSettings', undefined, 'condomReliability'), '卡片覆盖');
  assert.equal(getSettingSource(ctx, settings, 'racePhysiologyOverrides', '人类', 'genderRatio'), '内置');
  ctx.characters.push({ data: { extensions: {} } });
  ctx.characterId = 1;
  assert.equal(syncCardSettings(ctx, settings).worldBaselinePrompt, '全域基准');
  assert.equal(getEmbryoTypeByRace('人类'), '胎生');
  ctx.characterId = 0; ctx.groupId = 'group';
  assert.equal(getCardSettings(ctx), null);
  assert.equal(canWriteCardSettings(ctx), false);
  assert.equal(getEffectiveSettings(ctx, settings).reproductiveSettings.condomReliability, 1);
});

test('new chats seed once with their allocator; clearing and reload do not reseed, and another chat seeds independently', () => {
  const ctx = context();
  const settings = state.getSettings(ctx);
  const chat = state.getChatState(ctx, settings);
  assert.equal(chat.schemaVersion, 8);
  assert.deepEqual(chat.skillCatalog, [{ id: 1, name: '剑术', description: '长剑实战。' }]);
  assert.equal(chat.nextSkillId, 2);
  assert.equal(chat.cardSkillSeedApplied, true);
  chat.skillCatalog = []; chat.skillBaselinePrompt = '';
  state.recordChatStateSnapshot(ctx, chat, { reason: 'clear' });
  assert.equal(state.getChatState(ctx, settings).skillCatalog.length, 0);
  settings.chatStates[ctx.chatId] = JSON.parse(JSON.stringify(chat));
  assert.equal(state.getChatState(ctx, settings).skillCatalog.length, 0);
  ctx.chatId = 'second-card-test';
  assert.equal(state.getChatState(ctx, settings).skillCatalog.length, 1);
});

test('auto seed respects nonempty baseline/catalog, disabled system, missing card and absent active chat', () => {
  const ctx = context();
  const settings = state.getSettings(ctx);
  for (const patch of [{ skillBaselinePrompt: '保留' }, { skillCatalog: [{ id: 8, name: '自订', description: '保留' }] }]) {
    const chat = Object.assign(state.createEmptyChatState(), patch);
    assert.equal(importCardSkillSeed(ctx, settings, chat).applied, false);
    assert.equal(chat.cardSkillSeedApplied, true);
    chat.skillCatalog = []; chat.skillBaselinePrompt = '';
    assert.equal(importCardSkillSeed(ctx, settings, chat).applied, false);
  }
  const chat = state.createEmptyChatState();
  settings.skillSystemEnabled = false;
  assert.equal(importCardSkillSeed(ctx, settings, chat).applied, false);
  assert.equal(chat.cardSkillSeedApplied, false);
  settings.skillSystemEnabled = true;
  ctx.chatId = '';
  assert.equal(importCardSkillSeed(ctx, settings, chat).applied, false);
  ctx.chatId = 'ready'; delete ctx.characters[0].data.extensions.bs_biotracker;
  assert.equal(importCardSkillSeed(ctx, settings, chat).applied, false);
});

test('long-lived UI contexts read and write the current card without changing another settings root', async () => {
  const old = context({ version: 1, worldBaselinePrompt: '旧卡' });
  old.characters.push({ avatar: 'new-card.png', data: { extensions: { bs_biotracker: { version: 1, worldBaselinePrompt: '新卡' } } } });
  const live = { ...old, characterId: 1 };
  globalThis.SillyTavern = { getContext: () => live };
  assert.equal(getCardSettings(old).worldBaselinePrompt, '新卡');
  await updateCardSettings(old, { worldBaselinePrompt: '写入新卡' });
  assert.equal(old.characters[0].data.extensions.bs_biotracker.worldBaselinePrompt, '旧卡');
  assert.equal(old.characters[1].data.extensions.bs_biotracker.worldBaselinePrompt, '写入新卡');
  assert.equal(getCardSettings({ ...old, extensionSettings: {} }).worldBaselinePrompt, '旧卡');
});

test('manual skill merge preserves same-name IDs, existing definitions and baseline; export contains no character state', () => {
  const ctx = context(); const settings = state.getSettings(ctx);
  const chat = Object.assign(state.createEmptyChatState(), { nextSkillId: 20, skillBaselinePrompt: '现有规则', skillCatalog: [{ id: 7, name: '剑术', description: '现有定义' }], cardSkillSeedApplied: true });
  assert.deepEqual(importCardSkillSeed(ctx, settings, chat, { manual: true }), { applied: true, created: 0 });
  assert.equal(chat.skillCatalog[0].id, 7); assert.equal(chat.nextSkillId, 20);
  assert.equal(chat.skillCatalog[0].description, '现有定义');
  assert.equal(chat.skillBaselinePrompt, '现有规则');
  assert.deepEqual(exportCardSkillSeed(chat), { catalog: [{ name: '剑术', description: '现有定义' }], baselinePrompt: '现有规则' });
});

test('schema-5 empty chat and packed snapshots migrate as already processed, with no surprise seed after rollback', () => {
  const ctx = context(); const settings = state.getSettings(ctx);
  const chat = Object.assign(state.createEmptyChatState(), { schemaVersion: 5 });
  delete chat.cardSkillSeedApplied;
  state.recordChatStateSnapshot(ctx, chat, { reason: 'old' });
  settings.chatStates[ctx.chatId] = chat;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 8); assert.equal(migrated.cardSkillSeedApplied, true);
  assert.equal(migrated.skillCatalog.length, 0);
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.equal(migrated.cardSkillSeedApplied, true);
  assert.equal(state.getChatState(ctx, settings).skillCatalog.length, 0);
  assert.equal(state.isChatStateEffectivelyEmpty(migrated), false);
});

test('snapshots restore the seed marker together with skills and allocator', () => {
  const ctx = context(); const chat = state.createEmptyChatState();
  state.recordChatStateSnapshot(ctx, chat, { reason: 'before' });
  importCardSkillSeed(ctx, state.getSettings(ctx), chat);
  state.recordChatStateSnapshot(ctx, chat, { reason: 'seeded' });
  state.restoreChatStateFromSnapshot(chat, chat.snapshots[0]);
  assert.equal(chat.cardSkillSeedApplied, false); assert.equal(chat.skillCatalog.length, 0);
  state.restoreChatStateFromSnapshot(chat, chat.snapshots[1]);
  assert.equal(chat.cardSkillSeedApplied, true); assert.equal(chat.skillCatalog[0].id, 1);
});

test('tracker prompt and actual tool settlement use card reproductive settings, preserving global settings', () => {
  const ctx = context({ version: 1, worldBaselinePrompt: '本卡世界', raceCatalogSelection: { races: [], derivedTypes: [] }, reproductiveSettings: { condomCapacity: 100, condomReliability: 1 } });
  const settings = state.getSettings(ctx);
  settings.reproductiveSettings = { condomReliability: 0 };
  const chat = state.getChatState(ctx, settings);
  chat.characters.A = state.createDefaultFemaleState('A'); chat.characters.A.initialized = true;
  const payload = buildTrackerPayload(ctx, settings);
  assert.equal(payload.world_baseline_prompt, '本卡世界');
  assert.deepEqual(payload.race_catalog_selection, { races: [], derivedTypes: [] });
  applyToolCallsResult(ctx, { tool_calls: [{ name: 'bsAddSperm', arguments: { female: 'A', male: 'B', race: '人类', action: 'deposit', amount: 20, hasCondom: true } }] }, 'card-deposit');
  assert.equal(chat.characters.A.profile.base.sperms.length, 0);
  assert.equal(chat.reproductiveSettings.condomReliability, 1);
  assert.equal(settings.reproductiveSettings.condomReliability, 0);
});

test('card writes preserve other namespace fields and other extensions, remove final payload with UNSET, and reject unsupported format', async () => {
  const ctx = context();
  await updateCardSettings(ctx, { worldBaselinePrompt: '新规则' });
  assert.equal(getCardSettings(ctx).skills.catalog[0].name, '剑术');
  assert.deepEqual(ctx.characters[0].data.extensions.other, { keep: 1 });
  await updateCardSettings(ctx, { skills: undefined });
  assert.deepEqual(getCardSettings(ctx), { version: 1, worldBaselinePrompt: '新规则' });
  await updateCardSettings(ctx, { worldBaselinePrompt: undefined });
  assert.equal(ctx.characters[0].data.extensions.bs_biotracker, undefined);
  ctx.characters[0].data.extensions.bs_biotracker = { version: 9, future: true };
  await assert.rejects(updateCardSettings(ctx, { skills: seed().skills }), /格式不受支持/);
  assert.deepEqual(ctx.characters[0].data.extensions.bs_biotracker, { version: 9, future: true });
});

test('native ST deep-merge deletion sends nested tombstones then canonical JSON so old fields and editor sentinels cannot return', async () => {
  const ctx = context({ ...seed(), racePhysiologyOverrides: { 人类: { breedTolerance: 3, embryoType: '卵生' } } });
  const calls = []; const writer = ctx.writeExtensionField;
  ctx.writeExtensionField = async function(...args) { calls.push(clone(args[2])); return writer.apply(this, args); };
  await updateCardSettings(ctx, { racePhysiologyOverrides: { 人类: { embryoType: '胎生' } } });
  assert.equal(calls[0].racePhysiologyOverrides.人类.breedTolerance, '__@@UNSET@@__');
  assert.equal(calls[1].racePhysiologyOverrides.人类.breedTolerance, undefined);
  assert.equal(getCardSettings(ctx).racePhysiologyOverrides.人类.breedTolerance, undefined);
  assert.equal(getCardSettings(ctx).skills.catalog.length, 1);
});

test('TauriTavern deep-merges like ST and gets tombstones; Luker replaces the namespace and does not', async () => {
  for (const kind of ['tauritavern', 'luker']) {
    const ctx = context({ ...seed(), racePhysiologyOverrides: { 人类: { breedTolerance: 3, embryoType: '卵生' } } });
    if (kind === 'tauritavern') globalThis.__TAURITAVERN__ = {};
    else globalThis.Luker = { getContext: () => ctx };
    try {
      const calls = []; const writer = ctx.writeExtensionField;
      ctx.writeExtensionField = async function(...args) { calls.push(clone(args[2])); return writer.apply(this, args); };
      await updateCardSettings(ctx, { racePhysiologyOverrides: { 人类: { embryoType: '胎生' } } });
      assert.equal(calls[0].racePhysiologyOverrides.人类.breedTolerance, kind === 'tauritavern' ? '__@@UNSET@@__' : undefined, kind);
      assert.equal(calls.length, kind === 'tauritavern' ? 2 : 1, kind);
      assert.equal(getCardSettings(ctx).racePhysiologyOverrides.人类.breedTolerance, undefined, kind);
    } finally { delete globalThis.__TAURITAVERN__; delete globalThis.Luker; }
  }
});

test('concurrent card writes serialize and merge the latest namespace, failed writes restore memory', async () => {
  const ctx = context();
  await Promise.all([updateCardSettings(ctx, { worldBaselinePrompt: 'A' }), updateCardSettings(ctx, { reproductiveSettings: { condomCapacity: 25 } })]);
  assert.equal(getCardSettings(ctx).worldBaselinePrompt, 'A');
  assert.equal(getCardSettings(ctx).reproductiveSettings.condomCapacity, 25);
  const before = clone(ctx.characters[0].data.extensions);
  ctx.writeExtensionField = async function(id, key, value) { this.characters[id].data.extensions[key] = value; throw Error('write failed'); };
  await assert.rejects(updateCardSettings(ctx, { worldBaselinePrompt: 'wrong' }), /write failed/);
  assert.deepEqual(ctx.characters[0].data.extensions, before);
});

test('native persistence readback catches APIs which silently swallow save failures', async () => {
  const ctx = context(); const originalFetch = globalThis.fetch;
  ctx.getRequestHeaders = () => ({ 'Content-Type': 'application/json' });
  const stored = clone(ctx.characters[0]);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/characters/get');
    assert.deepEqual(JSON.parse(options.body), { avatar_url: 'card-test.png' });
    return { ok: true, json: async () => stored };
  };
  try {
    await assert.rejects(updateCardSettings(ctx, { worldBaselinePrompt: 'not-persisted' }), /保存结果不一致/);
    assert.deepEqual(ctx.characters[0].data.extensions, stored.data.extensions);
  } finally { globalThis.fetch = originalFetch; }
});

test('native persistence comparison accepts object-key reordering while retaining array order', async () => {
  const ctx = context(); const originalFetch = globalThis.fetch;
  ctx.getRequestHeaders = () => ({ 'Content-Type': 'application/json' });
  globalThis.fetch = async () => {
    const stored = clone(ctx.characters[0]);
    const map = stored.data.extensions.bs_biotracker.racePhysiologyOverrides;
    stored.data.extensions.bs_biotracker.racePhysiologyOverrides = Object.fromEntries(Object.entries(map).reverse());
    return { ok: true, json: async () => stored };
  };
  try {
    await updateCardSettings(ctx, { racePhysiologyOverrides: { 人类: { breedTolerance: 2 }, 精灵: { breedTolerance: 3 } } });
    assert.equal(getCardSettings(ctx).racePhysiologyOverrides.精灵.breedTolerance, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test('read-only host still applies card settings and imports seeds; groups hide card actions', () => {
  const ctx = context(); delete ctx.writeExtensionField;
  assert.equal(canWriteCardSettings(ctx), false);
  assert.ok(getCardSettings(ctx));
  assert.equal(importCardSkillSeed(ctx, state.getSettings(ctx), state.createEmptyChatState()).created, 1);
  ctx.groupId = 0;
  assert.equal(getCardSettings(ctx), null);
});

for (const kind of ['tauritavern', 'luker']) test(`${kind} sidecar must hydrate before automatic seeding; empty old saves still migrate without seeds`, async () => {
  const ctx = context(); const oldChat = Object.assign(state.createEmptyChatState(), { schemaVersion: 5 });
  delete oldChat.cardSkillSeedApplied;
  if (kind === 'tauritavern') globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(), api: { chat: { current: { handle: () => ({ stableId: async () => 'card-tt-stable', store: { getJson: async () => ({ version: 1, chatState: oldChat }), setJson: async () => {} } }) } } },
  };
  else globalThis.Luker = { getContext: () => ({ ...ctx, getChatState: async () => ({ version: 1, chatState: oldChat }), updateChatState: async () => {} }) };
  try {
    // For Luker the state API is taken from its current context.
    const active = kind === 'luker' ? globalThis.Luker.getContext() : ctx;
    const settings = state.getSettings(active);
    assert.equal(state.getChatState(active, settings).skillCatalog.length, 0);
    await state.hydrateChatStateFromHost(active, settings);
    const chat = state.getChatState(active, settings);
    assert.equal(chat.schemaVersion, 8); assert.equal(chat.cardSkillSeedApplied, true);
    assert.equal(chat.skillCatalog.length, 0);
    assert.equal(getEffectiveSettings(active, settings).chatStates, settings.chatStates);
    assert.equal(buildTrackerPayload(active, settings).world_baseline_prompt, '');
  } finally { delete globalThis.__TAURITAVERN__; delete globalThis.Luker; }
});
