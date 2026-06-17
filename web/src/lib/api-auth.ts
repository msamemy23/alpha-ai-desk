import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getServiceClient } from '@/lib/supabase'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'

/**
 * Reads and validates the Supabase auth session from the request cookies.
 * Returns the authenticated user, or null when there is no valid session.
 * Use inside API route handlers (App Router).
 */
export async function getSessionUser() {
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
export async function getAuthedShop(): Promise<{ userId: string; shopId: string } | null> {
  const user = await getSessionUser()
  if (!user) return null
  const svc = getServiceClient()
  const { data } = await svc
    .from('shop_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!data) return null
  return { userId: user.id, shopId: data.id as string }
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
