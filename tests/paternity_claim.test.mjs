// 胎父认定：bsRecordExperience(action=claim) 记胎儿或孩子心里认定的父亲与白描纪录；
// 认定可以与真相不符，对外谎称写在纪录里；不改遗传父方 fathers，出生时原样带到孩子。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, applyToolCallsResult, mergePaternityClaims, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

function makePregnant(fetuses) {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = {
    name: '艾拉',
    initialized: true,
    profile: {
      base: { stage: '孕晚期', days: 0, race: '人类', vitality: 100 },
      pregnant: { pregnantDays: 240, effectivePregnantDays: 240, fetusesCount: fetuses.length, fetalEnergyDrain: 1, amnionDurability: 100, fetuses },
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      immune: {}, metabolism: {}, children: [], notify: {},
    },
  };
  return chatState;
}
const fetus = (embryoId, extra = {}) => ({ embryoId, fathers: '凯', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, ...extra });
const claim = (chatState, args, sourceId) => applyToolCall(chatState, {
  name: 'bsRecordExperience', sourceId,
  arguments: { female: '艾拉', action: 'claim', time: '第三日', content: '艾拉对丈夫说孩子是他的，丈夫信了。', ...args },
});

test('claim 记在胎儿上，追加纪录，不改遗传父方', () => {
  const chatState = makePregnant([fetus(1), fetus(2)]);
  assert.equal(claim(chatState, { fetusIndex: 1, selectedFather: '丈夫' }).applied, true);
  // 工具写入的是深拷贝后替换的角色，每次都重新读取
  const target = () => chatState.characters['艾拉'].profile.pregnant.fetuses[1];
  assert.equal(target().selectedFather, '丈夫');
  assert.equal(target().fathers, '凯');
  assert.deepEqual(target().paternityClaims.map((x) => x.content), ['艾拉对丈夫说孩子是他的，丈夫信了。']);
  assert.equal(chatState.characters['艾拉'].profile.pregnant.fetuses[0].selectedFather, undefined, '只动指定那一胎');

  assert.equal(claim(chatState, { fetusIndex: 1, content: '丈夫起了疑心，说孩子不像他。' }).applied, true);
  assert.equal(target().selectedFather, '丈夫', '省略 selectedFather 保留原值');
  assert.equal(target().paternityClaims.length, 2, '态度改变再记一笔');
  claim(chatState, { fetusIndex: 1, content: '艾拉改口说不知道是谁的。', selectedFather: null });
  assert.equal(target().selectedFather, null);
});

test('参数检查：二择一、content 必填、child 只改名', () => {
  const chatState = makePregnant([fetus(1)]);
  chatState.characters['艾拉'].profile.children = [{ id: 'c1', name: null, fathers: '凯', selectedFather: null }];
  assert.equal(claim(chatState, {}).applied, false, '都没给');
  assert.equal(claim(chatState, { fetusIndex: 0, childIndex: 0 }).applied, false, '都给');
  assert.equal(claim(chatState, { fetusIndex: 3 }).applied, false, '越界');
  assert.equal(claim(chatState, { fetusIndex: 0, content: '' }).applied, false);
  assert.equal(claim(chatState, { fetusIndex: 0, selectedFather: '' }).applied, false);
  assert.equal(claim(chatState, { fetusIndex: 0, partner: '凯' }).applied, false, '不属于 claim 的参数');
  const child = { female: '艾拉', action: 'child', time: '今日', childIndex: 0 };
  assert.equal(applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { ...child, selectedFather: '丈夫' } }).applied, false);
  assert.equal(applyToolCall(chatState, { name: 'bsRecordExperience', arguments: { ...child, name: '小艾' } }).applied, true);
});

test('fetusIndex 按可见顺序：未揭晓的异期胎不占位', () => {
  const chatState = makePregnant([fetus(1, { conceivedAtDays: 100, revealed: false, fathers: '路人' }), fetus(2)]);
  assert.equal(claim(chatState, { fetusIndex: 0, selectedFather: '丈夫' }).applied, true);
  const [hidden, visible] = chatState.characters['艾拉'].profile.pregnant.fetuses;
  assert.equal(visible.selectedFather, '丈夫');
  assert.equal(hidden.selectedFather, undefined);
  assert.equal(claim(chatState, { fetusIndex: 1 }).applied, false);
});

test('同一则讯息重新追踪只记一次', () => {
  const chatState = makePregnant([fetus(1)]);
  assert.equal(claim(chatState, { fetusIndex: 0 }, 'msg-7').applied, true);
  const again = claim(chatState, { fetusIndex: 0 }, 'msg-7');
  assert.equal(again.applied, false);
  assert.equal(again.unchanged, true);
  assert.equal(chatState.characters['艾拉'].profile.pregnant.fetuses[0].paternityClaims.length, 1);
});

test('孩子也能认定；出生时胎儿的认定原样带到孩子', () => {
  const chatState = makePregnant([fetus(1)]);
  claim(chatState, { fetusIndex: 0, selectedFather: '丈夫' });
  assert.equal(applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '艾拉' } }).applied, true);
  const born = () => chatState.characters['艾拉'].profile.children[0];
  assert.equal(born().selectedFather, '丈夫');
  assert.equal(born().fathers, '凯');
  assert.equal(born().paternityClaims.length, 1);

  assert.equal(claim(chatState, { childIndex: 0, content: '孩子长大后，凯上门认领。', selectedFather: '凯' }).applied, true);
  assert.equal(born().selectedFather, '凯');
  assert.equal(born().paternityClaims.length, 2);
});

test('没认定过的胎儿出生后 selectedFather 为 null、没有纪录栏位', () => {
  const chatState = makePregnant([fetus(1)]);
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '艾拉' } });
  const born = chatState.characters['艾拉'].profile.children[0];
  assert.equal(born.selectedFather, null);
  assert.equal(born.paternityClaims, undefined);
});

test('提示词只送最近三笔认定的时间与白描', () => {
  const ctx = { chatId: 'claim-prompt', chat: [{ name: '艾拉', is_user: false, mes: '……' }], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  Object.assign(chatState, makePregnant([fetus(1)]));
  for (let index = 0; index < 5; index += 1) claim(chatState, { fetusIndex: 0, content: `第${index}笔`, selectedFather: '丈夫' }, `m${index}`);
  const payload = buildTrackerPayload(ctx, settings);
  const shown = payload.existing_state['艾拉'].profile.pregnant.fetuses[0];
  assert.deepEqual(shown.paternityClaims, [{ time: '第三日', content: '第2笔' }, { time: '第三日', content: '第3笔' }, { time: '第三日', content: '第4笔' }]);
  assert.equal(chatState.characters['艾拉'].profile.pregnant.fetuses[0].paternityClaims.length, 5, '投影不改动状态');
});

test('同批工具调用里换位后，fetusIndex 仍指向批次开始时那一胎', () => {
  const ctx = { chatId: 'claim-batch', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  Object.assign(chatState, makePregnant([fetus(1, { fathers: '甲' }), fetus(2, { fathers: '乙' })]));
  applyToolCallsResult(ctx, { tool_calls: [
    { name: 'bsAbortion', arguments: { female: '艾拉', purpose: 'termination', fetusIndex: 0 } },
    { name: 'bsRecordExperience', arguments: { female: '艾拉', action: 'claim', time: '今日', fetusIndex: 1, content: '艾拉说剩下这胎是丈夫的。', selectedFather: '丈夫' } },
  ] });
  const remaining = chatState.characters['艾拉'].profile.pregnant.fetuses;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].fathers, '乙');
  assert.equal(remaining[0].selectedFather, '丈夫');
});

test('嵌合胎：认定的父亲只留一位，纪录依时间串接', () => {
  const a = { selectedFather: '甲', paternityClaims: [{ time: '一', content: 'A1', minutesPassed: 10 }] };
  const b = { selectedFather: '乙', paternityClaims: [{ time: '二', content: 'B1', minutesPassed: 30 }, { time: '零', content: 'B0', minutesPassed: 5 }] };
  const merged = mergePaternityClaims(a, b);
  assert.equal(merged.selectedFather, '乙', '取最后一笔纪录所属那一胎');
  assert.deepEqual(merged.paternityClaims.map((x) => x.content), ['B0', 'A1', 'B1']);
  assert.deepEqual(mergePaternityClaims({ selectedFather: '甲' }, { selectedFather: '甲' }), { selectedFather: '甲' });
  assert.deepEqual(mergePaternityClaims({}, {}), {}, '都没认定就不加栏位');
});

test('楼层快照回溯后认定照样还原', () => {
  const ctx = { chatId: 'claim-snapshot', chat: [{ name: '艾拉', is_user: false, mes: '……' }], characters: [], name1: '用户', name2: '艾拉' };
  const chatState = makePregnant([fetus(1)]);
  claim(chatState, { fetusIndex: 0, selectedFather: '丈夫' });
  state.recordChatStateSnapshot(ctx, chatState, { messageCount: 1, reason: 'claim' });
  claim(chatState, { fetusIndex: 0, content: '又改口了。', selectedFather: '凯' });
  state.restoreChatStateFromSnapshot(chatState, chatState.snapshots.at(-1));
  const restored = chatState.characters['艾拉'].profile.pregnant.fetuses[0];
  assert.equal(restored.selectedFather, '丈夫');
  assert.equal(restored.paternityClaims.length, 1);
});

// 实机：她对外说是艾德的、心里认定是罗恩的，模型把心里的认定记成 cognition，月经后就会消失
test('工具说明：selectedFather 记心里的认定，对外谎称写进 content；回覆用认定', () => {
  const description = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsRecordExperience').description;
  assert.match(description, /selectedFather 为她自己心里认定的父亲/);
  assert.match(description, /对外说法与心里认定不同时[^。]*selectedFather 仍记心里的认定，对外怎么说写进 content/);
  assert.match(description, /心里认定改变[^。]*也用 claim 记，不改用 cognition/);
  const chatState = makePregnant([fetus(1)]);
  assert.match(claim(chatState, { fetusIndex: 0 }).message, /胎父认定已记录/);
});
