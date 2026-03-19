import { NextRequest, NextResponse } from 'next/server'
import { getConnector, getValidGoogleToken, updateConnector } from '@/lib/connectors'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Google Business Profile API endpoints
const ACCOUNT_MGMT = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BIZ_INFO     = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const MY_BUSINESS  = 'https://mybusiness.googleapis.com/v4'

async function discoverLocation(token: string): Promise<{
  accountName: string
  locationName: string
  pendingApproval: boolean
  debug: Record<string, unknown>
}> {
  const debug: Record<string, unknown> = {}
  let pendingApproval = false

  // Strategy 1: New Account Management API + Business Information API
  try {
    const accRes = await fetch(`${ACCOUNT_MGMT}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const accData = await accRes.json()
    debug.newApi_accounts_status = accRes.status
    debug.newApi_accounts = accData

    // 429 with quota_limit_value=0 means API approved but awaiting Google's allowlist
    if (accRes.status === 429) {
      pendingApproval = true
    }

    const firstAccount = accData?.accounts?.[0]
    if (firstAccount) {
      const accountName = firstAccount.name as string
      const locRes = await fetch(
        `${BIZ_INFO}/${accountName}/locations?readMask=name,title,storefrontAddress`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const locData = await locRes.json()
      debug.newApi_locations_status = locRes.status
      debug.newApi_locations = locData

      const firstLocation = locData?.locations?.[0]
      if (firstLocation) {
        return { accountName, locationName: firstLocation.name as string, pendingApproval: false, debug }
      }
    }
  } catch (e) {
    debug.newApi_error = e instanceof Error ? e.message : String(e)
  }

  // Strategy 2: Old My Business API v4 (fallback)
  try {
    const accRes = await fetch(`${MY_BUSINESS}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (accRes.ok) {
      const accData = await accRes.json()
      debug.v4_accounts_status = accRes.status
      debug.v4_accounts = accData

      const firstAccount = accData?.accounts?.[0]
      if (firstAccount) {
        const accountName = firstAccount.name as string
        const locRes = await fetch(`${MY_BUSINESS}/${accountName}/locations`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        const locData = await locRes.json()
        debug.v4_locations_status = locRes.status
        debug.v4_locations = locData

        const firstLocation = locData?.locations?.[0]
        if (firstLocation) {
          return { accountName, locationName: firstLocation.name as string, pendingApproval: false, debug }
        }
      }
    }
  } catch (e) {
    debug.v4_error = e instanceof Error ? e.message : String(e)
  }

  return { accountName: '', locationName: '', pendingApproval, debug }
}

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

  // If we don't have them yet, try to discover
  let pendingApproval = false
  if (!accountName || !locationName) {
    const discovered = await discoverLocation(token)
    accountName = discovered.accountName
    locationName = discovered.locationName
    pendingApproval = discovered.pendingApproval

    // Cache the discovered IDs in Supabase
    if (accountName || locationName) {
      const meta = { ...(connector.metadata || {}), account_name: accountName, location_name: locationName }
      await updateConnector('google_business', { metadata: meta })
    }

    // If action is debug, return discovery results
    if (action === 'debug') {
      return ok({
        accountName,
        locationName,
        pendingApproval,
        connectorMetadata: connector.metadata,
        tokenPrefix: token.slice(0, 20) + '...',
        discovery: discovered.debug,
      })
    }
  }

  // For debug action even when we have cached values
  if (action === 'debug') {
    return ok({
      accountName,
      locationName,
      connectorMetadata: connector.metadata,
      tokenPrefix: token.slice(0, 20) + '...',
      cached: true,
    })
  }

  // For reviews/posts, we need the full location path
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
        if (!fullLocationPath) {
          if (pendingApproval) return fail('Google Business API access is pending approval from Google (case 2-5894000040376). Expected within 5 business days.', 503)
          return fail('Google Business location not found — make sure your business is verified on Google', 400)
        }

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
        if (!fullLocationPath) {
          if (pendingApproval) return fail('Google Business API access is pending approval from Google (support case 2-5894000040376, submitted today). Google typically approves within 5 business days — check msamemy23@gmail.com for the approval email.', 503)
          return fail('Google Business location not found — make sure your business is verified on Google', 400)
        }

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
        if (!fullLocationPath) {
          if (pendingApproval) return fail('Google Business API access is pending approval from Google. Expected within 5 business days.', 503)
          return fail('Google Business location not found', 400)
        }

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
