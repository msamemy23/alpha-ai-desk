import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as u from '../src/components/inbox/utils.ts'

// Dates are built in the browser's own calendar, the same way the screen builds them.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString()
const call = (direction, secs, start_time, extra = {}) => ({ direction, status: 'completed', duration_secs: secs, start_time, ...extra })

test('month bounds are the first moments of last month, this month and next month', () => {
  const b = u.monthBounds(new Date(2026, 9, 16, 15))
  assert.deepEqual([b.prev.getMonth(), b.prev.getDate()], [8, 1])
  assert.deepEqual([b.start.getMonth(), b.start.getDate(), b.start.getHours()], [9, 1, 0])
  assert.deepEqual([b.next.getMonth(), b.next.getDate()], [10, 1])
  const jan = u.monthBounds(new Date(2027, 0, 5))
  assert.deepEqual([jan.prev.getFullYear(), jan.prev.getMonth()], [2026, 11], 'January looks back to December of the year before')
  const dec = u.monthBounds(new Date(2026, 11, 31, 23))
  assert.deepEqual([dec.next.getFullYear(), dec.next.getMonth()], [2027, 0], 'December looks ahead to January of the next year')
})

test('phone time counts only calls that started in the month, with the edges handled', () => {
  const b = u.monthBounds(new Date(2026, 9, 16))
  const calls = [
    call('inbound', 600, at(2026, 10, 1, 0)),       // first moment of the month: in
    call('outbound', 300, at(2026, 10, 15)),
    call('inbound', 90, at(2026, 9, 30, 23)),        // last month
    call('inbound', 120, at(2026, 11, 1, 0)),        // next month: out
    call('inbound', 45, 'not a date'),               // no usable time: out
  ]
  const t = u.callTimeIn(calls, b.start, b.next)
  assert.equal(t.calls, 2)
  assert.equal(t.seconds, 900)
  assert.equal(t.incoming, 1)
  assert.equal(t.outgoing, 1)
  assert.equal(u.callTimeIn(calls, b.prev, b.start).seconds, 90)
})

test('missed calls are counted as missed, and a bad length counts as nothing', () => {
  const b = u.monthBounds(new Date(2026, 9, 16))
  const calls = [
    call('inbound', 5, at(2026, 10, 3)),                          // under 15 seconds: missed
    call('inbound', 0, at(2026, 10, 4), { status: 'no-answer' }), // missed by status
    call('inbound', 200, at(2026, 10, 5)),
    call('outbound', -50, at(2026, 10, 6)),                       // negative: nothing
    call('outbound', 'abc', at(2026, 10, 7)),                     // not a number: nothing
    call('outbound', 61.9, at(2026, 10, 8)),
  ]
  const t = u.callTimeIn(calls, b.start, b.next)
  assert.equal(t.missed, 2)
  assert.equal(t.incoming, 1)
  assert.equal(t.outgoing, 3)
  assert.equal(t.calls, 6)
  assert.equal(t.seconds, 5 + 0 + 200 + 0 + 0 + 61)
})

test('assistant calls with no length are listed as unmeasured, and the ones with a length are counted', () => {
  const b = u.monthBounds(new Date(2026, 9, 16))
  const calls = [
    call('inbound', 0, at(2026, 10, 2), { viaAi: true }),
    call('inbound', 0, at(2026, 10, 3), { viaAi: true }),
    call('inbound', 180, at(2026, 10, 4), { viaAi: true }),
    call('inbound', 0, at(2026, 9, 20), { viaAi: true }), // last month: not in this month
  ]
  const t = u.callTimeIn(calls, b.start, b.next)
  assert.equal(t.unmeasuredAi, 2)
  assert.equal(t.seconds, 180)
  assert.equal(t.incoming, 3, 'an assistant-answered call is an incoming call, never a missed one')
  assert.equal(t.missed, 0)
})

test('talk time reads in plain words', () => {
  assert.equal(u.formatTalkTime(0), '0 min')
  assert.equal(u.formatTalkTime(40), 'under a minute')
  assert.equal(u.formatTalkTime(60), '1 min')
  assert.equal(u.formatTalkTime(59 * 60 + 59), '59 min')
  assert.equal(u.formatTalkTime(3600), '1 h')
  assert.equal(u.formatTalkTime(4 * 3600 + 12 * 60 + 30), '4 h 12 min')
  assert.equal(u.formatTalkTime(-5), '0 min')
  assert.equal(u.formatTalkTime(NaN), '0 min')
  assert.equal(u.formatTalkTime(undefined), '0 min')
})

test('the list is flagged as possibly incomplete only when it is full and its oldest call is still inside the month', () => {
  const start = new Date(2026, 9, 1)
  const full = inside => Array.from({ length: u.CALL_LOAD_LIMIT }, (_, i) => ({ start_time: inside ? at(2026, 10, 2 + (i % 10)) : at(2026, 8, 1 + (i % 10)) }))
  assert.equal(u.mayMissCalls(full(true), start), true)
  assert.equal(u.mayMissCalls(full(false), start), false, 'older calls were loaded, so the month is complete')
  assert.equal(u.mayMissCalls(full(true).slice(1), start), false, 'not full: nothing was cut off')
  assert.equal(u.mayMissCalls([], start), false)
})

/* ---------- the screen ---------- */

const view = readFileSync(new URL('../src/components/inbox/CallsView.tsx', import.meta.url), 'utf8')

test('the Calls tab shows phone time, says it is not a bill, and is read only', () => {
  assert.match(view, /Phone time this month/)
  assert.match(view, /not a bill\. Your phone company's bill has the cost/)
  assert.match(view, /At least /)
  assert.doesNotMatch(view, /\.(insert|update|upsert|delete)\(/)
})

test('the Inbox asks for the same number of calls the screen assumes', () => {
  const page = readFileSync(new URL('../src/app/(app)/messages/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /\.limit\(CALL_LOAD_LIMIT\)/)
  assert.doesNotMatch(page, /\.limit\(1500\)/)
})
