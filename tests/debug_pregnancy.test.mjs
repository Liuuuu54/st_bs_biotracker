import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';

const REAL_RANDOM = Math.random;
afterEach(() => { Math.random = REAL_RANDOM; });

function makeCharacter(name, stage = '卵泡期') {
  return {
    name,
    initialized: true,
    profile: {
      base: {
        stage,
        days: 0,
        isHere: true,
        age: 24,
        race: '人类',
        vitality: 100,
        libido: 20,
        uterinePressure: 10,
        psyStress: 30,
        vitalityLevel: 4,
        psyStressLevel: 4,
        eggs: 0,
        sperms: [],
        fertilizationDays: 0,
        latestSexDays: -1,
      },
      bio: { gestationSpeciesSpeed: 1, gestationEffectiveSpeed: 1, birthDifficulty: 1, breedTolerance: 1 },
      pregnant: { pregnantDays: 0, effectivePregnantDays: 0, fetuses: [], fetusesCount: 0 },
      experience: {},
      immune: {},
      metabolism: {},
      skills: [],
      talents: [],
      children: [],
      notify: {},
    },
  };
}

function setup(stage = '卵泡期') {
  const chatState = state.createEmptyChatState();
  chatState.characters.A = makeCharacter('A', stage);
  return chatState;
}

function inject(chatState, args) {
  return applyToolCall(chatState, {
    name: 'bsDebugInjectPregnancy',
    arguments: { female: 'A', father: '父', race: '人类', fetusCount: 1, genders: '女', ...args },
  });
}

const profileOf = (chatState) => chatState.characters.A.profile;

test('一般受孕可强制让每颗基础胚胎分裂为同卵双胎', () => {
  const chatState = setup();
  const result = inject(chatState, { mode: 'normal', equivalentDays: 20, forceIdentical: true });
  assert.equal(result.applied, true, result.message);
  const profile = profileOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(profile.pregnant.fetuses.length, 2);
  assert.deepEqual(profile.pregnant.fetuses.map((fetus) => fetus.identicalGroup), [1, 1]);
  assert.ok(profile.pregnant.fetuses.every((fetus) => fetus.tags.includes('identical')));
});

test('代孕／托卵保存卵源归属与卵源种族', () => {
  const chatState = setup();
  const result = inject(chatState, {
    mode: 'surrogacy', provider: '卵源', providerRace: '精灵', equivalentDays: 30,
  });
  assert.equal(result.applied, true, result.message);
  const fetus = profileOf(chatState).pregnant.fetuses[0];
  assert.equal(fetus.provider, '卵源');
  assert.deepEqual(fetus.providerSources, ['卵源']);
  assert.match(fetus.race, /精灵/);
});

test('强制嵌合融合前两颗胚胎并完整保留双方来源', () => {
  const chatState = setup();
  const result = inject(chatState, {
    mode: 'normal',
    father: '甲,乙',
    race: '人类,精灵',
    fetusCount: 2,
    genders: '男,女',
    equivalentDays: 20,
    forceChimera: true,
  });
  assert.equal(result.applied, true, result.message);
  const fetuses = profileOf(chatState).pregnant.fetuses;
  assert.equal(fetuses.length, 1, '两颗来源胚胎应融合成一颗');
  const chimera = fetuses[0];
  assert.equal(chimera.chimera.sourceCount, 2);
  assert.deepEqual(chimera.chimera.fatherSources, ['甲', '乙']);
  assert.deepEqual(chimera.chimera.maternalSources, ['A']);
  assert.deepEqual(chimera.chimera.genderSources, ['男', '女']);
  assert.match(chimera.race, /精灵/);
});

test('嵌合与同卵同时强制时先融合再分裂，双胎共享嵌合来源与性别', () => {
  const chatState = setup();
  const result = inject(chatState, {
    mode: 'surrogacy',
    provider: '卵源甲',
    providerRace: '精灵',
    secondaryProvider: '卵源乙',
    secondaryProviderRace: '兽人',
    father: '甲,乙',
    race: '人类,龙族',
    fetusCount: 2,
    genders: '男,女',
    equivalentDays: 20,
    forceChimera: true,
    forceIdentical: true,
  });
  assert.equal(result.applied, true, result.message);
  const fetuses = profileOf(chatState).pregnant.fetuses;
  assert.equal(fetuses.length, 2);
  assert.ok(fetuses.every((fetus) => fetus.chimera?.sourceCount === 2));
  assert.ok(fetuses.every((fetus) => fetus.provider === '卵源甲 × 卵源乙'));
  assert.ok(fetuses.every((fetus) => fetus.chimera.maternalSources.join(',') === '卵源甲,卵源乙'));
  assert.ok(fetuses.every((fetus) => fetus.chimera.fatherSources.join(',') === '甲,乙'));
  assert.equal(fetuses[0].identicalGroup, fetuses[1].identicalGroup);
  assert.equal(fetuses[0].gender, fetuses[1].gender, '同卵嵌合胎不能解析出不同性别');
});

test('强制嵌合要求一般或代孕模式至少提供两颗基础胚胎', () => {
  const chatState = setup();
  const tooFew = inject(chatState, { mode: 'normal', fetusCount: 1, forceChimera: true });
  assert.equal(tooFew.applied, false);
  assert.equal(profileOf(chatState).pregnant.fetuses.length, 0);

  const unsupported = inject(chatState, { mode: 'womb_return', returner: 'B', fetusCount: 2, forceChimera: true });
  assert.equal(unsupported.applied, false);
  assert.equal(profileOf(chatState).pregnant.fetuses.length, 0);
});

test('胎内回归调试跳过回归期且忽略旧版强制同卵参数', () => {
  const chatState = setup();
  chatState.characters.B = makeCharacter('B');
  const result = inject(chatState, {
    mode: 'womb_return', returner: 'B', returnerRace: '龙族', forceIdentical: true,
  });
  assert.equal(result.applied, true, result.message);
  const profile = profileOf(chatState);
  assert.equal(profile.base.stage, '孕早期');
  assert.equal(profile.base.days, 1);
  assert.equal(profile.pregnant.wombReturn, undefined);
  assert.equal(profile.pregnant.fetuses.length, 1);
  assert.ok(profile.pregnant.fetuses[0].tags.includes('rebirth'));
  assert.equal(profile.pregnant.fetuses[0].tags.includes('identical'), false);
  assert.equal(chatState.characters.B.profile.base.wombReturnHost, 'A');
});

test('异期受孕只在孕早期追加并保留原胎', () => {
  const rejected = setup('孕中期');
  assert.equal(inject(rejected, { mode: 'superfetation' }).applied, false);

  const chatState = setup('孕早期');
  const profile = profileOf(chatState);
  profile.pregnant = {
    pregnantDays: 25,
    effectivePregnantDays: 25,
    fetusesCount: 1,
    fetuses: [{ embryoId: 1, fusionCheckedWith: [], tags: [], fathers: '原父', race: '人类', fatherRace: '人类', gender: '女', embryoType: '胎生', weight: 1 }],
  };
  const result = inject(chatState, { mode: 'superfetation', forceIdentical: true });
  assert.equal(result.applied, true, result.message);
  const updated = profileOf(chatState);
  assert.equal(updated.pregnant.fetuses.length, 3);
  assert.equal(updated.pregnant.fetuses[0].fathers, '原父');
  const added = updated.pregnant.fetuses.slice(1);
  assert.ok(added.every((fetus) => fetus.pendingImplantation && fetus.tags.includes('superfetation')));
  assert.deepEqual(added.map((fetus) => fetus.conceivedAtDays), [25, 25]);

  Math.random = () => 0;
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: 7 } });
  assert.equal(profileOf(chatState).pregnant.fetuses.length, 3, '强制同卵组着床时不可再次随机分裂');
});

test('孕中孕必须选择已着床宿主，并写入宿主胚胎 id', () => {
  const chatState = setup('孕早期');
  const profile = profileOf(chatState);
  profile.pregnant = {
    pregnantDays: 25,
    effectivePregnantDays: 25,
    fetusesCount: 2,
    fetuses: [
      { embryoId: 4, fusionCheckedWith: [], tags: [], fathers: '原父', race: '人类', fatherRace: '人类', gender: '女', embryoType: '胎生', weight: 1 },
      { embryoId: 5, fusionCheckedWith: [], tags: ['superfetation'], fathers: '晚父', race: '人类', fatherRace: '人类', gender: '男', embryoType: '胎生', weight: 0.8, pendingImplantation: true },
    ],
  };
  assert.equal(inject(chatState, { mode: 'nested', hostFetusIndex: 1 }).applied, false, '等待着床胎不能作为宿主');
  const result = inject(chatState, { mode: 'nested', hostFetusIndex: 0 });
  assert.equal(result.applied, true, result.message);
  const nested = profileOf(chatState).pregnant.fetuses.at(-1);
  assert.equal(nested.nestedInEmbryoId, 4);
  assert.equal(nested.pendingImplantation, true);
  assert.ok(nested.tags.includes('superfetation'));
  assert.ok(nested.tags.includes('nested'));
});
