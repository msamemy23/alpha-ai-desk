import { createHmac, timingSafeEqual } from 'node:crypto'

const VOICE_STATE_TTL_MS = 24 * 60 * 60 * 1000

function getSecret(): string {
  return process.env.VOICE_STATE_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function createVoiceClientState(input: Record<string, unknown>): string {
  if (!getSecret()) throw new Error('VOICE_STATE_SECRET is not configured')
  const payload = Buffer.from(JSON.stringify({
    ...input,
    expiresAt: Date.now() + VOICE_STATE_TTL_MS,
  })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyVoiceClientState(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value || !getSecret()) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = sign(payload)
  try {
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null
    if (typeof parsed.shopId !== 'string' || !parsed.shopId) return null
    return parsed
  } catch {
    return null
  }
}
