// 子宫图的画面事件：每个角色只记最近一笔 { type, seq }，介面比 seq 决定要不要播特写。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function setup(stage, over = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 150, libido: 0, uterinePressure: 0,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
        penetrationState: 'idle', penetrationSource: null, ...over.base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1, orgasmOvulationAmount: 2, impregnationDifficulty: 1, ...over.bio },
      pregnant: { pregnantDays: 0, effectivePregnantDays: 0, fetusesCount: 0, fetuses: [], ...over.pregnant },
      cooldown: {}, experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
// 事件另带套用当下的时间（at，判断同一轮用），这里只比种类与序号
const cue = (chatState) => { const value = P(chatState).visualCue; return value ? { type: value.type, seq: value.seq } : value; };
const call = (chatState, name, args) => applyToolCall(chatState, { name, arguments: { female: 'A', ...args } });

test('插入与射精各记一笔，seq 逐次加一', () => {
  const chatState = setup('卵泡期');
  assert.equal(call(chatState, 'bsAddSperm', { male: 'M', race: '人类', action: 'insert', amount: 0 }).applied, true);
  assert.deepEqual(cue(chatState), { type: 'insert', seq: 1 });
  assert.equal(call(chatState, 'bsAddSperm', { male: 'M', race: '人类', action: 'deposit', amount: 20 }).applied, true);
  assert.deepEqual(cue(chatState), { type: 'ejaculate', seq: 2 });
});

test('被拒绝的操作不留事件', () => {
  const chatState = setup('卵泡期');
  assert.equal(call(chatState, 'bsAddSperm', { male: 'M', race: '人类', action: 'deposit', amount: 20 }).applied, false);
  assert.equal(cue(chatState) ?? null, null);
});

test('自然排卵与高潮额外排卵都记为 ovulation', () => {
  const natural = setup('排卵期');
  applyToolCall(natural, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.equal(cue(natural)?.type, 'ovulation');

  const orgasm = setup('卵泡期');
  assert.equal(call(orgasm, 'bsUpdateCharacterStatus', { options: { libido: 9999 } }).applied, true);
  assert.equal(cue(orgasm)?.type, 'ovulation');
});

function implant(embryoType, vitality = 150) {
  const chatState = setup('黄体期', {
    base: { vitality, fertilizationDays: 30 },
    pregnant: {
      fetusesCount: 1,
      fetuses: [{
        embryoId: 1, fusionCheckedWith: [], tags: [], fathers: 'M', race: '人类', fatherRace: '人类',
        gender: '女', embryoType, weight: 1, tendencyAngle: 0, affinity: 0,
      }],
    },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  return chatState;
}

test('着床成功不分胚型，一律记为 implantation', () => {
  Math.random = () => 0.99;
  for (const embryoType of ['胎生', '胎转卵生', '卵生', '卵胎生', '不定型']) {
    const chatState = implant(embryoType);
    assert.equal(P(chatState).base.stage, '孕早期', embryoType);
    assert.equal(cue(chatState)?.type, 'implantation', embryoType);
  }
});

test('体力不足导致着床失败时记为 implantationFailed', () => {
  Math.random = () => 0;
  const chatState = implant('胎生', 10);
  assert.equal(P(chatState).pregnant.fetuses.length, 0);
  assert.equal(cue(chatState)?.type, 'implantationFailed');
});

test('正规化丢弃无效的事件纪录', () => {
  for (const bad of [{ type: 'nope', seq: 1 }, { type: 'insert', seq: 0 }, { type: 'insert', seq: 1.5 }, 'insert']) {
    const character = { name: 'A', profile: { visualCue: bad } };
    assert.equal(state.normalizeCharacterPsychologyState(character).profile.visualCue, null);
  }
  const ok = { name: 'A', profile: { visualCue: { type: 'insert', seq: 3, extra: 1 } } };
  assert.deepEqual(state.normalizeCharacterPsychologyState(ok).profile.visualCue, { type: 'insert', seq: 3 });
});

const implantedFetus = { embryoId: 1, fusionCheckedWith: [], tags: [], fathers: 'M', race: '人类', fatherRace: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0 };

test('隐藏胎不发事件：异期受孕、孕中孕、孕期追加的代孕都不剧透', () => {
  const pregnant = { pregnantDays: 20, effectivePregnantDays: 20, fetusesCount: 1, fetuses: [{ ...implantedFetus }] };
  for (const [name, args] of [
    ['bsDebugInjectPregnancy', { mode: 'superfetation', father: 'M' }],
    ['bsDebugInjectPregnancy', { mode: 'nested', father: 'M', hostFetusIndex: 0 }],
    ['bsDebugInjectPregnancy', { mode: 'surrogacy', provider: '委托者', father: 'M,N', fetusCount: 2, forceChimera: true }],
    ['bsImplantEmbryo', { provider: '委托者', race: '人类', fathers: 'M', fatherRace: '人类', count: 1 }],
  ]) {
    const chatState = setup('孕早期', { pregnant: structuredClone(pregnant) });
    const result = call(chatState, name, args);
    assert.equal(result.applied, true, `${name} ${args.mode || ''}: ${result.message}`);
    assert.ok(P(chatState).pregnant.fetuses.length > 1, `${name} 应加入新胎`);
    assert.equal(cue(chatState) ?? null, null, `${name} ${args.mode || ''} 不应留下事件`);
  }
});

test('看得见的受孕照常发事件', () => {
  const normal = setup('卵泡期');
  assert.equal(call(normal, 'bsDebugInjectPregnancy', { mode: 'normal', father: 'M' }).applied, true);
  assert.equal(cue(normal)?.type, 'fertilization');

  const chimera = setup('卵泡期');
  assert.equal(call(chimera, 'bsDebugInjectPregnancy', { mode: 'normal', father: 'M,N', fetusCount: 2, forceChimera: true }).applied, true);
  assert.equal(cue(chimera)?.type, 'chimera');

  const surrogacy = setup('卵泡期');
  assert.equal(call(surrogacy, 'bsImplantEmbryo', { provider: '委托者', race: '人类', fathers: 'M', fatherRace: '人类', count: 1 }).applied, true);
  assert.equal(cue(surrogacy)?.type, 'surrogacy');
});

test('戴套插入、射在套里、破裂与撑爆各有自己的特写', () => {
  const held = setup('卵泡期');
  held.reproductiveSettings = { condomReliability: 1 };
  assert.equal(call(held, 'bsAddSperm', { male: 'M', race: '人类', action: 'insert', amount: 0, hasCondom: true }).applied, true);
  assert.equal(cue(held).type, 'insertCondom');
  assert.equal(call(held, 'bsAddSperm', { male: 'M', race: '人类', action: 'deposit', amount: 20 }).applied, true);
  assert.deepEqual([P(held).lastCondomResult.condomFailed, P(held).lastCondomResult.condomFailReason], [false, null]);
  assert.deepEqual(cue(held), { type: 'ejaculateCondom', seq: 2 });

  // 机率失效是破裂：没超过容量，特写是侧面裂开
  const torn = setup('卵泡期');
  torn.reproductiveSettings = { condomReliability: 0 };
  assert.equal(call(torn, 'bsAddSperm', { male: 'M', race: '人类', action: 'insert', amount: 0, hasCondom: true }).applied, true);
  assert.equal(call(torn, 'bsAddSperm', { male: 'M', race: '人类', action: 'deposit', amount: 20 }).applied, true);
  assert.deepEqual([P(torn).lastCondomResult.condomFailed, P(torn).lastCondomResult.condomFailReason], [true, 'tear']);
  assert.deepEqual(cue(torn), { type: 'condomBreak', seq: 2 });

  // 量超过容量必定撑爆，即使可靠度是 1
  const burst = setup('卵泡期');
  burst.reproductiveSettings = { condomReliability: 1 };
  assert.equal(call(burst, 'bsAddSperm', { male: 'M', race: '人类', action: 'insert', amount: 0, hasCondom: true }).applied, true);
  assert.equal(call(burst, 'bsAddSperm', { male: 'M', race: '人类', action: 'deposit', amount: 150 }).applied, true);
  assert.deepEqual([P(burst).lastCondomResult.condomFailed, P(burst).lastCondomResult.condomFailReason], [true, 'overflow']);
  assert.equal(P(burst).lastCondomResult.enteredAmount, 150);
  assert.deepEqual(cue(burst), { type: 'condomOverflow', seq: 2 });
});

test('同一轮里顺位低的画面事件不盖掉顺位高的；隔了一轮照样换新', async () => {
  const { setVisualCue, getVisualCuePriority, VISUAL_CUE_ROUND_MS } = await import('../scripts/state.js');
  const order = ['falseContraction', 'siblingKick', 'orgasm', 'ovulation', 'insert', 'ejaculate', 'condomBreak', 'rupture'];
  for (let k = 1; k < order.length; k += 1) assert.ok(getVisualCuePriority(order[k]) > getVisualCuePriority(order[k - 1]), `${order[k]} 应高于 ${order[k - 1]}`);
  const profile = {};
  setVisualCue(profile, 'ejaculate', { now: 1000 });
  setVisualCue(profile, 'orgasm', { now: 1200 });
  assert.equal(profile.visualCue.type, 'ejaculate', '同一轮：高潮不盖射精');
  assert.equal(profile.visualCue.seq, 1);
  setVisualCue(profile, 'rupture', { now: 1300 });
  // 两胎互动记下是哪两胎；不是两个不同的整数就不记
  const twins = {};
  assert.deepEqual(setVisualCue(twins, 'siblingKick', { now: 5, fetuses: [3, 2] }), { type: 'siblingKick', seq: 1, at: 5, fetuses: [3, 2] });
  assert.equal('fetuses' in setVisualCue({}, 'siblingKick', { now: 5, fetuses: [3, 3] }), false);
  assert.equal('fetuses' in setVisualCue({}, 'siblingKick', { now: 5, fetuses: [3, undefined] }), false);
  assert.equal(profile.visualCue.type, 'rupture', '同一轮：顺位高的照盖');
  assert.equal(profile.visualCue.seq, 2);
  setVisualCue(profile, 'insert', { now: 1400 });
  assert.equal(profile.visualCue.type, 'rupture');
  // 同顺位：后来的盖前面的
  setVisualCue(profile, 'ovulation', { now: 1300 + VISUAL_CUE_ROUND_MS });
  assert.equal(profile.visualCue.type, 'ovulation', '隔了一轮：照样换新');
  setVisualCue(profile, 'fertilization', { now: 1400 + VISUAL_CUE_ROUND_MS });
  assert.equal(profile.visualCue.type, 'fertilization');
  // 旧存档的事件没有时间：当成上一轮的
  const old = { visualCue: { type: 'rupture', seq: 7 } };
  setVisualCue(old, 'orgasm', { now: 5 });
  assert.deepEqual(old.visualCue, { type: 'orgasm', seq: 8, at: 5 });
});
