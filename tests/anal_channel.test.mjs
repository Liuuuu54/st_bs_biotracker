// 肛交（1.6.0）：bsAddSperm 的 channel=anal；射进直肠不受孕，1% 外流进产道，肛内残精 3 小时减半、排便清空
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { normalizeSireRecord } from '../scripts/sires.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function setup(extra = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '卵泡期', days: 0, vitality: 100, psyStress: 0, race: '人类', bodySize: 4, ...extra });
  chat.characters.A = ch;
  return chat;
}
const base = (chat) => chat.characters.A.profile.base;
const sperm = (chat, args) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: '乙', race: '人类', amount: 0, ...args } });
const vaginalTotal = (chat) => (base(chat).sperms || []).reduce((sum, source) => sum + (Number(source.value) || 0), 0);
const near = (actual, expected, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);

test('肛交射精：直肠留 99%，产道只进 1%，不算破处', () => {
  const chat = setup();
  const inserted = sperm(chat, { action: 'insert', channel: 'anal' });
  assert.equal(inserted.applied, true);
  assert.match(inserted.message, /channel=anal/);
  assert.equal(base(chat).analPenetration?.state, 'inserted', '肛门是独立的一格');
  assert.equal(base(chat).penetrationState, 'idle', '产道那一格空着');
  assert.equal(chat.characters.A.profile.experience.virginity ?? null, null);
  const shot = sperm(chat, { action: 'deposit', amount: 20 });
  assert.equal(shot.applied, true, shot.message);
  near(base(chat).analSemen, 19.8, 1e-9);
  near(vaginalTotal(chat), 0.2, 1e-9);
  assert.match(shot.message, /肛内残精约 20/);
});

test('套子照挡：没破就什么都没进', () => {
  Math.random = () => 0;
  const chat = setup();
  sperm(chat, { action: 'insert', channel: 'anal', hasCondom: true });
  sperm(chat, { action: 'deposit', amount: 20 });
  assert.equal(base(chat).analSemen ?? 0, 0);
  assert.equal(vaginalTotal(chat), 0);
});

test('通道照 insert：deposit 给不一样的 channel 被挡，withdraw 清掉通道', () => {
  const chat = setup();
  sperm(chat, { action: 'insert', channel: 'anal' });
  assert.equal(sperm(chat, { action: 'deposit', amount: 10, channel: 'vaginal' }).applied, false);
  assert.equal(sperm(chat, { action: 'withdraw' }).applied, true);
  assert.equal(base(chat).penetrationChannel, undefined);
  assert.equal(sperm(chat, { action: 'insert', channel: 'mouth' }).applied, false);
  sperm(chat, { action: 'insert' });
  sperm(chat, { action: 'deposit', amount: 10 });
  near(vaginalTotal(chat), 10, 1e-9);
  assert.equal(base(chat).analSemen ?? 0, 0);
});

test('肛内残精约 3 小时减半，不到 1 就清掉', () => {
  const chat = setup();
  sperm(chat, { action: 'insert', channel: 'anal' });
  sperm(chat, { action: 'deposit', amount: 20 });
  applyToolCall(chat, { name: 'bsPassedTime', arguments: { hour: 3 } });
  near(base(chat).analSemen, 9.9, 0.05);
  applyToolCall(chat, { name: 'bsPassedTime', arguments: { hour: 24 } });
  assert.equal(base(chat).analSemen, undefined);
});

test('排便一起排出', () => {
  const chat = setup();
  sperm(chat, { action: 'insert', channel: 'anal' });
  sperm(chat, { action: 'deposit', amount: 20 });
  const result = applyToolCall(chat, { name: 'bsAdjustMetabolism', arguments: { female: 'A', options: { stool: 'slight_decrease' }, reason: '上厕所' } });
  assert.equal(result.applied, true, result.message);
  assert.match(result.message, /肛内残精一起排出/);
  assert.equal(base(chat).analSemen, undefined);
});

test('肛交的剑太大不算进宫脱，也不顶胎', () => {
  const chat = setup();
  const inserted = sperm(chat, { male: '巨人甲', action: 'insert', channel: 'anal', maleBodySize: 7 });
  assert.equal(inserted.applied, true);
  assert.equal(base(chat).prolapse || 0, 0);
});

test('3P：产道与肛门各一格，两人同时在；锁只锁自己那一格，精液各算各的', () => {
  const chat = setup();
  chat.sires = { 犬: normalizeSireRecord({ swordLock: true }), 蛇: normalizeSireRecord({}) };
  const call = (args) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', race: '人类', amount: 0, ...args } });
  assert.equal(call({ male: '犬', action: 'insert', channel: 'vaginal' }).applied, true);
  assert.equal(call({ male: '犬', action: 'deposit', amount: 20 }).applied, true);
  assert.equal(base(chat).penetrationLocked, true);
  const anal = call({ male: '蛇', action: 'insert', channel: 'anal' });
  assert.equal(anal.applied, true, anal.message);
  assert.match(anal.message, /产道那边 犬 还插着/);
  assert.equal(call({ male: '蛇', action: 'deposit', amount: 10 }).applied, true, '没给 channel 也认得他在肛门那一格');
  near(vaginalTotal(chat), 20.1, 1e-9);
  near(base(chat).analSemen, 9.9, 1e-9);
  assert.equal(base(chat).analPenetration.state, 'spent');
  assert.equal(call({ male: '蛇', action: 'withdraw' }).applied, true);
  assert.equal(base(chat).analPenetration, undefined);
  assert.equal(base(chat).penetrationSource, '犬', '产道那一格不受影响');
});

test('肛门那一格被锁住时别人插不进肛门；双剑占着两穴时别人插不进肛门', () => {
  const chat = setup();
  chat.sires = { 犬: normalizeSireRecord({ swordLock: true }), 蛇: normalizeSireRecord({ swordTwin: true }), 丙: normalizeSireRecord({}) };
  const call = (args) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', race: '人类', amount: 0, ...args } });
  call({ male: '犬', action: 'insert', channel: 'anal' });
  call({ male: '犬', action: 'deposit', amount: 10, channel: 'anal' });
  assert.equal(base(chat).analPenetration.locked, true);
  assert.equal(call({ male: '丙', action: 'insert', channel: 'anal' }).applied, false);
  assert.equal(call({ male: '丙', action: 'insert', channel: 'vaginal' }).applied, true, '产道照样能插');
  assert.match(call({ male: '犬', action: 'withdraw', channel: 'anal', forced: true }).message, /肛门被拉伤/);
  call({ male: '丙', action: 'withdraw' });
  assert.equal(call({ male: '蛇', action: 'insert', channel: 'both' }).applied, true);
  assert.equal(call({ male: '丙', action: 'insert', channel: 'anal' }).applied, false);
});

test('同时插着几处：单剑插第二个人会提醒，双剑两处、触手不限', () => {
  const chat = setup();
  chat.characters.B = JSON.parse(JSON.stringify(chat.characters.A));
  chat.characters.C = JSON.parse(JSON.stringify(chat.characters.A));
  chat.sires = { 单: normalizeSireRecord({}), 双: normalizeSireRecord({ swordTwin: true }), 触: normalizeSireRecord({ swordShaft: 'tentacle' }) };
  const insert = (female, male) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female, male, race: '人类', action: 'insert', amount: 0 } });
  insert('A', '单');
  assert.match(insert('B', '单').message, /只有一根剑，正插着A/);
  for (const name of ['A', 'B', 'C']) Object.assign(chat.characters[name].profile.base, { penetrationState: 'idle', penetrationSource: null });
  insert('A', '双');
  assert.doesNotMatch(insert('B', '双').message, /只有一对双剑/);
  assert.match(insert('C', '双').message, /只有一对双剑/);
  for (const name of ['A', 'B', 'C']) Object.assign(chat.characters[name].profile.base, { penetrationState: 'idle', penetrationSource: null });
  insert('A', '触'); insert('B', '触');
  assert.doesNotMatch(insert('C', '触').message, /只有/);
});

test('存档：开发中用过的产道那一格插肛门（penetrationChannel=anal）搬到肛门那一格；泄殖腔没有肛门那一格', () => {
  const chat = setup();
  Object.assign(base(chat), { penetrationState: 'spent', penetrationSource: '乙', penetrationChannel: 'anal', penetrationLocked: true });
  state.normalizeCharacterPsychologyState(chat.characters.A);
  assert.deepEqual([base(chat).penetrationState, base(chat).analPenetration?.source, base(chat).analPenetration?.locked, base(chat).penetrationChannel], ['idle', '乙', true, undefined]);
  const snake = setup({ race: '蛇人', analPenetration: { state: 'inserted', source: '乙' } });
  state.normalizeCharacterPsychologyState(snake.characters.A);
  assert.equal(base(snake).analPenetration, undefined);
});

test('阴茎分娩的孕夫：尿道口被插着时插别人、插着别人时尿道口被插，都提醒', () => {
  const chat = setup();
  chat.characters.P = JSON.parse(JSON.stringify(chat.characters.A));
  Object.assign(chat.characters.P.profile.base, { outletLayout: 'penile', penetrationState: 'inserted', penetrationSource: '乙' });
  chat.sires = { P: normalizeSireRecord({}) };
  const r = applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: 'P', race: '人类', action: 'insert', amount: 0 } });
  assert.match(r.message, /阴茎分娩的孕夫，剑就是产道/);
  Object.assign(chat.characters.P.profile.base, { penetrationState: 'idle', penetrationSource: null });
  const back = applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'P', male: '乙', race: '人类', action: 'insert', amount: 0 } });
  assert.match(back.message, /正用剑插着别人/);
});
