/**
 * Digital vehicle inspection: the checklist, how it is rated, and what the customer is told.
 * No imports, so the browser, the server and `node --test` all run the same code.
 */

export type Rating = 'green' | 'yellow' | 'red'
export type Decision = 'approved' | 'declined'

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
}

export interface DviSection { title: string; items: DviItem[] }

export const MAX_PHOTOS_PER_ITEM = 4
export const MAX_PHOTOS_TOTAL = 24
export const MAX_NAME = 80
export const MAX_NOTE = 500
export const MAX_PHOTO_CHARS = 220_000

export const RATING_WORD: Record<Rating, string> = { green: 'Good', yellow: 'Watch', red: 'Needs work' }
/** The words a customer reads. */
export const RATING_CUSTOMER_WORD: Record<Rating, string> = { green: 'Looks good', yellow: 'Worth watching', red: 'Needs attention' }

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

export function makeSections(templateKey: string): DviSection[] {
  const t = templateOf(templateKey)
  return t.sections.map((s, si) => ({
    title: s.title,
    items: s.items.map((name, ii) => ({ id: `${t.key}-${si}-${ii}`, name, status: null, note: '', photos: [], price: null })),
  }))
}

export function newItem(name: string): DviItem {
  return { id: `c-${rid()}`, name: name.trim().slice(0, MAX_NAME), status: null, note: '', photos: [], price: null, custom: true }
}

/* ---------- cleaning what comes out of the database or the browser ---------- */

const RATINGS = new Set(['green', 'yellow', 'red'])

/** A picture we are willing to put in a page: a small data URL of a real image type, or an https address. */
export function isSafeImage(s: unknown): s is string {
  if (typeof s !== 'string') return false
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s)) return s.length <= MAX_PHOTO_CHARS * 2
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 2000
}

export function cleanPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null
  return Math.round(n * 100) / 100
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
        return {
          id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `legacy-${si}-${ii}`,
          name: String(o.name ?? '').trim().slice(0, MAX_NAME) || 'Item',
          status: RATINGS.has(String(o.status)) ? (o.status as Rating) : null,
          note: String(o.note ?? '').slice(0, MAX_NOTE),
          photos,
          price: cleanPrice(o.price),
          ...(o.custom === true ? { custom: true } : {}),
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

export interface Finding { id: string; section: string; name: string; status: 'red' | 'yellow'; note: string; photos: string[]; price: number | null }

export function findings(sections: DviSection[]): Finding[] {
  const out: Finding[] = []
  for (const s of sections) for (const i of s.items) {
    if (i.status === 'red' || i.status === 'yellow') out.push({ id: i.id, section: s.title, name: i.name, status: i.status, note: i.note, photos: i.photos, price: i.price })
  }
  // Needs work before worth watching; the order on the checklist is kept inside each group.
  return [...out.filter(f => f.status === 'red'), ...out.filter(f => f.status === 'yellow')]
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

export function decisionSummary(list: Finding[], decisions: Decisions): DecisionSummary {
  let approved = 0, declined = 0, approvedTotal = 0
  for (const f of list) {
    const d = decisions[f.id]
    if (d === 'approved') { approved += 1; approvedTotal += f.price ?? 0 } else if (d === 'declined') declined += 1
  }
  return { approved, declined, waiting: list.length - approved - declined, approvedTotal: Math.round(approvedTotal * 100) / 100, answered: approved + declined > 0 }
}

export function estimateTotal(list: Finding[]): number {
  return Math.round(list.reduce((s, f) => s + (f.price ?? 0), 0) * 100) / 100
}

/** Lines for a new estimate from what the customer approved. A finding with no price is a line at $0 for the shop to fill in. */
export function estimateLines(list: Finding[], decisions: Decisions): { operation: string; amount: number }[] {
  return list.filter(f => decisions[f.id] === 'approved').map(f => ({
    operation: f.note.trim() ? `${f.name}: ${f.note.trim()}` : f.name,
    amount: f.price ?? 0,
  }))
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
