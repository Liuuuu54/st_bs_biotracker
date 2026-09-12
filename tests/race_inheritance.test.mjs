import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import {
  ALL_BUILTIN_RACES,
  RACE_INHERITANCE_MODES,
  deriveFetusRace,
  getEmbryoTypeByRace,
  getRaceInheritanceMode,
  getRacePhysiologyProfile,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';

function makeHost(name, race) {
  return {
    name,
    initialized: true,
    profile: {
      base: { stage: '卵泡期', days: 0, race, vitality: 100 },
      pregnant: { fetuses: [], fetusesCount: 0 },
      bio: {}, immune: {}, metabolism: {}, children: [], notify: {},
    },
  };
}

test('内建名录为人类加 72 个异种，新增种族进入正确胚胎分组', () => {
  assert.equal(ALL_BUILTIN_RACES.length, 73);
  assert.equal(ALL_BUILTIN_RACES.filter((race) => race !== '人类').length, 72);
  const expected = {
    怪兽类: '胎生',
    怪鸟类: '卵生',
    怪鱼类: '卵胎生',
    星繭族: '胎转卵生',
    夢魔: '不定型',
    西方龙: '胎转卵生',
    东方龙: '胎转卵生',
  };
  for (const [race, embryoType] of Object.entries(expected)) {
    assert.ok(getRacePhysiologyProfile(race), `${race} 应有完整生理参数`);
    assert.equal(getEmbryoTypeByRace(race), embryoType);
  }
  const beast = getRacePhysiologyProfile('怪兽类');
  const bird = getRacePhysiologyProfile('怪鸟类');
  const fish = getRacePhysiologyProfile('怪鱼类');
  const cocoon = getRacePhysiologyProfile('星繭族');
  assert.deepEqual(
    [beast.gestationSpeciesSpeed, beast.orgasmOvulationAmount, beast.identicalProbability],
    [2, 3, 1],
    '怪兽类应采用现实哺乳动物的折衷值',
  );
  assert.deepEqual(
    [bird.gestationSpeciesSpeed, bird.orgasmOvulationAmount, bird.identicalProbability],
    [20, 3, 1],
    '怪鸟类应短孕并以多卵表现窝产',
  );
  assert.deepEqual(
    [fish.gestationSpeciesSpeed, fish.orgasmOvulationAmount, fish.identicalProbability],
    [4, 8, 0],
    '怪鱼类应多产而非沿用鱼人的长孕少产',
  );
  assert.ok(Math.abs(cocoon.gestationSpeciesSpeed - (2 / 3)) < 1e-9, '星繭族孕期应为人类的 1.5 倍');
  assert.deepEqual(
    [cocoon.birthDifficulty, cocoon.breedTolerance, cocoon.impregnationDifficulty, cocoon.orgasmOvulationAmount, cocoon.identicalProbability, cocoon.genderRatio],
    [3, 1, 0.1, 0, 0, 0],
    '星繭族应难产、低承载、异常易孕、单胎且纯雌',
  );
  const westernDragon = getRacePhysiologyProfile('西方龙');
  const easternDragon = getRacePhysiologyProfile('东方龙');
  assert.deepEqual(
    [westernDragon.impregnationDifficulty, westernDragon.orgasmOvulationAmount, westernDragon.breedTolerance],
    [2, 2, 10],
    '西方龙应较高产、易受精且高承载',
  );
  assert.deepEqual(
    [easternDragon.impregnationDifficulty, easternDragon.orgasmOvulationAmount, easternDragon.breedTolerance],
    [5, 0, 1 / 3],
    '东方龙应低产、难受精且低承载',
  );
  assert.equal(getRacePhysiologyProfile('白泽').breedTolerance, 0.4, '白泽承载耐受应提升至 0.4');
});

test('六个雄核与六个雌核种族配置完整', () => {
  const paternal = ['哥布林', '狗头人', '海马族', '怪兽类', '怪鸟类', '怪鱼类'];
  const maternal = ['媚魔', '夢魔', '心魇', '星繭族', '社会虫族', '梅杜莎'];
  for (const race of paternal) {
    assert.equal(getRaceInheritanceMode(race), RACE_INHERITANCE_MODES.PATERNAL, race);
  }
  for (const race of maternal) {
    assert.equal(getRaceInheritanceMode(race), RACE_INHERITANCE_MODES.MATERNAL, race);
  }
  assert.equal(
    ALL_BUILTIN_RACES.filter((race) => getRaceInheritanceMode(race) === RACE_INHERITANCE_MODES.PATERNAL).length,
    6,
  );
  assert.equal(
    ALL_BUILTIN_RACES.filter((race) => getRaceInheritanceMode(race) === RACE_INHERITANCE_MODES.MATERNAL).length,
    6,
  );
});

test('精方与卵方核型依完整九格矩阵决定胎儿种族', () => {
  const cases = [
    ['一般 x 一般', '人类', '精灵', '精灵x人类'],
    ['精方雄核 x 卵方一般', '人类', '哥布林', '哥布林'],
    ['精方雌核 x 卵方一般', '人类', '媚魔', '人类'],
    ['精方一般 x 卵方雄核', '哥布林', '人类', '人类'],
    ['精方一般 x 卵方雌核', '媚魔', '人类', '媚魔'],
    ['雄核 x 雄核', '狗头人', '哥布林', '哥布林x狗头人'],
    ['雄核 x 雌核', '媚魔', '哥布林', '哥布林x媚魔'],
    ['雌核 x 雄核', '哥布林', '媚魔', '媚魔x哥布林'],
    ['雌核 x 雌核', '心魇', '媚魔', '媚魔x心魇'],
  ];
  for (const [label, eggRace, spermRace, expected] of cases) {
    assert.equal(deriveFetusRace(eggRace, spermRace), expected, label);
  }
});

test('混血固定一般，装饰子项继承纯种核型，旧称不兼容', () => {
  assert.equal(getRaceInheritanceMode('哥布林x人类'), RACE_INHERITANCE_MODES.NORMAL);
  assert.equal(getRaceInheritanceMode('怪兽类-狼'), RACE_INHERITANCE_MODES.PATERNAL);
  assert.equal(getRaceInheritanceMode('[血族]怪兽类-狼'), RACE_INHERITANCE_MODES.PATERNAL);
  for (const oldName of ['龙族', '魅魔', '海龙人', '兽类-狼', '鸟类', '鱼类']) {
    assert.equal(getRaceInheritanceMode(oldName), RACE_INHERITANCE_MODES.NORMAL, oldName);
    assert.equal(getRacePhysiologyProfile(oldName), null, oldName);
  }
});

test('核型可由种族参数覆写且非法值会被忽略', () => {
  try {
    setRacePhysiologyOverrides({
      人类: { inheritanceMode: 'paternal' },
      精灵: { inheritanceMode: 'invalid' },
    });
    assert.equal(getRaceInheritanceMode('人类'), RACE_INHERITANCE_MODES.PATERNAL);
    assert.equal(getRaceInheritanceMode('精灵'), RACE_INHERITANCE_MODES.NORMAL);
  } finally {
    setRacePhysiologyOverrides({});
  }
});

test('植入胚胎按遗传卵方与精方核型计算，承载者不混入血统', () => {
  const maternalState = state.createEmptyChatState();
  maternalState.characters['人类宿主'] = makeHost('人类宿主', '人类');
  maternalState.characters['媚魔卵源'] = makeHost('媚魔卵源', '媚魔');
  applyToolCall(maternalState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '人类宿主', provider: '媚魔卵源', fathers: '人类父亲', fatherRace: '人类' },
  });
  assert.equal(maternalState.characters['人类宿主'].profile.pregnant.fetuses[0].race, '媚魔');

  const paternalState = state.createEmptyChatState();
  paternalState.characters['精灵宿主'] = makeHost('精灵宿主', '精灵');
  paternalState.characters['人类卵源'] = makeHost('人类卵源', '人类');
  applyToolCall(paternalState, {
    name: 'bsImplantEmbryo',
    arguments: { female: '精灵宿主', provider: '人类卵源', fathers: '哥布林父亲', fatherRace: '哥布林' },
  });
  assert.equal(paternalState.characters['精灵宿主'].profile.pregnant.fetuses[0].race, '哥布林');
});
