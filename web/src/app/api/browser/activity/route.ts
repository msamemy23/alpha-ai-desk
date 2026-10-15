import { openRoute, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

const ACTIONS = [
  'browser.visit', 'browser.read', 'browser.search', 'browser.fill', 'browser.click', 'browser.approval_asked', 'browser.approval_decided',
  'browser.sent', 'browser.download', 'browser.blocked', 'browser.handoff', 'browser.settings', 'browser.rule', 'browser.bookmark', 'browser.ai_step', 'browser.host',
]

/** The shop's browsing log: every page opened and every action taken, newest first. */
export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'read', need: 'browse' })
  if (!gate.ok) return gate.response
  const { caller } = gate
  try {
    const { data, error } = await caller.db.from('audit_logs')
      .select('id,action,user_id,metadata,created_at')
      .eq('shop_id', caller.auth.shopId).in('action', ACTIONS).order('created_at', { ascending: false }).limit(80)
    if (error) return reply({ ok: false, error: 'The activity log could not be loaded.' }, 500)
    const items = (data || []).map((r: { id: string; action: string; user_id: string | null; metadata: Record<string, unknown> | null; created_at: string }) => {
      const m = r.metadata || {}
      return {
        id: String(r.id), action: r.action, at: r.created_at,
        who: m.actor === 'ai' ? 'alpha' : r.user_id === caller.auth.userId ? 'you' : 'teammate',
        host: typeof m.host === 'string' ? m.host : '', url: typeof m.url === 'string' ? m.url : '', detail: typeof m.detail === 'string' ? m.detail : '',
      }
    })
    return reply({ ok: true, items })
  } catch {
    return reply({ ok: false, error: 'The activity log could not be loaded.' }, 500)
  }
}
