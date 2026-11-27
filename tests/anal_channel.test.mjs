// 肛交（1.6.0）：bsAddSperm 的 channel=anal；射进直肠不受孕，1% 外流进产道，肛内残精 3 小时减半、排便清空
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

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
  assert.equal(base(chat).penetrationChannel, 'anal');
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
