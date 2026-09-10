import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type HistoryMessage = { role: 'user' | 'assistant' | 'browser'; content: string; [key: string]: unknown }

function normalizeMessages(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === 'object')
    .map(message => ({
      ...message,
      role: (message.role === 'user' || message.role === 'browser' ? message.role : 'assistant') as HistoryMessage['role'],
      content: typeof message.content === 'string' ? message.content.slice(0, 12000) : '',
    }))
    .filter(message => message.content || message.role === 'browser')
    .slice(-60)
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  try {
    const body = await req.json().catch(() => null)
    const messages = normalizeMessages(body?.messages)
    if (messages.length < 2) {
      return NextResponse.json({ ok: false, error: 'Need at least 2 messages' }, { status: 400 })
    }
    const sessionId = typeof body?.sessionId === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(body.sessionId)
      ? body.sessionId
      : crypto.randomUUID()
    const db = getServiceClient()

    const { error: replaceError } = await db.rpc('replace_ai_chat_history', {
      p_shop_id: auth.shopId,
      p_user_id: auth.userId,
      p_session_id: sessionId,
      p_messages: messages,
    })
    if (replaceError) throw replaceError

    return NextResponse.json({
      ok: true,
      id: sessionId,
      preview: messages.find(message => message.role === 'user')?.content.slice(0, 60) || 'Conversation',
    })
  } catch (e) {
    console.error('[ai-chat-history] save failed:', e)
    return NextResponse.json({ ok: false, error: 'Conversation could not be saved' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  const deleteAll = req.nextUrl.searchParams.get('all') === 'true'
  if (!deleteAll && (!sessionId || !/^[A-Za-z0-9._:-]{1,120}$/.test(sessionId))) {
    return NextResponse.json({ ok: false, error: 'A valid sessionId or all=true is required' }, { status: 400 })
  }
  const db = getServiceClient()
  let query = db.from('ai_chat_history').delete().eq('shop_id', auth.shopId).eq('user_id', auth.userId)
  if (!deleteAll) query = query.eq('session_id', sessionId as string)
  const { error } = await query
  if (error) return NextResponse.json({ ok: false, error: 'Conversation could not be deleted' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  try {
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') || 30)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 30) : 30
    const db = getServiceClient()
    const { data: rows, error } = await db.from('ai_chat_history')
      .select('session_id,role,content,created_at')
      .eq('shop_id', auth.shopId)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(limit * 60)
    if (error) throw error

    const sessions = new Map<string, { id: string; date: string; messages: HistoryMessage[] }>()
    for (const row of rows || []) {
      const entry: { id: string; date: string; messages: HistoryMessage[] } = sessions.get(row.session_id) || { id: row.session_id, date: row.created_at, messages: [] }
      let message: HistoryMessage | undefined
      try {
        const parsed = JSON.parse(row.content)
        message = normalizeMessages([parsed])[0]
      } catch {
        message = { role: row.role === 'user' ? 'user' : row.role === 'browser' ? 'browser' : 'assistant', content: row.content }
      }
      if (message) entry.messages.push(message)
      entry.date = row.created_at > entry.date ? row.created_at : entry.date
      sessions.set(row.session_id, entry)
    }

    const history = [...sessions.values()]
      .map(entry => ({
        ...entry,
        messages: entry.messages.reverse(),
        preview: entry.messages.find(message => message.role === 'user')?.content.slice(0, 60) || 'Conversation',
      }))
      .filter(entry => entry.messages.length >= 2)
      .slice(0, limit)

    return NextResponse.json({ ok: true, history })
  } catch (e) {
    console.error('[ai-chat-history] load failed:', e)
    return NextResponse.json({ ok: false, error: 'Conversation history could not be loaded' }, { status: 500 })
  }
}
