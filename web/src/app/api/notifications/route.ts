import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const db = getServiceClient()

    // Use select with count instead of HEAD (HEAD was causing 503s)
    const [{ data: unreadMsgs }, { data: missedCalls }] = await Promise.all([
      db.from('messages')
        .select('id, body, from_address, created_at')
        .eq('direction', 'inbound')
        .eq('read', false)
        .order('created_at', { ascending: false })
        .limit(10),
      db.from('calls')
        .select('id, from_number, start_time, duration_secs, matched_customer_name')
        .eq('direction', 'inbound')
        .lt('duration_secs', 15)
        .order('start_time', { ascending: false })
        .limit(5)
        .gte('start_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    ])

    const notifications = []

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

    return NextResponse.json({ notifications, unreadCount: (unreadMsgs || []).length })
  } catch (e) {
    console.error('notifications error:', e)
    return NextResponse.json({ notifications: [], unreadCount: 0 })
  }
}