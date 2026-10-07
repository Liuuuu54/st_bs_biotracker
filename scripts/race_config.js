import { toSimplifiedName } from './race_names.js';

export const EMBRYO_TYPES = Object.freeze(["胎生", "卵生", "卵胎生", "胎转卵生", "不定型"]);
/** 胚型是字串，不进 RACE_PHYSIOLOGY_FIELDS（那里的栏位会被当数值平均） */
export const RACE_EMBRYO_TYPE_FIELD = "embryoType";
export const RACE_INTRODUCTION_FIELD = "introductionLine";
export const RACE_INHERITANCE_FIELD = "inheritanceMode";
export const RACE_INHERITANCE_MODES = Object.freeze({
  NORMAL: "normal",
  PATERNAL: "paternal",
  MATERNAL: "maternal",
});

/** 可被百科覆写、混血时按血统加权的数值栏位 */
export const RACE_PHYSIOLOGY_FIELDS = Object.freeze([
  "menstrualLengthRatio",
  "gestationSpeciesSpeed",
  "birthDifficulty",
  "breedTolerance",
  "impregnationDifficulty",
  "orgasmOvulationAmount",
  "identicalProbability",
  "companionEggsMean",
  "recoveryCoefficient",
  "genderRatio"
]);

/**
 * 内置种族的唯一资料来源：新增种族只在这里加一笔，下方的种族清单与生理表都由此推导。
 * 栏位名与百科覆写一致，键的先后即名录、调色盘与百科的排列顺序。
 *
 * - embryoType：EMBRYO_TYPES 之一，决定卵壳、胎背、伴生卵与嵌套宿主等行为
 * - introductionLine：名录与提示词的短敘述，「英文原名，一句中文」；留空则提示词略过该行
 * - inheritanceMode：normal 一般；paternal 雄核（仅一方具核型时后代取精方种族，如哥布林）；
 *   maternal 雌核（取卵方种族，如媚魔）
 * - menstrualLengthRatio：经期长度倍率，人类为 1
 * - gestationSpeciesSpeed：孕速倍率，越高孕期越短；混血按「280／孕速」加权平均
 * - birthDifficulty：分娩难度；breedTolerance：承载耐受，越高孕期负担越轻
 * - impregnationDifficulty：受精难度，越高越难受孕、跨种越难
 * - orgasmOvulationAmount：高潮额外排卵数（整数）；identicalProbability：同卵分裂率（%）
 * - genderRatio：后代雄性百分比；null 为雌雄同体或双性，-1 为无性
 * - companionEggsMean：每个有效胚胎平均伴随多少颗不会发育成胎儿卡的背景卵（伴生卵）。
 *   胚型只代表「允许多卵」，不会让卵生／卵胎生／不定型自动高产；胎生与胎转卵生恒无伴生卵
 * - recoveryCoefficient：产后恢复系数，以人类 56 天为 1，只看母体物种（混血取各成分平均），衍生类型不参与；
 *   实际天数在分娩／流产当下再乘活力、经产与胎数因子，见 computePostpartumRecoveryDays
 *
 * 种族图示另存于 race_icons.js（由预览工具汇出），tests/race_icons.test.mjs 会核对两边名单一致。
 */
const RACE_DEFINITIONS = Object.freeze({
  "人类": {
    embryoType: "胎生",
    introductionLine: "Human，其余物种的参照：经期约 28 天、孕期约 280 天、产后约 56 天恢复，各物种的倍率都以人类预设值为 1。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 1, breedTolerance: 1,
    impregnationDifficulty: 1, orgasmOvulationAmount: 1, identicalProbability: 1, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 1,
  },
  "精灵": {
    embryoType: "胎生",
    introductionLine: "Elf，长寿的尖耳亚人，面容姣好、擅长魔法；肤色深青的暗精灵另列为卓尔。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 0.5, birthDifficulty: 0.8, breedTolerance: 0.33,
    impregnationDifficulty: 3, orgasmOvulationAmount: 0, identicalProbability: 2, genderRatio: 45,
    companionEggsMean: 0, recoveryCoefficient: 4.86,
  },
  "卓尔": {
    embryoType: "胎生",
    introductionLine: "Drow，即暗精灵，肤色深青或灰褐、多居地底的精灵分支；比精灵易受孕，分娩却更艰难。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 0.5, birthDifficulty: 1.5, breedTolerance: 0.33,
    impregnationDifficulty: 1.5, orgasmOvulationAmount: 0, identicalProbability: 2, genderRatio: 45,
    companionEggsMean: 0, recoveryCoefficient: 4.86,
  },
  "兽耳族": {
    embryoType: "胎生",
    introductionLine: "Kemonomimi／Beastfolk，保有人形、带兽耳兽尾的亚人；日系兽娘与西方 furry 皆归此类；牛系另列为米诺陶族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1.6, birthDifficulty: 0.8, breedTolerance: 3,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 3, identicalProbability: 10, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.25,
  },
  "米诺陶族": {
    embryoType: "胎生",
    introductionLine: "Minotaur／Cowfolk，牛系亚人，从牛头壮汉到丰乳牛娘皆归此类，不写作兽耳族-牛；承载耐受为胎生之最，乳量充沛。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1, birthDifficulty: 1.5, breedTolerance: 5,
    impregnationDifficulty: 0.8, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.5,
  },
  "怪兽类": {
    embryoType: "胎生",
    introductionLine: "Beast，异种交配情境中的完整兽形动物；具体物种写作怪兽类-狼、怪兽类-马等。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 2, birthDifficulty: 0.8, breedTolerance: 3,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 3, identicalProbability: 1, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.25,
  },
  "袋兽族": {
    embryoType: "胎生",
    introductionLine: "Marsupial-folk，有袋目亚人。幼体极早产出后转入育儿袋，因此承载耐受极低。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 5, birthDifficulty: 0.3, breedTolerance: 0.01,
    impregnationDifficulty: 1, orgasmOvulationAmount: 1, identicalProbability: 25, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 6,
  },
  "哥布林": {
    embryoType: "胎生",
    introductionLine: "Goblin，西幻小型怪物，繁殖力旺盛且几乎只诞下雄性；少数雌性个体存在。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 2.5, birthDifficulty: 2, breedTolerance: 1,
    impregnationDifficulty: 0.2, orgasmOvulationAmount: 2, identicalProbability: 10, genderRatio: 95,
    companionEggsMean: 0, recoveryCoefficient: 0.8,
  },
  "欧克": {
    embryoType: "胎生",
    introductionLine: "Orc，绿皮的高大战斗种族，旧称兽人、半兽人。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1.25, birthDifficulty: 1, breedTolerance: 2,
    impregnationDifficulty: 0.8, orgasmOvulationAmount: 1, identicalProbability: 50, genderRatio: 75,
    companionEggsMean: 0, recoveryCoefficient: 0.39,
  },
  "矮人": {
    embryoType: "胎生",
    introductionLine: "Dwarf，居于矿山、擅长锻造的短躯亚人。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 2, breedTolerance: 1,
    impregnationDifficulty: 1, orgasmOvulationAmount: 1, identicalProbability: 2, genderRatio: 60,
    companionEggsMean: 0, recoveryCoefficient: 2,
  },
  "半身人": {
    embryoType: "胎生",
    introductionLine: "Halfling，又称哈比人，身形矮小的和平亚人。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1.25, birthDifficulty: 1.5, breedTolerance: 2,
    impregnationDifficulty: 0.8, orgasmOvulationAmount: 3, identicalProbability: 10, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.61,
  },
  "半人马": {
    embryoType: "胎生",
    introductionLine: "Centaur，上身为人、下身为马的亚人，源自希腊神话。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.8, birthDifficulty: 1.5, breedTolerance: 0.5,
    impregnationDifficulty: 2, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 66,
    companionEggsMean: 0, recoveryCoefficient: 3.75,
  },
  "巨人": {
    embryoType: "胎生",
    introductionLine: "Giant，体型远超人类的种族；巨魔、山怪、独眼巨人、泰坦皆归此类。难以受孕，但庞大的身躯承载妊娠游刃有余。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.4, birthDifficulty: 3, breedTolerance: 2.5,
    impregnationDifficulty: 4, orgasmOvulationAmount: 0, identicalProbability: 2, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 8,
  },
  "媚魔": {
    embryoType: "胎生",
    introductionLine: "Succubus，近乎纯女性的性欲特化恶魔系亚人；与近乎纯男性的夢魔为对应种族。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 0.5, breedTolerance: 3,
    impregnationDifficulty: 1, orgasmOvulationAmount: 2, identicalProbability: 10, genderRatio: 5,
    companionEggsMean: 0, recoveryCoefficient: 0.25,
  },
  "雪族": {
    embryoType: "胎生",
    introductionLine: "Yuki-onna／Yeti，雪女与雪怪的复合群体，栖于严寒。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.25, gestationSpeciesSpeed: 1, birthDifficulty: 1, breedTolerance: 0.8,
    impregnationDifficulty: 0.75, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 40,
    companionEggsMean: 0, recoveryCoefficient: 1.25,
  },
  "夜叉": {
    embryoType: "胎生",
    introductionLine: "Yaksha／Oni，头生角的日系鬼族，罗刹与阿修罗皆归此类；长寿而易受孕，与人类所生的半鬼屡见于传说。双胎与人类同样罕见，族中视之为不祥。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 0.5, birthDifficulty: 4, breedTolerance: 0.8,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 1, identicalProbability: 3, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 5,
  },
  "妖狐": {
    embryoType: "胎生",
    introductionLine: "Kitsune，祖先为兽耳族，沾妖后独立演化的狐系妖族，修行增尾；未沾妖的兽耳狐娘应写作兽耳族-狐。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.8, birthDifficulty: 1.5, breedTolerance: 0.5,
    impregnationDifficulty: 3, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 3.75,
  },
  "貓又": {
    embryoType: "胎生",
    introductionLine: "Nekomata，祖先为兽耳族，沾妖后独立演化的猫系妖族，久养成妖、尾端分岔；未沾妖的兽耳猫娘应写作兽耳族-猫。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1, birthDifficulty: 1, breedTolerance: 1.5,
    impregnationDifficulty: 2.5, orgasmOvulationAmount: 2, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.66,
  },
  "月兔": {
    embryoType: "胎生",
    introductionLine: "Moon Rabbit，居于月球的兔系亚人；繁殖力为胎生种族之最，族中多为雌性。雄核遗传：月兔女子所生皆随父族，因而成为各族争夺的孕母，能延续族裔的雄兔被视为至宝。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 2, birthDifficulty: 0.6, breedTolerance: 2.5,
    impregnationDifficulty: 0.4, orgasmOvulationAmount: 4, identicalProbability: 10, genderRatio: 30,
    companionEggsMean: 0, recoveryCoefficient: 0.25,
  },
  "杜拉罕": {
    embryoType: "胎生",
    introductionLine: "Dullahan，可将头颅离体持握的亚人，青春期后头颅方与躯干分离，颈上或燃着无实体的火焰；躯体不依赖头颅运作。爱尔兰原典近于妖精，奇幻创作多作不死——取后者写作 [不死]杜拉罕。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.8, birthDifficulty: 1, breedTolerance: 1.2,
    impregnationDifficulty: 2.5, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.41,
  },
  "魔族": {
    embryoType: "胎生",
    introductionLine: "Mazoku，日系奇幻中体内生有魔力器官（魔核、魔石）、天生善用魔法的人形族裔，常生角、寿命长；属凡世种族，与魔界的「恶魔」不同。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.7, birthDifficulty: 1.5, breedTolerance: 1.2,
    impregnationDifficulty: 2, orgasmOvulationAmount: 0, identicalProbability: 3, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2.5,
  },
  "鸟族": {
    embryoType: "卵生",
    introductionLine: "Harpy，典型形象为哈比，带翼的鸟类亚人；现代创作已性别比正常化。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 2, birthDifficulty: 0.33, breedTolerance: 1,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 3, identicalProbability: 15, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.5,
  },
  "怪鸟类": {
    embryoType: "卵生",
    introductionLine: "Monstrous Bird，异种交配情境中的完整鸟形动物；具体物种写作怪鸟类-鹰、怪鸟类-鸦等。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.25, gestationSpeciesSpeed: 20, birthDifficulty: 0.2, breedTolerance: 1,
    impregnationDifficulty: 0.4, orgasmOvulationAmount: 3, identicalProbability: 1, genderRatio: 50,
    companionEggsMean: 3, recoveryCoefficient: 0.25,
  },
  "植物族": {
    embryoType: "卵生",
    introductionLine: "Dryad／Plant-folk，植物拟人，具自花授粉特性。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 2.5, birthDifficulty: 0.25, breedTolerance: 1,
    impregnationDifficulty: 1, orgasmOvulationAmount: 6, identicalProbability: 5, genderRatio: null,
    companionEggsMean: 4, recoveryCoefficient: 0.3,
  },
  "社会虫族": {
    embryoType: "卵生",
    introductionLine: "Eusocial Insectfolk，蜜蜂与蚂蚁一类的真社会性虫族，以雌性为绝对多数。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 2.5, birthDifficulty: 0.2, breedTolerance: 1.33,
    impregnationDifficulty: 0.2, orgasmOvulationAmount: 8, identicalProbability: 0, genderRatio: 10,
    companionEggsMean: 16, recoveryCoefficient: 0.25,
  },
  "蜥蜴人": {
    embryoType: "卵生",
    introductionLine: "Lizardfolk，又称亚龙人的鳞甲亚人；设定上从部落怪物到与人平起平坐皆有。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1.25, birthDifficulty: 0.8, breedTolerance: 1,
    impregnationDifficulty: 1.5, orgasmOvulationAmount: 3, identicalProbability: 20, genderRatio: null,
    companionEggsMean: 4, recoveryCoefficient: 0.77,
  },
  "触手怪": {
    embryoType: "卵生",
    introductionLine: "Tentacle Monster，起源不明、擅长拟态的异形外星群体生命；主要向异族宿主植入同族胚体扩散，真正与宿主发生遗传融合的案例极少。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.25, gestationSpeciesSpeed: 5, birthDifficulty: 0.2, breedTolerance: 1.67,
    impregnationDifficulty: 0.25, orgasmOvulationAmount: 9, identicalProbability: 25, genderRatio: -1,
    companionEggsMean: 3, recoveryCoefficient: 0.25,
  },
  "妖精": {
    embryoType: "卵生",
    introductionLine: "fairy，娇小带翅的精怪；与长身尖耳的「精灵」不同。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 0.8, birthDifficulty: 1, breedTolerance: 1,
    impregnationDifficulty: 3, orgasmOvulationAmount: 1, identicalProbability: 2, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 3.75,
  },
  "真菌族": {
    embryoType: "卵生",
    introductionLine: "Myconid，菌类拟人，具自体授粉特性。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 3.3, birthDifficulty: 0.25, breedTolerance: 1,
    impregnationDifficulty: 0.8, orgasmOvulationAmount: 4, identicalProbability: 5, genderRatio: null,
    companionEggsMean: 6, recoveryCoefficient: 0.25,
  },
  "海蛞蝓族": {
    embryoType: "卵生",
    introductionLine: "Sea Slug-folk，海兔拟人，雌雄同体；交配方式奇特（交配列车、阴茎击剑）。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 3.3, birthDifficulty: 0.25, breedTolerance: 0.25,
    impregnationDifficulty: 0.25, orgasmOvulationAmount: 5, identicalProbability: 10, genderRatio: null,
    companionEggsMean: 9, recoveryCoefficient: 0.91,
  },
  "龟族": {
    embryoType: "卵生",
    introductionLine: "Turtle-folk，龟类拟人，长寿而孕期极长。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.625, birthDifficulty: 0.3, breedTolerance: 0.8,
    impregnationDifficulty: 2, orgasmOvulationAmount: 4, identicalProbability: 15, genderRatio: 50,
    companionEggsMean: 7, recoveryCoefficient: 1.8,
  },
  "甲壳族": {
    embryoType: "卵生",
    introductionLine: "Crustacean-folk，蟹虾一类的甲壳拟人。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 1.6, birthDifficulty: 0.4, breedTolerance: 1,
    impregnationDifficulty: 2.5, orgasmOvulationAmount: 4, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 20, recoveryCoefficient: 0.46,
  },
  "宝箱怪": {
    embryoType: "卵生",
    introductionLine: "Mimic，宝箱拟态怪，雌雄同体；所产之卵呈金币状。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1.67, birthDifficulty: 0.6, breedTolerance: 1.2,
    impregnationDifficulty: 0.6, orgasmOvulationAmount: 6, identicalProbability: 66, genderRatio: null,
    companionEggsMean: 7, recoveryCoefficient: 0.3,
  },
  "阿拉克涅": {
    embryoType: "卵生",
    introductionLine: "Arachne，上身为人、下身为蜘蛛的亚人，源自希腊神话。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 2, birthDifficulty: 1.5, breedTolerance: 1.33,
    impregnationDifficulty: 2, orgasmOvulationAmount: 6, identicalProbability: 0, genderRatio: 25,
    companionEggsMean: 12, recoveryCoefficient: 0.57,
  },
  "百足氏": {
    embryoType: "卵生",
    introductionLine: "Centipede-folk，上身为人、下身为蜈蚣的亚人，雅称天龙；可视为蜈蚣版的阿拉克涅。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 2, birthDifficulty: 3.5, breedTolerance: 1.33,
    impregnationDifficulty: 1.5, orgasmOvulationAmount: 6, identicalProbability: 0, genderRatio: 40,
    companionEggsMean: 10, recoveryCoefficient: 1.32,
  },
  "天狗": {
    embryoType: "卵生",
    introductionLine: "Tengu，日系妖怪，形象有鸦、狼、长鼻数种；族群政治性强。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 1, breedTolerance: 1,
    impregnationDifficulty: 1, orgasmOvulationAmount: 1, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2,
  },
  "深潜者": {
    embryoType: "卵生",
    introductionLine: "Deep One，潜伏人类社会的克苏鲁系海洋异种，雄核遗传。本为卵生却伪装成胎生：孕期与人类相同，长出似胎盘的组织但养分仍来自卵黄，总以包膜分娩；撕破卵膜即是早产，跳过与产后恢复等长的孵化期，生下的婴儿与人类无异，成年后受深海呼唤才渐渐显出原形（印斯茅斯之相）。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 1, birthDifficulty: 1.2, breedTolerance: 1,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 3, identicalProbability: 10, genderRatio: 75,
    companionEggsMean: 0, recoveryCoefficient: 2,
  },
  "拜亚基": {
    embryoType: "卵生",
    introductionLine: "Byakhee，哈斯塔的眷族，蝠翼与虫豸特徵混杂的有翼使魔，能穿越星际虚空；与深潜者所属的克苏鲁一系对立。族中多为雌性、雄核遗传：女子怀上外族的孩子会生出纯种外族，因而沦为主人与信徒差遣的孕母，族裔只靠稀有的雄性延续。孕期短、一窝常带数枚伴生卵。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.75, gestationSpeciesSpeed: 1.6, birthDifficulty: 0.6, breedTolerance: 1.5,
    impregnationDifficulty: 1.5, orgasmOvulationAmount: 3, identicalProbability: 10, genderRatio: 25,
    companionEggsMean: 2, recoveryCoefficient: 0.7,
  },
  "狗头人": {
    embryoType: "卵生",
    introductionLine: "Kobold，与哥布林同生态位的小型犬首亚人；却如鸭嘴兽般产卵，分娩负担远低于哥布林。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 2.5, birthDifficulty: 0.4, breedTolerance: 1,
    impregnationDifficulty: 0.3, orgasmOvulationAmount: 3, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 1, recoveryCoefficient: 0.39,
  },
  "人鱼": {
    embryoType: "卵胎生",
    introductionLine: "Mermaid，以鱼尾替代双足的美人鱼；可借魔法置换双足上陆。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.8, birthDifficulty: 1.5, breedTolerance: 0.75,
    impregnationDifficulty: 2, orgasmOvulationAmount: 2, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 5,
  },
  "鱼人": {
    embryoType: "卵胎生",
    introductionLine: "Fishfolk，人形而带鱼类特徵与粗尾鳍，可视为海中的精灵——孕期长、产子少。萨尔达的佐拉族属此。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.5, birthDifficulty: 2, breedTolerance: 1,
    impregnationDifficulty: 3, orgasmOvulationAmount: 0, identicalProbability: 2, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 5,
  },
  "怪鱼类": {
    embryoType: "卵胎生",
    introductionLine: "Monstrous Fish，异种交配情境中的完整鱼形动物；具体物种写作怪鱼类-鲨、怪鱼类-鲤等。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 0.25, gestationSpeciesSpeed: 4, birthDifficulty: 0.2, breedTolerance: 2,
    impregnationDifficulty: 0.3, orgasmOvulationAmount: 8, identicalProbability: 0, genderRatio: 50,
    companionEggsMean: 32, recoveryCoefficient: 0.25,
  },
  "海妖": {
    embryoType: "卵胎生",
    introductionLine: "Scylla，章鱼乌贼一类，以触腕替代双足；无须变形即可上陆。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 1, birthDifficulty: 3, breedTolerance: 0.3,
    impregnationDifficulty: 1, orgasmOvulationAmount: 2, identicalProbability: 5, genderRatio: 33,
    companionEggsMean: 10, recoveryCoefficient: 10,
  },
  "独居虫族": {
    embryoType: "卵胎生",
    introductionLine: "Solitary Insectfolk，与社会虫族相对的独居性虫族；蛾、螳螂等拟人归此，部分会将卵寄入异族代孕孵化。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 4, birthDifficulty: 0.5, breedTolerance: 1,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 4, identicalProbability: 0, genderRatio: 30,
    companionEggsMean: 6, recoveryCoefficient: 0.25,
  },
  "蛇人": {
    embryoType: "卵胎生",
    introductionLine: "Lamia，上身为人、下身为蛇的亚人，形象参考拉米亚。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 1.2, breedTolerance: 2,
    impregnationDifficulty: 1, orgasmOvulationAmount: 2, identicalProbability: 10, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 1.2,
  },
  "蛙族": {
    embryoType: "卵胎生",
    introductionLine: "Frogfolk，蛙类拟人，出生时性别由外在环境决定，故不适用固定男女比。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 3.3, birthDifficulty: 0.25, breedTolerance: 1,
    impregnationDifficulty: 0.7, orgasmOvulationAmount: 4, identicalProbability: 10, genderRatio: null,
    companionEggsMean: 35, recoveryCoefficient: 0.25,
  },
  "眼魔": {
    embryoType: "卵胎生",
    introductionLine: "Beholder，引用 D&D 的眼球暴君，经拟人化后的形象。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 1.25, birthDifficulty: 0.5, breedTolerance: 0.75,
    impregnationDifficulty: 3, orgasmOvulationAmount: 1, identicalProbability: 2, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 1.07,
  },
  "水母族": {
    embryoType: "卵胎生",
    introductionLine: "Jellyfish-folk，水母拟人，幼体（水螅体）与成体（水母体）形态差异极大。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1.25, birthDifficulty: 0.2, breedTolerance: 0.5,
    impregnationDifficulty: 0.33, orgasmOvulationAmount: 5, identicalProbability: 50, genderRatio: null,
    companionEggsMean: 14, recoveryCoefficient: 0.64,
  },
  "海马族": {
    embryoType: "卵胎生",
    introductionLine: "Seahorse-folk，海马拟人的海系亚人，属雄性孕育系。",
    inheritanceMode: "paternal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.625, birthDifficulty: 2, breedTolerance: 0.4,
    impregnationDifficulty: 4, orgasmOvulationAmount: 2, identicalProbability: 25, genderRatio: 66,
    companionEggsMean: 12, recoveryCoefficient: 0.5,
  },
  "河童": {
    embryoType: "卵胎生",
    introductionLine: "Kappa，头顶盛水皿的日系妖怪，蛙族的妖系分支。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.8, birthDifficulty: 1.5, breedTolerance: 1.5,
    impregnationDifficulty: 2.5, orgasmOvulationAmount: 1, identicalProbability: 15, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2.5,
  },
  "梅杜莎": {
    embryoType: "卵胎生",
    introductionLine: "Medusa，蛇人沾妖后独立演化的分支，发为群蛇；比蛇人更难受孕、孕期更长。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.7, birthDifficulty: 1.5, breedTolerance: 1,
    impregnationDifficulty: 2.5, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 4.29,
  },
  "蝎罗氏": {
    embryoType: "卵胎生",
    introductionLine: "Scorpion-folk，带蝎尾、螯钳与甲壳的亚人，人形占比高于阿拉克涅；幼体出生后会攀在母体背上一段时间。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1.25, birthDifficulty: 1.2, breedTolerance: 1.8,
    impregnationDifficulty: 1.5, orgasmOvulationAmount: 3, identicalProbability: 0, genderRatio: 40,
    companionEggsMean: 6, recoveryCoefficient: 0.8,
  },
  "华根蕴桃": {
    embryoType: "卵胎生",
    introductionLine: "Huagen Peach，修仙系的灵植族：胎内由一颗种子发芽结桃，雌性生为仙桃娘，雄性是形似曼德拉草的人参精，伴生的嫩参嫩桃是珍贵灵物。雌核遗传；栖于小灵地，以食人藤蔓捕食散修。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.4, birthDifficulty: 0.8, breedTolerance: 2,
    impregnationDifficulty: 3, orgasmOvulationAmount: 0, identicalProbability: 35, genderRatio: 50,
    companionEggsMean: 2, recoveryCoefficient: 1,
  },
  "西方龙": {
    embryoType: "胎转卵生",
    introductionLine: "Western Dragon，近似 D&D 的西方巨龙，可在人态与完全龙形间转换；性欲旺盛、乐于跨种族交配，龙卵产量也高于东方龙。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 4, gestationSpeciesSpeed: 0.25, birthDifficulty: 4, breedTolerance: 2,
    impregnationDifficulty: 2, orgasmOvulationAmount: 2, identicalProbability: 25, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 7,
  },
  "东方龙": {
    embryoType: "胎转卵生",
    introductionLine: "Eastern Dragon，汲取天地灵气的东方神龙，可化为人形；孕期漫长而自身承载耐受很低，产后需要长期恢复。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 4, gestationSpeciesSpeed: 0.25, birthDifficulty: 4, breedTolerance: 1 / 3,
    impregnationDifficulty: 5, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 10,
  },
  "海德拉": {
    embryoType: "胎转卵生",
    introductionLine: "Hydra，多头龙族，一具身躯生有多个头颅，仍是单一个体；以断首再生著称，是胎转卵生中产后恢复最快的一族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.4, birthDifficulty: 3, breedTolerance: 1.5,
    impregnationDifficulty: 4, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 1.5,
  },
  "狮鹫": {
    embryoType: "胎转卵生",
    introductionLine: "Griffin，鹰首狮身的上位幻兽，可在人态与完全态之间转换。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3.5, gestationSpeciesSpeed: 0.33, birthDifficulty: 3, breedTolerance: 1.8,
    impregnationDifficulty: 4, orgasmOvulationAmount: 2, identicalProbability: 25, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 5.05,
  },
  "天使": {
    embryoType: "胎转卵生",
    introductionLine: "Angel，天界种族，以「天使之卵」孕育。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 13, gestationSpeciesSpeed: 0.8, birthDifficulty: 2.5, breedTolerance: 1.4,
    impregnationDifficulty: 3, orgasmOvulationAmount: 1, identicalProbability: 10, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2.23,
  },
  "恶魔": {
    embryoType: "胎转卵生",
    introductionLine: "Demon，魔界种族，以「恶魔之卵」孕育；与已分家的媚魔及夢魔不同，也不是凡世的魔族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 13, gestationSpeciesSpeed: 0.8, birthDifficulty: 2.5, breedTolerance: 1.4,
    impregnationDifficulty: 3, orgasmOvulationAmount: 1, identicalProbability: 10, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2.23,
  },
  "奇美拉": {
    embryoType: "胎转卵生",
    introductionLine: "Chimera，合成兽。胎转卵生的过程可在孕育期平衡混杂血脉的冲突。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.4, birthDifficulty: 4, breedTolerance: 2.4,
    impregnationDifficulty: 4, orgasmOvulationAmount: 1, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 4.16,
  },
  "麒麟": {
    embryoType: "胎转卵生",
    introductionLine: "Qilin，东方上位神兽，汲取环境灵气孕育，自身承载耐受偏低；可拟人化。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.75, gestationSpeciesSpeed: 0.3, birthDifficulty: 3, breedTolerance: 0.8,
    impregnationDifficulty: 4, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 8,
  },
  "凤凰": {
    embryoType: "胎转卵生",
    introductionLine: "Phoenix，东方上位神兽，浴火重生，汲取环境灵气孕育；可拟人化。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.75, gestationSpeciesSpeed: 0.4, birthDifficulty: 5, breedTolerance: 0.5,
    impregnationDifficulty: 3.5, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 3,
  },
  "白泽": {
    embryoType: "胎转卵生",
    introductionLine: "Bai Ze，东方上位神兽，通晓万物，汲取环境灵气孕育；自身承载耐受偏低。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.75, gestationSpeciesSpeed: 0.35, birthDifficulty: 4, breedTolerance: 0.4,
    impregnationDifficulty: 5, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 9,
  },
  "独角兽": {
    embryoType: "胎转卵生",
    introductionLine: "Unicorn，额生独角的上位幻兽，可在人态与完全态之间转换。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.5, birthDifficulty: 3.5, breedTolerance: 1.6,
    impregnationDifficulty: 5, orgasmOvulationAmount: 1, identicalProbability: 25, genderRatio: 66,
    companionEggsMean: 0, recoveryCoefficient: 4.38,
  },
  "空鲸": {
    embryoType: "胎转卵生",
    introductionLine: "Sky Whale，翱翔天际的巨鲸，可在常态人形与巨态鱼形间切换（鲲鹏之属），孕期为全表最长。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 0.2, birthDifficulty: 5, breedTolerance: 2,
    impregnationDifficulty: 6, orgasmOvulationAmount: 1, identicalProbability: 5, genderRatio: 33,
    companionEggsMean: 0, recoveryCoefficient: 12,
  },
  "星繭族": {
    embryoType: "胎转卵生",
    introductionLine: "Astral Cocoon-folk，特化的寰宇虫娘，单胎于子宫中度过幼虫期，分娩时产下虫繭而非虫卵；会让异族女性以假孕分摊孕育能量。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.6666666666666666, birthDifficulty: 3, breedTolerance: 1,
    impregnationDifficulty: 0.1, orgasmOvulationAmount: 0, identicalProbability: 0, genderRatio: 0,
    companionEggsMean: 0, recoveryCoefficient: 5,
  },
  "修格斯": {
    embryoType: "胎转卵生",
    introductionLine: "Shoggoth，形似史莱姆却更为古老的太古存在，承载力极强而极难受孕。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 2, gestationSpeciesSpeed: 0.3, birthDifficulty: 2, breedTolerance: 2.4,
    impregnationDifficulty: 5, orgasmOvulationAmount: 2, identicalProbability: 50, genderRatio: null,
    companionEggsMean: 0, recoveryCoefficient: 2.79,
  },
  "史萊姆": {
    embryoType: "不定型",
    introductionLine: "Slime，繁殖策略极多样：可无性分裂，可孕育任何种族之胎，亦可寄入异族子宫。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.25, gestationSpeciesSpeed: 0.5, birthDifficulty: 0.25, breedTolerance: 2,
    impregnationDifficulty: 1, orgasmOvulationAmount: 3, identicalProbability: 75, genderRatio: null,
    companionEggsMean: 3, recoveryCoefficient: 0.25,
  },
  "石像鬼": {
    embryoType: "不定型",
    introductionLine: "Gargoyle，人类造物之一，石质无性种族；受精难度极高，繁殖基本限于同族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.4, birthDifficulty: 2.5, breedTolerance: 1,
    impregnationDifficulty: 6, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: -1,
    companionEggsMean: 0, recoveryCoefficient: 8,
  },
  "烛灵": {
    embryoType: "不定型",
    introductionLine: "Candle Spirit，人类造物之一，烛火所寄的无性种族；受精难度极高，繁殖基本限于同族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1.6, birthDifficulty: 0.5, breedTolerance: 1,
    impregnationDifficulty: 6, orgasmOvulationAmount: 0, identicalProbability: 40, genderRatio: -1,
    companionEggsMean: 0, recoveryCoefficient: 0.63,
  },
  "人偶": {
    embryoType: "不定型",
    introductionLine: "Living Doll，人类造物之一，得灵的人偶，无性；受精难度极高，繁殖基本限于同族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.8, birthDifficulty: 1.5, breedTolerance: 1,
    impregnationDifficulty: 6, orgasmOvulationAmount: 0, identicalProbability: 10, genderRatio: -1,
    companionEggsMean: 0, recoveryCoefficient: 3.75,
  },
  "心魇": {
    embryoType: "不定型",
    introductionLine: "Kaijin，由人心黑暗与负面情绪孕育而生的异形种族，常作为魔法少女的敌人；其后代通常继承母方的心魇外貌与异形特徵。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 2.5, breedTolerance: 0.8,
    impregnationDifficulty: 1, orgasmOvulationAmount: 0, identicalProbability: 20, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 5,
  },
  "夢魔": {
    embryoType: "不定型",
    introductionLine: "Incubus，近乎纯男性的性欲特化恶魔系不定型种族；胚胎发育随母体调整外形，但基因定序仍属夢魔。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 0.5, breedTolerance: 1,
    impregnationDifficulty: 1, orgasmOvulationAmount: 2, identicalProbability: 10, genderRatio: 95,
    companionEggsMean: 0, recoveryCoefficient: 0.66,
  },
  "宝石人": {
    embryoType: "不定型",
    introductionLine: "Gem-folk，矿物构成的种族，可参考宝石之国一类的设定。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 3, gestationSpeciesSpeed: 0.8, birthDifficulty: 3, breedTolerance: 1,
    impregnationDifficulty: 7, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 10,
  },
  "奈米丛族": {
    embryoType: "不定型",
    introductionLine: "Nanite Swarm，由亿级奈米机械单元构成的液态金属体。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 2, birthDifficulty: 1, breedTolerance: 1.5,
    impregnationDifficulty: 7, orgasmOvulationAmount: 0, identicalProbability: 1, genderRatio: null,
    companionEggsMean: 0, recoveryCoefficient: 0.34,
  },
  "元素灵": {
    embryoType: "不定型",
    introductionLine: "Elemental，自然元素的拟人体，如水元素温蒂妮。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 0.5, gestationSpeciesSpeed: 1, birthDifficulty: 0.5, breedTolerance: 1.25,
    impregnationDifficulty: 6, orgasmOvulationAmount: 0, identicalProbability: 5, genderRatio: -1,
    companionEggsMean: 0, recoveryCoefficient: 0.39,
  },
  "灯神": {
    embryoType: "不定型",
    introductionLine: "Djinn，阿拉丁神灯一类的愿望精灵。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1.5, gestationSpeciesSpeed: 0.66, birthDifficulty: 2, breedTolerance: 1.5,
    impregnationDifficulty: 5, orgasmOvulationAmount: 1, identicalProbability: 0, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2.02,
  },
  "影魔": {
    embryoType: "不定型",
    introductionLine: "Shadow-folk，可在平面与立体之间切换、投影于影中的种族。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.75, birthDifficulty: 0.6, breedTolerance: 1.25,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 0, identicalProbability: 33, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 0.64,
  },
  "活体铠甲": {
    embryoType: "不定型",
    introductionLine: "Living Armor，寄生型无性种族，附着于冒险者身上；将卵寄入宿主体内孵化，不自行孕育。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1.5, birthDifficulty: 1.5, breedTolerance: 1,
    impregnationDifficulty: 0.5, orgasmOvulationAmount: 4, identicalProbability: 15, genderRatio: -1,
    companionEggsMean: 5, recoveryCoefficient: 2,
  },
  "伪人": {
    embryoType: "不定型",
    introductionLine: "Doppelganger，模仿并取代人类的不定型种族；各项生理刻意贴近人类，同卵分裂倾向极高。",
    inheritanceMode: "normal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 1, birthDifficulty: 1, breedTolerance: 1,
    impregnationDifficulty: 3, orgasmOvulationAmount: 1, identicalProbability: 33, genderRatio: 50,
    companionEggsMean: 0, recoveryCoefficient: 2,
  },
  "核焰族": {
    embryoType: "不定型",
    introductionLine: "Fusionkin，体内燃着核聚变之火的等离子生命，概念近似 Starbound 的 Novakid 与漫威的活体星球 Ego。族中多为雄性，四处播种；雌核遗传——父方只是点燃的契机，如超新星的冲击触发星云坍缩，孩子的物质与形貌皆来自母体，唯有核焰族母亲这片恒星育婴室能孕育纯种的恒星之子。孕期漫长；如恒星常伴伴星般多生双胎，但从不同卵分裂。",
    inheritanceMode: "maternal",
    menstrualLengthRatio: 1, gestationSpeciesSpeed: 0.5, birthDifficulty: 2.5, breedTolerance: 1,
    impregnationDifficulty: 0.7, orgasmOvulationAmount: 1, identicalProbability: 0, genderRatio: 90,
    companionEggsMean: 0, recoveryCoefficient: 0.5,
  },
});

export const ALL_BUILTIN_RACES = Object.freeze(Object.keys(RACE_DEFINITIONS));

/**
 * 1.1.4 的改名：旧名在读取时一律换成新名（存档另由 state_migration 一次改写）。
 * 只列内置种族的基名，装饰子项（百足姬-赤）由 canonicalizeRaceName 保留。
 */
export const RACE_RENAMES = Object.freeze({
  百足姬: '百足氏',
  蝎罗: '蝎罗氏',
  植物亚人: '植物族',
  真菌亚人: '真菌族',
  月兔族: '月兔',
  狮鹫族: '狮鹫',
  蛙人: '蛙族',
  鸟人: '鸟族',
  兽人: '欧克',
  半兽人: '欧克',
});

// 以简体字形为键：模型写繁体、简体或混用都能对上内置名称
const RACE_NAME_LOOKUP = new Map([
  ...ALL_BUILTIN_RACES.map((race) => [toSimplifiedName(race), race]),
  ...Object.entries(RACE_RENAMES).map(([from, to]) => [toSimplifiedName(from), to]),
]);

/** 单一成分（可带 -装饰子项）的规范名；查不到的自订种族原样返回 */
export function canonicalizeRaceName(component) {
  const value = String(component || '').trim();
  if (!value) return '';
  const separatorIndex = value.indexOf('-');
  const base = separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : value;
  const subtype = separatorIndex >= 0 ? value.slice(separatorIndex) : '';
  return (RACE_NAME_LOOKUP.get(toSimplifiedName(base)) || base) + subtype;
}

/**
 * 整串种族描述的规范化：保留 [衍生] 前缀、x 分隔与 1/4、25% 之类的比例写法，只换种族与衍生的名称。
 * 存档迁移与 parseRaceDescriptor 共用。
 */
export function canonicalizeRaceDescriptor(rawRace) {
  const value = String(rawRace || '').trim();
  if (!value) return value;
  const derivedMatch = value.match(/^\[([^\]]+)\](.*)$/);
  const prefix = derivedMatch ? `[${canonicalizeDerivedTypeName(derivedMatch[1])}]` : '';
  const body = derivedMatch ? derivedMatch[2] : value;
  const canonicalBody = body.split(/([xX×])/).map((part, index) => {
    if (index % 2 === 1) return part;
    const match = part.match(/^(\s*(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*%)?\s*)(.*?)(\s*(?:\d+(?:\.\d+)?\s*%)?\s*)$/);
    if (!match || !match[2]) return part;
    return match[1] + canonicalizeRaceName(match[2]) + match[3];
  }).join('');
  return prefix + canonicalBody;
}
const racesByEmbryoType = (type) => Object.freeze(ALL_BUILTIN_RACES.filter((race) => RACE_DEFINITIONS[race].embryoType === type));
export const VIVIPAROUS_RACES = racesByEmbryoType("胎生");
export const OVIPAROUS_RACES = racesByEmbryoType("卵生");
export const OVOVIVIPAROUS_RACES = racesByEmbryoType("卵胎生");
export const METOVIVIPAROUS_RACES = racesByEmbryoType("胎转卵生");
export const AMORPHOUS_RACES = racesByEmbryoType("不定型");

const BASE_PHYSIOLOGY_FIELDS = RACE_PHYSIOLOGY_FIELDS.filter((field) => field !== "companionEggsMean" && field !== "recoveryCoefficient");
/** 只含八项基础生理数值的内置表（伴生卵、恢复系数、核型与胚型见 getBuiltinRacePhysiologyProfile） */
export const RACE_PHYSIOLOGY_PROFILES = Object.freeze(Object.fromEntries(ALL_BUILTIN_RACES.map((race) => [
  race,
  Object.fromEntries(BASE_PHYSIOLOGY_FIELDS.map((field) => [field, RACE_DEFINITIONS[race][field]])),
])));

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
  "序列",
  "兽化",
  "咒缚"
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
  "序列": "Secondary Dynamics，在原有性别与种族之外具有第二生理或精神序列的个体；涵盖 ABO、哨兵／向导与 Dom／Sub Universe。",
  "兽化": "Therian，原种族个体带有动物性身体特征与本能；程度可仅有兽耳、尾巴、敏锐感官与发情周期，也可进一步半兽化或化为完整兽形。",
  "咒缚": "Hexbound，先祖与某个存在立约、诅咒随血脉代代相传的一族，近似整个家系都签了约的邪术师（Warlock）；契约主常伴左右，无论本人意愿。",
});

export const DERIVED_TYPE_INHERITANCE_PROFILES = Object.freeze({
  "修炼": Object.freeze({
    inheritanceSpeed: 0.8
  }),
  "魔导": Object.freeze({
    inheritanceSpeed: 1.0
  }),
  "妖怪": Object.freeze({
    inheritanceSpeed: 1.25
  }),
  "神祇": Object.freeze({
    inheritanceSpeed: 0.25
  }),
  "不死": Object.freeze({
    inheritanceSpeed: 2.5
  }),
  "血族": Object.freeze({
    inheritanceSpeed: 1.9
  }),
  "星际": Object.freeze({
    inheritanceSpeed: 1.7
  }),
  "机械": Object.freeze({
    inheritanceSpeed: 0.5
  }),
  "器灵": Object.freeze({
    inheritanceSpeed: 0.65
  }),
  "变异": Object.freeze({
    inheritanceSpeed: 1.55
  }),
  "序列": Object.freeze({
    inheritanceSpeed: 1.1
  }),
  "兽化": Object.freeze({
    inheritanceSpeed: 1.4
  }),
  // 整个家系都在约中：遗传速度取系统上限，最难摆脱
  "咒缚": Object.freeze({
    inheritanceSpeed: 3
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
    fluxName: "序列活性",
    fluxDefinition: "原有性别与种族之外的第二生理或精神序列活跃度；子项可写作序列-ABO、序列-哨兵、序列-向导、序列-Dom或序列-Sub。\n[平衡] 序列特征稳定，个体能控制本能并维持健康界线；ABO的信息素、哨兵／向导的感官与精神连结、Dom／Sub的支配服从需求皆能正常调节。\n[正极] 表现为‘序列过载’：本能与感官压倒理性；ABO进入发情或易感，哨兵感官暴走、向导精神海泛滥，Dom／Sub则出现无法克制的命令或服从冲动。\n[负极] 表现为‘序列失衡’：配对、疏导或回馈长期缺失；可表现为信息素紊乱、精神屏障崩解、感官封闭、Drop／Subdrop，以及强烈的被排斥感与自我认同动摇。"
  }),
  "兽化": Object.freeze({
    fluxName: "兽性",
    fluxDefinition: "动物性身体特征、感官与本能的显化程度；轻度可仅有兽耳、尾巴、发情周期与动物习性，重度可进入半兽或完整兽形。\n[平衡] 兽征与人性自然协调，感官、本能和社会行为皆可自主控制。\n[正极] 表现为‘野性显化’：兽耳、尾巴、爪牙或体毛更鲜明，发情、护群、领地、追猎等本能增强；重度者会进入半兽或纯兽形态。\n[负极] 表现为‘本能失调’：兽征萎靡、感官错乱、尾耳失去控制；个体既无法顺从动物本能，也难以适应纯人类行为，产生强烈的身分残缺与不安。"
  }),
  "咒缚": Object.freeze({
    fluxName: "咒蚀",
    fluxDefinition: "先祖与契约主立下、随血脉代代相传的咒缚之力；后代一出生即在约中，契约主始终随侍在侧，无论本人意愿。子项可写作咒缚-深渊、咒缚-妖精等，标明契约主。后代由契约哺育，乳意不单独追踪。\n[平衡] 咒印沉睡、契约静默；代价按约支付，借来的力量运用自如，与契约主的低语维持着彼此心知肚明的距离。\n[正极] 表现为‘咒印反噬’：生理上咒纹自体表蔓延、灼热发光，瞳色或声线染上契约主的特征；心理上契约主的意志渗入，言行带着不属于自己的古老口吻，为履约不择手段，视违约者与阻碍者为必须清偿的债。\n[负极] 表现为‘欠契追讨’：生理上体力衰败、伤口难愈、厄运缠身，咒纹转为溃烂的黑痕，连血亲也开始出现同样的征兆；心理上被‘全族都被拖下水’的愧疚与恐惧折磨，焦躁地寻找还债或毁约的方法，对契约主的低语既抗拒又依赖。"
  })
});

export const DERIVED_TYPE_METABOLISM_EXEMPTIONS = Object.freeze({
  // 以血为食，没有消化残渣
  "血族": Object.freeze(["hunger", "excretion"]),
  // 死躯不眠、不泌乳；尸身照样有气味
  "不死": Object.freeze(["sleep", "milk"]),
  // 辟谷、闭关清修
  "修炼": Object.freeze(["hunger", "companionship"]),
  // 冥想代替睡眠，清洁术处理体味
  "魔导": Object.freeze(["sleep", "odor"]),
  // 不食人间烟火、没有人气；怕被遗忘，仍要人陪
  "妖怪": Object.freeze(["hunger", "odor"]),
  // 神体无垢、不眠；照样享用供品
  "神祇": Object.freeze(["excretion", "sleep"]),
  // 不进食、不泌乳；排泄与体味对应冷却液与机油
  "机械": Object.freeze(["hunger", "milk"]),
  // 器物不食不眠
  "器灵": Object.freeze(["hunger", "sleep"]),
  // 蜂群意识轮替休眠，母体网路即陪伴
  "星际": Object.freeze(["sleep", "companionship"]),
  // 辐射般改写的体质：腺体失能，不泌乳、不生体味
  "变异": Object.freeze(["milk", "odor"]),
  // 信息素与配对连结比体味和陪伴更全面，由序列本身调节
  "序列": Object.freeze(["odor", "companionship"]),
  // 理毛自洁，排泄当作领地标记；乳意保留
  "兽化": Object.freeze(["excretion", "odor"]),
  // 契约主随侍在侧，后代由契约哺育
  "咒缚": Object.freeze(["milk", "companionship"]),
});

let customRacePhysiologyProfiles = {};
let customDerivedTypeProfiles = {};

export function sanitizeDerivedTypeProfilePatch(profile) {
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

export function sanitizeRacePhysiologyProfilePatch(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const result = {};
  if (Object.prototype.hasOwnProperty.call(profile, RACE_INTRODUCTION_FIELD)) {
    const introductionLine = String(profile[RACE_INTRODUCTION_FIELD] || '').trim();
    if (introductionLine) result[RACE_INTRODUCTION_FIELD] = introductionLine;
  }
  if (Object.prototype.hasOwnProperty.call(profile, RACE_INHERITANCE_FIELD)) {
    const inheritanceMode = String(profile[RACE_INHERITANCE_FIELD] || '').trim();
    if (Object.values(RACE_INHERITANCE_MODES).includes(inheritanceMode)) {
      result[RACE_INHERITANCE_FIELD] = inheritanceMode;
    }
  }
  if (Object.prototype.hasOwnProperty.call(profile, RACE_EMBRYO_TYPE_FIELD)) {
    const embryoType = String(profile[RACE_EMBRYO_TYPE_FIELD] || '').trim();
    if (EMBRYO_TYPES.includes(embryoType)) result[RACE_EMBRYO_TYPE_FIELD] = embryoType;
  }
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    if (field === 'genderRatio' && profile[field] === null) {
      result[field] = null;
      continue;
    }
    const value = Number(profile[field]);
    if (!Number.isFinite(value)) continue;
    if (field === 'genderRatio') result[field] = Math.max(-1, Math.min(100, Math.round(value)));
    else if (field === 'orgasmOvulationAmount') result[field] = Math.max(0, Math.round(value));
    else if (field === 'companionEggsMean') result[field] = Math.max(0, Math.min(9999, Math.round(value)));
    else if (field === 'identicalProbability') result[field] = Math.max(0, Math.min(100, value));
    else if (field === 'recoveryCoefficient') result[field] = Math.max(0.01, Math.min(100, value));
    else result[field] = Math.max(0, value);
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function setRacePhysiologyOverrides(overrides = {}) {
  const next = {};
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [race, profile] of Object.entries(overrides)) {
      const key = getBaseRaceName(race);
      const patch = sanitizeRacePhysiologyProfilePatch(profile);
      if (key && patch) next[key] = Object.freeze(patch);
    }
  }
  customRacePhysiologyProfiles = Object.freeze(next);
}

export function getRacePhysiologyOverride(race) {
  const key = getBaseRaceName(race);
  const profile = customRacePhysiologyProfiles[key];
  return profile ? { ...profile } : null;
}

/**
 * 把覆写表的键位收敛成执行期真正用来查表的基名。
 *
 * 覆写生效时走的是基名（getBaseRaceName / getBaseDerivedTypeName），
 * 但覆写被写进设定档时用的是使用者当下选到的字串——带子项、带别名、带空白都算数。
 * 键与查法对不上时覆写照样生效，UI 的「恢复内置」却删不到那一笔，
 * 使用者只剩下手动翻 SillyTavern 设定档这条路。这里让「存」与「查」走同一个基名。
 */
function rekeyOverrideMap(overrides, toBaseName) {
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  const result = {};
  for (const [rawKey, profile] of Object.entries(source)) {
    const key = toBaseName(rawKey);
    if (!key || !profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    // 同一基名下的多笔旧键合并，后写入的栏位盖过先前的；宁可留下一笔可删的覆写，
    // 也不要在正规化时凭空丢掉使用者设定过的数值。
    result[key] = { ...(result[key] || {}), ...profile };
  }
  return result;
}

function removeOverrideEntry(overrides, name, toBaseName) {
  const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};
  const target = toBaseName(name);
  const result = {};
  for (const [rawKey, profile] of Object.entries(source)) {
    // 连同所有会正规化到同一基名的旧键一起删，否则删完重开又被旧键喂回来。
    if (target && toBaseName(rawKey) === target) continue;
    result[rawKey] = profile;
  }
  return result;
}

export function normalizeRaceOverrideMap(overrides) {
  return rekeyOverrideMap(overrides, getBaseRaceName);
}

export function normalizeDerivedOverrideMap(overrides) {
  return rekeyOverrideMap(overrides, getBaseDerivedTypeName);
}

export function removeRaceOverrideEntry(overrides, race) {
  return removeOverrideEntry(overrides, race, getBaseRaceName);
}

export function removeDerivedOverrideEntry(overrides, derivedType) {
  return removeOverrideEntry(overrides, derivedType, getBaseDerivedTypeName);
}

export function getBuiltinRacePhysiologyProfile(race) {
  const key = getBaseRaceName(race);
  const definition = Object.prototype.hasOwnProperty.call(RACE_DEFINITIONS, key) ? RACE_DEFINITIONS[key] : null;
  if (!definition) return null;
  // 短敘述走 getRaceIntroductionLine，不混进生理资料
  const { [RACE_INTRODUCTION_FIELD]: _introductionLine, ...profile } = definition;
  return profile;
}

/** 只看内置的短敘述，不含百科覆写；百科编辑器用来预填与比对差异 */
export function getBuiltinRaceIntroductionLine(race) {
  return String(RACE_DEFINITIONS[getBaseRaceName(race)]?.[RACE_INTRODUCTION_FIELD] || '').trim();
}

export function getRaceIntroductionLine(race) {
  const key = getBaseRaceName(race);
  if (!key) return '';
  const customLine = customRacePhysiologyProfiles[key]?.[RACE_INTRODUCTION_FIELD];
  if (customLine !== undefined) return String(customLine || '').trim();
  return String(RACE_DEFINITIONS[key]?.[RACE_INTRODUCTION_FIELD] || '').trim();
}

function getEffectiveRacePhysiologyProfileValue(race) {
  const key = getBaseRaceName(race);
  const builtin = getBuiltinRacePhysiologyProfile(key);
  if (!builtin) return null;
  return {
    ...builtin,
    ...(customRacePhysiologyProfiles[key] || {}),
  };
}

export function getRacePhysiologyProfile(race) {
  const key = getBaseRaceName(race);
  const profile = getEffectiveRacePhysiologyProfileValue(key);
  return profile ? { ...profile } : null;
}

/**
 * 名录勾选的存档版本。v2 起人类与其他物种一样可勾选；v1（1.1.3 以前）的勾选里从来没有人类，
 * 因为当时人类恒被视为可用。读到 v1 时：有勾任何项目的视为奇幻设定，补回人类；
 * 全部清空的视为现代设定，维持不送人类。
 */
export const RACE_CATALOG_SELECTION_VERSION = 2;

export function normalizeRaceCatalogSelection(selection) {
  if (!selection || typeof selection !== 'object' || !Array.isArray(selection.races) || !Array.isArray(selection.derivedTypes)) return null;
  const races = [...new Set(selection.races.map((race) => canonicalizeRaceName(race)).filter(Boolean))];
  const derivedTypes = [...new Set(selection.derivedTypes.map((type) => canonicalizeDerivedTypeName(type)).filter(Boolean))];
  if (selection.version !== RACE_CATALOG_SELECTION_VERSION && (races.length > 0 || derivedTypes.length > 0) && !races.includes('人类')) {
    races.unshift('人类');
  }
  return { version: RACE_CATALOG_SELECTION_VERSION, races, derivedTypes };
}

/** 没有勾选设定时全部启用 */
export function isRaceInCatalogSelection(selection, race) {
  const normalized = normalizeRaceCatalogSelection(selection);
  return !normalized || normalized.races.includes(race);
}

/** 内置物种按「当前生效」的胚型分组（百科改过胚型的物种会移到新组） */
export function getRaceGroupsByEmbryoType() {
  const groups = new Map(EMBRYO_TYPES.map((type) => [type, []]));
  for (const race of ALL_BUILTIN_RACES) {
    const type = getEffectiveRacePhysiologyProfileValue(race)?.[RACE_EMBRYO_TYPE_FIELD];
    groups.get(EMBRYO_TYPES.includes(type) ? type : '胎生').push(race);
  }
  return EMBRYO_TYPES.map((type) => ({ label: type, races: groups.get(type) }));
}

// 活力等级 1-7：一推就倒 … 无坚不摧
const POSTPARTUM_VITALITY_FACTORS = Object.freeze([1.5, 1.3, 1.15, 1.0, 0.9, 0.85, 0.75]);

function getPostpartumParityFactor(priorBirths) {
  const count = Math.max(0, Math.floor(Number(priorBirths) || 0));
  if (count === 0) return 1.0;
  return count <= 3 ? 0.9 : 1.1;
}

/**
 * 产后恢复天数 = 56 × 恢复系数 × 活力因子 × 经产因子 × 胎数因子（× 流产的孕程比例）。
 * 恢复系数只看母体物种；不看妊娠速度、分娩难度、承载耐受与胚型。
 * - priorBirths：这次之前的分娩次数（自然＋手术），不含流产
 * - fetusCount：这次娩出的胎数，不含伴生卵
 * - progressRatio：流产时的孕程比例（有效孕日／280）；足月分娩传 1
 * - atonyLevel：子宫乏力级数（反复延产留下），每级恢复期多 10%
 */
export function computePostpartumRecoveryDays({
  recoveryCoefficient = 1,
  vitalityLevel = 4,
  priorBirths = 0,
  fetusCount = 1,
  progressRatio = 1,
  atonyLevel = 0,
} = {}) {
  const coefficient = Number.isFinite(Number(recoveryCoefficient)) && Number(recoveryCoefficient) > 0 ? Number(recoveryCoefficient) : 1;
  const level = Math.max(1, Math.min(7, Math.round(Number(vitalityLevel) || 4)));
  const count = Math.max(1, Math.floor(Number(fetusCount) || 1));
  const fetusFactor = Math.min(2, 1 + (0.15 * (count - 1)));
  const progress = Number.isFinite(Number(progressRatio)) ? Math.max(0.25, Math.min(1, Number(progressRatio))) : 1;
  const atony = 1 + 0.1 * Math.max(0, Math.floor(Number(atonyLevel) || 0));
  const days = 56 * coefficient * POSTPARTUM_VITALITY_FACTORS[level - 1] * getPostpartumParityFactor(priorBirths) * fetusFactor * progress * atony;
  return Math.max(1, Math.round(days));
}

/** 母体的恢复系数：混血取各成分平均，衍生类型不参与；未收录的种族按 1 */
export function getRecoveryCoefficientByRace(race, bloodline = null) {
  const value = Number(getMergedRacePhysiologyProfile(race, bloodline)?.recoveryCoefficient);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** 衍生类型的繁体写法映射到简体基名，模型写哪种字形都认得 */
const DERIVED_TYPE_LOOKUP = new Map(DERIVED_TYPE_RACES.map((type) => [toSimplifiedName(type), type]));

/** 衍生类型（可带 -子项）的规范名；繁体、简体都认得 */
export function canonicalizeDerivedTypeName(derivedType) {
  const value = String(derivedType || '').trim();
  if (!value) return '';
  const separatorIndex = value.indexOf('-');
  const base = separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : value;
  const subtype = separatorIndex >= 0 ? value.slice(separatorIndex) : '';
  return (DERIVED_TYPE_LOOKUP.get(toSimplifiedName(base)) || base) + subtype;
}

export function getBaseDerivedTypeName(derivedType) {
  const value = String(derivedType || '').trim();
  if (!value) return '';
  const subtypeMatch = value.match(/^(.+?)-(.+)$/);
  const base = subtypeMatch ? subtypeMatch[1].trim() : value;
  return DERIVED_TYPE_LOOKUP.get(toSimplifiedName(base)) || base;
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
  const value = canonicalizeRaceDescriptor(rawRace);
  if (!value) {
    return {
      race: '',
      derivedType: null,
    };
  }
  const derivedMatch = value.match(/^\[([^\]]+)\](.+)$/);
  if (!derivedMatch) {
    const weighted = parseWeightedRaceText(value);
    return {
      race: weighted?.race || value,
      derivedType: null,
      ...(weighted ? { bloodline: weighted.bloodline } : {}),
    };
  }
  const weighted = parseWeightedRaceText(String(derivedMatch[2] || '').trim());
  return {
    race: weighted?.race || String(derivedMatch[2] || '').trim(),
    derivedType: String(derivedMatch[1] || '').trim() || null,
    ...(weighted ? { bloodline: weighted.bloodline } : {}),
  };
}

/** 支持「1/4精灵x3/4人类」「精灵25%x人类75%」；缺失份额不得猜成某个种族。 */
function parseWeightedRaceText(value) {
  const parts = value.split(/[xX×]/).map((part) => part.trim()).filter(Boolean);
  let hasWeight = false;
  const entries = parts.map((part) => {
    const fraction = part.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(.+)$/);
    const percent = part.match(/^(\d+(?:\.\d+)?)\s*%\s*(.+)$/);
    const suffix = part.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*%$/);
    if (fraction) { hasWeight = true; return [fraction[3].trim(), Number(fraction[1]) / Number(fraction[2])]; }
    if (percent) { hasWeight = true; return [percent[2].trim(), Number(percent[1]) / 100]; }
    if (suffix) { hasWeight = true; return [suffix[1].trim(), Number(suffix[2]) / 100]; }
    return [part, null];
  });
  if (!hasWeight) return null;
  const specified = entries.reduce((sum, [, weight]) => sum + (weight ?? 0), 0);
  const missing = entries.filter(([, weight]) => weight === null).length;
  if (!Number.isFinite(specified) || specified < 0 || specified > 1 + 1e-9) return null;
  // 单写 1/4精灵时，剩余血脉记为未知，而不是错误地归一化成纯精灵。
  if (!missing && specified < 1 - 1e-9) entries.push(['未知', 1 - specified]);
  const weights = new Map();
  for (const [name, value] of entries) {
    const weight = value === null ? Math.max(0, 1 - specified) / missing : value;
    if (name && weight > 0) weights.set(name, (weights.get(name) || 0) + weight);
  }
  if (!weights.size) return null;
  return { race: [...weights.keys()].join('x'), bloodline: Object.fromEntries(weights) };
}

/** 比例为 0..1；字串旧档按基种族均分，装饰子项分享该基种族的份额。 */
export function getBloodlineInfo(race, bloodline = null, source = null) {
  const parsed = parseRaceDescriptor(race);
  const parts = [...new Set(getRaceDescriptorComponents(parsed.race))];
  const raw = bloodline ?? parsed.bloodline;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const merged = new Map();
    for (const [key, value] of Object.entries(raw)) {
      const name = canonicalizeRaceName(key);
      merged.set(name, merged.has(name) && typeof value === 'number' ? merged.get(name) + value : value);
    }
    const entries = [...merged];
    const allowed = new Set(parts);
    const valid = entries.length > 0 && entries.every(([key, value]) => allowed.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const sum = valid ? entries.reduce((total, [, value]) => total + value, 0) : 0;
    if (Number.isFinite(sum) && sum > 0) {
      return {
        bloodline: Object.fromEntries(entries.filter(([, value]) => value > 0).map(([key, value]) => [key, value / sum])),
        bloodlineSource: ['explicit', 'inherited', 'estimated', 'pure'].includes(source) ? source : 'explicit',
      };
    }
  }
  const bases = new Map();
  for (const part of parts) {
    const key = getBaseRaceComponentName(part);
    if (!bases.has(key)) bases.set(key, []);
    bases.get(key).push(part);
  }
  return {
    bloodline: Object.fromEntries([...bases.values()].flatMap((variants) => variants.map((part) => [part, 1 / bases.size / variants.length]))),
    bloodlineSource: parts.length <= 1 ? 'pure' : 'estimated',
  };
}

export function normalizeBloodline(race, bloodline = null) {
  return getBloodlineInfo(race, bloodline).bloodline;
}

export function formatBloodline(race, bloodline = null, source = null) {
  const info = getBloodlineInfo(race, bloodline, source);
  const text = Object.entries(info.bloodline).map(([name, value]) => {
    const percent = value * 100;
    const label = percent >= 0.01 ? String(Number(percent.toFixed(2))) : percent.toPrecision(2);
    return `${name} ${label}%`;
  }).join(' · ');
  return text + (text && info.bloodlineSource === 'estimated' ? '（比例推定）' : '');
}

/** 普通遗传父母各半；核型沿用现有九格规则，只取被选中的遗传方。 */
export function deriveFetusAncestry(egg, sperm) {
  const eggRecord = typeof egg === 'string' ? { race: egg } : egg || {};
  const spermRecord = typeof sperm === 'string' ? { race: sperm } : sperm || {};
  const eggRace = eggRecord.race || '人类', spermRace = spermRecord.race || eggRace;
  const eggMode = getRaceInheritanceMode(eggRace), spermMode = getRaceInheritanceMode(spermRace);
  let parents = [spermRecord, eggRecord];
  if ((eggMode !== RACE_INHERITANCE_MODES.NORMAL) !== (spermMode !== RACE_INHERITANCE_MODES.NORMAL)) {
    const activeMode = eggMode !== RACE_INHERITANCE_MODES.NORMAL ? eggMode : spermMode;
    parents = [activeMode === RACE_INHERITANCE_MODES.PATERNAL ? spermRecord : eggRecord];
  }
  const infos = parents.map((parent) => getBloodlineInfo(parent.race || '人类', parent.bloodline, parent.bloodlineSource));
  const weights = new Map();
  for (const info of infos) for (const [name, value] of Object.entries(info.bloodline)) weights.set(name, (weights.get(name) || 0) + value / infos.length);
  return {
    race: [...weights.keys()].join('x') || '人类',
    bloodline: Object.fromEntries(weights),
    bloodlineSource: infos.some((info) => info.bloodlineSource === 'estimated') ? 'estimated' : 'inherited',
  };
}

/** 嵌合体按参与受精卵数量加权，三个来源不能因融合顺序变成 1/4、1/4、1/2。 */
export function mergeFetusAncestry(fetuses) {
  const weights = new Map();
  let total = 0, estimated = false;
  for (const fetus of fetuses) {
    const count = Math.max(1, Number(fetus?.chimera?.sourceCount) || 1);
    const info = getBloodlineInfo(fetus?.race, fetus?.bloodline, fetus?.bloodlineSource);
    estimated ||= info.bloodlineSource === 'estimated';
    for (const [name, value] of Object.entries(info.bloodline)) weights.set(name, (weights.get(name) || 0) + value * count);
    total += count;
  }
  return { bloodline: Object.fromEntries([...weights].map(([name, value]) => [name, value / total])), bloodlineSource: estimated ? 'estimated' : 'inherited' };
}

function getWeightedRaceParts(race, bloodline) {
  const totals = new Map();
  for (const [name, weight] of Object.entries(normalizeBloodline(race, bloodline))) {
    const base = getBaseRaceComponentName(name);
    totals.set(base, (totals.get(base) || 0) + weight);
  }
  return [...totals].map(([name, weight]) => ({ name, weight }));
}

function canonicalizeRaceComponent(component) {
  return canonicalizeRaceName(component);
}

export function getRaceDescriptorComponents(race) {
  const value = parseRaceDescriptor(race).race;
  if (!value) return [];
  return value.split(/[xX×]/).map(canonicalizeRaceComponent).filter(Boolean);
}

function getBaseRaceComponentName(component) {
  const value = canonicalizeRaceComponent(component);
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

/** 双性成分合计达到这个血脉份额，后代才固定为双性 */
const HERMAPHRODITE_BLOODLINE_THRESHOLD = 0.25;

/**
 * 性别比按血脉份额加权。双性优先于数值平均：多一套器官是稳定的身体构造，
 * 否则「史莱姆x人类」会被平均成普通男女，双性只剩嵌合体那条 20% 的路径；
 * 但份额要够——祖先只剩零点几成的双性血统，不该让每一代都固定双性。
 * 无性不比照办理——它是「少一套」的减法，让触手怪x人类的后代全部绝育过重。
 */
function mergeWeightedGenderRatio(genders) {
  const hermaphroditeShare = genders.filter(({ value }) => value === null).reduce((sum, item) => sum + item.weight, 0);
  if (hermaphroditeShare >= HERMAPHRODITE_BLOODLINE_THRESHOLD - 1e-9) return null;
  const normal = genders.filter(({ value }) => Number.isFinite(value) && value >= 0 && value <= 100);
  const normalWeight = normal.reduce((sum, item) => sum + item.weight, 0);
  if (normal.length > 0 && normalWeight > 0) return normal.reduce((sum, item) => sum + item.value * item.weight, 0) / normalWeight;
  if (genders.some(({ value }) => value === -1)) return -1;
  return 50;
}

export function getMergedRacePhysiologyProfile(race, bloodline = null) {
  const parts = getWeightedRaceParts(race, bloodline);
  if (parts.length === 0) return null;

  const profiles = parts
    .map((part) => ({ profile: getRacePhysiologyProfile(part.name), weight: part.weight }))
    .filter(({ profile }) => profile && typeof profile === 'object');
  if (profiles.length === 0) return null;

  const merged = {};
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    if (field === 'genderRatio' || field === 'companionEggsMean') continue;
    const values = profiles
      .map(({ profile, weight }) => ({ value: Number(profile[field]), weight }))
      .filter(({ value }) => Number.isFinite(value));
    if (values.length > 0) {
      const valid = field === 'gestationSpeciesSpeed' ? values.filter(({ value }) => value > 0) : values;
      const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight > 0) {
        const mean = valid.reduce((sum, item) => sum + item.weight * (field === 'gestationSpeciesSpeed' ? 280 / item.value : item.value), 0) / totalWeight;
        merged[field] = field === 'gestationSpeciesSpeed' ? 280 / mean : mean;
      }
    }
  }

  merged.companionEggsMean = getCompanionEggsMeanByRace(race, bloodline);
  merged.genderRatio = mergeWeightedGenderRatio(profiles.map(({ profile, weight }) => ({ value: profile.genderRatio, weight })));
  // 核型不按生理数值混合；任何复合种族都回归一般遗传。
  merged[RACE_INHERITANCE_FIELD] = RACE_INHERITANCE_MODES.NORMAL;
  // 存在未收录的混血成分：不静默丢弃，标记出来让提示词明确「数值仅供参考」
  if (profiles.length < parts.length) merged.hasUnknownRace = true;
  return merged;
}

export function getRaceInheritanceMode(race) {
  const descriptorParts = getRaceDescriptorComponents(race);
  if (descriptorParts.length !== 1) return RACE_INHERITANCE_MODES.NORMAL;
  const key = getBaseRaceComponentName(descriptorParts[0]);
  const profile = getEffectiveRacePhysiologyProfileValue(key);
  const mode = String(profile?.[RACE_INHERITANCE_FIELD] || '');
  return Object.values(RACE_INHERITANCE_MODES).includes(mode)
    ? mode
    : RACE_INHERITANCE_MODES.NORMAL;
}

function combineRaceDescriptors(spermRace, eggRace) {
  const combined = [
    ...getRaceDescriptorComponents(spermRace),
    ...getRaceDescriptorComponents(eggRace),
  ].filter(Boolean);
  if (combined.length === 0) return '人类';
  return [...new Set(combined)].join('x');
}

/**
 * 依精方与卵方的核型决定胎儿种族。只有一方具核型时，雄核保留精方、雌核保留卵方；
 * 双方皆一般或皆具核型时形成混血。混血亲本本身一律按一般处理。
 */
export function deriveFetusRace(eggRace, spermRace) {
  const eggMode = getRaceInheritanceMode(eggRace);
  const spermMode = getRaceInheritanceMode(spermRace);
  const eggHasNucleus = eggMode !== RACE_INHERITANCE_MODES.NORMAL;
  const spermHasNucleus = spermMode !== RACE_INHERITANCE_MODES.NORMAL;

  if (eggHasNucleus !== spermHasNucleus) {
    const activeMode = eggHasNucleus ? eggMode : spermMode;
    const selectedRace = activeMode === RACE_INHERITANCE_MODES.PATERNAL ? spermRace : eggRace;
    const selectedParts = getRaceDescriptorComponents(selectedRace);
    if (selectedParts.length > 0) return [...new Set(selectedParts)].join('x');
  }
  return combineRaceDescriptors(spermRace, eggRace);
}

/**
 * 只有精卵双方恰有一方使用特殊核型时，胚胎才属于雄核或雌核发生。
 * 双方皆一般或双方皆有特殊核型时依九格规则形成混血，不附核型标签。
 */
export function getFetusInheritanceTag(eggRace, spermRace) {
  const eggMode = getRaceInheritanceMode(eggRace);
  const spermMode = getRaceInheritanceMode(spermRace);
  const eggHasNucleus = eggMode !== RACE_INHERITANCE_MODES.NORMAL;
  const spermHasNucleus = spermMode !== RACE_INHERITANCE_MODES.NORMAL;
  if (eggHasNucleus === spermHasNucleus) return null;
  const activeMode = eggHasNucleus ? eggMode : spermMode;
  return activeMode === RACE_INHERITANCE_MODES.PATERNAL ? 'androgenesis' : 'gynogenesis';
}

/**
 * 混血胚型：血脉占比最高的成分决定；占比相同时取孕期较长（gestationSpeciesSpeed 较低）的，
 * 仍相同再取母系（卵源）占比较高的，都相同则按种族写法的先后。
 */
export function getEmbryoTypeByRace(race, bloodline = null, motherBloodline = null) {
  const parts = getWeightedRaceParts(race, bloodline);
  if (parts.length === 0) return '胎生';
  const motherShares = new Map(motherBloodline && typeof motherBloodline === 'object'
    ? getWeightedRaceParts(Object.keys(motherBloodline).join('x'), motherBloodline).map((part) => [part.name, part.weight]) : []);
  const gestationSpeed = (name) => {
    const value = Number(getEffectiveRacePhysiologyProfileValue(name)?.gestationSpeciesSpeed);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  const EPSILON = 1e-9;
  let dominant = parts[0];
  for (const part of parts.slice(1)) {
    const shareDiff = part.weight - dominant.weight;
    if (Math.abs(shareDiff) > EPSILON) { if (shareDiff > 0) dominant = part; continue; }
    const speedDiff = gestationSpeed(part.name) - gestationSpeed(dominant.name);
    if (Math.abs(speedDiff) > EPSILON) { if (speedDiff < 0) dominant = part; continue; }
    if ((motherShares.get(part.name) || 0) > (motherShares.get(dominant.name) || 0) + EPSILON) dominant = part;
  }
  const dominantRace = dominant.name;

  // 百科可以改胚型：先看生效中的覆写，没有覆写才落回内置分组
  const embryoType = getEffectiveRacePhysiologyProfileValue(dominantRace)?.[RACE_EMBRYO_TYPE_FIELD];
  return EMBRYO_TYPES.includes(embryoType) ? embryoType : '胎生';
}

/**
 * 混血胚型见 getEmbryoTypeByRace：占比最高者决定，平手看孕期长短，再看母系。
 * 胎生与胎转卵生恒无伴生卵；其余类型在「整群＝伴生卵＋1」的尺度上对所有成分做几何平均再减一，
 * 与旧的卵群几何平均完全一致（全为 0 的仍是 0）。
 */
export function getCompanionEggsMeanByRace(race, bloodline = null, motherBloodline = null) {
  const embryoType = getEmbryoTypeByRace(race, bloodline, motherBloodline);
  if (embryoType === '胎生' || embryoType === '胎转卵生') return 0;
  const parts = getWeightedRaceParts(race, bloodline);
  if (parts.length === 0) return 0;
  const clutches = parts.map((part) => {
    const profile = getEffectiveRacePhysiologyProfileValue(part.name);
    const value = Number(profile?.companionEggsMean);
    return { value: (Number.isFinite(value) && value >= 0 ? value : 0) + 1, weight: part.weight };
  });
  const clutch = clutches.length === 1
    ? clutches[0].value
    : Math.exp(clutches.reduce((sum, item) => sum + item.weight * Math.log(item.value), 0));
  return Math.max(0, clutch - 1);
}

/**
 * 精液量 20 视为标准剂量；10／20／30／40 分别对应 0.75／1／1.25／1.5 倍的整群规模。
 * 这里只读取受精当下的有效量，不代表液体被胚胎消耗。
 */
export function getSpermDoseCompanionMultiplier(spermValue = 20) {
  const dose = Number.isFinite(Number(spermValue)) ? Math.max(0, Number(spermValue)) : 20;
  return Math.max(0.5, Math.min(1.5, 0.5 + (dose / 40)));
}

export function getSpermDoseDifficultyBonus(totalSperm) {
  const dose = Number.isFinite(Number(totalSperm)) ? Math.max(0, Number(totalSperm)) : 0;
  return Math.max(0.5, Math.min(2, Math.sqrt(dose / 20)));
}

/**
 * 每个独立受精形成的有效胚胎抽一次并落盘。在「整群＝伴生卵＋1」的尺度上乘精液倍率与 ±10% 波动，
 * 取整后再减一，分布与旧卵群完全相同。均值 0 是硬特例：任何浮动或倍率都不会凭空产生伴生卵。
 */
export function rollCompanionEggCount(race, random = Math.random, spermValue = 20, bloodline = null, motherBloodline = null) {
  const mean = getCompanionEggsMeanByRace(race, bloodline, motherBloodline);
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const variation = 0.9 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.2);
  const clutch = (mean + 1) * getSpermDoseCompanionMultiplier(spermValue) * variation;
  return Math.max(0, Math.min(12499, Math.round(clutch) - 1));
}
