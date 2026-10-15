import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../src/lib/jobflow.ts'

test('a stored row is read safely: damaged values become plain defaults', () => {
  const r = f.flowFrom({ job_id: 'j1', parts: 'bogus', parts_note: 'n'.repeat(500), parts_eta: 'soon', labels: [' Rush ', 'rush', 'Warranty', '', 5, '<b>Hi</b>'], est_hours: '2.3', promise_time: '25:00', version: -2, status_token: 'abc' })
  assert.equal(r.parts, 'none')
  assert.equal(r.parts_note.length, f.MAX_PARTS_NOTE)
  assert.equal(r.parts_eta, null)
  assert.deepEqual(r.labels, ['Rush', 'Warranty', '5', 'bHi/b'])
  assert.equal(r.est_hours, 2.25) // quarter hours
  assert.equal(r.promise_time, null)
  assert.equal(r.version, 0)
  assert.equal(r.has_link, true)
  assert.equal(f.flowFrom({ job_id: 'j2' }).has_link, false)
  assert.deepEqual(f.emptyFlow('j3').labels, [])
})

test('labels: at most five, no repeats whatever the capitals, no markup', () => {
  assert.equal(f.cleanLabels(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, f.MAX_LABELS)
  assert.deepEqual(f.cleanLabels(['Rush', 'RUSH', ' rush ']), ['Rush'])
  assert.deepEqual(f.cleanLabels('nope'), [])
  assert.equal(f.cleanLabels(['x'.repeat(80)])[0].length, f.MAX_LABEL)
})

test('hours are quarter hours between 0 and 99, or nothing', () => {
  for (const [v, want] of [['1.5', 1.5], [2, 2], ['0', null], ['', null], [null, null], ['abc', null], [120, null], [0.1, 0], ['3.1', 3]]) {
    const got = f.cleanHoursValue(v)
    if (v === 0.1) assert.equal(got, 0) // rounds to 0: treated as no estimate by the caller
    else assert.equal(got, want, String(v))
  }
})

test('only the allowed fields come through a patch, each cleaned', () => {
  const p = f.cleanPatch({ parts: 'ordered', parts_note: ' due  Thursday ', parts_eta: '2026-10-22', labels: ['Rush'], est_hours: '2', promise_time: '15:00', public_note: 'Back by 3', job_id: 'other', shop_id: 'x', version: 99, status_token: 'steal' })
  assert.deepEqual(p, { parts: 'ordered', parts_note: 'due Thursday', parts_eta: '2026-10-22', labels: ['Rush'], est_hours: 2, promise_time: '15:00', public_note: 'Back by 3' })
  assert.deepEqual(f.cleanPatch({ parts: 'weird', promise_time: 'noon', parts_eta: 'x' }), { parts_eta: null, promise_time: null })
  assert.deepEqual(f.cleanPatch(null), {})
  assert.deepEqual(f.cleanPatch({ est_hours: '' }), { est_hours: null })
})

test('the board settings keep sane limits', () => {
  assert.deepEqual(f.cleanBoard(undefined), f.DEFAULT_BOARD)
  const b = f.cleanBoard({ labels: ['A', 'B'], readyText: 'weird', tvSeconds: 1, tvNames: 'yes' })
  assert.deepEqual(b, { labels: ['A', 'B'], readyText: 'ask', tvSeconds: 10, tvNames: false })
  assert.equal(f.cleanBoard({ readyText: 'auto', tvSeconds: 9999, tvNames: true }).tvSeconds, 300)
  assert.equal(f.cleanBoard({ readyText: 'off' }).readyText, 'off')
})

test('the promise: late, soon, today, later, with the time when there is one', () => {
  const now = { ymd: '2026-10-15', minutes: 13 * 60 }
  const P = (date, time, finished = false) => f.promiseInfo({ date, time, finished, now })
  assert.equal(P(null, null).tone, 'none')
  assert.equal(P('garbage', null).tone, 'none')
  assert.deepEqual([P('2026-10-14', null).tone, P('2026-10-14', null).text], ['late', 'Late: promised Oct 14'])
  assert.equal(P('2026-10-14', '16:00').text, 'Late: promised Oct 14 4:00 PM')
  assert.equal(P('2026-10-14', '16:00').minutesLate, 1440 + 13 * 60 - 16 * 60)
  assert.equal(P('2026-10-15', '12:30').tone, 'late')
  assert.equal(P('2026-10-15', '12:30').text, 'Late: promised 12:30 PM (30 min ago)')
  assert.equal(P('2026-10-15', '14:15').tone, 'soon')
  assert.equal(P('2026-10-15', '14:15').text, 'Due in 1 h 15 min (2:15 PM)')
  assert.equal(P('2026-10-15', '17:00').tone, 'today')
  assert.equal(P('2026-10-15', '17:00').text, 'Due today 5:00 PM')
  assert.deepEqual([P('2026-10-15', null).tone, P('2026-10-15', null).text], ['today', 'Due today'])
  assert.equal(P('2026-10-16', '09:00').text, 'Due tomorrow 9:00 AM')
  assert.equal(P('2026-10-20', null).text, 'Due Oct 20')
  assert.equal(P('2026-10-20', null).tone, 'later')
  // a finished car is never late
  assert.equal(P('2026-10-01', null, true).tone, 'later')
  assert.equal(P('2026-10-01', null, true).text, 'Promised Oct 1')
  assert.equal(P('2026-10-15', '10:00', true).text, 'Promised 10:00 AM')
})

test('the board sorts by promise, undated cars last', () => {
  const keys = [['2026-10-16', '09:00'], [null, null], ['2026-10-14', null], ['2026-10-16', null]].map(([d, t]) => f.promiseSortKey(d, t))
  assert.deepEqual([...keys].sort(), [keys[2], keys[0], keys[3], keys[1]])
})

test('hours on a technician column: assigned, done, left, and cars with no hours entered', () => {
  const s = f.hoursSummary([{ hours: 2, ready: false }, { hours: 1.5, ready: true }, { hours: null, ready: false }, { hours: 3, ready: false }], 8)
  assert.deepEqual(s, { assigned: 6.5, done: 1.5, left: 5, unknown: 1, dayPct: 63 })
  assert.deepEqual(f.hoursSummary([], 8), { assigned: 0, done: 0, left: 0, unknown: 0, dayPct: 0 })
  assert.equal(f.hoursSummary([{ hours: 1, ready: false }], null).dayPct, null)
  assert.equal(f.hoursLabel(7.5), '7.5 h'); assert.equal(f.hoursLabel(8), '8 h'); assert.equal(f.hoursLabel(1.25), '1.25 h')
})

test('markers say what went to the customer and what they did, in words', () => {
  assert.deepEqual(f.markersFor({}), [])
  const m = f.markersFor({ estimateSentAt: '2026-10-14', inspection: { sent: true, viewedAt: '2026-10-14', answered: false }, readyTextAt: '2026-10-15' })
  assert.deepEqual(m.map(x => x.word), ['Estimate sent', 'Inspection viewed', 'Ready text sent'])
  assert.equal(f.markersFor({ estimateSentAt: 'x', estimateSignedAt: 'y' })[0].word, 'Estimate approved')
  assert.equal(f.markersFor({ inspection: { sent: true, viewedAt: 'x', answered: true, approved: 2 } })[0].word, 'Inspection: 2 approved')
  assert.equal(f.markersFor({ inspection: { sent: true, viewedAt: null, answered: false } })[0].word, 'Inspection sent')
  assert.equal(f.markersFor({ inspection: { sent: false, viewedAt: null, answered: false } }).length, 0)
})

test('the ready text names the car and the shop, and falls back politely', () => {
  const t = f.readyTextBody({ customer: 'Walk-in: Dana Ruiz', car: '2018 Toyota Camry', shop: 'Test Auto', phone: '(713) 555-0100' })
  assert.equal(t, 'Hi Dana, your 2018 Toyota Camry is ready for pickup at Test Auto.\nQuestions? Call (713) 555-0100.')
  assert.equal(f.readyTextBody({ customer: '', car: '', shop: '', phone: '' }), 'Your vehicle is ready for pickup at our shop.\nReply to this text with any questions.')
  assert.match(f.readyTextBody({ customer: 'Sam', car: 'x', shop: 'y', phone: '', statusUrl: 'https://e.test/status/t' }), /Details: https:\/\/e\.test\/status\/t/)
  assert.match(f.statusTextBody({ customer: 'Sam Lee', car: 'Civic', shop: 'Test Auto', statusUrl: 'https://e.test/s' }), /^Hi Sam, you can follow the work on your Civic at Test Auto here: https:\/\/e\.test\/s$/)
})

test('the customer page speaks in plain words and never in shop jargon', () => {
  for (const s of ['New', 'Approved', 'In Progress', 'In Repair', 'Waiting on Parts', 'Waiting on Customer', 'Supplement', 'Completed', 'Ready for Pickup', 'Paid', 'Closed', 'Something else', '']) {
    const p = f.publicStatusOf(s)
    assert.ok(p.headline.length > 5, s)
    assert.ok(f.PUBLIC_STEPS.some(x => x.key === p.step) || p.step === 'done', s)
    assert.equal(/\$|invoice|estimate total|internal/i.test(p.headline + p.detail), false, s)
  }
  assert.equal(f.publicStatusOf('Waiting on Parts', 'ordered').detail, 'The parts are on order.')
  assert.equal(f.publicStatusOf('Waiting on Customer').waiting, 'you')
  assert.equal(f.publicStatusOf('Ready for Pickup').step, 'ready')
  assert.equal(f.publicStatusOf('Mystery').step, 'in')
})

test('the car is described by year, make and model only', () => {
  assert.equal(f.carWords({ vehicle_year: '2018', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_plate: 'ABC123', vehicle_vin: 'X' }), '2018 Toyota Camry')
  assert.equal(f.carWords({}), '')
  assert.equal(f.carWords({ vehicle_make: ' Ford ', vehicle_model: null }), 'Ford')
})

test('the customer reads the promise kindly: expected, never late', () => {
  const now = { ymd: '2026-10-15', minutes: 13 * 60 }
  const C = (date, time, finished = false) => f.customerPromiseText({ date, time, finished, now })
  assert.equal(C(null, null), null)
  assert.equal(C('2026-10-15', '17:00').text, 'Expected ready today by 5:00 PM')
  assert.equal(C('2026-10-15', null).text, 'Expected ready today')
  assert.equal(C('2026-10-16', '09:30').text, 'Expected ready tomorrow by 9:30 AM')
  assert.equal(C('2026-10-20', null).text, 'Expected ready Tue, Oct 20')
  assert.deepEqual(C('2026-10-14', null), { text: 'This is taking longer than we promised. Please call us for an update.', late: true })
  assert.equal(C('2026-10-14', null, true), null)
  assert.equal(/late/i.test(C('2026-10-14', null).text), false)
})
