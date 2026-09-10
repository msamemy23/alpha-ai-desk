import { NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SAFE_METADATA_KEYS = ['page_name', 'profile_name', 'account_name', 'location_name', 'instagram_account_id', 'facebook_page_id'] as const

function safeMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return Object.fromEntries(
    SAFE_METADATA_KEYS
      .filter(key => typeof input[key] === 'string')
      .map(key => [key, String(input[key]).slice(0, 300)])
  )
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('connectors')
    .select('id,service,enabled,page_id,metadata,updated_at')
    .eq('shop_id', auth.shopId)
    .order('service', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: 'Connectors could not be loaded' }, { status: 500 })
  const connectors = (data || []).map(row => ({
    id: row.id,
    service: row.service,
    enabled: row.enabled === true,
    page_id: row.page_id || null,
    metadata: safeMetadata(row.metadata),
    updated_at: row.updated_at,
  }))
  return NextResponse.json({ ok: true, connectors })
}
