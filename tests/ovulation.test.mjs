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

test('总卵数 = 1 颗基础 + 额外排卵倾向，不随经期倍率变动', () => {
  // 人类：倍率 1、倾向 1 → 2 颗（与旧算法一致）
  assert.equal(eggsAfterOneDay({ menstrualLengthRatio: 1, orgasmOvulationAmount: 1 }), 2);
  // 精灵：倾向 0 → 1 颗。旧算法按 6 天排卵窗口给 6 颗，与「几乎不具备额外排卵能力」矛盾
  assert.equal(eggsAfterOneDay({ menstrualLengthRatio: 3, orgasmOvulationAmount: 0 }), 1);
  // 龙族：倍率 4 但倾向仍是 1 → 2 颗，不再因窗口长而虚增到 8
  assert.equal(eggsAfterOneDay({ menstrualLengthRatio: 4, orgasmOvulationAmount: 1 }), 2);
  // 社会虫族：高倾向照常排满
  assert.equal(eggsAfterOneDay({ menstrualLengthRatio: 0.75, orgasmOvulationAmount: 8 }), 9);
});

test('超长周期在整个排卵窗口内只排一次', () => {
  // 经期倍率 13（约一年）→ 排卵期 26 天；旧算法会逐日累加到 26 颗
  const chatState = makeChatState({ menstrualLengthRatio: 13, orgasmOvulationAmount: 1 });
  for (let i = 0; i < 10; i += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  }
  const profile = chatState.characters.F.profile;
  assert.equal(profile.base.stage, '排卵期', '推进 20 天后仍应在排卵期内');
  assert.equal(profile.base.eggs, 2, '整个窗口内只排一次');
  assert.equal(profile.cooldown.naturalOvulationUsed, true, '本周期已排卵的旗标应保留');
});

test('高潮诱发排卵排出的卵不会被自然排卵覆盖', () => {
  const chatState = makeChatState({ menstrualLengthRatio: 1, orgasmOvulationAmount: 8 });
  // 先手动堆上高潮诱发排卵的份额，再推进时间触发自然排卵
  chatState.characters.F.profile.base.eggs = 8;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  // applyToolCall 内部会 clone 后写回，必须重新取引用
  assert.equal(chatState.characters.F.profile.base.eggs, 17, '自然排卵应叠加而不是封顶覆盖');
});

test('成熟卵子遇到精液时立即尝试受精，之后排出精液不影响胚胎', () => {
  const chatState = makeChatState();
  chatState.characters.F.profile.base.eggs = 1;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    applyToolCall(chatState, {
      name: 'bsAddSperm',
      arguments: { female: 'F', male: 'A', race: '人类', amount: 30 },
    });
  } finally {
    Math.random = originalRandom;
  }

  const profile = chatState.characters.F.profile;
  assert.equal(profile.pregnant.fetuses.length, 1, '精液进入时应立即生成待着床胚胎');
  assert.equal(profile.base.eggs, 0, '受精成功应消耗一枚成熟卵子');

  applyToolCall(chatState, {
    name: 'bsDrainSperm',
    arguments: { female: 'F', amount: 30 },
  });
  const afterDrain = chatState.characters.F.profile;
  assert.equal(afterDrain.base.sperms.length, 0, '排出残留精液不应撤销已经发生的受精');
  assert.equal(afterDrain.pregnant.fetuses.length, 1);
});
