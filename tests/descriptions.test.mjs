// 描述欄位結構化：存档阵列、模型物件、逐字段合并、过期点名与 v7 → v8 迁移。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import {
  UNSORTED_DESCRIPTION_NAME,
  applyDescriptionPatch,
  descriptionListToObject,
  getStaleDescriptionFields,
  normalizeDescriptionList,
} from '../scripts/descriptions.js';

test('旧字串转阵列：内容可含 |，切不出字段名的段落收进「未分类」', () => {
  assert.deepEqual(normalizeDescriptionList('状态|疲惫;;表情|皱眉|咬唇;;随手写的一段;;', 60), [
    { name: '状态', value: '疲惫', updatedAt: 60 },
    { name: '表情', value: '皱眉|咬唇', updatedAt: 60 },
    { name: UNSORTED_DESCRIPTION_NAME, value: '随手写的一段', updatedAt: 60 },
  ]);
  assert.deepEqual(normalizeDescriptionList(''), []);
  assert.deepEqual(normalizeDescriptionList({ 状态: '好', 表情: '笑' }, 5).map((entry) => entry.name), ['状态', '表情']);
  assert.deepEqual(normalizeDescriptionList([{ name: '状态', value: 'a', updatedAt: 9 }, { name: '状态', value: 'b' }]), [{ name: '状态', value: 'a', updatedAt: 9 }], '同名只留第一笔');
});

test('合并：逐字段更新、相同内容算确认、未知名称略过、空字串不改', () => {
  const list = normalizeDescriptionList({ 状态: '疲惫', 表情: '皱眉', 腹部: '平坦' }, 0);
  const result = applyDescriptionPatch(list, { 状态: '精神', 表情: '皱眉', 动作: '奔跑', 腹部: '' }, 1440);
  assert.deepEqual(result.updated, ['状态']);
  assert.deepEqual(result.refreshed, ['表情']);
  assert.deepEqual(result.unknown, ['动作']);
  assert.deepEqual(result.list, [
    { name: '状态', value: '精神', updatedAt: 1440 },
    { name: '表情', value: '皱眉', updatedAt: 1440 },
    { name: '腹部', value: '平坦', updatedAt: 0 },
  ]);
  assert.equal(list[0].value, '疲惫', '不改动传入的阵列');
});

test('空栏位：第一次写入依序建立字段；旧字串补丁也接受', () => {
  const result = applyDescriptionPatch([], '胎况|已着床;;供养|稳定;;', 30);
  assert.equal(result.established, true);
  assert.deepEqual(result.list.map((entry) => entry.name), ['胎况', '供养']);
});

test('过期点名：超过一天没更新的字段，按栏位顺序', () => {
  const list = [
    { name: '状态', value: 'a', updatedAt: 0 },
    { name: '表情', value: 'b', updatedAt: 1000 },
    { name: '腹部', value: 'c', updatedAt: 0 },
  ];
  assert.deepEqual(getStaleDescriptionFields(list, 1439), []);
  assert.deepEqual(getStaleDescriptionFields(list, 1440), ['状态', '腹部']);
  assert.deepEqual(descriptionListToObject(list), { 状态: 'a', 表情: 'b', 腹部: 'c' });
});

test('bsSetDescription：写错的字段名只略过那一栏，其余照常更新', () => {
  const chatState = state.createEmptyChatState();
  chatState.minutesPassed = 2000;
  chatState.characters.Alice = state.createDefaultFemaleState('Alice');
  chatState.characters.Alice.initialized = true;
  chatState.characters.Alice.profile.descriptions.normalDescription = normalizeDescriptionList({ 状态: '疲惫', 行动: '坐着' }, 0);
  const result = applyToolCall(chatState, {
    name: 'bsSetDescription',
    arguments: { female: 'Alice', options: { normalDescription: { 状态: '精神', 动作: '奔跑', 行动: '坐着' } } },
  });
  assert.equal(result.applied, true);
  assert.match(result.message, /更新 状态/);
  assert.match(result.message, /确认未变 行动/);
  assert.match(result.message, /没有字段 动作，已略过/);
  assert.deepEqual(chatState.characters.Alice.profile.descriptions.normalDescription, [
    { name: '状态', value: '精神', updatedAt: 2000 },
    { name: '行动', value: '坐着', updatedAt: 2000 },
  ]);

  const allUnknown = applyToolCall(chatState, {
    name: 'bsSetDescription',
    arguments: { female: 'Alice', options: { normalDescription: { 动作: '奔跑' } } },
  });
  assert.equal(allUnknown.applied, false);
  assert.match(allUnknown.message, /没有字段 动作/);
});

test('v7 存档迁移：描述字串转成阵列，时间戳记为当时的系统时钟，快照一并迁移', () => {
  const ctx = { chatId: 'desc-v8', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('Alice');
  character.initialized = true;
  character.profile.descriptions = { normalDescription: '状态|疲惫;;随手一段;;', pregnantDescription: '' };
  chatState.characters.Alice = character;
  chatState.minutesPassed = 4320;
  chatState.schemaVersion = 7;
  state.recordChatStateSnapshot(ctx, chatState, { reason: 'legacy' });
  settings.chatStates['desc-v8'] = chatState;

  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.characters.Alice.profile.descriptions, {
    normalDescription: [
      { name: '状态', value: '疲惫', updatedAt: 4320 },
      { name: UNSORTED_DESCRIPTION_NAME, value: '随手一段', updatedAt: 4320 },
    ],
    pregnantDescription: [],
  });

  migrated.characters.Alice.profile.descriptions.normalDescription = [];
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.equal(migrated.characters.Alice.profile.descriptions.normalDescription[0].name, '状态', '回溯快照也已是阵列');
});

test('注册：模型给的 { 字段名: 内容 } 存成阵列，旧字串也接受', async () => {
  const { applyRegistryResult } = await import('../scripts/registry.js');
  const chatState = state.createEmptyChatState();
  chatState.minutesPassed = 90;
  applyRegistryResult(chatState, { name: 'Bea', profile: { base: { race: '人类', age: 20 }, descriptions: {
    normalDescription: { 状态: '平静', 表情: '微笑' },
    pregnantDescription: '胎况|无;;',
  } } });
  assert.deepEqual(chatState.characters.Bea.profile.descriptions, {
    normalDescription: [{ name: '状态', value: '平静', updatedAt: 90 }, { name: '表情', value: '微笑', updatedAt: 90 }],
    pregnantDescription: [{ name: '胎况', value: '无', updatedAt: 90 }],
  });
});
