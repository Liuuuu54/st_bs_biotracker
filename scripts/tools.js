import { recordExperience, normalizeReproductiveSettings, refreshCognition, syncPsychologyLifecycle, psychologySide, experienceSnapshot, experienceFactor, naturalNoticeDays } from './reproductive.js';
import { syncCardSettings } from './card_settings.js';
import { sanitizeFetusTagList } from './fetus_tags.js';
import {
  cloneValue,
  createChildId,
  getContextSafe,
  derivePregnancyStageState,
  getGestationEffectiveSpeed,
  getGestationSpeciesSpeed,
  getGestationModifierMultiplier,
  getChatState,
  getPsyStressInitByLevel,
  getSettings,
  getVitalityInitByLevel,
  isSkillSystemEnabled,
  isWardrobeSystemEnabled,
  saveSettings,
  setVisualCue,
  summarizeOperationLogs,
  summarizeRawResult,
  syncCharacterStageFromProfile,
} from './state.js';
import {
  buildEmptyPsychologyGroup,
  normalizePsychologyGroup,
  normalizePsychologyStageProfiles,
  PSY_MENS_FIELDS,
  PSY_MENS_BOOL_FIELDS,
  PSY_PREG_FIELDS,
  PSY_PREG_BOOL_FIELDS,
} from './registry_psy_config.js';
import {
  DEFAULT_WARDROBE_ITEM,
  DEFAULT_WEAR_STATE,
  getNextWardrobeItemId,
  normalizeTransientOutfitItems,
  normalizeWardrobeItem,
  resolveWardrobeItemRef,
  sanitizeWearState,
  WARDROBE_DIMENSIONS,
} from './wardrobe_config.js';
import {
  DUE_DATE_DAYS,
  EXTENSION_MONTH_DAYS,
  FIRST_EXTENSION_UNTIL_DAYS,
  FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE,
  GESTATION_SPEED_MAX,
  GESTATION_SPEED_MIN,
  LABOR_STAGES,
  LABOR_STAGE_BASE_HOURS,
  LABOR_STAGE_INCREMENT,
  LABOR_POSTPARTUM_OBSERVATION_HOURS,
  MENSTRUAL_STAGE_DAYS,
  MENSTRUAL_STAGES,
  PREGNANCY_STAGE_DAYS,
  POSTTERM_START_DAYS,
  PREGNANCY_STAGES,
  TERM_START_DAYS,
} from './stage_config.js';
import {
  computePostpartumRecoveryDays,
  deriveFetusRace,
  deriveFetusAncestry,
  getBloodlineInfo,
  mergeFetusAncestry,
  getFetusInheritanceTag,
  getBaseRaceName,
  getDerivedTypeMetabolismExemptions,
  getEmbryoTypeByRace,
  getMergedRacePhysiologyProfile,
  getRecoveryCoefficientByRace,
  rollCompanionEggCount,
  parseRaceDescriptor,
  getRaceDescriptorComponents,
} from './race_config.js';
import {
  calculateDerivedInheritanceProgress,
  calculateFertilizationPreview,
  calculateImplantationDays,
  DERIVED_INHERITANCE_BASELINE_DAYS,
  DERIVED_INHERITANCE_THRESHOLD,
  getDerivedInheritanceSeed,
  SPERM_DECAY_PER_DAY,
} from './calculator.js';
export {
  calculateDerivedInheritanceProgress,
  DERIVED_INHERITANCE_BASELINE_DAYS,
  DERIVED_INHERITANCE_THRESHOLD,
} from './calculator.js';
import {
  addSkillExperience,
  addTalentExperience,
  appendSkillHistory,
  normalizeSkillList,
  normalizeTalentList,
  registerSkillDefinition,
  requiredExp,
  resolveSkillDefinition,
} from './skill_config.js';

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'bsPassedTime',
    description: '推进当前聊天中所有已注册角色的时间（不是单一角色）。会处理月经阶段、受精着床、孕期推进、产兆前驱、第一至第三产程、产后恢复，以及最近性行为计时。'
      + '各单位可同时给，会相加（如 day:1 与 hour:12 等于 1.5 天）。只能往前推：不给任何单位、或给负数都会被拒绝，时间无法倒退。',
    input_schema: {
      type: 'object',
      properties: {
        minute: { type: 'integer' },
        hour: { type: 'integer' },
        day: { type: 'integer' },
        week: { type: 'integer' },
        month: { type: 'integer' },
        year: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bsWriteDiary',
    description: '为单一角色追加一条主观日记。time 是日记的日期标题，不是具体钟点；请填写故事内日期、年月日、某日/第几天等，不要填 HH:mm、午後 这类时刻。同一角色每个故事日（24 小时）最多只能写一篇；若当天已写过，不得再次调用。content 应像角色事后写下的日记，不是即时心声或旁白；通常在跨日后回顾昨日，重大事件或 notify 提醒时也应写成事后补记。角色不在场也可以写。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        time: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['female', 'time', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsUpdateCharacterStatus',
    description: '对单一角色的活力、情压、性欲、宫压做增减更新。会联动代谢累积、高潮排卵、羊膜耐久警告等状态。'
      + '剧情中角色确实达到高潮时传 options.orgasm=true：系统把性欲推到上限、结算高潮排卵（每周期有冷却，按当下活力排出），之后性欲归零；同一段性事里多次高潮只传一次。不要用减少 libido 代替高潮。'
      + '四个数值传入的都是「变化量(delta)」而不是目标值：当前 vitality=80 传 -10 会变成 70，不是设为 -10。'
      + '结果会被夹在该角色的上限内，上限随其 vitalityLevel／psyStressLevel 与妊娠状态而不同，可从 existing_state 的 *_interpret 与上限文字判断，不必自行计算。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            vitality: { type: 'integer' },
            libido: { type: 'integer' },
            uterinePressure: { type: 'integer' },
            psyStress: { type: 'integer' },
            orgasm: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['female', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsAddWardrobeItem',
    description: '向单一角色的长期衣柜添加或更新衣物，无需先准备衣柜。main 是一套完整基础衣着，可用 parts 列出组成，fitProfile 使用隐藏四档与支撑/容身/方便档位。accessory 使用 category，effects 最多两项。新增可省略 id；更新传整数 id 或准确名称。以 id 或名称引用正在穿的临时衣物时，会把它转为长期衣物（id 与穿着不变），用于借来的衣服被送下等情况。note 只写稳定外观与来源。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        item: {
          type: 'object',
          properties: {
            id: { type: 'integer', minimum: 1 },
            name: { type: 'string' },
            note: { type: 'string' },
            slot: { type: 'string', enum: ['main', 'accessory'] },
            parts: { type: 'array', items: { type: 'string' } },
            fitProfile: {
              type: 'object',
              properties: {
                masking: { type: 'string', enum: ['very_low', 'low', 'medium', 'high'] },
                support: { type: 'string', enum: ['none', 'normal', 'strong'] },
                capacity: { type: 'string', enum: ['tight', 'fitted', 'stretch', 'loose'] },
                convenience: { type: 'string', enum: ['inconvenient', 'normal', 'convenient'] },
              },
              additionalProperties: false,
            },
            category: { type: 'string', enum: ['underwear', 'outerwear', 'footwear', 'headwear', 'ornament', 'support', 'other'] },
            effects: { type: 'array', maxItems: 2, items: { type: 'string', enum: ['masking_up', 'masking_down', 'support_up', 'support_down', 'capacity_up', 'capacity_down', 'convenience_up', 'convenience_down'] } },
          },
          required: ['name', 'note', 'slot'],
          additionalProperties: false,
        },
      },
      required: ['female', 'item'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsRemoveWardrobeItem',
    description: '从单一角色的长期衣柜永久删除衣物。剧情中衣物被撕毁报废、丢弃、送人、卖掉、遗失、被没收，或角色明确把穿不下的衣服收起不再穿时调用；只是脱下、换下、弄脏送洗不要删。itemId 可传整数 id 或准确名称。不能删除 id=0 的裸体特殊状态；删除正在穿的主衣装后，当前衣着会变为未记录，所以正在穿的衣物被毁时先用 bsChangeOutfit 换下再删。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        itemId: { type: ['integer', 'string'] },
      },
      required: ['female', 'itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsChangeOutfit',
    description: '原子更换单一角色的当前穿着，无需先准备衣柜。可用 mainItemId/配件 id 或准确名称引用既有衣物，也可在 main 与 accessories 直接建立并穿上新衣；scope=owned 收入衣柜，temporary 只存在当前穿着。mainItemId=0 是明确全裸，null 是衣着未记录。accessoryItemIds 覆盖整表，add/removeAccessoryItemIds 增量穿脱。wearState 只是 12 字内的动态状态标签。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        mainItemId: { type: ['integer', 'string', 'null'] },
        scope: { type: 'string', enum: ['owned', 'temporary'] },
        main: {
          type: 'object',
          properties: {
            name: { type: 'string' }, note: { type: 'string' },
            parts: { type: 'array', items: { type: 'string' } },
            fitProfile: {
              type: 'object',
              properties: {
                masking: { type: 'string', enum: ['very_low', 'low', 'medium', 'high'] },
                support: { type: 'string', enum: ['none', 'normal', 'strong'] },
                capacity: { type: 'string', enum: ['tight', 'fitted', 'stretch', 'loose'] },
                convenience: { type: 'string', enum: ['inconvenient', 'normal', 'convenient'] },
              },
              required: ['masking', 'support', 'capacity', 'convenience'],
              additionalProperties: false,
            },
          },
          required: ['name', 'note', 'fitProfile'],
          additionalProperties: false,
        },
        accessories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, note: { type: 'string' },
              category: { type: 'string', enum: ['underwear', 'outerwear', 'footwear', 'headwear', 'ornament', 'support', 'other'] },
              effects: { type: 'array', maxItems: 2, items: { type: 'string', enum: ['masking_up', 'masking_down', 'support_up', 'support_down', 'capacity_up', 'capacity_down', 'convenience_up', 'convenience_down'] } },
            },
            required: ['name', 'note', 'category', 'effects'],
            additionalProperties: false,
          },
        },
        accessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        addAccessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        removeAccessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        wearState: { type: 'string' },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsSetDescription',
    description:
      '更新单一角色的描述字段。调用前必须逐一检查该描述栏位的所有既有子字段；未传入某子字段仅表示它已检查且完全不变，不得因求简短而省略受本轮剧情、姿势、衣着、表情、身体状态或环境影响的字段。不能新增角色原本没有的子字段。描述内容必须使用格式：字段名|描述内容;;字段名|描述内容;;...字段名|描述内容;;，不可改成自然段或换行文本。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            normalDescription: { type: 'string' },
            pregnantDescription: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['female', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsSetCharacterPresence',
    description: '设置角色是否在场。设为 false 后，tracker 默认不会再把该角色完整状态发送给 LLM，直到重新设为 true。'
      + 'isPresent 必须显式传 true 或 false，省略会被拒绝——默认成在场会让漏填变成静默改状态。'
      + '若该角色正因胎内回归被冻结在别人体内，设为 true 会一并解除冻结、恢复其阶段推进。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        isPresent: { type: 'boolean' },
      },
      required: ['female', 'isPresent'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsRecordExperience',
    description: '记录单一角色的认知或更新长期关系/孩子。female、action、time 必填。cognition 需 method、content：只记角色感知、猜测、被告知或检查解读，允许错误与矛盾，不执行检查、不改真实胎父/胎数/孕程。date/breakup/marry/divorce 需 partner，一次一人，不连带修改其他关系。child 需已存在的 childIndex（从0起）及 name 或 selectedFather；null 取消选爹，省略保留，不改遗传父方。各 action 参数互斥。认知实际进月经刷新，关系和孩子长期保留。系统结果不等于角色知情；尚未结算的操作不得预写亲历结果，下一轮依实际结果与剧情补记。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string', minLength: 1 },
        action: { type: 'string', enum: ['cognition', 'date', 'breakup', 'marry', 'divorce', 'child'] },
        time: { type: 'string', minLength: 1 },
        method: { type: 'string', enum: ['perception', 'guess', 'informed', 'test', 'prenatal'], description: 'perception 亲历或身体自觉；guess 猜测或自行推算；informed 被他人告知；test 借助检测手段（验孕棒、药草、占卜、魔法等，只用世界观里已有的手段）；prenatal 由专业者诊察（医师、产婆、祭司、治疗师等）。不得引入世界观没有的器具。' },
        content: { type: 'string', minLength: 1 }, partner: { type: 'string', minLength: 1 },
        childIndex: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 1 },
        selectedFather: { type: ['string', 'null'], minLength: 1 },
      },
      required: ['female', 'action', 'time'], additionalProperties: false,
    },
  },
  {
    name: 'bsRegisterSkillDefinition',
    description: '向当前聊天的全局技能图鉴登记一个全新技能定义。新增时 name 与 description 都必填；先检查 skill_catalog，已有同名技能时直接引用，不要制造近义重复。此工具只建立定义，不会让任何角色觉醒或获得经验。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsTrainSkill',
    description: '依最近剧情让单一角色觉醒或锻炼一个已登记技能。skillExp 只能非负，技能只会进步、不会降级；技能不存在时必须明确传 awaken=true 才会从 Lv1 觉醒。角色自己的 talents 对所有 LLM 工具均为只读，只能作为判断 skillExp 的参考，绝不可直接修改；角色天赋仅能由用户在外部界面调整。若角色处于孕中期、孕晚期、临产期、逾期、产兆前驱或第一产程，系统每次只随机选择一胎，把本次 skillExp 按该胎 affinity/50 转为正负胎儿天赋经验；第二、第三产程不会传递。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        skill: { type: ['integer', 'string'] },
        skillExp: { type: 'integer', minimum: 0, maximum: 1000000 },
        awaken: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['female', 'skill', 'skillExp', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsUpdatePsychology',
    description: '按当前阶段更新单一角色的心理倾向数值。月经阶段使用 mens，妊娠/假孕/产兆前驱/产程使用 preg。系统会自动重算 *_interpret。每名角色在每个新小时内最多成功更新一次；在 bsPassedTime 推进满下一小时之前，重复调用会被跳过。注意：数值字段传入的是“变化量(delta)”而不是目标值，例如当前 stance_value=78，传入 {"preg":{"stance":2}} 会变成 80，而不是设为 2。建议一次只调整一个心理项，且尽量小幅变动；单次以 ±1 到 ±3 为宜，±5 已属于偏大变化。布林字段则是直接设为 true/false。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
              mens: {
                type: 'object',
                properties: {
                  mastery: { type: 'number' },
                  desire: { type: 'number' },
                  autonomy: { type: 'number' },
                },
                additionalProperties: false,
              },
              preg: {
                type: 'object',
                properties: {
                  confidence: { type: 'number' },
                  bonding: { type: 'number' },
                  stance: { type: 'number' },
                },
                additionalProperties: false,
              },
          },
          additionalProperties: false,
        },
      },
      required: ['female', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsAddSperm',
    description: '记录可受孕生殖道内的插入、精液沉积与拔出；口交、肛交、体外射精、手淫或单纯体表接触一律不要调用。戴套生殖道行为仍用本工具，hasCondom 决定本次 deposit 是否阻隔；省略沿用本次 insert 的设置，旧调用默认未戴套。'
      + 'action=insert／withdraw 时 amount=0；只有 insert 后才能以 action=deposit 沉积正数精液，沉积后若要再次射精须重新 insert。不同来源 insert 会直接交棒。'
      + 'amount 建议 10-30（残留每天自动衰减 10，即 1-3 天内自然消失）；当下有效量越高，本次受孕越容易且高产物种的伴生卵可能越多，但受精成功不会扣除或清空可见残留。给过大的值会让正文连续多日描写残留。扣除/排出既有精液请用 bsDrainSperm。'
      + 'race 使用 [derivedType-装饰子项]race-装饰子项 格式，混血种族以 X 分隔；父系 derivedType 直接从这个字符串解析。'
      + '产兆前驱与产程中插入会顶到最前面的胎儿：前驱时把领头胎儿往上顶、延后前驱；第二产程把产道里的先露胎往回顶、产程进度倒退，着冠时倒退更多且可能顶破胎膜；第一产程只会痛。被顶的胎儿亲和下降。产兆前驱中射精则会缩短前驱。结果写在回传讯息里，供下一次回复承接，不要求重写当轮正文。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        male: { type: 'string' },
        race: { type: 'string' },
        bloodline: { type: 'object', additionalProperties: { type: 'number' }, description: '已知血脉比例，键为race中的成分，值为0到1；不明时省略，不猜比例。race也可写精灵25%x人类75%。' },
        action: { type: 'string', enum: ['insert', 'deposit', 'withdraw'] },
        hasCondom: { type: 'boolean', description: '本次是否使用屏障式避孕（套子，或世界观中的等效手段，如羊肠套、魔法屏障）；只有剧情确实使用时才为 true，不得引入世界观没有的器具。insert 设置、deposit 可显式更新、省略沿用，withdraw 不结算。' },
        amount: { type: 'number', description: 'insert／withdraw 必须为 0；deposit 必须为正数。' },
      },
      required: ['female', 'male', 'race', 'action', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsDrainSperm',
    description: '让角色主动排出体内部分或全部精液残留，按当前各来源比例一并减少。用于角色主动清洗、灌洗或使用道具排出。注意：受精是在每次时间推进时用当下仍存在的精液判定，清空后这次性交不再有受孕机会；清洗/沐浴若剧情支持体内冲洗可选用，不要求避孕意图，不自动联动臭意解除。排出不撤销已受精结果。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['female', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsSetMenstrualPhases',
    description: '直接设置月经相关阶段，用于催情、药物、外力或剧情推进。'
      + 'stage 只接受这几个值：卵泡期、排卵期、黄体期、月经期、产后恢复、假孕期；其他值（含妊娠阶段与回归期）一律拒绝，无法用本工具让角色怀孕或结束妊娠。'
      + '切到排卵期时会重新允许高潮排卵，切到黄体期时也会刷新一次；假孕期可留精但不会排卵或受孕。'
      + '角色体内已有胎儿或受精进行中，或正处于真妊娠、回归期、产兆前驱、产程时，本工具会被拒绝，不会覆盖这些状态。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        stage: { type: 'string' },
      },
      required: ['female', 'stage'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsExcreteMetabolism',
    description: '缓解角色的生理需求。普通种族用于处理泄意、饿意、困意、乳意、臭意与伴意；其中 excretion（泄意）同时包含排尿与排便需求。乳意在普通周期表示乳房胀敏，在妊娠、假孕或产后恢复则可表示乳胀与泌乳需求；性欲波动会自然产生乳意，不由伴意解除额外转化。进食缓解 hunger 会增加 excretion 与少量 sleep，睡眠缓解 sleep 会增加少量 hunger，高 odor 会降低 companionship 的社交缓解效果。带 derivedType 的角色以 flux 进行极性解放，并处理未抵免需求；要解放 flux 时请传 flux，或不传 options 使用默认释放量。pregnant.blockage 会降低排解效果，pregnant.acceleration 会加快累积并让刚缓解的对应需求较快回升，pregnant.expansion 会使对应需求容量由 150 扩为 200。清洁可缓解 odor；若也支持体内冲洗，可另用 bsDrainSperm，但不自动排精。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            excretion: { type: 'number', minimum: 0, maximum: 200 },
            hunger: { type: 'number', minimum: 0, maximum: 200 },
            sleep: { type: 'number', minimum: 0, maximum: 200 },
            milk: { type: 'number', minimum: 0, maximum: 200 },
            odor: { type: 'number', minimum: 0, maximum: 200 },
            companionship: { type: 'number', minimum: 0, maximum: 200 },
            flux: { type: 'number', minimum: 0, maximum: 400 },
          },
          additionalProperties: false,
        },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsAbortion',
    description: 'purpose=emergency 表示事后避孕药/紧急避孕尝试（或世界观中的等效手段，如药草、魔法；世界观没有的手段不得引入），仅著床前处理服药前已有接触，按各自接触时间结算，窗口沿用该角色的着床时长，成功不清可见残留，不提供未来保护；服药不等于成功，结果只在下一次叙事提示，不代表角色知道。purpose=termination（旧调用默认）表示已明确成功的人工终止，purpose=miscarriage 落实非人工流产；确定结果不重抽，不自动 force。' + '已成立妊娠的自然流产与人工终止分别累计，著床前不计妊娠损失。'
      + '可指定 fetusIndex 做减胎（只拿掉那一胎，其余继续）；fetusIndex 从 0 起算，越界会被拒绝——'
      + '系统通知与介面说的「第 2 胎」对应 fetusIndex=1，不要直接照抄那个序号。省略 fetusIndex 则终止整个妊娠。'
      + '若 miscarriage 保护开启，则需 force=true 才会生效。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        purpose: { type: 'string', enum: ['emergency', 'termination', 'miscarriage'] },
        force: { type: 'boolean' },
        fetusIndex: { type: 'integer' },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsExtendPregnancy',
    description: '延产：以某种特殊手段（神奇医疗、法术、契约等）让妊娠拖过预产期迟迟不生，或结束延产。'
      + '只有剧情明确使用了这类手段才调用；单纯「还没生」「预产期过了」不要调用。'
      + '\naction=extend：第一次只能在逾期（满 42 周），或由逾期发动的产兆前驱使用，妊娠会维持到第 52 周；'
      + '之后延产期满会进入产兆前驱，可在那次产兆前驱再用，每次再延 28 天；第二次起每延一次会加深子宫乏力（宫压与性欲上限下降、产程变慢、产后恢复变长）。'
      + '已破水、已进入产程时不能延产。'
      + '\naction=induce：引产，结束延产期并立即进入产兆前驱；延产期间这是唯一的出口——不能剖腹（bsChildbirth）也不能终止妊娠（bsAbortion）。'
      + '\n延产期间宫压不会自行累积，也不会引发流产或产程；羊膜每天回复一点、不会破水。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        action: { type: 'string', enum: ['extend', 'induce'] },
        reason: { type: 'string', description: '剧情中使用的手段，例如「教会的延产圣术」' },
      },
      required: ['female', 'action', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsImplantEmbryo',
    description: '把外源胚胎植入角色体内：代孕、胚胎移植、虫母注卵、寄生产卵等，凡是「孕育者不是遗传母亲」的情节都用这个。'
      + 'provider 是胚胎真正的归属方（提供卵子的一方／虫母／委托母亲），分娩后孩子会转交给她；若她尚未注册，孩子会留在承载者名下并标注来源。'
      + '胚胎种族依遗传母方推导而非承载者，所以虫母的卵放进人类宿主仍是虫族血统。'
      + 'race 与 fatherRace 使用 [derivedType-装饰子项]race-装饰子项 格式，混血种族以 X 分隔。母系 derivedType 永远来自承载者；父系优先取 fatherRace，未写时才取 race。'
      + 'provider 若尚未注册，用 race 指明遗传母方种族；父方种族预设与遗传母方同族，跨种族时用 fatherRace 指明。'
      + 'count 只表示要建立几张胎儿卡、也就是几名可能写入族谱的有效后代候选，绝不表示故事中植入了几枚卵。一个十枚卵但仅有一名有效后代的卵群必须传 count=1；其余九枚是该卡的伴生卵（companionEggCount），由系统依种族另行决定。'
      + '工具加入的是尚未着床的受精卵，可在同一着床窗口重复调用；第一颗会启动共用 fertilizationDays，之后由 bsPassedTime 推进并统一着床。孕早期且仍在异期复孕窗口时也可追加，此时新胎同时标记代孕与异期复孕；其余妊娠阶段不可加入。自然受孕请勿使用本工具。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        provider: { type: 'string' },
        fathers: { type: 'string' },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: '建立的胎儿卡／有效后代候选数，不是卵的枚数。一般一个卵群传 1；伴生卵（companionEggCount）由系统另算。',
        },
        race: { type: 'string' },
        fatherRace: { type: 'string' },
      },
      required: ['female', 'provider'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsWombReturn',
    description: '胎内回归：让 returner 这个人回到 female 的子宫内成为其胎儿，经过一段过渡后转为正常妊娠，出生时是全新个体（新的孩子记录，与原来那个人不是同一笔资料）。'
      + 'returner 可以是任何人：user、未注册的路人、或已注册角色都行，不必事先注册。'
      + '未注册的 returner 请一并给 returnerRace 说明其种族；已注册角色可省略，系统会读她自己的种族。'
      + 'returnerRace 使用 [derivedType-装饰子项]race-装饰子项 格式，混血以 X 分隔；两者都缺时视同与承载者同族。'
      + '\n呼叫条件：承载者必须处于月经阶段（卵泡期/排卵期/黄体期/月经期）或无经期；她自己正在别人体内、或已在回归期时不可呼叫。'
      + 'returner 若是已注册角色且已经在别人体内，也不可再次回归。不能让角色回归自己的子宫。'
      + '呼叫时承载者子宫内已有的胎儿、残留精液与卵子会被直接净空。'
      + '\n呼叫后承载者进入「回归期」：衣着压力冲到上限 10，体内多出一胎且胎重为上限 3.0，'
      + '两者在 hours 小时内线性回落到正常，随后自动转入孕早期第一天，之后按一般妊娠推进。'
      + 'hours 是故事内经过的时间，必须是不小于 0 的数字，要靠 bsPassedTime 推进才会流逝；'
      + '传 0 表示瞬间完成（角色对这段过程无知觉），会当场结算进孕早期。回归期中不能植入其他胚胎。'
      + '\n该胎的母方为承载者、父方为 returner，种族照常混血，并带 rebirth 标签。'
      + 'returner 若是已注册角色，她的天赋会传给这一胎（技能不传），并且会被冻结：设为离场且停止一切阶段推进（她现在是一颗胎儿），'
      + '期间对她使用生理类工具一律无效；用 bsSetCharacterPresence 将她设回在场即可解除冻结。未注册的 returner 没有冻结这回事。'
      + '\n回归期不受子宫压力影响，不会因宫压过高而自然流产；只有明确呼叫 bsAbortion 才会中断。'
      + '\n在回归期内呼叫 bsAbortion 代表回归者被消化吸收：她不会被排出，已注册的角色维持冻结、并入承载者体内，承载者回到卵泡期。'
      + '一旦转入孕早期，这一胎就是正常胎儿，此后流产按一般流产处理。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        returner: { type: 'string' },
        returnerRace: { type: 'string' },
        hours: { type: 'number' },
      },
      required: ['female', 'returner'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsChildbirth',
    description: '让角色立即结束分娩并进入产后恢复，并把剩余胎儿转为 children 记录。省略 mode 或 mode=surgical 记为手术产（剖腹、急救等）；产程自然结束时系统自己记为自然产。'
      + 'mode=natural 只用来同步剧情：剧情已经写出阴道自然分娩、系统却还在临产期、产兆前驱或第一产程，没走到第二产程时用它一次结束，记为自然产；已在第二产程时改用 bsAssistFetalPosition（action=extract）逐胎同步。孕早期、孕中期不能自然分娩。'
      + '只有角色已着床进入妊娠阶段（孕早期起，含产兆前驱与各产程）才能调用；月经阶段、着床前、回归期都会被拒绝，此时不得叙述成已经生产。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        mode: { type: 'string', enum: ['surgical', 'natural'] },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsAssistFetalPosition',
    description: '剧情明确出现人工、器械或魔法的胎位操作，或胎儿有意识地自己转身、往上缩、往下钻、踢破胎膜时才调用；自然胎动与下降由 bsPassedTime 自动处理，不要为了「肚子下沉」「胎儿踢了一下」之类的描写调用。'
      + 'actor=fetus 表示这一胎自己动（任何胎儿都可以）：不消耗母体活力，但母体一样承受疼痛或心理压力；胎儿不能把自己拉出来（extract），也解不开自己卡住的肩膀。其余限制与外力操作相同：入盆后只能自己小幅转动（30° 以内）、胎背只能前后对调，产程中不能自己缩回、也不能自己往下钻（下降交给宫缩），但仍可踢破胎膜；互锁的那一胎可以自己转开。省略 actor 即为外力操作。'
      + 'fetusIndex 是 fetuses 列表下标（从 0 起算），省略时作用于正在下降／即将娩出的那一胎。每个动作都要通过检查才会生效，被拒绝时状态完全不变，叙事不得写成已成功。'
      + 'rotate：把胎儿转到 targetAngle（0/360 头位、180 臀位、90/270 横位），也可以用 backSide 把胎背转到 左前／右前／左后／右后（两者可同时给，至少给一个）；已入盆的胎儿只能小幅校正角度（与目前角度相差最多 30°，超过会被拒绝），胎背只能前后对调、不能换左右（例如把枕后位的右后转成右前）；卵生、胎转卵生是蛋，没有胎背，只能给 targetAngle；肩难产时可不给角度直接转动肩部解开卡点。'
      + 'lift：把胎儿往上托回一格；产兆前驱托高领头胎儿会把分娩延后，这是要跟宫缩对抗的，母体活力不足会被拒绝，并带来一阵剧痛。产程中已入盆的胎儿不能再托回；双胎互锁只能用 rotate 转开其中一胎。'
      + 'descend：把胎儿往下推送一格；产兆前驱推送领头胎儿会缩短前驱，时间归零即进入第一产程；正式产程中不能用。'
      + 'rupture：破水（每一胎有各自的羊膜，同卵共囊一起破）。只有在产兆前驱且宫压已达上限的 66%，或已在第一／第二产程时才会生效；产兆前驱破水会直接进入第一产程。剧情写到羊水流出、破水时必须调用，系统未确认前不要擅自描写破水。孕中孕内胎的胎膜破了代表它被宿主在宫内生出来，不算母亲破水。'
      + 'extract：第二产程中把正在产道里下降或娩出的那一胎直接助产拉出（胎膜未破会先破）；肩难产时也可以用。只生这一胎，不会结束其余胎儿的分娩；要一次结束全部请用 bsChildbirth。剧情已写出这一胎自己生下来、系统却还在下降或娩出中时，也直接用 extract 同步，记为自然产，不要让剧情等系统；不要为此改用 bsChildbirth（那会记成手术产）。'
      + '所有操作都会带来瞬时的疼痛（产程中）或心理压力（孕期），描写不得超过系统给出的疼痛等级。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        action: { type: 'string', enum: ['rotate', 'lift', 'descend', 'rupture', 'extract'] },
        fetusIndex: { type: 'integer' },
        targetAngle: { type: 'number' },
        backSide: { type: 'string', enum: ['左前', '右前', '左后', '右后'] },
        actor: { type: 'string', enum: ['assist', 'fetus'] },
      },
      required: ['female', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsMaternalFetalInteraction',
    description: '处理母体与胎儿、以及多胎之间的互动。每名角色在每个新小时内最多成功互动一次（三种 direction 共用）；在 bsPassedTime 推进满下一小时之前，重复调用会被跳过。direction=fetal 表示胎儿对母体的亲近或排斥，必须传 change，并调整随机一胎的 affinity。direction=maternal 表示母体安抚胎儿，不使用 change；系统会随机判定 affinity 变化。direction=sibling 只在剧情明确写到腹中两胎互动时使用（互踢、推挤、依偎），必须传 change：slight_decrease 一胎踢另一胎、使对方小幅偏转，significant_decrease 推挤、两胎可能左右换位，slight_increase／significant_increase 依偎、位置不变；对象是随机一对相邻且角色已知的胎儿，不影响 affinity。母胎互动（fetal、maternal）不影响供养力，也不改变胎位、下降或产程时间；要托高或推送胎儿请用 bsAssistFetalPosition。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        change: {
          type: 'string',
          enum: ['slight_increase', 'significant_increase', 'slight_decrease', 'significant_decrease'],
        },
        direction: {
          type: 'string',
          enum: ['fetal', 'maternal', 'sibling'],
        },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
]);

function clampNumber(value, min, max, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function ensureWardrobeState(profile) {
  if (!profile.wardrobe || typeof profile.wardrobe !== 'object' || Array.isArray(profile.wardrobe)) profile.wardrobe = {};
  profile.wardrobe.enabled = true;
  const sourceItems = Array.isArray(profile.wardrobe.items) ? profile.wardrobe.items : [];
  const items = [];
  for (const source of sourceItems) {
    const item = normalizeWardrobeItem(source);
    if (!item || items.some((existing) => existing.id === item.id)) continue;
    items.push(item);
  }
  if (!items.some((item) => item.id === DEFAULT_WARDROBE_ITEM.id)) items.unshift({ ...DEFAULT_WARDROBE_ITEM });
  profile.wardrobe.items = items;
  return profile.wardrobe;
}

function hasBreedingPsychology(profile) {
  const stageProfiles = profile?.psychology?.stageProfiles;
  return Boolean(stageProfiles && typeof stageProfiles === 'object' && !Array.isArray(stageProfiles)
    && Object.keys(stageProfiles).length > 0);
}

function getAvailableOutfitItems(profile) {
  const wardrobe = ensureWardrobeState(profile);
  const transientItems = Array.isArray(profile?.outfit?.transientItems)
    ? profile.outfit.transientItems.map(normalizeWardrobeItem).filter(Boolean).map((item) => ({ ...item, source: 'transient' }))
    : [];
  return [...wardrobe.items, ...transientItems.filter((item) => item.id !== DEFAULT_WARDROBE_ITEM.id)];
}

function findOutfitItem(profile, itemRef, slot = '') {
  return resolveWardrobeItemRef(getAvailableOutfitItems(profile), itemRef, slot);
}

function ensureOutfitState(profile) {
  ensureWardrobeState(profile);
  if (!profile.outfit || typeof profile.outfit !== 'object' || Array.isArray(profile.outfit)) profile.outfit = {};
  profile.outfit.transientItems = normalizeTransientOutfitItems(profile.outfit.transientItems);
  const mainItem = profile.outfit.mainItemId === null || profile.outfit.mainItemId === undefined
    ? null
    : findOutfitItem(profile, profile.outfit.mainItemId, 'main');
  const accessoryItems = Array.isArray(profile.outfit.accessoryItemIds)
    ? profile.outfit.accessoryItemIds
      .map((ref) => findOutfitItem(profile, ref, 'accessory'))
      .filter(Boolean)
    : [];
  profile.outfit.mainItemId = mainItem ? mainItem.id : null;
  profile.outfit.accessoryItemIds = accessoryItems
    .map((item) => item.id)
    .filter((id, index, list) => list.indexOf(id) === index);
  profile.outfit.wearState = sanitizeWearState(profile.outfit.wearState);
  if (!('pregFit' in profile.outfit)) profile.outfit.pregFit = null;
  return profile.outfit;
}

function getOutfitItems(profile) {
  const outfit = ensureOutfitState(profile);
  const main = outfit.mainItemId === null ? null : findOutfitItem(profile, outfit.mainItemId, 'main');
  const accessories = outfit.accessoryItemIds
    .map((id) => findOutfitItem(profile, id, 'accessory'))
    .filter(Boolean);
  return [...(main ? [main] : []), ...accessories];
}

function getOutfitDimensionTotals(profile) {
  const totals = Object.fromEntries(WARDROBE_DIMENSIONS.map((key) => [key, 0]));
  for (const item of getOutfitItems(profile)) {
    for (const key of WARDROBE_DIMENSIONS) totals[key] += clampNumber(item[key], -10, 10, 0);
  }
  for (const key of WARDROBE_DIMENSIONS) totals[key] = clampNumber(totals[key], 0, 10, 0);
  return totals;
}

// 一颗伴生卵占肚子的份量，以足月标准胎为 1；只影响衣着压力，不进代谢负担
const COMPANION_EGG_BULK = 0.15;

/**
 * 肚子实际装了多少：每胎「自身孕龄 × 胎重 / 280」加总，伴生卵按份量随所属那胎一起长大。
 * 与 fetalEnergyDrain 同源但不除以承载耐受——耐受是「扛不扛得住」，
 * 衣服合不合身只看肚子多大；除下去会让高耐受的龙娘足月像七个月、低耐受的一胎就撑爆
 */
export function getFetalBulk(profile) {
  const pregnant = profile?.pregnant || {};
  const effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  return fetuses.reduce((sum, fetus) => {
    const ownAge = Math.max(0, effectivePregnantDays - clampNumber(fetus?.conceivedAtDays, 0, 9999, 0));
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    const eggs = Math.max(0, Math.floor(Number(fetus?.companionEggCount) || 0));
    return sum + (ownAge / DUE_DATE_DAYS) * (weight + eggs * COMPANION_EGG_BULK);
  }, 0);
}

/**
 * 孕期衣着压力 = 基础 + 身形随孕周改变 + 肚子装的量。锚点：
 * 足月单胎 1.0 = 7、双胎 1.0 = 8.5、三胎 1.0 才碰到上限 10，与母体种族无关
 */
export function calculatePregWearPressure(profile) {
  const pregnant = profile?.pregnant || {};
  const effectiveDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  if (effectiveDays <= 0) return 0;
  // 以预产期为准，不用各阶段总长：临产期延到 42 周后总长是 294，会把孕程项整体压低
  const progress = Math.min(1.25, effectiveDays / DUE_DATE_DAYS);
  const basePressure = 0.5;
  const progressPressure = Math.pow(progress, 1.35) * 5;
  const fetalPressure = getFetalBulk(profile) * 1.5;
  return clampNumber(basePressure + progressPressure + fetalPressure, 0, 10, 0);
}

// 产后恢复的衣着压力：从产后初期的水平随恢复进度线性递减到 0（体型回缩、乳胀消退）。
const POSTPARTUM_START_WEAR_PRESSURE = 4;

/**
 * 胎内回归。一名已注册角色回到另一名角色子宫内成为胎儿，
 * 经过一段过渡后转入正常妊娠，出生时是全新个体（新的 child id）。
 *
 * 之所以需要一个独立阶段而不是直接塞进孕早期：过渡期间胎重是上限 3.0
 * （一个成人体积的东西刚进去），衣着压力顶到上限，两者都要随时间回落。
 * 直接进孕早期的话，updateFetalEnergyDrain 会拿 3.0 的胎重去算供养力，
 * 变成一场怪物妊娠。
 */
/**
 * 工具参数里的人名允许直接写 ST 的 user 宏。这些名字会原样存进 sperms[*].male、
 * fetuses[*].fathers、children[*].fathers，最后成为血缘图上的节点 id——
 * 不解析的话族谱上会冒出一个叫「{{user}}」的人，而且同一个人写法不同就变成两个节点。
 *
 * 刻意只认完整的 user 别名，不跑 substituteParams：那会把任何含大括号的名字一起改写，
 * 风险大于收益。
 */
const ST_USER_NAME_ALIASES = new Set(['user', '{user}', '{{user}}', '<user>']);
const PERSON_NAME_ARG_KEYS = ['female', 'male', 'provider', 'fathers', 'returner', 'partner', 'selectedFather'];

function resolveUserAliasName(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !ST_USER_NAME_ALIASES.has(raw.toLowerCase())) return null;
  const userName = String(getContextSafe()?.name1 || '').trim();
  return userName || null;
}

function resolvePersonNameField(value) {
  if (typeof value !== 'string') return value;
  const whole = resolveUserAliasName(value);
  if (whole) return whole;
  // 嵌合体的双父源写成 "A × B"。只按全角 × 拆——lineage 读取时也接受拉丁 x，
  // 但拿它来改写会把 Max 这种名字切坏，宁可漏解析也不要毁掉名字。
  if (!value.includes('×')) return value;
  const parts = value.split('×');
  let changed = false;
  const next = parts.map((part) => {
    const resolved = resolveUserAliasName(part);
    if (resolved) { changed = true; return resolved; }
    return part.trim();
  });
  return changed ? next.filter(Boolean).join(' × ') : value;
}

function resolvePersonNameArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  let changed = false;
  const next = { ...args };
  for (const key of PERSON_NAME_ARG_KEYS) {
    const resolved = resolvePersonNameField(next[key]);
    if (resolved !== next[key]) {
      next[key] = resolved;
      changed = true;
    }
  }
  return changed ? next : args;
}

/** 已经警告过的未知阶段，避免每次推进都刷一次 console */
const reportedUnknownStages = new Set();

const WOMB_RETURN_STAGE = '回归期';
const WOMB_RETURN_PEAK_PRESSURE = 10;
const WOMB_RETURN_PEAK_WEIGHT = 3.0;

/** 承载者允许被回归的阶段：子宫得是空的（有东西会被净空），且不能正在妊娠或生产 */
function canAcceptWombReturn(stage) {
  return MENSTRUAL_STAGES.includes(stage) || stage === '无经期';
}

/** 这个角色现在是别人肚子里的一颗胎儿 */
function getWombReturnHost(character) {
  return String(character?.profile?.base?.wombReturnHost || '').trim();
}

/**
 * 被冻结的角色不得再被生理类工具改动。冻结原本只挡住 bsPassedTime，
 * 但 bsSetMenstrualPhases 之类照样能改她的阶段——一颗胎儿被设成排卵期，
 * 而且她的阶段永远不会再推进，等于把状态锁在一个假值上。
 */
const WOMB_FROZEN_BLOCKED_TOOLS = new Set([
  'bsSetMenstrualPhases',
  'bsAssistFetalPosition',
  'bsAddSperm',
  'bsDrainSperm',
  'bsImplantEmbryo',
  'bsAbortion',
  'bsChildbirth',
  'bsExtendPregnancy',
  'bsMaternalFetalInteraction',
  'bsExcreteMetabolism',
  'bsUpdatePsychology',
]);

function wombReturnProgress(state) {
  const total = clampNumber(state?.totalHours, 0, 99999, 0);
  if (total <= 0) return 1;
  const remaining = clampNumber(state?.remainingHours, 0, 99999, 0);
  return clampNumber(1 - (remaining / total), 0, 1, 1);
}

/** 过渡期间的胎重：3.0 线性回落到 1.0 */
function applyWombReturnWeight(profile) {
  const state = profile?.pregnant?.wombReturn;
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  const progress = wombReturnProgress(state);
  const weight = WOMB_RETURN_PEAK_WEIGHT - ((WOMB_RETURN_PEAK_WEIGHT - 1) * progress);
  for (const fetus of fetuses) {
    if (!Array.isArray(fetus?.tags) || !fetus.tags.includes('rebirth')) continue;
    fetus.weight = clampNumber(weight, 0.33, 3.0, 1.0);
  }
  updateFetalEnergyDrain(profile);
}

/**
 * 结算回归期：转入孕早期。overflowDays 是超出回归期的那段时间，
 * 带进妊娠而不是丢掉——否则一次推进 5 小时、回归期只剩 2 小时的话，
 * 另外 3 小时会凭空消失。
 */
function finishWombReturn(profile, overflowDays, name, notify) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const state = pregnant.wombReturn || {};
  state.remainingHours = 0;
  applyWombReturnWeight(profile);
  delete pregnant.wombReturn;

  // 孕早期第一天。不能从 0 起算——syncCharacterStageFromProfile 会把
  // 「孕早期但孕龄 0」判定成尚未着床，直接把阶段弹回排卵期，回归结果就此消失。
  // 也不套用正常受孕的产科偏移（约半个周期）：回归没有受精事件，
  // 凭空多出两周孕龄会让它变成「孕早期第 14 天」，与「回归结束即第一天」矛盾。
  const carried = Math.max(0, Number(overflowDays) || 0);
  const speed = clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1);
  const startDays = 1 + carried;
  pregnant.pregnantDays = startDays;
  pregnant.effectivePregnantDays = startDays * speed;
  for (const fetus of Array.isArray(pregnant.fetuses) ? pregnant.fetuses : []) fetus.amnionDurability = AMNION_INTACT;
  pregnant.fetusesCount = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.length : 0;
  base.stage = '孕早期';
  base.days = startDays;
  base.fertilizationDays = 0;
  profile.experience = {
    ...(profile.experience || {}),
    pregnantExperience: clampNumber(profile?.experience?.pregnantExperience, 0, 999, 0) + 1,
  };
  refreshOutfitPregFit(profile);
  updateFetalEnergyDrain(profile);
  if (notify) notify.firstly = `${name}的回归期结束，进入了孕早期`;
  return true;
}

/** 回归期的时间推进。回传是否已结算进孕早期 */
function advanceWombReturn(profile, deltaDays, name, notify) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const state = pregnant.wombReturn;
  if (!state) return finishWombReturn(profile, 0, name, notify);

  const remaining = clampNumber(state.remainingHours, 0, 99999, 0);
  const passedHours = Math.max(0, Number(deltaDays) || 0) * 24;
  if (passedHours < remaining) {
    state.remainingHours = remaining - passedHours;
    base.days = clampNumber(base.days, 0, 9999, 0) + deltaDays;
    applyWombReturnWeight(profile);
    refreshOutfitPregFit(profile);
    return false;
  }
  return finishWombReturn(profile, (passedHours - remaining) / 24, name, notify);
}

function applyWombReturn(chatState, args) {
  const female = String(args?.female || '').trim();
  const returnerName = String(args?.returner || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsWombReturn skipped: unknown character ${female || '(empty)'}.` };
  }
  if (!returnerName) {
    return { applied: false, message: `bsWombReturn skipped for ${female}: returner 不可为空。` };
  }
  // returner 不必是已注册角色。常态其实是 user 被吞、或吞一个路人——
  // 两者都不在 characters 里；硬性要求注册会把最常见的用法挡在门外。
  const returner = chatState.characters?.[returnerName] || null;
  // 钻进自己的子宫在物理上说不通，而且母父同一人会被标成自交
  if (returnerName === female) {
    return { applied: false, message: `bsWombReturn skipped for ${female}: 角色不能回归自己的子宫。` };
  }
  // 承载者自己是别人肚子里的胎儿：她的阶段永远不会推进，回归期会卡死在里面
  const hostFrozenIn = getWombReturnHost(character);
  if (hostFrozenIn) {
    return {
      applied: false,
      message: `bsWombReturn skipped for ${female}: 她本人正在 ${hostFrozenIn} 体内作为胎儿，不能同时作为承载者。`,
    };
  }
  // 一个人不能同时是两个人肚子里的胎儿（只有已注册角色才追踪得到这件事）
  const returnerFrozenIn = returner ? getWombReturnHost(returner) : '';
  if (returnerFrozenIn) {
    return {
      applied: false,
      message: `bsWombReturn skipped for ${female}: ${returnerName} 已经在 ${returnerFrozenIn} 体内，不能重复回归。`,
    };
  }
  const stage = String(character?.profile?.base?.stage || '');
  if (stage === WOMB_RETURN_STAGE) {
    return { applied: false, message: `bsWombReturn skipped for ${female}: 已经在回归期，不能重复回归。` };
  }
  if (!canAcceptWombReturn(stage)) {
    return {
      applied: false,
      message: `bsWombReturn skipped for ${female}: 当前阶段为 ${stage || '未知'}，只有月经阶段或无经期才能接受胎内回归。`,
    };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};

  // 子宫直接净空：残留精液不清的话，回归期结束进孕早期时会再受精一次，
  // 变成「回归胎 + 野生胎」的双胞胎
  base.sperms = [];
  base.eggs = 0;
  base.fertilizationDays = 0;
  base.penetrationState = 'idle';
  base.penetrationSource = null;
  pregnant.fetuses = [];
  pregnant.fetusesCount = 0;
  pregnant.fetalEnergyDrain = 0;

  const returnerProfile = returner?.profile || {};
  const returnerBase = returnerProfile.base || {};
  const motherRace = parseRaceDescriptor(base.race || '人类').race || '人类';
  // 种族来源依序：显式传入 > 已注册角色自己的种族 > 与承载者同族
  const explicitRace = String(args?.returnerRace || '').trim();
  const parsedReturner = explicitRace ? parseRaceDescriptor(explicitRace) : null;
  const fatherRace = parsedReturner?.race
    || parseRaceDescriptor(returnerBase.race || motherRace).race
    || motherRace;
  const fatherAncestry = getBloodlineInfo(fatherRace, parsedReturner?.bloodline ?? returnerBase.bloodline,
    parsedReturner?.bloodline ? 'explicit' : returnerBase.bloodlineSource);
  const ancestry = deriveFetusAncestry(base, { race: fatherRace, ...fatherAncestry });
  const fetusRace = ancestry.race;
  const fatherDerivedType = parsedReturner?.derivedType
    || (returnerBase.derivedType ? String(returnerBase.derivedType) : null);
  const derivedSeed = getDerivedInheritanceSeed(base.derivedType ? String(base.derivedType) : null, fatherDerivedType);

  pregnant.fetuses = [{
    embryoId: allocateEmbryoId(pregnant),
    fusionCheckedWith: [],
    tags: ['rebirth'],
    fathers: returnerName,
    provider: null,
    providerSources: [],
    ...ancestry,
    fatherRace,
    fatherBloodline: fatherAncestry.bloodline,
    fatherBloodlineSource: fatherAncestry.bloodlineSource,
    fatherDerivedType,
    gender: deriveFetusGender(fetusRace, ancestry.bloodline),
    embryoType: getEmbryoTypeByRace(fetusRace, ancestry.bloodline, getBloodlineInfo(base.race || '人类', base.bloodline, base.bloodlineSource).bloodline),
    // 回归者本身就是唯一的有效个体，没有伴生卵。
    companionEggCount: 0,
    // 刚进去时是一个成人的体积，之后随回归期线性回落到 1.0
    weight: WOMB_RETURN_PEAK_WEIGHT,
    tendencyAngle: randomInt(0, 360),
    backSide: randomBackSide(),
    affinity: derivedSeed.affinity,
    maternalDerivedTypeProgress: derivedSeed.progress,
    // 天赋跟着回归者走，技能不传：身体是新的，资质是旧的
    talents: normalizeTalentList(returnerProfile.talents),
  }];
  pregnant.fetusesCount = 1;
  setVisualCue(profile, 'rebirth');

  // 不能静默把垃圾值当成 0：那会让「传错参数」变成「瞬间完成回归」，
  // 与本档其他工具要求显式传值的做法一致
  const rawHours = args?.hours === undefined || args?.hours === null ? 0 : Number(args.hours);
  if (!Number.isFinite(rawHours) || rawHours < 0) {
    return { applied: false, message: `bsWombReturn skipped for ${female}: hours 必须是不小于 0 的数字。` };
  }
  const hours = clampNumber(rawHours, 0, 99999, 0);
  pregnant.wombReturn = { returner: returnerName, totalHours: hours, remainingHours: hours };
  base.stage = WOMB_RETURN_STAGE;
  base.days = 0;
  profile.base = base;
  profile.pregnant = pregnant;
  next.profile = profile;

  const notify = profile.notify || {};
  if (hours <= 0) {
    // 瞬间完成：当场结算进孕早期，否则阶段会停在「回归期、剩 0 小时」，
    // 要等下一次 bsPassedTime 才翻页
    finishWombReturn(profile, 0, female, notify);
  } else {
    applyWombReturnWeight(profile);
    refreshOutfitPregFit(profile);
    notify.firstly = `${returnerName}回到了${female}的子宫内`;
  }
  profile.notify = notify;
  chatState.characters[female] = next;

  // 只有已注册角色需要冻结；未注册的 returner 本来就不在系统里跑
  if (returner) {
    const frozen = cloneValue(returner);
    frozen.profile = frozen.profile || {};
    frozen.profile.base = { ...(frozen.profile.base || {}), isHere: false, wombReturnHost: female };
    chatState.characters[returnerName] = frozen;
  }

  return {
    applied: true,
    message: `bsWombReturn applied: ${returnerName} returned into ${female}`
      + `${hours > 0 ? ` for ${hours}h` : ' instantly'}`
      + `${returner ? `; ${returnerName} frozen.` : '; returner is unregistered, nothing frozen.'}`,
  };
}


function calculatePostpartumWearPressure(profile) {
  const days = clampNumber(profile?.base?.days, 0, 9999, 0);
  const recoveryDays = getStageLimit(profile, '产后恢复') || 56;
  const progress = Math.min(1, days / recoveryDays);
  return clampNumber(POSTPARTUM_START_WEAR_PRESSURE * (1 - progress), 0, 10, 0);
}

/**
 * 回归期的衣着压力：一个成人体积的东西刚进去，压力直接顶到上限，
 * 再随剩余时间线性回落。不能走 calculatePregWearPressure——那个是从
 * effectivePregnantDays 与 fetalEnergyDrain 推的，回归期两者都是 0，
 * 算出来只有 0.5，与「压力直接爆」完全相反。
 */
function calculateWombReturnWearPressure(profile) {
  const state = profile?.pregnant?.wombReturn;
  const total = clampNumber(state?.totalHours, 0, 99999, 0);
  if (total <= 0) return 0;
  const remaining = clampNumber(state?.remainingHours, 0, 99999, 0);
  return clampNumber(WOMB_RETURN_PEAK_PRESSURE * (remaining / total), 0, 10, 0);
}

function refreshOutfitPregFit(profile) {
  if (!profile?.wardrobe?.enabled) return null;
  const outfit = ensureOutfitState(profile);
  if (outfit.mainItemId === null) {
    outfit.pregFit = null;
    return outfit;
  }
  const stage = String(profile?.base?.stage || '');
  const inPostpartum = stage === '产后恢复';
  const inWombReturn = stage === WOMB_RETURN_STAGE;
  if (!inPostpartum && !inWombReturn && !isTruePregnancyStage(stage) && stage !== '产兆前驱' && !LABOR_STAGES.includes(stage)) {
    outfit.pregFit = null;
    return outfit;
  }
  const totals = getOutfitDimensionTotals(profile);
  const pregWearPressure = inWombReturn
    ? calculateWombReturnWearPressure(profile)
    : (inPostpartum ? calculatePostpartumWearPressure(profile) : calculatePregWearPressure(profile));
  outfit.pregFit = {
    pregWearPressure,
    gap: {
      masking: clampNumber(totals.masking - pregWearPressure, -20, 20, 0),
      support: clampNumber(totals.support - pregWearPressure, -20, 20, 0),
      capacity: clampNumber(totals.capacity - pregWearPressure, -20, 20, 0),
      convenience: clampNumber(totals.convenience - pregWearPressure, -20, 20, 0),
    },
  };
  return outfit;
}
/**
 * 单个排卵期自然排出的卵数：所有物种都是 1 颗。
 *
 * orgasmOvulationAmount 只在高潮时作用（见 maybeTriggerOrgasmOvulation，按活力占比排出），
 * 不再加进自然排卵：否则人类每周期固定 2 颗，受孕率与双胎率绑死，双胎压不下来；
 * 多产物种平时也只排 1 颗，要靠高潮才成窝。
 * 自然排卵也不随排卵期长短累加，「一年一次经期」这类长周期设定才成立。
 */
function getNaturalOvulationTotal() {
  return 1;
}

/** 自然排卵每个排卵期只发生一次，离开排卵期即重置 */
function shouldResetNaturalOvulation(stage) {
  return stage !== '排卵期';
}

function getImplantationDays(profile) {
  const cycleLength = getMenstrualCycleLength(profile);
  return calculateImplantationDays(cycleLength);
}

function getObstetricPregnancyOffsetDays(profile) {
  return Math.max(0, getMenstrualCycleLength(profile) / 2);
}

function randomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(randomNumber(min, max + 1));
}

function wrapAngle(angle) {
  let next = Number(angle) || 0;
  while (next < 0) next += 360;
  while (next >= 360) next -= 360;
  return next;
}

function angleDistance(from, to) {
  const direct = Math.abs(from - to);
  return Math.min(direct, 360 - direct);
}

function shuffleInPlace(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
}

function deriveFetusEmbryoType(race) {
  return getEmbryoTypeByRace(race);
}

function deriveFetusGender(race, bloodline = null) {
  const profile = getMergedRacePhysiologyProfile(race, bloodline);
  if (profile?.genderRatio === -1) return '无';
  if (profile?.genderRatio === null) return '双';
  const ratio = clampNumber(profile?.genderRatio, 0, 100, 50);
  return Math.random() < (ratio / 100) ? '男' : '女';
}

function getConceptionWeight(stage, gender, weightRatio = 1.0) {
  const stageWeights = {
    黄体期: 1.2,
    排卵期: 1.1,
    卵泡期: 1.0,
    产后恢复: 1 / 1.1,
    月经期: 1 / 1.2,
  };
  const baseWeight = stageWeights[String(stage || '')] || 1.0;
  const fluctuation = Math.exp(randomNumber(-0.083, 0.083));
  const sexMultiplier = gender === '男' ? 1.05 : gender === '女' ? 1 / 1.05 : 1.0;
  return Math.max(0.33, Math.min(3.0, Number(baseWeight * fluctuation * sexMultiplier * weightRatio)));
}

/**
 * 异期复孕：已在妊娠中再次受精，两胎孕龄不同步。
 *
 * 孕龄在这个引擎里是 pregnant.effectivePregnantDays 这一个共用数字（被引用 30 处，
 * 驱动阶段、产程、代谢、逾期）。不去动它，改成每胎存一个「受精当下的共用时钟读数」，
 * 该胎自己的年龄 = 共用时钟 − 该读数。阶段仍由共用时钟（＝最早那胎）驱动，
 * 这也是对的：母体的身体状态取决于最成熟的那一胎。
 *
 * 有效孕日对所有物种都是 0-280 的同一把尺（累加时乘妊娠速度，阶段门槛用固定值），
 * 所以下面这些天数不必再乘物种项。
 */
const SUPERFETATION_STAGE = '孕早期';
const SUPERFETATION_FULL_TERM_DAYS = DUE_DATE_DAYS;
/** 孕早期长度，也就是可以再受精的原始视窗。从阶段表推导，别再写死一次 */
const SUPERFETATION_RAW_WINDOW_DAYS = Number(PREGNANCY_STAGE_DAYS['孕早期']) || 84;
/**
 * 孕期受精的机率系数：人类同房后一天的单卵受精率约 23%，乘上 0.35 约为每天 8%，
 * 维持异期受孕「可能但罕见」的原意；不压低的话异期会变成常态。
 */
const SUPERFETATION_CHANCE_FACTOR = 0.35;
/**
 * 揭晓时机：孕中期一开始，也就是孕早期结束的那一刻。
 * 在此之前模型与追踪页都看不到这一胎。
 * 这同时也是待著床胚胎被清除的时点——到了孕中期，没著床的没了，
 * 著床了的当场揭晓，不会有「已经存在却还藏着」的中间地带。
 */
const SUPERFETATION_REVEAL_DAYS = SUPERFETATION_RAW_WINDOW_DAYS;

/**
 * 孕中孕：异期受精的那一颗落进另一颗胎儿体内，成为胎中胎。
 *
 * 走的是同一条高潮排卵的异期受精路径，额外三个条件同时成立才会变成孕中孕。
 * 三个都是硬筛子，不必再加机率系数：
 *  - 视窗 8-12 周（有效孕日 56-84），比异期本身更窄
 *  - 宿主胎儿的胎重 >= 1.5。典型胎重 0.95，孕期受精上限 1.83，
 *    要父系种族支配度接近满才碰得到
 *  - 子宫内精液总量 > 100。bsAddSperm 建议单次 10-30、每天衰减 10，
 *    要短时间内多次性交才堆得起来
 */
const NESTED_WINDOW_MIN_DAYS = 56;
const NESTED_HOST_MIN_WEIGHT = 1.5;
const NESTED_MIN_SPERM = 100;
/** 揭晓时机比一般异期胎晚得多：要到孕晚期才看得到 */
const NESTED_REVEAL_DAYS = SUPERFETATION_RAW_WINDOW_DAYS + (Number(PREGNANCY_STAGE_DAYS['孕中期']) || 105);

/**
 * 能当孕中孕宿主的胚型：胎生；胎转卵生（受精视窗在孕早期，壳还只是几片碎片、没合拢）；
 * 不定型（没有固定外壳，精液浸得进去）。卵生从一开始就在壳里、卵胎生一直在卵膜里，进不去。
 * 性别不设限
 */
const NESTED_HOST_EMBRYO_TYPES = new Set(['胎生', '胎转卵生', '不定型']);

export function canHostNestedPregnancy(fetus) {
  return NESTED_HOST_EMBRYO_TYPES.has(String(fetus?.embryoType || '胎生'));
}

/** 宿主是胎转卵生时，壳合拢后内胎跟着被封在里面：胎膜破不了，只能随宿主一起娩出 */
function isSealedNestedFetus(fetus, fetuses) {
  const host = getEnclosingHost(fetus, fetuses);
  return Boolean(host) && String(host.embryoType || '胎生') === '胎转卵生';
}

/**
 * 挑一颗够大的胎儿当宿主：取最重的，同重时优先女胎。
 * 只挑已著床的——待著床的胚胎自己都还没安顿好——而且胚型要进得去。
 */
function pickNestedHostFetus(profile) {
  const candidates = getImplantedFetuses(profile)
    .filter((fetus) => canHostNestedPregnancy(fetus))
    .filter((fetus) => clampNumber(fetus?.weight, 0.33, 3.0, 1.0) >= NESTED_HOST_MIN_WEIGHT);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, fetus) => {
    const bestWeight = clampNumber(best?.weight, 0.33, 3.0, 1.0);
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    if (weight > bestWeight) return fetus;
    if (weight < bestWeight) return best;
    // 同重时优先女胎
    if (fetus?.gender === '女' && best?.gender !== '女') return fetus;
    return best;
  });
}

/**
 * 受精视窗上限。不是整个孕早期——着床要花 getImplantationDays 个真实日，
 * 视窗末尾受精的胚胎会来不及着床就撞上孕中期的强制清除，形成一段
 * 「受精看似成功、实则注定作废」的死区。把视窗提前关闭，死区由构造上消失。
 * 妊娠速度极快的物种可能算出负值，那就是该物种不可能异期复孕。
 */
function getSuperfetationWindowDays(profile) {
  const speed = clampNumber(getGestationEffectiveSpeed(profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1);
  return Math.max(0, SUPERFETATION_RAW_WINDOW_DAYS - (getImplantationDays(profile) * speed));
}

/** 这一胎自己的有效孕龄。既有胎儿没有 conceivedAtDays，视为 0 */
function getFetusEffectiveAge(pregnant, fetus) {
  const shared = clampNumber(pregnant?.effectivePregnantDays, 0, 9999, 0);
  const conceivedAt = clampNumber(fetus?.conceivedAtDays, 0, 9999, 0);
  return Math.max(0, shared - conceivedAt);
}

/**
 * 已着床的胎儿。没有 pendingImplantation 旗标＝已着床，
 * 所以存量存档不必迁移。随机挑胎、胎教、母胎互动都只能挑这些。
 */
/**
 * 这一胎是否已经被角色本人知道。异期胎在揭晓（妊娠期一半）之前，
 * 提示词投影与追踪页都看不到它——它在状态里照常存在、照常发育、照常吃供养力，
 * 所以模型会看到「负担莫名偏高」，那是伏笔而不是穿帮。完整变量页仍然看得到。
 */
export function isFetusKnownToCharacter(fetus) {
  if (!fetus || typeof fetus !== 'object') return false;
  if (fetus.pendingImplantation) return false;
  if (!fetus.conceivedAtDays) return true;
  return Boolean(fetus.revealed);
}

function isImplantedFetus(fetus) {
  return Boolean(fetus) && !fetus.pendingImplantation;
}

function getImplantedFetuses(profile) {
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  return fetuses.filter(isImplantedFetus);
}

/**
 * 从已着床的胎儿里随机挑一个，回传它在原阵列里的索引；没有可挑的回 -1。
 * 不能改成先过滤再挑——胎教与母胎互动最后都会 pregnant.fetuses = fetuses
 * 整批写回，过滤过的阵列会把待著床的胚胎直接删掉。
 */
function pickImplantedFetusIndex(fetuses) {
  const eligible = [];
  for (let index = 0; index < fetuses.length; index += 1) {
    if (isImplantedFetus(fetuses[index])) eligible.push(index);
  }
  if (eligible.length === 0) return -1;
  return eligible[randomInt(0, eligible.length - 1)];
}

function getConceptionWeightRatio(profile, sperm) {
  const motherBreedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0);
  const fatherProfile = getMergedRacePhysiologyProfile(sperm?.race, sperm?.bloodline);
  const fatherBreedTolerance = clampNumber(fatherProfile?.breedTolerance, 0.1, 100, 1.0);
  const dominance = (fatherBreedTolerance - motherBreedTolerance) / Math.max(motherBreedTolerance + fatherBreedTolerance, 0.1);
  return clampNumber(1 + (dominance * 0.65), 0.625, 1.6, 1.0);
}

function updateDerivedTypeProgress(profile, tick) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const motherDerivedType = base.derivedType ? String(base.derivedType) : null;
  const passedDays = Math.max(0, tick.passedDays);
  const gestationModifierMultiplier = getGestationModifierMultiplier(profile);
  if (fetuses.length === 0 || passedDays <= 0) return;

  for (const fetus of fetuses) {
    const fatherDerivedType = fetus?.fatherDerivedType ? String(fetus.fatherDerivedType) : null;
    if (!motherDerivedType && !fatherDerivedType) continue;
    const currentProgress = clampNumber(fetus?.maternalDerivedTypeProgress, -100, 100, 0);
    fetus.maternalDerivedTypeProgress = calculateDerivedInheritanceProgress({
      currentProgress,
      affinity: fetus?.affinity,
      motherDerivedType,
      fatherDerivedType,
      fetusRace: fetus?.race,
      fetusBloodline: fetus?.bloodline,
      passedDays,
      gestationModifierMultiplier,
    });
  }

  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
}

/** 这一胎的伴生卵数；0 表示没有 */
function getCompanionEggCount(fetus) {
  return Math.max(0, Math.floor(Number(fetus?.companionEggCount) || 0));
}

/**
 * 同卵分裂不是新的独立受精，不重新抽伴生卵：把原卡的数量以整数平分给整组，
 * 余数给排在前面的，总和保持不变。
 */
function shareCompanionEggs(group) {
  const total = group.reduce((sum, fetus) => sum + getCompanionEggCount(fetus), 0);
  const each = Math.floor(total / group.length);
  group.forEach((fetus, index) => { fetus.companionEggCount = each + (index < total % group.length ? 1 : 0); });
}

// ---- 胎背方位 ----
// 胎背朝向母体的哪一侧：左右一轴、前后一轴，组成产科的四种枕位（左前 LOA、右前 ROA、左后 LOP、右后 ROP）。
// 与 tendencyAngle（剖面上的旋转）互相独立：同一个头位可以胎背朝左前，也可以朝右后。
export const BACK_SIDES = Object.freeze(['左前', '右前', '左后', '右后']);

function randomBackSide() {
  return BACK_SIDES[randomInt(0, BACK_SIDES.length - 1)];
}

function normalizeBackSide(value) {
  return BACK_SIDES.includes(value) ? value : null;
}

/** 镜像：左右对调、前后不变（同卵分裂出的那一胎） */
function mirrorBackSide(side) {
  const value = normalizeBackSide(side) || randomBackSide();
  return `${value[0] === '左' ? '右' : '左'}${value[1]}`;
}

/** 卵生、胎转卵生出生时是蛋：没有头、胎背、下巴与肩，胎背方位、枕后位与双胎互锁都不适用 */
const SHELLED_AT_BIRTH_EMBRYO_TYPES = new Set(['卵生', '胎转卵生']);
export function isShelledAtBirth(fetus) {
  return SHELLED_AT_BIRTH_EMBRYO_TYPES.has(String(fetus?.embryoType || '胎生'));
}

export function isPosteriorBack(fetus) {
  return !isShelledAtBirth(fetus) && String(fetus?.backSide || '').endsWith('后');
}

/** 缺胎背方位的胎儿（注册、手动编辑写入的）补一个随机值；只补同一格式内的缺值 */
function ensureBackSideMetadata(pregnant) {
  for (const fetus of Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : []) {
    if (!normalizeBackSide(fetus?.backSide)) fetus.backSide = randomBackSide();
  }
}

/**
 * 胎背方位的描写。纵产式（头位、臀位、斜位）直接说左前、右后；
 * 横位时胎儿横躺，左右那一轴变成朝上或朝下，前后照旧
 */
export function describeBackSide(fetus) {
  if (isShelledAtBirth(fetus)) return '';
  const side = normalizeBackSide(fetus?.backSide);
  if (!side) return '';
  const angle = ((Number(fetus?.tendencyAngle) || 0) % 360 + 360) % 360;
  const transverse = (angle >= 75 && angle <= 105) || (angle >= 255 && angle <= 285);
  if (!transverse) return `胎背朝${side}`;
  return `胎背朝${side[0] === '左' ? '上' : '下'}、偏${side[1]}`;
}

function cloneIdenticalFetus(fetus) {
  return {
    ...fetus,
    embryoId: null,
    nutrition: 0,
    companionEggCount: 0,
    fusionCheckedWith: [],
    providerSources: Array.isArray(fetus?.providerSources) ? [...fetus.providerSources] : undefined,
    chimera: fetus?.chimera ? cloneValue(fetus.chimera) : undefined,
    tendencyAngle: randomInt(0, 360),
    // 镜像双胞胎：左右相反、前后相同
    backSide: mirrorBackSide(fetus?.backSide),
    affinity: 0,
  };
}

function uniqueNonEmptyStrings(values) {
  const result = [];
  for (const value of values || []) {
    const text = String(value ?? '').trim();
    if (text && !result.includes(text)) result.push(text);
  }
  return result;
}

function getMaxEmbryoId(fetuses) {
  return fetuses.reduce((max, fetus) => {
    const value = Number(fetus?.embryoId);
    return Number.isInteger(value) && value > max ? value : max;
  }, 0);
}

/**
 * 发一个新的 embryoId。计数器挂在母体的 pregnant 上、跨胎次不归零，号码永不重用：
 * 先露胎、孕中孕宿主与出生编号都靠它跨时间指认同一胎，
 * 若按「现有最大值 + 1」现算，移除一胎后下一个新胎就会接手它的号码。
 * 所有引用都只在同一母体内部，所以不需要整个聊天共用一个计数器。
 */
/** 计数器至少要越过现存的每个号码，手动、注册或调试写入的编号才不会被重发 */
function syncEmbryoCounter(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const stored = Number(pregnant?.nextEmbryoId);
  pregnant.nextEmbryoId = Math.max(Number.isInteger(stored) && stored > 0 ? stored : 1, getMaxEmbryoId(fetuses) + 1);
  return pregnant.nextEmbryoId;
}

function allocateEmbryoId(pregnant) {
  const id = syncEmbryoCounter(pregnant);
  pregnant.nextEmbryoId = id + 1;
  return id;
}

function ensureEmbryoMetadata(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const used = new Set();
  for (const fetus of fetuses) {
    let id = Number(fetus?.embryoId);
    if (!Number.isInteger(id) || id <= 0 || used.has(id)) id = allocateEmbryoId(pregnant);
    fetus.embryoId = id;
    used.add(id);
  }
  syncEmbryoCounter(pregnant);
  for (const fetus of fetuses) {
    fetus.fusionCheckedWith = [...new Set(
      (Array.isArray(fetus?.fusionCheckedWith) ? fetus.fusionCheckedWith : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0 && id !== fetus.embryoId),
    )];
  }
  return fetuses;
}

/**
 * 胎儿被融合取代后，把指向旧号码的引用改指新号码，同一笔交易内完成，
 * 不留短暂悬空的引用。目前只有孕中孕宿主会跨胎指认。
 */
function remapEmbryoReferences(pregnant, remap) {
  if (!remap || remap.size === 0) return;
  for (const fetus of Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : []) {
    if (remap.has(fetus?.nestedInEmbryoId)) fetus.nestedInEmbryoId = remap.get(fetus.nestedInEmbryoId);
  }
}

function getFetusFatherSources(fetus) {
  return uniqueNonEmptyStrings(
    Array.isArray(fetus?.chimera?.fatherSources)
      ? fetus.chimera.fatherSources
      : String(fetus?.fathers || '').split(/\s*[×Xx]\s*/),
  );
}

function getFetusMaternalSources(fetus, carrierName) {
  if (Array.isArray(fetus?.providerSources) && fetus.providerSources.length > 0) {
    return uniqueNonEmptyStrings(fetus.providerSources);
  }
  const provider = String(fetus?.provider || '').trim();
  return uniqueNonEmptyStrings([provider || carrierName]);
}

function combineRaceDescriptors(...values) {
  return uniqueNonEmptyStrings(values.flatMap((value) => getRaceDescriptorComponents(value))).join('x') || '人类';
}

export function calculateChimeraFusionProbability(fetusA, fetusB) {
  const derivedA = String(fetusA?.fatherDerivedType || '').trim();
  const derivedB = String(fetusB?.fatherDerivedType || '').trim();
  let derivedMultiplier = 1;
  if (derivedA && derivedB) {
    if (derivedA !== derivedB) return 0;
    derivedMultiplier = 1.5;
  } else if (derivedA || derivedB) {
    derivedMultiplier = 0.5;
  }

  const raceA = String(fetusA?.race || '人类');
  const raceB = String(fetusB?.race || '人类');
  const physiologyA = getMergedRacePhysiologyProfile(raceA, fetusA?.bloodline);
  const physiologyB = getMergedRacePhysiologyProfile(raceB, fetusB?.bloodline);
  const identicalA = clampNumber(physiologyA?.identicalProbability, 0, 100, 5);
  const identicalB = clampNumber(physiologyB?.identicalProbability, 0, 100, 5);
  const difficultyA = clampNumber(physiologyA?.impregnationDifficulty, 0.1, 100, 1);
  const difficultyB = clampNumber(physiologyB?.impregnationDifficulty, 0.1, 100, 1);
  const identicalFactor = Math.sqrt(identicalA * identicalB);
  const difficultyFactor = 2 / (1 + Math.sqrt(difficultyA * difficultyB));
  const typeMultiplier = String(fetusA?.embryoType || deriveFetusEmbryoType(raceA))
    === String(fetusB?.embryoType || deriveFetusEmbryoType(raceB)) ? 1 : 0.25;
  return clampNumber(identicalFactor * difficultyFactor * typeMultiplier * derivedMultiplier, 0, 75, 0);
}

function createChimeraFetus(profile, carrierName, fetusA, fetusB, embryoId) {
  const fathers = uniqueNonEmptyStrings([...getFetusFatherSources(fetusA), ...getFetusFatherSources(fetusB)]);
  const maternalSources = uniqueNonEmptyStrings([
    ...getFetusMaternalSources(fetusA, carrierName),
    ...getFetusMaternalSources(fetusB, carrierName),
  ]);
  const genderSources = [String(fetusA?.gender || '未知'), String(fetusB?.gender || '未知')];
  const hasMale = genderSources.includes('男');
  const hasFemale = genderSources.includes('女');
  const gender = hasMale && hasFemale
    ? '待定'
    : (genderSources[0] === genderSources[1] ? genderSources[0] : (genderSources.includes('双') ? '双' : genderSources[0]));
  const fatherDerivedType = fetusA?.fatherDerivedType || fetusB?.fatherDerivedType || null;
  const race = combineRaceDescriptors(fetusA?.race, fetusB?.race);
  const embryoType = deriveFetusEmbryoType(race);
  const motherDerivedType = profile?.base?.derivedType ? String(profile.base.derivedType) : null;
  const derivedSeed = getDerivedInheritanceSeed(motherDerivedType, fatherDerivedType);
  const providerSources = maternalSources.length > 1
    ? maternalSources
    : maternalSources.filter((source) => source !== carrierName);
  const fatherAncestry = mergeFetusAncestry([fetusA, fetusB].map((fetus) => ({
    race: fetus.fatherRace || '未知', bloodline: fetus.fatherBloodline,
    bloodlineSource: fetus.fatherBloodlineSource, chimera: fetus.chimera,
  })));
  return {
    embryoId,
    contactIds: [...new Set([...(fetusA.contactIds || []), ...(fetusB.contactIds || [])])],
    // Keep constituent embryos so a successful preimplantation attempt removes only its source.
    contactEmbryos: [cloneValue(fetusA), cloneValue(fetusB)],
    fusionCheckedWith: [],
    // 嵌合本身由 chimera 栏位推导，这里只承接两边已落盘的标签
    tags: sanitizeFetusTagList([...(fetusA?.tags || []), ...(fetusB?.tags || [])]),
    fathers: fathers.join(' × ') || '未知',
    provider: providerSources.length === 0 ? null : providerSources.join(' × '),
    providerSources,
    race,
    ...mergeFetusAncestry([fetusA, fetusB]),
    fatherRace: combineRaceDescriptors(fetusA?.fatherRace, fetusB?.fatherRace),
    fatherBloodline: fatherAncestry.bloodline,
    fatherBloodlineSource: fatherAncestry.bloodlineSource,
    fatherDerivedType,
    gender,
    embryoType,
    // 嵌合不是新的独立受精：不重新抽签，承接两边伴生卵的总和
    companionEggCount: getCompanionEggCount(fetusA) + getCompanionEggCount(fetusB),
    weight: (clampNumber(fetusA?.weight, 0.33, 3, 1) + clampNumber(fetusB?.weight, 0.33, 3, 1)) / 2,
    nutrition: (Number(fetusA?.nutrition) || 0) + (Number(fetusB?.nutrition) || 0),
    tendencyAngle: randomInt(0, 360),
    backSide: normalizeBackSide(fetusA?.backSide) || randomBackSide(),
    affinity: derivedSeed.affinity,
    maternalDerivedTypeProgress: derivedSeed.progress,
    chimera: {
      sourceCount: (Number(fetusA?.chimera?.sourceCount) || 1) + (Number(fetusB?.chimera?.sourceCount) || 1),
      fatherSources: fathers,
      maternalSources,
      genderSources,
    },
  };
}

function applyChimeraFusion(profile, carrierName) {
  const pregnant = profile.pregnant || {};
  const fetuses = ensureEmbryoMetadata(pregnant);
  if (clampNumber(profile?.base?.fertilizationDays, 0, 9999, 0) <= 1 || fetuses.length < 2) return;

  // 待著床的异期胚胎不与已著床的胎儿配对：三个月大的胎儿与新受精卵融合说不通
  const candidates = fetuses.filter((fetus) => !fetus?.chimera && !fetus?.pendingImplantation);
  const pairs = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const fetusA = candidates[left];
      const fetusB = candidates[right];
      if (!fetusA.fusionCheckedWith.includes(fetusB.embryoId)
        && !fetusB.fusionCheckedWith.includes(fetusA.embryoId)) {
        pairs.push([fetusA, fetusB]);
      }
    }
  }
  shuffleInPlace(pairs);
  const consumed = new Set();
  const fused = [];
  const remap = new Map();
  for (const [fetusA, fetusB] of pairs) {
    fetusA.fusionCheckedWith.push(fetusB.embryoId);
    fetusB.fusionCheckedWith.push(fetusA.embryoId);
    if (consumed.has(fetusA.embryoId) || consumed.has(fetusB.embryoId)) continue;
    const probability = calculateChimeraFusionProbability(fetusA, fetusB);
    if (probability > 0 && Math.random() < probability / 100) {
      consumed.add(fetusA.embryoId);
      consumed.add(fetusB.embryoId);
      const chimera = createChimeraFetus(profile, carrierName, fetusA, fetusB, allocateEmbryoId(pregnant));
      remap.set(fetusA.embryoId, chimera.embryoId);
      remap.set(fetusB.embryoId, chimera.embryoId);
      fused.push(chimera);
    }
  }
  if (fused.length > 0) {
    pregnant.fetuses = [...fetuses.filter((fetus) => !consumed.has(fetus.embryoId)), ...fused];
    remapEmbryoReferences(pregnant, remap);
    setVisualCue(profile, 'chimera');
  }
  pregnant.fetusesCount = pregnant.fetuses.length;
}

/** 调试工具的确定性嵌合：把指定批次的前两颗胚胎融合为一颗。 */
function forceChimeraFusion(profile, carrierName, batch) {
  const pregnant = profile.pregnant || {};
  const fetuses = ensureEmbryoMetadata(pregnant);
  const sources = Array.isArray(batch) ? batch.filter((fetus) => fetuses.includes(fetus)) : [];
  if (sources.length < 2) return null;
  const [fetusA, fetusB] = sources;
  const chimera = createChimeraFetus(profile, carrierName, fetusA, fetusB, allocateEmbryoId(pregnant));
  const consumed = new Set([fetusA, fetusB]);
  pregnant.fetuses = [...fetuses.filter((fetus) => !consumed.has(fetus)), chimera];
  remapEmbryoReferences(pregnant, new Map([[fetusA.embryoId, chimera.embryoId], [fetusB.embryoId, chimera.embryoId]]));
  pregnant.fetusesCount = pregnant.fetuses.length;
  return [...sources.filter((fetus) => !consumed.has(fetus)), chimera];
}

function resolvePendingChimeraGenders(fetuses) {
  const resolvedIdenticalGroups = new Map();
  for (const fetus of fetuses) {
    if (fetus?.gender !== '待定') continue;
    const identicalGroup = Number(fetus?.identicalGroup);
    if (Number.isInteger(identicalGroup) && identicalGroup > 0 && resolvedIdenticalGroups.has(identicalGroup)) {
      fetus.gender = resolvedIdenticalGroups.get(identicalGroup);
      continue;
    }
    const roll = Math.random();
    fetus.gender = roll < 0.4 ? '男' : roll < 0.8 ? '女' : '双';
    if (Number.isInteger(identicalGroup) && identicalGroup > 0) {
      resolvedIdenticalGroups.set(identicalGroup, fetus.gender);
    }
  }
}

/**
 * @param batch 只对这一批胚胎掷分裂骰；省略＝全部。
 *   异期复孕时新胚胎著床会再跑一次这个函式，不限定批次的话，
 *   已经三个月大的先来那胎会被重新掷一次分裂骰，可能凭空变成双胞胎。
 */
function applyIdenticalSplit(profile, batch = null) {
  const pregnant = profile.pregnant || {};
  const fetuses = ensureEmbryoMetadata(pregnant);
  if (fetuses.length === 0) return;
  const targets = batch ? new Set(batch) : null;

  const result = [];
  for (const baseFetus of fetuses) {
    if (targets && !targets.has(baseFetus)) {
      result.push(baseFetus);
      continue;
    }
    result.push(baseFetus);
    // 调试工具可能已明确把这颗胚胎分进同卵组；著床时不可再次掷骰分裂。
    if (Number.isInteger(Number(baseFetus?.identicalGroup)) && Number(baseFetus.identicalGroup) > 0) continue;
    const physiology = getMergedRacePhysiologyProfile(baseFetus?.race, baseFetus?.bloodline);
    const splitRate = clampNumber(
      physiology?.identicalProbability,
      0,
      100,
      clampNumber(profile?.bio?.identicalProbability, 0, 100, 5),
    ) / 100;
    let targetCount = 1;
    if (splitRate > 0 && Math.random() < splitRate) {
      targetCount = 2;
      if (Math.random() < splitRate * splitRate) {
        targetCount = 3;
        if (Math.random() < splitRate * splitRate * splitRate) targetCount = 4;
      }
    }
    // 分裂发生时才标记：复制体在栏位上与原胚一模一样，事后无从分辨谁跟谁同卵，
    // 只能在这一刻把整组打上 identical 与共用的 identicalGroup
    if (targetCount > 1) {
      baseFetus.identicalGroup = baseFetus.embryoId;
      baseFetus.tags = sanitizeFetusTagList([...(baseFetus.tags || []), 'identical']);
    }
    const group = [baseFetus];
    while (targetCount > 1) {
      const clone = cloneIdenticalFetus(baseFetus);
      clone.embryoId = allocateEmbryoId(pregnant);
      clone.identicalGroup = baseFetus.identicalGroup;
      result.push(clone);
      group.push(clone);
      targetCount -= 1;
    }
    if (group.length > 1) shareCompanionEggs(group);
  }
  pregnant.fetuses = result;
  pregnant.fetusesCount = result.length;
}

/** 调试工具的确定性同卵分裂：每颗指定胚胎固定分成一组双胎。 */
function forceIdenticalTwinSplit(profile, batch = null) {
  const pregnant = profile.pregnant || {};
  const fetuses = ensureEmbryoMetadata(pregnant);
  if (fetuses.length === 0) return;
  const targets = batch ? new Set(batch) : new Set(fetuses);
  const result = [];
  for (const fetus of fetuses) {
    result.push(fetus);
    if (!targets.has(fetus)) continue;
    fetus.identicalGroup = fetus.embryoId;
    fetus.tags = sanitizeFetusTagList([...(fetus.tags || []), 'identical']);
    const twin = cloneIdenticalFetus(fetus);
    twin.embryoId = allocateEmbryoId(pregnant);
    twin.identicalGroup = fetus.identicalGroup;
    shareCompanionEggs([fetus, twin]);
    result.push(twin);
  }
  pregnant.fetuses = result;
  pregnant.fetusesCount = result.length;
}

/**
 * @param profile 承载妊娠的角色（决定孕育环境：体重倍率、亲和度种子）
 * @param options.geneticProfile 提供卵子的一方；代孕／注卵时与承载者不同。
 *        胎儿种族按她推导；母系衍生类型始终来自实际孕育胚胎的承载者。
 */
function createSimpleFetus(profile, sperm, cycleStage, options = {}) {
  const geneticProfile = options.geneticProfile || profile;
  const motherRace = parseRaceDescriptor(geneticProfile?.base?.race || '人类').race || '人类';
  const fatherRace = parseRaceDescriptor(sperm?.race || motherRace || '人类').race || motherRace || '人类';
  const ancestry = deriveFetusAncestry({ ...geneticProfile.base, race: motherRace }, { ...sperm, race: fatherRace });
  const motherBloodline = getBloodlineInfo(motherRace, geneticProfile?.base?.bloodline, geneticProfile?.base?.bloodlineSource).bloodline;
  const fetusRace = ancestry.race;
  const inheritanceTag = getFetusInheritanceTag(motherRace, fatherRace);
  const gender = deriveFetusGender(fetusRace, ancestry.bloodline);
  const weightRatio = getConceptionWeightRatio(profile, sperm);
  const motherDerivedType = profile?.base?.derivedType ? String(profile.base.derivedType) : null;
  const fatherDerivedType = sperm?.derivedType ? String(sperm.derivedType) : null;
  const derivedSeed = getDerivedInheritanceSeed(motherDerivedType, fatherDerivedType);
  return {
    embryoId: null,
    fusionCheckedWith: [],
    // 嵌合／代孕／自交都能从既有栏位推导，不写进来；这里只留给推导不出来的标签
    tags: inheritanceTag ? [inheritanceTag] : [],
    fathers: String(sperm?.male || '未知'),
    // 自然受精恒为 null；代孕／注卵由植入工具指定归属
    provider: options.provider ? String(options.provider) : null,
    providerSources: options.provider ? [String(options.provider)] : [],
    ...ancestry,
    fatherRace,
    fatherBloodline: getBloodlineInfo(fatherRace, sperm?.bloodline, sperm?.bloodlineSource).bloodline,
    fatherBloodlineSource: getBloodlineInfo(fatherRace, sperm?.bloodline, sperm?.bloodlineSource).bloodlineSource,
    fatherDerivedType,
    gender,
    embryoType: getEmbryoTypeByRace(fetusRace, ancestry.bloodline, motherBloodline),
    // 一次受孕只抽一次；之后随胎儿卡保存，不随渲染或日期推进重抽。
    companionEggCount: rollCompanionEggCount(fetusRace, Math.random, sperm?.value, ancestry.bloodline, motherBloodline),
    weight: getConceptionWeight(cycleStage, gender, weightRatio),
    tendencyAngle: randomInt(0, 360),
    backSide: randomBackSide(),
    affinity: derivedSeed.affinity,
    maternalDerivedTypeProgress: derivedSeed.progress,
  };
}

/** 单胎对母体的负担；fetalEnergyDrain 是全部胎儿的合计 */
function getFetusEnergyDrain(profile, fetus) {
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const motherBreedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0);
  const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
  // 每胎用自己的孕龄：异期复孕时晚到那胎不该按先来者的进度计算负担。
  // 既有胎儿没有 conceivedAtDays，算出来就是共用时钟，行为不变。
  const ownAge = Math.max(0, effectivePregnantDays - clampNumber(fetus?.conceivedAtDays, 0, 9999, 0));
  const fetalLoad = (ownAge * weight) / 7 / 40;
  return fetalLoad / motherBreedTolerance;
}

function updateFetalEnergyDrain(profile) {
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  profile.pregnant.fetalEnergyDrain = fetuses.reduce((sum, fetus) => sum + getFetusEnergyDrain(profile, fetus), 0);
}

function snapshotOriginalPregnancyBio(character) {
  const runtime = character.runtime || {};
  if (runtime.originalPregnancyBio) return runtime.originalPregnancyBio;
  const bio = character?.profile?.bio || {};
  const snapshot = {
    gestationSpeciesSpeed: clampNumber(getGestationSpeciesSpeed(character?.profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0),
    birthDifficulty: clampNumber(bio.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(bio.breedTolerance, 0.1, 100, 1.0),
  };
  runtime.originalPregnancyBio = snapshot;
  character.runtime = runtime;
  return snapshot;
}

function applyPregnancyPhysiology(profile, runtime) {
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return false;

  const originalBio = runtime?.originalPregnancyBio || {
    gestationSpeciesSpeed: clampNumber(getGestationSpeciesSpeed(profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0),
    birthDifficulty: clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0),
  };

  // 孕期取最长（最慢）那一胎：母体要怀到最慢的那胎长好，快的那胎只是多待。
  // 胎儿大小按孕程进度计，不按实际天数，所以多待不会撑出异常巨大的胎儿。
  let slowestGestation = GESTATION_SPEED_MAX;
  let birthAccumulator = 0;

  for (const fetus of fetuses) {
    const raceProfile = getMergedRacePhysiologyProfile(fetus?.race, fetus?.bloodline) || {};
    const gestationSpeed = clampNumber(raceProfile.gestationSpeciesSpeed, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0);
    slowestGestation = Math.min(slowestGestation, gestationSpeed);
    birthAccumulator += clampNumber(raceProfile.birthDifficulty, 0.1, 100, 1.0);
  }

  const averageBirth = birthAccumulator / fetuses.length;
  const fetusCountModifier = getFetusCountBirthModifier(fetuses.length);
  const toleranceCountModifier = Math.max(0.6, 1 - ((fetuses.length - 1) * 0.04));
  const gestationModifierMultiplier = getGestationModifierMultiplier(profile);

  const gestationEffectiveSpeed = clampNumber(slowestGestation * gestationModifierMultiplier, 0, GESTATION_SPEED_MAX, slowestGestation);
  const birthDifficulty = clampNumber(averageBirth * fetusCountModifier, 0.1, 100, originalBio.birthDifficulty);
  // 承载耐受只取母体自身 x 胎数修正：breedTolerance 描述「这具身体多能扛妊娠」，
  // 是承载者的属性。此前还乘上胎儿族的 breedTolerance，等于把胎儿族的承载力
  // 当成母体的加成——人类怀龙胎会变成十倍耐受，比怀人类胎还轻松，方向是反的。
  // 跨种族的额外负担已由 getConceptionWeightRatio 换算成胎重，不该在这里再算一遍。
  const breedTolerance = clampNumber(originalBio.breedTolerance * toleranceCountModifier, 0.1, 100, originalBio.breedTolerance);
  // 产后恢复天数不在孕期推算：分娩／流产当下才由 settlePostpartumRecoveryDays 定下

  profile.bio = {
    ...(profile.bio || {}),
    gestationSpeciesSpeed: clampNumber(slowestGestation, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0),
    gestationEffectiveSpeed,
    birthDifficulty,
    breedTolerance,
  };
  return true;
}

/** 多胎让产程更吃力：每多一胎分娩难度 +8% */
function getFetusCountBirthModifier(fetusCount) {
  return 1 + ((Math.max(1, fetusCount) - 1) * 0.08);
}

/**
 * 第二产程逐胎娩出，用正在娩出那一胎自己的分娩难度（仍乘胎数修正）；
 * 第一、三产程与间歇期沿用全体平均（bio.birthDifficulty）。同族多胎两者相同。
 */
function getPresentingBirthDifficulty(profile) {
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  const fetus = getPresentingFetus(profile?.pregnant);
  if (!fetus) return clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  const raceDifficulty = clampNumber(getMergedRacePhysiologyProfile(fetus.race, fetus.bloodline)?.birthDifficulty, 0.1, 100, 1);
  return clampNumber(raceDifficulty * getFetusCountBirthModifier(fetuses.length), 0.1, 100, 1);
}

function restorePregnancyPhysiology(profile, runtime) {
  const originalBio = runtime?.originalPregnancyBio;
  if (!originalBio) return false;
  const gestationModifierMultiplier = getGestationModifierMultiplier(profile);
  profile.bio = {
    ...(profile.bio || {}),
    gestationSpeciesSpeed: clampNumber(originalBio.gestationSpeciesSpeed, GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1.0),
    gestationEffectiveSpeed: clampNumber(originalBio.gestationSpeciesSpeed * gestationModifierMultiplier, 0, GESTATION_SPEED_MAX, 1.0),
    birthDifficulty: clampNumber(originalBio.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(originalBio.breedTolerance, 0.1, 100, 1.0),
  };
  delete runtime.originalPregnancyBio;
  return true;
}

/**
 * 在清空妊娠之前调用：按母体物种的恢复系数、活力等级、之前的分娩次数与这次娩出的胎数，
 * 定下这次产后恢复的天数。流产另乘孕程比例（有效孕日／280，最少 1/4）。
 * 这次娩出的胎数＝产程中已逐胎娩出的 deliveredCount ＋ 还留在子宫里的胎儿。
 */
function settlePostpartumRecoveryDays(profile, { miscarriage = false } = {}) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const experience = profile.experience || {};
  const remaining = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.length : 0;
  const delivered = clampNumber(pregnant.deliveredCount, 0, 99, 0);
  const recoveryDays = computePostpartumRecoveryDays({
    recoveryCoefficient: getRecoveryCoefficientByRace(base.race, base.bloodline),
    vitalityLevel: base.vitalityLevel,
    priorBirths: clampNumber(experience.naturalBirthExperience, 0, 999, 0) + clampNumber(experience.surgicalBirthExperience, 0, 999, 0),
    fetusCount: Math.max(1, delivered + remaining),
    progressRatio: miscarriage ? clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) / 280 : 1,
    atonyLevel: getUterineAtony(profile),
  });
  return recoveryDays;
}

function assignPostpartumRecoveryDays(profile, recoveryDays) {
  profile.bio = { ...(profile.bio || {}), recoveryDays };
}

function isObliquePosition(angle, fetus) {
  if (fetus && (fetus.embryoType === '胎转卵生' || fetus.embryoType === '不定型')) return false;
  const normalized = wrapAngle(angle);
  if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return false;
  if (normalized >= 165 && normalized <= 195) return false;
  if (getTransverseDistance(normalized) <= 15) return false;
  return true;
}

function calculateNearestMainPosition(angle) {
  const normalized = wrapAngle(angle);
  const positions = [0, 90, 180, 270];
  let nearest = positions[0];
  let minDiff = angleDistance(normalized, positions[0]);
  for (const position of positions) {
    const diff = angleDistance(normalized, position);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = position;
    }
  }
  return nearest;
}

/** 离最近的横位（90° 或 270°）几度；两侧对称，以前 270° 那侧写成 265–285，与 90° 侧不一致 */
function getTransverseDistance(angle) {
  const normalized = wrapAngle(angle);
  return Math.min(angleDistance(normalized, 90), angleDistance(normalized, 270));
}

function isTransversePosition(angle) {
  return getTransverseDistance(angle) <= 15;
}


export function calculatePositionDifficulty(angle, fetus) {
  const normalized = wrapAngle(angle);
  const embryoType = String(fetus?.embryoType || '胎生');

  // 胎转卵生的蛋在体内还在合拢：与卵生一样头尾对称（头位、臀位 1.0、横位 1.5），
  // 但必须对得很准，偏离最近的正位超过 5° 就每度加 0.075，最高 2.25。
  // 卵生则只要不是横放就固定 1.33，两者刻意不同，不要并入卵生那一段
  if (embryoType === '胎转卵生') {
    const headTail = Math.min(angleDistance(normalized, 0), angleDistance(normalized, 180));
    const side = Math.min(angleDistance(normalized, 90), angleDistance(normalized, 270));
    const [baseDifficulty, deviation] = headTail <= side ? [1.0, headTail] : [1.5, side];
    if (deviation <= 5) return baseDifficulty;
    return Math.min(2.25, baseDifficulty + ((deviation - 5) * 0.075));
  }

  if (embryoType === '不定型') {
    const race = String(fetus?.race || '人类');
    const combinedSeed = Math.round(normalized * 1000) + race.charCodeAt(0) + race.charCodeAt(Math.max(0, race.length - 1));
    const seededValue = ((combinedSeed * 1664525 + 1013904223) % 2147483648) / 2147483648;
    return 1.0 + seededValue;
  }

  if (embryoType === '卵胎生') {
    if ((normalized >= 0 && normalized <= 5) || (normalized >= 355 && normalized <= 360)) return 1.0;
    if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return 1.25;
    if (normalized >= 175 && normalized <= 185) return 1.5;
    if (normalized >= 165 && normalized <= 195) return 1.75;
    if (getTransverseDistance(normalized) <= 5) return 2.0;
    if (getTransverseDistance(normalized) <= 15) return 2.25;
    return 1.33;
  }

  if (embryoType === '卵生') {
    if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return 1.0;
    if (normalized >= 165 && normalized <= 195) return 1.0;
    if (getTransverseDistance(normalized) <= 15) return 1.5;
    return 1.33;
  }

  if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return 1.0;
  if (normalized >= 165 && normalized <= 195) return 1.5;
  if (getTransverseDistance(normalized) <= 15) return 2.0;
  return 1.33;
}

// ── 自然胎动 ─────────────────────────────────────────
// 每胎每个时间单位（孕期为一天）判定一次，最多产生一类意图：上下移动、左右换位，
// 没有位移的那天才照原有规则转动角度。先依快照逐胎产生意图，再统一结算，
// 阵列遍历先后不会让谁天然占便宜；最后交给 reconcileFetalDescent 夹上限与容量。

/** 各孕期阶段一天内产生位移（上下或左右）的机率；多胎时再乘 1/√胎数，表示挤 */
const FETAL_MOVE_CHANCE = Object.freeze({ 孕早期: 0.6, 孕中期: 0.5, 孕晚期: 0.35, 临产期: 0.25, 逾期: 0.15, 延产期: 0.15 });
/** 位移中上下移动所占比例，其余为左右换位 */
const FETAL_VERTICAL_SHARE = 0.6;
/** 越接近足月越倾向往下 */
const FETAL_DOWNWARD_MATURITY_BIAS = Object.freeze({ 孕晚期: 0.1, 临产期: 0.15, 逾期: 0.15, 延产期: 0.15 });

/** 能自行活动的胎儿：已着床、没被包在宿主体内、还没入盆 */
function canMoveFreely(fetus, fetuses) {
  return !fetus?.pendingImplantation && !getEnclosingHost(fetus, fetuses) && getDescentStage(fetus) < DESCENT_INLET;
}

function rollFetalDownward(profile, stage) {
  const pressureCap = getUterinePressureCap(profile);
  const pressureRatio = clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) / Math.max(pressureCap, 1);
  const chance = clampNumber(0.5 + (pressureRatio * 0.25) + (FETAL_DOWNWARD_MATURITY_BIAS[stage] || 0), 0.1, 0.9, 0.5);
  return Math.random() < chance;
}

/** 原有的孕期角度规则：多胎时按胎重占比决定这天转不转得动 */
function driftPregnancyAngle(fetus, stage, gestationSpeed, totalWeight, fetusCount) {
  if (stage === '逾期' || stage === '延产期') return;
  const successRate = fetusCount > 1 ? clampNumber(fetus?.weight, 0.33, 3.0, 1.0) / Math.max(totalWeight, 0.33) : 1;
  if (Math.random() > successRate) return;
  const currentAngle = wrapAngle(fetus.tendencyAngle);
  if (stage === '孕早期') {
    fetus.tendencyAngle = wrapAngle(currentAngle + (randomInt(-45, 45) * gestationSpeed));
  } else if (stage === '孕中期') {
    fetus.tendencyAngle = wrapAngle(currentAngle + (randomInt(-30, 30) * gestationSpeed));
  } else if (stage === '孕晚期') {
    if (currentAngle >= 0 && currentAngle <= 180) {
      fetus.tendencyAngle = Math.max(0, currentAngle - (randomInt(1, 5) * gestationSpeed));
    } else {
      const shifted = currentAngle + (randomInt(1, 5) * gestationSpeed);
      fetus.tendencyAngle = shifted >= 360 ? 0 : shifted;
    }
    if (fetus.tendencyAngle === 0 || fetus.tendencyAngle === 360) {
      fetus.tendencyAngle = wrapAngle(Number(fetus.tendencyAngle || 0) + (randomInt(-2, 2) * gestationSpeed));
    }
  } else if (stage === '临产期') {
    const targetAngle = calculateNearestMainPosition(currentAngle);
    let diff = targetAngle - currentAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (angleDistance(currentAngle, targetAngle) > 15) {
      fetus.tendencyAngle = wrapAngle(currentAngle + (Math.sign(diff) * randomInt(1, 3) * gestationSpeed));
    }
  }
}

function isHeadDown(angle) {
  const normalized = wrapAngle(angle);
  return normalized <= 15 || normalized >= 345;
}

/**
 * 左右换位。同一胎囊（同卵共用）内的两胎可以互换；跨胎囊时整个胎囊一起搬，
 * 不会有别的胎儿夹进同一个胎囊中间。两边都得全员可自由活动、这一轮还没换过
 */
function swapLateral(fetuses, fetus, other, movers, swapped) {
  const group = getSharedSacGroup(fetus);
  const sameSac = group > 0 && group === getSharedSacGroup(other);
  const own = sameSac ? [fetus] : getSacBlock(fetuses, fetus);
  const theirs = sameSac ? [other] : getSacBlock(fetuses, other);
  const all = [...own, ...theirs];
  if (all.some((member) => swapped.has(member) || !movers.includes(member))) return;
  const [left, right] = fetuses.indexOf(own[0]) < fetuses.indexOf(theirs[0]) ? [own, theirs] : [theirs, own];
  fetuses.splice(fetuses.indexOf(left[0]), left.length + right.length, ...right, ...left);
  for (const member of all) swapped.add(member);
}

// 胎背翻身：孕期每天、没有位移的那天才可能翻；胎儿越大越难翻
const FETAL_ROLL_CHANCE = Object.freeze({ 孕中期: 0.06, 孕晚期: 0.03, 临产期: 0.02, 逾期: 0.01, 延产期: 0.01 });
// 产兆前驱与产程中，还在高位自由活动的胎儿每小时
const LABOR_FETAL_ROLL_CHANCE = 0.01;
// 已入盆的枕后位胎儿每小时自然转成枕前位（左右不变）；现实中多数枕后位会在产程中自己转正
const POSTERIOR_ROTATION_CHANCE = Object.freeze({ 产兆前驱: 0.03, 第一产程: 0.08, 第二产程: 0.05 });

function maybeRollBackSide(fetus, chance) {
  if (!(chance > 0) || Math.random() >= chance) return;
  const current = normalizeBackSide(fetus.backSide);
  const options = BACK_SIDES.filter((side) => side !== current);
  fetus.backSide = options[randomInt(0, options.length - 1)];
}

function maybeRotateToAnterior(fetus, chance) {
  if (!isPosteriorBack(fetus) || !(chance > 0) || Math.random() >= chance) return;
  fetus.backSide = `${fetus.backSide[0]}前`;
}

/** 一个时间单位的胎动。回传这一轮值得通报的位置事件 */
function stepFetalActivity(profile, stage, gestationSpeed) {
  const fetuses = profile.pregnant.fetuses;
  const movers = fetuses.filter((fetus) => canMoveFreely(fetus, fetuses));
  if (movers.length === 0) return [];
  for (const fetus of movers) {
    if (!Number.isFinite(Number(fetus?.tendencyAngle))) fetus.tendencyAngle = randomInt(0, 360);
  }

  // 第一阶段：依快照逐胎产生意图，这时还不改动任何东西
  const moveChance = (FETAL_MOVE_CHANCE[stage] || 0) / Math.sqrt(movers.length);
  const intents = movers.map((fetus) => {
    if (Math.random() >= moveChance) return { fetus, type: 'angle' };
    const index = fetuses.indexOf(fetus);
    const neighbors = [fetuses[index - 1], fetuses[index + 1]].filter((other) => other && movers.includes(other));
    if (neighbors.length > 0 && Math.random() >= FETAL_VERTICAL_SHARE) {
      return { fetus, type: 'lateral', with: neighbors[randomInt(0, neighbors.length - 1)] };
    }
    return { fetus, type: 'vertical', step: rollFetalDownward(profile, stage) ? 1 : -1 };
  });

  // 第二阶段：统一结算。角度与上下互不冲突；换位依快照的左右顺序处理，
  // 每胎一轮最多换一次，对象已换过就放弃
  const events = [];
  const cap = getDescentCap(stage);
  const totalWeight = fetuses.reduce((sum, fetus) => sum + clampNumber(fetus?.weight, 0.33, 3.0, 1.0), 0);
  if (stage === '孕晚期' && movers.length > 1) {
    // 原有规则：随机挑一个已转成头位、这轮没有位移的胎儿，按胎重占比决定会不会被挤歪
    const heads = intents.filter((intent) => intent.type === 'angle' && isHeadDown(intent.fetus.tendencyAngle));
    if (heads.length > 0) {
      const target = heads[randomInt(0, heads.length - 1)].fetus;
      const successRate = clampNumber(target?.weight, 0.33, 3.0, 1.0) / Math.max(totalWeight, 0.33);
      if (Math.random() > successRate) {
        target.tendencyAngle = wrapAngle(Number(target.tendencyAngle || 0) + (randomInt(-15, 15) * gestationSpeed));
      }
    }
  }
  const swapped = new Set();
  for (const intent of intents) {
    const { fetus } = intent;
    if (intent.type === 'angle') {
      const angleBefore = wrapAngle(fetus.tendencyAngle); driftPregnancyAngle(fetus, stage, gestationSpeed, totalWeight, fetuses.length); settleNaturalCrowding(profile, fetuses, fetus, angleBefore);
      maybeRollBackSide(fetus, FETAL_ROLL_CHANCE[stage] || 0);
    } else if (intent.type === 'vertical') {
      const before = getDescentStage(fetus);
      const after = Math.max(DESCENT_TOP, Math.min(cap, before + intent.step));
      fetus.descentStage = after;
      if (after !== before && (after === DESCENT_TOP || after === DESCENT_LOW)) events.push({ fetus, descentStage: after });
    } else {
      swapLateral(fetuses, fetus, intent.with, movers, swapped);
    }
  }
  return events;
}

/**
 * 把这一轮的位置事件汇整成一句，追加在 notify.secondly 之后，不覆盖既有讯息。
 * 胎儿标号用结算后的可见列表；未揭晓的胎儿不出现，免得剧透。
 */
function appendFetalActivityNotice(profile, female, events) {
  const visible = profile.pregnant.fetuses.filter(isFetusKnownToCharacter);
  const latest = new Map();
  for (const event of events) {
    if (!visible.includes(event.fetus)) continue;
    latest.delete(event.fetus);
    latest.set(event.fetus, event.descentStage);
  }
  // 事件之后又离开了该位置的不必再报
  for (const [fetus, descentStage] of latest) if (getDescentStage(fetus) !== descentStage) latest.delete(fetus);
  if (latest.size === 0) return;
  const phrases = [...latest].slice(0, 3).map(([fetus, descentStage]) => (
    `第${visible.indexOf(fetus) + 1}胎${descentStage === DESCENT_TOP ? '顶到了宫顶' : '下降到子宫低位'}`
  ));
  if (latest.size > 3) phrases.push(`另有${latest.size - 3}胎位置改变`);
  const notify = profile.notify || {};
  const current = String(notify.secondly || '').trim();
  const message = `${female}腹中${phrases.join('，')}`;
  profile.notify = { ...notify, secondly: current ? `${current}；${message}` : message };
}

function updateFetalPositions(profile, tick, female) {
  const stage = String(profile?.base?.stage || '');
  const pregnant = profile.pregnant || {};
  if (!Array.isArray(pregnant.fetuses) || pregnant.fetuses.length === 0 || !PREGNANCY_STAGES.includes(stage)) return;
  // 孕早期的胚胎只有几毫米，谈不上胎位或「降到子宫低位」；孕中期（约略也是能感觉到胎动的时候）才开始浮动
  if (stage === '孕早期') return;

  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1);
  // 逐日步进的上限：bsPassedTime 可以叠出十几万天，逐日推进会拖死 UI。
  // 10 年远超任何种族的妊娠期（最慢的 gestationSpeciesSpeed=0.1 也才 2800 天），
  // 正常剧情不会触到；只有荒谬的时间跳跃才会被截断。
  const MAX_DAILY_STEPS = 3650;
  const iterations = Math.min(MAX_DAILY_STEPS, Math.max(0, tick.passedDays));
  if (iterations <= 0) return;

  reconcileFetalDescent(profile);
  const events = [];
  for (let step = 0; step < iterations; step += 1) {
    events.push(...stepFetalActivity(profile, stage, gestationSpeed));
    reconcileFetalDescent(profile);
  }
  pregnant.fetusesCount = pregnant.fetuses.length;
  appendFetalActivityNotice(profile, female, events);
}

// ── 产兆前驱与产程的每小时胎动 ─────────────────────────
// 与孕期同一套两阶段引擎，只是改为每小时判定、更偏向垂直移动。
// 只有还在高位的胎儿能自行活动；前驱领头胎儿的位置由剩余时间推导，也不参与随机位移。
// 角度：高位胎儿往最近的主胎位靠（5°/小时 ÷ 分娩难度，斜位才转）；
// 已入盆或在产道里的先露胎只做速度减半的小幅校正。
const LABOR_FETAL_MOVE_CHANCE = 0.08;
const LABOR_FETAL_VERTICAL_SHARE = 0.7;
const LABOR_ACTIVITY_STAGES = Object.freeze(['产兆前驱', '第一产程', '第二产程']);

function correctTowardMainPosition(fetus, degrees) {
  const currentAngle = Number.isFinite(Number(fetus?.tendencyAngle)) ? wrapAngle(fetus.tendencyAngle) : randomInt(0, 360);
  fetus.tendencyAngle = currentAngle;
  if (!isObliquePosition(currentAngle, fetus)) return;
  const targetAngle = calculateNearestMainPosition(currentAngle);
  let diff = targetAngle - currentAngle;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  fetus.tendencyAngle = wrapAngle(currentAngle + (Math.sign(diff) * Math.min(angleDistance(currentAngle, targetAngle), degrees)));
}

function rollLaborDownward(profile) {
  const pressureCap = getUterinePressureCap(profile);
  const pressureRatio = clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) / Math.max(pressureCap, 1);
  return Math.random() < clampNumber(0.6 + (pressureRatio * 0.3), 0.1, 0.9, 0.6);
}

function stepLaborFetalActivity(profile, stage) {
  const pregnant = profile.pregnant;
  const fetuses = pregnant.fetuses;
  const correction = 5 / clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  const lead = stage === '产兆前驱' ? fetuses.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId) : null;
  const movers = fetuses.filter((fetus) => canMoveFreely(fetus, fetuses) && fetus !== lead);
  const engaged = fetuses.filter((fetus) => !fetus?.pendingImplantation && !getEnclosingHost(fetus, fetuses)
    && (fetus === lead || getDescentStage(fetus) >= DESCENT_INLET));

  // 第一阶段：依快照产生意图
  const moveChance = movers.length > 0 ? LABOR_FETAL_MOVE_CHANCE / Math.sqrt(movers.length) : 0;
  const intents = movers.map((fetus) => {
    if (Math.random() >= moveChance) return { fetus, type: 'angle' };
    const index = fetuses.indexOf(fetus);
    const neighbors = [fetuses[index - 1], fetuses[index + 1]].filter((other) => other && movers.includes(other));
    if (neighbors.length > 0 && Math.random() >= LABOR_FETAL_VERTICAL_SHARE) {
      return { fetus, type: 'lateral', with: neighbors[randomInt(0, neighbors.length - 1)] };
    }
    return { fetus, type: 'vertical', step: rollLaborDownward(profile) ? 1 : -1 };
  });

  // 真实模式的病理性突破：先露胎已在入口 0，另一胎同一小时由 -1 往下，
  // 且胎重相近、宫压够强时，它也挤进入口（互锁只看构型，不看亲和）。同一结算只允许编号最小的一胎尝试
  const intruder = pickInletIntruder(profile, stage, intents);

  // 第二阶段：统一结算；非领头胎儿在产程中最多到子宫低位，入口由协调函数把关
  const events = [];
  const swapped = new Set();
  for (const intent of intents) {
    const { fetus } = intent;
    if (intent.type === 'angle') {
      correctTowardMainPosition(fetus, correction);
      maybeRollBackSide(fetus, LABOR_FETAL_ROLL_CHANCE);
    } else if (intent.type === 'vertical') {
      if (fetus === intruder) {
        fetus.descentStage = DESCENT_INLET;
        fetus.inletIntruder = true;
        continue;
      }
      const before = getDescentStage(fetus);
      const after = Math.max(DESCENT_TOP, Math.min(DESCENT_LOW, before + intent.step));
      fetus.descentStage = after;
      if (after !== before && (after === DESCENT_TOP || after === DESCENT_LOW)) events.push({ fetus, descentStage: after });
    } else {
      swapLateral(fetuses, fetus, intent.with, movers, swapped);
    }
  }
  for (const fetus of engaged) {
    correctTowardMainPosition(fetus, correction / 2);
    maybeRotateToAnterior(fetus, POSTERIOR_ROTATION_CHANCE[stage] || 0);
  }

  return events;
}

function pickInletIntruder(profile, stage, intents) {
  if (!isRealisticLabor(profile) || !OBSTRUCTION_STAGES.includes(stage)) return null;
  const pregnant = profile.pregnant;
  const fetuses = pregnant.fetuses;
  const presenting = fetuses.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId);
  if (!presenting || getDescentStage(presenting) !== DESCENT_INLET) return null;
  if (fetuses.some((fetus) => fetus.inletIntruder && getDescentStage(fetus) === DESCENT_INLET)) return null;
  const pressureCap = getUterinePressureCap(profile);
  if (clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) < pressureCap * INLET_INTRUSION_PRESSURE_RATIO) return null;
  const presentingWeight = clampNumber(presenting.weight, 0.33, 3.0, 1.0);
  const candidates = intents
    .filter((intent) => intent.type === 'vertical' && intent.step > 0 && getDescentStage(intent.fetus) === DESCENT_LOW)
    .map((intent) => intent.fetus)
    .filter((fetus) => {
      const weight = clampNumber(fetus.weight, 0.33, 3.0, 1.0);
      return Math.min(weight, presentingWeight) / Math.max(weight, presentingWeight) >= INLET_INTRUSION_WEIGHT_RATIO
        && isLockedTwins(presenting, fetus);
    })
    .sort((left, right) => Number(left.embryoId) - Number(right.embryoId));
  // 构型对了也不是每次都会卡上：每次尝试 20%
  if (!candidates[0] || Math.random() >= INLET_INTRUSION_CHANCE) return null;
  return candidates[0];
}

function advanceLaborFetalActivity(profile, tick, female) {
  const stage = String(profile?.base?.stage || '');
  const pregnant = profile.pregnant || {};
  if (!LABOR_ACTIVITY_STAGES.includes(stage) || !Array.isArray(pregnant.fetuses) || pregnant.fetuses.length === 0) return;
  // 逐小时步进的上限：产程远短于一个月，超长跳跃只是不再线性增加胎动次数
  const MAX_HOURLY_STEPS = 24 * 30;
  const iterations = Math.min(MAX_HOURLY_STEPS, Math.max(0, tick.passedHours));
  if (iterations <= 0) return;
  reconcileFetalDescent(profile);
  const events = [];
  for (let step = 0; step < iterations; step += 1) {
    events.push(...stepLaborFetalActivity(profile, stage));
    reconcileFetalDescent(profile);
  }
  appendFetalActivityNotice(profile, female, events);
}

function rescaleSpermContacts(base) {
  for (const male of new Set((base.spermContacts || []).map((x) => x.male))) {
    const contacts = base.spermContacts.filter((x) => x.male === male);
    const previous = contacts.reduce((sum, x) => sum + x.value, 0);
    const residue = (base.sperms || []).find((x) => x.male === male)?.value || 0;
    const factor = previous > 0 ? Math.min(1, residue / previous) : 0;
    for (const contact of contacts) contact.value *= factor;
  }
}

function stageAllowsSpermRetention(stage) {
  return MENSTRUAL_STAGES.includes(stage) || PREGNANCY_STAGES.includes(stage) || stage === '产后恢复' || stage === '假孕期';
}

function processSpermLifecycle(profile, stage, tick) {
  const base = profile.base || {};
  const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  if (sperms.length === 0) {
    base.sperms = [];
    rescaleSpermContacts(base);
    return;
  }

  if (stage === '月经期' && tick.passedHours > 0) {
    base.sperms = [];
    rescaleSpermContacts(base);
    return;
  }

  if (!stageAllowsSpermRetention(stage)) {
    base.sperms = [];
    rescaleSpermContacts(base);
    return;
  }

  base.sperms = sperms
    .map((item) => ({
      ...item,
      value: Math.max(0, clampNumber(item?.value, 0, 999999, 0) - (tick.deltaDays * SPERM_DECAY_PER_DAY)),
    }))
    .filter((item) => item.value > 0);
  rescaleSpermContacts(base);
}

/**
 * 一次受精判定。回传剩余卵数。
 * chanceFactor 供异期复孕压低机率；superfetation 时另外标记新胚胎。
 */
function attemptFertilization(profile, { deltaDays, stage, name, notify, chanceFactor = 1, superfetation = false }) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  const contacts = base.spermContacts || [];
  const availableSperms = sperms.flatMap((item) => {
    const sources = contacts.filter((x) => x.male === item.male);
    const total = sources.reduce((sum, x) => sum + x.value, 0);
    const unknown = Math.max(0, Number(item.value) - total);
    return [...sources.filter((x) => !x.blocked && x.value > 0), ...(unknown > 0 ? [{ ...item, value: unknown }] : [])];
  }).filter((item) => clampNumber(item?.value, 0, 999999, 0) > 0);
  const eggs = clampNumber(base.eggs, 0, 99, 0);
  if (eggs <= 0 || availableSperms.length === 0) return eggs;

  // 每颗卵各自擲骰：多胎由卵数与单颗机率自然决定，多产物种不需要特例；没受精的卵留到下次推进
  const preview = calculateFertilizationPreview({
    eggRace: profile?.base?.race,
    impregnationDifficulty: profile?.bio?.impregnationDifficulty,
    elapsedDays: deltaDays,
    chanceFactor,
    spermSources: availableSperms,
  });
  const totalSperm = preview.totalSperm;
  let remaining = eggs;
  for (let attempt = 0; attempt < eggs; attempt += 1) {
    let winner = null;
    if (preview.successChance > 0 && Math.random() <= preview.successChance) {
      let selectedSource = preview.sources[0] || null;
      if (preview.sources.length > 1) {
        let roll = Math.random() * preview.totalChanceWeight;
        for (const source of preview.sources) {
          roll -= source.chance;
          if (roll <= 0) {
            selectedSource = source;
            break;
          }
        }
      }
      winner = selectedSource ? availableSperms[selectedSource.sourceIndex] : null;
    }
    if (winner) {
      pregnant.fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
      const fetus = createSimpleFetus(profile, winner, stage);
      if (winner.id !== undefined) { fetus.contactIds = [winner.id]; fetus.contactMinutes = winner.minutesPassed; }
      // 孕中孕：异期受精成立之后，再看三个额外条件同时成不成立
      const conceivedAt = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
      const nestedHost = superfetation
        && conceivedAt >= NESTED_WINDOW_MIN_DAYS
        && totalSperm > NESTED_MIN_SPERM
        ? pickNestedHostFetus(profile)
        : null;
      if (nestedHost) markNestedFetus(profile, fetus, nestedHost);
      else if (superfetation) markSuperfetationFetus(profile, fetus);
      if (!pregnant.experienceBeforePregnancy && !superfetation) pregnant.experienceBeforePregnancy = experienceSnapshot(profile.experience);
      pregnant.fetuses.push(fetus);
      if (!superfetation) setVisualCue(profile, 'fertilization');
      notify.secondly = nestedHost
        ? `${name}体内的一胎之中又结出了新的受精卵`
        : (superfetation ? `${name}在妊娠中再度受精` : `${name}受精成功`);
      remaining -= 1;
    }
  }
  return remaining;
}

/**
 * 把新胚胎标成异期胎：记下受精当下的共用时钟、标为待着床、按落后进度打胎重折扣。
 *
 * 胎重折扣取 (1 − 落后 / 280)²。平方是因为生长亏损是复利而不是等差：
 * 线性版本在视窗上限只掉到 0.70，平方版本落到 0.49，符合「落后一整个孕早期
 * 大约只有一半重」的直觉。这是乘在 getConceptionWeight 既有的四个乘数之上，
 * 种族混血偏移（weightRatio）照常生效；两者都不利时会撞到 0.33 的地板。
 */
function markSuperfetationFetus(profile, fetus) {
  const pregnant = profile.pregnant || {};
  const conceivedAt = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const lag = Math.min(conceivedAt / SUPERFETATION_FULL_TERM_DAYS, 1);
  fetus.conceivedAtDays = conceivedAt;
  fetus.pendingImplantation = true;
  fetus.tags = sanitizeFetusTagList([...(fetus.tags || []), 'superfetation']);
  fetus.weight = clampNumber(fetus.weight * ((1 - lag) ** 2), 0.33, 3.0, 1.0);
}

/**
 * 待着床的异期胚胎。刻意不重用一般的着床区块——那一段成功时会把阶段设成孕早期、
 * 重设两个孕龄时钟、重置羊膜耐久、并多记一次怀孕经验，等于把先来那胎的妊娠整个洗掉；
 * 失败时更会 pregnant.fetuses = [] 把既有胎儿一起清空。
 *
 * 这里只做属于新胚胎自己的事：倒数、着床成败、分裂与融合都只作用於本批。
 */
/**
 * 异期胎的揭晓。在此之前它在状态里照常存在、照常发育，只是提示词投影与追踪页
 * 都看不到它——角色本人还不知道自己怀了两胎。隐藏期间它仍然吃供养力，
 * 所以模型会看到「负担莫名偏高」，那是伏笔而不是穿帮。
 */
function revealSuperfetationFetuses(profile, name, notify, { force = false } = {}) {
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const shared = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  let revealed = 0;
  for (const fetus of fetuses) {
    if (!fetus?.conceivedAtDays || fetus.revealed || fetus.pendingImplantation) continue;
    // 孕中孕藏得比一般异期胎久：要到孕晚期才看得到
    const threshold = fetus.nestedInEmbryoId ? NESTED_REVEAL_DAYS : SUPERFETATION_REVEAL_DAYS;
    if (!force && shared < threshold) continue;
    fetus.revealed = true;
    revealed += 1;
  }
  if (revealed > 0 && notify) {
    notify.firstly = `${name}被检查出体内另有 ${revealed} 胎，孕龄与先来者并不一致`;
  }
  return revealed > 0;
}

function processSuperfetationImplantation(profile, tick, notify, name) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  if (!isTruePregnancyStage(stage)) return;
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const pending = fetuses.filter((fetus) => fetus?.pendingImplantation);
  if (pending.length === 0) return;

  // 还没着床就撞上孕中期：一律清掉。着床太晚本来就该失败，
  // 也顺带保证不会有未着床的胚胎活到分娩变成孩子。
  if (stage !== SUPERFETATION_STAGE) {
    pregnant.fetuses = fetuses.filter((fetus) => !fetus?.pendingImplantation);
    pregnant.fetusesCount = pregnant.fetuses.length;
    base.fertilizationDays = 0;
    notify.secondly = `${name}体内新的受精卵未能著床`;
    updateFetalEnergyDrain(profile);
    return;
  }

  // 妊娠期间 base.fertilizationDays 是闲置的（一般着床区块两条分支都要求
  // !isPregnancyStage），借来当这一批的倒数
  base.fertilizationDays = clampNumber(base.fertilizationDays, 0, 9999, 0) + tick.deltaDays;
  if (base.fertilizationDays < getImplantationDays(profile)) return;

  const vitality = clampNumber(base.vitality, 0, 200, 100);
  const implantationFailChance = vitality < 100 ? (100 - vitality) / 100 : 0;
  base.fertilizationDays = 0;
  if (Math.random() < implantationFailChance) {
    // 只移除本批，先来那胎不受影响
    pregnant.fetuses = fetuses.filter((fetus) => !fetus?.pendingImplantation);
    pregnant.fetusesCount = pregnant.fetuses.length;
    notify.secondly = `${name}体内新的受精卵著床失败`;
    updateFetalEnergyDrain(profile);
    return;
  }

  for (const fetus of pending) delete fetus.pendingImplantation;
  applyIdenticalSplit(profile, pending);
  resolvePendingChimeraGenders(pending);
  pregnant.fetusesCount = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.length : 0;
  updateFetalEnergyDrain(profile);
}

/**
 * 把新胚胎标成孕中孕：母方是宿主胎儿（用 embryoId 指过去，出生后再解析成孩子 id），
 * 父方照常是精源。它同时也是异期胎，所以两个标签都带。
 */
function markNestedFetus(profile, fetus, host) {
  markSuperfetationFetus(profile, fetus);
  fetus.nestedInEmbryoId = host.embryoId;
  fetus.tags = sanitizeFetusTagList([...(fetus.tags || []), 'nested']);
}

function processSimpleConception(profile, tick, notify, name) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const deltaDays = tick.deltaDays;
  const fullDays = tick.passedDays;
  const passedHours = tick.passedHours;
  const allowsNaturalConception = MENSTRUAL_STAGES.includes(stage);

  if (allowsNaturalConception) {
    // 一次性排出本周期的份额：按天累加会让长排卵期窗口把卵数堆到上限，
    // 而取 min 封顶又会把高潮诱发排卵已经排出的卵砍掉
    if (stage === '排卵期' && fullDays > 0 && !(profile.cooldown || {}).naturalOvulationUsed) {
      base.eggs = clampNumber(base.eggs, 0, 99, 0) + getNaturalOvulationTotal(profile);
      setVisualCue(profile, 'ovulation');
      profile.cooldown = { ...(profile.cooldown || {}), naturalOvulationUsed: true };
    }

    if (stage === '月经期' && passedHours > 0) {
      base.eggs = 0;
    } else {
      // 先让这段时间里还活着的卵受精，再扣掉过期的：先扣的话，黄体期里的卵在整天推进时
      // 一颗都轮不到受精（黄体期高潮排卵、排卵期残留的卵都会白白消失）
      base.eggs = attemptFertilization(profile, { deltaDays, stage, name, notify });
      if (base.eggs > 0 && fullDays > 0 && stage !== '排卵期') {
        base.eggs = Math.max(0, clampNumber(base.eggs, 0, 99, 0) - fullDays);
      }
    }
  } else if (stage === SUPERFETATION_STAGE) {
    // 异期复孕。卵不是这里排的——高潮排卵本来就不挡妊娠，而孕期中卵子既不衰减
    // 也不清除，所以「这个周期没用掉的排卵留到孕早期」是现成行为，不必新增。
    // 这里只把受精那一步的闸门打开，并按进度压低机率：越晚越难，视窗末端归零。
    const windowDays = getSuperfetationWindowDays(profile);
    const conceivedAt = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
    if (windowDays > 0 && conceivedAt < windowDays) {
      const decay = 1 - (conceivedAt / windowDays);
      base.eggs = attemptFertilization(profile, {
        deltaDays, stage, name, notify,
        chanceFactor: SUPERFETATION_CHANCE_FACTOR * decay,
        superfetation: true,
      });
    }
  }

  processSuperfetationImplantation(profile, tick, notify, name);

  const hasPreimplantationEmbryos = !isPregnancyStage(stage)
    && Array.isArray(pregnant.fetuses)
    && pregnant.fetuses.length > 0;
  if (hasPreimplantationEmbryos) {
    ensureEmbryoMetadata(pregnant);
    base.fertilizationDays = clampNumber(base.fertilizationDays, 0, 9999, 0) + deltaDays;
    const beforeFusionCount = pregnant.fetuses.length;
    applyChimeraFusion(profile, name);
    if (pregnant.fetuses.length < beforeFusionCount) notify.secondly = `${name}的早期受精卵发生了融合`;
    if (base.fertilizationDays >= getImplantationDays(profile)) {
      const vitality = clampNumber(base.vitality, 0, 200, 100);
      const implantationFailChance = vitality < 100 ? (100 - vitality) / 100 : 0;
      if (Math.random() < implantationFailChance) {
        pregnant.fetuses = [];
        pregnant.fetusesCount = 0;
        pregnant.fetalEnergyDrain = 0;
        base.fertilizationDays = 0;
        notify.secondly = `${name}因身体虚弱，胚胎著床失败`;
        setVisualCue(profile, 'implantationFailed');
      } else {
        const obstetricPregnantDays = base.fertilizationDays + getObstetricPregnancyOffsetDays(profile);
        const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1);
        applyIdenticalSplit(profile);
        resolvePendingChimeraGenders(pregnant.fetuses);
        base.stage = '孕早期';
        base.days = 0;
        base.fertilizationDays = 0;
        pregnant.pregnantDays = obstetricPregnantDays;
        pregnant.effectivePregnantDays = obstetricPregnantDays * gestationSpeed;
        for (const fetus of pregnant.fetuses) fetus.amnionDurability = AMNION_INTACT;
        profile.experience = {
          ...(profile.experience || {}),
          pregnantExperience: clampNumber(profile?.experience?.pregnantExperience, 0, 999, 0) + 1,
        };
        notify.firstly = `${name}进入了孕早期`;
        setVisualCue(profile, 'implantation');
      }
    }
  } else if (!isPregnancyStage(stage)) {
    base.fertilizationDays = 0;
  }

  pregnant.fetusesCount = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.length : 0;
  updateFetalEnergyDrain(profile);
}
function normalizeToolCallArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPregnancyStage(stage) {
  return PREGNANCY_STAGES.includes(stage) || stage === '假孕期' || stage === '产兆前驱' || LABOR_STAGES.includes(stage);
}

function isTruePregnancyStage(stage) {
  return PREGNANCY_STAGES.includes(stage) || stage === '产兆前驱' || LABOR_STAGES.includes(stage);
}

function canProduceMilk(profile) {
  const stage = String(profile?.base?.stage || '');
  return stage === '假孕期' || stage === '产后恢复' || isTruePregnancyStage(stage);
}

function hasDerivedMetabolism(profile) {
  return Boolean(String(profile?.base?.derivedType || '').trim());
}

function getMetabolismExemptionSet(profile) {
  if (!hasDerivedMetabolism(profile)) return new Set();
  return new Set(getDerivedTypeMetabolismExemptions(profile?.base?.derivedType));
}

function isMetabolismExempt(profile, key) {
  return getMetabolismExemptionSet(profile).has(key);
}

function applyDerivedMetabolismExemptions(profile) {
  if (!hasDerivedMetabolism(profile)) return;
  const metabolism = profile.metabolism || {};
  for (const key of getMetabolismExemptionSet(profile)) {
    metabolism[key] = 0;
  }
  profile.metabolism = metabolism;
}

const BASE_METABOLISM_CAP = 150;
const EXPANDED_METABOLISM_CAP = 200;

function getActiveExpansion(profile, key, currentFlux = 0) {
  const expansion = profile?.pregnant?.expansion;
  if (!expansion || typeof expansion !== 'object') return false;
  const expansionKey = String(expansion.key || '').trim();
  const isMatch = expansionKey === key
    || (key === 'flux' && currentFlux > 0 && expansionKey === 'fluxPositive')
    || (key === 'flux' && currentFlux < 0 && expansionKey === 'fluxNegative');
  return isMatch && !isMetabolismExempt(profile, key);
}

function getMetabolismCap(profile, key, currentFlux = 0) {
  return getActiveExpansion(profile, key, currentFlux) ? EXPANDED_METABOLISM_CAP : BASE_METABOLISM_CAP;
}

function applyMetabolismCapacityLimits(profile) {
  const metabolism = profile?.metabolism || {};
  for (const key of ['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship']) {
    metabolism[key] = isMetabolismExempt(profile, key)
      ? 0
      : clampNumber(metabolism[key], 0, getMetabolismCap(profile, key), 0);
  }
  if (hasDerivedMetabolism(profile)) {
    const flux = Number(metabolism.flux) || 0;
    const cap = getMetabolismCap(profile, 'flux', flux);
    metabolism.flux = clampNumber(flux, -cap, cap, 0);
  }
  profile.metabolism = metabolism;
}

function addMetabolismValue(profile, key, delta, min = 0, max = 150) {
  if (!delta || profile?.immune?.metabolism || isMetabolismExempt(profile, key)) return 0;
  const metabolism = profile.metabolism || {};
  const activeMax = max === BASE_METABOLISM_CAP ? getMetabolismCap(profile, key, Number(metabolism[key]) || 0) : max;
  const current = clampNumber(metabolism[key], min, activeMax, 0);
  const adjustedDelta = delta > 0 ? delta * getActiveAccelerationMultiplier(profile, key) : delta;
  const next = clampNumber(current + adjustedDelta, min, activeMax, current);
  metabolism[key] = next;
  profile.metabolism = metabolism;
  return next - current;
}

function getMilkFetalLoad(profile) {
  const stage = String(profile?.base?.stage || '');
  if (stage === '产后恢复') return 1.35;
  if (stage === '假孕期') return 0.08;
  if (!isTruePregnancyStage(stage)) return 0;

  const pregnant = profile?.pregnant || {};
  const effectiveDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const progress = clampNumber(effectiveDays / 280, 0, 1.5, 0);
  const fetalEnergyDrain = clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 0);
  const fetusesCount = Math.max(1, clampNumber(pregnant.fetusesCount, 0, 99, 0));
  return clampNumber((0.15 + progress) * (0.5 + fetalEnergyDrain + (fetusesCount * 0.15)), 0, 12, 0);
}

function getMilkGainMultiplier(profile) {
  const fetalLoad = getMilkFetalLoad(profile);
  if (fetalLoad <= 0) return 0;
  const breedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1);
  return fetalLoad * clampNumber(breedTolerance, 0.1, 8, 1);
}

function applyRetention(reduction, retentionRate) {
  const value = Math.max(0, Number(reduction) || 0);
  if (value <= 0 || retentionRate <= 0) return value;
  return value * (1 - retentionRate);
}

const PREGNANCY_BLOCKAGE_STAGE_CHANCE = Object.freeze({
  假孕期: 10,
  孕早期: 28,
  孕中期: 22,
  孕晚期: 34,
  临产期: 42,
  逾期: 48,
  延产期: 48,
  产兆前驱: 55,
  第一产程: 60,
  第二产程: 65,
  第三产程: 35,
  产后恢复: 25,
});

const PREGNANCY_BLOCKAGE_STAGE_SEVERITY = Object.freeze({
  假孕期: 0.12,
  孕早期: 0.20,
  孕中期: 0.18,
  孕晚期: 0.26,
  临产期: 0.32,
  逾期: 0.36,
  延产期: 0.36,
  产兆前驱: 0.40,
  第一产程: 0.42,
  第二产程: 0.45,
  第三产程: 0.25,
  产后恢复: 0.22,
});

const PREGNANCY_BLOCKAGE_STAGE_WEIGHTS = Object.freeze({
  假孕期: { milk: 3, hunger: 3, sleep: 2, companionship: 2, odor: 1 },
  孕早期: { hunger: 5, excretion: 4, sleep: 3, companionship: 2, odor: 1, milk: 1 },
  孕中期: { excretion: 5, hunger: 3, sleep: 3, companionship: 2, milk: 2, odor: 1 },
  孕晚期: { excretion: 6, sleep: 3, milk: 3, hunger: 2, companionship: 2, odor: 2 },
  临产期: { excretion: 6, sleep: 3, milk: 3, odor: 2, hunger: 2, companionship: 2 },
  逾期: { excretion: 6, sleep: 4, milk: 3, odor: 2, hunger: 2, companionship: 2 },
  延产期: { excretion: 6, sleep: 4, milk: 3, odor: 2, hunger: 2, companionship: 2 },
  产兆前驱: { excretion: 6, sleep: 4, milk: 3, odor: 2, companionship: 2, hunger: 1 },
  第一产程: { excretion: 6, sleep: 4, odor: 2, milk: 2, companionship: 2, hunger: 1 },
  第二产程: { excretion: 5, sleep: 4, odor: 2, milk: 2, companionship: 2, hunger: 1 },
  第三产程: { sleep: 4, odor: 3, milk: 3, companionship: 3, excretion: 2, hunger: 1 },
  产后恢复: { milk: 5, sleep: 4, companionship: 4, odor: 3, excretion: 2, hunger: 1 },
});

const PREGNANCY_BLOCKAGE_KEY_SEVERITY_MULTIPLIER = Object.freeze({
  excretion: 1.35,
  sleep: 1.15,
  milk: 1.15,
  hunger: 1.15,
  odor: 0.85,
  companionship: 1.0,
  fluxPositive: 1.25,
  fluxNegative: 1.25,
});

const PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP = Object.freeze({
  excretion: 0.90,
  sleep: 0.75,
  milk: 0.75,
  hunger: 0.75,
  odor: 0.65,
  companionship: 0.75,
  fluxPositive: 0.85,
  fluxNegative: 0.85,
});

function canHavePregnancyBlockage(profile) {
  const stage = String(profile?.base?.stage || '');
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  return fetuses.length > 0
    || PREGNANCY_STAGES.includes(stage)
    || stage === '假孕期'
    || stage === '产兆前驱'
    || LABOR_STAGES.includes(stage)
    || stage === '产后恢复';
}

function getAvailablePregnancySymptomKeys(profile) {
  const isDerived = hasDerivedMetabolism(profile);
  const exemptions = getMetabolismExemptionSet(profile);
  const keys = ['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship'].filter((key) => !exemptions.has(key));
  if (isDerived) keys.push('fluxPositive', 'fluxNegative');
  return keys;
}

function getPregnancyBlockageChance(profile) {
  const stage = String(profile?.base?.stage || '');
  const baseChance = PREGNANCY_BLOCKAGE_STAGE_CHANCE[stage] || 0;
  if (baseChance <= 0) return 0;
  const fetalEnergyDrain = clampNumber(profile?.pregnant?.fetalEnergyDrain, 0, 9999, 0);
  const vitality = clampNumber(profile?.base?.vitality, 0, 200, 100);
  const psyStress = clampNumber(profile?.base?.psyStress, 0, 200, 100);
  const lowVitalityBonus = Math.max(0, 100 - vitality) * 0.12;
  const stressBonus = psyStress > 120 ? 8 : 0;
  return clampNumber(baseChance + (fetalEnergyDrain * 8) + lowVitalityBonus + stressBonus, 0, 85, 0);
}

function getPregnancyBlockageSeverity(profile, key) {
  const stage = String(profile?.base?.stage || '');
  const baseSeverity = PREGNANCY_BLOCKAGE_STAGE_SEVERITY[stage] || 0.10;
  const fetalEnergyDrain = clampNumber(profile?.pregnant?.fetalEnergyDrain, 0, 9999, 0);
  const vitality = clampNumber(profile?.base?.vitality, 0, 200, 100);
  const lowVitalityBonus = vitality < 80 ? 0.06 : 0;
  const multiplier = PREGNANCY_BLOCKAGE_KEY_SEVERITY_MULTIPLIER[key] || 1;
  const cap = PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP[key] || 0.75;
  return clampNumber((baseSeverity * multiplier) + (fetalEnergyDrain * 0.035) + lowVitalityBonus, 0.10, cap, 0.10);
}

function pickWeightedKey(weightMap) {
  const entries = Object.entries(weightMap)
    .map(([key, weight]) => [key, Math.max(0, Number(weight) || 0)])
    .filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let cursor = Math.random() * total;
  for (const [key, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return key;
  }
  return entries[entries.length - 1]?.[0] || null;
}

function pickPregnancySymptomKey(profile, excludedKeys = []) {
  const excluded = new Set(Array.isArray(excludedKeys) ? excludedKeys : [excludedKeys]);
  const available = new Set(getAvailablePregnancySymptomKeys(profile).filter((key) => !excluded.has(key)));
  if (available.size === 0) return null;
  const stage = String(profile?.base?.stage || '');
  const weights = { ...(PREGNANCY_BLOCKAGE_STAGE_WEIGHTS[stage] || {}) };
  if (hasDerivedMetabolism(profile)) {
    const flux = Number(profile?.metabolism?.flux) || 0;
    weights.fluxPositive = (weights.fluxPositive || 1) + (flux > 0 ? 3 : 0);
    weights.fluxNegative = (weights.fluxNegative || 1) + (flux < 0 ? 3 : 0);
  }
  for (const key of Object.keys(weights)) {
    if (!available.has(key)) delete weights[key];
  }
  for (const key of available) {
    if (weights[key] === undefined) weights[key] = 1;
  }
  return pickWeightedKey(weights);
}

function refreshPregnancySymptoms(profile, tick) {
  const pregnant = profile?.pregnant || {};
  if (tick.passedDays <= 0) return;
  if (!canHavePregnancyBlockage(profile)) {
    pregnant.blockage = null;
    pregnant.acceleration = null;
    pregnant.expansion = null;
    profile.pregnant = pregnant;
    return;
  }
  const chance = getPregnancyBlockageChance(profile);
  const key = chance > 0 && Math.random() * 100 < chance ? pickPregnancySymptomKey(profile) : null;
  pregnant.blockage = key
    ? { key, severity: getPregnancyBlockageSeverity(profile, key) }
    : null;
  const acceleratedKey = chance > 0 && Math.random() * 100 < chance ? pickPregnancySymptomKey(profile, [key]) : null;
  pregnant.acceleration = acceleratedKey
    ? { key: acceleratedKey, severity: getPregnancyBlockageSeverity(profile, acceleratedKey) }
    : null;
  const expandedKey = chance > 0 && Math.random() * 100 < chance ? pickPregnancySymptomKey(profile, [key, acceleratedKey]) : null;
  pregnant.expansion = expandedKey ? { key: expandedKey, severity: 1 } : null;
  profile.pregnant = pregnant;
}

function getActiveBlockageRetention(profile, key, currentFlux = 0) {
  const blockage = profile?.pregnant?.blockage;
  if (!blockage || typeof blockage !== 'object') return 0;
  const blockageKey = String(blockage.key || '').trim();
  if (!blockageKey) return 0;
  if (blockageKey === 'fluxPositive') {
    return hasDerivedMetabolism(profile) && currentFlux > 0 ? clampNumber(blockage.severity, 0, PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP.fluxPositive, 0) : 0;
  }
  if (blockageKey === 'fluxNegative') {
    return hasDerivedMetabolism(profile) && currentFlux < 0 ? clampNumber(blockage.severity, 0, PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP.fluxNegative, 0) : 0;
  }
  if (blockageKey !== key || isMetabolismExempt(profile, key)) return 0;
  return clampNumber(blockage.severity, 0, PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP[key] || 0.75, 0);
}

function getActiveAccelerationMultiplier(profile, key, currentFlux = 0) {
  const acceleration = profile?.pregnant?.acceleration;
  if (!acceleration || typeof acceleration !== 'object') return 1;
  const accelerationKey = String(acceleration.key || '').trim();
  const isMatch = accelerationKey === key
    || (key === 'flux' && currentFlux > 0 && accelerationKey === 'fluxPositive')
    || (key === 'flux' && currentFlux < 0 && accelerationKey === 'fluxNegative');
  if (!isMatch || isMetabolismExempt(profile, key)) return 1;
  const cap = PREGNANCY_BLOCKAGE_KEY_SEVERITY_CAP[accelerationKey] || 0.75;
  return 1 + clampNumber(acceleration.severity, 0, cap, 0);
}

function applyMilkGain(profile, rawAmount) {
  const multiplier = getMilkGainMultiplier(profile);
  if (multiplier <= 0 || rawAmount <= 0) return 0;
  return addMetabolismValue(profile, 'milk', rawAmount * multiplier, 0, 150);
}

function applyCycleBreastNeedGain(profile, hours) {
  const stage = String(profile?.base?.stage || '');
  const hourlyRate = stage === '黄体期' ? 0.15 : stage === '月经期' ? 0.10 : 0;
  if (hourlyRate <= 0) return 0;
  return addMetabolismValue(profile, 'milk', hourlyRate * hours, 0, 150);
}

function applyPassiveMetabolism(profile, tick) {
  if (profile?.immune?.metabolism) return;
  const hours = Math.max(0, tick.passedHours);
  if (hours <= 0) return;
  applyCycleBreastNeedGain(profile, hours);
  applyMilkGain(profile, 0.08 * hours);
  addMetabolismValue(profile, 'odor', 0.04 * hours, 0, 150);
  addMetabolismValue(profile, 'companionship', 0.05 * hours, 0, 150);
}

function applyMilkFromLibido(profile, changeValue) {
  // 性欲下降不该泌乳：调用方传的是带符号的增量
  const delta = Number(changeValue) || 0;
  if (delta <= 0) return;
  if (String(profile?.base?.stage || '') === '排卵期') {
    addMetabolismValue(profile, 'milk', delta * 0.05, 0, 150);
  }
  applyMilkGain(profile, delta * 0.18);
}

function applyOdorGain(profile, amount) {
  return addMetabolismValue(profile, 'odor', Math.max(0, Number(amount) || 0), 0, 150);
}

function getOdorCompanionshipReliefMultiplier(odor) {
  const value = clampNumber(odor, 0, 150, 0);
  if (value >= 125) return 0.45;
  if (value >= 100) return 0.60;
  if (value >= 75) return 0.75;
  return 1;
}

function applyAccelerationRebound(profile, key, relievedAmount) {
  const released = Math.max(0, Number(relievedAmount) || 0);
  const severity = getActiveAccelerationMultiplier(profile, key) - 1;
  if (released <= 0 || severity <= 0) return 0;
  return addMetabolismValue(profile, key, released * severity * 0.25, 0, 150);
}

function getDerivedFluxDirection(currentFlux, fallbackDirection = 1) {
  const current = Number(currentFlux) || 0;
  if (current > 0) return 1;
  if (current < 0) return -1;
  return fallbackDirection >= 0 ? 1 : -1;
}

function shouldResetOrgasmOvulation(stage) {
  return stage === '月经期' || stage === '产后恢复';
}

const UTERINE_ATONY_STEP = 0.1;

/** 子宫乏力级数：第二次延产起每延一次加 1，产后恢复结束才清零 */
function getUterineAtony(profile) {
  return Math.max(0, Math.floor(clampNumber(profile?.base?.uterineAtony, 0, 99, 0)));
}

/** 乏力让孕期涨上去的上限往回缩：每级 −10%，最低缩回非孕期的上限 */
function applyAtonyToCap(profile, pregnancyCap, baselineCap) {
  const multiplier = Math.max(0, 1 - UTERINE_ATONY_STEP * getUterineAtony(profile));
  return Math.max(baselineCap, Math.round(pregnancyCap * multiplier));
}

export function getLibidoCap(profile) {
  const stage = profile?.base?.stage;
  if (!isTruePregnancyStage(stage)) return 100;
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const months = Math.floor(effectivePregnantDays / 28);
  const progress = Math.max(0, Math.min(10, months)) / 10;
  return applyAtonyToCap(profile, Math.round(100 + (150 - 100) * progress), 100);
}

export function getUterinePressureCap(profile) {
  const stage = profile?.base?.stage;
  if (!isTruePregnancyStage(stage)) return 50;
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const months = Math.floor(effectivePregnantDays / 28);
  const progress = Math.max(0, Math.min(10, months)) / 10;
  return applyAtonyToCap(profile, Math.round(50 + (150 - 50) * progress), 50);
}

function applyHourlyPregnancyMetabolism(profile, tick) {
  const immune = profile?.immune || {};
  if (immune.metabolism) return;
  const stage = String(profile?.base?.stage || '');
  if (!isTruePregnancyStage(stage)) return;
  if (tick.passedHours <= 0) return;

  const pregnant = profile?.pregnant || {};
  const metabolism = profile?.metabolism || {};
  const fetalEnergyDrain = clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 0);
  const delta = (1 + fetalEnergyDrain) * 2 * tick.passedHours;

  if (hasDerivedMetabolism(profile)) {
    const stressMultiplier = clampNumber(1 + ((clampNumber(profile?.base?.psyStress, 0, 200, 100) - 100) / 200), 0.5, 1.5, 1.0);
    const direction = getDerivedFluxDirection(metabolism.flux, 1);
    const acceleration = getActiveAccelerationMultiplier(profile, 'flux', Number(metabolism.flux) || direction);
    const fluxCap = getMetabolismCap(profile, 'flux', Number(metabolism.flux) || direction);
    metabolism.flux = clampNumber((Number(metabolism.flux) || 0) + (delta * stressMultiplier * direction * acceleration), -fluxCap, fluxCap, metabolism.flux || 0);
    profile.metabolism = metabolism;
  }
  addMetabolismValue(profile, 'excretion', delta, 0, 150);
  addMetabolismValue(profile, 'hunger', delta, 0, 150);
  addMetabolismValue(profile, 'sleep', delta, 0, 150);
  applyDerivedMetabolismExemptions(profile);
}

// 供养力分池：每胎各记一个 fetus.nutrition。每次计分当下就按各胎需求拆开，
// 胎位在一周内上下移动时，在宫顶待得越久分得越多，而不是只看结算那一刻停在哪。
// 每点供养力对胎重的对数影响；乘上妊娠变速让各种族整个孕期的总成长一致。
const NUTRITION_WEIGHT_SCALE = 0.0005;
// 单周（按有效孕程）胎重变化上限，同样乘妊娠变速，快孕期种族一周走完多周孕程不被卡住。
const NUTRITION_WEEKLY_CAP = 0.03;
// 越靠宫顶供养越好；亏损时取倒数，宫顶胎受保护、低位胎先亏。
const NUTRITION_POSITION_FACTORS = Object.freeze({ '-3': 1.5, '-2': 1.0, '-1': 0.8, 0: 0.6 });
// 三胎以上时的左右位置：中间最挤、供血被两侧瓜分（窝生哺乳类的实况），两端最好
const NUTRITION_LATERAL_CENTER = 0.9;
const NUTRITION_LATERAL_EDGE = 1.2;

/** 阵列顺序就是子宫内由左至右；被包着的内胎与待着床胚胎不占位置 */
function getLateralNutritionFactor(anchor, fetuses) {
  const occupants = fetuses.filter((fetus) => !fetus?.pendingImplantation && !getEnclosingHost(fetus, fetuses));
  if (occupants.length < 3) return 1;
  const index = occupants.indexOf(anchor);
  if (index < 0) return 1;
  const center = (occupants.length - 1) / 2;
  return NUTRITION_LATERAL_CENTER + ((NUTRITION_LATERAL_EDGE - NUTRITION_LATERAL_CENTER) * Math.abs(index - center)) / center;
}

function getNutritionPositionFactor(fetus, fetuses, surplus) {
  const anchor = getEnclosingHost(fetus, fetuses) || fetus;
  const stage = Number(anchor?.descentStage);
  const vertical = Number.isFinite(stage) ? NUTRITION_POSITION_FACTORS[Math.round(stage)] : 1;
  if (!vertical) return 0;
  const factor = vertical * getLateralNutritionFactor(anchor, fetuses);
  return surplus ? factor : 1 / factor;
}

/**
 * 分配权重 = 自己的孕龄 × 位置。不乘胎重（大胎会越分越多、把既有大小差不断放大），
 * 不乘种族承载差（跨种族负担在受精时已换算进胎重）。待着床的胚胎还没接上供养。
 */
function getNutritionDemand(fetus, fetuses, effectivePregnantDays, surplus) {
  if (fetus?.pendingImplantation) return 0;
  const ownAge = Math.max(0, effectivePregnantDays - clampNumber(fetus?.conceivedAtDays, 0, 9999, 0));
  return ownAge * getNutritionPositionFactor(fetus, fetuses, surplus);
}

function roundNutrition(value) {
  return Math.round(value * 10000) / 10000;
}

/** 母体层面的供养力总额：各胎的加总。prompt 只看这个数，看不到每胎的份额。 */
export function getPregnancyNutritionTotal(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const total = fetuses.reduce((sum, fetus) => sum + (Number(fetus?.nutrition) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** 按计分当下的需求把点数拆给各胎；一胎都接不上供养（全在待着床）时点数作废。 */
function addNutrition(profile, amount) {
  const pregnant = profile?.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const demands = fetuses.map((fetus) => getNutritionDemand(fetus, fetuses, effectivePregnantDays, amount > 0));
  const totalDemand = demands.reduce((sum, value) => sum + value, 0);
  if (!amount || totalDemand <= 0) return 0;
  for (let i = 0; i < fetuses.length; i += 1) {
    if (demands[i] <= 0) continue;
    fetuses[i].nutrition = roundNutrition((Number(fetuses[i].nutrition) || 0) + amount * (demands[i] / totalDemand));
  }
  return amount;
}

/** 周结算：每胎把自己累积的供养力换算成胎重倍率后归零。 */
function applyWeeklyNutrition(profile) {
  const pregnant = profile?.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1);
  const cap = NUTRITION_WEEKLY_CAP * gestationSpeed;
  let changed = false;
  for (const fetus of fetuses) {
    const nutrition = Number(fetus?.nutrition) || 0;
    if (nutrition === 0) continue;
    const delta = clampNumber(nutrition * gestationSpeed * NUTRITION_WEIGHT_SCALE, -cap, cap, 0);
    // 以指数换算：亏空再深也只会逐步变小，不会跌穿成负值
    fetus.weight = clampNumber((Number(fetus.weight) || 1) * Math.exp(delta), 0.33, 3.0, 1);
    fetus.nutrition = 0;
    changed = true;
  }
  return changed;
}

// 足月自然发动：宫压过上限一半先示警，下次推进仍未缓解就进入产兆前驱（applyPressureCrisis；66% 则当下发动）。
// 参数用真实引擎逐日推进校准（人类单胎、剧情完全不碰宫压）：中位 39 周 6 天，九成落在 38 周 5 天～42 周 1 天，
// 约 6% 拖到 42 周；双胎中位约 38 周 5 天、三胎约 38 周 2 天。发动体质抽到下限时约 43 周多也会发动。
// 剧情推高宫压只会更早
const TERM_READINESS_MEDIAN = 2.3;
const TERM_READINESS_SPREAD = 0.5;
// 临产期内每过 14 个有效日，累积速度多一倍；满 42 周后再乘 2
const TERM_PRESSURE_RAMP_DAYS = 14;
const POSTTERM_PRESSURE_MULTIPLIER = 2;

function randomStandardNormal() {
  const u = Math.max(Number.EPSILON, Math.random());
  const v = Math.max(Number.EPSILON, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 长期体质与情绪特质只往早偏移：身体虚弱、长期高压的母体较常提早发动；
// 强健或平稳不会让人明显晚生。「难产体态／安产体态」管生得顺不顺，不管何时发动
const VITALITY_LEVEL_READINESS = Object.freeze({ 1: 1.6, 2: 1.3 });
const PSY_STRESS_LEVEL_READINESS = Object.freeze({ 6: 1.25, 7: 1.5 });

function getTermReadinessAnchor(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  return fetuses.map((fetus) => fetus?.embryoId).find((id) => id !== null && id !== undefined) ?? null;
}

/** 已抽好的发动体质；这次妊娠还没抽时回 null */
function peekTermReadiness(pregnant) {
  const stored = pregnant?.termReadiness;
  if (!stored || typeof stored !== 'object' || !(pregnant.fetuses || []).length) return null;
  const value = Number(stored.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * 这一胎的「发动体质」：每次妊娠抽一次，决定不靠剧情时大概几周发动，抽的当下套上活力与情压等级。
 * 同次妊娠固定；减胎或换位不重抽。结束妊娠由 clearPregnancyState 清除，注册新妊娠也重置。
 */
export function ensureNaturalNoticeSample(profile, config = {}) {
  const pregnant = profile?.pregnant;
  const fetuses = pregnant?.fetuses || [];
  if (!pregnant || !fetuses.some((x) => !x.pendingImplantation) || !isTruePregnancyStage(profile.base?.stage)) return null;
  if (!pregnant.noticeSample) {
    const prior = pregnant.experienceBeforePregnancy || experienceSnapshot(profile.experience, true);
    pregnant.experienceBeforePregnancy = prior;
    pregnant.noticeSample = { z: randomStandardNormal(), vitalityLevel: profile.base?.vitalityLevel,
      psyStressLevel: profile.base?.psyStressLevel, experience: prior, config: normalizeReproductiveSettings(config),
      obstetricOffsetDays: getObstetricPregnancyOffsetDays(profile) * clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1) };
  }
  return pregnant.noticeSample;
}

function getTermReadiness(profile) {
  const pregnant = profile?.pregnant || {};
  const stored = peekTermReadiness(pregnant);
  if (stored !== null) return stored;
  const base = profile?.base || {};
  const levelFactor = (VITALITY_LEVEL_READINESS[Math.round(Number(base.vitalityLevel))] || 1)
    * (PSY_STRESS_LEVEL_READINESS[Math.round(Number(base.psyStressLevel))] || 1);
  const rolled = TERM_READINESS_MEDIAN * Math.exp(TERM_READINESS_SPREAD * randomStandardNormal()) * levelFactor * experienceFactor(pregnant.experienceBeforePregnancy || experienceSnapshot(profile.experience, true), pregnant.noticeSample?.config || normalizeReproductiveSettings(), 'labor');
  const value = clampNumber(rolled, 0.5, 15, TERM_READINESS_MEDIAN);
  pregnant.termReadiness = { embryoId: getTermReadinessAnchor(pregnant), value };
  return value;
}

/**
 * 37 周起宫压按肚子实际装的量自行累积（与衣着压力同一个胎量，不除承载耐受，
 * 否则高耐受的龙娘要拖到 46 周），越接近、越超过预产期累积越快
 */
function applyTermPressure(profile, tick, female) {
  const base = profile?.base || {};
  const stage = String(base.stage || '');
  if ((stage !== '临产期' && stage !== '逾期') || tick.passedDays <= 0) return;

  const pregnant = profile?.pregnant || {};
  const effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1);
  const elapsed = Math.min(tick.passedDays * gestationSpeed, Math.max(0, effectivePregnantDays - TERM_START_DAYS));
  if (elapsed <= 0) return;
  const midpointDays = effectivePregnantDays - elapsed / 2;
  const ramp = 1 + Math.max(0, midpointDays - TERM_START_DAYS) / TERM_PRESSURE_RAMP_DAYS;
  const postTerm = stage === '逾期' ? POSTTERM_PRESSURE_MULTIPLIER : 1;
  const increment = getFetalBulk(profile) * getTermReadiness(profile) * ramp * postTerm * elapsed;
  const pressureCap = getUterinePressureCap(profile);
  base.uterinePressure = clampNumber((base.uterinePressure || 0) + increment, 0, pressureCap, base.uterinePressure || 0);
  profile.base = base;
  if (stage === '逾期') {
    profile.notify = {
      ...(profile.notify || {}),
      secondly: `${female}已逾期，宫缩压力持续增强`,
    };
  }
}

function applyNaturalMetabolismRecovery(profile, tick) {
  const immune = profile?.immune || {};
  const metabolism = profile?.metabolism || {};
  if (immune.metabolism) {
    metabolism.excretion = 0;
    metabolism.hunger = 0;
    metabolism.sleep = 0;
    metabolism.flux = 0;
    metabolism.milk = 0;
    metabolism.odor = 0;
    metabolism.companionship = 0;
    profile.metabolism = metabolism;
    return;
  }
  applyDerivedMetabolismExemptions(profile);

  const passedDays = Math.max(0, tick.passedDays);

  if (hasDerivedMetabolism(profile)) {
    if (passedDays > 0) {
      const fluxCap = getMetabolismCap(profile, 'flux', Number(metabolism.flux) || 0);
      const currentFlux = clampNumber(metabolism.flux, -fluxCap, fluxCap, 0);
      const recovery = 14 * passedDays;
      if (currentFlux > 0) metabolism.flux = Math.max(0, currentFlux - recovery);
      else if (currentFlux < 0) metabolism.flux = Math.min(0, currentFlux + recovery);
      else metabolism.flux = 0;
    }
    profile.metabolism = metabolism;
  }

  if (passedDays <= 0) return;

  const dayExcretionRecovery = 12 * passedDays;
  const dayHungerRecovery = 16 * passedDays;
  const daySleepRecovery = 18 * passedDays;

  metabolism.excretion = isMetabolismExempt(profile, 'excretion') ? 0 : Math.max(0, clampNumber(metabolism.excretion, 0, getMetabolismCap(profile, 'excretion'), 0) - dayExcretionRecovery);
  metabolism.hunger = isMetabolismExempt(profile, 'hunger') ? 0 : Math.max(0, clampNumber(metabolism.hunger, 0, getMetabolismCap(profile, 'hunger'), 0) - dayHungerRecovery);
  metabolism.sleep = isMetabolismExempt(profile, 'sleep') ? 0 : Math.max(0, clampNumber(metabolism.sleep, 0, getMetabolismCap(profile, 'sleep'), 0) - daySleepRecovery);
  applyDerivedMetabolismExemptions(profile);
  profile.metabolism = metabolism;
}

function applyWeeklyMetabolismRoutine(profile, tick, options = {}) {
  if (profile?.immune?.metabolism) return;
  const metabolism = profile.metabolism || {};
  const settledWeeks = Math.max(0, Math.floor(Number(tick.passedLifestyleWeeks) || 0));
  if (settledWeeks > 0) {
    metabolism.odor = 0;
    metabolism.companionship = isMetabolismExempt(profile, 'companionship')
      ? 0
      : Math.max(0, clampNumber(metabolism.companionship, 0, getMetabolismCap(profile, 'companionship'), 0) - (35 * settledWeeks));
  }
  if (options.enteredFollicular && !canProduceMilk({ ...profile, base: { ...(profile.base || {}), stage: options.stage } })) {
    metabolism.milk = 0;
  }
  applyDerivedMetabolismExemptions(profile);
  profile.metabolism = metabolism;
}

function applyMetabolismFromVitality(profile, changeValue) {
  const immune = profile?.immune || {};
  const metabolism = profile?.metabolism || {};
  const base = profile?.base || {};
  if (immune.metabolism || !changeValue) return;

  const stressMultiplier = clampNumber(1 + ((clampNumber(base.psyStress, 0, 200, 100) - 100) / 200), 0.5, 1.5, 1.0);
  const delta = Math.abs(Number(changeValue) || 0) * stressMultiplier;
  if (delta <= 0) return;

  if (hasDerivedMetabolism(profile)) {
    const direction = getDerivedFluxDirection(metabolism.flux, Math.sign(Number(changeValue) || 1));
    const acceleration = getActiveAccelerationMultiplier(profile, 'flux', Number(metabolism.flux) || direction);
    const fluxCap = getMetabolismCap(profile, 'flux', Number(metabolism.flux) || direction);
    metabolism.flux = clampNumber((Number(metabolism.flux) || 0) + (delta * direction * acceleration), -fluxCap, fluxCap, metabolism.flux || 0);
    profile.metabolism = metabolism;
  }

  if (changeValue > 0) {
    addMetabolismValue(profile, 'excretion', delta, 0, 150);
  } else {
    addMetabolismValue(profile, 'hunger', delta, 0, 150);
    addMetabolismValue(profile, 'sleep', delta, 0, 150);
  }
  applyDerivedMetabolismExemptions(profile);
}

function getMetabolismLevel(value, cap = BASE_METABOLISM_CAP) {
  const scale = Math.max(1, Number(cap) || BASE_METABOLISM_CAP) / BASE_METABOLISM_CAP;
  if (value >= 125 * scale) return '爆';
  if (value >= 100 * scale) return '满';
  if (value >= 75 * scale) return '高';
  if (value >= 50 * scale) return '中';
  if (value >= 25 * scale) return '低';
  return '无';
}

function getDerivedFluxLevel(value, cap = BASE_METABOLISM_CAP) {
  return getMetabolismLevel(Math.abs(Number(value) || 0), cap);
}

function getDerivedFluxNeedLabel(value) {
  return (Number(value) || 0) >= 0 ? '正极释放需求' : '负极释放需求';
}

// 供养力只来自需求照料：在「高」时处理到「无」+1，拖到「爆」−1、停在爆每满 24 小时再 −1（点数再按种族归一化）。
// 「满」是中性区；产程中已无周结算，计分到产兆前驱为止。
const NUTRITION_NEED_KEYS = Object.freeze(['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship']);
const NUTRITION_BURST_REPEAT_MINUTES = 24 * 60;

function canScoreNutrition(profile) {
  if (profile?.immune?.metabolism) return false;
  const stage = String(profile?.base?.stage || '');
  if (!PREGNANCY_STAGES.includes(stage) && stage !== '产兆前驱') return false;
  return Array.isArray(profile?.pregnant?.fetuses) && profile.pregnant.fetuses.length > 0;
}

/** 当前参与计分的需求及其等级；flux 按绝对值、按当前极性的容量判定 */
function getNutritionNeedLevels(profile) {
  const metabolism = profile?.metabolism || {};
  const levels = {};
  for (const key of NUTRITION_NEED_KEYS) {
    if (isMetabolismExempt(profile, key)) continue;
    levels[key] = getMetabolismLevel(Number(metabolism[key]) || 0, getMetabolismCap(profile, key));
  }
  if (hasDerivedMetabolism(profile)) {
    const flux = Number(metabolism.flux) || 0;
    levels.flux = getDerivedFluxLevel(flux, getMetabolismCap(profile, 'flux', flux));
  }
  return levels;
}

/**
 * 每次计分的点数先归一化，让不同种族照顾得一样好就得到一样的结果：
 * - 需求项数：衍生类型抵免掉的需求越多，计分机会越少，按 6 项折算；
 * - 加分再除以 (1 + fetalEnergyDrain)：承载力低的母体需求涨得快、处理机会多，
 *   不除的话她反而最容易养出巨胎。扣分按天计，不受需求速度影响，不必再除。
 */
function getNutritionPointScale(levels) {
  const count = Math.max(1, Object.keys(levels).length);
  return NUTRITION_NEED_KEYS.length / count;
}

/**
 * 处理加分：处理前在「高」、处理后降到「无」。
 * 门槛压到「无」是防刷：处理一半就算的话，需求回升周期短，频繁半处理比处理干净更划算。
 * 不需要另存上膛旗标——要再拿一次，需求必须先重新涨回「高」。
 */
function applyNutritionReliefGain(profile, levelsBefore) {
  if (!canScoreNutrition(profile)) return 0;
  const levelsAfter = getNutritionNeedLevels(profile);
  let count = 0;
  for (const [key, before] of Object.entries(levelsBefore)) {
    if (before === '高' && levelsAfter[key] === '无') count += 1;
  }
  if (count === 0) return 0;
  const drain = clampNumber(profile?.pregnant?.fetalEnergyDrain, 0, 9999, 0);
  return addNutrition(profile, count * getNutritionPointScale(levelsAfter) / (1 + drain));
}

/**
 * 进入爆的扣分与来源无关：任何改动需求的操作结束后扫一次。
 * nutritionBurst 是 {需求: 距上次扣分的分钟数}，只记「已扣过、仍停在爆」的需求；
 * 降到爆以下即移除、重新上膛。停在爆的时长由时间推进累加（accrueNutritionBurst）。
 * 不能计分的阶段只同步不扣分，着床当下已在爆的需求因此不会被追扣；
 * 从未同步过（没有 nutritionBurst）的角色第一次也只建档。
 */
function syncNutritionBurst(profile) {
  if (!profile || profile?.immune?.metabolism) return 0;
  const pregnant = profile.pregnant;
  if (!pregnant || typeof pregnant !== 'object') return 0;
  const levels = getNutritionNeedLevels(profile);
  const previous = pregnant.nutritionBurst && typeof pregnant.nutritionBurst === 'object' ? pregnant.nutritionBurst : null;
  const scoring = canScoreNutrition(profile) && previous !== null;
  const next = {};
  let charged = 0;
  for (const key of Object.keys(levels)) {
    if (levels[key] !== '爆') continue;
    if (previous && Object.hasOwn(previous, key)) {
      next[key] = clampNumber(previous[key], 0, NUTRITION_BURST_REPEAT_MINUTES, 0);
    } else {
      next[key] = 0;
      if (scoring) charged += 1;
    }
  }
  pregnant.nutritionBurst = next;
  if (charged === 0) return 0;
  return addNutrition(profile, -charged * getNutritionPointScale(levels));
}

/**
 * 停在爆的时长。只累加推进前就已扣过、推进后仍在爆的需求——
 * 这一轮才冲进爆的，由随后的 syncNutritionBurst 扣第一次并从 0 起算。
 */
function accrueNutritionBurst(profile, deltaMinutes) {
  if (!profile || profile?.immune?.metabolism || !(deltaMinutes > 0)) return 0;
  const pregnant = profile.pregnant;
  const burst = pregnant?.nutritionBurst;
  if (!burst || typeof burst !== 'object') return 0;
  const levels = getNutritionNeedLevels(profile);
  const scoring = canScoreNutrition(profile);
  let charged = 0;
  for (const key of Object.keys(burst)) {
    if (levels[key] !== '爆') continue;
    let minutes = clampNumber(burst[key], 0, NUTRITION_BURST_REPEAT_MINUTES, 0) + deltaMinutes;
    const repeats = Math.floor(minutes / NUTRITION_BURST_REPEAT_MINUTES);
    minutes -= repeats * NUTRITION_BURST_REPEAT_MINUTES;
    burst[key] = minutes;
    if (scoring) charged += repeats;
  }
  if (charged === 0) return 0;
  return addNutrition(profile, -charged * getNutritionPointScale(levels));
}

function syncAllNutritionBurst(chatState) {
  for (const character of Object.values(chatState?.characters || {})) {
    if (character?.profile) syncNutritionBurst(character.profile);
  }
}

function updateAdvisoryNotify(profile, female) {
  const notify = profile?.notify || {};
  const metabolism = profile?.metabolism || {};
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const needs = [];

  const excretionLevel = getMetabolismLevel(metabolism.excretion, getMetabolismCap(profile, 'excretion'));
  const hungerLevel = getMetabolismLevel(metabolism.hunger, getMetabolismCap(profile, 'hunger'));
  const sleepLevel = getMetabolismLevel(metabolism.sleep, getMetabolismCap(profile, 'sleep'));
  const milkLevel = getMetabolismLevel(metabolism.milk, getMetabolismCap(profile, 'milk'));
  const odorLevel = getMetabolismLevel(metabolism.odor, getMetabolismCap(profile, 'odor'));
  const companionshipLevel = getMetabolismLevel(metabolism.companionship, getMetabolismCap(profile, 'companionship'));
  const maybePushNeed = (key, label, level) => {
    if (!isMetabolismExempt(profile, key) && ['高', '满', '爆'].includes(level)) needs.push(`${label}:${level}`);
  };

  maybePushNeed('excretion', '泄意', excretionLevel);
  maybePushNeed('hunger', '饿意', hungerLevel);
  maybePushNeed('sleep', '困意', sleepLevel);
  maybePushNeed('milk', '乳意', milkLevel);
  maybePushNeed('odor', '臭意', odorLevel);
  maybePushNeed('companionship', '伴意', companionshipLevel);

  const reminders = [];
  if (hasDerivedMetabolism(profile)) {
    const fluxCap = getMetabolismCap(profile, 'flux', Number(metabolism.flux) || 0);
    const flux = clampNumber(metabolism.flux, -fluxCap, fluxCap, 0);
    if (Math.abs(flux) >= 75) {
      reminders.push(`${female}的${getDerivedFluxNeedLabel(flux)}已达到${getDerivedFluxLevel(flux, fluxCap)}，应优先使用 bsExcreteMetabolism 进行解放；若释放量足够大，需求极性才会跨过 0 翻转`);
    }
    if (needs.length > 0) {
      reminders.push(`${female}仍有未被衍生代谢抵免的生理需求（${needs.join('、')}），可用 bsExcreteMetabolism 处理`);
    }
  } else if (needs.length > 0) {
    reminders.push(`${female}有强烈的生理需求（${needs.join('、')}），应优先使用 bsExcreteMetabolism 缓解生理不适`);
  }
  if (!isMetabolismExempt(profile, 'companionship') && ['高', '满', '爆'].includes(companionshipLevel)) {
    reminders.push(odorLevel === '高' || odorLevel === '满' || odorLevel === '爆'
      ? `${female}渴望陪伴，但当前臭意会妨碍社交舒适度；清洁后再给予陪伴或安抚更有效`
      : `${female}渴望陪伴，可优先给予陪伴、交流或安抚`);
  }
  if (canScoreNutrition(profile)) {
    const levels = getNutritionNeedLevels(profile);
    if (Object.values(levels).includes('高')) {
      reminders.push(`${female}有需求正处于「高」：趁现在彻底处理能为胎儿补充供养力，拖到「爆」则会流失`);
    }
  }

  const stage = String(base.stage || '');
  if (['临产期', '逾期', '延产期', '产兆前驱', '第一产程', '第二产程'].includes(stage)) {
    const amnion = clampNumber(getPresentingAmnionDurability(pregnant), -100, 100, 0);
    if (amnion > 0) {
      // 陈述句会被当成背景资讯忽略，必须写成禁令：设定上产程前羊膜恒不破，
      // 模型却很常自行写出破水，导致叙事与系统状态脱节。
      // 但只在真的能破水的阶段才指向工具——临产期／逾期调用必被拒，
      // 提示它去调等于教它做一件必定失败的事。
      const canRupture = RUPTURE_ALLOWED_PRELABOR_STAGES.includes(stage) || ['第一产程', '第二产程'].includes(stage);
      reminders.push(canRupture
        ? `${female}尚未破水（膜耐性还有${Math.round(amnion)}%）：禁止描写破水、羊水流出或羊膜破裂。若剧情确实需要破水，必须先调用 bsAssistFetalPosition（action=rupture），成功后才可如此描写`
        : stage === '延产期'
          ? `${female}正在延产期（膜耐性还有${Math.round(amnion)}%）：禁止描写破水、羊水流出、羊膜破裂或分娩发动。延产期间无法破水，也不会自然发动；剧情要结束延产，必须先调用 bsExtendPregnancy（action=induce）引产进入产兆前驱`
          : `${female}尚未破水（膜耐性还有${Math.round(amnion)}%）：禁止描写破水、羊水流出或羊膜破裂。此阶段无法破水，必须先进入产兆前驱`);
    } else if (stage !== '第三产程') {
      reminders.push(`${female}已破水`);
    }
  }
  // 与破水同理写成禁令：第二产程前旁白很常一口气写完分娩，系统只能事后补记
  if (['临产期', '逾期', '产兆前驱', '第一产程'].includes(stage)) {
    reminders.push(`${female}尚未进入第二产程：禁止描写胎儿娩出或生下孩子。若剧情已经写出自然分娩，以 bsChildbirth（mode=natural）同步`);
  }

  if (stage === '产兆前驱') {
    reminders.push(Boolean(profile?.immune?.realisticLabor)
      ? `${female}正处于产兆前驱阶段；若剧情明确把胎儿往上托，可用 bsAssistFetalPosition（action=lift）延后分娩，需要足够活力；真实产程下分娩只能延后、无法取消，累计延后到上限后必然进入产程`
      : `${female}正处于产兆前驱阶段；若剧情明确把胎儿往上托，可用 bsAssistFetalPosition（action=lift）延后分娩，需要足够活力`);
  }

  profile.notify = {
    ...notify,
    thirdly: reminders.join('；'),
  };
}

function applyAmnionDurabilityFromPressure(profile, finalPressure, female) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const stage = String(base.stage || '');
  if (!PREGNANCY_STAGES.includes(stage)) return;

  const pressureCap = getUterinePressureCap(profile);
  const warningThreshold = pressureCap * 0.33;
  if (finalPressure <= warningThreshold) return;

  // 随机抽一个实际胎囊受损；多胎的总负担一起压在它上面，胎数越多扣得越重。
  // 产程前任何磨损都只让羊膜变薄，不会磨穿
  const sacs = getAmnionSacs(pregnant);
  if (sacs.length > 0) {
    const sac = sacs[Math.min(sacs.length - 1, Math.floor(Math.random() * sacs.length))];
    const drain = Math.max(1, clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 1));
    setSacDurability(sac, Math.max(1, getSacDurability(sac) - drain));
  }
  profile.pregnant = pregnant;

  const notify = profile.notify || {};
  if (stage === '孕早期' || stage === '孕中期') {
    notify.secondly = `${female}子宫压力过高，有流产风险`;
  } else if (stage === '延产期') {
    notify.secondly = `${female}子宫压力升高，但延产手段压住了宫缩，不会因此发动`;
  } else {
    notify.secondly = `${female}子宫收缩强烈，即将生产`;
  }
  profile.notify = notify;
}

function applyExcreteMetabolism(chatState, args) {
  const female = String(args?.female || '').trim();
  const options = args?.options && typeof args.options === 'object' ? args.options : {};
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsExcreteMetabolism skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const metabolism = profile.metabolism || {};
  const notify = profile.notify || {};
  const immune = profile.immune || {};
  if (immune.metabolism) return { applied: false, message: `bsExcreteMetabolism skipped for ${female}: metabolism immune.` };
  applyDerivedMetabolismExemptions(profile);
  applyMetabolismCapacityLimits(profile);
  const nutritionLevelsBefore = getNutritionNeedLevels(profile);

  const isDerived = hasDerivedMetabolism(profile);
  const hasOptions = Object.keys(options).length > 0;
  const wantsFluxRelease = isDerived && (!hasOptions || options.flux !== undefined);
  if (wantsFluxRelease) {
    const fluxCap = getMetabolismCap(profile, 'flux', Number(metabolism.flux) || 0);
    const currentFlux = clampNumber(metabolism.flux, -fluxCap, fluxCap, 0);
    const direction = getDerivedFluxDirection(currentFlux, 1);
    const blockageRetention = getActiveBlockageRetention(profile, currentFlux > 0 ? 'fluxPositive' : 'fluxNegative', currentFlux);
    const releasePower = applyRetention(options.flux !== undefined ? Math.max(0, Number(options.flux) || 0) : 40, blockageRetention);
    metabolism.flux = clampNumber(currentFlux - (direction * releasePower), -fluxCap, fluxCap, currentFlux);
    profile.metabolism = metabolism;
    const nextFlux = clampNumber(metabolism.flux, -fluxCap, fluxCap, 0);
    const didFlip = currentFlux !== 0 && Math.sign(currentFlux) !== Math.sign(nextFlux) && nextFlux !== 0;
    profile.notify = {
      ...notify,
      secondly: didFlip
        ? `${female}完成了一次${direction > 0 ? '正极' : '负极'}解放，需求强度被压过头，极性翻转为${nextFlux > 0 ? '正极' : '负极'}`
        : `${female}完成了一次${direction > 0 ? '正极' : '负极'}解放，当前需求降为 ${Math.round(nextFlux)}`,
    };
  }

  const currentExcretion = clampNumber(metabolism.excretion, 0, getMetabolismCap(profile, 'excretion'), 0);
  const currentHunger = clampNumber(metabolism.hunger, 0, getMetabolismCap(profile, 'hunger'), 0);
  const currentSleep = clampNumber(metabolism.sleep, 0, getMetabolismCap(profile, 'sleep'), 0);
  const currentMilk = clampNumber(metabolism.milk, 0, getMetabolismCap(profile, 'milk'), 0);
  const currentOdor = clampNumber(metabolism.odor, 0, getMetabolismCap(profile, 'odor'), 0);
  const currentCompanionship = clampNumber(metabolism.companionship, 0, getMetabolismCap(profile, 'companionship'), 0);

  const optionReduction = (key, fallback = 0) => Math.max(0, options[key] !== undefined ? Number(options[key]) || 0 : fallback);
  const useDefaults = !hasOptions && !isDerived;
  const excretionReduction = isMetabolismExempt(profile, 'excretion') ? 0 : optionReduction('excretion', useDefaults ? 30 : 0);
  const hungerReduction = isMetabolismExempt(profile, 'hunger') ? 0 : optionReduction('hunger', useDefaults ? 40 : 0);
  const sleepReduction = isMetabolismExempt(profile, 'sleep') ? 0 : optionReduction('sleep', useDefaults ? 40 : 0);
  const milkReduction = isMetabolismExempt(profile, 'milk') ? 0 : optionReduction('milk', useDefaults ? 30 : 0);
  const odorReduction = isMetabolismExempt(profile, 'odor') ? 0 : optionReduction('odor');
  const companionshipReduction = isMetabolismExempt(profile, 'companionship') ? 0 : optionReduction('companionship');

  const relievedExcretion = Math.min(currentExcretion, applyRetention(excretionReduction, getActiveBlockageRetention(profile, 'excretion')));
  const relievedHunger = Math.min(currentHunger, applyRetention(hungerReduction, getActiveBlockageRetention(profile, 'hunger')));
  const relievedSleep = Math.min(currentSleep, applyRetention(sleepReduction, getActiveBlockageRetention(profile, 'sleep')));
  const relievedMilk = Math.min(currentMilk, applyRetention(milkReduction, getActiveBlockageRetention(profile, 'milk')));
  const relievedOdor = Math.min(currentOdor, applyRetention(odorReduction, getActiveBlockageRetention(profile, 'odor')));
  const remainingOdor = Math.max(0, currentOdor - relievedOdor);
  const companionshipRelief = applyRetention(companionshipReduction, getActiveBlockageRetention(profile, 'companionship'))
    * getOdorCompanionshipReliefMultiplier(remainingOdor);
  const relievedCompanionship = Math.min(currentCompanionship, companionshipRelief);

  metabolism.excretion = Math.max(0, currentExcretion - relievedExcretion);
  metabolism.hunger = Math.max(0, currentHunger - relievedHunger);
  metabolism.sleep = Math.max(0, currentSleep - relievedSleep);
  metabolism.milk = Math.max(0, currentMilk - relievedMilk);
  metabolism.odor = isMetabolismExempt(profile, 'odor') ? 0 : remainingOdor;
  metabolism.companionship = isMetabolismExempt(profile, 'companionship') ? 0 : Math.max(0, currentCompanionship - relievedCompanionship);

  addMetabolismValue(profile, 'excretion', relievedHunger * 0.5, 0, 150);
  addMetabolismValue(profile, 'sleep', relievedHunger * 0.1, 0, 150);
  addMetabolismValue(profile, 'hunger', relievedSleep * 0.1, 0, 150);
  applyOdorGain(profile, (relievedExcretion * 0.12) + (canProduceMilk(profile) ? relievedMilk * 0.05 : 0));
  for (const [key, amount] of [
    ['excretion', relievedExcretion],
    ['hunger', relievedHunger],
    ['sleep', relievedSleep],
    ['milk', relievedMilk],
    ['odor', relievedOdor],
    ['companionship', relievedCompanionship],
  ]) {
    applyAccelerationRebound(profile, key, amount);
  }
  applyDerivedMetabolismExemptions(profile);

  profile.metabolism = metabolism;
  applyNutritionReliefGain(profile, nutritionLevelsBefore);
  updateAdvisoryNotify(profile, female);
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsExcreteMetabolism applied to ${female}.` };
}

function clearPregnancyState(profile) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  delete pregnant.noticeSample;
  delete pregnant.experienceBeforePregnancy;
  delete pregnant.termReadiness;
  base.fertilizationDays = 0;
  base.uterinePressure = 0;
  pregnant.pregnantDays = 0;
  pregnant.effectivePregnantDays = 0;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborBirthNumber = 0;
  pregnant.deliveredCount = 0;
  pregnant.extensionCount = 0;
  pregnant.extensionUntilDays = null;
  pregnant.presentingEmbryoId = null;
  pregnant.laborPain = 0;
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
  // 回归期被中断（流产／堕胎）时也要清掉，否则残留的进度会继续驱动孕服压力
  delete pregnant.wombReturn;
  pregnant.fetuses = [];
  pregnant.fetusesCount = 0;
  pregnant.fetalEnergyDrain = 0;
  pregnant.blockage = null;
  pregnant.acceleration = null;
  pregnant.expansion = null;
  profile.base = base;
  profile.pregnant = pregnant;
}

function appendChildrenFromFetuses(profile, fetuses) {
  const children = Array.isArray(profile.children) ? profile.children.map((item) => ({ ...item })) : [];
  const base = profile.base || {};
  const motherDerivedType = base.derivedType ? String(base.derivedType) : null;
  for (const fetus of fetuses) {
    const progress = clampNumber(fetus?.maternalDerivedTypeProgress, -100, 100, 0);
    const fatherDerivedType = fetus?.fatherDerivedType ? String(fetus.fatherDerivedType) : null;
    let childDerivedType = null;

    if (progress > DERIVED_INHERITANCE_THRESHOLD && motherDerivedType) {
      childDerivedType = motherDerivedType;
    }
    if (progress < -DERIVED_INHERITANCE_THRESHOLD && fatherDerivedType) {
      childDerivedType = fatherDerivedType;
    }

    // 代孕／寄生：孩子不属于承载者，但先如实记下并标注 provider。
    // 之前是直接 continue 跳过，孩子记录会凭空消失——承载者不得、提供者也没有。
    // 之后由 transferProviderChildren 在拿得到 chatState 的层级转交给 provider。
    const provider = fetus?.provider === null || fetus?.provider === undefined
      ? null
      : String(fetus.provider).trim() || null;
    children.push({
      id: createChildId(),
      name: null,
      fathers: String(fetus?.fathers || '未知'),
      provider,
      providerSources: Array.isArray(fetus?.providerSources) ? [...fetus.providerSources] : [],
      chimera: fetus?.chimera ? cloneValue(fetus.chimera) : null,
      tags: sanitizeFetusTagList(fetus?.tags),
      identicalGroup: Number.isFinite(Number(fetus?.identicalGroup)) ? Number(fetus.identicalGroup) : null,
      // 孕中孕：出生时把「宿主胎儿的 embryoId」换成宿主孩子的稳定 id。
      // 产程是一胎一胎娩出的，宿主可能比被套的那胎晚出来，所以先记编号，
      // 等两边都进了 children 再解析（linkNestedChildren）。
      birthEmbryoId: Number.isFinite(Number(fetus?.embryoId)) ? Number(fetus.embryoId) : null,
      nestedInEmbryoId: Number.isFinite(Number(fetus?.nestedInEmbryoId)) ? Number(fetus.nestedInEmbryoId) : null,
      nestedInChildId: null,
      gender: String(fetus?.gender || '未知'),
      race: String(fetus?.race || '未知'),
      ...getBloodlineInfo(fetus?.race || '未知', fetus?.bloodline, fetus?.bloodlineSource),
      // 父系种族在胎儿上本来就有，此前分娩时被丢掉，血缘图便无从得知路人父亲的血统
      fatherRace: fetus?.fatherRace ? String(fetus.fatherRace) : null,
      fatherBloodline: fetus?.fatherBloodline ? cloneValue(fetus.fatherBloodline) : null,
      fatherBloodlineSource: fetus?.fatherBloodlineSource || null,
      fatherDerivedType: fetus?.fatherDerivedType ? String(fetus.fatherDerivedType) : null,
      derivedType: childDerivedType,
      age: 0,
      birthWeightRatio: clampNumber(fetus?.weight, 0.33, 3.0, 1.0),
      // 伴生卵只留下出生背景；无论几枚，祖谱仍只新增这一名有效后代。
      birthCompanionEggCount: getCompanionEggCount(fetus),
      birthAffinity: clampNumber(fetus?.affinity, -50, 50, 0),
      talents: normalizeTalentList(fetus?.talents),
    });
  }
  profile.children = children;
  linkNestedChildren(profile);
}

/**
 * 把孕中孕孩子的 nestedInEmbryoId 解析成宿主孩子的稳定 id。
 * embryoId 在同一母体内永不重用。
 */
function linkNestedChildren(profile) {
  const children = Array.isArray(profile?.children) ? profile.children : [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!child?.nestedInEmbryoId || child.nestedInChildId) continue;
    for (let back = children.length - 1; back >= 0; back -= 1) {
      if (back === index) continue;
      if (children[back]?.birthEmbryoId !== child.nestedInEmbryoId) continue;
      child.nestedInChildId = children[back].id || null;
      break;
    }
  }
}

/**
 * 把代孕／寄生产下的孩子转交给 provider。
 *
 * 分娩逻辑只拿得到单一角色的 profile，无法写进别人的资料，
 * 所以先把孩子留在承载者名下并标注 provider，再由这里（有 chatState）转交。
 * provider 尚未注册时保留在承载者名下且保留标记，等对方注册后仍可辨认，
 * 总之不能像先前那样直接丢弃。
 */
function transferProviderChildren(chatState) {
  const characters = chatState?.characters;
  if (!characters || typeof characters !== 'object') return;
  for (const [hostName, host] of Object.entries(characters)) {
    const children = Array.isArray(host?.profile?.children) ? host.profile.children : null;
    if (!children || children.length === 0) continue;
    const kept = [];
    let moved = false;
    for (const child of children) {
      const providerSources = uniqueNonEmptyStrings(child?.providerSources);
      // 多母源嵌合体默认登记在孕育者名下，只允许之后手动转移给其中一位母源。
      if (providerSources.length > 1) {
        kept.push(child);
        continue;
      }
      const provider = providerSources[0] || String(child?.provider || '').trim();
      const target = provider && provider !== hostName ? characters[provider] : null;
      if (!target?.profile) {
        kept.push(child);
        continue;
      }
      // 已经在正确的人名下，不必再留 provider 标记
      const { provider: _ignored, providerSources: _sources, ...received } = child;
      target.profile.children = [...(Array.isArray(target.profile.children) ? target.profile.children : []), received];
      moved = true;
    }
    if (moved) host.profile.children = kept;
  }
}

function resolveLaborStageHours(stage, fetusesCount, birthDifficulty) {
  const safeCount = Math.max(1, fetusesCount);
  const baseHours = LABOR_STAGE_BASE_HOURS[stage] || 0;
  const increment = LABOR_STAGE_INCREMENT[stage] || 0;
  return (baseHours + ((safeCount - 1) * increment)) * birthDifficulty;
}

function applyChildbirthInternal(profile, female, isNatural) {
  const pregnant = profile.pregnant || {};
  const base = profile.base || {};
  const notify = profile.notify || {};
  // 生出来了就没有藏的余地
  revealSuperfetationFetuses(profile, female, null, { force: true });
  const experience = profile.experience || {};
  const runtime = profile.__runtimeRef || null;
  const remainingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((item) => ({ ...item })) : [];
  const companionEggs = remainingFetuses.reduce((sum, fetus) => sum + getCompanionEggCount(fetus), 0);
  const companionNote = companionEggs > 0 ? `，并排出${companionEggs}枚伴生卵` : '';
  if (remainingFetuses.length > 0) appendChildrenFromFetuses(profile, remainingFetuses);
  const recoveryDays = settlePostpartumRecoveryDays(profile);
  clearPregnancyState(profile);
  if (runtime) restorePregnancyPhysiology(profile, runtime);
  assignPostpartumRecoveryDays(profile, recoveryDays);
  base.stage = '产后恢复';
  base.days = 0;
  experience.naturalBirthExperience = clampNumber(experience.naturalBirthExperience, 0, 999, 0) + (isNatural ? 1 : 0);
  experience.surgicalBirthExperience = clampNumber(experience.surgicalBirthExperience, 0, 999, 0) + (isNatural ? 0 : 1);
  profile.experience = experience;
  profile.notify = {
    ...notify,
    firstly: `${female}进入了产后恢复`,
    secondly: remainingFetuses.length > 0
      ? (isNatural
        ? `${female}自然分娩，生下了${remainingFetuses.length}个孩子${companionNote}`
        : `${female}通过手术分娩，生下了${remainingFetuses.length}个孩子${companionNote}`)
      : (isNatural
        ? `${female}完成了自然分娩，进入产后恢复`
        : `${female}完成了手术分娩，进入产后恢复`),
  };
  profile.base = base;
  return true;
}

// ── 孕中孕的空间关系 ─────────────────────────────────
// nestedInEmbryoId 记的是血缘（内胎的母亲是宿主），永远保留给族谱用。
// 空间上是否还在宿主体内另看 nestedReleased：内胎胎囊破了，就代表宿主在母体宫内
// 把它生了出来，从此成为独立胎儿、自己竞争先露；没破的话两胎一起娩出。

/** 内胎仍包在宿主体内时回传宿主；已被生出（胎囊破）或宿主已不在时回传 null */
function getEnclosingHost(fetus, fetuses) {
  const hostId = fetus?.nestedInEmbryoId;
  if (hostId === undefined || hostId === null || fetus?.nestedReleased) return null;
  return fetuses.find((candidate) => candidate?.embryoId === hostId) || null;
}

// ── 下降阶段 ─────────────────────────────────────────
// fetus.descentStage 是粗粒度的空间深度，阶段内的连续位置由产程进度派生，不另存：
// -3 宫顶、-2 宫内自由、-1 子宫低位、0 入盆、1 进入产道、2 着冠、3 先露部已出。
const DESCENT_TOP = -3;
const DESCENT_START = -2;
const DESCENT_LOW = -1;
const DESCENT_INLET = 0;
const DESCENT_CROWNED_OUT = 3;

/**
 * 母体阶段决定一般胎儿最多能降到哪里（上限，不是固定值）。
 * 孕期各阶段都只到子宫低位，产兆前驱起才能入盆，第二产程才进产道。
 * 异期胎的「自身孕龄上限」在孕期同样是 -1，与母体上限一致，因此不另算。
 */
function getDescentCap(stage) {
  if (stage === '第二产程' || stage === '第三产程') return DESCENT_CROWNED_OUT;
  if (stage === '产兆前驱' || stage === '第一产程') return DESCENT_INLET;
  return DESCENT_LOW;
}

function getDescentStage(fetus) {
  const value = Number(fetus?.descentStage);
  return Number.isFinite(value) ? value : DESCENT_START;
}

// ── 真实分娩模式的硬阻塞 ─────────────────────────────
// 只在真实分娩模式成立；关闭时不建立、也不保留任何会让产程停住的结构性阻塞。
// 结果是结构化的 { type, embryoIds, message, hardBlock }，通知、调试、助产工具与未来 SVG 共用。
const OBSTRUCTION_STAGES = Object.freeze(['产兆前驱', '第一产程', '第二产程']);
/** 病理性双胎同时入盆的门槛 */
const INLET_INTRUSION_WEIGHT_RATIO = 0.85;
const INLET_INTRUSION_PRESSURE_RATIO = 0.66;
/** 构型成立时，第二胎每次往下挤真的卡进入口形成互锁的机率 */
const INLET_INTRUSION_CHANCE = 0.2;

/** 各类硬阻塞可用的助产解法，写进难产警示 */
const OBSTRUCTION_ADVICE = Object.freeze({
  transverse: '可用 bsAssistFetalPosition（action=rotate）把胎儿转成头位或臀位，',
  twin_lock: '可用 bsAssistFetalPosition（action=rotate）把其中一胎小幅转开解开互锁（两胎都已入盆，最多转 30°，例如头位那胎转到 targetAngle=30），',
  shoulder_dystocia: '可用 bsAssistFetalPosition（action=rotate）转动肩部或（action=extract）助产拉出，',
});

function isRealisticLabor(profile) {
  return Boolean(profile?.immune?.realisticLabor);
}

/** 横位只对胎生与卵胎生构成硬阻塞；其余胚型的横位只影响难度（calculatePositionDifficulty） */
function isHardTransverse(fetus) {
  const embryoType = String(fetus?.embryoType || '胎生');
  if (embryoType !== '胎生' && embryoType !== '卵胎生') return false;
  return isTransversePosition(Number.isFinite(Number(fetus?.tendencyAngle)) ? fetus.tendencyAngle : 0);
}

/**
 * 双胎互锁（locked twins）只有一种构型：先露胎臀位先下来、第二胎头位，两个下巴互相勾住。
 * 反过来（先露头位、第二胎臀位）不算，第二胎只会在子宫低位等候
 */
function isLockedTwins(presenting, second) {
  if (isShelledAtBirth(presenting) || isShelledAtBirth(second)) return false;
  const lead = Number.isFinite(Number(presenting?.tendencyAngle)) ? wrapAngle(presenting.tendencyAngle) : 0;
  const breech = lead >= 165 && lead <= 195;
  return breech && isHeadPresentation(second);
}

function isHeadPresentation(fetus) {
  const angle = Number.isFinite(Number(fetus?.tendencyAngle)) ? wrapAngle(fetus.tendencyAngle) : 0;
  return angle <= 15 || angle >= 345;
}

/** 正要通过入口的那一胎：已锁定的先露胎、前驱领头胎儿，否则是最深者 */
function getInletCandidate(profile, active) {
  const pregnant = profile.pregnant;
  return active.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId)
    || active.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId)
    || pickDeepestFetus(active);
}

function getFreeFetuses(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  return fetuses.filter((fetus) => !fetus?.pendingImplantation && !getEnclosingHost(fetus, fetuses));
}

/**
 * 当前的硬阻塞（依位置、角度与胚型判定，不另掷骰）：
 * - shoulder_dystocia：先露胎已在 3 并留下肩难产标记，直到助产或手术产处理。
 * - twin_lock：臀位先露胎在入口 0，头位的第二胎病理性挤进来与它下巴互勾；不会自己解开，只能转开或手术产。
 * - transverse：正要通过入口的胎儿（<=0）为胎生／卵胎生横位，只能停在子宫低位。
 */
export function getLaborObstruction(profile) {
  if (!isRealisticLabor(profile)) return null;
  // 离场没人能助产或手术产：硬阻塞一律不成立，产程自己走完；回场后恢复判定
  if (profile?.base?.isHere === false) return null;
  if (!OBSTRUCTION_STAGES.includes(String(profile?.base?.stage || ''))) return null;
  const pregnant = profile.pregnant || {};
  const active = getFreeFetuses(pregnant);
  if (active.length === 0) return null;
  const presenting = active.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId) || null;

  if (presenting?.shoulderDystocia) {
    return { type: 'shoulder_dystocia', embryoIds: [presenting.embryoId], message: '胎头已出但肩部卡住（肩难产）', hardBlock: true };
  }
  const intruder = active.find((fetus) => fetus.inletIntruder && getDescentStage(fetus) === DESCENT_INLET);
  if (intruder && presenting && getDescentStage(presenting) === DESCENT_INLET && isLockedTwins(presenting, intruder)) {
    return {
      type: 'twin_lock',
      embryoIds: [presenting.embryoId, intruder.embryoId],
      message: '臀位的先露胎与头位的另一胎在骨盆入口互锁',
      hardBlock: true,
    };
  }
  const candidate = getInletCandidate(profile, active);
  if (candidate && getDescentStage(candidate) <= DESCENT_INLET && isHardTransverse(candidate)) {
    return { type: 'transverse', embryoIds: [candidate.embryoId], message: '领头的胎儿呈横位，无法入盆', hardBlock: true };
  }
  return null;
}

/**
 * 肩难产：真实模式、胎生头位的先露胎刚到 3，宫压已达上限而活力归零。
 * 条件缺一不成立；成立后留下持久标记，普通时间推进不会移除胎儿或新增孩子。
 */
function isShoulderDystocia(profile, fetus) {
  if (!isRealisticLabor(profile) || fetus?.shoulderRelieved) return false;
  if (profile?.base?.isHere === false) return false;
  if (String(fetus?.embryoType || '胎生') !== '胎生' || !isHeadPresentation(fetus)) return false;
  if (getDescentStage(fetus) !== DESCENT_CROWNED_OUT) return false;
  const pressureCap = getUterinePressureCap(profile);
  if (clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) < pressureCap) return false;
  return clampNumber(profile?.base?.vitality, 0, 9999, 100) <= 0;
}

const DESCENT_STAGE_TEXT = Object.freeze({
  '-3': '顶到宫顶', '-2': '宫内自由', '-1': '子宫低位', 0: '入盆', 1: '进入产道', 2: '着冠', 3: '先露部已出',
});

/**
 * 给提示词与追踪页用的紧凑位置文字；数值、座标与内部编号都不外露。
 * 卡住的状况直接写进文字，让叙事知道这一胎现在动不了。
 */
export function describeFetalPosition(pregnant, fetus) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  if (fetus?.pendingImplantation) return '待着床';
  if (getEnclosingHost(fetus, fetuses)) return '在宿主胎儿体内';
  if (fetus?.shoulderDystocia) return '先露部已出，肩部卡住';
  const depth = getDescentStage(fetus);
  if (fetus?.inletIntruder && depth === DESCENT_INLET) return '与另一胎在入口互锁';
  return DESCENT_STAGE_TEXT[depth] || '宫内自由';
}

/** 下降最深者；同值取 embryoId 较小者（稳定、与阵列顺序无关） */
function pickDeepestFetus(fetuses) {
  if (fetuses.length === 0) return null;
  return fetuses.reduce((best, fetus) => (
    getDescentStage(fetus) > getDescentStage(best)
    || (getDescentStage(fetus) === getDescentStage(best) && Number(fetus.embryoId) < Number(best.embryoId))
      ? fetus : best
  ));
}

/**
 * 产兆前驱的领头胎儿：进入前驱时选定并记在 prodromalLeadEmbryoId，
 * 中途不因别的胎儿刚好也降到低位就换人；原本那胎不在了才重选。
 */
function getProdromalLead(profile, active) {
  const pregnant = profile.pregnant;
  const current = active.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId);
  if (current) return current;
  const lead = pickDeepestFetus(active);
  pregnant.prodromalLeadEmbryoId = lead ? lead.embryoId : null;
  return lead;
}

/**
 * 产兆前驱的助产位置带是 -2 → -1 → 0，每一格对应初始前驱时长 T 的一半：
 * 剩余 > T 为 -2（被托高过）、T/2~T 为 -1、<= T/2 入盆。
 * 托高／促降（bsAssistFetalPosition）只需把剩余时间加减 T/2，位置自然跟着一致。
 */
function getProdromalLeadDescent(profile) {
  const initialHours = getProdromalInitialHours(profile);
  const remaining = clampNumber(profile?.pregnant?.prodromalRemainingHours, 0, 9999, initialHours);
  if (remaining > initialHours) return DESCENT_START;
  if (remaining > initialHours / 2) return DESCENT_LOW;
  return DESCENT_INLET;
}

/**
 * 所有位置变更后都要经过这里，维持空间不变量：
 * 1. 待着床的胚胎没有位置；包在宿主体内的内胎与宿主同步。
 * 2. 其余胎儿夹在 [-3, 母体阶段上限]，缺值者从 -2（宫内自由）起算。
 * 3. 有胎儿到达入口（>=0）而尚无先露胎时，锁定下降最深者（同值取 embryoId 较小者）。
 * 4. 入口以后（>=0）只容先露胎一胎；其他越界者退回子宫低位 -1。
 *    病理性的双胎同时入盆由 F 步的硬阻塞判定另行开放。
 */
function reconcileFetalDescent(profile) {
  const pregnant = profile?.pregnant;
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return;
  gatherSharedSacs(fetuses);
  const stage = String(profile?.base?.stage || '');
  const cap = getDescentCap(stage);

  const realistic = isRealisticLabor(profile);

  const active = [];
  for (const fetus of fetuses) {
    if (fetus?.pendingImplantation) {
      delete fetus.descentStage;
      continue;
    }
    if (getEnclosingHost(fetus, fetuses)) continue;
    fetus.descentStage = Math.max(DESCENT_TOP, Math.min(cap, Math.round(getDescentStage(fetus))));
    active.push(fetus);
  }

  if (stage === '产兆前驱') {
    // 领头胎儿的位置由前驱剩余时间推导；其余胎儿在前驱期最多到子宫低位，不跟它抢入口
    const lead = getProdromalLead(profile, active);
    if (lead) lead.descentStage = getProdromalLeadDescent(profile);
    for (const fetus of active) {
      if (fetus !== lead && fetus.embryoId !== pregnant.presentingEmbryoId) fetus.descentStage = Math.min(fetus.descentStage, DESCENT_LOW);
    }
  } else if ((stage === '第一产程' || (stage === '第二产程' && pregnant.laborPhase === '间歇期'))
    && !active.some((fetus) => fetus.descentStage >= DESCENT_INLET)) {
    // 第一产程没有胎儿在入口（例如前驱早段破水），或多胎间歇期上一胎刚出生时，
    // 由最深的胎儿入盆，下一胎从入口开始下降，不直接继承上一胎的进度
    const deepest = pickDeepestFetus(realistic ? active.filter((fetus) => !isHardTransverse(fetus)) : active);
    if (deepest) deepest.descentStage = DESCENT_INLET;
  }

  if (!realistic) {
    // 关闭真实分娩模式：清掉结构性阻塞的标记，不移动任何胎儿（多出来的入口占用由容量规则收回）
    for (const fetus of fetuses) {
      delete fetus.inletIntruder;
      delete fetus.shoulderDystocia;
    }
  } else {
    // 真实模式：胎生／卵胎生横位最多停在子宫低位，不能入盆
    for (const fetus of active) {
      if (fetus.descentStage === DESCENT_INLET && isHardTransverse(fetus)) fetus.descentStage = DESCENT_LOW;
    }
  }

  let presenting = active.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId) || null;
  // 先露锁定只在入口以后成立：退回负值区域（托高、退回妊娠阶段）就释放，之后重新竞争。
  // 第二、三产程例外——每胎开始胎体下降时即锁定，E 步接上产程下降前它可能还在高位。
  const inBirthStage = cap >= DESCENT_CROWNED_OUT;
  if (presenting && !inBirthStage && presenting.descentStage < DESCENT_INLET) presenting = null;
  if (!presenting && !inBirthStage) pregnant.presentingEmbryoId = null;
  if (!presenting) {
    presenting = pickDeepestFetus(active.filter((fetus) => fetus.descentStage >= DESCENT_INLET));
    if (presenting) pregnant.presentingEmbryoId = presenting.embryoId;
  }
  // 入口以后只容先露胎；唯一的例外是真实模式的互锁：头位的第二胎与仍在 0 的臀位先露胎卡在一起。
  // 互锁一被转开就不成立，第二胎随即退回子宫低位——这正是 rotate 解开互锁的方式
  let intruderKept = false;
  for (const fetus of active) {
    if (fetus === presenting || fetus.descentStage < DESCENT_INLET) {
      if (fetus.descentStage < DESCENT_INLET) delete fetus.inletIntruder;
      continue;
    }
    const mayIntrude = realistic && fetus.inletIntruder && !intruderKept && fetus.descentStage === DESCENT_INLET
      && presenting && presenting.descentStage === DESCENT_INLET && isLockedTwins(presenting, fetus);
    if (mayIntrude) {
      intruderKept = true;
      continue;
    }
    fetus.descentStage = DESCENT_LOW;
    delete fetus.inletIntruder;
  }

  // 第二产程的位置只读 phase 边界：胎体下降进产道 1、胎体娩出着冠 2；
  // 受入口阻塞时先露胎留在原地，肩难产停在 3。阶段内细进度由 effectiveLaborHours / threshold 派生
  if (stage === '第二产程' && presenting && !presenting.shoulderDystocia) {
    const obstruction = getLaborObstruction(profile);
    const inletBlocked = obstruction && obstruction.type !== 'shoulder_dystocia';
    if (pregnant.laborPhase === '胎体下降' && !inletBlocked) presenting.descentStage = Math.max(presenting.descentStage, 1);
    if (pregnant.laborPhase === '胎体娩出') presenting.descentStage = Math.max(presenting.descentStage, 2);
  }

  for (const fetus of fetuses) {
    const host = getEnclosingHost(fetus, fetuses);
    if (host && !fetus.pendingImplantation) fetus.descentStage = getDescentStage(host);
  }
}

/** 胎囊已破的内胎解绑：保留当下的位置，之后与其他胎儿一样活动与竞争入口 */
function releaseRupturedNestedFetuses(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  for (const fetus of fetuses) {
    const host = getEnclosingHost(fetus, fetuses);
    if (!host || clampNumber(fetus?.amnionDurability, -100, 100, 100) > 0) continue;
    if (isSealedNestedFetus(fetus, fetuses)) continue;
    fetus.nestedReleased = true;
    if (Number.isFinite(Number(host.descentStage))) fetus.descentStage = Number(host.descentStage);
  }
}

// ── 胎囊 ─────────────────────────────────────────────
// 羊膜耐久存在每胎的 fetus.amnionDurability。同一 identicalGroup 共用一个胎囊：
// 扣一次、结果同步给整组。待着床胚胎还没有胎囊；孕中孕内胎有自己的胎囊，
// 它一破，内胎就被宿主生出来（见 releaseRupturedNestedFetuses）。
const AMNION_INTACT = 100;

function hasMaternalSac(fetus) {
  return !fetus?.pendingImplantation;
}

/** 共用胎囊的组号；待着床或非同卵为 0 */
function getSharedSacGroup(fetus) {
  if (!hasMaternalSac(fetus)) return 0;
  const group = Number(fetus?.identicalGroup);
  return Number.isInteger(group) && group > 0 ? group : 0;
}

/** 与这一胎同一胎囊的全部成员（阵列顺序）；没有共用胎囊时就是自己 */
function getSacBlock(fetuses, fetus) {
  const group = getSharedSacGroup(fetus);
  return group > 0 ? fetuses.filter((other) => getSharedSacGroup(other) === group) : [fetus];
}

/**
 * 一个胎囊在子宫里是一整块空间：同一胎囊的成员在阵列（左右顺序）中必须相邻。
 * 就地收拢到该组第一个成员的位置，组内与其余胎儿的相对顺序不变
 */
function gatherSharedSacs(fetuses) {
  const seen = new Set();
  const ordered = [];
  for (const fetus of fetuses) {
    const group = getSharedSacGroup(fetus);
    if (group === 0) {
      ordered.push(fetus);
    } else if (!seen.has(group)) {
      seen.add(group);
      ordered.push(...getSacBlock(fetuses, fetus));
    }
  }
  fetuses.splice(0, fetuses.length, ...ordered);
}

function getAmnionSacs(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const sacs = [];
  const byGroup = new Map();
  for (const fetus of fetuses) {
    if (!hasMaternalSac(fetus)) continue;
    // 封在胎转卵生宿主壳里的内胎：胎囊碰不到，不扣耐久、也不能破
    if (isSealedNestedFetus(fetus, fetuses)) continue;
    const group = Number(fetus?.identicalGroup);
    if (Number.isInteger(group) && group > 0) {
      if (byGroup.has(group)) {
        byGroup.get(group).members.push(fetus);
        continue;
      }
      const sac = { members: [fetus] };
      byGroup.set(group, sac);
      sacs.push(sac);
    } else {
      sacs.push({ members: [fetus] });
    }
  }
  return sacs;
}

function getSacDurability(sac) {
  return Math.min(...sac.members.map((fetus) => clampNumber(fetus?.amnionDurability, -100, 100, AMNION_INTACT)));
}

function setSacDurability(sac, value) {
  for (const fetus of sac.members) fetus.amnionDurability = value;
}

function getSacOfFetus(pregnant, fetus) {
  if (!fetus) return null;
  return getAmnionSacs(pregnant).find((sac) => sac.members.includes(fetus)) || null;
}

/** 缺值的胎儿补成完整胎囊；同卵组若数值不一致，以较破的那个为准同步 */
function ensureAmnionMetadata(pregnant) {
  for (const fetus of Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : []) {
    if (!Number.isFinite(Number(fetus?.amnionDurability))) fetus.amnionDurability = AMNION_INTACT;
  }
  for (const sac of getAmnionSacs(pregnant)) setSacDurability(sac, getSacDurability(sac));
  releaseRupturedNestedFetuses(pregnant);
}

/** 这一胎所在胎囊的耐久；还没着床（没有胎囊）时回传 null */
export function getFetusAmnionDurability(pregnant, fetus) {
  const sac = getSacOfFetus(pregnant, fetus);
  return sac ? getSacDurability(sac) : null;
}

/** 先露胎的胎囊耐久：提示与追踪页据此判断「是否已破水」。没有胎囊可看时回传 null */
export function getPresentingAmnionDurability(pregnant) {
  const sac = getSacOfFetus(pregnant, getPresentingFetus(pregnant)) || getAmnionSacs(pregnant)[0];
  return sac ? getSacDurability(sac) : null;
}

/** 下降越深的胎囊分到越多磨损；descentStage 建立前一律视为 -2，等于平均分 */
function getSacWearWeight(sac) {
  const depth = Math.max(...sac.members.map((fetus) => (Number.isFinite(Number(fetus?.descentStage)) ? Number(fetus.descentStage) : -2)));
  return Math.max(1, depth + 4);
}

function isSacVisible(sac) {
  return sac.members.some(isFetusKnownToCharacter);
}

/** 破水的画面事件：破掉的胎囊里有看得见的胎儿才记；未揭晓的隐藏胎破水不记，免得剧透 */
function cueRupture(profile, sacs) {
  if (sacs.some(isSacVisible)) setVisualCue(profile, 'rupture');
}

/**
 * 一次事件的磨损：total 是全部胎儿负担的合计，多胎挤在同一个子宫里，
 * 每个胎囊都承受这份总压力——下降最深的吃满，较高位的按深度比例递减，
 * 所以胎数越多、每个胎囊破得越快。floor 是这一阶段不准磨穿的下限（产程前为 1）。
 * 回传这一次被磨破的胎囊。
 */
function distributeAmnionWear(sacs, total, floor = -100) {
  const weights = sacs.map(getSacWearWeight);
  const deepest = Math.max(1, ...weights);
  const ruptured = [];
  sacs.forEach((sac, index) => {
    const current = getSacDurability(sac);
    if (current <= 0) return;
    const next = Math.max(floor, current - (total * weights[index]) / deepest);
    setSacDurability(sac, next);
    if (next <= 0) ruptured.push(sac);
  });
  return ruptured;
}

/**
 * 产程中的羊膜磨损与强制破膜。
 * - forceRupture：scope='presenting' 只破当前先露胎囊（快速娩出），'all' 破全部（第三产程收尾）。
 * - 第一产程：总扣量按下降位置分给全部胎囊；第二产程只磨先露胎囊。
 */
function applyLaborAmnionWear(profile, female, options = {}) {
  const pregnant = profile.pregnant || {};
  const stage = String(profile?.base?.stage || '');
  const presentingSac = getSacOfFetus(pregnant, getPresentingFetus(pregnant));

  if (options.forceRupture) {
    const targets = options.scope === 'all' ? getAmnionSacs(pregnant) : [presentingSac].filter(Boolean);
    const intact = targets.filter((sac) => getSacDurability(sac) > 0);
    for (const sac of intact) setSacDurability(sac, 0);
    cueRupture(profile, intact);
    profile.pregnant = pregnant;
    return false;
  }

  const drainBase = Math.max(1, clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 1));
  const multiplier = clampNumber(options.multiplier, 0.1, 10, 1);
  const sacs = stage === '第二产程' ? [presentingSac].filter(Boolean) : getAmnionSacs(pregnant);
  const ruptured = distributeAmnionWear(sacs, drainBase * multiplier);
  cueRupture(profile, ruptured);
  releaseRupturedNestedFetuses(pregnant);
  profile.pregnant = pregnant;

  // 未揭晓的异期胎破水不通报，免得剧透
  if (ruptured.some(isSacVisible) && !options.silent) {
    profile.notify = {
      ...(profile.notify || {}),
      secondly: `${female}破水了`,
    };
  }
  return ruptured.length > 0;
}

/**
 * 产兆前驱的初始时长。前驱是子宫在准备发动，跟胎儿过不过得了产道无关，所以不乘分娩难度：
 * 难产的苦留给产程本身（龙族难度 4，产程约三天三夜），不再让前驱拖上一周多。
 */
export function getProdromalInitialHours(_profile) {
  return PRODROMAL_BASE_HOURS;
}

const PRODROMAL_BASE_HOURS = 48;

/** 真实产程下产兆前驱的累计延后上限（占初始时长的比例）：只能拖，拖不掉 */
const REALISTIC_PRODROMAL_DELAY_CAP_RATIO = 1.0;

function clearProdromalState(pregnant) {
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
  pregnant.prodromalLeadEmbryoId = null;
}

function beginLaborPhase(pregnant, phase, birthNumber = 0) {
  pregnant.laborPhase = phase;
  pregnant.laborBirthNumber = birthNumber;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  // 每一胎开始下降时锁定先露胎；之后换位、分裂、插入都不能让它漂移。
  // 对应的下降位置由 reconcileFetalDescent 依阶段推导（受阻时不前进）
  if (phase === '胎体下降') selectPresentingFetus(pregnant);
}

/**
 * 工具入口的一次性选择器：把当轮 prompt 可见列表的 fetusIndex 解析成胎儿本体。
 * 跨时间的引用一律改存 embryoId，index 只在这一刻有效。
 */
function resolveVisibleFetus(fetuses, fetusIndex) {
  if (!Number.isInteger(fetusIndex) || fetusIndex < 0) return null;
  const visible = (Array.isArray(fetuses) ? fetuses : []).filter(isFetusKnownToCharacter);
  return visible[fetusIndex] || null;
}

/**
 * 先露胎可以竞争的对象：待着床的胚胎还没接上母体，
 * 孕中孕内胎只要还包在宿主体内就跟着宿主，不单独占用入口。
 */
function isPresentingCandidate(fetus, fetuses) {
  if (fetus?.pendingImplantation) return false;
  return !getEnclosingHost(fetus, fetuses);
}

/**
 * 当前先露胎（不写入）：已锁定的直接回传；未锁定时预选下降最深者，同值依阵列顺序。
 * descentStage 建立前全部同值，结果等同过去的首位胎；只剩不合格的胎儿时退回全体。
 */
export function getPresentingFetus(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return null;
  const locked = fetuses.find((fetus) => fetus?.embryoId === pregnant?.presentingEmbryoId);
  if (locked) return locked;
  const candidates = fetuses.filter((fetus) => isPresentingCandidate(fetus, fetuses));
  const pool = candidates.length > 0 ? candidates : fetuses;
  const depth = (fetus) => (Number.isFinite(Number(fetus?.descentStage)) ? Number(fetus.descentStage) : -Infinity);
  return pool.reduce((best, fetus) => (depth(fetus) > depth(best) ? fetus : best), pool[0]);
}

function selectPresentingFetus(pregnant) {
  const fetus = getPresentingFetus(pregnant);
  pregnant.presentingEmbryoId = fetus ? fetus.embryoId : null;
  return fetus;
}

/**
 * 按先露胎的身分移除出生的那一胎；不再用 shift() 把最左侧误当成出生目标。
 * 仍包在它体内的孕中孕内胎（胎囊没破）在同一次娩出里一起生下来。
 * 回传这次娩出的全部胎儿，先露胎排第一；没有可娩出的回传空阵列。
 */
function removePresentingFetus(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const baby = selectPresentingFetus(pregnant);
  if (!baby) return [];
  const enclosed = fetuses.filter((fetus) => getEnclosingHost(fetus, fetuses) === baby);
  const born = [baby, ...enclosed];
  pregnant.fetuses = fetuses.filter((fetus) => !born.includes(fetus));
  pregnant.fetusesCount = pregnant.fetuses.length;
  // 产后恢复要按「这次一共生了几胎」算，逐胎娩出的要先记下来
  pregnant.deliveredCount = clampNumber(pregnant.deliveredCount, 0, 99, 0) + born.length;
  pregnant.presentingEmbryoId = null;
  return born;
}

/**
 * 第二产程娩出当前先露胎（连同仍包在它体内的孕中孕内胎），登记孩子，
 * 再转入间歇期或第三产程。自然娩出与助产拉出（extract）共用。
 * 回传是否真的生下了胎儿。
 */
function deliverPresentingFetus(profile, female, notify, { lead = '' } = {}) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const born = removePresentingFetus(pregnant);
  if (born.length === 0) return false;
  const father = String(born[0]?.fathers || '未知');
  const gender = String(born[0]?.gender || '未知');
  const companionEggs = born.reduce((sum, fetus) => sum + getCompanionEggCount(fetus), 0);
  const enclosedNote = `${describeEnclosedBirths(born)}${companionEggs > 0 ? `，同时排出${companionEggs}枚伴生卵` : ''}`;
  appendChildrenFromFetuses(profile, born);
  updateFetalEnergyDrain(profile);
  const remaining = pregnant.fetuses;
  if (remaining.length === 0) {
    base.stage = '第三产程';
    base.days = 0;
    beginLaborPhase(pregnant, '供养器官娩出', 0);
    updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了第三产程·供养器官娩出`,
      secondly: `${lead}${female}生下了${father}的孩子，性别为${gender}${enclosedNote}，正在娩出胎盘`,
    };
  } else {
    beginLaborPhase(pregnant, '间歇期', pregnant.laborBirthNumber);
    updateLaborPain(profile, '第二产程', '间歇期', 0);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了第二产程·第${pregnant.laborBirthNumber}胎后间歇期`,
      secondly: `${lead}${female}生下了${father}的孩子，性别为${gender}${enclosedNote}，仍有${remaining.length}胎待产`,
    };
  }
  return true;
}

/** 一起娩出的孕中孕内胎（胎囊没破）写进通知：先露胎之外的每一胎 */
function describeEnclosedBirths(born) {
  const enclosed = born.slice(1);
  if (enclosed.length === 0) return '';
  return `，体内还包着${enclosed.map((fetus) => `${String(fetus?.fathers || '未知')}的孩子（${String(fetus?.gender || '未知')}）`).join('、')}，一并娩出`;
}

/** 先露引用必须指向现存胎儿；融合、减胎、流产或妊娠结束后立即清空 */
function reconcilePresentingReference(pregnant) {
  if (!pregnant || typeof pregnant !== 'object') return;
  if (pregnant.presentingEmbryoId === undefined || pregnant.presentingEmbryoId === null) return;
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (!fetuses.some((fetus) => fetus?.embryoId === pregnant.presentingEmbryoId)) pregnant.presentingEmbryoId = null;
}

function enterProdromalStage(profile, female, stage, message) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  base.stage = '产兆前驱';
  base.days = 0;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborBirthNumber = 0;
  pregnant.presentingEmbryoId = null;
  pregnant.prodromalOriginStage = stage;
  // 不论是延产期满、引产还是调试进来的，延产到期日都作废：产兆前驱里要再延产得重新使用工具
  pregnant.extensionUntilDays = null;
  pregnant.prodromalRemainingHours = getProdromalInitialHours(profile);
  pregnant.prodromalDelayProgressHours = 0;
  pregnant.prodromalLeadEmbryoId = null;
  pregnant.laborPain = 0; base.uterinePressure = Math.max(clampNumber(base.uterinePressure, 0, 9999, 0), Math.ceil(getUterinePressureCap(profile) * 0.66)); // 宫压至少补到自然发动门槛：延产把宫压归零、离场在 50% 就发动、调试直接跳入，否则真实产程模式几乎每次都判宫缩微弱
  profile.pregnant = pregnant;
  updateLaborPain(profile, '产兆前驱', null, 0);
  profile.notify = {
    ...(profile.notify || {}),
    firstly: `${female}进入了产兆前驱`,
    secondly: message,
  };
}

const EXTENSION_AMNION_REGEN_PER_DAY = 5;

/** 延产期羊膜每天回复一点，最多回满；延产期本来就不会破水，这里只补磨损 */
function regenerateExtensionAmnion(profile, tick) {
  const days = Math.max(0, Number(tick?.deltaDays) || 0);
  if (days <= 0) return;
  for (const sac of getAmnionSacs(profile?.pregnant)) {
    const current = getSacDurability(sac);
    if (current <= 0 || current >= AMNION_INTACT) continue;
    setSacDurability(sac, Math.min(AMNION_INTACT, current + EXTENSION_AMNION_REGEN_PER_DAY * days));
  }
}

/**
 * 延产：第一次在逾期，或由逾期发动的产兆前驱使用，延到 52 周；
 * 之后在延产期满（或引产）进入的产兆前驱再用，每次再延 28 天。
 * 第二次起每延一次子宫乏力 +1。action=induce 是延产期唯一的出口：立即进入产兆前驱。
 */
function applyExtendPregnancy(chatState, args) {
  const female = String(args?.female || '').trim();
  const action = String(args?.action || 'extend').trim();
  const reason = String(args?.reason || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsExtendPregnancy skipped: unknown character ${female || '(empty)'}.` };
  }
  if (action !== 'extend' && action !== 'induce') {
    return { applied: false, message: `bsExtendPregnancy skipped for ${female}: action must be extend or induce.` };
  }
  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  if (getImplantedFetuses(profile).length === 0) {
    return { applied: false, message: `bsExtendPregnancy skipped for ${female}: no implanted fetuses.` };
  }
  const reasonNote = reason ? `（${reason}）` : '';

  if (action === 'induce') {
    if (stage !== '延产期') {
      return { applied: false, message: `bsExtendPregnancy skipped for ${female}: 只有延产期可以引产（目前为 ${stage || '(none)'}）。` };
    }
    enterProdromalStage(profile, female, '延产期', `${female}经引产结束延产${reasonNote}，开始出现分娩前兆`);
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsExtendPregnancy induced labor for ${female}: entered 产兆前驱.` };
  }

  const origin = String(pregnant.prodromalOriginStage || '');
  const fromOverdue = stage === '逾期' || (stage === '产兆前驱' && origin === '逾期');
  const fromExtension = stage === '产兆前驱' && origin === '延产期';
  if (!fromOverdue && !fromExtension) {
    return {
      applied: false,
      message: `bsExtendPregnancy skipped for ${female}: 只能在逾期、或由逾期／延产期进入的产兆前驱使用（目前为 ${stage || '(none)'}${stage === '产兆前驱' ? `，由${origin || '未知阶段'}进入` : ''}）。`,
    };
  }
  if (getAmnionSacs(pregnant).some((sac) => getSacDurability(sac) <= 0)) {
    return { applied: false, message: `bsExtendPregnancy skipped for ${female}: 已经破水，无法延产。` };
  }

  const effectiveDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const previousCount = Math.max(0, Math.floor(clampNumber(pregnant.extensionCount, 0, 999, 0)));
  const count = previousCount + 1;
  // 第一次延到 52 周；逾期拖得太久、已经过了 52 周才第一次延产的，就和之后一样再延 28 天
  const untilDays = previousCount === 0 && effectiveDays < FIRST_EXTENSION_UNTIL_DAYS
    ? FIRST_EXTENSION_UNTIL_DAYS
    : effectiveDays + EXTENSION_MONTH_DAYS;
  const atonyRaised = count >= 2;
  if (atonyRaised) base.uterineAtony = getUterineAtony(profile) + 1;

  // 回到延产期：产兆前驱与产程的暂态全部作废，已入盆的胎儿退回子宫低位
  clearProdromalState(pregnant);
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborBirthNumber = 0;
  pregnant.presentingEmbryoId = null;
  pregnant.laborPain = 0;
  for (const fetus of Array.isArray(pregnant.fetuses) ? pregnant.fetuses : []) {
    if (getDescentStage(fetus) >= DESCENT_INLET) fetus.descentStage = DESCENT_LOW;
  }
  for (const sac of getAmnionSacs(pregnant)) setSacDurability(sac, AMNION_INTACT);
  pregnant.extensionCount = count;
  pregnant.extensionUntilDays = untilDays;
  base.stage = '延产期';
  base.days = Math.max(0, effectiveDays - POSTTERM_START_DAYS);
  base.uterinePressure = 0;
  profile.cooldown = { ...(profile.cooldown || {}), pregnancyPressureWarning: false };
  profile.base = base;
  profile.pregnant = pregnant;
  reconcileFetalDescent(profile);

  const untilWeeks = Math.floor(untilDays / 7);
  const atonyNote = atonyRaised ? `；子宫乏力加深至 ${getUterineAtony(profile)} 级` : '';
  profile.notify = {
    ...(profile.notify || {}),
    firstly: `${female}进入了延产期`,
    secondly: `${female}第 ${count} 次延产${reasonNote}，妊娠将维持到第 ${untilWeeks} 周（有效孕日 ${Math.round(untilDays)}）${atonyNote}`,
  };
  next.profile = profile;
  chatState.characters[female] = next;
  return {
    applied: true,
    message: `bsExtendPregnancy applied to ${female}: extension #${count}, until effective day ${Math.round(untilDays)} (week ${untilWeeks}), uterine atony ${getUterineAtony(profile)}.`,
  };
}

function maybeStartLabor(profile, tick, female) {
  const base = profile.base || {};
  const stage = String(base.stage || '');
  if (!['临产期', '逾期'].includes(stage) || tick.passedHours <= 0) return false;

  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  if (currentPressure < pressureCap * 0.66) return false;

  enterProdromalStage(profile, female, stage, `${female}开始出现分娩前兆，距离正式产程已经不远`);
  return true;
}

/** 离场角色的发动期限：满 44 周一定发动，剧情压低宫压或旧存档卡在逾期都不会一路拖下去 */
const OFFSCREEN_ONSET_DEADLINE_DAYS = 308;

/**
 * 离场角色的足月发动：宫压照同一条时间表累积，过上限一半就直接发动，
 * 不走「示警、下回合才发动」——那是给在场剧情反应用的
 */
function maybeStartOffscreenLabor(profile, female) {
  const base = profile.base || {};
  const stage = String(base.stage || '');
  if (!['临产期', '逾期'].includes(stage)) return false;
  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  const effectiveDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  if (currentPressure < pressureCap * 0.5 && effectiveDays < OFFSCREEN_ONSET_DEADLINE_DAYS) return false;
  enterProdromalStage(profile, female, stage, `${female}在场外出现分娩前兆，已进入待产`);
  return true;
}

function shouldKeepPregnancyPressureWarning(profile) {
  const base = profile?.base || {};
  const stage = String(base.stage || '');
  if (!isPregnancyStage(stage)) return false;
  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  return currentPressure >= (pressureCap * 0.5);
}

/**
 * 宫压危机的当下风险，给子宫图的警告用；门槛与 applyPressureCrisis、maybeStartLabor 一致。
 * 孕早、孕中：宫压过半会流产；孕晚：早产（进入产兆前驱）；临产、逾期：发动产程。
 * imminent：已经警告过（下次时间推进仍未缓解就会发生），或临产、逾期宫压已达 66%（下一小时就发动）。
 * 受流产免疫保护的不算风险，但逾期的危机与临产、逾期 66% 的自然发动不受免疫阻挡
 */
export function getPregnancyPressureRisk(profile) {
  const stage = String(profile?.base?.stage || '');
  if (!PREGNANCY_STAGES.includes(stage) || stage === '延产期') return null;
  const pressureCap = getUterinePressureCap(profile);
  const ratio = clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) / Math.max(pressureCap, 1);
  // 临产、逾期宫压达 66% 时下一小时就自然发动，不看流产免疫
  const termOnset = (stage === '临产期' || stage === '逾期') && ratio >= 0.66;
  if (!termOnset && (ratio < 0.5 || (profile?.immune?.miscarriage && stage !== '逾期'))) return null;
  const type = stage === '孕早期' || stage === '孕中期' ? 'miscarriage' : stage === '孕晚期' ? 'preterm' : 'labor';
  const imminent = termOnset || Boolean(profile?.cooldown?.pregnancyPressureWarning);
  const outcome = { miscarriage: '流产', preterm: '早产', labor: '发动产程' }[type];
  return {
    type,
    imminent,
    ratio,
    message: imminent
      ? `宫压已达上限的 ${Math.round(ratio * 100)}%，下次时间推进仍未缓解就会${outcome}`
      : `宫压已达上限的 ${Math.round(ratio * 100)}%，有${outcome}的风险`,
  };
}

function applyPressureCrisis(profile, runtime, female) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const immune = profile?.immune || {};
  const experience = profile?.experience || {};
  const cooldown = profile?.cooldown || {};
  const stage = String(base.stage || '');
  if (!isPregnancyStage(stage)) return { changed: false, warned: false };
  // 延产期宫压照常显示，也能被工具调整，但任何高度都不会引发流产或产程，连警告都不发
  if (stage === '延产期') return { changed: false, warned: false };

  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  const triggerThreshold = pressureCap * 0.5;
  if (currentPressure < triggerThreshold) return { changed: false, warned: false };

  const notify = profile.notify || {};
  if (!cooldown.pregnancyPressureWarning) {
    const warningText = (stage === '孕早期' || stage === '孕中期')
      ? `${female}子宫压力过高，有流产风险；若下次时间推进时仍未缓解，可能会真的流产`
      : `${female}子宫压力过高，有提前发动产程的风险；若下次时间推进时仍未缓解，可能会进入产兆前驱`;
    profile.cooldown = {
      ...cooldown,
      pregnancyPressureWarning: true,
    };
    profile.notify = {
      ...notify,
      secondly: warningText,
    };
    return { changed: false, warned: true };
  }

  if (stage === '孕早期' || stage === '孕中期') {
    if (immune.miscarriage) {
      profile.notify = {
        ...notify,
        secondly: `${female}的胚胎受到保护，流产无效，胚胎依旧留着`,
      };
      return { changed: false, warned: false };
    }

    const recoveryDays = settlePostpartumRecoveryDays(profile, { miscarriage: true });
    clearPregnancyState(profile);
    restorePregnancyPhysiology(profile, runtime || {});
    assignPostpartumRecoveryDays(profile, recoveryDays);
    base.stage = '产后恢复';
    base.days = 0;
    experience.miscarriageExperience = clampNumber(experience.miscarriageExperience, 0, 999, 0) + 1;
    profile.experience = experience;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了产后恢复`,
      secondly: `${female}因子宫压力过高而流产了`,
    };
    return { changed: true, warned: false };
  }

  if ((stage === '孕晚期' || stage === '临产期') && immune.miscarriage) {
    profile.notify = {
      ...notify,
      secondly: `${female}的胎儿受到保护，早产被阻止了`,
    };
    return { changed: false, warned: false };
  }

  if (stage === '孕晚期' || stage === '临产期' || stage === '逾期') {
    enterProdromalStage(profile, female, stage, `${female}子宫压力达到临界值，开始出现分娩前兆`);
    return { changed: true, warned: false };
  }

  return { changed: false, warned: false };
}

function resolveSecondPhaseHours(profile, phase) {
  if (phase === '间歇期') return Math.max(0.5, clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1) * 0.5);
  const birthDifficulty = getPresentingBirthDifficulty(profile);
  const firstFetus = getPresentingFetus(profile?.pregnant);
  const fetalAngle = Number.isFinite(Number(firstFetus?.tendencyAngle)) ? wrapAngle(firstFetus.tendencyAngle) : 0;
  const positionDifficulty = firstFetus ? calculatePositionDifficulty(fetalAngle, firstFetus) : 1;
  const fetalWeight = firstFetus ? clampNumber(firstFetus?.weight, 0.33, 3.0, 1.0) : 1;
  const total = resolveLaborStageHours('第二产程', 1, birthDifficulty) * positionDifficulty * fetalWeight;
  return total * (phase === '胎体娩出' ? 0.4 : 0.6);
}

function resolveFirstStageExperienceMultiplier(profile) {
  const naturalBirthCount = Math.min(
    FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.maxCount,
    Math.floor(clampNumber(profile?.experience?.naturalBirthExperience, 0, 999, 0)),
  );
  return Math.max(
    FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.minMultiplier,
    1 - (naturalBirthCount * FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE.reductionPerBirth),
  );
}

export function resolveLaborPhaseHours(profile, stage, phase, fetuses = profile?.pregnant?.fetuses || [], { fullStage = false } = {}) {
  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  if (stage === '第一产程') {
    const total = resolveLaborStageHours('第一产程', Math.max(fetuses.length, 1), birthDifficulty)
      * resolveFirstStageExperienceMultiplier(profile);
    if (fullStage) return total;
    if (phase === '活跃期') return total * 0.35;
    if (phase === '过渡期') return total * 0.15;
    return total * 0.5;
  }
  if (stage === '第二产程') return resolveSecondPhaseHours(profile, phase);
  if (stage === '第三产程') {
    if (phase === '产后观察') return Math.max(
      LABOR_POSTPARTUM_OBSERVATION_HOURS,
      birthDifficulty * LABOR_POSTPARTUM_OBSERVATION_HOURS,
    );
    return Math.max(0.5, resolveLaborStageHours('第三产程', 1, birthDifficulty));
  }
  return 1;
}

export function getLaborPhaseForStage(stage, currentPhase) {
  if (stage === '第一产程') return ['潜伏期', '活跃期', '过渡期'].includes(currentPhase) ? currentPhase : '潜伏期';
  if (stage === '第二产程') return ['胎体下降', '胎体娩出', '间歇期'].includes(currentPhase) ? currentPhase : '胎体下降';
  if (stage === '第三产程') return ['供养器官娩出', '产后观察'].includes(currentPhase) ? currentPhase : '供养器官娩出';
  return null;
}

function updateLaborPain(profile, stage, phase, progress = 0, obstruction = false) {
  const pregnant = profile.pregnant || {};
  const base = profile.base || {};
  const ratio = clampNumber(progress, 0, 1, 0);
  const ranges = {
    产兆前驱: [0.5, 2.5],
    潜伏期: [2, 4],
    活跃期: [4, 7],
    过渡期: [7, 8.5],
    胎体下降: [6, 8],
    胎体娩出: [8, 9],
    间歇期: [3, 5],
    供养器官娩出: [3, 5.5],
    产后观察: [1, 3],
  };
  const range = stage === '产兆前驱' ? ranges.产兆前驱 : (ranges[phase] || [0, 0]);
  let pain = range[0] + ((range[1] - range[0]) * ratio);
  const birthDifficulty = ['胎体下降', '胎体娩出'].includes(phase)
    ? getPresentingBirthDifficulty(profile)
    : clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  const difficultyWeight = stage === '产兆前驱' ? (0.25 + (ratio * 0.25)) : (phase === '潜伏期' ? (0.25 + (ratio * 0.75)) : (phase === '产后观察' ? 0.5 : 1));
  pain += clampNumber((birthDifficulty - 1) * 1.5, -1.5, 3, 0) * difficultyWeight;
  const toleranceWeight = stage === '产兆前驱' ? 0.5 : (phase === '潜伏期' ? (0.5 + (ratio * 0.5)) : (phase === '产后观察' ? 0.5 : 1));
  pain += (4 - clampNumber(base.vitalityLevel, 1, 7, 4)) * toleranceWeight;
  pain += ((clampNumber(base.psyStressLevel, 1, 7, 4) - 4) * 0.5) * toleranceWeight;
  if (obstruction) pain += 1.5;
  if (isPosteriorPresentingLabor(profile, stage)) pain += POSTERIOR_PAIN_BONUS;
  // 助产操作留下的瞬时痛感，每小时减半（见 decayAssistPainBoost）
  pain += clampNumber(pregnant.assistPainBoost, 0, ASSIST_PAIN_BOOST_CAP, 0);
  pregnant.laborPain = Math.round(clampNumber(pain, 0, 10, 0) * 10) / 10;
  profile.pregnant = pregnant;
  return pregnant.laborPain;
}

function processLabor(profile, tick, female) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  let stage = String(base.stage || '');
  let rawHours = tick.deltaDays * 24;
  if (rawHours <= 0) return false;

  const libido = clampNumber(base.libido, 0, getLibidoCap(profile), 0);
  const libidoMultiplier = 1 + (libido / Math.max(getLibidoCap(profile), 1)) * 0.25;
  let enteredFirstStage = false;

  if (stage === '产兆前驱') {
    const initialHours = getProdromalInitialHours(profile);
    const leadWasEngaged = getProdromalLeadDescent(profile) >= DESCENT_INLET;
    const remainingHours = clampNumber(pregnant.prodromalRemainingHours, 0, 9999, initialHours) - rawHours;
    pregnant.prodromalRemainingHours = Math.max(0, remainingHours);
    reconcileFetalDescent(profile);
    let engageNote = '';
    if (!leadWasEngaged && getProdromalLeadDescent(profile) >= DESCENT_INLET) {
      const lead = pregnant.fetuses.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId);
      const visible = pregnant.fetuses.filter(isFetusKnownToCharacter);
      if (lead && visible.includes(lead) && getDescentStage(lead) >= DESCENT_INLET) engageNote = `；第${visible.indexOf(lead) + 1}胎入盆了`;
    }
    updateLaborPain(profile, stage, null, 1 - (Math.max(0, remainingHours) / initialHours));
    if (remainingHours > 0) {
      notify.secondly = `${female}仍处于产兆前驱，距离正式产程约剩${Math.ceil(remainingHours)}小时${engageNote}`;
      profile.notify = notify;
      return false;
    }
    base.stage = '第一产程';
    base.days = 0;
    beginLaborPhase(pregnant, '潜伏期', 0);
    updateLaborPain(profile, '第一产程', '潜伏期', 0);
    clearProdromalState(pregnant);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了第一产程`,
      secondly: `${female}的产兆前驱结束，宫缩进一步加剧，正式进入分娩`,
    };
    // 前驱走完后多出来的时间带进第一产程，不丢弃
    enteredFirstStage = true;
    stage = '第一产程';
    rawHours = -remainingHours;
    if (rawHours <= 1e-9) return true;
  }

  if (!LABOR_STAGES.includes(stage)) return false;

  // 一次推进跨过多个产程阶段时，以剩余原始小时逐段消耗：每一段只给到当前阶段门槛所需的时间，
  // 完成该阶段的转移、磨损与阻塞检查后，把剩下的时间带进下一阶段。
  // 宫缩微弱停滞与高宫压快速路径每次推进只在第一段判定一次。
  let remainingHours = rawHours;
  let stageChanged = enteredFirstStage;
  // 每一段都会写通知；跨过多个阶段时接在前一段后面，出生、换阶段等讯息不被下一段的进度覆盖
  let carried = enteredFirstStage ? { firstly: profile.notify?.firstly, secondly: profile.notify?.secondly } : null;
  for (let segment = 0; segment < 64 && remainingHours > 1e-9; segment += 1) {
    if (!LABOR_STAGES.includes(String(base.stage || ''))) break;
    const segmentHours = Math.min(remainingHours, getLaborSegmentHours(profile, libidoMultiplier));
    const result = processLaborSegment(profile, female, segmentHours, { firstSegment: segment === 0, libidoMultiplier });
    remainingHours -= segmentHours;
    stageChanged = stageChanged || result.stageChanged;
    if (carried) {
      const merged = { ...(profile.notify || {}) };
      for (const key of ['firstly', 'secondly']) {
        const previous = String(carried[key] || '').trim();
        const current = String(merged[key] || '').trim();
        if (previous && current && current !== previous && !current.includes(previous)) merged[key] = `${previous}；${current}`;
        else if (previous && !current) merged[key] = previous;
      }
      profile.notify = merged;
    }
    carried = { firstly: profile.notify?.firstly, secondly: profile.notify?.secondly };
    if (result.halt) break;
  }
  return stageChanged;
}

/**
 * 大胎的活力修正：只作用于第二产程的胎体下降与娩出。胎重 1.5 以下不受影响，
 * 1.5–2.0 平滑增加对活力的需求，2.0 以上达到完整修正；活力 200 可完全支撑，
 * 活力不足只会减速、最低保留 0.25 倍进度，不另立硬停滞（胎重本身的时间倍率另计）。
 */
function getOversizeVitalityMultiplier(profile, stage, phase) {
  if (stage !== '第二产程' || (phase !== '胎体下降' && phase !== '胎体娩出')) return 1;
  const fetus = getPresentingFetus(profile?.pregnant);
  const oversizeRatio = clampNumber((clampNumber(fetus?.weight, 0.33, 3.0, 1.0) - 1.5) / 0.5, 0, 1, 0);
  if (oversizeRatio <= 0) return 1;
  const vitalityRatio = clampNumber(clampNumber(profile?.base?.vitality, 0, 9999, 100) / 200, 0, 1, 0.5);
  return Math.max(0.25, 1 - (oversizeRatio * (1 - vitalityRatio)));
}

/** 每一原始小时换算成多少有效产程小时：宫缩倍率 × 大胎活力修正（不含性欲倍率） */
function getLaborProgressMultiplier(profile, stage, phase) {
  const currentPressure = clampNumber(profile?.base?.uterinePressure, 0, getUterinePressureCap(profile), 0);
  const pressureMultiplier = stage === '第三产程' ? 1 : Math.max(0.5, Math.min(1.5, 0.5 + (currentPressure / 150)));
  return pressureMultiplier * getOversizeVitalityMultiplier(profile, stage, phase) * getPosteriorMultiplier(profile, stage) * getAtonyLaborMultiplier(profile, stage);
}

/** 子宫乏力让宫缩无力：第一、第二产程每级慢 10%，最低一半 */
function getAtonyLaborMultiplier(profile, stage) {
  if (stage !== '第一产程' && stage !== '第二产程') return 1;
  return Math.max(0.5, 1 - UTERINE_ATONY_STEP * getUterineAtony(profile));
}

// 枕后位（胎背朝后）：真实分娩模式下第一、第二产程的有效进度打折，疼痛略高
const POSTERIOR_PROGRESS_MULTIPLIER = 0.8;
const POSTERIOR_PAIN_BONUS = 0.8;

function isPosteriorPresentingLabor(profile, stage) {
  if (!isRealisticLabor(profile) || (stage !== '第一产程' && stage !== '第二产程')) return false;
  return isPosteriorBack(getPresentingFetus(profile?.pregnant || {}));
}

function getPosteriorMultiplier(profile, stage) {
  return isPosteriorPresentingLabor(profile, stage) ? POSTERIOR_PROGRESS_MULTIPLIER : 1;
}

/** 以目前的推进倍率，走到当前产程阶段门槛还需要多少原始小时（多给一点点，确保越过门槛） */
function getLaborSegmentHours(profile, libidoMultiplier) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const phase = getLaborPhaseForStage(stage, String(pregnant.laborPhase || ''));
  const threshold = resolveLaborPhaseHours(profile, stage, phase, fetuses);
  const rate = Math.max(1e-6, libidoMultiplier * getLaborProgressMultiplier(profile, stage, phase));
  const needed = Math.max(0, threshold - clampNumber(pregnant.effectiveLaborHours, 0, 9999, 0));
  return (needed / rate) + 1e-6;
}

/**
 * 产程中的一段时间。回传 { stageChanged, halt }：halt 表示这段之后不该再继续消耗时间
 * （宫缩停滞、受阻、阶段内尚未走完、快速路径或产程结束）。
 */
function processLaborSegment(profile, female, rawHours, { firstSegment, libidoMultiplier }) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const realisticLabor = Boolean(profile?.immune?.realisticLabor);
  const stage = String(base.stage || '');
  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  const baseEffectiveHours = rawHours * libidoMultiplier;
  let currentStageHours = clampNumber(pregnant.laborHours, 0, 9999, 0);
  let currentEffectiveHours = clampNumber(pregnant.effectiveLaborHours, 0, 9999, 0);
  const done = (stageChanged) => ({ stageChanged: Boolean(stageChanged), halt: true });
  const next = (stageChanged) => ({ stageChanged: Boolean(stageChanged), halt: false });


  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const phase = getLaborPhaseForStage(stage, String(pregnant.laborPhase || ''));
  pregnant.laborPhase = phase;
  if (stage === '第二产程' && clampNumber(pregnant.laborBirthNumber, 0, 99, 0) <= 0) pregnant.laborBirthNumber = 1;
  reconcileFetalDescent(profile);
  const presentingFetus = stage === '第二产程' ? getPresentingFetus(pregnant) : null;
  const obstruction = getLaborObstruction(profile);
  if (obstruction) {
    notify.firstly = `${female}发生难产警示：${obstruction.message}，${OBSTRUCTION_ADVICE[obstruction.type] || ''}或使用 bsChildbirth 进行手术产`;
  }
  const threshold = resolveLaborPhaseHours(profile, stage, phase, fetuses);
  const stallThreshold = pressureCap * 0.66;
  const isThirdStageWithNoFetuses = stage === '第三产程' && fetuses.length === 0;

  currentStageHours += rawHours;
  pregnant.laborHours = currentStageHours;

  // 硬阻塞：入口受阻时胎体下降不前进；肩难产停在 3、不会自然娩出。
  // 普通时间推进解不开，要靠助产或手术产
  const blocksDescent = stage === '第二产程' && obstruction?.hardBlock
    && (obstruction.type === 'shoulder_dystocia' || phase === '胎体下降');
  if (blocksDescent) {
    pregnant.effectiveLaborHours = obstruction.type === 'shoulder_dystocia' ? threshold : currentEffectiveHours;
    updateLaborPain(profile, stage, phase, pregnant.effectiveLaborHours / threshold, true);
    profile.notify = {
      ...notify,
      secondly: `${female}因${obstruction.message}，产程持续受阻`,
    };
    return done(false);
  }

  // 宫缩微弱的零进度回合只在真实分娩模式出现；非真实模式每次有效推进都至少取得进度
  if (firstSegment && realisticLabor && currentPressure < stallThreshold && !isThirdStageWithNoFetuses) {
    const currentRatio = pressureCap > 0 ? (currentPressure / pressureCap) : 0;
    const chanceToStall = Math.max(0, Math.min(1, 1 - currentRatio));
    if (Math.random() < chanceToStall) {
      profile.notify = {
        ...notify,
        secondly: `${female}的子宫收缩微弱，产程进展停滞`,
      };
      pregnant.effectiveLaborHours = currentEffectiveHours;
      updateLaborPain(profile, stage, phase, currentEffectiveHours / threshold, Boolean(obstruction));
      return done(false);
    }
  } else if (firstSegment && currentPressure >= pressureCap && !realisticLabor) {
    if (stage === '第一产程') {
      base.uterinePressure = pressureCap * 0.5;
      base.stage = '第二产程';
      base.days = 0;
      beginLaborPhase(pregnant, '胎体下降', 1);
      // 快速进入第二产程只破刚锁定的先露胎囊，不再全体破膜
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
      updateLaborPain(profile, '第二产程', '胎体下降', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程`,
        secondly: `${female}宫口开全，产程突然加速`,
      };
      return done(true);
    }

    if (stage === '第二产程') {
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
      let father = '未知';
      let gender = '未知';
      let enclosedNote = '';
      const born = removePresentingFetus(pregnant);
      if (born.length > 0) {
        father = String(born[0]?.fathers || '未知');
        gender = String(born[0]?.gender || '未知');
        enclosedNote = describeEnclosedBirths(born);
        appendChildrenFromFetuses(profile, born);
        updateFetalEnergyDrain(profile);
      }
      const remaining = pregnant.fetuses;
      base.uterinePressure = pressureCap * 0.5;
      if (remaining.length === 0) {
        base.stage = '第三产程';
        base.days = 0;
        beginLaborPhase(pregnant, '供养器官娩出', 0);
        updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
        profile.notify = {
          ...notify,
          firstly: `${female}进入了第三产程`,
          secondly: `${female}产程突然加速，生下了${father}的孩子，性别为${gender}${enclosedNote}，正在娩出胎盘`,
        };
      } else {
        beginLaborPhase(pregnant, '胎体下降', clampNumber(pregnant.laborBirthNumber, 1, 99, 1) + 1);
        updateLaborPain(profile, '第二产程', '胎体下降', 0);
        profile.notify = {
          ...notify,
          secondly: `${female}产程突然加速，生下了${father}的孩子，性别为${gender}${enclosedNote}，仍有${remaining.length}胎待产`,
        };
      }
      return done(base.stage !== stage);
    }

    if (stage === '第三产程') {
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true, scope: 'all' });
      return done(applyChildbirthInternal(profile, female, true));
    }
  }

  const effectiveHoursGain = baseEffectiveHours * getLaborProgressMultiplier(profile, stage, phase);
  currentEffectiveHours += effectiveHoursGain;
  pregnant.effectiveLaborHours = currentEffectiveHours;
  updateLaborPain(profile, stage, phase, currentEffectiveHours / threshold, Boolean(obstruction));

  if (stage === '第一产程') {
    applyLaborAmnionWear(profile, female, { multiplier: rawHours * 0.35 });
  } else if (stage === '第二产程') {
    applyLaborAmnionWear(profile, female, { multiplier: rawHours * 0.75 });
  } else if (stage === '第三产程') {
    applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true, scope: 'all' });
  }
  if (pregnant.effectiveLaborHours <= threshold) {
    if (stage === '第二产程' && presentingFetus) {
      const firstFetus = presentingFetus;
      const fetalAngle = Number.isFinite(Number(firstFetus?.tendencyAngle)) ? wrapAngle(firstFetus.tendencyAngle) : 0;
      const positionDifficulty = calculatePositionDifficulty(fetalAngle, firstFetus);
      const fetalWeight = clampNumber(firstFetus?.weight, 0.33, 3.0, 1.0);
      notify.secondly = phase === '间歇期'
        ? `${female}正在第${pregnant.laborBirthNumber}胎娩出后的间歇期`
        : `${female}正处于第${pregnant.laborBirthNumber}胎的${phase}，胚位${fetalAngle.toFixed(1)}°，难度${positionDifficulty.toFixed(2)}，胎重${fetalWeight.toFixed(2)}，进度${pregnant.effectiveLaborHours.toFixed(2)}/${threshold.toFixed(2)}小时`;
    } else {
      if (stage === '第一产程') {
        notify.secondly = `${female}正处于第一产程的${phase}`;
      } else {
        notify.secondly = phase === '产后观察'
          ? `${female}已进入产后观察，疼痛与出血状况正在监测`
          : `${female}正在娩出供养器官，进度${pregnant.effectiveLaborHours.toFixed(2)}/${threshold.toFixed(2)}小时`;
      }
    }
    profile.notify = notify;
    return done(false);
  }

  if (stage === '第一产程') {
    if (phase === '潜伏期') {
      beginLaborPhase(pregnant, '活跃期', 0);
      updateLaborPain(profile, stage, '活跃期', 0);
      profile.notify = { ...notify, firstly: `${female}进入了第一产程·活跃期`, secondly: `${female}的规律宫缩明显加强` };
      return next(false);
    }
    if (phase === '活跃期') {
      beginLaborPhase(pregnant, '过渡期', 0);
      updateLaborPain(profile, stage, '过渡期', 0);
      profile.notify = { ...notify, firstly: `${female}进入了第一产程·过渡期`, secondly: `${female}的分娩疼痛与压迫感进一步攀升` };
      return next(false);
    }
    base.stage = '第二产程';
    base.days = 0;
    beginLaborPhase(pregnant, '胎体下降', 1);
    updateLaborPain(profile, '第二产程', '胎体下降', 0);
    profile.notify = { ...notify, firstly: `${female}进入了第二产程·第1胎体下降`, secondly: `${female}开始推动胎儿下降` };
    return next(true);
  }

  if (stage === '第二产程') {
    if (phase === '胎体下降') {
      beginLaborPhase(pregnant, '胎体娩出', pregnant.laborBirthNumber);
      updateLaborPain(profile, stage, '胎体娩出', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程·第${pregnant.laborBirthNumber}胎体娩出`,
        secondly: `${female}的第${pregnant.laborBirthNumber}胎开始娩出`,
      };
      return next(false);
    }
    if (phase === '间歇期') {
      const nextIndex = clampNumber(pregnant.laborBirthNumber, 1, 99, 1) + 1;
      beginLaborPhase(pregnant, '胎体下降', nextIndex);
      updateLaborPain(profile, stage, '胎体下降', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程·第${nextIndex}胎体下降`,
        secondly: `${female}开始推动下一胎下降`,
      };
      return next(false);
    }
    // 胎体娩出走完：先露部已出（3），再做胎体完成检查；没受阻就在同一次结算完成出生
    const crowning = getPresentingFetus(pregnant);
    if (crowning) crowning.descentStage = DESCENT_CROWNED_OUT;
    if (crowning && isShoulderDystocia(profile, crowning)) {
      crowning.shoulderDystocia = true;
      pregnant.effectiveLaborHours = threshold;
      updateLaborPain(profile, stage, phase, 1, true);
      profile.notify = {
        ...notify,
        firstly: `${female}发生难产警示：胎头已出但肩部卡住（肩难产），${OBSTRUCTION_ADVICE.shoulder_dystocia}或使用 bsChildbirth 进行手术产`,
        secondly: `${female}的第${pregnant.laborBirthNumber}胎胎头已经娩出，但肩部卡住，无法自然完成分娩`,
      };
      return done(false);
    }
    if (deliverPresentingFetus(profile, female, notify)) return next(base.stage !== stage);
    base.stage = '第三产程';
    base.days = 0;
    beginLaborPhase(pregnant, '供养器官娩出', 0);
    updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
    return next(true);
  }

  if (stage === '第三产程') {
    if (phase === '供养器官娩出') {
      beginLaborPhase(pregnant, '产后观察', 0);
      updateLaborPain(profile, stage, '产后观察', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第三产程·产后观察`,
        secondly: `${female}的供养器官已娩出，开始观察产后状态`,
      };
      return next(false);
    }
    return done(applyChildbirthInternal(profile, female, true));
  }

  return done(false);
}

function applyEmergencyContraception(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  const skip = (message) => ({ applied: false, message: `bsAbortion emergency skipped: ${message}` });
  if (!character) return skip('未知角色。');
  if (args.force || args.fetusIndex !== undefined) return skip('事后避孕不可 force 或指定 fetusIndex。');
  const profile = character.profile;
  const stage = profile.base?.stage;
  if (isTruePregnancyStage(stage) || stage === WOMB_RETURN_STAGE) return skip('已着床妊娠不适用事后避孕。');
  if (profile.immune?.miscarriage) return skip('受既有保护限制，不自动绕过。');
  const fetuses = profile.pregnant?.fetuses || [];
  const contacts = profile.base?.spermContacts || [];
  const now = Number(chatState.minutesPassed) || 0;
  const targets = contacts.filter((x) => !x.blocked && (x.value > 0 || fetuses.some((f) => f.contactIds?.includes(x.id))));
  const unknownResidue = (profile.base?.sperms || []).some((s) => Number(s.value) > contacts.filter((x) => x.male === s.male).reduce((sum, x) => sum + x.value, 0) + 0.000001);
  if (unknownResidue || fetuses.some((x) => !x.contactIds?.length || x.contactIds.some((id) => !contacts.some((contact) => contact.id === id))) || targets.some((x) => !Number.isFinite(x.minutesPassed) || x.minutesPassed > now)) return skip('旧接触缺少时间或来源，无法结算；请补接触来源时间。');
  if (!targets.length) return skip('无既有可处理接触，不建立长期保护。');
  if (fetuses.some((x) => x.contactIds?.length > 1 && !x.contactEmbryos?.length)) return skip('融合胚胎缺少构成来源，无法安全分离旧资料。');
  const next = cloneValue(character);
  const config = normalizeReproductiveSettings(chatState.reproductiveSettings);
  const windowMinutes = getImplantationDays(profile) * 1440;
  const outcomes = targets.map((x) => {
    const probability = config.emergencyEffectiveness * Math.max(0, 1 - (now - x.minutesPassed) / windowMinutes);
    return { contactId: x.id, probability, success: Math.random() < probability };
  });
  const succeeded = new Set(outcomes.filter((x) => x.success).map((x) => x.contactId));
  for (const contact of next.profile.base.spermContacts) if (succeeded.has(contact.id)) contact.blocked = true;
  const pregnant = next.profile.pregnant;
  const remaining = [];
  for (const fetus of next.profile.pregnant.fetuses) {
    if (fetus.contactIds.every((id) => succeeded.has(id))) continue;
    if (fetus.contactEmbryos && fetus.contactIds.some((id) => succeeded.has(id))) {
      const survivors = fetus.contactEmbryos.filter((part) => !part.contactIds.every((id) => succeeded.has(id)));
      if (survivors.length === 1) remaining.push({ ...survivors[0], embryoId: fetus.embryoId });
      else remaining.push(fetus);
    } else remaining.push(fetus);
  }
  pregnant.fetuses = remaining;
  pregnant.fetusesCount = pregnant.fetuses.length;
  if (!pregnant.fetuses.length) next.profile.base.fertilizationDays = 0;
  next.profile.lastEmergencyResult = { minutesPassed: now, windowMinutes, outcomes };
  chatState.characters[female] = next;
  return { applied: true, message: `事后避孕尝试已结算：${outcomes.filter((x) => x.success).length}/${outcomes.length} 次接触成功。可见残留不清除，无未来保护；下轮承接，系统结果不等于角色知情。` };
}

function applyAbortion(chatState, args) {
  if (args?.purpose === 'emergency') return applyEmergencyContraception(chatState, args);
  if (args?.purpose !== undefined && !['termination', 'miscarriage'].includes(args.purpose)) return { applied: false, message: 'bsAbortion purpose 无效。' };
  const female = String(args?.female || '').trim();
  const force = Boolean(args?.force);
  const fetusIndex = args?.fetusIndex;
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsAbortion skipped: unknown character ${female || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const experience = profile.experience || {};
  const immune = profile.immune || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((item) => ({ ...item })) : [];
  const hasConceptionState = fetuses.length > 0 || clampNumber(base.fertilizationDays, 0, 9999, 0) > 0 || isPregnancyStage(stage);

  if (!hasConceptionState) {
    return { applied: false, message: `bsAbortion skipped for ${female}: no conception state.` };
  }

  if (stage === '延产期') {
    return { applied: false, message: `bsAbortion skipped for ${female}: 延产期间不能终止妊娠，需先调用 bsExtendPregnancy（action=induce）引产进入产兆前驱。` };
  }

  // 假孕期没有胎儿：结束假孕请走 bsSetMenstrualPhases，不该记进流产经验
  if (stage === '假孕期' && fetuses.length === 0) {
    return { applied: false, message: `bsAbortion skipped for ${female}: 假孕期无胎儿，请用 bsSetMenstrualPhases 结束假孕。` };
  }

  if (immune.miscarriage && !force) {
    profile.notify = {
      ...notify,
      secondly: `${female}的胚胎受到保护，流产无效，胚胎依旧留着`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: false, message: `bsAbortion skipped for ${female}: miscarriage immune.` };
  }

  // fetusIndex 是模型在 prompt 里看到的可见列表下标；未揭晓的异期胎不在那份列表里，
  // 直接拿去索引完整阵列会减错胎，甚至拿掉角色还不知道存在的那一胎
  const targetFetus = fetusIndex === undefined ? null : resolveVisibleFetus(fetuses, fetusIndex);
  if (fetusIndex !== undefined && !targetFetus) {
    return { applied: false, message: `bsAbortion skipped for ${female}: invalid fetusIndex.` };
  }

  if (targetFetus) {
    const removedFetus = fetuses.splice(fetuses.indexOf(targetFetus), 1)[0];
    // 宿主没了，套在它体内的那一胎也活不下来
    const removedEmbryoId = Number(removedFetus?.embryoId);
    if (Number.isFinite(removedEmbryoId)) {
      for (let index = fetuses.length - 1; index >= 0; index -= 1) {
        if (Number(fetuses[index]?.nestedInEmbryoId) === removedEmbryoId) fetuses.splice(index, 1);
      }
    }
    pregnant.fetuses = fetuses;
    pregnant.fetusesCount = fetuses.length;
    profile.pregnant = pregnant;
    updateFetalEnergyDrain(profile);
    if (fetuses.length > 0) applyPregnancyPhysiology(profile, next.runtime || {});
    if (fetuses.length > 0) {
      const gender = String(removedFetus?.gender || '未知');
      const race = String(removedFetus?.race || '未知');
      profile.notify = {
        ...notify,
        secondly: `${female}的第${fetusIndex + 1}胎（${gender}，${race}）消失了`,
      };
      next.profile = profile;
      chatState.characters[female] = next;
      return { applied: true, message: `bsAbortion reduced fetus count for ${female}.` };
    }
  }

  // 回归期中断＝没能成为胎儿，但她不会被吐回来：这一路走的是「消化吸收」，
  // 回归者就此并入承载者，角色维持冻结、不恢复原状。
  // 胎内回归本来就分两种玩法——重生与消化，中断这条正是后者。
  const digestedReturner = stage === WOMB_RETURN_STAGE
    ? String(pregnant.wombReturn?.returner || '').trim()
    : '';

  const recoveryDays = settlePostpartumRecoveryDays(profile, { miscarriage: true });
  clearPregnancyState(profile);
  restorePregnancyPhysiology(profile, next.runtime || {});

  if (stage === WOMB_RETURN_STAGE) {
    base.stage = '卵泡期';
    base.days = 0;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了卵泡期`,
      secondly: digestedReturner
        ? `${digestedReturner}在${female}体内被消化吸收，成了她的一部分`
        : `${female}体内的回归者被消化吸收了`,
    };
  } else if (MENSTRUAL_STAGES.includes(stage)) {
    base.stage = '卵泡期';
    base.days = 0;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了卵泡期`,
      secondly: `${female}避孕成功`,
    };
  } else {
    assignPostpartumRecoveryDays(profile, recoveryDays);
    base.stage = '产后恢复';
    base.days = 0;
    const lossField = args.purpose === 'miscarriage' ? 'miscarriageExperience' : 'abortionExperience';
    experience[lossField] = clampNumber(experience[lossField], 0, 999, 0) + 1;
    profile.experience = experience;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了产后恢复`,
      secondly: `${female}流产了`,
    };
  }

  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsAbortion applied to ${female}.` };
}

/**
 * 植入外源胚胎：代孕、胚胎移植、虫母注卵、寄生产卵。
 *
 * 与自然受精的差别在于胚胎的遗传来源与承载者分离。工具只把受精卵加入
 * 共用 fertilizationDays 窗口，不直接完成着床；遗传资料由 race/fatherRace 描述，
 * provider 只记录母源归属。单一母源出生后自动转交，多母源嵌合体留在孕母名下。
 */
function applyImplantEmbryo(chatState, args) {
  if (String(chatState.characters?.[String(args?.female || '').trim()]?.profile?.base?.stage || '') === WOMB_RETURN_STAGE) {
    return { applied: false, message: 'bsImplantEmbryo skipped: 回归期中不能植入其他胚胎。' };
  }
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsImplantEmbryo skipped: unknown character ${female || '(empty)'}.` };
  }
  const provider = String(args?.provider || '').trim();
  if (!provider) {
    return { applied: false, message: `bsImplantEmbryo skipped for ${female}: provider is required.` };
  }
  if (provider === female) {
    return { applied: false, message: `bsImplantEmbryo skipped for ${female}: provider must differ from the carrier; use natural conception instead.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const currentStage = String(base.stage || '');
  const existingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const isAdditionalSurrogacy = isPregnancyStage(currentStage);
  if (isAdditionalSurrogacy) {
    if (currentStage !== SUPERFETATION_STAGE || getImplantedFetuses(profile).length === 0) {
      return { applied: false, message: `bsImplantEmbryo skipped for ${female}: additional implantation is only available during early pregnancy.` };
    }
    const windowDays = getSuperfetationWindowDays(profile);
    const conceivedAtDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
    if (windowDays <= 0 || conceivedAtDays >= windowDays) {
      return { applied: false, message: `bsImplantEmbryo skipped for ${female}: the superfetation window has closed.` };
    }
  }

  const count = Math.max(1, Math.min(50, Math.floor(Number(args?.count) || 1)));
  const fathers = String(args?.fathers || '').trim() || '未知';
  // provider 只负责归属；遗传资料来自 race/fatherRace 描述符。
  // race 未提供时，已注册 provider 的状态仅作为兼容性预设，不依赖 provider 名称一定可解析。
  const providerCharacter = chatState.characters?.[provider];
  const explicitRace = String(args?.race || '').trim();
  const providerRace = String(providerCharacter?.profile?.base?.race || '').trim();
  const geneticDescriptor = explicitRace
    ? parseRaceDescriptor(explicitRace)
    : {
      race: parseRaceDescriptor(providerRace || base.race || '人类').race || '人类',
      derivedType: providerCharacter?.profile?.base?.derivedType
        ? String(providerCharacter.profile.base.derivedType)
        : null,
    };
  const geneticRace = geneticDescriptor.race || '人类';
  const fatherRaceText = String(args?.fatherRace || '').trim();
  const fatherDescriptor = parseRaceDescriptor(fatherRaceText || geneticRace);
  const geneticProfile = { base: { race: geneticRace, ...getBloodlineInfo(geneticRace,
    geneticDescriptor.bloodline ?? (providerRace === geneticRace ? providerCharacter?.profile?.base?.bloodline : null),
    geneticDescriptor.bloodline ? 'explicit' : providerCharacter?.profile?.base?.bloodlineSource) } };
  const spermSeed = {
    male: fathers,
    race: fatherDescriptor.race || geneticRace,
    ...getBloodlineInfo(fatherDescriptor.race || geneticRace, fatherDescriptor.bloodline
      ?? chatState.characters?.[fathers]?.profile?.base?.bloodline,
      fatherDescriptor.bloodline ? 'explicit' : chatState.characters?.[fathers]?.profile?.base?.bloodlineSource),
    // 所有外部遗传衍生类型都占父系槽：fatherRace 明示者优先，否则退回卵源 race。
    derivedType: fatherDescriptor.derivedType || geneticDescriptor.derivedType || null,
  };

  const hadPendingImplantation = existingFetuses.some((fetus) => !isImplantedFetus(fetus));
  ensureEmbryoMetadata(pregnant);
  for (let index = 0; index < count; index += 1) {
    const fetus = createSimpleFetus(profile, spermSeed, currentStage, { geneticProfile, provider });
    if (isAdditionalSurrogacy) markSuperfetationFetus(profile, fetus);
    existingFetuses.push(fetus);
  }
  pregnant.fetuses = existingFetuses;
  ensureEmbryoMetadata(pregnant);
  pregnant.fetusesCount = existingFetuses.length;
  if ((!isAdditionalSurrogacy && existingFetuses.length === count) || (isAdditionalSurrogacy && !hadPendingImplantation)) {
    base.fertilizationDays = 0;
  }

  profile.base = base;
  profile.pregnant = pregnant;
  updateFetalEnergyDrain(profile);
  profile.notify = {
    ...notify,
    secondly: isAdditionalSurrogacy
      ? `${female}在孕早期追加了${count}个来自${provider}的代孕异期胚胎，正等待共同著床窗口`
      : `${female}加入了${count}个来自${provider}的受精卵，正等待共同著床窗口`,
  };
  if (!isAdditionalSurrogacy) setVisualCue(profile, 'surrogacy');

  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsImplantEmbryo applied to ${female}: ${count} pre-implantation embryo(s) from ${provider}.` };
}
/** 破水只允许在已进入产兆前驱后作为转入正式产程的受控事件。 */
const RUPTURE_ALLOWED_PRELABOR_STAGES = Object.freeze(['产兆前驱']);
/** 产兆前驱中破水所需的宫压门槛。 */
const RUPTURE_PRESSURE_RATIO = 0.66;

/**
 * 破水。
 *
 * 设定上产程前 amnionDurability 恒 ≥ 1（任何磨损只让羊膜变薄），
 * 所以模型经常写出系统层面不可能发生的破水叙事，两边就此脱节。
 * 这里给出唯一一条受控入口：条件足够才破，并直接推进第一产程；
 * 条件不足则明确拒绝，让模型知道该改写叙事而不是继续假设已破水。
 */
/**
 * 破水：只在产兆前驱（宫压达上限 66%）与第一、第二产程开放，破指定胎儿的胎囊（同卵共囊一起破）。
 * 设定上产程前羊膜恒 ≥ 1，模型却常自行写出破水；这里是唯一受控的入口，条件不足就明确拒绝。
 * 孕中孕内胎的胎囊在宿主体内：破了是宿主在宫内把它生出来，不算母亲破水、不需宫压门槛、不发动产程。
 * 回传 { applied, message, summary }；成功时已改写 profile。
 */
function ruptureFetalSac(profile, female, target) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const stage = String(base.stage || '');
  const inPrelabor = RUPTURE_ALLOWED_PRELABOR_STAGES.includes(stage);
  const inLabor = ['第一产程', '第二产程'].includes(stage);
  const reject = (reason) => ({ applied: false, message: `bsAssistFetalPosition skipped for ${female}: ${reason}` });
  if (!inPrelabor && !inLabor) return reject(`stage ${stage || '(none)'} cannot rupture; do not narrate rupture yet.`);
  if (isSealedNestedFetus(target, fetuses)) {
    return reject("this fetus is sealed inside a 胎转卵生 host's hardened shell; its membrane cannot break on its own, and it will be born together with the host.");
  }
  const sac = getSacOfFetus(pregnant, target);
  if (!sac) return reject('that fetus is not implanted and has no sac yet.');
  if (getSacDurability(sac) <= 0) return reject('already ruptured.');

  if (getEnclosingHost(target, fetuses)) {
    setSacDurability(sac, 0);
    cueRupture(profile, [sac]);
    releaseRupturedNestedFetuses(pregnant);
    return { applied: true, summary: `${female}腹中那一胎体内的胎膜破了，里面的孩子脱离出来，成为独立的一胎` };
  }
  if (inPrelabor) {
    const pressureCap = getUterinePressureCap(profile);
    if (clampNumber(base.uterinePressure, 0, pressureCap, 0) < pressureCap * RUPTURE_PRESSURE_RATIO) {
      return reject('uterine pressure too low to rupture; do not narrate rupture yet.');
    }
  }
  setSacDurability(sac, 0);
  cueRupture(profile, [sac]);
  if (!inPrelabor) return { applied: true, summary: `${female}破水了` };
  base.stage = '第一产程';
  base.days = 0;
  beginLaborPhase(pregnant, '潜伏期', 0);
  updateLaborPain(profile, '第一产程', '潜伏期', 0);
  clearProdromalState(pregnant);
  profile.notify = { ...notify, firstly: `${female}进入了第一产程` };
  return { applied: true, summary: `${female}破水了，分娩正式开始` };
}

function applyChildbirth(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsChildbirth skipped: unknown character ${female || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  if (getImplantedFetuses(profile).length === 0) {
    return { applied: false, message: `bsChildbirth skipped for ${female}: no fetuses.` };
  }
  const childbirthStage = String(profile?.base?.stage || '');
  if (childbirthStage === '延产期') {
    return { applied: false, message: `bsChildbirth skipped for ${female}: 延产期间不能手术分娩，需先调用 bsExtendPregnancy（action=induce）引产进入产兆前驱。` };
  }
  const childbirthAllowedStages = ['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '第一产程', '第二产程', '第三产程'];
  if (!childbirthAllowedStages.includes(childbirthStage)) {
    return { applied: false, message: `bsChildbirth skipped for ${female}: stage ${childbirthStage || '(none)'} 不允许手术分娩（需已着床进入妊娠阶段）。` };
  }
  // 剧情抢在第二产程前写出自然分娩时，没有别的工具能如实记录；孕早、中期的娩出是流产，不算分娩
  const natural = args?.mode === 'natural';
  if (natural && ['孕早期', '孕中期'].includes(childbirthStage)) {
    return { applied: false, message: `bsChildbirth skipped for ${female}: ${childbirthStage}不能自然分娩；胎儿娩出属于流产。` };
  }

  profile.__runtimeRef = next.runtime || {};
  applyChildbirthInternal(profile, female, natural);
  delete profile.__runtimeRef;
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  transferProviderChildren(chatState);
  return { applied: true, message: `bsChildbirth applied to ${female}.` };
}

// ── 产兆前驱的时间位移 ──────────────────────────────────
/**
 * 把产兆前驱剩余时间加减 deltaHours（托高 +T/2、促降 -T/2），领头胎儿的位置随之推导。
 * 真实产程：分娩只能延后、不能取消，累计延后上限为初始时长的 100%。
 * 非真实产程：累计延后满一个初始时长就退回对应的妊娠阶段。剩余时间归零即进入第一产程。
 * 回传 { outcome: 'first_stage' | 'regressed' | 'shifted' | 'capped', deltaHours, remainingHours }。
 */
function shiftProdromalTime(profile, female, deltaHours) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const realisticLabor = isRealisticLabor(profile);
  const initialHours = getProdromalInitialHours(profile);
  const currentProgress = Math.max(0, clampNumber(pregnant.prodromalDelayProgressHours, 0, 9999, 0));
  let delta = deltaHours;
  if (realisticLabor && delta > 0) {
    delta = Math.max(0, Math.min(delta, (initialHours * REALISTIC_PRODROMAL_DELAY_CAP_RATIO) - currentProgress));
    if (delta <= 0) return { outcome: 'capped', deltaHours: 0, remainingHours: clampNumber(pregnant.prodromalRemainingHours, 0, 9999, initialHours) };
  }
  const remainingHours = clampNumber(pregnant.prodromalRemainingHours, 0, 9999, initialHours) + delta;
  const progressHours = Math.max(0, currentProgress + delta);
  pregnant.prodromalRemainingHours = Math.max(0, remainingHours);
  pregnant.prodromalDelayProgressHours = progressHours;
  updateLaborPain(profile, '产兆前驱', null, 1 - (Math.max(0, remainingHours) / initialHours));

  if (remainingHours <= 0) {
    base.stage = '第一产程';
    base.days = 0;
    beginLaborPhase(pregnant, '潜伏期', 0);
    updateLaborPain(profile, '第一产程', '潜伏期', 0);
    clearProdromalState(pregnant);
    profile.notify = { ...notify, firstly: `${female}进入了第一产程`, secondly: `${female}的产兆前驱提前结束，正式进入分娩` };
    return { outcome: 'first_stage', deltaHours: delta, remainingHours: 0 };
  }
  if (progressHours >= initialHours && !realisticLabor) {
    const target = derivePregnancyStageState(clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0), 1);
    base.stage = target.stage;
    base.days = target.days;
    base.uterinePressure = Math.floor(clampNumber(base.uterinePressure, 0, 9999, 0) * 0.25);
    pregnant.laborPhase = null;
    pregnant.laborBirthNumber = 0;
    pregnant.presentingEmbryoId = null;
    pregnant.laborHours = 0;
    pregnant.effectiveLaborHours = 0;
    pregnant.laborPain = 0;
    pregnant.assistPainBoost = 0;
    clearProdromalState(pregnant);
    profile.notify = { ...notify, firstly: `${female}进入了${target.stage}`, secondly: `${female}的分娩前兆缓解，回到${target.stage}` };
    return { outcome: 'regressed', deltaHours: delta, remainingHours };
  }
  return { outcome: 'shifted', deltaHours: delta, remainingHours };
}

// ── 助产与明确的胎位操作 ────────────────────────────────
// 通过检查就必定成功；难度完全由检查条件与活力门槛表现。
// 托高是跟宫缩对抗，要母体撑得住：活力不足就拒绝，状态完全不变。
const ASSIST_PAIN_BOOST_CAP = 5;
const ASSIST_ACTIONS = Object.freeze(['rotate', 'lift', 'descend', 'rupture', 'extract']);
/** 各动作的瞬时痛感（产程相关阶段）；孕期改为心理压力 × 2 */
const ASSIST_PAIN = Object.freeze({ lift: 2, descend: 1.5, rotate: 2, extract: 3, rupture: 0.5 });
/** 活力消耗倍率：托高吃满，顺着宫缩促降与转位减半，外力完成的拉出与破水不扣 */
const ASSIST_VITALITY_SHARE = Object.freeze({ lift: 1, descend: 0.5, rotate: 0.5, extract: 0, rupture: 0 });
/** 已入盆或在产道中的胎儿只能小幅转动 */
const ENGAGED_ROTATION_LIMIT = 30;

function getTendencyAngleLabel(angle) {
  const normalized = wrapAngle(angle);
  if (normalized <= 15 || normalized >= 345) return '头位';
  if (normalized >= 165 && normalized <= 195) return '臀位';
  if (isTransversePosition(normalized)) return '横位';
  return `斜位（${Math.round(normalized)}°）`;
}

function getAssistVitalityCost(profile, fetus, action) {
  const share = ASSIST_VITALITY_SHARE[action] || 0;
  if (share <= 0) return 0;
  const pressureCap = getUterinePressureCap(profile);
  const pressureRatio = clampNumber(profile?.base?.uterinePressure, 0, pressureCap, 0) / Math.max(pressureCap, 1);
  const depthFactor = getDescentStage(fetus) >= DESCENT_INLET ? 1.5 : 1.0;
  return Math.round(10 * clampNumber(fetus?.weight, 0.33, 3.0, 1.0) * (1 + pressureRatio) * depthFactor * share * 10) / 10;
}

function isLaborRelatedStage(stage) {
  return stage === '产兆前驱' || LABOR_STAGES.includes(stage);
}

/**
 * 操作留下的负担：产程相关阶段叠加瞬时痛感（上限 +5，并立即反映在 laborPain），
 * 孕期平时不发送 laborPain，改为提高心理压力。
 */
function applyAssistStrain(profile, action) {
  applyStrain(profile, ASSIST_PAIN[action] || 0);
}

function applyStrain(profile, amount) {
  if (!(amount > 0)) return;
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  if (isLaborRelatedStage(String(base.stage || ''))) {
    const before = clampNumber(pregnant.assistPainBoost, 0, ASSIST_PAIN_BOOST_CAP, 0);
    const after = Math.min(ASSIST_PAIN_BOOST_CAP, before + amount);
    pregnant.assistPainBoost = after;
    pregnant.laborPain = Math.round(clampNumber(clampNumber(pregnant.laborPain, 0, 10, 0) + (after - before), 0, 10, 0) * 10) / 10;
  } else {
    const stressCap = getPsyStressInitByLevel(base.psyStressLevel) * 2;
    base.psyStress = clampNumber(clampNumber(base.psyStress, 0, 9999, 0) + (amount * 2), 0, stressCap, base.psyStress || 0);
  }
}

/** 瞬时痛感随时间消退：每小时减半，太小就归零 */
function decayAssistPainBoost(profile, deltaMinutes) {
  const pregnant = profile?.pregnant;
  if (!pregnant || !(deltaMinutes > 0)) return;
  const boost = clampNumber(pregnant.assistPainBoost, 0, ASSIST_PAIN_BOOST_CAP, 0) * (0.5 ** (deltaMinutes / 60));
  pregnant.assistPainBoost = boost < 0.05 ? 0 : Math.round(boost * 100) / 100;
}

// ── 插入对胎儿的推顶 ─────────────────────────────────────
// 产兆前驱与产程中，每次 insert 都会顶到最前面的那一胎：前驱领头胎儿被往上顶（延后前驱），
// 产道里的先露胎被顶回（扣掉这段产程的进度），着冠时扣得更多、更痛、更伤胎膜。
// 第一产程只入盆（宫颈未全开）只会痛；先露部已出或肩难产时没有东西可推。
// 被顶的胎儿亲和重挫（反正快出生了，扣重一点才有感）。真实分娩模式倒退得较多。
// 反过来，产兆前驱中射进的精液会催熟子宫颈，缩短前驱。
const INSERT_PUSHBACK = Object.freeze({
  prodromal: { delayShare: 0.25, pain: 1, affinity: -2 },
  inlet: { pain: 1, affinity: -3 },
  canal: { progressShare: 0.3, pain: 2, wear: 25, affinity: -5 },
  crowned: { progressShare: 0.5, pain: 3, wear: 50, affinity: -8 },
});
/** 非真实分娩模式的产程倒退打折 */
const GENTLE_PUSHBACK_FACTOR = 0.6;
/** 产兆前驱中每次射精缩短前驱的比例（占初始时长） */
const PRODROMAL_SEMEN_SHARE = 0.125;

function lowerAffinity(fetus, amount) {
  fetus.affinity = clampNumber(clampNumber(fetus.affinity, -50, 50, 0) + amount, -50, 50, 0);
}

function getFetusLabel(pregnant, fetus) {
  const visible = (Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : []).filter(isFetusKnownToCharacter);
  const index = visible.indexOf(fetus);
  return index >= 0 ? `第${index + 1}胎` : '胎儿';
}

/** 插入时的推顶；回传要写进通知的句子，没有作用时回传空字串 */
function applyInsertionPushback(profile, female) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];

  if (stage === '产兆前驱') {
    const lead = fetuses.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId);
    if (!lead) return '';
    const rule = INSERT_PUSHBACK.prodromal;
    const label = getFetusLabel(pregnant, lead);
    const shift = shiftProdromalTime(profile, female, getProdromalInitialHours(profile) * rule.delayShare);
    applyStrain(profile, rule.pain);
    lowerAffinity(lead, rule.affinity);
    if (shift.outcome === 'regressed') return `${female}腹中领头的${label}被插入顶了回去，分娩前兆随之平息`;
    if (shift.outcome === 'capped') return `${female}腹中领头的${label}被插入顶到，但分娩已延后到上限，无法再推迟`;
    return `${female}腹中领头的${label}被插入往上顶，产兆前驱延后约${Math.round(shift.deltaHours)}小时（剩余约${Math.ceil(shift.remainingHours)}小时）`;
  }
  if (stage !== '第一产程' && stage !== '第二产程') return '';

  reconcileFetalDescent(profile);
  const presenting = fetuses.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId);
  if (!presenting || presenting.shoulderDystocia) return '';
  const depth = getDescentStage(presenting);
  if (depth < DESCENT_INLET || depth >= DESCENT_CROWNED_OUT) return '';
  const label = getFetusLabel(pregnant, presenting);
  const phase = String(pregnant.laborPhase || '');

  if (stage === '第一产程' || depth === DESCENT_INLET || !['胎体下降', '胎体娩出'].includes(phase)) {
    const rule = INSERT_PUSHBACK.inlet;
    applyStrain(profile, rule.pain);
    lowerAffinity(presenting, rule.affinity);
    return `${female}被插入时隔着子宫颈顶到入盆的${label}，一阵剧痛`;
  }

  const crowned = depth >= 2;
  const rule = crowned ? INSERT_PUSHBACK.crowned : INSERT_PUSHBACK.canal;
  const threshold = resolveLaborPhaseHours(profile, stage, phase, fetuses);
  const factor = isRealisticLabor(profile) ? 1 : GENTLE_PUSHBACK_FACTOR;
  const progress = clampNumber(pregnant.effectiveLaborHours, 0, 9999, 0);
  const lost = Math.min(progress, threshold * rule.progressShare * factor);
  pregnant.effectiveLaborHours = progress - lost;
  applyStrain(profile, rule.pain);
  lowerAffinity(presenting, rule.affinity);
  const parts = [crowned
    ? `${female}被插入时顶到已着冠的${label}胎头，把它往回顶`
    : `${female}被插入时把产道里的${label}往回顶`];
  parts.push(lost > 0.05 ? `产程进度倒退约${lost.toFixed(1)}小时` : '这段产程才刚开始，没再倒退');

  const sac = getSacOfFetus(pregnant, presenting);
  if (sac && getSacDurability(sac) > 0) {
    const worn = getSacDurability(sac) - rule.wear;
    if (worn > 0) {
      setSacDurability(sac, worn);
    } else {
      const rupture = ruptureFetalSac(profile, female, presenting);
      if (rupture.applied) parts.push(`胎膜被顶破，${rupture.summary}`);
    }
  }
  return parts.join('，');
}

/** 产兆前驱中沉积的精液催熟子宫颈，缩短前驱；回传通知句子或空字串 */
function applyProdromalSemenRipening(profile, female) {
  const pregnant = profile.pregnant || {};
  if (String(profile?.base?.stage || '') !== '产兆前驱' || !pregnant.prodromalLeadEmbryoId) return '';
  const shift = shiftProdromalTime(profile, female, -getProdromalInitialHours(profile) * PRODROMAL_SEMEN_SHARE);
  if (shift.outcome === 'first_stage') return `${female}体内的精液刺激子宫颈成熟，分娩正式开始`;
  return `${female}体内的精液刺激子宫颈成熟，产兆前驱缩短约${Math.round(-shift.deltaHours)}小时（剩余约${Math.ceil(shift.remainingHours)}小时）`;
}

/** 省略 fetusIndex 时的目标：先露胎，否则前驱领头胎儿，否则最深者 */
function resolveAssistTarget(pregnant, fetusIndex) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  if (fetusIndex !== undefined && fetusIndex !== null) return resolveVisibleFetus(fetuses, fetusIndex);
  const free = getFreeFetuses(pregnant).filter(isFetusKnownToCharacter);
  return free.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId)
    || free.find((fetus) => fetus.embryoId === pregnant.prodromalLeadEmbryoId)
    || pickDeepestFetus(free);
}

function applyAssistFetalPosition(chatState, args) {
  const female = String(args?.female || '').trim();
  const action = String(args?.action || '').trim();
  const character = chatState.characters?.[female];
  const skip = (reason) => ({ applied: false, message: `bsAssistFetalPosition skipped for ${female || '(empty)'}: ${reason}` });
  if (!female || !character) return skip('unknown character.');
  if (!ASSIST_ACTIONS.includes(action)) return skip(`unknown action ${action || '(empty)'}.`);
  const actor = String(args?.actor || 'assist').trim();
  if (!['assist', 'fetus'].includes(actor)) return skip(`unknown actor ${actor}; use assist or fetus.`);
  // 胎儿自己动：力气是它的，不向母体收活力；但母体一样会痛
  const bySelf = actor === 'fetus';
  if (bySelf && action === 'extract') return skip('a fetus cannot pull itself out; extract needs an assistant.');

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0 || !(PREGNANCY_STAGES.includes(stage) || stage === '产兆前驱' || stage === '第一产程' || stage === '第二产程')) {
    return skip(`stage ${stage || '(none)'} has no fetus that can be positioned.`);
  }
  reconcileFetalDescent(profile);
  const target = resolveAssistTarget(pregnant, args?.fetusIndex);
  if (!target) return skip('invalid fetusIndex.');
  if (target.pendingImplantation) return skip('that embryo is not implanted yet.');
  // 内胎的胎囊可以单独破（等于被宿主生出来），其他操作都跟着宿主
  if (action !== 'rupture' && getEnclosingHost(target, fetuses)) {
    return skip('that fetus is still inside its host fetus and moves with it; act on the host instead.');
  }

  const visible = fetuses.filter(isFetusKnownToCharacter);
  const label = `第${visible.indexOf(target) + 1}胎`;
  const depth = getDescentStage(target);
  const obstruction = getLaborObstruction(profile);
  const isProdromalLead = stage === '产兆前驱' && target.embryoId === pregnant.prodromalLeadEmbryoId;
  const shoulderStuck = Boolean(target.shoulderDystocia);

  if (bySelf && action === 'rotate' && shoulderStuck) {
    return skip('the fetus cannot free its own stuck shoulder; it needs an assistant to rotate or extract it.');
  }

  // 活力门槛：肩难产发生时母体活力已归零，转动肩部是助产者的手法，不向母体收取活力；胎儿自己动也不收
  const cost = bySelf || (action === 'rotate' && shoulderStuck) ? 0 : getAssistVitalityCost(profile, target, action);
  const vitality = clampNumber(base.vitality, 0, 9999, 0);
  const requireVitality = () => (vitality < cost
    ? skip(`not enough vitality (needs ${cost}, has ${Math.round(vitality * 10) / 10}); the body cannot sustain this maneuver right now.`)
    : null);

  let summary = '';
  if (action === 'rotate') {
    const hasAngle = args?.targetAngle !== undefined && args?.targetAngle !== null && Number.isFinite(Number(args.targetAngle));
    const hasBackSide = args?.backSide !== undefined && args?.backSide !== null && String(args.backSide).trim() !== '';
    const desiredBack = hasBackSide ? normalizeBackSide(String(args.backSide).trim()) : null;
    if (hasBackSide && !desiredBack) return skip(`backSide must be one of ${BACK_SIDES.join('/')}.`);
    if (desiredBack && isShelledAtBirth(target)) return skip(`a ${target.embryoType} fetus is an egg and has no back to turn; use targetAngle only.`);
    if (!hasAngle && !desiredBack && !shoulderStuck) {
      return skip('rotate needs targetAngle (0/360 head-down, 180 breech, 90/270 transverse) or backSide.');
    }
    const current = Number.isFinite(Number(target.tendencyAngle)) ? wrapAngle(target.tendencyAngle) : 0;
    const desired = hasAngle ? wrapAngle(Number(args.targetAngle)) : current;
    if (!shoulderStuck && depth >= DESCENT_INLET && angleDistance(current, desired) > ENGAGED_ROTATION_LIMIT) {
      return skip(`the fetus is already engaged; it can only be corrected by up to ${ENGAGED_ROTATION_LIMIT} degrees.`);
    }
    // 入盆后胎背左右已经固定，只能前后对调（例如枕后位转成枕前位）
    if (desiredBack && depth >= DESCENT_INLET && normalizeBackSide(target.backSide) && desiredBack[0] !== target.backSide[0]) {
      return skip('the fetus is already engaged; its back can only be turned between anterior and posterior on the same side.');
    }
    const lacking = requireVitality();
    if (lacking) return lacking;
    const crowded = shoulderStuck ? { blocked: false, note: '' } : rotateAmongNeighbors(profile, fetuses, target, current, desired); if (crowded.blocked) return skip(crowded.message); target.tendencyAngle = desired;
    if (desiredBack) target.backSide = desiredBack;
    if (shoulderStuck) {
      delete target.shoulderDystocia;
      target.shoulderRelieved = true;
      summary = `${female}的${label}经转动解开了卡住的肩部`;
    } else {
      const parts = [hasAngle ? getTendencyAngleLabel(desired) : '', desiredBack ? `胎背朝${desiredBack}` : ''].filter(Boolean);
      summary = `${female}的${label}${bySelf ? '自己转到' : '被转到'}${parts.join('、')}${crowded.note}`;
    }
  } else if (action === 'lift') {
    if (depth >= 1) return skip('the fetus is already in the birth canal and cannot be pushed back.');
    if ((stage === '第一产程' || stage === '第二产程') && depth >= DESCENT_INLET) {
      return skip('during labor an engaged fetus cannot be pushed back; locked twins can only be turned apart with rotate.');
    }
    if (!isProdromalLead && depth <= DESCENT_TOP) return skip('the fetus is already at the top of the uterus.');
    const lacking = requireVitality();
    if (lacking) return lacking;
    if (isProdromalLead) {
      const shift = shiftProdromalTime(profile, female, getProdromalInitialHours(profile) / 2);
      if (shift.outcome === 'capped') return skip('realistic labor has already been delayed as far as it can go; labor can no longer be postponed.');
      const moved = bySelf ? '自己往上缩回' : '被向上托回';
      summary = shift.outcome === 'regressed'
        ? `${female}的${label}${bySelf ? '自己缩回高处' : '被托回高处'}，分娩前兆随之平息`
        : `${female}的${label}${moved}，产兆前驱延后约${Math.round(shift.deltaHours)}小时（剩余约${Math.ceil(shift.remainingHours)}小时）`;
    } else {
      target.descentStage = depth - 1;
      delete target.inletIntruder;
      summary = `${female}的${label}${bySelf ? '自己往上缩回' : '被向上托回'}`;
    }
  } else if (action === 'descend') {
    if (stage === '第一产程' || stage === '第二产程') return skip('during labor descent is driven by contractions; use time passing instead.');
    if (!isProdromalLead && depth >= getDescentCap(stage === '产兆前驱' ? '孕晚期' : stage)) {
      return skip(`the fetus cannot descend any further in ${stage}.`);
    }
    const lacking = requireVitality();
    if (lacking) return lacking;
    if (isProdromalLead) {
      const shift = shiftProdromalTime(profile, female, -getProdromalInitialHours(profile) / 2);
      summary = shift.outcome === 'first_stage'
        ? `${female}的${label}${bySelf ? '自己钻下入盆' : '被推下入盆'}，分娩正式开始`
        : `${female}的${label}${bySelf ? '自己往下钻' : '被向下推送'}，产兆前驱缩短约${Math.round(-shift.deltaHours)}小时（剩余约${Math.ceil(shift.remainingHours)}小时）`;
    } else {
      target.descentStage = depth + 1;
      summary = `${female}的${label}${bySelf ? '自己往下钻' : '被向下推送'}`;
    }
  } else if (action === 'rupture') {
    const result = ruptureFetalSac(profile, female, target);
    if (!result.applied) return result;
    summary = bySelf ? `${female}的${label}自己踢破了胎膜；${result.summary}` : result.summary;
  } else if (action === 'extract') {
    if (stage !== '第二产程') return skip('extract is only possible during the second stage of labor.');
    if (target.embryoId !== pregnant.presentingEmbryoId || depth < 1) {
      return skip('only the fetus currently descending in the birth canal (presenting, stage 1 or deeper) can be extracted.');
    }
    // 胎囊未破时先在同一次操作中破掉（同卵共囊一起）
    const sac = getSacOfFetus(pregnant, target);
    if (sac && getSacDurability(sac) > 0) {
      setSacDurability(sac, 0);
      cueRupture(profile, [sac]);
    }
    applyAssistStrain(profile, action);
    deliverPresentingFetus(profile, female, profile.notify || {}); // 不标「助产拉出」：extract 也用来同步剧情里已自己生下的那一胎
    reconcileFetalDescent(profile);
    next.profile = profile;
    chatState.characters[female] = syncCharacterStageFromProfile(next);
    return { applied: true, message: `bsAssistFetalPosition extract applied to ${female}.` };
  }

  if (cost > 0) base.vitality = Math.max(0, vitality - cost);
  applyAssistStrain(profile, action);
  reconcileFetalDescent(profile);
  profile.base = base;
  profile.pregnant = pregnant;
  profile.notify = { ...(profile.notify || {}), secondly: summary };
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsAssistFetalPosition ${action}${bySelf ? ' (by the fetus itself)' : ''} applied to ${female}.` };
}

function applyMaternalFetalInteraction(chatState, args) {
  const female = String(args?.female || '').trim();
  const direction = String(args?.direction || 'fetal').trim();
  const change = String(args?.change || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped: unknown character ${female || '(empty)'}.` };
  }

  const changeMap = Object.freeze({
    slight_increase: 0.5,
    significant_increase: 1,
    slight_decrease: -0.5,
    significant_decrease: -1,
  });
  const changeDisplayMap = Object.freeze({
    slight_increase: '轻微增加',
    significant_increase: '显著增加',
    slight_decrease: '轻微减少',
    significant_decrease: '显著减少',
  });
  const next = cloneValue(character);
  const profile = next.profile || {};
  const stage = String(profile?.base?.stage || '');
  // 延产期的胎儿被关得太久，对母体的情绪更敏感：亲和波动加倍（±1／±2）
  const affinitySwing = stage === '延产期' ? 2 : 1;
  const interactionCooldown = profile.cooldown || {};
  if (interactionCooldown.maternalFetalInteractionUsed) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: already changed during this story hour.` };
  }
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: no fetuses.` };
  }

  const cooldown = profile.cooldown || {};
  if (direction === 'sibling') return applySiblingInteraction(chatState, next, female, change); if (direction === 'maternal') {
    const selectedIndex = pickImplantedFetusIndex(fetuses);
    if (selectedIndex < 0) return { applied: false, message: 'bsMaternalFetalInteraction skipped: 没有已著床的胎儿。' };
    const selectedFetus = fetuses[selectedIndex];
    const maternalChangeKeys = Object.keys(changeMap);
    const maternalChange = maternalChangeKeys[randomInt(0, maternalChangeKeys.length - 1)];
    const maternalChangeValue = changeMap[maternalChange] * affinitySwing;
    const maternalChangeDisplay = changeDisplayMap[maternalChange];

    const psyStress = clampNumber(profile?.base?.psyStress, 0, 9999, 0);
    const success = Math.random() >= Math.min(1, psyStress / 200);
    // 失败只是没安抚到，胎位不受影响
    if (success) {
      const currentAffinity = clampNumber(selectedFetus?.affinity, -50, 50, 0);
      selectedFetus.affinity = clampNumber(currentAffinity + maternalChangeValue, -50, 50, 0);
    }
    pregnant.fetuses = fetuses;
    pregnant.fetusesCount = fetuses.length;
    profile.cooldown = {
      ...cooldown,
      maternalFetalInteractionUsed: true,
    };
    profile.pregnant = pregnant;
    profile.notify = {
      ...(profile.notify || {}),
      secondly: success
        ? `${female}安抚了第${selectedIndex + 1}胎，亲密度${maternalChangeDisplay}了`
        : `${female}尝试安抚第${selectedIndex + 1}胎，但因心理压力过大而失败，胎儿没有回应`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: maternal interaction.` };
  }

  const changeValue = changeMap[change] === undefined ? undefined : changeMap[change] * affinitySwing;
  if (changeValue === undefined) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: direction=fetal requires a valid change.` };
  }
  const selectedIndex = pickImplantedFetusIndex(fetuses);
  if (selectedIndex < 0) return { applied: false, message: 'bsMaternalFetalInteraction skipped: 没有已著床的胎儿。' };
  const selectedFetus = fetuses[selectedIndex];
  const currentAffinity = clampNumber(selectedFetus?.affinity, -50, 50, 0);
  selectedFetus.affinity = clampNumber(currentAffinity + changeValue, -50, 50, 0);

  pregnant.fetuses = fetuses;
  pregnant.fetusesCount = fetuses.length;
  profile.pregnant = pregnant;
  profile.cooldown = {
    ...cooldown,
    maternalFetalInteractionUsed: true,
  };

  const notify = profile.notify || {};
  const changeDisplay = changeDisplayMap[change];
  const targetName = `第${selectedIndex + 1}胎`;
  notify.secondly = `${targetName}对${female}的亲密度${changeDisplay}了`;
  profile.notify = notify;

  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}.` };
}

/**
 * 高潮排卵的冷却：月经期与产后恢复整个重置；进入黄体期时额外刷新一次。
 * 所以每个周期有两次机会：黄体期以前一次（含排卵期），黄体期一次——
 * 后者可以趁排卵期受精后再多怀几胎，没受精的卵也会带进孕早期，留给异期受孕。
 */
function nextOrgasmOvulationCooldown(stage, cooldown = {}) {
  if (shouldResetOrgasmOvulation(stage)) return { orgasmOvulationUsed: false, lutealOrgasmRefreshed: false };
  if (stage === '黄体期' && !cooldown.lutealOrgasmRefreshed) return { orgasmOvulationUsed: false, lutealOrgasmRefreshed: true };
  return {
    orgasmOvulationUsed: Boolean(cooldown.orgasmOvulationUsed),
    lutealOrgasmRefreshed: Boolean(cooldown.lutealOrgasmRefreshed),
  };
}

/** 一次高潮排卵：冷却中或假孕期不触发；排出 0 颗也算用掉这次机会 */
function applyEggGain(profile, amount) {
  const nextAmount = Math.max(0, Math.floor(Number(amount) || 0));
  const base = profile.base || {};
  const cooldown = profile.cooldown || {};
  if (String(base.stage || '') === '假孕期' || cooldown.orgasmOvulationUsed) return { applied: false };
  if (nextAmount > 0) {
    base.eggs = clampNumber(base.eggs, 0, 999, 0) + nextAmount;
    base.uterinePressure = clampNumber(base.uterinePressure, 0, 999, 0) + 2;
  }
  return { applied: true };
}

/** 额外排卵倾向的每一颗，以「当前活力 ÷ 活力上限」的机率排出：累垮时高潮也排不太出卵 */
function rollOrgasmOvulationEggs(profile, random = Math.random) {
  const tendency = Math.max(0, Math.round(clampNumber(profile?.bio?.orgasmOvulationAmount, 0, 100, 1)));
  const vitalityCap = Math.max(1, getVitalityInitByLevel(profile?.base?.vitalityLevel));
  const ratio = clampNumber(clampNumber(profile?.base?.vitality, 0, 9999, vitalityCap) / vitalityCap, 0, 1, 1);
  let eggs = 0;
  for (let index = 0; index < tendency; index += 1) if (random() < ratio) eggs += 1;
  return eggs;
}

function maybeTriggerOrgasmOvulation(character) {
  const next = character;
  const profile = next.profile || {};
  const cooldown = profile.cooldown || {};
  const bio = profile.bio || {};
  const base = profile.base || {};
  const notify = profile.notify || {};

  const currentLibido = clampNumber(base.libido, 0, 9999, 0);
  const libidoCap = getLibidoCap(profile);
  if (currentLibido < libidoCap || cooldown.orgasmOvulationUsed) return false;
  // 没有额外排卵倾向的物种（如精灵）不会因高潮排卵
  if (Math.round(clampNumber(bio.orgasmOvulationAmount, 0, 100, 1)) <= 0) return false;

  const amount = rollOrgasmOvulationEggs(profile);
  if (!applyEggGain(profile, amount).applied) return false;
  if (amount > 0) setVisualCue(profile, 'ovulation');
  base.libido = 0;
  profile.cooldown = { ...cooldown, orgasmOvulationUsed: true };
  profile.notify = {
    ...notify,
    secondly: amount > 0
      ? `${next.name}因高潮而额外排卵${amount > 1 ? ` ${amount} 颗` : ''}，性欲归零`
      : `${next.name}达到高潮，但体力不济，这次没有额外排卵，性欲归零`,
  };
  return true;
}

function getMenstrualCycleLength(profile) {
  const total = MENSTRUAL_STAGES.reduce((sum, stage) => sum + (getStageLimit(profile, stage) || 0), 0);
  return Math.max(1, total || 28);
}

function buildTimeTick(character, addedMinutes) {
  const runtime = character?.runtime || {};
  const dayCarryMinutes = clampNumber(runtime.dayCarryMinutes, 0, 24 * 60, 0);
  const hourCarryMinutes = clampNumber(runtime.hourCarryMinutes, 0, 60, 0);
  const lifestyleWeekCarryMinutes = clampNumber(runtime.lifestyleWeekCarryMinutes, 0, 7 * 24 * 60, 0);
  const totalDayMinutes = dayCarryMinutes + addedMinutes;
  const totalHourMinutes = hourCarryMinutes + addedMinutes;
  const totalLifestyleWeekMinutes = lifestyleWeekCarryMinutes + addedMinutes;
  return {
    deltaMinutes: addedMinutes,
    deltaDays: addedMinutes / (24 * 60),
    passedDays: Math.floor(totalDayMinutes / (24 * 60)),
    passedHours: Math.floor(totalHourMinutes / 60),
    passedLifestyleWeeks: Math.floor(totalLifestyleWeekMinutes / (7 * 24 * 60)),
    nextRuntime: {
      dayCarryMinutes: totalDayMinutes % (24 * 60),
      hourCarryMinutes: totalHourMinutes % 60,
      lifestyleWeekCarryMinutes: totalLifestyleWeekMinutes % (7 * 24 * 60),
    },
  };
}

function appendNotifyReminder(notify, message) {
  const current = String(notify?.thirdly || '').trim();
  notify.thirdly = current ? `${current}；${message}` : message;
}

function getMenstrualStageFluctuation(profile, stage) {
  if (!MENSTRUAL_STAGE_DAYS[stage]) return 0;

  const base = profile?.base || {};
  const vitalityLevel = clampNumber(base.vitalityLevel, 1, 7, 4);
  const psyStressLevel = clampNumber(base.psyStressLevel, 1, 7, 4);

  let maxFluctuationRatio = 0;
  if (vitalityLevel === 2) maxFluctuationRatio += 0.08;
  if (vitalityLevel === 1) maxFluctuationRatio += 0.15;
  if (psyStressLevel === 6) maxFluctuationRatio += 0.08;
  if (psyStressLevel === 7) maxFluctuationRatio += 0.15;
  if (maxFluctuationRatio <= 0) return 0;

  const seedText = `${stage}:${vitalityLevel}:${psyStressLevel}`;
  let seed = 0;
  for (const char of seedText) seed += char.charCodeAt(0);
  const normalized = ((seed % 1001) / 1000) * 2 - 1;
  return normalized * maxFluctuationRatio;
}

export function getStageLimit(profile, stage) {
  if (MENSTRUAL_STAGE_DAYS[stage]) {
    const ratio = clampNumber(profile?.bio?.menstrualLengthRatio, 0.1, 20, 1);
    const fluctuation = getMenstrualStageFluctuation(profile, stage);
    return Math.max(1, MENSTRUAL_STAGE_DAYS[stage] * ratio * (1 + fluctuation));
  }
  if (stage === '产后恢复') return clampNumber(profile?.bio?.recoveryDays, 0, 9999, 56);
  return null;
}

/** Shared read-only limit for the engine and progress UI; pseudo age uses actual days. */
export function getPseudoPregnancyLimit(profile) {
  return Math.max(1, 84 * clampNumber(getGestationEffectiveSpeed(profile), GESTATION_SPEED_MIN, GESTATION_SPEED_MAX, 1));
}

function advanceMenstrualStage(profile, stage, daysValue) {
  let nextStage = stage;
  let nextDays = daysValue;
  let changed = false;
  let enteredFollicular = false;
  let flushedEmbryos = 0;
  while (MENSTRUAL_STAGES.includes(nextStage)) {
    const limit = getStageLimit(profile, nextStage);
    if (limit === null || nextDays <= limit) break;
    nextDays -= limit;
    const stageIndex = MENSTRUAL_STAGES.indexOf(nextStage);
    nextStage = MENSTRUAL_STAGES[(stageIndex + 1) % MENSTRUAL_STAGES.length];
    if (nextStage === '月经期') {
      if (shouldEnterPseudoPregnancy(profile, '黄体期', nextStage)) return { stage: '假孕期', days: 0, changed: true, enteredFollicular };
      refreshCognition(profile);
      // 月经来潮时还没着床的受精卵随经血排出：黄体期太晚才受精就来不及着床
      const pregnant = profile.pregnant || {};
      if (Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0) {
        flushedEmbryos += pregnant.fetuses.length;
        pregnant.fetuses = [];
        pregnant.fetusesCount = 0;
        pregnant.fetalEnergyDrain = 0;
        if (profile.base) profile.base.fertilizationDays = 0;
      }
    }
    if (nextStage === '卵泡期') enteredFollicular = true;
    changed = true;
  }
  return {
    stage: nextStage,
    days: Math.max(0, nextDays),
    changed,
    enteredFollicular,
    flushedEmbryos,
  };
}

function shouldEnterPseudoPregnancy(profile, previousStage, nextStage) {
  if (previousStage === '月经期' || nextStage !== '月经期') return false;
  const base = profile?.base || {};
  const experience = profile?.experience || {};
  const psyStress = clampNumber(base.psyStress, 0, 9999, 0);
  const libido = clampNumber(base.libido, 0, 9999, 0);
  const latestSexPartner = String(experience.latestSexPartner || '').trim();
  return psyStress >= 100 && libido >= 50 && latestSexPartner.length > 0;
}

function applyTimeToCharacter(character, tick) {
  const next = cloneValue(character);
  snapshotOriginalPregnancyBio(next);
  const profile = next.profile || {};
  const oldCognitionCycle = Number(profile.cognitionCycle) || 0;
  profile.__runtimeRef = next.runtime || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const bio = profile.bio || {};
  const notify = {
    firstly: '',
    secondly: '',
    thirdly: '',
  };
  profile.notify = notify;
  const cooldown = profile.cooldown || {};
  const deltaDays = tick.deltaDays;
  const isHere = base.isHere !== false;

  let stage = String(base.stage || '');
  let days = clampNumber(base.days, 0, 9999, 0);
  let stageChanged = false;
  let enteredFollicular = false;
  const oldStage = stage;

  if (deltaDays <= 0) return { character: next, stageChanged: false, oldStage, newStage: stage };
  decayAssistPainBoost(profile, tick.deltaMinutes);

  processSimpleConception(profile, tick, notify, next.name);
  stage = String(base.stage || stage);
  if (Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0 && isPregnancyStage(stage)) {
    applyPregnancyPhysiology(profile, next.runtime || {});
  }

  if (MENSTRUAL_STAGES.includes(stage)) {
    const currentStageDay = Math.max(0, Number(days) || 0);
    const advanced = advanceMenstrualStage(profile, stage, currentStageDay + deltaDays);
    stage = advanced.stage;
    days = advanced.days;
    stageChanged = advanced.changed;
    enteredFollicular = advanced.enteredFollicular;
    if (advanced.flushedEmbryos > 0) notify.secondly = `${next.name}的月经来潮，还没着床的受精卵随之排出`;
    if (stage === '假孕期') {
      stage = '假孕期';
      days = 0;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
      notify.secondly = `${next.name}因进入月经期时心理压力偏高、性欲偏高且近期有性接触记录，出现了假孕症状`;
    }
  } else if (PREGNANCY_STAGES.includes(stage)) {
    const oldPregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0);
    pregnant.pregnantDays = oldPregnantDays + deltaDays;
    pregnant.effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) + (deltaDays * clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, GESTATION_SPEED_MAX, 1));
    const oldWeek = Math.floor(oldPregnantDays / 7);
    const newWeek = Math.floor(pregnant.pregnantDays / 7);
    if (newWeek > oldWeek && isHere) {
      applyWeeklyNutrition(profile);
    }
    updateDerivedTypeProgress(profile, tick);
    revealSuperfetationFetuses(profile, next.name, notify);
    const derived = derivePregnancyStageState(pregnant.effectivePregnantDays, 1, pregnant);
    stage = derived.stage;
    days = derived.days;
    stageChanged = stage !== oldStage;
    base.stage = stage;
    base.days = days;
    updateFetalPositions(profile, tick, next.name);
    // 足月宫压离场也照样累积：离场只是镜头不在，不能让孕周一路走却永远不生
    applyTermPressure(profile, tick, next.name);
    if (isHere) applyHourlyPregnancyMetabolism(profile, tick);
    if (stage === '延产期') {
      regenerateExtensionAmnion(profile, tick);
      if (clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) >= clampNumber(pregnant.extensionUntilDays, 0, 9999, 0)) {
        enterProdromalStage(profile, next.name, '延产期', `${next.name}的延产期已满，开始出现分娩前兆；若要再延产，需在产兆前驱期间使用延产手段`);
        stage = String(base.stage || stage);
        days = clampNumber(base.days, 0, 9999, 0);
        stageChanged = true;
      }
    }
    const pressureCrisis = isHere && PREGNANCY_STAGES.includes(stage)
      ? applyPressureCrisis(profile, next.runtime || {}, next.name)
      : { changed: false, warned: false };
    if (pressureCrisis.changed) {
      stage = String(base.stage || stage);
      days = clampNumber(base.days, 0, 9999, 0);
      stageChanged = true;
    }
    if (!isHere && maybeStartOffscreenLabor(profile, next.name)) {
      stage = String(base.stage || stage);
      days = clampNumber(base.days, 0, 9999, 0);
      stageChanged = true;
    } else if (isHere && !pressureCrisis.warned && maybeStartLabor(profile, tick, next.name)) {
      stage = String(base.stage || stage);
      days = clampNumber(base.days, 0, 9999, 0);
      stageChanged = true;
    }
  } else if (stage === '产后恢复') {
    days += deltaDays;
    const recoveryDays = getStageLimit(profile, '产后恢复');
    if (days >= recoveryDays) {
      stage = '月经期';
      days = Math.max(0, days - recoveryDays);
      stageChanged = true;
      refreshCognition(profile);
      const advanced = advanceMenstrualStage(profile, stage, days);
      stage = advanced.stage;
      days = advanced.days;
      enteredFollicular = advanced.enteredFollicular;
      // 子宫乏力撑过产程，到产后恢复结束才算复旧完成
      base.uterineAtony = 0;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
      pregnant.laborHours = 0;
      pregnant.effectiveLaborHours = 0;
      pregnant.laborPhase = null;
      pregnant.laborBirthNumber = 0;
      pregnant.presentingEmbryoId = null;
      pregnant.laborPain = 0;
      clearProdromalState(pregnant);
      pregnant.fetuses = [];
      pregnant.fetusesCount = 0;
      pregnant.fetalEnergyDrain = 0;
      base.fertilizationDays = 0;
    }
  } else if (stage === WOMB_RETURN_STAGE) {
    const finished = advanceWombReturn(profile, deltaDays, next.name, notify);
    stage = String(base.stage || stage);
    days = clampNumber(base.days, 0, 9999, 0);
    stageChanged = stageChanged || finished || stage !== oldStage;
  } else if (stage === '假孕期') {
    pregnant.pregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0) + deltaDays;
    const pseudoLimit = getPseudoPregnancyLimit({ ...profile, bio });
    if (pregnant.pregnantDays > pseudoLimit) {
      stage = '月经期';
      days = Math.max(0, pregnant.pregnantDays - pseudoLimit);
      stageChanged = true;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
      refreshCognition(profile);
      const advanced = advanceMenstrualStage(profile, stage, days);
      stage = advanced.stage;
      days = advanced.days;
      enteredFollicular = advanced.enteredFollicular;
    }
  } else if (stage === '产兆前驱') {
    const oldPregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0);
    pregnant.pregnantDays = oldPregnantDays + deltaDays;
    pregnant.effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) + (deltaDays * clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, GESTATION_SPEED_MAX, 1));
    const oldWeek = Math.floor(oldPregnantDays / 7);
    const newWeek = Math.floor(pregnant.pregnantDays / 7);
    if (newWeek > oldWeek && isHere) {
      applyWeeklyNutrition(profile);
    }
    if (isHere) applyHourlyPregnancyMetabolism(profile, tick);
    updateDerivedTypeProgress(profile, tick);
    advanceLaborFetalActivity(profile, tick, next.name);
    const laborChanged = processLabor(profile, tick, next.name);
    stage = String(base.stage || stage);
    days = clampNumber(base.days, 0, 9999, 0);
    stageChanged = stageChanged || laborChanged || stage !== oldStage;
  } else if (LABOR_STAGES.includes(stage)) {
    if (isHere) applyHourlyPregnancyMetabolism(profile, tick);
    updateDerivedTypeProgress(profile, tick);
    advanceLaborFetalActivity(profile, tick, next.name);
    const laborChanged = processLabor(profile, tick, next.name);
    stage = String(base.stage || stage);
    days = clampNumber(base.days, 0, 9999, 0);
    stageChanged = stageChanged || laborChanged || stage !== oldStage;
  } else if (stage === '无经期' || stage === '未激活') {
    days += deltaDays;
  } else {
    // 未知阶段。这里不会让角色卡死——applyTimeToCharacter 结尾一定会过
    // syncCharacterStageFromProfile，不在它保留清单里的阶段会被重设成月经阶段。
    // 真正会卡住的是另一种组合：阶段已加进 state.js 的保留清单、却忘了在这里
    // 加推进分支，那它就会被保留下来又永远不前进。警告是为了照出这一种。
    days += deltaDays;
    if (!reportedUnknownStages.has(stage)) {
      reportedUnknownStages.add(stage);
      console.warn(`[BS BioTracker] 阶段「${stage}」没有对应的推进分支；若它同时在 state.js 的保留清单内，将永远停在原地。`);
    }
  }

  processSpermLifecycle(profile, stage, tick);

  if (base.latestSexDays !== null && base.latestSexDays !== undefined && Number(base.latestSexDays) >= 0) {
    base.latestSexDays = clampNumber(base.latestSexDays, -1, 9999, 0) + tick.passedDays;
    if (base.latestSexDays >= getMenstrualCycleLength(profile)) {
      base.latestSexDays = -1;
      profile.experience = {
        ...(profile.experience || {}),
        latestSexPartner: null,
      };
    }
  }

  if (isHere) applyPassiveMetabolism(profile, tick);
  applyNaturalMetabolismRecovery(profile, tick);
  applyWeeklyMetabolismRoutine(profile, tick, { enteredFollicular, stage });

  base.age = clampNumber(base.age, 0, 99999, 15) + (deltaDays / 365);
  if (Array.isArray(profile.children) && profile.children.length > 0) {
    profile.children = profile.children.map((child) => ({
      ...child,
      age: child?.age === null || child?.age === undefined ? child?.age : clampNumber(child.age, 0, 99999, 0) + (deltaDays / 365),
    }));
  }

  if (Array.isArray(pregnant.fetuses) && pregnant.fetuses.length > 0 && clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) > 0 && !isPregnancyStage(stage)) {
    const derived = derivePregnancyStageState(pregnant.effectivePregnantDays, 1);
    stage = derived.stage;
    days = derived.days;
    stageChanged = stage !== oldStage;
  }

  if ((!Array.isArray(pregnant.fetuses) || pregnant.fetuses.length === 0) && !isPregnancyStage(stage)) {
    restorePregnancyPhysiology(profile, next.runtime || {});
  }

  syncPsychologyLifecycle({ ...profile, base: { ...base, stage } }, oldStage, (Number(profile.cognitionCycle) || 0) !== oldCognitionCycle);

  profile.base = {
    ...base,
    stage,
    days,
  };
  refreshPregnancySymptoms(profile, tick);
  applyMetabolismCapacityLimits(profile);
  refreshOutfitPregFit(profile);
  profile.pregnant = {
    ...pregnant,
    blockage: profile.pregnant?.blockage ?? null,
    acceleration: profile.pregnant?.acceleration ?? null,
    expansion: profile.pregnant?.expansion ?? null,
    fetusesCount: Array.isArray(pregnant.fetuses) ? pregnant.fetuses.length : clampNumber(pregnant.fetusesCount, 0, 99, 0),
  };
  const currentNotify = profile.notify || notify;
  profile.notify = {
    ...currentNotify,
    // 同一 tick 写下的提示（异期胎揭晓、难产警示）不能被阶段提示盖掉；已含阶段提示就不重复
    firstly: stageChanged ? mergeStageNotice(`${next.name}进入了${stage}`, notify.firstly || currentNotify.firstly) : currentNotify.firstly || '',
  };
  profile.cooldown = {
    ...cooldown,
    ...nextOrgasmOvulationCooldown(stage, cooldown),
    naturalOvulationUsed: shouldResetNaturalOvulation(stage) ? false : Boolean((profile.cooldown || cooldown).naturalOvulationUsed),
    pregnancyPressureWarning: shouldKeepPregnancyPressureWarning(profile) ? Boolean((profile.cooldown || cooldown).pregnancyPressureWarning) : false,
    psychologyUpdateUsed: tick.passedHours > 0 ? false : Boolean(cooldown.psychologyUpdateUsed),
    maternalFetalInteractionUsed: tick.passedHours > 0 ? false : Boolean(cooldown.maternalFetalInteractionUsed),
  };
  accrueNutritionBurst(profile, tick.deltaMinutes);
  reconcileFetalDescent(profile);
  updateAdvisoryNotify(profile, next.name);
  if (tick.passedDays > 0) {
    appendNotifyReminder(profile.notify || notify, '已跨入新的一天；若角色有值得沉淀的经历、心境、关系或身体变化，可调用 bsWriteDiary 写入主观日记');
  }
  delete profile.__runtimeRef;
  next.profile = profile;
  next.runtime = {
    ...(next.runtime || {}),
    ...tick.nextRuntime,
  };
  return {
    character: syncCharacterStageFromProfile(next),
    stageChanged,
    oldStage,
    newStage: stage,
  };
}

function applyWriteDiary(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsWriteDiary skipped: unknown character ${female || '(empty)'}.` };

  const time = String(args?.time || '').trim();
  const content = String(args?.content || '').trim();
  if (!time) return { applied: false, message: `bsWriteDiary skipped for ${female}: empty time.` };
  if (!content) return { applied: false, message: `bsWriteDiary skipped for ${female}: empty content.` };

  return writeDiaryEntry(chatState, female, { time, content });
}

/**
 * 写一篇日记。同一个故事日只能有一篇：追踪模型写的遇到冷却就跳过；
 * replaceSameDay 给使用者在注册页手动改写用，会直接取代当天那一篇
 */
export function writeDiaryEntry(chatState, female, { time, content } = {}, { replaceSameDay = false } = {}) {
  const character = chatState.characters?.[female];
  const title = String(time || '').trim();
  const body = String(content || '').trim();
  if (!character) return { applied: false, message: `bsWriteDiary skipped: unknown character ${female || '(empty)'}.` };
  if (!title) return { applied: false, message: `bsWriteDiary skipped for ${female}: empty time.` };
  if (!body) return { applied: false, message: `bsWriteDiary skipped for ${female}: empty content.` };
  const next = cloneValue(character);
  const profile = next.profile || {};
  profile.diary = Array.isArray(profile.diary) ? profile.diary : [];
  const currentStoryDayIndex = Math.floor(Math.max(0, Number(chatState?.minutesPassed) || 0) / 1440);
  const sameDayIndex = profile.diary.findIndex((entry) => Number(entry?.storyDayIndex) === currentStoryDayIndex);
  if (sameDayIndex >= 0 && !replaceSameDay) {
    return { applied: false, message: `bsWriteDiary skipped for ${female}: story day ${currentStoryDayIndex + 1} is still on diary cooldown.` };
  }
  const entry = { time: title, content: body, storyDayIndex: currentStoryDayIndex, createdAt: Date.now() };
  if (sameDayIndex >= 0) profile.diary[sameDayIndex] = entry;
  else profile.diary.push(entry);
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, replaced: sameDayIndex >= 0, message: `bsWriteDiary applied to ${female}: ${title}.` };
}

function mergeStageNotice(stageText, own) {
  const text = String(own || '');
  return text.includes(stageText) ? text : [stageText, text].filter(Boolean).join('；');
}

function applyPassedTime(chatState, args) {
  const minute = clampNumber(args?.minute, 0, 60 * 24 * 365, 0);
  const hour = clampNumber(args?.hour, 0, 24 * 365, 0);
  const day = clampNumber(args?.day, 0, 36500, 0);
  const week = clampNumber(args?.week, 0, 5200, 0);
  const month = clampNumber(args?.month, 0, 1200, 0);
  const year = clampNumber(args?.year, 0, 200, 0);
  const totalMinutes = minute + (hour * 60) + (day * 24 * 60) + (week * 7 * 24 * 60) + (month * 30 * 24 * 60) + (year * 365 * 24 * 60);
  if (totalMinutes <= 0) return { applied: false, message: 'bsPassedTime skipped: no positive duration.' };

  for (const name of Object.keys(chatState.characters || {})) {
    const current = chatState.characters[name];
    if (!current || typeof current !== 'object') continue;
    // 被吞进子宫的角色整个冻结：她现在是一颗胎儿，月经周期、代谢、受孕都不该继续跑
    let subject = current;
    const frozenHost = String(current?.profile?.base?.wombReturnHost || '').trim();
    if (frozenHost) {
      // 承载者已经不在了（被注销），再冻着就永远出不来，自动放人后照常推进
      if (chatState.characters?.[frozenHost]) continue;
      subject = cloneValue(current);
      subject.profile = subject.profile || {};
      const thawedBase = { ...(subject.profile.base || {}), isHere: true };
      delete thawedBase.wombReturnHost;
      subject.profile.base = thawedBase;
    }
    const tick = buildTimeTick(subject, totalMinutes);
    const result = applyTimeToCharacter(subject, tick);
    chatState.characters[name] = result.character;
  }
  transferProviderChildren(chatState);
  const elapsedMinutes = Math.round(totalMinutes);
  const previousMinutes = Math.max(0, Number(chatState.minutesPassed) || 0);
  chatState.minutesPassed = previousMinutes + elapsedMinutes;
  return { applied: true, message: `bsPassedTime applied ${elapsedMinutes} minutes; accumulated ${chatState.minutesPassed} minutes.` };
}

function applyCharacterStatus(chatState, args) {
  const female = String(args?.female || '').trim();
  const options = args?.options && typeof args.options === 'object' ? args.options : {};
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsUpdateCharacterStatus skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const base = next.profile?.base || {};
  const profile = next.profile || {};
  const vitalityCap = getVitalityInitByLevel(base.vitalityLevel);
  const stressCap = getPsyStressInitByLevel(base.psyStressLevel) * 2;
  const libidoCap = getLibidoCap(profile);
  const uterinePressureCap = getUterinePressureCap(profile);

  if (options.vitality !== undefined) {
    base.vitality = clampNumber((base.vitality || 0) + Number(options.vitality || 0), 0, vitalityCap, base.vitality || 0);
    applyMetabolismFromVitality(profile, Number(options.vitality || 0));
  }
  if (options.psyStress !== undefined) base.psyStress = clampNumber((base.psyStress || 0) + Number(options.psyStress || 0), 0, stressCap, base.psyStress || 0);
  if (options.libido !== undefined) {
    const libidoDelta = Number(options.libido || 0);
    base.libido = clampNumber((base.libido || 0) + libidoDelta, 0, libidoCap, base.libido || 0);
    applyMilkFromLibido(profile, libidoDelta);
  }
  if (options.uterinePressure !== undefined) {
    base.uterinePressure = clampNumber((base.uterinePressure || 0) + Number(options.uterinePressure || 0), 0, uterinePressureCap, base.uterinePressure || 0);
    applyAmnionDurabilityFromPressure(profile, base.uterinePressure, female);
    // 剧情写出分娩前兆而推高宫压：前兆已经发生，当下进入产兆前驱，不走「示警、下次推进才发动」。
    // 示警那一轮是留给宫压自己慢慢累积时让剧情反应的；这里剧情已经先反应了
    const stage = String(base.stage || '');
    if (Number(options.uterinePressure) > 0 && (stage === '临产期' || stage === '逾期')
      && base.uterinePressure >= uterinePressureCap * 0.66) {
      enterProdromalStage(profile, female, stage, `${female}出现分娩前兆，进入产兆前驱`);
    }
  }
  // 高潮＝性欲顶到上限：模型不必知道上限是多少，由这里推满再走同一条高潮排卵结算
  const orgasm = options.orgasm === true;
  if (orgasm) {
    const before = clampNumber(base.libido, 0, libidoCap, 0);
    base.libido = libidoCap;
    applyMilkFromLibido(profile, libidoCap - before);
  }
  applyDerivedMetabolismExemptions(profile);

  next.profile.base = base;
  const ovulationSettled = maybeTriggerOrgasmOvulation(next);
  // 冷却中、不排卵的物种或假孕：没有排卵结算，高潮本身仍让性欲归零，不能停在上限像持续发情
  if (orgasm && !ovulationSettled) {
    next.profile.base.libido = 0;
    next.profile.notify = { ...(next.profile.notify || {}), secondly: `${female}达到高潮，性欲归零` };
  }
  chatState.characters[female] = next;
  return { applied: true, message: `bsUpdateCharacterStatus applied to ${female}.` };
}

const DESCRIPTION_FIELD_NAMES = ['normalDescription', 'pregnantDescription'];

function parseDescriptionText(text) {
  const rawText = String(text || '').trim();
  if (!rawText) return { entries: [], error: '' };

  const entries = [];
  const segments = rawText.split(';;').map((part) => part.trim()).filter(Boolean);
  for (const segment of segments) {
    const separatorIndex = segment.indexOf('|');
    if (separatorIndex <= 0) {
      return { entries: [], error: `invalid segment "${segment}"` };
    }
    const name = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();
    if (!name) return { entries: [], error: `invalid empty field name in "${segment}"` };
    entries.push({ name, value });
  }
  return { entries, error: '' };
}

function mergeDescriptionText(currentText, patchText) {
  const current = parseDescriptionText(currentText);
  if (current.error) return { ok: false, value: String(currentText || ''), error: `existing description is malformed: ${current.error}` };

  const patch = parseDescriptionText(patchText);
  if (patch.error) return { ok: false, value: String(currentText || ''), error: `patch description is malformed: ${patch.error}` };
  // 空补丁视为 no-op：模型常把「不改」表达成空字符串，清空整栏会造成静默数据丢失。
  if (patch.entries.length === 0) return { ok: true, value: String(currentText || '') };

  // Registration is allowed to leave a description field blank. In that
  // state there is no schema to merge against yet, so the first tracker
  // update must be able to establish its fields (for example, a pregnancy
  // description after a debug injection). Once a field has content, keep
  // the normal strict schema guard below.
  if (current.entries.length === 0) {
    return {
      ok: true,
      value: patch.entries.map((entry) => `${entry.name}|${entry.value};;`).join(''),
    };
  }

  const allowedNames = new Set(current.entries.map((entry) => entry.name));
  const unknownNames = patch.entries.map((entry) => entry.name).filter((name) => !allowedNames.has(name));
  if (unknownNames.length > 0) {
    return {
      ok: false,
      value: String(currentText || ''),
      error: `unknown subfield(s): ${Array.from(new Set(unknownNames)).join(', ')}`,
    };
  }

  const patchByName = new Map(patch.entries.map((entry) => [entry.name, entry.value]));
  const merged = current.entries.map((entry) => ({
    name: entry.name,
    value: patchByName.has(entry.name) ? patchByName.get(entry.name) : entry.value,
  }));
  return {
    ok: true,
    value: merged.map((entry) => `${entry.name}|${entry.value};;`).join(''),
  };
}

function applyAddWardrobeItem(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsAddWardrobeItem skipped: unknown character ${female || '(empty)'}.` };
  const item = normalizeWardrobeItem(args?.item, { allowMissingId: true });
  if (!item) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: invalid item.` };
  if (item.id === DEFAULT_WARDROBE_ITEM.id) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: id=0 is reserved.` };
  const next = cloneValue(character);
  const profile = next.profile || {};
  const wardrobe = ensureWardrobeState(profile);
  const rawId = args?.item?.id;
  const hasExplicitIntegerId = Number.isInteger(rawId) && rawId > 0;
  // 显式 id 更新对应条目；省略 id 时以名称更新或建立新条目。
  let target = null;
  if (hasExplicitIntegerId) {
    target = wardrobe.items.find((entry) => entry.id === item.id) || null;
  } else {
    target = resolveWardrobeItemRef(wardrobe.items, item.name) || null;
  }
  if (target && target.id === DEFAULT_WARDROBE_ITEM.id) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: id=0 is reserved.` };
  if (!target) {
    // 引用到正在穿的临时衣物：转为长期收藏，id 与穿着关系都不变
    const outfit = ensureOutfitState(profile);
    const transient = resolveWardrobeItemRef(outfit.transientItems, hasExplicitIntegerId ? item.id : item.name);
    if (transient) {
      // 槽位以正在穿的为准，否则主件／配件关系会断；槽位不同时按正确槽位重新正规化
      const promoted = item.slot === transient.slot
        ? { ...item, id: transient.id }
        : normalizeWardrobeItem({ ...args.item, id: transient.id, slot: transient.slot });
      if (!promoted) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: invalid item.` };
      outfit.transientItems = outfit.transientItems.filter((entry) => entry.id !== transient.id);
      wardrobe.items.push(promoted);
      item.name = promoted.name;
      item.id = promoted.id;
      refreshOutfitPregFit(profile);
      next.profile = profile;
      chatState.characters[female] = syncCharacterStageFromProfile(next);
      return { applied: true, message: `bsAddWardrobeItem applied to ${female}: 临时衣物 ${item.name} (id=${item.id}) 已收进衣柜，仍在穿着。` };
    }
  }
  if (target) {
    item.id = target.id;
    const existingIndex = wardrobe.items.findIndex((entry) => entry.id === target.id);
    wardrobe.items[existingIndex] = item;
  } else {
    if (!hasExplicitIntegerId) item.id = getNextWardrobeItemId(wardrobe.items);
    wardrobe.items.push(item);
  }
  refreshOutfitPregFit(profile);
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsAddWardrobeItem applied to ${female}: ${item.name} (id=${item.id}).` };
}

function applyRemoveWardrobeItem(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsRemoveWardrobeItem skipped: unknown character ${female || '(empty)'}.` };
  const next = cloneValue(character);
  const profile = next.profile || {};
  const wardrobe = ensureWardrobeState(profile);
  const target = resolveWardrobeItemRef(wardrobe.items, args?.itemId);
  if (!target) return { applied: false, message: `bsRemoveWardrobeItem skipped for ${female}: item not found (${JSON.stringify(args?.itemId ?? null)}).` };
  const itemId = target.id;
  if (itemId === DEFAULT_WARDROBE_ITEM.id) return { applied: false, message: `bsRemoveWardrobeItem skipped for ${female}: id=0 cannot be removed.` };
  wardrobe.items = wardrobe.items.filter((item) => item.id !== itemId);
  const outfit = ensureOutfitState(profile);
  if (outfit.mainItemId === itemId) outfit.mainItemId = null;
  outfit.accessoryItemIds = outfit.accessoryItemIds.filter((id) => id !== itemId);
  refreshOutfitPregFit(profile);
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsRemoveWardrobeItem applied to ${female}: ${itemId}.` };
}

function createInlineOutfitItem(profile, source, slot, scope) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const wardrobe = ensureWardrobeState(profile);
  const outfit = ensureOutfitState(profile);
  const occupied = [...wardrobe.items, ...outfit.transientItems];
  const item = normalizeWardrobeItem({
    ...source,
    id: getNextWardrobeItemId(occupied),
    slot,
  });
  if (!item) return null;
  if (scope === 'temporary') outfit.transientItems.push({ ...item, source: 'transient' });
  else wardrobe.items.push(item);
  return item;
}

function applyChangeOutfit(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsChangeOutfit skipped: unknown character ${female || '(empty)'}.` };
  const next = cloneValue(character);
  const profile = next.profile || {};
  const outfit = ensureOutfitState(profile);
  const previousMainItemId = outfit.mainItemId;
  if (args?.mainItemId !== undefined) {
    if (args.mainItemId === null) {
      outfit.mainItemId = null;
    } else {
      const mainItem = findOutfitItem(profile, args.mainItemId, 'main');
      if (!mainItem) return { applied: false, message: `bsChangeOutfit skipped for ${female}: unknown main item ${JSON.stringify(args.mainItemId ?? null)}.` };
      outfit.mainItemId = mainItem.id;
    }
  }
  const inlineScope = args?.scope === 'temporary' ? 'temporary' : 'owned';
  if (args?.main !== undefined) {
    const mainItem = createInlineOutfitItem(profile, args.main, 'main', inlineScope);
    if (!mainItem) return { applied: false, message: `bsChangeOutfit skipped for ${female}: invalid inline main item.` };
    outfit.mainItemId = mainItem.id;
  }
  if (args?.accessories !== undefined) {
    if (!Array.isArray(args.accessories)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: accessories must be an array.` };
    for (const source of args.accessories) {
      const accessory = createInlineOutfitItem(profile, source, 'accessory', inlineScope);
      if (!accessory) return { applied: false, message: `bsChangeOutfit skipped for ${female}: invalid inline accessory item.` };
      if (!outfit.accessoryItemIds.includes(accessory.id)) outfit.accessoryItemIds.push(accessory.id);
    }
  }
  if (args?.accessoryItemIds !== undefined) {
    if (!Array.isArray(args.accessoryItemIds)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: accessoryItemIds must be an array.` };
    const nextAccessoryIds = [];
    for (const rawRef of args.accessoryItemIds) {
      const accessory = findOutfitItem(profile, rawRef, 'accessory');
      if (!accessory) return { applied: false, message: `bsChangeOutfit skipped for ${female}: unknown accessory item ${JSON.stringify(rawRef ?? null)}.` };
      if (!nextAccessoryIds.includes(accessory.id)) nextAccessoryIds.push(accessory.id);
    }
    outfit.accessoryItemIds = nextAccessoryIds;
  } else if (args?.addAccessoryItemIds !== undefined || args?.removeAccessoryItemIds !== undefined) {
    // 增量穿脱：在当前配件列表基础上加/减，避免模型必须整表重述。
    const current = [...outfit.accessoryItemIds];
    if (args?.removeAccessoryItemIds !== undefined) {
      if (!Array.isArray(args.removeAccessoryItemIds)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: removeAccessoryItemIds must be an array.` };
      for (const rawRef of args.removeAccessoryItemIds) {
        const accessory = findOutfitItem(profile, rawRef, 'accessory');
        if (!accessory) return { applied: false, message: `bsChangeOutfit skipped for ${female}: unknown accessory item ${JSON.stringify(rawRef ?? null)}.` };
        const index = current.indexOf(accessory.id);
        if (index >= 0) current.splice(index, 1);
      }
    }
    if (args?.addAccessoryItemIds !== undefined) {
      if (!Array.isArray(args.addAccessoryItemIds)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: addAccessoryItemIds must be an array.` };
      for (const rawRef of args.addAccessoryItemIds) {
        const accessory = findOutfitItem(profile, rawRef, 'accessory');
        if (!accessory) return { applied: false, message: `bsChangeOutfit skipped for ${female}: unknown accessory item ${JSON.stringify(rawRef ?? null)}.` };
        if (!current.includes(accessory.id)) current.push(accessory.id);
      }
    }
    outfit.accessoryItemIds = current;
  }
  if (args?.wearState !== undefined) {
    outfit.wearState = sanitizeWearState(args.wearState);
  } else if (outfit.mainItemId !== previousMainItemId) {
    // 换了主件且未显式指定穿着状态：新衣服默认穿整齐。
    outfit.wearState = DEFAULT_WEAR_STATE;
  }
  const wornIds = new Set([
    ...(outfit.mainItemId === null ? [] : [outfit.mainItemId]),
    ...outfit.accessoryItemIds,
  ]);
  outfit.transientItems = outfit.transientItems.filter((item) => wornIds.has(item.id));
  refreshOutfitPregFit(profile);
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsChangeOutfit applied to ${female}.` };
}
function applyDescription(chatState, args) {
  const female = String(args?.female || '').trim();
  const options = args?.options && typeof args.options === 'object' ? args.options : {};
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsSetDescription skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  next.profile.descriptions = {
    ...(next.profile?.descriptions || {}),
  };
  const failures = [];
  const appliedKeys = [];
  for (const key of DESCRIPTION_FIELD_NAMES) {
    if (options[key] === undefined) continue;
    const merged = mergeDescriptionText(next.profile.descriptions[key] || '', options[key]);
    if (!merged.ok) {
      failures.push(`${key}: ${merged.error}`);
      continue;
    }
    next.profile.descriptions[key] = merged.value;
    appliedKeys.push(key);
  }
  if (failures.length > 0) return { applied: false, message: `bsSetDescription skipped for ${female}: ${failures.join('; ')}.` };
  if (appliedKeys.length === 0) return { applied: false, message: `bsSetDescription skipped for ${female}: empty options.` };
  chatState.characters[female] = next;
  return { applied: true, message: `bsSetDescription applied to ${female}: ${appliedKeys.join(', ')}.` };
}

function applySetCharacterPresence(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsSetCharacterPresence skipped: unknown character ${female || '(empty)'}.` };
  // 缺省视为在场会让模型漏填时静默改状态：要求显式传入
  if (args?.isPresent === undefined) return { applied: false, message: `bsSetCharacterPresence skipped for ${female}: isPresent 必须显式传入 true/false。` };
  const isPresent = Boolean(args.isPresent);

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  base.isHere = isPresent;
  // 设回在场即解除胎内回归的冻结——这是既有的手动逃生口，不必另开工具
  const unfroze = isPresent && Boolean(String(base.wombReturnHost || '').trim());
  if (isPresent) delete base.wombReturnHost;
  profile.base = base;
  next.profile = profile;
  chatState.characters[female] = next;
  return {
    applied: true,
    message: `bsSetCharacterPresence applied to ${female}: isHere=${isPresent}.${unfroze ? ' 已解除胎内回归冻结。' : ''}`,
  };
}

function applyRegisterSkillDefinition(chatState, args) {
  const result = registerSkillDefinition(chatState.skillCatalog, args, chatState.nextSkillId);
  if (!result.ok) return { applied: false, message: `bsRegisterSkillDefinition skipped: ${result.message}` };
  chatState.skillCatalog = result.catalog;
  chatState.nextSkillId = result.nextSkillId;
  return {
    applied: result.created,
    message: result.created
      ? `bsRegisterSkillDefinition registered #${result.definition.id} ${result.definition.name}.`
      : `bsRegisterSkillDefinition skipped: ${result.definition.name} already exists as #${result.definition.id}.`,
  };
}

const FETAL_TALENT_TRANSFER_STAGES = new Set(['孕中期', '孕晚期', '临产期', '逾期', '延产期', '产兆前驱', '第一产程']);

function applyTrainSkill(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsTrainSkill skipped: unknown character ${female || '(empty)'}.` };

  const definition = resolveSkillDefinition(chatState.skillCatalog, args?.skill);
  const reason = String(args?.reason || '').trim();
  const skillExp = Number(args?.skillExp);
  if (!definition) return { applied: false, message: `bsTrainSkill skipped for ${female}: skill is not registered in skill_catalog.` };
  if (!reason) return { applied: false, message: `bsTrainSkill skipped for ${female}: training reason is required.` };
  if (args?.talentExp !== undefined) {
    return { applied: false, message: `bsTrainSkill skipped for ${female}: character talents are read-only to LLM tools; remove talentExp.` };
  }
  if (!Number.isInteger(skillExp) || skillExp < 0 || skillExp > 1000000) {
    return { applied: false, message: `bsTrainSkill skipped for ${female}: skillExp must be an integer from 0 to 1000000.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const skills = normalizeSkillList(profile.skills);
  let skill = skills.find((item) => item.skillId === definition.id);
  const previousLevel = skill?.level || 0;
  const awakened = !skill && args?.awaken === true;
  if (!skill && !awakened) {
    return { applied: false, message: `bsTrainSkill skipped for ${female}: ${definition.name} is not awakened; pass awaken=true only when the story triggers awakening.` };
  }
  if (!skill) {
    skill = { skillId: definition.id, level: 1, exp: 0 };
    skills.push(skill);
  }
  const trained = addSkillExperience(skill, skillExp);
  Object.assign(skill, trained);
  profile.skills = skills;

  let levelUpNotify = null;
  if (skill.level > previousLevel) {
    profile.skillHistory = appendSkillHistory(profile.skillHistory, {
      skillId: definition.id,
      fromLevel: previousLevel,
      toLevel: skill.level,
      reason,
      source: 'story',
      timestamp: Date.now(),
    });
    const awakenedNow = previousLevel === 0;
    levelUpNotify = {
      type: awakenedNow ? 'skill_awakened' : 'skill_level_up',
      female,
      skillId: definition.id,
      skillName: definition.name,
      fromLevel: previousLevel,
      toLevel: skill.level,
      awakened: awakenedNow,
      text: awakenedNow
        ? `${female}觉醒了技能「${definition.name}」${skill.level > 1 ? `，并提升至 Lv${skill.level}` : ''}`
        : `${female}的「${definition.name}」由 Lv${previousLevel} 提升至 Lv${skill.level}`,
    };
  }

  let inheritedFetusIndex = -1;
  let inheritedExp = 0;
  const stage = String(profile?.base?.stage || '');
  if (skillExp > 0 && FETAL_TALENT_TRANSFER_STAGES.has(stage)) {
    const pregnant = profile.pregnant || {};
    const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((fetus) => ({ ...fetus })) : [];
    inheritedFetusIndex = pickImplantedFetusIndex(fetuses);
    if (inheritedFetusIndex >= 0) {
      const selectedFetus = fetuses[inheritedFetusIndex];
      const affinity = clampNumber(selectedFetus?.affinity, -50, 50, 0);
      inheritedExp = Math.round(skillExp * (Math.abs(affinity) / 50)) * Math.sign(affinity);
      const fetusTalents = normalizeTalentList(selectedFetus.talents);
      let fetusTalent = fetusTalents.find((item) => item.skillId === definition.id);
      if (inheritedExp !== 0 && !fetusTalent) {
        fetusTalent = { skillId: definition.id, level: 0, exp: 0 };
        fetusTalents.push(fetusTalent);
      }
      if (inheritedExp !== 0) {
        Object.assign(fetusTalent, addTalentExperience(fetusTalent, inheritedExp));
        selectedFetus.talents = fetusTalents;
      }
    }
    pregnant.fetuses = fetuses;
    profile.pregnant = pregnant;
  }

  next.profile = profile;
  next.updatedAt = Date.now();
  chatState.characters[female] = next;
  return {
    applied: true,
    message: `bsTrainSkill applied to ${female}: ${definition.name} Lv${skill.level}, EXP ${skill.exp}/${skill.level >= 10 ? 0 : requiredExp(skill.level)}${awakened ? '; awakened' : ''}${inheritedFetusIndex >= 0 ? `; fetus #${inheritedFetusIndex + 1} selected${inheritedExp !== 0 ? `, inherited EXP ${inheritedExp}` : ', no inherited EXP'}` : ''}.`,
    ...(levelUpNotify ? { notify: levelUpNotify } : {}),
  };
}

function applyUpdatePsychology(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  const options = args?.options && typeof args.options === 'object' ? args.options : null;
  if (!female || !character) return { applied: false, message: `bsUpdatePsychology skipped: unknown character ${female || '(empty)'}.` };
  if (!options) return { applied: false, message: 'bsUpdatePsychology skipped: empty options.' };

  const next = cloneValue(character);
  const profile = next.profile || {};
  if (!hasBreedingPsychology(profile)) {
    return { applied: false, message: `bsUpdatePsychology skipped for ${female}: breeding psychology is not inferred.` };
  }
  const psychology = profile.psychology || {};
  const base = profile.base || {};
  const stage = String(base.stage || '');
  // 回归期算妊娠侧：体感本来就是孕育状态，而且写进 mens 的资料会在转入妊娠满 7 天时
  // 被 clearPsychologyTransitionState 清空（实测：孕 10 天后 mens.stance 变 undefined），
  // 等于白写一场。
  const isPregnancySide = PREGNANCY_STAGES.includes(stage) || stage === '假孕期' || stage === '产兆前驱' || stage === WOMB_RETURN_STAGE || LABOR_STAGES.includes(stage);

  if (stage === '产后恢复' || psychology.pendingSide) return { applied: false, message: '心理侧尚未成立，需单侧推演。' };
  const targetGroup = isPregnancySide ? 'preg' : 'mens';
  const sourcePatch = options[targetGroup];
  if (!sourcePatch || typeof sourcePatch !== 'object') {
    return { applied: false, message: `bsUpdatePsychology skipped for ${female}: current stage expects ${targetGroup} updates.` };
  }

  const fieldConfig = targetGroup === 'preg' ? PSY_PREG_FIELDS : PSY_MENS_FIELDS;
  const boolFieldConfig = targetGroup === 'preg' ? PSY_PREG_BOOL_FIELDS : PSY_MENS_BOOL_FIELDS;
  const stageProfiles = normalizePsychologyStageProfiles(psychology.stageProfiles);
  const target = normalizePsychologyGroup(psychology[targetGroup], fieldConfig, {
    booleanFields: boolFieldConfig,
    stageProfiles: stageProfiles[targetGroup],
  });
  const allowedFields = Object.keys(fieldConfig);
  const allowedBoolFields = Object.keys(boolFieldConfig);

  let changed = false;
  for (const field of allowedFields) {
    if (sourcePatch[field] === undefined) continue;
    const valueKey = `${field}_value`;
    if (target[valueKey] === null || target[valueKey] === undefined || !Number.isFinite(Number(sourcePatch[field]))) continue;
    const currentValue = clampNumber(target[valueKey], 0, 100, 0);
    target[valueKey] = clampNumber(currentValue + Number(sourcePatch[field] || 0), 0, 100, currentValue);
    changed = true;
  }
  for (const field of allowedBoolFields) {
    if (sourcePatch[field] === undefined) continue;
    target[field] = Boolean(sourcePatch[field]);
    changed = true;
  }

  if (!changed) {
    return { applied: false, message: `bsUpdatePsychology skipped for ${female}: no allowed ${targetGroup} fields.` };
  }
  const cooldown = profile.cooldown || {};
  if (cooldown.psychologyUpdateUsed) {
    return { applied: false, message: `bsUpdatePsychology skipped for ${female}: already changed during this story hour.` };
  }

  const normalizedTarget = normalizePsychologyGroup(target, fieldConfig, {
    booleanFields: boolFieldConfig,
    stageProfiles: stageProfiles[targetGroup],
  });
  profile.psychology = {
    ...(profile.psychology || {}),
    stageProfiles,
    mens: targetGroup === 'mens'
      ? normalizedTarget
      : normalizePsychologyGroup(profile.psychology?.mens, PSY_MENS_FIELDS, {
        booleanFields: PSY_MENS_BOOL_FIELDS,
        stageProfiles: stageProfiles.mens,
      }),
    preg: targetGroup === 'preg'
      ? normalizedTarget
      : normalizePsychologyGroup(profile.psychology?.preg, PSY_PREG_FIELDS, {
        booleanFields: PSY_PREG_BOOL_FIELDS,
        stageProfiles: stageProfiles.preg,
      }),
  };
  profile.cooldown = {
    ...cooldown,
    psychologyUpdateUsed: true,
  };
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsUpdatePsychology applied to ${female}.` };
}

function applyAddSperm(chatState, args) {
  const female = String(args?.female || '').trim();
  const male = String(args?.male || '').trim();
  const fatherBase = chatState.characters?.[male]?.profile?.base;
  const parsedRace = parseRaceDescriptor(args?.race || fatherBase?.race || '人类');
  const race = parsedRace.race || '人类';
  const ancestry = getBloodlineInfo(race, args?.bloodline ?? parsedRace.bloodline ?? fatherBase?.bloodline,
    args?.bloodline || parsedRace.bloodline ? 'explicit' : fatherBase?.bloodlineSource);
  const action = String(args?.action || '').trim();
  const amount = Number(args?.amount);
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsAddSperm skipped: unknown character ${female || '(empty)'}.` };
  if (!male) return { applied: false, message: 'bsAddSperm skipped: empty male.' };
  if (!['insert', 'deposit', 'withdraw'].includes(action)) {
    return { applied: false, message: 'bsAddSperm skipped: action 必须是 insert、deposit 或 withdraw。' };
  }
  if (!Number.isFinite(amount)) return { applied: false, message: 'bsAddSperm skipped: invalid amount.' };
  if (amount < 0) return { applied: false, message: 'bsAddSperm skipped: negative amount 请改用 bsDrainSperm 扣除精液。' };

  if (args.hasCondom !== undefined && typeof args.hasCondom !== 'boolean') return { applied: false, message: 'hasCondom 必须为 boolean。' };
  const next = cloneValue(character);
  const base = next.profile?.base || {};
  const currentState = ['idle', 'inserted', 'spent'].includes(base.penetrationState)
    ? base.penetrationState
    : 'idle';
  const currentSource = String(base.penetrationSource || '').trim();

  if (action === 'insert') {
    if (amount !== 0) return { applied: false, message: `bsAddSperm skipped for ${female}: insert 的 amount 必须为 0。` };
    base.penetrationState = 'inserted';
    base.penetrationCondom = args.hasCondom ?? false;
    base.penetrationSource = male;
    base.latestSexDays = 0;
    next.profile.base = base;
    setVisualCue(next.profile, base.penetrationCondom ? 'insertCondom' : 'insert');
    const experience = { ...(next.profile?.experience || {}), latestSexPartner: male };
    if (experience.virginity === null || experience.virginity === undefined) experience.virginity = male;
    next.profile.experience = experience;
    const pushback = applyInsertionPushback(next.profile, female);
    if (pushback) next.profile.notify = { ...(next.profile.notify || {}), secondly: pushback };
    chatState.characters[female] = pushback ? syncCharacterStageFromProfile(next) : next;
    const handoff = currentState !== 'idle' && currentSource && currentSource !== male;
    return {
      applied: true,
      message: `bsAddSperm insert applied to ${female}: ${handoff ? `${currentSource} → ${male} handoff, ` : ''}penetrationState=inserted.${pushback ? ` ${pushback}。` : ''}`,
    };
  }

  if (action === 'withdraw') {
    if (amount !== 0) return { applied: false, message: `bsAddSperm skipped for ${female}: withdraw 的 amount 必须为 0。` };
    if (currentState !== 'idle' && currentSource && currentSource !== male) {
      return { applied: false, message: `bsAddSperm skipped for ${female}: 当前插入来源是 ${currentSource}，不是 ${male}。` };
    }
    base.penetrationState = 'idle';
    base.penetrationSource = null;
    base.penetrationCondom = false;
    next.profile.base = base;
    chatState.characters[female] = next;
    return { applied: true, message: `bsAddSperm withdraw applied to ${female}: penetrationState=idle.` };
  }

  if (amount <= 0) return { applied: false, message: `bsAddSperm skipped for ${female}: deposit 的 amount 必须为正数。` };
  if (currentState !== 'inserted') {
    return { applied: false, message: `bsAddSperm skipped for ${female}: 当前状态为 ${currentState}，必须先 action=insert、amount=0。` };
  }
  if (currentSource && currentSource !== male) {
    return { applied: false, message: `bsAddSperm skipped for ${female}: 当前插入来源是 ${currentSource}，不是 ${male}。` };
  }

  const config = normalizeReproductiveSettings(chatState.reproductiveSettings);
  const hasCondom = args.hasCondom ?? base.penetrationCondom ?? false;
  const condomOverflow = hasCondom && amount > config.condomCapacity; const condomFailed = condomOverflow || (hasCondom && Math.random() >= config.condomReliability); const condomFailReason = condomFailed ? (condomOverflow ? 'overflow' : 'tear') : null;
  const enteredAmount = hasCondom && !condomFailed ? 0 : amount;
  base.penetrationCondom = hasCondom;
  const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  const maleDerivedType = parsedRace.derivedType || null;
  const existing = sperms.find((item) => String(item?.male || '') === male);
  if (enteredAmount > 0) {
    if (existing) {
      existing.value = Math.max(0, clampNumber(existing.value, 0, 999999, 0) + enteredAmount);
      existing.race = race;
      existing.derivedType = maleDerivedType;
      Object.assign(existing, ancestry);
    } else sperms.push({ male, race, ...ancestry, derivedType: maleDerivedType, value: enteredAmount });
    base.nextSpermContactId = (Number(base.nextSpermContactId) || 0) + 1;
    base.spermContacts = [...(base.spermContacts || []), {
      id: base.nextSpermContactId, male, race, ...ancestry, derivedType: maleDerivedType,
      minutesPassed: Number(chatState.minutesPassed) || 0, value: enteredAmount, blocked: false,
    }];
  }
  base.sperms = sperms.filter((item) => clampNumber(item?.value, 0, 999999, 0) > 0);
  next.profile.lastCondomResult = { hasCondom, condomFailed, condomFailReason, enteredAmount, minutesPassed: Number(chatState.minutesPassed) || 0 };
  base.penetrationState = 'spent';
  base.penetrationSource = male;
  base.latestSexDays = 0;
  next.profile.base = base;
  const experience = {
    ...(next.profile?.experience || {}),
    latestSexPartner: male,
  };
  if (experience.virginity === null || experience.virginity === undefined) {
    experience.virginity = male;
  }
  next.profile.experience = experience;
  if (enteredAmount > 0) {
    applyOdorGain(next.profile, Math.min(18, 4 + Math.log10(Math.max(1, enteredAmount)) * 4));
    setVisualCue(next.profile, condomFailed ? (condomOverflow ? 'condomOverflow' : 'condomBreak') : 'ejaculate');
  } else if (hasCondom) setVisualCue(next.profile, 'ejaculateCondom');
  const ripening = enteredAmount > 0 ? applyProdromalSemenRipening(next.profile, female) : null;
  if (ripening) next.profile.notify = { ...(next.profile.notify || {}), secondly: ripening };
  chatState.characters[female] = ripening ? syncCharacterStageFromProfile(next) : next;
  return { applied: true, message: `bsAddSperm deposit applied to ${female}: penetrationState=spent, hasCondom=${hasCondom}, condomFailed=${condomFailed}${condomFailReason ? ` (${condomFailReason === 'overflow' ? '超过容量撑破' : '套子破裂'})` : ''}, enteredAmount=${enteredAmount}（系统结算，不代表角色知情；下轮承接）.${ripening ? ` ${ripening}。` : ''}` };
}

function applyDrainSperm(chatState, args) {
  const female = String(args?.female || '').trim();
  const amount = Number(args?.amount || 0);
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDrainSperm skipped: unknown character ${female || '(empty)'}.` };
  if (!Number.isFinite(amount) || amount <= 0) return { applied: false, message: 'bsDrainSperm skipped: invalid amount.' };

  const next = cloneValue(character);
  const base = next.profile?.base || {};
  let sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  const total = sperms.reduce((sum, item) => sum + clampNumber(item?.value, 0, 999999, 0), 0);

  if (total <= amount) {
    base.sperms = [];
    rescaleSpermContacts(base);
    next.profile.base = base;
    chatState.characters[female] = next;
    return { applied: true, message: `bsDrainSperm cleared all sperm for ${female}.` };
  }

  const factor = amount / total;
  sperms = sperms
    .map((item) => ({
      ...item,
      value: Math.max(Math.floor(clampNumber(item?.value, 0, 999999, 0) - (clampNumber(item?.value, 0, 999999, 0) * factor)), 0),
    }))
    .filter((item) => item.value > 0);

  base.sperms = sperms;
  rescaleSpermContacts(base);
  next.profile.base = base;
  chatState.characters[female] = next;
  return { applied: true, message: `bsDrainSperm applied to ${female}.` };
}

function applySetMenstrualPhases(chatState, args) {
  const female = String(args?.female || '').trim();
  let stage = String(args?.stage || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsSetMenstrualPhases skipped: unknown character ${female || '(empty)'}.` };
  if (!stage) return { applied: false, message: 'bsSetMenstrualPhases skipped: empty stage.' };

  const allowedStages = new Set([...MENSTRUAL_STAGES, '产后恢复', '假孕期']);
  if (!allowedStages.has(stage)) {
    return { applied: false, message: `bsSetMenstrualPhases skipped: invalid stage ${stage}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const cooldown = profile.cooldown || {};
  const notify = profile.notify || {};
  const currentStage = String(base.stage || '');
  if (['产后恢复', '假孕期'].includes(currentStage) && stage !== currentStage) stage = '月经期';
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const hasConceptionState = fetuses.length > 0
    || clampNumber(base.fertilizationDays, 0, 9999, 0) > 0
    || (!['假孕期', '产后恢复'].includes(currentStage) && (clampNumber(pregnant.pregnantDays, 0, 9999, 0) > 0 || clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) > 0));
  const hasProtectedPregnancyState = PREGNANCY_STAGES.includes(currentStage)
    || currentStage === '产兆前驱'
    || currentStage === WOMB_RETURN_STAGE
    || LABOR_STAGES.includes(currentStage);

  if (hasConceptionState || hasProtectedPregnancyState) {
    return {
      applied: false,
      message: `bsSetMenstrualPhases skipped for ${female}: active conception or pregnancy state must not be overridden.`,
    };
  }

  base.stage = stage;
  base.days = 0;
  if (stage === '月经期' && ['产后恢复', '假孕期'].includes(currentStage)) clearPregnancyState(profile);
  profile.base = base;
  if (stage === '卵泡期') {
    const metabolism = profile.metabolism || {};
    metabolism.milk = 0;
    profile.metabolism = metabolism;
  }
  // 手动切阶段视同进入该阶段：排卵期从新的一轮开始，黄体期吃到那一次刷新
  if (stage === '排卵期') {
    profile.cooldown = {
      ...cooldown,
      orgasmOvulationUsed: false,
      lutealOrgasmRefreshed: false,
    };
  } else {
    profile.cooldown = {
      ...cooldown,
      ...nextOrgasmOvulationCooldown(stage, stage === '黄体期' ? { ...cooldown, lutealOrgasmRefreshed: false } : cooldown),
      naturalOvulationUsed: false,
    };
  }

  if (stage === '假孕期') {
    pregnant.pregnantDays = 0;
    pregnant.effectivePregnantDays = 0;
  }

  profile.base = base;
  profile.pregnant = pregnant;
  profile.notify = {
    ...notify,
    firstly: `${female}进入了${stage}`,
  };
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsSetMenstrualPhases applied to ${female}.` };
}

function applyDebugInjectPregnancy(chatState, args) {
  const female = String(args?.female || '').trim();
  const mode = String(args?.mode || 'normal').trim();
  const fatherInput = String(args?.father || '').trim();
  const raceInput = String(args?.race || '人类').trim();
  const fetusCount = Math.floor(clampNumber(args?.fetusCount, 1, 9, 1));
  const equivalentDays = clampNumber(args?.equivalentDays, 0, 300, 0);
  const genderInput = String(args?.genders || '').trim();
  // 胎内回归的正式机制没有同卵分裂；兼容旧 UI 残留值，但不执行。
  const forceIdentical = mode !== 'womb_return' && args?.forceIdentical === true;
  const forceChimera = args?.forceChimera === true;
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugInjectPregnancy skipped: unknown character ${female || '(empty)'}.` };

  const supportedModes = ['normal', 'surrogacy', 'womb_return', 'superfetation', 'nested'];
  if (!supportedModes.includes(mode)) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: unsupported mode ${mode || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const experience = profile.experience || {};
  const notify = profile.notify || {};
  const bio = profile.bio || {};
  profile.pregnant = pregnant;
  const currentStage = String(base.stage || '');
  const existingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const hasConceptionState = existingFetuses.length > 0
    || clampNumber(base.fertilizationDays, 0, 9999, 0) > 0
    || isPregnancyStage(currentStage);
  const isAdditionalSurrogacy = mode === 'surrogacy' && hasConceptionState;
  const isAdditionalConception = mode === 'superfetation' || mode === 'nested' || isAdditionalSurrogacy;
  if (!isAdditionalConception && hasConceptionState) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: pregnancy/conception state already exists.` };
  }
  if (isAdditionalConception && currentStage !== SUPERFETATION_STAGE) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: ${mode} is only available during 孕早期.` };
  }
  if (isAdditionalConception && !existingFetuses.some((fetus) => isImplantedFetus(fetus))) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: an implanted fetus is required.` };
  }
  if (isAdditionalConception) {
    const windowDays = getSuperfetationWindowDays(profile);
    const conceivedAtDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
    if (windowDays <= 0 || conceivedAtDays >= windowDays) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: the superfetation window has closed.` };
    }
  }
  if (forceChimera && !['normal', 'surrogacy'].includes(mode)) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: forced chimera is only available for normal or surrogacy conception.` };
  }
  if (forceChimera && fetusCount < 2) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: forced chimera requires at least 2 base embryos.` };
  }

  if (mode === 'womb_return') {
    const returner = String(args?.returner || '').trim();
    const requestedGender = ({ 男: '男', 女: '女', 双: '双', 雙: '双', 無: '无', 无: '无' })[genderInput];
    if (genderInput && !requestedGender) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: womb return gender must be one supported value.` };
    }
    const returned = applyWombReturn(chatState, {
      female,
      returner,
      returnerRace: String(args?.returnerRace || '').trim(),
      hours: 0,
    });
    if (!returned?.applied) return returned;
    const returnedCharacter = chatState.characters?.[female];
    const returnedProfile = returnedCharacter?.profile || {};
    const returnedFetuses = Array.isArray(returnedProfile?.pregnant?.fetuses) ? returnedProfile.pregnant.fetuses : [];
    if (requestedGender && returnedFetuses[0]) returnedFetuses[0].gender = requestedGender;
    if (forceIdentical) forceIdenticalTwinSplit(returnedProfile, returnedFetuses);
    snapshotOriginalPregnancyBio(returnedCharacter);
    applyPregnancyPhysiology(returnedProfile, returnedCharacter.runtime || {});
    updateFetalEnergyDrain(returnedProfile);
    returnedProfile.notify = {
      ...(returnedProfile.notify || {}),
      secondly: `${returner}已由调试工具直接进入${female}的孕早期${forceIdentical ? '，并分裂为同卵双胎' : ''}`,
    };
    return { applied: true, message: `bsDebugInjectPregnancy applied womb return to ${female}.` };
  }

  const rawGenderList = genderInput
    ? genderInput.split(',').map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (rawGenderList.length > 1 && rawGenderList.length !== fetusCount) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: genders count must be 1 or match fetusCount.` };
  }

  const rawFatherList = fatherInput
    ? fatherInput.split(',').map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (rawFatherList.length > 1 && rawFatherList.length !== fetusCount) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: fathers count must be 1 or match fetusCount.` };
  }

  const rawRaceList = raceInput
    ? raceInput.split(',').map((item) => String(item || '').trim()).filter(Boolean)
    : ['人类'];
  if (rawRaceList.length > 1 && rawRaceList.length !== fetusCount) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: races count must be 1 or match fetusCount.` };
  }

  const allowedGenderMap = {
    男: '男',
    女: '女',
    双: '双',
    雙: '双',
    無: '无',
    无: '无',
  };
  const normalizedGenderList = rawGenderList.map((item) => allowedGenderMap[item]);
  if (normalizedGenderList.some((item) => !item)) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: unsupported gender value.` };
  }

  let geneticProfile = profile;
  let provider = null;
  let secondaryProvider = null;
  let secondaryGeneticProfile = null;
  if (mode === 'surrogacy') {
    provider = String(args?.provider || '').trim();
    if (!provider) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: provider is required for surrogacy.` };
    }
    if (provider === female) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: provider must differ from carrier.` };
    }
    const providerCharacter = chatState.characters?.[provider];
    const providerRaceInput = String(args?.providerRace || '').trim();
    const providerDescriptor = providerRaceInput
      ? parseRaceDescriptor(providerRaceInput)
      : parseRaceDescriptor(providerCharacter?.profile?.base?.race || base.race || '人类');
    geneticProfile = { base: { race: providerDescriptor.race || '人类', ...getBloodlineInfo(providerDescriptor.race || '人类', providerDescriptor.bloodline ?? providerCharacter?.profile?.base?.bloodline, providerDescriptor.bloodline ? 'explicit' : providerCharacter?.profile?.base?.bloodlineSource) } };

    if (forceChimera) {
      const requestedSecondaryProvider = String(args?.secondaryProvider || '').trim();
      secondaryProvider = requestedSecondaryProvider || provider;
      if (secondaryProvider === female) {
        return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: secondary provider must differ from carrier.` };
      }
      if (requestedSecondaryProvider && secondaryProvider === provider) {
        return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: secondary provider must differ from the first provider.` };
      }
      if (!requestedSecondaryProvider) {
        secondaryGeneticProfile = geneticProfile;
      } else {
        const secondaryProviderCharacter = chatState.characters?.[secondaryProvider];
        const secondaryProviderRaceInput = String(args?.secondaryProviderRace || '').trim();
        const secondaryProviderDescriptor = secondaryProviderRaceInput
          ? parseRaceDescriptor(secondaryProviderRaceInput)
          : parseRaceDescriptor(secondaryProviderCharacter?.profile?.base?.race || base.race || '人类');
        secondaryGeneticProfile = { base: { race: secondaryProviderDescriptor.race || '人类', ...getBloodlineInfo(secondaryProviderDescriptor.race || '人类', secondaryProviderDescriptor.bloodline ?? secondaryProviderCharacter?.profile?.base?.bloodline, secondaryProviderDescriptor.bloodline ? 'explicit' : secondaryProviderCharacter?.profile?.base?.bloodlineSource) } };
      }
    }
  }

  snapshotOriginalPregnancyBio(next);

  ensureEmbryoMetadata(pregnant);
  const hadPendingImplantation = existingFetuses.some((fetus) => !isImplantedFetus(fetus));
  let nestedHost = null;
  if (mode === 'nested') {
    const hostIndex = Number(args?.hostFetusIndex);
    if (!Number.isInteger(hostIndex) || hostIndex < 0 || hostIndex >= existingFetuses.length) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: choose a valid host fetus.` };
    }
    nestedHost = existingFetuses[hostIndex];
    if (!isImplantedFetus(nestedHost)) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: host fetus must already be implanted.` };
    }
    // 调试也挡：卵生在壳里、卵胎生在卵膜里，物理上进不去
    if (!canHostNestedPregnancy(nestedHost)) {
      return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: ${String(nestedHost.embryoType || '胎生')} 的胎儿包在壳或卵膜里，不能当孕中孕宿主（只有胎生、胎转卵生、不定型可以）。` };
    }
  }

  const fetuses = [];
  for (let index = 0; index < fetusCount; index += 1) {
    const spermSeed = {
      male: rawFatherList.length === 0 ? '未知' : (rawFatherList.length === 1 ? rawFatherList[0] : rawFatherList[index]),
      race: parseRaceDescriptor(rawRaceList.length === 1 ? rawRaceList[0] : rawRaceList[index]).race || '人类',
      derivedType: null,
    };
    const spermDescriptor = parseRaceDescriptor(rawRaceList.length === 1 ? rawRaceList[0] : rawRaceList[index]);
    Object.assign(spermSeed, getBloodlineInfo(spermSeed.race, spermDescriptor.bloodline
      ?? chatState.characters?.[spermSeed.male]?.profile?.base?.bloodline,
      spermDescriptor.bloodline ? 'explicit' : chatState.characters?.[spermSeed.male]?.profile?.base?.bloodlineSource));
    const usesSecondaryProvider = mode === 'surrogacy' && forceChimera && index === 1;
    const fetus = createSimpleFetus(
      profile,
      spermSeed,
      isAdditionalConception || equivalentDays > 0 ? '孕早期' : currentStage,
      {
        geneticProfile: usesSecondaryProvider ? secondaryGeneticProfile : geneticProfile,
        provider: usesSecondaryProvider ? secondaryProvider : provider,
      },
    );
    if (normalizedGenderList.length === 1) {
      fetus.gender = normalizedGenderList[0];
    } else if (normalizedGenderList.length === fetusCount) {
      fetus.gender = normalizedGenderList[index];
    }
    if (mode === 'superfetation' || isAdditionalSurrogacy) markSuperfetationFetus(profile, fetus);
    if (mode === 'nested') markNestedFetus(profile, fetus, nestedHost);
    fetuses.push(fetus);
  }

  pregnant.fetuses = isAdditionalConception ? [...existingFetuses, ...fetuses] : fetuses;
  ensureEmbryoMetadata(pregnant);
  const injectedBatch = forceChimera ? forceChimeraFusion(profile, female, fetuses) : fetuses;
  if (forceIdentical) forceIdenticalTwinSplit(profile, injectedBatch);
  pregnant.fetusesCount = pregnant.fetuses.length;
  // 异期、孕中孕与孕期追加的代孕都是隐藏胎，不发事件
  if (!isAdditionalConception) {
    setVisualCue(profile, forceChimera
      ? 'chimera'
      : mode === 'womb_return' ? 'rebirth' : mode === 'surrogacy' ? 'surrogacy' : 'fertilization');
  }
  if (isAdditionalConception) {
    if (!hadPendingImplantation) base.fertilizationDays = 0;
    applyPregnancyPhysiology(profile, next.runtime || {});
    updateFetalEnergyDrain(profile);
    profile.notify = {
      ...notify,
      secondly: mode === 'nested'
        ? `${female}指定胎儿内已注入${fetusCount}个孕中孕胚胎，正等待著床${forceIdentical ? '（已强制同卵分裂）' : ''}`
        : isAdditionalSurrogacy
          ? `${female}已注入${fetusCount}个代孕异期胚胎，正等待著床${forceIdentical ? '（已强制同卵分裂）' : ''}`
          : `${female}已注入${fetusCount}个异期受孕胚胎，正等待著床${forceIdentical ? '（已强制同卵分裂）' : ''}`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsDebugInjectPregnancy applied ${mode} to ${female}.` };
  }

  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborBirthNumber = 0;
  pregnant.deliveredCount = 0;
  pregnant.extensionCount = 0;
  pregnant.extensionUntilDays = null;
  pregnant.presentingEmbryoId = null;
  pregnant.laborPain = 0;
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
  for (const fetus of Array.isArray(pregnant.fetuses) ? pregnant.fetuses : []) fetus.amnionDurability = AMNION_INTACT;
  pregnant.pregnantDays = 0;
  pregnant.effectivePregnantDays = equivalentDays === 0 ? 0 : equivalentDays;

  profile.base = base;
  if (equivalentDays === 0) {
    base.fertilizationDays = 0;
  } else {
    resolvePendingChimeraGenders(pregnant.fetuses);
    applyPregnancyPhysiology(profile, next.runtime || {});
    const actualGestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, GESTATION_SPEED_MAX, 1);
    pregnant.pregnantDays = actualGestationSpeed > 0 ? Math.max(0, equivalentDays / actualGestationSpeed) : equivalentDays;
    pregnant.effectivePregnantDays = Math.max(0, equivalentDays);
    const derived = derivePregnancyStageState(pregnant.effectivePregnantDays, 1);
    base.stage = derived.stage;
    base.days = derived.days;
    base.fertilizationDays = 0;
    experience.pregnantExperience = clampNumber(experience.pregnantExperience, 0, 999, 0) + 1;
  }

  profile.pregnant = pregnant;
  profile.experience = experience;
  updateFetalEnergyDrain(profile);
  profile.notify = {
    ...notify,
    secondly: equivalentDays === 0
      ? `${female}已注入${fetusCount}个刚受精胚胎，尚未着床${forceChimera ? '（前两胎已强制嵌合）' : ''}${forceIdentical ? '（已强制同卵分裂）' : ''}`
      : `${female}已注入${pregnant.fetuses.length}胎，当前为等效妊娠${equivalentDays}天${forceChimera ? '（含强制嵌合胎）' : ''}${forceIdentical ? '（已强制同卵分裂）' : ''}`,
  };

  next.profile = profile;
  chatState.characters[female] = equivalentDays > 0 ? syncCharacterStageFromProfile(next) : next;
  return { applied: true, message: `bsDebugInjectPregnancy applied to ${female}.` };
}

function applyDebugClearContainers(chatState, args) {
  const female = String(args?.female || '').trim();
  const container = String(args?.container || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugClearContainers skipped: unknown character ${female || '(empty)'}.` };
  if (!['sperms', 'fetuses', 'children'].includes(container)) {
    return { applied: false, message: `bsDebugClearContainers skipped for ${female}: unsupported container ${container || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const experience = profile.experience || {};
  const notify = profile.notify || {};
  const stage = String(base.stage || '');

  if (container === 'sperms') {
    const sperms = Array.isArray(base.sperms) ? base.sperms : [];
    if (sperms.length === 0) {
      return { applied: false, message: `bsDebugClearContainers skipped for ${female}: no sperms.` };
    }
    base.sperms = [];
    profile.base = base;
    profile.notify = {
      ...notify,
      secondly: `${female}体内残留精液已被调试淨空`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsDebugClearContainers cleared sperms for ${female}.` };
  }

  if (container === 'children') {
    const children = Array.isArray(profile.children) ? profile.children : [];
    if (children.length === 0) {
      return { applied: false, message: `bsDebugClearContainers skipped for ${female}: no children.` };
    }
    profile.children = [];
    profile.notify = {
      ...notify,
      secondly: `${female}的孩子记录已被调试淨空`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsDebugClearContainers cleared children for ${female}.` };
  }

  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const fertilizationDays = clampNumber(base.fertilizationDays, 0, 9999, 0);
  const hasConceptionState = fetuses.length > 0 || fertilizationDays > 0 || isPregnancyStage(stage);
  if (!hasConceptionState) {
    return { applied: false, message: `bsDebugClearContainers skipped for ${female}: no fetuses or conception state.` };
  }

  const implantedPregnancy = isPregnancyStage(stage) || clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) > 0;
  const recoveryDays = settlePostpartumRecoveryDays(profile, { miscarriage: true });
  clearPregnancyState(profile);
  restorePregnancyPhysiology(profile, next.runtime || {});
  if (implantedPregnancy) {
    assignPostpartumRecoveryDays(profile, recoveryDays);
    base.stage = '产后恢复';
    base.days = 0;
    experience.miscarriageExperience = clampNumber(experience.miscarriageExperience, 0, 999, 0) + 1;
    profile.experience = experience;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了产后恢复`,
      secondly: `${female}的胎儿已被调试淨空，并记录一次流产经验`,
    };
    next.profile = profile;
    chatState.characters[female] = syncCharacterStageFromProfile(next);
    return { applied: true, message: `bsDebugClearContainers cleared implanted pregnancy for ${female}.` };
  }

  profile.notify = {
    ...notify,
    secondly: `${female}尚未着床的受精卵已被调试淨空`,
  };
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsDebugClearContainers cleared pre-implantation conception for ${female}.` };
}

function applyDebugSetGestationModifier(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  const clear = Boolean(args?.clear);
  if (!female || !character) return { applied: false, message: `bsDebugSetGestationModifier skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const bio = profile.bio || {};
  const notify = profile.notify || {};
  const stage = String(profile?.base?.stage || '');
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  const runtimeBaseSpeed = Number(next.runtime?.originalPregnancyBio?.gestationSpeciesSpeed);
  const baseSpeed = clampNumber(
    Number.isFinite(runtimeBaseSpeed) && runtimeBaseSpeed > 0 ? runtimeBaseSpeed : getGestationSpeciesSpeed(profile),
    0.1,
    20,
    1.0,
  );

  bio.gestationSpeciesSpeed = baseSpeed;
  if (clear) {
    bio.gestationModifierMultiplier = 1.0;
    bio.gestationModifierName = '';
    bio.gestationModifierDescription = '';
  } else {
    const name = String(args?.name || '').trim();
    const description = String(args?.description || '').trim();
    const multiplier = clampNumber(args?.multiplier, 0, GESTATION_SPEED_MAX, 1.0);
    if (!name) return { applied: false, message: `bsDebugSetGestationModifier skipped for ${female}: empty name.` };
    bio.gestationModifierMultiplier = multiplier;
    bio.gestationModifierName = name;
    bio.gestationModifierDescription = description;
  }

  bio.gestationEffectiveSpeed = clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, GESTATION_SPEED_MAX, baseSpeed);
  profile.bio = bio;

  if (fetuses.length > 0 && isPregnancyStage(stage)) {
    applyPregnancyPhysiology(profile, next.runtime || {});
  }

  profile.notify = {
    ...notify,
    firstly: clear
      ? `${female}失去了妊娠变速效果`
      : `${female}获得了妊娠变速效果「${bio.gestationModifierName}」x${Number(bio.gestationModifierMultiplier || 0).toFixed(2)}`,
    secondly: clear
      ? `${female}的妊娠变速效果已被清除`
      : Number(bio.gestationModifierMultiplier || 0) === 0
        ? `${female}的胎儿发育已被冻结`
        : `${female}当前妊娠变速倍率为 x${Number(bio.gestationModifierMultiplier || 0).toFixed(2)}`,
  };

  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsDebugSetGestationModifier applied to ${female}.` };
}

function applyDebugFetalActivity(chatState, args) {
  const female = String(args?.female || '').trim();
  const activityText = String(args?.activityText || '').trim().slice(0, 500);
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugFetalActivity skipped: unknown character ${female || '(empty)'}.` };
  if (!activityText) return { applied: false, message: `bsDebugFetalActivity skipped for ${female}: empty activity text.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const stage = String(base.stage || '');
  const allowedStages = [...PREGNANCY_STAGES, '产兆前驱', ...LABOR_STAGES];
  if (fetuses.length === 0 || !allowedStages.includes(stage)) {
    return { applied: false, message: `bsDebugFetalActivity skipped for ${female}: fetal activity requires an active pregnancy or labor state with fetuses.` };
  }

  const notify = profile.notify || {};
  const existingSecondary = String(notify.secondly || '').trim();
  profile.notify = {
    ...notify,
    secondly: existingSecondary ? `${existingSecondary}；${activityText}` : activityText,
  };
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsDebugFetalActivity applied to ${female}.` };
}

/**
 * 调试：直接设定某一胎的角度、下降位置与先露身分（不对 Tracker 开放）。
 * fetusIndex 是完整阵列的下标（完整变量页看得到全部胎儿，包括未揭晓的）。
 * 设定后仍经过 reconcileFetalDescent：超出阶段上限、入口容量的值会被夹回，一般操作造不出不可能的状态。
 * allowPathologicalState：真实分娩模式下，让这一胎与已在入口 0 的臀位先露胎互锁（这一胎须为头位）。
 */
function applyDebugSetFetalPosition(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  const skip = (reason) => ({ applied: false, message: `bsDebugSetFetalPosition skipped for ${female || '(empty)'}: ${reason}` });
  if (!female || !character) return skip('unknown character.');
  const next = cloneValue(character);
  const profile = next.profile || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const target = Number.isInteger(Number(args?.fetusIndex)) ? fetuses[Number(args.fetusIndex)] : null;
  if (!target) return skip('invalid fetusIndex.');
  if (target.pendingImplantation) return skip('that embryo is not implanted and has no position.');
  const hasAngle = args?.tendencyAngle !== undefined && args?.tendencyAngle !== null && args?.tendencyAngle !== '' && Number.isFinite(Number(args.tendencyAngle));
  const hasDescent = args?.descentStage !== undefined && args?.descentStage !== null && args?.descentStage !== '' && Number.isFinite(Number(args.descentStage));
  if (hasDescent && getEnclosingHost(target, fetuses)) return skip('that fetus is inside its host and follows the host position.');

  const backSide = normalizeBackSide(String(args?.backSide ?? '').trim());
  if (String(args?.backSide ?? '').trim() && !backSide) return skip(`backSide must be one of ${BACK_SIDES.join('/')}.`);
  if (hasAngle) target.tendencyAngle = wrapAngle(Number(args.tendencyAngle));
  if (backSide) target.backSide = backSide;
  if (hasDescent) target.descentStage = Math.max(DESCENT_TOP, Math.min(DESCENT_CROWNED_OUT, Math.round(Number(args.descentStage))));
  if (args?.makePresenting) pregnant.presentingEmbryoId = target.embryoId;
  if (args?.allowPathologicalState) {
    const presenting = fetuses.find((fetus) => fetus.embryoId === pregnant.presentingEmbryoId);
    if (!isRealisticLabor(profile)) return skip('pathological inlet states only exist in realistic labor mode.');
    if (!presenting || presenting === target || getDescentStage(presenting) !== DESCENT_INLET) {
      return skip('a different presenting fetus must already be engaged at the inlet (0).');
    }
    if (!isLockedTwins(presenting, target)) {
      return skip('locked twins need a breech presenting fetus (about 180°) and this fetus head-down (about 0°).');
    }
    target.descentStage = DESCENT_INLET;
    target.inletIntruder = true;
  }
  profile.pregnant = pregnant;
  reconcileFetalDescent(profile);
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  const settled = chatState.characters[female].profile.pregnant.fetuses.find((fetus) => fetus.embryoId === target.embryoId);
  return {
    applied: true,
    message: `bsDebugSetFetalPosition applied to ${female}: ${describeFetalPosition(chatState.characters[female].profile.pregnant, settled)}, ${Math.round(Number(settled?.tendencyAngle) || 0)}°, ${describeBackSide(settled)}.`,
  };
}

function applyDebugSetProdromal(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugSetProdromal skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const allowedEntryStages = ['孕晚期', '临产期', '逾期', '延产期'];
  if (!allowedEntryStages.includes(stage) && stage !== '产兆前驱') {
    return { applied: false, message: `bsDebugSetProdromal skipped for ${female}: stage must be late pregnancy, term, overdue, or prodromal.` };
  }

  const progressPercent = clampNumber(args?.progressPercent, 0, 100, 0);
  const enteringProdromal = stage !== '产兆前驱';
  if (enteringProdromal) {
    enterProdromalStage(profile, female, stage, `${female}已通过调试进入产兆前驱`);
  }

  const initialHours = getProdromalInitialHours(profile);
  pregnant.prodromalRemainingHours = initialHours * (1 - (progressPercent / 100));
  pregnant.prodromalDelayProgressHours = 0;
  updateLaborPain(profile, '产兆前驱', null, progressPercent / 100);
  profile.notify = {
    ...(profile.notify || {}),
    firstly: enteringProdromal ? `${female}进入了产兆前驱` : '',
    secondly: `${female}的产兆前驱调试进度设为${Math.round(progressPercent)}%，剩余约${Math.ceil(pregnant.prodromalRemainingHours)}小时`,
  };

  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsDebugSetProdromal applied to ${female}.` };
}

export function applyToolCall(chatState, call) {
  // 先让每个母体的编号计数器越过现存号码，再执行可能移除胎儿的操作；
  // 否则从未发过号的母体减胎后，会把被移除那胎的号码重发给下一个新胎
  for (const character of Object.values(chatState?.characters || {})) {
    if (call?.name === 'bsPassedTime') ensureNaturalNoticeSample(character.profile, chatState.reproductiveSettings);
    if (call?.name !== 'bsRecordExperience' && character?.profile?.pregnant && typeof character.profile.pregnant === 'object') {
      syncEmbryoCounter(character.profile.pregnant);
      ensureAmnionMetadata(character.profile.pregnant);
      ensureBackSideMetadata(character.profile.pregnant);
    }
  }
  const args = resolvePersonNameArgs(normalizeToolCallArguments(call?.arguments));
  const target = chatState.characters?.[String(args?.female || '').trim()];
  const guarded = ['bsRecordExperience', 'bsAddSperm', 'bsAbortion'].includes(call?.name) && call?.sourceId && target;
  const previous = guarded && (target.profile.reproductiveOperations || []).find((x) => x.source === call.sourceId);
  if (previous) return { ...previous.result, applied: false, unchanged: true, message: `重复来源：${previous.result.message}` };
  if (['产后恢复', '假孕期'].includes(target?.profile?.base?.stage) && ['bsImplantEmbryo', 'bsDebugInjectPregnancy', 'bsWombReturn'].includes(call?.name)) return { applied: false, message: '恢复/假孕须先进入月经，不能跳过周期刷新植入妊娠。' };
  const oldStages = Object.fromEntries(Object.entries(chatState.characters || {}).map(([name, character]) => [name, character.profile?.base?.stage])); const oldIntact = Object.fromEntries(Object.entries(chatState.characters || {}).map(([name, character]) => [name, hasIntactPresentingSac(character.profile)]));
  const result = dispatchToolCall(chatState, call);
  for (const [name, character] of Object.entries(chatState.characters || {})) {
    const oldStage = oldStages[name];
    const stage = character.profile?.base?.stage;
    if (result.applied && stage === '月经期' && oldStage !== stage && call.name !== 'bsPassedTime') refreshCognition(character.profile);
    if (result.applied && call.name !== 'bsPassedTime') syncPsychologyLifecycle(character.profile, oldStage); if (result.applied && !['bsPassedTime', 'bsExcreteMetabolism'].includes(call.name) && (oldStage !== stage || oldIntact[name] !== hasIntactPresentingSac(character.profile))) refreshAdvisoryNotify(character.profile, name);
    if (result.applied && call.name !== 'bsPassedTime') clearResolvedObstructionNotice(character.profile);
  }
  if (guarded && result.applied) {
    const profile = chatState.characters[args.female].profile;
    profile.reproductiveOperations = [...(profile.reproductiveOperations || []), { source: call.sourceId, action: args.action || call.name, result }].slice(-512);
  }
  if (call?.name === 'bsRecordExperience') return result;
  syncAllNutritionBurst(chatState);
  for (const character of Object.values(chatState?.characters || {})) {
    const pregnant = character?.profile?.pregnant;
    if (!pregnant || typeof pregnant !== 'object') continue;
    ensureNaturalNoticeSample(character.profile, chatState.reproductiveSettings);
    releaseRupturedNestedFetuses(pregnant);
    reconcilePresentingReference(pregnant);
    reconcileFetalDescent(character.profile);
    ensureBackSideMetadata(pregnant);
  }
  return result;
}

function dispatchToolCall(chatState, call) {
  const name = String(call?.name || '').trim();
  const args = resolvePersonNameArgs(normalizeToolCallArguments(call?.arguments));
  if (!name) return { applied: false, message: 'Empty tool call name.' };
  if (WOMB_FROZEN_BLOCKED_TOOLS.has(name)) {
    const target = String(args?.female || '').trim();
    const host = getWombReturnHost(chatState.characters?.[target]);
    if (host) {
      return {
        applied: false,
        message: `${name} skipped for ${target}: 她正在 ${host} 体内作为胎儿，生理状态已冻结。`,
      };
    }
  }
  if (name === 'bsPassedTime') return applyPassedTime(chatState, args);
  if (name === 'bsWriteDiary') return applyWriteDiary(chatState, args);
  if (name === 'bsUpdateCharacterStatus') return applyCharacterStatus(chatState, args);
  if (name === 'bsAddWardrobeItem') return applyAddWardrobeItem(chatState, args);
  if (name === 'bsRemoveWardrobeItem') return applyRemoveWardrobeItem(chatState, args);
  if (name === 'bsChangeOutfit') return applyChangeOutfit(chatState, args);
  if (name === 'bsSetDescription') return applyDescription(chatState, args);
  if (name === 'bsSetCharacterPresence') return applySetCharacterPresence(chatState, args);
  if (name === 'bsRecordExperience') return recordExperience(chatState, args, call.sourceId || '');
  if (name === 'bsRegisterSkillDefinition') return applyRegisterSkillDefinition(chatState, args);
  if (name === 'bsTrainSkill') return applyTrainSkill(chatState, args);
  if (name === 'bsUpdatePsychology') return applyUpdatePsychology(chatState, args);
  if (name === 'bsAddSperm') return applyAddSperm(chatState, args);
  if (name === 'bsDrainSperm') return applyDrainSperm(chatState, args);
  if (name === 'bsSetMenstrualPhases') return applySetMenstrualPhases(chatState, args);
  if (name === 'bsExcreteMetabolism') return applyExcreteMetabolism(chatState, args);
  if (name === 'bsAbortion') return applyAbortion(chatState, args);
  if (name === 'bsExtendPregnancy') return applyExtendPregnancy(chatState, args);
  if (name === 'bsImplantEmbryo') return applyImplantEmbryo(chatState, args);
  if (name === 'bsWombReturn') return applyWombReturn(chatState, args);
  if (name === 'bsChildbirth') return applyChildbirth(chatState, args);
  if (name === 'bsMaternalFetalInteraction') return applyMaternalFetalInteraction(chatState, args);
  if (name === 'bsAssistFetalPosition') return applyAssistFetalPosition(chatState, args);
  if (name === 'bsDebugInjectPregnancy') return applyDebugInjectPregnancy(chatState, args);
  if (name === 'bsDebugClearContainers') return applyDebugClearContainers(chatState, args);
  if (name === 'bsDebugSetGestationModifier') return applyDebugSetGestationModifier(chatState, args);
  if (name === 'bsDebugFetalActivity') return applyDebugFetalActivity(chatState, args);
  if (name === 'bsDebugSetProdromal') return applyDebugSetProdromal(chatState, args);
  if (name === 'bsDebugSetFetalPosition') return applyDebugSetFetalPosition(chatState, args);
  return { applied: false, message: `Unsupported tool: ${name}` };
}

const WARDROBE_SYSTEM_TOOLS = new Set(['bsAddWardrobeItem', 'bsRemoveWardrobeItem', 'bsChangeOutfit']);
const SKILL_SYSTEM_TOOLS = new Set(['bsRegisterSkillDefinition', 'bsTrainSkill']);

/** 系统页关掉的扩充系统：工具本来就不会送给模型，模型若凭空呼叫也不执行 */
function getDisabledSystemToolMessage(settings, name) {
  if (WARDROBE_SYSTEM_TOOLS.has(name) && !isWardrobeSystemEnabled(settings)) return `${name} skipped: 着衣系统已在系统页关闭。`;
  if (SKILL_SYSTEM_TOOLS.has(name) && !isSkillSystemEnabled(settings)) return `${name} skipped: 技能系统已在系统页关闭。`;
  return '';
}

/**
 * 模型给的 fetusIndex 对应它收到 payload 时的可见列表；同一批里前面的工具（例如 bsPassedTime 的胎动换位、
 * 减胎）会改变阵列顺序。先记下这批开始时各角色可见胎儿的 embryoId 顺序，执行每个工具前换成当下的下标；
 * 那一胎已不在（出生、被移除）时给 -1，让工具照常以无效下标拒绝。
 */
function captureVisibleFetusOrder(chatState) {
  const order = {};
  for (const [name, character] of Object.entries(chatState?.characters || {})) {
    const fetuses = Array.isArray(character?.profile?.pregnant?.fetuses) ? character.profile.pregnant.fetuses : [];
    order[name] = fetuses.filter(isFetusKnownToCharacter).map((fetus) => fetus?.embryoId);
  }
  return order;
}

function remapBatchFetusIndex(chatState, batchOrder, call) {
  const args = call?.arguments;
  if (!args || !Number.isInteger(args.fetusIndex) || call.name === 'bsDebugSetFetalPosition') return;
  const female = String(args.female || '').trim();
  const embryoId = batchOrder[female]?.[args.fetusIndex];
  if (embryoId === undefined || embryoId === null) return;
  const fetuses = chatState?.characters?.[female]?.profile?.pregnant?.fetuses;
  const visible = (Array.isArray(fetuses) ? fetuses : []).filter(isFetusKnownToCharacter);
  args.fetusIndex = visible.findIndex((fetus) => fetus?.embryoId === embryoId);
}

export function applyToolCallsResult(ctx, result, sourceId = '') {
  const settings = syncCardSettings(ctx, getSettings(ctx));
  const chatState = getChatState(ctx, settings);
  const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
  const logs = [];
  chatState.reproductiveSettings = normalizeReproductiveSettings(settings.reproductiveSettings);
  const batchFetusOrder = captureVisibleFetusOrder(chatState);
  for (const [callIndex, call] of toolCalls.entries()) {
    const normalizedCall = {
      name: String(call?.name || '').trim(),
      arguments: resolvePersonNameArgs(normalizeToolCallArguments(call?.arguments)),
      sourceId: sourceId ? `${sourceId}:${callIndex}` : String(call?.id || ''),
    };
    remapBatchFetusIndex(chatState, batchFetusOrder, normalizedCall);
    const disabledMessage = getDisabledSystemToolMessage(settings, normalizedCall.name);
    const appliedResult = disabledMessage
      ? { applied: false, message: disabledMessage }
      : applyToolCall(chatState, normalizedCall);
    if (appliedResult?.notify?.text) globalThis.toastr?.info?.(appliedResult.notify.text, '[BS BioTracker]');
    logs.push({
      ...appliedResult,
      name: normalizedCall.name,
      arguments: cloneValue(normalizedCall.arguments),
    });
  }
  if (result?.scene_summary !== undefined) chatState.sceneSummary = String(result.scene_summary || '');
  chatState.lastRawResult = summarizeRawResult(result);
  chatState.lastOperationLogs = summarizeOperationLogs(logs);
  saveSettings(ctx);
  return { chatState, logs };
}

/** 破水、娩出、引产等直接改变阶段或胎膜的工具：重建提醒，否则旁白会同时看到「破水了」与「尚未破水」；跨日的日记提醒照旧保留 */
function hasIntactPresentingSac(profile) {
  return clampNumber(getPresentingAmnionDurability(profile?.pregnant || {}), -100, 100, 0) > 0;
}

/** 助产、离场或手术解开阻塞后，不留下「难产警示／产程持续受阻」给下一轮叙事 */
function clearResolvedObstructionNotice(profile) {
  const notify = profile?.notify;
  if (!notify || getLaborObstruction(profile)) return;
  const strip = (text, marker) => String(text || '').split('；').filter((part) => !part.includes(marker)).join('；');
  if (String(notify.firstly || '').includes('发生难产警示')) notify.firstly = strip(notify.firstly, '发生难产警示');
  if (String(notify.secondly || '').includes('产程持续受阻')) notify.secondly = strip(notify.secondly, '产程持续受阻');
}

function refreshAdvisoryNotify(profile, female) {
  if (!profile) return;
  const text = String(profile.notify?.thirdly || '');
  const kept = text.includes('已跨入新的一天') ? text.slice(text.indexOf('已跨入新的一天')) : '';
  updateAdvisoryNotify(profile, female);
  if (kept) appendNotifyReminder(profile.notify, kept);
}

// ── 多胎胎间：转向牵制与互动（v1.1.1）─────────────────────
// 不存新资料：牵制只看当下的左右顺序、胎重与胎量；互动只改角度或左右顺序，
// 与母胎互动共用每小时一次的冷却。

/** 一次转向超过这个角度才会碰到旁边的胎儿 */
const CROWDED_ROTATION_THRESHOLD = 30;
/** 被带动的邻胎跟着转的比例；同一胎囊贴得更紧 */
const CROWDED_DRAG_SHARE = 0.3;
const CROWDED_DRAG_SHARE_SAME_SAC = 0.5;

/** 子宫有多挤：胎量 0.5 以下不挤，3 以上全满（足月三胎） */
function getUterineCrowding(profile) {
  return clampNumber((getFetalBulk(profile) - 0.5) / 2.5, 0, 1, 0);
}

/** 左右相邻、实际占空间的胎儿（待着床与包在宿主体内的不占位置） */
function getSpatialNeighbors(fetuses, fetus) {
  const occupying = fetuses.filter((other) => !other?.pendingImplantation && !getEnclosingHost(other, fetuses));
  const index = occupying.indexOf(fetus);
  if (index < 0) return [];
  return [occupying[index - 1], occupying[index + 1]].filter(Boolean);
}

function signedAngleDelta(from, to) {
  return ((wrapAngle(to) - wrapAngle(from) + 540) % 360) - 180;
}

/**
 * 多胎中一胎从 from 转到 to：先逐一判定邻胎会不会挡住，挡住就整次不转、什么都不改；
 * 没挡住时邻胎可能被带着转一点。回传 { blocked, message, note }
 */
function rotateAmongNeighbors(profile, fetuses, fetus, from, to) {
  const delta = signedAngleDelta(from, to);
  if (Math.abs(delta) <= CROWDED_ROTATION_THRESHOLD) return { blocked: false, note: '' };
  const neighbors = getSpatialNeighbors(fetuses, fetus);
  if (neighbors.length === 0) return { blocked: false, note: '' };
  const crowding = getUterineCrowding(profile);
  const ownWeight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
  const visible = fetuses.filter(isFetusKnownToCharacter);
  const name = (other) => (visible.includes(other) ? `第${visible.indexOf(other) + 1}胎` : '旁边的胎儿');
  for (const other of neighbors) {
    const otherWeight = clampNumber(other?.weight, 0.33, 3.0, 1.0);
    if (Math.random() < crowding * (otherWeight / (otherWeight + ownWeight))) {
      return { blocked: true, message: `rotation blocked: the uterus is crowded and ${name(other)}挡住了转身的空间; try a smaller turn or wait until there is more room.` };
    }
  }
  const dragged = [];
  for (const other of neighbors) {
    if (!isFetusKnownToCharacter(other) || !canMoveFreely(other, fetuses)) continue;
    if (Math.random() >= crowding * 0.5) continue;
    const group = getSharedSacGroup(fetus);
    const share = group > 0 && group === getSharedSacGroup(other) ? CROWDED_DRAG_SHARE_SAME_SAC : CROWDED_DRAG_SHARE;
    other.tendencyAngle = wrapAngle(clampNumber(other.tendencyAngle, 0, 360, 0) + Math.round(delta * share));
    dragged.push(name(other));
  }
  return { blocked: false, note: dragged.length > 0 ? `，${dragged.join('、')}也被带着转了一点` : '' };
}

/** 自然胎动转得太大时套用牵制：被挡住就退回原角度 */
function settleNaturalCrowding(profile, fetuses, fetus, before) {
  if (fetuses.length < 2) return;
  const result = rotateAmongNeighbors(profile, fetuses, fetus, before, fetus.tendencyAngle);
  if (result.blocked) fetus.tendencyAngle = before;
}

/**
 * direction=sibling：随机一对相邻且角色已知的胎儿互动。
 * 踢让对方小幅偏转、推挤可能左右换位、依偎不改位置；不碰 affinity。
 */
function applySiblingInteraction(chatState, next, female, change) {
  const skip = (reason) => ({ applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: ${reason}` });
  if (!['slight_increase', 'significant_increase', 'slight_decrease', 'significant_decrease'].includes(change)) {
    return skip('direction=sibling requires a valid change.');
  }
  const profile = next.profile || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const known = (fetus) => isFetusKnownToCharacter(fetus) && !fetus?.pendingImplantation && !getEnclosingHost(fetus, fetuses);
  const pairs = [];
  for (const fetus of fetuses.filter(known)) {
    for (const other of getSpatialNeighbors(fetuses, fetus)) {
      if (known(other) && fetuses.indexOf(fetus) < fetuses.indexOf(other)) pairs.push([fetus, other]);
    }
  }
  if (pairs.length === 0) return skip('there is no pair of neighboring fetuses known to the character.');
  const pair = pairs[randomInt(0, pairs.length - 1)];
  const [actor, target] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
  const visible = fetuses.filter(isFetusKnownToCharacter);
  const name = (fetus) => `第${visible.indexOf(fetus) + 1}胎`;
  let summary;
  if (change === 'slight_decrease') {
    if (canMoveFreely(target, fetuses)) {
      const before = wrapAngle(clampNumber(target.tendencyAngle, 0, 360, 0));
      target.tendencyAngle = wrapAngle(before + (randomInt(10, 20) * (Math.random() < 0.5 ? -1 : 1)));
      summary = `${female}腹中${name(actor)}踢了${name(target)}一脚，${name(target)}被踢得偏转了一些`;
    } else {
      summary = `${female}腹中${name(actor)}踢了${name(target)}一脚，${name(target)}已经入盆，没有被踢动`;
    }
  } else if (change === 'significant_decrease') {
    const before = fetuses.indexOf(actor) < fetuses.indexOf(target);
    const [actorName, targetName] = [name(actor), name(target)]; // 换位前的编号，与上一轮看到的一致
    const movers = fetuses.filter((fetus) => canMoveFreely(fetus, fetuses));
    // swapLateral 假设两边的胎囊在阵列里紧邻；中间夹着不占位置的胎儿时不换，免得切错
    const sameSac = getSharedSacGroup(actor) > 0 && getSharedSacGroup(actor) === getSharedSacGroup(target);
    const members = sameSac ? [actor, target] : [...getSacBlock(fetuses, actor), ...getSacBlock(fetuses, target)];
    const indexes = members.map((fetus) => fetuses.indexOf(fetus));
    if (Math.max(...indexes) - Math.min(...indexes) + 1 === members.length) swapLateral(fetuses, actor, target, movers, new Set());
    const swappedNow = (fetuses.indexOf(actor) < fetuses.indexOf(target)) !== before;
    summary = swappedNow
      ? `${female}腹中${actorName}和${targetName}推挤起来，两胎换了左右位置`
      : `${female}腹中${actorName}和${targetName}推挤了一阵，但都挤不动，位置没变`;
  } else {
    summary = `${female}腹中${name(actor)}和${name(target)}${change === 'significant_increase' ? '紧紧依偎在一起' : '挨在一起'}，胎动平静了下来`;
  }
  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
  profile.cooldown = { ...(profile.cooldown || {}), maternalFetalInteractionUsed: true };
  profile.notify = { ...(profile.notify || {}), secondly: summary };
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: sibling interaction. ${summary}` };
}
