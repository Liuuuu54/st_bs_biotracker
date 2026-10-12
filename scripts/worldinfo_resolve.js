// 主流模式的世界书：让宿主自己算触发（getWorldInfoPrompt 试跑），排除名单在候选阶段生效；
// 有主流快照时，再拿这次试算的结果替快照补上「这则回复才触发」的条目、删掉被排除条目的原文。
// 只用宿主的世界书 API，不依赖 EJS、酒馆助手或其他扩充。
import { getHostChat, getHostChatCompletionSettings, getHostWorldInfoPrompt, subscribeHostEvent } from './host.js';
import { getWorldbookEntryDisplayName, worldbookSelectionMatches } from './state.js';

// 太短的内容拿来比对快照会误中别段文字
const MIN_MATCHABLE_CONTENT_LENGTH = 20;

/**
 * SillyTavern 的 getWorldInfoPrompt 要的是「名字: 内容」字串、最新一则在前（script.js 组 chatForWI 的方式），
 * 不是聊天物件；传物件会在 trim() 抛错，整条路就退回插件自己比对关键字。
 */
export function buildWorldInfoScanChat(chat) {
  return (Array.isArray(chat) ? chat : [])
    .filter((message) => message && !message.is_system && typeof message.mes === 'string')
    .map((message) => `${message.name || ''}: ${message.mes}`)
    .reverse();
}

function parseWorldbookNameLines(value) {
  return new Set(String(value || '').split(/\r?\n+/).map((item) => item.trim()).filter(Boolean));
}

export function getWorldInfoExclusions(settings) {
  return {
    character: parseWorldbookNameLines(settings?.trackerWorldbookExcludeNames),
    global: parseWorldbookNameLines(settings?.trackerGlobalWorldbookExcludeNames),
  };
}

const WORLD_INFO_LORE_SCOPES = Object.freeze({
  globalLore: 'global',
  characterLore: 'character',
  chatLore: 'character',
  personaLore: 'character',
});

/**
 * 排除名单套进宿主自己的触发：试跑期间监听「条目载入」，把排除的条目从候选里拿掉，
 * 再交给宿主照扫描深度、包含组、机率等规则判断。全域书用全域名单，其余用角色名单。
 * 回传被拿掉的条目。
 */
export function removeExcludedWorldInfoEntries(data, excluded) {
  const removed = [];
  for (const [key, scope] of Object.entries(WORLD_INFO_LORE_SCOPES)) {
    const list = data?.[key];
    const names = excluded?.[scope];
    if (!Array.isArray(list) || !names?.size) continue;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const entry = list[index];
      const name = getWorldbookEntryDisplayName(entry);
      const book = String(entry?.world || '').trim();
      if (!name || !worldbookSelectionMatches(names, book ? `${book} :: ${name}` : name, name)) continue;
      removed.push(entry);
      list.splice(index, 1);
    }
  }
  return removed;
}

function collectLoreEntries(data) {
  return Object.keys(WORLD_INFO_LORE_SCOPES).flatMap((key) => (Array.isArray(data?.[key]) ? data[key] : []));
}

/**
 * 宿主试算这一刻的世界书。回传宿主组好的文字，以及（可选）候选条目与被排除的条目，
 * 供快照补漏与删除比对用。宿主没有这个 API 或试算失败时回传 null。
 */
export async function resolveHostWorldInfo(ctx, settings, { collectEntries = false } = {}) {
  const chat = buildWorldInfoScanChat(getHostChat(ctx));
  const maxContext = Number(ctx?.maxContext || getHostChatCompletionSettings(ctx)?.openai_max_context || 0);
  const excluded = getWorldInfoExclusions(settings);
  const removedEntries = [];
  let candidateEntries = [];
  const unsubscribe = collectEntries || excluded.character.size || excluded.global.size
    ? subscribeHostEvent(ctx, 'worldInfoEntriesLoaded', (data) => {
      removedEntries.push(...removeExcludedWorldInfoEntries(data, excluded));
      if (collectEntries) candidateEntries = collectLoreEntries(data);
    })
    : null;
  try {
    // 第三个参数是 isDryRun：只试算触发，不推进黏着／冷却，也不发 WORLD_INFO_ACTIVATED
    const result = await getHostWorldInfoPrompt(ctx, chat, maxContext > 0 ? maxContext : undefined, true);
    if (!result) return null;
    const before = String(result.worldInfoBefore || '').trim();
    const after = String(result.worldInfoAfter || '').trim();
    // 深度注入的条目不在 before/after 里，比对补漏时一起算
    const depthText = (Array.isArray(result.worldInfoDepth) ? result.worldInfoDepth : [])
      .flatMap((item) => (Array.isArray(item?.entries) ? item.entries : []))
      .join('\n');
    return {
      before,
      after,
      combined: [before, after].filter(Boolean).join('\n').trim(),
      activationText: [before, after, depthText].filter(Boolean).join('\n'),
      candidateEntries,
      removedEntries,
    };
  } catch (error) {
    console.warn('[BS BioTracker] failed to resolve world info prompt', error);
    return null;
  } finally {
    unsubscribe?.();
  }
}

/** 条目内容送进提示词前，宿主会先替换 {{user}} 等巨集；比对前照做一次 */
function substituteEntryContent(ctx, entry) {
  const raw = String(entry?.content ?? '').trim();
  if (!raw) return '';
  try {
    return typeof ctx?.substituteParams === 'function' ? String(ctx.substituteParams(raw)).trim() : raw;
  } catch {
    return raw;
  }
}

/** 原文就是主流会看到的样子：没有模板、残留巨集或 EJS 装饰器，长度也够比对 */
function isPlainMatchableContent(text) {
  return text.length >= MIN_MATCHABLE_CONTENT_LENGTH && !/<%|\{\{|^@@/m.test(text);
}

/**
 * 宿主组提示词时会调整空白（深度注入的条目合并成一段、缩排与空行会变），
 * 原文整段比对会误判「快照里没有」。比对与删除都忽略空白差异。
 */
function buildLooseMatcher(text) {
  const pattern = text.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(pattern, 'g');
}

function containsLoosely(haystack, text) {
  return buildLooseMatcher(text).test(haystack);
}

function snapshotText(snapshot) {
  return (Array.isArray(snapshot?.messages) ? snapshot.messages : []).map((message) => String(message?.content || '')).join('\n');
}

/**
 * 快照是「产生这则回复的那次请求」，回复里才触发的条目不在里面。
 * 找出宿主这一刻会触发、快照里却没有的纯文字条目；含模板的条目没经过主流扩充处理，不补。
 */
export function findWorldInfoMissingFromSnapshot(ctx, snapshot, resolved) {
  if (!snapshot || !resolved?.activationText || !Array.isArray(resolved.candidateEntries)) return [];
  const existing = snapshotText(snapshot);
  const seen = new Set();
  const missing = [];
  for (const entry of resolved.candidateEntries) {
    // 常驻条目每次请求都在；快照里比对不到，代表被别的扩充刻意拿掉或改写，不补
    if (entry?.disable === true || entry?.constant === true) continue;
    const content = substituteEntryContent(ctx, entry);
    if (!isPlainMatchableContent(content) || seen.has(content)) continue;
    if (!containsLoosely(resolved.activationText, content) || containsLoosely(existing, content)) continue;
    seen.add(content);
    missing.push({ name: getWorldbookEntryDisplayName(entry), book: String(entry?.world || '').trim(), content });
  }
  return missing;
}

/**
 * 快照里删掉被排除条目的原文。含模板的条目渲染后对不上原文，删不掉，回传它们的名字。
 */
export function stripExcludedFromSnapshot(ctx, snapshot, removedEntries) {
  if (!snapshot || !Array.isArray(snapshot.messages) || !Array.isArray(removedEntries) || removedEntries.length === 0) {
    return { snapshot, stripped: [], unmatched: [] };
  }
  let messages = snapshot.messages.map((message) => ({ ...message }));
  const stripped = [];
  const unmatched = [];
  for (const entry of removedEntries) {
    const name = getWorldbookEntryDisplayName(entry);
    const candidates = [...new Set([substituteEntryContent(ctx, entry), String(entry?.content ?? '').trim()])]
      .filter((text) => text.length >= MIN_MATCHABLE_CONTENT_LENGTH);
    let hit = false;
    for (const text of candidates) {
      messages = messages.map((message) => {
        const content = String(message.content || '');
        if (!containsLoosely(content, text)) return message;
        hit = true;
        return { ...message, content: content.replace(buildLooseMatcher(text), '') };
      });
    }
    if (hit) stripped.push(name);
    // 没比对到的纯文字条目代表这轮没触发；含模板的则可能在快照里却认不出来
    else if (/<%|\{\{|^@@/m.test(String(entry?.content ?? ''))) unmatched.push(name);
  }
  messages = messages.filter((message) => String(message.content || '').trim());
  return { snapshot: { ...snapshot, messages }, stripped, unmatched };
}
