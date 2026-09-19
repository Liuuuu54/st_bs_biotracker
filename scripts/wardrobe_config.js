export const WARDROBE_DIMENSIONS = Object.freeze(['masking', 'support', 'capacity', 'convenience']);

export const WARDROBE_MAIN_LEVELS = Object.freeze({
  masking: Object.freeze({ very_low: 2, low: 4, medium: 6, high: 8 }),
  support: Object.freeze({ none: 0, normal: 4, strong: 8 }),
  capacity: Object.freeze({ tight: 1, fitted: 3, stretch: 7, loose: 9 }),
  convenience: Object.freeze({ inconvenient: 2, normal: 5, convenient: 8 }),
});

export const WARDROBE_MAIN_LEVEL_LABELS = Object.freeze({
  masking: Object.freeze({ very_low: '極低', low: '低', medium: '中', high: '高' }),
  support: Object.freeze({ none: '無', normal: '普通', strong: '強' }),
  capacity: Object.freeze({ tight: '緊繃', fitted: '合身', stretch: '彈性', loose: '寬鬆' }),
  convenience: Object.freeze({ inconvenient: '不便', normal: '普通', convenient: '方便' }),
});

export const DEFAULT_MAIN_FIT_PROFILE = Object.freeze({
  masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal',
});

export const WARDROBE_ACCESSORY_CATEGORIES = Object.freeze([
  'underwear', 'outerwear', 'footwear', 'headwear', 'ornament', 'support', 'other',
]);

export const WARDROBE_ACCESSORY_CATEGORY_LABELS = Object.freeze({
  underwear: '內衣', outerwear: '外搭', footwear: '鞋襪', headwear: '頭飾',
  ornament: '飾品', support: '支撐用品', other: '其他',
});

export const WARDROBE_ACCESSORY_EFFECTS = Object.freeze({
  masking_up: Object.freeze({ dimension: 'masking', amount: 2, label: '隱藏上升' }),
  masking_down: Object.freeze({ dimension: 'masking', amount: -2, label: '隱藏下降' }),
  support_up: Object.freeze({ dimension: 'support', amount: 2, label: '支撐上升' }),
  support_down: Object.freeze({ dimension: 'support', amount: -2, label: '支撐下降' }),
  capacity_up: Object.freeze({ dimension: 'capacity', amount: 2, label: '容身上升' }),
  capacity_down: Object.freeze({ dimension: 'capacity', amount: -2, label: '容身下降' }),
  convenience_up: Object.freeze({ dimension: 'convenience', amount: 2, label: '方便上升' }),
  convenience_down: Object.freeze({ dimension: 'convenience', amount: -2, label: '方便下降' }),
});

export const DEFAULT_WARDROBE_ITEM = Object.freeze({
  id: 0, name: '全裸', note: '未着衣物。', slot: 'main',
  masking: 0, support: 0, capacity: 10, convenience: 10,
});

export function createDefaultWardrobeItem() { return { ...DEFAULT_WARDROBE_ITEM }; }

function normalizeLevel(dimension, value, fallback) {
  const levels = WARDROBE_MAIN_LEVELS[dimension];
  const direct = String(value ?? '').trim();
  if (Object.hasOwn(levels, direct)) return direct;
  return fallback;
}

function normalizeFitProfile(value) {
  const source = value?.fitProfile && typeof value.fitProfile === 'object' ? value.fitProfile : {};
  return {
    masking: normalizeLevel('masking', source.masking, DEFAULT_MAIN_FIT_PROFILE.masking),
    support: normalizeLevel('support', source.support, DEFAULT_MAIN_FIT_PROFILE.support),
    capacity: normalizeLevel('capacity', source.capacity, DEFAULT_MAIN_FIT_PROFILE.capacity),
    convenience: normalizeLevel('convenience', source.convenience, DEFAULT_MAIN_FIT_PROFILE.convenience),
  };
}

function normalizeAccessoryEffects(value) {
  const source = Array.isArray(value?.effects) ? value.effects : [];
  const effects = [];
  const dimensions = new Set();
  for (const raw of source) {
    const effect = String(raw ?? '').trim();
    const definition = WARDROBE_ACCESSORY_EFFECTS[effect];
    if (!definition || dimensions.has(definition.dimension)) continue;
    effects.push(effect);
    dimensions.add(definition.dimension);
    if (effects.length >= 2) break;
  }
  return effects;
}

function getAccessoryCategory(value) {
  const category = String(value?.category ?? '').trim();
  if (WARDROBE_ACCESSORY_CATEGORIES.includes(category)) return category;
  return 'other';
}

export function getWardrobeItemMetrics(item) {
  if (!item || typeof item !== 'object') return { masking: 0, support: 0, capacity: 0, convenience: 0 };
  if (Number(item.id) === 0 && item.slot !== 'accessory') {
    return { masking: 0, support: 0, capacity: 10, convenience: 10 };
  }
  if (item.slot === 'accessory') {
    const metrics = { masking: 0, support: 0, capacity: 0, convenience: 0 };
    for (const effect of normalizeAccessoryEffects(item)) {
      const definition = WARDROBE_ACCESSORY_EFFECTS[effect];
      metrics[definition.dimension] += definition.amount;
    }
    return metrics;
  }
  const profile = normalizeFitProfile(item);
  return Object.fromEntries(WARDROBE_DIMENSIONS.map((key) => [key, WARDROBE_MAIN_LEVELS[key][profile[key]]]));
}

export function normalizeWardrobeItemId(value, fallback = null) {
  if (value === 'nude') return 0;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  return fallback;
}

export const DEFAULT_WEAR_STATE = '整齐';
const WEAR_STATE_MAX_LENGTH = 12;

export function sanitizeWearState(value, fallback = DEFAULT_WEAR_STATE) {
  const text = String(value ?? '').replace(/[|;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return Array.from(text).slice(0, WEAR_STATE_MAX_LENGTH).join('');
}

export function normalizeWardrobeItem(value, { allowMissingId = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hasId = Object.hasOwn(value, 'id') && value.id !== undefined;
  if (hasId && (!Number.isInteger(value.id) || value.id < 0)) return null;
  const id = Number.isInteger(value.id) && value.id >= 0 ? value.id : null;
  const name = String(value.name || '').trim();
  const slot = String(value.slot || '').trim() === 'accessory' ? 'accessory' : 'main';
  const note = String(value.note || '').trim();
  if ((id === null && !allowMissingId) || !name) return null;
  if (id === 0 && slot === 'main') return createDefaultWardrobeItem();
  const parts = slot === 'main' && Array.isArray(value.parts)
    ? value.parts.map((part) => String(part ?? '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const semantic = slot === 'main'
    ? { fitProfile: normalizeFitProfile(value) }
    : { category: getAccessoryCategory(value), effects: normalizeAccessoryEffects(value) };
  const item = { id, name, note, slot, ...(parts.length ? { parts } : {}), ...semantic };
  return { ...item, ...getWardrobeItemMetrics(item) };
}

export function normalizeTransientOutfitItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const source of value) {
    const item = normalizeWardrobeItem(source);
    if (!item || item.id === 0 || items.some((existing) => existing.id === item.id)) continue;
    items.push({ ...item, source: 'transient' });
  }
  return items;
}

export function resolveWardrobeItemRef(items, ref, slot = '') {
  if (ref === undefined || ref === null) return null;
  const list = (Array.isArray(items) ? items : []).filter((item) => item && (!slot || item.slot === slot));
  if (typeof ref === 'number' || typeof ref === 'boolean') {
    const numeric = Number(ref);
    if (!Number.isInteger(numeric) || numeric < 0) return null;
    return list.find((item) => item.id === numeric) || null;
  }
  const text = String(ref).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return list.find((item) => item.id === Number(text)) || null;
  if (text === 'nude') return list.find((item) => item.id === 0) || null;
  const lower = text.toLowerCase();
  const byName = list.find((item) => String(item.name || '').trim() === text)
    || list.find((item) => String(item.name || '').trim().toLowerCase() === lower);
  return byName || null;
}

export function getNextWardrobeItemId(items) {
  const used = new Set((Array.isArray(items) ? items : []).map((item) => Number(item?.id)).filter((id) => Number.isInteger(id) && id >= 0));
  let candidate = 1;
  for (const id of used) if (id >= candidate) candidate = id + 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
