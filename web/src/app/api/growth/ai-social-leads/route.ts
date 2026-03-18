import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v3.2'

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

async function aiDeepAnalyze(posts: any[], city: string) {
  if (!AI_KEY || !posts.length) return []
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a social media lead analyst for Alpha International Auto Center in Houston TX. Analyze social posts about car problems and extract leads with DEEP profiles. Return JSON array:\n[{\n  "name": "person's name or username",\n  "phone": "if mentioned",\n  "email": "if findable",\n  "platform": "facebook/reddit/nextdoor/yelp",\n  "post_snippet": "what they posted about",\n  "service_needed": "specific auto service needed",\n  "address": "location if mentioned",\n  "city": "Houston area",\n  "urgency": "high/medium/low",\n  "confidence": "high/medium/low",\n  "pain_points": "specific car problems",\n  "vehicle_info": "car make/model/year if mentioned",\n  "outreach_pitch": "personalized pitch",\n  "suggested_message": "ready SMS text",\n  "annual_value_estimate": "$X,XXX"\n}]`
        }, {
          role: 'user',
          content: `Extract leads from these ${city} social media posts about car problems:\n${JSON.stringify(posts.slice(0, 15))}`
        }],
        temperature: 0.3,
        max_tokens: 3000
      })
    }, 30000)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX' } = await req.json()
    const db = getServiceClient()
    const queries = [
      `"need a mechanic" OR "car broke down" OR "check engine light" ${city} site:reddit.com OR site:facebook.com`,
      `"looking for auto repair" OR "need transmission" OR "brakes grinding" ${city}`,
      `"recommend a mechanic" OR "car overheating" OR "need oil change" Houston Texas`
    ]
    const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 2)
    const allResults = (await Promise.all(shuffled.map(q => searchSerper(q)))).flat()

    const leads = await aiDeepAnalyze(allResults, city)

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
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_social_scan', target: city,
      details: `Deep research: ${leads.length} social leads from ${allResults.length} posts`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, total_posts_scanned: allResults.length,
      total_leads: leads.length, leads })
  } catch (e) {
    console.error('AI social leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}