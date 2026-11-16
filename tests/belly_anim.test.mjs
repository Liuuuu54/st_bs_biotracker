// 孕体特写的动画：静止画面只在形状改变时重算；呼吸、胎动、宫缩用位移搬画面；胎动落在指定那一胎的位置。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createBellyAnimator } from '../scripts/belly_anim.js';
import { decodeBellyData } from '../scripts/belly_data.js';
import { createBellyLayout } from '../scripts/belly_layout.js';
import { createBellyPainter } from '../scripts/belly_render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = decodeBellyData(fs.readFileSync(path.join(ROOT, 'assets', 'belly', 'closeup-data.bin')));
const layout = createBellyLayout(data);
const painter = createBellyPainter(layout);
const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const animator = (seed) => createBellyAnimator(layout, painter, { random: seeded(seed) });
const base = { sigma: 0, cup: 50, build: 50, hip: 50, days: 280, count: 1, weight: 1, hormStage: 'pregnant', stageProgress: 30, births: 0, milk: 20, libido: 10, laborPhase: 'none', showBra: true, showShorts: true, strapless: true };
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
// 没有胎动干扰的状态（未孕）
const calm = { ...base, days: 0 };

test('不动的时候，分层搬出来的画面与静止画面逐格相同', () => {
  for (const state of [base, calm, { ...base, sigma: -1.2, cup: 120, count: 3, showBra: false, showShorts: false, strapless: false }, { ...base, sigma: 3, cup: 150, count: 5 }]) {
    const a = animator();
    a.setState(state);
    const still = a.tick(0, { still: true });
    const painted = painter.paint(layout.layout(state));
    assert.equal(diff(still.pixels, painted.pixels), 0, JSON.stringify(state));
  }
});

test('动画不重算成图：只有形状改变才重建静止画面', () => {
  const a = animator();
  a.setState(calm);
  const fields = layout.stats.fieldBuilds;
  for (let now = 0; now < 20000; now += 120) a.tick(now);
  assert.equal(a.stats.scenes, 1);
  assert.equal(layout.stats.fieldBuilds, fields);
  // 只换动作参数（活力、困意、产程用力）不重建
  a.setState({ ...calm, vitality: 30, sleep: 90, laborEffort: 'push' });
  assert.equal(a.stats.scenes, 1);
  a.setState({ ...calm, cup: 60 });
  assert.equal(a.stats.scenes, 2);
});

test('呼吸：胸口上下起伏，腰以下不动，画面在一个周期内来回', () => {
  const a = animator();
  a.setState(calm);
  const rest = Uint32Array.from(a.tick(0, { still: true }).pixels);
  let most = 0;
  let lowerMoved = 0;
  const { width, height } = a.frame;
  for (let now = 120; now < 8000; now += 120) {
    const frame = a.tick(now);
    most = Math.max(most, diff(frame.pixels, rest));
    for (let i = (height - 25) * width; i < height * width; i += 1) if (frame.pixels[i] !== rest[i]) lowerMoved += 1;
    assert.ok(frame.motion.lift >= 0 && frame.motion.lift <= 1.6);
  }
  assert.ok(most > 30, `呼吸最多只动 ${most} 格`);
  assert.ok(most < 1500, `呼吸动了 ${most} 格，太多`);
  assert.equal(lowerMoved, 0);
});

test('胎动自己会循环发生；未孕与产后没有', () => {
  const a = animator(3);
  a.setState({ ...base, days: 250 });
  let kicks = 0;
  let seen = false;
  for (let now = 0; now < 120000; now += 120) { const frame = a.tick(now); if (frame.bumps.length && !seen) kicks += 1; seen = frame.bumps.length > 0; }
  assert.ok(kicks >= 6 && kicks <= 30, `两分钟 ${kicks} 次胎动`);
  for (const state of [calm, { ...base, hormStage: 'postpartum', stageProgress: 50 }]) {
    const b = animator(3);
    b.setState(state);
    for (let now = 0; now < 60000; now += 120) assert.equal(b.tick(now).bumps.length, 0);
    assert.equal(b.trigger('kick', { fetus: 0 }), false);
  }
});

test('指定某一胎的胎动落在那一胎的位置', () => {
  const twins = { ...base, count: 2, fetuses: [{ size: 1, zone: { v: 0.2, w: 0.5 } }, { size: 1, zone: { v: 0.8, w: 0.5 } }] };
  const rowsOf = (fetus) => {
    const a = animator(11);
    a.setState(twins);
    a.tick(0);
    const rows = [];
    for (let k = 0; k < 6; k += 1) {
      assert.equal(a.trigger('kick', { fetus, now: 1000 + k * 1000 }), true);
      const frame = a.tick(1000 + k * 1000 + 200);
      const own = frame.bumps.filter((bump) => bump.fetus === fetus);
      assert.ok(own.length >= 1);
      rows.push(own[0].y);
    }
    return rows;
  };
  const upper = rowsOf(0);
  const lower = rowsOf(1);
  assert.ok(Math.max(...upper) < Math.min(...lower), `上面那胎 ${upper}，下面那胎 ${lower}`);
  // 鼓包改到的是孕肚上的格子
  const a = animator(5);
  a.setState(twins);
  const before = Uint32Array.from(a.tick(0, { still: true }).pixels);
  a.tick(0);
  a.trigger('roll', { fetus: 1, now: 0 });
  let changed = 0;
  for (let now = 120; now < 1500; now += 120) changed = Math.max(changed, diff(a.tick(now).pixels, before));
  assert.ok(changed >= 8, `翻身只改 ${changed} 格`);
  // 没有这一胎、或这一胎不能动时不发生
  assert.equal(a.trigger('kick', { fetus: 5 }), false);
  a.setState({ ...twins, fetuses: [{ size: 1 }, { size: 1, canMove: false }] });
  assert.equal(a.trigger('kick', { fetus: 1 }), false);
});

test('假宫缩（episodeMs 0）只播一次；孕肚往上收', () => {
  const a = animator();
  a.setState({ ...base, fetuses: [{ size: 1, canMove: false }] });
  a.tick(0);
  assert.equal(a.trigger('falseContraction', { now: 0, episodeMs: 0 }), true);
  let peak = 0;
  let active = 0;
  for (let now = 120; now < 60000; now += 120) { const frame = a.tick(now); peak = Math.max(peak, frame.motion.contraction); if (frame.motion.contraction > 0) active = now; }
  assert.ok(peak > 0.3 && peak <= 0.35, `强度 ${peak}`);
  assert.ok(active >= 5000 && active <= 9200, `持续到 ${active} 毫秒`);
  assert.equal(a.busy(), false);
});

test('产程中宫缩反复来，用力时孕肚往下压；非产程不来', () => {
  const a = animator(9);
  a.setState({ ...base, laborPhase: 'active', fetuses: [{ size: 1, canMove: false }] });
  let waves = 0;
  let on = false;
  for (let now = 0; now < 120000; now += 120) { const c = a.tick(now).motion.contraction > 0.05; if (c && !on) waves += 1; on = c; }
  assert.ok(waves >= 3 && waves <= 8, `两分钟 ${waves} 次宫缩`);
  const pushing = animator(9);
  pushing.setState({ ...base, laborPhase: 'delivery', laborEffort: 'push', fetuses: [{ size: 1, canMove: false }] });
  let push = 0;
  for (let now = 0; now < 60000; now += 120) push = Math.max(push, pushing.tick(now).motion.push);
  assert.ok(push > 0.9, `用力 ${push}`);
  const resting = animator(9);
  resting.setState({ ...base, fetuses: [{ size: 1, canMove: false }] });
  for (let now = 0; now < 60000; now += 120) assert.equal(resting.tick(now).motion.contraction, 0);
});

test('困意打哈欠与打瞌睡、泄意扭动：条件在才发生', () => {
  const sleepy = animator(2);
  sleepy.setState({ ...calm, sleep: 95 });
  let nod = 0;
  for (let now = 0; now < 120000; now += 120) nod = Math.max(nod, sleepy.tick(now).motion.nod);
  assert.ok(nod > 0.5);
  const urgent = animator(2);
  urgent.setState({ ...calm, excretion: 95 });
  let squirm = 0;
  for (let now = 0; now < 120000; now += 120) squirm = Math.max(squirm, Math.abs(urgent.tick(now).motion.squirm));
  assert.ok(squirm > 0.3);
  const fine = animator(2);
  fine.setState(calm);
  for (let now = 0; now < 60000; now += 120) { const m = fine.tick(now).motion; assert.equal(m.nod, 0); assert.equal(m.squirm, 0); }
});

const quiet = [{ size: 1, canMove: false }];
const countWaves = (a, from, to, read = (m) => m.contraction > 0.05) => { let waves = 0; let on = false; for (let now = from; now < to; now += 120) { const c = read(a.tick(now).motion); if (c && !on) waves += 1; on = c; } return waves; };

test('假宫缩触发后的三分钟内不规律地反复来，之后自己停', () => {
  const a = animator(4);
  a.setState({ ...base, fetuses: quiet });
  a.tick(0);
  a.trigger('falseContraction', { now: 0 });
  const during = countWaves(a, 120, 185000);
  assert.ok(during >= 3 && during <= 8, `三分钟内 ${during} 次`);
  assert.equal(countWaves(a, 200000, 400000), 0);
  // laborPhase 设成 braxton 时一直循环
  const b = animator(4);
  b.setState({ ...base, laborPhase: 'braxton', fetuses: quiet });
  assert.ok(countWaves(b, 0, 400000) >= 5);
});

test('宫缩时孕肚的明暗加深，结束后回到原样', () => {
  const a = animator();
  a.setState({ ...base, fetuses: quiet, vitality: 70 });
  const rest = Uint32Array.from(a.tick(0, { still: true }).pixels);
  assert.equal(a.stats.firmBuilds, 0);
  a.trigger('falseContraction', { now: 0, episodeMs: 0 });
  let most = 0;
  for (let now = 120; now < 9000; now += 120) most = Math.max(most, diff(a.tick(now).pixels, rest));
  assert.equal(a.stats.firmBuilds, 1);
  assert.ok(most > 60, `宫缩最多只改 ${most} 格`);
  // 多算的那一张只算一次
  a.trigger('falseContraction', { now: 20000, episodeMs: 0 });
  for (let now = 20120; now < 30000; now += 120) a.tick(now);
  assert.equal(a.stats.firmBuilds, 1);
  assert.equal(a.stats.scenes, 1);
});

test('胎儿健康：虚弱的胎动少而轻，健壮的多而有力', () => {
  const run = (health) => {
    const a = animator(21);
    a.setState({ ...base, days: 250, fetuses: [{ size: 0.9, health }] });
    let kicks = 0; let seen = false; let amp = 0;
    for (let now = 0; now < 300000; now += 120) { const frame = a.tick(now); if (frame.bumps.length && !seen) kicks += 1; seen = frame.bumps.length > 0; for (const bump of frame.bumps) amp = Math.max(amp, bump.amp); }
    return { kicks, amp };
  };
  const weak = run(15);
  const normal = run(50);
  const strong = run(85);
  assert.ok(weak.kicks < normal.kicks && normal.kicks < strong.kicks, JSON.stringify({ weak, normal, strong }));
  assert.ok(weak.amp < normal.amp && normal.amp < strong.amp, JSON.stringify({ weak, normal, strong }));
});

test('多胎互动：两胎的位置先后有动静', () => {
  const twins = { ...base, count: 2, fetuses: [{ size: 1, zone: { v: 0.2, w: 0.5 } }, { size: 1, zone: { v: 0.8, w: 0.5 } }] };
  for (const interaction of ['kick', 'shove', 'cuddle']) {
    const a = animator(13);
    a.setState(twins);
    a.tick(0);
    a.motion.nextKick = 1e12;   // 这段时间不让自发的胎动插进来
    assert.equal(a.trigger('sibling', { actor: 0, target: 1, interaction, now: 0 }), true, interaction);
    const first = {};
    for (let now = 120; now < 5000; now += 120) for (const bump of a.tick(now).bumps) first[bump.fetus] ??= now;
    assert.ok(first[0] !== undefined && first[1] !== undefined, `${interaction} ${JSON.stringify(first)}`);
    assert.ok(first[0] < first[1], `${interaction}：发起的那一胎先动 ${JSON.stringify(first)}`);
  }
  const a = animator(13);
  a.setState(twins);
  assert.equal(a.trigger('sibling', { actor: 0, target: 0, interaction: 'kick' }), false);
  assert.equal(a.trigger('sibling', { actor: 0, target: 1, interaction: 'dance' }), false);
  a.setState({ ...twins, fetuses: [{ size: 1 }, { size: 1, canMove: false }] });
  assert.equal(a.trigger('sibling', { actor: 0, target: 1, interaction: 'kick' }), false);
});

test('孕中孕：内胎的动静算在宿主身上，力道打折、原地不滑；只能和宿主互动', () => {
  const nest = { ...base, count: 3, fetuses: [{ size: 1, zone: { v: 0.3, w: 0.4 } }, { size: 1, zone: { v: 0.7, w: 0.5 } }, { size: 0.8, host: 0 }] };
  const a = animator(5);
  a.setState(nest);
  a.tick(0);
  a.motion.nextKick = 1e12;
  assert.equal(a.trigger('big', { fetus: 2, now: 0 }), true);
  assert.equal(a.motion.bumps.length, 1);
  const [bump] = a.motion.bumps;
  assert.equal(bump.fetus, 0, '凸起在宿主的位置');
  assert.ok(!bump.crease && bump.drift === 0 && bump.driftW === 0 && a.motion.jiggles.length === 0, '不会用力一踢，也不滑');
  const host = animator(5);
  host.setState(nest);
  host.tick(0);
  host.trigger('kick', { fetus: 0, now: 0 });
  assert.ok(bump.amp < host.motion.bumps[0].amp * 0.5, '力道传不出来');
  // 内胎只碰得到宿主；和宿主互动时孕肚上只有宿主在动
  for (const interaction of ['kick', 'shove', 'cuddle']) {
    for (const [actor, target] of [[2, 0], [0, 2]]) {
      const b = animator(9);
      b.setState(nest);
      b.tick(0);
      b.motion.nextKick = 1e12;
      assert.equal(b.trigger('sibling', { actor, target, interaction, now: 0 }), true, interaction);
      const seen = new Set();
      for (let now = 120; now < 5000; now += 120) for (const k of b.tick(now).bumps) seen.add(k.fetus);
      assert.deepEqual([...seen], [0], `${interaction} ${actor}→${target}`);
    }
  }
  const c = animator(9);
  c.setState(nest);
  assert.equal(c.trigger('sibling', { actor: 2, target: 1, interaction: 'kick', now: 0 }), false);
  assert.equal(c.trigger('sibling', { actor: 1, target: 2, interaction: 'cuddle', now: 0 }), false);
  // 抽送顶到宫颈口：内胎与排在背后的胎碰不到
  const d = animator(3);
  d.setState({ ...base, fetuses: [{ size: 0.9, zone: { v: 0.4, w: 0.4 } }, { size: 0.9, zone: { v: 0.9, w: 0.8 }, behind: true }, { size: 0.9, host: 0 }] });
  d.tick(0);
  d.trigger('thrust', { now: 0, count: 1, reach: true });
  assert.ok(d.motion.queue.length === 2 && d.motion.queue.every((item) => item.index === 0));
});

const changedOverTime = (state, ms, seed = 6) => {
  const a = animator(seed);
  a.setState({ ...state, fetuses: quiet, vitality: 100, libido: 0 });
  const steady = animator(seed);
  // 对照组：同一个状态，只关掉需求类的效果
  steady.setState({ ...state, fetuses: quiet, vitality: 100, libido: 0, overlays: false });
  let most = 0;
  for (let now = 0; now < ms; now += 120) most = Math.max(most, diff(a.tick(now).pixels, steady.tick(now).pixels));
  return most;
};

test('咕噜、漏奶、短裤湿痕、臭烟：需求过门槛才出现', () => {
  const state = { ...base, days: 250 };
  assert.equal(changedOverTime({ ...state, hunger: 60, milk: 60, excretion: 60, odor: 60 }, 60000), 0);
  assert.ok(changedOverTime({ ...state, hunger: 98 }, 90000) >= 6, '咕噜');
  assert.ok(changedOverTime({ ...state, odor: 98 }, 30000) >= 6, '臭烟');
  assert.ok(changedOverTime({ ...state, excretion: 99 }, 5000) >= 6, '短裤湿痕');
  // 穿着：胸衣湿斑；全裸：奶滴沿皮肤流
  assert.ok(changedOverTime({ ...state, milk: 95 }, 5000) >= 6, '胸衣湿斑');
  const nude = { ...state, showBra: false, showShorts: false, strapless: false };
  assert.ok(changedOverTime({ ...nude, milk: 99 }, 60000) >= 2, '奶滴');
  // 不泌乳的阶段、免乳意的类型不漏
  assert.equal(changedOverTime({ ...nude, milk: 99, hormStage: 'cycle' }, 30000), 0);
  assert.equal(changedOverTime({ ...nude, milk: 99, noMilk: true }, 30000), 0);
  // 全裸没有短裤湿痕
  assert.equal(changedOverTime({ ...nude, excretion: 99, uterine: 0 }, 400), 0);
});

test('喷乳：全裸、会泌乳、乳意过满时才喷；用力一踢也会带出来', () => {
  const nude = { ...base, days: 270, showBra: false, showShorts: false, strapless: false, fetuses: [{ size: 1 }] };
  const a = animator(8);
  a.setState({ ...nude, milk: 90 });
  a.tick(0);
  assert.equal(a.trigger('spray', { now: 0 }), true);
  assert.ok(a.motion.sprays.length >= 8);
  const b = animator(8);
  b.setState({ ...nude, milk: 90 });
  b.tick(0);
  b.trigger('big', { fetus: 0, now: 0 });
  assert.ok(b.motion.sprays.length >= 8);
  for (const state of [{ ...nude, milk: 40 }, { ...nude, milk: 90, showBra: true, strapless: true }, { ...nude, milk: 90, hormStage: 'cycle' }]) {
    const c = animator(8);
    c.setState(state);
    c.tick(0);
    assert.equal(c.trigger('spray', { now: 0 }), false, JSON.stringify(state));
  }
});

test('乳头慢半拍：用力一踢后的晃动里，乳头与乳房的位移不同步', () => {
  const a = animator(8);
  a.setState({ ...base, days: 270, showBra: false, showShorts: false, strapless: false, fetuses: [{ size: 1 }] });
  a.tick(0);
  a.trigger('big', { fetus: 0, now: 0 });
  let apart = 0;
  for (let now = 120; now < 1200; now += 30) { const m = a.tick(now).motion; apart = Math.max(apart, Math.abs(m.lift - m.nippleLift)); }
  assert.ok(apart > 0.15, `最多差 ${apart}`);
});

test('事件盖过待机胎动：被指定的那一胎在事件期间与之后 2.5 秒不自己乱动，其他胎照常', () => {
  const twins = { ...base, count: 2, fetuses: [{ size: 1, vigor: 3, zone: { v: 0.2, w: 0.5 } }, { size: 1, vigor: 3, zone: { v: 0.8, w: 0.5 } }] };
  const a = animator(17);
  a.setState(twins);
  a.tick(0);
  let own = 0;
  let other = 0;
  for (let round = 0; round < 40; round += 1) {
    const start = round * 4000;
    a.trigger('roll', { fetus: 0, now: start });
    // 翻身 1.6 秒演完后的 2.5 秒空档里，第 1 胎不该再有动静
    for (let now = start + 1720; now < start + 4000; now += 120) for (const bump of a.tick(now).bumps) { if (bump.fetus === 0) own += 1; else other += 1; }
  }
  assert.equal(own, 0);
  assert.ok(other > 0, '另一胎应照常自己动');
});

test('高潮与抽送：乳房弹动，高潮时孕肚绷紧一次并带出喷乳', () => {
  const nude = { ...base, days: 270, milk: 90, showBra: false, showShorts: false, strapless: false, fetuses: [{ size: 1, canMove: false }], vitality: 100, libido: 0 };
  const a = animator(5);
  a.setState(nude);
  a.tick(0);
  assert.equal(a.trigger('orgasm', { now: 0 }), true);
  assert.ok(a.motion.sprays.length >= 8);
  let apart = 0; let tight = 0;
  for (let now = 30; now < 3200; now += 30) { const m = a.tick(now).motion; apart = Math.max(apart, Math.abs(m.lift - m.nippleLift)); tight = Math.max(tight, m.contraction); }
  assert.ok(apart > 0.15 && tight > 0.2 && tight <= 0.25, JSON.stringify({ apart, tight }));
  for (let now = 3200; now < 6000; now += 120) a.tick(now);
  // 播完就结束（乳意高，漏奶还会继续，那是另一回事）
  assert.equal(a.motion.bounces.length + a.motion.contractions.length, 0);
  const b = animator(5);
  b.setState({ ...nude, milk: 20 });
  b.tick(0);
  assert.equal(b.trigger('thrust', { now: 0, count: 4 }), true);
  assert.equal(b.motion.bounces.length, 4);
  assert.equal(b.motion.sprays.length, 0);
  assert.equal(b.motion.contractions.length, 0);
  // 没顶到宫颈口：胎儿不受惊动
  assert.equal(b.motion.queue.length, 0);
});

test('抽送顶到宫颈口：最下面会动的那一胎每一下晃一下、之后回踢；入盆的胎不算', () => {
  const twins = { ...base, days: 240, fetuses: [{ size: 0.9, zone: { v: 0.3, w: 0.4 } }, { size: 0.9, zone: { v: 0.7, w: 0.4 } }] };
  const a = animator(3);
  a.setState(twins);
  a.tick(0);
  assert.equal(a.trigger('thrust', { now: 0, count: 3, reach: true }), true);
  assert.equal(a.motion.queue.length, 4);
  assert.ok(a.motion.queue.every((item) => item.index === 1));
  assert.ok(a.motion.quiet[1] > 3000 && !a.motion.quiet[0]);
  for (let now = 60; now < 2400; now += 60) a.tick(now);
  assert.equal(a.motion.queue.length, 0);
  // 最下面那胎已入盆：换上面还会动的那一胎
  const b = animator(3);
  b.setState({ ...twins, fetuses: [twins.fetuses[0], { ...twins.fetuses[1], canMove: false }] });
  b.tick(0);
  b.trigger('thrust', { now: 0, count: 1, reach: true });
  assert.ok(b.motion.queue.length === 2 && b.motion.queue.every((item) => item.index === 0));
  // 没有会动的胎：只有乳摇
  const c = animator(3);
  c.setState({ ...base, days: 0, fetuses: [] });
  c.tick(0);
  c.trigger('thrust', { now: 0, count: 2, reach: true });
  assert.equal(c.motion.queue.length, 0);
});

test('孕前虚影：孕期叠一圈孕前的外轮廓，孕前孕后一样时不画，静止不动', () => {
  const pregnant = { ...base, cup: 80, build: 58, hip: 60, days: 280, fetuses: [{ size: 1, canMove: false }], vitality: 100, libido: 0 };
  const plain = animator();
  plain.setState(pregnant);
  const without = Uint32Array.from(plain.tick(0, { still: true }).pixels);
  const a = animator();
  a.setState({ ...pregnant, ghost: { cup: 60, build: 50, hip: 50 } });
  // 平常不画：与没有虚影的画面相同；按住时才浮现，放开又收起来
  assert.equal(diff(a.tick(0, { still: true }).pixels, without), 0);
  a.showGhost(true);
  const withGhost = Uint32Array.from(a.tick(0, { still: true }).pixels);
  a.showGhost(false);
  assert.equal(diff(a.tick(0, { still: true }).pixels, without), 0);
  a.showGhost(true);
  const cells = diff(withGhost, without);
  assert.ok(cells >= 60 && cells <= 1500, `虚影 ${cells} 格`);
  assert.ok(a.scene.ghost.outline.length >= 20);
  assert.ok(a.scene.ghost.hatch.length >= 40, `条纹只有 ${a.scene.ghost.hatch.length} 格`);
  // 孕前的肚子比较小：虚影有落在现在的孕肚里面的格子
  const { rest, layers } = a.scene;
  let inside = 0;
  for (const i of a.scene.ghost.outline) if (rest.visibleBelly[i]) inside += 1;
  // 条纹铺在孕前身体的范围：长出来的孕肚前半没有条纹
  let front = 0;
  let striped = 0;
  const row = Math.round(rest.fig.rows.navelRow);
  const hatched = new Set(a.scene.ghost.hatch);
  for (let x = 0; x < 136; x += 1) { const i = row * 136 + x; if (!rest.visibleBelly[i]) continue; front += 1; if (front <= 12 && [0, 1, 2, 3].some((d) => hatched.has(i + d))) striped += 1; }
  assert.equal(striped, 0, '孕肚最前面那 12 格不该有条纹');
  assert.ok(inside >= 10, `落在孕肚里的只有 ${inside} 格`);
  assert.ok(layers.ghost !== layers.background);
  // 没怀孕、身材也没变：不画
  const same = animator();
  same.setState({ ...calm, ghost: { cup: calm.cup, build: calm.build, hip: calm.hip } });
  assert.equal(same.scene.ghost, null);
  // 换虚影会重建静止画面；呼吸时虚影的格子不动
  a.setState({ ...pregnant, ghost: { cup: 40, build: 50, hip: 50 } });
  assert.equal(a.stats.scenes, 2);
});
