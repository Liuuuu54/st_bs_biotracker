// 角色状态 → 外阴正面图（vulva_render.js）的参数（1.6.0）。纯函式，不碰 DOM，Node 测得到。
// 参数名照预览页的控件 id；没给的照 VULVA_DEFAULTS。
import { VULVA_DEFAULTS } from './vulva_render.js';
import { VULVA_RACE_PRESETS } from './vulva_race_presets.js';
import { getBaseRaceName, getCharacterOutletLayout, pickDominantRaceName } from './race_config.js';
import { toTraditionalName } from './race_names.js';
import { getSireQualityState, getSireRecord } from './sires.js';
import { getProlapseGrade } from './prolapse.js';
import { getExcretionUrgency, getLaborEffort, getLibidoCap, getPresentingAmnionDurability } from './tools.js';
import { getStageProgress } from './stage_progress.js';

// 预览页的基础色（没有种族肤色时）
const BASE_WALL = '#c85f78';
const BASE_WALL_LIGHT = '#ee9290';
const BASE_SHINE = '#ffd0a4';

/** 两色按比例混（同预览页的 mix，四舍五入每个通道） */
export function mixHex(from, to, fraction) {
  const channels = [1, 3, 5].map((index) => {
    const a = parseInt(from.slice(index, index + 2), 16);
    const b = parseInt(to.slice(index, index + 2), 16);
    return Math.round(a + (b - a) * fraction).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** 种族的外阴外观预设；混血取占比最大的那一族，子项照基种族，名录外的回传 null */
export function getVulvaRacePreset(race, bloodline = null) {
  const base = getBaseRaceName(pickDominantRaceName(race || '人类', bloodline) || race || '人类');
  return VULVA_RACE_PRESETS[toTraditionalName(base)] || VULVA_RACE_PRESETS[base] || null;
}

const PREGNANCY_LEVEL = { 孕早期: 1, 孕中期: 2 };
const LATE_STAGES = new Set(['孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '第一产程', '第二产程', '第三产程']);

/** 剑与鞘的差距（级，剑 − 鞘）→ 预览的尺寸差 −4…4 */
export function fitTierFromDiff(diff) {
  const value = Number(diff);
  if (!Number.isFinite(value)) return 0;
  const size = Math.abs(value);
  const tier = size < 0.5 ? 0 : size < 1.5 ? 1 : size < 2.5 ? 2 : size < 4 ? 3 : 4;
  return Math.sign(value) * tier;
}

/** 这个角色这一刻在别人身上插着（别的卵方的插入来源是她，而且不是 idle） */
function insertingInto(chatState, name) {
  return Object.entries(chatState?.characters || {}).find(([other, item]) => other !== name
    && String(item?.profile?.base?.penetrationSource || '').trim() === name
    && ['inserted', 'spent'].includes(item?.profile?.base?.penetrationState))?.[1] || null;
}

/**
 * 角色 → 外阴正面图的参数。character 是 chatState.characters[name]。
 * 只决定「现在长什么样」；插入、射精、拔出的动画由呼叫端照视觉提示另外 play。
 * options.womb 是子宫图的布局（computeUterusLayout），拿它的精液灌满／浸满，与子宫图一致。
 */
export function buildVulvaParams(chatState, name, character = chatState?.characters?.[name], options = {}) {
  const profile = character?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const display = profile.display || {};
  const params = { ...VULVA_DEFAULTS };

  // 种族外观
  const preset = getVulvaRacePreset(base.race, base.bloodline);
  if (preset) {
    const { skin, ovary, ovaryColor, overlay, highlight, ...fields } = preset;
    Object.assign(params, fields);
    params['race-preset'] = toTraditionalName(getBaseRaceName(pickDominantRaceName(base.race || '人类', base.bloodline) || base.race));
    if (skin) params.skin = skin;
    params['material-light'] = highlight || null;
  }
  // 肤色：外观子页自订的优先，其次种族，再其次预览的基础色；内侧底色、肛门色、材质反光照预览的推算
  const skin = isHex(display.skinColor) ? display.skinColor.toLowerCase() : (preset?.skin || null);
  if (skin) {
    params.skin = skin;
    params.tone = mixHex(skin, '#f7ddda', 0.43);
    params['anus-color'] = mixHex(skin, params.tone, 0.14);
  } else {
    params.skin = BASE_WALL;
    params.tone = BASE_WALL_LIGHT;
    params['anus-color'] = BASE_WALL;
  }
  // 外阴的两条外观拉杆（外观子页，1.6.0）：成熟度与外观痕迹，没设是 50
  for (const [key, field] of [['vulvaMaturity', 'visual-maturity'], ['vulvaTraces', 'visual-traces']]) {
    const value = Number(display[key]);
    if (display[key] !== null && display[key] !== undefined && Number.isFinite(value)) params[field] = String(Math.max(0, Math.min(100, Math.round(value))));
  }
  if (!params['material-light']) params['material-light'] = mixHex(params.tone, BASE_SHINE, 0.34);
  if (display.anusShape) params['anus-shape'] = display.anusShape;

  // 布局：外口布局（角色覆写＞种族）；扶她（同名精方档）在分离开口叠阴茎、管状变共管、泄殖腔是鞘内剑
  const sire = chatState?.sires && Object.prototype.hasOwnProperty.call(chatState.sires, name) ? getSireRecord(chatState, name) : null;
  const layout = getCharacterOutletLayout(base);
  params['human-sire'] = 'off';
  params['single-sire'] = 'off';
  params['sire-form'] = 'off';
  if (layout === 'separate') {
    params.layout = 'human';
    if (sire) params['human-sire'] = 'on';
  } else if (layout === 'cloaca') {
    params.layout = 'single';
    if (sire) params['single-sire'] = 'on';
  } else if (layout === 'tube') {
    params.layout = 'tube';
    if (sire) params['sire-form'] = 'dual';
  } else if (layout === 'penile') {
    params.layout = 'tube';
    params['sire-form'] = 'urethral';
  } else {
    params.layout = 'anal';
  }

  // 泄殖腔鞘内剑：被插入时收着、插别人时翻出、两者都有时受方优先
  const receiving = ['inserted', 'spent'].includes(base.penetrationState);
  const giving = Boolean(insertingInto(chatState, name));
  params['single-role'] = receiving && giving ? 'both' : receiving ? 'receiving' : giving ? 'giving' : 'idle';

  // 剑：同名精方档的偏移与外形，阴囊大小照档案精子品质、饱满度照存量
  if (sire) {
    params['sword-offset'] = String(Number(sire.swordOffset) || 0);
    params.swordTip = sire.swordTip || 'rounded';
    params.swordShaft = sire.swordShaft || 'smooth';
    params.swordKnot = sire.swordKnot ? 'on' : 'off';
    params.swordBarbs = sire.swordBarbs ? 'on' : 'off';
    params.swordTwin = sire.swordTwin ? 'on' : 'off';
    params.swordLock = sire.swordLock ? 'on' : 'off';
    params.swordScrotum = sire.swordScrotum === false ? 'hidden' : 'auto';
    params['sperm-quality'] = String(Math.max(-2, Math.min(2, Math.log2(Number(sire.spermQuality) || 1))));
    const reserve = getSireQualityState(chatState, name, { minutesPassed: Number(chatState?.minutesPassed) || 0 })?.reserve;
    params['sire-reserve'] = String(Math.round(Math.max(0, Math.min(1, Number.isFinite(reserve) ? reserve : 1)) * 100));
    // 她的剑锁在别人身上：球结鼓到最大
    const target = insertingInto(chatState, name);
    params['lock-phase'] = sire.swordLock && target?.profile?.base?.penetrationLocked === true ? 'locked' : 'idle';
  }
  // 双穴：这次是双剑同时插产道与肛门
  // 3P（1.6.0）：产道与肛门同时被插着（不同人），画面跟双剑双穴一样两边都撑开
  const analBusy = ['inserted', 'spent'].includes(base.analPenetration?.state);
  params.channel = base.penetrationChannel === 'both' || (analBusy && receiving) ? 'both' : 'vaginal';
  if (params.channel === 'both') params.swordTwin = 'on';

  // 孕期、性欲、需求、宫脱
  const stage = String(base.stage || '');
  params.pregnancy = String(PREGNANCY_LEVEL[stage] ?? (LATE_STAGES.has(stage) ? 3 : 0));
  const cap = Number(getLibidoCap(profile)) || 100;
  params.libido = String(Math.round(Math.max(0, Math.min(100, (Number(base.libido) || 0) * 100 / cap))));
  const urgency = getExcretionUrgency(profile);
  params.urine = String(urgency.urine);
  params.stool = String(urgency.stool);
  params.prolapse = String(Math.max(0, Math.min(4, getProlapseGrade(profile) || 0)));

  // 经产与产后回缩
  params.parity = String(Math.max(0, Math.min(3, Math.floor(Number(profile.experience?.naturalBirthExperience) || 0))));
  if (stage === '产后恢复') {
    const progress = getStageProgress(profile);
    const ratio = progress && Number(progress.max) > 0 ? Number(progress.value) / Number(progress.max) : 1;
    params.recovery = String(Math.round(Math.max(0, Math.min(1, ratio)) * 100));
  } else {
    params.recovery = '100';
  }

  // 产程：第二产程看最前面那一胎降到哪里（进入产道、着冠、先露部已出）；用力与疲劳
  if (stage === '第二产程') {
    const lowest = Math.max(0, ...(pregnant.fetuses || []).map((fetus) => Number(fetus?.descentStage) || 0));
    params.descent = String(Math.max(0, Math.min(3, lowest)));
    params.effort = getLaborEffort(pregnant, stage, pregnant.laborPhase) === 'rest' ? 'rest' : 'push';
    params.fatigue = String(Math.round(Math.max(0, Math.min(100, Number(pregnant.pushFatigue) || 0))));
  } else {
    params.descent = '0';
  }

  params.hymen = getHymenState(profile);
  // 插入中的体型契合（播契合动画时用）
  params.fit = String(fitTierFromDiff(base.penetrationFit?.diff));

  // 流出（会一直滴的那几种）：破水后羊水续流 ＞ 经血 ＞ 怀孕浸满 ＞ 灌满；一次性的（拔出、溢出、破水）由呼叫端照事件另播
  params.flow = getSteadyFlow(profile, options.womb);
  // 肛内残精：分开的肛门才看得到（泄殖腔、孕夫的肛门就是产道，照产道算）
  params['anal-residue'] = Number(base.analSemen) >= 1 && ['human', 'tube'].includes(params.layout) ? 'on' : 'off';
  return params;
}

/** 会一直滴的流出状态：water-flow／period／soaked／full／none */
export function getSteadyFlow(profile, womb = null) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const amnion = fetuses.length > 0 ? getPresentingAmnionDurability(pregnant) : null;
  if (amnion !== null && Number(amnion) <= 0) return 'water-flow';
  if (String(base.stage || '') === '月经期') return 'period';
  // 剑射精后锁住：精液排不出来，不往外滴（1.6.0）
  if (base.penetrationLocked === true) return 'none';
  if (womb?.semenSoaked) return 'soaked';
  if (womb?.semenFull) return 'full';
  return 'none';
}

// ── 主题配色（1.6.0）：照孕体特写的做法（belly_render.js 的 BELLY_THEME_MODES）──
// 全彩：写实肤色，只有背景与框角跟主题；半彩：写实肤色打上主题的色光（halfTint）；
// 单色：整张换成子宫图那条色带，不套种族与自订肤色（水墨、建构用深到浅的一条色带，水墨另做笔触）。
const VULVA_BASE_PALETTE = Object.freeze({
  background: '#1c1726', frame: '#47283d', cavityDeep: '#421d3d', cavity: '#672d51',
  wallDark: '#803b58', wall: '#c85f78', wallLight: '#ee9290', lining: '#f3a891', shine: '#ffd0a4',
});
const FLESH_KEYS = ['cavityDeep', 'cavity', 'wallDark', 'wall', 'wallLight', 'lining', 'shine'];
const COLOR_PARAMS = ['skin', 'tone', 'anus-color', 'material-light'];

/**
 * 子宫图的主题色表（getUterusPalette 的结果）→ 外阴图的基础色表与要改的颜色参数。
 * 回传 { palette, params(原参数) → 新参数, brush }；womb 没给就照预览的原色。
 */
export function buildVulvaTheme(womb, { theme = '', modes = {}, tint = null, rampThemes = new Set() } = {}) {
  if (!womb) return { palette: { ...VULVA_BASE_PALETTE }, recolor: (params) => params, brush: null };
  const mode = modes[theme] || 'half';
  const frame = womb.tick || womb.frame || womb.void || VULVA_BASE_PALETTE.frame;
  if (mode === 'full') {
    return { palette: { ...VULVA_BASE_PALETTE, background: womb.bg, frame }, recolor: (params) => params, brush: null };
  }
  if (mode === 'mono') {
    let flesh;
    if (rampThemes.has(theme)) {
      const dark = womb.ink || womb.wallDark;
      const light = womb.fetusLight || womb.shine;
      const at = (t) => mixHex(dark, light, t);
      flesh = { cavityDeep: at(0.05), cavity: at(0.2), wallDark: at(0.45), wall: at(0.62), wallLight: at(0.8), lining: at(0.88), shine: at(1) };
    } else {
      flesh = { cavityDeep: womb.cavityDeep, cavity: womb.cavity, wallDark: womb.wallDark, wall: womb.wall, wallLight: womb.wallLight,
        lining: mixHex(womb.wallLight, womb.shine, 0.35), shine: womb.shine };
    }
    const palette = { background: womb.bg, frame, ...flesh };
    const recolor = (params) => ({ ...params, skin: flesh.wall, tone: flesh.wallLight, 'anus-color': flesh.wall,
      'material-light': mixHex(flesh.wallLight, flesh.shine, 0.34) });
    return { palette, recolor, brush: womb.brush ? { paper: womb.bg, ink: womb.ink || flesh.cavityDeep } : null };
  }
  // 半彩：写实色打上主题色光
  const light = typeof tint === 'function' ? tint : (color) => color;
  const palette = { ...VULVA_BASE_PALETTE, background: womb.bg, frame };
  for (const key of FLESH_KEYS) palette[key] = light(VULVA_BASE_PALETTE[key]);
  const recolor = (params) => {
    const next = { ...params };
    for (const key of COLOR_PARAMS) if (isHex(next[key])) next[key] = light(next[key]);
    return next;
  };
  return { palette, recolor, brush: null };
}

/**
 * 子宫剖面的种族外观（1.6.0）：卵巢造型与底色、产道纹理、子宫叠色、材质反光（照种族表）。
 * 孕夫（肛门分娩）没有卵巢。回传给 computeUterusLayout 的 appearance；颜色再由页面照主题换。
 */
export function buildWombAppearance(character) {
  const base = character?.profile?.base || {};
  const preset = getVulvaRacePreset(base.race, base.bloodline);
  const anal = getCharacterOutletLayout(base) === 'anal';
  return {
    ovary: anal ? 'none' : (preset?.ovary || 'compact'),
    ovaryColor: preset?.ovaryColor || null,
    canalMaterial: preset?.['canal-material'] || 'folds',
    overlay: preset?.overlay || null,
    light: preset?.highlight || null,
  };
}

/**
 * 处女膜（1.6.0）：分离开口、泄殖腔与管状都画（人外娘也有）；孕夫的两种（肛门、阴茎分娩）不画。
 * experience.virginity 还是 null 就完整，有了初次对象就剩殘痕。回传 'intact'、'torn' 或 'none'。只是画面，没有机制。
 */
export function getHymenState(profile) {
  if (!['separate', 'cloaca', 'tube'].includes(getCharacterOutletLayout(profile?.base || {}))) return 'none';
  const first = profile?.experience?.virginity;
  return first === null || first === undefined || first === '' ? 'intact' : 'torn';
}

/** 插在她身上、射精后锁住的那位精方有没有根部球结（画锁住时入口要不要画球） */
export function getLockKnot(chatState, character) {
  const base = character?.profile?.base || {};
  if (base.penetrationLocked !== true) return false;
  const source = String(base.penetrationSource || '').trim();
  return Boolean(source && getSireRecord(chatState, source)?.swordKnot === true);
}
