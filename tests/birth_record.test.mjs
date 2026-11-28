// 1.4.2 出生：产程伤胎、孩子的出生纪录与孕期 log、生殖疼痛、孩子注册成精方、v17 迁移。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall, describeBirthRecord, getReproductivePain, LABOR_FETAL_HARM } from '../scripts/tools.js';
import { applyRecordNotesResult, buildRecordNotesPayload } from '../scripts/record_notes.js';
import { applyRegistryChildToSire } from '../scripts/registry.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

const fetus = (embryoId, over = {}) => ({
  embryoId, fusionCheckedWith: [], tags: [], fathers: `父${embryoId}`, race: '人类', fatherRace: '人类',
  gender: '女', embryoType: '胎生', weight: 1, tendencyAngle: 0, affinity: 0, amnionDurability: 100, health: 80, ...over,
});

function setup(stage, fetuses, { pregnant = {}, base = {}, realistic = false, days = 280 } = {}) {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = {
    name: 'A', initialized: true,
    profile: {
      base: {
        stage, days: 0, isHere: true, age: 24, race: '人类', vitality: 100, libido: 0, uterinePressure: 75,
        psyStress: 10, vitalityLevel: 4, psyStressLevel: 4, eggs: 0, sperms: [], fertilizationDays: 0, latestSexDays: -1, ...base,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1, gestationSpeciesSpeed: 1 },
      pregnant: {
        pregnantDays: days, effectivePregnantDays: days, fetusesCount: fetuses.length, fetuses, fetalEnergyDrain: 1,
        laborPhase: null, laborBirthNumber: 0, laborHours: 0, effectiveLaborHours: 0, laborPain: 0, presentingEmbryoId: null,
        prodromalRemainingHours: 48, prodromalDelayProgressHours: 0, ...pregnant,
      },
      experience: {}, immune: { realisticLabor: realistic }, metabolism: {}, skills: [], talents: [], children: [], notify: {},
    },
  };
  return chatState;
}
const P = (chatState) => chatState.characters.A.profile;

test('手术产：孩子带出生纪录（方式、孕周、顺位）与固定格式的孕期 log', () => {
  const chatState = setup('孕晚期', [fetus(1), fetus(2)], {
    days: 245,
    pregnant: {
      fetalEvents: [{ time: '孕 30 周', kind: 'curse', scope: 'single', embryoIds: [1], content: '被巫婆诅咒', minutesPassed: 0 }],
      fetalEventSummary: { count: 2, kinds: {}, notes: '母亲孕早期常熬夜' },
    },
  });
  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A' } });
  assert.equal(result.applied, true, result.message);
  const [first, second] = P(chatState).children;
  assert.equal(first.birth.mode, 'surgical');
  assert.equal(first.birth.term, 'preterm', '245 天早产');
  assert.deepEqual([first.birth.order, first.birth.of, second.birth.order], [1, 2, 2]);
  assert.equal(first.birth.healthRatio, 0.8);
  assert.match(describeBirthRecord(first.birth), /^第 1 胎（共 2 胎），孕 35 周早产，手术产，出生健康 80%$/);
  assert.match(first.prenatalLog, /母亲孕早期常熬夜/);
  assert.match(first.prenatalLog, /被巫婆诅咒/);
  assert.doesNotMatch(second.prenatalLog, /被巫婆诅咒/, '只收跟这一胎有关的事件');
  assert.equal(first.prenatalLogPending, true);
  assert.ok(P(chatState).base.postpartumBulk > 1, '生下的胎量记在母体上，产后宫缩痛照它放大');
  assert.deepEqual(P(chatState).base.pouchBrood, { count: 2, kind: 'fetus' }, '育儿袋：这次活产了两个胎');
});

test('孕期 log：下一轮的纪录整理改写成通顺一段；模型没回的留固定格式', () => {
  const chatState = setup('孕晚期', [fetus(1), fetus(2)], { days: 270 });
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A' } });
  const profile = P(chatState);
  const payload = buildRecordNotesPayload('A', profile);
  assert.deepEqual(payload.birth_logs.map((item) => item.child_index), [0, 1]);
  applyRecordNotesResult(profile, payload, { birth_logs: [{ child_index: 0, log: '在母亲腹中平安长大，手术产下。' }] });
  assert.equal(profile.children[0].prenatalLog, '在母亲腹中平安长大，手术产下。');
  assert.equal(profile.children[0].prenatalLogPending, undefined);
  assert.equal(profile.children[1].prenatalLogPending, true, '没回的下次再送');
});

test('肩难产被拉出：记成助产与肩难产，扣上限的 2.5%，抽中时留下产伤（不指定部位）', () => {
  Math.random = () => 0.01;
  const chatState = setup('第二产程', [fetus(1, { descentStage: 3, shoulderDystocia: true })], {
    pregnant: { laborPhase: '胎体娩出', laborBirthNumber: 1, presentingEmbryoId: 1 }, base: { vitality: 0, uterinePressure: 150 }, realistic: true,
  });
  const result = applyToolCall(chatState, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'extract' } });
  assert.equal(result.applied, true, result.message);
  const { birth } = P(chatState).children[0];
  assert.equal(birth.mode, 'assisted');
  assert.deepEqual(birth.complications, ['shoulder_dystocia']);
  assert.deepEqual(birth.injuries, ['stuck']);
  // 产伤只记成因，部位与症状交给模型照这一族的身体与分娩整体情况推想
  assert.match(describeBirthRecord(birth), /肩难产、卡住时留下的产伤/);
  assert.ok(Math.abs(birth.healthRatio - (0.8 - LABOR_FETAL_HARM.shoulderExtract)) < 0.006);
});

test('硬阻塞卡住：前 2 小时每小时 2%，之后每小时 4%；时数记在胎儿身上', async () => {
  Math.random = () => 0.99;
  const chatState = setup('第二产程', [fetus(1, { descentStage: -1, tendencyAngle: 90 })], {
    pregnant: { laborPhase: '胎体下降', laborBirthNumber: 1, presentingEmbryoId: 1 }, realistic: true, base: { uterinePressure: 120 },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { hour: 3 } });
  const [stuck] = P(chatState).pregnant.fetuses;
  assert.equal(stuck.laborRecord.obstructedHours, 3);
  assert.deepEqual(stuck.laborRecord.complications, ['transverse']);
  assert.ok(Math.abs(stuck.health - (80 - 2 * 2 - 1 * 4)) < 0.01, `健康 ${stuck.health}`);
  const { describeLaborRecord } = await import('../scripts/tools.js');
  assert.equal(describeLaborRecord(stuck.laborRecord), '横位难产（卡住约 3 小时）', '卡了多久一并写出');
  // 手术产下后，孩子的出生纪录也写出卡了多久（实机测试抓到的漏洞）
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: 'A' } });
  assert.match(describeBirthRecord(P(chatState).children[0].birth), /横位难产（卡住约 3 小时）/);
});

test('生殖疼痛：月经前两天、产后宫缩痛、假宫缩的瞬时痛；活力越低越痛；痛即为爽只改文字', async () => {
  const { describeReproductivePain } = await import('../scripts/tools.js');
  const mens = setup('月经期', [], { days: 0 });
  assert.deepEqual(getReproductivePain(P(mens)), { level: 3, source: '月经' });
  P(mens).base.days = 1;
  assert.equal(getReproductivePain(P(mens)).level, 2);
  P(mens).base.days = 2;
  assert.equal(getReproductivePain(P(mens)), null, '第三天起不痛');
  P(mens).base.days = 0;
  P(mens).base.vitalityLevel = 2;
  assert.equal(getReproductivePain(P(mens)).level, 4, '活力 2 级 +1');
  P(mens).immune.painPleasure = true;
  assert.equal(describeReproductivePain(P(mens)), '4（月经；痛即为爽）');

  // 孕晚期感觉得到胎动：取最用力那一胎的踢力（与特写同一条公式）当基线
  const pregnant = setup('孕晚期', [fetus(1)], { days: 230 });
  const movement = getReproductivePain(P(pregnant));
  assert.equal(movement.source, '胎动');
  assert.ok(movement.level >= 0.5 && movement.level <= 1.5, JSON.stringify(movement));
  // 假宫缩：子宫撑得越大越痛，宫压越高越紧，盖过胎动
  applyToolCall(pregnant, { name: 'bsAssistFetalPosition', arguments: { female: 'A', action: 'tighten' } });
  const tight = getReproductivePain(P(pregnant));
  assert.equal(tight.source, '假宫缩');
  assert.ok(tight.level > movement.level);
  applyToolCall(pregnant, { name: 'bsPassedTime', arguments: { hour: 3 } });
  assert.equal(getReproductivePain(P(pregnant)).source, '胎动', '几小时后假宫缩消退，回到胎动');
  const { getFalseContractionPainBase } = await import('../scripts/tools.js');
  const twins = setup('孕晚期', [fetus(1), fetus(2)], { days: 280, base: { uterinePressure: 0 } });
  const single = setup('孕晚期', [fetus(1)], { days: 280, base: { uterinePressure: 0 } });
  assert.ok(getFalseContractionPainBase(P(twins)) > getFalseContractionPainBase(P(single)), '双胎撑得更大');

  // 产后宫缩痛：撑过越大的子宫越痛
  const after = setup('产后恢复', [], { base: { postpartumBulk: 1 } });
  const afterTwins = setup('产后恢复', [], { base: { postpartumBulk: 2 } });
  assert.ok(getReproductivePain(P(afterTwins)).level > getReproductivePain(P(after)).level);
});

test('孩子注册成精方：种族、血统、衍生、天赋照孩子，孩子记下已注册为', () => {
  const chatState = setup('卵泡期', []);
  P(chatState).children = [{ name: '小熊', race: '熊人族x人类', bloodline: { 熊人族: 0.5, 人类: 0.5 }, derivedType: '兽化', talents: [{ skillId: 3, level: 2, exp: 0 }] }];
  chatState.sires = { 小熊: { race: '人类', talents: [] } };
  const record = applyRegistryChildToSire(chatState, '小熊', { motherName: 'A', childIndex: 0 });
  assert.equal(record.race, '熊人族x人类');
  assert.deepEqual(record.bloodline, { 熊人族: 0.5, 人类: 0.5 });
  assert.equal(record.derivedType, '兽化');
  assert.deepEqual(record.talents.map((talent) => talent.skillId), [3]);
  assert.deepEqual(record.childSource, { motherName: 'A', childIndex: 0 });
  assert.equal(P(chatState).children[0].registeredAs, '小熊');
});

test('v17 迁移：旧孩子从孕期摘要补出生健康；技能图鉴的预设补上适用身体', () => {
  const ctx = { chatId: 'v17', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('A');
  character.initialized = true;
  character.profile.children = [{ name: '老大', race: '人类', prenatalSummary: { harm: 0, care: 1, worst: null, birthHealthRatio: 0.7 } }];
  chatState.characters.A = character;
  chatState.skillCatalog = [{ id: 1, name: '子宫开发', description: '旧的。' }, { id: 2, name: '剑术', description: '自订的。' }];
  chatState.schemaVersion = 16;
  settings.chatStates.v17 = chatState;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 19);
  assert.deepEqual(migrated.characters.A.profile.children[0].birth, { healthRatio: 0.7 });
  assert.deepEqual(migrated.skillCatalog.map((item) => item.body), ['womb', 'any']);
});

test('孩子长大后注册：提示词要求年龄照实际经过的年数、出生纪录当成长背景、隐性天赋；精方的隐性天赋标出来', async () => {
  const { buildRegistrySystemPrompt, buildSireExtractionSystemPrompt, CHILD_SOURCE_BACKGROUND_RULE } = await import('../scripts/prompts/rules.js');
  const egg = buildRegistrySystemPrompt({}, { payload: { source_child: { age: 18, birth: '孕 34 周早产，手术产' } } });
  assert.ok(egg.includes(CHILD_SOURCE_BACKGROUND_RULE));
  assert.match(CHILD_SOURCE_BACKGROUND_RULE, /source_child\.age/);
  assert.match(CHILD_SOURCE_BACKGROUND_RULE, /隐性/);
  assert.ok(!buildRegistrySystemPrompt({}, { payload: {} }).includes(CHILD_SOURCE_BACKGROUND_RULE), '不是孩子来源就不送');
  assert.ok(buildSireExtractionSystemPrompt({}, {}).includes('payload.source_child'));

  const { buildSirePromptEntries } = await import('../scripts/sires.js');
  const { importSkillPresetGroup } = await import('../scripts/skill_config.js');
  const chatState = state.createEmptyChatState();
  chatState.skillCatalog = importSkillPresetGroup([], 1, 'development').catalog;
  const womb = chatState.skillCatalog.find((item) => item.name === '子宫开发').id;
  const mouth = chatState.skillCatalog.find((item) => item.name === '口腔开发').id;
  chatState.sires = { 小熊: { race: '人类', isHere: true, talents: [{ skillId: womb, level: 2, exp: 0 }, { skillId: mouth, level: 1, exp: 0 }] } };
  const [entry] = buildSirePromptEntries(chatState);
  assert.deepEqual(entry.talents, ['子宫开发（擅长 Lv2，隐性）', '口腔开发（擅长 Lv1）']);
});

test('孩子注册时附上父母（不管在不在场）：已注册的卵方、精方给摘要，没注册的父亲给孩子记录里的快照', async () => {
  const { buildSourceChildParents } = await import('../scripts/registry.js');
  const chatState = setup('产后恢复', []);
  P(chatState).base.isHere = false;
  P(chatState).descriptions = { normalDescription: [{ name: '外貌', value: '黑发高个' }] };
  chatState.sires = { 阿雄: { race: '人类', age: 30, isHere: false, talents: [], descriptions: { normalDescription: [{ name: '外貌', value: '络腮胡' }] } } };
  const parents = buildSourceChildParents(chatState, { motherName: 'A', child: { fathers: '阿雄' } });
  assert.equal(parents.mother.name, 'A');
  assert.equal(parents.mother.isHere, false, '不在场照样附上');
  assert.deepEqual(parents.mother.descriptions, { 外貌: '黑发高个' });
  assert.equal(parents.father.registered, 'sire');
  assert.deepEqual(parents.father.descriptions, { 外貌: '络腮胡' });
  const stranger = buildSourceChildParents(chatState, { motherName: 'A', child: { fathers: '路人', fatherRace: '精灵', fatherBodySize: 4.5 } });
  assert.deepEqual(stranger.father, { name: '路人', registered: null, race: '精灵', bodySize: 4.5 });
  assert.equal(buildSourceChildParents(chatState, { motherName: 'A', child: { fathers: '未知' } }).father, null);
});
