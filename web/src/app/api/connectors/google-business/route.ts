import { NextRequest, NextResponse } from 'next/server'
import { getConnector, getValidGoogleToken } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

const MY_BUSINESS = 'https://mybusiness.googleapis.com/v4'

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body

  const connector = await getConnector('google_business')
  if (!connector?.enabled) return fail('Google Business not connected', 401)

  let token: string
  try {
    token = await getValidGoogleToken(connector)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Token error', 401)
  }

  // Get account/location IDs from metadata or discover them
  let accountId = (connector.metadata?.account_id as string) || ''
  let locationId = (connector.metadata?.location_id as string) || ''

  // If we don't have them yet, try to discover
  if (!accountId || !locationId) {
    try {
      const accRes = await fetch(`${MY_BUSINESS}/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const accData = await accRes.json()
      const firstAccount = accData?.accounts?.[0]
      if (firstAccount) {
        accountId = firstAccount.name  // format: "accounts/123"
        // Get locations
        const locRes = await fetch(`${MY_BUSINESS}/${accountId}/locations`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        const locData = await locRes.json()
        const firstLocation = locData?.locations?.[0]
        if (firstLocation) {
          locationId = firstLocation.name  // format: "accounts/123/locations/456"
        }
      }
    } catch { /* will fail below if not set */ }
  }

  try {
    switch (action) {

      // ── Create a post ────────────────────────────────────────────
      case 'post': {
        const { summary, call_to_action } = body as {
          summary: string
          call_to_action?: { type: string; url: string }
        }
        if (!summary) return fail('summary required')
        if (!locationId) return fail('Google Business location not found — make sure your business is verified')

        const postBody: Record<string, unknown> = {
          languageCode: 'en-US',
          summary,
          topicType: 'STANDARD',
        }
        if (call_to_action) {
          postBody.callToAction = { actionType: call_to_action.type, url: call_to_action.url }
        }

        const r = await fetch(`${MY_BUSINESS}/${locationId}/localPosts`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        })
        return ok(await r.json())
      }

      // ── Get reviews ──────────────────────────────────────────────
      case 'get_reviews': {
        if (!locationId) return fail('Google Business location not found')
        const r = await fetch(`${MY_BUSINESS}/${locationId}/reviews`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        return ok(await r.json())
      }

      // ── Reply to a review ────────────────────────────────────────
      case 'reply_review': {
        const { review_id, reply } = body as { review_id: string; reply: string }
        if (!review_id || !reply) return fail('review_id and reply required')
        if (!locationId) return fail('Google Business location not found')

        const r = await fetch(`${MY_BUSINESS}/${locationId}/reviews/${review_id}/reply`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: reply }),
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
