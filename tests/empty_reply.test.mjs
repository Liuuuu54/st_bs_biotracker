// 空回的诊断与思考内容里的 JSON（1.5.4）
import assert from 'node:assert/strict';
import test from 'node:test';

import { describeEmptyReply, extractReplyJson } from '../scripts/api.js';

const reply = (message, extra = {}) => ({ choices: [{ message, ...(extra.choice || {}) }], ...(extra.usage ? { usage: extra.usage } : {}) });

test('正文有 JSON 照常用；正文空、思考里有 JSON 就从思考取', () => {
  assert.deepEqual(extractReplyJson(reply({ content: '{"a":1}' })).parsed, { a: 1 });
  const fromReasoning = extractReplyJson(reply({ content: '', reasoning_content: '先想想……\n```json\n{"tool_calls":[]}\n```' }));
  assert.deepEqual(fromReasoning.parsed, { tool_calls: [] });
  // 正文有字但不是 JSON：不去翻思考内容（那多半是草稿）
  assert.equal(extractReplyJson(reply({ content: '好的', reasoning_content: '{"x":1}' })).parsed, null);
  // 分段阵列的正文
  assert.deepEqual(extractReplyJson(reply({ content: [{ type: 'text', text: '{"b":2}' }] })).parsed, { b: 2 });
});

test('空回诊断：额度被思考用光', () => {
  const text = describeEmptyReply(reply({ content: '', reasoning_content: '长长的思考' }, { choice: { finish_reason: 'length' }, usage: { completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 4090 } } }));
  assert.match(text, /finish_reason: length/);
  assert.match(text, /输出 4096 tokens，其中思考 4090/);
  assert.match(text, /被思考用光/);
});

test('空回诊断：内容审查、上游空壳', () => {
  assert.match(describeEmptyReply(reply({ content: '' }, { choice: { finish_reason: 'content_filter' }, usage: { completion_tokens: 0 } })), /内容审查/);
  const shell = describeEmptyReply(reply({ content: '' }, { choice: { finish_reason: 'stop' }, usage: { completion_tokens: 0 } }));
  assert.match(shell, /上游回了空壳/);
  assert.match(shell, /裸请求/);
  assert.match(describeEmptyReply({}), /没有用量资料/);
});
