// 工具参数里的人名允许写 ST 的 user 宏。这些名字会成为血缘图上的节点 id，
// 不解析的话族谱上会冒出一个叫「{{user}}」的人，而且写法不同就变成两个节点。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

afterEach(() => { delete globalThis.SillyTavern; });

const withUser = (userName) => {
  globalThis.SillyTavern = { getContext: () => ({ name1: userName }) };
};

function makeChar(name, over = {}) {
  return {
    name, initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...over,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { fetuses: [], fetusesCount: 0 },
      experience: {}, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
}

function setup(names = ['艾拉']) {
  const chatState = state.createEmptyChatState();
  for (const n of names) chatState.characters[n] = makeChar(n);
  return chatState;
}
const call = (cs, name, args) => applyToolCall(cs, { name, arguments: args });

test('bsAddSperm 的 male 会解析 user 宏', () => {
  withUser('阿哲');
  const chatState = setup();
  const result = call(chatState, 'bsAddSperm', {
    female: '艾拉', male: '{{user}}', race: '人类', amount: 20,
  });
  assert.equal(result.applied, true, result.message);
  assert.equal(chatState.characters['艾拉'].profile.base.sperms[0].male, '阿哲');
});

test('bsWombReturn 的 returner 会解析 user 宏', () => {
  withUser('阿哲');
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '<user>', returnerRace: '人类', hours: 0 });
  assert.equal(chatState.characters['艾拉'].profile.pregnant.fetuses[0].fathers, '阿哲');
});

test('四种写法都认得，大小写不敏感', () => {
  withUser('阿哲');
  for (const alias of ['user', 'USER', '{user}', '{{user}}', '<user>']) {
    const chatState = setup();
    call(chatState, 'bsAddSperm', { female: '艾拉', male: alias, race: '人类', amount: 20 });
    assert.equal(
      chatState.characters['艾拉'].profile.base.sperms[0].male, '阿哲',
      `${alias} 应解析成 user 名`,
    );
  }
});

test('female 也会解析：user 自己被注册成角色时找得到', () => {
  withUser('阿哲');
  const chatState = setup(['阿哲']);
  const result = call(chatState, 'bsAddSperm', {
    female: '{{user}}', male: '凯', race: '人类', amount: 20,
  });
  assert.equal(result.applied, true, result.message);
  assert.equal(chatState.characters['阿哲'].profile.base.sperms[0].male, '凯');
});

test('嵌合体的双父源逐个解析，按全角 × 拆', () => {
  withUser('阿哲');
  const chatState = setup(['艾拉', '琪拉']);
  call(chatState, 'bsImplantEmbryo', {
    female: '艾拉', provider: '琪拉', race: '人类', fathers: '{{user}} × 凯',
  });
  assert.equal(chatState.characters['艾拉'].profile.pregnant.fetuses[0].fathers, '阿哲 × 凯');
});

test('名字里含拉丁 x 不会被切坏', () => {
  withUser('阿哲');
  const chatState = setup();
  call(chatState, 'bsAddSperm', { female: '艾拉', male: 'Max', race: '人类', amount: 20 });
  assert.equal(chatState.characters['艾拉'].profile.base.sperms[0].male, 'Max');
});

test('一般名字原样保留', () => {
  withUser('阿哲');
  const chatState = setup();
  call(chatState, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', amount: 20 });
  assert.equal(chatState.characters['艾拉'].profile.base.sperms[0].male, '凯');
});

test('拿不到宿主 context 时原样保留，不会变成空字串', () => {
  const chatState = setup();
  const result = call(chatState, 'bsAddSperm', {
    female: '艾拉', male: '{{user}}', race: '人类', amount: 20,
  });
  assert.equal(result.applied, true, result.message);
  assert.equal(chatState.characters['艾拉'].profile.base.sperms[0].male, '{{user}}');
});

test('user 名为空白时也不覆写', () => {
  withUser('   ');
  const chatState = setup();
  call(chatState, 'bsAddSperm', { female: '艾拉', male: '{{user}}', race: '人类', amount: 20 });
  assert.equal(chatState.characters['艾拉'].profile.base.sperms[0].male, '{{user}}');
});
