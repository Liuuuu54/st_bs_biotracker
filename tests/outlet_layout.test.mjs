// 外口布局（1.6.0）：产道从哪个口出来。种族预设、角色覆写、肛交照布局走、孕夫默认肛门分娩、提示词只送文字
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { normalizeSireRecord } from '../scripts/sires.js';
import {
  ALL_BUILTIN_RACES, getCharacterOutletLayout, getRaceCanalTexture, getRaceOutletLayout, getRaceOutletOptions, normalizeOutletLayout,
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
  assert.equal(base(human).analPenetration?.source, '乙');
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
    extensionSettings: { bs_biotracker: { enabled: true, genitalDetail: true, chatStates: { 'outlet-chat': chat } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const sent = buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state;
  assert.equal(sent.A.profile.base.outletLayout, '泄殖腔（单一外口）');
  assert.match(sent.A.profile.base.canalTexture, /晶面/);
  assert.equal('outletLayout' in sent.B.profile.base, false);
  assert.equal('canalTexture' in sent.B.profile.base, false);
});

test('注册时可选的布局：种族预设在前，每族都能选分离开口，龙、凤凰与虫系另有选项', () => {
  assert.deepEqual(getRaceOutletOptions('人类'), ['separate']);
  assert.deepEqual(getRaceOutletOptions('奇美拉'), ['cloaca', 'separate']);
  assert.deepEqual(getRaceOutletOptions('凤凰'), ['separate', 'cloaca']);
  assert.ok(getRaceOutletOptions('怪虫类').includes('cloaca'));
  for (const race of ALL_BUILTIN_RACES) {
    const options = getRaceOutletOptions(race);
    assert.equal(options[0], getRaceOutletLayout(race), race);
    assert.ok(!options.includes('anal') && !options.includes('penile'), race);
  }
});

test('性转：孕夫完全变女回到种族预设；长出子宫时可照剧情指定外口', () => {
  const chat = setup();
  chat.sires = { 雷恩: normalizeSireRecord({ race: '精灵', age: 30 }), 凤: normalizeSireRecord({ race: '凤凰', age: 30 }) };
  const transform = (female, extra) => applyToolCall(chat, { name: 'bsRecordExperience', arguments: { female, action: 'transform', time: 'x', content: '禁术', ...extra } });
  assert.equal(transform('雷恩', { body: 'gainWomb' }).applied, true);
  assert.equal(base(chat, '雷恩').outletLayout, 'anal');
  const lost = transform('雷恩', { body: 'loseSword' });
  assert.equal(lost.applied, true, lost.message);
  assert.equal(base(chat, '雷恩').outletLayout, undefined, '没有阴茎就不是孕夫，照种族');
  assert.equal(transform('凤', { body: 'gainWomb', outletLayout: 'tube' }).applied, false, '范围外');
  const chosen = transform('凤', { body: 'gainWomb', outletLayout: 'cloaca' });
  assert.equal(chosen.applied, true, chosen.message);
  assert.equal(base(chat, '凤').outletLayout, 'cloaca');
  assert.equal(transform('A', { body: 'gainSword', outletLayout: 'anal' }).applied, false, '只给长出子宫');
});

test('精量：系统照档案倍率乘 amount，提示词写成一句；一般不存', async () => {
  const { describeSireSword, normalizeSemenVolume } = await import('../scripts/sires.js');
  assert.equal(normalizeSireRecord({ semenVolume: 1 }).semenVolume, undefined);
  assert.equal(normalizeSireRecord({ semenVolume: 3 }).semenVolume, undefined, '只收五档');
  assert.equal(normalizeSemenVolume(4), 4);
  assert.match(describeSireSword(normalizeSireRecord({ semenVolume: 4 })), /精量很多/);
  const chat = setup();
  chat.sires = { 乙: normalizeSireRecord({ race: '人类', semenVolume: 4 }) };
  sperm(chat, { action: 'insert' });
  const result = sperm(chat, { action: 'deposit', amount: 10 });
  assert.equal(result.applied, true, result.message);
  assert.equal(vaginalTotal(chat), 40);
  assert.match(result.message, /10 × 4 ＝ 40/);
});

test('提示词：外口的样子与育儿袋（含袋里的幼体）有才送，原始栏位不送', () => {
  const chat = setup({ race: '奇美拉', stage: '产后恢复', pouchBrood: { count: 2, kind: 'fetus' }, isHere: true });
  chat.characters.B = state.createDefaultFemaleState('B');
  chat.characters.B.initialized = true;
  Object.assign(chat.characters.B.profile.base, { stage: '卵泡期', days: 0, race: '人类', bodySize: 4, isHere: true });
  const ctx = {
    chatId: 'look-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, genitalDetail: true, chatStates: { 'look-chat': chat } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const sent = buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state;
  assert.match(sent.A.profile.base.outletLook, /短软褶/);
  assert.match(sent.A.profile.base.pouch, /没有肚脐.*2 个幼体/);
  assert.equal('pouchBrood' in sent.A.profile.base, false);
  assert.equal('outletLook' in sent.B.profile.base, false);
  assert.equal('pouch' in sent.B.profile.base, false);
});

test('变量页手改：锁住的栏位换回原本的，其余照改', async () => {
  const { LOCKED_SIRE_FIELDS, keepLockedFields } = await import('../scripts/sires.js');
  const before = normalizeSireRecord({ swordOffset: 1, swordTip: 'tapered', swordKnot: true, spermQuality: 2 });
  const edited = { ...before, swordOffset: -2, swordTip: 'flared', swordBarbs: true, spermQuality: 3 };
  delete edited.swordKnot;
  assert.equal(keepLockedFields(before, edited, LOCKED_SIRE_FIELDS), true);
  assert.deepEqual([edited.swordOffset, edited.swordTip, edited.swordKnot, 'swordBarbs' in edited, edited.spermQuality], [1, 'tapered', true, false, 3]);
  const body = { outletLayout: 'separate' };
  const next = { outletLayout: 'tube', pouch: true, libido: 5 };
  assert.equal(keepLockedFields(body, next, ['outletLayout', 'pouch']), true);
  assert.deepEqual(next, { outletLayout: 'separate', libido: 5 });
  assert.equal(keepLockedFields({ a: 1 }, { a: 1 }, ['a']), false);
});

test('百科的生殖器区块：外口、外观、产道、雄性、育儿袋，写成百科的说法', async () => {
  const { buildGenitalSection, renderRaceSheetHtml } = await import('../scripts/encyclopedia_sheet.js');
  const rows = (race) => Object.fromEntries(buildGenitalSection(race).rows.map((row) => [row.label, row]));
  assert.equal(rows('人类')['外口'].value, '分离开口');
  assert.match(rows('奇美拉')['外口'].note, /泄殖腔.*人形的个体/);
  assert.match(rows('奇美拉')['外观'].value, /短软褶/);
  assert.equal(rows('奇美拉')['育儿袋'].value, '有');
  assert.equal('育儿袋' in rows('人类'), false, '没有袋就不列');
  assert.equal('外观' in rows('人类'), false, '跟人类一样就不列');
  assert.match(rows('宝石人')['产道'].note, /晶面/);
  assert.match(rows('地狱犬')['雄性'].value, /球结/);
  const all = buildGenitalSection('奇美拉').rows.map((row) => `${row.value}${row.note || ''}`).join('');
  assert.doesNotMatch(all, /提示词|注册|锁住|系统/, '百科不讲系统怎么用');
  assert.match(renderRaceSheetHtml('人类'), /生殖器/);
});

test('混血的外观：占比最大的那一族，平手从母（写法父x母，取后面的）', async () => {
  const { getVulvaRacePreset } = await import('../scripts/vulva_params.js');
  const { getPouchDefault } = await import('../scripts/belly_pouch.js');
  assert.equal(getRaceOutletLayout('3/4蛇人x1/4人类'), 'cloaca');
  assert.equal(getRaceOutletLayout('1/4蛇人x3/4人类'), 'separate');
  assert.equal(getRaceOutletLayout('1/2人类x1/2蛇人'), 'cloaca', '平手从母（后面的蛇人）');
  assert.equal(getRaceOutletLayout('1/2蛇人x1/2人类'), 'separate');
  assert.equal(getRaceOutletLayout('1/2人类x1/2蛇人', null, '人类'), 'separate', '知道母亲就照母亲');
  assert.equal(getVulvaRacePreset('1/2人类x1/2蛇人').layout, 'single');
  assert.equal(getPouchDefault('1/2人类x1/2奇美拉'), 'on');
});

test('生殖器细节没开（预设）：不送外口、外观与剑外形，bsAddSperm 只记产道、不锁、不演破处', async () => {
  const { getTrackerToolDefinitions } = await import('../scripts/tracker.js');
  const chat = setup({ race: '奇美拉', isHere: true });
  chat.sires = { 犬: normalizeSireRecord({ race: '地狱犬', swordTip: 'tapered', swordKnot: true, swordLock: true, semenVolume: 4 }) };
  const ctx = {
    chatId: 'off-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'off-chat': chat } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  const b = payload.existing_state.A.profile.base;
  assert.equal('outletLayout' in b || 'outletLook' in b || 'canalTexture' in b, false);
  assert.match(b.pouch, /育儿袋/, '育儿袋是孕体特写的，照送');
  const sire = payload.registered_sires.find((entry) => entry.name === '犬');
  assert.doesNotMatch(sire.sword || '', /尖锥|球结|锁住/);
  assert.match(sire.sword || '', /精量很多/);
  const tool = getTrackerToolDefinitions(state.getSettings(ctx), {}).find((item) => item.name === 'bsAddSperm');
  assert.equal('channel' in tool.input_schema.properties, false);
  assert.doesNotMatch(tool.description, /肛交照样用本工具|锁住/);
  // 工具端：开关关着（追踪时照设定写进 chatState）
  chat.genitalDetail = false;
  chat.characters.A.profile.experience = { ...(chat.characters.A.profile.experience || {}), virginity: null };
  assert.equal(sperm(chat, { male: '犬', race: '地狱犬', action: 'insert', channel: 'anal' }).applied, false);
  assert.equal(sperm(chat, { male: '犬', race: '地狱犬', action: 'insert' }).applied, true);
  assert.equal(chat.characters.A.profile.visualCue.type, 'insert', '不演破处');
  sperm(chat, { male: '犬', race: '地狱犬', action: 'deposit', amount: 10 });
  assert.equal(base(chat).penetrationLocked, undefined, '不锁');
});
