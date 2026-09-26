// 子宫像素图的版面：只读角色状态，算出 96×120 画布上要画什么、画在哪。
// 纯函式，不碰 DOM、不写回状态；状态改变时算一次，绘制层每帧只照着画。
// 几何沿用 Sol 6 试作：子宫在画框中央随孕程从小长到大，胎儿按左右顺序排格、
// 按下降位置分高度，再做有轮数上限的推挤。
import { LABOR_STAGES } from './stage_config.js';
import { describeFetalPosition, getLaborObstruction, isFetusKnownToCharacter } from './tools.js';

export const UTERUS_CANVAS = Object.freeze({ width: 96, height: 120 });
export const MAX_DRAWN_FETUSES = 5;

const FULL_TERM_DAYS = 280;
const SAC_VISIBLE_DAYS = 84;
const EMPTY_STAGES = Object.freeze(['月经期', '卵泡期', '排卵期', '黄体期', '产后恢复', '假孕期']);
const GESTATION_STAGES = Object.freeze(['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '回归期', ...LABOR_STAGES]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** 子宫外形在某一行的半宽；下半部收窄成梨形。pad 往外扩、shift 整体下移 */
export function wombRadius(womb, y, pad = 0, shift = 0) {
  const ry = womb.ry + pad;
  const n = (y - womb.cy - shift) / ry;
  if (Math.abs(n) >= 1) return 0;
  return Math.max(0, Math.round((womb.rx + pad) * Math.sqrt(1 - n * n) * (n > 0 ? 1 - 0.43 * n : 1)));
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

/** 点子宫图时找被点到的胎儿：取离点击处最近、且落在图块范围内的那一胎；没点到回传 null */
export function findFetusAt(layout, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const fetus of layout?.fetuses || []) {
    const halfW = Math.max(3, fetus.size * fetus.squeeze * 0.8);
    const halfH = Math.max(3, fetus.size * 0.8);
    const dx = (x - fetus.x) / halfW;
    const dy = (y - fetus.y) / halfH;
    const distance = dx * dx + dy * dy;
    if (distance <= 1 && distance < bestDistance) {
      best = fetus;
      bestDistance = distance;
    }
  }
  return best;
}

/** 胎儿图块阶段：以自身孕龄分孕早、孕中、孕晚 */
export function getSpriteStage(ownAge) {
  if (ownAge < 84) return 0;
  if (ownAge < 189) return 1;
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

  const growth = getGrowth(days);
  const extra = Math.max(0, drawn.length - 1) * 1.1;
  const womb = {
    cx: 48,
    cy: Math.round(53 + growth * 2),
    rx: Math.round(11 + growth * 26 + extra),
    ry: Math.round(12 + growth * 32 + extra * 0.7),
  };
  womb.top = womb.cy - womb.ry;
  womb.bottom = womb.cy + womb.ry;

  const neckLength = getCervicalLength(days);
  const canalTop = womb.bottom + Math.max(0, neckLength - 5);
  const tract = { neckTop: womb.bottom - 1, neckLength, canalTop, canalBottom: canalTop + 22 };

  const pressureCap = Math.max(1, finite(options.pressureCap, 50));
  const pressureRatio = clamp(finite(base.uterinePressure) / pressureCap, 0, 1);
  const pressureLevel = getPressureLevel(pressureRatio);
  const emptyStage = drawn.length === 0 && EMPTY_STAGES.includes(stage) ? stage : null;
  const emptyProgress = clamp(finite(options.stageProgress), 0, 1);
  const wallInset = emptyStage
    ? Math.min(9, getEmptyLining(emptyStage, emptyProgress) + pressureLevel)
    : 7 + pressureLevel;

  const libidoCap = Math.max(1, finite(options.libidoCap, 100));
  const libidoHeat = clamp((finite(base.libido) / libidoCap - 0.27) / 0.73, 0, 1);

  // 精液：100 单位填满空子宫的底部；子宫越大摊得越薄，怀孕时几乎看不到是预期行为
  const totalSperm = (Array.isArray(base.sperms) ? base.sperms : []).reduce((sum, item) => sum + Math.max(0, finite(item?.value)), 0);
  const innerRy = womb.ry - wallInset;
  const fluidHeight = totalSperm > 0
    ? Math.min(innerRy * 2, Math.max(1, Math.round(10 * (totalSperm / 100) ** 0.7 * (11 / womb.rx) ** 0.7)))
    : 0;

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
      sprite: { type: String(fetus.embryoType || '胎生'), stage: getSpriteStage(ownAge) },
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
      sprite: { type: String(fetus.embryoType || '胎生'), stage: getSpriteStage(ownAge) },
      angle: quantizeAngle(fetus.tendencyAngle),
    });
  }

  // 胎囊：同卵共用一个，外框包住全部成员；孕龄够大才画
  const sacScale = 0.7 + 0.3 * Math.min(days / 189, 1);
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
    lateBulge: days >= 189,
    fetuses: items,
    sacs,
    hiddenCount: Math.max(0, occupants.length - drawn.length),
    obstruction: obstruction ? { type: obstruction.type, embryoIds: [...blocked], message: String(obstruction.message || '') } : null,
    summary,
  };
}
