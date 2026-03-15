import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+17134001234'

async function sendFollowUpSMS(phone: string, name: string): Promise<{ success: boolean; error?: string }> {
  if (!TELNYX_API_KEY) {
    return { success: false, error: 'Telnyx not configured' }
  }

  const message = `Hi ${name}! Thanks for reaching out to Alpha International Auto Center. We'd love to help with your vehicle. Ready to schedule? Call us at (713) 663-6979 or reply to this text!`

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TELNYX_API_KEY}`
      },
      body: JSON.stringify({
        from: TELNYX_FROM_NUMBER,
        to: phone,
        text: message
      })
    })
    const data = await res.json()
    return data.data?.id ? { success: true } : { success: false, error: data.errors?.[0]?.detail || 'Failed' }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// POST - Capture a walk-in or call lead
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'capture') {
      const { name, phone, email, source, vehicle_info, notes, needs_followup = true } = body

      if (!name && !phone) {
        return NextResponse.json({ error: 'At least name or phone required' }, { status: 400 })
      }

      // Check if this lead already exists
      let existingLead = null
      if (phone) {
        const { data } = await supabase
          .from('growth_leads')
          .select('*')
          .eq('phone', phone)
          .single()
        existingLead = data
      }

      if (existingLead) {
        // Update existing lead
        await supabase
          .from('growth_leads')
          .update({
            name: name || existingLead.name,
            email: email || existingLead.email,
            vehicle_info: vehicle_info || existingLead.vehicle_info,
            notes: existingLead.notes ? `${existingLead.notes}\n---\n${notes || ''}` : notes,
            touch_count: (existingLead.touch_count || 0) + 1,
            last_contact: new Date().toISOString(),
            source: source || existingLead.source
          })
          .eq('id', existingLead.id)

        return NextResponse.json({
          lead_id: existingLead.id,
          status: 'updated',
          message: `Existing lead ${existingLead.name} updated. Contact #${(existingLead.touch_count || 0) + 1}`
        })
      }

      // Create new lead
      const { data: newLead, error } = await supabase
        .from('growth_leads')
        .insert({
          name: name || 'Unknown',
          phone: phone || null,
          email: email || null,
          source: source || 'walk-in',
          vehicle_info: vehicle_info || null,
          notes: notes || null,
          status: 'new',
          needs_followup,
          touch_count: 1,
          last_contact: new Date().toISOString(),
          converted: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) throw error

      return NextResponse.json({
        lead_id: newLead.id,
        status: 'created',
        message: `New lead captured: ${name || 'Unknown'} (${source || 'walk-in'})`
      })
    }

    if (action === 'follow_up_pending') {
      // Get all leads that need follow-up and haven't been contacted in 24h
      const oneDayAgo = new Date()
      oneDayAgo.setDate(oneDayAgo.getDate() - 1)

      const { data: pendingLeads, error } = await supabase
        .from('growth_leads')
        .select('*')
        .eq('needs_followup', true)
        .eq('converted', false)
        .lt('last_contact', oneDayAgo.toISOString())
        .order('last_contact', { ascending: true })

      if (error) throw error

      const results: Array<{ name: string; phone: string; sent: boolean; error?: string }> = []

      for (const lead of pendingLeads || []) {
        if (!lead.phone) continue

        const smsResult = await sendFollowUpSMS(lead.phone, lead.name)
        
        // Update last contact
        await supabase
          .from('growth_leads')
          .update({
            last_contact: new Date().toISOString(),
            touch_count: (lead.touch_count || 0) + 1
          })
          .eq('id', lead.id)

        results.push({
          name: lead.name,
          phone: lead.phone,
          sent: smsResult.success,
          error: smsResult.error
        })
      }

      return NextResponse.json({
        total_pending: (pendingLeads || []).length,
        followed_up: results.filter(r => r.sent).length,
        results
      })
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
    const status = searchParams.get('status')
    const source = searchParams.get('source')

    let query = supabase
      .from('growth_leads')
      .select('*')
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
