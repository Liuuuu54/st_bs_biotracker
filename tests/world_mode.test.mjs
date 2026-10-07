// 写实世界只减少提示词；特殊妊娠工具各自可关，关掉时连带拿掉它们的状态说明。
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';
import { getTrackerToolDefinitions } from '../scripts/tracker.js';
import { buildRegistrySystemPrompt } from '../scripts/registry.js';
import { getEffectiveSettings, sanitizeCardSettings } from '../scripts/card_settings.js';
import { getDisabledSpecialToolNames, normalizeSpecialTools } from '../scripts/world_mode.js';

const elfState = { 莉亚: { name: '莉亚', initialized: true, profile: { base: { race: '精灵', stage: '卵泡期', isHere: true } } } };

test('写实世界不送名录、胚型说明与衍生、血统、伴生卵字段说明，世界基准照送', () => {
  const world = '现代东京，一切如常。';
  const fantasy = buildTrackerSystemPrompt('', null, { world_baseline_prompt: world });
  const realistic = buildTrackerSystemPrompt('', null, { world_baseline_prompt: world, realistic_world: true });
  assert.ok(fantasy.includes('[可用种族名录]'));
  assert.ok(fantasy.includes('- derivedType:'));
  for (const probe of ['[可用种族名录]', '- derivedType:', '- base.bloodline / fetuses[*].bloodline:', '- fetuses[*].companionEggCount:', '- 若角色具有 derivedType']) {
    assert.equal(realistic.includes(probe), false, `写实世界不应送出 ${probe}`);
  }
  assert.ok(realistic.includes(world));
  assert.ok(realistic.length < fantasy.length - 1500, '应省下可观的提示词');
});

test('写实世界的主线提示不送种族生理设定', () => {
  assert.match(buildMainFlowStatePrompt({ existing_state: elfState }), /<bs_race>/);
  assert.equal(buildMainFlowStatePrompt({ existing_state: elfState, realistic_world: true }).includes('<bs_race>'), false);
});

test('特殊妊娠工具预设全开，关掉的会从工具清单与状态说明里拿掉', () => {
  const names = (settings) => getTrackerToolDefinitions(settings, {}).map((tool) => tool.name);
  for (const tool of ['bsImplantEmbryo', 'bsWombReturn', 'bsExtendPregnancy']) assert.ok(names({}).includes(tool));

  const settings = { realisticWorld: true, specialTools: { implantEmbryo: false, extendPregnancy: false } };
  assert.deepEqual(getDisabledSpecialToolNames(settings), ['bsImplantEmbryo', 'bsExtendPregnancy']);
  assert.equal(names(settings).includes('bsImplantEmbryo'), false);
  assert.equal(names(settings).includes('bsExtendPregnancy'), false);
  assert.ok(names(settings).includes('bsWombReturn'), '写实世界也能单独保留秘传胎归');

  const prompt = buildTrackerSystemPrompt('', null, { realistic_world: true, disabled_special_tools: ['bsImplantEmbryo', 'bsExtendPregnancy'] });
  assert.equal(prompt.includes('- 延产期：'), false);
  assert.equal(prompt.includes('- fetuses[*].provider:'), false);
  assert.ok(prompt.includes('- 回归期：'), '保留的工具说明照送');
});

test('卡片可以绑写实世界与个别特殊工具，未写的工具沿用全域', () => {
  assert.deepEqual(sanitizeCardSettings({ version: 1, realisticWorld: true, specialTools: { wombReturn: false, bogus: false } }),
    { version: 1, realisticWorld: true, specialTools: { wombReturn: false } });
  assert.deepEqual(normalizeSpecialTools(undefined), { implantEmbryo: true, wombReturn: true, extendPregnancy: true });

  const ctx = { characterId: 0, characters: [{ data: { extensions: { bs_biotracker: { version: 1, realisticWorld: true, specialTools: { wombReturn: false } } } } }], extensionSettings: {} };
  const effective = getEffectiveSettings(ctx, { realisticWorld: false, specialTools: { implantEmbryo: false } });
  assert.equal(effective.realisticWorld, true);
  assert.deepEqual(effective.specialTools, { implantEmbryo: false, wombReturn: false, extendPregnancy: true });
});

test('写实世界的注册提示不送名录与种族说明，并要求种族填人类', () => {
  const fantasy = buildRegistrySystemPrompt({}, {});
  const realistic = buildRegistrySystemPrompt({ realisticWorld: true }, {});
  assert.ok(fantasy.includes('[可用种族名录]'));
  assert.equal(realistic.includes('[可用种族名录]'), false);
  assert.match(realistic, /只有人类：base\.race 一律填 人类/);
});
