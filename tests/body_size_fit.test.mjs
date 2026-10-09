// 体型第二段：个体体型、插入时的体型契合、精液纪录与胎儿的父方体型、注册抽样。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { applyRegistryResult } from '../scripts/registry.js';
import { buildLineageGraph } from '../scripts/lineage.js';
import { describeBodySizeFit, getAltFormBodySize, getBodySizeWeightRatio, getExpectedBodySize, resolveBodySize, sampleBodySize } from '../scripts/body_size.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function chatWith(baseOver = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters['冒险者'] = {
    name: '冒险者', initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 3, isHere: true, age: 22, race: '人类', bodySize: 4,
        vitality: 100, libido: 20, uterinePressure: 0, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
        ...baseOver,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 0.2 },
      pregnant: { fetuses: [], fetusesCount: 0 },
      experience: {}, immune: {}, metabolism: {}, cooldown: {},
      skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters['冒险者'].profile;
const insert = (chatState, args) => applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '冒险者', action: 'insert', amount: 0, ...args } });
const deposit = (chatState, args) => applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '冒险者', action: 'deposit', amount: 20, ...args } });

test('抽样：按种族分布抽一位小数并截在 1–7；可变与依个体抽不出来', () => {
  assert.equal(sampleBodySize({ bodySize: 4, bodySizeSd: 0.4 }, () => 0.5), 3.5); // u=v=0.5：√(2ln2)·cos(π) ≈ −1.18 → 4 − 0.47
  const sequence = [0.000001, 0.5];
  assert.equal(sampleBodySize({ bodySize: 1, bodySizeSd: 0.4 }, () => sequence.shift()), 1); // 约 −5.3σ，截在 1
  assert.equal(sampleBodySize({ bodySize: null }), null);
  assert.equal(sampleBodySize({ bodySize: 'individual' }), null);
});

test('依个体的父母以个体体型代入：一人高的大蟑螂与人类的孩子不会被算成纯人类体型', () => {
  assert.deepEqual(getExpectedBodySize('独居虫族x人类'), { bodySize: 4, bodySizeSd: 0.4, altFormBodySize: null });
  const withFather = getExpectedBodySize('独居虫族x人类', null, [{ race: '独居虫族-蟑螂', bodySize: 5 }, { race: '人类', bodySize: 3.8 }]);
  assert.equal(withFather.bodySize, 4.5);
});

test('变化态沿用个体偏差：比龙族平均高 0.6 的龙娘，真身截在 7', () => {
  const dragon = resolveBodySize({ race: '西方龙', bodySize: 4.6 });
  assert.equal(getAltFormBodySize(dragon), 7);
  const fairy = resolveBodySize({ race: '妖精', bodySize: 0.8 });
  assert.equal(fairy.size, 1);
  assert.equal(getAltFormBodySize(fairy), 4);
  assert.equal(getAltFormBodySize(resolveBodySize({ race: '人类', bodySize: 4 })), null);
});

test('体型差分段：方向决定写「容纳」还是「充实」', () => {
  const fixed = (size) => ({ kind: 'fixed', size });
  assert.equal(describeBodySizeFit({ female: fixed(4), male: fixed(4.3) }).label, '恰好契合');
  assert.match(describeBodySizeFit({ female: fixed(4), male: fixed(6) }).text, /明显不合，精方较大，伴随不适与撑胀/);
  assert.match(describeBodySizeFit({ female: fixed(4), male: fixed(2) }).text, /明显不合，卵方较大，难以充实/);
  assert.match(describeBodySizeFit({ female: fixed(1), male: fixed(6) }).text, /体型悬殊，精方较大，几乎不可能容纳/);
  assert.equal(describeBodySizeFit({ female: fixed(4), male: { kind: 'variable' } }).label, '恰好契合');
  assert.equal(describeBodySizeFit({ female: fixed(4), male: { kind: 'unknown' } }), null);
  assert.equal(describeBodySizeFit({ female: fixed(1), male: fixed(6), sizeBridge: true }).bridged, true);
});

test('bsAddSperm 有体型参数，插入时结算契合并进次级提示', () => {
  const schema = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsAddSperm').input_schema.properties;
  for (const key of ['maleBodySize', 'femaleAltForm', 'maleAltForm', 'sizeBridge']) assert.ok(schema[key], key);

  const chatState = chatWith();
  const result = insert(chatState, { male: '巨魔', race: '巨人' });
  assert.equal(result.applied, true);
  assert.match(result.message, /明显不合，精方较大/);
  assert.equal(P(chatState).base.penetrationFit.label, '明显不合');
  assert.match(P(chatState).notify.secondly, /体型契合：明显不合/);
});

test('依个体又没给体型：不结算契合，只在回传讯息说明', () => {
  const chatState = chatWith();
  const result = insert(chatState, { male: '大蟑螂', race: '独居虫族-蟑螂' });
  assert.match(result.message, /精方体型未知/);
  assert.equal(P(chatState).base.penetrationFit, null);
  assert.ok(!String(P(chatState).notify.secondly || '').includes('体型契合'));
});

test('恰好契合不打扰叙述；变身或消弭体型差才进次级提示', () => {
  const plain = chatWith();
  insert(plain, { male: '大蟑螂', race: '独居虫族-蟑螂', maleBodySize: 4.2 });
  assert.equal(P(plain).base.penetrationFit.label, '恰好契合');
  assert.ok(!String(P(plain).notify.secondly || '').includes('体型契合'));

  const fairy = chatWith({ race: '妖精', bodySize: 1 });
  insert(fairy, { male: '骑士', race: '人类', femaleAltForm: true });
  assert.equal(P(fairy).base.penetrationFit.label, '恰好契合');
  assert.match(P(fairy).notify.secondly, /卵方 4 级（变化态）/);

  const bridged = chatWith({ race: '妖精', bodySize: 1 });
  insert(bridged, { male: '巨魔', race: '巨人', sizeBridge: true });
  assert.match(P(bridged).notify.secondly, /消弭体型差/);
});

test('没有变化态的一方传了变化态：按常态计算并说明', () => {
  const chatState = chatWith();
  const result = insert(chatState, { male: '骑士', race: '人类', maleAltForm: true });
  assert.match(result.message, /精方没有可用的变化态，按常态计算/);
});

test('射精把个体体型记在精液纪录，受孕时存进胎儿的父方体型；拔出清除契合', () => {
  const chatState = chatWith({ stage: '排卵期', days: 0, eggs: 1 });
  insert(chatState, { male: '大蟑螂', race: '独居虫族-蟑螂', maleBodySize: 4.5 });
  deposit(chatState, { male: '大蟑螂', race: '独居虫族-蟑螂' });
  assert.equal(P(chatState).base.sperms[0].bodySize, 4.5);
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '冒险者', male: '大蟑螂', race: '独居虫族-蟑螂', action: 'withdraw', amount: 0 } });
  assert.equal(P(chatState).base.penetrationFit, null);

  Math.random = () => 0;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  const fetus = P(chatState).pregnant.fetuses[0];
  assert.ok(fetus, '应已受精');
  assert.equal(fetus.fatherBodySize, 4.5);
});

test('注册：模型给的体型优先；没给按种族抽；孩子注册代入依个体父亲的体型', () => {
  const given = state.createEmptyChatState();
  applyRegistryResult(given, { name: '八尺', profile: { base: { race: '人类', age: 30, bodySize: 5.3 } } }, { random: () => 0.25 });
  assert.equal(given.characters['八尺'].profile.base.bodySize, 5.3);

  const sampled = state.createEmptyChatState();
  applyRegistryResult(sampled, { name: '路人', profile: { base: { race: '人类', age: 20 } } }, { random: () => 0.25 });
  assert.equal(sampled.characters['路人'].profile.base.bodySize, 4); // cos(π/2)=0 → 平均值

  const slime = state.createEmptyChatState();
  applyRegistryResult(slime, { name: '史莱姆娘', profile: { base: { race: '史萊姆', age: 3 } } }, { random: () => 0.25 });
  assert.equal(slime.characters['史莱姆娘'].profile.base.bodySize, null);

  const child = state.createEmptyChatState();
  applyRegistryResult(child, { name: '虫娘', profile: { base: { race: '独居虫族x人类', age: 18 } } }, {
    random: () => 0.25,
    bodySizeParents: [{ race: '独居虫族-蟑螂', bodySize: 5 }, { race: '人类', bodySize: 4 }],
  });
  assert.equal(child.characters['虫娘'].profile.base.bodySize, 4.5);
});

test('受精胎重的体型系数：每差一级 2^0.25，截在 0.5–2；资料不全回传 null', () => {
  const human = { race: '人类', bodySize: 4 };
  assert.equal(getBodySizeWeightRatio(human, { race: '人类', bodySize: 4 }), 1);
  assert.equal(getBodySizeWeightRatio(human, { race: '巨人', bodySize: 6 }), Math.SQRT2);
  assert.equal(getBodySizeWeightRatio({ race: '半身人', bodySize: 2 }, { race: '巨人', bodySize: 7 }), 2);
  assert.equal(getBodySizeWeightRatio(human, { race: '史萊姆' }), null);
  assert.equal(getBodySizeWeightRatio(human, { race: '独居虫族' }), null);
});

test('受精胎重：有体型看体型差，没有就退回承载耐受，两套都在 0.5–2', () => {
  const conceive = (race, bodySize = null) => {
    const chatState = chatWith({ stage: '排卵期', days: 0, eggs: 1, sperms: [{ male: '父', race, bodySize, value: 30 }] });
    P(chatState).bio.breedTolerance = 1;
    Math.random = () => 0;
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
    Math.random = REAL_RANDOM;
    return P(chatState).pregnant.fetuses[0].weight;
  };
  // 巨人父亲（+2 级）系数 √2、哥布林父亲（−2 级）1/√2：同样乱数下胎重差 2 倍
  assert.ok(Math.abs(conceive('巨人') / conceive('哥布林') - 2) < 1e-9);
  // 依个体又没记体型：走承载耐受；补上体型后改走体型差
  assert.ok(Math.abs(conceive('独居虫族', 6) / conceive('人类') - Math.SQRT2) < 1e-9);
  // 史莱姆体型可变：走承载耐受 2^强弱，仍在 0.5–2 之内
  const slimeRatio = conceive('史萊姆') / conceive('人类');
  assert.ok(slimeRatio > 1 && slimeRatio <= 2);
});

test('族谱：路人父亲带上子女记录的体型，已注册角色带个体体型', () => {
  const chatState = chatWith();
  P(chatState).children = [{ id: 'c1', name: '虫仔', fathers: '大蟑螂', fatherRace: '独居虫族-蟑螂', fatherBodySize: 4.5, race: '独居虫族x人类', gender: '男', age: 0 }];
  const graph = buildLineageGraph(chatState);
  assert.equal(graph.nodes.find((node) => node.id === 'name:大蟑螂').bodySize, 4.5);
  assert.equal(graph.nodes.find((node) => node.id === 'char:冒险者').bodySize, 4);
});

test('追踪提示的依个体名单跟着百科覆写走，写实世界不送', async () => {
  const { buildTrackerSystemPrompt } = await import('../scripts/tracker_prompt_context.js');
  const { setRacePhysiologyOverrides } = await import('../scripts/race_config.js');
  const note = (payload = {}) => buildTrackerSystemPrompt('', null, payload).split('\n').find((line) => line.includes('必须按剧情传 maleBodySize')) || '';
  assert.match(note(), /怪兽类.*独居虫族.*心魇/);
  try {
    setRacePhysiologyOverrides({ 怪兽类: { bodySize: 5, bodySizeSd: 1 }, 人类: { bodySize: 'individual' } });
    assert.ok(!note().includes('怪兽类'));
    assert.ok(note().includes('人类'));
  } finally {
    setRacePhysiologyOverrides({});
  }
  assert.equal(note({ realistic_world: true }), '');
});
