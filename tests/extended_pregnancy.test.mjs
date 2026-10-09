// 延产（v1.0.7）：逾期用延产手段拖到 52 周，之后每次在产兆前驱再延 28 天。
// 延产期是「黏住」的妊娠阶段：宫压不累积、也不会引发流产或产程，羊膜每天回复，
// 只能用 action=induce 引产退出；第二次延产起累积子宫乏力。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { computePostpartumRecoveryDays } from '../scripts/race_config.js';
import { applyToolCall, getPregnancyPressureRisk } from '../scripts/tools.js';
import { applyRegistryResult } from '../scripts/registry.js';

const fetus = (over = {}) => ({
  embryoId: 1, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生',
  weight: 1, tendencyAngle: 0, backSide: 'left_anterior', affinity: 0, amnionDurability: 100, ...over,
});

function overdue({ days = 300, isHere = true, fetusCount = 1 } = {}) {
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  Object.assign(character.profile.base, { stage: '逾期', days: days - 294, isHere, race: '人类', vitalityLevel: 4 });
  Object.assign(character.profile.bio, { birthDifficulty: 1, breedTolerance: 1, identicalProbability: 0 });
  character.profile.pregnant.pregnantDays = days;
  character.profile.pregnant.effectivePregnantDays = days;
  character.profile.pregnant.fetuses = Array.from({ length: fetusCount }, (_, i) => fetus({ embryoId: i + 1 }));
  character.profile.pregnant.fetusesCount = fetusCount;
  chatState.characters.A = character;
  return chatState;
}

const P = (chatState) => chatState.characters.A.profile;
const call = (chatState, name, args) => applyToolCall(chatState, { name, arguments: { female: 'A', ...args } });
const passDays = (chatState, day) => call(chatState, 'bsPassedTime', { day });
const extend = (chatState, reason = '延产圣术') => call(chatState, 'bsExtendPregnancy', { action: 'extend', reason });

test('逾期第一次延产：进入延产期并维持到 52 周，宫压归零、羊膜回满', () => {
  const chatState = overdue();
  P(chatState).base.uterinePressure = 120;
  P(chatState).pregnant.fetuses[0].amnionDurability = 40;
  const result = extend(chatState);
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).base.stage, '延产期');
  assert.equal(P(chatState).pregnant.extensionCount, 1);
  assert.equal(P(chatState).pregnant.extensionUntilDays, 364);
  assert.equal(P(chatState).base.uterinePressure, 0);
  assert.equal(P(chatState).pregnant.fetuses[0].amnionDurability, 100);
  assert.equal(P(chatState).base.uterineAtony, 0, '第一次延产不加乏力');
});

test('延产期间宫压再高也不会发动，离场超过 44 周也不强制发动', () => {
  for (const isHere of [true, false]) {
    const chatState = overdue({ isHere });
    extend(chatState);
    for (let day = 0; day < 60; day += 1) {
      call(chatState, 'bsUpdateCharacterStatus', { options: { uterinePressure: 999 } });
      passDays(chatState, 1);
      assert.equal(P(chatState).base.stage, '延产期', `isHere=${isHere} 第 ${day} 天不该离开延产期`);
    }
    assert.ok(P(chatState).base.uterinePressure > 0, '工具仍可调高宫压');
    assert.equal(getPregnancyPressureRisk(P(chatState)), null, '延产期不显示宫压风险');
    assert.ok(P(chatState).pregnant.fetuses.every((item) => item.amnionDurability > 0), '延产期不会破水');
  }
});

test('延产期不自行累积宫压，羊膜每天回复 5', () => {
  const chatState = overdue();
  extend(chatState);
  P(chatState).pregnant.fetuses[0].amnionDurability = 50;
  passDays(chatState, 2);
  assert.equal(P(chatState).base.uterinePressure, 0);
  assert.equal(P(chatState).pregnant.fetuses[0].amnionDurability, 60);
});

test('满 52 周进入产兆前驱；在产兆前驱再延 28 天并加深乏力', () => {
  const chatState = overdue({ days: 360 });
  extend(chatState);
  passDays(chatState, 5);
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(P(chatState).pregnant.prodromalOriginStage, '延产期');
  assert.equal(P(chatState).pregnant.extensionUntilDays, null);

  const effective = P(chatState).pregnant.effectivePregnantDays;
  const result = extend(chatState);
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).base.stage, '延产期');
  assert.equal(P(chatState).pregnant.extensionCount, 2);
  assert.equal(P(chatState).pregnant.extensionUntilDays, effective + 28);
  assert.equal(P(chatState).base.uterineAtony, 1);
  assert.equal(P(chatState).pregnant.prodromalRemainingHours, 0, '产兆前驱的暂态要清掉');

  extend(chatState); // 延产期内不能再延
  assert.equal(P(chatState).pregnant.extensionCount, 2);
});

test('只能在逾期或由逾期／延产期进入的产兆前驱延产', () => {
  const term = overdue({ days: 270 });
  P(term).base.stage = '临产期';
  assert.equal(extend(term).applied, false);

  const prodromalFromTerm = overdue({ days: 270 });
  Object.assign(P(prodromalFromTerm).base, { stage: '产兆前驱' });
  P(prodromalFromTerm).pregnant.prodromalOriginStage = '临产期';
  assert.equal(extend(prodromalFromTerm).applied, false, '临产期发动的是正常足月生产');

  const prodromalFromOverdue = overdue();
  Object.assign(P(prodromalFromOverdue).base, { stage: '产兆前驱' });
  P(prodromalFromOverdue).pregnant.prodromalOriginStage = '逾期';
  assert.equal(extend(prodromalFromOverdue).applied, true);
  assert.equal(P(prodromalFromOverdue).pregnant.extensionUntilDays, 364);

  const ruptured = overdue();
  P(ruptured).pregnant.fetuses[0].amnionDurability = 0;
  assert.equal(extend(ruptured).applied, false, '已破水不能延产');
});

test('延产期只能引产退出：剖腹与终止妊娠被拒，引产进入产兆前驱', () => {
  const chatState = overdue();
  extend(chatState);
  assert.equal(call(chatState, 'bsChildbirth', {}).applied, false);
  assert.equal(call(chatState, 'bsAbortion', {}).applied, false);
  assert.equal(P(chatState).base.stage, '延产期');

  const result = call(chatState, 'bsExtendPregnancy', { action: 'induce', reason: '解除圣术' });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).base.stage, '产兆前驱');
  assert.equal(P(chatState).pregnant.prodromalOriginStage, '延产期');
  assert.equal(call(chatState, 'bsExtendPregnancy', { action: 'induce', reason: 'x' }).applied, false, '不在延产期不能引产');
  assert.equal(call(chatState, 'bsChildbirth', {}).applied, true, '引产后可以剖腹');
});

test('子宫乏力：宫压与性欲上限下降，产后恢复变长，恢复结束后清零', () => {
  const chatState = overdue({ days: 360 });
  extend(chatState);
  passDays(chatState, 5);
  extend(chatState);
  passDays(chatState, 29);
  extend(chatState);
  assert.equal(P(chatState).base.uterineAtony, 2);

  // 性欲灌满会触发高潮额外排卵（宫压 +2、性欲归零），先占掉冷却，只看上限
  P(chatState).cooldown.orgasmOvulationUsed = true;
  call(chatState, 'bsUpdateCharacterStatus', { options: { uterinePressure: 999, libido: 999 } });
  assert.equal(P(chatState).base.uterinePressure, 120, '宫压上限 150 × 0.8');
  assert.equal(P(chatState).base.libido, 120, '性欲上限 150 × 0.8');

  call(chatState, 'bsExtendPregnancy', { action: 'induce', reason: 'x' });
  call(chatState, 'bsChildbirth', {});
  assert.equal(P(chatState).base.stage, '产后恢复');
  assert.equal(P(chatState).bio.recoveryDays, computePostpartumRecoveryDays({ atonyLevel: 2 }));
  assert.equal(P(chatState).bio.recoveryDays, 67, '56 × 1.2');

  passDays(chatState, 70);
  assert.equal(P(chatState).base.uterineAtony, 0, '产后恢复结束才清除乏力');
});

test('延产期母胎互动的亲和波动加倍', () => {
  const chatState = overdue();
  extend(chatState);
  call(chatState, 'bsMaternalFetalInteraction', { direction: 'fetal', change: 'significant_increase' });
  assert.equal(P(chatState).pregnant.fetuses[0].affinity, 2);
});

test('延产期胎位角度不再自然漂移', () => {
  const chatState = overdue();
  extend(chatState);
  P(chatState).pregnant.fetuses[0].tendencyAngle = 90;
  for (let day = 0; day < 20; day += 1) passDays(chatState, 1);
  assert.equal(P(chatState).pregnant.fetuses[0].tendencyAngle, 90);
});

test('存档同步不会把延产期推算回逾期', () => {
  const chatState = overdue();
  extend(chatState);
  const synced = state.syncCharacterStageFromProfile(chatState.characters.A);
  assert.equal(synced.profile.base.stage, '延产期');
});

function register(profile) {
  const chatState = state.createEmptyChatState();
  const character = applyRegistryResult(chatState, { name: 'R', profile });
  return character.profile;
}
const human = (pregnant, extra = {}) => ({
  base: { race: '人类', vitalityLevel: 4 },
  pregnant: { fetusesCount: 1, fetuses: [{ fathers: '甲', race: '人类', gender: '女', embryoType: '胎生' }], ...pregnant },
  ...extra,
});

test('注册：发育进度直接是有效孕日，冻结或极慢的变速倍率不会把足月换算回孕早期', () => {
  for (const multiplier of [0, 0.1]) {
    const profile = register(human({ gestationalAgeDays: 281 }, { bio: { gestationModifierMultiplier: multiplier, gestationModifierName: '慢孕' } }));
    assert.equal(profile.pregnant.effectivePregnantDays, 281, `倍率 ${multiplier}`);
    assert.equal(profile.base.stage, '临产期', `倍率 ${multiplier}`);
  }
});

test('注册：只给实际天数时仍按种族妊娠速度换算（精灵怀孕 500 天）', () => {
  const profile = register({
    base: { race: '精灵' },
    pregnant: { pregnantDays: 500, fetusesCount: 1, fetuses: [{ fathers: '甲', race: '精灵', gender: '女', embryoType: '胎生' }] },
  });
  assert.equal(profile.pregnant.pregnantDays, 500);
  assert.equal(profile.pregnant.effectivePregnantDays, 250);
});

test('注册：延产中的角色直接进入延产期，乏力按次数推定', () => {
  const first = register(human({ gestationalAgeDays: 330, extensionCount: 1 }));
  assert.equal(first.base.stage, '延产期');
  assert.equal(first.pregnant.extensionUntilDays, 364);
  assert.equal(first.base.uterineAtony, 0);

  const third = register(human({ gestationalAgeDays: 400, extensionCount: 3 }));
  assert.equal(third.base.stage, '延产期');
  assert.equal(third.pregnant.extensionUntilDays, 428);
  assert.equal(third.base.uterineAtony, 2);

  const noExtension = register(human({ gestationalAgeDays: 300 }));
  assert.equal(noExtension.base.stage, '逾期', '没写延产次数就只是逾期');
  assert.equal(noExtension.pregnant.extensionCount, 0);
});

test('存档 v2 → v3：补上延产与乏力栏位', () => {
  const ctx = { chatId: 'migration-v3', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = overdue();
  delete chatState.characters.A.profile.pregnant.extensionCount;
  delete chatState.characters.A.profile.pregnant.extensionUntilDays;
  delete chatState.characters.A.profile.base.uterineAtony;
  chatState.schemaVersion = 2;
  settings.chatStates['migration-v3'] = chatState;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.characters.A.profile.pregnant.extensionCount, 0);
  assert.equal(migrated.characters.A.profile.pregnant.extensionUntilDays, null);
  assert.equal(migrated.characters.A.profile.base.uterineAtony, 0);
});

test('注册：怀胎三年（只给经过时间）用变速倍率换算成发育进度', () => {
  const profile = register(human({ pregnantDays: 1095 }, { bio: { gestationModifierMultiplier: 0.256, gestationModifierName: '三年之孕' } }));
  assert.equal(profile.pregnant.pregnantDays, 1095);
  assert.ok(Math.abs(profile.pregnant.effectivePregnantDays - 280.32) < 0.01);
  assert.equal(profile.base.stage, '临产期');
});

test('注册（用户案例）：写明延产但孕周不足 42 周，当作刚满 42 周进入延产期', () => {
  const profile = register(human({ gestationalAgeDays: 281, extensionCount: 1 }));
  assert.equal(profile.base.stage, '延产期');
  assert.equal(profile.pregnant.effectivePregnantDays, 294);
  assert.equal(profile.pregnant.extensionUntilDays, 364);
});

test('注册（用户案例）：重新注册时，结果没有特殊变速就清掉上一次留下的倍率', () => {
  const chatState = state.createEmptyChatState();
  applyRegistryResult(chatState, { name: 'R', profile: human({ pregnantDays: 281 }, { bio: { gestationModifierMultiplier: 0.1, gestationModifierName: '错误的延产倍率' } }) });
  assert.equal(chatState.characters.R.profile.bio.gestationModifierMultiplier, 0.1);
  const again = applyRegistryResult(chatState, { name: 'R', profile: human({ gestationalAgeDays: 300, extensionCount: 1 }) });
  assert.equal(again.profile.bio.gestationModifierMultiplier, 1);
  assert.equal(again.profile.bio.gestationModifierName, '');
  assert.equal(again.profile.base.stage, '延产期');
});

test('注册页「此角色使用妊娠变速」：没勾时提示词禁止写变速，模型写了也不采用', async () => {
  const { buildRegistrySystemPrompt } = await import('../scripts/registry.js');
  const off = buildRegistrySystemPrompt({}, {});
  const on = buildRegistrySystemPrompt({}, { useGestationModifier: true });
  assert.match(off, /没有为这名角色开启妊娠变速/);
  assert.doesNotMatch(off, /丰饶祝福/);
  assert.match(on, /使用者已确认这名角色使用妊娠变速/);

  const chatState = state.createEmptyChatState();
  const withModifier = human({ pregnantDays: 281 }, { bio: { gestationModifierMultiplier: 0.1, gestationModifierName: '延产体质' } });
  const dropped = applyRegistryResult(chatState, { name: 'R', profile: withModifier }, { useGestationModifier: false });
  assert.equal(dropped.profile.bio.gestationModifierMultiplier, 1, '没勾就不采用模型写的倍率');
  assert.equal(dropped.profile.pregnant.effectivePregnantDays, 281, '也就不会被换算回孕早期');
  assert.equal(dropped.profile.base.stage, '临产期');

  const kept = applyRegistryResult(state.createEmptyChatState(), { name: 'R', profile: withModifier }, { useGestationModifier: true });
  assert.equal(kept.profile.bio.gestationModifierMultiplier, 0.1);
});

test('真实产程下，延产后引产或期满发动的产程不会因宫压归零而永远停滞', () => {
  for (const route of ['induce', 'expire']) {
    const chatState = overdue();
    P(chatState).immune = { ...P(chatState).immune, realisticLabor: true };
    extend(chatState);
    if (route === 'induce') call(chatState, 'bsExtendPregnancy', { action: 'induce', reason: '解除圣术' });
    for (let day = 0; day < 80 && P(chatState).base.stage === '延产期'; day += 1) passDays(chatState, 1);
    assert.equal(P(chatState).base.stage, '产兆前驱', route);
    assert.ok(P(chatState).base.uterinePressure >= 0.66 * 140, `${route}: 宫压补到自然发动门槛`);
    for (let hour = 0; hour < 400 && !['第三产程', '产后恢复'].includes(P(chatState).base.stage); hour += 1) {
      if (P(chatState).pregnant.laborPhase === '过渡期') call(chatState, 'bsAssistFetalPosition', { action: 'rupture' });
      call(chatState, 'bsPassedTime', { hour: 1 });
    }
    assert.ok(['第三产程', '产后恢复'].includes(P(chatState).base.stage), `${route}: ${P(chatState).base.stage}`);
  }
});

test('延产改变阶段后重建提醒，跨日的日记提示仍完整保留', () => {
  const chatState = overdue();
  passDays(chatState, 1);
  assert.match(P(chatState).notify.thirdly, /已跨入新的一天；若角色有值得沉淀.*bsWriteDiary/);
  extend(chatState);
  assert.match(P(chatState).notify.thirdly, /正在延产期/);
  assert.match(P(chatState).notify.thirdly, /已跨入新的一天；若角色有值得沉淀.*bsWriteDiary/);
});
