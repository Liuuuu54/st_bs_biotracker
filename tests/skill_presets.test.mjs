import assert from 'node:assert/strict';
import test from 'node:test';

import {
  importSkillPresetGroup,
  SKILL_PRESET_GROUPS,
  updateSkillDefinition,
} from '../scripts/skill_config.js';

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
