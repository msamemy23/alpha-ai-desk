/**
 * Test mode for the receptionist. One pretend turn of a call or a text, run through the real decision engine with the shop's
 * rules (saved, or the unsaved ones being edited). Nothing is saved, no text, email or call is sent, and no real customer is read.
 * Open appointment times are read (not changed) so the "book a time" path can be tried honestly.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { authed, fail, ok, readBody, shopSettings } from '@/lib/receptionist-api'
import { loadRules, upcomingAppointments } from '@/lib/voice/store'
import { normalizeRules } from '@/lib/voice/rules'
import { shopFromSettings } from '@/lib/voice/prompt'
import { makeModel } from '@/lib/voice/model'
import { simulateTurn } from '@/lib/voice/simulate'
import { wallClock } from '@/lib/voice/hours'
import type { ChatMessage } from '@/lib/voice/engine'

/** A pretend "now" within two days of the real one, so hours and quiet hours can be tried at different times. */
function pretendNow(raw: unknown): Date {
  const real = new Date()
  if (typeof raw !== 'string') return real
  const t = Date.parse(raw)
  if (!Number.isFinite(t) || Math.abs(t - real.getTime()) > 3 * 86_400_000) return real
  return new Date(t)
}

export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const limited = checkRateLimit(rateLimitKey('receptionist-test', auth.userId, auth.shopId, ''), 40, 60_000)
  if (!limited.ok) return fail('Slow down a little and try again in a minute.', 429)

  const body = await readBody(req)
  if (!body) return fail('Send a message to try.')
  const channel = body.channel === 'call' ? 'call' : 'sms'
  const text = typeof body.text === 'string' ? body.text.slice(0, 600) : ''
  if (channel === 'sms' && !text.trim()) return fail('Type what the customer would say.')

  const settings = await shopSettings(db, auth.shopId, 'shop_name,shop_phone,telnyx_phone_number,shop_address,shop_email,timezone,ai_api_key,ai_base_url,ai_model')
  const shop = shopFromSettings(settings)
  const rules = body.rules && typeof body.rules === 'object' ? normalizeRules(body.rules) : (await loadRules(db, auth.shopId)).rules
  const now = pretendNow(body.asOf)
  const history: ChatMessage[] = Array.isArray(body.history)
    ? body.history.slice(-12).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 600) }))
    : []

  const today = wallClock(now, shop.timezone).ymd
  const end = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
  const appointments = rules.booking_mode === 'book' ? await upcomingAppointments(db, auth.shopId, today, end) : []

  const out = await simulateTurn({
    channel, text, rules, shop, now, state: body.state, history, appointments,
    model: makeModel(settings, { timeoutMs: 9000 }),
    priorAi: history.filter(h => h.role === 'assistant').length,
  })
  return ok({ ...out, usedYourAiKey: Boolean(settings?.ai_api_key), notSaved: true })
}
