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
            fetuses: [{ fathers: '凯', race: '西方龙x人类', gender: '女', embryoType: '胎生', weight: 1, talents: [] }],
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
