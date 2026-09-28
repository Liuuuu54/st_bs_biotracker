// 产科孕期曆与足月自然发动：37 周起宫压自行累积，满 42 周才算逾期
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { DUE_DATE_DAYS, TERM_START_DAYS } from '../scripts/stage_config.js';

function carrier({ days = 252, weights = [1], readiness = 1, breedTolerance = 1 } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '孕晚期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 150, libido: 20, uterinePressure: 0, psyStress: 30, vitalityLevel: 5, psyStressLevel: 4,
        eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance, impregnationDifficulty: 0.2, identicalProbability: 0 },
      pregnant: {
        pregnantDays: days, effectivePregnantDays: days, fetusesCount: weights.length, fetalEnergyDrain: 0,
        termReadiness: { embryoId: 1, value: readiness },
        fetuses: weights.map((weight, index) => ({
          embryoId: index + 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight, tendencyAngle: 0, affinity: 0,
        })),
      },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const step = (chatState) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
const runTo = (chatState, day) => { while (P(chatState).pregnant.effectivePregnantDays < day) step(chatState); };

test('产科孕期曆：孕早期到 12 周、孕晚期 28 周起、临产期 37～42 周、满 42 周才逾期', () => {
  assert.equal(TERM_START_DAYS, 259);
  assert.equal(DUE_DATE_DAYS, 280);
  const stageAt = (days) => state.derivePregnancyStageState(days, 1).stage;
  assert.equal(stageAt(84), '孕早期');
  assert.equal(stageAt(85), '孕中期');
  assert.equal(stageAt(195), '孕中期');
  assert.equal(stageAt(197), '孕晚期');
  assert.equal(stageAt(258), '孕晚期');
  assert.equal(stageAt(260), '临产期');
  assert.equal(stageAt(280), '临产期', '预产期落在临产期里');
  assert.equal(stageAt(293), '临产期');
  assert.equal(stageAt(295), '逾期');
});

test('37 周前宫压不会自己上升，足月后开始累积，满 42 周累积加倍', () => {
  const chatState = carrier({ readiness: 0.55 });
  runTo(chatState, TERM_START_DAYS);
  assert.equal(P(chatState).base.uterinePressure, 0, '孕晚期不自行累积');

  runTo(chatState, 287);
  assert.equal(P(chatState).base.stage, '临产期');
  const before = P(chatState).base.uterinePressure;
  step(chatState);
  const termDaily = P(chatState).base.uterinePressure - before;
  assert.ok(termDaily > 0, '临产期每天都在累积');

  runTo(chatState, 296);
  assert.equal(P(chatState).base.stage, '逾期');
  const overdueBefore = P(chatState).base.uterinePressure;
  step(chatState);
  const overdueDaily = P(chatState).base.uterinePressure - overdueBefore;
  assert.ok(overdueDaily > termDaily * 1.8, '逾期后日增约为临产期的两倍');
});

test('不碰宫压时单胎会在足月自然进入产兆前驱，发动体质再低也不拖过 44 周', () => {
  for (const readiness of [2.3, 0.5]) {
    const chatState = carrier({ readiness });
    for (let i = 0; i < 120 && !['产兆前驱', '第一产程'].includes(P(chatState).base.stage); i += 1) step(chatState);
    const onsetDay = P(chatState).pregnant.effectivePregnantDays;
    assert.equal(['产兆前驱', '第一产程'].includes(P(chatState).base.stage), true);
    assert.ok(onsetDay >= TERM_START_DAYS && onsetDay < 308, `readiness ${readiness} 发动于第 ${onsetDay} 天`);
  }
});

test('足月累积看肚子实际的量，不受母体承载耐受影响', () => {
  const pressureAt = (breedTolerance) => {
    const chatState = carrier({ readiness: 1, breedTolerance });
    runTo(chatState, 270);
    return P(chatState).base.uterinePressure;
  };
  // 胎重会随每周营养结算微调（那部分受耐受影响），累积公式本身不除耐受：差距只剩这点
  const high = pressureAt(10);
  const normal = pressureAt(1);
  assert.ok(Math.abs(high - normal) / normal < 0.02, `耐受 10：${high}，耐受 1：${normal}`);
});
