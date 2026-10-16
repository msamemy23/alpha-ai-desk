import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import * as v from '../src/lib/inventory-view.ts'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const dirOf = (p) => readdirSync(new URL(`../src/${p}`, import.meta.url)).map(f => `${p}/${f}`)
const part = (over = {}) => ({ id: 'p1', part_number: 'MO-301', name: 'Oil filter', category: 'Filters', brand: '', cost: 4.5, retail_price: 9.99, qty_on_hand: 2, qty_reorder: 6, qty_on_order: 0, location: '', supplier: '', supplier_part_number: 'KS-301', ...over })

/* ---------- the small helpers ---------- */

test('dates in words: this year has no year, another year does, nothing or nonsense is empty', () => {
  assert.equal(v.dayWords('2026-10-14', '2026-10-16'), 'Oct 14')
  assert.equal(v.dayWords('2025-12-30T08:00:00Z', '2026-10-16'), 'Dec 30, 2025')
  assert.equal(v.dayWords(null, '2026-10-16'), '')
  assert.equal(v.dayWords('', '2026-10-16'), '')
  assert.equal(v.dayWords('not-a-date', '2026-10-16'), '')
})

test('days between two days, negative when the second is earlier', () => {
  assert.equal(v.daysBetween('2026-10-16', '2026-10-22'), 6)
  assert.equal(v.daysBetween('2026-10-16', '2026-10-16'), 0)
  assert.equal(v.daysBetween('2026-10-16', '2026-10-14'), -2)
  assert.equal(v.daysBetween('2026-02-27', '2026-03-02'), 3)
})

test('money shows cents and a dash for nothing', () => {
  assert.equal(v.usd(4.1), '$4.10')
  assert.equal(v.usd(1234.5), '$1,234.50')
  assert.equal(v.usd(0), '$0.00')
  assert.equal(v.usd(null), '—')
  assert.equal(v.usd(undefined), '—')
})

test('a banner is only added when a problem has no box of its own to show it', () => {
  assert.equal(v.needsBanner({}, ['name']), true)
  assert.equal(v.needsBanner({ name: 'x' }, ['name', 'email']), false)
  assert.equal(v.needsBanner({ name: 'x', vendor_id: 'y' }, ['name']), true)
})

test('a new line starts from the vendor price, then the part, and keeps the case size', () => {
  const prices = [{ id: 'r1', vendor_id: 'v1', part_id: 'p1', vendor_sku: 'KS-9', price: 4.1, core_charge: 0, checked_on: '2026-10-01' }, { id: 'r2', vendor_id: 'v2', part_id: 'p1', vendor_sku: '', price: 0, core_charge: 0, checked_on: null }]
  const none = new Map()
  const a = v.lineForPart(part(), 'v1', prices, none)
  assert.deepEqual([a.part_id, a.description, a.sku, a.qty, a.unit_cost, a.core_charge], ['p1', 'Oil filter', 'KS-9', '1', '4.10', ''])
  // a zero price is not a price: fall back to what the part cost
  assert.equal(v.lineForPart(part(), 'v2', prices, none).unit_cost, '4.50')
  // no vendor chosen: the part's own number and cost
  const b = v.lineForPart(part(), '', prices, none)
  assert.deepEqual([b.sku, b.unit_cost], ['KS-301', '4.50'])
  // sold by the case of 6, with a core charge on the part
  const extras = new Map([['p1', { part_id: 'p1', barcode: '', max_qty: 12, order_multiple: 6, core_charge: 25, preferred_vendor_id: null }]])
  const c = v.lineForPart(part(), '', [], extras)
  assert.deepEqual([c.qty, c.core_charge], ['6', '25.00'])
  assert.equal(v.lineForPart(part(), '', [], extras, 12).qty, '12')
  assert.notEqual(v.lineForPart(part(), '', [], none).key, v.lineForPart(part(), '', [], none).key)
})

test('changing a draft starts from what is saved, every box as text', () => {
  const seed = v.seedFrom({ id: 'o1', vendor_id: null, vendor_name: 'Local Parts Co', expected_on: null, notes: 'Back door', lines: [{ id: 'l1', part_id: 'p1', description: 'Oil filter', sku: 'KS-301', qty: 12, unit_cost: 4.1, core_charge: 0, qty_received: 0 }, { id: 'l2', part_id: null, description: 'Alternator', sku: '', qty: 1, unit_cost: 88, core_charge: 25, qty_received: 0 }] })
  assert.deepEqual([seed.id, seed.vendor_id, seed.vendor_name, seed.expected_on, seed.notes], ['o1', '', 'Local Parts Co', '', 'Back door'])
  assert.deepEqual(seed.lines.map(l => [l.description, l.qty, l.unit_cost, l.core_charge]), [['Oil filter', '12', '4.10', ''], ['Alternator', '1', '88.00', '25.00']])
  assert.equal(new Set(seed.lines.map(l => l.key)).size, 2)
  assert.deepEqual(v.emptySeed().lines, [])
})

/* ---------- the screens are wired to the server, and only through it ---------- */

test('every action the screens send is one the route answers', () => {
  const route = src('app/api/inventory/route.ts')
  const answered = new Set([...route.matchAll(/case '([a-z-]+)'/g)].map(m => m[1]))
  const sent = new Set()
  for (const f of [...dirOf('components/inventory'), 'app/(app)/inventory/page.tsx']) {
    if (!/\.tsx?$/.test(f)) continue
    for (const m of src(f).matchAll(/action: '([a-z-]+)'/g)) sent.add(m[1])
  }
  assert.ok(sent.size >= 12, `expected the screens to send a dozen actions, found ${[...sent]}`)
  for (const a of sent) assert.ok(answered.has(a), `the route has no case for ${a}`)
  for (const a of ['po-save', 'po-preview', 'po-send', 'po-mark-sent', 'po-cancel', 'po-receive', 'vendor-save', 'vendor-active', 'price-save', 'price-remove', 'return-save', 'adjust']) assert.ok(sent.has(a), `no screen sends ${a}`)
})

test('the new screens never talk to the database directly', () => {
  for (const f of dirOf('components/inventory')) {
    if (!/\.tsx?$/.test(f) || /PartFormFields|PartRows|types\.ts/.test(f)) continue
    assert.doesNotMatch(src(f), /@\/lib\/supabase/, `${f} reaches the database from the browser`)
    // server code may be named for its types, never pulled in
    assert.doesNotMatch(src(f), /import (?!type)[^\n]*from '@\/lib\/inventory-store'/, `${f} imports server code at runtime`)
  }
})

test('the route says what the person may do, so the buttons can follow it', () => {
  const route = src('app/api/inventory/route.ts')
  assert.match(route, /canBuy: canBuy\(c\.ctx\.role\), canAdjust: canAdjust\(c\.ctx\.role\)/)
  const hook = src('components/inventory/useStock.ts')
  assert.match(hook, /canBuy: boolean/)
  assert.match(hook, /canAdjust: boolean/)
})

test('buying is for owners and managers, counting and receiving for everyone but a viewer', () => {
  assert.match(src('components/inventory/OrdersPanel.tsx'), /stock\.canBuy && <button[\s\S]{0,120}onClick=\{startNew\}/)
  const detail = src('components/inventory/OrderDetail.tsx')
  assert.match(detail, /po\.status === 'draft' && canBuy && <button[^>]*onClick=\{onSend\}/)
  assert.match(detail, /open && canAdjust && <button[^>]*onClick=\{onReceive\}/)
  assert.match(detail, /\(po\.status === 'draft' \|\| open\) && canBuy && <button[^>]*onClick=\{onCancel\}/)
  assert.match(src('components/inventory/OrderSheets.tsx'), /canBuy=\{stock\.canBuy\} canAdjust=\{stock\.canAdjust\}/)
  assert.match(src('components/inventory/ReorderPanel.tsx'), /stock\.canBuy && <button[\s\S]{0,120}make\(g\)/)
  assert.match(src('components/inventory/VendorsPanel.tsx'), /const canEdit = stock\.canBuy/)
  assert.match(src('components/inventory/ReturnsPanel.tsx'), /stock\.canAdjust && <button[\s\S]{0,120}setEditing\('new'\)/)
})

test('an order is only emailed after its exact message was shown, with the token it came with', () => {
  const send = src('components/inventory/SendOrder.tsx')
  assert.match(send, /action: 'po-preview'/)
  assert.match(send, /action: 'po-send', id: po\.id, token: preview\.token/)
  assert.match(send, /disabled=\{sending \|\| noEmail\}/)
  // an order that changed under the person is shown again, never sent
  assert.match(send, /The order or the vendor changed/)
  // sending is not the only way out: the person can say they sent it themselves
  assert.match(send, /I already sent it/)
  assert.match(src('components/inventory/OrderSheets.tsx'), /could not record that\. Open the order and tap I already sent it/)
})

test('a delivery is checked in once, with a key made when the sheet opened', () => {
  const r = src('components/inventory/ReceiveOrder.tsx')
  assert.match(r, /useState\(\(\) => newKey\('rcv'\)\)/)
  assert.match(r, /useState<CostMethod>\('keep'\)/)
  assert.match(r, /receipt_key: key, items: items\.filter\(i => i\.qty > 0\)/)
  assert.match(r, /allow_over: allowOver/)
  // the extra is only allowed when the person ticks the box
  assert.match(r, /The vendor really sent the extra/)
  assert.match(r, /action: 'po-receive'/)
})

test('marking sent and cancelling say what they do and do not do', () => {
  const s = src('components/inventory/OrderSheets.tsx')
  assert.match(s, /Alpha Desk does not email anything now/)
  assert.match(s, /Alpha Desk does not tell the vendor, so call or email them yourself/)
  assert.match(s, /Nothing was sent to the vendor, and your counts do not change/)
  assert.match(s, /come off your on-order counts/)
})

test('count changes go through the server, which writes who changed them', () => {
  const page = src('app/(app)/inventory/page.tsx')
  const flush = page.slice(page.indexOf('const flush = async'), page.indexOf('const adjust = (id: string'))
  assert.match(flush, /action: 'adjust', adjust: \{ part_id: id, field: 'qty_on_hand', delta \}/)
  assert.doesNotMatch(flush, /supabase\.from\('inventory'\)/)
  // the form: counts that changed go through the same route, with the reason the person picked
  assert.match(page, /const \{ qty_on_hand: _h, qty_on_order: _o, qty_reorder: _r, \.\.\.details \} = row/)
  assert.match(page, /field: k, set: row\[k\], reason: k === 'qty_on_hand' \? countReason/)
  assert.match(page, /Everything except the .* number was saved/)
  // the reason is asked only when the on-hand number changed
  const form = src('components/inventory/PartFormFields.tsx')
  assert.match(form, /countChanged && \(/)
  assert.match(form, /ADJUST_REASONS\.map/)
  assert.match(form, /onCountReason\('received'\)/)
  assert.match(form, /Who changed the numbers/)
})

test('the five sections are tabs, and adding a part belongs to the parts tab only', () => {
  const page = src('app/(app)/inventory/page.tsx')
  for (const k of ['parts', 'reorder', 'orders', 'vendors', 'returns']) assert.match(page, new RegExp(`value: '${k}'`))
  assert.match(page, /view === 'parts' && <button[^>]*onClick=\{openNew\}/)
  assert.match(src('components/inventory/SectionTabs.tsx'), /role="tablist"/)
  assert.match(src('components/inventory/SectionTabs.tsx'), /ArrowRight/)
})

test('a part of the database that is not updated yet says so instead of looking empty', () => {
  const n = src('components/inventory/StockNotice.tsx')
  assert.match(n, /r\.state === 'needs-update'/)
  assert.match(n, /does not change your parts counts or invoices/)
  for (const f of ['OrdersPanel', 'VendorsPanel', 'ReturnsPanel']) assert.match(src(`components/inventory/${f}.tsx`), /stock\.\w+\.state !== 'ok'/)
  assert.match(src('components/inventory/HistorySheet.tsx'), /needs-update/)
})

test('the reorder list keeps a draft in view and never makes an order by itself', () => {
  const r = src('components/inventory/ReorderPanel.tsx')
  assert.match(r, /You already have a draft/)
  assert.match(r, /kind: 'new'/)
  assert.doesNotMatch(r, /po-save|po-send|act\(/)
})

test('the screens follow the design rules: no colours, emoji, shadows, gradients or capitals of their own', () => {
  for (const f of [...dirOf('components/inventory'), 'lib/inventory-view.ts']) {
    if (!/\.tsx?$/.test(f) || /PartFormFields|PartRows|types\.ts/.test(f)) continue
    const s = src(f)
    assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b/, `${f} has a colour of its own`)
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${f} has an emoji`)
    assert.doesNotMatch(s, /className="[^"]*\b(uppercase|shadow|bg-gradient)/, `${f} breaks the look`)
  }
})

test('a screen that sits inside a form is never a form itself (the browser would send the outer one and reload the page)', () => {
  // VendorsPanel's sheet is one form and shows VendorPrices inside it.
  assert.match(src('components/inventory/VendorsPanel.tsx'), /<form[\s\S]*<VendorPrices[\s\S]*<\/form>/)
  const prices = src('components/inventory/VendorPrices.tsx')
  assert.doesNotMatch(prices, /<form[\s>]/)
  assert.doesNotMatch(prices, /type="submit"/)
  assert.match(prices, /e\.key === 'Enter'/)
  // And no panel puts one of the form screens inside another form.
  for (const f of dirOf('components/inventory').filter(f => f.endsWith('.tsx'))) {
    const forms = (src(f).match(/<form[\s>]/g) || []).length
    assert.ok(forms <= 1, `${f} has ${forms} forms`)
  }
})
