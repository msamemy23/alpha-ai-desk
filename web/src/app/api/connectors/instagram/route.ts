import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getConnector } from '@/lib/connectors'
import { finishSocialPublishingOperation, startSocialPublishingOperation } from '@/lib/social-operation'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const aiSource = req.headers.get('x-ai-source') === 'ai'
  const approval = req.headers.get('x-ai-approval') === 'confirm'
  if (aiSource && ['post', 'reply_comment'].includes(String(action)) && !approval) {
    return fail('This connector action requires explicit approval', 409)
  }

  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer' && ['post', 'reply_comment'].includes(String(action))) return forbidden()

  const connector = await getConnector('instagram')
  if (!connector?.enabled) return fail('Instagram not connected', 401)

  const igId = connector.page_id  // Instagram Business Account ID
  const token = connector.access_token || connector.page_access_token
  if (!igId || !token) return fail('Instagram account not configured — please reconnect Facebook/Instagram', 401)

  const FB = 'https://graph.facebook.com/v21.0'
  let socialOperationId: string | null = null
  const beginSocialOperation = async (operation: string) => {
    const started = await startSocialPublishingOperation({
      request: req,
      body,
      shopId: auth.shopId,
      userId: auth.userId,
      platform: 'instagram',
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
    return fail(error || 'Instagram did not confirm the requested action', statusCode)
  }

  try {
    switch (action) {

      // ── Create a post ────────────────────────────────────────────
      case 'post': {
        const { image_url, caption } = body as { image_url: string; caption?: string }
        if (!image_url) return fail('image_url required for Instagram post')
        const blocked = await beginSocialOperation('post')
        if (blocked) return blocked

        // Step 1: Create media container
        const createRes = await fetch(`${FB}/${igId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url, caption: caption || '', access_token: token }),
        })
        const createData = await createRes.json()
        if (!createRes.ok) {
          return finishSocialOperation('failed', createData, createData?.error?.message || createData?.error || `Instagram returned ${createRes.status}`, createRes.status)
        }
        if (!createData.id) return finishSocialOperation('failed', createData, `Media creation failed: ${JSON.stringify(createData)}`)

        // Step 2: Publish the media
        const publishRes = await fetch(`${FB}/${igId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: createData.id, access_token: token }),
        })
        const publishData = await publishRes.json()
        if (!publishRes.ok || !publishData?.id) {
          return finishSocialOperation('failed', publishData, publishData?.error?.message || publishData?.error || 'Instagram did not return a published media id', publishRes.ok ? 502 : publishRes.status)
        }
        return finishSocialOperation('succeeded', publishData)
      }

      // ── Get recent posts ─────────────────────────────────────────
      case 'get_posts': {
        const r = await fetch(
          `${FB}/${igId}/media?fields=caption,media_url,timestamp,like_count,comments_count&access_token=${token}`
        )
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error) return fail(data?.error?.message || data?.error || `Instagram returned ${r.status}`, r.ok ? 502 : r.status)
        return ok(data)
      }

      // ── Get comments on a media ──────────────────────────────────
      case 'get_comments': {
        const { media_id } = body as { media_id: string }
        if (!media_id) return fail('media_id required')
        const r = await fetch(
          `${FB}/${media_id}/comments?fields=text,username,timestamp&access_token=${token}`
        )
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error) return fail(data?.error?.message || data?.error || `Instagram returned ${r.status}`, r.ok ? 502 : r.status)
        return ok(data)
      }

      // ── Reply to a comment ───────────────────────────────────────
      case 'reply_comment': {
        const { comment_id, message } = body as { comment_id: string; message: string }
        if (!comment_id || !message) return fail('comment_id and message required')
        const blocked = await beginSocialOperation('reply_comment')
        if (blocked) return blocked
        const r = await fetch(`${FB}/${comment_id}/replies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, access_token: token }),
        })
        const data = await r.json().catch(() => ({}))
        if (!r.ok || data?.error || !data?.id) {
          return finishSocialOperation('failed', data, data?.error?.message || data?.error || `Instagram returned ${r.status}`, r.ok ? 502 : r.status)
        }
        return finishSocialOperation('succeeded', data)
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err) {
    if (socialOperationId) {
      const message = err instanceof Error ? err.message : 'Instagram request failed before its outcome was confirmed'
      const saved = await finishSocialPublishingOperation(socialOperationId, 'unknown', undefined, message)
      if (!saved.ok) return fail('The external action outcome is uncertain because its durable status could not be saved', 502)
      return fail('Instagram request outcome is uncertain; reconcile the provider result before retrying', 502)
    }
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
