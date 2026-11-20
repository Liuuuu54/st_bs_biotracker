// 放松胸型：全裸时胸部下垂、碰到孕肚就停住；动画里没有承托的胸部晃得更大、更慢，被孕肚托住时晃得少。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createBellyAnimator } from '../scripts/belly_anim.js';
import { decodeBellyData } from '../scripts/belly_data.js';
import { createBellyLayout } from '../scripts/belly_layout.js';
import { createBellyPainter } from '../scripts/belly_render.js';
import { BELLY_RELEASE, buildBellyCloseupState } from '../scripts/belly_state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = decodeBellyData(fs.readFileSync(path.join(ROOT, 'assets', 'belly', 'closeup-data.bin')));
const layout = createBellyLayout(data);
const painter = createBellyPainter(layout);
const NUDE = { showBra: false, showShorts: false, strapless: false };
const base = { sigma: 0, cup: 150, build: 50, hip: 50, days: 0, count: 1, weight: 1, hormStage: 'cycle', stageProgress: 30, births: 0, milk: 20, libido: 10, laborPhase: 'none', ...NUDE };
const release = { ...BELLY_RELEASE };
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };

test('放松胸型：N 杯胸下线往下移、画面不同；没给 release 时与原本相同', () => {
  const supported = layout.layout(base);
  const relaxed = layout.layout({ ...base, release });
  assert.ok(relaxed.fig.rows.ubRow > supported.fig.rows.ubRow + 3, `${supported.fig.rows.ubRow} → ${relaxed.fig.rows.ubRow}`);
  assert.ok(diff(painter.paint(supported).pixels, painter.paint(relaxed).pixels) > 100);
  assert.equal(supported.fig.release, undefined);
  assert.equal(supported.fig.rows.loose, undefined);
});

test('放松胸型：小罩杯几乎不动，杯越大垂越多', () => {
  const drop = (cup) => layout.layout({ ...base, cup, release }).fig.rows.ubRow - layout.layout({ ...base, cup }).fig.rows.ubRow;
  assert.ok(drop(30) <= 2, `B ${drop(30)}`);
  assert.ok(drop(100) < drop(150), `I ${drop(100)}，N ${drop(150)}`);
});

test('放松胸型：五胎的孕肚把胸托住，未孕没有托住', () => {
  const quint = layout.layout({ ...base, days: 280, count: 5, hormStage: 'pregnant', release }).fig;
  const empty = layout.layout({ ...base, release }).fig;
  assert.ok(quint.release.rest > 0.5, `五胎 ${quint.release.rest}`);
  assert.equal(empty.release.rest, 0);
});

test('全裸时状态带放松胸型，穿着时不带', () => {
  const input = { drawable: true, sigma: 0, body: { build: 50, bust: 50, hip: 50 }, bellySize: 0, stage: '卵泡期', stageProgress: 0.3, effectiveDays: 0, births: 0, stats: {}, needs: {}, fetuses: [] };
  assert.deepEqual(buildBellyCloseupState({ ...input, outfit: { enabled: true, main: null, wearState: '全裸' } }).release, release);
  assert.equal(buildBellyCloseupState({ ...input, outfit: { enabled: true, main: { name: '连衣裙' }, wearState: '整齐' } }).release, undefined);
});

test('动画：没有承托的 N 杯晃得比穿胸罩时大、周期较长，被孕肚托住时晃得少', () => {
  const peak = (state) => {
    const animator = createBellyAnimator(layout, painter, { random: () => 0.5 });
    animator.setState(state);
    animator.tick(0, { still: true });
    animator.motion.bounces.push({ start: 0, size: 1 });
    let best = 0;
    let at = 0;
    for (let t = 5; t <= 200; t += 5) {
      const { motion } = animator.tick(t);
      const wob = Math.abs(motion.wob ?? 0);
      if (wob > best) { best = wob; at = t; }
    }
    return { best, at };
  };
  const clothed = peak({ ...base, ...{ showBra: true, showShorts: true, strapless: true } });
  const loose = peak({ ...base, release });
  const held = peak({ ...base, days: 280, count: 5, hormStage: 'pregnant', release });
  assert.ok(loose.best > clothed.best * 1.4, `穿胸罩 ${clothed.best}，裸 ${loose.best}`);
  assert.ok(loose.at > clothed.at, `峰值 ${clothed.at} → ${loose.at} ms`);
  assert.ok(held.best < loose.best, `托住 ${held.best}，没托 ${loose.best}`);
});
