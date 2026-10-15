import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { NEEDS_CITY, cityName, resolveSearchCity } from '@/lib/growth-city'
import { emailFoundIn, phoneFoundIn } from '@/lib/lead-grounding'

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

async function aiDeepAnalyze(posts: any[], city: string, aiKey: string, aiUrl: string, aiModel: string, shopName: string): Promise<any[] | null> {
  if (!posts.length) return []
  if (!aiKey) return null
  try {
    const res = await fetchT(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: `You help ${shopName}, an independent auto repair shop in ${city}, spot people who posted about car trouble. Use ONLY what is written in the posts. If a detail is not there, use null. Never guess a phone number, email address, address or name. Return a JSON array. Each item has exactly these fields:\n{\n  "name": "the person's name or username as written",\n  "phone": "a phone number written in the post, else null",\n  "email": "an email address written in the post, else null",\n  "platform": "facebook, reddit, nextdoor or yelp, from the link",\n  "post_snippet": "a short quote of what they posted",\n  "service_needed": "the auto service they seem to need",\n  "city": "a city named in the post, else null",\n  "urgency": "high, medium or low",\n  "confidence": "high, medium or low, for how clearly the post asks for a mechanic",\n  "pain_points": "the car problem in the post",\n  "vehicle_info": "make, model or year if written, else null"\n}`
        }, {
          role: 'user',
          content: `Extract leads from these ${city} social media posts about car problems:\n${JSON.stringify(posts.slice(0, 15))}`
        }],
        temperature: 0.2,
        max_tokens: 3000
      })
    }, 30000)
    if (!res.ok) return null
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await getRouteShop(req, body.shopId)
    if (!auth) return unauthorized()
    const db = getServiceClient()
    const city = await resolveSearchCity(db, auth.shopId, body.city)
    if (!city) return NextResponse.json({ error: NEEDS_CITY }, { status: 400 })
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
      `"recommend a mechanic" OR "car overheating" OR "need oil change" ${city}`
    ]
    const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 2)
    const allResults = (await Promise.all(shuffled.map(q => searchSerper(q)))).flat()

    const analyzed = await aiDeepAnalyze(allResults, city, aiKey, aiUrl, aiModel, shopName)
    if (analyzed === null) return NextResponse.json({ error: 'Alpha’s AI could not read the posts just now. Try again in a few minutes.' }, { status: 502 })
    // A phone number or email only counts if it is written in the posts Alpha actually read.
    const evidence = JSON.stringify(allResults)
    const leads = analyzed.filter((l: any) => l && typeof l === 'object' && (l.name || l.post_snippet)).slice(0, 15).map((l: any) => ({
      ...l, phone: phoneFoundIn(l.phone, evidence), email: emailFoundIn(l.email, evidence),
    }))

    if (leads.length > 0) {
      const rows = leads.map((l: any) => ({
        name: l.name || 'Social user',
        phone: l.phone, email: l.email,
        service_needed: l.service_needed || 'Auto repair',
        source: 'ai-social-scan', status: 'new',
        business_type: l.platform || 'social media',
        confidence: ['high', 'medium', 'low'].includes(l.confidence) ? l.confidence : 'low',
        address: null, city: l.city || cityName(city),
        pain_points: l.pain_points || null,
        industry: 'individual consumer',
        deep_research: { platform: l.platform, post_snippet: l.post_snippet, urgency: l.urgency, vehicle_info: l.vehicle_info },
        research_completed_at: new Date().toISOString(),
        notes: l.post_snippet ? `Posted: ${String(l.post_snippet).slice(0, 400)}` : null,
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
