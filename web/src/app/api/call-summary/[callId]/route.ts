import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function GET(
  _req: NextRequest,
  { params }: { params: { callId: string } }
) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(params.callId)}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    )
    const rows = await r.json()
    const state = Array.isArray(rows) && rows.length > 0 ? rows[0] : null

    if (!state) {
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
