import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_RAW } from './helpers-reports.mjs'
import { createDb } from './helpers/reports-fake-db.mjs'
import { deleteReport, listSaved, previewSaved, runScheduled, saveReport, sendSaved, setEnabled, todayKeyIn } from '../src/lib/report-delivery.ts'

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const ME = { userId: 'user-1', name: 'Owner', email: 'owner@example.com' }
// Monday evening in Houston (a Tuesday 00:30 in UTC), the time a daily server job would run.
const MON = new Date('2026-10-20T00:30:00Z')
const NEXT_MON = new Date('2026-10-27T00:30:00Z')

const docRows = () => ALL_RAW.map(r => ({ shop_id: SHOP, created_at: r.created_at || `${r.doc_date}T15:00:00Z`, ...r }))
const baseSeed = () => ({
  documents: docRows(),
  payments: [{ id: 'p1', shop_id: SHOP, document_id: 'd-1001', amount: 427.33, method: 'card', paid_at: '2026-10-02T16:00:00Z', created_at: '2026-10-02T16:00:00Z' }],
  settings: [{ shop_id: SHOP, shop_name: 'Test Auto Repair', shop_email: 'office@example.com', shop_phone: '(555) 010-0100', labor_rate: 100, timezone: 'America/Chicago' }],
  saved_reports: [], report_send_log: [],
})
const makeDb = (seed = {}, options = {}) => createDb({ ...baseSeed(), ...seed }, { unique: { report_send_log: [['saved_report_id', 'period_key'], ['shop_id', 'send_key']] }, ...options })
const mailer = (failFor = []) => {
  const sent = []
  const fn = async mail => { if (failFor.includes(mail.to)) throw new Error('mailbox unavailable'); sent.push(mail) }
  fn.sent = sent
  return fn
}
const input = (over = {}) => ({ name: 'Monday summary', kind: 'summary', range: { key: '30d' }, compare: { mode: 'previous' }, schedule: 'weekly', recipients: ['owner@example.com'], enabled: true, ...over })
const mk = async (db, over = {}, today = '2026-10-14') => (await saveReport(db, SHOP, ME, null, input(over), today)).report

test('the shop\'s own calendar day is used, not the server\'s', () => {
  assert.equal(todayKeyIn('America/Chicago', new Date('2026-10-20T00:30:00Z')), '2026-10-19')
  assert.equal(todayKeyIn('America/Chicago', new Date('2026-01-15T05:59:00Z')), '2026-01-14')
  assert.equal(todayKeyIn('Not/AZone', new Date('2026-10-20T00:30:00Z')), '2026-10-19', 'a bad time zone falls back instead of failing')
})

test('saving a report: checked first, stored for this shop, and a schedule starts with the next period', async () => {
  const db = makeDb()
  const bad = await saveReport(db, SHOP, ME, null, input({ name: '' }), '2026-10-14')
  assert.equal(bad.ok, false)
  assert.equal(bad.status, 400)
  const noEmail = await saveReport(db, SHOP, ME, null, input({ recipients: [] }), '2026-10-14')
  assert.equal(noEmail.ok, false)
  assert.ok(noEmail.fields.recipients)
  const r = await saveReport(db, SHOP, ME, null, input(), '2026-10-14')
  assert.equal(r.ok, true)
  assert.equal(r.report.last_period, 'week-2026-10-05', 'the week that just ended counts as already covered')
  assert.equal(db.tables.saved_reports[0].shop_id, SHOP)
  assert.equal(db.tables.saved_reports[0].created_by, 'user-1')
})

test('changing a report keeps its place; turning a schedule on again starts fresh; another shop\'s report cannot be changed', async () => {
  const db = makeDb({ saved_reports: [{ id: 'theirs', shop_id: OTHER, name: 'Theirs', kind: 'summary', schedule: 'none', recipients: [], enabled: false }] })
  const r = await mk(db)
  const renamed = await saveReport(db, SHOP, ME, r.id, input({ name: 'Renamed' }), '2026-10-21')
  assert.equal(renamed.report.name, 'Renamed')
  assert.equal(renamed.report.last_period, 'week-2026-10-05', 'an edit that leaves the schedule alone does not reset it')
  const off = await saveReport(db, SHOP, ME, r.id, input({ schedule: 'none' }), '2026-10-21')
  assert.equal(off.report.enabled, false)
  const on = await saveReport(db, SHOP, ME, r.id, input(), '2026-10-21')
  assert.equal(on.report.last_period, 'week-2026-10-12')
  const theirs = await saveReport(db, SHOP, ME, 'theirs', input(), '2026-10-21')
  assert.equal(theirs.ok, false)
  assert.equal(theirs.status, 404)
  assert.equal(db.tables.saved_reports.find(x => x.id === 'theirs').name, 'Theirs')
})

test('the pause switch needs a schedule and an address, and does not email the period that just ended', async () => {
  const db = makeDb()
  const r = await mk(db, { schedule: 'none', enabled: false })
  assert.equal((await setEnabled(db, SHOP, ME, r.id, true, '2026-10-14')).ok, false)
  const w = await mk(db, { name: 'Weekly', enabled: false })
  const on = await setEnabled(db, SHOP, ME, w.id, true, '2026-10-21')
  assert.equal(on.ok, true)
  assert.equal(on.report.enabled, true)
  assert.equal(on.report.last_period, 'week-2026-10-12')
  const off = await setEnabled(db, SHOP, ME, w.id, false, '2026-10-21')
  assert.equal(off.report.enabled, false)
})

test('deleting removes the saved report only; the history of what was sent stays', async () => {
  const db = makeDb({ saved_reports: [{ id: 's1', shop_id: SHOP, name: 'A', kind: 'summary' }, { id: 's2', shop_id: OTHER, name: 'B', kind: 'summary' }], report_send_log: [{ id: 'l1', shop_id: SHOP, saved_report_id: 's1', status: 'sent' }] })
  assert.equal((await deleteReport(db, SHOP, 's2')).status, 404, 'not another shop\'s')
  assert.equal((await deleteReport(db, SHOP, 's1')).ok, true)
  assert.deepEqual(db.tables.saved_reports.map(r => r.id), ['s2'])
  assert.equal(db.tables.report_send_log.length, 1)
  assert.equal((await deleteReport(db, SHOP, 's1')).status, 404)
})

test('the list says "needs a database update" for a missing table and "error" for a failed read, never an empty list', async () => {
  const missing = await listSaved(makeDb({}, { missingTables: ['saved_reports'] }), SHOP)
  assert.equal(missing.state, 'needs-update')
  const broken = await listSaved(makeDb({}, { failures: { 'select:saved_reports': { code: '57014', message: 'timeout' } } }), SHOP)
  assert.equal(broken.state, 'error')
  assert.ok(broken.error)
  const db = makeDb({ saved_reports: [{ id: 's1', shop_id: SHOP, name: 'A', kind: 'sales', recipients: ['a@example.com'] }, { id: 's2', shop_id: OTHER, name: 'B', kind: 'sales' }] })
  const ok = await listSaved(db, SHOP)
  assert.equal(ok.state, 'ok')
  assert.deepEqual(ok.reports.map(r => r.name), ['A'])
})

test('a preview shows the exact subject, recipients and text, and writes nothing', async () => {
  const db = makeDb()
  const r = await mk(db)
  const before = db.log.filter(l => ['insert', 'update', 'delete', 'upsert'].includes(l.op)).length
  const p = await previewSaved(db, SHOP, r, MON)
  assert.deepEqual(p.to, ['owner@example.com'])
  assert.match(p.subject, /^Test Auto Repair: Monday summary - Week of October 12$/)
  assert.match(p.text, /Shop summary/)
  assert.match(p.text, /Test Auto Repair/)
  assert.equal(db.log.filter(l => ['insert', 'update', 'delete', 'upsert'].includes(l.op)).length, before)
})

test('a preview of Send now covers the dates saved with the report, and a preview of the schedule covers the week that just ended', async () => {
  const db = makeDb()
  const r = await mk(db)
  const now = await previewSaved(db, SHOP, r, MON, 'send-now')
  const next = await previewSaved(db, SHOP, r, MON, 'next-scheduled')
  assert.notEqual(now.periodTitle, next.periodTitle)
  assert.match(next.periodTitle, /^Week of October 12$/)
  assert.doesNotMatch(now.periodTitle, /^Week of/)
})

test('send now: goes to the saved addresses once, is logged, and pressing it twice sends once', async () => {
  const db = makeDb()
  const r = await mk(db, { schedule: 'none', enabled: false, recipients: ['owner@example.com', 'partner@example.com'] })
  const send = mailer()
  const deps = { db, shopId: SHOP, send, now: MON, actor: ME }
  const a = await sendSaved(deps, r, 'manual', 'key-abcdefgh')
  assert.equal(a.ok, true)
  assert.equal(a.status, 'sent')
  assert.deepEqual(send.sent.map(m => m.to), ['owner@example.com', 'partner@example.com'])
  assert.ok(send.sent.every(m => /Monday summary/.test(m.subject)))
  const b = await sendSaved(deps, r, 'manual', 'key-abcdefgh')
  assert.equal(b.ok, true)
  assert.equal(b.status, 'duplicate')
  assert.equal(send.sent.length, 2, 'the repeat sent nothing')
  assert.equal(db.tables.report_send_log.length, 1)
  assert.equal(db.tables.report_send_log[0].status, 'sent')
  assert.equal(db.tables.report_send_log[0].trigger, 'manual')
})

test('a test goes only to the person who asked, never to the saved addresses', async () => {
  const db = makeDb()
  const r = await mk(db, { recipients: ['owner@example.com', 'partner@example.com'] })
  const send = mailer()
  const out = await sendSaved({ db, shopId: SHOP, send, now: MON, actor: { ...ME, email: 'me@example.com' } }, r, 'test', 'test-abcdefgh')
  assert.equal(out.ok, true)
  assert.deepEqual(send.sent.map(m => m.to), ['me@example.com'])
  assert.equal(db.tables.report_send_log[0].trigger, 'test')
  const none = await sendSaved({ db, shopId: SHOP, send, now: MON, actor: { userId: 'u', name: 'x' } }, r, 'test', 'test-zzzzzzzz')
  assert.equal(none.ok, false)
})

test('a send with no repeat key, or no addresses, is refused and sends nothing', async () => {
  const db = makeDb()
  const r = await mk(db, { schedule: 'none', enabled: false, recipients: [] })
  const send = mailer()
  assert.equal((await sendSaved({ db, shopId: SHOP, send, now: MON, actor: ME }, r, 'manual', 'key-abcdefgh')).ok, false)
  const r2 = await mk(db, { schedule: 'none', enabled: false })
  assert.equal((await sendSaved({ db, shopId: SHOP, send, now: MON, actor: ME }, r2, 'manual', '')).ok, false)
  assert.equal(send.sent.length, 0)
})

test('a send that reaches some people and not others says exactly who, and is not recorded as sent', async () => {
  const db = makeDb()
  const r = await mk(db, { schedule: 'none', enabled: false, recipients: ['owner@example.com', 'bad@example.com'] })
  const send = mailer(['bad@example.com'])
  const out = await sendSaved({ db, shopId: SHOP, send, now: MON, actor: ME }, r, 'manual', 'key-partial1')
  assert.equal(out.ok, false)
  assert.match(out.message, /Sent to owner@example\.com/)
  assert.match(out.message, /Could not send to bad@example\.com/)
  assert.deepEqual(out.partial.failedTo, ['bad@example.com'])
  const row = db.tables.report_send_log[0]
  assert.equal(row.status, 'failed')
  assert.deepEqual(row.recipients, ['bad@example.com'])
})

test('scheduled: sends the week that just ended once, and a second run the same evening sends nothing', async () => {
  const db = makeDb()
  const r = await mk(db, { recipients: ['owner@example.com', 'partner@example.com'] }, '2026-10-14')
  assert.equal(r.last_period, 'week-2026-10-05')
  const send = mailer()
  const first = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(first.ok, true)
  assert.equal(first.results[0].action, 'sent')
  assert.equal(send.sent.length, 2)
  assert.match(send.sent[0].subject, /Week of October 12/)
  assert.ok(send.sent.every(m => ['owner@example.com', 'partner@example.com'].includes(m.to)), 'only the typed addresses')
  const again = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(again.results[0].action, 'skipped')
  assert.equal(send.sent.length, 2)
  assert.equal(db.tables.saved_reports[0].last_period, 'week-2026-10-12')
  const next = await runScheduled({ db, shopId: SHOP, send, now: NEXT_MON })
  assert.equal(next.results[0].action, 'sent', 'the next week goes out')
  assert.equal(send.sent.length, 4)
  assert.equal(db.tables.report_send_log.length, 2, 'one history row per period')
})

test('scheduled: turning a schedule on does not email the period that just ended', async () => {
  const db = makeDb()
  await mk(db, {}, '2026-10-20')
  const send = mailer()
  const out = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(out.results[0].action, 'skipped')
  assert.equal(send.sent.length, 0)
})

test('scheduled: a paused report, a report with no schedule, and other shops\' reports are left alone', async () => {
  const db = makeDb({ saved_reports: [{ id: 'theirs', shop_id: OTHER, name: 'T', kind: 'summary', schedule: 'weekly', recipients: ['x@example.com'], enabled: true, last_period: null, range: { key: '30d' }, compare: { mode: 'previous' } }] })
  const paused = await mk(db, { name: 'Paused', enabled: false })
  await mk(db, { name: 'Manual only', schedule: 'none', enabled: false })
  const send = mailer()
  const out = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(out.results.length, 0)
  assert.equal(send.sent.length, 0)
  assert.equal(db.tables.saved_reports.find(r => r.id === paused.id).enabled, false)
  assert.equal(db.tables.saved_reports.find(r => r.id === 'theirs').last_period, null)
})

test('scheduled: two runs at the same moment send each address once', async () => {
  const db = makeDb()
  await mk(db, { recipients: ['owner@example.com', 'partner@example.com'] }, '2026-10-14')
  const send = mailer()
  const [a, b] = await Promise.all([runScheduled({ db, shopId: SHOP, send, now: MON }), runScheduled({ db, shopId: SHOP, send, now: MON })])
  assert.equal(send.sent.length, 2)
  const actions = [a.results[0].action, b.results[0].action].sort()
  assert.deepEqual(actions, ['sent', 'skipped'])
})

test('scheduled: a failed send is tried again later, only to the people who missed it, and stops after three tries', async () => {
  const db = makeDb()
  await mk(db, { recipients: ['owner@example.com', 'bad@example.com'] }, '2026-10-14')
  const flaky = mailer(['bad@example.com'])
  const one = await runScheduled({ db, shopId: SHOP, send: flaky, now: MON })
  assert.equal(one.results[0].action, 'failed')
  assert.equal(db.tables.saved_reports[0].last_period, 'week-2026-10-05', 'the period is not marked done')
  const row = () => db.tables.report_send_log[0]
  assert.equal(row().status, 'failed')
  assert.equal(row().attempts, 1)
  const good = mailer()
  const two = await runScheduled({ db, shopId: SHOP, send: good, now: MON })
  assert.equal(two.results[0].action, 'sent')
  assert.deepEqual(good.sent.map(m => m.to), ['bad@example.com'], 'the person who already had it is not emailed again')
  assert.equal(row().attempts, 2)
  assert.equal(db.tables.saved_reports[0].last_period, 'week-2026-10-12')

  const db2 = makeDb()
  await mk(db2, { recipients: ['bad@example.com'] }, '2026-10-14')
  const always = mailer(['bad@example.com'])
  for (let i = 0; i < 3; i++) await runScheduled({ db: db2, shopId: SHOP, send: always, now: MON })
  const stop = await runScheduled({ db: db2, shopId: SHOP, send: always, now: MON })
  assert.equal(stop.results[0].action, 'failed')
  assert.match(stop.results[0].detail, /stopped trying/)
  assert.equal(db2.tables.report_send_log[0].attempts, 3)
})

test('scheduled: a send that started and never reported back is marked unknown and is never sent again on its own', async () => {
  const db = makeDb()
  const r = await mk(db, {}, '2026-10-14')
  db.tables.report_send_log.push({ id: 'stuck', shop_id: SHOP, saved_report_id: r.id, trigger: 'schedule', period_key: 'week-2026-10-12', status: 'claimed', attempts: 1, claimed_at: '2026-10-19T22:00:00Z', recipients: ['owner@example.com'] })
  const send = mailer()
  const out = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(out.results[0].action, 'unknown')
  assert.equal(send.sent.length, 0)
  assert.equal(db.tables.report_send_log.find(l => l.id === 'stuck').status, 'unknown')
  const again = await runScheduled({ db, shopId: SHOP, send, now: NEXT_MON })
  assert.equal(again.results[0].action, 'sent', 'next week still goes out')
  const same = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(send.sent.length, 1)
  assert.ok(same.ok)
})

test('scheduled: a claim made a moment ago is respected, not stolen', async () => {
  const db = makeDb()
  const r = await mk(db, {}, '2026-10-14')
  db.tables.report_send_log.push({ id: 'busy', shop_id: SHOP, saved_report_id: r.id, trigger: 'schedule', period_key: 'week-2026-10-12', status: 'claimed', attempts: 1, claimed_at: '2026-10-20T00:25:00Z', recipients: ['owner@example.com'] })
  const send = mailer()
  const out = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(out.results[0].action, 'skipped')
  assert.equal(send.sent.length, 0)
})

test('scheduled: if the money cannot be read, nothing is sent and the attempt is recorded for a retry', async () => {
  const db = makeDb({}, { failures: { 'select:documents': { code: '57014', message: 'statement timeout' } } })
  await mk(db, {}, '2026-10-14')
  const send = mailer()
  const out = await runScheduled({ db, shopId: SHOP, send, now: MON })
  assert.equal(out.results[0].action, 'retry-later')
  assert.equal(send.sent.length, 0)
  assert.equal(db.tables.report_send_log[0].status, 'failed')
  assert.equal(db.tables.saved_reports[0].last_period, 'week-2026-10-05')
})

test('scheduled on a database without the tables does nothing and does not fail the whole job', async () => {
  const out = await runScheduled({ db: makeDb({}, { missingTables: ['saved_reports'] }), shopId: SHOP, send: mailer(), now: MON })
  assert.equal(out.ok, true)
  assert.deepEqual(out.results, [])
})

test('the emailed profit report says when expenses could not be read', async () => {
  const db = makeDb({}, { missingTables: ['expenses'] })
  const r = await mk(db, { kind: 'profit', schedule: 'none', enabled: false })
  const p = await previewSaved(db, SHOP, r, MON)
  assert.match(p.text, /Bills and expenses could not be read/)
})
