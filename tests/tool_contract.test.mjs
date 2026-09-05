// 工具说明与实际行为的一致性。说明是模型唯一能事先知道规则的地方，
// 说明与实作对不上时，模型会撞到自己无法预测的拒绝。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';

const toolOf = (name) => TOOL_DEFINITIONS.find((item) => item.name === name);

function makeChar() {
  return {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 80, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4,
        eggs: 0, sperms: [], fertilizationDays: 0,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { fetuses: [], fetusesCount: 0 },
      experience: {}, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
}
function one() {
  const chatState = state.createEmptyChatState();
  chatState.characters['A'] = makeChar();
  return chatState;
}
const call = (chatState, name, args) => applyToolCall(chatState, { name, arguments: args });

test('每个工具都有说明与参数结构', () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} 说明太短`);
    assert.ok(tool.input_schema?.properties, `${tool.name} 缺 input_schema`);
  }
});

test('bsSetCharacterPresence 的 isPresent：schema 与实作一致要求必填', () => {
  // 实作刻意要求显式传入（缺省视为在场会让漏填变成静默改状态），
  // schema 曾经写成选填，模型照 schema 省略就会撞到拒绝
  assert.ok(toolOf('bsSetCharacterPresence').input_schema.required.includes('isPresent'));
  assert.equal(call(one(), 'bsSetCharacterPresence', { female: 'A' }).applied, false);
  assert.equal(call(one(), 'bsSetCharacterPresence', { female: 'A', isPresent: false }).applied, true);
});

test('bsSetMenstrualPhases 说明列出的阶段，正好就是实作接受的阶段', () => {
  const description = toolOf('bsSetMenstrualPhases').description;
  const accepted = ['卵泡期', '排卵期', '黄体期', '月经期', '产后恢复', '假孕期'];
  for (const stage of accepted) {
    assert.match(description, new RegExp(stage), `说明没提到 ${stage}`);
    assert.equal(call(one(), 'bsSetMenstrualPhases', { female: 'A', stage }).applied, true, `${stage} 该被接受`);
  }
  for (const stage of ['孕早期', '回归期', '第一产程']) {
    assert.equal(call(one(), 'bsSetMenstrualPhases', { female: 'A', stage }).applied, false, `${stage} 该被拒绝`);
  }
});

test('bsPassedTime 拒绝空呼叫与负数，各单位相加', () => {
  assert.equal(call(one(), 'bsPassedTime', {}).applied, false);
  assert.equal(call(one(), 'bsPassedTime', { day: -5 }).applied, false);
  const chatState = one();
  assert.equal(call(chatState, 'bsPassedTime', { day: 1, hour: 12 }).applied, true);
  assert.ok(Math.abs(chatState.characters['A'].profile.base.days - 1.5) < 0.001, '1 天 + 12 小时应等于 1.5 天');
});

test('bsUpdateCharacterStatus 是变化量而不是目标值，且被夹在上限内', () => {
  const down = one();
  call(down, 'bsUpdateCharacterStatus', { female: 'A', options: { vitality: -10 } });
  assert.equal(down.characters['A'].profile.base.vitality, 70, '80 传 -10 应为 70');
  const up = one();
  call(up, 'bsUpdateCharacterStatus', { female: 'A', options: { vitality: 9999 } });
  assert.ok(up.characters['A'].profile.base.vitality <= 200, '应被夹在该角色上限内');
  assert.ok(up.characters['A'].profile.base.vitality > 80);
});

test('bsNameChild 的 childIndex 从 0 起算', () => {
  const chatState = one();
  chatState.characters['A'].profile.children = [{ id: 'c1', name: null }, { id: 'c2', name: null }];
  assert.equal(call(chatState, 'bsNameChild', { female: 'A', childIndex: 0, name: '甲' }).applied, true);
  assert.equal(chatState.characters['A'].profile.children[0].name, '甲');
  assert.equal(call(chatState, 'bsNameChild', { female: 'A', childIndex: 2, name: '丙' }).applied, false, '越界该拒绝');
  assert.match(toolOf('bsNameChild').description, /0 起算/);
});

test('bsAbortion 的 fetusIndex 从 0 起算，只拿掉那一胎', () => {
  const fetus = (gender) => ({
    embryoId: 1, fathers: '凯', race: '人类', gender,
    embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0,
  });
  const chatState = one();
  chatState.characters['A'].profile.base.stage = '孕中期';
  chatState.characters['A'].profile.pregnant = {
    pregnantDays: 150, effectivePregnantDays: 150, fetusesCount: 3,
    fetalEnergyDrain: 1, amnionDurability: 100,
    fetuses: [fetus('女'), fetus('男'), fetus('双')],
  };
  call(chatState, 'bsAbortion', { female: 'A', fetusIndex: 0 });
  assert.deepEqual(
    chatState.characters['A'].profile.pregnant.fetuses.map((item) => item.gender),
    ['男', '双'],
    'fetusIndex 0 该拿掉第一胎',
  );
  assert.match(toolOf('bsAbortion').description, /0 起算/);
});
