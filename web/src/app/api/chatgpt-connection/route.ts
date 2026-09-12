import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { chatGptConnectionStatus, disconnectChatGpt, pollChatGptConnection, startChatGptConnection } from '@/lib/chatgpt-connection'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth || auth.role === 'service') return unauthorized()
  try { return json(await chatGptConnectionStatus(auth)) }
  catch { return json({ error: 'ChatGPT connection could not be checked. Try again.' }, 503) }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth || auth.role === 'service') return unauthorized()
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'Same-origin request required' }, 403)
  if (!checkRateLimit(rateLimitKey('chatgpt-connect', auth.userId), 30, 60_000).ok) return json({ error: 'Please wait a minute before trying again.' }, 429)
  try {
    const body = await req.json()
    if (body.action === 'start') return json(await startChatGptConnection(auth))
    if (body.action === 'poll') return json(await pollChatGptConnection(auth))
    if (body.action === 'disconnect') { await disconnectChatGpt(auth); return json({ status: 'disconnected' }) }
    return json({ error: 'Unknown connection action' }, 400)
  } catch (error) {
    // Never return token responses, credential objects, or upstream response bodies.
    const message = error instanceof Error ? error.message : ''
    return json({ error: message.startsWith('OpenAI device sign-in is unavailable') ? message : 'ChatGPT sign-in could not finish. Try again or start a new connection.' }, 502)
  }
}
