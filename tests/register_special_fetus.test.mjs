// 注册页勾选的特殊胎儿来历：只需要名字的硬套，需要胎儿结构的转成提示词。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRequestedSpecialFetus, buildSpecialFetusNotes } from '../scripts/registry.js';

const withFetus = (over = {}) => ({
  profile: { pregnant: { fetuses: [{ fathers: '甲', race: '人类', ...over }] } },
});

test('没勾任何一项时不追加提示词', () => {
  assert.equal(buildSpecialFetusNotes(null), '');
  assert.equal(buildSpecialFetusNotes({ rebirth: '', surrogacy: '', hints: [] }), '');
});

test('名字与勾选都会转成给模型的指示', () => {
  const notes = buildSpecialFetusNotes({ rebirth: '小明', surrogacy: 'B', hints: ['chimera', 'nested'] });
  assert.match(notes, /小明/);
  assert.match(notes, /provider 写成「B」/);
  assert.match(notes, /嵌合体/);
  assert.match(notes, /nestedInIndex/);
});

test('未知的勾选被忽略', () => {
  assert.equal(buildSpecialFetusNotes({ hints: ['nope'] }), '');
});

test('胎内回归硬套 fathers 与标签', () => {
  const result = withFetus();
  assert.equal(applyRequestedSpecialFetus(result, { rebirth: '小明' }), true);
  const fetus = result.profile.pregnant.fetuses[0];
  assert.equal(fetus.fathers, '小明');
  assert.deepEqual(fetus.tags, ['rebirth']);
});

test('代孕硬套 provider，不动其它栏位', () => {
  const result = withFetus({ provider: null });
  applyRequestedSpecialFetus(result, { surrogacy: 'B' });
  assert.equal(result.profile.pregnant.fetuses[0].provider, 'B');
  assert.equal(result.profile.pregnant.fetuses[0].fathers, '甲');
});

test('只勾提示类的项目不会硬套任何东西', () => {
  const result = withFetus();
  assert.equal(applyRequestedSpecialFetus(result, { hints: ['chimera'] }), false);
  assert.equal(result.profile.pregnant.fetuses[0].tags, undefined);
});

test('模型没产出妊娠时不硬塞胎儿', () => {
  const empty = { profile: {} };
  assert.equal(applyRequestedSpecialFetus(empty, { rebirth: '小明' }), false);
  assert.equal(empty.profile.pregnant, undefined);
  const noFetus = { profile: { pregnant: { fetuses: [] } } };
  assert.equal(applyRequestedSpecialFetus(noFetus, { rebirth: '小明' }), false);
  assert.equal(noFetus.profile.pregnant.fetuses.length, 0);
});
