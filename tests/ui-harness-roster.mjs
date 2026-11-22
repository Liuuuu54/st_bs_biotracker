// UI 测试页的种子名单：一人一个主题，种族、衍生、身材、衣着、胎儿都拉开（规划见 plan/UI_HARNESS_ROSTER_PLAN.md）。
// 角色以 createDefaultFemaleState 为底（栏位齐全，推进时间不报错）；衣着、转化、回归、经历样本走公开工具实际套用，不手填结果。

import { createDefaultFemaleState } from '/scripts/state.js';
import { applyToolCall } from '/scripts/tools.js';
import { getRacePhysiologyProfile } from '/scripts/race_config.js';

export const USER_NAME = '旅人';

const isPlain = (value) => value && typeof value === 'object' && !Array.isArray(value);
function merge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (isPlain(value) && isPlain(target[key])) merge(target[key], value);
    else target[key] = value;
  }
  return target;
}

/** 卵方：overrides 依 profile 结构深合并（阵列整个取代） */
function female(name, overrides = {}) {
  const character = createDefaultFemaleState(name);
  character.initialized = true;
  character.updatedAt = Date.now();
  merge(character.profile, overrides);
  return character;
}

let fetusSeq = 0;
/** 胎儿：给定的栏位覆盖预设 */
const fetus = (fields = {}) => ({
  embryoId: ++fetusSeq, fathers: '凯', fatherRace: '人类', race: '人类', embryoType: '胎生', gender: '女',
  weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, descentStage: -2, health: 60, healthMax: 100,
  maternalDerivedTypeProgress: 0, fusionCheckedWith: [], tags: [], talents: [], ...fields,
});

/** 妊娠阶段的天数：effectivePregnantDays 从孕早期起算 */
const STAGE_START = { 孕早期: 0, 孕中期: 98, 孕晚期: 196, 临产期: 259, 逾期: 294, 延产期: 294 };
const pregnancy = (stage, days, fields = {}) => ({
  base: { stage, days, eggs: 0 },
  pregnant: { effectivePregnantDays: (STAGE_START[stage] ?? 266) + days, pregnantDays: Math.max(0.001, (STAGE_START[stage] ?? 266) + days - 14), ...fields },
});

const desc = (pairs) => pairs.map(([name, value]) => ({ name, value, updatedAt: 0 }));
const kid = (fields) => ({ talents: [], age: 0, ...fields });

/**
 * 对话历法（1.5.2）：真机「从角色卡拟定」的结果（Seraphina／Eldoria 世界书，deepseek-flash，2026-11-22），
 * 一年 12 个月各 30 天、七曜、四季，60 个有乏情期的物种各自的繁殖季开始日。故事开始＝新历 9年 一月5日 20:00。
 */
export const HARNESS_CALENDAR = Object.freeze({
  mode: 'custom', era: '新历',
  months: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"].map((name) => ({ name, days: 30 })),
  weekdays: ["日曜","月曜","星曜","风曜","雨曜","雷曜","霜曜"],
  start: { year: 9, month: 1, day: 5, hour: 20, minute: 0, weekday: 1 },
  seasons: [{ name: '春', month: 1, day: 1 }, { name: '夏', month: 4, day: 1 }, { name: '秋', month: 7, day: 1 }, { name: '冬', month: 10, day: 1 }],
  breedingSeasons: {
    爱那温: { month: 2, day: 12 }, 白泽: { month: 1, day: 20 }, 半人鹿: { month: 9, day: 10 }, 半人马: { month: 5, day: 20 },
    宝石人: { month: 12, day: 1 }, 地狱犬: { month: 6, day: 6 }, 灯神: { month: 5, day: 5 }, 东方龙: { month: 2, day: 2 },
    独角兽: { month: 3, day: 21 }, 杜拉罕: { month: 9, day: 30 }, 夺心魔: { month: 9, day: 5 }, 恶魔: { month: 7, day: 20 },
    凤凰: { month: 6, day: 21 }, 龟族: { month: 5, day: 30 }, 海德拉: { month: 3, day: 5 }, 海马族: { month: 2, day: 25 },
    华根蕴桃: { month: 3, day: 10 }, 化狸: { month: 9, day: 25 }, 甲壳族: { month: 6, day: 1 }, 鲛人: { month: 5, day: 10 },
    精灵: { month: 2, day: 28 }, 巨人: { month: 11, day: 5 }, 卡玛佐兹: { month: 8, day: 20 }, 空鲸: { month: 8, day: 8 },
    雷鸟: { month: 6, day: 12 }, 镰鼬: { month: 11, day: 20 }, 貓又: { month: 2, day: 5 }, 梅杜莎: { month: 3, day: 18 },
    米戈: { month: 8, day: 5 }, 米诺陶族: { month: 3, day: 30 }, 魔族: { month: 7, day: 25 }, 鸟族: { month: 3, day: 1 },
    宁芙: { month: 1, day: 15 }, 麒麟: { month: 2, day: 18 }, 绒虫族: { month: 4, day: 20 }, 蝾螈族: { month: 5, day: 15 },
    萨堤尔族: { month: 9, day: 1 }, 赛尔克族: { month: 6, day: 18 }, 赛壬: { month: 3, day: 25 }, 蛇人: { month: 1, day: 28 },
    深潜者: { month: 1, day: 5 }, 狮鹫: { month: 4, day: 8 }, 兽耳族: { month: 1, day: 25 }, 斯芬克斯: { month: 5, day: 18 },
    天狗: { month: 9, day: 20 }, 天马: { month: 4, day: 25 }, 天使: { month: 12, day: 21 }, 蛙族: { month: 2, day: 8 },
    西方龙: { month: 6, day: 28 }, 蜥蜴人: { month: 5, day: 25 }, 星繭族: { month: 7, day: 15 }, 熊人族: { month: 6, day: 10 },
    修格斯: { month: 8, day: 28 }, 眼魔: { month: 7, day: 1 }, 妖狐: { month: 2, day: 20 }, 妖精: { month: 6, day: 24 },
    鱼人: { month: 3, day: 8 }, 羽蛇: { month: 7, day: 7 }, 月兔: { month: 8, day: 15 }, 卓尔: { month: 10, day: 15 },
  },
  // 手加（模型没给）：兽化的发情期改成每年一月十日起，格雷五天后进高峰
  derivedPeaks: { 兽化: { month: 1, day: 10 } },
});

/** 主题说明：页首照这份自动列出 */
export const ROSTER_NOTES = {
  卡蜜拉: '月经期｜血族千年萝（1200 岁、外表少女），族谱第一代，转化了银月与珂赛特',
  索菲亚: '卵泡期｜未孕综合：技能天赋、三源精液灌满、族谱分支、未孕心理、日记、关系',
  晴岚: '乏情期｜扶她双周期：卵方乏情（妖狐，二月二十日进繁殖季）→ 精方跟着非繁殖季 ×0.6，精力周期另外照跑；精方专属技能；衣着未记录',
  塞拉菲: '排卵期｜天使，繁殖季中（十二月二十一日起一轮约 42 天，之后乏情到明年同一天）',
  伊芙: '乏情期｜兽耳族-狼，乏情中、一月二十五日进繁殖季（季内三轮），日历页看得到对齐',
  小茉: '黄体期｜人类x兽耳族-兔，族谱第三代，刚受精特写',
  银月: '孕早期｜转化中（被卡蜜拉初拥，进度条）；饥饿咕噜；衣着余裕',
  诺艾尔: '孕中期｜兽化；纪录堆、孕期心理、虚弱胎、未揭露的异期复孕；泄意扭动；特制孕妇装',
  汐: '孕中期｜海马族 序列-ABO 的 Omega 男性，胎父是使用者（在场庇护）；借穿的临时衣物',
  珂赛特: '孕晚期｜六胎标签大全、衍生遗传、血脉排斥进行中；衣着不足',
  黛安娜: '临产期｜神祇；孕体特写外观全套（深肤色、大乳晕、外凸大肚脐、妊娠纹）、全裸放松胸型、假宫缩；外星胎父',
  赫拉: '产兆前驱｜半人马（兽躯孕肚）、变异、臀位、胎动激烈；特制托带',
  薇拉丝: '第一产程｜卓尔 魔导，双胎互锁、同型遗传；产袍撩起',
  布丽姬: '第二产程｜矮人 机械，肩难产；臭烟；工作服撕开',
  雪见: '延产期｜雪族 修炼-金丹，延产＋子宫乏力、横位危急；打瞌睡；衣着不足',
  玛格丽特: '产后恢复｜七种经历工具样本、产后妊娠纹、漏奶、产后宫缩；孕妇裙余裕',
  噗露: '回归期｜史莱姆 器灵，胎内回归、撑满之痛；只有饰品',
  萝丝: '孕晚期｜触手怪（非人形，没有特写）咒缚，一窝八颗卵；衣着未记录',
};

export function buildRoster() {
  fetusSeq = 0;
  const skillCatalog = [
    { id: 1, name: '剑术', description: '使用长剑进行攻防的实战技巧。' },
    { id: 2, name: '魔力感知', description: '辨识周遭魔力流动的能力。' },
    { id: 3, name: '察言观色', description: '从神情与语气读出对方真意。' },
    { id: 4, name: '隐忍含蓄', description: '压下情绪不形于色。' },
    { id: 5, name: '才情雅艺', description: '诗书琴画一类的雅致修养。' },
    { id: 6, name: '阴茎开发', description: '阴茎的敏感与耐力。', body: 'sword' },
    { id: 7, name: '子宫开发', description: '子宫与宫口的敏感。', body: 'womb' },
  ];

  const characters = {
    // 第一代：千年萝。孩子索菲亚已注册
    卡蜜拉: female('卡蜜拉', {
      base: { stage: '月经期', days: 1, age: 1200, race: '人类', derivedType: '血族', bodySize: 3, build: 28, bust: 25, hip: 32 },
      display: { skinColor: '#ebe7ee', nippleColor: '#eaa3a3' },
      descriptions: { normalDescription: desc([['外貌', '银发红瞳、娇小苍白，看上去不过十四五岁'], ['神态', '慵懒地托着腮，眼底是活了千年的厌倦']]) },
      children: [kid({ id: 'cam-1', name: '索菲亚', gender: '女', race: '人类', fathers: '古老的骑士', fatherRace: '人类', age: 40, registeredAs: '索菲亚' })],
      metabolism: { hunger: 40, flux: 60 },
    }),
    // 第二代：未孕综合
    索菲亚: female('索菲亚', {
      base: {
        stage: '卵泡期', days: 3, age: 40, eggs: 2, build: 35, bust: 40, hip: 45,
        sperms: [
          { male: '凯', race: '人类', derivedType: null, value: 70 },
          { male: '泽塔', race: '灰人', derivedType: '星际', value: 40 },
          { male: '深渊之触', race: '触手怪', derivedType: null, value: 20 },
        ],
      },
      descriptions: { normalDescription: desc([['外貌', '黑发碧眼，身形修长'], ['神态', '从容微笑']]) },
      cognitionRecords: [{ time: '旅途第六日', method: 'guess', content: '她猜测自己可能怀孕，但还没确认。' }],
      psychology: {
        stageProfiles: { mens: { desire: { '51_75': '想再要一个孩子，又怕重蹈覆辙' } } },
        mens: { mastery_value: 62, desire_value: 58, autonomy_value: 35 },
      },
      diary: [
        { time: '旅途第三日', content: '凯又在门边看我。我装作没发现。', storyDayIndex: 0, createdAt: 1 },
        { time: '旅途第五日', content: '母亲说千年来她只后悔过一件事，却不肯说是哪件。', storyDayIndex: 1, createdAt: 2 },
      ],
      skills: [{ skillId: 1, level: 3, exp: 120 }, { skillId: 3, level: 3, exp: 0 }, { skillId: 4, level: 5, exp: 1200 }, { skillId: 5, level: 10, exp: 0 }, { skillId: 7, level: 2, exp: 30 }],
      // 楔形角标：苦手 Lv2／擅长 Lv3／擅长 Lv5（满）／苦手 Lv1；skillId 2 有天赋无技能不显示
      talents: [{ skillId: 1, level: -2, exp: -40 }, { skillId: 2, level: 1, exp: 30 }, { skillId: 3, level: 3, exp: 0 }, { skillId: 4, level: 5, exp: 0 }, { skillId: 5, level: -1, exp: 0 }],
      skillHistory: [{ skillId: 1, fromLevel: 1, toLevel: 3, reason: '在连续实战中掌握了新的剑术节奏。', source: 'story', timestamp: Date.now() - 3600000 }],
      children: [
        // 已注册（第三代）
        kid({ id: 'so-1', name: '小茉', gender: '女', race: '人类x兽耳族-兔', fathers: '兔耳旅人', fatherRace: '兽耳族-兔', age: 18, registeredAs: '小茉' }),
        // 未注册的路人父亲，带衍生
        kid({ id: 'so-2', name: '次子', gender: '男', race: '人类x西方龙', fathers: '无名旅人', fatherRace: '西方龙', fatherDerivedType: '血族', age: 6 }),
        // 代孕：索菲亚只是承载者，卵源是珂赛特
        kid({ id: 'so-3', name: '寄养儿', gender: '女', race: '魔族x人类', fathers: '凯', fatherRace: '人类', provider: '珂赛特', providerSources: ['珂赛特'], age: 3 }),
        // 嵌合：两位父源
        kid({ id: 'so-4', name: '融合儿', gender: '双', race: '人类x灰人', fathers: '凯×泽塔', fatherRace: '人类x灰人', chimera: { fatherSources: ['凯', '泽塔'], maternalSources: ['索菲亚'] }, age: 1 }),
        // 自交
        kid({ id: 'so-5', name: '孤生子', gender: '女', race: '人类', fathers: '索菲亚', fatherRace: '人类', age: 0 }),
        // 扶她当父亲
        kid({ id: 'so-6', name: '狐丸', gender: '男', race: '人类x妖狐', fathers: '晴岚', fatherRace: '妖狐', fatherDerivedType: '妖怪', age: 2 }),
      ],
    }),
    晴岚: female('晴岚', {
      // 扶她双周期：照妖狐的生理（乏情 337 天、一季一轮），乏情已过 250 天，推进时间对齐到二月二十日
      bio: getRacePhysiologyProfile('妖狐'),
      base: { stage: '乏情期', days: 250, seasonCycle: 0, age: 300, race: '妖狐', derivedType: '妖怪', build: 50, bust: 62, hip: 55 },
      display: { skinColor: '#f9e0cc' },
      descriptions: { normalDescription: desc([['外貌', '九条狐尾、金瞳，裙下藏着不该有的东西'], ['神态', '笑眯眯地打量每一个人']]) },
      skills: [{ skillId: 6, level: 2, exp: 40 }, { skillId: 7, level: 1, exp: 0 }],
    }),
    // 繁殖季（1.5.2 历法定锚）：天使十二月二十一日起，现在是季内第 15 天、排卵中
    塞拉菲: female('塞拉菲', {
      bio: getRacePhysiologyProfile('天使'),
      base: { stage: '排卵期', days: 1.5, seasonCycle: 0, eggs: 1, age: 500, race: '天使', build: 40, bust: 48, hip: 50 },
      display: { skinColor: '#fbf1e6' },
      descriptions: { normalDescription: desc([['外貌', '白翼收在背后，金发垂到腰间'], ['神态', '端庄，却掩不住季节带来的燥热']]) },
    }),
    // 乏情中：兽耳族-狼一月二十五日进繁殖季
    伊芙: female('伊芙', {
      bio: getRacePhysiologyProfile('兽耳族-狼'),
      base: { stage: '乏情期', days: 60, seasonCycle: 0, eggs: 0, age: 22, race: '兽耳族-狼', build: 45, bust: 50, hip: 55 },
      descriptions: { normalDescription: desc([['外貌', '灰色狼耳与蓬松尾巴，琥珀色眼睛'], ['神态', '懒洋洋的，对谁都提不起兴致']]) },
    }),
    // 第三代：刚受精
    小茉: female('小茉', {
      base: { stage: '黄体期', days: 1, age: 18, race: '人类x兽耳族-兔', bloodline: { 人类: 0.5, 兽耳族: 0.5 }, bloodlineSource: 'explicit', eggs: 0, fertilizationDays: 0.3, bodySize: 3, build: 30, bust: 35, hip: 40, sperms: [{ male: '凯', race: '人类', derivedType: null, value: 35 }] },
      visualCue: { type: 'fertilization', seq: 1 },
      pregnant: { fetuses: [fetus({ race: '人类x兽耳族-兔' })] },
    }),
    // 转化中（工具套用后再把时间拨到中段）
    银月: female('银月', merge(pregnancy('孕早期', 40), {
      base: { age: 210, race: '精灵', build: 40, bust: 45, hip: 50 },
      metabolism: { hunger: 125 },
      pregnant: { fetuses: [fetus({ race: '精灵', fatherRace: '精灵', fathers: '林间的游吟诗人', gender: '男', affinity: 15, health: 60, weight: 0.9 })] },
    })),
    // 纪录堆（原诺拉）
    诺艾尔: female('诺艾尔', merge(pregnancy('孕中期', 30), {
      base: { age: 24, derivedType: '兽化', vitalityLevel: 5, build: 55, bust: 55, hip: 60 },
      metabolism: { excretion: 128 },
      cognitionRecords: [
        { id: 'r:4', sequence: 4, time: '霜月二日', method: 'prenatal', content: '产婆温特按过小腹，说孩子大小对得上、位置也正，嘱她不许提重物、子时前睡下。', pin: true, minutesPassed: 0, storyDayIndex: 0 },
        { id: 'r:5', sequence: 5, time: '霜月九日', method: 'perception', content: '夜里第一次清楚感觉到胎动，像小鱼在肚子里翻身。', minutesPassed: 0, storyDayIndex: 0 },
        { id: 'r:6', sequence: 6, time: '霜月十一日', method: 'informed', content: '凯说孩子一定是他的，她没有反驳。', minutesPassed: 0, storyDayIndex: 0, psychology: { stance: 2 } },
        { id: 'r:7', sequence: 7, time: '霜月十二日', method: 'experience', content: '和凯吵完架的第二天，她摸着肚子想了一整夜，决定不管凯怎么样都要把孩子生下来。', minutesPassed: 0, storyDayIndex: 0, psychology: { acceptance: 5, confidence: -2 } },
      ],
      psychology: {
        stageProfiles: { preg: { acceptance: { '51_75': '决定留下孩子，开始替他打算' } } },
        preg: { confidence_value: 38, acceptance_value: 62, stance_value: 30 },
      },
      cognitionSummary: { count: 3, methods: { guess: 1, test: 1, perception: 1 }, from: '雨月二十日', to: '雨月底', notes: '月事迟了十来天、闻到油烟就想吐；用药草验过，确认有孕' },
      pregnant: {
        prenatalCare: 'attentive',
        fetuses: [
          fetus({ gender: '女', weight: 1.04, affinity: 6, health: 30, spermQuality: 1.2, talents: [{ skillId: 2, level: 1, exp: 20 }] }),
          // 未揭露的异期复孕
          fetus({ gender: '男', weight: 0.4, affinity: 0, health: 55, conceivedAtDays: 100, tags: ['superfetation'], revealed: false }),
        ],
        fetalEventSummary: { count: 5, kinds: { substance: 2, overexertion: 1, rest: 2 }, from: '雨月二十日', to: '雨月底', notes: '不知道怀孕时在酒馆喝过两次；搬货扭了腰，产婆说已无大碍', byEmbryo: {} },
        fetalEvents: [
          { sequence: 6, time: '霜月二日', kind: 'checkup', change: 'slight_increase', scope: 'all', embryoIds: [], content: '产婆温特上门按腹诊察，说胎儿大小对得上、位置也正。', effects: {}, counted: true, pin: true, minutesPassed: 0, storyDayIndex: 0 },
          { sequence: 8, time: '霜月五日', kind: 'trauma', change: 'significant_decrease', scope: 'all', embryoIds: [], content: '下楼时踩空，肚子撞上楼梯扶手。', effects: {}, pressure: 12, counted: true, minutesPassed: 0, storyDayIndex: 0 },
          { sequence: 9, time: '霜月九日', kind: 'bonding', change: 'slight_increase', scope: 'one', embryoIds: [], content: '她抚着肚子哼家乡的摇篮曲，胎儿轻轻顶了顶她的掌心。', effects: {}, counted: true, minutesPassed: 0, storyDayIndex: 0 },
          { sequence: 10, time: '霜月九日', kind: 'bonding', change: 'slight_increase', scope: 'one', embryoIds: [], content: '睡前又对着肚子说了一会儿话。', effects: {}, counted: false, minutesPassed: 0, storyDayIndex: 0 },
          { sequence: 11, time: '霜月十一日', kind: 'estrangement', change: 'slight_decrease', scope: 'one', embryoIds: [], content: '和凯吵完架，她对着肚子说要是没有你就好了，胎儿整夜不安地乱动。', effects: {}, counted: true, minutesPassed: 0, storyDayIndex: 0 },
        ],
      },
    })),
    // 会怀孕的男性：序列-ABO 的 Omega；胎父是使用者本人（在场、胎儿守护）
    汐: female('汐', merge(pregnancy('孕中期', 50), {
      base: { age: 19, race: '海马族', derivedType: '序列-ABO', build: 40, bust: 20, hip: 40 },
      descriptions: { normalDescription: desc([['外貌', '清瘦的少年，颈后有 Omega 的腺体，下身是银蓝的海马尾'], ['神态', '护着肚子，耳根发红']]) },
      pregnant: {
        fetuses: [
          fetus({ fathers: USER_NAME, fatherRace: '人类', race: '人类x海马族', embryoType: '卵胎生', gender: '男', affinity: 25, health: 70, weight: 0.8 }),
          fetus({ fathers: USER_NAME, fatherRace: '人类', race: '人类x海马族', embryoType: '卵胎生', gender: '无', affinity: 8, health: 55, weight: 0.7, tendencyAngle: 270 }),
        ],
      },
    })),
    // 六胎标签大全（原琪拉）；血脉排斥由工具套用
    珂赛特: female('珂赛特', merge(pregnancy('孕晚期', 14), {
      base: {
        age: 26, race: '魔族', bodySize: 4.6, build: 45, bust: 55, hip: 55,
        sperms: [{ male: '莱昂', race: '人类', derivedType: '血族', value: 180 }, { male: '无名旅人', race: '西方龙', derivedType: null, value: 120 }],
      },
      display: { skinColor: '#c0504a' },
      descriptions: { pregnantDescription: desc([['孕态', '六胎撑得腹部巨大，几乎站不稳']]) },
      intimacy: { 莱昂: { count: 12, effective: 10, lastMinutes: 0, compatLabel: '恰好契合' }, 海德: { count: 7, effective: 6, lastMinutes: 0, compatLabel: '略有落差' } },
      pregnant: {
        nextEmbryoId: 108,
        fetuses: [
          // 卵生・胎内回归（回到子宫里的鸟人）
          fetus({ embryoId: 101, descentStage: -3, fathers: '翼', fatherRace: '鸟族', race: '魔族x鸟族', embryoType: '卵生', gender: '女', weight: 1.6, tendencyAngle: 45, affinity: 20, amnionDurability: 85, tags: ['rebirth'], health: 80 }),
          // 胎生・代孕（卵源索菲亚），孕中孕的宿主；声称父亲与实际不同；胎父莱昂血族，轴偏父
          fetus({ embryoId: 102, descentStage: -1, fathers: '莱昂', fatherDerivedType: '血族', maternalDerivedTypeProgress: -20, selectedFather: '卡尔', paternityClaims: [{ time: '第三日', content: '珂赛特对卡尔说孩子是他的，卡尔半信半疑。', minutesPassed: 0 }], provider: '索菲亚', providerSources: ['索菲亚'], race: '人类', embryoType: '胎生', gender: '女', weight: 1.1, affinity: 40, amnionDurability: 90, talents: [{ skillId: 1, level: 2, exp: 40 }], health: 70 }),
          // 胎转卵生・嵌合；负亲和、苦手
          fetus({ embryoId: 103, descentStage: -3, fathers: '莱昂 × 无名旅人', fatherRace: '人类x西方龙', chimera: { sourceCount: 2, fatherSources: ['莱昂', '无名旅人'], maternalSources: ['珂赛特'], genderSources: ['男', '女'] }, race: '魔族x西方龙', embryoType: '胎转卵生', gender: '双', weight: 1.0, tendencyAngle: 180, affinity: -35, amnionDurability: 45, talents: [{ skillId: 2, level: -1, exp: -30 }], health: 45 }),
          // 卵胎生・异期复孕，三颗伴生卵；胎父海德不死，轴偏母
          fetus({ embryoId: 104, descentStage: -1, fathers: '海德', fatherDerivedType: '不死', maternalDerivedTypeProgress: 10, selectedFather: '海德', paternityClaims: [{ time: '第五日', content: '珂赛特告诉海德孩子是他的，海德欣然认领。', minutesPassed: 0 }], fatherRace: '人鱼', race: '魔族x人鱼', embryoType: '卵胎生', gender: '女', weight: 0.85, tendencyAngle: 90, affinity: 10, amnionDurability: 70, conceivedAtDays: 30, companionEggCount: 3, tags: ['superfetation'], revealed: true, health: 60 }),
          // 不定型・自交＋雌核
          fetus({ embryoId: 105, descentStage: -2, fathers: '珂赛特', fatherRace: '魔族x史萊姆', race: '魔族x史萊姆', embryoType: '不定型', gender: '女', weight: 0.8, tendencyAngle: 270, affinity: 5, tags: ['gynogenesis'], health: 60 }),
          // 孕中孕：长在 102 体内
          fetus({ embryoId: 106, fathers: '莱昂', fatherRace: '人类', race: '人类', gender: '男', weight: 0.6, affinity: 0, nestedInEmbryoId: 102, conceivedAtDays: 60, tags: ['superfetation', 'nested'], revealed: true, health: 60 }),
          // 1.5.2：卵生宿主里的孕中孕（封在蛋里，随宿主一起产出）
          fetus({ embryoId: 107, fathers: '翼', fatherRace: '鸟族', race: '鸟族', embryoType: '卵生', gender: '女', weight: 0.5, affinity: 5, nestedInEmbryoId: 101, conceivedAtDays: 70, tags: ['superfetation', 'nested'], revealed: true, health: 60 }),
        ],
      },
    })),
    // 孕体特写外观全套；外星胎父，轴偏父
    黛安娜: female('黛安娜', merge(pregnancy('临产期', 10), {
      base: { age: 29, derivedType: '神祇', build: 65, bust: 85, hip: 85 },
      display: { skinColor: '#7e4e35', nippleColor: '#3d2c33', nippleSize: 1.6, navel: 'outie', navelSize: 'large', stretchMarks: 'both' },
      visualCue: { type: 'falseContraction', seq: 1 },
      pregnant: { prenatalCare: 'devoted', fetuses: [fetus({ fathers: '泽塔', fatherRace: '灰人', fatherDerivedType: '星际', maternalDerivedTypeProgress: -40, race: '人类x灰人', gender: '女', weight: 1.3, health: 95, descentStage: -1, affinity: 30 })] },
    })),
    // 产兆前驱，半人马兽躯孕肚，臀位，胎动激烈
    赫拉: female('赫拉', {
      base: { stage: '产兆前驱', days: 0, eggs: 0, age: 31, race: '半人马', derivedType: '变异', bodySize: 5, vitalityLevel: 6, build: 70, bust: 60, hip: 75 },
      pregnant: {
        effectivePregnantDays: 275, pregnantDays: 261, prodromalOriginStage: '临产期', prodromalRemainingHours: 20,
        fetuses: [fetus({ race: '半人马x人类', gender: '男', weight: 1.4, tendencyAngle: 180, health: 90, descentStage: -1, affinity: 12 })],
      },
    }),
    // 双胎互锁（原妮拉）
    薇拉丝: female('薇拉丝', {
      base: { stage: '第一产程', days: 0, eggs: 0, age: 120, race: '卓尔', derivedType: '魔导', uterinePressure: 120, build: 45, bust: 50, hip: 55 },
      display: { skinColor: '#7a7390' },
      immune: { realisticLabor: true },
      pregnant: {
        effectivePregnantDays: 275, pregnantDays: 261, laborPhase: '活跃期', presentingEmbryoId: 201,
        fetuses: [
          fetus({ embryoId: 201, race: '卓尔x人类', weight: 0.95, tendencyAngle: 180, affinity: 5, amnionDurability: 40, descentStage: 0, maternalDerivedTypeProgress: 40, health: 70 }),
          fetus({ embryoId: 202, race: '卓尔x人类', fatherDerivedType: '魔导', weight: 0.95, tendencyAngle: 0, affinity: -30, maternalDerivedTypeProgress: 80, amnionDurability: 60, descentStage: 0, inletIntruder: true, health: 65 }),
        ],
      },
    }),
    // 肩难产（原妲拉）
    布丽姬: female('布丽姬', {
      base: { stage: '第二产程', days: 0, eggs: 0, age: 60, race: '矮人', derivedType: '机械', bodySize: 3, vitality: 0, uterinePressure: 150, build: 72, bust: 60, hip: 70 },
      metabolism: { odor: 128 },
      immune: { realisticLabor: true },
      pregnant: {
        effectivePregnantDays: 280, pregnantDays: 266, laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 301,
        fetuses: [
          fetus({ embryoId: 301, race: '矮人', fatherRace: '矮人', fathers: '铁砧', gender: '男', weight: 1.2, affinity: 10, amnionDurability: 0, descentStage: 3, shoulderDystocia: true, health: 50 }),
          fetus({ embryoId: 302, race: '矮人', fatherRace: '矮人', fathers: '铁砧', weight: 1.0, tendencyAngle: 180, affinity: -10, amnionDurability: 70, descentStage: -1, health: 60 }),
        ],
      },
    }),
    // 延产＋子宫乏力（原芙拉），横位危急
    雪见: female('雪见', {
      base: { stage: '延产期', days: 106, eggs: 0, age: 28, race: '雪族', derivedType: '修炼-金丹', uterinePressure: 30, uterineAtony: 2, build: 40, bust: 45, hip: 50 },
      display: { skinColor: '#f9e0cc' },
      metabolism: { sleep: 128 },
      pregnant: {
        effectivePregnantDays: 400, pregnantDays: 386, extensionCount: 3, extensionUntilDays: 420,
        fetuses: [fetus({ race: '雪族', fatherRace: '雪族', fathers: '冬之狩人', weight: 1.1, tendencyAngle: 90, affinity: 12, descentStage: -1, health: 8 })],
      },
    }),
    // 产后恢复：经历工具样本另外套用
    玛格丽特: female('玛格丽特', {
      base: { stage: '产后恢复', days: 10, age: 27, eggs: 0, build: 55, bust: 70, hip: 65, sperms: [{ male: '凯', race: '人类', derivedType: null, value: 140 }] },
      display: { stretchMarks: 'lower' },
      metabolism: { milk: 128 },
      bio: { recoveryDays: 56 },
      experience: { pregnantExperience: 1, naturalBirthExperience: 1 },
      pregnant: { deliveredBulk: 1.2 },
      children: [kid({ id: 'mg-1', name: '待命名新生儿', selectedFather: null, gender: '女', race: '人类', fathers: '凯', fatherRace: '人类' })],
    }),
    // 回归期：bsWombReturn 套用
    噗露: female('噗露', { base: { stage: '卵泡期', days: 2, age: 5, race: '史萊姆', derivedType: '器灵', build: 50, bust: 50, hip: 50 } }),
    // 非人形：没有特写
    萝丝: female('萝丝', merge(pregnancy('孕晚期', 20), {
      base: { age: 80, race: '触手怪', derivedType: '咒缚' },
      pregnant: {
        fetuses: Array.from({ length: 8 }, (_, index) => fetus({
          fathers: '深渊之触', fatherRace: '触手怪', race: '触手怪', embryoType: '卵生', gender: ['女', '男', '无', '双'][index % 4],
          weight: 0.35, tendencyAngle: (index * 45) % 360, affinity: [-20, 0, 10, 30][index % 4], health: [90, 60, 40, 75][index % 4], descentStage: -3,
        })),
      },
    })),
  };

  const sires = {
    凯: { race: '人类', age: 32, bodySize: 4.5, isHere: true, descriptions: { normalDescription: desc([['外貌', '黑发、肩宽，左眉一道旧疤'], ['性器', '粗长，青筋明显'], ['行动', '靠在门边看着她']]) } },
    [USER_NAME]: { race: '人类', age: 25, isHere: true, fetalGuard: true, descriptions: { normalDescription: desc([['外貌', '背着行囊的旅人']]) } },
    莱昂: { race: '人类', derivedType: '血族', age: 27, isHere: false },
    卡尔: { race: '[血族]人类', age: 140, bodySize: 4, isHere: false },
    海德: { race: '人鱼', derivedType: '不死', age: 300, isHere: false },
    泽塔: { race: '灰人', derivedType: '星际', age: 60, bodySize: 3, isHere: false },
    深渊之触: { race: '触手怪', age: 500, bodySize: 6, isHere: false, descriptions: { normalDescription: desc([['外貌', '一团缠绕的深色触手，中央有一只眼']]) } },
    // 季节性纯精方（1.5.2）：兽耳族-狼一月二十五日进繁殖季（现在非繁殖季 ×0.6）；兽化的发情期定在一月十日（五天后高峰）
    格雷: { race: '兽耳族-狼', derivedType: '兽化', age: 28, bodySize: 4.5, isHere: true, descriptions: { normalDescription: desc([['外貌', '高大的狼耳男人，颈后一道爪痕'], ['行动', '在角落里来回踱步']]) } },
    // 扶她：同名也是卵方，种族等读卵方那份
    晴岚: { race: '妖狐', isHere: true, skills: [{ skillId: 6, level: 2, exp: 40 }], descriptions: { normalDescription: desc([['性器', '狐尾间藏着一根细长的']]) } },
  };

  return { characters, sires, skillCatalog, nextSkillId: 8 };
}

/** 衣着、转化、回归、经历都走公开工具；失败就丢出来，免得静默留下半套样本 */
export function applyRosterTools(chatState) {
  const call = (name, args, sourceId) => {
    const result = applyToolCall(chatState, { name, arguments: args, ...(sourceId ? { sourceId } : {}) });
    if (!result.applied) throw new Error(`测试页样本未套用：${name} ${JSON.stringify(args)} → ${result.message}`);
    return result;
  };
  const wear = (female, items, outfit) => {
    for (const item of items) call('bsAddWardrobeItem', { female, item });
    call('bsChangeOutfit', { female, ...outfit });
  };
  const fit = (masking, support, capacity, convenience) => ({ masking, support, capacity, convenience });

  wear('卡蜜拉', [
    { name: '哥德礼服', note: '黑红层叠蕾丝，高领。', slot: 'main', fitProfile: fit('high', 'normal', 'fitted', 'inconvenient') },
    { name: '天鹅绒披风', note: '暗红内衬。', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] },
  ], { mainItemId: '哥德礼服', accessoryItemIds: ['天鹅绒披风'] });
  wear('索菲亚', [
    { name: '白色连身裙', note: '及膝雪纺，方领。', slot: 'main', parts: ['连身裙'], fitProfile: fit('medium', 'normal', 'fitted', 'normal') },
    { name: '衬衫牛仔裤', note: '白衬衫配直筒牛仔裤。', slot: 'main', parts: ['白衬衫', '牛仔裤'], fitProfile: fit('high', 'normal', 'fitted', 'convenient') },
    { name: '蕾丝内衣', note: '浅色蕾丝，贴身。', slot: 'accessory', category: 'underwear', effects: ['support_up'] },
    { name: '针织外套', note: '米色开衫。', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] },
  ], { mainItemId: '白色连身裙', accessoryItemIds: ['蕾丝内衣', '针织外套'], wearState: '敞开' });
  wear('小茉', [{ name: '兔女郎装', note: '黑色高衩连身衣配网袜。', slot: 'main', fitProfile: fit('low', 'strong', 'tight', 'inconvenient') }], { mainItemId: '兔女郎装' });
  wear('银月', [{ name: '宽松长袍', note: '月白丝袍，腰间系带。', slot: 'main', fitProfile: fit('high', 'none', 'loose', 'convenient') }], { mainItemId: '宽松长袍' });
  wear('诺艾尔', [
    { name: '托腹孕妇裙', note: '魔法伸缩布料，前片加厚托住孕肚。', slot: 'main', fitProfile: fit('high', 'strong', 'stretch', 'normal'), maternity: true },
    { name: '孕肚托带', note: '宽版弹力托带。', slot: 'accessory', category: 'support', effects: ['support_up', 'capacity_up'], maternity: true },
  ], { mainItemId: '托腹孕妇裙', accessoryItemIds: ['孕肚托带'] });
  // 借穿：临时衣物，不进衣柜
  call('bsChangeOutfit', { female: '汐', scope: 'temporary', main: { name: '借来的宽大衬衫', note: `${USER_NAME}的白衬衫，下摆盖到尾根。`, fitProfile: fit('medium', 'none', 'loose', 'convenient') } });
  wear('珂赛特', [{ name: '紧身晚礼服', note: '酒红缎面鱼尾裙，孕前订做。', slot: 'main', fitProfile: fit('medium', 'normal', 'tight', 'inconvenient') }], { mainItemId: '紧身晚礼服' });
  call('bsChangeOutfit', { female: '黛安娜', mainItemId: 0 });
  wear('赫拉', [
    { name: '马甲背心', note: '皮革短背心。', slot: 'main', fitProfile: fit('medium', 'normal', 'fitted', 'convenient') },
    { name: '兽躯托带', note: '从马背绕到马腹的宽皮带，托住下垂的孕肚。', slot: 'accessory', category: 'support', effects: ['support_up', 'capacity_up'], maternity: true },
  ], { mainItemId: '马甲背心', accessoryItemIds: ['兽躯托带'] });
  wear('薇拉丝', [{ name: '产袍', note: '前开的宽松白袍。', slot: 'main', fitProfile: fit('medium', 'none', 'loose', 'convenient') }], { mainItemId: '产袍', wearState: '撩起' });
  wear('布丽姬', [{ name: '锻造工作服', note: '帆布连身工作服，满是油污。', slot: 'main', fitProfile: fit('high', 'normal', 'fitted', 'normal') }], { mainItemId: '锻造工作服', wearState: '撕开' });
  wear('雪见', [{ name: '白无垢', note: '层层裹紧的白绢和服。', slot: 'main', fitProfile: fit('high', 'normal', 'tight', 'inconvenient') }], { mainItemId: '白无垢' });
  wear('玛格丽特', [
    { name: '孕妇裙', note: '高腰伞形，弹性面料。', slot: 'main', fitProfile: fit('medium', 'normal', 'stretch', 'normal') },
    { name: '哺乳内衣', note: '前开扣。', slot: 'accessory', category: 'underwear', effects: ['support_up'] },
  ], { mainItemId: '孕妇裙', accessoryItemIds: ['哺乳内衣'] });

  // 胎内回归，再把剩余时间拨到四成（撑满之痛约 2.4）
  call('bsWombReturn', { female: '噗露', returner: '小史', returnerRace: '史萊姆', hours: 20 });
  chatState.characters['噗露'].profile.pregnant.wombReturn.remainingHours = 8;
  // 只有饰品：主衣着全裸
  call('bsChangeOutfit', { female: '噗露', mainItemId: 0, accessories: [{ name: '铃铛项圈', note: '红绳系着的小铜铃。', category: 'ornament', effects: [] }], scope: 'owned' });

  // 转化：卡蜜拉初拥银月（花 30 小时，拨到 18 小时过半）；珂赛特先被初拥，再服丹换修炼引起排斥（48 小时，拨到 12 小时）
  call('bsRecordExperience', { female: '银月', action: 'transform', time: '霜月一日夜', derivedType: '血族', partner: '卡蜜拉', content: '被卡蜜拉咬住颈侧初拥', hours: 30 });
  shiftTransform(chatState.characters['银月'].profile, 18);
  call('bsRecordExperience', { female: '珂赛特', action: 'transform', time: '霜月三日', derivedType: '血族', partner: '卡蜜拉', content: '被卡蜜拉初拥' });
  call('bsRecordExperience', { female: '珂赛特', action: 'transform', time: '霜月九日', derivedType: '修炼', content: '服下洗髓丹，逼出血族之血', hours: 48 });
  shiftTransform(chatState.characters['珂赛特'].profile, 12);

  // 产后恢复的经历样本（七种 action、五种认知方式）
  const samples = [
    { action: 'date', time: '旅途第1日', partner: '旧恋人' },
    { action: 'date', time: '旅途第2日', partner: '凯' },
    { action: 'date', time: '旅途第3日', partner: '莉雅' },
    { action: 'breakup', time: '旅途第4日', partner: '旧恋人' },
    { action: 'marry', time: '旅途第5日', partner: '前配偶' },
    { action: 'divorce', time: '旅途第6日', partner: '前配偶' },
    { action: 'marry', time: '旅途第7日', partner: '莱昂' },
    { action: 'marry', time: '旅途第8日', partner: '莉雅' },
    { action: 'cognition', time: '旅途第28日', method: 'perception', content: '月经迟迟没来，她注意到身体变化，但以为只是旅途劳累。' },
    { action: 'cognition', time: '旅途第30日', method: 'guess', content: '她猜测自己可能怀孕，尚未确认。' },
    { action: 'cognition', time: '旅途第35日', method: 'informed', content: '助产士告诉她可能怀孕；她听进了建议，但仍有疑虑。' },
    { action: 'cognition', time: '旅途第42日', method: 'test', content: '验孕结果呈阳性，她据此相信自己已经怀孕。' },
    { action: 'cognition', time: '旅途第100日', method: 'prenatal', content: '产检时被告知是一名单胎。' },
    { action: 'child', time: '产后第10日', childIndex: 0, name: '星禾' },
    { action: 'claim', time: '产后第10日', childIndex: 0, content: '玛格丽特对莱昂说星禾是他的孩子，莱昂当场认领。', selectedFather: '莱昂' },
  ];
  samples.forEach((args, index) => call('bsRecordExperience', { female: '玛格丽特', ...args }, `harness:margaret:${index}`));
  // 索菲亚的关系
  call('bsRecordExperience', { female: '索菲亚', action: 'date', time: '旅途第2日', partner: '凯' }, 'harness:sophia:0');
  call('bsRecordExperience', { female: '索菲亚', action: 'marry', time: '十年前', partner: '泽塔' }, 'harness:sophia:1');
  return samples;
}

/** 测试页要看中段：把转化（与等长的排斥）往前拨 elapsedHours 小时 */
function shiftTransform(profile, elapsedHours) {
  const t = profile?.base?.transforming;
  if (t) {
    t.startedMinutes -= elapsedHours * 60;
    t.untilMinutes -= elapsedHours * 60;
  }
  const crisis = profile?.pregnant?.rejectionCrisis;
  if (crisis) {
    const share = Math.min(1, elapsedHours / crisis.totalHours);
    crisis.remainingHours = Math.max(0, crisis.totalHours - elapsedHours);
    for (const entry of Object.values(crisis.losses || {})) entry.remaining = Math.round(entry.total * (1 - share) * 100) / 100;
  }
}
