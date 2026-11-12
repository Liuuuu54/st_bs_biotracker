// 1.3.1 母胎分配与孕期身体（scripts/maternal_body.js 与 tools.js 的接线）
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, getBellySize, getCurrentBody } from '../scripts/tools.js';
import { normalizeReproductiveSettings } from '../scripts/reproductive.js';
import { getMergedRacePhysiologyProfile } from '../scripts/race_config.js';
import { buildMainFlowStatePrompt } from '../scripts/prompts/rules.js';
import {
  BUST_GAIN_MAX, HIP_GAIN_MAX, computeBodyIncrements, deterministicBodyTraits, getAllocationAlpha, getAllocationText,
  getBulkDrive, getBustSupportPenalty, getCupLabel, getEffectiveShowingFactor, getFetusDemand, getShowingFactor,
  sampleBodyTraits, shiftCareTarget, splitPregnancyEndIncrements,
} from '../scripts/maternal_body.js';

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

const near = (actual, expected, label = '', eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${label} ${actual} ≠ ${expected}`);
const fetus = (embryoId, over = {}) => ({ embryoId, fathers: '甲', race: '人类', gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, health: 50, descentStage: -2, ...over });

function setup({ stage = '孕中期', days = 120, fetuses = [fetus(1)], base = {}, pregnant = {}, wardrobe = null } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.reproductiveSettings = normalizeReproductiveSettings({});
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 20, uterinePressure: 0, psyStress: 0,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1,
        build: 50, bust: 40, hip: 50, allocationBias: 0, bustGain: 1.5, hipGain: 0.5, ...base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, impregnationDifficulty: 1, recoveryDays: 56 },
      pregnant: { pregnantDays: days, effectivePregnantDays: days, fetusesCount: fetuses.length, fetalEnergyDrain: 0, nutritionBurst: {}, fetuses, ...pregnant },
      experience: {}, immune: { metabolism: true }, metabolism: { excretion: 0, hunger: 0, sleep: 0, milk: 0, odor: 0, companionship: 0 },
      skills: [], talents: [], children: [], notify: {},
      ...(wardrobe ? { wardrobe: wardrobe.wardrobe, outfit: wardrobe.outfit } : {}),
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;

// ── 倾向与抽样 ───────────────────────────────────────────

test('按名字固定抽样：同名每次相同，不同名不同，且都在范围内', () => {
  assert.deepEqual(deterministicBodyTraits('艾拉'), deterministicBodyTraits('艾拉'));
  assert.notDeepEqual(deterministicBodyTraits('艾拉'), deterministicBodyTraits('贝拉'));
  for (const name of ['A', '艾拉', '贝拉', 'Seraphina', '']) {
    const traits = deterministicBodyTraits(name);
    assert.ok(traits.allocationBias >= -1 && traits.allocationBias <= 1);
    assert.ok(traits.bustGain >= 0 && traits.bustGain <= BUST_GAIN_MAX);
    assert.ok(traits.hipGain >= 0 && traits.hipGain <= HIP_GAIN_MAX);
  }
  Math.random = () => 0.5;
  const sampled = sampleBodyTraits();
  assert.ok(Math.abs(sampled.allocationBias) <= 1 && sampled.bustGain > 0 && sampled.hipGain > 0);
});

test('新角色的身材是中性预设：体重 50、胸 40（C）、臀 50、母体倾向 0、增长倾向取平均', () => {
  const base = state.createDefaultFemaleState('X').profile.base;
  assert.deepEqual([base.build, base.bust, base.hip, base.allocationBias, base.bustGain, base.hipGain], [50, 40, 50, 0, 1.5, 0.5]);
  assert.equal(getCupLabel(40), 'C');
  assert.equal(getCupLabel(150), 'N');
});

// ── 每胎索取与本胎 α ─────────────────────────────────────

test('每胎索取：同族为 1；耐受差距越大越吃力、不分方向；雄核 ×1.25、雌核 ×0.8；看种族表不看多胎打折后的耐受', () => {
  const profile = { base: { race: '人类' }, bio: { breedTolerance: 0.5 }, pregnant: { effectivePregnantDays: 140, fetuses: [] } };
  assert.equal(getFetusDemand(profile, fetus(1)), 1, '母体 bio 被多胎打折也不影响同族');
  const human = getMergedRacePhysiologyProfile('人类').breedTolerance;
  const dragonRace = ['龙族', '龙', '龙人'].find((race) => getMergedRacePhysiologyProfile(race)?.breedTolerance);
  if (dragonRace) {
    const dragon = getMergedRacePhysiologyProfile(dragonRace).breedTolerance;
    const expected = Math.min(2, 1 + 0.25 * Math.abs(Math.log2(human / dragon)));
    near(getFetusDemand(profile, fetus(1, { race: dragonRace })), expected, '人类怀异族', 1e-3);
    const dragonMother = { ...profile, base: { race: dragonRace } };
    near(getFetusDemand(dragonMother, fetus(1)), expected, '异族怀人类，方向相反、索取相同', 1e-3);
  }
  near(getFetusDemand(profile, fetus(1, { tags: ['androgenesis'] })), 1.25, '雄核');
  near(getFetusDemand(profile, fetus(1, { tags: ['gynogenesis'] })), 0.8, '雌核');
  near(getFetusDemand(profile, fetus(1, { tags: ['androgenesis', 'gynogenesis'] })), 1, '嵌合两种都有当一般');
});

test('本胎 α ＝ 母体倾向 ＋ 0.5 ×（平均索取 − 1），夹在 ±1；文字刻度', () => {
  const profile = (bias, fetuses) => ({ base: { race: '人类', allocationBias: bias }, bio: {}, pregnant: { effectivePregnantDays: 140, fetuses } });
  assert.equal(getAllocationAlpha(profile(0.3, [])), 0.3, '没有胎儿时就是母体倾向');
  near(getAllocationAlpha(profile(0, [fetus(1, { tags: ['androgenesis'] })])), 0.125, '雄核胎往偏养宝推');
  assert.equal(getAllocationAlpha(profile(1, [fetus(1, { tags: ['androgenesis'] })])), 1, '夹在 +1');
  assert.deepEqual([-0.8, -0.3, 0, 0.3, 0.8].map(getAllocationText), ['极度偏养母', '偏养母', '平衡', '偏养宝', '极度偏养宝']);
  assert.deepEqual([shiftCareTarget(50, 1), shiftCareTarget(50, -1), shiftCareTarget(20, -1), shiftCareTarget(80, 1)], [58, 42, 12, 88]);
});

// ── α 接进胎儿健康 ───────────────────────────────────────

test('α＝0 时周回归照产前护理目标；偏养宝往上 8、偏养母往下 8；逐日推进与一次跳完相同', () => {
  const run = (bias, step) => {
    Math.random = () => 0.5;
    const chatState = setup({ days: 20, stage: '孕早期', base: { allocationBias: bias }, pregnant: { prenatalCare: 'normal' } });
    while (P(chatState).pregnant.effectivePregnantDays < 259) {
      applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: Math.min(step, 259 - P(chatState).pregnant.effectivePregnantDays) } });
    }
    return P(chatState).pregnant.fetuses[0];
  };
  const [balanced, mother, baby] = [run(0, 300), run(-1, 300), run(1, 300)];
  near(balanced.health, 50, '平衡', 1e-3);
  near(mother.health, 42, '偏养母', 0.5);
  near(baby.health, 58, '偏养宝', 0.5);
  assert.ok(mother.weight < balanced.weight && balanced.weight < baby.weight, `${mother.weight} < ${balanced.weight} < ${baby.weight}`);
  near(run(1, 1).weight, baby.weight, '逐日与一次跳完', 1e-3);
});

test('偏养宝的母体需求涨得快：胎儿消耗 ×（1 ＋ 0.25 × 母体倾向）', () => {
  const drain = (bias) => {
    const chatState = setup({ base: { allocationBias: bias } });
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 1 } });
    return P(chatState).pregnant.fetalEnergyDrain;
  };
  near(drain(1) / drain(0), 1.25, '偏养宝', 1e-3);
  near(drain(-1) / drain(0), 0.75, '偏养母', 1e-3);
});

// ── 身体增量 ─────────────────────────────────────────────

test('身体增量：单胎足月平衡时体重 +8、胸 +16、臀 +8；α 只经由体重的脂肪外溢碰胸臀', () => {
  const at = (alpha, extra = {}) => computeBodyIncrements({ progress: 1, bulkDrive: 1, alpha, care: 'normal', averageHealthRatio: 0.5, bustGain: 1.5, hipGain: 0.5, ...extra });
  const balanced = at(0);
  near(balanced.build, 8); near(balanced.bust, 16.2, '胸', 1e-2); near(balanced.hip, 8.2, '臀', 1e-2);
  const mother = at(-1);
  const baby = at(1);
  near(mother.build, 14); near(baby.build, 2);
  assert.ok(mother.bust - baby.bust < 2.5, '偏养母与偏养宝胸部只差脂肪外溢（约 0.2 罩杯）');
  assert.ok(at(1, { averageHealthRatio: 0.2 }).build < 0, '偏养宝又照料差时母体被榨瘦');
  assert.ok(at(0, { care: 'devoted' }).build > at(0, { care: 'abusive' }).build);
  assert.equal(getBulkDrive(3, 1), Math.sqrt(3));
  assert.equal(getBulkDrive(9, 1), 2, '最多 2');
});

test('孕期身体即时算出：孕程越长越大，三胎胸部长得比单胎多，假孕只到孕早期的幅度，回归期不长', () => {
  const body = (opts) => getCurrentBody(P(setup(opts)));
  const early = body({ days: 60, stage: '孕早期' });
  const term = body({ days: 275, stage: '临产期' });
  assert.ok(term.bust > early.bust && term.build > early.build);
  const triplets = body({ days: 275, stage: '临产期', fetuses: [fetus(1), fetus(2), fetus(3)] });
  assert.ok(triplets.increments.bust > term.increments.bust * 1.5);
  const pseudo = getCurrentBody(P(setup({ stage: '假孕期', days: 0, fetuses: [], base: { days: 9999 } })));
  assert.ok(pseudo.increments.bust > 0 && pseudo.increments.bust < term.increments.bust * 0.6, `假孕 ${pseudo.increments.bust}`);
  const menstrual = getCurrentBody(P(setup({ stage: '卵泡期', days: 0, fetuses: [] })));
  assert.deepEqual(menstrual.increments, { build: 0, bust: 0, hip: 0 });
});

test('分娩时增量拆成留存与回落：留存加回基准，回落在产后恢复期间线性归零，回到月经期时清掉', () => {
  assert.deepEqual(splitPregnancyEndIncrements({ build: 10, bust: 20, hip: 10 }).retained, { build: 3, bust: 5, hip: 4 });
  Math.random = () => 0.5;
  const chatState = setup({ days: 275, stage: '临产期', base: { naturalBirthExperience: 0 } });
  const before = getCurrentBody(P(chatState));
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A', method: 'natural' } });
  assert.equal(P(chatState).base.stage, '产后恢复');
  near(P(chatState).base.bust, 40 + before.increments.bust * 0.25, '胸部留存', 1e-2);
  near(P(chatState).base.hip, 50 + before.increments.hip * 0.4, '臀部留存', 1e-2);
  const justAfter = getCurrentBody(P(chatState));
  near(justAfter.bust, before.bust, '刚生完时身体不突变', 1e-2);
  P(chatState).base.days = 28;
  const halfway = getCurrentBody(P(chatState));
  assert.ok(halfway.bust < justAfter.bust && halfway.bust > P(chatState).base.bust);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 60 } });
  assert.notEqual(P(chatState).base.stage, '产后恢复');
  assert.equal('postpartumBody' in P(chatState).pregnant, false);
});

// ── 衣柜算子 ─────────────────────────────────────────────

test('显怀系数：高挑、结实、丰腴、大胸较晚显怀，瘦小、经产较早；夹 0.6～1.4，足月前收敛到 1', () => {
  const plain = getShowingFactor({});
  assert.equal(plain, 1);
  assert.ok(getShowingFactor({ sigma: 2, vitalityLevel: 7, build: 90, bust: 90 }) < 0.75);
  assert.ok(getShowingFactor({ sigma: -2, vitalityLevel: 1, build: 10, births: 3 }) > 1.4 - 1e-9);
  assert.equal(getEffectiveShowingFactor(0.7, 100), 0.7, '孕程 60% 前照原系数');
  assert.equal(getEffectiveShowingFactor(0.7, 280), 1, '足月人人藏不住');
  assert.equal(getBustSupportPenalty(20), 1.5);
  assert.equal(getBustSupportPenalty(80), 3, '最多 −3');
});

test('衣柜：显怀系数只改遮蔽，胸部增量只压承托，孕肚大小本身不变', () => {
  const wardrobe = {
    wardrobe: { enabled: true, items: [{ id: 1, name: '连身裙', note: '', slot: 'main', masking: 8, support: 8, capacity: 8, convenience: 8 }] },
    outfit: { mainItemId: 1, accessoryItemIds: [], transientItems: [], wearState: '整齐', pregFit: null },
  };
  const fit = (base) => {
    const chatState = setup({ days: 150, stage: '孕中期', base, wardrobe: JSON.parse(JSON.stringify(wardrobe)) });
    applyToolCall(chatState, { name: 'bsChangeOutfit', arguments: { female: 'A', mainItemId: 1 } });
    return { gap: P(chatState).outfit.pregFit.gap, belly: getBellySize(P(chatState)) };
  };
  const average = fit({});
  const sturdy = fit({ vitalityLevel: 7, build: 90 });
  near(sturdy.belly, average.belly, '孕肚大小不受身材影响');
  assert.ok(sturdy.gap.masking > average.gap.masking, '结实丰腴的人遮蔽余裕多');
  assert.equal(sturdy.gap.capacity, average.gap.capacity, '容身不受显怀系数影响');
  const busty = fit({ bustGain: 3 });
  assert.ok(busty.gap.support < average.gap.support, '胸部长得多，承托先吃紧');
});

// ── 迁移、产前护理、假宫缩、追踪视角 ─────────────────────────

test('v14 → v15：补身材（按名字固定抽样，主档与快照一致），进行中的妊娠补产前护理一般', () => {
  const ctx = { chatId: 'v15', characters: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const old = setup();
  old.schemaVersion = 14;
  for (const key of ['build', 'bust', 'hip', 'allocationBias', 'bustGain', 'hipGain']) delete P(old).base[key];
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 15);
  const base = migrated.characters.A.profile.base;
  const traits = deterministicBodyTraits('A');
  assert.deepEqual([base.build, base.bust, base.hip], [50, 40, 50]);
  assert.deepEqual([base.allocationBias, base.bustGain, base.hipGain], [traits.allocationBias, traits.bustGain, traits.hipGain]);
  assert.equal(migrated.characters.A.profile.pregnant.prenatalCare, 'normal');
});

test('v14 → v15：旧档载入时已和新预设合并成中性值，迁移照样按名字重抽倾向、锚点填当下年龄', () => {
  const ctx = { chatId: 'v15-merged', characters: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const old = setup({ base: { age: 22.5, allocationBias: 0, bustGain: 1.5, hipGain: 0.5, bodyChangedAtAge: 15 } });
  old.schemaVersion = 14;
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  const base = migrated.characters.A.profile.base;
  const traits = deterministicBodyTraits('A');
  assert.deepEqual([base.allocationBias, base.bustGain, base.hipGain], [traits.allocationBias, traits.bustGain, traits.hipGain]);
  assert.equal(base.bodyChangedAtAge, 22.5);
  assert.notDeepEqual([traits.allocationBias, traits.bustGain, traits.hipGain], [0, 1.5, 0.5], '名字 A 抽到的不是中性值，测试才有意义');
});

test('假宫缩 tighten：孕 20 周起才有，只发画面事件，产程、宫压与健康都不变', () => {
  const early = setup({ days: 100, stage: '孕中期' });
  assert.equal(applyToolCall(early, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'tighten' } }).applied, false);
  const late = setup({ days: 230, stage: '孕晚期', base: { uterinePressure: 12 } });
  const result = applyToolCall(late, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'tighten' } });
  assert.equal(result.applied, true);
  assert.equal(P(late).visualCue.type, 'falseContraction');
  assert.equal(P(late).base.stage, '孕晚期');
  assert.equal(P(late).base.uterinePressure, 12);
  assert.equal(P(late).base.vitality, 100, '不耗活力');
  assert.deepEqual(P(late).pregnant.fetuses.map(({ health, weight }) => [health, weight]), [[50, 1]]);
  assert.equal(P(late).pregnant.effectivePregnantDays, 230);
  const prodromal = setup({ days: 275, stage: '产兆前驱' });
  assert.equal(applyToolCall(prodromal, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'tighten' } }).applied, false);
});

// ── 身材的长期变化（bsGrowBody）─────────────────────────────

test('bsGrowBody：距上次改变不满 1 岁时跳过；满 1 岁后任何时候都能记，用后从当下年龄重新起算', () => {
  const chatState = setup({ stage: '卵泡期', fetuses: [], base: { age: 24.5, bodyChangedAtAge: 24 } });
  const grow = (extra) => applyToolCall(chatState, { name: 'bsGrowBody', arguments: { female: 'A', time: '某日', reason: '离家后瘦了一圈', ...extra } });
  assert.equal(grow({ build: -5 }).applied, false, '才过半年');
  assert.equal(P(chatState).base.build, 50);
  P(chatState).base.age = 25.6;
  const result = grow({ build: -5 });
  assert.equal(result.applied, true, result.message);
  assert.equal(P(chatState).base.build, 45);
  assert.equal(P(chatState).base.bodyChangedAtAge, 25.6, '锚点更新成当下年龄');
  assert.equal(grow({ build: -5 }).applied, false, '刚用过又要等一年');
  const record = P(chatState).cognitionRecords.at(-1);
  assert.equal(record.method, 'experience');
  assert.match(record.content, /^身材变化：离家后瘦了一圈/);
});

test('bsGrowBody：不设上限，只夹在栏位范围内；改的是基准，怀孕中也能用', () => {
  const chatState = setup({ days: 150, stage: '孕中期', base: { age: 16, bodyChangedAtAge: 14, vitalityLevel: 4 } });
  const result = applyToolCall(chatState, { name: 'bsGrowBody', arguments: { female: 'A', time: '某日', reason: '少年期抽高', build: 40, bust: -60, vitalityLevel: 9, bodySize: 1.2 } });
  assert.equal(result.applied, true, result.message);
  const base = P(chatState).base;
  assert.equal(base.build, 90, '一次 +40 不设上限');
  assert.equal(base.bust, 0, '夹在 0');
  assert.equal(base.vitalityLevel, 7, '等级夹在 7');
  assert.ok(base.bodySize > 4.5, `体型 ${base.bodySize}`);
  assert.ok(getCurrentBody(P(chatState)).bust > 0, '孕期增量照算、叠在新基准上');
});

test('锚点：没有锚点时第一次呼叫只补上锚点；v15 迁移与第一次注册从当下年龄起算', () => {
  const chatState = setup({ stage: '卵泡期', fetuses: [], base: { age: 30 } });
  assert.equal(applyToolCall(chatState, { name: 'bsGrowBody', arguments: { female: 'A', time: '某日', reason: '发福', build: 5 } }).applied, false);
  assert.equal(P(chatState).base.bodyChangedAtAge, 30);
  const ctx = { chatId: 'v15-anchor', characters: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const old = setup({ base: { age: 27 } });
  old.schemaVersion = 14;
  delete P(old).base.bodyChangedAtAge;
  settings.chatStates[ctx.chatId] = old;
  assert.equal(state.getChatState(ctx, settings).characters.A.profile.base.bodyChangedAtAge, 27);
});

// ── 精方的长期变化 ─────────────────────────────────────────

import { normalizeSireRecord } from '../scripts/sires.js';

function withSire(record) {
  const chatState = setup({ stage: '卵泡期', fetuses: [], base: { age: 20, bodyChangedAtAge: 20 } });
  chatState.sires['乙'] = normalizeSireRecord({ race: '人类', age: 30, bodySize: 4, spermQuality: 1, ...record });
  return chatState;
}
const growSire = (chatState, extra) => applyToolCall(chatState, { name: 'bsGrowBody', arguments: { male: '乙', time: '某日', reason: '这几年', ...extra } });

test('精方年龄跟着时间走；锚点建档时等于当下年龄，满一年后才能用 male 改体型、剑偏移与档案精子品质', () => {
  const chatState = withSire({});
  assert.equal(chatState.sires['乙'].bodyChangedAtAge, 30);
  assert.equal(growSire(chatState, { spermQuality: -0.3 }).applied, false, '还没满一年');
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 366 } });
  assert.ok(chatState.sires['乙'].age > 31 && chatState.sires['乙'].age < 31.01, `年龄 ${chatState.sires['乙'].age}`);
  const result = growSire(chatState, { spermQuality: -0.3, swordOffset: 0.7, bodySize: 0.2 });
  assert.equal(result.applied, true, result.message);
  const sire = chatState.sires['乙'];
  assert.equal(sire.spermQuality, 0.7);
  assert.equal(sire.swordOffset, 0.5, '剑偏移按 0.5 步长');
  near(sire.bodySize, 4.2, '体型', 1e-6);
  near(sire.bodyChangedAtAge, sire.age, '锚点更新', 1e-9);
  assert.equal(growSire(chatState, { spermQuality: 5 }).applied, false, '刚改过又要等一年');
});

test('精方：品质夹在 0.25～4、不收卵方栏位；female 与 male 不能同时给；卵方不收精方栏位', () => {
  const chatState = withSire({ bodyChangedAtAge: 20 });
  assert.equal(growSire(chatState, { build: 5 }).applied, false);
  assert.equal(growSire(chatState, { spermQuality: 10 }).applied, true);
  assert.equal(chatState.sires['乙'].spermQuality, 4);
  assert.equal(applyToolCall(chatState, { name: 'bsGrowBody', arguments: { female: 'A', male: '乙', time: '某日', reason: 'x', build: 1 } }).applied, false);
  P(chatState).base.age = 22;
  assert.equal(applyToolCall(chatState, { name: 'bsGrowBody', arguments: { female: 'A', time: '某日', reason: 'x', swordOffset: 1 } }).applied, false);
});

test('主线看不到精方的身材锚点', () => {
  const entry = { name: '乙', isHere: true, age: 31, bodyChangedAtAge: 30 };
  const prompt = buildMainFlowStatePrompt({ existing_state: { A: { profile: { base: { stage: '卵泡期' } } } }, registered_sires: [entry] });
  assert.equal(prompt.includes('bodyChangedAtAge'), false);
});
