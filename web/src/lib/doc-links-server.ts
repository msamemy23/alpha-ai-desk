// Customer links on the server: making one, finding one from its token, counting views.
// Server only. Uses the service client; every query is scoped by the link's own shop and document.

import { newLinkToken, linkExpiry, LINK_DAYS, isLinkToken } from '@/lib/doc-links'
import { hasUnapprovedLines, isLineApproved } from '@/lib/doc-lines'
import { isMissingSchema } from '@/lib/doc-server'
import type { Db } from '@/lib/doc-server'

export interface LinkRow {
  id: string
  shop_id: string
  document_id: string
  token: string
  purpose: string
  doc_type?: string | null
  doc_number?: string | null
  channel: string | null
  sent_to: string | null
  content_hash: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  view_count: number
  email_opened_at: string | null
  email_open_count: number
  completed_at: string | null
  response: string | null
}

export interface LegacySignature {
  id: string
  shop_id: string | null
  document_id: string
  token: string
  customer_email: string | null
  expires_at: string | null
  signed_at: string | null
  signer_name: string | null
}

export type Resolved =
  | { kind: 'link'; link: LinkRow }
  | { kind: 'legacy'; sig: LegacySignature }

/** Finds a customer link from its token: the new links first, then the older sign-only links. */
export async function resolveToken(db: Db, token: string): Promise<Resolved | null> {
  if (!isLinkToken(token)) return null
  const fresh = await db.from('document_links').select('*').eq('token', token).maybeSingle()
  if (!fresh.error && fresh.data) return { kind: 'link', link: fresh.data as LinkRow }
  // A missing table means this database has not had migration 046 yet; any other error is a real failure.
  if (fresh.error && !isMissingSchema(fresh.error)) throw new Error('Link lookup failed')
  const legacy = await db.from('signatures').select('*').eq('token', token).maybeSingle()
  if (legacy.error || !legacy.data) return null
  return { kind: 'legacy', sig: legacy.data as LegacySignature }
}

export interface MadeLink { token: string; expiresAt: string; kind: 'link' | 'legacy'; id: string | null; reused: boolean }

interface MakeInput {
  shopId: string
  userId: string | null
  doc: Record<string, unknown> & { id: string }
  channel: 'email' | 'sms' | 'copy'
  sentTo: string
  contentHash: string
  nowMs?: number
}

/**
 * The link to put in a message. An open link for the same document is reused (so sending twice gives the same
 * address and its views add up) and its time is extended. If the database has no links table yet, an older
 * sign-only link is made instead so sending still works.
 */
export async function ensureLink(db: Db, input: MakeInput): Promise<MadeLink> {
  const now = input.nowMs ?? Date.now()
  const expiresAt = linkExpiry(now, LINK_DAYS)
  const doc = input.doc
  const supplement = hasUnapprovedLines(doc) && [...(Array.isArray(doc.parts) ? doc.parts : []), ...(Array.isArray(doc.labors) ? doc.labors : [])]
    .some((l) => l && typeof l === 'object' && isLineApproved(l as Record<string, unknown>))
  const purpose = supplement ? 'supplement' : 'review'

  const open = await db
    .from('document_links')
    .select('id,token,expires_at,revoked_at,completed_at,purpose')
    .eq('shop_id', input.shopId)
    .eq('document_id', doc.id)
    .order('created_at', { ascending: false })
    .limit(10)
  if (open.error && !isMissingSchema(open.error)) throw new Error('Could not look up the customer link')

  if (!open.error) {
    const rows = (open.data || []) as { id: string; token: string; expires_at: string; revoked_at: string | null; completed_at: string | null; purpose: string }[]
    const live = rows.find((r) => !r.revoked_at && !r.completed_at && r.purpose === purpose && new Date(r.expires_at).getTime() > now)
    if (live) {
      const { error } = await db.from('document_links').update({ expires_at: expiresAt, channel: input.channel, sent_to: input.sentTo.slice(0, 200) }).eq('id', live.id).eq('shop_id', input.shopId)
      if (error) throw new Error('Could not refresh the customer link')
      return { token: live.token, expiresAt, kind: 'link', id: live.id, reused: true }
    }
    const token = newLinkToken()
    const { data, error } = await db.from('document_links').insert({
      shop_id: input.shopId,
      document_id: doc.id,
      token,
      purpose,
      doc_type: String(doc.type || ''),
      doc_number: String(doc.doc_number || ''),
      channel: input.channel,
      sent_to: input.sentTo.slice(0, 200),
      content_hash: input.contentHash,
      created_by: input.userId,
      expires_at: expiresAt,
    }).select('id').single()
    if (error) throw new Error('Could not make the customer link')
    return { token, expiresAt, kind: 'link', id: (data as { id: string }).id, reused: false }
  }

  // Older sign-only link.
  const token = crypto.randomUUID()
  const { data, error } = await db.from('signatures').insert({
    shop_id: input.shopId, token, document_id: doc.id, customer_email: input.channel === 'email' ? input.sentTo : null, expires_at: expiresAt,
  }).select('id').single()
  if (error) throw new Error('Could not make the signing link')
  return { token, expiresAt, kind: 'legacy', id: (data as { id: string } | null)?.id ?? null, reused: false }
}

/** Counts a page view. A reload within half a minute is not counted again. Returns true on the very first view. */
export async function recordView(db: Db, link: LinkRow, nowMs = Date.now()): Promise<boolean> {
  const last = link.last_viewed_at ? new Date(link.last_viewed_at).getTime() : 0
  if (last && nowMs - last < 30000) return false
  const first = !link.first_viewed_at
  const patch: Record<string, unknown> = { last_viewed_at: new Date(nowMs).toISOString(), view_count: (link.view_count || 0) + 1 }
  if (first) patch.first_viewed_at = patch.last_viewed_at
  const { error } = await db.from('document_links').update(patch).eq('id', link.id).eq('shop_id', link.shop_id)
  if (error) return false
  return first
}

/**
 * Turns off every open link for a document: new links are marked revoked, and older sign-only links that nobody has
 * signed yet are expired. Returns how many were turned off. A missing links table (database not updated yet) is not
 * an error; the older links are still handled.
 */
export async function revokeLinks(db: Db, shopId: string, documentId: string, nowIso = new Date().toISOString()): Promise<{ count: number; failed: boolean }> {
  let count = 0
  let failed = false
  const open = await db.from('document_links').select('id,revoked_at,completed_at').eq('shop_id', shopId).eq('document_id', documentId).limit(200)
  if (open.error) {
    if (!isMissingSchema(open.error)) failed = true
  } else {
    const ids = ((open.data || []) as { id: string; revoked_at: string | null; completed_at: string | null }[]).filter((r) => !r.revoked_at && !r.completed_at).map((r) => r.id)
    for (const id of ids) {
      const { error } = await db.from('document_links').update({ revoked_at: nowIso }).eq('id', id).eq('shop_id', shopId)
      if (error) failed = true
      else count += 1
    }
  }
  const legacy = await db.from('signatures').select('id,signed_at,expires_at').eq('shop_id', shopId).eq('document_id', documentId).limit(200)
  if (!legacy.error) {
    const now = new Date(nowIso).getTime()
    const ids = ((legacy.data || []) as { id: string; signed_at: string | null; expires_at: string | null }[])
      .filter((r) => !r.signed_at && (!r.expires_at || new Date(r.expires_at).getTime() > now)).map((r) => r.id)
    for (const id of ids) {
      const { error } = await db.from('signatures').update({ expires_at: nowIso }).eq('id', id).eq('shop_id', shopId)
      if (error) failed = true
      else count += 1
    }
  }
  return { count, failed }
}

/** Gives open links more time, never less. Used when the estimate's good-through date is pushed out. */
export async function extendLinks(db: Db, shopId: string, documentId: string, untilIso: string): Promise<void> {
  const open = await db.from('document_links').select('id,expires_at,revoked_at,completed_at').eq('shop_id', shopId).eq('document_id', documentId).limit(200)
  if (open.error) return
  const until = new Date(untilIso).getTime()
  for (const r of (open.data || []) as { id: string; expires_at: string; revoked_at: string | null; completed_at: string | null }[]) {
    if (r.revoked_at || r.completed_at) continue
    if (new Date(r.expires_at).getTime() >= until) continue
    await db.from('document_links').update({ expires_at: untilIso }).eq('id', r.id).eq('shop_id', shopId)
  }
}
