// 核型免疫（卵方个体的 immune.karyotype）：受孕不受雄核、雌核约束，一律混血；血脉平手随父方
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { deriveFetusAncestry, getFetusInheritanceTag } from '../scripts/race_config.js';
import { pickIconRace } from '../scripts/race_icons.js';
import { buildLineageView } from '../scripts/lineage_view.js';
import { buildRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { applyToolCall } from '../scripts/tools.js';

function setup(immune = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 0, isHere: true, age: 24, race: '人类', vitality: 150, libido: 0, uterinePressure: 10,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: { pregnantDays: 0, effectivePregnantDays: 0, fetusesCount: 0, fetuses: [] },
      experience: {}, immune, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}

const inject = (chatState) => applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: '深潜者甲', race: '深潜者' } });

test('没有免疫时照核型：人类母亲怀深潜者（雄核）的孩子只得深潜者', () => {
  const chatState = setup();
  assert.equal(inject(chatState).applied, true);
  const [fetus] = chatState.characters.A.profile.pregnant.fetuses;
  assert.equal(fetus.race, '深潜者');
  assert.ok(fetus.tags.includes('androgenesis'));
  assert.equal(fetus.paternalTie, undefined);
});

test('核型免疫的母亲一律混血，平手的胚型随父方，并把平手随父带到孩子', () => {
  const chatState = setup({ karyotype: true });
  assert.equal(inject(chatState).applied, true);
  const [fetus] = chatState.characters.A.profile.pregnant.fetuses;
  assert.deepEqual(fetus.bloodline, { 深潜者: 0.5, 人类: 0.5 });
  assert.ok(!fetus.tags.includes('androgenesis'), '不算雄核发生');
  assert.equal(fetus.paternalTie, true);
  // 人类与深潜者孕速相同，平手后本来取母系的胎生，免疫改随父方的卵生
  assert.equal(fetus.embryoType, '卵生');
});

test('纯函数：免疫只拿掉核型约束，双方都没核型时结果一样', () => {
  assert.equal(deriveFetusAncestry('人类', '哥布林').race, '哥布林');
  assert.deepEqual(deriveFetusAncestry('人类', '哥布林', { karyotypeImmune: true }).bloodline, { 哥布林: 0.5, 人类: 0.5 });
  assert.deepEqual(deriveFetusAncestry('媚魔', '人类', { karyotypeImmune: true }).bloodline, { 人类: 0.5, 媚魔: 0.5 }, '雌核同样被拿掉');
  assert.equal(getFetusInheritanceTag('人类', '哥布林', { karyotypeImmune: true }), null);
  assert.deepEqual(deriveFetusAncestry('人类', '精灵', { karyotypeImmune: true }), deriveFetusAncestry('人类', '精灵'));
});

test('族谱图示：平手的孩子平常取母系，母亲有核型免疫的取父系', () => {
  const child = (id, extra = {}) => ({ id, name: id, fathers: '甲', race: '精灵x人类', bloodline: { 精灵: 0.5, 人类: 0.5 }, fatherRace: '精灵', fatherBloodline: { 精灵: 1 }, gender: '女', age: 3, ...extra });
  const chatState = setup();
  chatState.characters.A.profile.children = [child('平常'), child('免疫', { paternalTie: true })];
  const view = buildLineageView(chatState, 'A', { up: 1, down: 1 });
  const node = (name) => view.nodes.find((item) => item.displayName === name);
  assert.equal(pickIconRace('精灵x人类', node('平常').bloodline, node('平常').tieBloodline), '人类');
  assert.equal(pickIconRace('精灵x人类', node('免疫').bloodline, node('免疫').tieBloodline), '精灵');
});

test('异种精液提示照免疫写核型判定', () => {
  const chatState = setup({ karyotype: true });
  chatState.characters.A.profile.base.sperms = [{ male: '哥布林甲', race: '哥布林', value: 20 }];
  // 走追踪投影：immune.karyotype 要留在投影里，提示才看得到
  const ctx = {
    chatId: 'karyo-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'karyo-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  assert.deepEqual(payload.existing_state.A.profile.immune, { karyotype: true });
  const block = buildRacePhysiologyPrompt(payload);
  assert.match(block, /卵方有核型免疫，不论核型一律混血/);
  assert.match(block, /核型判定后胎儿种族: 哥布林x人类/);
});
