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
  assert.ok(block.includes('- 胎生: 人类、'), '人类与其他物种一样列在胎生组');
  assert.equal(block.includes('始终可用'), false, '人类不再是隐含基准');
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

test('百科选择会筛选名录，人类与其他物种一样可勾选', () => {
  const humanOnly = buildRaceCatalogBlock({ selection: { version: 2, races: ['人类'], derivedTypes: [] } });
  assert.ok(humanOnly.includes('- 胎生: 人类'));
  assert.equal(humanOnly.includes('精灵'), false);
  assert.equal(buildRaceCatalogBlock({ selection: { version: 2, races: [], derivedTypes: [] } }), '');
  const noHuman = buildRaceCatalogBlock({ selection: { version: 2, races: ['精灵'], derivedTypes: [] } });
  assert.ok(noHuman.includes('- 胎生: 精灵'));
  assert.equal(noHuman.includes('人类'), false, '取消勾选人类后名录不再提人类');
});

test('追踪与注册提示词共用百科名录选择', () => {
  const selection = { version: 2, races: ['人类', '精灵'], derivedTypes: ['血族'] };
  const tracked = buildTrackerSystemPrompt('base', null, { race_catalog_selection: selection });
  assert.ok(tracked.includes('- 胎生: 人类、精灵'));
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

test('世界基准独立于异种与衍生类型名录并进入四条提示词', () => {
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

test('序列兼容三大女性向设定、以信息素豁免体味，兽化保留乳意', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  assert.match(raceConfig.getDerivedTypeIntroductionLine('序列'), /ABO、哨兵／向导与 Dom／Sub/);
  assert.equal(raceConfig.getDerivedTypeFluxProfile('序列').fluxName, '序列活性');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('兽化-猫').fluxName, '兽性');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('兽化-猫').inheritanceSpeed, 1.4);
  assert.deepEqual(
    raceConfig.getDerivedTypeMetabolismExemptions('兽化-猫'),
    ['excretion', 'odor'],
  );
  assert.ok(raceConfig.getDerivedTypeMetabolismExemptions('序列-ABO').includes('odor'), '信息素比体味更全面');
  assert.doesNotMatch(raceConfig.getDerivedTypeFluxProfile('兽化').fluxDefinition, /乳意/);
});

test('咒缚随血脉全族入约：遗传最快、契约主抵免陪伴，豁免组合不与其他衍生重复', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  const speeds = raceConfig.DERIVED_TYPE_RACES.map((type) => raceConfig.getDerivedTypeInheritanceProfile(type).inheritanceSpeed);
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('咒缚-深渊').inheritanceSpeed, Math.max(...speeds));
  assert.equal(raceConfig.getDerivedTypeFluxProfile('咒縛').fluxName, '咒蚀', '繁体写法也应认得');

  const exemptions = raceConfig.getDerivedTypeMetabolismExemptions('咒缚');
  assert.ok(exemptions.includes('companionship'), '契约主始终随侍，陪伴需求必须豁免');
  const key = (list) => [...list].sort().join();
  const others = raceConfig.DERIVED_TYPE_RACES.filter((type) => type !== '咒缚')
    .map((type) => key(raceConfig.getDerivedTypeMetabolismExemptions(type)));
  assert.equal(others.includes(key(exemptions)), false);

  assert.ok(buildRaceCatalogBlock({ withHints: true }).includes('咒缚(Hexbound'), '名录应带咒缚提示');
});

test('每种衍生恰好豁免两项不同需求，且豁免组合两两不重复', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  const needs = ['excretion', 'hunger', 'sleep', 'milk', 'odor', 'companionship'];
  const seen = new Map();
  for (const type of raceConfig.DERIVED_TYPE_RACES) {
    const exemptions = raceConfig.getDerivedTypeMetabolismExemptions(type);
    assert.equal(exemptions.length, 2, `${type} 应只豁免两项需求`);
    assert.equal(new Set(exemptions).size, 2, `${type} 应豁免两项不同需求`);
    assert.ok(exemptions.every((need) => needs.includes(need)), `${type} 的豁免应是已知需求`);
    const key = [...exemptions].sort().join();
    assert.equal(seen.get(key), undefined, `${type} 与 ${seen.get(key)} 的豁免组合重复`);
    seen.set(key, type);
  }
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

test('修炼与魔导的繁体写法、带装饰子项都解析得到', async () => {
  const raceConfig = await import('../scripts/race_config.js');
  const canonical = raceConfig.getDerivedTypeFluxProfile('修炼');
  assert.equal(canonical.fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('修炼').inheritanceSpeed, 0.8);
  assert.deepEqual(raceConfig.getDerivedTypeMetabolismExemptions('修炼'), ['hunger', 'companionship']);
  // 繁体写法一并映射；带装饰子项也要能解析
  assert.equal(raceConfig.getDerivedTypeFluxProfile('修煉').fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('修炼-剑修').fluxName, '炁');
  assert.equal(raceConfig.getDerivedTypeFluxProfile('魔導').fluxName, '魔力');
  assert.equal(raceConfig.getDerivedTypeInheritanceProfile('魔导').inheritanceSpeed, 1.0);
});

test('名录提示至少含一句中文，不会只剩英文原名', () => {
  const hinted = buildRaceCatalogBlock({ withHints: true });
  const englishOnly = [...hinted.matchAll(/([^、:\s]+)\(([^)]*)\)/g)].filter((match) => !/[一-龥]/.test(match[2]));
  assert.deepEqual(englishOnly.map((match) => match[1]), [], '提示不应只剩英文原名');
});

test('米诺陶族的承载耐受为胎生之最，杜拉罕只是难受孕', async () => {
  const { VIVIPAROUS_RACES, getRacePhysiologyProfile, getEmbryoTypeByRace } = await import('../scripts/race_config.js');
  // 承载耐受同时放大泌乳，牛系是胎生组唯一的高承载顶点
  const ranked = VIVIPAROUS_RACES
    .map((race) => [race, getRacePhysiologyProfile(race).breedTolerance])
    .sort((a, b) => b[1] - a[1]);
  assert.equal(ranked[0][0], '米诺陶族');
  assert.ok(ranked[0][1] > ranked[1][1], '米诺陶族应独占胎生最高承载');

  const dullahan = getRacePhysiologyProfile('杜拉罕');
  assert.equal(getEmbryoTypeByRace('杜拉罕'), '胎生');
  assert.ok(dullahan.impregnationDifficulty >= 2, '妖精血统 → 难受孕');
  assert.ok(dullahan.breedTolerance < 2, '头颅离体与哺育能力无关，不再给高承载');
  // 出生时头颅仍与躯干相连，分娩难度不该低于人类
  assert.equal(dullahan.birthDifficulty, getRacePhysiologyProfile('人类').birthDifficulty);
});

test('巨人独占胎生组「难受孕 + 高承载」', async () => {
  const { VIVIPAROUS_RACES, getRacePhysiologyProfile } = await import('../scripts/race_config.js');
  const quadrant = VIVIPAROUS_RACES.filter((race) => {
    const item = getRacePhysiologyProfile(race);
    return item.impregnationDifficulty >= 2 && item.breedTolerance >= 2;
  });
  assert.deepEqual(quadrant, ['巨人']);
});

test('长恢复种族的恢复系数彼此拉开，海马族产后几乎可立即再孕', async () => {
  const { ALL_BUILTIN_RACES, getRacePhysiologyProfile } = await import('../scripts/race_config.js');
  const counts = new Map();
  for (const race of ALL_BUILTIN_RACES) {
    const value = getRacePhysiologyProfile(race).recoveryCoefficient;
    if (value >= 5) counts.set(value, [...(counts.get(value) || []), race]);
  }
  for (const [value, races] of counts) {
    assert.ok(races.length <= 5, `恢复系数 ${value} 挤了 ${races.length} 个种族：${races.join('、')}`);
  }
  // 雄性育儿袋孕育，产后很快就能再次受孕
  assert.ok(getRacePhysiologyProfile('海马族').recoveryCoefficient < 1);
});

test('核焰族与华根蕴桃雌核遗传，海德拉是胎转卵生中恢复最快的', async () => {
  const { METOVIVIPAROUS_RACES, deriveFetusRace, getRacePhysiologyProfile } = await import('../scripts/race_config.js');
  // 活体星球式：与异族所生顺应母体，只有核焰族母亲才得纯种
  assert.equal(deriveFetusRace('人类', '核焰族'), '人类');
  assert.equal(deriveFetusRace('核焰族', '人类'), '核焰族');
  const fusion = getRacePhysiologyProfile('核焰族');
  assert.equal(fusion.identicalProbability, 0, '恒星伴星式双胎，从不同卵分裂');
  assert.ok(fusion.gestationSpeciesSpeed < 1, '孕期漫长');

  assert.equal(deriveFetusRace('华根蕴桃', '人类'), '华根蕴桃');
  const peach = getRacePhysiologyProfile('华根蕴桃');
  assert.equal(peach.genderRatio, 50, '雌为仙桃娘、雄为人参精，性别比趋近平衡');
  assert.equal(peach.orgasmOvulationAmount, 0);
  assert.equal(peach.companionEggsMean, 1, '一胎伴生一颗嫩参或嫩桃，雌雄同株');

  const recovery = (race) => getRacePhysiologyProfile(race).recoveryCoefficient;
  const others = METOVIVIPAROUS_RACES.filter((race) => race !== '海德拉');
  assert.ok(others.every((race) => recovery('海德拉') < recovery(race)), '断首再生，恢复最快');
});

test('天使与恶魔刻意对称：胚型、核型与生理数值完全相同', async () => {
  const { RACE_PHYSIOLOGY_FIELDS, getRacePhysiologyProfile } = await import('../scripts/race_config.js');
  const angel = getRacePhysiologyProfile('天使');
  const demon = getRacePhysiologyProfile('恶魔');
  for (const field of [...RACE_PHYSIOLOGY_FIELDS, 'embryoType', 'inheritanceMode']) {
    assert.equal(angel[field], demon[field], `天使与恶魔的 ${field} 应对称`);
  }
});

test('卓尔沿用精灵数值，只是较易受精、较难分娩', async () => {
  const { getRacePhysiologyProfile, RACE_PHYSIOLOGY_FIELDS } = await import('../scripts/race_config.js');
  const elf = getRacePhysiologyProfile('精灵');
  const drow = getRacePhysiologyProfile('卓尔');
  for (const field of RACE_PHYSIOLOGY_FIELDS) {
    if (field === 'impregnationDifficulty' || field === 'birthDifficulty') continue;
    assert.equal(drow[field], elf[field], `卓尔的 ${field} 应与精灵相同`);
  }
  assert.ok(drow.impregnationDifficulty < elf.impregnationDifficulty);
  assert.ok(drow.birthDifficulty > elf.birthDifficulty);
});

test('承载耐受进入提示词，且偏移不再被胎儿种族放大', async () => {
  const { buildRacePhysiologyPrompt } = await import('../scripts/race_prompt_context.js');
  const { setRacePhysiologyOverrides } = await import('../scripts/race_config.js');
  // 文字档位只看数值，用覆写钉住，不跟着内置表的数值调整变动
  setRacePhysiologyOverrides({ 西方龙: { breedTolerance: 10 }, 天使: { breedTolerance: 7 } });
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
  setRacePhysiologyOverrides({});

  // 人类怀龙胎不该因为胎儿种族耐受高而变成十倍耐受
  const humanCarryingDragon = buildRacePhysiologyPrompt(makePayload('人类', '西方龙'));
  const shiftLine = humanCarryingDragon.split('\n').find((line) => line.startsWith('- 承载耐受偏移:'));
  assert.ok(shiftLine, '妊娠偏移应有承载耐受行');
  assert.match(shiftLine, /^- 承载耐受偏移: 1（/, `人类怀龙胎的耐受应维持 1，实际: ${shiftLine}`);
});
