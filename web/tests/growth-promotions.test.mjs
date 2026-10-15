import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanInput, continuePromotion, createPromotion, deletePromotion, deriveStatus, emptyCounts, listPromotions,
  parseSendAt, previewPromotion, savePromotion, sendPromotion, stopPromotion,
} from '../src/lib/growth-promotions.ts'
import { drainShop } from '../src/lib/automation-engine.ts'
import { normalizeRules } from '../src/lib/automation-rules.ts'
import { createFake, customer, emptyRaw, enabledState, fakeShop, SHOP_ID } from './helpers/automation-fake.mjs'
import { createPromotionFake } from './helpers/promotion-fake.mjs'

const H = 3_600_000
const D = 86_400_000
const AFTERNOON = Date.parse('2026-10-14T20:00:00Z') // 3pm in Houston, a Wednesday
const NIGHT = Date.parse('2026-10-15T03:00:00Z') // 10pm in Houston

function shop(extra = {}, start = AFTERNOON, shopOverrides = {}) {
  const raw = emptyRaw()
  raw.customers = [
    customer('c1', 'Marcus Bell', '7135550101'),
    customer('c2', 'Dana Ruiz', '7135550102'),
    customer('c3', 'Lee Park', '7135550103'),
  ]
  raw.customers[0].tags = ['fleet']
  const f = createFake({ shop: fakeShop(shopOverrides), raw, start, ...extra })
  return { f, ...createPromotionFake(f) }
}

const GOOD = { name: 'October brake special', message: 'Hi {name}, {shop} is running a brake check this month. {contact}.', email_subject: '', audience: {} }
const input = (extra = {}) => cleanInput({ ...GOOD, ...extra }).value

async function draft(s, extra = {}) {
  return createPromotion(s.store, SHOP_ID, 'user-1', input(extra))
}

// ── What the owner typed ──────────────────────────────────────────────────

test('the form is checked in plain words before anything is saved', () => {
  assert.equal(cleanInput(GOOD).ok, true)
  assert.match(cleanInput({ ...GOOD, name: '  ' }).errors[0], /name/i)
  assert.match(cleanInput({ ...GOOD, message: '' }).errors[0], /Write the message/)
  assert.ok(cleanInput({ ...GOOD, message: 'Brake special \u{1F697}' }).errors.some(e => /emoji/i.test(e)))
  const stray = cleanInput({ ...GOOD, message: 'Hi {name}, we saw your {vehicle}.' })
  assert.equal(stray.ok, false)
  assert.match(stray.errors.join(' '), /can only use/)
  assert.match(cleanInput({ ...GOOD, email_subject: 'Re: your car' }).errors[0], /Re:/)
  assert.match(cleanInput({ ...GOOD, message: 'x'.repeat(1001) }).errors.join(' '), /1,000/)
})

test('the audience is cleaned: junk is dropped and the tag mode is kept', () => {
  const ok = cleanInput({ ...GOOD, audience: { lastVisitMinDays: '90', tags: 'fleet, vip', tagMode: 'all', minSpend: 'abc', bogus: 1 } })
  assert.deepEqual(ok.value.audience, { lastVisitMinDays: 90, tags: ['fleet', 'vip'], tagMode: 'all' })
})

test('a send time is read in the shop time zone and must be sensible', () => {
  const now = AFTERNOON
  const ok = parseSendAt({ local: '2026-10-20T10:00' }, 'America/Chicago', now)
  assert.equal(ok.ok, true)
  assert.equal(new Date(ok.at).toISOString(), '2026-10-20T15:00:00.000Z', '10am in Houston in October is 15:00 UTC')
  const winter = parseSendAt({ local: '2026-12-02T10:00' }, 'America/Chicago', now)
  assert.equal(new Date(winter.at).toISOString(), '2026-12-02T16:00:00.000Z', 'and 10am after the clocks go back is 16:00 UTC')
  assert.match(parseSendAt({ local: '2026-10-14T15:01' }, 'America/Chicago', now).error, /few minutes/)
  assert.match(parseSendAt({ local: '2027-03-01T10:00' }, 'America/Chicago', now).error, /60 days/)
  assert.match(parseSendAt({}, 'America/Chicago', now).error, /Pick a date/)
})

// ── Preview ───────────────────────────────────────────────────────────────

test('the preview shows who, the exact words and who is left out, and writes nothing', async () => {
  const s = shop({ optedOutPhones: ['7135550102'] })
  const p = await previewPromotion(s.f.deps, SHOP_ID, input())
  assert.equal(p.counts.will_receive, 2)
  assert.equal(p.counts.left_out, 1)
  assert.deepEqual(p.left_out.map(x => x.name), ['Dana Ruiz'])
  assert.match(p.left_out_by[0].label, /STOP|opted/i)
  assert.equal(p.recipients[0].text, 'Hi Marcus, Bayou City Garage is running a brake check this month. Call (713) 555-0188 or reply to this text. Reply STOP to opt out.')
  assert.equal(s.f.state.messages.length, 0)
  assert.equal(s.f.state.sent.length, 0)
})

test('the preview of a night-time or scheduled send says when it will really go', async () => {
  const s = shop({}, NIGHT)
  const p = await previewPromotion(s.f.deps, SHOP_ID, input())
  assert.equal(p.counts.held_for_quiet_hours, 3)
  assert.ok(new Date(p.first_send_iso).getTime() > NIGHT)
  const at = Date.parse('2026-10-20T15:00:00Z')
  const later = await previewPromotion(s.f.deps, SHOP_ID, input(), { sendAt: at, now: AFTERNOON })
  assert.equal(later.first_send_iso, '2026-10-20T15:00:00.000Z')
})

test('an audience can be counted before any message is written', async () => {
  const s = shop()
  const p = await previewPromotion(s.f.deps, SHOP_ID, input({ message: 'Hi {name}, this is {shop}.', audience: { tags: ['fleet'] } }))
  assert.equal(p.counts.will_receive, 1)
})

test('someone texted a marketing message this week is left out of the preview with the reason', async () => {
  const s = shop({ recent: [{ customerId: 'c3', phone: '7135550103', email: null, automationId: 're_engagement', klass: 'marketing', at: AFTERNOON - 2 * D }] })
  const p = await previewPromotion(s.f.deps, SHOP_ID, input())
  assert.equal(p.counts.will_receive, 2)
  assert.ok(p.left_out.some(x => x.name === 'Lee Park' && /week|recent|limit/i.test(x.label)))
})

// ── Sending ───────────────────────────────────────────────────────────────

test('send now: everyone previewed is texted, once, with the opt-out line, and the promotion is marked sent', async () => {
  const s = shop()
  const promo = await draft(s)
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.ok, true)
  assert.equal(out.status, 'sent')
  assert.equal(out.sent, 3)
  assert.equal(s.f.state.sent.length, 3)
  assert.ok(s.f.state.sent.every(m => /Reply STOP to opt out\.$/.test(m.text)))
  const list = await listPromotions(s.store, SHOP_ID, s.f.now)
  assert.equal(list[0].status, 'sent')
  assert.equal(list[0].counts.sent, 3)
  assert.equal(s.rows[0].queued_count, 3)
  assert.ok(s.rows[0].sent_at)
})

test('pressing send twice never texts anyone twice', async () => {
  const s = shop()
  const promo = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  const again = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'already_sent')
  assert.equal(s.f.state.sent.length, 3)
  assert.equal(s.rows[0].queued_count, 3)
})

test('two presses at the same moment still text each person once', async () => {
  const s = shop()
  const promo = await draft(s)
  const [a, b] = await Promise.all([sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id), sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)])
  assert.ok(a.ok || b.ok)
  assert.equal(s.f.state.sent.length, 3)
  assert.equal(new Set(s.f.state.sent.map(m => m.to)).size, 3)
  assert.equal(s.rows[0].queued_count, 3, 'the second press does not lower the count')
})

test('a promotion cannot be edited once it is out, but a draft can', async () => {
  const s = shop()
  const promo = await draft(s)
  const edited = await savePromotion(s.store, SHOP_ID, promo.id, input({ name: 'Renamed' }))
  assert.equal(edited.name, 'Renamed')
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  const locked = await savePromotion(s.store, SHOP_ID, promo.id, input({ name: 'Again' }))
  assert.equal(locked.code, 'locked')
})

test('nobody to send to: nothing is written and the promotion stays a draft', async () => {
  const s = shop()
  const promo = await draft(s, { audience: { tags: ['nobody-has-this'] } })
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'nobody')
  assert.equal(s.f.state.messages.length, 0)
  assert.equal(s.rows[0].status, 'draft')
})

test('the master switch stops promotions too', async () => {
  const s = shop({}, AFTERNOON, { rules: normalizeRules({ master_enabled: false }) })
  const promo = await draft(s)
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.code, 'master_off')
  assert.equal(s.f.state.messages.length, 0)
})

test('texting not set up: the promotion says what is missing and nothing is queued', async () => {
  const s = shop({}, AFTERNOON, { smsReady: false })
  const promo = await draft(s)
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.code, 'needs_setup')
  assert.match(out.error, /Texting is not set up/)
  assert.equal(s.f.state.messages.length, 0)
})

test('at night a send-now promotion waits for morning instead of texting people at 10pm', async () => {
  const s = shop({}, NIGHT)
  const promo = await draft(s)
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.ok, true)
  assert.equal(out.sent, 0)
  assert.equal(out.waiting, 3)
  assert.equal(out.status, 'sending')
  s.f.at(Date.parse('2026-10-15T14:30:00Z')) // 9:30am Houston
  const more = await continuePromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(more.sent, 3)
  assert.equal(more.waiting, 0)
})

test('a customer who replies STOP after the promotion was lined up is not texted', async () => {
  const s = shop({}, NIGHT)
  const promo = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  s.f.state.optedOutPhones.add('7135550102')
  s.f.at(Date.parse('2026-10-15T14:30:00Z'))
  await continuePromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(s.f.state.sent.length, 2)
  assert.ok(!s.f.state.sent.some(m => m.to.endsWith('0102')))
})

test('a big promotion keeps sending in batches until it is done', async () => {
  const raw = emptyRaw()
  raw.customers = Array.from({ length: 130 }, (_, i) => customer(`c${i}`, `Person ${i}`, `71355${String(10000 + i).slice(-5)}`))
  const f = createFake({ shop: fakeShop(), raw, start: AFTERNOON })
  const s = { f, ...createPromotionFake(f) }
  const promo = await draft(s)
  const out = await sendPromotion(f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.ok, true)
  assert.equal(out.sent, 130)
  assert.equal(out.waiting, 0)
})

// ── Scheduling and stopping ───────────────────────────────────────────────

test('a scheduled promotion lines everyone up now, sends nothing yet, and goes at the chosen time', async () => {
  const s = shop()
  const promo = await draft(s)
  const at = Date.parse('2026-10-20T15:00:00Z')
  const out = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id, { sendAt: at })
  assert.equal(out.ok, true)
  assert.equal(out.status, 'scheduled')
  assert.equal(out.sent, 0)
  assert.equal(out.waiting, 3)
  assert.equal(out.send_at, '2026-10-20T15:00:00.000Z')
  assert.equal(s.f.state.sent.length, 0)
  const early = await drainShop(s.f.deps, SHOP_ID)
  assert.equal(early.sent, 0, 'nothing goes out before the time')
  s.f.at(at + 60_000)
  const due = await drainShop(s.f.deps, SHOP_ID)
  assert.equal(due.sent, 3)
  const list = await listPromotions(s.store, SHOP_ID, s.f.now)
  assert.equal(list[0].status, 'sent')
  assert.equal(s.rows[0].status, 'sent', 'the saved status catches up')
})

test('stopping a scheduled promotion cancels what is waiting and leaves other automations alone', async () => {
  const s = shop()
  const promo = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id, { sendAt: Date.parse('2026-10-20T15:00:00Z') })
  // A message the recurring promotion automation queued on its own.
  await s.f.deps.store.insertMessages([{ shop_id: SHOP_ID, automation_id: 'sms_blast', run_id: null, campaign_id: null, channel: 'sms', message_class: 'marketing', status: 'queued', skip_reason: null, customer_id: 'c1', recipient_name: 'x', recipient: '7135550101', subject: null, body: 'recurring', source_type: 'customer', source_id: 'c1', dedupe_key: 'sms_blast:c1:weekly', send_after: new Date(AFTERNOON + 6 * D).toISOString(), is_test: false, detail: {} }])
  const out = await stopPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.ok, true)
  assert.equal(out.cancelled, 3)
  assert.equal(s.f.state.messages.filter(m => m.campaign_id === promo.id && m.status === 'cancelled').length, 3)
  assert.equal(s.f.state.messages.find(m => m.dedupe_key === 'sms_blast:c1:weekly').status, 'queued')
  const list = await listPromotions(s.store, SHOP_ID, s.f.now)
  assert.equal(list[0].status, 'cancelled')
  const again = await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(again.code, 'stopped')
})

test('pausing the recurring promotion does not cancel a one-off promotion that is scheduled', async () => {
  const s = shop()
  const promo = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id, { sendAt: Date.parse('2026-10-20T15:00:00Z') })
  const cancelled = await s.f.deps.store.cancelQueued(SHOP_ID, 'sms_blast', 'paused')
  assert.equal(cancelled, 0)
  assert.equal(s.f.state.messages.filter(m => m.status === 'queued').length, 3)
  const all = await s.f.deps.store.cancelQueued(SHOP_ID, null, 'master_off')
  assert.equal(all, 3, 'the master switch still cancels everything')
})

test('a promotion that has fully gone out cannot be stopped', async () => {
  const s = shop()
  const promo = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  const out = await stopPromotion(s.f.deps, s.store, SHOP_ID, promo.id)
  assert.equal(out.code, 'nothing_waiting')
})

test('only a draft with nothing on record can be deleted', async () => {
  const s = shop()
  const a = await draft(s)
  assert.equal(await deletePromotion(s.store, SHOP_ID, a.id), true)
  const b = await draft(s)
  await sendPromotion(s.f.deps, s.store, SHOP_ID, b.id)
  assert.equal((await deletePromotion(s.store, SHOP_ID, b.id)).code, 'locked')
  assert.equal((await deletePromotion(s.store, SHOP_ID, 'missing')).code, 'not_found')
})

test('another shop cannot read, send or stop this shop promotion', async () => {
  const s = shop()
  const promo = await draft(s)
  const other = '22222222-2222-4222-8222-222222222222'
  assert.equal((await sendPromotion(s.f.deps, s.store, other, promo.id)).code, 'not_found')
  assert.equal((await stopPromotion(s.f.deps, s.store, other, promo.id)).code, 'not_found')
  assert.equal((await listPromotions(s.store, other)).length, 0)
})

test('the status is worked out from the messages', () => {
  const now = AFTERNOON
  const c = (extra) => ({ ...emptyCounts(), ...extra })
  assert.equal(deriveStatus({ status: 'draft', send_at: null }, c({}), now), 'draft')
  assert.equal(deriveStatus({ status: 'sending', send_at: new Date(now + D).toISOString() }, c({ queued: 5 }), now), 'scheduled')
  assert.equal(deriveStatus({ status: 'sending', send_at: new Date(now - D).toISOString() }, c({ queued: 5 }), now), 'sending')
  assert.equal(deriveStatus({ status: 'sending', send_at: null }, c({ sent: 5 }), now), 'sent')
  assert.equal(deriveStatus({ status: 'cancelled', send_at: null }, c({ queued: 5 }), now), 'cancelled')
})
