// 回归测试：写给追踪模型的工具提示不能原样进入主线叙事，避孕结果只提醒一轮。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { buildMainFlowPrompt, buildTrackerPayload } from '../scripts/tracker.js';
import { narrativeReminders } from '../scripts/tracker_prompt_context.js';

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
  assert.match(prompt, /"firstly":"甲发生难产警示：领头的胎儿呈横位，无法入盆"/);
  assert.doesNotMatch(prompt, /\bbs[A-Z]\w*/);
});
