export const dynamic = 'force-dynamic'
import { authed, fail, isUuid } from '@/lib/receptionist-api'
import { readMedia } from '@/lib/voice/media-store'

/** A picture or video from a text, for signed-in staff. The bytes are stored here or fetched from the carrier's own storage. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const { id } = await ctx.params
  if (!isUuid(id)) return fail('Not found.', 404)
  const media = await readMedia(db, auth.shopId, id, (url, init) => fetch(url, init))
  if (!media) return fail('This picture is no longer available.', 404)
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      'Content-Type': media.contentType,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
