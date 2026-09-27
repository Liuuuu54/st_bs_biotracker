// 胎儿像素图：几何部件依大小、方向、镜像、朝向直接栅格化；只产生色调代号，不碰 DOM。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFetusGrid, hasFluidSac, isFetalForm, membraneLevel } from '../scripts/fetus_sprite.js';

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

test('胎儿形态的阶段：胎生全期、卵胎生孕中孕晚、胎转卵生孕早孕中；认不得的胚型当胎生画', () => {
  assert.deepEqual([0, 1, 2].map((s) => isFetalForm('胎生', s)), [true, true, true]);
  assert.deepEqual([0, 1, 2].map((s) => isFetalForm('卵胎生', s)), [false, true, true]);
  assert.deepEqual([0, 1, 2].map((s) => isFetalForm('胎转卵生', s)), [true, true, false]);
  assert.equal(isFetalForm('卵生', 2), false);
  assert.equal(isFetalForm('不定型', 1), false);
  const unknown = buildFetusGrid({ type: '未知', height: 20 });
  assert.ok(count(unknown, 'head') > 0 && count(unknown, 'body') > 0, '认不得的胚型当胎生画');
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

test('卵胎生没有脐带，孕晚留碎壳、孕中是卵包胚胎；胎转卵生孕早零散几段网格壳、孕中围成一圈', () => {
  const hatched = buildFetusGrid({ type: '卵胎生', stage: 2, height: 30 });
  assert.equal(count(hatched, 'cord'), 0);
  assert.ok(count(hatched, 'shell') > 0);
  const egg = buildFetusGrid({ type: '卵胎生', stage: 1, height: 24 });
  assert.ok(count(egg, 'shellLight') > count(egg, 'head'));
  assert.equal(count(egg, 'cord'), 0);
  const pieces = count(buildFetusGrid({ type: '胎转卵生', stage: 0, height: 20 }), 'membrane');
  const ring = count(buildFetusGrid({ type: '胎转卵生', stage: 1, height: 20 }), 'membrane');
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

test('卵在子宫里看不到胎儿（卵生与胎转卵生产后才孵）：孕早透出蛋黄、孕中只剩蛋黄影子、孕晚硬壳带斑纹；卵胎生孕早看得到小胚胎', () => {
  const early = buildFetusGrid({ type: '卵生', stage: 0, height: 20 });
  const mid = buildFetusGrid({ type: '卵生', stage: 1, height: 20 });
  const late = buildFetusGrid({ type: '卵生', stage: 2, height: 24 });
  assert.ok(count(early, 'yolk') > 0);
  assert.ok(count(mid, 'yolk') === 0 && count(mid, 'ghost') > 0);
  assert.ok(count(late, 'speck') > 0 && count(late, 'yolk') + count(late, 'ghost') === 0);
  for (const grid of [early, mid, late]) {
    assert.ok(count(grid, 'eggShell') > 0 && count(grid, 'shellShade') > 0);
    assert.equal(count(grid, 'face') + count(grid, 'cord') + count(grid, 'head') + count(grid, 'body'), 0, '卵里没有胎儿');
  }
  const ovo = buildFetusGrid({ type: '卵胎生', stage: 0, height: 20 });
  assert.ok(count(ovo, 'yolk') > 0 && count(ovo, 'ghost') > 0);
});

test('不定型当史莱姆：圆顶一团带亮核、光泽与两只眼；孕中分出一小滴，孕晚再垂下黏液，范围越来越大', () => {
  const extent = (grid) => grid.cells.flat().filter(Boolean).length;
  const stages = [0, 1, 2].map((stage) => buildFetusGrid({ type: '不定型', stage, height: 22 }));
  for (const grid of stages) {
    assert.ok(count(grid, 'blob') > 0 && count(grid, 'core') > 0 && count(grid, 'shine') > 0);
    assert.ok(count(grid, 'face') >= 2);
  }
  assert.ok(extent(stages[1]) > extent(stages[0]) && extent(stages[2]) > extent(stages[1]));
});

test('胎转卵生孕晚：和卵生一样的蛋形，壳上永远有结晶格，硬化的羊膜贴在蛋上；没有羊水囊、看不到胎儿', () => {
  const sealed = buildFetusGrid({ type: '胎转卵生', stage: 2, height: 24 });
  const plain = buildFetusGrid({ type: '卵生', stage: 2, height: 24 });
  assert.ok(count(sealed, 'lattice') > 10 && count(sealed, 'eggFilm') > 0 && count(sealed, 'membrane') > 0);
  assert.equal(count(plain, 'lattice') + count(plain, 'eggFilm'), 0);
  assert.equal(count(sealed, 'speck') + count(sealed, 'head') + count(sealed, 'body'), 0);
  assert.equal(hasFluidSac('胎转卵生', 2), false);
  assert.equal(hasFluidSac('胎转卵生', 1), true);
  assert.equal(hasFluidSac('卵生', 2), true);
  assert.ok(count(buildFetusGrid({ type: '胎转卵生', stage: 1, height: 20 }), 'membrane') > 0);
});

test('胎转卵生的羊膜表示耐久：完整整颗蒙着、变薄一块块缺、撕开时下方露出壳、破了只剩带结晶格的蛋壳', () => {
  assert.deepEqual([100, 60, 59, 30, 29, 1, 0, -5].map(membraneLevel), ['full', 'full', 'thin', 'thin', 'torn', 'torn', 'none', 'none']);
  const grid = (d) => buildFetusGrid({ type: '胎转卵生', stage: 2, height: 30, membrane: d });
  const film = (d) => {
    const g = grid(d);
    return count(g, 'eggFilm') + count(g, 'filmShade') + count(g, 'membrane') + count(g, 'membraneThin');
  };
  assert.ok(film(100) > film(50) && film(50) > film(20) && film(20) > 0);
  assert.equal(film(0), 0);
  for (const d of [100, 50, 20, 0]) assert.ok(count(grid(d), 'lattice') > 10, `耐久 ${d} 仍有结晶格`);
  const torn = grid(20);
  const lower = torn.cells.slice(torn.anchorY + 5).flat().filter((cell) => cell === 'eggFilm' || cell === 'membraneThin').length;
  assert.equal(lower, 0, '靠宫口那端露出壳');
});

test('不定型孕晚长出一对兔耳，高出圆顶；孕早孕中没有', () => {
  const top = (grid) => grid.cells.findIndex((row) => row.some(Boolean));
  const late = buildFetusGrid({ type: '不定型', stage: 2, height: 24 });
  const mid = buildFetusGrid({ type: '不定型', stage: 1, height: 24 });
  assert.ok(top(late) < top(mid));
});
