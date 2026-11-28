// 角色状态 → 外阴正面图参数（1.6.0）
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { normalizeSireRecord } from '../scripts/sires.js';
import { VULVA_DEFAULTS } from '../scripts/vulva_render.js';
import { VULVA_RACE_PRESETS } from '../scripts/vulva_race_presets.js';
import { buildVulvaParams, buildWombAppearance, fitTierFromDiff, getLockKnot, getVulvaRacePreset, mixHex } from '../scripts/vulva_params.js';

function setup(extra = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '卵泡期', days: 0, race: '人类', bodySize: 4, libido: 0, ...extra });
  chat.characters.A = ch;
  return chat;
}
const params = (chat, name = 'A') => buildVulvaParams(chat, name);

test('种族预设有 129 族，简体、繁体、子项与混血都查得到', () => {
  assert.equal(Object.keys(VULVA_RACE_PRESETS).length, 129);
  assert.equal(getVulvaRacePreset('蛇人').layout, 'single');
  assert.equal(getVulvaRacePreset('鬣狗族').layout, 'tube');
  assert.equal(getVulvaRacePreset('鬣狗族'), getVulvaRacePreset('鬣狗族-斑'));
  assert.equal(getVulvaRacePreset('1/4蛇人x3/4人类'), getVulvaRacePreset('人类'));
  assert.equal(getVulvaRacePreset('奇美拉')['cloacal-rim'], 'marsupial');
});

test('布局照外口布局：分离、泄殖腔、管状、阴茎分娩、肛门分娩', () => {
  assert.equal(params(setup()).layout, 'human');
  assert.equal(params(setup({ race: '蛇人' })).layout, 'single');
  assert.equal(params(setup({ race: '鬣狗族' })).layout, 'tube');
  const penile = params(setup({ outletLayout: 'penile' }));
  assert.deepEqual([penile.layout, penile['sire-form']], ['tube', 'urethral']);
  assert.equal(params(setup({ outletLayout: 'anal' })).layout, 'anal');
});

test('扶她：分离开口叠阴茎、管状变共管、泄殖腔是鞘内剑；剑外形照精方档', () => {
  const chat = setup();
  chat.sires = { A: normalizeSireRecord({ swordOffset: 1, swordTip: 'tapered', swordKnot: true, swordShaft: 'veined', swordScrotum: false, spermQuality: 4 }) };
  const futa = params(chat);
  assert.deepEqual([futa['human-sire'], futa['sword-offset'], futa.swordTip, futa.swordKnot, futa.swordShaft, futa.swordScrotum, futa['sperm-quality']],
    ['on', '1', 'tapered', 'on', 'veined', 'hidden', '2']);
  chat.characters.A.profile.base.race = '鬣狗族';
  assert.equal(params(chat)['sire-form'], 'dual');
  chat.characters.A.profile.base.race = '蛇人';
  assert.equal(params(chat)['single-sire'], 'on');
});

test('泄殖腔鞘内剑的角色：被插入、插别人、两者都有', () => {
  const chat = setup({ race: '蛇人' });
  chat.sires = { A: normalizeSireRecord({}) };
  chat.characters.B = state.createDefaultFemaleState('B');
  assert.equal(params(chat)['single-role'], 'idle');
  Object.assign(chat.characters.B.profile.base, { penetrationState: 'inserted', penetrationSource: 'A' });
  assert.equal(params(chat)['single-role'], 'giving');
  Object.assign(chat.characters.A.profile.base, { penetrationState: 'inserted', penetrationSource: '乙' });
  assert.equal(params(chat)['single-role'], 'both');
});

test('肤色：外观子页自订的优先，内侧底色与肛门色照预览推算', () => {
  const chat = setup();
  chat.characters.A.profile.display = { skinColor: '#7E4E35' };
  const p = params(chat);
  assert.equal(p.skin, '#7e4e35');
  assert.equal(p.tone, mixHex('#7e4e35', '#f7ddda', 0.43));
  assert.equal(p['anus-color'], mixHex('#7e4e35', p.tone, 0.14));
  assert.equal(params(setup()).skin, '#c85f78', '没有种族肤色照预览的基础色');
});

test('孕期、性欲、经产、产后回缩、宫脱', () => {
  assert.equal(params(setup({ stage: '孕早期' })).pregnancy, '1');
  assert.equal(params(setup({ stage: '孕中期' })).pregnancy, '2');
  assert.equal(params(setup({ stage: '临产期' })).pregnancy, '3');
  assert.equal(params(setup({ stage: '卵泡期' })).pregnancy, '0');
  const chat = setup();
  chat.characters.A.profile.experience = { ...(chat.characters.A.profile.experience || {}), naturalBirthExperience: 5 };
  assert.equal(params(chat).parity, '3');
  assert.equal(params(setup()).recovery, '100');
  assert.equal(params(setup({ prolapse: 2.4 })).prolapse, '2');
});

test('第二产程照最前面那一胎降到哪里', () => {
  const chat = setup({ stage: '第二产程' });
  chat.characters.A.profile.pregnant = { ...(chat.characters.A.profile.pregnant || {}), fetuses: [{ descentStage: 1 }, { descentStage: 2 }], pushFatigue: 40 };
  const p = params(chat);
  assert.deepEqual([p.descent, p.fatigue], ['2', '40']);
  assert.equal(params(setup()).descent, '0');
});

test('体型契合的差距换成 −4…4；双穴打开双剑', () => {
  assert.deepEqual([0, 0.4, 1, -2, 3, 5].map(fitTierFromDiff), [0, 0, 1, -2, 3, 4]);
  const chat = setup({ penetrationState: 'inserted', penetrationSource: '乙', penetrationChannel: 'both', penetrationFit: { male: '乙', diff: 2 } });
  const p = params(chat);
  assert.deepEqual([p.channel, p.swordTwin, p.fit], ['both', 'on', '2']);
});

test('没给的参数照预览预设', () => {
  const p = params(setup());
  for (const key of Object.keys(VULVA_DEFAULTS)) assert.ok(key in p, key);
});

test('主题配色：全彩只换背景、半彩打色光、单色整张换成子宫图的色带', async () => {
  const { buildVulvaTheme } = await import('../scripts/vulva_params.js');
  const { getUterusPalette } = await import('../scripts/uterus_render.js');
  const { BELLY_THEME_MODES, halfTint } = await import('../scripts/belly_render.js');
  const params = { skin: '#7e4e35', tone: '#a07060', 'anus-color': '#7e4e35', 'material-light': '#c09080', layout: 'human' };
  const options = (name, womb) => ({ theme: name, modes: BELLY_THEME_MODES, tint: halfTint(womb.wall), rampThemes: new Set(['ink', 'constructivism']) });
  const sakura = getUterusPalette({ name: 'sakura' });
  const full = buildVulvaTheme(sakura, options('sakura', sakura));
  assert.equal(full.palette.background, sakura.bg);
  assert.equal(full.palette.wall, '#c85f78', '全彩的肉色照写实');
  assert.equal(full.recolor(params).skin, '#7e4e35', '全彩保留种族与自订肤色');
  const retro = getUterusPalette({ name: 'retro' });
  const mono = buildVulvaTheme(retro, options('retro', retro));
  assert.equal(mono.palette.wall, retro.wall);
  assert.equal(mono.recolor(params).skin, retro.wall, '单色不套肤色');
  const ink = getUterusPalette({ name: 'ink' });
  assert.ok(buildVulvaTheme(ink, options('ink', ink)).brush, '水墨要做笔触');
  const fantasy = getUterusPalette({ name: 'fantasy' });
  const half = buildVulvaTheme(fantasy, options('fantasy', fantasy));
  assert.notEqual(half.recolor(params).skin, '#7e4e35', '半彩打上主题色光');
  assert.equal(half.recolor(params).layout, 'human');
  assert.equal(buildVulvaTheme(null).palette.wall, '#c85f78', '没有主题色表照预览原色');
});

test('子宫剖面的种族外观：卵巢、产道质感、叠色；肛门分娩不画卵巢', () => {
  const human = buildWombAppearance(setup().characters.A);
  assert.deepEqual([human.ovary, human.canalMaterial, human.overlay], ['compact', 'folds', null]);
  const crystal = buildWombAppearance(setup({ race: '宝石人' }).characters.A);
  assert.equal(crystal.ovary, getVulvaRacePreset('宝石人').ovary);
  assert.equal(crystal.canalMaterial, getVulvaRacePreset('宝石人')['canal-material'] || 'folds');
  assert.equal(buildWombAppearance(setup({ outletLayout: 'anal' }).characters.A).ovary, 'none');
});

test('锁住的球结照插着的那位精方', () => {
  const chat = setup({ penetrationState: 'spent', penetrationSource: '乙', penetrationLocked: true });
  chat.sires = { 乙: normalizeSireRecord({ swordKnot: true }) };
  assert.equal(getLockKnot(chat, chat.characters.A), true);
  chat.sires.乙 = normalizeSireRecord({ swordKnot: false });
  assert.equal(getLockKnot(chat, chat.characters.A), false);
  delete chat.characters.A.profile.base.penetrationLocked;
  chat.sires.乙 = normalizeSireRecord({ swordKnot: true });
  assert.equal(getLockKnot(chat, chat.characters.A), false, '没锁住就不画');
});

test('流出：破水后续流＞经血＞浸满＞灌满；肛内残精只在分开的肛门画', () => {
  assert.equal(params(setup()).flow, 'none');
  assert.equal(params(setup({ stage: '月经期' })).flow, 'period');
  const womb = (extra) => buildVulvaParams(setup(), 'A', undefined, { womb: extra }).flow;
  assert.equal(womb({ semenFull: true }), 'full');
  assert.equal(womb({ semenFull: true, semenSoaked: true }), 'soaked');
  const labor = setup({ stage: '第一产程' });
  labor.characters.A.profile.pregnant = { ...(labor.characters.A.profile.pregnant || {}), fetuses: [{ embryoId: 'e1', amnionDurability: 0 }] };
  assert.equal(params(labor).flow, 'water-flow');
  labor.characters.A.profile.pregnant.fetuses[0].amnionDurability = 60;
  assert.equal(params(labor).flow, 'none');
  assert.equal(params(setup({ analSemen: 12 }))['anal-residue'], 'on');
  assert.equal(params(setup({ analSemen: 12, race: '蛇人' }))['anal-residue'], 'off', '泄殖腔的肛门就是产道');
  assert.equal(params(setup())['anal-residue'], 'off');
});

test('外阴的两条外观拉杆：成熟度与外观痕迹照外观子页，没设是 50', () => {
  const chat = setup();
  assert.deepEqual([params(chat)['visual-maturity'], params(chat)['visual-traces']], ['50', '50']);
  chat.characters.A.profile.display = { vulvaMaturity: 20, vulvaTraces: 95 };
  assert.deepEqual([params(chat)['visual-maturity'], params(chat)['visual-traces']], ['20', '95']);
});

test('处女膜：分离开口、泄殖腔、管状都画，孕夫不画；处女完整、有初次对象剩殘痕', async () => {
  const { getHymenState } = await import('../scripts/vulva_params.js');
  const chat = setup();
  chat.characters.A.profile.experience = { ...(chat.characters.A.profile.experience || {}), virginity: null };
  assert.equal(params(chat).hymen, 'intact');
  chat.characters.A.profile.experience.virginity = '乙';
  assert.equal(params(chat).hymen, 'torn');
  assert.equal(getHymenState(setup({ race: '蛇人' }).characters.A.profile), 'intact', '泄殖腔也有');
  assert.equal(getHymenState(setup({ outletLayout: 'anal' }).characters.A.profile), 'none', '孕夫不画');
});
