// 送给模型的工具说明集中在这里：追踪工具（TOOL_DEFINITIONS），以及原生工具调用时附加的
// 检查清单、备装、起始着衣三个提交工具与它们的使用说明。
// 这里只放「模型看到什么」；工具的执行逻辑在 tools.js，原生工具的转换与解析在 native_tools.js。
import { FETAL_EVENT_CHANGES, FETAL_EVENT_KINDS } from '../fetal_health.js';

// ── 追踪工具 ─────────────────────────────────────────

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
    description: '向单一角色的长期衣柜添加或更新衣物，无需先准备衣柜。main 是一套完整基础衣着，可用 parts 列出组成，fitProfile 使用隐藏四档与支撑/容身/方便档位。accessory 使用 category，effects 最多两项。新增可省略 id；更新传整数 id 或准确名称。以 id 或名称引用正在穿的临时衣物时，会把它转为长期衣物（id 与穿着不变），用于借来的衣服被送下等情况。note 只写稳定外观与来源。maternity=true 只给专为巨大孕肚设计的特制品（孕肚托、魔法伸缩布料、特制孕妇装等）：穿着任一件时，这套衣着四维的上限由 10 放宽到 15，叠得够高才压得住爆表的衣着压力；一般孕妇装不要标。',
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
            maternity: { type: 'boolean' },
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
    description: '原子更换单一角色的当前穿着，无需先准备衣柜。可用 mainItemId/配件 id 或准确名称引用既有衣物，也可在 main 与 accessories 直接建立并穿上新衣；scope=owned 收入衣柜，temporary 只存在当前穿着。mainItemId=0 是明确全裸，null 是衣着未记录。accessoryItemIds 覆盖整表，add/removeAccessoryItemIds 增量穿脱。wearState 只是 12 字内的动态状态标签。新建的 main 或 accessories 可带 maternity=true 表示特制孕妇用品（规则同 bsAddWardrobeItem）。',
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
            maternity: { type: 'boolean' },
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
              maternity: { type: 'boolean' },
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
      '更新单一角色的描述字段。normalDescription／pregnantDescription 都是以字段名为键的物件 {"字段名":"描述内容"}，只传本轮有变化或被点名待确认的字段，未传的字段保留原值。'
      + '字段名必须与 existing_state 该栏位已有的字段名一字不差；不存在的字段名会被略过并回报，其余字段照常更新。不能新增角色原本没有的字段（[pregnantDescription 初始化] 点名的空栏位除外）。'
      + '被 [descriptions 待确认] 点名的字段：有变化就写新内容，确认没变就原样照抄，系统会记为已确认。空字串视为不改。内容不要换行。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        options: {
          type: 'object',
          properties: {
            normalDescription: { type: 'object', additionalProperties: { type: 'string' }, description: '{"字段名":"描述内容"}，只传要更新或确认的字段。' },
            pregnantDescription: { type: 'object', additionalProperties: { type: 'string' }, description: '{"字段名":"描述内容"}，只在妊娠相关阶段使用。' },
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
    description: '记录单一角色的认知或更新长期关系/孩子。female、action、time 必填。cognition 需 method、content：记角色感知、猜测、被告知或检查解读，也记她对生殖、性与母职的心境转变（附 psychology），允许错误与矛盾，不执行检查、不改真实胎父/胎数/孕程。date/breakup/marry/divorce 需 partner，一次一人，不连带修改其他关系。child 只改名：需已存在的 childIndex（从0起）及 name。claim 记胎父认定：fetusIndex（胎儿，从0起，按当前可见顺序）或 childIndex（已出生的孩子）二择一，content 必填，用一句白描写角色认定孩子是谁的、为什么这样认定；若告诉了谁、对方相信、怀疑、否认还是认领，也写进这句，不必一定有告知对象。selectedFather 为她自己心里认定的父亲，可以是未注册人物，null 取消，省略保留；认定可以与真相不符。对外说法与心里认定不同时（谎称、隐瞒），selectedFather 仍记心里的认定，对外怎么说写进 content，例如「她心里认定是乙的，却对甲谎称是甲的」；心里认定改变（独自想通、起疑、改认）也用 claim 记，不改用 cognition。不改遗传父方，也不代表任何人知道真相。之后改认定或对方态度改变就再记一笔，不改旧纪录。各 action 参数互斥。认知纪录较多时只会送你最近几条、钉选的条目与一行更早纪录的摘要。认知实际进月经刷新，关系、孩子与胎父认定长期保留。系统结果不等于角色知情；尚未结算的操作不得预写亲历结果，下一轮依实际结果与剧情补记。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string', minLength: 1 },
        action: { type: 'string', enum: ['cognition', 'date', 'breakup', 'marry', 'divorce', 'child', 'claim'] },
        time: { type: 'string', minLength: 1 },
        method: { type: 'string', enum: ['perception', 'guess', 'informed', 'test', 'prenatal', 'experience'], description: 'perception 亲历或身体自觉；guess 猜测或自行推算；informed 被他人告知；test 借助检测手段（验孕棒、药草、占卜、魔法等，只用世界观里已有的手段）；prenatal 由专业者诊察（医师、产婆、祭司、治疗师等）；experience 让她心境改变的经历，不限于怀孕（性爱里的主导或被迫、看到别人的孩子、爱人的话、失去孩子的阴影），心理变化多半记在这里。不得引入世界观没有的器具。' },
        content: { type: 'string', minLength: 1 }, partner: { type: 'string', minLength: 1 },
        childIndex: { type: 'integer', minimum: 0 }, fetusIndex: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 1 },
        selectedFather: { type: ['string', 'null'], minLength: 1 },
        pin: { type: 'boolean', description: '只用于 cognition：之后每轮都该看到的重要认知传 true：确认或否认怀孕、得知胎数、性别、胎父、预产期、诊断与医嘱，或推翻她先前的重要信念。' },
        psychology: {
          type: 'object',
          description: '只用于 cognition，有繁育心理（psychology）时才给：这件事让她的心理怎么变，每轴给程度 slight／significant／severe 加 _increase／_decrease（约 2／5／10 点）。只能动当前这一侧：未孕 mastery、desire、autonomy，妊娠（含假孕、产兆、产程）confidence、acceptance、stance。acceptance 只看她想不想要这次怀孕；她和胎儿之间的亲近疏离用 bsFetalEvent 记，不是这一轴。同一轴同一个故事日只算一次。常见的起因：mastery 经期突然来潮手忙脚乱、学会记日子、被人教导；desire 被爱人说服、看到别人的孩子心动、流产或难产后的恐惧、被灌输受孕即救赎；autonomy 性爱里第一次主导、被强迫、成功拒绝、长期被支配；这类多用 method=experience。没有值得记下的经历就不要动心理，也不要为了调数值硬写认知。',
          properties: { mastery: { type: 'string', enum: [...FETAL_EVENT_CHANGES] }, desire: { type: 'string', enum: [...FETAL_EVENT_CHANGES] }, autonomy: { type: 'string', enum: [...FETAL_EVENT_CHANGES] }, confidence: { type: 'string', enum: [...FETAL_EVENT_CHANGES] }, acceptance: { type: 'string', enum: [...FETAL_EVENT_CHANGES] }, stance: { type: 'string', enum: [...FETAL_EVENT_CHANGES] } },
          additionalProperties: false,
        },
        prenatalCare: { type: 'string', enum: ['neglect', 'normal', 'attentive'], description: '只用于 cognition，她知道或相信自己怀孕后才给：之后整体怎么养胎（饮食、作息、休养、产检）。attentive 用心；normal 照常过日子；neglect 不在乎、排斥或顾不上（酗酒熬夜、拼命干活、想拿掉）。态度改变时随那条认知给，没变不重复给。镜头内具体的伤害与照料仍用 bsFetalEvent。' },
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
    name: 'bsAddSperm',
    description: '记录可受孕生殖道内的插入、精液沉积与拔出；口交、肛交、体外射精、手淫或单纯体表接触一律不要调用。戴套生殖道行为仍用本工具，hasCondom 决定本次 deposit 是否阻隔；省略沿用本次 insert 的设置，旧调用默认未戴套。'
      + 'action=insert／withdraw 时 amount=0；只有 insert 后才能以 action=deposit 沉积正数精液，沉积后若要再次射精须重新 insert。不同来源 insert 会直接交棒。'
      + 'amount 以人类精方 10-30 为准，按精方体型每级翻倍（体型 5 约 20-60、6 约 40-120、7 约 80-240、3 约 5-15、2 约 2.5-7.5），精方以变化态进行时按变化态的体型；残留每天自动衰减，人类女方每天 10、同样按女方体型每级翻倍，所以同体型的一次射精约 1-3 天内自然消失；剧情写得特别多或特别少时可以偏离。当下有效量越高，本次受孕越容易且高产物种的伴生卵可能越多，但受精成功不会扣除或清空可见残留。给过大的值会让正文连续多日描写残留。扣除/排出既有精液请用 bsDrainSperm。'
      + 'race 使用 [derivedType-装饰子项]race-装饰子项 格式，混血种族以 X 分隔；父系 derivedType 直接从这个字符串解析。'
      + 'male 是已注册精方或同名卵方（扶她）时，种族、血脉、衍生类型、体型与精子品质一律以档案为准，race 照填档案种族、maleBodySize 省略。'
      + 'insert 会按双方体型结算体型契合（只影响叙述，不限制交合与受孕），结果写在回传讯息与次级提示；体型参数见 maleBodySize、femaleAltForm、maleAltForm、sizeBridge。'
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
        maleBodySize: { type: 'number', description: '精方常态（人态）的个体体型，1–7 级（人类 4，可带小数，约 120 cm＝2.5、150 cm＝3.5、170 cm＝4、190 cm＝4.5、220 cm＝5、250 cm＝5.5、4 m＝6、6 m 以上＝7）。insert 时给出。精方是已注册角色时省略；种族为依个体（名单见追踪提示的 [体型参数] 段）或未收录的自订种族时必须按剧情填写，例如一人高的大蟑螂填 4；其余种族只在剧情写明对方比同族明显高大或矮小时填写。' },
        femaleAltForm: { type: 'boolean', description: '本次卵方以变化态进行（龙的真身、妖精以魔法变成人类大小、人鱼化出人腿等）；只有该种族有变化态、剧情确实变身时才为 true。insert 设置，deposit 沿用：射精当下的子宫容量按变化态体型算，变回常态后装不下的会在下次时间推进时流出。' },
        maleAltForm: { type: 'boolean', description: '本次精方以变化态进行，规则同 femaleAltForm。insert 设置，deposit 沿用：射精量与套子尺寸按变化态体型。' },
        sizeBridge: { type: 'boolean', description: '本次以魔法、变形等手段消弭双方体型差，视为恰好契合；比照 hasCondom，只有剧情确实使用、且世界观存在该手段时才为 true。insert 设置。' },
      },
      required: ['female', 'male', 'race', 'action', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsDrainSperm',
    description: '让角色主动排出体内部分或全部精液残留，按当前各来源比例一并减少。用于角色主动清洗、灌洗或使用道具排出。注意：受精是在每次时间推进时用当下仍存在的精液判定，清空后这次性交不再有受孕机会；清洗/沐浴若剧情支持体内冲洗可选用，不要求避孕意图，不自动联动臭意解除。排出不撤销已受精结果。amount 是绝对尝试量，不暗乘体型；品质 1 时等于实际排出量，品质高的精源浓稠难洗、品质低的更易排出，回覆会写体内还留多少。同一时刻无新沉积时，拆成多次调用与合计 amount 一次调用等效；不推进时间。',
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
      + 'stage 只接受这几个值：卵泡期、排卵期、黄体期、月经期、乏情期、产后恢复、假孕期；其他值（含妊娠阶段与回归期）一律拒绝，无法用本工具让角色怀孕或结束妊娠。'
      + '切到排卵期时会重新允许高潮排卵，切到黄体期时也会刷新一次；假孕期可留精但不会排卵或受孕。'
      + '乏情期是长周期物种月经后的静止期，不会自然排卵；只有子宫被灌满、且至少八成是异种精液时，高潮才会诱发排卵。物种没有乏情期时切过去会立刻进入卵泡期。'
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
      + '工具加入的是尚未着床的受精卵，可在同一着床窗口重复调用；第一颗会启动共用 fertilizationDays，之后由 bsPassedTime 推进并统一着床。孕早期且仍在异期复孕窗口时也可追加，此时新胎同时标记代孕与异期复孕；其余妊娠阶段不可加入。自然受孕请勿使用本工具。'
      + 'hostFetusIndex（从 0 起，按当前可见顺序）只在剧情明确写到把胚胎放进腹中某一胎体内时才给（例如炉蚜把自己的受精卵嵌进代孕胎儿）：胚胎成为那一胎的孕中孕，那一胎就是它的母亲；同样只限孕早期的异期复孕窗口，宿主须是胎生、胎转卵生或不定型。这时 provider 可以是承载者自己（她自己的胚胎，出生后留在她名下）。一般代孕不给这个参数。',
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
        hostFetusIndex: { type: 'integer', minimum: 0, description: '把胚胎植入腹中第几胎体内（从 0 起，按当前可见顺序）；只在剧情明确写到放进胎儿体内时给。' },
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
      + '\n呼叫条件：承载者必须处于月经阶段（卵泡期/排卵期/黄体期/月经期/乏情期）或无经期；她自己正在别人体内、或已在回归期时不可呼叫。'
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
      + 'push／rest：产妇自己用力推或停下来喘口气，产程中（第一产程、第二产程、第三产程娩出胎盘时）有效，不必给 fetusIndex，也不能由胎儿代劳。切换后一直维持到下次切换，剧情写到她停下来歇一下时给 rest，用力时给 push，切换要排在这段时间的 bsPassedTime 之前；胎体下降开始时预设推，其余阶段预设休。推的时候累积用力疲劳，胎越大越累得快，疲劳越高越推不动，休息时才会消退，换阶段不归零。第二产程下降与娩出时休息几乎不前进；第三产程用力让胎盘快一倍娩出；第一产程与间歇期用力是白费力气，只累积疲劳，只在剧情写到她提早用力时才给。系统不替她扣活力，用力时照剧情用 bsUpdateCharacterStatus 自己扣 vitality。'
      + 'sibling：腹中两胎互动，只在剧情明确写到时用：fetusIndex 是动手的那一胎，otherFetusIndex 是被动的那一胎（省略时取它旁边的一胎；两个都省略时随机一对相邻的胎儿），'
      + 'interaction=kick 踢一下（对方小幅偏转）、shove 推挤（两胎可能左右换位）、cuddle 依偎（位置不变）。只改胎位，不改亲和与健康，不消耗母体活力；只限角色已知、已着床、彼此相邻的胎儿；每个故事小时最多成功一次，推进满下一小时之前重复调用会被跳过。'
      + '所有操作都会带来瞬时的疼痛（产程中）或心理压力（孕期），描写不得超过系统给出的疼痛等级。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        action: { type: 'string', enum: ['rotate', 'lift', 'descend', 'rupture', 'extract', 'push', 'rest', 'sibling'] },
        fetusIndex: { type: 'integer' },
        otherFetusIndex: { type: 'integer' },
        interaction: { type: 'string', enum: ['kick', 'shove', 'cuddle'] },
        targetAngle: { type: 'number' },
        backSide: { type: 'string', enum: ['左前', '右前', '左后', '右后'] },
        actor: { type: 'string', enum: ['assist', 'fetus'] },
      },
      required: ['female', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'bsFetalEvent',
    description: '记一件剧情明确写到、影响腹中胎儿的事，一次一件；吃、睡、排泄等需求照料系统已自动计入，不要记。'
      + 'kind——亲和：bonding 亲近（抚摸、哼歌、说话、胎教，胎儿回应或安静下来）、estrangement 疏离（母体排斥、拒绝这一胎，或胎儿对她排斥、不安乱动；安抚不了照剧情记疏离或不记）；'
      + '伤害：substance 酒、药物、毒，trauma 腹部外伤，overexertion 过劳或剧烈运动，illness 生病，curse 诅咒或腐化，other_harm 其他；'
      + '照料：medicine 安胎药或补品，checkup 产检治疗，rest 休养，blessing 祝福或治疗魔法，other_care 其他。'
      + 'change 只看程度 slight／significant／severe，方向由 kind 决定（increase、decrease 都可）。毒物、生病、诅咒孕早期最重；外伤、过劳孕晚期最重，另加宫压。'
      + '程度按母胎双方的种族与世界设定判断，不按人类常识：对该族无害的不记（矮人照常豪饮、火系胎儿不怕高温），格外致命的加重（魔族遇圣水、狼人遇银）。'
      + 'fetusIndex 按可见的 fetuses 从 0 起算；省略时伤害与照料作用于全部胎儿，亲和作用于随机一胎。角色不知道自己怀孕也照样结算。'
      + '同一天同一 kind 只结算一次；亲和与照料 7 天内重复会递减，每胎每天亲和最多 ±2、照料最多 +10。'
      + 'time 为故事日期；content 一句白描，例如「她不知道自己怀孕，在酒馆喝了半夜」；pin=true 用于之后每轮都该看到的大事（中了诅咒、确诊重病）。',
    input_schema: {
      type: 'object',
      properties: {
        female: { type: 'string' },
        time: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: Object.keys(FETAL_EVENT_KINDS) },
        change: { type: 'string', enum: [...FETAL_EVENT_CHANGES] },
        fetusIndex: { type: 'integer', minimum: 0 },
        content: { type: 'string', minLength: 1 },
        pin: { type: 'boolean' },
      },
      required: ['female', 'time', 'kind', 'change', 'content'],
      additionalProperties: false,
    },
  },
]);

// ── 原生工具调用：检查清单 ─────────────────────────────

/** 提交逐角色检查清单（原本的 character_checks）的工具；不派发给工具层 */
export const CHARACTER_CHECKS_TOOL_NAME = 'bsReportCharacterChecks';

export const CHARACTER_CHECKS_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: CHARACTER_CHECKS_TOOL_NAME,
    description: '提交本轮的逐角色检查清单：对 tracked_females 中每名角色恰好写一笔检查结论。只记录结论，不改变任何状态；真正的更新仍要用其他工具。每轮最后调用一次。',
    parameters: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              female: { type: 'string' },
              status: { type: 'string', enum: ['no_change', 'updated', 'present', 'offscreen'] },
            },
            required: ['female', 'status'],
          },
        },
      },
      required: ['checks'],
    },
  },
});

/** 接在系统提示词末尾：系统提示词可由使用者自订，里面写的仍是文本 JSON 的输出格式，这里说明本轮改用工具调用 */
export function buildNativeToolInstruction() {
  return [
    '[本轮输出方式：工具调用]',
    '- 本轮的可用工具已通过请求的 tools 参数提供（即上文所说的 available_tools），请直接用工具调用完成更新，不要在正文里输出 JSON。',
    '- 这是唯一的一次回复：你不会收到任何工具结果，也没有下一轮。必须在这一次回复里同时发出本轮全部的工具调用，不要只调用一个就停下等结果。',
    '- 可以同时调用多个工具，同一个工具也可以调用多次；调用的先后顺序就是执行顺序（例如先调用 bsPassedTime）。',
    `- 在同一次回复的最后调用一次 ${CHARACTER_CHECKS_TOOL_NAME}，提交上文所说的 character_checks；它表示本轮的调用已经全部发出。`,
    `- 没有任何状态需要更新时，只调用 ${CHARACTER_CHECKS_TOOL_NAME}。`,
  ].join('\n');
}

// ── 原生工具调用：备装与起始着衣的提交工具 ─────────────

export const WARDROBE_PREP_TOOL_NAME = 'bsSubmitWardrobePrep';
export const STARTING_OUTFIT_TOOL_NAME = 'bsSubmitStartingOutfit';

function findToolSchema(toolDefinitions, name) {
  const tool = (Array.isArray(toolDefinitions) ? toolDefinitions : []).find((entry) => entry?.name === name);
  const schema = tool?.input_schema;
  return schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : null;
}

/** 备装的提交工具：参数就是文本协议的 { items, remove }，衣物结构取自 bsAddWardrobeItem，丢弃的 id 取自 bsRemoveWardrobeItem */
export function buildWardrobePrepSubmitTool(toolDefinitions) {
  const item = findToolSchema(toolDefinitions, 'bsAddWardrobeItem')?.properties?.item;
  const itemId = findToolSchema(toolDefinitions, 'bsRemoveWardrobeItem')?.properties?.itemId;
  if (!item || !itemId) return null;
  return {
    name: WARDROBE_PREP_TOOL_NAME,
    description: '提交本次备装结果，只调用一次。items 是要新增或更新的衣物；remove 是要丢掉的既有衣物 id 与原因。没有要新增或丢掉的就给空数组。',
    parameters: {
      type: 'object',
      properties: {
        items: { type: 'array', items: item },
        remove: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: itemId, reason: { type: 'string' } },
            required: ['id', 'reason'],
            additionalProperties: false,
          },
        },
      },
      required: ['items', 'remove'],
      additionalProperties: false,
    },
  };
}

/** 起始着衣的提交工具：参数就是文本协议的 { currentOutfit }，main 与 accessories 的结构取自 bsChangeOutfit */
export function buildStartingOutfitSubmitTool(toolDefinitions) {
  const outfit = findToolSchema(toolDefinitions, 'bsChangeOutfit')?.properties;
  if (!outfit?.main || !outfit?.accessories) return null;
  return {
    name: STARTING_OUTFIT_TOOL_NAME,
    description: '提交这名角色此刻的起始着衣，只调用一次。nude=true 表示全裸，此时不给 main 与 accessories。',
    parameters: {
      type: 'object',
      properties: {
        currentOutfit: {
          type: 'object',
          properties: {
            nude: { type: 'boolean' },
            main: outfit.main,
            accessories: outfit.accessories,
            wearState: outfit.wearState || { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['currentOutfit'],
      additionalProperties: false,
    },
  };
}

/** 接在提交类流程的系统提示词末尾：系统提示词仍要求输出 JSON，这里说明改由工具参数交这份 JSON */
export function buildSubmitToolInstruction(name) {
  return [
    '[本次输出方式：工具调用]',
    `- 调用一次 ${name} 提交结果：它的参数就是上文要求输出的那份 JSON（结构、字段与取值规则都照上文），不要在正文里输出 JSON。`,
    '- 这是唯一的一次回复，不会收到工具结果，也没有下一轮：整份结果在这一次调用里交完。',
  ].join('\n');
}
