// 精方抽取（1.2.0）：依角色卡整理精方档案，结果只填表单，不建档。
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import * as state from '../scripts/state.js';
import { buildSireExtractionSystemPrompt, runRegistrySireExtraction, sanitizeSireExtractionResult } from '../scripts/registry.js';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  if (ORIGINAL_FETCH === undefined) delete globalThis.fetch;
  else globalThis.fetch = ORIGINAL_FETCH;
});

test('提示词：种族照使用者指定、字段照精方描述规则且不带 *、附上使用者补充', () => {
  const prompt = buildSireExtractionSystemPrompt({}, { declaredRace: '[血族]精灵', userInstruction: '他是卡里的男主' });
  assert.match(prompt, /种族已由使用者指定为 \[血族\]精灵/);
  assert.match(prompt, /外貌\|/);
  assert.match(prompt, /行动\|/);
  assert.ok(!prompt.includes('*行动'));
  assert.match(prompt, /他是卡里的男主/);
  assert.match(prompt, /spermQuality: 精子品质倍率 0\.25–4/);
});

test('结果正规化：年龄取整、体型夹在 1–7、在场预设 true、描述去掉 * 与空白栏', () => {
  assert.deepEqual(sanitizeSireExtractionResult({ age: 31.6, bodySize: 9, descriptions: { 外貌: ' 银发 ', '*行动': '靠在门边', 性器: '' } }), {
    age: 32, bodySize: 7, spermQuality: null, isHere: true,
    descriptions: [{ name: '外貌', value: '银发' }, { name: '行动', value: '靠在门边' }],
  });
  assert.deepEqual(sanitizeSireExtractionResult('坏掉的'), { age: null, bodySize: null, spermQuality: null, isHere: true, descriptions: [] });
  // 精子品质：设定没写就是 null（表单保留原值）；给了就夹在 0.25–4
  assert.equal(sanitizeSireExtractionResult({ spermQuality: 3 }).spermQuality, 3);
  assert.equal(sanitizeSireExtractionResult({ spermQuality: 9 }).spermQuality, 4);
  assert.equal(sanitizeSireExtractionResult({ spermQuality: 0.1 }).spermQuality, 0.25);
  assert.equal(sanitizeSireExtractionResult({ spermQuality: null }).spermQuality, null);
  assert.equal(sanitizeSireExtractionResult({ isHere: false }).isHere, false);
});

test('抽取只回传表单值，不建档；请求带上目标名字与旧档案', async () => {
  const ctx = {
    chatId: 'sire-extract-chat', name1: 'User', name2: '凯', characterId: 0,
    characters: [{ name: '凯', description: '195 cm 的骑士，银发。', avatar: 'kai.png' }],
    chat: [{ is_user: false, name: '凯', mes: '凯靠在门边。' }],
    extensionSettings: {}, saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  let sent = null;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ age: 28, bodySize: 4.7, isHere: true, descriptions: { 外貌: '银发骑士' } }) } }] });
      },
    };
  };
  const result = await runRegistrySireExtraction(ctx, { targetName: '凯', declaredRace: '人类' });
  assert.deepEqual(result, { age: 28, bodySize: 4.7, spermQuality: null, isHere: true, descriptions: [{ name: '外貌', value: '银发骑士' }], talents: null, skippedTalents: [] }, '图鉴是空的就不问天赋');
  assert.ok(JSON.stringify(sent).includes('target_character'), '请求要带目标名字');
  assert.deepEqual(Object.keys(state.getChatState(ctx, settings).sires), [], '抽取不建档');
});

test('有技能图鉴时一并推论天赋，按名字对到图鉴，对不上的略过', async () => {
  const ctx = {
    chatId: 'sire-talent-chat', name1: 'User', name2: '凯', characterId: 0,
    characters: [{ name: '凯', description: '天生神力的剑士。', avatar: 'kai.png' }],
    chat: [{ is_user: false, name: '凯', mes: '……' }],
    extensionSettings: {}, saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  settings.apiUrl = 'https://example.test/v1';
  settings.model = 'test-model';
  Object.assign(state.getChatState(ctx, settings), { skillCatalog: [{ id: 1, name: '剑术', description: '用剑的技巧' }], nextSkillId: 2 });
  let sentPrompt = '';
  globalThis.fetch = async (_url, init) => {
    sentPrompt = JSON.stringify(JSON.parse(init.body));
    return { ok: true, status: 200, async text() {
      return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ age: 30, talents: [{ skill: '剑术', level: 2 }, { skill: '不存在', level: 1 }] }) } }] });
    } };
  };
  const result = await runRegistrySireExtraction(ctx, { targetName: '凯' });
  assert.ok(sentPrompt.includes('skill_catalog'));
  assert.deepEqual(result.talents.map((talent) => [talent.skillId, talent.level]), [[1, 2]]);
  assert.deepEqual(result.skippedTalents, ['不存在']);
});
