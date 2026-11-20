// 孕体特写的上色：belly_layout.js 的成图（标注、图层、明暗）→ 固定大小画框的像素。
// 这里只算出 RGBA 像素阵列，不碰 DOM（Node 测试可跑）；贴到 canvas 与动画排程由呼叫端做。
//
// 颜色都从色表查：成图只决定「哪一格是哪种材质、第几阶明暗」，换肤色、换主题不必重算成图。
// 线条、孕中线、乳头的画法移植自预览页 PREGNANCY_TRACE_NUDE.html，函式内文保持原样。

/** 预设色表（与预览页相同）。肤色、乳晕各是一条由深到浅的色带 */
export const BELLY_DEFAULT_PALETTE = Object.freeze({
  bg: '#1c1726', line: '#4f2c3d',
  skin: Object.freeze(['#9c5660', '#c47c78', '#df9e8a', '#efbba2', '#f9d5bd']),
  bra: Object.freeze(['#3d3546', '#585063', '#776b80', '#9a8fa3']),
  shorts: Object.freeze(['#241f2b', '#383142', '#544a63', '#73688a']),
  crease: '#141018',
  areolaPale: Object.freeze(['#d4907f', '#b9746f']), areolaDark: Object.freeze(['#8e5550', '#6c3b3d']),
  nipplePale: Object.freeze(['#ad6264', '#8f4c52']), nippleDark: Object.freeze(['#5e2f35', '#4a2229']),
  milk: Object.freeze(['#f6f1e7', '#ddd5c8']),
  smoke: Object.freeze(['#c6d16a', '#a3ad4f', '#7f8740']),
  // 孕前虚影的虚线
  ghost: '#b9adb7',
});
/** 肤色色带的基准色：预设色带的第 4 阶（最常见的受光面） */
export const BELLY_SKIN_BASE = BELLY_DEFAULT_PALETTE.skin[3];

const hexToRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`;
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** 把预设色带搬到另一个基准色上：色相平移，彩度与明度按比例 */
function shiftRamp(ramp, fromBase, toBase) {
  if (fromBase.toLowerCase() === toBase.toLowerCase()) return [...ramp];
  const from = rgbToHsl(hexToRgb(fromBase));
  const to = rgbToHsl(hexToRgb(toBase));
  const ratio = (a, b) => (b > 1e-6 ? a / b : 1);
  return ramp.map((color) => {
    const [h, s, l] = rgbToHsl(hexToRgb(color));
    return rgbToHex(hslToRgb([h + to[0] - from[0], Math.min(1, s * ratio(to[1], from[1])), Math.min(1, l * ratio(to[2], from[2]))]));
  });
}

/** 乳头色带的基准色：预设乳晕（未变深）的第 1 阶 */
export const BELLY_NIPPLE_BASE = BELLY_DEFAULT_PALETTE.areolaPale[0];

/**
 * 组出一张色表。skinBase 是肤色基准色：肤色、乳晕、乳头的色带一起跟着它换（深肤色配粉乳晕会很怪）；
 * nippleBase（角色自订的乳头色）给了就让乳晕、乳头改跟它走，与肤色无关；怀孕变深照预设的深浅比例。
 * 其余色组（背景、轮廓线、胸衣、短裤、奶水、臭烟…）可以个别覆写。不给参数就是预设色表。
 */
export function createBellyPalette({ skinBase = BELLY_SKIN_BASE, nippleBase = null, ...overrides } = {}) {
  const base = BELLY_DEFAULT_PALETTE;
  const moved = (ramp) => shiftRamp(ramp, BELLY_SKIN_BASE, skinBase);
  const nipple = nippleBase ? (ramp) => shiftRamp(ramp, BELLY_NIPPLE_BASE, nippleBase) : moved;
  return {
    ...base,
    skin: moved(base.skin),
    areolaPale: nipple(base.areolaPale), areolaDark: nipple(base.areolaDark),
    nipplePale: nipple(base.nipplePale), nippleDark: nipple(base.nippleDark),
    ...overrides,
  };
}

/**
 * 半彩主题的肤色：宫壁色相的那条色带，再照角色自订色与预设色的差别（明度、彩度的比例）调深调浅，
 * 色相留主题的——所以自订的深肤色在半彩主题是「同色相的深色」。乳头另外带上自订色与预设乳头色的色相差。
 */
function personalizeRamp(ramp, fromBase, toBase, keepHue) {
  if (!toBase) return [...ramp];
  const from = rgbToHsl(hexToRgb(fromBase));
  const to = rgbToHsl(hexToRgb(toBase));
  const ratio = (a, b) => (b > 1e-6 ? a / b : 1);
  return ramp.map((color) => {
    const [h, sat, l] = rgbToHsl(hexToRgb(color));
    return rgbToHex(hslToRgb([keepHue ? h : h + to[0] - from[0], Math.min(1, sat * ratio(to[1], from[1])), Math.min(1, l * ratio(to[2], from[2]))]));
  });
}

/**
 * 各主题的特写怎么上色（2026-11-15 使用者定）：
 *   mono 单色：整张一个色调（仿真、废土照子宫图的单色阶；水墨、建构由深到浅一条色带，乳晕用主题的警示色点一下）；
 *   half 半彩：照主题的专属配色，身体换成该主题的宫壁色相（修仙、奇幻、赛博埃及、全息、蒸汽、克系）；
 *   full 全彩：写实肤色，只有背景跟主题（iPhone、樱花、哥特）。之后的种族色表、自订肤色只在全彩主题看得出来。
 * 没列到的主题当半彩。
 */
export const BELLY_THEME_MODES = Object.freeze({
  retro: 'mono', wasteland: 'mono', ink: 'mono', constructivism: 'mono',
  iphone: 'full', sakura: 'full', gothic: 'full',
});
// 单色主题里，子宫图的配色本身不只一个色相的（水墨有朱砂、建构有红）：特写改用深到浅的一条色带
const MONO_RAMP_THEMES = new Set(['ink', 'constructivism']);

/**
 * 跟着介面主题的色表：拿子宫图当下的色表（uterus_render.js 的 getUterusPalette）对应过来，
 * 所以特写与子宫图在每个主题下是同一套颜色。theme 是主题名，决定单色、半彩或全彩（见 BELLY_THEME_MODES）。
 */
export function createBellyThemePalette(womb, { theme = '', realistic = false, skin = null, nipple = null } = {}) {
  const personal = { ...(skin ? { skinBase: skin } : {}), ...(nipple ? { nippleBase: nipple } : {}) };
  if (!womb) return createBellyPalette(personal);
  const mode = realistic ? 'full' : BELLY_THEME_MODES[theme] || 'half';
  if (mode === 'full') return createBellyPalette({ bg: womb.bg, ...personal });
  // 单色主题整张一个色调：不套自订色
  if (mode === 'mono') { skin = null; nipple = null; }
  const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((value, k) => value + (hexToRgb(b)[k] - value) * t));
  if (mode === 'mono' && MONO_RAMP_THEMES.has(theme)) {
    const dark = womb.ink || womb.wallDark;
    const light = womb.fetusLight;
    const accent = womb.blood;
    const ramp = (steps) => steps.map((t) => mix(dark, light, t));
    return {
      bg: womb.bg, line: dark, crease: dark,
      skin: ramp([0.45, 0.62, 0.76, 0.88, 1]),
      bra: ramp([0.08, 0.18, 0.28, 0.38]),
      shorts: ramp([0, 0.07, 0.15, 0.24]),
      areolaPale: [mix(light, accent, 0.5), mix(light, accent, 0.7)], areolaDark: [accent, mix(accent, dark, 0.3)],
      nipplePale: [mix(light, accent, 0.8), accent], nippleDark: [mix(accent, dark, 0.3), mix(accent, dark, 0.55)],
      milk: [light, mix(dark, light, 0.8)],
      smoke: ramp([0.3, 0.42, 0.55]),
      ghost: accent,
      // 水墨：画完再做一次笔触处理（飞白与晕染），与子宫图相同
      ...(womb.brush ? { brush: { paper: womb.bg, ink: dark } } : {}),
    };
  }
  return {
    bg: womb.bg, line: womb.frame || womb.void,
    // 肤色只用宫壁那个色相（最亮两阶往高光色靠一点）。胎儿色在有些主题是另一个色相（赛博埃及是青色），拿来当亮面会变成两种颜色的身体
    skin: personalizeRamp([womb.wallDark, womb.wall, womb.wallLight, mix(womb.wallLight, womb.shine, 0.35), mix(womb.wallLight, womb.shine, 0.7)], BELLY_SKIN_BASE, skin, true),
    bra: [womb.cavityDeep, womb.cavity, womb.shadow, womb.fluid],
    shorts: [womb.void, womb.cavityDeep, womb.cavity, womb.shadow],
    crease: womb.void,
    // 乳头：自订了就照乳头色与预设的差别调（色相差也带上，粉与褐分得出来）；只订了肤色就跟着肤色调深浅
    ...Object.fromEntries([['areolaPale', [womb.wall, womb.wallDark]], ['areolaDark', [womb.wallDark, womb.cavity]],
      ['nipplePale', [womb.wallDark, womb.cavity]], ['nippleDark', [womb.cavity, womb.cavityDeep]]]
      .map(([key, ramp]) => [key, nipple ? personalizeRamp(ramp, BELLY_NIPPLE_BASE, nipple, false) : personalizeRamp(ramp, BELLY_SKIN_BASE, skin, true)])),
    milk: [womb.waterLight, womb.water],
    smoke: [womb.signal, mix(womb.signal, womb.bg, 0.3), mix(womb.signal, womb.bg, 0.55)],
    ghost: womb.fluidLight || womb.shine,
  };
}

/**
 * 水墨笔触（与子宫图的 inkBrush 同一套规律）：浓墨像素贴着浅色的地方，按固定规律掉成纸色，像干笔擦过（飞白）；
 * 紧贴浓墨的浅色像素往墨色渗一点（晕染）。规律只看座标，每一格相同，动画时不会闪。
 * @param data RGBA 位元组（Uint8ClampedArray，直接改）
 */
export function applyBellyInkBrush(data, width, height, { paper, ink }) {
  const lum = (i) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  const dark = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) dark[p] = lum(p * 4) < 0.4 ? 1 : 0;
  const paperRgb = hexToRgb(paper);
  const inkRgb = hexToRgb(ink);
  const noise = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      const near = (dx, dy) => { const nx = x + dx; const ny = y + dy; return nx >= 0 && ny >= 0 && nx < width && ny < height ? dark[ny * width + nx] : 0; };
      const around = near(1, 0) + near(-1, 0) + near(0, 1) + near(0, -1);
      if (dark[p]) {
        if (around < 4 && noise(x, y) < 0.22) for (let k = 0; k < 3; k += 1) data[i + k] = Math.round(data[i + k] * 0.3 + paperRgb[k] * 0.7);
      } else if (around > 0 && noise(y, x) < 0.5) {
        const t = 0.12 * around;
        for (let k = 0; k < 3; k += 1) data[i + k] = Math.round(data[i + k] * (1 - t) + inkRgb[k] * t);
      }
    }
  }
  return data;
}

/**
 * @param layout createBellyLayout() 的结果
 * @returns { frame: {width,height}, paint(composed, palette) }
 */
export function createBellyPainter(layout, options = {}) {
  // 乳沟线与乳房轮廓线贴着并行时只留乳沟线（插件新增；与预览页对照时关掉）
  const mergeChestLines = options.mergeChestLines !== false;
  const { width: W, height: H, step: STEP, x0: X0, y0: Y0 } = layout.grid;
  const N = W * H;
  const { SKIN, BRA, SHORTS } = layout.labels;
  const { clamp, cupInk, sampleContourLine } = layout;
  const MAX_DAYS = layout.maxDays;
  const FRAME = layout.frame;
  // 现在上色用的色表（paint() 每次设定；下面移植来的函式照预览页读 PAL 与这几个常数）
  let PAL = BELLY_DEFAULT_PALETTE;
  let AREOLA_PALE = PAL.areolaPale, AREOLA_DARK = PAL.areolaDark, NIPPLE_PALE = PAL.nipplePale, NIPPLE_DARK = PAL.nippleDark;
  const usePalette = (palette) => {
    PAL = palette;
    AREOLA_PALE = PAL.areolaPale; AREOLA_DARK = PAL.areolaDark; NIPPLE_PALE = PAL.nipplePale; NIPPLE_DARK = PAL.nippleDark;
  };
  const rgbaCache = new Map();
  const rgba = (hex) => {
    let value = rgbaCache.get(hex);
    if (value === undefined) { const [r, g, b] = hexToRgb(hex); value = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; rgbaCache.set(hex, value); }
    return value;
  };

  const hexMix=(a,b,t)=>'#'+[1,3,5].map(k=>Math.round(parseInt(a.slice(k,k+2),16)*(1-t)+parseInt(b.slice(k,k+2),16)*t).toString(16).padStart(2,'0')).join('');
  function paintNipples(frame,put){
    for(const s of frame.nipples||[]){
      const t=Math.round((s.tint||0)*4)/4,are=[0,1].map(k=>hexMix(AREOLA_PALE[k],AREOLA_DARK[k],t)),nip=[0,1].map(k=>hexMix(NIPPLE_PALE[k],NIPPLE_DARK[k],t));
      const down=s.ryDown??s.ry,cy=Math.round(s.y),out=s.erect>0.5?2:1;
      if(s.edge!=null){
        // On the outline, turned with it: the areola lies along the edge's slope (tangent) and only a little way in from it
        // (along the inward normal); the nipple stands out along the outward normal.
        const row=y=>{y=clamp(Math.round(y),0,H-1);for(let x=0;x<W;x++)if(frame.label[y*W+x])return x;return null};
        // covered (the top on, or anything but bare skin at that point): no nipple at all
        const e0=row(cy),eu=row(cy-2)??e0,ed=row(cy+2)??e0;if(e0===null||frame.label[cy*W+e0]!==SKIN||frame.label[cy*W+e0+1]!==SKIN)continue;
        const tl=Math.hypot(ed-eu,4),[tx,ty]=s.tangent||[(ed-eu)/tl,4/tl],nx=-ty,ny=tx;   // tangent (downward) and outward normal
        const r=Math.ceil(Math.max(down,s.rx)+2);
        for(let y=cy-r;y<=cy+r;y++)for(let x=e0-r;x<=e0+r;x++){
          if(x<0||x>=W||y<0||y>=H||frame.label[y*W+x]!==SKIN)continue;
          const px=x-e0,py=y-cy,u=px*tx+py*ty,v=-(px*nx+py*ny);           // u along the edge, v depth inward
          if(v<-0.5)continue;const d=Math.hypot(u/(u>0?down:s.ry),(v-s.rx*0.5)/s.rx);if(d>1)continue;
          put(x,y,(s.restTone?s.restTone(px,py):frame.tone[y*W+x])>=3?are[0]:are[1]);
        }
        put(e0,cy,nip[1]);for(let k=1;k<=out;k++)put(Math.round(e0+nx*k),Math.round(cy+ny*k),nip[0]);
        if(s.ry>=1.8)put(Math.round(e0+nx+tx),Math.round(cy+ny+ty),nip[1]);
      }else{
        for(let y=Math.floor(s.y-s.ry-1);y<=s.y+down+1;y++)for(let x=Math.floor(s.x-s.rx-1);x<=s.x+s.rx+1;x++){
          if(x<0||x>=W||y<0||y>=H||frame.label[y*W+x]!==SKIN)continue;
          const d=Math.hypot((x-s.x)/s.rx,(y-s.y)/(y>s.y?down:s.ry));if(d>1)continue;
          put(x,y,frame.tone[y*W+x]>=3?are[0]:are[1]);
        }
        const cx=Math.round(s.x);
        if(cx>=0&&cx<W&&cy>=0&&cy<H&&frame.label[cy*W+cx]===SKIN){put(cx,cy,nip[0]);if(out>1||s.ry>=2.2)put(cx,cy+1,nip[1]);if(out>1)put(cx+1,cy,nip[1])}
      }
    }
  }
  function paintContourLines(frame,put){
    const stroke=new Uint8Array(N),material={skin:SKIN,bra:BRA,shorts:SHORTS},cleftInk=new Uint8Array(N),contourInk=new Uint8Array(N);
    // the crotch does not move with the belly, and the frame's lower edge is set from the unpregnant groin line: draw
    // that one (the pregnant references drew it lower, past the frame, or left it out under the belly)
    const rest=frame.fig.restGroin,all=frame.fig.manualLines||[],lines=rest?[...all.filter(l=>l.kind!=='groin_contour'),rest]:all;
    // where the fold under the belly crosses the groin, the belly hangs over it: the groin above the fold is hidden
    const foldLow=new Float32Array(W).fill(-1);
    for(const line of all)if(line.kind==='belly_fold'&&(line.strength??1)>=0.3)for(const p of sampleContourLine(line)){const [x,y]=frame.fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP]).map(Math.round);if(x>=0&&x<W)foldLow[x]=Math.max(foldLow[x],y)}
    for(const line of lines){if(line.layer==='guide'||line.kind==='belly_turn'||line.kind==='linea')continue;
      const cupFade=line.kind==='breast_contour'||line.kind==='cleavage'?cupInk(frame.fig.cup):1,level=(line.strength??1)*cupFade;
      if(level<0.3)continue;
      const ink=level<0.7?3:1;   // 1 full, 3 faint (2 is a guide drawn on bare skin)
      const src=line;
      const bodyGuide=frame.fig.reviewedModel&&((line.layer==='bra'&&!frame.fig.layerVisibility.bra)||(line.layer==='shorts'&&!frame.fig.layerVisibility.shorts));
      const target=bodyGuide?SKIN:material[line.layer];let previous=null;
      const onBelly=line.kind==='belly_fold'&&frame.fig.bellyMove;   // the fold under the belly rides its wobble, contractions and pushes
      for(const p of sampleContourLine(src)){const warped=frame.fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP]);if(onBelly){const [mx,my]=frame.fig.bellyMove(warped[0],warped[1]);warped[0]+=mx;warped[1]+=my}const next=warped.map(Math.round);if(previous){let [x,y]=previous;const [endX,endY]=next,dx=Math.abs(endX-x),dy=-Math.abs(endY-y),sx=x<endX?1:-1,sy=y<endY?1:-1;let error=dx+dy;
        for(let guard=0;guard<10000;guard++){const i=y*W+x;if(x>=0&&x<W&&y>=0&&y<H&&frame.label[i]===target&&(!bodyGuide||frame.owner[i]===1)&&!(line.kind==='groin_contour'&&y<=foldLow[x])){stroke[i]=Math.min(stroke[i]||4,bodyGuide?2:ink);if(line.kind==='cleavage')cleftInk[i]=1;else if(line.kind==='breast_contour')contourInk[i]=1}if(x===endX&&y===endY)break;const twice=2*error;if(twice>=dy){error+=dy;x+=sx}if(twice<=dx){error+=dx;y+=sy}}
      }previous=next}
    }
    // 小罩杯时两条乳房轮廓线的上段贴着乳沟线往上走，三条线挤在三四格里像「川」字：
    // 同一列左右 2 格内有乳沟线的轮廓线不画，剩下乳沟一条线，往下才分成两边的乳下线
    if(mergeChestLines)for(let i=0;i<N;i++)if(contourInk[i]&&!cleftInk[i]){const x=i%W;for(let d=-2;d<=2;d++)if(x+d>=0&&x+d<W&&cleftInk[i+d]){stroke[i]=0;break}}
    let count=0,guides=0;for(let i=0;i<N;i++)if(stroke[i]){const label=frame.label[i];put(i%W,i/W|0,stroke[i]===2?PAL.skin[1]:label===BRA?PAL.bra[0]:label===SHORTS?PAL.crease:stroke[i]===3?PAL.skin[1]:PAL.skin[0]);count++;if(stroke[i]===2)guides++}frame.bodyGuidePixels=guides;return count;
  }
  // Linea nigra: a pigment line down the middle of the belly, not a crease. It appears after 20 weeks and darkens and
  // lengthens toward term; drawn one tone darker than the skin under it and broken every few cells, so it reads as
  // colour rather than a cut. The author's 'linea' line gives its course (interpolated like the others, drawn from the
  // end nearest the navel); without one it runs down from the navel parallel to the belly's front outline.
  function paintLinea(frame,put,vx,vy){
    const fig=frame.fig,days=clamp(Number(fig.days)||0,0,MAX_DAYS),grow=clamp((days-140)/140,0,1);
    if(grow<=0)return;
    const onBelly=(x,y)=>x>=0&&x<W&&y>=0&&y<H&&frame.visibleBelly[y*W+x];
    const dense=pts=>{const out=[];for(let k=1;k<pts.length;k++){const n=Math.max(1,Math.ceil(Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1])*2));for(let j=0;j<n;j++)out.push([pts[k-1][0]+(pts[k][0]-pts[k-1][0])*j/n,pts[k-1][1]+(pts[k][1]-pts[k-1][1])*j/n])}return out};
    // two runs out of the navel: down toward the pubis (first, and longest) and up toward the chest (late)
    let down=[],up=[];
    const author=(fig.manualLines||[]).find(l=>l.kind==='linea');
    if(author){
      let pts=dense(author.points.map(p=>{const q=fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP]);if(fig.bellyMove){const [mx,my]=fig.bellyMove(q[0],q[1]);q[0]+=mx;q[1]+=my}return q}));
      if(pts.at(-1)[1]<pts[0][1])pts=pts.reverse();
      // the line always passes through the navel: move it so its nearest point sits on the navel
      let k=0;pts.forEach((p,j)=>{if(Math.hypot(p[0]-vx,p[1]-vy)<Math.hypot(pts[k][0]-vx,pts[k][1]-vy))k=j});
      const dx=vx-pts[k][0],dy=vy-pts[k][1];pts=pts.map(p=>[p[0]+dx,p[1]+dy]);
      down=pts.slice(k);up=pts.slice(0,k+1).reverse();
    }else{
      const front=y=>{for(let x=0;x<W;x++)if(onBelly(x,y))return x;return NaN},offset=vx-front(vy);
      if(Number.isNaN(offset))return;
      for(let y=vy;y<H;y++){const f=front(y);if(Number.isNaN(f))break;down.push([f+offset,y])}
    }
    const seen=new Set();
    const run=(path,share)=>{let step=0;
      for(let k=0;k<Math.round(path.length*share);k++){
        const x=Math.round(path[k][0]),y=Math.round(path[k][1]),key=y*W+x;
        if(seen.has(key)||!onBelly(x,y)||Math.abs(x-vx)+Math.abs(y-vy)<2)continue;seen.add(key);step++;
        if(step%(grow>0.6?4:3)===0)continue;                      // broken: pigment, not a cut
        put(x,y,PAL.skin[Math.max(1,frame.tone[key]-1)]);
      }};
    run(down,0.35+0.65*grow);run(up,clamp((grow-0.4)/0.6,0,1));
  }

  /**
   * 成图 → 固定画框的像素。身体贴底：取景的下缘（胯下）对齐画框下缘，上方补背景，
   * 所以娇小体型画得小、上方留空，画框本身不随体型或罩杯跳动。
   * @returns { width, height, pixels: Uint32Array（小端 RGBA，可直接包成 ImageData）, offsetX, offsetY, view }
   */
  function paint(frame, palette = BELLY_DEFAULT_PALETTE) {
    usePalette(palette);
    const view = frame.view;
    const pixels = new Uint32Array(FRAME.width * FRAME.height).fill(rgba(PAL.bg));
    const offsetX = Math.floor((FRAME.width - view.w) / 2) - view.x;
    const offsetY = FRAME.height - view.h - view.y;
    const put = (x, y, color) => {
      if (x < view.x || x >= view.x + view.w || y < view.y || y >= view.y + view.h) return;
      const px = x + offsetX;
      const py = y + offsetY;
      if (px < 0 || px >= FRAME.width || py < 0 || py >= FRAME.height) return;
      pixels[py * FRAME.width + px] = rgba(color);
    };
    const { label, fig, layers } = frame;
    const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? 0 : label[y * W + x]);
    const bulk = fig.bulk;
    for (const id of ['body', 'shorts', 'belly', 'bra']) {
      if (!fig.layerVisibility[id]) continue;
      const { mask, tone } = layers[id];
      const cloth = id === 'bra' || id === 'shorts';
      const pal = id === 'bra' ? PAL.bra : id === 'shorts' ? PAL.shorts : PAL.skin;
      const inLayer = (x, y) => x >= 0 && x < W && y >= 0 && y < H && mask[y * W + x];
      for (let y = view.y; y < view.y + view.h; y += 1) {
        for (let x = view.x; x < view.x + view.w; x += 1) {
          const i = y * W + x;
          if (!mask[i]) continue;
          // 画框上缘切过身体，不是轮廓（各参考在那里停在不同的列）
          const outer = at(x - 1, y) === 0 || at(x + 1, y) === 0 || (y <= view.y ? false : at(x, y - 1) === 0) || at(x, y + 1) === 0;
          const edge = cloth && (!inLayer(x - 1, y) || !inLayer(x + 1, y) || !inLayer(x, y - 1) || !inLayer(x, y + 1));
          const rim = id === 'belly' && bulk >= 0.5 && x < (508 - X0) / STEP && (at(x, y + 1) === SHORTS || at(x - 1, y + 1) === SHORTS || at(x + 1, y + 1) === SHORTS);
          const shade = Math.min(tone[i], pal.length - 1);
          const touch = id === 'belly' && frame.contact?.[i];
          put(x, y, outer ? PAL.line
            : touch ? PAL.skin[Math.max(0, Math.min(bulk >= 1.5 ? 1 : 2, shade - (bulk >= 1.5 ? 2 : 1)))]
              : edge ? pal[Math.max(0, shade - 1)]
                : rim ? PAL.skin[Math.max(1, shade - 1)]
                  : pal[shade]);
        }
      }
    }
    // 肚脐依孕肚大小：凹、5 起变平、7（单胎足月）起外凸、10 起大凸；跟着孕肚的晃动与宫缩移动
    const nvx = (fig.navel[0] - X0) / STEP;
    const nvy = (fig.navel[1] - Y0) / STEP;
    const [nmx, nmy] = fig.bellyMove ? fig.bellyMove(nvx, nvy) : [0, 0];
    const vx = Math.round(nvx + nmx);
    const vy = Math.round(nvy + nmy);
    const p = fig.pressure || 0;
    const bellyPut = (x, y, color) => { if (x >= 0 && x < W && y >= 0 && y < H && frame.visibleBelly[y * W + x]) put(x, y, color); };
    paintContourLines(frame, put);
    paintLinea(frame, put, vx, vy);
    paintNipples(frame, put);
    if (vx >= 0 && vx < W && vy >= 0 && vy < H && frame.visibleBelly[vy * W + vx]) {
      if (p >= 10) { bellyPut(vx - 1, vy - 1, PAL.skin[4]); bellyPut(vx, vy - 1, PAL.skin[4]); bellyPut(vx - 1, vy, PAL.skin[3]); bellyPut(vx, vy, PAL.skin[2]); bellyPut(vx + 1, vy, PAL.skin[1]); bellyPut(vx, vy + 1, PAL.skin[1]); }
      else if (p >= 7) { bellyPut(vx, vy - 1, PAL.skin[4]); bellyPut(vx, vy, PAL.skin[2]); bellyPut(vx + 1, vy, PAL.skin[1]); }
      else if (p >= 5) { bellyPut(vx, vy, PAL.skin[1]); bellyPut(vx + 1, vy, PAL.skin[2]); }
      else { bellyPut(vx, vy, PAL.line); bellyPut(vx, vy - 1, PAL.skin[1]); bellyPut(vx + 1, vy, PAL.skin[2]); }
    }
    return { width: FRAME.width, height: FRAME.height, pixels, offsetX, offsetY, view };
  }

  /**
   * 动画用的分层静止画面（整张格点座标，0 是透明）：belly 只有看得见的孕肚（含画在它上面的线、肚脐），
   * under 是其余全部（孕肚后面的身体也画出来，孕肚移开时才不会露出空洞）。
   * 两层照原位叠起来（孕肚在上）就是 paint() 的画面。
   */
  function paintLayers(frame, palette = BELLY_DEFAULT_PALETTE) {
    usePalette(palette);
    const view = frame.view;
    const under = new Uint32Array(N);
    const belly = new Uint32Array(N);
    // 乳头另外一层：动画里它比乳房慢半拍
    const nipples = new Uint32Array(N);
    const { label, fig, layers, owner } = frame;
    const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? 0 : label[y * W + x]);
    const bulk = fig.bulk;
    for (const id of ['body', 'shorts', 'belly', 'bra']) {
      if (!fig.layerVisibility[id]) continue;
      const { mask, tone } = layers[id];
      const cloth = id === 'bra' || id === 'shorts';
      const pal = id === 'bra' ? PAL.bra : id === 'shorts' ? PAL.shorts : PAL.skin;
      const inLayer = (x, y) => x >= 0 && x < W && y >= 0 && y < H && mask[y * W + x];
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = y * W + x;
          if (!mask[i]) continue;
          // 孕肚层只收归属是孕肚的格子；被胸衣盖住的孕肚不画
          if (id === 'belly' && owner[i] !== 3) continue;
          const outer = at(x - 1, y) === 0 || at(x + 1, y) === 0 || (y <= view.y ? false : at(x, y - 1) === 0) || at(x, y + 1) === 0;
          const edge = cloth && (!inLayer(x - 1, y) || !inLayer(x + 1, y) || !inLayer(x, y - 1) || !inLayer(x, y + 1));
          const rim = id === 'belly' && bulk >= 0.5 && x < (508 - X0) / STEP && (at(x, y + 1) === SHORTS || at(x - 1, y + 1) === SHORTS || at(x + 1, y + 1) === SHORTS);
          const shade = Math.min(tone[i], pal.length - 1);
          const touch = id === 'belly' && frame.contact?.[i];
          const color = outer ? PAL.line
            : touch ? PAL.skin[Math.max(0, Math.min(bulk >= 1.5 ? 1 : 2, shade - (bulk >= 1.5 ? 2 : 1)))]
              : edge ? pal[Math.max(0, shade - 1)]
                : rim ? PAL.skin[Math.max(1, shade - 1)]
                  : pal[shade];
          if (id === 'belly') belly[i] = rgba(color); else if (owner[i] !== 3 || id === 'body') under[i] = rgba(color);
        }
      }
    }
    const put = (x, y, color) => {
      if (x < view.x || x >= view.x + view.w || y < view.y || y >= view.y + view.h) return;
      const i = y * W + x;
      if (owner[i] === 3) belly[i] = rgba(color); else under[i] = rgba(color);
    };
    const nvx = (fig.navel[0] - X0) / STEP;
    const nvy = (fig.navel[1] - Y0) / STEP;
    const vx = Math.round(nvx);
    const vy = Math.round(nvy);
    const p = fig.pressure || 0;
    const bellyPut = (x, y, color) => { if (x >= 0 && x < W && y >= 0 && y < H && frame.visibleBelly[y * W + x]) put(x, y, color); };
    paintContourLines(frame, put);
    paintLinea(frame, put, vx, vy);
    paintNipples(frame, (x, y, color) => { if (x >= view.x && x < view.x + view.w && y >= view.y && y < view.y + view.h) nipples[y * W + x] = rgba(color); });
    if (vx >= 0 && vx < W && vy >= 0 && vy < H && frame.visibleBelly[vy * W + vx]) {
      if (p >= 10) { bellyPut(vx - 1, vy - 1, PAL.skin[4]); bellyPut(vx, vy - 1, PAL.skin[4]); bellyPut(vx - 1, vy, PAL.skin[3]); bellyPut(vx, vy, PAL.skin[2]); bellyPut(vx + 1, vy, PAL.skin[1]); bellyPut(vx, vy + 1, PAL.skin[1]); }
      else if (p >= 7) { bellyPut(vx, vy - 1, PAL.skin[4]); bellyPut(vx, vy, PAL.skin[2]); bellyPut(vx + 1, vy, PAL.skin[1]); }
      else if (p >= 5) { bellyPut(vx, vy, PAL.skin[1]); bellyPut(vx + 1, vy, PAL.skin[2]); }
      else { bellyPut(vx, vy, PAL.line); bellyPut(vx, vy - 1, PAL.skin[1]); bellyPut(vx + 1, vy, PAL.skin[2]); }
    }
    return {
      under, belly, nipples, view, ghost: rgba(PAL.ghost || PAL.line), bra: PAL.bra.map(rgba), shorts: PAL.shorts.map(rgba), milk: PAL.milk.map(rgba), smoke: PAL.smoke.map(rgba), background: rgba(PAL.bg), line: rgba(PAL.line), skin: PAL.skin.map(rgba),
      offsetX: Math.floor((FRAME.width - view.w) / 2) - view.x, offsetY: FRAME.height - view.h - view.y,
    };
  }

  return { frame: FRAME, paint, paintLayers, parts: { paintContourLines, paintLinea, paintNipples, usePalette } };
}
