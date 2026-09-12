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

  // An active membership is the only authorization source. Profile ownership
  // is no longer accepted as a fallback; see the note below the lookup.
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

  // No active membership means no access. Profile ownership is deliberately
  // NOT a fallback any more: migration 044 bootstrapped a membership for every
  // existing shop and the shop_profiles trigger creates one for every new
  // shop, so a missing row means access was revoked or never granted. Treating
  // shop_profiles.user_id as authorization would let a hard revocation (the
  // row deleted rather than its status flipped) silently regain owner access.
  const { data: profile, error: profileError } = await svc
    .from('shop_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (profileError) {
    console.error('[auth] shop profile lookup failed:', profileError.message)
    return null
  }
  if (profile?.id) {
    console.error(
      `[auth] user ${user.id} owns shop ${profile.id} but has no active membership; denying access`,
    )
  }
  return null
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
