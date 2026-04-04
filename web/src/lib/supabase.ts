import { createClient } from '@supabase/supabase-js'

// Fallback URL and key hardcoded so the app works even without Vercel env vars
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
  if (!shopId) return
  const { data: existing } = await supabase
    .from('settings')
    .select('id')
    .eq('shop_id', shopId)
    .limit(1)
    .single()
  if (existing) {
    await supabase.from('settings').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await supabase.from('settings').insert({ ...updates, shop_id: shopId })
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
  await supabase.from('messages').update({ read: true }).eq('id', id)
}

export function formatCurrency(n: number | string) {
  return '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function calcTotals(doc: Record<string, unknown>) {
  const parts = (doc.parts as Record<string,unknown>[]) || []
  const labors = (doc.labors as Record<string,unknown>[]) || []
  const taxRate = Number(doc.tax_rate) || 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const sublet = Number(doc.sublet) || 0
  const deposit = Number(doc.deposit) || 0
  const applyTax = doc.apply_tax !== false

  const laborTotal = labors.reduce((s, l) => s + (Number(l.hours)||0) * (Number(l.rate)||0), 0)
  const partsTotal = parts.reduce((s, p) => s + (Number(p.qty)||1) * (Number(p.unitPrice)||0), 0)
  const taxableBase = applyTax ? parts.filter(p => p.taxable !== false).reduce((s,p) => s + (Number(p.qty)||1)*(Number(p.unitPrice)||0), 0) + shopSupplies + sublet : 0
  const taxAmount = taxableBase * (taxRate / 100)
  const subtotal = laborTotal + partsTotal + shopSupplies + sublet
  const total = subtotal + taxAmount
  const balanceDue = Math.max(total - deposit, 0)
  return { laborTotal, partsTotal, taxAmount, subtotal, total, balanceDue, deposit }
}
