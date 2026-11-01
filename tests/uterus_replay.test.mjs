// 子宫图的事件特写：系统开了「减少动态效果」时不自动播，但使用者按重播照播。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createUterusRenderer } from '../scripts/uterus_render.js';

function withReducedMotion(reduce, run) {
  const saved = { matchMedia: globalThis.matchMedia, document: globalThis.document };
  globalThis.matchMedia = (query) => ({ matches: reduce && query.includes('prefers-reduced-motion') });
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  try { return run(); } finally { globalThis.matchMedia = saved.matchMedia; globalThis.document = saved.document; }
}

function fakeCanvas() {
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
  return { isConnected: false, getContext: () => ctx };
}

test('减少动态效果：自动播放的特写跳过，使用者按重播照播', () => withReducedMotion(true, () => {
  const renderer = createUterusRenderer(fakeCanvas());
  assert.equal(renderer.playCue('ejaculate'), false, '新事件不自动播');
  assert.equal(renderer.playCue('ejaculate', { userRequested: true }), true, '按重播要播');
  renderer.destroy();
}));

test('没有减少动态效果时两种都播', () => withReducedMotion(false, () => {
  const renderer = createUterusRenderer(fakeCanvas());
  assert.equal(renderer.playCue('condomBreak'), true);
  assert.equal(renderer.playCue('condomBreak', { userRequested: true }), true);
  renderer.destroy();
}));
