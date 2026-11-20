// 显示用的颜色（孕体特写的肤色、乳头色）：只给画面用，不送提示词；旧存档迁移补上空的设定。
import assert from 'node:assert/strict';
import test from 'node:test';

import { BELLY_DEFAULT_PALETTE, BELLY_NIPPLE_BASE, createBellyPalette, createBellyThemePalette } from '../scripts/belly_render.js';
import { DISPLAY_NIPPLE_PRESETS, DISPLAY_SKIN_PRESETS, normalizeDisplayColor, normalizeDisplayColors } from '../scripts/display_colors.js';
import * as state from '../scripts/state.js';
import { CHAT_STATE_SCHEMA_VERSION, migrateCharacters } from '../scripts/state_migration.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

test('颜色正规化：#rgb 与大写都认得，其余一律 null', () => {
  assert.equal(normalizeDisplayColor('#ABC'), '#aabbcc');
  assert.equal(normalizeDisplayColor(' #D4907F '), '#d4907f');
  for (const bad of ['red', '#12345', '', null, undefined, 12]) assert.equal(normalizeDisplayColor(bad), null);
  assert.deepEqual(normalizeDisplayColors({ skinColor: '#fff', nippleColor: 'x', extra: 1 }), { skinColor: '#ffffff', nippleColor: null, hairColor: null });
  assert.deepEqual(normalizeDisplayColors(null), { skinColor: null, nippleColor: null, hairColor: null });
});

test('色票里的「预设」就是预设色表的基准色', () => {
  assert.equal(DISPLAY_SKIN_PRESETS.find((p) => p.label === '预设').color, BELLY_DEFAULT_PALETTE.skin[3]);
  assert.equal(DISPLAY_NIPPLE_PRESETS.find((p) => p.label === '预设').color, BELLY_NIPPLE_BASE);
});

test('v17 → v18：角色补上空的 display；已有的颜色正规化后保留', () => {
  assert.equal(CHAT_STATE_SCHEMA_VERSION, 18);
  const characters = { A: { profile: { base: {} } }, B: { profile: { base: {}, display: { skinColor: '#ABC' } } } };
  migrateCharacters(characters, 17);
  assert.deepEqual(characters.A.profile.display, { skinColor: null, nippleColor: null, hairColor: null });
  assert.deepEqual(characters.B.profile.display, { skinColor: '#aabbcc', nippleColor: null, hairColor: null });
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

test('主题：全彩照自订色、半彩保留主题色相只调深浅、单色不套', () => {
  const womb = { bg: '#111111', wall: '#9a6b8c', wallDark: '#6b4562', wallLight: '#c497b5', shine: '#f0d8ea', cavity: '#4a2d44', cavityDeep: '#301c2c', fluid: '#7b5a74', shadow: '#5a3d55', void: '#140c13', frame: '#222222', waterLight: '#dddddd', water: '#bbbbbb', signal: '#99cc99', fluidLight: '#eeeeee', ink: '#111111', fetusLight: '#eeeeee', blood: '#aa2222', wallDarkAlt: '#000000' };
  const half = createBellyThemePalette(womb, { theme: 'unknown' });
  const halfDark = createBellyThemePalette(womb, { theme: 'unknown', skin: '#7e4e35' });
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255); const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min; if (!d) return 0; const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
  const lum = (hex) => [1, 3, 5].reduce((n, at, k) => n + parseInt(hex.slice(at, at + 2), 16) * [0.299, 0.587, 0.114][k], 0);
  assert.ok(lum(halfDark.skin[3]) < lum(half.skin[3]) * 0.7, '半彩：深肤色变深');
  assert.ok(Math.abs(hue(halfDark.skin[3]) - hue(half.skin[3])) < 3, '半彩：色相留主题的');
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
