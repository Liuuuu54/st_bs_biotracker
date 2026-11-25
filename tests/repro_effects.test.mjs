// 生殖干预（1.5.3）：八种效果、药物名录、到期、世界基准上限
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { describeReproEffects, normalizeDrugCatalog, setDrugCatalogProvider } from '../scripts/repro_effects.js';
import { narrativeReminders } from '../scripts/prompts/rules.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; setDrugCatalogProvider(null); });

function setup(stage = '卵泡期', days = 0, extra = {}) {
  const chat = state.createEmptyChatState();
  const ch = state.createDefaultFemaleState('A');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage, days, vitality: 100, psyStress: 0, ...extra });
  chat.characters.A = ch;
  return chat;
}
const act = (chat, args) => applyToolCall(chat, { name: 'bsReproductiveIntervention', arguments: { female: 'A', ...args } });
const pass = (chat, day) => applyToolCall(chat, { name: 'bsPassedTime', arguments: { day } });
const base = (chat) => chat.characters.A.profile.base;

test('避孕药：生效期间排卵被压住；到期就拿掉', () => {
  Math.random = () => 0;
  const chat = setup('卵泡期', 8.5);
  assert.equal(act(chat, { effect: 'pill', days: 10 }).applied, true);
  pass(chat, 1);
  assert.equal(base(chat).stage, '排卵期');
  assert.equal(base(chat).eggs, 0, '避孕药压住了这次排卵');
  pass(chat, 12);
  assert.equal(base(chat).reproEffects.length, 0, '到期拿掉');
});

test('促排卵：多排几颗，强效在卵泡期直接催到排卵期；上限看世界基准', () => {
  const chat = setup('卵泡期', 2);
  chat.reproductiveSettings = { ovulationExtraEggsMax: 3 };
  act(chat, { effect: 'ovulation', strength: 'strong' });
  assert.equal(base(chat).stage, '排卵期', '强效直接催排卵');
  assert.equal(base(chat).reproEffects[0].value, 3, '强＝世界基准上限');
  pass(chat, 1);
  assert.equal(base(chat).eggs, 4, '自然 1 颗 + 多排 3 颗');
});

test('调经：这一轮周期回到规律；之后新一轮也规律', () => {
  const chat = setup('黄体期', 0, { eggQuality: 0.25, cycleEggQuality: 0.25, cycleLengthFactor: 0.82 });
  act(chat, { effect: 'regulate', days: 60 });
  assert.equal(base(chat).cycleLengthFactor, 1);
  pass(chat, 20);
  assert.equal(base(chat).stage, '卵泡期');
  assert.equal(base(chat).cycleLengthFactor, 1, '卵子品质差，但调经期间仍规律');
});

test('助孕：拉高这一轮的卵子品质，着床更稳', () => {
  setDrugCatalogProvider(() => [{ name: '月神露', effects: [{ effect: 'fertility', strength: 'strong' }], days: 7 }]);
  const chat = setup('黄体期', 0, { eggQuality: 0.5, cycleEggQuality: 0.5 });
  act(chat, { drug: '月神露' });
  assert.equal(base(chat).cycleEggQuality, 1, '0.5 × 2');
});

test('促分裂、促嵌合：倍率存进效果，夹在世界基准上限', () => {
  const chat = setup();
  chat.reproductiveSettings = { twinningMaxMultiplier: 2.5, chimeraMaxMultiplier: 10 };
  setDrugCatalogProvider(() => [
    { name: '双生丹', effects: [{ effect: 'twinning', strength: 'strong' }], days: 7 },
    { name: '合心散', effects: [{ effect: 'chimera', strength: 'normal' }], days: 3 },
  ]);
  act(chat, { drug: '双生丹' });
  act(chat, { drug: '合心散' });
  const values = Object.fromEntries(base(chat).reproEffects.map((item) => [item.effect, item.value]));
  assert.deepEqual(values, { twinning: 2.5, chimera: 3 });
  assert.match(describeReproEffects(chat.characters.A.profile, 0).join('、'), /促分裂·强/);
});

test('切换阶段：照正文对齐；切进新一轮时重掷这一轮的卵；妊娠中拒绝', () => {
  const chat = setup('黄体期', 3);
  assert.equal(act(chat, { effect: 'phase', stage: '月经期' }).applied, true);
  assert.equal(base(chat).stage, '月经期');
  assert.equal(act(setup('孕中期', 10), { effect: 'phase', stage: '月经期' }).applied, false);
});

test('药物名录：照名录套效果；名录外的药名拒绝；名录空时可直接给 effect', () => {
  setDrugCatalogProvider(() => [{ name: '合欢散', description: '多子', effects: [{ effect: 'ovulation', strength: 'normal' }, { effect: 'chimera', strength: 'strong' }], days: 3 }]);
  const chat = setup();
  assert.equal(act(chat, { drug: '合欢散' }).applied, true);
  assert.deepEqual(base(chat).reproEffects.map((item) => item.effect).sort(), ['chimera', 'ovulation']);
  assert.equal(base(chat).reproEffects[0].name, '合欢散');
  assert.equal(act(chat, { drug: '不存在的药' }).applied, false);
  assert.equal(act(chat, { effect: 'pill' }).applied, false, '名录有药时要填 drug');
  setDrugCatalogProvider(null);
  assert.equal(act(setup(), { drug: '剧情里的药', effect: 'pill' }).applied, true);
  // 名录空着也不能凭空给奇幻效果
  const empty = act(setup(), { drug: '神秘药水', effect: 'twinning', strength: 'strong' });
  assert.equal(empty.applied, false);
  assert.match(empty.message, /药物名录里定义/);
});

test('可用效果：没设名录时奇幻效果不开放，名录里有才开放', async () => {
  const { getAllowedReproEffects } = await import('../scripts/tracker.js');
  const { DEFAULT_DRUG_CATALOG } = await import('../scripts/repro_effects.js');
  setDrugCatalogProvider(() => DEFAULT_DRUG_CATALOG);
  assert.deepEqual(getAllowedReproEffects({}), ['phase', 'emergency', 'pill', 'regulate', 'ovulation']);
  setDrugCatalogProvider(() => [{ name: '双生丹', effects: [{ effect: 'twinning', strength: 'normal' }] }]);
  assert.deepEqual(getAllowedReproEffects({}), ['phase', 'emergency', 'pill', 'regulate', 'ovulation', 'twinning']);
  assert.deepEqual(getAllowedReproEffects({ realisticWorld: true }), ['phase', 'emergency', 'pill', 'regulate', 'ovulation'], '写实世界照样不给');
});

test('名录正规化：认不出来的效果丢掉、没有效果的整项丢掉、名称重复留第一个、切换阶段要有阶段', () => {
  const list = normalizeDrugCatalog([
    { name: 'A', effects: [{ effect: 'pill' }, { effect: 'nope' }] },
    { name: 'A', effects: [{ effect: 'regulate' }] },
    { name: 'B', effects: [] },
    { name: 'C', effects: [{ effect: 'phase', stage: '月经期' }, { effect: 'phase', stage: '孕早期' }] },
  ]);
  assert.deepEqual(list.map((item) => [item.name, item.effects.map((entry) => entry.effect)]), [['A', ['pill']], ['C', ['phase']]]);
});

test('旧的 bsAbortion purpose=emergency 照收', () => {
  const result = applyToolCall(setup('黄体期'), { name: 'bsAbortion', arguments: { female: 'A', purpose: 'emergency' } });
  assert.match(result.message, /emergency/);
});

test('助孕也降低受孕难度：精灵那种难受精的才有感', async () => {
  const { getEffectiveImpregnationDifficulty } = await import('../scripts/tools.js');
  const elf = { base: { race: '人类', reproEffects: [] }, bio: { impregnationDifficulty: 8 } };
  assert.equal(getEffectiveImpregnationDifficulty(elf), 8, '没吃药原值');
  elf.base.reproEffects = [{ name: '月神露', effect: 'fertility', strength: 'strong', fromMinutes: 0, untilMinutes: 1440 * 7 }];
  assert.equal(getEffectiveImpregnationDifficulty(elf), 4, '强效 ÷2');
  elf.base.reproEffects[0].strength = 'light';
  assert.equal(getEffectiveImpregnationDifficulty(elf), 6.4, '轻 ÷1.25');
  // 没填难度的照种族补再除
  const human = { base: { race: '人类', reproEffects: [{ effect: 'fertility', strength: 'normal', fromMinutes: 0, untilMinutes: 1440 }] }, bio: {} };
  assert.ok(Math.abs(getEffectiveImpregnationDifficulty(human) - 1 / 1.5) < 1e-9);
});

const pregnantFetus = (id, over = {}) => ({ embryoId: id, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, health: 50, ...over });
function pregnantSetup(stage, days, fetuses = [pregnantFetus(1)]) {
  const chat = setup(stage, 0);
  Object.assign(chat.characters.A.profile.pregnant, { pregnantDays: days, effectivePregnantDays: days, fetuses, fetusesCount: fetuses.length, amnionDurability: 100, fetalEnergyDrain: 0.1 });
  return chat;
}
const withDrugs = () => setDrugCatalogProvider(() => [
  { name: '红花汤', description: '民间堕胎偏方', effects: [{ effect: 'abortifacient', strength: 'light' }] },
  { name: '落胎丸', effects: [{ effect: 'abortifacient', strength: 'strong' }] },
  { name: '催生散', effects: [{ effect: 'induce', strength: 'normal' }] },
]);

test('堕胎药：全部流掉照人工终止结算', () => {
  withDrugs();
  Math.random = () => 0;
  const chat = pregnantSetup('孕早期', 40);
  const result = act(chat, { drug: '落胎丸' });
  assert.equal(result.applied, true, result.message);
  assert.equal(base(chat).stage, '产后恢复');
  assert.equal(chat.characters.A.profile.experience.abortionExperience, 1);
  assert.match(chat.characters.A.profile.notify.secondly, /落胎丸.*流掉了/);
});

test('堕胎药：没流掉的还在、受了伤，通知写成像是流掉了', () => {
  withDrugs();
  Math.random = () => 0.99;
  const chat = pregnantSetup('孕中期', 120);
  assert.equal(act(chat, { drug: '红花汤' }).applied, true);
  const p = chat.characters.A.profile;
  assert.equal(p.base.stage, '孕中期');
  assert.equal(p.pregnant.fetuses.length, 1);
  assert.equal(p.pregnant.fetuses[0].health, 42, '轻效没流掉扣 8');
  assert.match(p.notify.secondly, /像是流掉了，其实胎儿还在/);
  // 主线只看到客观事实，给追踪模型的认知指示拿掉
  assert.equal(narrativeReminders(p.notify.secondly), 'A服下红花汤后腹痛、少量出血，像是流掉了，其实胎儿还在、受了伤（她不知道，多半以为已经流产）');
  assert.equal(p.experience.abortionExperience ?? 0, 0, '没流掉不计');
});

test('堕胎药：双胎只流掉一胎，留下的那胎照样在', () => {
  withDrugs();
  // 两胎连着掷：交替回传 0、0.99，不论前面有几次别的乱数，两胎总是一成一败
  let calls = 0;
  Math.random = () => (calls++ % 2 === 0 ? 0 : 0.99);
  const chat = pregnantSetup('孕早期', 50, [pregnantFetus(1), pregnantFetus(2)]);
  assert.equal(act(chat, { drug: '落胎丸' }).applied, true);
  const p = chat.characters.A.profile;
  assert.equal(p.pregnant.fetuses.length, 1);
  assert.equal(p.base.stage, '孕早期');
  assert.equal(p.pregnant.fetusesCount, 1);
  assert.match(p.notify.secondly, /还有 1 胎留在腹中/);
});

test('堕胎药：着床前、延产期、流产保护都拒绝；名录里没有就不能用', () => {
  withDrugs();
  Math.random = () => 0;
  const pending = pregnantSetup('黄体期', 0, [pregnantFetus(1, { pendingImplantation: true })]);
  assert.match(act(pending, { drug: '落胎丸' }).message, /事后避孕/);
  assert.equal(act(pregnantSetup('延产期', 300), { drug: '落胎丸' }).applied, false);
  const immune = pregnantSetup('孕早期', 40);
  immune.characters.A.profile.immune = { miscarriage: true };
  assert.equal(act(immune, { drug: '落胎丸' }).applied, false);
  setDrugCatalogProvider(null);
  assert.match(act(pregnantSetup('孕早期', 40), { effect: 'abortifacient' }).message, /药物名录里定义/);
});

test('催产药：孕晚期也能催（早产），孕中期拒绝；没成只是宫缩几阵', () => {
  withDrugs();
  Math.random = () => 0;
  const late = pregnantSetup('孕晚期', 230);
  assert.equal(act(late, { drug: '催生散' }).applied, true);
  assert.equal(base(late).stage, '产兆前驱');
  assert.equal(late.characters.A.profile.pregnant.prodromalOriginStage, '孕晚期');
  assert.match(act(pregnantSetup('孕中期', 150), { drug: '催生散' }).message, /太早/);
  Math.random = () => 0.99;
  const term = pregnantSetup('临产期', 265);
  assert.equal(act(term, { drug: '催生散' }).applied, true);
  assert.equal(base(term).stage, '临产期');
  assert.match(term.characters.A.profile.notify.secondly, /宫缩了几阵又停了/);
  Math.random = () => 0;
  const extended = pregnantSetup('延产期', 300);
  assert.equal(act(extended, { drug: '催生散' }).applied, true);
  assert.equal(base(extended).stage, '产兆前驱', '延产期也能催');
});

test('工具说明只送开放的效果', async () => {
  const { getTrackerToolDefinitions } = await import('../scripts/tracker.js').catch(() => ({}));
  const { describeReproductiveInterventionTool } = await import('../scripts/prompts/tool_definitions.js');
  const full = describeReproductiveInterventionTool();
  const basic = describeReproductiveInterventionTool(['phase', 'emergency', 'pill', 'regulate', 'ovulation']);
  assert.match(full, /abortifacient 堕胎/);
  assert.doesNotMatch(basic, /fertility|twinning|chimera|abortifacient|induce/);
  assert.ok(basic.length < full.length - 200);
  void getTrackerToolDefinitions;
});

test('固膜：孕期中羊膜每天修复、宫压磨损减轻；名录里有才能用', () => {
  setDrugCatalogProvider(() => [{ name: '护胎膜散', effects: [{ effect: 'amnion', strength: 'normal' }], days: 14 }]);
  Math.random = () => 0;
  const chat = pregnantSetup('孕中期', 120, [pregnantFetus(1, { amnionDurability: 60 })]);
  assert.equal(act(chat, { drug: '护胎膜散' }).applied, true);
  pass(chat, 2);
  const sac = () => chat.characters.A.profile.pregnant.fetuses[0].amnionDurability;
  assert.ok(sac() >= 69 && sac() <= 71, `两天 +5×2，实得 ${sac()}`);
  const before = sac();
  const drain = chat.characters.A.profile.pregnant.fetalEnergyDrain;
  applyToolCall(chat, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { uterinePressure: 999 } } });
  assert.ok(Math.abs(before - sac() - Math.max(1, drain) * 0.5) < 1e-6, '宫压磨损剩一半');
  setDrugCatalogProvider(null);
  assert.match(act(pregnantSetup('孕中期', 120), { effect: 'amnion' }).message, /药物名录里定义/);
});

test('停药（1.5.4）：照药名或效果提早结束那一笔；不算药，开关关着也能停', () => {
  Math.random = () => 0;
  const chat = setup('卵泡期', 2);
  assert.equal(act(chat, { effect: 'pill' }).applied, true);
  assert.equal(act(chat, { effect: 'regulate' }).applied, true);
  const stopped = act(chat, { stop: true, effect: 'pill' });
  assert.equal(stopped.applied, true, stopped.message);
  assert.deepEqual(base(chat).reproEffects.map((item) => item.effect), ['regulate']);
  assert.match(act(chat, { stop: true, effect: 'pill' }).message, /没有生效中/);
  assert.match(act(chat, { stop: true }).message, /要填 drug/);
  chat.settings = undefined;
});

test('解药（1.5.4）：一次清掉所有药效；拿掉助孕时这一轮的卵照比例还原', () => {
  setDrugCatalogProvider(() => [
    { name: '月神露', effects: [{ effect: 'fertility', strength: 'strong' }], days: 7 },
    { name: '解毒奶', effects: [{ effect: 'cleanse', strength: 'normal' }], days: 0 },
  ]);
  const chat = setup('卵泡期', 2, { eggQuality: 1, cycleEggQuality: 1 });
  act(chat, { drug: '月神露' });
  assert.equal(base(chat).cycleEggQuality, 2);
  const result = act(chat, { drug: '解毒奶' });
  assert.equal(result.applied, true, result.message);
  assert.match(result.message, /清掉 1 种药效/);
  assert.deepEqual(base(chat).reproEffects, []);
  assert.equal(base(chat).cycleEggQuality, 1, '助孕拉高的那一截还原');
  setDrugCatalogProvider(null);
  assert.match(act(setup(), { effect: 'cleanse' }).message, /药物名录里定义/);
});

test('提示词送生效中的药的文字，不送原始纪录（1.5.4）', async () => {
  const { buildTrackerPayload, buildMainFlowPrompt } = await import('../scripts/tracker.js');
  const ctx = { chatId: 'drug-text', chat: [{ is_user: false, name: 'N', mes: '午后。' }], characters: [], name1: 'U', name2: 'N', extensionSettings: {}, saveSettingsDebounced() {} };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const chat = state.getChatState(ctx, settings);
  const ch = state.createDefaultFemaleState('甲');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '卵泡期', age: 24 });
  chat.characters['甲'] = ch;
  applyToolCall(chat, { name: 'bsReproductiveIntervention', arguments: { female: '甲', effect: 'pill' } });
  const tracked = buildTrackerPayload(ctx, settings, 'manual').existing_state['甲'].profile.base;
  assert.equal(tracked.reproEffects, undefined);
  assert.deepEqual(tracked.activeDrugs, ['避孕药·一般（剩 30 天）']);
  const narrated = JSON.parse(buildMainFlowPrompt(ctx, settings).match(/\[当前已注册角色状态\]\n(.+)/)[1].split('<\/').join('</'))['甲'].profile.base;
  assert.deepEqual(narrated.activeDrugs, tracked.activeDrugs);
  assert.equal(chat.characters['甲'].profile.base.reproEffects.length, 1, '不碰存档');
});

// ---- 1.5.4：药不分男女（精方那侧）与催情 ----
import { upsertSireRecord, getSireQualityState, getEffectiveSwordOffset } from '../scripts/sires.js';

const sireChat = () => {
  const chat = setup('排卵期', 0, { eggs: 1, libido: 0 });
  upsertSireRecord(chat, 'M', { race: '人类', spermQuality: 1, swordOffset: 0 }, { source: 'manual' });
  return chat;
};
const actOn = (chat, female, args) => applyToolCall(chat, { name: 'bsReproductiveIntervention', arguments: { female, ...args } });
const sperm = (chat, action, amount = 0) => applyToolCall(chat, { name: 'bsAddSperm', arguments: { female: 'A', male: 'M', race: '人类', action, amount } });

test('男方避孕：女方栏位填精方名字；射精照可靠度失去活性（与事后避孕同一个标记）', () => {
  const chat = sireChat();
  const result = actOn(chat, 'M', { effect: 'pill', days: 30 });
  assert.equal(result.applied, true, result.message);
  assert.equal(chat.sires.M.reproEffects.length, 1);
  Math.random = () => 0;
  sperm(chat, 'insert');
  const deposit = sperm(chat, 'deposit', 50);
  assert.match(deposit.message, /精液没有活性/);
  assert.ok(base(chat).spermContacts.every((contact) => contact.blocked === true));
});

test('强精：当下精子品质照助孕倍率提高、剑暂时变大；卵方专属的效果对精方没有作用', () => {
  setDrugCatalogProvider(() => normalizeDrugCatalog([
    { name: '虎鞭酒', effects: [{ effect: 'fertility', strength: 'strong' }, { effect: 'aphrodisiac', strength: 'light' }], days: 3 },
    { name: '调经丸', effects: [{ effect: 'regulate', strength: 'normal' }], days: 30 },
  ]));
  const chat = sireChat();
  const before = getSireQualityState(chat, 'M').effective;
  chat.sires.M.reserve = 0.2;
  chat.sires.M.reserveAt = 0;
  assert.equal(actOn(chat, 'M', { drug: '虎鞭酒' }).applied, true);
  const after = getSireQualityState(chat, 'M');
  assert.equal(after.reserve, 1, '催情补满存量');
  assert.ok(Math.abs(after.effective - Math.min(4, before * 2)) < 1e-6, `${before} → ${after.effective}`);
  assert.equal(getEffectiveSwordOffset(chat.sires.M, 0), 1.5, '强精剑 +1.5');
  const none = actOn(chat, 'M', { drug: '调经丸' });
  assert.match(none.message, /对精方没有作用/);
  // 解药也清精方那侧
  setDrugCatalogProvider(() => normalizeDrugCatalog([{ name: '解毒奶', effects: [{ effect: 'cleanse', strength: 'normal' }] }]));
  assert.match(actOn(chat, 'M', { drug: '解毒奶' }).message, /清掉 2 种药效/);
  assert.equal(getEffectiveSwordOffset(chat.sires.M, 0), 0);
});

test('卵方催情：不直接加性欲；工具加的放大、减的压住，契合累积另乘倍率', () => {
  setDrugCatalogProvider(() => normalizeDrugCatalog([{ name: '春药', effects: [{ effect: 'aphrodisiac', strength: 'normal' }], days: 0.25 }]));
  const chat = sireChat();
  assert.equal(actOn(chat, 'A', { drug: '春药' }).applied, true);
  assert.equal(base(chat).libido, 0, '吃下去不直接加性欲');
  applyToolCall(chat, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { libido: 10 } } });
  assert.equal(base(chat).libido, 20, '一般 ×2');
  applyToolCall(chat, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { libido: -8 } } });
  assert.equal(base(chat).libido, 18, '减 ×0.25');
  sperm(chat, 'insert');
  const gain = chat.characters.A.profile.intimacy.M.sessionGain;
  const plain = sireChat();
  applyToolCall(plain, { name: 'bsAddSperm', arguments: { female: 'A', male: 'M', race: '人类', action: 'insert', amount: 0 } });
  assert.ok(Math.abs(gain - plain.characters.A.profile.intimacy.M.sessionGain * 1.5) < 1e-9, '契合 ×1.5');
  // 药效过了照常
  pass(chat, 1);
  applyToolCall(chat, { name: 'bsUpdateCharacterStatus', arguments: { female: 'A', options: { libido: 10 } } });
  assert.equal(base(chat).libido, 28);
});
