import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { initialState, restoreState, runWorkflow, type WorkflowState } from '@/lib/ai/workflow/engine'
import { object, type JsonObject } from '@/lib/ai/workflow/catalog'
import { POST as complete } from '@/app/api/ai-completions/route'
import { POST as action } from '@/app/api/ai-action/route'
import { POST as lookupParts } from '@/app/api/parts-lookup/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(id)

function safeToolData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeToolData)
  if (!object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /(?:password|secret|token|api[_-]?key|authorization|cookie|(?:^|_)pin(?:_|$))/i.test(key) ? '[redacted]' : safeToolData(child)]))
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!validId(sessionId)) return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
  const { data, error } = await getServiceClient().from('ai_workflow_sessions').select('state')
    .eq('shop_id', auth.shopId).eq('user_id', auth.userId).eq('session_id', sessionId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Saved task could not be loaded' }, { status: 503 })
  let state: WorkflowState | null = null
  if (data?.state !== undefined && data?.state !== null) {
    try { state = restoreState(data.state) } catch { return NextResponse.json({ error: 'Saved task state is invalid. No action was started.' }, { status: 503 }) }
  }
  return NextResponse.json({ approval: state?.pending || null, active: Boolean(state?.task), lastReply: state?.turns?.at(-1)?.reply || null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!checkRateLimit(rateLimitKey('ai-workflow', auth.shopId, auth.userId), 30, 60_000).ok) return NextResponse.json({ error: 'Too many requests. Wait a moment and retry.' }, { status: 429 })
  const body: unknown = await req.json().catch(() => null)
  if (!object(body) || !validId(body.sessionId) || !validId(body.turnId)) return NextResponse.json({ error: 'A valid sessionId and turnId are required' }, { status: 400 })
  if (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 12000)) return NextResponse.json({ error: 'Message must be text under 12,000 characters' }, { status: 400 })
  if (body.confirmation !== undefined && (!object(body.confirmation) || !validId(body.confirmation.id) || !['confirm', 'cancel'].includes(String(body.confirmation.decision)))) return NextResponse.json({ error: 'Invalid confirmation' }, { status: 400 })
  if (body.message !== undefined && body.confirmation !== undefined) return NextResponse.json({ error: 'Send a message or confirm a review, not both' }, { status: 400 })
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 20 || body.history.some(item => !object(item) || !['user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string' || item.content.length > 4000))) {
    return NextResponse.json({ error: 'Legacy history is invalid' }, { status: 400 })
  }
  const legacyHistory = Array.isArray(body.history) ? body.history as { role: 'user' | 'assistant'; content: string }[] : []
  const db = getServiceClient()
  const scope = { p_shop_id: auth.shopId, p_user_id: auth.userId, p_session_id: body.sessionId, p_lease_id: randomUUID() }
  const { data: lease, error: leaseError } = await db.rpc('lease_ai_workflow', scope)
  if (leaseError) return NextResponse.json({ error: 'Task storage is unavailable. No action was started.' }, { status: 503 })
  if (lease?.busy) return NextResponse.json({ error: 'This conversation is already processing a request. Wait and retry.' }, { status: 409 })
  let state: WorkflowState
  try { state = lease?.state === undefined || lease?.state === null ? initialState() : restoreState(lease.state) } catch {
    return NextResponse.json({ error: 'Saved task state is invalid. No action was started.' }, { status: 503 })
  }
  const checkpoint = async (current: WorkflowState, release = false) => {
    const { data, error } = await db.rpc('checkpoint_ai_workflow', { ...scope, p_state: current, p_release: release })
    if (error) throw new Error('Workflow state could not be saved. No new action was started; retry to continue from the saved task.')
    if (data !== true) throw new Error('Workflow ownership expired before progress could be saved. Retry to reconcile the saved task safely.')
  }
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatInFlight: Promise<void> | null = null
  let heartbeatLeaseLost = false
  const renewLease = () => {
    if (heartbeatInFlight || heartbeatLeaseLost) return
    heartbeatInFlight = (async () => {
      const renewal = (async () => {
        try { return await db.rpc('renew_ai_workflow', scope) }
        catch { return { data: null, error: new Error('renewal request failed') } }
      })()
      const timeout = new Promise<{ data: null; error: Error }>(resolve => setTimeout(() => resolve({ data: null, error: new Error('renewal request timed out') }), 5_000))
      const { data, error } = await Promise.race([renewal, timeout])
      if (!error && data === true) return
      // A transient network/provider error is retried on the next tick. A
      // definitive false means another request owns the session or the lease
      // has expired; continuing could make the in-memory result unsafe.
      if (!error && data !== true) heartbeatLeaseLost = true
    })().finally(() => { heartbeatInFlight = null })
  }
  const stopHeartbeat = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    if (heartbeatInFlight) {
      await Promise.race([heartbeatInFlight, new Promise(resolve => setTimeout(resolve, 5_000))])
      heartbeatInFlight = null
    }
  }
  heartbeatTimer = setInterval(renewLease, 30_000)
  // Internal dispatch uses only fixed, imported routes and the actual request's
  // authentication context. Never forward a model-selected endpoint or service secret.
  const dispatch = async (handler: (request: NextRequest) => Promise<Response>, path: string, payload: JsonObject, approvalKey?: string) => {
    const headers = new Headers(req.headers)
    headers.set('Content-Type', 'application/json')
    headers.delete('x-ai-approval')
    headers.delete('x-idempotency-key')
    if (approvalKey) {
      headers.set('x-ai-approval', 'confirm')
      headers.set('x-idempotency-key', `workflow:${approvalKey}`)
    }
    const response = await handler(new NextRequest(new URL(path, req.url), { method: 'POST', headers, body: JSON.stringify(payload) }))
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }
  try {
    if (!state.turns.length) {
      // Upgrade existing conversations from server-held history. Legacy
      // assistant quotes are context, never monetary or execution evidence.
      const { data: history, error: historyError } = await db.from('ai_chat_history').select('role,content,sequence_no').eq('shop_id', auth.shopId).eq('user_id', auth.userId).eq('session_id', body.sessionId).order('sequence_no', { ascending: true }).limit(60)
      if (historyError) throw new Error('Existing conversation could not be restored')
      for (const row of history || []) {
        let text = row.content
        try { const parsed = JSON.parse(row.content); if (typeof parsed.content === 'string') text = parsed.content } catch { /* old plain text */ }
        if (typeof text === 'string' && text.trim() && !(row.role === 'user' && text === body.message)) {
          state.turns.push({ id: `history-${row.sequence_no}`, role: row.role === 'assistant' ? 'assistant' : 'user', text: text.slice(0, 12000) })
        }
      }
      if (!state.turns.length) {
        for (const [index, item] of legacyHistory.entries()) if (!(item.role === 'user' && item.content === body.message)) {
          state.turns.push({ id: `legacy-history-${index}`, role: item.role, text: item.content })
        }
      }
      await checkpoint(state)
    }
    const { data: settings, error: settingsError } = await db.from('settings').select('shop_name,labor_rate,tax_rate').eq('shop_id', auth.shopId).limit(1).maybeSingle()
    if (settingsError) throw new Error('Shop settings could not be loaded')
    const result = await runWorkflow(state, {
      turnId: body.turnId,
      message: typeof body.message === 'string' ? body.message : undefined,
      confirmation: body.confirmation as { id: string; decision: 'confirm' | 'cancel' } | undefined,
    }, {
      shop: settings || {}, id: randomUUID, checkpoint, deadline: Date.now() + 240_000,
      model: async messages => {
        const { response, data } = await dispatch(complete, '/api/ai-completions', { messages, temperature: 0.1, max_tokens: 5000 })
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'AI provider unavailable')
        const text = data.choices?.[0]?.message?.content
        if (typeof text !== 'string' || !text.trim()) throw new Error('AI provider returned no usable decision')
        return text
      },
      execute: async (name, payload, approvalKey) => {
        const { response, data } = name === 'lookupParts'
          ? await dispatch(lookupParts, '/api/parts-lookup', payload)
          : await dispatch(action, '/api/ai-action', { action: name, payload }, approvalKey)
        const outcome = name === 'lookupParts' || response.ok
          ? undefined
          : data.operationStatus === 'failed' ? 'failed' as const : 'unknown' as const
        return { ok: response.ok && data.ok === true, data: safeToolData(data.data), error: data.error || `Service returned HTTP ${response.status}`, outcome }
      },
    })
    await stopHeartbeat()
    if (heartbeatLeaseLost) throw new Error('Workflow ownership expired before progress could be saved. Retry to reconcile the saved task safely.')
    await checkpoint(state, true)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // A failure here never authorizes another write. Persisted approval and
    // operation IDs allow the next request to reconcile a partially finished turn.
    await stopHeartbeat()
    await checkpoint(state, true).catch(() => {})
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workflow unavailable' }, { status: 503 })
  }
}

