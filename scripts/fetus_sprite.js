// 子宫图的胎儿、卵与不定型：以几何部件描述，依实际要画的大小、方向、镜像与挤压直接栅格化成像素格，
// 不缩放、不旋转点阵图，所以 8 个方向与任何尺寸都是干净的原生像素。只产生色调代号，
// 颜色由渲染层依主题色盘决定；没有 DOM 依赖，可在 node 里测。
//
// 胎儿的造型比例取自扁平胎儿图示：浅色大圆头压在一块倾斜的椭圆身体上，手脚各一截往前伸的短肢，
// 胎生有一段脐带从腹部弯出。没有外框，只靠色调分部件。孕早期是大头拖一截弯尾巴的胚胎。
// 设计座标：头朝下、胎背在左、手脚与脸朝右；angle 0 即头位，镜像代表胎背朝右。

// 胎儿形态的胚型阶段；其余阶段是卵（卵生全期、卵胎生孕早、胎转卵生孕晚）或不定型
export function isFetalForm(type, stage) {
  if (type === '胎生') return true;
  if (type === '卵胎生') return stage >= 1;
  if (type === '胎转卵生') return stage <= 1;
  return false;
}

const KNOWN_TYPES = new Set(['胎生', '卵生', '卵胎生', '胎转卵生', '不定型']);

/** 胎转卵生孕晚的羊膜已经硬化、紧贴在蛋上（画在卵的图块里），外面不再有羊水囊；其余有囊的阶段照常画 */
export function hasFluidSac(type, stage) {
  return !(type === '胎转卵生' && stage === 2);
}



const circle = (x, y, r) => ({ kind: 'circle', x, y, r });
const ellipse = (x, y, rx, ry, deg) => ({ kind: 'ellipse', x, y, rx, ry, deg });
const capsule = (x0, y0, x1, y1, r) => ({ kind: 'capsule', x0, y0, x1, y1, r });
const polyline = (points, r, minPx = 0) => ({ kind: 'polyline', points, r, minPx });
const polygon = (points) => ({ kind: 'polygon', points });
// 网格：落在外形里、又落在两组斜线上的点；线宽至少约一像素
const lattice = (shape, period, width, keep = null) => ({ kind: 'lattice', shape, period, width, keep });
// 贴在蛋形外缘的一圈膜：蛋形外、往外 px 像素以内
const film = (shape, px, keep = null) => ({ kind: 'film', shape, px, keep });
// 蛋形：上下两半各自的纵半径，尖端朝上
const egg = (x, y, rx, ryTop, ryBottom) => ({ kind: 'egg', x, y, rx, ryTop, ryBottom });

/** 把部件缩放后平移（放进卵里当影子用） */
function placePrim(prim, k, ox, oy) {
  const P = (x, y) => [ox + x * k, oy + y * k];
  if (prim.kind === 'circle') return circle(ox + prim.x * k, oy + prim.y * k, prim.r * k);
  if (prim.kind === 'ellipse') return ellipse(ox + prim.x * k, oy + prim.y * k, prim.rx * k, prim.ry * k, prim.deg);
  if (prim.kind === 'capsule') return capsule(ox + prim.x0 * k, oy + prim.y0 * k, ox + prim.x1 * k, oy + prim.y1 * k, prim.r * k);
  if (prim.kind === 'polyline') return polyline(prim.points.map(([x, y]) => P(x, y)), prim.r * k, prim.minPx);
  return prim;
}

function segDist2(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return (px - x0 - t * dx) ** 2 + (py - y0 - t * dy) ** 2;
}

/** scale：每设计单位几像素，给有最小像素粗细的线段用 */
function inside(prim, x, y, scale) {
  if (prim.kind === 'circle') return (x - prim.x) ** 2 + (y - prim.y) ** 2 <= prim.r ** 2;
  if (prim.kind === 'capsule') return segDist2(x, y, prim.x0, prim.y0, prim.x1, prim.y1) <= prim.r ** 2;
  if (prim.kind === 'film') {
    if (inside(prim.shape, x, y, scale) || (prim.keep && !prim.keep(x, y))) return false;
    const d = prim.px / scale;
    const grown = { ...prim.shape, rx: prim.shape.rx + d, ryTop: prim.shape.ryTop + d, ryBottom: prim.shape.ryBottom + d };
    return inside(grown, x, y, scale);
  }
  if (prim.kind === 'lattice') {
    if (!inside(prim.shape, x, y, scale) || (prim.keep && !prim.keep(x, y))) return false;
    const w = Math.max(prim.width, 0.9 / scale) / prim.period;
    const frac = (v) => v - Math.floor(v);
    return frac((x + y) / prim.period) < w || frac((x - y) / prim.period) < w;
  }
  if (prim.kind === 'polygon') {
    let hit = false;
    const pts = prim.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  if (prim.kind === 'egg') {
    const ry = y < prim.y ? prim.ryTop : prim.ryBottom;
    return ((x - prim.x) / prim.rx) ** 2 + ((y - prim.y) / ry) ** 2 <= 1;
  }
  if (prim.kind === 'ellipse') {
    const a = (prim.deg * Math.PI) / 180;
    const dx = x - prim.x;
    const dy = y - prim.y;
    const u = dx * Math.cos(a) + dy * Math.sin(a);
    const v = -dx * Math.sin(a) + dy * Math.cos(a);
    return (u / prim.rx) ** 2 + (v / prim.ry) ** 2 <= 1;
  }
  const r = Math.max(prim.r, prim.minPx / scale);
  for (let i = 1; i < prim.points.length; i += 1) {
    const [x0, y0] = prim.points[i - 1];
    const [x1, y1] = prim.points[i];
    if (segDist2(x, y, x0, y0, x1, y1) <= r * r) return true;
  }
  return false;
}

// ---- 造型：设计单位里全身高为 1 ----

/** 胎儿：在「头朝上」的 800 格设计图上量得的比例，转 180° 成头朝下 */
function fetusModel({ cord }) {
  const box = { x1: 672, y1: 684, w: 492, h: 564 };
  const X = (x) => (box.x1 - x) / box.h;
  const Y = (y) => (box.y1 - y) / box.h;
  const R = (r) => r / box.h;
  const cap = (x0, y0, x1, y1, r) => capsule(X(x0), Y(y0), X(x1), Y(y1), R(r));
  const parts = [];
  if (cord) parts.push(['cord', [polyline([[330, 505], [262, 478], [222, 430], [214, 372], [236, 322]].map(([x, y]) => [X(x), Y(y)]), R(17), 0.55)]]);
  parts.push(['body', [
    ellipse(X(455), Y(545), R(165), R(124), -48),
    cap(392, 428, 300, 398, 40), // 手
    cap(335, 585, 218, 598, 44), // 腿
    cap(230, 612, 205, 640, 30), // 脚
  ]]);
  parts.push(['head', [circle(X(510), Y(280), R(157))]]);
  return {
    w: box.w / box.h,
    h: 1,
    parts,
    head: [X(510), Y(280), R(157)],
    // 侧脸的闭眼在头的前下缘；脸朝外（枕后位）时看得到两只眼与嘴
    eyeSide: [[X(402), Y(318)]],
    eyesFront: [[X(430), Y(300)], [X(492), Y(318)]],
    mouth: [X(446), Y(356)],
  };
}

/** 孕早期胚胎：大头、一截弯尾巴、两个肢芽、一小段脐带 */
function embryoModel({ cord }) {
  const U = (v) => v / 13;
  const parts = [['body', [circle(U(5.4), U(2.2), U(1.4)), circle(U(4.4), U(4.6), U(2.2)), circle(U(4.6), U(6.4), U(2.4))]]];
  if (cord) parts.push(['cord', [polyline([[6.6, 6], [8.6, 5.4], [10.4, 6.2], [11.4, 4.4]].map(([x, y]) => [U(x), U(y)]), U(0.7), 0.5)]]);
  parts.push(['body', [circle(U(7), U(4.2), U(0.95)), circle(U(7.3), U(7.4), U(0.9))]]);
  parts.push(['head', [circle(U(5.6), U(9.2), U(3.6))]]);
  return {
    w: U(12),
    h: 1,
    parts,
    head: [U(5.6), U(9.2), U(3.6)],
    eyeSide: [[U(7.4), U(9.8)]],
    eyesFront: [[U(5.4), U(9.6)], [U(7.2), U(10.2)]],
    mouth: null,
  };
}

/** 卵胎生孕中：一颗卵，里面包着早期胚胎 */
function eggEmbryoModel() {
  const embryo = embryoModel({ cord: false });
  const k = 0.55;
  const ox = 0.4 - (embryo.w * k) / 2;
  const oy = 0.5 - k / 2;
  const move = (prim) => {
    if (prim.kind === 'circle') return circle(ox + prim.x * k, oy + prim.y * k, prim.r * k);
    return prim;
  };
  const pt = ([x, y]) => [ox + x * k, oy + y * k];
  return {
    w: 0.8,
    h: 1,
    parts: [
      ['shell', [ellipse(0.4, 0.5, 0.4, 0.5, 0)]],
      ['shellLight', [ellipse(0.4, 0.5, 0.34, 0.43, 0)]],
      ...embryo.parts.map(([tone, prims]) => [tone, prims.map(move)]),
    ],
    head: [ox + embryo.head[0] * k, oy + embryo.head[1] * k, embryo.head[2] * k],
    eyeSide: embryo.eyeSide.map(pt),
    eyesFront: embryo.eyesFront.map(pt),
    mouth: null,
  };
}

/**
 * 卵：尖端朝上的蛋形，浅色壳、右下一阶暗面、左上一点高光。
 * 卵生与胎转卵生的胚胎是产后（恢复期）才孵的，卵在子宫里看不到胎儿，只看得到卵本身长成：
 * 孕早软壳透出一颗亮黄蛋黄，孕中壳变厚、蛋黄只剩影子，孕晚硬壳长成、不透明、带几点斑纹。
 * 卵胎生是在子宫里孵的，它的孕早卵看得到蛋黄与一点小胚胎
 */
function eggModel(type, stage) {
  const w = 0.76;
  const parts = [['eggShell', [egg(0.38, 0.54, 0.38, 0.54, 0.46)]]];
  if (type === '卵胎生') {
    const embryo = embryoModel({ cord: false });
    const k = 0.3;
    parts.push(['yolk', [circle(0.38, 0.62, 0.15)]]);
    parts.push(...embryo.parts.map(([, prims]) => ['ghost', prims.map((prim) => placePrim(prim, k, 0.38 - (embryo.w * k) / 2, 0.5 - k / 2))]));
  } else if (stage === 0) {
    parts.push(['yolk', [circle(0.38, 0.58, 0.19)]]);
  } else if (stage === 1) {
    parts.push(['ghost', [circle(0.38, 0.6, 0.17)]]);
  } else {
    parts.push(['speck', [circle(0.56, 0.36, 0.035), circle(0.26, 0.62, 0.03), circle(0.5, 0.74, 0.04), circle(0.62, 0.58, 0.028), circle(0.34, 0.86, 0.03)]]);
  }
  parts.push(['shine', [circle(0.2, 0.3, 0.05), circle(0.24, 0.24, 0.035)]]);
  return { w, h: 1, parts, head: null, eyeSide: [], eyesFront: [], mouth: null };
}

/** 羊膜耐久分四级，与羊水囊的膜线同一套：完整、变薄、撕开、已破 */
export function membraneLevel(durability) {
  const d = Number.isFinite(Number(durability)) ? Number(durability) : 100;
  if (d <= 0) return 'none';
  if (d < 30) return 'torn';
  if (d < 60) return 'thin';
  return 'full';
}

// 固定的伪随机：同一格每次结果相同，缺口才不会闪
const hash01 = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * 胎转卵生孕晚：和卵生一样的蛋形，壳上一层菱形的结晶格（永远都在）；
 * 硬化的羊膜是另外一层，紧贴在蛋上——整颗蒙一层偏冷的膜色、外缘贴一圈膜线。
 * 膜表示羊膜耐久：完整时整颗蒙着、变薄时一块一块缺、撕开时靠宫口那端（下方）露出殼、破了就只剩带结晶格的蛋壳。
 * 外面不再有羊水囊。胚胎产后才孵，看不到里面
 */
function latticeEggModel(level = 'full') {
  const shape = egg(0.38, 0.54, 0.38, 0.54, 0.46);
  const period = 0.2;
  const parts = [['eggShell', [shape]]];
  if (level !== 'none') {
    const covered = (x, y) => {
      if (level === 'torn' && y > 0.62) return false;
      if (level === 'full') return true;
      const patch = hash01(Math.floor((x + y) / (period * 1.5)), Math.floor((x - y) / (period * 1.5)));
      return patch > (level === 'thin' ? 0.35 : 0.5);
    };
    const rim = (x, y) => {
      if (level === 'torn' && y > 0.62) return false;
      if (level === 'full') return true;
      const deg = Math.floor(((Math.atan2(y - 0.54, x - 0.38) * 180) / Math.PI + 360) / 14);
      return hash01(deg, 7) > (level === 'thin' ? 0.3 : 0.45);
    };
    parts.push(['eggFilm', [lattice(shape, 1e9, 1e9, covered)]]);
    parts.push([level === 'full' ? 'membrane' : 'membraneThin', [film(shape, 1, rim)]]);
  }
  parts.push(['lattice', [lattice(shape, period, 0.03)]]);
  parts.push(['shine', [circle(0.2, 0.3, 0.05), circle(0.24, 0.24, 0.035)]]);
  return { w: 0.76, h: 1, parts, head: null, eyeSide: [], eyesFront: [], mouth: null };
}

/**
 * 不定型当史莱姆：圆顶平底的一团，左上一道光泽、中间一块半透明的亮核、两只眼。
 * 孕早一滴小史莱姆，孕中旁边分出一小滴，孕晚更大、底下垂两条黏液、旁边留一小滴
 */
function amorphousModel(stage) {
  const blob = [egg(0.46, 0.66, 0.4, 0.56, 0.3)];
  // 孕晚长出一对兔子短耳
  if (stage === 2) blob.push(capsule(0.34, 0.2, 0.26, 0.02, 0.07), capsule(0.58, 0.2, 0.66, 0.02, 0.07));
  if (stage >= 1) blob.push(egg(0.9, 0.84, 0.1, 0.13, 0.08));
  if (stage === 2) blob.push(capsule(0.3, 0.9, 0.28, 1, 0.055), circle(0.28, 1, 0.07), capsule(0.58, 0.92, 0.6, 0.98, 0.045), circle(0.6, 0.99, 0.055));
  return {
    w: 1,
    h: 1,
    parts: [
      ['blob', blob],
      ['core', [ellipse(0.5, 0.62, 0.2, 0.16, 0)]],
      ['shine', [capsule(0.2, 0.46, 0.26, 0.3, 0.035), circle(0.32, 0.22, 0.03)]],
    ],
    head: [0.46, 0.6, 0.3],
    eyeSide: [[0.38, 0.6], [0.54, 0.6]],
    eyesFront: [[0.38, 0.6], [0.54, 0.6]],
    mouth: null,
  };
}

function getModel(type, stage, membrane) {
  if (type === '不定型') return { model: amorphousModel(stage), deco: null };
  if (type === '胎转卵生' && stage === 2) return { model: latticeEggModel(membraneLevel(membrane)), deco: null };
  if (!isFetalForm(type, stage)) return { model: eggModel(type, stage), deco: null };
  if (type === '卵胎生' && stage === 1) return { model: eggEmbryoModel(), deco: null };
  // 卵胎生在卵里长大，没有脐带
  const cord = type !== '卵胎生';
  const model = stage === 0 ? embryoModel({ cord }) : fetusModel({ cord });
  // 胎转卵生孕早：外面零散几段网格壳；孕中：围成完整一圈（孕晚包成网格纹的卵）。卵胎生孕晚：破壳后留几片碎壳
  let deco = null;
  if (type === '胎转卵生') deco = stage === 0 ? 'shellPieces' : 'shellRing';
  else if (type === '卵胎生') deco = 'shards';
  return { model, deco };
}

const SHELL_PIECES = [[10, 40], [110, 140], [200, 225], [290, 318]];

/**
 * 产生像素格。height 是胎儿本体要画的像素高度；angle 为胎位角（0 头位、180 臀位，顺时针）；
 * mirror 为胎背朝右；posterior 为胎背朝后（脸朝外）；squeeze 为挤压时的横向压缩。
 * 回传 { width, height, anchorX, anchorY, cells }：cells[y][x] 是色调代号或 null，
 * 胎儿中心落在 (anchorX, anchorY)
 */
export function buildFetusGrid({ type = '胎生', stage = 2, height = 20, angle = 0, mirror = false, posterior = false, squeeze = 1, membrane = 100 } = {}) {
  // 认不得的胚型当胎生画
  const { model, deco } = getModel(KNOWN_TYPES.has(type) ? type : '胎生', stage, membrane);
  const scale = Math.max(4, height);
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = model.w / 2;
  const cy = model.h / 2;
  const sx = scale * squeeze;
  const fwd = (x, y) => {
    let dx = (x - cx) * sx;
    const dy = (y - cy) * scale;
    if (mirror) dx = -dx;
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  };
  const inv = (ox, oy) => {
    let dx = ox * cos + oy * sin;
    const dy = -ox * sin + oy * cos;
    if (mirror) dx = -dx;
    return [dx / sx + cx, dy / scale + cy];
  };

  // 输出范围：设计框四角转过去之后的外接框，再留一圈给壳与碎片
  const margin = deco ? 3 : 1;
  const corners = [[0, 0], [model.w, 0], [0, model.h], [model.w, model.h]].map(([x, y]) => fwd(x, y));
  const minX = Math.floor(Math.min(...corners.map((c) => c[0]))) - margin;
  const maxX = Math.ceil(Math.max(...corners.map((c) => c[0]))) + margin;
  const minY = Math.floor(Math.min(...corners.map((c) => c[1]))) - margin;
  const maxY = Math.ceil(Math.max(...corners.map((c) => c[1]))) + margin;
  const width = maxX - minX;
  const rows = maxY - minY;
  const cells = Array.from({ length: rows }, () => Array(width).fill(null));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [px, py] = inv(x + 0.5 + minX, y + 0.5 + minY);
      for (const [tone, prims] of model.parts) {
        if (prims.some((prim) => inside(prim, px, py, scale))) cells[y][x] = tone;
      }
    }
  }

  // 身体、卵壳、不定型的外缘只在右下贴外面的地方压一阶暗面（光固定从左上来，不随胎位转），其余平涂
  const SHADE_OF = { body: 'shade', eggShell: 'shellShade', eggFilm: 'filmShade', blob: 'blobShade' };
  const at = (x, y) => (y >= 0 && y < rows && x >= 0 && x < width ? cells[y][x] : null);
  const shaded = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = SHADE_OF[cells[y][x]];
      if (!shade) continue;
      if (!at(x + 1, y + 1) || (!at(x + 1, y) && !at(x, y + 1))) shaded.push([x, y, shade]);
    }
  }
  for (const [x, y, shade] of shaded) cells[y][x] = shade;

  const plot = (x, y, tone) => {
    const gx = Math.round(x) - minX;
    const gy = Math.round(y) - minY;
    if (gy >= 0 && gy < rows && gx >= 0 && gx < width) cells[gy][gx] = tone;
  };
  const plotFloor = (x, y, tone) => plot(Math.floor(x), Math.floor(y), tone);

  // 眼睛一律画，才看得出脸朝哪：胎背朝前是侧脸一只闭眼，朝后脸朝外、两只眼加嘴
  const headPx = model.head ? model.head[2] * scale : 0;
  const eyeLen = headPx >= 5 ? 2 : 1;
  for (const [ex, ey] of (posterior ? model.eyesFront : model.eyeSide) || []) {
    for (let i = 0; i < eyeLen; i += 1) {
      const [ox, oy] = fwd(ex + i / scale, ey);
      plotFloor(ox, oy, 'face');
    }
  }
  if (posterior && model.mouth && headPx >= 4) {
    const [ox, oy] = fwd(model.mouth[0], model.mouth[1]);
    plotFloor(ox, oy, 'face');
  }

  if (deco === 'shellRing' || deco === 'shellPieces') {
    const rx = model.w / 2 + 2 / scale;
    const ry = model.h / 2 + 2 / scale;
    const ranges = deco === 'shellRing' ? [[0, 359]] : SHELL_PIECES;
    for (const [from, to] of ranges) {
      for (let deg = from; deg <= to; deg += 2) {
        const r = (deg * Math.PI) / 180;
        const [ox, oy] = fwd(cx + Math.cos(r) * rx, cy + Math.sin(r) * ry);
        plotFloor(ox, oy, deg % 16 === 0 ? 'eggShell' : 'membrane');
      }
    }
  } else if (deco === 'shards') {
    for (const [x, y, tone] of [[0.04, 0.92, 'shell'], [0.09, 0.95, 'shellLight'], [0.86, 0.06, 'shell'], [0.9, 0.1, 'shellLight'], [0.02, 0.34, 'shell']]) {
      const [ox, oy] = fwd(x * model.w, y);
      plotFloor(ox, oy, tone);
    }
  }

  return { width, height: rows, anchorX: -minX, anchorY: -minY, cells };
}
