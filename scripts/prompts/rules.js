// 送给模型的写作规则与提示文字集中在这里，方便逐节检阅。工具说明另在 prompts/tool_definitions.js。
//
// 各节：
//   一、追踪模型：系统提示、变量语义说明、追踪与主线提示词的组装、主线叙事提醒、格式化输出与重答指示
//   二、种族与胚胎设定：种族名录、种族生理、伴生卵、胚胎类型 lore
//   三、注册与心情推演：注册初始化、单侧心情推演、精方档案、特殊胎儿来历、初始技能、日记、一次注册附带项
//   四、衣柜：备装与起始着衣
//   五、描述范本与日记写作的预设
//   六、纪录摘要整理：胎儿事件堆与认知纪录压缩时的要点整理
//
// 不在这里的（程序执行结果，和逻辑绑在一起）：
//   - 工具执行后回给模型的系统通知（notify、advisory、工具回传讯息），在 tools.js 各工具里
//   - 手动改楼后的重追判断（edit_gate.js）：给决策接口的选项说明，按改动内容组句
//   - 追踪视角里数值换成的文字刻度（健康、亲密度等），在 tracker.js 的视角投影
import { PSY_MENS_BOOL_FIELDS, PSY_MENS_FIELDS, PSY_PREG_BOOL_FIELDS, PSY_PREG_FIELDS, PSY_STAGE_KEYS } from '../registry_psy_config.js';
import { BODY_SIZE_INDIVIDUAL, BODY_SIZE_LEVEL_NAMES, computePostpartumRecoveryDays, DERIVED_TYPE_RACES, deriveFetusAncestry, formatBloodline, getAllRaces, getCompanionEggsMeanByRace, getDerivedTypeFluxProfile, getDerivedTypeIntroductionLine, getDerivedTypeMetabolismExemptions, getEmbryoTypeByRace, getFetalBulkRatioByRace, getMergedRacePhysiologyProfile, getRaceComponents, getRaceGroupsByEmbryoType, getRaceInheritanceMode, getRaceIntroductionLine, getRacePhysiologyProfile, getRecoveryCoefficientByRace, isRaceInCatalogSelection, normalizeRaceCatalogSelection, RACE_BODY_PLAN_LABELS } from '../race_config.js';
import { deriveFetusTags, describeFetusTags } from '../fetus_tags.js';
import { GESTATION_SPEED_MAX, GESTATION_SPEED_MIN, LABOR_STAGES, MENSTRUAL_STAGES, PREGNANCY_STAGES } from '../stage_config.js';
import { parseDescriptionGuideFields, stripDescriptionGuideStars } from '../descriptions.js';
import { CROSS_RACE_DIFFICULTY_MULTIPLIER, EMBRYO_TYPE_MISMATCH_MULTIPLIER, calculateImplantationDays } from '../calculator.js';
import { isRealisticWorld } from '../world_mode.js';

// ═══ 一、追踪模型 ════════════════════════════════════════════════

export const DEFAULT_SYSTEM_PROMPT = [
  '你是 AIRP 角色生理状态追踪器的工具调度器。',
  '工具参数中的 female 指「孕育者」——被追踪的承载方，不限定性别；扶她、孕夫、雄性孕育系（如海马族）同样使用该字段。',
  '你要根据角色卡、最近对话、已有状态，决定这次应调用哪些工具更新状态。',
  '只输出 JSON，不要输出额外解释。',
  'JSON 结构必须是：',
  '{',
  '  "tool_calls": [',
  '    {',
  '      "name": "string",',
  '      "arguments": {}',
  '    }',
  '  ],',
  '  "character_checks": [',
  '    { "female": "string", "status": "no_change|updated|present|offscreen" }',
  '  ]',
  '}',
  'character_checks 是逐角色检查清单：必须对 tracked_females 中每名角色恰好输出一笔；只写本轮检查结论，不直接改变状态。真正更新仍必须用 tool_calls。',
  '可用工具会通过 available_tools 传入。只能调用其中存在的工具，参数名必须完全匹配。',
  '没有足够依据时，tool_calls 返回空数组。',
  '如果对话明确发生了时间流逝，优先调用 bsPassedTime。',
  '如果只是活力、情压、性欲、宫压波动，使用 bsUpdateCharacterStatus。',
  '心理数值随认知纪录变化：她因为某件事有了新的体会或态度时，用 bsRecordExperience（action=cognition）记下，并在 psychology 给变化程度；没有独立的心理工具。',
  '如果只是描述文字变化，使用 bsSetDescription。',
  '剧情中出现穿上、脱下、更衣、借穿、被脱除、淋湿更换、洗浴后重新着装等衣着变化时，必须用 bsChangeOutfit 同步当前穿着；只更新衣着描述文字而不换装是错误的。角色获得新长期衣物用 bsAddWardrobeItem，永久失去衣物用 bsRemoveWardrobeItem。',
  '可受孕生殖道的插入／精液沉积／拔出用 bsAddSperm 状态机；排出既有残留精液用 bsDrainSperm；缓解生理需求用 bsExcreteMetabolism。',
  '跨日、重大事件或 notify 提醒时，可用 bsWriteDiary 为角色追加主观日记。',
  '月经阶段、排卵期、假孕期切换用 bsSetMenstrualPhases；不要用它覆盖正在进行的受精、真妊娠或产程。',
  '剧情以特殊手段让逾期的妊娠延后不生用 bsExtendPregnancy（action=extend），结束延产用 action=induce；延产期间不能用 bsAbortion 或 bsChildbirth。',
  '流产用 bsAbortion；立即结束分娩用 bsChildbirth；角色在场状态变化用 bsSetCharacterPresence，参数必须为 female 和 isPresent（布尔值 true/false，不要使用 isHere）。角色明确回到当前场景、重新同行或参与当前互动时应设为 true；明确离开、失联或转为幕外时才设为 false。',
  '腹中胎儿受到伤害（喝酒、外伤、过劳、生病、诅咒）、得到照料（安胎药、产检、休养、祝福），或母胎之间亲近、疏离（母体安抚、胎教，胎儿回应或排斥）时，用 bsFetalEvent 记一件事；吃睡排泄等需求照料系统已自动计入胎儿健康，不要重复记。腹中两胎互踢、推挤、依偎用 bsAssistFetalPosition（action=sibling）。剧情明确出现人工胎位操作（转位、托高延后分娩、推送），或胎儿有意识地自己转身、缩回、往下钻时用 bsAssistFetalPosition（后者加 actor=fetus）。',
  '不要编造怀孕天数、胎数、流产、分娩或其他高影响事件。',
].join('\n');

const CONDOM_LEVEL_TEXT = {
  poor: '很不牢靠，经常破裂或失效',
  unreliable: '不太牢靠，时有破裂',
  reliable: '大致可靠，偶有意外',
  certain: '不会破裂，只有超过容量才会撑破',
};
const EMERGENCY_LEVEL_TEXT = {
  poor: '效果很差，多半无效',
  unreliable: '时灵时不灵',
  reliable: '多数有效，但不保证',
  certain: '及时使用必定有效',
};

/**
 * 百科的套子可靠度与事后避孕成功率换成分级描述；0 是本世界没有这种手段，主流与追踪都要知道。
 * 成败一律由系统结算：主流知道「很不牢靠」后曾在同一轮自己写出滑脱、漏出，追踪再照正文改记没戴套，
 * 可靠度抽签根本没发生；所以主流要等下一轮的结果，追踪照实记戴套。
 */
function buildContraceptionBlock(levels, forTracker) {
  if (!levels || typeof levels !== 'object') return '';
  const condom = levels.condom === 'none'
    ? `- 屏障式避孕（套子，或羊肠套、魔法屏障等等效手段）：本世界不存在，剧情不得出现${forTracker ? '；bsAddSperm 不得传 hasCondom=true' : ''}。`
    : CONDOM_LEVEL_TEXT[levels.condom] ? `- 屏障式避孕（套子或世界观中的等效手段）：${CONDOM_LEVEL_TEXT[levels.condom]}。${forTracker ? '正文写到戴着套就传 hasCondom=true，即使正文写了破裂、滑脱或漏出也照传，成败由系统结算，不要改记成没戴套。' : '这一次破没破由系统结算，下一轮才会告诉你；这一轮正文不要自己写破裂、滑脱或漏出，可以写担心。'}` : '';
  const emergency = levels.emergency === 'none'
    ? `- 事后避孕（避孕药，或药草、魔法等等效手段）：本世界不存在，剧情不得出现${forTracker ? '；不得调用 bsAbortion purpose=emergency' : ''}。`
    : EMERGENCY_LEVEL_TEXT[levels.emergency] ? `- 事后避孕（避孕药或世界观中的等效手段）：${EMERGENCY_LEVEL_TEXT[levels.emergency]}；越晚使用效果越差，着床后无效。${forTracker ? '' : '有没有效由系统结算，角色当下不会知道，正文不要写成已经确定。'}` : '';
  return condom || emergency ? ['[本世界的避孕手段]', condom, emergency].filter(Boolean).join('\n') : '';
}

/** 本轮 payload 里真的出现过的胎儿标签；没出现的标签不必浪费 token 去解释 */
function collectRelevantFetusTags(payload = {}) {
  const found = new Set();
  const state = payload?.existing_state;
  if (!state || typeof state !== 'object') return [];
  for (const [name, item] of Object.entries(state)) {
    const carrierName = item?.name || name;
    const profile = item?.profile || {};
    const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
    const children = Array.isArray(profile?.children) ? profile.children : [];
    for (const record of [...fetuses, ...children]) {
      for (const tag of deriveFetusTags(record, { carrierName })) found.add(tag);
    }
  }
  return [...found];
}

function collectRelevantFluxNames(payload = {}) {
  const found = [];
  const pushFluxName = (derivedType) => {
    const fluxName = String(getDerivedTypeFluxProfile(derivedType)?.fluxName || '').trim();
    if (fluxName && !found.includes(fluxName)) found.push(fluxName);
  };
  if (payload?.existing_state && typeof payload.existing_state === 'object') {
    for (const item of Object.values(payload.existing_state)) {
      const profile = item?.profile || {};
      const base = profile.base || {};
      const pregnant = profile.pregnant || {};
      if (!isOwnMetabolismHidden(profile)) pushFluxName(base.derivedType);
      for (const sperm of (Array.isArray(base.sperms) ? base.sperms : [])) pushFluxName(sperm?.derivedType);
      for (const fetus of (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [])) pushFluxName(fetus?.fatherDerivedType);
      for (const child of (Array.isArray(profile.children) ? profile.children : [])) pushFluxName(child?.derivedType);
    }
  }
  return found;
}

export const TRACKER_VARIABLE_GUIDE_PROMPT = [
  '以下是角色状态变量的语义说明，供你理解 existing_state 中的字段，不是要求你原样输出这些字段。',
  '',
  '[总结构]',
  '- skill_catalog 是当前聊天的全局技能图鉴；每项包含稳定 id、技能名 name 与唯一描述 description。角色、胎儿、孩子只用 skillId 引用它。',
  '- 每个角色结构为 name / initialized / profile。',
  '- profile 主要包含 base、pregnant、experience、psychology、skills、talents、children、metabolism、descriptions、diary、notify，必要时也会附带部分 bio 字段。',
  '- bio 与 immune 大多属于内部运行参数，tracker 默认不会完整发给你；但与剧情表达直接相关的少数 bio 字段可以发送。',
  '- 若角色带有 immune.metabolism=true，则 metabolism 与 blockage/acceleration/expansion 都不会发给你，需求照料也不影响胎儿健康，本人的衍生需求说明也不发，因为该角色不受代谢累积影响；不要为她调用 bsExcreteMetabolism。',
  '- 若角色带有 offscreen=true，表示该角色当前不在场，existing_state 只提供精简状态，不代表角色不存在。',
  '- 值为 null、空字串、空列表或空物件的字段一律省略，省略即代表「无」（例如没有 sperms、没有 children、derivedType 不存在）；outfit.mainItemId=null 表示衣着未记录；认知与心理的省略/null 表示未知，不等于未孕或 0。',
  '',
  '[base]',
  '- isHere: 是否在场。false 时角色仍会随时间推进，但幕外角色只发送少量状态给你。',
  '- stage: 当前阶段。可能是月经阶段（卵泡期、排卵期、黄体期、月经期、乏情期；乏情期是长周期物种月经后的静止期，不会自然排卵；子宫被灌满且至少八成是异种精液时，高潮可诱发排卵，受孕的胎儿较弱）、妊娠阶段、假孕期、回归期、产兆前驱、第一/第二/第三产程、产后恢复、无经期、未激活。',
  '- 回归期：胎内回归的过渡阶段，由 bsWombReturn 产生。此期间孕肚大小顶到上限、体内那一胎的胎重为上限 3.0，两者随 pregnant.wombReturn.remainingHours 归零而线性回落，之后自动转入孕早期。',
  '- 回归期不受子宫压力影响，不会自然流产；此期间呼叫 bsAbortion 代表回归者被消化吸收、并入承载者，而不是被排出。',
  '- pregnant.wombReturn: 回归期的进度，含 returner（回归者名）、totalHours、remainingHours。不在回归期时不出现。',
  '- days: 当前阶段已经过了多少天，使用 0 起算的 elapsed/progress 语义；进入新阶段时为 0，超过该阶段上限后才切换下一阶段。',
  '- fertilizationDays: 受精后、着床前已经过的天数；着床等待期以 6 天为基础，并随角色实际月经周期长度等比缩放。',
  '- latestSexDays: 距最近一次性行为经过的天数；超过一个周期后通常会失效。',
  '- penetrationState / penetrationSource 是当前可受孕生殖道的插入状态与来源；只按剧情事件用 bsAddSperm 更新，插入不等于射精。',
  '- penetrationFit: 本次插入的体型契合（label、gap、text 与是否变化态、sizeBridge），由 bsAddSperm insert 结算，拔出后清除；只影响叙述，不限制交合与受孕。',
  '- age: 角色年龄，单位为年。',
  '- bodySize: 角色常态（人态）的个体体型，1–7 级，人类为 4；缺省时按种族平均。变化态体型由系统按种族推算。',
  '- sheath: 鞘（阴道）实际舒适的深度与同体型的人相比（偏浅、很浅、偏深、很深），只读；没有这栏代表适中。',
  '- figure: 当下的身材（体重与肉或肌肉、罩杯、臀部），孕期与产后已含变化，只读，描写须一致。胸部大小与奶量无关：大胸可能奶少，平胸也可能奶多。每次生产后会留下一部分变化（经产的痕迹：胸、臀、体重都略大），其余在产后恢复期间退去；之后要变回来或长期改变（发育、节食、锻炼、发福），用 bsGrowBody 记下：距上次改变（bodyChangedAtAge，岁）至少长了 1 岁才能用，用后从当下年龄重新起算。',
  '- race: 当前保存的种族字符串，可能带子类或混血，不再带 [derived] 前缀。',
  '- derivedType: 衍生类型字符串，如 不死-僵尸；没有则为 null。',
  '- sperms: 体内残留精液来源列表。残留每天自动衰减 10、归零即消失，通常 1-3 天内自然清空；当下总有效量越高，本次受孕越容易，胜出来源的有效量也会提高高产物种的伴生卵数量。受精成功本身不会扣除或清空残留，不需要每轮重复描写流出。',
  '- sperms[*].male: 精液来源对象名称。',
  '- sperms[*].race: 该来源的父方种族字符串，已去除 [derived] 前缀，用于受精与混血计算。',
  '- sperms[*].derivedType: 该来源的父方衍生类型；没有则为 null。',
  '- sperms[*].bodySize: 该来源的个体体型，只在已注册或 insert 时给过 maleBodySize 才有；受孕时存进胎儿的 fatherBodySize。',
  '- sperms[*].value: 当前残留量，用于多父竞争与受精判定；每天自动衰减 10，无需手动清除。',
  '- eggs: 当前可受精卵子数。',
  '- libido: 性欲。角色在剧情中达到高潮时，用 bsUpdateCharacterStatus 传 options.orgasm=true（同一段性事只传一次），由系统结算高潮排卵并让性欲归零；事后的满足不要用减少 libido 代替。',
  '- uterinePressure: 宫压，越高越接近妊娠风险或分娩。临产期或逾期时，剧情出现规律宫缩、见红等分娩发动的迹象，用 bsUpdateCharacterStatus 把 uterinePressure 加到接近上限（可直接给 +150，系统会夹在上限内），系统当下进入产兆前驱（约 48 小时后进入第一产程）；剧情明确写到已经规律宫缩、产程走得比这快时，用 bsAssistFetalPosition（action=descend）推送领头胎儿，每次缩短约 24 小时；孕早期、孕中期不要这样做，宫压过高在那时是流产风险。「直接给 +150」只用在触发临产。进入产程后宫压代表宫缩强弱，是一个取舍：越高产程越快，但越痛、休息也越难缓过来（满宫压时疲劳消退只剩一半）；剧情写到放松呼吸、宫缩间隙、镇痛、宫缩减弱时，用 bsUpdateCharacterStatus 给负值降宫压，换来疼痛减轻、休息更有效，代价是产程变慢，不要一律维持在上限。宫压在这段时间里就变了（例如宫缩缓下来后才歇着），这次 bsUpdateCharacterStatus 要排在这段时间的 bsPassedTime 之前，否则这段时间仍按原本的宫压结算。非真实分娩模式下宫压达到上限、而且这次推进跨过整点时，会让产程突然加速、直接跳过一个阶段，每跳一次用力疲劳 +30；用力疲劳要在 20 以下（缓过来了）才会突然加速，所以不能连跳，中间要先休息。',
  '- vitality: 活力。',
  '- psyStress: 情压/精神压力。',
  '- vitalityLevel / psyStressLevel: 个体等级，决定对应数值上限与体质倾向。',
  '- vitalityLevelText / psyStressLevelText: 系统额外附带的等级文字说明，方便直接理解体质与精神倾向。',
  '',
  '[pregnant]',
  '- pregnant 只会在已有 fetuses、妊娠阶段、产兆前驱/产程、产后恢复或假孕期发送；幕外角色发送时只保留少量 pregnant 摘要，并用 fetusesCount 表示胎儿数量。',
  '- pregnantDays: 这次妊娠的孕龄天数，等同产科从末次月经/本族等价周期起点计算的孕周天数。',
  '- effectivePregnantDays: 真正计入胎儿发育与阶段推进的有效孕龄天数；当妊娠被冻结时，它可以停在原地而 pregnantDays 继续增加。',
  '- allocation: 这次怀孕养分偏给谁（平衡、偏养母、偏养宝、极度…），只读：偏养母的人会丰腴、臀腿变厚，胎儿偏小但稳；偏养宝的胎儿长得大，母体容易饿、累、消瘦。',
  '- bellySize: 孕肚大小（0–15），系统按孕程与肚子里装的量算出，只读。足月单胎约 7、双胎约 8.5、三胎约 10；超过 10 是任何衣服都包不住的巨大孕肚。产后恢复期间从约 4 随恢复回缩到 0，胎内回归的回归期从 10 回落。描写孕肚外观以它为准，不要把数值写进叙事。',
  '- laborHours / effectiveLaborHours / laborPhase / laborBirthNumber / laborPain 仅在产兆前驱或正式产程期间发送；产后恢复不再表示分娩疼痛。',
  '- 延产期：逾期后以特殊手段（bsExtendPregnancy）让妊娠拖着不生的妊娠阶段。extensionCount 是本次妊娠已延产几次，extensionUntilDays 是这次延产到期的有效孕日（到期会进入产兆前驱）。延产期间宫压不会自行累积，再高也不会引发流产或产程；羊膜每天回复、不会破水；不能剖腹或终止妊娠，唯一出口是 bsExtendPregnancy（action=induce）引产。',
  '- base.uterineAtony：子宫乏力级数，第二次延产起每延一次加 1，产后恢复结束才清零。每级让宫压与性欲上限下降 10%、第一／第二产程变慢 10%、产后恢复变长 10%；剧情可描写宫缩无力、子宫松弛。',
  '- laborHours: 当前产程内部阶段已消耗的实际时长。',
  '- effectiveLaborHours: 真正推动当前产程内部阶段前进的有效时长。',
  '- laborPhase: 当前产程内部阶段。第一产程为潜伏期/活跃期/过渡期；第二产程为胎体下降/胎体娩出/间歇期；第三产程为供养器官娩出/产后观察。',
  '- laborBirthNumber: 第二产程正在生第几胎，从 1 起算；其他阶段通常为 0。它是出生计数，不是 fetuses 的下标。正在下降或娩出的那一胎在 fetuses 里带 presenting=true；fetuses 的排列顺序不代表出生顺序。',
  '- laborPain: 当前分娩疼痛程度，范围 0-10。描写疼痛反应不得明显超过此等级；刚进入第一产程时不应写成已达到极限痛苦。',
  '- laborEffort / pushFatigue（产程中）：推或休，以及用力疲劳 0-100。推的时候疲劳累积（胎越大越快），60 以上越推越没效果；休的时候疲劳消退，越冷静消退越快。疲劳不随换阶段归零。各阶段效果不同：第二产程的胎体下降与娩出要产妇自己用力，休的时候产程几乎不前进；第三产程娩出胎盘时用力快一倍，不用力也会照常娩出；第一产程宫口还没开全、间歇期下一胎还没开始下降，用力是白费力气，只会累积疲劳，只有剧情写到她提早用力（例如不懂怎么生）才给 push，不要为了加快产程而 push。进入第一产程、间歇期与第三产程时预设休，胎体下降开始时预设推。剧情写到产妇停下来喘气、歇一下时用 bsAssistFetalPosition 给 action=rest，用力时给 action=push；用力消耗的体力照剧情自己扣 vitality，系统不代扣。切换要先于这段时间的 bsPassedTime。',
  '- amnionDurability: 羊膜耐性（0-100）；过低代表接近或已经破水。每一胎有各自的羊膜（同卵共用一个胎囊）：全部胎囊相同时只给这一个数值；不同时不给这个数值，改在对应胎儿上标 fetuses[*].amnion＝膜薄／膜危／已破，没标的就是完整。',
  '- fetuses[*].health: 胎儿健康刻度（健壮／平稳／虚弱／危急），描写须一致，不写出刻度本身。来源：需求照料（需求在「高」时用 bsExcreteMetabolism 处理到「无」加分，拖到「爆」扣分、越久越重）与 bsFetalEvent 的伤害、照料；没人照料也没人疏忽时回到平稳。危急时周结算先警告，下一周仍危急就流产（多胎只吸收那一胎），孕晚期起早产。fetuses[*].resilience：顽强＝很耐疏忽与伤害（强壮的母体、异种的魔丸与孽种，母体可挺着肚子照样奔波），脆弱＝稍有闪失就出事，没有就是一般。耐受由系统换算：change 一律照这件事对一般胎儿的影响给，不因顽强省略该记的伤害，也不因顽强或脆弱调轻、调重。fetuses[*].guarded＝父方在场庇护：伤害照常记，系统会让它回到平稳，可写胎儿在父亲身边格外安稳、伤后很快平复。',
  '- pregnant.prenatalCare: 镜头外的产前护理（悉心安胎／用心／一般／未察觉／疏忽／虐孕）。还没设定时是「未察觉」：她还不知道自己怀孕，照平常过日子、没有特别照顾。她知道或相信自己怀孕的那条认知（bsRecordExperience 的 cognition）一定要附 prenatalCare，没什么特别就给 normal，否则一直当未察觉；态度改变时再给。它管镜头外的日常养胎，描写她的生活习惯须一致。',
  '- pregnant.fetalEvents: 胎儿事件纪录的窗口。events 每条有 time、kind、change、target（第几胎／全部）、content，pin=true 为钉选，counted=false 表示当天同类已结算、只留纪录；earlier 是更早事件的摘要，「要点」与 events 一样是已发生的事实；countedToday 是今天已结算的 kind，同一胎同一天再记同类无效。不要重复记已有的事件。',
  '- 胎位操作、胎儿自主活动、两胎互动（bsAssistFetalPosition action=sibling）与插入推顶的规则写在各工具说明里（bsAssistFetalPosition、bsAddSperm），胎儿伤害、照料、母胎亲近与疏离用 bsFetalEvent，依工具回传描写。',
  '- blockage / acceleration / expansion: 当日妊娠症状，格式为 {key, severity}，含义见 [metabolism]。',
  '- fetuses: 胎儿列表。',
  '- fetuses[*].fathers: 实际遗传父方（系统真相）。',
  '- fetuses[*].selectedFather / paternityClaims: 角色自己心里认定的父亲（可以与真相不符）与最近几笔认定纪录（她怎么认定、对外怎么说、告诉了谁、对方反应）；对外谎称的对象写在纪录里，不是 selectedFather。不改 fathers，也不代表任何人知道真相；记录用 bsRecordExperience(action=claim)。',
  '- fetuses[*].provider: 胚胎真正的归属方（代孕委托者、虫母等），自然受孕为 null。单一 provider 的孩子分娩后自动转交；多母源嵌合体以 × 显示并留在孕母名下。',
  '- fetuses[*].providerSources: 可接收孩子的母源名单。多于一位时孩子默认登记在孕母名下，之后可手动转移给其中一位。',
  '- fetuses[*].chimera: 受精卵早期融合的嵌合资料，包含来源数量、父源、母源与融合前性别。没有融合时不出现。',
  '- fetuses[*].tags: 系统标注的胎儿来历标签（如 chimera/surrogacy/identical），由系统推导或在事件发生当下写入，只读，不要自行增删。本轮出现过的标签会在下方另行说明。',
  '- fetuses[*].identicalGroup: 同卵分裂的组别编号；带同一编号且 tags 含 identical 的胎儿由同一颗受精卵分裂而来。没有分裂时不出现。',
  '- fetuses[*].nestedInEmbryoId: 孕中孕专用——这一胎套在体内哪一颗胎儿之中（指向该胎的内部编号）。它的母亲是那颗胎儿，父亲照常是精源；出生后两个孩子一起娩出，被套的那个的母亲就是同胎的另一个孩子。孕中孕藏得比一般异期胎更久，要到孕晚期才会出现在 fetuses 里。',
  '- fetuses[*].conceivedAtDays: 异期复孕专用——这一胎受精或植入当下的 effectivePregnantDays。该胎自己的孕龄 = effectivePregnantDays 减去这个值，所以同腹胎儿的发育进度可能不同。一般妊娠不出现。',
  '- 异期复孕的胎儿在进入孕中期之前不会出现在 fetuses 里，也不计入 fetusesCount：角色本人还不知道自己怀了两胎。它在系统里照常发育、照常消耗供养力，所以在揭晓前你会看到供养负担与体感比胎数应有的更重——那是伏笔，可以据此写身体的异样，但不要直接写破「其实有两胎」。揭晓时系统会以 notify 告知。',
  '- fetuses[*].fatherRace: 父方种族字符串，已去除 [derived] 前缀，用于理解父源与 fatherDerivedType。',
  '- base.bloodline / fetuses[*].bloodline: 各种族的血脉份额（0到1），合计1；比例由系统遗传计算，不能用字串去重后的种族数重新均分。bloodlineSource=estimated 表示旧资料缺少比例，属于推定。',
  '- fetuses[*].fatherDerivedType: 父方衍生类型；若没有则为 null。',
  '- fetuses[*].fatherBodySize / children[*].fatherBodySize: 父方的个体体型（受孕当下精液纪录所载）；没有则为未记录。',
  '- fetuses[*].gender: 胎儿性别。',
  '- fetuses[*].embryoType: 胚胎型态，如 胎生、卵生、卵胎生、胎转卵生、不定型。',
  '- fetuses[*].companionEggCount: 这一胎伴随的背景卵数量（伴生卵），为 0 时不出现。出生时会随这一胎一起排出，可描写成产下整群卵，但只有这一胎会写入族谱；绝不能按伴生卵自行增加 fetusesCount、胎儿卡或孩子。',
  '- fetuses[*].weight: 胎重系数，標準1.0，范围0.33~3.0。影响妊娠负担、分娩难度与恢复期。',
  '- fetuses[*].tendencyAngle: 胎位角度，0/360=头位，180=臀位，90或270=横位，禁止反写；影响第二产程的难度。若 notify 发出难产警示，应优先考虑 bsChildbirth 手术产。',
  '- fetuses[*].tendencyAngleText: 系统额外附带的胎位文字说明，如 头位(头朝下)/臀位(臀部朝下)/横位/斜位。',
  '- fetuses[*].positionText: 这一胎在子宫里的深度，由系统的胎动与产程自动结算：顶到宫顶／宫内自由／子宫低位／入盆／进入产道／着冠／先露部已出；卡住时会写明（如 与另一胎在入口互锁、肩部卡住、在宿主胎儿体内）。描写胎儿位置、腹部下沉、入盆时须与它一致，不要自行改写。',
  '- fetuses[*].backSideText: 胎背朝母体哪一侧（左前／右前／左后／右后；横位时写成朝上或朝下、偏前或偏后）。与胎位角度互相独立，由系统的胎动与产程结算；胎背朝后（枕后位）时胎儿的脸朝母体腹侧，真实分娩模式下产程较慢、较痛。描写胎动方向、胎背贴着哪一侧肚皮时须与它一致。卵生、胎转卵生出生时是蛋，没有这一项，也没有枕后位。',
  '- fetuses 的排列顺序是子宫里由左至右的相对位置，不代表出生顺序；正在下降或娩出的那一胎带 presenting=true。',
  '- fetuses[*].affinity: 母胎之間的親密度（-50～50），由 bsFetalEvent 的 bonding（亲近）、estrangement（疏离）改变，也会参与 derivedType 进展。',
  '- fetuses[*].maternalDerivedTypeProgress: 与母体(正)/父源(負)衍生同化的进度，范围 -100 到 100；系统按母胎亲密度（往母方）与母亲对胎父的身体熟悉度（往父方）拉锯推进，不要直接改。',
  '- fetuses[*].talents: 胎儿承接的天赋，只含 skillId、带正负号的 level 与 exp；只能由孕体角色的 bsTrainSkill 在允许阶段自动改变。',
  '',
  '[bio]',
  '- bio 只会发送少量允许暴露给 LLM 的字段，不代表完整内部参数表。',
  '- gestationModifierMultiplier: 妊娠速度倍率。1 为正常，大于 1 为加速，小于 1 为减速；若为 0，则代表胎儿发育冻结。',
  '- gestationModifierName: 当前妊娠速度修正效果的名称，例如祝福、诅咒、体质、术式。',
  '- gestationModifierDescription: 对该妊娠速度修正来源与表现的简短说明。',
  '',
  '[experience]',
  '- 记录第一次对象、最近对象、情感/婚姻对象，以及怀孕、分娩、流产等经历次数。',
  '- emotionalMates/marriageMates 为多人名单，由 date/breakup/marry/divorce 更新一人；婚姻和交往不连带增删。经验计数由后台结果更新，不能任意覆写。miscarriageExperience、abortionExperience 分别是流产与堕胎；旧版妊娠损失归入流产。',
  '',
  '[bodyFamiliarity]',
  '- 身体对各性伴的熟悉度，前三名与「身体最熟悉谁」；由系统依 bsAddSperm 的插入次数、体型相容（含经产扩张）、精子品质与时间衰减算出。只读，没有工具能改；只描述身体记忆，不代表感情。',
  '',
  '[cognitionRecords]',
  '- 纪录较多时只送最近几条与钉选（pin=true）的条目，更早的并成 cognitionEarlier 一行摘要：各方式次数与日期，整理过的再附「要点」，写的是她目前的信念（照她的理解，可能与事实不同）；摘要里的旧认知仍然成立，只是不再逐条列出。重要的认知记得钉选。',
  '- 每名角色独立的当前周期认知纪录；只有 bsRecordExperience(action=cognition) 追加，缺少纪录不等于相信未孕。允许猜错孕程、胎数与胎父；不改客观事实。实际进入月经才刷新，长期 experience 与 children 保留。',
  '- 最新改口不删除旧笔；按先后与来源解读。系统受孕、胎父或工具成功不代表角色知情。未知身份不能用系统姓名补真相。',
  '- hasCondom 与事后避孕在工具执行时结算，结果下一次回复承接，不预测或强制改写当轮正文；未结算的亲历结果不得预写。',
  '- 自然妊娠线索只提示较容易注意身体变化，不自动确认怀孕。恢复期禁孕；恢复/假孕结束先进入月经刷新。',
  '- 察觉分娩同理：产兆前驱、产程是系统结果，不等于她知道自己在生。认出之前，阵痛可能被当成腹痛、经痛、吃坏肚子或便意。何时认出照剧情与状态判断：经产妇（experience 有生产次数）通常一进第一产程就认得出；初产妇常要等到破水或宫缩变得规律密集；第二产程很难不察觉，但仍可能误以为是便意；急产可能来不及反应；连怀孕都不知道的人更难联想到分娩。她认出来时记一条认知（身体自觉 perception、被人点破 informed、产婆或医师判断 prenatal），写明怎么认出来，重要的钉选。直到生下来都没认出也可以，分娩照常结算，事后补记。',
  '',
  '[psychology]',
  '- psychology 分为 mens (常规/生理) 与 preg (妊娠相关) 两大组心理指数。',
  ...Object.entries(PSY_MENS_FIELDS).map(([k, v]) => `- [mens] ${k} (0-100+): ${v.definition}`),
  ...Object.entries(PSY_PREG_FIELDS).map(([k, v]) => `- [preg] ${k} (0-100+): ${v.definition}`),
  '- 非怀孕时主要看 psychology.mens；怀孕、假孕、产兆前驱、产程时主要看 psychology.preg。',
  '- 心理阶段从 0 到 100+。变化挂在认知纪录上：bsRecordExperience（action=cognition）的 psychology 每轴给程度（slight／significant／severe，约 2／5／10 点），只能动当前这一侧的三轴，同一轴同一个故事日只算一次。不限于怀孕的心境经历（性爱里的主导或被迫、看到别人的孩子、爱人的话、失去孩子的阴影）用 method=experience 记。没有值得记下的经历就不要动心理。',
  '- 每个心理项由 *_value 和 *_interpret 组成。*_value 是 0-100 数值本体，*_interpret 是系统对应生成的心理解释。',
  '',
  '[skills / talents]',
  '- skills 是角色后天技能列表；每项为 {skillId, level, exp}。技能从 Lv1 觉醒，最高 Lv10，只进不退。',
  '- skillHistory 是系统自动保存的最近技能觉醒／升等事件，只供参考，不得由工具修改。一次跨多级只会有一条 fromLevel→toLevel 记录。',
  '- talents 是角色先天天赋列表；每项为 {skillId, level, exp}。level 正数表示擅长、负数表示苦手、0 表示尚未形成；exp 同样带方向，反向经验会逐级削弱并能跨过 0 逆转，最高 ±Lv5。角色 talents 对所有 LLM 工具都是只读资料，只能由用户通过外部注册／技能／变量界面调整。',
  '- 技能与天赋共用经验曲线 requiredExp(level)=100*level*level；技能 Lv1→2 要 100、Lv2→3 要 400。天赋 Lv0→±Lv1 固定要 100，之后按当前绝对等级使用同一曲线。',
  '- 只有 recent_messages 明确出现相关事件、练习、实战运用、教学或领悟时，才调用 bsTrainSkill；不得仅凭“角色可能擅长”增加。',
  '- skillExp 由你直接给非负整数，并综合事件成果、当前技能等级、本级需求及同名天赋判断。正天赋通常让同等事件更容易获得较多技能经验，负天赋通常较少；系统不会再次套倍率。',
  '- 严禁尝试传入 talentExp 或用任何工具修改角色自己的 talents。只有系统在允许孕期阶段执行技能锻炼时，才能依亲和度自动改变 fetuses[*].talents。',
  '- 新技能必须先调用 bsRegisterSkillDefinition，以 name+description 登记到 skill_catalog；先检查既有定义，禁止制造同义重复。随后才能用精确名称调用 bsTrainSkill，并在剧情确实触发觉醒时传 awaken=true。',
  '- 孕中期、孕晚期、临产期、逾期、延产期、产兆前驱、第一产程调用 bsTrainSkill 时，系统每次只随机选择一胎，将本次 skillExp 依该胎 affinity 自动传为天赋经验：skillExp*abs(affinity)/50，正亲和为擅长、负亲和为苦手、0 不传。第二与第三产程禁止传递。',
  '- 胎儿与孩子只有 talents，没有 skills。分娩时 talents 原样进入 children；日后注册孩子角色时，由用户在注册第五子页参考并载入，不会只凭同名自动继承。',
  '',
  '[children]',
  '- 已出生孩子列表。代孕／寄生所生的孩子会转交给 provider 指向的角色；该角色尚未注册时，孩子留在承载者名下并保留 children[*].provider 标记。',
  '- children[*].name: 孩子姓名。',
  '- children[*].fathers: 实际遗传父方；selectedFather 为角色自己心里认定的父亲，可不同，对外说法写在 paternityClaims，不代表对方知情或认可；paternityClaims 为最近几笔认定纪录。命名用 bsRecordExperience(action=child)，认定／选爹用 action=claim，female 指当前持有者。',
  '- children[*].gender: 孩子性别。',
  '- children[*].race: 孩子种族。',
  '- children[*].derivedType: 孩子继承到的衍生类型；没有则为 null。',
  '- children[*].age: 孩子年龄，单位为年，会随时间推进。',
  '- children[*].birthCompanionEggCount: 出生时一起排出的伴生卵数量，只是出生背景；这笔 children 记录仍只代表其中唯一成功长大繁衍的有效后代。',
  '- children[*].talents: 从胎儿阶段保留下来的天赋；注册该孩子时供用户在注册技能页参考载入。',
  '',
  '[diary]',
  '- diary 是角色主观日记，保存为数组；existing_state 中只会发送最近几笔，前端完整变量仍会保留全量。',
  '- diary[*].time: 角色日记中的日期标题，不是具体钟点；应填写故事内日期、年月日、某日/第几天等日期性标题。不要填 HH:mm、午後 这类时刻；若只有时刻信息，请结合上下文写成“今日”“雨夜当日”“第 X 日”等日期标题。',
  '- diary[*].content: 角色事后写下的主观日记，可包含心境、记忆、误解、愿望、秘密或身体感受；它不是即时心声/旁白，也不是客观状态，不能覆盖数值事实。',
  '- diary 有 24 小时冷却；同一角色在同一个故事日内最多只能写一篇。若当天已经写过，必须跳过 bsWriteDiary。',
  '- 通常只有 bsPassedTime 跨日后才调用 bsWriteDiary，并优先写“昨日/前一日/上一天”的回顾。若剧情发生重大事件或 notify 提醒，也应写成事后补记的语气，不要像当下即时独白。',
  '- 角色不在场也可以写日记；可根据角色性格、处境与已知生活状态补足合理的日常幕外感受，但不要把未经剧情支持的重大事件写成既成事实，也不要用日记改写客观状态。',
  '',
  '[metabolism]',
  '- 普通种族使用 excretion / hunger / sleep / milk / odor / companionship，分别对应泄意、饿意、困意、乳意、臭意、伴意；excretion（泄意）同时包含排尿与排便需求。',
  '- 若角色具有 derivedType，则 metabolism 一定包含 flux，并只保留该衍生类型未抵免的普通需求。flux 通常是 -150 到 150 的单一极性需求值；被 pregnant.expansion 命中的方向可扩至 -200 或 200。正值持续走向更正，负值持续走向更负，绝对值越高代表越需要使用 bsExcreteMetabolism 进行一次“解放”。解放会按释放量抵消当前需求，只有在抵消过头时才会跨过 0 翻转极性。',
  '- excretion 会在活力增加时累积；以 bsExcreteMetabolism 处理 hunger（进食）会增加部分泄意与少量困意，处理 sleep（睡眠）会增加少量饿意。milk 代表乳意：普通周期中为乳房胀敏或周期不适，黄体期/月经期会随时间累积，排卵期可因性欲波动少量累积；妊娠时孕早期与孕中期前段是乳房胀痛、敏感（早孕常见），孕中后期起才可能溢出少量初乳，多数到孕晚期或产后才明显；假孕以胀痛为主；产后恢复为泌乳需求。odor 代表需要清理的臭意，companionship 代表渴望陪伴或社交的伴意。',
  '- 时间累积满一周时会进行日常生活结算：基本清洁会清除臭意，日常往来会缓解部分伴意；普通周期进入新一轮卵泡期时，周期型乳意会清零。妊娠、假孕或产后恢复的泌乳型乳意不会因跨周自动清除。',
  '- 只有剧情确实发生陪伴或社交时，才用 options.companionship 缓解伴意；臭意达到高等级时会降低陪伴缓解效果。伴意解除不额外转化为乳意；乳意仍由周期、妊娠/假孕/产后恢复与性欲波动等既有来源产生。',
  '- pregnant.blockage／acceleration／expansion 是当日妊娠症状，格式为 {key, severity}，key 可为上述需求或 fluxPositive/fluxNegative；三者不会同时落在同一项需求上。',
  '- pregnant.blockage 表示阻塞症状，会降低对应需求的解除效果：',
  '  - excretion: 便秘。',
  '  - hunger: 孕吐恶心、消化不良。',
  '  - milk: 乳房胀痛、敏感。',
  '  - sleep: 失眠。',
  '  - odor: 阴道分泌物增生。',
  '  - companionship: 社交回避。',
  '- pregnant.acceleration 表示快积症状，会加快对应需求累积，也会让刚被缓解的需求较快回升：',
  '  - excretion: 频尿。',
  '  - hunger: 容易饿、奇特饮食偏好。',
  '  - milk: 乳意快升；孕晚期以前是乳房胀痛、敏感加剧，孕晚期起才可能溢出初乳。',
  '  - sleep: 晕眩、嗜睡。',
  '  - odor: 体温升高、容易排汗。',
  '  - companionship: 黏人。',
  '- pregnant.expansion 表示扩容症状，会使对应需求可承受量从 150 提高到 200，因而需要更多解除量才能排净：',
  '  - excretion: 水肿、肠道慢蠕动，排出的量较少。',
  '  - hunger: 养分母体优先，但使胎儿活动降低。',
  '  - milk: 乳房储奶量变大，要胀得更满才需排解；只是能装的奶变多，胸部尺寸不变（胸大不等于奶多），也不同于阻塞的压迫疼敏。',
  '  - sleep: 激素使精力旺盛，但属于代偿。',
  '  - odor: 孕妇特有的香气掩盖了需要清理的不适。',
  '  - companionship: 胎儿带来内在陪伴感，可以忍受更长的孤独。',
  '- fluxPositive / fluxNegative 的阻塞、快积与扩容需按该衍生种族的正负极需求解释；解放 flux 时传 options.flux。',
  '- 对 derivedType 角色来说，被衍生代谢抵免的需求不会出现在 metabolism 中；未出现的需求不要主动提醒或要求处理。',
  '',
  '[wardrobe / outfit]',
  '- wardrobe.items 是长期衣柜；outfit 是当前穿着。衣柜无需预先准备。',
  '- item 使用整数 id、name、note 与 slot。id=0 是明确全裸；outfit.mainItemId=null 才是衣着未记录，不得把未知推断为裸体。note 只写颜色、材质、版型、长短、固定开口、图案与来源等稳定外观，不写角色感受、怀孕反应或衣物当下状态。',
  '- slot=main 是一次只能穿一套的完整基础衣着；上下装合为一件 main，parts 可列出组成部件。main.fitProfile 使用语意档位：masking=very_low/low/medium/high，support=none/normal/strong，capacity=tight/fitted/stretch/loose，convenience=inconvenient/normal/convenient。',
  '- fitProfile 必须与衣物的 name、note 一致，逐项判断：宽松、宽大、孕妇装的 capacity 用 stretch 或 loose，修身、紧身、孕前旧衣用 fitted 或 tight；有托腹或承托设计的 support 用 strong。',
  '- slot=accessory 是可独立穿脱的内衣、外搭、鞋袜、头饰、饰品或支撑用品。category=underwear/outerwear/footwear/headwear/ornament/support/other；effects 最多两项，使用 masking/support/capacity/convenience 加 _up 或 _down。',
  '- masking 是掩盖身体曲线与孕肚变化，不等于露肤；support 是胸腹腰与重心承托；capacity 是容许体型变化；convenience 是行动、穿脱、如厕、哺乳或排解需求的方便程度。',
  '- 新衣可直接用 bsChangeOutfit 的 main/accessories 建立并穿上：scope=owned 收入长期衣柜，scope=temporary 仅保留到该衣物脱下。bsAddWardrobeItem 只收藏或更新长期衣物，引用正在穿的临时衣物时会把它转为长期衣物（id 与穿着不变）；bsRemoveWardrobeItem 永久删除。衣物可用整数 id 或准确名称引用。',
  '- 衣柜也要跟着剧情减少：衣物被撕毁报废、丢弃、送人、卖掉、遗失、被没收，或角色明确把穿不下的衣服收起、丢掉时，用 bsRemoveWardrobeItem 删除；只是脱下、换下、弄脏送洗不删。正在穿的衣物被毁时，同轮先用 bsChangeOutfit 换下（或换上别的），再删除。',
  '- accessoryItemIds 覆盖当前配件整表；addAccessoryItemIds/removeAccessoryItemIds 用于增量穿脱。全裸传 mainItemId:0 与 accessoryItemIds:[]。wearState 只是 12 字内的状态标签，不会改变穿了哪些衣物；换主件而未传 wearState 时自动回到整齐。',
  '- recent_messages 出现穿脱、更衣、借穿、被脱除、淋湿、衣衫不整或洗浴后着装时，调用 bsChangeOutfit 使 outfit 与叙事一致。outfit.currentWearText 与 currentItems 只供核对，不要写回，也不要在 descriptions 另建衣着状态。',
  '- 幕外角色也会附精简衣柜名录与当前穿着摘要；重新登场时若衣着改变，应与 bsSetCharacterPresence 同轮换装。衣柜名录始终精简；当前衣物才附稳定外观，内部换算分数只在孕期窗口发送并参与 pregFit。',
  '- outfit.pregFit 只在真实妊娠、产兆前驱、产程、产后恢复或回归期中存在；其余阶段为 null。gap 为四维余裕：masking/support/capacity/convenience，等于这套衣着该维度的总值减去 pregnant.bellySize（孕肚大小）。gap 低于 0 表示该维度已被孕肚压过。一般衣着四维最高 10，孕肚超过 10 即爆表，表示孕肚已大到衣服完全包不住，可描写衣料绷开、露出下半个肚子；衣物带 maternity=true 是特制孕妇用品，穿着任一件时四维上限放宽到 15，叠得够高才压得住。',
  '- gap 表示衣物该维度扣除孕肚大小后的余裕。一般 gap 约 3 以上表示仍有余裕；0 到 2 表示开始吃紧；-1 到 -3 表示明显冲突；-4 以下表示该维度严重失效。按具体维度叙述：masking 失效是轮廓、孕肚或胸腹变化难藏；support 失效是承托不足、下坠、晃动或重心负担外溢；capacity 失效是版型固定、尺寸死、腰腹胸臀被迫撑紧或扣合困难；convenience 失效是行动、穿脱、如厕或排解需求明显受阻。不要把 gap 数值直接写进叙事，除非是调试说明。',
  '',
  '[descriptions]',
  '- normalDescription / pregnantDescription 为文字描述栏位；pregnantDescription 只在妊娠相关阶段（有胎儿、孕期、产兆前驱、产程、产后恢复、假孕期）发送，其余阶段不要更新它。',
  '- 两者都是以字段名为键的物件 {"字段名":"描述内容"}，键的先后即字段顺序。',
  '- staleDescriptionFields 列出超过一天（游戏时间）没更新的字段，按栏位分组；没有就不出现。',
  '- 不要新增角色原本没有的描述字段；只能更新 existing_state 中该角色该 descriptions 已存在的字段名。唯一例外：当本提示词包含 [pregnantDescription 初始化] 段时，可为其中点名角色的空 pregnantDescription 建立规范内的首批字段。',
  '- 描述内容不要换行，也不要把多个字段并成一段。',
  '',
  '[notify]',
  '- firstly: 主要阶段变化或必须优先处理的警示，例如真实产程中的难产手术产建议；也可能用于提醒角色获得或失去妊娠变速效果。',
  '- secondly: 次级事件提示，如风险、破水、分娩推进、母胎互动或胎儿自主活动；其中的母胎互动与胎动事件可自然融入当前叙事。',
  '- thirdly: 辅助建议提示，提醒是否该缓解生理需求、关注膜耐性、抵抗分娩等。',
  '',
].join('\n');

const TRACKER_DIARY_SECTION = [
  '[diary]',
  '- diary 是角色主观日记，保存为数组；existing_state 中只会发送最近几笔，前端完整变量仍会保留全量。',
  '- diary[*].time: 角色日记中的日期标题，不是具体钟点；应填写故事内日期、年月日、某日/第几天等日期性标题。不要填 HH:mm、午後 这类时刻；若只有时刻信息，请结合上下文写成“今日”“雨夜当日”“第 X 日”等日期标题。',
  '- diary[*].content: 角色事后写下的主观日记，可包含心境、记忆、误解、愿望、秘密或身体感受；它不是即时心声/旁白，也不是客观状态，不能覆盖数值事实。',
  '- diary 有 24 小时冷却；同一角色在同一个故事日内最多只能写一篇。若当天已经写过，必须跳过 bsWriteDiary。',
  '- 通常只有 bsPassedTime 跨日后才调用 bsWriteDiary，并优先写“昨日/前一日/上一天”的回顾。若剧情发生重大事件或 notify 提醒，也应写成事后补记的语气，不要像当下即时独白。',
  '- 角色不在场也可以写日记；可根据角色性格、处境与已知生活状态补足合理的日常幕外感受，但不要把未经剧情支持的重大事件写成既成事实，也不要用日记改写客观状态。',
  '',
].join('\n');

/** 写实世界不会出现这些字段：衍生类型、血统份额、伴生卵、flux */
const REALISTIC_WORLD_DROPPED_LINES = [
  '- derivedType:', '- sperms[*].derivedType:', '- base.bloodline / fetuses[*].bloodline:', '- fetuses[*].fatherDerivedType:',
  '- fetuses[*].maternalDerivedTypeProgress:', '- fetuses[*].companionEggCount:', '- children[*].derivedType:',
  '- children[*].birthCompanionEggCount:', '- 若角色具有 derivedType', '- fluxPositive / fluxNegative', '- 对 derivedType 角色来说',
];
/** 特殊工具关掉时，它产生的状态也不会出现 */
const SPECIAL_TOOL_DROPPED_LINES = {
  bsWombReturn: ['- 回归期：', '- 回归期不受', '- pregnant.wombReturn:'],
  bsExtendPregnancy: ['- 延产期：', '- base.uterineAtony：'],
  bsImplantEmbryo: ['- fetuses[*].provider:', '- fetuses[*].providerSources:'],
};

function dropGuideLines(guide, prefixes) {
  if (prefixes.length === 0) return guide;
  return guide.split('\n').filter((line) => !prefixes.some((prefix) => line.startsWith(prefix))).join('\n');
}

function buildTrackerMetabolismGuide(payload = null) {
  const fluxNames = collectRelevantFluxNames(payload || {});
  const diaryEnabled = payload?.diary_enabled !== false;
  const wardrobeEnabled = payload?.wardrobe_enabled === true;
  const skillEnabled = payload?.skill_enabled !== false;
  const breedingPsychologyEnabled = payload?.breeding_psychology_enabled === true;
  let baseGuide = diaryEnabled
    ? TRACKER_VARIABLE_GUIDE_PROMPT
    : TRACKER_VARIABLE_GUIDE_PROMPT.replace(`${TRACKER_DIARY_SECTION}\n`, '');
  if (!wardrobeEnabled) {
    baseGuide = baseGuide.replace(/\n?\[wardrobe \/ outfit\][\s\S]*?\n\[descriptions\]/, '\n[descriptions]');
  }
  if (!breedingPsychologyEnabled) {
    baseGuide = baseGuide
      .replace('、psychology', '')
      .replace(/\n?\[psychology\][\s\S]*?\n\[skills \/ talents\]/, '\n[skills / talents]');
  }
  if (!skillEnabled) {
    baseGuide = baseGuide
      .replace(/\n- skill_catalog 是[^\n]*/, '')
      .replace('、skills、talents', '')
      .replace(/\n- fetuses\[\*\]\.talents:[^\n]*/, '')
      .replace(/\n- children\[\*\]\.talents:[^\n]*/, '')
      .replace(/\n?\[skills \/ talents\][\s\S]*?\n\[children\]/, '\n[children]');
  }
  baseGuide = dropGuideLines(baseGuide, [
    ...(payload?.realistic_world === true ? REALISTIC_WORLD_DROPPED_LINES : []),
    ...(Array.isArray(payload?.disabled_special_tools) ? payload.disabled_special_tools : []).flatMap((name) => SPECIAL_TOOL_DROPPED_LINES[name] || []),
  ]);
  // 只解释本轮真的出现过的标签，与种族短叙述同规则：没用到就不占 token
  const fetusTagLines = describeFetusTags(collectRelevantFetusTags(payload || {}));
  if (fetusTagLines.length > 0) {
    baseGuide += ['', '', '[本轮出现的胎儿标签]', ...fetusTagLines].join('\n');
  }
  return fluxNames.length > 0
    ? baseGuide.replace(
      '- 若角色具有 derivedType，则 metabolism 一定包含 flux，并只保留该衍生类型未抵免的普通需求。flux 通常是 -150 到 150 的单一极性需求值；被 pregnant.expansion 命中的方向可扩至 -200 或 200。正值持续走向更正，负值持续走向更负，绝对值越高代表越需要使用 bsExcreteMetabolism 进行一次“解放”。解放会按释放量抵消当前需求，只有在抵消过头时才会跨过 0 翻转极性。',
      `- 若角色具有 derivedType，则 metabolism 一定包含 flux，并只保留该衍生类型未抵免的普通需求。flux 通常是 -150 到 150 的单一极性需求值，被 pregnant.expansion 命中的方向可扩至 -200 或 200；在本轮相关衍生种族中，flux 分别表示：${fluxNames.join(' / ')}。正值持续走向更正，负值持续走向更负，绝对值越高代表越需要使用 bsExcreteMetabolism 进行一次“解放”。解放会按释放量抵消当前需求，只有在抵消过头时才会跨过 0 翻转极性。`,
    )
    : baseGuide;
}

// 妊娠相关阶段中 pregnantDescription 仍为空的在场角色：需要注入初始化规范，
// 否则「不要新增描述子字段」规则会把空栏位永久锁死。
const PREGNANT_DESCRIPTION_STAGES = new Set([...PREGNANCY_STAGES, '产兆前驱', ...LABOR_STAGES, '产后恢复', '假孕期']);

function collectPregnantDescriptionInitNames(payload = {}) {
  const names = [];
  const existingState = payload?.existing_state;
  if (!existingState || typeof existingState !== 'object') return names;
  for (const [key, item] of Object.entries(existingState)) {
    if (item?.offscreen === true) continue;
    const stage = String(item?.profile?.base?.stage || '');
    if (!PREGNANT_DESCRIPTION_STAGES.has(stage)) continue;
    const pregnantDescription = item?.profile?.descriptions?.pregnantDescription;
    if (typeof pregnantDescription === 'string' ? pregnantDescription.trim() : Object.keys(pregnantDescription || {}).length > 0) continue;
    names.push(String(item?.name || key));
  }
  return names;
}

/** 在场角色超过一天没更新的描述字段，一人一行 */
function collectStaleDescriptionLines(payload = {}) {
  const existingState = payload?.existing_state;
  if (!existingState || typeof existingState !== 'object') return [];
  const lines = [];
  for (const [key, item] of Object.entries(existingState)) {
    if (item?.offscreen === true) continue;
    const stale = item?.profile?.staleDescriptionFields;
    if (!stale || typeof stale !== 'object') continue;
    const groups = Object.entries(stale)
      .filter(([, names]) => Array.isArray(names) && names.length > 0)
      .map(([field, names]) => `${field}：${names.join('、')}`);
    if (groups.length > 0) lines.push(`- ${String(item?.name || key)} ${groups.join('；')}`);
  }
  // 精方只点名范本里带 * 的字段（见 registered_sires 的 staleFields）
  for (const sire of (Array.isArray(payload?.registered_sires) ? payload.registered_sires : [])) {
    if (sire?.isHere && Array.isArray(sire.staleFields) && sire.staleFields.length > 0) {
      lines.push(`- ${sire.name}（精方） normalDescription：${sire.staleFields.join('、')}`);
    }
  }
  return lines;
}

/**
 * 每轮的即时字段：描述规则里带 * 的字段是当下的动作、表情、姿势，一天才点名太慢。
 * - 在场角色：只列她真的有的字段；描述还空着的不列（不新增字段的规则仍然有效）
 * - 不在场的：追踪看不到她的描述，照范本列出并注明「若本轮登场」——刚进门那一轮最容易忘了改动作
 * 没变不必照抄，不多花输出。
 */
function collectRealtimeDescriptionLines(payload = {}, descriptionGuides = null) {
  const lines = [];
  const starredOf = (guide) => parseDescriptionGuideFields(guide).filter((field) => field.starred).map((field) => field.name);
  const ownFields = (own, starred) => starred.filter((name) => Object.prototype.hasOwnProperty.call(own, name));
  const femaleStarred = starredOf(descriptionGuides?.normalDescription);
  // 孕态描述只在妊娠相关阶段才送，送了才列
  const pregnantStarred = starredOf(descriptionGuides?.pregnantDescription);
  if (femaleStarred.length > 0 || pregnantStarred.length > 0) {
    for (const [key, item] of Object.entries(payload?.existing_state || {})) {
      const name = String(item?.name || key);
      if (item?.offscreen === true || item?.profile?.base?.isHere === false) {
        if (femaleStarred.length > 0) lines.push(`- ${name}（不在场，若本轮登场）：${femaleStarred.join('、')}`);
        continue;
      }
      const normal = item?.profile?.descriptions?.normalDescription;
      const pregnant = item?.profile?.descriptions?.pregnantDescription;
      const groups = [
        normal && typeof normal === 'object' ? ownFields(normal, femaleStarred) : [],
        pregnant && typeof pregnant === 'object' ? ownFields(pregnant, pregnantStarred) : [],
      ];
      const text = [
        groups[0].length > 0 ? groups[0].join('、') : '',
        groups[1].length > 0 ? `pregnantDescription ${groups[1].join('、')}` : '',
      ].filter(Boolean).join('；');
      if (text) lines.push(`- ${name}：${text}`);
    }
  }
  const sireStarred = starredOf(descriptionGuides?.sireDescription);
  if (sireStarred.length > 0) {
    for (const sire of (Array.isArray(payload?.registered_sires) ? payload.registered_sires : [])) {
      if (!sire?.isHere) {
        lines.push(`- ${sire.name}（精方，不在场，若本轮登场）：${sireStarred.join('、')}`);
        continue;
      }
      const names = sire.descriptions && typeof sire.descriptions === 'object' ? ownFields(sire.descriptions, sireStarred) : [];
      if (names.length > 0) lines.push(`- ${sire.name}（精方）：${names.join('、')}`);
    }
  }
  return lines;
}

/** 已注册精方：在场的附描述，不在场的只是本轮相关的一行摘要 */
function buildSireTrackerBlock(payload, descriptionGuides) {
  const sires = Array.isArray(payload?.registered_sires) ? payload.registered_sires : [];
  if (sires.length === 0) return '';
  const fieldNames = parseDescriptionGuideFields(descriptionGuides?.sireDescription).map((field) => field.name);
  // 没有在场精方时（最常见：孕期中胎父不在）只送精简版：描述、virility 那些说明是给在场精方用的
  if (!sires.some((sire) => sire?.isHere)) {
    return [
      '[已注册精方]',
      '- payload.registered_sires 是已建档的精方，都不在场，只是本轮相关者的摘要（当前胎儿的父亲或认定父亲，或最近讯息提到）。',
      '- 他们在新讯息里登场时用 bsSetCharacterPresence {"female":"精方名字","isPresent":true}；bsAddSperm 的 male 写精方名字即可，种族与体型由档案带入。不要为精方调用其他工具。',
    ].join('\n');
  }
  return [
    '[已注册精方]',
    '- payload.registered_sires 是已建档的精方（精液提供者）。isHere=true 为在场，附描述；isHere=false 只是本轮相关者的摘要（当前胎儿的父亲或认定父亲，或最近讯息提到），不送描述。',
    '- bsAddSperm 的 male 写精方名字时，种族、衍生类型、体型与精子品质由档案带入：race 照填档案种族，maleBodySize 省略；传了不同的 race 也以档案为准。',
    '- virility 是精方天生的体质（精力与繁殖力），condition 是他此刻的状态（刚射过存量偏低、繁殖季与否、精力高峰），都只供叙事参考；精液此刻的稀稠与多寡以 condition 为准，没有 condition 就照常；condition 写存量偏低或很低时，这次射精的 bsAddSperm amount 要比他平时少（偏低约七成、很低约一半），描写也写成较稀；没有这些栏代表一般。sword 是阳物与同体型的人相比（偏大、硕大、偏小、短小；没有这栏代表与体型相称），体型契合由系统按剑对鞘计算。',
    `- 在场精方的描述用 bsSetDescription（female 填精方名字，只有 normalDescription），只传剧情影响到的字段${fieldNames.length > 0 ? `；描述还空着时按这些字段名建立：${fieldNames.join('、')}` : ''}。`,
    '- 精方进出场景照样用 bsSetCharacterPresence（female 填精方名字）：isHere=true 的精方在新讯息里出门、告别或已不在这一幕，就传 {"female":"精方名字","isPresent":false}；在场精方的完整档案每轮都会送，离场不切会一直占用提示词。精方不追踪生理需求、经期或妊娠，不要为精方调用其他工具。',
  ].join('\n');
}

export function buildTrackerSystemPrompt(basePrompt = '', descriptionGuides = null, payload = null) {
  const diaryEnabled = payload?.diary_enabled !== false;
  const metabolismGuide = buildTrackerMetabolismGuide(payload);
  const skillBaselinePrompt = payload?.skill_enabled === false ? '' : String(payload?.skill_baseline_prompt || '').trim();
  const parts = [
    [
      '[只结算新讯息]',
      '- recent_messages 里带 already_settled=true 的讯息，已在先前的追踪中结算过（时间、技能经验、生殖操作、衣着、关系、认知、日记等），只用来理解前情，不得再依据它们调用任何工具。',
      '- 带 new_message=true 的是这一轮要结算的新讯息，只为它们结算；新讯息没有写到的事，即使旧讯息里有，也不要再处理一次。',
      '- 回忆、倒叙、梦境、假设或想象的段落没有发生在现在：不推进时间，段落里的事件也不结算（不记性行为、受孕、经验、衣着等）。',
    ].join('\n'),
    payload?.time_frozen === true ? [
      '[时间已冻结]',
      '- 使用者已冻结时间推进：本轮不得推进时间，available_tools 里也没有 bsPassedTime。',
      '- 剧情里写到过了多久都不处理；其余工具（性行为、衣着、技能、日记、认知等）照常依新讯息结算。',
    ].join('\n') : [
      '[bsPassedTime 强制规则]',
      '- bsPassedTime 是每一轮 tracker 分析都必须优先考虑的第一工具。',
      '- 你应先根据 recent_messages 中的新讯息（new_message=true）判断本轮累计了多少分钟/小时/天，再调用 bsPassedTime 推进时间。',
      '- 只有在确认本轮完全没有任何可推进的时间量时，才允许不调用 bsPassedTime。',
      '- 时间线穿越（回到过去、跳到未来、时间回溯、时空旅行、魂穿等）：日历的跳动本身不推进时间（跳回十年前不是过了十年）；穿越前后身体实际度过的时间照常用 bsPassedTime 推进（例如在过去躲了半小时就推进 30 分钟），当场发生的事照常结算。回到原本时间线也只推进实际度过的时间。',
      '- 其他状态工具默认建立在时间推进之后，不要跳过 bsPassedTime 直接更新长程状态。\n- 例外：剧情里的操作（转胎、托高、破水、助产、手术产等）发生在这段时间中途、而推进时间可能先改变条件（例如胎儿入盆后只能小幅转动）时，把 bsPassedTime 拆成操作前、操作后两次调用，中间放该操作。',
      '- 在场切换要放在对的位置，因为这段时间里谁在场会影响需求、胎儿与其他结算：角色或精方在这段时间开头就登场、之后一起度过（回家、来访、重逢），先调用 bsSetCharacterPresence 设为在场，再调用 bsPassedTime；在这段时间结尾才离开，先 bsPassedTime 再设离场；中途登场或离开，把 bsPassedTime 拆成前后两次，中间放 bsSetCharacterPresence。',
    ].join('\n'),
    String(basePrompt || '').trim(),
    buildWorldBaselineBlock(payload?.world_baseline_prompt),
    buildContraceptionBlock(payload?.contraception_levels, true),
    metabolismGuide,
    // 名录只给名字：模型写 bsAddSperm.race 时需要词汇表，但每轮都发，不附辨识提示
    // 写实世界只有人类，不需要名录
    payload?.realistic_world === true ? '' : buildRaceCatalogBlock({ selection: payload?.race_catalog_selection || null }),
  ];
  if (skillBaselinePrompt) {
    parts.push([
      '[本聊天技能基准：高优先级]',
      skillBaselinePrompt,
      '- 此基准决定当前聊天应辨识、建立与成长的技能类型，优先于技能图鉴中「已有某项技能」所形成的暗示。',
      '- 不得为基准排除的类别调用 bsRegisterSkillDefinition 或 bsTrainSkill。既有技能资料只保留，不因基准变化而删除或主动降级。',
    ].join('\n'));
  }
  if (payload?.mainflow_context_snapshot) {
    parts.push([
      '[主流上下文快照使用规则]',
      '- payload.mainflow_context_snapshot 是 ST 主流上一轮生成 request 中已经发送或准备发送给模型的上下文快照。',
      '- 它仅用于补足本轮剧情、角色设定、已触发 worldinfo、模板注入、getwi/activewi 等主流背景。',
      '- 不要模仿主流输出风格，不要续写剧情；你的任务仍是根据 recent_messages 与 existing_state 返回 JSON tool_calls 来更新变量。',
      '- 若主流上下文快照与 tracker 工具调用规则、变量语义说明、existing_state 或 available_tools 冲突，必须以后者为准。',
      ...(Array.isArray(payload?.mainflow_new_worldinfo) && payload.mainflow_new_worldinfo.length > 0
        ? ['- payload.mainflow_new_worldinfo 是快照之后、由 recent_messages 最新回复才触发的世界书条目（快照里没有），与快照里的 worldinfo 同等看待，例如新登场人物的种族与身份。']
        : []),
    ].join('\n'));
  }
  const priorityNames = Array.isArray(payload?.priority_character_names)
    ? payload.priority_character_names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (priorityNames.length > 0) {
    parts.push([
      '[优先追踪角色]',
      `- 本轮先检查：${priorityNames.join('、')}。`,
      '- 这些名字是优先级，不是过滤器；其余已注册角色仍须依剧情和时间正常检查。',
      '- 若剧情明确显示某角色进入当前场景、开始参与当前互动或重新同行，调用 bsSetCharacterPresence，参数必须为 {"female":"角色名","isPresent":true}；明确离开、失联或转为幕外时才传 false。不要以 isHere 作为参数名，也不要无依据切换。',
    ].join('\n'));
  }
  const embryoTypeLorePrompt = payload?.realistic_world === true ? '' : buildEmbryoTypeLorePrompt(payload || {});
  if (embryoTypeLorePrompt) parts.push(embryoTypeLorePrompt);
  // 写实世界全是人类，没有依个体的物种；对方特别高大或矮小时仍可依工具说明传 maleBodySize
  if (payload?.realistic_world !== true) parts.push(buildBodySizeToolNote({ selection: payload?.race_catalog_selection || null }));
  const sireBlock = buildSireTrackerBlock(payload, descriptionGuides);
  if (sireBlock) parts.push(sireBlock);
  if (!diaryEnabled) {
    parts.push('[diary]\n- diary 系统当前已关闭（settings.diaryRecentLimit = 0）。本轮不要参考 diary，也不要调用 bsWriteDiary。');
  }
  parts.push([
    '[descriptions 更新规则]',
    '- 调用 bsSetDescription 时只传本轮受剧情、姿势、衣着、表情、身体状态或环境影响的字段，以及下方被点名待确认的字段；未传的字段保留原值。',
    '- 不要为了简短而漏掉确实受影响的字段；因上下文不足而没把握的字段不要编造，留给下次。',
  ].join('\n'));
  const realtimeLines = collectRealtimeDescriptionLines(payload, descriptionGuides);
  if (realtimeLines.length > 0) {
    parts.push([
      '[即时字段]',
      '- 以下角色的这些字段是即时状态（当下的动作、姿势、表情、情绪）：新讯息里有变化就用 bsSetDescription 更新，只传变了的字段；没变化不必照抄。注明「若本轮登场」的角色，在同一轮调用 bsSetCharacterPresence(isPresent=true) 时一并更新。',
      ...realtimeLines,
    ].join('\n'));
  }
  const staleDescriptionLines = collectStaleDescriptionLines(payload);
  if (staleDescriptionLines.length > 0) {
    parts.push([
      '[descriptions 待确认]',
      '- 以下字段超过一天（游戏时间）没有更新。请对照剧情检查：有变化就写新内容，确认没变就原样照抄（系统会记为已确认）。',
      ...staleDescriptionLines,
    ].join('\n'));
  }

  const presentSireNames = (Array.isArray(payload?.registered_sires) ? payload.registered_sires : [])
    .filter((sire) => sire?.isHere)
    .map((sire) => String(sire.name || '').trim())
    .filter(Boolean);
  const trackedNames = Array.isArray(payload?.tracked_females)
    ? payload.tracked_females.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (trackedNames.length > 0) {
    parts.push([
      '[逐角色检查清单]',
      `- 本轮必须在 character_checks 中逐一列出：${trackedNames.join('、')}。每名恰好一笔。`,
      '- status 只能是 no_change、updated、present 或 offscreen；清单只用于核对，任何实际状态变更仍必须同时用 tool_calls 调用对应工具。',
      // 精方没有生理状态要核对，只核对在场：不列进来模型就不会想到要切离场
      ...(presentSireNames.length > 0 ? [`- 在场精方也各列一笔：${presentSireNames.join('、')}。还在这一幕填 present；新讯息里已出门、告别或不在这一幕就填 offscreen，并同时调用 bsSetCharacterPresence(isPresent=false)。`] : []),
    ].join('\n'));
  }

  const pregnantInitNames = collectPregnantDescriptionInitNames(payload);
  // 给模型看的规范拿掉 *，免得把 * 当成字段名的一部分
  const pregnantGuide = stripDescriptionGuideStars(String(descriptionGuides?.pregnantDescription || '')).trim();
  if (pregnantInitNames.length > 0 && pregnantGuide) {
    parts.push([
      '[pregnantDescription 初始化]',
      `- 角色 ${pregnantInitNames.join('、')} 已进入妊娠相关阶段，但 pregnantDescription 仍为空。`,
      '- 这是「不要新增描述子字段」规则的唯一例外：请尽快用 bsSetDescription 按下方规范为该角色建立首批 pregnantDescription 子字段，只建立规范中列出的字段名。',
      '- 格式为以字段名为键的物件 {"字段名":"描述内容"}，不可用自然段，不可省略字段名。',
      '',
      '【pregnantDescription 规范】',
      pregnantGuide,
    ].join('\n'));
  }

  return parts.filter(Boolean).join('\n\n');
}

/**
 * 主流模型看得到状态 JSON 却没有 tracker 那份变量说明：这里只补它容易读错的数值与标记，
 * 且只附本轮真的出现的部分（有妊娠才讲胎儿、有衣柜才讲穿着、有心理才讲心理）
 */
function buildMainFlowFieldNotes(existingState = {}) {
  const profiles = Object.values(existingState || {}).map((item) => item?.profile || {});
  const lines = [
    '[状态字段速读]',
    '- 值为空的字段一律省略；认知与心理的省略/null 表示未知，不等于未孕或0。',
    '- cognitionRecords 保存角色信念，可以与事实不同；系统结果、真实胎父与胎数不自动成为角色知识。自然线索到点也不强制知孕；产程是系统结果，她认出自己在分娩之前不得写成她知道。',
    ...(profiles.some((profile) => profile.bodyFamiliarity) ? ['- bodyFamiliarity 是身体对各性伴的熟悉度（系统按次数、体型相容与时间算出，前三名）：只描述身体的记忆与反应，例如对谁的触碰更快有反应，不代表感情或爱意。'] : []),
    ...(profiles.some((profile) => profile.lastCondomResult || profile.lastEmergencyResult) ? ['- lastCondomResult/lastEmergencyResult 只在结算后的下一次叙事出现：是系统结果，不等于角色察觉；可据此描写合理可见的后果，不要求本轮处理。'] : []),
    '- base：vitality 活力、psyStress 情压，体质与精神倾向看 *LevelText；libido 性欲；figure 当下身材（含孕期变化，胸部大小与奶量无关）；uterinePressure 宫压（上限随孕程提高，越高越接近流产或分娩）；eggs 可受精卵数；sperms 为体内残留精液，value 每天自然衰减；penetrationState 为 idle 未插入／inserted 插入中／spent 已射精。',
  ];
  if (profiles.some((profile) => profile.metabolism)) {
    lines.push('- metabolism：excretion 泄意、hunger 饿意、sleep 困意、milk 乳意（孕晚期以前是乳房胀痛敏感，孕晚期起才可能溢乳）、odor 臭意、companionship 伴意，flux 为衍生种族的正负极需求；数值越高越急迫（一般上限 150）。需求高时可自然体现身体状态，何时处理由剧情决定，不要求每轮安排。');
  }
  if (profiles.some((profile) => profile.pregnant)) {
    lines.push(
      '- pregnant：pregnantDays 孕龄天数；laborPhase 产程内部阶段；laborPain 分娩疼痛 0-10，描写不得明显超过；amnionDurability 或胎儿上的 amnion 表示羊膜，已破即破水。',
      '- pregnant.laborEffort / pushFatigue（产程中）：push 表示产妇正在用力、rest 表示停下来喘口气；第一产程用力是白费力气；pushFatigue 用力疲劳 0-100，60 以上已经力竭、越推越没效果，描写可体现喘息与脱力。',
      '- fetuses 按子宫里由左到右排列，不代表出生顺序；presenting=true 是正在下降或娩出的那一胎。weight 胎重系数，1.0 为标准；affinity 母胎亲密度 -50～50，负值为排斥；health 胎儿健康（健壮／平稳／虚弱／危急），描写胎儿状况须一致，不写出刻度本身；resilience 顽强（很耐疏忽与伤害，可写母体挺着肚子照样奔波、胎儿稳如磐石）或脆弱（稍有闪失就会出事），没有就是一般；positionText、backSideText、tendencyAngleText 是胎位现况，描写须一致。',
    );
  }
  if (profiles.some((profile) => profile.base?.stage === '延产期' || Number(profile.pregnant?.extensionCount) > 0)) {
    lines.push('- 延产期：以特殊手段让逾期妊娠拖着不生；期间不会自然发动、不会破水，宫压再高也不会分娩。extensionCount 为已延产次数，extensionUntilDays 为这次延产到期的有效孕日。');
  }
  if (profiles.some((profile) => Number(profile.base?.uterineAtony) > 0)) {
    lines.push('- base.uterineAtony 子宫乏力级数：反复延产让子宫松弛无力，宫缩弱、产程慢、产后恢复久。');
  }
  if (profiles.some((profile) => profile.outfit)) {
    lines.push('- outfit.currentWearText 是当前穿着；mainItemId=null 表示衣着未记录，不代表裸体。pregFit.gap 低于 0 表示该维度（遮蔽、承托、容身、方便）已被孕期变化压过，只写成体感，不写数字。');
  }
  if (profiles.some((profile) => profile.psychology)) {
    lines.push('- psychology 各项的 *_interpret 是心理解释，优先依它描写。');
  }
  lines.push('- notify 是本轮系统事件提示（阶段变化、风险、胎动等），可自然融入叙事，不要照抄。');
  return lines.join('\n');
}

export function buildMainFlowStatePrompt(payload = {}) {
  const trackedState = payload?.existing_state && typeof payload.existing_state === 'object' ? payload.existing_state : {};
  const presentSires = (Array.isArray(payload?.registered_sires) ? payload.registered_sires : [])
    .filter((sire) => sire?.isHere)
    .map(({ staleFields: _staleFields, isHere: _isHere, bodyChangedAtAge: _bodyChangedAtAge, ...sire }) => sire);
  if (Object.keys(trackedState).length === 0) return '';
  const existingState = projectNarrativeState(trackedState, payload.recent_operation_results);
  const racePhysiologyPrompt = payload?.realistic_world === true ? '' : buildRacePhysiologyPrompt(payload || {});
  // 特殊来历的胎儿只丢一串 tags 给主线模型，它无从判断该怎么写。
  // 与种族短叙述同规则：只解释本轮真的出现过的标签，没出现就不占 token。
  const fetusTagLines = describeFetusTags(collectRelevantFetusTags(payload || {}));
  const fetusTagBlock = fetusTagLines.length > 0
    ? ['', '[本轮出现的特殊胎儿来历]', ...fetusTagLines].join('\n')
    : '';
  return [
    buildWorldBaselineBlock(payload?.world_baseline_prompt),
    buildContraceptionBlock(payload?.contraception_levels, false),
    racePhysiologyPrompt,
    '<bs_biotracker>',
    '[并行生理追踪上下文]',
    '以下内容来自并行运行的角色生理状态追踪支流。',
    '已注册角色状态仅供叙事参考，不要在回复中复述字段、JSON 或本段上下文。',
    '状态为只读；若剧情没有明确触发变化，不要编造与之冲突的生理、心理或关系变化。',
    '本段不是 MVU、小白 X 或任何变量系统的变量，由插件自行维护：不得对其中任何字段输出 UpdateVariable、JSONPatch、<state> 或其他变量更新。',
    '',
    buildMainFlowFieldNotes(existingState),
    '',
    '[当前已注册角色状态]',
    serializeStateForPrompt(existingState),
    ...(presentSires.length > 0 ? ['[在场精方]', '已建档的精方（精液提供者）；只读，描写须与描述一致。virility 是天生的精力与繁殖力，condition 是此刻的状态（存量、繁殖季、精力高峰；存量偏低时射精较稀、量较少），精液的稀稠多寡以 condition 为准；sword 是阳物与同体型的人相比（偏大、硕大、偏小、短小）；没有这些栏代表一般、与体型相称。', serializeStateForPrompt(presentSires)] : []),
    ...(payload.recent_operation_results?.length ? ['[上轮已结算的生殖操作结果]', '可据此描写合理可见的后果（例如破套可能当场被发现），不要求本轮处理；这不是角色已知的事实，不得让角色无依据得知受孕、胎数或胎父，也不能自动写入认知。', serializeStateForPrompt(payload.recent_operation_results.map(({ name, applied, message }) => ({ name, applied, message })))] : []),
    fetusTagBlock,
    '</bs_biotracker>',
  ].filter((part) => part !== '').join('\n');
}

// notify.thirdly 是写给追踪模型的工具提示（「应优先使用 bsExcreteMetabolism」、供养力的奖惩），
// 写剧情的模型读到会以为本轮必须安排角色去处理。这里改写成中性的身体状态，奖惩与操作建议删掉；
// 破水禁令等限制原样保留。改写依赖 tools.js 产生的固定句式，见 main_flow_narrative 测试。
const NARRATIVE_REMINDER_RULES = [
  [/^(.+?)有强烈的生理需求（(.+?)），应优先使用 bsExcreteMetabolism 缓解生理不适$/, '$1有明显的生理需求（$2）：可自然体现身体状态，不要求本轮处理'],
  [/^(.+?)仍有未被衍生代谢抵免的生理需求（(.+?)），可用 bsExcreteMetabolism 处理$/, '$1仍有生理需求（$2）：可自然体现，不要求本轮处理'],
  [/^(.+?)已达到(.+?)，应优先使用 bsExcreteMetabolism 进行解放$/, '$1已达到$2：可自然体现，不要求本轮处理'],
  [/^(.+?)渴望陪伴，可优先给予陪伴、交流或安抚$/, '$1渴望陪伴'],
  [/^(.+?)渴望陪伴，但当前臭意会妨碍社交舒适度$/, '$1渴望陪伴，但身上的气味令人在意'],
];
// 受精本身无从察觉（着床前身体没有任何变化），旁白读到「受精成功」会让角色提早出现孕兆、去验孕
const NARRATIVE_REMINDER_DROPS = [/供养力/, /^若释放量足够大/, /^清洁后再给予陪伴/, /\bbs[A-Z]\w*/, /受精成功/, /再度受精/, /结出了新的受精卵/];

/** 旁白不能调用工具：禁令留下，「须先调用某工具」这类句子或分句拿掉，仍带工具名的片段整段丢弃 */
export function narrativeReminders(text) {
  return String(text || '').split('；').map((part) => part.trim()).filter(Boolean).map((part) => {
    const rule = NARRATIVE_REMINDER_RULES.find(([pattern]) => pattern.test(part));
    if (rule) return part.replace(rule[0], rule[1]);
    const stripped = part.replace(/。[^。]*\bbs[A-Z]\w*[^。]*/g, '').replace(/，[^，。]*\bbs[A-Z]\w*[^。]*/g, (clause, at, whole) => (whole.slice(0, at).includes('：') ? '' : clause));
    return NARRATIVE_REMINDER_DROPS.some((pattern) => pattern.test(stripped)) ? '' : stripped;
  }).filter(Boolean).join('；');
}

/**
 * 主线叙事看到的角色状态：避孕结果只在刚结算后的下一次叙事出现（之后仍保存在资料里，
 * 但不再每轮提醒），代谢提醒改成中性描述
 */
export function projectNarrativeState(existingState = {}, recentResults = []) {
  const results = Array.isArray(recentResults) ? recentResults : [];
  const fresh = (tool, test = () => true) => new Set(results.filter((item) => item?.name === tool && test(item)).map((item) => item.female));
  const condomFresh = fresh('bsAddSperm', (item) => String(item.message || '').includes('deposit'));
  const emergencyFresh = fresh('bsAbortion');
  return Object.fromEntries(Object.entries(existingState || {}).map(([name, item]) => {
    if (!item?.profile) return [name, item];
    const profile = { ...item.profile };
    // 点名过期字段是给追踪模型的，主线不需要
    delete profile.staleDescriptionFields;
    // 身材上次改变时的年龄只给追踪模型判断能不能用 bsGrowBody
    if (profile.base?.bodyChangedAtAge !== undefined) {
      const { bodyChangedAtAge: _bodyChangedAtAge, ...narrativeBase } = profile.base;
      profile.base = narrativeBase;
    }
    if (!condomFresh.has(name)) delete profile.lastCondomResult;
    if (!emergencyFresh.has(name)) delete profile.lastEmergencyResult;
    // 还在经期阶段就已经有胎儿，是受精卵尚未着床：旁白看不到，等着床进入孕早期才出现
    if (profile.pregnant && MENSTRUAL_STAGES.includes(String(profile.base?.stage || ''))) delete profile.pregnant;
    // 胎儿事件纪录是给追踪模型防重复的，主线只看各胎的健康刻度
    if (profile.pregnant?.fetalEvents) {
      const { fetalEvents: _fetalEvents, ...pregnant } = profile.pregnant;
      profile.pregnant = pregnant;
    }
    if (profile.notify) {
      // 难产警示、阶段通知同样可能写着「可用某工具」，三栏一起改写
      const notify = Object.fromEntries(Object.entries(profile.notify)
        .map(([key, value]) => [key, typeof value === 'string' ? narrativeReminders(value) : value])
        .filter(([, value]) => String(value || '').trim()));
      profile.notify = Object.keys(notify).length > 0 ? notify : undefined;
    }
    return [name, { ...item, profile }];
  }));
}

/**
 * 状态 JSON 注入防线：序列化后转义 `</` 与换行——角色卡/注册内容（描述、日记、
 * 种族名等）可能含 `</bs_biotracker>` 或伪指令段，若不转义可提前闭合包裹标签
 * 向主线 LLM 注入任意指令（安全审查 P1，实测可达主模型）。
 */
function serializeStateForPrompt(state) {
  return JSON.stringify(state)
    .replace(/<\//g, '<\\/')
    .replace(/\r?\n/g, '\\n');
}

/** 追踪视角：孕龄到了自然察觉的时点时，附在角色档案上的提示 */
export const NATURAL_PREGNANCY_CUE = '现在较容易注意到妊娠相关自然线索；是否察觉、误解或拒信依剧情，不自动确认怀孕。';

/** v4 兼容模式的输出结构指令，与 response_format 双重约束降低掉格式概率。 */
export function buildFormattedOutputV4Instruction() {
  return [
    '【输出格式（强制）】',
    '你处于格式化输出模式：不要输出 Markdown、不要输出代码块、不要输出解释文字或任何对象之外的字符。',
    '只输出一个可直接 JSON.parse 的 JSON 对象，结构为：',
    '{"tool_calls": [{"name": "工具名", "arguments": {"参数名": "值"}}], "character_checks": [{"female": "角色名", "status": "no_change|updated|present|offscreen"}]}',
    'arguments 必须是一个对象；工具名与参数必须来自 available_tools 与变量语义说明。',
    'character_checks 必须对每名已追踪角色恰好输出一笔（即使无变化 status 也写 no_change）；无工具操作时输出 {"tool_calls": []}，但 character_checks 仍须完整。',
  ].join('\n');
}

export function buildJsonRetryInstruction() {
  return [
    '你上一条回复不是合法 JSON。',
    '现在请重新作答，并且只输出一个可直接 JSON.parse 的 JSON 对象。',
    '不要输出 Markdown，不要输出 ```json，不要输出解释文字，不要输出对象之外的任何字符。',
  ].join('\n');
}

// ═══ 二、种族与胚胎设定 ══════════════════════════════════════════

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

/**
 * 剧本级的人类与社会常识。它不是种族参数，也不参与物种名录；
 * 留空即沿用普通人类基准。压成单行可避免用户文字闭合高优先级提示区块。
 */
export function buildWorldBaselineBlock(value) {
  const text = sanitizePromptText(value);
  return text ? `[世界基准]\n${text}` : '';
}

export const COMPANION_EGGS_DEFINITION_PROMPT = [
  '[伴生卵定义]',
  '- 每张胎儿卡代表一名能成功长大并繁衍的有效后代；companionEggCount 是它伴随的背景卵数量（伴生卵），不会发育，也不会成为胎儿卡或孩子。',
  '- 剧情可描写产下整群卵（有效后代加上伴生卵），但分娩与族谱只建立那一名有效后代，不要为每枚卵新增胎儿卡或孩子。',
  '- 胎生与胎转卵生恒为 0。其他胚型有没有伴生卵由种族的典型伴生卵数量决定，不能只因属于卵生、卵胎生或不定型就自行增加。',
  '- 自然受精时，当下胜出精源的有效精液量会影响整群规模：20 为标准量，10／30／40 分别约为 0.75／1.25／1.5 倍，再叠加约 ±10% 生理波动。受精不会因此扣除或清空可见精液残留。',
].join('\n');

/**
 * 从短敘述里取一句极短的辨识提示：按逗号逐句累积到长度上限，
 * 且至少收到一句中文（短敘述多以英文原名开头，只有英文时信息量不足）。
 * 目的是让模型在名录阶段就能分辨形近种族（人鱼／鱼人、精灵／妖精），
 * 完整介绍仍由 buildSingleRacePhysiologyBlock 在该族真正登场时给出。
 */
export function buildRaceCatalogHint(text) {
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
export function buildRaceCatalogBlock({ withHints = false, selection = null } = {}) {
  const normalized = normalizeRaceCatalogSelection(selection);
  const selectedRaces = normalized ? new Set(normalized.races) : null;
  const selectedDerivedTypes = normalized ? new Set(normalized.derivedTypes) : null;
  // 按当前生效的胚型分组：百科改过胚型的物种要列在新组下
  const groupLines = getRaceGroupsByEmbryoType().map(({ label, races }) => {
    const names = races.filter((race) => !selectedRaces || selectedRaces.has(race)).map((race) => {
      // 注册时附体型与体态，方便选种族、填 base.bodySize；追踪请求不带提示以省 token
      const hint = withHints ? [buildRaceCatalogHint(getRaceIntroductionLine(race)), getRaceCatalogBodyTag(race)].filter(Boolean).join('·') : '';
      return hint ? `${race}(${hint})` : race;
    });
    return names.length > 0 ? `- ${label}: ${names.join('、')}` : '';
  }).filter(Boolean);
  const derivedTypes = DERIVED_TYPE_RACES.filter((type) => !selectedDerivedTypes || selectedDerivedTypes.has(type));
  if (groupLines.length === 0 && derivedTypes.length === 0) return '';
  return [
    '[可用种族名录]',
    '以下是本故事启用的系统内建物种，写 base.race、fatherRace、bsAddSperm.race 时应从下列项目中选择。',
    ...groupLines,
    derivedTypes.length > 0 ? `- 衍生类型（写作 [类型]种族，如 [血族]人类）: ${derivedTypes.map((type) => {
      const hint = withHints ? buildRaceCatalogHint(getDerivedTypeIntroductionLine(type)) : '';
      return hint ? `${type}(${hint})` : type;
    }).join('、')}` : '',
    '名录外的形象请就近归入本次名录中最相似的一项，不要自创种族名——自创名称在系统内查不到生理参数。',
    '混血以 x 分隔，装饰子项以 - 附加；两侧只能使用本次名录列出的种族名。',
  ].filter(Boolean).join('\n');
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

/** 经期加上乏情：乏情期在月经之后，不排卵、不受孕；没有乏情就只报经期。季内多轮的写出发情季长短 */
function formatCycleWithDormancy(ratio, dormancyDays, seasonCycles = 1) {
  const dormancy = Math.round(Math.max(0, Number(dormancyDays) || 0));
  if (dormancy <= 0) return formatCycleDays(ratio);
  const active = Math.round(28 * Number(ratio || 1));
  const cycles = Math.max(1, Math.round(Number(seasonCycles) || 1));
  if (cycles <= 1) return `${active}天左右；月经后另有约 ${dormancy} 天乏情期（不排卵、不受孕），约 ${active + dormancy} 天才有一次受孕机会`;
  return `${active}天左右；繁殖季连续约 ${cycles} 轮（约 ${active * cycles} 天，每轮都能受孕），之后进入乏情期约 ${dormancy} 天（不排卵、不受孕），约 ${active * cycles + dormancy} 天一季`;
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

/** 物种层面只知道恢复系数；实际天数在分娩当下再乘活力、经产与胎数因子 */
function formatRecoveryBaseline(coefficient) {
  const value = Number.isFinite(Number(coefficient)) && Number(coefficient) > 0 ? Number(coefficient) : 1;
  return `基准${formatRecoveryDays(computePostpartumRecoveryDays({ recoveryCoefficient: value }))}（恢复系数 ${formatNumber(value)}；实际再依活力等级、经产次数与该次胎数调整）`;
}

const BODY_SIZE_HEIGHT_REFERENCES = Object.freeze(['30 cm 以下', '约 90–120 cm', '约 120–150 cm', '约 150–190 cm', '约 190–250 cm 或人身加大型下半身', '约 3–6 m', '6 m 以上']);

function formatBodySizeLevel(value) {
  const num = Number(value);
  const index = Math.max(0, Math.min(BODY_SIZE_LEVEL_NAMES.length - 1, Math.round(num) - 1));
  return `${formatNumber(num, 1)} 级（${BODY_SIZE_LEVEL_NAMES[index]}，${BODY_SIZE_HEIGHT_REFERENCES[index]}）`;
}

const BODY_PLAN_DESCRIPTIONS = Object.freeze({
  humanoid: '胸、腰、臀三围都适用，孕肚是前腹隆起',
  hybrid: '人类上身接非人下半身（马身、蛛身、蛇尾、鱼尾、触腕等），胸围适用；下半身为兽躯者子宫与孕肚在兽躯，下半身为尾或触腕者孕肚在前腹、没有腿',
  beast: '动物或异形体型，不套用人类的三围与孕肚描写',
  any: '形体不固定，能变化形体或同族形态差异大，按个体当下的形态描写',
});

/** 体态：告诉模型这个种族怎么出场、孕肚长在哪；能变形的种族记常态 */
function getBodyPlanText(bodyPlan) {
  const label = RACE_BODY_PLAN_LABELS[bodyPlan];
  return label ? `${label}：${BODY_PLAN_DESCRIPTIONS[bodyPlan]}。` : '';
}

/** 注册名录的辨识提示后缀：「5级·半人形」，有变化态写「4→7级」 */
function getRaceCatalogBodyTag(race) {
  const profile = getRacePhysiologyProfile(race) || {};
  const size = profile.bodySize === null || profile.bodySize === undefined ? '可变'
    : profile.bodySize === BODY_SIZE_INDIVIDUAL ? '依个体'
      : `${profile.bodySize}${typeof profile.altFormBodySize === 'number' ? `→${profile.altFormBodySize}` : ''}级`;
  const plan = RACE_BODY_PLAN_LABELS[profile.bodyPlan];
  return plan ? `${size}·${plan}` : size;
}

/** 体型 1–7 级，人类为 4；只供叙述参考，不限制交合与受孕 */
function getBodySizeText({ bodySize, bodySizeSd, altFormBodySize } = {}) {
  if (bodySize === null || bodySize === undefined) return '可变，能随对象调整形体，与任何对象都恰好契合。';
  if (bodySize === BODY_SIZE_INDIVIDUAL) return '依个体而定：同族大小差异极大，按子项或个体判断。';
  const hasAltForm = typeof altFormBodySize === 'number';
  const parts = [`${hasAltForm ? '常态 ' : ''}${formatBodySizeLevel(bodySize)}`];
  const sd = Number(bodySizeSd);
  if (Number.isFinite(sd) && sd > 0) parts.push(`族内个体差异约 ±${formatNumber(sd)} 级`);
  if (hasAltForm) parts.push(`变化态 ${formatBodySizeLevel(altFormBodySize)}`);
  return `${parts.join('；')}。1–7 级，人类为 4。`;
}

/**
 * 追踪端的 maleBodySize 提示：依当前生效资料（含百科覆写）列出依个体的物种，
 * 插入当下精方还不在状态里、他的生理块不会送出，模型只能靠这一段知道要不要填体型。
 */
export function buildBodySizeToolNote({ selection = null } = {}) {
  const individual = getAllRaces().filter((race) => isRaceInCatalogSelection(selection, race)
    && getRacePhysiologyProfile(race)?.bodySize === BODY_SIZE_INDIVIDUAL);
  return [
    '[体型参数]',
    individual.length > 0
      ? `- bsAddSperm insert 时，精方种族体型为依个体者必须按剧情传 maleBodySize：${individual.join('、')}。未收录的自订种族同样要传。`
      : '- bsAddSperm insert 时，精方为未收录的自订种族必须按剧情传 maleBodySize。',
    '- 其余种族只在剧情写明对方比同族明显高大或矮小时传；精方是已注册角色时省略。',
  ].join('\n');
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

  return `${overall}。${summary} ${getOvulationText(safeOvulation)} ${getIdenticalText(safeIdentical)}`;
}

// 自然排卵每周期只有 1 颗；额外排卵只在高潮时按当下活力排出，异卵多胎主要由此而来
function getOvulationText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '异卵多胎倾向未知';
  if (num <= 0) return '每周期只排 1 颗卵，高潮也不会额外排卵，异卵多胎几乎不会发生。';
  if (num <= 1) return '平时只排 1 颗卵；高潮时可额外排出 1 颗，异卵双胎主要由此而来。';
  if (num <= 3) return '平时只排 1 颗卵；高潮时可额外排出数颗，高潮前后同房容易形成异卵多胎。';
  if (num <= 6) return '平时只排 1 颗卵；高潮时一次排出多颗，高潮前后同房常形成异卵多胎。';
  return '平时只排 1 颗卵；高潮时一次排出大量卵，高潮前后同房几乎必成一窝。';
}

function getIdenticalText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '同卵倾向未知';
  if (num <= 5) return '同卵分裂倾向很低，由单胎扩增出的同卵多胎较少见。';
  if (num <= 20) return '同卵分裂倾向偏低到中等，存在由单胎扩增为同卵双胎的机会。';
  if (num <= 50) return '同卵分裂倾向明显，受精后继续分裂形成同卵多胎并不罕见。';
  return '同卵分裂倾向很高，单一受精卵扩增成复数胎儿的概率相当显著。';
}

/**
 * 百科编辑器的即时换算：把一个栏位的数值翻成白话（孕期几天、产后几天、负担多重…），
 * 与资料页、提示词同一套句子。value 为空字串或无效时回空字串
 */
export function describeRaceFieldValue(field, value, { autoFetalBulkRatio = null } = {}) {
  const empty = value === '' || value === undefined;
  const num = Number(value);
  switch (field) {
    case 'menstrualLengthRatio': return empty || !(num > 0) ? '' : `周期${formatCycleDays(num)}（不含乏情），受精后约 ${formatNumber(calculateImplantationDays(28 * num))} 天着床。`;
    case 'dormancyDays': return empty ? '' : num > 0 ? `每季结束后进入乏情期约 ${Math.round(num)} 天，这段时间不排卵、不受孕。` : '没有乏情期：月经结束就进入下一轮。';
    case 'seasonCycles': return empty || !(num >= 1) ? '' : Math.round(num) <= 1 ? '一季只有一轮：每次月经后就进入乏情期（乏情天数为 0 时不影响）。' : `繁殖季内连续 ${Math.round(num)} 轮周期，跑满才进入乏情期（乏情天数为 0 时不影响）。`;
    case 'gestationSpeciesSpeed': return empty || !(num > 0) ? '' : `足月${formatGestation(num)}。`;
    case 'recoveryCoefficient': return empty || !(num > 0) ? '' : `产后${formatRecoveryDays(computePostpartumRecoveryDays({ recoveryCoefficient: num }))}才回到月经周期（实际再依活力、经产与胎数调整）。`;
    case 'birthDifficulty': return empty ? '' : getBirthDifficultyText(num);
    case 'breedTolerance': return empty ? '' : getBreedToleranceText(num);
    case 'impregnationDifficulty': return empty ? '' : getImpregnationDifficultyText(num);
    case 'orgasmOvulationAmount': return empty ? '' : getOvulationText(Math.round(num));
    case 'identicalProbability': return empty ? '' : getIdenticalText(num);
    case 'companionEggsMean': return empty ? '' : num <= 0 ? '没有伴生卵：一胎就是一个孩子。' : `平均每名后代旁伴随约 ${formatNumber(num)} 颗不会发育的背景卵，一窝看起来会大得多。`;
    case 'genderRatio': return empty ? getGenderRatioText(null) : getGenderRatioText(num);
    case 'fetalBulkRatio': {
      if (!empty && value !== null) return num > 0 ? getFetalBulkText(num) : '';
      return Number.isFinite(autoFetalBulkRatio)
        ? `自动（按额外排卵、同卵率与伴生卵推算）：${getFetalBulkText(autoFetalBulkRatio)}。`
        : '自动：按额外排卵、同卵率与伴生卵推算。';
    }
    case 'bodySize': return value === null ? '可变：能随对象调整形体，与任何对象都恰好契合。'
      : value === BODY_SIZE_INDIVIDUAL ? '依个体：同族大小差异极大，按子项或个体判断，插入时要给体型。'
        : `${formatBodySizeLevel(num)}。`;
    case 'bodySizeSd': return empty ? '' : num > 0 ? `族内个体约有 ±${formatNumber(num)} 级的高矮差异；注册时按这个分布抽个体体型。` : '族内个体大小一致。';
    case 'altFormBodySize': return empty || value === null ? '没有变化态。' : `变身后 ${formatBodySizeLevel(num)}；以变化态交合时，契合、套子与子宫容量按这个体型算。`;
    case 'bodyPlan': return getBodyPlanText(value);
    default: return '';
  }
}

/** 每胎占肚子多少：给模型描写孕肚大小用，胎重本身不受影响 */
function getFetalBulkText(ratio) {
  const value = formatNumber(ratio);
  if (ratio < 0.995) return `每胎约标准胎的 ${value}，一窝幼崽个头小，孕肚比同胎数的人类小`;
  if (ratio > 1.005) return `每胎约标准胎的 ${value}，个头大，孕肚比同胎数的人类大`;
  return '每胎与人类标准胎相当';
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

function getInheritanceModeText(race) {
  switch (getRaceInheritanceMode(race)) {
    case 'paternal':
      return '雄核；仅一方具核型时保留精方种族。';
    case 'maternal':
      return '雌核；仅一方具核型时保留卵方种族。';
    default:
      return '一般；混血种族固定视为一般。';
  }
}

function isSameRaceGroup(leftRace, rightRace) {
  const left = getRaceComponents(leftRace).sort();
  const right = getRaceComponents(rightRace).sort();
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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
    `- 经期长度: ${formatCycleWithDormancy(profile.menstrualLengthRatio, profile.dormancyDays, profile.seasonCycles)}`,
    `- 妊娠长度: ${formatGestation(profile.gestationSpeciesSpeed)}`,
    `- 产后恢复时间: ${formatRecoveryBaseline(profile.recoveryCoefficient)}`,
    `- 分娩难度: ${getBirthDifficultyText(profile.birthDifficulty)}`,
    `- 承载耐受: ${getBreedToleranceText(profile.breedTolerance)}（数值 ${formatNumber(profile.breedTolerance)}；越高则孕期越不被削弱）`,
    `- 受精难度: ${getImpregnationDifficultyText(profile.impregnationDifficulty)}`,
    `- 遗传核型: ${getInheritanceModeText(race)}`,
    `- 典型伴生卵数量: ${formatNumber(getCompanionEggsMeanByRace(race))}（每名有效后代伴随的背景卵；自然受精会依有效精液量调整后再作约 ±10% 波动；均值 0 恒为 0）`,
    `- 胎儿份量: ${getFetalBulkText(getFetalBulkRatioByRace(race))}（只影响孕肚大小，胎重照常）`,
    `- 多产性: ${getProlificacyText(profile.orgasmOvulationAmount, profile.identicalProbability)}；额外排卵倾向 ${formatNumber(profile.orgasmOvulationAmount)}（高潮时按当下活力占比排出，每周期黄体期前、黄体期各一次），同卵多胎概率 ${formatNumber(profile.identicalProbability)}%`,
    `- 性别比: ${getGenderRatioText(profile.genderRatio)}`,
    `- 体型: ${getBodySizeText(profile)}`,
    profile.bodyPlan ? `- 体态: ${getBodyPlanText(profile.bodyPlan)}` : '',
  ].filter(Boolean).join('\n');
}

export function buildSingleRacePhysiologyText(race) {
  return buildSingleRacePhysiologyBlock(race);
}

function buildHybridAverageBlock(race, bloodline = null) {
  const merged = getMergedRacePhysiologyProfile(race, bloodline);
  if (!merged) return '';
  return [
    '【混血加权参考】',
    '- 以下按血脉比例加权，孕期按天数加权；没有比例时才按基种族均分。',
    `- 血脉比例: ${sanitizePromptText(formatBloodline(race, bloodline))}`,
    merged.hasUnknownRace ? '- 注意：该混血包含未收录种族，以下平均数值不完整，仅供粗略参考。' : '',
    `- 平均经期长度: ${formatCycleWithDormancy(merged.menstrualLengthRatio, merged.dormancyDays, merged.seasonCycles)}`,
    `- 平均妊娠长度: ${formatGestation(merged.gestationSpeciesSpeed)}`,
    `- 平均产后恢复时间: ${formatRecoveryBaseline(merged.recoveryCoefficient)}`,
    `- 平均分娩难度: ${getBirthDifficultyText(merged.birthDifficulty)}`,
    `- 平均承载耐受: ${getBreedToleranceText(merged.breedTolerance)}`,
    `- 平均受精难度: ${getImpregnationDifficultyText(merged.impregnationDifficulty)}`,
    `- 混血典型伴生卵数量: ${formatNumber(getCompanionEggsMeanByRace(race, bloodline))}（先由血脉占比最高的成分决定胚型（平手取孕期较长者，再平手取母系）；胎生／胎转卵生恒为 0，其余按血脉比例对整群规模做加权几何平均）`,
    `- 胎儿份量参考: ${getFetalBulkText(getFetalBulkRatioByRace(race, bloodline))}（按血脉比例加权，只影响孕肚大小）`,
    `- 平均多产性参考: ${getProlificacyText(merged.orgasmOvulationAmount, merged.identicalProbability)}；额外排卵倾向 ${formatNumber(merged.orgasmOvulationAmount)}（高潮时按当下活力占比排出，每周期黄体期前、黄体期各一次），同卵多胎概率 ${formatNumber(merged.identicalProbability)}%`,
    `- 平均性别比参考: ${getGenderRatioText(merged.genderRatio)}`,
    `- 平均体型参考: ${getBodySizeText(merged)}`,
    merged.bodyPlan ? `- 体态参考: ${getBodyPlanText(merged.bodyPlan)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 人类的生理块只在名录勾选了人类时才送：奇幻设定需要拿它与其他物种比较，
 * 现代设定取消勾选后由模型的常识与世界基准负责。其他物种的生理块不受名录影响，照常送出。
 */
function shouldSendRaceBlock(race, selection) {
  return race !== '人类' || isRaceInCatalogSelection(selection, '人类');
}

function buildRacePhysiologyLoreBlock(race, includeAverage = true, selection = null) {
  const value = String(race || '').trim();
  if (!value) return '';
  const components = getRaceComponents(value);
  if (components.length === 0) return '';
  if (components.length === 1) {
    if (!shouldSendRaceBlock(components[0], selection)) return '';
    return [`[种族生理补充设定]`, buildSingleRacePhysiologyBlock(components[0])].join('\n');
  }
  return [
    '[种族生理补充设定]',
    `该角色为混血/复合种族：${components.map(sanitizePromptText).join(' x ')}`,
    '请同时理解各族生理参数，不要把混血直接脑补成单一物种。',
    ...components.filter((part) => shouldSendRaceBlock(part, selection)).map((part) => buildSingleRacePhysiologyBlock(part)).filter(Boolean),
    includeAverage ? buildHybridAverageBlock(value) : '',
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
    `该衍生类型体质上豁免的普通需求：${exemptions.length > 0 ? exemptions.join(' / ') : '无'}；flux 自成一项，不顶替其他需求。未豁免的需求仍会作为 metabolism 保留。`,
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
  const hasPregnancyState = fetuses.length > 0 || fertilizationDays > 0 || ['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '第一产程', '第二产程', '第三产程', '假孕期'].includes(stage);
  if (hasPregnancyState) return '';

  const motherRace = String(base.race || '').trim();
  if (!motherRace) return '';
  const motherProfile = getMergedRacePhysiologyProfile(motherRace, base.bloodline) || {};
  const motherInheritanceMode = getRaceInheritanceMode(motherRace);
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
    `- 卵方遗传核型: ${getInheritanceModeText(motherRace)}`,
  ];

  heteroSperms.forEach((sperm, index) => {
    const fatherRace = String(sperm?.race || '').trim();
    const fatherProfile = getMergedRacePhysiologyProfile(fatherRace, sperm?.bloodline) || {};
    const fatherDifficulty = Number(fatherProfile?.impregnationDifficulty);
    const fatherEmbryoType = getEmbryoTypeByRace(fatherRace);
    const fatherInheritanceMode = getRaceInheritanceMode(fatherRace);
    const crossSpecies = Boolean(profile.immune?.crossSpecies);
    // 与 calculateFertilizationPreview 同一套：异族取双方难度的几何平均再乘跨种倍率，胚型不同再乘一次
    const embryoTypeMismatch = motherEmbryoType !== fatherEmbryoType;
    let effectiveDifficulty = Math.sqrt((Number.isFinite(motherDifficulty) ? motherDifficulty : 1.0) * (Number.isFinite(fatherDifficulty) ? fatherDifficulty : 1.0)) * CROSS_RACE_DIFFICULTY_MULTIPLIER;
    if (embryoTypeMismatch) effectiveDifficulty *= EMBRYO_TYPE_MISMATCH_MULTIPLIER;
    const ancestry = deriveFetusAncestry(base, sperm, { crossSpecies });
    const fetusRace = ancestry.race;
    const fetusProfile = getMergedRacePhysiologyProfile(fetusRace, ancestry.bloodline) || {};
    const fetusGenderRatio = fetusProfile?.genderRatio;
    lines.push(
      [
        `【异种精液 ${index + 1}】`,
        `- 精方: ${sanitizePromptText(String(sperm?.male || '未知'))} / ${sanitizePromptText(fatherRace)}`,
        `- 精方受精难度: ${formatNumber(fatherDifficulty)} (${getImpregnationDifficultyText(fatherDifficulty)})`,
        `- 精方胚胎类型: ${fatherEmbryoType}`,
        `- 精方遗传核型: ${getInheritanceModeText(fatherRace)}`,
        crossSpecies
          ? `- 系统受精难度计算: 卵方万族相容，跨种与胚胎类型不同都不加难度，只看母体 ${formatNumber(motherDifficulty)}`
          : `- 系统受精难度计算: √(母体 ${formatNumber(motherDifficulty)} × 精方 ${formatNumber(fatherDifficulty)}) × 跨种 ${formatNumber(CROSS_RACE_DIFFICULTY_MULTIPLIER)}${embryoTypeMismatch ? `，且因胚胎类型不同（${motherEmbryoType} vs ${fatherEmbryoType}）再 ×${formatNumber(EMBRYO_TYPE_MISMATCH_MULTIPLIER)}` : ''} = ${formatNumber(effectiveDifficulty)}（同族只看母体；精量越多难度越低）`,
        crossSpecies
          ? '- 核型判定: 卵方有万族相容，不论核型一律混血。'
          : `- 核型判定: 精方 ${fatherInheritanceMode} / 卵方 ${motherInheritanceMode}；双方皆一般或皆具核型时混血，只有一方具核型时雄核保留精方、雌核保留卵方。`,
        `- 核型判定后胎儿种族: ${sanitizePromptText(fetusRace)}`,
        `- 后代血脉: ${sanitizePromptText(formatBloodline(fetusRace, ancestry.bloodline, ancestry.bloodlineSource))}`,
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
  const experience = profile.experience || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return '';

  const motherRace = String(base.race || '').trim();
  const motherProfile = getMergedRacePhysiologyProfile(motherRace, base.bloodline);
  if (!motherRace || !motherProfile) return '';

  let gestationDaysAccumulator = 0;
  let birthAccumulator = 0;

  // 下面的累加与平均方式必须跟 tools.js 的妊娠偏移一致，否则提示词报的数值和实际推进对不上
  for (const fetus of fetuses) {
    const raceProfile = getMergedRacePhysiologyProfile(fetus?.race, fetus?.bloodline) || {};
    // 妊娠取「天数平均」：胎重只影响胎儿自己的发育天数，不参与族速平均
    const fetusGestationSpeed = Math.max(GESTATION_SPEED_MIN, Math.min(GESTATION_SPEED_MAX, Number(raceProfile?.gestationSpeciesSpeed) || 1.0));
    gestationDaysAccumulator += 280 / fetusGestationSpeed;
    // 分娩难度同样不按胎重加权
    birthAccumulator += Math.max(0.1, Math.min(100, Number(raceProfile?.birthDifficulty) || 1.0));
  }

  const fetusCount = Math.max(1, fetuses.length);
  const averageGestationDays = gestationDaysAccumulator / fetusCount;
  const averageGestation = averageGestationDays > 0 ? 280 / averageGestationDays : 1.0;
  const averageBirth = birthAccumulator / fetusCount;
  const fetusCountModifier = 1 + ((fetuses.length - 1) * 0.08);
  const toleranceCountModifier = Math.max(0.6, 1 - ((fetuses.length - 1) * 0.04));

  const baseGestationSpeciesSpeed = Math.max(GESTATION_SPEED_MIN, Math.min(GESTATION_SPEED_MAX, Number(motherProfile.gestationSpeciesSpeed) || 1.0));
  const baseBirthDifficulty = Math.max(0.1, Math.min(100, Number(motherProfile.birthDifficulty) || 1.0));
  const baseBreedTolerance = Math.max(0.1, Math.min(100, Number(motherProfile.breedTolerance) || 1.0));

  // 妊娠速度与分娩难度完全由胎儿族决定，母体 base 不参与相乘（tools.js 同）；
  // 只有承载耐受是在母体 base 上做偏移
  const shiftedGestationSpeciesSpeed = Math.max(GESTATION_SPEED_MIN, Math.min(GESTATION_SPEED_MAX, averageGestation));
  const shiftedBirthDifficulty = Math.max(0.1, Math.min(100, averageBirth * fetusCountModifier));
  // 承载耐受只取母体自身 x 胎数修正（与 tools.js 同）：胎儿族的承载力不是母体的加成
  const shiftedBreedTolerance = Math.max(0.1, Math.min(100, baseBreedTolerance * toleranceCountModifier));
  // 产后恢复按分娩当下计算（与 tools.js 同）：母体恢复系数 × 活力 × 经产 × 这次胎数
  const recoveryInput = {
    recoveryCoefficient: getRecoveryCoefficientByRace(motherRace, base.bloodline),
    vitalityLevel: base.vitalityLevel,
    priorBirths: (Number(experience.naturalBirthExperience) || 0) + (Number(experience.surgicalBirthExperience) || 0),
  };
  const baseRecoveryDays = computePostpartumRecoveryDays({ ...recoveryInput, fetusCount: 1 });
  const shiftedRecoveryDays = computePostpartumRecoveryDays({
    ...recoveryInput,
    fetusCount: fetuses.length + (Number(pregnant.deliveredCount) || 0),
  });

  const gestationBaseDays = 280 / baseGestationSpeciesSpeed;
  const gestationShiftedDays = 280 / shiftedGestationSpeciesSpeed;
  const hasGestationShift = Math.abs(gestationShiftedDays - gestationBaseDays) >= 0.0001;
  const hasBirthShift = Math.abs(shiftedBirthDifficulty - baseBirthDifficulty) >= 0.0001;
  const hasRecoveryShift = Math.abs(shiftedRecoveryDays - baseRecoveryDays) >= 1;
  if (!hasGestationShift && !hasBirthShift && !hasRecoveryShift) return '';

  return [
    '[妊娠生理偏移补充设定]',
    '以下为系统在怀孕后依据胎儿种族、胎数与胎重，对母体生理参数产生的偏移结果。',
    `- 母体种族: ${sanitizePromptText(motherRace)}`,
    `- 妊娠长度偏移: ${describeShift(gestationShiftedDays, gestationBaseDays, (value) => formatGestation(280 / value))}`,
    `- 分娩难度偏移: ${describeShift(shiftedBirthDifficulty, baseBirthDifficulty, (value) => `${formatNumber(value)}（${getBirthDifficultyText(value)}）`)}`,
    `- 承载耐受偏移: ${describeShift(shiftedBreedTolerance, baseBreedTolerance, (value) => `${formatNumber(value)}（${getBreedToleranceText(value)}）`)}`,
    `- 预计产后恢复时间: ${describeShift(shiftedRecoveryDays, baseRecoveryDays, (value) => formatRecoveryDays(value))}`,
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

/**
 * 需求免疫的角色，本人的衍生需求（flux）说明一律不发。
 * 原始状态与 tracker 投影都保留 immune.metabolism（投影只留这一项）。
 * 只管角色本人——精源、胎儿父系、子女的衍生类型描述的是别人，照发。
 */
export function isOwnMetabolismHidden(profile) {
  return profile?.immune?.metabolism === true;
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
      if (!isOwnMetabolismHidden(profile)) pushDerivedType(base.derivedType);
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
  // 同一种族与比例只出一块，列出用到它的角色：三胞胎或同一父源的多份精液不重复送整段参考
  const weighted = new Map();
  for (const [owner, character] of Object.entries(payload.existing_state || {})) {
    const profile = character?.profile || {};
    const records = [profile.base, ...(Array.isArray(profile.base?.sperms) ? profile.base.sperms : []),
      ...(Array.isArray(profile.pregnant?.fetuses) ? profile.pregnant.fetuses : [])];
    for (const record of records) {
      if (!record?.bloodline || getRaceComponents(record.race).length <= 1) continue;
      const label = formatBloodline(record.race, record.bloodline, record.bloodlineSource);
      const key = `${record.race}|${label}`;
      if (!weighted.has(key)) weighted.set(key, { record, label, owners: new Set() });
      weighted.get(key).owners.add(owner);
    }
  }
  const weightedRaces = new Set([...weighted.values()].map(({ record }) => record.race));
  const blocks = (includeAllRelevant ? races : races.slice(0, 1)).map((race) => buildRacePhysiologyLoreBlock(race, !weightedRaces.has(race), payload?.race_catalog_selection || null)).filter(Boolean);
  const weightedBlocks = [...weighted.values()].map(({ record, owners }) => [
    `【${[...owners].map(sanitizePromptText).join('、')} / ${sanitizePromptText(record.race)}】`,
    buildHybridAverageBlock(record.race, record.bloodline),
  ].join('\n'));
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
    COMPANION_EGGS_DEFINITION_PROMPT,
    ...blocks,
    ...weightedBlocks,
    ...derivedBlocks,
    ...spermBlocks,
    ...pregnancyBlocks,
    '</bs_race>',
  ].join('\n\n');
}

export function buildRegistryRacePhysiologyPrompt(payload = {}, { selection = null } = {}) {
  const races = collectRelevantRaces(payload, { includeExistingState: false, includeCurrentCharacter: false });
  const derivedTypes = collectRelevantDerivedTypes(payload, { includeExistingState: false, includeCurrentCharacter: false });
  const blocks = races.map((race) => buildRacePhysiologyLoreBlock(race, true, selection)).filter(Boolean);
  const derivedBlocks = derivedTypes.map((derivedType) => buildDerivedFluxLoreBlock(derivedType)).filter(Boolean);
  if (blocks.length === 0 && derivedBlocks.length === 0) return '';
  return [
    '<bs_race>',
    '以下文本是本次注册目标角色专用的种族生理设定，请视为高优先级规则。',
    '注册时只参考当前目标角色相关种族，不要混入其他已注册角色的种族设定。',
    COMPANION_EGGS_DEFINITION_PROMPT,
    ...blocks,
    ...derivedBlocks,
    '</bs_race>',
  ].join('\n\n');
}

const EMBRYO_TYPE_REFERENCE = {
  胎生: [
    '胎生 (Viviparous)',
    '-遵循常規哺乳類生理，未受精時子宮內膜脫落出血。表現為週期性的血液排出與腰腹墜脹，伴隨明顯的激素波動。',
    '-胚胎依賴胎盤與母體循環交換營養；多胎妊娠時需注意絨毛膜與羊膜共用所引發的發育風險。',
    '-新生兒出生時生理成熟度較低，極度脆弱，分娩後需母體長期的哺乳與照護方能存活。',
    '-分娩難度高度取決於胎位；正位（頭位，tendencyAngle 0/360）最為順利，倒位（臀位，tendencyAngle 180）或橫位會導致產程大幅延長及風險遞增。',
  ].join('\n'),
  卵生: [
    '卵生 (Oviparous)',
    '-週期性排出未受精的「空卵」。由於卵生種族通常具備多產特徵，月經期會伴隨強烈的產道擴張感，排出多枚體積較小、無殼或薄殼的透明卵體。',
    '-母體能量主要消耗於卵黃積累與蛋殼鈣化，而非胚胎本體的快速發育，孕期負擔隨結殼進度增加。',
    '-產後母體即進入恢復期，卵體於體外獨立孵化且環境依賴性高；孵化後的幼體通常具備初步自立能力。',
    '-對胚位要求較低，正位與倒位分娩難度基本一致，僅在卵體呈現長軸橫位時才會增加排出阻力。',
  ].join('\n'),
  卵胎生: [
    '卵胎生 (Ovoviviparous)',
    '-本質為退化的結卵過程。未受精的卵體結構極度脆弱，在通過產道排出時會因壓力而破碎，最終表現為排出大量透明、膠狀且高度黏稠的物質，而非單純血液。',
    '-前期為卵黃供能發育，於孕晚期或臨盆前在宮內破卵；分娩出後即為可自由活動、具備狩獵或自立能力的幼體。',
    '-宮內破卵後，幼體失去卵殼保護並在有限空間內產生競爭，多胎極易發生同胞相殘或吞噬弱者的現象。',
    '-由於幼體活動度高且結構相對複雜，分娩前需極其精準的胚位校正，若位置偏移極易造成難產。',
  ].join('\n'),
  胎转卵生: [
    '胎轉卵生 (Metoviviparous)',
    '-子宮內膜不以血液形式脫落，而是高度凝聚成塊。排出物為半固體的肉質「卵囊」，排出時伴隨類似分娩的強烈收縮感。',
    '-孕期經歷從胎盤供能到卵黃儲備的轉化，母體需消耗巨量能源以支應產後漫長的體外孵化需求。',
    '-孕晚期因卵體巨大化且羊水相對枯竭，母體會產生劇烈的內部摩擦感與沈重墜脹感，分娩過程極其緩慢且耗費體力。',
    '-因卵體接近球形，多軸向路徑皆可通適，但若重心偏離產道中軸線，將導致產力分散，增加排出難度。',
  ].join('\n'),
  不定型: [
    '不定型 (Amorphous)',
    '-無外部排泄表現。未受精的生殖能量或組織會在體內被重新吸收、轉化或降解，生理上不存在「月經」概念，僅表現為核心能量的週期性閃爍或體溫波動。',
    '-不依賴傳統胎盤或卵黃，胚胎形態隨發育階段大幅扭曲或重組，呈現高度的物種特異性。',
    '-多為構造體或靈體化生命，異種繁衍時存在極高的生殖隔離壁壘，受孕與著床過程極不穩定。',
    '-胎位與產道適應性完全不可預測，分娩模式從「分裂」、「排泄」到「重構」皆有可能，無通用規律可循。',
  ].join('\n'),
};

const EMBRYO_TYPE_ORDER = ['胎生', '卵生', '卵胎生', '胎转卵生', '不定型'];

function pushEmbryoType(target, type) {
  const value = String(type || '').trim();
  if (!value || target.includes(value)) return;
  target.push(value);
}

function addEmbryoTypeFromRace(target, race) {
  const value = String(race || '').trim();
  if (!value) return;
  pushEmbryoType(target, getEmbryoTypeByRace(value));
}

function collectEmbryoTypesFromCharacterState(target, characterState) {
  const profile = characterState?.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const children = Array.isArray(profile.children) ? profile.children : [];
  addEmbryoTypeFromRace(target, base.race);
  for (const sperm of (Array.isArray(base.sperms) ? base.sperms : [])) addEmbryoTypeFromRace(target, sperm?.race);
  for (const fetus of (Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [])) {
    addEmbryoTypeFromRace(target, fetus?.race);
    addEmbryoTypeFromRace(target, fetus?.fatherRace);
    const embryoType = String(fetus?.embryoType || '').trim();
    if (embryoType) pushEmbryoType(target, embryoType);
  }
  for (const child of children) addEmbryoTypeFromRace(target, child?.race);
}

export function getRelevantEmbryoTypes(payload = {}) {
  const found = [];
  addEmbryoTypeFromRace(found, payload?.declared_race);
  if (payload?.existing_state && typeof payload.existing_state === 'object') {
    for (const characterState of Object.values(payload.existing_state)) collectEmbryoTypesFromCharacterState(found, characterState);
  }
  return found.filter((type) => EMBRYO_TYPE_ORDER.includes(type));
}

export function buildEmbryoTypeLorePrompt(payload = {}, { includeAllIfEmpty = false } = {}) {
  const relevantTypes = getRelevantEmbryoTypes(payload);
  const finalTypes = relevantTypes.length > 0 ? relevantTypes : (includeAllIfEmpty ? EMBRYO_TYPE_ORDER : []);
  if (finalTypes.length === 0) return '';
  return [
    '[胚胎类型补充设定]',
    '以下文本来自项目内的胚胎类型 lore，请将其视为高优先级设定。',
    '当母体和胎兒父源种族涉及不同生殖体系时，需要同时参考多个胚胎类型文本；不要只保留单一类型。',
    '例如人类母体怀有西方龙或东方龙胎儿时，应同时参考「胎生」与「胎转卵生」。',
    '',
    ...finalTypes.map((type) => EMBRYO_TYPE_REFERENCE[type]).filter(Boolean),
  ].join('\n');
}

export function getEmbryoTypeReferenceText(embryoType) {
  return EMBRYO_TYPE_REFERENCE[String(embryoType || '').trim()] || '';
}

// ═══ 三、注册与心情推演 ══════════════════════════════════════════

/**
 * 注册与心情推演是一次写完整份档案：描述范本要求写「胎动的状态」，模型在孕 12 周也照写胎动。
 * 追踪期的系统胎动在孕早期本来就不发生，这里补上同样的界线。孕周一律按人类产科孕周换算。
 */
export const QUICKENING_RULE = '胎动感知（硬性）：按人类产科孕周换算，母体通常要到孕 18–20 周（经产妇约 16–18 周，多胎大致相同）才感觉得到胎动。在此之前胎儿虽会动，母体察觉不到，只有产检、超声或世界观里的诊察手段（魔法、占卜等）看得到；描述、心情与认知都不得写母体感到胎动、踢动或腹中有东西在动。过了这个时间点，感觉得到不等于认得出：角色还不知道自己怀孕（cognitionRecords 没有知孕纪录）或拒绝承认时，只会以为是胀气、肠胃蠕动、抽筋之类。描述可以写客观的胎儿活动，但写到母体的感受，以及心情与认知，都照她的理解写，不得写成她认出那是胎动。';

export function buildBreedingInferenceSystemPrompt(settings, options = {}) {
  const side = options.psychologySide || null;
  return [
    buildWorldBaselineBlock(settings?.worldBaselinePrompt),
    '你是 AIRP 角色单侧心情推演器。只推指定的当前侧，不预先生成另一侧。',
    `本次唯一目标是「${String(options.targetName || '').trim()}」，target_character 必须逐字一致。`,
    side ? `本次只输出 ${side}，另一侧省略。` : '当前非孕用 mens，真孕/假孕/产程/回归用 preg；只选一侧。恢复期无当前有效侧，不提前建立下一轮 mens。',
    '依据角色资料、关系、处境、近期剧情、当前 cognitionRecords、日记、孩子和长期经验建立新侧，不能复用上一胎心理。',
    '知道怀孕、接受本次怀孕、母职信心与展现倾向分开。不把模型看到的实际父源/胎数/孕程当成角色已知。',
    '尚未感知妊娠时，不凭空生成孕妇心态，无依据的轴保持 null；null 不等于 0。知情后才补推缺项。',
    QUICKENING_RULE,
    '想受孕不等于接纳每次妊娠；生过孩子不等于想再生。已知或相信敌对父源可影响态度，秘密真相不可影响。',
    'confidence 是母职信心，不是产科知识或认知准确度；acceptance 是对这次怀孕本身的接受（想不想要它），不是她和胎儿之间的感情（那是胎儿亲和度），不强制恋孕、自我牺牲或决定留下孩子；stance 是展现倾向，不等于已告知谁。',
    '本次初始化不受日常 ±1～3 的 delta 限制。数值为 0～100 或 null，不写心理 bool，不改 cognitionRecords。',
    ...Object.entries(PSY_MENS_FIELDS).map(([key, field]) => `mens.${key}_value: ${field.definition}`),
    ...Object.entries(PSY_PREG_FIELDS).map(([key, field]) => `preg.${key}_value: ${field.definition}`),
    `只生成当前侧三轴 × 六阶段的 stageProfiles，阶段键 ${PSY_STAGE_KEYS.join(', ')}。每段为角色专属表现，不照抄默认标签。`,
    '只输出 JSON：{target_character,pregnancy_status:"mens|preg|unknown",confidence:0,evidence:[],mens或preg:{对应三项 *_value:数值或null},stageProfiles:{当前侧:{各轴:{各阶段键:表现文字}}},notes:"说明"}。另一侧不输出。',
    options.customNotes ? `角色补充设定：${sanitizePromptText(options.customNotes)}` : '',
    options.breedingInferencePrompt ? `额外推演提示：${sanitizePromptText(options.breedingInferencePrompt)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 精方抽取：依角色卡、世界书与对话整理一位精方的档案，结果只填进注册页的精方表单，
 * 使用者确认后才建档。种族与卵方注册一样以注册页种族栏为准，不让模型改。
 */
export function buildSireExtractionSystemPrompt(settings, options = {}) {
  const guide = stripDescriptionGuideStars(
    options.guide ?? settings?.registryDescriptionGuides?.sireDescription ?? DEFAULT_REGISTRY_DESCRIPTION_GUIDES.sireDescription,
  ).trim();
  const declaredRace = String(options.declaredRace || '').trim() || '人类';
  const instruction = String(options.userInstruction || '').trim();
  return [
    '你是 AIRP 精方（精液提供者）档案整理器。依角色卡、世界书与最近对话，为 target_character 整理一份精方档案。',
    '只写资料与对话里看得出来的；没提到的数值栏位填 null，不要编造。target_character 可能是角色卡本身，也可能只是卡里或对话里的人物。',
    `- 种族已由使用者指定为 ${sanitizePromptText(declaredRace)}，只用来判断体型与人外特征，不要输出种族。`,
    '- age: 实际年龄（岁）。长生种只写外表年龄时按设定推估；完全没有线索填 null。',
    '- bodySize: 常态（人态）的个体体型，1–7 级，人类为 4，可带一位小数。依写明的身高或身材换算：约 120 cm＝2.5、150 cm＝3.5、170 cm＝4、190 cm＝4.5、220 cm＝5、250 cm＝5.5、4 m＝6、6 m 以上＝7，锚点之间按比例内插。能变形的种族只填常态。卡上没写身材填 null，系统用种族平均。',
    '- isHere: 最近对话里此人是否在场；看不出来填 true。',
    ...(options.withTalents ? ['- talents: 此人的天赋（资质），阵列 [{"skill":"技能名","level":整数}]，level 为 -5～5，正为擅长、负为苦手；技能名只能用 payload.skill_catalog 里的。天赋是与生俱来的资质，会有一部分遗传给孩子；只写设定里明确的长处或短处，没有就给空阵列。'] : []),
    '- payload.father_snapshot 若有，是这人当年在子女或胎儿记录里留下的父方资料（种族、血脉、体型），可作体型参考，以角色卡与设定为准。',
    '- swordOffset: 剑（阳物）的个人偏移，−2～+2，步长 0.5，一般为 0。剑的大小 ＝ 体型 ＋ 偏移，体型已由 bodySize 决定，这里只写比同体型的人大或小多少：设定写明阳物特别粗大（小个子巨根）约 +1～+2，偏小约 −0.5～−1。设定没有着墨填 null。要与描述里性器的写法一致。',
    '- spermQuality: 精子品质倍率 0.25–4，一般人为 1。依设定里对精力、精液浓度、繁殖力的描写推估：精力衰退、不易使人受孕约 0.25–0.5；一般 1；精力旺盛、精液浓稠约 2；精力极旺、传说级的繁殖力或种马设定约 3–4。只看体能与繁殖力，不看阳物大小（那是 swordOffset）、身分、性格或受欢迎程度；设定没有着墨填 null。',
    '- descriptions: 以字段名为键的物件，字段名照下方规则每行「字段名|写作指引」的字段名；没有资料的字段省略。每栏一到三句白描，写当下状态，不写剧情摘要。',
    '[描述规则]',
    guide,
    ...(instruction ? ['[使用者补充]', sanitizePromptText(instruction)] : []),
    `只输出 JSON：{"age":数字或null,"bodySize":数字或null,"swordOffset":数字或null,"spermQuality":数字或null,"isHere":true,${options.withTalents ? '"talents":[],' : ''}"descriptions":{"字段名":"内容"}}`,
  ].join('\n');
}

// 写实世界只有人类：血脉比例、衍生、伴生卵与非人示例都用不到，比照追踪提示词整行拿掉
const REALISTIC_REGISTRY_DROPPED_LINES = [
  '- base.bloodline:', '- 若 base.derivedType 不为 null', '- 混血:', '- 衍生种族:', '- 子类物种:', '- 复杂种族:',
  '- companionEggCount:', '- 精灵怀孕500天:', '{如果角色不是人类',
];

function dropRealisticRegistryLines(prompt) {
  return prompt.split('\n').filter((line) => !REALISTIC_REGISTRY_DROPPED_LINES.some((prefix) => line.trimStart().startsWith(prefix))).join('\n');
}

export function buildRegistrySystemPrompt(settings, options = {}) {
  // 注册页的「此角色使用妊娠变速」：没勾就不让模型写变速，免得把「怀很久／过了预产期」都塞进倍率
  const useGestationModifier = options.useGestationModifier === true;
  const sliderMultiplier = useGestationModifier && options.gestationModifierMultiplier !== undefined && options.gestationModifierMultiplier !== null
    ? Number(options.gestationModifierMultiplier)
    : NaN;
  const includeBreedingPsychology = Boolean(options.includeBreedingPsychology);
  const guides = {
    ...DEFAULT_REGISTRY_DESCRIPTION_GUIDES,
    ...(settings?.registryDescriptionGuides || {}),
    ...(options.descriptionGuides || {}),
  };
  const customNotes = String(options.customNotes !== undefined ? options.customNotes : (settings?.registryCustomNotes || '')).trim();
  const declaredRace = String(options.declaredRace || '').trim();
  const sourceChild = options.payload?.source_child || null;
  // 写实世界只有人类：名录、种族生理与胚型说明都不送
  const realisticWorld = isRealisticWorld(settings);
  const embryoTypeLorePrompt = realisticWorld ? '' : buildEmbryoTypeLorePrompt(options.payload || {}, { includeAllIfEmpty: true });
  const racePhysiologyPrompt = realisticWorld ? '' : buildRegistryRacePhysiologyPrompt(options.payload || {}, { selection: settings?.raceCatalogSelection || null });
  // 注册是一次性请求，附上辨识提示帮模型在形近种族间选对（人鱼／鱼人、精灵／妖精）
  const raceCatalogPrompt = realisticWorld ? '' : buildRaceCatalogBlock({
    withHints: true,
    selection: settings?.raceCatalogSelection || null,
  });
  const psyMensLines = Object.entries(PSY_MENS_FIELDS).flatMap(([key, value]) => [
    `- psychology.mens.${key}_value: ${value.definition}`,
    `  阶段预览: ${value.preview}`,
  ]);
  const psyMensBoolLines = Object.entries(PSY_MENS_BOOL_FIELDS).map(([key, value]) => `- psychology.mens.${key}: ${value.definition}`);
  const psyPregLines = Object.entries(PSY_PREG_FIELDS).flatMap(([key, value]) => [
    `- psychology.preg.${key}_value: ${value.definition}`,
    `  阶段预览: ${value.preview}`,
  ]);
  const psyPregBoolLines = Object.entries(PSY_PREG_BOOL_FIELDS).map(([key, value]) => `- psychology.preg.${key}: ${value.definition}`);
  const prompt = [
    buildWorldBaselineBlock(settings?.worldBaselinePrompt),
    racePhysiologyPrompt,
    raceCatalogPrompt,
    '你是 AIRP 角色注册初始化器。',
    realisticWorld ? '本故事为写实世界，只有人类：base.race 一律填 人类，不填 bloodline 与衍生类型。' : '',
    '只在用户明确要求注册指定角色时工作，不得擅自新增其他角色。',
    '根据角色卡、用户要求、已有资料，输出角色初始化 JSON。',
    sourceChild ? '本次注册来源为已有角色的孩子。payload.source_child 是固定事实：base.race 必须沿用其 race／derivedType；其 talents 会由系统确定性继承。你只能参考这些天赋塑造初始化内容，不得删除、改名、换向或重算天赋。' : '',
    includeBreedingPsychology
      ? 'payload.breeding_inference 是已确认的繁育推演。必须优先把它当作繁育心理初稿，再结合角色资料校正，不要无故忽略。'
      : '本次未启用繁育心理推演：不要输出、补全或推断任何繁育阶段人格字段，保留角色卡原有的阶段人设与表现。',
    '你只需要填写角色注册时真正需要声明的内容，不需要补充其他无关信息。',
    '不要扩写额外分类，不要发散到注册步骤之外的内容。',
    '你只需要填写以下声明内容：',
    '1. 角色基础注册：base.age、base.race、base.bodySize、base.sheathOffset、base.build、base.bust、base.hip、base.allocationBias、base.bustGain、base.hipGain、base.vitalityLevel、base.psyStressLevel、base.libido、base.uterinePressure、base.latestSexDays、base.penetrationState、base.penetrationSource、base.sperms、metabolism',
    '2. 情感与妊娠经验：experience',
    ...(includeBreedingPsychology ? ['3. 繁育心理：psychology.mens 或 psychology.preg（二选一，互斥）'] : []),
    '4. 既有孩子记录：children',
    '5. 初登场即怀孕：pregnant.gestationalAgeDays（或 pregnantDays）、pregnant.fetusesCount、pregnant.fetuses；正在延产再加 pregnant.extensionCount',
    '6. 文字描述栏位：descriptions',
    '如果资料不足，可以省略字段或给 null（base.age 除外）；不要为了凑完整而编造。',
    embryoTypeLorePrompt,
    '以下字段定义、参数说明、注意事项与示例，均视为必要规则：',
    '【1. 角色基础注册】',
    '参数说明：',
    `- base.race: 纯种/混血/衍生种族/子类物种，保留原始写法，若故事为现代写实，种族统一填人类即可${declaredRace ? `。【重要】用户已明确指定，必须强制填写為：${declaredRace}` : ''}`,
    '- base.bloodline: 原文写明血脉比例时，可把比例直接写进 base.race，或另填 bloodline 对象（键与 race 成分一致，值为0到1、合计1）。其余成分已知就写全，例如祖母是精灵、其余祖辈是人类：race="1/4精灵x3/4人类"（或 race="精灵x人类"、bloodline={"精灵":0.25,"人类":0.75}）。其余成分不详就只写已知那一份，例如「八分之一龙血，其余血统不详」：race="1/8西方龙"，系统会把剩下的87.5%记为未知；不得擅自补成人类。没有比例依据就省略；系统会标为比例推定。衍生类型不占种族血脉份额。',
    '- base.vitalityLevel: 1-7，默认语义为 一推就倒(1)-身怀病弱(2)-体弱易累(3)-均衡活力(4)-健康有余(5)-经过锻炼(6)-无坚不摧(7)',
    '- base.psyStressLevel: 1-7，默认语义为 情感丧失麻木不仁(1)-内向压抑冷感(2)-情绪平缓理性(3)-情绪均衡稳定(4)-情绪丰富敏感(5)-强烈波动焦躁(6)-极端情绪精神异常(7)',
    '- base.age: 必填，不得省略或填 null。依角色卡、世界书与对话推断实际年龄；长生种只写外表年龄时，按设定推估实际岁数；资料完全没有提到时，按外貌、身分与经历推估一个合理年龄。',
    '- base.bodySize: 常态（人态）的个体体型，1–7 级，人类为 4，可带一位小数。依角色卡写明的身高或身材换算：约 30 cm＝1.5、120 cm＝2.5、150 cm＝3.5、170 cm＝4、190 cm＝4.5、220 cm＝5、250 cm＝5.5、4 m＝6、6 m 以上＝7，锚点之间按比例内插；萝莉体型约 3–3.5，八尺约 5.3。半人马、拉弥亚等大型下半身看整体量体，以种族体型为准再增减。能变形的种族只填常态，变化态由系统按种族推算。未成年角色填当下的体型。卡上没写身材就省略，系统按种族分布抽取；种族体型为依个体时（怪兽类、怪鸟类、怪鱼类、植物族、真菌族、独居虫族、心魇）必须按子项或描述填写；种族体型为可变时省略。',
    '- base.sheathOffset: 鞘（阴道）的个人偏移，−1～+1，步长 0.25，一般为 0。代表实际舒适的插入深度，不只是解剖长度：鞘长与身高只有弱相关，系统已按体型算好平均，这里只写个人差异。角色卡写明很浅、一顶就到底、子宫后倾或子宫颈偏低、深了会痛，往负填（约 −0.5～−1）；写明很深、吞得下特别大的，往正填（约 +0.5～+1）。卡上没写就省略（视为 0），不要凭身材猜；原因写进私处描述。',
    '- base.build: 体重比例 0–100，50 匀称、20 纤瘦、80 丰满肥硕。只管身上的量；是肉还是肌肉看 vitalityLevel。卡上没写身材就填 50。',
    '- base.bust: 胸部丰满度 0–100，每 10 一个罩杯：0＝AAA、10＝AA、20＝A、30＝B、40＝C、50＝D、60＝E、70＝F、80＝G、90＝H、100＝I。写明罩杯照换算；只写大小就估（平胸约 15、普通约 40、丰满约 60、巨乳 80 以上）；没写填 40。孕期变化系统自己算，这里填孕前的常态。',
    '- base.hip: 臀部饱满度 0–100（骨盆加臀），50 适中、25 窄、75 丰满。没写填 50。',
    '- base.allocationBias: 母体倾向 −1～+1，怀孕时养分偏给自己还是胎儿。卡上写「一怀孕就发福、丰腴、臀腿变厚」往负；写「怀孕反而消瘦、被胎儿榨干、只长肚子」往正。没写就省略，系统抽样。',
    '- base.bustGain: 胸部增长倾向 0–3，平衡时单胎足月胸部大几个罩杯（荷尔蒙体质，和胖瘦无关）。卡上写「一怀孕胸就涨得很夸张」约 2.5–3，「胸部几乎没变」约 0–0.5；没写就省略，系统抽样（平均 1.5）。',
    '- base.hipGain: 臀部增长倾向 0–2，平衡时单胎足月骨盆与臀部变宽几级（每级 10）。卡上写「怀孕后屁股变得很大」约 1.5–2；没写就省略，系统抽样（平均 0.5）。',
    '- 注册孩子时可参考父母的身材与倾向。胸部大小与奶量无关，不要因为胸大就写奶多。',
    '- base.libido: 初始性欲。非妊娠上限100；妊娠後会随孕期提升，临产最后一天上限可达150。若角色开场就在发情、催情、强欲状态，可给较高值。',
    '- base.uterinePressure: 初始宫压。非妊娠上限50；妊娠後会随进度平滑提升，臨產期上限达150。【危险警告】孕早期与孕中期前期上限极低，超过15便极易触发流产警告！除非开局正在临盆或剧烈腹痛，否则强烈建议填 0。',
    '- base.latestSexDays: 距最近一次性行为经过的天数。若 experience.latestSexPartner 有意义，建议一并填写；若已超过最近一月经周期或无从判断，可为 null。',
    '- base.penetrationState / penetrationSource: 当前可受孕生殖道的插入状态（idle/inserted/spent）与来源；一般开场为 idle/null，插入不等于射精。',
    '- base.sperms: 体内残留精液来源列表。适用于刚性交结束、仍有精液残留的开局；每项包含 male、race、value，value 以人类精方 10-30 为准，按精方体型每级翻倍（每天自动衰减，人类女方 10，同样按女方体型每级翻倍）。race 可直接写 [衍生]种族，系统会自动拆出 derivedType。',
    '- metabolism: 初始需求状态。普通种族上限皆為150，包含 excretion、hunger、sleep、milk、odor、companionship，分别表示泄意、饿意、困意、乳意、臭意、伴意；excretion（泄意）同时包含排尿与排便需求；milk 在普通周期表示乳房胀敏或周期不适，在妊娠、假孕或产后恢复阶段也可表示泌乳需求。',
    '- 若 base.derivedType 不为 null，则 metabolism 可填写 flux（范围 -150 到 150），并保留该衍生类型未抵免的普通需求。flux 是衍生种族专用的单一极性需求值：正值与负值分别代表两种相反的释放需求，绝对值越高需求越强。',
    '- 胎儿健康由系统按需求照料与胎儿事件结算，不必填写，也不作为 metabolism 排解阻塞来源。',
    '注意：vitalityLevel 与 psyStressLevel 是角色内在特质等级，不根据当前疲劳、刚哭过、当下崩溃等暂时状态调整。',
    '注意：base.vitality 与 base.psyStress 不由你直接填写，系统会根据 vitalityLevel 与 psyStressLevel 自动计算初始值。',
    '示例：',
    '- 人类少女: {"base":{"race":"人类","vitalityLevel":4,"psyStressLevel":4,"age":18,"libido":12,"uterinePressure":0}}',
    '- 混血: {"base":{"race":"天使x恶魔","vitalityLevel":5,"psyStressLevel":3,"age":25,"libido":35,"uterinePressure":3}}',
    '- 衍生种族: {"base":{"race":"[血族]人类","vitalityLevel":2,"psyStressLevel":5,"age":150,"libido":28,"uterinePressure":0}}',
    '- 子类物种: {"base":{"race":"鱼人-鲸族","vitalityLevel":6,"psyStressLevel":2,"age":30,"libido":20,"uterinePressure":0}}',
    '- 复杂种族: {"base":{"race":"[不死-僵尸]兽耳族-九尾狐","vitalityLevel":7,"psyStressLevel":1,"age":1000,"libido":60,"uterinePressure":20}}',
    '【2. 情感与妊娠经验】',
    '参数说明：',
    '- virginity: 初次性对象名称，处女时为 null',
    '- latestSexPartner: 最新性对象，仅在最近一月经周期(ex: 人类28天)内仍有意义，否则可为 null',
    '- 若填写 latestSexPartner，最好同时填写 base.latestSexDays，表示距离最近一次性行为过去了几天',
    '- emotionalMates: 多人交往名单，无则 []',
    '- marriageMates: 多人婚姻名单，无则 []',
    '- pregnantExperience: 怀孕经验次数',
    '- naturalBirthExperience: 自然产经验次数',
    '- surgicalBirthExperience: 手术产经验次数',
    '- miscarriageExperience: 已成立妊娠的自然/非人工流产次数，旧版妊娠损失归入流产；abortionExperience: 堕胎次数。两者分开。',
    '示例：',
    '- 高中女生: {"experience":{"virginity":"前男友","emotionalMates":["{{user_name}}"],"pregnantExperience":0}}',
    '- 媚魔女仆: {"experience":{"virginity":"前任主人","emotionalMates":[],"pregnantExperience":5,"naturalBirthExperience":3,"surgicalBirthExperience":0,"miscarriageExperience":2}}',
    '- 守贞人妻: {"experience":{"virginity":"丈夫","latestSexPartner":"丈夫","emotionalMates":["丈夫"],"marriageMates":["丈夫"],"pregnantExperience":3,"naturalBirthExperience":0,"surgicalBirthExperience":2,"miscarriageExperience":0}}',
    '- 刚做爱开局: {"base":{"latestSexDays":0,"sperms":[{"male":"丈夫","race":"[不死-僵尸]人类","value":30}]},"experience":{"latestSexPartner":"丈夫"}}',
    '【3. 繁育心理】',
    '参数说明：',
    '- 若 payload.breeding_inference 存在，先采用其中对应 mens 或 preg 的数值作为心理起始点；只有当角色资料与繁育推演明显冲突时才调整。',
    '- 若 payload.breeding_inference.stageProfiles 存在，必须原样写入 profile.psychology.stageProfiles，除非需要修正明显错误或空缺。',
    '- 繁育心理是角色长期繁育人格底盘，不是临时情绪。注册时应让它能支撑后续随认知纪录的小幅推演。',
    '- psychology.mens 与 psychology.preg 互斥，不要同时填写。',
    '- 你主要填写 *_value，数值范围为 0-100；*_interpret 可省略，系统会按阶段自动补全。没有依据的值填 null，不能把未知补成 0。不再使用心理布林旗标。',
    '- psychology.stageProfiles 用来保存该角色专属 当前侧 3 轴 × 6 阶段解释。结构为 psychology.stageProfiles.mens.{mastery,desire,autonomy}.{0,1_25,26_50,51_75,76_100,100_plus} 与 psychology.stageProfiles.preg.{confidence,acceptance,stance}.{0,1_25,26_50,51_75,76_100,100_plus}。',
    '非怀孕使用以下定义与阶段预览：',
    ...psyMensLines,
    ...psyMensBoolLines,
    '怀孕使用以下定义与阶段预览：',
    ...psyPregLines,
    ...psyPregBoolLines,
    '- 非孕侧 mastery（掌控）、desire（欲望）、autonomy（自主）；孕侧 confidence（母职信心）、bonding（接纳与联结）、stance（社会展现）。恢复期不初始化任何一侧。',
    '- 只初始化实际当前侧并输出该侧三轴的全部六阶段专属解释；不得预写另一侧。角色主观判断仅依 initial_cognition_records 与可知剧情，不能把实际胎数、父方当作角色知识。',
    '【4. 既有孩子记录】',
    '参数说明：每个孩子对象包含 name、fathers、gender、race、age。',
    '示例：',
    '- [{"name":"冬月 露花","fathers":"前夫","gender":"女","race":"人类","age":5}]',
    '【5. 初登场即怀孕】',
    '参数说明：',
    '- pregnant.gestationalAgeDays: 发育到哪里，换算成人类产科孕周的天数（从末次月经起算）。资料写“孕8周/怀孕8周”填 56；写“受孕后8周/胚胎发育8周”需再加 14；写“足月”约 280、“逾期两周”约 294、“怀胎一年仍未生”约 365。一般只填这个。',
    '- pregnant.pregnantDays: 实际已经怀了多少天。只有资料给出的是经过时间、又没有说发育到哪里时才填，例如「精灵怀孕500天」、受诅咒「怀胎三年」；系统会乘上种族妊娠速度与 bio.gestationModifierMultiplier 换算发育进度。两者都填时以 gestationalAgeDays 为准。',
    '- 不要填写 pregnant.effectivePregnantDays；系统会自动换算。',
    '- pregnant.extensionCount: 只在资料明确写角色已过预产期、正被某种手段（医疗、法术、契约等）延后生产时填，表示已经延产几次（≥1）；gestationalAgeDays 应至少 294（42 周），写得不足时系统会当作刚满 42 周。没有延产就省略。单纯过了预产期还没生是逾期，不要填。',
    '- base.uterineAtony: 子宫乏力级数，反复延产留下的后遗症；只在资料明确描写多次延产导致子宫松弛无力时填，省略时系统按延产次数推定（次数减 1）。',
    '- pregnant.fetusesCount: 这次怀孕的怀胎数',
    '- pregnant.fetuses: 每个胎儿包含 fathers、provider、race、gender、embryoType；也可填写 companionEggCount、weight、tendencyAngle、backSide、affinity',
    '- companionEggCount: 这一胎伴随的背景卵数量（伴生卵），它们不会发育，也不建立胎儿卡或孩子；不是 fetusesCount。一整群十枚卵、只有一名能长大时，就是一张胎儿卡加 9 枚伴生卵。不确定时省略，由系统依种族抽取。胎生与胎转卵生恒为 0。',
    '- 胎儿可带 tags 标注特殊来历，只接受这几个：identical（同卵）、superfetation（异期复孕）、nested（孕中孕）、rebirth（胎内回归）。代孕不必标——给了 provider 就会自动识别。写不出对应支撑栏位的标签会被撤销，宁可不标也不要留一个指向虚空的关系。',
    '- 嵌合体不必标 tags——给了 chimera 就会自动识别。chimera = { sourceCount: 融合前的受精卵数, fatherSources: [父方名字…], maternalSources: [遗传母方名字…], genderSources: [各来源的性别…] }；父方与母方名字加起来不足两个会被撤销，因为那不成其为嵌合。',
    '- identical：同卵的几胎都标上；只标一胎会被撤销。同卵＝同一颗受精卵分裂，组内 fathers、provider、race、gender、embryoType 必须相同（不同时以组内第一胎为准）。一颗受精卵最多分成 4 胎，超过会被自动拆成几组。',
    '- identicalGroup: 同时有两组以上同卵时才需要，用同一个整数标出同一颗受精卵的几胎，不同受精卵用不同数字。例如七胞胎是两颗受精卵分别分成男四胞胎与女三胞胎：前四胎 tags: ["identical"]、identicalGroup: 1、gender: "男"，后三胎 tags: ["identical"]、identicalGroup: 2、gender: "女"。只有一组同卵时可省略。',
    '- superfetation：必须一并给 conceivedAtDays（这一胎受精时，母体已经怀了多少有效孕日），会被夹进这次妊娠的范围内。它比同腹其他胎儿晚受精、发育落后。',
    '- nested：这一胎长在另一颗胎儿体内。除了 conceivedAtDays，还要给 nestedInIndex＝宿主在 fetuses 阵列里的下标（从 0 起算，不能指自己）。它的母亲是那颗胎儿，出生后承载者会同时生下孩子与孙辈。宿主只能是胎生、胎转卵生或不定型的胎儿（卵生在壳里、卵胎生在卵膜里，进不去）。',
    '- rebirth：一名已出生的角色回到子宫里成为这一胎，fathers 写那个人的名字（可以是 user）。适合「开场就已经在角色子宫里」的设定。产出后是全新个体，与原来那个人不是同一笔资料。',
    '- revealed：这一胎角色本人知不知道。省略时系统按孕龄自动判定（异期复孕进孕中期才知道、孕中孕要到孕晚期）；想让角色暂时不知情就明确给 false。',
    '- provider: 代孕母方、寄生等提供者名称，正常情况下为 null',
    '- weight: 胎儿体重/发育量倍率，范围 0.33-3.0；不确定可省略，系统会补 1.0',
    '- backSide: 胎背朝母体哪一侧，只能是 左前／右前／左后／右后 之一（左后、右后即枕后位，胎儿的脸朝母体腹侧）；资料没写就省略，系统会随机补值。',
    '- tendencyAngle: 胎位/趋向角度，范围 0-360；不确定可省略，系统会随机补值。角度映射必须固定为：0/360=正常头位/正位，180=完全臀位/倒位，90或270=横位；不要把 180 写成头位',
    '- affinity: 胎儿对母体的亲和/排斥倾向，范围 -50 到 50；正值亲和，负值排斥，不确定可省略',
    '示例：',
    '- 人类怀单胎8周，正常头位示例: {"pregnant":{"gestationalAgeDays":56,"fetusesCount":1,"fetuses":[{"fathers":"丈夫","provider":null,"race":"人类","gender":"男","embryoType":"胎生","weight":1.0,"tendencyAngle":0,"affinity":10}]}}',
    '- 精灵怀孕500天: {"base":{"race":"精灵"},"pregnant":{"pregnantDays":500,"fetusesCount":1,"fetuses":[{"fathers":"伴侣","provider":null,"race":"精灵","gender":"女","embryoType":"胎生"}]}}',
    '- 妖怪猫又怀双胎20周: {"pregnant":{"gestationalAgeDays":140,"fetusesCount":2,"fetuses":[{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"},{"fathers":"监狱囚犯","provider":null,"race":"[妖怪]兽耳族-猫又x蜥蜴人","gender":"女","embryoType":"胎生"}]}}',
    '- 被延产圣术拖到孕 50 周仍未生: {"pregnant":{"gestationalAgeDays":350,"extensionCount":1,"fetusesCount":1,"fetuses":[{"fathers":"丈夫","provider":null,"race":"人类","gender":"女","embryoType":"胎生"}]}}',
    '- 代孕情节: {"pregnant":{"gestationalAgeDays":84,"fetusesCount":1,"fetuses":[{"fathers":"委托人","provider":"代孕者A","race":"人类","gender":"女","embryoType":"胎生"}]}}',
    ...(useGestationModifier ? [
      '【5.1 妊娠變速类补充设定（仅在存在特殊变速效果时填写 bio）】',
      '参数说明：',
      '- bio.gestationModifierMultiplier: 特殊妊娠速度修正倍率。大于 1 为加速，小于 1 为减速，0 为冻结；只影响注册之后的推进速度。目前发育到哪里仍填 pregnant.gestationalAgeDays，不会被倍率换算。',
      '- 倍率与延产的分别：整个孕期本来就长或短用倍率，约为 280 ÷ 总孕期天数：怀胎三年才足月约 0.26，地母神祝福十天就怀满十个月约 28（倍率范围 0.03～30，0 为冻结）；正常长到足月、过了预产期才被某种手段拖着不生用延产（pregnant.extensionCount）。不要用倍率表现「过了预产期还不生」。',
      '- bio.gestationModifierName: 该倍率效果的名称，例如祝福、诅咒、体质、术式。',
      '- bio.gestationModifierDescription: 对该倍率来源与表现的简短说明。',
      '- 这组 bio 字段是可选的特殊效果，不是一般妊娠的必填资料。普通人类孕妇、常规妊娠、种族原生孕期速度都不要填写。',
      '- 禁止用 bio 填写 gestationModifierMultiplier=1 的默认占位内容，例如「常规妊娠」「标准人类妊娠生理周期」；没有特殊变速效果就整个省略 bio。',
      '- 仅当资料明确存在持续生效且倍率不为 1 的祝福、诅咒、体质、术式、冻结或延长效果时填写；未怀孕角色也可保留此类明确效果。',
      '示例：',
      '- 被祝福的冒险者妊娠加快: {"bio":{"gestationModifierMultiplier":1.5,"gestationModifierName":"丰饶祝福","gestationModifierDescription":"受女神祝福后，妊娠期间胎儿发育明显加快，孕期反应也会更早显现。"}}',
      '- 红尘之力导致孕期极端延长，即使当前未怀孕也应保留: {"bio":{"gestationModifierMultiplier":0.001,"gestationModifierName":"红尘织命","gestationModifierDescription":"受红尘之力影响，若进入妊娠，孕期推进速度仅为常规人类的千分之一，整体妊娠期会被极度拉长。"}}',
      ...(Number.isFinite(sliderMultiplier)
        ? [`使用者已在注册页用拉杆设定这名角色的变速倍率为 ${sliderMultiplier}${sliderMultiplier === 0 ? '（冻结）' : ''}：bio.gestationModifierMultiplier 一律以此为准，不必自行估算；请依资料填写 bio.gestationModifierName 与 bio.gestationModifierDescription，说明这份变速的来源与表现。若资料只写了经过时间（例如怀胎三年），pregnant.pregnantDays 会按这个倍率换算发育进度。`]
        : ['使用者已确认这名角色使用妊娠变速：必须依资料填写 bio.gestationModifierMultiplier、bio.gestationModifierName、bio.gestationModifierDescription，倍率不可为 1。']),
    ] : [
      '【5.1 妊娠变速】',
      '使用者没有为这名角色开启妊娠变速：不要输出 bio.gestationModifierMultiplier、gestationModifierName、gestationModifierDescription，输出了也会被忽略。',
      '即使资料写怀孕很久，也按种族正常孕期理解：发育到哪里填 pregnant.gestationalAgeDays；过了预产期仍未生是逾期，被某种手段拖着不生用 pregnant.extensionCount。',
    ]),
    '【6. 文字描述栏位】',
    '参数说明：descriptions 包含 normalDescription、pregnantDescription。',
    'normalDescription 与 pregnantDescription 都是以字段名为键的物件 {"字段名":"描述内容"}，键的先后即字段顺序。',
    '下方规则文本每行是「字段名|该字段要写什么」：字段名照抄作为键，| 后面的说明只是写作指引，不要写进内容。花括号里的是补充说明，可依其指示另加字段（如人外特征）。',
    '内容不要换行、不要把多个字段并成一段，也不要写成纯长文。',
    '示例：{"状态":"处于饥饿与寒冷的边缘，精神高度焦虑且带有防御性","表情":"戴着苍白口罩，眼神涣散且带病态妆容","行动":"蜷缩在自动贩卖机旁躲雨，机械地刷手机"}',
    '以下规则文本由用户自定义，注册时应严格遵守。',
    '[normalDescription]',
    stripDescriptionGuideStars(String(guides.normalDescription || DEFAULT_REGISTRY_DESCRIPTION_GUIDES.normalDescription)),
    '[pregnantDescription]',
    stripDescriptionGuideStars(String(guides.pregnantDescription || DEFAULT_REGISTRY_DESCRIPTION_GUIDES.pregnantDescription)),
    `【${includeBreedingPsychology ? 7 : 6}. 角色补充设定】`,
    customNotes ? customNotes : '无',
    '若提供了角色补充设定，必须优先视为该角色已明确声明的特征，并在推演与注册相关字段中如实体现；不要忽略，也不要擅自扩写超出原意的内容。',
    ...(useGestationModifier ? [
      '若角色补充设定明确描述的是一种未来也会持续生效、且倍率不为 1 的妊娠体质、祝福、诅咒、冻结或延长效果，即使角色当前未怀孕，也必须写入 bio.gestationModifierMultiplier、bio.gestationModifierName、bio.gestationModifierDescription；普通妊娠不得补写 bio。',
    ] : []),
    '注意：未怀孕角色不要硬填 pregnantDescription；描述内容不要换行。',
    QUICKENING_RULE,
    '只输出 JSON，不要输出额外解释。',
    '【name】必须原样填写 payload.target_character，一字不差。那是用户指定要注册的角色名；即使它与角色卡名不同，也不得改用角色卡名、别名或称谓。',
    'JSON 结构必须是：',
    '{',
    '  "name": "string",',
    '  "profile": {',
    '    "base": {',
    '      "age": 0,',
    '      "race": "string",',
    '      "bodySize": 4,',
    '      "sheathOffset": 0,',
    '      "build": 50,',
    '      "bust": 40,',
    '      "hip": 50,',
    '      "libido": 0,',
    '      "uterinePressure": 0,',
    '      "latestSexDays": 0,',
    '      "penetrationState": "idle",',
    '      "penetrationSource": null,',
    '      "sperms": [],',
    '      "vitalityLevel": 4,',
    '      "psyStressLevel": 4',
    '    },',
    '    "pregnant": {',
    '      "gestationalAgeDays": 0,',
    '      "fetusesCount": 0,',
    '      "fetuses": [',
    '        {',
    '          "fathers": "string|null",',
    '          "provider": "string|null",',
    '          "race": "string|null",',
    '          "gender": "string|null",',
    '          "embryoType": "string|null",',
    '          "companionEggCount": 0,',
    '          "weight": 1.0,',
    '          "tendencyAngle": 0,',
    '          "backSide": "左前",',
    '          "affinity": 0',
    '        }',
    '      ]',
    '    },',
    '    "experience": {',
    '      "virginity": "string|null",',
    '      "latestSexPartner": "string|null",',
    '      "emotionalMates": ["string"],',
    '      "marriageMates": ["string"],',
    '      "pregnantExperience": 0,',
    '      "naturalBirthExperience": 0,',
    '      "surgicalBirthExperience": 0,',
    '      "miscarriageExperience": 0,',
    '      "abortionExperience": 0',
    '    },',
    ...JSON.stringify({ psychology: (() => {
      const side = options.breedingInference?.preg ? 'preg' : 'mens';
      const config = side === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
      return { [side]: Object.fromEntries(Object.keys(config).map((axis) => [`${axis}_value`, null])),
        stageProfiles: { [side]: Object.fromEntries(Object.keys(config).map((axis) => [axis, Object.fromEntries(PSY_STAGE_KEYS.map((key) => [key, '角色专属解释']))])) } };
    })() }, null, 2).split('\n').slice(1, -1).map((line, index, lines) => `    ${line}${index === lines.length - 1 ? ',' : ''}`),
    '    "metabolism": {',
    '      "excretion": 0,',
    '      "hunger": 0,',
    '      "sleep": 0,',
    '      "milk": 0,',
    '      "odor": 0,',
    '      "companionship": 0',
    '    },',
    '    "children": [],',
    '    "descriptions": {',
    '      "normalDescription": { "字段名": "描述内容" },',
    '      "pregnantDescription": { "字段名": "描述内容" }',
    '    }',
    '  }',
    '}',
    '允许省略不确定或不适用的声明字段，但不要编造系统字段。',
    '如果角色不是孕妇，pregnant 使用默认空结构或省略。',
    '如果角色没有孩子，children 返回 [] 或省略。',
    '如果角色没有明确经验背景，experience 只填能确定的部分。',
  ].join('\n');
  const finalPrompt = includeBreedingPsychology ? prompt : stripBreedingPsychologySections(prompt);
  return realisticWorld ? dropRealisticRegistryLines(finalPrompt) : finalPrompt;
}

function stripBreedingPsychologySections(prompt) {
  return prompt
    .replace(/【3\. 繁育心理】[\s\S]*?(?=【4\. 既有孩子记录】)/, '')
    .replace(/\n\s*"psychology": \{[\s\S]*?\n\s*\},\n\s*"metabolism": \{/, '\n    "metabolism": {')
    .replace('4. 既有孩子记录：children', '3. 既有孩子记录：children')
    .replace('5. 初登场即怀孕：', '4. 初登场即怀孕：')
    .replace('6. 文字描述栏位：descriptions', '5. 文字描述栏位：descriptions')
    .replace('【4. 既有孩子记录】', '【3. 既有孩子记录】')
    .replace('【5. 初登场即怀孕】', '【4. 初登场即怀孕】')
    .replace('【5.1 妊娠變速类补充设定', '【4.1 妊娠變速类补充设定')
    .replace('【6. 文字描述栏位】', '【5. 文字描述栏位】');
}

/**
 * 玩家在注册页勾选的特殊胎儿来历。
 *
 * 分两条路走，因为这几种来历需要的资料量差很多：
 * - 只需要一个名字的（胎内回归、代孕／托卵）走硬套：玩家填名字，程式直接写进结果，
 *   不依赖模型愿不愿意照做。
 * - 需要模型编出胎儿结构的（嵌合、同卵、异期复孕、孕中孕）走提示：勾了就往注册提示词里
 *   加一段明确指示。玩家的勾选没办法凭空生出两个真实的血统来源，硬套只会造出假资料。
 *
 * 两条路最后都会流经 normalizeRegisteredFetusTags，所以不管走哪条都不会留下自相矛盾的状态。
 */
export const SPECIAL_FETUS_HINTS = {
  chimera: '这次妊娠里要有一颗嵌合体胎儿：两颗以上的受精卵在著床前融合成一个个体。请给它 chimera = { sourceCount, fatherSources, maternalSources, genderSources }，来源名字要取自角色卡里真实存在的人，父方与母方名字合计至少两个。',
  identical: '这次妊娠里至少要有一组同卵：同一颗受精卵分裂成 2–4 胎，组内每胎都标上 tags: ["identical"]，fathers、race 与 gender 必须一致。角色补充设定写了几组、每组几胎就照写；有两组以上时用 identicalGroup 的不同数字区分各颗受精卵。',
  superfetation: '这次妊娠里要有一颗异期复孕的胎儿：它在母体已经怀孕之后才受精或植入。给它 tags: ["superfetation"] 与 conceivedAtDays（受精或植入当下母体已怀的有效孕日，必须小于目前孕龄），它比同腹其他胎儿发育落后。',
  nested: '这次妊娠里要有一颗孕中孕的胎儿：它长在另一颗胎儿体内。给它 tags: ["nested"]、conceivedAtDays，以及 nestedInIndex＝宿主在 fetuses 阵列里的下标。宿主本身必须是一颗正常胎儿。',
};

/** 勾选转成追加给模型的指示；没勾任何一项时回传空字串 */
export function buildSpecialFetusNotes(request) {
  if (!request || typeof request !== 'object') return '';
  const lines = [];
  const rebirth = String(request.rebirth || '').trim();
  if (rebirth) {
    lines.push('这次妊娠里要有一颗胎内回归的胎儿：' + rebirth + ' 这个人已经回到子宫里成为其中一胎，请把这一胎的 fathers 写成「' + rebirth + '」并标上 tags: ["rebirth"]。');
  }
  const surrogacy = String(request.surrogacy || '').trim();
  if (surrogacy) {
    lines.push('这次妊娠是代孕／托卵：卵来自 ' + surrogacy + '，承载者只提供子宫、不是遗传母亲。请把这一胎的 provider 写成「' + surrogacy + '」。');
  }
  for (const key of Array.isArray(request.hints) ? request.hints : []) {
    if (SPECIAL_FETUS_HINTS[key]) lines.push(SPECIAL_FETUS_HINTS[key]);
  }
  if (lines.length === 0) return '';
  return ['【特殊胎儿来历】使用者已指定以下设定，请务必在 pregnant.fetuses 里实现：']
    .concat(lines.map((line) => '- ' + line))
    .join('\n');
}

/**
 * 初始技能／天赋的规则。技能页与「一次注册」共用，两边才不会走样。
 * fetusSource：'payload' 为技能页（胎儿来自 payload.target_fetuses）；'output' 为一次注册（胎儿是这次输出的 profile.pregnant.fetuses）
 */
function buildSkillRuleLines(options = {}) {
  const skillPrompt = String(options.skillPrompt || '').trim();
  const skillBaselinePrompt = String(options.skillBaselinePrompt || '').trim();
  const inheritedTalentsLocked = Boolean(options.inheritedTalentsLocked);
  const emptyCatalog = Boolean(options.emptyCatalog);
  const hasFetuses = Boolean(options.hasFetuses);
  const fromOutput = options.fetusSource === 'output';
  const fetusGuide = '依父母双方种族与血统、父方与母方的技能／天赋、胎儿对母体的亲和（正亲和较常长成擅长，负亲和较常长成苦手）与剧情判断。'
    + '胎儿还没出生，天赋宜浅：通常 level 在 -2 到 2 之间，除非设定明确，否则不要超过 ±3；不是每一胎都需要天赋。'
    + '规则与 initialTalents 相同：skill 必须能在图鉴或本次 skillDefinitions 中找到。';
  return [
    skillBaselinePrompt
      ? '严格遵守 payload.skill_baseline_prompt：它是本聊天的高优先级技能基准，决定允许辨识与建立的技能类型。即使图鉴已有被基准排除的技能，也不得因此为角色配置、建立或发展该类技能；既有资料无需删除。'
      : '本聊天未设置额外技能基准，按角色资料与技能图鉴谨慎判断。',
    emptyCatalog
      ? '注意：payload.skill_catalog 目前是空的（这是本聊天的第一个角色）。因此 initialSkills 与 initialTalents 用到的每一个技能，都必须由你在本次 skillDefinitions 中完整定义，没有任何既有技能可以复用。'
      : '先查阅 payload.skill_catalog。语义适合的技能必须复用其精确 name 或 id，不得用近义词建立重复技能。',
    emptyCatalog
      ? '每个新定义必须同时提供 name 与明确说明技能范围的 description，缺一不可。'
      : '只有现有图鉴确实无法表达所需技能时，才能放入 skillDefinitions；每个新定义必须同时提供 name 与明确说明技能范围的 description。',
    'initialSkills 与 initialTalents 的 skill 必须使用图鉴中的精确 name/id，或本次 skillDefinitions 中的新技能精确 name。',
    '【天赋同样需要技能作为载体】天赋不是独立的性格标签，而是「对某个技能的先天擅长／苦手」。'
      + '因此 initialTalents 引用的技能若不在 payload.skill_catalog 中，必须先在本次 skillDefinitions 里定义它，否则该天赋会被丢弃。'
      + '若某个先天特质无法对应到一个明确的技能，就不要写成天赋。',
    '技能 level 为 1-10。天赋 level 为 -5 到 5：正数为擅长，负数为苦手，0 为尚未形成。',
    '技能与天赋共用经验曲线 requiredExp(level)=100*level*level；Lv0 形成擅长／苦手 Lv1 均需 100 EXP。',
    inheritedTalentsLocked ? 'payload.existing_skill_setup.talents 是孩子出生后保留的既有天赋，属于固定继承内容。必须参考它们配置技能，不得在 initialTalents 中输出同一技能的不同等级、方向或经验。' : '',
    '没有充分依据的项目不要添加；不得把性格、身体状态或一次性事件滥列为技能。',
    hasFetuses && fromOutput
      ? '【胎儿天赋】若这名角色怀有胎儿，可在 fetusTalents 为胎儿配置先天天赋；fetusIndex 是该胎在你这次输出的 profile.pregnant.fetuses 中的位置（从 0 起算）。' + fetusGuide
      : '',
    hasFetuses && !fromOutput
      ? '【胎儿天赋】payload.target_fetuses 是这名角色腹中目前可见的胎儿（fetusIndex 从 0 起算）。可在 fetusTalents 为胎儿配置先天天赋：' + fetusGuide
        + '某胎若已有 talents，你输出的清单会整份取代它，要保留的请照抄；不想改动的胎儿就不要列出。'
      : '',
    skillPrompt ? '严格参考 payload.initial_skill_prompt 的额外要求。' : '用户没有提供额外要求，请仅依现有角色资料谨慎判断。',
    `输出前请逐条自检：initialSkills、initialTalents${hasFetuses ? '、fetusTalents' : ''} 里的每一个 skill，都必须能在 payload.skill_catalog 或本次 skillDefinitions 中找到完全相同的名称。`
      + '对不上的条目会被系统丢弃，请在输出前补上定义或删掉该条目。',
  ].filter(Boolean);
}

export function buildRegistrySkillSystemPrompt(options = {}) {
  const hasFetuses = Boolean(options.hasFetuses);
  return [
    '你是 AIRP 角色初始技能与天赋配置器。只处理 payload.target_character。',
    '根据角色卡、世界书、最近对话、已注册角色状态及用户提示，生成可供用户确认的初始技能／天赋 JSON。',
    ...buildSkillRuleLines({ ...options, fetusSource: 'payload' }),
    '只输出 JSON，不要输出解释或 Markdown。结构必须是：',
    '{',
    '  "skillDefinitions": [{"name":"string","description":"string"}],',
    '  "initialSkills": [{"skill":"技能精确名称或ID","level":1,"exp":0}],',
    hasFetuses
      ? '  "initialTalents": [{"skill":"技能精确名称或ID","level":0,"exp":0}],'
      : '  "initialTalents": [{"skill":"技能精确名称或ID","level":0,"exp":0}]',
    hasFetuses ? '  "fetusTalents": [{"fetusIndex":0,"talents":[{"skill":"技能精确名称或ID","level":1,"exp":0}]}]' : '',
    '}',
    '没有项目的数组也必须输出为空数组。',
  ].filter(Boolean).join('\n');
}

/** 日记写作规则。日记页与「一次注册」共用 */
export function buildDiaryRuleLines(requestedDate = '') {
  return [
    '只为 payload.target_character 写一篇事后回顾式日记，不得替其他角色写。',
    '结合角色资料、现有状态、最近聊天与既有日记，使用第一人称，保持角色语气与认知边界。',
    '不要把日记写成即时旁白、系统总结或数值清单。',
    '严格遵守 payload.diary_writing_prompt。',
    requestedDate
      ? 'time 必须使用 payload.requested_diary_date。'
      : 'payload.requested_diary_date 为空时，请依故事上下文自行填写合适的日期标题；不要使用现实系统日期。',
  ];
}

/**
 * 「一次注册」附加在注册提示词后面的段落：同一次请求顺便产出第一篇日记与初始技能／天赋，
 * 省下日记与技能各自再送一次角色卡、世界书与聊天的成本
 */
export function buildRegistryBundlePrompt(options = {}) {
  const includeOutfit = options.includeOutfit === true;
  const includeSkills = options.includeSkills !== false;
  const parts = [includeOutfit ? '起始着衣' : '', '第一篇日记', includeSkills ? '初始技能／天赋' : ''].filter(Boolean);
  return [
    `【附带：${parts.join('、')}】`,
    `这次注册同时要产出这名角色的${parts.join('、')}，放在同一个 JSON 的顶层（与 name、profile 并列），${parts.length > 1 ? '每一项都必须输出' : '必须输出'}：`,
    includeOutfit ? `"currentOutfit": ${STARTING_OUTFIT_SAMPLE}` : '',
    '"diary": {"time":"日期标题","content":"日记正文"}',
    includeSkills ? '"skillSetup": {"skillDefinitions":[{"name":"string","description":"string"}],"initialSkills":[{"skill":"技能精确名称或ID","level":1,"exp":0}],"initialTalents":[{"skill":"技能精确名称或ID","level":0,"exp":0}],"fetusTalents":[{"fetusIndex":0,"talents":[{"skill":"技能精确名称或ID","level":1,"exp":0}]}]}' : '',
    ...(includeOutfit ? ['[起始着衣规则]', ...buildStartingOutfitRuleLines(options.outfitPrompt)] : []),
    '[日记规则]',
    ...buildDiaryRuleLines(options.requestedDate),
    `日记写的是注册当下这名角色的事后回顾，内容必须与你这次输出的 profile 一致（阶段、怀孕与否、${includeOutfit ? '衣着、' : ''}处境）。`,
    ...(includeSkills ? [
      '[技能／天赋规则]',
      ...buildSkillRuleLines({ ...options, hasFetuses: true, fetusSource: 'output' }),
      'skillSetup 里没有项目的数组也必须输出为空数组。',
    ] : []),
  ].filter(Boolean).join('\n');
}

// ═══ 四、衣柜 ════════════════════════════════════════════════════

export const DEFAULT_WARDROBE_PREP_PROMPT = [
  '请根据角色卡、世界书、最近对话与已注册状态，为指定角色补充少量可重复使用的衣柜项目 JSON。不要重建整个衣柜。',
  'main 是一套完整的基础衣着，同时只有一套；可用 parts 列出上衣、下装等组成。accessory 是可叠加配件。',
  'main 使用 fitProfile：masking 只能为 very_low/low/medium/high，support 只能为 none/normal/strong，capacity 只能为 tight/fitted/stretch/loose，convenience 只能为 inconvenient/normal/convenient。',
  'accessory 使用 category：underwear/outerwear/footwear/headwear/ornament/support/other；effects 最多两项，可选 masking/support/capacity/convenience 后缀 _up 或 _down。',
  'note 只写稳定外观与来源，不写当前穿着反应、怀孕变化或感受。返回 items 数组，不需要手填数值分数。',
].join('\n');

// 示例里的档位写成可选项而不是具体值：写具体值时模型常原样照抄，孕妇装也被存成 fitted
const STARTING_OUTFIT_SAMPLE = '{"nude":false,"main":{"name":"string","note":"string","parts":[],"fitProfile":{"masking":"very_low|low|medium|high","support":"none|normal|strong","capacity":"tight|fitted|stretch|loose","convenience":"inconvenient|normal|convenient"}},"accessories":[{"name":"string","note":"string","category":"underwear|outerwear|footwear|headwear|ornament|support|other","effects":[]}],"wearState":"整齐"}';

/** 衣物四维档位要跟文字描述对得上：新增衣物的三个流程与 tracker 共用 */
export const WARDROBE_FIT_CONSISTENCY_RULE = 'fitProfile 必须与 name、note 的描述一致，逐项判断，不要照抄示例：写明宽松、宽大、孕妇装、罩衫的 capacity 用 stretch 或 loose，修身、紧身、孕前旧衣用 fitted 或 tight；有托腹或承托设计的 support 用 strong；长款、宽摆能遮住腹部的 masking 用 medium 以上。';

export function buildWardrobePrepSystemPrompt(settings, options = {}) {
  const userPrompt = String(options.wardrobePrepPrompt || settings?.wardrobePrepPrompt || '').trim();
  return [
    '你是 AIRP 角色备装器。代入 payload.target_character 的身份、处境与身体状态（payload.existing_state），按用户要求整理她的长期衣柜：补充衣物，必要时汰换穿不下或不再适合的衣物。不改变当前穿着。',
    '根据用户要求选择最必要的项目；用户明确列出要补的项目时只补那些，未指定数量时一般补充 2-4 项，避免为每个角色创建庞大专属衣柜。',
    '只有用户要求整理、汰换、丢掉不合身衣物时才输出 remove。判断依据是 payload.existing_wardrobe 里衣物的 fitProfile 与角色现况：例如孕中后期 capacity=tight／fitted 的修身衣物通常穿不下，support=none 的衣物撑不住沉重的胸腹。',
    'remove 只能引用 payload.existing_wardrobe 里既有衣物的 id，并写出 reason；不得丢掉 payload.existing_outfit 正在穿的衣物，也不得引用 id=0。',
    '只输出 JSON，不要输出额外解释。',
    'JSON 顶层结构必须是：{"items": [...], "remove": [{"id": 1, "reason": "string"}]}。没有要新增或丢掉的就给空数组。',
    'main 是完整基础套装，可附 parts，并使用 fitProfile 档位。accessory 使用 category 与最多两项 effects。',
    'fitProfile：masking=very_low/low/medium/high，support=none/normal/strong，capacity=tight/fitted/stretch/loose，convenience=inconvenient/normal/convenient。',
    WARDROBE_FIT_CONSISTENCY_RULE,
    'category：underwear/outerwear/footwear/headwear/ornament/support/other。effects：masking/support/capacity/convenience 加 _up 或 _down。',
    'note 只写稳定外观与来源，不写当前反应或怀孕变化。不要输出数值四维。',
    '[用户备装要求]',
    userPrompt || '无',
  ].join('\n');
}

/** 起始着衣的规则：单独生成与一次注册共用 */
function buildStartingOutfitRuleLines(outfitPrompt = '') {
  return [
    'currentOutfit 是这名角色此刻身上的起始着衣：一套完整基础衣着 main 加上正在穿戴的配件 accessories，不要顺便生成整个衣柜。',
    '依角色卡、世界观与当下处境设计穿着，包括它合不合身：例如已显怀的孕妇仍硬穿孕前的修身衣服时，fitProfile 如实填这件衣服原本的档位（capacity=tight 等），系统会依孕期自动算出它被撑紧的程度；穿着的当下状态写进 wearState。',
    'main 使用 name/note/parts/fitProfile。fitProfile 档位：masking=very_low/low/medium/high，support=none/normal/strong，capacity=tight/fitted/stretch/loose，convenience=inconvenient/normal/convenient。',
    WARDROBE_FIT_CONSISTENCY_RULE,
    'accessories 的 category 为 underwear/outerwear/footwear/headwear/ornament/support/other，effects 最多两项，使用 masking/support/capacity/convenience 加 _up 或 _down（例如丝袜、孕妇托腹带、外套）。',
    'category 只是分类标签，不是清单：只列有特色、会被描写到，或会影响遮蔽／承托／容身／方便的配件，通常 0～3 件；普通内衣、袜子等没有特色的不必列。',
    'note 只写颜色、材质、版型、长短、图案与来源等稳定外观，不写角色感受、怀孕反应或衣物当下状态。',
    'wearState 是 12 字内的穿着状态标签，例如 整齐、扣子绷紧、衣衫不整。',
    '明确全裸时填 nude=true，此时不列 main 与 accessories。',
    outfitPrompt ? '严格遵守 payload.outfit_prompt 的起始着衣细则。' : '',
  ].filter(Boolean);
}

export function buildStartingOutfitSystemPrompt(options = {}) {
  return [
    '你是 AIRP 角色起始着衣设计器。只为 payload.target_character 决定此刻身上穿着什么，参考 payload.existing_state 的阶段、孕程与描述。',
    ...buildStartingOutfitRuleLines(options.outfitPrompt),
    '只输出 JSON，不要输出额外解释。',
    `JSON 顶层结构必须是：{"currentOutfit": ${STARTING_OUTFIT_SAMPLE}}`,
  ].join('\n');
}

// ═══ 五、描述范本与日记写作的预设 ════════════════════════════════

export const DEFAULT_REGISTRY_DESCRIPTION_GUIDES = Object.freeze({
  normalDescription: `
  *状态|角色的总体状态，基于活力/性欲/情压/宫压以及生心理需求
  *表情|角色的面部表情，顯現情緒
  *行动|角色正在执行的动作与身体姿势
  胸部|可包含胸部的大小(罩杯)与触感，乳头的形状与色泽，行动的晃动幅度；孕后的变化及泌乳叙述
  腹部|可包含腹部的大小与触感，肚脐的状态，腹部传出的声音；泄意的影响；孕后的变化及胎动的状态
  私处|可包含阴蒂与阴道的形状与色泽，是否有阴毛，流出分泌物；性交插入时的状态
  后庭|可包含肛门的状态，饮食消化的叙述，泄意的影响；性交插入时的状态
  症状|月经、妊娠、分娩于角色上的影响
  {如果角色不是人类，可加上人外特征，如精灵耳或狐狸尾等}
  {如果角色兼具男性性器（扶她），可加上性器字段}`,
  // 1.2.0：羊水并进供养；胎位与大小系统已算（positionText、weight），胎况拿掉、健康并进风险
  pregnantDescription: `
  供养|子宫、宫颈、胎盘与脐带（或卵黄等其他供养源）的样子与触感，羊膜与羊水的状态
  *动作|胎儿当下的动作与胎动，各胎偏好的动法，多胎之间的互动
  *反应|胎儿对外界刺激与母亲举动的反应、当下的心情，以及胎内的整体氛围
  风险|胎儿的发育与健康，角色妊娠的特性、并发症与风险评估
  护理|角色对产前护理采取的行动，包含是否产检、遵照医嘱`,
  // 字段名前加 * 代表即时状态：每轮追踪都提醒模型「变了就改」。卵方所有字段照旧一天没更新就点名；
  // 精方（1.2.0）只点名带 * 的字段
  sireDescription: `
  外貌|稳定的外貌与身分：体格、发色、疤痕、龙角或尾巴等人外特征；剧情揭晓真名或真实身分时更新
  性器|阴茎（或种族的等效器官）的形状、颜色与特征（龟头、青筋、种族特有的结或倒刺等）与勃起状态；大小与档案的剑（sword：偏大、硕大、偏小、短小，没写为与体型相称）一致，写相对体格的观感，不写尺寸数字
  *行动|正在执行的动作与身体姿势，以及当下的情绪`,
});

// 1.2.4 以前的精方预设（性器栏还要模型自己定大小）：没改过就换成新预设
export const LEGACY_SIRE_DESCRIPTION_GUIDE = `
  外貌|稳定的外貌与身分：体格、发色、疤痕、龙角或尾巴等人外特征；剧情揭晓真名或真实身分时更新
  性器|阴茎（或种族的等效器官）的大小、形状与特征
  *行动|正在执行的动作与身体姿势，以及当下的情绪`;

// 1.2.0 以前的卵方预设（状态、表情、行动没有 *）：设定里存的还是这份就换成新预设，改过的不动
export const LEGACY_NORMAL_DESCRIPTION_GUIDE = DEFAULT_REGISTRY_DESCRIPTION_GUIDES.normalDescription
  .replace('*状态|', '状态|')
  .replace('*表情|', '表情|')
  .replace('*行动|', '行动|');

// 1.2.0 以前的孕态预设（七栏）：同样只在没改过时换成新预设
export const LEGACY_PREGNANT_DESCRIPTION_GUIDE = `
  供养|子宫、宫颈、胎盘(卵黄或其他供养源)的状态描述
  羊水|羊膜、羊水量与杂质的综合状态描述
  胎况|胎位、大小、健康状况等
  动作|胎儿的动作种类、胎动情况、多胎互动等
  反应|对外界刺激反应、心情、空间感知、对角色行为反应与亲和度
  风险|角色妊娠的特性、并发症及风险评估
  护理|角色对产前护理采取的行动，包含是否产检、遵照医嘱`;

export const DEFAULT_DIARY_WRITING_PROMPT = `
日期訂為角色登場的前一天，内容通常至少三段，围绕当天事件、身体感受、自我解释、情绪反刍与角色式收尾展开；可以有停顿、遮掩、否认、矛盾与记忆偏差。`.trim();

// ═══ 六、纪录摘要整理 ════════════════════════════════════════════

/**
 * 胎儿事件堆与认知纪录超过保存上限时，最旧的几条并进摘要；追踪结束时另发一次请求，
 * 把这些条目连同旧要点改写成新要点（见 record_notes.js）。机械摘要只有次数与日期，
 * 像「胎盘偏低、不可提重物」「已确认怀了双胞胎」这类仍然有效的内容要靠这里留下来。
 */
export function buildRecordNotesSystemPrompt({ maxChars = 300 } = {}) {
  return [
    '你是 AIRP 角色纪录整理器。payload.target_character 的纪录超过保存上限，最旧的几条要并进摘要：把 previous_notes（先前的要点）与 folded（这次并进去的条目）整理成一段新的要点，之后追踪只看得到这段要点与次数统计，看不到原文。',
    '只输出 JSON：{"fetal_event_notes":"…","cognition_notes":"…"}；payload 里没有的那一项省略。',
    '以 previous_notes 为底改写：其中仍然有效的内容不要丢；新条目推翻旧内容时以新的为准。只用 payload 里有的内容，不补充、不推测。',
    `每一项不超过 ${maxChars} 字，用简短的陈述句，不分点、不加标题。`,
    '',
    '[胎儿事件 fetal_events]',
    '- folded 每条有 time、kind（类别）、change（程度）、target（第几胎／全部）、content。这是客观发生过的事。',
    '- 写成这次妊娠仍然有用的要点：诊察结论与医嘱、持续中的祝福或诅咒、还没好的伤病、哪一胎较弱或较小、最严重的几次伤害。一次性且已经过去的小事（喝了一碗汤、睡了午觉）并成一句或省略。',
    '- 胎儿照 target 的写法指认，不要自己编号；不写健康数值。',
    '',
    '[认知纪录 cognition]',
    '- 这是角色本人的认知，也就是她相信什么，可能与事实不同。folded 每条有 time、method（得知方式）、content。',
    '- 按主题写她目前的信念：知不知道自己怀孕、知不知道自己正在分娩、几胎、孩子的父亲、孕期与预产期、身体状况与医嘱等；同一主题以最新的为准，被推翻的旧想法一句带过（曾以为……，后来……）。',
    '- 照她的理解写，错的也照错的写，不要更正成事实；写明来源（自己察觉、猜测、被告知、检测、诊察）。',
  ].join('\n');
}
