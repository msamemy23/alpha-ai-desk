import { NextRequest, NextResponse } from 'next/server'
import { getConnector } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body

  const connector = await getConnector('facebook')
  if (!connector?.enabled) return fail('Facebook not connected', 401)

  const { page_id, page_access_token } = connector
  if (!page_id || !page_access_token) return fail('Facebook page token missing — please reconnect', 401)

  const token = page_access_token
  const FB = 'https://graph.facebook.com/v21.0'

  try {
    switch (action) {

      // ── Post to page ─────────────────────────────────────────────
      case 'post': {
        const { message, link, photo_url } = body as { message?: string; link?: string; photo_url?: string }
        if (!message && !photo_url) return fail('message or photo_url required')

        let result
        if (photo_url) {
          // Photo post
          const r = await fetch(`${FB}/${page_id}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: photo_url, caption: message || '', access_token: token }),
          })
          result = await r.json()
        } else {
          // Text post
          const postBody: Record<string, string> = { message: message!, access_token: token }
          if (link) postBody.link = link
          const r = await fetch(`${FB}/${page_id}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postBody),
          })
          result = await r.json()
        }
        return ok(result)
      }

      // ── Get recent posts ─────────────────────────────────────────
      case 'get_posts': {
        const r = await fetch(
          `${FB}/${page_id}/posts?fields=message,created_time,likes.summary(true),comments.summary(true)&limit=10&access_token=${token}`
        )
        const data = await r.json()
        return ok(data)
      }

      // ── Get comments on a post ───────────────────────────────────
      case 'get_comments': {
        const { post_id } = body as { post_id: string }
        if (!post_id) return fail('post_id required')
        const r = await fetch(
          `${FB}/${post_id}/comments?fields=message,from,created_time&access_token=${token}`
        )
        return ok(await r.json())
      }

      // ── Reply to a comment ───────────────────────────────────────
      case 'reply_comment': {
        const { comment_id, message } = body as { comment_id: string; message: string }
        if (!comment_id || !message) return fail('comment_id and message required')
        const r = await fetch(`${FB}/${comment_id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: token }),
        })
        return ok(await r.json())
      }

      // ── Get page messages ────────────────────────────────────────
      case 'get_messages': {
        const r = await fetch(
          `${FB}/${page_id}/conversations?fields=messages{message,from,created_time}&limit=10&access_token=${token}`
        )
        return ok(await r.json())
      }

      // ── Send a message ───────────────────────────────────────────
      case 'send_message': {
        const { recipient_id, message } = body as { recipient_id: string; message: string }
        if (!recipient_id || !message) return fail('recipient_id and message required')
        const r = await fetch(`${FB}/${page_id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
            access_token: token,
          }),
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
