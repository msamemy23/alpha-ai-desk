/**
 * The link the phone carrier fetches to deliver a picture or video the shop attached to a text.
 * It works only with the random token that was made for that one attachment, so a guessed address returns nothing.
 */
export const dynamic = 'force-dynamic'
import { getServiceClient } from '@/lib/supabase'
import { isMediaType } from '@/lib/voice/media'
import { readByToken } from '@/lib/voice/media-store'

const NOT_FOUND = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const token = new URL(req.url).searchParams.get('t') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{40,64}$/.test(token)) return NOT_FOUND()
  const media = await readByToken(getServiceClient(), id, token)
  if (!media || !isMediaType(media.contentType)) return NOT_FOUND()
  return new Response(new Uint8Array(media.bytes), {
    headers: { 'Content-Type': media.contentType, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' },
  })
}
