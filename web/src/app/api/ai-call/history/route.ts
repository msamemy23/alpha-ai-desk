import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { askedNotToBeCalled, callStateWords } from '@/lib/ai-call'
import { loadCallCustomer } from '@/lib/ai-call-server'
import { phoneDigits } from '@/lib/automation-rules'

export const dynamic = 'force-dynamic'

const MAX_CALLS = 20
const MAX_LINES = 60

function startedIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  const d = Number.isFinite(n) && n > 1e11 ? new Date(n) : new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Calls Alpha placed to one customer, newest first, with what was said and the summary written when the call ended. */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const db = getServiceClient()
    const found = await loadCallCustomer(db, auth.shopId, req.nextUrl.searchParams.get('customer_id'))
    if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
    if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })

    const ten = phoneDigits(found.customer.phone).slice(-10)
    if (ten.length < 10) return NextResponse.json({ ok: true, calls: [] })

    const { data, error } = await db.from('ai_calls')
      .select('id,status,task,summary,transcript,started_at,caller')
      .eq('shop_id', auth.shopId)
      .in('caller', [`+1${ten}`, `1${ten}`, ten])
      .order('started_at', { ascending: false })
      .limit(MAX_CALLS)
    if (error) return NextResponse.json({ ok: false, error: 'Alpha’s calls could not be loaded.' }, { status: 500 })

    const calls = (data || []).map(row => {
      const raw = typeof row.transcript === 'string' ? (() => { try { return JSON.parse(row.transcript) } catch { return [] } })() : row.transcript
      const all = (Array.isArray(raw) ? raw : []).filter(l => l && typeof l === 'object') as Array<Record<string, unknown>>
      const state = callStateWords(row.status)
      return {
        id: String(row.id),
        state: state.state,
        label: state.label,
        started_at: startedIso(row.started_at),
        summary: typeof row.summary === 'string' ? row.summary.slice(0, 2000) : '',
        asked_not_to_call: askedNotToBeCalled(all),
        lines: all.slice(0, MAX_LINES).map(l => ({ speaker: String(l.speaker) === 'ai' ? 'ai' : 'person', text: String(l.text ?? '').slice(0, 600) })),
      }
    })
    return NextResponse.json({ ok: true, calls })
  } catch (error) {
    console.error('[ai-call/history] error:', error)
    return NextResponse.json({ ok: false, error: 'Alpha’s calls could not be loaded.' }, { status: 500 })
  }
}
