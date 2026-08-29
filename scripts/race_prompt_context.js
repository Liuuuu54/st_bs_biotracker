import { AMORPHOUS_RACES, DERIVED_TYPE_RACES, METOVIVIPAROUS_RACES, OVIPAROUS_RACES, OVOVIVIPAROUS_RACES, VIVIPAROUS_RACES, getDerivedTypeFluxProfile, getDerivedTypeIntroductionLine, getDerivedTypeMetabolismExemptions, getEmbryoTypeByRace, getMergedRacePhysiologyProfile, getRaceComponents, getRaceDescriptorComponents, getRaceIntroductionLine, getRacePhysiologyProfile } from './race_config.js';

/**
 * 提示词插值防线：剥离换行、闭合标签与控制字符——race/derivedType 等用户可控字符串
 * 直接拼进高优先级规则段，含换行或闭合标签可截断段落注入伪指令。
 * 只影响显示，不改语义（种族名本身不含换行才是合法）。
 */
function sanitizePromptText(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/<\//g, '<\\/')
    // C0 + DEL + C1 控制区（含 NEL U+0085）
    .replace(/[\u0000-\u001f\u007f\u0080-\u009f]/g, ' ')
    .trim();
}

const RACE_CATALOG_GROUPS = Object.freeze([
  ['胎生', VIVIPAROUS_RACES],
  ['卵生', OVIPAROUS_RACES],
  ['卵胎生', OVOVIVIPAROUS_RACES],
  ['胎转卵生', METOVIVIPAROUS_RACES],
  ['不定型', AMORPHOUS_RACES],
]);

/**
 * 从短敘述里取一句极短的辨识提示：按逗号逐句累积到长度上限，
 * 且至少收到一句中文（短敘述多以英文原名开头，只有英文时信息量不足）。
 * 目的是让模型在名录阶段就能分辨形近种族（人鱼／鱼人、精灵／妖精），
 * 完整介绍仍由 buildSingleRacePhysiologyBlock 在该族真正登场时给出。
 */
function buildRaceCatalogHint(text) {
  const line = sanitizePromptText(text);
  if (!line) return '';
  const clauses = line.split(/[；。]/)[0].split('，').map((part) => part.trim()).filter(Boolean);
  const picked = [];
  for (const clause of clauses) {
    // 长度上限只在已经收到中文之后才生效——只有英文原名的提示没有辨识价值，
    // 不能因为下一句中文超出预算就把它挡在外面
    const hasChinese = /[一-龥]/.test(picked.join('，'));
    if (picked.length > 0 && hasChinese && [...picked, clause].join('，').length > 28) break;
    picked.push(clause);
    const current = picked.join('，');
    if (current.length >= 10 && /[一-龥]/.test(current)) break;
  }
  return picked.join('，');
}

/**
 * 种族名录：模型在写 base.race 或 bsAddSperm.race 时唯一的词汇表来源。
 * 没有它模型只能凭空造名，而自创种族查不到生理参数、会静默走预设值。
 * withHints=false 只有名字，约 350 token，适合每轮都发的追踪请求；
 * withHints=true 附极短辨识提示，适合一次性的注册请求。
 */
export function buildRaceCatalogBlock({ withHints = false } = {}) {
  const groupLines = RACE_CATALOG_GROUPS.map(([label, races]) => {
    const names = races.map((race) => {
      const hint = withHints ? buildRaceCatalogHint(getRaceIntroductionLine(race)) : '';
      return hint ? `${race}(${hint})` : race;
    });
    return `- ${label}: ${names.join('、')}`;
  });
  return [
    '[可用种族名录]',
    '以下是系统内建的种族，写 base.race、fatherRace、bsAddSperm.race 时应优先从中选择。',
    ...groupLines,
    `- 衍生类型（写作 [类型]种族，如 [血族]人类）: ${DERIVED_TYPE_RACES.map((type) => {
      const hint = withHints ? buildRaceCatalogHint(getDerivedTypeIntroductionLine(type)) : '';
      return hint ? `${type}(${hint})` : type;
    }).join('、')}`,
    '名录外的形象请就近归入最相似的一项（例如鲸鱼娘归入空鲸或鱼人），不要自创种族名——自创名称在系统内查不到生理参数。',
    '混血以 x 分隔，装饰子项以 - 附加，例如 兽耳族-兔x精灵-木。',
  ].join('\n');
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  const rounded = Number(num.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatCycleDays(ratio) {
  const days = Math.round(28 * Number(ratio || 1));
  return `${days}天左右`;
}

function formatYearMonthApprox(days) {
  const safeDays = Math.max(0, Math.round(Number(days) || 0));
  const totalMonths = Math.max(1, Math.round(safeDays / 30.4));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years <= 0) return `${totalMonths}个月`;
  if (months <= 0) return `${years}年`;
  return `${years}年${months}个月`;
}

function formatGestation(value) {
  const speed = Number(value || 1);
  if (!Number.isFinite(speed) || speed <= 0) return '未知';
  const days = Math.round(280 / speed);
  if (days >= 365) return `${days}天左右（约${formatYearMonthApprox(days)}）`;
  const weeks = (days / 7).toFixed(1);
  return `${days}天左右（约${weeks}周）`;
}

function formatRecoveryDays(value) {
  const days = Math.round(Number(value || 0));
  if (!Number.isFinite(days)) return '未知';
  if (days >= 365) return `${days}天左右（约${formatYearMonthApprox(days)}）`;
  if (days >= 14) return `${days}天左右（约${formatNumber(days / 7, 1)}周）`;
  return `${days}天左右`;
}

function getBirthDifficultyText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  if (num <= 0.5) return '偏容易，产道适应与排出过程通常较顺。';
  if (num <= 0.9) return '略低于常规难度，整体偏顺产。';
  if (num <= 1.25) return '常规难度，需看胎位与当下状态。';
  if (num <= 2) return '偏困难，较容易出现产程阻滞或额外负担。';
  if (num <= 4) return '高难度，难产风险明显偏高。';
  return '极高难度，通常属于非常危险或非常罕见的分娩体系。';
}

function getBreedToleranceText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  if (num <= 0.2) return '承载能力极低，属于早产入袋一类的繁殖策略；孕期会被胎儿严重拖垮，几乎无法维持日常活动。';
  if (num <= 0.6) return '承载能力偏低，孕期负担沉重，容易虚弱、阻滞与不适，行动力明显下降。';
  if (num <= 1.25) return '常规承载力，孕期会切实感到负担，接近人类标准。';
  if (num <= 3) return '承载能力偏高，孕期负担较轻，日常活动大致不受影响。';
  if (num <= 8) return '承载能力很高，妊娠几乎不削弱她；照常行动、劳作乃至战斗都在能力范围内。';
  return '承载能力极高，妊娠对身体近乎无负担，行动力与常态无异。';
}

function getImpregnationDifficultyText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  if (num <= 0.33) return '极易受精，受孕门槛很低。';
  if (num <= 0.75) return '较易受精，成功受孕概率偏高。';
  if (num <= 1.25) return '受精难度中等，接近常规物种标准。';
  if (num <= 2.5) return '受精难度偏高，需要更合适的条件才容易着床。';
  if (num <= 4) return '受精难度很高，同族内尚可尝试，跨物种受孕会明显变难。';
  if (num <= 6) return '受精难度极高，基本只在同族或高度相容的对象之间较有机会成功。';
  return '受精难度近乎封闭，基本限制同族；跨物种受孕通常可视为极难甚至接近不可能。';
}

function getProlificacyText(orgasmOvulationAmount, identicalProbability) {
  const ovulation = Number(orgasmOvulationAmount);
  const identical = Number(identicalProbability);
  if (!Number.isFinite(ovulation) && !Number.isFinite(identical)) return '未知';
  const safeOvulation = Number.isFinite(ovulation) ? ovulation : 1;
  const safeIdentical = Number.isFinite(identical) ? identical : 0;
  const twinScore = safeOvulation * 10 + safeIdentical;
  let overall = '极低';
  let summary = '通常以单胎为绝对主流，多胎属于少见情况。';
  if (twinScore >= 80) {
    overall = '极高';
    summary = '多胎妊娠应视为高概率事件，异卵与同卵扩增都相当活跃。';
  } else if (twinScore >= 50) {
    overall = '偏高';
    summary = '具备明显多胎倾向，异卵多胎常见，且存在稳定的同卵扩增机会。';
  } else if (twinScore >= 25) {
    overall = '中高';
    summary = '单胎与多胎都较常见，双胎或更多胎的概率明显高于常规种族。';
  } else if (twinScore >= 10) {
    overall = '中等';
    summary = '仍以单胎为主，但已具备可感知的双胎倾向。';
  } else if (twinScore >= 5) {
    overall = '偏低';
    summary = '大多仍是单胎，偶尔会出现双胎。';
  }

  let ovulationText = '异卵多胎倾向未知';
  if (safeOvulation <= 0) ovulationText = '异卵倾向很低，几乎不具备额外排卵能力。';
  else if (safeOvulation <= 1) ovulationText = '异卵倾向偏低，额外排卵能力较弱。';
  else if (safeOvulation <= 3) ovulationText = '异卵倾向中等，存在形成多枚受精卵并行发育的可能。';
  else if (safeOvulation <= 6) ovulationText = '异卵倾向偏高，较容易形成多枚受精卵并行发育。';
  else ovulationText = '异卵倾向极高，多枚卵同时参与受精是常见风险。';

  let identicalText = '同卵倾向未知';
  if (safeIdentical <= 5) identicalText = '同卵分裂倾向很低，由单胎扩增出的同卵多胎较少见。';
  else if (safeIdentical <= 20) identicalText = '同卵分裂倾向偏低到中等，存在由单胎扩增为同卵双胎的机会。';
  else if (safeIdentical <= 50) identicalText = '同卵分裂倾向明显，受精后继续分裂形成同卵多胎并不罕见。';
  else identicalText = '同卵分裂倾向很高，单一受精卵扩增成复数胎儿的概率相当显著。';

  return `${overall}。${summary} ${ovulationText} ${identicalText}`;
}

function getGenderRatioText(value) {
  if (value === null) return '雌雄同体或双性体系，不适用传统男女比。';
  if (value === -1) return '无性或非传统二元性别体系，不适用传统男女比。';
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  if (num === 50) return '性别比接近 1:1。';
  if (num > 50) return `后代偏雄性，约 ${Math.round(num)}% 为雄性。`;
  return `后代偏雌性，约 ${Math.round(100 - num)}% 为雌性。`;
}

function isSameRaceGroup(leftRace, rightRace) {
  const left = getRaceComponents(leftRace).sort();
  const right = getRaceComponents(rightRace).sort();
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function deriveFetusRace(motherRace, fatherRace) {
  const motherParts = getRaceDescriptorComponents(motherRace);
  const fatherParts = getRaceDescriptorComponents(fatherRace);
  const combined = [...fatherParts, ...motherParts].filter(Boolean);
  if (combined.length === 0) return '人类';
  const unique = [];
  for (const part of combined) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join('x');
}

function getGenderRatioDisplay(value) {
  if (value === null) return '双性';
  if (value === -1) return '无性';
  const num = Number(value);
  if (!Number.isFinite(num)) return '未知';
  if (num === 0) return '男女比 0:100（全女性倾向）';
  if (num === 100) return '男女比 100:0（全男性倾向）';
  return `男女比 ${Math.round(num)}:${Math.round(100 - num)}`;
}

function getEmbryoRecoveryCoefficient(embryoType) {
  switch (String(embryoType || '胎生')) {
    case '卵生':
      return 0.6;
    case '卵胎生':
      return 0.4;
    case '胎转卵生':
      return 1.0;
    case '不定型':
      return 0.8;
    case '胎生':
    default:
      return 0.2;
  }
}

function describeShift(nextValue, baseValue, formatter = (value) => String(value)) {
  const next = Number(nextValue);
  const base = Number(baseValue);
  if (!Number.isFinite(next) || !Number.isFinite(base)) return `${formatter(nextValue)}（基准 ${formatter(baseValue)}）`;
  const delta = next - base;
  if (Math.abs(delta) < 0.0001) return `${formatter(next)}（与基准持平）`;
  const direction = delta > 0 ? '上升' : '下降';
  return `${formatter(next)}（相较基准 ${direction} ${formatNumber(Math.abs(delta))}）`;
}

function buildSingleRacePhysiologyBlock(race) {
  const profile = getRacePhysiologyProfile(race);
  if (!profile) return '';
  const introductionLine = getRaceIntroductionLine(race);
  return [
    `【${sanitizePromptText(race)}】`,
    introductionLine ? `- 物种短敘述: ${introductionLine}` : '',
    `- 经期长度: ${formatCycleDays(profile.menstrualLengthRatio)}`,
    `- 妊娠长度: ${formatGestation(profile.gestationSpeciesSpeed)}`,
    `- 产后恢复时间: ${formatRecoveryDays(profile.recoveryDays)}`,
    `- 分娩难度: ${getBirthDifficultyText(profile.birthDifficulty)}`,
    `- 承载耐受: ${getBreedToleranceText(profile.breedTolerance)}（数值 ${formatNumber(profile.breedTolerance)}；越高则孕期越不被削弱）`,
    `- 受精难度: ${getImpregnationDifficultyText(profile.impregnationDifficulty)}`,
    `- 多产性: ${getProlificacyText(profile.orgasmOvulationAmount, profile.identicalProbability)}；额外排卵倾向 ${formatNumber(profile.orgasmOvulationAmount)}，同卵多胎概率 ${formatNumber(profile.identicalProbability)}%`,
    `- 性别比: ${getGenderRatioText(profile.genderRatio)}`,
  ].filter(Boolean).join('\n');
}

export function buildSingleRacePhysiologyText(race) {
  return buildSingleRacePhysiologyBlock(race);
}

function buildHybridAverageBlock(race) {
  const merged = getMergedRacePhysiologyProfile(race);
  if (!merged) return '';
  return [
    '【混血平均参考】',
    '- 以下是系统层面的平均参考值，仅供综合判断；不要用它覆盖各族原始特征。',
    merged.hasUnknownRace ? '- 注意：该混血包含未收录种族，以下平均数值不完整，仅供粗略参考。' : '',
    `- 平均经期长度: ${formatCycleDays(merged.menstrualLengthRatio)}`,
    `- 平均妊娠长度: ${formatGestation(merged.gestationSpeciesSpeed)}`,
    `- 平均产后恢复时间: ${formatRecoveryDays(merged.recoveryDays)}`,
    `- 平均分娩难度: ${getBirthDifficultyText(merged.birthDifficulty)}`,
    `- 平均承载耐受: ${getBreedToleranceText(merged.breedTolerance)}`,
    `- 平均受精难度: ${getImpregnationDifficultyText(merged.impregnationDifficulty)}`,
    `- 平均多产性参考: ${getProlificacyText(merged.orgasmOvulationAmount, merged.identicalProbability)}；额外排卵倾向 ${formatNumber(merged.orgasmOvulationAmount)}，同卵多胎概率 ${formatNumber(merged.identicalProbability)}%`,
    `- 平均性别比参考: ${getGenderRatioText(merged.genderRatio)}`,
  ].filter(Boolean).join('\n');
}

function buildRacePhysiologyLoreBlock(race) {
  const value = String(race || '').trim();
  if (!value) return '';
  const components = getRaceComponents(value);
  if (components.length === 0) return '';
  if (components.length === 1) return [`[种族生理补充设定]`, buildSingleRacePhysiologyBlock(components[0])].join('\n');
  return [
    '[种族生理补充设定]',
    `该角色为混血/复合种族：${components.map(sanitizePromptText).join(' x ')}`,
    '请同时理解各族生理参数，不要把混血直接脑补成单一物种。',
    ...components.map((part) => buildSingleRacePhysiologyBlock(part)).filter(Boolean),
    buildHybridAverageBlock(value),
  ].join('\n\n');
}

function buildDerivedFluxLoreBlock(derivedType) {
  const value = String(derivedType || '').trim();
  if (!value) return '';
  const fluxProfile = getDerivedTypeFluxProfile(value);
  const introductionLine = getDerivedTypeIntroductionLine(value);
  const fluxDefinition = String(fluxProfile?.fluxDefinition || '').trim();
  if (!fluxDefinition) return '';
  const exemptions = getDerivedTypeMetabolismExemptions(value);
  return [
    '[衍生需求补充设定]',
    `【${sanitizePromptText(value)}】`,
    ...(introductionLine ? [introductionLine] : []),
    `该衍生类型由 flux 抵免的普通需求：${exemptions.length > 0 ? exemptions.join(' / ') : '无'}。未被抵免的需求仍会作为 metabolism 保留。`,
    fluxDefinition,
  ].join('\n');
}

function buildSpermCalculationBlock(characterState) {
  const profile = characterState?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const sperms = Array.isArray(base.sperms) ? base.sperms : [];
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const stage = String(base.stage || '');
  const fertilizationDays = Number(base.fertilizationDays || 0);
  const hasPregnancyState = fetuses.length > 0 || fertilizationDays > 0 || ['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '第一产程', '第二产程', '第三产程', '假孕期'].includes(stage);
  if (hasPregnancyState) return '';

  const motherRace = String(base.race || '').trim();
  if (!motherRace) return '';
  const motherProfile = getMergedRacePhysiologyProfile(motherRace) || {};
  const motherDifficulty = Number(motherProfile?.impregnationDifficulty);
  const motherEmbryoType = getEmbryoTypeByRace(motherRace);
  const heteroSperms = sperms.filter((sperm) => {
    const race = String(sperm?.race || '').trim();
    return race && !isSameRaceGroup(motherRace, race);
  });
  if (heteroSperms.length === 0) return '';

  const lines = [
    '[异种精液受精补充设定]',
    '以下为系统在非怀孕状态下处理异种精液时使用的简化判断逻辑，请据此理解该角色当前的受孕难度与后代性别倾向。',
    `- 母体种族: ${sanitizePromptText(motherRace)}`,
    `- 母体受精难度: ${formatNumber(motherDifficulty)} (${getImpregnationDifficultyText(motherDifficulty)})`,
    `- 母体胚胎类型: ${motherEmbryoType}`,
  ];

  heteroSperms.forEach((sperm, index) => {
    const fatherRace = String(sperm?.race || '').trim();
    const fatherProfile = getMergedRacePhysiologyProfile(fatherRace) || {};
    const fatherDifficulty = Number(fatherProfile?.impregnationDifficulty);
    const fatherEmbryoType = getEmbryoTypeByRace(fatherRace);
    let effectiveDifficulty = (Number.isFinite(motherDifficulty) ? motherDifficulty : 1.0) + (Number.isFinite(fatherDifficulty) ? fatherDifficulty : 1.0);
    if (motherEmbryoType !== fatherEmbryoType) effectiveDifficulty *= 1.5;
    const fetusRace = deriveFetusRace(motherRace, fatherRace);
    const fetusProfile = getMergedRacePhysiologyProfile(fetusRace) || {};
    const fetusGenderRatio = fetusProfile?.genderRatio;
    lines.push(
      [
        `【异种精液 ${index + 1}】`,
        `- 精方: ${sanitizePromptText(String(sperm?.male || '未知'))} / ${sanitizePromptText(fatherRace)}`,
        `- 精方受精难度: ${formatNumber(fatherDifficulty)} (${getImpregnationDifficultyText(fatherDifficulty)})`,
        `- 精方胚胎类型: ${fatherEmbryoType}`,
        `- 系统受精难度计算: 母体 ${formatNumber(motherDifficulty)} + 精方 ${formatNumber(fatherDifficulty)}${motherEmbryoType !== fatherEmbryoType ? `，且因胚胎类型不同（${motherEmbryoType} vs ${fatherEmbryoType}）再 ×1.5` : ''} = ${formatNumber(effectiveDifficulty)}`,
        `- 混合后胎儿种族: ${sanitizePromptText(fetusRace)}`,
        `- 系统性别比计算: 以后代种族 ${sanitizePromptText(fetusRace)} 的 genderRatio 为准，当前结果为 ${getGenderRatioDisplay(fetusGenderRatio)} (${getGenderRatioText(fetusGenderRatio)})`,
      ].join('\n'),
    );
  });

  return lines.join('\n\n');
}

function buildPregnancyShiftBlock(characterState) {
  const profile = characterState?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return '';

  const motherRace = String(base.race || '').trim();
  const motherProfile = getMergedRacePhysiologyProfile(motherRace);
  if (!motherRace || !motherProfile) return '';

  let totalWeight = 0;
  let gestationDaysAccumulator = 0;
  let birthAccumulator = 0;
  let recoveryAccumulator = 0;

  // 下面的累加与平均方式必须跟 tools.js 的妊娠偏移一致，否则提示词报的数值和实际推进对不上
  for (const fetus of fetuses) {
    const weight = Math.max(0.33, Math.min(3.0, Number(fetus?.weight) || 1.0));
    const raceProfile = getMergedRacePhysiologyProfile(fetus?.race) || {};
    totalWeight += weight;
    // 妊娠取「天数平均」：胎重只影响胎儿自己的发育天数，不参与族速平均
    const fetusGestationSpeed = Math.max(0.1, Math.min(20, Number(raceProfile?.gestationSpeciesSpeed) || 1.0));
    gestationDaysAccumulator += 280 / fetusGestationSpeed;
    // 分娩难度同样不按胎重加权
    birthAccumulator += Math.max(0.1, Math.min(100, Number(raceProfile?.birthDifficulty) || 1.0));
    recoveryAccumulator += weight * getEmbryoRecoveryCoefficient(fetus?.embryoType);
  }

  const fetusCount = Math.max(1, fetuses.length);
  const averageGestationDays = gestationDaysAccumulator / fetusCount;
  const averageGestation = averageGestationDays > 0 ? 280 / averageGestationDays : 1.0;
  const averageBirth = birthAccumulator / fetusCount;
  const averageRecoveryCoefficient = recoveryAccumulator / Math.max(totalWeight, 0.33);
  const fetusCountModifier = 1 + ((fetuses.length - 1) * 0.08);
  const toleranceCountModifier = Math.max(0.6, 1 - ((fetuses.length - 1) * 0.04));

  const baseGestationSpeciesSpeed = Math.max(0.1, Math.min(20, Number(motherProfile.gestationSpeciesSpeed) || 1.0));
  const baseBirthDifficulty = Math.max(0.1, Math.min(100, Number(motherProfile.birthDifficulty) || 1.0));
  const baseBreedTolerance = Math.max(0.1, Math.min(100, Number(motherProfile.breedTolerance) || 1.0));
  const baseRecoveryDays = Math.max(1, Math.round(Number(motherProfile.recoveryDays) || 56));

  // 妊娠速度与分娩难度完全由胎儿族决定，母体 base 不参与相乘（tools.js 同）；
  // 只有承载耐受是在母体 base 上做偏移
  const shiftedGestationSpeciesSpeed = Math.max(0.1, Math.min(20, averageGestation));
  const shiftedBirthDifficulty = Math.max(0.1, Math.min(100, averageBirth * fetusCountModifier));
  // 承载耐受只取母体自身 x 胎数修正（与 tools.js 同）：胎儿族的承载力不是母体的加成
  const shiftedBreedTolerance = Math.max(0.1, Math.min(100, baseBreedTolerance * toleranceCountModifier));
  // 恢复天数按「胚胎类型恢复系数 × (280/妊娠速度) × (分娩难度/承载耐受)」计算
  const shiftedRecoveryDays = Math.max(
    1,
    Math.round(Math.max(0.1, Math.min(2.0, averageRecoveryCoefficient)) * (280 / shiftedGestationSpeciesSpeed) * (shiftedBirthDifficulty / Math.max(shiftedBreedTolerance, 0.1))),
  );

  const gestationBaseDays = 280 / baseGestationSpeciesSpeed;
  const gestationShiftedDays = 280 / shiftedGestationSpeciesSpeed;
  const hasGestationShift = Math.abs(gestationShiftedDays - gestationBaseDays) >= 0.0001;
  const hasBirthShift = Math.abs(shiftedBirthDifficulty - baseBirthDifficulty) >= 0.0001;
  const hasRecoveryShift = Math.abs(shiftedRecoveryDays - baseRecoveryDays) >= 1;
  if (!hasGestationShift && !hasBirthShift && !hasRecoveryShift) return '';

  return [
    '[妊娠生理偏移补充设定]',
    '以下为系统在怀孕后依据胎儿种族、胚胎类型、胎数与胎重，对母体生理参数产生的偏移结果。',
    `- 母体种族: ${sanitizePromptText(motherRace)}`,
    `- 妊娠长度偏移: ${describeShift(gestationShiftedDays, gestationBaseDays, (value) => formatGestation(280 / value))}`,
    `- 分娩难度偏移: ${describeShift(shiftedBirthDifficulty, baseBirthDifficulty, (value) => `${formatNumber(value)}（${getBirthDifficultyText(value)}）`)}`,
    `- 承载耐受偏移: ${describeShift(shiftedBreedTolerance, baseBreedTolerance, (value) => `${formatNumber(value)}（${getBreedToleranceText(value)}）`)}`,
    `- 产后恢复时间偏移: ${describeShift(shiftedRecoveryDays, baseRecoveryDays, (value) => formatRecoveryDays(value))}`,
  ].join('\n');
}

function collectRelevantRaces(payload = {}, options = {}) {
  const includeExistingState = options.includeExistingState !== false;
  const includeCurrentCharacter = options.includeCurrentCharacter !== false;
  const found = [];
  const pushRace = (race) => {
    const value = String(race || '').trim();
    if (value && !found.includes(value)) found.push(value);
  };
  pushRace(payload?.declared_race);
  if (includeCurrentCharacter) {
    pushRace(payload?.current_character?.race);
    pushRace(payload?.current_character?.data?.race);
  }
  if (includeExistingState && payload?.existing_state && typeof payload.existing_state === 'object') {
    for (const item of Object.values(payload.existing_state)) {
      const profile = item?.profile || {};
      const base = profile.base || {};
      const pregnant = profile.pregnant || {};
      pushRace(base.race);
      for (const sperm of (Array.isArray(base.sperms) ? base.sperms : [])) pushRace(sperm?.race);
      for (const fetus of (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [])) {
        pushRace(fetus?.race);
        pushRace(fetus?.fatherRace);
      }
      for (const child of (Array.isArray(profile.children) ? profile.children : [])) pushRace(child?.race);
    }
  }
  return found;
}

function collectRelevantDerivedTypes(payload = {}, options = {}) {
  const includeExistingState = options.includeExistingState !== false;
  const includeCurrentCharacter = options.includeCurrentCharacter !== false;
  const found = [];
  const pushDerivedType = (derivedType) => {
    const value = String(derivedType || '').trim();
    if (value && !found.includes(value)) found.push(value);
  };
  if (includeCurrentCharacter) {
    pushDerivedType(payload?.current_character?.derivedType);
    pushDerivedType(payload?.current_character?.data?.derivedType);
  }
  if (includeExistingState && payload?.existing_state && typeof payload.existing_state === 'object') {
    for (const item of Object.values(payload.existing_state)) {
      const profile = item?.profile || {};
      const base = profile.base || {};
      const pregnant = profile.pregnant || {};
      pushDerivedType(base.derivedType);
      for (const sperm of (Array.isArray(base.sperms) ? base.sperms : [])) pushDerivedType(sperm?.derivedType);
      for (const fetus of (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [])) pushDerivedType(fetus?.fatherDerivedType);
      for (const child of (Array.isArray(profile.children) ? profile.children : [])) pushDerivedType(child?.derivedType);
    }
  }
  return found;
}

export function buildRacePhysiologyPrompt(payload = {}, { includeAllRelevant = true } = {}) {
  const races = collectRelevantRaces(payload, { includeExistingState: true, includeCurrentCharacter: false });
  const derivedTypes = collectRelevantDerivedTypes(payload, { includeExistingState: true, includeCurrentCharacter: false });
  const blocks = (includeAllRelevant ? races : races.slice(0, 1)).map((race) => buildRacePhysiologyLoreBlock(race)).filter(Boolean);
  const derivedBlocks = (includeAllRelevant ? derivedTypes : derivedTypes.slice(0, 1)).map((derivedType) => buildDerivedFluxLoreBlock(derivedType)).filter(Boolean);
  const spermBlocks = payload?.existing_state && typeof payload.existing_state === 'object'
    ? Object.values(payload.existing_state).map((item) => buildSpermCalculationBlock(item)).filter(Boolean)
    : [];
  const pregnancyBlocks = payload?.existing_state && typeof payload.existing_state === 'object'
    ? Object.values(payload.existing_state).map((item) => buildPregnancyShiftBlock(item)).filter(Boolean)
    : [];
  if (blocks.length === 0 && derivedBlocks.length === 0 && spermBlocks.length === 0 && pregnancyBlocks.length === 0) return '';
  return [
    '<bs_race>',
    '以下文本是项目内定义的种族生理设定，请视为高优先级规则。',
    '这些设定用于帮助你理解角色的经期长度、妊娠长度、恢复时间、分娩难度、受精难度、多产性与性别比。',
    ...blocks,
    ...derivedBlocks,
    ...spermBlocks,
    ...pregnancyBlocks,
    '</bs_race>',
  ].join('\n\n');
}

export function buildRegistryRacePhysiologyPrompt(payload = {}) {
  const races = collectRelevantRaces(payload, { includeExistingState: false, includeCurrentCharacter: false });
  const derivedTypes = collectRelevantDerivedTypes(payload, { includeExistingState: false, includeCurrentCharacter: false });
  const blocks = races.map((race) => buildRacePhysiologyLoreBlock(race)).filter(Boolean);
  const derivedBlocks = derivedTypes.map((derivedType) => buildDerivedFluxLoreBlock(derivedType)).filter(Boolean);
  if (blocks.length === 0 && derivedBlocks.length === 0) return '';
  return [
    '<bs_race>',
    '以下文本是本次注册目标角色专用的种族生理设定，请视为高优先级规则。',
    '注册时只参考当前目标角色相关种族，不要混入其他已注册角色的种族设定。',
    ...blocks,
    ...derivedBlocks,
    '</bs_race>',
  ].join('\n\n');
}
