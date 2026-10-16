// Sending an estimate or invoice: the rules the send route and its preview share. Pure, so tests can run it.

export type SendChannel = 'email' | 'sms' | 'copy'

export function isSendChannel(v: unknown): v is SendChannel {
  return v === 'email' || v === 'sms' || v === 'copy'
}

export interface BlockInput {
  channel: SendChannel
  status: string
  email: string
  phone: string
  /** The shop has an email account and a from address saved. */
  emailReady: boolean
  /** The shop has a texting key and number saved. */
  smsReady: boolean
  /** The customer, or this number, asked not to get texts. */
  optedOut: boolean
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why this document cannot go out this way right now, in plain words, or an empty string when it can.
 * The preview shows it before anything is sent, and the send route refuses for the same reason, so the two never disagree.
 */
export function sendBlockReason(i: BlockInput): string {
  if (i.status === 'Void') return 'This document is void, so it cannot be sent.'
  if (i.channel === 'email') {
    if (!i.email) return 'There is no email address on file for this customer.'
    if (!EMAIL_SHAPE.test(i.email.trim())) return 'The email address on file does not look right.'
    if (!i.emailReady) return 'Email is not set up for this shop yet.'
  }
  if (i.channel === 'sms') {
    if (!i.phone) return 'There is no phone number on file for this customer.'
    if (i.optedOut) return 'This customer asked not to get texts.'
    if (!i.smsReady) return 'Texting is not set up for this shop yet.'
  }
  return ''
}

/** The status code the send route answers with for a block reason: 409 when the document or customer says no, 503 when the shop has not set it up, 400 when something is missing. */
export function sendBlockStatus(reason: string): number {
  if (!reason) return 200
  if (reason.includes('not set up') || reason.includes('could not check')) return 503
  if (reason.includes('void') || reason.includes('asked not to')) return 409
  return 400
}

/** "November 15, 2026" in the shop's own time zone. */
export function goodThroughWords(iso: string, zone = 'America/Chicago'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: zone })
  } catch {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }
}

/** The address shown in the preview in place of the real private link, which is only made when the shop sends. */
export const PREVIEW_LINK_WORD = 'your-private-link'
