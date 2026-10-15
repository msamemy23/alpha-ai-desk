// The facts a repair post may state, and the caption built from them.
//
// Everything a post says comes from the job record: the vehicle, the engine from the VIN decode (or the job's own engine
// field), and the work done from the job and estimate lines. Prices, offers, warranties, credentials, names, plates and
// VINs never get in. The AI may polish the wording, but its answer is checked against these facts and thrown away if it
// adds anything. Pure: relative imports only.

import { unsupportedClaims } from './automation-rules.ts'
import { POST_LIMITS, copyFlags } from './posts-checks.ts'
import { stems } from './posts-photos.ts'

export interface PostFacts {
  /** "2018 Toyota Camry". Empty when the job does not say. */
  car: string
  /** "2.5L 4-cylinder". Empty when unknown: the post then says nothing about the engine. */
  engine: string
  engineSource: 'vin' | 'job' | ''
  /** The work done, cleaned, at most four lines. No prices. */
  repairs: string[]
  /** The job is Completed, Ready for Pickup, Paid or Closed. */
  finished: boolean
  shopName: string
  shopPhone: string
  city: string
}

const one = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').replace(/\s+/g, ' ').trim()

/** "TOYOTA CAMRY" reads "Toyota Camry". Mixed-case text is left as the shop typed it. */
function tidy(s: string): string {
  return s === s.toUpperCase() && /[A-Z]{3,}/.test(s) ? s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()) : s
}

const SAFE_NAME = /[^A-Za-z0-9 .'&/-]/g

/** Year, make and model as the job has them. Falls back to the inspection's vehicle text. Empty when there is no make or model. */
export function carLine(job: { vehicle_year?: unknown; vehicle_make?: unknown; vehicle_model?: unknown } | null | undefined, fallback = ''): string {
  const year = one(job?.vehicle_year)
  const make = tidy(one(job?.vehicle_make).replace(SAFE_NAME, '')).slice(0, 40)
  const model = tidy(one(job?.vehicle_model).replace(SAFE_NAME, '')).slice(0, 50)
  if (make || model) return [/^(19|20)\d{2}$/.test(year) ? year : '', make, model].filter(Boolean).join(' ')
  const f = tidy(one(fallback).replace(SAFE_NAME, '')).slice(0, 80)
  return /[A-Za-z]{3,}/.test(f) ? f : ''
}

/** An engine description with the horsepower figure and odd characters removed. */
export function cleanEngine(raw: unknown): string {
  return one(raw).replace(/<[^>]*>/g, ' ').replace(/\b\d{2,4}\s?hp\b/gi, '').replace(/[^A-Za-z0-9 .,/-]/g, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').slice(0, 48)
}

/** The VIN decode wins; the shop's own engine field is the second choice; otherwise nothing is said about the engine. */
export function pickEngine(decoded: unknown, jobEngine: unknown): { engine: string; source: 'vin' | 'job' | '' } {
  const d = cleanEngine(decoded)
  if (d) return { engine: d, source: 'vin' }
  const j = cleanEngine(jobEngine)
  return j ? { engine: j, source: 'job' } : { engine: '', source: '' }
}

/** A VIN that decodes to a different make or year than the job says is probably mistyped, so its engine is not used. */
export function vinMatchesJob(decoded: { make?: unknown; year?: unknown }, job: { vehicle_make?: unknown; vehicle_year?: unknown }): boolean {
  const norm = (v: unknown): string => one(v).toLowerCase().replace(/[^a-z0-9]/g, '')
  const dm = norm(decoded.make)
  const jm = norm(job.vehicle_make)
  if (dm && jm && dm !== jm && !dm.includes(jm) && !jm.includes(dm)) return false
  const dy = one(decoded.year)
  const jy = one(job.vehicle_year)
  return !(/^\d{4}$/.test(dy) && /^\d{4}$/.test(jy) && dy !== jy)
}

export const FINISHED_STATUSES = ['Completed', 'Ready for Pickup', 'Paid', 'Closed'] as const
export const jobFinished = (status: unknown): boolean => (FINISHED_STATUSES as readonly string[]).includes(one(status))

/* ---------- the work done ---------- */

const NOT_A_REPAIR = /\b(shop supplies|supplies|environmental|disposal|hazmat|hazardous|fees?|taxes?|tax|discount|coupon|deposit|towing|storage|sublet|core charge|misc(?:ellaneous)?|labor|labour|parts?|n\/a)\b/i
const GENERIC = /^(labor|labour|parts?|misc|other|service|repair|work|n\/a|none)$/i

/**
 * One line of work done, cleaned for a public post. Null when it should not be posted: it carries a price, an offer, a
 * warranty or a credential, it is a fee or a generic word, it looks like a phone number, VIN, email or address, or it
 * names the customer or the plate.
 */
export function cleanRepairLine(raw: unknown, avoid: readonly string[] = []): string | null {
  let t = one(raw).replace(/^(?:[-*•]+|\d+[.)])\s+/, '').trim()
  if (t.length < 4 || t.length > 100) return null
  if (GENERIC.test(t) || (NOT_A_REPAIR.test(t) && t.split(' ').length <= 3)) return null
  if (/\b(shop supplies|environmental|disposal|hazmat|core charge|towing|storage|discount|coupon|deposit|sublet)\b/i.test(t)) return null
  if (unsupportedClaims(t).length > 0) return null
  if (/@|https?:|www\.|\.com\b/i.test(t)) return null
  if (/\d{5,}|\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}|\b[A-HJ-NPR-Z0-9]{17}\b/.test(t)) return null
  const low = t.toLowerCase()
  for (const a of avoid) {
    const w = one(a).toLowerCase()
    if (w.length >= 3 && new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(low)) return null
  }
  t = t.charAt(0).toUpperCase() + t.slice(1)
  return t.replace(/[.;:,\s]+$/, '')
}

type Line = Record<string, unknown>
const asLines = (v: unknown): Line[] => (Array.isArray(v) ? v.filter((x): x is Line => Boolean(x) && typeof x === 'object') : [])

export interface RepairSources {
  /** Labor lines of the invoice or approved estimate for the job. */
  docLabors?: unknown
  /** Labor lines kept on the job itself. */
  jobLabors?: unknown
  /** Findings the customer approved on the inspection. */
  approvedFindings?: readonly string[]
  docParts?: unknown
  jobParts?: unknown
}

export const MAX_REPAIR_LINES = 4

/** The work done, in priority order: invoice or estimate labor, the job's labor, approved inspection findings, then part names. */
export function repairLinesFrom(src: RepairSources, avoid: readonly string[] = []): string[] {
  const groups: unknown[][] = [
    asLines(src.docLabors).map(l => l.operation ?? l.description ?? l.name),
    asLines(src.jobLabors).map(l => l.operation ?? l.description ?? l.name),
    [...(src.approvedFindings ?? [])],
    asLines(src.docParts).map(l => l.name ?? l.description),
    asLines(src.jobParts).map(l => l.name ?? l.description),
  ]
  const out: string[] = []
  const have: string[][] = []
  for (const g of groups) {
    for (const raw of g) {
      if (out.length >= MAX_REPAIR_LINES) return out
      const line = cleanRepairLine(raw, avoid)
      if (!line) continue
      const s = stems(line)
      // Skip a line that says the same thing as one already kept ("Front brake pads" after "Replace front brake pads and rotors").
      if (s.length > 0 && have.some(h => s.every(w => h.includes(w)))) continue
      if (out.some(o => o.toLowerCase() === line.toLowerCase())) continue
      out.push(line)
      have.push(s)
    }
  }
  return out
}

/* ---------- the caption ---------- */

export const joinFacts = (f: PostFacts): string => [f.car, f.engine, ...f.repairs, f.shopName, f.shopPhone, f.city].filter(Boolean).join(' ')

/** What stops a post from being made at all, in plain words. Empty means the job has enough to write from. */
export function factsProblems(f: PostFacts): string[] {
  const out: string[] = []
  if (!f.car) out.push('The job needs a vehicle make and model.')
  if (f.repairs.length === 0) out.push('The job or its estimate needs a line saying what was done.')
  return out
}

/** The post written straight from the facts, with nothing added. Used when there is no AI key and as the fallback when the AI strays. */
export function buildCaption(f: PostFacts): string {
  const shop = f.shopName || 'our shop'
  const car = f.car || 'A customer’s vehicle'
  const head = `${car}${f.engine ? ` (${f.engine})` : ''} ${f.finished ? 'finished' : 'in the shop'} at ${shop}.`
  const lines: string[] = [head]
  if (f.repairs.length) lines.push('', 'Work done:', ...f.repairs.map(r => `- ${r}`))
  if (f.shopPhone) lines.push('', `Need a repair? Call ${f.shopPhone}.`)
  return lines.join('\n')
}

/** The smallest limit among the chosen places. */
export function captionLimit(platforms: readonly string[]): number {
  const list = platforms.length ? platforms : ['google']
  return Math.min(...list.map(p => POST_LIMITS[p] ?? 2000))
}

/** The AI is only asked to polish wording from these facts. */
export function captionPrompt(f: PostFacts, platforms: readonly string[]): { system: string; user: string } {
  const limit = Math.min(captionLimit(platforms), 900)
  return {
    system: [
      `You polish one short social media post for ${f.shopName || 'an independent auto repair shop'}${f.city ? ` in ${f.city}` : ''}, about one finished repair.`,
      'Use ONLY the facts you are given. Name the vehicle exactly as given.',
      'Never add or change prices, discounts, offers, guarantees, warranties, awards, certifications, years in business, deadlines, promises about timing, customer names, license plates or VINs.',
      'Do not state anything about the engine unless an engine is given. Do not describe how the repair was done beyond the work lines.',
      `Plain and friendly. No emoji, no hashtags. Under ${limit} characters. Output only the finished post.`,
      f.shopPhone ? `You may end by inviting people to call ${f.shopPhone}.` : '',
    ].filter(Boolean).join(' '),
    user: [`Vehicle: ${f.car || 'not given'}`, `Engine: ${f.engine || 'not given'}`, `Work done:\n${f.repairs.map(r => `- ${r}`).join('\n') || '- not given'}`].join('\n'),
  }
}

export interface Vetted { text: string; flags: string[]; ok: boolean }

/**
 * Checks the words of a caption against the facts. The shared draft checker catches emoji, prices, offers and guarantees;
 * on top of it every number must come from the job, the vehicle must be named, and the length must fit the places.
 */
export function vetCaption(raw: string, f: PostFacts, platforms: readonly string[]): Vetted {
  const text = String(raw || '').replace(/```[a-z]*\n?/gi, '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
  const flags: string[] = []
  if (!text) return { text, flags: ['The wording is empty.'], ok: false }
  flags.push(...copyFlags(text, [joinFacts(f)]))
  const numbers = (s: string): string[] => s.match(/\d+(?:[.,]\d+)?/g) || []
  const allowed = new Set(numbers(joinFacts(f)))
  const stray = [...new Set(numbers(text).filter(n => !allowed.has(n)))]
  if (stray.length) flags.push(`The wording has ${stray.length === 1 ? 'a number' : 'numbers'} (${stray.slice(0, 3).join(', ')}) that is not on the job. Take ${stray.length === 1 ? 'it' : 'them'} out.`)
  const parts = f.car.toLowerCase().split(' ').filter(w => /[a-z]/.test(w))
  if (parts.length && !parts.some(w => text.toLowerCase().includes(w))) flags.push('The wording does not name the vehicle.')
  const limit = captionLimit(platforms)
  if ([...text].length > limit) flags.push(`The wording is ${[...text].length.toLocaleString('en-US')} characters. The places you chose take up to ${limit.toLocaleString('en-US')}.`)
  if (/#\w/.test(text)) flags.push('The wording has a hashtag. Take it out.')
  return { text, flags, ok: flags.length === 0 }
}

/** Facts for a post made by hand from a device photo: only what the owner types, never a job. */
export const emptyFacts = (shop: { shopName?: string; shopPhone?: string; city?: string } = {}): PostFacts => ({
  car: '', engine: '', engineSource: '', repairs: [], finished: false, shopName: one(shop.shopName).slice(0, 120), shopPhone: one(shop.shopPhone).slice(0, 40), city: one(shop.city).slice(0, 80),
})
