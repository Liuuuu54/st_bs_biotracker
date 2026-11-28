// 显示用的外观（1.4.3）：孕体特写的肤色、乳头色、乳晕大小、肚脐、妊娠纹，存在角色变量 profile.display。
// 只给画面用，不送提示词，模型与工具也不会写它；null 表示照预设。

/** 肤色色票：人的肤色由浅到深（第三个是预设色表的受光面），之后是非人的惨白、墨黑与奇幻肤色 */
export const DISPLAY_SKIN_PRESETS = Object.freeze([
  Object.freeze({ color: '#f9e0cc', label: '白皙' }),
  Object.freeze({ color: '#f5cdb3', label: '白' }),
  Object.freeze({ color: '#efbba2', label: '预设' }),
  Object.freeze({ color: '#d9a07c', label: '小麦' }),
  Object.freeze({ color: '#b57a55', label: '褐' }),
  Object.freeze({ color: '#7e4e35', label: '深褐' }),
  // 非人的肤色：吸血鬼一般的惨白（偏冷、几乎没血色），与灰烬般的墨黑（偏冷的炭黑，不是褐）
  Object.freeze({ color: '#ebe7ee', label: '惨白' }),
  Object.freeze({ color: '#3a363e', label: '墨黑' }),
  // 奇幻肤色：魔红（恶魔、魅魔）、冰蓝（冰系、异星）、苔绿（哥布林、欧克）、妖粉（妖精）、灰紫（暗精灵）
  Object.freeze({ color: '#c0504a', label: '魔红' }),
  Object.freeze({ color: '#7fa6d6', label: '冰蓝' }),
  Object.freeze({ color: '#7fa35a', label: '苔绿' }),
  Object.freeze({ color: '#f0a8c8', label: '妖粉' }),
  Object.freeze({ color: '#7a7390', label: '灰紫' }),
]);

/** 乳头色票：第二个是预设色表的乳晕基准，后五个是人外的颜色 */
export const DISPLAY_NIPPLE_PRESETS = Object.freeze([
  Object.freeze({ color: '#eaa3a3', label: '粉' }),
  Object.freeze({ color: '#d4907f', label: '预设' }),
  Object.freeze({ color: '#b47a62', label: '浅褐' }),
  Object.freeze({ color: '#8a5540', label: '褐' }),
  // 人外：墨黑、深紫、靛蓝、苔绿、血红
  Object.freeze({ color: '#3d2c33', label: '墨黑' }),
  Object.freeze({ color: '#7a4a86', label: '深紫' }),
  Object.freeze({ color: '#4c64a6', label: '靛蓝' }),
  Object.freeze({ color: '#5a8048', label: '苔绿' }),
  Object.freeze({ color: '#b8323e', label: '血红' }),
]);

/** 乳晕与乳头的大小（一起缩放）：倍率 */
export const DISPLAY_NIPPLE_SIZES = Object.freeze([
  Object.freeze({ value: 0.75, label: '小' }),
  Object.freeze({ value: 1, label: '中' }),
  Object.freeze({ value: 1.3, label: '大' }),
  Object.freeze({ value: 1.6, label: '很大' }),
]);

/**
 * 肚脐（照她自己怎么被生出来，由玩家设；预设是一般的肚脐）：
 * pop 一般（孕晚期外凸）、innie 不外凸（一直是凹的，撑大只变平）、outie 天生外凸、faint 淡（卵黄囊留下的浅疤，龟、鸟一类）、none 没有
 */
export const DISPLAY_NAVELS = Object.freeze([
  Object.freeze({ value: 'pop', label: '一般（孕晚外凸）' }),
  Object.freeze({ value: 'innie', label: '不外凸' }),
  Object.freeze({ value: 'outie', label: '天生外凸' }),
  Object.freeze({ value: 'faint', label: '淡（卵黄疤）' }),
  Object.freeze({ value: 'none', label: '没有' }),
]);
export const DISPLAY_NAVEL_SIZES = Object.freeze([
  Object.freeze({ value: 'normal', label: '一般' }),
  Object.freeze({ value: 'large', label: '大' }),
]);

/** 育儿袋（1.6.0）：预设照种族（getPouchDefault），选回种族预设就存 null */
export const DISPLAY_POUCH = Object.freeze([
  Object.freeze({ value: 'on', label: '有' }),
  Object.freeze({ value: 'off', label: '没有' }),
]);

/**
 * 妊娠纹（预设关）。长在哪里因人而异，分两种：
 *   lower 下腹——沿腹下摺痕平行排开的细弧；navel 脐周——从肚脐往外放射、沿着脐中线两侧冒出来；both 两种都有。
 * 都照胎量长：红紫色的新纹，产后淡成银白色的旧纹。
 */
export const DISPLAY_STRETCH_MARKS = Object.freeze([
  Object.freeze({ value: 'off', label: '关' }),
  Object.freeze({ value: 'lower', label: '下腹' }),
  Object.freeze({ value: 'navel', label: '脐周' }),
  Object.freeze({ value: 'both', label: '两者都有' }),
]);

/** #rgb、#rrggbb（大小写不拘）→ 小写 #rrggbb；其余一律 null */
export function normalizeDisplayColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`;
  return null;
}

const pick = (list, value) => (list.some((item) => item.value === value) ? value : null);

/** profile.display 正规化：认不得的值一律 null（照预设），多余的栏位丢掉 */
export function normalizeDisplay(display) {
  const source = display && typeof display === 'object' && !Array.isArray(display) ? display : {};
  const size = Number(source.nippleSize);
  return {
    skinColor: normalizeDisplayColor(source.skinColor),
    nippleColor: normalizeDisplayColor(source.nippleColor),
    nippleSize: DISPLAY_NIPPLE_SIZES.some((item) => item.value === size) ? size : null,
    navel: pick(DISPLAY_NAVELS, source.navel),
    navelSize: pick(DISPLAY_NAVEL_SIZES, source.navelSize),
    // 1.4.3 开发中用过的 auto 当成下腹
    stretchMarks: pick(DISPLAY_STRETCH_MARKS, source.stretchMarks === 'auto' ? 'lower' : source.stretchMarks),
    pouch: pick(DISPLAY_POUCH, source.pouch),
  };
}
