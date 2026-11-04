import assert from 'node:assert/strict';
import test from 'node:test';
import * as state from '../scripts/state.js';
import { applyToolCall, canDormancyOvulate, getForeignSemenShare, getConceptionWeight } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { getRacePhysiologyProfile } from '../scripts/race_config.js';
import { normalizeSireRecord } from '../scripts/sires.js';

// 两种模式均经过真实工具分发器；独立期望不读取汇总首行来代替物理接触快照。
const DAY = 1440;
const copy = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, eps = 2e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const profile = (chat) => chat.characters['母方'].profile;
const base = (chat) => profile(chat).base;
const call = (chat, name, args) => {
  const result = applyToolCall(chat, { name, arguments: args });
  assert.equal(result.applied, true, result.message);
  return result;
};
const pass = (chat, minute) => call(chat, 'bsPassedTime', { minute });
function setup(pooled, { race = '精灵', eggs = 0, seed = '乏情原生验收' } = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('母方');
  mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race, bodySize: 4, stage: '乏情期', days: 10,
    eggs, vitality: 100, libido: 0, psyStress: 0, isHere: false });
  Object.assign(mother.profile.bio, getRacePhysiologyProfile(race), { orgasmOvulationAmount: 1, identicalProbability: 0 });
  mother.profile.immune.metabolism = true;
  mother.runtime = { dayCarryMinutes: 0, hourCarryMinutes: 0, lifestyleWeekCarryMinutes: 0 };
  chat.characters['母方'] = mother;
  if (pooled) enablePooledConception(mother.profile.base, 0, { seed });
  return chat;
}
function deposit(chat, male, race, amount) {
  chat.sires[male] = normalizeSireRecord({ race, spermQuality: 1, bodySize: 4 });
  call(chat, 'bsAddSperm', { female: '母方', male, race, action: 'insert', amount: 0 });
  call(chat, 'bsAddSperm', { female: '母方', male, race, action: 'deposit', amount });
}
function fixedRandom(draw, operation) {
  const original = Math.random;
  Math.random = typeof draw === 'function' ? draw : () => draw;
  try { return operation(); } finally { Math.random = original; }
}
const climax = (chat) => fixedRandom(0.01, () => call(chat, 'bsUpdateCharacterStatus', { female: '母方', options: { orgasm: true } }));

for (const pooled of [false, true]) {
  const mode = pooled ? '混合池' : '默认';
  test(`${mode}乏情期没有自然排卵，现存卵仍按日过期`, () => {
    const chat = setup(pooled, { eggs: 2 });
    pass(chat, DAY / 2);
    assert.equal(base(chat).eggs, 2);
    pass(chat, DAY / 2);
    assert.equal(base(chat).eggs, 1);
    pass(chat, DAY);
    assert.equal(base(chat).eggs, 0);
    pass(chat, DAY * 3);
    assert.equal(base(chat).eggs, 0);
    assert.equal(base(chat).stage, '乏情期');
  });

  for (const [label, foreignAmount, sameAmount, expected] of [
    ['同族满池', 0, 125, false], ['异种少量', 5, 0, false],
    ['满池79.9%异种', 99.875, 25.125, false], ['满池80%异种', 100, 25, true],
  ]) {
    test(`${mode}真实高潮诱发门槛：${label}`, () => {
      const chat = setup(pooled);
      if (sameAmount > 0) deposit(chat, '同族父方', '精灵', sameAmount);
      if (foreignAmount > 0) deposit(chat, '异族父方', '人类', foreignAmount);
      const total = foreignAmount + sameAmount;
      near(getForeignSemenShare(profile(chat)), total > 0 ? foreignAmount / total : 0);
      assert.equal(canDormancyOvulate(profile(chat)), expected);
      climax(chat);
      assert.equal(base(chat).eggs, expected ? 1 : 0);
      assert.equal(base(chat).stage, '乏情期');
      if (expected) assert.equal(profile(chat).cooldown.orgasmOvulationUsed, true);
    });
  }

  test(`${mode}血脉重叠按真实份额计算：衍生同族为零，半精灵为一半`, () => {
    for (const [race, share] of [['[血族]精灵', 0], ['精灵x人类', 0.5]]) {
      const chat = setup(pooled);
      deposit(chat, '父方', race, 125);
      near(getForeignSemenShare(profile(chat)), share);
      assert.equal(canDormancyOvulate(profile(chat)), false);
      climax(chat);
      assert.equal(base(chat).eggs, 0);
    }
  });

  test(`${mode}同名父方先精灵后人类仍按两份物理快照计算80%异种`, () => {
    const chat = setup(pooled);
    deposit(chat, '同一父方', '精灵', 25);
    deposit(chat, '同一父方', '人类', 100);
    const contacts = base(chat).spermContacts.filter((source) => source.value > 0);
    assert.equal(contacts.length, 2);
    assert.deepEqual(contacts.map((source) => source.race), ['精灵', '人类']);
    near(contacts[0].value, 25);
    near(contacts[1].value, 100);
    assert.equal(base(chat).sperms.length, 1, '面板同父汇总不是生物学输入');
    near(getForeignSemenShare(profile(chat)), 0.8);
    assert.equal(canDormancyOvulate(profile(chat)), true);
    climax(chat);
    assert.equal(base(chat).eggs, 1);
    assert.equal(base(chat).stage, '乏情期');
  });

  test(`${mode}同名父方先人类79%后精灵21%不被汇总快照误判为全异种`, () => {
    const chat = setup(pooled);
    deposit(chat, '同一父方', '人类', 98.75);
    deposit(chat, '同一父方', '精灵', 26.25);
    near(getForeignSemenShare(profile(chat)), 0.79);
    assert.equal(canDormancyOvulate(profile(chat)), false);
    climax(chat);
    assert.equal(base(chat).eggs, 0);
  });

  test(`${mode}失活残留仍按物理体积触发灌满及异种门槛，但不贡献受精风险`, () => {
    const chat = setup(pooled);
    deposit(chat, '同族父方', '精灵', 25);
    deposit(chat, '异族父方', '人类', 100);
    for (const source of base(chat).spermContacts) source.blocked = true;
    near(getForeignSemenShare(profile(chat)), 0.8);
    assert.equal(canDormancyOvulate(profile(chat)), true);
    climax(chat);
    assert.equal(base(chat).eggs, 1);
    pass(chat, 1);
    assert.deepEqual(profile(chat).pregnant.fetuses, []);
    assert.equal(base(chat).eggs, 1);
  });

  test(`${mode}手动进入乏情期重置本季与高潮冷却，下一次满足条件可排卵`, () => {
    const chat = setup(pooled);
    Object.assign(base(chat), { stage: '黄体期', seasonCycle: 1 });
    Object.assign(profile(chat).cooldown, { orgasmOvulationUsed: true, lutealOrgasmRefreshed: true });
    call(chat, 'bsSetMenstrualPhases', { female: '母方', stage: '乏情期' });
    assert.equal(base(chat).stage, '乏情期');
    assert.equal(base(chat).seasonCycle, 0);
    assert.equal(profile(chat).cooldown.orgasmOvulationUsed, false);
    assert.equal(profile(chat).cooldown.lutealOrgasmRefreshed, false);
    deposit(chat, '异族父方', '人类', 125);
    climax(chat);
    assert.equal(base(chat).eggs, 1);
  });
}

// 独立复现已公开的固定胎儿随机通道；只用于断言一次性初重，不替换生产随机入口。
function fetusRandom(seed, eggId) {
  let value = 2166136261;
  for (const ch of `${seed}:fetus:${eggId}`) value = Math.imul(value ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

for (const pooled of [false, true]) {
  const mode = pooled ? '混合池' : '默认';
  test(`${mode}仍处乏情期时受精，初重使用0.6阶段系数而不是改成排卵期`, () => {
    const chat = setup(pooled, { race: '精灵', eggs: 1, seed: '乏情初重固定通道' });
    deposit(chat, '精灵父方', '精灵', 20);
    if (pooled) for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
    fixedRandom(0, () => pass(chat, 1));
    assert.equal(base(chat).stage, '乏情期');
    const embryo = profile(chat).pregnant.fetuses[0];
    assert.ok(embryo, '乏情期已有卵与可受精材料时真实工具应创建胚胎');
    let random = () => 0;
    if (pooled) {
      random = fetusRandom(base(chat).spermPool.seed, embryo.pooledConception.eggId);
      const gender = random() < 0.45 ? '男' : '女';
      assert.equal(embryo.gender, gender);
    }
    const expected = getConceptionWeight('乏情期', embryo.gender, 1, random);
    near(pooled ? embryo.pooledConception.initialWeight : embryo.weight, expected);
    const ovulationRandom = pooled ? fetusRandom(base(chat).spermPool.seed, embryo.pooledConception.eggId) : () => 0;
    if (pooled) ovulationRandom();
    near(expected / getConceptionWeight('排卵期', embryo.gender, 1, ovulationRandom), 0.6);
  });

  test(`${mode}天使着床只等待活动周期的9日，322日乏情不计入产科偏移`, () => {
    const chat = setup(pooled, { race: '天使', eggs: 1 });
    deposit(chat, '天使父方', '天使', 20);
    if (pooled) for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
    const receipt = fixedRandom(0, () => pass(chat, 1));
    assert.ok(profile(chat).pregnant.fetuses.length > 0);
    const start = pooled ? receipt.conceptionEvents[0].atMinute : 0;
    const due = start + 9 * DAY;
    fixedRandom(0.5, () => pass(chat, due - chat.minutesPassed - 0.25));
    assert.equal(base(chat).stage, '乏情期');
    assert.equal(profile(chat).pregnant.effectivePregnantDays, 0);
    fixedRandom(0.5, () => pass(chat, 0.75));
    assert.equal(base(chat).stage, '孕早期');
    // 活动周期42日的一半为21；孕速0.8，曲线封顶公式使用(9+21)*0.8而非全年364日。
    const initial = 98 * 24 / (24 + 98 - 20);
    near(profile(chat).pregnant.effectivePregnantDays, initial + 0.5 / DAY * 0.8);
    near(profile(chat).pregnant.pregnantDays, initial / 0.8 + 0.5 / DAY);
    assert.ok(profile(chat).pregnant.effectivePregnantDays < 30);
  });
}

test('混合池乏情每日失卵仅移除最老身份，幸存卵预算不重抽，JSON后仍一致', () => {
  let chat = setup(true, { eggs: 3 });
  pass(chat, DAY / 2);
  const original = copy(base(chat).spermPool.eggs);
  chat = copy(chat);
  pass(chat, DAY / 2);
  assert.deepEqual(base(chat).spermPool.eggs, original.slice(1));
  chat = copy(chat);
  pass(chat, DAY);
  assert.deepEqual(base(chat).spermPool.eggs, original.slice(2));
  assert.equal(base(chat).spermPool.eggSequence, 3);
});
