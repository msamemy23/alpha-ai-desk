// Who a promotion reaches, worked out from the customer list. Pure: the server and the screen
// both call this, so the count you see before you send is the count that goes out.
//
// Consent is not a filter you can turn off. People who replied STOP, and people with no usable
// number, are always left out and counted so the screen can say so.

export type Row = Record<string, any>

const DAY = 86_400_000

export interface AudienceFilters {
  /** Has not been in for at least this many days. 0 or empty means no limit. */
  lastVisitMinDays?: number
  /** Has been in within this many days. 0 or empty means no limit. */
  lastVisitMaxDays?: number
  /** Drives one of these makes (case does not matter). */
  makes?: string[]
  yearMin?: number
  yearMax?: number
  /** Lifetime paid total. */
  minSpend?: number
  maxSpend?: number
  /** Has any of these tags (or all of them, with tagMode "all"). */
  tags?: string[]
  tagMode?: 'any' | 'all'
  /** Only people we also have an email for. */
  hasEmail?: boolean
}

export interface AudiencePerson {
  id: string
  name: string
  phone: string
  email: string
  smsOptedOut: boolean
  tags: string[]
  vehicles: Array<{ make: string; year: number | null }>
  lastVisit: number | null
  spend: number
}

export const emptyFilters = (): AudienceFilters => ({})

const num = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const list = (v: unknown): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return [...new Set(raw.map(x => String(x).trim()).filter(Boolean).map(x => x.slice(0, 40)))].slice(0, 20)
}

/** Clean what came from a form or a saved record. Anything unusable is dropped. */
export function normalizeFilters(raw: unknown): AudienceFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: AudienceFilters = {}
  const min = num(r.lastVisitMinDays); if (min) out.lastVisitMinDays = Math.min(Math.floor(min), 3650)
  const max = num(r.lastVisitMaxDays); if (max) out.lastVisitMaxDays = Math.min(Math.floor(max), 3650)
  const makes = list(r.makes); if (makes.length) out.makes = makes
  const y1 = num(r.yearMin); if (y1 && y1 >= 1900 && y1 <= 2100) out.yearMin = Math.floor(y1)
  const y2 = num(r.yearMax); if (y2 && y2 >= 1900 && y2 <= 2100) out.yearMax = Math.floor(y2)
  const s1 = num(r.minSpend); if (s1) out.minSpend = s1
  const s2 = num(r.maxSpend); if (s2) out.maxSpend = s2
  const tags = list(r.tags); if (tags.length) { out.tags = tags; out.tagMode = r.tagMode === 'all' ? 'all' : 'any' }
  if (r.hasEmail === true) out.hasEmail = true
  return out
}

/** The filters in a sentence, e.g. "Not in for 90+ days, drives Toyota or Honda, spent $500+". */
export function describeFilters(f: AudienceFilters): string {
  const bits: string[] = []
  if (f.lastVisitMinDays && f.lastVisitMaxDays) bits.push(`last in between ${f.lastVisitMinDays} and ${f.lastVisitMaxDays} days ago`)
  else if (f.lastVisitMinDays) bits.push(`not in for ${f.lastVisitMinDays}+ days`)
  else if (f.lastVisitMaxDays) bits.push(`in within the last ${f.lastVisitMaxDays} days`)
  if (f.makes?.length) bits.push(`drives ${f.makes.join(' or ')}`)
  if (f.yearMin && f.yearMax) bits.push(`model year ${f.yearMin} to ${f.yearMax}`)
  else if (f.yearMin) bits.push(`model year ${f.yearMin} or newer`)
  else if (f.yearMax) bits.push(`model year ${f.yearMax} or older`)
  if (f.minSpend && f.maxSpend) bits.push(`spent $${f.minSpend} to $${f.maxSpend}`)
  else if (f.minSpend) bits.push(`spent $${f.minSpend}+`)
  else if (f.maxSpend) bits.push(`spent under $${f.maxSpend}`)
  if (f.tags?.length) bits.push(`tagged ${f.tags.join(f.tagMode === 'all' ? ' and ' : ' or ')}`)
  if (f.hasEmail) bits.push('has an email address')
  if (!bits.length) return 'Everyone you can text'
  const s = bits.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const usablePhone = (v: unknown) => digits(v).length >= 10
const phoneKey = (v: unknown) => digits(v).slice(-10)

export interface AudienceResult {
  matched: AudiencePerson[]
  /** Why people were left out, by reason, so the screen can show "12 replied STOP". */
  left: { optedOut: number; noPhone: number; sharedNumber: number; filtered: number }
  total: number
}

/**
 * Apply the filters. Consent and number checks come first, so people who replied STOP, have no usable number
 * or share a number with someone already on the list are left out and counted. With `consent: false` only the
 * filters run: the automation engine uses that, because it applies the same consent rules itself and lists
 * each person it leaves out, with the reason, in the preview.
 */
export function matchAudience(people: readonly AudiencePerson[], rawFilters: AudienceFilters, now: number, opts: { consent?: boolean } = {}): AudienceResult {
  const consent = opts.consent !== false
  const f = normalizeFilters(rawFilters)
  const left = { optedOut: 0, noPhone: 0, sharedNumber: 0, filtered: 0 }
  const matched: AudiencePerson[] = []
  const stopped = new Set(people.filter(p => p.smsOptedOut && usablePhone(p.phone)).map(p => phoneKey(p.phone)))
  const seen = new Set<string>()
  const wantMakes = (f.makes || []).map(m => m.toLowerCase())
  const wantTags = (f.tags || []).map(t => t.toLowerCase())

  for (const p of people) {
    if (consent && (p.smsOptedOut || (usablePhone(p.phone) && stopped.has(phoneKey(p.phone))))) { left.optedOut += 1; continue }
    if (consent && !usablePhone(p.phone)) { left.noPhone += 1; continue }
    const days = p.lastVisit === null ? null : Math.floor((now - p.lastVisit) / DAY)
    let ok = true
    if (f.lastVisitMinDays) ok = ok && (days === null || days >= f.lastVisitMinDays)
    if (f.lastVisitMaxDays) ok = ok && days !== null && days <= f.lastVisitMaxDays
    if (wantMakes.length) ok = ok && p.vehicles.some(v => wantMakes.includes(v.make.toLowerCase()))
    if (f.yearMin) ok = ok && p.vehicles.some(v => v.year !== null && v.year >= (f.yearMin as number))
    if (f.yearMax) ok = ok && p.vehicles.some(v => v.year !== null && v.year <= (f.yearMax as number))
    if (f.minSpend) ok = ok && p.spend >= f.minSpend
    if (f.maxSpend) ok = ok && p.spend <= f.maxSpend
    if (wantTags.length) {
      const have = p.tags.map(t => t.toLowerCase())
      ok = ok && (f.tagMode === 'all' ? wantTags.every(t => have.includes(t)) : wantTags.some(t => have.includes(t)))
    }
    if (f.hasEmail) ok = ok && /@/.test(p.email)
    if (!ok) { left.filtered += 1; continue }
    if (consent && seen.has(phoneKey(p.phone))) { left.sharedNumber += 1; continue }
    seen.add(phoneKey(p.phone))
    matched.push(p)
  }
  return { matched, left, total: people.length }
}

const stamp = (v: unknown): number | null => {
  if (!v) return null
  const t = new Date(String(v)).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Turn raw rows into people. `docs` are invoices and receipts with `__paid` already worked out by the server
 * (so this file never touches money maths). `vehicles` are rows from the vehicles table.
 */
export function buildPeople(customers: readonly Row[], docs: readonly Row[], vehicles: readonly Row[]): AudiencePerson[] {
  const last = new Map<string, number>()
  const spend = new Map<string, number>()
  for (const d of docs) {
    const id = d.customer_id ? String(d.customer_id) : ''
    if (!id) continue
    const t = stamp(d.doc_date) ?? stamp(d.created_at)
    if (t !== null && (last.get(id) ?? 0) < t) last.set(id, t)
    const paid = Number(d.__paid)
    if (Number.isFinite(paid) && paid > 0) spend.set(id, (spend.get(id) ?? 0) + paid)
  }
  const carsOf = new Map<string, Array<{ make: string; year: number | null }>>()
  const add = (cid: unknown, make: unknown, year: unknown) => {
    const id = cid ? String(cid) : ''
    const m = String(make ?? '').trim()
    if (!id || !m) return
    const y = Number(year)
    const arr = carsOf.get(id) || []
    arr.push({ make: m, year: Number.isInteger(y) && y > 1900 ? y : null })
    carsOf.set(id, arr)
  }
  for (const v of vehicles) add(v.customer_id, v.make, v.year)
  for (const c of customers) add(c.id, c.vehicle_make, c.vehicle_year)
  return customers.map(c => {
    const id = String(c.id)
    return {
      id,
      name: String(c.name ?? ''),
      phone: String(c.phone ?? ''),
      email: String(c.email ?? ''),
      smsOptedOut: c.sms_opted_out === true,
      tags: Array.isArray(c.tags) ? c.tags.map((t: unknown) => String(t)) : [],
      vehicles: carsOf.get(id) || [],
      lastVisit: last.get(id) ?? stamp(c.last_visit) ?? null,
      spend: Math.round((spend.get(id) ?? 0) * 100) / 100,
    }
  })
}
