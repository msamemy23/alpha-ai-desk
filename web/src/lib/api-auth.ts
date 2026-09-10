import { cookies, headers } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { getServiceClient } from '@/lib/supabase'

// Fail closed: no hardcoded fallbacks. Missing env → no session → 401.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Reads and validates the Supabase auth session from the request cookies.
 * Returns the authenticated user, or null when there is no valid session.
 * Use inside API route handlers (App Router).
 */
export async function getSessionUser() {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization') || ''
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (bearerToken) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })
    const { data: { user } } = await supabase.auth.getUser(bearerToken)
    if (user) return user
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Route handlers don't refresh the session cookie here; reads only.
      setAll: () => {},
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/**
 * Returns { userId, shopId } for the authenticated caller, or null if there is
 * no valid session or the user has no shop profile. Call this at the top of
 * every data API route and scope all queries by the returned shopId.
 */
export type ShopRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'service'

export type AuthenticatedShop = {
  userId: string
  shopId: string
  role: ShopRole
}

export async function getAuthedShop(): Promise<AuthenticatedShop | null> {
  const user = await getSessionUser()
  if (!user) return null
  const svc = getServiceClient()

  // Membership is the authorization source of truth. Profile ownership is
  // retained only as a legacy fallback for rows created before memberships
  // were bootstrapped.
  const { data: membership, error: membershipError } = await svc
    .from('shop_memberships')
    .select('shop_id,role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (membershipError) {
    console.error('[auth] membership lookup failed:', membershipError.message)
    return null
  }
  if (membership?.shop_id) {
    const role = String(membership.role || 'member') as ShopRole
    return { userId: user.id, shopId: String(membership.shop_id), role }
  }

  const { data, error: profileError } = await svc
    .from('shop_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (profileError) {
    console.error('[auth] shop profile lookup failed:', profileError.message)
    return null
  }
  if (!data) return null
  const { data: membershipRecord, error: membershipRecordError } = await svc
    .from('shop_memberships')
    .select('status')
    .eq('shop_id', data.id)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (membershipRecordError) {
    console.error('[auth] membership status lookup failed:', membershipRecordError.message)
    return null
  }
  // A revoked/suspended membership must not regain access through the
  // legacy profile-ownership fallback.
  if (membershipRecord && membershipRecord.status !== 'active') return null
  return { userId: user.id, shopId: data.id as string, role: 'owner' }
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

export function forbidden() {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}


/**
 * Allows only trusted server-to-server jobs to act across shops.
 * Never accept a shop id from an untrusted caller; callers must present the
 * exact deployment secret and routes still validate the requested shop.
 */
export function hasInternalApiSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
}


/**
 * Resolves a route's tenant. A browser session wins; a server job must provide
 * the deployment secret and an existing shop id in its JSON body.
 */
export async function getRouteShop(req: Request, requestedShopId?: unknown): Promise<AuthenticatedShop | null> {
  const sessionAuth = await getAuthedShop()
  if (sessionAuth) return sessionAuth
  if (!hasInternalApiSecret(req) || typeof requestedShopId !== 'string' || !requestedShopId) return null
  const { data } = await getServiceClient()
    .from('shop_profiles')
    .select('id,user_id')
    .eq('id', requestedShopId)
    .maybeSingle()
  if (!data) return null
  return { userId: String(data.user_id), shopId: String(data.id), role: 'service' }
}
