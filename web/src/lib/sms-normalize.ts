// Pure, dependency-free helpers for inbound and outbound SMS matching.

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

/** Normalizes a phone-gateway webhook body into a common shape. */
export function normalizeInbound(body: Record<string, unknown>): { from: string; text: string; messageId: string; toNumber: string } {
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
  const toNumber = pick(body,
    'to', 'recipient', 'destination', 'toNumber', 'recipientNumber',
    'data.to', 'data.recipient', 'data.destination',
    'payload.to', 'payload.recipient')
  return { from, text, messageId, toNumber }
}

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'])

/** True when a customer's text is an SMS opt-out (STOP, UNSUBSCRIBE, …). */
export function isOptOut(text: string): boolean {
  const cmd = (text || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  return OPT_OUT_KEYWORDS.has(cmd)
}

/** Returns a stable comparison value for formatted or E.164 US phone values. */
export function normalizePhoneDigits(value: unknown): string {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : ''
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}
