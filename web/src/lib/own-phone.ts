// Texting from the owner's own phone.
//
// Alpha cannot send from an iPhone's own number: Apple has no web client and no public way to send a text for you, and Google
// Messages for web only pairs with an Android phone. What does work on every phone is a link that opens the phone's own Messages
// app with the customer's number and the words already in, so the owner reads it and presses Send there.
// Alpha sends nothing and cannot see whether it was sent. Pure, so tests can run it.

export type Platform = 'ios' | 'android' | 'mac' | 'other'

/** Which kind of device this is, from what the browser says about itself. An iPad can report itself as a Mac with a touch screen. */
export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = String(userAgent || '')
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/i.test(ua)) return maxTouchPoints > 1 ? 'ios' : 'mac'
  return 'other'
}

/** Windows and Linux computers have no Messages app to open; there the owner copies the text or opens Alpha on a phone. */
export const canOpenMessages = (p: Platform): boolean => p !== 'other'

/** +17135550142 from any way of writing a number, or '' when it is not a full number. */
export function dialNumber(raw: unknown): string {
  const text = String(raw ?? '').trim()
  const digits = text.replace(/\D/g, '')
  if (text.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return ''
}

/** A text longer than this is cut: phones and links both get unreliable with very long messages. */
export const BODY_MAX = 1000

/**
 * The link that opens Messages with the number and the words filled in. iPhone and Mac join the words with "&", Android with "?".
 * An iPhone does not promise to fill in the words from a link, so the screen also offers to copy the text.
 */
export function smsHref(phone: unknown, body: unknown, platform: Platform): string {
  const to = dialNumber(phone)
  if (!to) return ''
  const text = String(body ?? '').trim().slice(0, BODY_MAX)
  if (!text) return `sms:${to}`
  const glue = platform === 'android' || platform === 'other' ? '?' : '&'
  return `sms:${to}${glue}body=${encodeURIComponent(text)}`
}

/** What the owner is told, in the places that offer this. It never claims more than it can see. */
export const OWN_PHONE_NOTE =
  'It goes out from your own phone number, not the shop number, and replies come to your phone, not to the Inbox. Alpha does not send it and cannot see whether you did.'

/** The same, for a computer that cannot open Messages. */
export const NO_MESSAGES_NOTE = 'This computer has no Messages app to open. Copy the text, or open Alpha on your phone and press the button there.'
