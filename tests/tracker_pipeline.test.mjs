// 灰度（gray-box）测试：不打真实 LLM，但走真实的 payload 组装 → 系统提示词组装 →
// 模拟模型回应 → applyToolCallsResult 全管线，验证衣柜系统在“模型视角”下的输入输出。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { buildTrackerPayload } from '../scripts/tracker.js';
import { buildTrackerSystemPrompt } from '../scripts/tracker_prompt_context.js';
import { applyToolCallsResult } from '../scripts/tools.js';

const CHAT_KEY = 'pipeline-chat';

function makeCharacter(name, overrides = {}) {
  return {
    name,
    initialized: true,
    profile: {
      base: {
        stage: '卵泡期', days: 3, isHere: true, age: 24, race: '人类', derivedType: null,
        vitality: 80, libido: 20, uterinePressure: 10, psyStress: 30,
        vitalityLevel: 4, psyStressLevel: 4, eggs: 1, sperms: [],
        ...overrides.base,
      },
      bio: {},
      metabolism: { excretion: 20, hunger: 30, sleep: 10, milk: 5, odor: 10, companionship: 15 },
      descriptions: { normalDescription: '外貌|黑发碧眼;;', pregnantDescription: '' },
      diary: [],
      notify: {},
      ...overrides.profile,
    },
  };
}

function makeContext() {
  const chatState = {
    characters: {
      艾拉: makeCharacter('艾拉', {
        profile: {
          wardrobe: {
            enabled: true,
            items: [
              { id: 1, name: '白色连身裙', note: '及膝雪纺，方领。', slot: 'main', parts: ['连身裙'], fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } },
              { id: 2, name: '衬衫牛仔裤', note: '白衬衫配直筒牛仔裤。', slot: 'main', parts: ['白衬衫', '牛仔裤'], fitProfile: { masking: 'high', support: 'normal', capacity: 'fitted', convenience: 'convenient' } },
              { id: 3, name: '蕾丝内衣', note: '浅色蕾丝，贴身。', slot: 'accessory', category: 'underwear', effects: ['support_up'] },
              { id: 4, name: '针织外套', note: '米色开衫。', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] },
            ],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [3, 4], transientItems: [], wearState: '敞开', pregFit: null },
        },
      }),
      贝拉: makeCharacter('贝拉', {
        base: { stage: '产后恢复', days: 10, isHere: true, age: 27 },
        profile: {
          wardrobe: {
            enabled: true,
            items: [{ id: 1, name: '孕妇裙', note: '高腰伞形。', slot: 'main', fitProfile: { masking: 'medium', support: 'normal', capacity: 'stretch', convenience: 'normal' } }],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [], transientItems: [], wearState: '整齐', pregFit: null },
        },
      }),
      幕外子: makeCharacter('幕外子', {
        base: { stage: '黄体期', days: 2, isHere: false },
        profile: {
          wardrobe: {
            enabled: true,
            items: [{ id: 1, name: '和服', note: '藏青碎花。', slot: 'main', fitProfile: { masking: 'high', support: 'normal', capacity: 'fitted', convenience: 'inconvenient' } }],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [], transientItems: [], wearState: '整齐', pregFit: null },
        },
      }),
    },
    snapshots: [],
    lastOperationLogs: [],
  };
  const ctx = {
    chatId: CHAT_KEY,
    characters: [],
    chat: [
      { name: '用户', is_user: true, mes: '（雨越下越大）先进屋吧。' },
      { name: '艾拉', is_user: false, mes: '艾拉抱着湿透的外套点点头。' },
    ],
    name1: '用户',
    name2: '艾拉',
    extensionSettings: {
      bs_biotracker: { enabled: true, chatStates: { [CHAT_KEY]: chatState } },
    },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return ctx;
}

test('tracker payload sends a slim catalog and detailed current items outside the wear-fit window', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  settings.chatStates[CHAT_KEY].skillBaselinePrompt = '只追踪正格冒险技能。';
  const payload = buildTrackerPayload(ctx, settings);
  assert.equal(payload.wardrobe_enabled, true);
  assert.equal(payload.skill_baseline_prompt, '只追踪正格冒险技能。');

  const aila = payload.existing_state['艾拉'];
  const dress = aila.profile.wardrobe.items.find((item) => item.id === 1);
  assert.equal(dress.masking, undefined, 'non-pregnancy payload omits the four dimensions');
  assert.equal(dress.note, undefined, 'unworn catalog entries remain compact');
  const currentDress = aila.profile.outfit.currentItems.find((item) => item.id === 1);
  assert.equal(currentDress.note, '及膝雪纺，方领。', 'current item keeps narrative detail');
  assert.deepEqual(currentDress.parts, ['连身裙']);
  const innerwear = aila.profile.wardrobe.items.find((item) => item.id === 3);
  assert.equal(innerwear.category, 'underwear');
  assert.equal(aila.profile.outfit.wearState, '敞开');
  assert.equal(aila.profile.outfit.currentWearText, '白色连身裙（敞开） + 针织外套（内着：蕾丝内衣）');
});

test('tracker payload keeps four dimensions only on current items inside the wear-fit window', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  // pregFit 是惰性刷新：由工具执行（bsPassedTime/bsChangeOutfit 等）触发，payload 只序列化。
  applyToolCallsResult(ctx, { tool_calls: [{ name: 'bsChangeOutfit', arguments: { female: '贝拉', mainItemId: 1 } }] });
  const payload = buildTrackerPayload(ctx, settings);
  const bella = payload.existing_state['贝拉'];
  const dress = bella.profile.wardrobe.items.find((item) => item.id === 1);
  assert.equal(dress.masking, undefined, 'catalog stays slim even during postpartum');
  assert.equal(bella.profile.outfit.currentItems.find((item) => item.id === 1)?.masking, 6, 'current item keeps derived dimensions');
  assert.equal(typeof bella.profile.outfit.pregFit?.pregWearPressure, 'number', 'postpartum pregFit is computed');
  assert.equal(bella.profile.outfit.pregFit.pregWearPressure > 0, true, 'postpartum pressure is non-zero early in recovery');
});

test('offscreen characters get a slim wardrobe with outfit summary for re-entry changes', () => {
  const ctx = makeContext();
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  const off = payload.existing_state['幕外子'];
  assert.equal(off.offscreen, true);
  assert.equal(off.profile.wardrobe.items.some((item) => item.name === '和服'), true);
  assert.equal(off.profile.wardrobe.items[0].note, undefined, 'offscreen items stay slim');
  assert.equal(off.profile.outfit.currentWearText, '和服');
  assert.equal(off.profile.outfit.wearState, '整齐');
});

test('tracker system prompt carries the wardrobe rules only when a wardrobe exists', () => {
  const ctx = makeContext();
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  const prompt = buildTrackerSystemPrompt(state.DEFAULT_SYSTEM_PROMPT, null, payload);
  assert.match(prompt, /\[wardrobe \/ outfit\]/);
  assert.match(prompt, /衣柜无需预先准备/);
  assert.match(prompt, /mainItemId=null.*衣着未记录/);
  assert.match(prompt, /scope=owned/, 'atomic lazy creation rule is included');
  assert.match(prompt, /fitProfile/, 'semantic tier contract is included');
  assert.doesNotMatch(prompt, /配件单项只能 -3 到 3/);

  const disabled = buildTrackerSystemPrompt(state.DEFAULT_SYSTEM_PROMPT, null, { ...payload, wardrobe_enabled: false });
  assert.doesNotMatch(disabled, /\[wardrobe \/ outfit\]/);
});

test('a simulated model response drives the full apply pipeline and refreshes the payload', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  const simulatedModelReply = {
    tool_calls: [
      { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: '衬衫牛仔裤', accessoryItemIds: ['针织外套'], wearState: '湿透' } },
    ],
  };
  const { logs } = applyToolCallsResult(ctx, simulatedModelReply);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].applied, true, logs[0].message);

  const outfit = settings.chatStates[CHAT_KEY].characters['艾拉'].profile.outfit;
  assert.equal(outfit.mainItemId, 2, 'name reference resolved to the id');
  assert.deepEqual(outfit.accessoryItemIds, [4]);
  assert.equal(outfit.wearState, '湿透');

  const payload = buildTrackerPayload(ctx, settings);
  assert.equal(
    payload.existing_state['艾拉'].profile.outfit.currentWearText,
    '衬衫牛仔裤（湿透） + 针织外套',
    'next round the model sees the updated wear summary',
  );
});

test('conceptionCue lasts for one tracker result and never enters the model payload', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  const first = applyToolCallsResult(ctx, {
    tool_calls: [{
      name: 'bsImplantEmbryo',
      arguments: { female: '艾拉', provider: '委托者', race: '人类', fathers: '父方', fatherRace: '人类', count: 1 },
    }],
  });
  assert.equal(first.logs[0].applied, true, first.logs[0].message);
  assert.equal(settings.chatStates[CHAT_KEY].characters['艾拉'].profile.conceptionCue, 'surrogacy');
  state.setConceptionCue(settings.chatStates[CHAT_KEY].characters['艾拉'].profile, 'fertilization');
  assert.equal(settings.chatStates[CHAT_KEY].characters['艾拉'].profile.conceptionCue, 'surrogacy', 'lower-priority cue cannot hide the more specific image');
  assert.equal(buildTrackerPayload(ctx, settings).existing_state['艾拉'].profile.conceptionCue, undefined);

  applyToolCallsResult(ctx, { tool_calls: [] });
  assert.equal(settings.chatStates[CHAT_KEY].characters['艾拉'].profile.conceptionCue, null);
});

test('empty description patches are a no-op instead of wiping the field', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  const before = settings.chatStates[CHAT_KEY].characters['艾拉'].profile.descriptions.normalDescription;
  assert.equal(before.length > 0, true, 'seed has content to protect');
  applyToolCallsResult(ctx, {
    tool_calls: [{ name: 'bsSetDescription', arguments: { female: '艾拉', options: { normalDescription: '' } } }],
  });
  assert.equal(
    settings.chatStates[CHAT_KEY].characters['艾拉'].profile.descriptions.normalDescription,
    before,
    'an empty-string patch must not erase the stored description',
  );
});

test('tracker prompt injects pregnantDescription initialization until the field is established', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);

  // 贝拉处于产后恢复且 pregnantDescription 为空 → 应注入初始化段与规范。
  // 注意：guide 常驻文本也提及「[pregnantDescription 初始化]」作为例外条款，
  // 因此这里匹配的是完整段落结构（标题 + 点名行），而不是裸标题字样。
  const INIT_SECTION = /\[pregnantDescription 初始化\]\n- 角色 /;
  const payload = buildTrackerPayload(ctx, settings);
  const prompt = buildTrackerSystemPrompt(state.DEFAULT_SYSTEM_PROMPT, settings.registryDescriptionGuides, payload);
  assert.match(prompt, INIT_SECTION);
  assert.match(prompt, /角色 贝拉 已进入/);
  assert.match(prompt, /供养/, 'the schema text is included');
  assert.doesNotMatch(prompt, /角色 [^\n]*艾拉/, 'non-pregnant characters are not named');

  // 建立首批子字段（空栏位首写路径）后 → 注入消失。
  const { logs } = applyToolCallsResult(ctx, {
    tool_calls: [{ name: 'bsSetDescription', arguments: { female: '贝拉', options: { pregnantDescription: '供养|胎盘已排出，子宫收缩恢复中;;症状|恶露仍未净;;' } } }],
  });
  assert.equal(logs[0].applied, true, logs[0].message);
  const nextPrompt = buildTrackerSystemPrompt(state.DEFAULT_SYSTEM_PROMPT, settings.registryDescriptionGuides, buildTrackerPayload(ctx, settings));
  assert.doesNotMatch(nextPrompt, INIT_SECTION);
});

test('a failed reference in a simulated reply is logged and leaves state untouched', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  const { logs } = applyToolCallsResult(ctx, {
    tool_calls: [{ name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: '不存在的衣服' } }],
  });
  assert.equal(logs[0].applied, false);
  assert.match(logs[0].message, /unknown main item/);
  assert.equal(settings.chatStates[CHAT_KEY].characters['艾拉'].profile.outfit.mainItemId, 1);
});

test('priority names focus the tracker without excluding other registered characters', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  settings.targetNames = '艾拉\n幕外子,不存在';

  const payload = buildTrackerPayload(ctx, settings);
  assert.deepEqual(payload.priority_character_names, ['艾拉', '幕外子']);
  assert.deepEqual(payload.tracked_females.sort(), ['艾拉', '贝拉', '幕外子'].sort());

  const prompt = buildTrackerSystemPrompt(state.DEFAULT_SYSTEM_PROMPT, null, payload);
  assert.match(prompt, /\[优先追踪角色\]/);
  assert.match(prompt, /艾拉、幕外子/);
  assert.match(prompt, /不是过滤器/);
  assert.match(prompt, /\[逐角色检查清单\]/);
  assert.match(prompt, /每名恰好一笔/);
});
