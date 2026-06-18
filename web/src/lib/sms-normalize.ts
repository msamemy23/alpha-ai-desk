// Pure, dependency-free helpers for inbound SMS — kept separate so they can be
// unit-tested without Next.js or Supabase. Used by /api/sms-inbound.

/** Reads the first non-empty value at any of the given dot-paths. */
export function pick(obj: Record<string, unknown>, ...paths: string[]): string {
  for (const p of paths) {
    const v = p.split('.').reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    )
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}

/**
 * Normalizes an inbound webhook body from any phone SMS gateway
 * (TextBee / httpSMS / custom) into a common shape.
 */
export function normalizeInbound(body: Record<string, unknown>): { from: string; text: string; messageId: string } {
  const from = pick(body,
    'from', 'sender', 'phone', 'phoneNumber', 'sender_number',
    'data.from', 'data.sender', 'data.contact', 'data.phoneNumber',
    'payload.from', 'payload.sender', 'message.from')
  const text = pick(body,
    'message', 'text', 'content', 'body', 'sms',
    'data.message', 'data.text', 'data.content',
    'payload.text', 'payload.message', 'payload.body')
  const messageId = pick(body,
    'id', 'messageId', 'message_id', 'data.id', 'data.messageId', 'payload.id')
  return { from, text, messageId }
}

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'])

/** True when a customer's text is an SMS opt-out (STOP, UNSUBSCRIBE, …). */
export function isOptOut(text: string): boolean {
  const cmd = (text || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  return OPT_OUT_KEYWORDS.has(cmd)
}
