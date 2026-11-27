// 外口布局（1.6.0）：产道从哪个口出来。种族预设、角色覆写、肛交照布局走、孕夫默认肛门分娩、提示词只送文字
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { normalizeSireRecord } from '../scripts/sires.js';
import {
  ALL_BUILTIN_RACES, getCharacterOutletLayout, getRaceCanalTexture, getRaceOutletLayout, normalizeOutletLayout,
} from '../scripts/race_config.js';

function setup(extra = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '卵泡期', days: 0, vitality: 100, psyStress: 0, race: '人类', bodySize: 4, ...extra });
  chat.characters.A = ch;
  return chat;
}
const base = (chat, name = 'A') => chat.characters[name].profile.base;
const sperm = (chat, args) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: '乙', race: '人类', amount: 0, ...args } });
const vaginalTotal = (chat) => (base(chat).sperms || []).reduce((sum, source) => sum + (Number(source.value) || 0), 0);

test('种族预设：分离 60、泄殖腔 56、管状 13；孕夫的两种没有种族预设', () => {
  const counts = {};
  for (const race of ALL_BUILTIN_RACES) counts[getRaceOutletLayout(race)] = (counts[getRaceOutletLayout(race)] || 0) + 1;
  assert.deepEqual(counts, { separate: 60, cloaca: 56, tube: 13 });
  assert.equal(getRaceOutletLayout('奇美拉'), 'cloaca', '奇美拉系照袋鼠型');
  assert.equal(getRaceOutletLayout('鸟族'), 'cloaca');
  assert.equal(getRaceOutletLayout('鬣狗族'), 'tube');
  assert.equal(getRaceOutletLayout('鳥族'), 'cloaca', '繁体也认得');
  assert.equal(getRaceOutletLayout('怪鸟类-鹰'), 'cloaca', '子项照基种族');
  assert.equal(getRaceOutletLayout('1/4鸟族x3/4人类'), 'separate', '混血取占比最大的那一族');
  assert.equal(getRaceOutletLayout('宝可梦'), 'separate', '名录外的当分离开口');
});

test('角色覆写：有填照填、认不得的值不存', () => {
  assert.equal(getCharacterOutletLayout({ race: '人类' }), 'separate');
  assert.equal(getCharacterOutletLayout({ race: '人类', outletLayout: 'cloaca' }), 'cloaca');
  assert.equal(getCharacterOutletLayout({ race: '蛇人', outletLayout: 'nope' }), 'cloaca');
  assert.equal(normalizeOutletLayout(' tube '), 'tube');
  const bad = setup({ outletLayout: 'nope' }).characters.A;
  state.normalizeCharacterPsychologyState(bad);
  assert.equal(bad.profile.base.outletLayout, undefined);
  const good = setup({ outletLayout: 'tube' }).characters.A;
  state.normalizeCharacterPsychologyState(good);
  assert.equal(good.profile.base.outletLayout, 'tube');
});

test('非血肉的通道纹理才有一句，血肉的没有', () => {
  assert.match(getRaceCanalTexture('宝石人'), /晶面/);
  assert.match(getRaceCanalTexture('电子幽灵'), /像素/);
  assert.equal(getRaceCanalTexture('人类'), null);
  assert.equal(getRaceCanalTexture('鸟族'), null);
});

test('泄殖腔的肛交就是插进产道：照产道受孕，不留肛内残精', () => {
  const chat = setup({ race: '蛇人' });
  const inserted = sperm(chat, { action: 'insert', channel: 'anal' });
  assert.equal(inserted.applied, true, inserted.message);
  assert.match(inserted.message, /泄殖腔，只有一个外口/);
  assert.equal(base(chat).penetrationChannel, undefined);
  const shot = sperm(chat, { action: 'deposit', amount: 20, channel: 'anal' });
  assert.equal(shot.applied, true, shot.message);
  assert.equal(base(chat).analSemen ?? 0, 0);
  assert.equal(vaginalTotal(chat), 20);
});

test('孕夫（肛门分娩）的肛门就是产道；分离开口的人照旧走直肠', () => {
  const male = setup({ outletLayout: 'anal' });
  assert.match(sperm(male, { action: 'insert', channel: 'anal' }).message, /孕夫，肛门就是产道/);
  sperm(male, { action: 'deposit', amount: 10 });
  assert.equal(vaginalTotal(male), 10);
  const human = setup();
  sperm(human, { action: 'insert', channel: 'anal' });
  assert.equal(base(human).penetrationChannel, 'anal');
});

test('肛交射精不算破处（insert 与 deposit 都不算）', () => {
  const chat = setup();
  sperm(chat, { action: 'insert', channel: 'anal' });
  sperm(chat, { action: 'deposit', amount: 10 });
  assert.equal(chat.characters.A.profile.experience.virginity ?? null, null);
});

test('纯精方长出子宫：分离开口的种族默认肛门分娩，泄殖腔种族照种族', () => {
  const chat = setup();
  chat.sires = { 雷恩: normalizeSireRecord({ race: '精灵', age: 30 }), 蛇: normalizeSireRecord({ race: '蛇人', age: 30 }) };
  for (const name of ['雷恩', '蛇']) {
    const result = applyToolCall(chat, { name: 'bsRecordExperience', arguments: { female: name, action: 'transform', time: 'x', body: 'gainWomb', content: '禁术' } });
    assert.equal(result.applied, true, result.message);
  }
  assert.equal(base(chat, '雷恩').outletLayout, 'anal');
  assert.equal(base(chat, '蛇').outletLayout, undefined);
  assert.equal(getCharacterOutletLayout(base(chat, '蛇')), 'cloaca');
});

test('泄殖腔兼精方：被插入时又插着别人，回传讯息提醒单孔只能用一边', () => {
  const chat = setup({ race: '蛇人' });
  chat.characters.B = state.createDefaultFemaleState('B');
  chat.characters.B.initialized = true;
  Object.assign(chat.characters.B.profile.base, { stage: '卵泡期', days: 0, race: '人类', bodySize: 4 });
  chat.sires = { A: normalizeSireRecord({ spermQuality: 1 }) };
  const giving = applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'B', male: 'A', race: '蛇人', action: 'insert', amount: 0 } });
  assert.equal(giving.applied, true, giving.message);
  assert.doesNotMatch(giving.message, /单孔/, '只插别人、自己没被插，不提醒');
  const receiving = sperm(chat, { action: 'insert' });
  assert.match(receiving.message, /A是泄殖腔，正用翻出的剑插着B，单孔同时只能用一边/);
  const again = applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'B', male: 'A', race: '蛇人', action: 'insert', amount: 0 } });
  assert.match(again.message, /A是泄殖腔，自己的单孔正被插着/);
});

test('提示词：分离开口不送，其他送文字；非血肉纹理才送', () => {
  const chat = setup({ race: '宝石人', outletLayout: 'cloaca' });
  chat.characters.B = state.createDefaultFemaleState('B');
  chat.characters.B.initialized = true;
  Object.assign(chat.characters.B.profile.base, { stage: '卵泡期', days: 0, race: '人类', bodySize: 4, isHere: true });
  base(chat).isHere = true;
  const ctx = {
    chatId: 'outlet-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'outlet-chat': chat } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const sent = buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state;
  assert.equal(sent.A.profile.base.outletLayout, '泄殖腔（单一外口）');
  assert.match(sent.A.profile.base.canalTexture, /晶面/);
  assert.equal('outletLayout' in sent.B.profile.base, false);
  assert.equal('canalTexture' in sent.B.profile.base, false);
});
