export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'
import { maskEmail, recordEmailOptOut, removeEmailOptOut } from '@/lib/marketing-email'
import { unsubscribePage, type UnsubscribeView } from '@/lib/unsubscribe-page'

// The public "Unsubscribe" link at the bottom of every marketing email.
//
// GET only shows a page: mail scanners open links on their own, and that must never unsubscribe anyone.
// POST does the work, from the button on that page or from a mail app's one-click unsubscribe (RFC 8058).
// The signed link says which shop and which address, so nobody can unsubscribe a different person.

function page(view: UnsubscribeView, status = 200): NextResponse {
  return new NextResponse(unsubscribePage(view), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  })
}

async function shopNameFor(shopId: string): Promise<string> {
  try {
    const { data } = await getServiceClient().from('settings').select('shop_name').eq('shop_id', shopId).maybeSingle()
    return String(data?.shop_name || '').trim()
  } catch {
    return ''
  }
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('t') || ''
  const who = verifyUnsubscribeToken(token)
  if (!who) return page({ state: 'invalid' }, 400)
  return page({ state: 'confirm', shopName: await shopNameFor(who.shopId), email: maskEmail(who.email), token })
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  let token = url.searchParams.get('t') || ''
  let action = 'unsubscribe'
  let oneClick = false
  const type = req.headers.get('content-type') || ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (form) {
      token = token || String(form.get('t') || '')
      if (form.get('action') === 'resubscribe') action = 'resubscribe'
      oneClick = form.get('List-Unsubscribe') === 'One-Click'
    }
  }
  const who = verifyUnsubscribeToken(token)
  if (!who) return oneClick ? NextResponse.json({ ok: false }, { status: 400 }) : page({ state: 'invalid' }, 400)

  try {
    const db = getServiceClient()
    if (action === 'resubscribe') await removeEmailOptOut(db, who.shopId, who.email)
    else await recordEmailOptOut(db, who.shopId, who.email, oneClick ? 'one_click' : 'link')
    if (oneClick) return NextResponse.json({ ok: true })
    return page({ state: action === 'resubscribe' ? 'resubscribed' : 'done', shopName: await shopNameFor(who.shopId), email: maskEmail(who.email), token })
  } catch (error) {
    console.error('[unsubscribe] failed:', error instanceof Error ? error.message : error)
    return oneClick ? NextResponse.json({ ok: false }, { status: 500 }) : page({ state: 'error', token }, 500)
  }
}
