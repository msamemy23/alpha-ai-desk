import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WEB_LEADS_WAITING_MAX, WEB_SOURCE, captureLead, cleanCapture, last10, saveWebLead, storePhone } from '../src/lib/lead-capture.ts'
import { checkQuoteForm, cleanQuote } from '../src/lib/quote.ts'
import { DEFAULT_ONLINE, cleanOnline, publicView } from '../src/lib/booking.ts'
import { cleanCapacity } from '../src/lib/schedule-capacity.ts'
import { fakeDb } from './helpers/leads-fake-db.mjs'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const SHOP = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-16T18:00:00Z')
const TODAY = '2026-10-16'

test('phone numbers are stored one way, and a number that cannot be one is refused', () => {
  assert.equal(storePhone('(713) 555-0142'), '+17135550142')
  assert.equal(storePhone('713.555.0142'), '+17135550142')
  assert.equal(storePhone('1 713 555 0142'), '+17135550142')
  assert.equal(storePhone('+17135550142'), '+17135550142')
  assert.equal(storePhone('12345'), null)
  assert.equal(storePhone('call me'), null)
  assert.equal(last10('+1 (713) 555-0142'), '7135550142')
})

test('a lead needs a name or a number, and what is typed is tidied', () => {
  assert.equal(cleanCapture({}).ok, false)
  assert.match(cleanCapture({}).error, /name or a phone/i)
  assert.match(cleanCapture({ phone: '12' }).error, /10-digit/)
  assert.match(cleanCapture({ name: 'A', email: 'nope' }).error, /email/i)
  const ok = cleanCapture({ name: '  Dana   <b>Ruiz</b> ', phone: '713-555-0142', notes: 'x'.repeat(5000), source: 'Phone Call' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.name, 'Dana bRuiz/b')
  assert.equal(ok.value.phone, '+17135550142')
  assert.equal(ok.value.notes.length, 1500)
  assert.equal(ok.value.source, 'Phone Call')
  assert.equal(ok.value.needsFollowup, true)
  assert.equal(cleanCapture({ name: 'Dana', needs_followup: false }).value.needsFollowup, false)
})

test('a call saved as a lead lands in the Leads tab table and the follow-up table, tomorrow is the follow-up day', async () => {
  const db = fakeDb({ leads: [], growth_leads: [] })
  const r = await captureLead(db, SHOP, { name: 'Dana', phone: '(713) 555-0142', source: 'Phone Call', service: 'Brakes', notes: 'Called today. Squealing.' }, NOW, TODAY)
  assert.equal(r.ok, true)
  assert.equal(r.status, 'created')
  assert.match(r.message, /Dana was saved as a lead/)
  assert.equal(db.tables.leads.length, 1)
  assert.equal(db.tables.growth_leads.length, 1)
  const lead = db.tables.leads[0]
  assert.deepEqual([lead.shop_id, lead.name, lead.phone, lead.source, lead.status, lead.service_needed, lead.follow_up_date], [SHOP, 'Dana', '+17135550142', 'Phone Call', 'new', 'Brakes', '2026-10-17'])
  assert.equal(lead.notes, '2026-10-16: Called today. Squealing.')
  const g = db.tables.growth_leads[0]
  assert.deepEqual([g.shop_id, g.phone, g.status, g.needs_followup, g.converted, g.touch_count], [SHOP, '+17135550142', 'new', true, false, 1])
})

test('saving the same person again, typed another way, updates the first lead and never makes a second', async () => {
  const db = fakeDb({
    leads: [{ id: 'L1', shop_id: SHOP, name: 'Dana', phone: '(713) 555-0142', status: 'contacted', notes: 'Texted Monday.', created_at: '2026-10-10T10:00:00Z' }],
    growth_leads: [{ id: 'G1', shop_id: SHOP, name: 'Dana', phone: '+17135550142', touch_count: 2, notes: 'old' }],
  })
  const r = await captureLead(db, SHOP, { phone: '713 555 0142', notes: 'Called again about tires.' }, NOW, TODAY)
  assert.equal(r.ok, true)
  assert.equal(r.status, 'updated')
  assert.match(r.message, /already one of your leads/)
  assert.equal(db.tables.leads.length, 1)
  assert.equal(db.tables.growth_leads.length, 1)
  assert.equal(db.tables.leads[0].status, 'contacted', 'a lead the shop already worked is not pushed back to new')
  assert.equal(db.tables.leads[0].notes, 'Texted Monday.\n---\n2026-10-16: Called again about tires.')
  assert.equal(db.tables.growth_leads[0].touch_count, 3)
})

test('a placeholder name is replaced by a real one; a real name is not overwritten', async () => {
  const db = fakeDb({ leads: [{ id: 'L1', shop_id: SHOP, name: 'Past Caller', phone: '+17135550142', status: 'new' }, { id: 'L2', shop_id: SHOP, name: 'Maria Lopez', phone: '+17135550199', status: 'new' }], growth_leads: [] })
  await captureLead(db, SHOP, { name: 'Dana Ruiz', phone: '+17135550142' }, NOW, TODAY)
  await captureLead(db, SHOP, { name: 'Somebody Else', phone: '+17135550199' }, NOW, TODAY)
  assert.equal(db.tables.leads.find(l => l.id === 'L1').name, 'Dana Ruiz')
  assert.equal(db.tables.leads.find(l => l.id === 'L2').name, 'Maria Lopez')
})

test('if only one of the two tables has the lead, the other is filled in; research notes Alpha wrote are left alone', async () => {
  const db = fakeDb({ leads: [{ id: 'L1', shop_id: SHOP, name: 'Fleet Co', phone: '+17135550142', status: 'new', notes: '{"owner":"Sam","fleet":12}' }], growth_leads: [] })
  const r = await captureLead(db, SHOP, { name: 'Fleet Co', phone: '+17135550142', notes: 'Called.' }, NOW, TODAY)
  assert.equal(r.ok, true)
  assert.equal(db.tables.leads.length, 1)
  assert.equal(db.tables.leads[0].notes, '{"owner":"Sam","fleet":12}')
  assert.equal(db.tables.growth_leads.length, 1)
})

test('another shop\'s lead with the same number is never touched', async () => {
  const db = fakeDb({ leads: [{ id: 'X1', shop_id: OTHER, name: 'Theirs', phone: '+17135550142', status: 'new', notes: 'private' }], growth_leads: [{ id: 'X2', shop_id: OTHER, phone: '+17135550142', touch_count: 1 }] })
  const r = await captureLead(db, SHOP, { name: 'Dana', phone: '+17135550142' }, NOW, TODAY)
  assert.equal(r.status, 'created')
  assert.equal(db.tables.leads.length, 2)
  assert.equal(db.tables.leads.find(l => l.id === 'X1').notes, 'private')
  assert.equal(db.tables.growth_leads.find(l => l.id === 'X2').touch_count, 1)
})

test('a failed save says it plainly and never throws', async () => {
  const db = fakeDb({ leads: [], growth_leads: [] }, { fail: { 'leads.insert': { code: '23505', message: 'duplicate key value violates unique constraint "leads_pkey"' } } })
  const r = await captureLead(db, SHOP, { name: 'Dana', phone: '+17135550142' }, NOW, TODAY)
  assert.equal(r.ok, false); assert.equal(r.status, 500)
  assert.match(r.error, /could not be saved/i); assert.doesNotMatch(r.error, /duplicate key|leads_pkey/)
  const bad = await captureLead(db, SHOP, { phone: '12' }, NOW, TODAY)
  assert.equal(bad.status, 400)
})

/* ---------- the public form ---------- */

const good = { name: 'Dana Ruiz', phone: '(713) 555-0142', vehicle: '2018 Toyota Camry', message: 'Squealing when I brake. How much for pads?', email: '' }

test('the price form is checked the same way on the page and on the server', () => {
  assert.deepEqual(checkQuoteForm(good), {})
  assert.equal(cleanQuote(good).ok, true)
  assert.equal(cleanQuote(good).value.phone, '+17135550142')
  const bad = checkQuoteForm({ name: 'A', phone: '123', vehicle: 'x', message: 'hi', email: 'nope' })
  assert.deepEqual(Object.keys(bad).sort(), ['email', 'message', 'name', 'phone', 'vehicle'])
  assert.ok(checkQuoteForm({ ...good, message: 'Cheap pills at www.spam.com' }).message)
  assert.ok(checkQuoteForm({ ...good, name: 'Buy now http://x.co' }).name)
  assert.ok(checkQuoteForm({ ...good, vehicle: 'see x.ru' }).vehicle)
  assert.equal(checkQuoteForm({ ...good, name: 'José O\'Brien-Martínez' }).name, undefined)
  assert.equal(checkQuoteForm({ ...good, email: 'dana@example.com' }).email, undefined)
  const server = cleanQuote({ ...good, phone: '5555555555' })
  assert.equal(server.ok, false); assert.equal(server.field, 'phone')
  assert.equal(cleanQuote(null).ok, false)
})

test('a request from the price form becomes one lead on the Leads tab, source Website, and nothing else', async () => {
  const db = fakeDb({ leads: [], growth_leads: [] })
  const v = cleanQuote(good).value
  const r = await saveWebLead(db, SHOP, v, TODAY, NOW)
  assert.deepEqual(r, { ok: true, status: 'created' })
  assert.equal(db.tables.leads.length, 1)
  const l = db.tables.leads[0]
  assert.deepEqual([l.shop_id, l.name, l.phone, l.source, l.status, l.follow_up_date], [SHOP, 'Dana Ruiz', '+17135550142', WEB_SOURCE, 'new', TODAY])
  assert.match(l.notes, /Vehicle: 2018 Toyota Camry/); assert.match(l.notes, /Squealing/)
  assert.equal(db.tables.growth_leads.length, 0, 'a number a stranger typed is never enrolled in the follow-up texts')
  assert.equal(db.tables.messages, undefined)
})

test('asking twice from the same number adds to the first request instead of piling up', async () => {
  const db = fakeDb({ leads: [] })
  const v = cleanQuote(good).value
  await saveWebLead(db, SHOP, v, TODAY, NOW)
  const again = await saveWebLead(db, SHOP, { ...v, message: 'Also need an oil change.', email: 'dana@example.com' }, '2026-10-17', new Date('2026-10-17T15:00:00Z'))
  assert.deepEqual(again, { ok: true, status: 'repeat' })
  assert.equal(db.tables.leads.length, 1)
  assert.match(db.tables.leads[0].notes, /Squealing[\s\S]*Also need an oil change/)
  assert.equal(db.tables.leads[0].email, 'dana@example.com')
  assert.equal(db.tables.leads[0].status, 'new')
})

test('an old, closed lead does not swallow a new request', async () => {
  const db = fakeDb({ leads: [{ id: 'old', shop_id: SHOP, phone: '+17135550142', status: 'lost', created_at: '2026-05-01T10:00:00Z', notes: 'x' }] })
  const r = await saveWebLead(db, SHOP, cleanQuote(good).value, TODAY, NOW)
  assert.equal(r.status, 'created')
  assert.equal(db.tables.leads.length, 2)
})

test('the page has a ceiling on waiting requests, and a failure is reported as a failure', async () => {
  const waiting = Array.from({ length: WEB_LEADS_WAITING_MAX }, (_, i) => ({ id: `w${i}`, shop_id: SHOP, source: WEB_SOURCE, status: 'new', phone: `+1713555${String(1000 + i)}` }))
  const full = fakeDb({ leads: waiting })
  assert.deepEqual(await saveWebLead(full, SHOP, cleanQuote(good).value, TODAY, NOW), { ok: false, status: 'busy' })
  assert.equal(full.tables.leads.length, WEB_LEADS_WAITING_MAX)
  const broken = fakeDb({ leads: [] }, { fail: { 'leads.insert': { message: 'boom' } } })
  assert.deepEqual(await saveWebLead(broken, SHOP, cleanQuote(good).value, TODAY, NOW), { ok: false, status: 'failed' })
})

test('the setting is off until the shop turns it on, and a stranger learns only whether the link exists', () => {
  assert.equal(DEFAULT_ONLINE.quotes, false)
  assert.equal(cleanOnline({}).quotes, false)
  assert.equal(cleanOnline({ quotes: 'yes' }).quotes, false)
  assert.equal(cleanOnline({ quotes: true }).quotes, true)
  const pub = publicView({ name: 'X', phone: '1' }, cleanCapacity({}), { ...DEFAULT_ONLINE, quotes: true })
  assert.equal(pub.quotes, true)
  assert.deepEqual(Object.keys(pub).sort(), ['closedDates', 'daysAhead', 'hours', 'intro', 'name', 'phone', 'quotes', 'services'])
})

test('the public route shuts the same doors as the booking request, and only shops that turned it on take requests', () => {
  const route = src('app/api/book/lead/route.ts')
  const book = src('app/api/book/request/route.ts')
  for (const door of ['sameOrigin(', 'HONEYPOT', "overLimit('book-lead'", 'verifyFormToken(', 'loadBySlug(', "overLimit('lead-phone'"]) assert.ok(route.includes(door), door)
  for (const door of ['sameOrigin(', 'HONEYPOT', 'verifyFormToken(']) assert.ok(book.includes(door))
  assert.match(route, /!shop\.online\.quotes\) return json\(\{ ok: false/)
  assert.match(route, /cleanQuote\(body\)/)
  // Nothing is sent from a route a stranger can reach.
  assert.doesNotMatch(route, /sendSms|send-sms|sendEmail|sendMessage|telnyx|resend/i)
  assert.doesNotMatch(route, /growth_leads/)
  const mw = src('middleware.ts')
  assert.match(mw, /'\/api\/book',/)
  assert.match(mw, /pathname\.startsWith\('\/book\/'\)/)
})

test('the price page: one form, a hidden trap field, a clear thank-you, no sending from the page', () => {
  const view = src('components/booking/QuoteView.tsx')
  assert.equal((view.match(/<form/g) || []).length, 1)
  assert.match(view, /HONEYPOT/)
  assert.match(view, /\/api\/book\/lead/)
  assert.match(view, /checkQuoteForm\(f\)/)
  assert.match(view, /Request sent/)
  assert.match(view, /!shop\.quotes/)
  const booking = src('components/booking/BookingView.tsx')
  assert.match(booking, /shop\.quotes && /)
  assert.match(booking, /\/quote`/)
  const settings = src('components/schedule/SettingsParts.tsx')
  assert.match(settings, /Let visitors ask for a price/)
  assert.match(settings, /set\('quotes', e\.target\.checked\)/)
})

test('a call can be saved as a lead from its screen, and the screen says where the lead went', () => {
  const detail = src('components/inbox/CallDetail.tsx')
  assert.match(detail, /number && !customerId && !name && lead === null && onSaveLead/)
  assert.match(detail, /On your Leads list/)
  assert.match(detail, /Save as a lead/)
  const sheet = src('components/inbox/LeadFromCallSheet.tsx')
  assert.match(sheet, /\/api\/growth\/capture/)
  assert.match(sheet, /action: 'capture'/)
  assert.match(sheet, /Nothing was sent to the caller/)
  assert.match(sheet, /href="\/growth\?tab=leads"/)
  assert.equal((sheet.match(/<form/g) || []).length, 1)
  const growth = src('app/(app)/growth/page.tsx')
  assert.match(growth, /get\('tab'\)/)
  const route = src('app/api/growth/capture/route.ts')
  assert.match(route, /captureLead\(/)
})
