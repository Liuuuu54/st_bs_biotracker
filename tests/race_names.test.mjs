// 1.1.4 种族改名与繁简别名：旧名、繁体、简体与混写都对到同一个内置种族；旧存档一次改写成新名。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import {
  ALL_BUILTIN_RACES,
  DERIVED_TYPE_RACES,
  RACE_RENAMES,
  canonicalizeRaceDescriptor,
  canonicalizeRaceName,
  getBaseDerivedTypeName,
  getBloodlineInfo,
  getRacePhysiologyProfile,
  normalizeRaceCatalogSelection,
  parseRaceDescriptor,
} from '../scripts/race_config.js';
import { toSimplifiedName, toTraditionalName } from '../scripts/race_names.js';

test('每个内置种族与衍生类型的繁体、简体写法都对到规范名', () => {
  for (const race of ALL_BUILTIN_RACES) {
    assert.equal(canonicalizeRaceName(race), race);
    assert.equal(canonicalizeRaceName(toTraditionalName(race)), race, `${race} 的繁体写法`);
    assert.equal(canonicalizeRaceName(toSimplifiedName(race)), race, `${race} 的简体写法`);
    assert.ok(getRacePhysiologyProfile(toTraditionalName(race)), `${race} 繁体写法应查得到参数`);
  }
  for (const type of DERIVED_TYPE_RACES) {
    assert.equal(getBaseDerivedTypeName(toTraditionalName(type)), type, `${type} 的繁体写法`);
    assert.equal(getBaseDerivedTypeName(toSimplifiedName(type)), type, `${type} 的简体写法`);
  }
  assert.equal(canonicalizeRaceName('星茧族'), '星繭族', '混写也认得');
});

test('旧名对到新名，保留装饰子项、衍生前缀与比例写法', () => {
  assert.equal(Object.keys(RACE_RENAMES).length, 10);
  for (const [from, to] of Object.entries(RACE_RENAMES)) {
    assert.equal(canonicalizeRaceName(from), to);
    assert.equal(canonicalizeRaceName(toTraditionalName(from)), to, `${from} 的繁体旧名`);
    assert.ok(ALL_BUILTIN_RACES.includes(to));
    assert.equal(ALL_BUILTIN_RACES.includes(from), false);
  }
  assert.equal(canonicalizeRaceDescriptor('[吸血鬼-真祖]百足姬-赤x1/4蠍羅'), '[吸血鬼-真祖]百足氏-赤x1/4蝎罗氏');
  assert.equal(canonicalizeRaceDescriptor('[魔導]月兔族25%x狮鹫族75%'), '[魔导]月兔25%x狮鹫75%');
  assert.equal(canonicalizeRaceDescriptor('自订族x鳥人'), '自订族x鸟族', '自订种族原样保留');
  assert.deepEqual(parseRaceDescriptor('精灵25%x月兔族75%'), { race: '精灵x月兔', derivedType: null, bloodline: { 精灵: 0.25, 月兔: 0.75 } });
});

test('旧名的血统比例不会被丢弃成均分', () => {
  assert.deepEqual(getBloodlineInfo('月兔族x人类', { 月兔族: 0.25, 人类: 0.75 }), {
    bloodline: { 月兔: 0.25, 人类: 0.75 },
    bloodlineSource: 'explicit',
  });
});

test('名录勾选的旧名与繁体写法一并收敛', () => {
  assert.deepEqual(
    normalizeRaceCatalogSelection({ version: 2, races: ['百足姬', '蛙人', '貓又', '猫又'], derivedTypes: ['咒縛', '咒缚'] }),
    { version: 2, races: ['百足氏', '蛙族', '貓又'], derivedTypes: ['咒缚'] },
  );
});

test('v6 存档迁移：角色、精液、胎儿、孩子与快照里的旧名都改写成新名', () => {
  const ctx = { chatId: 'rename-v7', chat: [], extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('兔娘');
  character.initialized = true;
  character.profile.base.race = '月兔族x人类';
  character.profile.base.bloodline = { 月兔族: 0.5, 人类: 0.5 };
  character.profile.base.sperms = [{ male: '蛙', race: '蛙人', bloodline: { 蛙人: 1 }, value: 10 }];
  character.profile.pregnant.fetuses = [{ embryoId: 1, race: '月兔族x蛙人', fatherRace: '[魔導]蛙人', bloodline: { 月兔族: 0.25, 人类: 0.25, 蛙人: 0.5 }, fatherBloodline: { 蛙人: 1 } }];
  character.profile.children = [{ name: '小鳥', race: '鳥人-鹰', fathers: '鳥人', bloodline: { '鳥人-鹰': 1 } }];
  chatState.characters['兔娘'] = character;
  chatState.schemaVersion = 6;
  state.recordChatStateSnapshot(ctx, chatState, { reason: 'legacy' });
  settings.chatStates['rename-v7'] = chatState;

  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 7);
  const profile = migrated.characters['兔娘'].profile;
  assert.equal(profile.base.race, '月兔x人类');
  assert.deepEqual(profile.base.bloodline, { 月兔: 0.5, 人类: 0.5 });
  assert.equal(profile.base.sperms[0].race, '蛙族');
  assert.deepEqual(profile.base.sperms[0].bloodline, { 蛙族: 1 });
  assert.equal(profile.pregnant.fetuses[0].race, '月兔x蛙族');
  assert.equal(profile.pregnant.fetuses[0].fatherRace, '[魔导]蛙族');
  assert.deepEqual(profile.pregnant.fetuses[0].fatherBloodline, { 蛙族: 1 });
  assert.equal(profile.children[0].race, '鸟族-鹰');
  assert.equal(profile.children[0].fathers, '鳥人', '人名不动，只改种族栏位');

  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.equal(migrated.characters['兔娘'].profile.base.race, '月兔x人类', '回溯快照也已改名');
});
