import { NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

export async function GET() {
  if (!TELNYX_API_KEY) return NextResponse.json({ error: 'no key' }, { status: 500 })

  const [profiles, connections, numbers] = await Promise.all([
    fetch(`${TELNYX_BASE}/outbound_voice_profiles?page[size]=10`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
    }).then(r => r.json()),
    fetch(`${TELNYX_BASE}/credential_connections?page[size]=10`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
    }).then(r => r.json()),
    fetch(`${TELNYX_BASE}/phone_numbers?page[size]=10`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
    }).then(r => r.json()),
  ])

  return NextResponse.json({ profiles, connections, numbers })
}
