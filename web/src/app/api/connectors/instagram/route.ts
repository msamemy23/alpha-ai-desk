import { NextRequest, NextResponse } from 'next/server'
import { getConnector } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body

  const connector = await getConnector('instagram')
  if (!connector?.enabled) return fail('Instagram not connected', 401)

  const igId = connector.page_id  // Instagram Business Account ID
  const token = connector.access_token || connector.page_access_token
  if (!igId || !token) return fail('Instagram account not configured — please reconnect Facebook/Instagram', 401)

  const FB = 'https://graph.facebook.com/v21.0'

  try {
    switch (action) {

      // ── Create a post ────────────────────────────────────────────
      case 'post': {
        const { image_url, caption } = body as { image_url: string; caption?: string }
        if (!image_url) return fail('image_url required for Instagram post')

        // Step 1: Create media container
        const createRes = await fetch(`${FB}/${igId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url, caption: caption || '', access_token: token }),
        })
        const createData = await createRes.json()
        if (!createData.id) return fail(`Media creation failed: ${JSON.stringify(createData)}`)

        // Step 2: Publish the media
        const publishRes = await fetch(`${FB}/${igId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: createData.id, access_token: token }),
        })
        return ok(await publishRes.json())
      }

      // ── Get recent posts ─────────────────────────────────────────
      case 'get_posts': {
        const r = await fetch(
          `${FB}/${igId}/media?fields=caption,media_url,timestamp,like_count,comments_count&access_token=${token}`
        )
        return ok(await r.json())
      }

      // ── Get comments on a media ──────────────────────────────────
      case 'get_comments': {
        const { media_id } = body as { media_id: string }
        if (!media_id) return fail('media_id required')
        const r = await fetch(
          `${FB}/${media_id}/comments?fields=text,username,timestamp&access_token=${token}`
        )
        return ok(await r.json())
      }

      // ── Reply to a comment ───────────────────────────────────────
      case 'reply_comment': {
        const { comment_id, message } = body as { comment_id: string; message: string }
        if (!comment_id || !message) return fail('comment_id and message required')
        const r = await fetch(`${FB}/${comment_id}/replies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: token }),
        })
        return ok(await r.json())
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
