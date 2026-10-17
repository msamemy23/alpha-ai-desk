import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { withOptOut } from '@/lib/growth-text'
import { getServiceClient } from '@/lib/supabase-service'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { createVoiceClientState } from '@/lib/voice-state'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { sendGrowthText } from '@/lib/growth-send'
import { channelOf } from '@/lib/text-channel'
import { leadOutreachCheck, subjectProblem, type LeadChannel } from '@/lib/lead-compliance'
import { EmailSendError, emailHtml, emailPlainText, isEmailOptedOut, sendResendEmail } from '@/lib/marketing-email'
import { createUnsubscribeToken, unsubscribeUrl } from '@/lib/unsubscribe-token'
import { validTimezone } from '@/lib/automation-rules'

// Contact ONE lead by text, email or an AI phone call, from the Get more customers screen.
//
// Everything sent is what the owner saw and approved on screen: this route never writes or changes a message.
// (Emailing new leads on a schedule is the "Lead outreach emails" automation, which has a preview and a history.)
// Before anything goes out, the server checks the lead is not stopped or unsubscribed, that the rules for
// contacting someone who never asked to hear from the shop are met, and that it is not outside calling hours.

const MAX_MESSAGE = 4000

function fetchT(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

const idempotencyKey = (parts: string[]) => `growth-outreach-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)}`

const baseUrl = (req: NextRequest): string => (
  process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin)
)

async function makeAICall(to: string, leadName: string, service: string, shop: { shopId: string; telnyxApiKey: string; telnyxPhone: string; telnyxConnectionId: string }) {
  if (!shop.telnyxApiKey || !shop.telnyxPhone || !shop.telnyxConnectionId) throw new Error('Calling is not configured for this shop')
  const res = await fetchT('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shop.telnyxApiKey}` },
    body: JSON.stringify({
      connection_id: shop.telnyxConnectionId,
      to, from: shop.telnyxPhone,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/telnyx-voice-webhook`,
      client_state: createVoiceClientState({ shopId: shop.shopId, task: service ? `Call ${leadName} about ${service}` : `Call ${leadName} and offer a helpful conversation` }),
      custom_headers: [{ name: 'X-Lead-Name', value: leadName }, { name: 'X-Service', value: service || 'auto repair' }],
    }),
  }, 10000)
  if (!res.ok) throw new Error(`Call failed: ${res.status}`)
  return res.json()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    if (typeof body?.action === 'string' && body.action) {
      return NextResponse.json({ ok: false, error: 'Emailing new leads and promotions on a schedule now live under Automations, where you can preview and pause them.' }, { status: 410 })
    }

    const leadId = body?.lead_id
    const method = body?.method as LeadChannel
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : ''
    const aiMode = body?.ai_mode === true
    if (typeof leadId !== 'string' || !leadId || !['sms', 'email', 'ai_call'].includes(method)) {
      return NextResponse.json({ error: 'lead_id and a valid method are required' }, { status: 400 })
    }
    if (rawMessage.length > MAX_MESSAGE) return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
    if (method !== 'ai_call' && !rawMessage) return NextResponse.json({ error: 'Write or approve the message first. Nothing is sent that you have not seen.' }, { status: 400 })
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
    const badSubject = method === 'email' ? subjectProblem(subject) : ''
    if (badSubject) return NextResponse.json({ error: badSubject }, { status: 400 })

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError
    const shop = {
      shopId: auth.shopId,
      name: String(settings?.shop_name || '').trim().slice(0, 120),
      phone: String(settings?.shop_phone || '').trim().slice(0, 40),
      address: String(settings?.shop_address || '').trim().slice(0, 200),
      timeZone: validTimezone(settings?.timezone),
      rules: (settings?.automation_config && typeof settings.automation_config === 'object' ? (settings.automation_config as Record<string, unknown>)._rules : null) as Record<string, unknown> | null,
      fromEmail: String(settings?.from_email || '').trim(),
      resendApiKey: String(settings?.resend_api_key || ''),
      telnyxApiKey: String(settings?.telnyx_api_key || ''),
      telnyxPhone: String(settings?.telnyx_phone_number || ''),
      telnyxConnectionId: String(settings?.telnyx_connection_id || ''),
    }

    const { data: lead, error: leadError } = await db.from('leads').select('*').eq('id', leadId).eq('shop_id', auth.shopId).maybeSingle()
    if (leadError) throw leadError
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    if (method === 'sms') {
      const textChannel = channelOf(settings)
      if (textChannel.kind === 'none') return NextResponse.json({ error: textChannel.message }, { status: 503 })
    }
    if (method === 'email' && (!shop.resendApiKey || !shop.fromEmail)) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })
    if (method === 'ai_call' && (!shop.telnyxApiKey || !shop.telnyxPhone || !shop.telnyxConnectionId)) return NextResponse.json({ error: 'Calling is not configured for this shop' }, { status: 503 })

    const emailOptedOut = method === 'email' && lead.email ? await isEmailOptedOut(db, auth.shopId, String(lead.email), { strict: true }) : false
    const smsOptedOut = method !== 'email' && lead.phone ? await isSmsOptedOut(db, auth.shopId, lead.phone) : false
    const check = leadOutreachCheck({ lead, channel: method, shop: { name: shop.name, address: shop.address, timeZone: shop.timeZone, rules: shop.rules }, emailOptedOut, smsOptedOut })
    if (!check.ok) return NextResponse.json({ ok: false, error: check.reason, code: check.code, retry_at: check.retryAt?.toISOString() }, { status: check.status })

    const result: Record<string, unknown> = {}
    let toContact = ''
    let sentMessage = rawMessage

    if (method === 'sms') {
      toContact = String(lead.phone)
      sentMessage = withOptOut(rawMessage)
      const smsSent = await sendGrowthText(settings, toContact, sentMessage, idempotencyKey([auth.shopId, 'lead-sms', String(lead.id), sentMessage]), 'service')
      if (!smsSent.success) throw new Error(smsSent.error || 'The text could not be sent')
      result.sms = { id: smsSent.messageId }
    } else if (method === 'email') {
      toContact = String(lead.email).trim()
      const footer = {
        shopName: shop.name,
        address: shop.address,
        phone: shop.phone,
        unsubscribe: unsubscribeUrl(baseUrl(req), createUnsubscribeToken(auth.shopId, toContact)),
      }
      const finalSubject = subject || `A note from ${shop.name}`
      result.subject = finalSubject
      result.email = await sendResendEmail({
        apiKey: shop.resendApiKey,
        from: shop.fromEmail,
        to: toContact,
        subject: finalSubject,
        html: emailHtml(rawMessage, footer),
        text: emailPlainText(rawMessage, footer),
        replyTo: String(settings?.shop_email || '') || undefined,
        unsubscribeUrl: footer.unsubscribe,
        idempotencyKey: idempotencyKey([auth.shopId, 'lead-email', String(lead.id), finalSubject, rawMessage]),
      })
    } else {
      toContact = String(lead.phone)
      sentMessage = ''
      result.call = await makeAICall(toContact, String(lead.name || 'Customer'), String(lead.service_needed || ''), shop)
    }

    const now = new Date().toISOString()
    // The message went out. If writing it down fails, say so rather than pretend it did not send.
    const bookkeeping: string[] = []
    const history = await db.from('outreach_history').insert({
      shop_id: auth.shopId, lead_id: leadId, method, status: 'sent', message: sentMessage,
      to_contact: toContact, ai_mode: aiMode, metadata: result, created_at: now,
    })
    if (history.error) bookkeeping.push('the outreach history')
    const update = await db.from('leads').update({ status: 'contacted', last_contact: now }).eq('id', leadId).eq('shop_id', auth.shopId)
    if (update.error) bookkeeping.push('the lead status')
    const activity = await db.from('growth_activity').insert({
      shop_id: auth.shopId, action: `outreach_${method}`, target: lead.name,
      details: `${aiMode ? 'Alpha drafted, you approved: ' : ''}${method === 'ai_call' ? 'call started to' : 'sent to'} ${toContact}`,
      status: 'sent', created_at: now,
    })
    if (activity.error) bookkeeping.push('the activity log')

    return NextResponse.json({ success: true, ok: true, method, to: toContact, ai_mode: aiMode, result, ...(bookkeeping.length ? { warning: `Sent, but ${bookkeeping.join(' and ')} could not be updated.` } : {}) })
  } catch (e) {
    console.error('Outreach error:', e)
    if (e instanceof EmailSendError) return NextResponse.json({ error: `Email failed: ${e.message}` }, { status: 502 })
    const message = e instanceof Error ? e.message : 'Outreach failed'
    // Messages we wrote ourselves are safe to show; anything else is a provider or database detail.
    const safe = /^(SMS|Email|Calling|Call) |database update|could not be checked/.test(message)
    return NextResponse.json({ error: safe ? message : 'Outreach failed. Nothing was recorded as sent. Try again.' }, { status: 500 })
  }
}
