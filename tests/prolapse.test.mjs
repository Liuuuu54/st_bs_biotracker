// 宫脱（1.6.0）：高宫压下用力、娩出、插入、剧情加重；自然回复、推回、托住、修复；对妊娠的影响
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { applyDeliveryProlapse, applyProlapseTick, describeProlapse, getProlapseFirstStageFactor, getProlapseGrade, getProlapseUrineFactor, getSwordProlapseStrain } from '../scripts/prolapse.js';
import { resolveLaborPhaseHours } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function setup(extra = {}, stage = '卵泡期') {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage, days: 0, vitality: 100, psyStress: 0, race: '人类', bodySize: 4, hipGain: 0.5, ...extra });
  chat.characters.A = ch;
  return chat;
}
const base = (chat) => chat.characters.A.profile.base;
const hours = (chat, hour) => applyToolCall(chat, { name: 'bsPassedTime', arguments: { hour } });
const record = (chat, args) => applyToolCall(chat, { name: 'bsRecordExperience', arguments: { female: 'A', action: 'prolapse', time: '今天', ...args } });
const near = (actual, expected, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);

test('单纯宫压高不会脱：满宫压撑一整天仍是 0', () => {
  const chat = setup({ uterinePressure: 50 });
  hours(chat, 24);
  assert.equal(base(chat).prolapse || 0, 0);
});

test('第二产程用力：宫压 ≥ 66% 才加重，疲劳越高越快；没用力时回复', () => {
  const profile = (extra = {}) => ({ base: { stage: '第二产程', prolapse: 0, ...extra }, experience: {} });
  const low = profile();
  applyProlapseTick(low, { hours: 2, pressureRatio: 0.6, pushing: true });
  assert.equal(low.base.prolapse, 0);
  const high = profile();
  applyProlapseTick(high, { hours: 2, pressureRatio: 1, pushing: true });
  near(high.base.prolapse, 0.1, 1e-9);
  const tired = profile();
  applyProlapseTick(tired, { hours: 2, pressureRatio: 1, pushing: true, pushFatigue: 100 });
  near(tired.base.prolapse, 0.2, 1e-9);
  const resting = profile({ prolapse: 1 });
  applyProlapseTick(resting, { hours: 24, pressureRatio: 1, pushing: false });
  near(resting.base.prolapse, 0.85, 1e-9);
});

test('自然回复：每天 0.15 × 臀部系数，臀部增长倾向越高越快', () => {
  const chat = setup({ prolapse: 1.5 });
  hours(chat, 24);
  near(base(chat).prolapse, 1.35);
  const wide = setup({ prolapse: 1.5, hipGain: 2 });
  hours(wide, 24);
  near(base(wide).prolapse, 1.5 - 0.15 * 1.75);
});

test('III 度以上不自然回复；推回到 II，托住后能继续回', () => {
  const chat = setup({ prolapse: 3.4 });
  hours(chat, 48);
  assert.equal(base(chat).prolapse, 3.4);
  assert.equal(record(chat, { prolapse: 'reduce', content: '产婆推回去' }).applied, true);
  assert.equal(base(chat).prolapse, 2.5);
  assert.equal(record(chat, { prolapse: 'reduce' }).applied, false);

  const held = setup({ prolapse: 3.4 });
  assert.equal(record(held, { prolapse: 'support', hours: 48 }).applied, true);
  hours(held, 24);
  near(base(held).prolapse, 3.1);
});

test('托住期间加重减半；修复归零后休养期加倍', () => {
  const held = setup();
  record(held, { prolapse: 'support' });
  record(held, { prolapse: 'strain_significant' });
  near(base(held).prolapse, 0.3);

  const fixed = setup({ prolapse: 3.8 });
  assert.equal(record(fixed, { prolapse: 'repair' }).applied, true);
  assert.equal(base(fixed).prolapse, 0);
  record(fixed, { prolapse: 'strain_significant' });
  near(base(fixed).prolapse, 1.2);
});

test('剧情加重照分级，经产与产后恢复更容易脱', () => {
  const chat = setup();
  record(chat, { prolapse: 'strain_significant' });
  near(base(chat).prolapse, 0.6);
  const parous = setup({}, '产后恢复');
  parous.characters.A.profile.experience.naturalBirthExperience = 3;
  record(parous, { prolapse: 'strain_slight' });
  near(base(parous).prolapse, 0.25 * 1.3 * 1.5);
});

test('工具参数检查：未知处理、hours 只给 support', () => {
  const chat = setup();
  assert.equal(record(chat, { prolapse: 'pull' }).applied, false);
  assert.equal(record(chat, { prolapse: 'repair', hours: 3 }).applied, false);
  assert.equal(record(chat, { prolapse: 'support', partner: 'B' }).applied, false);
});

test('宫脱免疫挡住加重', () => {
  const chat = setup({ uterinePressure: 50 });
  chat.characters.A.profile.immune.prolapse = true;
  hours(chat, 24);
  assert.equal(base(chat).prolapse || 0, 0);
  assert.equal(record(chat, { prolapse: 'strain_severe' }).applied, false);
});

test('剑比鞘大：明显不合起每一场加一次，同一场重插不再加', () => {
  assert.equal(getSwordProlapseStrain(1), 0);
  assert.equal(getSwordProlapseStrain(1.6), 0.1);
  assert.equal(getSwordProlapseStrain(3), 0.3);
  assert.equal(getSwordProlapseStrain(4.2), 0.6);
  assert.equal(getSwordProlapseStrain(-3), 0);
  const chat = setup();
  const insert = () => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: '巨人甲', action: 'insert', amount: 0, race: '人类', maleBodySize: 7 } });
  const first = insert();
  assert.equal(first.applied, true);
  assert.ok(base(chat).prolapse > 0, first.message);
  const after = base(chat).prolapse;
  applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: '巨人甲', action: 'withdraw', amount: 0 } });
  insert();
  assert.equal(base(chat).prolapse, after);
});

test('孕中期起最多显示 II；阴道娩出照胎重加重', () => {
  const profile = { base: { stage: '孕晚期', prolapse: 3.5 }, experience: {} };
  assert.equal(getProlapseGrade(profile), 2);
  assert.match(describeProlapse(profile), /生产后会掉出来/);
  profile.base.stage = '产后恢复';
  assert.equal(getProlapseGrade(profile), 3);

  const mother = { base: { stage: '第二产程', prolapse: 0 }, experience: {} };
  applyDeliveryProlapse(mother, [{ weight: 1 }, { weight: 1.5, laborRecord: { injuries: ['stuck'] } }]);
  near(mother.base.prolapse, 0.2 + 0.3 + 0.3 + 0.5);
});

test('尿池：II 度起每级少一成', () => {
  assert.equal(getProlapseUrineFactor({ base: { stage: '卵泡期', prolapse: 1.9 } }), 1);
  near(getProlapseUrineFactor({ base: { stage: '卵泡期', prolapse: 3.2 } }), 0.8, 1e-9);
  assert.equal(describeProlapse({ base: { prolapse: 0.4 } }), '');
});

test('孕早期 III 度以上：每天约扣每胎 2 点健康；II 度不扣', () => {
  const run = (prolapse) => {
    Math.random = () => 0.5;
    const chat = setup({}, '卵泡期');
    applyToolCall(chat, { name: 'bsDebugInjectPregnancy', arguments: { female: 'A', fetusCount: 1, equivalentDays: 40 } });
    base(chat).prolapse = prolapse;
    const fetus = () => chat.characters.A.profile.pregnant.fetuses[0];
    fetus().health = 50;
    hours(chat, 24);
    return { health: fetus().health, stage: base(chat).stage, notify: chat.characters.A.profile.notify.secondly || '' };
  };
  const calm = run(2.5);
  const out = run(3.2);
  assert.equal(out.stage, '孕早期');
  near(calm.health - out.health, 2, 0.05);
  assert.match(out.notify, /宫颈外露/);
});

test('第一产程：III 度慢 15%、IV 度慢 20%', () => {
  const profile = (prolapse) => ({ base: { stage: '第一产程', prolapse }, bio: { birthDifficulty: 1 }, experience: {}, pregnant: { fetuses: [{}] } });
  assert.equal(getProlapseFirstStageFactor(profile(2.9)), 1);
  const plain = resolveLaborPhaseHours(profile(0), '第一产程', '潜伏期', [{}], { fullStage: true });
  near(resolveLaborPhaseHours(profile(3.1), '第一产程', '潜伏期', [{}], { fullStage: true }) / plain, 1.15, 1e-9);
  near(resolveLaborPhaseHours(profile(4), '第一产程', '潜伏期', [{}], { fullStage: true }) / plain, 1.2, 1e-9);
  assert.match(describeProlapse(profile(3.1)), /扩张比平常慢/);
});
