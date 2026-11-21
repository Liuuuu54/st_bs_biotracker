// 追踪周期（每 N 条 AI 回复自动追踪一次）：只测纯逻辑与接线，不跑真实追踪管线。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SETTINGS, normalizeAutoTrackEveryReplies } from '../scripts/state.js';
import { resolveTrackPeriodShortfall } from '../scripts/tracker.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('追踪周期默认 1（每次 AI 回复后都追踪），越界与脏值都收敛到 1..20', () => {
  assert.equal(DEFAULT_SETTINGS.autoTrackEveryReplies, 1);
  assert.equal(normalizeAutoTrackEveryReplies(undefined), 1);
  assert.equal(normalizeAutoTrackEveryReplies(''), 1);
  assert.equal(normalizeAutoTrackEveryReplies('abc'), 1);
  assert.equal(normalizeAutoTrackEveryReplies(0), 1);
  assert.equal(normalizeAutoTrackEveryReplies(-5), 1);
  assert.equal(normalizeAutoTrackEveryReplies(1), 1);
  assert.equal(normalizeAutoTrackEveryReplies(3), 3);
  assert.equal(normalizeAutoTrackEveryReplies('4'), 4);
  assert.equal(normalizeAutoTrackEveryReplies(2.9), 2);
  assert.equal(normalizeAutoTrackEveryReplies(99), 20);
});

test('周期还差几条：够了一律回 0，周期为 1 时永远不等', () => {
  assert.equal(resolveTrackPeriodShortfall(0, 1), 0);
  assert.equal(resolveTrackPeriodShortfall(1, 1), 0);
  assert.equal(resolveTrackPeriodShortfall(0, 3), 3);
  assert.equal(resolveTrackPeriodShortfall(1, 3), 2);
  assert.equal(resolveTrackPeriodShortfall(2, 3), 1);
  assert.equal(resolveTrackPeriodShortfall(3, 3), 0);
  assert.equal(resolveTrackPeriodShortfall(7, 3), 0, '超过一个周期就照常追踪，不攒更多');
  assert.equal(resolveTrackPeriodShortfall(-2, 2), 2, '脏值当 0 处理');
  assert.equal(resolveTrackPeriodShortfall('2', '2'), 0);
});

test('接线：自动追踪的轮询闸门、系统页输入框与读写都在位', () => {
  const tracker = read('scripts/tracker.js');
  assert.match(tracker, /normalizeAutoTrackEveryReplies\(settings\.autoTrackEveryReplies\)/);
  assert.match(tracker, /waiting_track_period/);
  assert.match(tracker, /countPendingAssistantReplies\(ctx, chatState\)/);
  // 只挡自动轮询：手动分析不该被周期拦住
  assert.match(tracker, /if \(reason === 'poll'\) \{\n\s*\/\/ 追踪周期/);

  const html = read('settings.html');
  assert.match(html, /id="bs-bt-auto-track-every"/);

  const controller = read('index.js');
  assert.match(controller, /setValue\('bs-bt-auto-track-every', normalizeAutoTrackEveryReplies\(settings\.autoTrackEveryReplies\)\)/);
  assert.match(controller, /settings\.autoTrackEveryReplies = normalizeAutoTrackEveryReplies\(getValue\('bs-bt-auto-track-every'\)\)/);
});
