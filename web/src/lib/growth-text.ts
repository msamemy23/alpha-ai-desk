// Pure rules for the Get more customers screen: what a text says, who is eligible to get it,
// and who counts as "has not been in for a while". No imports, so tests can run it directly.

export const OPT_OUT_LINE = 'Reply STOP to opt out.'
export const QUIET_DAYS = 60
const DAY = 86_400_000

export interface PersonLike {
  id?: unknown
  name?: unknown
  phone?: unknown
  sms_opted_out?: unknown
  last_contact?: unknown
  last_visit?: unknown
  created_at?: unknown
}

/** "Marcus Bell" becomes "Marcus". Nothing usable becomes "there". */
export function firstNameOf(name: unknown): string {
  const first = String(name ?? '').trim().split(/\s+/)[0]
  return first || 'there'
}

/** Every marketing text ends with the opt-out line, once. */
export function withOptOut(text: string): string {
  const t = text.trim()
  if (/\bSTOP\b/i.test(t)) return t
  return t ? `${t} ${OPT_OUT_LINE}` : OPT_OUT_LINE
}

/** Put the person's first name where {name} is. */
export function fillName(template: string, name: unknown): string {
  return template.replace(/\{name\}/gi, firstNameOf(name))
}

const GSM_BASIC = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/

/** How many text messages a body costs: 160 characters each for plain text, 70 when it has an accent or symbol outside the basic set. */
export function smsParts(text: string): { chars: number; parts: number } {
  const chars = [...text].length
  if (chars === 0) return { chars, parts: 0 }
  const plain = GSM_BASIC.test(text)
  const single = plain ? 160 : 70
  const multi = plain ? 153 : 67
  return { chars, parts: chars <= single ? 1 : Math.ceil(chars / multi) }
}

const phoneDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** True when the number is long enough to be a real phone number. */
export function hasPhone(v: unknown): boolean {
  const d = phoneDigits(v)
  return d.length >= 10
}

export function followUpTemplate(shopName: string, shopPhone: string): string {
  const call = shopPhone.trim() ? `call ${shopPhone.trim()}` : 'call us'
  return withOptOut(`Hi {name}! It is time for a checkup at ${shopName.trim()}. Reply YES or ${call}.`)
}

export function reviewTemplate(shopName: string, reviewUrl: string): string {
  return withOptOut(`Hi {name}! Thanks for choosing ${shopName.trim()}. If we earned it, would you leave us a quick review? ${reviewUrl.trim()}`)
}

export function referralTemplate(shopName: string, code: string, percent: number, credit: number): string {
  const owner = shopName.trim()
  const reward = credit > 0 ? ` and you get a $${credit} credit` : ''
  return withOptOut(`Hi {name}! Share your ${owner} code ${code} with friends. They get ${percent}% off${reward}.`)
}

/** The same sentence the server writes when nobody types a message, so what you read is what goes out. */
export function leadTextTemplate(shopName: string, shopPhone: string, service: string): string {
  const need = service.trim() || 'your vehicle'
  const call = shopPhone.trim() ? ` Call ${shopPhone.trim()}.` : ''
  return withOptOut(`Hi {name}! ${shopName.trim()} here. We can help with ${need}.${call}`)
}

export function leadEmailTemplate(shopName: string, shopPhone: string, service: string): string {
  const need = service.trim() || 'your vehicle'
  const call = shopPhone.trim() ? ` You can reach us at ${shopPhone.trim()}.` : ' Just reply to this email.'
  return `Hi {name},\n\n${shopName.trim()} here. We can help with ${need}.${call}\n\nThanks,\n${shopName.trim()}`
}

export function leadEmailSubject(shopName: string, service: string): string {
  return `${shopName.trim()} - ${service.trim() || 'Auto Repair Services'}`
}

/** A referral code a customer can say out loud: their first name and four letters. Never a shop name. */
export function referralCode(name: unknown, random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const first = String(name ?? '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'FRIEND'
  let tail = ''
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(random() * alphabet.length) % alphabet.length]
  return `${first}-${tail}`
}

export interface Split<T> { eligible: T[]; noPhone: T[]; optedOut: T[]; duplicate: T[] }

/** The last ten digits, so "(713) 555-0142" and "+1 713 555 0142" match. */
export function phoneKey(v: unknown): string {
  return phoneDigits(v).slice(-10)
}

/** Who can be texted, who has no number, who told us to stop, and who shares a number with someone already on the list. */
export function splitForText<T extends PersonLike>(people: T[]): Split<T> {
  const out: Split<T> = { eligible: [], noPhone: [], optedOut: [], duplicate: [] }
  const seen = new Set<string>()
  // Someone who replied STOP blocks every record that shares their number.
  const stopped = new Set(people.filter(p => p.sms_opted_out === true && hasPhone(p.phone)).map(p => phoneKey(p.phone)))
  for (const p of people) {
    if (p.sms_opted_out === true || (hasPhone(p.phone) && stopped.has(phoneKey(p.phone)))) out.optedOut.push(p)
    else if (!hasPhone(p.phone)) out.noPhone.push(p)
    else if (seen.has(phoneKey(p.phone))) out.duplicate.push(p)
    else { seen.add(phoneKey(p.phone)); out.eligible.push(p) }
  }
  return out
}

const stamp = (v: unknown): number | null => {
  if (!v) return null
  const t = new Date(String(v)).getTime()
  return Number.isFinite(t) ? t : null
}

export interface DocLike { customer_id?: unknown; customer_name?: unknown; created_at?: unknown; doc_date?: unknown }

const nameKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Most recent invoice or receipt date for each customer, found by id first and exact name second. */
export function lastVisits(docs: DocLike[]): { byId: Map<string, number>; byName: Map<string, number> } {
  const byId = new Map<string, number>()
  const byName = new Map<string, number>()
  for (const d of docs) {
    const t = stamp(d.doc_date) ?? stamp(d.created_at)
    if (t === null) continue
    const id = d.customer_id ? String(d.customer_id) : ''
    if (id && (byId.get(id) ?? 0) < t) byId.set(id, t)
    const n = nameKey(d.customer_name)
    if (n && (byName.get(n) ?? 0) < t) byName.set(n, t)
  }
  return { byId, byName }
}

/** When this customer last came in: their newest invoice or receipt. Customers with no paperwork fall back to the day they were added. */
export function lastVisitOf(c: PersonLike, visits: { byId: Map<string, number>; byName: Map<string, number> }): number | null {
  const fromDocs = Math.max(
    c.id ? (visits.byId.get(String(c.id)) ?? 0) : 0,
    visits.byName.get(nameKey(c.name)) ?? 0,
  )
  if (fromDocs > 0) return fromDocs
  return stamp(c.last_visit) ?? stamp(c.created_at)
}

/** Has not visited and has not been messaged for `days` days. */
export function isQuiet(c: PersonLike, visits: { byId: Map<string, number>; byName: Map<string, number> }, now = Date.now(), days = QUIET_DAYS): boolean {
  const lastVisit = lastVisitOf(c, visits)
  const lastContact = stamp(c.last_contact)
  const latest = Math.max(lastVisit ?? 0, lastContact ?? 0)
  if (latest === 0) return true
  return (now - latest) / DAY > days
}

/** A readable "3 months ago" for a timestamp in milliseconds. */
export function agoWords(t: number | null, now = Date.now()): string {
  if (t === null) return 'never'
  const days = Math.floor((now - t) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) { const m = Math.floor(days / 30); return `${m} ${m === 1 ? 'month' : 'months'} ago` }
  const y = Math.floor(days / 365)
  return `${y} ${y === 1 ? 'year' : 'years'} ago`
}

/** "Houston, TX 77025" becomes the place the lead searches look near. Nothing guessed when the profile has no city. */
export function cityFromProfile(cityStateZip: unknown): { search: string; label: string } | null {
  const raw = String(cityStateZip ?? '').trim()
  if (!raw) return null
  const noZip = raw.replace(/\s*\d{5}(-\d{4})?\s*$/, '').trim()
  const label = (noZip.includes(',') ? noZip.split(',')[0] : noZip.replace(/\s+[A-Za-z]{2}$/, '')).trim()
  const search = noZip.replace(/,/g, '').trim()
  if (!label || !search) return null
  return { search, label }
}

/**
 * The older one-tap win-back call sends a message the owner may have typed with {shopName} and {phone}.
 * Those become the placeholders the promotion engine knows. With nothing typed, a plain message that
 * promises no price, special or discount is used.
 */
export function legacyOutreachMessage(template: string): string {
  const t = template.trim()
  if (!t) return 'Hi {name}, it has been a while since we saw you at {shop}. {contact} to book your next visit.'
  return t.replace(/\{shopName\}/gi, '{shop}').replace(/\{phone\}/gi, '{shop_phone}')
}
