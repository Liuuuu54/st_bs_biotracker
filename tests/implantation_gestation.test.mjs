// 著床当下的孕龄：一次推进很多天不能把同一段时间算两次；长周期、快孕速的物种著床时仍在孕早期
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { getRacePhysiologyProfile } from '../scripts/race_config.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function conceive(race = '人类') {
  Math.random = () => 0.01;
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  character.profile.base.age = 22;
  character.profile.base.race = race;
  character.profile.bio = { ...character.profile.bio, ...getRacePhysiologyProfile(race) };
  character.profile.base.stage = '排卵期';
  character.profile.base.days = 0;
  character.profile.base.eggs = 1;
  chatState.characters.A = character;
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: 'A', male: 'M', race, action: 'insert', amount: 0 } });
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: 'A', male: 'M', race, action: 'deposit', amount: 20 } });
  return chatState;
}

const pass = (chatState, day) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day } });
const pregnancy = (chatState) => chatState.characters.A.profile;

test('受精后一次推进 30 天与每天推进一样：受精 30 天加产科偏移 14 天，著床那一步不再重复加', () => {
  const jump = conceive();
  pass(jump, 30);
  const daily = conceive();
  for (let day = 0; day < 30; day += 1) pass(daily, 1);
  assert.equal(pregnancy(jump).base.stage, '孕早期');
  assert.equal(Math.round(pregnancy(jump).pregnant.effectivePregnantDays), 44);
  assert.equal(Math.round(pregnancy(daily).pregnant.effectivePregnantDays), 44);
});

test('人类著床当下仍是第 20 天', () => {
  const chatState = conceive();
  let days = 0;
  while (pregnancy(chatState).base.stage !== '孕早期' && days < 30) { pass(chatState, 1); days += 1; }
  assert.equal(days, 6);
  assert.equal(Math.round(pregnancy(chatState).pregnant.effectivePregnantDays), 20);
});

test('经期约一年的天使与孕速 20 倍的怪鸟类，著床当下都还在孕早期', () => {
  // 怪鸟类著床只要 1.71 天，每天推进时那一步多出的 0.29 天照孕速 20 加上去：曲线值 58 + 5.7
  for (const [race, expected] of [['天使', 71], ['怪鸟类', 64]]) {
    const chatState = conceive(race);
    let days = 0;
    while (pregnancy(chatState).base.stage !== '孕早期' && days < 200) { pass(chatState, 1); days += 1; }
    const age = pregnancy(chatState).pregnant.effectivePregnantDays;
    assert.equal(pregnancy(chatState).base.stage, '孕早期', race);
    assert.ok(age < 98, `${race} 著床孕龄 ${age}`);
    assert.ok(Math.abs(age - expected) <= 2, `${race} 著床孕龄 ${age}，预期约 ${expected}`);
  }
});
