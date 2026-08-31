import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildTrackerPayload } from '../scripts/tracker.js';
import { applyToolCall } from '../scripts/tools.js';

const controller = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function makeContext(diaryRecentLimit = 5) {
  const chatState = {
    characters: {
      艾拉: {
        name: '艾拉',
        initialized: true,
        profile: {
          base: { stage: '卵泡期', days: 1, isHere: true },
          diary: [],
        },
      },
    },
    snapshots: [],
  };
  const ctx = {
    chatId: 'diary-display-chat',
    chat: [],
    extensionSettings: {
      bs_biotracker: {
        enabled: true,
        diaryRecentLimit,
        chatStates: { 'diary-display-chat': chatState },
      },
    },
    saveSettingsDebounced() {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  return { ctx, chatState };
}

test('diary entries written in the character profile survive into tracker state', () => {
  const { ctx, chatState } = makeContext();
  const result = applyToolCall(chatState, {
    name: 'bsWriteDiary',
    arguments: { female: '艾拉', time: '时间', content: '内容' },
  });

  assert.equal(result.applied, true, result.message);
  assert.deepEqual(chatState.characters.艾拉.profile.diary[0], {
    time: '时间',
    content: '内容',
    storyDayIndex: 0,
    createdAt: chatState.characters.艾拉.profile.diary[0].createdAt,
  });

  const settings = ctx.extensionSettings.bs_biotracker;
  const payload = buildTrackerPayload(ctx, settings);
  assert.equal(payload.existing_state.艾拉.profile.diary.length, 1);
  assert.equal(payload.existing_state.艾拉.profile.diary[0].time, '时间');
  assert.equal(payload.existing_state.艾拉.profile.diary[0].content, '内容');
  assert.equal(payload.existing_state.艾拉.profile.diary[0].storyDayIndex, 0);
});

test('track diary page renders stored entries even when tracker diary injection is disabled', () => {
  makeContext(0);
  const diarySection = controller.match(/function renderTrackDiary\(viewModel\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(diarySection, /renderCardCarouselSection\(/);
  assert.doesNotMatch(diarySection, /diaryEnabled/);
  assert.match(controller, /entries: Array\.isArray\(profile\.diary\) \? profile\.diary : \[\]/);
});