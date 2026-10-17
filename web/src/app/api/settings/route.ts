import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { PHONE_COLUMNS } from '@/lib/text-channel'
import { phoneUpdates, touchesPhone, wantsPhone } from '@/lib/phone-settings'

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

// Texting through the owner's own phone (migration 063). Kept apart from the lists above on purpose: a database that has not had the
// migration yet does not have these columns, and asking for a missing column would break loading and saving every other setting.
const PHONE_SECRET_FIELDS = ['phone_gateway_key'] as const

const ALL_FIELDS = [...SAFE_FIELDS, ...SECRET_FIELDS] as const
const PHONE_FIELDS = PHONE_COLUMNS

/** Postgres says 42703 for a column that does not exist; PostgREST says PGRST204 or "does not exist" for the same. */
function missingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || '')
}

const PHONE_UPDATE_NEEDED = 'Texting through your own phone needs a database update first (migration 063). Nothing was saved.'

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

function publicSettings(row: Record<string, unknown>, extra: { shopId: string; phoneReady: boolean }) {
  const result: Record<string, unknown> = { ...row }
  // The phone key is masked like the others, but only when the columns exist; otherwise a screen would send it back blank on every save.
  for (const key of [...SECRET_FIELDS, ...(extra.phoneReady ? PHONE_SECRET_FIELDS : [])]) {
    result[key] = ''
    result[key + '_configured'] = typeof row[key] === 'string' && row[key].trim().length > 0
  }
  // The incoming-text address carries the shop id and this code. The code only lets someone post texts into this shop's inbox,
  // and only the signed-in owner of the shop is sent it.
  result.shop_id = extra.shopId
  result.phone_columns_ready = extra.phoneReady
  return result
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const load = (fields: readonly string[]) => sb
    .from('settings')
    .select(fields.join(','))
    .eq('shop_id', auth.shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let phoneReady = true
  let { data, error } = await load([...ALL_FIELDS, ...PHONE_FIELDS])
  if (missingColumn(error)) {
    // Migration 063 has not run: load everything else exactly as before and say the phone choice is not available yet.
    phoneReady = false
    ;({ data, error } = await load(ALL_FIELDS))
  }

  if (error) return fail('Shop settings could not be loaded', 500)
  return NextResponse.json({ ok: true, settings: data ? publicSettings(data as unknown as Record<string, unknown>, { shopId: auth.shopId, phoneReady }) : null })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return fail('Settings must be an object')

  const updates: Record<string, unknown> = {}
  let rotatedSecret = ''
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

  // The phone choice. Every value is checked in phone-settings.ts, whatever the screen sent.
  if (touchesPhone(body)) {
    const current = await getServiceClient().from('settings').select(PHONE_FIELDS.join(',')).eq('shop_id', auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (missingColumn(current.error)) {
      // Migration 063 has not run. Blank phone fields riding along with an ordinary save are ignored, so nothing else is held up;
      // asking for the phone itself is refused with a plain sentence.
      if (wantsPhone(body)) return fail(PHONE_UPDATE_NEEDED, 409)
    } else {
      if (current.error) return fail('Shop settings could not be loaded', 500)
      const phone = phoneUpdates(body, (current.data || {}) as unknown as Record<string, unknown>)
      if (!phone.ok) return fail(phone.error)
      Object.assign(updates, phone.updates)
      rotatedSecret = phone.rotatedSecret
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
    if (missingColumn(error)) return fail(PHONE_UPDATE_NEEDED, 409)
    if (error) return fail('Shop settings could not be saved', 500)
  } else {
    const { error } = await sb
      .from('settings')
      .insert({ ...updates, shop_id: auth.shopId, updated_at: new Date().toISOString() })
    if (missingColumn(error)) return fail(PHONE_UPDATE_NEEDED, 409)
    if (error) return fail('Shop settings could not be created', 500)
  }

  return NextResponse.json({ ok: true, ...(rotatedSecret ? { phone_gateway_secret: rotatedSecret } : {}) })
}
