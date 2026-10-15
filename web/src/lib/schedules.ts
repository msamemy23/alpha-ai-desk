const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function getWallClock(date: Date, timeZone: string) {
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

const INTERVAL_RE = /^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i

/** How many milliseconds an "every 30 minutes" style schedule waits, or null for a time-of-day schedule. */
export function intervalMs(schedule: string): number | null {
  const interval = schedule.trim().match(INTERVAL_RE)
  if (!interval) return null
  const amount = Number(interval[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount * ((interval[2] || 'h').toLowerCase().startsWith('m') ? 60_000 : 3_600_000)
}

/** True when the text is a schedule the server understands. */
export function isValidSchedule(schedule: string): boolean {
  return intervalMs(schedule) !== null || parseScheduleTime(schedule) !== null
}

/**
 * The most recent moment at or before `now` when a time-of-day schedule was meant to run, in the shop's own
 * clock. Daylight saving is handled because every candidate is built from a local date and time of day.
 * Returns null for "every N minutes" schedules, which have no fixed time of day.
 */
export function previousScheduledRun(schedule: string, timeZone = 'America/Chicago', now = new Date()): Date | null {
  if (intervalMs(schedule) !== null) return null
  const time = parseScheduleTime(schedule)
  if (!time) return null
  const wall = getWallClock(now, timeZone)
  let daysBack = time.weekday === undefined ? 0 : (wall.weekday - time.weekday + 7) % 7
  const build = (back: number) => {
    const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day - back, 12, 0, 0))
    return zonedTimeToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: time.hour, minute: time.minute }, timeZone)
  }
  let candidate = build(daysBack)
  if (candidate.getTime() > now.getTime()) {
    daysBack += time.weekday === undefined ? 1 : 7
    candidate = build(daysBack)
  }
  return candidate
}

/**
 * Is a run due right now? A time-of-day schedule is due when its latest scheduled moment is newer than both
 * the last successful run and the moment the automation was switched on. So switching an automation on at
 * 3pm never fires a 9am run that already passed, and a missed run still happens at the next check.
 * With no history at all (older settings that never recorded when they were switched on) it is due once.
 */
export function isScheduleDueSince(input: {
  schedule: string
  timeZone?: string
  lastRun?: string | null
  enabledAt?: string | null
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  const times = [input.lastRun, input.enabledAt]
    .map(v => (v ? new Date(v).getTime() : NaN))
    .filter(t => Number.isFinite(t))
  const baseline = times.length ? Math.max(...times) : null
  const every = intervalMs(input.schedule)
  if (every !== null) return baseline === null || now.getTime() - baseline >= every
  const previous = previousScheduledRun(input.schedule, input.timeZone || 'America/Chicago', now)
  if (!previous) return false
  return baseline === null || previous.getTime() > baseline
}

/** A key that is the same for every check inside one scheduled run and different for the next one. */
export function occurrenceKey(schedule: string, timeZone = 'America/Chicago', now = new Date()): string {
  const every = intervalMs(schedule)
  if (every !== null) return `i${Math.floor(now.getTime() / every)}`
  const previous = previousScheduledRun(schedule, timeZone, now)
  return previous ? `t${previous.toISOString().slice(0, 16)}` : scheduleWindowKey(schedule, timeZone, now)
}
