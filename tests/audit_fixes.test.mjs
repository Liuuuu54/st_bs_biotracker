// 工具/传输层修复回归：工具参数门禁、极端时间的循环上限、API Base 校验与格式化输出闸门。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall } from '../scripts/tools.js';
import { assertSafeDirectApiBase, isDeepSeekFamilyModel, shouldInjectV4Instruction, shouldUseResponseFormat } from '../scripts/api.js';

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

test('bsChildbirth 妊娠阶段允许，假孕期被拒绝', () => {
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

test('bsAbortion 假孕期无胎儿被拒绝，不记流产经验', () => {
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

test('bsPassedTime 极端时间快速返回且时间推进语义不被截断', () => {
  const cs = makeChatState(makeCharacter({
    base: { stage: '产后恢复', days: 1, race: '人类', vitality: 200, vitalityLevel: 4, psyStressLevel: 4, libido: 20, uterinePressure: 0 },
  }));
  const start = Date.now();
  // 各分量独立 clamp 后合计可到 2.6e8 分钟；封顶的是循环次数而非时间本身
  const result = applyToolCall(cs, {
    name: 'bsPassedTime',
    arguments: { year: 200, month: 1200, week: 5200, day: 36500 },
  });
  const elapsed = Date.now() - start;
  assert.equal(result.applied, true);
  assert.ok(elapsed < 2000, `极端时间应快速返回（实际 ${elapsed}ms），不得冻结 UI`);
  // 时间本身不该被 cap 掉：推进的分钟数应反映传入的量级
  assert.ok(cs.minutesPassed > 60 * 24 * 365, `时间推进不应被截断（实际 ${cs.minutesPassed}）`);
});

test('assertSafeDirectApiBase：公网 http 拒绝', () => {
  for (const base of ['http://api.example.com/v1', 'http://8.8.8.8:8080']) {
    assert.throws(() => assertSafeDirectApiBase(base), /仅允许本机或内网/, `base=${base} 应被拒绝`);
  }
});

test('assertSafeDirectApiBase：非 http(s) scheme 拒绝', () => {
  for (const base of ['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com', 'javascript:alert(1)']) {
    assert.throws(() => assertSafeDirectApiBase(base), /其他协议一律拒绝/, `base=${base} 应被拒绝`);
  }
});

test('assertSafeDirectApiBase：本机与内网 http 放行（自建后端常规用法）', () => {
  for (const base of [
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://[::1]:11434',
    'http://192.168.1.10:5001',
    'http://10.0.0.5/v1',
    'http://172.16.3.4:8080',
    'https://api.example.com/v1',
    'https://10.0.0.5/v1',
    '/v1',
    'api/v1',
    'localhost:8000',
  ]) {
    assert.doesNotThrow(() => assertSafeDirectApiBase(base), `base=${base} 应放行`);
  }
});

test('DeepSeek 判定只认 deepseek，不用 ds 子串', () => {
  assert.equal(isDeepSeekFamilyModel('deepseek-chat'), true);
  assert.equal(isDeepSeekFamilyModel('DeepSeek-R1'), true);
  assert.equal(isDeepSeekFamilyModel('xx-deepseek-v4-pro'), true);
  assert.equal(isDeepSeekFamilyModel('ds-chat'), false, 'ds 子串不应命中');
  assert.equal(isDeepSeekFamilyModel('gpt-4o-mini'), false);
  assert.equal(isDeepSeekFamilyModel('qwen2.5-coder'), false);
});

test('格式化输出开关：使用者关掉时一律不启用，不被模型判定覆盖', () => {
  // 开关开（默认）：所有模型带 response_format；只有 DeepSeek 系额外注入结构指令
  assert.equal(shouldUseResponseFormat({}, 'gpt-4o-mini'), true);
  assert.equal(shouldUseResponseFormat({}, 'deepseek-chat'), true);
  assert.equal(shouldInjectV4Instruction({}, 'deepseek-chat'), true);
  assert.equal(shouldInjectV4Instruction({}, 'gpt-4o-mini'), false);
  // 开关关：渠道不支持该参数时要能真的关掉，DeepSeek 也不例外
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }, 'gpt-4o-mini'), false);
  assert.equal(shouldUseResponseFormat({ formattedOutputV4: false }, 'deepseek-chat'), false);
  assert.equal(shouldInjectV4Instruction({ formattedOutputV4: false }, 'deepseek-chat'), false);
});

test('characters 用 null-proto：保留名不再被当成角色对象', async () => {
  const { createEmptyChatState } = await import('../scripts/state.js');
  const cs = createEmptyChatState();
  assert.equal(Object.getPrototypeOf(cs.characters), null, '新状态 characters 应为 null-proto');
  // 模型幻觉出保留名时应干净 skip，而不是取到继承来的内建属性再当角色对象崩掉
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const result = applyToolCall(cs, { name: 'bsSetCharacterPresence', arguments: { female: name, isPresent: true } });
    assert.equal(result.applied, false, `female=${name} 应被当作未知角色跳过`);
    assert.match(result.message, /unknown character/, `female=${name} 应回报未知角色`);
  }
  assert.equal(Object.getPrototypeOf(cs.characters), null, '写入后原型仍为 null');
  assert.equal({}.evil, undefined, '全局 Object.prototype 未被改动');
});

test('存量 characters 读取时迁移为 null-proto 且保留合法角色', async () => {
  const { getChatState } = await import('../scripts/state.js');
  const settings = { chatStates: {} };
  const oldState = { characters: { A: { name: 'A' } } };
  settings.chatStates['c'] = oldState;
  const st = getChatState({ chatId: 'c' }, settings);
  assert.equal(Object.getPrototypeOf(st.characters), null, '存量 characters 应迁移为 null-proto');
  assert.equal(st.characters.A?.name, 'A', '存量合法角色应保留');
});
