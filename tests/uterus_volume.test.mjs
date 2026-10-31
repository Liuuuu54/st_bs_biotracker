// 体型决定子宫容积：人类 4 级为 1，每级翻倍。子宫图的精液容量、每天排掉的量、受孕的剂量与暴露都按女方容积换算，
// 同体型的一对与人类一样；射精建议量写在工具说明里，按精方体型翻倍。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { getBodySizeVolumeFactor, getUterusVolumeFactor } from '../scripts/body_size.js';
import { calculateFertilizationPreview } from '../scripts/calculator.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { getSemenCapacity } from '../scripts/uterus_layout.js';

test('容积倍率：4 级为 1，每级翻倍，截在 1–7；可变或未知体型为 1', () => {
  assert.equal(getBodySizeVolumeFactor(4), 1);
  assert.equal(getBodySizeVolumeFactor(6), 4);
  assert.equal(getBodySizeVolumeFactor(2), 0.25);
  assert.equal(getBodySizeVolumeFactor(9), 8);
  assert.equal(getBodySizeVolumeFactor('不是数字'), 1);
  assert.equal(getUterusVolumeFactor({ race: '人类' }), 1);
  assert.equal(getUterusVolumeFactor({ race: '人类', bodySize: 5 }), 2, '个体体型优先');
  assert.equal(getUterusVolumeFactor({ race: '没收录的种族' }), 1);
});

test('子宫图的精液容量乘女方容积倍率，人类不变', () => {
  const empty = { gestating: false, emptyStage: '排卵期', emptyLining: 7, emptyProgress: 0, days: 0, fetuses: [], pressureLevel: 0 };
  assert.equal(getSemenCapacity(empty), 100);
  assert.equal(getSemenCapacity({ ...empty, volumeFactor: 4 }), 400);
  assert.equal(getSemenCapacity({ ...empty, volumeFactor: 0.25 }), 25);
});

test('受孕预览按容积换算：巨体一对射四倍的量，难易与人类一样', () => {
  const human = calculateFertilizationPreview({ elapsedDays: 1, spermSources: [{ race: '人类', value: 20 }] });
  const giant = calculateFertilizationPreview({ elapsedDays: 1, spermSources: [{ race: '人类', value: 80 }], uterusVolumeFactor: 4 });
  assert.equal(giant.successChance, human.successChance);
  assert.equal(giant.effectiveExposureDays, human.effectiveExposureDays);
  assert.equal(giant.spermDoseBonus, human.spermDoseBonus);
  // 同样 20 射进巨体：两天就排完、剂量偏低，比人类难
  const thin = calculateFertilizationPreview({ elapsedDays: 1, spermSources: [{ race: '人类', value: 20 }], uterusVolumeFactor: 4 });
  assert.ok(thin.successChance < human.successChance);
});

test('残留每天排掉的量随女方体型：6 级每天 40', () => {
  const ctx = { chatId: 'uterus-volume', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  const female = state.createDefaultFemaleState('巨');
  female.initialized = true;
  female.profile.base.age = 24;
  female.profile.base.stage = '卵泡期';
  female.profile.base.bodySize = 6;
  female.profile.base.sperms = [{ male: '龙', race: '人类', value: 80 }];
  chatState.characters['巨'] = female;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  const left = chatState.characters['巨'].profile.base.sperms.reduce((sum, item) => sum + item.value, 0);
  assert.equal(left, 40);
});

test('射精建议量写在工具说明里，按精方体型每级翻倍', () => {
  const description = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsAddSperm').description;
  assert.match(description, /按精方体型每级翻倍/);
  assert.match(description, /女方体型每级翻倍/);
});

test('套子照精方尺寸：6 级精方一次射 80 不会撑破，人类射 80 会', () => {
  const run = (maleBodySize) => {
    const ctx = { chatId: 'condom-' + maleBodySize, chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
    globalThis.SillyTavern = { getContext: () => ctx };
    const chatState = state.getChatState(ctx, state.getSettings(ctx));
    const female = state.createDefaultFemaleState('甲');
    female.initialized = true;
    female.profile.base.age = 24;
    female.profile.base.stage = '卵泡期';
    chatState.characters['甲'] = female;
    const call = (action, amount) => applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '甲', male: '乙', race: '人类', action, amount, hasCondom: true, maleBodySize } });
    call('insert', 0);
    const realRandom = Math.random; Math.random = () => 0;
    try { call('deposit', 80); } finally { Math.random = realRandom; }
    return chatState.characters['甲'].profile.lastCondomResult;
  };
  assert.equal(run(6).condomFailed, false);
  assert.equal(run(4).condomFailReason, 'overflow');
});

function setupFemale(name, bodySize) {
  const ctx = { chatId: 'overflow-' + name, chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const chatState = state.getChatState(ctx, state.getSettings(ctx));
  const female = state.createDefaultFemaleState(name);
  female.initialized = true;
  female.profile.base.age = 24;
  female.profile.base.stage = '排卵期';
  female.profile.base.bodySize = bodySize;
  chatState.characters[name] = female;
  return chatState;
}
const totalSperm = (chatState, name) => chatState.characters[name].profile.base.sperms.reduce((sum, item) => sum + item.value, 0);

test('射精当下装不下的就流出：6 级精方射进 2 级女方，只留到刚好装满，与子宫图同一个容量', async () => {
  const { getCharacterSemenCapacity } = await import('../scripts/tools.js');
  const { computeUterusLayout } = await import('../scripts/uterus_layout.js');
  const chatState = setupFemale('妖', 2);
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '妖', male: '龙', race: '人类', action: 'insert', amount: 0, maleBodySize: 6 } });
  const result = applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '妖', male: '龙', race: '人类', action: 'deposit', amount: 80 } });
  const profile = chatState.characters['妖'].profile;
  const capacity = getCharacterSemenCapacity(profile);
  assert.equal(capacity, 25, '2 级排卵期：100 × 0.25');
  assert.equal(Math.round(totalSperm(chatState, '妖')), 25);
  assert.match(result.message, /流出 55/);
  assert.equal(computeUterusLayout(profile).semenCapacity, capacity, '画面与引擎同一个容量');
  const contacts = profile.base.spermContacts.reduce((sum, item) => sum + item.value, 0);
  assert.equal(Math.round(contacts), 25, '接触纪录跟着缩');
});

test('装得下就不流出；时间推进后也不会超过容量', () => {
  const chatState = setupFemale('人', 4);
  applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '人', male: '甲', race: '人类', action: 'insert', amount: 0 } });
  const result = applyToolCall(chatState, { name: 'bsAddSperm', arguments: { female: '人', male: '甲', race: '人类', action: 'deposit', amount: 30 } });
  assert.doesNotMatch(result.message, /流出/);
  assert.equal(totalSperm(chatState, '人'), 30);
  chatState.characters['人'].profile.base.sperms[0].value = 500;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
  assert.ok(totalSperm(chatState, '人') <= 125, `推进后仍超出：${totalSperm(chatState, '人')}`);
});

test('伴生卵撑大子宫的份量依胎儿族缩小：蛙族满窝 35 颗撑得比旧的每颗 0.15 少，仍比没有卵多', () => {
  const at = (race) => getSemenCapacity({ gestating: true, days: 200, fetuses: [{ race, weight: 1, companionEggCount: 35 }], pressureLevel: 0 });
  const none = getSemenCapacity({ gestating: true, days: 200, fetuses: [{ weight: 1 }], pressureLevel: 0 });
  assert.ok(at('蛙族') < at(null));
  assert.ok(at('蛙族') > none);
});
