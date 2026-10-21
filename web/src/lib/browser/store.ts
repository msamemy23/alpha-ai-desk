/**
 * The browser's saved things: settings, allow and block rules, quick sites, and approvals.
 *
 * Every function takes the database client as its first argument (the service client in the app, a fake in tests) and
 * every query is filtered by shop_id. Until migrations 058 and 059 are applied, each function reports `missing: true`
 * instead of failing, so the browser still works with built-in defaults and each screen can say "needs a database update".
 * Approvals fail closed: with no table there is no approval, and nothing that needs one happens.
 *
 * Server only. Plain TypeScript so it runs under `node --test`.
 */
import { createHash } from 'node:crypto'
import { DEFAULT_SETTINGS } from './policy.ts'
import type { BrowserSettings, SiteRule } from './policy.ts'
import { cleanRuleHost, parseTarget } from './url.ts'
import type { ApprovalDetails, ApprovalKind } from './actions.ts'
import type { AuthorizeInput, AuthorizeResult } from './engine.ts'

// A loose view of the Supabase client: only what is used here.
export type Db = { from: (table: string) => any }

interface DbError { code?: string; message?: string }

/** True when the table or column simply is not there yet (the migration has not been applied). */
export function isMissingTable(error: DbError | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '')
  return code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204' || /schema cache|does not exist|could not find the .* column/i.test(message)
}

export class NeedsDatabaseUpdate extends Error {
  feature: string
  constructor(feature: string) {
    super('This needs a database update.')
    this.name = 'NeedsDatabaseUpdate'
    this.feature = feature
  }
}

/* ---------- quick sites ---------- */

export interface Bookmark { id: string; title: string; url: string; kind: 'quick' | 'saved'; position: number; builtin?: boolean }

/** Shown until the shop saves its own. Public sites a repair shop looks things up on every day. */
export const DEFAULT_QUICK_SITES: Bookmark[] = [
  { id: 'builtin-recalls', title: 'Recall check', url: 'https://www.nhtsa.gov/recalls', kind: 'quick', position: 0, builtin: true },
  { id: 'builtin-vin', title: 'VIN decoder', url: 'https://vpic.nhtsa.dot.gov/decoder/', kind: 'quick', position: 1, builtin: true },
  { id: 'builtin-rockauto', title: 'RockAuto', url: 'https://www.rockauto.com/', kind: 'quick', position: 2, builtin: true },
  { id: 'builtin-autozone', title: 'AutoZone', url: 'https://www.autozone.com/', kind: 'quick', position: 3, builtin: true },
  { id: 'builtin-napa', title: 'NAPA Online', url: 'https://www.napaonline.com/', kind: 'quick', position: 4, builtin: true },
  { id: 'builtin-oreilly', title: "O'Reilly Auto Parts", url: 'https://www.oreillyauto.com/', kind: 'quick', position: 5, builtin: true },
  { id: 'builtin-advance', title: 'Advance Auto Parts', url: 'https://shop.advanceautoparts.com/', kind: 'quick', position: 6, builtin: true },
]

/* ---------- settings ---------- */

interface SettingsRow { mode?: string; ai_enabled?: boolean; reader_images?: boolean }

function settingsFromRow(row: SettingsRow | null | undefined): BrowserSettings {
  if (!row) return { ...DEFAULT_SETTINGS }
  return {
    mode: row.mode === 'allowlist' ? 'allowlist' : 'open',
    aiEnabled: row.ai_enabled !== false,
    readerImages: row.reader_images !== false,
  }
}

export async function loadSettings(db: Db, shopId: string): Promise<{ settings: BrowserSettings; missing: boolean }> {
  try {
    const { data, error } = await db.from('browser_settings').select('mode,ai_enabled,reader_images').eq('shop_id', shopId).maybeSingle()
    if (error) return { settings: { ...DEFAULT_SETTINGS }, missing: isMissingTable(error) }
    return { settings: settingsFromRow(data), missing: false }
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, missing: false }
  }
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; missing: boolean; error: string }

export async function saveSettings(db: Db, shopId: string, userId: string, patch: Partial<BrowserSettings>): Promise<SaveResult<BrowserSettings>> {
  const current = await loadSettings(db, shopId)
  if (current.missing) return { ok: false, missing: true, error: 'This needs a database update.' }
  const next: BrowserSettings = {
    mode: patch.mode === 'allowlist' || patch.mode === 'open' ? patch.mode : current.settings.mode,
    aiEnabled: typeof patch.aiEnabled === 'boolean' ? patch.aiEnabled : current.settings.aiEnabled,
    readerImages: typeof patch.readerImages === 'boolean' ? patch.readerImages : current.settings.readerImages,
  }
  const { error } = await db.from('browser_settings').upsert(
    { shop_id: shopId, mode: next.mode, ai_enabled: next.aiEnabled, reader_images: next.readerImages, updated_by: userId, updated_at: new Date().toISOString() },
    { onConflict: 'shop_id' },
  )
  if (error) return { ok: false, missing: isMissingTable(error), error: isMissingTable(error) ? 'This needs a database update.' : 'The settings could not be saved. Try again.' }
  return { ok: true, value: next }
}

/* ---------- allow and block rules ---------- */

export interface StoredRule extends SiteRule { id: string }

export async function listRules(db: Db, shopId: string): Promise<{ rules: StoredRule[]; missing: boolean; error?: string }> {
  try {
    const { data, error } = await db.from('browser_site_rules').select('id,host,rule,note').eq('shop_id', shopId).order('host', { ascending: true }).limit(500)
    if (error) return { rules: [], missing: isMissingTable(error), error: isMissingTable(error) ? undefined : 'The site rules could not be loaded.' }
    const rules = (data || []).filter((r: { rule: string }) => r.rule === 'allow' || r.rule === 'block').map((r: { id: string; host: string; rule: 'allow' | 'block'; note?: string | null }) => ({ id: r.id, host: r.host, rule: r.rule, note: r.note || undefined }))
    return { rules, missing: false }
  } catch {
    return { rules: [], missing: false, error: 'The site rules could not be loaded.' }
  }
}

export async function addRule(db: Db, shopId: string, userId: string, hostInput: string, rule: 'allow' | 'block', note?: string): Promise<SaveResult<StoredRule>> {
  const host = cleanRuleHost(hostInput)
  if (!host) return { ok: false, missing: false, error: 'Type a site name such as example.com.' }
  if (rule !== 'allow' && rule !== 'block') return { ok: false, missing: false, error: 'Choose allow or block.' }
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 200) : ''
  const { data, error } = await db.from('browser_site_rules').upsert(
    { shop_id: shopId, host, rule, note: cleanNote || null, created_by: userId },
    { onConflict: 'shop_id,host' },
  ).select('id,host,rule,note').maybeSingle()
  if (error) return { ok: false, missing: isMissingTable(error), error: isMissingTable(error) ? 'This needs a database update.' : 'The rule could not be saved. Try again.' }
  return { ok: true, value: { id: data?.id || '', host, rule, note: cleanNote || undefined } }
}

export async function removeRule(db: Db, shopId: string, id: string): Promise<SaveResult<true>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, missing: false, error: 'That rule was not found.' }
  const { error } = await db.from('browser_site_rules').delete().eq('shop_id', shopId).eq('id', id)
  if (error) return { ok: false, missing: isMissingTable(error), error: isMissingTable(error) ? 'This needs a database update.' : 'The rule could not be removed. Try again.' }
  return { ok: true, value: true }
}

/* ---------- quick sites and saved pages ---------- */

export async function listBookmarks(db: Db, shopId: string): Promise<{ items: Bookmark[]; missing: boolean; error?: string }> {
  try {
    const { data, error } = await db.from('browser_bookmarks').select('id,title,url,kind,position').eq('shop_id', shopId).order('position', { ascending: true }).limit(200)
    if (error) return { items: DEFAULT_QUICK_SITES, missing: isMissingTable(error), error: isMissingTable(error) ? undefined : 'Saved sites could not be loaded.' }
    const items: Bookmark[] = (data || []).map((r: { id: string; title: string; url: string; kind: string; position: number }) => ({ id: r.id, title: r.title, url: r.url, kind: r.kind === 'saved' ? 'saved' : 'quick', position: r.position }))
    const quick = items.filter(i => i.kind === 'quick')
    return { items: quick.length ? items : [...DEFAULT_QUICK_SITES, ...items], missing: false }
  } catch {
    return { items: DEFAULT_QUICK_SITES, missing: false, error: 'Saved sites could not be loaded.' }
  }
}

export async function addBookmark(db: Db, shopId: string, userId: string, input: { title: string; url: string; kind?: 'quick' | 'saved' }): Promise<SaveResult<Bookmark>> {
  const parsed = parseTarget(input.url)
  if (!parsed.ok) return { ok: false, missing: false, error: parsed.message }
  const title = String(input.title || parsed.host).replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!title) return { ok: false, missing: false, error: 'Give it a name.' }
  const kind = input.kind === 'saved' ? 'saved' : 'quick'
  const url = parsed.url.toString()
  const { data, error } = await db.from('browser_bookmarks').upsert(
    { shop_id: shopId, title, url, kind, position: 100, created_by: userId },
    { onConflict: 'shop_id,kind,url' },
  ).select('id,title,url,kind,position').maybeSingle()
  if (error) return { ok: false, missing: isMissingTable(error), error: isMissingTable(error) ? 'This needs a database update.' : 'It could not be saved. Try again.' }
  return { ok: true, value: { id: data?.id || '', title, url, kind, position: data?.position ?? 100 } }
}

export async function removeBookmark(db: Db, shopId: string, id: string): Promise<SaveResult<true>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, missing: false, error: 'That one was not found.' }
  const { error } = await db.from('browser_bookmarks').delete().eq('shop_id', shopId).eq('id', id)
  if (error) return { ok: false, missing: isMissingTable(error), error: isMissingTable(error) ? 'This needs a database update.' : 'It could not be removed. Try again.' }
  return { ok: true, value: true }
}

/* ---------- approvals ---------- */

export function hashAction(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex')
}

export interface ApprovalRow {
  id: string
  kind: ApprovalKind
  actor: 'user' | 'ai'
  host: string
  url: string
  summary: string
  details: ApprovalDetails | Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'used'
  requestedBy: string
  expiresAt: string
  createdAt: string
}

function approvalFromRow(r: Record<string, unknown>): ApprovalRow {
  return {
    id: String(r.id), kind: r.kind as ApprovalKind, actor: r.actor === 'ai' ? 'ai' : 'user', host: String(r.host || ''), url: String(r.url || ''),
    summary: String(r.summary || ''), details: (r.details as ApprovalDetails) || {}, status: r.status as ApprovalRow['status'], requestedBy: String(r.requested_by || ''),
    expiresAt: String(r.expires_at || ''), createdAt: String(r.created_at || ''),
  }
}

export const APPROVAL_MINUTES = 10

export async function createApproval(db: Db, shopId: string, userId: string, input: { kind: ApprovalKind; hash: string; details: ApprovalDetails; actor: 'user' | 'ai'; now?: number }): Promise<{ ok: true; id: string } | { ok: false; missing: boolean }> {
  const now = input.now ?? Date.now()
  try {
    const { data, error } = await db.from('browser_approvals').insert({
      shop_id: shopId, requested_by: userId, actor: input.actor, kind: input.kind, action_hash: input.hash,
      host: input.details.host.slice(0, 253), url: input.details.url.slice(0, 600), summary: input.details.summary.slice(0, 800),
      details: { title: input.details.title, why: input.details.why, fields: input.details.fields.slice(0, 12).map(f => ({ label: String(f.label).slice(0, 80), value: String(f.value).slice(0, 200) })) },
      status: 'pending', expires_at: new Date(now + APPROVAL_MINUTES * 60_000).toISOString(),
    }).select('id').maybeSingle()
    if (error || !data?.id) return { ok: false, missing: isMissingTable(error) }
    return { ok: true, id: String(data.id) }
  } catch {
    return { ok: false, missing: false }
  }
}

export async function getApproval(db: Db, shopId: string, id: string): Promise<ApprovalRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const { data } = await db.from('browser_approvals').select('*').eq('shop_id', shopId).eq('id', id).maybeSingle()
    return data ? approvalFromRow(data) : null
  } catch { return null }
}

export type DecideResult =
  | { ok: true; approval: ApprovalRow }
  | { ok: false; reason: 'not_found' | 'expired' | 'decided' | 'missing' }

/** A person presses Approve or Deny. Only the person who asked can decide, only while it is pending and not expired. */
export async function decideApproval(db: Db, shopId: string, userId: string, id: string, decision: 'approved' | 'denied', now = Date.now()): Promise<DecideResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, reason: 'not_found' }
  const nowIso = new Date(now).toISOString()
  try {
    const { data, error } = await db.from('browser_approvals')
      .update({ status: decision, decided_by: userId, decided_at: nowIso })
      .eq('id', id).eq('shop_id', shopId).eq('requested_by', userId).eq('status', 'pending').gt('expires_at', nowIso)
      .select('*')
    if (error) return { ok: false, reason: isMissingTable(error) ? 'missing' : 'not_found' }
    if (Array.isArray(data) && data.length === 1) return { ok: true, approval: approvalFromRow(data[0]) }
    const existing = await getApproval(db, shopId, id)
    if (!existing || existing.requestedBy !== userId) return { ok: false, reason: 'not_found' }
    if (existing.status !== 'pending') return { ok: false, reason: 'decided' }
    return { ok: false, reason: 'expired' }
  } catch {
    return { ok: false, reason: 'not_found' }
  }
}

/**
 * Use up an approval. True only if this exact action was approved by this person, has not been used, and has not expired.
 * One conditional update, so two calls at once cannot both succeed. Any error means no.
 */
export async function consumeApproval(db: Db, shopId: string, userId: string, id: string, hash: string, now = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{64}$/.test(hash)) return false
  const nowIso = new Date(now).toISOString()
  try {
    const { data, error } = await db.from('browser_approvals')
      .update({ status: 'used', used_at: nowIso })
      .eq('id', id).eq('shop_id', shopId).eq('requested_by', userId).eq('status', 'approved').eq('action_hash', hash).gt('expires_at', nowIso)
      .select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/** The pending approvals for one person, newest first. */
export async function listPendingApprovals(db: Db, shopId: string, userId: string, now = Date.now()): Promise<{ items: ApprovalRow[]; missing: boolean }> {
  try {
    const { data, error } = await db.from('browser_approvals').select('*').eq('shop_id', shopId).eq('requested_by', userId).eq('status', 'pending').gt('expires_at', new Date(now).toISOString()).order('created_at', { ascending: false }).limit(10)
    if (error) return { items: [], missing: isMissingTable(error) }
    return { items: (data || []).map(approvalFromRow), missing: false }
  } catch { return { items: [], missing: false } }
}

/** What the engine calls when an action needs a person. Consumes a matching approval or records a new pending one. */
export function authorizerFor(db: Db, shopId: string, userId: string, actor: 'user' | 'ai', now?: () => number) {
  return async (input: AuthorizeInput): Promise<AuthorizeResult> => {
    const hash = hashAction(input.canonical)
    if (input.approvalId && await consumeApproval(db, shopId, userId, input.approvalId, hash, now?.())) return { granted: true }
    const made = await createApproval(db, shopId, userId, { kind: input.kind, hash, details: input.details, actor, now: now?.() })
    if (!made.ok) throw made.missing ? new NeedsDatabaseUpdate('approvals') : new Error('approvals_unavailable')
    return { granted: false, approvalId: made.id }
  }
}
