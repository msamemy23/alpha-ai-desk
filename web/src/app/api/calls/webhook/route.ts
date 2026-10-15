/**
 * Inbound call webhook (Telnyx Call Control).
 *
 * Telnyx signs every request. The shop is found from the number that was called (or from the call's own record, or from the signed
 * note on a transferred call) before anything is read or written, and only that shop's keys are loaded.
 * What the assistant says and does is decided in src/lib/voice/call-pipeline.ts; this file only connects it to Telnyx.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifyTelnyxSignature } from '@/lib/telnyx-verify'
import { getServiceClient } from '@/lib/supabase'
import { appUrl, buildConsent, buildEmailSender, buildTextSender, findShopByNumber, loadShopRow, readCallState, signCallState } from '@/lib/voice-runtime'
import { runCommands } from '@/lib/voice-telnyx'
import { makeModel } from '@/lib/voice/model'
import { handleCallEvent } from '@/lib/voice/call-pipeline'
import type { CallEvent } from '@/lib/voice/call-pipeline'
import type { ShopRow } from '@/lib/voice/sms-pipeline'

async function resolveShop(db: ReturnType<typeof getServiceClient>, ev: CallEvent, signed: Record<string, unknown> | null): Promise<{ shop: ShopRow | null; transferParent?: string }> {
  // A transferred call's second leg carries our own signed note naming the shop and the original call.
  if (signed && signed.kind === 'xfer' && typeof signed.shopId === 'string' && typeof signed.parent === 'string') {
    if (signed.parent !== ev.callId) {
      return { shop: await loadShopRow(db, signed.shopId), transferParent: signed.parent }
    }
    return { shop: await loadShopRow(db, signed.shopId) }
  }
  const { data: existing } = await db.from('ai_calls').select('shop_id').eq('id', ev.callId).maybeSingle()
  if (existing?.shop_id) return { shop: await loadShopRow(db, String(existing.shop_id)) }
  const called = String(ev.payload.to || ev.payload.called_number || '')
  return { shop: called ? await findShopByNumber(db, called) : null }
}

async function handleOne(ev: CallEvent, signed: Record<string, unknown> | null): Promise<void> {
  const db = getServiceClient()
  const resolved = await resolveShop(db, ev, signed)
  const shop = resolved.shop
  if (!shop?.shop_id) {
    console.error('[call-webhook] no shop matches this call')
    return
  }
  if (resolved.transferParent) ev.transferParent = resolved.transferParent
  const apiKey = String(shop.telnyx_api_key || '')
  const deps = {
    db,
    now: () => new Date(),
    model: makeModel(shop, { timeoutMs: 6000, appUrl: appUrl() }),
    email: buildEmailSender(shop),
    appUrl: appUrl(),
    sendText: buildTextSender(shop),
    consent: buildConsent(db),
    signState: signCallState,
  }
  const result = await handleCallEvent(deps, shop, ev)
  if (!result.commands.length) return
  const run = await runCommands(result.commands, ev.transferParent || ev.callId, apiKey)
  // If the words could not be spoken, carry on as if they had been, so a hangup or transfer is not left waiting.
  if (run.speakFailed) {
    const next = await handleCallEvent(deps, shop, { ...ev, type: 'call.speak.ended', payload: { ...ev.payload } })
    if (next.commands.length) await runCommands(next.commands, ev.transferParent || ev.callId, apiKey)
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  if (!verifyTelnyxSignature(rawBody, req.headers.get('telnyx-signature-ed25519'), req.headers.get('telnyx-timestamp'))) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) as Record<string, unknown> } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }

  const data = body.data as Record<string, unknown> | undefined
  const type = typeof data?.event_type === 'string' ? data.event_type : ''
  const payload = (data?.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, any>
  if (type === 'version') return NextResponse.json({ v: 'receptionist' })
  const callId = typeof payload.call_control_id === 'string' ? payload.call_control_id : ''
  if (!callId) return NextResponse.json({ ok: true })

  const ev: CallEvent = { type, callId, eventId: typeof data?.id === 'string' ? data.id : undefined, payload }
  const signed = readCallState(payload.client_state)

  // Answer Telnyx at once. The rest runs in the background so a slow step never makes Telnyx send the event again.
  waitUntil(handleOne(ev, signed).catch(e => { console.error('[call-webhook] error:', e instanceof Error ? e.message : e) }))
  return NextResponse.json('OK')
}
