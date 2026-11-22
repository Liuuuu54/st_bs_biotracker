// 回归测试：写给追踪模型的工具提示不能原样进入主线叙事，避孕结果只提醒一轮。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildMainFlowPrompt, buildTrackerPayload } from '../scripts/tracker.js';
import { narrativeReminders } from '../scripts/prompts/rules.js';

function setup(characters) {
  const ctx = { chatId: 'narrative', chat: [{ is_user: false, name: 'N', mes: '旅途中。' }], characters: [], name1: 'U', name2: 'N', extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  for (const [name, stage, patch] of characters) {
    const ch = state.createDefaultFemaleState(name);
    ch.initialized = true;
    ch.profile.base.stage = stage;
    ch.profile.base.age = 24;
    patch?.(ch.profile);
    chatState.characters[name] = ch;
  }
  return { ctx, settings, chatState };
}

test('high needs reach the narrator as a neutral body state, not as a tool order', () => {
  const { ctx, settings, chatState } = setup([['甲', '卵泡期', (p) => { p.metabolism = { ...p.metabolism, excretion: 149, hunger: 120 }; }]]);
  assert.equal(applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 10 } }).applied, true);
  const original = chatState.characters['甲'].profile.notify.thirdly;
  assert.match(original, /应优先使用 bsExcreteMetabolism/);

  const prompt = buildMainFlowPrompt(ctx, settings);
  assert.doesNotMatch(prompt, /bsExcreteMetabolism|应优先/);
  assert.match(prompt, /甲有明显的生理需求（泄意:爆、饿意:满）：可自然体现身体状态，不要求本轮处理/);
  // 追踪模型仍要知道该用哪个工具
  assert.equal(buildTrackerPayload(ctx, settings, 'manual').existing_state['甲'].profile.notify.thirdly, original);
});

test('narrator rewrite drops nutrition rewards and care advice but keeps rupture bans', () => {
  const text = [
    '甲有强烈的生理需求（泄意:高），应优先使用 bsExcreteMetabolism 缓解生理不适',
    '甲渴望陪伴，但当前臭意会妨碍社交舒适度',
    '清洁后再给予陪伴或安抚更有效',
    '甲有需求正处于「高」：趁现在彻底处理能为胎儿补充供养力，拖到「爆」则会流失',
    '乙的正极需求已达到爆，应优先使用 bsExcreteMetabolism 进行解放',
    '若释放量足够大，需求极性才会跨过 0 翻转',
    '乙仍有未被衍生代谢抵免的生理需求（饿意:满），可用 bsExcreteMetabolism 处理',
    '丙渴望陪伴，可优先给予陪伴、交流或安抚',
    '丁尚未破水（膜耐性还有40%）：禁止描写破水、羊水流出或羊膜破裂',
  ].join('；');
  assert.deepEqual(narrativeReminders(text).split('；'), [
    '甲有明显的生理需求（泄意:高）：可自然体现身体状态，不要求本轮处理',
    '甲渴望陪伴，但身上的气味令人在意',
    '乙的正极需求已达到爆：可自然体现，不要求本轮处理',
    '乙仍有生理需求（饿意:满）：可自然体现，不要求本轮处理',
    '丙渴望陪伴',
    '丁尚未破水（膜耐性还有40%）：禁止描写破水、羊水流出或羊膜破裂',
  ]);
});

test('a condom result reaches only the next narration, then stays in the data only', () => {
  const { ctx, settings, chatState } = setup([['甲', '卵泡期']]);
  chatState.reproductiveSettings = { condomReliability: 0 };
  const run = (calls) => { chatState.lastOperationLogs = calls.map((args) => ({ ...args, ...applyToolCall(chatState, args) })); };
  run([
    { name: 'bsAddSperm', arguments: { female: '甲', male: 'M', race: '人类', action: 'insert', amount: 0, hasCondom: true } },
    { name: 'bsAddSperm', arguments: { female: '甲', male: 'M', race: '人类', action: 'deposit', amount: 20 } },
  ]);
  const next = buildMainFlowPrompt(ctx, settings);
  assert.match(next, /"lastCondomResult":\{[^}]*"condomFailed":true/);
  assert.match(next, /\[上轮已结算的生殖操作结果\]/);
  assert.match(next, /不要求本轮处理/);

  run([{ name: 'bsPassedTime', arguments: { hour: 8 } }]);
  const later = buildMainFlowPrompt(ctx, settings);
  assert.doesNotMatch(later, /lastCondomResult|上轮已结算的生殖操作结果/);
  assert.equal(chatState.characters['甲'].profile.lastCondomResult.condomFailed, true);
});

test('labor reminders keep the bans for the narrator but never name a tool', () => {
  const text = [
    '甲尚未破水（膜耐性还有95%）：禁止描写破水、羊水流出或羊膜破裂。若剧情确实需要破水，必须先调用 bsAssistFetalPosition（action=rupture），成功后才可如此描写',
    '乙正处于产兆前驱阶段',
    '若剧情明确把胎儿往上托，可用 bsAssistFetalPosition（action=lift）延后分娩，需要足够活力',
    '丙正在延产期（膜耐性还有100%）：禁止描写破水、羊水流出、羊膜破裂或分娩发动。延产期间无法破水，也不会自然发动',
    '剧情要结束延产，必须先调用 bsExtendPregnancy（action=induce）引产进入产兆前驱',
    '已跨入新的一天',
    '若角色有值得沉淀的经历、心境、关系或身体变化，可调用 bsWriteDiary 写入主观日记',
  ].join('；');
  assert.deepEqual(narrativeReminders(text).split('；'), [
    '甲尚未破水（膜耐性还有95%）：禁止描写破水、羊水流出或羊膜破裂',
    '乙正处于产兆前驱阶段',
    '丙正在延产期（膜耐性还有100%）：禁止描写破水、羊水流出、羊膜破裂或分娩发动。延产期间无法破水，也不会自然发动',
    '已跨入新的一天',
  ]);
});

test('a rupture replaces the not-yet-ruptured ban in the same turn', () => {
  const { ctx, settings, chatState } = setup([['甲', '卵泡期']]);
  assert.equal(applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 272 } }).applied, true);
  assert.equal(applyToolCall(chatState, { name: 'bsDebugSetProdromal', arguments: { female: '甲', progressPercent: 99 } }).applied, true);
  assert.equal(applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 3 } }).applied, true);
  assert.equal(chatState.characters['甲'].profile.base.stage, '第一产程');
  assert.match(chatState.characters['甲'].profile.notify.thirdly, /尚未破水/);

  assert.equal(applyToolCall(chatState, { name: 'bsAssistFetalPosition', arguments: { female: '甲', action: 'rupture' } }).applied, true);
  const notify = chatState.characters['甲'].profile.notify;
  assert.equal(notify.secondly, '甲破水了');
  assert.doesNotMatch(notify.thirdly, /尚未破水/);
  assert.match(notify.thirdly, /甲已破水/);
  assert.doesNotMatch(buildMainFlowPrompt(ctx, settings), /尚未破水|bsAssistFetalPosition/);
});

test('an obstruction warning reaches the narrator without the tool advice', () => {
  const { ctx, settings, chatState } = setup([['甲', '卵泡期', (p) => { p.immune = { ...p.immune, realisticLabor: true }; }]]);
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 272 } });
  chatState.characters['甲'].profile.pregnant.fetuses[0].tendencyAngle = 90;
  applyToolCall(chatState, { name: 'bsDebugSetProdromal', arguments: { female: '甲', progressPercent: 99 } });
  for (let i = 0; i < 4 && !/难产/.test(chatState.characters['甲'].profile.notify.firstly); i += 1) applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 30 } });
  assert.match(chatState.characters['甲'].profile.notify.firstly, /横位，无法入盆，可用 bsAssistFetalPosition/);
  const prompt = buildMainFlowPrompt(ctx, settings);
  assert.match(prompt, /"firstly":"(甲进入了第一产程；)?甲发生难产警示：领头的胎儿呈横位，无法入盆"/);
  assert.doesNotMatch(prompt, /\bbs[A-Z]\w*/);
});

test('a fertilized egg stays hidden from the narrator until it implants; the tracker still sees it', () => {
  const { ctx, settings, chatState } = setup([['甲', '排卵期', (p) => {
    p.bio.impregnationDifficulty = 0.01;
    p.base.eggs = 1;
    p.base.days = 0;
    p.base.sperms = [{ male: 'M', race: '人类', bloodline: { 人类: 1 }, bloodlineSource: 'pure', value: 30 }];
  }]]);
  const profile = () => chatState.characters['甲'].profile;
  // 状态 JSON 注入时把 </ 转义成 <\/，解析前还原
  const narratedState = () => JSON.parse(buildMainFlowPrompt(ctx, settings).match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\\/').join('</'));
  // 受孕难度下限 0.1：暴露两天受精几乎必成，但仍是机率；钉住乱数，否则约数十轮会有一次没受精而失败。
  // 取 0.05 而不是 0：0 会让所有机率事件都成立，两颗卵还会融合成嵌合胎，通知变成「融合」
  const realRandom = Math.random;
  Math.random = () => 0.05;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  } finally {
    Math.random = realRandom;
  }
  assert.equal(profile().pregnant.fetuses.length > 0, true, 'fixture should fertilize');
  assert.match(profile().notify.secondly, /受精成功/);

  assert.doesNotMatch(buildMainFlowPrompt(ctx, settings), /受精成功/);
  assert.equal(narratedState()['甲'].profile.pregnant, undefined, 'no fetus data before implantation');
  const tracked = buildTrackerPayload(ctx, settings, 'manual').existing_state['甲'].profile;
  assert.match(tracked.notify.secondly, /受精成功/);
  assert.ok(tracked.pregnant.fetuses.length > 0);

  // 著床失败率照卵子品质（一般约 5%）：同样钉住乱数，0.05 不会判失败
  Math.random = () => 0.05;
  try {
    for (let day = 0; day < 20 && profile().base.stage !== '孕早期'; day += 1) applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  } finally {
    Math.random = realRandom;
  }
  assert.equal(profile().base.stage, '孕早期');
  assert.ok(narratedState()['甲'].profile.pregnant, 'after implantation the narrator sees the pregnancy');
});

test('before the second stage the narrator is banned from writing the birth, without the tool hint', () => {
  const { ctx, settings, chatState } = setup([['甲', '卵泡期']]);
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 265 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 10 } });
  const profile = chatState.characters['甲'].profile;
  assert.equal(profile.base.stage, '临产期');
  assert.match(profile.notify.thirdly, /尚未进入第二产程：禁止描写胎儿娩出或生下孩子。若剧情已经写出自然分娩，以 bsChildbirth（mode=natural）同步/);
  const narration = buildMainFlowPrompt(ctx, settings);
  assert.match(narration, /甲尚未进入第二产程：禁止描写胎儿娩出或生下孩子/);
  assert.doesNotMatch(narration, /mode=natural/);
});

test('story contractions at term start the prodromal stage at once, and descend shortens it by half a stage', () => {
  const { chatState } = setup([['甲', '卵泡期']]);
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 265 } });
  applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: '甲', options: { uterinePressure: 150 } } });
  const profile = () => chatState.characters['甲'].profile;
  assert.equal(profile().base.stage, '产兆前驱', 'no warning round when the story already shows the signs');
  assert.equal(profile().pregnant.prodromalRemainingHours, 48);
  applyToolCall(chatState, { name: 'bsAssistFetalPosition', arguments: { female: '甲', action: 'descend' } });
  assert.equal(profile().pregnant.prodromalRemainingHours, 24);
});

test('a small pressure rise at term still goes through the warning round', () => {
  const { chatState } = setup([['甲', '卵泡期']]);
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 265 } });
  applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: '甲', options: { uterinePressure: 10 } } });
  assert.equal(chatState.characters['甲'].profile.base.stage, '临产期');
});

test('the prodromal stage lasts 48 hours regardless of birth difficulty', () => {
  const { chatState } = setup([['甲', '卵泡期', (p) => { p.base.race = '巨人'; }]]);
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 1, equivalentDays: 265, race: '巨人' } });
  assert.ok(chatState.characters['甲'].profile.bio.birthDifficulty >= 3, 'fixture should be a hard birth');
  applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: '甲', options: { uterinePressure: 999 } } });
  assert.equal(chatState.characters['甲'].profile.pregnant.prodromalRemainingHours, 48);
});

test('bsChildbirth records a natural birth only when asked, and refuses it before late pregnancy', () => {
  const deliver = (equivalentDays, mode) => {
    const { chatState } = setup([['甲', '卵泡期']]);
    applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', fetusCount: 2, equivalentDays } });
    const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '甲', ...(mode ? { mode } : {}) } });
    return { result, profile: chatState.characters['甲'].profile };
  };
  const natural = deliver(265, 'natural');
  assert.equal(natural.result.applied, true);
  assert.equal(natural.profile.experience.naturalBirthExperience, 1);
  assert.equal(natural.profile.experience.surgicalBirthExperience, 0);
  assert.equal(natural.profile.children.length, 2);

  const surgical = deliver(265);
  assert.equal(surgical.profile.experience.surgicalBirthExperience, 1, 'omitting mode stays a surgical birth');
  assert.equal(surgical.profile.experience.naturalBirthExperience, 0);

  const early = deliver(150, 'natural');
  assert.equal(early.result.applied, false, 'a mid-pregnancy delivery is a miscarriage, not a birth');
  assert.equal(early.profile.base.stage, '孕中期');
});

test('自订药物名录的药名送给主线，通用预设不送（1.5.3）', async () => {
  const { setDrugCatalogProvider, DEFAULT_DRUG_CATALOG } = await import('../scripts/repro_effects.js');
  const { ctx, settings } = setup([['甲', '卵泡期']]);
  try {
    setDrugCatalogProvider(() => DEFAULT_DRUG_CATALOG);
    assert.doesNotMatch(buildMainFlowPrompt(ctx, settings), /这个世界的生殖药物/);
    setDrugCatalogProvider(() => [{ name: '月神露', description: '精灵祭司调的助孕露', effects: [{ effect: 'fertility', strength: 'normal' }], days: 7 }]);
    const prompt = buildMainFlowPrompt(ctx, settings);
    assert.match(prompt, /\[这个世界的生殖药物\]\n- 月神露：精灵祭司调的助孕露/);
    const drugBlock = prompt.match(/\[这个世界的生殖药物\][\s\S]*?效果由系统结算/)[0];
    assert.doesNotMatch(drugBlock, /fertility|strength|days/, '药名段不送效果与数值');
  } finally {
    setDrugCatalogProvider(null);
  }
});

test('事后避孕走生殖干预后，结果照样只给主线看一轮（1.5.3）', async () => {
  const { projectNarrativeState } = await import('../scripts/prompts/rules.js');
  const state = { A: { profile: { base: { stage: '黄体期' }, lastEmergencyResult: { outcomes: [] } } } };
  const fresh = [{ name: 'bsReproductiveIntervention', female: 'A', applied: true, message: 'bsReproductiveIntervention applied to A（晨露汤）: 事后避孕.' }];
  assert.ok(projectNarrativeState(state, fresh).A.profile.lastEmergencyResult, '刚结算的那一轮看得到');
  assert.equal(projectNarrativeState(state, []).A.profile.lastEmergencyResult, undefined, '之后不再提醒');
  const other = [{ name: 'bsReproductiveIntervention', female: 'A', applied: true, message: 'bsReproductiveIntervention applied to A（月神露）: 助孕（7 天）.' }];
  assert.equal(projectNarrativeState(state, other).A.profile.lastEmergencyResult, undefined, '别的药不算');
});

test('主线状态把数值换成文字，追踪模型照旧给数字（1.5.3）', async () => {
  const { applyToolCall: apply } = await import('../scripts/tools.js');
  const { ctx, settings, chatState } = setup([['甲', '卵泡期', (p) => { p.base.vitality = 20; p.base.psyStress = 100; p.metabolism = { ...p.metabolism, hunger: 120, sleep: 10 }; }]]);
  apply(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: '甲', mode: 'normal', father: 'U', race: '人类', fetusCount: 1, genders: '女', equivalentDays: 150 } });
  const narrated = JSON.parse(buildMainFlowPrompt(ctx, settings).match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\/').join('</'))['甲'].profile;
  assert.equal(narrated.base.vitality, '筋疲力尽', '20／125');
  assert.equal(narrated.base.psyStress, '濒临崩溃', '100／110');
  assert.equal(narrated.base.uterinePressure, '松弛');
  assert.equal(narrated.base.eggQuality, undefined, '卵子品质主线用不到');
  assert.equal(narrated.base.cycleLengthFactor, undefined);
  assert.deepEqual(narrated.metabolism, { hunger: '满' }, '没有的需求不列');
  assert.equal(typeof narrated.pregnant.bellySize, 'string');
  assert.equal(narrated.pregnant.fetuses[0].affinity, '一般');
  assert.ok(['偏小', '适中', '偏大'].includes(narrated.pregnant.fetuses[0].weight));
  assert.equal(narrated.pregnant.fetuses[0].eggQuality, undefined);
  const tracked = buildTrackerPayload(ctx, settings, 'manual').existing_state['甲'].profile;
  assert.equal(tracked.base.vitality, 20, '追踪模型要算增减，照旧给数字');
  assert.equal(tracked.metabolism.hunger, 120);
  assert.equal(chatState.characters['甲'].profile.base.vitality, 20, '不碰存档');
});

test('情压在初始值（上限一半）读作平稳', () => {
  const { ctx, settings } = setup([['乙', '卵泡期']]);
  const narrated = JSON.parse(buildMainFlowPrompt(ctx, settings).match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\/').join('</'))['乙'].profile;
  assert.equal(narrated.base.psyStress, '平稳');
  assert.equal(narrated.base.vitality, '精力充沛');
});
