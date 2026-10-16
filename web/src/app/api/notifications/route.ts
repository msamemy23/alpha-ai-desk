import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import type { Db } from '@/lib/db-types'
import { mayViewProblems } from '@/lib/problems'
import { problemsLastDay } from '@/lib/problems-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const db = getServiceClient()

    // Use select with count instead of HEAD (HEAD was causing 503s)
    const [{ data: unreadMsgs }, { data: missedCalls }, { data: answered }] = await Promise.all([
      db.from('messages')
        .select('id, body, from_address, created_at')
        .eq('shop_id', auth.shopId)
        .eq('direction', 'inbound')
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(10),
      db.from('calls')
        .select('id, from_number, start_time, duration_secs, matched_customer_name')
        .eq('shop_id', auth.shopId)
        .eq('direction', 'inbound')
        .lt('duration_secs', 15)
        .order('start_time', { ascending: false })
        .limit(5)
        .gte('start_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      // A customer answered their inspection in the last day. Before the customer-link migration this column does not exist and the query just returns nothing.
      db.from('dvi')
        .select('id, customer_name, customer_decisions, customer_decided_at')
        .eq('shop_id', auth.shopId)
        .gte('customer_decided_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('customer_decided_at', { ascending: false })
        .limit(5),
    ])

    const notifications = []

    for (const i of (answered || [])) {
      const votes = Object.values((i.customer_decisions && typeof i.customer_decisions === 'object' ? i.customer_decisions : {}) as Record<string, string>)
      const yes = votes.filter(v => v === 'approved').length
      const no = votes.filter(v => v === 'declined').length
      notifications.push({
        id: i.id,
        type: 'inspection',
        title: `${i.customer_name || 'A customer'} answered their inspection`,
        body: `${yes} approved, ${no} skipped`,
        time: new Date(i.customer_decided_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        link: `/dvi?id=${i.id}`,
      })
    }

    for (const m of (unreadMsgs || [])) {
      notifications.push({
        id: m.id,
        type: 'sms',
        title: `New SMS from ${m.from_address || 'Unknown'}`,
        body: (m.body || '').slice(0, 80),
        time: new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        link: '/messages'
      })
    }

    for (const c of (missedCalls || [])) {
      notifications.push({
        id: c.id,
        type: 'call',
        title: `Missed call from ${c.matched_customer_name || c.from_number || 'Unknown'}`,
        body: `${c.duration_secs || 0}s call — needs callback`,
        time: new Date(c.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        link: '/messages'
      })
    }

    // Owner and admins also hear how many screen problems were reported in the last day (Settings, Problems reported has the list).
    // It is its own field, not a bell item: it links to Settings, not to the AI screen. Zero when it cannot be read.
    const problems = mayViewProblems(auth.role) ? await problemsLastDay(db as unknown as Db, auth.shopId) : 0

    return NextResponse.json({ notifications, unreadCount: (unreadMsgs || []).length, problems })
  } catch (e) {
    console.error('notifications error:', e)
    return NextResponse.json({ notifications: [], unreadCount: 0, problems: 0 })
  }
}
