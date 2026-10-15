// Plain functions behind the Customers, Vehicles, Inventory, Parts, Canned jobs and Insurance screens.
// No imports on purpose: every rule here can be tested without a browser or a database.

export type Row = Record<string, unknown>

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/* ---------- numbers typed into a form ---------- */

/** "12.50", "$1,200", "  4. " -> a number. Blank or junk -> null, never a silent zero. */
export function parseMoney(v: unknown): number | null {
  const s = str(v).replace(/[$,\s]/g, '')
  if (s === '' || s === '.' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Whole numbers only (stock counts). "7" -> 7, "7.9" -> 7, "" -> null. */
export function parseCount(v: unknown): number | null {
  const n = parseMoney(v)
  return n === null ? null : Math.trunc(n)
}

export const roundCents = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** A number back into a text box: no trailing zeros the person did not type, and null/0 stay honest. */
export function fieldText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/* ---------- inventory ---------- */

export type StockState = 'out' | 'low' | 'ok'

/** Out when nothing is on the shelf. Low when the count has dropped to the reorder number (0 turns the warning off). */
export function stockState(onHand: unknown, reorder: unknown): StockState {
  const have = Number(onHand) || 0
  const at = Number(reorder) || 0
  if (have <= 0) return 'out'
  if (at > 0 && have <= at) return 'low'
  return 'ok'
}

export interface Margin {
  /** Money made on one: price minus cost. Null until both are known. */
  profit: number | null
  /** Share of the price that is profit, in percent (not markup). */
  marginPct: number | null
}

export function marginOf(cost: unknown, price: unknown): Margin {
  const c = parseMoney(cost)
  const p = parseMoney(price)
  // A cost of 0 usually means "not entered", so it never produces a 100% margin.
  if (c === null || p === null || p <= 0 || c <= 0) return { profit: c !== null && p !== null ? roundCents(p - c) : null, marginPct: null }
  return { profit: roundCents(p - c), marginPct: Math.round(((p - c) / p) * 1000) / 10 }
}

/** A whole-number margin such as "42%" or "-8%", so a column lines up; "" when it cannot be worked out. */
export function marginLabel(cost: unknown, price: unknown): string {
  const m = marginOf(cost, price).marginPct
  return m === null ? '' : `${Math.round(m)}%`
}

export type InvSort = 'name' | 'stock' | 'value' | 'margin'

export interface InvLike { name?: string | null; qty_on_hand?: number | null; qty_reorder?: number | null; cost?: number | null; retail_price?: number | null }

const nameKey = (p: InvLike) => str(p.name).toLowerCase()

/** The list order. "stock" puts what you are out of, then what is running low, first. */
export function sortInventory<T extends InvLike>(parts: T[], by: InvSort): T[] {
  const rank = (p: T) => ({ out: 0, low: 1, ok: 2 }[stockState(p.qty_on_hand, p.qty_reorder)])
  const value = (p: T) => (Number(p.qty_on_hand) || 0) * (Number(p.cost) || 0)
  const margin = (p: T) => marginOf(p.cost, p.retail_price).marginPct ?? Infinity
  const out = [...parts]
  out.sort((a, b) => {
    if (by === 'stock') return rank(a) - rank(b) || (Number(a.qty_on_hand) || 0) - (Number(b.qty_on_hand) || 0) || nameKey(a).localeCompare(nameKey(b))
    if (by === 'value') return value(b) - value(a) || nameKey(a).localeCompare(nameKey(b))
    if (by === 'margin') return margin(a) - margin(b) || nameKey(a).localeCompare(nameKey(b))
    return nameKey(a).localeCompare(nameKey(b))
  })
  return out
}

/** Part numbers are written "MO-301", "mo 301" and "MO301"; compare them the same way. */
export const normPart = (v: unknown): string => str(v).toUpperCase().replace(/[^A-Z0-9]/g, '')

export interface StockHit<T> { part: T; why: 'part number' | 'name' }

/**
 * Parts the shop already stocks that match a store result. A part number match is exact (after tidying);
 * a name match needs every word of the shorter name to appear in the other.
 */
export function matchStock<T extends { part_number?: string | null; supplier_part_number?: string | null; name?: string | null }>(
  stock: T[], partNumber: unknown, name: unknown,
): StockHit<T>[] {
  const pn = normPart(partNumber)
  const hits: StockHit<T>[] = []
  for (const p of stock) {
    if (pn.length >= 3 && (normPart(p.part_number) === pn || normPart(p.supplier_part_number) === pn)) hits.push({ part: p, why: 'part number' })
  }
  if (hits.length) return hits
  const words = str(name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
  if (words.length < 2) return hits
  for (const p of stock) {
    const hay = str(p.name).toLowerCase()
    const theirs = hay.split(/[^a-z0-9]+/).filter(w => w.length > 2)
    if (theirs.length < 2) continue
    const shorter = theirs.length <= words.length ? theirs : words
    const longer = theirs.length <= words.length ? words : theirs
    if (shorter.every(w => longer.includes(w))) hits.push({ part: p, why: 'name' })
  }
  return hits
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'set', 'kit', 'new', 'a', 'of'])
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/** What the person typed on the Parts lookup screen, matched against what is on the shelf (all words, any order, plurals folded). */
export function searchStock<T extends { part_number?: string | null; name?: string | null; brand?: string | null; category?: string | null }>(stock: T[], query: string, limit = 5): T[] {
  const words = str(query).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP_WORDS.has(w)).map(stem)
  if (!words.length) return []
  return stock.filter(p => {
    const hay = `${str(p.name)} ${str(p.part_number)} ${str(p.brand)} ${str(p.category)}`.toLowerCase()
    return words.every(w => hay.includes(w))
  }).slice(0, limit)
}

/* ---------- canned jobs ---------- */

export interface CannedPartLike { cost?: number | string | null; qty?: number | string | null }

/** Labor plus parts, the same sum the estimate editor uses when it drops the job in. */
export function cannedTotal(hours: unknown, rate: unknown, parts: CannedPartLike[]): number {
  const labor = (Number(hours) || 0) * (Number(rate) || 0)
  const partsSum = parts.reduce((s, p) => s + (Number(p.cost) || 0) * (Number(p.qty) || 1), 0)
  return roundCents(labor + partsSum)
}

/** "Oil change" and "Oil Change" are one category. */
export const sameCategory = (a: unknown, b: unknown): boolean => str(a).toLowerCase() === str(b).toLowerCase()

/** The category names to show, merged without caring about capitals; the first spelling wins. */
export function mergeCategories(saved: string[], extra: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of [...saved, ...extra]) {
    const t = str(c)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/* ---------- customers ---------- */

export const digitsOf = (v: unknown): string => str(v).replace(/\D/g, '')
export const last10 = (v: unknown): string => digitsOf(v).slice(-10)

export interface CustomerLike { id: string; name?: string | null; phone?: string | null; email?: string | null }

export interface DuplicateHit<T> { customer: T; why: 'phone' | 'email' | 'name' }

/** People already in the book who look like the one being typed in. Phone and email are strong; a bare name is a hint. */
export function findDuplicates<T extends CustomerLike>(book: T[], candidate: { id?: string; name?: unknown; phone?: unknown; email?: unknown }): DuplicateHit<T>[] {
  const phone = last10(candidate.phone)
  const email = str(candidate.email).toLowerCase()
  const name = str(candidate.name).toLowerCase().replace(/\s+/g, ' ')
  const hits: DuplicateHit<T>[] = []
  for (const c of book) {
    if (candidate.id && c.id === candidate.id) continue
    if (phone.length >= 10 && last10(c.phone) === phone) hits.push({ customer: c, why: 'phone' })
    else if (email.includes('@') && str(c.email).toLowerCase() === email) hits.push({ customer: c, why: 'email' })
    else if (name.length >= 4 && str(c.name).toLowerCase().replace(/\s+/g, ' ') === name) hits.push({ customer: c, why: 'name' })
  }
  return hits
}

/** Soft checks for the customer form. Empty fields are fine; wrong-looking ones get a plain sentence. */
export function contactProblems(phone: unknown, email: unknown): { phone?: string; email?: string } {
  const out: { phone?: string; email?: string } = {}
  const p = str(phone)
  if (p && digitsOf(p).length < 7) out.phone = 'That phone number looks too short. Include the area code.'
  const e = str(email)
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) out.email = 'That email does not look right. It should read name@example.com.'
  return out
}

/** Balance owed on invoices that have been sent. Drafts and voids are not owed yet. */
export const OWED_STATUSES = ['Unpaid', 'Partial', 'Sent']

export interface MoneyDoc { type: string; status: string; total: number; paid: number }

export function owedOn(docs: MoneyDoc[]): number {
  let sum = 0
  for (const d of docs) {
    if (d.type !== 'Invoice' || !OWED_STATUSES.includes(d.status)) continue
    const due = d.total - d.paid
    if (due > 0.005) sum += due
  }
  return roundCents(sum)
}

/** Paid so far on invoices and receipts, drafts and voids left out. */
export function paidOn(docs: MoneyDoc[]): number {
  let sum = 0
  for (const d of docs) {
    if (d.type === 'Estimate' || d.status === 'Draft' || d.status === 'Void') continue
    sum += Math.max(0, Math.min(d.paid, d.total > 0 ? d.total : d.paid))
  }
  return roundCents(sum)
}

/* ---------- vehicles ---------- */

export interface VehicleJob { id: string; ro: string; concern: string; status: string; created: string; mileage: number | null }

export interface Vehicle {
  key: string
  year: string
  make: string
  model: string
  color: string
  vin: string
  plate: string
  mileage: number | null
  ownerId: string
  owner: string
  /** Most recent repair order, ISO date. Empty when only a customer record has the car. */
  lastIn: string
  jobs: VehicleJob[]
}

export const mileageOf = (v: unknown): number | null => {
  const n = parseInt(str(v).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

const tidy = (v: unknown) => str(v).replace(/\s+/g, ' ')
const ymmKey = (y: string, m: string, d: string) => `${y}|${m}|${d}`.toLowerCase()
const cleanVin = (v: unknown) => { const s = str(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length >= 11 ? s : '' }

interface Seen {
  ownerId: string; owner: string; year: string; make: string; model: string; color: string; vin: string; plate: string
  mileage: number | null; job: VehicleJob | null; fromCustomer: boolean
}

/**
 * One entry per real car. A VIN settles it. Without a VIN the same owner with the same year, make and model is one car,
 * so a customer record and a repair order for it do not show up twice, while two owners of the same model stay two cars.
 */
export function buildVehicles(customers: Row[], jobs: Row[]): Vehicle[] {
  const seen: Seen[] = []
  for (const c of customers) {
    if (!tidy(c.vehicle_make) && !tidy(c.vehicle_model)) continue
    seen.push({
      ownerId: str(c.id), owner: tidy(c.name), year: tidy(c.vehicle_year), make: tidy(c.vehicle_make), model: tidy(c.vehicle_model),
      color: tidy(c.vehicle_color), vin: cleanVin(c.vehicle_vin), plate: tidy(c.vehicle_plate).toUpperCase(), mileage: mileageOf(c.vehicle_mileage), job: null, fromCustomer: true,
    })
  }
  for (const j of jobs) {
    if (!tidy(j.vehicle_make) && !tidy(j.vehicle_model)) continue
    const mileage = mileageOf(j.vehicle_mileage)
    seen.push({
      ownerId: str(j.customer_id), owner: tidy(j.customer_name), year: tidy(j.vehicle_year), make: tidy(j.vehicle_make), model: tidy(j.vehicle_model),
      color: tidy(j.vehicle_color), vin: cleanVin(j.vehicle_vin), plate: tidy(j.vehicle_plate).toUpperCase(), mileage,
      job: { id: str(j.id), ro: str(j.ro_number), concern: tidy(j.concern), status: str(j.status), created: str(j.created_at), mileage }, fromCustomer: false,
    })
  }

  const ownerKey = (s: Seen) => (s.ownerId ? `id:${s.ownerId}` : `name:${s.owner.toLowerCase()}`)
  const groups = new Map<string, Seen[]>()
  const byOwnerCar = new Map<string, string>() // owner + year/make/model -> group key that has a VIN
  for (const s of seen) {
    if (!s.vin) continue
    const k = `vin:${s.vin}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
    byOwnerCar.set(`${ownerKey(s)}|${ymmKey(s.year, s.make, s.model)}`, k)
  }
  for (const s of seen) {
    if (s.vin) continue
    const oc = `${ownerKey(s)}|${ymmKey(s.year, s.make, s.model)}`
    const k = byOwnerCar.get(oc) || `own:${oc}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }

  const out: Vehicle[] = []
  for (const [key, list] of groups) {
    const first = (pick: (s: Seen) => string) => list.map(pick).find(Boolean) || ''
    const card = list.find(s => s.fromCustomer)
    const js = list.filter(s => s.job).map(s => s.job as VehicleJob).sort((a, b) => b.created.localeCompare(a.created))
    const miles = list.map(s => s.mileage || 0).reduce((m, n) => Math.max(m, n), 0)
    out.push({
      key,
      year: card?.year || first(s => s.year), make: card?.make || first(s => s.make), model: card?.model || first(s => s.model),
      color: first(s => s.color), vin: first(s => s.vin), plate: first(s => s.plate),
      mileage: miles > 0 ? miles : null,
      ownerId: card?.ownerId || first(s => s.ownerId), owner: card?.owner || first(s => s.owner),
      lastIn: js[0]?.created || '', jobs: js,
    })
  }
  return out
}

export const carName = (v: Pick<Vehicle, 'year' | 'make' | 'model'>): string => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown vehicle'

export type VehicleSort = 'recent' | 'car' | 'owner'

export function sortVehicles(list: Vehicle[], by: VehicleSort): Vehicle[] {
  const out = [...list]
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  out.sort((a, b) => {
    if (by === 'owner') return cmp(a.owner || '￿', b.owner || '￿') || cmp(carName(a), carName(b))
    if (by === 'car') return cmp(carName(a), carName(b)) || cmp(a.owner, b.owner)
    // Recently in: newest repair order first, cars that never had one last.
    if (a.lastIn !== b.lastIn) return a.lastIn ? (b.lastIn ? b.lastIn.localeCompare(a.lastIn) : -1) : 1
    return cmp(carName(a), carName(b))
  })
  return out
}

export function matchesVehicle(v: Vehicle, query: string): boolean {
  const words = str(query).toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${carName(v)} ${v.owner} ${v.plate} ${v.vin} ${v.color}`.toLowerCase()
  return words.every(w => hay.includes(w))
}

/* ---------- insurance ---------- */

export interface ClaimLike {
  status?: string | null
  approved_amount?: unknown
  deductible?: unknown
  deductible_collected?: unknown
  supplement_status?: unknown
  supplement_amount_requested?: unknown
  supplement_amount_approved?: unknown
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export const claimIsOpen = (j: Pick<ClaimLike, 'status'>): boolean => !['Paid', 'Closed'].includes(str(j.status))
export const hasSupplement = (j: ClaimLike): boolean => !!str(j.supplement_status) && str(j.supplement_status) !== 'None'
export const owesDeductible = (j: ClaimLike): boolean => num(j.deductible) > 0 && !j.deductible_collected

/** What the insurer has agreed to pay in all: the first approval plus any approved supplement. */
export function claimApprovedTotal(j: ClaimLike): number {
  return roundCents(num(j.approved_amount) + (str(j.supplement_status) === 'Approved' || num(j.supplement_amount_approved) > 0 ? num(j.supplement_amount_approved) : 0))
}

/** A supplement that has been asked for and not yet decided. */
export const supplementWaiting = (j: ClaimLike): boolean => hasSupplement(j) && !['Approved', 'Denied'].includes(str(j.supplement_status))

/** Whole days since an ISO date, never negative. Empty when the date is missing. */
export function daysSince(iso: unknown, now: number = Date.now()): number | null {
  const t = new Date(str(iso)).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/** "Open 12 days", "Opened today". */
export function openForLabel(iso: unknown, now: number = Date.now()): string {
  const d = daysSince(iso, now)
  if (d === null) return ''
  if (d === 0) return 'Opened today'
  if (d === 1) return 'Open 1 day'
  return `Open ${d} days`
}

/* ---------- forms ---------- */

/** True when the form differs from what it started as. Key order does not matter. */
export function isDirty(now: unknown, before: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Row).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
    }
    return v
  }
  return JSON.stringify(norm(now)) !== JSON.stringify(norm(before))
}

/** The reason an error gives, as a sentence that ends in a full stop. Falls back to the given words. */
export function reasonOf(e: unknown, fallback: string): string {
  const raw = e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message || '') : ''
  const text = (raw || fallback).trim()
  return /[.!?]$/.test(text) ? text : text + '.'
}

/* ---------- parts lookup ---------- */

/** "$1,234.50". No imports, so this file can be tested on its own. */
export const usd = (n: unknown): string =>
  '$' + roundCents(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The store lookup calls its price levels budget, mid and premium. Shops say it differently. */
export function tierLabel(t: unknown): string {
  const k = str(t).toLowerCase()
  if (k === 'budget') return 'Budget'
  if (k === 'mid') return 'Mid-grade'
  if (k === 'premium') return 'Premium'
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Option'
}

/** Price each times how many. */
export const lineTotal = (price: unknown, qty: unknown): number => roundCents((Number(price) || 0) * Math.max(1, Number(qty) || 1))

/** What went wrong, and what to do, in plain words. */
export function lookupErrorText(status: number, code: unknown, message: unknown): string {
  const msg = str(message).trim()
  if (status === 401 || status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return 'Your sign-in has expired. Sign in again, then search again.'
  if (status === 429 || code === 'RATE_LIMITED') return 'You have searched a lot in a short time. Wait a minute, then search again.'
  if (/ai provider/i.test(msg)) return 'Parts lookup needs an AI connection first. Connect ChatGPT in Settings, then search again.'
  if (status === 400) return msg ? `${msg.replace(/[.!?]$/, '')}. Check the car and part, then search again.` : 'The search was not understood. Check the car and part, then search again.'
  if (status >= 500) return 'The lookup ran into a problem on our side. Try again in a minute.'
  return msg ? (/[.!?]$/.test(msg) ? msg : msg + '.') : 'The lookup did not finish. Try again.'
}

export interface PickPart { position?: string; name?: string; partNumber?: string; price?: number; url?: string; quantity?: number }
export interface PickOption { tier?: string; brand?: string; parts: PickPart[] }
export interface PickKit { name?: string; brand?: string; price?: number; url?: string; includes?: string }

/**
 * The message Ask Alpha receives. It names only what the lookup verified, and says the labor time is a generic baseline.
 * With no known labor rate it asks Alpha to use the shop's own rate instead of printing "$null".
 */
export function estimatePrompt(input: { vehicle: string; query: string; laborHours: number | null; laborRate: number | null; option?: PickOption; kit?: PickKit }): string {
  const lines = [`Build an estimate from these verified parts for ${input.vehicle || input.query}.`]
  if (input.laborHours) {
    lines.push(input.laborRate
      ? `Labor reference (generic baseline, check it): ${input.laborHours} hours at ${usd(input.laborRate)} per hour.`
      : `Labor reference (generic baseline, check it): ${input.laborHours} hours. Use the shop labor rate.`)
  } else {
    lines.push('No labor reference was found. Use the shop labor rate and ask me for the hours.')
  }
  if (input.option) {
    lines.push(`${[input.option.brand, tierLabel(input.option.tier)].filter(Boolean).join(' ')}:`)
    for (const p of input.option.parts) {
      lines.push(`- ${p.position || 'Part'}: ${str(p.name)} ${str(p.partNumber)} ${usd(p.price)} each, quantity ${Math.max(1, Number(p.quantity) || 1)} ${str(p.url)}`.replace(/ {2,}/g, ' ').trim())
    }
  }
  if (input.kit) lines.push(`Kit: ${str(input.kit.name)} ${usd(input.kit.price)} ${str(input.kit.url)}`.replace(/ {2,}/g, ' ').trim())
  return lines.join('\n')
}

/** "RO 1041" for a bare number, and the number as it is when it already starts with RO ("RO-2026-0043"). */
export function roLabel(n: string | null | undefined): string {
  const v = String(n ?? '').trim()
  if (!v) return ''
  return /^ro\b/i.test(v) ? v : `RO ${v}`
}
