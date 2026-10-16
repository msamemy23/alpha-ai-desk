/**
 * Saving a lead: from a call or the front counter (a staff member does it), or from the "ask for a price" form on the public booking page.
 *
 * The app keeps leads in two tables, for historical reasons:
 *   `leads`         what the Leads tab reads (and the new-lead email automation).
 *   `growth_leads`  what the "New lead follow-up" text automation reads.
 * A lead saved by staff goes into both, the same way the past-call import does, and is found again by the last ten digits of the phone,
 * however the number was typed. A lead from the public form goes into `leads` only: nothing may text a stranger because they typed a number.
 * Saving the same person twice updates the first record and adds the new note; it never makes a second one, and it never moves a lead
 * the shop already marked "contacted" back to "new". No `@/` imports, so `node --test` runs this exact code with a fake database.
 */

import type { QuoteInput } from './quote.ts'

type Db = { from: (table: string) => any }

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
export const last10 = (v: unknown) => digits(v).slice(-10)
const text = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max)
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
/** Notes Alpha wrote itself while researching a lead are kept as they are. */
const isStructured = (v: unknown) => typeof v === 'string' && /^\s*[{[]/.test(v)
const PLACEHOLDER_NAMES = ['', 'unknown', 'unknown caller', 'past caller', 'caller']

/** A phone number the way the rest of the app stores it: +1XXXXXXXXXX for a US number, otherwise digits with a plus. Null when it cannot be a number. */
export function storePhone(raw: unknown): string | null {
  const d = digits(raw)
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  if (d.length >= 8 && d.length <= 15) return `+${d}`
  return null
}

export interface CaptureInput { name?: unknown; phone?: unknown; email?: unknown; source?: unknown; vehicle_info?: unknown; notes?: unknown; service?: unknown; needs_followup?: unknown }
export interface CleanCapture { name: string; phone: string | null; email: string | null; source: string; vehicle: string | null; notes: string | null; service: string | null; needsFollowup: boolean }
export type CaptureCleaned = { ok: true; value: CleanCapture } | { ok: false; error: string }

export function cleanCapture(raw: CaptureInput): CaptureCleaned {
  const name = text(raw.name, 80)
  const phoneRaw = String(raw.phone ?? '').trim()
  const phone = phoneRaw ? storePhone(phoneRaw) : null
  if (phoneRaw && !phone) return { ok: false, error: 'Enter a 10-digit phone number, or leave it empty.' }
  if (!name && !phone) return { ok: false, error: 'Enter a name or a phone number.' }
  const email = text(raw.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Enter an email like name@example.com, or leave it empty.' }
  return {
    ok: true,
    value: {
      name, phone, email: email || null, source: text(raw.source, 40) || 'walk-in', vehicle: text(raw.vehicle_info, 120) || null,
      notes: text(raw.notes, 1500) || null, service: text(raw.service, 160) || null, needsFollowup: raw.needs_followup !== false,
    },
  }
}

async function findByPhone(db: Db, table: string, shopId: string, phone: string | null): Promise<Record<string, any> | null> {
  if (!phone) return null
  const key = last10(phone)
  if (key.length < 7) return null
  const { data, error } = await db.from(table).select('*').eq('shop_id', shopId).ilike('phone', `%${key.slice(-4)}%`).limit(50)
  if (error) throw new Error(`${table} lookup failed: ${error.message}`)
  return (Array.isArray(data) ? data : []).find((r: Record<string, any>) => last10(r.phone) === key) ?? null
}

const addNote = (existing: unknown, note: string | null, today: string) => {
  if (!note) return null
  return existing && String(existing).trim() ? `${String(existing).slice(0, 3000)}\n---\n${today}: ${note}` : `${today}: ${note}`
}
const dayAfter = (today: string) => ymd(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000))

export type CaptureResult =
  | { ok: true; status: 'created' | 'updated'; leadId: string | null; growthId: string | null; name: string; message: string }
  | { ok: false; status: number; error: string }

/** Staff saves a lead (from a call or the counter). Writes `leads` and `growth_leads`; each is looked up on its own, so a retry fills in whichever is missing. */
export async function captureLead(db: Db, shopId: string, input: CaptureInput, now: Date = new Date(), today: string = ymd(now)): Promise<CaptureResult> {
  const c = cleanCapture(input)
  if (!c.ok) return { ok: false, status: 400, error: c.error }
  const v = c.value
  const iso = now.toISOString()
  try {
    const [lead, growth] = await Promise.all([findByPhone(db, 'leads', shopId, v.phone), findByPhone(db, 'growth_leads', shopId, v.phone)])
    const shown = v.name || v.phone || 'This caller'
    let leadId: string | null = lead?.id ? String(lead.id) : null
    let growthId: string | null = growth?.id ? String(growth.id) : null

    if (lead) {
      const patch: Record<string, unknown> = { last_contact: iso, updated_at: iso }
      if (v.name && PLACEHOLDER_NAMES.includes(String(lead.name ?? '').trim().toLowerCase())) patch.name = v.name
      if (v.email && !lead.email) patch.email = v.email
      if (v.service && !lead.service_needed) patch.service_needed = v.service
      if (!isStructured(lead.notes)) { const n = addNote(lead.notes, v.notes, today); if (n) patch.notes = n }
      const { error } = await db.from('leads').update(patch).eq('id', lead.id).eq('shop_id', shopId)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await db.from('leads').insert({
        shop_id: shopId, name: v.name || 'Unknown caller', phone: v.phone, email: v.email, service_needed: v.service, source: v.source,
        notes: addNote(null, v.notes, today), status: 'new', follow_up_date: dayAfter(today),
      }).select('id').single()
      if (error) throw new Error(error.message)
      leadId = data?.id ? String(data.id) : null
    }

    if (growth) {
      const patch: Record<string, unknown> = { touch_count: (Number(growth.touch_count) || 0) + 1, last_contact: iso }
      if (v.name && PLACEHOLDER_NAMES.includes(String(growth.name ?? '').trim().toLowerCase())) patch.name = v.name
      if (v.email && !growth.email) patch.email = v.email
      if (v.vehicle && !growth.vehicle_info) patch.vehicle_info = v.vehicle
      if (v.notes) patch.notes = addNote(growth.notes, v.notes, today)
      const { error } = await db.from('growth_leads').update(patch).eq('id', growth.id).eq('shop_id', shopId)
      if (error) throw new Error(error.message)
    } else {
      const { data, error } = await db.from('growth_leads').insert({
        shop_id: shopId, name: v.name || 'Unknown', phone: v.phone, email: v.email, source: v.source, vehicle_info: v.vehicle, notes: v.notes,
        status: 'new', needs_followup: v.needsFollowup, touch_count: 1, last_contact: iso, converted: false, created_at: iso,
      }).select('id').single()
      if (error) throw new Error(error.message)
      growthId = data?.id ? String(data.id) : null
    }

    const existed = Boolean(lead || growth)
    return {
      ok: true, status: existed ? 'updated' : 'created', leadId, growthId, name: shown,
      message: existed ? `${shown} is already one of your leads. This call was added to the notes.` : `${shown} was saved as a lead.`,
    }
  } catch (e) {
    console.error('[lead-capture] failed:', e instanceof Error ? e.message : e)
    return { ok: false, status: 500, error: 'The lead could not be saved. Nothing was lost; try again.' }
  }
}

export const WEB_SOURCE = 'Website'
/** Most new, unanswered requests from the public form the Leads tab will hold at once. Past this the form says to call. */
export const WEB_LEADS_WAITING_MAX = 60
/** A second request from the same number inside this many days is added to the first one. */
export const WEB_REPEAT_DAYS = 14

export type WebLeadResult = { ok: true; status: 'created' | 'repeat' } | { ok: false; status: 'busy' | 'failed' }

/** A visitor asks for a price. One lead per number: asking again adds to the first request instead of making a pile. */
export async function saveWebLead(db: Db, shopId: string, v: QuoteInput, today: string, now: Date = new Date()): Promise<WebLeadResult> {
  const iso = now.toISOString()
  const note = `Asked for a price on the booking page. Vehicle: ${v.vehicle}. They wrote: ${v.message}`.slice(0, 900)
  try {
    const found = await findByPhone(db, 'leads', shopId, v.phone)
    if (found) {
      const age = (now.getTime() - Date.parse(String(found.created_at ?? ''))) / 86_400_000
      const open = ['new', 'contacted'].includes(String(found.status ?? 'new'))
      if (open || (Number.isFinite(age) && age <= WEB_REPEAT_DAYS)) {
        const patch: Record<string, unknown> = { updated_at: iso }
        if (!isStructured(found.notes)) patch.notes = `${String(found.notes ?? '').slice(0, 2500)}${found.notes ? '\n---\n' : ''}${today}: ${note}`.slice(0, 3000)
        if (v.email && !found.email) patch.email = v.email
        const { error } = await db.from('leads').update(patch).eq('id', found.id).eq('shop_id', shopId)
        if (error) throw new Error(error.message)
        return { ok: true, status: 'repeat' }
      }
    }
    const { count, error: countError } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).eq('source', WEB_SOURCE).eq('status', 'new')
    if (countError) throw new Error(countError.message)
    if ((count ?? 0) >= WEB_LEADS_WAITING_MAX) return { ok: false, status: 'busy' }
    const { error } = await db.from('leads').insert({
      shop_id: shopId, name: v.name, phone: v.phone, email: v.email || null, service_needed: v.message.slice(0, 160), source: WEB_SOURCE,
      notes: `${today}: ${note}`, status: 'new', follow_up_date: today,
    })
    if (error) throw new Error(error.message)
    return { ok: true, status: 'created' }
  } catch (e) {
    console.error('[lead-capture] web lead failed:', e instanceof Error ? e.message : e)
    return { ok: false, status: 'failed' }
  }
}
