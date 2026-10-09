// 主线复制字数上限：主线上下文可能远大于追踪 API 的上限，strict 后处理又会把系统内容合并成一则。
import assert from 'node:assert/strict';
import test from 'node:test';

import { capMainflowCopy, resolveMainflowCopyCharLimit, DEFAULT_MAINFLOW_COPY_CHAR_LIMIT } from '../scripts/api.js';
import { applyApiProfile, normalizeMainflowCopyCharLimit, saveApiProfile } from '../scripts/state.js';

const msg = (role, length, tag = '') => ({ role, content: tag + 'x'.repeat(length - tag.length) });

test('上限解析：缺值用预设，0 为不限，其余至少 1 万字', () => {
  assert.equal(resolveMainflowCopyCharLimit({}), DEFAULT_MAINFLOW_COPY_CHAR_LIMIT);
  assert.equal(resolveMainflowCopyCharLimit({ mainflowCopyCharLimit: 0 }), 0);
  assert.equal(resolveMainflowCopyCharLimit({ mainflowCopyCharLimit: 500 }), 10000);
  assert.equal(resolveMainflowCopyCharLimit({ mainflowCopyCharLimit: 'abc' }), DEFAULT_MAINFLOW_COPY_CHAR_LIMIT);
  assert.equal(normalizeMainflowCopyCharLimit('250000'), 250000);
});

test('没超过上限时原样保留', () => {
  const result = capMainflowCopy([msg('user', 100)], [msg('system', 100)], 1000);
  assert.deepEqual([result.chat.length, result.system.length, result.droppedMessages, result.truncatedChars], [1, 1, 0, 0]);
});

test('超过时先由旧到新略去聊天讯息，系统讯息不动', () => {
  const chat = [msg('user', 400, 'old'), msg('user', 400, 'mid'), msg('user', 400, 'new')];
  const result = capMainflowCopy(chat, [msg('system', 300)], 1200);
  assert.equal(result.droppedMessages, 1);
  assert.deepEqual(result.chat.map((m) => m.content.slice(0, 3)), ['mid', 'new']);
  assert.equal(result.truncatedChars, 0);
});

test('一则巨大的系统讯息（strict 合并的结果）会被截断，保留开头并注明截断字数', () => {
  const result = capMainflowCopy([], [msg('system', 50000, 'HEAD')], 10000);
  assert.equal(result.system.length, 1);
  assert.ok(result.system[0].content.startsWith('HEAD'));
  assert.equal(result.truncatedChars, 40000);
  assert.match(result.system[0].content, /已截断 40000 字/);
});

test('上限为 0 时不限制', () => {
  const result = capMainflowCopy([msg('user', 5000)], [msg('system', 5000)], 0);
  assert.deepEqual([result.droppedMessages, result.truncatedChars], [0, 0]);
});

test('字数上限随 API 配置组一起存取', () => {
  const settings = { apiUrl: 'https://a', model: 'm', mainflowCopyCharLimit: 300000, apiProfiles: [] };
  saveApiProfile(settings, '大上下文');
  settings.mainflowCopyCharLimit = 50000;
  applyApiProfile(settings, '大上下文');
  assert.equal(settings.mainflowCopyCharLimit, 300000);
});
