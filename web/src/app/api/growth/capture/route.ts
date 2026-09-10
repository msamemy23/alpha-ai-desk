import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

// Leads are shop data — every caller must resolve to one shop.


async function sendFollowUpSMS(phone: string, name: string, shopName: string, shopPhone: string, apiKey: string, fromNumber: string): Promise<{ success: boolean; error?: string }> {
  if (!apiKey || !fromNumber) {
    return { success: false, error: 'Telnyx not configured' }
  }

  const message = `Hi ${name}! Thanks for reaching out to ${shopName}. We'd love to help with your vehicle. Ready to schedule? Call us at ${shopPhone} or reply to this text!`

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: fromNumber,
        to: phone,
        text: message
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { success: false, error: data.errors?.[0]?.detail || `Telnyx returned ${res.status}` }
    return data.data?.id ? { success: true } : { success: false, error: data.errors?.[0]?.detail || 'Telnyx did not return a message id' }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// POST - Capture a walk-in or call lead
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Unable to load shop settings' }, { status: 500 })
    const shopName = String(settings?.shop_name || settings?.company_name || settings?.business_name || 'your shop').slice(0, 120)
    const shopPhone = String(settings?.shop_phone || settings?.phone || settings?.business_phone || '').slice(0, 40)
    const telnyxKey = String(settings?.telnyx_api_key || '')
    const telnyxFrom = String(settings?.telnyx_phone_number || '')
    const { action } = body || {}

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
          .eq('shop_id', auth.shopId)
          .eq('phone', phone)
          .maybeSingle()
        existingLead = data
      }

      if (existingLead) {
        // Update existing lead
        const { error: updateError } = await supabase
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
          .eq('shop_id', auth.shopId)
        if (updateError) throw updateError

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
          shop_id: auth.shopId,
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
        .eq('shop_id', auth.shopId)
        .eq('converted', false)
        .lt('last_contact', oneDayAgo.toISOString())
        .order('last_contact', { ascending: true })

      if (error) throw error

      const results: Array<{ name: string; phone: string; sent: boolean; recorded?: boolean; error?: string }> = []

      for (const lead of pendingLeads || []) {
        if (!lead.phone) continue

        const smsResult = await sendFollowUpSMS(lead.phone, lead.name, shopName, shopPhone, telnyxKey, telnyxFrom)
        
        // Update only after recording whether the attempt succeeded. Keep a failed
        // lead eligible for a later retry instead of silently marking it contacted.
        let recorded = true
        let recordError = ''
        if (smsResult.success) {
          const { error: updateError } = await supabase
            .from('growth_leads')
            .update({
              last_contact: new Date().toISOString(),
              touch_count: (lead.touch_count || 0) + 1
            })
            .eq('id', lead.id)
            .eq('shop_id', auth.shopId)
          if (updateError) {
            recorded = false
            recordError = 'Follow-up sent, but the lead could not be updated for retry protection'
            console.error('Lead follow-up update error:', updateError.message)
          }
        }

        results.push({
          name: lead.name,
          phone: lead.phone,
          sent: smsResult.success,
          recorded,
          error: smsResult.error || recordError || undefined
        })
      }

      const success = results.every(result => result.sent === true && result.recorded !== false)
      return NextResponse.json({
        ok: success,
        success,
        total_pending: (pendingLeads || []).length,
        followed_up: results.filter(r => r.sent).length,
        results
      }, { status: success ? 200 : 502 })
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
