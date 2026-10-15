/**
 * What every /api/browser route does first: check the person is signed in to a shop, check what their role allows, check the
 * request came from our own pages, apply rate limits, and load the shop's browsing rules. Also the audit trail.
 *
 * Server only.
 */
import { getAuthedShop, getRouteShop } from '@/lib/api-auth'
import type { AuthenticatedShop } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'
import { LIMITS, collectOwnHosts, sameOriginRequest } from './guard.ts'
import { DEFAULT_SETTINGS } from './policy.ts'
import type { PolicyContext } from './policy.ts'
import { listBookmarks, listRules, loadSettings } from './store.ts'
import type { Bookmark, Db, StoredRule } from './store.ts'
import { displayHost, hostMatches, redactUrlForLog } from './url.ts'

export type Need = 'browse' | 'act' | 'manage'
export type Scope = 'read' | 'search' | 'image' | 'live' | 'agent' | 'download' | 'write' | 'host'

export interface BrowserCaller {
  auth: AuthenticatedShop
  db: Db
  canAct: boolean
  canManage: boolean
}

export const NO_STORE = { 'Cache-Control': 'no-store' }

export function reply(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...headers } })
}

export function problem(error: string, status: number, extra: Record<string, unknown> = {}): Response {
  return reply({ ok: false, error, ...extra }, status)
}

/** Read a small JSON body. Anything bigger than the limit, or not JSON, is null. */
export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  try {
    const declared = Number(req.headers.get('content-length') || 0)
    if (declared > maxBytes) return null
    const text = await req.text()
    if (text.length > maxBytes) return null
    return JSON.parse(text)
  } catch { return null }
}

export interface OpenOptions {
  scope: Scope
  need: Need
  /** A request that changes something: must come from one of our own pages. */
  write?: boolean
  /** Stricter still: the request must say where it came from (every browser tab does). Used for approvals. */
  strictOrigin?: boolean
  /** Let a trusted server job act for a shop (used by the older automation route). */
  allowService?: boolean
  body?: { shopId?: unknown } | null
}

export async function openRoute(req: Request, opts: OpenOptions): Promise<{ ok: true; caller: BrowserCaller } | { ok: false; response: Response }> {
  if ((opts.write || opts.strictOrigin) && !sameOriginRequest(req.headers, req.url)) return { ok: false, response: problem('That request did not come from this site.', 403) }
  if (opts.strictOrigin && !req.headers.get('origin')) return { ok: false, response: problem('That request did not come from this site.', 403) }
  const auth = opts.allowService ? await getRouteShop(req, opts.body?.shopId) : await getAuthedShop()
  if (!auth) return { ok: false, response: problem('Sign in to use the browser.', 401) }
  const canManage = ['owner', 'admin', 'manager'].includes(auth.role)
  const canAct = canManage || auth.role === 'member' || (opts.allowService === true && auth.role === 'service')
  if (opts.need === 'manage' && !canManage) return { ok: false, response: problem('Only an owner, admin or manager can change the browser settings.', 403) }
  if (opts.need === 'act' && !canAct) return { ok: false, response: problem('Your role can look at pages but not fill in or send anything.', 403) }
  const lim = LIMITS[opts.scope === 'host' ? 'host' : opts.scope]
  const hit = checkRateLimit(rateLimitKey(`browser:${opts.scope}`, auth.userId, auth.shopId), lim.limit, lim.windowMs)
  if (!hit.ok) {
    const wait = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000))
    return { ok: false, response: problem('You are going a little fast. Wait a moment and try again.', 429, { retryAfter: wait }) }
  }
  return { ok: true, caller: { auth, db: getServiceClient() as unknown as Db, canAct, canManage } }
}

/* ---------- the shop's rules ---------- */

export interface ShopRules {
  ctx: PolicyContext
  rules: StoredRule[]
  bookmarks: Bookmark[]
  missing: { settings: boolean; rules: boolean; bookmarks: boolean }
}

const cache = new Map<string, { at: number; value: ShopRules }>()
const CACHE_MS = 15_000

export function forgetShopRules(shopId: string) { cache.delete(shopId) }

export async function loadShopRules(caller: BrowserCaller, req: Request, opts: { fresh?: boolean } = {}): Promise<ShopRules> {
  const own = collectOwnHosts(process.env, req.headers.get('x-forwarded-host') || req.headers.get('host'))
  const hit = cache.get(caller.auth.shopId)
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_MS) return { ...hit.value, ctx: { ...hit.value.ctx, ownHosts: own } }
  const [settings, rules, marks] = await Promise.all([
    loadSettings(caller.db, caller.auth.shopId), listRules(caller.db, caller.auth.shopId), listBookmarks(caller.db, caller.auth.shopId),
  ])
  const quickHosts = marks.items.filter(b => b.kind === 'quick').map(b => { try { return new URL(b.url).hostname } catch { return '' } }).filter(Boolean)
  const value: ShopRules = {
    ctx: { settings: settings.settings ?? DEFAULT_SETTINGS, rules: rules.rules, quickHosts, ownHosts: own },
    rules: rules.rules, bookmarks: marks.items,
    missing: { settings: settings.missing, rules: rules.missing, bookmarks: marks.missing },
  }
  cache.set(caller.auth.shopId, { at: Date.now(), value })
  return value
}

/** Is this site one of the shop's quick sites? Used to decide whether the AI may open it without asking. */
export function isQuickSite(rules: ShopRules, url: string): boolean {
  try { const host = new URL(url).hostname; return rules.ctx.quickHosts.some(q => hostMatches(host, q)) } catch { return false }
}

/* ---------- audit trail and daily caps ---------- */

export type BrowserAudit =
  | 'browser.visit' | 'browser.read' | 'browser.search' | 'browser.fill' | 'browser.click' | 'browser.approval_asked'
  | 'browser.approval_decided' | 'browser.sent' | 'browser.download' | 'browser.blocked' | 'browser.handoff' | 'browser.settings'
  | 'browser.rule' | 'browser.bookmark' | 'browser.ai_step' | 'browser.host'

export interface AuditFields {
  url?: string
  actor?: 'user' | 'ai'
  detail?: string
  approvalId?: string
  meta?: Record<string, unknown>
}

/** One line in the shop's audit log. Addresses are stored without secrets, and typed values are never stored here. */
export async function auditShop(shopId: string, userId: string | undefined, action: BrowserAudit, fields: AuditFields = {}): Promise<void> {
  try {
    await writeAuditLog({
      shopId, userId, action, targetType: 'browser', targetId: fields.approvalId,
      approved: action === 'browser.sent' || action === 'browser.download' || undefined,
      metadata: {
        actor: fields.actor || 'user', host: fields.url ? displayHost(fields.url) : undefined, url: fields.url ? redactUrlForLog(fields.url) : undefined,
        detail: fields.detail ? String(fields.detail).slice(0, 300) : undefined, ...fields.meta,
      },
    })
  } catch { /* an audit hiccup must never break browsing, but it is logged by writeAuditLog */ }
}

export function audit(caller: BrowserCaller, action: BrowserAudit, fields: AuditFields = {}): Promise<void> {
  return auditShop(caller.auth.shopId, caller.auth.userId, action, fields)
}

/** How many times this has been logged for the shop in the last day. A failed count is treated as zero. */
export async function usedToday(caller: BrowserCaller, actions: BrowserAudit[]): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { count } = await caller.db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('shop_id', caller.auth.shopId).in('action', actions).gte('created_at', since)
    return typeof count === 'number' ? count : 0
  } catch { return 0 }
}
