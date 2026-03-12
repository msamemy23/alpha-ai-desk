import { NextRequest, NextResponse } from 'next/server'

/**
 * Call summary — returns transcript + summary for a given call.
 * State is shared via the module-level Map in telnyx-voice-webhook/route.ts
 * Since both routes run in the same serverless process, this works.
 */

// Re-export the callState from the webhook route so both share the same Map
// (Next.js module system ensures same instance within one serverless invocation)
import { callStateStore } from '@/lib/call-state'

export async function GET(
  _req: NextRequest,
  { params }: { params: { callId: string } }
) {
  let state = callStateStore.get(params.callId)
  if (!state) {
    const prefix = params.callId.slice(0, 20)
    for (const [k, v] of Array.from(callStateStore.entries())) {
      if (k.slice(0, 20) === prefix) { state = v; break }
    }
  }

  if (!state) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok:         true,
    status:     state.status,
    transcript: state.transcript,
    summary:    (state as unknown as Record<string, unknown>).summary as string || '',
    duration:   Math.floor((Date.now() - state.startedAt) / 1000),
  })
}
