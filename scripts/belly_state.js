// 孕体特写：追踪器的状态 → 特写动画（belly_anim.js）吃的状态。
// 纯计算：数值都由呼叫端（index.js 的追踪页 view model）用既有的函式算好传进来，这里只做换算与对应，不重算身体量。

import { DUE_DATE_DAYS, LABOR_STAGES, PREGNANCY_STAGES } from './stage_config.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const percent = (item) => {
  const cap = Number(item?.cap) || 0;
  return cap > 0 ? clamp((Number(item?.value) || 0) / cap * 100, 0, 100) : 0;
};

/** 产程阶段（base.stage＋pregnant.laborPhase）→ 特写的宫缩节奏 */
const FIRST_STAGE_PHASES = { 潜伏期: 'latent', 活跃期: 'active', 过渡期: 'transition' };
const SECOND_STAGE_PHASES = { 胎体下降: 'descent', 胎体娩出: 'delivery', 间歇期: 'interval' };
/**
 * 放松胸型（ACG 取向）：N 杯下垂 9 格、外摊 3 格、上极补满 3 格、往前凸的长度收短 15%，软但圆、乳头朝前；
 * 其余罩杯照 (罩杯/150)^1.3 缩小
 */
export const BELLY_RELEASE = Object.freeze({ sag: 9, spread: 3, fill: 3, retract: 0.15, contact: true });

export function getBellyLaborPhase(stage, laborPhase) {
  if (stage === '产兆前驱') return 'prodromal';
  if (stage === '第一产程') return FIRST_STAGE_PHASES[laborPhase] || 'latent';
  if (stage === '第二产程') return SECOND_STAGE_PHASES[laborPhase] || 'descent';
  if (stage === '第三产程') return 'placenta';
  return 'none';
}

/** 荷尔蒙阶段：妊娠（含产程）、假孕、产后恢复、一般周期。决定乳晕深浅与会不会泌乳 */
export function getBellyHormoneStage(stage) {
  if (stage === '假孕期') return 'pseudo';
  if (stage === '产后恢复') return 'postpartum';
  if (PREGNANCY_STAGES.includes(stage) || stage === '产兆前驱' || LABOR_STAGES.includes(stage)) return 'pregnant';
  return 'cycle';
}

/**
 * 当下是不是全裸：衣柜开着，而且身上没有主衣物，或穿着状态写明全裸。
 * 衣柜没开、或只脱了一部分，一律照有穿画（无肩带胸衣＋短裤）。
 */
export function isBellyNude(outfit) {
  if (!outfit || outfit.enabled !== true) return false;
  if (/全裸|赤裸|一丝不挂|一絲不掛|裸体|裸體/.test(String(outfit.wearState || ''))) return true;
  // 主衣物是衣柜保留的 id 0「全裸」（bsChangeOutfit mainItemId=0）就是明确全裸
  return !outfit.main || Number(outfit.main.id) === 0;
}

/**
 * @param input {
 *   drawable: 有没有人形的身材可画（非人形、没有身材资料时为 false）,
 *   sigma, body: { build, bust, hip }（当下，含孕期增量）, baseline: { build, bust, hip }（孕前）, bellySize（孕肚大小 0–15）,
 *   stage, laborPhase, laborEffort, pushFatigue, stageProgress（0–1）, effectiveDays, births,
 *   stats: { vitality, libido, stress, uterine }（各 { value, cap }）,
 *   needs: { hunger, sleep, excretion, milk, odor }（各 { value, cap }；免除或代谢免疫的给 null）,
 *   outfit（buildOutfitView 的结果）,
 *   fetuses: [{ embryoId, ownAge, growth（生长型份量，足月 1）, weight, bulkRatio, healthRatio（0–1）, canMove, nestedInEmbryoId, nestedReleased }]（角色已知、已着床的）,
 *   womb: computeUterusLayout 的结果（取每胎在子宫里的位置）,
 * }
 * @returns 特写的状态；不能画时回传 null
 */
export function buildBellyCloseupState(input) {
  if (!input || input.drawable === false) return null;
  const stage = String(input.stage || '');
  const nude = isBellyNude(input.outfit);
  const needs = input.needs || {};
  const stats = input.stats || {};
  const womb = input.womb || null;
  const placed = new Map((womb?.fetuses || []).map((fetus) => [fetus.embryoId, fetus]));
  const list = input.fetuses || [];
  // 孕中孕：内胎还包在宿主体内（宿主也在这份名单里、胎囊没破）时记下宿主的顺位
  const hostOf = (fetus) => {
    const hostId = fetus?.nestedInEmbryoId;
    if (hostId === undefined || hostId === null || fetus.nestedReleased) return -1;
    return list.findIndex((other) => other !== fetus && other.embryoId === hostId);
  };
  // 子宫图是正面、特写是侧面：上下照子宫里的高低，左右换成前后（只是让不同的胎落在不同的地方）
  const zoneOfSpot = (spot) => ({
    v: clamp((spot.y - womb.womb.top) / Math.max(1, womb.womb.bottom - womb.womb.top), 0.05, 0.95),
    w: clamp(0.5 + (spot.x - womb.womb.cx) / Math.max(1, 2 * womb.womb.rx), 0.1, 0.9),
  });
  const front = womb?.womb ? (womb.fetuses || []).filter((spot) => list.some((fetus) => fetus.embryoId === spot.embryoId)).map(zoneOfSpot) : [];
  let behindCount = 0;
  const fetuses = list.map((fetus) => {
    const spot = placed.get(fetus.embryoId);
    const host = hostOf(fetus);
    let zone;
    let behind = false;
    if (spot && womb?.womb) zone = zoneOfSpot(spot);
    else if (host < 0 && front.length > 0) {
      // 子宫图只画得下 5 胎：第 6 胎起排在前面 5 胎的背后（第 k 个照 k mod 5 那一胎的高低，再往背侧退一段；偏移由 embryoId 固定，重绘不跳）
      const ahead = front[behindCount % front.length];
      behindCount += 1;
      const seed = Number(fetus.embryoId) || behindCount;
      const jitter = (k) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
      zone = { v: clamp(ahead.v + (jitter(1) - 0.5) * 0.16, 0.05, 0.95), w: clamp(ahead.w + 0.25 + 0.1 * jitter(2), 0.1, 0.95) };
      behind = true;
    }
    return {
      embryoId: fetus.embryoId,
      // 胎量：生长型份量 × 胎重 × 份量倍率（没给 growth 的旧呼叫照孕龄直线）；胎动什么时候开始、多用力都看它
      size: (Number.isFinite(Number(fetus.growth)) ? Math.max(0, Number(fetus.growth)) : Math.max(0, Number(fetus.ownAge) || 0) / DUE_DATE_DAYS)
        * (Number(fetus.weight) || 1) * (Number(fetus.bulkRatio) || 1),
      weight: Number(fetus.weight) || 1,
      // 健康比例 0–1（0.5 是平常）→ 0–100
      health: clamp((Number.isFinite(Number(fetus.healthRatio)) ? Number(fetus.healthRatio) : 0.5) * 100, 0, 100),
      canMove: fetus.canMove !== false,
      // 今天的动静 0–3（没给的旧呼叫是「一般」）
      vigor: Number.isFinite(Number(fetus.vigor)) ? clamp(Math.round(Number(fetus.vigor)), 0, 3) : 1,
      ...(zone ? { zone } : {}),
      ...(behind ? { behind } : {}),
      // 内胎：动静算在宿主身上，自己没有位置
      ...(host >= 0 ? { host } : {}),
    };
  });
  const body = input.body || {};
  // 孕前虚影：妊娠到产后恢复期间，用孕前的身材（getBodyBaseline）再画一圈外轮廓对照
  const baseline = input.baseline || null;
  const hormStage = getBellyHormoneStage(stage);
  const ghost = baseline && (hormStage === 'pregnant' || hormStage === 'postpartum')
    ? { cup: clamp(Number(baseline.bust) || 0, 0, 150), build: clamp(Number(baseline.build) || 0, 0, 100), hip: clamp(Number(baseline.hip) || 0, 0, 100) }
    : null;
  return {
    sigma: clamp(Number(input.sigma) || 0, -3, 3),
    cup: clamp(Number(body.bust) || 0, 0, 150),
    build: clamp(Number(body.build) || 0, 0, 100),
    hip: clamp(Number(body.hip) || 0, 0, 100),
    // 孕肚大小直接给（belly_layout 的 pressure），不用孕日与胎数换算
    pressure: clamp(Number(input.bellySize) || 0, 0, 15),
    days: Math.max(0, Number(input.effectiveDays) || 0),
    count: Math.max(1, fetuses.length),
    weight: 1,
    hormStage,
    ...(ghost ? { ghost } : {}),
    stageProgress: clamp((Number(input.stageProgress) || 0) * 100, 0, 100),
    births: Math.max(0, Math.floor(Number(input.births) || 0)),
    laborPhase: getBellyLaborPhase(stage, input.laborPhase),
    laborEffort: input.laborEffort === 'push' ? 'push' : 'rest',
    pushFatigue: clamp(Number(input.pushFatigue) || 0, 0, 100),
    showBra: !nude,
    showShorts: !nude,
    strapless: !nude,
    // 全裸时没有胸罩承托：胸部照罩杯下垂、往两侧摊，碰到孕肚就停在肚子上（belly_layout.js 放松胸型）
    ...(nude ? { release: { ...BELLY_RELEASE } } : {}),
    // 外观（完整变量页「外观」子页）：乳晕与乳头一起缩放、肚脐、妊娠纹
    nippleScale: Number(input.display?.nippleSize) || 1,
    navel: input.display?.navel || 'pop',
    navelLarge: input.display?.navelSize === 'large',
    stretchMarks: input.display?.stretchMarks || 'off',
    pastBulk: Math.max(0, Number(input.pastBulk) || 0),
    vitality: percent(stats.vitality),
    libido: percent(stats.libido),
    stress: percent(stats.stress),
    uterine: percent(stats.uterine),
    hunger: percent(needs.hunger),
    sleep: percent(needs.sleep),
    excretion: percent(needs.excretion),
    // 尿池（1.5.4）：湿痕只看它；旧呼叫没给就照泄意
    urine: needs.urine ? percent(needs.urine) : percent(needs.excretion),
    odor: percent(needs.odor),
    milk: percent(needs.milk),
    // 免除乳意的类型（不死等）与代谢免疫：不变色、不涨、不漏
    noMilk: !needs.milk,
    fetuses,
  };
}

/** 画面事件（profile.visualCue 的 type）→ 特写要演的动作；没有对应的回传 null */
/**
 * 抽送顶不顶得到宫颈口（与子宫图同一条规则）：相称、或剑大到「明显不合」为止顶得到；
 * 极不相称以上（只进一半、进不去）与鞘比剑大时够不到。没有契合资料时照相称。
 */
export function getBellyThrustReach(fit) {
  if (!fit || !Number.isFinite(fit.tier) || fit.tier === 0) return true;
  return fit.direction > 0 && fit.tier <= 2;
}

/**
 * 两胎互动的事件记了是哪两胎（cue.fetuses：[动手的, 被动的] 的 embryoId）时，换成特写胎儿列表里的顺位。
 * 两胎都找得到而且都还会动才回传；否则回传 null，由呼叫端自己挑。
 */
export function resolveBellyCuePair(cue, fetuses) {
  if (!Array.isArray(cue?.fetuses) || cue.fetuses.length !== 2 || !Array.isArray(fetuses)) return null;
  const [actor, target] = cue.fetuses.map((id) => fetuses.findIndex((fetus) => fetus.embryoId === id && fetus.canMove !== false));
  return actor >= 0 && target >= 0 && actor !== target ? { actor, target } : null;
}

export function getBellyCueAction(type) {
  if (type === 'falseContraction') return { trigger: 'falseContraction' };
  if (type === 'insert' || type === 'insertCondom') return { trigger: 'thrust', options: { count: 3 } };
  if (type === 'ejaculate' || type === 'ejaculateCondom' || type === 'condomBreak' || type === 'condomOverflow') return { trigger: 'thrust', options: { count: 1 } };
  if (type === 'orgasm') return { trigger: 'orgasm' };
  // 两胎互动：事件记了是哪两胎就照着演（见 resolveBellyCuePair），没记时由呼叫端挑两胎
  if (type === 'siblingKick') return { trigger: 'sibling', options: { interaction: 'kick' }, pair: true };
  if (type === 'siblingShove') return { trigger: 'sibling', options: { interaction: 'shove' }, pair: true };
  if (type === 'siblingCuddle') return { trigger: 'sibling', options: { interaction: 'cuddle' }, pair: true };
  return null;
}
