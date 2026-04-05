/**
 * /api/ai-chat
 * Mobile app AI chat endpoint.
 * Accepts { message, sessionId, history? } from the Android APK.
 * Reads the OpenRouter API key from Supabase settings,
 * runs the full Alpha AI agent loop (with shop tools), and returns { reply }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const SYSTEM_PROMPT = `You are Alpha AI, the intelligent assistant for Alpha International Auto Center, an auto repair shop in Houston, TX.

SHOP INFO:
- Name: Alpha International Auto Center | 10710 S Main St, Houston TX 77025
- Phone: (713) 663-6979 | Labor Rate: $120/hr | Tax Rate: 8.25%
- Payment: Cash, Card, Zelle, Cash App
- Technicians: Paul (senior), Devin, Luis, Louie

PERSONALITY: Confident, direct, knowledgeable. Short sentences. You know cars inside and out. Be conversational and natural — you're talking to a mechanic who's busy, be efficient.

TOOLS (respond with JSON when using a tool):
{ "tool": "dbAction", "action": "<actionName>", "payload": { ... } }

Available actions:
- searchCustomers: { query: string }
- getShopStats: {}
- getCustomerHistory: { customer_id?: string, customer_name?: string }
- createCustomer: { name, phone?, email?, address?, notes? }
- createJob: { customer_name, vehicle_year?, vehicle_make?, vehicle_model?, status?, notes? }
- updateJobStatus: { id, status }
- scheduleFollowUp: { customer_name, channel: "sms"|"email", scheduled_for, message_body }
- listStaff: {}

RULES:
- Keep responses SHORT. Max 3-5 sentences.
- When you need data, call a tool. When you have the data, answer.
- Never make up customer info. Always search first.
- Format currency as $X.XX`

export const dynamic = 'force-dynamic'

async function getSettings() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?select=ai_api_key,ai_model,ai_base_url&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    )
    const rows = await res.json()
    return rows?.[0] || {}
  } catch {
    return {}
  }
}

async function callDbAction(action: string, payload: Record<string, unknown>) {
  try {
    const baseUrl = SUPABASE_URL.replace('https://fztnsqrhjesqcnsszqdb.supabase.co', 'https://alpha-ai-desk.vercel.app')
    // Call our own ai-action endpoint
    const res = await fetch(`https://alpha-ai-desk.vercel.app/api/ai-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ action, payload }),
    })
    const data = await res.json()
    return data?.data || data
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, sessionId, history } = body as {
      message: string
      sessionId?: string
      history?: Array<{ role: string; content: string }>
    }

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const settings = await getSettings()
    const apiKey = settings.ai_api_key || process.env.OPENROUTER_API_KEY || ''
    const model = settings.ai_model || 'deepseek/deepseek-v3.2'
    const baseUrl = settings.ai_base_url || 'https://openrouter.ai/api/v1'

    if (!apiKey) {
      return NextResponse.json({ reply: 'AI is not configured yet. Please add an OpenRouter API key in Settings on the web dashboard.' })
    }

    // Build conversation
    const priorMessages = (history || []).slice(-10).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const agentMessages: Array<{ role: string; content: string }> = [
      ...priorMessages,
      { role: 'user', content: message },
    ]

    // Agent loop — up to 5 steps to handle tool calls
    for (let step = 0; step < 5; step++) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...agentMessages],
          max_tokens: 600,
          temperature: 0.3,
        }),
      })

      const data = await res.json()
      if (data.error) {
        return NextResponse.json({ reply: `AI error: ${data.error.message || JSON.stringify(data.error)}` })
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''
      agentMessages.push({ role: 'assistant', content: raw })

      // Try to parse tool call
      let parsed: Record<string, unknown> | null = null
      try {
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        try { parsed = JSON.parse(cleaned) } catch {
          const match = cleaned.match(/\{[\s\S]*"tool"[\s\S]*\}/)
          if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = null } }
        }
        if (parsed && !parsed.tool) parsed = null
      } catch { parsed = null }

      // No tool call — this is the final reply
      if (!parsed) {
        // Save to ai_chat_history if sessionId provided
        if (sessionId) {
          try {
            const db = getServiceClient()
            await db.from('ai_chat_history').insert([
              { session_id: sessionId, role: 'user', content: message, created_at: new Date().toISOString() },
              { session_id: sessionId, role: 'assistant', content: raw, created_at: new Date().toISOString() },
            ])
          } catch { /* ignore */ }
        }
        return NextResponse.json({ reply: raw, sessionId })
      }

      // Execute tool call
      const toolName = parsed.tool as string
      if (toolName === 'dbAction') {
        const action = parsed.action as string
        const payload = (parsed.payload as Record<string, unknown>) || {}
        const result = await callDbAction(action, payload)
        agentMessages.push({
          role: 'user',
          content: `Tool result for ${action}:\n${JSON.stringify(result, null, 2)}`,
        })
      } else {
        // Unknown tool — return what we have
        break
      }
    }

    // Fallback if loop exhausted
    const lastAssistant = agentMessages.filter(m => m.role === 'assistant').pop()
    return NextResponse.json({ reply: lastAssistant?.content || 'I ran into an issue. Please try again.', sessionId })
  } catch (err) {
    console.error('[ai-chat] error:', err)
    return NextResponse.json({ reply: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'ai-chat' })
}
