// A plain-JavaScript model of the database functions in migration 057, for the in-memory test database. It follows the same rules
// the SQL does (whole numbers, nothing below zero, history lines, idempotent receipts, tight shop filters), so the app code can be
// tested against the behaviour it relies on. The SQL itself is syntax-checked separately and has not been run against a database.

const err = (code, message) => Object.assign(new Error(message), { code, message })
const round2 = n => Math.round(n * 100) / 100

function nextPoNumber(db, shopId) {
  const t = (db.tables.po_counters ||= [])
  let row = t.find(r => r.shop_id === shopId)
  if (!row) { row = { shop_id: shopId, next_number: 1 }; t.push(row) }
  const n = row.next_number++
  return `PO-${n < 10000 ? String(n).padStart(4, '0') : n}`
}

export function inventoryRpc() {
  const find = (db, table, where) => (db.tables[table] || []).find(r => Object.entries(where).every(([k, v]) => r[k] === v))
  const history = (db, h) => { (db.tables.part_history ||= []).push({ id: (db.tables.part_history.length || 0) + 1, at: new Date().toISOString(), reason: '', reference: '', note: '', ...h }) }

  function applyDelta(a, db) {
    if (!['qty_on_hand', 'qty_on_order', 'qty_reorder'].includes(a.p_field)) throw err('22023', 'That field cannot be changed here')
    if ((a.p_delta == null) === (a.p_set == null)) throw err('22023', 'Give either an amount to add or take, or a new count')
    const row = find(db, 'inventory', { id: a.p_part_id, shop_id: a.p_shop_id })
    if (!row) throw err('P0002', 'That part was not found')
    const old = row[a.p_field] ?? null
    let next = a.p_set != null ? a.p_set : (old ?? 0) + a.p_delta
    if (!Number.isInteger(next)) throw err('22023', 'A count has to be a whole number')
    if (a.p_clamp) next = Math.max(0, next)
    else if (next < 0 && next < (old ?? 0)) throw err('23514', 'That would take the count below zero')
    if (next > 1000000) throw err('23514', 'That count is too large')
    if (old !== next) {
      row[a.p_field] = next; row.updated_at = new Date().toISOString()
      history(db, { shop_id: a.p_shop_id, part_id: a.p_part_id, actor_id: a.p_actor_id, actor_name: a.p_actor_name || '', field: a.p_field, old_value: old, new_value: next, reason: a.p_reason || '', reference: a.p_reference || '', note: a.p_note || '' })
    }
    return { old, new: next, changed: old !== next }
  }

  return {
    inventory_apply_delta: applyDelta,

    inventory_set_prices(a, db) {
      if (!Array.isArray(a.p_changes) || a.p_changes.length === 0 || a.p_changes.length > 2000) throw err('22023', 'Send between 1 and 2000 price changes')
      let changed = 0, skipped = 0
      for (const c of a.p_changes) {
        const row = c.part_id && find(db, 'inventory', { id: c.part_id, shop_id: a.p_shop_id })
        if (!row || c.to_price == null || c.to_price < 0) { skipped++; continue }
        const cur = row.retail_price ?? null
        const same = c.from_price == null ? cur == null : cur != null && round2(c.from_price) === round2(cur)
        if (!same) { skipped++; continue }
        if (cur === c.to_price) continue
        row.retail_price = round2(c.to_price)
        history(db, { shop_id: a.p_shop_id, part_id: c.part_id, actor_id: a.p_actor_id, actor_name: a.p_actor_name, field: 'retail_price', old_value: cur, new_value: row.retail_price, reason: a.p_reason })
        changed++
      }
      return { changed, skipped }
    },

    next_po_number: (a, db) => nextPoNumber(db, a.p_shop_id),

    po_save_draft(a, db) {
      if (!Array.isArray(a.p_lines) || a.p_lines.length === 0 || a.p_lines.length > 200) throw err('22023', 'An order needs between 1 and 200 lines')
      if (a.p_vendor_id && !find(db, 'vendors', { id: a.p_vendor_id, shop_id: a.p_shop_id })) throw err('P0002', 'That vendor was not found')
      for (const l of a.p_lines) if (l.part_id && !find(db, 'inventory', { id: l.part_id, shop_id: a.p_shop_id })) throw err('P0002', 'A part on this order is not in your inventory')
      const orders = (db.tables.purchase_orders ||= [])
      const lines = (db.tables.purchase_order_lines ||= [])
      let po
      if (!a.p_po_id) {
        po = { id: `po-${orders.length + 1}`, shop_id: a.p_shop_id, po_number: nextPoNumber(db, a.p_shop_id), vendor_id: a.p_vendor_id, vendor_name: a.p_vendor_name, status: 'draft', notes: a.p_notes || null, expected_on: a.p_expected_on, created_at: new Date().toISOString(), send_started_at: null }
        orders.push(po)
      } else {
        po = find(db, 'purchase_orders', { id: a.p_po_id, shop_id: a.p_shop_id })
        if (!po) throw err('P0002', 'That order was not found')
        if (po.status !== 'draft') throw err('P0001', 'Only a draft order can be changed')
        Object.assign(po, { vendor_id: a.p_vendor_id, vendor_name: a.p_vendor_name, notes: a.p_notes || null, expected_on: a.p_expected_on })
        for (let i = lines.length - 1; i >= 0; i--) if (lines[i].po_id === po.id && lines[i].shop_id === a.p_shop_id) lines.splice(i, 1)
      }
      a.p_lines.forEach((l, i) => lines.push({ id: `${po.id}-l${i + 1}-${lines.length}`, shop_id: a.p_shop_id, po_id: po.id, position: i + 1, part_id: l.part_id || null, description: l.description, sku: l.sku || null, qty: l.qty, unit_cost: l.unit_cost, core_charge: l.core_charge || 0, qty_received: 0 }))
      return { id: po.id, po_number: po.po_number }
    },

    po_mark_sent(a, db) {
      const po = find(db, 'purchase_orders', { id: a.p_po_id, shop_id: a.p_shop_id })
      if (!po) throw err('P0002', 'That order was not found')
      if (['sent', 'partial', 'received'].includes(po.status)) return { already: true, status: po.status }
      if (po.status === 'cancelled') throw err('P0001', 'This order was cancelled')
      Object.assign(po, { status: 'sent', sent_at: new Date().toISOString(), sent_to: a.p_sent_to, sent_via: a.p_via === 'email' ? 'email' : 'manual', send_started_at: po.send_started_at || new Date().toISOString() })
      for (const l of db.tables.purchase_order_lines.filter(x => x.po_id === po.id && x.shop_id === a.p_shop_id && x.part_id)) {
        try { applyDelta({ p_shop_id: a.p_shop_id, p_part_id: l.part_id, p_field: 'qty_on_order', p_delta: l.qty, p_set: null, p_actor_id: a.p_actor_id, p_actor_name: a.p_actor_name, p_reason: 'ordered', p_reference: po.po_number, p_note: '', p_clamp: true }, db) } catch (e) { if (e.code !== 'P0002') throw e }
      }
      return { already: false, status: 'sent' }
    },

    po_cancel(a, db) {
      const po = find(db, 'purchase_orders', { id: a.p_po_id, shop_id: a.p_shop_id })
      if (!po) throw err('P0002', 'That order was not found')
      if (po.status === 'cancelled') return { already: true, status: 'cancelled' }
      if (po.status === 'received') throw err('P0001', 'This order was fully received, so it cannot be cancelled')
      if (['sent', 'partial'].includes(po.status)) {
        for (const l of db.tables.purchase_order_lines.filter(x => x.po_id === po.id && x.shop_id === a.p_shop_id && x.part_id)) {
          const out = Math.max(0, l.qty - l.qty_received)
          if (out > 0) try { applyDelta({ p_shop_id: a.p_shop_id, p_part_id: l.part_id, p_field: 'qty_on_order', p_delta: -out, p_set: null, p_actor_id: a.p_actor_id, p_actor_name: a.p_actor_name, p_reason: 'cancelled', p_reference: po.po_number, p_note: '', p_clamp: true }, db) } catch (e) { if (e.code !== 'P0002') throw e }
        }
      }
      Object.assign(po, { status: 'cancelled', cancelled_at: new Date().toISOString() })
      return { already: false, status: 'cancelled' }
    },

    receive_po_lines(a, db) {
      if (!['keep', 'latest', 'average'].includes(a.p_cost_method)) throw err('22023', 'Choose how to update the cost')
      if (!a.p_receipt_key || a.p_receipt_key.length < 8) throw err('22023', 'A receipt key is required')
      if (!Array.isArray(a.p_items) || a.p_items.length === 0) throw err('22023', 'Enter how many of at least one part arrived')
      const po = find(db, 'purchase_orders', { id: a.p_po_id, shop_id: a.p_shop_id })
      if (!po) throw err('P0002', 'That order was not found')
      const receipts = (db.tables.po_receipts ||= [])
      const prior = receipts.find(r => r.po_id === po.id && r.receipt_key === a.p_receipt_key)
      if (prior) return { duplicate: true, status: po.status, lines: prior.lines, missing: [] }
      if (!['sent', 'partial'].includes(po.status)) throw err('P0001', 'Only a sent order can be received')
      // Work on copies so a failure part way leaves nothing changed, like a transaction.
      const snapshot = JSON.stringify([db.tables.purchase_order_lines, db.tables.inventory, db.tables.part_history || []])
      try {
        const done = [], missing = []
        for (const it of a.p_items) {
          if (!it.qty) continue
          if (it.qty < 0 || it.qty > 100000) throw err('22023', 'Enter how many arrived, 0 or more')
          const ln = db.tables.purchase_order_lines.find(l => l.id === it.line_id && l.po_id === po.id && l.shop_id === a.p_shop_id)
          if (!ln) throw err('P0002', 'A line on this receipt is not on the order')
          if (ln.qty_received + it.qty > ln.qty && !a.p_allow_over) throw err('23514', `More arrived than was ordered for ${ln.description}. Confirm if the vendor really sent extra.`)
          ln.qty_received += it.qty
          if (ln.part_id) {
            const part = find(db, 'inventory', { id: ln.part_id, shop_id: a.p_shop_id })
            if (part) {
              const had = Math.max(0, part.qty_on_hand ?? 0)
              let cost = part.cost ?? null
              if (ln.unit_cost > 0) {
                if (a.p_cost_method === 'latest') cost = round2(ln.unit_cost)
                else if (a.p_cost_method === 'average') cost = round2((had * (part.cost ?? 0) + it.qty * ln.unit_cost) / (had + it.qty))
              }
              const before = { hand: part.qty_on_hand, order: part.qty_on_order, cost: part.cost }
              part.qty_on_hand = had + it.qty; part.qty_on_order = Math.max(0, (part.qty_on_order ?? 0) - it.qty); part.cost = cost
              history(db, { shop_id: a.p_shop_id, part_id: part.id, actor_id: a.p_actor_id, actor_name: a.p_actor_name, field: 'qty_on_hand', old_value: before.hand, new_value: part.qty_on_hand, reason: 'received', reference: po.po_number })
              if ((before.order ?? 0) > 0) history(db, { shop_id: a.p_shop_id, part_id: part.id, actor_id: a.p_actor_id, actor_name: a.p_actor_name, field: 'qty_on_order', old_value: before.order, new_value: part.qty_on_order, reason: 'received', reference: po.po_number })
              if (cost !== before.cost) history(db, { shop_id: a.p_shop_id, part_id: part.id, actor_id: a.p_actor_id, actor_name: a.p_actor_name, field: 'cost', old_value: before.cost, new_value: cost, reason: 'received', reference: po.po_number })
            } else missing.push(ln.description)
          }
          done.push({ line_id: ln.id, qty: it.qty, description: ln.description })
        }
        if (!done.length) throw err('22023', 'Enter how many of at least one part arrived')
        const mine = db.tables.purchase_order_lines.filter(l => l.po_id === po.id && l.shop_id === a.p_shop_id)
        const units = mine.reduce((s, l) => s + l.qty, 0), recv = mine.reduce((s, l) => s + Math.min(l.qty, l.qty_received), 0)
        po.status = units > 0 && recv >= units ? 'received' : recv > 0 ? 'partial' : 'sent'
        if (po.status === 'received') po.received_at = new Date().toISOString()
        receipts.push({ po_id: po.id, shop_id: a.p_shop_id, receipt_key: a.p_receipt_key, lines: done })
        return { duplicate: false, status: po.status, lines: done, missing }
      } catch (e) {
        const [lines, inv, hist] = JSON.parse(snapshot)
        db.tables.purchase_order_lines.splice(0, db.tables.purchase_order_lines.length, ...lines)
        db.tables.inventory.splice(0, db.tables.inventory.length, ...inv)
        ;(db.tables.part_history ||= []).splice(0, db.tables.part_history.length, ...hist)
        throw e
      }
    },
  }
}
