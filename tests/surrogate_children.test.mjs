// 代孕／寄生：胎儿带 provider 时，孩子必须归到提供者名下而不是凭空消失。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { getBaseRaceName, getRaceComponents, getRaceDescriptorComponents, parseRaceDescriptor } from '../scripts/race_config.js';
import { applyToolCall, calculateChimeraFusionProbability } from '../scripts/tools.js';

function makeCharacter(name, fetuses = []) {
  return {
    name,
    initialized: true,
    profile: {
      base: { stage: fetuses.length > 0 ? '孕晚期' : '卵泡期', days: 0, race: '人类', vitality: 100 },
      pregnant: {
        pregnantDays: 240,
        effectivePregnantDays: 240,
        fetusesCount: fetuses.length,
        fetuses,
        fetalEnergyDrain: 1,
        amnionDurability: 100,
      },
      bio: { birthDifficulty: 1, breedTolerance: 1 },
      immune: {},
      metabolism: {},
      children: [],
      notify: {},
    },
  };
}

function makeFetus(overrides = {}) {
  return {
    fathers: '莱昂',
    provider: null,
    race: '人类',
    gender: '女',
    embryoType: '胎生',
    weight: 1,
    tendencyAngle: 0,
    affinity: 0,
    ...overrides,
  };
}

const childrenOf = (chatState, name) => chatState.characters[name].profile.children || [];

test('a surrogate birth hands the child to the registered provider', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['代孕者'] = makeCharacter('代孕者', [makeFetus({ provider: '委托母亲' })]);
  chatState.characters['委托母亲'] = makeCharacter('委托母亲');

  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '代孕者' } });

  assert.equal(result.applied, true);
  // 先前这里是 continue：孩子既不给承载者、也不给提供者，直接消失
  assert.equal(childrenOf(chatState, '代孕者').length, 0, '承载者不该获得孩子');
  const received = childrenOf(chatState, '委托母亲');
  assert.equal(received.length, 1, '孩子必须转交给提供者');
  assert.equal(received[0].fathers, '莱昂');
  assert.equal(received[0].provider ?? null, null, '已在正确的人名下就不必再留标记');
});

test('an unregistered provider keeps the child on the host with its marker', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['宿主'] = makeCharacter('宿主', [makeFetus({ provider: '虫母', race: '虫族' })]);

  const result = applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '宿主' } });

  assert.equal(result.applied, true);
  const kept = childrenOf(chatState, '宿主');
  // 提供者没注册就无处可转，但绝不能像先前那样丢掉
  assert.equal(kept.length, 1, '无处可转时也必须保留记录');
  assert.equal(kept[0].provider, '虫母', '保留标记，日后仍可辨认归属');
  assert.equal(kept[0].race, '虫族');
});

test('an ordinary birth still lands on the mother herself', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = makeCharacter('艾拉', [makeFetus()]);

  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '艾拉' } });

  const own = childrenOf(chatState, '艾拉');
  assert.equal(own.length, 1, '没有 provider 的孩子照常记在自己名下');
  assert.equal(own[0].provider ?? null, null);
});

test('the provider marker survives chat-state persistence', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['宿主'] = makeCharacter('宿主');
  chatState.characters['宿主'].profile.children = [{
    name: null, fathers: '未知', provider: '虫母', gender: '女',
    race: '虫族', derivedType: null, age: 0,
    birthWeightRatio: 1, birthAffinity: 0, talents: [],
  }];

  // 走一次工具调用触发正规化，确认 provider 不会在存档流程中被剥掉
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { minute: 1 } });

  assert.equal(childrenOf(chatState, '宿主')[0].provider, '虫母');
});

function makeHost(name, race = '人类') {
  const character = makeCharacter(name);
  character.profile.base.race = race;
  character.profile.base.stage = '卵泡期';
  character.profile.pregnant.pregnantDays = 0;
  character.profile.pregnant.effectivePregnantDays = 0;
  character.profile.pregnant.fetuses = [];
  character.profile.pregnant.fetusesCount = 0;
  character.profile.pregnant.fetalEnergyDrain = 0;
  return character;
}

test('implanting queues every embryo under one pre-implantation clock', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['代孕者'] = makeHost('代孕者');
  chatState.characters['委托母亲'] = makeHost('委托母亲');

  const result = applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '代孕者', provider: '委托母亲', fathers: '委托父亲', count: 2 },
  });

  assert.equal(result.applied, true);
  const carrier = chatState.characters['代孕者'].profile;
  assert.equal(carrier.base.stage, '卵泡期', '移入受精卵不应直接跳到孕早期');
  assert.equal(carrier.base.fertilizationDays, 0);
  assert.equal(carrier.pregnant.fetuses.length, 2);
  for (const fetus of carrier.pregnant.fetuses) {
    assert.equal(fetus.provider, '委托母亲', '每个胚胎都要记住归属');
    assert.equal(fetus.fathers, '委托父亲');
  }
});

test('embryo race follows the provider, not the carrier', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['宿主'] = makeHost('宿主', '人类');
  chatState.characters['虫母'] = makeHost('虫母', '虫族');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '宿主', provider: '虫母', count: 1 },
  });

  // 必须精确比对：按承载者算会得到「人类x虫族」，光用 /虫族/ 匹配是抓不出来的
  const fetus = chatState.characters['宿主'].profile.pregnant.fetuses[0];
  assert.equal(fetus.race, '虫族', `胚胎应是纯虫族血统，实际为 ${fetus.race}`);
});

test('decorated hybrid descriptors preserve every subtype while physiology uses each base race', () => {
  const descriptor = '[魔女]獸耳族-兔x精靈-木';
  assert.deepEqual(parseRaceDescriptor(descriptor), {
    race: '獸耳族-兔x精靈-木',
    derivedType: '魔女',
  });
  assert.deepEqual(getRaceDescriptorComponents(descriptor), ['獸耳族-兔', '精靈-木']);
  assert.deepEqual(getRaceComponents(descriptor), ['獸耳族', '精靈']);
  assert.equal(getBaseRaceName(descriptor), '獸耳族');

  const chatState = state.createEmptyChatState();
  chatState.characters['孕母'] = makeHost('孕母', '人类');
  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: {
      female: '孕母',
      provider: '混血卵源',
      race: descriptor,
      fathers: '同血统父源',
      fatherRace: '獸耳族-兔x精靈-木',
    },
  });

  const fetus = chatState.characters['孕母'].profile.pregnant.fetuses[0];
  assert.equal(fetus.race, '獸耳族-兔x精靈-木', '同血统配对不可丢失任一装饰子项');
  assert.equal(fetus.fatherDerivedType, '魔女', 'fatherRace 无 derivedType 时仍应从卵源描述符回退');
});

test('surrogate derived types use the carrier as mother and external descriptors as father', () => {
  const preferred = state.createEmptyChatState();
  preferred.characters['孕母'] = makeHost('孕母', '人类');
  preferred.characters['孕母'].profile.base.derivedType = '魔女';

  applyToolCall(preferred, {
    name: 'bsImplantEmbryo',
    arguments: {
      female: '孕母',
      provider: '未注册卵源',
      race: '[不死-僵尸]虫族',
      fathers: '父源',
      fatherRace: '[魔女]虫族',
    },
  });

  const preferredFetus = preferred.characters['孕母'].profile.pregnant.fetuses[0];
  assert.equal(preferredFetus.race, '虫族');
  assert.equal(preferredFetus.fatherDerivedType, '魔女', 'fatherRace 的 derivedType 应优先');
  assert.equal(preferredFetus.affinity, 30, '孕母与父系同类时应使用同源种子');
  assert.equal(preferredFetus.maternalDerivedTypeProgress, 30);

  const fallback = state.createEmptyChatState();
  fallback.characters['孕母'] = makeHost('孕母', '人类');
  fallback.characters['孕母'].profile.base.derivedType = '魔女';
  applyToolCall(fallback, {
    name: 'bsImplantEmbryo',
    arguments: {
      female: '孕母',
      provider: '未注册卵源',
      race: '[不死-僵尸]虫族',
      fathers: '普通父源',
      fatherRace: '虫族',
    },
  });

  const fallbackFetus = fallback.characters['孕母'].profile.pregnant.fetuses[0];
  assert.equal(fallbackFetus.fatherDerivedType, '不死-僵尸', 'fatherRace 未带 derivedType 时应退回卵源 race');
  assert.equal(fallbackFetus.affinity, -30, '孕母与外部父系异类时应使用对立种子');
  assert.equal(fallbackFetus.maternalDerivedTypeProgress, -30);
});

test('bsAddSperm reads paternal derivedType from the race descriptor, not the male name', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['孕母'] = makeHost('孕母', '人类');
  chatState.characters['同名父亲'] = makeHost('同名父亲', '人类');
  chatState.characters['同名父亲'].profile.base.derivedType = '不死-僵尸';

  applyToolCall(chatState, {
    name: 'bsAddSperm',
    arguments: { female: '孕母', male: '同名父亲', race: '[魔女]人类X精灵', amount: 100, ejaculatedInside: true, protected: false },
  });

  const sperm = chatState.characters['孕母'].profile.base.sperms[0];
  assert.equal(sperm.race, '人类X精灵');
  assert.equal(sperm.derivedType, '魔女');
});

test('same-race parents do not produce a self-hybrid race', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['代孕者'] = makeHost('代孕者', '人类');
  chatState.characters['委托母亲'] = makeHost('委托母亲', '人类');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '代孕者', provider: '委托母亲', fathers: '委托父亲' },
  });

  // deriveFetusRace 少了去重时，同族生育会得到「人类x人类」
  assert.equal(chatState.characters['代孕者'].profile.pregnant.fetuses[0].race, '人类');
});

test('a cross-species father still hybridises with the genetic mother', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['宿主'] = makeHost('宿主', '人类');
  chatState.characters['虫母'] = makeHost('虫母', '虫族');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '宿主', provider: '虫母', fathers: '精灵战士', fatherRace: '精灵' },
  });

  const race = String(chatState.characters['宿主'].profile.pregnant.fetuses[0].race);
  assert.match(race, /虫族/);
  assert.match(race, /精灵/);
  assert.doesNotMatch(race, /人类/, '承载者的种族不该混进血统');
});

test('an unregistered provider can still supply the race explicitly', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['宿主'] = makeHost('宿主', '人类');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '宿主', provider: '深渊母巢', race: '虫族', count: 3 },
  });

  const fetuses = chatState.characters['宿主'].profile.pregnant.fetuses;
  assert.equal(fetuses.length, 3);
  assert.match(String(fetuses[0].race), /虫族/);
  assert.equal(fetuses[0].provider, '深渊母巢');
});

test('implanting is refused when the carrier is already pregnant', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = makeCharacter('艾拉', [makeFetus()]);
  chatState.characters['委托母亲'] = makeHost('委托母亲');

  const result = applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '艾拉', provider: '委托母亲' },
  });

  assert.equal(result.applied, false);
  assert.match(result.message, /already completed/);
});

test('implanting is refused when the provider is the carrier herself', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['艾拉'] = makeHost('艾拉');

  const result = applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '艾拉', provider: '艾拉' },
  });

  assert.equal(result.applied, false);
  assert.match(result.message, /must differ/);
});

test('an implanted pregnancy carried to term hands the children back', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['代孕者'] = makeHost('代孕者');
  chatState.characters['委托母亲'] = makeHost('委托母亲');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '代孕者', provider: '委托母亲', fathers: '委托父亲', count: 2 },
  });
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 7 } });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(chatState.characters['代孕者'].profile.base.stage, '孕早期');
  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '代孕者' } });

  // 端到端：移入受精卵 → 共用窗口着床 → 分娩 → 孩子回到委托方
  assert.equal(childrenOf(chatState, '代孕者').length, 0);
  assert.equal(childrenOf(chatState, '委托母亲').length, 2);
});

test('later embryo transfers join the existing fertilizationDays window without resetting it', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['孕母'] = makeHost('孕母');
  chatState.characters['母A'] = makeHost('母A');
  chatState.characters['母B'] = makeHost('母B');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '孕母', provider: '母A', fathers: '父A' },
  });
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  assert.equal(chatState.characters['孕母'].profile.base.fertilizationDays, 1);

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '孕母', provider: '母B', fathers: '父B' },
  });
  const profile = chatState.characters['孕母'].profile;
  assert.equal(profile.base.fertilizationDays, 1, '后加入的胚胎不可重置第一颗启动的时钟');
  assert.equal(profile.pregnant.fetuses.length, 2);
});

test('chimera probability applies derived and embryo-system modifiers', () => {
  const baseA = { race: '人类', embryoType: '胎生' };
  const baseB = { race: '人类', embryoType: '胎生' };
  const ordinary = calculateChimeraFusionProbability(baseA, baseB);
  const oneDerived = calculateChimeraFusionProbability({ ...baseA, fatherDerivedType: '魔女' }, baseB);
  const sameDerived = calculateChimeraFusionProbability(
    { ...baseA, fatherDerivedType: '魔女' },
    { ...baseB, fatherDerivedType: '魔女' },
  );
  const incompatible = calculateChimeraFusionProbability(
    { ...baseA, fatherDerivedType: '魔女' },
    { ...baseB, fatherDerivedType: '不死' },
  );
  const differentSystem = calculateChimeraFusionProbability(baseA, { ...baseB, embryoType: '卵生' });

  assert.equal(oneDerived, ordinary * 0.5);
  assert.equal(sameDerived, ordinary * 1.5);
  assert.equal(incompatible, 0);
  assert.equal(differentSystem, ordinary * 0.25);
});

test('two early embryos can fuse across races and keep dual parents under the carrier', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['孕母'] = makeHost('孕母');
  chatState.characters['母A'] = makeHost('母A', '獸耳族-兔');
  chatState.characters['母B'] = makeHost('母B', '精靈-木');

  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '孕母', provider: '母A', fathers: '父A', race: '獸耳族-兔' },
  });
  applyToolCall(chatState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '孕母', provider: '母B', fathers: '父B', race: '精靈-木' },
  });
  const before = chatState.characters['孕母'].profile.pregnant.fetuses;
  before[0].gender = '男';
  before[1].gender = '女';

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  } finally {
    Math.random = originalRandom;
  }

  const profile = chatState.characters['孕母'].profile;
  assert.equal(profile.pregnant.fetuses.length, 1);
  const chimera = profile.pregnant.fetuses[0];
  assert.equal(chimera.gender, '待定');
  assert.equal(chimera.fathers, '父A × 父B');
  assert.deepEqual(chimera.providerSources, ['母A', '母B']);
  assert.match(chimera.race, /獸耳族-兔/);
  assert.match(chimera.race, /精靈-木/);
  assert.equal(chimera.chimera.sourceCount, 2);

  Math.random = () => 0.99;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 5 } });
  } finally {
    Math.random = originalRandom;
  }
  const implanted = chatState.characters['孕母'].profile;
  assert.equal(implanted.base.stage, '孕早期');
  assert.equal(implanted.pregnant.fetuses[0].gender, '双', '异性嵌合体按 40/40/20 在着床时解析');

  applyToolCall(chatState, { name: 'bsChildbirth', arguments: { female: '孕母' } });
  assert.equal(childrenOf(chatState, '孕母').length, 1, '多母源孩子默认登记在孕母名下');
  assert.equal(childrenOf(chatState, '母A').length, 0);
  assert.equal(childrenOf(chatState, '母B').length, 0);
  assert.deepEqual(childrenOf(chatState, '孕母')[0].providerSources, ['母A', '母B']);
});

test('a failed fusion pair is checked only once', () => {
  const chatState = state.createEmptyChatState();
  chatState.characters['孕母'] = makeHost('孕母');
  applyToolCall(chatState, {
    name: 'bsImplantEmbryo', arguments: { female: '孕母', provider: '母A', fathers: '父A' },
  });
  applyToolCall(chatState, {
    name: 'bsImplantEmbryo', arguments: { female: '孕母', provider: '母B', fathers: '父B' },
  });

  const originalRandom = Math.random;
  Math.random = () => 0.999;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 2 } });
  } finally {
    Math.random = originalRandom;
  }
  const fetuses = chatState.characters['孕母'].profile.pregnant.fetuses;
  assert.equal(fetuses.length, 2);
  assert.deepEqual(fetuses[0].fusionCheckedWith, [fetuses[1].embryoId]);

  Math.random = () => 0;
  try {
    applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 1 } });
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(chatState.characters['孕母'].profile.pregnant.fetuses.length, 2, '同一对不可在下一天重抽');
});
test('the rupture tool is hidden until someone can actually rupture', async () => {
  const { getTrackerToolDefinitions } = await import('../scripts/tracker.js');
  const settings = { diaryRecentLimit: 0 };
  const names = (existing) => getTrackerToolDefinitions(settings, existing).map((tool) => tool.name);

  // 平时挂着只是占用模型注意力，且执行层本来就会拒绝
  assert.equal(names({ 艾拉: { profile: { base: { stage: '卵泡期' } } } }).includes('bsRuptureMembranes'), false);
  assert.equal(names({ 艾拉: { profile: { base: { stage: '孕晚期' } } } }).includes('bsRuptureMembranes'), false);

  for (const stage of ['产兆前驱', '第一产程', '第二产程']) {
    assert.equal(
      names({ 艾拉: { profile: { base: { stage } } } }).includes('bsRuptureMembranes'),
      true,
      `${stage} 应提供破水工具`,
    );
  }
});

test('only surrogate children are offered for manual reassignment', async () => {
  const { readFile } = await import('node:fs/promises');
  const controller = await readFile(new URL('../index.js', import.meta.url), 'utf8');

  // 自然生育的归属是既成事实，不该出现在搬移清单里
  const filter = controller.match(/function getMovableChildEntries\(character\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(filter, /String\(entry\.child\?\.provider \|\| ''\)\.trim\(\)\.length > 0/);

  // 执行层也要挡，不能只靠 UI 过滤
  const move = controller.match(/function moveChildRecord\(ctx, fromName, childIndex, toName\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(move, /只有代孕、寄生或多母源嵌合所生的孩子可以搬移/);
  assert.match(move, /providers\.includes\(toName\)/);
  assert.match(move, /只能搬给 provider 指定的归属方/);

  // childSource 用 { motherName, childIndex } 定位，搬移后必须同步修正
  assert.match(move, /source\.motherName = toName/);
  assert.match(move, /source\.childIndex = index - 1/);
});
