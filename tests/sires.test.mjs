// 精方档案（1.2.0）：顶层 sires、v8 → v9 迁移、楼层快照与卵方一样还原；扶她读卵方。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { normalizeSireRecord, normalizeSires, resolveSireBase } from '../scripts/sires.js';

const ctxOf = (chatId) => ({ chatId, chat: [{ name: 'A', is_user: false, mes: '……' }], characters: [], name1: '用户', name2: 'A', extensionSettings: {}, saveSettingsDebounced() {} });

test('新聊天有空的精方表，存档版本 10', () => {
  const chat = state.createEmptyChatState();
  assert.equal(chat.schemaVersion, 11);
  assert.equal(Object.getPrototypeOf(chat.sires), null);
  assert.deepEqual(Object.keys(chat.sires), []);
});

test('v8 存档迁移到最新版：补上空精方表，旧快照还原成空表', () => {
  const ctx = ctxOf('sire-migrate');
  globalThis.SillyTavern = { getContext: () => ctx };
  const settings = state.getSettings(ctx);
  const old = state.createEmptyChatState();
  old.schemaVersion = 8;
  delete old.sires;
  state.recordChatStateSnapshot(ctx, old, { messageCount: 1, reason: 'old' });
  settings.chatStates[ctx.chatId] = old;
  const migrated = state.getChatState(ctx, settings);
  assert.equal(migrated.schemaVersion, 11);
  assert.equal(Object.getPrototypeOf(migrated.sires), null);
  state.restoreChatStateFromSnapshot(migrated, migrated.snapshots[0]);
  assert.deepEqual(Object.keys(migrated.sires), []);
});

test('精方进楼层快照，回溯后照样还原', () => {
  const ctx = ctxOf('sire-snapshot');
  const chat = state.createEmptyChatState();
  chat.sires['凯'] = normalizeSireRecord({ race: '精灵', age: 120, bodySize: 4.5, spermQuality: 2 });
  state.recordChatStateSnapshot(ctx, chat, { messageCount: 1, reason: 'registry' });
  delete chat.sires['凯'];
  chat.sires['路人'] = normalizeSireRecord({ race: '人类' });
  state.restoreChatStateFromSnapshot(chat, chat.snapshots.at(-1));
  assert.deepEqual(Object.keys(chat.sires), ['凯']);
  assert.equal(chat.sires['凯'].race, '精灵');
  assert.equal(chat.sires['凯'].spermQuality, 2);
  assert.equal(chat.sires['凯'].bodySize, 4.5);
});

test('档案正规化：种族解析衍生前缀，品质夹在 0.25–4，名字作键且是 null-proto', () => {
  const record = normalizeSireRecord({ race: '[血族]人类', spermQuality: 9, isHere: false, descriptions: { normalDescription: { 外貌: '银发' } } });
  assert.equal(record.race, '人类');
  assert.equal(record.derivedType, '血族');
  assert.equal(record.spermQuality, 4);
  assert.equal(record.isHere, false);
  assert.deepEqual(record.descriptions.normalDescription.map((x) => [x.name, x.value]), [['外貌', '银发']]);
  const sires = normalizeSires({ ' 凯 ': { race: '人类' }, constructor: { race: '人类' } });
  assert.equal(Object.getPrototypeOf(sires), null);
  assert.deepEqual(Object.keys(sires).sort(), ['constructor', '凯'].sort());
});

test('扶她：同名卵方优先，种族与体型读卵方，品质读精方档案', () => {
  const chat = state.createEmptyChatState();
  const futa = state.createDefaultFemaleState('莉娅');
  futa.profile.base.race = '媚魔';
  futa.profile.base.bodySize = 3.5;
  chat.characters['莉娅'] = futa;
  chat.sires['莉娅'] = normalizeSireRecord({ race: '人类', bodySize: 6, spermQuality: 3 });
  const resolved = resolveSireBase(chat, '莉娅');
  assert.equal(resolved.kind, 'character');
  assert.equal(resolved.base.race, '媚魔');
  assert.equal(resolved.base.bodySize, 3.5);
  assert.equal(resolved.spermQuality, 3);
  assert.equal(resolveSireBase(chat, '没人'), null);
});

// ── 工具接上精方档案 ──────────────────────────────
import { applyToolCall } from '../scripts/tools.js';

function chatWithSire(sire = {}) {
  const chat = state.createEmptyChatState();
  const mother = state.createDefaultFemaleState('艾拉');
  mother.initialized = true;
  mother.profile.base.age = 24;
  mother.profile.base.race = '人类';
  mother.profile.base.bodySize = 4;
  chat.characters['艾拉'] = mother;
  chat.sires['凯'] = normalizeSireRecord({ race: '[血族]精灵', bodySize: 5, ...sire });
  return chat;
}
const call = (chat, name, args) => applyToolCall(chat, { name, arguments: args });

test('bsAddSperm 命中精方档案：种族、衍生类型、体型由档案带入，传入不同的种族以档案为准', () => {
  const chat = chatWithSire();
  const inserted = call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '人类', action: 'insert', amount: 0 });
  assert.match(inserted.message, /种族以档案的 精灵 为准（本次传入 人类）/);
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'deposit', amount: 20 });
  const sperm = chat.characters['艾拉'].profile.base.sperms[0];
  assert.equal(sperm.race, '精灵');
  assert.equal(sperm.derivedType, '血族');
  assert.equal(sperm.bodySize, 5);
});

test('精方档案没填体型时，接受本次的 maleBodySize', () => {
  const chat = chatWithSire({ bodySize: null });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'insert', amount: 0, maleBodySize: 6 });
  call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', action: 'deposit', amount: 20 });
  assert.equal(chat.characters['艾拉'].profile.base.sperms[0].bodySize, 6);
});

test('bsSetCharacterPresence 能切精方的在场；扶她两边都有时只切卵方', () => {
  const chat = chatWithSire();
  assert.equal(call(chat, 'bsSetCharacterPresence', { female: '凯', isPresent: false }).applied, true);
  assert.equal(chat.sires['凯'].isHere, false);
  chat.sires['艾拉'] = normalizeSireRecord({ race: '人类' });
  call(chat, 'bsSetCharacterPresence', { female: '艾拉', isPresent: false });
  assert.equal(chat.characters['艾拉'].profile.base.isHere, false);
  assert.equal(resolveSireBase(chat, '艾拉').base.isHere, false, '扶她的精方在场读卵方');
});

test('bsSetDescription 查不到卵方时更新精方的 normalDescription；精方没有孕期描述', () => {
  const chat = chatWithSire();
  const created = call(chat, 'bsSetDescription', { female: '凯', options: { normalDescription: { 外貌: '银发、左脸有疤', 行动: '靠在门边' } } });
  assert.equal(created.applied, true);
  assert.deepEqual(chat.sires['凯'].descriptions.normalDescription.map((x) => x.name), ['外貌', '行动']);
  call(chat, 'bsSetDescription', { female: '凯', options: { normalDescription: { 行动: '走进屋里' } } });
  assert.equal(chat.sires['凯'].descriptions.normalDescription.find((x) => x.name === '行动').value, '走进屋里');
  assert.equal(call(chat, 'bsSetDescription', { female: '凯', options: { pregnantDescription: { 胎况: 'x' } } }).applied, false);
});

// ── 提示词：只送这一轮用得到的精方 ──────────────────────
import { buildSirePromptEntries } from '../scripts/sires.js';
import { buildMainFlowStatePrompt, buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';
import { DEFAULT_REGISTRY_DESCRIPTION_GUIDES } from '../scripts/registry_config.js';
import { parseDescriptionGuideFields, stripDescriptionGuideStars } from '../scripts/descriptions.js';

const GUIDE = DEFAULT_REGISTRY_DESCRIPTION_GUIDES.sireDescription;

test('范本的 * 标记：预设只有行动要即时追踪，给模型看时拿掉 *', () => {
  assert.deepEqual(parseDescriptionGuideFields(GUIDE), [
    { name: '外貌', starred: false }, { name: '性器', starred: false }, { name: '行动', starred: true },
  ]);
  assert.ok(!stripDescriptionGuideStars(GUIDE).includes('*'));
});

test('在场精方带描述，只点名带 * 的旧字段；不在场的只在相关时送摘要；扶她不重复', () => {
  const chat = chatWithSire({ descriptions: { normalDescription: [
    { name: '外貌', value: '银发', updatedAt: 0 }, { name: '行动', value: '靠在门边', updatedAt: 0 },
  ] } });
  chat.minutesPassed = 3000;
  chat.sires['路人甲'] = normalizeSireRecord({ race: '人类', isHere: false });
  chat.sires['胎父'] = normalizeSireRecord({ race: '欧克', isHere: false });
  chat.sires['被提到'] = normalizeSireRecord({ race: '矮人', isHere: false });
  chat.sires['艾拉'] = normalizeSireRecord({ race: '人类' });
  chat.characters['艾拉'].profile.pregnant.fetuses = [{ fathers: '胎父', embryoId: 1 }];
  const entries = buildSirePromptEntries(chat, { recentText: '被提到的那个人来了', guide: GUIDE });
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.deepEqual(Object.keys(byName).sort(), ['凯', '胎父', '被提到'].sort());
  assert.equal(byName['凯'].race, '[血族]精灵');
  assert.deepEqual(byName['凯'].descriptions, { 外貌: '银发', 行动: '靠在门边' });
  assert.deepEqual(byName['凯'].staleFields, ['行动'], '外貌没带 *，不点名');
  assert.equal(byName['胎父'].isHere, false);
  assert.equal(byName['胎父'].descriptions, undefined, '不在场不送描述');
});

test('追踪提示说明精方用法并点名旧字段；主流只看在场精方、不带点名', () => {
  const payload = {
    existing_state: { 艾拉: { name: '艾拉', profile: {} } },
    registered_sires: [
      { name: '凯', race: '精灵', isHere: true, descriptions: { 行动: '靠在门边' }, staleFields: ['行动'] },
      { name: '远方客', race: '欧克', isHere: false },
    ],
  };
  const tracker = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload);
  assert.match(tracker, /\[已注册精方\]/);
  assert.match(tracker, /描述还空着时按这些字段名建立：外貌、性器、行动/);
  assert.match(tracker, /- 凯（精方） normalDescription：行动/);
  const mainflow = buildMainFlowStatePrompt(payload);
  assert.match(mainflow, /\[在场精方\]/);
  assert.ok(mainflow.includes('"name":"凯"'));
  assert.ok(!mainflow.includes('远方客'), '主流不送不在场的精方');
  assert.ok(!mainflow.includes('staleFields'));
});

test('没有精方时两边都不多一段', () => {
  const payload = { existing_state: { 艾拉: { name: '艾拉', profile: {} } }, registered_sires: [] };
  assert.ok(!buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload).includes('已注册精方'));
  assert.ok(!buildMainFlowStatePrompt(payload).includes('在场精方'));
});

// ── 注册页：建立、更新、删除 ──────────────────────────
import { deleteSireRecord, formatSireRaceDescriptor, upsertSireRecord } from '../scripts/sires.js';

test('种族栏来回：明确比例的混血与衍生前缀存回去不变', () => {
  for (const race of ['[血族]精灵25%x人类75%', '人类', '[不死-僵尸]人类']) {
    assert.equal(formatSireRaceDescriptor(normalizeSireRecord({ race })), race);
  }
});

test('建立后更新：没改的描述字段保留原本的更新时间，改过的才刷新', () => {
  const chat = state.createEmptyChatState();
  chat.minutesPassed = 100;
  assert.equal(upsertSireRecord(chat, '', {}).applied, false);
  const created = upsertSireRecord(chat, '凯', { race: '[血族]精灵', age: 120, bodySize: 5, isHere: true, descriptions: [{ name: '外貌', value: '银发' }, { name: '行动', value: '靠在门边' }] });
  assert.equal(created.created, true);
  assert.equal(chat.sires['凯'].derivedType, '血族');
  chat.minutesPassed = 900;
  upsertSireRecord(chat, '凯', { race: '[血族]精灵', age: 120, bodySize: 5, isHere: false, descriptions: [{ name: '外貌', value: '银发' }, { name: '行动', value: '走进屋里' }] });
  const list = chat.sires['凯'].descriptions.normalDescription;
  assert.equal(list.find((x) => x.name === '外貌').updatedAt, 100);
  assert.equal(list.find((x) => x.name === '行动').updatedAt, 900);
  assert.equal(chat.sires['凯'].isHere, false);
  assert.equal(chat.sires['凯'].createdAt, 100);
  assert.equal(deleteSireRecord(chat, '凯').applied, true);
  assert.deepEqual(Object.keys(chat.sires), []);
});

test('扶她建精方档案：只存精方专属栏位，不另存种族与描述', () => {
  const chat = state.createEmptyChatState();
  chat.characters['莉娅'] = state.createDefaultFemaleState('莉娅');
  const result = upsertSireRecord(chat, '莉娅', { race: '欧克', descriptions: [{ name: '外貌', value: 'x' }] });
  assert.match(result.message, /扶她/);
  assert.deepEqual(chat.sires['莉娅'].descriptions.normalDescription, []);
  assert.equal(chat.sires['莉娅'].race, '人类');
});

test('变量页的快照历史：读得到当时的精方档案，旧快照没有就是 null', () => {
  const ctx = ctxOf('sire-history');
  const chat = state.createEmptyChatState();
  state.recordChatStateSnapshot(ctx, chat, { messageCount: 1, reason: 'before' });
  chat.sires['凯'] = normalizeSireRecord({ race: '精灵', age: 120 });
  state.recordChatStateSnapshot(ctx, chat, { messageCount: 2, reason: 'registry_sire' });
  chat.sires['凯'].age = 99;
  assert.equal(state.getSnapshotSire(chat, 0, '凯'), null);
  assert.equal(state.getSnapshotSire(chat, 1, '凯').age, 120);
});

test('逐角色检查清单也列在场精方，提醒离场要切', () => {
  const payload = {
    existing_state: { 艾拉: { name: '艾拉', profile: {} } },
    tracked_females: ['艾拉'],
    registered_sires: [{ name: '凯', race: '人类', isHere: true }, { name: '远方客', race: '欧克', isHere: false }],
  };
  const tracker = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload);
  assert.match(tracker, /在场精方也各列一笔：凯。/);
  assert.match(tracker, /bsSetCharacterPresence\(isPresent=false\)/);
});

// ── 即时字段（带 * 的字段每轮提醒）──────────────────────
test('卵方预设的表情、行动带 *；注册提示看不到 *', async () => {
  const { buildRegistrySystemPrompt } = await import('../scripts/registry.js');
  const fields = parseDescriptionGuideFields(DEFAULT_REGISTRY_DESCRIPTION_GUIDES.normalDescription);
  assert.deepEqual(fields.filter((field) => field.starred).map((field) => field.name), ['状态', '表情', '行动']);
  const prompt = buildRegistrySystemPrompt({}, { payload: { target_character: '艾拉' } });
  assert.ok(prompt.includes('表情|'));
  assert.ok(!prompt.includes('*表情'));
});

test('追踪提示每轮列在场角色的即时字段，只列她真的有的字段；离场的注明若本轮登场', () => {
  const payload = {
    existing_state: {
      艾拉: { name: '艾拉', profile: { base: { isHere: true }, descriptions: { normalDescription: { 状态: 'x', 行动: 'y' } } } },
      远行: { name: '远行', offscreen: true, profile: { descriptions: { normalDescription: { 行动: 'z' } } } },
    },
    registered_sires: [{ name: '凯', race: '人类', isHere: true, descriptions: { 外貌: 'a', 行动: 'b' } }],
  };
  const tracker = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload);
  assert.match(tracker, /\[即时字段\]/);
  assert.match(tracker, /- 艾拉：状态、行动\n/);
  assert.match(tracker, /- 凯（精方）：行动/);
  assert.match(tracker, /- 远行（不在场，若本轮登场）：状态、表情、行动/);
});

test('即时字段：描述还空着的在场角色不列，免得违反不新增字段的规则', () => {
  const payload = { existing_state: { 空白: { name: '空白', profile: { base: { isHere: true }, descriptions: { normalDescription: {} } } } } };
  assert.ok(!buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload).includes('[即时字段]'));
});

test('设定里存的是没改过的旧卵方预设就换成新的；改过的不动', async () => {
  const { LEGACY_NORMAL_DESCRIPTION_GUIDE } = await import('../scripts/registry_config.js');
  const fresh = (guide) => {
    const ctx = { chatId: `guide-${Math.random()}`, chat: [], characters: [], extensionSettings: { bs_biotracker: { registryDescriptionGuides: { normalDescription: guide } } }, saveSettingsDebounced() {} };
    return state.getSettings(ctx).registryDescriptionGuides.normalDescription;
  };
  assert.equal(fresh(LEGACY_NORMAL_DESCRIPTION_GUIDE), DEFAULT_REGISTRY_DESCRIPTION_GUIDES.normalDescription);
  assert.equal(fresh('我的字段|自己写的'), '我的字段|自己写的');
});

test('孕态预设改成五栏，动作、反应带 *；初始化规范与即时字段都不露 *，字段名带 * 也照常写入', async () => {
  const { applyDescriptionPatch } = await import('../scripts/descriptions.js');
  const fields = parseDescriptionGuideFields(DEFAULT_REGISTRY_DESCRIPTION_GUIDES.pregnantDescription);
  assert.deepEqual(fields.map((field) => field.name), ['供养', '动作', '反应', '风险', '护理']);
  assert.deepEqual(fields.filter((field) => field.starred).map((field) => field.name), ['动作', '反应']);
  const payload = {
    existing_state: { 艾拉: { name: '艾拉', profile: { base: { isHere: true, stage: '孕中期' }, descriptions: { normalDescription: { 行动: 'x' }, pregnantDescription: { 动作: 'y', 风险: 'z' } } } } },
  };
  const tracker = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, payload);
  assert.match(tracker, /- 艾拉：行动；pregnantDescription 动作/);
  const patched = applyDescriptionPatch([{ name: '动作', value: '旧', updatedAt: 0 }], { '*动作': '新' }, 10);
  assert.equal(patched.list[0].value, '新');
});

test('没改过的旧孕态预设换成新的五栏', async () => {
  const { LEGACY_PREGNANT_DESCRIPTION_GUIDE } = await import('../scripts/registry_config.js');
  const ctx = { chatId: 'guide-preg', chat: [], characters: [], extensionSettings: { bs_biotracker: { registryDescriptionGuides: { pregnantDescription: LEGACY_PREGNANT_DESCRIPTION_GUIDE } } }, saveSettingsDebounced() {} };
  assert.equal(state.getSettings(ctx).registryDescriptionGuides.pregnantDescription, DEFAULT_REGISTRY_DESCRIPTION_GUIDES.pregnantDescription);
});

// ── 先天天赋：受孕时父母各承接 25% ──────────────────────
test('先天天赋：父母同一技能各 25% 相加，正负都算，归零的不留', async () => {
  const { seedInnateTalents, talentStateToPoints } = await import('../scripts/skill_config.js');
  const mother = [{ skillId: 1, level: 1, exp: 0 }];                // +100 点
  const father = [{ skillId: 1, level: 1, exp: 0 }, { skillId: 2, level: -1, exp: 0 }];
  const seeded = seedInnateTalents(mother, father);
  const points = Object.fromEntries(seeded.map((talent) => [talent.skillId, talentStateToPoints(talent)]));
  assert.equal(points[1], 50);
  assert.equal(points[2], -25);
  assert.deepEqual(seedInnateTalents([], []), []);
});

test('自然受孕时胎儿带父母的先天天赋；精方档案的天赋、扶她读卵方', async () => {
  const { talentStateToPoints } = await import('../scripts/skill_config.js');
  const chat = chatWithSire({ talents: [{ skillId: 7, level: 2, exp: 0 }] });
  const mother = chat.characters['艾拉'].profile;
  mother.talents = [{ skillId: 7, level: 1, exp: 0 }];
  Object.assign(mother.base, { stage: '排卵期', days: 0, eggs: 1 });
  const original = Math.random;
  Math.random = () => 0;
  try {
    call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '精灵', action: 'insert', amount: 0 });
    call(chat, 'bsAddSperm', { female: '艾拉', male: '凯', race: '精灵', action: 'deposit', amount: 30 });
    call(chat, 'bsPassedTime', { hour: 12 });
  } finally {
    Math.random = original;
  }
  const fetus = chat.characters['艾拉'].profile.pregnant.fetuses[0];
  assert.ok(fetus, '应该受孕');
  // 母 Lv1 = 100 点，父 Lv2 = 200 点（talentLevelThreshold），各 25%：25 + 50 = 75
  assert.equal(talentStateToPoints(fetus.talents.find((talent) => talent.skillId === 7)), 75);
});

test('先建精方、后注册同名卵方（扶她）：精方档案清成只剩精子品质', async () => {
  const { applyRegistryResult } = await import('../scripts/registry.js');
  const chat = state.createEmptyChatState();
  chat.sires['莉娅'] = normalizeSireRecord({ race: '欧克', age: 40, bodySize: 6, spermQuality: 3, talents: [{ skillId: 1, level: 2, exp: 0 }], descriptions: { normalDescription: { 外貌: '旧的' } } });
  applyRegistryResult(chat, { name: '莉娅', profile: { base: { age: 22, race: '媚魔' } } });
  const sire = chat.sires['莉娅'];
  assert.equal(sire.spermQuality, 3);
  assert.equal(sire.race, '人类', '种族回到预设，实际读卵方');
  assert.equal(sire.age, null);
  assert.deepEqual(sire.talents, []);
  assert.deepEqual(sire.descriptions.normalDescription, []);
  assert.equal(resolveSireBase(chat, '莉娅').base.race, '媚魔');
});

test('没有在场精方时只送精简版说明；有在场的才送完整说明', () => {
  const base = { existing_state: { 艾拉: { name: '艾拉', profile: {} } } };
  const away = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, { ...base, registered_sires: [{ name: '胎父', race: '人类', isHere: false }] });
  assert.match(away, /都不在场，只是本轮相关者的摘要/);
  assert.match(away, /"isPresent":true/);
  assert.ok(!away.includes('virility 是精方精子品质'));
  const here = buildTrackerSystemPrompt('', DEFAULT_REGISTRY_DESCRIPTION_GUIDES, { ...base, registered_sires: [{ name: '凯', race: '人类', isHere: true }] });
  assert.ok(here.includes('virility 是精方精子品质'));
});
