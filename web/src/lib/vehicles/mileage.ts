/**
 * Odometer readings for one vehicle: the ones written on repair orders, the one on the customer card and the ones the shop
 * logged by hand. Works out the last known mileage, flags a reading that is lower than an earlier one, and estimates miles
 * per year. Imports nothing, so it runs in the browser, on the server and under `node --test`.
 */

export type ReadingSource = 'repair_order' | 'logged' | 'card'

export interface Reading {
  /** Unique within the list, e.g. "job:abc" or "log:12". */
  id: string
  /** ISO date or timestamp the reading was taken. Empty when the source has no date. */
  at: string
  miles: number
  source: ReadingSource
  /** Plain words for the screen, e.g. "RO 1042" or "Logged by hand". */
  label: string
  note: string
}

export const MAX_MILES = 2_000_000

/** Whole miles from whatever was typed ("84,210 mi"), or null when it is not a usable mileage. */
export function parseMiles(v: unknown): number | null {
  const s = String(v ?? '').replace(/[^\d]/g, '')
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 && n <= MAX_MILES ? n : null
}

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : NaN
}

export interface MileageRow extends Reading {
  /** Lower than the reading just before it in time. Could be a typo or a replaced odometer. */
  lower: boolean
  /** More than 60,000 miles in under a year, which is rarely real. */
  jump: boolean
}

export interface MileageSummary {
  /** Newest first. Readings with no date go last. */
  rows: MileageRow[]
  lastKnown: { miles: number; at: string; label: string } | null
  /** Rounded to the nearest 100, or null until two readings at least 90 days apart exist. */
  milesPerYear: number | null
  /** Readings that look wrong, for one plain line on screen. */
  flagged: number
}

export function summarizeMileage(list: Reading[]): MileageSummary {
  const dated = list.filter(r => Number.isFinite(time(r.at))).sort((a, b) => time(a.at) - time(b.at) || a.miles - b.miles)
  const undated = list.filter(r => !Number.isFinite(time(r.at)))
  const flags = new Map<string, { lower: boolean; jump: boolean }>()
  // Each reading is compared with the last one that looked believable, so one typo does not flag everything after it.
  let ref: Reading | null = null
  for (const r of dated) {
    const lower = ref !== null && r.miles < ref.miles
    const days = ref ? (time(r.at) - time(ref.at)) / 86_400_000 : 0
    const jump = ref !== null && r.miles - ref.miles > 60_000 && days < 365
    flags.set(r.id, { lower, jump })
    if (!jump) ref = r
  }
  const rows: MileageRow[] = [...dated].reverse().map(r => ({ ...r, ...(flags.get(r.id) as { lower: boolean; jump: boolean }) }))
  for (const r of undated) rows.push({ ...r, lower: false, jump: false })

  // The last known mileage is the newest reading that looks believable: not a sudden jump and not lower than the one before it.
  const best: MileageRow | null = rows.find(r => !r.jump && !r.lower) || rows.find(r => !r.jump) || null
  const lastKnown = best ? { miles: best.miles, at: best.at, label: best.label } : null

  let milesPerYear: number | null = null
  const good = dated.filter(r => !flags.get(r.id)?.lower && !flags.get(r.id)?.jump)
  if (good.length >= 2) {
    const first = good[0]
    const last = good[good.length - 1]
    const days = (time(last.at) - time(first.at)) / 86_400_000
    if (days >= 90 && last.miles > first.miles) milesPerYear = Math.round(((last.miles - first.miles) / days) * 365 / 100) * 100
  }
  return { rows, lastKnown, milesPerYear, flagged: rows.filter(r => r.lower || r.jump).length }
}

export type ReadingCheck = { ok: true; warning: string } | { ok: false; error: string }

/** Is this new reading something to save? A lower number than the last known one is allowed only when the person confirms it. */
export function checkReading(miles: unknown, lastKnown: number | null): ReadingCheck {
  const n = parseMiles(miles)
  if (n === null) return { ok: false, error: `Enter the odometer as a whole number up to ${MAX_MILES.toLocaleString('en-US')}.` }
  if (lastKnown !== null && n < lastKnown) return { ok: true, warning: `That is lower than the last known mileage, ${lastKnown.toLocaleString('en-US')}. Save it only if the odometer was replaced or the earlier number was a typo.` }
  if (lastKnown !== null && n - lastKnown > 60_000) return { ok: true, warning: `That is ${(n - lastKnown).toLocaleString('en-US')} miles more than the last known mileage. Check it before saving.` }
  return { ok: true, warning: '' }
}
