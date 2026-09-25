// 状态回溯（唯读）：把楼层快照还原成复本给介面查看，不改动目前状态、不触发回滚。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';

function makeCtx() {
  const chat = [];
  return { chatId: 'history', chat, characters: [], name1: '用户', name2: 'A' };
}

function character(stage, vitality) {
  return {
    name: 'A', initialized: true,
    profile: { base: { stage, days: 0, vitality, race: '人类' }, pregnant: { fetuses: [] }, children: [] },
  };
}

function recordAt(ctx, chatState, messageCount, reason) {
  while (ctx.chat.length < messageCount) ctx.chat.push({ name: 'A', is_user: false, mes: `第${ctx.chat.length}楼` });
  return state.recordChatStateSnapshot(ctx, chatState, { messageCount, reason });
}

test('快照清单最新的排前面；可取回当时角色状态，那时还没有的角色回传 null', () => {
  const ctx = makeCtx();
  const chatState = state.createEmptyChatState();
  recordAt(ctx, chatState, 1, 'empty');
  chatState.characters.A = character('卵泡期', 100);
  recordAt(ctx, chatState, 2, 'tracker');
  chatState.characters.A.profile.base.stage = '排卵期';
  chatState.characters.A.profile.base.vitality = 80;
  recordAt(ctx, chatState, 3, 'tracker');

  const list = state.listChatStateSnapshots(chatState);
  assert.deepEqual(list.map((entry) => [entry.messageCount, entry.reason]), [[3, 'tracker'], [2, 'tracker'], [1, 'empty']]);

  const [latest, middle, first] = list;
  assert.equal(state.getSnapshotCharacter(chatState, first.index, 'A'), null, '第 1 楼时还没注册');
  assert.equal(state.getSnapshotCharacter(chatState, middle.index, 'A').profile.base.stage, '卵泡期');
  assert.equal(state.getSnapshotCharacter(chatState, latest.index, 'A').profile.base.vitality, 80, '差量补丁也能正确还原');
  assert.equal(state.getSnapshotCharacter(chatState, 99, 'A'), null);
});

test('查看快照不会改动目前状态；取回的是复本', () => {
  const ctx = makeCtx();
  const chatState = state.createEmptyChatState();
  chatState.characters.A = character('卵泡期', 100);
  recordAt(ctx, chatState, 1, 'tracker');
  chatState.characters.A.profile.base.vitality = 50;
  const before = JSON.stringify(chatState);

  const past = state.getSnapshotCharacter(chatState, 0, 'A');
  past.profile.base.vitality = 999;
  assert.equal(JSON.stringify(chatState), before);
  assert.equal(state.getSnapshotCharacter(chatState, 0, 'A').profile.base.vitality, 100);
});

test('逐栏位比对：只列出有变化的叶节点，阵列以索引为路径', () => {
  const past = { base: { stage: '卵泡期', vitality: 100 }, children: [{ name: '甲' }], same: 1 };
  const now = { base: { stage: '排卵期', vitality: 100 }, children: [{ name: '甲' }, { name: '乙' }], same: 1, added: true };
  assert.deepEqual(state.diffStateValues(past, now), [
    { path: 'base.stage', before: '卵泡期', after: '排卵期' },
    { path: 'children[1]', before: undefined, after: { name: '乙' } },
    { path: 'added', before: undefined, after: true },
  ]);
  assert.deepEqual(state.diffStateValues({ a: 1 }, { a: 1 }), []);
});
