import { createHmac, timingSafeEqual } from 'node:crypto'

const VOICE_STATE_TTL_MS = 24 * 60 * 60 * 1000

function getSecrets(): string[] {
  const all = [process.env.VOICE_STATE_SECRET, process.env.INTERNAL_API_SECRET, process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY]
  return all.filter((v): v is string => typeof v === 'string' && v.length > 0).filter((v, i, a) => a.indexOf(v) === i)
}

function getSecret(): string {
  return getSecrets()[0] || ''
}

function signWith(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function sign(payload: string): string {
  return signWith(getSecret(), payload)
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
  // Calls already in progress keep working when a new secret is added: any configured secret is accepted.
  const matches = getSecrets().some(key => {
    const expected = signWith(key, payload)
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  })
  try {
    if (!matches) return null
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null
    if (typeof parsed.shopId !== 'string' || !parsed.shopId) return null
    return parsed
  } catch {
    return null
  }
}
