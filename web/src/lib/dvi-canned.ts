/**
 * Price a finding from the shop's own canned jobs: "Front brake pads" finds "Front brake pad replacement" and its price.
 * The price is the canned job's price (the saved total, or labor plus parts when no total is saved), never a guess.
 */

import { cannedTotal } from './list-logic.ts'

export interface CannedLike {
  id: string
  name: string
  category?: string | null
  description?: string | null
  labor_hours?: number | null
  labor_rate?: number | null
  parts?: { cost?: number | null; qty?: number | null }[] | null
  total_price?: number | null
  active?: boolean | null
}

export function cannedPrice(j: CannedLike): number {
  const parts = Array.isArray(j.parts) ? j.parts.map(p => ({ cost: Number(p?.cost) || 0, qty: Number(p?.qty) || 1 })) : []
  const computed = cannedTotal(j.labor_hours, j.labor_rate, parts)
  const saved = Number(j.total_price)
  return Number.isFinite(saved) && saved > 0 ? Math.round(saved * 100) / 100 : computed
}

// Words that carry no meaning for matching, and word pairs a shop uses for the same thing.
const STOP = new Set(['and', 'the', 'of', 'a', 'an', 'for', 'with', 'check', 'replace', 'replacement', 'service', 'condition', 'level', 'left', 'right', 'lf', 'rf', 'lr', 'rr'])
const SAME: Record<string, string> = { tyre: 'tire', tyres: 'tire', disc: 'rotor', discs: 'rotor', shoe: 'pad', shoes: 'pad', struts: 'strut', shocks: 'shock', ac: 'a/c', hoses: 'hose', belts: 'belt', pads: 'pad', rotors: 'rotor', tires: 'tire', wipers: 'wiper', lights: 'light', lines: 'line', filters: 'filter', fluids: 'fluid', axles: 'axle', joints: 'joint', rods: 'rod', headlights: 'headlight' }

/** Position words: they narrow a match but never make one on their own. */
const MODIFIER = new Set(['front', 'rear', 'upper', 'lower', 'inner', 'outer'])

export function tokens(s: string): string[] {
  const out: string[] = []
  for (const raw of String(s || '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').split(' ')) {
    if (!raw || STOP.has(raw)) continue
    const w = SAME[raw] ?? (raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw)
    if (!out.includes(w)) out.push(w)
  }
  return out
}

export interface CannedMatch { job: CannedLike; price: number; score: number }

/** Active jobs that fit a checklist line, best first. Needs at least one shared word; with `loose` a single word in the description counts too. */
export function suggestCanned(itemName: string, jobs: CannedLike[], limit = 5): CannedMatch[] {
  const want = tokens(itemName)
  if (want.length === 0) return []
  const out: CannedMatch[] = []
  for (const job of jobs) {
    if (job.active === false) continue
    const nameT = tokens(job.name)
    const bodyT = tokens(`${job.category ?? ''} ${job.description ?? ''}`)
    // "Front brake pads" must not be priced from a rear-brake job.
    if ((want.includes('front') && nameT.includes('rear')) || (want.includes('rear') && nameT.includes('front'))) continue
    let score = 0
    let nameHits = 0
    for (const w of want) {
      if (nameT.includes(w)) { score += MODIFIER.has(w) ? 0.5 : 3; if (!MODIFIER.has(w)) nameHits += 1 } else if (bodyT.includes(w)) score += 1
    }
    // A match on the name is needed (and "front" alone is not one): a description alone is too weak to price a repair from.
    if (nameHits === 0) continue
    // Penalise jobs that carry many extra words ("Front brake pads, rotors and fluid flush" is a bigger job than "front brake pads").
    const extra = nameT.filter(w => !want.includes(w)).length
    score -= Math.min(2, extra * 0.25)
    out.push({ job, price: cannedPrice(job), score })
  }
  return out.sort((a, b) => b.score - a.score || a.price - b.price || a.job.name.localeCompare(b.job.name)).slice(0, limit)
}

/** Search box inside the picker: every word typed must appear in the name, category or description. */
export function searchCanned(query: string, jobs: CannedLike[], limit = 30): CannedMatch[] {
  const q = tokens(query)
  const out: CannedMatch[] = []
  for (const job of jobs) {
    if (job.active === false) continue
    const hay = new Set([...tokens(job.name), ...tokens(`${job.category ?? ''} ${job.description ?? ''}`)])
    if (q.length > 0 && !q.every(w => hay.has(w) || [...hay].some(h => h.startsWith(w)))) continue
    out.push({ job, price: cannedPrice(job), score: q.filter(w => tokens(job.name).includes(w)).length })
  }
  return out.sort((a, b) => b.score - a.score || a.job.name.localeCompare(b.job.name)).slice(0, limit)
}
