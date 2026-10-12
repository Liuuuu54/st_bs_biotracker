// 插件自己判断世界书关键字触发：只在宿主没有 getWorldInfoPrompt 可用时当后备（见 api.js）。
// 尽量贴近 SillyTavern 的规则：只扫最近几则（条目的 scanDepth，否则宿主预设 2 则）、
// 次要关键字照四种逻辑、支援 /正则/ 关键字。包含组、机率、黏着冷却与递回触发不模拟。

// SillyTavern world_info_depth 的预设值
export const DEFAULT_WORLD_INFO_SCAN_DEPTH = 2;

// SillyTavern 的 world_info_logic：主关键字命中后，次要关键字怎么判断
const SELECTIVE_LOGIC = Object.freeze({ AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 });

export function normalizeWorldbookKeywords(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

export function getWorldbookEntryActivationMode(entry) {
  const mode = String(entry?.activationMode || '').trim().toLowerCase();
  if (mode) return mode;
  if (entry?.constant === true || entry?.always === true) return 'always';
  if (entry?.selective === true || normalizeWorldbookKeywords(entry?.key).length > 0 || normalizeWorldbookKeywords(entry?.keys).length > 0) return 'keyword';
  return '';
}

function getScanDepth(entry) {
  const depth = Number(entry?.scanDepth);
  return Number.isInteger(depth) && depth >= 0 ? depth : DEFAULT_WORLD_INFO_SCAN_DEPTH;
}

/** 与宿主相同：「名字: 内容」，只取最近 depth 则 */
function buildScanText(recentMessages, depth) {
  const messages = Array.isArray(recentMessages) ? recentMessages : [];
  if (depth <= 0) return '';
  return messages.slice(-depth)
    .map((message) => `${message?.name || ''}: ${message?.text || ''}`)
    .join('\n');
}

function keywordMatches(keyword, text, caseSensitive) {
  const regex = keyword.match(/^\/([\s\S]+)\/([a-z]*)$/);
  if (regex) {
    try {
      return new RegExp(regex[1], regex[2]).test(text);
    } catch {
      return false;
    }
  }
  return caseSensitive ? text.includes(keyword) : text.toLowerCase().includes(keyword.toLowerCase());
}

export function worldbookEntryKeywordsMatch(entry, recentMessages = []) {
  const text = buildScanText(recentMessages, getScanDepth(entry));
  if (!text) return false;
  const caseSensitive = entry?.caseSensitive === true;
  const primaryKeys = [...normalizeWorldbookKeywords(entry?.key), ...normalizeWorldbookKeywords(entry?.keys)];
  if (!primaryKeys.some((keyword) => keywordMatches(keyword, text, caseSensitive))) return false;

  const secondaryKeys = [
    ...normalizeWorldbookKeywords(entry?.keysecondary),
    ...normalizeWorldbookKeywords(entry?.keySecondary),
    ...normalizeWorldbookKeywords(entry?.secondary_keys),
    ...normalizeWorldbookKeywords(entry?.secondaryKeys),
  ];
  if (entry?.selective !== true || secondaryKeys.length === 0) return true;
  const hits = secondaryKeys.filter((keyword) => keywordMatches(keyword, text, caseSensitive)).length;
  switch (Number(entry?.selectiveLogic) || SELECTIVE_LOGIC.AND_ANY) {
    case SELECTIVE_LOGIC.NOT_ALL: return hits < secondaryKeys.length;
    case SELECTIVE_LOGIC.NOT_ANY: return hits === 0;
    case SELECTIVE_LOGIC.AND_ALL: return hits === secondaryKeys.length;
    default: return hits > 0;
  }
}
