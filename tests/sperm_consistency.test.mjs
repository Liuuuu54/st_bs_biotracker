import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { afterEach } from 'node:test';
import { calculateFertilizationPreview, calculateSpermSourceExposures } from '../scripts/calculator.js';
import { getSpermSources, getSpermSnapshotAmount, setSpermSources } from '../scripts/sperm_sources.js';
import { applyToolCall } from '../scripts/tools.js';
import { getUterusVolumeFactor } from '../scripts/body_size.js';
import { MENSTRUAL_STAGES } from '../scripts/stage_config.js';
import { normalizeSireRecord } from '../scripts/sires.js';
import { applyRegistryResult } from '../scripts/registry.js';
import { createEmptyChatState, createDefaultFemaleState, recordChatStateSnapshot, getSnapshotCharacter } from '../scripts/state.js';

const originalRandom = Math.random;
afterEach(() => { Math.random = originalRandom; });
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), `${message}: ${actual} / ${expected}`);
const sum = (sources) => sources.reduce((total, source) => total + source.value, 0);
const chance = (sources, options = {}) => calculateFertilizationPreview({ spermSources: sources, ...options });
const weights = (preview) => {
  const result = {};
  for (const source of preview.sources) result[source.male] = (result[source.male] || 0) + source.winnerWeight;
  return result;
};
const source = (value, patch = {}) => ({ male: 'A', race: '人类', quality: 1, value, ...patch });
const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
function setup(sources, { race = '人类', eggs = 1, crossSpecies = false } = {}) {
  const chat = createEmptyChatState();
  const female = createDefaultFemaleState('F');
  female.initialized = true;
  Object.assign(female.profile.base, { race, bodySize: 4, stage: '卵泡期', days: 0, age: 24, eggs, vitality: 100, psyStress: 0, libido: 0, uterinePressure: 0 });
  female.profile.immune.crossSpecies = crossSpecies;
  female.profile.bio.impregnationDifficulty = 1;
  female.profile.pregnant.fetuses = [];
  setSpermSources(female.profile.base, sources);
  chat.characters.F = female;
  return chat;
}
const profile = (chat) => chat.characters.F.profile;
const deposit = (chat, amount = 20, male = 'A') => {
  assert.equal(call(chat, 'bsAddSperm', { female: 'F', male, race: '人类', action: 'insert', amount: 0 }).applied, true);
  const result = call(chat, 'bsAddSperm', { female: 'F', male, race: '人类', action: 'deposit', amount });
  assert.equal(result.applied, true, result.message);
};

// 执行实际面板内的预览表达式，而不是在测试中另写一份计算路径；不冒充浏览器端到端。
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const previewBlock = indexSource.slice(indexSource.indexOf("  const stage = String(base.stage || '未设定');", indexSource.indexOf('const intimacyRanking = getIntimacyRanking(profile')));
const panelPreview = new Function('base', 'bio', 'immune', 'MENSTRUAL_STAGES', 'getUterusVolumeFactor', 'calculateFertilizationPreview', 'getSpermSources',
  previewBlock.slice(0, previewBlock.indexOf('  const rawFetuses =')) + '\nreturn conceptionPreview;');
const panel = (p) => panelPreview(p.base, p.bio, p.immune, MENSTRUAL_STAGES, getUterusVolumeFactor, calculateFertilizationPreview, getSpermSources);

for (const quality of [0.25, 1, 4]) {
  for (const elapsedDays of [0.1, 1, 20]) {
    test(`同父同品质拆分保留概率及暴露：q=${quality}，天数=${elapsedDays}`, () => {
      const whole = chance([source(20, { quality })], { elapsedDays });
      const split = chance([source(10, { quality }), source(10, { quality })], { elapsedDays });
      close(split.successChance, whole.successChance);
      close(split.totalExposureAmountDays, whole.totalExposureAmountDays);
      close(split.effectiveExposureDays, whole.effectiveExposureDays);
      close(split.sources.reduce((n, row) => n + row.winChance, 0), whole.successChance);
      assert.equal(split.sources.length, 2, '独立来源仍各自返回');
    });
  }
}

test('保留单来源原校准：人类20一天约22.88%，不是引入新风险积分', () => {
  const preview = chance([source(20)]);
  close(preview.successChance, 1 - Math.exp(-0.3 * Math.sqrt(15 / 20)));
  close(preview.totalExposureAmountDays, 15);
});

test('拆其中一位父方不改变总率或父方权重，排列也无影响', () => {
  const whole = chance([source(40), source(20, { male: 'B', race: '精灵', quality: 4 })]);
  const splitSources = [source(10), source(20, { male: 'B', race: '精灵', quality: 4 }), source(10), source(20)];
  for (const records of [splitSources, [...splitSources].reverse()]) {
    const split = chance(records);
    close(split.successChance, whole.successChance);
    close(weights(split).A, weights(whole).A);
    close(weights(split).B, weights(whole).B);
  }
});

test('大量小记录与异常放大系数仅在最后截断总率，不改变父权重', () => {
  for (const chanceFactor of [0, 0.35, 1, 100]) {
    const whole = chance([source(40), source(20, { male: 'B' })], { chanceFactor });
    const split = chance([...Array.from({ length: 100 }, () => source(0.4)), source(20, { male: 'B' })], { chanceFactor });
    close(split.successChance, whole.successChance);
    close(weights(split).A || 0, weights(whole).A || 0);
    close(weights(split).B || 0, weights(whole).B || 0);
    assert.ok(split.sources.every((row) => row.chance >= 0 && row.chance <= 1));
  }
});

test('不同父方的自然衰减仍独立，不把所有来源改成一个共用池', () => {
  const rows = calculateSpermSourceExposures([source(20), source(20, { male: 'B' })], 1);
  assert.deepEqual(rows.map((row) => row.endingValue), [10, 10]);
});

test('失活只退出受精，不退出同父材料物理衰减或占量', () => {
  const sources = [source(10, { id: 1, blocked: true }), source(10, { id: 2 })];
  const preview = chance(sources);
  assert.equal(preview.sources.length, 1);
  assert.equal(preview.sources[0].id, 2);
  close(preview.totalSperm, 10);
  close(preview.effectiveExposureDays, 1);
  close(preview.totalExposureAmountDays, 7.5);
  close(preview.sources[0].endingValue, 5);
  assert.equal(chance(sources.map((row) => ({ ...row, blocked: true }))).successChance, 0);
});

test('共用来源读取对legacy余量、blocked与过量旧接触不重复计数且只读', () => {
  const base = {
    sperms: [source(30, { quality: 4 })],
    spermContacts: [source(10, { id: 1, quality: 1, blocked: true, minutesPassed: 3 })],
  };
  const before = JSON.stringify(base);
  const sources = getSpermSources(base);
  assert.equal(JSON.stringify(base), before);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].quality, 1);
  assert.equal(sources[1].quality, 4);
  assert.equal(sources[1].value, 20);
  assert.equal(sources[1].id, undefined);
  assert.equal(sources[1].minutesPassed, undefined);
  base.sperms[0].value = 5;
  const scaled = getSpermSources(base);
  assert.equal(scaled.length, 1);
  assert.equal(scaled[0].value, 5);
  assert.equal(scaled[0].blocked, true);
});

test('同父多条legacy快照逐条保留，不把未知量全部套用第一条资料', () => {
  const base = { sperms: [source(10), source(30, { race: '精灵', quality: 4, derivedType: '血族', bodySize: 5 })] };
  const rows = getSpermSources(base);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.race, row.quality, row.value]), [['人类', 1, 10], ['精灵', 4, 30]]);
  assert.equal(rows[1].derivedType, '血族');
  assert.equal(rows[1].bodySize, 5);
  setSpermSources(base, rows);
  assert.deepEqual(getSpermSources(JSON.parse(JSON.stringify(base))), rows);
  assert.ok(rows.every((row) => row.id === undefined && row.minutesPassed === undefined));
});

test('多行legacy与已知接触对账先扣相同快照，不重复引入已知/失活材料', () => {
  const base = { sperms: [source(10), source(30, { race: '精灵', quality: 4 })], spermContacts: [source(10, { id: 1, blocked: true })] };
  const rows = getSpermSources(base);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].blocked, true);
  assert.deepEqual([rows[1].race, rows[1].quality, rows[1].value], ['精灵', 4, 30]);
  assert.equal(sum(rows), 40);
});

test('登记器正式接受的同父多行legacy在抽父、衰减和排出写回后仍保留各自遗传快照', () => {
  const makeLegacy = () => {
    const chat = createEmptyChatState();
    applyRegistryResult(chat, { name: 'F', profile: { base: { race: '人类', age: 24, stage: '卵泡期', sperms: [source(10), source(30, { race: '精灵' })] } } });
    Object.assign(profile(chat).base, { bodySize: 4, days: 0, eggs: 1, vitality: 100, psyStress: 0, libido: 0, uterinePressure: 0 });
    profile(chat).bio.impregnationDifficulty = 1;
    return chat;
  };
  const chat = makeLegacy();
  let randomIndex = 0;
  Math.random = () => [0, 0.9][randomIndex++] ?? 0.5;
  call(chat, 'bsPassedTime', { minute: 1 });
  assert.equal(profile(chat).pregnant.fetuses[0].fatherRace, '精灵');
  assert.deepEqual(profile(chat).base.spermContacts.map((row) => row.race), ['人类', '精灵']);
  assert.ok(profile(chat).base.spermContacts.every((row) => row.id === undefined && row.minutesPassed === undefined));
  const drained = makeLegacy();
  call(drained, 'bsDrainSperm', { female: 'F', amount: 4 });
  assert.deepEqual(profile(drained).base.spermContacts.map((row) => row.race), ['人类', '精灵']);
  close(profile(drained).base.spermContacts[0].value, 9);
  close(profile(drained).base.spermContacts[1].value, 27);
});

test('匿名计算器不同种族保持各自自然衰减，同条件拆记录仍等效', () => {
  const rows = calculateSpermSourceExposures([{ race: '人类', value: 20 }, { race: '精灵', value: 20 }], 1);
  assert.deepEqual(rows.map((row) => row.endingValue), [10, 10]);
});

test('可见残留清空后不让旧接触复活；零量编号与未知扩展字段保留', () => {
  const base = { sperms: [], spermContacts: [source(20, { id: 9, minutesPassed: 5, futureField: 'preserved' })] };
  const sources = getSpermSources(base);
  assert.equal(sum(sources), 0);
  setSpermSources(base, sources);
  assert.equal(base.spermContacts[0].id, 9);
  assert.equal(base.spermContacts[0].futureField, 'preserved');
  assert.equal(chance(getSpermSources(base)).successChance, 0);
});

test('面板使用与正式判定相同的contacts、legacy差额、难度及万族相容', () => {
  for (const crossSpecies of [false, true]) {
    const chat = setup([source(12, { id: 1, race: '石像鬼', quality: 4 }), source(8, { id: 2, blocked: true })], { crossSpecies });
    profile(chat).base.sperms[0].value += 5;
    const p = profile(chat);
    const actual = panel(p);
    const expected = chance(getSpermSources(p.base), { impregnationDifficulty: p.bio.impregnationDifficulty, crossSpecies });
    close(actual.successChance, expected.successChance);
    assert.equal(actual.sources.some((row) => row.id === 2), false);
    assert.equal(actual.sources[0].quality, 4);
    assert.equal(actual.sources[0].race, '石像鬼');
  }
});

test('面板所有接触失活时显示0，既有无卵/经期门槛仍保留', () => {
  const chat = setup([source(20, { id: 1, blocked: true })]);
  assert.equal(panel(profile(chat)).successChance, 0);
  profile(chat).base.eggs = 0;
  assert.equal(panel(profile(chat)), null);
  profile(chat).base.eggs = 1;
  profile(chat).base.stage = '月经期';
  assert.equal(panel(profile(chat)), null);
});

test('实际bsPassedTime抽签阈值与面板一致，而不是只比较两个helper', () => {
  for (const split of [false, true]) {
    const sources = split ? [source(10, { id: 1, minutesPassed: 0 }), source(10, { id: 2, minutesPassed: 0 })] : [source(20, { id: 1, minutesPassed: 0 })];
    for (const offset of [-1e-7, 1e-7]) {
      const chat = setup(sources);
      const threshold = panel(profile(chat)).successChance;
      let first = true;
      Math.random = () => { if (first) { first = false; return threshold + offset; } return 0.5; };
      assert.equal(call(chat, 'bsPassedTime', { day: 1 }).applied, true);
      assert.equal(profile(chat).pregnant.fetuses.length, offset < 0 ? 1 : 0);
    }
  }
});

test('原生随机选父使用可加的材料权重而非记录条数', () => {
  for (const [fatherRoll, expected] of [[0.69, 'A'], [0.71, 'B']]) {
    for (const sources of [[source(40), source(20, { male: 'B' })], [source(20), source(20), source(20, { male: 'B' })]]) {
      const chat = setup(sources);
      let callIndex = 0;
      Math.random = () => [0, fatherRoll][callIndex++] ?? 0.5;
      assert.equal(call(chat, 'bsPassedTime', { day: 1 }).applied, true);
      assert.equal(profile(chat).pregnant.fetuses[0].fathers, expected);
    }
  }
});

test('原生自然流失保持拆分总量与各自id/time/blocked，零量不删编号', () => {
  Math.random = () => 0.99;
  const chat = setup([source(10, { id: 1, minutesPassed: 0 }), source(10, { id: 2, minutesPassed: 2, blocked: true })], { eggs: 0 });
  call(chat, 'bsPassedTime', { day: 1 });
  const contacts = profile(chat).base.spermContacts;
  assert.deepEqual(contacts.map((row) => row.value), [5, 5]);
  assert.equal(profile(chat).base.sperms[0].value, 10);
  assert.equal(contacts[1].blocked, true);
  assert.equal(contacts[1].minutesPassed, 2);
  call(chat, 'bsPassedTime', { day: 1 });
  assert.equal(profile(chat).base.sperms.length, 0);
  assert.deepEqual(profile(chat).base.spermContacts.map((row) => [row.id, row.value]), [[1, 0], [2, 0]]);
});

test('同父不同品质快照独立自然衰减，后来改精方不会重写旧品质', () => {
  Math.random = () => 0.99;
  const chat = setup([source(20, { id: 1, quality: 1, minutesPassed: 0 })], { eggs: 0 });
  chat.sires.A = normalizeSireRecord({ race: '人类', spermQuality: 4 });
  profile(chat).base.nextSpermContactId = 1;
  deposit(chat);
  call(chat, 'bsPassedTime', { day: 1 });
  const contacts = profile(chat).base.spermContacts;
  assert.deepEqual(contacts.map((row) => row.quality), [1, 4]);
  assert.deepEqual(contacts.map((row) => row.value), [10, 15]);
  assert.equal(profile(chat).base.sperms[0].value, 25);
});

test('旧未知余量在新沉积前冻结，但不补造编号时间或事后避孕资格', () => {
  Math.random = () => 0.5;
  const chat = setup([]);
  profile(chat).base.sperms = [source(20, { quality: 0.25, race: '精灵' })];
  delete profile(chat).base.spermContacts;
  chat.sires.A = normalizeSireRecord({ race: '人类', spermQuality: 4 });
  deposit(chat);
  const contacts = profile(chat).base.spermContacts;
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].quality, 0.25);
  assert.equal(contacts[0].race, '精灵');
  assert.equal(contacts[0].minutesPassed, undefined);
  assert.equal(contacts[0].id, undefined);
  assert.equal(contacts[1].quality, 4);
  assert.equal(contacts[1].minutesPassed, 0);
  assert.equal(call(chat, 'bsAbortion', { female: 'F', purpose: 'emergency' }).applied, false);
  assert.deepEqual(getSpermSources(JSON.parse(JSON.stringify(profile(chat).base))).map((row) => row.quality), [0.25, 4]);
});

test('伴生卵剂量按同快照可受精材料计，不混入异质或失活来源', () => {
  const sources = [source(10, { id: 1 }), source(10, { id: 2 }), source(5, { id: 3, quality: 4 }), source(8, { blocked: true })];
  assert.equal(getSpermSnapshotAmount(sources, sources[0]), 20);
  assert.equal(getSpermSnapshotAmount(sources, sources[2]), 5);
  const one = setup([source(20, { race: '怪鱼类', id: 1 })], { race: '怪鱼类' });
  const split = setup([source(10, { race: '怪鱼类', id: 1 }), source(10, { race: '怪鱼类', id: 2 })], { race: '怪鱼类' });
  for (const chat of [one, split]) {
    let first = true;
    Math.random = () => { if (first) { first = false; return 0; } return 0.5; };
    call(chat, 'bsPassedTime', { minute: 1 });
  }
  assert.ok(profile(one).pregnant.fetuses[0].companionEggCount > 0);
  assert.equal(profile(split).pregnant.fetuses[0].companionEggCount, profile(one).pregnant.fetuses[0].companionEggCount);
  assert.equal(profile(split).pregnant.fetuses[0].contactIds.length, 1, '仍关联实际获胜的独立接触');
});

for (const sources of [[source(40, { quality: 4 })], [source(10, { quality: 0.25 }), source(90, { quality: 4, male: 'B' })]]) {
  test(`原生主动排出在混合品质/品质4时拆指令等效：${sources.length}类`, () => {
    const one = setup(sources, { eggs: 0 });
    const split = setup(sources, { eggs: 0 });
    call(one, 'bsDrainSperm', { female: 'F', amount: 80 });
    call(split, 'bsDrainSperm', { female: 'F', amount: 40 });
    call(split, 'bsDrainSperm', { female: 'F', amount: 40 });
    close(sum(profile(one).base.sperms), sum(profile(split).base.sperms));
    for (let i = 0; i < sources.length; i++) close(profile(one).base.spermContacts[i].value, profile(split).base.spermContacts[i].value);
  });
}

test('排出使用独立品质快照，保留浮点量/时间/卵/胚胎父系及0量contact', () => {
  const chat = setup([source(10, { quality: 0.25, id: 1, minutesPassed: 2, blocked: true }), source(30, { quality: 4, id: 2, minutesPassed: 3 })]);
  profile(chat).pregnant.fetuses = [{ fathers: 'existing', fatherRace: '精灵', contactIds: [1], fatherBodySize: 5, amnionDurability: 100, backSide: '右后', descentStage: -2 }];
  const beforeFetuses = JSON.stringify(profile(chat).pregnant.fetuses);
  const now = chat.minutesPassed;
  call(chat, 'bsDrainSperm', { female: 'F', amount: 10 });
  const contacts = profile(chat).base.spermContacts;
  assert.ok(contacts[0].value < 7 && contacts[1].value > 24, '低品质比高品质更易排出');
  assert.ok(contacts.some((row) => row.value !== Math.floor(row.value)));
  assert.equal(contacts[0].blocked, true);
  assert.equal(contacts[1].minutesPassed, 3);
  assert.equal(chat.minutesPassed, now);
  assert.equal(profile(chat).base.eggs, 1);
  assert.equal(JSON.stringify(profile(chat).pregnant.fetuses), beforeFetuses);
  call(chat, 'bsDrainSperm', { female: 'F', amount: 1000 });
  assert.equal(profile(chat).base.sperms.length, 0);
  assert.deepEqual(profile(chat).base.spermContacts.map((row) => [row.id, row.value]), [[1, 0], [2, 0]]);
  assert.equal(JSON.stringify(profile(chat).pregnant.fetuses), beforeFetuses);
});

test('正式压缩快照经JSON保存还原后保留品质、失活、零量来源与未知时间', () => {
  const chat = setup([
    source(0, { id: 1, minutesPassed: 0, blocked: true, bloodline: { 人类: 1 }, bloodlineSource: 'pure' }),
    source(12.5, { id: 2, minutesPassed: 7, quality: 4, bloodline: { 人类: 1 }, bloodlineSource: 'pure' }),
    source(3.25, { quality: 0.25, race: '精灵', bloodline: { 精灵: 1 }, bloodlineSource: 'pure' }),
  ]);
  profile(chat).base.nextSpermContactId = 2;
  const before = JSON.parse(JSON.stringify(getSpermSources(profile(chat).base)));
  recordChatStateSnapshot({ chatId: 'sperm-consistency', chat: [{ mes: '记录', name: 'F', is_user: false }] }, chat, { messageCount: 1 });
  const saved = JSON.parse(JSON.stringify(chat));
  const restored = getSnapshotCharacter(saved, 0, 'F');
  assert.deepEqual(getSpermSources(restored.profile.base), before);
  assert.equal(restored.profile.base.nextSpermContactId, 2);
});

test('时间入口不引入31天上限，半年/一年仍一次推进所有角色', () => {
  Math.random = () => 0.99;
  for (const args of [{ month: 6 }, { year: 1 }]) {
    const chat = setup([], { eggs: 0 });
    chat.characters.G = structuredClone(chat.characters.F);
    chat.characters.G.name = 'G';
    const age = profile(chat).base.age;
    const result = call(chat, 'bsPassedTime', args);
    assert.equal(result.applied, true, result.message);
    assert.equal(chat.minutesPassed, (args.year ? 365 : 180) * 1440);
    assert.ok(chat.characters.F.profile.base.age > age);
    assert.equal(chat.characters.F.profile.base.age, chat.characters.G.profile.base.age);
    assert.equal(profile(chat).base.spermPool, undefined);
  }
});
