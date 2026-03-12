import { NextRequest, NextResponse } from 'next/server'

const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL || 'https://hello-entire-quote-numerous.trycloudflare.com'

export async function GET(
  _req: NextRequest,
  { params }: { params: { callId: string } }
) {
  try {
    const res = await fetch(`${VOICE_AGENT_URL}/api/call-summary/${params.callId}`)
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
