// 使用者回报：残留导致正文一直描写流出，但清空又让受孕机会归零。
// 根因是提示词从未说明残留会自动衰减、amount 该给多大、以及清空的后果。
// 这里锁住「提示词宣称的语义」与「引擎实际行为」一致。
import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_DEFINITIONS, applyToolCall } from '../scripts/tools.js';
import { buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';

const DECLARED_DECAY_PER_DAY = 10;

function makeChatState(value) {
  return {
    characters: {
      F: {
        name: 'F',
        initialized: true,
        profile: {
          base: {
            stage: '卵泡期', days: 3, race: '人类', vitality: 100,
            vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0,
            eggs: 0,
            sperms: [{ male: 'A', race: '人类', value }],
          },
          bio: {}, pregnant: { fetuses: [], fetusesCount: 0 },
          immune: {}, experience: {}, metabolism: {}, cooldown: {},
        },
      },
    },
  };
}

function spermValueAfterDays(startValue, days) {
  const chatState = makeChatState(startValue);
  applyToolCall(chatState, { name: 'bsPassedTime', arguments: { day: days } });
  const sperms = chatState.characters.F.profile.base.sperms || [];
  return sperms.length > 0 ? sperms[0].value : 0;
}

test('残留衰减速率与提示词宣称的一致', () => {
  // 提示词告诉模型「每天自动衰减 10」，引擎必须真的这样跑
  assert.equal(spermValueAfterDays(100, 1), 100 - DECLARED_DECAY_PER_DAY);
  assert.equal(spermValueAfterDays(100, 3), 100 - (DECLARED_DECAY_PER_DAY * 3));
});

test('建议的 amount 区间确实在 1-3 天内自然清空', () => {
  // 提示词建议 10-30，并宣称 1-3 天内消失
  assert.equal(spermValueAfterDays(10, 1), 0, 'amount 10 应在 1 天后清空');
  assert.equal(spermValueAfterDays(30, 3), 0, 'amount 30 应在 3 天后清空');
});

test('工具描述带上标度与清空后果，避免模型误用', () => {
  const addSperm = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsAddSperm');
  assert.match(addSperm.description, /10-30/, 'bsAddSperm 应说明 amount 的建议区间');
  assert.match(addSperm.description, /衰减/, 'bsAddSperm 应说明残留会自动衰减');

  const drainSperm = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsDrainSperm');
  assert.match(drainSperm.description, /不再有受孕机会/, 'bsDrainSperm 应警告清空会断掉受孕');
  assert.match(drainSperm.description, /洗澡/, 'bsDrainSperm 应说明单纯洗澡不该调用');
});

test('追踪提示词说明残留会自动衰减', () => {
  const prompt = buildTrackerSystemPrompt('base', null, {});
  const spermsLine = prompt.split('\n').find((line) => line.startsWith('- sperms:'));
  assert.ok(spermsLine, '提示词应有 sperms 说明');
  assert.match(spermsLine, /自动衰减/, '应告知模型残留会自行消失');
  assert.match(spermsLine, /不需要每轮重复描写/, '应明确不要每轮描写流出');
});
