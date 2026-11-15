// 孕体特写的成图规则：参考点吻合、胸衣盖住乳头、两个乳瓣、短裤与胸衣不破、只算用到的参考、固定画框。
// 与预览页的逐格对照是另一支开发工具（tools/belly-parity.mjs，要作者机器上的预览页）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeBellyData } from '../scripts/belly_data.js';
import { BELLY_NEW_FIXES, BELLY_SKIP_FIXES, createBellyLayout } from '../scripts/belly_layout.js';
import { BELLY_DEFAULT_PALETTE, BELLY_SKIN_BASE, createBellyPalette, createBellyPainter } from '../scripts/belly_render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = decodeBellyData(fs.readFileSync(path.join(ROOT, 'assets', 'belly', 'closeup-data.bin')));
const layout = createBellyLayout(data);
// 只有从预览页移植来的规则（插件新加的轮廓修饰关掉）
const ported = createBellyLayout(data, { skip: BELLY_NEW_FIXES });
const { width: W, height: H } = layout.grid;
const N = W * H;
const OWNER = { body: 1, shorts: 2, belly: 3, bra: 4 };
const CLOTHED = { showBra: true, showShorts: true, strapless: true };
const NUDE = { showBra: false, showShorts: false, strapless: false };
const base = { sigma: 0, cup: 50, build: 50, hip: 50, days: 0, count: 1, weight: 1, hormStage: 'pregnant', stageProgress: 30, births: 0, milk: 20, libido: 10, laborPhase: 'none', ...CLOTHED };
const count = (array, value) => { let n = 0; for (let i = 0; i < array.length; i += 1) if (array[i] === value) n += 1; return n; };
const inView = (frame, i) => { const y = Math.floor(i / W); return y >= frame.view.y && y < frame.view.y + frame.view.h; };
const CUP_VALUE = Object.fromEntries(layout.cups);
const STAGE_STATE = { empty: { days: 0 }, mid: { days: 140 }, late: { days: 280 }, twins: { days: 280, count: 2 }, triplets: { days: 280, count: 3 }, quint: { days: 280, count: 5 } };

// 体型、罩杯、孕况都落在参考之间的状态
const BETWEEN = [];
for (const sigma of [-2.2, -0.7, 0.9, 2.4]) for (const cup of [15, 65, 115, 140]) for (const stage of [{ days: 0 }, { days: 210 }, { days: 280, count: 2 }, { days: 280, count: 4 }]) BETWEEN.push({ ...base, sigma, cup, ...stage });

test('孕况的刻度：单胎 20 周、足月与多胎落在参考的胎量上', () => {
  const bulk = (state) => layout.bulkOf({ ...base, ...state });
  assert.equal(bulk({ days: 0 }), 0);
  assert.ok(Math.abs(bulk({ days: 140 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(bulk({ days: 280 }) - 1) < 1e-9);
  assert.ok(Math.abs(bulk({ days: 280, count: 2 }) - 2) < 1e-9);
  assert.ok(Math.abs(bulk({ days: 280, count: 3 }) - 3) < 1e-9);
  assert.ok(Math.abs(bulk({ days: 280, count: 5 }) - 5) < 1e-9);
  // 直接给孕肚大小（插件的 getBellySize）与用孕日、胎数换算的相同
  assert.equal(layout.pressureOf({ ...base, days: 280 }), 7);
  assert.equal(bulk({ pressure: 7, days: 123 }), bulk({ days: 280 }));
  assert.equal(layout.pressureOf({ ...base, pressure: 99 }), layout.maxPressure);
});

test('参考点上的外形与作者的标注吻合（不含插件新加的轮廓修饰）', () => {
  // 每个体型、罩杯各抽一个孕况（35 张），画框内逐格比：多画的、漏掉的衣物、漏掉的孕肚
  const worst = { extra: 0, cloth: 0, belly: 0 };
  let index = 0;
  for (const sigma of layout.sigmas) for (const [cup] of layout.cups) {
    const stage = layout.stages[index % layout.stages.length];
    index += 1;
    const anchor = data.anchor(`${sigma}/${cup}/${stage}`);
    const frame = ported.layout({ ...base, sigma, cup: CUP_VALUE[cup], ...STAGE_STATE[stage], showBra: true, showShorts: true, strapless: false });
    const found = { extra: 0, cloth: 0, belly: 0 };
    for (let i = 0; i < N; i += 1) {
      const y = Math.floor(i / W);
      // 画框上缘两列不比：那里是切过身体的边，各参考停在不同的列
      if (y < frame.view.y + 2 || y >= frame.view.y + frame.view.h) continue;
      const authored = anchor.labels[i];
      const drawn = frame.label[i] !== 0;
      if (drawn && authored === 0) found.extra += 1;
      if (!drawn && authored >= 2 && authored <= 4) found.cloth += 1;
      if (!drawn && anchor.belly[i]) found.belly += 1;
    }
    for (const key of Object.keys(worst)) worst[key] = Math.max(worst[key], found[key]);
  }
  // 2026-11-14 实测最差：多画 28 格、漏衣物 12 格、漏孕肚 1 格
  assert.ok(worst.extra <= 40 && worst.cloth <= 20 && worst.belly <= 5, JSON.stringify(worst));
});

test('穿着时胸衣盖住两个乳头，全裸时乳头在皮肤上', () => {
  for (const state of BETWEEN) {
    const frame = layout.layout(state);
    for (const [px, py] of frame.fig.nipplePoints) {
      const x = Math.round(px);
      const y = Math.round(py);
      for (const dx of [-1, 0, 1]) {
        const owner = frame.owner[y * W + x + dx];
        assert.ok(owner !== OWNER.body && owner !== OWNER.belly, `${JSON.stringify(state)} 乳头 (${x + dx},${y}) 露出皮肤`);
      }
    }
    assert.equal(frame.nipples.length, 2);
  }
  const nude = layout.layout({ ...base, sigma: 0.9, cup: 65, days: 210, ...NUDE });
  assert.equal(count(nude.owner, OWNER.bra), 0);
  assert.equal(count(nude.owner, OWNER.shorts), 0);
  assert.equal(nude.nipples.length, 2);
});

test('罩杯 B 以上分得出两个乳瓣，胸衣与短裤都在', () => {
  for (const state of BETWEEN) {
    const frame = layout.layout(state);
    const lobes = frame.fig._lobes.list;
    assert.equal(lobes.length, 2, JSON.stringify(state));
    if (state.cup >= 30) for (const lobe of lobes) assert.ok(count(lobe, 1) >= 20, `${JSON.stringify(state)} 乳瓣只有 ${count(lobe, 1)} 格`);
    assert.ok(count(frame.owner, OWNER.bra) >= 100, `${JSON.stringify(state)} 胸衣 ${count(frame.owner, OWNER.bra)} 格`);
    assert.ok(count(frame.owner, OWNER.shorts) >= 40, `${JSON.stringify(state)} 短裤 ${count(frame.owner, OWNER.shorts)} 格`);
  }
});

test('短裤的一格宽尖角：每个画面最多剩一处', () => {
  // 削尖角的规则之后还有补裤腰的规则，会再留下最多一格（与预览页相同；2026-11-14 实测 64 个画面里 18 个各剩一格）
  for (const state of BETWEEN) {
    const frame = layout.layout(state);
    const o = frame.owner;
    let spikes = 0;
    for (let y = Math.max(1, frame.view.y); y < Math.min(H - 1, frame.view.y + frame.view.h); y += 1) for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      if (o[i] === OWNER.shorts && o[i - 1] !== OWNER.shorts && o[i + 1] !== OWNER.shorts && o[i - W] !== OWNER.shorts && o[i + W] === OWNER.shorts) spikes += 1;
    }
    assert.ok(spikes <= 1, `${JSON.stringify(state)} 短裤尖角 ${spikes} 处`);
  }
});

test('无肩带的上缘在乳头上方，胸衣上方露出上胸', () => {
  for (const state of BETWEEN.filter((s) => s.cup >= 65)) {
    const frame = layout.layout(state);
    const [, far] = frame.fig.nipplePoints;
    const x = Math.round(far[0]);
    let top = -1;
    for (let y = 0; y < H; y += 1) if (frame.owner[y * W + x] === OWNER.bra) { top = y; break; }
    assert.ok(top >= 0 && top < far[1], `${JSON.stringify(state)} 胸衣上缘 ${top} 乳头 ${far[1]}`);
    // 同一个状态穿运动胸衣时，这一栏的胸衣上缘不会比无肩带低
    const sports = layout.layout({ ...state, strapless: false });
    let sportsTop = -1;
    for (let y = 0; y < H; y += 1) if (sports.owner[y * W + x] === OWNER.bra) { sportsTop = y; break; }
    assert.ok(sportsTop <= top, JSON.stringify(state));
  }
});

test('孕肚随孕肚大小单调变大', () => {
  for (const [sigma, cup] of [[-3, 0], [0, 50], [1.2, 90], [3, 150]]) {
    let last = -1;
    for (const pressure of [0, 2, 4, 6, 8, 10, 12, 15]) {
      const frame = layout.layout({ ...base, sigma, cup, pressure, days: 200, ...NUDE });
      const area = count(frame.visibleBelly, 1);
      assert.ok(area >= last, `${sigma}σ cup${cup} 孕肚 ${pressure}: ${area} < ${last}`);
      last = area;
    }
  }
});

test('体重与臀部只改外形宽度，不改画框', () => {
  const normal = layout.layout({ ...base, days: 280 });
  const heavy = layout.layout({ ...base, days: 280, build: 90, hip: 90 });
  const thin = layout.layout({ ...base, days: 280, build: 10, hip: 10 });
  const area = (frame) => N - count(frame.label, 0);
  assert.ok(area(heavy) > area(normal) && area(normal) > area(thin));
  assert.deepEqual(heavy.view, normal.view);
});

test('一个画面只建用到的参考：最多 2 体型 × 2 罩杯 × 4 孕况', () => {
  const fresh = createBellyLayout(data);
  fresh.layout({ ...base, sigma: 0.8, cup: 65, days: 230 });
  assert.equal(fresh.stats.anchorBuilds, 16);
  const built = fresh.stats.fieldBuilds;
  // 同一个状态再画一次、换穿着：不再建场
  fresh.layout({ ...base, sigma: 0.8, cup: 65, days: 230 });
  fresh.layout({ ...base, sigma: 0.8, cup: 65, days: 230, ...NUDE });
  assert.equal(fresh.stats.fieldBuilds, built);
  // 正好在参考点上只用一张
  const exact = createBellyLayout(data);
  exact.layout({ ...base, sigma: 0, cup: 50, days: 280 });
  assert.ok(exact.stats.anchorBuilds <= 2, `参考点用了 ${exact.stats.anchorBuilds} 张`);
});

test('距离场只保留有限张数，旧的会释放', () => {
  const small = createBellyLayout(data, { maxLiveAnchors: 16 });
  const first = small.layout({ ...base, sigma: -2.2, cup: 15, days: 210 });
  small.layout({ ...base, sigma: 2.4, cup: 140, days: 100 });
  assert.ok(small.stats.evictions > 0);
  // 释放后再回来，结果相同
  small.clearCache();
  const again = small.layout({ ...base, sigma: -2.2, cup: 15, days: 210 });
  assert.deepEqual(again.label, first.label);
  assert.deepEqual(again.tone, first.tone);
});

test('修补规则可以个别关掉', () => {
  const state = { ...base, sigma: 2.05, cup: 50, days: 280, count: 3 };
  const normal = layout.layout(state);
  const loose = createBellyLayout(data, { skip: BELLY_SKIP_FIXES }).layout(state);
  let diff = 0;
  for (let i = 0; i < N; i += 1) if (normal.owner[i] !== loose.owner[i]) diff += 1;
  assert.ok(diff > 0, '关掉全部修补后成图应有差别');
});

test('画框大小固定，身体贴底，娇小体型上方留空', () => {
  const painter = createBellyPainter(layout);
  assert.deepEqual(painter.frame, { width: 136, height: 99 });
  const background = painter.paint(layout.layout(base)).pixels[0];
  const rowHasBody = (image, y) => { for (let x = 0; x < image.width; x += 1) if (image.pixels[y * image.width + x] !== background) return true; return false; };
  for (const state of [{ ...base, sigma: -3, cup: 0 }, { ...base, sigma: 0, cup: 50, days: 280 }, { ...base, sigma: 3, cup: 150, days: 280, count: 5 }, { ...base, sigma: -1.2, cup: 150, ...NUDE }]) {
    const frame = layout.layout(state);
    const image = painter.paint(frame);
    assert.equal(image.pixels.length, 136 * 99);
    assert.ok(frame.view.h <= painter.frame.height, `${JSON.stringify(state)} 取景高 ${frame.view.h}`);
    assert.ok(rowHasBody(image, image.height - 1), '最下一列有身体');
    assert.equal(image.offsetY + frame.view.y + frame.view.h, image.height);
  }
  const petite = painter.paint(layout.layout({ ...base, sigma: -3, cup: 0 }));
  for (let y = 0; y < 30; y += 1) assert.ok(!rowHasBody(petite, y), `−3σ 第 ${y} 列应是背景`);
});

test('色表：预设与预览页相同，换肤色基准时肤色与乳晕一起换、衣物不变', () => {
  assert.deepEqual(createBellyPalette(), { ...BELLY_DEFAULT_PALETTE, skin: [...BELLY_DEFAULT_PALETTE.skin], areolaPale: [...BELLY_DEFAULT_PALETTE.areolaPale], areolaDark: [...BELLY_DEFAULT_PALETTE.areolaDark], nipplePale: [...BELLY_DEFAULT_PALETTE.nipplePale], nippleDark: [...BELLY_DEFAULT_PALETTE.nippleDark] });
  assert.equal(BELLY_SKIN_BASE, '#efbba2');
  const dark = createBellyPalette({ skinBase: '#8d5a3c' });
  assert.equal(dark.skin[3], '#8d5a3c');
  assert.notDeepEqual(dark.areolaPale, BELLY_DEFAULT_PALETTE.areolaPale);
  assert.deepEqual(dark.bra, BELLY_DEFAULT_PALETTE.bra);
  // 色带仍由深到浅
  const luminance = (hex) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);
  for (let k = 1; k < dark.skin.length; k += 1) assert.ok(luminance(dark.skin[k]) > luminance(dark.skin[k - 1]));
  // 换色表不必重算成图
  const painter = createBellyPainter(layout);
  const frame = layout.layout({ ...base, days: 280, ...NUDE });
  const a = painter.paint(frame);
  const b = painter.paint(frame, createBellyPalette({ skinBase: '#8d5a3c', bg: '#000000' }));
  assert.notDeepEqual(a.pixels, b.pixels);
  assert.equal(b.pixels[0], 0xff000000);
});

// ---- 插件新加的轮廓修饰（2026-11-14 回报的瑕疵）----
const frontOf = (frame, y) => { for (let x = 0; x < W; x += 1) if (frame.owner[y * W + x]) return x; return -1; };
const backOf = (frame, y) => { for (let x = W - 1; x >= 0; x -= 1) if (frame.owner[y * W + x]) return x; return -1; };
const QUINT = { days: 280, count: 5 };

test('每条规则回报改动格数，新规则的改动有限', () => {
  for (const state of BETWEEN) {
    const { rules } = layout.layout(state);
    for (const name of ['repair', 'backTop', 'breastArc', 'bellyArc', 'cleanup', 'shortsBand', 'slivers', 'shortsSpike', 'waistband', 'braHoldsBreast', 'strapless', 'braCoversNipples', 'braWedge']) {
      assert.ok(Number.isInteger(rules[name]), `${name} 没有回报`);
    }
    assert.ok(rules.breastArc <= 60, `胸弧补了 ${rules.breastArc} 格 ${JSON.stringify(state)}`);
    assert.ok(rules.bellyArc <= 80, `孕肚弧改了 ${rules.bellyArc} 格 ${JSON.stringify(state)}`);
    assert.ok(rules.braWedge <= 80, `胸衣前缘补了 ${rules.braWedge} 格 ${JSON.stringify(state)}`);
    assert.ok(rules.backTop <= 320, `右肩补了 ${rules.backTop} 格 ${JSON.stringify(state)}`);
  }
});

test('胸弧补凹：近侧乳房前缘在乳头附近不内凹', () => {
  const state = { ...base, sigma: -0.65, cup: 150, ...QUINT, ...NUDE };
  const dent = (frame) => {
    const ny = Math.round(frame.fig.nipplePoints[0][1]);
    let worst = 0;
    for (let y = ny - 4; y <= ny + 4; y += 1) worst = Math.max(worst, frontOf(frame, y) - (frontOf(frame, y - 4) + frontOf(frame, y + 4)) / 2);
    return worst;
  };
  assert.ok(dent(ported.layout(state)) >= 1.5, '这个状态原本有凹陷（规则若不再需要可拿掉）');
  const fixed = layout.layout(state);
  assert.ok(dent(fixed) <= 1, `仍内凹 ${dent(fixed)} 格`);
  assert.ok(fixed.rules.breastArc > 0);
  // 只补不削
  const before = ported.layout(state);
  for (let i = 0; i < N; i += 1) if (before.owner[i] === OWNER.body && Math.floor(i / W) < 45) assert.ok(fixed.owner[i] !== 0, '胸弧补凹不该削掉身体');
});

test('孕肚弧：孕肚前缘没有一次退两格的台阶', () => {
  const frame = layout.layout({ ...base, sigma: 3, cup: 150, days: 140 });
  const rows = [];
  for (let y = frame.view.y; y < frame.view.y + frame.view.h; y += 1) { const x = frontOf(frame, y); if (x >= 0 && frame.owner[y * W + x] === OWNER.belly) rows.push(x); }
  assert.ok(rows.length > 15);
  for (let k = 3; k < rows.length - 3; k += 1) assert.ok(Math.abs(rows[k] - rows[k - 1]) <= 1, `第 ${k} 列前缘跳 ${rows[k] - rows[k - 1]} 格`);
});

test('右肩与腋下：胸部最宽处以上的背缘不往内收成缺口', () => {
  for (const state of [{ ...base, days: 280 }, { ...base, sigma: -0.65, cup: 150, ...QUINT }, { ...base, sigma: 3, cup: 150, ...QUINT, ...NUDE }]) {
    const frame = layout.layout(state);
    let peak = -1;
    for (let y = frame.view.y; y < frame.view.y + 30; y += 1) peak = Math.max(peak, backOf(frame, y));
    const top = backOf(frame, frame.view.y + 1);
    assert.ok(peak - top <= 6, `画框上缘的背缘比最宽处内收 ${peak - top} 格 ${JSON.stringify(state)}`);
  }
  const frame = ported.layout({ ...base, sigma: -0.65, cup: 150, ...QUINT });
  let peak = -1;
  for (let y = frame.view.y; y < frame.view.y + 30; y += 1) peak = Math.max(peak, backOf(frame, y));
  assert.ok(peak - backOf(frame, frame.view.y + 1) > 6, '这个状态原本有缺口');
});

test('无肩带上缘：两个乳房之间没有台阶', () => {
  const state = { ...base, sigma: 3, cup: 150, ...QUINT };
  const step = (frame) => {
    const [near, far] = frame.fig.nipplePoints;
    let worst = 0;
    let last = null;
    for (let x = Math.round(near[0]) + 2; x <= Math.round(far[0]); x += 1) {
      let top = -1;
      for (let y = 0; y < H; y += 1) if (frame.owner[y * W + x] === OWNER.bra) { top = y; break; }
      if (top < 0) continue;
      if (last !== null) worst = Math.max(worst, Math.abs(top - last));
      last = top;
    }
    return worst;
  };
  assert.ok(step(ported.layout(state)) >= 4, '这个状态原本有台阶');
  assert.ok(step(layout.layout(state)) <= 2, `上缘仍跳 ${step(layout.layout(state))} 列`);
});

test('胸衣前缘：乳头以下前缘到胸衣之间不露皮肤', () => {
  const state = { ...base, sigma: -0.65, cup: 150, ...QUINT };
  const bare = (frame) => {
    const ny = Math.round(frame.fig.nipplePoints[0][1]);
    let cells = 0;
    for (let y = ny + 4; y < H; y += 1) {
      const row = frame.owner.subarray(y * W, (y + 1) * W);
      const bra = row.indexOf(OWNER.bra);
      if (bra < 0) break;
      // 只看胸衣就在前缘后面几格的列；再往下胸衣退到后面，前面是孕肚上方的皮肤
      const front = frontOf(frame, y);
      if (bra - front > 8) continue;
      for (let x = front; x < bra; x += 1) if (row[x] === OWNER.body) cells += 1;
    }
    return cells;
  };
  assert.ok(bare(ported.layout(state)) >= 10, '这个状态原本有皮肤楔形');
  assert.equal(bare(layout.layout(state)), 0);
});

test('上胸接缝：只动明暗，不动外形', () => {
  const state = { ...base, sigma: 3, cup: 150, ...QUINT, ...NUDE };
  const on = layout.layout(state);
  const off = createBellyLayout(data, { skip: ['chestSeam'] }).layout(state);
  assert.deepEqual(on.owner, off.owner);
  assert.notDeepEqual(on.tone, off.tone);
  assert.ok(on.rules.chestSeam > 0);
});

test('小罩杯的乳沟：贴着乳沟线并行的乳房轮廓线不画，只留一条', () => {
  const frame = layout.layout({ ...base, sigma: 2.7, cup: 30, days: 280, ...NUDE });
  const merged = createBellyPainter(layout).paint(frame);
  const separate = createBellyPainter(layout, { mergeChestLines: false }).paint(frame);
  let fewer = 0;
  for (let i = 0; i < merged.pixels.length; i += 1) if (merged.pixels[i] !== separate.pixels[i]) fewer += 1;
  assert.ok(fewer >= 8, `只少画 ${fewer} 格`);
  // 罩杯大、线本来就分得开时不受影响
  const big = layout.layout({ ...base, sigma: 0, cup: 100, days: 280, ...NUDE });
  let changed = 0;
  const a = createBellyPainter(layout).paint(big);
  const b = createBellyPainter(layout, { mergeChestLines: false }).paint(big);
  for (let i = 0; i < a.pixels.length; i += 1) if (a.pixels[i] !== b.pixels[i]) changed += 1;
  assert.ok(changed <= 12, `0σ I 少画 ${changed} 格`);
});

// ---- 手修的修正点 ----
test('修正点：前缘照手修的格数往前补、往里削，乳头照手修位移；离修正点越远越淡', () => {
  const state = { ...base, sigma: -0.5, cup: 150, days: 364, count: 5, ...NUDE };
  const plain = createBellyLayout(data);
  const before = plain.layout(state);
  const pressure = before.fig.pressure;
  const row = before.manual.nippleRow;
  const patch = { sigma: -0.5, cup: 150, pressure, front: [[4, -3], [5, -3], [8, 2]], nipples: [[0, 3], [2, 0]] };
  const patched = createBellyLayout(data, { patches: [patch] });
  const after = patched.layout(state);
  const front = (frame, y) => { for (let x = 0; x < W; x += 1) if (frame.owner[y * W + x]) return x; return -1; };
  assert.equal(after.manual.weight, 1);
  assert.equal(front(after, row + 4), front(before, row + 4) - 3);
  assert.equal(front(after, row + 5), front(before, row + 5) - 3);
  assert.equal(front(after, row + 8), front(before, row + 8) + 2);
  assert.equal(front(after, row + 6), front(before, row + 6));
  assert.ok(Math.abs(after.fig.nipplePoints[0][1] - before.fig.nipplePoints[0][1] - 3) < 1e-9);
  assert.ok(Math.abs(after.fig.nipplePoints[1][0] - before.fig.nipplePoints[1][0] - 2) < 1e-9);
  assert.equal(after.rules.manual, 8);
  // 范围内渐变：半个范围外只套一半左右，范围外完全不套
  const half = patched.layout({ ...state, sigma: -0.5 + 0.375 });
  assert.ok(half.manual.weight > 0.3 && half.manual.weight < 0.7, `权重 ${half.manual.weight}`);
  const far = patched.layout({ ...state, sigma: 0.4 });
  assert.equal(far.manual.weight, 0);
  assert.deepEqual(far.owner, plain.layout({ ...state, sigma: 0.4 }).owner);
  assert.equal(patched.layout({ ...state, cup: 100 }).manual.weight, 0);
  // 同一张取形再成图一次（动画的宫缩层会这样做），乳头不会被移两次
  const again = patched.compose({ ...after.fig });
  assert.deepEqual(again.fig.nipplePoints, after.fig.nipplePoints);
  // 换掉修正点立刻生效；关掉 manual 规则等于没有修正点
  patched.setPatches([]);
  assert.deepEqual(patched.layout(state).owner, before.owner);
  assert.deepEqual(createBellyLayout(data, { patches: [patch], skip: ['manual'] }).layout(state).owner, before.owner);
});

test('修正点重叠时取加权平均，不会加倍', () => {
  const state = { ...base, sigma: 0, cup: 100, days: 280, ...NUDE };
  const plain = createBellyLayout(data).layout(state);
  const pressure = plain.fig.pressure;
  const one = { sigma: 0, cup: 100, pressure, front: [[3, -4]] };
  const twice = createBellyLayout(data, { patches: [one, { ...one }] }).layout(state);
  const single = createBellyLayout(data, { patches: [one] }).layout(state);
  assert.deepEqual(twice.owner, single.owner);
});

test('主题色表：照子宫图的色表对应，iPhone 主题维持写实肤色', async () => {
  const { createBellyThemePalette } = await import('../scripts/belly_render.js');
  const { getUterusPalette } = await import('../scripts/uterus_render.js');
  const retro = getUterusPalette({ name: 'retro', screen: '#8faf6f', text: '#22301a', border: '#33402a' });
  const themed = createBellyThemePalette(retro);
  assert.equal(themed.bg, retro.bg);
  assert.deepEqual(themed.skin.slice(0, 3), [retro.wallDark, retro.wall, retro.wallLight]);
  assert.equal(themed.skin.length, 5);
  assert.equal(themed.bra.length, 4);
  assert.notDeepEqual(themed.skin, BELLY_DEFAULT_PALETTE.skin);
  const phone = createBellyThemePalette(getUterusPalette({ name: 'iphone', screen: '#101014' }), { theme: 'iphone' });
  assert.deepEqual(phone.skin, [...BELLY_DEFAULT_PALETTE.skin]);
  assert.deepEqual(createBellyThemePalette(null).skin, [...BELLY_DEFAULT_PALETTE.skin]);
  // 樱花是全彩：写实肤色配樱花的背景
  const sakuraWomb = getUterusPalette({ name: 'sakura' });
  const sakura = createBellyThemePalette(sakuraWomb, { theme: 'sakura' });
  assert.deepEqual(sakura.skin, [...BELLY_DEFAULT_PALETTE.skin]);
  assert.equal(sakura.bg, sakuraWomb.bg);
  // 哥特也是全彩（血红的身体太吓人）
  assert.deepEqual(createBellyThemePalette(getUterusPalette({ name: 'gothic' }), { theme: 'gothic' }).skin, [...BELLY_DEFAULT_PALETTE.skin]);
  // 水墨、建构是单色：由深到浅一条色带，带笔触的只有水墨
  const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  for (const name of ['ink', 'constructivism']) {
    const womb = getUterusPalette({ name });
    const mono = createBellyThemePalette(womb, { theme: name });
    for (let k = 1; k < mono.skin.length; k += 1) assert.ok(channels(mono.skin[k]).reduce((a, b) => a + b) > channels(mono.skin[k - 1]).reduce((a, b) => a + b), `${name} 肤色色带应由深到浅`);
    // 肤色里没有红：三个色版差不多（建构的子宫图宫壁是红的，特写不跟）
    for (const color of mono.skin) { const [r, g, b] = channels(color); assert.ok(r - Math.min(g, b) < 40, `${name} ${color}`); }
    assert.equal(Boolean(mono.brush), name === 'ink');
  }
  // 半彩：赛博埃及照专属配色
  const cyber = getUterusPalette({ name: 'cyber-egypt' });
  const cyberSkin = createBellyThemePalette(cyber, { theme: 'cyber-egypt' }).skin;
  assert.deepEqual(cyberSkin.slice(0, 3), [cyber.wallDark, cyber.wall, cyber.wallLight]);
  // 亮面仍是宫壁的金黄色相，不混进胎儿的青色（红不低于蓝）
  for (const color of cyberSkin) { const [red, , blue] = channels(color); assert.ok(red >= blue, color); }
  // 每个色组都画得出来
  const image = createBellyPainter(layout).paint(layout.layout({ ...base, days: 280 }), themed);
  assert.equal(image.pixels.length, 136 * 99);
  // 笔触处理只改颜色、不改大小，同样的输入每次结果相同
  const { applyBellyInkBrush } = await import('../scripts/belly_render.js');
  const inkPalette = createBellyThemePalette(getUterusPalette({ name: 'ink' }), { theme: 'ink' });
  const drawn = createBellyPainter(layout).paint(layout.layout({ ...base, days: 280 }), inkPalette);
  const once = applyBellyInkBrush(new Uint8ClampedArray(drawn.pixels.buffer.slice(0)), drawn.width, drawn.height, inkPalette.brush);
  const twice = applyBellyInkBrush(new Uint8ClampedArray(drawn.pixels.buffer.slice(0)), drawn.width, drawn.height, inkPalette.brush);
  assert.deepEqual(once, twice);
  let touched = 0;
  const plain = new Uint8ClampedArray(drawn.pixels.buffer);
  for (let i = 0; i < once.length; i += 1) if (once[i] !== plain[i]) touched += 1;
  assert.ok(touched > 100, `笔触只改了 ${touched} 个色版值`);
});
