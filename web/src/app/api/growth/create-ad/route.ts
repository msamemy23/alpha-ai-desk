export const dynamic = "force-dynamic"
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { roundMoney } from '@/lib/document-money'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { getIdempotencyKey } from '@/lib/api-response'
import { finishSocialPublishingOperation, peekSocialPublishingOperation, startSocialPublishingOperation } from '@/lib/social-operation'

// Create ad campaigns using AI-generated copy
// Supports Facebook Ads (via Marketing API) and Google Ads (generates ready-to-use copy)
function fallbackAdCopy(serviceType: string, area: string, shopName: string, shopPhone: string): Record<string, unknown> {
  return {
    headline: `${serviceType} - Trusted Local Service`,
    primary_text: `Need ${serviceType}? ${shopName} is ready to help with honest, affordable service.${shopPhone ? ` Call ${shopPhone} today!` : ''}`,
    description: shopPhone ? `Book your appointment today. ${shopPhone}` : 'Book your appointment today.',
    keywords: [
      `${serviceType.toLowerCase()} ${area.toLowerCase()}`,
      `auto repair ${area.toLowerCase()}`,
      `mechanic ${area.toLowerCase()}`,
    ],
    call_to_action: 'CALL_NOW',
  }
}

function campaignPayloadMatches(
  campaign: Record<string, unknown>,
  payloadHash: string,
  platform: string,
  service: string,
  dailyBudget: number,
  durationDays: number,
  area: string,
) {
  const storedHash = typeof campaign.idempotency_payload_hash === 'string' ? campaign.idempotency_payload_hash : ''
  if (storedHash) return storedHash === payloadHash
  return String(campaign.platform || '') === platform
    && String(campaign.service || '') === service
    && Number(campaign.budget_per_day ?? campaign.daily_budget) === dailyBudget
    && Number(campaign.duration_days) === durationDays
    && String(campaign.target_area || '') === area
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const { platform, service, budget, duration_days, target_area } = body || {}
    const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : 'facebook'
    if (!['facebook', 'google'].includes(normalizedPlatform)) {
      return NextResponse.json({ error: 'Platform must be facebook or google' }, { status: 400 })
    }
    const requestKey = getIdempotencyKey(req, [
      body && typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    ])
    if (!requestKey) {
      return NextResponse.json({ ok: false, error: 'Idempotency-Key is required for ad creation retries' }, { status: 400 })
    }

    const db = getServiceClient()
    const serviceType = typeof service === 'string' && service.trim()
      ? service.trim().slice(0, 120)
      : 'general auto repair'
    const area = typeof target_area === 'string' && target_area.trim()
      ? target_area.trim().slice(0, 160)
      : 'your local service area'
    const parsedBudget = Number(budget)
    const dailyBudget = Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedBudget <= 100000
      ? roundMoney(parsedBudget)
      : 10
    const parsedDuration = Number(duration_days)
    const durationDays = Number.isInteger(parsedDuration) && parsedDuration > 0 && parsedDuration <= 365
      ? parsedDuration
      : 7
    const campaignPayloadHash = createHash('sha256').update(JSON.stringify({
      platform: normalizedPlatform,
      service: serviceType,
      dailyBudget,
      durationDays,
      targetArea: area,
    })).digest('hex')

    // Replay must be resolved before any provider or AI call. A retried key
    // is bound to the original campaign payload, so changed input cannot
    // silently receive the old campaign.
    const { data: existingCampaign, error: existingCampaignError } = await db
      .from('growth_campaigns')
      .select('*')
      .eq('shop_id', auth.shopId)
      .eq('idempotency_key', requestKey)
      .limit(1)
      .maybeSingle()
    if (existingCampaignError) {
      console.error('Create ad idempotency lookup error:', existingCampaignError.message)
      return NextResponse.json({ ok: false, error: 'The campaign could not be safely recovered' }, { status: 500 })
    }
    if (existingCampaign) {
      if (!campaignPayloadMatches(existingCampaign, campaignPayloadHash, normalizedPlatform, serviceType, dailyBudget, durationDays, area)) {
        return NextResponse.json({ ok: false, error: 'Idempotency-Key was used for a different campaign payload' }, { status: 409 })
      }
      return NextResponse.json({
        ok: true,
        replayed: true,
        campaign: existingCampaign,
        ad_copy: existingCampaign.ad_copy || null,
        facebook_result: existingCampaign.fb_ids || null,
        google_ready: null,
      })
    }

    const { data: settings, error: settingsError } = await db
      .from('settings')
      .select('*')
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (settingsError) {
      console.error('Create ad settings error:', settingsError)
      return NextResponse.json({ error: 'Unable to load shop advertising settings' }, { status: 500 })
    }

    const aiKey = (settings?.ai_api_key as string) || ''
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)
    const fbToken = settings?.facebook_page_token as string
    const fbPageId = settings?.facebook_page_id as string
    const fbAdAccountId = String(settings?.fb_ad_account_id || '').replace(/^act_/, '')
    let providerReplay: Record<string, unknown> | null = null

    // Recover a completed Facebook provider operation before requiring AI or
    // making another provider call. The local campaign row may be missing if
    // the response was lost after Facebook accepted the ad.
    if (normalizedPlatform === 'facebook') {
      const providerState = await peekSocialPublishingOperation({
        request: req,
        body: (body && typeof body === 'object' ? body : {}) as Record<string, unknown>,
        shopId: auth.shopId,
        platform: 'facebook_ads',
        action: 'create_ad',
      })
      if (providerState.state === 'blocked') return NextResponse.json({ ok: false, error: providerState.error }, { status: providerState.status })
      if (providerState.state === 'replay') {
        providerReplay = providerState.result && typeof providerState.result === 'object'
          ? providerState.result as Record<string, unknown>
          : null
      }
    }

    if (!aiKey && !providerReplay) {
      return NextResponse.json({ error: 'AI API key not configured' }, { status: 400 })
    }

    const shopName = String(settings?.shop_name || settings?.company_name || settings?.business_name || 'your auto repair shop').slice(0, 120)
    // The settings table stores these as shop_address / shop_phone. The bare
    // `address` and `phone` keys do not exist on that table, so every ad was
    // built with no contact details. Legacy keys are kept as fallbacks.
    const shopAddress = String(settings?.shop_address || settings?.address || '').slice(0, 200)
    const shopPhone = String(settings?.shop_phone || settings?.phone || settings?.business_phone || '').slice(0, 40)

    // Step 1: Use AI to generate ad copy. A provider replay uses a
    // deterministic local fallback so recovery never calls AI again.
    const adPrompt = `Create a ${normalizedPlatform} ad campaign for ${shopName}${shopAddress ? ` (${shopAddress}` : ''}${shopPhone ? `, phone: ${shopPhone}` : ''}${shopAddress ? ')' : ''}.

Service to advertise: ${serviceType}
Target area: ${area}
Daily budget: $${dailyBudget}

Generate:
1. headline (max 40 chars for Google, 40 chars for Facebook)
2. primary_text (compelling ad body, 125 chars for Google description, 250 chars for Facebook)
3. description (short call to action, max 90 chars)
4. keywords (array of 10 Google search keywords people would use)
5. target_interests (array of Facebook interest targeting categories)
6. call_to_action (LEARN_MORE, BOOK_NOW, CALL_NOW, GET_OFFER, etc.)
7. age_min (minimum target age)
8. age_max (maximum target age)

Return ONLY valid JSON object. No markdown.`

    let adCopy: Record<string, unknown> = fallbackAdCopy(serviceType, area, shopName, shopPhone)
    if (!providerReplay) {
      const aiRes = await fetch(`${aiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: 'You are an expert digital advertising copywriter for auto repair shops. Return only valid JSON. No markdown.' },
            { role: 'user', content: adPrompt }
          ],
          max_tokens: 1000,
        })
      })

      if (!aiRes.ok) {
        console.error('Create ad AI error:', aiRes.status, await aiRes.text().catch(() => ''))
        return NextResponse.json({ error: 'The AI provider did not generate ad copy' }, { status: 502 })
      }
      const aiData = await aiRes.json().catch(() => ({}))
      const content = typeof aiData.choices?.[0]?.message?.content === 'string'
        ? aiData.choices[0].message.content
        : '{}'
      try {
        adCopy = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
      } catch {
        adCopy = fallbackAdCopy(serviceType, area, shopName, shopPhone)
      }
    }

    let fbResult: Record<string, unknown> | null = providerReplay
    let socialOperationId: string | null = null

    // Step 2: If Facebook, create the provider-side ad under a durable
    // publishing operation. A successful campaign record is never returned
    // unless Facebook confirms the final ad id.
    if (normalizedPlatform === 'facebook' && !providerReplay) {
      if (fbToken && fbAdAccountId) {
        const started = await startSocialPublishingOperation({
          request: req,
          body: (body && typeof body === 'object' ? body : {}) as Record<string, unknown>,
          shopId: auth.shopId,
          userId: auth.userId,
          platform: 'facebook_ads',
          action: 'create_ad',
        })
        if (started.state === 'replay') {
          // The provider-side ad already exists. Continue to the local
          // campaign write so a response loss or local DB outage is repaired
          // by replaying the same idempotency key without another ad call.
          fbResult = started.result && typeof started.result === 'object'
            ? started.result as Record<string, unknown>
            : null
        } else if (started.state !== 'claimed') {
          return NextResponse.json({ ok: false, error: started.error }, { status: started.status })
        } else {
          socialOperationId = started.id

          // Whatever Facebook has already created must survive a later failure
          // so a retry can reconcile instead of creating a second campaign.
          // Once any artifact exists the operation is 'unknown', never
          // 'failed' — 'failed' invites a clean retry that would orphan it.
          const createdArtifacts: Record<string, unknown> = {}

          const failSocial = async (message: string, result?: unknown, status = 502, operationStatus: 'failed' | 'unknown' = 'failed') => {
            const orphaned = Object.keys(createdArtifacts).length > 0
            const durableStatus = orphaned ? 'unknown' : operationStatus
            const durableResult = orphaned
              ? { ...createdArtifacts, partial: true, provider_error: result ?? null }
              : result
            const durableMessage = orphaned
              ? `${message}. Facebook already created ${Object.keys(createdArtifacts).join(', ')}; reconcile Ads Manager before retrying.`
              : message
            const saved = await finishSocialPublishingOperation(socialOperationId as string, durableStatus, durableResult, durableMessage)
            if (!saved.ok) return NextResponse.json({ ok: false, error: 'The Facebook Ads outcome is uncertain because its durable status could not be saved' }, { status: 502 })
            return NextResponse.json({ ok: false, error: durableMessage }, { status })
          }

          try {
          if (!fbPageId) return await failSocial('Facebook page id is missing; the ad was not created', undefined, 401)

          const campRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${shopName} - ${serviceType} - ${new Date().toLocaleDateString()}`,
              objective: 'OUTCOME_TRAFFIC',
              status: 'PAUSED',
              special_ad_categories: ['NONE'],
              access_token: fbToken,
            })
          })
          const campData = await campRes.json().catch(() => ({}))
          if (!campRes.ok || !campData.id) {
            return await failSocial(campData?.error?.message || 'Facebook did not return a campaign id', campData, campRes.ok ? 502 : campRes.status, campRes.ok ? 'unknown' : 'failed')
          }
          createdArtifacts.campaign_id = campData.id

          const adSetRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${serviceType} - ${area}`,
              campaign_id: campData.id,
              daily_budget: dailyBudget * 100,
              billing_event: 'IMPRESSIONS',
              optimization_goal: 'LINK_CLICKS',
              bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
              targeting: {
                geo_locations: {
                  ...( /houston/i.test(area)
                    ? { cities: [{ key: '2418956', name: 'Houston', region: 'Texas' }] }
                    : { countries: ['US'] }),
                  location_types: ['home', 'recent'],
                },
                age_min: (adCopy.age_min as number) || 25,
                age_max: (adCopy.age_max as number) || 65,
                interests: ((adCopy.target_interests as string[]) || []).slice(0, 5).map(i => ({ name: i })),
              },
              start_time: new Date().toISOString(),
              end_time: new Date(Date.now() + durationDays * 86400000).toISOString(),
              status: 'PAUSED',
              access_token: fbToken,
            })
          })
          const adSetData = await adSetRes.json().catch(() => ({}))
          if (!adSetRes.ok || !adSetData.id) {
            return await failSocial(adSetData?.error?.message || 'Facebook did not create the ad set', adSetData, adSetRes.ok ? 502 : adSetRes.status)
          }
          createdArtifacts.adset_id = adSetData.id

          const creativeRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${serviceType} Creative`,
              object_story_spec: {
                page_id: fbPageId,
                link_data: {
                  link: process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app',
                  message: adCopy.primary_text,
                  name: adCopy.headline,
                  description: adCopy.description,
                  call_to_action: { type: adCopy.call_to_action || 'LEARN_MORE' },
                }
              },
              access_token: fbToken,
            })
          })
          const creativeData = await creativeRes.json().catch(() => ({}))
          if (!creativeRes.ok || !creativeData.id) {
            return await failSocial(creativeData?.error?.message || 'Facebook did not create the ad creative', creativeData, creativeRes.ok ? 502 : creativeRes.status)
          }
          createdArtifacts.creative_id = creativeData.id

          const adRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${serviceType} Ad`,
              adset_id: adSetData.id,
              creative: { creative_id: creativeData.id },
              status: 'PAUSED',
              access_token: fbToken,
            })
          })
          const adData = await adRes.json().catch(() => ({}))
          if (!adRes.ok || !adData.id) {
            return await failSocial(adData?.error?.message || 'Facebook did not return a final ad id', adData, adRes.ok ? 502 : adRes.status, 'unknown')
          }

          fbResult = {
            campaign_id: campData.id,
            adset_id: adSetData.id,
            creative_id: creativeData.id,
            ad_id: adData.id,
            status: 'PAUSED (review in Facebook Ads Manager to activate)',
          }
          const finished = await finishSocialPublishingOperation(socialOperationId, 'succeeded', fbResult)
          if (!finished.ok) return NextResponse.json({ ok: false, error: 'Facebook created the ad, but its durable result could not be saved' }, { status: 502 })
        } catch (e) {
          console.error('Facebook Ads API error:', e)
          const message = 'Facebook Ads outcome is uncertain; reconcile Ads Manager before retrying'
          // Persist whatever Facebook had already accepted so a replay can
          // reconcile the existing campaign instead of creating another one.
          const saved = await finishSocialPublishingOperation(
            socialOperationId,
            'unknown',
            Object.keys(createdArtifacts).length > 0 ? { ...createdArtifacts, partial: true } : undefined,
            e instanceof Error ? e.message : message,
          )
          if (!saved.ok) return NextResponse.json({ ok: false, error: 'The Facebook Ads outcome is uncertain because its durable status could not be saved' }, { status: 502 })
          return NextResponse.json({ ok: false, error: message }, { status: 502 })
        }
      }
    }
    }

    // Step 3: Save campaign to Supabase
    const campaign = {
      shop_id: auth.shopId,
      idempotency_key: requestKey,
      idempotency_payload_hash: campaignPayloadHash,
      name: `${(adCopy.headline as string) || serviceType}`,
      platform: normalizedPlatform,
      service: serviceType,
      budget_per_day: dailyBudget,
      status: fbResult && !('error' in fbResult) ? 'created_paused' : 'draft',
      daily_budget: dailyBudget,
      duration_days: durationDays,
      target_area: area,
      ad_copy: adCopy,
      fb_ids: fbResult,
      spend: 0,
      clicks: 0,
      impressions: 0,
      created_at: new Date().toISOString(),
    }

    const { data: saved, error: saveError } = await db
      .from('growth_campaigns')
      .insert(campaign)
      .select()
      .single()
    if (saveError) {
      console.error('Create ad save error:', saveError)
      const { data: recovered } = await db.from('growth_campaigns')
        .select('*')
        .eq('shop_id', auth.shopId)
        .eq('idempotency_key', requestKey)
        .limit(1)
        .maybeSingle()
      if (recovered) {
        if (!campaignPayloadMatches(recovered, campaignPayloadHash, normalizedPlatform, serviceType, dailyBudget, durationDays, area)) {
          return NextResponse.json({ ok: false, error: 'Idempotency-Key was used for a different campaign payload' }, { status: 409 })
        }
        return NextResponse.json({ ok: true, replayed: true, campaign: recovered, ad_copy: recovered.ad_copy || adCopy, facebook_result: recovered.fb_ids || fbResult })
      }
      return NextResponse.json({ error: 'Ad copy was generated but the campaign could not be saved' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      campaign: saved || campaign,
      ad_copy: adCopy,
      facebook_result: fbResult,
      google_ready: normalizedPlatform === 'google' ? {
        instructions: 'Copy the ad copy below into Google Ads and review targeting before publishing.',
        headline_1: ((adCopy.headline as string) || '').slice(0, 30),
        headline_2: shopPhone ? `Call ${shopPhone}` : 'Call today',
        headline_3: `${area.slice(0, 30)} Auto Repair`,
        description_1: (adCopy.primary_text as string) || '',
        description_2: (adCopy.description as string) || '',
        keywords: adCopy.keywords || [],
        suggested_daily_budget: `$${dailyBudget}`,
      } : null,
    })
  } catch (e) {
    console.error('Create ad error:', e)
    return NextResponse.json({ error: 'Failed to create ad' }, { status: 500 })
  }
}
