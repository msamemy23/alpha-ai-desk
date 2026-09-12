import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

function key() {
  const secret = process.env.ALPHA_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || secret.length < 32) throw new Error('Connection encryption is not configured')
  // Domain separation prevents reuse of the database credential as an AES key.
  return Buffer.from(hkdfSync('sha256', secret, 'alpha-private-state-v1', 'aes-256-gcm', 32))
}

export function sealPrivateState(value: unknown, owner: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(owner))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function openPrivateState<T>(value: string, owner: string): T {
  const [version, iv, tag, encrypted, extra] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted || extra) throw new Error('Invalid encrypted connection')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(owner))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')) as T
}
