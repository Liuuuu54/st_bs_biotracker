// 回归测试：v0.9.2 回报的注册／推演／技能三个问题。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import * as registry from '../scripts/registry.js';
import {
  applyRegistrySkillSetup,
  buildBreedingInferenceSystemPrompt,
  buildRegistrySkillSystemPrompt,
  buildRegistrySystemPrompt,
  normalizeInitialSkillTalentConfig,
  resolveRegistryTargetName,
  runRegistry,
  runRegistryBreedingInference,
} from '../scripts/registry.js';
import { writeDiaryEntry } from '../scripts/tools.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
  delete globalThis.SillyTavern;
  delete globalThis.toastr;
});

const CATALOG = [
  { id: 1, name: '剑术', description: '使用长剑进行攻防的实战技巧。' },
  { id: 2, name: '魔力感知', description: '辨识周遭魔力流动的能力。' },
];

test('an unresolvable skill reference is skipped instead of discarding the whole setup', () => {
  // 注册「第一个」角色时图鉴还是空的，模型很容易在 initialTalents 引用
  // 一个没有一并写进 skillDefinitions 的技能名。旧版整份抛错，技能与天赋一起丢失。
  const config = {
    skills: [{ skill: '剑术', level: 3, exp: 0 }, { skill: '不存在的技能', level: 2, exp: 0 }],
    talents: [{ skill: '魔力感知', level: 2, exp: 0 }, { skill: '另一个幽灵技能', level: 1, exp: 0 }],
  };
  const result = normalizeInitialSkillTalentConfig(config, CATALOG);

  assert.deepEqual(result.skills.map((entry) => entry.skillId), [1], '解析得到的技能应保留');
  assert.deepEqual(result.talents.map((entry) => entry.skillId), [2], '解析得到的天赋应保留');
  assert.deepEqual(result.skipped, ['不存在的技能', '另一个幽灵技能'], '跳过的项要回报，不能静默吞掉');
});

test('skipped references are reported to the caller while the rest is written', () => {
  const chatState = state.createEmptyChatState();
  chatState.skillCatalog = CATALOG.map((item) => ({ ...item }));
  chatState.nextSkillId = 3;
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {} } };

  const report = {};
  const character = applyRegistrySkillSetup(chatState, '艾拉', {
    skillDefinitions: [],
    initialSkills: [{ skill: '剑术', level: 2, exp: 0 }],
    initialTalents: [{ skill: '幽灵天赋', level: 1, exp: 0 }],
  }, report);

  assert.equal(character.profile.skills.length, 1, '能解析的技能照常写入');
  assert.deepEqual(report.skipped, ['幽灵天赋']);
});

test('fetus talents map to visible fetuses, replace the listed ones, and report what was skipped', () => {
  const chatState = state.createEmptyChatState();
  chatState.skillCatalog = CATALOG.map((item) => ({ ...item }));
  chatState.nextSkillId = 3;
  const fetus = (embryoId, over = {}) => ({ embryoId, gender: '女', race: '人类', affinity: 20, talents: [], ...over });
  chatState.characters['艾拉'] = {
    name: '艾拉',
    initialized: true,
    profile: {
      base: {},
      pregnant: {
        fetuses: [
          fetus(1, { talents: [{ skillId: 1, level: -1, exp: 0 }] }),
          // 未揭晓的异期胎：角色看不到，不占 fetusIndex
          fetus(2, { conceivedAtDays: 60, tags: ['superfetation'] }),
          fetus(3),
          fetus(4, { talents: [{ skillId: 2, level: 1, exp: 0 }] }),
        ],
      },
    },
  };

  const report = {};
  applyRegistrySkillSetup(chatState, '艾拉', {
    skillDefinitions: [{ name: '胎中新技', description: '只在本次定义的技能。' }],
    initialSkills: [],
    initialTalents: [],
    fetusTalents: [
      { fetusIndex: 0, talents: [{ skill: '剑术', level: 2, exp: 0 }] },
      { fetusIndex: 1, talents: [{ skill: '胎中新技', level: 1, exp: 0 }, { skill: '幽灵天赋', level: 1, exp: 0 }] },
      { fetusIndex: 9, talents: [{ skill: '剑术', level: 1, exp: 0 }] },
    ],
  }, report);

  const fetuses = chatState.characters['艾拉'].profile.pregnant.fetuses;
  assert.deepEqual(fetuses[0].talents.map((t) => [t.skillId, t.level]), [[1, 2]], '第 0 胎整份取代');
  assert.deepEqual(fetuses[1].talents, [], '看不到的异期胎不动');
  const newId = chatState.skillCatalog.find((item) => item.name === '胎中新技').id;
  assert.deepEqual(fetuses[2].talents.map((t) => t.skillId), [newId], '同批定义的技能也解析得到');
  assert.deepEqual(fetuses[3].talents.map((t) => [t.skillId, t.level]), [[2, 1]], '没列出的胎儿不动');
  assert.equal(report.fetusCount, 2);
  assert.deepEqual(report.skipped, ['幽灵天赋', '胎儿#9']);
});

test('the skill prompt asks for fetus talents only when the character carries fetuses', () => {
  assert.match(buildRegistrySkillSystemPrompt({ hasFetuses: true }), /fetusTalents/);
  assert.doesNotMatch(buildRegistrySkillSystemPrompt({}), /fetusTalents/);
});

test('the registry prompt pins name to the requested target character', () => {
  const prompt = buildRegistrySystemPrompt({ payload: { target_character: '露比' } });
  assert.match(prompt, /payload\.target_character/);
  assert.match(prompt, /不得改用角色卡名/);
});

test('registration keeps the typed name even when the model returns the card name', async () => {
  const ctx = {
    chatId: 'registry-name-chat',
    name1: 'User',
    name2: '卡片角色',
    characterId: 0,
    characters: [{ name: '卡片角色', description: '角色卡描述', avatar: 'card.png' }],
    chat: [{ is_user: false, name: '卡片角色', mes: '一段剧情。' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';

  // 模型无视 target_character，回传了角色卡名
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ name: '卡片角色', profile: { base: { age: 20 } } }) } }],
      });
    },
  });

  const character = await runRegistry(ctx, { targetName: '露比' });

  assert.equal(character.name, '露比', '必须使用使用者输入的名字');
  const chatState = state.getChatState(ctx, settings);
  assert.equal(Object.prototype.hasOwnProperty.call(chatState.characters, '露比'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(chatState.characters, '卡片角色'), false, '不该注册成角色卡名');
});

test('bundled registration writes the character, skills, fetus talents and the first diary from one request', async () => {
  const ctx = {
    chatId: 'registry-bundle-chat',
    name1: 'User',
    name2: '卡片角色',
    characterId: 0,
    characters: [{ name: '卡片角色', description: '角色卡描述', avatar: 'card.png' }],
    chat: [{ is_user: false, name: '卡片角色', mes: '一段剧情。' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  state.getChatState(ctx, settings).skillCatalog = CATALOG.map((item) => ({ ...item }));

  let sentPrompt = '';
  let sentPayload = null;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sentPrompt = body.messages.find((m) => m.role === 'system')?.content || '';
    sentPayload = JSON.parse(body.messages.find((m) => m.role === 'user')?.content || '{}');
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          name: '露比',
          profile: {
            base: { age: 24 },
            pregnant: { pregnantDays: 200, fetuses: [{ fathers: '甲', race: '人类', gender: '女' }, { fathers: '甲', race: '人类', gender: '男' }] },
          },
          currentOutfit: {
            main: { name: '孕前连衣裙', note: '修身针织', fitProfile: { capacity: 'tight' } },
            accessories: [{ name: '黑色丝袜', category: 'other', effects: [] }],
            wearState: '腰腹绷紧',
          },
          diary: { time: '第一天', content: '今天被登记了。' },
          skillSetup: {
            skillDefinitions: [{ name: '胎中新技', description: '只在本次定义的技能。' }],
            initialSkills: [{ skill: '剑术', level: 2, exp: 0 }],
            initialTalents: [],
            fetusTalents: [{ fetusIndex: 1, talents: [{ skill: '胎中新技', level: 1, exp: 0 }] }, { fetusIndex: 5, talents: [] }],
          },
        }) } }] });
      },
    };
  };

  const bundleReport = {};
  const character = await runRegistry(ctx, {
    targetName: '露比',
    bundle: { diaryWritingPrompt: '写得简短。', skillPrompt: '她会剑术。', outfitPrompt: '还穿着孕前的裙子。' },
    bundleReport,
  });

  assert.match(sentPrompt, /附带：起始着衣、第一篇日记、初始技能／天赋/);
  assert.equal(sentPayload.outfit_prompt, '还穿着孕前的裙子。');
  assert.equal(sentPayload.diary_writing_prompt, '写得简短。');
  assert.equal(sentPayload.initial_skill_prompt, '她会剑术。');
  assert.ok(Array.isArray(sentPayload.skill_catalog) && sentPayload.skill_catalog.length === CATALOG.length);

  const chatState = state.getChatState(ctx, settings);
  assert.equal('diary' in character, false, '附带的栏位不能混进角色资料');
  assert.deepEqual(character.profile.skills.map((s) => [s.skillId, s.level]), [[1, 2]]);
  const newId = chatState.skillCatalog.find((item) => item.name === '胎中新技').id;
  const fetuses = character.profile.pregnant.fetuses;
  assert.deepEqual(fetuses.map((f) => (f.talents || []).map((t) => t.skillId)), [[], [newId]], '胎儿天赋依输出顺序挂上');
  assert.deepEqual(character.profile.diary.map((d) => d.time), ['第一天']);
  assert.equal(bundleReport.fetusCount, 1);
  assert.deepEqual(bundleReport.skipped, ['胎儿#5']);
  assert.equal(bundleReport.diary.time, '第一天');
  const worn = character.profile.wardrobe.items.find((item) => item.id === character.profile.outfit.mainItemId);
  assert.equal(worn.name, '孕前连衣裙');
  assert.equal(character.profile.outfit.accessoryItemIds.length, 1);
  assert.equal(bundleReport.outfit.wearState, '腰腹绷紧');
});

test('with the skill and wardrobe systems off, bundled registration only adds the diary and drops the outfit', async () => {
  const ctx = {
    chatId: 'registry-bundle-off-chat',
    name1: 'User',
    name2: '卡片角色',
    characterId: 0,
    characters: [{ name: '卡片角色', description: '角色卡描述', avatar: 'card.png' }],
    chat: [{ is_user: false, name: '卡片角色', mes: '一段剧情。' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  settings.skillSystemEnabled = false;
  settings.wardrobeSystemEnabled = false;
  state.getChatState(ctx, settings).skillCatalog = CATALOG.map((item) => ({ ...item }));

  let sentPrompt = '';
  let sentPayload = null;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sentPrompt = body.messages.find((m) => m.role === 'system')?.content || '';
    sentPayload = JSON.parse(body.messages.find((m) => m.role === 'user')?.content || '{}');
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          name: '露比',
          profile: {
            base: { age: 24 },
            currentOutfit: { main: { name: '旅行斗篷', note: '灰色' } },
          },
          diary: { time: '第一天', content: '今天被登记了。' },
          skillSetup: { skillDefinitions: [], initialSkills: [{ skill: '剑术', level: 2, exp: 0 }], initialTalents: [] },
        }) } }] });
      },
    };
  };

  const bundleReport = {};
  const character = await runRegistry(ctx, {
    targetName: '露比',
    bundle: { diaryWritingPrompt: '写得简短。', skillPrompt: '她会剑术。' },
    bundleReport,
  });

  assert.match(sentPrompt, /附带：第一篇日记】/);
  assert.doesNotMatch(sentPrompt, /skillSetup|currentOutfit|当前衣着/);
  assert.equal('skill_catalog' in sentPayload, false);
  assert.equal('initial_skill_prompt' in sentPayload, false);
  assert.equal(sentPayload.diary_writing_prompt, '写得简短。');
  assert.deepEqual(character.profile.skills || [], []);
  assert.equal(character.profile.outfit?.mainItemId ?? null, null);
  assert.deepEqual(character.profile.diary.map((d) => d.time), ['第一天']);
  assert.equal(bundleReport.skillsWritten, undefined);
});

test('plain registration no longer asks for the outfit and keeps a well-formed JSON sample', () => {
  const prompt = buildRegistrySystemPrompt({}, {});
  assert.doesNotMatch(prompt, /currentOutfit|当前衣着/);
  assert.match(prompt, /"pregnantDescription": \{ "字段名": "描述内容" \}\n {4}\}\n {2}\}\n\}/);
  assert.match(prompt, /角色补充设定】/);
});

test('outfit prompts ask for fit levels that match the description instead of copyable sample values', () => {
  const outfit = registry.buildStartingOutfitSystemPrompt({ outfitPrompt: '' });
  assert.match(outfit, /"capacity":"tight\|fitted\|stretch\|loose"/);
  assert.doesNotMatch(outfit, /"capacity":"fitted"/);
  for (const prompt of [outfit, registry.buildWardrobePrepSystemPrompt({}, {}), registry.buildRegistryBundlePrompt({ includeOutfit: true })]) {
    assert.match(prompt, /孕妇装、罩衫的 capacity 用 stretch 或 loose/);
  }
});

test('outfit prompts treat categories as labels and keep the item count small', () => {
  const outfit = registry.buildStartingOutfitSystemPrompt({ outfitPrompt: '' });
  assert.match(outfit, /category 只是分类标签，不是清单/);
  assert.match(outfit, /通常 0～3 件/);
  const prep = registry.buildWardrobePrepSystemPrompt({}, { wardrobePrepPrompt: '增加一件符合发条朋克的外套和鞋子' });
  assert.match(prep, /用户明确列出要补的项目时只补那些/);
  assert.match(prep, /增加一件符合发条朋克的外套和鞋子/);
});

test('a diary rewritten by hand replaces the same story day, while the tracker stays on cooldown', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = { name: '艾拉', initialized: true, profile: { base: {}, diary: [] } };
  assert.equal(writeDiaryEntry(chatState, '艾拉', { time: '第一天', content: '初稿' }).applied, true);
  assert.equal(writeDiaryEntry(chatState, '艾拉', { time: '第一天', content: '重写' }).applied, false, '同一天自动写入仍受冷却');
  const replaced = writeDiaryEntry(chatState, '艾拉', { time: '第一天', content: '重写' }, { replaceSameDay: true });
  assert.equal(replaced.applied, true);
  assert.equal(replaced.replaced, true);
  assert.deepEqual(chatState.characters['艾拉'].profile.diary.map((d) => d.content), ['重写']);
});

test('the skill prompt spells out that talents also need a defined skill', () => {
  const prompt = buildRegistrySkillSystemPrompt({});
  // 天赋是「对某个技能的擅长／苦手」，模型常把它当成独立的性格标签而漏掉定义
  assert.match(prompt, /天赋同样需要技能作为载体/);
  assert.match(prompt, /initialTalents 引用的技能若不在 payload\.skill_catalog 中，必须先在本次 skillDefinitions 里定义/);
  // 输出前自检，放在 JSON 结构旁边最容易被回顾到
  assert.match(prompt, /输出前请逐条自检/);
});

test('an empty catalog is called out because every reference must be defined in-place', () => {
  const empty = buildRegistrySkillSystemPrompt({ emptyCatalog: true });
  assert.match(empty, /skill_catalog 目前是空的（这是本聊天的第一个角色）/);
  assert.match(empty, /没有任何既有技能可以复用/);
  // 空图鉴时不该再说「只有图鉴无法表达时才能新增」，那会自相矛盾
  assert.doesNotMatch(empty, /只有现有图鉴确实无法表达所需技能时/);

  const normal = buildRegistrySkillSystemPrompt({});
  assert.doesNotMatch(normal, /目前是空的/);
  assert.match(normal, /只有现有图鉴确实无法表达所需技能时/);
});

function makeCompleteStageProfiles() {
  const stages = ['0', '1_25', '26_50', '51_75', '76_100', '100_plus'];
  const makeAxis = (axis) => Object.fromEntries(stages.map((stage) => [stage, `测试角色在 ${axis} ${stage} 的长期表现。`]));
  return {
    mens: Object.fromEntries(['mastery', 'desire', 'autonomy'].map((axis) => [axis, makeAxis(axis)])),
    preg: Object.fromEntries(['confidence', 'bonding', 'stance'].map((axis) => [axis, makeAxis(axis)])),
  };
}

test('breeding inference pins target_character to the typed name instead of user or card name', async () => {
  const ctx = {
    chatId: 'breeding-target-chat',
    name1: '陆素素',
    name2: '卡片角色',
    characterId: 0,
    characters: [{ name: '卡片角色', description: '角色卡描述', avatar: 'card.png' }],
    chat: [{ is_user: true, name: 'user', mes: '一段剧情。' }],
    extensionSettings: {},
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          target_character: 'user',
          pregnancy_status: 'mens',
          mens: { mastery_value: 50, desire_value: 50, autonomy_value: 50, isChaste: false, hasContraception: false },
          preg: null,
          stageProfiles: makeCompleteStageProfiles(),
        }) } }],
      });
    },
  });

  const prompt = buildBreedingInferenceSystemPrompt(settings, { targetName: '陆素素' });
  assert.match(prompt, /唯一目标是「陆素素」/);
  const result = await runRegistryBreedingInference(ctx, { targetName: '{{user}}', declaredRace: '人类' });
  assert.equal(result.target_character, '陆素素');
});
test('registry target resolves ST user aliases to the current user name', () => {
  const ctx = { name1: '沈祁苓' };
  for (const alias of ['user', '{user}', '{{user}}', '<user>']) {
    assert.equal(resolveRegistryTargetName(ctx, alias), '沈祁苓', `${alias} 应解析为当前 user 名`);
  }
  assert.equal(resolveRegistryTargetName(ctx, '陆素素'), '陆素素', '普通角色名不应变化');
});

test('hybrid fetus race survives registration without being re-mixed (P0 regression)', () => {
  // 回归锚点：模型把完整胎儿种族（父×母）写进 race、未提供 fatherRace 时，
  // normalize 不得再用母系二次混血（曾产出「兽耳族-猫又x蜥蜴人x人类」）。
  const { applyRegistryResult } = registry;
  const chatState = state.createEmptyChatState();
  const result = {
    name: '孕母',
    profile: {
      base: { race: '人类' },
      pregnant: {
        pregnantDays: 140,
        fetusesCount: 1,
        fetuses: [{ fathers: '父', provider: null, race: '兽耳族-猫又x蜥蜴人', gender: '女', embryoType: '胎生' }],
      },
      bio: {},
      immune: {},
      experience: {},
      descriptions: {},
      metabolism: { excretion: 10, hunger: 10, sleep: 10, milk: 10, odor: 10, companionship: 10 },
    },
  };
  applyRegistryResult(chatState, result);
  const fetus = chatState.characters['孕母'].profile.pregnant.fetuses[0];
  assert.equal(fetus.race, '兽耳族-猫又x蜥蜴人', '未提供 fatherRace 时 race 应原样保留，不得二次混血');
  assert.equal(fetus.fatherRace, null, '未显式提供父系时 fatherRace 应为空');
});

test('explicit fatherRace is honored and mixed against the mother (P0 companion)', () => {
  const { applyRegistryResult } = registry;
  const chatState = state.createEmptyChatState();
  const result = {
    name: '孕母',
    profile: {
      base: { race: '人类' },
      pregnant: {
        pregnantDays: 140,
        fetusesCount: 1,
        fetuses: [{ fathers: '父', provider: null, race: '人类x精灵', fatherRace: '精灵', gender: '女', embryoType: '胎生' }],
      },
      bio: {},
      immune: {},
      experience: {},
      descriptions: {},
      metabolism: { excretion: 10, hunger: 10, sleep: 10, milk: 10, odor: 10, companionship: 10 },
    },
  };
  applyRegistryResult(chatState, result);
  const fetus = chatState.characters['孕母'].profile.pregnant.fetuses[0];
  assert.equal(fetus.race, '精灵x人类', '显式 fatherRace 应重算为 父系x母系');
  assert.equal(fetus.fatherRace, '精灵');
});

test('an already-pregnant registration reconstructs omitted derived inheritance progress', () => {
  const { applyRegistryResult } = registry;
  const chatState = state.createEmptyChatState();
  const result = {
    name: '魔导孕母',
    profile: {
      base: { race: '人类', derivedType: '魔导' },
      pregnant: {
        pregnantDays: 140,
        fetusesCount: 1,
        fetuses: [{ fathers: '凡人父亲', provider: null, race: '人类', gender: '女', embryoType: '胎生', affinity: 0 }],
      },
      bio: {},
      immune: {},
      experience: {},
      descriptions: {},
      metabolism: { excretion: 10, hunger: 10, sleep: 10, milk: 10, odor: 10, companionship: 10 },
    },
  };

  applyRegistryResult(chatState, result);
  const fetus = chatState.characters['魔导孕母'].profile.pregnant.fetuses[0];
  assert.equal(fetus.maternalDerivedTypeProgress, 75);
});

function breedingCtx() {
  const ctx = {
    chatId: 'breeding-shape-chat', name1: '陆素素', name2: '卡片角色', characterId: 0,
    characters: [{ name: '卡片角色', description: '角色卡描述', avatar: 'card.png' }],
    chat: [{ is_user: true, name: 'user', mes: '一段剧情。' }],
    extensionSettings: {}, saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  return ctx;
}

const reply = (body) => ({ ok: true, status: 200, async text() { return JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }); } });
const mensValues = { mastery_value: 50, desire_value: 50, autonomy_value: 50 };
const dashedMens = () => Object.fromEntries(Object.entries(makeCompleteStageProfiles().mens).map(([axis, stages]) => [axis,
  Object.fromEntries(Object.entries(stages).map(([key, text]) => [key === '100_plus' ? '100+' : key.replace('_', '-'), text]))]));

test('breeding inference accepts stageProfiles without the side level, inside the side block, or with dashed stage keys', async () => {
  const shapes = [
    { mens: mensValues, stageProfiles: makeCompleteStageProfiles().mens },
    { mens: { ...mensValues, stageProfiles: makeCompleteStageProfiles().mens } },
    { mens: mensValues, stageProfiles: { mens: dashedMens() } },
  ];
  for (const shape of shapes) {
    const ctx = breedingCtx();
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return reply({ target_character: '陆素素', pregnancy_status: 'mens', ...shape }); };
    const result = await runRegistryBreedingInference(ctx, { targetName: '陆素素' });
    assert.equal(calls, 1, '形状可解析时不重问');
    assert.equal(result.stageProfiles.mens.mastery['100_plus'], '测试角色在 mastery 100_plus 的长期表现。');
  }
});

test('breeding inference asks once more when stageProfiles are missing, and only then fails', async () => {
  let ctx = breedingCtx();
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    prompts.push(JSON.parse(init.body).messages[0].content);
    return reply(prompts.length === 1
      ? { target_character: '陆素素', pregnancy_status: 'mens', mens: mensValues }
      : { target_character: '陆素素', pregnancy_status: 'mens', mens: mensValues, stageProfiles: makeCompleteStageProfiles() });
  };
  const result = await runRegistryBreedingInference(ctx, { targetName: '陆素素' });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /上一次输出缺少 stageProfiles 的 18 项/);
  assert.ok(result.stageProfiles.mens.autonomy['0']);

  ctx = breedingCtx();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return reply({ target_character: '陆素素', pregnancy_status: 'mens', mens: mensValues }); };
  await assert.rejects(runRegistryBreedingInference(ctx, { targetName: '陆素素' }), /繁育推演缺少当前侧 3x6 stageProfiles/);
  assert.equal(calls, 2);
});

test('a failed breeding inference shows the start of what the model returned, for bug reports', async () => {
  const ctx = breedingCtx();
  globalThis.fetch = async () => reply({ target_character: '陆素素', pregnancy_status: 'mens', mens: mensValues, stageProfiles: { 奇怪的形状: true } });
  await assert.rejects(runRegistryBreedingInference(ctx, { targetName: '陆素素' }), (error) => {
    assert.match(error.message, /共 18 项/);
    assert.match(error.message, /模型回传开头：\{.*奇怪的形状/);
    return true;
  });
});
