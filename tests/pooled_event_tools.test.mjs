import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { normalizeSireRecord } from '../scripts/sires.js';

// 全部生殖行为经过真实公开分发器；只有完整角色入口计数使用无逻辑替换的内存插桩。
const copy = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, eps = 2e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const call = (chat, name, args, dispatcher = applyToolCall) => dispatcher(chat, { name, arguments: args });
const profile = (chat, name = '母方') => chat.characters[name].profile;
const base = (chat, name) => profile(chat, name).base;
const fetuses = (chat, name) => profile(chat, name).pregnant.fetuses;
function fixture({ eggs = 1, threshold = 0.08, pooled = true, name = '母方', seed = 'native-event-tools' } = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState(name);
  mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race: '人类', bodySize: 4, stage: '卵泡期', days: 3,
    eggs, vitality: 100, libido: 0, psyStress: 0, isHere: false });
  Object.assign(mother.profile.bio, { identicalProbability: 0, impregnationDifficulty: 1 });
  mother.profile.cooldown.naturalOvulationUsed = true;
  mother.profile.immune.metabolism = true;
  mother.runtime = { dayCarryMinutes: 0, hourCarryMinutes: 0, lifestyleWeekCarryMinutes: 0 };
  chat.characters[name] = mother;
  chat.sires.A = normalizeSireRecord({ race: '人类', spermQuality: 1, bodySize: 4 });
  chat.sires.B = normalizeSireRecord({ race: '人类', spermQuality: 4, bodySize: 4 });
  if (pooled) {
    enablePooledConception(mother.profile.base, 0, { seed });
    for (const egg of mother.profile.base.spermPool.eggs) egg.threshold = egg.remainingHazard = threshold;
  }
  return chat;
}
function deposit(chat, amount = 20, male = 'A', race = '人类') {
  for (const action of ['insert', 'deposit']) {
    const result = call(chat, 'bsAddSperm', { female: '母方', male, race, action, amount: action === 'deposit' ? amount : 0 });
    assert.equal(result.applied, true, result.message);
  }
}
function pass(chat, args, dispatcher) {
  const result = call(chat, 'bsPassedTime', args, dispatcher);
  assert.equal(result.applied, true, result.message);
  return result;
}
function fetus(race = '人类', extra = {}) {
  return { embryoId: 1, fathers: '既有父方', race, gender: '女', embryoType: '胎生', weight: 1,
    tendencyAngle: 0, backSide: 'left_anterior', affinity: 0, amnionDurability: 100, tags: [], ...extra };
}
function pregnantFixture({ age = 50, eggs = 0, stage = '孕早期', pending = false, pooled = true } = {}) {
  const chat = fixture({ eggs, pooled });
  Object.assign(base(chat), { stage, days: age < 98 ? age : age - 98 });
  Object.assign(profile(chat).pregnant, { pregnantDays: age, effectivePregnantDays: age,
    fetuses: [fetus(), ...(pending ? [fetus('精灵', { embryoId: 2, pendingImplantation: true, conceivedAtDays: 95 })] : [])],
    fetusesCount: pending ? 2 : 1 });
  return chat;
}

// 此积分只用于同品质人类独立期望：不调用生产风险积分或反解实现。
function humanHazard(days, { volume = 20, initial = 1, slope = 0 } = {}) {
  const end = Math.min(days, volume / 10);
  const n = 2000;
  const value = (t) => 0.3 * Math.min(2, Math.sqrt(Math.max(0, volume - 10 * t) / 20)) * Math.max(0, initial + slope * t);
  let sum = value(0) + value(end);
  for (let i = 1; i < n; i += 1) sum += value(end * i / n) * (i % 2 ? 4 : 2);
  return sum * end / n / 3;
}
function budget(chat, hazard) {
  for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = hazard;
}

test('真实工具跨卵泡到排卵：初始零卵在自然日边界新建预算并受精', () => {
  const chat = fixture({ eggs: 0, seed: 'native-event-24' });
  base(chat).days = 8.5;
  profile(chat).cooldown.naturalOvulationUsed = false;
  deposit(chat, 40);
  const result = pass(chat, { day: 3 });
  assert.equal(result.conceptionEvents.length, 1);
  assert.ok(result.conceptionEvents[0].atMinute > 1440);
  assert.ok(result.conceptionEvents[0].atMinute < 2.5 * 1440);
  assert.equal(fetuses(chat).length, 1);
  assert.equal(fetuses(chat)[0].fathers, 'A');
  assert.equal(base(chat).stage, '黄体期');
  near(base(chat).days, 0.5);
});

test('真实工具按原始dayCarry失卵，不把外部调用末点冒充整日边界', () => {
  const chat = fixture({ eggs: 2 });
  chat.characters['母方'].runtime.dayCarryMinutes = 1430;
  chat.characters['母方'].runtime.hourCarryMinutes = 50;
  pass(chat, { minute: 9.5 });
  assert.equal(base(chat).eggs, 2);
  pass(chat, { minute: 0.5 });
  assert.equal(base(chat).eggs, 1);
  assert.equal(base(chat).spermPool.eggs[0].eggId, 2);
  pass(chat, { minute: 1439.5 });
  assert.equal(base(chat).eggs, 1);
  pass(chat, { minute: 0.5 });
  assert.equal(base(chat).eggs, 0);
  assert.equal(chat.minutesPassed, 1450);
});

test('真实工具近经期受精的未着床胚胎在来潮时清除，事件回执仍保留', () => {
  const chat = fixture({ threshold: 1e-5 });
  Object.assign(base(chat), { stage: '黄体期', days: 11.5 });
  deposit(chat);
  const result = pass(chat, { day: 1 });
  assert.equal(result.conceptionEvents.length, 1);
  assert.ok(result.conceptionEvents[0].atMinute < 720);
  assert.equal(base(chat).stage, '月经期');
  assert.equal(fetuses(chat).length, 0);
  assert.equal(base(chat).eggs, 0);
  assert.equal(base(chat).fertilizationDays, 0);
  assert.ok(base(chat).spermContacts.every((source) => source.value === 0));
});

test('真实受精时刻启动六天等待，着床只消费之后的真实余段孕日', () => {
  const chat = fixture(); deposit(chat);
  const first = pass(chat, { day: 1 });
  const tf = first.conceptionEvents[0].atMinute;
  assert.ok(tf > 0 && tf < 1440);
  near(base(chat).fertilizationDays, (1440 - tf) / 1440);
  near(base(chat).spermPool.timelineImplantStartMinute, tf);
  const due = tf + 6 * 1440;
  pass(chat, { minute: due - chat.minutesPassed - 0.25 });
  assert.ok(!base(chat).stage.startsWith('孕'));
  assert.equal(profile(chat).pregnant.effectivePregnantDays, 0);
  pass(chat, { minute: 0.75 });
  assert.equal(base(chat).stage, '孕早期');
  near(profile(chat).pregnant.effectivePregnantDays, 20 + 0.5 / 1440);
  near(profile(chat).pregnant.pregnantDays, 20 + 0.5 / 1440);
  assert.equal(base(chat).fertilizationDays, 0);
});

test('真实工具一日、小时、小数及JSON恢复保持事件、父方和一次性初重一致', () => {
  const original = fixture(); deposit(original, 20, 'A'); deposit(original, 20, 'B');
  const paths = [[1440], Array(24).fill(60), [0.5, 17.25, 133.125, 700.5, 588.625]];
  const results = paths.map((steps) => {
    let chat = copy(original);
    const events = [];
    for (const minute of steps) {
      chat = copy(chat);
      events.push(...pass(chat, { minute }).conceptionEvents);
    }
    const embryo = fetuses(chat)[0];
    return { events, father: embryo.fathers, frozen: embryo.pooledConception,
      fatherRace: embryo.fatherRace, fatherBloodline: embryo.fatherBloodline,
      residue: base(chat).spermContacts.map((source) => source.value), cursor: base(chat).spermPool.lastMinute };
  });
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
  assert.equal(results[0].events.length, 1);
  assert.ok(results[0].frozen.initialWeight > 0);
  assert.equal(results[0].cursor, 1440);
});

test('异期线性风险穿过56日后才创建嵌套胎，连续首穿吻合独立同品质积分', () => {
  const chat = pregnantFixture({ age: 55.5, eggs: 1 });
  fetuses(chat)[0].weight = 1.6;
  deposit(chat, 150);
  const volume = base(chat).spermContacts.reduce((sum, source) => sum + source.value, 0);
  assert.ok(volume > 110, '嵌套fixture须满足大宿主和事件时超过100的物料门槛');
  const W = 92;
  budget(chat, humanHazard(0.75, { volume, initial: 0.35 * (1 - 55.5 / W), slope: -0.35 / W }));
  const result = pass(chat, { day: 1 });
  assert.equal(result.conceptionEvents.length, 1);
  near(result.conceptionEvents[0].atMinute, 0.75 * 1440, 2e-8);
  const nested = fetuses(chat).find((item) => item.pooledConception);
  near(nested.conceivedAtDays, 56.25, 2e-8);
  assert.equal(nested.nestedInEmbryoId, 1);
  assert.ok(nested.tags.includes('nested'));
});

test('异期窗口W关闭后即使仍有卵和物料也不受精，98日清除未着床慢胎并恢复孕速', () => {
  const late = pregnantFixture({ age: 91.5, eggs: 1 }); deposit(late, 20);
  budget(late, 1);
  assert.deepEqual(pass(late, { day: 1 }).conceptionEvents, []);
  const remaining = base(late).spermPool.eggs[0].remainingHazard;
  pass(late, { day: 0.25 });
  assert.equal(base(late).spermPool.eggs[0].remainingHazard, remaining);
  assert.equal(base(late).eggs, 1);

  const whole = pregnantFixture({ age: 97, pending: true });
  Object.assign(profile(whole).bio, { gestationSpeciesSpeed: 0.5, gestationEffectiveSpeed: 0.5 });
  const split = copy(whole);
  pass(whole, { day: 4 });
  pass(split, { day: 2 }); pass(split, { day: 2 });
  for (const chat of [whole, split]) {
    assert.equal(base(chat).stage, '孕中期');
    assert.equal(fetuses(chat).length, 1);
    assert.equal(fetuses(chat)[0].race, '人类');
    assert.equal(profile(chat).bio.gestationSpeciesSpeed, 1);
    near(profile(chat).pregnant.effectivePregnantDays, 100);
  }
});

test('真实新慢胎在受精事件后立即改变余段孕速，整日与小时切片一致', () => {
  const original = pregnantFixture({ age: 50, eggs: 1 });
  base(original).race = '精灵';
  original.sires.A = normalizeSireRecord({ race: '精灵', spermQuality: 1, bodySize: 4 });
  deposit(original, 20, 'A', '精灵');
  budget(original, 1e-4);
  const whole = copy(original), hourly = copy(original);
  const events = pass(whole, { day: 1 }).conceptionEvents;
  const splitEvents = [];
  for (let i = 0; i < 24; i += 1) splitEvents.push(...pass(hourly, { hour: 1 }).conceptionEvents);
  assert.equal(events.length, 1);
  assert.deepEqual(splitEvents, events);
  const slow = fetuses(whole).find((item) => item.pooledConception);
  assert.equal(slow.race, '精灵');
  assert.equal(profile(whole).bio.gestationSpeciesSpeed, 0.5);
  const tfDays = events[0].atMinute / 1440;
  near(slow.conceivedAtDays, 50 + tfDays);
  near(profile(whole).pregnant.effectivePregnantDays, 50 + tfDays + (1 - tfDays) * 0.5);
  near(profile(hourly).pregnant.effectivePregnantDays, profile(whole).pregnant.effectivePregnantDays);
  assert.equal(fetuses(hourly).find((item) => item.pooledConception).pooledConception.initialWeight, slow.pooledConception.initialWeight);
});

test('普通孕期每次批量推进刷新当前胎儿负担，不冻结在50除280', () => {
  for (const pooled of [true, false]) {
    const chat = pregnantFixture({ age: 50, pooled });
    profile(chat).pregnant.fetalEnergyDrain = 50 / 280;
    let previous = profile(chat).pregnant.fetalEnergyDrain;
    for (let week = 1; week <= 3; week += 1) {
      pass(chat, { day: 7 });
      const p = profile(chat);
      near(p.pregnant.effectivePregnantDays, 50 + week * 7);
      const actual = p.pregnant.fetalEnergyDrain;
      const weight = p.pregnant.fetuses[0].weight;
      if (pooled) near(actual, p.pregnant.effectivePregnantDays * weight / 280 / p.bio.breedTolerance);
      else if (week > 1) assert.ok(actual > previous, '旧默认最多延迟一个tick，但后续仍须刷新');
      previous = actual;
    }
    assert.ok(profile(chat).pregnant.fetalEnergyDrain > 50 / 280);
  }
});

test('延产363到364日保留完整一天羊膜修复，终点进入前驱但不消费前驱时间', () => {
  const chat = pregnantFixture({ age: 363, stage: '延产期' });
  Object.assign(profile(chat).pregnant, { extensionUntilDays: 364, extensionCount: 1 });
  fetuses(chat)[0].amnionDurability = 50;
  pass(chat, { day: 1 });
  assert.equal(base(chat).stage, '产兆前驱');
  near(profile(chat).pregnant.effectivePregnantDays, 364);
  near(fetuses(chat)[0].amnionDurability, 55);
  assert.equal(profile(chat).pregnant.prodromalDelayProgressHours, 0);
  const remaining = profile(chat).pregnant.prodromalRemainingHours;
  assert.equal(remaining, 48, '到达前驱的精确终点时仍保留全部48小时，延产前段不计入前驱');
  pass(chat, { minute: 0.5 });
  assert.ok(profile(chat).pregnant.prodromalRemainingHours < remaining);
});

test('假孕及产后恢复到期直接进入月经，不因高压力和近期接触重新假孕', () => {
  for (const kind of ['假孕期', '产后恢复']) {
    const chat = fixture({ eggs: 0 });
    Object.assign(base(chat), { stage: kind, days: kind === '产后恢复' ? 1.99 : 0,
      psyStress: 100, libido: 50, latestSexDays: 0 });
    profile(chat).experience.latestSexPartner = 'A';
    if (kind === '假孕期') {
      Object.assign(profile(chat).bio, { gestationSpeciesSpeed: 0.03, gestationEffectiveSpeed: 0.03 });
      profile(chat).pregnant.pregnantDays = 2.5;
    } else {
      profile(chat).bio.recoveryDays = 2;
      base(chat).uterineAtony = 3;
      Object.assign(profile(chat).pregnant, { pregnantDays: 300, effectivePregnantDays: 300,
        laborHours: 20, effectiveLaborHours: 20, laborPain: 50 });
    }
    pass(chat, { hour: 1 });
    assert.equal(base(chat).stage, '月经期', kind);
    near(base(chat).days, kind === '假孕期' ? 1 / 24 - 0.02 : 1 / 24 - 0.01);
    assert.equal(profile(chat).pregnant.pregnantDays, 0);
    assert.equal(profile(chat).pregnant.effectivePregnantDays, 0);
    if (kind === '产后恢复') {
      assert.equal(base(chat).uterineAtony, 0);
      assert.equal(profile(chat).pregnant.laborHours, 0);
      assert.equal(profile(chat).pregnant.effectiveLaborHours, 0);
    }
  }
});

test('真实工具98及196有效孕日精确端点采用右连续阶段，不被尾部状态同步覆盖', () => {
  for (const [age, stage, next] of [[97, '孕早期', '孕中期'], [195, '孕中期', '孕晚期']]) {
    const chat = pregnantFixture({ age, stage });
    pass(chat, { day: 1 });
    near(profile(chat).pregnant.effectivePregnantDays, age + 1);
    assert.equal(base(chat).stage, next);
    near(base(chat).days, 0);
  }
});

test('真实卵泡四分之一容量台阶不因逐小时浮点末位延迟裁剪', () => {
  const original = fixture({ eggs: 0, pooled: false });
  base(original).days = 2;
  base(original).sperms = [{ male: 'A', race: '人类', value: 125, quality: 1, bodySize: 4 }];
  enablePooledConception(base(original), 0, { seed: '原生容量台阶' });
  const totals = [];
  for (const [count, minute] of [[1, 720], [12, 60], [720, 1]]) {
    const chat = copy(original);
    for (let i = 0; i < count; i += 1) pass(chat, { minute });
    const residual = base(chat).spermContacts.reduce((sum, source) => sum + source.value, 0);
    near(residual, 110.5);
    totals.push(residual);
  }
  near(totals[0], totals[1]);
  near(totals[0], totals[2]);
});

async function countedDispatcher() {
  const url = new URL('../scripts/tools.js', import.meta.url);
  const original = await readFile(url, 'utf8');
  const needle = 'function applyTimeToCharacter(character, tick) {';
  assert.equal(original.split(needle).length, 2);
  const code = original.replace(needle, `${needle}\n  globalThis.__nativePooledBatchCalls.push(character.name);`)
    .replace(/((?:from\s*|import\s*)['"])(\.[^'"]+)(['"])/g,
      (_, before, specifier, after) => before + new URL(specifier, url).href + after);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).applyToolCall;
}

test('真实混合开关多角色长跳每角色只完整推进一次，32、180和365天都不截断', async () => {
  const dispatcher = await countedDispatcher();
  const previous = globalThis.__nativePooledBatchCalls;
  try {
    for (const days of [32, 180, 365]) {
      const chat = fixture({ eggs: 0 });
      const legacy = fixture({ eggs: 0, pooled: false, name: '旧模式' });
      const other = fixture({ eggs: 0, name: '另一池' });
      Object.assign(chat.characters, legacy.characters, other.characters);
      for (const character of Object.values(chat.characters)) {
        character.profile.base.stage = '无经期'; character.profile.base.days = 0;
      }
      globalThis.__nativePooledBatchCalls = [];
      pass(chat, { day: days }, dispatcher);
      assert.deepEqual(globalThis.__nativePooledBatchCalls.sort(), ['另一池', '旧模式', '母方'].sort());
      assert.equal(chat.minutesPassed, days * 1440);
      for (const character of Object.values(chat.characters)) {
        near(character.profile.base.days, days);
        if (character.profile.base.spermPool) assert.equal(character.profile.base.spermPool.lastMinute, chat.minutesPassed);
      }
      assert.equal('spermPool' in base(chat, '旧模式'), false);
    }
  } finally { globalThis.__nativePooledBatchCalls = previous; }
});

test('真实半分钟推进世界钟与池cursor一致；冻结暂停生理，宿主消失后解冻不补算', () => {
  const chat = fixture({ threshold: 1e-5 }); deposit(chat);
  const result = pass(chat, { minute: 0.5 });
  assert.equal(result.conceptionEvents.length, 1);
  assert.equal(chat.minutesPassed, 0.5);
  assert.equal(base(chat).spermPool.lastMinute, 0.5);
  const frozen = copy(profile(chat));
  const waitingAnchor = frozen.base.spermPool.timelineImplantStartMinute;
  assert.ok(waitingAnchor > 0 && waitingAnchor < 0.5);
  chat.characters['承载者'] = fixture({ eggs: 0, pooled: false, name: '承载者' }).characters['承载者'];
  base(chat).wombReturnHost = '承载者';
  pass(chat, { day: 3 });
  assert.equal(base(chat).days, frozen.base.days);
  assert.deepEqual(base(chat).spermContacts, frozen.base.spermContacts);
  assert.deepEqual(base(chat).spermPool.eggs, frozen.base.spermPool.eggs);
  assert.equal(base(chat).spermPool.lastMinute, chat.minutesPassed);
  assert.equal(base(chat).spermPool.timelineImplantStartMinute, 3 * 1440 + waitingAnchor);
  assert.equal(base(chat).fertilizationDays, frozen.base.fertilizationDays);
  assert.deepEqual(fetuses(chat), frozen.pregnant.fetuses);
  delete chat.characters['承载者'];
  pass(chat, { minute: 0.5 });
  assert.equal(base(chat).wombReturnHost, undefined);
  assert.equal(chat.minutesPassed, 3 * 1440 + 1);
  assert.equal(base(chat).spermPool.lastMinute, chat.minutesPassed);
  near(base(chat).days, frozen.base.days + 0.5 / 1440);
  near(base(chat).fertilizationDays, frozen.base.fertilizationDays + 0.5 / 1440);
  assert.equal(profile(chat).pregnant.effectivePregnantDays, 0);
  assert.ok(base(chat).spermContacts[0].value < frozen.base.spermContacts[0].value);
  assert.ok(base(chat).spermContacts[0].value > frozen.base.spermContacts[0].value - 0.01);
});
