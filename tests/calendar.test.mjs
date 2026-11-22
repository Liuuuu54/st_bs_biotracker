// 对话历法（1.5.2）：公历与自订历、从 minutesPassed 读日期、当地的岁、月与年的长度
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averageMonthDays, averageYearDays, dateAt, describeCalendarForPrompt, formatCalendarDate, formatStoryDate, fromLocalYears, getBreedingAnchor, minutesAtDate, nextAnchorMinutes,
  normalizeCalendar, toLocalYears, yearDays,
} from '../scripts/calendar.js';

const DAY = 24 * 60;
const roshar = normalizeCalendar({
  mode: 'custom', era: '帝国历',
  months: Array.from({ length: 10 }, (_, i) => ({ name: `第${i + 1}月`, days: 50 })),
  weekdays: ['一', '二', '三', '四', '五'],
  start: { year: 312, month: 3, day: 9, hour: 14, weekday: 2 },
});

test('认不出来的历法回传 null，不丢错', () => {
  assert.equal(normalizeCalendar(null), null);
  assert.equal(normalizeCalendar({ mode: 'lunar' }), null);
  assert.equal(normalizeCalendar({ mode: 'custom', months: [] }), null);
  assert.equal(normalizeCalendar({ mode: 'custom', months: [{ days: 0 }] }), null);
  assert.equal(normalizeCalendar({ mode: 'custom', months: Array(25).fill({ days: 10 }) }), null);
});

test('公历：闰年、跨年、星期照真实', () => {
  const cal = normalizeCalendar({ mode: 'gregorian', start: { year: 2024, month: 2, day: 28, hour: 23 } });
  assert.equal(dateAt(cal, 60).day, 29, '2024 是闰年，2/28 23:00 再一小时是 2/29');
  assert.equal(dateAt(cal, 60 + DAY).month, 3);
  const nye = normalizeCalendar({ mode: 'gregorian', start: { year: 2025, month: 12, day: 31 } });
  assert.deepEqual([dateAt(nye, DAY).year, dateAt(nye, DAY).month, dateAt(nye, DAY).day], [2026, 1, 1]);
  assert.equal(dateAt(normalizeCalendar({ mode: 'gregorian', start: { year: 2026, month: 11, day: 22 } }), 0).weekdayName, '周日');
  assert.equal(yearDays(cal, 2024), 366);
  assert.equal(yearDays(cal, 2100), 365, '整百年不闰');
});

test('自订历：一年 500 天、十个月，跨月跨年与星期循环', () => {
  assert.equal(averageYearDays(roshar), 500);
  assert.equal(averageMonthDays(roshar), 50);
  const start = dateAt(roshar, 0);
  assert.deepEqual([start.year, start.month, start.day, start.hour], [312, 3, 9, 14]);
  assert.equal(start.weekdayName, '三');
  const later = dateAt(roshar, 42 * DAY);
  assert.deepEqual([later.month, later.day], [4, 1], '第3月9日 + 42 天 = 第4月1日');
  assert.equal(later.weekdayName, '五', '42 天 = 8 周又 2 天');
  const nextYear = dateAt(roshar, (500 - (100 + 8)) * DAY);
  assert.deepEqual([nextYear.year, nextYear.month, nextYear.day], [313, 1, 1]);
  assert.equal(formatCalendarDate(roshar, start, { withTime: true }), '帝国历 312年 第3月9日 14:00');
});

test('日期与 minutesPassed 来回换算；故事开始之前是负的', () => {
  assert.equal(minutesAtDate(roshar, 312, 3, 9), -14 * 60);
  assert.equal(minutesAtDate(roshar, 312, 3, 10), 10 * 60);
  const before = dateAt(roshar, -2 * DAY);
  assert.deepEqual([before.month, before.day], [3, 7]);
});

test('当地的岁：存地球年、显示与送提示换成当地的岁', () => {
  assert.equal(toLocalYears(20, roshar), 14.6, '20 个地球年 = 7300 天 = 14.6 个 500 天的年');
  assert.ok(Math.abs(fromLocalYears(toLocalYears(20, roshar), roshar) - 20) < 1e-9);
  assert.equal(toLocalYears(20, null), 20, '没有历法照旧');
  assert.equal(formatStoryDate(null, 0), '');
});

test('季节：每年固定，季数与长短自订；年初还没到第一季算去年最后一季', () => {
  const cal = normalizeCalendar({
    mode: 'custom', months: ['萌', '炎', '实', '凋', '寂'].map((name) => ({ name: `${name}月`, days: 100 })),
    seasons: [{ name: '雨季', month: 2, day: 1 }, { name: '旱季', month: 4, day: 51 }, { name: '坏的', month: 4, day: 51 }],
    start: { year: 1, month: 1, day: 1 },
  });
  assert.deepEqual(cal.seasons.map((item) => item.name), ['雨季', '旱季'], '同一天开始的第二季丢掉');
  assert.equal(dateAt(cal, 0).season, '旱季', '萌月1日还没到雨季：仍是去年的旱季');
  assert.equal(dateAt(cal, 100 * DAY).season, '雨季');
  assert.equal(dateAt(cal, 350 * DAY).season, '旱季');
  assert.match(describeCalendarForPrompt(cal, 100 * DAY), /今天是 1年 炎月1日 00:00，雨季。.*季节：雨季（炎月1日起）、旱季（凋月51日起）/);
});

test('繁殖季锚点：月日或季名；下一次到那天的时刻', () => {
  const cal = normalizeCalendar({
    mode: 'gregorian', start: { year: 2026, month: 11, day: 22 },
    seasons: [{ name: '春', month: 3, day: 1 }, { name: '秋', month: 9, day: 1 }],
    breedingSeasons: { 狼人: { season: '春' }, 猫妖: { month: 2, day: 29 }, 无效: { season: '夏' } },
  });
  assert.deepEqual(Object.keys(cal.breedingSeasons), ['狼人', '猫妖'], '指向不存在的季丢掉');
  assert.deepEqual(getBreedingAnchor(cal, '狼人'), { month: 3, day: 1 });
  assert.equal(getBreedingAnchor(cal, '人类'), null);
  const next = nextAnchorMinutes(cal, getBreedingAnchor(cal, '狼人'), 0);
  assert.deepEqual([dateAt(cal, next).year, dateAt(cal, next).month, dateAt(cal, next).day], [2027, 3, 1]);
  const leap = nextAnchorMinutes(cal, getBreedingAnchor(cal, '猫妖'), 0);
  assert.deepEqual([dateAt(cal, leap).month, dateAt(cal, leap).day], [2, 28], '2027 平年，2/29 落到 2/28');
});
