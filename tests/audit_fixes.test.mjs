// 审计修复回归测试：覆盖 review 建议补测的新行为（P2-6）。
// bsAddSperm 负值 / bsChildbirth 门禁 / bsAbortion 假孕 / presence 缺省 /
// 负 libido 泌乳 / 混血 genderRatio 双性 / 未知种族标记 / 同基去重。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall } from '../scripts/tools.js';
import { assertSafeDirectApiBase, isDeepSeekFamilyModel, shouldInjectV4Instruction, shouldUseResponseFormat } from '../scripts/api.js';
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

test('assertSafeDirectApiBase：非 http(s) scheme 与私网地址拒绝（网络面审查 P2）', () => {
  for (const base of [
    'file:///etc/passwd',
    'gopher://example.com',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/v1',
    'https://192.168.1.1/v1',
    'http://0.0.0.0:11434',
  ]) {
    assert.throws(() => assertSafeDirectApiBase(base), /拒绝|私网|环回|链路本地|仅允许 localhost/, `base=${base} 应被拒绝`);
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
  // 按钮开（默认）：所有模型都带 response_format；ds 系额外注入 v4 指令，普通模型不注入
  assert.equal(shouldUseResponseFormat({}, 'gpt-4o-mini'), true);
  assert.equal(shouldUseResponseFormat({}, 'deepseek-v4-flash'), true);
  assert.equal(shouldInjectV4Instruction({}, 'deepseek-v4-flash'), true);
  assert.equal(shouldInjectV4Instruction({}, 'ds-chat'), true);
  assert.equal(shouldInjectV4Instruction({}, 'gpt-4o-mini'), false);
  assert.equal(shouldInjectV4Instruction({}, 'qwen2.5-coder'), false);
  // 按钮关闭：普通模型停用 response_format；ds 系仍自动启用 + 注入指令
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }, 'gpt-4o-mini'), false);
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }, 'deepseek-v4-flash'), true);
  assert.equal(shouldInjectV4Instruction({ formattedOutputV4: false }, 'deepseek-v4-flash'), true);
  assert.equal(shouldInjectV4Instruction({ formattedOutputV4: false }, 'gpt-4o-mini'), false);
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }, ''), false);
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

test('bsPassedTime 极端时间总量被 cap（防 CPU 冻结，安全审查 P1）', () => {
  const cs = makeChatState(makeCharacter({
    base: { stage: '产后恢复', days: 1, race: '人类', vitality: 200, vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0 },
  }));
  const start = Date.now();
  // 各分量独立 clamp 后合计本可到 2.6e8 分钟（约 1e9 轮妊娠代谢循环），应被总量 cap 到一年内
  const result = applyToolCall(cs, {
    name: 'bsPassedTime',
    arguments: { year: 200, month: 1200, week: 5200, day: 36500 },
  });
  const elapsed = Date.now() - start;
  assert.equal(result.applied, true);
  assert.ok(elapsed < 2000, `极端时间应快速返回（实际 ${elapsed}ms），不得冻结 UI`);
  assert.ok(cs.minutesPassed <= 60 * 24 * 365, `累积时间不应超过一年 cap（实际 ${cs.minutesPassed}）`);
});

test('characters 用 null-proto：__proto__ 角色名不污染原型（安全审查 P2）', async () => {
  const { createEmptyChatState, getChatState } = await import('../scripts/state.js');
  const { applyToolCall } = await import('../scripts/tools.js');
  // 新状态 null-proto
  const cs = createEmptyChatState();
  assert.equal(Object.getPrototypeOf(cs.characters), null, '新状态 characters 应为 null-proto');
  cs.characters['__proto__'] = { evil: true };
  assert.equal(Object.getPrototypeOf(cs.characters), null, '写 __proto__ 键后原型仍为 null');
  assert.equal({}.evil, undefined, '全局 Object.prototype 未被污染');
  // 工具调用传 __proto__ 应被拒绝
  const cs2 = createEmptyChatState();
  const result = applyToolCall(cs2, { name: 'bsSetCharacterPresence', arguments: { female: '__proto__', isPresent: true } });
  assert.equal(result.applied, false, '工具调用 __proto__ 应被拒绝');
  assert.equal(Object.getPrototypeOf(cs2.characters), null, '工具调用后原型仍为 null');
  // 存量迁移：普通对象 + 被污染键 → getChatState 重建为 null-proto 并丢弃污染
  const settings = { chatStates: {} };
  const oldState = { characters: { A: { name: 'A' } } };
  oldState.characters['__proto__'] = { evil: true };
  settings.chatStates['c'] = oldState;
  const ctx = { chatId: 'c' };
  const st = getChatState(ctx, settings);
  assert.equal(Object.getPrototypeOf(st.characters), null, '存量 characters 应迁移为 null-proto');
  assert.equal(st.characters.A?.name, 'A', '存量合法角色应保留');
  assert.equal('evil' in st.characters, false, '污染键应被丢弃');
});
