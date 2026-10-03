import { getBloodlineInfo, parseRaceDescriptor } from './race_config.js';

export function createRacePaletteSelection(value = '') {
  const parsed = parseRaceDescriptor(value);
  const bloodline = parsed.race ? getBloodlineInfo(value).bloodline : {};
  const [selectedDerivedType = '', ...subtype] = String(parsed.derivedType || '').split('-');
  return { raceTags: Object.keys(bloodline), bloodline, selectedDerivedType, derivedSubtype: subtype.join('-') };
}

export function equalizeRacePalette(state) {
  const count = state.raceTags.length;
  state.bloodline = Object.fromEntries(state.raceTags.map(name => [name, 1 / count]));
}

export function appendRacePaletteTag(state, name) {
  if (!name || state.raceTags.includes(name)) return false;
  const previous = state.raceTags.length;
  const share = 1 / (previous + 1);
  state.bloodline ||= {};
  for (const tag of state.raceTags) state.bloodline[tag] *= 1 - share;
  state.raceTags.push(name);
  state.bloodline[name] = share;
  return true;
}

export function removeRacePaletteTag(state, index) {
  const name = state.raceTags[index];
  if (!name) return;
  state.raceTags.splice(index, 1);
  delete state.bloodline[name];
  const total = state.raceTags.reduce((sum, tag) => sum + state.bloodline[tag], 0);
  if (total > 0) for (const tag of state.raceTags) state.bloodline[tag] /= total;
  else equalizeRacePalette(state);
}

// Keep a full 100%; distribute the remainder in the other races' existing ratio.
export function setRacePalettePercent(state, index, rawPercent) {
  const name = state.raceTags[index];
  const percent = Number(rawPercent);
  if (!name || String(rawPercent).trim() === '' || !Number.isFinite(percent) || percent < 0 || percent > 100) return false;
  if (state.raceTags.length === 1) { state.bloodline[name] = 1; return true; }
  const others = state.raceTags.filter(tag => tag !== name);
  const previous = others.reduce((sum, tag) => sum + state.bloodline[tag], 0);
  const weight = percent / 100;
  for (const tag of others) state.bloodline[tag] = (1 - weight) * (previous > 0 ? state.bloodline[tag] / previous : 1 / others.length);
  state.bloodline[name] = weight;
  return true;
}

export function palettePercentText(weight) {
  // Decimal notation remains compatible with the race descriptor parser at small shares.
  const percent = weight * 100;
  return /e/i.test(String(percent)) ? percent.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : String(percent);
}

export function buildRacePaletteValue(state) {
  const races = state.raceTags.filter(tag => state.bloodline[tag] > 0);
  const derived = state.selectedDerivedType ? `${state.selectedDerivedType}${state.derivedSubtype ? '-' + state.derivedSubtype : ''}` : '';
  // 只选了衍生型、还没加种族时照旧写成 [衍生型]，让使用者接着补种族
  if (!races.length) return derived ? `[${derived}]` : '';
  const raceLabel = races.length === 1 ? races[0] : races.map(tag => `${tag}${palettePercentText(state.bloodline[tag])}%`).join('x');
  return derived ? `[${derived}]${raceLabel}` : raceLabel;
}
