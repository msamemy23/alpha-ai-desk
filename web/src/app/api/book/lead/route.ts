import { NextRequest } from 'next/server'
import { HONEYPOT, SLUG, sameOrigin } from '@/lib/booking'
import { verifyFormToken } from '@/lib/booking-token'
import { loadBySlug, loadShopInfo } from '@/lib/schedule-store'
import { nowIn } from '@/lib/schedule-capacity'
import { cleanQuote } from '@/lib/quote'
import { saveWebLead } from '@/lib/lead-capture'
import { getServiceClient } from '@/lib/supabase'
import { bookingSecret, fingerprint, ipOf, json, overLimit } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * A stranger asks the shop for a price without picking a time. The same doors as the booking request, shut the same way:
 *   1. the request must come from a page on this site; 2. a hidden field real people never fill must be empty;
 *   3. a signed, time-stamped token from the page (not too fast, not too old, only for this shop's page);
 *   4. a limit per visitor and per phone number, counted in the database; 5. every field is checked again here;
 *   6. no web addresses or markup in what they wrote; 7. one lead per phone number, and a ceiling on waiting requests.
 * Nothing is texted or emailed from here: sending to a number nobody has proved they own would let anyone make the shop text strangers.
 * The request lands on the Leads tab (source "Website") and the shop answers it from there. Replies never reveal anything about other leads.
 * Only shops that turned "ask for a price" on in their booking settings accept it.
 */
const BUSY = 'Requests are busy right now. Please call the shop.'
const THANKS = 'Thank you. The shop will call or text you back about your price.'

export async function POST(req: NextRequest) {
  if (!sameOrigin({ origin: req.headers.get('origin'), referer: req.headers.get('referer'), host: req.headers.get('host'), forwardedHost: req.headers.get('x-forwarded-host') })) {
    return json({ ok: false, error: 'This request could not be accepted. Please use the shop\'s page.' }, 403)
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ ok: false, error: 'Nothing was sent.' }, 400)
  const slug = String(body.slug || '').toLowerCase()
  if (!SLUG.test(slug)) return json({ ok: false, error: 'This page is not available.' }, 404)

  // A bot that fills every field fills this one too. It is told it worked, so it learns nothing.
  if (String(body[HONEYPOT] ?? '') !== '') return json({ ok: true, status: 'sent', message: THANKS })

  const ip = ipOf(req)
  if (await overLimit('book-lead', ip, 4, 60)) return json({ ok: false, error: 'Too many requests from your connection. Please call the shop.' }, 429)

  const secret = bookingSecret()
  if (!secret) return json({ ok: false, error: BUSY }, 503)
  const tok = verifyFormToken(body.token, slug, secret)
  if (!tok.ok) {
    if (tok.reason === 'too-fast') return json({ ok: false, error: 'That was very quick. Please check your details and send again.' }, 429)
    return json({ ok: false, error: 'This page has been open too long. Please reload it and try again.' }, 400)
  }

  const shop = await loadBySlug(slug)
  if (!shop || !shop.online.quotes) return json({ ok: false, error: 'This page is not available. Please call the shop.' }, 404)

  const parsed = cleanQuote(body)
  if (!parsed.ok) return json({ ok: false, field: parsed.field, error: parsed.error }, 400)
  const v = parsed.value

  if (await overLimit('lead-phone', v.phone, 3, 60)) return json({ ok: false, error: 'There are already requests for this number. The shop will be in touch.' }, 429)

  const info = await loadShopInfo(shop.shopId)
  const saved = await saveWebLead(getServiceClient(), shop.shopId, v, nowIn(info.timezone).ymd)
  if (!saved.ok) {
    if (saved.status === 'failed') console.error('[book-lead] save failed', fingerprint(ip))
    return json({ ok: false, error: BUSY }, saved.status === 'busy' ? 429 : 500)
  }
  return json({ ok: true, status: 'sent', message: THANKS })
}
