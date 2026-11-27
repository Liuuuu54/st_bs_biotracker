// 剑的外形与锁住（1.6.0）：精方属性不限种族；只有 swordLock 有机制（锁住时排不出、别人插不进、硬拔会拉伤）
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { describeSireSword, normalizeSireRecord, pruneFutaSireRecord, upsertSireRecord } from '../scripts/sires.js';
import { sanitizeSwordExtraction } from '../scripts/registry.js';

function setup(sire = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '卵泡期', days: 0, vitality: 100, psyStress: 0, race: '人类', bodySize: 4, isHere: true });
  chat.characters.A = ch;
  chat.sires = { 狼: normalizeSireRecord({ race: '人类', swordLock: true, swordKnot: true, swordTip: 'tapered', ...sire }), 乙: normalizeSireRecord({ race: '人类' }) };
  return chat;
}
const base = (chat) => chat.characters.A.profile.base;
const sperm = (chat, male, args) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male, race: '人类', amount: 0, ...args } });
const total = (chat) => (base(chat).sperms || []).reduce((sum, source) => sum + (Number(source.value) || 0), 0);

test('外形只存不是预设值的栏位；扶她裁剪档案时留着', () => {
  const record = normalizeSireRecord({ swordTip: 'rounded', swordKnot: true, swordBarbs: 'yes', swordScrotum: true, swordTwin: false, swordLock: false });
  assert.equal(record.swordKnot, true);
  for (const key of ['swordTip', 'swordBarbs', 'swordScrotum', 'swordTwin', 'swordLock']) assert.equal(key in record, false, key);
  const chat = setup();
  chat.sires.A = normalizeSireRecord({ race: '人类', swordTip: 'flared', swordScrotum: false, swordLock: true });
  pruneFutaSireRecord(chat, 'A');
  assert.deepEqual([chat.sires.A.swordTip, chat.sires.A.swordScrotum, chat.sires.A.swordLock], ['flared', false, true]);
});

test('描述：大小接外形，都是预设值就没有', () => {
  assert.equal(describeSireSword(normalizeSireRecord({})), '');
  assert.equal(describeSireSword(normalizeSireRecord({ swordOffset: 1, swordTip: 'tapered', swordKnot: true, swordLock: true })), '偏大，尖锥头、根部球结、射精后会锁住');
  assert.equal(describeSireSword(normalizeSireRecord({ swordLock: true })), '射精后会锁住', '没有球结也能锁');
  assert.equal(describeSireSword(normalizeSireRecord({ swordTwin: true, swordScrotum: false })), '一对双剑（可以一根插产道、一根插肛门）、没有外露的阴囊');
});

test('upsert：有给才改，给预设值就是改回预设', () => {
  const chat = setup();
  upsertSireRecord(chat, '狼', { swordBarbs: true });
  assert.equal(chat.sires.狼.swordLock, true, '没给的保留');
  assert.equal(chat.sires.狼.swordBarbs, true);
  upsertSireRecord(chat, '狼', { swordLock: false });
  assert.equal('swordLock' in chat.sires.狼, false);
});

test('注册抽取：只收认得的项，没写就 null', () => {
  assert.deepEqual(sanitizeSwordExtraction({ tip: 'tapered', knot: true, lock: true, barbs: 'x', wings: true }), { swordTip: 'tapered', swordKnot: true, swordLock: true });
  assert.deepEqual(sanitizeSwordExtraction({ scrotum: false }), { swordScrotum: false });
  assert.equal(sanitizeSwordExtraction(null), null);
  assert.equal(sanitizeSwordExtraction({ tip: 'banana' }), null);
});

test('射精后锁住：排不出来、别人插不进来，消退后拔出照常', () => {
  const chat = setup();
  sperm(chat, '狼', { action: 'insert' });
  const shot = sperm(chat, '狼', { action: 'deposit', amount: 20 });
  assert.equal(shot.applied, true, shot.message);
  assert.equal(base(chat).penetrationLocked, true);
  assert.match(shot.message, /锁住了/);
  const drain = applyToolCall(chat, { name: 'bsDrainSperm', arguments: { female: 'A', amount: 10 } });
  assert.equal(drain.applied, false);
  assert.equal(total(chat), 20);
  const other = sperm(chat, '乙', { action: 'insert' });
  assert.equal(other.applied, false);
  assert.match(other.message, /锁住/);
  const out = sperm(chat, '狼', { action: 'withdraw' });
  assert.match(out.message, /锁已消退/);
  assert.equal(base(chat).penetrationLocked, undefined);
  assert.equal(base(chat).prolapse ?? 0, 0, '消退后拔出不伤');
  assert.equal(applyToolCall(chat, { name: 'bsDrainSperm', arguments: { female: 'A', amount: 10 } }).applied, true);
});

test('硬拔：产道加重宫脱，肛门不算宫脱', () => {
  const chat = setup();
  sperm(chat, '狼', { action: 'insert' });
  sperm(chat, '狼', { action: 'deposit', amount: 20 });
  const forced = sperm(chat, '狼', { action: 'withdraw', forced: true });
  assert.match(forced.message, /硬拔/);
  assert.ok(Number(base(chat).prolapse) > 0, '产道被往外拖');
  const anal = setup();
  sperm(anal, '狼', { action: 'insert', channel: 'anal' });
  sperm(anal, '狼', { action: 'deposit', amount: 20 });
  assert.match(sperm(anal, '狼', { action: 'withdraw', forced: true }).message, /肛门被拉伤/);
  assert.equal(Number(base(anal).prolapse) || 0, 0);
});

test('没开锁的精方不锁；同一位再插入时解开', () => {
  const chat = setup();
  sperm(chat, '乙', { action: 'insert' });
  sperm(chat, '乙', { action: 'deposit', amount: 10 });
  assert.equal(base(chat).penetrationLocked, undefined);
  const locked = setup();
  sperm(locked, '狼', { action: 'insert' });
  sperm(locked, '狼', { action: 'deposit', amount: 10 });
  assert.equal(sperm(locked, '狼', { action: 'insert' }).applied, true);
  assert.equal(base(locked).penetrationLocked, undefined);
});

test('存档正规化：锁只在射精后、没拔出时留着', () => {
  const chat = setup();
  Object.assign(base(chat), { penetrationLocked: true, penetrationState: 'idle' });
  state.normalizeCharacterPsychologyState(chat.characters.A);
  assert.equal(base(chat).penetrationLocked, undefined);
});

test('提示词：精方的剑送大小与外形；扶她自己的剑送在她的 base.sword', () => {
  const chat = setup();
  chat.sires.A = normalizeSireRecord({ swordTwin: true });
  const ctx = {
    chatId: 'sword-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'sword-chat': chat } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  assert.equal(payload.existing_state.A.profile.base.sword, '一对双剑（可以一根插产道、一根插肛门）');
  const wolf = payload.registered_sires.find((entry) => entry.name === '狼');
  assert.equal(wolf.sword, '尖锥头、根部球结、射精后会锁住');
});

test('双剑同时插两个穴：精液各一半，直肠那一半照肛交算；算破处与宫脱照产道', () => {
  const chat = setup({ swordLock: false, swordTwin: true });
  const inserted = sperm(chat, '狼', { action: 'insert', channel: 'both' });
  assert.equal(inserted.applied, true, inserted.message);
  assert.match(inserted.message, /channel=both/);
  assert.equal(base(chat).penetrationChannel, 'both');
  assert.equal(chat.characters.A.profile.experience.virginity, '狼', '有一根进了产道，算破处');
  const shot = sperm(chat, '狼', { action: 'deposit', amount: 20, channel: 'both' });
  assert.equal(shot.applied, true, shot.message);
  assert.match(shot.message, /产道 10、直肠 10/);
  assert.equal(total(chat), 10.1, '产道一半加直肠外流 1%');
  assert.equal(base(chat).analSemen, 9.9);
});

test('channel=both 只给双剑精方；泄殖腔与孕夫两根挤进同一条产道', () => {
  const chat = setup();
  const refused = sperm(chat, '乙', { action: 'insert', channel: 'both' });
  assert.equal(refused.applied, false);
  assert.match(refused.message, /只给双剑/);
  const cloaca = setup({ swordLock: false, swordTwin: true });
  base(cloaca).race = '蛇人';
  const routed = sperm(cloaca, '狼', { action: 'insert', channel: 'both' });
  assert.match(routed.message, /两根挤进同一条产道/);
  assert.equal(base(cloaca).penetrationChannel, undefined);
  sperm(cloaca, '狼', { action: 'deposit', amount: 20, channel: 'both' });
  assert.equal(total(cloaca), 20);
  assert.equal(base(cloaca).analSemen ?? 0, 0);
});

test('双剑锁住后硬拔：产道加重宫脱，肛门也拉伤', () => {
  const chat = setup({ swordTwin: true });
  sperm(chat, '狼', { action: 'insert', channel: 'both' });
  sperm(chat, '狼', { action: 'deposit', amount: 20 });
  const forced = sperm(chat, '狼', { action: 'withdraw', forced: true });
  assert.match(forced.message, /肛门也被拉伤/);
  assert.ok(Number(base(chat).prolapse) > 0);
});

test('剑身五种：平滑不存；描述接在头形后面；非血肉种族的剑带质感', () => {
  assert.equal('swordShaft' in normalizeSireRecord({ swordShaft: 'smooth' }), false);
  assert.equal(normalizeSireRecord({ swordShaft: 'spiral' }).swordShaft, 'spiral');
  assert.equal('swordShaft' in normalizeSireRecord({ swordShaft: 'banana' }), false);
  assert.equal(describeSireSword(normalizeSireRecord({ swordTip: 'tapered', swordShaft: 'tentacle' })), '尖锥头、剑身触手（能弯、会自己动）');
  assert.match(describeSireSword(normalizeSireRecord({ race: '宝石人' })), /^质感：晶面/);
  assert.match(describeSireSword(normalizeSireRecord({}), 0, '魔像'), /晶面/, '扶她照卵方种族');
  assert.deepEqual(sanitizeSwordExtraction({ shaft: 'ridged' }), { swordShaft: 'ridged' });
});

test('种族建议：只补模型判断不出来的项，子项照基种族、没列的不补', async () => {
  const { getRaceSwordSuggestion } = await import('../scripts/race_config.js');
  assert.deepEqual(getRaceSwordSuggestion('地狱犬'), { swordTip: 'tapered', swordKnot: true, swordLock: true });
  assert.deepEqual(getRaceSwordSuggestion('原兽族-针鼹'), { swordTwin: true, swordScrotum: false });
  assert.deepEqual(getRaceSwordSuggestion('人类'), {});
  assert.deepEqual(getRaceSwordSuggestion('1/4蛇人x3/4人类'), {}, '混血取占比最大的那一族');
});

test('卵方长出阴茎（变扶她）：剑的外形照她的种族建议', () => {
  const chat = setup();
  base(chat).race = '蛇人';
  const result = applyToolCall(chat, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'transform', time: 'x', body: 'gainSword', content: '禁术' } });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual([chat.sires.A.swordTwin, chat.sires.A.swordScrotum], [true, false]);
});
