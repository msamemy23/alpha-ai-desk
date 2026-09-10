const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function getWallClock(date: Date, timeZone: string) {
  let safeTimeZone = timeZone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(date)
  } catch {
    safeTimeZone = 'America/Chicago'
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS.indexOf(String(values.weekday).slice(0, 3).toLowerCase()),
  }
}

/** Convert a local wall-clock date in an IANA zone to its UTC instant. */
export function zonedTimeToUtc(wall: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timeZone: string): Date {
  const desired = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second || 0)
  let guess = desired
  for (let i = 0; i < 4; i += 1) {
    const actual = getWallClock(new Date(guess), timeZone)
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    guess += desired - actualAsUtc
  }
  return new Date(guess)
}

function parseTime(hourText: string, minuteText = '0', ampm?: string) {
  let hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const suffix = ampm?.toLowerCase()
  if (suffix && (hour < 1 || hour > 12)) return null
  if (suffix === 'pm' && hour < 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  return { hour, minute }
}

export function parseScheduleTime(schedule: string): { hour: number; minute: number; weekday?: number } | null {
  const daily = schedule.trim().match(/^(?:(?:daily)\s+(?:at\s+)?)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i) || schedule.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (daily) return parseTime(daily[1], daily[2], daily[3])
  const named = schedule.trim().match(/^(?:weekly\s+on\s+)?(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i)
  if (!named) return null
  const time = parseTime(named[2] || '0', named[3] || '0', named[4])
  return time ? { ...time, weekday: WEEKDAYS.indexOf(named[1].slice(0, 3).toLowerCase()) } : null
}

export function nextScheduledRun(schedule: string, timeZone = 'America/Chicago', now = new Date()): Date {
  const interval = schedule.trim().match(/^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i)
  if (interval) {
    const amount = Number(interval[1])
    const unit = (interval[2] || 'h').toLowerCase()
    return new Date(now.getTime() + amount * (unit.startsWith('m') ? 60_000 : 3_600_000))
  }
  const time = parseScheduleTime(schedule)
  if (!time) return new Date(now.getTime() + 86_400_000)
  const wall = getWallClock(now, timeZone)
  let daysUntil = time.weekday === undefined ? 0 : (time.weekday - wall.weekday + 7) % 7
  if (daysUntil === 0 && time.weekday === undefined && (time.hour < wall.hour || (time.hour === wall.hour && time.minute <= wall.minute))) daysUntil = 1
  if (daysUntil === 0 && time.weekday !== undefined && (time.hour < wall.hour || (time.hour === wall.hour && time.minute <= wall.minute))) daysUntil = 7
  const candidate = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + daysUntil, 12, 0, 0))
  return zonedTimeToUtc({ year: candidate.getUTCFullYear(), month: candidate.getUTCMonth() + 1, day: candidate.getUTCDate(), hour: time.hour, minute: time.minute }, timeZone)
}

export function isScheduleDue(schedule: string, lastRun: string | null | undefined, timeZone = 'America/Chicago', now = new Date()): boolean {
  if (!lastRun) return true
  const last = new Date(lastRun)
  if (Number.isNaN(last.getTime())) return true
  const interval = schedule.trim().match(/^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i)
  if (interval) {
    const amount = Number(interval[1]) * ((interval[2] || 'h').toLowerCase().startsWith('m') ? 60_000 : 3_600_000)
    return now.getTime() - last.getTime() >= amount
  }
  const next = nextScheduledRun(schedule, timeZone, last)
  return now.getTime() >= next.getTime()
}

export function scheduleWindowKey(schedule: string, timeZone = 'America/Chicago', now = new Date()): string {
  const wall = getWallClock(now, timeZone)
  const interval = schedule.trim().match(/^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i)
  if (interval) {
    const ms = Number(interval[1]) * ((interval[2] || 'h').toLowerCase().startsWith('m') ? 60_000 : 3_600_000)
    return String(Math.floor(now.getTime() / ms))
  }
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`
}
