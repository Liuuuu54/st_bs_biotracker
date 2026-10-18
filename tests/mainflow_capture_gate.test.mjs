// 主流快照只收宿主正式生成的请求：数据库填表与剧情推进、MVU 额外解析、总结插件的请求不能盖掉它。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createMainflowCaptureGate } from '../scripts/mainflow_capture_gate.js';

const mainBody = (type = 'normal') => ({ type, messages: [{ role: 'user', content: '正文' }] });

test('没有宿主生成时不收；正式生成期间才收', () => {
  const gate = createMainflowCaptureGate();
  assert.equal(gate.accepts(mainBody()), false, '回复之后其它插件自己发的请求不收');
  gate.onGenerationStarted('normal', {}, false);
  assert.equal(gate.accepts(mainBody()), true);
  assert.equal(gate.accepts(mainBody('swipe')), true);
});

test('生成期间别的插件的请求不收：借宿主的背景请求是 quiet，直接打 API 的没有 type', () => {
  const gate = createMainflowCaptureGate();
  gate.onGenerationStarted('normal', {}, false);
  assert.equal(gate.accepts(mainBody('quiet')), false, '剧情推进、纪要召回借宿主发的请求');
  assert.equal(gate.accepts({ messages: [{ role: 'user', content: '你是【填表AI】' }] }), false, '插件自己打 API');
  assert.equal(gate.accepts(mainBody()), true, '之后主流的请求照收');
});

test('主流生成期间插进来的 quiet 生成不会关门', () => {
  const gate = createMainflowCaptureGate();
  gate.onGenerationStarted('normal', {}, false);
  gate.onGenerationStarted('quiet', { quiet_prompt: '剧情推进' }, false);
  gate.onGenerationStarted('normal', {}, true);
  assert.equal(gate.accepts(mainBody()), true);
});

test('quiet 背景生成与 dryRun 试算都不开门', () => {
  const gate = createMainflowCaptureGate();
  gate.onGenerationStarted('quiet', { quiet_prompt: '总结' }, false);
  assert.equal(gate.accepts(mainBody()), false);
  gate.onGenerationStarted('normal', {}, true);
  assert.equal(gate.accepts(mainBody()), false);
});

test('收下一份或生成结束、停止就关门', () => {
  const gate = createMainflowCaptureGate();
  gate.onGenerationStarted('regenerate', {}, false);
  gate.close();
  assert.equal(gate.accepts(mainBody()), false);
  gate.onGenerationStarted('continue', {}, false);
  gate.onGenerationEnded();
  assert.equal(gate.accepts(mainBody()), false);
});
