// 异期复孕：已在妊娠中再次受精，两胎孕龄不同步，最后一起生下来。
//
// 受精是机率性的，所以凡是「要不要受精成立」的判定都把 Math.random 钉死：
// 回传 0 时每一次机率判定都通过，能证明闸门开着；不钉死的话测试会随机红。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, isFetusKnownToCharacter } from '../scripts/tools.js';
import { deriveFetusTags } from '../scripts/fetus_tags.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });
const alwaysHit = () => { Math.random = () => 0; };

const fetus = (over = {}) => ({
  embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});
/** 直接种一颗已著床、已揭晓的异期胎，绕开机率 */
const lateFetus = (over = {}) => fetus({
  embryoId: 2, fathers: '乙', gender: '男', weight: 0.7,
  conceivedAtDays: 40, revealed: true, tags: ['superfetation'], ...over,
});

function one(baseOver = {}, pregnantOver = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters['A'] = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '孕早期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4,
        eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...baseOver,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 0.2 },
      pregnant: {
        pregnantDays: 20, effectivePregnantDays: 20, fetusesCount: 1,
        fetalEnergyDrain: 0.1, amnionDurability: 100, fetuses: [fetus()],
        ...pregnantOver,
      },
      experience: {}, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters['A'].profile;
const step = (chatState, day = 1) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day } });
const lateOf = (chatState) => P(chatState).pregnant.fetuses.find((f) => f.conceivedAtDays !== undefined);

function armSperm(chatState) {
  P(chatState).base.sperms = [{ male: '乙', race: '人类', value: 100 }];
  P(chatState).base.eggs = 1;
}

test('孕早期可以再次受精，新胚胎带 superfetation 标签且待著床', () => {
  alwaysHit();
  const chatState = one();
  armSperm(chatState);
  step(chatState);
  const late = lateOf(chatState);
  assert.ok(late, '孕早期内应能再次受精');
  assert.equal(late.pendingImplantation, true);
  assert.ok(late.conceivedAtDays > 0, '要记下受精当下的共用时钟');
  assert.deepEqual(deriveFetusTags(late, { carrierName: 'A' }), ['superfetation']);
  assert.equal(P(chatState).pregnant.fetuses.length, 2, '先来那胎不受影响');
});

test('胎重按落后进度打折，且乘在既有的种族混血偏移之上', () => {
  alwaysHit();
  const chatState = one();
  armSperm(chatState);
  step(chatState);
  const late = lateOf(chatState);
  // Math.random=0 时 getConceptionWeight 的波动固定为 e^-0.083，性别为男 ×1.05，
  // 同族的 weightRatio 为 1.0；再乘上异期折扣 (1 − 落后/280)²
  const penalty = (1 - (late.conceivedAtDays / 280)) ** 2;
  const expected = Math.exp(-0.083) * 1.05 * penalty;
  assert.ok(Math.abs(late.weight - expected) < 0.01,
    `应为 ${expected.toFixed(3)}，实际 ${late.weight.toFixed(3)}`);
  assert.ok(late.weight < 1, '落后的胎应比标准轻');
});

test('孕中期以后不再受精，即使机率全中', () => {
  alwaysHit();
  const chatState = one({ stage: '孕中期' }, { pregnantDays: 100, effectivePregnantDays: 100 });
  for (let i = 0; i < 5; i += 1) { armSperm(chatState); step(chatState); }
  assert.equal(lateOf(chatState), undefined, '孕中期不该再受精');
});

test('假孕期不会因为异期复孕转成真妊娠', () => {
  alwaysHit();
  const chatState = one({ stage: '假孕期' }, {
    fetuses: [], fetusesCount: 0, pregnantDays: 10, effectivePregnantDays: 10,
  });
  for (let i = 0; i < 5; i += 1) { armSperm(chatState); step(chatState); }
  assert.equal(P(chatState).pregnant.fetuses.length, 0, '假孕期不该凭空长出胎儿');
});

test('回归期不会被异期复孕插队', () => {
  alwaysHit();
  // 真实的回归期孕龄是 0：给非零值会触发妊娠阶段推导，被改写成孕早期
  const chatState = one({ stage: '回归期' }, {
    pregnantDays: 0, effectivePregnantDays: 0,
    wombReturn: { returner: 'B', totalHours: 48, remainingHours: 48 },
    fetuses: [fetus({ tags: ['rebirth'], weight: 3 })],
  });
  // 只推 1 小时：回归期还剩 48 小时，别让它走完转进孕早期
  for (let i = 0; i < 3; i += 1) {
    armSperm(chatState);
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  }
  assert.equal(P(chatState).base.stage, '回归期');
  assert.equal(lateOf(chatState), undefined);
});

test('揭晓之前模型与追踪页都看不到这一胎', () => {
  const chatState = one({}, {
    pregnantDays: 100, effectivePregnantDays: 100, fetusesCount: 2,
    fetuses: [fetus(), lateFetus({ revealed: undefined })],
  });
  const late = lateOf(chatState);
  assert.equal(isFetusKnownToCharacter(late), false, '未揭晓不可见');
  assert.equal(P(chatState).pregnant.fetuses.filter(isFetusKnownToCharacter).length, 1);
  // 待著床的更不可见
  assert.equal(isFetusKnownToCharacter(lateFetus({ pendingImplantation: true })), false);
});

test('妊娠期一半揭晓，可见胎数才增加', () => {
  const chatState = one({ stage: '孕中期' }, {
    pregnantDays: 135, effectivePregnantDays: 135, fetusesCount: 2,
    fetuses: [fetus(), lateFetus({ revealed: undefined })],
  });
  assert.equal(P(chatState).pregnant.fetuses.filter(isFetusKnownToCharacter).length, 1, '揭晓前只看得到 1 胎');
  while (P(chatState).pregnant.effectivePregnantDays < 141) step(chatState);
  assert.equal(lateOf(chatState).revealed, true);
  assert.equal(P(chatState).pregnant.fetuses.filter(isFetusKnownToCharacter).length, 2, '揭晓后胎数才增加');
});

test('每胎用自己的孕龄，不是共用时钟', () => {
  const chatState = one({ stage: '孕中期' }, {
    pregnantDays: 100, effectivePregnantDays: 100, fetusesCount: 2,
    fetuses: [fetus(), lateFetus()],
  });
  step(chatState);
  const shared = P(chatState).pregnant.effectivePregnantDays;
  const ownAge = shared - lateOf(chatState).conceivedAtDays;
  assert.ok(Math.abs(ownAge - (shared - 40)) < 0.001);
  assert.ok(ownAge > 0 && ownAge < shared, `晚到者年龄 ${ownAge} 应小于共用时钟 ${shared}`);
});

test('待著床的胚胎撞上孕中期会被清掉，不会活到分娩变成孩子', () => {
  const chatState = one({ stage: '孕早期' }, {
    pregnantDays: 80, effectivePregnantDays: 80, fetusesCount: 2,
    fetuses: [fetus(), lateFetus({ conceivedAtDays: 80, pendingImplantation: true, revealed: undefined })],
  });
  for (let i = 0; i < 20 && P(chatState).base.stage === '孕早期'; i += 1) step(chatState);
  assert.equal(P(chatState).base.stage, '孕中期');
  // 清除发生在进入孕中期后的第一个 tick：processSimpleConception 跑在阶段推进之前，
  // 转期那一拍看到的还是孕早期
  step(chatState);
  assert.equal(P(chatState).pregnant.fetuses.length, 1, '待著床的应被清掉');
  assert.equal(P(chatState).pregnant.fetuses[0].fathers, '甲', '先来那胎必须留着');
});

test('异期胎著床失败时只掉自己，先来那胎不受影响', () => {
  // 活力 50 → 著床失败率 0.5；random 0.4 < 0.5 必定失败
  Math.random = () => 0.4;
  const chatState = one({ stage: '孕早期', vitality: 50, fertilizationDays: 99 }, {
    pregnantDays: 30, effectivePregnantDays: 30, fetusesCount: 2,
    fetuses: [fetus(), lateFetus({ conceivedAtDays: 25, pendingImplantation: true, revealed: undefined })],
  });
  step(chatState);
  assert.equal(P(chatState).pregnant.fetuses.length, 1, '只该掉待著床那一颗');
  assert.equal(P(chatState).pregnant.fetuses[0].fathers, '甲');
  assert.equal(P(chatState).base.stage, '孕早期', '先来那胎的妊娠不该被清掉');
});

test('两胎一起生，异期标签跟到孩子身上', () => {
  const chatState = one({ stage: '孕中期' }, {
    pregnantDays: 100, effectivePregnantDays: 100, fetusesCount: 2,
    fetuses: [fetus(), lateFetus()],
  });
  for (let i = 0; i < 400 && P(chatState).base.stage !== '产后恢复'; i += 1) step(chatState);
  const children = P(chatState).children;
  assert.equal(children.length, 2, '必须一起生下来');
  // 这里只能断言胎数。多胎分娩有一个既有缺陷：会把其中一胎的身分整个复制到另一胎，
  // 连带覆盖父方与标签（普通双胞胎也会，与异期复孕无关，在 19acb35 上即可重现）。
  // 那个修好之后，再把「父方分别是甲与乙、乙带 superfetation 标签」的断言补回来。
  // 标签本身能存活分娩已由 fetus_tags.test.mjs 单独覆盖。
});

test('只有待著床胚胎时不能分娩', () => {
  const chatState = one({ stage: '孕早期' }, {
    fetusesCount: 1,
    fetuses: [lateFetus({ conceivedAtDays: 10, pendingImplantation: true, revealed: undefined })],
  });
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A' } });
  assert.equal(result.applied, false);
  assert.equal(P(chatState).children.length, 0);
});

test('母胎互动不会挑到待著床的胚胎', () => {
  const chatState = one({ stage: '孕中期' }, {
    pregnantDays: 100, effectivePregnantDays: 100, fetusesCount: 1,
    fetuses: [lateFetus({ conceivedAtDays: 10, pendingImplantation: true, revealed: undefined })],
  });
  const result = applyToolCall(chatState, {
    name: 'bsMaternalFetalInteraction',
    arguments: { female: 'A', direction: 'fetal', change: '亲近' },
  });
  assert.equal(result.applied, false, '没有已著床的胎儿时不该生效');
});
