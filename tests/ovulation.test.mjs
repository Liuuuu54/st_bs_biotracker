// 自然排卵回归：每个排卵期的总卵数由额外排卵倾向决定，与经期长度无关。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall } from '../scripts/tools.js';

function makeChatState({ menstrualLengthRatio = 1, orgasmOvulationAmount = 1 } = {}) {
  return {
    characters: {
      F: {
        name: 'F',
        initialized: true,
        profile: {
          base: {
            stage: '排卵期', days: 0, race: '人类', vitality: 100,
            vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0, eggs: 0,
          },
          bio: {
            menstrualLengthRatio,
            orgasmOvulationAmount,
            impregnationDifficulty: 1,
            gestationSpeciesSpeed: 1,
            birthDifficulty: 1,
            breedTolerance: 1,
          },
          pregnant: { fetuses: [], fetusesCount: 0 },
          immune: {}, experience: {}, metabolism: {}, cooldown: {},
        },
      },
    },
  };
}

function eggsAfterOneDay(options) {
  const chatState = makeChatState(options);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  return chatState.characters.F.profile.base.eggs;
}

test('自然排卵每周期只排 1 颗，不随额外排卵倾向与经期倍率变动', () => {
  // 人类、精灵、西方龙、社会虫族：额外排卵倾向只在高潮时作用
  for (const options of [
    { menstrualLengthRatio: 1, orgasmOvulationAmount: 1 },
    { menstrualLengthRatio: 3, orgasmOvulationAmount: 0 },
    { menstrualLengthRatio: 4, orgasmOvulationAmount: 1 },
    { menstrualLengthRatio: 0.75, orgasmOvulationAmount: 8 },
  ]) {
    assert.equal(eggsAfterOneDay(options), 1, JSON.stringify(options));
  }
});

test('超长周期在整个排卵窗口内只排一次', () => {
  // 经期倍率 13（约一年）→ 排卵期 26 天；旧算法会逐日累加到 26 颗
  const chatState = makeChatState({ menstrualLengthRatio: 13, orgasmOvulationAmount: 1 });
  for (let i = 0; i < 10; i += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  }
  const profile = chatState.characters.F.profile;
  assert.equal(profile.base.stage, '排卵期', '推进 20 天后仍应在排卵期内');
  assert.equal(profile.base.eggs, 1, '整个窗口内只排一次');
  assert.equal(profile.cooldown.naturalOvulationUsed, true, '本周期已排卵的旗标应保留');
});

test('高潮诱发排卵排出的卵不会被自然排卵覆盖', () => {
  const chatState = makeChatState({ menstrualLengthRatio: 1, orgasmOvulationAmount: 8 });
  chatState.characters.F.profile.base.eggs = 8;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  // applyToolCall 内部会 clone 后写回，必须重新取引用
  assert.equal(chatState.characters.F.profile.base.eggs, 9, '自然排卵应叠加而不是封顶覆盖');
});

const orgasm = (chatState) => applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: 'F', options: { libido: 9999 } } });
const setStage = (chatState, stage) => applyToolCall(chatState, { name: 'bsSetMenstrualPhases', arguments: { female: 'F', stage } });
const F = (chatState) => chatState.characters.F.profile;

test('高潮排卵按当前活力占比排出：满活力全排，活力 0 一颗不排但仍用掉这次机会', () => {
  const full = makeChatState({ orgasmOvulationAmount: 3 });
  F(full).base.vitality = 125; // 活力等级 4 的上限
  orgasm(full);
  assert.equal(F(full).base.eggs, 3);
  assert.equal(F(full).base.libido, 0);
  assert.equal(F(full).cooldown.orgasmOvulationUsed, true);

  const drained = makeChatState({ orgasmOvulationAmount: 3 });
  F(drained).base.vitality = 0;
  orgasm(drained);
  assert.equal(F(drained).base.eggs, 0);
  assert.equal(F(drained).base.libido, 0, '高潮照样发生');
  assert.equal(F(drained).cooldown.orgasmOvulationUsed, true);
  assert.match(F(drained).notify.secondly, /没有额外排卵/);
});

test('没有额外排卵倾向的物种不会因高潮排卵', () => {
  const elf = makeChatState({ orgasmOvulationAmount: 0 });
  F(elf).base.vitality = 125;
  orgasm(elf);
  assert.equal(F(elf).base.eggs, 0);
  assert.ok(!F(elf).cooldown.orgasmOvulationUsed, '没有触发，不占用冷却');
});

test('排卵期内只有一次高潮排卵，进入黄体期刷新一次，月经期全部重置', () => {
  const chatState = makeChatState({ orgasmOvulationAmount: 1 });
  F(chatState).base.vitality = 125;
  orgasm(chatState);
  orgasm(chatState);
  assert.equal(F(chatState).base.eggs, 1, '排卵期内第二次高潮不再加卵');

  // 自然推进进入黄体期：冷却刷新一次
  for (let day = 0; day < 6 && F(chatState).base.stage !== '黄体期'; day += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  }
  assert.equal(F(chatState).base.stage, '黄体期');
  assert.equal(F(chatState).cooldown.orgasmOvulationUsed, false);
  assert.equal(F(chatState).cooldown.lutealOrgasmRefreshed, true);
  const eggsBefore = F(chatState).base.eggs;
  F(chatState).base.vitality = 125;
  orgasm(chatState);
  assert.equal(F(chatState).base.eggs, eggsBefore + 1, '黄体期可再触发一次');
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.equal(F(chatState).cooldown.orgasmOvulationUsed, true, '同一个黄体期不会第二次刷新');

  setStage(chatState, '月经期');
  assert.equal(F(chatState).cooldown.orgasmOvulationUsed, false);
  assert.equal(F(chatState).cooldown.lutealOrgasmRefreshed, false);
});

test('手动切到黄体期也吃到那一次刷新', () => {
  const chatState = makeChatState({ orgasmOvulationAmount: 1 });
  F(chatState).base.vitality = 125;
  orgasm(chatState);
  setStage(chatState, '黄体期');
  assert.equal(F(chatState).cooldown.orgasmOvulationUsed, false);
  assert.equal(F(chatState).cooldown.lutealOrgasmRefreshed, true);
});
