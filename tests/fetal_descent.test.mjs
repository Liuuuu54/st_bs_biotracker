// descentStage 的资料层：各阶段上限、新胎起点、以及 reconcileFetalDescent 维持的空间不变量。
// -3 宫顶、-2 宫内自由、-1 子宫低位、0 入盆、1 进入产道、2 着冠、3 先露部已出。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, getUterinePressureCap } from '../scripts/tools.js';
import { buildTrackerPayload, getTrackerToolDefinitions } from '../scripts/tracker.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, ...over,
});

function setup(stage, fetuses, pregnant = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 10,
        psyStress: 0, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: 150, effectivePregnantDays: 150, fetusesCount: fetuses.length, fetuses, fetalEnergyDrain: 1,
        laborPhase: null, laborBirthNumber: 0, laborHours: 0, effectiveLaborHours: 0, presentingEmbryoId: null,
        prodromalRemainingHours: 48, ...pregnant,
      },
      experience: {}, immune: {}, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;
const touch = (chatState) => applyToolCall(chatState, { name: 'bsSetCharacterPresence', arguments: { female: 'A', isPresent: true } });
const depths = (chatState) => P(chatState).pregnant.fetuses.map((f) => f.descentStage);

test('缺值的胎儿从宫内自由 -2 起算；待着床胚胎没有位置', () => {
  const chatState = setup('孕中期', [fetus(1), fetus(2, { pendingImplantation: true, descentStage: -1 })]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-2, undefined]);
});

test('孕期最多到子宫低位 -1，不能入盆；最高是宫顶 -3', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: 0 }), fetus(2, { descentStage: 2 }), fetus(3, { descentStage: -7 })]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-1, -1, -3]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null, '孕期没有胎儿能到入口，不会锁定先露');
});

test('产兆前驱后半段领头胎儿入盆至 0；第二产程可到 3', () => {
  const prodromal = setup('产兆前驱', [fetus(1, { descentStage: 2 })], { prodromalRemainingHours: 10 });
  touch(prodromal);
  assert.deepEqual(depths(prodromal), [0]);
  const second = setup('第二产程', [fetus(1, { descentStage: 3 })], { laborPhase: '胎体娩出', presentingEmbryoId: 1 });
  touch(second);
  assert.deepEqual(depths(second), [3]);
});

test('有胎儿到达入口而尚无先露胎时，锁定最深者（同值取编号小者）；入口只容一胎', () => {
  const chatState = setup('第一产程', [fetus(5, { descentStage: 0 }), fetus(3, { descentStage: 0 }), fetus(4, { descentStage: -1 })], { laborPhase: '潜伏期' });
  touch(chatState);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 3);
  assert.deepEqual(depths(chatState), [-1, 0, -1], '另一胎被挡回子宫低位');
});

test('已锁定的先露胎优先占用入口，不因他胎更深而被取代', () => {
  const chatState = setup('第二产程', [fetus(1, { descentStage: 2 }), fetus(2, { descentStage: 1 })], { laborPhase: '胎体下降', presentingEmbryoId: 2 });
  touch(chatState);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 2);
  assert.deepEqual(depths(chatState), [-1, 1]);
});

test('包在宿主体内的内胎与宿主同步；已被生出的内胎保有自己的位置', () => {
  const chatState = setup('孕晚期', [
    fetus(1, { descentStage: -3 }),
    fetus(2, { nestedInEmbryoId: 1, descentStage: -1 }),
    fetus(3, { nestedInEmbryoId: 1, nestedReleased: true, amnionDurability: 0, descentStage: -1 }),
  ]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-3, -3, -1]);
});

test('退回妊娠阶段时上限随之收回：入口上的胎儿退到子宫低位，先露锁定释放', () => {
  const chatState = setup('孕晚期', [fetus(1, { descentStage: 0 })], { presentingEmbryoId: 1 });
  touch(chatState);
  assert.deepEqual(depths(chatState), [-1]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null);
});

test('产兆前驱：剩余时间回到前半段（托高）时领头胎儿退回低位、释放先露锁定；其他胎儿不能抢入口', () => {
  const chatState = setup('产兆前驱', [fetus(1, { descentStage: -1 }), fetus(2, { descentStage: 0 })], {
    prodromalRemainingHours: 10, prodromalLeadEmbryoId: 1,
  });
  touch(chatState);
  assert.deepEqual(depths(chatState), [0, -1], '领头胎儿入盆，另一胎被挡在低位');
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 1);
  P(chatState).pregnant.prodromalRemainingHours = 30;
  touch(chatState);
  assert.deepEqual(depths(chatState), [-1, -1]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, null);
  P(chatState).pregnant.prodromalRemainingHours = 60;
  touch(chatState);
  assert.deepEqual(depths(chatState), [-2, -1], '剩余超过初始时长：被托回宫内自由');
});

// ── 自然胎动（孕期每天一次） ─────────────────────────────
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const passDays = (chatState, day) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day } });

test('孕期胎动：位置始终在宫顶 -3 与子宫低位 -1 之间，且真的会上下移动', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 5; seed += 1) {
    Math.random = seeded(seed);
    const chatState = setup('孕中期', [fetus(1), fetus(2), fetus(3)], { pregnantDays: 120, effectivePregnantDays: 120 });
    for (let day = 0; day < 20; day += 1) {
      passDays(chatState, 1);
      for (const value of depths(chatState)) {
        assert.ok(value >= -3 && value <= -1, `越界：${value}`);
        seen.add(value);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [-1, -2, -3], '宫顶、宫内、低位都该出现过');
});

test('一直掷出「往下」时一天只降一格，停在子宫低位并通报', () => {
  Math.random = () => 0;
  const chatState = setup('孕晚期', [fetus(1, { descentStage: -3 })], { pregnantDays: 220, effectivePregnantDays: 220 });
  passDays(chatState, 1);
  assert.deepEqual(depths(chatState), [-2], '一天最多跨一格');
  passDays(chatState, 3);
  assert.deepEqual(depths(chatState), [-1]);
  assert.match(String(P(chatState).notify.secondly), /第1胎下降到子宫低位/);
});

test('左右换位只交换阵列位置，胎儿的身分与资料不变；不再发出「胚胎分布发生了变化」', () => {
  const orders = new Set();
  for (let seed = 11; seed <= 20; seed += 1) {
    Math.random = seeded(seed);
    const originals = [fetus(1), fetus(2, { fathers: '乙' }), fetus(3, { fathers: '丙' })];
    const chatState = setup('孕中期', originals, { pregnantDays: 130, effectivePregnantDays: 130 });
    passDays(chatState, 10);
    const now = P(chatState).pregnant.fetuses;
    orders.add(now.map((f) => f.embryoId).join(','));
    assert.deepEqual(now.map((f) => f.embryoId).sort(), [1, 2, 3]);
    for (const f of now) assert.equal(f.fathers, f.embryoId === 1 ? '父1' : (f.embryoId === 2 ? '乙' : '丙'));
    assert.doesNotMatch(JSON.stringify(P(chatState).notify), /胚胎分布发生了变化/);
  }
  assert.ok(orders.size > 1, '十个种子里至少要出现一次换位');
});

test('被包着的内胎与未揭晓胎儿不单独活动；未揭晓胎儿的位置事件不会出现在通知里', () => {
  Math.random = () => 0;
  const chatState = setup('孕晚期', [
    fetus(1, { descentStage: -2 }),
    fetus(2, { nestedInEmbryoId: 1 }),
    fetus(3, { descentStage: -2, conceivedAtDays: 100, tags: ['superfetation'] }),
  ], { pregnantDays: 220, effectivePregnantDays: 220 });
  passDays(chatState, 1);
  assert.deepEqual(depths(chatState), [-1, -1, -1], '内胎跟宿主一起到了低位');
  assert.match(String(P(chatState).notify.secondly), /第1胎下降到子宫低位/);
  assert.doesNotMatch(String(P(chatState).notify.secondly), /第2胎/);
});

// ── 产兆前驱与产程 ───────────────────────────────────────
const passHours = (chatState, hour) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour } });

test('进入产兆前驱时选定最深的胎儿为领头；前驱时间过半自动入盆并锁定先露、发出通知', () => {
  Math.random = () => 0.99;
  const chatState = setup('临产期', [fetus(1, { descentStage: -2 }), fetus(2, { descentStage: -1 })], {
    pregnantDays: 270, effectivePregnantDays: 270,
  });
  P(chatState).base.uterinePressure = 9999;
  passHours(chatState, 1); // 宫压警告
  passHours(chatState, 1); // 进入产兆前驱
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(P(chatState).pregnant.prodromalLeadEmbryoId, 2);
  assert.deepEqual(depths(chatState), [-2, -1]);
  passHours(chatState, 30); // 双胎的前驱时长约 52 小时，过半即入盆
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(depths(chatState)[1], 0);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 2);
  assert.match(String(P(chatState).notify.secondly), /第2胎入盆了/);
});

test('产程中高位胎儿每小时仍会活动，但不会越过子宫低位；已入盆的先露胎不被取代', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 6; seed += 1) {
    Math.random = seeded(seed);
    const chatState = setup('第一产程', [fetus(1, { descentStage: 0 }), fetus(2), fetus(3)], {
      laborPhase: '潜伏期', presentingEmbryoId: 1, pregnantDays: 280, effectivePregnantDays: 280,
    });
    P(chatState).base.uterinePressure = 120;
    for (let hour = 0; hour < 12; hour += 1) {
      passHours(chatState, 1);
      if (P(chatState).base.stage !== '第一产程') break;
      const [lead, ...others] = P(chatState).pregnant.fetuses.slice().sort((a, b) => a.embryoId - b.embryoId);
      assert.equal(lead.descentStage, 0);
      for (const other of others) {
        assert.ok(other.descentStage <= -1);
        seen.add(other.descentStage);
      }
    }
  }
  assert.ok(seen.size > 1, '高位胎儿应该有上下活动');
});

test('产程中斜位胎儿往最近的主胎位转；先露胎转得比较慢', () => {
  Math.random = () => 0.99; // 不产生位移，只转角度
  const chatState = setup('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 40 }), fetus(2, { tendencyAngle: 40 })], {
    laborPhase: '潜伏期', presentingEmbryoId: 1, pregnantDays: 280, effectivePregnantDays: 280,
  });
  P(chatState).base.uterinePressure = 120;
  passHours(chatState, 1);
  const [engaged, high] = P(chatState).pregnant.fetuses;
  const birthDifficulty = P(chatState).bio.birthDifficulty;
  assert.ok(Math.abs((40 - high.tendencyAngle) - 5 / birthDifficulty) < 1e-6, '高位胎儿每小时 5° ÷ 分娩难度');
  assert.ok(Math.abs((40 - engaged.tendencyAngle) * 2 - (40 - high.tendencyAngle)) < 1e-6, '先露胎速度减半');
});

test('母体安抚失败不改任何一胎的胎位', () => {
  Math.random = () => 0; // 心理压力拉满，安抚必定失败
  const chatState = setup('产兆前驱', [fetus(1, { tendencyAngle: 0 }), fetus(2, { tendencyAngle: 0 })], {
    prodromalRemainingHours: 10, prodromalLeadEmbryoId: 1,
  });
  touch(chatState);
  P(chatState).base.psyStress = 400;
  const result = applyToolCall(chatState, { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'maternal' } });
  assert.equal(result.applied, true, result.message);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.tendencyAngle), [0, 0]);
  assert.match(String(P(chatState).notify.secondly), /没有回应/);
});

// ── 第二产程的下降与跨阶段时间 ─────────────────────────────
const laboringAt = (phase, fetuses, pregnant = {}) => {
  const chatState = setup('第二产程', fetuses, {
    laborPhase: phase, laborBirthNumber: 1, pregnantDays: 280, effectivePregnantDays: 280, ...pregnant,
  });
  P(chatState).base.uterinePressure = 120;
  return chatState;
};

test('间歇期：上一胎出生后由最深的胎儿入盆，下一胎从入口开始，进入胎体下降时到产道 1', () => {
  Math.random = () => 0.99;
  const chatState = laboringAt('间歇期', [fetus(1, { descentStage: -2 }), fetus(2, { descentStage: -1 })]);
  touch(chatState);
  assert.deepEqual(depths(chatState), [-2, 0]);
  assert.equal(P(chatState).pregnant.presentingEmbryoId, 2);
  passHours(chatState, 0.6);
  assert.equal(P(chatState).pregnant.laborPhase, '胎体下降');
  assert.deepEqual(depths(chatState), [-2, 1]);
});

test('胎体娩出时先露胎着冠到 2；走完娩出才经过 3 出生', () => {
  Math.random = () => 0.99;
  const chatState = laboringAt('胎体下降', [fetus(1, { descentStage: 1 }), fetus(2)], { presentingEmbryoId: 1 });
  const phases = [];
  for (let step = 0; step < 40 && P(chatState).children.length === 0; step += 1) {
    passHours(chatState, 0.1);
    phases.push(`${P(chatState).pregnant.laborPhase}:${P(chatState).pregnant.fetuses.find((f) => f.embryoId === 1)?.descentStage ?? 'born'}`);
  }
  assert.ok(phases.includes('胎体娩出:2'), phases.join(' '));
  assert.equal(P(chatState).children.length, 1);
  assert.ok(!phases.some((entry) => entry.endsWith(':3')), '3 只在出生那一刻短暂经过，不会停留');
});

test('一次推进跨过多个阶段：剩余时间逐段带下去，单胎可一路生完进入第三产程之后', () => {
  Math.random = () => 0.99;
  const chatState = laboringAt('胎体下降', [fetus(1, { descentStage: 1 })], { presentingEmbryoId: 1 });
  passHours(chatState, 24);
  assert.equal(P(chatState).children.length, 1);
  assert.ok(['第三产程', '产后恢复'].includes(P(chatState).base.stage), P(chatState).base.stage);
});

test('多胎一次推进跨过多次出生：出生通知不被后面的进度覆盖', () => {
  Math.random = () => 0.99;
  const chatState = laboringAt('胎体娩出', [fetus(1, { descentStage: 2 }), fetus(2), fetus(3)], { presentingEmbryoId: 1 });
  passHours(chatState, 1);
  assert.match(String(P(chatState).notify.secondly), /生下了父1的孩子/);
});

test('产兆前驱走完后多出来的时间带进第一产程', () => {
  Math.random = () => 0.99;
  const chatState = setup('产兆前驱', [fetus(1, { descentStage: -1 })], {
    prodromalRemainingHours: 1, pregnantDays: 280, effectivePregnantDays: 280,
  });
  P(chatState).base.uterinePressure = 120;
  passHours(chatState, 3);
  assert.equal(P(chatState).base.stage, '第一产程');
  assert.ok(Math.abs(P(chatState).pregnant.laborHours - 2) < 1e-6, `第一产程已走 ${P(chatState).pregnant.laborHours} 小时`);
});

// ── 模式规则与大胎 ───────────────────────────────────────
test('非真实模式：宫缩再弱也不会出现零进度回合；真实模式保留停滞', () => {
  Math.random = () => 0; // 停滞骰必中
  const gentle = laboringAt('胎体下降', [fetus(1, { descentStage: 1 })], { presentingEmbryoId: 1 });
  P(gentle).base.uterinePressure = 1;
  passHours(gentle, 0.1);
  assert.ok(P(gentle).pregnant.effectiveLaborHours > 0, '非真实模式照样推进');

  const realistic = laboringAt('胎体下降', [fetus(1, { descentStage: 1 })], { presentingEmbryoId: 1 });
  P(realistic).immune.realisticLabor = true;
  P(realistic).base.uterinePressure = 1;
  passHours(realistic, 0.1);
  assert.equal(P(realistic).pregnant.effectiveLaborHours, 0);
  assert.match(String(P(realistic).notify.secondly), /产程进展停滞/);
});

// ── 推／休：第二产程的胎体下降与娩出要产妇自己用力 ──────────────────
const pushing = (weight, pregnant = {}) => laboringAt('胎体下降', [fetus(1, { descentStage: 1, weight })], { presentingEmbryoId: 1, ...pregnant });
const effort = (chatState, action, extra = {}) => applyToolCall(chatState, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action, ...extra } });

test('推：胎越大疲劳累积越快（40 × 胎重^1.5 每小时）；活力不再自动影响下降', () => {
  Math.random = () => 0.99;
  const fatigueAfter = (weight) => { const chatState = pushing(weight); passHours(chatState, 0.25); return P(chatState).pregnant.pushFatigue; };
  assert.equal(fatigueAfter(1), 10);
  assert.ok(Math.abs(fatigueAfter(2) - 28.3) < 0.2, String(fatigueAfter(2)));
  const gainAt = (vitality) => { const chatState = pushing(2.5); P(chatState).base.vitality = vitality; passHours(chatState, 0.05); return P(chatState).pregnant.effectiveLaborHours; };
  assert.equal(gainAt(0), gainAt(200), '活力只由模型照剧情增减，不再拖慢下降');
});

test('疲劳 60 以上越推越没效果，100 时只剩 0.2；休息几乎不前进、疲劳消退', () => {
  Math.random = () => 0.99;
  const gainWith = (pregnant) => { const chatState = pushing(1, pregnant); passHours(chatState, 0.05); return P(chatState).pregnant.effectiveLaborHours; };
  const fresh = gainWith({ pushFatigue: 0 });
  const spent = gainWith({ pushFatigue: 100 });
  assert.ok(Math.abs(spent / fresh - 0.2) < 0.02, String(spent / fresh));
  const chatState = pushing(1, { pushFatigue: 80 });
  effort(chatState, 'rest');
  passHours(chatState, 0.1);
  assert.ok(P(chatState).pregnant.effectiveLaborHours < fresh * 2 * 0.15, '休息只靠宫缩，0.1 倍速');
  assert.ok(P(chatState).pregnant.pushFatigue < 80 - 15, '疲劳消退');
});

test('情压越低恢复越快；推／休只在产程中有效，胎儿不能代劳', () => {
  Math.random = () => 0.99;
  const recovered = (psyStress) => {
    const chatState = pushing(1, { pushFatigue: 60 });
    P(chatState).base.psyStress = psyStress;
    effort(chatState, 'rest');
    passHours(chatState, 1 / 6);
    return 60 - P(chatState).pregnant.pushFatigue;
  };
  assert.ok(recovered(0) > recovered(100), `平静 ${recovered(0)} 应快于紧张 ${recovered(100)}`);
  const midterm = setup('孕中期', [fetus(1)]);
  const result = effort(midterm, 'push');
  assert.equal(result.applied, false);
  assert.match(result.message, /push only works during labor/);
  assert.equal(P(midterm).pregnant.laborEffort, undefined);
  const observing = setup('第三产程', [], { laborPhase: '产后观察' });
  assert.equal(effort(observing, 'push').applied, false, '产后观察不再用力');
  const byFetus = pushing(1);
  assert.equal(effort(byFetus, 'rest', { actor: 'fetus' }).applied, false);
  assert.equal(P(byFetus).pregnant.laborEffort, undefined, '被拒绝时状态不变');
});

test('推到力竭与缓过来各通知一次；一胎开始下降时疲劳归零、回到用力', () => {
  Math.random = () => 0.99;
  const chatState = pushing(2, { pushFatigue: 55 });
  passHours(chatState, 0.1);
  assert.match(P(chatState).notify.secondly, /推不动了/);
  effort(chatState, 'rest');
  passHours(chatState, 0.5);
  assert.match(P(chatState).notify.secondly, /缓过来了/);
  assert.equal(P(chatState).pregnant.laborEffort, 'rest');
});

test('一次推进很长时，推／休阶段走到门槛就换下一阶段，不丢掉剩下的时间', () => {
  Math.random = () => 0.99;
  const chatState = pushing(1);
  passHours(chatState, 6);
  assert.notEqual(P(chatState).pregnant.laborPhase, '胎体下降', '6 小时足够走完一般胎的下降');
});

test('疼痛：大胎更痛，推到力竭再加、休息减一', () => {
  Math.random = () => 0.99;
  const painOf = (weight, pregnant = {}, rest = false) => {
    const chatState = pushing(weight, pregnant);
    if (rest) effort(chatState, 'rest');
    passHours(chatState, 0.01);
    return P(chatState).pregnant.laborPain;
  };
  assert.ok(painOf(2) - painOf(1) > 0.9, '2 倍胎重约 +1');
  assert.ok(painOf(1, { pushFatigue: 100 }) > painOf(1), '力竭更痛');
  assert.ok(painOf(1, {}, true) < painOf(1), '休息缓和');
});

test('推／休由 bsAssistFetalPosition 切换，bsUpdateCharacterStatus 只管数值；切换后一直维持', () => {
  Math.random = () => 0.99;
  const definitions = getTrackerToolDefinitions({}, {});
  const status = definitions.find((tool) => tool.name === 'bsUpdateCharacterStatus');
  assert.equal(JSON.stringify(status || {}).includes('laborEffort'), false);
  const chatState = pushing(1);
  assert.equal(effort(chatState, 'rest').applied, true);
  passHours(chatState, 0.1);
  passHours(chatState, 0.1);
  assert.equal(P(chatState).pregnant.laborEffort, 'rest', '没再切换就一直休');
  assert.equal(effort(chatState, 'push').applied, true);
  assert.equal(P(chatState).pregnant.laborEffort, 'push');
});

// ── 推／休延伸到第一、第三产程：疲劳一路带着走 ─────────────────
const firstStage = (phase = '活跃期', pregnant = {}) => {
  const chatState = setup('第一产程', [fetus(1, { descentStage: 0 })], { laborPhase: phase, pregnantDays: 280, effectivePregnantDays: 280, ...pregnant });
  P(chatState).base.uterinePressure = 60;
  return chatState;
};

test('第一产程用力是白费力气：只累积疲劳、进度照常，力竭更痛；没切换过时预设休', () => {
  Math.random = () => 0.99;
  const resting = firstStage();
  passHours(resting, 1);
  assert.equal(P(resting).pregnant.pushFatigue ?? 0, 0, '预设休，不累积疲劳');
  const pushingEarly = firstStage();
  effort(pushingEarly, 'push');
  passHours(pushingEarly, 1);
  assert.equal(P(pushingEarly).pregnant.pushFatigue, 40, '胎重 1 每小时 +40');
  assert.equal(P(pushingEarly).pregnant.effectiveLaborHours, P(resting).pregnant.effectiveLaborHours, '进度不受影响');
  assert.match(P(pushingEarly).notify.secondly, /白费力气/);
  const exhausted = firstStage('活跃期', { pushFatigue: 100 });
  effort(exhausted, 'push');
  passHours(exhausted, 0.01);
  const calm = firstStage('活跃期', { pushFatigue: 100 });
  passHours(calm, 0.01);
  assert.ok(P(exhausted).pregnant.laborPain > P(calm).pregnant.laborPain, '硬推到力竭更痛');
});

test('新的一次分娩从潜伏期开始：疲劳归零、预设休，盖掉上次分娩留下的值', () => {
  Math.random = () => 0.99;
  const chatState = setup('产兆前驱', [fetus(1, { descentStage: 0 })], { prodromalRemainingHours: 0.01, pregnantDays: 280, effectivePregnantDays: 280, laborEffort: 'push', pushFatigue: 80 });
  passHours(chatState, 0.05);
  assert.equal(P(chatState).base.stage, '第一产程');
  assert.equal(P(chatState).pregnant.laborEffort, 'rest');
  assert.equal(P(chatState).pregnant.pushFatigue, 0);
});

test('疲劳不随换阶段归零：第一产程白推的疲劳带进第二产程，下降开始时自动换成推', () => {
  Math.random = () => 0.99;
  const chatState = firstStage('过渡期', { pushFatigue: 50, laborEffort: 'rest', effectiveLaborHours: 999 });
  passHours(chatState, 0.01);
  assert.equal(P(chatState).base.stage, '第二产程');
  assert.equal(P(chatState).pregnant.laborEffort, 'push');
  assert.ok(P(chatState).pregnant.pushFatigue > 45, String(P(chatState).pregnant.pushFatigue));
});

test('间歇期预设休、用力白费；第三产程用力让胎盘快一倍，休照常', () => {
  Math.random = () => 0.99;
  const interval = laboringAt('间歇期', [fetus(1, { descentStage: -1 })], { laborEffort: 'rest', pushFatigue: 30 });
  passHours(interval, 0.05);
  assert.ok(P(interval).pregnant.pushFatigue < 30, '间歇期歇着，疲劳消退');
  const placenta = (action) => {
    const chatState = setup('第三产程', [], { laborPhase: '供养器官娩出', pregnantDays: 280, effectivePregnantDays: 280 });
    if (action) assert.equal(effort(chatState, action).applied, true);
    passHours(chatState, 0.1);
    return P(chatState).pregnant.effectiveLaborHours;
  };
  assert.ok(Math.abs(placenta('push') / placenta() - 2) < 0.01, `${placenta('push')} vs ${placenta()}`);
  assert.equal(placenta('rest'), placenta());
});

// ── 产程中的宫压是取舍：越高越快，也越痛、越难缓过来；快速通道由疲劳挡 ─────
const capOf = (chatState) => getUterinePressureCap(P(chatState));

test('降宫压有实际好处：痛感少约 2、休息消退快一倍，代价是产程变慢', () => {
  Math.random = () => 0.99;
  const run = (ratio) => {
    const chatState = pushing(1, { pushFatigue: 70 });
    effort(chatState, 'rest');
    P(chatState).base.uterinePressure = capOf(chatState) * ratio;
    passHours(chatState, 0.1);
    return P(chatState).pregnant;
  };
  const full = run(1);
  const half = run(0.5);
  assert.ok(Math.abs((half.laborPain - full.laborPain) + 2) < 0.3, `${half.laborPain} vs ${full.laborPain}`);
  assert.ok(Math.abs((70 - half.pushFatigue) / (70 - full.pushFatigue) - 2) < 0.05, `${half.pushFatigue} vs ${full.pushFatigue}`);
  assert.ok(half.effectiveLaborHours < full.effectiveLaborHours, '宫缩弱，产程慢');
});

test('快速通道：宫压满时跳一个阶段、疲劳 +30；力竭时不再突然加速', () => {
  Math.random = () => 0.99;
  const jump = (pushFatigue) => {
    const chatState = firstStage('活跃期', { pushFatigue });
    P(chatState).base.uterinePressure = capOf(chatState);
    passHours(chatState, 0.01);
    return P(chatState);
  };
  const fresh = jump(0);
  assert.equal(fresh.base.stage, '第二产程');
  assert.equal(fresh.pregnant.pushFatigue, 30);
  const second = jump(30);
  assert.equal(second.base.stage, '第二产程', '30 还能再跳一次');
  const exhausted = jump(60);
  assert.equal(exhausted.base.stage, '第一产程', '力竭时照一般速度走');
  assert.equal(exhausted.pregnant.laborPhase, '活跃期');
});

test('第三产程胎儿都生完了，推／休的工具仍送给模型；分娩结束清掉疲劳', () => {
  const chatState = setup('第三产程', [], { laborPhase: '供养器官娩出', pushFatigue: 70, laborEffort: 'push', pregnantDays: 280, effectivePregnantDays: 280 });
  const names = getTrackerToolDefinitions({}, chatState.characters).map((tool) => tool.name);
  assert.equal(names.includes('bsAssistFetalPosition'), true);
  passHours(chatState, 6);
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).pregnant.pushFatigue, undefined);
  assert.equal(P(chatState).pregnant.laborEffort, undefined);
});

test('间歇期不受推／休与胎重影响', () => {
  Math.random = () => 0.99;
  const interval = (weight) => {
    const chatState = laboringAt('间歇期', [fetus(1, { descentStage: -1, weight })]);
    P(chatState).base.vitality = 0;
    passHours(chatState, 0.05);
    return P(chatState).pregnant.effectiveLaborHours;
  };
  assert.equal(interval(2.5), interval(1));
});

// ── 真实分娩模式的硬阻塞 ─────────────────────────────────
const realisticAt = (stage, fetuses, pregnant = {}) => {
  const chatState = setup(stage, fetuses, { pregnantDays: 280, effectivePregnantDays: 280, ...pregnant });
  P(chatState).immune.realisticLabor = true;
  P(chatState).base.uterinePressure = 120;
  return chatState;
};

test('横位：真实模式下前驱领头的胎生横位胎停在子宫低位、入不了盆；非真实模式照常入盆', () => {
  const realistic = realisticAt('产兆前驱', [fetus(1, { tendencyAngle: 90 })], { prodromalRemainingHours: 10 });
  touch(realistic);
  assert.deepEqual(depths(realistic), [-1]);
  assert.equal(P(realistic).pregnant.presentingEmbryoId, null);
  const gentle = setup('产兆前驱', [fetus(1, { tendencyAngle: 90 })], { prodromalRemainingHours: 10, pregnantDays: 280, effectivePregnantDays: 280 });
  touch(gentle);
  assert.deepEqual(depths(gentle), [0]);
});

test('横位只挡胎生与卵胎生：卵生横位照常入盆', () => {
  const chatState = realisticAt('产兆前驱', [fetus(1, { tendencyAngle: 90, embryoType: '卵生' })], { prodromalRemainingHours: 10 });
  touch(chatState);
  assert.deepEqual(depths(chatState), [0]);
});

test('横位进入第二产程：胎体下降不推进、发出难产警示', () => {
  Math.random = () => 0.99;
  const chatState = realisticAt('第二产程', [fetus(1, { tendencyAngle: 90, descentStage: -1 })], {
    laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 1,
  });
  passHours(chatState, 5);
  assert.equal(P(chatState).pregnant.effectiveLaborHours, 0);
  assert.ok(depths(chatState)[0] <= 0);
  assert.equal(P(chatState).children.length, 0);
  assert.match(String(P(chatState).notify.firstly), /横位/);
});

// 间歇期：先露胎在入口 0，另一胎在 -1；Math.random 恒为 0 → 必定产生往下的意图
// 双胎互锁只有一种构型：臀位的先露胎在入口，头位的第二胎挤进来与它下巴互勾
const crowdingSetup = (over = {}, leadOver = {}) => realisticAt('第二产程', [
  fetus(1, { descentStage: 0, tendencyAngle: 180, weight: 1, ...leadOver }),
  fetus(2, { descentStage: -1, tendencyAngle: 0, weight: 0.9, affinity: -30, ...over }),
], { laborPhase: '间歇期', laborBirthNumber: 1, presentingEmbryoId: 1 });

test('双胎互锁：臀位先露胎在入口，头位、胎重相近、宫压够强的第二胎挤进来互锁，胎体下降停住；不看亲和', () => {
  Math.random = () => 0;
  const chatState = crowdingSetup();
  passHours(chatState, 3);
  assert.deepEqual(depths(chatState), [0, 0]);
  assert.equal(P(chatState).pregnant.laborPhase, '胎体下降');
  assert.equal(P(chatState).pregnant.effectiveLaborHours, 0);
  assert.match(String(P(chatState).notify.firstly), /互锁/);

  Math.random = () => 0;
  const fond = crowdingSetup({ affinity: 40 });
  passHours(fond, 3);
  assert.deepEqual(depths(fond), [0, 0], '亲近母体的第二胎一样会互锁');
});

test('蛋没有下巴可勾：卵生或胎转卵生的双胎不会互锁', () => {
  for (const embryoType of ['卵生', '胎转卵生']) {
    Math.random = () => 0;
    const chatState = crowdingSetup({ embryoType }, { embryoType });
    passHours(chatState, 3);
    assert.ok(P(chatState).pregnant.fetuses.every((f) => !f.inletIntruder), embryoType);
    assert.doesNotMatch(String(P(chatState).notify.firstly), /互锁/, embryoType);
  }
});

test('构型成立也只有 20% 的机率卡上：没抽中时第二胎留在子宫低位', () => {
  const rolls = [0, 0, 0, 0.3];
  let i = 0;
  // 前几次让它产生往下的位移，最后判定互锁时抽到 0.3（≥ 0.2）
  Math.random = () => rolls[Math.min(i++, rolls.length - 1)];
  const chatState = crowdingSetup();
  passHours(chatState, 1);
  assert.equal(depths(chatState)[1], -1);
  assert.equal('inletIntruder' in P(chatState).pregnant.fetuses[1], false);
});

test('构型不对就不会挤进入口：先露头位、或第二胎不是头位时，第二胎留在子宫低位', () => {
  for (const [label, over, leadOver] of [['先露头位', {}, { tendencyAngle: 0 }], ['第二胎臀位', { tendencyAngle: 180 }, {}]]) {
    Math.random = () => 0;
    const chatState = crowdingSetup(over, leadOver);
    passHours(chatState, 2);
    assert.equal(depths(chatState)[1], -1, label);
  }
});

for (const [label, over] of [['胎重差距过大', { weight: 0.6 }]]) {
  test(`病理性入盆的门槛未达（${label}）时留在子宫低位`, () => {
    Math.random = () => 0;
    const chatState = crowdingSetup(over);
    passHours(chatState, 1);
    assert.equal(depths(chatState)[1], -1);
  });
}

test('宫压未达上限 66% 时不会病理性入盆', () => {
  Math.random = () => 0;
  const chatState = crowdingSetup();
  P(chatState).base.uterinePressure = 90; // 上限 150 的 60%
  passHours(chatState, 1);
  assert.equal(depths(chatState)[1], -1);
});

test('互锁不会自己解开；没有构成互锁的入侵标记会被协调函数退回子宫低位', () => {
  Math.random = () => 0.05;
  const locked = realisticAt('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: 0, inletIntruder: true, affinity: 0, tendencyAngle: 0 }),
  ], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  passHours(locked, 3);
  assert.deepEqual(depths(locked), [0, 0]);

  const loose = realisticAt('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 0 }), fetus(2, { descentStage: 0, inletIntruder: true, tendencyAngle: 0 }),
  ], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  touch(loose);
  assert.deepEqual(depths(loose), [0, -1]);
  assert.equal('inletIntruder' in P(loose).pregnant.fetuses[1], false);
});

test('关闭真实模式时清掉阻塞标记，多出来的入口占用退回低位', () => {
  const chatState = setup('第一产程', [
    fetus(1, { descentStage: 0 }), fetus(2, { descentStage: 0, inletIntruder: true }),
  ], { laborPhase: '潜伏期', presentingEmbryoId: 1, pregnantDays: 280, effectivePregnantDays: 280 });
  touch(chatState);
  assert.deepEqual(depths(chatState), [0, -1]);
  assert.equal('inletIntruder' in P(chatState).pregnant.fetuses[1], false);
});

const shoulderSetup = (over = {}, base = {}) => {
  const chatState = realisticAt('第二产程', [fetus(1, { descentStage: 2, tendencyAngle: 0, ...over })], {
    laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1,
  });
  Object.assign(P(chatState).base, { uterinePressure: 150, vitality: 0, ...base });
  return chatState;
};

test('肩难产：胎生头位、到 3、宫压达上限、活力为 0 → 停在 3 不会出生，之后推进也不会', () => {
  Math.random = () => 0.99;
  const chatState = shoulderSetup();
  passHours(chatState, 2);
  assert.deepEqual(depths(chatState), [3]);
  assert.equal(P(chatState).children.length, 0);
  assert.match(String(P(chatState).notify.firstly), /肩难产/);
  P(chatState).base.vitality = 100;
  passHours(chatState, 5);
  assert.equal(P(chatState).children.length, 0, '成立后普通时间推进解不开');
});

for (const [label, over, base, realistic] of [
  ['活力未归零', {}, { vitality: 1 }, true],
  ['宫压未达上限', {}, { uterinePressure: 149 }, true],
  ['非头位', { tendencyAngle: 180 }, {}, true],
  ['卵生', { embryoType: '卵生' }, {}, true],
  ['非真实模式', {}, {}, false],
]) {
  test(`肩难产条件缺一不成立（${label}）：照常出生`, () => {
    Math.random = () => 0.99;
    const chatState = shoulderSetup(over, base);
    P(chatState).immune.realisticLabor = realistic;
    passHours(chatState, 2);
    assert.equal(P(chatState).children.length, 1);
  });
}

// ── 提示词与调试 ─────────────────────────────────────────

function promptFetusesOf(chatState) {
  const ctx = {
    chatId: 'descent-chat', characters: [], chat: [{ name: '用户', is_user: true, mes: '……' }], name1: '用户', name2: 'A',
    extensionSettings: { bs_biotracker: { enabled: true, chatStates: { 'descent-chat': chatState } } },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return buildTrackerPayload(ctx, state.getSettings(ctx)).existing_state.A.profile.pregnant.fetuses;
}

test('prompt：每胎只送位置文字，不送 descentStage 数值与内部旗标；卡住时写明', () => {
  const chatState = realisticAt('第一产程', [
    fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: 0, inletIntruder: true }), fetus(3, { descentStage: -3 }),
  ], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  touch(chatState);
  const fetuses = promptFetusesOf(chatState);
  assert.deepEqual(fetuses.map((f) => f.positionText), ['入盆', '与另一胎在入口互锁', '顶到宫顶']);
  assert.equal(fetuses[0].presenting, true);
  for (const f of fetuses) {
    for (const key of ['descentStage', 'inletIntruder', 'shoulderDystocia', 'nestedReleased', 'embryoId']) assert.equal(key in f, false, key);
  }
});

const debugSet = (chatState, args) => applyToolCall(chatState, { name: 'bsDebugSetFetalPosition', arguments: { female: 'A', ...args } });

test('调试工具：设定角度与位置，仍受阶段上限夹回', () => {
  const chatState = setup('孕晚期', [fetus(1)]);
  const result = debugSet(chatState, { fetusIndex: 0, tendencyAngle: 180, descentStage: 2 });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).pregnant.fetuses[0].tendencyAngle, 180);
  assert.equal(P(chatState).pregnant.fetuses[0].descentStage, -1, '孕期最低只到子宫低位');
});

test('调试工具：病理状态只在真实模式、先露胎已在入口、且构成互锁（先露臀位、这一胎头位）时才允许', () => {
  const gentle = setup('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: -1 })], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  assert.equal(debugSet(gentle, { fetusIndex: 1, allowPathologicalState: true }).applied, false);
  const headFirst = realisticAt('第一产程', [fetus(1, { descentStage: 0 }), fetus(2, { descentStage: -1 })], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  assert.equal(debugSet(headFirst, { fetusIndex: 1, allowPathologicalState: true }).applied, false, '先露头位不构成互锁');
  const realistic = realisticAt('第一产程', [fetus(1, { descentStage: 0, tendencyAngle: 180 }), fetus(2, { descentStage: -1 })], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  assert.equal(debugSet(realistic, { fetusIndex: 1, allowPathologicalState: true }).applied, true);
  assert.deepEqual(depths(realistic), [0, 0]);
  // 不勾病理状态时，第二胎到入口会被容量规则挡回
  const plain = realisticAt('第一产程', [fetus(1, { descentStage: 0 }), fetus(2, { descentStage: -1 })], { laborPhase: '潜伏期', presentingEmbryoId: 1 });
  debugSet(plain, { fetusIndex: 1, descentStage: 0 });
  assert.deepEqual(depths(plain), [0, -1]);
});

test('调试工具不对 Tracker 开放', () => {
  const names = getTrackerToolDefinitions({ diaryRecentLimit: 0 }, { A: { profile: { base: { stage: '第一产程' }, pregnant: { fetuses: [{ embryoId: 1 }] } } } })
    .map((tool) => tool.name);
  assert.equal(names.includes('bsDebugSetFetalPosition'), false);
  assert.equal(names.includes('bsAssistFetalPosition'), true);
});

test('同卵共用胎囊的成员在阵列中必须相邻：被拆开的会收拢到第一个成员的位置', () => {
  Math.random = () => 0.99;
  const twin = { identicalGroup: 1, tags: ['identical'] };
  const chatState = setup('孕中期', [fetus(1, twin), fetus(2), fetus(3, twin), fetus(4)]);
  touch(chatState);
  assert.deepEqual(P(chatState).pregnant.fetuses.map((f) => f.embryoId), [1, 3, 2, 4]);
});

test('左右换位以胎囊为单位：别的胎儿不会夹进同一胎囊中间，整个胎囊会一起搬', () => {
  const twin = { identicalGroup: 1, tags: ['identical'] };
  const orders = new Set();
  for (let seed = 1; seed <= 30; seed += 1) {
    Math.random = seeded(seed);
    const chatState = setup('孕中期', [fetus(1, twin), fetus(2, twin), fetus(3), fetus(4)], { pregnantDays: 130, effectivePregnantDays: 130 });
    for (let day = 0; day < 10; day += 1) {
      passDays(chatState, 1);
      const ids = P(chatState).pregnant.fetuses.map((f) => f.embryoId);
      assert.equal(Math.abs(ids.indexOf(1) - ids.indexOf(2)), 1, `胎囊被拆开：${ids.join(',')}`);
      orders.add(ids.join(','));
    }
  }
  assert.ok([...orders].some((order) => order.indexOf('3') < order.indexOf('1')), '整个胎囊应能与旁边的胎儿换位');
});

test('孕早期的胚胎不浮动，也不会发出「降到子宫低位」之类的位置通知', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    Math.random = seeded(seed);
    const chatState = setup('孕早期', [fetus(1), fetus(2, { fathers: '乙' })], { pregnantDays: 30, effectivePregnantDays: 30 });
    passDays(chatState, 1); // 先让缺省的位置栏位补齐，之后才比较有没有浮动
    const before = JSON.stringify(P(chatState).pregnant.fetuses.map((f) => [f.embryoId, f.descentStage, f.tendencyAngle, f.backSide]));
    passDays(chatState, 10);
    assert.equal(P(chatState).base.stage, '孕早期');
    assert.equal(JSON.stringify(P(chatState).pregnant.fetuses.map((f) => [f.embryoId, f.descentStage, f.tendencyAngle, f.backSide])), before);
    assert.doesNotMatch(JSON.stringify(P(chatState).notify || {}), /子宫低位|宫顶/);
  }
});

// ── 真实分娩模式：停滞与硬阻塞期间时间照样过，疲劳照样结算 ─────────
test('宫缩微弱停滞时进度不动，但休息照样消退、推照样累积', () => {
  const stalled = (action) => {
    const chatState = realisticAt('第二产程', [fetus(1, { descentStage: 1 })], { laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 1, pushFatigue: 50 });
    P(chatState).base.uterinePressure = 10;
    effort(chatState, action);
    Math.random = () => 0;
    passHours(chatState, 0.5);
    Math.random = () => 0.99;
    return P(chatState);
  };
  const resting = stalled('rest');
  assert.match(resting.notify.secondly, /产程进展停滞/);
  assert.equal(resting.pregnant.effectiveLaborHours, 0);
  assert.ok(resting.pregnant.pushFatigue < 50, String(resting.pregnant.pushFatigue));
  assert.ok(stalled('push').pregnant.pushFatigue > 50);
});

test('肩难产卡住时还在推就是白用力：疲劳累积，歇着则消退', () => {
  Math.random = () => 0.99;
  const stuck = (action) => {
    const chatState = shoulderSetup();
    passHours(chatState, 2);
    assert.deepEqual(depths(chatState), [3]);
    P(chatState).pregnant.pushFatigue = 50;
    effort(chatState, action);
    passHours(chatState, 0.5);
    return P(chatState).pregnant.pushFatigue;
  };
  assert.ok(stuck('push') > 50);
  assert.ok(stuck('rest') < 50);
});
