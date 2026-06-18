import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { callId } = await params
    const { data: state, error } = await getServiceClient()
      .from('ai_calls')
      .select('*')
      .eq('id', callId)
      .eq('shop_id', auth.shopId)
      .maybeSingle()

    if (error || !state) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    // Parse JSON fields (Supabase returns them as objects already, but guard for string)
    const transcript = typeof state.transcript === 'string'
      ? JSON.parse(state.transcript || '[]')
      : (state.transcript || [])

    const startMs = state.started_at
      ? (typeof state.started_at === 'string' ? new Date(state.started_at).getTime() : Number(state.started_at))
      : 0
    const duration = startMs ? Math.floor((Date.now() - startMs) / 1000) : 0

    return NextResponse.json({
      ok:            true,
      status:        state.status,
      transcript,
      summary:       state.summary    || '',
      recording_url: state.recording_url || '',
      duration,
    })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
