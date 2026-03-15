import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const FROM_NUMBER = process.env.TELNYX_PHONE_NUMBER || '+17136636979'

export async function POST(req: NextRequest) {
  try {
    const { to, message } = await req.json()

    if (!to || !message) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 })
    }

    if (!TELNYX_API_KEY) {
      console.warn('TELNYX_API_KEY not set, SMS not sent')
      return NextResponse.json({ success: true, simulated: true, message: 'SMS simulated (no API key)' })
    }

    // Clean phone number
    let phone = to.replace(/[^\d+]/g, '')
    if (!phone.startsWith('+')) phone = '+1' + phone

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TELNYX_API_KEY}`
      },
      body: JSON.stringify({
        from: FROM_NUMBER,
        to: phone,
        text: message
      })
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('Telnyx SMS error:', data)
      return NextResponse.json({
        error: data.errors?.[0]?.detail || 'Failed to send SMS',
        details: data
      }, { status: res.status })
    }

    return NextResponse.json({
      success: true,
      message_id: data.data?.id,
      to: phone
    })
  } catch (e) {
    console.error('Send SMS error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
