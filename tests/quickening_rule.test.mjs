// 注册与心情推演一次写完整份档案，模型曾在孕 12 周就写出胎动；两份提示都要带上胎动感知的孕周界线。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBreedingInferenceSystemPrompt, buildRegistrySystemPrompt, QUICKENING_RULE } from '../scripts/registry.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';

test('注册提示带胎动感知界线', () => {
  assert.ok(buildRegistrySystemPrompt({}, {}).includes(QUICKENING_RULE));
  assert.match(QUICKENING_RULE, /18–20 周/);
  assert.match(QUICKENING_RULE, /人类产科孕周/);
  assert.match(QUICKENING_RULE, /多胎大致相同/);
  assert.match(QUICKENING_RULE, /不等于认得出/, '不知情或拒绝承认时不会认出胎动');
});

test('心情推演提示带胎动感知界线', () => {
  assert.ok(buildBreedingInferenceSystemPrompt({}, { targetName: 'A', psychologySide: 'preg' }).includes(QUICKENING_RULE));
});

// 乳意在孕早期只抽得到低机率的快积症状，原本说明直接写「溢乳」，10 周的角色也可能被写成溢乳
test('乳意说明按孕期分开：孕晚期以前是胀痛敏感，孕晚期起才可能溢乳', () => {
  const tracker = buildTrackerSystemPrompt('', null, { existing_state: {} });
  assert.match(tracker, /milk: 乳意快升；孕晚期以前是乳房胀痛、敏感加剧，孕晚期起才可能溢出初乳/);
  assert.ok(!tracker.includes('乳意快升、溢乳'));
  const mainflow = buildMainFlowStatePrompt({ existing_state: { A: { name: 'A', profile: { metabolism: { milk: 10 } } } } });
  assert.match(mainflow, /milk 乳意（孕晚期以前是乳房胀痛敏感，孕晚期起才可能溢乳）/);
});
