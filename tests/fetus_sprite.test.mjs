// 胎儿像素图：几何部件依大小、方向、镜像、朝向直接栅格化；只产生色调代号，不碰 DOM。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFetusGrid, usesFetusSprite } from '../scripts/fetus_sprite.js';

const count = (grid, tone) => grid.cells.flat().filter((cell) => cell === tone).length;
const centroid = (grid, tone) => {
  let sx = 0;
  let sy = 0;
  let n = 0;
  grid.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell !== tone) return;
    sx += x; sy += y; n += 1;
  }));
  return [sx / n - grid.anchorX, sy / n - grid.anchorY];
};

test('胎儿形态的阶段：胎生全期、卵胎生孕中孕晚、胎转卵生孕早孕中；卵与不定型不算', () => {
  assert.deepEqual([0, 1, 2].map((s) => usesFetusSprite('胎生', s)), [true, true, true]);
  assert.deepEqual([0, 1, 2].map((s) => usesFetusSprite('卵胎生', s)), [false, true, true]);
  assert.deepEqual([0, 1, 2].map((s) => usesFetusSprite('胎转卵生', s)), [true, true, false]);
  assert.equal(usesFetusSprite('卵生', 2), false);
  assert.equal(usesFetusSprite('不定型', 1), false);
});

test('依目标高度直接栅格化：有头、身体、脐带，没有外框色', () => {
  for (const height of [10, 24, 44]) {
    const grid = buildFetusGrid({ height });
    const rows = grid.cells.map((row) => row.some(Boolean)).filter(Boolean).length;
    assert.ok(Math.abs(rows - height) <= 2, `高度 ${height} 画出 ${rows} 列`);
    assert.ok(count(grid, 'head') > 0 && count(grid, 'body') > 0 && count(grid, 'cord') > 0);
    assert.equal(count(grid, 'outline'), 0);
  }
});

test('头位头朝下、臀位头朝上、横位头在左；镜像把头与手脚左右对调', () => {
  const down = buildFetusGrid({ height: 30, angle: 0 });
  const up = buildFetusGrid({ height: 30, angle: 180 });
  const side = buildFetusGrid({ height: 30, angle: 90 });
  assert.ok(centroid(down, 'head')[1] > centroid(down, 'body')[1]);
  assert.ok(centroid(up, 'head')[1] < centroid(up, 'body')[1]);
  assert.ok(centroid(side, 'head')[0] < centroid(side, 'body')[0]);
  const plain = centroid(down, 'cord')[0];
  const mirrored = centroid(buildFetusGrid({ height: 30, angle: 0, mirror: true }), 'cord')[0];
  assert.ok(plain > 0 && mirrored < 0, '脐带跟着手脚那一侧翻到另一边');
});

test('斜位也是原生像素：各色调的量与正位相近', () => {
  const straight = buildFetusGrid({ height: 30, angle: 0 });
  const oblique = buildFetusGrid({ height: 30, angle: 45 });
  for (const tone of ['head', 'body']) {
    const a = count(straight, tone) + (tone === 'body' ? count(straight, 'shade') : 0);
    const b = count(oblique, tone) + (tone === 'body' ? count(oblique, 'shade') : 0);
    assert.ok(Math.abs(a - b) / a < 0.12, `${tone} ${a} vs ${b}`);
  }
});

test('眼睛一律画：胎背朝前侧脸一只闭眼，朝后两只眼加嘴', () => {
  const front = count(buildFetusGrid({ height: 30 }), 'face');
  const back = count(buildFetusGrid({ height: 30, posterior: true }), 'face');
  assert.ok(front >= 1);
  assert.ok(back > front);
  assert.ok(count(buildFetusGrid({ height: 12, stage: 0 }), 'face') >= 1, '孕早期胚胎也有眼睛');
});

test('卵胎生没有脐带，孕晚留碎壳、孕中是卵包胚胎；胎转卵生孕早零散几块壳、孕中整圈', () => {
  const hatched = buildFetusGrid({ type: '卵胎生', stage: 2, height: 30 });
  assert.equal(count(hatched, 'cord'), 0);
  assert.ok(count(hatched, 'shell') > 0);
  const egg = buildFetusGrid({ type: '卵胎生', stage: 1, height: 24 });
  assert.ok(count(egg, 'shellLight') > count(egg, 'head'));
  assert.equal(count(egg, 'cord'), 0);
  const pieces = count(buildFetusGrid({ type: '胎转卵生', stage: 0, height: 20 }), 'shell');
  const ring = count(buildFetusGrid({ type: '胎转卵生', stage: 1, height: 20 }), 'shell');
  assert.ok(pieces > 0 && ring > pieces * 2);
});

test('挤压只缩横向；同样参数结果完全相同', () => {
  const full = buildFetusGrid({ height: 30 });
  const squeezed = buildFetusGrid({ height: 30, squeeze: 0.7 });
  const filledWidth = (grid) => {
    const xs = grid.cells.flatMap((row) => row.map((cell, x) => (cell ? x : null)).filter((x) => x !== null));
    return Math.max(...xs) - Math.min(...xs);
  };
  assert.ok(filledWidth(squeezed) < filledWidth(full));
  assert.deepEqual(buildFetusGrid({ height: 22, angle: 135, mirror: true, posterior: true }), buildFetusGrid({ height: 22, angle: 135, mirror: true, posterior: true }));
});
