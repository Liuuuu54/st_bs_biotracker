// 日历页（1.5.2）：生理阶段排到故事时间轴（推算＋快照回推）
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStageTimeline, projectStageTimeline, stageOnDay } from '../scripts/story_calendar.js';

const DAY = 24 * 60;
const human = (stage, days, extra = {}) => ({ base: { stage, days, ...extra.base }, bio: { menstrualLengthRatio: 1, ...extra.bio }, pregnant: { ...extra.pregnant } });

test('月经周期照阶段长度往后排，一轮 28 天', () => {
  const { segments } = projectStageTimeline(human('卵泡期', 3), 0, 40 * DAY);
  assert.deepEqual(segments.slice(0, 5).map((s) => s.stage), ['卵泡期', '排卵期', '黄体期', '月经期', '卵泡期']);
  assert.equal(segments[0].end, 6 * DAY, '卵泡期还剩 6 天');
  assert.equal(segments[3].end, (6 + 2 + 12 + 5) * DAY);
});

test('不改原档案（复制再推）', () => {
  const profile = human('月经期', 1, { base: { seasonCycle: 0 } });
  projectStageTimeline(profile, 0, 100 * DAY);
  assert.equal(profile.base.stage, '月经期');
  assert.equal(profile.base.days, 1);
});

test('怀孕：照有效孕日排到临产，标出预产期；之后的逾期一路画到底', () => {
  const profile = human('孕中期', 0, { pregnant: { effectivePregnantDays: 100 }, bio: { gestationSpeciesSpeed: 2 } });
  const { segments, marks } = projectStageTimeline(profile, 0, 200 * DAY);
  assert.deepEqual(segments.map((s) => s.stage), ['孕中期', '孕晚期', '临产期', '逾期']);
  assert.equal(segments[0].end, 48 * DAY, '还差 96 有效天，两倍速 48 天');
  assert.equal(marks[0].kind, 'due');
  assert.equal(marks[0].at, 90 * DAY, '预产期 280 − 100 = 180 有效天 ÷ 2');
  assert.equal(segments.at(-1).open, true);
});

test('产后恢复结束接月经期；产程只画到底不往后推', () => {
  const { segments } = projectStageTimeline(human('产后恢复', 50, { bio: { recoveryDays: 56 } }), 0, 10 * DAY);
  assert.deepEqual(segments.slice(0, 2).map((s) => s.stage), ['产后恢复', '月经期']);
  const labor = projectStageTimeline(human('第一产程', 0), 0, 5 * DAY).segments;
  assert.deepEqual(labor.map((s) => [s.stage, s.open]), [['第一产程', true]]);
});

test('快照回推是纪录，现在之后是推算；某天取占最久的阶段', () => {
  const timeline = buildStageTimeline(
    [{ minutes: 0, profile: human('卵泡期', 0) }],
    { minutes: 5 * DAY, profile: human('卵泡期', 5) },
    20 * DAY,
  );
  const past = stageOnDay(timeline, 2 * DAY);
  assert.equal(past.stage, '卵泡期');
  assert.equal(past.predicted, false);
  const future = stageOnDay(timeline, 9 * DAY);
  assert.equal(future.stage, '排卵期');
  assert.equal(future.predicted, true);
  assert.equal(stageOnDay(timeline, -3 * DAY), null, '最早的快照之前没有资料');
});

test('日历只画重点：月经、排卵、孕期、逾期、产后、假孕；延产标出期限', async () => {
  const { stageGroupOf } = await import('../scripts/story_calendar.js');
  assert.equal(stageGroupOf('月经期'), 'menses');
  assert.equal(stageGroupOf('排卵期'), 'ovulation');
  assert.equal(stageGroupOf('临产期'), 'pregnancy');
  assert.equal(stageGroupOf('逾期'), 'overdue');
  assert.equal(stageGroupOf('延产期'), 'overdue');
  assert.equal(stageGroupOf('产后恢复'), 'postpartum');
  assert.equal(stageGroupOf('假孕期'), 'pseudo');
  for (const stage of ['卵泡期', '黄体期', '乏情期', '产兆前驱', '第一产程', '回归期']) assert.equal(stageGroupOf(stage), '', stage);
  const extended = human('延产期', 106, { pregnant: { effectivePregnantDays: 400, extensionUntilDays: 420 } });
  const { segments, marks } = projectStageTimeline(extended, 0, 40 * DAY);
  assert.deepEqual(segments.map((s) => s.stage), ['延产期', '产兆前驱']);
  assert.deepEqual(marks, [{ kind: 'extension', at: 20 * DAY }], '还差 20 有效天');
});
