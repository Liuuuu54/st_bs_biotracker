// 每胎各自的羊膜：fetus.amnionDurability，同卵组共用一个胎囊。
// 孕期高宫压随机磨一个胎囊；第一产程每个胎囊都承受全部胎儿的总负担（按下降深度递减），
// 胎数越多破得越快；第二产程只磨先露胎囊。孕中孕内胎有自己的胎囊，破了就被宿主生出来。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, getFetusAmnionDurability } from '../scripts/tools.js';
import { buildTrackerPayload } from '../scripts/tracker.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, ...over,
});

function setup(stage, fetuses, { pressure = 10, pregnant = {} } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: pressure,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: 280, effectivePregnantDays: 280, fetusesCount: fetuses.length, fetuses,
        fetalEnergyDrain: 1, laborPhase: null, laborBirthNumber: 0, laborHours: 0, effectiveLaborHours: 0,
        presentingEmbryoId: null, ...pregnant,
      },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const amnion = (chatState) => P(chatState).pregnant.fetuses.map((f) => Math.round(f.amnionDurability * 100) / 100);
const rupture = (chatState, fetusIndex) => applyToolCall(chatState, {
  name: 'bsRuptureMembranes', arguments: { female: 'A', ...(fetusIndex === undefined ? {} : { fetusIndex }) },
});

test('指定 fetusIndex 只破那一胎；同卵组共用胎囊一起破', () => {
  const chatState = setup('第一产程', [fetus(1), fetus(2, { identicalGroup: 2 }), fetus(3, { identicalGroup: 2 })]);
  const result = rupture(chatState, 1);
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(amnion(chatState), [100, 0, 0]);
  assert.equal(rupture(chatState, 2).applied, false, '同一个胎囊已经破了');
});

test('省略 fetusIndex 时破先露胎的胎囊', () => {
  const chatState = setup('第二产程', [fetus(1), fetus(2)], { pregnant: { laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 2 } });
  assert.equal(rupture(chatState).applied, true);
  assert.deepEqual(amnion(chatState), [100, 0]);
});

test('待着床胚胎还没有胎囊', () => {
  const chatState = setup('第一产程', [fetus(1), fetus(2, { pendingImplantation: true })]);
  assert.equal(getFetusAmnionDurability(P(chatState).pregnant, P(chatState).pregnant.fetuses[1]), null);
});

test('孕中孕内胎破囊＝被宿主在宫内生出来：解绑但保留血缘，不算母亲破水、不发动产程', () => {
  const chatState = setup('产兆前驱', [fetus(1, { descentStage: -1 }), fetus(2, { nestedInEmbryoId: 1 })], { pressure: 1 });
  const result = rupture(chatState, 1);
  assert.equal(result.applied, true, result.message);
  const [host, inner] = P(chatState).pregnant.fetuses;
  assert.equal(host.amnionDurability, 100, '宿主的胎囊不受影响');
  assert.equal(inner.amnionDurability, 0);
  assert.equal(inner.nestedReleased, true);
  assert.equal(inner.nestedInEmbryoId, 1, '血缘保留给族谱');
  assert.equal(inner.descentStage, -1, '保留解绑当下与宿主相同的位置');
  assert.equal(P(chatState).base.stage, '产兆前驱', '内胎破囊不会发动产程');
});

test('内胎胎囊没破：宿主出生时一起娩出，族谱记为宿主的孩子', () => {
  Math.random = () => 0.99;
  const chatState = setup('第二产程', [fetus(1), fetus(2, { nestedInEmbryoId: 1, fathers: '乙' }), fetus(3)], {
    pressure: 120, pregnant: { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1 },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } }); // 走完这一胎的娩出，停在间歇期
  const children = P(chatState).children;
  assert.deepEqual(children.map((child) => child.fathers).sort(), ['乙', '父1']);
  const host = children.find((child) => child.fathers === '父1');
  const inner = children.find((child) => child.fathers === '乙');
  assert.equal(inner.nestedInChildId, host.id);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [3]);
  assert.match(P(chatState).notify.secondly, /一并娩出/);
});

test('内胎已被生出（胎囊破）：宿主出生时不会被带走，之后自己竞争先露', () => {
  Math.random = () => 0.99;
  const chatState = setup('第二产程', [fetus(1), fetus(2, { nestedInEmbryoId: 1, amnionDurability: 0 })], {
    pressure: 120, pregnant: { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1 },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } }); // 走完这一胎的娩出，停在间歇期
  assert.deepEqual(P(chatState).children.map((child) => child.fathers), ['父1']);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [2]);
});

test('孕期高宫压只随机磨一个胎囊，按该胎自己的负担扣且不会磨穿', () => {
  Math.random = () => 0.99; // 抽到最后一个胎囊
  const chatState = setup('孕中期', [fetus(1), fetus(2)], { pregnant: { pregnantDays: 140, effectivePregnantDays: 140 } });
  applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { uterinePressure: 100 } } });
  const [first, second] = amnion(chatState);
  assert.equal(first, 100, '没被抽到的胎囊不受影响');
  assert.ok(second < 100 && second >= 1);
  // 孕 140 天、胎重 1、承载 1 的单胎负担 = 140/7/40 = 0.5，低于 1 时按 1 扣
  assert.equal(second, 99);
});

test('第一产程每个胎囊都承受全部胎儿的总负担；同卵组只算一个胎囊', () => {
  Math.random = () => 0.99; // 避开宫缩微弱的停滞
  const chatState = setup('第一产程', [fetus(1), fetus(2, { identicalGroup: 2 }), fetus(3, { identicalGroup: 2 })], {
    pressure: 120, pregnant: { laborPhase: '潜伏期' },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 2 } });
  const [single, twinA, twinB] = amnion(chatState);
  assert.equal(twinA, twinB, '同卵组同步');
  // 第一产程一定有一胎入盆（这里是编号最小的 1）：入盆的胎囊吃满总扣量，还在 -2 的减半
  const drain = P(chatState).pregnant.fetalEnergyDrain;
  assert.ok(Math.abs((100 - single) - Math.max(1, drain) * 2 * 0.35) < 1e-6, `入盆胎囊吃满总扣量：${100 - single}`);
  assert.ok(Math.abs((100 - twinA) * 2 - (100 - single)) < 1e-6, '高位胎囊按深度减半');
});

test('多胎挤在同一子宫：三胎的每个胎囊比单胎磨得快', () => {
  Math.random = () => 0.99;
  const wearOf = (count) => {
    const chatState = setup('第一产程', Array.from({ length: count }, (_, i) => fetus(i + 1)), { pressure: 120, pregnant: { laborPhase: '潜伏期' } });
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 2 } });
    return 100 - amnion(chatState)[0];
  };
  assert.ok(wearOf(3) > wearOf(1) * 2.5, `单胎 ${wearOf(1)}，三胎 ${wearOf(3)}`);
});

test('第二产程只磨先露胎的胎囊', () => {
  Math.random = () => 0.99;
  const chatState = setup('第二产程', [fetus(1), fetus(2)], {
    pressure: 120, pregnant: { laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 1 },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  const [presenting, waiting] = amnion(chatState);
  assert.ok(presenting < 100);
  assert.equal(waiting, 100);
});

test('第一产程宫压达上限快速进入第二产程：只破先露胎囊，不再全体破膜', () => {
  Math.random = () => 0.99;
  const chatState = setup('第一产程', [fetus(1), fetus(2)], { pressure: 9999, pregnant: { laborPhase: '潜伏期' } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.equal(P(chatState).base.stage, '第二产程');
  assert.deepEqual(amnion(chatState), [0, 100]);
});

test('母体层的 amnionDurability 已移除；缺值的胎儿补成完整胎囊', () => {
  const chatState = setup('孕中期', [fetus(1, { amnionDurability: undefined })], { pregnant: { amnionDurability: 40 } });
  const normalized = state.normalizeCharacterPsychologyState(chatState.characters.A);
  assert.equal('amnionDurability' in normalized.profile.pregnant, false);
  applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
  assert.equal(P(chatState).pregnant.fetuses[0].amnionDurability, 100);
});

function promptPregnantOf(chatState) {
  const ctx = {
    chatId: 'amnion-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'amnion-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state.A.profile.pregnant;
}

test('prompt：胎囊一致时只送一个 amnionDurability；不一致时改标在胎儿上，不送精确数值', () => {
  const same = promptPregnantOf(setup('第一产程', [fetus(1), fetus(2)], { pregnant: { laborPhase: '潜伏期' } }));
  assert.equal(same.amnionDurability, 100);
  assert.ok(same.fetuses.every((f) => !('amnion' in f) && !('amnionDurability' in f)));

  const mixed = promptPregnantOf(setup('第一产程', [fetus(1), fetus(2, { amnionDurability: 20 }), fetus(3, { amnionDurability: 0 })], { pregnant: { laborPhase: '潜伏期' } }));
  assert.equal('amnionDurability' in mixed, false);
  assert.deepEqual(mixed.fetuses.map((f) => f.amnion ?? null), [null, '膜危', '已破']);
  assert.ok(mixed.fetuses.every((f) => !('amnionDurability' in f)));
});
