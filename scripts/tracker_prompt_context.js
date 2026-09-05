import { PSY_MENS_FIELDS, PSY_PREG_FIELDS } from './registry_psy_config.js';
import { buildEmbryoTypeLorePrompt } from './embryo_prompt_context.js';
import { buildRaceCatalogBlock, buildRacePhysiologyPrompt } from './race_prompt_context.js';
import { getDerivedTypeFluxProfile } from './race_config.js';
import { deriveFetusTags, describeFetusTags } from './fetus_tags.js';
import { LABOR_STAGES, PREGNANCY_STAGES } from './stage_config.js';

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
      pushFluxName(base.derivedType);
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
  '- 若角色具有 immune.metabolism=true，则 metabolism 也不会发给你，因为该角色不受代谢累积影响。',
  '- 若角色带有 offscreen=true，表示该角色当前不在场，existing_state 只提供精简状态，不代表角色不存在。',
  '',
  '[base]',
  '- isHere: 是否在场。false 时角色仍会随时间推进，但幕外角色只发送少量状态给你。',
  '- stage: 当前阶段。可能是月经阶段、妊娠阶段、假孕期、回归期、产兆前驱、第一/第二/第三产程、产后恢复、无经期、未激活。',
  '- 回归期：胎内回归的过渡阶段，由 bsWombReturn 产生。此期间衣着压力顶到上限、体内那一胎的胎重为上限 3.0，两者随 pregnant.wombReturn.remainingHours 归零而线性回落，之后自动转入孕早期。',
  '- pregnant.wombReturn: 回归期的进度，含 returner（回归者名）、totalHours、remainingHours。不在回归期时不出现。',
  '- days: 当前阶段已经过了多少天，使用 0 起算的 elapsed/progress 语义；进入新阶段时为 0，超过该阶段上限后才切换下一阶段。',
  '- fertilizationDays: 受精后、着床前已经过的天数；着床等待期以 6 天为基础，并随角色实际月经周期长度等比缩放。',
  '- latestSexDays: 距最近一次性行为经过的天数；超过一个周期后通常会失效。',
  '- age: 角色年龄，单位为年。',
  '- race: 当前保存的种族字符串，可能带子类或混血，不再带 [derived] 前缀。',
  '- derivedType: 衍生类型字符串，如 不死-僵尸；没有则为 null。',
  '- sperms: 体内残留精液来源列表。残留每天自动衰减 10、归零即消失，通常 1-3 天内自然清空；不需要每轮重复描写流出。',
  '- sperms[*].male: 精液来源对象名称。',
  '- sperms[*].race: 该来源的父方种族字符串，已去除 [derived] 前缀，用于受精与混血计算。',
  '- sperms[*].derivedType: 该来源的父方衍生类型；没有则为 null。',
  '- sperms[*].value: 当前残留量，用于多父竞争与受精判定；每天自动衰减 10，无需手动清除。',
  '- eggs: 当前可受精卵子数。',
  '- libido: 性欲。',
  '- uterinePressure: 宫压，越高越接近妊娠风险或分娩。',
  '- vitality: 活力。',
  '- psyStress: 情压/精神压力。',
  '- vitalityLevel / psyStressLevel: 个体等级，决定对应数值上限与体质倾向。',
  '- vitalityLevelText / psyStressLevelText: 系统额外附带的等级文字说明，方便直接理解体质与精神倾向。',
  '',
  '[pregnant]',
  '- pregnant 只会在已有 fetuses、妊娠阶段、产兆前驱/产程、产后恢复或假孕期发送；幕外角色发送时只保留少量 pregnant 摘要，并用 fetusesCount 表示胎儿数量。',
  '- pregnantDays: 这次妊娠的孕龄天数，等同产科从末次月经/本族等价周期起点计算的孕周天数。',
  '- effectivePregnantDays: 真正计入胎儿发育与阶段推进的有效孕龄天数；当妊娠被冻结时，它可以停在原地而 pregnantDays 继续增加。',
  '- laborHours / effectiveLaborHours / laborPhase / laborFetusIndex / laborPain 仅在产兆前驱或正式产程期间发送；产后恢复不再表示分娩疼痛。',
  '- laborHours: 当前产程内部阶段已消耗的实际时长。',
  '- effectiveLaborHours: 真正推动当前产程内部阶段前进的有效时长。',
  '- laborPhase: 当前产程内部阶段。第一产程为潜伏期/活跃期/过渡期；第二产程为胎体下降/胎体娩出/间歇期；第三产程为供养器官娩出/产后观察。',
  '- laborFetusIndex: 第二产程当前处理的胎次，从 1 起算；其他阶段通常为 0。',
  '- laborPain: 当前分娩疼痛程度，范围 0-10。描写疼痛反应不得明显超过此等级；刚进入第一产程时不应写成已达到极限痛苦。',
  '- amnionDurability: 母体层的膜耐性；过低代表接近或已经破水。',
  '- nutrition: 妊娠供养力盈余/赤字。正值代表供养充足，负值代表供养亏空；每周会参与胎儿体重结算。',
  '- symptomReliefPending: 尚待透过母体安抚胎儿处理的妊娠不适次数；direction=maternal 的普通母胎互动成功时可消耗一次，其随机 affinity 结果为轻微变化时补回 1 点供养力，显著变化时补回 2 点供养力。',
  '- bsMaternalFetalInteraction 的 direction=fetal 表示胎儿对母体的亲近或排斥，须传 change 来改变 affinity，且不会补充供养力；direction=maternal 表示母体安抚胎儿，不传 change，系统会随机决定 affinity 变化，成功时也可依变化强度回补待安抚供养力，产兆前驱时用于分娩抵抗。每名角色每个新小时仅能成功生效一次。',
  '- blockage: 当日妊娠阻塞状态，格式为 {key, severity}。key 可为 excretion/hunger/sleep/milk/odor/companionship/fluxPositive/fluxNegative；它会让对应需求的 bsExcreteMetabolism 排解不顺畅。',
  '- acceleration: 当日妊娠快积状态，格式同 blockage；它会让对应需求更快累积。',
  '- expansion: 当日妊娠扩容状态，格式同 blockage；它会将对应普通需求上限从 150 扩为 200，或将对应方向的 flux 上限从 ±150 扩为 ±200。blockage、acceleration 与 expansion 不会同时落在同一项需求上。非衍生角色不会出现 fluxPositive/fluxNegative；衍生角色不会出现其 derivedType 已抵免的普通需求。',
  '- fetuses: 胎儿列表。',
  '- fetuses[*].fathers: 父方对象名称。',
  '- fetuses[*].provider: 胚胎真正的归属方（代孕委托者、虫母等），自然受孕为 null。单一 provider 的孩子分娩后自动转交；多母源嵌合体以 × 显示并留在孕母名下。要建立外源受精卵请用 bsImplantEmbryo，不要自行编造。',
  '- fetuses[*].providerSources: 可接收孩子的母源名单。多于一位时孩子默认登记在孕母名下，之后可手动转移给其中一位。',
  '- fetuses[*].chimera: 受精卵早期融合的嵌合资料，包含来源数量、父源、母源与融合前性别。没有融合时不出现。',
  '- fetuses[*].tags: 系统标注的胎儿来历标签（如 chimera/surrogacy/identical），由系统推导或在事件发生当下写入，只读，不要自行增删。本轮出现过的标签会在下方另行说明。',
  '- fetuses[*].identicalGroup: 同卵分裂的组别编号；带同一编号且 tags 含 identical 的胎儿由同一颗受精卵分裂而来。没有分裂时不出现。',
  '- fetuses[*].conceivedAtDays: 异期复孕专用——这一胎受精当下的 effectivePregnantDays。该胎自己的孕龄 = effectivePregnantDays 减去这个值，所以同腹胎儿的发育进度可能不同。一般妊娠不出现。',
  '- 异期复孕的胎儿在进入孕中期之前不会出现在 fetuses 里，也不计入 fetusesCount：角色本人还不知道自己怀了两胎。它在系统里照常发育、照常消耗供养力，所以在揭晓前你会看到供养负担与体感比胎数应有的更重——那是伏笔，可以据此写身体的异样，但不要直接写破「其实有两胎」。揭晓时系统会以 notify 告知。',
  '- fetuses[*].fatherRace: 父方种族字符串，已去除 [derived] 前缀，用于理解父源与 fatherDerivedType。',
  '- fetuses[*].fatherDerivedType: 父方衍生类型；若没有则为 null。',
  '- fetuses[*].gender: 胎儿性别。',
  '- fetuses[*].embryoType: 胚胎型态，如 胎生、卵生、卵胎生、胎转卵生、不定型。',
  '- fetuses[*].weight: 胎重系数，標準1.0，范围0.33~3.0。影响妊娠负担、分娩难度与恢复期。',
  '- fetuses[*].tendencyAngle: 胎位倾向角度，影响孕期/产兆前驱中的调位，以及第二产程胎体下降/娩出的难度；角度映射固定为 0/360=正常头位/正位，180=完全臀位/倒位，90或270=横位，禁止反写；不会阻止第一产程进入第二产程。若 notify 发出难产警示，应优先考虑 bsChildbirth 手术产。',
  '- fetuses[*].tendencyAngleText: 系统额外附带的胎位文字说明，如 正位(头位)/倒位(臀位)/横位/斜位。',
  '- fetuses[*].affinity: 母胎之間的親密度，也会参与 derivedType 进展。',
  '- fetuses[*].maternalDerivedTypeProgress: 与母体(正)/父源(負)衍生同化的进度，范围 -100 到 100。',
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
  '- 这类字段偏长期记录，通常只在剧情明确成立时才需要更新。',
  '',
  '[psychology]',
  '- psychology 分为 mens (常规/生理) 与 preg (妊娠相关) 两大组心理指数。',
  ...Object.entries(PSY_MENS_FIELDS).map(([k, v]) => `- [mens] ${k} (0-100+): ${v.definition}`),
  ...Object.entries(PSY_PREG_FIELDS).map(([k, v]) => `- [preg] ${k} (0-100+): ${v.definition}`),
  '- 非怀孕时主要看 psychology.mens；怀孕、假孕、产兆前驱、产程时主要看 psychology.preg。',
  '- 心理阶段从 0 到 100+。若要调用 bsUpdatePsychology，数值参数表示变化量(delta)而不是目标值；例如当前 78 传 2 会变成 80，不是设为 2。建议尽量做小幅变化；单次以 ±1 到 ±3 为宜，±5 已属于大改。每名角色在每个新小时内仅允许一次成功心理变化，下一小时前不要重复调用。',
  '- 每个心理项由 *_value 和 *_interpret 组成。*_value 是 0-100 数值本体，*_interpret 是系统对应生成的心理解释。',
  '- psychology.mens 另外包含 isChaste (是否当前保持贞洁)、hasContraception (是否有避孕措施) 两个事件旗标。',
  '- psychology.preg 另外包含 knowsFatherSource (是否知晓父源)、hasProfessionalPrenatalCare (是否接受专业产检) 两个事件旗标。',
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
  '- 孕中期、孕晚期、临产期、逾期、产兆前驱、第一产程调用 bsTrainSkill 时，系统每次只随机选择一胎，将本次 skillExp 依该胎 affinity 自动传为天赋经验：skillExp*abs(affinity)/50，正亲和为擅长、负亲和为苦手、0 不传。第二与第三产程禁止传递。',
  '- 胎儿与孩子只有 talents，没有 skills。分娩时 talents 原样进入 children；日后注册孩子角色时，由用户在注册第五子页参考并载入，不会只凭同名自动继承。',
  '',
  '[children]',
  '- 已出生孩子列表。代孕／寄生所生的孩子会转交给 provider 指向的角色；该角色尚未注册时，孩子留在承载者名下并保留 children[*].provider 标记。',
  '- children[*].name: 孩子姓名。',
  '- children[*].fathers: 父方对象名称。',
  '- children[*].gender: 孩子性别。',
  '- children[*].race: 孩子种族。',
  '- children[*].derivedType: 孩子继承到的衍生类型；没有则为 null。',
  '- children[*].age: 孩子年龄，单位为年，会随时间推进。',
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
  '- excretion 会在活力增加时累积；以 bsExcreteMetabolism 处理 hunger（进食）会增加部分泄意与少量困意，处理 sleep（睡眠）会增加少量饿意。milk 代表乳意：普通周期中为乳房胀敏或周期不适，黄体期/月经期会随时间累积，排卵期可因性欲波动少量累积；妊娠、假孕或产后恢复时则也涵盖乳胀与泌乳需求。odor 代表需要清理的臭意，companionship 代表渴望陪伴或社交的伴意。',
  '- 时间累积满一周时会进行日常生活结算：基本清洁会清除臭意，日常往来会缓解部分伴意；普通周期进入新一轮卵泡期时，周期型乳意会清零。妊娠、假孕或产后恢复的泌乳型乳意不会因跨周自动清除。',
  '- 只有剧情确实发生陪伴或社交时，才用 options.companionship 缓解伴意；臭意达到高等级时会降低陪伴缓解效果。伴意解除不额外转化为乳意；乳意仍由周期、妊娠/假孕/产后恢复与性欲波动等既有来源产生。',
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
  '  - milk: 乳意快升、溢乳。',
  '  - sleep: 晕眩、嗜睡。',
  '  - odor: 体温升高、容易排汗。',
  '  - companionship: 黏人。',
  '- pregnant.expansion 表示扩容症状，会使对应需求可承受量从 150 提高到 200，因而需要更多解除量才能排净：',
  '  - excretion: 水肿、肠道慢蠕动，排出的量较少。',
  '  - hunger: 养分母体优先，但使胎儿活动降低。',
  '  - milk: 胸部变得沉重饱满，不同于阻塞的压迫疼敏。',
  '  - sleep: 激素使精力旺盛，但属于代偿。',
  '  - odor: 孕妇特有的香气掩盖了需要清理的不适。',
  '  - companionship: 胎儿带来内在陪伴感，可以忍受更长的孤独。',
  '- fluxPositive / fluxNegative 的阻塞、快积与扩容需按该衍生种族的正负极需求解释；解放 flux 时传 options.flux。',
  '- 对 derivedType 角色来说，被衍生代谢抵免的需求不会出现在 metabolism 中；未出现的需求不要主动提醒或要求处理。',
  '',
  '[wardrobe / outfit]',
  '- wardrobe 是角色衣柜，包含 items；outfit 是当前穿着。主流敘事通常只需要关注在场角色的 outfit。',
  '- 衣物 item 字段：id/name/note/slot/masking/support/capacity/convenience。id 使用整数；默认主件 id=0 表示全裸，不要加入 wardrobe.items。note 只写衣物稳定外观与来源：颜色、材质、版型、长短、固定开口、图案、制服/病服/借装来源等；皮肤暴露、开衩、透肤、深领等稳定外观写在 note。禁止写当前穿着反应、角色感受、近期身体变化、怀孕/胀痛/压胸/勒红/变紧/显怀等动态状态；这些由四维、pregFit 与当轮叙事推导。slot=main 为一次只能穿一件的完整基础套装：一般将上衣与下着合并为同一 main（连身裙、连体衣除外），不得拆成彼此互斥的 main，也不得把下着放入 accessory；四维按整套评分。main 可附 parts 数组列出组成部件名（如 ["白衬衫","牛仔裤"]）。slot=accessory 为可叠加的外套、鞋履、帽子、饰品、贴身内衣或功能配件补正；配件可附 layer（inner=贴身内衣等穿在主件之下，outer=外搭，默认 outer）。配件单项只能 -3 到 3，通常只影响 1-2 个最相关维度，其他维度填 0。',
  '- 剧情中重新搭配上下装（如白衬衫改配短裙）时，不要修改原主件，应用 bsAddWardrobeItem 铸造新的组合主件（parts 列出部件）再用 bsChangeOutfit 换上；组合只需在实际穿过时创建。',
  '- outfit.wearState 为当前穿着状态短标签（12 字内），默认 整齐。建议词表：整齐/凌乱/敞开/半褪/撩起/上衣已褪/下装已褪/湿透，也可按情境自造同粒度短标签；主件有 parts 时优先引用部件名消歧，如「毛衣已脱」「裙摆撩起」。剧情中穿着完整度或整洁度变化时，用 bsChangeOutfit 只传 wearState 即可更新；换主件时未显式传入会自动重置为整齐。仅着内衣可表达为 mainItemId: 0 加 inner 配件。',
  '- 可独立穿脱的外层（毛衣、开衫、外套等）应是 layer=outer 的配件而不是 main 的一部分；若发现某主件把外层并入了 parts，可用 bsAddWardrobeItem 把外层拆成新配件并更新该主件。',
  '- 四维含义：masking=掩盖身体曲线、孕肚、胸腹变化的程度，不等于皮肤裸露程度，露肤、开衩、透肤等稳定外观由 note 描述；support=对胸、腹、腰、重心的承托程度；capacity=容许体型变化的程度；convenience=行动、穿脱、如厕、哺乳或排解需求的方便程度。',
  '- 可用 bsAddWardrobeItem 添加/更新长期衣柜衣物，bsRemoveWardrobeItem 删除长期衣柜衣物，bsChangeOutfit 更换当前主件和配件。穿上或脱下个别配件（穿鞋、戴外套、脱袜等）优先用增量参数：addAccessoryItemIds 穿上、removeAccessoryItemIds 脱下，在当前配件基础上生效，不需要重述其他配件。accessoryItemIds 是覆盖式完整列表，用于整套重设：脱掉所有配件传 accessoryItemIds: []；全裸传 mainItemId: 0 且 accessoryItemIds: []。wearState 只是状态标签，不会改变穿了哪些衣物。',
  '- 临时衣物（如病服、借来的外套、旅馆睡衣）不要加入 wardrobe；在 bsChangeOutfit 传 temporaryItems，并让 mainItemId/accessoryItemIds 指向其中 id。换回衣柜服装时传 temporaryItems: [] 清除临时衣物。',
  '- 衣物引用规则：调用衣柜工具时优先传整数 id；若不确定 id，可传准确的衣物名称字符串，系统会按名称解析。bsAddWardrobeItem 新增衣物可省略 id，系统会自动分配下一个整数 id，不要自造大数字 id。',
  '- 换装触发规则：只要 recent_messages 中出现穿上、脱下、更衣、借穿、被脱除、淋湿、衣衫不整、洗浴后重新着装等衣着或穿着状态变化，就必须调用 bsChangeOutfit，使 outfit 与当前叙事一致：换主件传 mainItemId；穿脱个别配件传 addAccessoryItemIds/removeAccessoryItemIds；仅状态变化传 wearState。不要用 wearState 或描述文字代替配件穿脱。',
  '- outfit.currentWearText 是系统解析出的当前穿着摘要（主件 + 穿着状态 + 配件与贴身衣物），仅供比对阅读，不要写回。每轮应将它与最近叙事对照：不符时必须同轮调用 bsChangeOutfit 修正。衣着的当前状态由 outfit 机械字段唯一承担，不要在 descriptions 中维护衣着子字段。',
  '- 幕外(offscreen)角色也会附带精简 wardrobe.items（仅 id/name/slot/layer）与当前 outfit 摘要。角色重新登场时，若衣着应有变化（如换了日常服、外出服），应在调用 bsSetCharacterPresence 的同一轮用 bsChangeOutfit 完成回场换装。',
  '- 四维数值只在孕期窗口（真实妊娠/产兆前驱/产程/产后恢复）发送并参与 pregFit 计算；窗口外 payload 中的衣物只有 id/name/slot/note/parts/layer，非孕期敘事请依 note 的稳定外观描述。四维仍保存在系统中，bsAddWardrobeItem 新增或更新衣物时仍必须给出完整四维。',
  '- outfit.pregFit 只在真实妊娠、产兆前驱、产程或产后恢复中存在；其余阶段为 null。pregFit.pregWearPressure 为孕期衣着压力，产后恢复期间会随恢复进度从产后初期水平递减到 0；gap 为四维余裕：masking/support/capacity/convenience。gap 低于 0 表示该维度已被孕期变化压过。',
  '- gap 表示衣物该维度扣除孕期压力后的余裕。一般 gap 约 3 以上表示仍有余裕；0 到 2 表示开始吃紧；-1 到 -3 表示明显冲突；-4 以下表示该维度严重失效。按具体维度叙述：masking 失效是轮廓、孕肚或胸腹变化难藏；support 失效是承托不足、下坠、晃动或重心负担外溢；capacity 失效是版型固定、尺寸死、腰腹胸臀被迫撑紧或扣合困难；convenience 失效是行动、穿脱、如厕或排解需求明显受阻。不要把 gap 数值直接写进叙事，除非是调试说明。',
  '',
  '[descriptions]',
  '- normalDescription / pregnantDescription 为文字描述栏位。',
  '- 两者格式固定为：字段名|描述内容;;字段名|描述内容;;...字段名|描述内容;;',
  '- 使用 bsSetDescription 前，必须逐一检查该描述栏位全部既有子字段；未传入的子字段会保留旧值，且仅代表它已检查并确认完全不变。不得为了简短而省略受本轮剧情、姿势、衣着、表情、身体状态或环境影响的字段。',
  '- 不要新增角色原本没有的描述子字段；只能更新 existing_state 中该角色该 descriptions 已存在的字段名。唯一例外：当本提示词包含 [pregnantDescription 初始化] 段时，可为其中点名角色的空 pregnantDescription 建立规范内的首批子字段。',
  '- 不要改写成自然段，不要省略字段名，不要把 ;; 或 | 换成别的分隔方式。',
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

function buildTrackerMetabolismGuide(payload = null) {
  const fluxNames = collectRelevantFluxNames(payload || {});
  const diaryEnabled = payload?.diary_enabled !== false;
  const wardrobeEnabled = payload?.wardrobe_enabled === true;
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
    if (String(item?.profile?.descriptions?.pregnantDescription || '').trim()) continue;
    names.push(String(item?.name || key));
  }
  return names;
}

export function buildTrackerSystemPrompt(basePrompt = '', descriptionGuides = null, payload = null) {
  const diaryEnabled = payload?.diary_enabled !== false;
  const metabolismGuide = buildTrackerMetabolismGuide(payload);
  const parts = [
    [
      '[bsPassedTime 强制规则]',
      '- bsPassedTime 是每一轮 tracker 分析都必须优先考虑的第一工具。',
      '- 你应先根据 recent_messages 判断本轮累计了多少分钟/小时/天，再调用 bsPassedTime 推进时间。',
      '- 只有在确认本轮完全没有任何可推进的时间量时，才允许不调用 bsPassedTime。',
      '- 其他状态工具默认建立在时间推进之后，不要跳过 bsPassedTime 直接更新长程状态。',
    ].join('\n'),
    String(basePrompt || '').trim(),
    metabolismGuide,
    // 名录只给名字：模型写 bsAddSperm.race 时需要词汇表，但每轮都发，不附辨识提示
    payload?.race_catalog_enabled === false ? '' : buildRaceCatalogBlock(),
  ];
  if (payload?.mainflow_context_snapshot) {
    parts.push([
      '[主流上下文快照使用规则]',
      '- payload.mainflow_context_snapshot 是 ST 主流上一轮生成 request 中已经发送或准备发送给模型的上下文快照。',
      '- 它仅用于补足本轮剧情、角色设定、已触发 worldinfo、模板注入、getwi/activewi 等主流背景。',
      '- 不要模仿主流输出风格，不要续写剧情；你的任务仍是根据 recent_messages 与 existing_state 返回 JSON tool_calls 来更新变量。',
      '- 若主流上下文快照与 tracker 工具调用规则、变量语义说明、existing_state 或 available_tools 冲突，必须以后者为准。',
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
  const embryoTypeLorePrompt = buildEmbryoTypeLorePrompt(payload || {});
  if (embryoTypeLorePrompt) parts.push(embryoTypeLorePrompt);
  if (!diaryEnabled) {
    parts.push('[diary]\n- diary 系统当前已关闭（settings.diaryRecentLimit = 0）。本轮不要参考 diary，也不要调用 bsWriteDiary。');
  }
  parts.push(payload?.require_full_description_updates === true
    ? [
      '[descriptions 完整更新模式：强制提示约束]',
      '- 只要调用 bsSetDescription 更新 normalDescription 或 pregnantDescription，其对应字符串必须带回该角色该栏位所有既有子字段，不得只传部分字段。',
      '- 即使字段内容未改变，也必须原样带回；先完整检查，再按既有字段顺序输出。此规则优先于节省 token 的考虑。',
      '- 若因上下文缺失无法可靠填写某个字段，则不要调用该栏位的 bsSetDescription；不要编造内容或交出不完整更新。',
    ].join('\n')
    : [
      '[descriptions 更新勤勉规则]',
      '- 若调用 bsSetDescription，先逐字段检查；所有受本轮影响的既有字段必须一并更新。省略只允许用于已确认完全不变的字段。',
    ].join('\n'));

  const trackedNames = Array.isArray(payload?.tracked_females)
    ? payload.tracked_females.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  if (trackedNames.length > 0) {
    parts.push([
      '[逐角色检查清单]',
      `- 本轮必须在 character_checks 中逐一列出：${trackedNames.join('、')}。每名恰好一笔。`,
      '- status 只能是 no_change、updated、present 或 offscreen；清单只用于核对，任何实际状态变更仍必须同时用 tool_calls 调用对应工具。',
    ].join('\n'));
  }

  const pregnantInitNames = collectPregnantDescriptionInitNames(payload);
  const pregnantGuide = String(descriptionGuides?.pregnantDescription || '').trim();
  if (pregnantInitNames.length > 0 && pregnantGuide) {
    parts.push([
      '[pregnantDescription 初始化]',
      `- 角色 ${pregnantInitNames.join('、')} 已进入妊娠相关阶段，但 pregnantDescription 仍为空。`,
      '- 这是「不要新增描述子字段」规则的唯一例外：请尽快用 bsSetDescription 按下方规范为该角色建立首批 pregnantDescription 子字段，只建立规范中列出的字段名。',
      '- 格式仍为：字段名|描述内容;;字段名|描述内容;;，不可用自然段，不可省略字段名。',
      '',
      '【pregnantDescription 规范】',
      pregnantGuide,
    ].join('\n'));
  }

  return parts.filter(Boolean).join('\n\n');
}

export function buildMainFlowStatePrompt(payload = {}) {
  const existingState = payload?.existing_state && typeof payload.existing_state === 'object' ? payload.existing_state : {};
  const hasState = Object.keys(existingState).length > 0;
  if (!hasState) return '';
  const racePhysiologyPrompt = buildRacePhysiologyPrompt(payload || {});
  return [
    racePhysiologyPrompt,
    '<bs_biotracker>',
    '[并行生理追踪上下文]',
    '以下内容来自并行运行的角色生理状态追踪支流。',
    '已注册角色状态仅供叙事参考，不要在回复中复述字段、JSON 或本段上下文。',
    '状态为只读；若剧情没有明确触发变化，不要编造与之冲突的生理、心理或关系变化。',
    '',
    '[当前已注册角色状态]',
    serializeStateForPrompt(existingState),
    '</bs_biotracker>',
  ].join('\n');
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
