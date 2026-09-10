import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getConnector } from '@/lib/connectors'
import { finishSocialPublishingOperation, startSocialPublishingOperation } from '@/lib/social-operation'

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
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, data }
  }
  const postBody: Record<string, string> = { message, access_token: token }
  if (link) postBody.link = link
  const r = await fetch(`${FB}/${targetId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(postBody),
  })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
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
  if (auth.role === 'viewer' && ['post', 'reply_comment', 'send_message'].includes(String(action))) return forbidden()

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
  let socialOperationId: string | null = null
  const beginSocialOperation = async (operation: string) => {
    const started = await startSocialPublishingOperation({
      request: req,
      body,
      shopId: auth.shopId,
      userId: auth.userId,
      platform: 'facebook',
      action: operation,
    })
    if (started.state === 'claimed') {
      socialOperationId = started.id
      return null
    }
    if (started.state === 'replay') return NextResponse.json({ ok: true, data: started.result, replayed: true })
    return fail(started.error, started.status)
  }
  const finishSocialOperation = async (
    status: 'succeeded' | 'failed' | 'unknown',
    result?: unknown,
    error?: string,
    statusCode = 502,
  ) => {
    if (!socialOperationId) return fail('Publishing operation was not initialized', 500)
    const saved = await finishSocialPublishingOperation(socialOperationId, status, result, error)
    if (!saved.ok) return fail('The external action outcome is uncertain because its durable status could not be saved', 502)
    if (status === 'succeeded') return ok(result)
    return fail(error || 'Facebook did not confirm the requested action', statusCode)
  }

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
        const blocked = await beginSocialOperation('post')
        if (blocked) return blocked
        const msg = (message || '') as string
        const postTarget = target || 'both'
        if (!['page', 'profile', 'both'].includes(postTarget)) return finishSocialOperation('failed', undefined, 'target must be page, profile, or both', 400)
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
        } else if (postTarget === 'profile' || postTarget === 'both') {
          results.profile_error = 'Facebook profile token is missing; the requested target was not confirmed'
        }

        // Build a human-readable summary
        const posted: string[] = []
        const confirmed = (value: unknown) => {
          if (!value || typeof value !== 'object') return false
          const result = value as { ok?: boolean; data?: Record<string, unknown> }
          return result.ok === true && Boolean(result.data?.id || result.data?.post_id)
        }
        if (confirmed(results.page)) posted.push(`${pageLabel} page`)
        if (confirmed(results.profile)) posted.push(`${profileLabel} profile`)
        results.summary = posted.length
          ? `Posted to: ${posted.join(' and ')}`
          : 'No post was confirmed by Facebook'
        const requiredTargets = postTarget === 'both' ? 2 : 1
        results.success = posted.length === requiredTargets
        if (!results.success) {
          // A partial `both` publish is not a normal retryable failure: one
          // target may already contain the post. Keep it uncertain so a new
          // key cannot blindly duplicate the confirmed target.
          const partialCompletion = posted.length > 0 && posted.length < requiredTargets
          return finishSocialOperation(partialCompletion ? 'unknown' : 'failed', results, JSON.stringify({
            summary: results.summary,
            requiredTargets,
            page: results.page,
            profile: results.profile,
            profile_error: results.profile_error,
          }))
        }
        return finishSocialOperation('succeeded', results)
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
        const blocked = await beginSocialOperation('reply_comment')
        if (blocked) return blocked
        const r = await fetch(`${FB_BASE}/${comment_id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: page_access_token }),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error || !data?.id) {
          return finishSocialOperation('failed', data, data?.error?.message || data?.error || `Facebook returned ${r.status}`, r.ok ? 502 : r.status)
        }
        return finishSocialOperation('succeeded', data)
      }

      // ── Get page messages ──────────────────────────────────────────────
      case 'get_messages': {
        const r = await fetch(
          `${FB_BASE}/${page_id}/conversations?fields=messages{message,from,created_time}&limit=10&access_token=${page_access_token}`
        )
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error) return fail(data?.error?.message || data?.error || `Facebook returned ${r.status}`, r.ok ? 502 : r.status)
        return ok(data)
      }

      // ── Send a message ───────────────────────────────────────────────────
      case 'send_message': {
        const { recipient_id, message } = body as { recipient_id: string; message: string }
        if (!recipient_id || !message) return fail('recipient_id and message required')
        const blocked = await beginSocialOperation('send_message')
        if (blocked) return blocked
        const r = await fetch(`${FB_BASE}/${page_id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
            access_token: page_access_token,
          }),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error || !data?.message_id) {
          return finishSocialOperation('failed', data, data?.error?.message || data?.error || `Facebook returned ${r.status}`, r.ok ? 502 : r.status)
        }
        return finishSocialOperation('succeeded', data)
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err) {
    if (socialOperationId) {
      const message = err instanceof Error ? err.message : 'Facebook request failed before its outcome was confirmed'
      const saved = await finishSocialPublishingOperation(socialOperationId, 'unknown', undefined, message)
      if (!saved.ok) return fail('The external action outcome is uncertain because its durable status could not be saved', 502)
      return fail('Facebook request outcome is uncertain; reconcile the provider result before retrying', 502)
    }
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
