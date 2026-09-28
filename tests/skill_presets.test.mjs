import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fillTrainingSkillBaseline,
  importSkillPresetGroup,
  TRAINING_SKILL_BASELINE_PROMPT,
  SKILL_PRESET_GROUPS,
  updateSkillDefinition,
} from '../scripts/skill_config.js';
import { buildRegistryBundlePrompt, buildRegistrySkillSystemPrompt } from '../scripts/registry.js';

const DEVELOPMENT_NAMES = ['口腔开发', '胸部开发', '性器开发', '子宫开发', '后庭开发', '尿道开发'];
const BEHAVIOR_NAMES = ['前戏', '侍奉', '自慰', '露出', '拘束', 'M倾向', 'S倾向', '情趣玩具', '多人行为'];

test('skill presets contain the intended independent 6 + 9 groups', () => {
  assert.deepEqual(SKILL_PRESET_GROUPS.development.entries.map((entry) => entry.name), DEVELOPMENT_NAMES);
  assert.deepEqual(SKILL_PRESET_GROUPS.behavior.entries.map((entry) => entry.name), BEHAVIOR_NAMES);
});

test('skill preset import reuses the catalog IDs and preserves custom skills', () => {
  const custom = [{ id: 4, name: '自定义技能', description: '保留。' }];
  const development = importSkillPresetGroup(custom, 9, 'development');

  assert.equal(development.created, 6);
  assert.deepEqual(development.catalog.slice(0, 1), custom);
  assert.deepEqual(development.catalog.slice(1).map((entry) => entry.id), [9, 10, 11, 12, 13, 14]);
  assert.equal(development.nextSkillId, 15);

  const behavior = importSkillPresetGroup(development.catalog, development.nextSkillId, 'behavior');
  assert.equal(behavior.created, 9);
  assert.equal(behavior.catalog.length, 16);
  assert.equal(behavior.nextSkillId, 24);
});

test('reimporting a skill preset is idempotent by skill name', () => {
  const first = importSkillPresetGroup([], 1, 'behavior');
  const second = importSkillPresetGroup(first.catalog, first.nextSkillId, 'behavior');

  assert.equal(first.created, 9);
  assert.equal(second.created, 0);
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.nextSkillId, first.nextSkillId);
});

test('skill definitions can edit their prompt without changing the stable ID', () => {
  const catalog = [
    { id: 3, name: '前戏', description: '旧描述。' },
    { id: 8, name: '自慰', description: '另一项。' },
  ];
  const result = updateSkillDefinition(catalog, 3, {
    name: '前戏技巧',
    description: '依剧情中的爱抚与亲吻表现累积经验。',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.definition, {
    id: 3,
    name: '前戏技巧',
    description: '依剧情中的爱抚与亲吻表现累积经验。',
  });
  assert.equal(result.catalog[0].id, 3);
  assert.equal(result.catalog[1].id, 8);
});

test('skill definition edits reject empty prompts and duplicate names', () => {
  const catalog = [
    { id: 3, name: '前戏', description: '描述。' },
    { id: 8, name: '自慰', description: '另一项。' },
  ];

  assert.equal(updateSkillDefinition(catalog, 3, { name: '前戏', description: '' }).ok, false);
  assert.equal(updateSkillDefinition(catalog, 3, { name: '自慰', description: '重复名称。' }).ok, false);
});

test('导入调教预设时技能基准空着才补上，已有基准不动', () => {
  assert.deepEqual(fillTrainingSkillBaseline(''), { baseline: TRAINING_SKILL_BASELINE_PROMPT, filled: true });
  assert.deepEqual(fillTrainingSkillBaseline('  只追踪冒险技能  '), { baseline: '只追踪冒险技能', filled: false });
  assert.match(TRAINING_SKILL_BASELINE_PROMPT, /职业专长与才能只当背景，不列为技能或天赋/);
});

test('有技能基准时，一次注册与技能页都把它当最高优先规则', () => {
  for (const prompt of [
    buildRegistryBundlePrompt({ skillBaselinePrompt: TRAINING_SKILL_BASELINE_PROMPT }),
    buildRegistrySkillSystemPrompt({ skillBaselinePrompt: TRAINING_SKILL_BASELINE_PROMPT }),
  ]) {
    assert.match(prompt, /严格遵守 payload\.skill_baseline_prompt/);
  }
});
