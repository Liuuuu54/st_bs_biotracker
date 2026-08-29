export const WARDROBE_DIMENSIONS = Object.freeze(['masking', 'support', 'capacity', 'convenience']);

export const DEFAULT_WARDROBE_ITEM = Object.freeze({
  id: 0,
  name: '全裸',
  note: '未着衣物。',
  slot: 'main',
  masking: 0,
  support: 0,
  capacity: 10,
  convenience: 10,
});

export function createDefaultWardrobeItem() {
  return { ...DEFAULT_WARDROBE_ITEM };
}

function clampScore(value, min, max, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function normalizeWardrobeItemId(value, fallback = null) {
  if (value === 'nude') return 0;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 100000 + (hash % 900000);
}

export function limitAccessoryWardrobeScores(item) {
  if (!item || item.slot !== 'accessory') return item;
  const ranked = WARDROBE_DIMENSIONS
    .map((key, index) => ({ key, index, value: clampScore(item[key], -3, 3, 0) }))
    .filter((entry) => entry.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.index - b.index);
  const kept = new Set(ranked.slice(0, 2).map((entry) => entry.key));
  for (const key of WARDROBE_DIMENSIONS) {
    item[key] = kept.has(key) ? clampScore(item[key], -3, 3, 0) : 0;
  }
  return item;
}

// wearState 是当前穿着的开放短标签（如 整齐/敞开/半褪/湿透）。
// 长度硬上限与分隔符剥离保证它保持标签粒度，不会膨胀成描述文本。
export const DEFAULT_WEAR_STATE = '整齐';
const WEAR_STATE_MAX_LENGTH = 12;

export function sanitizeWearState(value, fallback = DEFAULT_WEAR_STATE) {
  const text = String(value ?? '').replace(/[|;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return Array.from(text).slice(0, WEAR_STATE_MAX_LENGTH).join('');
}

export function normalizeWardrobeItem(value, { allowMissingId = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = normalizeWardrobeItemId(value.id);
  const name = String(value.name || '').trim();
  const slot = String(value.slot || '').trim() === 'accessory' ? 'accessory' : 'main';
  const note = String(value.note || '').trim();
  if ((id === null && !allowMissingId) || !name) return null;
  const parts = slot === 'main' && Array.isArray(value.parts)
    ? value.parts.map((part) => String(part ?? '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const layer = slot === 'accessory' && String(value.layer || '').trim() === 'inner' ? 'inner' : null;
  const item = {
    id,
    name,
    note,
    slot,
    ...(parts.length > 0 ? { parts } : {}),
    ...(layer ? { layer } : {}),
    masking: clampScore(
      value.masking !== undefined ? value.masking : 10 - clampScore(value.contour, -10, 10, 10),
      -10,
      10,
      0,
    ),
    support: clampScore(
      value.support !== undefined ? value.support : 10 - clampScore(value.unsupported, -10, 10, 10),
      -10,
      10,
      0,
    ),
    capacity: clampScore(value.capacity, -10, 10, 0),
    convenience: clampScore(value.convenience, -10, 10, 0),
  };
  return limitAccessoryWardrobeScores(item);
}

export function normalizeTemporaryOutfitItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const source of value) {
    const item = normalizeWardrobeItem(source);
    if (!item || item.id === DEFAULT_WARDROBE_ITEM.id || items.some((existing) => existing.id === item.id)) continue;
    items.push({ ...item, source: 'temporary' });
  }
  return items;
}

// 解析对衣物的引用：整数视为 id；字符串先按名称精确匹配（其次不分大小写），
// 最后回退到历史字符串 id 的 hash 兼容映射。返回匹配的衣物或 null。
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
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return list.find((item) => item.id === numeric) || null;
  }
  if (text === 'nude') return list.find((item) => item.id === 0) || null;
  const lower = text.toLowerCase();
  const byName = list.find((item) => String(item.name || '').trim() === text)
    || list.find((item) => String(item.name || '').trim().toLowerCase() === lower);
  if (byName) return byName;
  const hashedId = normalizeWardrobeItemId(text);
  return list.find((item) => item.id === hashedId) || null;
}

// 长期衣柜的下一个可用整数 id：沿用 1 起递增，跳过 hash 兼容区（>= 100000）已占用的 id。
export function getNextWardrobeItemId(items) {
  const used = new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isInteger(id) && id >= 0),
  );
  let candidate = 1;
  for (const id of used) {
    if (id < 100000 && id >= candidate) candidate = id + 1;
  }
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
