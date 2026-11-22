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

test('闰日锚点：闰年 2/29 开季，平年落到 2/28；跨年的季照样每年同一天', () => {
  const cal = normalizeCalendar({ mode: 'gregorian', start: { year: 2027, month: 6, day: 1 }, breedingSeasons: { 天使: { month: 2, day: 29 }, 兽耳族: { month: 12, day: 20 } } });
  const at = (anchor, from) => { const m = nextAnchorMinutes(cal, anchor, from); const d = dateAt(cal, m); return `${d.year}/${d.month}/${d.day}`; };
  const leapAnchor = getBreedingAnchor(cal, '天使');
  assert.equal(at(leapAnchor, 0), '2028/2/29');
  assert.equal(at(leapAnchor, minutesAtDate(cal, 2028, 3, 1)), '2029/2/28');
  assert.equal(at(getBreedingAnchor(cal, '兽耳族'), minutesAtDate(cal, 2027, 12, 21)), '2028/12/20');
});

test('法定岁数与生日（1.5.3）：照活过的时间算，过了生日才加一；卡上写的生日对得上', async () => {
  const { legalAge, nextBirthdayMinutes, formatBirthday, earthAgeForBirthday } = await import('../scripts/calendar.js');
  const cal = normalizeCalendar({ mode: 'custom', months: ['霜月', '雪月', '冰月', '萌月', '花月', '炎月', '烈月', '稻月', '叶月', '枯月'].map((name) => ({ name, days: 40 })), start: { year: 88, month: 1, day: 12 } });
  const earth = fromLocalYears(140.25, cal);
  assert.equal(legalAge(earth, cal), 140);
  assert.equal(Math.round(nextBirthdayMinutes(earth, cal, 0) / 1440), 300, '还差 0.75 个当地年＝300 天');
  // 卡上写「生日：萌月1日」，法定 140 岁
  const aged = earthAgeForBirthday(140, cal, 0, { month: 4, day: 1 });
  assert.equal(legalAge(aged, cal), 140);
  assert.equal(formatBirthday(aged, cal, 0), '萌月1日');
  // 活过 300 天之后过生日：141 岁，生日不变
  const later = aged + 300 / 365;
  assert.equal(legalAge(later, cal), 141);
  assert.equal(formatBirthday(later, cal, 300 * 1440), '萌月1日');
  // 今天就是生日：小数为 0
  assert.equal(legalAge(earthAgeForBirthday(20, cal, 0, { month: 1, day: 12 }), cal), 20);
  assert.equal(formatBirthday(earthAgeForBirthday(20, cal, 0, { month: 1, day: 12 }), cal, 0), '霜月12日');
  // 没有历法：地球年取整
  assert.equal(legalAge(22.9, null), 22);
});

test('注册定生日（1.5.3）：没写生日在这一岁里随机落一天，写了照它，重新注册岁数没变就沿用', async () => {
  const { registrationEarthAge, legalAge, birthdayOf } = await import('../scripts/calendar.js');
  // 没历法：24 岁 + 这一岁的随机位置
  assert.equal(registrationEarthAge(24, null, 0, { random: () => 0.25 }), 24.25);
  assert.equal(registrationEarthAge(24, null, 0, { random: () => 0 }), 24);
  // 带小数的（半岁婴儿）照写的，不掷
  assert.equal(registrationEarthAge(0.5, null, 0, { random: () => 0.9 }), 0.5);
  // 重新注册：法定岁数相同沿用旧年龄，生日不跳；长了一岁才重掷
  assert.equal(registrationEarthAge(24, null, 0, { previousAge: 24.71, random: () => 0.1 }), 24.71);
  assert.equal(registrationEarthAge(25, null, 0, { previousAge: 24.71, random: () => 0.1 }), 25.1);
  // 有历法：法定岁数照当地年，卡上写明生日就落在那天
  const age = registrationEarthAge(20, roshar, 0, { birthday: { month: 5, day: 12 }, random: () => 0.9 });
  assert.equal(legalAge(age, roshar), 20);
  const birthday = birthdayOf(age, roshar, 0);
  assert.deepEqual([birthday.month, birthday.day], [5, 12]);
  // 不同的随机落在不同的日子
  const a = birthdayOf(registrationEarthAge(20, roshar, 0, { random: () => 0.2 }), roshar, 0);
  const b = birthdayOf(registrationEarthAge(20, roshar, 0, { random: () => 0.7 }), roshar, 0);
  assert.notDeepEqual([a.month, a.day], [b.month, b.day]);
  assert.equal(registrationEarthAge('不知道', roshar), null);
});

test('长大（1.5.3）：上次改变后过了一个生日就能再记', async () => {
  const { getGrowthWaitYears } = await import('../scripts/tools.js');
  // 24.7 岁改过：25 岁生日（还差 0.3 年）就能再记，不必等到 25.7
  assert.ok(Math.abs(getGrowthWaitYears({ age: 24.7, bodyChangedAtAge: 24.7 }) - 0.3) < 1e-9);
  assert.ok(getGrowthWaitYears({ age: 25, bodyChangedAtAge: 24.7 }) <= 1e-9);
  assert.ok(getGrowthWaitYears({ age: 24.99, bodyChangedAtAge: 24.1 }) > 0, '同一岁里不能再长');
});

test('掷生日：每一天机会相同，公历不掷出 2/29，没历法回传 null', async () => {
  const { randomBirthday } = await import('../scripts/calendar.js');
  assert.equal(randomBirthday(null), null);
  assert.deepEqual(randomBirthday(roshar, () => 0), { month: 1, day: 1 });
  assert.deepEqual(randomBirthday(roshar, () => 0.999999), { month: 10, day: 50 });
  assert.deepEqual(randomBirthday(roshar, () => 0.5), { month: 6, day: 1 });
  const greg = normalizeCalendar({ mode: 'gregorian', start: { year: 2024, month: 1, day: 1 } });
  assert.deepEqual(randomBirthday(greg, () => 59 / 365), { month: 3, day: 1 }, '平年第 60 天是 3/1');
});
