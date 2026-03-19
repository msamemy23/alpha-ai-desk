import { NextRequest, NextResponse } from 'next/server'
import { getConnector, getValidGoogleToken, updateConnector } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// New Google Business Profile API endpoints (v4 is deprecated)
const ACCOUNT_MGMT = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BIZ_INFO     = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const MY_BUSINESS  = 'https://mybusiness.googleapis.com/v4'

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
  let accountName  = (connector.metadata?.account_name as string) || ''
  let locationName = (connector.metadata?.location_name as string) || ''

  // If we don't have them yet, try to discover using the new APIs
  if (!accountName || !locationName) {
    try {
      // Step 1: List accounts via Account Management API
      const accRes = await fetch(`${ACCOUNT_MGMT}/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const accData = await accRes.json()
      console.log('[google-biz] accounts response:', JSON.stringify(accData).slice(0, 500))

      const firstAccount = accData?.accounts?.[0]
      if (firstAccount) {
        accountName = firstAccount.name  // format: "accounts/123"

        // Step 2: List locations via Business Information API
        const locRes = await fetch(
          `${BIZ_INFO}/${accountName}/locations?readMask=name,title,storefrontAddress`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        const locData = await locRes.json()
        console.log('[google-biz] locations response:', JSON.stringify(locData).slice(0, 500))

        const firstLocation = locData?.locations?.[0]
        if (firstLocation) {
          locationName = firstLocation.name  // format: "locations/456"
        }
      }

      // Cache the discovered IDs in Supabase so we don't re-discover every time
      if (accountName || locationName) {
        const meta = { ...(connector.metadata || {}), account_name: accountName, location_name: locationName }
        await updateConnector('google_business', { metadata: meta })
      }
    } catch (e) {
      console.error('[google-biz] discovery error:', e)
      /* will fail below if not set */
    }
  }

  // For reviews/posts, we need the full location path: accounts/X/locations/Y
  // The new API returns locationName as "locations/456", so we combine with accountName
  const fullLocationPath = accountName && locationName
    ? `${accountName}/${locationName}`
    : ''

  try {
    switch (action) {

      // ── Create a post ────────────────────────────────────────────
      case 'post': {
        const { summary, call_to_action } = body as {
          summary: string
          call_to_action?: { type: string; url: string }
        }
        if (!summary) return fail('summary required')
        if (!fullLocationPath) return fail('Google Business location not found — make sure your business is verified on Google')

        const postBody: Record<string, unknown> = {
          languageCode: 'en-US',
          summary,
          topicType: 'STANDARD',
        }
        if (call_to_action) {
          postBody.callToAction = { actionType: call_to_action.type, url: call_to_action.url }
        }

        const r = await fetch(`${MY_BUSINESS}/${fullLocationPath}/localPosts`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        })
        const rData = await r.json()
        if (!r.ok) return fail(rData?.error?.message || JSON.stringify(rData), r.status)
        return ok(rData)
      }

      // ── Get reviews ──────────────────────────────────────────────
      case 'get_reviews': {
        if (!fullLocationPath) return fail('Google Business location not found — connect your Google Business account and make sure your business is verified')

        const r = await fetch(`${MY_BUSINESS}/${fullLocationPath}/reviews`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        const rData = await r.json()
        if (!r.ok) return fail(rData?.error?.message || JSON.stringify(rData), r.status)
        return ok(rData)
      }

      // ── Reply to a review ────────────────────────────────────────
      case 'reply_review': {
        const { review_id, reply } = body as { review_id: string; reply: string }
        if (!review_id || !reply) return fail('review_id and reply required')
        if (!fullLocationPath) return fail('Google Business location not found')

        const r = await fetch(`${MY_BUSINESS}/${fullLocationPath}/reviews/${review_id}/reply`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: reply }),
        })
        const rData = await r.json()
        if (!r.ok) return fail(rData?.error?.message || JSON.stringify(rData), r.status)
        return ok(rData)
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
