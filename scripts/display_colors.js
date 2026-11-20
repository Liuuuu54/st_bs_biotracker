// 显示用的颜色（1.4.3）：孕体特写的肤色、乳头色，以及预留给特写头像的发色，存在角色变量 profile.display。
// 只给画面用，不送提示词，模型与工具也不会写它；null 表示照预设色表。

/** 肤色色票：由浅到深，第三个是预设色表的受光面 */
export const DISPLAY_SKIN_PRESETS = Object.freeze([
  Object.freeze({ color: '#f9e0cc', label: '白皙' }),
  Object.freeze({ color: '#f5cdb3', label: '白' }),
  Object.freeze({ color: '#efbba2', label: '预设' }),
  Object.freeze({ color: '#d9a07c', label: '小麦' }),
  Object.freeze({ color: '#b57a55', label: '褐' }),
  Object.freeze({ color: '#7e4e35', label: '深褐' }),
]);

/** 乳头色票：第二个是预设色表的乳晕基准 */
export const DISPLAY_NIPPLE_PRESETS = Object.freeze([
  Object.freeze({ color: '#eaa3a3', label: '粉' }),
  Object.freeze({ color: '#d4907f', label: '预设' }),
  Object.freeze({ color: '#b47a62', label: '浅褐' }),
  Object.freeze({ color: '#8a5540', label: '褐' }),
]);

/** #rgb、#rrggbb（大小写不拘）→ 小写 #rrggbb；其余一律 null */
export function normalizeDisplayColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`;
  return null;
}

export function normalizeDisplayColors(display) {
  const source = display && typeof display === 'object' && !Array.isArray(display) ? display : {};
  return {
    skinColor: normalizeDisplayColor(source.skinColor),
    nippleColor: normalizeDisplayColor(source.nippleColor),
    // 发色：预留给特写头像（还没做），先存着
    hairColor: normalizeDisplayColor(source.hairColor),
  };
}
