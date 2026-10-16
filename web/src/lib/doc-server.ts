// Shared server-side helpers for the estimate and invoice routes. Server only: it uses the service client.
//
// Every table the new features use may be missing in a database that has not had migrations 046 to 048
// applied. The routes use these helpers so a missing table turns into a plain "needs a database update"
// answer for that one feature, and everything else keeps working.

import { getServiceClient } from '@/lib/supabase'
import { normalizePrefs } from '@/lib/doc-prefs'
import type { DocPrefs } from '@/lib/doc-prefs'
import { normalizeOptionGroup } from '@/lib/doc-approval'
import type { OptionGroup } from '@/lib/doc-approval'
import type { PublicShop } from '@/lib/doc-public'
import type { EventKind } from '@/lib/doc-history'
import { sendEmail } from '@/lib/email'
import { siteOrigin } from '@/lib/doc-links'

export type Db = ReturnType<typeof getServiceClient>

interface PgError { code?: string; message?: string }

/** The table or column is not there yet (migration not applied), as opposed to a real failure. */
export function isMissingSchema(error: PgError | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '').toLowerCase()
  return code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204' ||
    message.includes('schema cache') || (message.includes('does not exist') && (message.includes('relation') || message.includes('column')))
}

export const NEEDS_UPDATE = 'This part needs a database update first. Ask whoever manages your account to apply it.'

/** Today as yyyy-mm-dd in the shop's time zone, so "expires today" matches the shop's clock. */
export function todayInZone(zone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/**
 * The shop's paperwork settings. `failed` is true when the read itself broke (not a missing table, not an empty row), in which
 * case `prefs` is only the defaults and must not be mistaken for what the shop saved. The settings screen reports that instead
 * of showing defaults, because saving settings replaces the whole object.
 */
export async function loadPrefs(db: Db, shopId: string): Promise<{ prefs: DocPrefs; available: boolean; failed: boolean }> {
  const { data, error } = await db.from('document_settings').select('data').eq('shop_id', shopId).maybeSingle()
  if (error) return { prefs: normalizePrefs(null), available: !isMissingSchema(error), failed: !isMissingSchema(error) }
  return { prefs: normalizePrefs(data?.data), available: true, failed: false }
}

export async function loadOptions(db: Db, shopId: string, documentId: string): Promise<{ options: OptionGroup[]; available: boolean }> {
  const { data, error } = await db
    .from('document_options')
    .select('id,name,position,choices,status,chosen_choice_id')
    .eq('shop_id', shopId)
    .eq('document_id', documentId)
    .order('position', { ascending: true })
  if (error) return { options: [], available: !isMissingSchema(error) }
  const options = (data || []).map(normalizeOptionGroup).filter((o): o is OptionGroup => o !== null)
  return { options, available: true }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export type ServerShop = PublicShop & { timezone: string }

/** The shop details a customer may see, plus its time zone. Never returns provider keys or the whole settings row. */
export async function loadPublicShop(db: Db, shopId: string): Promise<ServerShop> {
  let { data, error } = await db.from('settings').select('shop_name,shop_address,shop_phone,shop_email,timezone').eq('shop_id', shopId).maybeSingle()
  if (error) ({ data } = await db.from('settings').select('shop_name,shop_address,shop_phone,shop_email').eq('shop_id', shopId).maybeSingle())
  let hasLogo = false
  const logo = await db.from('settings').select('logo_data').eq('shop_id', shopId).maybeSingle()
  if (!logo.error && typeof logo.data?.logo_data === 'string' && logo.data.logo_data.startsWith('data:image/')) hasLogo = true
  return { name: str(data?.shop_name), address: str(data?.shop_address), phone: str(data?.shop_phone), email: str(data?.shop_email), hasLogo, timezone: str((data as Record<string, unknown> | null)?.timezone) || 'America/Chicago' }
}

export interface EventInput {
  shopId: string
  documentId: string
  docNumber?: string | null
  kind: EventKind | string
  actor?: 'staff' | 'customer' | 'system'
  actorName?: string | null
  summary: string
  detail?: unknown
}

/** Writes a history line. History is a record, not part of the action, so a failure here never fails the action. */
export async function logEvent(db: Db, e: EventInput): Promise<boolean> {
  try {
    const { error } = await db.from('document_events').insert({
      shop_id: e.shopId,
      document_id: e.documentId,
      doc_number: e.docNumber || null,
      kind: e.kind,
      actor: e.actor || 'staff',
      actor_name: e.actorName ? String(e.actorName).slice(0, 160) : null,
      summary: e.summary.slice(0, 600),
      detail: e.detail === undefined ? null : e.detail,
    })
    if (error && !isMissingSchema(error)) console.error('[documents] history line not saved:', error.message)
    return !error
  } catch (err) {
    console.error('[documents] history line failed:', err instanceof Error ? err.message : err)
    return false
  }
}

export interface RevisionInput {
  shopId: string
  documentId: string
  reason: 'edited' | 'customer_answer' | 'supplement' | 'restored' | 'voided'
  total: number
  snapshot: Record<string, unknown>
  userId?: string | null
}

/**
 * Saves an earlier version of a document under the next number. Two saves at the same moment cannot take the same
 * number (the database refuses the second), so one retry picks the next free one. A missing table is not an error:
 * the version is simply not kept until the database update is applied.
 */
export async function addRevision(db: Db, input: RevisionInput): Promise<{ ok: boolean; revisionNo: number | null; unavailable: boolean }> {
  if (JSON.stringify(input.snapshot).length > 250000) return { ok: false, revisionNo: null, unavailable: false }
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await db.from('document_revisions').select('revision_no').eq('shop_id', input.shopId).eq('document_id', input.documentId).order('revision_no', { ascending: false }).limit(1)
    if (last.error) return { ok: false, revisionNo: null, unavailable: isMissingSchema(last.error) }
    const next = ((last.data as { revision_no: number }[] | null)?.[0]?.revision_no ?? 0) + 1
    const { error } = await db.from('document_revisions').insert({
      shop_id: input.shopId, document_id: input.documentId, revision_no: next, reason: input.reason, total: input.total,
      snapshot: input.snapshot, created_by: input.userId || null,
    })
    if (!error) return { ok: true, revisionNo: next, unavailable: false }
    if (error.code !== '23505') return { ok: false, revisionNo: null, unavailable: isMissingSchema(error) }
  }
  return { ok: false, revisionNo: null, unavailable: false }
}

/** A short name for the person at the keyboard, for the history. */
export function staffLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string {
  const meta = user?.user_metadata || {}
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : ''
  return (name || user?.email || 'Shop staff').slice(0, 160)
}

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), { status, headers: { 'content-type': 'application/json' } })
}

export function jsonOk(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

/** A settings row (already loaded with the service client) as the shop details a customer may see. */
export function shopFromSettings(settings: Record<string, unknown> | null | undefined): ServerShop {
  const logo = settings?.logo_data
  return {
    name: str(settings?.shop_name), address: str(settings?.shop_address), phone: str(settings?.shop_phone), email: str(settings?.shop_email),
    hasLogo: typeof logo === 'string' && logo.startsWith('data:image/'),
    timezone: str(settings?.timezone) || 'America/Chicago',
  }
}

/** Sends through the shop's own email account when it has one, otherwise the server's default, as before. */
export async function sendShopEmail(
  settings: Record<string, unknown> | null | undefined,
  mail: { to: string; subject: string; html: string; replyTo?: string; idempotencyKey?: string },
): Promise<void> {
  const apiKey = typeof settings?.resend_api_key === 'string' ? settings.resend_api_key : ''
  const from = typeof settings?.from_email === 'string' ? settings.from_email : ''
  await sendEmail({ ...mail, ...(apiKey && from ? { apiKey, from } : {}) })
}

/** The address customers' links should use: the configured public address, or the one the request came to. */
export function originFor(req: { nextUrl: { origin: string } }): string {
  return siteOrigin(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL, req.nextUrl.origin)
}
