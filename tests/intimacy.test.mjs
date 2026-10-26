// 性爱纪录与契合度（1.2.0，精方计划第 4 期 §6.8）。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { formatIntimacyPromptLine, getCompatMultiplier, getIntimacyLevel, getIntimacyRanking, getSheathStretch, recordIntimacyInsert, recordIntimacySemen } from '../scripts/intimacy.js';
import { normalizeSireRecord } from '../scripts/sires.js';
import { applyToolCall } from '../scripts/tools.js';

const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
const HOUR = 60;
const DAY = 1440;

function chatWithMother(base = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('艾拉');
  mother.initialized = true;
  Object.assign(mother.profile.base, { race: '人类', bodySize: 4, age: 24, stage: '卵泡期', days: 3 }, base);
  chat.characters['艾拉'] = mother;
  return chat;
}

test('同一对象 6 小时内重复 insert 只算一场；超过间隔才算新的一场', () => {
  const profile = {};
  assert.equal(recordIntimacyInsert(profile, '凯', { minutesPassed: 0 }), true);
  assert.equal(recordIntimacyInsert(profile, '凯', { minutesPassed: 2 * HOUR }), false);
  assert.equal(recordIntimacyInsert(profile, '凯', { minutesPassed: 4 * HOUR }), false, '从上一次插入算起');
  assert.equal(profile.intimacy['凯'].count, 1);
  assert.ok(Math.abs(profile.intimacy['凯'].effective - 1) < 0.01, '只加一次（再扣几小时的衰减）');
  assert.equal(recordIntimacyInsert(profile, '凯', { minutesPassed: 11 * HOUR }), true);
  assert.equal(profile.intimacy['凯'].count, 2);
});

test('契合度 = 有效次数 ÷ (总和 + 3)：一夜情一次 25%；a6、b20、c1 时 b 约 67%', () => {
  assert.equal(getIntimacyRanking({ intimacy: { 路人: { count: 1, effective: 1, lastMinutes: 0 } } })[0].fit, 0.25);
  const ranking = getIntimacyRanking({ intimacy: {
    a: { count: 6, effective: 6, lastMinutes: 0 },
    b: { count: 20, effective: 20, lastMinutes: 0 },
    c: { count: 1, effective: 1, lastMinutes: 0 },
  } });
  assert.deepEqual(ranking.map((item) => item.name), ['b', 'a', 'c']);
  assert.ok(Math.abs(ranking[0].fit - 20 / 30) < 1e-9);
  assert.ok(Math.abs(ranking[1].fit - 0.2) < 1e-9);
  assert.equal(formatIntimacyPromptLine(ranking), 'b 67%、a 20%、c 3%；身体最熟悉 b');
  assert.equal(formatIntimacyPromptLine([]), '');
});

test('衰减：90 天后有效次数减半；半衰期可调', () => {
  const profile = { intimacy: { 凯: { count: 4, effective: 4, lastMinutes: 0 } } };
  const ranked = getIntimacyRanking(profile, { minutesPassed: 90 * DAY });
  assert.ok(Math.abs(ranked[0].effective - 2) < 1e-9);
  const fast = getIntimacyRanking(profile, { minutesPassed: 30 * DAY, reproductiveSettings: { intimacyHalfLifeDays: 30 } });
  assert.ok(Math.abs(fast[0].effective - 2) < 1e-9);
});

test('相容倍率：差 <0.5／<1.5／<2.5／≥2.5 为 1／0.7／0.4／0；可变、消弭、未知视为完全相容', () => {
  assert.equal(getCompatMultiplier({ gap: 0.3 }), 1);
  assert.equal(getCompatMultiplier({ gap: 1 }), 0.7);
  assert.equal(getCompatMultiplier({ gap: 2 }), 0.4);
  assert.equal(getCompatMultiplier({ gap: 3 }), 0);
  assert.equal(getCompatMultiplier({ gap: 3, variable: true }), 1);
  assert.equal(getCompatMultiplier({ gap: 3, bridged: true }), 1);
  assert.equal(getCompatMultiplier(null), 1);
});

test('精液加成：品质 4 内射 +0.5；品质 0.25 扣到这一场为止，不低于 0', () => {
  const profile = {};
  recordIntimacyInsert(profile, '凯', { minutesPassed: 0, compat: 0 });
  assert.equal(recordIntimacySemen(profile, '凯', { minutesPassed: 10, quality: 4 }), 0.5);
  assert.ok(Math.abs(profile.intimacy['凯'].effective - 0.5) < 1e-6, '体型差太大也能靠内射累积');
  const weak = {};
  recordIntimacyInsert(weak, '弱', { minutesPassed: 0, compat: 0.4 });
  recordIntimacySemen(weak, '弱', { minutesPassed: 10, quality: 0.25 });
  assert.ok(Math.abs(weak.intimacy['弱'].effective) < 1e-6, '最多扣掉这一场的 0.4');
  assert.equal(recordIntimacySemen({}, '没插入', { quality: 4 }), 0, '没有纪录不加');
});

test('经产扩张：自然分娩 0／1／8／12 次为 0／0.125／1／1；剖腹产不算', () => {
  assert.equal(getSheathStretch({}), 0);
  assert.equal(getSheathStretch({ naturalBirthExperience: 1 }), 0.125);
  assert.equal(getSheathStretch({ naturalBirthExperience: 8 }), 1);
  assert.equal(getSheathStretch({ naturalBirthExperience: 12, surgicalBirthExperience: 5 }), 1);
  assert.equal(getSheathStretch({ surgicalBirthExperience: 5 }), 0);
});

test('bsAddSperm 接上：insert 记一场、内射加精液加成、戴套成功不加；经产扩张进体型契合', () => {
  const chat = chatWithMother();
  chat.reproductiveSettings = { condomReliability: 1 };
  chat.sires['凯'] = normalizeSireRecord({ race: '人类', bodySize: 4, spermQuality: 4 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'insert', amount: 0, hasCondom: true });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'deposit', amount: 10 });
  let record = chat.characters['艾拉'].profile.intimacy['凯'];
  assert.equal(record.count, 1);
  assert.equal(record.effective, 1, '套子挡住，不加精液加成');
  // 射完是 spent，再来一发要重新 insert；还在同一场，次数不加
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'insert', amount: 0, hasCondom: false });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'deposit', amount: 10 });
  record = chat.characters['艾拉'].profile.intimacy['凯'];
  assert.equal(record.count, 1);
  assert.ok(Math.abs(record.effective - 1.5) < 1e-6);

  const mom = chatWithMother();
  mom.characters['艾拉'].profile.experience.naturalBirthExperience = 8;
  const result = call(mom, 'bsAddSperm', { female: '艾拉', male: '大个子', race: '人类', action: 'insert', amount: 0, maleBodySize: 5 });
  assert.match(result.message, /恰好契合/, '生过 8 胎，鞘 4+1＝5，与 5 级精方恰好契合');
  assert.match(result.message, /含经产扩张 \+1/);
});

test('追踪 payload 只送契合度一行，不送原始汇总', async () => {
  const { buildTrackerPayload } = await import('../scripts/tracker.js');
  const ctx = { chatId: 'intimacy-payload', chat: [{ name: '艾拉', is_user: false, mes: '……' }], characters: [], name1: '用户', name2: '艾拉', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chat = state.getChatState(ctx, settings);
  Object.assign(chat.characters, chatWithMother().characters);
  chat.characters['艾拉'].profile.intimacy = { 凯: { count: 3, effective: 3, lastMinutes: 0 } };
  const payload = buildTrackerPayload(ctx, settings);
  const profile = payload.existing_state['艾拉'].profile;
  assert.equal(profile.intimacy, undefined);
  assert.equal(profile.bodyFamiliarity, '凯 50%；身体最熟悉 凯');
});

test('楼层快照回溯后 intimacy 还原', () => {
  const chat = chatWithMother();
  chat.characters['艾拉'].profile.intimacy = { 凯: { count: 3, effective: 3, lastMinutes: 0 } };
  const ctx = { chatId: 'intimacy-snapshot', chat: [{ name: 'A', is_user: false, mes: '…' }], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} };
  state.recordChatStateSnapshot(ctx, chat, { messageCount: 1, reason: 'test' });
  chat.characters['艾拉'].profile.intimacy = {};
  state.restoreChatStateFromSnapshot(chat, chat.snapshots.at(-1));
  assert.equal(chat.characters['艾拉'].profile.intimacy['凯'].count, 3);
});

// ── 高潮额外排卵（§6.6）：正在插入的是契合度最高者时，每颗卵的排出机率 ×(1 + 0.5 × 契合度)
function orgasmChat(source) {
  const chat = chatWithMother({ stage: '排卵期', days: 0, vitality: 50, vitalityLevel: 4, libido: 20, eggs: 0, penetrationState: 'inserted', penetrationSource: source });
  chat.characters['艾拉'].profile.bio = { ...(chat.characters['艾拉'].profile.bio || {}), orgasmOvulationAmount: 4 };
  chat.characters['艾拉'].profile.cooldown = {};
  chat.characters['艾拉'].profile.intimacy = { 凯: { count: 30, effective: 30, lastMinutes: 0 }, 路人: { count: 1, effective: 1, lastMinutes: 0 } };
  return chat;
}

test('高潮排卵：与身体最熟悉的对象交合时更容易排卵，其他对象照旧', () => {
  const original = Math.random;
  // 活力 50／上限 125＝每颗 40%；凯的契合度 30/34≈0.88，倍率约 1.44，每颗约 58%。固定擲出 0.5 看差别
  Math.random = () => 0.5;
  try {
    const familiar = orgasmChat('凯');
    call(familiar, 'bsUpdateCharacterStatus', { female: '艾拉', options: { orgasm: true } });
    assert.ok(familiar.characters['艾拉'].profile.base.eggs >= 4);
    assert.match(familiar.characters['艾拉'].profile.notify.secondly, /身体最熟悉的 凯/);
    const stranger = orgasmChat('路人');
    call(stranger, 'bsUpdateCharacterStatus', { female: '艾拉', options: { orgasm: true } });
    assert.ok(stranger.characters['艾拉'].profile.base.eggs < 4, '路人不是契合度最高的，没有加成');
    assert.doesNotMatch(stranger.characters['艾拉'].profile.notify.secondly, /身体最熟悉/);
  } finally {
    Math.random = original;
  }
});

test('契合的称呼与五格：一夜情一次 25% 是初识；排行带上距今多久', () => {
  assert.deepEqual([0, 0.1, 0.25, 0.3, 0.5, 0.7, 0.95].map((fit) => getIntimacyLevel(fit).name), ['生疏', '生疏', '初识', '熟悉', '默契', '刻骨', '刻骨']);
  assert.deepEqual([0.1, 0.25, 0.4, 0.6, 0.8].map((fit) => getIntimacyLevel(fit).pips), [1, 2, 3, 4, 5]);
  const profile = { intimacy: { 甲: { count: 1, effective: 1, lastMinutes: 100 } } };
  const [item] = getIntimacyRanking(profile, { minutesPassed: 1540 });
  assert.equal(item.elapsedMinutes, 1440);
  assert.equal(getIntimacyLevel(item.fit).name, '初识', '一夜情一次');
});
