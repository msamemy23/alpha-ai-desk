/**
 * Small helpers shared by the receptionist and inbox API routes: who is asking, may they do this, and one shop-scoped database.
 * Everything a route returns is limited to the signed-in person's own shop.
 */
import { NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import type { AuthenticatedShop } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export type ServiceDb = ReturnType<typeof getServiceClient>

const MANAGERS = new Set(['owner', 'admin', 'manager'])

export function canManage(role: string): boolean { return MANAGERS.has(role) }

/** Signed in, and (when `manage`) allowed to change the shop's setup. Viewers can look but not act. */
export async function authed(opts: { manage?: boolean; write?: boolean } = {}): Promise<{ ok: true; auth: AuthenticatedShop; db: ServiceDb } | { ok: false; res: Response }> {
  const auth = await getAuthedShop()
  if (!auth) return { ok: false, res: unauthorized() }
  if (opts.manage && !canManage(auth.role)) return { ok: false, res: forbidden() }
  if (opts.write && auth.role === 'viewer') return { ok: false, res: forbidden() }
  return { ok: true, auth, db: getServiceClient() }
}

export function fail(error: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

export function ok(data: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: true, ...data })
}

export async function readBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, any>) : null
  } catch {
    return null
  }
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** The shop's settings row. Only the columns asked for are read. */
export async function shopSettings(db: ServiceDb, shopId: string, columns: string): Promise<Record<string, any> | null> {
  const { data, error } = await db.from('settings').select(columns).eq('shop_id', shopId).limit(1).maybeSingle()
  if (error) return null
  return (data as unknown as Record<string, any>) || null
}
