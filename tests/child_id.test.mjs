// 孩子记录的稳定标识：此前只能用「母亲名 + children 阵列索引」引用，
// 改名或搬移孩子都会让引用失联。血缘关系图需要一个不随位置变动的键。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createChildId, createEmptyChatState, getChatState, getSettings } from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

function makeCtx(chatId) {
  return { chatId, chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
}

test('createChildId 产生的标识不重复', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => createChildId()));
  assert.equal(ids.size, 1000);
});

test('分娩产生的孩子带上 id 与父系名字', () => {
  const chatState = {
    characters: {
      艾拉: {
        name: '艾拉',
        initialized: true,
        profile: {
          base: {
            stage: '临产期', days: 1, race: '人类', vitality: 100,
            vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0,
          },
          bio: {},
          pregnant: {
            fetuses: [{ fathers: '凯', race: '龙族x人类', gender: '女', embryoType: '胎生', weight: 1, talents: [] }],
            fetusesCount: 1, pregnantDays: 280,
          },
          immune: {}, experience: {}, metabolism: {}, cooldown: {},
        },
      },
    },
  };
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '艾拉' } });
  assert.equal(result.applied, true);
  const children = chatState.characters['艾拉'].profile.children || [];
  assert.equal(children.length, 1);
  assert.ok(children[0].id, '孩子应有 id');
  // 父系从射精那一刻就存下来，一路带到孩子身上
  assert.equal(children[0].fathers, '凯');
});

test('存量存档的孩子在读取时补上 id', () => {
  const ctx = makeCtx('legacy-chat');
  const settings = getSettings(ctx);
  settings.chatStates['legacy-chat'] = createEmptyChatState();
  // 早期存档：孩子没有 id
  settings.chatStates['legacy-chat'].characters['艾拉'] = {
    name: '艾拉',
    initialized: true,
    profile: { base: {}, children: [{ name: '小龙', fathers: '凯' }, { name: '小凤', fathers: '凯' }] },
  };

  const chatState = getChatState(ctx, settings);
  const children = chatState.characters['艾拉'].profile.children;
  assert.ok(children.every((child) => child.id), '所有存量孩子都应补上 id');
  assert.equal(new Set(children.map((child) => child.id)).size, children.length, 'id 不该重复');
  // 已保留的名字与父系不该被迁移动到
  assert.deepEqual(children.map((child) => child.name), ['小龙', '小凤']);
  assert.deepEqual(children.map((child) => child.fathers), ['凯', '凯']);
});

test('已有 id 的孩子重复读取时不会被换掉', () => {
  const ctx = makeCtx('stable-chat');
  const settings = getSettings(ctx);
  settings.chatStates['stable-chat'] = createEmptyChatState();
  settings.chatStates['stable-chat'].characters['艾拉'] = {
    name: '艾拉',
    initialized: true,
    profile: { base: {}, children: [{ name: '小龙', fathers: '凯' }] },
  };

  const first = getChatState(ctx, settings).characters['艾拉'].profile.children[0].id;
  const second = getChatState(ctx, settings).characters['艾拉'].profile.children[0].id;
  assert.equal(second, first, 'id 一旦产生就必须稳定');
});
