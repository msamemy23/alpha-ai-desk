/**
 * Finding customers who may be the same person. It only ever suggests: nothing here changes a record, and a pair is never
 * merged without a person looking at it (see merge.ts). Imports nothing, so it runs in the browser, on the server and under
 * `node --test`. Keep it to plain TypeScript (no enums, no parameter properties).
 */

export interface DupInput {
  id: string
  name?: unknown
  phone?: unknown
  email?: unknown
  vehicle_vin?: unknown
  vehicle_plate?: unknown
}

export type DupReason = 'phone' | 'email' | 'vin' | 'name' | 'plate'

export interface DupPair {
  a: string
  b: string
  reasons: DupReason[]
  /** "strong" is the same phone or email, or the same name on the same car. "possible" is worth a look but proves nothing. */
  strength: 'strong' | 'possible'
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** Ten-digit phone, or '' when it is too short or an obvious placeholder (all one digit, or a straight run). */
export function phoneKey(v: unknown): string {
  const d = str(v).replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length >= 10 ? d.slice(-10) : ''
  if (ten.length !== 10) return ''
  if (/^(\d)\1+$/.test(ten) || ten === '1234567890' || ten === '0123456789') return ''
  return ten
}

export function emailKey(v: unknown): string {
  const e = str(v).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''
}

const GENERIC = new Set(['walk in', 'walk-in', 'walkin', 'customer', 'new customer', 'cash', 'cash customer', 'unknown', 'no name', 'n/a', 'na', 'none', 'test', 'tbd'])

/** A name for comparing: lower case, "Last, First" turned around, punctuation and suffixes dropped. '' when it is too generic to compare. */
export function nameKey(v: unknown): string {
  let n = str(v).toLowerCase().replace(/\s+/g, ' ').trim()
  const comma = n.split(',')
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) n = `${comma[1].trim()} ${comma[0].trim()}`
  n = n.replace(/[^a-z0-9' -]/g, ' ').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (n.length < 4 || GENERIC.has(n)) return ''
  return n
}

const vinKey = (v: unknown): string => {
  const s = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length === 17 ? s : ''
}

const plateKey = (v: unknown): string => {
  const s = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length >= 5 ? s : ''
}

const MAX_BUCKET = 25

/**
 * Every pair in the book that shares something worth noticing. Pairs are listed strongest first. A shared value held by
 * a crowd (more than 25 customers, like a shop's own number typed in as a placeholder) is ignored.
 */
export function findDuplicatePairs(book: DupInput[]): DupPair[] {
  const pairs = new Map<string, { a: string; b: string; reasons: Set<DupReason> }>()
  const add = (x: string, y: string, why: DupReason) => {
    if (x === y) return
    const [a, b] = x < y ? [x, y] : [y, x]
    const key = `${a}|${b}`
    const hit = pairs.get(key) || { a, b, reasons: new Set<DupReason>() }
    hit.reasons.add(why)
    pairs.set(key, hit)
  }
  const index = (why: DupReason, keyOf: (c: DupInput) => string) => {
    const buckets = new Map<string, string[]>()
    for (const c of book) {
      const k = keyOf(c)
      if (!k) continue
      const list = buckets.get(k)
      if (list) list.push(c.id); else buckets.set(k, [c.id])
    }
    for (const ids of buckets.values()) {
      if (ids.length < 2 || ids.length > MAX_BUCKET) continue
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], why)
    }
  }
  index('phone', c => phoneKey(c.phone))
  index('email', c => emailKey(c.email))
  index('vin', c => vinKey(c.vehicle_vin))
  index('plate', c => plateKey(c.vehicle_plate))
  index('name', c => nameKey(c.name))

  const out: DupPair[] = []
  for (const p of pairs.values()) {
    const reasons = (['phone', 'email', 'vin', 'plate', 'name'] as DupReason[]).filter(r => p.reasons.has(r))
    const strong = p.reasons.has('phone') || p.reasons.has('email') || (p.reasons.has('name') && (p.reasons.has('vin') || p.reasons.has('plate')))
    out.push({ a: p.a, b: p.b, reasons, strength: strong ? 'strong' : 'possible' })
  }
  const weight = (p: DupPair): number => (p.strength === 'strong' ? 100 : 0) + p.reasons.length * 10 + (p.reasons.includes('phone') ? 5 : 0)
  return out.sort((x, y) => weight(y) - weight(x) || x.a.localeCompare(y.a))
}

export const REASON_TEXT: Record<DupReason, string> = {
  phone: 'Same phone number',
  email: 'Same email',
  vin: 'Same VIN',
  plate: 'Same license plate',
  name: 'Same name',
}

/**
 * A customer that looks like it was typed in to try the software out, so the owner can find and clean those up one at a time.
 * Returns why it looks that way, or null. It only labels; it never changes or hides anything.
 */
export function looksLikeTest(c: { name?: unknown; email?: unknown }): string | null {
  const name = str(c.name).trim().toLowerCase()
  if (/^(test|testing|tester|asdf|qwer|xxx+|zzz+|demo|sample|dummy|fake)\b/.test(name) || /\b(test|testing|dummy)\s*(customer|user|person)?$/.test(name)) return 'The name looks like a test entry.'
  if (/^(john|jane) doe$/.test(name)) return 'The name looks like a placeholder.'
  const email = str(c.email).trim().toLowerCase()
  if (/(^|[._-])(test|testing|fake|dummy)([._-]|@)/.test(email) || /@(example\.(com|org|net)|test\.com|mailinator\.com)$/.test(email)) return 'The email looks like a test address.'
  return null
}
