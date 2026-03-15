import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

function fetchWithTimeout(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

async function searchSerper(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 })
    }, 10000)
    const data = await res.json()
    return (data.organic || []).map((r: any) => ({ title: r.title, snippet: r.snippet, url: r.link }))
  } catch { return [] }
}

async function aiAnalyze(posts: any[], city: string) {
  if (!AI_KEY || !posts.length) return []
  try {
    const res = await fetchWithTimeout(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: 'You are a lead gen AI for Alpha International Auto Center in Houston TX. Analyze social media posts and find people needing auto repair. Return JSON array: [{ "name": "", "platform": "", "post_snippet": "", "service_needed": "", "urgency": "high|medium|low", "suggested_message": "", "confidence": "high|medium|low" }]. Return up to 8 leads. Be concise.'
        }, {
          role: 'user',
          content: `Find auto repair leads from these ${city} social posts:\n${JSON.stringify(posts.slice(0, 12))}`
        }],
        temperature: 0.3, max_tokens: 1500
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
      `"need a mechanic" ${city} site:facebook.com OR site:reddit.com`,
      `"car broke down" ${city} site:facebook.com OR site:nextdoor.com`,
      `"recommend a mechanic" ${city} site:reddit.com OR site:facebook.com`
    ]

    const results = await Promise.all(queries.map(q => searchSerper(q)))
    let allResults = results.flat()
    const seen = new Set()
    allResults = allResults.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true })

    const leads = await aiAnalyze(allResults, city)

    if (leads.length > 0) {
      const rows = leads.map((lead: any) => ({
        name: lead.name || 'Social Lead',
        phone: null,
        service_needed: lead.service_needed || 'General auto repair',
        source: 'ai-social-scan',
        status: 'new',
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_social_scan', target: city,
      details: `Found ${leads.length} social leads from ${allResults.length} posts`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, total_posts_scanned: allResults.length, total_leads: leads.length, leads })
  } catch (e) {
    console.error('AI social leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}