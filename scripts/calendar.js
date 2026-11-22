// 对话历法（1.5.2）：世界历法只管「日期怎么表示」，生理一律照绝对时间（minutesPassed，一天 24 小时）。
// 历法绑卡，算世界基准；没设历法时照旧显示「第 N 天」。年龄存的仍是地球年（经过天数 ÷ 365），
// 只在显示与送提示时换成当地的岁，换历法不改存的值。
// 纯计算，不碰 DOM 与设定；目前生效的历法由呼叫端用 setCalendarProvider 提供（工具推进时间时换算月、年）。

export const CALENDAR_MODES = Object.freeze(['gregorian', 'custom']);
export const CALENDAR_MAX_MONTHS = 24;
export const CALENDAR_MAX_MONTH_DAYS = 999;
export const CALENDAR_MAX_WEEKDAYS = 60;
export const CALENDAR_MAX_SEASONS = 12;
const CALENDAR_MAX_BREEDING = 200;
const MINUTES_PER_DAY = 24 * 60;
/** 地球年：年龄存值的单位（与 tools.js 每天 +1/365 一致） */
export const EARTH_YEAR_DAYS = 365;
const GREGORIAN_MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const GREGORIAN_WEEKDAYS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const int = (value, min, max, fallback) => {
  const num = Math.round(Number(value));
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
};
const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

/**
 * 规范化一份历法；认不出来回传 null（呼叫端当成「没设历法」），绝不丢错。
 * { mode, era, months: [{ name, days }]（只有自订历）, weekdays: [名称]（空＝不分周）, start: { year, month, day, hour, minute, weekday? },
 *   seasons: [{ name, month, day }]（每年固定的季节，照开始日排序；空＝不分季）,
 *   breedingSeasons: { 种族: { month, day } | { season } }（有乏情期的物种每年从这天进繁殖季）,
 *   derivedPeaks: { 衍生类型: { month, day } | { season } }（有峰期的衍生，精力高峰改成每年从这天起） }
 */
export function normalizeCalendar(raw) {
  if (!isObject(raw)) return null;
  const mode = CALENDAR_MODES.includes(raw.mode) ? raw.mode : null;
  if (!mode) return null;
  const era = text(raw.era, 24);
  let months = null;
  if (mode === 'custom') {
    if (!Array.isArray(raw.months) || raw.months.length < 1 || raw.months.length > CALENDAR_MAX_MONTHS) return null;
    months = [];
    for (const [index, item] of raw.months.entries()) {
      const days = Math.round(Number(isObject(item) ? item.days : item));
      if (!Number.isFinite(days) || days < 1 || days > CALENDAR_MAX_MONTH_DAYS) return null;
      months.push({ name: text(isObject(item) ? item.name : '', 12) || `${index + 1}月`, days });
    }
  }
  const weekdays = mode === 'gregorian' && !Array.isArray(raw.weekdays)
    ? [...GREGORIAN_WEEKDAYS]
    : (Array.isArray(raw.weekdays) ? raw.weekdays : []).map((name) => text(name, 8)).filter(Boolean).slice(0, CALENDAR_MAX_WEEKDAYS);
  const base = { mode, era, ...(months ? { months } : {}), weekdays };
  const s = isObject(raw.start) ? raw.start : {};
  const year = int(s.year, -99999, 99999, mode === 'gregorian' ? 2026 : 1);
  const month = int(s.month, 1, monthCount(base), 1);
  const day = int(s.day, 1, monthDays(base, year, month), 1);
  const start = { year, month, day, hour: int(s.hour, 0, 23, 0), minute: int(s.minute, 0, 59, 0) };
  // 自订历的星期：故事开始那天是星期几（下标）；公历照真实星期算，不存
  if (mode === 'custom' && weekdays.length) start.weekday = int(s.weekday, 0, weekdays.length - 1, 0);
  const seasons = normalizeSeasons(base, raw.seasons);
  const breedingSeasons = normalizeBreedingSeasons(base, seasons, raw.breedingSeasons);
  const derivedPeaks = normalizeBreedingSeasons(base, seasons, raw.derivedPeaks);
  return { ...base, start, ...(seasons.length ? { seasons } : {}), ...(Object.keys(breedingSeasons).length ? { breedingSeasons } : {}), ...(Object.keys(derivedPeaks).length ? { derivedPeaks } : {}) };
}

/** 月日夹进这个历法里（公历 2 月照平年 28 天，闰年那天另算） */
function clampMonthDay(cal, item) {
  const month = int(item?.month, 1, monthCount(cal), 1);
  const day = int(item?.day, 1, cal.mode === 'custom' ? monthDays(cal, 1, month) : (month === 2 ? 29 : monthDays(cal, 2001, month)), 1);
  return { month, day };
}

const yearPosition = (cal, month, day) => dayNumberOf(cal, cal.mode === 'custom' ? 1 : 2001, month, Math.min(day, monthDays(cal, 2001, month) || day)) - dayNumberOf(cal, cal.mode === 'custom' ? 1 : 2001, 1, 1);

function normalizeSeasons(cal, raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.filter(isObject).map((item) => ({ name: text(item.name, 8), ...clampMonthDay(cal, item) }))
    .filter((item) => item.name && !seen.has(`${item.month}/${item.day}`) && seen.add(`${item.month}/${item.day}`))
    .sort((a, b) => yearPosition(cal, a.month, a.day) - yearPosition(cal, b.month, b.day))
    .slice(0, CALENDAR_MAX_SEASONS);
}

function normalizeBreedingSeasons(cal, seasons, raw) {
  const result = {};
  if (!isObject(raw)) return result;
  for (const [key, item] of Object.entries(raw).slice(0, CALENDAR_MAX_BREEDING)) {
    const race = text(key, 24);
    if (!race || !isObject(item)) continue;
    const season = text(item.season, 8);
    if (season) {
      if (seasons.some((entry) => entry.name === season)) result[race] = { season };
      continue;
    }
    if (item.month !== undefined) result[race] = clampMonthDay(cal, item);
  }
  return result;
}

/** 某年某季（或某个月日）开始那天 00:00 的 dayNumber；公历 2/29 在平年落到 2/28 */
function anchorDayNumber(cal, year, anchor) {
  const month = anchor.month;
  return dayNumberOf(cal, year, month, Math.min(anchor.day, monthDays(cal, year, month)));
}

/** 这一天在哪一季；不分季回传 '' */
export function seasonOf(cal, date) {
  const seasons = cal?.seasons || [];
  if (!seasons.length) return '';
  const today = dayNumberOf(cal, date.year, date.month, date.day);
  let found = seasons[seasons.length - 1].name; // 年初还没到第一季的开始：仍是去年最后一季
  for (const item of seasons) if (anchorDayNumber(cal, date.year, item) <= today) found = item.name;
  return found;
}

function resolveAnchorItem(cal, item) {
  if (!item) return null;
  if (item.season) {
    const season = (cal.seasons || []).find((entry) => entry.name === item.season);
    return season ? { month: season.month, day: season.day } : null;
  }
  return { month: item.month, day: item.day };
}

/** 物种的繁殖季开始日（月日）；没设回传 null */
export function getBreedingAnchor(cal, race) {
  return resolveAnchorItem(cal, cal?.breedingSeasons?.[race]);
}

/** 衍生类型的精力高峰开始日（月日）；没设回传 null */
export function getDerivedPeakAnchor(cal, derivedType) {
  return resolveAnchorItem(cal, cal?.derivedPeaks?.[derivedType]);
}

/** atMinutes 当下或之前最近一次到这个月日 00:00 的 minutesPassed */
export function previousAnchorMinutes(cal, anchor, atMinutes) {
  if (!cal || !anchor) return null;
  const { year } = dateAt(cal, atMinutes);
  for (let y = year; y >= year - 2; y -= 1) {
    const at = anchorDayNumber(cal, y, anchor) * MINUTES_PER_DAY - startMinuteOf(cal);
    if (at <= atMinutes) return at;
  }
  return null;
}

/** afterMinutes 之后（不含当下那一刻之前）下一次到这个月日 00:00 的 minutesPassed */
export function nextAnchorMinutes(cal, anchor, afterMinutes) {
  if (!cal || !anchor) return null;
  const { year } = dateAt(cal, afterMinutes);
  for (let y = year; y <= year + 2; y += 1) {
    const at = anchorDayNumber(cal, y, anchor) * MINUTES_PER_DAY - startMinuteOf(cal);
    if (at > afterMinutes) return at;
  }
  return null;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function monthCount(cal) {
  return cal?.mode === 'custom' ? cal.months.length : 12;
}

export function monthName(cal, month) {
  if (cal?.mode === 'custom') return cal.months[month - 1]?.name || `${month}月`;
  return `${month}月`;
}

/** 某年某月几天（月份 1 起算）；闰年只有公历才有 */
export function monthDays(cal, year, month) {
  if (cal?.mode === 'custom') return cal.months[month - 1]?.days || 0;
  if (month === 2 && isLeapYear(year)) return 29;
  return GREGORIAN_MONTH_DAYS[month - 1] || 0;
}

export function yearDays(cal, year) {
  if (cal?.mode === 'custom') return cal.months.reduce((sum, item) => sum + item.days, 0);
  return isLeapYear(year) ? 366 : 365;
}

/** 平均一年几天：换算年龄、bsPassedTime 的 year 用 */
export function averageYearDays(cal) {
  if (!cal) return EARTH_YEAR_DAYS;
  return cal.mode === 'custom' ? yearDays(cal, 1) : 365.2425;
}

/** 平均一个月几天：bsPassedTime 的 month 用（没有历法时照旧 30） */
export function averageMonthDays(cal) {
  if (!cal) return 30;
  return averageYearDays(cal) / monthCount(cal);
}

// 公历：前推格里高利历的「从 1970-01-01 起第几天」（Howard Hinnant 的 days_from_civil）
function gregorianDayNumber(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = floorDiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

function gregorianFromDayNumber(n) {
  const z = n + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const day = doy - floorDiv(153 * mp + 2, 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** 历法里的「第几天」（任意原点，只拿来相减与推日期） */
export function dayNumberOf(cal, year, month, day) {
  if (cal?.mode === 'custom') {
    const before = cal.months.slice(0, month - 1).reduce((sum, item) => sum + item.days, 0);
    return (year - 1) * yearDays(cal, year) + before + (day - 1);
  }
  return gregorianDayNumber(year, month, day);
}

export function dateFromDayNumber(cal, n) {
  if (cal?.mode === 'custom') {
    const total = yearDays(cal, 1);
    const year = floorDiv(n, total) + 1;
    let rest = mod(n, total);
    let month = 1;
    while (month < cal.months.length && rest >= cal.months[month - 1].days) {
      rest -= cal.months[month - 1].days;
      month += 1;
    }
    return { year, month, day: rest + 1 };
  }
  return gregorianFromDayNumber(n);
}

/** 故事开始那一刻在历法上是第几分钟（相对 dayNumber 0 的 00:00） */
function startMinuteOf(cal) {
  const s = cal.start;
  return dayNumberOf(cal, s.year, s.month, s.day) * MINUTES_PER_DAY + s.hour * 60 + s.minute;
}

/** 星期几（下标）；不分周回传 null */
function weekdayIndex(cal, dayNumber) {
  if (!cal.weekdays.length) return null;
  if (cal.mode === 'gregorian') return mod(dayNumber + 4, 7); // 1970-01-01 是周四
  const startDay = dayNumberOf(cal, cal.start.year, cal.start.month, cal.start.day);
  return mod((cal.start.weekday || 0) + dayNumber - startDay, cal.weekdays.length);
}

/** 故事经过 minutesPassed 分钟时的日期 */
export function dateAt(cal, minutesPassed = 0) {
  const absolute = startMinuteOf(cal) + Math.floor(Number(minutesPassed) || 0);
  const dayNumber = floorDiv(absolute, MINUTES_PER_DAY);
  const minuteOfDay = absolute - dayNumber * MINUTES_PER_DAY;
  const date = dateFromDayNumber(cal, dayNumber);
  const weekday = weekdayIndex(cal, dayNumber);
  const firstOfYear = dayNumberOf(cal, date.year, 1, 1);
  return {
    ...date,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    dayNumber,
    monthName: monthName(cal, date.month),
    weekday,
    weekdayName: weekday === null ? '' : cal.weekdays[weekday],
    dayOfYear: dayNumber - firstOfYear + 1,
    yearDays: yearDays(cal, date.year),
    season: seasonOf(cal, date),
  };
}

/** 某个历法日期 00:00 对应的 minutesPassed（可能是负的：故事开始之前） */
export function minutesAtDate(cal, year, month, day) {
  return dayNumberOf(cal, year, month, day) * MINUTES_PER_DAY - startMinuteOf(cal);
}

/** 「帝国历 312年 霜月9日」／「2026年3月9日」；withTime 加上 14:05，withWeekday 加星期 */
export function formatCalendarDate(cal, date, { withTime = false, withWeekday = false } = {}) {
  const era = cal.era ? `${cal.era} ` : '';
  const head = cal.mode === 'custom'
    ? `${era}${date.year}年 ${date.monthName}${date.day}日`
    : `${era}${date.year}年${date.month}月${date.day}日`;
  const weekday = withWeekday && date.weekdayName ? ` ${date.weekdayName}` : '';
  const time = withTime ? ` ${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}` : '';
  return `${head}${weekday}${time}`;
}

/** 故事日期的文字；没有历法回传空字串 */
export function formatStoryDate(cal, minutesPassed, options = {}) {
  return cal ? formatCalendarDate(cal, dateAt(cal, minutesPassed), options) : '';
}

/** 存的年龄（地球年）→ 当地的岁 */
export function toLocalYears(earthYears, cal) {
  const value = Number(earthYears);
  if (!Number.isFinite(value)) return value;
  return cal ? value * EARTH_YEAR_DAYS / averageYearDays(cal) : value;
}

/** 当地的岁 → 存的年龄（地球年）：注册时模型照角色卡写的是当地的岁 */
export function fromLocalYears(localYears, cal) {
  const value = Number(localYears);
  if (!Number.isFinite(value)) return value;
  return cal ? value * averageYearDays(cal) / EARTH_YEAR_DAYS : value;
}

// ---- 法定岁数与生日（1.5.3）----
// 时间只有一根：存的年龄是活过的地球年（经过天数 ÷ 365，只会往前）。
// 法定岁数＝活过几个当地年（取整）；生日＝活过的时间再满一个当地年的那一刻，照目前的历法读成日期。
// 不存出生日期：换历法、穿越（改「现在是哪天」）都跟着重算，岁数不会倒退或变负数。

/** 法定岁数：活过几个当地年，取整；没有历法就是地球年取整 */
export function legalAge(earthYears, cal) {
  const value = toLocalYears(earthYears, cal);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value + 1e-9)) : value;
}

/** 下一个生日的 minutesPassed（今天就是生日时回传今天这一刻） */
export function nextBirthdayMinutes(earthYears, cal, nowMinutes = 0) {
  const local = toLocalYears(earthYears, cal);
  if (!Number.isFinite(local)) return null;
  const fraction = local - Math.floor(local + 1e-9);
  const remainingYears = fraction < 1e-9 ? 0 : 1 - fraction;
  return Number(nowMinutes) + remainingYears * averageYearDays(cal) * MINUTES_PER_DAY;
}

/** 生日（月、日）：下一个生日那天在目前历法上的日期；没有历法回传 null */
export function birthdayOf(earthYears, cal, nowMinutes = 0) {
  if (!cal) return null;
  const at = nextBirthdayMinutes(earthYears, cal, nowMinutes);
  if (at === null) return null;
  const date = dateAt(cal, at);
  return { month: date.month, day: date.day, monthName: date.monthName, minutes: at };
}

/** 生日的文字（「霜月3日」「3月3日」）；没有历法回传空字串 */
export function formatBirthday(earthYears, cal, nowMinutes = 0) {
  const birthday = birthdayOf(earthYears, cal, nowMinutes);
  if (!birthday) return '';
  return cal.mode === 'custom' ? `${birthday.monthName}${birthday.day}日` : `${birthday.month}月${birthday.day}日`;
}

/**
 * 角色卡写明生日时：法定岁数 legal 不变，把年龄的小数调成「下一个生日落在那个月日」，回传地球年。
 * 月日不在历法里（月份超出、日子超出）就夹回；没有历法照 legal 原样换算。
 */
export function earthAgeForBirthday(legal, cal, nowMinutes, birthday) {
  const whole = Math.max(0, Math.floor(Number(legal) || 0));
  if (!cal || !birthday) return fromLocalYears(whole, cal);
  const month = Math.max(1, Math.min(monthCount(cal), Math.round(Number(birthday.month) || 1)));
  const anchor = { month, day: Math.max(1, Math.round(Number(birthday.day) || 1)) };
  const now = Number(nowMinutes) || 0;
  // 今天就是生日：小数为 0
  const today = dateAt(cal, now);
  if (today.month === anchor.month && today.day === Math.min(anchor.day, monthDays(cal, today.year, anchor.month))) return fromLocalYears(whole, cal);
  // 对到那天中午：生日那一刻落在当天正中，不会因为浮点误差掉到前一天深夜
  const anchorMidnight = nextAnchorMinutes(cal, anchor, now - MINUTES_PER_DAY / 2);
  const next = anchorMidnight === null ? null : anchorMidnight + MINUTES_PER_DAY / 2;
  const yearDaysAvg = averageYearDays(cal);
  const untilYears = next === null ? 0 : Math.min(1, (next - now) / MINUTES_PER_DAY / yearDaysAvg);
  return fromLocalYears(whole + (1 - untilYears), cal);
}

/** 掷一个生日（月、日）：一年里每一天机会相同；公历照平年（不掷出 2/29） */
export function randomBirthday(cal, random = Math.random) {
  if (!cal) return null;
  const total = yearDays(cal, 2001);
  let left = Math.min(total - 1, Math.max(0, Math.floor(Number(random()) * total) || 0));
  for (let month = 1; month <= monthCount(cal); month += 1) {
    const days = monthDays(cal, 2001, month);
    if (left < days) return { month, day: left + 1 };
    left -= days;
  }
  return { month: 1, day: 1 };
}

/**
 * 注册时定生日（1.5.3）：模型照角色卡写的当地岁数 → 存的地球年。
 * 卡上写明生日（有历法）照它；岁数带小数（半岁的婴儿）照写的；
 * 整数岁数：重新注册且法定岁数没变就沿用旧年龄（生日不跳），否则在这一岁里随机落一天，
 * 不让所有人的生日都落在注册那天。
 */
export function registrationEarthAge(localAge, cal, nowMinutes = 0, { birthday = null, previousAge = null, random = Math.random } = {}) {
  const local = Number(localAge);
  if (!Number.isFinite(local) || local < 0) return null;
  const whole = Math.floor(local + 1e-9);
  if (cal && birthday && typeof birthday === 'object' && Number.isFinite(Number(birthday.month)) && Number.isFinite(Number(birthday.day))) {
    return earthAgeForBirthday(whole, cal, nowMinutes, birthday);
  }
  if (local - whole > 1e-6) return fromLocalYears(local, cal);
  const previous = previousAge === null || previousAge === undefined || previousAge === '' ? NaN : Number(previousAge);
  if (Number.isFinite(previous) && legalAge(previous, cal) === whole) return previous;
  const roll = Number(random());
  return fromLocalYears(whole + Math.min(0.999, Math.max(0, Number.isFinite(roll) ? roll : 0)), cal);
}

/** 一句给模型看的历法说明；没有历法回传空字串 */
export function describeCalendarForPrompt(cal, minutesPassed) {
  if (!cal) return '';
  const date = dateAt(cal, minutesPassed);
  const months = cal.mode === 'custom'
    ? cal.months.map((item) => `${item.name}${item.days}天`).join('、')
    : '公历（12 个月，平年 365 天，有闰年）';
  const week = cal.weekdays.length ? `；一周 ${cal.weekdays.length} 天（${cal.weekdays.join('、')}）` : '';
  const seasons = cal.seasons?.length ? `；季节：${cal.seasons.map((item) => `${item.name}（${monthName(cal, item.month)}${item.day}日起）`).join('、')}` : '';
  return [
    `今天是 ${formatCalendarDate(cal, date, { withTime: true, withWeekday: true })}${date.season ? `，${date.season}` : ''}。`,
    `本聊天的历法：${cal.era ? `${cal.era}，` : ''}${months}，一年约 ${Math.round(averageYearDays(cal) * 100) / 100} 天${week}${seasons}。`,
  ].join('');
}

// 目前生效的历法：呼叫端（index.js 依角色卡与全域设定）提供；测试可以换掉
let calendarProvider = () => null;
export function setCalendarProvider(fn) {
  calendarProvider = typeof fn === 'function' ? fn : () => null;
}
export function getActiveCalendar() {
  try { return normalizeCalendar(calendarProvider()); } catch { return null; }
}
