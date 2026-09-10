import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

const SAFE_FIELDS = [
  'shop_name', 'shop_address', 'shop_phone', 'shop_email',
  'labor_rate', 'tax_rate', 'warranty_months', 'payment_terms',
  'payment_methods', 'disclaimer', 'techs',
  'ai_model', 'ai_base_url',
  'telnyx_phone_number', 'telnyx_messaging_profile_id',
  'from_email', 'google_review_url', 'timezone', 'automation_config',
  'telnyx_connection_id', 'facebook_page_id', 'fb_ad_account_id',
  'searxng_url', 'webrtc_connection_id', 'webrtc_credential_id',
  'telnyx_outbound_voice_profile_id',
] as const

const SECRET_FIELDS = [
  'ai_api_key',
  'telnyx_api_key',
  'resend_api_key',
  'browserless_token',
  'facebook_page_token',
] as const

const ALL_FIELDS = [...SAFE_FIELDS, ...SECRET_FIELDS] as const

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

function publicSettings(row: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...row }
  for (const key of SECRET_FIELDS) {
    result[key] = ''
    result[key + '_configured'] = typeof row[key] === 'string' && row[key].trim().length > 0
  }
  return result
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('settings')
    .select(ALL_FIELDS.join(','))
    .eq('shop_id', auth.shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return fail('Shop settings could not be loaded', 500)
  return NextResponse.json({ ok: true, settings: data ? publicSettings(data as unknown as Record<string, unknown>) : null })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return fail('Settings must be an object')

  const updates: Record<string, unknown> = {}
  for (const key of SAFE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    const value = body[key]
    if (key === 'automation_config') {
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) return fail('automation_config must be an object or null')
      updates[key] = value
    } else if (key === 'techs') {
      if (value !== null && !Array.isArray(value)) return fail('techs must be an array or null')
      updates[key] = value
    } else if (typeof value === 'string') {
      updates[key] = value.trim().slice(0, key === 'shop_address' || key === 'disclaimer' ? 2000 : 500)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      updates[key] = value
    } else {
      return fail(key + ' has an invalid value')
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_base_url')) {
    try {
      updates.ai_base_url = normalizeAiBaseUrl(body.ai_base_url || AI_BASE_URLS.OPENROUTER)
    } catch {
      return fail('AI base URL is not allowed')
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'ai_model')) {
    try {
      updates.ai_model = normalizeAiModel(body.ai_model, String(updates.ai_base_url || AI_BASE_URLS.OPENROUTER))
    } catch {
      return fail('AI model is not allowed')
    }
  }

  // Blank secret inputs mean “leave the existing credential alone”; the UI
  // never receives raw secrets. Use the explicit sentinel to clear one.
  for (const key of SECRET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    const value = body[key]
    if (value === '__CLEAR__' || value === null) updates[key] = null
    else if (typeof value === 'string' && value.trim()) updates[key] = value.trim()
  }

  const sb = getServiceClient()
  const { data: existing, error: lookupError } = await sb
    .from('settings')
    .select('id')
    .eq('shop_id', auth.shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupError) return fail('Shop settings could not be loaded', 500)

  if (existing?.id) {
    const { error } = await sb
      .from('settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('shop_id', auth.shopId)
    if (error) return fail('Shop settings could not be saved', 500)
  } else {
    const { error } = await sb
      .from('settings')
      .insert({ ...updates, shop_id: auth.shopId, updated_at: new Date().toISOString() })
    if (error) return fail('Shop settings could not be created', 500)
  }

  return NextResponse.json({ ok: true })
}
