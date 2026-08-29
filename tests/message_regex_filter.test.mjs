import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterMessageTextByRegex, sanitizeTavernContextText } from '../scripts/state.js';

test('sanitizeTavernContextText automatically strips ST tag blocks from every context source', () => {
  const text = [
    '<roleplay_guidelines>角色扮演规则，不应送入追踪</roleplay_guidelines>',
    '<content>保留的正文<thinking>隐藏推理</thinking>继续保留</content>',
    '<!-- 调试注释 -->',
    '尾部正文',
  ].join('');

  assert.equal(sanitizeTavernContextText(text, {}), '保留的正文继续保留尾部正文');
});

test('filterMessageTextByRegex works correctly with exclude mode', () => {
  const text = 'hello <world_info>some info here</world_info> world';
  const pattern = '<world_info>[\\s\\S]*?<\\/world_info>';
  const clean = filterMessageTextByRegex(text, pattern, 'exclude');
  assert.equal(clean, 'hello  world');
});

test('filterMessageTextByRegex works correctly with extract mode', () => {
  const text = 'hello <world_info>some info here</world_info> world';
  const pattern = '<world_info>([\\s\\S]*?)</world_info>';
  const extracted = filterMessageTextByRegex(text, pattern, 'extract');
  assert.equal(extracted, 'some info here');
});

test('filterMessageTextByRegex handles no-match or errors gracefully', () => {
  const text = 'hello world';
  const pattern = '<world_info>([\\s\\S]*?)</world_info>';
  const cleanExclude = filterMessageTextByRegex(text, pattern, 'exclude');
  assert.equal(cleanExclude, 'hello world');

  const cleanExtract = filterMessageTextByRegex(text, pattern, 'extract');
  assert.equal(cleanExtract, '');
});
