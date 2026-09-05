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

test('回归期中堕胎＝被消化吸收，回归者不会被吐回来', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 24 });
  assert.equal(returnerOf(chatState).base.isHere, false);

  const result = call(chatState, 'bsAbortion', { female: '艾拉' });
  assert.equal(result.applied, true, result.message);
  assert.equal(returnerOf(chatState).base.isHere, false, '消化吸收后仍然离场');
  assert.equal(returnerOf(chatState).base.wombReturnHost, '艾拉', '仍并在承载者体内');
  assert.equal(hostOf(chatState).base.stage, '卵泡期');
  assert.equal(hostOf(chatState).pregnant.fetuses.length, 0);
  assert.match(String(hostOf(chatState).notify?.secondly || ''), /消化吸收/);

  // 冻结不解除：阶段仍然不推进
  call(chatState, 'bsPassedTime', { day: 1 });
  assert.equal(returnerOf(chatState).base.days, 0);
});

test('回归期不会因宫压过高而自然流产', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 200 });
  for (let i = 0; i < 80; i += 1) {
    hostOf(chatState).base.uterinePressure = 999;
    call(chatState, 'bsPassedTime', { hour: 1 });
  }
  assert.equal(hostOf(chatState).base.stage, '回归期', '宫压不该打断回归期');
  assert.equal(hostOf(chatState).pregnant.fetuses.length, 1);
  assert.equal(hostOf(chatState).experience?.miscarriageExperience || 0, 0);
});

test('已经进入妊娠之后流产，回归者不再复原', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 0 });
  assert.equal(hostOf(chatState).base.stage, '孕早期');

  call(chatState, 'bsAbortion', { female: '艾拉' });
  assert.equal(returnerOf(chatState).base.isHere, false, '回归已成立，不再放人回来');
  assert.equal(returnerOf(chatState).base.wombReturnHost, '艾拉');
});

// ── 逻辑审计补上的回归测试 ─────────────────────────────────────
test('同一个回归者不能同时在两个人体内', () => {
  const chatState = setup();
  chatState.characters['贝拉'] = makeChar('贝拉');
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  const result = call(chatState, 'bsWombReturn', { female: '贝拉', returner: '琪拉', hours: 10 });
  assert.equal(result.applied, false);
  assert.equal(chatState.characters['贝拉'].profile.pregnant.fetuses.length, 0);
});

test('自己是胎儿的人不能同时当承载者', () => {
  const chatState = setup();
  chatState.characters['贝拉'] = makeChar('贝拉');
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  // 琪拉现在是艾拉体内的胎儿；她的阶段永远不会推进，回归期会卡死在里面
  const result = call(chatState, 'bsWombReturn', { female: '琪拉', returner: '贝拉', hours: 10 });
  assert.equal(result.applied, false);
  assert.equal(returnerOf(chatState).base.stage, '卵泡期');
});

test('承载者被注销后，冻结的回归者自动解冻', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  delete chatState.characters['艾拉'];
  call(chatState, 'bsPassedTime', { day: 1 });
  assert.equal(returnerOf(chatState).base.wombReturnHost, undefined, '承载者不在了就不该继续冻着');
  assert.equal(returnerOf(chatState).base.isHere, true);
  assert.ok(returnerOf(chatState).base.days > 0, '解冻后应恢复推进');
});

test('回归期中不能植入其他胚胎', () => {
  const chatState = setup();
  chatState.characters['贝拉'] = makeChar('贝拉');
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  const result = call(chatState, 'bsImplantEmbryo', { female: '艾拉', provider: '贝拉', race: '人类' });
  assert.equal(result.applied, false);
  assert.equal(hostOf(chatState).pregnant.fetuses.length, 1);
});

test('冻结者不能被生理类工具改动', () => {
  const chatState = setup();
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  for (const [tool, args] of [
    ['bsSetMenstrualPhases', { stage: '排卵期' }],
    ['bsAddSperm', { male: '凯', race: '人类', amount: 30 }],
    ['bsChildbirth', {}],
  ]) {
    const result = call(chatState, tool, { female: '琪拉', ...args });
    assert.equal(result.applied, false, `${tool} 不该对冻结者生效`);
  }
  assert.equal(returnerOf(chatState).base.stage, '卵泡期');
  assert.deepEqual(returnerOf(chatState).base.sperms, []);
});

test('hours 传非数字或负数会被拒绝，不再静默当成瞬间完成', () => {
  for (const bad of [-5, 'abc', NaN]) {
    const chatState = setup();
    const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: bad });
    assert.equal(result.applied, false, `hours=${bad} 应被拒绝`);
    assert.equal(hostOf(chatState).base.stage, '卵泡期', '被拒绝时不该改动状态');
  }
});

test('回归期的心理更新走 preg 组', () => {
  const chatState = setup({
    profile: {
      // 有 stageProfiles 才算「已推演繁育心理」，否则会先被那道闸门挡下
      psychology: { mens: { stance: 50 }, preg: { stance: 50 }, stageProfiles: { mens: {}, preg: {} } },
    },
  });
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '琪拉', hours: 10 });
  // 写 mens 会被拒绝（阶段期待 preg）——写进 mens 的资料会在转入妊娠满 7 天时被清空
  const result = call(chatState, 'bsUpdatePsychology', { female: '艾拉', options: { mens: { stance: 2 } } });
  assert.equal(result.applied, false);
  assert.match(result.message, /preg/);
});

// ── 常态用法：user 被吞，或吞一个未注册的路人 ───────────────────
test('回归者不必是已注册角色：user 被吞', () => {
  const chatState = setup();
  delete chatState.characters['琪拉'];
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '用户', hours: 6 });
  assert.equal(result.applied, true, result.message);
  const fetus = hostOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.fathers, '用户');
  assert.deepEqual(fetus.tags, ['rebirth']);
  assert.equal(chatState.characters['用户'], undefined, '不该凭空注册出一个角色');
});

test('未注册的回归者可用 returnerRace 指定种族，含衍生类型', () => {
  const chatState = setup({ base: { race: '人类' } });
  delete chatState.characters['琪拉'];
  call(chatState, 'bsWombReturn', {
    female: '艾拉', returner: '无名旅人', returnerRace: '[血族]龙族', hours: 1,
  });
  const fetus = hostOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.fatherRace, '龙族');
  assert.equal(fetus.fatherDerivedType, '血族');
  assert.match(fetus.race, /龙族/);
});

test('未注册且没给种族时，视同与承载者同族', () => {
  const chatState = setup({ base: { race: '精灵' } });
  delete chatState.characters['琪拉'];
  call(chatState, 'bsWombReturn', { female: '艾拉', returner: '路人', hours: 1 });
  const fetus = hostOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.fatherRace, '精灵');
  assert.equal(fetus.race, '精灵');
});

test('returnerRace 优先于已注册角色自己的种族', () => {
  const chatState = setup({ base: { race: '人类' } }, { base: { race: '龙族' } });
  call(chatState, 'bsWombReturn', {
    female: '艾拉', returner: '琪拉', returnerRace: '兽人', hours: 1,
  });
  assert.equal(hostOf(chatState).pregnant.fetuses[0].fatherRace, '兽人');
});

test('未注册的回归者没有冻结这回事，也没有天赋可继承', () => {
  const chatState = setup();
  delete chatState.characters['琪拉'];
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '用户', hours: 4 });
  assert.match(result.message, /unregistered/);
  assert.deepEqual(hostOf(chatState).pregnant.fetuses[0].talents, []);
  // 回归失败时也不该因为找不到回归者而炸掉
  const aborted = call(chatState, 'bsAbortion', { female: '艾拉' });
  assert.equal(aborted.applied, true, aborted.message);
  assert.equal(hostOf(chatState).base.stage, '卵泡期');
});

test('returner 为空仍要拒绝', () => {
  const chatState = setup();
  const result = call(chatState, 'bsWombReturn', { female: '艾拉', returner: '  ' });
  assert.equal(result.applied, false);
});
