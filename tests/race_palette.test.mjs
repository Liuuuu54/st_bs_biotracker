import assert from 'node:assert/strict';
import test from 'node:test';
import { createRacePaletteSelection, appendRacePaletteTag, removeRacePaletteTag, equalizeRacePalette,
  setRacePalettePercent, buildRacePaletteValue } from '../scripts/race_palette.js';
import { parseRaceDescriptor } from '../scripts/race_config.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const total = state => Object.values(state.bloodline).reduce((a, b) => a + b, 0);

test('重新打开保留百分比、未知部分与衍生子项', () => {
  const state = createRacePaletteSelection('[血族-魔女]1/4精灵x3/4人类');
  assert.deepEqual(state.bloodline, {精灵:0.25,人类:0.75});
  assert.equal(buildRacePaletteValue(state), '[血族-魔女]精灵25%x人类75%');
  assert.deepEqual(createRacePaletteSelection('1/4精灵').bloodline, {精灵:0.25,未知:0.75});
});

test('加入种族按新份额缩放原比例，重复种族不产生额外份额', () => {
  const state = createRacePaletteSelection('精灵25%x人类75%');
  assert.equal(appendRacePaletteTag(state, '矮人'), true);
  close(state.bloodline.精灵 / state.bloodline.人类, 1/3);close(state.bloodline.矮人, 1/3);close(total(state), 1);
  assert.equal(appendRacePaletteTag(state, '矮人'), false);assert.equal(state.raceTags.length, 3);
});

test('调整精灵至25%，人类自动补足75%，保存文字可被正式解析器读取', () => {
  const state = createRacePaletteSelection('人类x精灵');
  assert.equal(setRacePalettePercent(state, 1, '25'), true);
  assert.deepEqual(parseRaceDescriptor(buildRacePaletteValue(state)).bloodline, {人类:0.75,精灵:0.25});
});

test('三种以上保留其他种族的相对比例，并可从100%重新分配', () => {
  const state = createRacePaletteSelection('精灵20%x人类60%x矮人20%');
  setRacePalettePercent(state, 2, 40);close(state.bloodline.精灵,0.15);close(state.bloodline.人类,0.45);close(total(state),1);
  setRacePalettePercent(state, 2, 100);assert.equal(buildRacePaletteValue(state),'矮人');
  setRacePalettePercent(state, 2, 0);close(state.bloodline.精灵,0.5);close(state.bloodline.人类,0.5);
});

test('移除成分重新归一化，剩余全零时均分，删除最后一项保持为空', () => {
  const state=createRacePaletteSelection('精灵25%x人类75%');removeRacePaletteTag(state,0);assert.equal(buildRacePaletteValue(state),'人类');
  appendRacePaletteTag(state,'精灵');setRacePalettePercent(state,1,100);removeRacePaletteTag(state,1);assert.equal(state.bloodline.人类,1);
  removeRacePaletteTag(state,0);assert.equal(buildRacePaletteValue(state),'');
});

test('空白、非数值与越界输入不会污染份额，单一成分固定100%', () => {
  const state=createRacePaletteSelection('精灵x人类');const before=structuredClone(state);
  for(const value of ['', ' ', 'oops', -1, 101, Infinity])assert.equal(setRacePalettePercent(state,0,value),false);
  assert.deepEqual(state,before);const pure=createRacePaletteSelection('人类');setRacePalettePercent(pure,0,25);assert.equal(pure.bloodline.人类,1);
});

test('平均分配与细小份额写回不会变成未知或丢失正比例成分', () => {
  const state=createRacePaletteSelection('精灵x人类x矮人');equalizeRacePalette(state);
  const parsed=parseRaceDescriptor(buildRacePaletteValue(state));assert.ok(!('未知' in parsed.bloodline));close(Object.values(parsed.bloodline).reduce((a,b)=>a+b,0),1);
  setRacePalettePercent(state,0,0.00000001);const tiny=parseRaceDescriptor(buildRacePaletteValue(state));assert.ok(tiny.bloodline.精灵>0);close(tiny.bloodline.精灵,1e-10);
});

test('a derived type chosen before any race is still written as [derived]', () => {
  const state = createRacePaletteSelection('');
  state.selectedDerivedType = '血族';
  assert.equal(buildRacePaletteValue(state), '[血族]');
  appendRacePaletteTag(state, '精灵');
  assert.equal(buildRacePaletteValue(state), '[血族]精灵');
});
