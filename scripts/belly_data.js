// 孕体特写的执行期资料：tools/build-belly-data.mjs 烘出的 assets/belly/closeup-data.bin 的编解码。
// 纯计算，不碰 DOM；浏览器与 Node 测试共用。
//
// 档案格式（小端）：
//   0  'BSB1'
//   4  u32  档头 JSON 的位元组数
//   8  档头 JSON（UTF-8），之后补 0 对齐到 4
//   …  资料区：cells（标注与孕肚范围）、points（手绘线的点，Float32 x,y）
//
// cells：每张参考 width×height 格，一格一个位元组（低 3 位是标注 0–5，第 3 位是孕肚范围），
// 先与上一列同栏做 XOR（轮廓逐列只移一两格，绝大多数变成 0），再把连续的 0 记成长度：
//   [0 的个数（varint）][一个非 0 位元组] …… 最后以 [0 的个数] 收尾。
// 不依赖浏览器的解压 API，解码是同步的。

export const BELLY_DATA_MAGIC = 'BSB1';
export const BELLY_DATA_FORMAT = 'bs-belly-closeup';
export const BELLY_DATA_VERSION = 1;

/** 标注代号（与轮廓编辑器相同） */
export const BELLY_LABEL = Object.freeze({ NONE: 0, SKIN: 1, BRA: 2, SHORTS: 3, TRIM: 4, LEGS: 5 });
/** 手绘线种类；档头里每条线只记这张表的索引 */
export const BELLY_LINE_KINDS = Object.freeze(['groin_contour', 'cleavage', 'breast_contour', 'belly_turn', 'linea', 'belly_fold']);
export const BELLY_LINE_LAYERS = Object.freeze(['guide', 'skin', 'bra', 'shorts']);

const LABEL_MASK = 7;
const BELLY_BIT = 8;

export function bellyAnchorKey(sigma, cup, stage) {
  return `${sigma}/${cup}/${stage}`;
}

/** 把多张参考的格子（已合成一格一位元组）压成 cells 资料 */
export function packBellyCells(cells, width) {
  const out = [];
  const pushVarint = (value) => {
    let rest = value;
    while (rest >= 128) { out.push((rest & 127) | 128); rest = Math.floor(rest / 128); }
    out.push(rest);
  };
  const perAnchor = cells.perAnchor;
  let zeros = 0;
  for (let i = 0; i < cells.bytes.length; i += 1) {
    const row = Math.floor((i % perAnchor) / width);
    const value = cells.bytes[i] ^ (row > 0 ? cells.bytes[i - width] : 0);
    if (value === 0) { zeros += 1; continue; }
    pushVarint(zeros);
    zeros = 0;
    out.push(value);
  }
  pushVarint(zeros);
  return Uint8Array.from(out);
}

/** packBellyCells 的反向：回传 count×perAnchor 个位元组 */
export function unpackBellyCells(packed, { width, perAnchor, count }) {
  const total = perAnchor * count;
  const bytes = new Uint8Array(total);
  let at = 0;
  let cursor = 0;
  const readVarint = () => {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (at >= packed.length) throw new Error('belly data: cells 资料提前结束');
      const byte = packed[at];
      at += 1;
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  };
  while (at < packed.length) {
    cursor += readVarint();
    if (at >= packed.length) break;
    if (cursor >= total) throw new Error('belly data: cells 资料超出范围');
    bytes[cursor] = packed[at];
    at += 1;
    cursor += 1;
  }
  if (cursor !== total) throw new Error(`belly data: cells 应有 ${total} 格，解出 ${cursor} 格`);
  // 还原 XOR：每张参考的第一列是原值，其余各列与上一列相加（XOR）
  for (let i = 0; i < total; i += 1) {
    if (Math.floor((i % perAnchor) / width) > 0) bytes[i] ^= bytes[i - width];
  }
  return bytes;
}

/** 组出整份档案。header 不含 blobs，这里补上 */
export function encodeBellyData(header, { cells, points }) {
  const packed = packBellyCells(cells, header.grid.width);
  const pointBytes = new Uint8Array(points.length * 4);
  const pointView = new DataView(pointBytes.buffer);
  points.forEach((value, index) => pointView.setFloat32(index * 4, value, true));
  const fullHeader = {
    ...header,
    blobs: { cells: [0, packed.length], points: [packed.length, pointBytes.length] },
  };
  const json = new TextEncoder().encode(JSON.stringify(fullHeader));
  const headerEnd = 8 + json.length;
  const dataStart = Math.ceil(headerEnd / 4) * 4;
  const out = new Uint8Array(dataStart + packed.length + pointBytes.length);
  out.set(new TextEncoder().encode(BELLY_DATA_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(packed, dataStart);
  out.set(pointBytes, dataStart + packed.length);
  return out;
}

/**
 * 解开整份档案。
 * 回传 { header, grid, anchors, anchor(key), keys }；anchors 的顺序与烘焙时相同。
 * 每张参考：{ key, sigma, cup, stage, bulk, crotch, rect, measure, borrowed, lines, labels, belly }
 * labels、belly 第一次读取时才从共用的格子资料切出来。
 */
export function decodeBellyData(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== BELLY_DATA_MAGIC) throw new Error('belly data: 档头不符');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
  if (header.format !== BELLY_DATA_FORMAT || header.version !== BELLY_DATA_VERSION) {
    throw new Error(`belly data: 不支援的格式 ${header.format} v${header.version}`);
  }
  const dataStart = Math.ceil((8 + headerLength) / 4) * 4;
  const { width, height } = header.grid;
  const perAnchor = width * height;
  const count = header.anchors.length;
  const [cellsAt, cellsLength] = header.blobs.cells;
  const [pointsAt, pointsLength] = header.blobs.points;
  const cells = unpackBellyCells(bytes.subarray(dataStart + cellsAt, dataStart + cellsAt + cellsLength), { width, perAnchor, count });
  const pointBase = dataStart + pointsAt;
  let pointCursor = 0;
  const readPoint = () => {
    if (pointCursor + 8 > pointsLength) throw new Error('belly data: points 资料提前结束');
    const point = [view.getFloat32(pointBase + pointCursor, true), view.getFloat32(pointBase + pointCursor + 4, true)];
    pointCursor += 8;
    return point;
  };
  const anchors = header.anchors.map((meta, index) => {
    const { lines: lineMeta, measure: measureMeta, ...rest } = meta;
    // 量测表里同一份值可能被多张参考共用：每张各拿一份副本，改了互不影响
    const measure = Object.fromEntries(Object.entries(measureMeta).map(([key, at]) => [key, JSON.parse(JSON.stringify(header.measurePool[at]))]));
    const lines = lineMeta.map(([kind, pointCount, smooth, layer]) => ({
      kind: BELLY_LINE_KINDS[kind],
      layer: BELLY_LINE_LAYERS[layer],
      smooth: smooth === 1,
      closed: false,
      points: Array.from({ length: pointCount }, readPoint),
    }));
    const anchor = { ...rest, key: bellyAnchorKey(meta.sigma, meta.cup, meta.stage), measure, lines };
    const offset = index * perAnchor;
    let labels = null;
    let belly = null;
    Object.defineProperty(anchor, 'labels', {
      enumerable: true,
      get() {
        if (!labels) { labels = new Uint8Array(perAnchor); for (let i = 0; i < perAnchor; i += 1) labels[i] = cells[offset + i] & LABEL_MASK; }
        return labels;
      },
    });
    Object.defineProperty(anchor, 'belly', {
      enumerable: true,
      get() {
        if (!belly) { belly = new Uint8Array(perAnchor); for (let i = 0; i < perAnchor; i += 1) belly[i] = cells[offset + i] & BELLY_BIT ? 1 : 0; }
        return belly;
      },
    });
    return anchor;
  });
  if (pointCursor !== pointsLength) throw new Error('belly data: points 资料长度不符');
  const byKey = new Map(anchors.map((anchor) => [anchor.key, anchor]));
  return {
    header,
    grid: header.grid,
    anchors,
    keys: anchors.map((anchor) => anchor.key),
    anchor: (key) => byKey.get(key) || null,
  };
}

/** 把一张参考的标注与孕肚范围合成一格一位元组（烘焙用） */
export function mergeBellyCell(label, belly) {
  return (label & LABEL_MASK) | (belly ? BELLY_BIT : 0);
}

let bellyDataPromise = null;
/**
 * 浏览器端：第一次要画特写时才抓资料档并解开（不拖慢插件载入），之后共用同一份。
 * 失败时下次呼叫会重试。
 */
export function loadBellyData(url) {
  if (!bellyDataPromise) {
    bellyDataPromise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`belly data: HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => decodeBellyData(buffer))
      .catch((error) => { bellyDataPromise = null; throw error; });
  }
  return bellyDataPromise;
}
