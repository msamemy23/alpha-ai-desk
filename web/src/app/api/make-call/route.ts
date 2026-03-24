import { NextRequest, NextResponse } from 'next/server'

const WEBHOOK_URL = 'https://alpha-ai-desk.vercel.app/api/telnyx-voice-webhook'

export async function POST(req: NextRequest) {
  try {
    const { to, name, task, callerName } = await req.json()
    if (!to) return NextResponse.json({ error: 'Missing to' }, { status: 400 })

    const apiKey = process.env.TELNYX_API_KEY!
    const shopPhone = '+17136636979'
    if (!apiKey) return NextResponse.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 })

    const digits = to.replace(/\D/g, '')
    const e164 = digits.startsWith('1') ? '+' + digits : digits.length === 10 ? '+1' + digits : '+' + digits

    // Build task — use passed task as-is
    // Empty/undefined task = personal call (user just wants to talk, no AI script)
    // Non-empty task = AI call (AI follows these instructions)
    const callTask = task || ''

    // Encode task in client_state so webhook knows what to do
    const clientState = Buffer.from(JSON.stringify({ task: callTask, name: name || e164, callerName: callerName || '' })).toString('base64')

    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: '2912878759822493204',
        to: e164,
        from: shopPhone,
        client_state: clientState,
        webhook_url: WEBHOOK_URL,
        webhook_url_method: 'POST',
        answering_machine_detection: 'disabled',
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.errors?.[0]?.detail || JSON.stringify(data.errors) || 'Call failed')

    const callId = data.data?.call_control_id

    // Pre-create the row so it shows up in the UI immediately
    await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/ai_calls`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id: callId,
          task: callTask,
          status: 'calling',
          greeted: false,
          processing: false,
          is_speaking: false,
          script_stage: 0,
          objection_count: 0,
          started_at: Date.now(),
        }),
      }
    )

    return NextResponse.json({ ok: true, callId })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
