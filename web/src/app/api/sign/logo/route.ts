export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp, isLinkToken } from '@/lib/doc-links'
import { resolveToken } from '@/lib/doc-links-server'

// The shop's logo for a customer link, so emails and the review page can show it. The link's secret is the key,
// and only the logo is returned, never the rest of the shop's settings. Images only (no SVG, which can carry script).

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/

const none = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t')
  if (!isLinkToken(token)) return none()
  if (!checkRateLimit(`sign:logo:${clientIp(req.headers) || 'unknown'}`, 300, 60_000).ok) return new Response(null, { status: 429 })
  const db = getServiceClient()
  let resolved
  try { resolved = await resolveToken(db, token) } catch { return none() }
  if (!resolved) return none()
  const shopId = resolved.kind === 'link' ? resolved.link.shop_id : resolved.sig.shop_id
  if (!shopId) return none()

  const { data, error } = await db.from('settings').select('logo_data').eq('shop_id', shopId).maybeSingle()
  const logo = !error && data && typeof data.logo_data === 'string' ? data.logo_data : ''
  const match = DATA_URL.exec(logo)
  if (!match) return none()
  const type = match[1] === 'jpg' ? 'jpeg' : match[1]
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (bytes.length === 0 || bytes.length > 2_000_000) return none()
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': `image/${type}`, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' },
  })
}
