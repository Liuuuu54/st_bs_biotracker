// 世界模式：「写实世界」只减少提示词（异种、衍生、血统、伴生卵等设定都不送），不改任何计算；
// 特殊妊娠工具各自有开关，写实世界也能单独开着某一项（例如秘传胎归）。

/** 设定键 → 工具名。预设全部开启，与旧版行为相同。 */
export const SPECIAL_TOOLS = Object.freeze({
  implantEmbryo: 'bsImplantEmbryo',
  wombReturn: 'bsWombReturn',
  extendPregnancy: 'bsExtendPregnancy',
  // 衍生转化是 bsRecordExperience 的 action=transform，不是独立工具：关掉时只拿掉那一段（见 tracker.js）
  transformDerivedType: 'bsRecordExperience:transform',
  // 身体转化（1.5.1 性转）：transform 的 body 参数；写实世界照样能用
  transformBody: 'bsRecordExperience:body',
});

export const SPECIAL_TOOL_LABELS = Object.freeze({
  implantEmbryo: '代孕／注卵',
  wombReturn: '胎归',
  extendPregnancy: '延产',
  transformDerivedType: '衍生转化',
  transformBody: '身体转化',
});

export function normalizeSpecialTools(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(SPECIAL_TOOLS).map((key) => [key, source[key] !== false]));
}

export function isRealisticWorld(settings) {
  return settings?.realisticWorld === true;
}

/** 被关掉的特殊工具名称 */
export function getDisabledSpecialToolNames(settings) {
  const tools = normalizeSpecialTools(settings?.specialTools);
  return Object.entries(SPECIAL_TOOLS).filter(([key]) => !tools[key]).map(([, name]) => name);
}
