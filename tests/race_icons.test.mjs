// 种族图示：每个种族与衍生都有图；混血取占比最高、同占比取先写的；拼色底面积按血统占比
import assert from 'node:assert/strict';
import test from 'node:test';

import { AMORPHOUS_RACES, DERIVED_TYPE_RACES, METOVIVIPAROUS_RACES, OVIPAROUS_RACES, OVOVIVIPAROUS_RACES, VIVIPAROUS_RACES } from '../scripts/race_config.js';
import { DERIVED_FRAME_NAMES, RACE_ICON_NAMES, hybridPieces, isHybridBloodline, pickIconRace, raceIconSvg } from '../scripts/race_icons.js';

const area = (points) => {
  const p = points.split(' ').map((pair) => pair.split(',').map(Number));
  let sum = 0;
  for (let i = 0; i < p.length; i += 1) { const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % p.length]; sum += x1 * y2 - x2 * y1; }
  return Math.abs(sum) / 2;
};

test('every built-in race and derived type has its own icon or frame', () => {
  const races = [...VIVIPAROUS_RACES, ...OVIPAROUS_RACES, ...OVOVIVIPAROUS_RACES, ...METOVIVIPAROUS_RACES, ...AMORPHOUS_RACES];
  assert.deepEqual([...RACE_ICON_NAMES].sort(), [...races].sort());
  assert.deepEqual([...DERIVED_FRAME_NAMES].sort(), [...DERIVED_TYPE_RACES].sort());
});

test('a mixed race shows the icon of its largest share; ties go to the mother, then to the race written first', () => {
  assert.equal(pickIconRace('精灵x人类', { 精灵: 0.25, 人类: 0.75 }), '人类');
  assert.equal(pickIconRace('妖狐x人类', { 妖狐: 0.5, 人类: 0.5 }), '妖狐');
  assert.equal(pickIconRace('人类x妖狐', { 妖狐: 0.5, 人类: 0.5 }), '人类');
  assert.equal(pickIconRace('妖狐x人类', { 妖狐: 0.5, 人类: 0.5 }, { 人类: 1 }), '人类', '平手取母方占比较高的');
  assert.equal(pickIconRace('妖狐x人类', { 妖狐: 0.5, 人类: 0.5 }, { 妖狐: 0.5, 人类: 0.5 }), '妖狐', '母方也平手才取先写的');
  assert.equal(pickIconRace('精灵x人类', { 精灵: 0.25, 人类: 0.75 }, { 精灵: 1 }), '人类', '不平手时母方不影响');
  assert.equal(pickIconRace('怪兽类-狼'), '怪兽类', '子项取基种族');
  assert.equal(pickIconRace('精灵x未知', { 精灵: 0.25, 未知: 0.75 }), '精灵', '没有图示的成分不参与');
  assert.equal(pickIconRace('自订族'), null);
  assert.equal(raceIconSvg({ race: '自订族' }), '', '没有图示时由呼叫端退回原本的显示');
});

test('the hybrid backing is split into tiles whose areas follow the bloodline shares', () => {
  assert.equal(isHybridBloodline('人类', { 人类: 1 }), false);
  assert.equal(isHybridBloodline('精灵x人类', { 精灵: 0.25, 人类: 0.75 }), true);
  assert.deepEqual(hybridPieces({ 人类: 1 }), []);
  const two = hybridPieces({ 精灵: 0.25, 人类: 0.75 });
  assert.equal(two.length, 2);
  const [big, small] = two.map(([points]) => area(points));
  assert.ok(Math.abs(big / (big + small) - 0.75) < 0.04, `面积比 ${big / (big + small)}`);
  assert.equal(hybridPieces({ 人类: 0.5, 精灵: 0.3, 西方龙: 0.2 }).length, 3);
  assert.notEqual(two[0][1], two[1][1], '相邻拼块深浅不同');
});

test('the icon svg carries the backing only for hybrids and the frame for derived types', () => {
  const pure = raceIconSvg({ race: '人类' });
  const hybrid = raceIconSvg({ race: '精灵x人类', bloodline: { 精灵: 0.25, 人类: 0.75 } });
  const derived = raceIconSvg({ race: '人类', derivedType: '血族-真祖' });
  const count = (svg) => (svg.match(/<polygon/g) || []).length;
  assert.equal(count(hybrid) - count(pure), 2);
  assert.ok(count(derived) > count(pure));
  assert.match(derived, /<g opacity="0\.85">/);
  assert.match(raceIconSvg({ race: '人类', label: '<script>' }), /aria-label="&lt;script&gt;"/);
});

test('life-stage icons cover the gamete providers and six age bands, without hybrid backing or frames', async () => {
  const { LIFE_STAGE_NAMES, lifeStageIconSvg } = await import('../scripts/race_icons.js');
  const { LIFE_STAGE_AGE_BOUNDS } = await import('../scripts/lineage_view.js');
  assert.deepEqual([...LIFE_STAGE_NAMES], ['精方', '卵方', ...LIFE_STAGE_AGE_BOUNDS.map(([, stage]) => stage)]);
  const markups = LIFE_STAGE_NAMES.map((stage) => lifeStageIconSvg(stage));
  assert.equal(new Set(markups).size, markups.length, 'every stage has its own drawing');
  for (const svg of markups) {
    assert.match(svg, /class="bs-bt-race-icon bs-bt-life-icon"/);
    assert.doesNotMatch(svg, /<g opacity="0\.85">/);
  }
  assert.equal(lifeStageIconSvg('人类'), '', 'unknown stages fall back to the name initial');
  assert.equal(lifeStageIconSvg(null), '');
});
