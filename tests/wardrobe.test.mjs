import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWardrobeItemMetrics,
  getNextWardrobeItemId,
  normalizeTransientOutfitItems,
  normalizeWardrobeItem,
  normalizeWardrobeItemId,
  resolveWardrobeItemRef,
  sanitizeWearState,
} from '../scripts/wardrobe_config.js';
import { applyToolCall, TOOL_DEFINITIONS } from '../scripts/tools.js';
import { createEmptyChatState, normalizeCharacterPsychologyState } from '../scripts/state.js';
import { applyRegistryResult } from '../scripts/registry.js';

const REF_ITEMS = [
  { id: 0, name: '全裸', slot: 'main' },
  { id: 1, name: '白色连身裙', slot: 'main' },
  { id: 2, name: '针织外套', slot: 'accessory' },
  { id: 4, name: '病服', slot: 'main' },
];

test('resolveWardrobeItemRef resolves integer ids, digit strings and names', () => {
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, 1)?.name, '白色连身裙');
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '2')?.name, '针织外套');
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '白色连身裙')?.id, 1);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, ' 针织外套 ')?.id, 2);
});

test('resolveWardrobeItemRef resolves nude keyword and exact names without inventing ids', () => {
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, 'nude')?.id, 0);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '全裸')?.id, 0);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '病服')?.name, '病服');
  assert.equal(normalizeWardrobeItemId('病服'), null);
});

test('resolveWardrobeItemRef honors slot filter and rejects unknown refs', () => {
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '针织外套', 'main'), null);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '针织外套', 'accessory')?.id, 2);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, '不存在的衣物'), null);
  assert.equal(resolveWardrobeItemRef(REF_ITEMS, -1), null);
});

test('getNextWardrobeItemId increments past used integer ids', () => {
  assert.equal(getNextWardrobeItemId(REF_ITEMS), 5);
  assert.equal(getNextWardrobeItemId([]), 1);
  assert.equal(getNextWardrobeItemId([{ id: 1 }, { id: 2 }, { id: 3 }]), 4);
});

test('normalizeWardrobeItem maps semantic main tiers and accessory effects', () => {
  const missing = normalizeWardrobeItem(
    { name: '围裙', note: '', slot: 'accessory', category: 'outerwear', effects: ['capacity_up', 'support_up', 'masking_up'] },
    { allowMissingId: true },
  );
  assert.equal(missing.id, null);
  assert.equal(missing.category, 'outerwear');
  assert.deepEqual(missing.effects, ['capacity_up', 'support_up']);
  assert.equal(missing.capacity, 2);
  assert.equal(missing.support, 2);
  assert.equal(missing.masking, 0, 'accessory keeps at most two semantic effects');

  const main = normalizeWardrobeItem({ id: 5, name: '长裙', note: '', slot: 'main', fitProfile: { masking: 'high', support: 'strong', capacity: 'stretch', convenience: 'convenient' } });
  assert.deepEqual(getWardrobeItemMetrics(main), { masking: 8, support: 8, capacity: 7, convenience: 8 });
  assert.equal(normalizeWardrobeItem({ id: '5', name: '错误 id', note: '', slot: 'main', fitProfile: {} }), null);
});

test('wardrobe tool schemas expose only the semantic clothing contract', () => {
  const addProperties = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsAddWardrobeItem').input_schema.properties.item.properties;
  const changeProperties = TOOL_DEFINITIONS.find((tool) => tool.name === 'bsChangeOutfit').input_schema.properties;
  assert.deepEqual(addProperties.id, { type: 'integer', minimum: 1 });
  for (const field of ['masking', 'support', 'capacity', 'convenience', 'contour', 'unsupported', 'layer']) {
    assert.equal(Object.hasOwn(addProperties, field), false, field);
  }
  assert.equal(Object.hasOwn(changeProperties, 'temporaryItems'), false);
  assert.equal(Object.hasOwn(changeProperties, 'main'), true);
  assert.equal(Object.hasOwn(changeProperties, 'accessories'), true);
});

test('normalizeWardrobeItem keeps parts on mains and categories on accessories', () => {
  const main = normalizeWardrobeItem({ id: 1, name: '衬衫牛仔裤', note: '', slot: 'main', parts: ['白衬衫', '牛仔裤'], fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } });
  assert.deepEqual(main.parts, ['白衬衫', '牛仔裤']);

  const accessory = normalizeWardrobeItem({ id: 2, name: '蕾丝内衣', note: '', slot: 'accessory', category: 'underwear', effects: ['support_up'], parts: ['x'] });
  assert.equal(accessory.category, 'underwear');
  assert.equal(accessory.parts, undefined);
});

test('normalizeTransientOutfitItems drops the reserved id and duplicates', () => {
  const items = normalizeTransientOutfitItems([
    { id: 0, name: 'x', note: '', slot: 'main', fitProfile: {} },
    { id: 7, name: '病服', note: '', slot: 'main', fitProfile: { masking: 'low', support: 'none', capacity: 'loose', convenience: 'convenient' } },
    { id: 7, name: '重复', note: '', slot: 'main', fitProfile: {} },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 7);
  assert.equal(items[0].source, 'transient');
});

test('sanitizeWearState defaults, trims, strips separators and caps length', () => {
  assert.equal(sanitizeWearState(undefined), '整齐');
  assert.equal(sanitizeWearState('  湿透且衬衫紧贴身体十分狼狈不堪  '), '湿透且衬衫紧贴身体十分狼');
  assert.equal(sanitizeWearState('敞开|x;;y'), '敞开 x y');
});

test('registration records only a reliable current outfit and otherwise stays unknown', () => {
  const chatState = createEmptyChatState();
  const unknown = applyRegistryResult(chatState, { name: '未知子', profile: { base: { race: '人类' } } });
  assert.equal(unknown.profile.wardrobe.enabled, true);
  assert.equal(unknown.profile.outfit.mainItemId, null);

  const dressed = applyRegistryResult(chatState, { name: '有衣子', profile: { base: { race: '人类' }, currentOutfit: {
    main: { name: '日常套装', note: '白襯衫與長裙', parts: ['白襯衫', '長裙'], fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } },
    accessories: [{ name: '平底鞋', note: '', category: 'footwear', effects: [] }],
  } } });
  assert.equal(dressed.profile.wardrobe.items.some((item) => item.name === '日常套装'), true);
  assert.equal(dressed.profile.wardrobe.items.some((item) => item.name === '平底鞋'), true);
  assert.equal(dressed.profile.outfit.mainItemId, 1);
  assert.deepEqual(dressed.profile.outfit.accessoryItemIds, [2]);
});

function makeWardrobeState() {
  return {
    characters: {
      艾拉: {
        name: '艾拉',
        initialized: true,
        profile: {
          base: { stage: '卵泡期', days: 1, isHere: true },
          wardrobe: {
            enabled: true,
            items: [
              { id: 1, name: '白色连身裙', note: '', slot: 'main', parts: ['连身裙'], fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } },
              { id: 2, name: '蕾丝内衣', note: '', slot: 'accessory', category: 'underwear', effects: ['support_up'] },
              { id: 3, name: '针织外套', note: '', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] },
            ],
          },
          outfit: { mainItemId: 1, accessoryItemIds: [2, 3], transientItems: [], wearState: '整齐', pregFit: null },
        },
      },
    },
  };
}

test('bsChangeOutfit resolves existing and newly-created temporary items by name', () => {
  const state = makeWardrobeState();
  const result = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: '白色连身裙', accessoryItemIds: ['针织外套'] } });
  assert.equal(result.applied, true, result.message);
  assert.equal(state.characters['艾拉'].profile.outfit.mainItemId, 1);
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [3]);

  const temp = applyToolCall(state, {
    name: 'bsChangeOutfit',
    arguments: {
      female: '艾拉',
      scope: 'temporary',
      main: { name: '病服', note: '医院提供', fitProfile: { masking: 'low', support: 'none', capacity: 'loose', convenience: 'convenient' } },
    },
  });
  assert.equal(temp.applied, true, temp.message);
  assert.equal(state.characters['艾拉'].profile.outfit.transientItems.some((item) => item.name === '病服'), true);
});

test('bsChangeOutfit skips unknown references without changing the outfit', () => {
  const state = makeWardrobeState();
  const result = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: '不存在' } });
  assert.equal(result.applied, false);
  assert.match(result.message, /unknown main item/);
  assert.equal(state.characters['艾拉'].profile.outfit.mainItemId, 1);
});

test('bsAddWardrobeItem auto-assigns sequential ids and updates by name', () => {
  const state = makeWardrobeState();
  const added = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { name: '晨袍', note: '丝质', slot: 'main', fitProfile: { masking: 'low', support: 'none', capacity: 'stretch', convenience: 'convenient' } } } });
  assert.equal(added.applied, true, added.message);
  assert.match(added.message, /id=4/, 'omitted id gets the next sequential id');

  const updated = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { name: '白色连身裙', note: '加了蕾丝', slot: 'main', fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } } } });
  assert.equal(updated.applied, true, updated.message);
  assert.match(updated.message, /id=1/, 'name match updates the existing item');
  const dresses = state.characters['艾拉'].profile.wardrobe.items.filter((item) => item.name === '白色连身裙');
  assert.equal(dresses.length, 1, 'no duplicate item is created');
});

test('bsRemoveWardrobeItem removes by name and protects the reserved main', () => {
  const state = makeWardrobeState();
  const removed = applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '艾拉', itemId: '白色连身裙' } });
  assert.equal(removed.applied, true, removed.message);
  assert.equal(state.characters['艾拉'].profile.outfit.mainItemId, null, 'removed worn main becomes unknown, never inferred nude');

  assert.equal(applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '艾拉', itemId: 0 } }).applied, false);
  assert.equal(applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '艾拉', itemId: '全裸' } }).applied, false);
});

test('bsAddWardrobeItem with explicit ids creates, renames in place and rejects bad input', () => {
  const state = makeWardrobeState();
  const created = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { id: 7, name: '米色风衣', note: '长款。', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] } } });
  assert.equal(created.applied, true, created.message);
  assert.match(created.message, /id=7/, 'explicit integer id is honored');

  const renamed = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { id: 7, name: '驼色风衣', note: '长款。', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] } } });
  assert.equal(renamed.applied, true, renamed.message);
  const items = state.characters['艾拉'].profile.wardrobe.items;
  assert.equal(items.some((item) => item.name === '驼色风衣'), true, 'rename via id works');
  assert.equal(items.some((item) => item.name === '米色风衣'), false, 'old name is gone');
  assert.equal(items.filter((item) => item.id === 7).length, 1, 'no duplicate for the same id');

  const reserved = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { id: 0, name: '不该存在', note: '', slot: 'main', fitProfile: { masking: 'very_low', support: 'none', capacity: 'tight', convenience: 'inconvenient' } } } });
  assert.equal(reserved.applied, false);
  assert.match(reserved.message, /id=0 is reserved/);

  const invalid = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '艾拉', item: { note: '没有名字', slot: 'main', fitProfile: {} } } });
  assert.equal(invalid.applied, false);
  assert.match(invalid.message, /invalid item/);
});

test('bsRemoveWardrobeItem detaches worn accessories and reports missing items', () => {
  const state = makeWardrobeState();
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [2, 3], 'seed wears both accessories');
  const removed = applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '艾拉', itemId: 2 } });
  assert.equal(removed.applied, true, removed.message);
  assert.equal(state.characters['艾拉'].profile.wardrobe.items.some((item) => item.id === 2), false, 'item left the wardrobe');
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [3], 'worn accessory list drops the removed item');

  const missing = applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '艾拉', itemId: 99 } });
  assert.equal(missing.applied, false);
  assert.match(missing.message, /item not found/);
});

test('wardrobe tools lazily initialize characters without a prepared wardrobe', () => {
  const state = { characters: { 小北: { name: '小北', initialized: true, profile: { base: { stage: '卵泡期', days: 1, isHere: true } } } } };
  const add = applyToolCall(state, { name: 'bsAddWardrobeItem', arguments: { female: '小北', item: { name: '外套', note: '', slot: 'accessory', category: 'outerwear', effects: ['masking_up'] } } });
  assert.equal(add.applied, true, add.message);
  assert.equal(state.characters['小北'].profile.wardrobe.enabled, true);
  assert.equal(state.characters['小北'].profile.wardrobe.items.some((item) => item.name === '外套'), true);
  const remove = applyToolCall(state, { name: 'bsRemoveWardrobeItem', arguments: { female: '小北', itemId: 1 } });
  assert.equal(remove.applied, true, remove.message);
});

test('bsChangeOutfit atomically creates and wears owned or temporary semantic items', () => {
  const state = { characters: { 小北: { name: '小北', initialized: true, profile: { base: { stage: '卵泡期', days: 1, isHere: true } } } } };
  const owned = applyToolCall(state, { name: 'bsChangeOutfit', arguments: {
    female: '小北', scope: 'owned',
    main: { name: '襯衫短裙', note: '', parts: ['襯衫', '短裙'], fitProfile: { masking: 'low', support: 'normal', capacity: 'fitted', convenience: 'normal' } },
    accessories: [{ name: '短靴', note: '', category: 'footwear', effects: ['convenience_down'] }],
  } });
  assert.equal(owned.applied, true, owned.message);
  assert.equal(state.characters['小北'].profile.wardrobe.items.some((item) => item.name === '襯衫短裙'), true);
  assert.equal(state.characters['小北'].profile.outfit.accessoryItemIds.length, 1);

  const temporary = applyToolCall(state, { name: 'bsChangeOutfit', arguments: {
    female: '小北', scope: 'temporary',
    main: { name: '病服', note: '医院提供', fitProfile: { masking: 'low', support: 'none', capacity: 'loose', convenience: 'convenient' } },
  } });
  assert.equal(temporary.applied, true, temporary.message);
  assert.equal(state.characters['小北'].profile.outfit.transientItems.some((item) => item.name === '病服'), true);
  assert.equal(state.characters['小北'].profile.wardrobe.items.some((item) => item.name === '病服'), false);
});

test('bsChangeOutfit incremental accessory params put on and take off without restating the list', () => {
  const state = makeWardrobeState();
  // 穿上：现有 [2, 3]，按名称加上一件（复用 id 2 会被去重，模拟传错也安全）
  state.characters['艾拉'].profile.wardrobe.items.push(
    { id: 5, name: '猫咪短袜与运动鞋', note: '', slot: 'accessory', category: 'footwear', effects: ['convenience_down'] },
  );
  const putOn = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', addAccessoryItemIds: ['猫咪短袜与运动鞋'] } });
  assert.equal(putOn.applied, true, putOn.message);
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [2, 3, 5], 'shoes added without touching the rest');

  const takeOff = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', removeAccessoryItemIds: ['针织外套'] } });
  assert.equal(takeOff.applied, true, takeOff.message);
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [2, 5], 'only the coat came off');

  const dupAdd = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', addAccessoryItemIds: [2] } });
  assert.equal(dupAdd.applied, true);
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [2, 5], 'adding a worn item is a no-op');

  const removeUnworn = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', removeAccessoryItemIds: ['针织外套'] } });
  assert.equal(removeUnworn.applied, true, 'removing an unworn but known item is a no-op');

  const unknownAdd = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', addAccessoryItemIds: ['不存在的鞋'] } });
  assert.equal(unknownAdd.applied, false);
  assert.match(unknownAdd.message, /unknown accessory item/);

  // 与覆盖式同传时以 accessoryItemIds 为准
  const both = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', accessoryItemIds: [3], addAccessoryItemIds: [5] } });
  assert.equal(both.applied, true);
  assert.deepEqual(state.characters['艾拉'].profile.outfit.accessoryItemIds, [3], 'overwrite list wins over incremental params');

  // 增量穿脱不影响 wearState
  assert.equal(state.characters['艾拉'].profile.outfit.wearState, '整齐');
});

test('bsChangeOutfit wearState updates alone and resets only on main change', () => {
  const state = makeWardrobeState();
  const stateOnly = applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', wearState: '敞开' } });
  assert.equal(stateOnly.applied, true, stateOnly.message);
  assert.equal(state.characters['艾拉'].profile.outfit.wearState, '敞开');
  assert.equal(state.characters['艾拉'].profile.outfit.mainItemId, 1, 'main is untouched');

  applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', accessoryItemIds: [2] } });
  assert.equal(state.characters['艾拉'].profile.outfit.wearState, '敞开', 'accessory-only change keeps wearState');

  applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: 0 } });
  assert.equal(state.characters['艾拉'].profile.outfit.wearState, '整齐', 'main change resets wearState');

  applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: 1, wearState: '湿透' } });
  assert.equal(state.characters['艾拉'].profile.outfit.wearState, '湿透', 'explicit wearState wins over the reset');
});

function makePregnancyState(stage, days) {
  return {
    characters: {
      艾拉: {
        name: '艾拉',
        initialized: true,
        profile: {
          base: { stage, days, isHere: true },
          bio: {},
          wardrobe: {
            enabled: true,
            items: [{ id: 1, name: '孕妇裙', note: '', slot: 'main', fitProfile: { masking: 'medium', support: 'normal', capacity: 'stretch', convenience: 'normal' } }],
          },
          outfit: { mainItemId: 0, accessoryItemIds: [], transientItems: [], wearState: '整齐', pregFit: null },
        },
      },
    },
  };
}

test('postpartum pregFit pressure declines linearly with recovery progress', () => {
  const atDay = (days) => {
    const state = makePregnancyState('产后恢复', days);
    applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: 1 } });
    return state.characters['艾拉'].profile.outfit.pregFit;
  };
  assert.equal(atDay(0)?.pregWearPressure, 4, 'starts at the postpartum baseline');
  assert.equal(atDay(28)?.pregWearPressure, 2, 'halfway through recovery');
  assert.equal(atDay(56)?.pregWearPressure, 0, 'fully recovered');
  assert.equal(atDay(0)?.gap.masking, 2, 'gap subtracts pressure from outfit totals');
});

test('pregFit stays null outside the wear-fit window', () => {
  for (const stage of ['卵泡期', '假孕期']) {
    const state = makePregnancyState(stage, 3);
    applyToolCall(state, { name: 'bsChangeOutfit', arguments: { female: '艾拉', mainItemId: 1 } });
    assert.equal(state.characters['艾拉'].profile.outfit.pregFit, null, stage);
  }
});

test('state normalization leaves user description fields untouched', () => {
  const character = {
    name: '艾拉',
    profile: {
      base: { stage: '卵泡期' },
      descriptions: {
        normalDescription: '外貌|黑发碧眼;;衣着动态|裙摆被风吹起;;神态|微笑;;衣著自評|觉得很合身;;',
        pregnantDescription: '孕态|无;;衣着自评|旧数据;;',
      },
      wardrobe: { enabled: true, items: [{ id: 1, name: '连身裙', note: '', slot: 'main', fitProfile: { masking: 'medium', support: 'normal', capacity: 'fitted', convenience: 'normal' } }] },
      outfit: { mainItemId: 1, accessoryItemIds: [], transientItems: [], wearState: '敞开' },
    },
  };
  normalizeCharacterPsychologyState(character);
  assert.equal(character.profile.descriptions.normalDescription, '外貌|黑发碧眼;;衣着动态|裙摆被风吹起;;神态|微笑;;衣著自評|觉得很合身;;');
  assert.equal(character.profile.descriptions.pregnantDescription, '孕态|无;;衣着自评|旧数据;;');
  assert.equal(character.profile.outfit.wearState, '敞开', 'wearState survives normalization');

  const plain = { name: 'B', profile: { base: {}, descriptions: { normalDescription: '外貌|红发;;' } } };
  normalizeCharacterPsychologyState(plain);
  assert.equal(plain.profile.descriptions.normalDescription, '外貌|红发;;');
});
