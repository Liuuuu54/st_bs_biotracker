import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMemorySource, readMemorySource } from '../scripts/memory_sources.js';

test('记忆源只接受四种模式，未知值回到内置记忆', () => {
  assert.equal(normalizeMemorySource('anima'), 'anima');
  assert.equal(normalizeMemorySource('baibai'), 'baibai');
  assert.equal(normalizeMemorySource('database'), 'database');
  assert.equal(normalizeMemorySource('unknown'), 'internal');
});

test('柏宝书来源读取注入历史文本', async () => {
  const previous = globalThis.STBaiBaiBook;
  globalThis.STBaiBaiBook = { getInjectedHistory: () => ({ relativeText: '柏宝书历史摘要' }) };
  try {
    const result = await readMemorySource({ source: 'baibai' });
    assert.equal(result.text, '柏宝书历史摘要');
    assert.equal(result.sourceName, '柏宝书');
  } finally {
    globalThis.STBaiBaiBook = previous;
  }
});

test('数据库来源只读取标准纪要条目', async () => {
  const previous = globalThis.TavernHelper;
  globalThis.TavernHelper = {
    getCharLorebooks: () => ({ primary: '自动记忆库' }),
    getWorldbook: async () => [
      { name: 'TavernDB-ACU-CustomExport-纪要-1', content: '数据库摘要一' },
      { name: '普通设定', content: '不应读入' },
      { name: '总结条目 2', content: '数据库摘要二' },
    ],
  };
  try {
    const result = await readMemorySource({ source: 'database', ctx: { characters: [{ data: { extensions: { world: '错误回退库' } } }], characterId: 0 } });
    assert.equal(result.text, '数据库摘要一\n\n数据库摘要二');
    assert.equal(result.sourceName, '自动记忆库');
  } finally {
    globalThis.TavernHelper = previous;
  }
});

test('Anima 来源读取带 history 索引的分片', async () => {
  const previous = globalThis.TavernHelper;
  globalThis.TavernHelper = {
    getChatWorldbookName: async () => '当前书',
    getWorldbook: async () => [{
      extra: { createdBy: 'anima_summary', history: [{ unique_id: 'slice_1', tags: ['角色'] }] },
      content: '<slice_1>Anima 摘要</slice_1>',
    }],
  };
  try {
    const result = await readMemorySource({ source: 'anima', recentMessages: [{ text: '角色' }] });
    assert.equal(result.text, 'Anima 摘要');
    assert.equal(result.sourceName, '当前书');
  } finally {
    globalThis.TavernHelper = previous;
  }
});

test('外部记忆超过预算时保留近景并插入省略标记', async () => {
  const previous = globalThis.STBaiBaiBook;
  globalThis.STBaiBaiBook = { getInjectedHistory: () => ({ relativeText: '早期记忆。'.repeat(100) + '\n\n近期记忆。'.repeat(100) }) };
  try {
    const result = await readMemorySource({
      source: 'baibai',
      ctx: { getTokenCountAsync: async () => 100000 },
    });
    assert.match(result.text, /较早记忆已省略/);
    assert.match(result.text, /近期记忆/);
  } finally {
    globalThis.STBaiBaiBook = previous;
  }
});