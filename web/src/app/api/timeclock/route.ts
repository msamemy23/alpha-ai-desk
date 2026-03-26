import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const { searchParams } = new URL(req.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

  try {
    let query = sb.from('timeclock').select('*').order('clock_in', { ascending: true })

    if (startDate && endDate) {
      query = query
        .gte('clock_in', startDate + 'T00:00:00')
        .lte('clock_in', endDate + 'T23:59:59')
    } else {
      query = query
        .gte('clock_in', date + 'T00:00:00')
        .lte('clock_in', date + 'T23:59:59')
    }

    const { data } = await query
    return NextResponse.json({ ok: true, entries: data || [] })
  } catch {
    return NextResponse.json({ ok: true, entries: [] })
  }
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()
  const { action, staff_name, staff_id, note } = body

  try {
    if (action === 'clock_in') {
      const { data: existing } = await sb
        .from('timeclock')
        .select('id')
        .eq('staff_name', staff_name)
        .is('clock_out', null)
        .limit(1)

      if (existing && existing.length > 0) {
        return NextResponse.json({ ok: false, error: 'Already clocked in' })
      }

      const { data, error } = await sb.from('timeclock').insert({
        staff_name,
        staff_id: staff_id || null,
        clock_in: new Date().toISOString(),
        clock_out: null,
        note: note || null,
      }).select().single()

      if (error) throw error
      return NextResponse.json({ ok: true, entry: data })
    }

    if (action === 'clock_out') {
      const { data: open } = await sb
        .from('timeclock')
        .select('id, clock_in')
        .eq('staff_name', staff_name)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .single()

      if (!open) return NextResponse.json({ ok: false, error: 'Not clocked in' })

      const clockOut = new Date().toISOString()
      const hours = (new Date(clockOut).getTime() - new Date(open.clock_in).getTime()) / 3600000

      const { data, error } = await sb.from('timeclock').update({
        clock_out: clockOut,
        hours_worked: Math.round(hours * 100) / 100,
      }).eq('id', open.id).select().single()

      if (error) throw error
      return NextResponse.json({ ok: true, entry: data, hours_worked: hours })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
