function clampPsychValue(value) {
  if (value === null || value === undefined) return null;
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  return Math.max(0, Math.min(100, Math.round(next)));
}

export const PSY_STAGE_KEYS = Object.freeze(['0', '1_25', '26_50', '51_75', '76_100', '100_plus']);

export const PSY_MENS_FIELDS = Object.freeze({
  mastery: {
    definition: '个体对月经周期与生理征兆的感知与掌控力。数值越高，反应越从容且精准；数值低则表现为混乱与恐慌。',
    preview: '0(无知与空白) -> 1~25(混乱应对) -> 26~50(常规适应) -> 51~75(精准掌控) -> 76~100(身心一统) -> 100+(超感知觉)',
    stages: {
      0: {
        meaning: '无知与空白',
        performance: '完全不具备生理常识。初次遭遇出血时会极度惊恐，视为重伤、诅咒或走火入魔。无法采取任何护理行动。',
        breakthrough_condition: '需经历一次完整的经期循环，并由他人进行启蒙教育或自我观测记录，方可突破至 1+。',
      },
      '1_25': {
        meaning: '混乱应对',
        performance: '对周期毫无预期，常在不便时突然来潮。情绪受激素波动控制明显，表现为易怒、忧郁且无所适从。增加时，开始尝试记忆日子；减少时，会因压力而忽视身体信号。',
      },
      '26_50': {
        meaning: '常规适应',
        performance: '能大致预判日期，提前准备清洁物。能忍受不适并维持正常生活。增加时，对经前症状更敏感；减少时，表现为对身体管理的怠慢。',
      },
      '51_75': {
        meaning: '精准掌控',
        performance: '精通自身周期，能根据体征判断排卵期。会依据经期调整生活与修行强度。增加时，能预判经期长度；减少时，感知能力会变得迟钝。',
      },
      '76_100': {
        meaning: '身心一统',
        performance: '对生殖系统有绝对感知。能精准控制经期反应，甚至透过冥想或药理减轻痛苦。增加时，感知力向精神层面渗透。',
        transcend_condition: '当个体能闭眼内视、感应精气在子宫内运行的微小涨缩时，进入 100+ 状态。',
      },
      '100_plus': {
        meaning: '超感知觉',
        performance: '进入超自然掌控。能瞬间感应到受精卵着床的震动或精气结合的热量。对排卵的感知如同呼吸般自然，能精确操作受孕窗口。此阶段不会跌回100。',
      },
    },
  },
  desire: {
    definition: '个体对受孕、承接种子并孕育生命的渴望程度。数值越高，行为越具侵略性与繁殖本能。',
    preview: '0(绝对防御) -> 1~25(排斥与防范) -> 26~50(中性顺从) -> 51~75(积极求种) -> 76~100(受孕执迷) -> 100+(繁殖本能)',
    stages: {
      0: {
        meaning: '绝对防御',
        performance: '视怀孕为绝对灾难。交合时会采取极端防御，如强力避孕药、结界、物理阻隔。',
        breakthrough_condition: '需被深爱之人说服、遭受剧烈心理冲击、或被植入“受孕即救赎”的观念后，方可突破至 1+。',
      },
      '1_25': {
        meaning: '排斥与防范',
        performance: '虽有性生活但极度依赖防护，事后会立刻清理，对精气残留感到强烈不安。增加时，恐惧感下降；减少时，会因一次意外而更加神经质。',
      },
      '26_50': {
        meaning: '中性顺从',
        performance: '不主动追求亦不排斥，视其为自然的一部分。交合后随缘处理。增加时，开始好奇受孕的感觉；减少时，会偏向保守避孕。',
      },
      '51_75': {
        meaning: '积极求种',
        performance: '计较受孕机率，会引导对方进行无套行为，事后刻意维持姿势以确保吸收。增加时，对排卵期更有执念；减少时，热情会消退。',
      },
      '76_100': {
        meaning: '受孕执迷',
        performance: '将受孕视为唯一奖励。会偷偷破坏避孕手段、谎报安全期。甚至在交合时表现出近乎乞求的渴望。增加时，会尝试多种偏方；减少时，会产生焦虑。',
        transcend_condition: '当理智完全让位给繁衍本能，将“受孕”视为生命的最高宗教仪式时，进入 100+ 状态。',
      },
      '100_plus': {
        meaning: '繁殖本能',
        performance: '行为完全由繁殖欲望驱动。会主动服下增加受孕可能的药物、调整体质。在任何可能的时刻都尝试获取种子，行为带有强烈的生物本能色彩。此阶段不会跌回100。',
      },
    },
  },
  autonomy: {
    definition: '个体在性爱与权力关系中的自主性。高则支配、主导；低则被动、服从。',
    preview: '0(绝对木偶) -> 1~25(被动服从) -> 26~50(顺应配合) -> 51~75(主动索求) -> 76~100(支配女王) -> 100+(超越主宰)',
    stages: {
      0: {
        meaning: '绝对木偶',
        performance: '失去灵魂的空壳。身体虽有反应但意识缺席，任由摆布，无任何反抗或主动示爱。无痛觉与愉悦感的外部表达。',
        breakthrough_condition: '需经历剧烈的肉体觉醒、情感冲击或被赋予第一条“自我指令”后，方可突破至 1+。',
      },
      '1_25': {
        meaning: '被动服从',
        performance: '角色处于弱势或受压迫状态。多表现为屈辱、忍耐或消极配合。增加时，会出现微小的反抗；减少时，意志趋向崩溃。',
      },
      '26_50': {
        meaning: '顺应配合',
        performance: '正常的互动模式。听从对方指挥，会给予回馈，但不会主动开拓新领域。增加时，会尝试提出小要求；减少时，会变得更沉默。',
      },
      '51_75': {
        meaning: '主动索求',
        performance: '掌握节奏，主动挑逗或变换体位。明确表达自己的快感需求。增加时，表现出极高的探索欲；减少时，行为会变得保守。',
      },
      '76_100': {
        meaning: '支配女王',
        performance: '绝对主导。将对方视为服务自己的工具或奖励，掌控频率、深度与时间。增加时，掌控欲延伸至生活各层面。',
        transcend_condition: '当常规的交合已无法满足其精神掌控力，开始追求极端、非典型或神圣化的权力仪式时，进入 100+ 状态。',
      },
      '100_plus': {
        meaning: '超越主宰',
        performance: '常规性交已感无趣。开始设计复杂的权力游戏、追求更极端的感官刺激或灵魂控制。将性爱视为一场由其编导的宏大演出。此阶段不会跌回100。',
      },
    },
  },
});

export const PSY_MENS_BOOL_FIELDS = Object.freeze({});

export const PSY_PREG_FIELDS = Object.freeze({
  confidence: {
    definition: '对承担母职与养育孩子的信心，不代表产科知识、信息准确度或是否想再生。',
    preview: '无力面对 -> 缺乏信心 -> 谨慎尝试 -> 逐步笃定 -> 稳定自信 -> 超常笃定',
    stages: {
      '0': { meaning: '无力面对', performance: '认为自己难以承担养育责任；不因此推定她不知道怀孕或拒绝孩子。' },
      '1_25': { meaning: '缺乏信心', performance: '担心照料与生活安排，需要支持；具体焦虑依角色与经历判断。' },
      '26_50': { meaning: '谨慎尝试', performance: '对自己的能力仍有疑虑，可以寻求帮助并尝试准备。' },
      '51_75': { meaning: '逐步笃定', performance: '相信自己能逐步承担责任，也承认需要学习或协助。' },
      '76_100': { meaning: '稳定自信', performance: '对母职与养育安排有稳定信心，不等于掌握医疗技能。' },
      '100_plus': { meaning: '超常笃定', performance: '对养育使命有强烈笃定，具体表现依角色，不赋予诊断能力。' }
    },
  },
  bonding: {
    definition: '对本次妊娠的接纳与腹中生命的情感联结；接受、爱胎儿与享受孕态可不一致。',
    preview: '抗拒与疏离 -> 矛盾疏离 -> 责任式接纳 -> 建立联结 -> 珍惜与期待 -> 强烈投入',
    stages: {
      '0': { meaning: '抗拒与疏离', performance: '对本次妊娠抗拒或疏离，不因此推定未知怀孕、伤害胎儿或已决定终止。' },
      '1_25': { meaning: '矛盾疏离', performance: '情感投入较少或心情矛盾，原因与行为需有角色及事件依据。' },
      '26_50': { meaning: '责任式接纳', performance: '可以出于责任接纳，情感仍在形成；不自动等于决定留下孩子。' },
      '51_75': { meaning: '建立联结', performance: '逐渐建立情感联结，也可对孕态或父方保持复杂态度。' },
      '76_100': { meaning: '珍惜与期待', performance: '珍惜腹中生命并期待未来，不强制恋孕、延产或自我牺牲。' },
      '100_plus': { meaning: '强烈投入', performance: '投入非常强烈；具体表达与选择依剧情，不默认希望永远怀孕。' }
    },
  },
  stance: {
    definition: '对孕妇身份的社会展现倾向；分数不等于实际已告知谁。',
    preview: '极度隐蔽 -> 倾向隐瞒 -> 谨慎应对 -> 愿意分享 -> 公开展现 -> 强烈认同',
    stages: {
      '0': { meaning: '极度隐蔽', performance: '倾向隐藏孕态，具体措施需剧情支持；不是不知道怀孕。' },
      '1_25': { meaning: '倾向隐瞒', performance: '在社交中谨慎隐瞒，动机依处境，不由此推定母职信心低。' },
      '26_50': { meaning: '谨慎应对', performance: '对公开身份保持谨慎，可按对象与环境选择是否告知。' },
      '51_75': { meaning: '愿意分享', performance: '愿意向合适的人分享；实际公开对象仍需事件依据。' },
      '76_100': { meaning: '公开展现', performance: '愿意坦然展现孕妇身份，不等于对所有人公开。' },
      '100_plus': { meaning: '强烈认同', performance: '对孕妇身份有强烈社会认同，具体表达依角色而非固定特权行为。' }
    },
  }
});

export const PSY_PREG_BOOL_FIELDS = Object.freeze({});

export function resolvePsychStageKey(value) {
  if (value === null || value === undefined) return null;
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  if (next <= 0) return '0';
  if (next <= 25) return '1_25';
  if (next <= 50) return '26_50';
  if (next <= 75) return '51_75';
  if (next <= 100) return '76_100';
  return '100_plus';
}

export function buildPsychInterpret(fieldConfig, value, stageProfile = null) {
  const stageKey = resolvePsychStageKey(value);
  const customInterpret = stageProfile && typeof stageProfile === 'object'
    ? String(stageProfile[stageKey] || '').trim()
    : '';
  if (customInterpret) return customInterpret;
  if (!stageKey || !fieldConfig?.stages?.[stageKey]) return '';
  const stage = fieldConfig.stages[stageKey];
  return [stage.meaning, stage.performance, stage.breakthrough_condition, stage.transcend_condition]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function normalizePsychologyStageProfiles(value, { mensFields = PSY_MENS_FIELDS, pregFields = PSY_PREG_FIELDS } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  const groups = [
    ['mens', mensFields],
    ['preg', pregFields],
  ];
  for (const [groupKey, fieldConfig] of groups) {
    const sourceGroup = value[groupKey];
    if (!sourceGroup || typeof sourceGroup !== 'object' || Array.isArray(sourceGroup)) continue;
    const normalizedGroup = {};
    for (const field of Object.keys(fieldConfig || {})) {
      const sourceField = sourceGroup[field];
      if (!sourceField || typeof sourceField !== 'object' || Array.isArray(sourceField)) continue;
      const normalizedField = {};
      for (const stageKey of PSY_STAGE_KEYS) {
        const text = String(sourceField[stageKey] || '').trim();
        if (text) normalizedField[stageKey] = text;
      }
      if (Object.keys(normalizedField).length > 0) normalizedGroup[field] = normalizedField;
    }
    if (Object.keys(normalizedGroup).length > 0) result[groupKey] = normalizedGroup;
  }
  return result;
}

export function buildEmptyPsychologyGroup(fieldConfig, booleanFields = {}) {
  const result = {};
  for (const key of Object.keys(fieldConfig || {})) {
    result[`${key}_value`] = null;
    result[`${key}_interpret`] = '';
  }
  for (const key of Object.keys(booleanFields || {})) {
    result[key] = false;
  }
  return result;
}

export function normalizePsychologyGroup(value, fieldConfig, { includeDefaults = true, booleanFields = {}, stageProfiles = {} } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return includeDefaults ? buildEmptyPsychologyGroup(fieldConfig, booleanFields) : null;
  const result = includeDefaults ? buildEmptyPsychologyGroup(fieldConfig, booleanFields) : {};
  let changed = false;
  for (const key of Object.keys(fieldConfig || {})) {
    const rawValue = value[`${key}_value`] ?? value[key];
    if (rawValue === undefined) continue;
    changed = true;
    if (rawValue === null) {
      result[`${key}_value`] = null;
      result[`${key}_interpret`] = '';
      continue;
    }
    const nextValue = clampPsychValue(rawValue);
    if (nextValue === null) continue;
    result[`${key}_value`] = nextValue;
    result[`${key}_interpret`] = buildPsychInterpret(fieldConfig[key], nextValue, stageProfiles?.[key]);
  }
  for (const key of Object.keys(booleanFields || {})) {
    if (value[key] === undefined) continue;
    changed = true;
    result[key] = Boolean(value[key]);
  }
  if (!includeDefaults && !changed) return null;
  return result;
}
