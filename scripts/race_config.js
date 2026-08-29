export const VIVIPAROUS_RACES = Object.freeze([
  "人类",
  "精灵",
  "兽耳族",
  "袋兽族",
  "哥布林",
  "兽人",
  "矮人",
  "半身人",
  "半人马",
  "巨人",
  "魅魔",
  "雪族",
  "夜叉",
  "妖狐",
  "貓又",
  "月兔族",
  "杜拉罕"
]);

export const OVIPAROUS_RACES = Object.freeze([
  "鸟人",
  "植物亚人",
  "社会虫族",
  "蜥蜴人",
  "触手怪",
  "妖精",
  "真菌亚人",
  "海蛞蝓族",
  "龟族",
  "甲壳族",
  "宝箱怪",
  "阿拉克涅",
  "百足姬",
  "天狗",
  "深潜者",
  "狗头人"
]);

export const OVOVIVIPAROUS_RACES = Object.freeze([
  "人鱼",
  "鱼人",
  "海妖",
  "独居虫族",
  "蛇人",
  "蛙人",
  "眼魔",
  "水母族",
  "海龙人",
  "河童",
  "梅杜莎"
]);

export const METOVIVIPAROUS_RACES = Object.freeze([
  "龙族",
  "狮鹫族",
  "天使",
  "恶魔",
  "奇美拉",
  "麒麟",
  "凤凰",
  "白泽",
  "独角兽",
  "空鲸",
  "修格斯"
]);

export const AMORPHOUS_RACES = Object.freeze([
  "史萊姆",
  "石像鬼",
  "烛灵",
  "人偶",
  "心魇",
  "宝石人",
  "奈米丛族",
  "元素灵",
  "灯神",
  "影魔",
  "活体铠甲",
  "伪人"
]);

export const ALL_BUILTIN_RACES = Object.freeze([
  ...VIVIPAROUS_RACES,
  ...OVIPAROUS_RACES,
  ...OVOVIVIPAROUS_RACES,
  ...METOVIVIPAROUS_RACES,
  ...AMORPHOUS_RACES,
]);

export const RACE_INTRODUCTION_LINES = Object.freeze(Object.assign(
  // 未列出的种族留空，提示词会自动略过该行
  Object.fromEntries(ALL_BUILTIN_RACES.map((race) => [race, ""])),
  {
    "精灵": "Elf，长寿的尖耳亚人，面容姣好、擅长魔法；肤色深青的亚种称黑暗精灵（卓尔）。",
    "兽耳族": "Kemonomimi／Beastfolk，保有人形、带兽耳兽尾的亚人；日系兽娘与西方 furry 皆归此类。",
    "袋兽族": "Marsupial-folk，有袋目亚人。幼体极早产出后转入育儿袋，因此承载耐受极低。",
    "哥布林": "Goblin，西幻小型怪物，繁殖力旺盛且几乎只诞下雄性；少数雌性个体存在。",
    "兽人": "即 Orc（绿皮），高大粗野的战斗种族；与「兽耳族」无关，勿混用。",
    "矮人": "Dwarf，居于矿山、擅长锻造的短躯亚人。",
    "半身人": "Halfling，又称哈比人，身形矮小的和平亚人。",
    "半人马": "Centaur，上身为人、下身为马的亚人，源自希腊神话。",
    "巨人": "Giant，体型远超人类的种族；巨魔、山怪、独眼巨人、泰坦皆归此类。",
    "魅魔": "Succubus／Incubus，性欲特化的恶魔系亚人，与恶魔已分家；男性的梦魔同属此类。",
    "雪族": "Yuki-onna／Yeti，雪女与雪怪的复合群体，栖于严寒。",
    "夜叉": "Yaksha／Oni，头生角的日系鬼族，罗刹与阿修罗皆归此类。",
    "妖狐": "Kitsune，祖先为兽耳族，沾妖后独立演化的狐系妖族，修行增尾；未沾妖的兽耳狐娘应写作兽耳族-狐。",
    "貓又": "Nekomata，祖先为兽耳族，沾妖后独立演化的猫系妖族，久养成妖、尾端分岔；未沾妖的兽耳猫娘应写作兽耳族-猫。",
    "鸟人": "Harpy，典型形象为哈比，带翼的鸟类亚人；现代创作已性别比正常化。",
    "植物亚人": "Dryad／Plant-folk，植物拟人，具自花授粉特性；亦可作为纯粹的播种方怪物。",
    "社会虫族": "Eusocial Insectfolk，蜜蜂与蚂蚁一类的真社会性虫族，以雌性为绝对多数。",
    "蜥蜴人": "Lizardfolk，又称亚龙人的鳞甲亚人；设定上从部落怪物到与人平起平坐皆有。",
    "触手怪": "Tentacle Monster，成群触手构成的无性种族，繁殖上通常作为播种方。",
    "妖精": "fairy，娇小带翅的精怪；与长身尖耳的「精灵」不同。",
    "真菌亚人": "Myconid，菌类拟人，具自体授粉特性；亦可作为纯粹的播种方怪物。",
    "海蛞蝓族": "Sea Slug-folk，海兔拟人，雌雄同体；交配方式奇特（交配列车、阴茎击剑）。",
    "龟族": "Turtle-folk，龟类拟人，长寿而孕期极长。",
    "甲壳族": "Crustacean-folk，蟹虾一类的甲壳拟人；亦可作为纯粹的播种方怪物。",
    "宝箱怪": "Mimic，宝箱拟态怪，雌雄同体；所产之卵呈金币状。",
    "阿拉克涅": "Arachne，上身为人、下身为蜘蛛的亚人，源自希腊神话。",
    "百足姬": "Centipede-folk，上身为人、下身为蜈蚣的亚人，雅称天龙；可视为蜈蚣版的阿拉克涅。",
    "天狗": "Tengu，日系妖怪，形象有鸦、狼、长鼻数种；族群政治性强。",
    "深潜者": "Deep One，源自克苏鲁的海系异种，潜伏于人类社会；胚胎类型刻意与其他海系亚人不同。",
    "人鱼": "Mermaid，以鱼尾替代双足的美人鱼；可借魔法置换双足上陆。",
    "鱼人": "Fishfolk，人形而带鱼类特徵与粗尾鳍，可视为海中的精灵——孕期长、产子少。萨尔达的佐拉族属此。",
    "海妖": "Scylla，章鱼乌贼一类，以触腕替代双足；无须变形即可上陆。",
    "独居虫族": "Solitary Insectfolk，与社会虫族相对的独居性虫族；蛾、螳螂等拟人归此，部分会将卵寄入异族代孕孵化。",
    "蛇人": "Lamia，上身为人、下身为蛇的亚人，形象参考拉米亚。",
    "蛙人": "Frogfolk，蛙类拟人，出生时性别由外在环境决定，故不适用固定男女比；亦可作为纯粹的播种方怪物。",
    "眼魔": "Beholder，引用 D&D 的眼球暴君，经拟人化后的形象。",
    "水母族": "Jellyfish-folk，水母拟人，幼体（水螅体）与成体（水母体）形态差异极大。",
    "海龙人": "Seahorse-folk，外形似龙、本质为海马的海系亚人，属雄性孕育系。",
    "河童": "Kappa，头顶盛水皿的日系妖怪，蛙人的妖系分支。",
    "龙族": "Dragon，可在人态与完全态之间自由转换的上位生物，孕期极长。",
    "狮鹫族": "Griffin，鹰首狮身的上位幻兽，可在人态与完全态之间转换。",
    "天使": "Angel，天界种族，以「天使之卵」孕育。",
    "恶魔": "Demon，魔界种族，以「恶魔之卵」孕育；与已分家的魅魔不同。",
    "奇美拉": "Chimera，合成兽。胎转卵生的过程可在孕育期平衡混杂血脉的冲突。",
    "麒麟": "Qilin，东方上位神兽，汲取环境灵气孕育，自身承载耐受偏低；可拟人化。",
    "凤凰": "Phoenix，东方上位神兽，浴火重生，汲取环境灵气孕育；可拟人化。",
    "白泽": "Bai Ze，东方上位神兽，通晓万物，汲取环境灵气孕育；承载耐受为神兽中最低。",
    "独角兽": "Unicorn，额生独角的上位幻兽，可在人态与完全态之间转换。",
    "空鲸": "Sky Whale，翱翔天际的巨鲸，可在常态人形与巨态鱼形间切换（鲲鹏之属），孕期为全表最长。",
    "史萊姆": "Slime，繁殖策略极多样：可无性分裂，可孕育任何种族之胎，亦可寄入异族子宫。",
    "石像鬼": "Gargoyle，人类造物之一，石质无性种族；受精难度极高，繁殖基本限于同族。",
    "烛灵": "Candle Spirit，人类造物之一，烛火所寄的无性种族；受精难度极高，繁殖基本限于同族。",
    "人偶": "Living Doll，人类造物之一，得灵的人偶，无性；受精难度极高，繁殖基本限于同族。",
    "心魇": "Kaijin，由人心中的黑暗诞生的怪人（魔法少女题材），亦会对人类播种。",
    "宝石人": "Gem-folk，矿物构成的种族，可参考宝石之国一类的设定。",
    "奈米丛族": "Nanite Swarm，由亿级奈米机械单元构成的液态金属体。",
    "元素灵": "Elemental，自然元素的拟人体，如水元素温蒂妮。",
    "灯神": "Djinn，阿拉丁神灯一类的愿望精灵。",
    "影魔": "Shadow-folk，可在平面与立体之间切换、投影于影中的种族。",
    "月兔族": "Moon Rabbit，居于月球的兔系亚人；繁殖力为胎生种族之最，族中多为雌性。",
    "狗头人": "Kobold，与哥布林同生态位的小型犬首亚人；却如鸭嘴兽般产卵，分娩负担远低于哥布林。",
    "梅杜莎": "Medusa，蛇人沾妖后独立演化的分支，发为群蛇；比蛇人更难受孕、孕期更长。",
    "修格斯": "Shoggoth，形似史莱姆却更为古老的太古存在，承载力极强而极难受孕。",
    "活体铠甲": "Living Armor，寄生型无性种族，附着于冒险者身上；将卵寄入宿主体内孵化，不自行孕育。",
    "伪人": "Doppelganger，模仿并取代人类的不定型种族；各项生理刻意贴近人类，同卵分裂倾向极高。",
    "杜拉罕": "Dullahan，可将头颅离体持握的亚人，青春期后头颅方与躯干分离，颈上或燃着无实体的火焰；躯体不依赖头颅运作，承载力极强。爱尔兰原典近于妖精，奇幻创作多作不死——取后者写作 [不死]杜拉罕。",
  },
));
export const RACE_INTRODUCTION_FIELD = "introductionLine";

export const DERIVED_TYPE_RACES = Object.freeze([
  "修炼",
  "魔导",
  "妖怪",
  "神祇",
  "不死",
  "血族",
  "星际",
  "机械",
  "器灵",
  "变异",
  "序列"
]);

export const DERIVED_TYPE_INTRODUCTION_LINES = Object.freeze({
  "修炼": "Cultivator，东方修仙体系；吸收天地灵气、化为自身超凡力量的个体。",
  "魔导": "Magus，西方魔法体系：以魔力与术式为根基；巫师血脉、猎魔士与法师皆归此类，不限性别。",
  "妖怪": "Youkai，由执念生智、汲取世人畏惧与认知而存在的异类，遵循自身的怪谈规则。",
  "神祇": "Deity，受凡人祈求与香火供奉而维持神格的存在，具明确神职领域。",
  "不死": "Undead，以死气驱动躯壳的亡者，保留生前记忆但情感淡漠。",
  "血族": "Vampire，以血为食的优雅掠食者，畏光。",
  "星际": "Xeno，具蜂群思维或高维精神体特质的星际物种，与母体网路心灵共鸣。",
  "机械": "Android，以核心能源与算力驱动的机械体，具拟似人格。",
  "器灵": "Artifact Spirit，器物生智而成的灵体，与持有者共鸣。",
  "变异": "Mutant，基因突变而获得超自然能力的个体。",
  "序列": "ABO，具 Alpha／Omega 等序列阶级与信息素本能的个体。",
});

export const DERIVED_TYPE_INHERITANCE_PROFILES = Object.freeze({
  "修炼": Object.freeze({
    inheritanceSpeed: 0.75
  }),
  "魔导": Object.freeze({
    inheritanceSpeed: 1.0
  }),
  "妖怪": Object.freeze({
    inheritanceSpeed: 1.25
  }),
  "神祇": Object.freeze({
    inheritanceSpeed: 0.33
  }),
  "不死": Object.freeze({
    inheritanceSpeed: 2.0
  }),
  "血族": Object.freeze({
    inheritanceSpeed: 1.66
  }),
  "星际": Object.freeze({
    inheritanceSpeed: 1.5
  }),
  "机械": Object.freeze({
    inheritanceSpeed: 0.5
  }),
  "器灵": Object.freeze({
    inheritanceSpeed: 0.66
  }),
  "变异": Object.freeze({
    inheritanceSpeed: 1.33
  }),
  "序列": Object.freeze({
    inheritanceSpeed: 1.0
  })
});

export const DERIVED_TYPE_FLUX_PROFILES = Object.freeze({
  "修炼": Object.freeze({
    fluxName: "炁",
    fluxDefinition: "个体吸收天地灵气转化为自身的超凡生命能量。\n[平衡] 气息绵长，身心空灵，能完美掌控超凡能力，与自然环境共鸣。\n[正极] 表现为‘走火入魔’：生理上经脉胀痛欲裂、体表溢出肉眼可见的能量狂潮甚至七窍流血；心理上狂躁易怒、心魔幻象丛生，容易失去理智进行无差别破坏。\n[负极] 表现为‘散功衰败’：生理上经脉萎缩闭塞、肉身加速衰老、畏寒骨痛；心理上神识昏沉、感知迟钝，完全无法调动任何术法，甚至退化为凡人状态。",
  }),
  "魔导": Object.freeze({
    fluxName: "魔力",
    fluxDefinition: "体内蓄积并循环的魔力总量与操控余裕，是施术与维持术式的基础。\n[平衡] 魔力循环平顺，能稳定维持术式与结界，咏唱精准；对魔力波动的感知敏锐，研究与日常生活兼顾。\n[正极] 表现为‘魔力暴走’：生理上魔纹自体表浮现并发烫、魔力外泄扭曲周遭（灯火自燃、物件浮空、气温骤降），指尖不受控地放电；心理上被求知欲与万能感吞噬，无视代价推进禁忌术式，对旁人的劝阻显出居高临下的不耐。\n[负极] 表现为‘魔力枯竭’：生理上失温畏寒、指节僵冷、咏唱中断，连最基础的术式都点不燃，伴随剧烈偏头痛与耳鸣；心理上陷入‘不再是魔法师’的存在危机，回避同行，藏起法杖与魔导书。",
  }),
  "妖怪": Object.freeze({
    fluxName: "妖力",
    fluxDefinition: "由执念生智并汲取世人‘畏惧与认知’而存在的异类法则，与常理相悖。\n[平衡] 具备独特的人格与癖好，能披着人皮或化为人形在现世中游荡，既保留异类的诡谲，又沾染着人世的烟火气，行为遵循自身的‘专属怪谈规则’。\n[正极] 表现为‘大妖/神隐’(不入世)：生理上彻底褪去人形，显露出庞大或恐怖的本体（或化为纯粹的自然现象/概念），周围常理被扭曲（如重力失效、时间错乱）；心理上视角拔高至‘非人’，彻底失去对人类的共情与兴趣，逻辑变得古老、傲慢且无法沟通，随时准备脱离现世前往彼岸。\n[负极] 表现为‘物化/归寂’(被世界吞噬)：生理上身躯逐渐变得半透明或边缘破碎，不可逆地退化回未开智的本源状态（如变回一只普通的野狐、一把破伞、一阵无形的风）；心理上陷入强烈的存在危机与迷茫，逐渐遗忘自己的名字与记忆，语言能力退化，充满即将被世界规则‘抹消’的无力感与恐惧。"
  }),
  "神祇": Object.freeze({
    fluxName: "信仰",
    fluxDefinition: "源自凡人祈求、敬畏与香火供奉的概念集合体，是维持神力与神格的基石。\n[平衡] 威严且从容，具备明确的神职领域（如丰收、战争），能轻易展现与自身领域相关的神迹，对凡人抱持着宏观的慈悲或理性的管理者姿态。\n[正极] 表现为‘神格吞噬’：生理上神光刺眼夺目，周身充斥着令人无法直视的极端威压，随口一言皆成法则；心理上‘神性’彻底压倒‘人性’，自我意识被狂热信徒的‘期望’所绑架，成为冰冷、绝对且不知变通的‘概念机器’（例如正义之神变得为了惩罚罪恶而无差别屠戮），失去个人情感与私心。\n[负极] 表现为‘堕落/坠星’：生理上神环破碎、神力枯竭，肉身变得如同凡人般脆弱、会生病受伤流血，甚至衣衫褴褛如流浪者；心理上承受着被世人遗忘的巨大孤独与恐慌，从云端跌落后‘人性’剧烈反弹，变得极度渴望被关注、情绪化、甚至会为了一点点微小的供奉或陪伴而对凡人展现出卑微与依赖。"
  }),
  "不死": Object.freeze({
    fluxName: "死气",
    fluxDefinition:"维持亡者驱壳活动的负面能量，与生前记忆形成互斥。\n[平衡] 气息阴冷，行动安静隐密，展现出无机质的冰冷理智，保留基础认知但情感淡漠。\n[正极] 表现为‘腐败暴走’：生理上死气不受控地四溢，导致周遭环境枯萎、物质腐化，肉体呈现骇人的非人扭曲；心理上彻底丧失理智与人性，被纯粹的破坏欲、饥饿或生前执念的阴暗面支配，如同狂暴的野兽。\n[负极] 表现为‘回光残影’：生理上失去驱动力，肢体僵硬迟缓、甚至面临形体崩解消散的危机；心理上却因死气退散而迎来‘人性觉醒’，清晰忆起生前的情感与记忆，表现出极度的哀伤、温柔或懊悔，语气变得极具人情味。"
  }),
  "血族": Object.freeze({
    fluxName: "血欲",
    fluxDefinition: "驱动吸血种族生理机能的血液渴求度，与理智防线呈反比。\n[平衡] 举止优雅从容，具备完美的掠食者隐蔽性，能冷静克制本能，展现出高智商与绝对的自控力。\n[正极] 表现为‘渴血戒断’：生理上肉体呈现病态的干瘪虚弱、畏光加剧、犬齿不受控地暴突、对血液气味极度敏感；心理上备受饥饿折磨，理智濒临崩溃，会展现出焦躁、卑微乞求或不择手段的疯狂索求姿态。\n[负极] 表现为‘醉血迷离’：生理上面色异常红润、体温微升、感官迟钝，步态与动作如同微醺般慵懒松懈；心理上处于极度满足的‘嗑嗨’状态，情绪异常高昂或多话，彻底丧失防御心与优雅包袱，容易做出轻浮、傲慢或过度亲昵的越界行为。"
  }),
  "星际": Object.freeze({
    fluxName: "连结力",
    fluxDefinition: "维持星际物种（如蜂群思维、高维精神体）与母体网路或同族间的心灵共鸣度。\n[平衡] 具备独立思考能力但情绪稳定，能流畅地与周遭环境或同伴进行无声的意识交流，展现出高度的共情与超然的理性。\n[正极] 表现为‘群体覆写’：生理上瞳孔失焦或发出异光，说话时不自觉使用‘我们’而非‘我’，动作展现出诡异的绝对精准与同步率；心理上‘自我’边界消融，被庞大的群体意识强制接管，失去个人情感与道德观，会为了‘集体利益’做出绝对冷酷的决策，甚至试图强行同化他人。\n[负极] 表现为‘虚空孤绝’：生理上出现强烈的幻痛与感官剥夺感，肢体不自觉地颤抖、蜷缩，极度渴望物理层面的接触与拥抱；心理上陷入深渊般的绝对孤独与恐慌（类似重度社交剥夺），会像溺水者般疯狂黏着身边任何具备意识的个体，将其视为‘代偿网路’，展现出极度脆弱与依赖的幼态行为。"
  }),
  "机械": Object.freeze({
    fluxName: "负载",
    fluxDefinition: "驱动机械体运作的核心能源输出与算力占用率。\n[平衡] 系统运行流畅，散热稳定。动作精准无多余消耗，语音模组与情感模拟器（人格）正常运作，展现出高度理智与最佳化的执行效率。\n[正极/负载超频] 表现为‘超载暴走’：生理上核心温度飙升，机体各处喷射蒸气、火花或发出红色警报光，无顾忌地发挥撕裂自身零件的恐怖破坏力；心理上‘安全限制器’解除，算力全部集中于单一目标（如‘排除敌人’），强制关闭情感与痛觉模组，语音变得充满杂音、卡顿、疯狂重复战术指令，呈现出冷酷且毁灭性的纯粹机器特质。\n[负极/负载过低] 表现为‘节能休眠’：生理上动力流失，关节伺服马达变得迟缓沉重，光学感测器（眼睛）闪烁变暗，各种武装与外挂机能强制下线；心理上为了节省算力，会主动剥离‘拟似人格’与‘幽默感’，说话变得毫无起伏的电子合成音，甚至出现断片与逻辑运算超时的现象，带着一种即将被关机（死亡）的平静与机械式的不安。"
  }),
  "器灵": Object.freeze({
    fluxName: "共鸣",
    fluxDefinition: "器物生智后与持有者（宿主）之间的灵魂/意识同步率。\n[平衡] 人器合一。器灵能维持稳定的灵体显现，与持有者心意相通，战斗时如臂使指，能像默契极佳的搭档般流畅对话与协同作战。\n[正极] 表现为‘反噬/夺舍’：生理上器物本体爆发出刺眼光芒或凶气，甚至强行操控持有者的肢体（如眼睛变色、动作生硬却爆发力极强）；心理上器灵的意识（原初的杀戮欲、傲慢或执念）完全压过持有者，喧宾夺主，将持有者视为单纯的‘供能电池’或‘剑鞘’，语气变得狂妄、极具支配欲。\n[负极] 表现为‘灵寂/蒙尘’：生理上器物本体变得黯淡无光、沉重、甚至出现锈迹或裂痕，器灵的投影变得半透明、闪烁不定直至无法维持身形；心理上器灵失去感知外界与沟通的能力，陷入深沉的沉睡或被抛弃的无力感中，退化为一把‘凡铁’，只剩下微弱的本能悲鸣。"
  }),
  "变异": Object.freeze({
    fluxName: "异能",
    fluxDefinition: "基因突变所产生的超自然能力输出频率。\n[平衡] 异能如同呼吸与肌肉般自然运作，能完美控制力道，将能力无缝融入日常生理活动与战斗中，身心协调无负担。\n[正极] 表现为‘基因失控’：生理上异能特征以极具侵略性的方式外显（如体表长出结晶、自燃、周遭重力异常），肉体承受着被自身力量撕裂的痛苦；心理上被能力的‘属性本能’反向支配（例如火系变得狂躁暴戾、精神系变得神经质且多疑），理智断线，充满无差别的破坏欲，无法停止力量的宣泄。\n[负极] 表现为‘感官失能’：生理上如同突然失去了一条重要的肢体（幻肢痛），出现严重的平衡感丧失、动作笨拙、神经抽搐与极度虚弱；心理上陷入强烈的困惑、自我怀疑与恐慌，因为原本依赖的‘第六感（异能）’被剥夺，对世界感到极度陌生与毫无安全感，表现出防御性极强的暴躁或严重的退缩。"
  }),
  "序列": Object.freeze({
    fluxName: "信息素",
    fluxDefinition: "决定序列阶级（如Alpha/Omega）与生物本能的化学贺尔蒙浓度。\n[平衡] 气味收敛且稳定，能维持完美的社会化面具，理性完全掌控兽性本能，情绪平稳且具备清晰的社交边界感。\n[正极] 表现为‘发情/易感’：生理上体温飙高如同重病，腺体不受控地释放极具侵略性或诱惑性的浓烈气味，对触碰与气味极度敏感，甚至伴随领地意识的生理性低吼；心理上理智被繁衍、占有或臣服的兽性本能彻底摧毁，丧失所有社会化禁忌，展现出极端的偏执、占有欲或不顾一切的渴求，眼中只剩下‘目标’。\n[负极] 表现为‘群体排斥’：生理上腺体干瘪疼痛，短暂失去嗅觉（无法感知他人气味），并伴随畏寒与强烈的反胃感；心理上触发‘被族群抛弃的孤狼’的远古恐惧，陷入极度的自卑、抑郁与被剥夺感，觉得自己散发着腐败或令人作呕的气息，会主动躲避人群、抗拒社交，对任何轻微的拒绝都会产生过激的悲观反应。"
  })
});

export const DERIVED_TYPE_METABOLISM_EXEMPTIONS = Object.freeze({
  "血族": Object.freeze(["hunger", "excretion", "odor"]),
  "不死": Object.freeze(["odor", "sleep", "milk"]),
  "修炼": Object.freeze(["hunger", "excretion", "companionship"]),
  "魔导": Object.freeze(["sleep", "companionship", "odor"]),
  "妖怪": Object.freeze(["hunger", "excretion", "sleep"]),
  "神祇": Object.freeze(["hunger", "sleep", "companionship"]),
  "机械": Object.freeze(["hunger", "milk", "companionship"]),
  "器灵": Object.freeze(["hunger", "milk", "sleep"]),
  "星际": Object.freeze(["sleep", "milk", "companionship"]),
  "变异": Object.freeze(["sleep", "hunger", "odor"]),
  "序列": Object.freeze(["sleep", "odor", "companionship"]),
});

export const RACE_PHYSIOLOGY_PROFILES = Object.freeze({
  "人类": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "精灵": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 0.8,
    "breedTolerance": 0.33,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 45
  },
  "兽耳族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.8,
    "breedTolerance": 3,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 45,
    "genderRatio": 50
  },
  "袋兽族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 5,
    "birthDifficulty": 0.3,
    "breedTolerance": 0.01,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "哥布林": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.2,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 40,
    "genderRatio": 95
  },
  "兽人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 50,
    "genderRatio": 75
  },
  "矮人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 60
  },
  "半身人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 30,
    "genderRatio": 50
  },
  "魅魔": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 0.5,
    "breedTolerance": 3,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "半人马": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 66
  },
  "巨人": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 3,
    "breedTolerance": 1,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "雪族": {
    "menstrualLengthRatio": 1.25,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 0.75,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 40
  },
  "夜叉": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 4,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 50,
    "genderRatio": 50
  },
  "妖狐": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "貓又": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "鸟人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 0.33,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "植物亚人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 5,
    "genderRatio": null
  },
  "真菌亚人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 5,
    "genderRatio": null
  },
  "社会虫族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.2,
    "breedTolerance": 4,
    "impregnationDifficulty": 0.2,
    "orgasmOvulationAmount": 8,
    "identicalProbability": 0,
    "genderRatio": 10
  },
  "触手怪": {
    "menstrualLengthRatio": 0.25,
    "gestationSpeciesSpeed": 5,
    "birthDifficulty": 0.2,
    "breedTolerance": 5,
    "impregnationDifficulty": 0.25,
    "orgasmOvulationAmount": 9,
    "identicalProbability": 25,
    "genderRatio": -1
  },
  "妖精": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1,
    "breedTolerance": 1,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "龟族": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.625,
    "birthDifficulty": 0.3,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "甲壳族": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.4,
    "breedTolerance": 1.6,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "蜥蜴人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.8,
    "breedTolerance": 2.5,
    "impregnationDifficulty": 1.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 20,
    "genderRatio": null
  },
  "海蛞蝓族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 0.25,
    "impregnationDifficulty": 0.25,
    "orgasmOvulationAmount": 5,
    "identicalProbability": 30,
    "genderRatio": null
  },
  "宝箱怪": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.67,
    "birthDifficulty": 0.6,
    "breedTolerance": 3.6,
    "impregnationDifficulty": 0.6,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 66,
    "genderRatio": null
  },
  "阿拉克涅": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 1.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 0,
    "genderRatio": 25
  },
  "百足姬": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 3.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 1.5,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 0,
    "genderRatio": 40
  },
  "天狗": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "深潜者": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1.2,
    "breedTolerance": 3,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 10,
    "genderRatio": 75
  },
  "人鱼": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.75,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "鱼人": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "海妖": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 3,
    "breedTolerance": 0.3,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 5,
    "genderRatio": 33
  },
  "水母族": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.2,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 0.33,
    "orgasmOvulationAmount": 5,
    "identicalProbability": 50,
    "genderRatio": null
  },
  "海龙人": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.625,
    "birthDifficulty": 2,
    "breedTolerance": 0.4,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 25,
    "genderRatio": 66
  },
  "河童": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "蛇人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1.2,
    "breedTolerance": 2,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "蛙人": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.7,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 30,
    "genderRatio": null
  },
  "眼魔": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.5,
    "breedTolerance": 0.75,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "独居虫族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 4,
    "birthDifficulty": 0.5,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 0,
    "genderRatio": 30
  },
  "龙族": {
    "menstrualLengthRatio": 4,
    "gestationSpeciesSpeed": 0.25,
    "birthDifficulty": 4,
    "breedTolerance": 10,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "狮鹫族": {
    "menstrualLengthRatio": 3.5,
    "gestationSpeciesSpeed": 0.33,
    "birthDifficulty": 3,
    "breedTolerance": 9,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "天使": {
    "menstrualLengthRatio": 13,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 2.5,
    "breedTolerance": 7,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "恶魔": {
    "menstrualLengthRatio": 13,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 2.5,
    "breedTolerance": 7,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "灯神": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.66,
    "birthDifficulty": 2,
    "breedTolerance": 6,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 0,
    "genderRatio": 50
  },
  "麒麟": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.3,
    "birthDifficulty": 3,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "凤凰": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 3.5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "白泽": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.35,
    "birthDifficulty": 4,
    "breedTolerance": 0.3,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "独角兽": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 3.5,
    "breedTolerance": 8,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 66
  },
  "空鲸": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.2,
    "birthDifficulty": 5,
    "breedTolerance": 10,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 33
  },
  "史萊姆": {
    "menstrualLengthRatio": 0.25,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 0.25,
    "breedTolerance": 8,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 75,
    "genderRatio": null
  },
  "石像鬼": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 2.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": -1
  },
  "烛灵": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 40,
    "genderRatio": -1
  },
  "人偶": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 10,
    "genderRatio": -1
  },
  "心魇": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 2.5,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "元素灵": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 0.5,
    "breedTolerance": 5,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": -1
  },
  "宝石人": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 3,
    "breedTolerance": 2,
    "impregnationDifficulty": 7,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "奈米丛族": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 1,
    "breedTolerance": 6,
    "impregnationDifficulty": 7,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 1,
    "genderRatio": null
  },
  "奇美拉": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 4,
    "breedTolerance": 12,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "影魔": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.75,
    "birthDifficulty": 0.6,
    "breedTolerance": 5,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "月兔族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 0.6,
    "breedTolerance": 2.5,
    "impregnationDifficulty": 0.4,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 30,
    "genderRatio": 30
  },
  "狗头人": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.4,
    "breedTolerance": 1.2,
    "impregnationDifficulty": 0.3,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "梅杜莎": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.7,
    "birthDifficulty": 1.5,
    "breedTolerance": 1,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 20
  },
  "修格斯": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.3,
    "birthDifficulty": 2,
    "breedTolerance": 12,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 50,
    "genderRatio": null
  },
  "活体铠甲": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.5,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 15,
    "genderRatio": -1
  },
  "伪人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 2,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "杜拉罕": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1,
    "breedTolerance": 3,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 50
  }
});

export const RACE_PHYSIOLOGY_FIELDS = Object.freeze([
  "menstrualLengthRatio",
  "gestationSpeciesSpeed",
  "birthDifficulty",
  "breedTolerance",
  "impregnationDifficulty",
  "orgasmOvulationAmount",
  "identicalProbability",
  "recoveryDays",
  "genderRatio"
]);

let customRacePhysiologyProfiles = {};
let customDerivedTypeProfiles = {};

function sanitizeDerivedTypeProfilePatch(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const result = {};
  for (const field of ['introductionLine', 'fluxDefinition']) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    const value = String(profile[field] || '').trim();
    if (value) result[field] = value;
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'inheritanceSpeed')) {
    const value = Number(profile.inheritanceSpeed);
    if (Number.isFinite(value)) result.inheritanceSpeed = Math.max(0, value);
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function setDerivedTypeOverrides(overrides = {}) {
  const next = {};
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [derivedType, profile] of Object.entries(overrides)) {
      const key = String(derivedType || '').trim();
      const patch = sanitizeDerivedTypeProfilePatch(profile);
      if (key && patch) next[key] = Object.freeze(patch);
    }
  }
  customDerivedTypeProfiles = Object.freeze(next);
}

export function getDerivedTypeOverride(derivedType) {
  const baseName = getBaseDerivedTypeName(derivedType);
  const profile = customDerivedTypeProfiles[baseName];
  return profile ? {
    ...profile,
  } : null;
}

export function getDerivedTypeIntroductionLine(derivedType) {
  const baseName = getBaseDerivedTypeName(derivedType);
  // 使用者覆写优先，内建为 fallback（与 getRaceIntroductionLine 同规则）
  const customLine = customDerivedTypeProfiles[baseName]?.introductionLine;
  if (customLine !== undefined) return String(customLine || '').trim();
  return String(DERIVED_TYPE_INTRODUCTION_LINES[baseName] || '').trim();
}

function sanitizeRacePhysiologyProfilePatch(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const result = {};
  if (Object.prototype.hasOwnProperty.call(profile, RACE_INTRODUCTION_FIELD)) {
    const introductionLine = String(profile[RACE_INTRODUCTION_FIELD] || '').trim();
    if (introductionLine) result[RACE_INTRODUCTION_FIELD] = introductionLine;
  }
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    if (field === 'recoveryDays') continue;
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    if (field === 'genderRatio' && profile[field] === null) {
      result[field] = null;
      continue;
    }
    const value = Number(profile[field]);
    if (!Number.isFinite(value)) continue;
    if (field === 'genderRatio') result[field] = Math.max(-1, Math.min(100, Math.round(value)));
    else if (field === 'orgasmOvulationAmount') result[field] = Math.max(0, Math.round(value));
    else if (field === 'identicalProbability') result[field] = Math.max(0, Math.min(100, value));
    else result[field] = Math.max(0, value);
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function setRacePhysiologyOverrides(overrides = {}) {
  const next = {};
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [race, profile] of Object.entries(overrides)) {
      const key = String(race || '').trim();
      const patch = sanitizeRacePhysiologyProfilePatch(profile);
      if (key && patch) next[key] = Object.freeze(patch);
    }
  }
  customRacePhysiologyProfiles = Object.freeze(next);
}

export function getRacePhysiologyOverrides() {
  const result = {};
  for (const [race, profile] of Object.entries(customRacePhysiologyProfiles)) {
    result[race] = { ...profile };
  }
  return result;
}

export function getRacePhysiologyOverride(race) {
  const key = String(race || '').trim();
  const profile = customRacePhysiologyProfiles[key];
  return profile ? { ...profile } : null;
}

export function getBuiltinRacePhysiologyProfile(race) {
  const key = String(race || '').trim();
  const profile = RACE_PHYSIOLOGY_PROFILES[key];
  return profile ? { ...profile } : null;
}

export function getRaceIntroductionLine(race) {
  const key = getBaseRaceName(race);
  if (!key) return '';
  const customLine = customRacePhysiologyProfiles[key]?.[RACE_INTRODUCTION_FIELD];
  if (customLine !== undefined) return String(customLine || '').trim();
  return String(RACE_INTRODUCTION_LINES[key] || '').trim();
}

function getEffectiveRacePhysiologyProfileValue(race) {
  const key = String(race || '').trim();
  const builtin = RACE_PHYSIOLOGY_PROFILES[key];
  if (!builtin) return null;
  return {
    ...builtin,
    ...(customRacePhysiologyProfiles[key] || {}),
  };
}

function getEmbryoRecoveryCoefficientByType(embryoType) {
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

function resolveRecoveryDays(profile, embryoType) {
  const explicit = Number(profile?.recoveryDays);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const gestationSpeciesSpeed = Number(profile?.gestationSpeciesSpeed);
  const birthDifficulty = Number(profile?.birthDifficulty);
  const breedTolerance = Number(profile?.breedTolerance);
  if (!Number.isFinite(gestationSpeciesSpeed) || gestationSpeciesSpeed <= 0) return 56;
  if (!Number.isFinite(birthDifficulty) || birthDifficulty <= 0) return 56;
  if (!Number.isFinite(breedTolerance) || breedTolerance <= 0) return 56;

  const coefficient = getEmbryoRecoveryCoefficientByType(embryoType);
  return Math.max(1, Math.round(coefficient * (280 / gestationSpeciesSpeed) * (birthDifficulty / breedTolerance)));
}

export function getRacePhysiologyProfile(race) {
  const key = String(race || "");
  const profile = getEffectiveRacePhysiologyProfileValue(key);
  if (!profile) return null;
  return {
    ...profile,
    recoveryDays: resolveRecoveryDays(profile, getEmbryoTypeByRace(key)),
  };
}

/**
 * 衍生类型别名：`修行` 在 v0.9.5 拆成东方的 `修炼` 与西方的 `魔导`，
 * 旧存档里写着 `[修行]XXX` 的角色必须仍能查到 flux/遗传/代谢抵免，否则会静默失效。
 * 繁体写法一并映射，模型写哪种字形都认得。
 */
const DERIVED_TYPE_ALIASES = Object.freeze({
  修行: '修炼',
  修煉: '修炼',
  魔導: '魔导',
});

export function getBaseDerivedTypeName(derivedType) {
  const value = String(derivedType || '').trim();
  if (!value) return '';
  const subtypeMatch = value.match(/^(.+?)-(.+)$/);
  const base = subtypeMatch ? subtypeMatch[1] : value;
  return DERIVED_TYPE_ALIASES[base] || base;
}

export function getDerivedTypeInheritanceProfile(derivedType) {
  const baseName = getBaseDerivedTypeName(derivedType);
  if (!baseName) return null;
  const builtin = DERIVED_TYPE_INHERITANCE_PROFILES[baseName];
  if (!builtin) return null;
  const inheritanceSpeed = customDerivedTypeProfiles[baseName]?.inheritanceSpeed;
  return inheritanceSpeed === undefined ? builtin : { ...builtin, inheritanceSpeed };
}

export function getDerivedTypeFluxProfile(derivedType) {
  const baseName = getBaseDerivedTypeName(derivedType);
  if (!baseName) return null;
  const builtin = DERIVED_TYPE_FLUX_PROFILES[baseName];
  if (!builtin) return null;
  const override = customDerivedTypeProfiles[baseName] || {};
  return {
    ...builtin,
    ...(override.fluxDefinition !== undefined ? { fluxDefinition: override.fluxDefinition } : {}),
  };
}

export function getDerivedTypeMetabolismExemptions(derivedType) {
  const baseName = getBaseDerivedTypeName(derivedType);
  if (!baseName) return [];
  return [...(DERIVED_TYPE_METABOLISM_EXEMPTIONS[baseName] || [])];
}

export function parseRaceDescriptor(rawRace) {
  const value = String(rawRace || '').trim();
  if (!value) {
    return {
      race: '',
      derivedType: null,
    };
  }
  const derivedMatch = value.match(/^\[([^\]]+)\](.+)$/);
  if (!derivedMatch) {
    return {
      race: value,
      derivedType: null,
    };
  }
  return {
    race: String(derivedMatch[2] || '').trim(),
    derivedType: String(derivedMatch[1] || '').trim() || null,
  };
}

export function getRaceDescriptorComponents(race) {
  const value = parseRaceDescriptor(race).race;
  if (!value) return [];
  return value.split(/[xX]/).map((item) => item.trim()).filter(Boolean);
}

function getBaseRaceComponentName(component) {
  const value = String(component || '').trim();
  if (!value) return '';
  const separatorIndex = value.indexOf('-');
  return separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : value;
}

export function getBaseRaceName(race) {
  const [first = ''] = getRaceDescriptorComponents(race);
  return getBaseRaceComponentName(first);
}

export function getRaceComponents(race) {
  // 同基种族带不同装饰子项（如「兽耳族-兔x兽耳族-猫」）时按基种族去重，避免平均时双重加权
  const seen = new Set();
  return getRaceDescriptorComponents(race)
    .map((component) => getBaseRaceComponentName(component))
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function mergeGenderRatioValues(values) {
  // 双性优先于数值平均：多一套器官是稳定的身体构造，混血时应当保留，
  // 否则「史莱姆x人类」会被平均成普通男女，双性只剩嵌合体那条 20% 的路径。
  // 无性不比照办理——它是「少一套」的减法，让触手怪x人类的后代全部绝育过重。
  if (values.some((value) => value === null)) return null;

  const normalValues = values.filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
  if (normalValues.length > 0) {
    return normalValues.reduce((sum, value) => sum + value, 0) / normalValues.length;
  }
  if (values.some((value) => value === -1)) return -1;
  return 50;
}

function mergeGestationSpeciesSpeedByAverageDays(values) {
  const speeds = values.filter((value) => Number.isFinite(value) && value > 0);
  if (speeds.length === 0) return null;

  const averageDays = speeds
    .map((speed) => 280 / speed)
    .reduce((sum, days) => sum + days, 0) / speeds.length;
  return averageDays > 0 ? 280 / averageDays : null;
}

export function getMergedRacePhysiologyProfile(race) {
  const parts = getRaceComponents(race);
  if (parts.length === 0) return null;

  const profiles = parts
    .map((part) => getRacePhysiologyProfile(part))
    .filter((profile) => profile && typeof profile === 'object');
  if (profiles.length === 0) return null;

  const merged = {};
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    if (field === 'genderRatio') continue;
    const values = profiles
      .map((profile) => Number(profile[field]))
      .filter((value) => Number.isFinite(value));
    if (values.length > 0) {
      merged[field] = field === 'gestationSpeciesSpeed'
        ? mergeGestationSpeciesSpeedByAverageDays(values)
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }

  merged.genderRatio = mergeGenderRatioValues(profiles.map((profile) => profile.genderRatio));
  // 存在未收录的混血成分：不静默丢弃，标记出来让提示词明确「数值仅供参考」
  if (profiles.length < parts.length) merged.hasUnknownRace = true;
  return merged;
}

export function getEmbryoTypeByRace(race) {
  const parts = getRaceComponents(race);
  if (parts.length === 0) return '胎生';

  let dominantRace = parts[0];
  let lowestGestationSpeciesSpeed = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const profile = getEffectiveRacePhysiologyProfileValue(part);
    const gestationSpeciesSpeed = Number(profile?.gestationSpeciesSpeed);
    if (Number.isFinite(gestationSpeciesSpeed) && gestationSpeciesSpeed < lowestGestationSpeciesSpeed) {
      lowestGestationSpeciesSpeed = gestationSpeciesSpeed;
      dominantRace = part;
    }
  }

  if (VIVIPAROUS_RACES.includes(dominantRace)) return '胎生';
  if (OVIPAROUS_RACES.includes(dominantRace)) return '卵生';
  if (OVOVIVIPAROUS_RACES.includes(dominantRace)) return '卵胎生';
  if (METOVIVIPAROUS_RACES.includes(dominantRace)) return '胎转卵生';
  if (AMORPHOUS_RACES.includes(dominantRace)) return '不定型';
  return '胎生';
}
