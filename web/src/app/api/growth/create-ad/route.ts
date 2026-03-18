export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

// Create ad campaigns using AI-generated copy
// Supports Facebook Ads (via Marketing API) and Google Ads (generates ready-to-use copy)
export async function POST(req: NextRequest) {
  try {
    const { platform, service, budget, duration_days, target_area } = await req.json()

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()

    const aiKey = (settings?.ai_api_key as string) || ''
    const aiModel = (settings?.ai_model as string) || 'deepseek/deepseek-v3.2'
    const aiBase = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'

    if (!aiKey) {
      return NextResponse.json({ error: 'AI API key not configured' }, { status: 400 })
    }

    const serviceType = service || 'general auto repair'
    const area = target_area || 'Houston TX 77025'
    const dailyBudget = budget || 10

    // Step 1: Use AI to generate ad copy
    const adPrompt = `Create a ${platform || 'Facebook'} ad campaign for Alpha International Auto Center (10710 S Main St, Houston TX 77025, phone: (713) 663-6979).

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

    const aiData = await aiRes.json()
    const content = aiData.choices?.[0]?.message?.content || '{}'
    let adCopy: Record<string, unknown> = {}
    try {
      adCopy = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    } catch {
      adCopy = {
        headline: `${serviceType} - Houston's Trusted Shop`,
        primary_text: `Need ${serviceType}? Alpha International Auto Center has been serving Houston drivers with honest, affordable service. Call today!`,
        description: 'Book your appointment today. (713) 663-6979',
        keywords: ['auto repair houston', 'mechanic houston tx', serviceType.toLowerCase() + ' houston'],
        call_to_action: 'CALL_NOW',
      }
    }

    let fbResult = null

    // Step 2: If Facebook, try to create real ad via Marketing API
    if ((platform || '').toLowerCase() === 'facebook') {
      const fbToken = settings?.facebook_page_token as string
      const fbPageId = settings?.facebook_page_id as string
      const fbAdAccountId = process.env.FB_AD_ACCOUNT_ID || (settings?.fb_ad_account_id as string)

      if (fbToken && fbAdAccountId) {
        try {
          // Create Facebook ad campaign via Marketing API
          // Step 2a: Create Campaign
          const campRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Alpha - ${serviceType} - ${new Date().toLocaleDateString()}`,
              objective: 'OUTCOME_TRAFFIC',
              status: 'PAUSED', // Start paused so user can review
              special_ad_categories: ['NONE'],
              access_token: fbToken,
            })
          })
          const campData = await campRes.json()

          if (campData.id) {
            // Step 2b: Create Ad Set
            const adSetRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/adsets`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `${serviceType} - ${area}`,
                campaign_id: campData.id,
                daily_budget: dailyBudget * 100, // in cents
                billing_event: 'IMPRESSIONS',
                optimization_goal: 'LINK_CLICKS',
                bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
                targeting: {
                  geo_locations: {
                    cities: [{ key: '2418956', name: 'Houston', region: 'Texas' }],
                    location_types: ['home', 'recent'],
                  },
                  age_min: (adCopy.age_min as number) || 25,
                  age_max: (adCopy.age_max as number) || 65,
                  interests: ((adCopy.target_interests as string[]) || []).slice(0, 5).map(i => ({ name: i })),
                },
                start_time: new Date().toISOString(),
                end_time: new Date(Date.now() + (duration_days || 7) * 86400000).toISOString(),
                status: 'PAUSED',
                access_token: fbToken,
              })
            })
            const adSetData = await adSetRes.json()

            if (adSetData.id && fbPageId) {
              // Step 2c: Create Ad Creative
              const creativeRes = await fetch(`https://graph.facebook.com/v19.0/act_${fbAdAccountId}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: `${serviceType} Creative`,
                  object_story_spec: {
                    page_id: fbPageId,
                    link_data: {
                      link: 'https://alphainternationalauto.com',
                      message: adCopy.primary_text,
                      name: adCopy.headline,
                      description: adCopy.description,
                      call_to_action: { type: adCopy.call_to_action || 'LEARN_MORE' },
                    }
                  },
                  access_token: fbToken,
                })
              })
              const creativeData = await creativeRes.json()

              if (creativeData.id) {
                // Step 2d: Create Ad
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
                const adData = await adRes.json()

                fbResult = {
                  campaign_id: campData.id,
                  adset_id: adSetData.id,
                  creative_id: creativeData.id,
                  ad_id: adData.id,
                  status: 'PAUSED (review in Facebook Ads Manager to activate)',
                }
              }
            }
          }
        } catch (e) {
          console.error('Facebook Ads API error:', e)
          fbResult = { error: 'Facebook Ads API failed. Check your ad account ID and permissions.' }
        }
      }
    }

    // Step 3: Save campaign to Supabase
    const campaign = {
      name: `${(adCopy.headline as string) || serviceType}`,
      platform: platform || 'facebook',
      service: serviceType,
      status: fbResult && !('error' in fbResult) ? 'created_paused' : 'draft',
      daily_budget: dailyBudget,
      duration_days: duration_days || 7,
      target_area: area,
      ad_copy: adCopy,
      fb_ids: fbResult,
      spend: 0,
      clicks: 0,
      impressions: 0,
      created_at: new Date().toISOString(),
    }

    const { data: saved } = await db.from('growth_campaigns').insert(campaign).select().single()

    return NextResponse.json({
      campaign: saved || campaign,
      ad_copy: adCopy,
      facebook_result: fbResult,
      google_ready: (platform || '').toLowerCase() === 'google' ? {
        instructions: 'Copy the ad copy below into Google Ads (ads.google.com). Create a Search campaign targeting Houston TX.',
        headline_1: ((adCopy.headline as string) || '').slice(0, 30),
        headline_2: `Call (713) 663-6979`,
        headline_3: 'Houston Auto Repair',
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
