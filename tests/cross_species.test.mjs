// 万族相容（卵方个体的 immune.crossSpecies）：跨种受精不加难度；受孕不受雄核、雌核约束，一律混血；血脉平手随父方
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { deriveFetusAncestry, getFetusInheritanceTag } from '../scripts/race_config.js';
import { pickIconRace } from '../scripts/race_icons.js';
import { buildLineageView } from '../scripts/lineage_view.js';
import { buildRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { applyToolCall } from '../scripts/tools.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';

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

test('万族相容的母亲一律混血，平手的胚型随父方，并把平手随父带到孩子', () => {
  const chatState = setup({ crossSpecies: true });
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
  assert.deepEqual(deriveFetusAncestry('人类', '哥布林', { crossSpecies: true }).bloodline, { 哥布林: 0.5, 人类: 0.5 });
  assert.deepEqual(deriveFetusAncestry('媚魔', '人类', { crossSpecies: true }).bloodline, { 人类: 0.5, 媚魔: 0.5 }, '雌核同样被拿掉');
  assert.equal(getFetusInheritanceTag('人类', '哥布林', { crossSpecies: true }), null);
  assert.deepEqual(deriveFetusAncestry('人类', '精灵', { crossSpecies: true }), deriveFetusAncestry('人类', '精灵'));
});

test('族谱图示：平手的孩子平常取母系，母亲有万族相容的取父系', () => {
  const child = (id, extra = {}) => ({ id, name: id, fathers: '甲', race: '精灵x人类', bloodline: { 精灵: 0.5, 人类: 0.5 }, fatherRace: '精灵', fatherBloodline: { 精灵: 1 }, gender: '女', age: 3, ...extra });
  const chatState = setup();
  chatState.characters.A.profile.children = [child('平常'), child('免疫', { paternalTie: true })];
  const view = buildLineageView(chatState, 'A', { up: 1, down: 1 });
  const node = (name) => view.nodes.find((item) => item.displayName === name);
  assert.equal(pickIconRace('精灵x人类', node('平常').bloodline, node('平常').tieBloodline), '人类');
  assert.equal(pickIconRace('精灵x人类', node('免疫').bloodline, node('免疫').tieBloodline), '精灵');
});

test('异种精液提示照免疫写核型判定', () => {
  const chatState = setup({ crossSpecies: true });
  chatState.characters.A.profile.base.sperms = [{ male: '哥布林甲', race: '哥布林', value: 20 }];
  // 走追踪投影：immune.crossSpecies 要留在投影里，提示才看得到
  const ctx = {
    chatId: 'cross-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'cross-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  assert.deepEqual(payload.existing_state.A.profile.immune, { crossSpecies: true });
  const block = buildRacePhysiologyPrompt(payload);
  assert.match(block, /卵方有万族相容，不论核型一律混血/);
  assert.match(block, /核型判定后胎儿种族: 哥布林x人类/);
  assert.match(block, /卵方万族相容，跨种与胚胎类型不同都不加难度/);
});

test('跨种受精障碍取消：异族、胚型不同都与同族一样只看卵方难度', () => {
  const preview = (crossSpecies, race) => calculateFertilizationPreview({ eggRace: '人类', elapsedDays: 1, spermSources: [{ race, value: 20 }], crossSpecies }).sources[0];
  const same = preview(false, '人类');
  const egg = preview(false, '深潜者');
  const immune = preview(true, '深潜者');
  assert.equal(egg.sameRace, false);
  assert.equal(egg.embryoTypeMismatch, true, '人类胎生对深潜者卵生');
  assert.ok(egg.effectiveDifficulty > same.effectiveDifficulty);
  assert.equal(immune.sameRace, true);
  assert.equal(immune.embryoTypeMismatch, false);
  assert.equal(immune.effectiveDifficulty, same.effectiveDifficulty);
  assert.equal(immune.chance, same.chance);
});

test('异种精液提示的难度算式与实际受精计算一致', () => {
  const chatState = setup();
  chatState.characters.A.profile.base.sperms = [{ male: '深潜者甲', race: '深潜者', value: 20 }];
  const ctx = {
    chatId: 'diff-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'diff-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const block = buildRacePhysiologyPrompt(buildTrackerPayload(ctx, state.getSettings(ctx)));
  const line = block.split('\n').find((text) => text.includes('系统受精难度计算'));
  // 算式那一段不含精量加成，实际难度要乘回加成再比
  const { effectiveDifficulty, spermDoseBonus } = (() => {
    const result = calculateFertilizationPreview({ eggRace: '人类', elapsedDays: 1, spermSources: [{ race: '深潜者', value: 20 }] });
    return { effectiveDifficulty: result.sources[0].effectiveDifficulty, spermDoseBonus: result.spermDoseBonus };
  })();
  const expected = Math.round(effectiveDifficulty * spermDoseBonus * 100) / 100;
  assert.match(line, /√\(母体 .* × 精方 .*\) × 跨种 1\.5，且因胚胎类型不同（胎生 vs 卵生）再 ×1\.25/);
  assert.ok(line.includes(`= ${expected}`), `${line} 应含 = ${expected}`);
});
