/**
 * Digital vehicle inspection: the checklist, how it is rated, and what the customer is told.
 * Imports only the measurement rules next door (no `@/` aliases), so the browser, the server and `node --test` all run the same code.
 */

import { cleanMeasure, rateMeasure } from './dvi-measure.ts'
import type { Measure } from './dvi-measure.ts'

export type Rating = 'green' | 'yellow' | 'red'
export type Decision = 'approved' | 'declined'

/** How soon a finding should be fixed. Separate from the rating: a red item is usually "now", a yellow one "recommended". */
export type Urgency = 'now' | 'soon' | 'later'

/** A short video or voice note on a finding. Always a file in storage: these are far too big to live inside the row. */
export interface Clip { ref: string; kind: 'video' | 'audio'; secs: number }

export interface DviItem {
  id: string
  name: string
  status: Rating | null
  /** What the technician found, in plain words. Shown to the customer. */
  note: string
  photos: string[]
  /** What the shop suggests charging to fix it. Optional. */
  price: number | null
  /** Added by hand on this inspection, not part of the template. */
  custom?: boolean
  /** Fix now / recommended / can wait. Missing means "follow the rating". */
  urgency?: Urgency
  /** For the shop only. Never sent to the customer and never on the public page. */
  techNote?: string
  /** Tire tread, pad thickness, rotor thickness or tire pressure. */
  measure?: Measure
  /** The canned job the price came from. */
  canned?: { id: string; name: string }
  /** Short video and voice notes. */
  clips?: Clip[]
}

export interface DviSection { title: string; items: DviItem[] }

/** Photos on one finding, whether kept in storage or inside the row. */
export const MAX_PHOTOS_PER_ITEM = 8
/** Pictures kept inside the inspection row itself (the way it worked before storage): few, because each is big. */
export const MAX_INROW_PER_ITEM = 4
export const MAX_PHOTOS_TOTAL = 24
/** Pictures kept in storage are only a short name in the row, so a whole inspection can hold many. */
export const MAX_STORED_TOTAL = 80
export const MAX_NAME = 80
export const MAX_NOTE = 500
export const MAX_PHOTO_CHARS = 220_000
export const MAX_TECH_NOTE = 500
export const MAX_CLIPS_PER_ITEM = 2
export const MAX_CLIP_SECS = 60

export const RATING_WORD: Record<Rating, string> = { green: 'Good', yellow: 'Watch', red: 'Needs work' }
/** The words a customer reads. */
export const RATING_CUSTOMER_WORD: Record<Rating, string> = { green: 'Looks good', yellow: 'Worth watching', red: 'Needs attention' }

export const URGENCIES: Urgency[] = ['now', 'soon', 'later']
/** The words the shop and the customer both read. */
export const URGENCY_WORD: Record<Urgency, string> = { now: 'Fix now', soon: 'Recommended', later: 'Can wait' }
export const URGENCY_HELP: Record<Urgency, string> = {
  now: 'Safety or breakdown risk. Should not wait.',
  soon: 'Should be done at this visit or the next.',
  later: 'Not a worry today. Plan for it.',
}
export const defaultUrgency = (status: Rating | null): Urgency => (status === 'red' ? 'now' : 'soon')
/** The urgency to show: what the technician chose, or what the rating implies. */
export const urgencyOf = (i: { status: Rating | null; urgency?: Urgency }): Urgency => (i.urgency && URGENCIES.includes(i.urgency) ? i.urgency : defaultUrgency(i.status))

/* ---------- templates ---------- */

export interface Template { key: string; label: string; blurb: string; sections: { title: string; items: string[] }[] }

export const TEMPLATES: Template[] = [
  {
    key: 'full',
    label: 'Full multi-point inspection',
    blurb: '31 checks: under the hood, brakes, tires, suspension, lights.',
    sections: [
      { title: 'Under the hood', items: ['Engine oil level and condition', 'Coolant level and condition', 'Brake fluid', 'Power steering fluid', 'Transmission fluid', 'Air filter', 'Drive belts', 'Battery and cables', 'Hoses and clamps'] },
      { title: 'Brakes', items: ['Front brake pads', 'Rear brake pads', 'Front rotors', 'Rear rotors', 'Brake lines and hoses', 'Parking brake'] },
      { title: 'Tires and wheels', items: ['Left front tire', 'Right front tire', 'Left rear tire', 'Right rear tire', 'Tire pressure', 'Wheel condition'] },
      { title: 'Suspension and steering', items: ['Shocks and struts', 'Ball joints', 'Tie rods', 'CV axles and boots', 'Alignment'] },
      { title: 'Lights and exterior', items: ['Headlights', 'Tail and brake lights', 'Turn signals', 'Wipers', 'Exhaust'] },
    ],
  },
  {
    key: 'brakes-tires',
    label: 'Brakes and tires',
    blurb: '14 checks. Quick look before a brake or tire sale.',
    sections: [
      { title: 'Brakes', items: ['Front brake pads', 'Rear brake pads', 'Front rotors', 'Rear rotors', 'Brake fluid', 'Brake lines and hoses', 'Parking brake'] },
      { title: 'Tires and wheels', items: ['Left front tire', 'Right front tire', 'Left rear tire', 'Right rear tire', 'Tire pressure', 'Spare tire', 'Wheel condition'] },
    ],
  },
  {
    key: 'courtesy',
    label: 'Oil change courtesy check',
    blurb: '13 checks while the car is on the lift.',
    sections: [
      { title: 'Fluids and filters', items: ['Engine oil', 'Coolant', 'Brake fluid', 'Washer fluid', 'Air filter', 'Cabin air filter'] },
      { title: 'Wear items', items: ['Battery', 'Drive belts', 'Wipers', 'Tires', 'Headlights and tail lights', 'Brake pads', 'Leaks under the car'] },
    ],
  },
]

export const templateOf = (key: string): Template => TEMPLATES.find(t => t.key === key) || TEMPLATES[0]

const rid = () => Math.random().toString(36).slice(2, 10)

/** A fresh, unrated checklist from any template, built in or the shop's own. */
export function sectionsFromTemplate(t: Pick<Template, 'key' | 'sections'>): DviSection[] {
  return t.sections.map((s, si) => ({
    title: s.title,
    items: s.items.map((name, ii) => ({ id: `${t.key}-${si}-${ii}`, name, status: null, note: '', photos: [], price: null })),
  }))
}

export function makeSections(templateKey: string): DviSection[] {
  return sectionsFromTemplate(templateOf(templateKey))
}

/* ---------- the shop's own checklists ---------- */

export const MAX_TEMPLATE_SECTIONS = 12
export const MAX_TEMPLATE_ITEMS_PER_SECTION = 40
export const MAX_TEMPLATE_ITEMS = 150
export const MAX_TEMPLATE_LABEL = 60
export const MAX_TEMPLATE_BLURB = 120
export const CUSTOM_KEY = /^t-[a-z0-9]{6,12}$/

/** The key a shop template carries on an inspection: short and safe, derived from the template's own id. */
export const customKeyFor = (id: string): string => `t-${String(id).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'custom'}`

/**
 * Clean a checklist someone typed in the template editor. Blank names are dropped, repeats inside a section are dropped,
 * and the size limits keep one template from growing past what a phone can show. Returns null when nothing usable is left.
 */
export function cleanTemplate(raw: unknown): { label: string; blurb: string; sections: { title: string; items: string[] }[] } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const label = String(o.label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEMPLATE_LABEL)
  if (!label) return null
  const rawSections = Array.isArray(o.sections) ? o.sections.slice(0, MAX_TEMPLATE_SECTIONS) : []
  let total = 0
  const sections: { title: string; items: string[] }[] = []
  for (const sec of rawSections) {
    const so = (sec && typeof sec === 'object' ? sec : {}) as Record<string, unknown>
    const seen = new Set<string>()
    const items: string[] = []
    for (const it of Array.isArray(so.items) ? so.items : []) {
      const name = String(typeof it === 'string' ? it : '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
      const k = name.toLowerCase()
      if (!name || seen.has(k) || items.length >= MAX_TEMPLATE_ITEMS_PER_SECTION || total >= MAX_TEMPLATE_ITEMS) continue
      seen.add(k); items.push(name); total += 1
    }
    if (items.length === 0) continue
    sections.push({ title: String(so.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Checks', items })
  }
  if (sections.length === 0) return null
  const blurb = String(o.blurb ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEMPLATE_BLURB)
  return { label, blurb, sections }
}

/** "24 checks in 4 groups", the line under a template's name. Always true to the list. */
export function templateBlurb(sections: { items: unknown[] }[]): string {
  const n = sections.reduce((a, s) => a + s.items.length, 0)
  return `${n} ${n === 1 ? 'check' : 'checks'} in ${sections.length} ${sections.length === 1 ? 'group' : 'groups'}`
}

export function newItem(name: string): DviItem {
  return { id: `c-${rid()}`, name: name.trim().slice(0, MAX_NAME), status: null, note: '', photos: [], price: null, custom: true }
}

/* ---------- files kept in storage ---------- */

/**
 * A picture or clip kept in the private storage bucket is written into the row as `storage:<inspection id>/<file>`.
 * The folder is the inspection's own id, so the server can tell whose file it is from the name alone.
 */
const STORAGE_REF = /^storage:([A-Za-z0-9-]{1,64})\/([A-Za-z0-9_-]{6,64})\.(jpg|png|webp|mp4|webm|m4a|mp3|ogg)$/

export const isStorageRef = (s: unknown): s is string => typeof s === 'string' && s.length <= 140 && STORAGE_REF.test(s)

export function storageRefParts(ref: string): { folder: string; file: string; ext: string; path: string } | null {
  const m = STORAGE_REF.exec(ref)
  return m ? { folder: m[1], file: m[2], ext: m[3], path: ref.slice('storage:'.length) } : null
}

export const makeStorageRef = (folder: string, file: string, ext: string): string => `storage:${folder}/${file}.${ext}`

const IMAGE_EXT = new Set(['jpg', 'png', 'webp'])
export const isImageRef = (s: string): boolean => { const p = storageRefParts(s); return !!p && IMAGE_EXT.has(p.ext) }

/* ---------- cleaning what comes out of the database or the browser ---------- */

const RATINGS = new Set(['green', 'yellow', 'red'])

/** A picture we are willing to put in a page: a small data URL of a real image type, or an https address. */
export function isSafeImage(s: unknown): s is string {
  if (typeof s !== 'string') return false
  if (s.startsWith('storage:')) return isStorageRef(s) && isImageRef(s)
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s)) return s.length <= MAX_PHOTO_CHARS * 2
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 2000
}

export function cleanPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null
  return Math.round(n * 100) / 100
}

export function cleanClips(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return []
  const out: Clip[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const p = typeof o.ref === 'string' && isStorageRef(o.ref) ? storageRefParts(o.ref) : null
    if (!p || IMAGE_EXT.has(p.ext)) continue
    const kind = o.kind === 'video' || o.kind === 'audio' ? o.kind : /^(mp4|webm)$/.test(p.ext) ? 'video' : 'audio'
    const secs = Math.max(0, Math.min(MAX_CLIP_SECS, Math.round(Number(o.secs) || 0)))
    out.push({ ref: o.ref as string, kind, secs })
    if (out.length >= MAX_CLIPS_PER_ITEM) break
  }
  return out
}

export function normalizeSections(raw: unknown): DviSection[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s, si) => {
    const sec = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    const items = Array.isArray(sec.items) ? sec.items : []
    return {
      title: String(sec.title ?? '').trim().slice(0, 60) || 'Checks',
      items: items.map((it, ii) => {
        const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
        const photos = [...(Array.isArray(o.photos) ? o.photos : []), ...(typeof o.photo === 'string' ? [o.photo] : [])].filter(isSafeImage).slice(0, MAX_PHOTOS_PER_ITEM)
        const urgency = URGENCIES.includes(o.urgency as Urgency) ? (o.urgency as Urgency) : undefined
        const techNote = String(o.techNote ?? '').slice(0, MAX_TECH_NOTE)
        const measure = cleanMeasure(o.measure)
        const cn = o.canned && typeof o.canned === 'object' && !Array.isArray(o.canned) ? (o.canned as Record<string, unknown>) : null
        const canned = cn && typeof cn.id === 'string' && cn.id && typeof cn.name === 'string' ? { id: cn.id.slice(0, 64), name: cn.name.slice(0, MAX_NAME) } : undefined
        const clips = cleanClips(o.clips)
        return {
          id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `legacy-${si}-${ii}`,
          name: String(o.name ?? '').trim().slice(0, MAX_NAME) || 'Item',
          status: RATINGS.has(String(o.status)) ? (o.status as Rating) : null,
          note: String(o.note ?? '').slice(0, MAX_NOTE),
          photos,
          price: cleanPrice(o.price),
          ...(o.custom === true ? { custom: true } : {}),
          ...(urgency ? { urgency } : {}),
          ...(techNote.trim() ? { techNote } : {}),
          ...(measure ? { measure } : {}),
          ...(canned ? { canned } : {}),
          ...(clips.length ? { clips } : {}),
        }
      }),
    }
  })
}

/* ---------- counting ---------- */

export interface Counts { red: number; yellow: number; green: number; rated: number; total: number; unrated: number; photos: number }

export function counts(sections: DviSection[]): Counts {
  let red = 0, yellow = 0, green = 0, total = 0, photos = 0
  for (const s of sections) for (const i of s.items) {
    total += 1
    photos += i.photos.length
    if (i.status === 'red') red += 1
    else if (i.status === 'yellow') yellow += 1
    else if (i.status === 'green') green += 1
  }
  const rated = red + yellow + green
  return { red, yellow, green, rated, total, unrated: total - rated, photos }
}

export function sectionCounts(s: DviSection): Counts { return counts([s]) }

/** Photos stored inside the row (data URLs), as opposed to files in storage. */
export function inRowPhotos(sections: DviSection[]): number {
  let n = 0
  for (const s of sections) for (const i of s.items) n += i.photos.filter(p => p.startsWith('data:')).length
  return n
}

export function mediaCounts(sections: DviSection[]): { photos: number; clips: number; measured: number } {
  let photos = 0, clips = 0, measured = 0
  for (const s of sections) for (const i of s.items) {
    photos += i.photos.length
    clips += i.clips?.length ?? 0
    if (i.measure) measured += 1
  }
  return { photos, clips, measured }
}

/* ---------- the short copy kept beside the row ---------- */

/** One checked line, kept small: enough to compare with the next visit without loading every photo. */
export interface DigestItem { i?: string; s: string; n: string; r: 'g' | 'y' | 'r'; m?: Measure; t?: string; p?: number }

export const MAX_DIGEST = 120

/** Every rated line, in the checklist order. Lines nobody rated are left out. */
export function digestOf(sections: DviSection[]): DigestItem[] {
  const out: DigestItem[] = []
  for (const sec of sections) for (const i of sec.items) {
    if (!i.status || out.length >= MAX_DIGEST) continue
    out.push({
      i: i.id, s: sec.title.slice(0, 40), n: i.name, r: i.status === 'green' ? 'g' : i.status === 'yellow' ? 'y' : 'r',
      ...(i.measure ? { m: i.measure } : {}), ...(i.status !== 'green' && i.note.trim() ? { t: i.note.trim().slice(0, 100) } : {}),
      ...(i.price !== null && i.status !== 'green' ? { p: i.price } : {}),
    })
  }
  return out
}

export function digestFromRaw(raw: unknown): DigestItem[] {
  if (!Array.isArray(raw)) return []
  const out: DigestItem[] = []
  for (const d of raw.slice(0, MAX_DIGEST)) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    if (o.r !== 'g' && o.r !== 'y' && o.r !== 'r') continue
    const m = cleanMeasure(o.m)
    out.push({
      ...(typeof o.i === 'string' && o.i ? { i: o.i.slice(0, 40) } : {}),
      s: String(o.s ?? '').slice(0, 40), n: String(o.n ?? '').slice(0, MAX_NAME), r: o.r,
      ...(m ? { m } : {}), ...(typeof o.t === 'string' && o.t ? { t: o.t.slice(0, 100) } : {}),
      ...(cleanPrice(o.p) !== null ? { p: cleanPrice(o.p) as number } : {}),
    })
  }
  return out
}

/** What goes in the summary column on every save: the counts, plus the digest. */
export function summaryOf(sections: DviSection[]): Counts & { digest: DigestItem[] } {
  return { ...counts(sections), digest: digestOf(sections) }
}

export type Overall = 'red' | 'yellow' | 'green' | 'pending'

export function overallOf(sections: DviSection[]): Overall {
  const c = counts(sections)
  if (c.red > 0) return 'red'
  if (c.yellow > 0) return 'yellow'
  return c.rated > 0 ? 'green' : 'pending'
}

/** "3 need work, 2 to watch" or "Everything checked is good". */
export function summaryWords(c: Pick<Counts, 'red' | 'yellow' | 'green' | 'rated'>): string {
  if (c.rated === 0) return 'Nothing checked yet'
  const parts: string[] = []
  if (c.red > 0) parts.push(`${c.red} ${c.red === 1 ? 'needs' : 'need'} work`)
  if (c.yellow > 0) parts.push(`${c.yellow} to watch`)
  if (parts.length === 0) return 'Everything checked is good'
  return parts.join(', ')
}

/* ---------- findings: the things the customer is asked about ---------- */

/** A reading as the customer sees it: "4/32 in", the warning in words, and the lamp. */
export interface FindingMeasure { kind: Measure['kind']; text: string; word: string; rating: Rating | null }

export interface Finding {
  id: string; section: string; name: string; status: 'red' | 'yellow'; note: string; photos: string[]; price: number | null
  urgency: Urgency
  measure?: FindingMeasure
  clips: Clip[]
}

export function findingMeasure(m: Measure | undefined): FindingMeasure | undefined {
  if (!m) return undefined
  const r = rateMeasure(m)
  return { kind: m.kind, text: r.text, word: r.word, rating: r.rating }
}

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, later: 2 }

/**
 * Everything the customer is asked about. The technician's private note is never part of this.
 * Fix-now items come first, then recommended, then can-wait; inside each group needs-work comes before worth-watching,
 * and the order on the checklist is kept after that.
 */
export function findings(sections: DviSection[]): Finding[] {
  const out: Finding[] = []
  for (const s of sections) for (const i of s.items) {
    if (i.status === 'red' || i.status === 'yellow') {
      out.push({
        id: i.id, section: s.title, name: i.name, status: i.status, note: i.note, photos: i.photos, price: i.price,
        urgency: urgencyOf(i), clips: i.clips ?? [], ...(i.measure ? { measure: findingMeasure(i.measure) } : {}),
      })
    }
  }
  const rank = (f: Finding) => URGENCY_RANK[f.urgency] * 2 + (f.status === 'red' ? 0 : 1)
  // Array.prototype.sort is stable, so the checklist order survives inside each group.
  return out.map((f, n) => ({ f, n })).sort((a, b) => rank(a.f) - rank(b.f) || a.n - b.n).map(x => x.f)
}

/** How many findings fall in each urgency group, for "2 fix now, 3 recommended". */
export function urgencyCounts(list: Pick<Finding, 'urgency'>[]): Record<Urgency, number> {
  const c: Record<Urgency, number> = { now: 0, soon: 0, later: 0 }
  for (const f of list) c[f.urgency] += 1
  return c
}

export type Decisions = Record<string, Decision>

export function cleanDecisions(raw: unknown, allowedIds: string[]): Decisions {
  const out: Decisions = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const allowed = new Set(allowedIds)
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed.has(id) && (v === 'approved' || v === 'declined')) out[id] = v
  }
  return out
}

export interface DecisionSummary { approved: number; declined: number; waiting: number; approvedTotal: number; answered: boolean }

export function decisionSummary(list: Pick<Finding, 'id' | 'price'>[], decisions: Decisions): DecisionSummary {
  let approved = 0, declined = 0, approvedTotal = 0
  for (const f of list) {
    const d = decisions[f.id]
    if (d === 'approved') { approved += 1; approvedTotal += f.price ?? 0 } else if (d === 'declined') declined += 1
  }
  return { approved, declined, waiting: list.length - approved - declined, approvedTotal: Math.round(approvedTotal * 100) / 100, answered: approved + declined > 0 }
}

export function estimateTotal(list: Pick<Finding, 'price'>[]): number {
  return Math.round(list.reduce((s, f) => s + (f.price ?? 0), 0) * 100) / 100
}

/** Lines for a new estimate from what the customer approved. A finding with no price is a line at $0 for the shop to fill in. */
export function estimateLines(list: Finding[], decisions: Decisions): { operation: string; amount: number }[] {
  return list.filter(f => decisions[f.id] === 'approved').map(f => {
    const name = f.measure && f.measure.kind !== 'pressure' ? `${f.name} (${f.measure.text})` : f.name
    return { operation: f.note.trim() ? `${name}: ${f.note.trim()}` : name, amount: f.price ?? 0 }
  })
}

export const fmtMoney = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/* ---------- where an inspection stands ---------- */

export type DviState = 'new' | 'checking' | 'sent' | 'answered'

export function stateOf(d: { sections: DviSection[]; sent_to_customer?: boolean; customer_decisions?: unknown; customer_approved?: boolean }): DviState {
  const answered = d.customer_approved === true || (d.customer_decisions && typeof d.customer_decisions === 'object' && Object.keys(d.customer_decisions as object).length > 0)
  if (answered) return 'answered'
  if (d.sent_to_customer) return 'sent'
  return counts(d.sections).rated > 0 ? 'checking' : 'new'
}

export const STATE_WORD: Record<DviState, string> = { new: 'Not started', checking: 'Being checked', sent: 'Waiting on customer', answered: 'Customer answered' }

/* ---------- the text message ---------- */

export const firstNameOf = (name: string): string => String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''

export function smsText(o: { customer: string; vehicle: string; shop: string; phone: string; url: string | null; list: Finding[]; goodCount: number }): string {
  const hi = firstNameOf(o.customer) ? `Hi ${firstNameOf(o.customer)}, the` : 'The'
  const reds = o.list.filter(f => f.status === 'red')
  const yellows = o.list.filter(f => f.status === 'yellow')
  const lines: string[] = [`${hi} inspection on your ${o.vehicle || 'vehicle'} at ${o.shop || 'our shop'} is done.`]
  if (o.list.length === 0) lines.push('Everything we checked looks good.')
  else if (o.url) lines.push(`${reds.length > 0 ? `${reds.length} ${reds.length === 1 ? 'item needs' : 'items need'} attention` : ''}${reds.length > 0 && yellows.length > 0 ? ' and ' : ''}${yellows.length > 0 ? `${yellows.length} ${reds.length > 0 ? 'to keep an eye on' : yellows.length === 1 ? 'item to keep an eye on' : 'items to keep an eye on'}` : ''}.`)
  else {
    if (reds.length) lines.push(`Needs attention: ${reds.slice(0, 6).map(f => f.name).join(', ')}.`)
    if (yellows.length) lines.push(`Worth watching: ${yellows.slice(0, 6).map(f => f.name).join(', ')}.`)
  }
  if (o.url && o.list.length > 0) lines.push(`See the photos and tell us what to go ahead with: ${o.url}`)
  lines.push(o.phone ? `Questions? Call ${o.phone}.` : 'Reply to this text with any questions.')
  return lines.join('\n')
}

/** The same message as an email: a subject, and a body that lists what was found with the urgency words. */
export function emailParts(o: { customer: string; vehicle: string; shop: string; phone: string; url: string | null; list: Finding[]; goodCount: number }): { subject: string; body: string } {
  const first = firstNameOf(o.customer)
  const car = o.vehicle || 'vehicle'
  const shop = o.shop || 'our shop'
  const lines: string[] = [`${first ? `Hi ${first},` : 'Hello,'}`, '', `The inspection on your ${car} at ${shop} is done.`]
  if (o.list.length === 0) lines.push('', 'Everything we checked looks good.')
  else {
    for (const u of URGENCIES) {
      const group = o.list.filter(f => f.urgency === u)
      if (group.length === 0) continue
      lines.push('', `${URGENCY_WORD[u]}:`)
      for (const f of group.slice(0, 12)) lines.push(`- ${f.name}${f.price !== null ? ` (about ${fmtMoney(f.price)})` : ''}`)
    }
    if (o.url) lines.push('', `See the photos and tell us what to go ahead with: ${o.url}`)
  }
  lines.push('', o.phone ? `Questions? Call ${o.phone}.` : 'Reply to this email with any questions.', '', shop)
  return { subject: `Your inspection results from ${shop}`, body: lines.join('\n') }
}
