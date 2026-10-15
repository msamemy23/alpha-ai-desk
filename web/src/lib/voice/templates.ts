/**
 * Saved text replies ("templates"). Plain text with a few blanks that fill in when used:
 *   {name} the customer's first name   {shop} the shop's name   {phone} the shop's phone number
 * Starter wording is generic: it names no shop and promises no price or time.
 */
export interface Template { id: string; title: string; body: string }

export const STARTER_TEMPLATES: { title: string; body: string }[] = [
  { title: 'Vehicle is ready', body: 'Hi {name}, your vehicle is ready for pickup at {shop}. Call us at {phone} if you have any questions.' },
  { title: 'We got your message', body: 'Hi {name}, thanks for reaching out to {shop}. We got your message and will get back to you shortly.' },
  { title: 'Need a bit more time', body: 'Hi {name}, we need a little more time on your vehicle. We will update you as soon as we know more.' },
  { title: 'Estimate is ready', body: 'Hi {name}, your estimate from {shop} is ready. Please look it over and let us know if you have questions or would like to go ahead.' },
  { title: 'Appointment reminder', body: 'Hi {name}, a reminder about your appointment with {shop}. Reply here or call {phone} if you need to change it.' },
  { title: 'Please call us', body: 'Hi {name}, could you give {shop} a call at {phone} when you get a chance? Thank you.' },
]

/** Fills in the blanks. Unknown blanks are left out rather than shown as braces. */
export function fillTemplate(body: string, vals: { name?: string; shop?: string; phone?: string }): string {
  const first = String(vals.name || '').trim().split(/\s+/)[0] || ''
  const out = String(body || '')
    .replace(/\{name\}/g, first)
    .replace(/\{shop\}/g, String(vals.shop || '').trim() || 'our shop')
    .replace(/\{phone\}/g, String(vals.phone || '').trim() || 'us')
  // "Hi , your ..." becomes "Hi, your ..." when there is no name.
  return out.replace(/\s+,/g, ',').replace(/[ \t]{2,}/g, ' ').trim()
}

export function cleanTemplate(input: { title?: unknown; body?: unknown }): { ok: true; title: string; body: string } | { ok: false; error: string } {
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim()
  const body = String(input.body ?? '').replace(/\r\n/g, '\n').trim()
  if (!title) return { ok: false, error: 'Give the reply a short name.' }
  if (title.length > 60) return { ok: false, error: 'The name can be up to 60 letters.' }
  if (!body) return { ok: false, error: 'Write what the text should say.' }
  if (body.length > 1000) return { ok: false, error: 'A text can be up to 1,000 letters.' }
  return { ok: true, title, body }
}

/** A ready-made confirmation for a booking a person just approved. The person reads it, then sends it from the Inbox. */
export function bookingConfirmation(a: { name?: string; shop?: string; slotLabel: string }): string {
  const first = String(a.name || '').trim().split(/\s+/)[0]
  const shop = String(a.shop || '').trim() || 'our shop'
  return `${first ? `Hi ${first}, you` : 'Hi, you'} are booked with ${shop} for ${a.slotLabel}. Reply here if you need to change it.`
}
