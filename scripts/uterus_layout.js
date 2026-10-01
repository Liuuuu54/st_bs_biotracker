// 子宫像素图的版面：只读角色状态，算出 96×120 画布上要画什么、画在哪。
// 纯函式，不碰 DOM、不写回状态；状态改变时算一次，绘制层每帧只照着画。
// 几何沿用 Sol 6 试作：子宫在画框中央随孕程从小长到大，胎儿按左右顺序排格、
// 按下降位置分高度，再做有轮数上限的推挤。
import { LABOR_STAGES, PREGNANCY_STAGE_DAYS } from './stage_config.js';
import { describeFetalPosition, getLaborObstruction, getPregnancyPressureRisk, isFetusKnownToCharacter } from './tools.js';

export const UTERUS_CANVAS = Object.freeze({ width: 96, height: 120 });
export const MAX_DRAWN_FETUSES = 5;

const FULL_TERM_DAYS = 280;
// 胚胎／中期／后期外形与羊膜囊可见，跟孕期曆的孕中期（14 周）、孕晚期（28 周）起点对齐
const MID_TRIMESTER_DAYS = PREGNANCY_STAGE_DAYS.孕早期;
const LATE_TRIMESTER_DAYS = PREGNANCY_STAGE_DAYS.孕早期 + PREGNANCY_STAGE_DAYS.孕中期;
const SAC_VISIBLE_DAYS = MID_TRIMESTER_DAYS;
const EMPTY_STAGES = Object.freeze(['月经期', '卵泡期', '排卵期', '黄体期', '产后恢复', '假孕期']);
const GESTATION_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '回归期', ...LABOR_STAGES]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** 子宫外形在某一行的半宽；下半部收窄成梨形。pad 往外扩、shift 整体下移 */
export function wombRadius(womb, y, pad = 0, shift = 0) {
  const ry = womb.ry + pad;
  const n = (y - womb.cy - shift) / ry;
  if (Math.abs(n) >= 1) return 0;
  return Math.max(0, Math.round((womb.rx + pad) * Math.sqrt(1 - n * n) * (n > 0 ? 1 - 0.43 * n : 1)));
}

/** 产后刚生完的子宫约等于孕 20 周的大小 */
const POSTPARTUM_START_SIZE_DAYS = 140;
/** 精液灌满时子宫微胀的像素 */
const SEMEN_SWELL_PX = 1;

const SEMEN_CAPACITY_FLOOR = 25;
const COMPANION_EGG_SIZE = 0.15;

/**
 * 当下能装多少精液，以未孕、内膜一般（排卵期）为 100；受孕加成在总量 80 封顶，满了之后只剩画面。
 * - 未孕：内膜越厚越小，约 75～125。
 * - 假孕：荷尔蒙让内膜偏厚，85 → 75。
 * - 产后恢复：子宫虽大但满是恶露，可用空间只略多，120 → 100。
 * - 怀孕（浸满）：子宫容积 ×（1 − 佔满率）。子宫随孕程与胎重、胎数撑大；
 *   胎儿与羊膜囊佔去的比例随孕周上升，足月单胎约八成，多胎再多佔一些。足月单胎 1.0 刚好 100。
 * 宫压越高越小，最多七折。
 */
export function getSemenCapacity({ gestating, emptyStage, emptyLining, emptyProgress, days, fetuses, pressureLevel }) {
  const pressureFactor = 1 - 0.1 * clamp(finite(pressureLevel), 0, 3);
  let capacity;
  if (gestating && fetuses.length > 0) {
    const n = fetuses.length;
    const t = clamp(days / FULL_TERM_DAYS, 0, 1.25);
    const averageSize = fetuses.reduce((sum, fetus) => (
      sum + clamp(finite(fetus?.weight, 1), 0.33, 3) + Math.max(0, Math.floor(finite(fetus?.companionEggCount))) * COMPANION_EGG_SIZE
    ), 0) / n;
    const stretch = Math.min(1.6, t * averageSize) ** 1.7 * (1 + 0.45 * (n - 1));
    const volume = 100 * (1 + 4 * stretch);
    const occupied = Math.min(0.95, 0.8 * Math.min(1, t) ** 1.5 + 0.05 * (n - 1) * t);
    capacity = volume * (1 - occupied);
  } else if (emptyStage === '假孕期') {
    capacity = 85 - 10 * clamp(emptyProgress, 0, 1);
  } else if (emptyStage === '产后恢复') {
    capacity = 120 - 20 * clamp(emptyProgress, 0, 1);
  } else {
    capacity = 100 - (finite(emptyLining, 7) - 7) * 12.5;
  }
  return Math.max(SEMEN_CAPACITY_FLOOR, Math.round(capacity * pressureFactor));
}

/** 孕程长大曲线：孕早期几乎不变，之后加速 */
function getGrowth(days) {
  return clamp(days / FULL_TERM_DAYS, 0, 1) ** 1.7;
}

/** 孕晚期子宫颈缩短（9 → 4 像素） */
function getCervicalLength(days) {
  const t = clamp((days - 168) / 112, 0, 1);
  return 9 - Math.round(5 * t * t * (3 - 2 * t));
}

/** 宫压分四级：平稳、上升、紧绷、颤动 */
function getPressureLevel(ratio) {
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.4) return 1;
  return 0;
}

/** 未孕时的内膜厚度随阶段与阶段内进度变化 */
function getEmptyLining(stage, progress) {
  const p = clamp(progress, 0, 1);
  const table = {
    月经期: Math.round(7 - 2 * p),
    卵泡期: 5 + Math.round(2 * p),
    排卵期: 7,
    黄体期: 7 + Math.round(p),
    产后恢复: 6 + Math.round(1 - p),
    假孕期: 6 + Math.round(2 * p),
  };
  return table[stage] ?? 6;
}

/**
 * 胎儿图块规格：胚型、孕期，以及胎背方位决定的镜像与朝向。
 * 胎背朝右的左右翻转；胎背朝后（枕后位）时脸朝外，画出眼睛与嘴，朝前时看到背脊
 */
export function getFetusSpriteSpec(fetus, ownAge) {
  const backSide = String(fetus?.backSide || '');
  return {
    type: String(fetus?.embryoType || '胎生'),
    stage: getSpriteStage(ownAge),
    mirror: backSide.startsWith('右'),
    posterior: backSide.endsWith('后'),
  };
}

/** 胎儿图块阶段：以自身孕龄分孕早、孕中、孕晚 */
export function getSpriteStage(ownAge) {
  if (ownAge < MID_TRIMESTER_DAYS) return 0;
  if (ownAge < LATE_TRIMESTER_DAYS) return 1;
  return 2;
}

/** 胎位角量化成 8 个方向（每 45°），像素图块旋转才干净。0° 为头位 */
export function quantizeAngle(angle) {
  const normalized = ((finite(angle) % 360) + 360) % 360;
  return (Math.round(normalized / 45) * 45) % 360;
}

function getSharedSacKey(fetus) {
  const group = Number(fetus?.identicalGroup);
  return Number.isInteger(group) && group > 0 ? `g${group}` : `e${fetus?.embryoId}`;
}

/**
 * @param profile 角色状态（只读）
 * @param options.libidoCap、options.pressureCap 由呼叫端依阶段算好的上限
 * @param options.stageProgress 未孕阶段的进度 0～1（月经期出血量、内膜厚度用）
 */
export function computeUterusLayout(profile, options = {}) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const stage = String(base.stage || '').trim();
  const allFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const effectiveDays = Math.max(0, finite(pregnant.effectivePregnantDays));
  const gestating = GESTATION_STAGES.includes(stage);
  const days = gestating ? effectiveDays : 0;

  // 看得见、已着床的胎儿；被包在宿主体内的内胎另外挂在宿主身上。
  // 一般受孕在着床前没有 pendingImplantation 标记，靠「还在月经周期阶段」判断，所以只在妊娠阶段取胎儿
  const visible = gestating
    ? allFetuses.filter((fetus) => fetus && !fetus.pendingImplantation && isFetusKnownToCharacter(fetus))
    : [];
  const isEnclosed = (fetus) => Boolean(fetus.nestedInEmbryoId) && !fetus.nestedReleased
    && visible.some((host) => host.embryoId === fetus.nestedInEmbryoId);
  const occupants = visible.filter((fetus) => !isEnclosed(fetus));

  // 最多画 5 胎：先露胎优先，其余照左右顺序补满，画的时候维持原本的左右顺序
  const showsPresenting = stage === '产兆前驱' || LABOR_STAGES.includes(stage);
  const presentingId = showsPresenting ? pregnant.presentingEmbryoId : null;
  const presenting = occupants.find((fetus) => fetus.embryoId === presentingId) || null;
  const chosen = new Set(presenting ? [presenting] : []);
  for (const fetus of occupants) {
    if (chosen.size >= MAX_DRAWN_FETUSES) break;
    chosen.add(fetus);
  }
  const drawn = occupants.filter((fetus) => chosen.has(fetus));

  const pressureCap = Math.max(1, finite(options.pressureCap, 50));
  const pressureRatio = clamp(finite(base.uterinePressure) / pressureCap, 0, 1);
  const pressureLevel = getPressureLevel(pressureRatio);
  const emptyStage = drawn.length === 0 && EMPTY_STAGES.includes(stage) ? stage : null;
  const emptyProgress = clamp(finite(options.stageProgress), 0, 1);
  const wallInset = emptyStage
    ? Math.min(9, getEmptyLining(emptyStage, emptyProgress) + pressureLevel)
    : 7 + pressureLevel;

  // 产后子宫刚生完约孕 20 周大，随恢复进度缩回原大（子宫复旧）；假孕的子宫本身不会变大，只是内膜较厚
  const sizeDays = emptyStage === '产后恢复' ? POSTPARTUM_START_SIZE_DAYS * (1 - emptyProgress) ** 1.5 : days;
  const growth = getGrowth(sizeDays);
  const extra = Math.max(0, drawn.length - 1) * 1.1;
  const womb = {
    cx: 48,
    cy: Math.round(53 + growth * 2),
    rx: Math.round(11 + growth * 26 + extra),
    ry: Math.round(12 + growth * 32 + extra * 0.7),
  };

  // 精液：液面按「目前量 ÷ 容量」画，到容量时刚好到宫腔顶。
  // 未孕到容量是「灌满」：子宫微胀 1 像素、宫口滴漏；怀孕到容量是「浸满」：精液填在羊膜囊之间，
  // 膜线沾上精液色，子宫不再胀（已撑大，绷紧的是胎儿），宫颈有黏液栓所以滴得更慢更少。只是画面，精液量不减
  const totalSperm = (Array.isArray(base.sperms) ? base.sperms : []).reduce((sum, item) => sum + Math.max(0, finite(item?.value)), 0);
  const bodyFetuses = gestating
    ? allFetuses.filter((fetus) => fetus && !fetus.pendingImplantation && !(fetus.nestedInEmbryoId && !fetus.nestedReleased))
    : [];
  const semenCapacity = getSemenCapacity({
    gestating,
    emptyStage,
    emptyLining: emptyStage ? getEmptyLining(emptyStage, emptyProgress) : 7,
    emptyProgress,
    days,
    fetuses: bodyFetuses,
    pressureLevel,
  });
  const semenFull = totalSperm > 0 && totalSperm >= semenCapacity;
  const semenSoaked = semenFull && bodyFetuses.length > 0;
  const semenOverflow = semenFull ? clamp((totalSperm - semenCapacity) / semenCapacity, 0, 1) : 0;
  if (semenFull && !semenSoaked) {
    womb.rx += SEMEN_SWELL_PX;
    womb.ry += SEMEN_SWELL_PX;
  }
  womb.top = womb.cy - womb.ry;
  womb.bottom = womb.cy + womb.ry;

  const neckLength = getCervicalLength(days);
  const canalTop = womb.bottom + Math.max(0, neckLength - 5);
  const tract = { neckTop: womb.bottom - 1, neckLength, canalTop, canalBottom: canalTop + 22 };

  const libidoCap = Math.max(1, finite(options.libidoCap, 100));
  const libidoHeat = clamp((finite(base.libido) / libidoCap - 0.27) / 0.73, 0, 1);

  const innerRy = womb.ry - wallInset;
  const cavityHeight = Math.max(1, innerRy * 2);
  const fluidHeight = totalSperm <= 0
    ? 0
    : Math.max(1, Math.round(cavityHeight * Math.min(1, totalSperm / semenCapacity) ** 0.7));

  const obstruction = gestating ? getLaborObstruction(profile) : null;
  const blocked = new Set(obstruction?.embryoIds || []);

  const n = drawn.length;
  const squeeze = n < 3 ? 1 : n === 3 ? 0.82 : n === 4 ? 0.7 : 0.61;
  const room = womb.rx - 8;
  const gap = n <= 1 ? 0 : Math.min(18, (room * 1.65) / (n - 1));
  const freeY = womb.cy + 4;
  const topStep = Math.max(5, Math.round(innerRy * 0.6));
  const items = drawn.map((fetus, i) => {
    const ownAge = Math.max(0, effectiveDays - Math.max(0, finite(fetus.conceivedAtDays)));
    const t = clamp(ownAge / FULL_TERM_DAYS, 0, 1);
    const weight = clamp(finite(fetus.weight, 1), 0.33, 3);
    const size = Math.max(2, Math.round((1.5 + 20.5 * t ** 1.55) * Math.sqrt(weight)));
    const descent = clamp(Math.round(finite(fetus.descentStage, -2)), -3, 3);
    const stagger = n === 1 ? 0 : n >= 3 ? (i % 2 ? 7 : -7) : i % 2 ? 3 : -3;
    const y = descent === -3 ? freeY - topStep + stagger
      : descent === -2 ? freeY + stagger
        : descent === -1 ? freeY + Math.max(2, Math.round(innerRy * 0.25)) + stagger
          : descent === 0 ? freeY + Math.max(3, Math.round(innerRy * 0.55))
            : womb.bottom - 6 + descent * 8;
    return {
      embryoId: fetus.embryoId,
      index: visible.indexOf(fetus),
      x: womb.cx + (n === 1 ? 0 : (i - (n - 1) / 2) * gap),
      y,
      size,
      squeeze,
      descent,
      ownAge,
      angle: quantizeAngle(fetus.tendencyAngle),
      sprite: getFetusSpriteSpec(fetus, ownAge),
      sacKey: getSharedSacKey(fetus),
      amnion: clamp(finite(fetus.amnionDurability, 100), -100, 100),
      presenting: fetus === presenting,
      obstruction: blocked.has(fetus.embryoId) ? obstruction.type : null,
      gender: String(fetus.gender || ''),
      affinity: clamp(finite(fetus.affinity), -50, 50),
      inner: [],
    };
  });

  // 有轮数上限的推挤：同一胎囊的成员可以挤在一起；产道内（≥1）的固定在中轴
  for (let pass = 0; pass < 12; pass += 1) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (a.sacKey === b.sacKey || a.descent >= 1 || b.descent >= 1) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const limit = (a.size + b.size) * squeeze * 0.52 + 3;
        if (Math.abs(dx) < limit && Math.abs(dy) < (a.size + b.size) * 0.55) {
          const push = Math.min(0.7, (limit - Math.abs(dx)) * 0.13);
          a.x -= push;
          b.x += push;
          a.y -= 0.16;
          b.y += 0.16;
        }
      }
    }
    for (const item of items) {
      if (item.descent >= 0) {
        item.x = womb.cx;
        continue;
      }
      item.y = clamp(item.y, womb.top + wallInset - 2 + item.size * 0.6, womb.bottom - wallInset - item.size * 0.6);
      const edge = wombRadius(womb, item.y);
      const maxX = Math.max(0, edge - wallInset + 1 - item.size * item.squeeze * 0.54);
      item.x = clamp(item.x, womb.cx - maxX, womb.cx + maxX);
    }
  }
  for (const item of items) {
    item.x = Math.round(item.x);
    item.y = Math.round(item.y);
  }

  // 孕中孕：内胎画在宿主图块里面，不占母体格位
  for (const fetus of visible.filter(isEnclosed)) {
    const host = items.find((item) => item.embryoId === fetus.nestedInEmbryoId);
    if (!host) continue;
    const ownAge = Math.max(0, effectiveDays - Math.max(0, finite(fetus.conceivedAtDays)));
    host.inner.push({
      embryoId: fetus.embryoId,
      index: visible.indexOf(fetus),
      size: Math.max(2, Math.round(host.size * 0.45)),
      sprite: getFetusSpriteSpec(fetus, ownAge),
      angle: quantizeAngle(fetus.tendencyAngle),
    });
  }

  // 胎囊：同卵共用一个，外框包住全部成员；孕龄够大才画
  const sacScale = 0.7 + 0.3 * Math.min(days / LATE_TRIMESTER_DAYS, 1);
  const sacs = [];
  for (const key of [...new Set(items.map((item) => item.sacKey))]) {
    const members = items.filter((item) => item.sacKey === key);
    if (Math.max(...members.map((item) => item.ownAge)) < SAC_VISIBLE_DAYS) continue;
    const xs = members.map((item) => item.x);
    const ys = members.map((item) => item.y);
    const halfW = Math.max(...members.map((item) => item.size * item.squeeze * sacScale + 2));
    const halfH = Math.max(...members.map((item) => item.size * sacScale + 2));
    sacs.push({
      key,
      embryoIds: members.map((item) => item.embryoId),
      cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      rx: Math.round((Math.max(...xs) - Math.min(...xs)) / 2 + halfW),
      ry: Math.round((Math.max(...ys) - Math.min(...ys)) / 2 + halfH),
      durability: Math.min(...members.map((item) => item.amnion)),
    });
  }

  const summary = drawn.length === 0
    ? `${stage || '未设定'}，子宫内没有胎儿`
    : `${stage}，${visible.length} 胎：${visible.map((fetus, i) => `第${i + 1}胎${describeFetalPosition(pregnant, fetus)}`).join('，')}`;

  return {
    canvas: UTERUS_CANVAS,
    stage,
    gestating,
    days,
    growth,
    womb,
    tract,
    wallInset,
    pressureRatio,
    pressureLevel,
    emptyStage,
    emptyProgress,
    libidoHeat,
    fluidHeight,
    semenCapacity,
    semenFull,
    semenSoaked,
    semenOverflow,
    lateBulge: days >= LATE_TRIMESTER_DAYS,
    // 延产期在宫颈画封口；子宫乏力在宫壁画妊娠纹似的细纹（都不改宫壁颜色，免得跟宫压变色混在一起）
    extensionSeal: stage === '延产期',
    atony: clamp(Math.floor(finite(base.uterineAtony)), 0, 9),
    fetuses: items,
    sacs,
    hiddenCount: Math.max(0, occupants.length - drawn.length),
    obstruction: obstruction ? { type: obstruction.type, embryoIds: [...blocked], message: String(obstruction.message || '') } : null,
    pressureRisk: getPregnancyPressureRisk(profile),
    summary,
  };
}
