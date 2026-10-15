export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { isLinkToken } from '@/lib/doc-links'
import { resolveToken } from '@/lib/doc-links-server'

// A one-pixel picture in the email. When the email program loads it, the shop sees that the email was opened.
// It is only a hint: some mail programs load every picture ahead of time, and some block pictures. The answer
// is always the same picture, no address is stored, and a bad link changes nothing.

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

const pixel = () => new Response(new Uint8Array(GIF), {
  headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0', 'content-length': String(GIF.length) },
})

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('t')
    if (!isLinkToken(token)) return pixel()
    if (!checkRateLimit(`sign:pixel:${token}`, 6, 60_000).ok) return pixel()
    const db = getServiceClient()
    const resolved = await resolveToken(db, token)
    if (!resolved || resolved.kind !== 'link') return pixel()
    const link = resolved.link
    const now = new Date().toISOString()
    await db.from('document_links').update({
      email_opened_at: link.email_opened_at || now,
      email_open_count: (link.email_open_count || 0) + 1,
    }).eq('id', link.id).eq('shop_id', link.shop_id)
  } catch {
    // The picture is the answer either way.
  }
  return pixel()
}
