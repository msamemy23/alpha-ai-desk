/**
 * The "connect your computer" contract, on Alpha's side.
 *
 * A desktop app on the owner's own computer can pair with a shop and then do what Alpha asks inside the owner's real browser
 * (with their real sign-ins, which Alpha itself never sees). This file is everything the server needs for that: pairing,
 * the access token, a short queue of commands, and the results coming back. The desktop app itself is not built yet; the
 * fake host in the tests below plays its part exactly as the routes describe it.
 *
 * How it works, in plain steps:
 *  1. A manager taps "Connect your computer". Alpha shows a one-time code (8 letters and digits) that works for 10 minutes.
 *  2. The desktop app sends that code once. Alpha answers with a long access token, shown to the app once. Only a hash of the
 *     code and of the token is ever stored, so a database leak cannot be used to take over a computer.
 *  3. The app asks "anything for me?" every couple of seconds with the token. Alpha hands over at most one command at a time.
 *  4. The app does it and sends the result back. A command nobody picks up expires after two minutes.
 *  5. Revoking a computer in Alpha cuts it off at once. The app can also be removed on the computer itself.
 *
 * What Alpha will ask a computer to do is deliberately small: open an address (after the shop's rules), take a snapshot, scroll.
 * Clicking, typing and submitting on the owner's real browser stay off until the desktop app can show its own confirmation.
 *
 * Server only. Plain TypeScript so it runs under `node --test`.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { isMissingTable } from './store.ts'
import type { Db } from './store.ts'

export const PROTOCOL_VERSION = 1
export const PAIRING_MINUTES = 10
export const COMMAND_SECONDS = 120
export const ONLINE_SECONDS = 45
export const MAX_RESULT_BYTES = 1_200_000

// No 0, O, 1, I or L: nothing that is easy to misread when it is typed from a screen.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newPairingCode(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** What the app sent, cleaned up: "abcd efgh", "ABCD-EFGH" and "abcdefgh" are the same code. Anything else is no code. */
export function normalizeCode(input: unknown): string | null {
  const t = String(input ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (t.length !== 8 || !/^[A-Z2-9]+$/.test(t) || [...t].some(ch => !ALPHABET.includes(ch))) return null
  return `${t.slice(0, 4)}-${t.slice(4)}`
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function newToken(): string {
  return `abh_${randomBytes(32).toString('base64url')}`
}

export type HostCommandKind = 'open' | 'snapshot' | 'scroll'
export const ALLOWED_COMMANDS: HostCommandKind[] = ['open', 'snapshot', 'scroll']

export interface HostRow { id: string; name: string; status: 'pairing' | 'active' | 'revoked'; platform: string; appVersion: string; lastSeenAt: string | null; online: boolean; createdAt: string }

function hostFromRow(r: Record<string, unknown>, now: number): HostRow {
  const seen = r.last_seen_at ? Date.parse(String(r.last_seen_at)) : 0
  return {
    id: String(r.id), name: String(r.name || ''), status: r.status as HostRow['status'], platform: String(r.platform || ''), appVersion: String(r.app_version || ''),
    lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null, online: r.status === 'active' && seen > 0 && now - seen < ONLINE_SECONDS * 1000, createdAt: String(r.created_at || ''),
  }
}

export type Failure = { ok: false; missing: boolean; error: string }
const NEEDS_UPDATE: Failure = { ok: false, missing: true, error: 'This needs a database update.' }

export async function listHosts(db: Db, shopId: string, now = Date.now()): Promise<{ items: HostRow[]; missing: boolean }> {
  try {
    const { data, error } = await db.from('browser_hosts').select('*').eq('shop_id', shopId).neq('status', 'revoked').order('created_at', { ascending: false }).limit(20)
    if (error) return { items: [], missing: isMissingTable(error) }
    return { items: (data || []).map((r: Record<string, unknown>) => hostFromRow(r, now)), missing: false }
  } catch { return { items: [], missing: false } }
}

/** Start pairing. Any older code that was never used is thrown away, so only one code is live at a time. */
export async function createPairing(db: Db, shopId: string, userId: string, name: string, now = Date.now()): Promise<{ ok: true; hostId: string; code: string; expiresAt: string } | Failure> {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'My computer'
  try {
    const old = await db.from('browser_hosts').delete().eq('shop_id', shopId).eq('status', 'pairing')
    if (old.error) return isMissingTable(old.error) ? NEEDS_UPDATE : { ok: false, missing: false, error: 'Pairing could not be started. Try again.' }
    const code = newPairingCode()
    const expiresAt = new Date(now + PAIRING_MINUTES * 60_000).toISOString()
    const { data, error } = await db.from('browser_hosts').insert({ shop_id: shopId, name: clean, status: 'pairing', pairing_code_hash: hashSecret(code), pairing_expires_at: expiresAt, created_by: userId }).select('id').maybeSingle()
    if (error || !data?.id) return isMissingTable(error) ? NEEDS_UPDATE : { ok: false, missing: false, error: 'Pairing could not be started. Try again.' }
    return { ok: true, hostId: String(data.id), code, expiresAt }
  } catch { return { ok: false, missing: false, error: 'Pairing could not be started. Try again.' } }
}

/** The app sends the code once. A good code turns the row into an active computer and returns a token that is shown only now. */
export async function claimPairing(db: Db, codeInput: unknown, info: { platform?: unknown; appVersion?: unknown }, now = Date.now()): Promise<{ ok: true; hostId: string; shopId: string; token: string } | { ok: false; reason: 'invalid' | 'missing' }> {
  const code = normalizeCode(codeInput)
  if (!code) return { ok: false, reason: 'invalid' }
  const nowIso = new Date(now).toISOString()
  try {
    const found = await db.from('browser_hosts').select('id,shop_id').eq('pairing_code_hash', hashSecret(code)).eq('status', 'pairing').gt('pairing_expires_at', nowIso).maybeSingle()
    if (found.error) return { ok: false, reason: isMissingTable(found.error) ? 'missing' : 'invalid' }
    if (!found.data) return { ok: false, reason: 'invalid' }
    const token = newToken()
    const updated = await db.from('browser_hosts')
      .update({
        status: 'active', pairing_code_hash: null, pairing_expires_at: null, token_hash: hashSecret(token), last_seen_at: nowIso,
        platform: String(info.platform ?? '').slice(0, 60) || null, app_version: String(info.appVersion ?? '').slice(0, 30) || null,
      })
      .eq('id', found.data.id).eq('shop_id', found.data.shop_id).eq('status', 'pairing').select('id')
    if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) return { ok: false, reason: 'invalid' }
    return { ok: true, hostId: String(found.data.id), shopId: String(found.data.shop_id), token }
  } catch { return { ok: false, reason: 'invalid' } }
}

/** Who is this token? Only an active, un-revoked computer. Also notes that it was just seen. */
export async function authenticateHost(db: Db, token: unknown, now = Date.now()): Promise<{ hostId: string; shopId: string } | null> {
  const t = typeof token === 'string' ? token.trim() : ''
  if (!/^abh_[A-Za-z0-9_-]{40,60}$/.test(t)) return null
  try {
    const { data, error } = await db.from('browser_hosts').select('id,shop_id,status').eq('token_hash', hashSecret(t)).eq('status', 'active').maybeSingle()
    if (error || !data) return null
    await db.from('browser_hosts').update({ last_seen_at: new Date(now).toISOString() }).eq('id', data.id).eq('shop_id', data.shop_id)
    return { hostId: String(data.id), shopId: String(data.shop_id) }
  } catch { return null }
}

export async function revokeHost(db: Db, shopId: string, hostId: string, now = Date.now()): Promise<{ ok: true } | Failure> {
  if (!/^[0-9a-f-]{36}$/i.test(hostId)) return { ok: false, missing: false, error: 'That computer was not found.' }
  try {
    const { data, error } = await db.from('browser_hosts').update({ status: 'revoked', token_hash: null, pairing_code_hash: null, revoked_at: new Date(now).toISOString() }).eq('id', hostId).eq('shop_id', shopId).neq('status', 'revoked').select('id')
    if (error) return isMissingTable(error) ? NEEDS_UPDATE : { ok: false, missing: false, error: 'That computer could not be disconnected. Try again.' }
    if (!Array.isArray(data) || data.length !== 1) return { ok: false, missing: false, error: 'That computer was not found.' }
    // Anything still waiting for it will never run.
    await db.from('browser_host_commands').update({ status: 'expired' }).eq('host_id', hostId).eq('shop_id', shopId).in('status', ['queued', 'sent'])
    return { ok: true }
  } catch { return { ok: false, missing: false, error: 'That computer could not be disconnected. Try again.' } }
}

/* ---------- commands ---------- */

export interface HostCommand { id: string; kind: HostCommandKind; payload: Record<string, unknown>; expiresAt: string }

/** Check what Alpha is about to ask a computer to do. `refuse` is the shop's own address rule. */
export function validateCommand(kind: unknown, payload: unknown, refuse: (url: string) => string | null): { ok: true; kind: HostCommandKind; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (kind !== 'open' && kind !== 'snapshot' && kind !== 'scroll') return { ok: false, error: 'Alpha can only ask a connected computer to open an address, take a snapshot or scroll for now.' }
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (kind === 'snapshot') return { ok: true, kind, payload: {} }
  if (kind === 'scroll') {
    const dy = Number(p.dy)
    return Number.isFinite(dy) && dy !== 0 ? { ok: true, kind, payload: { dy: Math.max(-4000, Math.min(4000, Math.round(dy))) } } : { ok: false, error: 'Scroll by an amount.' }
  }
  const url = typeof p.url === 'string' ? p.url.trim() : ''
  if (!url) return { ok: false, error: 'Type a web address.' }
  const why = refuse(url)
  return why ? { ok: false, error: why } : { ok: true, kind, payload: { url } }
}

export async function enqueueCommand(db: Db, shopId: string, userId: string, hostId: string, command: { kind: HostCommandKind; payload: Record<string, unknown> }, now = Date.now()): Promise<{ ok: true; id: string } | Failure> {
  try {
    const host = await db.from('browser_hosts').select('id,status').eq('id', hostId).eq('shop_id', shopId).maybeSingle()
    if (host.error) return isMissingTable(host.error) ? NEEDS_UPDATE : { ok: false, missing: false, error: 'That computer could not be reached.' }
    if (!host.data || host.data.status !== 'active') return { ok: false, missing: false, error: 'That computer is not connected.' }
    const open = await db.from('browser_host_commands').select('id').eq('host_id', hostId).eq('shop_id', shopId).in('status', ['queued', 'sent']).gt('expires_at', new Date(now).toISOString()).limit(5)
    if (!open.error && Array.isArray(open.data) && open.data.length >= 3) return { ok: false, missing: false, error: 'That computer is still busy with earlier requests. Wait a moment.' }
    const { data, error } = await db.from('browser_host_commands').insert({
      shop_id: shopId, host_id: hostId, kind: command.kind, payload: command.payload, status: 'queued', requested_by: userId, expires_at: new Date(now + COMMAND_SECONDS * 1000).toISOString(),
    }).select('id').maybeSingle()
    if (error || !data?.id) return isMissingTable(error) ? NEEDS_UPDATE : { ok: false, missing: false, error: 'The request could not be queued. Try again.' }
    return { ok: true, id: String(data.id) }
  } catch { return { ok: false, missing: false, error: 'The request could not be queued. Try again.' } }
}

/** Hand the computer its oldest waiting command. It moves to "sent" in one step, so two polls never get the same one. */
export async function nextCommand(db: Db, shopId: string, hostId: string, now = Date.now()): Promise<HostCommand | null> {
  const nowIso = new Date(now).toISOString()
  try {
    const { data } = await db.from('browser_host_commands').select('id,kind,payload,expires_at').eq('host_id', hostId).eq('shop_id', shopId).eq('status', 'queued').gt('expires_at', nowIso).order('created_at', { ascending: true }).limit(1)
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return null
    const claimed = await db.from('browser_host_commands').update({ status: 'sent' }).eq('id', row.id).eq('shop_id', shopId).eq('host_id', hostId).eq('status', 'queued').select('id')
    if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length !== 1) return null
    return { id: String(row.id), kind: row.kind, payload: (row.payload as Record<string, unknown>) || {}, expiresAt: String(row.expires_at) }
  } catch { return null }
}

export interface HostResult { ok: boolean; url?: string; title?: string; text?: string; image?: string; error?: string }

/** What a computer sent back, cleaned and bounded. All of it is page content from a computer: untrusted, like any page. */
export function cleanResult(input: unknown): HostResult | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const image = typeof r.image === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.image) && r.image.length <= 900_000 ? r.image : undefined
  const out: HostResult = { ok: r.ok === true, url: str(r.url, 2048), title: str(r.title, 300), text: str(r.text, 20_000), image, error: str(r.error, 300) }
  return JSON.stringify(out).length > MAX_RESULT_BYTES ? null : out
}

export async function submitResult(db: Db, shopId: string, hostId: string, commandId: string, result: unknown, now = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(commandId)) return false
  const clean = cleanResult(result)
  if (!clean) return false
  try {
    const { data, error } = await db.from('browser_host_commands')
      .update({ status: clean.ok ? 'done' : 'failed', result: clean, done_at: new Date(now).toISOString() })
      .eq('id', commandId).eq('shop_id', shopId).eq('host_id', hostId).eq('status', 'sent').gt('expires_at', new Date(now).toISOString()).select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch { return false }
}

export async function getCommand(db: Db, shopId: string, id: string, now = Date.now()): Promise<{ id: string; status: string; result: HostResult | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    const { data } = await db.from('browser_host_commands').select('id,status,result,expires_at').eq('id', id).eq('shop_id', shopId).maybeSingle()
    if (!data) return null
    const expired = (data.status === 'queued' || data.status === 'sent') && Date.parse(String(data.expires_at)) <= now
    return { id: String(data.id), status: expired ? 'expired' : String(data.status), result: (data.result as HostResult) || null }
  } catch { return null }
}
