import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as state from '../scripts/state.js';
import { applyToolCall } from '../scripts/tools.js';
import { enablePooledConception } from '../scripts/pooled_reproduction.js';

// 清空入口与后续推进均经过实际公开分派器；固定卵门槛确保旧问题会触发受精。
const copy = (value) => JSON.parse(JSON.stringify(value));
const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });
const profile = (chat) => chat.characters['母方'].profile;
const base = (chat) => profile(chat).base;
const clear = (chat) => call(chat, 'bsDebugClearContainers', { female: '母方', container: 'sperms' });
function pass(chat, minute) {
  const result = call(chat, 'bsPassedTime', { minute });
  assert.equal(result.applied, true, result.message);
  return result;
}
function fixture({ pooled = true, threshold = 0.0002 } = {}) {
  const chat = state.createEmptyChatState();
  const character = state.createDefaultFemaleState('母方');
  character.initialized = true;
  Object.assign(character.profile.base, { stage: '卵泡期', days: 3, race: '人类', bodySize: 4,
    age: 24, vitality: 100, psyStress: 0, libido: 0, eggs: 1, isHere: false });
  Object.assign(character.profile.bio, { impregnationDifficulty: 1, identicalProbability: 0 });
  character.profile.immune.metabolism = true;
  character.runtime = { dayCarryMinutes: 0, hourCarryMinutes: 0, lifestyleWeekCarryMinutes: 0 };
  chat.characters['母方'] = character;
  if (pooled) enablePooledConception(character.profile.base, 0, { seed: '清空精液原生回归' });
  for (const action of ['insert', 'deposit']) {
    const result = call(chat, 'bsAddSperm', { female: '母方', male: '父方', race: '人类', action,
      amount: action === 'deposit' ? 20 : 0 });
    assert.equal(result.applied, true, result.message);
  }
  if (pooled) for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = threshold;
  return chat;
}
function empty(chat) {
  assert.deepEqual(base(chat).sperms, []);
  assert.ok(base(chat).spermContacts.every((source) => source.value === 0));
}

for (const primed of [false, true]) {
  test(`混合池清空后推进一分钟无残留或新受精，已有锚点=${primed}`, () => {
    const chat = fixture();
    if (primed) {
      assert.deepEqual(pass(chat, 0.25).conceptionEvents, []);
      assert.ok(base(chat).spermPool.segment, '须实际建立含物理量与未来首穿的积分锚点');
    }
    const control = copy(chat);
    assert.equal(pass(control, 1).conceptionEvents.length, 1, '对照必须证明该固定条件原本会受精');
    const result = clear(chat);
    assert.equal(result.applied, true, result.message);
    empty(chat);
    assert.equal(base(chat).spermPool.segment, undefined);
    assert.deepEqual(pass(chat, 1).conceptionEvents, []);
    empty(chat);
    assert.deepEqual(profile(chat).pregnant.fetuses, []);
  });
}

test('只剩权威接触物理量而展示已空时仍可真正清空，修复旧清空存档', () => {
  const chat = fixture();
  pass(chat, 0.25);
  base(chat).sperms = [];
  const result = clear(chat);
  assert.equal(result.applied, true, result.message);
  empty(chat);
  assert.equal(base(chat).spermPool.segment, undefined);
  assert.deepEqual(pass(chat, 1).conceptionEvents, []);
  empty(chat);
});

test('清空保留来源快照、失活状态、编号及卵预算，不推进时钟或暗改身份计数', () => {
  const chat = fixture({ threshold: 100 });
  const b = base(chat);
  b.spermContacts[0].bloodline = { 人类: 1 };
  b.spermContacts[0].bloodlineSource = 'pure';
  b.spermContacts[0].extensionSnapshot = { marker: '历史信息' };
  b.spermContacts[0].blocked = true;
  pass(chat, 0.25);
  const contacts = copy(base(chat).spermContacts);
  const { segment, ...pool } = copy(base(chat).spermPool);
  const beforeTime = chat.minutesPassed;
  const counter = base(chat).nextSpermContactId;
  assert.ok(segment);
  assert.equal(clear(chat).applied, true);
  assert.deepEqual(base(chat).spermContacts, contacts.map((source) => ({ ...source, value: 0 })));
  assert.deepEqual(base(chat).spermPool, pool, '只失效积分锚点，其余种子、卵预算和计数保持');
  assert.equal(base(chat).nextSpermContactId, counter);
  assert.equal(chat.minutesPassed, beforeTime);
  assert.equal(base(chat).eggs, 1);
  const again = clear(chat);
  assert.equal(again.applied, false, '零量历史不是可重复清空的物理残留');
  assert.deepEqual(base(chat).spermContacts, contacts.map((source) => ({ ...source, value: 0 })));
});

test('清空及JSON恢复后长时间推进仍为空；真正的新沉积才重新产生未来风险', () => {
  let chat = fixture({ threshold: 100 });
  pass(chat, 0.25);
  assert.equal(clear(chat).applied, true);
  chat = copy(chat);
  for (const duration of [0.5, 59.5, 720, 1440]) {
    assert.deepEqual(pass(chat, duration).conceptionEvents, []);
    empty(chat);
  }
  const oldId = base(chat).spermContacts[0].id;
  base(chat).eggs = 1;
  for (const action of ['insert', 'deposit']) {
    assert.equal(call(chat, 'bsAddSperm', { female: '母方', male: '新人', race: '人类', action,
      amount: action === 'deposit' ? 20 : 0 }).applied, true);
  }
  const current = base(chat).spermContacts.find((source) => source.male === '新人');
  assert.ok(current.id > oldId);
  assert.equal(base(chat).spermContacts.find((source) => source.id === oldId).value, 0);
  // 让真实下一次推进创建新卵预算，再固定该卵门槛；不从已清旧来源获取风险。
  pass(chat, 0.001);
  for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
  const result = pass(chat, 1);
  assert.equal(result.conceptionEvents.length, 1);
  assert.equal(result.conceptionEvents[0].father, '新人');
  assert.equal(result.conceptionEvents[0].winnerContactId, current.id);
});

test('已有受精胚胎及其父系关联保留，清空只阻断其余卵的未来受精', () => {
  const chat = fixture({ threshold: 0.0001 });
  const result = pass(chat, 1);
  assert.equal(result.conceptionEvents.length, 1);
  base(chat).eggs = 1;
  pass(chat, 0.001); // 建立幸存新卵的真实锚点与统一入口元数据。
  for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
  const embryos = copy(profile(chat).pregnant.fetuses);
  assert.equal(embryos.length, 1);
  const ids = embryos[0].contactIds;
  assert.equal(clear(chat).applied, true);
  assert.deepEqual(profile(chat).pregnant.fetuses, embryos);
  assert.ok(base(chat).spermContacts.some((source) => ids.includes(source.id) && source.value === 0));
  assert.deepEqual(pass(chat, 1).conceptionEvents, []);
  assert.deepEqual(profile(chat).pregnant.fetuses, embryos);
  empty(chat);
});

test('默认模式仍通过同一清空工具保持正常，不自动启用混合池', () => {
  const chat = fixture({ pooled: false });
  assert.equal(clear(chat).applied, true);
  assert.equal(base(chat).spermPool, undefined);
  assert.deepEqual(base(chat).sperms, []);
  for (const minute of [1, 60]) {
    const result = pass(chat, minute);
    assert.equal('conceptionEvents' in result, false);
    assert.deepEqual(base(chat).sperms, []);
    assert.deepEqual(profile(chat).pregnant.fetuses, []);
  }
});

test('默认模式清空后立即启用混合池，也不从历史接触恢复已清残留', () => {
  const chat = fixture({ pooled: false });
  const contacts = copy(base(chat).spermContacts);
  assert.equal(clear(chat).applied, true);
  assert.deepEqual(base(chat).spermContacts, contacts.map((source) => ({ ...source, value: 0 })));
  enablePooledConception(base(chat), chat.minutesPassed, { seed: '默认清空后启用' });
  for (const egg of base(chat).spermPool.eggs) egg.threshold = egg.remainingHazard = 1e-6;
  assert.deepEqual(pass(chat, 1).conceptionEvents, []);
  empty(chat);
  assert.deepEqual(profile(chat).pregnant.fetuses, []);
});

test('执行清空按钮原始控制器，实际工具归零后才记快照、保存与刷新', () => {
  const controller = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = controller.indexOf('function clearSelectedTrackContainer(ctx, container) {');
  const end = controller.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const body = controller.slice(start, end);
  const chat = fixture();
  pass(chat, 0.25);
  const sourceId = base(chat).spermContacts[0].id;
  const effects = [];
  // 执行仓库真实控制器及分派器；仅替代UI宿主的保存/刷新，不冒充浏览器端到端。
  const handler = new Function('applyToolCall', 'getSettings', 'getChatState', 'selectedTrackName',
    'recordChatStateSnapshot', 'saveSettings', 'renderStatusPanel', 'renderFullStatePage', 'globalThis',
    `${body}\nreturn clearSelectedTrackContainer;`)(applyToolCall, () => ({}), () => chat, '母方',
    (ctx, current, options) => {
      empty(current);
      assert.equal(base(current).spermPool.segment, undefined);
      assert.equal(options.reason, 'debug_clear_sperms');
      state.recordChatStateSnapshot(ctx, current, options);
      effects.push('snapshot');
    }, () => effects.push('save'), () => effects.push('status'), () => effects.push('full'),
    { toastr: { success: () => effects.push('success'), warning: () => assert.fail('应成功清空') } });
  handler({ chatId: 'clear-sperm-ui', chat: [{ mes: '清空', name: '母方', is_user: false }] }, 'sperms');
  assert.deepEqual(effects, ['snapshot', 'save', 'status', 'full', 'success']);
  const historical = state.getSnapshotCharacter(copy(chat), 0, '母方');
  assert.deepEqual(historical.profile.base.sperms, []);
  assert.ok(historical.profile.base.spermContacts.some((source) => source.id === sourceId && source.value === 0));
  assert.deepEqual(pass(chat, 1).conceptionEvents, []);
  empty(chat);
});
