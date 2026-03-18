/**
 * AI Chat History Persistence API
 * Saves and retrieves AI chat conversations to/from Supabase.
 * The ai/page.tsx currently uses localStorage only — this API provides
 * a Supabase-backed persistence layer so chat history survives across
 * devices and browser clears.
 *
 * POST: Save a chat session (array of messages + metadata)
 * GET:  Retrieve recent chat sessions
 */
import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

export async function POST(req: NextRequest) {
  try {
    const { messages, preview } = await req.json()
    if (!messages || !Array.isArray(messages) || messages.length < 2) {
      return NextResponse.json({ ok: false, error: 'Need at least 2 messages' }, { status: 400 })
    }

    const entry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      preview: preview || messages.find((m: { role: string; content: string }) => m.role === 'user')?.content?.slice(0, 60) || 'Conversation',
      messages,
    }

    // Upsert into ai_chat_history — uses activities table as a fallback
    // since we cannot create new Supabase tables per requirements.
    // Store as an activity of type 'ai_chat' with the full messages in summary.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        type: 'ai_chat',
        direction: 'internal',
        summary: JSON.stringify(entry),
        created_at: new Date().toISOString(),
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      console.error('[ai-chat-history] save failed:', r.status, errText)
      return NextResponse.json({ ok: false, error: `DB error: ${r.status}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: entry.id })
  } catch (e: unknown) {
    console.error('[ai-chat-history] error:', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30')

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/activities?type=eq.ai_chat&order=created_at.desc&limit=${limit}`,
      { headers },
    )

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `DB error: ${r.status}` }, { status: 500 })
    }

    const rows = await r.json()
    const history = (rows || []).map((row: { summary: string; created_at: string }) => {
      try {
        return JSON.parse(row.summary)
      } catch {
        return null
      }
    }).filter(Boolean)

    return NextResponse.json({ ok: true, history })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
