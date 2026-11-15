// 孕体特写的执行期资料：编解码来回一致，烘好的 closeup-data.bin 齐全、对位与补值都在。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BELLY_LABEL, BELLY_LINE_KINDS, bellyAnchorKey, decodeBellyData, encodeBellyData, mergeBellyCell,
  packBellyCells, unpackBellyCells,
} from '../scripts/belly_data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(ROOT, 'assets', 'belly', 'closeup-data.bin');
const data = decodeBellyData(fs.readFileSync(DATA_PATH));
const { width: W, height: H, step: STEP, crop } = data.grid;
const N = W * H;
const SIGMAS = [-3, -1.5, 0, 1.5, 3];
const CUPS = ['AAA', 'B', 'D', 'G', 'I', 'L', 'N'];
const STAGES = ['empty', 'mid', 'late', 'twins', 'triplets', 'quint'];
const at = (sigma, cup, stage) => data.anchor(bellyAnchorKey(sigma, cup, stage));
const groinTip = (anchor) => {
  const groin = anchor.lines.find((line) => line.kind === 'groin_contour');
  return groin ? groin.points.reduce((low, point) => (point[1] > low[1] ? point : low))[0] : null;
};
const between = (value, a, b, slack = 0) => value >= Math.min(a, b) - slack && value <= Math.max(a, b) + slack;

test('格子资料压缩后解得回原样（含长串 0、非 0 开头与结尾）', () => {
  const width = 5;
  const perAnchor = 20;
  const bytes = Uint8Array.from([
    1, 1, 0, 0, 9, 1, 1, 0, 0, 9, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    13, 0, 0, 0, 0, 13, 0, 0, 0, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0, 5,
  ]);
  const packed = packBellyCells({ perAnchor, bytes }, width);
  assert.deepEqual(unpackBellyCells(packed, { width, perAnchor, count: 3 }), bytes);
  assert.throws(() => unpackBellyCells(packed.subarray(0, packed.length - 2), { width, perAnchor, count: 3 }));
  assert.throws(() => unpackBellyCells(packed, { width, perAnchor, count: 2 }));
});

test('整份档案编码后解码：标注、孕肚范围、线与量测都一致', () => {
  const grid = { width: 4, height: 3, step: 5, crop: [0, 0, 20, 15] };
  const labels = Uint8Array.from([0, 1, 1, 0, 2, 2, 1, 0, 3, 3, 5, 0]);
  const belly = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  const cells = { perAnchor: 12, bytes: Uint8Array.from(labels, (label, i) => mergeBellyCell(label, belly[i])) };
  const header = {
    format: 'bs-belly-closeup', version: 1, grid,
    measurePool: [[1.5, 2.25], 7],
    anchors: [{ sigma: 0, cup: 'D', stage: 'empty', bulk: 0, crotch: 12.5, rect: [0, 0, 20, 15], measure: { neck: 0, hem: 1 }, borrowed: [], lines: [[2, 2, 1, 2]] }],
  };
  const decoded = decodeBellyData(encodeBellyData(header, { cells, points: [1, 2, 3.5, 4.25] }));
  const anchor = decoded.anchor('0/D/empty');
  assert.deepEqual(anchor.labels, labels);
  assert.deepEqual(anchor.belly, belly);
  assert.deepEqual(anchor.measure, { neck: [1.5, 2.25], hem: 7 });
  assert.deepEqual(anchor.lines, [{ kind: 'breast_contour', layer: 'bra', smooth: true, closed: false, points: [[1, 2], [3.5, 4.25]] }]);
  // 量测是各自的副本
  anchor.measure.neck[0] = 99;
  assert.equal(decodeBellyData(encodeBellyData(header, { cells, points: [1, 2, 3.5, 4.25] })).anchor('0/D/empty').measure.neck[0], 1.5);
  assert.throws(() => decodeBellyData(new Uint8Array(16)), /档头不符/);
});

test('烘好的资料有 5 体型 × 7 罩杯 × 6 孕况共 210 张', () => {
  assert.deepEqual([W, H, STEP, crop], [136, 121, 5, [70, 305, 750, 910]]);
  assert.equal(data.anchors.length, 210);
  for (const sigma of SIGMAS) for (const cup of CUPS) for (const stage of STAGES) assert.ok(at(sigma, cup, stage), `${sigma}/${cup}/${stage}`);
  assert.deepEqual(STAGES.map((stage) => at(0, 'D', stage).bulk), [0, 0.5, 1, 2, 3, 5]);
});

test('每张参考都有成图要用的标注、孕肚范围、量测与手绘线', () => {
  for (const anchor of data.anchors) {
    assert.equal(anchor.labels.length, N, anchor.key);
    assert.ok(anchor.labels.every((label) => label <= BELLY_LABEL.LEGS), anchor.key);
    for (const label of [BELLY_LABEL.SKIN, BELLY_LABEL.BRA, BELLY_LABEL.SHORTS]) assert.ok(anchor.labels.includes(label), `${anchor.key} 标注 ${label}`);
    assert.ok(anchor.belly.includes(1), `${anchor.key} 孕肚范围`);
    const m = anchor.measure;
    for (const key of ['neck', 'navel', 'nippleLeft', 'nippleRight', 'cleavageTop']) assert.ok(m[key].length === 2 && m[key].every(Number.isFinite), `${anchor.key} ${key}`);
    assert.ok(Number.isFinite(m.hem), `${anchor.key} hem`);
    assert.equal(m.cleft.length, 2, `${anchor.key} cleft`);
    assert.equal(m.underbust.coef.length, 3, `${anchor.key} underbust`);
    assert.ok(m.underbust.x[0] < m.underbust.x[1], `${anchor.key} underbust 范围`);
    assert.ok(Number.isFinite(anchor.crotch), `${anchor.key} 胯下`);
    assert.ok(anchor.rect[0] < anchor.rect[2] && anchor.rect[1] < anchor.rect[3], `${anchor.key} 原图范围`);
    // 乳房由正好两条乳下线分瓣（远侧 U＋近侧短线）
    assert.equal(anchor.lines.filter((line) => line.kind === 'breast_contour').length, 2, `${anchor.key} 乳下线`);
    for (const line of anchor.lines) {
      assert.ok(BELLY_LINE_KINDS.includes(line.kind), `${anchor.key} 线种`);
      assert.ok(line.points.length >= 2 && line.points.every((point) => point.every(Number.isFinite)), `${anchor.key} 线的点`);
    }
  }
});

test('乳头都是作者标的，借来的量测只有乳沟、乳沟上点与胸下弧线', () => {
  const counts = {};
  for (const anchor of data.anchors) for (const key of anchor.borrowed) counts[key] = (counts[key] || 0) + 1;
  assert.deepEqual(Object.keys(counts).sort(), ['cleavageTop', 'cleft', 'underbust']);
  for (const anchor of data.anchors) for (const key of anchor.borrowed) assert.ok(anchor.measure[key] != null, `${anchor.key} ${key}`);
});

test('+3σ 的 B、G、L 怀孕各期胯下用同罩杯未孕的补值，不再是裁切框下缘', () => {
  for (const [cup, crotch] of [['B', 848], ['G', 847], ['L', 843]]) {
    for (const stage of STAGES.slice(1)) assert.equal(at(3, cup, stage).crotch, crotch, `3/${cup}/${stage}`);
  }
  for (const anchor of data.anchors) assert.ok(anchor.crotch < crop[3] - 40, `${anchor.key} 胯下 ${anchor.crotch}`);
});

test('±1.5σ 对位后，领口、胯下与胯线尖端落在两侧体型之间', () => {
  for (const sigma of [-1.5, 1.5]) {
    const side = Math.sign(sigma) * 3;
    for (const cup of CUPS) {
      for (const stage of STAGES) {
        const anchor = at(sigma, cup, stage);
        const inner = at(0, cup, stage);
        const outer = at(side, cup, stage);
        const key = anchor.key;
        assert.ok(Math.abs(anchor.measure.neck[1] - (inner.measure.neck[1] + outer.measure.neck[1]) / 2) < 1e-6, `${key} 领口高度`);
        assert.ok(between(anchor.crotch, at(0, cup, 'empty').crotch, at(side, cup, 'empty').crotch, 1e-6), `${key} 胯下`);
        // 胯线尖端：没画胯线的孕况借未孕那张；对位把尖端摆到两侧的平均
        const tip = groinTip(anchor);
        const tips = [inner, outer].map((n) => groinTip(n) ?? groinTip(at(n.sigma, cup, 'empty')));
        if (tip != null) assert.ok(Math.abs(tip - (tips[0] + tips[1]) / 2) < 0.01, `${key} 胯线尖端 ${tip} 对 ${tips}`);
      }
    }
  }
});

test('烘焙脚本 --check：来源在这台机器上时，档案与来源一致', (t) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-belly-data.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n')[0]);
  if (report.check === 'skipped') { t.skip(report.reason); return; }
  assert.equal(report.check, true);
  assert.equal(report.anchors, 210);
  assert.equal(report.sha256, data.header.source.sha256);
});
