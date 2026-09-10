import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getConnector } from '@/lib/connectors'

export const dynamic = 'force-dynamic'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

const FB = 'https://graph.facebook.com/v21.0'

// Post to a single target (page or profile feed)
async function fbPost(
  targetId: string,
  token: string,
  message: string,
  link?: string,
  photoUrl?: string
) {
  if (photoUrl) {
    const r = await fetch(`${FB}/${targetId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: photoUrl, caption: message || '', access_token: token }),
    })
    return r.json()
  }
  const postBody: Record<string, string> = { message, access_token: token }
  if (link) postBody.link = link
  const r = await fetch(`${FB}/${targetId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postBody),
  })
  return r.json()
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const aiSource = req.headers.get('x-ai-source') === 'ai'
  const approval = req.headers.get('x-ai-approval') === 'confirm'
  if (aiSource && ['post', 'reply_comment', 'send_message'].includes(String(action)) && !approval) {
    return fail('This connector action requires explicit approval', 409)
  }

  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const connector = await getConnector('facebook')
  if (!connector?.enabled) return fail('Facebook not connected', 401)

  const { page_id, page_access_token, access_token } = connector as {
    page_id: string | null
    page_access_token: string | null
    access_token: string | null
    metadata?: Record<string, unknown> | null
  }
  const connectorMetadata = (connector as { metadata?: Record<string, unknown> | null }).metadata || {}
  const pageLabel = typeof connectorMetadata.page_name === 'string' && connectorMetadata.page_name.trim()
    ? connectorMetadata.page_name.trim()
    : 'Facebook page'
  const profileLabel = typeof connectorMetadata.profile_name === 'string' && connectorMetadata.profile_name.trim()
    ? connectorMetadata.profile_name.trim()
    : 'Facebook profile'

  if (!page_id || !page_access_token) return fail('Facebook page token missing — please reconnect', 401)

  const FB_BASE = FB

  try {
    switch (action) {

      // ── Post with target selection ─────────────────────────────────────────
      case 'post': {
        const { message, link, photo_url, target } = body as {
          message?: string
          link?: string
          photo_url?: string
          // target: 'page' | 'profile' | 'both' (default: 'both')
          target?: string
        }
        if (!message && !photo_url) return fail('message or photo_url required')
        const msg = (message || '') as string
        const postTarget = target || 'both'
        const results: Record<string, unknown> = {}

        // Post to the connected Facebook page
        if (postTarget === 'page' || postTarget === 'both') {
          results.page = await fbPost(page_id, page_access_token, msg, link, photo_url as string | undefined)
          results.page_name = pageLabel
        }

        // Post to the connected personal profile
        if ((postTarget === 'profile' || postTarget === 'both') && access_token) {
          try {
            results.profile = await fbPost('me', access_token, msg, link, photo_url as string | undefined)
            results.profile_name = profileLabel
          } catch (e) {
            results.profile_error = e instanceof Error ? e.message : String(e)
          }
        }

        // Build a human-readable summary
        const posted: string[] = []
        if (results.page && !(results.page as Record<string,unknown>).error) posted.push(`${pageLabel} page`)
        if (results.profile && !(results.profile as Record<string,unknown>).error) posted.push(`${profileLabel} profile`)
        results.summary = posted.length
          ? `Posted to: ${posted.join(' and ')}`
          : 'No post was confirmed by Facebook'
        results.success = posted.length > 0
        if (posted.length === 0) return fail(JSON.stringify({ summary: results.summary, page: results.page, profile: results.profile, profile_error: results.profile_error }), 502)
        return ok(results)
      }

      // ── Get recent posts ────────────────────────────────────────────────
      case 'get_posts': {
        const r = await fetch(
          `${FB_BASE}/${page_id}/posts?fields=message,created_time,likes.summary(true),comments.summary(true)&limit=10&access_token=${page_access_token}`
        )
        const data = await r.json()
        if (!r.ok) return fail(data?.error?.message || data?.error || `Facebook returned ${r.status}`, r.status)
        return ok(data)
      }

      // ── Get comments on a post ──────────────────────────────────────
      case 'get_comments': {
        const { post_id } = body as { post_id: string }
        if (!post_id) return fail('post_id required')
        const r = await fetch(
          `${FB_BASE}/${post_id}/comments?fields=message,from,created_time&access_token=${page_access_token}`
        )
        const data = await r.json()
        if (!r.ok) return fail(data?.error?.message || data?.error || `Facebook returned ${r.status}`, r.status)
        return ok(data)
      }

      // ── Reply to a comment ────────────────────────────────────────────
      case 'reply_comment': {
        const { comment_id, message } = body as { comment_id: string; message: string }
        if (!comment_id || !message) return fail('comment_id and message required')
        const r = await fetch(`${FB_BASE}/${comment_id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: page_access_token }),
        })
        return ok(await r.json())
      }

      // ── Get page messages ──────────────────────────────────────────────
      case 'get_messages': {
        const r = await fetch(
          `${FB_BASE}/${page_id}/conversations?fields=messages{message,from,created_time}&limit=10&access_token=${page_access_token}`
        )
        return ok(await r.json())
      }

      // ── Send a message ───────────────────────────────────────────────────
      case 'send_message': {
        const { recipient_id, message } = body as { recipient_id: string; message: string }
        if (!recipient_id || !message) return fail('recipient_id and message required')
        const r = await fetch(`${FB_BASE}/${page_id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
            access_token: page_access_token,
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
