// 孕体特写的版面计算：烘好的参考资料（belly_data.js）＋ 状态 → 一张静止画面的成图（标注、图层归属、明暗）。
// 纯计算，不碰 DOM；浏览器与 Node 测试共用。上色与动画在 belly_render.js。
//
// 取形与成图的规则移植自预览页 PREGNANCY_TRACE_NUDE.html（做法与历次修正见 plan/PREGNANCY_TRACE_NUDE.md），
// 函式内文保持预览页的写法（含英文注解），方便逐格对照；与预览页不同的只有资料来源：
//   - 参考资料来自烘好的档案：±1.5σ 对位、借量测已在烘焙时做完，这里不再做；
//   - 距离场用到才算：每张参考的每个栏位第一次读取时才建，并以最近使用为序保留有限张数；
//   - 孕况之间的三次内插只读相邻的四张（预览页一次读六张）；
//   - 各体型的取景范围读烘好的值（要全部 210 张的距离场才算得出来）。
// 一个画面最多用到 2 体型 × 2 罩杯 × 4 孕况 ＝ 16 张参考。

import { getFetalGrowth } from './fetal_growth.js';

/** 成图里可以个别关掉的修补规则（除错与测试用） */
export const BELLY_SKIP_FIXES = Object.freeze(['repair', 'backTop', 'breastArc', 'bellyArc', 'cleanup', 'shortsBand', 'waistband', 'strapTop', 'braWedge', 'chestSeam', 'nippleSide', 'manual', 'bellyTurnSeam']);
/** 预览页没有、插件新加的规则（与预览页逐格对照时要关掉） */
export const BELLY_NEW_FIXES = Object.freeze(['backTop', 'breastArc', 'bellyArc', 'strapTop', 'braWedge', 'chestSeam', 'nippleSide', 'manual', 'bellyTurnSeam']);

/**
 * @param data decodeBellyData() 的结果
 * @param options { skip: 要关掉的修补规则, maxLiveAnchors: 同时保留距离场的参考张数（预设 24） }
 */
export function createBellyLayout(data, options = {}) {
  const [X0,Y0]=data.grid.crop,STEP=data.grid.step,W=data.grid.width,H=data.grid.height,N=W*H;
  const skipFixes=new Set(options.skip||[]);
  // 手修的修正点（assets/belly/closeup-patches.json，由作者机器上的编辑器存出）：见 patchWeights
  let patches=Array.isArray(options.patches)?options.patches:[];
  const MAX_LIVE_ANCHORS=options.maxLiveAnchors??24;
  const stats={fieldBuilds:0,anchorBuilds:0,evictions:0};
  const EDT_SIZE=Math.max(W,H),EDT_D=new Float64Array(EDT_SIZE),EDT_V=new Int32Array(EDT_SIZE),EDT_Z=new Float64Array(EDT_SIZE+1),EDT_F=new Float64Array(H),EDT_G=new Float64Array(N);

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const SKIN=1,BRA=2,SHORTS=3,TRIM=4,LEGS=5;
  const CUPS=[['AAA',0],['B',30],['D',50],['G',80],['I',100],['L',130],['N',150]],CUP_MAX=150,SIGMAS=[-3,-1.5,0,1.5,3],STAGES=['empty','mid','late','twins','triplets','quint'];
  // nude, so a small chest has almost no outline or crease: none up to A, faint at B, full from C
  const cupInk=cup=>clamp((cup-20)/20,0,1);
  // Cup, like clothing pressure, runs 0–15 (shown ×10 here: AAA 0 … I 100 … N 150, ten per cup). The AI could not
  // draw past I, so J–N take the I upper body (chest, torso and back above the under-bust) and enlarge it: across from
  // the chest's middle, so the near breast grows forward and the far one back, and downward from the top edge.
  // At N the chest is as wide as this body type's twins-term belly.
  const cupWeights=cup=>knotWeights(CUPS.map(c=>c[1]),clamp(cup,0,CUP_MAX));
  // the first row every weighted reference picture covers (the pictures are cropped at different heights)
  const panelTop=a=>Math.max(0,Math.ceil((a.rect[1]-Y0)/STEP));
  function dataTop(sigmas,cups,stages){
    let top=0;
    for(const [si,ws]of sigmas)for(const [ci,wc]of cups)for(const [bi,wb]of stages)if(ws*wc*wb>0)top=Math.max(top,panelTop(anchorOf(SIGMAS[si],CUPS[ci][0],STAGES[bi])));
    return top;
  }
  const MAX_PRESSURE=15,MAX_DAYS=364,BULK_MAX=5+(MAX_PRESSURE-13)/1.5;
  const UB_SAMPLES=24;
  // (暂存阵列共用：每次建场要跑几万次，逐次配置很慢；回传的 d 在下一次呼叫前有效)
  function edt1(f,n){
    const d=EDT_D,v=EDT_V,z=EDT_Z;let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
    for(let q=1;q<n;q++){
      let s;while(true){const p=v[k];s=((f[q]+q*q)-(f[p]+p*p))/(2*q-2*p);if(s<=z[k]){k--;if(k<0){k=0;break}}else break}
      k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
    }
    k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;const p=v[k];d[q]=(q-p)*(q-p)+f[p]}
    return d;
  }
  function distanceTo(mask){
    const INF=1e12,g=EDT_G;
    for(let x=0;x<W;x++){const f=EDT_F;for(let y=0;y<H;y++)f[y]=mask[y*W+x]?0:INF;const d=edt1(f,H);for(let y=0;y<H;y++)g[y*W+x]=d[y]}
    const out=new Float32Array(N);
    for(let y=0;y<H;y++){const d=edt1(g.subarray(y*W,y*W+W),W);for(let x=0;x<W;x++)out[y*W+x]=Math.sqrt(d[x])}
    return out;
  }
  // negative inside; the crop border is not an edge
  function signedField(mask){
    // (逐格回圈：TypedArray.from 带回呼在这里慢好几倍，结果相同)
    const inverse=new Uint8Array(N);for(let i=0;i<N;i++)inverse[i]=mask[i]?0:1;
    const inside=distanceTo(inverse),outside=distanceTo(mask),out=new Float32Array(N);
    for(let i=0;i<N;i++)out[i]=mask[i]?-(inside[i]-0.5):outside[i]-0.5;
    return out;
  }
  // (预览页还带 trim，成图没用到)
  const KEYS=['torso','bra','belly','shorts','legs'];
  // The belly is in front of the shorts and thighs: where a bigger belly hides them they still count as present
  // (inside the area they ever take in that figure's references), so they stay put until the belly covers them.
  function componentNear(skin,point){
    const px=point?(point[0]-X0)/STEP:W/2,py=point?(point[1]-Y0)/STEP:H*0.55;
    let seed=-1,nearest=Infinity;
    for(let i=0;i<N;i++)if(skin[i]){const d=(i%W-px)**2+((i/W|0)-py)**2;if(d<nearest){nearest=d;seed=i}}
    const out=new Uint8Array(N);if(seed<0)return out;
    const queue=[seed];out[seed]=1;
    for(let q=0;q<queue.length;q++){const i=queue[q],x=i%W,y=i/W|0;
      for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;const j=ny*W+nx;if(skin[j]&&!out[j]){out[j]=1;queue.push(j)}}}
    return out;
  }
  function strapProfiles(a){
    const mid=(a.measure.neck[0]-X0)/STEP,bounds=maskBounds(a.parts.bra);
    return [0,1].map(side=>{
      const values=[];
      for(let y=0;y<=24;y++){
        const xs=[];for(let x=0;x<W;x++)if(a.parts.bra[y*W+x]&&(side?x>mid:x<mid))xs.push(x);
        values.push(xs.length?{x:side?xs[0]+1:xs.at(-1)-1,w:3.5}:null);
      }
      const first=values.findIndex(Boolean),fallback=side?bounds.r-1:bounds.l+1;
      if(first<0)return values.map((_,y)=>[fallback,y,3.5]);
      for(let y=0;y<first;y++){
        const later=Math.min(24,first+3),b=values[later]||values[first],slope=(b.x-values[first].x)/Math.max(1,later-first);
        values[y]={x:values[first].x+clamp(slope,-0.5,0.5)*(y-first),w:3.5};
      }
      for(let y=first+1;y<=24;y++)if(!values[y])values[y]={...values[y-1]};
      return values.map((v,y)=>{const before=values[Math.max(0,y-1)],after=values[Math.min(24,y+1)];return[(before.x+2*v.x+after.x)/4,y,v.w]});
    });
  }
  const BODY_FIELDS=['support','body','legVoid'];
  // (预览页还算 breastRelief，成图已不用)
  const RELIEF_FIELDS=['creaseRelief'];
  function outsideBackground(mask){
    const outside=new Uint8Array(N),queue=[];
    const add=i=>{if(!mask[i]&&!outside[i]){outside[i]=1;queue.push(i)}};
    for(let x=0;x<W;x++){add(x);add((H-1)*W+x)}for(let y=0;y<H;y++){add(y*W);add(y*W+W-1)}
    for(let h=0;h<queue.length;h++){const i=queue[h],x=i%W,y=i/W|0;for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<W&&yy>=0&&yy<H)add(yy*W+xx)}}
    return outside;
  }
  function fillBodyHoles(mask,protectedSpace){
    const outside=outsideBackground(mask);let count=0;
    for(let i=0;i<N;i++)if(!mask[i]&&!outside[i]&&!protectedSpace?.[i]){mask[i]=1;count++}
    return count;
  }
  // Relax short inward dents on the continuous row-boundary curve, then rasterise.
  // The displacement is at most one cell; broad waist curves and inner leg gaps stay.
  function softenBodyNotches(mask,protectedSpace){
    const spans=Array.from({length:H},(_,y)=>rowSpan(mask,y));let added=0;
    for(let y=2;y<H-2;y++){
      const span=spans[y];if(!span)continue;
      for(const side of[0,1]){const neighbours=[-2,-1,1,2].map(d=>spans[y+d]?.[side]);if(neighbours.some(v=>v===undefined))continue;
        const target=(neighbours[0]+2*neighbours[1]+2*neighbours[2]+neighbours[3])/6;
        if(neighbours.some(v=>Math.abs(v-span[side])>4))continue;
        const dent=side?target-span[side]:span[side]-target;if(dent<0.8||dent>2.1)continue;
        const x=span[side]+(side?1:-1),i=y*W+x;if(x>=0&&x<W&&!mask[i]&&!protectedSpace?.[i]){mask[i]=1;added++}
      }
    }
    return added;
  }
  function sourceBodyFields(a){
    const [tx,ty,right,bottom]=a.rect,neckLimit=a.measure.neck[1]+3*STEP;
    const neck=Uint8Array.from(a.parts.neck,(v,i)=>{const x=X0+(i%W+0.5)*STEP,y=Y0+((i/W|0)+0.5)*STEP;return v&&x>=tx&&x<right&&y>=ty&&y<bottom&&y<=neckLimit?1:0});
    // Below the neckline limit, bare skin that is not the belly (the band under the top where the author's belly mask
    // starts lower) is the torso too; without it the chest came loose from the body and was cleared as an island.
    // (Above the limit only the skin joined to the neckline counts: the shoulders' and arms' islands are not body.)
    const torsoSkin=Uint8Array.from(a.parts.neck,(v,i)=>{const x=X0+(i%W+0.5)*STEP,y=Y0+((i/W|0)+0.5)*STEP;return v&&x>=tx&&x<right&&y>=ty&&y<bottom&&y>neckLimit?1:0});
    const cleanNeck=componentNear(neck,a.measure.neck).map((v,i)=>v||torsoSkin[i]),pants=maskBounds(a.parts.shorts);
    // LEGS contains both thighs. Keeping only the largest would delete a real leg.
    const legs=Uint8Array.from(a.parts.legs||new Uint8Array(N),(v,i)=>v&&(i/W|0)>=pants.t?1:0);
    const legVoid=new Uint8Array(N);
    for(let y=Math.max(0,pants.b-3);y<H;y++){
      const runs=[];for(let x=0;x<W;x++)if(legs[y*W+x]){const start=x;while(x+1<W&&legs[y*W+x+1])x++;runs.push([start,x])}
      if(runs.length<2)continue;const major=runs.filter(([l,r])=>r-l>=2);
      for(let j=0;j<major.length-1;j++)for(let x=major[j][1]+1;x<major[j+1][0];x++){const i=y*W+x;if(!a.parts.shorts[i]&&!a.parts.belly[i])legVoid[i]=1}
    }
    const support=Uint8Array.from(cleanNeck,(v,i)=>v||a.parts.bra[i]||a.parts.belly[i]||a.parts.shorts[i]||legs[i]?1:0);
    const body=Uint8Array.from(cleanNeck,(v,i)=>{
      const x=i%W,cloth=a.parts.bra[i]||a.parts.shorts[i];
      // A conservative interior under fabric, not the shorts' flared outer silhouette.
      const core=cloth&&x>0&&x<W-1&&(a.parts.bra[i-1]||a.parts.shorts[i-1])&&(a.parts.bra[i+1]||a.parts.shorts[i+1]);
      return v||a.parts.belly[i]||legs[i]||core?1:0;
    });
    // Shoulder/chest cap behind the straps, only where this image has source pixels.
    for(let y=Math.max(0,Math.ceil((ty-Y0)/STEP));y<=Math.min(H-1,Math.floor((neckLimit-Y0)/STEP));y++){
      const span=rowSpan(support,y);if(!span)continue;
      for(let x=span[0];x<=span[1];x++)if(!legVoid[y*W+x])body[y*W+x]=support[y*W+x]=1;
    }
    fillBodyHoles(support,legVoid);softenBodyNotches(support,legVoid);
    fillBodyHoles(body,legVoid);softenBodyNotches(body,legVoid);
    return{support,body,legVoid,legs,neck:cleanNeck};
  }
  function rasterSourceLine(line){
    const mask=new Uint8Array(N);let previous=null;
    for(const point of sampleContourLine(line)){
      const next=point.map((v,k)=>Math.round((v-(k?Y0:X0))/STEP));
      if(previous){let[x,y]=previous;const[ex,ey]=next,dx=Math.abs(ex-x),dy=-Math.abs(ey-y),sx=x<ex?1:-1,sy=y<ey?1:-1;let error=dx+dy;
        for(let guard=0;guard<10000;guard++){if(x>=0&&x<W&&y>=0&&y<H)mask[y*W+x]=1;if(x===ex&&y===ey)break;const twice=2*error;if(twice>=dy){error+=dy;x+=sx}if(twice<=dx){error+=dx;y+=sy}}}
      previous=next;
    }
    return mask;
  }
  function sourceReliefFields(a){
    const crease=new Float32Array(N),cup=CUPS.find(([name])=>name===a.cup)[1]/100;
    for(const line of a.manualLines||[]){
      const raster=rasterSourceLine(line);
      // These are shallow illustration guides, not inferred anatomical detail.
      const chest=line.kind==='cleavage'||line.kind==='breast_contour',fade=chest?cupInk(cup*100):1;
      if(fade<=0)continue;
      const distance=distanceTo(raster),amplitude=(line.kind==='cleavage'?0.035:line.kind==='groin_contour'?0.018:0.012)*fade;
      for(let i=0;i<N;i++)crease[i]+=amplitude*Math.exp(-0.5*(distance[i]/1.1)**2);
    }
    return{creaseRelief:smoothField(crease)};
  }
  // Monotone cubic (Fritsch–Carlson) through the stage knots; past the last knot the last slope continues
  function pchipSlopes(xs,ys){
    const n=xs.length,d=[],m=new Array(n);
    for(let i=0;i<n-1;i++)d.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]));
    m[0]=d[0];m[n-1]=d[n-2];
    for(let i=1;i<n-1;i++){
      if(d[i-1]*d[i]<=0){m[i]=0;continue}
      const w1=2*(xs[i+1]-xs[i])+(xs[i]-xs[i-1]),w2=(xs[i+1]-xs[i])+2*(xs[i]-xs[i-1]);
      m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
    }
    return m;
  }
  function pchip(xs,ys,x){
    const n=xs.length;
    if(x>=xs[n-1])return ys[n-1]+(x-xs[n-1])*(ys[n-1]-ys[n-2])/(xs[n-1]-xs[n-2]);
    if(x<=xs[0])return ys[0];
    let i=0;while(x>xs[i+1])i++;
    const m=pchipSlopes(xs,ys),h=xs[i+1]-xs[i],t=(x-xs[i])/h;
    return(2*t**3-3*t*t+1)*ys[i]+(t**3-2*t*t+t)*h*m[i]+(-2*t**3+3*t*t)*ys[i+1]+(t**3-t*t)*h*m[i+1];
  }
  // Per cell the same cubic, done with Hermite basis weights for the segment and slopes from the neighbours.
  // (get(k) 回传第 k 个孕况的场：只读用到的相邻四张，算式与预览页相同)
  function pchipField(xs,get,x){
    const n=xs.length,out=new Float32Array(N);
    const xc=clamp(x,xs[0],BULK_MAX);
    let i=0;while(i<n-2&&xc>xs[i+1])i++;
    if(xc>=xs[n-1]){const a=get(n-2),b=get(n-1),k=(xc-xs[n-1])/(xs[n-1]-xs[n-2]);for(let j=0;j<N;j++)out[j]=b[j]+(b[j]-a[j])*k;return out}
    const h=xs[i+1]-xs[i],t=(xc-xs[i])/h,h00=2*t**3-3*t*t+1,h10=t**3-2*t*t+t,h01=-2*t**3+3*t*t,h11=t**3-t*t;
    const A=get(i),B=get(i+1),P=i>0?get(i-1):null,Q=i+1<n-1?get(i+2):null;
    const slope=(k,L,F,R,j)=>{
      const dl=L?(F[j]-L[j])/(xs[k]-xs[k-1]):null,dr=R?(R[j]-F[j])/(xs[k+1]-xs[k]):null;
      if(dl===null)return dr;if(dr===null)return dl;if(dl*dr<=0)return 0;
      const w1=2*(xs[k+1]-xs[k])+(xs[k]-xs[k-1]),w2=(xs[k+1]-xs[k])+2*(xs[k]-xs[k-1]);return(w1+w2)/(w1/dl+w2/dr);
    };
    for(let j=0;j<N;j++)out[j]=h00*A[j]+h10*h*slope(i,P,A,B,j)+h01*B[j]+h11*h*slope(i+1,A,B,Q,j);
    return out;
  }

  // ---- 参考：遮罩与距离场用到才建 ----
  const live=[];
  function touch(anchor){
    const at=live.indexOf(anchor);
    if(at>=0&&at===live.length-1)return;
    if(at>=0)live.splice(at,1);
    live.push(anchor);
    while(live.length>MAX_LIVE_ANCHORS){live.shift().release();stats.evictions++}
  }
  function makeAnchor(src){
    const a={key:src.key,sigma:src.sigma,cup:src.cup,stage:src.stage,bulk:src.bulk,crotch:src.crotch,rect:src.rect,measure:src.measure,manualLines:src.lines};
    let parts=null,bodyParts=null,relief=null,fields={};
    Object.defineProperty(a,'cls',{get:()=>src.labels});
    Object.defineProperty(a,'parts',{get(){
      touch(a);
      if(!parts){
        // 一趟回圈切出各材质的遮罩（与预览页 buildFields 的完成轮廓分支相同）
        const cls=src.labels,srcBelly=src.belly,belly=new Uint8Array(N),bra=new Uint8Array(N),shorts=new Uint8Array(N),trim=new Uint8Array(N);
        const legs=new Uint8Array(N),neck=new Uint8Array(N),upper=new Uint8Array(N),torso=new Uint8Array(N);
        for(let i=0;i<N;i++){
          const v=cls[i],b=srcBelly[i]?1:0;
          belly[i]=b;
          if(v===BRA)bra[i]=1;
          if(v===SHORTS||v===TRIM)shorts[i]=1;
          if(v===TRIM)trim[i]=1;
          if(v===LEGS)legs[i]=1;
          if(v===SKIN&&!b)neck[i]=1;
          if(bra[i]||neck[i])upper[i]=1;
          if(upper[i]||b||shorts[i])torso[i]=1;
        }
        parts={bra,belly,neck,shorts,trim,legs,upper,torso};stats.anchorBuilds++;
      }
      return parts;
    }});
    Object.defineProperty(a,'bodyParts',{get(){touch(a);return bodyParts??=sourceBodyFields(a)}});
    const sdf={};
    const field=(key,build)=>Object.defineProperty(sdf,key,{enumerable:true,get(){touch(a);if(!fields[key]){fields[key]=build();stats.fieldBuilds++}return fields[key]}});
    for(const key of['bra','belly','neck','shorts','legs','torso'])field(key,()=>signedField(a.parts[key]));
    for(const key of BODY_FIELDS)field(key,()=>signedField(a.bodyParts[key]));
    for(const key of RELIEF_FIELDS)field(key,()=>(relief??=sourceReliefFields(a))[key]);
    a.sdf=sdf;
    a.release=()=>{parts=bodyParts=relief=null;fields={}};
    return a;
  }
  const ANCHORS=data.anchors.map(makeAnchor);
  const anchorIndex=new Map(ANCHORS.map(a=>[a.key,a]));
  const anchorOf=(sigma,cup,stage)=>anchorIndex.get(`${sigma}/${cup}/${stage}`);
  const strapCache=new Map();
  const strapsOf=(sigma,cup)=>{const key=sigma+cup;if(!strapCache.has(key))strapCache.set(key,strapProfiles(anchorOf(sigma,cup,'empty')));return strapCache.get(key)};
  function computeCameras(){
    return Object.fromEntries(SIGMAS.map(sigma=>{const pants=maskBounds(anchorOf(sigma,'D','empty').parts.shorts);return[sigma,buildStableCamera(sigma,MODEL.bulks,pants.b+1)]}));
  }
  let cameras=data.header?.derived?.camera||null;
  const MODEL={
    bulks:STAGES.map(st=>anchorOf(0,'D',st).bulk),
    reviewed:Object.fromEntries(SIGMAS.flatMap(sigma=>CUPS.map(([cup])=>[sigma+'/'+cup,STAGES.map(stage=>anchorOf(sigma,cup,stage))]))),
    // 取景要全部参考的距离场才算得出来：正常读烘好的值，没有时（烘焙当下）才现算
    get camera(){return cameras??=computeCameras()},
    groinBottom:null,
  };
  MODEL.groinBottom=Object.fromEntries(SIGMAS.map(sigma=>{const lows=CUPS.map(([cup])=>{const a=anchorOf(sigma,cup,'empty'),pts=(a.manualLines||[]).filter(l=>l.kind==='groin_contour').flatMap(l=>l.points);return pts.length?Math.max(...pts.map(p=>p[1])):null}).filter(v=>v!==null);return[sigma,lows.length?(lows.reduce((n,v)=>n+v,0)/lows.length-Y0)/STEP+1:null]}));
  if(Object.values(MODEL.groinBottom).some(v=>v===null))MODEL.groinBottom=null;


  function knotWeights(knots,v){
    if(v<=knots[0])return[[0,1]];if(v>=knots.at(-1))return[[knots.length-1,1]];
    let i=0;while(v>knots[i+1])i++;const t=(v-knots[i])/(knots[i+1]-knots[i]);
    return[[i,1-t],[i+1,t]].filter(([,w])=>w>0);
  }
  // blend sampled curves; a missing one drops out and the rest are renormalised
  function blendCurves(list){
    const have=list.filter(([c])=>c),sum=have.reduce((n,[,w])=>n+w,0);
    if(!have.length||sum<=0)return null;
    return have[0][0].map((_,j)=>[0,1].map(k=>have.reduce((n,[c,w])=>n+c[j][k]*w,0)/sum));
  }
  const lerpFields=list=>{const out=new Float32Array(N);for(const [f,w]of list)for(let j=0;j<N;j++)out[j]+=f[j]*w;return out};
  function maskBounds(mask){let l=W,r=-1,t=H,b=-1;for(let i=0;i<N;i++)if(mask[i]){const x=i%W,y=i/W|0;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}return{l,r,t,b}}
  function buildStableCamera(sigma,bulks,bottom){
    // A shared top removes the part of the sprite for which no source panel exists.
    const top=Math.max(0,Math.ceil((Math.max(Y0,...ANCHORS.map(a=>a.rect[1]))-Y0)/STEP));
    if(bottom<=top)return{x:0,y:top,w:W,h:0};
    const limit=pchip([0,0.5,MID_PRESSURE,7,8.5,10,13,15],[0,0,0.5,1,2,3,5,BULK_MAX],12);
    const keys=['support','body','torso','bra','belly','shorts','legs'];
    let left=W,right=-1;
    const include=fields=>{
      for(let y=top;y<Math.min(H,bottom);y++)for(let x=0;x<W;x++){
        const i=y*W+x;if(fields.some(field=>field[i]<0)){left=Math.min(left,x);right=Math.max(right,x)}
      }
    };
    for(const[cup]of CUPS){
      const anchors=STAGES.map(stage=>anchorOf(sigma,cup,stage));
      const available=keys.filter(key=>anchors.every(a=>a.sdf[key]));
      for(let i=0;i<bulks.length;i++)if(bulks[i]<=limit)include(available.map(key=>anchors[i].sdf[key]));
      include(available.map(key=>pchipField(bulks,k=>anchors[k].sdf[key],limit)));
    }
    if(right<left){left=0;right=W-1}
    // Bounds cover the full build/hip sliders, breathing and a two-cell clear margin.
    const margin=11,x=Math.max(0,left-margin),edge=Math.min(W,right+margin+1);
    return{x,y:top,w:Math.max(1,edge-x),h:Math.min(H,bottom)-top};
  }
  function pressureOf(s){
    if(Number.isFinite(s.pressure))return clamp(s.pressure,0,MAX_PRESSURE);
    const days=clamp(Number(s.days)||0,0,MAX_DAYS);if(!days)return 0;
    const fetalBulk=s.count*getFetalGrowth(days,'human')*s.weight;
    return clamp(0.5+Math.min(1.25,days/280)**1.35*5+fetalBulk*1.5,0,MAX_PRESSURE);
  }
  // Reference-geometry coordinate only; the visible size control is pregnancy clothing pressure.
  // 孕中参考（单胎 20 周）的孕肚大小：照插件 1.4.1 起的人类型生长曲线（20 周份量 0.2）算，参考图才落在 20 周
  const MID_PRESSURE=0.5+0.5**1.35*5+getFetalGrowth(140,'human')*1.5;
  const bulkOf=s=>pchip([0,0.5,MID_PRESSURE,7,8.5,10,13,15],[0,0,0.5,1,2,3,5,BULK_MAX],pressureOf(s));
  function reviewedStageField(anchors,key,bulk){
    const exact=MODEL.bulks.findIndex(value=>Math.abs(value-bulk)<1e-7);
    return exact>=0?anchors[exact].sdf[key]:pchipField(MODEL.bulks,k=>anchors[k].sdf[key],bulk);
  }
  function reviewedStageNumber(anchors,read,bulk){return pchip(MODEL.bulks,anchors.map(read),bulk)}
  function reviewedUnderbust(anchors,bulk){
    const curves=anchors.map(a=>{const ub=a.measure.underbust||anchors[0].measure.underbust;return ub?Array.from({length:UB_SAMPLES},(_,j)=>{const x=ub.x[0]+(ub.x[1]-ub.x[0])*j/(UB_SAMPLES-1);return[(x-X0)/STEP,(ub.coef[0]*x*x+ub.coef[1]*x+ub.coef[2]-Y0)/STEP]}):null});
    if(curves.some(curve=>!curve))return blendCurves(knotWeights(MODEL.bulks,bulk).map(([i,w])=>[curves[i],w]));
    return curves[0].map((_,j)=>[0,1].map(k=>pchip(MODEL.bulks,curves.map(curve=>curve[j][k]),bulk)));
  }
  function reviewedFigureAt(sigma,cup,bulk){
    const lastBulk=MODEL.bulks.at(-1),stageBulk=clamp(bulk,0,lastBulk),cw=cupWeights(cup),bodyW=new Map(knotWeights(CUPS.map(c=>c[1]),clamp(cup,0,CUP_MAX)));
    const samples=cw.map(([i,w])=>{
      const anchors=MODEL.reviewed[sigma+'/'+CUPS[i][0]],fields={};
      for(const key of['bra','neck','belly','shorts','legs',...BODY_FIELDS,...RELIEF_FIELDS])fields[key]=reviewedStageField(anchors,key,stageBulk);
      let navel=[0,1].map(k=>reviewedStageNumber(anchors,a=>a.measure.navel[k],stageBulk));
      // Preserve the original pressure cap and post-five growth law. The pivot and
      // surface landmark now come from this cup's own reviewed references.
      let stretch=[0,0,1];
      if(bulk>lastBulk){
        const scale=(clamp(bulk,lastBulk,BULK_MAX)/lastBulk)**(1/3),raw=fields.belly,back=maskBounds(anchors[0].parts.shorts).r,top=(anchors.at(-1).measure.hem-Y0)/STEP;
        stretch=[back,top,scale];
        fields.belly=new Float32Array(N);
        for(let y=0;y<H;y++)for(let x=0;x<W;x++)fields.belly[y*W+x]=sampleField(raw,back+(x-back)/scale,y<=top?y:top+(y-top)/scale);
        const nx=(navel[0]-X0)/STEP,ny=(navel[1]-Y0)/STEP;navel=[X0+(back+(nx-back)*scale)*STEP,Y0+(ny<=top?ny:top+(ny-top)*scale)*STEP];
      }
      return[{...fields,navel,
        cleavage:[0,1].map(e=>[0,1].map(k=>(reviewedStageNumber(anchors,a=>(a.measure.cleft||anchors[0].measure.cleft)[e][k],stageBulk)-(k?Y0:X0))/STEP)),
        // the nipples the author placed (near, far), in cells; none if a reference of this cup lacks them
        nipples:anchors.every(a=>a.measure.nippleLeft&&a.measure.nippleRight)?['nippleLeft','nippleRight'].map(n=>[0,1].map(k=>(reviewedStageNumber(anchors,a=>a.measure[n][k],stageBulk)-(k?Y0:X0))/STEP)):null,
        neckX:reviewedStageNumber(anchors,a=>a.measure.neck[0],stageBulk),underbust:reviewedUnderbust(anchors,stageBulk),
        stretch,crotch:reviewedStageNumber(anchors,a=>a.crotch,stageBulk),straps:strapsOf(sigma,CUPS[i][0])},w,bodyW.get(i)||0];
    });
    const CHEST=['bra',...RELIEF_FIELDS],body=samples.map(([f,,w])=>[f,w]);
    const fig={};for(const key of['bra','neck','belly','shorts','legs',...BODY_FIELDS,...RELIEF_FIELDS])fig[key]=lerpFields((CHEST.includes(key)?samples:body).map(([f,w])=>[f[key],w]));
    fig.base=Float32Array.from(fig.neck,(v,i)=>Math.min(v,fig.bra[i]));
    fig.torso=Float32Array.from(fig.base,(v,i)=>Math.min(v,fig.belly[i],fig.shorts[i]));
    
    fig.navel=[0,1].map(k=>body.reduce((n,[f,w])=>n+f.navel[k]*w,0));
    fig.cleavage=[0,1].map(e=>[0,1].map(k=>samples.reduce((n,[f,w])=>n+f.cleavage[e][k]*w,0)));
    fig.nipples=samples.every(([f,w])=>!w||f.nipples)?[0,1].map(e=>[0,1].map(k=>samples.reduce((n,[f,w])=>w?n+f.nipples[e][k]*w:n,0))):null;
    fig.neckX=body.reduce((n,[f,w])=>n+f.neckX*w,0);fig.crotch=body.reduce((n,[f,w])=>n+f.crotch*w,0);fig.underbust=blendCurves(samples.map(([f,w])=>[f.underbust,w]));
    fig.stretch=[0,1,2].map(k=>body.reduce((n,[f,w])=>n+f.stretch[k]*w,0));
    fig.straps=[0,1].map(side=>Array.from({length:25},(_,j)=>[0,1,2].map(k=>samples.reduce((n,[f,w])=>n+f.straps[side][j][k]*w,0))));
    fig.lift=0;fig.manual={bra:true,body:true,belly:true,shorts:true};fig.reviewedModel=true;
    return fig;
  }
  const figureCache=new Map();
  function baseFigure(s){
    const cacheKey=[s.sigma,s.cup,Math.min(BULK_MAX,bulkOf(s))].join('|');
    if(figureCache.has(cacheKey))return figureCache.get(cacheKey);
    const bulk=bulkOf(s),drawn=knotWeights(SIGMAS,s.sigma).map(([i,w])=>[reviewedFigureAt(SIGMAS[i],s.cup,bulk),w]);
    // Two figures' breasts can stand far apart (0σ N reaches some 30 cells further forward than −1.5σ N); blended as
    // they are, they barely overlap and the breast in between fell flat. Each figure's chest is first moved sideways so
    // its near nipple sits at the weighted average of theirs: fully above the under-bust curve, fading out over the six
    // rows below it, so the lower body keeps its own alignment.
    let parts=drawn;
    if(drawn.filter(([,w])=>w>0).length>1&&drawn.every(([f,w])=>!w||f.nipples)){
      const total=drawn.reduce((n,[,w])=>n+w,0),target=drawn.reduce((n,[f,w])=>w?n+f.nipples[0][0]*w:n,0)/total;
      parts=drawn.map(([f,w])=>{if(!w)return[f,w];const dx=target-f.nipples[0][0];if(Math.abs(dx)<0.5)return[f,w];
        const ub=f.underbust?Math.max(...f.underbust.map(p=>p[1])):H*0.4,at=y=>dx*clamp((ub+6-y)/6,0,1),g={...f};
        for(const key of[...KEYS,...BODY_FIELDS,...RELIEF_FIELDS]){const src=f[key];if(!src)continue;const out=new Float32Array(N);
          for(let y=0;y<H;y++){const d=at(y);for(let x=0;x<W;x++)out[y*W+x]=d?sampleField(src,x-d,y):src[y*W+x]}g[key]=out}
        g.nipples=f.nipples.map(([x,y])=>[x+at(y),y]);g.cleavage=f.cleavage.map(([x,y])=>[x+at(y),y]);
        g.underbust=f.underbust?.map(([x,y])=>[x+at(y),y])||null;g.neckX=f.neckX+dx*STEP;
        g.straps=f.straps.map(side=>side.map(([x,y,sw])=>[x+at(y),y,sw]));
        return[g,w]});
    }
    const fig={};
    for(const key of[...KEYS,...BODY_FIELDS,...RELIEF_FIELDS])fig[key]=lerpFields(parts.map(([f,w])=>[f[key],w]));
    // body size relative to 0σ, for lengths drawn by hand (the groin creases)
    fig.size=s.sigma<0?1+0.19*s.sigma/3:1+0.14*s.sigma/3;   // 0.81 at −3σ, 1 at 0σ, 1.14 at +3σ
    for(const key of['neckX','lift','crotch'])fig[key]=parts.reduce((n,[f,w])=>n+f[key]*w,0);
    fig.stretch=parts.every(([f])=>f.stretch)?[0,1,2].map(k=>parts.reduce((n,[f,w])=>n+f.stretch[k]*w,0)):[0,0,1];
    fig.cleavage=[0,1].map(e=>[0,1].map(k=>parts.reduce((n,[f,w])=>n+f.cleavage[e][k]*w,0)));
    fig.nipples=parts.every(([f])=>f.nipples)?[0,1].map(e=>[0,1].map(k=>parts.reduce((n,[f,w])=>n+f.nipples[e][k]*w,0))):null;
    fig.navel=[0,1].map(k=>parts.reduce((n,[f,w])=>n+f.navel[k]*w,0));
    fig.underbust=blendCurves(parts.map(([f,w])=>[f.underbust,w]));
    fig.straps=[0,1].map(side=>Array.from({length:25},(_,j)=>[0,1,2].map(k=>parts.reduce((n,[f,w])=>n+f.straps[side][j][k]*w,0))));
    fig.manual=Object.fromEntries(['bra','body','belly','shorts'].map(key=>[key,parts.some(([f,w])=>w>0&&f.manual[key])]));
    fig.reviewedModel=true;
    fig.bulk=bulk;fig.cupLevel=s.cup/100;
    if(figureCache.size>=16)figureCache.delete(figureCache.keys().next().value);
    figureCache.set(cacheKey,fig);
    return fig;
  }
  function sampleField(field,x,y){
    x=clamp(x,0,W-1);y=clamp(y,0,H-1);const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
    const a=field[iy*W+ix]*(1-tx)+field[iy*W+Math.min(W-1,ix+1)]*tx;
    const b=field[Math.min(H-1,iy+1)*W+ix]*(1-tx)+field[Math.min(H-1,iy+1)*W+Math.min(W-1,ix+1)]*tx;
    return a*(1-ty)+b*ty;
  }
  function surfacePoint(point,field){
    let [x,y]=point;if(x<0||x>=W||y<0||y>=H)return point;
    for(let k=0;k<8;k++){
      const d=sampleField(field,x,y)+1.2;if(d<=0)return[x,y];
      const gx=(sampleField(field,x+0.5,y)-sampleField(field,x-0.5,y)),gy=(sampleField(field,x,y+0.5)-sampleField(field,x,y-0.5)),norm=gx*gx+gy*gy;
      if(norm<1e-4)break;const step=Math.min(d/norm,4/Math.sqrt(norm));x=clamp(x-gx*step,0,W-1);y=clamp(y-gy*step,0,H-1);
    }
    if(sampleField(field,x,y)<=-0.8)return[x,y];
    let best=Infinity,found=point;for(let i=0;i<N;i++)if(field[i]<=-1){const px=i%W,py=i/W|0,d=(px-point[0])**2+(py-point[1])**2;if(d<best){best=d;found=[px,py]}}
    return found;
  }
  // Author lines, interpolated across stage, cup and body type like the masks. Each line is resampled to the same number
  // of points by arc length; lines of a kind are matched by order (breast contours left to right). A reference without
  // a given line (the groin under a big belly) drops out and the rest are renormalised.
  const LINE_SAMPLES=32,lineSampleCache=new WeakMap();   // keyed by the line array, so an import refreshes it
  function resampledLines(anchor){
    const key=anchor.manualLines||anchor;if(lineSampleCache.has(key))return lineSampleCache.get(key);
    const byKind={};
    for(const line of anchor.manualLines||[]){
      if(line.layer==='guide')continue;
      const pts=sampleContourLine(line),len=[0];
      for(let i=1;i<pts.length;i++)len.push(len[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
      const total=len.at(-1)||1,out=[];let j=0;
      for(let k=0;k<LINE_SAMPLES;k++){const d=total*k/(LINE_SAMPLES-1);while(j<len.length-2&&len[j+1]<d)j++;const t=(d-len[j])/((len[j+1]-len[j])||1);out.push([pts[j][0]+(pts[j+1]?.[0]-pts[j][0]||0)*t,pts[j][1]+(pts[j+1]?.[1]-pts[j][1]||0)*t])}
      // the author drew some lines one way on one reference and the other way on the next (the fold under the belly:
      // left to right at 20 weeks, right to left from term); blended point by point, such a pair turns over and shrinks.
      // The blend turns each to run the way the heaviest one does (interpolatedLines); here the lying ones (folds, groin,
      // the breast lines: the far breast's U must start at the top of its inner edge, on the left, for breastLobes) start
      // from their left end and the rest from the top, so a line's first point means the same on every reference.
      const lying=line.kind==='belly_fold'||line.kind==='groin_contour'||line.kind==='breast_contour';
      if(lying?out[0][0]>out.at(-1)[0]:out[0][1]>out.at(-1)[1])out.reverse();
      (byKind[line.kind]??=[]).push({layer:line.layer,points:out,mx:out.reduce((n,p)=>n+p[0],0)/out.length});
    }
    for(const list of Object.values(byKind))list.sort((a,b)=>a.mx-b.mx);
    lineSampleCache.set(key,byKind);return byKind;
  }
  function interpolatedLines(s){
    const bulk=clamp(bulkOf(s),0,MODEL.bulks.at(-1)),bodyCup=new Map(knotWeights(CUPS.map(c=>c[1]),clamp(s.cup,0,CUP_MAX))),weights=[];
    // chest lines follow the extrapolated cup; the others stay inside the drawn cups, like the body fields
    for(const [si,ws]of knotWeights(SIGMAS,s.sigma))for(const [ci,wc]of cupWeights(s.cup))for(const [bi,wb]of knotWeights(MODEL.bulks,bulk))
      weights.push([anchorOf(SIGMAS[si],CUPS[ci][0],STAGES[bi]),ws*wb*wc,ws*wb*(bodyCup.get(ci)||0)]);
    const out=[];
    for(const kind of['cleavage','breast_contour','groin_contour','belly_fold','belly_turn','linea']){
      const chest=kind==='cleavage'||kind==='breast_contour',pick=weights.map(([a,wc,wb])=>[a,chest?wc:wb]);
      const count=Math.max(0,...pick.map(([a])=>(resampledLines(a)[kind]||[]).length));
      for(let n=0;n<count;n++){
        const have=pick.filter(([a,w])=>w!==0&&resampledLines(a)[kind]?.[n]),sum=have.reduce((t,[,w])=>t+w,0);
        if(sum<=0.05)continue;
        const lines=have.map(([a,w])=>[resampledLines(a)[kind][n],w/sum]);
        // a standing line drawn the other way round from the heaviest one is turned to match it before the points are
        // averaged (the lying ones already all start from their left end)
        const ref=lines.reduce((a,b)=>b[1]>a[1]?b:a)[0].points,gap=(p,q)=>p.reduce((t,v,k)=>t+Math.hypot(v[0]-q[k][0],v[1]-q[k][1]),0);
        if(kind==='cleavage'||kind==='belly_turn'||kind==='linea')for(const entry of lines){const p=entry[0].points,back=[...p].reverse();if(gap(back,ref)<gap(p,ref))entry[0]={...entry[0],points:back}}
        // strength: how much of the blend comes from references that drew this line, so a line one stage lacks fades in
        out.push({kind,layer:lines[0][0].layer,closed:false,smooth:false,strength:Math.min(1,sum),
          points:Array.from({length:LINE_SAMPLES},(_,k)=>[0,1].map(c=>lines.reduce((t,[l,w])=>t+l.points[k][c]*w,0)))});
      }
    }
    return out;
  }
  // motion: {lift, bumps}. lift (cells) raises the chest on the in-breath; bumps are fetal movements, each a point along the
  // belly's front (v 0 top … 1 bottom) pushed out by amp cells over a spread of sigma cells.
  // The milk need (乳意, the slider is its share of the cap; 滿 from 100/150, 爆 from 125/150). Engorgement (from 高
  // on, full at the cap) only widens the areola: the breasts keep their cup (a cup does not grow and shrink within a
  // day, so the milk need does not redraw them). Milk only
  // comes where the stage lactates: after birth fully, a pseudo-pregnancy at 0.6, a pregnancy from 16 weeks rising to
  // term; the ordinary cycle's 乳意 is tenderness, which swells but does not leak. Types exempt from the milk need
  // (noMilk) neither swell nor leak.
  const MILK_FULL=100/150,MILK_BURST=125/150,NEED_FULL=MILK_FULL,NEED_BURST=MILK_BURST;
  // how far a need (slider, % of the cap) is past a level, 0 there to 1 at the cap
  const needPast=(value,level)=>clamp(((value??0)/100-level)/(1-level),0,1);
  const milkFill=s=>s.noMilk?0:clamp((s.milk??0)/100,0,1);
  const milkFlow=s=>s.noMilk?0:s.hormStage==='postpartum'?1:s.hormStage==='pseudo'?0.6:s.hormStage==='cycle'?0:clamp(((Number(s.days)||0)-112)/168,0,1);
  const engorgement=s=>clamp((milkFill(s)-0.5)/0.5,0,1)**1.5;
  // Lightening (孕肚微墜): the baby settles into the pelvis, a little from the prodromal stage, more through the first
  // stage and fully as it descends. The belly sinks (its top most) and tips forward low down; the chest has room again
  // (deeper breaths) and the pelvis takes the weight (squirms come more often).
  const DROP={prodromal:0.6,latent:0.8,active:0.8,transition:0.8,descent:1,delivery:1,interval:1};
  const dropOf=s=>DROP[s.laborPhase]||0;
  // After the birth (the placenta stage, then postpartum recovery) the womb is still about the size of a 20-week
  // pregnancy (larger after multiples) and the belly is loose: its shape is drawn from an equivalent pregnancy that
  // shrinks back to none over the recovery, sagging and soft at first. The breasts, areolae, milk and linea keep the
  // real stage.
  const afterBirth=s=>s.laborPhase==='placenta'||s.hormStage==='postpartum';
  const recoveryOf=s=>s.laborPhase==='placenta'?0:clamp((s.stageProgress??0)/100,0,1);
  function shapeOf(s){if(!afterBirth(s))return s;const q=recoveryOf(s),n=Math.max(1,Number(s.count)||1);
    return{...s,days:140*(1+0.3*(n-1))*(1-q)**1.5,count:1,weight:1}}
  function figureFor(real,motion=null){
    const s=shapeOf(real),raw=baseFigure(s),fig={...raw,bulk:bulkOf(s),pressure:pressureOf(s),sigma:s.sigma,cup:s.cup,days:real.days,breast:{milk:(real.milk??0)/100,engorged:engorgement(real),births:real.births||0,noMilk:!!real.noMilk,libido:(real.libido??0)/100,hormone:areolaHormone(real)}};
    const lift=motion?.lift||0,ubRow=raw.underbust?Math.max(...raw.underbust.map(p=>p[1])):(raw.crotch-Y0)/STEP*0.4;
    // the in-breath lifts everything above the under-bust (fading out over 8 rows below it) and brings it a little forward;
    // the belly only drifts forward with it, broadly, so no single spot swells
    const liftAt=y=>lift*clamp((ubRow+4-y)/8,0,1);
    const crotchRow=(raw.crotch-Y0)/STEP,neckRow=(365-Y0)/STEP,waistRow=crotchRow-0.42*(crotchRow-neckRow),hipRow=crotchRow-0.15*(crotchRow-neckRow);
    const rawNavel=raw.navel.map((v,k)=>(v-(k?Y0:X0))/STEP),navel=raw.reviewedModel?rawNavel:surfacePoint(rawNavel,raw.belly);
    const b=(s.build-50)/50,h=(s.hip-50)/50,cx=(508-X0)/STEP;
    // a squirm (洩意) shifts the hips sideways: nothing above the waist, all of it from the hip line down
    const squirmAt=y=>(motion?.squirm||0)*clamp((y-waistRow)/Math.max(1,hipRow-waistRow),0,1);
    // nodding off (困意 爆) sinks the chest forward (1.5 cells) and down (1.2) at the neckline, less toward the waist
    const nodAt=y=>(motion?.nod||0)*clamp((waistRow-y)/Math.max(1,waistRow-neckRow),0,1);
    const rowWarp=y=>{
      const row=clamp(Math.round(y),0,H-1);let l=W,r=-1;for(let x=0;x<W;x++)if(raw.torso[row*W+x]<0){l=Math.min(l,x);r=x}
      const center=r>=l?(l+r)/2:cx,radius=Math.max(8,(r-l)/2);
      const wb=b*2.6*Math.exp(-0.5*((y-waistRow)/9)**2)+b*1.2*Math.exp(-0.5*((y-hipRow)/9)**2);
      // hips: half widens both sides (front thigh and back alike), half adds to the seat at the back
      const wh=h*6*Math.exp(-0.5*((y-hipRow)/8)**2),br=0.4*liftAt(y)+0.2*lift*Math.exp(-0.5*((y-navel[1])/22)**2);
      const scale=1+(wb+wh*0.5)/radius,extra=Math.max(wh*0.5+br,8*(0.15-scale)),offset=center*(1-scale)-br+squirmAt(y)-1.5*nodAt(y);
      return{scale,extra,offset,left:cx*scale+offset,right:(cx+8)*scale+offset+extra};
    };
    let warpPoint=([x,y])=>{const w=rowWarp(y);return[x*w.scale+w.offset+w.extra*clamp((x-cx)/8,0,1),y-liftAt(y)+1.2*nodAt(y)]};
    const warps=Array.from({length:H},(_,y)=>rowWarp(y));
    // (只搬成图用到的栏位；raw.torso 只在上面量每列宽度，不必搬)
    for(const key of['bra','belly','shorts','legs',...BODY_FIELDS,...RELIEF_FIELDS]){
      const field=raw[key],out=new Float32Array(N);
      for(let y=0;y<H;y++){const w=warps[y];for(let x=0;x<W;x++){
        const sx=x<=w.left?(x-w.offset)/w.scale:x>=w.right?(x-w.offset-w.extra)/w.scale:cx+(x-w.left)/(w.scale+w.extra/8);
        out[y*W+x]=sampleField(field,sx,y+liftAt(y)-1.2*nodAt(y));
      }}fig[key]=out;
    }
    // 放松胸型（实验，只在 s.release 有值时作用）：拿掉胸罩的承托，胸部从胸根往下垂（sag，N 杯的格数）、
    // 下极往两侧摊（spread，格数），杯越大越多。远侧侧腹在胸部那几列由胸部构成，不钉住（pinFlank 可钉）；胸下缘以下的腰侧钉住，免得腰线被拉出一阶。胸下缘碰到孕肚就停在肚子上（逐列量孕肚上缘，contact），
    // 所以大孕肚自然把胸托住。位移只套在胸部与上身的栏位，孕肚、短裤、腿不动。
    if(s.release&&((s.release.sag||0)>0||(s.release.spread||0)>0)){
      const R=s.release,size=clamp(s.cup/150,0,1.2)**1.3,S=(R.sag||0)*size,SP=(R.spread||0)*size,K=6;
      const inBra=i=>fig.bra[i]<0;
      let top=-1,bot=-1;
      for(let y=0;y<H&&top<0;y++)for(let x=0;x<W;x++)if(inBra(y*W+x)){top=y;break}
      for(let y=H-1;y>=0&&bot<0;y--)for(let x=0;x<W;x++)if(inBra(y*W+x)){bot=y;break}
      // 胸罩栏位往上连到颈部，胸根改用乳头高度往上推（乳头到胸下缘的 1.3 倍）
      const nip=raw.nipples?raw.nipples.map(warpPoint):null,mid=nip?(nip[0][0]+nip[1][0])/2:null;
      if(nip&&bot>0){const ny=Math.min(nip[0][1],nip[1][1]);top=Math.max(top,Math.floor(ny-1.3*(bot-ny)))}
      if(top>=0&&bot>top){
        // 每列可以垂多少：胸下缘到孕肚上缘的空隙（允许压进 1 格），再取平滑
        const col=new Float32Array(W).fill(1e3);
        if(R.contact!==false)for(let x=0;x<W;x++){
          let bb=-1;for(let y=bot;y>=top;y--)if(inBra(y*W+x)){bb=y;break}
          if(bb<0)continue;
          let bt=-1;for(let y=top;y<H;y++)if(fig.belly[y*W+x]<0){bt=y;break}
          // 没怀孕时孕肚栏位就是胸下的腹部，不算接触；孕肚越大（胎量 0.3 → 0.8）越照接触算
          const hold=clamp((fig.bulk-0.3)/0.5,0,1);
          if(bt>=0)col[x]=Math.max(0,bt-bb+1)+(1-hold)*1e3;
        }
        for(let pass=0;pass<3;pass++){const c=Float32Array.from(col);for(let x=0;x<W;x++){let t=0,n=0;for(let k=-2;k<=2;k++){const j=x+k;if(j>=0&&j<W){t+=c[j];n++}}col[x]=Math.min(c[x],t/n)}}
        // 远侧侧腹（每列最右的身体格）不动，往内 6 格才全量
        const flank=new Float32Array(H);
        for(let y=0;y<H;y++){let r=-1;for(let x=W-1;x>=0;x--){const i=y*W+x;if(fig.body[i]<0||fig.bra[i]<0){r=x;break}}flank[y]=r}
        const smooth=v=>v*v*(3-2*v);
        // 内容的位移 [右, 下]（格）
        // 两边各绕胸骨上端（乳沟顶）往外下方转：近侧逆时针、远侧顺时针，离胸根越远转得越多（弯，不是剪切），
        // 所以轮廓保持圆弧、下极往下往外挂；胸骨线本身不动。胸部以外（离胸根超过胸高）逐渐不转。
        const ax=mid??(W/2),ay=top+0.15*(bot-top),L=Math.max(4,bot-ay),theta=S/L;
        // 每一侧胸部离胸根最远的距离：转动量照它归一，近侧的乳尖与远侧的外缘才会转满
        const reach=[L,L];
        for(let y=top;y<=bot;y++)for(let x=0;x<W;x++)if(inBra(y*W+x)){const k=x<ax?0:1;reach[k]=Math.max(reach[k],Math.hypot(x-ax,y-ay))}
        const move=(x,y)=>{
          const dx=x-ax,dy=y-ay,r=Math.hypot(dx,dy),u=r/reach[dx<0?0:1];
          const w=smooth(clamp(u,0,1)),phi=Math.tanh(dx/3)*theta*w;
          // 只取转动的「往下」分量：离胸骨越远掉得越多（像悬臂），同一侧整片一起往下弯，轮廓不被逐列剪切成尖角；
          // 横向只留 spread 的外摊，远侧侧腹不会被转歪
          // 胸根以上（锁骨、腋下）不动，胸根到转轴之间渐入
          const rise=smooth(clamp((y-top)/Math.max(3,(ay-top)*2),0,1));
          // 远侧：力臂到远侧乳头为止，再往外到侧腹收回 0（侧腹是躯干，不是胸部）
          const fy0=clamp(Math.round(y),0,H-1),dn=nip?Math.max(4,nip[1][0]-ax):reach[1]*0.6;
          const lever=dx<=0?-dx:dx<=dn?dx:dn*(flank[fy0]>ax+dn?clamp((flank[fy0]-x)/(flank[fy0]-ax-dn),0,1):0);
          let mx=SP*Math.tanh(dx/3)*w*rise,my=Math.abs(Math.sin(phi))*lever*rise;
          const xi=clamp(Math.round(x),0,W-1);
          if(my>col[xi]){const k=col[xi]/my;mx*=k;my=col[xi]}
          // 胸下缘以下：先留出胸部往下挂的空间，再 K 格内收回 0，腹部与下身不动
          const reachDown=Math.max(0,my),fall=y<=bot+reachDown?1:clamp(1-(y-bot-reachDown)/K,0,1);
          const fy=clamp(Math.round(y),0,H-1),pin=R.pinFlank||y>bot-2,g=(pin?(flank[fy]>=0?clamp((flank[fy]-x)/8,0,1):0):1)*fall;
          return[mx*g,my*g];
        };
        // 胸部与上身的栏位整个照位移场搬（胸部的轮廓在 body 栏位里，bra 栏位只是罩杯）
        for(const key of['bra',...BODY_FIELDS,...RELIEF_FIELDS]){if(key==='legVoid')continue;const src=fig[key],out=new Float32Array(N);
          for(let y=0;y<H;y++)for(let x=0;x<W;x++){const [mx,my]=move(x,y);out[y*W+x]=sampleField(src,x-mx,y-my)}
          fig[key]=out}
        const before=warpPoint;
        warpPoint=p=>{const q=before(p),[mx,my]=move(q[0],q[1]);return[q[0]+mx,q[1]+my]};
        // 被孕肚托住的比例：胸下缘各列里，接触把下垂量压到一半以下的占几成（孕肚够大才算）
        let under=0,held=0;
        for(let x=0;x<W;x++){let has=false;for(let y=top;y<=bot;y++)if(inBra(y*W+x)){has=true;break}
          if(!has)continue;under++;if(col[x]<0.5*S)held++}
        fig.release={sag:S,spread:SP,top,bot,loose:size,rest:under?held/under:0,contact:Array.from(col)};
      }
    }
    // the wobble after a big kick shakes the belly a little forward and down and back (the chest bounces through lift)
    if(motion?.jiggle){const j=motion.jiggle,src=fig.belly,out=new Float32Array(N);
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)out[y*W+x]=sampleField(src,x+0.5*j,y-0.6*j);fig.belly=out}
    // A contraction tightens the womb: the belly draws up (its top most, 1.6 cells at full strength) and stands out in
    // front (1 cell at its middle). Bearing down pushes it the other way: down (its foot most, 1.8 cells) and forward
    // (1.2). fig.firm (compose) also sharpens its shading.
    fig.firm=motion?.contraction||0;
    // where the belly's surface has moved to ([right, down] in cells), for the lines drawn on it (the fold under it,
    // the linea): the wobble's shift, plus the contraction's and the push's
    let bellyWarp=null;const wob=motion?.jiggle||0;
    // Lightening: the foot of the belly rests on the pubic bone and stays put; its top sinks (3 cells) and draws in a
    // little, and what it gives up fills the lower half, which comes forward (2 cells, more after earlier births: a
    // looser wall tips further) and hangs deeper over the fold. Bearing down likewise presses the top down, not the foot.
    // just after the birth the loose belly hangs: its lower part drops up to 2 cells and leans a little forward,
    // firming up over the recovery. Both scale with how big the belly is, so a small one barely moves.
    const drop=dropOf(real)*clamp(fig.bulk/0.5,0,1),tip=1+0.25*Math.min(2,real.births||0),sag=afterBirth(real)?2*(1-recoveryOf(real))*clamp(fig.bulk/0.5,0,1):0;
    fig.soft=afterBirth(real)?1-recoveryOf(real):0;
    if((motion?.contraction||0)>0.01||(motion?.push||0)>0.01||drop>0.01||sag>0.01){const c=motion?.contraction||0,p=motion?.push||0,src=fig.belly,out=new Float32Array(N);
      let top=-1,bot=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(src[y*W+x]<0){if(top<0)top=y;bot=y;break}
      if(top>=0&&bot>top){const at=y=>{const v=clamp((y-top)/(bot-top),0,1),low=Math.exp(-0.5*((v-0.68)/0.2)**2);
          return[(1*c+1.2*p)*Math.sin(Math.PI*v)+drop*(2*tip*low-0.8*(1-v)**2)+0.5*sag*low,1.6*c*(1-v)-1.8*p*(1-v)*Math.min(1,2*v+0.3)-drop*3*(1-v)-sag*v*v]};bellyWarp=at;
        for(let y=0;y<H;y++){const [dx,dy]=at(y);for(let x=0;x<W;x++)out[y*W+x]=sampleField(src,x+dx,y+dy)}fig.belly=out}}
    // (content sampled from (x+dx, y+dy) has moved by (−dx, −dy))
    fig.bellyMove=(x,y)=>{let mx=-0.5*wob,my=0.6*wob;if(bellyWarp){const [dx,dy]=bellyWarp(y);mx-=dx;my-=dy}return[mx,my]};
    // Fetal movements: each is a point on the belly's visible face, v down it and w in from its front edge toward the back
    // (0 on the edge), over the whole front face from just under the chest to the bottom. Every one raises the surface there (a lump compose lights, so it shows anywhere on the belly);
    // one on the edge also pushes the outline out (the belly's signed distance drops near the point).
    // where the content of a row at rest has moved to now, [right, down] in cells: the breath (up and a little forward),
    // nodding off, a squirm (the nipples, the milk and the steady shading follow it)
    fig.bumps=[];fig.moveAt=y=>[-0.4*liftAt(y)-1.5*nodAt(y)+squirmAt(y),-liftAt(y)+1.2*nodAt(y)];
    // the gut's growl: a patch of ripples on the surface just above the navel (a third of the way up to the chest, a
    // few cells back from the midline), which compose lays as travelling waves; the outline stays. The growing womb
    // pushes the bowel up and out to the sides: its top is at the navel by 20 weeks and under the ribs at term, so as the
    // pregnancy clothing pressure (the belly's size) goes from a single 20 weeks (3.2) to a single term (7) the patch
    // climbs to four rows under the chest, moves back toward the flank (30% of the way across the body; further back it
    // sinks into the side's shade) and flattens; multiples get there sooner. The bowel is the mother's, so the patch and
    // its waves scale with her body (fig.size); the fetal lumps do not (their size is the fetus's).
    fig.ripples=[];
    if(motion?.ripples?.length){
      const [gnx,gny]=warpPoint(navel),up=clamp((pressureOf(s)-MID_PRESSURE)/(7-MID_PRESSURE),0,1),k=fig.size||1,y0=gny-0.35*Math.max(0,gny-ubRow)+(ubRow+4-(gny-0.35*Math.max(0,gny-ubRow)))*up;
      const row=clamp(Math.round(y0),0,H-1);let fx=-1,bx=-1;for(let x=0;x<W;x++)if(fig.body[row*W+x]<0||fig.belly[row*W+x]<0){if(fx<0)fx=x;bx=x}
      const x0=gnx+3+(fx>=0?(fx+(bx-fx)*0.3-gnx-3)*up:0);
      for(const g of motion.ripples)fig.ripples.push({x:x0,y:y0,rx:(8-2*up)*k,ry:(5-2*up)*k,wave:4*k,t:g.t});
    }
    const bumps=motion?.bumps||[];
    if(bumps.length){
      let top=-1,bot=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(fig.belly[y*W+x]<0){if(top<0)top=y;bot=y;break}
      if(top>=0)for(const b of bumps){
        const y0=Math.round(top+(bot-top)*(0.06+0.88*clamp(b.v,0,1)));let fx=-1,bx=-1;for(let x=0;x<W;x++)if(fig.belly[y0*W+x]<0){if(fx<0)fx=x;bx=x}
        if(fx<0)continue;
        const w=clamp(b.w??0,0,1);fig.bumps.push({x:fx+(bx-fx)*0.75*w,y:y0,sigma:b.sigma,amp:b.amp,crease:b.crease||0});
        if(w>0.12)continue;
        const c=[fx-0.5,y0],r=Math.ceil(b.sigma*3),out=Float32Array.from(fig.belly);
        for(let y=Math.max(0,y0-r);y<=Math.min(H-1,y0+r);y++)for(let x=Math.max(0,fx-r);x<=Math.min(W-1,fx+r);x++){
          const d2=(x-c[0])**2+(y-c[1])**2;out[y*W+x]-=b.amp*Math.exp(-d2/(2*b.sigma*b.sigma))}
        fig.belly=out;
      }
    }
    fig.navel=warpPoint(navel).map((v,k)=>v*STEP+(k?Y0:X0));
    fig.cleavage=raw.cleavage.map(warpPoint);fig.nipplePoints=raw.nipples?.map(warpPoint)||null;fig.underbust=raw.underbust?.map(warpPoint)||null;
    fig.straps=raw.straps.map(side=>side.map(([x,y,w])=>{const p=warpPoint([x,y]);return[p[0],p[1],Math.max(3,warpPoint([x+w/2,y])[0]-warpPoint([x-w/2,y])[0])]}));
    fig.warpPoint=warpPoint;fig.breath=lift;fig.liftAt=liftAt;fig.jiggleLag=motion?.jiggleLag||0;fig.layerVisibility={body:true,shorts:s.showShorts!==false,belly:true,bra:s.showBra!==false};fig.strapless=!!s.strapless;
    fig.manualLines=interpolatedLines(s);
    // Past quintuplets the belly is the quintuplet one enlarged (from the back of the shorts forward, and down from the
    // hem); the lines drawn on it (the fold under it, its turn to the side, the linea) are enlarged the same way, else
    // they stayed where the quintuplet belly had them and crossed the bigger belly's face.
    const [stBack,stTop,stScale]=raw.stretch||[0,0,1];
    if(stScale>1.0001)fig.manualLines=fig.manualLines.map(l=>l.kind!=='belly_fold'&&l.kind!=='belly_turn'&&l.kind!=='linea'?l:{...l,points:l.points.map(([px,py])=>{
      const x=(px-X0)/STEP,y=(py-Y0)/STEP;return[X0+(stBack+(x-stBack)*stScale)*STEP,Y0+(y<=stTop?y:stTop+(y-stTop)*stScale)*STEP]})});
    fig.restGroin=MODEL.reviewed?interpolatedLines({...s,days:0,count:1}).find(l=>l.kind==='groin_contour')||null:null;
    // The fold under the belly straddles the body's midline, which runs from the navel down to the groin's tip: the
    // author's linea (moved onto the navel, as it is drawn), or a straight line from the navel to the tip. The fold is
    // moved sideways so it crosses the midline where the author's fold crossed it; while the belly is small (up to 20
    // weeks, easing out by a single term) it is also turned about that crossing to lie level with the groin.
    if(fig.restGroin){
      const g=fig.restGroin.points,ends=p=>p[0][0]<=p.at(-1)[0]?[p[0],p.at(-1)]:[p.at(-1),p[0]],slope=p=>{const [a,b]=ends(p);return Math.atan2(b[1]-a[1],b[0]-a[0])};
      const tip=g.reduce((a,q)=>q[1]>a[1]?q:a),angle=slope(g),nv=[X0+navel[0]*STEP,Y0+navel[1]*STEP];
      const linea=fig.manualLines.find(l=>l.kind==='linea');let mid=[nv,tip];
      if(linea){const p=linea.points,k=p.reduce((b,q,j)=>Math.hypot(q[0]-nv[0],q[1]-nv[1])<Math.hypot(p[b][0]-nv[0],p[b][1]-nv[1])?j:b,0);
        mid=p.map(q=>[q[0]+nv[0]-p[k][0],q[1]+nv[1]-p[k][1]])}
      const midX=y=>{for(let j=1;j<mid.length;j++){const [a,b]=[mid[j-1],mid[j]];if((y-a[1])*(y-b[1])<=0&&a[1]!==b[1])return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])}return y<Math.min(mid[0][1],mid.at(-1)[1])?(mid[0][1]<mid.at(-1)[1]?mid[0][0]:mid.at(-1)[0]):(mid[0][1]<mid.at(-1)[1]?mid.at(-1)[0]:mid[0][0])};
      // where the unshifted midline (the author's own linea) crosses the fold: the fold point closest to it sideways
      const own=linea?linea.points:[nv,tip],ownX=y=>{let best=own[0];for(const q of own)if(Math.abs(q[1]-y)<Math.abs(best[1]-y))best=q;return best[0]};
      const t=clamp((bulkOf(s)-0.5)/0.5,0,1),free=1-t*t*(3-2*t);
      fig.manualLines=fig.manualLines.map(l=>{if(l.kind!=='belly_fold')return l;
        const c=l.points.reduce((b,q)=>Math.abs(q[0]-ownX(q[1]))<Math.abs(b[0]-ownX(b[1]))?q:b),dx=midX(c[1])-ownX(c[1]);
        const turn=(angle-slope(l.points))*free,cos=Math.cos(turn),sin=Math.sin(turn);
        return{...l,points:l.points.map(([x,y])=>[c[0]+dx+(x-c[0])*cos-(y-c[1])*sin,c[1]+(x-c[0])*sin+(y-c[1])*cos])}});
    }
    // 动画用：各段位移的基准列（belly_anim.js 用位移搬静止画面，不重算成图）
    // 放松胸型：胸下线跟着形变后的位置走（否则下垂的那段不跟着晃，晃动时会撕开）；
    // breastTop、loose、rest 给动画算「没有承托的晃法」
    const rel=fig.release,ubAfter=rel&&fig.underbust?Math.max(...fig.underbust.map(p=>p[1])):ubRow;
    fig.rows={ubRow:ubAfter,waistRow,hipRow,neckRow,navelRow:navel[1],...(rel?{breastTop:rel.top,loose:rel.loose,rest:rel.rest}:{})};
    fig.days=real.days;
    return fig;
  }
  // Light from the upper left front; the body is a soft dome whose depth follows the distance to its outline.
  const LIGHT=(()=>{const v=[-0.55,-0.55,0.63],l=Math.hypot(...v);return v.map(c=>c/l)})();
  function rowSpan(mask,y){if(y<0||y>=H)return null;let l=W,r=-1;for(let x=0;x<W;x++)if(mask[y*W+x]){l=Math.min(l,x);r=x}return r<l?null:[l,r]}
  function smoothField(field){
    const tmp=new Float32Array(N),out=new Float32Array(N),weights=[1,4,6,4,1];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let value=0;for(let k=-2;k<=2;k++)value+=field[y*W+clamp(x+k,0,W-1)]*weights[k+2];tmp[y*W+x]=value/16}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let value=0;for(let k=-2;k<=2;k++)value+=tmp[clamp(y+k,0,H-1)*W+x]*weights[k+2];out[y*W+x]=value/16}
    return out;
  }
  function smoothLowerGarment(mask,from){
    const spans=Array.from({length:H},(_,y)=>rowSpan(mask,y)),bottom=maskBounds(mask).b,out=Uint8Array.from(mask);
    for(let y=from;y<bottom-1;y++){
      if(!spans[y])continue;let l=0,r=0,total=0;
      for(let k=-3;k<=3;k++){const j=clamp(y+k,from,bottom-1);if(!spans[j])continue;const w=4-Math.abs(k);l+=spans[j][0]*w;r+=spans[j][1]*w;total+=w}
      out.fill(0,y*W,(y+1)*W);for(let x=Math.round(l/total);x<=Math.round(r/total);x++)out[y*W+x]=1;
    }
    return out;
  }
  function attachBelly(masks,fig){
    const low=maskBounds(masks.bra).b,top=Math.max(0,low-11),bottom=Math.min(H-1,low+11,Math.floor((fig.navel[1]-Y0)/STEP)-5);
    const upper=Uint8Array.from(masks.body,(v,i)=>v||masks.bra[i]?1:0),a=rowSpan(upper,top),b=rowSpan(masks.belly,bottom);
    if(a&&b&&bottom>top){
      for(let y=top+1;y<=bottom;y++){
        const t=(y-top)/(bottom-top),ease=t*t*(3-2*t),span=rowSpan(masks.belly,y),l=a[0]+(b[0]-a[0])*ease+4*t*(1-t),r=a[1]+(b[1]-a[1])*ease;
        if(!span)continue;
        const left=span?Math.min(span[0],Math.max(l,span[0]-6)):l,right=span?Math.max(span[1],Math.min(r,span[1]+4)):r;
        for(let x=Math.ceil(left);x<=Math.floor(right);x++)if(x>=0&&x<W)masks.belly[y*W+x]=1;
      }
    }
    // Only columns in the lower cloth band attach vertically; projected breast tips do not.
    for(let x=0;x<W;x++){
      let hem=-1,skin=-1;for(let y=0;y<H;y++)if(masks.bra[y*W+x])hem=y;
      if(hem<low-9)continue;for(let y=hem+1;y<Math.min(H,hem+13);y++)if(masks.belly[y*W+x]){skin=y;break}
      if(skin>=0)for(let y=hem+1;y<skin;y++)masks.belly[y*W+x]=1;
    }
    const joined=smoothField(signedField(masks.belly));
    for(let y=Math.max(0,top-1);y<=Math.min(H-1,bottom+1);y++)for(let x=0;x<W;x++)masks.belly[y*W+x]=joined[y*W+x]<0?1:0;
  }
  function cameraFor(fig,shorts){
    const pairs=knotWeights(SIGMAS,fig.sigma).map(([i,w])=>[MODEL.camera[SIGMAS[i]],w]);
    // One horizontal envelope and one display scale for every sigma, cup and stage.
    const cameras=Object.values(MODEL.camera),x=Math.min(...cameras.map(c=>c.x)),right=Math.max(...cameras.map(c=>c.x+c.w));
    // a chest above D grows upward too: lift the top edge with the cup (D 12 rows, I 9, N 6; the panels reach row 1)
    // ...but never above the first row the weighted reference pictures actually cover
    const covered=dataTop(knotWeights(SIGMAS,fig.sigma),knotWeights(CUPS.map(c=>c[1]),clamp(fig.cup??50,0,CUP_MAX)),knotWeights(MODEL.bulks,clamp(fig.bulk,0,MODEL.bulks.at(-1))));
    const y=Math.max(1,covered,Math.max(...cameras.map(c=>c.y))-Math.round(clamp((fig.cup??50)-50,0,100)*0.06)),limit=Math.round(pairs.reduce((n,[c,w])=>n+(c.y+c.h)*w,0));
    // nude: the picture ends at the crotch, the lowest point of the author's groin line (from the not-pregnant references,
    // so it does not move as the belly grows)
    const crotch=MODEL.groinBottom?Math.round(knotWeights(SIGMAS,fig.sigma).reduce((n,[i,w])=>n+MODEL.groinBottom[SIGMAS[i]]*w,0)):null;
    const pants=shorts?maskBounds(shorts):null,hem=crotch??(pants&&pants.b>=y?pants.b+1:limit),bottom=Math.max(y+1,Math.min(H,hem));
    return{x,y,w:Math.max(1,right-x),h:bottom-y};
  }
  function repairBodyGeometry(masks,fig){
    const protectedSpace=new Uint8Array(N),candidates=Uint8Array.from(fig.legVoid,v=>v<0?1:0),statistics={supportFill:0,holeFill:0,skinHoleFill:0,notchFill:0,islandCells:0,legCells:0,protectedCleared:0};
    const union=()=>Uint8Array.from(masks.body,(v,i)=>v||masks.bra[i]||masks.belly[i]||masks.shorts[i]?1:0);
    const outside=outsideBackground(union()),visited=new Uint8Array(N);
    // A leg-gap constraint must reach real exterior space. Isolated interpolation
    // specks are not protected holes, and front garments/belly may still occlude it.
    for(let start=0;start<N;start++)if(candidates[start]&&!visited[start]){
      const cells=[start];visited[start]=1;let open=false;
      for(let h=0;h<cells.length;h++){const i=cells[h],x=i%W,y=i/W|0;open||=y===H-1||!!outside[i];
        for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*W+xx;if(xx<0||xx>=W||yy<0||yy>=H)continue;open||=!!outside[j];if(candidates[j]&&!visited[j]){visited[j]=1;cells.push(j)}}}
      if(open)for(const i of cells){protectedSpace[i]=1;if(masks.body[i]&&!masks.bra[i]&&!masks.shorts[i]&&!masks.belly[i]){masks.body[i]=0;statistics.protectedCleared++}}
    }
    // Skin must be complete on its own, including when a garment is hidden. Do not
    // let a visible cloth pixel certify an otherwise torn posterior body surface.
    const skin=Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]?1:0),sealedSkin=Uint8Array.from(skin);
    statistics.skinHoleFill=fillBodyHoles(sealedSkin,protectedSpace);
    for(let i=0;i<N;i++)if(sealedSkin[i]&&!skin[i])masks.body[i]=1;
    let envelope=union();
    for(let i=0;i<N;i++)if(!envelope[i]&&fig.support[i]<0&&!protectedSpace[i]){masks.body[i]=envelope[i]=1;statistics.supportFill++}
    const sealed=Uint8Array.from(envelope);statistics.holeFill=fillBodyHoles(sealed,protectedSpace);statistics.notchFill=softenBodyNotches(sealed,protectedSpace);
    for(let i=0;i<N;i++)if(sealed[i]&&!envelope[i])masks.body[i]=1;
    envelope=union();
    const seen=new Uint8Array(N),components=[];
    for(let start=0;start<N;start++)if(envelope[start]&&!seen[start]){
      const cells=[start];seen[start]=1;let bottom=false,leg=false;
      for(let h=0;h<cells.length;h++){const i=cells[h],x=i%W,y=i/W|0;bottom||=y===H-1;leg||=fig.legs[i]<0;
        for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*W+xx;if(xx>=0&&xx<W&&yy>=0&&yy<H&&envelope[j]&&!seen[j]){seen[j]=1;cells.push(j)}}}
      components.push({cells,bottom,leg});
    }
    const largest=components.reduce((best,c)=>!best||c.cells.length>best.cells.length?c:best,null);
    for(const component of components)if(component!==largest&&!(component.cells.length>=8&&(component.bottom||component.leg))){
      statistics.islandCells+=component.cells.length;for(const i of component.cells)for(const mask of Object.values(masks))mask[i]=0;
    }
    statistics.legCells=masks.body.reduce((n,v,i)=>n+(v&&fig.legs[i]<0?1:0),0);
    return{statistics,protectedSpace};
  }
  // The two breasts as separate regions, split by the author's breast lines: the far breast's line is a U (its inner
  // edge down, then its underside up to the back); the near breast lies in front of that inner edge, above its own
  // short underside line. Without the lines both fall back to one region above the under-bust.
  function breastLobes(fig,host,ubY,whole){
    const lines=(fig.manualLines||[]).filter(l=>l.kind==='breast_contour').map(l=>l.points.map(p=>fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP])));
    const along=(pts,v,a,b)=>{for(let k=1;k<pts.length;k++){const p=pts[k-1],q=pts[k];if((p[a]-v)*(q[a]-v)<=0&&p[a]!==q[a])return p[b]+(q[b]-p[b])*(v-p[a])/(q[a]-p[a])}return null};
    if(lines.length<2){
      const one=Uint8Array.from(host,(k,i)=>k&&(i/W|0)<ubY(i%W)?1:0);
      return{list:[one],bottom:ubY};
    }
    const spanX=l=>Math.max(...l.map(p=>p[0]))-Math.min(...l.map(p=>p[0]));
    const [far,near]=lines[0]&&spanX(lines[0])>=spanX(lines[1])?[lines[0],lines[1]]:[lines[1],lines[0]];
    let kb=0;far.forEach((p,k)=>{if(p[1]>far[kb][1])kb=k});
    const left=far.slice(0,kb+1),right=far.slice(kb),endX=Math.max(...right.map(p=>p[0]));
    // Above the U the two breasts meet at the cleavage: the split follows the author's cleavage line there (easing onto
    // the U's top over its last rows). Held at the U's top column instead, the near breast's inner edge (lit as turning
    // away, the darkest tone) stood several cells in front of the cleavage, a dark band on the breast's flat top.
    const cleft=(fig.manualLines||[]).filter(l=>l.kind==='cleavage').map(l=>l.points.map(p=>fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP])))[0];
    const cleftX=y=>{if(!cleft)return null;const ys=cleft.map(p=>p[1]);if(y<Math.min(...ys))return cleft.reduce((a,p)=>p[1]<a[1]?p:a)[0];return along(cleft,y,1,0)};
    const innerTop=y=>{const cx=cleftX(y),ux=left[0][0];if(cx===null||cx<=ux)return ux;const t=clamp((left[0][1]-y)/6,0,1);return ux+(cx-ux)*t};
    const inner=y=>y<=left[0][1]?innerTop(y):y>=left.at(-1)[1]?left.at(-1)[0]:along(left,y,1,0)??left.at(-1)[0];
    let nearSorted=[...near].sort((p,q)=>p[0]-q[0]);
    // In front of the author's short underside line the breast's lower edge is the body's own outline: from the breast's
    // most forward row the front edge recedes under it to where breast meets belly or ribs. Follow that, then bridge to
    // the line, so the breast region never ends in a level line across the belly.
    const front=y=>{for(let x=0;x<W;x++)if(whole[y*W+x])return x;return W};
    let tip=0,tipX=W;for(let y=0;y<=Math.min(H-1,Math.ceil(nearSorted[0][1]));y++){const f=front(y);if(f<tipX){tipX=f;tip=y}}
    let crease=tip;while(crease+2<H&&front(crease+2)>front(crease)&&crease-tip<30)crease++;
    const under=[];for(let y=tip;y<=crease;y++){const f=front(y);if(f<nearSorted[0][0]&&(!under.length||f>under.at(-1)[0]))under.push([f,y])}
    // bridge from there to the line along a sagging arc (the breast hangs), never a straight run
    if(under.length){const [x0,y0]=under.at(-1),[x1,y1]=nearSorted[0],bridge=[];
      for(let k=1;k<8;k++){const t=k/8;bridge.push([x0+(x1-x0)*t,y0+(y1-y0)*t+0.18*(x1-x0)*4*t*(1-t)])}
      nearSorted=[...under,...bridge,...nearSorted]}
    const nearBottom=x=>x<=nearSorted[0][0]?nearSorted[0][1]:x>=nearSorted.at(-1)[0]?nearSorted.at(-1)[1]:along(nearSorted,x,0,1)??ubY(x);
    // the underside follows the U itself on both sides of its lowest point
    const leftLow=left.slice(Math.max(0,left.findIndex(p=>p[1]>=left[0][1]+(far[kb][1]-left[0][1])*0.6)));
    // the left branch can cross a column twice (down the inner edge, then along the underside): take the lower crossing
    const lowest=(pts,x)=>{let y=null;for(let k=1;k<pts.length;k++){const p=pts[k-1],q=pts[k];if((p[0]-x)*(q[0]-x)<=0&&p[0]!==q[0]){const v=p[1]+(q[1]-p[1])*(x-p[0])/(q[0]-p[0]);if(y===null||v>y)y=v}}return y};
    const farBottom=x=>x<=far[kb][0]?lowest(leftLow,x)??(x<leftLow[0][0]?leftLow[0][1]:far[kb][1]):along(right,x,0,1)??-1;
    // near and far meet at the foot of the far breast's inner edge, not at the U's lowest point
    const split=Math.min(...leftLow.map(p=>p[0]));
    const bottom=x=>x<split?nearBottom(x):x<=endX?farBottom(x):ubY(x);
    const nearLobe=new Uint8Array(N),farLobe=new Uint8Array(N);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!host[i])continue;
      if(x<inner(y)){if(y<nearBottom(x))nearLobe[i]=1}else if(x<=endX&&y<farBottom(x))farLobe[i]=1}
    return{list:[nearLobe,farLobe],bottom,split,endX,cleftTop:cleft?Math.min(...cleft.map(p=>p[1])):-1};
  }
  // Areola hormone level, 0 (none) to 1 (term), from the stage and its progress as the tracker keeps them:
  // - pregnancy: effective days ÷ 280;
  // - pseudo-pregnancy (假孕期, its limit is 84 days × gestation speed): rises to 0.6 at most, the body only imitating;
  // - postpartum recovery (产后恢复, bio.recoveryDays): starts at 1 and eases to 0.4 by the end (still nursing);
  // - each birth (natural or surgical experience) leaves 0.12 more for good, up to 0.4; that is also the floor elsewhere.
  function areolaHormone(s){
    const kept=Math.min(0.4,0.12*(s.births||0)),q=clamp((s.stageProgress??0)/100,0,1);
    const level=s.hormStage==='pseudo'?0.6*Math.sqrt(q):s.hormStage==='postpartum'?1-0.6*q:s.hormStage==='cycle'?0:clamp((Number(s.days)||0)/280,0,1);
    return Math.max(kept,level);
  }
  // Nipples: one on each breast region, toward the near breast's forward point and a little inside the far one's middle,
  // low on it. The areola grows with the cup and darkens and widens through pregnancy; the near one is foreshortened.
  function nippleSpots(fig,masks){
    if(!fig.underbust||fig.cupLevel<0)return[];
    const ub=fig.underbust,ubY=x=>{if(x<=ub[0][0])return ub[0][1];if(x>=ub.at(-1)[0])return ub.at(-1)[1];let j=0;while(ub[j+1][0]<x)j++;const t=(x-ub[j][0])/(ub[j+1][0]-ub[j][0]);return ub[j][1]+(ub[j+1][1]-ub[j][1])*t};
    const whole=Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]?1:0),lobes=fig._lobes??breastLobes(fig,masks.body,ubY,whole),out=[];
    // The hormone level darkens and widens the areola (it moves only day by day, with the stage); the milk need, which
    // rises and is relieved within a day, only swells it a little (engorgement), never recolours it. A type that does not
    // lactate (derived types exempt from the milk need: undead, mechanical, mutant, cursed) keeps it as it is. Desire
    // draws it in a little and stands the nipple up.
    const br=fig.breast||{},hormone=br.hormone??clamp((Number(fig.days)||0)/280,0,1),lact=br.noMilk?0:1;
    const tint=lact*hormone,grow=lact*(0.35*hormone+0.1*(br.milk||0)+0.25*(br.engorged||0)),erect=clamp(((br.libido||0)-0.5)/0.4,0,1);
    const box=lobe=>{let l=W,r=-1,t=H,b=-1,n=0,sx=0;for(let i=0;i<N;i++)if(lobe[i]){const x=i%W,y=i/W|0;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);n++;sx+=x}return{l,r,t,b,n,sx}};
    const sizeOf=({l,r,t,b})=>clamp(0.09*Math.sqrt((r-l+1)*(b-t+1)),0.9,3.2)*(1+grow)*(1-0.1*erect);
    const two=lobes.list.length>1;
    // Where the author placed them (near, far): the far one as it is; the near one, within a few cells of its breast's
    // outline, on the outline at that row (so it turns with the edge), otherwise as it is.
    if(fig.nipplePoints){
      const nb=box(lobes.list[0]),fb=two?box(lobes.list[1]):nb;if(nb.n<4)return out;
      const [[nx,ny],[fx,fy]]=fig.nipplePoints,far=sizeOf(fb.n>=4?fb:nb),size=sizeOf(nb);
      out.push({x:fx,y:fy,rx:far,ry:far,tint,erect});
      const row=clamp(Math.round(ny),0,H-1);let e=null;for(let x=0;x<W;x++)if(masks.body[row*W+x]||masks.belly[row*W+x]){e=x;break}
      // (插件新增 nippleSide：罩杯越大，近侧乳头离轮廓再远也贴到轮廓上画成侧面；I 以上一律侧面。
      //  作者标的点在大罩杯之间混合后常落在乳房里面，画成正面的圆盘会像贴在乳房前缘外的一块)
      const snap=skipFixes.has('nippleSide')?2.5:fig.cupLevel>=1?W:2.5+8*clamp((fig.cupLevel-0.5)/0.5,0,1);
      out.unshift(e!==null&&Math.abs(nx-e)<=snap&&!(masks.belly[row*W+e]&&fig.bulk>=0.5)?{x:e+size*0.35,y:row,rx:size*0.5,ry:size*0.8,ryDown:size*1.45,tint,erect,edge:e}:{x:nx,y:ny,rx:size,ry:size,ryDown:size*1.3,tint,erect});
      return out;
    }
    // the far nipple, a little inside its breast's middle, low on it
    let farY=null;
    if(two){const f=box(lobes.list[1]);if(f.n>=4){farY=f.t+(f.b-f.t)*0.62;const size=sizeOf(f);out.push({x:f.l+(f.r-f.l)*0.4,y:farY,rx:size,ry:size,tint,erect})}}
    // the near nipple sits on the near breast's outline, at the same height as the far one (both breasts hang alike);
    // without a far breast, at the most forward point of its lower half. A row whose front is the belly is skipped.
    const lobe=lobes.list[0],nb=box(lobe);
    if(nb.n>=4){
      const size=sizeOf(nb),front=y=>{for(let x=0;x<W;x++)if(lobe[y*W+x])return masks.belly[y*W+x]&&fig.bulk>=0.5?null:x;return null};
      let row=null;
      if(farY!==null)for(let d=0;d<=6&&row===null;d++)for(const y of[Math.round(farY)-d,Math.round(farY)+d])if(row===null&&y>=nb.t&&y<=nb.b&&front(y)!==null)row=y;
      if(row===null){let best=null;for(let y=Math.round(nb.t+(nb.b-nb.t)*0.4);y<=Math.round(nb.t+(nb.b-nb.t)*0.85);y++){const e=front(y);if(e!==null&&(best===null||e<best[0]))best=[e,y]}if(best)row=best[1]}
      // in profile the areola runs on down the outline below the nipple more than above it
      if(row!==null){const e=front(row);out.unshift({x:e+size*0.35,y:row,rx:size*0.5,ry:size*0.8,ryDown:size*1.45,tint,erect,edge:e})}
    }
    return out;
  }
  /**
   * 修正点：参考点之间混合出来的瑕疵，由作者在某个状态（体型、罩杯、孕肚大小）手修后存下来。
   * 每一笔记：前缘在乳头上下各列移了几格（负是往前补、正是往里削）、两个乳头各移多少。
   * 当下状态离修正点越近套用得越完整，到范围边缘淡出为 0；多笔重叠时权重合计超过 1 就取加权平均。
   * 回传 { front: Map<相对乳头的列, 格数>, nipples: [[dx,dy],[dx,dy]], weight }；没有任何修正点作用时回传 null。
   */
  function patchWeights(fig){
    if(!patches.length||skipFixes.has('manual'))return null;
    const ease=t=>{const u=clamp(1-t,0,1);return u*u*(3-2*u)};
    const front=new Map(),nipples=[[0,0],[0,0]];let total=0;
    const active=[];
    for(const p of patches){
      const range=p.range||{};
      const w=ease(Math.abs(fig.sigma-p.sigma)/(range.sigma||0.75))*ease(Math.abs(fig.cup-p.cup)/(range.cup||25))*ease(Math.abs((fig.pressure||0)-p.pressure)/(range.pressure||2));
      if(w>0){active.push([p,w]);total+=w}
    }
    if(!active.length)return null;
    const scale=total>1?1/total:1;
    for(const [p,w] of active){
      for(const [row,dx] of p.front||[])front.set(row,(front.get(row)||0)+dx*w*scale);
      (p.nipples||[]).forEach((d,k)=>{if(d&&nipples[k]){nipples[k][0]+=d[0]*w*scale;nipples[k][1]+=d[1]*w*scale}});
    }
    return{front,nipples,weight:Math.min(1,total)};
  }

  function compose(fig){
    // (debugging switches: window.SKIP_FIX holds names of the fixes to leave out)
    const skip=k=>skipFixes.has(k);
    const manualPatch=patchWeights(fig);
    // 乳头的手修位移先套上（后面的胸衣上缘、盖住乳头、乳头的画法都用移过的位置）；同一张取形只套一次
    const nippleRow0=fig.nipplePoints?Math.round(fig._restNippleRow??fig.nipplePoints[0][1]):null;
    if(manualPatch&&fig.nipplePoints&&!fig._patched){fig._restNippleRow=fig.nipplePoints[0][1];fig.nipplePoints=fig.nipplePoints.map(([x,y],k)=>[x+manualPatch.nipples[k][0],y+manualPatch.nipples[k][1]]);fig._patched=true}
    const label=new Uint8Array(N),owner=new Uint8Array(N),f=fig,crotchRow=(fig.crotch-Y0)/STEP;
    const belowCut=y=>y>crotchRow+0.5;
    const manual=f.manual||{},abdomen=manual.belly?f.belly:smoothField(f.belly),cloth=manual.bra?f.bra:smoothField(f.bra),pants=manual.shorts?f.shorts:smoothField(f.shorts),neckRow=(365-Y0)/STEP;
    const masks={body:new Uint8Array(N),shorts:Uint8Array.from(pants,v=>v<0?1:0),
      belly:Uint8Array.from(abdomen,v=>v<0?1:0),bra:Uint8Array.from(f.bra,(v,i)=>(i/W|0)<=neckRow+3?v<0?1:0:cloth[i]<0?1:0)};
    if(!manual.bra){for(const side of fig.straps)for(const [cx,cy,w]of side){const y=Math.round(cy);for(let x=Math.ceil(cx-w/2);x<=Math.floor(cx+w/2);x++)if(x>=0&&x<W&&y>=0&&y<H)masks.bra[y*W+x]=1}masks.bra=smoothLowerGarment(masks.bra,Math.ceil(neckRow)+5)}
    if(!manual.shorts)for(let y=0;y<H;y++){const span=rowSpan(masks.shorts,y);if(span)for(let x=span[0];x<=span[1];x++)masks.shorts[y*W+x]=1}
    masks.body=fig.reviewedModel?Uint8Array.from(f.body,v=>v<0?1:0):Uint8Array.from(f.neck,(v,i)=>v<0||masks.bra[i]?1:0);
    // Repair a surface only within its own material. No missing cell guesses a different layer.
    if(!manual.belly)attachBelly(masks,fig);
    for(const [id,mask]of Object.entries(masks)){
      if(manual[id])continue;
      if(id==='belly'||id==='shorts')keepLargest(mask);closeGaps(mask,H,H-1);
    }
    // Complete the posterior body at enclosed joints between surfaces. This adds no
    // foreground garment pixels: every garment and abdomen still owns its full mask.
    // 规则的改动记录：每条规则做完后，与上一个记号比对各图层遮罩与归属改了几格
    const ruleCells={};let ruleSign=null;
    const mark=name=>{const sign=new Uint8Array(N);for(let i=0;i<N;i++)sign[i]=masks.body[i]|masks.shorts[i]<<1|masks.belly[i]<<2|masks.bra[i]<<3|owner[i]<<4;
      if(name&&ruleSign){let n=0;for(let i=0;i<N;i++)if(sign[i]!==ruleSign[i])n++;ruleCells[name]=n}ruleSign=sign};
    mark(null);
    const geometry=fig.reviewedModel&&!skip('repair')?repairBodyGeometry(masks,fig):null;
    mark('repair');
    const envelope=Uint8Array.from(masks.body,(v,i)=>v||masks.shorts[i]||masks.belly[i]||masks.bra[i]?1:0),closed=Uint8Array.from(envelope);
    if(!Object.values(manual).some(Boolean)){closeGaps(closed,H,H-1);for(let i=0;i<N;i++)if(closed[i]&&!envelope[i])masks.body[i]=1}
    // The back above the chest: the references lose it where the arm was cut away, leaving a notch under the frame's
    // top edge. Above the widest row of the chest the back runs almost straight up (in one cell per six rows).
    {
      const vis=fig.layerVisibility,ids=['body','shorts','belly','bra'].filter(id=>vis[id]),chestLow=maskBounds(masks.bra).b;
      const right=y=>{for(let x=W-1;x>=0;x--)if(ids.some(id=>masks[id][y*W+x]))return x;return -1};
      let peak=-1,peakR=-1;for(let y=0;y<=chestLow&&y<H;y++){const r=right(y);if(r>peakR){peakR=r;peak=y}}
      if(!skip('backTop'))for(let y=0;y<peak;y++){const r=right(y),target=peakR-Math.floor((peak-y)/6);if(r>=0)for(let x=r+1;x<=target;x++)masks.body[y*W+x]=1}
    }
    const vis0=fig.layerVisibility;
    mark('backTop');
    // The breast regions, found once on the body as the references give it (before the fills below change its outline);
    // the front fill, the breasts resting on the belly, their shading and the nipples all use this one set.
    fig._lobes=null;
    if(fig.reviewedModel&&fig.underbust){const ub=fig.underbust,ubY=x=>{if(x<=ub[0][0])return ub[0][1];if(x>=ub.at(-1)[0])return ub.at(-1)[1];let j=0;while(ub[j+1][0]<x)j++;const t=(x-ub[j][0])/(ub[j+1][0]-ub[j][0]);return ub[j][1]+(ub[j+1][1]-ub[j][1])*t};
      fig._lobes=breastLobes(fig,masks.body,ubY,Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]?1:0))}
    // 胸弧补凹（插件新增）：近侧乳房的前缘。两个体型的乳房形状差太多时，混合出来的前缘会在乳头附近凹进去。
    // 从最前端附近到乳房下缘，把凹进去的地方补到「外凸的弧」（逐列前缘的下凸包）为止：只补不削，
    // 一段凹陷最深超过 5 格就整段不动（那是形状本身，不是混合的瑕疵）。
    if(fig._lobes&&fig._lobes.list.length>1&&!skip('breastArc')){
      const near=fig._lobes.list[0],vis=fig.layerVisibility,ids=['body','belly','bra'].filter(id=>vis[id]);
      const front=y=>{for(let x=0;x<W;x++)if(ids.some(id=>masks[id][y*W+x]))return x;return -1};
      let top=-1,bottom=-1,tipX=W;
      for(let y=0;y<H;y++){const x=front(y);if(x>=0&&near[y*W+x]){if(top<0)top=y;bottom=y;tipX=Math.min(tipX,x)}}
      // 上胸到乳房的斜坡不算：从前缘进到最前端 3 格内的那一列开始
      while(top>=0&&top<bottom&&front(top)>tipX+3)top++;
      if(top>=0&&bottom-top>=4){
        const xs=[];for(let y=top;y<=bottom;y++)xs.push(front(y));
        // 下凸包（x 越小越靠前）：留下的点连成的折线不高于任何一点
        const hull=[];
        for(let k=0;k<xs.length;k++){
          while(hull.length>=2){const a=hull[hull.length-2],b=hull[hull.length-1];if((xs[b]-xs[a])*(k-a)>=(xs[k]-xs[a])*(b-a))hull.pop();else break}
          hull.push(k);
        }
        for(let h=1;h<hull.length;h++){const a=hull[h-1],b=hull[h];if(b-a<2)continue;
          const line=k=>xs[a]+(xs[b]-xs[a])*(k-a)/(b-a);
          let deepest=0;for(let k=a+1;k<b;k++)deepest=Math.max(deepest,xs[k]-line(k));
          if(deepest>5)continue;
          for(let k=a+1;k<b;k++){const y=top+k;for(let x=Math.ceil(line(k));x<xs[k];x++){const i=y*W+x;masks.body[i]=1;near[i]=1}}}
      }
    }
    mark('breastArc');
    // Outline clean-up on the visible union: a cell touching it on one side only is a burr and goes from every layer,
    // an empty cell with the body on three sides is a notch and becomes body; a few passes so short spikes go entirely
    {
      const vis=fig.layerVisibility,ids=['body','shorts','belly','bra'].filter(id=>vis[id]);
      for(let pass=0;pass<(skip('cleanup')?0:3);pass++){
        const on=Uint8Array.from({length:N},(_,i)=>ids.some(id=>masks[id][i])?1:0);
        for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
          const i=y*W+x,n=on[i-1]+on[i+1]+on[i-W]+on[i+W];
          if(on[i]&&n<=1)for(const m of Object.values(masks))m[i]=0;
          else if(!on[i]&&n>=3)masks.body[i]=1;
        }
      }
    }
    mark('cleanup');
    // Shorts, cut at the crotch: everything of the body below the waistband is shorts (no thigh shows, and where the
    // belly hides most of the reference shorts the rest does not break into fragments). The waistband is the shorts'
    // top edge per column, smoothed, carried across columns where the belly hid it.
    if(fig.reviewedModel&&fig.layerVisibility.shorts&&!skip('shortsBand')){
      const top=Array.from({length:W},(_,x)=>{for(let y=0;y<H;y++)if(masks.shorts[y*W+x])return y;return NaN});
      const known=top.map((v,x)=>Number.isNaN(v)?null:x).filter(x=>x!==null);
      if(known.length){
        const filled=top.map((v,x)=>{if(!Number.isNaN(v))return v;let a=null,b=null;for(const k of known){if(k<x)a=k;else if(b===null)b=k}
          return a===null?top[b]:b===null?top[a]:top[a]+(top[b]-top[a])*(x-a)/(b-a)});
        // and at least the last four rows above the frame's lower edge are shorts, whatever the reference showed there
        const floor=(v=>v.y+v.h)(cameraFor(fig,masks.shorts))-4;
        const band=filled.map((_,x)=>{let n=0,t=0;for(let d=-4;d<=4;d++){const v=filled[x+d];if(v===undefined)continue;const w=Math.exp(-0.5*(d/2)**2);n+=w;t+=v*w}return Math.min(floor,Math.round(t/n))});
        // skin left between the belly's underside and the waistband closes up (the shorts sit under it)
        // (wherever the belly's underside is below the navel the waistband meets it; higher up, at the side, waist shows)
        const navelRow=(fig.navel[1]-Y0)/STEP;
        if(fig.bulk>=0.5)for(let x=0;x<W;x++){let low=-1;for(let y=0;y<H;y++)if(masks.belly[y*W+x])low=y;if(low>navelRow&&band[x]>low+1)band[x]=low+1}
        for(let x=0;x<W;x++)for(let y=0;y<H;y++){const i=y*W+x;masks.shorts[i]=y>=band[x]&&(masks.body[i]||masks.shorts[i])?1:0}
        // and below the belly's most forward row, the body in front of the belly is the shorts' front (the hips under it)
        if(fig.bulk>=0.5){const front=y=>{for(let x=0;x<W;x++)if(masks.belly[y*W+x])return x;return null};
          let tip=-1,tipX=W;for(let y=0;y<H;y++){const f=front(y);if(f!==null&&f<tipX){tipX=f;tip=y}}
          let last=tipX;if(tip>=0)for(let y=tip+1;y<H;y++){const f=front(y)??last;last=f;for(let x=0;x<f;x++){const i=y*W+x;if(masks.body[i])masks.shorts[i]=1}}}
      }
    }
    mark('shortsBand');
    // Breasts resting on a grown belly: where a breast's underside comes within 4 rows of the belly's top the gap
    // between them (a band of chest that reads as a layer caught in between) becomes breast, and where they overlap the
    // breast lies in front of the belly. The line where they touch is a crease on the belly (drawn in paint).
    let resting=null;
    // (undressed only: a sports top holds the breasts up off the belly)
    if(fig.reviewedModel&&fig.bulk>=0.8&&fig.layerVisibility.belly&&!fig.layerVisibility.bra&&fig.underbust){
      const ub=fig.underbust,ubY=x=>{if(x<=ub[0][0])return ub[0][1];if(x>=ub.at(-1)[0])return ub.at(-1)[1];let j=0;while(ub[j+1][0]<x)j++;const t=(x-ub[j][0])/(ub[j+1][0]-ub[j][0]);return ub[j][1]+(ub[j+1][1]-ub[j][1])*t};
      const lobes=fig._lobes??breastLobes(fig,masks.body,ubY,Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]?1:0)),contact=new Uint8Array(N),cb=new Map();
      for(const lobe of lobes.list)for(let x=0;x<W;x++){
        let lb=-1;for(let y=0;y<H;y++)if(lobe[y*W+x])lb=y;if(lb<0)continue;
        let bt=-1;for(let y=0;y<H;y++)if(masks.belly[y*W+x]){bt=y;break}if(bt<0)continue;
        if(bt<=lb){for(let y=bt;y<=lb;y++)if(lobe[y*W+x])masks.belly[y*W+x]=0;if(lb+1<H&&masks.belly[(lb+1)*W+x])cb.set(x,Math.max(cb.get(x)??-1,lb))}
        else if(bt-lb<=4){for(let y=lb+1;y<bt;y++)if(masks.body[y*W+x])lobe[y*W+x]=1;cb.set(x,Math.max(cb.get(x)??-1,bt-1))}
      }
      // the crease follows the contact smoothed across the columns (column by column it zigzags), one cell below it
      for(const [x] of cb){let n=0,t=0;for(let d=-3;d<=3;d++)if(cb.has(x+d)){const w=Math.exp(-0.5*(d/1.5)**2);n+=w;t+=cb.get(x+d)*w}
        const y=Math.round(t/n)+1;for(const yy of[y,y+1,y-1])if(yy>=0&&yy<H&&masks.belly[yy*W+x]){contact[yy*W+x]=1;break}}
      const bottom=lobes.bottom;lobes.bottom=x=>cb.has(Math.round(x))?cb.get(Math.round(x)):bottom(x);
      resting={lobes,contact};
    }
    mark('resting');
    const codes={body:1,shorts:2,belly:3,bra:4},materials={body:SKIN,shorts:SHORTS,belly:SKIN,bra:BRA};
    const enabled=fig.layerVisibility;
    for(const id of ['body','shorts','belly','bra'])if(enabled[id])for(let i=0;i<N;i++)if(masks[id][i]){owner[i]=codes[id];label[i]=materials[id]}
    mark(null);
    // a garment peeking out as a few cells beside the belly reads as noise: give such slivers to what surrounds them
    // (counted inside the frame only: a sliver joined to the rest below the frame's edge is still a sliver on screen)
    const shown=cameraFor(fig,masks.shorts),inFrame=i=>{const y=i/W|0;return y>=shown.y&&y<shown.y+shown.h};
    for(const code of[codes.shorts,codes.bra]){const seen=new Uint8Array(N);
      for(let s0=0;s0<N;s0++)if(owner[s0]===code&&!seen[s0]&&inFrame(s0)){const cells=[s0];seen[s0]=1;
        for(let h=0;h<cells.length;h++){const i=cells[h],x=i%W;for(const j of[i-1,i+1,i-W,i+W])if(j>=0&&j<N&&Math.abs(j%W-x)<=1&&owner[j]===code&&!seen[j]&&inFrame(j)){seen[j]=1;cells.push(j)}}
        if(cells.length>=12)continue;
        const votes={};for(const i of cells){const x=i%W;for(const j of[i-1,i+1,i-W,i+W])if(j>=0&&j<N&&Math.abs(j%W-x)<=1&&owner[j]&&owner[j]!==code)votes[owner[j]]=(votes[owner[j]]||0)+1}
        const to=+Object.keys(votes).sort((a,b)=>votes[b]-votes[a])[0]||0;if(!to)continue;
        const id=['','body','shorts','belly','bra'][to],own=['','body','shorts','belly','bra'][code];for(const i of cells){owner[i]=to;label[i]=materials[id];masks[id][i]=1;masks[own][i]=0}}}
    mark('slivers');
    // A spike of shorts one cell wide sticking up from the waistband (two figures' waistbands meet the back at different
    // heights; the blend leaves the higher one's corner as a thin stalk with skin beside it) is cut back, from its tip
    // down, to where the shorts are at least two cells wide.
    if(fig.reviewedModel&&fig.layerVisibility.shorts)for(let pass=0;pass<12;pass++){let cut=0;
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;
        if(owner[i]===codes.shorts&&owner[i-1]!==codes.shorts&&owner[i+1]!==codes.shorts&&owner[i-W]!==codes.shorts&&owner[i+W]===codes.shorts){
          const to=owner[i-1]||owner[i+1]||owner[i-W];if(!to)continue;const id=['','body','shorts','belly','bra'][to];
          owner[i]=to;label[i]=materials[id];masks[id][i]=1;masks.shorts[i]=0;cut++}}
      if(!cut)break}
    mark('shortsSpike');
    // The waistband rises toward the back in every reference, its highest point on the back outline. Where two figures
    // put that corner in different places the blend peaks inside and drops again before the back, leaving a wedge of
    // skin between the peak and the outline. On the back piece of the shorts, from its highest column backward, the
    // waistband may not drop: the skin it would leave under the line is the shorts'.
    if(fig.reviewedModel&&fig.layerVisibility.shorts&&!skip('waistband')){
      let right=-1,rs=-1;for(let i=0;i<N;i++)if(owner[i]===codes.shorts&&i%W>right){right=i%W;rs=i}
      if(rs>=0){const piece=new Uint8Array(N),todo=[rs];piece[rs]=1;
        while(todo.length){const j=todo.pop(),x=j%W;for(const k of[j-1,j+1,j-W,j+W])if(k>=0&&k<N&&Math.abs(k%W-x)<=1&&!piece[k]&&owner[k]===codes.shorts){piece[k]=1;todo.push(k)}}
        const top=new Int32Array(W).fill(-1);for(let i=0;i<N;i++)if(piece[i]&&top[i%W]<0)top[i%W]=i/W|0;
        let peak=-1;for(let x=0;x<W;x++)if(top[x]>=0&&(peak<0||top[x]<=top[peak]))peak=x;
        // (only over the columns the back piece covers)
        if(peak>=0){const level=top[peak];for(let x=peak+1;x<W&&top[x]>=0;x++)
          for(let y=level;y<top[x];y++){const i=y*W+x;if(owner[i]===codes.body){owner[i]=codes.shorts;label[i]=SHORTS;masks.shorts[i]=1;masks.body[i]=0}}}}
    }
    mark('waistband');
    // single skin cells left inside the shorts, or squeezed between a grown belly and the waistband, are shorts
    if(fig.reviewedModel&&fig.layerVisibility.shorts)for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;if(owner[i]!==codes.body)continue;
      const n=[owner[i-1],owner[i+1],owner[i-W],owner[i+W]].filter(v=>v===codes.shorts).length;
      if(n>=3||(fig.bulk>=0.5&&owner[i-W]===codes.belly&&owner[i+W]===codes.shorts)){owner[i]=codes.shorts;label[i]=SHORTS;masks.shorts[i]=1}}
    mark('shortsFill');
    // The top holds the whole breast: a big breast lying on the belly reaches below the top's blended hem, and its lower
    // part showed as bare skin between the top and the crease the nude picture draws there. A breast cell (the lobes end at
    // that crease and follow the breast's own curve) below the top's upper edge is the top's. The upper edge is read per
    // column; a column the top does not reach (the breast's lower front bulges out past it) takes the nearest one's. The
    // lobes also take in the chest above the top, which stays bare.
    if(fig.reviewedModel&&enabled.bra&&fig._lobes){
      const upper=Array.from({length:W},(_,x)=>{for(let y=0;y<H;y++)if(owner[y*W+x]===codes.bra)return y;return -1});
      const edge=x=>{for(let d=0;d<W;d++){for(const c of[x-d,x+d])if(c>=0&&c<W&&upper[c]>=0)return upper[c]}return H};
      for(const lobe of fig._lobes.list)for(let x=0;x<W;x++){const top=edge(x);
        for(let y=top+1;y<H;y++){const i=y*W+x;if(lobe[i]&&(owner[i]===codes.body||owner[i]===codes.belly)){owner[i]=codes.bra;label[i]=BRA;masks.bra[i]=1}}}
    }
    mark('braHoldsBreast');
    // A run of up to three skin cells with the top on both sides of it and above or below it is a pocket the blend of two
    // figures' straps leaves (each puts its strap edge in a different column), not the neckline: the top's.
    if(fig.reviewedModel&&enabled.bra)for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;
      if(owner[i-1]!==codes.bra||owner[i]!==codes.body)continue;let e=x;while(e<W-1&&owner[y*W+e]===codes.body&&e-x<4)e++;
      if(e-x>3||owner[y*W+e]!==codes.bra)continue;
      let closed=true;for(let k=x;k<e;k++)if(owner[(y-1)*W+k]!==codes.bra&&owner[(y+1)*W+k]!==codes.bra)closed=false;
      if(closed)for(let k=x;k<e;k++){const j=y*W+k;owner[j]=codes.bra;label[j]=BRA;masks.bra[j]=1}}
    mark('braPocket');
    // A lone skin cell standing on the top's front outline (open space before it, the top behind it) is the blend of
    // the body and top fields rounding differently by a cell; it showed as a broken light line down the breast's edge.
    if(fig.reviewedModel&&enabled.bra)for(let y=0;y<H;y++)for(let x=1;x<W-1;x++){const i=y*W+x;
      if(owner[i]===codes.body&&!owner[i-1]&&owner[i+1]===codes.bra){owner[i]=codes.bra;label[i]=BRA;masks.bra[i]=1}}
    mark('braFrontCell');
    // The top always keeps its far shoulder strap: between body types whose references cut the top at different heights
    // the blend can stop short of the outline and bare the far shoulder (the near one is always covered). Read off the
    // finished picture (after the slivers above are given away): from the frame's top down to where the left outline
    // has been the top for three rows, the strap runs along the outline, 4 cells wide, over bare skin only.
    // Strapless top (a choice beside the sports top): the lower part is the sports top's (its hem, and the whole breast
    // when it lies on the belly), the upper edge a sweetheart line across both breasts: on each breast a set
    // height over its nipple, two rows lower toward its sides. Above that line the top's cells inside
    // a breast or on the body are bare skin, and the straps (where they stand out past the body) are gone; beyond the
    // breasts toward the back the line carries on level from the far breast.
    if(fig.reviewedModel&&enabled.bra&&fig.strapless&&fig._lobes&&fig.nipplePoints){
      const lobes=fig._lobes.list,line=new Float32Array(W).fill(NaN);
      lobes.forEach((lobe,k)=>{let l=W,r=-1,t=H,b=-1;for(let i=0;i<N;i++)if(lobe[i]){const x=i%W,y=i/W|0;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
        if(r<l)return;const ny=fig.nipplePoints[Math.min(k,1)][1],cx=(l+r)/2,half=Math.max(1,(r-l)/2);
        // held at a set height over the nipple (3 rows at AAA, 9 at I, 12 at N, scaled with the body), so it rides the
        // breath with the nipple; read off the sports top's edge it hopped a row from frame to frame
        const top=ny-(3+6*clamp(fig.cupLevel??0.5,0,1.5))*(fig.size||1);
        for(let x=l;x<=r;x++){const y=top+2*((x-cx)/half)**2;line[x]=Number.isNaN(line[x])?y:Math.min(line[x],y)}});
      // past the breasts the line carries on level: back toward the far side, and forward of the near breast (a small
      // breast's front edge left the sports top standing up there)
      let last=NaN;for(let x=0;x<W;x++){if(!Number.isNaN(line[x]))last=line[x];else if(!Number.isNaN(last))line[x]=last}
      let first=line.findIndex(v=>!Number.isNaN(v));if(first>0)for(let x=0;x<first;x++)line[x]=line[first];
      // 上缘顺成一条线（插件新增）：两个乳房各照自己的乳头高度定上缘，乳头高度差很多时交界处是一个台阶。
      // 沿栏位取高斯平均（σ 3 栏）；乳头一定盖住由后面的规则保证。
      if(!skip('strapTop')){const smooth=new Float32Array(W).fill(NaN);
        for(let x=0;x<W;x++){if(Number.isNaN(line[x]))continue;let sum=0,total=0;for(let d=-8;d<=8;d++){const v=line[x+d];if(v===undefined||Number.isNaN(v))continue;const w=Math.exp(-0.5*(d/3)**2);sum+=v*w;total+=w}smooth[x]=sum/total}
        line.set(smooth)}
      for(let x=0;x<W;x++){if(Number.isNaN(line[x]))continue;for(let y=0;y<line[x]&&y<H;y++){const i=y*W+x;if(owner[i]!==codes.bra)continue;
        masks.bra[i]=0;if(masks.body[i]||lobes.some(l=>l[i])){owner[i]=codes.body;label[i]=SKIN;masks.body[i]=1}else{owner[i]=0;label[i]=0}}}
    }
    mark('strapless');
    // The top always covers the nipples (every reference marks them): skin within two and a half cells of either is the
    // top's, and the near one, on the outline, also gets the top run out to the body's front edge three rows above and
    // below it (at most six cells), where the blended top can stop short of a breast that reaches past it.
    if(fig.reviewedModel&&enabled.bra&&fig.nipplePoints){
      const toTop=i=>{if(owner[i]===codes.body||owner[i]===codes.belly){owner[i]=codes.bra;label[i]=BRA;masks.bra[i]=1}};
      for(const [px,py] of fig.nipplePoints)for(let y=Math.floor(py-2.5);y<=Math.ceil(py+2.5);y++)for(let x=Math.floor(px-2.5);x<=Math.ceil(px+2.5);x++)
        if(x>=0&&x<W&&y>=0&&y<H&&Math.hypot(x-px,y-py)<=2.5)toTop(y*W+x);
      const [nx,ny]=fig.nipplePoints[0];
      for(let y=Math.max(0,Math.round(ny)-3);y<=Math.min(H-1,Math.round(ny)+3);y++){let front=-1,top=-1;
        for(let x=0;x<W;x++){const o=owner[y*W+x];if(front<0&&o)front=x;if(o===codes.bra){top=x;break}}
        if(front>=0&&top>front&&top-front<=6)for(let x=front;x<top;x++)toTop(y*W+x)}
    }
    mark('braCoversNipples');
    // 胸衣前缘（插件新增）：近侧乳头以下，身体最前缘到胸衣之间留着一小块皮肤楔形（乳房前下方在乳瓣范围外，
    // 「胸衣包住整个乳房」补不到）。从乳头往下逐列，前缘到胸衣之间最多 8 格的皮肤算胸衣；到没有胸衣的列为止。
    if(fig.reviewedModel&&enabled.bra&&fig.nipplePoints&&!skip('braWedge')){
      const ny=Math.round(fig.nipplePoints[0][1]);
      for(let y=Math.max(0,ny+4);y<H;y++){let front=-1,top=-1;
        for(let x=0;x<W;x++){const o=owner[y*W+x];if(front<0&&o)front=x;if(o===codes.bra){top=x;break}if(front>=0&&o!==codes.body&&o!==codes.belly)break}
        if(top<0)break;
        if(top>front&&top-front<=8)for(let x=front;x<top;x++){const i=y*W+x;if(owner[i]===codes.body||owner[i]===codes.belly){owner[i]=codes.bra;label[i]=BRA;masks.bra[i]=1}}}
    }
    mark('braWedge');
    if(fig.reviewedModel&&enabled.bra&&!fig.strapless&&Number.isFinite(fig.neckX)){
      const mid=(fig.neckX-X0)/STEP;let last=-1;
      for(let y=0;y<H;y++)for(let x=0;x<mid;x++)if(owner[y*W+x]===codes.bra){last=y;break}
      const edge=y=>{for(let x=0;x<mid;x++)if(owner[y*W+x])return x;return-1};
      const covered=y=>{const x=edge(y);return x>=0&&owner[y*W+x]===codes.bra};
      let stop=Math.max(0,shown.y);
      while(stop<last&&!(covered(stop)&&covered(stop+1)&&covered(stop+2)))stop++;
      for(let y=0;y<stop;y++){
        const left=edge(y);if(left<0)continue;
        for(let x=left;x<left+4&&x<mid;x++){const i=y*W+x;if(owner[i]===codes.body){owner[i]=codes.bra;label[i]=BRA;masks.bra[i]=1}}
      }
    }
    mark('farStrap');
    // 孕肚弧（插件新增）：孕肚的前缘逐列平滑。参考的前缘有连续好几列同一栏、再一次退两格的平台，
    // 看起来是凸出一块而不是圆弧。在成图的最后做（衣物都定了之后）：最前面是孕肚（或贴着孕肚的一两格皮肤）的那几列，
    // 逐列取高斯平均（σ 4 列）后重画，每列最多改 2 格；头尾各两列不动，与胸口、短裤的交界保持原样。
    if(fig.bulk>0&&enabled.belly&&!skip('bellyArc')){
      const rows=[];
      for(let y=0;y<H;y++){let x=-1;for(let c=0;c<W;c++)if(owner[y*W+c]){x=c;break}
        if(x<0)continue;let belly=false;for(let c=x;c<=x+2&&c<W;c++){const o=owner[y*W+c];if(o===codes.belly){belly=true;break}if(o!==codes.body)break}
        if(belly)rows.push([y,x])}
      // 只取最长的一段连续列
      let best=[],run=[];for(const r of rows){if(run.length&&r[0]!==run[run.length-1][0]+1){if(run.length>best.length)best=run;run=[]}run.push(r)}if(run.length>best.length)best=run;
      if(best.length>=9){const SIG=4,n=best.length,targets=[];
        for(let k=0;k<n;k++){let sum=0,total=0;for(let d=-12;d<=12;d++){const j=Math.max(0,Math.min(n-1,k+d)),w=Math.exp(-0.5*(d/SIG)**2);sum+=best[j][1]*w;total+=w}
          targets.push(k<2||k>=n-2?best[k][1]:Math.max(best[k][1]-2,Math.min(best[k][1]+2,Math.round(sum/total))))}
        for(let k=0;k<n;k++){const [y,x]=best[k],target=targets[k];
          for(let c=target;c<x;c++){const i=y*W+c;owner[i]=codes.belly;label[i]=SKIN;masks.belly[i]=1}
          for(let c=x;c<target;c++){const i=y*W+c;owner[i]=0;label[i]=0;for(const m of Object.values(masks))m[i]=0}}}
    }
    mark('bellyArc');
    // 手修的前缘（修正点）：以近侧乳头那一列为基准的各列，前缘往前补或往里削
    if(manualPatch&&nippleRow0!==null){
      for(const [rel,amount] of manualPatch.front){
        const y=nippleRow0+rel,dx=Math.round(amount);if(!dx||y<0||y>=H)continue;
        let front=-1;for(let x=0;x<W;x++)if(owner[y*W+x]){front=x;break}
        if(front<0)continue;
        if(dx<0){const code=owner[y*W+front],id=['','body','shorts','belly','bra'][code];
          for(let x=Math.max(0,front+dx);x<front;x++){const i=y*W+x;owner[i]=code;label[i]=materials[id];masks[id][i]=1}}
        else for(let x=front;x<front+dx&&x<W;x++){const i=y*W+x;if(!owner[i])break;owner[i]=0;label[i]=0;for(const m of Object.values(masks))m[i]=0}
      }
    }
    mark('manual');
    const visibleBelly=Uint8Array.from(owner,v=>v===codes.belly?1:0);
    const D=9+2.4*clamp(fig.bulk,0,5),z=new Float32Array(N);
    // (the top counts too: where a strap stands out past the body, leaving it out made the skin of the neckline the
    // body's edge, lit as a bright stripe)
    const depthMask=fig.reviewedModel?Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]||masks.bra[i]?1:0):closed,surfaceDistance=signedField(depthMask);
    // Re-distance the union before applying TRACE's original dome/light model.
    // Interpolated fields are not true distances; their internal joins caused false ridges.
    for(let i=0;i<N;i++){const d=clamp(-surfaceDistance[i]/D,0,1);z[i]=Math.sqrt(1-(1-d)*(1-d))}
    // The height above is read from the nearest outline only, so a body is lit like a slab with rounded edges. A big
    // belly's front runs straight down for many rows, and there the tones split along straight vertical lines. The belly
    // is round top to bottom as well: across its own height it rises to the middle and falls away (top facing up, the
    // underside down), coming in from twins and full from triplets.
    const sphere=0.45*clamp(fig.bulk-2,0,1);
    if(fig.reviewedModel&&sphere>0){let top=H,bottom=-1;for(let i=0;i<N;i++)if(masks.belly[i]){const y=i/W|0;top=Math.min(top,y);bottom=Math.max(bottom,y)}
      // 横向也要圆：只照列高变化时，距离场的平台（离轮廓够远、高度都是 1）每一列同高，明暗分界成了一条条水平直线。
      // 改成椭球：每列再照这一列孕肚的左右宽度往两侧落下（横向权重 0.7，免得两侧太暗）
      if(bottom>top){const cy=(top+bottom)/2,ry=(bottom-top)/2,rowL=new Int16Array(H).fill(-1),rowR=new Int16Array(H).fill(-1);
        for(let i=0;i<N;i++)if(masks.belly[i]){const x=i%W,y=i/W|0;if(rowL[y]<0)rowL[y]=x;rowR[y]=x}
        for(let i=0;i<N;i++)if(masks.belly[i]){const x=i%W,y=i/W|0,v=(y-cy)/ry,rx=Math.max(1,(rowR[y]-rowL[y])/2),u=(x-(rowL[y]+rowR[y])/2)/rx;
          z[i]*=1-sphere+sphere*Math.sqrt(clamp(1-v*v-0.7*u*u,0,1))}}}
    // a contracting womb is hard and round: the belly's relief deepens (up to a third more), so its light and shade sharpen
    // (宫缩不再把整个孕肚的起伏加深：那会让整片上腹的明暗一起跳。改在下面跟着侧腹转折线一起变，见 belly_turn)
    // a belly just emptied is soft and loose: its relief flattens (up to 15%), firming back over the recovery
    if(fig.soft>0.01)for(let i=0;i<N;i++)if(masks.belly[i])z[i]*=1-0.15*fig.soft;
    // from I up the chest's shadows deepen (I half, K and up fully): lower breast, under-bust and cleavage
    const deep=clamp(((fig.cupLevel??0.5)*100-85)/30,0,1);
    if(fig.reviewedModel){
      const soft=smoothField(z);
      // One body surface supplies skin and fabric normals; the author's creases cut shallow grooves. (The breast
      // relief read off the breast lines is no longer used: the near breast's line is short and the far one's lobe ended
      // in a straight edge, which lit up as vertical stripes. The breasts get the dome below instead.)
      for(let i=0;i<N;i++)z[i]=Math.max(0,soft[i]-clamp(fig.creaseRelief[i],0,0.12)*(1+deep));
    }
    // the breasts are their own dome above the under-bust curve, so the top reads round instead of flat
    let breastTop=null,breastHeight=[];
    if(fig.underbust){
      const ub=fig.underbust,ubY=x=>{if(x<=ub[0][0])return ub[0][1];if(x>=ub.at(-1)[0])return ub.at(-1)[1];let j=0;while(ub[j+1][0]<x)j++;const t=(x-ub[j][0])/(ub[j+1][0]-ub[j][0]);return ub[j][1]+(ub[j+1][1]-ub[j][1])*t};
      const host=fig.reviewedModel?masks.body:masks.bra,grow=clamp((fig.cupLevel-0.15)/0.35,0,1);
      const lobes=resting?.lobes??fig._lobes??breastLobes(fig,host,ubY,Uint8Array.from(masks.body,(v,i)=>v||masks.belly[i]?1:0));
      fig.curveY=lobes.bottom;
      if(grow>0){
        breastTop=new Uint8Array(N);
        // each breast is a ball: height from its own outline (the sprite's cut top counts as inside), full across its width.
        // From I up (with the deeper shadows: I half, K and up fully) it is lit as a ball of its own: the torso's turn under
        // it is kept at a third (as the grown breasts stand off the ribs), else the far breast, out where the torso turns away, sank wholly into the darkest tone and the two read
        // as one flat slab.
        breastHeight=[];
        for(const [k,lobe] of lobes.list.entries()){
          // the near breast's side toward the far one is not an outline: the two meet at the cleavage. Counted as an edge
          // its dome fell to nothing there and a wide band of its inner side went to the darkest tone; read past it, the
          // near breast stays full up to the cleavage and the step down onto the far breast leaves a thin shadow there.
          // Above the cleavage line's top the two are one chest, no fold: there the far breast reads past the near one too,
          // else the step between them ran on up the sternum as a seam (it looked like a neck rising out of the cleavage).
          const two=lobes.list.length>1,cleftRow=lobes.cleftTop??-1;
          const other=!two?null:k===0?lobes.list[1]:lobes.list[0].map((v,i)=>v&&(i/W|0)<cleftRow?1:0);
          const d=distanceTo(lobe.map((v,i)=>v||other?.[i]||(i/W|0)<2?0:1));let R=1,n=0,mean=0,top=H,bottom=-1;for(let i=0;i<N;i++)if(lobe[i]){R=Math.max(R,d[i]);n++;mean+=z[i];top=Math.min(top,i/W|0);bottom=Math.max(bottom,i/W|0)}
          mean/=Math.max(1,n);breastHeight.push(Math.max(0,bottom-top+1));
          // (the surface's slopes are scaled by D, which grows with the belly so it stays round; the breasts' own dome is
          // held at the not-pregnant D, else a quintuplet belly made them 2.3 times as steep and nearly all darkest tone)
          // engorged (乳意 past half, fully at the cap): the size stays (a cup does not change overnight) but the breast
          // goes tight and round: the dome stands up to a third higher, the big-cup flattening eases off, and the upper
          // half fills out (it no longer slopes in from the top)
          const e=fig.breast?.engorged||0,A=grow*clamp(fig.cupLevel,0,1.5)*R*0.07*9/D*(1+0.35*e),flat=0.65*deep*(1-0.6*e),span=Math.max(1,bottom-top);
          for(let i=0;i<N;i++)if(lobe[i]){const t=clamp(d[i]/R,0,1),up=clamp((bottom-(i/W|0))/span,0,1);z[i]+=flat*(mean-z[i])+A*Math.sqrt(1-(1-t)*(1-t))*(1+0.3*e*up*t);breastTop[i]=1}
        }
      }
    }
    // 上胸的接缝（插件新增）：乳沟线顶端以上，两个乳房是同一片胸口。两个乳瓣各自的球面在分界处高度不同，
    // 加上乳沟凹痕在线的顶端突然结束，会在乳沟上方留下几条与乳沟平行的明暗细纹。
    // 乳沟线顶端往下 2 列以上的乳房表面再平滑两次，细纹化开，乳沟本身（线以下）不动。
    if(breastTop&&fig._lobes&&fig._lobes.cleftTop>0&&!skip('chestSeam')){
      const limit=fig._lobes.cleftTop+2,soft=smoothField(smoothField(z));let n=0;
      for(let i=0;i<N;i++)if(breastTop[i]&&(i/W|0)<limit){z[i]=soft[i];n++}
      ruleCells.chestSeam=n;
    }
    // fetal movement lumps on the belly's face: a raised spot, lit on its upper-left and shaded below-right (one marked any
    // also raises the body and the shorts over it)
    for(const b of fig.bumps||[]){const r=Math.ceil(b.sigma*3),h=0.09*b.amp;
      for(let y=Math.max(0,Math.floor(b.y-r));y<=Math.min(H-1,b.y+r);y++)for(let x=Math.max(0,Math.floor(b.x-r));x<=Math.min(W-1,b.x+r);x++){const i=y*W+x;
        if(!(masks.belly[i]||(b.any&&(masks.body[i]||masks.shorts[i]))))continue;const dx=x-b.x,dy=y-b.y,d=Math.hypot(dx,dy);z[i]+=h*Math.exp(-(d*d)/(2*b.sigma*b.sigma));
        // a big kick stretches the skin: a crease round the lump on its shaded (lower, back) side
        if(b.crease&&dx+dy>0)z[i]-=0.12*b.crease*Math.exp(-((d-1.9*b.sigma)**2)/(2*0.55*0.55))*clamp((dx+dy)/(d+0.01),0,1)}}
    // the gut's growl: wave crests four cells apart (scaled with the body), slanting a little, running back across an oval patch (three
    // wavelengths over the growl), swelling in and dying away
    for(const r of fig.ripples||[]){const env=Math.sin(Math.PI*clamp(r.t,0,1)),phase=2*Math.PI*3*r.t;
      for(let y=Math.max(0,Math.floor(r.y-r.ry*1.5));y<=Math.min(H-1,r.y+r.ry*1.5);y++)for(let x=Math.max(0,Math.floor(r.x-r.rx*1.5));x<=Math.min(W-1,r.x+r.rx*1.5);x++){const i=y*W+x;
        if(!(masks.belly[i]||masks.body[i]||masks.shorts[i])||masks.bra[i])continue;const u=(x-r.x)/r.rx,v=(y-r.y)/r.ry,fall=Math.exp(-2*(u*u+v*v));
        z[i]+=0.11*env*fall*Math.sin(2*Math.PI*((x-r.x)+0.35*(y-r.y))/(r.wave||4)-phase)}}
    const skinTone=new Uint8Array(N),clothTone=new Uint8Array(N),zAt=(x,y)=>z[clamp(y,0,H-1)*W+clamp(x,0,W-1)];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x;if(!Object.values(masks).some(mask=>mask[i]))continue;
      const nx=(zAt(x-1,y)-zAt(x+1,y))*D*0.5,ny=(zAt(x,y-1)-zAt(x,y+1))*D*0.5,nl=Math.hypot(nx,ny,1);
      let lit=clamp((nx*LIGHT[0]+ny*LIGHT[1]+LIGHT[2])/nl,0,1);
      if(deep>0&&fig.curveY){const below=y-fig.curveY(x);
        // lower part of the breast turns away: the bottom 30% of the breast's height, at most 12 rows (a fixed 12 rows
        // was nearly half of an N breast, a dark band across both)
        if(breastTop?.[i])lit-=deep*0.22*clamp(1+below/clamp(0.3*Math.max(...breastHeight,1),4,12),0,1)**2;
        else if(breastTop)for(let k=1;k<=3;k++)if(y-k>=0&&breastTop[i-k*W]){lit-=deep*0.3*(1-(k-1)/3);break}}  // the shadow it casts, right under it
      lit=clamp(lit,0,1);
      // fabrics: three tones and one sheen; skin: four tones
      clothTone[i]=lit<0.5?0:lit<0.8?1:lit<0.94?2:3;skinTone[i]=lit<0.42?1:lit<0.66?2:lit<0.88?3:4;
    }
    const layers={};
    for(const id of ['body','shorts','belly','bra'])layers[id]={mask:masks[id],tone:despeckle(masks[id],id==='bra'||id==='shorts'?clothTone:skinTone)};
    // The belly's turn from front to side (author's 'belly_turn' line): skin behind it, toward the back, is one tone
    // darker, so the belly reads round. The line itself is not drawn. The band is held as a width measured in from the
    // back outline, so it follows the body: past the line's ends it carries on at the same width down to the thighs and
    // up toward the chest (narrowing there), and it widens from nothing as the line fades in with the pregnancy instead
    // of appearing all at once.
    for(const line of fig.manualLines||[]){
      if(line.kind!=='belly_turn'||!(line.strength>0.02))continue;
      const pts=line.points.map(p=>fig.warpPoint([(p[0]-X0)/STEP,(p[1]-Y0)/STEP])),edgeX=new Float32Array(H).fill(NaN);
      for(let k=1;k<pts.length;k++){const [a,b]=[pts[k-1],pts[k]];const y0=Math.min(a[1],b[1]),y1=Math.max(a[1],b[1]);
        for(let y=Math.ceil(y0);y<=Math.floor(y1);y++){const t=b[1]===a[1]?0:(y-a[1])/(b[1]-a[1]);if(y>=0&&y<H)edgeX[y]=a[0]+(b[0]-a[0])*t}}
      const back=Array.from({length:H},(_,y)=>{for(let x=W-1;x>=0;x--)if(masks.body[y*W+x]||masks.belly[y*W+x])return x;return -1});
      let first=edgeX.findIndex(v=>!Number.isNaN(v)),last=H-1;while(last>=0&&Number.isNaN(edgeX[last]))last--;
      if(first<0)continue;
      const raw=Array.from({length:H},(_,y)=>y<first?(back[first]-edgeX[first])*Math.max(0.5,1-(first-y)/30):y>last?back[last]-edgeX[last]:back[y]-edgeX[y]);
      const s=clamp(line.strength,0,1),width=raw.map((_,y)=>{let n=0,t=0;for(let d=-4;d<=4;d++){const v=raw[y+d];if(v===undefined)continue;const w=Math.exp(-0.5*(d/2)**2);n+=w;t+=v*w}return Math.max(0,t/n)*s});
      for(let y=0;y<H;y++){if(back[y]<0)continue;for(let x=Math.max(0,Math.ceil(back[y]-width[y]));x<W;x++){const i=y*W+x;
        for(const id of['belly','body'])if(masks[id][i]&&layers[id].tone[i]>1)layers[id].tone[i]--}}
      // 暗面边上原本就有一栏较亮的格（底下的明暗交界正好落在这里），减一阶后成了夹在暗面里的一条亮虚线：
      // 左右两格同阶、自己只亮一阶的单格并回邻格
      if(!skip('bellyTurnSeam'))for(let y=0;y<H;y++){if(back[y]<0)continue;const x0=Math.max(1,Math.ceil(back[y]-width[y])-3),x1=Math.min(W-2,Math.ceil(back[y]-width[y])+3);
        for(let x=x0;x<=x1;x++){const i=y*W+x;for(const id of['belly','body']){const t=layers[id].tone;
          if(masks[id][i]&&masks[id][i-1]&&masks[id][i+1]&&t[i-1]===t[i+1]&&t[i]===t[i-1]+1){t[i]=t[i-1];ruleCells.bellyTurnSeam=(ruleCells.bellyTurnSeam||0)+1}}}}
      // 宫缩（fig.firm，插件改）：孕肚绷紧时暗面从侧腹往外长，是连成一片的一块，不是整片上腹：
      //   侧腹的暗面往前推宽（最多 3 格）；从它的上端沿孕肚上缘、下端沿孕肚下缘各往前伸出一道渐薄的暗边；
      //   三者之间两格以内的缝补起来，暗边和侧腹平顺地接在一起。
      if(fig.firm>0.01){
        const firm=clamp(fig.firm,0,1),reach=3*firm;
        const band=new Uint8Array(N);
        for(let y=0;y<H;y++){if(back[y]<0||!(width[y]>0))continue;for(let x=Math.max(0,Math.ceil(back[y]-width[y]));x<W;x++)if(masks.belly[y*W+x])band[y*W+x]=1}
        if(band.some(Boolean)){
          const near=distanceTo(band),shade=new Uint8Array(N);
          for(let i=0;i<N;i++)if(masks.belly[i]&&(band[i]||near[i]<=reach))shade[i]=1;
          // 上缘与下缘的暗边：从侧腹暗面碰到孕肚上（下）缘的那一栏起，往前 40 栏内渐薄到 0
          const edgeRow=(x,fromTop)=>{if(fromTop){for(let y=0;y<H;y++)if(masks.belly[y*W+x])return y}else for(let y=H-1;y>=0;y--)if(masks.belly[y*W+x])return y;return -1};
          for(const fromTop of[true,false]){
            let start=-1;for(let x=0;x<W&&start<0;x++){const y=edgeRow(x,fromTop);if(y>=0&&shade[y*W+x])start=x}
            if(start<0)continue;
            for(let k=0;k<40;k++){const x=start-k,thick=Math.round(reach*(1-k/40));if(x<0||thick<=0)break;const y0=edgeRow(x,fromTop);if(y0<0)continue;
              for(let d=0;d<thick;d++){const y=fromTop?y0+d:y0-d;if(y>=0&&y<H&&masks.belly[y*W+x])shade[y*W+x]=1}}
          }
          // 补缝：左右或上下两格以内都是暗面的孕肚格子也算暗面
          for(let pass=0;pass<2;pass++){const add=[];
            for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){const i=y*W+x;if(shade[i]||!masks.belly[i])continue;
              const across=(shade[i-1]||shade[i-2])&&(shade[i+1]||shade[i+2]),down=(shade[i-W]||shade[i-2*W])&&(shade[i+W]||shade[i+2*W]);
              if(across||down)add.push(i)}
            for(const i of add)shade[i]=1}
          for(let i=0;i<N;i++)if(shade[i]&&!band[i]&&layers.belly.tone[i]>1)layers.belly.tone[i]--;
        }
      }
    }
    const tone=Uint8Array.from(owner,(v,i)=>v?layers[['','body','shorts','belly','bra'][v]].tone[i]:0);
    return{label,tone,fig,layers,owner,visibleBelly,geometry,rules:ruleCells,manual:manualPatch?{weight:manualPatch.weight,nippleRow:nippleRow0}:{weight:0,nippleRow:nippleRow0},contact:resting?.contact||null,nipples:fig.reviewedModel?nippleSpots(fig,masks):[],view:cameraFor(fig,masks.shorts)};
  }
  // No holes or slits in the body: background the body encloses is filled, and between the neckline and the crotch narrow
  // gaps in the outline are closed (a pocket was left where the near breast's underside meets the top of the belly)
  function closeGaps(label,from,to){
    const outside=new Uint8Array(N),queue=[];
    for(let x=0;x<W;x++)for(const y of[0,H-1])if(!label[y*W+x]){outside[y*W+x]=1;queue.push(y*W+x)}
    for(let y=0;y<H;y++)for(const x of[0,W-1])if(!label[y*W+x]&&!outside[y*W+x]){outside[y*W+x]=1;queue.push(y*W+x)}
    for(let h=0;h<queue.length;h++){const i=queue[h],x=i%W,y=i/W|0;
      for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=ny*W+nx;if(!label[j]&&!outside[j]){outside[j]=1;queue.push(j)}}}
    for(let i=0;i<N;i++)if(!label[i]&&!outside[i])label[i]=SKIN;
    const R=2,body=Uint8Array.from(label,v=>v?1:0),grown=new Uint8Array(N);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(!body[y*W+x])continue;
      for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const nx=x+dx,ny=y+dy;if(dx*dx+dy*dy<=R*R&&nx>=0&&ny>=0&&nx<W&&ny<H)grown[ny*W+nx]=1}
    }
    for(let y=Math.max(0,from);y<=Math.min(H-1,to);y++)for(let x=0;x<W;x++){
      const i=y*W+x;if(body[i]||!grown[i])continue;
      let shut=true;
      for(let dy=-R;shut&&dy<=R;dy++)for(let dx=-R;shut&&dx<=R;dx++){const nx=x+dx,ny=y+dy;if(dx*dx+dy*dy<=R*R&&!(nx>=0&&ny>=0&&nx<W&&ny<H&&grown[ny*W+nx]))shut=false}
      if(shut)label[i]=SKIN;
    }
  }
  // Only the body itself: the largest connected piece; specks and slivers left by the references go
  function keepLargest(label){
    const comp=new Int32Array(N).fill(-1);let best=-1,bestSize=0,id=0;
    for(let i=0;i<N;i++){
      if(!label[i]||comp[i]>=0)continue;
      const queue=[i];comp[i]=id;
      for(let h=0;h<queue.length;h++){const j=queue[h],x=j%W,y=j/W|0;
        for(const [dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const k=ny*W+nx;if(label[k]&&comp[k]<0){comp[k]=id;queue.push(k)}}}
      if(queue.length>bestSize){bestSize=queue.length;best=id}
      id++;
    }
    for(let i=0;i<N;i++)if(label[i]&&comp[i]!==best)label[i]=0;
  }
  function despeckle(label,band){
    const out=Uint8Array.from(band);
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      const i=y*W+x,k=label[i];if(!k)continue;
      const n=[i-1,i+1,i-W,i+W].filter(j=>label[j]===k).map(j=>band[j]);
      if(n.length<3||n.includes(band[i]))continue;
      const count={};let best=n[0];for(const v of n){count[v]=(count[v]||0)+1;if(count[v]>count[best])best=v}
      out[i]=best;
    }
    return out;
  }
  const contourSampleCache=new WeakMap();
  function contourCurveSegments(line){
    const p=line.points,n=p.length,out=[],count=line.closed?n:n-1;
    for(let i=0;i<count;i++){const a=p[i],b=p[(i+1)%n];if(line.smooth&&n>2){const before=p[line.closed?(i+n-1)%n:Math.max(0,i-1)],after=p[line.closed?(i+2)%n:Math.min(n-1,i+2)];out.push([a,[a[0]+(b[0]-before[0])/6,a[1]+(b[1]-before[1])/6],[b[0]-(after[0]-a[0])/6,b[1]-(after[1]-a[1])/6],b])}else out.push([a,b])}return out;
  }
  function sampleContourLine(line){
    if(contourSampleCache.has(line))return contourSampleCache.get(line);
    const segments=contourCurveSegments(line);
    const out=[],budget=Math.max(4,Math.floor(4096/Math.max(1,segments.length)));
    for(const points of segments){const length=points.slice(1).reduce((n,v,i)=>n+Math.hypot(v[0]-points[i][0],v[1]-points[i][1]),0),steps=Math.min(budget,Math.max(1,Math.ceil(length/STEP*2)));for(let i=0;i<=steps;i++){const t=i/steps;if(points.length===4){const [a,b,c,d]=points;out.push([(1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],(1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]])}else out.push([points[0][0]+(points[1][0]-points[0][0])*t,points[0][1]+(points[1][1]-points[0][1])*t])}}
    contourSampleCache.set(line,out);return out;
  }

  /** 要全部参考才算得出来的值，烘焙时算好放进档头（derived） */
  function computeDerived(){
    const camera=computeCameras();
    const viewHeight=Math.min(H,2+Math.max(...ANCHORS.map(a=>{let last=0;for(let i=0;i<N;i++)if(a.cls[i]&&a.cls[i]!==LEGS)last=(i/W)|0;return last})));
    // 固定画框：宽取全格宽；高取「最低的胯下」到「最高的画框上缘」（N 罩杯时上缘上移 6 列）
    const bottom=Math.max(...Object.values(MODEL.groinBottom).map(v=>Math.round(v))),top=Math.max(1,Math.max(...Object.values(camera).map(c=>c.y))-Math.round(clamp(CUP_MAX-50,0,100)*0.06));
    return{camera,viewHeight,frame:{width:W,height:bottom-top}};
  }
  function clearCache(){figureCache.clear();for(const anchor of live.splice(0))anchor.release()}

  return {
    grid:{width:W,height:H,step:STEP,x0:X0,y0:Y0},
    /** 固定画框的大小（格）：不随体型、罩杯改变 */
    get frame(){return data.header?.derived?.frame||computeDerived().frame},
    labels:{SKIN,BRA,SHORTS,TRIM,LEGS},
    cups:CUPS,sigmas:SIGMAS,stages:STAGES,maxPressure:MAX_PRESSURE,maxDays:MAX_DAYS,
    anchors:ANCHORS,model:MODEL,stats,skipFixes,
    clamp,cupInk,pressureOf,bulkOf,sampleContourLine,
    figureFor,compose,cameraFor,
    /** 状态 → 成图（静止画面不带 motion） */
    layout:(state,motion=null)=>compose(figureFor(state,motion)),
    computeDerived,clearCache,
    /** 换一组修正点（编辑器即时预览用；成图没有快取，下一次 layout() 就生效） */
    setPatches(list){patches=Array.isArray(list)?list:[]},
    get patches(){return patches},
  };
}
