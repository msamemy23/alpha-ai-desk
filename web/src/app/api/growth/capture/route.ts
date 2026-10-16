import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { captureLead } from '@/lib/lead-capture'
import { loadShopInfo } from '@/lib/schedule-store'
import { nowIn } from '@/lib/schedule-capacity'

// Leads are shop data — every caller must resolve to one shop.

// POST - Capture a walk-in or call lead
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    const supabase = getServiceClient()
    const { action } = body || {}

    if (action === 'capture') {
      // Saves into the Leads tab's table and the follow-up automation's table, finds the same person again by phone, and never makes two.
      const info = await loadShopInfo(auth.shopId).catch(() => null)
      const today = info ? nowIn(info.timezone).ymd : undefined
      const r = await captureLead(supabase, auth.shopId, body, new Date(), today)
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json({ lead_id: r.growthId, leads_id: r.leadId, status: r.status, message: r.message })
    }

    if (action === 'follow_up_pending') {
      // Lead follow-ups used to be texted from here every day with no limit. They now run as the "New lead follow-up" automation (a small fixed number of texts, spaced apart, with quiet hours, STOP handling,
      // a preview and a history). This call stays so older schedulers do not break, and it sends nothing.
      return NextResponse.json({ ok: true, success: true, sent: 0, message: 'Lead follow-ups run from Automations now. Nothing was sent from here.' })
    }

    if (action === 'convert') {
      // Mark a lead as converted (they booked/came in)
      const { lead_id } = body

      if (!lead_id) {
        return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
      }

      const { error } = await supabase
        .from('growth_leads')
        .update({
          converted: true,
          needs_followup: false,
          converted_at: new Date().toISOString()
        })
        .eq('id', lead_id)
        .eq('shop_id', auth.shopId)

      if (error) throw error

      return NextResponse.json({ message: 'Lead marked as converted', lead_id })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    console.error('Capture error:', e)
    return NextResponse.json({ error: 'Failed to process capture' }, { status: 500 })
  }
}

// GET - List all leads
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const auth = await getRouteShop(req, searchParams.get('shop_id'))
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const status = searchParams.get('status')
    const source = searchParams.get('source')

    let query = supabase
      .from('growth_leads')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('created_at', { ascending: false })

    if (status === 'pending') {
      query = query.eq('needs_followup', true).eq('converted', false)
    } else if (status === 'converted') {
      query = query.eq('converted', true)
    }

    if (source) {
      query = query.eq('source', source)
    }

    const { data, error } = await query.limit(100)

    if (error) throw error

    const stats = {
      total: (data || []).length,
      new_leads: (data || []).filter((l: { status: string }) => l.status === 'new').length,
      converted: (data || []).filter((l: { converted: boolean }) => l.converted).length,
      pending_followup: (data || []).filter((l: { needs_followup: boolean; converted: boolean }) => l.needs_followup && !l.converted).length
    }

    return NextResponse.json({ leads: data || [], stats })
  } catch (e) {
    console.error('Capture GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 })
  }
}
