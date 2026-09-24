// 产兆前驱的真实产程约束（托高 lift 延后分娩的上限），以及唯一受控的破水入口。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

function makeChatState(overrides = {}) {
  const chatState = state.createEmptyChatState();
  const base = {
    stage: '产兆前驱',
    days: 0,
    vitality: 100,
    uterinePressure: 100,
    age: 24,
    race: '人类',
    ...overrides.base,
  };
  const pregnant = {
    pregnantDays: 266,
    effectivePregnantDays: 266,
    fetusesCount: 1,
    fetuses: [{ embryoId: 1, fathers: '莱昂', gender: '女', embryoType: '胎生', tendencyAngle: 0, affinity: 0, amnionDurability: 100 }],
    fetalEnergyDrain: 1,
    prodromalRemainingHours: 48,
    prodromalDelayProgressHours: 0,
    ...overrides.pregnant,
  };
  chatState.characters['艾拉'] = {
    name: '艾拉',
    initialized: true,
    profile: {
      base,
      pregnant,
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      immune: { realisticLabor: Boolean(overrides.realisticLabor) },
      metabolism: {},
      notify: {},
    },
  };
  return chatState;
}

const character = (chatState) => chatState.characters['艾拉'];
const pregnantOf = (chatState) => character(chatState).profile.pregnant;
const baseOf = (chatState) => character(chatState).profile.base;
// 羊膜是每胎各一个；这里只有一胎
const amnionOf = (chatState) => pregnantOf(chatState).fetuses[0].amnionDurability;

test('realistic labor clamps a delay that would exceed the cumulative cap', () => {
  // 上限＝初始时长（48h）。已累计 46h，这次托高本来 +24h（T/2），只能再吃到 2h。
  const chatState = makeChatState({
    realisticLabor: true,
    pregnant: { prodromalDelayProgressHours: 46, prodromalRemainingHours: 48 },
    base: { vitality: 9999, uterinePressure: 1 }, // 活力充足，托高必定撑得住
  });

  const result = applyToolCall(chatState, {
    name: 'bsAssistFetalPosition',
    arguments: { female: '艾拉', action: 'lift' },
  });

  assert.equal(result.applied, true);
  const after = pregnantOf(chatState);
  assert.equal(after.prodromalDelayProgressHours, 48, '累计延后正好卡在上限');
  assert.equal(after.prodromalRemainingHours, 50, '只吃到上限剩余的 2 小时，而不是完整的 24 小时');
  assert.equal(baseOf(chatState).stage, '产兆前驱');
});

test('realistic labor refuses any further delay once the cap is reached', () => {
  const chatState = makeChatState({
    realisticLabor: true,
    pregnant: { prodromalDelayProgressHours: 48, prodromalRemainingHours: 60 },
    base: { vitality: 9999, uterinePressure: 1 },
  });
  const before = pregnantOf(chatState).prodromalRemainingHours;

  const result = applyToolCall(chatState, {
    name: 'bsAssistFetalPosition',
    arguments: { female: '艾拉', action: 'lift' },
  });

  assert.equal(result.applied, false, '到顶后托高被拒绝');
  assert.match(result.message, /can no longer be postponed/);
  assert.equal(pregnantOf(chatState).prodromalRemainingHours, before, '被拒绝时不得改动剩余时间');
  assert.equal(baseOf(chatState).vitality, 9999, '被拒绝时不扣活力');
  assert.equal(pregnantOf(chatState).prodromalDelayProgressHours, 48);
});

test('realistic labor never regresses out of labor even when fully resisted', () => {
  const chatState = makeChatState({
    realisticLabor: true,
    // 累计延后已满初始时长：非真实产程时这会触发退回
    pregnant: { prodromalDelayProgressHours: 48, prodromalRemainingHours: 48 },
    base: { vitality: 9999, uterinePressure: 1 },
  });

  applyToolCall(chatState, {
    name: 'bsAssistFetalPosition',
    arguments: { female: '艾拉', action: 'lift' },
  });

  assert.equal(baseOf(chatState).stage, '产兆前驱', '分娩只能延后，不能取消');
});

test('without realistic labor a fully resisted prodromal still regresses by pregnancy days', () => {
  const chatState = makeChatState({
    realisticLabor: false,
    pregnant: { prodromalDelayProgressHours: 48, prodromalRemainingHours: 48 },
    base: { vitality: 9999, uterinePressure: 1 },
  });

  applyToolCall(chatState, {
    name: 'bsAssistFetalPosition',
    arguments: { female: '艾拉', action: 'lift' },
  });

  // 依妊娠天数退回对应阶段，而不是停在产兆前驱
  assert.notEqual(baseOf(chatState).stage, '产兆前驱');
  assert.equal(['孕晚期', '临产期', '逾期'].includes(baseOf(chatState).stage), true);
});

test('rupture in the prodromal stage is refused when uterine pressure is too low', () => {
  const chatState = makeChatState({ base: { stage: '产兆前驱', uterinePressure: 1 } });

  const result = applyToolCall(chatState, {
    name: 'bsRuptureMembranes',
    arguments: { female: '艾拉' },
  });

  assert.equal(result.applied, false);
  assert.match(result.message, /pressure too low/);
  assert.equal(amnionOf(chatState), 100, '被拒绝时不得改动羊膜');
  assert.equal(baseOf(chatState).stage, '产兆前驱');
});

test('only the prodromal stage may rupture before labor', () => {
  // 临产期／逾期宫压再高也不能破水：产程前的破水入口只开在产兆前驱
  for (const stage of ['孕中期', '孕晚期', '临产期', '逾期']) {
    const chatState = makeChatState({ base: { stage, uterinePressure: 9999 } });

    const result = applyToolCall(chatState, {
      name: 'bsRuptureMembranes',
      arguments: { female: '艾拉' },
    });

    assert.equal(result.applied, false, `${stage} 不该允许破水`);
    assert.match(result.message, /cannot rupture/);
    assert.equal(amnionOf(chatState), 100);
    assert.equal(baseOf(chatState).stage, stage, '被拒绝时不得改动阶段');
  }
});

test('a sanctioned rupture breaks the membranes and starts the first labor stage', () => {
  const chatState = makeChatState({ base: { stage: '产兆前驱', uterinePressure: 9999 } });

  const result = applyToolCall(chatState, {
    name: 'bsRuptureMembranes',
    arguments: { female: '艾拉' },
  });

  assert.equal(result.applied, true);
  assert.equal(amnionOf(chatState), 0);
  assert.equal(baseOf(chatState).stage, '第一产程', '破水后不该还停在产兆前驱');
  assert.equal(pregnantOf(chatState).prodromalRemainingHours, 0, '前驱状态要清干净');
});

test('rupturing during labor does not restart the stage', () => {
  const chatState = makeChatState({ base: { stage: '第二产程', uterinePressure: 1 } });

  const result = applyToolCall(chatState, {
    name: 'bsRuptureMembranes',
    arguments: { female: '艾拉' },
  });

  // 已在产程内：不需要宫压门槛，也不该把阶段拉回第一产程
  assert.equal(result.applied, true);
  assert.equal(amnionOf(chatState), 0);
  assert.equal(baseOf(chatState).stage, '第二产程');
});

test('a second rupture call is rejected instead of silently reapplying', () => {
  const chatState = makeChatState({ base: { stage: '第一产程' } });
  pregnantOf(chatState).fetuses[0].amnionDurability = 0;

  const result = applyToolCall(chatState, {
    name: 'bsRuptureMembranes',
    arguments: { female: '艾拉' },
  });

  assert.equal(result.applied, false);
  assert.match(result.message, /already ruptured/);
});

test('the rupture reminder only points at the tool in stages that can actually rupture', () => {
  const reminderFor = (stage) => {
    const chatState = makeChatState({ base: { stage } });
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 1 } });
    return JSON.stringify(character(chatState).profile.notify || {});
  };

  // 临产期／逾期调用必被拒，提示它去调等于教它做一件必定失败的事
  for (const stage of ['临产期', '逾期']) {
    const text = reminderFor(stage);
    assert.doesNotMatch(text, /bsRuptureMembranes/, `${stage} 不该提示调用破水工具`);
    assert.match(text, /必须先进入产兆前驱/);
  }
  // 真的能破水的阶段才指向工具
  for (const stage of ['产兆前驱', '第一产程']) {
    assert.match(reminderFor(stage), /bsRuptureMembranes/, `${stage} 应指向破水工具`);
  }
});
