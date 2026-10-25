/**
 * 角色文字描述：profile.descriptions.normalDescription／pregnantDescription 各是一个有序阵列
 *   [{ name, value, updatedAt }]
 * 阵列顺序即显示与提示词顺序，由注册（或第一次写入）建立；updatedAt 是系统时钟 minutesPassed，
 * 供「太久没更新的字段」点名用。模型读写一律用以字段名为键的物件 { 字段名: 内容 }，
 * 不再自己拼「字段名|内容;;」字串；旧字串格式只在迁移与过渡期的输入里接受。
 */

export const DESCRIPTION_FIELDS = Object.freeze(['normalDescription', 'pregnantDescription']);
/** 超过一天（游戏时间）没更新的字段会在追踪提示里点名 */
export const DESCRIPTION_STALE_MINUTES = 1440;
/** 旧字串里切不出「字段名|内容」的段落，迁移时整段收进这一栏，不丢资料 */
export const UNSORTED_DESCRIPTION_NAME = '未分类';

function toMinutes(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

/** 旧格式「字段名|内容;;字段名|内容;;」：名称后第一个 | 才是分隔，内容可以含 | */
export function parseLegacyDescriptionText(text) {
  const entries = [];
  const malformed = [];
  for (const segment of String(text || '').split(';;').map((part) => part.trim()).filter(Boolean)) {
    const separatorIndex = segment.indexOf('|');
    const name = separatorIndex > 0 ? segment.slice(0, separatorIndex).trim() : '';
    if (!name) {
      malformed.push(segment);
      continue;
    }
    entries.push({ name, value: segment.slice(separatorIndex + 1).trim() });
  }
  return { entries, malformed };
}

/** 任意来源（阵列、物件、旧字串）的 { name, value } 清单；同名只留第一笔 */
function toEntries(source) {
  if (Array.isArray(source)) {
    return source
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({ name: String(entry.name ?? '').trim(), value: String(entry.value ?? '').trim(), updatedAt: entry.updatedAt }));
  }
  if (source && typeof source === 'object') {
    return Object.entries(source).map(([name, value]) => ({ name: String(name).trim(), value: String(value ?? '').trim() }));
  }
  if (typeof source === 'string') {
    const { entries, malformed } = parseLegacyDescriptionText(source);
    return malformed.length > 0
      ? [...entries, { name: UNSORTED_DESCRIPTION_NAME, value: malformed.join('；') }]
      : entries;
  }
  return [];
}

/**
 * 正规化成存档用的阵列。updatedAt 缺漏时补 minutesPassed（迁移时视为刚更新，避免一升级就全部被点名）。
 */
export function normalizeDescriptionList(source, minutesPassed = 0) {
  const seen = new Set();
  const list = [];
  for (const entry of toEntries(source)) {
    if (!entry.name || seen.has(entry.name)) continue;
    seen.add(entry.name);
    list.push({ name: entry.name, value: entry.value, updatedAt: toMinutes(entry.updatedAt, minutesPassed) });
  }
  return list;
}

/** 给模型看的样子：{ 字段名: 内容 }，不带 updatedAt */
export function descriptionListToObject(list) {
  return Object.fromEntries(normalizeDescriptionList(list).map(({ name, value }) => [name, value]));
}

export function isDescriptionListEmpty(list) {
  return normalizeDescriptionList(list).length === 0;
}

/**
 * 合并一次 bsSetDescription 的补丁。逐栏处理，不再因一栏有错就整栏作废：
 * - 栏位还没有任何字段（注册时留空）：补丁的字段依序建立
 * - 不存在的字段名略过并回报；空字串视为不改
 * - 内容与原文相同也算「确认未变」，刷新 updatedAt
 */
export function applyDescriptionPatch(currentList, patch, minutesPassed = 0) {
  const now = toMinutes(minutesPassed, 0);
  const list = normalizeDescriptionList(currentList, now).map((entry) => ({ ...entry }));
  // 模型偶尔把范本的 * 照抄进字段名；* 只是范本标记，不是名字的一部分
  const patchEntries = toEntries(patch)
    .map((entry) => ({ ...entry, name: String(entry.name || '').replace(/^\*+/, '').trim() }))
    .filter((entry) => entry.name);
  const result = { list, updated: [], refreshed: [], unknown: [], established: false };
  if (list.length === 0) {
    const established = normalizeDescriptionList(patchEntries.filter((entry) => entry.value), now)
      .map((entry) => ({ ...entry, updatedAt: now }));
    result.list = established;
    result.established = established.length > 0;
    result.updated = established.map((entry) => entry.name);
    return result;
  }
  const byName = new Map(list.map((entry) => [entry.name, entry]));
  for (const { name, value } of patchEntries) {
    const entry = byName.get(name);
    if (!entry) {
      if (!result.unknown.includes(name)) result.unknown.push(name);
      continue;
    }
    if (!value) continue;
    if (value === entry.value) result.refreshed.push(name);
    else {
      entry.value = value;
      result.updated.push(name);
    }
    entry.updatedAt = now;
  }
  return result;
}

/** 超过门槛没更新的字段名，按栏位顺序 */
export function getStaleDescriptionFields(list, minutesPassed, threshold = DESCRIPTION_STALE_MINUTES) {
  const now = toMinutes(minutesPassed, 0);
  return normalizeDescriptionList(list, now)
    .filter((entry) => now - entry.updatedAt >= threshold)
    .map((entry) => entry.name);
}

/**
 * 描述范本的字段：每行「字段名|说明」，字段名前加 * 代表要即时追踪（超过一天没更新会点名）。
 * 大括号的提示行与空行略过。回传 [{ name, starred }]，name 不含 *。
 */
export function parseDescriptionGuideFields(guide) {
  const fields = [];
  for (const raw of String(guide || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('{')) continue;
    const separator = line.indexOf('|');
    if (separator <= 0) continue;
    const head = line.slice(0, separator).trim();
    const starred = head.startsWith('*');
    const name = head.replace(/^\*+/, '').trim();
    if (name) fields.push({ name, starred });
  }
  return fields;
}

/** 给模型看的范本：拿掉 * 标记，免得模型把 * 写进字段名 */
export function stripDescriptionGuideStars(guide) {
  return String(guide || '').replace(/^(\s*)\*+/gm, '$1');
}
