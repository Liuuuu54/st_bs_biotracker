// 中转不理 stream:false、硬回串流（SSE）时，拼回一份完整回应；直连的请求明说不要串流。
import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleSseResponse, looksLikeSse } from '../scripts/api.js';

const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;

test('认得 SSE：data: 开头（可带 event: 行）；一般 JSON 不算', () => {
  assert.equal(looksLikeSse('data: {"id":"a"}\n\n'), true);
  assert.equal(looksLikeSse('event: message\ndata: {}\n'), true);
  assert.equal(looksLikeSse('{"id":"a"}'), false);
  assert.equal(looksLikeSse(''), false);
});

test('OpenAI 兼容串流：文字、思考、工具呼叫按 index 拼回，取最后的 finish_reason 与 usage', () => {
  const text = chunk({ id: 'a', model: 'g', choices: [{ index: 0, delta: { role: 'assistant', content: '{"x":', reasoning_content: '想' } }] })
    + chunk({ id: 'a', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"min' } }] } }] })
    + chunk({ id: 'a', choices: [{ index: 0, delta: { content: '1}', reasoning_content: '好', tool_calls: [{ index: 0, function: { arguments: 'utes":5}' } }] }, finish_reason: 'stop' }], usage: { total_tokens: 5 } })
    + 'data: [DONE]\n';
  const result = assembleSseResponse(text);
  assert.equal(result.choices[0].message.content, '{"x":1}');
  assert.equal(result.choices[0].message.reasoning_content, '想好');
  assert.deepEqual(result.choices[0].message.tool_calls, [{ id: 'c1', type: 'function', function: { name: 'bsPassedTime', arguments: '{"minutes":5}' } }]);
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.deepEqual(result.usage, { total_tokens: 5 });
});

test('Responses 串流取 response.completed 的整份 response；认不得的回传 null', () => {
  const text = chunk({ type: 'response.output_text.delta', delta: 'x' }) + chunk({ type: 'response.completed', response: { id: 'r', output: [] } });
  assert.deepEqual(assembleSseResponse(text, 'openai_responses'), { id: 'r', output: [] });
  assert.equal(assembleSseResponse('data: [DONE]\n'), null);
});
