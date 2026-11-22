// 宫压危机（1.5.3）：孕早中期不再直接流产，改成按超出的量扣胎儿健康；孕晚期照机率提前发动；临产、逾期照旧。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (over = {}) => ({ embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, health: 50, ...over });

function one(stage, days, baseOver = {}, extra = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: { stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 0, psyStress: 30, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...baseOver },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1 },
      pregnant: { pregnantDays: days, effectivePregnantDays: days, fetusesCount: 1, fetalEnergyDrain: 0.1, amnionDurability: 100, fetuses: [fetus()] },
      experience: {}, immune: { metabolism: true, ...(extra.immune || {}) }, metabolism: {}, cooldown: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const hours = (chatState, hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });
const spike = (chatState) => applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { uterinePressure: 999 } } });

test('孕早中期：宫压冲高先示警，之后扣胎儿健康，不会当场流产', () => {
  Math.random = () => 0;
  const chatState = one('孕中期', 120);
  spike(chatState);
  hours(chatState, 1);
  assert.match(P(chatState).notify.secondly, /子宫压力过高/);
  assert.equal(P(chatState).pregnant.fetuses[0].health, 50, '示警那一轮不伤胎');
  spike(chatState);
  hours(chatState, 2);
  assert.equal(P(chatState).base.stage, '孕中期', '旧版这里已经流产');
  assert.equal(P(chatState).pregnant.fetuses.length, 1);
  const health = P(chatState).pregnant.fetuses[0].health;
  assert.ok(health < 50 && health > 48, `满宫压两小时扣约 1，实得 ${health}`);
  assert.match(P(chatState).notify.secondly, /胎儿正在受损/);
});

test('孕早中期：做爱冲一下宫压、之后降下来，胎儿只受一点伤', () => {
  Math.random = () => 0;
  const chatState = one('孕早期', 50);
  spike(chatState);
  hours(chatState, 1);
  hours(chatState, 1);
  applyToolCall(chatState, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { uterinePressure: -999 } } });
  hours(chatState, 24);
  assert.equal(P(chatState).base.stage, '孕早期');
  assert.ok(P(chatState).pregnant.fetuses[0].health > 45);
});

test('孕晚期：示警之后每次推进照机率提前发动，乱数从顶端判', () => {
  const chatState = one('孕晚期', 230);
  spike(chatState);
  Math.random = () => 0;
  hours(chatState, 1);
  spike(chatState);
  hours(chatState, 6);
  assert.equal(P(chatState).base.stage, '孕晚期', '乱数 0 不发动');
  assert.match(P(chatState).notify.secondly, /暂时还没发动/);
  Math.random = () => 0.9999;
  spike(chatState);
  hours(chatState, 6);
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(P(chatState).pregnant.prodromalOriginStage, '孕晚期');
});

test('孕晚期：流产免疫挡住早产', () => {
  Math.random = () => 0.9999;
  const chatState = one('孕晚期', 230, {}, { immune: { miscarriage: true } });
  spike(chatState);
  hours(chatState, 1);
  spike(chatState);
  hours(chatState, 6);
  assert.equal(P(chatState).base.stage, '孕晚期');
});
