// 审计修复回归测试：覆盖 review 建议补测的新行为（P2-6）。
// bsAddSperm 负值 / bsChildbirth 门禁 / bsAbortion 假孕 / presence 缺省 /
// 负 libido 泌乳 / 混血 genderRatio 双性 / 未知种族标记 / 同基去重。
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyToolCall } from '../scripts/tools.js';
import { getMergedRacePhysiologyProfile } from '../scripts/race_config.js';
import { assertSafeDirectApiBase } from '../scripts/api.js';
import { getMainflowContextSnapshot } from '../scripts/tracker.js';

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

test('扶她x人类 混血保持双性（genderRatio null 优先）', () => {
  const merged = getMergedRacePhysiologyProfile('扶她x人类');
  assert.equal(merged.genderRatio, null);
});

test('未知混血成分被标记而非静默丢弃', () => {
  const merged = getMergedRacePhysiologyProfile('人类x不存在种族');
  assert.equal(merged.hasUnknownRace, true);
});

test('同基种族 subtype 混血不重复加权', () => {
  const merged = getMergedRacePhysiologyProfile('兽耳族-兔x人类x兽耳族-猫');
  assert.ok(Math.abs(merged.gestationSpeciesSpeed - 1.2307692307692308) < 0.0001);
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

test('mainflow 快照绑定当前聊天：跨聊天/无绑定一律拒绝', () => {
  const snapshotKey = '__bs_biotracker_mainflow_context_snapshot__';
  const messages = [{ role: 'user', content: 'hi' }];
  const ctxA = { chatId: 'chat-a' };
  const ctxB = { chatId: 'chat-b' };
  globalThis[snapshotKey] = { chatKey: 'chat-a', messages };
  try {
    assert.ok(getMainflowContextSnapshot(ctxA), '同聊天快照应可用');
    assert.equal(getMainflowContextSnapshot(ctxB), null, '跨聊天快照应拒绝');
    globalThis[snapshotKey] = { messages }; // 旧格式：无 chatKey 绑定
    assert.equal(getMainflowContextSnapshot(ctxA), null, '无绑定旧格式应拒绝');
  } finally {
    delete globalThis[snapshotKey];
  }
});
