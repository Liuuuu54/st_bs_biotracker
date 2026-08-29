import assert from 'node:assert/strict';
import test from 'node:test';

import * as host from '../scripts/host.js';
import * as state from '../scripts/state.js';
import * as raceConfig from '../scripts/race_config.js';
import * as skillConfig from '../scripts/skill_config.js';
import { getTrackerToolDefinitions, isFailedAutoRetryBlocked } from '../scripts/tracker.js';
import { buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';
import { applyToolCall } from '../scripts/tools.js';
import { applyInitialSkillTalentConfig, applyRegistryChildInheritance, applyRegistrySkillSetup, buildRegistrySkillSystemPrompt, buildRegistrySystemPrompt, buildWardrobePrepSystemPrompt, normalizeBreedingInferenceResult, resolveRegistryChildSource } from '../scripts/registry.js';

function resetGlobals() {
  delete globalThis.__TAURITAVERN__;
  delete globalThis.__TAURITAVERN_MAIN_READY__;
  delete globalThis.Luker;
  delete globalThis.SillyTavern;
  delete globalThis.ST_API;
  delete globalThis.openai_settings;
  delete globalThis.__bsBtWorldInfoModuleOverride__;
  delete globalThis.world_info;
  delete globalThis.world_info_settings;
  delete globalThis.selected_world_info;
  delete globalThis.getCharLorebooks;
  delete globalThis.getLorebookSettings;
  delete globalThis.TavernHelper;
}

test('standard SillyTavern keeps chatStates in extensionSettings', () => {
  resetGlobals();
  const ctx = {
    chatId: 'standard-chat',
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  assert.equal(Object.prototype.propertyIsEnumerable.call(settings, 'chatStates'), true);
  assert.equal(state.getChatKey(ctx), 'standard-chat');
  assert.match(JSON.stringify(settings), /"chatStates"/);
});

test('TauriTavern uses stableId and per-chat store without persisting chatStates globally', async () => {
  resetGlobals();
  let saved = null;
  const handle = {
    stableId: async () => 'stable-chat-42',
    store: {
      getJson: async () => ({
        version: 1,
        chatState: { characters: { Alice: { initialized: true } }, snapshots: [] },
      }),
      setJson: async ({ value }) => { saved = value; },
    },
  };
  const ctx = {
    chatId: 'fallback-chat',
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { chat: { current: { handle: () => handle } } },
  };

  const settings = state.getSettings(ctx);
  assert.equal(Object.prototype.propertyIsEnumerable.call(settings, 'chatStates'), false);
  assert.doesNotMatch(JSON.stringify(settings), /"chatStates"/);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true);
  assert.equal(state.getChatKey(ctx), 'stable-chat-42');
  state.saveSettings(ctx);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(saved?.chatState?.characters?.Alice?.initialized, true);
});

test('Luker uses its chat sidecar without persisting chatStates globally', async () => {
  resetGlobals();
  let saved = null;
  const ctx = {
    chatId: 'luker-chat',
    extensionSettings: {},
    saveSettingsDebounced() {},
    async getChatState(namespace) {
      assert.equal(namespace, 'bs-biotracker');
      return { version: 1, chatState: { characters: { Alice: { initialized: true } }, snapshots: [] } };
    },
    async updateChatState(namespace, updater) {
      assert.equal(namespace, 'bs-biotracker');
      saved = await updater({});
    },
  };
  globalThis.Luker = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  assert.equal(host.getHostKind(), 'luker');
  assert.equal(Object.prototype.propertyIsEnumerable.call(settings, 'chatStates'), false);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true);
  state.saveSettings(ctx);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(saved?.chatState?.characters?.Alice?.initialized, true);
});

test('character additional worldbooks come from charLore for the current character only', async () => {
  resetGlobals();
  const ctx = {
    characterId: 0,
    characters: [{ name: '雪之下 琉璃', avatar: '雪之下 琉璃.png' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__bsBtWorldInfoModuleOverride__ = {
    selected_world_info: ['全局书'],
    world_info: {
      globalSelect: ['全局书'],
      charLore: [
        { name: '雪之下 琉璃', extraBooks: ['性格适配衣橱', '性格适配衣橱', ' '] },
        { name: '别的角色', extraBooks: ['别人的书'] },
      ],
    },
  };
  assert.deepEqual(await state.getCharacterAdditionalWorldBookNames(ctx), ['性格适配衣橱']);
  assert.deepEqual(await state.getActiveGlobalWorldBookNames(), ['全局书']);
  resetGlobals();
});

test('world-info fallbacks cover TavernHelper and settings globals when module import fails', async () => {
  resetGlobals();
  const ctx = {
    characterId: 0,
    characters: [{ name: '艾拉', avatar: 'aila.png' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__bsBtWorldInfoModuleOverride__ = null; // 模组 import 失败（酒馆助手 iframe 注入场景）
  globalThis.world_info = { globalSelect: ['设置里的全局书'], charLore: [{ name: 'aila', extraBooks: ['设置里的附加书'] }] };
  globalThis.TavernHelper = {
    getLorebookSettings: async () => ({ selected_global_lorebooks: ['助手全局书'] }),
    getCharLorebooks: async () => ({ additional: ['助手附加书'] }),
  };
  assert.deepEqual(await state.getActiveGlobalWorldBookNames(), ['设置里的全局书', '助手全局书']);
  assert.deepEqual(await state.getCharacterAdditionalWorldBookNames(ctx), ['助手附加书', '设置里的附加书']);
  resetGlobals();
});

test('skill-ized worldbook comments collapse to their title line and keep matching', () => {
  const skillComment = '战斗隐奸侵扰\n\n<!-- ACU_SKILL_META_START\n{"version":1,"description":"..."}\n-->';
  assert.equal(state.sanitizeWorldbookEntryDisplayName(skillComment), '战斗隐奸侵扰');
  assert.equal(state.getWorldbookEntryDisplayName({ comment: skillComment }), '战斗隐奸侵扰');
  const selected = new Set(['战斗隐奸侵扰']);
  assert.equal(state.worldbookSelectionMatches(selected, '数据库 :: 战斗隐奸侵扰', '战斗隐奸侵扰'), true);
  const selectedFull = new Set(['数据库 :: 战斗隐奸侵扰']);
  assert.equal(state.worldbookSelectionMatches(selectedFull, '数据库 :: 战斗隐奸侵扰', '战斗隐奸侵扰'), true);
  assert.equal(state.worldbookSelectionMatches(selectedFull, '别的书 :: 战斗隐奸侵扰', '别的名字'), false);
});

test('TauriTavern chat state load caches Not-found results and dedupes concurrent probes', async () => {
  resetGlobals();
  let getJsonCalls = 0;
  let saved = null;
  const handle = {
    stableId: async () => 'stable-missing-chat',
    store: {
      getJson: async () => {
        getJsonCalls += 1;
        throw new Error('Not found: Chat store entry not found: some/path/chat-state-v1.json');
      },
      setJson: async ({ value }) => { saved = value; },
    },
  };
  const ctx = { chatId: 'fallback-missing', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { chat: { current: { handle: () => handle } } },
  };

  const [first, second] = await Promise.all([host.loadHostChatState(ctx), host.loadHostChatState(ctx)]);
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(getJsonCalls, 1, 'concurrent probes collapse into a single store read');
  assert.equal(await host.loadHostChatState(ctx), null);
  assert.equal(getJsonCalls, 1, 'known-missing chats are not probed again');

  await host.resolveHostChatId(ctx);
  host.scheduleHostChatStateSave(ctx, { characters: {}, snapshots: [] });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(saved?.version, 1);
  await host.loadHostChatState(ctx);
  assert.equal(getJsonCalls, 2, 'saving clears the known-missing marker so state is probed again');
});

test('TauriTavern agent barrier waits for completed runs', async () => {
  resetGlobals();
  let events = [{ type: 'model_completed' }];
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { agent: { readEvents: async ({ runId }) => { assert.equal(runId, 'agent-1'); return { events }; } } },
  };
  const message = { extra: { tauritavern: { agent: { runId: 'agent-1' } } } };
  assert.equal((await host.getHostAgentRunBarrier({}, message)).state, 'pending');
  events = [{ type: 'chat_commit_completed' }, { type: 'run_completed' }];
  assert.equal((await host.getHostAgentRunBarrier({}, message)).state, 'completed');
  events = [{ type: 'run_failed' }];
  assert.equal((await host.getHostAgentRunBarrier({}, message)).state, 'aborted');
});

test('TauriTavern history view preserves absolute message indexes', async () => {
  resetGlobals();
  const messages = Array.from({ length: 450 }, (_, index) => ({ mes: `m${index}` }));
  const makePage = (start, end) => ({
    startIndex: start,
    totalCount: messages.length,
    messages: messages.slice(start, end),
    cursor: start,
    hasMoreBefore: start > 0,
  });
  const handle = {
    history: {
      tail: async ({ limit }) => makePage(Math.max(0, messages.length - limit), messages.length),
      before: async (page, { limit }) => makePage(Math.max(0, page.startIndex - limit), page.startIndex),
    },
  };
  const ctx = { chatId: 'history-chat', chat: messages.slice(-20) };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: {
      chat: {
        current: {
          windowInfo: async () => ({ totalCount: messages.length }),
          handle: () => handle,
        },
      },
    },
  };

  const view = await host.refreshHostChatView(ctx, { resumeIndexes: [300], contextSize: 12 });
  assert.equal(view.length, 450);
  assert.equal(view[288]?.mes, 'm288');
  assert.equal(view[449]?.mes, 'm449');
  assert.equal(view[287], undefined);
});

test('host facades preserve API receivers and replace event subscriptions', async () => {
  resetGlobals();
  const listeners = new Map();
  globalThis.ST_API = {
    worldBook: {
      marker: 'worldbook',
      async get({ name }) {
        assert.equal(this.marker, 'worldbook');
        return { worldBook: { name } };
      },
    },
    preset: {
      marker: 'preset',
      async list() {
        assert.equal(this.marker, 'preset');
        return { presets: [] };
      },
      async get({ name }) {
        assert.equal(this.marker, 'preset');
        return { preset: { name } };
      },
    },
  };
  const ctx = {
    event_types: { CHAT_CHANGED: 'chat-changed' },
    eventSource: {
      on(type, handler) { listeners.set(type, handler); },
      off(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
    },
  };

  assert.equal((await host.getHostWorldBook('book'))?.name, 'book');
  assert.equal((await host.getHostPreset('preset'))?.name, 'preset');
  await host.listHostPresets();
  let count = 0;
  let unsubscribe = host.replaceHostEventSubscription(ctx, 'chatChanged', null, () => { count += 1; });
  listeners.get('chat-changed')();
  unsubscribe = host.replaceHostEventSubscription(ctx, 'chatChanged', unsubscribe, () => { count += 10; });
  listeners.get('chat-changed')();
  unsubscribe();
  assert.equal(count, 11);
  assert.equal(listeners.has('chat-changed'), false);
});

test('failed automatic request is blocked only for the same last message', () => {
  resetGlobals();
  const ctx = {
    chatId: 'retry-chat',
    chat: [{ is_user: false, name: 'Alice', mes: 'first reply' }],
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.createEmptyChatState();
  chatState.lastFailedSignature = state.buildSignature(ctx, ctx.chat.length);
  assert.equal(isFailedAutoRetryBlocked(ctx, chatState), true);
  ctx.chat.push({ is_user: false, name: 'Alice', mes: 'new reply' });
  assert.equal(isFailedAutoRetryBlocked(ctx, chatState), false);
});

test('chat state counting ignores empty stored keys', () => {
  assert.equal(state.isChatStateEffectivelyEmpty(state.createEmptyChatState()), true);
  const populated = state.createEmptyChatState();
  populated.characters.Alice = { initialized: true };
  assert.equal(state.isChatStateEffectivelyEmpty(populated), false);
});

test('tracker token budget defaults to 4096 and is clamped', () => {
  resetGlobals();
  const ctx = { chatId: 'token-budget', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  assert.equal(settings.trackerTokenBudget, 4096);
  settings.trackerTokenBudget = 999999;
  assert.equal(state.getSettings(ctx).trackerTokenBudget, 100000);
  assert.equal(settings.requireFullDescriptionUpdates, false);
  assert.equal(settings.lukerMultiAgentManualOnly, true);
});

test('full description update mode adds the strict tracker instruction', () => {
  const prompt = buildTrackerSystemPrompt('', null, { require_full_description_updates: true });
  assert.equal(prompt.includes('[descriptions 完整更新模式：强制提示约束]'), true);
  assert.equal(prompt.includes('所有既有子字段'), true);
});

test('wardrobe preparation treats upper and lower garments as one main outfit', () => {
  const prompt = buildWardrobePrepSystemPrompt({}, { wardrobePrepMainCount: 3, wardrobePrepAccessoryCount: 2 });
  assert.equal(prompt.includes('完整套装，不是单件'), true);
  assert.equal(prompt.includes('把上衣与下着合并为同一个 main'), true);
});

test('psychology tool is hidden until a character has breeding stage profiles', () => {
  const settings = { diaryRecentLimit: 0 };
  const hidden = getTrackerToolDefinitions(settings, {
    Alice: { profile: { psychology: { stageProfiles: {} } } },
  });
  assert.equal(hidden.some((tool) => tool.name === 'bsUpdatePsychology'), false);
  const visible = getTrackerToolDefinitions(settings, {
    Alice: { profile: { psychology: { stageProfiles: { mens: { mastery: { 0: '自定义表现' } } } } } },
  });
  assert.equal(visible.some((tool) => tool.name === 'bsUpdatePsychology'), true);
});

test('tracker prompt omits psychology guidance when no breeding inference exists', () => {
  const prompt = buildTrackerSystemPrompt('', null, {
    diary_enabled: true,
    wardrobe_enabled: false,
    breeding_psychology_enabled: false,
  });
  assert.equal(prompt.includes('[psychology]'), false);
  assert.equal(prompt.includes('bsUpdatePsychology'), false);
});

test('wardrobe and psychology tools reject targets without their opt-in state', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  assert.equal(applyToolCall(chatState, {
    name: 'bsAddWardrobeItem',
    arguments: { female: 'Alice', item: { id: 1, name: '外套', note: '黑色外套', slot: 'main', masking: 1, support: 0, capacity: 1, convenience: 1 } },
  }).applied, false);
  assert.equal(applyToolCall(chatState, {
    name: 'bsUpdatePsychology',
    arguments: { female: 'Alice', options: { mens: { mastery: 1 } } },
  }).applied, false);
});

test('the first description update can initialize a blank registered field', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  chatState.characters.Alice.initialized = true;
  const result = applyToolCall(chatState, {
    name: 'bsSetDescription',
    arguments: { female: 'Alice', options: { pregnantDescription: '胎况|已着床，等待后续观察;;' } },
  });
  assert.equal(result.applied, true);
  assert.equal(chatState.characters.Alice.profile.descriptions.pregnantDescription, '胎况|已着床，等待后续观察;;');
});

test('breeding inference accepts psychology-wrapped stage profiles', () => {
  const stageProfiles = { mens: { mastery: { 0: '自定义表现' } } };
  const normalized = normalizeBreedingInferenceResult({
    profile: { psychology: { mens: { mastery_value: 42 }, stageProfiles } },
  });
  assert.equal(normalized.mens.mastery_value, 42);
  assert.equal(normalized.stageProfiles, stageProfiles);
});

test('registry prompt delegates diary writing to the dedicated diary flow', () => {
  const prompt = buildRegistrySystemPrompt({}, { includeBreedingPsychology: false });
  assert.equal(prompt.includes('首篇日记'), false);
  assert.equal(prompt.includes('"diary"'), false);
});

test('skill and talent curves use square requirements and stop at level 10', () => {
  assert.equal(skillConfig.requiredExp(1), 100);
  assert.equal(skillConfig.requiredExp(2), 400);
  assert.equal(skillConfig.requiredExp(9), 8100);
  assert.deepEqual(skillConfig.addSkillExperience({ skillId: 1, level: 1, exp: 0 }, 500), { skillId: 1, level: 3, exp: 0 });
  assert.deepEqual(skillConfig.addSkillExperience({ skillId: 1, level: 9, exp: 0 }, 999999), { skillId: 1, level: 10, exp: 0 });
  assert.deepEqual(skillConfig.addTalentExperience({ skillId: 1, level: 0, exp: 0 }, 100), { skillId: 1, level: 1, exp: 0 });
  assert.deepEqual(skillConfig.addTalentExperience({ skillId: 1, level: 1, exp: 50 }, -200), { skillId: 1, level: 0, exp: -50 });
  assert.deepEqual(skillConfig.addTalentExperience({ skillId: 1, level: 0, exp: -50 }, 150), { skillId: 1, level: 1, exp: 0 });
  const removed = skillConfig.removeSkillDefinition([
    { id: 1, name: '剑术', description: '剑的运用。' },
    { id: 2, name: '弓术', description: '弓的运用。' },
  ], '剑术');
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.catalog, [{ id: 2, name: '弓术', description: '弓的运用。' }]);
  let history = [];
  for (let index = 0; index < 105; index += 1) {
    history = skillConfig.appendSkillHistory(history, {
      skillId: 1, fromLevel: 0, toLevel: 1, reason: `事件 ${index}`, source: 'story', timestamp: index,
    });
  }
  assert.equal(history.length, 100);
  assert.equal(history[0].reason, '事件 5');
});

test('LLM must register a described global skill before awakening and training it', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  assert.equal(applyToolCall(chatState, {
    name: 'bsRegisterSkillDefinition', arguments: { name: '剑术', description: '' },
  }).applied, false);
  assert.equal(applyToolCall(chatState, {
    name: 'bsRegisterSkillDefinition', arguments: { name: '剑术', description: '以长剑攻防的实战技巧。' },
  }).applied, true);
  const result = applyToolCall(chatState, {
    name: 'bsTrainSkill',
    arguments: {
      female: 'Alice',
      skill: '剑术',
      skillExp: 500,
      awaken: true,
      reason: '连续完成基础挥剑与一次实战格挡。',
    },
  });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(chatState.skillCatalog, [{ id: 1, name: '剑术', description: '以长剑攻防的实战技巧。' }]);
  assert.deepEqual(chatState.characters.Alice.profile.skills[0], { skillId: 1, level: 3, exp: 0 });
  assert.deepEqual(result.notify, {
    type: 'skill_awakened', female: 'Alice', skillId: 1, skillName: '剑术', fromLevel: 0, toLevel: 3,
    awakened: true, text: 'Alice觉醒了技能「剑术」，并提升至 Lv3',
  });
  assert.deepEqual(chatState.characters.Alice.profile.skillHistory.map(({ timestamp, ...entry }) => entry), [{
    skillId: 1, fromLevel: 0, toLevel: 3, reason: '连续完成基础挥剑与一次实战格挡。', source: 'story',
  }]);
  assert.equal(Number.isInteger(chatState.characters.Alice.profile.skillHistory[0].timestamp), true);
  assert.equal(state.summarizeOperationLogs([{ name: 'bsTrainSkill', applied: true, message: 'ok', notify: result.notify }])[0].notify.text, result.notify.text);
  const noLevel = applyToolCall(chatState, {
    name: 'bsTrainSkill', arguments: { female: 'Alice', skill: '剑术', skillExp: 1, reason: '短暂复习基本架势。' },
  });
  assert.equal(noLevel.notify, undefined);
  assert.equal(chatState.characters.Alice.profile.skillHistory.length, 1);
});

test('registry skill prompt reuses catalog and atomically creates described missing skills', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  chatState.skillCatalog = [{ id: 1, name: '剑术', description: '以剑进行攻防的技巧。' }];
  chatState.nextSkillId = 2;
  const character = applyRegistrySkillSetup(chatState, 'Alice', {
    skillDefinitions: [{ name: '魔力感知', description: '感知周遭魔力流动与异常的能力。' }],
    initialSkills: [{ skill: '剑术', level: 2, exp: 10 }],
    initialTalents: [{ skill: '魔力感知', level: -1, exp: 20 }],
  });
  assert.deepEqual(chatState.skillCatalog.map(({ id, name }) => ({ id, name })), [
    { id: 1, name: '剑术' },
    { id: 2, name: '魔力感知' },
  ]);
  assert.equal(chatState.nextSkillId, 3);
  assert.deepEqual(character.profile.skills, [{ skillId: 1, level: 2, exp: 10 }]);
  assert.deepEqual(character.profile.talents, [{ skillId: 2, level: -1, exp: -20 }]);
  assert.deepEqual(character.profile.skillHistory, []);

  const before = JSON.stringify(chatState);
  assert.throws(() => applyRegistrySkillSetup(chatState, 'Alice', {
    skillDefinitions: [{ name: '无描述技能', description: '' }],
    initialSkills: [{ skill: '无描述技能', level: 1, exp: 0 }],
  }), /必须填写定义描述/);
  assert.equal(JSON.stringify(chatState), before);
});

test('dedicated registry skill prompt requires catalog reuse and described new definitions', () => {
  const prompt = buildRegistrySkillSystemPrompt({ skillPrompt: '她擅长剑术。' });
  assert.match(prompt, /payload\.skill_catalog/);
  assert.match(prompt, /不得用近义词建立重复技能/);
  assert.match(prompt, /每个新定义必须同时提供 name 与明确说明技能范围的 description/);
  assert.match(prompt, /initialSkills/);
  assert.match(prompt, /initialTalents/);
});

test('skill ids are never reused and snapshots restore catalog plus allocator', () => {
  resetGlobals();
  const chatState = state.createEmptyChatState();
  applyToolCall(chatState, { name: 'bsRegisterSkillDefinition', arguments: { name: '剑术', description: '剑的运用。' } });
  applyToolCall(chatState, { name: 'bsRegisterSkillDefinition', arguments: { name: '弓术', description: '弓的运用。' } });
  const removed = skillConfig.removeSkillDefinition(chatState.skillCatalog, 2);
  chatState.skillCatalog = removed.catalog;
  assert.equal(chatState.nextSkillId, 3);
  applyToolCall(chatState, { name: 'bsRegisterSkillDefinition', arguments: { name: '枪术', description: '长枪的运用。' } });
  assert.deepEqual(chatState.skillCatalog.map((item) => item.id), [1, 3]);
  assert.equal(chatState.nextSkillId, 4);

  const ctx = { chatId: 'snapshot-skill-test', chat: [] };
  state.recordChatStateSnapshot(ctx, chatState, { reason: 'skill_snapshot' });
  const snapshot = chatState.snapshots.at(-1);
  chatState.skillCatalog = [{ id: 99, name: '错误定义', description: '不应保留。' }];
  chatState.nextSkillId = 100;
  state.restoreChatStateFromSnapshot(chatState, snapshot);
  assert.deepEqual(chatState.skillCatalog.map((item) => item.id), [1, 3]);
  assert.equal(chatState.nextSkillId, 4);
});

test('middle-pregnancy training passes talent to one randomly selected fetus through childbirth', () => {
  const chatState = state.createEmptyChatState();
  applyToolCall(chatState, {
    name: 'bsRegisterSkillDefinition', arguments: { name: '魔力感知', description: '辨识周遭魔力流动。' },
  });
  const mother = state.createDefaultFemaleState('Alice');
  mother.initialized = true;
  mother.profile.base.stage = '孕中期';
  mother.profile.pregnant.fetuses = [
    { fathers: 'Bob', provider: null, race: '人类', gender: '女', embryoType: '胎生', weight: 1.25, affinity: 50 },
    { fathers: 'Bob', provider: null, race: '人类', gender: '男', embryoType: '胎生', affinity: -25 },
    { fathers: 'Bob', provider: null, race: '人类', gender: '女', embryoType: '胎生', affinity: 0 },
  ];
  mother.profile.pregnant.fetusesCount = 3;
  chatState.characters.Alice = mother;

  const originalRandom = Math.random;
  let trained;
  try {
    Math.random = () => 0;
    trained = applyToolCall(chatState, {
      name: 'bsTrainSkill',
      arguments: {
        female: 'Alice',
        skill: '魔力感知',
        skillExp: 200,
        awaken: true,
        reason: '在胎教仪式中反复引导魔力共鸣。',
      },
    });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(trained.applied, true, trained.message);
  const fetuses = chatState.characters.Alice.profile.pregnant.fetuses;
  assert.deepEqual(fetuses[0].talents[0], { skillId: 1, level: 2, exp: 0 });
  assert.equal(fetuses[1].talents, undefined);
  assert.deepEqual(fetuses[2].talents, undefined);

  assert.equal(applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'Alice' } }).applied, true);
  assert.deepEqual(chatState.characters.Alice.profile.children[0].talents[0], { skillId: 1, level: 2, exp: 0 });
  assert.equal(chatState.characters.Alice.profile.children[0].birthWeightRatio, 1.25);
  assert.equal(chatState.characters.Alice.profile.children[0].birthAffinity, 50);
  assert.equal(applyToolCall(chatState, {
    name: 'bsNameChild', arguments: { female: 'Alice', childIndex: 0, name: '莉亚' },
  }).applied, true);
  chatState.characters['莉亚'] = state.createDefaultFemaleState('莉亚');
  const registered = applyInitialSkillTalentConfig(chatState, '莉亚', {
    skills: [], talents: [{ skill: '魔力感知', level: 2, exp: 0 }],
  });
  assert.deepEqual(registered.profile.talents, [{ skillId: 1, level: 2, exp: 0 }]);
  assert.deepEqual(registered.profile.skills, []);
});

test('child registration source fixes race, inherits talents and prevents duplicate selection', () => {
  const chatState = state.createEmptyChatState();
  chatState.skillCatalog = [{ id: 1, name: '魔力感知', description: '辨识魔力流动。' }];
  const mother = state.createDefaultFemaleState('Alice');
  mother.profile.children = [{
    name: '莉亚', fathers: 'Bob', gender: '女', race: '精灵混血', derivedType: '魔女', age: 18,
    birthWeightRatio: 1.12, birthAffinity: 30, talents: [{ skillId: 1, level: 2, exp: 40 }],
  }];
  chatState.characters.Alice = mother;
  chatState.characters['莉亚'] = state.createDefaultFemaleState('莉亚');
  chatState.characters['莉亚'].profile.base.race = '错误种族';
  const source = { motherName: 'Alice', childIndex: 0 };
  assert.equal(resolveRegistryChildSource(chatState, source)?.child?.birthAffinity, 30);
  const result = applyRegistryChildInheritance(chatState, '莉亚', source);
  assert.equal(result.character.profile.base.race, '精灵混血');
  assert.equal(result.character.profile.base.derivedType, '魔女');
  assert.deepEqual(result.character.profile.talents, [{ skillId: 1, level: 2, exp: 40 }]);
  assert.deepEqual(result.character.profile.childSource, {
    motherName: 'Alice',
    childIndex: 0,
    inheritedTalents: [{ skillId: 1, level: 2, exp: 40 }],
  });
  assert.equal(mother.profile.children[0].registeredAs, '莉亚');
  const skillSetup = applyRegistrySkillSetup(chatState, '莉亚', {
    skillDefinitions: [], initialSkills: [], initialTalents: [{ skill: '魔力感知', level: -5, exp: -10 }],
  });
  assert.deepEqual(skillSetup.profile.talents, [{ skillId: 1, level: 2, exp: 40 }]);
  delete chatState.characters.Alice;
  const setupAfterSourceRemoval = applyRegistrySkillSetup(chatState, '莉亚', {
    skillDefinitions: [], initialSkills: [], initialTalents: [{ skill: '魔力感知', level: -5, exp: -10 }],
  });
  assert.deepEqual(
    setupAfterSourceRemoval.profile.talents,
    [{ skillId: 1, level: 2, exp: 40 }],
    'the registered child keeps its birth talent snapshot after the mother record is removed',
  );
  delete setupAfterSourceRemoval.profile.childSource.inheritedTalents;
  const migratedLegacySetup = applyRegistrySkillSetup(chatState, '莉亚', {
    skillDefinitions: [], initialSkills: [], initialTalents: [],
  });
  assert.deepEqual(
    migratedLegacySetup.profile.childSource.inheritedTalents,
    [{ skillId: 1, level: 2, exp: 40 }],
    'legacy child sources migrate the character current talents when the mother record is already missing',
  );
  assert.deepEqual(migratedLegacySetup.profile.talents, [{ skillId: 1, level: 2, exp: 40 }]);
  assert.match(buildRegistrySkillSystemPrompt({ inheritedTalentsLocked: true }), /固定继承内容/);
  assert.match(buildRegistrySystemPrompt({}, {
    declaredRace: '[魔女]精灵混血',
    payload: { source_child: { ...mother.profile.children[0] } },
  }), /固定事实[\s\S]*?确定性继承/);
});

test('fetal talent transfer uses the complete allowed-stage boundary and affinity rounding', () => {
  const allowedStages = ['孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '第一产程'];
  const blockedStages = ['卵泡期', '孕早期', '第二产程', '第三产程', '产后恢复'];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.999999;
    for (const [stage, shouldTransfer] of [...allowedStages.map((value) => [value, true]), ...blockedStages.map((value) => [value, false])]) {
      const chatState = state.createEmptyChatState();
      applyToolCall(chatState, { name: 'bsRegisterSkillDefinition', arguments: { name: '共鸣', description: '维持稳定共鸣的能力。' } });
      const character = state.createDefaultFemaleState('Alice');
      character.profile.base.stage = stage;
      character.profile.skills = [{ skillId: 1, level: 1, exp: 0 }];
      character.profile.pregnant.fetuses = [{ affinity: 25, talents: [] }, { affinity: -25, talents: [] }];
      chatState.characters.Alice = character;
      const result = applyToolCall(chatState, {
        name: 'bsTrainSkill', arguments: { female: 'Alice', skill: '共鸣', skillExp: 101, reason: `${stage}边界测试。` },
      });
      assert.equal(result.applied, true, `${stage}: ${result.message}`);
      const [positive, negative] = chatState.characters.Alice.profile.pregnant.fetuses;
      assert.deepEqual(positive.talents, [], stage);
      if (shouldTransfer) {
        assert.deepEqual(negative.talents, [{ skillId: 1, level: 0, exp: -51 }], stage);
        assert.match(result.message, /fetus #2 selected, inherited EXP -51/, stage);
      } else {
        assert.deepEqual(negative.talents, [], stage);
      }
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('LLM tools cannot change character talents while fetal transfer includes first labor and stops at second labor', () => {
  const chatState = state.createEmptyChatState();
  applyToolCall(chatState, { name: 'bsRegisterSkillDefinition', arguments: { name: '忍耐', description: '承受压力并维持行动。' } });
  const character = state.createDefaultFemaleState('Alice');
  character.profile.base.stage = '第一产程';
  character.profile.skills = [{ skillId: 1, level: 1, exp: 0 }];
  character.profile.talents = [{ skillId: 1, level: -1, exp: -50 }];
  character.profile.pregnant.fetuses = [{ affinity: 50, talents: [] }];
  chatState.characters.Alice = character;
  const blocked = applyToolCall(chatState, {
    name: 'bsTrainSkill', arguments: { female: 'Alice', skill: '忍耐', skillExp: 100, talentExp: 200, reason: '在压力下克服原有苦手。' },
  });
  assert.equal(blocked.applied, false);
  assert.match(blocked.message, /talents are read-only/);
  assert.deepEqual(chatState.characters.Alice.profile.talents[0], { skillId: 1, level: -1, exp: -50 });
  assert.deepEqual(chatState.characters.Alice.profile.pregnant.fetuses[0].talents, []);

  assert.equal(applyToolCall(chatState, {
    name: 'bsTrainSkill', arguments: { female: 'Alice', skill: '忍耐', skillExp: 100, reason: '在第一产程中持续承受压力。' },
  }).applied, true);
  assert.deepEqual(chatState.characters.Alice.profile.talents[0], { skillId: 1, level: -1, exp: -50 });
  assert.deepEqual(chatState.characters.Alice.profile.pregnant.fetuses[0].talents, [{ skillId: 1, level: 1, exp: 0 }]);

  chatState.characters.Alice.profile.base.stage = '第二产程';
  assert.equal(applyToolCall(chatState, {
    name: 'bsTrainSkill', arguments: { female: 'Alice', skill: '忍耐', skillExp: 100, reason: '继续承受第二产程压力。' },
  }).applied, true);
  assert.deepEqual(chatState.characters.Alice.profile.pregnant.fetuses[0].talents, [{ skillId: 1, level: 1, exp: 0 }]);
});

test('skill tool and inheritance guidance are always available to tracker', () => {
  const definitions = getTrackerToolDefinitions({ diaryRecentLimit: 0 }, {});
  const trainSkillTool = definitions.find((tool) => tool.name === 'bsTrainSkill');
  assert.ok(trainSkillTool);
  assert.equal(Object.hasOwn(trainSkillTool.input_schema.properties, 'talentExp'), false);
  assert.equal(definitions.some((tool) => tool.name === 'bsRegisterSkillDefinition'), true);
  const prompt = buildTrackerSystemPrompt('', null, {});
  assert.equal(prompt.includes('[skills / talents]'), true);
  assert.equal(prompt.includes('第二与第三产程禁止传递'), true);
});

test('derived type overrides affect base types and custom subtypes', () => {
  raceConfig.setDerivedTypeOverrides({
    不死: {
      introductionLine: '亡者衍生类型的简短说明。',
      fluxDefinition: '自定义描述',
      inheritanceSpeed: 3.5,
      metabolismExemptions: ['hunger', 'sleep'],
    },
  });
  assert.equal(raceConfig.getDerivedTypeFluxProfile('不死-僵尸').fluxName, '死气');
  assert.equal(raceConfig.getDerivedTypeIntroductionLine('不死-僵尸'), '亡者衍生类型的简短说明。');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('不死').fluxDefinition, '自定义描述');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('不死-僵尸').inheritanceSpeed, 3.5);
  assert.deepEqual(raceConfig.getDerivedTypeMetabolismExemptions('不死'), ['odor', 'sleep', 'milk']);
  assert.equal(raceConfig.getDerivedTypeOverride('不死-僵尸').metabolismExemptions, undefined);
  raceConfig.setDerivedTypeOverrides({});
  assert.equal(raceConfig.getDerivedTypeFluxProfile('不死').fluxName, '死气');
  // 清掉覆写后回落到内建短敘述（此前衍生类型没有内建值，一律为空）
  assert.equal(raceConfig.getDerivedTypeIntroductionLine('不死'), 'Undead，以死气驱动躯壳的亡者，保留生前记忆但情感淡漠。');
});

test('an unhydrated blank state never overwrites an existing TauriTavern sidecar', async () => {
  resetGlobals();
  const writes = [];
  const handle = {
    stableId: async () => 'stable-chat-guard',
    store: {
      // store 尚未就绪：hydrate 拿不到内容（既不是 not-found，也读不到资料）
      getJson: async () => { throw new Error('Chat store is not ready yet'); },
      setJson: async ({ value }) => { writes.push(value); },
    },
  };
  const ctx = { chatId: 'fallback-guard', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: { current: { handle: () => handle } } } };

  const settings = state.getSettings(ctx);
  // hydrate 失败 → 内存里只会是一份刚建出来的空状态
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), false);
  state.getChatState(ctx, settings);
  state.saveSettings(ctx);
  await new Promise((resolve) => setTimeout(resolve, 350));

  // 关键：一次 setJson 都不能发生，否则真实注册资料就被空状态洗掉了
  assert.deepEqual(writes, [], '未确认存档内容前不得写入空状态');
});

test('a blank state may be persisted once the sidecar content is confirmed', async () => {
  resetGlobals();
  const writes = [];
  const handle = {
    stableId: async () => 'stable-chat-confirmed',
    store: {
      // 确认这个聊天没有存档
      getJson: async () => { throw new Error('Not found: Chat store entry not found'); },
      setJson: async ({ value }) => { writes.push(value); },
    },
  };
  const ctx = { chatId: 'fallback-confirmed', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: { current: { handle: () => handle } } } };

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), false);
  state.getChatState(ctx, settings);
  state.saveSettings(ctx);
  await new Promise((resolve) => setTimeout(resolve, 350));

  // 已确认没有存档 → 写空无害，使用者主动「清除」也才能落盘
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].chatState.characters, {});
});

test('real registration data still saves normally while unhydrated', async () => {
  resetGlobals();
  const writes = [];
  const handle = {
    stableId: async () => 'stable-chat-nonblank',
    store: {
      getJson: async () => { throw new Error('Chat store is not ready yet'); },
      setJson: async ({ value }) => { writes.push(value); },
    },
  };
  const ctx = { chatId: 'fallback-nonblank', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: { current: { handle: () => handle } } } };

  const settings = state.getSettings(ctx);
  await state.hydrateChatStateFromHost(ctx, settings);
  const chatState = state.getChatState(ctx, settings);
  chatState.characters.Alice = { name: 'Alice', initialized: true };
  state.saveSettings(ctx);
  await new Promise((resolve) => setTimeout(resolve, 350));

  // 守卫只挡空状态，有资料照写不误
  assert.equal(writes.length, 1);
  assert.equal(writes[0].chatState.characters.Alice.initialized, true);
});

test('a chat store handle that appears late is waited for instead of read as missing', async () => {
  resetGlobals();
  let handle = null;
  const ctx = { chatId: 'fallback-late', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    // 重开存档时常见：主体已 ready，但该聊天的 handle 稍后才挂上
    api: { chat: { current: { handle: () => handle } } },
  };
  setTimeout(() => {
    handle = {
      stableId: async () => 'stable-chat-late',
      store: {
        getJson: async () => ({
          version: 1,
          chatState: { characters: { Alice: { initialized: true } }, snapshots: [] },
        }),
        setJson: async () => {},
      },
    };
  }, 300);

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true, '应等到句柄就绪并载入资料');
  assert.equal(host.isHostChatStateConfirmed(ctx), true);
  assert.equal(settings.chatStates['stable-chat-late'].characters.Alice.initialized, true);
});

test('an unreadable store leaves the chat unconfirmed so callers retry', async () => {
  resetGlobals();
  const handle = {
    stableId: async () => 'stable-chat-unreadable',
    store: {
      getJson: async () => { throw new Error('Chat store is not ready yet'); },
      setJson: async () => {},
    },
  };
  const ctx = { chatId: 'fallback-unreadable', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: { current: { handle: () => handle } } } };

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), false);
  // 读取失败 ≠ 确认没有存档；未确认才能让上层安排重试而不是画成「没有注册角色」
  assert.equal(host.isHostChatStateConfirmed(ctx), false);
});

test('native SillyTavern is always confirmed and never waits on a sidecar', async () => {
  resetGlobals();
  const ctx = { chatId: 'native-chat', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  assert.equal(host.getHostKind(), 'sillytavern');
  assert.equal(host.isHostChatStateConfirmed(ctx), true);
  assert.equal(await host.loadHostChatState(ctx), null);
});

function installTauriHostWithStore(store, stableId) {
  const handle = { stableId: async () => stableId, store };
  const ctx = { chatId: `${stableId}-fallback`, extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { chat: { current: { handle: () => handle } } },
  };
  return ctx;
}

test('a listable store skips the probe entirely when the sidecar is absent', async () => {
  resetGlobals();
  let getJsonCalls = 0;
  const ctx = installTauriHostWithStore({
    listKeys: async () => ({ keys: ['some-other-key'] }),
    getJson: async () => { getJsonCalls += 1; throw new Error('Not found: Chat store entry not found'); },
    setJson: async () => {},
  }, 'stable-listable-missing');

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), false);
  // 关键：确认不存在就不该再读，宿主才不会弹那个吓人的后端错误
  assert.equal(getJsonCalls, 0, '已知不存在时不应触发 getJson');
  assert.equal(host.isHostChatStateConfirmed(ctx), true, '确认过不存在，之后写空才安全');
});

test('a listable store still reads through when the sidecar is present', async () => {
  resetGlobals();
  let getJsonCalls = 0;
  const ctx = installTauriHostWithStore({
    listKeys: async () => ['chat-state-v1'],
    getJson: async () => {
      getJsonCalls += 1;
      return { version: 1, chatState: { characters: { Alice: { initialized: true } }, snapshots: [] } };
    },
    setJson: async () => {},
  }, 'stable-listable-present');

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true);
  assert.equal(getJsonCalls, 1);
  assert.equal(settings.chatStates['stable-listable-present'].characters.Alice.initialized, true);
});

test('a store without any list method falls back to the original read path', async () => {
  resetGlobals();
  let getJsonCalls = 0;
  const ctx = installTauriHostWithStore({
    // 没有任何列举方法：行为必须与加入这项优化之前完全一致
    getJson: async () => {
      getJsonCalls += 1;
      return { version: 1, chatState: { characters: { Bob: { initialized: true } }, snapshots: [] } };
    },
    setJson: async () => {},
  }, 'stable-no-lister');

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true);
  assert.equal(getJsonCalls, 1, '无从检查时仍要照常读取');
});

test('a failing list method degrades to the original read path', async () => {
  resetGlobals();
  let getJsonCalls = 0;
  const ctx = installTauriHostWithStore({
    listKeys: async () => { throw new Error('list unsupported'); },
    getJson: async () => {
      getJsonCalls += 1;
      return { version: 1, chatState: { characters: { Carol: { initialized: true } }, snapshots: [] } };
    },
    setJson: async () => {},
  }, 'stable-broken-lister');

  const settings = state.getSettings(ctx);
  assert.equal(await state.hydrateChatStateFromHost(ctx, settings), true);
  assert.equal(getJsonCalls, 1, '列举失败不得让载入跟着失败');
});
