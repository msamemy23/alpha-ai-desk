// Rules for contacting a lead: a person or business that has NOT asked to hear from the shop.
// Pure, so the same checks run on the server before every outreach and in tests.
//
// What the rules come from, in plain words (not legal advice; the owner should confirm with counsel):
//  - Email to a business or a person is allowed if it is honest, names the sender, shows a mailing address and has a
//    working unsubscribe that is honoured (CAN-SPAM).
//  - Texts and phone calls to someone who never asked to hear from the shop need that person's written permission
//    (TCPA), so Alpha does not text or auto-call leads it found on the web.
//  - Never contact someone who has said "stop" or is marked not interested.
//  - Never contact outside calling hours in the lead's own time zone.

import { earliestSend, hasUsablePhone, looksLikeEmail, normalizeRules, timezoneForPhone, validTimezone, windowFromRules, type ShopRules } from './automation-rules.ts'

export type LeadChannel = 'sms' | 'email' | 'ai_call'

/** Where a lead came from when Alpha or an import found it, as opposed to the person getting in touch themselves. */
const FOUND_SOURCES = new Set(['ai-competitor-scan', 'ai-social-scan', 'ai-fleet-scan', 'scan', 'import', 'apollo', 'directory'])

export function isFoundLead(lead: Record<string, unknown>): boolean {
  const source = String(lead.source ?? '').trim().toLowerCase()
  return FOUND_SOURCES.has(source) || source.startsWith('ai-') || source.endsWith('-scan')
}

const STOPPED_STATUSES = new Set(['not_interested', 'do_not_contact', 'unsubscribed', 'converted', 'lost'])

export interface LeadShop {
  name: string
  address: string
  timeZone: string
  rules?: Partial<ShopRules> | null
}

export interface LeadCheck {
  ok: boolean
  /** HTTP status the route should answer with when not ok. */
  status: number
  /** One plain sentence for the owner. Empty when ok. */
  reason: string
  /** Short code for the history and for tests. */
  code: '' | 'stopped' | 'opted_out' | 'no_contact' | 'needs_permission' | 'no_address' | 'no_name' | 'quiet_hours'
  /** For quiet hours: the earliest time the contact is allowed. */
  retryAt?: Date
}

const ok = (): LeadCheck => ({ ok: true, status: 200, reason: '', code: '' })
const no = (code: LeadCheck['code'], reason: string, status = 409, retryAt?: Date): LeadCheck => ({ ok: false, status, reason, code, retryAt })

/**
 * Can this lead be contacted this way right now?
 * `emailOptedOut` and `smsOptedOut` come from the consent tables, looked up on the server by the caller.
 */
export function leadOutreachCheck(input: {
  lead: Record<string, unknown>
  channel: LeadChannel
  shop: LeadShop
  now?: Date
  emailOptedOut?: boolean
  smsOptedOut?: boolean
}): LeadCheck {
  const { lead, channel, shop } = input
  const now = input.now ?? new Date()
  if (STOPPED_STATUSES.has(String(lead.status ?? '').toLowerCase())) {
    return no('stopped', 'This lead is marked as not interested or already a customer, so nothing was sent.')
  }
  if (channel === 'email') {
    if (!looksLikeEmail(lead.email)) return no('no_contact', 'This lead has no email address.', 400)
    if (input.emailOptedOut) return no('opted_out', 'This address unsubscribed from your emails, so nothing was sent.')
    if (!shop.name.trim()) return no('no_name', 'Add your shop name in Settings first. Every email has to say who it is from.', 422)
    if (!shop.address.trim()) return no('no_address', 'Add your shop address in Settings first. The law requires a mailing address on every marketing email.', 422)
    return ok()
  }
  if (!hasUsablePhone(lead.phone)) return no('no_contact', 'This lead has no phone number.', 400)
  if (input.smsOptedOut) return no('opted_out', 'This number has opted out of texts and calls, so nothing was sent.')
  if (isFoundLead(lead)) {
    return no('needs_permission', channel === 'sms'
      ? 'Alpha found this lead on the web. Texting someone who has not asked to hear from you needs their written permission, so use email, or call them yourself if they are a business.'
      : 'Alpha found this lead on the web. An automated call to someone who has not asked to hear from you needs their written permission, so use email, or call them yourself if they are a business.')
  }
  const rules = normalizeRules(shop.rules)
  const earliest = earliestSend(now, validTimezone(shop.timeZone), lead.phone, windowFromRules(rules))
  if (earliest.getTime() - now.getTime() > 60_000) {
    const zone = timezoneForPhone(lead.phone) || validTimezone(shop.timeZone)
    const when = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(earliest)
    return no('quiet_hours', `It is outside calling hours for this lead, so nothing was sent. The earliest is ${when} their time.`, 409, earliest)
  }
  return ok()
}

/** An honest, plain subject line. CAN-SPAM forbids subjects that mislead, such as a fake "Re:" or "Fwd:". Empty when fine. */
export function subjectProblem(subject: unknown): string {
  const s = String(subject ?? '').trim()
  if (!s) return ''
  if (s.length > 150) return 'Keep the subject under 150 characters.'
  if (/^(re|fwd?)\s*:/i.test(s)) return 'A subject that starts with "Re:" or "Fwd:" pretends this is a reply, which the law does not allow.'
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(s)) return 'Remove the emoji from the subject.'
  if (/[\r\n]/.test(s)) return 'The subject has to be a single line.'
  return ''
}
