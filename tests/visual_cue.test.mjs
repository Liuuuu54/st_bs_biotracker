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
const cue = (chatState) => P(chatState).visualCue;
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
