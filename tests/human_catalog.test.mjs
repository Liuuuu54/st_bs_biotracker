// 人类回归普通物种：可勾选、可覆写；人类生理块只在勾选人类时才送；1.1.3 以前的名录勾选按旧语义补回人类。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_BUILTIN_RACES,
  getRaceIntroductionLine,
  normalizeRaceCatalogSelection,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';
import { buildRacePhysiologyPrompt, buildRegistryRacePhysiologyPrompt } from '../scripts/race_prompt_context.js';
import { sanitizeCardSettings } from '../scripts/card_settings.js';

const payloadWith = (race, selection) => ({
  existing_state: { 阿明: { profile: { base: { race } } } },
  race_catalog_selection: selection,
});

test('物种总数包含人类，人类有内建短敘述', () => {
  assert.equal(ALL_BUILTIN_RACES.length, 81);
  assert.ok(ALL_BUILTIN_RACES.includes('人类'));
  assert.match(getRaceIntroductionLine('人类'), /^Human，其余物种的参照/);
});

test('旧版名录勾选：有勾选项目的补回人类，全部清空的维持不送', () => {
  assert.deepEqual(
    normalizeRaceCatalogSelection({ races: ['精灵'], derivedTypes: [] }),
    { version: 2, races: ['人类', '精灵'], derivedTypes: [] },
  );
  assert.deepEqual(
    normalizeRaceCatalogSelection({ races: [], derivedTypes: ['血族'] }).races,
    ['人类'],
    '只勾衍生类型也是奇幻设定',
  );
  assert.deepEqual(
    normalizeRaceCatalogSelection({ races: [], derivedTypes: [] }),
    { version: 2, races: [], derivedTypes: [] },
    '旧「现代写实」不补人类',
  );
  assert.deepEqual(
    normalizeRaceCatalogSelection({ version: 2, races: ['精灵'], derivedTypes: [] }).races,
    ['精灵'],
    'v2 取消勾选人类就是不要人类',
  );
  assert.equal(normalizeRaceCatalogSelection(null), null);
});

test('卡片设定保留名录版本，旧卡片维持无版本以便补回人类', () => {
  const current = sanitizeCardSettings({ version: 1, raceCatalogSelection: { version: 2, races: ['精灵'], derivedTypes: [] } });
  assert.equal(current.raceCatalogSelection.version, 2);
  const legacy = sanitizeCardSettings({ version: 1, raceCatalogSelection: { races: ['精灵'], derivedTypes: [] } });
  assert.equal('version' in legacy.raceCatalogSelection, false);
});

test('人类生理块只在名录勾选人类时送出，其他物种照常', () => {
  assert.match(buildRacePhysiologyPrompt(payloadWith('人类', null)), /【人类】/, '没有勾选设定时全部启用');
  assert.match(buildRacePhysiologyPrompt(payloadWith('人类', { version: 2, races: ['人类'], derivedTypes: [] })), /【人类】/);
  assert.equal(buildRacePhysiologyPrompt(payloadWith('人类', { version: 2, races: [], derivedTypes: [] })), '', '现代写实不送人类');

  const hybrid = buildRacePhysiologyPrompt(payloadWith('精灵x人类', { version: 2, races: ['精灵'], derivedTypes: [] }));
  assert.match(hybrid, /【精灵】/);
  assert.equal(hybrid.includes('【人类】'), false, '混血里的人类成分也不单独送');
  assert.match(hybrid, /【混血加权参考】/, '混血加权仍照算');

  const elfOnly = buildRacePhysiologyPrompt(payloadWith('精灵', { version: 2, races: [], derivedTypes: [] }));
  assert.match(elfOnly, /【精灵】/, '名录没勾的其他物种仍送生理块');

  const registry = buildRegistryRacePhysiologyPrompt({ declared_race: '人类' }, { selection: { version: 2, races: [], derivedTypes: [] } });
  assert.equal(registry, '');
  assert.match(buildRegistryRacePhysiologyPrompt({ declared_race: '人类' }), /【人类】/);
});

test('人类可以覆写参数与短敘述，覆写只影响人类本身', () => {
  setRacePhysiologyOverrides({ 人类: { breedTolerance: 2, introductionLine: '本世界的人类孕期负担较轻。' } });
  try {
    const prompt = buildRacePhysiologyPrompt(payloadWith('人类', null));
    assert.match(prompt, /本世界的人类孕期负担较轻/);
    assert.match(prompt, /数值 2；/);
    // 其他物种的说明仍以人类预设值为比较基准
    assert.match(buildRacePhysiologyPrompt(payloadWith('精灵', null)), /经期长度: 84天左右/);
  } finally {
    setRacePhysiologyOverrides({});
  }
});
