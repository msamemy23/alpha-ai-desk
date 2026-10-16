export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, getSessionUser, unauthorized } from '@/lib/api-auth'
import { formatPhone } from '@/lib/telnyx'
import { getIdempotencyKey } from '@/lib/api-response'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { sendDurableSms } from '@/lib/durable-sms'
import { sendDurableEmail } from '@/lib/durable-email'
import { buildPublicDocument } from '@/lib/doc-public'
import { buildSendEmail, buildSendText } from '@/lib/doc-email'
import { logoUrl, pixelUrl, signUrl } from '@/lib/doc-links'
import { ensureLink } from '@/lib/doc-links-server'
import { goodThroughWords, isSendChannel, PREVIEW_LINK_WORD, sendBlockReason, sendBlockStatus } from '@/lib/doc-send'
import { loadOptions, loadPrefs, logEvent, originFor, shopFromSettings, staffLabel, todayInZone } from '@/lib/doc-server'
import { phonePretty } from '@/lib/today'
import { checkRateLimit } from '@/lib/rate-limit'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Send an estimate, invoice or receipt: by text, by email, or as a private link to copy.
 *
 * With `preview: true` it only shows what would go out and where, and writes nothing. Without it, it makes (or reuses)
 * the customer's private link, sends the message with that link in it, marks the document sent and writes a history line.
 * The older callers (Ask Alpha) send only { documentId, channel, email | phone } and read only `error`, which still works.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    if (!checkRateLimit(`send-document:${auth.shopId}`, 60, 60_000).ok) return NextResponse.json({ error: 'Too many sends. Wait a minute and try again.' }, { status: 429 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { documentId, channel, email: reqEmail, phone: reqPhone } = body as Record<string, unknown>
    const preview = (body as { preview?: unknown }).preview === true
    if (typeof documentId !== 'string' || !documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })
    if (!isSendChannel(channel)) return NextResponse.json({ error: 'channel must be email, sms or copy' }, { status: 400 })
    const db = getServiceClient()

    // The document and settings are scoped to the caller's shop, so one shop can never send another shop's document.
    const [{ data: doc, error: docError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle(),
      db.from('settings').select('*').eq('shop_id', auth.shopId).limit(1).maybeSingle(),
    ])
    if (docError) return NextResponse.json({ error: 'Document could not be loaded' }, { status: 500 })
    if (settingsError) return NextResponse.json({ error: 'Shop settings could not be loaded' }, { status: 500 })
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Who to send to: the request, then the document, then the customer's own record.
    let custEmail = str(reqEmail) || str(doc.customer_email)
    let custPhone = str(reqPhone) || str(doc.customer_phone)
    let smsOptedOut = false
    if (doc.customer_id) {
      const { data: cust, error: customerError } = await db
        .from('customers')
        .select('email,phone,sms_opted_out')
        .eq('id', doc.customer_id)
        .eq('shop_id', auth.shopId)
        .maybeSingle()
      if (customerError) return NextResponse.json({ error: 'Customer could not be loaded' }, { status: 500 })
      if (cust) {
        if (reqPhone && cust.phone && normalizePhoneDigits(String(reqPhone)) !== normalizePhoneDigits(String(cust.phone))) {
          return NextResponse.json({ error: 'The requested phone does not match the document customer' }, { status: 409 })
        }
        if (!custEmail) custEmail = str(cust.email)
        if (!custPhone) custPhone = str(cust.phone)
        smsOptedOut = cust.sms_opted_out === true
      }
    }

    const emailReady = Boolean(settings?.resend_api_key && settings?.from_email)
    const smsReady = Boolean(settings?.telnyx_api_key && settings?.telnyx_phone_number)
    const formatted = custPhone ? formatPhone(custPhone) : ''
    // If the "asked not to get texts" list cannot be read, nothing is texted: it is never assumed to be fine.
    let consentUnknown = false
    if (channel === 'sms' && formatted && !smsOptedOut) {
      try { smsOptedOut = await isSmsOptedOut(db, auth.shopId, formatted) } catch { consentUnknown = true }
    }
    const blocked = consentUnknown
      ? 'We could not check whether this customer asked not to get texts. Try again in a minute.'
      : sendBlockReason({ channel, status: str(doc.status), email: custEmail, phone: custPhone, emailReady, smsReady, optedOut: smsOptedOut })

    const shop = shopFromSettings(settings)
    const [{ prefs }, { options }] = await Promise.all([loadPrefs(db, auth.shopId), loadOptions(db, auth.shopId, documentId)])
    const live = await buildPublicDocument({ doc, options, prefs, shop, todayIso: todayInZone(shop.timezone) })
    const origin = originFor(req)

    // ── Preview: show it, send nothing, write nothing ─────────────────────────
    if (preview) {
      const placeholder = signUrl(origin, PREVIEW_LINK_WORD)
      const goodThrough = goodThroughWords(new Date(Date.now() + 30 * 86400000).toISOString(), shop.timezone)
      if (channel === 'email') {
        const built = buildSendEmail({ doc: live, shop, link: placeholder, logoUrl: null, pixelUrl: null, linkGoodThrough: goodThrough })
        return NextResponse.json({ preview: { channel, to: custEmail, subject: built.subject, text: built.text, html: built.html, blocked, total: live.totals.total } })
      }
      if (channel === 'sms') {
        return NextResponse.json({ preview: { channel, to: custPhone ? phonePretty(custPhone) : '', subject: '', text: buildSendText({ doc: live, shop, link: placeholder }), html: '', blocked, total: live.totals.total } })
      }
      return NextResponse.json({ preview: { channel, to: '', subject: '', text: '', html: '', blocked, total: live.totals.total } })
    }

    if (blocked) return NextResponse.json({ error: blocked }, { status: sendBlockStatus(blocked) })

    // ── The private link ──────────────────────────────────────────────────────
    const user = await getSessionUser().catch(() => null)
    const who = staffLabel(user)
    const sentTo = channel === 'email' ? custEmail : channel === 'sms' ? formatted : ''
    const made = await ensureLink(db, { shopId: auth.shopId, userId: auth.userId, doc, channel, sentTo, contentHash: live.contentHash })
    const link = signUrl(origin, made.token)
    const nowIso = new Date().toISOString()
    const docLabel = `${live.docType} ${live.docNumber}`

    if (channel === 'copy') {
      await logEvent(db, { shopId: auth.shopId, documentId, docNumber: live.docNumber, kind: 'link_created', actorName: who, summary: `${made.reused ? 'Copied' : 'Made'} the private link to ${docLabel}` })
      return NextResponse.json({ ok: true, link, linkKind: made.kind, status: str(doc.status), sentAt: '', expiresAt: made.expiresAt })
    }

    // A deliberate second send is a new attempt; a retry of the same attempt (same key) never sends twice.
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'send-document', documentId, channel, sentTo, String(doc.updated_at || '')])

    if (channel === 'email') {
      const built = buildSendEmail({
        doc: live, shop, link,
        logoUrl: made.kind === 'link' && shop.hasLogo ? logoUrl(origin, made.token) : null,
        pixelUrl: made.kind === 'link' ? pixelUrl(origin, made.token) : null,
        linkGoodThrough: goodThroughWords(made.expiresAt, shop.timezone),
      })
      const headers = new Headers(req.headers)
      headers.set('Idempotency-Key', idempotencyKey)
      const result = await sendDurableEmail({
        request: new Request(req.url, { headers }),
        db,
        shopId: auth.shopId,
        userId: auth.userId,
        to: custEmail,
        subject: built.subject,
        html: built.html,
        messageBody: `${str(doc.type)} #${str(doc.doc_number)} sent`,
        fromAddress: String(settings?.from_email),
        replyTo: settings?.shop_email,
        apiKey: String(settings?.resend_api_key),
        documentId,
        customerId: doc.customer_id,
      })
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error, uncertain: result.uncertain === true }, { status: result.status })
    } else {
      const text = buildSendText({ doc: live, shop, link })
      const headers = new Headers(req.headers)
      headers.set('Idempotency-Key', idempotencyKey)
      const result = await sendDurableSms({
        request: new Request(req.url, { headers }),
        db,
        shopId: auth.shopId,
        userId: auth.userId,
        to: formatted,
        text,
        customerId: doc.customer_id,
        documentId,
        settings: {
          telnyx_api_key: String(settings?.telnyx_api_key),
          telnyx_phone_number: String(settings?.telnyx_phone_number),
          telnyx_messaging_profile_id: settings?.telnyx_messaging_profile_id || '',
        },
      })
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error, uncertain: result.uncertain === true }, { status: result.status })
      if (!result.messageRecordSaved) {
        return NextResponse.json({ ok: true, message_record_saved: false, link, linkKind: made.kind, status: str(doc.status), sentAt: nowIso, expiresAt: made.expiresAt, warning: 'The text was accepted, but its message record still needs repair. Retry this send; the provider will not be called again.' })
      }
    }

    const marked = await db.from('documents').update({ sent_at: nowIso }).eq('id', documentId).eq('shop_id', auth.shopId)
    await logEvent(db, {
      shopId: auth.shopId, documentId, docNumber: live.docNumber, kind: 'sent', actorName: who,
      summary: channel === 'email' ? `Emailed ${docLabel} to ${custEmail}` : `Texted ${docLabel} to ${phonePretty(custPhone)}`,
      detail: { channel, to: sentTo, linkKind: made.kind, reusedLink: made.reused },
    })
    if (marked.error) {
      return NextResponse.json({ ok: true, document_marked_sent: false, link, linkKind: made.kind, status: str(doc.status), sentAt: nowIso, expiresAt: made.expiresAt, warning: 'Sent, but the document could not be marked as sent. Retry this send; the customer will not get it twice.' })
    }
    return NextResponse.json({ ok: true, link, linkKind: made.kind, status: str(doc.status), sentAt: nowIso, expiresAt: made.expiresAt })
  } catch (e: unknown) {
    console.error('[send-document] failed:', e instanceof Error ? e.message : e)
    const known = e instanceof Error && /^Could not (make|look up|refresh) the/.test(e.message)
    return NextResponse.json({ error: known ? (e as Error).message : 'Something went wrong, and nothing was sent. Try again.' }, { status: 500 })
  }
}
