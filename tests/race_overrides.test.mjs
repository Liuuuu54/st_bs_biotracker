// 覆写清除回归：旧键能被正规化、任何一笔覆写都删得掉（含名录外的人类）。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getRacePhysiologyOverride,
  normalizeDerivedOverrideMap,
  normalizeRaceOverrideMap,
  removeDerivedOverrideEntry,
  removeRaceOverrideEntry,
  setRacePhysiologyOverrides,
} from '../scripts/race_config.js';

test('覆写键正规化成基名，旧键合并后不丢栏位', () => {
  const normalized = normalizeRaceOverrideMap({
    ' 人类 ': { gestationSpeciesSpeed: 2 },
    '人类-实验体': { birthDifficulty: 3 },
    '兽耳族-兔': { companionEggsMean: 4 },
    '': { companionEggsMean: 9 },
    史莱姆: null,
  });
  assert.deepEqual(Object.keys(normalized).sort(), ['人类', '兽耳族']);
  assert.deepEqual(normalized['人类'], { gestationSpeciesSpeed: 2, birthDifficulty: 3 });
  assert.deepEqual(normalized['兽耳族'], { companionEggsMean: 4 });
});

test('衍生覆写键同样收敛到基名与别名', () => {
  const normalized = normalizeDerivedOverrideMap({ 修行: { inheritanceSpeed: 2 }, '血族-初拥': { inheritanceSpeed: 3 } });
  assert.deepEqual(Object.keys(normalized).sort(), ['修炼', '血族']);
});

test('清除一笔覆写会连同所有同基名的旧键一起删掉', () => {
  const overrides = {
    '人类': { gestationSpeciesSpeed: 2 },
    '人类-实验体': { birthDifficulty: 3 },
    '兽耳族': { companionEggsMean: 4 },
  };
  assert.deepEqual(removeRaceOverrideEntry(overrides, '人类'), { '兽耳族': { companionEggsMean: 4 } });
  assert.deepEqual(removeRaceOverrideEntry(overrides, ''), overrides, '空名不应误删');
  assert.deepEqual(removeDerivedOverrideEntry({ 修炼: { inheritanceSpeed: 2 } }, '修行'), {});
});

test('清掉覆写后人类回到内建参数', () => {
  setRacePhysiologyOverrides({ '人类-实验体': { gestationSpeciesSpeed: 5 } });
  assert.equal(getRacePhysiologyOverride('人类')?.gestationSpeciesSpeed, 5, '旧键覆写本来就照样生效');
  setRacePhysiologyOverrides(removeRaceOverrideEntry({ '人类-实验体': { gestationSpeciesSpeed: 5 } }, '人类'));
  assert.equal(getRacePhysiologyOverride('人类'), null);
});

test('百科页有覆写清单与清除入口', async () => {
  const root = new URL('../', import.meta.url);
  const [html, controller] = await Promise.all([
    readFile(new URL('settings.html', root), 'utf8'),
    readFile(new URL('index.js', root), 'utf8'),
  ]);
  assert.match(html, /id="bs-bt-override-inventory"/);
  assert.match(html, /id="bs-bt-override-list"/);
  assert.match(html, /id="bs-bt-override-clear-all"/);
  assert.match(controller, /getElementById\('bs-bt-override-list'\)\?\.addEventListener/);
  assert.match(controller, /getElementById\('bs-bt-override-clear-all'\)\?\.addEventListener/);
  assert.match(controller, /function clearAllOverrideEntries/);
});
