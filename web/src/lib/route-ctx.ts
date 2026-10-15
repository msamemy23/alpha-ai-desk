/**
 * The few things every reports, accounting and parts route needs: who is asking, which shop they belong to, what to call them in
 * a history line, and a database client typed for the shared store code. Server only.
 */
import { NextResponse } from 'next/server'
import { getAuthedShop, getSessionUser } from '@/lib/api-auth'
import type { ShopRole } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import type { Db } from '@/lib/db-types'
import { loadShopFacts, todayKeyIn } from '@/lib/report-delivery'

export interface RouteCtx { db: Db; shopId: string; role: ShopRole; userId: string; name: string; email: string }

export const jsonFail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error: message, ...extra }, { status, headers: { 'cache-control': 'no-store' } })

export const jsonOk = (body: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: true, ...body }, { headers: { 'cache-control': 'no-store' } })

const nameFrom = (u: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string => {
  const meta = u?.user_metadata || {}
  const raw = [meta.full_name, meta.name, meta.display_name].find(v => typeof v === 'string' && v.trim())
  if (typeof raw === 'string') return raw.trim().slice(0, 120)
  const local = String(u?.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  return local ? local.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 120) : 'Someone on your team'
}

/** Signed in, with a shop, and (when `allow` is given) in a role that may do this. Otherwise the response to send back. */
export async function routeCtx(allow?: (role: string) => boolean): Promise<{ ok: true; ctx: RouteCtx } | { ok: false; response: NextResponse }> {
  const auth = await getAuthedShop()
  if (!auth) return { ok: false, response: jsonFail(401, 'Please sign in again.') }
  if (allow && !allow(auth.role)) return { ok: false, response: jsonFail(403, 'Your role does not include this. Ask an owner or manager.') }
  const user = await getSessionUser().catch(() => null)
  return {
    ok: true,
    ctx: { db: getServiceClient() as unknown as Db, shopId: auth.shopId, role: auth.role, userId: auth.userId, name: nameFrom(user), email: String(user?.email || '') },
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/** A store function's answer as a response: the failure's own status and plain message, or the success body. */
export function respond(result: { ok: true } | { ok: false; status: number; message: string; needsUpdate?: boolean; fields?: Record<string, string>; conflict?: boolean; duplicate?: unknown }, extra: Record<string, unknown> = {}) {
  if (result.ok) {
    const body = { ...(result as Record<string, unknown>), ...extra }
    delete body.ok
    return jsonOk(body)
  }
  const { status, message, ...rest } = result as { status: number; message: string } & Record<string, unknown>
  delete rest.ok
  return jsonFail(status, message, rest)
}

/** The shop's calendar day today, in the shop's own time zone. */
export async function shopToday(db: Db, shopId: string): Promise<string> {
  const facts = await loadShopFacts(db, shopId)
  return todayKeyIn(facts.timezone, new Date())
}
