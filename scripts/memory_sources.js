const DATABASE_MEMO_NAME = /^(?:TavernDB-ACU-CustomExport-纪要-\d+|(?:总结条目|小总结条目)[\s_#-]*\d+(?:\s.*)?)$/i;

export const MEMORY_SOURCE_VALUES = Object.freeze(['internal', 'anima', 'baibai', 'database']);

export function normalizeMemorySource(value) {
  const source = String(value || '').trim().toLowerCase();
  return MEMORY_SOURCE_VALUES.includes(source) ? source : 'internal';
}

function tokenize(value) {
  const text = String(value || '').toLowerCase();
  return new Set([
    // 扩展支持中日韩（CJK）多语言字符集的二元滑动窗口分词
    ...(text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]{2,}/g) || []).flatMap((run) => {
      const tokens = [];
      for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
      return tokens;
    }),
    ...(text.match(/[a-z0-9_]{2,}/g) || []),
  ]);
}

function selectRelevant(items, query, limit = 20) {
  const queryTokens = tokenize(query);
  return items
    .map((item, index) => {
      const haystack = tokenize(`${item.tags || ''}\n${item.text || ''}`);
      let score = 0;
      for (const token of queryTokens) if (haystack.has(token)) score += token.length >= 4 ? 2 : 1;
      return { ...item, score, index };
    })
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 20)))
    .sort((left, right) => (Number(left.batch) || 0) - (Number(right.batch) || 0)
      || (Number(left.slice) || 0) - (Number(right.slice) || 0)
      || (Number(left.time) || 0) - (Number(right.time) || 0)
      || left.index - right.index);
}

async function capMemoryText(text, ctx) {
  const value = String(text || '').trim();
  if (!value) return '';
  let tokenCount;
  try {
    const counter = ctx?.getTokenCountAsync;
    tokenCount = typeof counter === 'function' ? Number(await counter.call(ctx, value)) : Math.ceil(value.length / 2);
  } catch {
    tokenCount = Math.ceil(value.length / 2);
  }
  const budget = 60000;
  if (!Number.isFinite(tokenCount) || tokenCount <= budget) return value;
  const keepChars = Math.max(1, Math.floor(value.length * 0.95 * budget / tokenCount));
  const blocks = value.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length <= 1) return value.slice(-keepChars);
  const average = Math.max(1, Math.ceil(value.length / blocks.length));
  const keepCount = Math.max(1, Math.floor(keepChars / average));
  if (keepCount >= blocks.length) return value;
  return ['（……较早记忆已省略以控制长度……）', ...blocks.slice(-keepCount)].join('\n\n');
}

async function readAnima(recentMessages, limit) {
  const api = globalThis.TavernHelper;
  if (typeof api?.getChatWorldbookName !== 'function' || typeof api?.getWorldbook !== 'function') return { text: '', sourceName: '' };
  const bookName = await api.getChatWorldbookName('current');
  if (!bookName) return { text: '', sourceName: '' };
  const entries = await api.getWorldbook(bookName);
  if (!Array.isArray(entries)) return { text: '', sourceName: String(bookName) };
  const slices = [];
  for (const entry of entries) {
    if (entry?.extra?.createdBy !== 'anima_summary' || !Array.isArray(entry.extra.history)) continue;
    const content = String(entry.content || '');
    for (const history of entry.extra.history) {
      const id = history.unique_id ?? history.index;
      if (id === undefined || id === null) continue;
      const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = content.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
      if (match?.[1]?.trim()) slices.push({
        text: match[1].trim(),
        tags: history.tags,
        batch: Number(history.batch_id ?? history.index) || 0,
        slice: Number(history.slice_id) || 0,
        time: Date.parse(history.narrative_time) || 0,
      });
    }
  }
  const query = recentMessages.slice(-6).map((message) => String(message?.text || '')).join('\n').slice(-6000);
  return { text: selectRelevant(slices, query, limit).map((item) => item.text).join('\n\n'), sourceName: String(bookName) };
}

async function readBaiBai() {
  const api = globalThis.STBaiBaiBook;
  if (typeof api?.getInjectedHistory !== 'function') return { text: '', sourceName: '柏宝书' };
  const history = api.getInjectedHistory() || {};
  return { text: String(history.relativeText || ''), sourceName: String(history.name || history.bookName || '柏宝书') };
}

function isDatabaseMemoEntry(entry) {
  const name = String(entry?.name || '').trim() || String(entry?.comment || '').trim();
  return DATABASE_MEMO_NAME.test(name);
}

async function readDatabase(ctx, selectedWorldbookName) {
  const api = globalThis.TavernHelper;
  const readWorldbook = typeof api?.getWorldbook === 'function'
    ? api.getWorldbook.bind(api)
    : typeof ctx?.loadWorldInfo === 'function'
      ? async (name) => {
        const result = await ctx.loadWorldInfo(name);
        return Array.isArray(result?.entries) ? result.entries : Object.values(result?.entries || {});
      }
      : null;
  let helperPrimary = '';
  try {
    helperPrimary = String(api?.getCharLorebooks?.()?.primary || '').trim();
  } catch {}
  const bookName = String(selectedWorldbookName || '').trim()
    || helperPrimary
    || String(ctx?.characters?.[ctx?.characterId]?.data?.extensions?.world || '').trim();
  if (!readWorldbook || !bookName) return { text: '', sourceName: bookName };
  const entries = await readWorldbook(bookName);
  if (!Array.isArray(entries)) return { text: '', sourceName: bookName };
  const query = String(ctx?.chat?.slice(-6).map((message) => message?.mes || '').join('\n') || '').slice(-6000);
  const memories = entries.filter(isDatabaseMemoEntry).map((entry, index) => ({
    text: String(entry?.content || '').trim(),
    tags: [entry?.name, entry?.comment, entry?.key, entry?.keys]
      .flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(' '),
    index,
  })).filter((entry) => entry.text);
  return { text: selectRelevant(memories, query, 20).map((entry) => entry.text).join('\n\n'), sourceName: bookName };
}

export async function readMemorySource({ ctx, source = 'internal', recentMessages = [], databaseWorldbookName = '', animaRecallCount = 20 } = {}) {
  const normalized = normalizeMemorySource(source);
  if (normalized === 'internal') return { source: normalized, text: '', sourceName: '插件内置记忆' };
  try {
    const result = normalized === 'anima'
      ? await readAnima(recentMessages, animaRecallCount)
      : normalized === 'baibai'
        ? await readBaiBai()
        : await readDatabase(ctx, databaseWorldbookName);
    return {
      source: normalized,
      text: await capMemoryText(result?.text, ctx),
      sourceName: String(result?.sourceName || ''),
    };
  } catch (error) {
    console.warn(`[BS BioTracker] ${normalized} memory source read failed`, error);
    return { source: normalized, text: '', sourceName: '', error };
  }
}