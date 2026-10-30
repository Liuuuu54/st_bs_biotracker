import { PSY_MENS_FIELDS, PSY_PREG_FIELDS } from './registry_psy_config.js';
import { buildEmbryoTypeLorePrompt } from './embryo_prompt_context.js';
import { buildBodySizeToolNote, buildRaceCatalogBlock, buildRacePhysiologyPrompt, buildWorldBaselineBlock, isOwnMetabolismHidden } from './race_prompt_context.js';
import { getDerivedTypeFluxProfile } from './race_config.js';
import { deriveFetusTags, describeFetusTags } from './fetus_tags.js';
import { LABOR_STAGES, MENSTRUAL_STAGES, PREGNANCY_STAGES } from './stage_config.js';
import { parseDescriptionGuideFields, stripDescriptionGuideStars } from './descriptions.js';

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
  '- 若角色带有 immune.metabolism=true，则 metabolism、pregnant.nutrition 与 blockage/acceleration/expansion 都不会发给你，本人的衍生需求说明也不发，因为该角色不受代谢累积影响；不要为她调用 bsExcreteMetabolism。',
  '- 若角色带有 offscreen=true，表示该角色当前不在场，existing_state 只提供精简状态，不代表角色不存在。',
  '- 值为 null、空字串、空列表或空物件的字段一律省略，省略即代表「无」（例如没有 sperms、没有 children、derivedType 不存在）；outfit.mainItemId=null 表示衣着未记录；认知与心理的省略/null 表示未知，不等于未孕或 0。',
  '',
  '[base]',
  '- isHere: 是否在场。false 时角色仍会随时间推进，但幕外角色只发送少量状态给你。',
  '- stage: 当前阶段。可能是月经阶段（卵泡期、排卵期、黄体期、月经期、乏情期；乏情期是长周期物种月经后的静止期，不会自然排卵；子宫被灌满且至少八成是异种精液时，高潮可诱发排卵，受孕的胎儿较弱）、妊娠阶段、假孕期、回归期、产兆前驱、第一/第二/第三产程、产后恢复、无经期、未激活。',
  '- 回归期：胎内回归的过渡阶段，由 bsWombReturn 产生。此期间衣着压力顶到上限、体内那一胎的胎重为上限 3.0，两者随 pregnant.wombReturn.remainingHours 归零而线性回落，之后自动转入孕早期。',
  '- 回归期不受子宫压力影响，不会自然流产；此期间呼叫 bsAbortion 代表回归者被消化吸收、并入承载者，而不是被排出。',
  '- pregnant.wombReturn: 回归期的进度，含 returner（回归者名）、totalHours、remainingHours。不在回归期时不出现。',
  '- days: 当前阶段已经过了多少天，使用 0 起算的 elapsed/progress 语义；进入新阶段时为 0，超过该阶段上限后才切换下一阶段。',
  '- fertilizationDays: 受精后、着床前已经过的天数；着床等待期以 6 天为基础，并随角色实际月经周期长度等比缩放。',
  '- latestSexDays: 距最近一次性行为经过的天数；超过一个周期后通常会失效。',
  '- penetrationState / penetrationSource 是当前可受孕生殖道的插入状态与来源；只按剧情事件用 bsAddSperm 更新，插入不等于射精。',
  '- penetrationFit: 本次插入的体型契合（label、gap、text 与是否变化态、sizeBridge），由 bsAddSperm insert 结算，拔出后清除；只影响叙述，不限制交合与受孕。',
  '- age: 角色年龄，单位为年。',
  '- bodySize: 角色常态（人态）的个体体型，1–7 级，人类为 4；缺省时按种族平均。变化态体型由系统按种族推算。',
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
  '- nutrition: 妊娠供养力盈余/赤字，由需求照料累积：任一需求在「高」时用 bsExcreteMetabolism 彻底处理到「无」约 +1，只处理一半不算；拖到「爆」约 -1，停在爆每满 24 小时再扣一次；「满」不增不减。点数会按种族与妊娠负担折算，所以常见小数。正值代表供养充足，负值代表供养亏空。这是全部胎儿的合计：系统每次计分当下就按各胎孕龄与位置拆给每一胎，每周各自换算成胎重后归零。',
  '- 胎位操作、胎儿自主活动、母胎互动与插入推顶的规则写在各工具说明里（bsAssistFetalPosition、bsMaternalFetalInteraction、bsAddSperm），依工具回传描写。',
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
  '- fetuses[*].affinity: 母胎之間的親密度，也会参与 derivedType 进展。',
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
  '- 每名角色独立的当前周期认知纪录；只有 bsRecordExperience(action=cognition) 追加，缺少纪录不等于相信未孕。允许猜错孕程、胎数与胎父；不改客观事实。实际进入月经才刷新，长期 experience 与 children 保留。',
  '- 最新改口不删除旧笔；按先后与来源解读。系统受孕、胎父或工具成功不代表角色知情。未知身份不能用系统姓名补真相。',
  '- hasCondom 与事后避孕在工具执行时结算，结果下一次回复承接，不预测或强制改写当轮正文；未结算的亲历结果不得预写。',
  '- 自然妊娠线索只提示较容易注意身体变化，不自动确认怀孕。恢复期禁孕；恢复/假孕结束先进入月经刷新。',
  '',
  '[psychology]',
  '- psychology 分为 mens (常规/生理) 与 preg (妊娠相关) 两大组心理指数。',
  ...Object.entries(PSY_MENS_FIELDS).map(([k, v]) => `- [mens] ${k} (0-100+): ${v.definition}`),
  ...Object.entries(PSY_PREG_FIELDS).map(([k, v]) => `- [preg] ${k} (0-100+): ${v.definition}`),
  '- 非怀孕时主要看 psychology.mens；怀孕、假孕、产兆前驱、产程时主要看 psychology.preg。',
  '- 心理阶段从 0 到 100+。若要调用 bsUpdatePsychology，数值参数表示变化量(delta)而不是目标值；例如当前 78 传 2 会变成 80，不是设为 2。建议尽量做小幅变化；单次以 ±1 到 ±3 为宜，±5 已属于大改。每名角色在每个新小时内仅允许一次成功心理变化，下一小时前不要重复调用。',
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
  '  - milk: 胸部变得沉重饱满，不同于阻塞的压迫疼敏。',
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
  '- outfit.pregFit 只在真实妊娠、产兆前驱、产程或产后恢复中存在；其余阶段为 null。pregFit.pregWearPressure 为孕期衣着压力，产后恢复期间会随恢复进度从产后初期水平递减到 0；gap 为四维余裕：masking/support/capacity/convenience。gap 低于 0 表示该维度已被孕期变化压过。',
  '- gap 表示衣物该维度扣除孕期压力后的余裕。一般 gap 约 3 以上表示仍有余裕；0 到 2 表示开始吃紧；-1 到 -3 表示明显冲突；-4 以下表示该维度严重失效。按具体维度叙述：masking 失效是轮廓、孕肚或胸腹变化难藏；support 失效是承托不足、下坠、晃动或重心负担外溢；capacity 失效是版型固定、尺寸死、腰腹胸臀被迫撑紧或扣合困难；convenience 失效是行动、穿脱、如厕或排解需求明显受阻。不要把 gap 数值直接写进叙事，除非是调试说明。',
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
    '- virility 是精方精子品质的分级描述（精力、精液浓度，顺带影射阳物），只供叙事参考，不改体型契合；没有这栏代表一般。',
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
    '- cognitionRecords 保存角色信念，可以与事实不同；系统结果、真实胎父与胎数不自动成为角色知识。自然线索到点也不强制知孕。',
    ...(profiles.some((profile) => profile.bodyFamiliarity) ? ['- bodyFamiliarity 是身体对各性伴的熟悉度（系统按次数、体型相容与时间算出，前三名）：只描述身体的记忆与反应，例如对谁的触碰更快有反应，不代表感情或爱意。'] : []),
    ...(profiles.some((profile) => profile.lastCondomResult || profile.lastEmergencyResult) ? ['- lastCondomResult/lastEmergencyResult 只在结算后的下一次叙事出现：是系统结果，不等于角色察觉；可据此描写合理可见的后果，不要求本轮处理。'] : []),
    '- base：vitality 活力、psyStress 情压，体质与精神倾向看 *LevelText；libido 性欲；uterinePressure 宫压（上限随孕程提高，越高越接近流产或分娩）；eggs 可受精卵数；sperms 为体内残留精液，value 每天自然衰减；penetrationState 为 idle 未插入／inserted 插入中／spent 已射精。',
  ];
  if (profiles.some((profile) => profile.metabolism)) {
    lines.push('- metabolism：excretion 泄意、hunger 饿意、sleep 困意、milk 乳意（孕晚期以前是乳房胀痛敏感，孕晚期起才可能溢乳）、odor 臭意、companionship 伴意，flux 为衍生种族的正负极需求；数值越高越急迫（一般上限 150）。需求高时可自然体现身体状态，何时处理由剧情决定，不要求每轮安排。');
  }
  if (profiles.some((profile) => profile.pregnant)) {
    lines.push(
      '- pregnant：pregnantDays 孕龄天数；laborPhase 产程内部阶段；laborPain 分娩疼痛 0-10，描写不得明显超过；nutrition 供养盈亏，正为充足、负为亏空；amnionDurability 或胎儿上的 amnion 表示羊膜，已破即破水。',
      '- pregnant.laborEffort / pushFatigue（产程中）：push 表示产妇正在用力、rest 表示停下来喘口气；第一产程用力是白费力气；pushFatigue 用力疲劳 0-100，60 以上已经力竭、越推越没效果，描写可体现喘息与脱力。',
      '- fetuses 按子宫里由左到右排列，不代表出生顺序；presenting=true 是正在下降或娩出的那一胎。weight 胎重系数，1.0 为标准；affinity 母胎亲密度 -50～50，负值为排斥；positionText、backSideText、tendencyAngleText 是胎位现况，描写须一致。',
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
    .map(({ staleFields: _staleFields, isHere: _isHere, ...sire }) => sire);
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
    ...(presentSires.length > 0 ? ['[在场精方]', '已建档的精方（精液提供者）；只读，描写须与描述一致。virility 是精力与雄风的分级描述，没有这栏代表一般。', serializeStateForPrompt(presentSires)] : []),
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
    if (!condomFresh.has(name)) delete profile.lastCondomResult;
    if (!emergencyFresh.has(name)) delete profile.lastEmergencyResult;
    // 还在经期阶段就已经有胎儿，是受精卵尚未着床：旁白看不到，等着床进入孕早期才出现
    if (profile.pregnant && MENSTRUAL_STAGES.includes(String(profile.base?.stage || ''))) delete profile.pregnant;
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
