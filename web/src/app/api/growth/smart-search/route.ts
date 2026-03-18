export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })
    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()
    const aiKey = (settings?.ai_api_key as string) || ''
    const aiModel = (settings?.ai_model as string) || 'deepseek/deepseek-v3.2'
    const aiBase = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'
    if (!aiKey) return NextResponse.json({ error: 'AI API key not configured' }, { status: 400 })

    const aiRes = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: 'You are an investigative research AI for an auto repair shop. Given a name or business, search for publicly available contact information. Return ONLY valid JSON. No markdown.' },
          { role: 'user', content: `Investigate this person/business in Houston TX: "${query}". Find any publicly available info: phone numbers, email, social media profiles (Facebook, Instagram, LinkedIn), business address, Google reviews they left, Yelp activity. Return JSON: {"results":[{"source":"Facebook","name":"...","phone":"...","email":"...","social":"facebook.com/...","url":"...","confidence":"high|medium|low","notes":"..."}],"summary":"Brief summary of what was found","found_info":["phone","social"]}` }
        ],
        max_tokens: 2000,
      })
    })
    const aiData = await aiRes.json()
    const content = aiData.choices?.[0]?.message?.content || '{}'
    let parsed: any = { results: [], summary: 'No results found', found_info: [] }
    try {
      parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    } catch {}
    return NextResponse.json(parsed)
  } catch (e) {
    console.error('Smart search error:', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
