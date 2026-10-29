// 自订物种：百科新增的物种与内置物种一样进名录、查得到参数、参与遗传与图示；删除后退回名录外
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  ALL_BUILTIN_RACES,
  buildCustomRaceFromTemplate,
  canonicalizeRaceName,
  deriveFetusRace,
  getAllRaces,
  getCustomRaceIconRace,
  getRaceGroupsByEmbryoType,
  getRaceInheritanceMode,
  getRacePhysiologyProfile,
  isCustomRace,
  isRaceInCatalogSelection,
  normalizeRaceOverrideMap,
  setRacePhysiologyOverrides,
  validateCustomRaceName,
} from '../scripts/race_config.js';
import { CARD_SETTINGS_VERSION, sanitizeCardSettings } from '../scripts/card_settings.js';
import { buildRaceCatalogBlock } from '../scripts/race_prompt_context.js';
import { pickIconRace, raceIconSvg } from '../scripts/race_icons.js';

afterEach(() => setRacePhysiologyOverrides({}));

const pokemon = () => ({
  ...buildCustomRaceFromTemplate('怪鸟类'),
  introductionLine: 'Pokémon，口袋怪兽，遗传随母方种类；具体种类写作宝可梦-皮卡丘',
  embryoType: '卵生',
  inheritanceMode: 'maternal',
  iconRace: '怪兽类',
});

test('以范本建立：复制范本的全部数值，标记自订、借用范本的图示', () => {
  const definition = buildCustomRaceFromTemplate('精灵');
  assert.equal(definition.custom, true);
  assert.equal(definition.iconRace, '精灵');
  assert.equal(definition.impregnationDifficulty, getRacePhysiologyProfile('精灵').impregnationDifficulty);
  assert.equal(definition.introductionLine, '');
});

test('生效后与内置物种一样：名单、分组最后、参数、遗传、繁简', () => {
  setRacePhysiologyOverrides({ 宝可梦: pokemon() });
  assert.equal(getAllRaces().length, ALL_BUILTIN_RACES.length + 1);
  assert.ok(isCustomRace('宝可梦-皮卡丘'));
  assert.equal(getRaceGroupsByEmbryoType().find((group) => group.label === '卵生').races.at(-1), '宝可梦');
  assert.equal(getRacePhysiologyProfile('宝可梦-皮卡丘').embryoType, '卵生');
  assert.equal(getRaceInheritanceMode('宝可梦'), 'maternal');
  assert.equal(deriveFetusRace('宝可梦-皮卡丘', '人类'), '宝可梦-皮卡丘', '雌核：孩子随母方种类');
  assert.equal(canonicalizeRaceName('寶可夢-皮卡丘'), '宝可梦-皮卡丘');
  assert.equal(getCustomRaceIconRace('宝可梦'), '怪兽类');
  assert.equal(pickIconRace('宝可梦-皮卡丘'), '怪兽类', '族谱借用内置图示');
  assert.ok(raceIconSvg({ race: '宝可梦' }).includes('<polygon'));
});

test('名录与注册提示带上自订物种与短敘述', () => {
  setRacePhysiologyOverrides({ 宝可梦: pokemon() });
  const block = buildRaceCatalogBlock({ withHints: true });
  assert.match(block, /宝可梦\(Pokémon，口袋怪兽/);
  assert.equal(isRaceInCatalogSelection(null, '宝可梦'), true);
});

test('缺栏位以人类补齐；内置名、衍生名、分隔符都不能当名字', () => {
  setRacePhysiologyOverrides({ 小妖: { custom: true, embryoType: '不定型' } });
  const profile = getRacePhysiologyProfile('小妖');
  assert.equal(profile.embryoType, '不定型');
  assert.equal(profile.gestationSpeciesSpeed, 1, '人类补齐');
  assert.match(validateCustomRaceName('精靈'), /内置物种「精灵」/);
  assert.match(validateCustomRaceName('血族'), /衍生类型/);
  assert.match(validateCustomRaceName('ab-c'), /不能含/);
  assert.match(validateCustomRaceName('Lynx'), /不能含/, 'x 是混血分隔符');
  assert.match(validateCustomRaceName('一二三四五六七八九十一二三'), /最多/);
  assert.match(validateCustomRaceName('小妖'), /已有自订物种/);
  assert.equal(validateCustomRaceName('小妖', { allowExisting: true }), '');
  setRacePhysiologyOverrides({ 精灵: { custom: true } });
  assert.equal(isCustomRace('精灵'), false, '撞名的自订条目不生效，也不会盖掉内置物种');
});

test('设定档与角色卡都保留自订条目；删掉后变回名录外', () => {
  const stored = normalizeRaceOverrideMap({ 宝可梦: pokemon() });
  assert.equal(stored['宝可梦'].custom, true);
  assert.equal(sanitizeCardSettings({ version: CARD_SETTINGS_VERSION, racePhysiologyOverrides: { 宝可梦: pokemon() } }).racePhysiologyOverrides['宝可梦'].iconRace, '怪兽类');
  setRacePhysiologyOverrides(stored);
  assert.ok(getRacePhysiologyProfile('宝可梦'));
  setRacePhysiologyOverrides({});
  assert.equal(getRacePhysiologyProfile('宝可梦'), null);
  assert.equal(isCustomRace('宝可梦'), false);
  assert.equal(pickIconRace('宝可梦'), null);
});
