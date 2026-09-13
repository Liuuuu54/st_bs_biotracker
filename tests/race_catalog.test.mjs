// 种族名录回归：词汇表是否真的进入两条提示词，以及百科勾选能否筛选。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRaceCatalogBlock, buildWorldBaselineBlock } from '../scripts/race_prompt_context.js';
import { getDerivedTypeIntroductionLine, getRaceIntroductionLine } from '../scripts/race_config.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';
import { buildBreedingInferenceSystemPrompt, buildRegistrySystemPrompt } from '../scripts/registry.js';

test('名录涵盖全部内建种族与衍生类型', () => {
  const block = buildRaceCatalogBlock();
  for (const race of ['鱼人', '人鱼', '空鲸', '史萊姆', '深潜者']) {
    assert.ok(block.includes(race), `名录应含 ${race}`);
  }
  assert.equal(block.includes('- 胎生: 人类'), false, '人类是隐含基准，不列入异种名录');
  assert.ok(block.includes('人类是始终可用的系统基准'));
  for (const derived of ['血族', '序列', '器灵']) {
    assert.ok(block.includes(derived), `名录应含衍生类型 ${derived}`);
  }
  assert.ok(block.includes('不要自创种族名'), '应指示不要自创种族名');
});

test('紧凑模式不带辨识提示，注册模式带', () => {
  const compact = buildRaceCatalogBlock();
  const hinted = buildRaceCatalogBlock({ withHints: true });
  assert.equal(compact.includes('Fishfolk'), false, '紧凑模式不应带提示');
  assert.ok(hinted.includes('鱼人(Fishfolk，人形而带鱼类特徵与粗尾鳍)'), '注册模式应带提示');
  // 短敘述以英文原名开头时，提示不能只剩英文
  assert.ok(hinted.includes('精灵(Elf，长寿的尖耳亚人)'), '提示应至少含一句中文');
  assert.ok(hinted.length > compact.length);
});

test('百科选择会筛选名录，人类不会作为百科项目出现', () => {
  const selection = { races: ['人类'], derivedTypes: [] };
  const block = buildRaceCatalogBlock({ selection });
  assert.equal(block, '');
  assert.equal(buildRaceCatalogBlock({ selection: { races: [], derivedTypes: [] } }), '');
});

test('追踪与注册提示词共用百科名录选择', () => {
  const selection = { races: ['人类', '精灵'], derivedTypes: ['血族'] };
  const tracked = buildTrackerSystemPrompt('base', null, { race_catalog_selection: selection });
  assert.ok(tracked.includes('- 胎生: 精灵'));
  assert.ok(tracked.includes('人类是始终可用的系统基准'));
  assert.ok(tracked.includes('血族'));
  assert.equal(tracked.includes('鱼人'), false);

  const on = buildRegistrySystemPrompt({}, {});
  assert.ok(on.includes('[可用种族名录]'), '默认应带名录');
  assert.ok(on.includes('鱼人(Fishfolk，人形而带鱼类特徵与粗尾鳍)'), '注册应带辨识提示');
  const filtered = buildRegistrySystemPrompt({ raceCatalogSelection: selection }, {});
  assert.ok(filtered.includes('精灵(Elf，长寿的尖耳亚人)'));
  assert.ok(filtered.includes('血族('));
  assert.equal(filtered.includes('鱼人('), false);
});

test('世界基准独立于 72+12 名录并进入四条提示词', () => {
  const world = '本世界人类的男女生殖生理与社会角色完全翻转。';
  assert.equal(buildWorldBaselineBlock(''), '');
  assert.match(buildWorldBaselineBlock(world), /\[世界基准\][\s\S]*男女生殖生理/);

  const tracker = buildTrackerSystemPrompt('base', null, { world_baseline_prompt: world });
  const mainflow = buildMainFlowStatePrompt({ world_baseline_prompt: world, existing_state: { A: { name: 'A' } } });
  const registry = buildRegistrySystemPrompt({ worldBaselinePrompt: world }, {});
  const breeding = buildBreedingInferenceSystemPrompt({ worldBaselinePrompt: world }, { targetName: 'A' });
  for (const prompt of [tracker, mainflow, registry, breeding]) {
    assert.ok(prompt.includes(world), '每条相关提示词都应收到世界基准');
  }
});

test('衍生类型有内建短敘述并进入名录', () => {
  for (const type of ['器灵', '序列', '星际', '兽化']) {
    assert.ok(getDerivedTypeIntroductionLine(type), `衍生类型 ${type} 应有内建短敘述`);
  }
  const hinted = buildRaceCatalogBlock({ withHints: true });
  assert.ok(hinted.includes('序列(Secondary Dynamics'), '名录应带扩展后的序列提示');
  assert.ok(hinted.includes('兽化(Therian'), '名录应带兽化提示');
});

test('序列兼容三大女性向设定，兽化使用独立兽性与乳意抵免', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  assert.equal(raceConfig.DERIVED_TYPE_RACES.length, 12);
  assert.match(raceConfig.getDerivedTypeIntroductionLine('序列'), /ABO、哨兵／向导与 Dom／Sub/);
  assert.equal(raceConfig.getDerivedTypeFluxProfile('序列').fluxName, '序列活性');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('兽化-猫').fluxName, '兽性');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('兽化-猫').inheritanceSpeed, 1.25);
  assert.deepEqual(
    raceConfig.getDerivedTypeMetabolismExemptions('兽化-猫'),
    ['milk', 'odor', 'companionship'],
  );
  assert.match(raceConfig.getDerivedTypeFluxProfile('兽化').fluxDefinition, /乳意由兽性抵免而不单独追踪/);
});

test('短敘述与名录提示都走使用者覆写', async () => {
  const { setRacePhysiologyOverrides } = await import('../scripts/race_config.js');
  try {
    setRacePhysiologyOverrides({ 精灵: { introductionLine: '本世界的精灵全为扶她。' } });
    assert.equal(getRaceIntroductionLine('精灵'), '本世界的精灵全为扶她。');
    assert.ok(buildRaceCatalogBlock({ withHints: true }).includes('精灵(本世界的精灵全为扶她)'), '名录提示应跟随覆写');
  } finally {
    setRacePhysiologyOverrides({});
  }
});

test('v0.9.5 新增种族有完整参数并归入正确的繁殖分组', async () => {
  const { getRacePhysiologyProfile, getEmbryoTypeByRace } = await import('../scripts/race_config.js');
  const expected = {
    月兔族: '胎生', 狗头人: '卵生', 梅杜莎: '卵胎生',
    修格斯: '胎转卵生', 活体铠甲: '不定型', 伪人: '不定型',
  };
  for (const [race, embryoType] of Object.entries(expected)) {
    const profile = getRacePhysiologyProfile(race);
    assert.ok(profile, `${race} 应有生理参数`);
    assert.ok(Number.isFinite(profile.gestationSpeciesSpeed), `${race} 的孕速应为数值`);
    assert.equal(getEmbryoTypeByRace(race), embryoType, `${race} 的胚胎类型`);
  }
  // 活体铠甲走宿主孵化：受精容易、排卵多，与人类造物组（受精 6）相反
  assert.ok(getRacePhysiologyProfile('活体铠甲').impregnationDifficulty < 1);
  // 伪人以复制取代为核心，同卵分裂倾向远高于人类
  assert.ok(getRacePhysiologyProfile('伪人').identicalProbability > getRacePhysiologyProfile('人类').identicalProbability);
});

test('修行拆成修炼与魔导后，旧存档与繁体写法仍解析得到', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  const canonical = raceConfig.getDerivedTypeFluxProfile('修炼');
  assert.equal(canonical.fluxName, '炁');
  // 旧存档写的是 [修行]XXX，不能静默失效
  assert.equal(raceConfig.getDerivedTypeFluxProfile('修行').fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('修行').inheritanceSpeed, 0.75);
  assert.deepEqual(raceConfig.getDerivedTypeMetabolismExemptions('修行'), ['hunger', 'excretion', 'companionship']);
  // 繁体写法一并映射；带装饰子项也要能解析
  assert.equal(raceConfig.getDerivedTypeFluxProfile('修煉').fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('修行-剑修').fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('魔導').fluxName, '魔力');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('魔导').inheritanceSpeed, 1.0);
});

test('名录提示至少含一句中文，不会只剩英文原名', () => {
  const hinted = buildRaceCatalogBlock({ withHints: true });
  const englishOnly = [...hinted.matchAll(/([^、:\s]+)\(([^)]*)\)/g)].filter((match) => !/[一-龥]/.test(match[2]));
  assert.deepEqual(englishOnly.map((match) => match[1]), [], '提示不应只剩英文原名');
});

test('杜拉罕填补胎生组「难受孕 + 高承载」的空缺', async () => {
  const { VIVIPAROUS_RACES, getRacePhysiologyProfile, getEmbryoTypeByRace } = await import('../scripts/race_config.js');
  const profile = getRacePhysiologyProfile('杜拉罕');
  assert.ok(profile, '杜拉罕应有生理参数');
  assert.equal(getEmbryoTypeByRace('杜拉罕'), '胎生');
  // 躯体不依赖头颅运作 → 承载力强；妖精血统 → 难受孕。
  // 胎生组此前是一条负相关（越难怀越扛不住），杜拉罕是唯一的例外点。
  const quadrant = VIVIPAROUS_RACES.filter((race) => {
    const item = getRacePhysiologyProfile(race);
    return item && item.impregnationDifficulty >= 2 && item.breedTolerance >= 2;
  });
  assert.deepEqual(quadrant, ['杜拉罕']);
  // 出生时头颅仍与躯干相连，分娩难度不该低于人类
  assert.equal(profile.birthDifficulty, getRacePhysiologyProfile('人类').birthDifficulty);
});

test('承载耐受进入提示词，且偏移不再被胎儿种族放大', async () => {
  const { buildRacePhysiologyPrompt } = await import('../scripts/race_prompt_context.js');
  const makePayload = (motherRace, fetusRace) => ({
    existing_state: {
      A: {
        profile: {
          base: { race: motherRace },
          pregnant: { fetuses: [{ fathers: 'A', race: fetusRace, gender: '女', embryoType: '胎生', weight: 1 }] },
        },
      },
    },
  });
  // 单族区块要能读到耐受，西方龙与精灵的叙述必须分得开
  const toleranceLine = (race) => buildRacePhysiologyPrompt(makePayload(race, race))
    .split('\n')
    .find((line) => line.startsWith('- 承载耐受:'));
  assert.ok(toleranceLine('西方龙'), '生理区块应有承载耐受行');
  // 耐受 10 落在最高档：妊娠近乎无负担
  assert.match(toleranceLine('西方龙'), /行动力与常态无异/);
  // 耐受 7 落在次高档：明确点出仍可战斗
  assert.match(toleranceLine('天使'), /战斗/);
  // 低耐受要能分得开
  assert.match(toleranceLine('精灵'), /行动力明显下降/);

  // 人类怀龙胎不该因为胎儿种族耐受高而变成十倍耐受
  const humanCarryingDragon = buildRacePhysiologyPrompt(makePayload('人类', '西方龙'));
  const shiftLine = humanCarryingDragon.split('\n').find((line) => line.startsWith('- 承载耐受偏移:'));
  assert.ok(shiftLine, '妊娠偏移应有承载耐受行');
  assert.match(shiftLine, /^- 承载耐受偏移: 1（/, `人类怀龙胎的耐受应维持 1，实际: ${shiftLine}`);
});
