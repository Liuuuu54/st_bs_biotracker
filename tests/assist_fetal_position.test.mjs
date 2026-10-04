// bsAssistFetalPosition：明确的胎位操作。通过检查就必定成功，难度由检查条件与活力门槛表现；
// 每次操作带来瞬时痛感（产程相关阶段，上限 +5、每小时减半）或心理压力（孕期）。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, ...over,
});

function setup(stage, fetuses, { pregnant = {}, base = {}, realistic = false } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 75,
        psyStress: 10, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: 280, effectivePregnantDays: 280, fetusesCount: fetuses.length, fetuses, fetalEnergyDrain: 1,
        laborPhase: null, laborBirthNumber: 0, laborHours: 0, effectiveLaborHours: 0, laborPain: 0, presentingEmbryoId: null,
        prodromalRemainingHours: 48, prodromalDelayProgressHours: 0, ...pregnant,
      },
      experience: {}, immune: { realisticLabor: realistic }, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const assist = (chatState, action, extra = {}) => applyToolCall(chatState, {
  name: 'bsAssistFetalPosition', arguments: { female: 'A', action, ...extra },
});
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);

// 宫压 75／上限 150 → 比例 0.5
test('产兆前驱托高领头胎儿：扣活力 10×胎重×(1+宫压比例)×深度系数，延后 T/2，入盆的胎儿退回低位，一阵剧痛', () => {
  const chatState = setup('产兆前驱', [fetus(1)], { pregnant: { prodromalRemainingHours: 10, prodromalLeadEmbryoId: 1 } });
  applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
  assert.equal(P(chatState).pregnant.fetuses[0].descentStage, 0);
  const result = assist(chatState, 'lift');
  assert.equal(result.applied, true, result.message);
  near(P(chatState).base.vitality, 100 - (10 * 1 * 1.5 * 1.5), '从入盆往上托，深度系数 1.5');
  near(P(chatState).pregnant.prodromalRemainingHours, 34, '延后 T/2 = 24 小时');
  assert.equal(P(chatState).pregnant.fetuses[0].descentStage, -1);
  near(P(chatState).pregnant.assistPainBoost, 2, '托高 +2');
  // 托高也改变前驱进度，产程本身的疼痛会一起重算；这里只确认加成确实叠在 laborPain 上
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 1 } });
  const withBoost = P(chatState).pregnant.laborPain;
  P(chatState).pregnant.assistPainBoost = 0;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 1 } });
  assert.ok(withBoost - P(chatState).pregnant.laborPain > 1.9, `加成反映在 laborPain：${withBoost} vs ${P(chatState).pregnant.laborPain}`);
});

test('活力不足就拒绝，状态完全不变', () => {
  const chatState = setup('产兆前驱', [fetus(1, { weight: 2 })], {
    pregnant: { prodromalRemainingHours: 10, prodromalLeadEmbryoId: 1 }, base: { vitality: 20 },
  });
  const before = JSON.stringify(P(chatState).pregnant);
  const result = assist(chatState, 'lift');
  assert.equal(result.applied, false);
  assert.match(result.message, /not enough vitality/);
  assert.equal(P(chatState).base.vitality, 20);
  assert.equal(P(chatState).pregnant.prodromalRemainingHours, 10);
  assert.equal(P(chatState).pregnant.assistPainBoost ?? 0, 0);
  assert.ok(before.includes('"prodromalRemainingHours":10'));
});

test('连续操作的痛感叠加上限 +5；之后每小时减半', () => {
  Math.random = () => 0.99;
  const chatState = setup('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 0 })], {
    pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 }, base: { vitality: 999 },
  });
  for (const angle of [10, 0, 10, 0]) assert.equal(assist(chatState, 'rotate', { targetAngle: angle }).applied, true);
  near(P(chatState).pregnant.assistPainBoost, 5, '上限 +5');
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  near(P(chatState).pregnant.assistPainBoost, 2.5, '一小时后减半');
});

test('孕期操作不加痛感，改为心理压力；转位直接到目标角度', () => {
  const chatState = setup('孕晚期', [fetus(1, { tendencyAngle: 180, descentStage: -2 })], { pregnant: { pregnantDays: 240, effectivePregnantDays: 240 } });
  const result = assist(chatState, 'rotate', { fetusIndex: 0, targetAngle: 0 });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).pregnant.fetuses[0].tendencyAngle, 0);
  assert.equal(P(chatState).base.psyStress, 14, '转位 +2 痛感换成 +4 心理压力');
  assert.equal(P(chatState).pregnant.assistPainBoost ?? 0, 0);
  assert.ok(P(chatState).base.vitality < 100, '转位扣一半的活力');
});

test('已入盆的胎儿只能小幅转动（30° 以内）', () => {
  const chatState = setup('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 40 })], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 } });
  assert.equal(assist(chatState, 'rotate', { targetAngle: 180 }).applied, false);
  assert.equal(assist(chatState, 'rotate', { targetAngle: 15 }).applied, true);
});

test('产兆前驱推送领头胎儿：缩短 T/2，归零即进入第一产程', () => {
  const chatState = setup('产兆前驱', [fetus(1)], { pregnant: { prodromalRemainingHours: 30, prodromalLeadEmbryoId: 1 } });
  assert.equal(assist(chatState, 'descend').applied, true);
  near(P(chatState).pregnant.prodromalRemainingHours, 6, '30 - 24');
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(assist(chatState, 'descend').applied, true);
  assert.equal(P(chatState).base.stage, '第一产程');
});

test('推送与托高的阶段限制：产程中不能推送；孕期不能推过子宫低位；宫顶不能再托', () => {
  const labor = setup('第一产程', [fetus(1, { descentStage: 0 })], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 } });
  assert.equal(assist(labor, 'descend').applied, false);
  assert.equal(assist(labor, 'lift').applied, false, '产程中唯一入盆的胎儿不能托回');
  const low = setup('孕晚期', [fetus(1, { descentStage: -1 })]);
  assert.equal(assist(low, 'descend').applied, false);
  const top = setup('孕晚期', [fetus(1, { descentStage: -3 })]);
  assert.equal(assist(top, 'lift').applied, false);
});

test('包在宿主体内的内胎不能单独操作', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: -2 }), fetus(2, { nestedInEmbryoId: 1 })]);
  const result = assist(chatState, 'rotate', { fetusIndex: 1, targetAngle: 0 });
  assert.equal(result.applied, false);
  assert.match(result.message, /inside its host/);
});

test('双胎互锁：托回无效，把其中一胎转开才解得开，第二胎随即退回子宫低位', () => {
  const chatState = setup('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: 0, inletIntruder: true, tendencyAngle: 0 }),
  ], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 }, realistic: true });
  assert.equal(assist(chatState, 'lift', { fetusIndex: 1 }).applied, false);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.descentStage), [0, 0]);
  const result = assist(chatState, 'rotate', { fetusIndex: 1, targetAngle: 30 });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.descentStage), [0, -1]);
  assert.equal('inletIntruder' in P(chatState).pregnant.fetuses[1], false);
});

test('互锁解开后，难产警示与「产程持续受阻」不留给下一轮叙事', () => {
  const chatState = setup('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: 0, inletIntruder: true, tendencyAngle: 0 }),
  ], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 }, realistic: true });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 10 } });
  assert.match(String(P(chatState).notify.firstly), /难产警示.*互锁/);
  assert.equal(assist(chatState, 'rotate', { fetusIndex: 1, targetAngle: 30 }).applied, true);
  assert.doesNotMatch(String(P(chatState).notify.firstly), /难产警示/);
  assert.doesNotMatch(String(P(chatState).notify.secondly), /产程持续受阻/);
});

test('肩难产：不给角度直接转动肩部即可解开，不向已归零的母体收取活力；之后照常出生', () => {
  Math.random = () => 0.99;
  const chatState = setup('第二产程', [fetus(1, { descentStage: 3, shoulderDystocia: true })], {
    pregnant: { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1, effectiveLaborHours: 0.8 },
    base: { vitality: 0, uterinePressure: 150 }, realistic: true,
  });
  const result = assist(chatState, 'rotate');
  assert.equal(result.applied, true, result.message);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.equal(P(chatState).children.length, 1);
});

test('母胎互动在产兆前驱不再兼任分娩抵抗：不改剩余时间', () => {
  Math.random = () => 0;
  const chatState = setup('产兆前驱', [fetus(1)], { pregnant: { prodromalRemainingHours: 30, prodromalLeadEmbryoId: 1 } });
  applyToolCall(chatState, { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'maternal' } });
  assert.equal(P(chatState).pregnant.prodromalRemainingHours, 30);
});

// ── extract：第二产程助产拉出当前先露胎 ─────────────────
const secondStage = (fetuses, pregnant = {}, over = {}) => setup('第二产程', fetuses, {
  pregnant: { laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 1, ...pregnant }, ...over,
});

test('extract：直接生下先露胎，胎膜未破会先破；其余胎儿不受影响，转入间歇期', () => {
  const chatState = secondStage([fetus(1, { descentStage: 1 }), fetus(2, { descentStage: -1 })]);
  const result = assist(chatState, 'extract');
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).children.map((child) => child.fathers), ['父1']);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [2]);
  assert.equal(P(chatState).pregnant.fetuses[0].amnionDurability, 100, '其他胎囊不动');
  assert.equal(P(chatState).pregnant.laborPhase, '间歇期');
  assert.match(String(P(chatState).notify.secondly), /生下了/);
  assert.doesNotMatch(String(P(chatState).notify.secondly), /助产/, '同步剧情里自己生下的胎儿时不能写成助产');
  near(P(chatState).pregnant.assistPainBoost, 3, '拉出 +3');
});

test('extract 只能用在第二产程、已进产道的先露胎；被拒绝时不改动任何胎囊', () => {
  const notInCanal = secondStage([fetus(1, { descentStage: 0 })], { laborPhase: '间歇期' });
  assert.equal(assist(notInCanal, 'extract').applied, false);
  assert.equal(P(notInCanal).pregnant.fetuses[0].amnionDurability, 100);
  const otherFetus = secondStage([fetus(1, { descentStage: 1 }), fetus(2, { descentStage: -1 })]);
  assert.equal(assist(otherFetus, 'extract', { fetusIndex: 1 }).applied, false);
  const firstStage = setup('第一产程', [fetus(1, { descentStage: 0 })], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 } });
  assert.equal(assist(firstStage, 'extract').applied, false);
});

test('肩难产可以直接 extract 拉出', () => {
  const chatState = secondStage([fetus(1, { descentStage: 3, shoulderDystocia: true })], { laborPhase: '胎体娩出' }, {
    base: { vitality: 0, uterinePressure: 150 }, realistic: true,
  });
  assert.equal(assist(chatState, 'extract').applied, true);
  assert.equal(P(chatState).children.length, 1);
});

test('难产警示会指出可用的助产动作', () => {
  Math.random = () => 0.99;
  const chatState = secondStage([fetus(1, { descentStage: -1, tendencyAngle: 90 })], {}, { realistic: true, base: { uterinePressure: 120 } });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.match(String(P(chatState).notify.firstly), /action=rotate/);
});

test('旧的 bsRuptureMembranes 已移除', () => {
  const chatState = setup('第一产程', [fetus(1)], { pregnant: { laborPhase: '潜伏期' } });
  const result = applyToolCall(chatState, { name: 'bsRuptureMembranes', arguments: { female: 'A' } });
  assert.equal(result.applied, false);
  assert.match(result.message, /Unsupported tool/);
});

// ── actor=fetus：胎儿自己动 ─────────────────────────────
test('胎儿自己转身：不耗母体活力，母体一样心理压力上升；讯息写明是自己转的', () => {
  const chatState = setup('孕晚期', [fetus(1, { tendencyAngle: 180, descentStage: -2 })], { base: { vitality: 0 } });
  const stressBefore = P(chatState).base.psyStress;
  const result = assist(chatState, 'rotate', { fetusIndex: 0, targetAngle: 0, backSide: '左后', actor: 'fetus' });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).pregnant.fetuses[0].tendencyAngle, 0);
  assert.equal(P(chatState).pregnant.fetuses[0].backSide, '左后');
  assert.equal(P(chatState).base.vitality, 0);
  assert.ok(P(chatState).base.psyStress > stressBefore);
  assert.match(String(P(chatState).notify.secondly), /自己转到/);
  assert.equal(assist(chatState, 'rotate', { fetusIndex: 0, targetAngle: 180 }).applied, false, '外力转位仍要母体活力');
});

test('胎儿自己往上缩、往下钻；产兆前驱领头胎儿自己缩回会延后分娩', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: -1 })], { base: { vitality: 0 } });
  assert.equal(assist(chatState, 'lift', { fetusIndex: 0, actor: 'fetus' }).applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].descentStage, -2);
  assert.equal(assist(chatState, 'descend', { fetusIndex: 0, actor: 'fetus' }).applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].descentStage, -1);
  assert.match(String(P(chatState).notify.secondly), /自己往下钻/);

  const prodromal = setup('产兆前驱', [fetus(1)], { base: { vitality: 0 }, pregnant: { prodromalRemainingHours: 30, prodromalLeadEmbryoId: 1 } });
  assert.equal(assist(prodromal, 'lift', { actor: 'fetus' }).applied, true);
  assert.ok(P(prodromal).pregnant.prodromalRemainingHours > 30);
});

test('胎儿不能自己 extract，也解不开自己的肩难产；其余限制与外力相同', () => {
  const stuck = setup('第二产程', [fetus(1, { descentStage: 3, shoulderDystocia: true, amnionDurability: 0 })], {
    pregnant: { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1 }, realistic: true,
  });
  assert.equal(assist(stuck, 'extract', { actor: 'fetus' }).applied, false);
  assert.equal(assist(stuck, 'rotate', { actor: 'fetus' }).applied, false);
  assert.equal(P(stuck).pregnant.fetuses[0].shoulderDystocia, true);

  const engaged = setup('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 0 })], {
    pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 },
  });
  assert.equal(assist(engaged, 'rotate', { actor: 'fetus', targetAngle: 180 }).applied, false, '入盆后一样只能小幅转动');
  assert.equal(assist(engaged, 'lift', { actor: 'fetus' }).applied, false, '产程中入盆后一样不能退回');
  assert.equal(assist(engaged, 'rotate', { actor: 'nobody', targetAngle: 10 }).applied, false);
});

test('互锁的第二胎可以自己转开，退回子宫低位', () => {
  const chatState = setup('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: 0, inletIntruder: true, tendencyAngle: 0 }),
  ], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 }, realistic: true, base: { vitality: 0 } });
  const result = assist(chatState, 'rotate', { fetusIndex: 1, targetAngle: 30, actor: 'fetus' });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.descentStage), [0, -1]);
});

test('胎儿自己踢破胎膜：门槛与外力破水相同', () => {
  const early = setup('孕晚期', [fetus(1)]);
  assert.equal(assist(early, 'rupture', { actor: 'fetus' }).applied, false);
  const labor = setup('第一产程', [fetus(1, { descentStage: 0 })], { pregnant: { laborPhase: '潜伏期', presentingEmbryoId: 1 } });
  assert.equal(assist(labor, 'rupture', { actor: 'fetus' }).applied, true);
  assert.equal(P(labor).pregnant.fetuses[0].amnionDurability, 0);
  assert.match(String(P(labor).notify.secondly), /自己踢破了胎膜/);
});

// ── 插入的推顶：产兆前驱与产程中顶到最前面的胎儿 ─────────
const sperm = (chatState, action, amount = 0) => applyToolCall(chatState, {
  name: 'bsAddSperm', arguments: { female: 'A', male: 'M', race: '人类', action, amount },
});
const canalAt = (phase, depth, over = {}, opts = {}) => setup('第二产程', [fetus(1, { descentStage: depth, affinity: 0, ...over })], {
  pregnant: { laborPhase: phase, laborBirthNumber: 1, presentingEmbryoId: 1, effectiveLaborHours: 50 }, ...opts,
});

test('产道里的先露胎被插入顶回：产程进度倒退、亲和下降、痛、胎膜磨损', () => {
  const chatState = canalAt('胎体下降', 1);
  const result = sperm(chatState, 'insert');
  assert.equal(result.applied, true);
  const pregnant = P(chatState).pregnant;
  assert.ok(pregnant.effectiveLaborHours < 50);
  assert.equal(pregnant.fetuses[0].affinity, -5);
  assert.equal(pregnant.assistPainBoost, 2);
  assert.equal(pregnant.fetuses[0].amnionDurability, 75);
  assert.equal(pregnant.fetuses[0].descentStage, 1, '位置由阶段推导，仍在产道');
  assert.match(String(P(chatState).notify.secondly), /往回顶.*倒退/);
  assert.match(result.message, /倒退/);
});

test('真实分娩模式倒退较多；着冠时比产道倒退更多，胎膜可能被顶破', () => {
  const lostOf = (chatState) => 50 - P(chatState).pregnant.effectiveLaborHours;
  const gentle = canalAt('胎体下降', 1);
  const realistic = canalAt('胎体下降', 1, {}, { realistic: true });
  sperm(gentle, 'insert');
  sperm(realistic, 'insert');
  assert.ok(lostOf(realistic) > lostOf(gentle));

  const crowned = canalAt('胎体娩出', 2, { amnionDurability: 40 });
  sperm(crowned, 'insert');
  assert.equal(P(crowned).pregnant.fetuses[0].affinity, -8);
  assert.equal(P(crowned).pregnant.fetuses[0].amnionDurability, 0);
  assert.equal(P(crowned).visualCue?.type, 'rupture');
  assert.match(String(P(crowned).notify.secondly), /着冠.*顶破/);
});

test('第一产程只入盆时只会痛；先露部已出或肩难产时不作用', () => {
  const inlet = setup('第一产程', [fetus(1, { descentStage: 0 })], {
    pregnant: { laborPhase: '活跃期', presentingEmbryoId: 1, effectiveLaborHours: 3 },
  });
  sperm(inlet, 'insert');
  assert.equal(P(inlet).pregnant.effectiveLaborHours, 3);
  assert.equal(P(inlet).pregnant.assistPainBoost, 1);
  assert.equal(P(inlet).pregnant.fetuses[0].affinity, -3);

  const stuck = canalAt('胎体娩出', 3, { shoulderDystocia: true }, { realistic: true });
  sperm(stuck, 'insert');
  assert.equal(P(stuck).pregnant.fetuses[0].affinity, 0);
  assert.equal(P(stuck).pregnant.effectiveLaborHours, 50);
});

test('产兆前驱：插入把领头胎儿往上顶、延后前驱；射精催熟子宫颈、缩短前驱', () => {
  const chatState = setup('产兆前驱', [fetus(1)], { pregnant: { prodromalRemainingHours: 30, prodromalLeadEmbryoId: 1 } });
  sperm(chatState, 'insert');
  const afterInsert = P(chatState).pregnant.prodromalRemainingHours;
  assert.ok(afterInsert > 30);
  assert.equal(P(chatState).pregnant.fetuses[0].affinity, -2);
  sperm(chatState, 'deposit', 20);
  assert.ok(P(chatState).pregnant.prodromalRemainingHours < afterInsert);
  assert.match(String(P(chatState).notify.secondly), /子宫颈成熟/);
});

test('非妊娠或孕期中的插入不碰胎儿', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: -1 })]);
  const result = sperm(chatState, 'insert');
  assert.equal(result.applied, true);
  assert.equal(P(chatState).pregnant.fetuses[0].affinity, 0);
  assert.equal(P(chatState).notify.secondly, undefined);
});

test('extract 同步剧情里自己生下的单胎：走完第三产程记为自然产，不记手术产', () => {
  const chatState = secondStage([fetus(1, { descentStage: 2 })]);
  assert.equal(assist(chatState, 'extract').applied, true);
  for (let i = 0; i < 12 && P(chatState).base.stage !== '产后恢复'; i += 1) {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 30 } });
  }
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).experience.naturalBirthExperience, 1);
  assert.equal(P(chatState).experience.surgicalBirthExperience, 0);
});
