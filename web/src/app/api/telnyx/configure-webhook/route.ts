import { NextResponse } from 'next/server'

// Temporary one-time config route — configures Telnyx inbound connection webhook
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== 'alpha2024config') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.TELNYX_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 500 })
  }

  const CONNECTION_ID = '2786787533428623349'
  const WEBHOOK_URL = 'https://alpha-ai-desk.vercel.app/api/calls/webhook'

  // Update the inbound connection webhook URL
  const resp = await fetch('https://api.telnyx.com/v2/call_control_applications/${CONNECTION_ID}', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhook_event_url: WEBHOOK_URL,
      webhook_event_failover_url: '',
      active: true,
    }),
  })

  const data = await resp.json()
  return NextResponse.json({ 
    status: resp.status, 
    ok: resp.ok,
    webhookUrl: data?.data?.webhook_event_url,
    connectionName: data?.data?.application_name,
    error: data?.errors?.[0]?.detail || null
  })
}
