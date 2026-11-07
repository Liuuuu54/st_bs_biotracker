// 同一轮追踪里的事件提醒：被后面的工具盖掉或被推进时间洗掉的，补回前面；本轮之前的旧提醒不补。
// 另含注册时胎儿性别的补齐。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCallsResult } from '../scripts/tools.js';
import { applyRegistryResult } from '../scripts/registry.js';
import { normalizeReproductiveSettings } from '../scripts/reproductive.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function setup(notify = {}) {
  const chatState = state.createEmptyChatState();
  chatState.reproductiveSettings = normalizeReproductiveSettings({});
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: { stage: '孕中期', days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 20, uterinePressure: 0, psyStress: 0,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1 },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1 },
      pregnant: { pregnantDays: 120, effectivePregnantDays: 120, fetusesCount: 1, fetalEnergyDrain: 0, nutritionBurst: {},
        fetuses: [{ embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, healthMax: 100, health: 50 }] },
      experience: {}, immune: { metabolism: true }, metabolism: {}, cooldown: {}, skills: [], talents: [], children: [], notify,
    },
  };
  const ctx = {
    chatId: 'notify-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'notify-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return { ctx, chatState: () => ctx.extensionSettings.bs_biotracker.chatStates['notify-chat'] };
}
const harm = { name: 'bsFetalEvent', arguments: { female: 'A', time: '一日', kind: 'substance', change: 'significant_decrease', content: '喝了半夜' } };

test('事件提醒被推进时间洗掉：补回前面', () => {
  Math.random = () => 0.5;
  const { ctx, chatState } = setup();
  applyToolCallsResult(ctx, { tool_calls: [harm, { name: 'bsPassedTime', arguments: { hour: 1 } }] });
  assert.match(chatState().characters.A.profile.notify.secondly, /^第1胎受到有害物质影响（明显）/);
});

test('事件提醒被后面的工具改写成别的内容：补回前面，后来的接在后面', () => {
  Math.random = () => 0.5;
  const { ctx, chatState } = setup();
  applyToolCallsResult(ctx, { tool_calls: [harm, { name: 'bsFetalEvent', arguments: { female: 'A', time: '一日', kind: 'trauma', change: 'slight_decrease', content: '撞了一下' } }] });
  const parts = chatState().characters.A.profile.notify.secondly.split('；');
  assert.equal(parts.length, 2);
  assert.match(parts[0], /有害物质/);
  assert.match(parts[1], /腹部外伤/);
});

test('本轮开始前就在的旧提醒不补；没有被盖掉时不重复', () => {
  Math.random = () => 0.5;
  const { ctx, chatState } = setup({ secondly: '上一轮的旧提醒' });
  applyToolCallsResult(ctx, { tool_calls: [{ name: 'bsPassedTime', arguments: { hour: 1 } }] });
  assert.doesNotMatch(String(chatState().characters.A.profile.notify.secondly || ''), /上一轮的旧提醒/);
  const fresh = setup();
  applyToolCallsResult(fresh.ctx, { tool_calls: [harm] });
  assert.equal(fresh.chatState().characters.A.profile.notify.secondly, '第1胎受到有害物质影响（明显）');
});

test('注册：模型没给胎儿性别就按种族性别比补上；同卵的几胎共用一个', () => {
  const chatState = state.createEmptyChatState();
  const F = (over = {}) => ({ fathers: '甲', race: '人类', embryoType: '胎生', ...over });
  applyRegistryResult(chatState, {
    name: 'A',
    profile: {
      base: { race: '人类', age: 24 },
      pregnant: { pregnantDays: 150, fetusesCount: 4, fetuses: [F(), F({ gender: '男' }), F({ tags: ['identical'], identicalGroup: 7 }), F({ tags: ['identical'], identicalGroup: 7 })] },
    },
  });
  const genders = chatState.characters.A.profile.pregnant.fetuses.map((item) => item.gender);
  for (const gender of genders) assert.ok(['男', '女'].includes(gender), `性别 ${gender}`);
  assert.equal(genders[1], '男', '给了就沿用');
  assert.equal(genders[2], genders[3], '同卵同性别');
});
