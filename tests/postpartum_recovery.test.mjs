// 产后恢复天数与承载耐受解绑（v1.0.6）。
//
// 旧公式是「胚型系数 × (280/妊娠速度) × (分娩难度/承载耐受)」，胎转卵生只能靠灌高耐受压短恢复期。
// 新公式只看母体物种的恢复系数、活力等级、之前的分娩次数与这次的胎数，在分娩／流产当下定下。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import {
  computePostpartumRecoveryDays,
  getEmbryoTypeByRace,
  getRaceGroupsByEmbryoType,
  getRacePhysiologyProfile,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { applyToolCall } from '../scripts/tools.js';

const fetus = (over = {}) => ({
  embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});

function mother({ race = '人类', stage = '孕中期', days = 100, fetusCount = 1, vitalityLevel = 4, experience = {}, bio = {} } = {}) {
  const fetuses = Array.from({ length: fetusCount }, (_, i) => fetus({ embryoId: i + 1, fathers: `父${i}` }));
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race,
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, identicalProbability: 0, recoveryDays: 999, ...bio },
      pregnant: {
        pregnantDays: days, effectivePregnantDays: days, fetusesCount: fetusCount,
        fetalEnergyDrain: 0.3, fetuses,
      },
      experience: { ...experience }, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}

const P = (chatState) => chatState.characters.A.profile;

function passUntilPostpartum(chatState) {
  for (let i = 0; i < 500 && P(chatState).base.stage !== '产后恢复'; i += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  }
}

test('恢复天数 = 56 × 恢复系数 × 活力 × 经产 × 胎数（× 流产孕程）', () => {
  assert.equal(computePostpartumRecoveryDays({}), 56);
  assert.equal(computePostpartumRecoveryDays({ recoveryCoefficient: 2 }), 112);
  // 活力 1～7
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7].map((vitalityLevel) => computePostpartumRecoveryDays({ vitalityLevel })),
    [84, 73, 64, 56, 50, 48, 42],
  );
  // 经产：初产 1、之前 1～3 胎 0.9、4 胎以上 1.1
  assert.deepEqual(
    [0, 1, 3, 4, 9].map((priorBirths) => computePostpartumRecoveryDays({ priorBirths })),
    [56, 50, 50, 62, 62],
  );
  // 胎数：每多一胎 +0.15，封顶 2 倍
  assert.deepEqual(
    [1, 2, 3, 7, 12].map((fetusCount) => computePostpartumRecoveryDays({ fetusCount })),
    [56, 64, 73, 106, 112],
  );
  // 流产按孕程缩短，最少 1/4
  assert.equal(computePostpartumRecoveryDays({ progressRatio: 0.5 }), 28);
  assert.equal(computePostpartumRecoveryDays({ progressRatio: 0.05 }), 14);
});

test('恢复天数不看妊娠速度、分娩难度、承载耐受与胚型', () => {
  const dragon = getRacePhysiologyProfile('西方龙');
  const days = computePostpartumRecoveryDays({ recoveryCoefficient: dragon.recoveryCoefficient });
  setRacePhysiologyOverrides({ 西方龙: { breedTolerance: 0.1, birthDifficulty: 50, gestationSpeciesSpeed: 0.1, embryoType: '胎生' } });
  const tweaked = getRacePhysiologyProfile('西方龙');
  setRacePhysiologyOverrides({});
  assert.equal(computePostpartumRecoveryDays({ recoveryCoefficient: tweaked.recoveryCoefficient }), days);
});

test('足月三胎：孕期不改恢复天数，分娩当下按三胎定下', () => {
  const chatState = mother({ fetusCount: 3 });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.equal(P(chatState).bio.recoveryDays, 999, '孕期推进不该再改写恢复天数');
  passUntilPostpartum(chatState);
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).children.length, 3);
  // 人类 × 活力 4 × 初产 × 三胎 1.3
  assert.equal(P(chatState).bio.recoveryDays, 73);
  assert.equal(P(chatState).pregnant.deliveredCount, 0, '清空妊娠时要把已娩出计数归零');
});

test('流产按母体恢复系数、活力、经产与孕程计算', () => {
  const chatState = mother({ race: '西方龙', days: 70, vitalityLevel: 1, experience: { naturalBirthExperience: 2 } });
  const result = applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A' } });
  assert.equal(result.applied, true);
  assert.equal(P(chatState).base.stage, '产后恢复');
  const coefficient = getRacePhysiologyProfile('西方龙').recoveryCoefficient;
  // 70/280 = 0.25
  assert.equal(P(chatState).bio.recoveryDays, computePostpartumRecoveryDays({
    recoveryCoefficient: coefficient, vitalityLevel: 1, priorBirths: 2, progressRatio: 0.25,
  }));
});

test('百科覆写的恢复系数在分娩当下生效', () => {
  setRacePhysiologyOverrides({ 人类: { recoveryCoefficient: 2 } });
  try {
    const chatState = mother({ days: 200 });
    passUntilPostpartum(chatState);
    assert.equal(P(chatState).bio.recoveryDays, 112);
  } finally {
    setRacePhysiologyOverrides({});
  }
});

test('百科可以改胚型：影响胚型判定与分组', () => {
  assert.equal(getEmbryoTypeByRace('西方龙'), '胎转卵生');
  setRacePhysiologyOverrides({ 西方龙: { embryoType: '胎生' } });
  try {
    assert.equal(getEmbryoTypeByRace('西方龙'), '胎生');
    assert.equal(getEmbryoTypeByRace('西方龙x人类'), '胎生', '混血由孕期最长的成分决定胚型');
    const groups = Object.fromEntries(getRaceGroupsByEmbryoType().map((group) => [group.label, group.races]));
    assert.ok(groups['胎生'].includes('西方龙'));
    assert.ok(!groups['胎转卵生'].includes('西方龙'));
  } finally {
    setRacePhysiologyOverrides({});
  }
  // 覆写的胚型不合法就忽略
  setRacePhysiologyOverrides({ 西方龙: { embryoType: '胎盘生' } });
  assert.equal(getEmbryoTypeByRace('西方龙'), '胎转卵生');
  setRacePhysiologyOverrides({});
});

function legacyChatState() {
  const chatState = state.createEmptyChatState();
  const make = (name, race, stage, bio, extra = {}) => {
    const character = state.createDefaultFemaleState(name);
    character.initialized = true;
    character.profile.base.race = race;
    character.profile.base.stage = stage;
    character.profile.bio = { ...character.profile.bio, ...bio };
    Object.assign(character, extra);
    chatState.characters[name] = character;
    return character;
  };
  make('旧龙', '西方龙', '卵泡期', { breedTolerance: 10, recoveryDays: 448 });
  make('自订龙', '西方龙', '卵泡期', { breedTolerance: 5, recoveryDays: 448 });
  const pregnant = make('孕龙', '西方龙', '孕中期', { breedTolerance: 9.6, recoveryDays: 500 }, {
    runtime: { originalPregnancyBio: { gestationSpeciesSpeed: 0.25, birthDifficulty: 4, breedTolerance: 10, recoveryDays: 448 } },
  });
  pregnant.profile.pregnant.fetuses = [fetus({ embryoId: 1 }), fetus({ embryoId: 2 })];
  make('恢复中', '人类', '产后恢复', { breedTolerance: 1, recoveryDays: 77 });
  make('混血', '人类x西方龙', '卵泡期', { breedTolerance: 5.5 });
  delete chatState.schemaVersion;
  return chatState;
}

test('v1 存档迁移：只换掉没自订过的旧内置耐受，并保留进行中的产后恢复', () => {
  const ctx = { chatId: 'migration-v2', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = legacyChatState();
  state.recordChatStateSnapshot(ctx, chatState, { reason: 'legacy' });
  settings.chatStates['migration-v2'] = chatState;

  const migrated = state.getChatState(ctx, settings);
  const bio = (name) => migrated.characters[name].profile.bio;
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(bio('旧龙').breedTolerance, 2, '旧内置值 10 → 新内置值 2');
  assert.equal(bio('旧龙').recoveryDays, computePostpartumRecoveryDays({ recoveryCoefficient: getRacePhysiologyProfile('西方龙').recoveryCoefficient }));
  assert.equal(bio('自订龙').breedTolerance, 5, '自订过的耐受不动');
  assert.equal(migrated.characters['孕龙'].runtime.originalPregnancyBio.breedTolerance, 2);
  assert.ok(Math.abs(bio('孕龙').breedTolerance - 2 * 0.96) < 1e-9, '孕中的耐受连胎数修正一起重算');
  assert.equal('recoveryDays' in migrated.characters['孕龙'].runtime.originalPregnancyBio, false);
  assert.equal(bio('恢复中').recoveryDays, 77, '正在产后恢复的天数不打断');
  assert.equal(bio('混血').breedTolerance, 1.5, '混血按各成分平均换算：(1 + 2) / 2');

  // 楼层快照也要迁移，回溯时才不会把旧耐受带回来
  const restored = state.createEmptyChatState();
  restored.snapshots = migrated.snapshots;
  state.restoreChatStateFromSnapshot(restored, migrated.snapshots.at(-1));
  assert.equal(restored.characters['旧龙'].profile.bio.breedTolerance, 2);
  assert.equal(restored.characters['自订龙'].profile.bio.breedTolerance, 5);
  assert.equal(restored.characters['孕龙'].runtime.originalPregnancyBio.breedTolerance, 2, '快照里的孕前原值也要迁移');

  // 迁移只做一次
  migrated.characters['旧龙'].profile.bio.breedTolerance = 10;
  state.getChatState(ctx, settings);
  assert.equal(migrated.characters['旧龙'].profile.bio.breedTolerance, 10);
});

test('新聊天直接是最新存档版本', () => {
  assert.equal(state.createEmptyChatState().schemaVersion, 3);
});

test('孕期回溯楼层后，分娩还原的承载耐受仍是孕前原值', () => {
  const ctx = { chatId: 'snapshot-original-bio', chat: [] };
  const chatState = mother({ fetusCount: 3, bio: { breedTolerance: 2 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.ok(chatState.characters.A.runtime?.originalPregnancyBio, '孕期应已保存孕前原值');
  assert.ok(Math.abs(P(chatState).bio.breedTolerance - 2 * 0.92) < 1e-9, '三胎的孕期耐受 = 原值 × 0.92');

  // 回溯楼层：状态整个换成快照里的内容
  state.recordChatStateSnapshot(ctx, chatState, { reason: 'rollback' });
  state.restoreChatStateFromSnapshot(chatState, chatState.snapshots.at(-1));
  assert.equal(chatState.characters.A.runtime?.originalPregnancyBio?.breedTolerance, 2, '快照要带着孕前原值');

  passUntilPostpartum(chatState);
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).bio.breedTolerance, 2, '生完应还原成孕前原值，不能停在孕期值');
});
