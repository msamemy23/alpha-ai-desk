/**
 * What changed on a vehicle since its last inspection, and how fast its tires and brakes are wearing.
 * Works on the short digest kept beside every inspection (or on the full checklist, turned into the same digest),
 * so the history screen never has to load every photo ever taken.
 */

import { digestOf } from './dvi.ts'
import type { DigestItem, DviSection } from './dvi.ts'
import { measureText, rateMeasure, wearPlan, wearWords } from './dvi-measure.ts'
import type { MeasureKind, WearPlan } from './dvi-measure.ts'

/* ---------- is it the same car ---------- */

const words = (s: string): string[] => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
export const vehicleKey = (vehicle: string): string => words(vehicle).join(' ')
/** "Walk-in: Dana Ruiz" and "dana ruiz" are the same person. */
export const personKey = (name: string): string => words(String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '')).join(' ')

export interface VehicleRef { customerId?: string | null; customerName: string; vehicle: string; vin?: string | null }

const cleanVin = (v: unknown): string => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Two inspections are for the same vehicle when the VIN matches, or when the customer and the vehicle description both match.
 * A description counts as a match when every word of the shorter one is in the longer one ("2018 Camry" and "2018 Toyota Camry LE").
 * Two different customers with the same model of car are never joined.
 */
export function sameVehicle(a: VehicleRef, b: VehicleRef): boolean {
  const va = cleanVin(a.vin), vb = cleanVin(b.vin)
  if (va.length >= 11 && vb.length >= 11) return va === vb
  const ka = words(a.vehicle), kb = words(b.vehicle)
  if (ka.length === 0 || kb.length === 0) return false
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
  const longSet = new Set(long)
  if (!short.every(w => longSet.has(w))) return false
  if (a.customerId && b.customerId) return a.customerId === b.customerId
  const pa = personKey(a.customerName), pb = personKey(b.customerName)
  return pa !== '' && pa === pb
}

/** "84,210" or "84210 mi" -> 84210. Anything that is not a believable odometer reading -> null. */
export function milesOf(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 && n < 2_000_000 ? Math.round(n) : null
}

/* ---------- a visit, for comparing ---------- */

export interface Visit {
  id: string
  /** ISO date-time the inspection was made. */
  at: string
  tech: string
  items: DigestItem[]
  miles: number | null
  /** The customer's answers on that visit, by checklist line id. */
  decisions: Record<string, string>
}

export function visitFromSections(o: { id: string; at: string; tech: string; sections: DviSection[]; miles?: number | null; decisions?: Record<string, string> }): Visit {
  return { id: o.id, at: o.at, tech: o.tech, items: digestOf(o.sections), miles: o.miles ?? null, decisions: o.decisions ?? {} }
}

/** The visits before this one, newest first. */
export function earlierVisits<T extends { id: string; at: string }>(current: { id: string; at: string }, all: T[]): T[] {
  const t = Date.parse(current.at)
  return all.filter(v => v.id !== current.id && (Number.isFinite(t) ? Date.parse(v.at) < t : true)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/* ---------- what changed ---------- */

export type ChangeKind = 'worse' | 'new' | 'declined' | 'still' | 'better' | 'fixed'

export interface Change {
  kind: ChangeKind
  section: string
  name: string
  now: 'g' | 'y' | 'r'
  was: 'g' | 'y' | 'r' | null
  /** One plain sentence: "Was good, needs work now." */
  words: string
  /** When both visits have a reading of the same kind: both readings written out, and how fast it is wearing. */
  reading?: { before: string; now: string; wear: string; plan: WearPlan; kind: MeasureKind }
}

const RANK = { g: 0, y: 1, r: 2 } as const
const KIND_ORDER: ChangeKind[] = ['worse', 'new', 'declined', 'still', 'better', 'fixed']
const LABEL = { g: 'good', y: 'worth watching', r: 'needs work' } as const

const itemKey = (d: { s: string; n: string }) => `${words(d.s).join(' ')}|${words(d.n).join(' ')}`

/** Compare a new inspection with the last one on the same car. Lines that were fine and still are fine are left out. */
export function compareVisits(prior: Visit, now: Visit): Change[] {
  const byKey = new Map<string, DigestItem>()
  const byName = new Map<string, DigestItem>()
  for (const d of prior.items) { byKey.set(itemKey(d), d); if (!byName.has(words(d.n).join(' '))) byName.set(words(d.n).join(' '), d) }
  const out: Change[] = []
  const seen = new Set<DigestItem>()
  for (const d of now.items) {
    const p = byKey.get(itemKey(d)) ?? byName.get(words(d.n).join(' ')) ?? null
    if (p) seen.add(p)
    const reading = p && p.m && d.m && p.m.kind === d.m.kind ? readingChange(p, d, prior, now) : undefined
    let kind: ChangeKind | null = null
    let sentence = ''
    if (!p) {
      if (d.r !== 'g') { kind = 'new'; sentence = `New this visit: ${LABEL[d.r]}.` }
    } else if (RANK[d.r] > RANK[p.r]) {
      kind = 'worse'; sentence = `Was ${LABEL[p.r]}, now ${LABEL[d.r]}.`
    } else if (RANK[d.r] < RANK[p.r]) {
      if (d.r === 'g') { kind = 'fixed'; sentence = `Was ${LABEL[p.r]}, now good.` } else { kind = 'better'; sentence = `Was ${LABEL[p.r]}, now ${LABEL[d.r]}.` }
    } else if (d.r !== 'g') {
      const declined = !!p.i && prior.decisions[p.i] === 'declined'
      kind = declined ? 'declined' : 'still'
      sentence = declined ? `The customer said no last time. Still ${LABEL[d.r]}.` : `Still ${LABEL[d.r]} from the last visit.`
    }
    // A good line whose reading dropped is worth showing even though its rating did not change.
    if (!kind && reading && reading.plan.lost > 0 && d.r === 'g' && reading.plan.lost >= 1) { kind = 'still'; sentence = 'Good, but wearing.' }
    if (!kind) continue
    out.push({ kind, section: d.s, name: d.n, now: d.r, was: p ? p.r : null, words: sentence, ...(reading ? { reading } : {}) })
  }
  return out.map((c, n) => ({ c, n })).sort((a, b) => KIND_ORDER.indexOf(a.c.kind) - KIND_ORDER.indexOf(b.c.kind) || a.n - b.n).map(x => x.c)
}

function readingChange(p: DigestItem, d: DigestItem, prior: Visit, now: Visit) {
  if (!p.m || !d.m) return undefined
  const plan = wearPlan(p.m.kind, { value: p.m.value, miles: prior.miles }, { value: d.m.value, miles: now.miles })
  return { before: measureText(p.m), now: measureText(d.m), wear: wearWords(p.m.kind, plan), plan, kind: p.m.kind }
}

/** "2 got worse, 1 is new, 3 are still open, 4 fixed". Empty when nothing changed. */
export function changeSummary(changes: Change[]): string {
  const n = (k: ChangeKind) => changes.filter(c => c.kind === k).length
  const parts: string[] = []
  if (n('worse')) parts.push(`${n('worse')} got worse`)
  if (n('new')) parts.push(`${n('new')} ${n('new') === 1 ? 'is' : 'are'} new`)
  const open = n('still') + n('declined')
  if (open) parts.push(`${open} ${open === 1 ? 'is' : 'are'} still open`)
  if (n('better')) parts.push(`${n('better')} got better`)
  if (n('fixed')) parts.push(`${n('fixed')} fixed`)
  return parts.join(', ')
}

/* ---------- one line across every visit ---------- */

export interface TrendPoint { at: string; value: number; miles: number | null; word: string }

/** The readings for one checklist line across visits, oldest first: "8, 6, 4" for the left front tire. */
export function measureTrend(visits: Visit[], name: string): TrendPoint[] {
  const want = words(name).join(' ')
  const out: TrendPoint[] = []
  for (const v of [...visits].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const d = v.items.find(x => words(x.n).join(' ') === want && x.m)
    if (d?.m) out.push({ at: v.at, value: d.m.value, miles: v.miles, word: rateMeasure(d.m).word })
  }
  return out
}

/** "Last visit: May 3, 2026, Marco. 2 needed work." Used under the history heading. */
export function lastVisitWords(v: Visit | null, fmtDate: (iso: string) => string): string {
  if (!v) return 'No earlier inspection of this vehicle.'
  const reds = v.items.filter(d => d.r === 'r').length
  const yellows = v.items.filter(d => d.r === 'y').length
  const result = reds + yellows === 0 ? 'Everything checked was good.' : [reds ? `${reds} needed work` : '', yellows ? `${yellows} to watch` : ''].filter(Boolean).join(', ') + '.'
  return `Last visit ${fmtDate(v.at)}${v.tech ? `, ${v.tech}` : ''}. ${result}`
}
