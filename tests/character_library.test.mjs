// 全域角色库：卵方与精方的基础资料存在全域，别的聊天手动带入；进度不带。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { applyRegistryResult } from '../scripts/registry.js';
import { normalizeSireRecord, upsertSireRecord } from '../scripts/sires.js';
import { registerSkillDefinition, talentPointsToState, resolveSkillDefinition } from '../scripts/skill_config.js';
import { deleteLibraryEntry, importLibraryEntry, listLibraryEntries, saveEggToLibrary, saveSireToLibrary } from '../scripts/character_library.js';

function sourceChat() {
  const chatState = state.createEmptyChatState();
  const skill = registerSkillDefinition(chatState.skillCatalog, { name: '剑术', description: '用剑的本事' }, chatState.nextSkillId);
  chatState.skillCatalog = skill.catalog;
  chatState.nextSkillId = skill.nextSkillId;
  applyRegistryResult(chatState, {
    name: '露娜',
    profile: {
      base: { race: '1/4精灵x3/4人类', age: 24, bodySize: 3.8, sheathOffset: -0.5, vitalityLevel: 6, psyStressLevel: 3 },
      descriptions: { normalDescription: [{ name: '人外特征', value: '银发、尖耳' }, { name: '状态', value: '孕中期身子沉了几分' }, { name: '腹部', value: '高高隆起' }] },
      pregnant: { pregnantDays: 120, fetusesCount: 1, fetuses: [{ fathers: '雷恩', race: '人类', gender: '女', embryoType: '胎生' }] },
    },
  }, { random: () => 0.5 });
  const luna = chatState.characters.露娜.profile;
  luna.immune.miscarriage = true;
  luna.talents = [talentPointsToState(skill.definition.id, 300)];
  upsertSireRecord(chatState, '雷恩', { race: '人类', age: 30, bodySize: 4.5, spermQuality: 2, swordOffset: 1, alwaysPeak: true, fetalGuard: true, isHere: true,
    descriptions: [{ name: '外貌', value: '高大的旅人' }], talents: [talentPointsToState(skill.definition.id, -200)] });
  return chatState;
}

test('存入：卵方只存基础资料，精方存档案栏位；天赋换成技能名称', () => {
  const settings = {};
  const chatState = sourceChat();
  assert.equal(saveEggToLibrary(settings, chatState, '露娜').saved, true);
  assert.equal(saveSireToLibrary(settings, chatState, '雷恩').saved, true);
  const egg = settings.characterLibrary.露娜.egg;
  assert.deepEqual(egg.base.bloodline, { 精灵: 0.25, 人类: 0.75 });
  assert.equal(egg.base.vitalityLevel, 6);
  assert.equal(egg.immune.miscarriage, true);
  assert.deepEqual(egg.descriptions.normalDescription, [{ name: '人外特征', value: '银发、尖耳' }], '即时状态栏位不存');
  assert.equal(egg.talents[0].name, '剑术');
  assert.equal('pregnant' in egg, false, '进度不存');
  const sire = settings.characterLibrary.雷恩.sire;
  assert.equal(sire.spermQuality, 2);
  assert.equal(sire.fetalGuard, true);
  assert.equal('reserve' in sire || 'isHere' in sire || 'seasonOrigin' in sire, false);
  assert.deepEqual(listLibraryEntries(settings).map((item) => [item.name, Boolean(item.egg), Boolean(item.sire)]), [['雷恩', false, true], ['露娜', true, false]]);
  assert.equal(saveEggToLibrary(settings, chatState, '没人').saved, false);
});

test('带入：新聊天里卵方从头开始（没有怀孕），精方建档；天赋按名称接上这个聊天的技能', () => {
  const settings = {};
  const from = sourceChat();
  saveEggToLibrary(settings, from, '露娜');
  saveSireToLibrary(settings, from, '雷恩');
  const target = state.createEmptyChatState();
  const egg = importLibraryEntry(target, settings, '露娜', { random: () => 0.5 });
  assert.equal(egg.egg, true);
  const luna = target.characters.露娜;
  assert.equal(luna.initialized, true);
  assert.equal(luna.profile.base.race, '精灵x人类');
  assert.deepEqual(luna.profile.base.bloodline, { 精灵: 0.25, 人类: 0.75 });
  assert.equal(luna.profile.base.sheathOffset, -0.5);
  assert.equal((luna.profile.pregnant.fetuses || []).length, 0, '怀孕进度不带');
  assert.equal(luna.profile.immune.miscarriage, true);
  const skill = resolveSkillDefinition(target.skillCatalog, '剑术');
  assert.ok(skill, '这个聊天补上技能');
  assert.equal(luna.profile.talents[0].skillId, skill.id);
  const sire = importLibraryEntry(target, settings, '雷恩');
  assert.equal(sire.sire, true);
  const record = target.sires.雷恩;
  assert.equal(record.spermQuality, 2);
  assert.equal(record.alwaysPeak, true);
  assert.equal(record.fetalGuard, true);
  assert.equal(record.source, 'library');
  assert.equal(record.talents[0].skillId, skill.id);
});

test('这个聊天已有同名的部分不带入；扶她卵方与精方同一笔一起带', () => {
  const settings = {};
  const from = sourceChat();
  upsertSireRecord(from, '露娜', { spermQuality: 3, swordOffset: 0.5, fetalGuard: true });
  saveEggToLibrary(settings, from, '露娜');
  saveSireToLibrary(settings, from, '露娜');
  const target = state.createEmptyChatState();
  const result = importLibraryEntry(target, settings, '露娜', { random: () => 0.5 });
  assert.equal(result.egg, true);
  assert.equal(result.sire, true);
  assert.equal(target.sires.露娜.spermQuality, 3);
  assert.equal(target.sires.露娜.fetalGuard, true);
  const again = importLibraryEntry(target, settings, '露娜');
  assert.equal(again.egg || again.sire, false);
  assert.match(again.message, /已注册卵方 露娜/);
  assert.match(again.message, /已有精方 露娜/);
  assert.equal(deleteLibraryEntry(settings, '露娜'), true);
  assert.match(importLibraryEntry(target, settings, '露娜').message, /角色库里没有/);
});

test('旧版描述范本没有星号：预设范本的即时栏位照样不存', () => {
  const settings = { registryDescriptionGuides: { normalDescription: ['状态|总体状态', '表情|表情', '人外特征|尖耳'].join('\n') } };
  const chatState = sourceChat();
  saveEggToLibrary(settings, chatState, '露娜');
  assert.deepEqual(settings.characterLibrary.露娜.egg.descriptions.normalDescription.map((item) => item.name), ['人外特征']);
});

test('再存一次覆写那一部分，另一部分保留', () => {
  const settings = {};
  const from = sourceChat();
  saveSireToLibrary(settings, from, '雷恩');
  from.sires.雷恩 = normalizeSireRecord({ ...from.sires.雷恩, spermQuality: 3 });
  settings.characterLibrary.雷恩.egg = { base: { race: '人类' } };
  saveSireToLibrary(settings, from, '雷恩');
  assert.equal(settings.characterLibrary.雷恩.sire.spermQuality, 3);
  assert.deepEqual(settings.characterLibrary.雷恩.egg, { base: { race: '人类' } });
});
