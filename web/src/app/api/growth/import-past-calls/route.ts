import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min for large imports


// Fetch all call legs from Telnyx
async function fetchAllCalls(apiKey: string, targetNumber: string): Promise<any[]> {
  let allCalls: any[] = []
  let pageNumber = 1
  const pageSize = 250
  let hasMore = true

  while (hasMore) {
    const params = new URLSearchParams({
      'page[size]': String(pageSize),
      'page[number]': String(pageNumber),
      'filter[to]': targetNumber,
      'filter[direction]': 'incoming',
    })
    const res = await fetch(`https://api.telnyx.com/v2/call_events?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      // Try alternative: use CDRs (Call Detail Records)
      break
    }
    const data = await res.json()
    const records = data.data || []
    allCalls.push(...records)
    hasMore = records.length === pageSize
    pageNumber++
    if (pageNumber > 50) break // safety
  }
  return allCalls
}

// Fetch all recordings from Telnyx
async function fetchAllRecordings(apiKey: string): Promise<any[]> {
  let allRecordings: any[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const params = new URLSearchParams({ 'page[size]': '250' })
    if (cursor) params.set('page[after]', cursor)

    const res = await fetch(`https://api.telnyx.com/v2/recordings?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Telnyx API error: ${res.status}`)
    const data = await res.json()
    const recs = data.data || []
    allRecordings.push(...recs)
    cursor = data.meta?.cursors?.after || null
    pages++
  } while (cursor && pages < 20)

  return allRecordings
}

// Get transcript from recording using AI
async function getTranscriptSummary(recordingUrl: string, aiKey: string, aiBase: string, aiModel: string): Promise<string> {
  if (!aiKey) return 'No AI key configured for transcript'
  try {
    const res = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: 'You are extracting key info from auto shop call transcripts. Extract: customer name, vehicle info, service needed, and any notes. Return as JSON: {"name":"...","vehicle":"...","service":"...","notes":"..."}' },
          { role: 'user', content: `Analyze this auto shop call recording and extract customer details. Recording URL: ${recordingUrl}` }
        ],
        max_tokens: 500,
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch {
    return ''
  }
}

// Extract phone from Telnyx format
function cleanPhone(phone: string): string {
  if (!phone) return ''
  return phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const { data: settings, error: settingsError } = await supabase.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Unable to load shop settings' }, { status: 500 })
    const telnyxKey = String(settings?.telnyx_api_key || '')
    const targetNumber = String(settings?.telnyx_phone_number || '')
    const inboundConnection = String(settings?.telnyx_connection_id || '')
    if (!telnyxKey || !targetNumber) {
      return NextResponse.json({ error: 'Telnyx is not configured for this shop' }, { status: 400 })
    }

    // Fetch all recordings (these have from/to numbers)
    const recordings = await fetchAllRecordings(telnyxKey)

    // Filter to inbound recordings on our connection
    const inbound = recordings.filter((rec: any) =>
      rec.connection_id === inboundConnection ||
      rec.to === targetNumber ||
      rec.to === targetNumber.replace(/\D/g, '') ||
      rec.to === targetNumber.replace(/^\+?/, '+')
    )

    // Deduplicate by from_number (caller)
    const callerMap: Record<string, any> = {}
    for (const rec of inbound) {
      const from = cleanPhone(rec.from || rec.caller_id_number || '')
      if (!from || from === targetNumber || from === targetNumber.replace(/^\+?/, '+')) continue

      const existing = callerMap[from]
      if (!existing || new Date(rec.recording_started_at) > new Date(existing.recording_started_at)) {
        callerMap[from] = rec
      }
    }

    const uniqueCallers = Object.entries(callerMap)
    let imported = 0
    let skipped = 0
    let errors = 0

    for (const [phone, rec] of uniqueCallers) {
      try {
        // Check if lead already exists
        const { data: existing } = await supabase
          .from('growth_leads')
          .select('id')
          .eq('shop_id', auth.shopId)
          .eq('phone', phone)
          .maybeSingle()

        if (existing) {
          skipped++
          continue
        }

        // Also check the leads table
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id')
          .eq('shop_id', auth.shopId)
          .eq('phone', phone)
          .maybeSingle()

        if (existingLead) {
          skipped++
          continue
        }

        // Try to get caller info from ai_calls table
        const { data: aiCall } = await supabase
          .from('ai_calls')
          .select('*')
          .eq('shop_id', auth.shopId)
          .or(`from_number.eq.${phone},caller_id.eq.${phone}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const { data: historyCall } = await supabase
          .from('call_history')
          .select('matched_customer_name')
          .eq('shop_id', auth.shopId)
          .eq('from_number', phone)
          .not('matched_customer_name', 'is', null)
          .order('start_time', { ascending: false })
          .limit(1)
          .single()

        const historyName = historyCall?.matched_customer_name
        const isPhoneNumber = !!historyName && /^\+?[0-9]+$/.test(historyName)
        const callerName = aiCall?.customer_name || aiCall?.caller_name || (!isPhoneNumber && historyName) || 'Past Caller'
        const vehicle = aiCall?.vehicle_info || ''
        const service = aiCall?.service_needed || aiCall?.reason || ''
        const callDate = rec.recording_started_at || rec.created_at

        // Insert into growth_leads
        const { error: growthLeadError } = await supabase.from('growth_leads').insert({
          shop_id: auth.shopId,
          name: callerName,
          phone: phone,
          source: 'past-call',
          vehicle_info: vehicle || null,
          notes: `Imported from Telnyx call history. Call date: ${callDate ? new Date(callDate).toLocaleDateString() : 'unknown'}. ${service ? `Service: ${service}` : ''}`,
          status: 'new',
          needs_followup: true,
          touch_count: 1,
          last_contact: callDate || new Date().toISOString(),
          converted: false,
          created_at: new Date().toISOString()
        })
        if (growthLeadError) throw growthLeadError

        // Also insert into leads table for the Growth page
        const { error: leadError } = await supabase.from('leads').insert({
          shop_id: auth.shopId,
          name: callerName,
          phone: phone,
          service_needed: service || 'Previous caller - follow up',
          source: 'past-call',
          notes: `Auto-imported from Telnyx. Called on ${callDate ? new Date(callDate).toLocaleDateString() : 'unknown'}`,
          status: 'new',
          follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          created_at: new Date().toISOString()
        })
        if (leadError) throw leadError

        imported++
      } catch (e) {
        errors++
        console.error(`Failed to import caller ${phone}:`, e)
      }
    }

    // Log the import
    const { error: scanError } = await supabase.from('growth_scans').upsert({
      id: `${auth.shopId}:past_call_import`,
      shop_id: auth.shopId,
      type: 'call_import',
      data: {
        total_recordings: recordings.length,
        inbound_recordings: inbound.length,
        unique_callers: uniqueCallers.length,
        imported,
        skipped,
        errors
      },
      scanned_at: new Date().toISOString()
    })
    if (scanError) throw scanError

    return NextResponse.json({
      success: true,
      total_recordings: recordings.length,
      inbound_filtered: inbound.length,
      unique_callers: uniqueCallers.length,
      imported,
      skipped_existing: skipped,
      errors,
      message: `Imported ${imported} past callers as leads. ${skipped} already existed. ${errors} errors.`
    })
  } catch (e) {
    console.error('Import past calls error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const auth = await getRouteShop(req, new URL(req.url).searchParams.get('shop_id'))
  if (!auth) return unauthorized()
  return NextResponse.json({
    info: 'POST to this endpoint to import all past Telnyx calls as leads',
    target_number: 'configured for the authenticated shop'
  })
}
