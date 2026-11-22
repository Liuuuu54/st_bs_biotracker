// 胎动提示（1.5.3）：每天每胎一档动静，主线提示与孕体特写读同一个值，强推每个故事日一次。
import assert from 'node:assert/strict';
import test from 'node:test';

import * as state from '../scripts/state.js';
import { describeMovementCue, getFetalDailyActivity, kickSideOf } from '../scripts/fetal_activity.js';
import { buildMainFlowPrompt, buildMovementCue, buildTrackerPayload, markMovementCueDelivered } from '../scripts/tracker.js';
import { buildBellyCloseupState as buildBellyState } from '../scripts/belly_state.js';

const DAY = 1440;

test('the daily activity is fixed within a story day and varies across days', () => {
  const fetus = { embryoId: 3, health: 50 };
  const options = { storyDay: 12, effectiveDays: 160 };
  assert.equal(getFetalDailyActivity(fetus, options), getFetalDailyActivity(fetus, options));
  const levels = new Set(Array.from({ length: 60 }, (_, day) => getFetalDailyActivity(fetus, { ...options, storyDay: day })));
  assert.ok(levels.size >= 3, `60 天里至少三种动静，实得 ${[...levels]}`);
  for (const level of levels) assert.ok(level >= 0 && level <= 3);
});

test('a failing fetus is quieter and maternal stress makes it livelier on average', () => {
  const mean = (fetus, extra = {}) => {
    let sum = 0;
    for (let day = 0; day < 400; day += 1) sum += getFetalDailyActivity(fetus, { storyDay: day, effectiveDays: 160, ...extra });
    return sum / 400;
  };
  assert.ok(mean({ embryoId: 1, health: 10 }) < mean({ embryoId: 1, health: 50 }) - 0.5);
  assert.ok(mean({ embryoId: 1, health: 50 }, { stressRatio: 1 }) > mean({ embryoId: 1, health: 50 }) + 0.3);
});

test('the cue names each fetus, kicks to the side opposite the back and asks for a push only when someone is lively', () => {
  assert.equal(kickSideOf({ backSide: '左前' }), '右侧');
  assert.equal(kickSideOf({ backSide: '右后' }), '左侧');
  assert.equal(kickSideOf({}), '');
  assert.deepEqual(describeMovementCue([]), { text: '', push: false });

  const findDay = (fetuses, predicate) => {
    for (let day = 0; day < 500; day += 1) if (predicate(fetuses.map((fetus) => getFetalDailyActivity(fetus, { storyDay: day, effectiveDays: 160 })))) return day;
    throw new Error('no such day');
  };
  const twins = [{ embryoId: 1, health: 50, backSide: '左前' }, { embryoId: 2, health: 50 }];
  const lively = findDay(twins, ([a, b]) => a === 2 && b <= 1);
  const cue = describeMovementCue(twins, { storyDay: lively, effectiveDays: 160 });
  assert.match(cue.text, /^老大今天格外好动，常往右侧踢；老二/);
  assert.equal(cue.push, true);

  const single = [{ embryoId: 5, health: 50 }];
  const quiet = findDay(single, ([a]) => a === 0);
  assert.deepEqual(describeMovementCue(single, { storyDay: quiet, effectiveDays: 160 }), { text: '腹中整天都很安静', push: false });
});

function setupPregnant(days = 160) {
  const ctx = { chatId: 'kick', chat: [{ is_user: false, name: 'N', mes: '午后。' }], characters: [], name1: 'U', name2: 'N', extensionSettings: {}, saveSettingsDebounced() {} };
  const settings = state.getSettings(ctx);
  const chatState = state.getChatState(ctx, settings);
  const ch = state.createDefaultFemaleState('甲');
  ch.initialized = true;
  Object.assign(ch.profile.base, { stage: '孕中期', age: 26, race: '人类' });
  ch.profile.pregnant = { ...ch.profile.pregnant, effectivePregnantDays: days, fetuses: [{ embryoId: 1, race: '人类', weight: 1, health: 50, conceivedAtDays: 0 }] };
  chatState.characters['甲'] = ch;
  return { ctx, settings, chatState, profile: ch.profile };
}

function firstDay(profile, predicate) {
  for (let day = 0; day < 500; day += 1) if (predicate(buildMovementCue(profile, day * DAY))) return day;
  throw new Error('no such day');
}

test('the main flow gets the cue once it can be felt, and the push is spent for that story day', () => {
  const { ctx, settings, chatState, profile } = setupPregnant();
  const day = firstDay(profile, (cue) => cue.push);
  chatState.minutesPassed = day * DAY + 600;
  const pregnant = () => buildTrackerPayload(ctx, settings, 'manual').existing_state;
  assert.ok(buildMainFlowPrompt(ctx, settings).includes(buildMovementCue(profile, chatState.minutesPassed).text));
  assert.match(buildMainFlowPrompt(ctx, settings), /movementCuePush/);

  markMovementCueDelivered(chatState);
  assert.equal(profile.base.movementCueDay, day);
  assert.doesNotMatch(buildMainFlowPrompt(ctx, settings), /"movementCuePush"/, '同一天不再强推');
  assert.ok(buildMainFlowPrompt(ctx, settings).includes(buildMovementCue(profile, chatState.minutesPassed).text), '描述仍在');
  assert.ok(pregnant());

  // 还感觉不到胎动时什么都不给
  const early = setupPregnant(7 * 12);
  early.chatState.minutesPassed = day * DAY;
  assert.doesNotMatch(buildMainFlowPrompt(early.ctx, early.settings), /movementCue/);
});

test('the closeup kicks with the same daily vigor', () => {
  assert.equal(buildBellyState({ fetuses: [{ embryoId: 1, growth: 0.5, vigor: 3 }] }).fetuses[0].vigor, 3);
  assert.equal(buildBellyState({ fetuses: [{ embryoId: 1, growth: 0.5 }] }).fetuses[0].vigor, 1, '旧呼叫照一般');
  assert.equal(buildBellyState({ fetuses: [{ embryoId: 1, growth: 0.5, vigor: 9 }] }).fetuses[0].vigor, 3);
});
