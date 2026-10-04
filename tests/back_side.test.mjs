// 胎背方位：左前／右前／左后／右后，与胎位角度互相独立。
// 受孕时随机、同卵分裂互为镜像、缺值自动补，prompt 只送描写文字。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyRegistryResult } from '../scripts/registry.js';
import { applyToolCall, BACK_SIDES, describeBackSide } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, descentStage: -2, ...over,
});

function setup(stage, fetuses = [], pregnant = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 150, libido: 0, uterinePressure: 10,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: { pregnantDays: 140, effectivePregnantDays: 140, fetusesCount: fetuses.length, fetuses, ...pregnant },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });

test('新受孕的胎儿带一个合法的胎背方位', () => {
  const chatState = setup('卵泡期');
  assert.equal(applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M', fetusCount: 3 } }).applied, true);
  for (const item of P(chatState).pregnant.fetuses) assert.ok(BACK_SIDES.includes(item.backSide), item.backSide);
});

test('缺值或乱写的胎背方位在任何工具呼叫后补成合法值；合法值原样保留', () => {
  const chatState = setup('孕中期', [fetus(1), fetus(2, { backSide: '上面' }), fetus(3, { backSide: '右后' })]);
  touch(chatState);
  const sides = P(chatState).pregnant.fetuses.map((item) => item.backSide);
  for (const side of sides) assert.ok(BACK_SIDES.includes(side));
  assert.equal(sides[2], '右后');
});

test('同卵分裂出的那一胎是镜像：左右相反、前后相同', () => {
  for (let seed = 0; seed < 8; seed += 1) {
    const chatState = setup('卵泡期');
    applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M', forceIdentical: true } });
    const [a, b] = P(chatState).pregnant.fetuses;
    assert.equal(a.identicalGroup, b.identicalGroup);
    assert.notEqual(a.backSide[0], b.backSide[0], `${a.backSide} / ${b.backSide}`);
    assert.equal(a.backSide[1], b.backSide[1]);
  }
});

test('嵌合后的胎儿承接一个合法的胎背方位', () => {
  const chatState = setup('卵泡期');
  applyToolCall(chatState, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', mode: 'normal', father: 'M,N', fetusCount: 2, forceChimera: true } });
  const [fused] = P(chatState).pregnant.fetuses;
  assert.ok(BACK_SIDES.includes(fused.backSide));
});

test('描写：纵产式直接说方位，横位改成朝上或朝下', () => {
  assert.equal(describeBackSide({ backSide: '左前', tendencyAngle: 0 }), '胎背朝左前');
  assert.equal(describeBackSide({ backSide: '右后', tendencyAngle: 180 }), '胎背朝右后');
  assert.equal(describeBackSide({ backSide: '左后', tendencyAngle: 90 }), '胎背朝上、偏后');
  assert.equal(describeBackSide({ backSide: '右前', tendencyAngle: 270 }), '胎背朝下、偏前');
  assert.equal(describeBackSide({ tendencyAngle: 0 }), '');
});

test('prompt 只送 backSideText，不送原始栏位', () => {
  const chatState = setup('孕中期', [fetus(1, { backSide: '左后' })]);
  const ctx = {
    chatId: 'back-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'back-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const [sent] = buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state.A.profile.pregnant.fetuses;
  assert.equal(sent.backSideText, '胎背朝左后');
  assert.equal('backSide' in sent, false);
});

test('注册：给了合法方位就沿用，没给或乱写就随机补', () => {
  const chatState = state.createEmptyChatState();
  const F = (over = {}) => ({ fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', ...over });
  applyRegistryResult(chatState, {
    name: 'A',
    profile: {
      base: { race: '人类', age: 24 },
      pregnant: { pregnantDays: 150, fetusesCount: 3, fetuses: [F({ backSide: '右后' }), F(), F({ backSide: '正中' })] },
    },
  });
  const sides = chatState.characters.A.profile.pregnant.fetuses.map((item) => item.backSide);
  assert.equal(sides[0], '右后');
  for (const side of sides) assert.ok(BACK_SIDES.includes(side));
});

// ── 胎背会动，也会影响产程 ─────────────────────────────
const assist = (chatState, args) => applyToolCall(chatState, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'rotate', ...args } });

test('助产 rotate 可以单独转胎背；乱写或什么都没给会被拒绝', () => {
  const chatState = setup('孕晚期', [fetus(1, { backSide: '左后' })], { pregnantDays: 240, effectivePregnantDays: 240 });
  assert.equal(assist(chatState, { fetusIndex: 0, backSide: '右前' }).applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '右前');
  assert.equal(assist(chatState, { fetusIndex: 0, backSide: '正中' }).applied, false);
  assert.equal(assist(chatState, { fetusIndex: 0 }).applied, false);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '右前');
});

test('已入盆的胎儿胎背只能前后对调，不能换左右', () => {
  const chatState = setup('第一产程', [fetus(1, { backSide: '右后', descentStage: 0 })], {
    pregnantDays: 280, effectivePregnantDays: 280, laborPhase: '潜伏期', presentingEmbryoId: 1,
  });
  assert.equal(assist(chatState, { backSide: '左前' }).applied, false);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '右后');
  assert.equal(assist(chatState, { backSide: '右前' }).applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '右前');
});

test('孕期没有位移的日子偶尔会翻身，结果永远是合法值', () => {
  let seed = 7;
  Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const chatState = setup('孕早期', [fetus(1, { backSide: '左前' })], { pregnantDays: 20, effectivePregnantDays: 20 });
  const seen = new Set();
  for (let day = 0; day < 40; day += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
    const side = P(chatState).pregnant.fetuses[0].backSide;
    assert.ok(BACK_SIDES.includes(side));
    seen.add(side);
  }
  assert.ok(seen.size > 1, '孕早期四十天里应该至少翻过一次身');
});

function labor({ backSide, realistic = true }) {
  const chatState = setup('第一产程', [fetus(1, { backSide, descentStage: 0 })], {
    pregnantDays: 280, effectivePregnantDays: 280, laborPhase: '活跃期', presentingEmbryoId: 1, effectiveLaborHours: 0, laborHours: 0,
  });
  P(chatState).immune = { realisticLabor: realistic };
  P(chatState).base.uterinePressure = 60;
  return chatState;
}

test('已入盆的枕后位会在产程中自己转成枕前位，左右不变', () => {
  Math.random = () => 0;
  const chatState = labor({ backSide: '左后' });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '左前');
});

test('真实分娩模式下枕后位产程较慢、较痛；非真实模式没有差别', () => {
  Math.random = () => 0.99;
  const run = (backSide, realistic) => {
    const chatState = labor({ backSide, realistic });
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 30 } });
    return P(chatState).pregnant;
  };
  const anterior = run('右前', true);
  const posterior = run('右后', true);
  assert.ok(Math.abs(posterior.effectiveLaborHours / anterior.effectiveLaborHours - 0.8) < 0.01,
    `${posterior.effectiveLaborHours} / ${anterior.effectiveLaborHours}`);
  assert.ok(posterior.laborPain > anterior.laborPain);
  const casual = run('右后', false);
  const casualAnterior = run('右前', false);
  assert.equal(casual.effectiveLaborHours, casualAnterior.effectiveLaborHours);
});

test('调试工具可以直接设定胎背方位（不受入盆限制），乱写会被拒绝', () => {
  const chatState = setup('第一产程', [fetus(1, { backSide: '右后', descentStage: 0 })], {
    pregnantDays: 280, effectivePregnantDays: 280, laborPhase: '潜伏期', presentingEmbryoId: 1,
  });
  const debug = (backSide) => applyToolCall(chatState, { name: 'bsDebugSetFetalPosition', arguments: { female: 'A', fetusIndex: 0, backSide } });
  assert.equal(debug('左前').applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '左前');
  assert.equal(debug('斜上').applied, false);
  assert.equal(debug('').applied, true, '留空表示不变');
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '左前');
});

test('卵生、胎转卵生出生时是蛋：没有胎背描写、不受枕后位拖慢、不能指定胎背', () => {
  Math.random = () => 0.99;
  for (const embryoType of ['卵生', '胎转卵生']) {
    assert.equal(describeBackSide({ backSide: '右后', tendencyAngle: 0, embryoType }), '', embryoType);
    const run = (backSide) => {
      const chatState = labor({ backSide });
      P(chatState).pregnant.fetuses[0].embryoType = embryoType;
      applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 30 } });
      return P(chatState).pregnant;
    };
    assert.equal(run('右后').effectiveLaborHours, run('右前').effectiveLaborHours, embryoType);
    const chatState = labor({ backSide: '右后' });
    P(chatState).pregnant.fetuses[0].embryoType = embryoType;
    const result = assist(chatState, { backSide: '右前' });
    assert.equal(result.applied, false, embryoType);
    assert.match(result.message, /egg/);
  }
  assert.equal(describeBackSide({ backSide: '右后', tendencyAngle: 0, embryoType: '卵胎生' }), '胎背朝右后', '卵胎生照常有胎背');
});
