// 胎位难度依胚型各自计算；1.1.3 曾把胎转卵生并入卵生那一段，却被前面胎转卵生的专属分支挡住、从未生效。
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePositionDifficulty } from '../scripts/tools.js';

const at = (embryoType, angle) => calculatePositionDifficulty(angle, { embryoType, race: '人类' });

test('胎生：头位 1、臀位 1.5、横位 2、斜位 1.33', () => {
  assert.deepEqual([0, 180, 90, 45].map((a) => at('胎生', a)), [1, 1.5, 2, 1.33]);
});

test('卵胎生：正头位 1、略偏 1.25，臀位与横位比胎生略重', () => {
  assert.deepEqual([0, 10, 180, 170, 90, 80].map((a) => at('卵胎生', a)), [1, 1.25, 1.5, 1.75, 2, 2.25]);
});

test('卵生：头尾对称都是 1，只有横放较难', () => {
  assert.deepEqual([0, 180, 90, 45].map((a) => at('卵生', a)), [1, 1, 1.5, 1.33]);
});

test('胎转卵生：头尾对称（头位、臀位 1、横位 1.5），偏离正位超过 5° 每度加 0.075，最高 2.25', () => {
  assert.deepEqual([0, 3, 180, 357, 90, 270].map((a) => at('胎转卵生', a)), [1, 1, 1, 1, 1.5, 1.5]);
  assert.equal(at('胎转卵生', 10), 1.375);
  assert.equal(at('胎转卵生', 190), 1.375, '臀位一侧同样计算');
  assert.equal(at('胎转卵生', 80), 1.875, '靠近横位时以横位为起点');
  assert.equal(at('胎转卵生', 45), 2.25);
  assert.ok(at('胎转卵生', 20) > at('卵生', 20), '比卵生更要求对准');
});

test('不定型：同一角度与种族得到固定值，落在 1 到 2 之间', () => {
  const value = at('不定型', 33);
  assert.equal(at('不定型', 33), value);
  assert.ok(value >= 1 && value <= 2);
});

test('横位两侧对称：90° 与 270° 偏同样角度时难度相同（以前 270° 那侧整段偏移了 10°）', () => {
  for (const embryoType of ['胎生', '卵胎生', '卵生', '胎转卵生']) {
    for (const offset of [-15, -12, -8, -3, 0, 3, 8, 12, 15, 20]) {
      assert.equal(at(embryoType, 90 + offset), at(embryoType, 270 + offset), `${embryoType} ${offset}°`);
      assert.equal(at(embryoType, 90 + offset), at(embryoType, 90 - offset), `${embryoType} ±${offset}°`);
    }
  }
  assert.equal(at('卵胎生', 268), 2.0, '正横位 ±5° 内；以前给 2.25');
  assert.equal(at('卵胎生', 280), 2.25, '略偏；以前给 2.0');
  assert.equal(at('胎生', 260), 2.0, '以前算成斜位 1.33');
  assert.equal(at('卵胎生', 290), 1.33, '偏 20° 已出横位范围，与 70° 一样是斜位');
});
