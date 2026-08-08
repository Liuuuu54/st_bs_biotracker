// 审计修复回归测试：覆盖 review 建议补测的新行为（P2-6）。
// bsAddSperm 负值 / bsChildbirth 门禁 / bsAbortion 假孕 / presence 缺省 /
// 负 libido 泌乳 / 混血 genderRatio 双性 / 未知种族标记 / 同基去重。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall } from '../scripts/tools.js';
import { assertSafeDirectApiBase, isDeepSeekFamilyModel, resolveFormattedOutputV4 } from '../scripts/api.js';
import { buildWardrobePrepSystemPrompt, buildWardrobeStyleBookBlock, loadWardrobeStyleBook } from '../scripts/registry.js';

function makeCharacter(overrides = {}) {
  return {
    name: 'F',
    initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 3, race: '人类', vitality: 100,
        vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0,
        ...overrides.base,
      },
      pregnant: { fetuses: [], fetusesCount: 0, ...overrides.pregnant },
      bio: {},
      immune: {},
      experience: {},
      metabolism: {},
      ...overrides.profile,
    },
  };
}

function makeChatState(character = makeCharacter()) {
  return { characters: { F: character } };
}

function makeFetus() {
  return { fathers: 'A', race: '人类', gender: '女', embryoType: '胎生', weight: 1 };
}

test('bsAddSperm 负 amount 被拒绝且不改性行为字段', () => {
  const cs = makeChatState(makeCharacter({
    base: { stage: '卵泡期', days: 3, race: '人类', sperms: [{ male: 'A', race: '人类', value: 20 }] },
  }));
  const result = applyToolCall(cs, { name: 'bsAddSperm', arguments: { female: 'F', male: 'A', race: '人类', amount: -5 } });
  assert.equal(result.applied, false);
  assert.match(result.message, /bsDrainSperm/);
  assert.equal(cs.characters.F.profile.base.latestSexDays, undefined);
  assert.equal(cs.characters.F.profile.base.sperms[0].value, 20);
});

test('bsChildbirth 孕早期/逾期允许，假孕期被拒绝', () => {
  for (const stage of ['孕早期', '逾期']) {
    const cs = makeChatState(makeCharacter({
      base: { stage, days: 1, race: '人类' },
      pregnant: { fetuses: [makeFetus()], fetusesCount: 1 },
    }));
    const result = applyToolCall(cs, { name: 'bsChildbirth', arguments: { female: 'F' } });
    assert.equal(result.applied, true, `stage=${stage} 应允许手术分娩`);
  }
  const cs = makeChatState(makeCharacter({
    base: { stage: '假孕期', days: 1, race: '人类' },
    pregnant: { fetuses: [makeFetus()], fetusesCount: 1 },
  }));
  const result = applyToolCall(cs, { name: 'bsChildbirth', arguments: { female: 'F' } });
  assert.equal(result.applied, false, '假孕期不允许手术分娩');
});

test('bsAbortion 假孕期无胎儿被拒绝，不进入流产', () => {
  const cs = makeChatState(makeCharacter({ base: { stage: '假孕期', days: 2, race: '人类' } }));
  const result = applyToolCall(cs, { name: 'bsAbortion', arguments: { female: 'F' } });
  assert.equal(result.applied, false);
  assert.match(result.message, /bsSetMenstrualPhases/);
  assert.notEqual(cs.characters.F.profile.base.stage, '产后恢复');
  assert.notEqual(cs.characters.F.profile.experience.miscarriageExperience, 1);
});

test('bsSetCharacterPresence 缺 isPresent 被拒绝，显式传入正常', () => {
  const cs = makeChatState();
  const rejected = applyToolCall(cs, { name: 'bsSetCharacterPresence', arguments: { female: 'F' } });
  assert.equal(rejected.applied, false);
  const ok = applyToolCall(cs, { name: 'bsSetCharacterPresence', arguments: { female: 'F', isPresent: false } });
  assert.equal(ok.applied, true);
  assert.equal(cs.characters.F.profile.base.isHere, false);
});

test('性欲下降不触发泌乳，上升才触发', () => {
  const cs = makeChatState(makeCharacter({
    base: { stage: '产后恢复', days: 1, race: '人类', libido: 20 },
    profile: { metabolism: { milk: 10, excretion: 0, hunger: 0, sleep: 0, odor: 0, companionship: 0 } },
  }));
  applyToolCall(cs, { name: 'bsUpdateCharacterStatus', arguments: { female: 'F', options: { libido: -5 } } });
  assert.equal(cs.characters.F.profile.metabolism.milk, 10, '负性欲不应泌乳');
  applyToolCall(cs, { name: 'bsUpdateCharacterStatus', arguments: { female: 'F', options: { libido: 5 } } });
  assert.ok(cs.characters.F.profile.metabolism.milk > 10, '正性欲应泌乳');
});

test('assertSafeDirectApiBase：远程 http（含畸形前缀）一律拒绝', () => {
  for (const base of ['http://api.example.com/v1', 'http:/api.example.com', 'http:api.example.com']) {
    assert.throws(() => assertSafeDirectApiBase(base), /仅允许 localhost/, `base=${base} 应被拒绝`);
  }
});

test('assertSafeDirectApiBase：localhost/IPv6/https/相对路径放行', () => {
  for (const base of [
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://[::1]:11434',
    'https://api.example.com/v1',
    '/v1',
    'api/v1',
    'localhost:8000',
  ]) {
    assert.doesNotThrow(() => assertSafeDirectApiBase(base), `base=${base} 应放行`);
  }
  assert.throws(() => assertSafeDirectApiBase('http://'), /无法解析/);
});

test('DeepSeek 系模型自动启用 v4 兼容格式化输出（宽松子串匹配）', () => {
  // 唯二官方模型 + 公益站带前后缀的变体
  assert.equal(isDeepSeekFamilyModel('deepseek-v4-flash'), true);
  assert.equal(isDeepSeekFamilyModel('deepseek-v4-pro'), true);
  assert.equal(isDeepSeekFamilyModel('deepseek-chat'), true);
  assert.equal(isDeepSeekFamilyModel('DeepSeek-R1'), true);
  assert.equal(isDeepSeekFamilyModel('ds-chat'), true);
  assert.equal(isDeepSeekFamilyModel('ds_v4-pro'), true);
  assert.equal(isDeepSeekFamilyModel('xx-deepseek-xx'), true);
  assert.equal(isDeepSeekFamilyModel('xxx-ds-xxx'), true);
  // 普通模型不含 ds/deepseek
  assert.equal(isDeepSeekFamilyModel('gpt-4o-mini'), false);
  assert.equal(isDeepSeekFamilyModel('qwen2.5-coder'), false);
  assert.equal(isDeepSeekFamilyModel('claude-sonnet-4'), false);
  // 设置关闭时：DeepSeek 仍启用（自动切换），普通模型关闭则停用
  assert.equal(resolveFormattedOutputV4({ formattedOutputV4: false }, 'deepseek-v4-flash'), true);
  assert.equal(resolveFormattedOutputV4({ formattedOutputV4: false }, 'ds-chat'), true);
  assert.equal(resolveFormattedOutputV4({ formattedOutputV4: false }, 'gpt-4o-mini'), false);
  assert.equal(resolveFormattedOutputV4({}, 'any-model'), true);
  assert.equal(resolveFormattedOutputV4({ formattedOutputV4: false }, ''), false);
});

test('备装风格世界书：排除服装描写强化，只发 content，其余 22 条并入提示词', async () => {
  const raw = await loadWardrobeStyleBook();
  assert.ok(raw && raw.length > 1000, '世界书文件应可加载');
  const block = buildWardrobeStyleBookBlock(raw);
  assert.ok(block.length > 1000, '风格参考块应有实际内容');
  assert.equal(block.includes('服装描写强化'), false, '不得包含被排除的条目');
  assert.equal((block.match(/【服装风格参考/g) || []).length, 22, '应包含 22 条风格条目');
  // 只发 content：不得包含 skill 化元数据（ACU_SKILL_META / key / triggerWhen）
  assert.equal(block.includes('ACU_SKILL_META'), false, '不得泄漏 ACU_SKILL_META 元数据');
  assert.equal(block.includes('triggerWhen'), false, '不得发送 skill 触发提示');
  const on = buildWardrobePrepSystemPrompt({}, { includeStyleBook: true, styleBookRaw: raw, wardrobePrepPrompt: '测试' });
  assert.ok(on.includes('服装风格世界书参考'), '开启时提示词应含风格块');
  assert.ok(on.includes('[用户额外备装提示]'), '用户提示段应保留');
  const off = buildWardrobePrepSystemPrompt({}, { includeStyleBook: false });
  assert.equal(off.includes('服装风格世界书参考'), false, '关闭时不应含风格块');
});
