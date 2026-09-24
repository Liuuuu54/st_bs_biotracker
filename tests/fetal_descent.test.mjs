// descentStage 的资料层：各阶段上限、新胎起点、以及 reconcileFetalDescent 维持的空间不变量。
// -3 宫顶、-2 宫内自由、-1 子宫低位、0 入盆、1 进入产道、2 着冠、3 先露部已出。
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
    const chatState = setup('孕早期', originals, { pregnantDays: 40, effectivePregnantDays: 40 });
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

test('分娩抵抗的大幅转动只落在高位胎儿，已入盆的领头胎儿不被转', () => {
  Math.random = () => 0; // 抵抗判定与转动都走得到
  const chatState = setup('产兆前驱', [fetus(1, { tendencyAngle: 0 }), fetus(2, { tendencyAngle: 0 })], {
    prodromalRemainingHours: 10, prodromalLeadEmbryoId: 1,
  });
  P(chatState).base.vitality = 0;
  touch(chatState);
  const result = applyToolCall(chatState, { name: 'bsMaternalFetalInteraction', arguments: { female: 'A', direction: 'maternal' } });
  assert.equal(result.applied, true, result.message);
  const lead = P(chatState).pregnant.fetuses.find((f) => f.embryoId === 1);
  assert.equal(lead.tendencyAngle, 0);
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
