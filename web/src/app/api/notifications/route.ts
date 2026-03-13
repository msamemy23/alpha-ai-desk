import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = getServiceClient()
  const notifications: { id: string; type: string; title: string; body: string; time: string }[] = []
  const now = new Date()

  // Stale jobs (no update in 3+ days, still open)
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString()
  const { data: staleJobs } = await sb.from('jobs').select('id,customer_name,status,updated_at,created_at')
    .not('status', 'in', '("Paid","Closed","Completed","Ready for Pickup")')
  ;(staleJobs || []).forEach((j: Record<string,unknown>) => {
    const lastUpdate = (j.updated_at as string) || (j.created_at as string) || ''
    if (lastUpdate < threeDaysAgo) {
      notifications.push({
        id: `stale-${j.id}`,
        type: 'stale_job',
        title: `Stale job: ${j.customer_name || 'Unknown'}`,
        body: `Status "${j.status}" — no update in 3+ days`,
        time: lastUpdate ? new Date(lastUpdate).toLocaleDateString() : '',
      })
    }
  })

  // Overdue invoices
  const { data: invoices } = await sb.from('documents').select('id,doc_number,customer_name,status,doc_date')
    .eq('type', 'Invoice').in('status', ['Unpaid','Partial'])
  ;(invoices || []).forEach((d: Record<string,unknown>) => {
    notifications.push({
      id: `inv-${d.id}`,
      type: 'overdue_invoice',
      title: `Overdue: ${d.doc_number}`,
      body: `${d.customer_name || 'Unknown'} — ${d.status}`,
      time: (d.doc_date as string) || '',
    })
  })

  // Unread messages
  const { data: msgs } = await sb.from('messages').select('id,from_address,body,created_at')
    .eq('read', false).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(5)
  ;(msgs || []).forEach((m: Record<string,unknown>) => {
    notifications.push({
      id: `msg-${m.id}`,
      type: 'unread_message',
      title: `New message from ${m.from_address}`,
      body: ((m.body as string) || '').slice(0, 80),
      time: (m.created_at as string) ? new Date(m.created_at as string).toLocaleString() : '',
    })
  })

  return NextResponse.json({ notifications: notifications.slice(0, 20) })
}
