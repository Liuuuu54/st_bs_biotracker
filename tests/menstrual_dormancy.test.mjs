// 乏情期：长周期物种月经后的静止期，不排卵、不受孕；经期倍率只管活动周期，着床前与产科偏移不受乏情影响
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { getMergedRacePhysiologyProfile, getRacePhysiologyProfile } from '../scripts/race_config.js';
import { applyToolCall, canDormancyOvulate, getForeignSemenShare, getStageLimit } from '../scripts/tools.js';
import { getConceptionStageWeight } from '../scripts/body_size.js';
import { calculateRaceImplantationDays } from '../scripts/calculator.js';
import { buildSingleRacePhysiologyText, describeRaceFieldValue } from '../scripts/prompts/rules.js';
import { migrateCharacters } from '../scripts/state_migration.js';

function setup(race, stage = '月经期', days = 0) {
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  character.profile.base.age = 22;
  character.profile.base.race = race;
  character.profile.bio = { ...character.profile.bio, ...getRacePhysiologyProfile(race) };
  character.profile.base.stage = stage;
  character.profile.base.days = days;
  chatState.characters.A = character;
  return chatState;
}

const pass = (chatState, day) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day } });
const base = (chatState) => chatState.characters.A.profile.base;

test('长周期物种的倍率降回活动周期，其余长度转成乏情；人类与没写的物种为 0，混血按血统加权', () => {
  assert.deepEqual(
    [getRacePhysiologyProfile('天使').menstrualLengthRatio, getRacePhysiologyProfile('天使').dormancyDays],
    [1.5, 322],
  );
  assert.equal(getRacePhysiologyProfile('人类').dormancyDays, 0);
  assert.equal(getRacePhysiologyProfile('哥布林').dormancyDays, 0, '没写的内置物种补 0');
  assert.equal(getRacePhysiologyProfile('哥布林').seasonCycles, 1);
  assert.deepEqual([getRacePhysiologyProfile('兽耳族').dormancyDays, getRacePhysiologyProfile('兽耳族').seasonCycles], [120, 3], '兽娘一年两次发情季');
  for (const race of ['米诺陶族', '萨堤尔族', '月兔']) assert.equal(getRacePhysiologyProfile(race).seasonCycles, 3, race);
  assert.equal(getMergedRacePhysiologyProfile('天使x人类').dormancyDays, 161);
  assert.equal(calculateRaceImplantationDays('天使'), 9, '着床前只看活动周期 42 天');
});

test('月经期结束进入乏情期，乏情满了才进卵泡期；没有乏情的人类直接进卵泡期', () => {
  const angel = setup('天使');
  pass(angel, 8);
  assert.equal(base(angel).stage, '乏情期');
  assert.equal(getStageLimit(angel.characters.A.profile, '乏情期'), 322);
  pass(angel, 321);
  assert.equal(base(angel).stage, '乏情期');
  pass(angel, 1);
  assert.equal(base(angel).stage, '卵泡期');

  const human = setup('人类');
  pass(human, 6);
  assert.equal(base(human).stage, '卵泡期');
});

test('可用 bsSetMenstrualPhases 切入乏情期；乏情期不会自然排卵，留下的卵照日程过期', () => {
  const chatState = setup('天使', '卵泡期');
  const result = applyToolCall(chatState, { name: 'bsSetMenstrualPhases', arguments: { female: 'A', stage: '乏情期' } });
  assert.equal(result.applied, true);
  base(chatState).eggs = 2;
  pass(chatState, 1);
  assert.equal(base(chatState).stage, '乏情期');
  assert.equal(base(chatState).eggs, 1);
  pass(chatState, 1);
  assert.equal(base(chatState).eggs, 0);
});

const deposit = (chatState, male, race, amount) => {
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: 'A', male, race, action: 'insert', amount: 0 } });
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: 'A', male, race, action: 'deposit', amount } });
};
const climax = (chatState) => applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { orgasm: true } } });

test('乏情期诱发排卵：子宫灌满且八成以上是异种精液，高潮才排卵', () => {
  const REAL_RANDOM = Math.random;
  Math.random = () => 0.01;
  try {
    const foreign = setup('天使', '乏情期', 10);
    deposit(foreign, '人', '人类', 999);
    assert.equal(canDormancyOvulate(foreign.characters.A.profile), true);
    climax(foreign);
    assert.equal(base(foreign).eggs, 1);
    assert.equal(base(foreign).stage, '乏情期', '排卵后仍在乏情期');

    const same = setup('天使', '乏情期', 10);
    deposit(same, '天', '天使', 999);
    climax(same);
    assert.equal(base(same).eggs, 0, '同族灌满也不会触发');

    const switched = setup('天使', '黄体期', 1);
    switched.characters.A.profile.cooldown = { orgasmOvulationUsed: true };
    applyToolCall(switched, { name: 'bsSetMenstrualPhases', arguments: { female: 'A', stage: '乏情期' } });
    assert.equal(switched.characters.A.profile.cooldown.orgasmOvulationUsed, false, '手动切进乏情期与自然从月经期进来一样，冷却是新的');

    const partial = setup('天使', '乏情期', 10);
    deposit(partial, '人', '人类', 5);
    climax(partial);
    assert.equal(base(partial).eggs, 0, '没灌满不会触发');
  } finally {
    Math.random = REAL_RANDOM;
  }
});

test('异种占比按血统重叠：衍生类型与子项算同族，半精灵算一半异种', () => {
  const profile = (sperms) => ({ base: { race: '精灵', bloodline: null, sperms } });
  assert.equal(getForeignSemenShare(profile([{ race: '[血族]精灵', value: 10 }])), 0);
  assert.equal(getForeignSemenShare(profile([{ race: '精灵x人类', value: 10 }])), 0.5);
  assert.equal(getForeignSemenShare(profile([{ race: '人类', value: 80 }, { race: '精灵', value: 20 }])), 0.8);
  assert.equal(getConceptionStageWeight('乏情期'), 0.6);
});

test('名录与百科编辑器报出乏情天数', () => {
  assert.match(buildSingleRacePhysiologyText('天使'), /经期长度: 42天左右；月经后另有约 322 天乏情期（不排卵、不受孕），约 364 天才有一次受孕机会/);
  assert.match(buildSingleRacePhysiologyText('人类'), /经期长度: 28天左右\n/);
  assert.match(describeRaceFieldValue('dormancyDays', 322), /乏情期约 322 天/);
  assert.match(describeRaceFieldValue('dormancyDays', 0), /没有乏情期/);
});

test('v10 存档迁移：倍率仍是旧内置值的换成新倍率与乏情，期中天数等比缩放；改过的与无关物种不动', () => {
  const make = (race, ratio, stage = '月经期', days = 26) => {
    const character = state.createDefaultFemaleState(race);
    character.profile.base.race = race;
    character.profile.base.bloodline = null;
    character.profile.base.stage = stage;
    character.profile.base.days = days;
    character.profile.bio.menstrualLengthRatio = ratio;
    return character;
  };
  const characters = {
    angel: make('天使', 13),
    custom: make('天使', 5),
    half: make('精灵x人类', 2),
    human: make('人类', 1),
    fox: make('妖狐', 1, '黄体期', 5),
    horse: make('半人马', 1),
  };
  migrateCharacters(characters, 10);
  assert.equal(characters.angel.profile.bio.menstrualLengthRatio, 1.5);
  assert.equal(characters.angel.profile.bio.dormancyDays, 322);
  assert.equal(characters.angel.profile.base.days, 3, '月经期 65 天的第 26 天 → 7.5 天的第 3 天');
  assert.equal(characters.custom.profile.bio.menstrualLengthRatio, 5);
  assert.equal(characters.custom.profile.bio.dormancyDays, 0);
  assert.equal(characters.half.profile.bio.menstrualLengthRatio, 1.125);
  assert.equal(characters.half.profile.bio.dormancyDays, 147.5);
  assert.equal(characters.human.profile.bio.menstrualLengthRatio, 1);
  assert.equal(characters.human.profile.base.days, 26);
  assert.deepEqual([characters.fox.profile.bio.menstrualLengthRatio, characters.fox.profile.bio.dormancyDays, characters.fox.profile.bio.seasonCycles], [1, 337, 1]);
  assert.equal(characters.fox.profile.base.days, 5, '倍率没变的只补乏情，天数不动');
  assert.deepEqual([characters.horse.profile.bio.menstrualLengthRatio, characters.horse.profile.bio.seasonCycles], [0.75, 8]);
});

test('繁殖季内连续多轮：没跑满轮数就直接回卵泡期，跑满才乏情并归零', () => {
  const horse = setup('半人马');
  base(horse).seasonCycle = 6;
  pass(horse, 4);
  assert.equal(base(horse).stage, '卵泡期');
  assert.equal(base(horse).seasonCycle, 7);
  pass(horse, 18);
  assert.equal(base(horse).stage, '月经期');
  pass(horse, 4);
  assert.equal(base(horse).stage, '乏情期');
  assert.equal(base(horse).seasonCycle, 0);

  const fox = setup('妖狐');
  pass(fox, 6);
  assert.equal(base(fox).stage, '乏情期', '一年一次的狐每轮都乏情');
  assert.match(buildSingleRacePhysiologyText('半人马'), /21天左右；繁殖季连续约 8 轮（约 168 天，每轮都能受孕），之后进入乏情期约 197 天/);
  assert.equal(Math.round(getMergedRacePhysiologyProfile('半人马x人类').seasonCycles * 10) / 10, 4.5);
});

test('注册时按时间比例抽初始阶段：天使多半在乏情期，人类不会抽到乏情期', () => {
  const angel = getRacePhysiologyProfile('天使');
  const human = getRacePhysiologyProfile('人类');
  const draw = (bio, n) => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    return Array.from({ length: n }, () => state.deriveMenstrualStageState(bio, random));
  };
  const angelShare = draw(angel, 2000).filter((item) => item.stage === '乏情期').length / 2000;
  assert.ok(Math.abs(angelShare - 322 / 364) < 0.03, `天使抽到乏情期 ${angelShare}`);
  assert.equal(draw(human, 500).filter((item) => item.stage === '乏情期').length, 0);
  const horse = draw(getRacePhysiologyProfile('半人马'), 500).filter((item) => item.stage !== '乏情期');
  assert.ok(horse.every((item) => item.seasonCycle >= 0 && item.seasonCycle < 8));
  assert.ok(new Set(horse.map((item) => item.seasonCycle)).size > 4, '本季轮数也随机');
});

test('追踪页进度：有乏情期的物种标出本季第几轮、这一轮完了是否乏情', async () => {
  const { getStageProgress } = await import('../scripts/stage_progress.js');
  const horse = setup('半人马', '卵泡期', 2).characters.A.profile;
  horse.base.seasonCycle = 2;
  assert.equal(getStageProgress(horse).season, '第 3／8 轮');
  horse.base.seasonCycle = 7;
  assert.equal(getStageProgress(horse).season, '第 8／8 轮 · 之后乏情');
  assert.equal(getStageProgress(setup('天使', '卵泡期').characters.A.profile).season, '之后乏情');
  const angel = setup('天使', '乏情期', 10).characters.A.profile;
  assert.deepEqual([getStageProgress(angel).label, getStageProgress(angel).max, getStageProgress(angel).season], ['乏情进度', 322, undefined]);
  assert.equal(getStageProgress(setup('人类', '卵泡期').characters.A.profile).season, undefined);
});

test('繁殖季定锚（1.5.2）：设了繁殖季开始日的物种，乏情到下一个开始日为止；没设的照物种天数', async () => {
  const { setCalendarProvider, dateAt, normalizeCalendar } = await import('../scripts/calendar.js');
  const raw = { mode: 'custom', months: Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1}月`, days: 50 })),
    start: { year: 1, month: 1, day: 1 }, breedingSeasons: { 天使: { month: 3, day: 1 } } };
  setCalendarProvider(() => raw);
  try {
    // 月经期第 0 天起推 8 天：天使月经 7.5 天（倍率 1.5），在第 7.5 天进乏情
    const angel = setup('天使');
    pass(angel, 8);
    assert.equal(base(angel).stage, '乏情期');
    assert.equal(getStageLimit(angel.characters.A.profile, '乏情期'), 100 - 7.5, '3月1日＝第 100 天');
    pass(angel, 93);
    assert.equal(base(angel).stage, '卵泡期', '3月1日 进繁殖季');
    assert.equal(base(angel).days, 1, '现在 3月2日，卵泡期第 1 天');
    assert.deepEqual([dateAt(normalizeCalendar(raw), angel.minutesPassed).month, dateAt(normalizeCalendar(raw), angel.minutesPassed).day], [3, 2]);
    assert.equal(base(angel).seasonDormancyDays, undefined, '离开乏情拿掉覆盖');

    // 设历法时已在乏情：从乏情开始那刻对齐
    const resting = setup('天使', '乏情期', 10);
    pass(resting, 1);
    assert.equal(getStageLimit(resting.characters.A.profile, '乏情期'), 110, '乏情开始在第 -10 天，到 3月1日（第 100 天）共 110 天');

    // 没锚点的物种照旧
    raw.breedingSeasons = {};
    const plain = setup('天使');
    pass(plain, 8);
    assert.equal(getStageLimit(plain.characters.A.profile, '乏情期'), 322);
  } finally {
    setCalendarProvider(null);
  }
});

test('繁殖季定锚（1.5.2）：实验性混合池（pooled-v1）的角色同样乏情到开始日', async () => {
  const { setCalendarProvider } = await import('../scripts/calendar.js');
  const { enablePooledConception } = await import('../scripts/pooled_reproduction.js');
  setCalendarProvider(() => ({ mode: 'custom', months: Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1}月`, days: 50 })),
    start: { year: 1, month: 1, day: 1 }, breedingSeasons: { 天使: { month: 3, day: 1 } } }));
  try {
    const angel = setup('天使');
    enablePooledConception(angel.characters.A.profile.base, 0, { seed: 1 });
    pass(angel, 8);
    assert.equal(base(angel).stage, '乏情期');
    assert.equal(getStageLimit(angel.characters.A.profile, '乏情期'), 100 - 7.5);
    pass(angel, 93);
    assert.equal(base(angel).stage, '卵泡期', '3月1日 进繁殖季');
  } finally {
    setCalendarProvider(null);
  }
});

test('繁殖季定锚：种族子项（兽耳族-狼）照基种族的锚点', async () => {
  const { setCalendarProvider } = await import('../scripts/calendar.js');
  setCalendarProvider(() => ({ mode: 'custom', months: Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1}月`, days: 50 })),
    start: { year: 1, month: 1, day: 1 }, breedingSeasons: { 兽耳族: { month: 2, day: 1 } } }));
  try {
    const wolf = setup('兽耳族-狼', '乏情期', 60);
    pass(wolf, 1);
    assert.equal(getStageLimit(wolf.characters.A.profile, '乏情期'), 110, '乏情开始在第 -60 天，到 2月1日（第 50 天）共 110 天');
  } finally {
    setCalendarProvider(null);
  }
});

test('bsPassedTime 的月、年照日历：下个月同一天（月底夹回），不是平均月长', async () => {
  const { setCalendarProvider, dateAt, normalizeCalendar } = await import('../scripts/calendar.js');
  const odd = { mode: 'custom', months: [{ name: '长月', days: 31 }, { name: '短月', days: 20 }, { name: '平月', days: 30 }], start: { year: 1, month: 1, day: 15, hour: 9 } };
  try {
    setCalendarProvider(() => odd);
    const chat = setup('人类', '卵泡期', 0);
    pass(chat, 0);
    applyToolCall(chat, { name: 'bsPassedTime', arguments: { month: 1 } });
    const d = dateAt(normalizeCalendar(odd), chat.minutesPassed);
    assert.deepEqual([d.month, d.day, d.hour], [2, 15, 9], '长月15日 + 一个月 = 短月15日（31 天，不是平均 27 天）');
    applyToolCall(chat, { name: 'bsPassedTime', arguments: { month: 1 } });
    assert.equal(chat.minutesPassed / 1440, 31 + 20);

    const greg = { mode: 'gregorian', start: { year: 2027, month: 1, day: 31 } };
    setCalendarProvider(() => greg);
    const g = setup('人类', '卵泡期', 0);
    applyToolCall(g, { name: 'bsPassedTime', arguments: { month: 1 } });
    assert.deepEqual([dateAt(normalizeCalendar(greg), g.minutesPassed).month, dateAt(normalizeCalendar(greg), g.minutesPassed).day], [2, 28], '1/31 + 一个月 = 2/28（月底夹回）');

    const leap = { mode: 'gregorian', start: { year: 2028, month: 2, day: 29 } };
    setCalendarProvider(() => leap);
    const l = setup('人类', '卵泡期', 0);
    applyToolCall(l, { name: 'bsPassedTime', arguments: { year: 1, day: 1 } });
    const ld = dateAt(normalizeCalendar(leap), l.minutesPassed);
    assert.deepEqual([ld.year, ld.month, ld.day], [2029, 3, 1], '2028/2/29 + 一年 = 2029/2/28，再加一天');
  } finally {
    setCalendarProvider(null);
  }
});

test('繁殖季定锚：季内怀孕、季外生完，产后月经结束直接乏情到明年开季，不在季外补跑', async () => {
  const { setCalendarProvider, dateAt, normalizeCalendar } = await import('../scripts/calendar.js');
  const raw = { mode: 'custom', months: Array.from({ length: 10 }, (_, i) => ({ name: `${i + 1}月`, days: 40 })), start: { year: 1, month: 6, day: 1 }, breedingSeasons: { 兽耳族: { month: 3, day: 1 } } };
  setCalendarProvider(() => raw);
  try {
    const wolf = setup('兽耳族-狼', '产后恢复', 0);
    wolf.characters.A.profile.bio.recoveryDays = 56;
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) {
      pass(wolf, 1);
      seen.add(`${base(wolf).stage}@${dateAt(normalizeCalendar(raw), wolf.minutesPassed).year}`);
    }
    assert.equal(seen.has('卵泡期@1'), false, '第 1 年季外不发情');
    assert.equal(seen.has('卵泡期@2'), true, '第 2 年开季');

    // 一次跳三年与逐日推进结果一致
    const jump = setup('兽耳族-狼', '月经期', 0);
    applyToolCall(jump, { name: 'bsPassedTime', arguments: { day: 1200 } });
    const step = setup('兽耳族-狼', '月经期', 0);
    for (let i = 0; i < 1200; i += 1) pass(step, 1);
    assert.deepEqual([base(jump).stage, Math.round(base(jump).days * 100)], [base(step).stage, Math.round(base(step).days * 100)]);
  } finally {
    setCalendarProvider(null);
  }
});
