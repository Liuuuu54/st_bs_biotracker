// SillyTavern：聊天状态另存在聊天档的 metadata，汇出、汇入、改名、分支都带着走。
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import * as state from '../scripts/state.js';

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

/** 模拟 ST：getContext() 每次回传当下的聊天与它的 chat_metadata */
function makeHost(chatId, metadata = {}) {
  const host = { chatId, metadata, metadataSaves: 0, extensionSettings: {} };
  const ctxOf = () => ({
    chatId: host.chatId,
    getCurrentChatId: () => host.chatId,
    chatMetadata: host.metadata,
    saveMetadataDebounced: () => { host.metadataSaves += 1; },
    extensionSettings: host.extensionSettings,
    saveSettingsDebounced() {},
    async saveSettings() {},
  });
  globalThis.SillyTavern = { getContext: ctxOf };
  host.ctx = ctxOf;
  return host;
}
const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const registered = (name = 'A') => ({ name, initialized: true, profile: { base: { race: '人类', stage: '卵泡期' } } });

beforeEach(() => {
  installLocalStorage();
  delete globalThis.__TAURITAVERN__;
  delete globalThis.Luker;
});

test('存档时把当前聊天的状态写进 chat_metadata', async () => {
  const host = makeHost('聊天甲');
  const settings = state.getSettings(host.ctx());
  const chatState = state.getChatState(host.ctx(), settings);
  await state.hydrateChatStateFromHost(host.ctx(), settings);
  chatState.characters.A = registered();
  state.saveSettings(host.ctx());
  await wait();
  assert.equal(host.metadata.bs_biotracker?.version, 1);
  assert.ok(host.metadata.bs_biotracker.chatState.characters.A);
  assert.ok(host.metadataSaves > 0);
});

test('排程到写入之间换了聊天：不写进新聊天', async () => {
  const host = makeHost('聊天乙');
  const settings = state.getSettings(host.ctx());
  const chatState = state.getChatState(host.ctx(), settings);
  await state.hydrateChatStateFromHost(host.ctx(), settings);
  chatState.characters.A = registered();
  state.saveSettings(host.ctx());
  host.chatId = '别的聊天';
  host.metadata = {};
  await wait();
  assert.equal(host.metadata.bs_biotracker, undefined);
});

test('汇入的聊天（新的聊天 ID、本地没有状态）：采用 metadata 里的', async () => {
  const saved = { ...state.createEmptyChatState(), sceneSummary: '汇入前的进度', saveRevision: 10 };
  saved.characters = { A: registered() };
  const host = makeHost('汇入后的新 ID', { bs_biotracker: { version: 1, chatState: saved } });
  const settings = state.getSettings(host.ctx());
  assert.equal(await state.hydrateChatStateFromHost(host.ctx(), settings), true);
  assert.equal(settings.chatStates['汇入后的新 ID'].sceneSummary, '汇入前的进度');
  assert.ok(state.getChatState(host.ctx(), settings).characters.A);
});

test('本地已有状态：metadata 版本较新才采用，较旧就保留本地', async () => {
  const local = { ...state.createEmptyChatState(), sceneSummary: '本地', saveRevision: 50 };
  local.characters = { A: registered() };
  const older = { ...structuredClone(local), sceneSummary: '旧的 metadata', saveRevision: 40 };
  const host = makeHost('聊天丙', { bs_biotracker: { version: 1, chatState: older } });
  const settings = state.getSettings(host.ctx());
  settings.chatStates['聊天丙'] = local;
  assert.equal(await state.hydrateChatStateFromHost(host.ctx(), settings), false);
  assert.equal(settings.chatStates['聊天丙'].sceneSummary, '本地');
  host.metadata.bs_biotracker.chatState = { ...structuredClone(local), sceneSummary: '别台电脑的进度', saveRevision: 60 };
  assert.equal(await state.hydrateChatStateFromHost(host.ctx(), settings), true);
  assert.equal(settings.chatStates['聊天丙'].sceneSummary, '别台电脑的进度');
});

test('还没读过 metadata 的空状态不写，免得盖掉汇入的进度', async () => {
  const saved = { ...state.createEmptyChatState(), sceneSummary: '汇入前的进度', saveRevision: 10, characters: { A: registered() } };
  const host = makeHost('聊天丁', { bs_biotracker: { version: 1, chatState: saved } });
  const settings = state.getSettings(host.ctx());
  state.getChatState(host.ctx(), settings);
  state.saveSettings(host.ctx());
  await wait();
  assert.equal(host.metadata.bs_biotracker.chatState.sceneSummary, '汇入前的进度');
});

// ── Luker 与 TauriTavern：聊天旁档案之外也写一份 metadata，汇入后聊天旁没有就从 metadata 接回 ──

const savedState = (summary) => ({ ...state.createEmptyChatState(), sceneSummary: summary, saveRevision: 10, characters: { A: registered() } });

function lukerHost(chatId, { sidecar = null, metadata = {} } = {}) {
  const host = { chatId, metadata, sidecar, metadataSaves: 0 };
  const ctx = {
    chatId,
    getCurrentChatId: () => host.chatId,
    get chatMetadata() { return host.metadata; },
    saveMetadataDebounced: () => { host.metadataSaves += 1; },
    extensionSettings: {},
    saveSettingsDebounced() {},
    async getChatState() { return host.sidecar; },
    async updateChatState(namespace, updater) { host.sidecar = await updater(host.sidecar || {}); },
  };
  globalThis.Luker = { getContext: () => ctx };
  host.ctx = ctx;
  return host;
}

function tauriHost(fileChatId, stableId, { store = null, metadata = {} } = {}) {
  const host = { fileChatId, metadata, store, metadataSaves: 0 };
  const ctx = {
    chatId: fileChatId,
    getCurrentChatId: () => host.fileChatId,
    get chatMetadata() { return host.metadata; },
    saveMetadataDebounced: () => { host.metadataSaves += 1; },
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  const handle = {
    stableId: async () => stableId,
    store: {
      getJson: async () => { if (!host.store) throw new Error('chat store json not found'); return host.store; },
      setJson: async ({ value }) => { host.store = value; },
    },
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  globalThis.__TAURITAVERN__ = { ready: Promise.resolve(), api: { chat: { current: { handle: () => handle } } } };
  host.ctx = ctx;
  return host;
}

test('Luker：存档时聊天旁与 metadata 都写；汇入后聊天旁没有就从 metadata 接回', async () => {
  const saving = lukerHost('luker-甲', { sidecar: { version: 1, chatState: savedState('原本') } });
  const settings = state.getSettings(saving.ctx);
  assert.equal(await state.hydrateChatStateFromHost(saving.ctx, settings), true);
  state.getChatState(saving.ctx, settings).sceneSummary = '存档后';
  state.saveSettings(saving.ctx);
  await wait(400);
  assert.equal(saving.sidecar.chatState.sceneSummary, '存档后');
  assert.equal(saving.metadata.bs_biotracker?.chatState?.sceneSummary, '存档后');

  const imported = lukerHost('luker-汇入', { sidecar: null, metadata: { bs_biotracker: { version: 1, chatState: savedState('汇入前') } } });
  const importedSettings = state.getSettings(imported.ctx);
  assert.equal(await state.hydrateChatStateFromHost(imported.ctx, importedSettings), true);
  assert.equal(state.getChatState(imported.ctx, importedSettings).sceneSummary, '汇入前');
  delete globalThis.Luker;
});

test('Luker：聊天旁有资料时以它为准，不看 metadata', async () => {
  const host = lukerHost('luker-乙', { sidecar: { version: 1, chatState: savedState('聊天旁') }, metadata: { bs_biotracker: { version: 1, chatState: savedState('metadata') } } });
  const settings = state.getSettings(host.ctx);
  await state.hydrateChatStateFromHost(host.ctx, settings);
  assert.equal(state.getChatState(host.ctx, settings).sceneSummary, '聊天旁');
  delete globalThis.Luker;
});

test('TauriTavern：存档时聊天旁与 metadata 都写；汇入后新的稳定 ID 没有存档就从 metadata 接回', async () => {
  const saving = tauriHost('tt-档名', 'tt-stable-1', { store: { version: 1, chatState: savedState('原本') } });
  const settings = state.getSettings(saving.ctx);
  assert.equal(await state.hydrateChatStateFromHost(saving.ctx, settings), true);
  state.getChatState(saving.ctx, settings).sceneSummary = '存档后';
  state.saveSettings(saving.ctx);
  await wait(400);
  assert.equal(saving.store.chatState.sceneSummary, '存档后');
  assert.equal(saving.metadata.bs_biotracker?.chatState?.sceneSummary, '存档后');

  const imported = tauriHost('tt-汇入档名', 'tt-stable-new', { store: null, metadata: { bs_biotracker: { version: 1, chatState: savedState('汇入前') } } });
  const importedSettings = state.getSettings(imported.ctx);
  assert.equal(await state.hydrateChatStateFromHost(imported.ctx, importedSettings), true);
  assert.equal(state.getChatState(imported.ctx, importedSettings).sceneSummary, '汇入前');
  delete globalThis.__TAURITAVERN__;
});
