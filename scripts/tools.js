import {
  cloneValue,
  derivePregnancyStageState,
  getGestationEffectiveSpeed,
  getGestationSpeciesSpeed,
  getGestationModifierMultiplier,
  getChatState,
  getPsyStressInitByLevel,
  getSettings,
  getVitalityInitByLevel,
  saveSettings,
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
  normalizeTemporaryOutfitItems,
  normalizeWardrobeItem,
  resolveWardrobeItemRef,
  sanitizeWearState,
  WARDROBE_DIMENSIONS,
} from './wardrobe_config.js';
import {
  FIRST_STAGE_NATURAL_BIRTH_EXPERIENCE,
  LABOR_STAGES,
  LABOR_STAGE_BASE_HOURS,
  LABOR_STAGE_INCREMENT,
  LABOR_POSTPARTUM_OBSERVATION_HOURS,
  MENSTRUAL_STAGE_DAYS,
  MENSTRUAL_STAGES,
  PREGNANCY_STAGE_DAYS,
  PREGNANCY_STAGES,
} from './stage_config.js';
import {
  getBaseRaceName,
  getDerivedTypeInheritanceProfile,
  getDerivedTypeMetabolismExemptions,
  getEmbryoTypeByRace,
  getMergedRacePhysiologyProfile,
  parseRaceDescriptor,
  getRaceDescriptorComponents,
  getRaceComponents as getConfiguredRaceComponents,
} from './race_config.js';
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
    description: '推进当前聊天中已注册角色的时间。会处理月经阶段、受精着床、孕期推进、产兆前驱、第一至第三产程、产后恢复，以及最近性行为计时。',
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
    description: '对单一角色的活力、情压、性欲、宫压做增减更新。会联动代谢累积、高潮排卵、羊膜耐久警告等状态。',
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
    description: '向单一角色衣柜添加或更新一件衣物。id 引用规则：更新既有衣物时传其整数 id 或准确名称字符串；新增衣物可省略 id，系统会自动分配下一个整数 id，不要自造大数字 id。main 主件可给 parts 数组列出组成部件名（如 ["白衬衫","牛仔裤"]，连身装可省略）；剧情中重新搭配上下装时，应用本工具铸造新的组合主件再换上。accessory 配件可给 layer：inner=贴身内衣等穿在主件之下，outer=外套鞋饰等穿在主件之外（默认 outer）。衣物保存稳定外观 note 与机械数值；note 只写衣物稳定外观与来源：颜色、材质、版型、长短、固定开口、图案、制服/病服/借装来源等。禁止写当前穿着反应、角色感受、近期身体变化、怀孕/胀痛/压胸/勒红/变紧/显怀等动态状态；这些由四维、pregFit 与当轮叙事推导。slot=main 为主件，slot=accessory 为配件。主件通常使用 0-10；配件只是补正，单项只能 -3 到 3，通常只影响 1-2 个维度，其他维度填 0。四维：masking 掩盖身体曲线/孕肚变化、support 对胸腹腰与重心的承托、capacity 容许孕肚/胸腹/骨盆/水肿等体型变化、convenience 行动/穿脱/如厕/哺乳或排解需求的方便程度。皮肤暴露与稳定外观写入 note，不作为机械数值。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        item: {
          type: 'object',
          properties: {
            id: { type: ['integer', 'string'] },
            name: { type: 'string' },
            note: { type: 'string' },
            slot: { type: 'string', enum: ['main', 'accessory'] },
            parts: { type: 'array', items: { type: 'string' } },
            layer: { type: 'string', enum: ['inner', 'outer'] },
            masking: { type: 'number' },
            support: { type: 'number' },
            capacity: { type: 'number' },
            convenience: { type: 'number' },
          },
          required: ['name', 'note', 'slot', 'masking', 'support', 'capacity', 'convenience'],
          additionalProperties: false,
        },
      },
      required: ['female', 'item'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsRemoveWardrobeItem',
    description: '从单一角色衣柜删除一件衣物。itemId 可传整数 id 或准确衣物名称字符串。不能删除默认主件 id=0。若删除当前主件，穿着会回到 id=0；若删除当前配件，会从当前配件列表移除，并重算 pregFit。',
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
    description: '更换单一角色当前穿着。mainItemId 指定主件。穿上或脱下个别配件时优先用增量参数：addAccessoryItemIds 穿上、removeAccessoryItemIds 脱下，均在当前配件基础上生效，不需要重述其他配件。accessoryItemIds 则是覆盖式完整列表（空数组=脱掉所有配件），与增量参数同传时以 accessoryItemIds 为准。衣物引用优先传整数 id；若不确定 id，可传准确衣物名称字符串，系统会按名称解析（含临时衣物）。注意：wearState 只是状态标签，不会改变穿了哪些衣物；穿上鞋、戴上外套等必须通过配件参数完成。wearState 为当前穿着状态短标签（12 字内）：建议使用 整齐/凌乱/敞开/半褪/撩起/上衣已褪/下装已褪/湿透，也可按情境自造同粒度短标签；主件有 parts 时优先引用部件名消歧（如 毛衣已脱）。只更新穿着状态时可只传 wearState。换主件时未显式传 wearState 会自动重置为整齐。temporaryItems 可放病服、借装等临时衣物，只保存于当前 outfit，不写入 wardrobe；换回衣柜服装时可传 temporaryItems: [] 清除临时衣物。临时衣物也要写稳定外观 note，且 note 只写衣物稳定外观与来源：颜色、材质、版型、长短、固定开口、图案、制服/病服/借装来源等。禁止写当前穿着反应、角色感受、近期身体变化、怀孕/胀痛/压胸/勒红/变紧/显怀等动态状态；这些由四维、pregFit 与当轮叙事推导。全裸也是主件 id=0。角色处于真实妊娠/产兆前驱/产程/产后恢复时会重算 outfit.pregFit（产后恢复的衣着压力随恢复进度递减）；其余阶段 pregFit 为 null。衣着状态变化的叙事文字由当轮叙事自行处理，不写回 wardrobe/outfit。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        mainItemId: { type: ['integer', 'string'] },
        accessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        addAccessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        removeAccessoryItemIds: { type: 'array', items: { type: ['integer', 'string'] } },
        wearState: { type: 'string' },
        temporaryItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', minimum: 0 },
              name: { type: 'string' },
              note: { type: 'string' },
              slot: { type: 'string', enum: ['main', 'accessory'] },
              parts: { type: 'array', items: { type: 'string' } },
              layer: { type: 'string', enum: ['inner', 'outer'] },
              masking: { type: 'number' },
              support: { type: 'number' },
              capacity: { type: 'number' },
              convenience: { type: 'number' },
            },
            required: ['id', 'name', 'note', 'slot', 'masking', 'support', 'capacity', 'convenience'],
            additionalProperties: false,
          },
        },
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
    description: '设置角色是否在场。设为 false 后，tracker 默认不会再把该角色完整状态发送给 LLM，直到重新设为 true。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        isPresent: { type: 'boolean' },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsUpdateExperience',
    description: '直接更新单一角色的经验/关系字段。适合修正贞洁、伴侣、怀孕/分娩/流产经历等记录，不触发额外规则。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            virginity: { type: ['string', 'null'] },
            latestSexPartner: { type: ['string', 'null'] },
            emotionalMate: { type: ['string', 'null'] },
            marriageMate: { type: ['string', 'null'] },
            pregnantExperience: { type: 'integer' },
            naturalBirthExperience: { type: 'integer' },
            surgicalBirthExperience: { type: 'integer' },
            miscarriageExperience: { type: 'integer' },
          },
          additionalProperties: false,
        },
      },
      required: ['female', 'options'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsNameChild',
    description: '给单一角色已出生的某个孩子命名。只修改 children 指定索引的 name，不触发额外规则。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        childIndex: { type: 'integer' },
        name: { type: 'string' },
      },
      required: ['female', 'childIndex', 'name'],
      additionalProperties: false,
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
                  isChaste: { type: 'boolean' },
                  hasContraception: { type: 'boolean' },
                },
                additionalProperties: false,
              },
              preg: {
                type: 'object',
                properties: {
                  cognition: { type: 'number' },
                  bonding: { type: 'number' },
                  stance: { type: 'number' },
                  knowsFatherSource: { type: 'boolean' },
                  hasProfessionalPrenatalCare: { type: 'boolean' },
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
    description: '向单一角色体内加入精液，用于性交后留下受孕机会；若当前已有成熟卵子，加入时会立即进行一次受精判定，成功后即使随后排出精液也不影响待着床胚胎。amount 必须为正数；扣除/排出精液请用 bsDrainSperm。race 使用 [derivedType-装饰子项]race-装饰子项 格式，混血种族以 X 分隔；父系 derivedType 直接从这个字符串解析。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        male: { type: 'string' },
        race: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['female', 'male', 'race', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsDrainSperm',
    description: '让角色主动排出体内部分或全部精液残留，按当前各来源比例一并减少。',
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
    description: '直接设置月经相关阶段，用于催情、药物、外力或剧情推进。切到排卵期时会重新允许高潮排卵；假孕期可留精但不会排卵或受孕。不会覆盖正在进行的受精、真妊娠、产兆前驱或产程。',
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
    description: '缓解角色的生理需求。普通种族用于处理泄意、饿意、困意、乳意、臭意与伴意；其中 excretion（泄意）同时包含排尿与排便需求。乳意在普通周期表示乳房胀敏，在妊娠、假孕或产后恢复则可表示乳胀与泌乳需求；性欲波动会自然产生乳意，不由伴意解除额外转化。进食缓解 hunger 会增加 excretion 与少量 sleep，睡眠缓解 sleep 会增加少量 hunger，高 odor 会降低 companionship 的社交缓解效果。带 derivedType 的角色以 flux 进行极性解放，并处理未抵免需求；要解放 flux 时请传 flux，或不传 options 使用默认释放量。pregnant.blockage 会降低排解效果，pregnant.acceleration 会加快累积并让刚缓解的对应需求较快回升，pregnant.expansion 会使对应需求容量由 150 扩为 200。',
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
    description: '终止当前受精或妊娠状态。月经阶段且着床前视为避孕成功，其他阶段视为流产；可指定 fetusIndex 做减胎。若 miscarriage 保护开启，则需 force=true 才会生效。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        force: { type: 'boolean' },
        fetusIndex: { type: 'integer' },
      },
      required: ['female'],
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
      + '工具加入的是尚未着床的受精卵，可在同一着床窗口重复调用；第一颗会启动共用 fertilizationDays，之后由 bsPassedTime 推进并统一着床。已进入妊娠阶段后不可再加入。自然受孕请勿使用本工具。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        provider: { type: 'string' },
        fathers: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 50 },
        race: { type: 'string' },
        fatherRace: { type: 'string' },
      },
      required: ['female', 'provider'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsRuptureMembranes',
    description: '让角色破水（羊膜破裂）。只有在产兆前驱且宫压已达上限的 66%，或已在第一／第二产程时才会生效；条件不足会被拒绝，此时叙事不得写成已经破水。'
      + '产兆前驱破水会直接进入第一产程。剧情写到羊水流出、破水时必须调用本工具，让叙事与系统状态一致；系统未确认破水前不要擅自描写破水。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsChildbirth',
    description: '让角色立即结束分娩并进入产后恢复，并把剩余胎儿转为 children 记录。外部直接调用视为手术产；产程自然结束时则记为自然产。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
      },
      required: ['female'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsMaternalFetalInteraction',
    description: '处理母体与胎儿之间的互动。每名角色在每个新小时内最多成功互动一次；在 bsPassedTime 推进满下一小时之前，重复调用会被跳过。direction=fetal 表示胎儿对母体的亲近或排斥，必须传 change，并调整随机一胎的 affinity，不会补充供养力。direction=maternal 表示母体安抚胎儿，不使用 change；系统会随机判定 affinity 变化，若成功且有尚待安抚的妊娠不适，会消耗一次并依轻微/显著变化补回 1/2 点供养力。若当前处于产兆前驱且 direction=maternal，则改为分娩抵抗判定。',
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
          enum: ['fetal', 'maternal'],
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

function hasPreparedWardrobe(profile) {
  return Boolean(profile?.wardrobe?.enabled === true);
}

function hasBreedingPsychology(profile) {
  const stageProfiles = profile?.psychology?.stageProfiles;
  return Boolean(stageProfiles && typeof stageProfiles === 'object' && !Array.isArray(stageProfiles)
    && Object.keys(stageProfiles).length > 0);
}

function findWardrobeItem(profile, itemRef, slot = '') {
  const wardrobe = ensureWardrobeState(profile);
  return resolveWardrobeItemRef(wardrobe.items, itemRef, slot);
}

function getAvailableOutfitItems(profile) {
  const wardrobe = ensureWardrobeState(profile);
  const temporaryItems = Array.isArray(profile?.outfit?.temporaryItems)
    ? profile.outfit.temporaryItems.map(normalizeWardrobeItem).filter(Boolean).map((item) => ({ ...item, source: 'temporary' }))
    : [];
  return [...wardrobe.items, ...temporaryItems.filter((item) => item.id !== DEFAULT_WARDROBE_ITEM.id)];
}

function findOutfitItem(profile, itemRef, slot = '') {
  return resolveWardrobeItemRef(getAvailableOutfitItems(profile), itemRef, slot);
}

function ensureOutfitState(profile) {
  ensureWardrobeState(profile);
  if (!profile.outfit || typeof profile.outfit !== 'object' || Array.isArray(profile.outfit)) profile.outfit = {};
  profile.outfit.temporaryItems = normalizeTemporaryOutfitItems(profile.outfit.temporaryItems);
  const mainItem = findOutfitItem(profile, profile.outfit.mainItemId ?? DEFAULT_WARDROBE_ITEM.id, 'main');
  const accessoryItems = Array.isArray(profile.outfit.accessoryItemIds)
    ? profile.outfit.accessoryItemIds
      .map((ref) => findOutfitItem(profile, ref, 'accessory'))
      .filter(Boolean)
    : [];
  profile.outfit.mainItemId = mainItem ? mainItem.id : DEFAULT_WARDROBE_ITEM.id;
  profile.outfit.accessoryItemIds = accessoryItems
    .map((item) => item.id)
    .filter((id, index, list) => list.indexOf(id) === index);
  profile.outfit.wearState = sanitizeWearState(profile.outfit.wearState);
  if (!('pregFit' in profile.outfit)) profile.outfit.pregFit = null;
  return profile.outfit;
}

function getOutfitItems(profile) {
  const outfit = ensureOutfitState(profile);
  const main = findOutfitItem(profile, outfit.mainItemId, 'main') || { ...DEFAULT_WARDROBE_ITEM };
  const accessories = outfit.accessoryItemIds
    .map((id) => findOutfitItem(profile, id, 'accessory'))
    .filter(Boolean);
  return [main, ...accessories];
}

function getOutfitDimensionTotals(profile) {
  const totals = Object.fromEntries(WARDROBE_DIMENSIONS.map((key) => [key, 0]));
  for (const item of getOutfitItems(profile)) {
    for (const key of WARDROBE_DIMENSIONS) totals[key] += clampNumber(item[key], -10, 10, 0);
  }
  for (const key of WARDROBE_DIMENSIONS) totals[key] = clampNumber(totals[key], 0, 10, 0);
  return totals;
}

function calculatePregWearPressure(profile) {
  const pregnant = profile?.pregnant || {};
  const effectiveDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  if (effectiveDays <= 0) return 0;
  const fetalEnergyDrain = clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 0);
  const fullPregnancyDays = Object.values(PREGNANCY_STAGE_DAYS).reduce((sum, value) => sum + (Number(value) || 0), 0) || 280;
  const progress = Math.min(1.25, effectiveDays / fullPregnancyDays);
  const basePressure = 0.5;
  const progressPressure = Math.pow(progress, 1.35) * 6;
  const fetalPressure = Math.max(0, fetalEnergyDrain - 0.1) * 1.5;
  return clampNumber(basePressure + progressPressure + fetalPressure, 0, 10, 0);
}

// 产后恢复的衣着压力：从产后初期的水平随恢复进度线性递减到 0（体型回缩、乳胀消退）。
const POSTPARTUM_START_WEAR_PRESSURE = 4;

function calculatePostpartumWearPressure(profile) {
  const days = clampNumber(profile?.base?.days, 0, 9999, 0);
  const recoveryDays = getStageLimit(profile, '产后恢复') || 56;
  const progress = Math.min(1, days / recoveryDays);
  return clampNumber(POSTPARTUM_START_WEAR_PRESSURE * (1 - progress), 0, 10, 0);
}

function refreshOutfitPregFit(profile) {
  if (!profile?.wardrobe?.enabled) return null;
  const outfit = ensureOutfitState(profile);
  const stage = String(profile?.base?.stage || '');
  const inPostpartum = stage === '产后恢复';
  if (!inPostpartum && !isTruePregnancyStage(stage) && stage !== '产兆前驱' && !LABOR_STAGES.includes(stage)) {
    outfit.pregFit = null;
    return outfit;
  }
  const totals = getOutfitDimensionTotals(profile);
  const pregWearPressure = inPostpartum ? calculatePostpartumWearPressure(profile) : calculatePregWearPressure(profile);
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
 * 单个排卵期自然排出的卵数 = 1 颗基础 + orgasmOvulationAmount 额外排卵倾向。
 *
 * 旧算法是「每天至少 1 颗 x 排卵天数」，而排卵天数随 menstrualLengthRatio 线性拉长，
 * 于是长周期种族按窗口长度虚增：精灵额外倾向明明是 0 却每周期排 6 颗、龙族排 8 颗，
 * 与该字段的语义（高潮诱发的额外排卵量，见 applyOrgasmOvulation）完全无关。
 * 周期越长排得越多也让「一年一次经期」这类设定无法成立。
 */
function getNaturalOvulationTotal(profile) {
  const extra = clampNumber(profile?.bio?.orgasmOvulationAmount, 0, 100, 1);
  return Math.max(1, Math.round(1 + extra));
}

/** 自然排卵每个排卵期只发生一次，离开排卵期即重置 */
function shouldResetNaturalOvulation(stage) {
  return stage !== '排卵期';
}

function getImplantationDays(profile) {
  const cycleLength = getMenstrualCycleLength(profile);
  return Math.max(1, (6 * cycleLength) / 28);
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

function getBaseRace(race) {
  return getBaseRaceName(race);
}

function getRaceComponents(race) {
  return getConfiguredRaceComponents(race);
}

function isSameRaceGroup(leftRace, rightRace) {
  const left = getRaceComponents(leftRace).sort();
  const right = getRaceComponents(rightRace).sort();
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function deriveFetusRace(motherRace, fatherRace) {
  // 血统显示保留每个种族的 -装饰子项；生理运算另用 getRaceComponents 取基础种族。
  const motherParts = getRaceDescriptorComponents(motherRace);
  const fatherParts = getRaceDescriptorComponents(fatherRace);
  const combined = [...fatherParts, ...motherParts].filter(Boolean);
  if (combined.length === 0) return '人类';
  // 必须去重，否则同族生育会得到「人类x人类」这种自我混血的种族。
  // race_prompt_context.js 的同名函数一直有去重，这里漏了。
  const unique = [];
  for (const part of combined) {
    if (!unique.includes(part)) unique.push(part);
  }
  return unique.join('x');
}

function deriveFetusEmbryoType(race) {
  return getEmbryoTypeByRace(race);
}

function deriveFetusGender(race) {
  const profile = getMergedRacePhysiologyProfile(race);
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

function getConceptionWeightRatio(profile, sperm) {
  const motherBreedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0);
  const fatherProfile = getMergedRacePhysiologyProfile(sperm?.race);
  const fatherBreedTolerance = clampNumber(fatherProfile?.breedTolerance, 0.1, 100, 1.0);
  const dominance = (fatherBreedTolerance - motherBreedTolerance) / Math.max(motherBreedTolerance + fatherBreedTolerance, 0.1);
  return clampNumber(1 + (dominance * 0.65), 0.625, 1.6, 1.0);
}

function getDerivedTypeSeed(motherDerivedType, fatherDerivedType) {
  const mother = motherDerivedType ? String(motherDerivedType) : null;
  const father = fatherDerivedType ? String(fatherDerivedType) : null;
  if (!mother && !father) return { affinity: 0, progress: 0 };
  if (mother && father && mother === father) return { affinity: 30, progress: 30 };
  if (mother && father && mother !== father) return { affinity: -30, progress: -30 };
  return { affinity: 15, progress: 0 };
}

function updateDerivedTypeProgress(profile, tick) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const motherDerivedType = base.derivedType ? String(base.derivedType) : null;
  const passedDays = Math.max(0, tick.passedDays);
  if (fetuses.length === 0 || passedDays <= 0) return;

  for (const fetus of fetuses) {
    const fatherDerivedType = fetus?.fatherDerivedType ? String(fetus.fatherDerivedType) : null;
    if (!motherDerivedType && !fatherDerivedType) continue;
    const currentProgress = clampNumber(fetus?.maternalDerivedTypeProgress, -100, 100, 0);
    if (currentProgress === 0) continue;

    const direction = Math.sign(currentProgress);
    const affinity = clampNumber(fetus?.affinity, -50, 50, 0);
    const alignment = direction * affinity;
    const factor = clampNumber(1 + (alignment / 30), 0, 3, 1);
    const activeDerivedType = direction > 0 ? motherDerivedType : fatherDerivedType;
    const inheritanceSpeed = clampNumber(getDerivedTypeInheritanceProfile(activeDerivedType)?.inheritanceSpeed, 0.2, 3.0, 1.0);
    const delta = direction * passedDays * 3 * factor * inheritanceSpeed;
    fetus.maternalDerivedTypeProgress = clampNumber(currentProgress + delta, -100, 100, currentProgress);
  }

  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
}

function cloneIdenticalFetus(fetus) {
  return {
    ...fetus,
    embryoId: null,
    fusionCheckedWith: [],
    providerSources: Array.isArray(fetus?.providerSources) ? [...fetus.providerSources] : undefined,
    chimera: fetus?.chimera ? cloneValue(fetus.chimera) : undefined,
    tendencyAngle: randomInt(0, 360),
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

function getNextEmbryoId(fetuses) {
  return fetuses.reduce((max, fetus) => {
    const value = Number(fetus?.embryoId);
    return Number.isInteger(value) && value > max ? value : max;
  }, 0) + 1;
}

function ensureEmbryoMetadata(pregnant) {
  const fetuses = Array.isArray(pregnant?.fetuses) ? pregnant.fetuses : [];
  const used = new Set();
  let nextId = getNextEmbryoId(fetuses);
  for (const fetus of fetuses) {
    let id = Number(fetus?.embryoId);
    if (!Number.isInteger(id) || id <= 0 || used.has(id)) {
      id = nextId;
      nextId += 1;
    }
    fetus.embryoId = id;
    used.add(id);
  }
  for (const fetus of fetuses) {
    fetus.fusionCheckedWith = [...new Set(
      (Array.isArray(fetus?.fusionCheckedWith) ? fetus.fusionCheckedWith : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0 && id !== fetus.embryoId),
    )];
  }
  return fetuses;
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
  const physiologyA = getMergedRacePhysiologyProfile(raceA);
  const physiologyB = getMergedRacePhysiologyProfile(raceB);
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
  const motherDerivedType = profile?.base?.derivedType ? String(profile.base.derivedType) : null;
  const derivedSeed = getDerivedTypeSeed(motherDerivedType, fatherDerivedType);
  const providerSources = maternalSources.length > 1
    ? maternalSources
    : maternalSources.filter((source) => source !== carrierName);
  return {
    embryoId,
    fusionCheckedWith: [],
    fathers: fathers.join(' × ') || '未知',
    provider: providerSources.length === 0 ? null : providerSources.join(' × '),
    providerSources,
    race,
    fatherRace: combineRaceDescriptors(fetusA?.fatherRace, fetusB?.fatherRace),
    fatherDerivedType,
    gender,
    embryoType: deriveFetusEmbryoType(race),
    weight: (clampNumber(fetusA?.weight, 0.33, 3, 1) + clampNumber(fetusB?.weight, 0.33, 3, 1)) / 2,
    tendencyAngle: randomInt(0, 360),
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

  const candidates = fetuses.filter((fetus) => !fetus?.chimera);
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
  let nextId = getNextEmbryoId(fetuses);
  for (const [fetusA, fetusB] of pairs) {
    fetusA.fusionCheckedWith.push(fetusB.embryoId);
    fetusB.fusionCheckedWith.push(fetusA.embryoId);
    if (consumed.has(fetusA.embryoId) || consumed.has(fetusB.embryoId)) continue;
    const probability = calculateChimeraFusionProbability(fetusA, fetusB);
    if (probability > 0 && Math.random() < probability / 100) {
      consumed.add(fetusA.embryoId);
      consumed.add(fetusB.embryoId);
      fused.push(createChimeraFetus(profile, carrierName, fetusA, fetusB, nextId));
      nextId += 1;
    }
  }
  if (fused.length > 0) pregnant.fetuses = [...fetuses.filter((fetus) => !consumed.has(fetus.embryoId)), ...fused];
  pregnant.fetusesCount = pregnant.fetuses.length;
}

function resolvePendingChimeraGenders(fetuses) {
  for (const fetus of fetuses) {
    if (fetus?.gender !== '待定') continue;
    const roll = Math.random();
    fetus.gender = roll < 0.4 ? '男' : roll < 0.8 ? '女' : '双';
  }
}

function applyIdenticalSplit(profile) {
  const pregnant = profile.pregnant || {};
  const fetuses = ensureEmbryoMetadata(pregnant);
  if (fetuses.length === 0) return;

  const result = [];
  let nextId = getNextEmbryoId(fetuses);
  for (const baseFetus of fetuses) {
    result.push(baseFetus);
    const physiology = getMergedRacePhysiologyProfile(baseFetus?.race);
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
    while (targetCount > 1) {
      const clone = cloneIdenticalFetus(baseFetus);
      clone.embryoId = nextId;
      nextId += 1;
      result.push(clone);
      targetCount -= 1;
    }
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
  const fetusRace = deriveFetusRace(motherRace, fatherRace);
  const gender = deriveFetusGender(fetusRace);
  const weightRatio = getConceptionWeightRatio(profile, sperm);
  const motherDerivedType = profile?.base?.derivedType ? String(profile.base.derivedType) : null;
  const fatherDerivedType = sperm?.derivedType ? String(sperm.derivedType) : null;
  const derivedSeed = getDerivedTypeSeed(motherDerivedType, fatherDerivedType);
  return {
    embryoId: null,
    fusionCheckedWith: [],
    fathers: String(sperm?.male || '未知'),
    // 自然受精恒为 null；代孕／注卵由植入工具指定归属
    provider: options.provider ? String(options.provider) : null,
    providerSources: options.provider ? [String(options.provider)] : [],
    race: fetusRace,
    fatherRace,
    fatherDerivedType,
    gender,
    embryoType: deriveFetusEmbryoType(fetusRace),
    weight: getConceptionWeight(cycleStage, gender, weightRatio),
    tendencyAngle: randomInt(0, 360),
    affinity: derivedSeed.affinity,
    maternalDerivedTypeProgress: derivedSeed.progress,
  };
}

function updateFetalEnergyDrain(profile) {
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const motherBreedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0);
  profile.pregnant.fetalEnergyDrain = fetuses.reduce((sum, fetus) => {
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    const ageInDays = effectivePregnantDays * weight;
    const fetalAgeWeeks = ageInDays / 7;
    const fetalLoad = fetalAgeWeeks / 40;
    const fetusEnergyDrain = fetalLoad / motherBreedTolerance;
    return sum + fetusEnergyDrain;
  }, 0);
}

function getEmbryoTypeModifiers(embryoType) {
  switch (String(embryoType || '胎生')) {
    case '卵生':
      return { recoveryCoefficient: 0.6 };
    case '卵胎生':
      return { recoveryCoefficient: 0.4 };
    case '胎转卵生':
      return { recoveryCoefficient: 1.0 };
    case '不定型':
      return { recoveryCoefficient: 0.8 };
    case '胎生':
    default:
      return { recoveryCoefficient: 0.2 };
  }
}

function snapshotOriginalPregnancyBio(character) {
  const runtime = character.runtime || {};
  if (runtime.originalPregnancyBio) return runtime.originalPregnancyBio;
  const bio = character?.profile?.bio || {};
  const snapshot = {
    gestationSpeciesSpeed: clampNumber(getGestationSpeciesSpeed(character?.profile), 0.1, 20, 1.0),
    birthDifficulty: clampNumber(bio.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(bio.breedTolerance, 0.1, 100, 1.0),
    recoveryDays: Math.max(1, Math.round(clampNumber(bio.recoveryDays, 1, 9999, 56))),
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
    gestationSpeciesSpeed: clampNumber(getGestationSpeciesSpeed(profile), 0.1, 20, 1.0),
    birthDifficulty: clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1.0),
    recoveryDays: Math.max(1, Math.round(clampNumber(profile?.bio?.recoveryDays, 1, 9999, 56))),
  };

  let totalWeight = 0;
  let gestationDaysAccumulator = 0;
  let gestationCount = 0;
  let birthAccumulator = 0;
  let birthCount = 0;
  let recoveryAccumulator = 0;

  for (const fetus of fetuses) {
    const weight = clampNumber(fetus?.weight, 0.33, 3.0, 1.0);
    const embryoModifiers = getEmbryoTypeModifiers(fetus?.embryoType);
    const raceProfile = getMergedRacePhysiologyProfile(fetus?.race) || {};

    totalWeight += weight;
    const gestationSpeed = clampNumber(raceProfile.gestationSpeciesSpeed, 0.1, 20, 1.0);
    gestationDaysAccumulator += 280 / gestationSpeed;
    gestationCount += 1;
    birthAccumulator += clampNumber(raceProfile.birthDifficulty, 0.1, 100, 1.0);
    birthCount += 1;
    recoveryAccumulator += weight * embryoModifiers.recoveryCoefficient;
  }

  const averageGestationDays = gestationDaysAccumulator / Math.max(gestationCount, 1);
  const averageGestation = averageGestationDays > 0 ? 280 / averageGestationDays : 1.0;
  const averageBirth = birthAccumulator / Math.max(birthCount, 1);
  const averageRecoveryCoefficient = recoveryAccumulator / Math.max(totalWeight, 0.33);
  const fetusCountModifier = 1 + ((fetuses.length - 1) * 0.08);
  const toleranceCountModifier = Math.max(0.6, 1 - ((fetuses.length - 1) * 0.04));
  const gestationModifierMultiplier = getGestationModifierMultiplier(profile);

  const gestationEffectiveSpeed = clampNumber(averageGestation * gestationModifierMultiplier, 0, 20, averageGestation);
  const recoveryGestationSpeed = Math.max(0.1, gestationEffectiveSpeed > 0 ? gestationEffectiveSpeed : averageGestation);
  const birthDifficulty = clampNumber(averageBirth * fetusCountModifier, 0.1, 100, originalBio.birthDifficulty);
  // 承载耐受只取母体自身 x 胎数修正：breedTolerance 描述「这具身体多能扛妊娠」，
  // 是承载者的属性。此前还乘上胎儿族的 breedTolerance，等于把胎儿族的承载力
  // 当成母体的加成——人类怀龙胎会变成十倍耐受，比怀人类胎还轻松，方向是反的。
  // 跨种族的额外负担已由 getConceptionWeightRatio 换算成胎重，不该在这里再算一遍。
  const breedTolerance = clampNumber(originalBio.breedTolerance * toleranceCountModifier, 0.1, 100, originalBio.breedTolerance);
  const recoveryDays = Math.max(
    1,
    Math.round(clampNumber(averageRecoveryCoefficient, 0.1, 2.0, 0.2) * (280 / recoveryGestationSpeed) * (birthDifficulty / Math.max(breedTolerance, 0.1))),
  );

  profile.bio = {
    ...(profile.bio || {}),
    gestationSpeciesSpeed: clampNumber(averageGestation, 0.1, 20, 1.0),
    gestationEffectiveSpeed,
    birthDifficulty,
    breedTolerance,
    recoveryDays,
  };
  return true;
}

function restorePregnancyPhysiology(profile, runtime) {
  const originalBio = runtime?.originalPregnancyBio;
  if (!originalBio) return false;
  const gestationModifierMultiplier = getGestationModifierMultiplier(profile);
  profile.bio = {
    ...(profile.bio || {}),
    gestationSpeciesSpeed: clampNumber(originalBio.gestationSpeciesSpeed, 0.1, 20, 1.0),
    gestationEffectiveSpeed: clampNumber(originalBio.gestationSpeciesSpeed * gestationModifierMultiplier, 0, 20, 1.0),
    birthDifficulty: clampNumber(originalBio.birthDifficulty, 0.1, 100, 1.0),
    breedTolerance: clampNumber(originalBio.breedTolerance, 0.1, 100, 1.0),
    recoveryDays: Math.max(1, Math.round(clampNumber(originalBio.recoveryDays, 1, 9999, 56))),
  };
  delete runtime.originalPregnancyBio;
  return true;
}

function isObliquePosition(angle, fetus) {
  if (fetus && (fetus.embryoType === '胎转卵生' || fetus.embryoType === '不定型')) return false;
  const normalized = wrapAngle(angle);
  if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return false;
  if (normalized >= 165 && normalized <= 195) return false;
  if ((normalized >= 75 && normalized <= 105) || (normalized >= 265 && normalized <= 285)) return false;
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

function isTransversePosition(angle) {
  const normalized = wrapAngle(angle);
  return (normalized >= 75 && normalized <= 105) || (normalized >= 255 && normalized <= 285);
}

function getRealisticLaborObstruction(fetuses) {
  if (!Array.isArray(fetuses) || fetuses.length === 0) return null;
  const firstAngle = Number.isFinite(Number(fetuses[0]?.tendencyAngle)) ? wrapAngle(fetuses[0].tendencyAngle) : 0;
  if (isTransversePosition(firstAngle)) return '首位胎儿呈横位';
  if (fetuses.length < 2) return null;
  const secondAngle = Number.isFinite(Number(fetuses[1]?.tendencyAngle)) ? wrapAngle(fetuses[1].tendencyAngle) : 0;
  if (Math.abs(angleDistance(firstAngle, secondAngle) - 180) <= 15) return '前两胎胎位互锁';
  return null;
}

function calculatePositionDifficulty(angle, fetus) {
  const normalized = wrapAngle(angle);
  const embryoType = String(fetus?.embryoType || '胎生');

  if (embryoType === '胎转卵生') {
    const targetAngles = [0, 90, 180, 270, 360];
    let minDistance = 360;
    for (const targetAngle of targetAngles) {
      let distance = Math.abs(normalized - targetAngle);
      if (targetAngle === 360) distance = Math.min(distance, Math.abs(normalized - 0));
      if (distance < minDistance) minDistance = distance;
    }
    if (minDistance <= 5) return 1.5;
    return Math.min(2.25, 1.5 + ((minDistance - 5) * 0.075));
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
    if ((normalized >= 85 && normalized <= 95) || (normalized >= 275 && normalized <= 285)) return 2.0;
    if ((normalized >= 75 && normalized <= 105) || (normalized >= 265 && normalized <= 285)) return 2.25;
    return 1.33;
  }

  if (embryoType === '卵生') {
    if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return 1.0;
    if (normalized >= 165 && normalized <= 195) return 1.0;
    if ((normalized >= 75 && normalized <= 105) || (normalized >= 265 && normalized <= 285)) return 1.5;
    return 1.33;
  }

  if ((normalized >= 0 && normalized <= 15) || (normalized >= 345 && normalized <= 360)) return 1.0;
  if (normalized >= 165 && normalized <= 195) return 1.5;
  if ((normalized >= 75 && normalized <= 105) || (normalized >= 265 && normalized <= 285)) return 2.0;
  return 1.33;
}

function updateFetalPositions(profile, tick, female) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return;

  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, 20, 1);
  // 逐日步进的上限：bsPassedTime 可以叠出十几万天，逐日推进会拖死 UI。
  // 10 年远超任何种族的妊娠期（最慢的 gestationSpeciesSpeed=0.1 也才 2800 天），
  // 正常剧情不会触到；只有荒谬的时间跳跃才会被截断。
  const MAX_DAILY_STEPS = 3650;
  const iterations = Math.min(MAX_DAILY_STEPS, Math.max(0, tick.passedDays));
  if (iterations <= 0 || !PREGNANCY_STAGES.includes(stage)) return;

  for (let step = 0; step < iterations; step += 1) {
    const totalWeight = fetuses.reduce((sum, fetus) => sum + clampNumber(fetus?.weight, 0.33, 3.0, 1.0), 0);
    if (stage === '孕晚期' && fetuses.length > 1) {
      const positionedIndexes = [];
      for (let index = 0; index < fetuses.length; index += 1) {
        const fetus = fetuses[index];
        if (!Number.isFinite(Number(fetus?.tendencyAngle))) fetus.tendencyAngle = randomInt(0, 360);
        const angle = wrapAngle(fetus.tendencyAngle);
        if ((angle >= 0 && angle <= 15) || (angle >= 345 && angle <= 360)) positionedIndexes.push(index);
      }
      if (positionedIndexes.length > 0) {
        const targetIndex = positionedIndexes[randomInt(0, positionedIndexes.length - 1)];
        const targetFetus = fetuses[targetIndex];
        const adjustmentSuccessRate = clampNumber(targetFetus?.weight, 0.33, 3.0, 1.0) / Math.max(totalWeight, 0.33);
        if (Math.random() > adjustmentSuccessRate) {
          targetFetus.tendencyAngle = wrapAngle(Number(targetFetus.tendencyAngle || 0) + (randomInt(-15, 15) * gestationSpeed));
        }
      }
    }

    for (const fetus of fetuses) {
      if (!Number.isFinite(Number(fetus?.tendencyAngle))) fetus.tendencyAngle = randomInt(0, 360);
      if (stage === '逾期') continue;

      let adjustmentSuccessRate = 1;
      if (fetuses.length > 1) {
        adjustmentSuccessRate = clampNumber(fetus?.weight, 0.33, 3.0, 1.0) / Math.max(totalWeight, 0.33);
      }
      if (Math.random() > adjustmentSuccessRate) continue;

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
        const diffRaw = targetAngle - currentAngle;
        let diff = diffRaw;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        if (angleDistance(currentAngle, targetAngle) > 15) {
          fetus.tendencyAngle = wrapAngle(currentAngle + (Math.sign(diff) * randomInt(1, 3) * gestationSpeed));
        }
      }
    }

    if (fetuses.length > 1) {
      const originalOrder = fetuses.slice();
      if (stage === '孕早期' || stage === '孕中期') {
        shuffleInPlace(fetuses);
      } else if (stage === '孕晚期') {
        const oblique = [];
        const total = fetuses.reduce((sum, fetus) => sum + clampNumber(fetus?.weight, 0.33, 3.0, 1.0), 0);
        for (let index = fetuses.length - 1; index >= 0; index -= 1) {
          const fetus = fetuses[index];
          if (isObliquePosition(fetus?.tendencyAngle || 0, fetus)) {
            oblique.push({
              index,
              fetus,
              rate: clampNumber(fetus?.weight, 0.33, 3.0, 1.0) / Math.max(total, 0.33),
            });
          }
        }
        for (const entry of oblique) {
          if (Math.random() < entry.rate) {
            fetuses.splice(entry.index, 1);
            const newIndex = randomInt(0, fetuses.length);
            fetuses.splice(newIndex, 0, entry.fetus);
          }
        }
      } else if (stage === '临产期') {
        const total = fetuses.reduce((sum, fetus) => sum + clampNumber(fetus?.weight, 0.33, 3.0, 1.0), 0);
        if (fetuses.length > 1) {
          const firstRate = clampNumber(fetuses[0]?.weight, 0.33, 3.0, 1.0) / Math.max(total, 0.33);
          if (Math.random() < firstRate) {
            [fetuses[0], fetuses[1]] = [fetuses[1], fetuses[0]];
          }
        }
        if (fetuses.length > 2) {
          const lastIndex = fetuses.length - 1;
          const lastRate = clampNumber(fetuses[lastIndex]?.weight, 0.33, 3.0, 1.0) / Math.max(total, 0.33);
          if (Math.random() < lastRate) {
            [fetuses[lastIndex], fetuses[lastIndex - 1]] = [fetuses[lastIndex - 1], fetuses[lastIndex]];
          }
        }
      }
      const orderChanged = fetuses.some((fetus, index) => fetus !== originalOrder[index]);
      if (orderChanged) {
        profile.notify = {
          ...(profile.notify || {}),
          secondly: `${female}的胚胎分布发生了变化`,
        };
      }
    }
  }

  pregnant.fetuses = fetuses;
  pregnant.fetusesCount = fetuses.length;
  profile.pregnant = pregnant;
}

function updateProdromalFetalPositions(profile, tick) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0 || stage !== '产兆前驱') return;
  const passedHours = Math.max(0, tick.passedHours);
  if (passedHours <= 0) return;

  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  for (const fetus of fetuses) {
    const currentAngle = Number.isFinite(Number(fetus?.tendencyAngle)) ? wrapAngle(fetus.tendencyAngle) : randomInt(0, 360);
    fetus.tendencyAngle = currentAngle;
    if (!isObliquePosition(currentAngle, fetus)) continue;
    const targetAngle = calculateNearestMainPosition(currentAngle);
    let diff = targetAngle - currentAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    const adjustment = Math.min(angleDistance(currentAngle, targetAngle), (passedHours * 5) / birthDifficulty);
    fetus.tendencyAngle = wrapAngle(currentAngle + (Math.sign(diff) * adjustment));
  }

  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
}

function stageAllowsSpermRetention(stage) {
  return MENSTRUAL_STAGES.includes(stage) || PREGNANCY_STAGES.includes(stage) || stage === '产后恢复' || stage === '假孕期';
}

function processSpermLifecycle(profile, stage, tick) {
  const base = profile.base || {};
  const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  if (sperms.length === 0) {
    base.sperms = [];
    return;
  }

  if (stage === '月经期' && tick.passedHours > 0) {
    base.sperms = [];
    return;
  }

  if (!stageAllowsSpermRetention(stage)) {
    base.sperms = [];
    return;
  }

  base.sperms = sperms
    .map((item) => ({
      ...item,
      value: Math.max(0, clampNumber(item?.value, 0, 999999, 0) - (tick.deltaDays * 10)),
    }))
    .filter((item) => item.value > 0);
}

function tryConceiveOnSpermEntry(profile, sperm, amount) {
  const base = profile.base || {};
  const stage = String(base.stage || '');
  if (![...MENSTRUAL_STAGES, '产后恢复'].includes(stage)) return false;

  const eggs = clampNumber(base.eggs, 0, 99, 0);
  if (eggs <= 0 || !sperm || clampNumber(amount, 0, 999999, 0) <= 0) return false;

  const femaleDifficulty = clampNumber(profile?.bio?.impregnationDifficulty, 0.1, 100, 1.0);
  const maleDifficulty = clampNumber(getMergedRacePhysiologyProfile(sperm?.race)?.impregnationDifficulty, 0.1, 100, 1.0);
  const isSameRace = isSameRaceGroup(profile?.base?.race, sperm?.race);
  let effectiveDifficulty = isSameRace ? femaleDifficulty : (femaleDifficulty + maleDifficulty);
  const femaleEmbryoType = deriveFetusEmbryoType(profile?.base?.race);
  const maleEmbryoType = deriveFetusEmbryoType(sperm?.race);
  if (femaleEmbryoType !== maleEmbryoType) effectiveDifficulty *= 1.5;

  const chance = Math.max(0.001, Math.min(0.8, (6 * 0.5) / effectiveDifficulty));
  if (Math.random() > chance) return false;

  const pregnant = profile.pregnant || {};
  pregnant.fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  pregnant.fetuses.push(createSimpleFetus(profile, sperm, stage));
  pregnant.fetusesCount = pregnant.fetuses.length;
  profile.pregnant = pregnant;
  base.eggs = eggs - 1;
  return true;
}

function processSimpleConception(profile, tick, notify, name) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const deltaDays = tick.deltaDays;
  const fullDays = tick.passedDays;
  const passedHours = tick.passedHours;
  const allowsNaturalConception = [...MENSTRUAL_STAGES, '产后恢复'].includes(stage);

  if (allowsNaturalConception) {
    // 一次性排出本周期的份额：按天累加会让长排卵期窗口把卵数堆到上限，
    // 而取 min 封顶又会把高潮诱发排卵已经排出的卵砍掉
    if (stage === '排卵期' && fullDays > 0 && !(profile.cooldown || {}).naturalOvulationUsed) {
      base.eggs = clampNumber(base.eggs, 0, 99, 0) + getNaturalOvulationTotal(profile);
      profile.cooldown = { ...(profile.cooldown || {}), naturalOvulationUsed: true };
    }

    if (stage === '月经期' && passedHours > 0) {
      base.eggs = 0;
    } else if (base.eggs > 0 && fullDays > 0 && stage !== '排卵期') {
      base.eggs = Math.max(0, clampNumber(base.eggs, 0, 99, 0) - fullDays);
    }

    const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
    const availableSperms = sperms.filter((item) => clampNumber(item?.value, 0, 999999, 0) > 0);
    let eggs = clampNumber(base.eggs, 0, 99, 0);
    const femaleDifficulty = clampNumber(profile?.bio?.impregnationDifficulty, 0.1, 100, 1.0);

    while (eggs > 0 && availableSperms.length > 0) {
      const totalSperm = availableSperms.reduce((sum, item) => sum + clampNumber(item?.value, 0, 999999, 0), 0);
      let winner = null;
      for (const sperm of availableSperms) {
        const share = totalSperm > 0 ? clampNumber(sperm?.value, 0, 999999, 0) / totalSperm : 0;
        const maleDifficulty = clampNumber(getMergedRacePhysiologyProfile(sperm?.race)?.impregnationDifficulty, 0.1, 100, 1.0);
        const isSameRace = isSameRaceGroup(profile?.base?.race, sperm?.race);
        let effectiveDifficulty = isSameRace ? femaleDifficulty : (femaleDifficulty + maleDifficulty);
        const femaleEmbryoType = deriveFetusEmbryoType(profile?.base?.race);
        const maleEmbryoType = deriveFetusEmbryoType(sperm?.race);
        if (femaleEmbryoType !== maleEmbryoType) effectiveDifficulty *= 1.5;
        const spermBaseChance = Math.max(0.001, Math.min(0.8, (deltaDays * 12 * 0.5) / effectiveDifficulty));
        const spermChance = Math.max(0.001, Math.min(0.8, spermBaseChance * share));
        if (Math.random() <= spermChance) {
          winner = sperm;
          break;
        }
      }
      if (winner) {
        pregnant.fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
        pregnant.fetuses.push(createSimpleFetus(profile, winner, stage));
        notify.secondly = `${name}受精成功`;
        eggs -= 1;
      }
      break;
    }
    base.eggs = eggs;
  }

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
      } else {
        const obstetricPregnantDays = base.fertilizationDays + getObstetricPregnancyOffsetDays(profile);
        const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, 20, 1);
        applyIdenticalSplit(profile);
        resolvePendingChimeraGenders(pregnant.fetuses);
        base.stage = '孕早期';
        base.days = 0;
        base.fertilizationDays = 0;
        pregnant.pregnantDays = obstetricPregnantDays;
        pregnant.effectivePregnantDays = obstetricPregnantDays * gestationSpeed;
        pregnant.amnionDurability = 100;
        profile.experience = {
          ...(profile.experience || {}),
          pregnantExperience: clampNumber(profile?.experience?.pregnantExperience, 0, 999, 0) + 1,
        };
        notify.firstly = `${name}进入了孕早期`;
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

function clearPsychologyTransitionState(profile, stage, days) {
  const psychology = profile?.psychology;
  if (!psychology || typeof psychology !== 'object') return;
  const pregnant = profile?.pregnant || {};

  if (isTruePregnancyStage(stage) && clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) > 7) {
    psychology.mens = buildEmptyPsychologyGroup(PSY_MENS_FIELDS, PSY_MENS_BOOL_FIELDS);
  }

  if (stage === '产后恢复' && clampNumber(days, 1, 9999, 1) > 7) {
    psychology.preg = buildEmptyPsychologyGroup(PSY_PREG_FIELDS, PSY_PREG_BOOL_FIELDS);
  }
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

function getLibidoCap(profile) {
  const stage = profile?.base?.stage;
  if (!isTruePregnancyStage(stage)) return 100;
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const months = Math.floor(effectivePregnantDays / 28);
  const progress = Math.max(0, Math.min(10, months)) / 10;
  return Math.round(100 + (150 - 100) * progress);
}

function getUterinePressureCap(profile) {
  const stage = profile?.base?.stage;
  if (!isTruePregnancyStage(stage)) return 50;
  const effectivePregnantDays = clampNumber(profile?.pregnant?.effectivePregnantDays, 0, 9999, 0);
  const months = Math.floor(effectivePregnantDays / 28);
  const progress = Math.max(0, Math.min(10, months)) / 10;
  return Math.round(50 + (150 - 50) * progress);
}

function applyHourlyPregnancyMetabolism(profile, tick, female) {
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

  const vitality = clampNumber(profile?.base?.vitality, 0, 200, 100);
  const days = Math.max(1, Math.ceil(tick.deltaDays));
  // 症状抽样的轮数上限：bsPassedTime 各分量独立 clamp 后可叠到十几万天，
  // 乘上 fetalEnergyDrain 就是十亿级循环，会把 UI 冻死。
  // 封顶的是循环次数而不是时间本身——时间推进与阶段推进保持原语义，
  // 超长时间跳跃只是症状擲骰次数不再线性增长（本来也不该线性增长）。
  const MAX_SYMPTOM_ROUNDS = 2000;
  const rounds = Math.min(MAX_SYMPTOM_ROUNDS, Math.max(1, Math.ceil(fetalEnergyDrain)) * days);
  for (let i = 0; i < rounds; i += 1) {
    const symptomChance = (200 - vitality) * 0.5;
    if (Math.random() * 100 < symptomChance) {
      pregnant.nutrition = (Number(pregnant.nutrition) || 0) - 1;
      pregnant.symptomReliefPending = clampNumber(pregnant.symptomReliefPending, 0, 999, 0) + 1;
      profile.pregnant = pregnant;
      profile.notify = {
        ...(profile.notify || {}),
        secondly: `${female}的妊娠症状使身体感到不适，供养力有所流失`,
      };
      break;
    }
  }
}

function applyWeeklyNutrition(profile) {
  const pregnant = profile?.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) return false;

  const nutrition = Number(pregnant.nutrition) || 0;
  if (nutrition === 0) return false;

  const absAffinities = fetuses.map((fetus) => Math.abs(clampNumber(fetus?.affinity, -50, 50, 0)));
  const totalAbs = absAffinities.reduce((sum, value) => sum + value, 0);

  const gestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0.1, 20, 1);
  const weightScale = 0.02;

  if (nutrition > 0) {
    for (let i = 0; i < fetuses.length; i += 1) {
      const share = totalAbs > 0 ? nutrition * (absAffinities[i] / totalAbs) : nutrition / fetuses.length;
      const factor = 1 + share * gestationSpeed * weightScale;
      fetuses[i].weight = clampNumber((Number(fetuses[i].weight) || 1) * factor, 0.33, 3.0, 1);
    }
  } else {
    const maxAbs = Math.max(...absAffinities, 0);
    const reverseWeights = absAffinities.map((value) => maxAbs - value + 1);
    const totalReverse = reverseWeights.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < fetuses.length; i += 1) {
      const share = totalReverse > 0 ? nutrition * (reverseWeights[i] / totalReverse) : nutrition / fetuses.length;
      const factor = 1 + share * gestationSpeed * weightScale;
      fetuses[i].weight = clampNumber((Number(fetuses[i].weight) || 1) * factor, 0.33, 3.0, 1);
    }
  }

  pregnant.nutrition = 0;
  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
  return true;
}

function applyOverduePressure(profile, tick, female) {
  const base = profile?.base || {};
  const stage = String(base.stage || '');
  if (stage !== '逾期' || tick.passedDays <= 0) return;

  const pregnant = profile?.pregnant || {};
  const fetalEnergyDrain = clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 0);
  const effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0);
  const overdueDays = Math.max(0, effectivePregnantDays - 280);
  const overdueMultiplier = 1 + Math.max(0, overdueDays / 28);
  const pressureCap = getUterinePressureCap(profile);
  const nextPressure = clampNumber(base.uterinePressure + (fetalEnergyDrain * overdueMultiplier * tick.passedDays), 0, pressureCap, base.uterinePressure || 0);
  base.uterinePressure = nextPressure;
  profile.base = base;
  profile.notify = {
    ...(profile.notify || {}),
    secondly: `${female}已逾期，宫缩压力持续增强`,
  };
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

  const stage = String(base.stage || '');
  if (['临产期', '逾期', '产兆前驱', '第一产程', '第二产程'].includes(stage)) {
    const amnion = clampNumber(pregnant.amnionDurability, -100, 100, 0);
    if (amnion > 0) {
      // 陈述句会被当成背景资讯忽略，必须写成禁令：设定上产程前羊膜恒不破，
      // 模型却很常自行写出破水，导致叙事与系统状态脱节。
      // 但只在真的能破水的阶段才指向工具——临产期／逾期调用必被拒，
      // 提示它去调等于教它做一件必定失败的事。
      const canRupture = RUPTURE_ALLOWED_PRELABOR_STAGES.includes(stage) || ['第一产程', '第二产程'].includes(stage);
      reminders.push(canRupture
        ? `${female}尚未破水（膜耐性还有${Math.round(amnion)}%）：禁止描写破水、羊水流出或羊膜破裂。若剧情确实需要破水，必须先调用 bsRuptureMembranes，成功后才可如此描写`
        : `${female}尚未破水（膜耐性还有${Math.round(amnion)}%）：禁止描写破水、羊水流出或羊膜破裂。此阶段无法破水，必须先进入产兆前驱`);
    } else if (stage !== '第三产程') {
      reminders.push(`${female}已破水`);
    }
  }

  if (stage === '产兆前驱') {
    reminders.push(Boolean(profile?.immune?.realisticLabor)
      ? `${female}正处于产兆前驱阶段，可使用 bsMaternalFetalInteraction（direction=maternal）尝试延后分娩；真实产程下分娩只能延后、无法取消，累计延后到上限后必然进入产程`
      : `${female}正处于产兆前驱阶段，可优先使用 bsMaternalFetalInteraction（direction=maternal）尝试延后分娩`);
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

  const currentDurability = clampNumber(pregnant.amnionDurability, 0, 100, 100);
  const drain = Math.max(1, clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 1));
  const minDurability = LABOR_STAGES.includes(stage) ? 0 : 1;
  const nextDurability = Math.max(minDurability, currentDurability - drain);

  pregnant.amnionDurability = nextDurability;
  profile.pregnant = pregnant;

  const notify = profile.notify || {};
  if (stage === '孕早期' || stage === '孕中期') {
    notify.secondly = `${female}子宫压力过高，有流产风险`;
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
  updateAdvisoryNotify(profile, female);
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsExcreteMetabolism applied to ${female}.` };
}

function clearPregnancyState(profile) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  base.fertilizationDays = 0;
  base.uterinePressure = 0;
  pregnant.pregnantDays = 0;
  pregnant.effectivePregnantDays = 0;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborFetusIndex = 0;
  pregnant.laborPain = 0;
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
  pregnant.fetuses = [];
  pregnant.fetusesCount = 0;
  pregnant.fetalEnergyDrain = 0;
  pregnant.amnionDurability = 0;
  pregnant.nutrition = 0;
  pregnant.symptomReliefPending = 0;
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

    if (progress > 75 && motherDerivedType) {
      childDerivedType = motherDerivedType;
    }
    if (progress < -75 && fatherDerivedType) {
      childDerivedType = fatherDerivedType;
    }

    // 代孕／寄生：孩子不属于承载者，但先如实记下并标注 provider。
    // 之前是直接 continue 跳过，孩子记录会凭空消失——承载者不得、提供者也没有。
    // 之后由 transferProviderChildren 在拿得到 chatState 的层级转交给 provider。
    const provider = fetus?.provider === null || fetus?.provider === undefined
      ? null
      : String(fetus.provider).trim() || null;
    children.push({
      name: null,
      fathers: String(fetus?.fathers || '未知'),
      provider,
      providerSources: Array.isArray(fetus?.providerSources) ? [...fetus.providerSources] : [],
      chimera: fetus?.chimera ? cloneValue(fetus.chimera) : null,
      gender: String(fetus?.gender || '未知'),
      race: String(fetus?.race || '未知'),
      derivedType: childDerivedType,
      age: 0,
      birthWeightRatio: clampNumber(fetus?.weight, 0.33, 3.0, 1.0),
      birthAffinity: clampNumber(fetus?.affinity, -50, 50, 0),
      talents: normalizeTalentList(fetus?.talents ?? fetus?.inheritedTalents),
    });
  }
  profile.children = children;
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
  const experience = profile.experience || {};
  const runtime = profile.__runtimeRef || null;
  const remainingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses.map((item) => ({ ...item })) : [];
  if (remainingFetuses.length > 0) appendChildrenFromFetuses(profile, remainingFetuses);
  clearPregnancyState(profile);
  if (runtime) restorePregnancyPhysiology(profile, runtime);
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
        ? `${female}自然分娩，生下了${remainingFetuses.length}个孩子`
        : `${female}通过手术分娩，生下了${remainingFetuses.length}个孩子`)
      : (isNatural
        ? `${female}完成了自然分娩，进入产后恢复`
        : `${female}完成了手术分娩，进入产后恢复`),
  };
  profile.base = base;
  return true;
}

function applyLaborAmnionWear(profile, female, options = {}) {
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const forceRupture = Boolean(options.forceRupture);
  const silent = Boolean(options.silent);
  const currentDurability = clampNumber(pregnant.amnionDurability, -100, 100, 0);

  if (forceRupture) {
    if (currentDurability > 0) pregnant.amnionDurability = 0;
    profile.pregnant = pregnant;
    return false;
  }

  const drainBase = Math.max(1, clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 1));
  const multiplier = clampNumber(options.multiplier, 0.1, 10, 1);
  const nextDurability = currentDurability - (drainBase * multiplier);
  const ruptured = currentDurability > 0 && nextDurability <= 0;
  pregnant.amnionDurability = nextDurability;
  profile.pregnant = pregnant;

  if (ruptured && !silent) {
    profile.notify = {
      ...notify,
      secondly: `${female}破水了`,
    };
  }
  return ruptured;
}

function getProdromalInitialHours(profile) {
  return 48 * clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
}

/** 真实产程下产兆前驱的累计延后上限（占初始时长的比例）：只能拖，拖不掉 */
const REALISTIC_PRODROMAL_DELAY_CAP_RATIO = 1.0;

function clearProdromalState(pregnant) {
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
}

function beginLaborPhase(pregnant, phase, fetusIndex = 0) {
  pregnant.laborPhase = phase;
  pregnant.laborFetusIndex = fetusIndex;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
}

function enterProdromalStage(profile, female, stage, message) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  base.stage = '产兆前驱';
  base.days = 0;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborFetusIndex = 0;
  pregnant.prodromalOriginStage = stage;
  pregnant.prodromalRemainingHours = getProdromalInitialHours(profile);
  pregnant.prodromalDelayProgressHours = 0;
  pregnant.laborPain = 0;
  profile.pregnant = pregnant;
  updateLaborPain(profile, '产兆前驱', null, 0);
  profile.notify = {
    ...(profile.notify || {}),
    firstly: `${female}进入了产兆前驱`,
    secondly: message,
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

function shouldKeepPregnancyPressureWarning(profile) {
  const base = profile?.base || {};
  const stage = String(base.stage || '');
  if (!isPregnancyStage(stage)) return false;
  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  return currentPressure >= (pressureCap * 0.5);
}

function applyPressureCrisis(profile, runtime, female) {
  const base = profile?.base || {};
  const pregnant = profile?.pregnant || {};
  const immune = profile?.immune || {};
  const experience = profile?.experience || {};
  const cooldown = profile?.cooldown || {};
  const stage = String(base.stage || '');
  if (!isPregnancyStage(stage)) return { changed: false, warned: false };

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

    clearPregnancyState(profile);
    restorePregnancyPhysiology(profile, runtime || {});
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

function resolveSecondPhaseHours(profile, phase, fetuses) {
  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  if (phase === '间歇期') return Math.max(0.5, birthDifficulty * 0.5);
  const firstFetus = Array.isArray(fetuses) && fetuses.length > 0 ? fetuses[0] : null;
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

function resolveLaborPhaseHours(profile, stage, phase, fetuses) {
  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  if (stage === '第一产程') {
    const total = resolveLaborStageHours('第一产程', Math.max(fetuses.length, 1), birthDifficulty)
      * resolveFirstStageExperienceMultiplier(profile);
    if (phase === '活跃期') return total * 0.35;
    if (phase === '过渡期') return total * 0.15;
    return total * 0.5;
  }
  if (stage === '第二产程') return resolveSecondPhaseHours(profile, phase, fetuses);
  if (stage === '第三产程') {
    if (phase === '产后观察') return Math.max(
      LABOR_POSTPARTUM_OBSERVATION_HOURS,
      birthDifficulty * LABOR_POSTPARTUM_OBSERVATION_HOURS,
    );
    return Math.max(0.5, resolveLaborStageHours('第三产程', 1, birthDifficulty));
  }
  return 1;
}

function getLaborPhaseForStage(stage, currentPhase) {
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
  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  const difficultyWeight = stage === '产兆前驱' ? (0.25 + (ratio * 0.25)) : (phase === '潜伏期' ? (0.25 + (ratio * 0.75)) : (phase === '产后观察' ? 0.5 : 1));
  pain += clampNumber((birthDifficulty - 1) * 1.5, -1.5, 3, 0) * difficultyWeight;
  const toleranceWeight = stage === '产兆前驱' ? 0.5 : (phase === '潜伏期' ? (0.5 + (ratio * 0.5)) : (phase === '产后观察' ? 0.5 : 1));
  pain += (4 - clampNumber(base.vitalityLevel, 1, 7, 4)) * toleranceWeight;
  pain += ((clampNumber(base.psyStressLevel, 1, 7, 4) - 4) * 0.5) * toleranceWeight;
  if (obstruction) pain += 1.5;
  pregnant.laborPain = Math.round(clampNumber(pain, 0, 10, 0) * 10) / 10;
  profile.pregnant = pregnant;
  return pregnant.laborPain;
}

function processLabor(profile, tick, female) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const realisticLabor = Boolean(profile?.immune?.realisticLabor);
  const stage = String(base.stage || '');
  const rawHours = tick.deltaDays * 24;
  if (rawHours <= 0) return false;

  const pressureCap = getUterinePressureCap(profile);
  const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
  const libido = clampNumber(base.libido, 0, getLibidoCap(profile), 0);
  const libidoMultiplier = 1 + (libido / Math.max(getLibidoCap(profile), 1)) * 0.25;
  const baseEffectiveHours = rawHours * libidoMultiplier;
  let currentStageHours = clampNumber(pregnant.laborHours, 0, 9999, 0);
  let currentEffectiveHours = clampNumber(pregnant.effectiveLaborHours, 0, 9999, 0);

  if (stage === '产兆前驱') {
    updateProdromalFetalPositions(profile, tick);
    const initialHours = getProdromalInitialHours(profile);
    const remainingHours = clampNumber(pregnant.prodromalRemainingHours, 0, 9999, initialHours) - rawHours;
    pregnant.prodromalRemainingHours = Math.max(0, remainingHours);
    updateLaborPain(profile, stage, null, 1 - (Math.max(0, remainingHours) / initialHours));
    if (remainingHours <= 0) {
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
      return true;
    }
    notify.secondly = `${female}仍处于产兆前驱，距离正式产程约剩${Math.ceil(remainingHours)}小时`;
    profile.notify = notify;
    return false;
  }

  if (!LABOR_STAGES.includes(stage)) return false;

  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const phase = getLaborPhaseForStage(stage, String(pregnant.laborPhase || ''));
  pregnant.laborPhase = phase;
  if (stage === '第二产程' && clampNumber(pregnant.laborFetusIndex, 0, 99, 0) <= 0) pregnant.laborFetusIndex = 1;
  const realisticObstruction = realisticLabor && stage === '第二产程'
    ? getRealisticLaborObstruction(fetuses)
    : null;
  if (realisticObstruction) {
    notify.firstly = `${female}发生难产警示：${realisticObstruction}，建议使用 bsChildbirth 进行手术产`;
  }
  const threshold = resolveLaborPhaseHours(profile, stage, phase, fetuses);
  const stallThreshold = pressureCap * 0.66;
  const isThirdStageWithNoFetuses = stage === '第三产程' && fetuses.length === 0;

  currentStageHours += rawHours;
  pregnant.laborHours = currentStageHours;

  if (currentPressure < stallThreshold && !isThirdStageWithNoFetuses) {
    const currentRatio = pressureCap > 0 ? (currentPressure / pressureCap) : 0;
    const chanceToStall = Math.max(0, Math.min(1, 1 - currentRatio));
    if (Math.random() < chanceToStall) {
      profile.notify = {
        ...notify,
        secondly: `${female}的子宫收缩微弱，产程进展停滞`,
      };
      pregnant.effectiveLaborHours = currentEffectiveHours;
      updateLaborPain(profile, stage, phase, currentEffectiveHours / threshold, Boolean(realisticObstruction));
      return false;
    }
  } else if (currentPressure >= pressureCap && !realisticLabor) {
    if (stage === '第一产程') {
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
      base.uterinePressure = pressureCap * 0.5;
      base.stage = '第二产程';
      base.days = 0;
      beginLaborPhase(pregnant, '胎体下降', 1);
      updateLaborPain(profile, '第二产程', '胎体下降', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程`,
        secondly: `${female}宫口开全，产程突然加速`,
      };
      return true;
    }

    if (stage === '第二产程') {
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
      let father = '未知';
      let gender = '未知';
      if (fetuses.length > 0) {
        const baby = fetuses.shift();
        father = String(baby?.fathers || '未知');
        gender = String(baby?.gender || '未知');
        appendChildrenFromFetuses(profile, [baby]);
        pregnant.fetuses = fetuses;
        pregnant.fetusesCount = fetuses.length;
        updateFetalEnergyDrain(profile);
      }
      base.uterinePressure = pressureCap * 0.5;
      if (fetuses.length === 0) {
        base.stage = '第三产程';
        base.days = 0;
        beginLaborPhase(pregnant, '供养器官娩出', 0);
        updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
        profile.notify = {
          ...notify,
          firstly: `${female}进入了第三产程`,
          secondly: `${female}产程突然加速，生下了${father}的孩子，性别为${gender}，正在娩出胎盘`,
        };
      } else {
        beginLaborPhase(pregnant, '胎体下降', clampNumber(pregnant.laborFetusIndex, 1, 99, 1) + 1);
        updateLaborPain(profile, '第二产程', '胎体下降', 0);
        profile.notify = {
          ...notify,
          secondly: `${female}产程突然加速，生下了${father}的孩子，性别为${gender}，仍有${fetuses.length}胎待产`,
        };
      }
      return base.stage !== stage;
    }

    if (stage === '第三产程') {
      applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
      return applyChildbirthInternal(profile, female, true);
    }
  }

  const pressureMultiplier = stage === '第三产程'
    ? 1
    : Math.max(0.5, Math.min(1.5, 0.5 + (currentPressure / 150)));
  const effectiveHoursGain = baseEffectiveHours * pressureMultiplier;
  currentEffectiveHours += effectiveHoursGain;
  pregnant.effectiveLaborHours = currentEffectiveHours;
  updateLaborPain(profile, stage, phase, currentEffectiveHours / threshold, Boolean(realisticObstruction));

  if (stage === '第一产程') {
    applyLaborAmnionWear(profile, female, { multiplier: rawHours * 0.35 });
  } else if (stage === '第二产程') {
    applyLaborAmnionWear(profile, female, { multiplier: rawHours * 0.75 });
  } else if (stage === '第三产程') {
    applyLaborAmnionWear(profile, female, { forceRupture: true, silent: true });
  }
  if (pregnant.effectiveLaborHours <= threshold) {
    if (stage === '第二产程' && realisticObstruction && phase === '胎体娩出') {
      notify.secondly = `${female}因${realisticObstruction}无法自然娩出胎儿，产程持续受阻`;
    } else if (stage === '第二产程' && fetuses.length > 0) {
      const firstFetus = fetuses[0];
      const fetalAngle = Number.isFinite(Number(firstFetus?.tendencyAngle)) ? wrapAngle(firstFetus.tendencyAngle) : 0;
      const positionDifficulty = calculatePositionDifficulty(fetalAngle, firstFetus);
      const fetalWeight = clampNumber(firstFetus?.weight, 0.33, 3.0, 1.0);
      notify.secondly = phase === '间歇期'
        ? `${female}正在第${pregnant.laborFetusIndex}胎娩出后的间歇期`
        : `${female}正处于第${pregnant.laborFetusIndex}胎的${phase}，胚位${fetalAngle.toFixed(1)}°，难度${positionDifficulty.toFixed(2)}，胎重${fetalWeight.toFixed(2)}，进度${pregnant.effectiveLaborHours.toFixed(2)}/${threshold.toFixed(2)}小时`;
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
    return false;
  }

  if (stage === '第一产程') {
    if (phase === '潜伏期') {
      beginLaborPhase(pregnant, '活跃期', 0);
      updateLaborPain(profile, stage, '活跃期', 0);
      profile.notify = { ...notify, firstly: `${female}进入了第一产程·活跃期`, secondly: `${female}的规律宫缩明显加强` };
      return false;
    }
    if (phase === '活跃期') {
      beginLaborPhase(pregnant, '过渡期', 0);
      updateLaborPain(profile, stage, '过渡期', 0);
      profile.notify = { ...notify, firstly: `${female}进入了第一产程·过渡期`, secondly: `${female}的分娩疼痛与压迫感进一步攀升` };
      return false;
    }
    base.stage = '第二产程';
    base.days = 0;
    beginLaborPhase(pregnant, '胎体下降', 1);
    updateLaborPain(profile, '第二产程', '胎体下降', 0);
    profile.notify = { ...notify, firstly: `${female}进入了第二产程·第1胎体下降`, secondly: `${female}开始推动胎儿下降` };
    return true;
  }

  if (stage === '第二产程') {
    if (realisticObstruction && phase === '胎体娩出') {
      pregnant.effectiveLaborHours = threshold;
      profile.notify = {
        ...notify,
        secondly: `${female}因${realisticObstruction}无法自然娩出胎儿`,
      };
      return false;
    }
    if (phase === '胎体下降') {
      beginLaborPhase(pregnant, '胎体娩出', pregnant.laborFetusIndex);
      updateLaborPain(profile, stage, '胎体娩出', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程·第${pregnant.laborFetusIndex}胎体娩出`,
        secondly: `${female}的第${pregnant.laborFetusIndex}胎开始娩出`,
      };
      return false;
    }
    if (phase === '间歇期') {
      const nextIndex = clampNumber(pregnant.laborFetusIndex, 1, 99, 1) + 1;
      beginLaborPhase(pregnant, '胎体下降', nextIndex);
      updateLaborPain(profile, stage, '胎体下降', 0);
      profile.notify = {
        ...notify,
        firstly: `${female}进入了第二产程·第${nextIndex}胎体下降`,
        secondly: `${female}开始推动下一胎下降`,
      };
      return false;
    }
    if (fetuses.length > 0) {
      const baby = fetuses.shift();
      const father = String(baby?.fathers || '未知');
      const gender = String(baby?.gender || '未知');
      appendChildrenFromFetuses(profile, [baby]);
      pregnant.fetuses = fetuses;
      pregnant.fetusesCount = fetuses.length;
      updateFetalEnergyDrain(profile);
      if (fetuses.length === 0) {
        base.stage = '第三产程';
        base.days = 0;
        beginLaborPhase(pregnant, '供养器官娩出', 0);
        updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
        profile.notify = {
          ...notify,
          firstly: `${female}进入了第三产程·供养器官娩出`,
          secondly: `${female}生下了${father}的孩子，性别为${gender}，正在娩出胎盘`,
        };
      } else {
        beginLaborPhase(pregnant, '间歇期', pregnant.laborFetusIndex);
        updateLaborPain(profile, stage, '间歇期', 0);
        profile.notify = {
          ...notify,
          firstly: `${female}进入了第二产程·第${pregnant.laborFetusIndex}胎后间歇期`,
          secondly: `${female}生下了${father}的孩子，性别为${gender}，仍有${fetuses.length}胎待产`,
        };
      }
      return base.stage !== stage;
    }
    base.stage = '第三产程';
    base.days = 0;
    beginLaborPhase(pregnant, '供养器官娩出', 0);
    updateLaborPain(profile, '第三产程', '供养器官娩出', 0);
    return true;
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
      return false;
    }
    return applyChildbirthInternal(profile, female, true);
  }

  return false;
}

function applyAbortion(chatState, args) {
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

  if (fetusIndex !== undefined && (!Number.isInteger(fetusIndex) || fetusIndex < 0 || fetusIndex >= fetuses.length)) {
    return { applied: false, message: `bsAbortion skipped for ${female}: invalid fetusIndex.` };
  }

  if (Number.isInteger(fetusIndex) && fetusIndex >= 0 && fetusIndex < fetuses.length) {
    const removedFetus = fetuses.splice(fetusIndex, 1)[0];
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

  clearPregnancyState(profile);
  restorePregnancyPhysiology(profile, next.runtime || {});

  if (MENSTRUAL_STAGES.includes(stage)) {
    base.stage = '卵泡期';
    base.days = 0;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了卵泡期`,
      secondly: `${female}避孕成功`,
    };
  } else {
    base.stage = '产后恢复';
    base.days = 0;
    experience.miscarriageExperience = clampNumber(experience.miscarriageExperience, 0, 999, 0) + 1;
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
  if (isPregnancyStage(currentStage)) {
    return { applied: false, message: `bsImplantEmbryo skipped for ${female}: implantation has already completed.` };
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
  const geneticProfile = { base: { race: geneticRace } };
  const spermSeed = {
    male: fathers,
    race: fatherDescriptor.race || geneticRace,
    // 所有外部遗传衍生类型都占父系槽：fatherRace 明示者优先，否则退回卵源 race。
    derivedType: fatherDescriptor.derivedType || geneticDescriptor.derivedType || null,
  };

  const existingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  ensureEmbryoMetadata(pregnant);
  for (let index = 0; index < count; index += 1) {
    existingFetuses.push(createSimpleFetus(profile, spermSeed, currentStage, { geneticProfile, provider }));
  }
  pregnant.fetuses = existingFetuses;
  ensureEmbryoMetadata(pregnant);
  pregnant.fetusesCount = existingFetuses.length;
  if (existingFetuses.length === count) base.fertilizationDays = 0;

  profile.base = base;
  profile.pregnant = pregnant;
  updateFetalEnergyDrain(profile);
  profile.notify = {
    ...notify,
    secondly: `${female}加入了${count}个来自${provider}的受精卵，正等待共同著床窗口`,
  };

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
function applyRuptureMembranes(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsRuptureMembranes skipped: unknown character ${female || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const stage = String(base.stage || '');
  const inPrelabor = RUPTURE_ALLOWED_PRELABOR_STAGES.includes(stage);
  const inLabor = ['第一产程', '第二产程'].includes(stage);

  if (!inPrelabor && !inLabor) {
    return {
      applied: false,
      message: `bsRuptureMembranes skipped for ${female}: stage ${stage || '(none)'} cannot rupture; do not narrate rupture yet.`,
    };
  }

  if (clampNumber(pregnant.amnionDurability, -100, 100, 0) <= 0) {
    return { applied: false, message: `bsRuptureMembranes skipped for ${female}: already ruptured.` };
  }

  if (inPrelabor) {
    const pressureCap = getUterinePressureCap(profile);
    const currentPressure = clampNumber(base.uterinePressure, 0, pressureCap, 0);
    if (currentPressure < pressureCap * RUPTURE_PRESSURE_RATIO) {
      return {
        applied: false,
        message: `bsRuptureMembranes skipped for ${female}: uterine pressure too low to rupture; do not narrate rupture yet.`,
      };
    }
  }

  pregnant.amnionDurability = 0;
  profile.pregnant = pregnant;

  if (inPrelabor) {
    base.stage = '第一产程';
    base.days = 0;
    beginLaborPhase(pregnant, '潜伏期', 0);
    updateLaborPain(profile, '第一产程', '潜伏期', 0);
    clearProdromalState(pregnant);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了第一产程`,
      secondly: `${female}破水了，分娩正式开始`,
    };
  } else {
    profile.notify = { ...notify, secondly: `${female}破水了` };
  }

  profile.base = base;
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsRuptureMembranes applied to ${female}.` };
}

function applyChildbirth(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) {
    return { applied: false, message: `bsChildbirth skipped: unknown character ${female || '(empty)'}.` };
  }

  const next = cloneValue(character);
  const profile = next.profile || {};
  const fetuses = Array.isArray(profile?.pregnant?.fetuses) ? profile.pregnant.fetuses : [];
  if (fetuses.length === 0) {
    return { applied: false, message: `bsChildbirth skipped for ${female}: no fetuses.` };
  }
  const childbirthStage = String(profile?.base?.stage || '');
  const childbirthAllowedStages = ['孕早期', '孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '第一产程', '第二产程', '第三产程'];
  if (!childbirthAllowedStages.includes(childbirthStage)) {
    return { applied: false, message: `bsChildbirth skipped for ${female}: stage ${childbirthStage || '(none)'} 不允许手术分娩（需已着床进入妊娠阶段）。` };
  }

  profile.__runtimeRef = next.runtime || {};
  applyChildbirthInternal(profile, female, false);
  delete profile.__runtimeRef;
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  transferProviderChildren(chatState);
  return { applied: true, message: `bsChildbirth applied to ${female}.` };
}

function applyLaborResistance(profile, female) {
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const notify = profile.notify || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (String(base.stage || '') !== '产兆前驱') {
    profile.notify = {
      ...notify,
      thirdly: `${female}不在产兆前驱阶段，无法执行抵抗判定`,
    };
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: not in prodromal stage.` };
  }
  const realisticLabor = Boolean(profile?.immune?.realisticLabor);
  const vitality = clampNumber(base.vitality, 0, 9999, 100);
  const uterinePressure = clampNumber(base.uterinePressure, 0, 9999, 0);
  const fetalEnergyDrain = clampNumber(pregnant.fetalEnergyDrain, 0, 9999, 0);
  const birthDifficulty = clampNumber(profile?.bio?.birthDifficulty, 0.1, 100, 1);
  const breedTolerance = clampNumber(profile?.bio?.breedTolerance, 0.1, 100, 1);
  const judgeCount = Math.max(1, Math.round(fetalEnergyDrain + birthDifficulty - breedTolerance));
  let successCount = 0;
  let failureCount = 0;

  for (let round = 0; round < judgeCount; round += 1) {
    const threshold = randomInt(0, Math.max(0, Math.floor(uterinePressure)));
    const passed = vitality > threshold;
    if (passed) successCount += 1;
    else failureCount += 1;

    if (fetuses.length > 0) {
      const randomFetusIndex = randomInt(0, fetuses.length - 1);
      const fetus = fetuses[randomFetusIndex];
      const currentAngle = Number.isFinite(Number(fetus?.tendencyAngle))
        ? Number(fetus.tendencyAngle)
        : randomInt(0, 360);
      fetus.tendencyAngle = wrapAngle(currentAngle + randomInt(-90, 90));
    }

    if (clampNumber(pregnant.amnionDurability, 0, 100, 100) > 0) {
      const drain = Math.max(1, fetalEnergyDrain || 1);
      pregnant.amnionDurability = Math.max(1, clampNumber(pregnant.amnionDurability, 0, 100, 100) - drain);
    }
  }

  const initialHours = getProdromalInitialHours(profile);
  const rawDeltaHours = (successCount * 6) - (failureCount * 12);
  let deltaHours = Math.max(rawDeltaHours, -(initialHours * 0.75));

  // 真实产程：分娩只能延后、不能取消。累计延后上限为初始时长的 100%，
  // 到顶后再怎么抵抗成功也不会继续往后推，也不会退回妊娠阶段。
  const currentProgress = Math.max(0, clampNumber(pregnant.prodromalDelayProgressHours, 0, 9999, 0));
  const delayCapped = realisticLabor && deltaHours > 0;
  if (delayCapped) {
    const delayCap = initialHours * REALISTIC_PRODROMAL_DELAY_CAP_RATIO;
    deltaHours = Math.max(0, Math.min(deltaHours, delayCap - currentProgress));
  }
  const atDelayCap = delayCapped && deltaHours <= 0;

  const remainingHours = clampNumber(pregnant.prodromalRemainingHours, 0, 9999, initialHours) + deltaHours;
  const progressHours = Math.max(0, currentProgress + deltaHours);
  pregnant.prodromalRemainingHours = Math.max(0, remainingHours);
  pregnant.prodromalDelayProgressHours = progressHours;
  updateLaborPain(profile, '产兆前驱', null, 1 - (Math.max(0, remainingHours) / initialHours));
  pregnant.fetuses = fetuses;
  profile.pregnant = pregnant;
  if (remainingHours <= 0) {
    base.stage = '第一产程';
    base.days = 0;
    beginLaborPhase(pregnant, '潜伏期', 0);
    updateLaborPain(profile, '第一产程', '潜伏期', 0);
    clearProdromalState(pregnant);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了第一产程`,
      secondly: `${female}的产兆前驱时间耗尽，进入分娩`,
      thirdly: `${female}的抵抗判定为${successCount}次成功、${failureCount}次失败，未能继续延后分娩`,
    };
    return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: prodromal duration exhausted.` };
  }

  // 真实产程下分娩不可取消：即使抵抗再成功，也不会退回妊娠阶段
  if (progressHours >= initialHours && !realisticLabor) {
    const target = derivePregnancyStageState(clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0), 1);
    const reducedPressure = Math.floor(uterinePressure * 0.25);
    base.stage = target.stage;
    base.days = target.days;
    base.uterinePressure = reducedPressure;
    pregnant.laborPhase = null;
    pregnant.laborFetusIndex = 0;
    pregnant.laborHours = 0;
    pregnant.effectiveLaborHours = 0;
    pregnant.laborPain = 0;
    clearProdromalState(pregnant);
    profile.notify = {
      ...notify,
      firstly: `${female}进入了${target.stage}`,
      secondly: `${female}的分娩前兆缓解，回到${target.stage}`,
      thirdly: `${female}的抵抗判定为${successCount}次成功、${failureCount}次失败，成功延缓分娩`,
    };
    return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: labor resisted.` };
  }

  profile.notify = {
    ...notify,
    thirdly: atDelayCap
      ? `${female}的抵抗判定为${successCount}次成功、${failureCount}次失败，但分娩已无法再延后，剩余约${Math.ceil(remainingHours)}小时`
      : `${female}的抵抗判定为${successCount}次成功、${failureCount}次失败，产兆前驱时间变动${deltaHours >= 0 ? '+' : ''}${deltaHours.toFixed(1)}小时，剩余约${Math.ceil(remainingHours)}小时`,
  };
  return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: prodromal duration adjusted.` };
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
  const maternalNutritionGainMap = Object.freeze({
    slight_increase: 1,
    significant_increase: 2,
    slight_decrease: 1,
    significant_decrease: 2,
  });
  const next = cloneValue(character);
  const profile = next.profile || {};
  const stage = String(profile?.base?.stage || '');
  const interactionCooldown = profile.cooldown || {};
  if (interactionCooldown.maternalFetalInteractionUsed) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: already changed during this story hour.` };
  }
  if (direction === 'maternal' && stage === '产兆前驱') {
    const result = applyLaborResistance(profile, female);
    if (result.applied) {
      profile.cooldown = {
        ...(profile.cooldown || {}),
        maternalFetalInteractionUsed: true,
      };
    }
    next.profile = profile;
    chatState.characters[female] = syncCharacterStageFromProfile(next);
    return result;
  }

  const pregnant = profile.pregnant || {};
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  if (fetuses.length === 0) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: no fetuses.` };
  }

  const cooldown = profile.cooldown || {};
  if (direction === 'maternal') {
    const selectedIndex = randomInt(0, fetuses.length - 1);
    const selectedFetus = fetuses[selectedIndex];
    const maternalChangeKeys = Object.keys(changeMap);
    const maternalChange = maternalChangeKeys[randomInt(0, maternalChangeKeys.length - 1)];
    const maternalChangeValue = changeMap[maternalChange];
    const maternalChangeDisplay = changeDisplayMap[maternalChange];
    let nutritionMessage = '';

    const psyStress = clampNumber(profile?.base?.psyStress, 0, 9999, 0);
    const success = Math.random() >= Math.min(1, psyStress / 200);
    if (success) {
      const currentAffinity = clampNumber(selectedFetus?.affinity, -50, 50, 0);
      selectedFetus.affinity = clampNumber(currentAffinity + maternalChangeValue, -50, 50, 0);
      const symptomReliefPending = clampNumber(pregnant.symptomReliefPending, 0, 999, 0);
      if (symptomReliefPending > 0) {
        const nutritionGain = maternalNutritionGainMap[maternalChange];
        pregnant.nutrition = (Number(pregnant.nutrition) || 0) + nutritionGain;
        pregnant.symptomReliefPending = symptomReliefPending - 1;
        nutritionMessage = pregnant.symptomReliefPending > 0
          ? `，身体补回了${nutritionGain}点供养力（仍有${pregnant.symptomReliefPending}次不适待安抚）`
          : `，身体补回了${nutritionGain}点供养力`;
      }
    } else {
      const currentAngle = Number.isFinite(Number(selectedFetus?.tendencyAngle))
        ? Number(selectedFetus.tendencyAngle)
        : randomInt(0, 360);
      selectedFetus.tendencyAngle = wrapAngle(currentAngle + randomInt(-10, 10));
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
        ? `${female}安抚了第${selectedIndex + 1}胎，亲密度${maternalChangeDisplay}了${nutritionMessage}`
        : `${female}尝试安抚第${selectedIndex + 1}胎，但因心理压力过大而失败，胎位角度发生了微小转动${nutritionMessage}`,
    };
    next.profile = profile;
    chatState.characters[female] = next;
    return { applied: true, message: `bsMaternalFetalInteraction applied to ${female}: maternal interaction.` };
  }

  const changeValue = changeMap[change];
  if (changeValue === undefined) {
    return { applied: false, message: `bsMaternalFetalInteraction skipped for ${female}: direction=fetal requires a valid change.` };
  }
  const selectedIndex = randomInt(0, fetuses.length - 1);
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

function applyEggGain(profile, amount) {
  const nextAmount = Math.max(0, Number(amount) || 0);
  if (nextAmount <= 0) return { applied: false, usedCooldown: false };

  const base = profile.base || {};
  const cooldown = profile.cooldown || {};
  const stage = String(base.stage || '');

  if (stage === '假孕期') {
    return { applied: false, usedCooldown: false };
  }

  if (stage === '排卵期') {
    base.eggs = clampNumber(base.eggs, 0, 999, 0) + nextAmount;
    base.uterinePressure = clampNumber(base.uterinePressure, 0, 999, 0) + 2;
    return { applied: true, usedCooldown: false };
  }

  if (cooldown.orgasmOvulationUsed) {
    return { applied: false, usedCooldown: true };
  }

  base.eggs = clampNumber(base.eggs, 0, 999, 0) + nextAmount;
  base.uterinePressure = clampNumber(base.uterinePressure, 0, 999, 0) + 2;
  return { applied: true, usedCooldown: true };
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

  const amount = Math.max(0, clampNumber(bio.orgasmOvulationAmount, 0, 100, 1));
  const eggResult = applyEggGain(profile, amount);
  if (!eggResult.applied) return false;
  base.libido = 0;
  profile.cooldown = {
    ...cooldown,
    orgasmOvulationUsed: eggResult.usedCooldown ? true : Boolean(cooldown.orgasmOvulationUsed),
  };
  profile.notify = {
    ...notify,
    secondly: `${next.name}因高潮而额外排卵，性欲归零`,
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

function getStageLimit(profile, stage) {
  if (MENSTRUAL_STAGE_DAYS[stage]) {
    const ratio = clampNumber(profile?.bio?.menstrualLengthRatio, 0.1, 20, 1);
    const fluctuation = getMenstrualStageFluctuation(profile, stage);
    return Math.max(1, MENSTRUAL_STAGE_DAYS[stage] * ratio * (1 + fluctuation));
  }
  if (stage === '产后恢复') return Math.max(1, clampNumber(profile?.bio?.recoveryDays, 1, 9999, 56));
  return null;
}

function advanceMenstrualStage(profile, stage, daysValue) {
  let nextStage = stage;
  let nextDays = daysValue;
  let changed = false;
  let enteredFollicular = false;
  while (MENSTRUAL_STAGES.includes(nextStage)) {
    const limit = getStageLimit(profile, nextStage);
    if (limit === null || nextDays <= limit) break;
    nextDays -= limit;
    const stageIndex = MENSTRUAL_STAGES.indexOf(nextStage);
    nextStage = MENSTRUAL_STAGES[(stageIndex + 1) % MENSTRUAL_STAGES.length];
    if (nextStage === '卵泡期') enteredFollicular = true;
    changed = true;
  }
  return {
    stage: nextStage,
    days: Math.max(0, nextDays),
    changed,
    enteredFollicular,
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
    if (stageChanged && shouldEnterPseudoPregnancy(profile, oldStage, stage)) {
      stage = '假孕期';
      days = 0;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
      notify.secondly = `${next.name}因进入月经期时心理压力偏高、性欲偏高且近期有性接触记录，出现了假孕症状`;
    }
  } else if (PREGNANCY_STAGES.includes(stage)) {
    const oldPregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0);
    pregnant.pregnantDays = oldPregnantDays + deltaDays;
    pregnant.effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) + (deltaDays * clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, 20, 1));
    const oldWeek = Math.floor(oldPregnantDays / 7);
    const newWeek = Math.floor(pregnant.pregnantDays / 7);
    if (newWeek > oldWeek && isHere) {
      applyWeeklyNutrition(profile);
    }
    updateDerivedTypeProgress(profile, tick);
    const derived = derivePregnancyStageState(pregnant.effectivePregnantDays, 1);
    stage = derived.stage;
    days = derived.days;
    stageChanged = stage !== oldStage;
    base.stage = stage;
    base.days = days;
    updateFetalPositions(profile, tick, next.name);
    if (isHere) {
      applyOverduePressure(profile, tick, next.name);
      applyHourlyPregnancyMetabolism(profile, tick, next.name);
    }
    const pressureCrisis = isHere ? applyPressureCrisis(profile, next.runtime || {}, next.name) : { changed: false, warned: false };
    if (pressureCrisis.changed) {
      stage = String(base.stage || stage);
      days = clampNumber(base.days, 0, 9999, 0);
      stageChanged = true;
    }
    if (isHere && !pressureCrisis.warned && maybeStartLabor(profile, tick, next.name)) {
      stage = String(base.stage || stage);
      days = clampNumber(base.days, 0, 9999, 0);
      stageChanged = true;
    }
  } else if (stage === '产后恢复') {
    days += deltaDays;
    const recoveryDays = getStageLimit(profile, '产后恢复');
    if (days > recoveryDays) {
      stage = '卵泡期';
      days = 0;
      stageChanged = true;
      enteredFollicular = true;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
      pregnant.laborHours = 0;
      pregnant.effectiveLaborHours = 0;
      pregnant.laborPhase = null;
      pregnant.laborFetusIndex = 0;
      pregnant.laborPain = 0;
      clearProdromalState(pregnant);
      pregnant.fetuses = [];
      pregnant.fetusesCount = 0;
      pregnant.fetalEnergyDrain = 0;
      base.fertilizationDays = 0;
    }
  } else if (stage === '假孕期') {
    pregnant.pregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0) + deltaDays;
    const pseudoLimit = Math.max(1, 84 * clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0.1, 20, 1));
    if (pregnant.pregnantDays > pseudoLimit) {
      stage = '月经期';
      days = 0;
      stageChanged = true;
      pregnant.pregnantDays = 0;
      pregnant.effectivePregnantDays = 0;
    }
  } else if (stage === '产兆前驱') {
    const oldPregnantDays = clampNumber(pregnant.pregnantDays, 0, 9999, 0);
    pregnant.pregnantDays = oldPregnantDays + deltaDays;
    pregnant.effectivePregnantDays = clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) + (deltaDays * clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, 20, 1));
    const oldWeek = Math.floor(oldPregnantDays / 7);
    const newWeek = Math.floor(pregnant.pregnantDays / 7);
    if (newWeek > oldWeek && isHere) {
      applyWeeklyNutrition(profile);
    }
    if (isHere) applyHourlyPregnancyMetabolism(profile, tick, next.name);
    updateDerivedTypeProgress(profile, tick);
    const laborChanged = processLabor(profile, tick, next.name);
    stage = String(base.stage || stage);
    days = clampNumber(base.days, 0, 9999, 0);
    stageChanged = stageChanged || laborChanged || stage !== oldStage;
  } else if (LABOR_STAGES.includes(stage)) {
    if (isHere) applyHourlyPregnancyMetabolism(profile, tick, next.name);
    updateDerivedTypeProgress(profile, tick);
    const laborChanged = processLabor(profile, tick, next.name);
    stage = String(base.stage || stage);
    days = clampNumber(base.days, 0, 9999, 0);
    stageChanged = stageChanged || laborChanged || stage !== oldStage;
  } else if (stage === '无经期' || stage === '未激活') {
    days += deltaDays;
    } else {
      days += deltaDays;
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

  clearPsychologyTransitionState(profile, stage, days);

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
    firstly: stageChanged ? `${next.name}进入了${stage}` : currentNotify.firstly || '',
  };
  profile.cooldown = {
    ...cooldown,
    orgasmOvulationUsed: shouldResetOrgasmOvulation(stage) ? false : Boolean(cooldown.orgasmOvulationUsed),
    naturalOvulationUsed: shouldResetNaturalOvulation(stage) ? false : Boolean((profile.cooldown || cooldown).naturalOvulationUsed),
    pregnancyPressureWarning: shouldKeepPregnancyPressureWarning(profile) ? Boolean((profile.cooldown || cooldown).pregnancyPressureWarning) : false,
    psychologyUpdateUsed: tick.passedHours > 0 ? false : Boolean(cooldown.psychologyUpdateUsed),
    maternalFetalInteractionUsed: tick.passedHours > 0 ? false : Boolean(cooldown.maternalFetalInteractionUsed),
  };
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

  const next = cloneValue(character);
  const profile = next.profile || {};
  profile.diary = Array.isArray(profile.diary) ? profile.diary : [];
  const currentStoryDayIndex = Math.floor(Math.max(0, Number(chatState?.minutesPassed) || 0) / 1440);
  const existsSameStoryDay = profile.diary.some((entry) => Number(entry?.storyDayIndex) === currentStoryDayIndex);
  if (existsSameStoryDay) {
    return { applied: false, message: `bsWriteDiary skipped for ${female}: story day ${currentStoryDayIndex + 1} is still on diary cooldown.` };
  }
  profile.diary.push({
    time,
    content,
    storyDayIndex: currentStoryDayIndex,
    createdAt: Date.now(),
  });
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsWriteDiary applied to ${female}: ${time}.` };
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
    const tick = buildTimeTick(current, totalMinutes);
    const result = applyTimeToCharacter(current, tick);
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
  }
  applyDerivedMetabolismExemptions(profile);

  next.profile.base = base;
  maybeTriggerOrgasmOvulation(next);
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
  if (!hasPreparedWardrobe(profile)) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: wardrobe is not prepared.` };
  const wardrobe = ensureWardrobeState(profile);
  const rawId = args?.item?.id;
  const hasExplicitIntegerId = Number.isInteger(Number(rawId)) && String(rawId ?? '').trim() !== '';
  // 定位更新目标：显式整数 id 直接比对；否则按 id 引用（含名称/hash 兼容）或衣物名称匹配既有条目。
  let target = null;
  if (hasExplicitIntegerId) {
    target = wardrobe.items.find((entry) => entry.id === item.id) || null;
  } else {
    target = resolveWardrobeItemRef(wardrobe.items, rawId)
      || resolveWardrobeItemRef(wardrobe.items, item.name)
      || null;
  }
  if (target && target.id === DEFAULT_WARDROBE_ITEM.id) return { applied: false, message: `bsAddWardrobeItem skipped for ${female}: id=0 is reserved.` };
  if (target) {
    item.id = target.id;
    const existingIndex = wardrobe.items.findIndex((entry) => entry.id === target.id);
    wardrobe.items[existingIndex] = item;
  } else {
    // 新衣物：显式整数 id 沿用；缺失或字符串 id 自动分配下一个序号，避免 hash id 污染长期衣柜。
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
  if (!hasPreparedWardrobe(profile)) return { applied: false, message: `bsRemoveWardrobeItem skipped for ${female}: wardrobe is not prepared.` };
  const wardrobe = ensureWardrobeState(profile);
  const target = resolveWardrobeItemRef(wardrobe.items, args?.itemId);
  if (!target) return { applied: false, message: `bsRemoveWardrobeItem skipped for ${female}: item not found (${JSON.stringify(args?.itemId ?? null)}).` };
  const itemId = target.id;
  if (itemId === DEFAULT_WARDROBE_ITEM.id) return { applied: false, message: `bsRemoveWardrobeItem skipped for ${female}: id=0 cannot be removed.` };
  wardrobe.items = wardrobe.items.filter((item) => item.id !== itemId);
  const outfit = ensureOutfitState(profile);
  if (outfit.mainItemId === itemId) outfit.mainItemId = DEFAULT_WARDROBE_ITEM.id;
  outfit.accessoryItemIds = outfit.accessoryItemIds.filter((id) => id !== itemId);
  refreshOutfitPregFit(profile);
  next.profile = profile;
  chatState.characters[female] = syncCharacterStageFromProfile(next);
  return { applied: true, message: `bsRemoveWardrobeItem applied to ${female}: ${itemId}.` };
}

function applyChangeOutfit(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsChangeOutfit skipped: unknown character ${female || '(empty)'}.` };
  const next = cloneValue(character);
  const profile = next.profile || {};
  if (!hasPreparedWardrobe(profile)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: wardrobe is not prepared.` };
  const outfit = ensureOutfitState(profile);
  if (args?.temporaryItems !== undefined) {
    if (!Array.isArray(args.temporaryItems)) return { applied: false, message: `bsChangeOutfit skipped for ${female}: temporaryItems must be an array.` };
    outfit.temporaryItems = normalizeTemporaryOutfitItems(args.temporaryItems);
  }
  const previousMainItemId = outfit.mainItemId;
  if (args?.mainItemId !== undefined) {
    const mainItem = findOutfitItem(profile, args.mainItemId, 'main');
    if (!mainItem) return { applied: false, message: `bsChangeOutfit skipped for ${female}: unknown main item ${JSON.stringify(args.mainItemId ?? null)}.` };
    outfit.mainItemId = mainItem.id;
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
  profile.base = base;
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsSetCharacterPresence applied to ${female}: isHere=${isPresent}.` };
}

function applyUpdateExperience(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  const options = args?.options && typeof args.options === 'object' ? args.options : null;
  if (!female || !character) return { applied: false, message: `bsUpdateExperience skipped: unknown character ${female || '(empty)'}.` };
  if (!options) return { applied: false, message: 'bsUpdateExperience skipped: empty options.' };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const experience = profile.experience || {};
  const allowedStringFields = ['virginity', 'latestSexPartner', 'emotionalMate', 'marriageMate'];
  const allowedNumberFields = ['pregnantExperience', 'naturalBirthExperience', 'surgicalBirthExperience', 'miscarriageExperience'];

  let changed = false;
  for (const field of allowedStringFields) {
    if (options[field] === undefined) continue;
    experience[field] = options[field] === null ? null : String(options[field]);
    changed = true;
  }
  for (const field of allowedNumberFields) {
    if (options[field] === undefined) continue;
    experience[field] = clampNumber(options[field], 0, 9999, experience[field] || 0);
    changed = true;
  }

  if (!changed) return { applied: false, message: `bsUpdateExperience skipped for ${female}: no allowed fields.` };

  profile.experience = experience;
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsUpdateExperience applied to ${female}.` };
}

function applyNameChild(chatState, args) {
  const female = String(args?.female || '').trim();
  const childIndex = Number(args?.childIndex);
  const childName = String(args?.name || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsNameChild skipped: unknown character ${female || '(empty)'}.` };
  if (!Number.isInteger(childIndex)) return { applied: false, message: 'bsNameChild skipped: invalid childIndex.' };
  if (!childName) return { applied: false, message: 'bsNameChild skipped: empty name.' };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const children = Array.isArray(profile.children) ? profile.children.map((item) => ({ ...item })) : [];
  if (childIndex < 0 || childIndex >= children.length) {
    return { applied: false, message: `bsNameChild skipped for ${female}: childIndex ${childIndex} out of range.` };
  }

  children[childIndex].name = childName;
  profile.children = children;
  next.profile = profile;
  chatState.characters[female] = next;
  return { applied: true, message: `bsNameChild applied to ${female}: child ${childIndex} named ${childName}.` };
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

const FETAL_TALENT_TRANSFER_STAGES = new Set(['孕中期', '孕晚期', '临产期', '逾期', '产兆前驱', '第一产程']);

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
    if (fetuses.length > 0) {
      inheritedFetusIndex = randomInt(0, fetuses.length - 1);
      const selectedFetus = fetuses[inheritedFetusIndex];
      const affinity = clampNumber(selectedFetus?.affinity, -50, 50, 0);
      inheritedExp = Math.round(skillExp * (Math.abs(affinity) / 50)) * Math.sign(affinity);
      const fetusTalents = normalizeTalentList(selectedFetus.talents ?? selectedFetus.inheritedTalents);
      let fetusTalent = fetusTalents.find((item) => item.skillId === definition.id);
      if (inheritedExp !== 0 && !fetusTalent) {
        fetusTalent = { skillId: definition.id, level: 0, exp: 0 };
        fetusTalents.push(fetusTalent);
      }
      if (inheritedExp !== 0) {
        Object.assign(fetusTalent, addTalentExperience(fetusTalent, inheritedExp));
        selectedFetus.talents = fetusTalents;
        delete selectedFetus.inheritedTalents;
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
  const isPregnancySide = PREGNANCY_STAGES.includes(stage) || stage === '假孕期' || stage === '产兆前驱' || LABOR_STAGES.includes(stage);

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
    const currentValue = target[valueKey] === null || target[valueKey] === undefined ? 0 : clampNumber(target[valueKey], 0, 100, 0);
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
  const parsedRace = parseRaceDescriptor(args?.race || '人类');
  const race = parsedRace.race || '人类';
  const amount = Number(args?.amount || 0);
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsAddSperm skipped: unknown character ${female || '(empty)'}.` };
  if (!male) return { applied: false, message: 'bsAddSperm skipped: empty male.' };
  if (!Number.isFinite(amount) || amount === 0) return { applied: false, message: 'bsAddSperm skipped: invalid amount.' };
  if (amount < 0) return { applied: false, message: 'bsAddSperm skipped: negative amount 请改用 bsDrainSperm 扣除精液。' };

  const next = cloneValue(character);
  const base = next.profile?.base || {};
  const sperms = Array.isArray(base.sperms) ? base.sperms.map((item) => ({ ...item })) : [];
  const maleDerivedType = parsedRace.derivedType || null;
  const existing = sperms.find((item) => String(item?.male || '') === male);
  if (existing) {
    existing.value = Math.max(0, clampNumber(existing.value, 0, 999999, 0) + amount);
    existing.race = race;
    existing.derivedType = maleDerivedType;
  } else if (amount > 0) {
    sperms.push({ male, race, derivedType: maleDerivedType, value: amount });
  }
  base.sperms = sperms.filter((item) => clampNumber(item?.value, 0, 999999, 0) > 0);
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
  if (amount > 0) {
    applyOdorGain(next.profile, Math.min(18, 4 + Math.log10(Math.max(1, amount)) * 4));
  }
  const enteredSperm = { male, race, derivedType: maleDerivedType, value: amount };
  if (tryConceiveOnSpermEntry(next.profile, enteredSperm, amount)) {
    next.profile.notify = {
      ...(next.profile.notify || {}),
      secondly: `${female}受精成功`,
    };
  }
  chatState.characters[female] = next;
  return { applied: true, message: `bsAddSperm applied to ${female}.` };
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
  next.profile.base = base;
  chatState.characters[female] = next;
  return { applied: true, message: `bsDrainSperm applied to ${female}.` };
}

function applySetMenstrualPhases(chatState, args) {
  const female = String(args?.female || '').trim();
  const stage = String(args?.stage || '').trim();
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
  const fetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const hasConceptionState = fetuses.length > 0
    || clampNumber(base.fertilizationDays, 0, 9999, 0) > 0
    || clampNumber(pregnant.pregnantDays, 0, 9999, 0) > 0
    || clampNumber(pregnant.effectivePregnantDays, 0, 9999, 0) > 0;
  const hasProtectedPregnancyState = PREGNANCY_STAGES.includes(currentStage)
    || currentStage === '产兆前驱'
    || LABOR_STAGES.includes(currentStage);

  if (hasConceptionState || hasProtectedPregnancyState) {
    return {
      applied: false,
      message: `bsSetMenstrualPhases skipped for ${female}: active conception or pregnancy state must not be overridden.`,
    };
  }

  base.stage = stage;
  base.days = 0;
  profile.base = base;
  if (stage === '卵泡期') {
    const metabolism = profile.metabolism || {};
    metabolism.milk = 0;
    profile.metabolism = metabolism;
  }
  if (stage === '排卵期') {
    profile.cooldown = {
      ...cooldown,
      orgasmOvulationUsed: false,
    };
  } else {
    profile.cooldown = {
      ...cooldown,
      orgasmOvulationUsed: shouldResetOrgasmOvulation(stage) ? false : Boolean(cooldown.orgasmOvulationUsed),
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
  const fatherInput = String(args?.father || '').trim();
  const raceInput = String(args?.race || '人类').trim();
  const fetusCount = clampNumber(args?.fetusCount, 1, 9, 1);
  const equivalentDays = clampNumber(args?.equivalentDays, 0, 300, 0);
  const genderInput = String(args?.genders || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugInjectPregnancy skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const experience = profile.experience || {};
  const notify = profile.notify || {};
  const bio = profile.bio || {};
  const currentStage = String(base.stage || '');
  const existingFetuses = Array.isArray(pregnant.fetuses) ? pregnant.fetuses : [];
  const hasConceptionState = existingFetuses.length > 0
    || clampNumber(base.fertilizationDays, 0, 9999, 0) > 0
    || isPregnancyStage(currentStage);
  if (hasConceptionState) {
    return { applied: false, message: `bsDebugInjectPregnancy skipped for ${female}: pregnancy/conception state already exists.` };
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

  const fetuses = [];
  for (let index = 0; index < fetusCount; index += 1) {
    const spermSeed = {
      male: rawFatherList.length === 0 ? '未知' : (rawFatherList.length === 1 ? rawFatherList[0] : rawFatherList[index]),
      race: parseRaceDescriptor(rawRaceList.length === 1 ? rawRaceList[0] : rawRaceList[index]).race || '人类',
      derivedType: null,
    };
    const fetus = createSimpleFetus(profile, spermSeed, equivalentDays === 0 ? currentStage : '孕早期');
    if (normalizedGenderList.length === 1) {
      fetus.gender = normalizedGenderList[0];
    } else if (normalizedGenderList.length === fetusCount) {
      fetus.gender = normalizedGenderList[index];
    }
    fetuses.push(fetus);
  }

  pregnant.fetuses = fetuses;
  pregnant.fetusesCount = fetuses.length;
  pregnant.laborHours = 0;
  pregnant.effectiveLaborHours = 0;
  pregnant.laborPhase = null;
  pregnant.laborFetusIndex = 0;
  pregnant.laborPain = 0;
  pregnant.prodromalOriginStage = null;
  pregnant.prodromalRemainingHours = 0;
  pregnant.prodromalDelayProgressHours = 0;
  pregnant.amnionDurability = equivalentDays === 0 ? 0 : 100;
  pregnant.pregnantDays = 0;
  pregnant.effectivePregnantDays = equivalentDays === 0 ? 0 : equivalentDays;

  profile.base = base;
  if (equivalentDays === 0) {
    base.fertilizationDays = 0;
  } else {
    applyPregnancyPhysiology(profile, next.runtime || {});
    const actualGestationSpeed = clampNumber(getGestationEffectiveSpeed(profile), 0, 20, 1);
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
      ? `${female}已注入${fetusCount}个刚受精胚胎，尚未着床`
      : `${female}已注入${fetusCount}胎，当前为等效妊娠${equivalentDays}天`,
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
  clearPregnancyState(profile);
  restorePregnancyPhysiology(profile, next.runtime || {});
  if (implantedPregnancy) {
    base.stage = '产后恢复';
    base.days = 0;
    experience.miscarriageExperience = clampNumber(experience.miscarriageExperience, 0, 999, 0) + 1;
    profile.experience = experience;
    profile.notify = {
      ...notify,
      firstly: `${female}进入了产后恢复`,
      secondly: `${female}的胎儿已被调试淨空，并记录一次流产/堕胎经验`,
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
    const multiplier = clampNumber(args?.multiplier, 0, 20, 1.0);
    if (!name) return { applied: false, message: `bsDebugSetGestationModifier skipped for ${female}: empty name.` };
    bio.gestationModifierMultiplier = multiplier;
    bio.gestationModifierName = name;
    bio.gestationModifierDescription = description;
  }

  bio.gestationEffectiveSpeed = clampNumber(getGestationEffectiveSpeed({ ...profile, bio }), 0, 20, baseSpeed);
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

function applyDebugSetProdromal(chatState, args) {
  const female = String(args?.female || '').trim();
  const character = chatState.characters?.[female];
  if (!female || !character) return { applied: false, message: `bsDebugSetProdromal skipped: unknown character ${female || '(empty)'}.` };

  const next = cloneValue(character);
  const profile = next.profile || {};
  const base = profile.base || {};
  const pregnant = profile.pregnant || {};
  const stage = String(base.stage || '');
  const allowedEntryStages = ['孕晚期', '临产期', '逾期'];
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
  const name = String(call?.name || '').trim();
  const args = normalizeToolCallArguments(call?.arguments);
  if (!name) return { applied: false, message: 'Empty tool call name.' };
  if (name === 'bsPassedTime') return applyPassedTime(chatState, args);
  if (name === 'bsWriteDiary') return applyWriteDiary(chatState, args);
  if (name === 'bsUpdateCharacterStatus') return applyCharacterStatus(chatState, args);
  if (name === 'bsAddWardrobeItem') return applyAddWardrobeItem(chatState, args);
  if (name === 'bsRemoveWardrobeItem') return applyRemoveWardrobeItem(chatState, args);
  if (name === 'bsChangeOutfit') return applyChangeOutfit(chatState, args);
  if (name === 'bsSetDescription') return applyDescription(chatState, args);
  if (name === 'bsSetCharacterPresence') return applySetCharacterPresence(chatState, args);
  if (name === 'bsUpdateExperience') return applyUpdateExperience(chatState, args);
  if (name === 'bsNameChild') return applyNameChild(chatState, args);
  if (name === 'bsRegisterSkillDefinition') return applyRegisterSkillDefinition(chatState, args);
  if (name === 'bsTrainSkill') return applyTrainSkill(chatState, args);
  if (name === 'bsUpdatePsychology') return applyUpdatePsychology(chatState, args);
  if (name === 'bsAddSperm') return applyAddSperm(chatState, args);
  if (name === 'bsDrainSperm') return applyDrainSperm(chatState, args);
  if (name === 'bsSetMenstrualPhases') return applySetMenstrualPhases(chatState, args);
  if (name === 'bsExcreteMetabolism') return applyExcreteMetabolism(chatState, args);
  if (name === 'bsAbortion') return applyAbortion(chatState, args);
  if (name === 'bsImplantEmbryo') return applyImplantEmbryo(chatState, args);
  if (name === 'bsRuptureMembranes') return applyRuptureMembranes(chatState, args);
  if (name === 'bsChildbirth') return applyChildbirth(chatState, args);
  if (name === 'bsMaternalFetalInteraction') return applyMaternalFetalInteraction(chatState, args);
  if (name === 'bsDebugInjectPregnancy') return applyDebugInjectPregnancy(chatState, args);
  if (name === 'bsDebugClearContainers') return applyDebugClearContainers(chatState, args);
  if (name === 'bsDebugSetGestationModifier') return applyDebugSetGestationModifier(chatState, args);
  if (name === 'bsDebugFetalActivity') return applyDebugFetalActivity(chatState, args);
  if (name === 'bsDebugSetProdromal') return applyDebugSetProdromal(chatState, args);
  return { applied: false, message: `Unsupported tool: ${name}` };
}

export function applyToolCallsResult(ctx, result) {
  const settings = getSettings(ctx);
  const chatState = getChatState(ctx, settings);
  const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
  const logs = [];
  for (const call of toolCalls) {
    const normalizedCall = {
      name: String(call?.name || '').trim(),
      arguments: normalizeToolCallArguments(call?.arguments),
    };
    const appliedResult = applyToolCall(chatState, normalizedCall);
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
