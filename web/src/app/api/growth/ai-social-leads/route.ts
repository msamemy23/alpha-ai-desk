import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

const SERPER_KEY = process.env.SERPER_API_KEY || ''

function fetchT(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

async function searchSerper(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchT('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 })
    }, 10000)
    const data = await res.json()
    return (data.organic || []).map((r: any) => ({ title: r.title, snippet: r.snippet, url: r.link }))
  } catch { return [] }
}

async function aiDeepAnalyze(posts: any[], city: string, aiKey: string, aiUrl: string, aiModel: string, shopName: string) {
  if (!aiKey || !posts.length) return []
  try {
    const res = await fetchT(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: `You are a social media lead analyst for ${shopName} in ${city}. Analyze social posts about car problems and extract leads with DEEP profiles. Return JSON array:\n[{\n  "name": "person's name or username",\n  "phone": "if mentioned",\n  "email": "if findable",\n  "platform": "facebook/reddit/nextdoor/yelp",\n  "post_snippet": "what they posted about",\n  "service_needed": "specific auto service needed",\n  "address": "location if mentioned",\n  "city": "Houston area",\n  "urgency": "high/medium/low",\n  "confidence": "high/medium/low",\n  "pain_points": "specific car problems",\n  "vehicle_info": "car make/model/year if mentioned",\n  "outreach_pitch": "personalized pitch",\n  "suggested_message": "ready SMS text",\n  "annual_value_estimate": "$X,XXX"\n}]`
        }, {
          role: 'user',
          content: `Extract leads from these ${city} social media posts about car problems:\n${JSON.stringify(posts.slice(0, 15))}`
        }],
        temperature: 0.3,
        max_tokens: 3000
      })
    }, 30000)
    if (!res.ok) return []
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await getRouteShop(req, body.shopId)
    if (!auth) return unauthorized()
    const { city: rawCity = 'Houston TX' } = body
    const city = typeof rawCity === 'string' ? rawCity.trim().slice(0, 120) || 'Houston TX' : 'Houston TX'
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('ai_api_key,ai_base_url,ai_model,shop_name').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError
    const shopName = typeof settings?.shop_name === 'string' && settings.shop_name.trim() ? settings.shop_name.trim().slice(0, 160) : 'this shop'
    const aiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    if (!aiKey) return NextResponse.json({ error: 'AI is not configured for this shop' }, { status: 503 })
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiUrl = aiBase + '/chat/completions'
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)
    const queries = [
      `"need a mechanic" OR "car broke down" OR "check engine light" ${city} site:reddit.com OR site:facebook.com`,
      `"looking for auto repair" OR "need transmission" OR "brakes grinding" ${city}`,
      `"recommend a mechanic" OR "car overheating" OR "need oil change" Houston Texas`
    ]
    const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 2)
    const allResults = (await Promise.all(shuffled.map(q => searchSerper(q)))).flat()

    const leads = await aiDeepAnalyze(allResults, city, aiKey, aiUrl, aiModel, shopName)

    if (leads.length > 0) {
      const rows = leads.map((l: any) => ({
        name: l.name || 'Social User',
        phone: l.phone || null, email: l.email || null,
        service_needed: l.service_needed || 'Auto repair',
        source: 'ai-social-scan', status: 'new',
        business_type: l.platform || 'social media',
        confidence: l.confidence || 'medium',
        address: l.address || null, city: l.city || 'Houston',
        pain_points: l.pain_points || null,
        industry: 'individual consumer',
        deep_research: { platform: l.platform, post_snippet: l.post_snippet,
          urgency: l.urgency, vehicle_info: l.vehicle_info,
          outreach_pitch: l.outreach_pitch, suggested_message: l.suggested_message,
          annual_value_estimate: l.annual_value_estimate },
        research_completed_at: new Date().toISOString(),
        notes: JSON.stringify(l),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        shop_id: auth.shopId,
      }))
      const { error } = await db.from('leads').insert(rows)
      if (error) throw error
    }

    const { error: activityError } = await db.from('growth_activity').insert({
      action: 'ai_social_scan', target: city,
      details: `Deep research: ${leads.length} social leads from ${allResults.length} posts`,
      status: 'complete', created_at: new Date().toISOString(),
      shop_id: auth.shopId
    })
    if (activityError) throw activityError

    return NextResponse.json({ success: true, total_posts_scanned: allResults.length,
      total_leads: leads.length, leads })
  } catch (e) {
    console.error('AI social leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
