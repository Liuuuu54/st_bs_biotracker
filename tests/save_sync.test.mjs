// 跨分页存档同步：版本号、过期判断，以及「过期没改过就读回、过期有改动就保留这个分页」。
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import * as state from '../scripts/state.js';
import { claimChatRevision, clearHostSettingsPendingUpTo, hasPendingHostSave, markHostSettingsPending, readLatestChatRevision } from '../scripts/save_sync.js';

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  return store;
}

function makeCtx(chatId) {
  const ctx = { chatId, extensionSettings: {}, saveSettingsDebounced() {}, async saveSettings() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  return ctx;
}

beforeEach(() => {
  installLocalStorage();
  delete globalThis.__TAURITAVERN__;
  delete globalThis.Luker;
});

test('版本号：别的分页存过更新的版本时判为过期；force 用于冲突时以这个分页为准', () => {
  const first = claimChatRevision('聊天', 0);
  assert.equal(first.stale, false);
  assert.equal(readLatestChatRevision('聊天'), first.revision);
  const stale = claimChatRevision('聊天', first.revision - 1);
  assert.equal(stale.stale, true);
  const forced = claimChatRevision('聊天', first.revision - 1, { force: true });
  assert.equal(forced.stale, false);
  assert.ok(forced.revision > first.revision);
});

test('待存标记：自己发起的立即存档写完就清掉，之后才标的不清', () => {
  markHostSettingsPending();
  assert.equal(hasPendingHostSave(), true);
  clearHostSettingsPendingUpTo(Date.now());
  assert.equal(hasPendingHostSave(), false);
  markHostSettingsPending();
  clearHostSettingsPendingUpTo(Date.now() - 10000);
  assert.equal(hasPendingHostSave(), true, '标记晚于这次存档开始，不能清');
  clearHostSettingsPendingUpTo(Date.now());
});

test('载入后的例行存档不领新版本号；内容改了才领', () => {
  const ctx = makeCtx('同步-领号');
  const settings = state.getSettings(ctx);
  state.getChatState(ctx, settings);
  state.markChatStatesSynced(ctx);
  state.saveSettings(ctx);
  assert.equal(readLatestChatRevision('同步-领号'), 0, '没改动不抢号');
  settings.chatStates['同步-领号'].sceneSummary = '有了新内容';
  state.saveSettings(ctx);
  assert.ok(readLatestChatRevision('同步-领号') > 0);
  assert.equal(settings.chatStates['同步-领号'].saveRevision, readLatestChatRevision('同步-领号'));
});

test('过期而且自己没改过：存档前从宿主读回，不拿旧副本覆盖', async () => {
  const ctx = makeCtx('同步-读回');
  const settings = state.getSettings(ctx);
  state.getChatState(ctx, settings);
  state.markChatStatesSynced(ctx);
  // 另一个分页存过更新的版本，磁碟上是它的内容
  globalThis.localStorage.setItem('bs_biotracker:chat_revision:同步-读回', '5000');
  const onDisk = { ...structuredClone(settings.chatStates['同步-读回']), sceneSummary: '另一个分页写的', saveRevision: 5000 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ settings: JSON.stringify({ extension_settings: { bs_biotracker: { chatStates: { '同步-读回': onDisk } } } }) }) });
  try {
    assert.deepEqual(state.findStaleChatKeys(ctx), ['同步-读回']);
    await state.saveSettingsNow(ctx);
    assert.equal(settings.chatStates['同步-读回'].sceneSummary, '另一个分页写的');
    assert.deepEqual(state.findStaleChatKeys(ctx), []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('过期但这个分页刚有改动：以这个分页为准，不读回', async () => {
  const ctx = makeCtx('同步-冲突');
  const settings = state.getSettings(ctx);
  state.getChatState(ctx, settings);
  state.markChatStatesSynced(ctx);
  globalThis.localStorage.setItem('bs_biotracker:chat_revision:同步-冲突', '5000');
  settings.chatStates['同步-冲突'].sceneSummary = '这个分页刚写的';
  let fetched = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return { ok: false }; };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await state.saveSettingsNow(ctx);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
  assert.equal(fetched, false, '有改动的不读回');
  assert.equal(settings.chatStates['同步-冲突'].sceneSummary, '这个分页刚写的');
  assert.ok(readLatestChatRevision('同步-冲突') > 5000, '领到比别人都新的版本');
});
