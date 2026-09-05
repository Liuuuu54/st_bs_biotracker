// 多胎的身分不能在孕期中被互相覆盖。
//
// 孕晚期的斜位重新定位原本用「收集当时的索引」去 splice，但每搬动一胎阵列就位移一次，
// 后面那些索引全部失效：结果是删掉别人、再把自己插回去，一胎被消灭、另一胎被复制两份。
// 修正前 2 胎跑 150 次有 127 次父方重复，3 胎 137 次。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const fetus = (over = {}) => ({
  embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});

function pregnantWith(count) {
  const fetuses = [];
  for (let i = 0; i < count; i += 1) {
    // 40° 起跳都落在斜位判定内，确保会走到重新定位那条路径
    fetuses.push(fetus({ embryoId: i + 1, fathers: `父${i}`, tendencyAngle: 40 + (i * 10) }));
  }
  const chatState = state.createEmptyChatState();
  chatState.characters['A'] = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '孕中期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, identicalProbability: 0 },
      pregnant: {
        pregnantDays: 100, effectivePregnantDays: 100, fetusesCount: count,
        fetalEnergyDrain: 0.3, amnionDurability: 100, fetuses,
      },
      experience: {}, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}

for (const count of [2, 3, 4]) {
  test(`${count} 胎走完整个孕期后，每一胎的父方仍然各自独立`, () => {
    // 重新定位是机率性的，单跑一次可能刚好没触发，所以重复多轮
    for (let run = 0; run < 40; run += 1) {
      const chatState = pregnantWith(count);
      const profile = () => chatState.characters['A'].profile;
      for (let i = 0; i < 500 && profile().base.stage !== '产后恢复'; i += 1) {
        applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
      }
      const fathers = profile().children.map((child) => child.fathers);
      assert.equal(fathers.length, count, `第 ${run} 轮：应生下 ${count} 个孩子`);
      assert.equal(
        new Set(fathers).size, count,
        `第 ${run} 轮：父方不该重复，实际 ${fathers.join(',')}`,
      );
    }
  });
}

test('孕晚期的斜位重新定位不会弄丢或复制胎儿', () => {
  for (let run = 0; run < 60; run += 1) {
    const chatState = pregnantWith(3);
    const profile = () => chatState.characters['A'].profile;
    // 推到孕晚期并停在那里，只检查胎儿阵列本身
    for (let i = 0; i < 200 && profile().base.stage !== '孕晚期'; i += 1) {
      applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
    }
    for (let i = 0; i < 40; i += 1) {
      applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
      const ids = profile().pregnant.fetuses.map((item) => item.embryoId);
      assert.equal(ids.length, 3, `第 ${run} 轮：胎数不该变`);
      assert.equal(new Set(ids).size, 3, `第 ${run} 轮：embryoId 不该重复，实际 ${ids.join(',')}`);
    }
  }
});
