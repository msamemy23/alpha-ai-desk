import { createClient } from '@supabase/supabase-js'
import { calculateDocumentTotals } from '@/lib/document-money'
import { createBrowserClient } from '@supabase/ssr'

// Publishable URL + anon key (safe to ship to the browser; access is governed
// by RLS, not by hiding this key). Env only — values are inlined at build time
// from Vercel env / .env.local; no hardcoded fallbacks.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Next evaluates route modules during a production build, before deployment
// environment variables are necessarily present. The SSR client rejects empty
// configuration at module load, which turned a missing build-time environment
// into a hard build crash. Keep the placeholder unreachable for real requests:
// API helpers still fail closed when the required server variables are absent.
const browserClientUrl = supabaseUrl || 'https://placeholder.invalid'
const browserClientKey = supabaseAnonKey || 'placeholder-anon-key'
export const supabaseBrowserUrl = supabaseUrl
export const supabaseBrowserAnonKey = supabaseAnonKey
export const supabaseAuthStorageKey = supabaseUrl
  ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  : 'sb-auth-token'

// Browser client that stores the auth session in COOKIES (not localStorage) so
// the server (middleware + API routes) can read and verify the real session.
export const supabase = createBrowserClient(browserClientUrl, browserClientKey, {
  realtime: { params: { eventsPerSecond: 10 } }
})

// Server-side client with service role (for API routes)
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─── DB Helpers ────────────────────────────────────────────────

export async function ensureShopProfile(shopName: string) {
  const { data, error } = await supabase.rpc('ensure_shop_profile', { p_shop_name: shopName })
  if (error) throw error
  if (!data?.id) throw new Error('Your shop could not be initialized.')
  return data as { id: string; created: boolean }
}

export async function getShopProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership, error: membershipError } = await supabase
    .from('shop_memberships')
    .select('shop_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (membershipError || !membership?.shop_id) return null
  const { data } = await supabase.from('shop_profiles').select('*').eq('id', membership.shop_id).maybeSingle()
  return data as {
    id: string
    user_id: string
    shop_name: string
    phone: string
    address: string
    city_state_zip: string
    services: string[]
    created_at: string
  } | null
}

// Returns the current user's shop_profiles.id for filtering data tables.
export async function getShopId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership, error } = await supabase
    .from('shop_memberships')
    .select('shop_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return error ? null : membership?.shop_id ?? null
}

export async function getSettings() {
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) return null
    return data.settings || null
  } catch {
    return null
  }
}

export async function updateSettings(updates: Record<string, unknown>) {
  const allowed = new Set([
    'shop_name', 'shop_address', 'shop_phone', 'shop_email',
    'labor_rate', 'tax_rate', 'warranty_months', 'payment_terms',
    'payment_methods', 'disclaimer', 'techs',
    'ai_api_key', 'ai_model', 'ai_base_url',
    'telnyx_api_key', 'telnyx_phone_number', 'telnyx_messaging_profile_id',
    'telnyx_connection_id', 'telnyx_outbound_voice_profile_id',
    'resend_api_key', 'from_email',
    'browserless_token',
    'google_review_url', 'timezone', 'automation_config',
    'facebook_page_id', 'facebook_page_token', 'fb_ad_account_id', 'searxng_url',
  ])
  const payload = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => allowed.has(key) && value !== undefined)
  )
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      return { error: new Error(data.error || 'Settings could not be saved') }
    }
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error('Settings could not be saved') }
  }
}

export async function getCustomers() {
  const shopId = await getShopId()
  if (!shopId) return []
  const { data } = await supabase
    .from('customers')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
  return data || []
}

export async function getJobs(filter?: { status?: string }) {
  const shopId = await getShopId()
  if (!shopId) return []
  let q = supabase
    .from('jobs')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
  if (filter?.status) q = q.eq('status', filter.status)
  const { data } = await q
  return data || []
}

export async function getDocuments(type?: string) {
  const shopId = await getShopId()
  if (!shopId) return []
  let q = supabase
    .from('documents')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
  if (type) q = q.eq('type', type)
  const { data } = await q
  return data || []
}

export async function getMessages(limit = 100) {
  const shopId = await getShopId()
  if (!shopId) return []
  const { data } = await supabase
    .from('messages')
    .select('*, customer:customers(name,phone,email)')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

export async function getUnreadCount() {
  const shopId = await getShopId()
  if (!shopId) return 0
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .eq('read', false)
    .eq('direction', 'inbound')
  return count || 0
}

export async function markMessageRead(id: string) {
  const shopId = await getShopId()
  if (!shopId) return { error: new Error('No shop is associated with the signed-in user') }
  const { error } = await supabase.from('messages').update({ read: true }).eq('id', id).eq('shop_id', shopId)
  return { error: error || null }
}

export function formatCurrency(n: number | string) {
  return '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function calcTotals(doc: Record<string, unknown>) {
  // amount_paid is the authoritative payment ledger. A deposit is a core
  // charge, not a payment, so it must never silently reduce the balance.
  return calculateDocumentTotals(doc)
}
