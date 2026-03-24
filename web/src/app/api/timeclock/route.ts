import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
  
  try {
    const { data } = await sb
      .from('timeclock')
      .select('*')
      .gte('clock_in', date + 'T00:00:00')
      .lte('clock_in', date + 'T23:59:59')
      .order('clock_in', { ascending: false })
    
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
      // Check if already clocked in
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

    if (action === 'status') {
      // Who's currently clocked in?
      const { data } = await sb
        .from('timeclock')
        .select('staff_name, clock_in')
        .is('clock_out', null)
      
      return NextResponse.json({ ok: true, active: data || [] })
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
