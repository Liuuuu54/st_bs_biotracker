// 显示用的外观（孕体特写的肤色、乳头色、乳晕大小、肚脐、妊娠纹）：只给画面用，不送提示词；旧存档迁移补上空的设定。
import assert from 'node:assert/strict';
import test from 'node:test';

import { BELLY_DEFAULT_PALETTE, BELLY_NIPPLE_BASE, createBellyPalette, createBellyThemePalette } from '../scripts/belly_render.js';
import { DISPLAY_NIPPLE_PRESETS, DISPLAY_SKIN_PRESETS, normalizeDisplay, normalizeDisplayColor } from '../scripts/display_colors.js';
import * as state from '../scripts/state.js';
import { CHAT_STATE_SCHEMA_VERSION, migrateCharacters } from '../scripts/state_migration.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

test('正规化：颜色认 #rgb 与大写，选项只认列表里的值，其余一律 null（照预设）', () => {
  assert.equal(normalizeDisplayColor('#ABC'), '#aabbcc');
  assert.equal(normalizeDisplayColor(' #D4907F '), '#d4907f');
  for (const bad of ['red', '#12345', '', null, undefined, 12]) assert.equal(normalizeDisplayColor(bad), null);
  assert.deepEqual(normalizeDisplay({ skinColor: '#fff', nippleColor: 'x', hairColor: '#000', extra: 1 }), { ...{ skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null }, skinColor: '#ffffff' });
  assert.deepEqual(normalizeDisplay(null), { skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null });
  assert.deepEqual(normalizeDisplay({ nippleSize: 1.3, navel: 'faint', navelSize: 'large', stretchMarks: 'both' }), { ...{ skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null }, nippleSize: 1.3, navel: 'faint', navelSize: 'large', stretchMarks: 'both' });
  assert.equal(normalizeDisplay({ stretchMarks: 'auto' }).stretchMarks, 'lower');
  assert.deepEqual(normalizeDisplay({ nippleSize: 7, navel: 'x', navelSize: 3, stretchMarks: 'on' }), { skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null });
});

test('色票里的「预设」就是预设色表的基准色', () => {
  assert.equal(DISPLAY_SKIN_PRESETS.find((p) => p.label === '预设').color, BELLY_DEFAULT_PALETTE.skin[3]);
  assert.equal(DISPLAY_NIPPLE_PRESETS.find((p) => p.label === '预设').color, BELLY_NIPPLE_BASE);
});

test('v17 → v18：角色补上空的 display；已有的颜色正规化后保留', () => {
  assert.equal(CHAT_STATE_SCHEMA_VERSION, 19);
  const characters = { A: { profile: { base: {} } }, B: { profile: { base: {}, display: { skinColor: '#ABC' } } } };
  migrateCharacters(characters, 17);
  assert.deepEqual(characters.A.profile.display, { skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null });
  assert.deepEqual(characters.B.profile.display, { ...{ skinColor: null, nippleColor: null, nippleSize: null, navel: null, navelSize: null, stretchMarks: null, pouch: null }, skinColor: '#aabbcc' });
});

test('全彩：乳头色给了就只换乳晕与乳头，肤色照肤色；没给乳头色时跟着肤色走', () => {
  const pink = createBellyPalette({ nippleBase: '#eaa3a3' });
  assert.deepEqual(pink.skin, [...BELLY_DEFAULT_PALETTE.skin]);
  assert.equal(pink.areolaPale[0], '#eaa3a3');
  assert.notDeepEqual(pink.nippleDark, [...BELLY_DEFAULT_PALETTE.nippleDark]);
  const dark = createBellyPalette({ skinBase: '#7e4e35' });
  assert.equal(dark.skin[3], '#7e4e35');
  assert.notDeepEqual(dark.areolaPale, [...BELLY_DEFAULT_PALETTE.areolaPale]);
});

test('主题：全彩照自订色、半彩是写实色隔着主题色的滤光片看（明度照写实）、单色不套', () => {
  const womb = { bg: '#111111', wall: '#9a6b8c', wallDark: '#6b4562', wallLight: '#c497b5', shine: '#f0d8ea', cavity: '#4a2d44', cavityDeep: '#301c2c', fluid: '#7b5a74', shadow: '#5a3d55', void: '#140c13', frame: '#222222', waterLight: '#dddddd', water: '#bbbbbb', signal: '#99cc99', fluidLight: '#eeeeee', ink: '#111111', fetusLight: '#eeeeee', blood: '#aa2222', wallDarkAlt: '#000000' };
  const half = createBellyThemePalette(womb, { theme: 'unknown' });
  const halfDark = createBellyThemePalette(womb, { theme: 'unknown', skin: '#7e4e35' });
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255); const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min; if (!d) return 0; const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  const lum = (hex) => [1, 3, 5].reduce((n, at, k) => n + parseInt(hex.slice(at, at + 2), 16) * [0.299, 0.587, 0.114][k], 0);
  assert.ok(lum(halfDark.skin[3]) < lum(half.skin[3]) * 0.7, '半彩：深肤色变深');
  const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  // 宫壁偏紫红：预设肤色往那边偏，但不是直接变成宫壁色
  assert.ok(gap(hue(half.skin[3]), hue(womb.wall)) < gap(hue(BELLY_DEFAULT_PALETTE.skin[3]), hue(womb.wall)), '半彩：往主题色相靠');
  assert.notEqual(half.skin[3], womb.wall);
  // 奇幻肤色：冰蓝在主题下仍偏蓝（不会被转成别的颜色）
  const blue = createBellyThemePalette(womb, { theme: 'unknown', skin: '#7fa6d6' }).skin[3];
  assert.ok(gap(hue(blue), 215) < 45, `冰蓝仍偏蓝 ${hue(blue)}`);
  // 明度照写实
  const L = (hex) => { const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255); return (Math.max(r, g, b) + Math.min(r, g, b)) / 2; };
  assert.ok(Math.abs(L(half.skin[3]) - L(BELLY_DEFAULT_PALETTE.skin[3])) < 0.02);
  assert.deepEqual(createBellyThemePalette(womb, { theme: 'wasteland' }).skin[1], womb.wall, '单色主题仍是宫壁色带');
  assert.equal(createBellyThemePalette(womb, { theme: 'iphone', skin: '#7e4e35' }).skin[3], '#7e4e35');
  assert.deepEqual(createBellyThemePalette(womb, { theme: 'retro', skin: '#7e4e35' }).skin, createBellyThemePalette(womb, { theme: 'retro' }).skin);
});

test('追踪送给模型的状态里没有 display', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: { stage: '卵泡期', days: 0, isHere: true, age: 24, race: '人类', vitality: 150, libido: 0, uterinePressure: 10, psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1 },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {}, experience: {}, immune: { metabolism: true }, metabolism: {}, skills: [], talents: [], children: [], notify: {},
      display: { skinColor: '#7e4e35', nippleColor: '#eaa3a3' },
    },
  };
  const ctx = {
    chatId: 'display-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'display-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  assert.equal('display' in payload.existing_state.A.profile, false);
  assert.equal(JSON.stringify(payload).includes('#7e4e35'), false);
});

test('特写：乳晕大小、肚脐、妊娠纹照外观设定画；妊娠纹预设关', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { decodeBellyData } = await import('../scripts/belly_data.js');
  const { createBellyLayout } = await import('../scripts/belly_layout.js');
  const { createBellyPainter } = await import('../scripts/belly_render.js');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const layout = createBellyLayout(decodeBellyData(fs.readFileSync(path.join(root, 'assets', 'belly', 'closeup-data.bin'))));
  const painter = createBellyPainter(layout);
  const base = { sigma: 0, cup: 100, build: 50, hip: 50, days: 280, count: 3, weight: 1, hormStage: 'pregnant', stageProgress: 30, births: 2, milk: 20, libido: 10, laborPhase: 'none', showBra: false, showShorts: false, strapless: false };
  const paint = (over = {}) => painter.paint(layout.layout({ ...base, ...over })).pixels;
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
  const plain = paint();
  assert.equal(diff(plain, paint({ stretchMarks: 'off' })), 0, '妊娠纹预设关');
  assert.ok(diff(plain, paint({ stretchMarks: 'lower' })) > 10, '三胎足月、生过两胎：下腹有纹');
  assert.ok(diff(plain, paint({ stretchMarks: 'navel' })) > 10, '脐周有纹');
  assert.ok(diff(paint({ stretchMarks: 'both' }), paint({ stretchMarks: 'lower' })) > 0, '两者都有＝下腹再加脐周');
  assert.ok(diff(plain, paint({ navel: 'none' })) > 0, '没有肚脐');
  assert.ok(diff(plain, paint({ navel: 'innie' })) > 0, '不外凸：足月三胎时与一般（外凸）不同');
  assert.ok(diff(paint({ nippleScale: 1.6 }), plain) > diff(paint({ nippleScale: 1.3 }), plain), '乳晕越大差越多');
  // 未孕、没生过：自动也没有纹
  const empty = { ...base, days: 0, count: 1, hormStage: 'cycle', births: 0 };
  assert.equal(diff(paint(empty), paint({ ...empty, stretchMarks: 'lower' })), 0);
});
