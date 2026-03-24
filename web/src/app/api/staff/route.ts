import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Default staff if table is empty
const DEFAULT_STAFF = [
  { name: 'Paul', role: 'technician', emoji: '🔧', active: true },
  { name: 'Devin', role: 'technician', emoji: '🔧', active: true },
  { name: 'Luis', role: 'technician', emoji: '🔧', active: true },
  { name: 'Louie', role: 'technician', emoji: '🔧', active: true },
  { name: 'Masoud', role: 'employee', emoji: '👤', active: true },
  { name: 'Omar', role: 'employee', emoji: '👤', active: true },
  { name: 'Javier', role: 'employee', emoji: '👤', active: true },
]

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const { searchParams } = new URL(req.url)
  const role = searchParams.get('role') // 'technician', 'employee', or null for all

  try {
    let query = sb.from('staff').select('*').eq('active', true).order('name')
    if (role) query = query.eq('role', role)
    const { data, error } = await query

    // If table doesn't exist or is empty, seed defaults
    if (error || !data || data.length === 0) {
      // Try to seed
      try {
        await sb.from('staff').upsert(
          DEFAULT_STAFF.map((s, i) => ({ id: i + 1, ...s, created_at: new Date().toISOString() })),
          { onConflict: 'id' }
        )
        const { data: seeded } = await sb.from('staff').select('*').eq('active', true).order('name')
        return NextResponse.json({ ok: true, staff: seeded || DEFAULT_STAFF })
      } catch {
        // Table doesn't exist yet — return defaults
        return NextResponse.json({ ok: true, staff: DEFAULT_STAFF, fallback: true })
      }
    }

    return NextResponse.json({ ok: true, staff: data })
  } catch {
    return NextResponse.json({ ok: true, staff: DEFAULT_STAFF, fallback: true })
  }
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()
  const { action, id, name, role, emoji, active } = body

  try {
    if (action === 'add') {
      const { data, error } = await sb.from('staff').insert({
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
      const { data, error } = await sb.from('staff').update(updates).eq('id', id).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, staff: data })
    }

    if (action === 'deactivate') {
      await sb.from('staff').update({ active: false }).eq('id', id)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
