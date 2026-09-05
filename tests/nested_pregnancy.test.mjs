// 孕中孕：异期受精的那一颗落进另一颗胎儿体内，成为胎中胎。
// 走同一条高潮排卵的异期路径，额外三个条件同时成立才会触发。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, isFetusKnownToCharacter } from '../scripts/tools.js';
import { buildLineageView } from '../scripts/lineage_view.js';
import { deriveFetusTags } from '../scripts/fetus_tags.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (over = {}) => ({
  embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, affinity: 0, ...over,
});

/**
 * @param opts.effectiveDays 共用时钟；孕中孕视窗是 56-84
 * @param opts.sperm 子宫内精液总量；孕中孕要 > 100
 * @param opts.hosts 已在体内的胎儿
 */
function one({ effectiveDays = 60, sperm = 150, hosts = [fetus({ weight: 1.6 })] } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters['A'] = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage: '孕早期', days: 0, isHere: true, age: 24, race: '人类',
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4,
        eggs: 1, sperms: sperm > 0 ? [{ male: '乙', race: '人类', value: sperm }] : [],
        fertilizationDays: 0, latestSexDays: -1,
      },
      bio: {
        birthDifficulty: 1, breedTolerance: 1,
        impregnationDifficulty: 0.2, identicalProbability: 0,
      },
      pregnant: {
        pregnantDays: effectiveDays, effectivePregnantDays: effectiveDays,
        fetusesCount: hosts.length, fetalEnergyDrain: 0.2, amnionDurability: 100,
        fetuses: hosts,
      },
      experience: {}, immune: {}, metabolism: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters['A'].profile;
const step = (chatState) => applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
const nestedOf = (chatState) => P(chatState).pregnant.fetuses.find((f) => f.nestedInEmbryoId);
const lateOf = (chatState) => P(chatState).pregnant.fetuses.find((f) => f.conceivedAtDays !== undefined);

/** 让这一拍必定受精，之后交还真实随机 */
function conceiveOnce(chatState) {
  Math.random = () => 0;
  step(chatState);
  Math.random = REAL_RANDOM;
  P(chatState).base.sperms = [];
  P(chatState).base.eggs = 0;
}

test('三个条件同时成立才会变成孕中孕', () => {
  const chatState = one();
  conceiveOnce(chatState);
  const nested = nestedOf(chatState);
  assert.ok(nested, '应触发孕中孕');
  assert.equal(nested.nestedInEmbryoId, 1, '指向宿主胎儿的 embryoId');
  assert.equal(nested.pendingImplantation, true);
  assert.deepEqual(
    deriveFetusTags(nested, { carrierName: 'A' }).sort(),
    ['nested', 'superfetation'].sort(),
    '它同时也是异期胎，两个标签都要带',
  );
});

test('视窗未到 8 周时只是普通异期胎', () => {
  const chatState = one({ effectiveDays: 40 });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState), undefined, '不该套进胎儿里');
  assert.ok(lateOf(chatState), '但异期受精本身仍成立');
});

test('宿主胎重不足 1.5 时只是普通异期胎', () => {
  const chatState = one({ hosts: [fetus({ weight: 1.4 })] });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState), undefined);
  assert.ok(lateOf(chatState));
});

test('精液不超过 100 时只是普通异期胎', () => {
  const chatState = one({ sperm: 100 });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState), undefined);
  assert.ok(lateOf(chatState));
});

test('宿主取最重的一胎', () => {
  const chatState = one({
    hosts: [
      fetus({ embryoId: 1, weight: 1.6, gender: '男' }),
      fetus({ embryoId: 2, weight: 2.0, gender: '男' }),
      fetus({ embryoId: 3, weight: 1.5, gender: '男' }),
    ],
  });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState).nestedInEmbryoId, 2, '2 号最重');
});

test('同重时优先挑女胎', () => {
  const chatState = one({
    hosts: [
      fetus({ embryoId: 1, weight: 1.8, gender: '男' }),
      fetus({ embryoId: 2, weight: 1.8, gender: '女' }),
    ],
  });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState).nestedInEmbryoId, 2, '同重该挑女胎');
});

test('待著床的胚胎不能当宿主', () => {
  const chatState = one({
    hosts: [
      fetus({ embryoId: 1, weight: 1.6 }),
      fetus({ embryoId: 2, weight: 2.5, pendingImplantation: true, conceivedAtDays: 50 }),
    ],
  });
  conceiveOnce(chatState);
  assert.equal(nestedOf(chatState).nestedInEmbryoId, 1, '更重的那颗还没著床，不该被选中');
});

test('孕中孕藏到孕晚期才揭晓，比一般异期胎晚一整个孕中期', () => {
  const chatState = one({
    effectiveDays: 80, sperm: 0,
    hosts: [
      fetus({ embryoId: 1, weight: 1.6 }),
      fetus({ embryoId: 2, fathers: '乙', conceivedAtDays: 60, nestedInEmbryoId: 1, tags: ['superfetation', 'nested'] }),
    ],
  });
  // 进入孕中期：一般异期胎在这里就会揭晓，孕中孕不会
  while (P(chatState).base.stage === '孕早期') step(chatState);
  assert.equal(P(chatState).base.stage, '孕中期');
  assert.equal(nestedOf(chatState).revealed, undefined, '孕中期还不该揭晓');
  assert.equal(P(chatState).pregnant.fetuses.filter(isFetusKnownToCharacter).length, 1);

  while (P(chatState).pregnant.effectivePregnantDays < 190) step(chatState);
  assert.equal(nestedOf(chatState).revealed, true, '到孕晚期才揭晓');
  assert.equal(P(chatState).pregnant.fetuses.filter(isFetusKnownToCharacter).length, 2);
});

test('宿主被减胎时，套在里面的一起消失', () => {
  const chatState = one({
    effectiveDays: 100, sperm: 0,
    hosts: [
      fetus({ embryoId: 1, weight: 1.6 }),
      fetus({ embryoId: 2, fathers: '乙', conceivedAtDays: 60, nestedInEmbryoId: 1, revealed: true, tags: ['nested'] }),
      fetus({ embryoId: 3, fathers: '丙' }),
    ],
  });
  P(chatState).base.stage = '孕中期';
  const result = applyToolCall(chatState, { name: 'bsAbortion', arguments: { female: 'A', fetusIndex: 0 } });
  assert.equal(result.applied, true, result.message);
  const left = P(chatState).pregnant.fetuses.map((f) => f.embryoId);
  assert.deepEqual(left, [3], '宿主与被套的都该消失，无关的那胎留着');
});

test('出生后母亲解析成宿主孩子的稳定 id，血缘图上母亲是同胎手足', () => {
  let built = null;
  for (let run = 0; run < 20 && !built; run += 1) {
    const chatState = one();
    conceiveOnce(chatState);
    if (!nestedOf(chatState)) continue;
    for (let i = 0; i < 500 && P(chatState).base.stage !== '产后恢复'; i += 1) step(chatState);
    if (P(chatState).children.length === 2) built = chatState;
  }
  assert.ok(built, '二十轮内应有一次顺利生下两个孩子');

  const children = P(built).children;
  const nestedChild = children.find((c) => c.nestedInEmbryoId);
  const hostChild = children.find((c) => c !== nestedChild);
  assert.ok(nestedChild, '应有一个孩子带孕中孕来历');
  assert.equal(nestedChild.nestedInChildId, hostChild.id, '母亲要解析成宿主孩子的稳定 id');
  assert.equal(hostChild.birthEmbryoId, nestedChild.nestedInEmbryoId);

  applyToolCall(built, {
    name: 'bsNameChild',
    arguments: { female: 'A', childIndex: children.indexOf(hostChild), name: '宿主女' },
  });
  const view = buildLineageView(built, 'A');
  const nestedNode = view.nodes.find((node) => node.childId === nestedChild.id);
  assert.deepEqual(
    nestedNode.geneticParents.map((p) => `${p.relation} ${p.name}`).sort(),
    ['母 宿主女', '父 乙'].sort(),
    '母亲是同胎的宿主孩子，不是承载者',
  );
  assert.deepEqual(nestedNode.carriers.map((c) => c.name), ['A'], '承载者另外列');
});
