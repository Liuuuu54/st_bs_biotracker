import {
  normalizeRaceOverrideMap, normalizeDerivedOverrideMap,
  sanitizeRacePhysiologyProfilePatch, sanitizeDerivedTypeProfilePatch,
  setRacePhysiologyOverrides, setDerivedTypeOverrides, RACE_CATALOG_SELECTION_VERSION,
} from './race_config.js';
import { normalizeReproductiveSettings } from './reproductive.js';
import { normalizeSkillCatalog, registerSkillDefinition } from './skill_config.js';
import { getHostKind, getHostContext } from './host.js';

export const CARD_SETTINGS_KEY = 'bs_biotracker';
export const CARD_SETTINGS_VERSION = 1;
export const CARD_REPRODUCTIVE_FIELDS = Object.freeze(['condomCapacity', 'condomReliability', 'emergencyEffectiveness']);
const UNSET_VALUE = '__@@UNSET@@__'; // Installed ST 1.19.0 / Luker 2.7.0 extensions.js.
const writes = new Map();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function getCardSettingsTarget(ctx) {
  // ST getContext() returns a snapshot of characterId. UI listeners outlive it.
  // Use the current host context only when it belongs to the same settings root.
  const live = getHostContext();
  if (live && ctx?.extensionSettings && live.extensionSettings === ctx.extensionSettings) ctx = live;
  if (ctx?.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '') return null;
  const rawId = ctx?.characterId;
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const id = Number(rawId);
  const card = Number.isInteger(id) && id >= 0 ? ctx?.characters?.[id] : null;
  return card ? { id, card, context: ctx } : null;
}

function sanitizeOverrideMap(value, normalize, sanitize) {
  const typed = Object.create(null);
  if (!object(value)) return {};
  for (const [name, profile] of Object.entries(value).slice(0, 500)) {
    if (!safeKey(name) || !object(profile)) continue;
    const fields = {};
    for (const [key, field] of Object.entries(profile)) {
      if (!safeKey(key)) continue;
      if (typeof field === 'number' && Number.isFinite(field)) fields[key] = field;
      else if (typeof field === 'string') fields[key] = field.slice(0, 4000);
      else if (key === 'genderRatio' && field === null) fields[key] = null;
    }
    typed[name] = fields;
  }
  const result = {};
  for (const [name, profile] of Object.entries(normalize(typed))) {
    if (!safeKey(name)) continue;
    // Numeric strings are not trusted card numbers; sanitize reuses the runtime bounds.
    for (const key of Object.keys(profile)) {
      if (typeof profile[key] === 'string' && !['introductionLine', 'fluxDefinition', 'inheritanceMode', 'embryoType'].includes(key)) delete profile[key];
    }
    const patch = sanitize(profile);
    if (patch) result[name] = patch;
  }
  return result;
}

export function sanitizeCardSettings(value) {
  if (!object(value) || value.version !== CARD_SETTINGS_VERSION) return null;
  const result = { version: CARD_SETTINGS_VERSION };
  for (const [key, normalize, sanitize] of [
    ['racePhysiologyOverrides', normalizeRaceOverrideMap, sanitizeRacePhysiologyProfilePatch],
    ['derivedTypeOverrides', normalizeDerivedOverrideMap, sanitizeDerivedTypeProfilePatch],
  ]) {
    const map = sanitizeOverrideMap(value[key], normalize, sanitize);
    if (Object.keys(map).length) result[key] = map;
  }
  if (object(value.raceCatalogSelection) && Array.isArray(value.raceCatalogSelection.races) && Array.isArray(value.raceCatalogSelection.derivedTypes)) {
    const names = list => [...new Set(list.filter(item => typeof item === 'string').map(item => text(item, 80)).filter(Boolean))].slice(0, 500);
    result.raceCatalogSelection = { races: names(value.raceCatalogSelection.races), derivedTypes: names(value.raceCatalogSelection.derivedTypes) };
    // 版本标记决定人类是否需要按旧规则补回，见 normalizeRaceCatalogSelection
    if (value.raceCatalogSelection.version === RACE_CATALOG_SELECTION_VERSION) result.raceCatalogSelection.version = RACE_CATALOG_SELECTION_VERSION;
  }
  if (typeof value.worldBaselinePrompt === 'string') result.worldBaselinePrompt = text(value.worldBaselinePrompt, 12000);
  if (object(value.reproductiveSettings)) {
    const patch = {};
    const normalized = normalizeReproductiveSettings(value.reproductiveSettings);
    for (const key of CARD_REPRODUCTIVE_FIELDS) {
      if (typeof value.reproductiveSettings[key] === 'number' && Number.isFinite(value.reproductiveSettings[key])) patch[key] = normalized[key];
    }
    if (Object.keys(patch).length) result.reproductiveSettings = patch;
  }
  if (object(value.skills)) {
    const catalog = [];
    for (const entry of (Array.isArray(value.skills.catalog) ? value.skills.catalog : []).slice(0, 500)) {
      if (!object(entry) || typeof entry.name !== 'string' || typeof entry.description !== 'string') continue;
      const registered = registerSkillDefinition(catalog, { name: entry.name, description: entry.description });
      if (registered.created) catalog.push(registered.definition);
    }
    const skills = { catalog: catalog.map(({ name, description }) => ({ name, description })) };
    if (typeof value.skills.baselinePrompt === 'string') skills.baselinePrompt = text(value.skills.baselinePrompt, 4000);
    if (skills.catalog.length || own(skills, 'baselinePrompt')) result.skills = skills;
  }
  return result;
}

export function getCardSettings(ctx) {
  return sanitizeCardSettings(getCardSettingsTarget(ctx)?.card?.data?.extensions?.[CARD_SETTINGS_KEY]);
}

function mergeMaps(globalMap, cardMap) {
  const result = { ...globalMap };
  for (const [name, patch] of Object.entries(cardMap || {})) result[name] = { ...(result[name] || {}), ...patch };
  return result;
}

/** A derived view. Never persist this object as global settings. */
export function getEffectiveSettings(ctx, settings) {
  const card = getCardSettings(ctx);
  return {
    ...settings,
    // TT/Luker intentionally keep this non-enumerable on the persisted settings.
    // Preserve its reference in the derived view used by registry/tool consumers.
    chatStates: settings?.chatStates,
    racePhysiologyOverrides: mergeMaps(normalizeRaceOverrideMap(settings?.racePhysiologyOverrides), card?.racePhysiologyOverrides),
    derivedTypeOverrides: mergeMaps(normalizeDerivedOverrideMap(settings?.derivedTypeOverrides), card?.derivedTypeOverrides),
    raceCatalogSelection: card && own(card, 'raceCatalogSelection') ? card.raceCatalogSelection : settings?.raceCatalogSelection,
    worldBaselinePrompt: card && own(card, 'worldBaselinePrompt') ? card.worldBaselinePrompt : settings?.worldBaselinePrompt,
    reproductiveSettings: normalizeReproductiveSettings({ ...settings?.reproductiveSettings, ...card?.reproductiveSettings }),
  };
}

export function syncCardSettings(ctx, settings) {
  const effective = getEffectiveSettings(ctx, settings);
  setRacePhysiologyOverrides(effective.racePhysiologyOverrides);
  setDerivedTypeOverrides(effective.derivedTypeOverrides);
  return effective;
}

export function getSettingSource(ctx, settings, key, name, field) {
  const present = value => name === undefined ? (field === undefined ? value !== undefined : own(value, field)) : own(value?.[name], field);
  if (present(getCardSettings(ctx)?.[key])) return '卡片覆盖';
  if (present(settings?.[key])) return '全域覆盖';
  return '内置';
}

export function importCardSkillSeed(ctx, settings, chatState, { manual = false } = {}) {
  const skills = getCardSettings(ctx)?.skills;
  if (settings?.skillSystemEnabled === false || !skills) return { applied: false, created: 0 };
  const activeCtx = getCardSettingsTarget(ctx)?.context || ctx;
  if (!manual && !activeCtx?.chatId) {
    try { if (!activeCtx?.getCurrentChatId?.()) return { applied: false, created: 0 }; }
    catch { return { applied: false, created: 0 }; }
  }
  if (!manual && chatState.cardSkillSeedApplied === true) return { applied: false, created: 0 };
  if (!manual && (normalizeSkillCatalog(chatState.skillCatalog).length || String(chatState.skillBaselinePrompt || '').trim())) {
    chatState.cardSkillSeedApplied = true;
    return { applied: false, created: 0, processed: true };
  }
  let created = 0;
  for (const entry of skills.catalog) {
    const result = registerSkillDefinition(chatState.skillCatalog, entry, chatState.nextSkillId);
    chatState.skillCatalog = result.catalog;
    chatState.nextSkillId = result.nextSkillId;
    if (result.created) created++;
  }
  // Manual merging preserves an existing chat baseline, just as preset imports do.
  if (!String(chatState.skillBaselinePrompt || '').trim() && skills.baselinePrompt) chatState.skillBaselinePrompt = skills.baselinePrompt;
  chatState.cardSkillSeedApplied = true;
  return { applied: true, created };
}

export function exportCardSkillSeed(chatState) {
  return {
    catalog: normalizeSkillCatalog(chatState.skillCatalog).map(({ name, description }) => ({ name, description })),
    baselinePrompt: text(chatState.skillBaselinePrompt, 4000),
  };
}

export function canWriteCardSettings(ctx) {
  const target = getCardSettingsTarget(ctx);
  return Boolean(target && typeof target.context?.writeExtensionField === 'function');
}

// ST and TauriTavern deep-merge objects on disk. Tombstones prevent removed nested overrides
// from resurrecting after reload; Luker replaces the complete extension namespace.
function withDeletions(previous, next) {
  if (!object(previous) || !object(next)) return next;
  const result = { ...next };
  for (const [key, value] of Object.entries(previous)) {
    if (!safeKey(key)) continue;
    if (!own(next, key)) result[key] = UNSET_VALUE;
    else if (object(value) && object(next[key])) result[key] = withDeletions(value, next[key]);
  }
  return result;
}

function canonicalJson(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical)
    : object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return JSON.stringify(canonical(value));
}

/** Serializes card mutations, preserves sibling fields and checks persistence where supported. */
export async function updateCardSettings(ctx, patch) {
  const target = getCardSettingsTarget(ctx);
  if (!canWriteCardSettings(ctx)) throw new Error('当前宿主或聊天不支持写入角色卡。');
  ctx = target.context;
  const key = `${getHostKind()}:${target.card.avatar || target.id}`;
  const previousWrite = writes.get(key) || Promise.resolve();
  const task = previousWrite.catch(() => {}).then(async () => {
    if (getCardSettingsTarget(ctx)?.card !== target.card) throw new Error('角色已切换，请重新操作。');
    const previous = target.card.data?.extensions?.[CARD_SETTINGS_KEY];
    if (previous != null && (!object(previous) || previous.version !== CARD_SETTINGS_VERSION)) throw new Error('此卡的世界设定格式不受支持，未覆盖原资料。');
    const current = sanitizeCardSettings(previous) || { version: CARD_SETTINGS_VERSION };
    const next = { ...current };
    for (const [field, value] of Object.entries(typeof patch === 'function' ? patch(current) : patch)) {
      if (field === 'version' || !safeKey(field)) continue;
      if (value === undefined) delete next[field];
      else next[field] = value;
    }
    const clean = sanitizeCardSettings(next);
    const empty = Object.keys(clean).length === 1;
    const payload = empty ? UNSET_VALUE : (getHostKind() === 'luker' ? clean : withDeletions(previous, clean));
    const previousJson = target.card.json_data;
    try {
      await ctx.writeExtensionField(target.id, CARD_SETTINGS_KEY, payload);
      if (!empty && JSON.stringify(payload) !== JSON.stringify(clean)) {
        // Mirror canonical JSON into the native card editor as well. It must not
        // retain tombstones that could later be exported by a normal card save.
        await ctx.writeExtensionField(target.id, CARD_SETTINGS_KEY, clean);
      }
      // These native APIs log HTTP failures without rejecting. Re-read the stored
      // card before reporting success; never rely on their optimistic memory update.
      if (typeof ctx.getRequestHeaders === 'function' && target.card.avatar) {
        const response = await fetch('/api/characters/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: target.card.avatar }) });
        if (!response.ok) throw new Error('无法确认角色卡是否已保存。');
        const stored = await response.json();
        const actual = sanitizeCardSettings(stored.data?.extensions?.[CARD_SETTINGS_KEY]);
        if (canonicalJson(actual) !== canonicalJson(empty ? null : clean)) throw new Error('角色卡保存结果不一致，请重新加载后检查。');
      }
      target.card.data ||= {};
      const extensions = target.card.data.extensions ||= {};
      if (empty) delete extensions[CARD_SETTINGS_KEY];
      else extensions[CARD_SETTINGS_KEY] = clean;
      if (target.card.json_data) {
        const json = JSON.parse(target.card.json_data);
        if (empty) delete json.data.extensions[CARD_SETTINGS_KEY];
        else json.data.extensions[CARD_SETTINGS_KEY] = clean;
        target.card.json_data = JSON.stringify(json);
      }
      return empty ? null : clean;
    } catch (error) {
      if (target.card.data?.extensions) {
        if (previous === undefined) delete target.card.data.extensions[CARD_SETTINGS_KEY];
        else target.card.data.extensions[CARD_SETTINGS_KEY] = previous;
      }
      target.card.json_data = previousJson;
      throw error;
    }
  });
  writes.set(key, task);
  try { return await task; } finally { if (writes.get(key) === task) writes.delete(key); }
}
