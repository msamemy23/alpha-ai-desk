// An in-memory promotions table that works with the automation fake: the counts come from the same message ledger the
// engine writes to, exactly as the real counting function does from automation_messages.

import { emptyCounts } from '../../src/lib/growth-promotions.ts'

export function createPromotionFake(fake) {
  const rows = []
  let seq = 0
  const stamp = () => new Date(fake.now).toISOString()
  const store = {
    async list(shopId) { return rows.filter(r => r.shop_id === shopId).map(r => ({ ...r })).reverse() },
    async get(shopId, id) { const r = rows.find(x => x.shop_id === shopId && x.id === id); return r ? { ...r } : null },
    async insert(input) {
      const row = { id: `p${++seq}`, status: 'draft', send_at: null, queued_count: 0, skipped_count: 0, sent_at: null, created_at: stamp(), updated_at: stamp(), ...input }
      rows.push(row)
      return { ...row }
    },
    async update(shopId, id, patch, from) {
      const r = rows.find(x => x.shop_id === shopId && x.id === id)
      if (!r || (from && !from.includes(r.status))) return null
      Object.assign(r, patch, { updated_at: stamp() })
      return { ...r }
    },
    async remove(shopId, id) {
      const i = rows.findIndex(x => x.shop_id === shopId && x.id === id && x.status === 'draft')
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    async counts(_shop, ids) {
      const out = {}
      for (const id of ids) out[id] = emptyCounts()
      for (const m of fake.state.messages) {
        const c = out[m.campaign_id]
        if (!c || m.is_test) continue
        if (m.status === 'queued') { c.queued += 1; if (!c.next_send_after || m.send_after < c.next_send_after) c.next_send_after = m.send_after }
        else if (m.status === 'sent') { c.sent += 1; if (m.delivery_status === 'delivered') c.delivered += 1 }
        else if (m.status in c) c[m.status] += 1
      }
      return out
    },
  }
  return { store, rows }
}
