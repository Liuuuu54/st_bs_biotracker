// 育儿袋（1.6.0）：外观开关、袋里的幼体、孕体特写上的袋口与鼓起
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createBellyAnimator } from '../scripts/belly_anim.js';
import { decodeBellyData } from '../scripts/belly_data.js';
import { createBellyLayout } from '../scripts/belly_layout.js';
import { buildPouchScene, getPouchDefault, getPouchView } from '../scripts/belly_pouch.js';
import { BELLY_DEFAULT_PALETTE, createBellyPainter } from '../scripts/belly_render.js';
import { normalizeDisplay } from '../scripts/display_colors.js';
import * as state from '../scripts/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = decodeBellyData(fs.readFileSync(path.join(ROOT, 'assets', 'belly', 'closeup-data.bin')));
const layout = createBellyLayout(data);
const painter = createBellyPainter(layout);
const BODY = { sigma: 0, cup: 50, build: 50, hip: 50, count: 1, weight: 1, births: 1, milk: 40, libido: 10, laborPhase: 'none', showBra: true, showShorts: true, strapless: true, navel: 'pop' };

test('种族预设：袋兽族、甲壳族与奇美拉系有袋，子项照基种族；外观子页可以改', () => {
  for (const race of ['袋兽族', '袋兽族-袋鼠', '奇美拉', '白泽', '枭熊', '甲壳族']) assert.equal(getPouchDefault(race), 'on', race);
  for (const race of ['人类', '原兽族', '梦貘', '东方龙']) assert.equal(getPouchDefault(race), 'off', race);
  assert.equal(getPouchView({ race: '人类' }, {}), null);
  assert.deepEqual(getPouchView({ race: '人类' }, { pouch: 'on' }), { brood: null });
  assert.equal(getPouchView({ race: '奇美拉' }, { pouch: 'off' }), null);
  assert.equal(normalizeDisplay({ pouch: 'on' }).pouch, 'on');
  assert.equal(normalizeDisplay({ pouch: true }).pouch, null);
});

test('袋里的幼体只在产后恢复期；格式不对或不在产后恢复就清掉', () => {
  const brood = { count: 2, kind: 'egg' };
  assert.deepEqual(getPouchView({ race: '奇美拉', stage: '产后恢复', pouchBrood: brood }, {}).brood, brood);
  assert.equal(getPouchView({ race: '奇美拉', stage: '卵泡期', pouchBrood: brood }, {}).brood, null);
  const ch = state.createDefaultFemaleState('A');
  Object.assign(ch.profile.base, { stage: '产后恢复', pouchBrood: brood });
  state.normalizeCharacterPsychologyState(ch);
  assert.deepEqual(ch.profile.base.pouchBrood, brood);
  ch.profile.base.stage = '卵泡期';
  state.normalizeCharacterPsychologyState(ch);
  assert.equal(ch.profile.base.pouchBrood, undefined);
});

test('袋口：中心对齐胯部、不被妊娠纹截断；空袋又怀孕时开在孕肚上', () => {
  const flat = buildPouchScene(layout, painter, { ...BODY, hormStage: 'postpartum', days: 0, stageProgress: 100, pouch: { brood: null, recovery: 0 } }, BELLY_DEFAULT_PALETTE);
  assert.ok(flat.pouch.width >= 20 && flat.pouch.crotch > flat.pouch.left, JSON.stringify(flat.pouch));
  const term = { ...BODY, hormStage: 'pregnant', days: 270, stageProgress: 50, navel: 'outie', showBra: false, showShorts: false, strapless: false, pouch: { brood: null, recovery: 0 } };
  const marked = buildPouchScene(layout, painter, { ...term, stretchMarks: 'both' }, BELLY_DEFAULT_PALETTE).pouch;
  const plain = buildPouchScene(layout, painter, { ...term, stretchMarks: 'off' }, BELLY_DEFAULT_PALETTE).pouch;
  assert.equal(marked.width, plain.width);
  assert.ok(plain.width >= 20);
});

test('袋里有幼体：袋口以下往前鼓、随恢复长大；胎形才探头', () => {
  const front = (scene, y) => { const { width: W } = layout.grid; let x = 0; while (x < W && !scene.rest.label[y * W + x]) x += 1; return x; };
  const at = (recovery, kind = 'fetus') => buildPouchScene(layout, painter, { ...BODY, hormStage: 'postpartum', days: 0, stageProgress: 100, pouch: { brood: { count: 2, kind }, recovery } }, BELLY_DEFAULT_PALETTE);
  const empty = buildPouchScene(layout, painter, { ...BODY, hormStage: 'postpartum', days: 0, stageProgress: 100, pouch: { brood: null, recovery: 0 } }, BELLY_DEFAULT_PALETTE);
  const grown = at(1);
  const below = grown.pouch.row + 4;
  assert.ok(front(grown, below) < front(empty, below), '袋口以下比空袋往前');
  assert.ok(grown.pouch.peek && grown.pouch.peek.rx > at(0).pouch.peek.rx, '探头随恢复变宽');
  assert.equal(at(1, 'egg').pouch.peek, null);
  // 动画器接上袋子：画得出来、不画肚脐
  const animator = createBellyAnimator(layout, painter, { random: () => 0.5 });
  animator.setState({ ...BODY, hormStage: 'postpartum', days: 0, stageProgress: 100, pouch: { brood: { count: 2, kind: 'fetus' }, recovery: 1 } }, BELLY_DEFAULT_PALETTE);
  assert.ok(animator.tick(1000).pixels.some((pixel) => pixel !== 0));
});
