// 由 previews/export-vulva-render.mjs 從 previews/vulva-preview.html 產生，不要手改；改預覽頁後重跑匯出。
// 外陰正面像素圖（1.6.0）：預覽頁的繪圖碼原樣搬過來，控件換成 setState 的參數，畫布由呼叫端給（96×120）。
/* eslint-disable */

/** 參數的預設值（照預覽頁控件的預設） */
export const VULVA_DEFAULTS = Object.freeze({
  "layout": "human",
  "visual-maturity": "50",
  "visual-maturity-value": "",
  "visual-traces": "50",
  "visual-traces-value": "",
  "human-sire": "off",
  "single-sire": "off",
  "single-role": "idle",
  "sire-form": "off",
  "swordScrotum": "auto",
  "swordTip": "rimmed",
  "swordShaft": "smooth",
  "swordKnot": "off",
  "swordBarbs": "off",
  "swordTwin": "off",
  "swordLock": "off",
  "lock-phase": "idle",
  "channel": "vaginal",
  "sword-pulse": "",
  "anus-shape": "auto",
  "anus-color": "#c85f78",
  "race-preset": "",
  "chimera-outlet": "default",
  "pouchBrood": "1",
  "canvas-background": "dark",
  "edge-decoration": "none",
  "uterus-overlay": "off",
  "uterus-overlay-color": "#9ad0e0",
  "canal-material": "folds",
  "material-light": "#f3a891",
  "translucent": "off",
  "anal-sword-size": "2",
  "anal-residue": "off",
  "play-anal-fit": "",
  "hymen": "none",
  "play-deflower": "",
  "tube-diameter": "standard",
  "tube-texture": "rings",
  "tube-tip": "rounded",
  "outlet-body": "oval",
  "cloacal-rim": "default",
  "outlet-shape": "round",
  "outlet-decoration": "veins",
  "shape": "band",
  "outer-shape": "oval",
  "clitoral-length": "standard",
  "skin": "#c85f78",
  "tone": "#ee9290",
  "libido": "0",
  "libido-value": "",
  "sire-reserve": "100",
  "sire-reserve-value": "",
  "sperm-quality": "0",
  "sperm-quality-value": "",
  "pregnancy": "0",
  "flow": "none",
  "urine": "0",
  "stool": "0",
  "fit": "0",
  "descent": "0",
  "weight": "1",
  "weight-value": "",
  "effort": "push",
  "fatigue": "0",
  "fatigue-value": "",
  "parity": "0",
  "recovery": "100",
  "recovery-value": "",
  "play-recovery": "",
  "replay": "",
  "combine": "",
  "readout": "",
  "presenting-position": "head",
  "presenting-style": "silhouette",
  "presenting-angle": "left",
  "prolapse": "0",
  "section-preset": "off",
  "section-variant": "human-duplex",
  "chamber-fill": "left",
  "vaginal-septum": "off",
  "ovary-shape": "auto",
  "ovary-color": "#c85f78",
  "uterus-color": "#c85f78",
  "labor-condition": "normal",
  "sword-offset": "0"
});
const DEFAULTS = VULVA_DEFAULTS;
const FIELD_IDS = ["layout","visual-maturity","visual-maturity-value","visual-traces","visual-traces-value","human-sire","single-sire","single-role","sire-form","swordScrotum","swordTip","swordShaft","swordKnot","swordBarbs","swordTwin","swordLock","lock-phase","channel","sword-pulse","anus-shape","anus-color","race-preset","chimera-outlet","pouchBrood","canvas-background","edge-decoration","uterus-overlay","uterus-overlay-color","canal-material","material-light","translucent","anal-sword-size","anal-residue","play-anal-fit","hymen","play-deflower","tube-diameter","tube-texture","tube-tip","outlet-body","cloacal-rim","outlet-shape","outlet-decoration","shape","outer-shape","clitoral-length","skin","tone","libido","libido-value","sire-reserve","sire-reserve-value","sperm-quality","sperm-quality-value","pregnancy","flow","urine","stool","fit","descent","weight","weight-value","effort","fatigue","fatigue-value","parity","recovery","recovery-value","play-recovery","replay","combine","readout","presenting-position","presenting-style","presenting-angle","prolapse","section-preset","section-variant","chamber-fill","vaginal-septum"];

/**
 * 建一個外陰正面的繪圖器。canvas 是 96×120 的畫布；options.reducedMotion 為 true 時動畫停在代表格。
 * 回傳 { setState(params), play(kind), paint(now), start(), stop(), setReducedMotion(bool), getState() }。
 */
export function createVulvaRenderer(canvas, options = {}) {

  // ── 墊片：預覽頁的 DOM 控件換成純值，畫布由呼叫端給 ──
  const stub = () => {
    const node = { value: '', hidden: false, disabled: false, textContent: '', checked: false,
      options: [], selectedOptions: [{ textContent: '' }], style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}, add() {}, append() {} };
    node.closest = () => node;
    return node;
  };
  const control = (value) => Object.assign(stub(), { value: String(value) });
  const frontContext = canvas.getContext('2d');
  const frontBuffer = Object.assign(document.createElement('canvas'), { width: canvas.width, height: 145 });
  const ctx = frontBuffer.getContext('2d');
  const distanceMark = stub();
  const compactFrontHeight = 100;
  const compactFrontClip = compactFrontHeight - 3;
  const analDistanceStart = .58;
  const uterusBodyOffsets = [0, 9, 18, 23];
  const clitoralHoodMarker = stub();
  const clitoralGlansMarker = stub();
  const basePalette = {
    background: '#1c1726', frame: '#47283d', cavityDeep: '#421d3d',
    cavity: '#672d51', wallDark: '#803b58', wall: '#c85f78',
    wallLight: '#ee9290', lining: '#f3a891', shine: '#ffd0a4',
  };
  const fields = Object.fromEntries(Object.entries(DEFAULTS).filter(([id]) => FIELD_IDS.includes(id)).map(([id, value]) => [id, control(value)]));
  const pouchPrototype = false;
  const ovaryControls = stub();
  const ovaryShape = control(DEFAULTS['ovary-shape']);
  const ovaryColor = control(DEFAULTS['ovary-color']);
  const uterusColor = control(DEFAULTS['uterus-color']);
  const laborCondition = control(DEFAULTS['labor-condition'] || 'normal');
  const playRapidLabor = stub();
  const laborPreviewStatus = stub();
  const ovaryColors = new Map();
  const analFitControls = stub();
  const swordOffset = control(DEFAULTS['sword-offset'] || 0);
  const swordOffsetLabel = stub();
  const swordOffsetValue = stub();
  const swordPreviewNote = stub();
  const reducedMotion = { matches: Boolean(options.reducedMotion), addEventListener() {} };
  const comparisonFigure = stub();
  const sectionView = stub();
  // 剖面另由 uterus_render.js 畫；這裡給離屏畫布，讓共用的程式照常跑
  const sectionContext = Object.assign(document.createElement('canvas'), { width: 96, height: 120 }).getContext('2d');
  const frontTitle = stub();
  const sectionTitle = stub();
  const sectionGuide = stub();
  const sectionFiction = stub();
  const blankImage = () => ({ complete: false, naturalWidth: 0, width: 0, height: 0, addEventListener() {} });
  const uterusAtlas = blankImage();
  const tintedUterusAtlas = document.createElement('canvas');
  let lastUterusColor;
  const fetalAtlas = blankImage();
  const humanFetalSheet = blankImage();

  function mix(from, to, fraction) {
    const channels = [1, 3, 5].map(index => {
      const a = parseInt(from.slice(index, index + 2), 16);
      const b = parseInt(to.slice(index, index + 2), 16);
      return Math.round(a + (b - a) * fraction).toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`;
  }

  function surfaceAccent(base, color, isHighlight = false) {
    const maturity = Number(fields['visual-maturity'].value) / 50 - 1;
    return maturity < 0 ? mix(color, base, -.48 * maturity)
      : mix(color, isHighlight ? basePalette.shine : basePalette.cavityDeep, .30 * maturity);
  }

  function traceAccent(base, fold) {
    const traces = Number(fields['visual-traces'].value) / 50 - 1;
    return traces < 0 ? mix(fold, base, -.66 * traces) : mix(fold, basePalette.cavityDeep, .35 * traces);
  }

  function polygon(color, points, context = ctx) {
    const path = new Path2D();
    path.moveTo(...points[0]);
    for (const point of points.slice(1)) path.lineTo(...point);
    path.closePath();

    // Sample at pixel centers so the edge uses only the selected palette color.
    const left = Math.floor(Math.min(...points.map(([x]) => x)));
    const right = Math.ceil(Math.max(...points.map(([x]) => x)));
    const top = Math.floor(Math.min(...points.map(([, y]) => y)));
    const bottom = Math.ceil(Math.max(...points.map(([, y]) => y)));
    context.fillStyle = color;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        if (context.isPointInPath(path, x + .5, y + .5)) context.fillRect(x, y, 1, 1);
      }
    }
    return path;
  }

  // Each tile stores relative shades. Zero leaves the existing artwork visible.
  const tissueTiles = {
    folds: ['000000','000000','122210','000000','011000','000000'],
    rings: ['000000','111111','222222','000000','000000','000000'],
    smooth: ['002000','002000','002000','002000','002000','002000'],
    grooves: ['201000','201000','201000','201000','201000','201000'],
    veins: ['003000','003000','223220','103010','003000','003000'],
    facets: ['011130','112200','122000','210001','200011','000111'],
    ink: ['110100','101000','010100','000010','000000','100010'],
    pixel: ['222222','010010','000000','220220','000030','001001'],
    metal: ['111111','120120','100100','111111','130120','100100'],
    scales: ['011011','100100','022022','101101','010010','020020'],
    leaves: ['002000','103010','023200','013100','203020','003000'],
    gills: ['101010','121210','012100','012100','101010','200002'],
    wax: ['222100','021000','021001','031002','010002','000001'],
    seams: ['100010','102010','102010','111111','222222','100010'],
    shadow: ['110000','101000','010010','011100','001100','000010'],
    mottle: ['000110','000110','000100','000000','110000','100000'],
    feathers: ['002000','032200','022210','012100','001000','010000'],
  };

  let materialPhase = 0;
  let materialHeat = 0;
  const movingMaterials = new Set(['shadow', 'pixel']);
  const animatedOvaries = new Set(['flame', 'shadow']);
  function previewBackground() {
    return fields['canvas-background'].value === 'light' ? '#e6dce4' : basePalette.background;
  }

  function uterusShade(color) {
    return fields['uterus-overlay'].value === 'on' ? mix(color, fields['uterus-overlay-color'].value, .30) : color;
  }

  function tileShade(tile, x, y, shift) {
    const row = y + shift;
    return Number(tile[row % 6][(x + Math.floor(row / 6) % 2 * 2) % 6]);
  }

  function materialShades(color, light, strength, heat) {
    return [null, mix(color, '#302036', .40 * strength), mix(color, light, .46 * strength),
      mix(color, light, (.52 + .35 * heat) * strength)];
  }

  function texturePixels(context, points, material, color, strength = 1, translucent = false) {
    const tile = tissueTiles[material];
    if (!tile) return;
    const light = fields['material-light'].value;
    const shift = movingMaterials.has(material) ? materialPhase % 6 : 0;
    const colors = materialShades(color, light, strength, materialHeat);
    const minX = Math.max(0, Math.floor(Math.min(...points.map(point => point[0]))));
    const maxX = Math.min(context.canvas.width, Math.ceil(Math.max(...points.map(point => point[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
    const maxY = Math.min(context.canvas.height, Math.ceil(Math.max(...points.map(point => point[1]))));
    const path = new Path2D();
    path.moveTo(...points[0]);
    for (const point of points.slice(1)) path.lineTo(...point);
    path.closePath();
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const shade = tileShade(tile, x, y, shift);
        const dither = translucent && !shade && (x + y * 2) % 7 === 0;
        if ((!shade && !dither) || !context.isPointInPath(path, x + .5, y + .5)) continue;
        context.fillStyle = dither ? mix(color, previewBackground(), .53) : colors[shade];
        context.fillRect(x, y, 1, 1);
      }
    }
  }

  function paintMaterial(context, color, points, material, strength, transparent) {
    polygon(color, points, context);
    texturePixels(context, points, material, color, strength, transparent);
  }

  function canalTexture(context, color, points, strength = 1) {
    texturePixels(context, points, fields['canal-material'].value, color, strength, fields.translucent.value === 'on');
  }

  function selectedAnusShape(isBirthOutlet) {
    const shape = fields['anus-shape'].value;
    return shape === 'auto' ? (isBirthOutlet ? 'large' : 'small') : shape;
  }

  function drawSmallAnus({ centerX, centerY, width, depth }, color, bulge, context) {
    const outer = mix(color, basePalette.background, .73);
    const crease = traceAccent(outer, surfaceAccent(outer, mix(color, basePalette.background, .47 - .11 * bulge), true));
    const project = ([x, y]) => [centerX + x * width / 4, centerY + y * depth / 3];
    const shape = (fill, points) => polygon(fill, points.map(project), context);
    shape(outer, [[-2, -4], [2, -4], [5, -1], [5, 2], [2, 4], [-2, 4], [-5, 2], [-5, -1]]);
    for (const [x, y] of [[-3, -2], [2, -2], [-3, 2], [2, 2]]) {
      shape(crease, [[x, y], [x + 2, y], [x + 2, y + 1], [x, y + 1]]);
    }
    shape(basePalette.cavityDeep, [[-1, -1], [1, -1], [1, 0], [2, 0], [2, 1], [1, 1],
      [1, 2], [-1, 2], [-1, 1], [-2, 1], [-2, 0], [-1, 0]]);
  }

  function drawLogoAnusFolds(shape, opening, hubWidth, hubDepth, thickness, shadow, light, context) {
    const { centerX, centerY, width, depth } = opening;
    const outerX = Math.max(width + 4.6, hubWidth + 6 * thickness + 2);
    const outerY = Math.max(depth + 3.6, hubDepth + 5 * thickness + 2);
    if (shape === 'gemini') {
      const spark = [[0,-1],[.12,-.65],[.27,-.38],[.43,-.22],[.68,-.10],[1,0],
        [.68,.10],[.43,.22],[.27,.38],[.12,.65],[0,1],[-.12,.65],[-.27,.38],[-.43,.22],
        [-.68,.10],[-1,0],[-.68,-.10],[-.43,-.22],[-.27,-.38],[-.12,-.65]];
      const outline = (color, xRadius, yRadius) => polygon(color, spark.map(([x, y]) =>
        [centerX + x * xRadius, centerY + y * yRadius]), context);
      outline(shadow, outerX, outerY);
      outline(light, outerX * .83, outerY * .79);
      return;
    }

    const innerX = hubWidth + .6;
    const innerY = hubDepth + .4;
    const loop = (color, index, points) => {
      const angle = index * Math.PI / 3 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      polygon(color, points.map(([along, across]) => [
        centerX + cos * (innerX + along * (outerX - innerX)) - sin * across * outerX,
        centerY + sin * (innerY + along * (outerY - innerY)) + cos * across * outerY,
      ]), context);
    };
    // Draw all six bands before adding the short sections that pass over their neighbors.
    const ribbon = [[.02,-.25],[.53,-.39],[.84,-.28],[1,-.03],[.98,.23],[.79,.50],
      [.42,.65],[.15,.58],[.17,.34],[.49,.37],[.71,.24],[.77,.05],[.65,-.12],[.47,-.14],[.02,.01]];
    const crossing = [[.51,-.37],[.82,-.27],[.90,-.14],[.72,-.05],[.61,-.13],[.40,-.13]];
    const lobe = ribbon.slice(0, 8);
    const recess = mix(shadow, basePalette.cavityDeep, .46);
    for (let index = 0; index < 6; index++) loop(recess, index, lobe);
    for (let index = 0; index < 6; index++) loop(shadow, index, ribbon);
    for (let index = 0; index < 6; index++) loop(light, index, crossing);
  }

  function usesSmallAnusHub(shape) {
    return shape === 'claude' || shape === 'gpt' || shape === 'gemini';
  }

  function drawAnusOpening(shape, opening, color, bulge, tension, thickness, delivering, context) {
    if (shape === 'small' && !delivering) {
      drawSmallAnus(opening, color, bulge, context);
      return;
    }
    const { centerX, centerY, width, depth } = opening;
    const radial = shape === 'claude';
    const shadow = surfaceAccent(color, mix(color, basePalette.cavityDeep, .56));
    const light = surfaceAccent(color, mix(color, basePalette.shine, .32 + .11 * bulge + .26 * tension), true);
    const styled = usesSmallAnusHub(shape);
    const logo = styled && !radial;
    const base = traceAccent(color, styled ? mix(shadow, color, .28) : shadow);
    const rimLight = styled ? mix(light, '#9c5f5d', .67) : light;
    const smallHub = styled && !delivering;
    const hubWidth = smallHub ? Math.max(1, width * .23) : width;
    const hubDepth = smallHub ? Math.max(.8, depth * .31) : depth;
    const rimThickness = smallHub ? .22 : shape === 'small' ? thickness * .63 : thickness;
    if (logo) {
      drawLogoAnusFolds(shape, opening, hubWidth, hubDepth, rimThickness, mix(shadow, color, .37),
        mix(shadow, rimLight, .72), context);
    }
    drawBirthRim({ ...opening, width: hubWidth, depth: hubDepth }, base, rimLight, centerY - 18, rimThickness, context, context === ctx);
    if (logo) return;
    const folds = radial ? [1, .57, .84, 1, .66, .91, .60, .92, .73, .99, .70] : [1, 1, 1, 1, 1, 1];
    if (!delivering || radial) {
      for (const [index, reach] of folds.entries()) {
        const angle = index * 2 * Math.PI / folds.length + (radial ? .21 : 0);
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        const extension = reach * (radial ? 2.05 : 1);
        const edge = radial ? mix(shadow, rimLight, .62) : shadow;
        const foldWidth = radial ? .96 : .56;
        const rootX = hubWidth + (smallHub ? .45 : 1.1);
        const rootY = hubDepth + (smallHub ? .20 : .4);
        const reachX = width + 1.1 + 3.5 * extension;
        const reachY = depth + .4 + 2.6 * extension;
        const tipWidth = radial ? .37 : 0;
        const points = [[rootX, rootY, -foldWidth], [reachX, reachY, -tipWidth],
          [reachX, reachY, tipWidth], [rootX, rootY, foldWidth]];
        polygon(edge, points.map(([rx, ry, across]) => [
          centerX + x * rx - y * across,
          centerY + y * ry + x * across,
        ]), context);
      }
    }
  }

  function drawAnalResidue(opening, shape, elapsed) {
    if (elapsed === null || elapsed < 0) return;
    const { color, highlight } = flowEffects.withdrawal;
    const { centerX, centerY, width, depth } = opening;
    const smallHub = usesSmallAnusHub(shape);
    const reach = Math.max(2, Math.min(5, Math.round(width * (smallHub ? .34 : .54))));
    const row = Math.min(115, Math.round(centerY + depth * (smallHub ? .30 : .68) + 1));
    const arrival = Math.min(1, elapsed / 240);
    const fade = Math.max(0, elapsed - (ANAL_FIT_END_MS - ANAL_HOLD_END_MS) - 450) / (ANAL_RESIDUE_MS - 450);
    frontContext.save();
    frontContext.globalAlpha = .84 * arrival * (1 - Math.min(1, fade)) ** 2;
    frontContext.fillStyle = color;
    frontContext.fillRect(centerX - reach, row, reach * 2, 1);
    frontContext.fillRect(centerX - reach + 1, row + 1, reach, 1);
    frontContext.fillStyle = highlight;
    frontContext.fillRect(centerX - reach + 1, row, 2, 1);
    frontContext.fillRect(centerX + reach - 1, row, 1, 1);
    const drip = Math.min(2, Math.floor(elapsed / 430));
    if (drip > 0) {
      frontContext.fillStyle = color;
      frontContext.fillRect(centerX + 1, row + 1, 1, drip + 1);
      frontContext.fillStyle = highlight;
      frontContext.fillRect(centerX + 1, row + drip + 1, 1, 1);
    }
    frontContext.restore();
  }

  function drawSeparateAnus(expansion, stool, residueElapsed) {
    const growth = expansion ?? (stool.bulge * .55 - stool.tighten * .29);
    const shape = selectedAnusShape(false);
    const size = shape === 'small' ? 4 : shape === 'large' ? 7.5 : 5.6;
    const centerY = { claude: 111, gpt: 110, gemini: 110 }[shape] ?? 112;
    const depth = 3 * (1 + .25 * growth);
    const opening = { centerX: 48, centerY, width: size * (1 + growth), depth };
    const color = fields['anus-color'].value;
    drawAnusOpening(shape, opening, color, stool.bulge, 0, .57, false, frontContext);
    drawAnalResidue(opening, shape, residueElapsed);
    drawStoolGas(frontContext, stool.gas, opening.centerX + opening.width * .25, 113);
  }

  function drawFrontView(separateAnus, analExpansion, stool, analResidueElapsed) {
    frontContext.fillStyle = previewBackground();
    frontContext.fillRect(0, 0, canvas.width, canvas.height);
    frontContext.fillStyle = basePalette.frame;
    const lowerGuideY = separateAnus ? 94 : 103;
    for (const [x, y] of [[8, 9], [81, 9], [8, lowerGuideY], [81, lowerGuideY]]) {
      frontContext.fillRect(x, y, 7, 1);
      frontContext.fillRect(x === 8 ? x : x + 6, y < 60 ? y : y - 6, 1, 7);
    }
    frontContext.imageSmoothingEnabled = false;
    if (separateAnus) {
      const width = Math.round(canvas.width * compactFrontHeight / canvas.height);
      const sourceHeight = compactFrontClip * canvas.height / compactFrontHeight;
      frontContext.drawImage(frontBuffer, 0, 0, canvas.width, sourceHeight,
        Math.round((canvas.width - width) / 2), 0, width, compactFrontClip);
      drawSeparateAnus(analExpansion, stool, analResidueElapsed);
    } else {
      frontContext.drawImage(frontBuffer, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    }
  }

  // 陰囊大小跟檔案精子品質走（0.25–4，對數刻度）：0.25 → 0.7 倍、1 → 1 倍、4 → 1.5 倍；飽滿度另跟存量走
  function scrotumScale() {
    const level = Number(fields['sperm-quality'].value);
    return 1 + level * (level < 0 ? .15 : .25);
  }

  function drawRootPouch(anchorY, palette, widthScale, bottom, tubeBase = false) {
    const depletion = 1 - Number(fields['sire-reserve'].value) / 100;
    const size = scrotumScale();
    widthScale *= size;
    const height = Math.max(8, Math.min(tubeBase ? 42 : 31, bottom - anchorY - 3) * size);
    const pouch = (color, points, side = 1) => polygon(color, points.map(([x, y]) => {
      const fullness = 1 - .23 * depletion * y;
      const taper = tubeBase ? .94 + .26 * (.5 - y) : 1;
      return [48 + x * side * widthScale * fullness * taper, anchorY + y * height * (1 - .23 * depletion * y)];
    }));
    const contour = tubeBase
      ? [[-8, .24], [8, .24], [16, .08], [19, .10], [20, .37], [21, .65], [20, .86], [15, 1],
        [7, .98], [0, .84], [-7, .98], [-15, 1], [-20, .86], [-21, .65], [-20, .37], [-19, .10], [-16, .08]]
      : [[-8, .08], [8, .08], [17, .24], [21, .49], [20, .76], [16, .95], [10, 1],
        [5, .95], [0, .82], [-5, .95], [-10, 1], [-16, .95], [-20, .76], [-21, .49], [-17, .24]];
    pouch(tubeBase ? mix(palette.wallDark, palette.cavityDeep, .42) : palette.cavityDeep, contour);
    const midtone = mix(palette.wallDark, palette.wall, .37);
    const highlight = mix(midtone, palette.wallLight, .40);
    for (const side of [-1, 1]) {
      pouch(midtone, [[3, .17], [9, .14], [15, .3], [18, .5], [17, .72], [14, .87],
        [9, .93], [5, .86], [2, .73], [1, .55]], side);
      pouch(highlight, [[7, .26], [12, .29], [15, .45], [15, .6], [13, .71],
        [9, .77], [6, .67], [5, .48]], side);
    }
    pouch(mix(palette.wallDark, palette.cavityDeep, .48), [[0, .39], [1.3, .62], [1.6, .78],
      [0, .86], [-1.6, .78], [-1.3, .62]]);
  }

  let swordPulseStart = null;
  let lockVisualStart = 0;
  let twinSceneStart = null;
  let pouchBurstStart = null;
  const LOCK_RELEASE_MS = 1000;

  function swordLook(now) {
    const age = swordPulseStart === null ? Infinity : now - swordPulseStart;
    const pulse = age < 0 || age >= 650 ? 0 : Math.sin(Math.PI * age / 650);
    const phase = fields.swordLock.value === 'on' ? fields['lock-phase'].value : 'idle';
    const release = phase === 'unlock' || phase === 'pull'
      ? Math.max(0, Math.min(1, (now - lockVisualStart) / LOCK_RELEASE_MS)) : null;
    return { pulse, phase, release, locked: phase === 'locked', active: age < 650 || (release !== null && release < 1),
      twin: fields.swordTwin.value === 'on', knot: fields.swordKnot.value === 'on', barbs: fields.swordBarbs.value === 'on' };
  }

  function scrotumVisible(layout, tubeMode) {
    const chosen = fields.swordScrotum.value;
    return chosen === 'auto' ? layout === 'futa' || layout === 'anal' || tubeMode === 'urethral' : chosen === 'visible';
  }

  const solidShaftMaterials = new Set(['facets', 'wax', 'seams', 'metal', 'pixel', 'ink', 'shadow', 'gills', 'leaves']);

  function drawExternalShaft(anchorY, libidoHeat, palette, pouchWidth, openingTop, sword, urine) {
    if (pouchWidth > 0) drawRootPouch(anchorY, palette, pouchWidth, openingTop);
    const { look = swordLook(Infinity), clipBottom = frontBuffer.height } = sword;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, frontBuffer.width, clipBottom);
    ctx.clip();
    const girth = (sword.girthScale ?? 1) * (1 + sword.offset * .15 + libidoHeat * .35);
    const paired = look.twin;
    const shaft = fields.swordShaft.value;
    const race = racePresets[fields['race-preset'].value];
    const material = race?.overlay && solidShaftMaterials.has(race['canal-material'])
      ? fields['canal-material'].value : null;
    let side = 0;
    const length = sword.length - libidoHeat * Math.min(10, sword.length * .25);
    const reach = length / 28;
    const fadeAt = Math.floor(openingTop) - 4;
    const tip = fields['swordTip'].value;
    const tipWidth = (y) => {
      const along = Math.max(0, (y - 16) / 12);
      if (shaft === 'tentacle') return 1 - .34 * Math.max(0, y / 28) - .28 * along;
      if (tip === 'tapered') return 1 - .55 * along;
      if (tip === 'rounded') return 1 - .24 * Math.sin(Math.PI * along / 2);
      if (tip === 'flared') return 1 + along * (.98 * look.pulse - .16);
      return 1;
    };
    const color = palette.wall;
    const rootGradient = (root, shaft) => {
      const gradient = ctx.createLinearGradient(0, anchorY - 5 * Math.min(1.35, reach), 0, anchorY + length * .32);
      gradient.addColorStop(0, root);
      gradient.addColorStop(1, shaft);
      return gradient;
    };
    const shade = mix(color, basePalette.cavityDeep, .8);
    const highlight = mix(color, basePalette.shine, .36);
    const shaftFill = rootGradient(palette.wall, color);
    const shaftHighlight = rootGradient(mix(palette.wall, palette.wallLight, .42), highlight);
    const rim = mix(color, basePalette.shine, tip === 'rimmed' ? .62 : .38);
    const projectPoints = points => points.map(([x, y]) => {
      const t = Math.max(0, y) / 28;
      const fork = side * (1 + (sword.forkSpan ?? 12) * t ** 1.24);
      const lean = sword.lean ?? 0;
      // 单剑的触手左右各摆一次、尖端回到中线；双剑照旧往外弯
      const curve = shaft !== 'tentacle' ? 0 : paired ? side * t * (2 + 7 * Math.sin(t * 2.5)) : 2.6 * Math.sin(t * Math.PI * 2);
      return [(sword.centerX ?? 48) + fork + x * girth * tipWidth(y) * (paired ? .8 : 1) + lean * t * t + curve,
        anchorY + y * (y < 0 ? Math.min(1.35, reach) : reach)];
    });
    const project = (fill, points) => polygon(fill, projectPoints(points));
    const drawSkin = points => {
      const surface = projectPoints(points);
      polygon(shaftFill, surface);
      if (material) texturePixels(ctx, surface, material, color, .72);
    };
    const surfaceDetails = () => {
      if (shaft === 'veined') {
        // 浮凸的青筋：兩條沿劍身蜿蜒的主筋加兩道分岔，暗兩階、寬 1.4；主筋右側貼一道亮邊，看起來是鼓起來的
        const vein = (path, width) => {
          for (let k = 1; k < path.length; k++) {
            const [x0, y0] = path[k - 1], [x1, y1] = path[k];
            project(mix(color, shade, .8), [[x0 - width / 2, y0], [x1 - width / 2, y1], [x1 + width / 2, y1], [x0 + width / 2, y0]]);
            project(mix(color, highlight, .7), [[x0 + width / 2, y0], [x1 + width / 2, y1], [x1 + width / 2 + .55, y1], [x0 + width / 2 + .55, y0]]);
          }
        };
        vein([[-2.2, 1], [-1.2, 4.5], [-2.4, 8], [-1.3, 11.5], [-2.1, 15]], 1.4);
        vein([[1.8, 2.5], [2.8, 6], [1.6, 9.5], [2.6, 13]], 1.3);
        vein([[-1.2, 4.5], [.4, 6.5]], 1);
        vein([[1.6, 9.5], [.2, 11.5]], 1);
      } else if (shaft === 'ridged') {
        const step = Math.max(2.6, 4 / reach);
        for (let y = 3; y < 16; y += step) {
          project(mix(color, shade, .52), [[-4.5,y],[-2,y+.55],[2,y+.55],[4.5,y],[4.3,y+1.4],[-4.3,y+1.4]]);
          project(mix(color, highlight, .76), [[-4.7,y-.9],[-2,y-.3],[2,y-.3],[4.7,y-.9],[4.7,y+.2],
            [2,y+.7],[-2,y+.7],[-4.7,y+.2]]);
        }
      } else if (shaft === 'spiral') {
        // A shallow return edge makes each oblique ribbon read as part of a helix.
        for (const y of [1.5, 8.6, 15.7]) {
          project(mix(color, shade, .53), [[-3.8,y],[-2.4,y-1.2],[3.8,y+4],[3.8,y+6.1],[-3.8,y+1.8]]);
          project(mix(color, highlight, .72), [[-3.8,y-.5],[-2.8,y-1.5],[3.8,y+3.5],[3.8,y+4.7],
            [-.4,y+1.3],[-3.8,y+.55]]);
        }
      }
    };
    const urethra = (points, centerY) => project(mix(shade, rim, .24 * urine.tighten), points.map(([x, y]) => [
      x * (1 - .65 * urine.tighten), centerY + (y - centerY) * (1 - .51 * urine.tighten),
    ]));
    const paintOne = () => {
      if (look.knot) {
        const width = look.locked ? 9.8 : 6.5 + look.pulse * 1.4;
        project(shade, [[-3,-2],[3,-2],[width,2],[width,7],[3,11],[-3,11],[-width,7],[-width,2]]);
        project(shaftFill, [[-2,-1],[2,-1],[width-1,3],[width-1,6],[2,10],[-2,10],[-width+1,6],[-width+1,3]]);
      }
      if (tip === 'covered') {
        project(shade, [[0, 4], [5, 5], [6, 9], [6, 21], [5, 25], [3, 28], [-3, 28],
          [-5, 25], [-6, 21], [-6, 9], [-5, 5]]);
        drawSkin([[0, -6], [4, -3], [4.5, 2], [4.5, 21], [3.5, 25], [2, 27],
          [-2, 27], [-3.5, 25], [-4.5, 21], [-4.5, 2], [-4, -3]]);
        surfaceDetails();
        project(shaftHighlight, [[-1.5, -4], [.3, -3], [-.4, 3], [-1, 13], [-1.6, 22],
          [-2.8, 24], [-3.4, 20], [-2.7, 8], [-2.6, 2]]);
        project(mix(color, shade, .48), [[-3.5, 23], [0, 24], [3.5, 23], [3, 24.5],
          [0, 25.5], [-3, 24.5]]);
        urethra([[-1.4, 26], [1.4, 26], [1, 27], [-1, 27]], 26.5);
        return;
      }
      project(shade, [[0, 4], [4.5, 5], [6, 8], [5, 15], [8, 20], [7, 25],
        [4, 28], [-4, 28], [-7, 25], [-8, 20], [-5, 15], [-6, 8], [-4.5, 5]]);
      drawSkin([[0, -6], [4, -3], [5, 1], [4.5, 8], [4, 16], [6.5, 20], [6, 24],
        [3, 26], [-3, 26], [-6, 24], [-6.5, 20], [-4, 16], [-4.5, 8], [-5, 1], [-4, -3]]);
      surfaceDetails();
      project(shaftHighlight, [[-1.5, -4], [.3, -3], [-.4, 3], [-1, 9],
        [-2, 15], [-3, 18], [-3.5, 15], [-2.7, 8], [-2.6, 2]]);
      const head = tip === 'flared' ? [[-4,18],[4,18],[6,22],[6,25],[-6,25],[-6,22]]
        : [[-4, 17], [4, 17], [6, 20], [5, 23], [3, 25], [-3, 25], [-5, 23], [-6, 20]];
      project(rim, head);
      urethra([[-1.5, 22], [1.5, 22], [1, 24.5], [-1, 24.5]], 23.25);
    };
    const paint = () => {
      for (side of (paired ? [-1, 1] : [0])) {
        paintOne();
        if (look.barbs) {
          // 冠缘下一圈往根部倒钩的尖刺：暗色底再叠亮面，两侧的刺伸出轮廓外
          for (const [x, y] of [[-6.6,19.6],[-3.4,17.6],[0,17],[3.4,17.6],[6.6,19.6]]) {
            const dir = Math.sign(x);
            project(shade, [[x - 1.8, y + .6], [x + 1.8, y + .6], [x + dir * 1.9, y - 4]]);
            project(highlight, [[x - 1.1, y], [x + 1.1, y], [x + dir * 1.5, y - 3]]);
          }
        }
      }
    };
    const coverOpacity = sword.revealOpening ? 0 : 1 - (sword.recoveryFade ?? 0);
    if (coverOpacity < 1 && anchorY + length > fadeAt) {
      const paintBand = (top, height, opacity) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, frontBuffer.width, height);
        ctx.clip();
        ctx.globalAlpha = opacity;
        paint();
        ctx.restore();
      };
      paintBand(0, fadeAt, 1);
      paintBand(fadeAt, 3, .32 + .68 * coverOpacity);
      if (coverOpacity > 0) paintBand(fadeAt + 3, frontBuffer.height - fadeAt - 3, coverOpacity);
    } else {
      paint();
    }
    ctx.restore();
    const meatusY = anchorY + (tip === 'covered' ? 26.5 : 23.25) * reach;
    return meatusY < clipBottom && (coverOpacity > .65 || meatusY < fadeAt) ? meatusY + 1 : null;
  }

  function drawAnatomy(shape, pregnancy, libidoHeat, stretch, birthOpening, drawDisplacedTissue, sword, recovery, urine, inletPressure) {
    const skin = fields.skin.value;
    const tone = fields.tone.value;
    const fullness = [0, 0, 1, 2][pregnancy] + libidoHeat + recovery * 2;
    const tint = [0, 0.04, 0.14, 0.25][pregnancy] + libidoHeat * .10 + recovery * .25;
    const palette = {
      ...basePalette,
      wall: skin,
      wallDark: surfaceAccent(skin, skin === basePalette.wall ? basePalette.wallDark : mix(skin, basePalette.cavityDeep, .48)),
      wallLight: surfaceAccent(skin, mix(tone, basePalette.cavity, tint), true),
      lining: mix(tone === basePalette.wallLight ? basePalette.lining : mix(tone, basePalette.shine, .25), basePalette.cavity, tint),
    };
    const fold = { band: 0, recessed: -4, leaf: 5, butterfly: 10, slit: -6 }[shape];
    const [outerWidth, outerLength] = { oval: [0, 0], slender: [-5, 4], rounded: [6, -4], shield: [4, 1] }[fields['outer-shape'].value];
    const tissue = mix(tone === basePalette.wallLight ? basePalette.wall : mix(tone, palette.cavity, .32), palette.cavity, tint);
    const vestibule = surfaceAccent(tissue, mix(tone === basePalette.wallLight ? basePalette.wallDark : mix(tone, palette.cavityDeep, .65), palette.cavity, tint));
    const outer = points => points.map(([x, y]) => {
      const distance = Math.min(1, Math.abs(x - 48) / 18);
      const contour = Math.max(0, 1 - Math.abs(y - 61) / 52);
      const lowerContour = Math.max(0, 1 - Math.abs(y - 84) / 28);
      const birthSpread = lowerContour * (birthOpening ? birthOpening.width * .36 : 5 * inletPressure);
      const shield = fields['outer-shape'].value === 'shield' ? Math.max(0, (y - 54) / 7) : 0;
      const width = fullness + outerWidth * contour + birthSpread - shield;
      return [x + Math.sign(x - 48) * width * distance, y + (y - 60) * outerLength / 48];
    });
    const drawOuter = (color, points) => {
      const outline = outer(points);
      if (color === palette.wall) paintMaterial(ctx, color, outline, fields['edge-decoration'].value, .72);
      else polygon(color, outline);
    };
    const inner = (color, points) => {
      const surface = points.map(([x, y]) => {
      const distance = Math.min(1, Math.abs(x - 48) / 12);
      const foldWeight = Math.max(0, 1 - Math.abs(y - (shape === 'butterfly' ? 58 : 65)) / 29);
      const openingWeight = Math.max(0, 1 - Math.abs(y - 78) / (birthOpening ? 24 : 15));
      const spread = birthOpening ? birthOpening.width * .72 : stretch;
      const pinch = sword ? 0 : urine.tighten * 1.7 * Math.max(0, 1 - Math.abs(y - 60) / 14);
        return [x + Math.sign(x - 48) * distance * (fold * foldWeight + spread * openingWeight - pinch), y];
      });
      polygon(color, surface);
      if (color === tissue) canalTexture(ctx, color, surface, .78);
    };
    const slit = shape === 'slit';
    const opening = (color, points) => polygon(color, points.map(([x, y]) => [
      48 + (x - 48) * ((slit ? .63 : 1) + stretch / 6),
      79 + (y - 79) * ((slit ? 1.14 : 1) + stretch / 18),
    ]));
  // Labia majora and their midline shadow.
  drawOuter(palette.cavityDeep, [[46, 14], [56, 15], [66, 21], [73, 32], [77, 48], [76, 67], [71, 83], [62, 98], [54, 105], [45, 107], [36, 102], [27, 91], [21, 77], [18, 62], [18, 45], [22, 32], [31, 21], [39, 16]]);
  drawOuter(palette.wallDark, [[43, 17], [49, 20], [44, 30], [37, 43], [34, 57], [35, 75], [40, 89], [47, 99], [46, 104], [38, 100], [29, 89], [23, 75], [20, 60], [21, 45], [25, 32], [33, 23]]);
  drawOuter(palette.wallDark, [[51, 17], [62, 21], [70, 32], [74, 47], [74, 65], [69, 81], [61, 95], [53, 103], [47, 104], [50, 96], [58, 85], [62, 69], [63, 53], [59, 39], [52, 29], [47, 22]]);
  drawOuter(palette.wall, [[41, 20], [45, 21], [37, 32], [30, 46], [28, 60], [30, 76], [35, 88], [30, 84], [25, 72], [23, 58], [24, 45], [28, 34], [34, 26]]);
  drawOuter(palette.wall, [[54, 20], [62, 25], [68, 35], [71, 47], [71, 61], [67, 75], [63, 84], [60, 87], [64, 73], [66, 58], [65, 45], [60, 32]]);
  const outerJoinShade = sword ? palette.wallDark : mix(palette.wallDark, palette.cavityDeep, .38);
  drawOuter(outerJoinShade, [[34, 22], [40, 18], [47, 16], [54, 17], [61, 20], [57, 23], [52, 21], [47, 21], [42, 22], [38, 25]]);

  // The labia minora continue from the hood and frame the vestibule below the glans.
  inner(traceAccent(tissue, vestibule), [[48, 38], [56, 43], [60, 53], [60, 71], [56, 85], [50, 95], [45, 93], [39, 82], [35, 67], [36, 52], [40, 43]]);
  inner(tissue, [[44, 28], [44, 33], [42, 40], [42, 50], [40, 60], [40, 70], [43, 81], [47, 93], [42, 90], [37, 82], [34, 72], [33, 61], [35, 51], [37, 42], [39, 34]]);
  inner(tissue, [[52, 28], [57, 34], [59, 47], [62, 59], [61, 72], [57, 84], [52, 93], [46, 97], [50, 87], [54, 78], [56, 67], [55, 54], [53, 43], [52, 34]]);
  inner(palette.wallLight, [[42, 31], [42, 43], [40, 54], [37, 64], [38, 73], [41, 83], [38, 79], [35, 71], [35, 62], [37, 53], [39, 43], [39, 36]]);
  inner(palette.wallLight, [[54, 31], [57, 39], [59, 53], [60, 63], [59, 73], [55, 83], [56, 73], [57, 63], [56, 52], [54, 44], [54, 36]]);

  // The inner folds meet at the hood, with the glans visible below its edge.
  const clitoralY = 29 + Math.round(-27 * outerLength / 48);
  let drawSword;
  let urineOutletY = 62;
  if (sword) {
    const vaginalTop = birthOpening
      ? Math.max(65, birthOpening.centerY - birthOpening.depth - 4 * birthOpening.rimThickness)
      : 69 - 10 * stretch / 18;
    const pouchWidth = scrotumVisible('futa') ? 1 + Math.max(0, outerWidth) * .013 : 0;
    drawSword = () => drawExternalShaft(clitoralY, libidoHeat, palette, pouchWidth, vaginalTop, sword, urine);
    if (sword.revealOpening) urineOutletY = drawSword();
  } else {
  const length = { short: .78, standard: 1, long: 1.46, extended: 2.18 }[fields['clitoral-length'].value];
  const visibleLength = length + .68 * libidoHeat;
  clitoralHoodMarker.style.setProperty('--y', `${100 * (clitoralY - 7) / canvas.height}%`);
  clitoralGlansMarker.style.setProperty('--y', `${100 * (clitoralY - 3 + 4 * visibleLength) / canvas.height}%`);
  const clitoral = (color, points, width = 1, depth = 1) => polygon(color, points.map(([x, y]) => [
    48 + x * width,
    clitoralY - 3 + (y + 3) * depth,
  ]));
  const glans = (color, points) => clitoral(color, points, 1 + .46 * libidoHeat, visibleLength);
  const glansColor = mix(palette.lining, palette.wall, libidoHeat * .24);
  clitoral(tissue, [[-5, 2], [5, 2], [4, 7], [0, 11], [-4, 7]]);
  glans(palette.cavity, [[-2.5, -4], [2.5, -4], [4.5, -1], [4.5, 3], [2.5, 5.5], [-1.5, 5.5],
    [-4, 3], [-4, -1]]);
  glans(mix(glansColor, tissue, .38), [[-2, -3], [2, -3], [4, 0], [4, 2.5], [2, 5],
    [-1.5, 5], [-3.5, 3], [-3.5, -1]]);
  glans(glansColor, [[-2, -2.5], [1.5, -2.5], [2.7, -.7], [2.4, 1.7], [.6, 3.5],
    [-1.5, 3.3], [-3, 1.3], [-3, -.8]]);
  glans(mix(glansColor, palette.shine, .88), [[-2.5, 0], [-1.5, -1.5], [.5, -1.5],
    [1, -.3], [0, .9], [-1.7, 1.4]]);
  const hoodShade = mix(tissue, palette.cavity, .42);
  const hoodLight = mix(palette.wallLight, tissue, .18);
  clitoral(hoodShade, [[-10, 11], [-9, 4], [-8, -2], [-6, -7], [-3, -10], [2, -10], [5, -8],
    [7, -5], [9, 3], [10, 11], [7, 8], [5, 1], [3, -2], [1, -3], [-2, -3], [-4, -1], [-6, 4], [-7, 8]]);
  clitoral(tissue, [[-9, 10], [-8, 1], [-6, -5], [-3, -9], [2, -9], [5, -7], [7, -2], [9, 10],
    [7, 7], [5, 0], [3, -4], [1, -5], [-2, -5], [-4, -3], [-6, 1], [-7, 7]]);
  clitoral(hoodLight, [[-9, 9], [-7, 0], [-5, -5], [-2, -8], [2, -8], [5, -6], [7, -1],
    [9, 9], [7, 6], [5, -1], [3, -5], [0, -6], [-2, -6], [-4, -3], [-6, 1], [-7, 6]]);
  const urinaryOpening = (color, points) => polygon(color, points.map(([x, y]) => [
    48 + (x - 48) * (1 - .30 * urine.tighten), 61 + (y - 61) * (1 - .32 * urine.tighten),
  ]));
  urinaryOpening(palette.wallLight, [[45, 59], [48, 57], [51, 59], [51, 63], [48, 65], [45, 63]]);
  urinaryOpening(palette.cavityDeep, [[46, 60], [49, 59], [50, 61], [49, 63], [46, 62]]);
  }
  if (birthOpening) {
    drawDisplacedTissue?.();
    drawBirthRim(birthOpening, tissue, palette.wallLight, 65, birthOpening.rimThickness, ctx, true);
    return urineOutletY;
  }
  const openingTone = mix(tissue, palette.wallLight, .74 * inletPressure);
  opening(openingTone, [[44, 71], [49, 69], [53, 73], [54, 79], [52, 85], [49, 89], [45, 87], [42, 82], [41, 77]]);
  opening(palette.cavityDeep, [[45, 74], [49, 73], [52, 76], [52, 81], [49, 86], [46, 85], [43, 80], [43, 77]]);
  opening(palette.cavity, [[45, 80], [47, 82], [50, 81], [49, 85], [46, 84]]);
  drawHymen(opening, tissue, palette);
  drawDisplacedTissue?.();
  if (sword && !sword.revealOpening) urineOutletY = drawSword();
  return urineOutletY;
  }

  /**
   * 处女膜（1.6.0）：完整是盖住阴道口的一层薄膜、中间一个小孔；破了是入口两侧与下缘的小殘痕。
   * 破处时膜先被撑紧（变亮、小孔撑大），裂开后换成殘痕。跟着阴道口的撑开一起缩放（opening 的座标转换）。
   */
  let hymenFrame = { state: 'none', tension: 0 };
  function drawHymen(opening, tissue, palette) {
    const { state, tension } = hymenFrame;
    if (state === 'intact') {
      const membrane = mix(mix(tissue, palette.wallLight, .45), palette.shine, .35 * tension);
      opening(mix(membrane, palette.cavityDeep, .35), [[44.5, 74.5], [49, 73.5], [51.5, 76], [51.5, 80.5], [49, 85.5], [46, 84.5], [43.5, 80], [43.5, 77]]);
      opening(membrane, [[45, 75], [49, 74], [51, 76.5], [51, 80.5], [48.5, 84.5], [46, 84], [44, 80], [44, 77.5]]);
      const hole = 1 + 1.1 * tension;
      opening(palette.cavityDeep, [[46.5, 78], [48.5, 77.5], [49.5, 79.5], [48.5, 82], [46.5, 81.5]].map(([x, y]) => [47.9 + (x - 47.9) * hole, 79.8 + (y - 79.8) * hole]));
      opening(mix(membrane, palette.shine, .45), [[45.5, 75.5], [47.5, 75], [46, 77]]);
    } else if (state === 'torn') {
      const remnant = mix(tissue, palette.wallLight, .3);
      opening(remnant, [[43.5, 77.5], [45, 76.5], [45.5, 79.5], [44, 81]]);
      opening(remnant, [[51.5, 77.5], [52, 80.5], [50.5, 81.5], [50.5, 78.5]]);
      opening(remnant, [[46, 84.5], [48.5, 84], [47.5, 86]]);
    }
  }

  /** 泄殖腔、管口的处女膜：照开口的椭圆画，完整是一层带小孔的膜，破了是两侧的小殘痕 */
  function drawOutletHymen(opening, tone) {
    const { state, tension } = hymenFrame;
    if (state === 'none') return;
    const { centerX, centerY, width, depth } = opening;
    const ellipse = (color, rx, ry, cx = centerX, cy = centerY) => polygon(color, Array.from({ length: 14 }, (_, k) => {
      const angle = k * Math.PI * 2 / 14;
      return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
    }));
    if (state === 'intact') {
      const membrane = mix(mix(tone, basePalette.shine, .25), basePalette.shine, .35 * tension);
      ellipse(membrane, Math.max(1.6, width * .78), Math.max(1.4, depth * .78));
      ellipse(basePalette.cavityDeep, Math.max(.8, width * (.22 + .25 * tension)), Math.max(.8, depth * (.24 + .25 * tension)));
      ellipse(mix(membrane, basePalette.shine, .45), Math.max(.6, width * .2), .6, centerX - width * .35, centerY - depth * .45);
    } else if (state === 'torn') {
      const remnant = mix(tone, basePalette.shine, .18);
      ellipse(remnant, Math.max(.7, width * .16), Math.max(.8, depth * .26), centerX - width * .72, centerY + depth * .1);
      ellipse(remnant, Math.max(.7, width * .16), Math.max(.8, depth * .26), centerX + width * .72, centerY + depth * .15);
    }
  }

  const COMBINE_MS = 2400;
  const RECOIL_MS = 2500;
  const ANAL_HOLD_END_MS = 1420;
  const ANAL_FIT_END_MS = 2950;
  const ANAL_RESIDUE_MS = 2800;
  const ANAL_RESIDUE_STATIC_MS = 900;
  const LABOR_RELEASE_MS = 850;
  const RECOVERY_PREVIEW_MS = 4800;
  const flowEffects = {
    period: { duration: 1600, repeat: true, count: 2, interval: 800, fall: 940, spread: 5,
      color: '#b94460', highlight: '#ee9290', film: 8 },
    hymen: { duration: 1700, count: 2, interval: 320, fall: 1150, spread: 3,
      color: '#b8323e', highlight: '#ee9290', film: 2 },
    withdrawal: { duration: 1850, delay: COMBINE_MS, count: 3, interval: 210, fall: 1180, spread: 8,
      color: '#b980aa', highlight: '#e5adc9', film: 4, strand: 520 },
    full: { duration: 4200, repeat: true, count: 3, interval: 1400, fall: 1500, spread: 6,
      color: '#b980aa', highlight: '#e5adc9', film: 3 },
    soaked: { duration: 6000, repeat: true, count: 1, interval: 0, fall: 1850, spread: 4,
      color: '#b980aa', highlight: '#e5adc9', film: 2 },
    spill: { duration: 2300, count: 6, interval: 110, fall: 1200, spread: 13,
      color: '#b980aa', highlight: '#e5adc9', film: 6, strand: 680 },
    rupture: { duration: 2800, count: 9, interval: 115, fall: 1150, spread: 18,
      color: '#a5c9de', highlight: '#e4f5f1', film: 6, strand: 750 },
    'water-flow': { duration: 2400, repeat: true, count: 3, interval: 800, fall: 1050, spread: 8,
      color: '#a5c9de', highlight: '#e4f5f1', film: 3 },
  };
  let combineStart = null;
  let analFitStart = null;
  let flowStart = null;
  let rapidLaborStart = null;
  let rapidLaborResult = '';
  let recoveryStart = null;
  // 破处（1.6.0）：从这一刻起播剑鞘契合，膜先被撑紧、HYMEN_TEAR_MS 时裂开滴血，之后留下殘痕
  let deflowerStart = null;
  const HYMEN_TEAR_MS = 700;
  let urineStart = 0;
  let stoolStart = 0;
  let lastLaborPush = 0;
  let laborRelease = null;
  let frameId = 0;
  let lastTick = -1;

  const obstructionDescent = { transverse: 1, twin_lock: 1, shoulder_dystocia: 3 };
  const RAPID_ENTRY_AT = 220;
  const RAPID_CROWN_AT = 190;
  const RAPID_EMERGE_AT = 420;
  const RAPID_CATCH_AT = 690;
  const RAPID_END_AT = 1250;
  const RAPID_HELD_DROP = .72;

  function previewDescent(condition) {
    return obstructionDescent[condition] ?? Number(fields.descent.value);
  }

  function blocksPelvicInlet(condition) {
    return condition === 'transverse' || condition === 'twin_lock';
  }

  function selectedPresentingPosition(condition) {
    return condition in obstructionDescent ? 'head' : fields['presenting-position'].value;
  }

  function rapidLaborFrame(now, condition) {
    if (rapidLaborStart === null) return null;
    const elapsed = Math.max(0, now - rapidLaborStart);
    if (condition === 'precipitous-entry') {
      if (elapsed >= RAPID_ENTRY_AT + flowEffects.rupture.duration) {
        rapidLaborStart = null;
        fields.descent.value = '1';
        rapidLaborResult = '已轉入第二產程 · 先露部仍在產道內';
        return null;
      }
      return { descent: elapsed < RAPID_ENTRY_AT ? 0 : 1, push: Math.max(0, 1 - Math.abs(elapsed - 290) / 320),
        ruptureElapsed: elapsed - RAPID_ENTRY_AT,
        status: elapsed < RAPID_ENTRY_AT ? '第一產程' : '破水 · 已轉入第二產程' };
    }
    if (elapsed >= RAPID_END_AT) {
      rapidLaborStart = null;
      fields.descent.value = '3';
      rapidLaborResult = '先露部停在外口';
      return null;
    }
    const descent = elapsed < RAPID_CROWN_AT ? 1 : elapsed < RAPID_EMERGE_AT ? 2 : 3;
    const fall = Math.max(0, (elapsed - RAPID_EMERGE_AT) / (RAPID_CATCH_AT - RAPID_EMERGE_AT));
    const settling = Math.max(0, 1 - (elapsed - RAPID_CATCH_AT) / 360);
    return {
      descent,
      push: elapsed < RAPID_CATCH_AT ? Math.max(0, 1 - Math.abs(elapsed - 340) / 350) : 0,
      ruptureElapsed: null,
      drop: elapsed < RAPID_CATCH_AT ? fall ** 2 : RAPID_HELD_DROP + (1 - RAPID_HELD_DROP) * settling ** 2,
      status: descent === 1 ? '快速下降' : descent === 2 ? (selectedPresentingPosition(condition) === 'head' ? '快速著冠' : '快速抵達外口')
        : elapsed < RAPID_CATCH_AT ? '先露部快速下滑' : '先露部停在外口',
    };
  }

  function needMotion(now, prolapse) {
    const urine = Number(fields.urine.value);
    const stool = Number(fields.stool.value);
    const phase = (start, period, still) => reducedMotion.matches ? still : (Math.max(0, now - start) % period) / period;
    const pulse = (position, start, end) => Math.sin(Math.PI * Math.max(0, Math.min(1, (position - start) / (end - start))));
    const peePhase = phase(urineStart, urine === 2 ? 1540 : 3200, .25);
    const bowelPhase = phase(stoolStart, stool === 2 ? 2220 : 3500, .48);
    const gasPhase = reducedMotion.matches ? .69 : bowelPhase;
    const leak = urine === 2 || (urine === 1 && prolapse >= 2);
    return {
      active: !reducedMotion.matches && (urine > 0 || stool > 0),
      urine: {
        tighten: (urine === 2 ? 1 : urine * .7) * pulse(peePhase, 0, urine === 2 ? .48 : .36),
        drops: leak ? urine : 0,
        phase: peePhase,
      },
      stool: {
        tighten: (stool === 2 ? 1 : stool * .72) * pulse(bowelPhase, 0, .34),
        bulge: (stool === 2 ? 1 : stool * .55) * pulse(bowelPhase, .23, stool === 2 ? .92 : .73),
        gas: stool === 2 && gasPhase >= .57 && gasPhase < .91 ? (gasPhase - .57) / .34 : null,
      },
    };
  }

  function drawUrineDrops({ drops, phase }, originY) {
    const exitY = canvas.height + 2;
    const top = Math.min(canvas.height - 3, Math.round(originY));
    const fallSpan = .44;
    for (let i = 0; i < drops; i++) {
      const elapsed = phase - .19 - i * .13;
      if (elapsed < 0 || elapsed >= fallSpan) continue;
      const fall = elapsed / fallSpan;
      const x = 48 + Math.round((12 + i * 4) * fall);
      const y = top + Math.round((exitY - top) * fall * (.42 + .58 * fall));
      frontContext.fillStyle = '#d9a44a';
      frontContext.fillRect(x - 1, y, 2, 1);
      frontContext.fillStyle = '#ffe3a2';
      frontContext.fillRect(x, y - 1, 1, 1);
    }
  }

  function drawStoolGas(context, progress, originX, originY, size = 1) {
    if (progress === null) return;
    const x = Math.min(context.canvas.width - Math.ceil(5 * size), Math.round(originX + 3 + 9 * progress));
    const y = Math.round(originY + 2 - 3 * progress);
    const puff = (dx, dy, width, height) => context.fillRect(
      x + Math.round(dx * size), y + Math.round(dy * size), Math.round(width * size), Math.round(height * size),
    );
    context.save();
    context.globalAlpha = .78 * (1 - progress);
    context.fillStyle = '#807087';
    puff(-2, 0, 4, 2);
    puff(1, -2, 4, 2);
    context.fillStyle = '#c2adb9';
    puff(0, 0, 2, 1);
    puff(3, -2, 2, 1);
    context.restore();
  }

  function fitStretch(elapsed, fit) {
    const peak = [1, 1, 2, 2, 3, 5, 8, 10, 12][fit + 4];
    if (elapsed >= COMBINE_MS) {
      const remaining = Math.max(0, 1 - (elapsed - COMBINE_MS) / RECOIL_MS);
      return Math.round(peak * remaining);
    }
    if (fit <= 0) return Math.round(peak * Math.min(1, elapsed / 360));
    if (fit === 1) return elapsed < 500 ? 1 : peak;
    if (fit < 4) return 1 + Math.round((peak - 1) * Math.min(3, Math.floor(elapsed / 420)) / 3);
    return elapsed < 180 ? 3 : peak;
  }

  function analFitExpansion(elapsed, swordSize) {
    const amount = elapsed < ANAL_HOLD_END_MS
      ? Math.max(0, Math.min(1, elapsed / 620))
      : Math.max(0, (ANAL_FIT_END_MS - elapsed) / (ANAL_FIT_END_MS - ANAL_HOLD_END_MS));
    return [.20, .44, .69, .99, 1.32][swordSize] * amount * (2 - amount);
  }

  // Mirror the fit tiers in getPenetrationFitView. The displaced canal supplies its own depth.
  function sectionFit(elapsed, diff) {
    const tier = Math.abs(diff);
    const direction = Math.sign(diff);
    const width = 9 + direction * 2 * tier;
    const length = Math.max(6, Math.round(22 * width / 9));
    const active = elapsed >= 0 && elapsed < COMBINE_MS;
    const flare = direction > 0 && tier >= 2 && tier < 4
      ? Math.round((tier - 1) * Math.max(0, 1 - Math.max(0, elapsed - COMBINE_MS) / RECOIL_MS)) : 0;
    return { elapsed, tier, direction, width, length, active, flare };
  }

  function sectionPixel(color, x, y, width, height = 1) {
    if (height <= 0) return;
    sectionContext.fillStyle = color;
    sectionContext.fillRect(x, y, width, height);
  }

  function drawSectionLumen(points) {
    const color = uterusShade(basePalette.cavityDeep);
    polygon(color, points, sectionContext);
    texturePixels(sectionContext, points, fields['canal-material'].value, color, .43);
  }

  function drawTrackerCanal(top, bottom, flare) {
    const length = bottom - top;
    if (length <= 0) return;
    sectionPixel(uterusShade(flare ? basePalette.wall : basePalette.wallDark), 44 - flare, top, 8 + 2 * flare, length);
    drawSectionLumen([[45 - flare, top], [51 + flare, top], [51 + flare, bottom - 1], [45 - flare, bottom - 1]]);
    const color = uterusShade(basePalette.wallLight);
    const wallBottom = top + Math.max(1, length - 5);
    const strip = (x, y, width, end, paint) => {
      if (y >= end) return;
      if (paint) sectionPixel(color, x, y, width, end - y);
      canalTexture(sectionContext, color, [[x, y], [x + width, y], [x + width, end], [x, end]]);
    };
    strip(42 - flare, top, 2, wallBottom, true);
    strip(52 + flare, top, 2, wallBottom, true);
    strip(44 - flare, wallBottom, 1, bottom, false);
    strip(51 + flare, wallBottom, 1, bottom, false);
    if (fields['vaginal-septum'].value === 'on') {
      const divider = [[47, top], [49, top], [49, bottom - 1], [47, bottom - 1]];
      polygon(uterusShade(basePalette.wallDark), divider, sectionContext);
      canalTexture(sectionContext, color, divider);
    }
  }

  function drawSectionEntrance(bottom) {
    for (let row = 1; row <= 4; row++) {
      const y = bottom - 5 + row;
      if (y < 0) continue;
      drawSectionLumen([[45 - row, y], [51 + row, y], [51 + row, y + 1], [45 - row, y + 1]]);
      sectionPixel(basePalette.wall, 43 - row, y, 2);
      sectionPixel(basePalette.wall, 51 + row, y, 2);
      sectionPixel(basePalette.wallLight, 44 - row, y, 1);
      sectionPixel(basePalette.wallLight, 51 + row, y, 1);
    }
  }

  function trackerShaftPose(fit, top, bottom, level) {
    const { elapsed, direction, tier, width, length } = fit;
    const canalLength = bottom - top;
    const phase = Math.floor(elapsed / 180) % 4;
    const advancing = phase === 1 || phase === 2;
    const entrance = bottom - 6;
    const reach = direction < 0 ? Math.max(top, bottom - length)
      : tier === 4 ? bottom - 2 : tier === 3 ? top + Math.round(canalLength / 2) : top;
    let tip;
    if (direction <= 0) tip = reach + (advancing ? 0 : tier ? 6 : 8);
    else if (tier === 1) tip = elapsed < 500 ? entrance : reach + (advancing ? 0 : 8);
    else if (tier === 4) tip = reach + (advancing ? 0 : 2);
    else {
      const step = Math.min(3, Math.floor(elapsed / 420));
      tip = step < 3 ? entrance + (reach - entrance) * step / 3 : reach + (advancing ? 0 : 3);
    }
    const displacementLimit = top + level;
    const mouthClearance = !tier && level === 0 ? 5 : 2;
    const headY = Math.min(bottom - mouthClearance, Math.round(Math.max(tip, reach, displacementLimit)));
    const shaftBottom = Math.min(120, tier ? headY + length : bottom);
    const cx = 48 + (direction < 0 && tier >= 2 ? phase === 1 ? -1 : phase === 3 ? 1 : 0 : 0);
    const half = (width - 1) >> 1;
    return { headY, shaftBottom, cx, half, width };
  }

  function drawTrackerShaft({ headY, shaftBottom, cx, half, width }) {
    const outline = basePalette.shine;
    const silhouette = mix(basePalette.cavityDeep, '#0b0710', .65);
    if (half === 0) {
      sectionPixel(mix(outline, silhouette, .45), cx, headY + 1, 1, shaftBottom - headY - 1);
      sectionPixel(outline, cx, headY, 1);
      return;
    }
    const headCenter = headY + 2;
    const ellipse = (color, rx, ry) => {
      for (let dy = -ry; dy <= ry; dy++) {
        const row = Math.floor(rx * Math.sqrt(1 - (dy / ry) ** 2));
        sectionPixel(color, cx - row, headCenter + dy, 2 * row + 1);
      }
    };
    const radius = Math.min(3, half);
    sectionPixel(outline, cx - half, headCenter, width, shaftBottom - headCenter);
    ellipse(outline, half, radius);
    sectionPixel(silhouette, cx - half + 1, headCenter, width - 2, shaftBottom - headCenter);
    if (half >= 2) ellipse(silhouette, half - 1, radius - 1);
  }

  const birthOutletGeometry = {
    human: { centerY: 83, widthScale: 1, depthScale: 1, earlyStretch: 3, topLimit: 65 },
    pouch: { centerY: 61, widthScale: 1.10, depthScale: .63, earlyStretch: 2 },
    anal: { centerY: 84, widthScale: 1, depthScale: 1, earlyStretch: 3, topLimit: 66 },
    tube: { centerY: 87, widthScale: .70, depthScale: 1.04, earlyStretch: 2 },
    round: { centerY: 75, widthScale: .82, depthScale: 1.04, earlyStretch: 2, width: 6, depth: 5 },
    transverse: { centerY: 75, widthScale: 1, depthScale: .66, earlyStretch: 3, width: 11, depth: 2 },
    longitudinal: { centerY: 75, widthScale: .65, depthScale: 1.17, earlyStretch: 2, width: 3, depth: 8 },
    pore: { centerY: 75, widthScale: .75, depthScale: .88, earlyStretch: 2, width: 2, depth: 2 },
  };

  const tubeDiameterScale = { slender: .70, standard: 1, wide: 1.28 };
  const tubeTipScale = { rounded: 1, glans: 1.32, tapered: .62, flared: 1.75, flower: 1.12, valves: 1.06, hyena: .88 };

  function getBirthOpening(weightScale, descent, geometry, diameter = 1) {
    const centerY = geometry.centerY + (descent === 3 ? 3 : 0);
    const width = Math.round((18 + 12 * weightScale) * geometry.widthScale * diameter);
    const baseDepth = (descent === 2 ? 13 : 18) + 7 * weightScale;
    const depth = Math.min(Math.round(baseDepth * geometry.depthScale), centerY - (geometry.topLimit ?? 48));
    return { width, depth, centerX: 48, centerY };
  }

  function pushEfficiency(fatigue) {
    // Same efficiency curve as getPushEfficiency in scripts/tools.js.
    return Math.max(.20, 1 - Math.max(0, fatigue - 60) / 40 * .80);
  }

  function laborPush(now, pushing, fatigue) {
    if (!pushing) {
      if (!laborRelease || reducedMotion.matches) {
        laborRelease = null;
        return 0;
      }
      const elapsed = Math.max(0, now - laborRelease.start);
      if (elapsed < LABOR_RELEASE_MS) return laborRelease.amount * (1 - elapsed / LABOR_RELEASE_MS) ** 2;
      laborRelease = null;
      return 0;
    }
    const efficiency = pushEfficiency(fatigue);
    if (reducedMotion.matches) return efficiency;
    const phase = now % 2800;
    if (phase < 400) return efficiency * Math.sin(Math.PI * phase / 800);
    if (phase < 560) return efficiency;
    return efficiency * Math.max(0, 1 - (phase - 560) / LABOR_RELEASE_MS) ** 2;
  }

  function drawBirthRim({ width, depth, centerX = 48, centerY }, tissue, light, topLimit = 65, thickness = 1, context = ctx, textured = false) {
    const rim = [[0, -1], [.56, -.88], [.87, -.52], [1, 0], [.88, .52], [.52, .87], [0, 1], [-.52, .87], [-.88, .52], [-1, 0], [-.87, -.52], [-.56, -.88]];
    const layer = (color, xRadius, yRadius) => {
      const upperRadius = Math.min(yRadius, centerY - topLimit);
      const surface = rim.map(([x, y]) => [centerX + x * xRadius, centerY + y * (y < 0 ? upperRadius : yRadius)]);
      polygon(color, surface, context);
      if (textured && color === light) canalTexture(context, color, surface, .69);
    };
    layer(tissue, width + 5 * thickness, depth + 4 * thickness);
    layer(light, width + 3 * thickness, depth + 2 * thickness);
    layer(basePalette.cavityDeep, width + 1, depth);
  }

  function drawFlowerOutlet(opening, shadow, tone, thickness, libidoHeat) {
    const { width, depth, centerX = 48, centerY } = opening;
    const reach = 8 + 2 * libidoHeat;
    const petalColor = mix(shadow, tone, .62);
    const tipColor = mix(tone, basePalette.shine, .52);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const petal = (color, points) => polygon(color, points.map(([along, across]) => [
        centerX + x * (width + along) - y * across,
        Math.min(119, centerY + y * (depth + along) + x * across),
      ]));
      petal(shadow, [[1, -2], [reach - 5, -4], [reach, -2], [reach + 1, 0],
        [reach, 2], [reach - 5, 4], [1, 2]]);
      petal(petalColor, [[3, -1], [reach - 4, -2.5], [reach - 1, -1.5], [reach, 0],
        [reach - 1, 1.5], [reach - 4, 2.5], [3, 1]]);
      petal(tipColor, [[reach - 3, -.8], [reach - 1, -1], [reach, 0],
        [reach - 1, 1], [reach - 3, .8]]);
    }
    // The spokes start behind the rim and leave the central opening clear.
    drawBirthRim(opening, shadow, tone, centerY - 20, thickness, ctx, true);
  }

  function drawAnalAnatomy(outlet, libidoHeat, stretch, birthOpening, drawDisplacedTissue, recovery, needs, busy, inletPressure, look) {
    const skin = fields.skin.value;
    const palette = { ...basePalette, wall: skin,
      wallDark: surfaceAccent(skin, mix(skin, basePalette.cavityDeep, .48)),
      wallLight: surfaceAccent(skin, fields.tone.value, true) };
    const depleted = 1 - Number(fields['sire-reserve'].value) / 100;
    const pouch = mix(skin, palette.wallDark, .30 + .08 * depleted);
    const size = scrotumScale();
    // 男孕的陰囊下面就是肛門，縱向只放大一半，避免蓋住肛門
    const tall = 1 + (size - 1) * .5;
    const drawPouch = (color, points) => polygon(color, points.map(([x, y]) => {
      const lower = Math.min(1, Math.max(0, (y - 30) / 30));
      const px = 48 + (x - 48) * (1 - .19 * depleted * lower), py = y - 5 * depleted * lower;
      return [48 + (px - 48) * size, 12 + (py - 12) * tall];
    }));
    if (scrotumVisible('anal')) {
    drawPouch(palette.wallDark, [[29, 20], [34, 15], [41, 12], [54, 12], [61, 14], [67, 20],
      [64, 28], [65, 35], [69, 43], [70, 51], [66, 58], [60, 62], [54, 63], [48, 61],
      [43, 63], [36, 62], [30, 58], [26, 52], [27, 44], [32, 34], [32, 28]]);
    drawPouch(pouch, [[32, 20], [36, 16], [43, 14], [54, 14], [60, 16], [64, 20], [61, 28],
      [62, 36], [66, 44], [67, 51], [63, 57], [59, 60], [54, 61], [48, 59], [43, 61],
      [37, 60], [32, 57], [29, 51], [30, 45], [35, 35], [35, 28]]);
    drawPouch(skin, [[37, 19], [46, 15], [55, 16], [59, 19], [58, 25], [59, 34], [55, 39],
      [51, 35], [45, 35], [41, 40], [37, 36], [38, 27]]);
    drawPouch(mix(pouch, palette.wallLight, .26), [[36, 41], [39, 39], [41, 41], [38, 46],
      [36, 53], [33, 54], [32, 50]]);
    drawPouch(mix(pouch, palette.wallLight, .18), [[59, 42], [63, 46], [64, 52], [62, 55], [60, 51]]);
    drawPouch(palette.wallDark, [[48, 39], [49, 46], [49, 56], [48, 60], [46, 57], [47, 50]]);
    }
    const color = mix(fields['anus-color'].value, basePalette.cavity, recovery * .24);
    const anusShape = selectedAnusShape(true);
    const { stool } = needs;
    const pressure = stool.bulge * 3.1 - stool.tighten * 1.5;
    const baseWidth = { small: 3, large: 4, claude: 4.8, gpt: 4.8, gemini: 4.8 }[anusShape];
    const opening = birthOpening || { ...outlet, width: Math.max(1, baseWidth + stretch * .84 + pressure),
      depth: Math.max(1, 2 + stretch * .48 + pressure * .46) };
    const thickness = birthOpening?.rimThickness ?? .86 + .55 * inletPressure;
    const openingTop = Math.max(66, opening.centerY - opening.depth - 4 * thickness);
    const offset = Number(swordOffset.value);
    const revealOpening = busy || recovery > 0 || fields.stool.value !== '0' || fields.flow.value !== 'none';
    const drawShaft = () => drawExternalShaft(20, libidoHeat, palette, 0, openingTop, {
      offset, length: 42 + 15 * offset + 3.75 * Math.max(0, offset) ** 2, revealOpening, look,
      clipBottom: Math.floor(canvas.height * analDistanceStart),
    }, needs.urine);
    let urineOutletY = revealOpening ? drawShaft() : null;
    let prolapsedOpening;
    if (birthOpening) prolapsedOpening = drawDisplacedTissue?.();
    drawAnusOpening(anusShape, opening, color, stool.bulge, inletPressure + .32 * stool.tighten, thickness, Boolean(birthOpening), ctx);
    if (!birthOpening) prolapsedOpening = drawDisplacedTissue?.();
    if (!revealOpening) urineOutletY = drawShaft();
    const gasOutlet = !birthOpening && prolapsedOpening ? prolapsedOpening : opening;
    drawStoolGas(ctx, stool.gas, (gasOutlet.centerX ?? outlet.centerX) + gasOutlet.width * (birthOpening ? 1 : .64),
      gasOutlet.centerY + gasOutlet.depth * .45, 1.8);
    return urineOutletY;
  }

  function drawOutletDecoration(decoration, draw, light, shadow, libidoHeat) {
    const lift = Math.round(libidoHeat * 2);
    const motif = (shadowPoints, facePoints, face = light) => {
      const centerX = facePoints.reduce((sum, [x]) => sum + x, 0) / facePoints.length;
      const shifted = facePoints.map(([x, y]) => [centerX + (x - centerX) * (1 + libidoHeat * .15), y - lift]);
      draw(shadow, shadowPoints.map(([x, y]) => [x + lift * .5, y + lift * .5]));
      draw(mix(face, light, libidoHeat * .6), shifted);
    };

    if (decoration === 'veins') {
      const vein = mix(shadow, light, .26);
      motif([[45, 56], [46, 47], [49, 41], [49, 33], [51, 31], [52, 42], [49, 49], [48, 57]],
        [[45, 55], [46, 47], [49, 41], [49, 34], [50, 33], [50, 42], [48, 49], [47, 55]], vein);
      motif([[47, 49], [42, 46], [40, 41], [35, 38], [34, 36], [42, 40], [44, 45], [48, 47]],
        [[47, 48], [42, 45], [40, 41], [35, 37], [36, 37], [42, 40], [43, 44], [48, 47]], vein);
      motif([[49, 45], [54, 43], [57, 39], [62, 37], [63, 38], [59, 41], [55, 45], [49, 47]],
        [[49, 44], [54, 43], [57, 39], [62, 37], [62, 38], [58, 40], [55, 44], [49, 46]], vein);
      motif([[48, 52], [54, 51], [60, 53], [61, 55], [54, 53], [48, 54]],
        [[48, 52], [54, 51], [60, 53], [60, 54], [54, 52], [48, 53]], vein);
    } else if (decoration === 'feathers') {
      for (const y of [30, 40, 50]) {
        motif([[33, y + 2], [42, y + 3], [47, y + 11], [39, y + 8]], [[33, y], [42, y + 1], [47, y + 9], [39, y + 6]]);
        motif([[63, y + 2], [54, y + 3], [49, y + 11], [57, y + 8]], [[63, y], [54, y + 1], [49, y + 9], [57, y + 6]]);
      }
    } else if (decoration === 'scales') {
      for (const [y, centers] of [[32, [39, 48, 57]], [40, [34, 43, 52, 61]], [48, [39, 48, 57]]]) {
        for (const x of centers) {
          motif([[x - 4, y], [x, y + 4], [x + 4, y], [x + 3, y + 3], [x, y + 6], [x - 3, y + 3]],
            [[x - 3, y], [x, y + 2], [x + 3, y], [x, y + 4]]);
        }
      }
    } else if (decoration === 'ridges') {
      for (const y of [33, 43, 53]) {
        motif([[33, y], [48, y + 4], [63, y], [61, y + 3], [48, y + 7], [35, y + 3]],
          [[36, y - 1], [48, y + 2], [60, y - 1], [48, y + 4]]);
      }
    }
  }

  function drawTubeValve(opening, dark, light, rim, tip, delivering) {
    const { centerX, centerY, width, depth } = opening;
    if (delivering) {
      const outer = width + 6.5 * rim;
      const flap = (color, points, side) => polygon(color, points.map(([dx, dy]) => [
        centerX + side * dx * outer, centerY + dy * (depth + 3.5 * rim),
      ]));
      for (const side of [-1, 1]) {
        flap(dark, [[.22, -.88], [.51, -1], [.81, -.69], [1, -.20], [1, .23],
          [.85, .68], [.55, .99], [.25, .92], [.51, .64], [.64, .26], [.65, -.29], [.49, -.66]], side);
      }
      drawBirthRim(opening, dark, light, centerY - depth - 4 * rim, rim, ctx, true);
      const crease = mix(dark, light, .58);
      for (const side of [-1, 1]) {
        flap(crease, [[.55, -.87], [.79, -.59], [.92, -.22], [.91, .28], [.80, .57],
          [.59, .81], [.76, .49], [.82, .19], [.83, -.20], [.73, -.52]], side);
      }
      return;
    }
    const x = width + rim;
    const y = depth + rim;
    const shape = (color, points, side = 1) => {
      const surface = points.map(([dx, dy]) => [centerX + side * dx * x, centerY + dy * y]);
      polygon(color, surface);
      if (color !== basePalette.cavityDeep) canalTexture(ctx, color, surface, .65);
    };
    if (tip === 'hyena') {
      const spread = .58;
      const height = .70;
      shape(dark, [[-spread, -.25], [0, -height], [spread, -.25], [spread, .4], [0, height], [-spread, .4]]);
      shape(basePalette.cavityDeep, [[-spread * .62, -.14], [0, -height * .66], [spread * .62, -.14],
        [spread * .62, .27], [0, height * .65], [-spread * .62, .27]]);
      return;
    }
    const seam = .19;
    shape(basePalette.cavityDeep, [[0, -1.35], [seam, -.50], [seam, .50], [0, 1.5], [-seam, .50], [-seam, -.50]]);
    for (const side of [-1, 1]) {
      shape(dark, [[0, -1.53], [1.45, -1.09], [1.64, -.15], [1.52, .78], [.64, 1.45],
        [.03, 1.62], [seam, .59], [seam, -.53]], side);
      shape(light, [[.43, -1.27], [1.19, -.94], [1.44, -.13], [1.26, .64], [.59, 1.21],
        [1.07, .17], [1.03, -.58]], side);
    }
  }

  function drawSingleShaft(opening, skin, tone, progress, beside, urine, look) {
    if (progress <= 0) return;
    const boundary = beside ? Math.min(75, Math.max(62, 48 + opening.width + 3)) : 0;
    const centerX = beside ? boundary + (look.twin ? 12 : 5) : opening.centerX;
    const anchorY = Math.min(104, opening.centerY + (beside ? 2 : 0));
    const offset = Number(swordOffset.value);
    const length = Math.min(117 - anchorY, 27 + 5 * offset) * progress;
    if (beside && progress > .19) {
      const lip = opening.centerX + opening.width + 1;
      const join = opening.rimThickness ? Math.max(lip, boundary - 3) : Math.max(60, Math.min(lip, centerX - 5));
      const y = opening.centerY;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (progress - .19) / .24);
      polygon(mix(skin, basePalette.cavityDeep, .51), [[join, y - 2], [join + 3, y - 2],
        [centerX + 3, anchorY + 2], [centerX + 5, anchorY + 6], [centerX - 3, anchorY + 7],
        [join, y + 2]]);
      polygon(skin, [[join + 1, y - 1], [join + 3, y - 1], [centerX + 2, anchorY + 3],
        [centerX + 2, anchorY + 5], [centerX - 2, anchorY + 5], [join + 1, y + 1]]);
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(boundary, anchorY - 1, canvas.width - boundary, canvas.height - anchorY + 1);
    ctx.clip();
    drawExternalShaft(anchorY, 0, { ...basePalette, wall: skin, wallLight: tone },
      0, canvas.height, { centerX, length, offset, lean: beside && !look.twin ? 3 : undefined, forkSpan: beside ? 6 : undefined, girthScale: .65 + .35 * progress, look }, urine);
    ctx.restore();
  }

  function drawMammalCloacalRim(profile, opening, skin, shade, tone, thickness) {
    const { centerX: x, centerY: y, width, depth } = opening;
    const lip = mix(skin, tone, .44);
    if (profile === 'marsupial') {
      const span = width + 1;
      const compression = Math.max(0, 1 - depth / 7);
      const contour = [[-1,0],[-.76,-.59],[-.40,-.91],[0,-1],[.40,-.91],[.76,-.59],[1,0],
        [.76,.57],[.40,.89],[0,1],[-.40,.89],[-.76,.57]];
      const layer = (color, horizontal, vertical, shift = 0) => {
        const points = contour.map(([dx, dy]) => [x + dx * horizontal, y + dy * vertical + shift]);
        polygon(color, points);
        return points;
      };
      layer(mix(skin, shade, .78), span + 6 * thickness, depth + 4 * thickness, .5);
      const inner = layer(lip, span + 3 * thickness, depth + 2 * thickness, -.5);
      canalTexture(ctx, lip, inner, .48);
      layer(basePalette.cavityDeep, span, depth);
      const creaseColor = mix(skin, shade, .68);
      for (const side of [-1, 1]) {
        const fold = (color, points) => polygon(color, points.map(([dx, dy]) =>
          [x + side * (span + dx * thickness), y + dy * (depth + thickness)]));
        fold(creaseColor, [[.5,0],[2.6,-.63],[4.2,-.93],[5.6,-.83],[4,-.36],[2.9,.07],[4,.63],[2.5,.60]]);
        fold(mix(skin, lip, .46), [[3,-.51],[4.5,-.69],[5,-.44],[3.8,-.15],[3.1,.12],[2.8,-.12]]);
      }
      if (compression > 0) {
        const shallowCrease = mix(shade, basePalette.cavityDeep, .40 * compression);
        layer(shallowCrease, span * .86, Math.max(.55, depth * .35));
      }
    } else {
      drawBirthRim(opening, mix(shade, skin, .20), lip, y - 20, thickness * .53, ctx, true);
    }
  }

  function drawAlternateAnatomy(layout, geometry, outlet, state, birthOpening, drawDisplacedTissue) {
    const { pregnancy, libidoHeat, descent, stretch, recovery, needs, busy, tubeMode, inletPressure, singleShaft, prolapse, look } = state;
    const { centerX, centerY: outletY } = outlet;
    const tube = layout === 'tube';
    const rimProfile = tube ? 'default' : fields['cloacal-rim'].value;
    const marsupial = rimProfile === 'marsupial';
    const diameter = tubeDiameterScale[fields['tube-diameter'].value];
    const tip = fields['tube-tip'].value;
    const tipScale = tubeTipScale[tip];
    const skin = fields.skin.value;
    const stool = tube ? 0 : needs.stool.bulge;
    const tone = surfaceAccent(skin, mix(mix(fields.tone.value, basePalette.cavity, pregnancy * .07 + recovery * .25),
      basePalette.shine, stool * .15 + .30 * inletPressure), true);
    const skinShadow = surfaceAccent(skin, mix(skin, basePalette.cavityDeep, .58));
    const skinLight = surfaceAccent(skin, mix(skin, basePalette.shine, .24), true);
    const laborSwelling = birthOpening ? birthOpening.width * .023 : descent === 1 ? stretch * .045 : 0;
    const arousalSwelling = tube ? libidoHeat * .22 : 0;
    const swelling = [0, .03, .11, .20][pregnancy] + arousalSwelling + laborSwelling + recovery * .10;
    const [bodyWidth, bodyHeight, taper] = tube ? [1, 1, 0]
      : { oval: [1, 1, 0], slender: [.72, 1.05, 0], broad: [1.24, .84, 0], shield: [1.08, .97, .38] }[fields['outlet-body'].value];
    const bodyScale = Math.min(1.6, (1 + swelling * .65) * bodyWidth);
    const base = (color, points) => polygon(color, points.map(([x, y]) => [
      48 + (x - 48) * bodyScale * (1 - taper * (y - 50) / 60),
      75 + (y - 75) * bodyHeight,
    ]));
    const pressure = busy ? 0 : stool * 2.8 - (tube ? 0 : needs.stool.tighten * 1.2) - needs.urine.tighten * 1.4;
    const openingWidth = Math.max(1, (tube ? 4 * diameter * tipScale + libidoHeat * 1.5 : geometry.width) + stretch + pressure);
    const openingDepth = Math.max(1, (tube ? 3 + libidoHeat : geometry.depth) + Math.round(stretch / 2) + pregnancy * .30 + pressure * .38);
    const rim = 1 + swelling * .32 + .40 * inletPressure + (singleShaft?.idle ? libidoHeat * .37 : 0);

    if (tube) {
      const tubeColor = mix(skin, tone, .13 + libidoHeat * .21);
      const tubeShade = traceAccent(tubeColor, surfaceAccent(tubeColor, mix(tubeColor, basePalette.cavityDeep, .61)));
      const tubeLight = surfaceAccent(tubeColor, mix(tubeColor, basePalette.shine, .27), true);
      const shaftSwelling = pregnancy * .055 + (birthOpening ? birthOpening.width * .043 : descent === 1 ? stretch * .10 : 0);
      const shaft = (color, points) => polygon(color, points.map(([x, y]) => {
        const along = Math.max(0, (y - 33) / 56);
        const tipWeight = Math.max(0, Math.min(1, (along - .62) / .38));
        const midWeight = Math.max(0, 1 - Math.abs(along - .61) / .37);
        const width = diameter * (1 + swelling + shaftSwelling * midWeight + (tipScale - 1) * tipWeight);
        return [48 + (x - 48) * width, y + along * (outletY - 89)];
      }));
      base(skinShadow, [[31, 22], [49, 17], [65, 24], [69, 36], [62, 49], [52, 52], [35, 49], [26, 37]]);
      base(skin, [[32, 25], [47, 20], [63, 27], [64, 35], [58, 41], [48, 43], [35, 40], [29, 33]]);
      const decoration = fields['edge-decoration'].value;
      if (decoration !== 'none') {
        const rootSurface = [[33, 25], [47, 22], [62, 28], [62, 34], [56, 40], [48, 41], [35, 39], [30, 33]]
          .map(([x, y]) => [48 + (x - 48) * bodyScale, y]);
        texturePixels(ctx, rootSurface, decoration, skin, .72);
      }
      if (tubeMode === 'urethral' && scrotumVisible('tube', tubeMode)) {
        drawRootPouch(30, { ...basePalette, wall: skin, wallDark: skinShadow, wallLight: tone },
          1.08 + swelling * .13, Math.min(75, outletY - 8), true);
      } else if (tubeMode === 'dual') {
        base(mix(skin, tubeShade, .50), [[31, 32], [36, 29], [45, 32], [51, 32], [60, 29], [65, 32],
          [62, 42], [54, 48], [42, 48], [35, 44]]);
      }
      const shaftEdge = tip === 'hyena'
        ? [[55, 33], [61, 46], [59, 59], [58, 73], [57, 84], [55, 92], [52, 95]]
        : [[55, 33], [61, 46], [59, 59], [60, 73], [61, 85], [60, 90], [55, 95]];
      shaft(tubeShade, [[48, 32], ...shaftEdge, [48, 96], ...shaftEdge.map(([x, y]) => [96 - x, y]).reverse()]);
      const shaftFace = tip === 'hyena'
        ? [[38, 36], [52, 36], [56, 46], [53, 60], [54, 72], [53, 86], [51, 91], [45, 91], [42, 86], [42, 74], [40, 58], [36, 46]]
        : [[38, 36], [52, 36], [56, 46], [53, 60], [55, 75], [57, 84], [52, 90], [43, 91], [38, 86], [39, 73], [40, 58], [36, 46]];
      shaft(tubeColor, shaftFace);
      shaft(tubeLight, [[41, 40], [46, 38], [44, 57], [44, 75], [42, 83], [40, 78], [41, 57]]);
      const texture = fields['tube-texture'].value;
      if (texture === 'rings' && tip !== 'hyena' && tip !== 'valves' && descent < 2 && libidoHeat < .78) {
        const fold = mix(tubeColor, tubeShade, (.78 - libidoHeat) * .58);
        shaft(fold, [[41, 62], [45, 64], [51, 64], [55, 62], [53, 65], [48, 67], [43, 65]]);
        shaft(fold, [[41, 72], [45, 74], [51, 74], [55, 72], [53, 75], [48, 77], [43, 75]]);
      } else if (texture === 'grooves') {
        const groove = mix(tubeColor, tubeShade, .48);
        shaft(groove, [[45, 43], [47, 45], [46, 59], [47, 73], [46, 84], [44, 81], [44, 61]]);
        shaft(groove, [[51, 46], [53, 49], [52, 61], [53, 77], [51, 84], [50, 81], [50, 63]]);
      } else if (texture === 'veins') {
        const vein = mix(tubeColor, tubeShade, .66 + .16 * libidoHeat);
        shaft(vein, [[45, 82], [47, 72], [44, 65], [45, 60], [49, 54], [50, 46], [52, 43],
          [52, 49], [51, 56], [47, 61], [46, 65], [49, 72], [47, 82]]);
        shaft(vein, [[46, 64], [42, 60], [40, 54], [42, 55], [44, 59], [47, 61]]);
        shaft(vein, [[48, 73], [51, 67], [54, 64], [55, 59], [56, 60], [55, 66], [52, 69], [50, 74]]);
      }
      if (libidoHeat > .45) {
        shaft(mix(tubeLight, basePalette.shine, libidoHeat * .45),
          [[42, 42], [44, 40], [43, 56], [44, 72], [42, 77], [42, 63]]);
      }
      if (tip === 'glans') {
        shaft(tone, [[36, 80], [41, 75], [53, 75], [59, 80], [61, 85], [56, 92], [43, 94], [35, 89]]);
        shaft(tubeLight, [[38, 80], [42, 77], [52, 77], [55, 79], [43, 79], [40, 82]]);
      } else if (tip === 'flared') {
        shaft(tone, [[42, 78], [54, 78], [58, 84], [63, 88], [59, 94], [37, 94], [33, 88], [38, 84]]);
        shaft(tubeLight, [[35, 87], [42, 84], [54, 84], [61, 87], [58, 89], [38, 89]]);
      }
    } else {
      if (marsupial) {
        base(skinShadow, [[36,31],[60,31],[69,39],[75,52],[77,67],[74,84],[66,98],[56,105],
          [40,105],[30,98],[22,84],[19,67],[21,52],[27,39]]);
        base(skin, [[37,34],[59,34],[67,42],[72,53],[74,67],[71,83],[64,96],[55,102],
          [41,102],[32,96],[25,83],[22,67],[24,53],[29,42]]);
        base(mix(skin, skinLight, .64), [[34,42],[42,38],[51,38],[43,42],[36,46],[30,54],[28,59],[29,51]]);
      } else {
        base(skinShadow, [[33, 18], [63, 18], [73, 31], [75, 53], [70, 79], [62, 98], [54, 109], [42, 109], [33, 98], [26, 80], [21, 53], [23, 33]]);
        base(skin, [[35, 21], [61, 21], [70, 36], [72, 53], [67, 78], [60, 96], [53, 105], [43, 105], [35, 94], [29, 77], [24, 53], [27, 36]]);
        base(skinLight, [[34, 28], [38, 26], [33, 52], [36, 68], [31, 63], [30, 50]]);
      }
      const decoration = fields['outlet-decoration'].value;
      drawOutletDecoration(decoration === 'mixed' ? 'scales' : decoration, base, skinLight, mix(skin, skinShadow, .62), libidoHeat);
      const edge = fields['edge-decoration'].value;
      if (edge !== 'none' || decoration === 'mixed') {
        for (const side of [-1, 1]) {
          const edgePoints = marsupial ? [[26,53],[32,43],[38,38],[33,58],[38,93],[31,86]]
            : [[25,49],[28,35],[36,30],[32,57],[38,93],[32,86]];
          const points = edgePoints.map(([x, y]) => [
            48 + side * (48 - x) * bodyScale * (1 - taper * (y - 50) / 60), 75 + (y - 75) * bodyHeight,
          ]);
          texturePixels(ctx, points, decoration === 'mixed' ? 'feathers' : edge, skin, .86);
        }
      }
    }

    const depth = tube ? Math.min(openingDepth, 118 - outletY - 4 * rim)
      : rimProfile === 'monotreme' ? openingDepth * .78 : openingDepth;
    const opening = birthOpening || { width: openingWidth, depth, centerX, centerY: outletY };
    if (birthOpening) drawDisplacedTissue?.();
    if (singleShaft && scrotumVisible('single')) {
      drawRootPouch(opening.centerY - 21, { ...basePalette, wall: skin, wallDark: skinShadow, wallLight: tone }, .62, opening.centerY - 3);
    }
    const rimShade = traceAccent(skin, skinShadow);
    if (tube && tip === 'flower') drawFlowerOutlet(opening, rimShade, tone, rim, libidoHeat);
    else if (tube && (tip === 'valves' || (tip === 'hyena' && !birthOpening))) {
      drawTubeValve(opening, rimShade, tone, rim, tip, Boolean(birthOpening));
    } else if (rimProfile !== 'default') {
      drawMammalCloacalRim(rimProfile, opening, skin, rimShade, tone, rim);
    } else drawBirthRim(opening, rimShade, tone, outletY - 20, rim, ctx, true);
    // 处女膜（1.6.0）：泄殖腔与管状的开口也有（瓣口与花蕊状的管口是闭合的，不画）
    if (!birthOpening && !(tube && (tip === 'valves' || tip === 'flower'))) drawOutletHymen(opening, tone);
    if (singleShaft) drawSingleShaft(opening, skin, tone, singleShaft.progress, prolapse > 0 || Boolean(birthOpening), needs.urine, look);
    if (!birthOpening) drawDisplacedTissue?.();
    if (!tube) drawStoolGas(ctx, needs.stool.gas, centerX + opening.width * .64, opening.centerY + opening.depth * .45, 1.8);
    return opening.centerY + opening.depth;
  }

  const presentingPositions = {
    head: { width: 1, depth: 1, turn: 0, crop: 'head' },
    breech: { width: 1.02, depth: .86, turn: 0, crop: 'hips' },
    oblique: { width: .96, depth: .96, turn: Math.PI / 5, crop: 'head' },
    transverse: { width: 1.14, depth: .69, turn: 0, crop: 'trunk' },
  };

  // Paired profile/rear crops from the late column of fetal-race-pixel/human-six-views-v1.png.
  const humanPresentingCrops = {
    head: { x: 0, upper: true, first: [43, 46] },
    hips: { x: 128, upper: false, first: [40, 44] },
    trunk: { x: 256, upper: false, first: [42, 44] },
  };

  function drawHumanPresenting(mask, width, depth, centerX, centerY, descent, cropName, turn) {
    const angle = fields['presenting-angle'].value;
    const rear = angle === 'rear';
    const crop = humanPresentingCrops[cropName];
    const sourceHeight = descent === 2 ? crop.first[Number(rear)] : 64;
    const sourceY = crop.upper ? 0 : 64 - sourceHeight;
    const span = Math.round(width * (descent === 2 ? 2.42 : 2.16));
    const height = Math.round(depth * (descent === 2 ? 2.68 : 2.40));
    ctx.save();
    ctx.clip(mask);
    ctx.imageSmoothingEnabled = false;
    ctx.translate(centerX, Math.round(centerY));
    if (turn) ctx.rotate(turn);
    ctx.scale(angle === 'right' ? -1 : 1, crop.upper ? -1 : 1);
    ctx.drawImage(humanFetalSheet, crop.x + (rear ? 64 : 0), sourceY, 64, sourceHeight,
      -Math.floor(span / 2), -Math.floor(height / 2), span, height);
    ctx.restore();
  }

  function drawPresenting({ width, depth, centerX, centerY, descent, position }) {
    const { crop, turn } = presentingPositions[position];
    const tilt = fields['presenting-style'].value === 'human' && fields['presenting-angle'].value === 'right' ? -turn : turn;
    const cosine = Math.cos(tilt);
    const sine = Math.sin(tilt);
    const humanSprite = fields['presenting-style'].value === 'human' && humanFetalSheet.naturalWidth > 0;
    const mask = humanSprite ? new Path2D() : null;
    const tileSize = 2;
    const exponent = position === 'transverse' ? 2.7 : 2;
    const tones = ['#100b15', '#1a1322', '#241b2b', '#32263a', '#423347'];
    for (let y = 48; y < 118; y += tileSize) {
      for (let x = 16; x < 80; x += tileSize) {
        const dx = x + tileSize / 2 - centerX;
        const dy = y + tileSize / 2 - centerY;
        const across = (dx * cosine + dy * sine) / width;
        const down = (dy * cosine - dx * sine) / depth;
        const hipNotch = position === 'breech' ? Math.max(0, 1 - Math.abs(across) * 3) * Math.max(0, down - .3) * .29 : 0;
        const radiusSquared = Math.abs(across) ** exponent + Math.abs(down + hipNotch) ** exponent;
        if (radiusSquared > 1) continue;
        // Shade a curved surface with one light from the upper left.
        const normalZ = Math.sqrt(1 - radiusSquared);
        const light = -.52 * across - .57 * down + .64 * normalZ;
        const level = Math.max(0, Math.min(tones.length - 1, Math.floor(light * tones.length)));
        ctx.fillStyle = tones[level];
        ctx.fillRect(x, y, tileSize, tileSize);
        if (mask) mask.rect(x, y, tileSize, tileSize);
      }
    }
    if (mask) drawHumanPresenting(mask, width, depth, centerX, centerY, descent, crop, tilt);
  }

  function drawFlow(effect, elapsed, originY, originX) {
    if (!effect || elapsed === null || elapsed < 0 || (!effect.repeat && elapsed >= effect.duration)) return;
    const floor = canvas.height - 3;
    const startY = Math.min(floor - 2, Math.round(originY));
    const time = effect.repeat ? elapsed % effect.duration : elapsed;
    const fadeFilm = effect.repeat ? 1 : Math.max(0, 1 - time / effect.duration);
    const film = Math.max(1, Math.ceil(effect.film * fadeFilm));
    frontContext.save();
    frontContext.globalAlpha = fadeFilm;
    frontContext.fillStyle = effect.color;
    frontContext.fillRect(originX - Math.floor(film / 2), startY - 1, film, 2);
    if (film >= 4) {
      frontContext.fillRect(originX - Math.floor(film / 2), startY + 1, 2, 2);
      frontContext.fillRect(originX + Math.floor(film / 2) - 2, startY + 1, 2, 3);
    }
    frontContext.fillStyle = effect.highlight;
    frontContext.fillRect(originX - 1, startY, 2, 1);
    if (effect.strand && time < effect.strand) {
      const strandProgress = time / effect.strand;
      const strandLength = Math.min(floor - startY, Math.round(14 * Math.sin(Math.PI * strandProgress)));
      frontContext.fillStyle = effect.color;
      frontContext.fillRect(originX - 1, startY + 1, film >= 5 ? 3 : 1, strandLength);
      frontContext.fillStyle = effect.highlight;
      frontContext.fillRect(originX, startY + 1, 1, Math.round(strandLength * .6));
    }
    frontContext.restore();

    const splashMs = 290;
    for (let index = 0; index < effect.count; index++) {
      const offset = index * effect.interval;
      const age = effect.repeat ? (time + offset) % effect.duration : time - offset;
      if (age < 0 || age >= effect.fall + splashMs) continue;
      const progress = Math.min(1, age / effect.fall);
      const direction = index % 2 === 0 ? 1 : -1;
      const spread = effect.spread * (.72 + (index % 3) * .14);
      const x = originX + direction * Math.round(progress * spread);
      const y = startY + Math.round(progress * (.34 + .66 * progress) * (floor - startY));
      frontContext.fillStyle = effect.color;
      if (age <= effect.fall) {
        const width = effect.strand && index % 3 !== 2 ? 2 : 1;
        frontContext.fillRect(x, y - (width === 2 ? 2 : 1), width, width + 1);
        frontContext.fillStyle = effect.highlight;
        frontContext.fillRect(x, y, 1, 1);
      } else {
        const landing = (age - effect.fall) / splashMs;
        const splash = Math.floor(landing * 3);
        frontContext.save();
        frontContext.globalAlpha = 1 - landing;
        frontContext.fillRect(x - splash, floor, 2 + splash * 2, 1);
        frontContext.restore();
      }
    }
  }

  const prolapseSections = [null, {
    top: 74, tip: 80, bodyOffset: -1, outerEdgeLength: 5,
    wall: [[43, 72], [40, 75], [40, 78], [42, 81], [45, 82], [46, 80], [44, 78], [45, 75]],
    crease: [[42, 75], [41, 77], [42, 79], [44, 80], [44, 79], [43, 77], [43, 75]],
  }, {
    top: 80, tip: 88, bodyOffset: -4, outerEdgeLength: 5,
    wall: [[42, 78], [38, 81], [37, 85], [39, 88], [44, 90], [45, 88], [42, 85], [43, 81]],
    crease: [[40, 81], [38, 85], [40, 87], [43, 89], [44, 88], [41, 86], [40, 84], [41, 81]],
  }, {
    top: 89, tip: 104, outerEdgeLength: 6,
    wall: [[35, 85], [33, 89], [35, 94], [36, 97], [40, 101], [46, 102], [45, 98], [42, 96], [40, 92], [43, 89]],
    crease: [[35, 88], [34, 91], [37, 95], [38, 98], [42, 100], [45, 101], [45, 99], [41, 98], [39, 95], [37, 91]],
  }, {
    top: 90, tip: 111, bodyOffset: 3, outerEdgeLength: 7,
    wall: [[37, 88], [33, 92], [32, 98], [33, 104], [36, 109], [42, 113], [46, 113],
      [45, 108], [41, 105], [39, 100], [40, 94], [44, 90]],
    crease: [[36, 91], [34, 96], [34, 103], [37, 108], [42, 112], [45, 112],
      [43, 109], [39, 106], [37, 102], [36, 97], [38, 93]],
  }];

  const sectionPresets = {
    human: { layout: 'human', title: '人形單宮', note: '一個宮體、一個宮頸與一條陰道。' },
    'human-duplex': { layout: 'human', paired: true, title: '人形雙宮', note: '兩個並排的梨形宮體，各接一個宮頸。下方可切換陰道縱隔。' },
    bicornuate: { layout: 'human', paired: true, title: '獸類雙角子宮', note: '左右子宮角匯入同一宮體，共用一個宮頸。' },
    rabbit: { layout: 'human', paired: true, title: '兔型雙宮', note: '兩條長孕腔各接宮頸，下方共用一條陰道。' },
    marsupial: { layout: 'human', paired: true, title: '袋獸型雙宮', note: '兩個宮頸接向內部匯合處。兩條側陰道環繞中央產道。' },
    bird: { layout: 'single', title: '鳥型殼腺', note: '左側卵巢沿盤曲輸卵管接至殼腺，末端通向泄殖腔。' },
    snake: { layout: 'single', title: '爬蟲型 · 蛇', note: '兩側輸卵管各自通向泄殖腔。右側以一個架空孕腔演示。' },
    shark: { layout: 'single', paired: true, title: '鯊型雙宮', note: '兩側各有輸卵管腺和孕腔，下游通向共同外口。' },
    amorphous: { layout: 'single', title: '可變形宮腔', note: '平時是貼合的膜。孕育時鼓成相通的囊，產程可把靠近外口的囊壁拉成短管。' },
    insect: { layout: 'tube', title: '蟲型孕囊', note: '成束的卵巢管經兩側輸卵管匯入中央，末端接產卵器瓣片。中央孕囊為架空演出。' },
  };

  function selectedSectionReference() {
    const preset = fields['section-preset'].value;
    return preset === 'paired' ? fields['section-variant'].value : preset;
  }

  function prolapseLevel() {
    return fields.prolapse.value === 'off' ? null : Number(fields.prolapse.value);
  }

  function drawSectionDuct(points, radius = 2) {
    for (const [color, width] of [[basePalette.frame, radius * 2 + 1], [basePalette.wall, radius * 2 - 1],
      [basePalette.wallDark, Math.max(1, radius * 2 - 3)]]) {
      sectionContext.fillStyle = color;
      for (let index = 1; index < points.length; index++) {
        const [x, y] = points[index - 1];
        const [nextX, nextY] = points[index];
        const steps = Math.max(1, Math.abs(nextX - x), Math.abs(nextY - y));
        for (let step = 0; step <= steps; step++) {
          sectionContext.fillRect(Math.round(x + (nextX - x) * step / steps) - (width >> 1),
            Math.round(y + (nextY - y) * step / steps) - (width >> 1), width, width);
        }
      }
    }
  }

  function drawFollicle(x, y, radius) {
    polygon(basePalette.wall, [[x - radius, y], [x - radius / 2, y - radius], [x + radius / 2, y - radius],
      [x + radius, y], [x + radius / 2, y + radius], [x - radius / 2, y + radius]], sectionContext);
    sectionContext.fillStyle = basePalette.wallLight;
    sectionContext.fillRect(x - 1, y - Math.max(1, radius - 1), Math.min(3, radius), 1);
  }

  function selectedOvaryShape() {
    // 男孕一律无卵巢，种族预设的卵巢造型不覆盖这条
    if (fields.layout.value === 'anal') return 'none';
    return ovaryShape.value !== 'auto' ? ovaryShape.value : 'compact';
  }

  function selectedOvaryColor(shape) {
    const presets = { 'cluster-right': '#a377b2', crystal: '#9a7ccc', fluid: '#45656c',
      circuit: '#5ad0e0', flame: '#e89c59', ink: '#5f526b', shadow: '#524364', clockwork: '#a98665' };
    return ovaryColors.get(shape) ?? presets[shape] ?? basePalette.wall;
  }

  function drawOvary(shape, x, y, side, heat, color) {
    const outline = mix(mix(color, basePalette.cavityDeep, .56), '#ae4557', heat * .55);
    const tissue = mix(color, '#e17d7a', heat * .36);
    const follicle = mix(mix(color, basePalette.shine, .56), '#ffd079', heat);
    const paint = (color, points) => polygon(color, points.map(([dx, dy]) => [x + side * dx, y + dy]), sectionContext);
    const oval = (color, dx, dy, rx, ry) => paint(color, [[dx - rx, dy], [dx - rx * .65, dy - ry * .7],
      [dx, dy - ry], [dx + rx * .65, dy - ry * .7], [dx + rx, dy], [dx + rx * .65, dy + ry * .7],
      [dx, dy + ry], [dx - rx * .65, dy + ry * .7]]);
    const pixel = (shade, dx, dy, width = 1, height = 1) => {
      sectionPixel(shade, x + side * dx - (side < 0 ? width : 0), y + dy, width, height);
    };
    const egg = (dx, dy, rx, ry = rx) => {
      oval(outline, dx, dy, rx + .6, ry + .6);
      oval(tissue, dx, dy, rx, ry);
      oval(follicle, dx - .55, dy - .55, Math.max(1, rx * .54), Math.max(1, ry * .51));
    };
    switch (shape) {
      case 'compact':
      case 'compact-left':
        egg(0, .5, 4, 5);
        break;
      case 'cluster':
      case 'cluster-right':
        egg(1, 4, 3.1);
        egg(4.2, -1, 3.4);
        egg(-1.8, -4.4, 4.1);
        egg(-3.2, 1.6, 2.55);
        break;
      case 'vestige':
        oval(mix(color, basePalette.background, .64), -1, 1, 2.15, 3);
        oval(mix(color, basePalette.background, .48), -1.25, .15, 1.1, 1.6);
        break;
      case 'sac':
        oval(outline, 0, -1.5, 4.7, 8.7);
        oval(tissue, -.45, -1.8, 3.25, 7);
        for (const [dx, dy] of [[-.6, -6], [.65, -2.4], [-1, 1], [.6, 4.1]]) oval(follicle, dx, dy, 1.32, 1.25);
        break;
      case 'bundle':
        paint(outline, [[-5.5, 1], [5.5, 1], [4, 4], [1, 7], [-1.5, 7], [-4, 4]]);
        for (const [dx, shift] of [[-4, 1], [0, -1], [4, .5]]) {
          oval(tissue, dx, -2 + shift, 1.7, 6);
          for (const dy of [-5, -1, 2.5]) oval(follicle, dx, dy + shift, 1.05, 1.15);
        }
        break;
      case 'buds':
        paint(outline, [[-4, -4], [-2, -5], [0, .5], [3.5, -6], [5, -5], [1.8, 4], [1.8, 7.2],
          [-.2, 7.2], [-.2, 4], [-5, .5], [-5, -1], [-1, 1]]);
        egg(-4.7, -2, 2.35, 3.2);
        egg(-1.8, -7, 2.05, 3.05);
        egg(4.1, -6, 2.65, 3.55);
        break;
      case 'crystal': {
        const facetDark = mix(color, outline, .52);
        const facetLight = mix(color, basePalette.shine, .22 + .25 * heat);
        const glint = mix(color, '#f2e8fc', .38 + .32 * heat);
        paint(outline, [[-8, -6], [-4, -5], [-2, -1], [1, -3], [7, -7], [8, -3],
          [5, 4], [2, 7], [-5, 6], [-7, 3], [-9, -3]]);
        paint(facetDark, [[-8, -5], [-5, -4], [-2, 1], [-2, 5], [-6, 3], [-8, -2]]);
        paint(facetLight, [[-8, -4], [-6, -3], [-4, 1], [-6, 0]]);
        paint(facetDark, [[1, 4], [4, -3], [7, -6], [7, -2], [5, 3], [3, 5]]);
        paint(facetLight, [[4, -2], [7, -6], [6, -2], [4, 2]]);
        paint(outline, [[-4, -4], [0, -11], [4, -6], [4, 1], [1, 6], [-3, 4]]);
        paint(color, [[-3, -4], [0, -10], [0, 5], [-3, 3]]);
        paint(facetDark, [[0, -10], [3, -5], [3, 1], [0, 5]]);
        paint(glint, [[-3, -4], [0, -10], [-1, -5], [-2, 1]]);
        paint(facetLight, [[-2, 2], [0, 4], [-1, 5], [-2, 4]]);
        break;
      }
      case 'fluid': {
        const membrane = mix(tissue, '#76638e', .57);
        const gel = tissue;
        const spark = mix(mix(color, '#e0fff8', .67), follicle, heat);
        paint(membrane, [[-7, -1], [-4, -5], [-1, -5], [3, -7], [7, -4], [7, 0], [4, 3],
          [3, 6], [-1, 7], [-5, 4], [-7, 3]]);
        paint(gel, [[-6, 0], [-3, -4], [1, -4], [3, -5], [5, -3], [5, 0], [2, 2], [2, 5],
          [-1, 5], [-3, 3], [-5, 2]]);
        for (const [dx, dy, r] of [[-3.4, -.9, 1.25], [.2, -2.1, 1.65], [1.25, 2.9, 1.05]]) oval(spark, dx, dy, r, r);
        break;
      }
      case 'circuit': {
        const metal = mix(color, '#c8cbd1', .50);
        const oxide = mix(color, '#28232c', .60);
        const negativeStripe = mix(color, '#ece5d8', .70);
        const charge = mix(color, '#f5dec0', .26 + .53 * heat);
        paint(metal, [[2, 3], [3, 3], [3, 7], [-7, 7], [-7, 6], [2, 6]]);
        paint(metal, [[-3, 3], [-2, 3], [-2, 5], [-11, 5], [-11, 4], [-3, 4]]);
        paint(outline, [[-5, -7], [-3, -9], [3, -9], [5, -7], [5, 3], [3, 5], [-3, 5], [-5, 3]]);
        paint(mix(color, oxide, .38), [[-4, -6], [4, -6], [4, 3], [-4, 3]]);
        paint(metal, [[-4, -6], [-3, -8], [3, -8], [4, -7], [3, -5], [-3, -5]]);
        const vent = mix(oxide, charge, .24 * heat);
        for (let i = 0; i < 4; i++) {
          pixel(vent, -2 + i, -8 + i);
          pixel(vent, 1 - i, -8 + i);
        }
        pixel(negativeStripe, 1, -5, 3, 8);
        for (const y of [-4, -1, 2]) pixel(oxide, 1, y, 2);
        for (let i = 0; i < 3; i++) {
          const bar = heat >= .16 + i * .29 ? charge : mix(color, oxide, .48);
          pixel(bar, -4, 2 - i * 2, 3);
        }
        paint(oxide, [[-5, 3], [5, 3], [3, 5], [-3, 5]]);
        pixel(outline, -3, 4, 6);
        break;
      }
      case 'flame': {
        const flicker = materialPhase % 3 - 1;
        const fire = mix(color, basePalette.shine, .35 + .49 * heat);
        paint(outline, [[-7,2],[-5,-3],[-3,-1],[flicker,-9],[3,-3],[4,-4],[7,0],[6,5],[3,7],[-3,7],[-6,5]]);
        paint(tissue, [[-5,2],[-3,0],[-2,2],[flicker,-6],[3,0],[4,-2],[5,2],[4,5],[0,6],[-4,5]]);
        paint(fire, [[-2,3],[0,-1],[1,2],[3,3],[2,5],[-1,5]]);
        break;
      }
      case 'ink': {
        const stain = mix(color, '#221b2b', .32);
        const reflected = mix(color, basePalette.shine, .16 + .36 * heat);
        // 标准墨滴：上尖下圆一整块，右下一道亮光，旁边溅几颗小墨点；性欲高时边缘渗出淡墨晕
        if (heat > .2) {
          sectionContext.save();
          sectionContext.globalAlpha = .55 * Math.min(1, (heat - .2) / .6);
          paint(mix(color, previewBackground(), .45), [[1,-12],[4,-7],[8,-3],[9,1],[9,5],[6,9],[2,10],
            [-2,10],[-6,9],[-9,5],[-9,1],[-8,-3],[-3,-8]]);
          sectionContext.restore();
        }
        paint(outline, [[1,-10],[3,-6],[6,-2],[7,1],[7,4],[5,7],[2,8],[-2,8],[-5,7],[-7,4],
          [-7,1],[-6,-2],[-2,-6]]);
        paint(stain, [[1,-8],[2,-6],[5,-2],[6,1],[6,4],[4,6],[2,7],[-2,7],[-4,6],[-6,4],
          [-6,1],[-5,-2],[-1,-6]]);
        paint(reflected, [[3,3],[5,1],[5,4],[3,6],[1,6],[1,5]]);
        pixel(outline, -10, 6, 2, 2);
        pixel(outline, 8, -5, 1, 1);
        pixel(outline, 9, 8, 1, 1);
        break;
      }
      case 'shadow': {
        const drift = reducedMotion.matches ? 0 : [0, -1, -2, -1][materialPhase % 4];
        const haze = mix(color, previewBackground(), .43);
        const smoke = (shade, points) => paint(shade, points.map(([dx, dy]) => [dx, dy + drift]));
        sectionContext.save();
        sectionContext.globalAlpha = .69;
        smoke(haze, [[-9,2],[-7,-3],[-4,-3],[-4,-7],[0,-8],[3,-6],[4,-3],[8,-3],[9,1],[7,2],
          [7,6],[2,8],[-1,5],[-4,7],[-8,5]]);
        for (const [dx, dy] of [[-8,-3],[-5,-7],[-1,-9],[3,-8],[7,-5],[8,4],[4,7],[-6,6],[-9,1]]) {
          smoke(color, [[dx,dy],[dx+1,dy],[dx+1,dy+1],[dx,dy+1]]);
        }
        sectionContext.restore();
        smoke(outline, [[-6,2],[-6,-1],[-3,-3],[-2,-5],[2,-5],[4,-2],[6,-1],[6,3],[3,5],[-1,4],[-4,5]]);
        smoke(mix(color, basePalette.shine, .10 + .37 * heat), [[-4,0],[-2,-3],[1,-4],[2,-2],[0,0],[-2,1]]);
        break;
      }
      case 'clockwork': {
        const tick = !reducedMotion.matches && heat >= .42 ? materialPhase : 0;
        const metal = mix(color, '#59616c', .58);
        const edge = mix(metal, '#29303e', .62);
        const rim = mix(edge, '#c2d0d9', .12 + .36 * heat);
        const spoke = mix(metal, '#d0dde7', .19 + .50 * heat);
        const bore = mix(color, '#231f2b', .82);
        const gear = (dx, dy, radius, count, direction) => {
          const rotation = direction * (tick * Math.PI / 12);
          for (let i = 0; i < count; i++) {
            const angle = i * 2 * Math.PI / count + rotation;
            pixel(edge, dx - 1 + Math.round(Math.cos(angle) * radius), dy - 1 + Math.round(Math.sin(angle) * radius), 2, 2);
          }
          oval(edge, dx, dy, radius - .35, radius - .35);
          oval(rim, dx, dy, radius - .85, radius - .85);
          oval(metal, dx, dy, radius - 1.65, radius - 1.65);
          const spokes = count === 8 ? 4 : 3;
          for (let i = 0; i < spokes; i++) {
            const angle = i * 2 * Math.PI / spokes + rotation;
            for (let step = 1; step < radius - .6; step++) {
              pixel(spoke, dx + Math.round(Math.cos(angle) * step), dy + Math.round(Math.sin(angle) * step));
            }
          }
          pixel(bore, dx, dy);
          if (count === 8) pixel(bore, dx - 1, dy - 1, 2, 2);
        };
        gear(5, 4, 3, 6, -1);
        gear(-2, 0, 4, 8, 1);
        break;
      }
    }
  }

  function drawSharedOvaries(pregnancy, level, bodyOffset) {
    const shape = selectedOvaryShape();
    const color = selectedOvaryColor(shape);
    const heat = Math.max(0, (Number(fields.libido.value) / 100 - .27) / .73);
    const [leftX, ovaryY] = [[27, 41], [25, 38], [19, 26], [15, 16]][pregnancy];
    const y = ovaryY + uterusBodyOffsets[Math.min(level, 3)] + bodyOffset;
    const atlasWidths = [0, 2, 3, 3, 3, 4, 3, 3, 3, 2, 0];
    // The baked tubes end at the uterine wall. The left scale stays at x + 3.
    const ductEnds = [[4, 3, 5, 7, 8, 8], [4, 5, 6, 8, 8, 3],
      [4, 3, 6, 9, 9, 3], [4, 4, 7, 9, 10, 10]][pregnancy];
    const vestigialSide = { cluster: 1, 'compact-left': 1, 'cluster-right': -1 }[shape];
    for (const side of [-1, 1]) {
      const vestigial = side === vestigialSide;
      if (shape === 'compact' && heat === 0 && color === basePalette.wall) continue;
      const x = side < 0 ? leftX : 96 - leftX;
      sectionContext.fillStyle = previewBackground();
      atlasWidths.forEach((half, index) => sectionContext.fillRect(x - half, y + index - 5, 2 * half + 1, 1));
      if (shape === 'none' || shape === 'circuit' || vestigial) {
        ductEnds.forEach((end, row) => sectionContext.fillRect(side < 0 ? x + 4 : x - end, y + row, end - 3, 1));
      }
      if (shape !== 'none') drawOvary(vestigial ? 'vestige' : shape, x, y, side, heat, color);
    }
  }

  function coloredUterusAtlas() {
    const color = uterusColor.value;
    const background = previewBackground();
    const transparent = fields.translucent.value === 'on';
    const key = [color, background, uterusShade(basePalette.wall), transparent].join('/');
    if (color === basePalette.wall && background === basePalette.background && fields['uterus-overlay'].value === 'off' && !transparent) return uterusAtlas;
    if (key === lastUterusColor) return tintedUterusAtlas;
    const { naturalWidth: width, naturalHeight: height } = uterusAtlas;
    tintedUterusAtlas.width = width;
    tintedUterusAtlas.height = height;
    const context = tintedUterusAtlas.getContext('2d');
    context.drawImage(uterusAtlas, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const { data } = pixels;
    const colorKey = hex => parseInt(hex.slice(1), 16);
    const frame = colorKey(basePalette.frame);
    const shine = colorKey(basePalette.shine);
    const innerLining = colorKey(uterusShade(basePalette.shine));
    const wall = colorKey(basePalette.wall);
    const shades = new Map([
      [frame, mix(color, basePalette.background, .76)],
      [colorKey(basePalette.wallDark), mix(color, basePalette.background, .42)],
      [colorKey(basePalette.wall), color],
      [colorKey(basePalette.wallLight), mix(color, basePalette.shine, .47)],
      [colorKey(basePalette.cavity), mix(color, basePalette.background, .68)],
      [colorKey(basePalette.cavityDeep), mix(color, basePalette.background, .82)],
    ].map(([key, shade]) => [key, colorKey(uterusShade(shade))]));
    const read = index => (data[index] << 16) | (data[index + 1] << 8) | data[index + 2];
    // The atlas frame color outlines each uterus. Only recolor tissue within that outline.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += sectionContext.canvas.width) {
        const start = (y * width + x) * 4;
        const end = start + (sectionContext.canvas.width - 1) * 4;
        let left = start;
        let right = end;
        while (left <= right && read(left) !== frame) left += 4;
        while (right > left && read(right) !== frame) right -= 4;
        for (let index = left; index <= right; index += 4) {
          const original = read(index);
          const localX = (index - start) / 4;
          let shade = original === shine && localX >= 29 && localX <= 67 ? innerLining : shades.get(original);
          if (shade === undefined) continue;
          if (transparent && original === wall && (index / 4 + y * 2) % 7 === 0) {
            shade = colorKey(mix(uterusShade(color), background, .46));
          }
          data[index] = shade >> 16;
          data[index + 1] = (shade >> 8) & 255;
          data[index + 2] = shade & 255;
        }
      }
    }
    if (background !== basePalette.background) {
      const oldBackground = colorKey(basePalette.background);
      const newBackground = colorKey(background);
      for (let index = 0; index < data.length; index += 4) {
        if (read(index) !== oldBackground) continue;
        data[index] = newBackground >> 16;
        data[index + 1] = (newBackground >> 8) & 255;
        data[index + 2] = newBackground & 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    lastUterusColor = key;
    return tintedUterusAtlas;
  }

  const uterusMaskCache = new Map();
  const uterusCell = Object.assign(document.createElement('canvas'), { width: 96, height: 120 }).getContext('2d', { willReadFrequently: true });
  let sourceUterusPixels;
  let uterusCellKey;

  function uterusAnatomyMask(pregnancy, column) {
    const key = pregnancy * 4 + column;
    if (uterusMaskCache.has(key)) return uterusMaskCache.get(key);
    if (!sourceUterusPixels) {
      const original = Object.assign(document.createElement('canvas'), {
        width: uterusAtlas.naturalWidth, height: uterusAtlas.naturalHeight,
      }).getContext('2d');
      original.drawImage(uterusAtlas, 0, 0);
      sourceUterusPixels = original.getImageData(0, 0, original.canvas.width, original.canvas.height);
    }
    const { data, width } = sourceUterusPixels;
    const mask = new Uint8Array(96 * 120);
    const hex = name => parseInt(basePalette[name].slice(1), 16);
    const frame = hex('frame'), cavity = hex('cavity'), deep = hex('cavityDeep');
    const lining = new Set([hex('wallLight'), hex('shine'), cavity]);
    const muscle = new Set([frame, hex('wall'), hex('wallDark')]);
    const [fetalX, fetalY, fetalWidth, fetalHeight] = inletFetusTiles[pregnancy - 1]?.baked ?? [0, 0, 0, 0];
    const shift = uterusBodyOffsets[column];
    const read = (x, y) => {
      const index = ((pregnancy * 120 + y) * width + column * 96 + x) * 4;
      return (data[index] << 16) | (data[index + 1] << 8) | data[index + 2];
    };
    for (let y = shift; y < 70 + shift; y++) {
      const row = y - shift;
      let left = 17;
      let right = 79;
      while (left <= right && read(left, y) !== frame) left++;
      while (right > left && read(right, y) !== frame) right--;
      if (row >= 64) {
        left = Math.min(left, 41);
        right = Math.max(right, 54);
      }
      let innerLeft = left;
      let innerRight = right;
      while (innerLeft <= right && read(innerLeft, y) !== deep) innerLeft++;
      while (innerRight > innerLeft && read(innerRight, y) !== deep) innerRight--;
      for (let x = left; x <= right; x++) {
        if (x >= fetalX && x < fetalX + fetalWidth && row >= fetalY && row < fetalY + fetalHeight) continue;
        const color = read(x, y);
        if (x >= innerLeft && x <= innerRight) {
          // Only expose the back surface of an empty chamber. Pregnant cells carry fluid and fetal art.
          if (pregnancy === 0 && color === deep) mask[y * 96 + x] = 4;
          continue;
        }
        if (!muscle.has(color) && !lining.has(color)) continue;
        mask[y * 96 + x] = row >= 64 && x >= 40 && x <= 55 ? 3 : lining.has(color) ? 2 : 1;
      }
    }
    uterusMaskCache.set(key, mask);
    return mask;
  }

  function drawTexturedUterus(pregnancy, column, offset) {
    const source = coloredUterusAtlas();
    const material = fields['canal-material'].value;
    const tile = tissueTiles[material];
    const shift = movingMaterials.has(material) ? materialPhase % 6 : 0;
    const light = fields['material-light'].value;
    const heat = Math.round(materialHeat * 8) / 8;
    const transparent = fields.translucent.value === 'on';
    const key = [pregnancy, column, material, shift, light, heat, source === uterusAtlas ? 'base' : lastUterusColor].join('/');
    if (key !== uterusCellKey) {
      uterusCell.clearRect(0, 0, 96, 120);
      uterusCell.drawImage(source, column * 96, pregnancy * 120, 96, 120, 0, 0, 96, 120);
      if (tile) {
        const pixels = uterusCell.getImageData(0, 0, 96, 120);
        const mask = uterusAnatomyMask(pregnancy, column);
        const { data } = pixels;
        const palettes = new Map();
        const strength = [0, pregnancy === 3 ? .56 : .70, .45, .90, .38];
        for (let index = 0; index < mask.length; index++) {
          const region = mask[index];
          if (!region) continue;
          const x = index % 96, y = Math.floor(index / 96);
          const stationary = region === 2 || region === 4;
          const shade = tileShade(tile, x, y, stationary ? 0 : shift);
          const dither = transparent && !stationary && (x + y * 2) % 7 === 0;
          if (!shade && !dither) continue;
          const pos = index * 4;
          const rgb = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          const paletteKey = rgb * strength.length + region;
          if (!palettes.has(paletteKey)) {
            const color = '#' + rgb.toString(16).padStart(6, '0');
            const colors = materialShades(color, light, strength[region], stationary ? 0 : heat);
            colors.push(mix(color, previewBackground(), .43));
            palettes.set(paletteKey, colors.map(value => value && parseInt(value.slice(1), 16)));
          }
          const tone = palettes.get(paletteKey)[dither ? 4 : shade];
          data[pos] = tone >> 16;
          data[pos + 1] = (tone >> 8) & 255;
          data[pos + 2] = tone & 255;
        }
        uterusCell.putImageData(pixels, 0, 0);
      }
      uterusCellKey = key;
    }
    sectionContext.drawImage(uterusCell.canvas, 0, offset);
  }

  const chamberOutlines = {
    pear: [[-.4, 0], [.4, 0], [.79, .12], [1, .30], [.88, .56], [.62, .76], [.36, .89], [.28, 1],
      [-.28, 1], [-.36, .89], [-.62, .76], [-.88, .56], [-1, .30], [-.79, .12]],
    horn: [[-.52, 0], [.23, .04], [.74, .13], [1, .36], [.88, .62], [.60, .77], [.47, .92], [.21, 1],
      [-.24, .94], [-.42, .81], [-.75, .68], [-.96, .43], [-1, .25], [-.82, .08]],
    long: [[-.34, 0], [.34, 0], [.77, .13], [1, .33], [.89, .63], [.64, .82], [.40, .93], [.31, 1],
      [-.31, 1], [-.40, .93], [-.64, .82], [-.89, .63], [-1, .33], [-.77, .13]],
    pouch: [[-.32, 0], [.27, .04], [.58, .12], [.84, .27], [1, .48], [.94, .68], [.68, .87],
      [.31, .98], [-.12, 1], [-.56, .88], [-.86, .68], [-1, .42], [-.86, .19], [-.62, .07]],
  };

  function drawSectionChamber(outline, x, bottom, radius, height, facing = 1) {
    let cavity;
    for (const [color, inset] of [[basePalette.frame, -1], [basePalette.wall, 0],
      [basePalette.wallLight, 1], [basePalette.cavityDeep, 2]]) {
      cavity = polygon(color, outline.map(([offset, y]) => [
        x + facing * offset * (radius - inset), bottom - height + inset + y * (height - 2 * inset),
      ]), sectionContext);
    }
    return cavity;
  }

  function drawChamberFetus(cavity, x, y, size, pregnancy, horizontal) {
    if (pregnancy === 0 || !fetalAtlas.complete || !fetalAtlas.naturalWidth) return;
    sectionContext.save();
    sectionContext.clip(cavity);
    sectionContext.imageSmoothingEnabled = false;
    sectionContext.drawImage(fetalAtlas, (pregnancy - 1) * 36, horizontal ? 36 : 0, 36, 36,
      Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    sectionContext.restore();
  }

  const pairedChambers = {
    'human-duplex': { shape: 'pear', leftX: 30, bottom: 66, width: 9, height: 28 },
    bicornuate: { shape: 'horn', leftX: 26, bottom: 62, width: 9, height: 26 },
    rabbit: { shape: 'long', leftX: 25, bottom: 70, width: 6, height: 36 },
    marsupial: { shape: 'pear', leftX: 27, bottom: 57, width: 8, height: 25 },
    shark: { shape: 'long', leftX: 26, bottom: 73, width: 7, height: 39 },
  };

  function drawPairedSection(reference, pregnancy, fill) {
    const { shape, leftX, bottom, width, height } = pairedChambers[reference];
    if (reference === 'bicornuate') {
      drawSectionDuct([[leftX, bottom - 3], [34, 64], [48, 73], [62, 64], [96 - leftX, bottom - 3]], 4);
      drawSectionDuct([[48, 72], [48, 84]], 4);
      drawSectionDuct([[48, 84], [48, 104]], 3);
    } else if (reference === 'shark') {
      for (const x of [leftX, 96 - leftX]) {
        drawSectionDuct([[x, bottom - 3], [x, 77], [48 + Math.sign(x - 48) * 9, 88], [48, 94]], 3);
      }
      polygon(basePalette.wall, [[27, 89], [69, 89], [64, 96], [53, 100], [51, 104], [45, 104], [43, 100], [32, 96]], sectionContext);
      polygon(basePalette.cavityDeep, [[31, 91], [65, 91], [60, 95], [51, 98], [50, 102], [46, 102],
        [45, 98], [36, 95]], sectionContext);
    } else if (reference === 'marsupial') {
      drawSectionDuct([[leftX, bottom - 2], [35, 65], [61, 65], [96 - leftX, bottom - 2]], 3);
      for (const side of [-1, 1]) {
        drawSectionDuct([[48 + side * 11, 65], [48 + side * 25, 71], [48 + side * 27, 84],
          [48 + side * 20, 94], [48 + side * 7, 100], [48, 104]]);
      }
      drawSectionDuct([[48, 65], [48, 79], [48, 91], [48, 104]], 4);
    } else {
      const joint = reference === 'rabbit' ? 88 : 83;
      for (const x of [leftX, 96 - leftX]) {
        const side = Math.sign(x - 48);
        drawSectionDuct([[x, bottom - 3], [48 + side * 13, bottom + 5], [48 + side * 8, joint - 6],
          [48 + side * 4, joint]], 3);
      }
      drawSectionDuct([[48, joint - 2], [48, 104]], 5);
      if (reference === 'human-duplex' && fields['vaginal-septum'].value === 'on') {
        sectionPixel(basePalette.wallLight, 47, joint + 1, 2, 20);
      }
    }

    for (const [side, x] of [[-1, leftX], [1, 96 - leftX]]) {
      const stage = fill === 'both' || fill === (side === -1 ? 'left' : 'right') ? pregnancy : 0;
      const growth = stage * (fill === 'both' && side === 1 ? .65 : 1);
      const radius = width + growth * 2;
      const chamberHeight = height + Math.round(growth * 5);
      const top = bottom - chamberHeight;
      if (reference === 'shark') {
        const glandY = Math.max(10, top - 6);
        drawSectionDuct([[x + side * 6, 10], [x, glandY], [x, top + 3]]);
        drawFollicle(x + side * 6, 10, 3);
        drawFollicle(x, glandY, 5);
        sectionPixel(basePalette.wallLight, x - 2, glandY - 1, 4);
      } else {
        const ovaryX = x + side * 15;
        const ovaryY = Math.max(9, top - 3);
        drawSectionDuct([[ovaryX, ovaryY], [x + side * 9, ovaryY - 4], [x, top + 4]]);
        drawFollicle(ovaryX, ovaryY, 4);
      }
      const cavity = drawSectionChamber(chamberOutlines[shape], x, bottom, radius, chamberHeight, side);
      drawChamberFetus(cavity, x, top + chamberHeight * .46, 12 + Math.round(growth * 7), stage, shape === 'horn');
    }
  }

  function drawAmorphousSection(pregnancy, stretch, descent, push) {
    const bottom = 80;
    const mouth = 91 + (descent ? 3 + descent * 3 + Math.round(push * 4) : 0);
    const opening = descent ? 3 + descent + Math.round(push * 2) : 1 + Math.round(stretch * .35);
    polygon(basePalette.wall, [[43, 75], [53, 75], [48 + opening + 3, mouth], [48 - opening - 3, mouth]], sectionContext);
    polygon(basePalette.cavityDeep, [[46, 78], [50, 78], [48 + opening, mouth], [48 - opening, mouth]], sectionContext);
    sectionPixel(basePalette.wallLight, 48 - opening - 2, mouth, opening * 2 + 4);
    if (pregnancy === 0) {
      drawSectionDuct([[39, 41], [44, 50], [43, 60], [47, 69], [48, 81]]);
      drawSectionDuct([[57, 41], [52, 50], [53, 60], [49, 69], [48, 81]]);
      sectionPixel(basePalette.cavityDeep, 47, 50, 2, 23);
      return;
    }

    const radius = [0, 14, 22, 29][pregnancy] + Math.round(push * 2);
    const height = [0, 31, 43, 55][pregnancy];
    const cavity = drawSectionChamber(chamberOutlines.pouch, 48, bottom, radius, height);
    sectionContext.save();
    sectionContext.clip(cavity);
    if (pregnancy >= 2) {
      const fold = bottom - Math.round(height * .57);
      polygon(basePalette.wallDark, [[48 - radius, fold - 2], [39, fold - 1], [43, fold + 3],
        [35, fold + 3], [48 - radius, fold + 6]], sectionContext);
      polygon(basePalette.wall, [[48 + radius, fold + 6], [59, fold + 7], [55, fold + 11],
        [64, fold + 11], [48 + radius, fold + 14]], sectionContext);
    }
    sectionContext.restore();
    drawChamberFetus(cavity, 49, bottom - height * .55 + (descent ? Math.round(push * 4) : 0),
      16 + pregnancy * 6, pregnancy, true);
  }

  function drawPregnancyVessel(reference, pregnancy, level, joint) {
    const tube = reference === 'insect';
    const bird = reference === 'bird';
    const bottom = 65 + [0, 9, 18, 23][level];
    const centerX = tube ? 48 : bird ? 39 : 66;
    const halfWidth = (tube ? [8, 10, 13, 16] : bird ? [7, 10, 14, 17] : [5, 8, 11, 14])[pregnancy];
    const height = (tube ? [18, 26, 37, 52] : bird ? [14, 20, 27, 34] : [17, 25, 34, 44])[pregnancy];
    const top = bottom - height;
    const rim = basePalette.wall;
    const lining = basePalette.wallLight;
    const fluid = basePalette.cavityDeep;
    const outline = bird
      ? [[-.25, 0], [.22, 0], [.67, .09], [.92, .28], [1, .56], [.81, .76], [.42, .88], [.28, 1], [-.18, 1], [-.55, .88], [-.91, .69], [-1, .49], [-.84, .24], [-.57, .08]]
      : [[-.42, 0], [.42, 0], [.77, .08], [1, .26], [.88, .61], [.67, .77], [.47, .88], [.32, 1], [-.32, 1], [-.49, .88], [-.67, .77], [-.9, .61], [-1, .26], [-.77, .08]];
    const layer = (color, inset) => polygon(color, outline.map(([x, y]) => [
      centerX + x * (halfWidth - inset), top + inset + y * (height - inset * 2),
    ]), sectionContext);

    sectionContext.fillStyle = previewBackground();
    sectionContext.fillRect(0, 0, 96, 120);
    if (tube) {
      const rootY = top + Math.min(19, height - 7);
      for (const side of [-1, 1]) {
        const rootX = 48 + side * 23;
        drawSectionDuct([[rootX, rootY], [rootX, rootY + 5], [rootX - side * 7, rootY + 10],
          [48, Math.min(rootY + 13, bottom - 2)]]);
        for (const offset of [-8, 0, 8]) {
          const x = rootX + offset;
          drawSectionDuct([[x, rootY - 15], [x, rootY - 7], [rootX, rootY]]);
          drawFollicle(x, rootY - 15, 2);
          drawFollicle(x, rootY - 10, 3);
          drawFollicle(x, rootY - 5, 2);
        }
      }
    } else if (bird) {
      const funnel = Math.max(15, top - 24);
      drawSectionDuct([[27, funnel], [18, funnel + 2], [12, funnel + 8], [13, funnel + 13],
        [24, funnel + 15], [25, funnel + 20], [14, funnel + 23], [13, funnel + 28],
        [20, funnel + 32], [centerX, top + Math.round(height / 2)]]);
      for (const [x, y, size] of [[31, -3, 4], [37, -8, 5], [38, 2, 3], [45, -4, 4], [45, 5, 2]]) {
        drawFollicle(x, funnel + y, size);
      }
    } else {
      drawSectionDuct([[26, top - 7], [20, top + 4], [20, joint - 18], [27, joint - 8], [43, joint + 3]]);
      drawSectionDuct([[69, top - 14], [72, top - 7], [centerX, top + 3]]);
      for (const [x, y] of [[23, top - 10], [26, top - 5], [26, top], [68, top - 17], [73, top - 13], [73, top - 8]]) {
        drawFollicle(x, y, 3);
      }
    }
    drawSectionDuct([[centerX, bottom - 5], [centerX, bottom], [tube ? 48 : bird ? 43 : 56, joint - 2],
      [bird || tube ? 48 : 53, joint + 3]]);
    layer(basePalette.frame, -2);
    layer(rim, 0);
    layer(lining, 2);
    const cavity = layer(fluid, 4);
    if (bird && pregnancy > 0) {
      const y = top + Math.round(height * .48);
      const radius = [0, 4, 6, 8][pregnancy];
      polygon(basePalette.shine, [[centerX - radius * .5, y - radius], [centerX + radius * .5, y - radius],
        [centerX + radius, y + radius * .3], [centerX + radius * .7, y + radius], [centerX - radius * .7, y + radius],
        [centerX - radius, y + radius * .3]], sectionContext);
      sectionContext.fillStyle = basePalette.lining;
      sectionContext.fillRect(centerX - Math.floor(radius / 2), y + radius - 1, radius, 1);
    } else if (pregnancy > 0 && fetalAtlas.complete && fetalAtlas.naturalWidth) {
      const fetalY = Math.round(top + height * (tube ? .42 : .44));
      sectionContext.save();
      sectionContext.clip(cavity);
      sectionContext.drawImage(fetalAtlas, (pregnancy - 1) * 36, 0, 36, 36, centerX - 18, fetalY - 18, 36, 36);
      sectionContext.restore();
    }
  }

  const inletFetusTiles = [
    // Original fetal pixels and the lateral sprite crop in each pregnancy row.
    { baked: [46, 52, 5, 6], sprite: [14, 16, 7, 6], transverse: [12, 8], twin: [8, 6], bottom: 58 },
    { baked: [42, 40, 12, 13], sprite: [11, 12, 15, 13], transverse: [22, 15], twin: [12, 11], bottom: 55 },
    { baked: [37, 27, 22, 25], sprite: [8, 9, 21, 18], transverse: [30, 20], twin: [18, 16], bottom: 57 },
  ];

  function drawInletFetuses(condition, pregnancy, bodyY, push) {
    const tile = inletFetusTiles[pregnancy - 1];
    if (!tile || !fetalAtlas.complete || !fetalAtlas.naturalWidth) return;
    const [bakedX, bakedY, bakedWidth, bakedHeight] = tile.baked;
    // The baked figure occupies a patch of fluid inside the uterine atlas.
    const fluid = uterusShade(uterusColor.value === basePalette.wall ? basePalette.cavityDeep
      : mix(uterusColor.value, basePalette.background, .82));
    sectionPixel(pregnancy === 1 ? fluid : '#804769', bakedX, bodyY + bakedY, bakedWidth, bakedHeight);
    const [spriteX, spriteY, spriteWidth, spriteHeight] = tile.sprite;
    const bottom = tile.bottom + bodyY;
    const tension = Math.round(push);
    const fetus = (x, y, width, height, { flipped = false, inShadow = false } = {}) => {
      sectionContext.save();
      sectionContext.imageSmoothingEnabled = false;
      if (inShadow) sectionContext.filter = 'brightness(.82) saturate(1.16)';
      sectionContext.translate(x, y);
      if (flipped) sectionContext.scale(-1, 1);
      sectionContext.drawImage(fetalAtlas, (pregnancy - 1) * 36 + spriteX, 36 + spriteY, spriteWidth, spriteHeight,
        -Math.floor(width / 2), -height, width, height);
      sectionContext.restore();
    };
    if (condition === 'transverse') {
      fetus(48, bottom + tension, ...tile.transverse);
    } else {
      const [width, height] = tile.twin;
      // The opposing heads meet in the middle, ahead of both bodies.
      const separation = Math.floor(width / 2);
      fetus(48 - separation, bottom - 4 + tension, width, height, { flipped: true });
      fetus(48 + separation - 1, bottom, width, height, { inShadow: true });
    }
  }

  function drawSectionLock(outlet, shaft, look) {
    const release = look.release ?? 0;
    const force = look.phase === 'pull' ? Math.sin(Math.PI * release) : 0;
    const extent = 1 - release;
    const y = Math.min(116, outlet - 3 + Math.round(5 * force));
    const width = Math.max(3, shaft.half + 3);
    const dark = mix(basePalette.cavityDeep, '#0b0710', .65);
    if (look.knot) {
      const radius = Math.max(1, Math.round(width * extent));
      const depth = Math.max(1, Math.round(5 * extent));
      for (let dy = -depth; dy <= depth; dy++) {
        const row = Math.round(radius * Math.sqrt(1 - (dy / depth) ** 2));
        sectionPixel(dy < -depth + 2 ? basePalette.shine : dark, shaft.cx - row, y + dy, row * 2 + 1);
      }
    } else {
      const squeeze = Math.max(2, Math.round(width * (.7 + release * .3)));
      sectionPixel(basePalette.shine, shaft.cx - squeeze, y, 1, 2);
      sectionPixel(basePalette.shine, shaft.cx + squeeze, y, 1, 2);
      sectionPixel(basePalette.shine, shaft.cx - squeeze + 1, y - 1, squeeze * 2 - 1);
      sectionPixel(basePalette.wallLight, shaft.cx - squeeze + 1, y + 2, squeeze * 2 - 1);
    }
    if (force > 0) {
      polygon(basePalette.wallDark, [[shaft.cx - width - 1,y-2],[shaft.cx - width,y+4],[shaft.cx-2,y+5],
        [shaft.cx-2,y+2],[shaft.cx-width+1,y]], sectionContext);
      polygon(basePalette.wallLight, [[shaft.cx + width + 1,y-2],[shaft.cx + width,y+4],[shaft.cx+2,y+5],
        [shaft.cx+2,y+2],[shaft.cx+width-1,y]], sectionContext);
    }
  }

  function drawSingleSidePouch(outlet, progress, twin) {
    const color = fields.skin.value;
    const shadow = mix(color, basePalette.cavityDeep, .70);
    const lining = mix(color, basePalette.shine, .24);
    const pouch = (shade, points) => polygon(shade, points.map(([x, y]) => [x, outlet + y]), sectionContext);
    pouch(shadow, [[52,0],[55,-4],[60,-8],[63,-18],[68,-20],[74,-19],[78,-14],[77,-9],[72,-6],[67,-6],[60,-2]]);
    pouch(lining, [[53,-1],[59,-5],[62,-8],[65,-17],[69,-18],[73,-17],[76,-14],[75,-11],[71,-9],[66,-8],[63,-5]]);
    pouch(basePalette.cavityDeep, [[63,-8],[66,-16],[70,-17],[74,-15],[74,-12],[71,-10],[67,-9]]);
    if (progress < .65) {
      const fold = mix(shadow, lining, .27 + (1 - progress) * .21);
      pouch(fold, [[66,-12],[68,-15],[72,-15],[73,-13],[71,-12],[69,-13],[67,-10]]);
      if (twin) pouch(fold, [[67,-10],[69,-12],[72,-12],[72,-11],[70,-11],[68,-9]]);
    }
  }

  function drawProlapseSection(level, pregnancy, stretch, layout, geometry, descent, weightScale, push, fit, reference, condition, singleShaft, sex) {
    const shape = prolapseSections[level];
    const human = layout === 'human';
    const top = shape?.top ?? 69;
    const outlet = Math.max(91, shape?.tip ?? 91);
    const release = sex?.look.release;
    const showLock = sex && (sex.look.locked || (release !== null && release < 1));
    const enlarged = sex?.shared ? { ...fit, width: fit.width + 4 } : fit;
    const shaft = human && descent === 0 && (fit.active || showLock)
      ? trackerShaftPose(showLock ? { ...enlarged, elapsed: 450 } : enlarged, top, outlet, level) : null;
    if (shaft && showLock && release !== null) {
      const retract = sex.look.phase === 'pull' ? release : Math.max(0, (release - .40) / .60);
      const movement = Math.round((outlet - shaft.headY + 8) * retract);
      shaft.headY += movement;
      shaft.shaftBottom = Math.min(120, shaft.shaftBottom + movement);
    }
    if (human) {
      if (!uterusAtlas.complete || !uterusAtlas.naturalWidth) return;
      // Stage IV reuses the uterine body and draws the fully everted walls below it.
      const bodyOffset = shape?.bodyOffset ?? 0;
      sectionContext.fillStyle = previewBackground();
      sectionContext.fillRect(0, 0, 96, 120);
      drawTexturedUterus(pregnancy, Math.min(level, 3), bodyOffset);
      if (blocksPelvicInlet(condition)) {
        drawInletFetuses(condition, pregnancy, uterusBodyOffsets[Math.min(level, 3)] + bodyOffset, push);
      }
      drawSharedOvaries(pregnancy, level, bodyOffset);
      sectionContext.fillStyle = previewBackground();
      if (bodyOffset > 0) sectionContext.fillRect(0, 91, 96, 29);
      // Clear the old canal equally on both sides of the x = 48 axis.
      sectionContext.fillRect(31, top, 34, 112 - top);
    } else {
      drawPregnancyVessel(reference, pregnancy, level, top);
    }
    const middle = (top + 91) / 2;
    const tube = layout === 'tube';
    const outletShiftY = tube ? 7 : 0;
    const outletHalfWidth = layout === 'single' ? Math.max(4, geometry.width) : tube ? 5 : 6;
    const lowerWidth = outletHalfWidth + stretch;
    const upperWidth = shape ? 7 : 4;
    const project = ([x, y]) => {
      const distance = Math.min(1, Math.max(0, (y - top) / (91 - top)));
      return [x, y + outletShiftY * distance];
    };
    const sectionShape = (color, points, strength = 1) => {
      const surface = points.map(project);
      const shade = uterusShade(color);
      polygon(shade, surface, sectionContext);
      if (color === basePalette.wall || color === basePalette.wallDark || color === basePalette.wallLight) {
        canalTexture(sectionContext, shade, surface, strength);
      }
    };
    const flare = descent > 0 ? Math.round(stretch * .55) : fit.flare;
    if (human) {
      drawTrackerCanal(top, 91, flare);
    } else {
      const channelRows = [[top - 2, upperWidth], [middle, (upperWidth + lowerWidth) / 2]];
      if (!tube) channelRows.push([(middle + 91) / 2, lowerWidth + (level === 3 ? 7 : 4)]);
      channelRows.push([91, lowerWidth]);
      const channelEdge = (side, padding) => channelRows.map(([y, radius]) => [48 + side * (radius + padding), y]);
      const channelOutline = padding => [...channelEdge(1, padding), ...channelEdge(-1, padding).reverse()];
      sectionShape(basePalette.frame, channelOutline(4));
      sectionShape(basePalette.wallDark, channelOutline(2));
      drawSectionLumen(channelOutline(0).map(project));
      for (const side of [-1, 1]) {
        const wall = [...channelEdge(side, 2), ...channelEdge(side, 3).reverse()];
        sectionShape(basePalette.wallLight, wall);
        if (tube) {
          sectionShape(basePalette.wallDark, [[48 + side * (lowerWidth + 3), 84],
            [48 + side * (lowerWidth + 6), 88], [48 + side * (lowerWidth + 4), 96],
            [48 + side * (lowerWidth + 1), 92]]);
          sectionShape(basePalette.wallLight, [[48 + side * (lowerWidth + 3), 88],
            [48 + side * (lowerWidth + 4), 91], [48 + side * (lowerWidth + 3), 95],
            [48 + side * (lowerWidth + 2), 91]]);
        }
      }
    }
    if (shape) {
      const { tip, wall, crease, outerEdgeLength } = shape;
      const reflect = (points, side) => points.map(([x, y]) => {
        const flare = Math.max(0, 1 - Math.abs(91 - y) / 14) * (stretch + outletHalfWidth - 6);
        return [48 + (48 - x + flare) * side, y];
      });
      // Join both folds to the central tissue throughout the animation.
      const edge = wall.slice(0, outerEdgeLength);
      sectionShape(basePalette.wallDark, [
        ...reflect(edge, -1), [48, Math.max(tip, edge.at(-1)[1] - 1)], ...reflect(edge, 1).reverse(),
      ]);
      for (const side of [-1, 1]) {
        sectionShape(basePalette.wallDark, reflect(wall, side));
        sectionShape(basePalette.wallLight, reflect(crease, side));
      }
      sectionShape(basePalette.wallDark, [[42, top - 2], [54, top - 2], [54, tip - 3], [51, tip], [45, tip], [42, tip - 3]], .9);
      sectionShape(basePalette.wall, [[44, top - 1], [52, top - 1], [53, tip - 3], [52, tip - 2],
        [50, tip - 1], [46, tip - 1], [44, tip - 2], [43, tip - 3]], .9);
      // Show the lumen around the incoming shaft while leaving the adjacent tissue solid.
      const entering = shaft && !(fit.direction > 0 && fit.tier === 4);
      const gap = descent > 0 ? 2 + stretch * .65 : entering ? Math.max(3, shaft.half + .5) : 1.5 + stretch * .42;
      const narrow = descent > 0 || entering ? gap * .65 : 1;
      const restingGapTop = Math.max(top - 2, tip - (level === 1 ? 5 : 3));
      const gapTop = descent > 0 ? top - 2 : entering ? Math.min(restingGapTop, shaft.headY - 1) : restingGapTop;
      drawSectionLumen([[48 - narrow, gapTop], [48 + narrow, gapTop],
        [48 + gap, outlet], [48 - gap, outlet]].map(project));
      if (fields['vaginal-septum'].value === 'on') {
        sectionShape(basePalette.wallDark, [[47, top - 1], [49, top - 1], [49, tip - 1], [47, tip - 1]], .9);
      }
      if (human && tip < 91) drawTrackerCanal(tip, 91, flare);
    }
    if (singleShaft) drawSingleSidePouch(outlet, singleShaft.progress, fields.swordTwin.value === 'on');
    if (blocksPelvicInlet(condition)) {
      sectionContext.fillStyle = '#edbd80';
      for (const x of [40, 53]) sectionContext.fillRect(x, top - 1, 3, 1);
    } else if (descent > 0) {
      const markerPush = condition === 'shoulder_dystocia' ? 0 : push;
      const y = Math.round((descent === 1 ? top + 3 : descent === 2 ? outlet : outlet + 4) + markerPush * 3);
      const width = Math.round(3 + 2 * weightScale + 2 * markerPush);
      const position = selectedPresentingPosition(condition);
      const profile = {
        head: [[-1, 1], [-1, -1], [-.5, -2], [.5, -2], [1, -1], [1, 1], [.5, 0], [-.5, 0]],
        breech: [[-1, 0], [-.65, -2], [.65, -2], [1, 0], [.6, 2], [.22, 2], [0, 1], [-.22, 2], [-.6, 2]],
        oblique: [[-1, -3], [-.5, -4], [1, 1], [.78, 3], [.33, 3], [-1, -1]],
        transverse: [[-1.25, -1], [-.85, -2], [.85, -2], [1.25, -1], [1.25, 1], [-1.25, 1]],
      }[position];
      sectionShape('#cf9ec7', profile.map(([x, dy]) => [48 + x * width, y + dy]));
    } else if (shaft) {
      if (fit.direction > 0 && fit.tier === 4) drawSectionEntrance(outlet);
      drawTrackerShaft(shaft);
      if (showLock) drawSectionLock(outlet, shaft, sex.look);
    }
    sectionContext.fillStyle = '#d5a477';
    sectionContext.fillRect(26, 91 + outletShiftY, 6, 1);
    sectionContext.fillRect(64, 91 + outletShiftY, 6, 1);
  }

  function drawSectionPreset(reference, pregnancy, { stretch, descent, push }) {
    const preset = sectionPresets[reference];
    if (reference === 'human' || reference === 'insect' || reference === 'bird' || reference === 'snake') {
      const geometry = birthOutletGeometry[reference === 'insect' ? 'tube' : reference === 'human' ? 'human' : 'round'];
      drawProlapseSection(0, pregnancy, 0, preset.layout, geometry, 0, 0, 0, sectionFit(Infinity, 0), reference);
    } else {
      sectionPixel(previewBackground(), 0, 0, 96, 120);
      if (reference === 'amorphous') drawAmorphousSection(pregnancy, stretch, descent, push);
      else drawPairedSection(reference, pregnancy, fields['chamber-fill'].value);
    }
  }

  function drawProlapseTissue(level, stretch, movingRim, centerX = 48, centerY = 80, scale = 1, stool) {
    const bulge = stool?.bulge ?? 0;
    const tighten = stool?.tighten ?? 0;
    const rimScale = movingRim ? Math.max(1, Math.min(1.7, (movingRim.width + 9) / 15)) : 1;
    const widthScale = rimScale * (1 + .21 * bulge - .10 * tighten);
    const eversion = (level === 4 ? 1.48 : 1) * (1 + .12 * bulge - .06 * tighten);
    const project = ([x, y]) => [
      centerX + (x - 48) * widthScale * scale, centerY + (73 + (y - 73) * eversion - 80) * scale,
    ];
    const tissue = (color, points) => {
      const surface = points.map(project);
      const shade = uterusShade(color);
      const wall = color !== basePalette.cavity && color !== basePalette.cavityDeep;
      const transparent = wall && fields.translucent.value === 'on';
      if (transparent) {
        ctx.save();
        ctx.globalAlpha = .76;
      }
      polygon(shade, surface);
      if (wall) canalTexture(ctx, shade, surface);
      if (transparent) ctx.restore();
    };
    const openingAt = (x, y, width, depth) => {
      const [xPos, yPos] = project([x, y]);
      return { centerX: xPos, centerY: yPos, width: width * widthScale * scale, depth: depth * eversion * scale };
    };
    const lining = mix(basePalette.wall, basePalette.wallLight, .22 * bulge);
    if (level === 1) {
      const lip = Math.min(2, stretch * .35);
      tissue(basePalette.wallLight, [[43 - lip, 75], [45, 73], [48, 72], [51, 73],
        [53 + lip, 75], [51, 75], [48, 74], [45, 75]]);
    } else if (level === 2) {
      tissue(lining, [[45, 76], [50, 75], [53, 78], [52, 82], [49, 84], [45, 82], [43, 79]]);
      tissue(basePalette.wallLight, [[45, 76], [50, 76], [51, 78], [45, 79]]);
      const gap = Math.max(1, 2 + Math.round(stretch * .55) + 1.6 * bulge - 1.0 * tighten);
      const depth = Math.max(.5, 1 + stretch * .2 + .7 * bulge - .55 * tighten);
      tissue(basePalette.cavity, [[48 - gap, 80], [48, 80 - depth], [48 + gap, 80], [48, 80 + depth]]);
      if (fields['vaginal-septum'].value === 'on') {
        tissue(basePalette.cavityDeep, [[47.5, 75], [48.7, 75], [49, 83], [47.5, 83]]);
      }
      return openingAt(48, 80, gap, depth);
    } else if (level >= 3) {
      tissue(basePalette.cavityDeep, [[43, 73], [52, 71], [59, 76], [63, 84], [61, 92], [55, 98], [48, 100], [40, 97], [34, 91], [32, 84], [36, 77]]);
      tissue(basePalette.wallDark, [[42, 74], [52, 73], [58, 78], [61, 85], [59, 91], [54, 96], [48, 98], [41, 95], [36, 90], [34, 84], [37, 78]]);
      tissue(lining, [[42, 76], [52, 75], [57, 79], [59, 85], [56, 90], [51, 94], [44, 93], [39, 90], [37, 84], [39, 80]]);
      tissue(basePalette.wallLight, [[42, 77], [51, 77], [55, 80], [55, 84], [52, 86], [45, 85], [40, 83], [40, 80]]);
      const gap = stretch * .45 + 2.1 * bulge - 1.15 * tighten;
      const lip = mix(basePalette.cavity, basePalette.cavityDeep, .23 * bulge);
      tissue(lip, [[43 - gap, 88], [47, 87 - gap], [51, 88 - gap], [54 + gap, 87],
        [52 + gap, 90], [47, 91 + gap], [44 - gap, 90]]);
      if (fields['vaginal-septum'].value === 'on') {
        tissue(basePalette.cavityDeep, [[47.4, 74], [48.5, 74], [49, 85], [49, 98], [47.5, 98], [47.4, 86]]);
      }
      return openingAt(48.5, 89, 5.5 + gap, 2 + gap);
    }
  }

  const racePresets = {};

  const chimeraOutlets = new Map([
    ['奇美拉', ['slender', 'none']],
    ['鵺', ['slender', 'ridges']],
    ['獅鷲', ['oval', 'feathers']],
    ['斯芬克斯', ['oval', 'none']],
    ['白澤', ['oval', 'ridges']],
    ['麒麟', ['shield', 'scales']],
    ['雞蛇族', ['shield', 'mixed']],
    ['梟熊', ['broad', 'none']],
  ]);
  const outletPresetFields = ['layout', 'cloacal-rim', 'outlet-shape', 'outlet-body', 'outlet-decoration'];

  function chimeraOutletPreset(name, marsupial) {
    const variant = chimeraOutlets.get(name);
    if (!variant) return null;
    const race = racePresets[name];
    return marsupial ? ['single', 'marsupial', 'transverse', ...variant]
      : outletPresetFields.map(id => race[id]);
  }

  const characterColors = { skin: basePalette.wall, tone: basePalette.wallLight, 'anus-color': basePalette.wall };
  function applyRacePreset(name) {
    const race = racePresets[name];
    if (!race) return;
    fields['race-preset'].value = name;
    fields['single-sire'].value = 'off';
    fields['single-role'].value = 'idle';
    fields.pouchBrood.value = name === '海馬族' ? '6' : '1';
    const { skin, ovary, ovaryColor: color, overlay, highlight, ...values } = race;
    for (const [id, value] of Object.entries(values)) fields[id].value = value;
    if (skin) {
      fields.skin.value = skin;
      fields.tone.value = mix(skin, '#f7ddda', .43);
      fields['anus-color'].value = mix(skin, fields.tone.value, .14);
    } else {
      for (const [id, value] of Object.entries(characterColors)) fields[id].value = value;
    }
    fields['material-light'].value = highlight ?? mix(fields.tone.value, basePalette.shine, .34);
    ovaryShape.value = ovary;
    ovaryColors.clear();
    if (color) ovaryColors.set(ovary, color);
    uterusColor.value = basePalette.wall;
    fields['uterus-overlay'].value = overlay ? 'on' : 'off';
    fields['uterus-overlay-color'].value = overlay ?? '#9ad0e0';
    fields['section-preset'].value = 'off';
    if (prolapseLevel() === null) fields.prolapse.value = '0';
    combineStart = analFitStart = flowStart = rapidLaborStart = laborRelease = twinSceneStart = null;
    swordPulseStart = null;
    deflowerStart = null;
    rapidLaborResult = '';
  }


  function previewLayout() {
    return fields.layout.value === 'human' && fields['human-sire'].value === 'on' ? 'futa' : fields.layout.value;
  }

  const sheathMotion = { from: 0, to: 0, start: 0 };
  const SHEATH_MOTION_MS = 380;

  function singleShaftFrame(now, libidoHeat, descent) {
    const readProgress = () => {
      const fraction = reducedMotion.matches ? 1 : Math.max(0, Math.min(1, (now - sheathMotion.start) / SHEATH_MOTION_MS));
      return sheathMotion.from + (sheathMotion.to - sheathMotion.from) * (1 - (1 - fraction) ** 2);
    };
    const enabled = fields.layout.value === 'single' && fields['single-sire'].value === 'on';
    const role = fields['single-role'].value;
    if (!enabled || role === 'receiving' || role === 'both') {
      sheathMotion.from = sheathMotion.to = 0;
      return enabled ? { progress: 0, idle: false, moving: false } : null;
    }
    const idle = role === 'idle';
    const target = idle ? (descent > 0 ? 0 : libidoHeat * .19) : 1;
    if (target !== sheathMotion.to) {
      sheathMotion.from = readProgress();
      sheathMotion.to = target;
      sheathMotion.start = now;
    }
    const progress = readProgress();
    return { progress, idle, moving: Math.abs(progress - target) > .001 };
  }

  function drawPouchOutlet(centerY, inflation, race) {
    const skin = fields.skin.value;
    const shadow = surfaceAccent(skin, mix(skin, basePalette.cavityDeep, .60));
    const high = surfaceAccent(skin, mix(skin, fields.tone.value, .56), true);
    const width = 19 + inflation * 6;
    const open = 1.4 + 7 * inflation;
    const y = centerY;
    const shape = (color, points) => polygon(color, points.map(([x, dy]) => [48 + x * width, y + dy]));
    shape(shadow, [[-1,-2],[-.82,-7],[-.42,-10-inflation*8],[.42,-10-inflation*8],[.83,-7],[1,-2],
      [.86,3],[.56,5],[0,7],[-.62,5],[-.90,3]]);
    shape(skin, [[-.91,-2],[-.74,-7],[-.40,-9-inflation*7],[.42,-9-inflation*7],[.74,-6],[.9,-2],
      [.7,3],[.37,5],[-.42,5],[-.75,2]]);
    if (race === '海馬族') {
      for (const dy of [-8, -13]) {
        if (inflation > .20 || dy === -8) shape(high, [[-.59,dy],[-.33,dy-2],[.32,dy-2],[.61,dy],
          [.27,dy-1],[-.29,dy-1]]);
      }
    }
    const aperture = [[-.86,-2],[-.60,-open],[-.23,-open-1],[.30,-open-1],[.63,-open],[.88,-2],
      [.65,1],[.25,1+open*.35],[-.25,1+open*.35],[-.66,1]];
    shape(basePalette.cavityDeep, aperture);
    shape(traceAccent(skin, high), [[-.92,-2],[-.63,1],[-.26,1+open*.35],[.26,1+open*.35],[.63,1],[.92,-2],
      [.72,3],[.28,3+open*.35],[-.28,3+open*.35],[-.72,3]]);
  }

  function drawPouchBirth(layout, descent, now, opening, count) {
    if (layout !== 'pouch' || descent !== 3 || count < 2) {
      pouchBurstStart = null;
      return false;
    }
    if (pouchBurstStart === null) pouchBurstStart = now;
    const still = reducedMotion.matches;
    const elapsed = still ? 350 : now - pouchBurstStart;
    if (elapsed >= 1220) return false;
    for (let i = 0; i < Math.min(count, still ? 3 : 8); i++) {
      const progress = (elapsed - i * 68) / 680;
      if (progress < 0 || progress >= 1) continue;
      const x = 48 + (i - (Math.min(count, 8) - 1) / 2) * progress * 10;
      const y = opening.centerY + 3 + progress * 39;
      polygon('#211726', [[x-3,y],[x-1,y-3],[x+2,y-3],[x+4,y-1],[x+3,y+2],[x,y+3],[x-2,y+2]]);
      polygon('#504052', [[x-2,y-1],[x-1,y-2],[x+1,y-2],[x,y],[x-2,y+1]]);
    }
    return !still;
  }

  function twinOpeningAmount(elapsed) {
    const amount = elapsed < COMBINE_MS ? Math.max(0, Math.min(1, elapsed / 620))
      : Math.max(0, 1 - (elapsed - COMBINE_MS) / 550);
    return amount * (2 - amount);
  }

  function draw(now) {
    const prolapse = prolapseLevel();
    const layout = previewLayout();
    const tube = layout === 'tube';
    const anal = layout === 'anal';
    const tubeMode = tube ? fields['sire-form'].value : 'off';
    const separateAnus = layout !== 'single' && layout !== 'pouch' && !anal;
    const humanForm = layout === 'human' || layout === 'futa';
    const condition = laborCondition.value;
    const rapid = rapidLaborFrame(now, condition);
    const pregnancy = Number(fields.pregnancy.value);
    const descent = rapid?.descent ?? previewDescent(condition);
    const rapidHeld = condition === 'precipitous-delivery' && descent === 3 && Boolean(rapidLaborResult);
    const dropProgress = rapid?.drop ?? (rapidHeld ? RAPID_HELD_DROP : 0);
    const inletBlocked = blocksPelvicInlet(condition);
    const shoulderBlocked = condition === 'shoulder_dystocia';
    const status = rapid?.status ?? ({
      transverse: '胎兒橫在骨盆入口', twin_lock: '兩胎在骨盆入口互鎖', shoulder_dystocia: '先露部已出 · 肩部卡住',
    }[condition] ?? rapidLaborResult);
    if (laborPreviewStatus.value !== status) laborPreviewStatus.value = status;
    const parity = Number(fields.parity.value);
    if (recoveryStart !== null) {
      const progress = Math.min(100, Math.round((now - recoveryStart) * 100 / RECOVERY_PREVIEW_MS));
      fields.recovery.value = progress;
      if (progress === 100) recoveryStart = null;
    }
    fields['recovery-value'].value = `${fields.recovery.value}%`;
    const remaining = parity > 0 && pregnancy === 0 && descent === 0 ? 1 - Number(fields.recovery.value) / 100 : 0;
    const recovery = remaining * remaining;
    const fit = Number(fields.fit.value);
    const flow = fields.flow.value;
    const flowEffect = flowEffects[flow];
    const steadyMotion = !reducedMotion.matches && flowEffect?.repeat;
    const combineElapsed = combineStart === null ? Infinity : now - combineStart;
    const deflowerElapsed = deflowerStart === null ? Infinity : now - deflowerStart;
    if (deflowerElapsed >= COMBINE_MS + RECOIL_MS) deflowerStart = null;
    hymenFrame = deflowerStart !== null
      ? (deflowerElapsed < HYMEN_TEAR_MS ? { state: 'intact', tension: Math.sin(Math.PI / 2 * deflowerElapsed / HYMEN_TEAR_MS) } : { state: 'torn', tension: 0 })
      : { state: fields.hymen.value, tension: 0 };
    const look = swordLook(now);
    const twinElapsed = twinSceneStart === null ? Infinity : now - twinSceneStart;
    if (twinElapsed >= COMBINE_MS + ANAL_RESIDUE_MS) twinSceneStart = null;
    const twinScene = twinSceneStart !== null && descent === 0;
    const twinOpening = twinScene ? twinOpeningAmount(twinElapsed) : 0;
    const sex = descent === 0 ? { look, shared: twinScene && !separateAnus } : null;
    const hardPull = sex && look.phase === 'pull' && look.release < 1 ? Math.sin(Math.PI * look.release) : 0;
    const analElapsed = analFitStart === null ? Infinity : now - analFitStart;
    const effectElapsed = flowStart === null ? null : now - flowStart - (flowEffect?.delay ?? 0);
    const libidoHeat = Math.max(0, (Number(fields.libido.value) / 100 - .27) / .73);
    materialPhase = reducedMotion.matches ? 0 : Math.floor(now / 240);
    const singleShaft = singleShaftFrame(now, libidoHeat, descent);
    const baseGeometry = birthOutletGeometry[humanForm ? 'human' : tube || anal || layout === 'pouch' ? layout : fields['outlet-shape'].value];
    const tubeProjection = tube ? 5 * Number(swordOffset.value) : 0;
    const tubeLift = Math.round((tubeMode === 'off' ? 15 : 19) * libidoHeat);
    const geometry = tube ? { ...baseGeometry, centerY: baseGeometry.centerY + tubeProjection } : baseGeometry;
    const outlet = tube && descent < 2
      ? { centerX: 48, centerY: 94 + tubeProjection - tubeLift }
      : { centerX: 48, centerY: geometry.centerY };
    if (effectElapsed !== null && effectElapsed >= (flowEffect?.duration ?? 0) && !steadyMotion) flowStart = null;
    if (combineElapsed >= COMBINE_MS + RECOIL_MS) combineStart = null;
    if (!separateAnus || analElapsed >= ANAL_FIT_END_MS + ANAL_RESIDUE_MS) analFitStart = null;
    const needs = needMotion(now, prolapse);
    const busyOpening = descent > 0 || combineStart !== null || prolapse > 0 || rapid !== null;
    const stateMotion = steadyMotion || needs.active || combineStart !== null || analFitStart !== null || deflowerStart !== null ||
      flowStart !== null || recoveryStart !== null || rapid !== null || singleShaft?.moving || look.active || twinScene ||
      (!reducedMotion.matches && (movingMaterials.has(fields['canal-material'].value) ||
        movingMaterials.has(fields['edge-decoration'].value) || animatedOvaries.has(selectedOvaryShape()) ||
        (selectedOvaryShape() === 'clockwork' && libidoHeat >= .42)));
    ctx.clearRect(0, 0, frontBuffer.width, frontBuffer.height);
    const pushing = descent > 0 && fields.effort.value === 'push' && !rapidHeld;
    const push = rapid?.push ?? laborPush(now, pushing, Number(fields.fatigue.value));
    materialHeat = Math.max(libidoHeat, push);
    const inletPressure = inletBlocked ? .20 + .80 * push : 0;
    lastLaborPush = push;
    const weightScale = Math.sqrt(Number(fields.weight.value)) - 1;
    const diameter = tube ? tubeDiameterScale[fields['tube-diameter'].value] * (1 + (tubeTipScale[fields['tube-tip'].value] - 1) * .25) : 1;
    const position = selectedPresentingPosition(condition);
    const birthOpening = descent >= 2 ? getBirthOpening(weightScale, descent, geometry, diameter) : null;
    if (birthOpening && position !== 'head') {
      birthOpening.width *= presentingPositions[position].width;
      birthOpening.depth *= presentingPositions[position].depth;
    }
    if (birthOpening && prolapse !== null) birthOpening.centerY += [0, 0, 1, 5, 11][prolapse];
    if (birthOpening && tube) birthOpening.centerY = Math.min(98, birthOpening.centerY);
    if (birthOpening && prolapse === 4) birthOpening.depth = Math.min(birthOpening.depth, 114 - birthOpening.centerY);
    const advance = shoulderBlocked ? 0 : Math.round((descent === 3 ? 2 : 3) * push);
    const rimAdvance = Math.round(advance / 2);
    const rimThickness = [1, 1, 1.25, 1.5, 1.65][prolapse ?? 0];
    if (birthOpening && (anal || tube)) {
      const lowestRim = canvas.height - 3;
      birthOpening.depth = Math.min(birthOpening.depth,
        Math.floor(lowestRim - birthOpening.centerY - rimAdvance - 2 * (shoulderBlocked ? 1 : push) - 4 * rimThickness));
    }
    const drop = birthOpening && dropProgress > 0
      ? dropProgress * Math.min(12, Math.max(0, 117 - birthOpening.centerY - birthOpening.depth - advance)) : 0;
    const movingRim = birthOpening && {
      ...birthOpening, width: birthOpening.width + 4 * push, depth: birthOpening.depth + 2 * push + drop * .29,
      centerY: birthOpening.centerY + rimAdvance + drop * .44, rimThickness,
    };
    const fitScale = [1, .75, .5, .25, .15][prolapse ?? 0];
    const stretch = inletBlocked ? geometry.earlyStretch * .48 + 5.6 * push
      : descent === 1 ? geometry.earlyStretch + 2 * weightScale + 3 * push
        : descent === 0 ? (twinScene ? fitStretch(1500, fit) * twinOpening : fitStretch(combineElapsed, fit)) * fitScale : 0;
    const baselineStretch = [0, 1, 2, 7, 9][prolapse ?? 0];
    const parityStretch = [0, 1.3, 2.1, 2.6][parity];
    const frontStretch = stretch + baselineStretch * (humanForm ? 1 : .55) + parityStretch + recovery * 6;
    const frontRim = movingRim && { ...movingRim, width: movingRim.width + parityStretch * .75 };
    let drawDisplacedTissue;
    const visualProlapse = hardPull > .35 ? Math.min(4, Math.max(2, (prolapse ?? 0) + 1)) : prolapse;
    if (visualProlapse > 0) {
      const displacedCenter = birthOpening ? Math.min(anal ? 93 : 96, birthOpening.centerY) : outlet.centerY;
      drawDisplacedTissue = humanForm ? () => drawProlapseTissue(visualProlapse, stretch + hardPull * 2, movingRim)
        : () => drawProlapseTissue(visualProlapse, stretch + hardPull * 2, movingRim, outlet.centerX,
          displacedCenter, tube ? .63 : .72, anal ? needs.stool : undefined);
    }
    let sword;
    if (layout === 'futa') {
      const offset = Number(swordOffset.value);
      sword = {
        offset,
        length: 38 + 14 * offset + 9.5 * Math.max(0, offset) ** 2,
        revealOpening: busyOpening,
        recoveryFade: remaining, look, clipBottom: canvas.height,
      };
    }
    let urineOutletY;
    if (humanForm) {
      urineOutletY = drawAnatomy(fields.shape.value, pregnancy, libidoHeat, frontStretch, frontRim, drawDisplacedTissue,
        sword, recovery, needs.urine, inletPressure);
    } else if (anal) {
      urineOutletY = drawAnalAnatomy(outlet, libidoHeat, frontStretch, frontRim, drawDisplacedTissue, recovery, needs, busyOpening, inletPressure, look);
    } else if (layout === 'pouch') {
      const race = fields['race-preset'].value;
      drawPouchOutlet(outlet.centerY, Math.min(1, pregnancy * .24 + (birthOpening ? .44 : 0)), race);
      if (birthOpening) {
        const skin = fields.skin.value;
        const shade = surfaceAccent(skin, mix(skin, basePalette.cavityDeep, .56));
        const light = surfaceAccent(skin, fields.tone.value, true);
        drawBirthRim(frontRim, traceAccent(skin, shade), light,
          frontRim.centerY - frontRim.depth - 5, frontRim.rimThickness, ctx, true);
      }
      drawDisplacedTissue?.();
      urineOutletY = null;
    } else {
      urineOutletY = drawAlternateAnatomy(layout, geometry, outlet, { pregnancy, libidoHeat, descent, stretch: frontStretch,
        recovery, needs, busy: busyOpening, tubeMode, inletPressure, singleShaft, prolapse, look }, frontRim, drawDisplacedTissue);
    }
    if (prolapse !== null) {
      const sectionStretch = movingRim ? movingRim.width * .42 : stretch;
      drawProlapseSection(prolapse, pregnancy, sectionStretch, 'human', birthOutletGeometry.human, descent, weightScale,
        Math.max(push, dropProgress), sectionFit(combineElapsed, fit), undefined, condition, singleShaft, sex);
    }
    const reference = selectedSectionReference();
    if (prolapse === null && reference !== 'off') {
      drawSectionPreset(reference, pregnancy, { stretch, descent, push });
    }
    const pouchAnimating = drawPouchBirth(layout, descent, now, outlet, Number(fields.pouchBrood.value));
    if (birthOpening && !(layout === 'pouch' && descent === 3 && Number(fields.pouchBrood.value) > 1)) drawPresenting({ ...birthOpening, descent, position, depth: birthOpening.depth + drop * .42,
      centerY: birthOpening.centerY + advance + drop * .58 });
    if (layout === 'pouch' && prolapse !== null) {
      sectionPixel('#d5a477', 74, Math.min(112, prolapseSections[prolapse]?.tip ?? 91), 6);
    }
    const flowOrigin = movingRim ? Math.min(113, movingRim.centerY + movingRim.depth + 1)
      : Math.min(113, outlet.centerY + [1, 1, 1, 16, 26][prolapse ?? 0]);
    const frontScale = separateAnus ? compactFrontHeight / canvas.height : 1;
    const analExpansion = twinScene && twinOpening > 0 ? analFitExpansion(620, 2) * twinOpening
      : analFitStart !== null && analElapsed < ANAL_FIT_END_MS ? analFitExpansion(analElapsed, Number(fields['anal-sword-size'].value)) : null;
    // 肛內還有殘精時，沒在播擴張也留一道靜態痕跡（等於擴張後殘精剛滴下兩格、還沒淡掉的那一幀）
    const analResidueElapsed = twinScene ? twinElapsed - COMBINE_MS : analFitStart !== null ? analElapsed - ANAL_HOLD_END_MS
      : fields['anal-residue'].value === 'on' ? ANAL_RESIDUE_STATIC_MS : null;
    drawFrontView(separateAnus, analExpansion, needs.stool, analResidueElapsed);
    if (twinScene) {
      if (!separateAnus) drawAnalResidue({ centerX: outlet.centerX + 5, centerY: flowOrigin - 1, width: 3, depth: 2 },
        'small', twinElapsed - COMBINE_MS);
    }
    const flowTime = flowStart !== null ? effectElapsed : steadyMotion ? now : flowEffect?.repeat ? flowEffect.duration * .34 : null;
    if (rapid && rapid.ruptureElapsed !== null) {
      drawFlow(flowEffects.rupture, rapid.ruptureElapsed, flowOrigin * frontScale, outlet.centerX);
    } else if (twinScene && twinElapsed >= COMBINE_MS) {
      drawFlow(flowEffects.withdrawal, twinElapsed - COMBINE_MS, flowOrigin * frontScale, outlet.centerX);
    } else {
      drawFlow(flowEffect, flowTime, flowOrigin * frontScale, outlet.centerX);
    }
    // 破处的血：裂开那一刻起从阴道口滴两滴
    if (deflowerStart !== null && !anal && layout !== 'pouch' && deflowerElapsed >= HYMEN_TEAR_MS) {
      drawFlow(flowEffects.hymen, deflowerElapsed - HYMEN_TEAR_MS, flowOrigin * frontScale, outlet.centerX);
    }
    if (urineOutletY !== null && needs.urine.drops > 0) {
      drawUrineDrops(needs.urine, urineOutletY * frontScale);
    }
    return stateMotion || pouchAnimating || (pushing && !reducedMotion.matches) || laborRelease !== null;
  }

  function animate(now) {
    frameId = 0;
    if (Math.floor(now / 90) === lastTick) {
      frameId = requestAnimationFrame(animate);
      return;
    }
    lastTick = Math.floor(now / 90);
    const playingRapid = rapidLaborStart !== null;
    const active = draw(now);
    if (playingRapid && rapidLaborStart === null) refresh();
    else if (active) frameId = requestAnimationFrame(animate);
  }


  function startCombine(now) {
    const reference = selectedSectionReference();
    if (fields.prolapse.value === 'off' && (reference === 'off' || reference === 'human')) {
      fields['section-preset'].value = 'off';
      fields.prolapse.value = '0';
    }
    combineStart = now;
    twinSceneStart = fields.swordTwin.value === 'on' && fields.channel.value === 'both' ? now : null;
    if (twinSceneStart !== null) swordPulseStart = now + COMBINE_MS - 360;
    if (fields.flow.value === 'withdrawal') flowStart = now;
  }


  // ── 對外介面 ──
  const EXTRA = { 'sword-offset': swordOffset, 'ovary-shape': ovaryShape, 'ovary-color': ovaryColor, 'uterus-color': uterusColor, 'labor-condition': laborCondition };
  let loop = 0;
  let lastFrameTick = -1;
  // 主题：基础色表可换（子宫图的主题色表对应过来）；画完可再处理一次整张（水墨的笔触）
  const BASE_PALETTE = { ...basePalette };
  let postProcess = null;
  function setPalette(values = {}) { Object.assign(basePalette, BASE_PALETTE, values); }
  function setPostProcess(fn) { postProcess = typeof fn === 'function' ? fn : null; }
  function render(now) {
    const active = draw(now);
    if (postProcess) postProcess(frontContext);
    return active;
  }
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function setState(values = {}) {
    const now = clock();
    for (const [id, raw] of Object.entries(values)) {
      const field = fields[id] || EXTRA[id];
      if (!field) continue;
      const value = String(raw);
      if (field.value === value) continue;
      field.value = value;
      // 預覽頁 input 事件的副作用（只留畫面需要的）
      if (id === 'urine') urineStart = now;
      if (id === 'stool') stoolStart = now;
      if (id === 'lock-phase') {
        combineStart = twinSceneStart = null;
        lockVisualStart = now;
        swordPulseStart = value === 'locked' ? lockVisualStart : null;
      }
      if (id === 'swordLock' && value === 'off') fields['lock-phase'].value = 'idle';
      if (id === 'layout' || id === 'human-sire' || id === 'sire-form') {
        combineStart = twinSceneStart = swordPulseStart = null;
        flowStart = null;
        laborRelease = null;
        lastLaborPush = 0;
      }
      if (id === 'layout' || id === 'anal-sword-size') analFitStart = null;
      if (id === 'flow') flowStart = null;
      if (id === 'descent' || id === 'fit') combineStart = twinSceneStart = null;
    }
  }
  /** 播一段動畫：combine 劍鞘契合、anal-fit 肛門擴張、sword-pulse 射精與外形變化、flow 流出、recovery 產後回縮、deflower 破處 */
  function play(kind, now = clock()) {
    if (kind === 'combine') startCombine(now);
    else if (kind === 'anal-fit') analFitStart = now;
    else if (kind === 'sword-pulse') swordPulseStart = now;
    else if (kind === 'flow') flowStart = now;
    else if (kind === 'recovery') recoveryStart = now;
    else if (kind === 'deflower') { deflowerStart = now; startCombine(now); }
    if (loop) start();
  }
  function paint(now = clock()) { return render(now); }
  function tick(now) {
    loop = 0;
    if (Math.floor(now / 90) === lastFrameTick) { loop = requestAnimationFrame(tick); return; }
    lastFrameTick = Math.floor(now / 90);
    if (render(now)) loop = requestAnimationFrame(tick);
  }
  /** 畫一次；還在動就排下一格（90 ms 一格，同預覽頁） */
  function start() {
    if (loop) cancelAnimationFrame(loop);
    loop = 0;
    lastFrameTick = -1;
    if (render(clock())) loop = requestAnimationFrame(tick);
  }
  function stop() { if (loop) cancelAnimationFrame(loop); loop = 0; }
  // ── 借给子宫剖面用的画法（1.6.0）：卵巢造型与通道纹理照预览，子宫图那边只负责贴上去 ──
  /** 卵巢小图：画在离屏剖面画布 (48,60)，裁 32×32 回传，卵巢中心在 (16,16)。color 没给照预览的预设色 */
  function ovarySprite(shape, side = 1, heat = 0, color = null) {
    sectionContext.clearRect(0, 0, sectionContext.canvas.width, sectionContext.canvas.height);
    materialHeat = heat;
    drawOvary(shape, 48, 60, side, heat, color || selectedOvaryColor(shape));
    const out = document.createElement('canvas');
    out.width = 32;
    out.height = 32;
    out.getContext('2d').drawImage(sectionContext.canvas, 32, 44, 32, 32, 0, 0, 32, 32);
    return out;
  }
  /** 通道纹理画到任一画布的多边形里（预览的 texturePixels）；light 是材质反光色 */
  function texture(context, points, material, color, strength = 1, light = null, heat = 0) {
    if (light) fields['material-light'].value = light;
    materialHeat = heat;
    texturePixels(context, points, material, color, strength, false);
  }
  function setReducedMotion(value) { reducedMotion.matches = Boolean(value); }
  return { setState, setPalette, setPostProcess, ovarySprite, texture, play, paint, start, stop, setReducedMotion, getState: () => Object.fromEntries(Object.entries(fields).map(([id, field]) => [id, field.value])) };

}
