import assert from 'node:assert/strict';
import test from 'node:test';
import * as state from '../scripts/state.js';
import { applyToolCall, getStageLimit, getNextMenstrualStage } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';
import { getRacePhysiologyProfile } from '../scripts/race_config.js';

// 真实公开工具同时覆盖默认与混合池；期限、后继和季节计数由宿主共用策略决定。
const copy = (value) => JSON.parse(JSON.stringify(value));
const near = (a, b, eps = 2e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const profile = (chat) => chat.characters['母方'].profile;
const base = (chat) => profile(chat).base;
function setup(pooled, race, stage = '月经期', days = 0, seasonCycle = 0) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('母方');
  mother.initialized = true;
  Object.assign(mother.profile.base, { age: 24, race, stage, days, seasonCycle,
    eggs: 0, bodySize: 4, vitality: 100, libido: 0, psyStress: 0, isHere: false });
  Object.assign(mother.profile.bio, getRacePhysiologyProfile(race));
  mother.profile.immune.metabolism = true;
  mother.runtime = { dayCarryMinutes: 0, hourCarryMinutes: 0, lifestyleWeekCarryMinutes: 0 };
  chat.characters['母方'] = mother;
  if (pooled) enablePooledConception(mother.profile.base, 0, { seed: '阶段与季节原生合同' });
  return chat;
}
function pass(chat, day) {
  const result = applyToolCall(chat, { name: 'bsPassedTime', arguments: { day } });
  assert.equal(result.applied, true, result.message);
  return result;
}
function phase(chat) {
  const b = base(chat);
  return { stage: b.stage, days: b.days, seasonCycle: b.seasonCycle, eggs: b.eggs,
    naturalOvulationUsed: Boolean(profile(chat).cooldown.naturalOvulationUsed) };
}
function samePhase(actual, expected) {
  const { days: a, ...left } = phase(actual);
  const { days: b, ...right } = phase(expected);
  assert.deepEqual(left, right);
  near(a, b);
}

for (const pooled of [false, true]) {
  const mode = pooled ? '混合池' : '默认';
  test(`${mode}人类零日乏情直接跳回卵泡，连续多轮不生成伪乏情或死循环`, () => {
    const chat = setup(pooled, '人类');
    assert.equal(getStageLimit(profile(chat), '乏情期'), 0);
    pass(chat, 5.125);
    assert.equal(base(chat).stage, '卵泡期');
    near(base(chat).days, 0.125);
    assert.equal(base(chat).seasonCycle, 0);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      pass(chat, 28);
      assert.equal(base(chat).stage, '卵泡期');
      near(base(chat).days, 0.125);
      assert.equal(base(chat).seasonCycle, 0);
    }
    assert.equal('spermPool' in base(chat), pooled);
  });

  test(`${mode}手动进入人类零日乏情立即跳过，不赠送自然排卵或停在零长度阶段`, () => {
    const chat = setup(pooled, '人类', '月经期', 1);
    const result = applyToolCall(chat, { name: 'bsSetMenstrualPhases', arguments: { female: '母方', stage: '乏情期' } });
    assert.equal(result.applied, true, result.message);
    assert.equal(base(chat).stage, '卵泡期');
    assert.equal(base(chat).days, 0);
    assert.equal(base(chat).eggs, 0);
    assert.equal(base(chat).seasonCycle, 0);
    const tick = applyToolCall(chat, { name: 'bsPassedTime', arguments: { minute: 0.5 } });
    assert.equal(tick.applied, true, tick.message);
    assert.equal(base(chat).stage, '卵泡期');
    near(base(chat).days, 0.5 / 1440);
    assert.equal(base(chat).eggs, 0);
  });

  test(`${mode}天使月经7.5日后乏情322日，乏情退出不重复增加已完成轮数`, () => {
    const chat = setup(pooled, '天使');
    near(getStageLimit(profile(chat), '月经期'), 7.5);
    assert.equal(getStageLimit(profile(chat), '乏情期'), 322);
    pass(chat, 7.625);
    assert.equal(base(chat).stage, '乏情期');
    near(base(chat).days, 0.125);
    assert.equal(base(chat).seasonCycle, 0);
    pass(chat, 321.75);
    assert.equal(base(chat).stage, '乏情期');
    near(base(chat).days, 321.875);
    pass(chat, 0.25);
    assert.equal(base(chat).stage, '卵泡期');
    near(base(chat).days, 0.125);
    assert.equal(base(chat).seasonCycle, 0);
  });

  for (const [race, cycles, dormancy] of [['兽耳族', 3, 120], ['半人马', 8, 197]]) {
    test(`${mode}${race}第${cycles - 1}轮月经后直接卵泡，第${cycles}轮完成才归零进入乏情`, () => {
      const chat = setup(pooled, race, '月经期', 0, cycles - 2);
      pass(chat, 3.875);
      assert.equal(base(chat).stage, '卵泡期');
      near(base(chat).days, 0.125);
      assert.equal(base(chat).seasonCycle, cycles - 1);
      pass(chat, 21);
      assert.equal(base(chat).stage, '乏情期');
      near(base(chat).days, 0.125);
      assert.equal(base(chat).seasonCycle, 0);
      pass(chat, dormancy);
      assert.equal(base(chat).stage, '卵泡期');
      near(base(chat).days, 0.125);
      assert.equal(base(chat).seasonCycle, 0);
    });
  }

  test(`${mode}跨两季长跳与不在边界的小数切片及JSON恢复保持季节与阶段相同`, () => {
    const original = setup(pooled, '兽耳族', '卵泡期', 1.125);
    const whole = copy(original);
    let sliced = copy(original);
    pass(whole, 390.375);
    for (const day of [17.375, 124.5, 31.25, 183.125, 34.125]) {
      sliced = copy(sliced);
      pass(sliced, day);
    }
    assert.equal(base(whole).stage, '卵泡期');
    near(base(whole).days, 4.5);
    assert.equal(base(whole).seasonCycle, 1);
    samePhase(sliced, whole);
    assert.equal(sliced.minutesPassed, whole.minutesPassed);
    if (pooled) assert.equal(base(sliced).spermPool.lastMinute, sliced.minutesPassed);
  });

  test(`${mode}v11原生JSON和完整及差分快照保留季节轮次，恢复后仍按第八轮进入乏情`, () => {
    const chat = setup(pooled, '半人马', '月经期', 3.5, 6);
    assert.equal(chat.schemaVersion, 11);
    const ctx = { chatId: `season-v11-${pooled}`, chat: [{ name: '母方', is_user: false, mes: '本季第七轮' }] };
    state.recordChatStateSnapshot(ctx, chat, { messageCount: 1, reason: 'season-before' });
    pass(chat, 0.375);
    assert.equal(base(chat).seasonCycle, 7);
    assert.equal(base(chat).stage, '卵泡期');
    ctx.chat.push({ name: '母方', is_user: false, mes: '本季第八轮' });
    state.recordChatStateSnapshot(ctx, chat, { messageCount: 2, reason: 'season-after' });
    assert.equal(chat.snapshots[0].snapshotMode, 'full');
    assert.equal(chat.snapshots[1].snapshotMode, 'patch');
    const expected = copy(chat);
    const restored = copy(chat);
    base(restored).seasonCycle = 99;
    state.restoreChatStateFromSnapshot(restored, restored.snapshots[0]);
    assert.equal(base(restored).seasonCycle, 6);
    assert.equal(base(restored).stage, '月经期');
    state.restoreChatStateFromSnapshot(restored, restored.snapshots[1]);
    assert.equal(base(restored).seasonCycle, 7);
    assert.equal(base(restored).stage, '卵泡期');
    assert.equal(state.getSnapshotCharacter(restored, 0, '母方').profile.base.seasonCycle, 6);
    assert.equal(state.getSnapshotCharacter(restored, 1, '母方').profile.base.seasonCycle, 7);
    pass(expected, 21); pass(restored, 21);
    assert.equal(base(restored).stage, '乏情期');
    assert.equal(base(restored).seasonCycle, 0);
    samePhase(restored, expected);
    if (pooled) assert.equal(base(restored).spermPool.lastMinute, restored.minutesPassed);
  });
}

test('混合池近期伴侣跨阶段正常推进，并按活动周期而非197日乏情清除', () => {
  const chat = setup(true, '半人马', '月经期', 0, 6);
  base(chat).latestSexDays = 0;
  profile(chat).experience.latestSexPartner = '父方';
  pass(chat, 4);
  assert.equal(base(chat).stage, '卵泡期');
  assert.equal(base(chat).seasonCycle, 7);
  assert.equal(profile(chat).experience.latestSexPartner, '父方');
  pass(chat, 18);
  assert.equal(base(chat).latestSexDays, -1);
  assert.equal(profile(chat).experience.latestSexPartner, null);
});

test('共用阶段策略只有月经结束增加季节计数，零天乏情在同一策略中跳过', () => {
  const horse = setup(false, '半人马');
  const p = profile(horse);
  assert.equal(getNextMenstrualStage(p, '卵泡期'), '排卵期');
  assert.equal(getNextMenstrualStage(p, '排卵期'), '黄体期');
  assert.equal(getNextMenstrualStage(p, '黄体期'), '月经期');
  assert.equal(p.base.seasonCycle, 0);
  assert.equal(getNextMenstrualStage(p, '月经期'), '卵泡期');
  assert.equal(p.base.seasonCycle, 1);
  p.base.seasonCycle = 7;
  assert.equal(getNextMenstrualStage(p, '月经期'), '乏情期');
  assert.equal(p.base.seasonCycle, 0);
  assert.equal(getNextMenstrualStage(p, '乏情期'), '卵泡期');
  assert.equal(p.base.seasonCycle, 0);
  const human = profile(setup(false, '人类'));
  assert.equal(getNextMenstrualStage(human, '月经期'), '卵泡期');
  assert.equal(human.base.seasonCycle, 0);
});
