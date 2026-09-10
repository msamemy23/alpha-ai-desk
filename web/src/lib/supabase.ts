import { createClient } from '@supabase/supabase-js'
import { laborLineTotal, partLineTotal } from '@/lib/document-money'
import { createBrowserClient } from '@supabase/ssr'

// Publishable URL + anon key (safe to ship to the browser; access is governed
// by RLS, not by hiding this key). Env only — values are inlined at build time
// from Vercel env / .env.local; no hardcoded fallbacks.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const supabaseBrowserUrl = supabaseUrl
export const supabaseBrowserAnonKey = supabaseAnonKey
export const supabaseAuthStorageKey = supabaseUrl
  ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  : 'sb-auth-token'

// Browser client that stores the auth session in COOKIES (not localStorage) so
// the server (middleware + API routes) can read and verify the real session.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
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

export async function getShopProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('shop_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
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
  const { data } = await supabase
    .from('shop_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  return data?.id ?? null
}

export async function getSettings() {
  const shopId = await getShopId()
  if (!shopId) return null
  const { data } = await supabase
    .from('settings')
    .select('*')
    .eq('shop_id', shopId)
    .limit(1)
    .single()
  return data
}

export async function updateSettings(updates: Record<string, unknown>) {
  const shopId = await getShopId()
  if (!shopId) return { error: new Error('No shop is associated with the signed-in user') }

  // Keep the browser helper from sending UI-only or legacy fields to PostgREST.
  // The server/database remains the authority for tenant ownership.
  const allowed = new Set([
    'shop_name', 'shop_address', 'shop_phone', 'shop_email',
    'labor_rate', 'tax_rate', 'warranty_months', 'payment_terms',
    'payment_methods', 'disclaimer', 'techs',
    'ai_api_key', 'ai_model', 'ai_base_url',
    'telnyx_api_key', 'telnyx_phone_number', 'telnyx_messaging_profile_id',
    'telnyx_connection_id',
    'resend_api_key', 'from_email',
    'browserless_token',
    'google_review_url', 'timezone', 'automation_config',
    'facebook_page_id', 'facebook_page_token', 'fb_ad_account_id', 'searxng_url',
  ])
  const payload = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => allowed.has(key) && value !== undefined)
  )

  const existingResult = await supabase
    .from('settings')
    .select('id')
    .eq('shop_id', shopId)
    .limit(1)
    .maybeSingle()
  if (existingResult.error) return { error: existingResult.error }

  if (existingResult.data) {
    const result = await supabase
      .from('settings')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existingResult.data.id)
      .eq('shop_id', shopId)
    return { error: result.error || null }
  }

  const result = await supabase.from('settings').insert({ ...payload, shop_id: shopId })
  return { error: result.error || null }
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
  const parts = (doc.parts as Record<string,unknown>[]) || []
  const labors = (doc.labors as Record<string,unknown>[]) || []
  const rawTaxRate = Number(doc.tax_rate)
  const taxRate = Number.isFinite(rawTaxRate) && rawTaxRate >= 0 ? rawTaxRate : 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const sublet = Number(doc.sublet) || 0
  const deposit = Number(doc.deposit) || 0
  const rawAmountPaid = Number(doc.amount_paid)
  // amount_paid is the authoritative cash ledger. A deposit is a core charge,
  // not a payment, so it must never silently make an invoice appear paid.
  const amountPaid = Number.isFinite(rawAmountPaid) && rawAmountPaid >= 0 ? rawAmountPaid : 0
  const applyTax = doc.apply_tax !== false

  const laborTotal = labors.reduce((s, l) => s + laborLineTotal(l), 0)
  const partsTotal = parts.reduce((s, p) => s + partLineTotal(p), 0)
  // Core charges: a refundable deposit on the old unit (alternators, batteries,
  // calipers…). The customer pays it now and gets it back when the core is returned.
  const coreTotal = parts.reduce((s, p) => s + (Number(p.qty)||1) * (Number(p.core)||0), 0)
  const taxableBase = applyTax ? parts.filter(p => p.taxable !== false).reduce((s,p) => s + (Number(p.qty)||1)*(Number(p.unitPrice)||0), 0) + shopSupplies + sublet : 0
  const taxAmount = taxableBase * (taxRate / 100)
  const subtotal = laborTotal + partsTotal + shopSupplies + sublet + coreTotal
  const total = subtotal + taxAmount
  const balanceDue = Math.max(total - amountPaid, 0)
  return { laborTotal, partsTotal, coreTotal, taxAmount, subtotal, total, balanceDue, deposit, amountPaid }
}
