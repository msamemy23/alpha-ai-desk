import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min for large imports

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const INBOUND_CONNECTION = '2786787533428623349'
const TARGET_NUMBER = '+17136636979'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-0324'
const AI_BASE = 'https://openrouter.ai/api/v1'

// Fetch all call legs from Telnyx
async function fetchAllCalls(): Promise<any[]> {
  let allCalls: any[] = []
  let pageNumber = 1
  const pageSize = 250
  let hasMore = true

  while (hasMore) {
    const params = new URLSearchParams({
      'page[size]': String(pageSize),
      'page[number]': String(pageNumber),
      'filter[to]': TARGET_NUMBER,
      'filter[direction]': 'incoming',
    })
    const res = await fetch(`https://api.telnyx.com/v2/call_events?${params}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
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
async function fetchAllRecordings(): Promise<any[]> {
  let allRecordings: any[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const params = new URLSearchParams({ 'page[size]': '250' })
    if (cursor) params.set('page[after]', cursor)

    const res = await fetch(`https://api.telnyx.com/v2/recordings?${params}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
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
async function getTranscriptSummary(recordingUrl: string): Promise<string> {
  if (!AI_KEY) return 'No AI key configured for transcript'
  try {
    const res = await fetch(`${AI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
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
  if (!TELNYX_API_KEY) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not configured' }, { status: 400 })
  }

  try {
    // Fetch all recordings (these have from/to numbers)
    const recordings = await fetchAllRecordings()

    // Filter to inbound recordings on our connection
    const inbound = recordings.filter((rec: any) =>
      rec.connection_id === INBOUND_CONNECTION ||
      rec.to === TARGET_NUMBER ||
      rec.to === '7136636979' ||
      rec.to === '+17136636979'
    )

    // Deduplicate by from_number (caller)
    const callerMap: Record<string, any> = {}
    for (const rec of inbound) {
      const from = cleanPhone(rec.from || rec.caller_id_number || '')
      if (!from || from === TARGET_NUMBER || from === '+17136636979') continue

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
          .eq('phone', phone)
          .single()

        if (existing) {
          skipped++
          continue
        }

        // Also check the leads table
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id')
          .eq('phone', phone)
          .single()

        if (existingLead) {
          skipped++
          continue
        }

        // Try to get caller info from ai_calls table
        const { data: aiCall } = await supabase
          .from('ai_calls')
          .select('*')
          .or(`from_number.eq.${phone},caller_id.eq.${phone}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        // Also check call_history for CNAM data         const { data: historyCall } = await supabase           .from('call_history')           .select('matched_customer_name')           .eq('from_number', phone)           .not('matched_customer_name', 'is', null)           .order('start_time', { ascending: false })           .limit(1)           .single()         const historyName = historyCall?.matched_customer_name         const isPhoneNumber = historyName && /^\+?[0-9]+$/.test(historyName)         const callerName = aiCall?.customer_name || aiCall?.caller_name || (!isPhoneNumber && historyName) || 'Past Caller'
        const vehicle = aiCall?.vehicle_info || ''
        const service = aiCall?.service_needed || aiCall?.reason || ''
        const callDate = rec.recording_started_at || rec.created_at

        // Insert into growth_leads
        await supabase.from('growth_leads').insert({
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

        // Also insert into leads table for the Growth page
        await supabase.from('leads').insert({
          name: callerName,
          phone: phone,
          service_needed: service || 'Previous caller - follow up',
          source: 'past-call',
          notes: `Auto-imported from Telnyx. Called on ${callDate ? new Date(callDate).toLocaleDateString() : 'unknown'}`,
          status: 'new',
          follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          created_at: new Date().toISOString()
        })

        imported++
      } catch (e) {
        errors++
        console.error(`Failed to import caller ${phone}:`, e)
      }
    }

    // Log the import
    await supabase.from('growth_scans').upsert({
      id: 'past_call_import',
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

export async function GET() {
  return NextResponse.json({
    info: 'POST to this endpoint to import all past Telnyx calls as leads',
    target_number: TARGET_NUMBER
  })
}
