import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { NeedsDatabaseUpdate } from '@/lib/automation-store'
import { createReplyStore } from '@/lib/review-replies-store'
import {
  approveReply,
  createReply,
  dismissReply,
  listReplies,
  markPosted,
  redraftReply,
  saveReply,
  type ModelCall,
  type ShopFacts,
} from '@/lib/review-replies'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Replies to Google reviews. Alpha drafts, the owner edits and approves, and the owner posts it on Google themselves.
// This route never posts anything anywhere.

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status })
const WRITERS = new Set(['owner', 'admin', 'manager'])
const UUID = /^[0-9a-f-]{36}$/i

function failure(error: unknown): NextResponse {
  if (error instanceof NeedsDatabaseUpdate) return json({ ok: false, error: 'Review replies need a database update before they can be saved. Ask your developer to apply it.', needs_database_update: true }, 409)
  console.error('[growth/review-replies]', error instanceof Error ? error.message : error)
  return json({ ok: false, error: 'Something went wrong. Try again.' }, 500)
}

async function loadShop(shopId: string): Promise<{ facts: ShopFacts; model: ModelCall | null }> {
  const { data, error } = await getServiceClient().from('settings').select('shop_name,shop_phone,ai_api_key,ai_base_url,ai_model').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('The shop settings could not be loaded.')
  const facts: ShopFacts = { shopName: String(data?.shop_name || '').trim().slice(0, 120), shopPhone: String(data?.shop_phone || '').trim().slice(0, 40) }
  const key = String(data?.ai_api_key || '').trim()
  if (!key) return { facts, model: null }
  const base = normalizeAiBaseUrl(data?.ai_base_url || AI_BASE_URLS.OPENROUTER)
  const modelName = normalizeAiModel(data?.ai_model, base)
  const model: ModelCall = async (system, user) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 220, temperature: 0.4 }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`The AI service answered ${res.status}`)
    const out = await res.json().catch(() => ({}))
    return String(out?.choices?.[0]?.message?.content || '')
  }
  return { facts, model }
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  try {
    const { facts } = await loadShop(auth.shopId)
    try {
      return json({ ok: true, replies: await listReplies(createReplyStore(getServiceClient()), auth.shopId, facts), can_edit: WRITERS.has(auth.role) })
    } catch (error) {
      if (error instanceof NeedsDatabaseUpdate) return json({ ok: true, replies: [], needs_database_update: true, can_edit: WRITERS.has(auth.role) })
      throw error
    }
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!WRITERS.has(auth.role)) return forbidden()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id : ''
  if (id && !UUID.test(id)) return json({ ok: false, error: 'Unknown review' }, 400)
  if (action !== 'draft' && !id) return json({ ok: false, error: 'Choose a review first.' }, 400)

  try {
    const store = createReplyStore(getServiceClient())
    const { facts, model } = await loadShop(auth.shopId)
    let out
    if (action === 'draft' || action === 'redraft') {
      const limit = checkRateLimit(`review-reply:${auth.shopId}`, 30, 60 * 60_000)
      if (!limit.ok) return json({ ok: false, error: 'That is a lot of drafts for one hour. Try again later.' }, 429)
      out = action === 'draft' ? await createReply(store, auth.shopId, facts, model, body) : await redraftReply(store, auth.shopId, id, facts, model)
    } else if (action === 'save') out = await saveReply(store, auth.shopId, id, facts, body.text)
    else if (action === 'approve') out = await approveReply(store, auth.shopId, id, auth.userId, facts)
    else if (action === 'posted') out = await markPosted(store, auth.shopId, id, facts)
    else if (action === 'dismiss') out = await dismissReply(store, auth.shopId, id, facts)
    else return json({ ok: false, error: 'Unknown action' }, 400)
    if ('ok' in out && out.ok === false) return json({ ok: false, error: out.error }, out.status)
    return json({ ok: true, reply: out, ai_used: action === 'draft' || action === 'redraft' ? model !== null : undefined })
  } catch (error) {
    return failure(error)
  }
}
