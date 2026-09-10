import { createHmac, timingSafeEqual } from 'node:crypto'

type OAuthState = {
  provider: 'google' | 'facebook'
  shopId: string
  expiresAt: number
}

function stateSecret(): string {
  return process.env.OAUTH_STATE_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET_V2 ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    ''
}

function sign(value: string): string {
  return createHmac('sha256', stateSecret()).update(value).digest('base64url')
}

export function createOAuthState(provider: OAuthState['provider'], shopId: string): string {
  if (!stateSecret()) throw new Error('OAuth state secret is not configured')
  const payload = Buffer.from(JSON.stringify({
    provider,
    shopId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyOAuthState(value: string | null, provider: OAuthState['provider'], shopId: string): boolean {
  if (!value || !stateSecret()) return false
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return false
  const expected = sign(payload)
  try {
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<OAuthState>
    return parsed.provider === provider &&
      parsed.shopId === shopId &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > Date.now()
  } catch {
    return false
  }
}
