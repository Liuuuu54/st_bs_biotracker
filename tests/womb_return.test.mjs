// 胎内回归：一名角色回到另一名角色子宫内成为胎儿，过渡后转入正常妊娠。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { deriveFetusTags } from '../scripts/fetus_tags.js';

function makeChar(name, overrides = {}) {
  return {
    name,
    initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 0, isHere: true, age: 24, race: '人类', derivedType: null,
        vitality: 100, libido: 20, uterinePressure: 10, psyStress: 30,
        eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
        ...overrides.base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { fetuses: [], fetusesCount: 0 },
      experience: {},
      immune: {},
      metabolism: {},
      skills: overrides.skills || [],
      talents: overrides.talents || [],
      children: [],
      notify: {},
      ...overrides.profile,
    },
  };
}

function setup(hostOverrides = {}, returnerOverrides = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = makeChar('艾拉', hostOverrides);
  chatState.characters['琪拉'] = makeChar('琪拉', returnerOverrides);
  return chatState;
}

const call = (chatState, name, args) => applyToolCall(chatState, { name, arguments: args });
const hostOf = (chatState) => chatState.characters['艾拉'].profile;
const returnerOf = (chatState) => chatState.characters['琪拉'].profile;

test('回归后进入回归期，多出一胎且胎重为上限', () => {
  const chatState = setup();
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 12 });
  assert.equal(result.applied, true, result.message);
  const profile = hostOf(chatState);
  assert.equal(profile.base.stage, '回归期');
  assert.equal(profile.pregnant.fetuses.length, 1);
  assert.equal(profile.pregnant.fetuses[0].weight, 3.0);
  assert.equal(profile.pregnant.wombReturn.remainingHours, 12);
});

test('母为承载者、父为回归者，种族照常混血，并带 rebirth 标签', () => {
  const chatState = setup({ base: { race: '精灵' } }, { base: { race: '龙族' } });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 1 });
  const fetus = hostOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.fathers, '琪拉');
  assert.equal(fetus.fatherRace, '龙族');
  assert.match(fetus.race, /精灵/);
  assert.match(fetus.race, /龙族/);
  assert.deepEqual(deriveFetusTags(fetus, { carrierName: '艾拉' }), ['rebirth']);
});

test('回归者的天赋跟着走，技能不跟', () => {
  const chatState = setup({}, {
    skills: [{ skillId: 1, level: 5, exp: 0 }],
    talents: [{ skillId: 1, level: 3, exp: 20 }],
  });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 1 });
  const fetus = hostOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.talents.length, 1);
  assert.equal(fetus.talents[0].skillId, 1);
  assert.equal(fetus.talents[0].level, 3);
  assert.equal(fetus.skills, undefined, '胎儿不该带技能');
});

test('回归者被完全冻结：离场且停止阶段推进', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });
  assert.equal(returnerOf(chatState).base.isHere, false);
  assert.equal(returnerOf(chatState).base.wombReturnHost, '艾拉');

  const before = returnerOf(chatState).base.days;
  call(chatState, 'bsPassedTime', { day: 30 });
  assert.equal(returnerOf(chatState).base.days, before, '冻结期间阶段不该推进');
  assert.equal(returnerOf(chatState).base.stage, '卵泡期');
});

test('设回在场即解除冻结', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });
  const result = call(chatState, 'bsSetCharacterPresence', { female: '琪拉', isPresent: true });
  assert.equal(result.applied, true);
  assert.equal(returnerOf(chatState).base.wombReturnHost, undefined);
  call(chatState, 'bsPassedTime', { day: 1 });
  assert.ok(returnerOf(chatState).base.days > 0, '解冻后应恢复推进');
});

test('hours=0 当场结算进孕早期，胎重立刻回到 1.0', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 0 });
  const profile = hostOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(profile.pregnant.fetuses[0].weight, 1.0);
  assert.equal(profile.pregnant.wombReturn, undefined);
});

test('过渡期间胎重线性回落，时间到才转孕早期', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });

  call(chatState, 'bsPassedTime', { hour: 12 });
  let profile = hostOf(chatState);
  assert.equal(profile.base.stage, '回归期', '还没到时间不该转期');
  assert.ok(profile.pregnant.fetuses[0].weight < 3.0 && profile.pregnant.fetuses[0].weight > 1.0,
    `胎重应介于 1 与 3 之间，实际 ${profile.pregnant.fetuses[0].weight}`);

  call(chatState, 'bsPassedTime', { hour: 12 });
  profile = hostOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(profile.pregnant.fetuses[0].weight, 1.0);
});

test('超出回归期的时间带进妊娠，不会凭空消失', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 2 });
  call(chatState, 'bsPassedTime', { hour: 26 });
  const profile = hostOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  // 26 小时里有 2 小时属于回归期，剩下 24 小时（1 天）算进妊娠。
  // 回归结束即孕早期第一天，所以是 1 + 1
  assert.ok(Math.abs(profile.pregnant.pregnantDays - 2) < 0.01,
    `孕龄应约为 2 天（第一天 + 溢出 1 天），实际 ${profile.pregnant.pregnantDays}`);
});

test('子宫内已有的东西会被净空，不会留下野生胎', () => {
  const chatState = setup({
    base: { stage: '排卵期', eggs: 3, sperms: [{ male: '凯', race: '人类', value: 80 }] },
  });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 6 });
  const profile = hostOf(chatState);
  assert.deepEqual(profile.base.sperms, []);
  assert.equal(profile.base.eggs, 0);
  assert.equal(profile.pregnant.fetuses.length, 1, '只该有回归胎');
  assert.deepEqual(profile.pregnant.fetuses[0].tags, ['rebirth']);
});

test('不能回归自己的子宫', () => {
  const chatState = setup();
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '艾拉' });
  assert.equal(result.applied, false);
  assert.match(result.message, /自己/);
});

test('只有月经阶段或无经期能接受回归', () => {
  const chatState = setup({ base: { stage: '孕中期' } });
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉' });
  assert.equal(result.applied, false);
  assert.match(result.message, /孕中期/);
});

test('回归期中不能再回归一次', () => {
  const chatState = setup();
  chatState.characters['贝拉'] = makeChar('贝拉');
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '贝拉', hours: 10 });
  assert.equal(result.applied, false);
  assert.match(result.message, /重复回归/);
});

test('回归期不能被 bsSetMenstrualPhases 覆盖', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  const result = call(chatState, 'bsSetMenstrualPhases', { female: '艾拉', stage: '卵泡期' });
  assert.equal(result.applied, false);
  assert.equal(hostOf(chatState).base.stage, '回归期');
});

test('回归期的衣着压力顶到上限并随时间回落', () => {
  const chatState = setup({
    profile: {
      wardrobe: {
        enabled: true,
        items: [{ id: 1, name: '连身裙', slot: 'main', masking: 6, support: 5, capacity: 5, convenience: 6 }],
      },
      outfit: { mainItemId: 1, accessoryItemIds: [], temporaryItems: [], wearState: '整齐', pregFit: null },
    },
  });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });
  const peak = hostOf(chatState).outfit.pregFit.pregWearPressure;
  assert.equal(peak, 10, '刚回归时压力应顶到上限');

  call(chatState, 'bsPassedTime', { hour: 12 });
  const midway = hostOf(chatState).outfit.pregFit.pregWearPressure;
  assert.ok(midway > 0 && midway < peak, `压力应回落，实际 ${midway}`);
});

test('生下来是全新个体，孩子带 rebirth 标签与继承来的天赋', () => {
  const chatState = setup({}, { talents: [{ skillId: 2, level: -1, exp: -10 }] });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 0 });
  // 直接推到足月再分娩
  call(chatState, 'bsPassedTime', { day: 280 });
  const result = call(chatState, 'bsChildbirth', { female: '艾拉' });
  assert.equal(result.applied, true, result.message);
  const children = hostOf(chatState).children;
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].tags, ['rebirth']);
  assert.equal(children[0].fathers, '琪拉');
  assert.equal(children[0].name, null, '未命名，所以不会变成自己生自己');
  assert.ok(children[0].id, '有独立的新 id');
  assert.equal(children[0].talents[0].skillId, 2, '继承来的天赋跟到孩子身上');
});

test('hours=0 落在孕早期第一天，不是产科偏移的第 14 天', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 0 });
  const profile = hostOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(profile.pregnant.pregnantDays, 1);
  assert.equal(profile.base.days, 1);
});

test('回归期中流产＝回归失败，回归者被放回来', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });
  assert.equal(returnerOf(chatState).base.isHere, false);

  const result = call(chatState, 'bsAbortion', { female: '艾拉' });
  assert.equal(result.applied, true, result.message);
  assert.equal(returnerOf(chatState).base.isHere, true, '回归失败应恢复原状');
  assert.equal(returnerOf(chatState).base.wombReturnHost, undefined);
  assert.equal(hostOf(chatState).base.stage, '卵泡期');
  assert.equal(hostOf(chatState).pregnant.fetuses.length, 0);

  // 恢复后阶段推进也要跟着复原
  call(chatState, 'bsPassedTime', { day: 1 });
  assert.ok(returnerOf(chatState).base.days > 0);
});

test('已经进入妊娠之后流产，回归者不再复原', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 0 });
  assert.equal(hostOf(chatState).base.stage, '孕早期');

  call(chatState, 'bsAbortion', { female: '艾拉' });
  assert.equal(returnerOf(chatState).base.isHere, false, '回归已成立，不再放人回来');
  assert.equal(returnerOf(chatState).base.wombReturnHost, '艾拉');
});
