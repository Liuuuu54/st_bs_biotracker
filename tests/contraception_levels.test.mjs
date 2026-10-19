// 百科的套子可靠度与事后避孕成功率要让模型知道：只给分级描述、不给数字，0 即本世界没有这种手段
import assert from 'node:assert/strict';
import test from 'node:test';

import { contraceptionLevels } from '../scripts/reproductive.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';

const payloadWith = (reproductiveSettings) => ({
  existing_state: { A: { name: 'A', profile: {} } },
  contraception_levels: contraceptionLevels(reproductiveSettings),
});

test('可靠度依门槛分级，预设 0.95／0.8 都算大致可靠', () => {
  assert.deepEqual(contraceptionLevels(), { condom: 'reliable', emergency: 'reliable' });
  assert.deepEqual(contraceptionLevels({ condomReliability: 0, emergencyEffectiveness: 0 }), { condom: 'none', emergency: 'none' });
  assert.deepEqual(contraceptionLevels({ condomReliability: 0.3, emergencyEffectiveness: 0.3 }), { condom: 'poor', emergency: 'poor' });
  assert.deepEqual(contraceptionLevels({ condomReliability: 0.7, emergencyEffectiveness: 0.5 }), { condom: 'unreliable', emergency: 'unreliable' });
  assert.deepEqual(contraceptionLevels({ condomReliability: 1, emergencyEffectiveness: 1 }), { condom: 'certain', emergency: 'certain' });
  assert.deepEqual(contraceptionLevels({ condomReliability: -1, emergencyEffectiveness: 2 }), { condom: 'none', emergency: 'certain' }, '超出 0～1 先截断');
});

test('30% 的套子在追踪与主流提示词里都写成很不牢靠，不带数字', () => {
  const payload = payloadWith({ condomReliability: 0.3 });
  for (const prompt of [buildTrackerSystemPrompt('', null, payload), buildMainFlowStatePrompt(payload)]) {
    assert.match(prompt, /\[本世界的避孕手段\]/);
    assert.match(prompt, /屏障式避孕.*很不牢靠/);
    assert.match(prompt, /事后避孕.*多数有效，但不保证/);
    const block = prompt.split('[本世界的避孕手段]\n')[1].split('\n').slice(0, 2).join('\n');
    assert.ok(!/\d/.test(block), '不给确切数字');
  }
});

test('设 0 时注明本世界不存在；工具名只出现在追踪提示词', () => {
  const payload = payloadWith({ condomReliability: 0, emergencyEffectiveness: 0 });
  const tracker = buildTrackerSystemPrompt('', null, payload);
  assert.match(tracker, /屏障式避孕.*本世界不存在.*hasCondom=true/);
  assert.match(tracker, /事后避孕.*本世界不存在.*purpose=emergency/);
  const mainflow = buildMainFlowStatePrompt(payload);
  assert.match(mainflow, /屏障式避孕.*本世界不存在，剧情不得出现。/);
  assert.match(mainflow, /事后避孕.*本世界不存在，剧情不得出现。/);
  assert.ok(!/hasCondom|bsAbortion/.test(mainflow), '主流模型不能调用工具');
});

test('payload 没带分级时不加这一段', () => {
  assert.ok(!buildTrackerSystemPrompt('', null, {}).includes('本世界的避孕手段'));
});
