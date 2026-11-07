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
