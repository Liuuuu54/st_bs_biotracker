// 精方周期、剑鞘尺寸与同族周期对齐（1.2.4，plan/SIRE_CYCLE_AND_FIT_PLAN.md）。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { describeBodySizeFit, describeSheathOffset, describeSwordOffset, getSheathSize, normalizeSheathOffset, normalizeSwordOffset, resolveBodySize } from '../scripts/body_size.js';
import { applyRegistryResult, sanitizeSireExtractionResult } from '../scripts/registry.js';
import { findSeasonReference, getCharacterSeasonPhase, getMainBloodline, getSireSeasonPhase } from '../scripts/season_phase.js';
import { SIRE_OFF_SEASON_FACTOR, buildSirePromptEntries, getSireQualityState, getSpermCycleFactor, getSpermQualityTier, normalizeSireRecord, upsertSireRecord } from '../scripts/sires.js';
import { applyToolCall } from '../scripts/tools.js';
import { setDerivedTypeOverrides } from '../scripts/race_config.js';

const HOUR = 60;
const DAY = 1440;
const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
const fixed = (size, mean = size) => ({ kind: 'fixed', size, merged: { bodySize: mean } });

function register(chat, name, race, base = {}) {
  applyRegistryResult(chat, { name, profile: { base: { race, age: 24, ...base } } });
  return chat.characters[name];
}

function chatWith(name, race, base = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState(name);
  mother.initialized = true;
  Object.assign(mother.profile.base, { race, bodySize: 4, age: 24, stage: '卵泡期', days: 3 }, base);
  chat.characters[name] = mother;
  return chat;
}

// ── 剑与鞘 ─────────────────────────────

test('偏移正规化：剑 −2～+2 步长 0.5，鞘 −1～+1 步长 0.25，乱写为 0', () => {
  assert.equal(normalizeSwordOffset(1.3), 1.5);
  assert.equal(normalizeSwordOffset(9), 2);
  assert.equal(normalizeSwordOffset('abc'), 0);
  assert.equal(normalizeSwordOffset(null), 0);
  assert.equal(normalizeSheathOffset(-0.6), -0.5);
  assert.equal(normalizeSheathOffset(-3), -1);
  assert.equal(normalizeSheathOffset(true), 0);
});

test('偏移都是 0、个体等于种族平均时，契合与旧版完全相同', () => {
  const fit = describeBodySizeFit({ female: fixed(4), male: fixed(6) });
  assert.equal(fit.label, '明显不合');
  assert.equal(fit.gap, 2);
  assert.doesNotMatch(fit.text, /偏移/);
});

test('鞘与身高只有弱相关：高个子配负偏移，可以比矮个子还浅', () => {
  const tall = getSheathSize(fixed(4.8, 4), { offset: -0.5 });
  const short = getSheathSize(fixed(3.2, 4), { offset: 0 });
  assert.ok(Math.abs(tall - 3.7) < 1e-9, `高个子鞘 ${tall}`);
  assert.ok(Math.abs(short - 3.8) < 1e-9, `矮个子鞘 ${short}`);
  assert.ok(tall < short);
  // 跨物种仍随体型缩放：同样偏离平均 0，大型种族的鞘照样深
  assert.ok(getSheathSize(fixed(6, 6)) - getSheathSize(fixed(4, 4)) === 2);
});

test('剑 ＝ 体型 ＋ 偏移：小个子大剑会顶到', () => {
  const fit = describeBodySizeFit({ female: fixed(4), male: fixed(3.5), maleOffset: 2 });
  assert.equal(fit.gap, 1.5);
  assert.match(fit.text, /精方较大/);
  assert.match(fit.text, /剑硕大/);
});

test('变化态：鞘的平均与个体都换成变化态', () => {
  const resolved = resolveBodySize({ race: '人类', bodySize: 4 });
  const sheath = getSheathSize({ ...resolved, merged: { ...resolved.merged, altFormBodySize: 6 }, formSize: 6.4, altForm: true }, { offset: 0 });
  assert.ok(Math.abs(sheath - 6.1) < 1e-9, `变化态鞘 ${sheath}`);
});

test('bsAddSperm insert：剑偏移读精方档案、鞘偏移读卵方', () => {
  const chat = chatWith('艾拉', '人类', { sheathOffset: -0.5 });
  chat.sires['凯'] = normalizeSireRecord({ race: '人类', bodySize: 4, swordOffset: 1 });
  const result = call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'insert', amount: 0 });
  assert.equal(result.applied, true);
  // 鞘 4 − 0.5 ＝ 3.5，剑 4 ＋ 1 ＝ 5，差 1.5
  assert.match(result.message, /明显不合，精方较大/);
  assert.match(result.message, /鞘偏浅/);
  assert.match(result.message, /剑偏大/);
  assert.equal(chat.characters['艾拉'].profile.base.penetrationFit.gap, 1.5);
});

test('注册：模型给的鞘偏移与剑偏移会被正规化', () => {
  const chat = state.createEmptyChatState();
  register(chat, 'A', '人类', { sheathOffset: -0.6 });
  assert.equal(chat.characters.A.profile.base.sheathOffset, -0.5);
  assert.equal(sanitizeSireExtractionResult({ swordOffset: 1.2 }).swordOffset, 1);
  assert.equal(sanitizeSireExtractionResult({ swordOffset: null }).swordOffset, null);
});

// ── 同族季节对齐 ─────────────────────────────

test('主血统：子项并入母类，混血取比例最大的成分', () => {
  assert.equal(getMainBloodline('兽耳族-猫'), getMainBloodline('兽耳族-兔'));
  assert.equal(getMainBloodline('精灵75%x人类25%'), '精灵');
  assert.equal(getMainBloodline('精灵25%x人类75%'), '人类');
});

test('注册同族：对齐在不在乏情、本季第几轮；本轮的期别仍各自随机', () => {
  for (const [stage, days, seasonCycle] of [['乏情期', 100, 0], ['黄体期', 4, 1], ['卵泡期', 2, 0]]) {
    const chat = state.createEmptyChatState();
    const first = register(chat, '甲', '精灵');
    Object.assign(first.profile.base, { stage, days, seasonCycle });
    const second = register(chat, '乙', '精灵');
    const base = second.profile.base;
    if (stage === '乏情期') {
      assert.equal(base.stage, '乏情期');
      assert.ok(Math.abs(base.days - days) <= 1, `乏情第 ${base.days} 天`);
    } else {
      assert.notEqual(base.stage, '乏情期');
      assert.equal(base.seasonCycle, seasonCycle);
    }
  }
});

test('倍率不同也按比例对齐；人类没有季节，不对齐', () => {
  const chat = state.createEmptyChatState();
  const first = register(chat, '甲', '精灵');
  Object.assign(first.profile.base, { stage: '乏情期', days: 200 });
  const phase = getCharacterSeasonPhase(first.profile);
  const other = register(chat, '乙', '精灵', {});
  other.profile.bio.menstrualLengthRatio = 2.5;
  assert.ok(Math.abs(getCharacterSeasonPhase(first.profile) - phase) < 1e-9);
  assert.equal(findSeasonReference(chat, { race: '人类' }), null);
  const human = register(chat, '丙', '人类');
  assert.notEqual(human.profile.base.stage, '乏情期');
});

test('参考对象：怀孕中的跳过，取注册顺序最早、还在周期中的那位', () => {
  const chat = state.createEmptyChatState();
  const first = register(chat, '甲', '精灵');
  first.profile.base.stage = '孕中期';
  const second = register(chat, '乙', '精灵');
  Object.assign(second.profile.base, { stage: '乏情期', days: 50, seasonCycle: 0 });
  const third = register(chat, '丙', '精灵');
  Object.assign(third.profile.base, { stage: '卵泡期', days: 1, seasonCycle: 0 });
  const reference = findSeasonReference(chat, { race: '精灵', excludeName: '丁' });
  assert.equal(reference.name, '乙');
});

test('子项互相对齐：兽耳族-猫跟着兽耳族-兔', () => {
  const chat = state.createEmptyChatState();
  const rabbit = register(chat, '兔', '兽耳族-兔');
  Object.assign(rabbit.profile.base, { stage: '乏情期', days: 60, seasonCycle: 0 });
  const cat = register(chat, '猫', '兽耳族-猫');
  assert.equal(cat.profile.base.stage, '乏情期');
});

// ── 精方周期 ─────────────────────────────

test('一次性对象（没有档案）：品质照旧是 1，不受季节与存量影响', () => {
  const chat = chatWith('艾拉', '人类');
  assert.equal(getSireQualityState(chat, '路人'), null);
  call(chat, 'bsAddSperm', { female: '艾拉', male: '路人', race: '人类', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '路人', race: '人类', action: 'deposit', amount: 10 });
  const [source] = chat.characters['艾拉'].profile.base.spermContacts || chat.characters['艾拉'].profile.base.sperms;
  assert.equal(source.quality, 1);
});

test('存量：连射一次扣 40%，按半衰期回复，存量只影响品质', () => {
  const chat = chatWith('艾拉', '人类');
  upsertSireRecord(chat, '凯', { race: '人类', bodySize: 4, spermQuality: 1 });
  const fresh = getSireQualityState(chat, '凯');
  assert.equal(fresh.reserve, 1);
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'deposit', amount: 10 });
  const after = getSireQualityState(chat, '凯');
  assert.ok(Math.abs(after.reserve - 0.6) < 1e-9);
  assert.ok(Math.abs(after.freshness - 0.8) < 1e-9);
  assert.ok(after.effective < fresh.effective);
  const later = getSireQualityState(chat, '凯', { minutesPassed: 12 * HOUR });
  assert.ok(Math.abs(later.reserve - 0.8) < 1e-9, '12 小时回复一半的缺口');
  // 沉积量照模型写的，不因存量缩小
  const contacts = chat.characters['艾拉'].profile.base.spermContacts || chat.characters['艾拉'].profile.base.sperms;
  assert.equal(contacts.reduce((sum, item) => sum + (Number(item.value) || 0), 0) > 0, true);
});

test('禁欲超过 7 天每天 −1%，最低 0.85', () => {
  const chat = state.createEmptyChatState();
  upsertSireRecord(chat, '凯', { race: '人类' });
  assert.equal(getSireQualityState(chat, '凯', { minutesPassed: 7 * DAY }).abstinence, 1);
  assert.ok(Math.abs(getSireQualityState(chat, '凯', { minutesPassed: 12 * DAY }).abstinence - 0.95) < 1e-9);
  assert.equal(getSireQualityState(chat, '凯', { minutesPassed: 60 * DAY }).abstinence, 0.85);
});

test('精力周期：没有衍生类型平滑 ±10%；衍生类型决定形状、幅度与高峰叙述，百科可覆写', () => {
  // 平滑波：波峰在一轮正中间，×1.1；波谷 ÷1.1
  assert.ok(Math.abs(getSpermCycleFactor(0.5) - 1.1) < 1e-9);
  assert.ok(Math.abs(getSpermCycleFactor(0) - 1 / 1.1) < 1e-9);
  // 尖峰：平时 1，正中间 3 天冲到 ×2
  const rut = { amplitude: 1, peakDays: 3, cycleDays: 74 };
  assert.equal(getSpermCycleFactor(0.2, rut), 1);
  assert.equal(getSpermCycleFactor(0.5, rut), 2);
  assert.ok(getSpermCycleFactor(0.5 + 1 / 74, rut) > 1 && getSpermCycleFactor(0.5 + 1 / 74, rut) < 2);
  assert.equal(getSpermCycleFactor(0.5 + 2 / 74, rut), 1);

  const chat = state.createEmptyChatState();
  upsertSireRecord(chat, '凯', { race: '人类' });
  const plain = getSireQualityState(chat, '凯');
  assert.equal(plain.cycleDays, 74);
  assert.equal(plain.cycleShape.amplitude, 0.1);
  assert.ok(Math.abs(plain.cycle - getSpermCycleFactor(plain.cycleDay / 74)) < 1e-9);

  // 序列（ABO）：易感期型，走到这一轮正中间冲到 ×2，摘要行写内建的易感期叙述
  upsertSireRecord(chat, '阿尔法', { race: '[序列-ABO]人类' });
  assert.equal(chat.sires['阿尔法'].derivedType, '序列-ABO');
  const alpha = getSireQualityState(chat, '阿尔法');
  assert.equal(alpha.cycleShape.peakDays, 3);
  const toPeak = ((37 - alpha.cycleDay) % 74 + 74) % 74;
  const peak = getSireQualityState(chat, '阿尔法', { minutesPassed: toPeak * DAY });
  assert.ok(Math.abs(peak.cycle - 2) < 1e-6);
  const entries = buildSirePromptEntries({ ...chat, minutesPassed: toPeak * DAY });
  assert.match(entries.find((item) => item.name === '阿尔法').condition, /易感期/);

  // 没有生理节律的衍生：品质恒定
  upsertSireRecord(chat, '骸骨', { race: '[不死]人类' });
  assert.equal(getSireQualityState(chat, '骸骨').cycle, 1);

  // 百科覆写：幅度、峰期与叙述都能改，叙述清空就写通用的
  setDerivedTypeOverrides({ 序列: { sireCycleAmplitude: 0.5, sireCyclePeakDays: 5, sireCyclePrompt: '正值筑巢期' } });
  try {
    const custom = getSireQualityState(chat, '阿尔法');
    assert.equal(custom.cycleShape.amplitude, 0.5);
    assert.equal(custom.cycleShape.peakDays, 5);
    assert.equal(custom.cycleShape.prompt, '正值筑巢期');
    setDerivedTypeOverrides({ 序列: { sireCyclePrompt: '' } });
    const toPeakAgain = ((37 - getSireQualityState(chat, '阿尔法').cycleDay) % 74 + 74) % 74;
    const [again] = buildSirePromptEntries({ ...chat, minutesPassed: toPeakAgain * DAY }).filter((item) => item.name === '阿尔法');
    assert.match(again.condition, /正值精力高峰/);
  } finally {
    setDerivedTypeOverrides({});
  }
});

test('繁殖季：人类恒为 1；精灵在乏情段为 0.6，交界处连续过渡', () => {
  const chat = state.createEmptyChatState();
  upsertSireRecord(chat, '人', { race: '人类' });
  assert.equal(chat.sires['人'].seasonOrigin, null);
  assert.equal(getSireQualityState(chat, '人').season, 1);
  upsertSireRecord(chat, '精', { race: '精灵' });
  const record = chat.sires['精'];
  record.seasonOrigin = 0;
  // 精灵：每轮 35 天 × 2 轮 ＝ 70 天活动季，之后乏情 295 天
  assert.equal(getSireQualityState(chat, '精', { minutesPassed: 30 * DAY }).season, 1);
  const off = getSireQualityState(chat, '精', { minutesPassed: 200 * DAY });
  assert.equal(off.season, SIRE_OFF_SEASON_FACTOR);
  assert.equal(off.inSeason, false);
  const edge = getSireQualityState(chat, '精', { minutesPassed: 70 * DAY }).season;
  assert.ok(Math.abs(edge - 0.8) < 1e-9, `交界 ${edge}`);
  const nearEdge = getSireQualityState(chat, '精', { minutesPassed: 70 * DAY - 10 }).season;
  assert.ok(Math.abs(nearEdge - edge) < 0.01);
  // 进度条：这一段已过天数与总长
  const during = getSireQualityState(chat, '精', { minutesPassed: 30 * DAY });
  assert.equal(during.seasonLength, 70);
  assert.ok(Math.abs(during.seasonElapsed - 30) < 1e-9);
  assert.equal(off.seasonLength, 295);
  assert.ok(Math.abs(off.seasonElapsed - 130) < 1e-9);
  assert.equal(getSireQualityState(chat, '人').seasonLength, null);
});

test('精方建档对齐同族卵方的季节；扶她读她卵方的乏情', () => {
  const chat = state.createEmptyChatState();
  const elf = register(chat, '甲', '精灵');
  Object.assign(elf.profile.base, { stage: '乏情期', days: 100, seasonCycle: 0 });
  upsertSireRecord(chat, '精', { race: '精灵' });
  const phase = getSireSeasonPhase(chat.sires['精'], chat.minutesPassed);
  assert.ok(Math.abs(phase - getCharacterSeasonPhase(elf.profile)) < 1e-6);
  assert.equal(getSireQualityState(chat, '精').inSeason, false);

  upsertSireRecord(chat, '甲', { spermQuality: 2 });
  assert.equal(chat.sires['甲'].seasonOrigin, null, '扶她不存季节起点');
  assert.equal(getSireQualityState(chat, '甲').season, SIRE_OFF_SEASON_FACTOR);
  elf.profile.base.stage = '卵泡期';
  assert.equal(getSireQualityState(chat, '甲').season, 1);
});

test('射精当下记有效品质快照，之后时间推进不改已射入的', () => {
  const chat = chatWith('艾拉', '精灵', { stage: '卵泡期' });
  upsertSireRecord(chat, '精', { race: '精灵', spermQuality: 2 });
  chat.sires['精'].seasonOrigin = -200 * DAY;
  const expected = getSireQualityState(chat, '精').effective;
  call(chat, 'bsAddSperm', { female: '艾拉', male: '精', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '精', action: 'deposit', amount: 10 });
  const contacts = chat.characters['艾拉'].profile.base.spermContacts || chat.characters['艾拉'].profile.base.sperms;
  const source = contacts.find((item) => item.male === '精');
  assert.ok(Math.abs(source.quality - expected) < 1e-9);
  assert.ok(source.quality < 2, '非繁殖季，品质比档案低');
});

test('摘要行：品质分级看当下品质，另写存量与季节', () => {
  const chat = state.createEmptyChatState();
  upsertSireRecord(chat, '精', { race: '精灵', spermQuality: 1 });
  chat.sires['精'].seasonOrigin = -200 * DAY;
  chat.sires['精'].reserve = 0.3;
  chat.sires['精'].reserveAt = 0;
  const [entry] = buildSirePromptEntries(chat);
  assert.match(entry.condition, /存量很低/);
  assert.match(entry.condition, /非繁殖季/);
});

// ── 存档 v11 → v12 ─────────────────────────────

test('v11 存档迁移：精方补季节起点（对齐同族卵方），没有季节的种族留空；快照一并补', () => {
  const ctx = { chatId: 'v12-migrate', chat: [{ name: 'A', is_user: false, mes: '……' }], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const old = state.createEmptyChatState();
  const elf = register(old, '甲', '精灵');
  Object.assign(elf.profile.base, { stage: '乏情期', days: 120, seasonCycle: 0 });
  old.minutesPassed = 30 * DAY;
  old.sires['精'] = { race: '精灵', spermQuality: 1, createdAt: 0 };
  old.sires['人'] = { race: '人类', spermQuality: 1, createdAt: 0 };
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  for (const snapshot of old.snapshots) {
    // 旧快照里的精方也没有起点
    if (snapshot.state?.sires) for (const record of Object.values(snapshot.state.sires)) delete record.seasonOrigin;
  }
  old.schemaVersion = 11;
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 14);
  const phase = getSireSeasonPhase(migrated.sires['精'], migrated.minutesPassed);
  assert.ok(Math.abs(phase - getCharacterSeasonPhase(migrated.characters['甲'].profile)) < 1e-6);
  assert.equal(migrated.sires['人'].seasonOrigin, null);
  assert.equal(migrated.sires['精'].swordOffset, 0);
  assert.equal(migrated.sires['精'].reserve, 1);
  assert.equal(migrated.sires['精'].reserveAt, migrated.minutesPassed, '存量从迁移当下起算，不把建档以来都算成禁欲');
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots.at(-1));
  assert.ok(Number.isFinite(Number(migrated.sires['精'].seasonOrigin)));
});

test('第一次注册照物种重抽阶段：天使多半落在乏情期（1.2.3 起预设状态按人类抽，从没抽到过乏情）', () => {
  let dormant = 0;
  for (let i = 0; i < 200; i += 1) {
    const chat = state.createEmptyChatState();
    if (register(chat, 'A', '天使').profile.base.stage === '乏情期') dormant += 1;
  }
  assert.ok(dormant > 140, `乏情 ${dormant}/200`);
  // 重新注册已有角色沿用原本的阶段
  const chat = state.createEmptyChatState();
  const angel = register(chat, 'A', '天使');
  Object.assign(angel.profile.base, { stage: '排卵期', days: 1 });
  assert.equal(register(chat, 'A', '天使').profile.base.stage, '排卵期');
});

test('剑鞘与品质给人与模型看的都是文字，不送偏移数字', () => {
  assert.equal(describeSwordOffset(0), '与体型相称');
  assert.equal(describeSwordOffset(0, { short: true }), '相称');
  assert.equal(describeSwordOffset(1), '偏大');
  assert.equal(describeSwordOffset(-2), '短小');
  assert.equal(describeSheathOffset(0), '适中');
  assert.equal(describeSheathOffset(-0.5), '偏浅');
  assert.equal(describeSheathOffset(1), '很深');
  assert.equal(describeSheathOffset(0, 1), '适中，经产后明显松宽');
  assert.deepEqual([0.25, 0.6, 1, 2, 4].map(getSpermQualityTier), ['稀薄', '偏弱', '一般', '旺盛', '极旺']);
  const chat = state.createEmptyChatState();
  upsertSireRecord(chat, '凯', { race: '人类', swordOffset: 1.5 });
  const [entry] = buildSirePromptEntries(chat);
  assert.equal(entry.sword, '硕大');
  assert.equal('swordOffset' in entry, false);
});

test('作弊：品质锁在档案值，无视繁殖季与存量；只有使用者能开', () => {
  const chat = chatWith('艾拉', '精灵', { stage: '卵泡期' });
  upsertSireRecord(chat, '精', { race: '精灵', spermQuality: 2, alwaysPeak: true });
  chat.sires['精'].seasonOrigin = -200 * DAY;
  const state = getSireQualityState(chat, '精');
  assert.equal(state.alwaysPeak, true);
  assert.equal(state.effective, 2, '非繁殖季也照档案值');
  call(chat, 'bsAddSperm', { female: '艾拉', male: '精', action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '精', action: 'deposit', amount: 10 });
  const contacts = chat.characters['艾拉'].profile.base.spermContacts || chat.characters['艾拉'].profile.base.sperms;
  assert.equal(contacts.find((item) => item.male === '精').quality, 2);
  assert.equal(chat.sires['精'].reserve, 1, '射精不扣存量');
  const [entry] = buildSirePromptEntries(chat);
  assert.equal(entry.condition, undefined, '不写非繁殖季、存量偏低');
  // 关掉后回到正常计算；重新注册没传就保留原本的开关
  upsertSireRecord(chat, '精', { race: '精灵' });
  assert.equal(chat.sires['精'].alwaysPeak, true);
  upsertSireRecord(chat, '精', { race: '精灵', alwaysPeak: false });
  assert.ok(getSireQualityState(chat, '精').effective < 2);
  assert.equal(sanitizeSireExtractionResult({ alwaysPeak: true }).alwaysPeak, undefined, '模型不能开作弊');
});
