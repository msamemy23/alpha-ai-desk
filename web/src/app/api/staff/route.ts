import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { searchParams } = new URL(req.url)
  const role = searchParams.get('role') // 'technician', 'employee', or null for all

  try {
    let query = sb.from('staff').select('*').eq('shop_id', auth.shopId).eq('active', true).order('name')
    if (role) query = query.eq('role', role)
    const { data, error } = await query

    // A shop with no staff yet gets an empty list. Never show another shop's people.
    if (error || !data) return NextResponse.json({ ok: true, staff: [], fallback: true })

    return NextResponse.json({ ok: true, staff: data })
  } catch {
    return NextResponse.json({ ok: true, staff: [], fallback: true })
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const body = await req.json()
  const { action, id, name, role, emoji, active } = body

  try {
    if (action === 'add') {
      const { data, error } = await sb.from('staff').insert({
        shop_id: auth.shopId,
        name, role: role || 'technician', emoji: emoji || '🔧', active: true,
        created_at: new Date().toISOString()
      }).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, staff: data })
    }

    if (action === 'update') {
      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates.name = name
      if (role !== undefined) updates.role = role
      if (emoji !== undefined) updates.emoji = emoji
      if (active !== undefined) updates.active = active
      const { data, error } = await sb.from('staff').update(updates).eq('id', id).eq('shop_id', auth.shopId).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, staff: data })
    }

    if (action === 'deactivate') {
      await sb.from('staff').update({ active: false }).eq('id', id).eq('shop_id', auth.shopId)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
