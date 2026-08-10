export const centreTimeZone = 'America/New_York';

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: centreTimeZone,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric'
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: centreTimeZone,
  hour: 'numeric',
  minute: '2-digit'
});

const weekdayIndex: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function parts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: centreTimeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const get = (type: string) => formatted.find((part) => part.type === type)?.value || '';
  return {
    weekday: get('weekday'),
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  };
}

export function centreDateKey(value: string | Date) {
  const valueParts = parts(value);
  return `${valueParts.year}-${valueParts.month}-${valueParts.day}`;
}

export function centreHour(value: string | Date) {
  return parts(value).hour;
}

export function startOfCentreWeekKey(value: Date) {
  const valueParts = parts(value);
  return addDaysToDateKey(centreDateKey(value), -weekdayIndex[valueParts.weekday]);
}

export function addDaysToDateKey(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function dateKeyToDate(key: string) {
  return new Date(`${key}T12:00:00Z`);
}

export function formatCentreDateKey(key: string) {
  return dateFormatter.format(dateKeyToDate(key));
}

export function formatCentreDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatCentreTime(value: string) {
  return timeFormatter.format(new Date(value));
}

export function formatCentreRange(start: string, end: string) {
  return `${formatCentreDateTime(start)} - ${formatCentreTime(end)}`;
}
