// 世界书过滤后只能带着「通过筛选的条目」离开：SillyTavern 载入的世界书附带 originalData
// （完整的原始条目），若把整本书展开进请求，排除／白名单都会形同虚设。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

const CHAT_KEY = 'worldbook-leak';
const SECRET = '只有被排除的条目才知道的秘密';

function makeCtx(settingsOver = {}, worldBook = null) {
  const book = worldBook || {
    name: '角色书',
    entries: {
      1: { uid: 1, comment: '公开设定', content: '大陆历八百年。', key: [], constant: true },
      2: { uid: 2, comment: '机密', content: SECRET, key: [], constant: true },
    },
    // SillyTavern 保存的完整原始资料：被排除的条目也在这里
    originalData: { entries: [{ uid: 2, comment: '机密', content: SECRET }] },
    extensions: { note: SECRET },
  };
  const chatState = state.createEmptyChatState();
  const ctx = {
    chatId: CHAT_KEY,
    characterId: 0,
    characters: [{ name: '艾拉', description: '', worldBook: book }],
    chat: [{ name: '用户', is_user: true, mes: '……' }],
    name1: '用户',
    name2: '艾拉',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { [CHAT_KEY]: chatState }, ...settingsOver } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return ctx;
}

const payloadText = (ctx) => JSON.stringify(buildTrackerPayload(ctx, state.getSettings(ctx)));

test('排除模式：被排除的条目与 originalData 都不会出现在请求里', () => {
  const text = payloadText(makeCtx({ trackerWorldbookExcludeNames: '机密' }));
  assert.match(text, /大陆历八百年/, '保留的条目照常送出');
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /originalData/);
});

test('白名单模式：只送勾选的条目，其余包括 originalData 一概不送', () => {
  const text = payloadText(makeCtx({ trackerWorldbookMode: 'allowlist_all', trackerWorldbookIncludeNames: '公开设定' }));
  assert.match(text, /大陆历八百年/);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /originalData/);
});

test('投影只保留书名与条目；认不得的形状不送，嵌套形状照样过滤', () => {
  const keep = (entry) => entry?.comment !== '机密';
  assert.deepEqual(
    state.projectWorldbook({ name: '书', entries: [{ comment: '公开' }, { comment: '机密' }], originalData: { x: 1 } }, keep),
    { name: '书', entries: [{ comment: '公开' }] },
  );
  assert.deepEqual(
    state.projectWorldbook({ worldBook: { name: '嵌套', entries: [{ comment: '机密' }, { comment: '公开' }] }, originalData: {} }, keep),
    { name: '嵌套', entries: [{ comment: '公开' }] },
  );
  assert.equal(state.projectWorldbook({ originalData: { entries: [{ comment: '机密' }] } }, keep), null, '没有条目的形状宁可不送');
  assert.deepEqual(state.projectWorldbook([{ comment: '公开' }, { comment: '机密' }], keep), [{ comment: '公开' }]);
});
