// No imports: the workflow engine and its tests load this file directly.

/** The shop's own wall-clock date and time, so "today" means the shop's day (a Houston evening is not tomorrow). */
export function shopLocalTime(shop: unknown, now = new Date()): string {
  const tz = shop && typeof shop === 'object' && typeof (shop as Record<string, unknown>).timezone === 'string' && (shop as Record<string, unknown>).timezone
    ? String((shop as Record<string, unknown>).timezone) : 'America/Chicago'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(now)
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).format(now)
  }
}
