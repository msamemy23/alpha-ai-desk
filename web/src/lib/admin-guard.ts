import { NextRequest } from 'next/server'
import crypto from 'crypto'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Gate for admin/setup endpoints (migrate, seed-*).
 * Returns null when the caller is authorized; otherwise returns a Response to
 * send back. Disabled entirely (404) unless ADMIN_SECRET is configured, so
 * these endpoints are off by default in production. Pass the secret in the
 * `x-admin-secret` request header.
 */
export function requireAdmin(req: NextRequest): Response | null {
  const secret = process.env.ADMIN_SECRET
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  const provided = req.headers.get('x-admin-secret') || ''
  if (!safeEqual(provided, secret)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  return null
}
