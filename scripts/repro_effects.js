// 生殖干预（1.5.3）：所有「人为介入生殖」的效果——吃药、法术、外力，或照正文对齐阶段。
// 效果存在角色身上（base.reproEffects），到期自动消失；药物名录（settings.drugCatalog，可绑卡）定义一种药带哪些效果。
// 纯资料与数值，不碰状态；套用写在 tools.js 的 applyReproductiveIntervention。

/**
 * 效果：key → 名称、是否立即生效（不留在身上）、预设持续天数、写实世界能不能用、
 * catalogOnly＝名录里有药带它才开放（模型不能凭空给）
 */
export const REPRO_EFFECTS = Object.freeze({
  phase: Object.freeze({ label: '切换阶段', instant: true, realistic: true }),
  emergency: Object.freeze({ label: '事后避孕', instant: true, realistic: true }),
  pill: Object.freeze({ label: '避孕药', days: 30, realistic: true }),
  regulate: Object.freeze({ label: '调经', days: 30, realistic: true }),
  ovulation: Object.freeze({ label: '促排卵', days: 3, realistic: true }),
  fertility: Object.freeze({ label: '助孕', days: 7, realistic: false, catalogOnly: true }),
  twinning: Object.freeze({ label: '促分裂', days: 7, realistic: false, catalogOnly: true }),
  chimera: Object.freeze({ label: '促嵌合', days: 3, realistic: false, catalogOnly: true }),
  amnion: Object.freeze({ label: '固膜', days: 14, realistic: false, catalogOnly: true }),
  // 解药（1.5.4）：一次清掉身上所有生效中的药（解毒奶、净化术）；强度不影响
  cleanse: Object.freeze({ label: '解药', instant: true, realistic: false, catalogOnly: true }),
  // 催情（1.5.4）：卵方对刺激的反应变大（性欲的增减与契合）；精方存量补满、禁欲重算（回精）。持续时间通常一个晚上
  aphrodisiac: Object.freeze({ label: '催情', days: 0.25, realistic: true, catalogOnly: true }),
  abortifacient: Object.freeze({ label: '堕胎', instant: true, realistic: true, catalogOnly: true }),
  induce: Object.freeze({ label: '催产', instant: true, realistic: true, catalogOnly: true }),
});

/**
 * 固膜：孕期中羊膜每天修复多少、宫压与排斥的磨损剩几成（产程中无效，破水节奏不变）。
 * 之后养分器官层上线时，同一个效果也接那一层的修复。
 */
export const AMNION_REGEN_PER_DAY = Object.freeze({ light: 3, normal: 5, strong: 8 });
export const AMNION_WEAR_FACTOR = Object.freeze({ light: 0.7, normal: 0.5, strong: 0.3 });

/** 固膜生效中：回传 { regenPerDay, wearFactor }；没有回传 null */
export function amnionProtection(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'amnion', nowMinutes);
  if (!active) return null;
  return { regenPerDay: AMNION_REGEN_PER_DAY[active.strength] ?? AMNION_REGEN_PER_DAY.normal, wearFactor: AMNION_WEAR_FACTOR[active.strength] ?? AMNION_WEAR_FACTOR.normal };
}

/** 堕胎：每一胎成功的机率（再乘孕期系数）；失败的胎儿扣的健康 */
export const ABORTIFACIENT_CHANCE = Object.freeze({ light: 0.3, normal: 0.6, strong: 0.9 });
export const ABORTIFACIENT_HARM = Object.freeze({ light: 8, normal: 12, strong: 18 });
/** 催产：发动的机率（孕晚期未足月再乘离足月多远的系数） */
export const INDUCE_CHANCE = Object.freeze({ light: 0.4, normal: 0.7, strong: 0.95 });
export const REPRO_EFFECT_KEYS = Object.freeze(Object.keys(REPRO_EFFECTS));
/**
 * 药不分男女（1.5.4）：看是谁吃下去，作用在她／他身上有的那一侧。精方那侧只有这三种：
 * 避孕＝每次射精照可靠度掷，掷中那一次的精液没有活性；助孕＝当下精子品质乘同样的倍率、剑暂时变大；
 * 催情＝存量补满、禁欲重算。其余效果只有卵方那侧。扶她两侧都有，两侧都套。
 */
export const SIRE_REPRO_EFFECTS = Object.freeze(['pill', 'fertility', 'aphrodisiac']);
/**
 * 催情的卵方那侧：不直接改性欲（四值只走 bsUpdateCharacterStatus），改的是身体对刺激的反应——
 * 工具加性欲时放大、减性欲时打折（强效挡掉）；交合时的契合累积另乘一个独立的倍率（不动体型契合本身）。
 */
export const APHRODISIAC_LIBIDO_GAIN = Object.freeze({ light: 1.5, normal: 2, strong: 3 });
export const APHRODISIAC_LIBIDO_DROP = Object.freeze({ light: 0.5, normal: 0.25, strong: 0 });
export const APHRODISIAC_COMPAT = Object.freeze({ light: 1.25, normal: 1.5, strong: 2 });
/** 助孕（强精）：剑暂时变大多少（剑偏移 −2～+2，每 0.5 一级） */
export const FERTILITY_SWORD_BOOST = Object.freeze({ light: 0.5, normal: 1, strong: 1.5 });
/** 「生殖药物」开关关掉时只留原本就有的两项 */
export const BASIC_REPRO_EFFECTS = Object.freeze(['phase', 'emergency']);

export const REPRO_STRENGTHS = Object.freeze(['light', 'normal', 'strong']);
export const REPRO_STRENGTH_LABELS = Object.freeze({ light: '轻', normal: '一般', strong: '强' });
const STRENGTH_ALIASES = Object.freeze({ 轻: 'light', 弱: 'light', 一般: 'normal', 中: 'normal', 普通: 'normal', 强: 'strong', 重: 'strong' });

/** 各强度的倍率：助孕乘这一轮的卵子品质、除受孕难度；促分裂、促嵌合乘机率（再夹在世界基准的上限内） */
const STRENGTH_TABLE = Object.freeze({
  fertility: Object.freeze({ light: 1.25, normal: 1.5, strong: 2 }),
  twinning: Object.freeze({ light: 1.5, normal: 2, strong: Infinity }),
  chimera: Object.freeze({ light: 2, normal: 3, strong: Infinity }),
  // 促排卵多排几颗（强＝世界基准的上限）
  ovulation: Object.freeze({ light: 1, normal: 1, strong: Infinity }),
});

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
};

export function normalizeStrength(value) {
  const raw = String(value || '').trim();
  if (REPRO_STRENGTHS.includes(raw)) return raw;
  return STRENGTH_ALIASES[raw] || 'normal';
}

export function normalizeEffectKey(value) {
  const raw = String(value || '').trim();
  if (REPRO_EFFECT_KEYS.includes(raw)) return raw;
  const byLabel = REPRO_EFFECT_KEYS.find((key) => REPRO_EFFECTS[key].label === raw);
  return byLabel || null;
}

/** 正在生效的效果清单（存档）：拿掉认不出来、已到期的 */
export function normalizeReproEffects(list, nowMinutes = null) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || '').trim().slice(0, 40),
      effect: normalizeEffectKey(item.effect),
      strength: normalizeStrength(item.strength),
      fromMinutes: Number(item.fromMinutes) || 0,
      untilMinutes: Number(item.untilMinutes) || 0,
      // 套用当下照世界基准算好的数值：避孕药可靠度、多排几颗、促分裂／促嵌合倍率
      value: Number.isFinite(Number(item.value)) ? Number(item.value) : null,
    }))
    .filter((item) => item.effect && !REPRO_EFFECTS[item.effect].instant)
    .filter((item) => nowMinutes === null || item.untilMinutes > Number(nowMinutes));
}

/** 某种效果现在最强的那一笔；没有回传 null */
export function getActiveReproEffect(profile, effect, nowMinutes = null) {
  const list = normalizeReproEffects(profile?.base?.reproEffects, nowMinutes).filter((item) => item.effect === effect);
  if (!list.length) return null;
  const rank = { light: 0, normal: 1, strong: 2 };
  return list.sort((a, b) => rank[b.strength] - rank[a.strength])[0];
}

/** 助孕：这一轮卵子品质的倍率（没有助孕时 1） */
export function fertilityMultiplier(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'fertility', nowMinutes);
  return active ? STRENGTH_TABLE.fertility[active.strength] : 1;
}

/**
 * 套用当下照强度与世界基准算出这笔效果的数值，存进效果里（引擎读时不必再看设定）：
 * 避孕药＝可靠度、促排卵＝多排几颗、促分裂与促嵌合＝机率倍率。其余回传 null。
 */
export function resolveEffectValue(effect, strength, world = {}) {
  const level = normalizeStrength(strength);
  if (effect === 'pill') return clamp(world.pillReliability, 0, 1, 0.99);
  if (effect === 'ovulation') return Math.min(Math.max(0, Math.floor(Number(world.ovulationExtraEggsMax ?? 2))), STRENGTH_TABLE.ovulation[level]);
  if (effect === 'twinning') return Math.min(Math.max(1, Number(world.twinningMaxMultiplier ?? 3)), STRENGTH_TABLE.twinning[level]);
  if (effect === 'chimera') return Math.min(Math.max(1, Number(world.chimeraMaxMultiplier ?? 5)), STRENGTH_TABLE.chimera[level]);
  return null;
}

/** 促分裂、促嵌合：机率倍率（没有时 1） */
export function chanceMultiplier(profile, effect, nowMinutes = null) {
  const active = getActiveReproEffect(profile, effect, nowMinutes);
  return active ? Math.max(1, Number(active.value) || 1) : 1;
}

/** 促排卵：这次排卵多排几颗（没有时 0） */
export function extraOvulationEggs(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'ovulation', nowMinutes);
  return active ? Math.max(0, Math.floor(Number(active.value) || 0)) : 0;
}

/** 催情：工具给的性欲增减怎么调（增放大、减打折）；没有时原样 */
export function scaleLibidoDelta(profile, delta, nowMinutes = null) {
  const value = Number(delta) || 0;
  const active = getActiveReproEffect(profile, 'aphrodisiac', nowMinutes);
  if (!active || value === 0) return value;
  const table = value > 0 ? APHRODISIAC_LIBIDO_GAIN : APHRODISIAC_LIBIDO_DROP;
  return value * (table[active.strength] ?? table.normal);
}

/** 催情：交合时契合累积的独立倍率（没有时 1） */
export function aphrodisiacCompatMultiplier(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'aphrodisiac', nowMinutes);
  return active ? APHRODISIAC_COMPAT[active.strength] ?? APHRODISIAC_COMPAT.normal : 1;
}

/** 助孕（强精）：剑暂时加大多少（没有时 0） */
export function fertilitySwordBoost(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'fertility', nowMinutes);
  return active ? FERTILITY_SWORD_BOOST[active.strength] ?? FERTILITY_SWORD_BOOST.normal : 0;
}

/** 避孕药：这次排卵被压住的机率（没有吃时 0） */
export function pillSuppression(profile, nowMinutes = null) {
  const active = getActiveReproEffect(profile, 'pill', nowMinutes);
  return active ? clamp(active.value, 0, 1, 0.99) : 0;
}

// 目前生效的药物名录：呼叫端（index.js 依角色卡与全域设定）提供
let drugCatalogProvider = () => [];
export function setDrugCatalogProvider(fn) {
  drugCatalogProvider = typeof fn === 'function' ? fn : () => [];
}
export function getActiveDrugCatalog() {
  try { return normalizeDrugCatalog(drugCatalogProvider()); } catch { return []; }
}

/** 名录是卡片或使用者自订的（不是通用预设）：主线才送药名 */
export function hasCustomDrugCatalog() {
  try {
    const raw = drugCatalogProvider();
    return Array.isArray(raw) && raw !== DEFAULT_DRUG_CATALOG && normalizeDrugCatalog(raw).length > 0;
  } catch {
    return false;
  }
}

/** 奇幻效果（助孕、促分裂、促嵌合）：名录里有药带这个效果才能用，不让模型凭空发明 */
export function isEffectInCatalog(effect, catalog = getActiveDrugCatalog()) {
  return normalizeDrugCatalog(catalog).some((drug) => drug.effects.some((entry) => entry.effect === effect));
}

/** 概览：「月见草丹（促排卵·强，剩 2 天）」 */
export function describeReproEffects(profile, nowMinutes = 0) {
  return normalizeReproEffects(profile?.base?.reproEffects, nowMinutes).map((item) => {
    const left = Math.max(0, (item.untilMinutes - Number(nowMinutes)) / 1440);
    const leftText = left >= 1 ? `剩 ${Math.ceil(left)} 天` : `剩 ${Math.max(1, Math.ceil(left * 24))} 小时`;
    const what = `${REPRO_EFFECTS[item.effect].label}·${REPRO_STRENGTH_LABELS[item.strength]}`;
    return item.name && item.name !== REPRO_EFFECTS[item.effect].label ? `${item.name}（${what}，${leftText}）` : `${what}（${leftText}）`;
  });
}

// ---- 药物名录 ----

const DRUG_NAME_MAX = 24;
const DRUG_DESCRIPTION_MAX = 200;
const DRUG_CATALOG_MAX = 60;
const PHASE_STAGES = Object.freeze(['卵泡期', '排卵期', '黄体期', '月经期', '乏情期', '产后恢复', '假孕期']);

/**
 * 名录：[{ name, description, effects: [{ effect, strength, stage? }], days }]。
 * 名称重复留第一个；认不出来的效果丢掉，没有效果的整项丢掉。
 */
export function normalizeDrugCatalog(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim().slice(0, DRUG_NAME_MAX);
    if (!name || seen.has(name)) continue;
    const effects = (Array.isArray(item.effects) ? item.effects : [])
      .map((entry) => {
        const effect = normalizeEffectKey(entry?.effect);
        if (!effect) return null;
        const stage = effect === 'phase' ? String(entry?.stage || '').trim() : '';
        if (effect === 'phase' && !PHASE_STAGES.includes(stage)) return null;
        return { effect, strength: normalizeStrength(entry?.strength), ...(stage ? { stage } : {}) };
      })
      .filter(Boolean);
    if (!effects.length) continue;
    seen.add(name);
    result.push({
      name,
      description: String(item.description || '').trim().slice(0, DRUG_DESCRIPTION_MAX),
      effects,
      days: clamp(item.days, 0, 365, 0),
    });
    if (result.length >= DRUG_CATALOG_MAX) break;
  }
  return result;
}

export function findDrug(catalog, name) {
  const key = String(name || '').trim();
  return normalizeDrugCatalog(catalog).find((item) => item.name === key) || null;
}

/**
 * 通用预设名录：没设名录时所有世界都用（只放现实存在的效果，强度与天数固定，模型不能自己加码）。
 * 世界观里的等效草药、法术也算这几种；助孕、促分裂、促嵌合这类奇幻药要卡片或使用者在名录里定义。
 */
export const DEFAULT_DRUG_CATALOG = Object.freeze([
  { name: '避孕药', description: '每日服用的避孕药（或世界观里的等效草药、法术）：女方抑制排卵，男方让精液失去活性。', effects: [{ effect: 'pill', strength: 'normal' }], days: 30 },
  { name: '事后避孕药', description: '性行为后尽快服用的紧急避孕药（或世界观里的等效草药、法术）。', effects: [{ effect: 'emergency', strength: 'normal' }], days: 0 },
  { name: '促排卵药', description: '排卵诱导药，可能多排出一颗卵（或世界观里的等效草药、法术）。', effects: [{ effect: 'ovulation', strength: 'normal' }], days: 5 },
  { name: '调经药', description: '调整月经周期，让周期回到规律（或世界观里的等效草药、法术）。', effects: [{ effect: 'regulate', strength: 'normal' }], days: 30 },
  // 1.5.4：春药与堕胎药现实都有，也放进通用名录
  { name: '春药', description: '催情药（或世界观里的等效药物、法术）：女方对刺激更敏感、更容易动情；男方很快又硬起来、精液也补了回来。药效约一个晚上。', effects: [{ effect: 'aphrodisiac', strength: 'light' }], days: 0.25 },
  { name: '堕胎药', description: '药物流产（或世界观里的等效草药、法术）：只对已着床的妊娠，孕期越后越难，可能没流干净。', effects: [{ effect: 'abortifacient', strength: 'normal' }], days: 0 },
]);
/** 旧名：1.5.3 开发中写实世界专用，现在所有世界共用 */
export const REALISTIC_DRUG_CATALOG = DEFAULT_DRUG_CATALOG;
