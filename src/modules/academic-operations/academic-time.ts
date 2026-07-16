const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string) {
  if (!DATE_PATTERN.test(value)) throw new Error('日期必须使用 YYYY-MM-DD 格式');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('日期无效');
  }
  return date;
}

export function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function zonedDateTime(date: string, minuteOfDay: number, timezone: string) {
  const initialDay = parseDateOnly(date);
  const day = minuteOfDay === 1440 ? addUtcDays(initialDay, 1) : initialDay;
  const localDate = formatDateOnly(day);
  const normalizedMinute = minuteOfDay === 1440 ? 0 : minuteOfDay;
  const hour = Math.floor(normalizedMinute / 60);
  const minute = normalizedMinute % 60;
  const localAsUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
  let candidate = localAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timezoneOffsetMs(new Date(candidate), timezone);
    const adjusted = localAsUtc - offset;
    if (adjusted === candidate) break;
    candidate = adjusted;
  }

  const result = new Date(candidate);
  assertLocalParts(result, timezone, localDate, hour, minute);
  return result;
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const displayedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return displayedAsUtc - date.getTime();
}

function assertLocalParts(date: Date, timezone: string, expectedDate: string, hour: number, minute: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const actualDate = `${values.year}-${values.month}-${values.day}`;
  if (actualDate !== expectedDate || Number(values.hour) !== hour || Number(values.minute) !== minute) {
    throw new Error('该时区下的本地时间不存在或有歧义');
  }
}
