import crypto from 'crypto'

function loadPublicKey(value: string) {
  const trimmed = value.trim()
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return crypto.createPublicKey(trimmed)
  }

  const keyBytes = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')

  if (keyBytes.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        keyBytes,
      ]),
      format: 'der',
      type: 'spki',
    })
  }

  return crypto.createPublicKey({
    key: keyBytes,
    format: 'der',
    type: 'spki',
  })
}

/**
 * Verifies a Telnyx webhook signature (Ed25519 over `${timestamp}|${rawBody}`).
 * Production must fail closed: without TELNYX_PUBLIC_KEY, forged requests are
 * indistinguishable from real inbound traffic.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string | null,
  timestamp: string | null,
): boolean {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY
  if (!publicKeyB64) {
    console.error('[telnyx] TELNYX_PUBLIC_KEY not set; rejecting webhook')
    return false
  }
  if (!signatureB64 || !timestamp) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false

  try {
    const signed = Buffer.from(`${timestamp}|${rawBody}`)
    const signature = Buffer.from(signatureB64, 'base64')
    const publicKey = loadPublicKey(publicKeyB64)
    return crypto.verify(null, signed, publicKey, signature)
  } catch (e) {
    console.error('[telnyx] signature verification error:', e)
    return false
  }
}
