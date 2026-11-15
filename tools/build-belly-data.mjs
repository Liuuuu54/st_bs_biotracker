// 孕体特写的离线烘焙：作者的轮廓 JSON ＋ 编辑器底稿 → assets/belly/closeup-data.bin。
//
// 用法（专案根目录）：
//   node tools/build-belly-data.mjs [轮廓.json]            重烘
//   node tools/build-belly-data.mjs [轮廓.json] --check    重烘后与现有档案逐位元组比对，不写档
//   加 --report 印出完整报告（JSON）
//
// 输入都不进版控（根目录的轮廓 JSON、previews/belly-reference/ 的编辑器底稿），只在作者的机器上有；
// 输入不存在时 --check 直接略过并说明，烘好的 closeup-data.bin 才是进版控的那一份。
//
// 这里做完、执行期不再做的事（步骤与顺序照预览页 PREGNANCY_TRACE_NUDE.html 载入时的做法）：
//   1. 读编辑器底稿（210 张的原图位置 tf／box／size、胯下高度、底稿自带的量测）
//   2. 套用轮廓 JSON 的 referenceOverrides（逐格明列的补值，不是通则）
//   3. 借量测：乳沟、乳沟上点、胸下弧线多数参考没量，向最近的参考借，并记下哪些是借的
//   4. 套用作者的标注、孕肚范围、手绘线与量测
//   5. ±1.5σ 对位：84 张的摆放偏离画框规则，依两侧体型（0σ 与 ±3σ）把整张搬到规则位置
//   6. 不带任何 PNG；每张只留标注、孕肚范围、手绘线、量测、胯下高度与原图范围
//   7. 各体型的取景范围（scripts/belly_layout.js 的 computeDerived：要全部 210 张的距离场）
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  BELLY_DATA_FORMAT, BELLY_DATA_VERSION, BELLY_LINE_KINDS, BELLY_LINE_LAYERS,
  decodeBellyData, encodeBellyData, mergeBellyCell,
} from '../scripts/belly_data.js';
import { createBellyLayout } from '../scripts/belly_layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE_DIR = path.join(ROOT, 'previews', 'belly-reference');
const OUTPUT = path.join(ROOT, 'assets', 'belly', 'closeup-data.bin');
const DEFAULT_SOURCE = 'pregnancy-contours-2026-11-14-supported-calibrated.json';
// 与预览页相同的载入顺序：后面的档会修补前面已载入的参考
const SEED_FILES = [
  'contour-editor-data.js',
  'contour-editor-zero-n-data.js',
  'contour-editor-extreme-n-data.js',
  'contour-editor-mid1p5-data.js',
  'contour-editor-plus1p5-bra-repair-data.js',
  'contour-editor-b-data.js',
  'contour-editor-d-calibrated-data.js',
  'contour-editor-g-data.js',
  'contour-editor-i-calibrated-data.js',
  'contour-editor-l-data.js',
];
const OVERRIDE_FIELDS = ['file', 'size', 'box', 'tf', 'crotch'];
const CUPS = [['AAA', 0], ['B', 30], ['D', 50], ['G', 80], ['I', 100], ['L', 130], ['N', 150]];
const SIGMAS = [-3, -1.5, 0, 1.5, 3];
const STAGES = ['empty', 'mid', 'late', 'twins', 'triplets', 'quint'];
const BORROWED_SHAPE_KEYS = ['cleft', 'cleavageTop', 'underbust'];
const BORROWED_NIPPLE_KEYS = ['nippleLeft', 'nippleRight'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const printReport = args.includes('--report');
const inputs = args.filter((arg) => !arg.startsWith('--'));
if (inputs.length > 1) throw new Error('用法：node tools/build-belly-data.mjs [专案内的轮廓.json] [--check] [--report]');
const sourcePath = path.resolve(ROOT, inputs[0] || DEFAULT_SOURCE);
const sourceRelative = path.relative(ROOT, sourcePath).replaceAll('\\', '/');
if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) throw new Error('轮廓 JSON 必须在专案内');

const missing = [sourcePath, path.join(REFERENCE_DIR, 'contour-data-format.js'), ...SEED_FILES.map((file) => path.join(REFERENCE_DIR, file))]
  .filter((file) => !fs.existsSync(file));
if (missing.length) {
  const list = missing.map((file) => path.relative(ROOT, file).replaceAll('\\', '/')).join('、');
  if (check) {
    console.log(JSON.stringify({ check: 'skipped', reason: `烘焙输入不在这台机器上（不进版控）：${list}` }));
    process.exit(0);
  }
  throw new Error(`缺少烘焙输入：${list}`);
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const cupValue = (cup) => CUPS.find(([name]) => name === cup)?.[1] ?? 0;
const keyOf = (anchor) => `${anchor.sigma}/${anchor.cup}/${anchor.stage}`;

// ---- 1. 编辑器底稿 ----
const IO = createRequire(import.meta.url)(path.join(REFERENCE_DIR, 'contour-data-format.js'));
const { width: W, height: H, step: STEP, crop } = IO.GRID;
const [X0, Y0] = crop;
const N = W * H;

function loadSeeds() {
  // 底稿是「window.PregnancyContourData.anchors.push(...)」这类浏览器脚本；在隔离的环境里照顺序执行
  const context = vm.createContext({ structuredClone, console });
  context.window = context;
  context.globalThis = context;
  const hashes = {};
  for (const file of SEED_FILES) {
    const bytes = fs.readFileSync(path.join(REFERENCE_DIR, file));
    hashes[file] = sha256(bytes).slice(0, 16);
    vm.runInContext(bytes.toString('utf8'), context, { filename: file });
  }
  const anchors = context.PregnancyContourData?.anchors;
  if (!Array.isArray(anchors)) throw new Error('编辑器底稿没有 PregnancyContourData.anchors');
  return {
    hashes,
    seeds: anchors.map((seed) => ({
      sigma: seed.sigma, cup: seed.cup, stage: seed.stage, bulk: seed.bulk,
      tf: clone(seed.tf), box: seed.box ? clone(seed.box) : null, size: clone(seed.size),
      crotch: seed.crotch, measure: clone(seed.measure),
    })),
  };
}

// ---- 3. 借量测（照预览页 borrowMeasures）----
function borrowMeasures(anchors) {
  const borrowedNow = [];
  const borrow = (keys, order) => {
    for (const key of keys) {
      for (const anchor of anchors) {
        if (anchor.measure[key] != null) continue;
        const donor = anchors.filter((other) => other.measure[key] != null && !other.borrowed.has(key)).sort(order(anchor))[0];
        if (!donor) continue;
        anchor.measure[key] = clone(donor.measure[key]);
        anchor.borrowed.add(key);
        borrowedNow.push({ key: keyOf(anchor), measure: key, from: keyOf(donor) });
      }
    }
  };
  // 乳沟、乳沟上点、胸下弧线：同孕况优先，再取体型最近、罩杯最近
  borrow(BORROWED_SHAPE_KEYS, (anchor) => (p, q) => (p.stage !== anchor.stage) - (q.stage !== anchor.stage)
    || Math.abs(p.sigma - anchor.sigma) - Math.abs(q.sigma - anchor.sigma)
    || Math.abs(cupValue(p.cup) - cupValue(anchor.cup)) - Math.abs(cupValue(q.cup) - cupValue(anchor.cup)));
  // 乳头：同体型同罩杯、孕况最近（乳头在孕况之间移动少，罩杯之间移动多）
  borrow(BORROWED_NIPPLE_KEYS, (anchor) => (p, q) => Math.abs(p.sigma - anchor.sigma) - Math.abs(q.sigma - anchor.sigma)
    || Math.abs(cupValue(p.cup) - cupValue(anchor.cup)) - Math.abs(cupValue(q.cup) - cupValue(anchor.cup))
    || Math.abs(STAGES.indexOf(p.stage) - STAGES.indexOf(anchor.stage)) - Math.abs(STAGES.indexOf(q.stage) - STAGES.indexOf(anchor.stage)));
  return borrowedNow;
}

// ---- 5. ±1.5σ 对位（照预览页 registerHalfSigmas）----
const groinTipX = (anchor) => {
  const groin = anchor.lines.find((line) => line.kind === 'groin_contour');
  return groin ? groin.points.reduce((low, point) => (point[1] > low[1] ? point : low))[0] : null;
};

function registerHalfSigmas(anchors) {
  const anchorOf = (sigma, cup, stage) => anchors.find((a) => a.sigma === sigma && a.cup === cup && a.stage === stage);
  for (const anchor of anchors) { anchor.baseTf = anchor.tf.slice(); anchor.baseCrotch = anchor.crotch; }
  // 先记下所有胯线尖端的原始位置：没画胯线的孕况借同体型同罩杯未孕那张的，借到的必须是搬动前的位置
  const tips = new Map(anchors.map((anchor) => [anchor, groinTipX(anchor)]));
  const tipOf = (anchor) => tips.get(anchor) ?? tips.get(anchorOf(anchor.sigma, anchor.cup, 'empty'));
  const moved = [];
  const skipped = [];
  for (const a of anchors) {
    if (Math.abs(a.sigma) !== 1.5) continue;
    const side = Math.sign(a.sigma) * 3;
    const n0 = anchorOf(0, a.cup, a.stage);
    const n3 = anchorOf(side, a.cup, a.stage);
    const Tn = (n0.measure.neck[1] + n3.measure.neck[1]) / 2;
    const Tc = (anchorOf(0, a.cup, 'empty').baseCrotch + anchorOf(side, a.cup, 'empty').baseCrotch) / 2;
    const t0 = tipOf(n0);
    const t3 = tipOf(n3);
    const tip = tipOf(a);
    const ny = a.measure.neck[1];
    if (t0 == null || t3 == null || tip == null) { skipped.push({ key: keyOf(a), reason: '没有胯线尖端可对' }); continue; }
    const Tx = (t0 + t3) / 2;
    const s = (Tc - Tn) / (a.baseCrotch - ny);
    if (!(s > 0.5 && s < 2)) { skipped.push({ key: keyOf(a), reason: `缩放 ${s} 超出范围` }); continue; }
    const map = ([x, y]) => [Tx + s * (x - tip), Tn + s * (y - ny)];
    const back = ([x, y]) => [tip + (x - Tx) / s, ny + (y - Tn) / s];
    for (const key of a.borrowed) delete a.measure[key];
    a.borrowed = new Set();
    const regrid = (source) => {
      const out = new Uint8Array(N);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const [px, py] = back([X0 + (x + 0.5) * STEP, Y0 + (y + 0.5) * STEP]);
          const sx = Math.floor((px - X0) / STEP);
          const sy = Math.floor((py - Y0) / STEP);
          if (sx >= 0 && sx < W && sy >= 0 && sy < H) out[y * W + x] = source[sy * W + sx];
        }
      }
      return out;
    };
    a.labels = regrid(a.labels);
    a.belly = regrid(a.belly);
    a.lines = a.lines.map((line) => ({ ...line, points: line.points.map(map) }));
    const m = { ...a.measure };
    for (const key of ['neck', 'navel', 'cleavageTop', 'nippleLeft', 'nippleRight']) if (Array.isArray(m[key])) m[key] = map(m[key]);
    if (Array.isArray(m.cleft)) m.cleft = m.cleft.map(map);
    if (Number.isFinite(m.hem)) m.hem = Tn + s * (m.hem - ny);
    if (m.underbust?.coef && m.underbust?.x) {
      const [c2, c1, c0] = m.underbust.coef;
      const [u0, u1] = m.underbust.x;
      const points = Array.from({ length: 9 }, (_, k) => { const x = u0 + (u1 - u0) * k / 8; return map([x, c2 * x * x + c1 * x + c0]); });
      // 搬动后的曲线重新拟合二次式（最小平方）
      const S = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
      for (const [x, y] of points) {
        const row = [x * x, x, 1];
        for (let i = 0; i < 3; i += 1) { for (let j = 0; j < 3; j += 1) S[i][j] += row[i] * row[j]; S[i][3] += row[i] * y; }
      }
      for (let i = 0; i < 3; i += 1) {
        let pivot = i;
        for (let r = i + 1; r < 3; r += 1) if (Math.abs(S[r][i]) > Math.abs(S[pivot][i])) pivot = r;
        [S[i], S[pivot]] = [S[pivot], S[i]];
        for (let r = 0; r < 3; r += 1) if (r !== i) { const f = S[r][i] / S[i][i]; for (let c = i; c < 4; c += 1) S[r][c] -= f * S[i][c]; }
      }
      m.underbust = { coef: [S[0][3] / S[0][0], S[1][3] / S[1][1], S[2][3] / S[2][2]], x: [points[0][0], points.at(-1)[0]] };
    }
    a.measure = m;
    a.crotch = Tn + s * (a.baseCrotch - ny);
    const [t0b, t1b, t2b] = a.baseTf;
    a.tf = [s * t0b, Tx + s * (t1b - tip), Tn + s * (t2b - ny)];
    a.registered = { s, dx: Tx - tip, neck: [ny, Tn] };
    moved.push({ key: keyOf(a), scale: s, shiftCells: (Tx - tip) / STEP });
  }
  return { moved, skipped, borrowed: borrowMeasures(anchors) };
}

// ---- 组装 ----
function build() {
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceDocument = JSON.parse(sourceBytes.toString('utf8'));
  const { seeds, hashes } = loadSeeds();
  const expected = SIGMAS.length * CUPS.length * STAGES.length;
  if (seeds.length !== expected) throw new Error(`编辑器底稿应有 ${expected} 张，实际 ${seeds.length} 张`);

  // 2. referenceOverrides
  const overrides = sourceDocument.referenceOverrides || {};
  const overrideReport = [];
  const seedByKey = new Map(seeds.map((seed) => [keyOf(seed), seed]));
  for (const [key, patch] of Object.entries(overrides)) {
    const seed = seedByKey.get(key);
    if (!seed) throw new Error(`referenceOverrides 有未知的参考：${key}`);
    const fields = OVERRIDE_FIELDS.filter((field) => Object.hasOwn(patch, field));
    for (const field of fields) seed[field] = clone(patch[field]);
    overrideReport.push({ key, fields, ...(fields.includes('crotch') ? { crotch: patch.crotch } : {}) });
  }

  const anchors = seeds.map((seed) => ({ ...seed, borrowed: new Set(), lines: [], labels: null, belly: null, registered: null }));
  // 3. 第一次借量测：底稿自带的量测之间互借（与预览页开页时相同）
  borrowMeasures(anchors);

  // 4. 作者的标注
  const document = IO.validate(sourceDocument, seeds);
  if (document.anchors.length !== expected) throw new Error(`轮廓 JSON 应有 ${expected} 张，实际 ${document.anchors.length} 张`);
  const anchorByKey = new Map(anchors.map((anchor) => [keyOf(anchor), anchor]));
  const unfinished = [];
  for (const record of document.anchors) {
    const anchor = anchorByKey.get(record.key);
    if (!record.edited || !record.reviewed || !record.masks?.belly) { unfinished.push(record.key); continue; }
    anchor.labels = Uint8Array.from(record.labels);
    anchor.belly = Uint8Array.from(record.masks.belly);
    anchor.measure = { ...anchor.measure, ...clone(record.measure) };
    for (const key of Object.keys(record.measure || {})) anchor.borrowed.delete(key);
    anchor.lines = clone(record.lines);
  }
  if (unfinished.length) throw new Error(`轮廓 JSON 有未完成（未修改、未审或缺孕肚范围）的参考：${unfinished.join('、')}`);

  // 5. ±1.5σ 对位
  const registration = registerHalfSigmas(anchors);

  // 检查：执行期成图需要的资料都在
  const problems = [];
  for (const anchor of anchors) {
    const key = keyOf(anchor);
    const m = anchor.measure;
    for (const point of ['neck', 'navel', 'nippleLeft', 'nippleRight', 'cleavageTop']) {
      if (!Array.isArray(m[point]) || !m[point].every(Number.isFinite)) problems.push(`${key} 缺 ${point}`);
    }
    if (!Number.isFinite(m.hem)) problems.push(`${key} 缺 hem`);
    if (!Array.isArray(m.cleft)) problems.push(`${key} 缺 cleft`);
    if (!m.underbust?.coef) problems.push(`${key} 缺 underbust`);
    if (!Number.isFinite(anchor.crotch)) problems.push(`${key} 缺胯下高度`);
    if (anchor.lines.filter((line) => line.kind === 'breast_contour').length !== 2) problems.push(`${key} 的乳下线不是两条`);
    for (const label of [2, 3]) if (!anchor.labels.includes(label)) problems.push(`${key} 没有${label === 2 ? '胸衣' : '短裤'}标注`);
    if (!anchor.belly.includes(1)) problems.push(`${key} 没有孕肚范围`);
  }
  if (problems.length) throw new Error(`烘焙资料不完整：\n${problems.join('\n')}`);

  // 6. 输出
  const cells = { perAnchor: N, bytes: new Uint8Array(N * anchors.length) };
  const points = [];
  // 量测值很多是借来的同一份（乳沟 201 张只有几种），集中放一张表、每张参考只记索引
  const pool = [];
  const poolIndex = new Map();
  const pooled = (value) => {
    const text = JSON.stringify(value);
    if (!poolIndex.has(text)) { poolIndex.set(text, pool.length); pool.push(value); }
    return poolIndex.get(text);
  };
  const headerAnchors = anchors.map((anchor, index) => {
    for (let i = 0; i < N; i += 1) cells.bytes[index * N + i] = mergeBellyCell(anchor.labels[i], anchor.belly[i]);
    const [scale, tx, ty] = anchor.tf;
    const [bx, by, bx2, by2] = anchor.box || [0, 0, ...anchor.size];
    const lines = anchor.lines.map((line) => {
      if (line.closed) throw new Error(`${keyOf(anchor)} 有封闭线，执行期资料未支援`);
      for (const [x, y] of line.points) points.push(x, y);
      return [BELLY_LINE_KINDS.indexOf(line.kind), line.points.length, line.smooth ? 1 : 0, BELLY_LINE_LAYERS.indexOf(line.layer)];
    });
    if (lines.some(([kind, , , layer]) => kind < 0 || layer < 0)) throw new Error(`${keyOf(anchor)} 有未知的线条种类或图层`);
    return {
      sigma: anchor.sigma, cup: anchor.cup, stage: anchor.stage, bulk: anchor.bulk,
      crotch: anchor.crotch,
      // 原图在画布座标上的范围（左、上、右、下）：范围外没有来源像素
      rect: [tx, ty, tx + (bx2 - bx) * scale, ty + (by2 - by) * scale],
      measure: Object.fromEntries(Object.entries(anchor.measure).filter(([, value]) => value != null).map(([key, value]) => [key, pooled(value)])),
      borrowed: [...anchor.borrowed].sort(),
      lines,
    };
  });
  const header = {
    format: BELLY_DATA_FORMAT,
    version: BELLY_DATA_VERSION,
    grid: { width: W, height: H, step: STEP, crop: [...crop] },
    sigmas: SIGMAS,
    cups: CUPS,
    stages: STAGES,
    source: { contours: sourceRelative, sha256: sha256(sourceBytes), seeds: hashes },
    measurePool: pool,
    anchors: headerAnchors,
  };
  // 7. 取景：各体型的画框范围与画面高度要全部参考的距离场才算得出来，这里算好放进档头
  header.derived = createBellyLayout(decodeBellyData(encodeBellyData(header, { cells, points }))).computeDerived();
  const bytes = encodeBellyData(header, { cells, points });

  // 报告（不进档案）
  const isolated = anchors.map((anchor) => {
    let count = 0;
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = y * W + x;
        const value = anchor.labels[i];
        if (anchor.labels[i - 1] !== value && anchor.labels[i + 1] !== value && anchor.labels[i - W] !== value && anchor.labels[i + W] !== value) count += 1;
      }
    }
    return { key: keyOf(anchor), count };
  }).filter((entry) => entry.count > 0);
  const borrowedCounts = {};
  for (const anchor of anchors) for (const key of anchor.borrowed) borrowedCounts[key] = (borrowedCounts[key] || 0) + 1;
  const report = {
    source: header.source.contours,
    sha256: header.source.sha256,
    anchors: anchors.length,
    lines: anchors.reduce((sum, anchor) => sum + anchor.lines.length, 0),
    linePoints: points.length / 2,
    bytes: { total: bytes.length, header: new DataView(bytes.buffer).getUint32(4, true) },
    overrides: {
      entries: overrideReport.length,
      crotch: overrideReport.filter((entry) => entry.fields.includes('crotch')).map((entry) => `${entry.key}=${entry.crotch}`),
      placement: overrideReport.filter((entry) => entry.fields.includes('tf')).map((entry) => entry.key),
    },
    registration: {
      moved: registration.moved.length,
      skipped: registration.skipped,
      scale: [Math.min(...registration.moved.map((entry) => entry.scale)), Math.max(...registration.moved.map((entry) => entry.scale))],
      shiftCells: [Math.min(...registration.moved.map((entry) => entry.shiftCells)), Math.max(...registration.moved.map((entry) => entry.shiftCells))],
    },
    borrowed: borrowedCounts,
    derived: header.derived,
    // 只列出、不修改：上下左右都与自己不同类的单格（作者标注里的零星杂点候选）
    isolatedCells: { anchors: isolated.length, cells: isolated.reduce((sum, entry) => sum + entry.count, 0), worst: isolated.sort((p, q) => q.count - p.count).slice(0, 8) },
  };
  return { bytes, report, detail: { overrides: overrideReport, registration } };
}

const { bytes, report, detail } = build();
// 烘完自己解一次：格数、点数对得上才算数
const decoded = decodeBellyData(bytes);
if (decoded.anchors.length !== report.anchors) throw new Error('烘焙结果解不回同样的张数');

const outputRelative = path.relative(ROOT, OUTPUT).replaceAll('\\', '/');
if (check) {
  if (!fs.existsSync(OUTPUT) || !fs.readFileSync(OUTPUT).equals(Buffer.from(bytes))) {
    throw new Error(`${outputRelative} 与来源不一致，请重烘：node tools/build-belly-data.mjs`);
  }
} else if (!fs.existsSync(OUTPUT) || !fs.readFileSync(OUTPUT).equals(Buffer.from(bytes))) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, bytes);
}
console.log(JSON.stringify({ ...report, output: outputRelative, check }, null, printReport ? 2 : 0));
if (printReport) console.log(JSON.stringify(detail, null, 2));
