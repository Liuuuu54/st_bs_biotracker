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
              { id: 1, name: '白色连身裙', note: '及膝雪纺，方领。', slot: 'main', parts: ['连身裙'], masking: 6, support: 4, capacity: 3, convenience: 5 },
              { id: 2, name: '衬衫牛仔裤', note: '白衬衫配直筒牛仔裤。', slot: 'main', parts: ['白衬衫', '牛仔裤'], masking: 7, support: 5, capacity: 4, convenience: 7 },
              { id: 3, name: '蕾丝内衣', note: '浅色蕾丝，贴身。', slot: 'accessory', layer: 'inner', masking: 0, support: 2, capacity: 0, convenience: 0 },
              { id: 4, name: '针织外套', note: '米色开衫。', slot: 'accessory', masking: 2, support: 0, capacity: 0, convenience: 0 },
            ],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [3, 4], temporaryItems: [], wearState: '敞开', pregFit: null },
        },
      }),
      贝拉: makeCharacter('贝拉', {
        base: { stage: '产后恢复', days: 10, isHere: true, age: 27 },
        profile: {
          wardrobe: {
            enabled: true,
            items: [{ id: 1, name: '孕妇裙', note: '高腰伞形。', slot: 'main', masking: 6, support: 5, capacity: 8, convenience: 6 }],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [], temporaryItems: [], wearState: '整齐', pregFit: null },
        },
      }),
      幕外子: makeCharacter('幕外子', {
        base: { stage: '黄体期', days: 2, isHere: false },
        profile: {
          wardrobe: {
            enabled: true,
            items: [{ id: 1, name: '和服', note: '藏青碎花。', slot: 'main', masking: 8, support: 3, capacity: 5, convenience: 3 }],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [], temporaryItems: [], wearState: '整齐', pregFit: null },
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

test('tracker regex cleaning covers character cards and worldbook prose, not only chat messages', () => {
  const ctx = makeContext();
  ctx.characterId = 0;
  ctx.characters = [{
    name: '艾拉',
    description: '<roleplay_guidelines>remove this</roleplay_guidelines>保留角色资料',
    personality: '冷静<hidden>remove this too</hidden>可靠',
    scenario: '客厅',
    first_mes: '<hidden>开场格式</hidden>你好',
    mes_example: '示例',
    worldBook: {
      entries: [{ comment: '条目名称', content: '<hidden>世界书格式</hidden>保留世界书正文' }],
    },
  }];
  const settings = state.getSettings(ctx);
  settings.recentMessageRegexFilter = '<(?:roleplay_guidelines|hidden)>[\\s\\S]*?<\\/(?:roleplay_guidelines|hidden)>';
  settings.recentMessageRegexMode = 'exclude';

  const payload = buildTrackerPayload(ctx, settings);

  assert.equal(payload.current_character.description, '保留角色资料');
  assert.equal(payload.character_description, '保留角色资料', 'duplicate description uses the same cleaned value');
  assert.equal(payload.current_character.personality, '冷静可靠');
  assert.equal(payload.current_character.first_mes, '你好');
  assert.equal(payload.current_character.worldBook.entries[0].content, '保留世界书正文');
  assert.equal(payload.current_character.worldBook.entries[0].comment, '条目名称', 'worldbook labels remain usable');
});

test('tracker payload sends slim wardrobe outside the wear-fit window with parts/layer intact', () => {
  const ctx = makeContext();
  const payload = buildTrackerPayload(ctx, state.getSettings(ctx));
  assert.equal(payload.wardrobe_enabled, true);

  const aila = payload.existing_state['艾拉'];
  const dress = aila.profile.wardrobe.items.find((item) => item.id === 1);
  assert.equal(dress.masking, undefined, 'non-pregnancy payload omits the four dimensions');
  assert.equal(dress.note, '及膝雪纺，方领。', 'note is kept for narrative use');
  assert.deepEqual(dress.parts, ['连身裙']);
  const innerwear = aila.profile.wardrobe.items.find((item) => item.id === 3);
  assert.equal(innerwear.layer, 'inner');
  assert.equal(aila.profile.outfit.wearState, '敞开');
  assert.equal(aila.profile.outfit.currentWearText, '白色连身裙（敞开） + 针织外套（内着：蕾丝内衣）');
});

test('tracker payload keeps four dimensions and pregFit inside the wear-fit window', () => {
  const ctx = makeContext();
  const settings = state.getSettings(ctx);
  // pregFit 是惰性刷新：由工具执行（bsPassedTime/bsChangeOutfit 等）触发，payload 只序列化。
  applyToolCallsResult(ctx, { tool_calls: [{ name: 'bsChangeOutfit', arguments: { female: '贝拉', mainItemId: 1 } }] });
  const payload = buildTrackerPayload(ctx, settings);
  const bella = payload.existing_state['贝拉'];
  const dress = bella.profile.wardrobe.items.find((item) => item.id === 1);
  assert.equal(dress.masking, 6, 'postpartum characters keep the four dimensions');
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
  assert.match(prompt, /换装触发规则/);
  assert.match(prompt, /整齐\/凌乱\/敞开\/半褪\/撩起/, 'wearState vocabulary is included');
  assert.match(prompt, /铸造新的组合主件/, 'lazy combination rule is included');

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
