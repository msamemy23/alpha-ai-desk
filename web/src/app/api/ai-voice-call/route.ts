import { NextRequest, NextResponse } from 'next/server'

/**
 * AI Voice Call — initiates an outbound Telnyx call with bidirectional media
 * streaming, which connects to the Python voice agent WebSocket server.
 *
 * The Python server handles: STT → DeepSeek V3.2 → TTS → stream audio back
 */

const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL || 'https://hello-entire-quote-numerous.trycloudflare.com'

export async function POST(req: NextRequest) {
  try {
    const { to, task, callerName } = await req.json()

    if (!to) {
      return NextResponse.json({ ok: false, error: 'Missing to number' }, { status: 400 })
    }

    // Forward to voice agent server which handles Telnyx streaming
    const res = await fetch(`${VOICE_AGENT_URL}/api/ai-voice-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, task, callerName }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data.error || 'Voice agent error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, callId: data.callId, to: data.to })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
