import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { NeedsDatabaseUpdate, loadShopInfo } from '@/lib/automation-store'
import { engineDeps } from '@/lib/automation-service'
import { createPromotionStore } from '@/lib/growth-promotions-store'
import {
  cleanInput,
  continuePromotion,
  createPromotion,
  deletePromotion,
  listPromotions,
  parseSendAt,
  previewPromotion,
  savePromotion,
  sendPromotion,
  stopPromotion,
  type PromotionInput,
} from '@/lib/growth-promotions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// One-off promotions: write it, choose who gets it, see exactly what will go out, then send now or at a set time.
// Everything goes through the automation engine, so STOP, quiet hours and the marketing limits are checked on the server.

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status })
const WRITERS = new Set(['owner', 'admin', 'manager'])
const UUID = /^[0-9a-f-]{36}$/i
// A stand-in message used only to count an audience before the owner has written anything.
const COUNT_ONLY_MESSAGE = 'Hi {name}, this is {shop}.'

function baseUrlOf(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
}

function failure(error: unknown): NextResponse {
  if (error instanceof NeedsDatabaseUpdate) return json({ ok: false, error: 'Promotions need a database update before they can be used. Ask your developer to apply it.', needs_database_update: true }, 409)
  console.error('[growth/promotions]', error instanceof Error ? error.message : error)
  return json({ ok: false, error: 'Something went wrong. Nothing was sent twice. Try again.' }, 500)
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const sb = getServiceClient()
  try {
    const info = await loadShopInfo(sb, auth.shopId)
    const shop = { sms_ready: info.smsReady, email_ready: info.emailReady, master_enabled: info.rules.master_enabled, timezone: info.timezone, name: info.name, has_settings: info.settingsId !== null }
    try {
      const promotions = await listPromotions(createPromotionStore(sb), auth.shopId)
      return json({ ok: true, promotions, shop, can_edit: WRITERS.has(auth.role) })
    } catch (error) {
      if (error instanceof NeedsDatabaseUpdate) return json({ ok: true, promotions: [], shop, needs_database_update: true, can_edit: WRITERS.has(auth.role) })
      throw error
    }
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id : ''

  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!WRITERS.has(auth.role)) return forbidden()
  if (req.headers.get('x-ai-source') === 'ai' && ['send', 'stop', 'continue', 'delete'].includes(action) && req.headers.get('x-ai-approval') !== 'confirm') {
    return json({ ok: false, error: 'Explicit confirmation is required before sending or stopping a promotion', approvalRequired: true }, 409)
  }
  if (id && !UUID.test(id)) return json({ ok: false, error: 'Unknown promotion' }, 400)

  const sb = getServiceClient()
  const store = createPromotionStore(sb)
  const deps = engineDeps(sb, baseUrlOf(req))

  try {
    if (action === 'preview') {
      const countOnly = body.audience_only === true
      const parsed = cleanInput({ ...body, name: body.name || 'Preview', message: countOnly && !String(body.message || '').trim() ? COUNT_ONLY_MESSAGE : body.message })
      if (!parsed.ok) return json({ ok: false, error: parsed.errors[0], errors: parsed.errors }, 400)
      let sendAt: number | undefined
      if (body.send_local || body.send_at) {
        const info = await loadShopInfo(sb, auth.shopId)
        const when = parseSendAt({ local: body.send_local, iso: body.send_at }, info.timezone, Date.now())
        if (!when.ok) return json({ ok: false, error: when.error }, 400)
        sendAt = when.at
      }
      const preview = await previewPromotion(deps, auth.shopId, parsed.value, { campaignId: id || undefined, sendAt })
      return json({ ...preview, ...(countOnly ? { recipients: [] } : {}) })
    }

    if (action === 'save') {
      const parsed = cleanInput(body)
      if (!parsed.ok) return json({ ok: false, error: parsed.errors[0], errors: parsed.errors }, 400)
      if (id) {
        const saved = await savePromotion(store, auth.shopId, id, parsed.value as PromotionInput)
        if ('ok' in saved) return json({ ok: false, error: saved.error, code: saved.code }, saved.status)
        return json({ ok: true, id: saved.id })
      }
      const created = await createPromotion(store, auth.shopId, auth.userId, parsed.value)
      return json({ ok: true, id: created.id })
    }

    if (action === 'delete' || action === 'send' || action === 'stop' || action === 'continue') {
      if (!id) return json({ ok: false, error: 'Choose a promotion first.' }, 400)
    }

    if (action === 'delete') {
      const out = await deletePromotion(store, auth.shopId, id)
      return out === true ? json({ ok: true }) : json({ ok: false, error: out.error, code: out.code }, out.status)
    }

    if (action === 'send') {
      const limit = checkRateLimit(`promotion-send:${auth.shopId}`, 6, 10 * 60_000)
      if (!limit.ok) return json({ ok: false, error: 'Slow down for a minute, then try again.' }, 429)
      let sendAt: number | undefined
      if (body.send_local || body.send_at) {
        const info = await loadShopInfo(sb, auth.shopId)
        const when = parseSendAt({ local: body.send_local, iso: body.send_at }, info.timezone, Date.now())
        if (!when.ok) return json({ ok: false, error: when.error }, 400)
        sendAt = when.at
      }
      const out = await sendPromotion(deps, store, auth.shopId, id, { sendAt })
      return out.ok ? json({ ...out }) : json({ ok: false, error: out.error, code: out.code }, out.status)
    }

    if (action === 'continue') {
      const out = await continuePromotion(deps, store, auth.shopId, id)
      return out.ok ? json({ ...out }) : json({ ok: false, error: out.error, code: out.code }, out.status)
    }

    if (action === 'stop') {
      const out = await stopPromotion(deps, store, auth.shopId, id)
      return out.ok ? json({ ...out }) : json({ ok: false, error: out.error, code: out.code }, out.status)
    }

    return json({ ok: false, error: 'Unknown action' }, 400)
  } catch (error) {
    return failure(error)
  }
}
