// The time clock rules, run for real (not read as text). The shop is in Houston, so days are cut on Central time.
process.env.TZ = 'America/Chicago'

import test from 'node:test'
import assert from 'node:assert/strict'
import * as tc from '../src/lib/timeclock.ts'

const entry = (over = {}) => ({
  id: 1, staff_id: 7, staff_name: 'Marco Reyes', clock_in: '2026-10-14T13:00:00.000Z', clock_out: '2026-10-14T21:30:00.000Z',
  hours_worked: 8.5, note: null, ...over,
})

test('weeks run Monday to Sunday', () => {
  assert.equal(tc.weekStartKey(new Date(2026, 9, 14)), '2026-10-12') // Wednesday
  assert.equal(tc.weekStartKey(new Date(2026, 9, 18)), '2026-10-12') // Sunday belongs to the week before it
  assert.equal(tc.weekStartKey(new Date(2026, 9, 12)), '2026-10-12') // Monday
  assert.equal(tc.weekStartKey(new Date(2026, 9, 19)), '2026-10-19')
})

test('a week that crosses daylight saving still has seven days', () => {
  const keys = tc.weekKeys('2026-10-26')
  assert.deepEqual(keys, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
  assert.equal(tc.addDaysKey('2026-11-01', 1), '2026-11-02')
  assert.equal(tc.addDaysKey('2026-03-01', 31), '2026-04-01')
})

test('a day is cut at local midnight, not at midnight UTC', () => {
  const r = tc.dayRange('2026-10-14', '2026-10-14')
  assert.equal(r.from, '2026-10-14T05:00:00.000Z') // midnight CDT
  assert.equal(r.to, '2026-10-15T05:00:00.000Z')
  const dst = tc.dayRange('2026-11-01', '2026-11-01') // the day the clocks go back is 25 hours long
  assert.equal(dst.from, '2026-11-01T05:00:00.000Z')
  assert.equal(dst.to, '2026-11-02T06:00:00.000Z')
})

test('a punch at 8:30 PM Houston time stays on that day', () => {
  const e = entry({ clock_in: '2026-10-15T01:30:00.000Z', clock_out: null })
  assert.equal(tc.entryDay(e), '2026-10-14')
  assert.equal(tc.fmtTimeOfDay(e.clock_in), '8:30 PM')
})

test('clock times are written by hand with a plain space', () => {
  assert.equal(tc.fmtTimeOfDay('2026-10-14T13:02:00.000Z'), '8:02 AM')
  assert.equal(tc.fmtTimeOfDay('2026-10-14T17:00:00.000Z'), '12:00 PM')
  assert.equal(tc.fmtTimeOfDay('2026-10-14T05:00:00.000Z'), '12:00 AM')
  assert.equal(tc.fmtTimeOfDay(null), '')
  assert.equal(tc.fmtTimeOfDay('not a date'), '')
})

test('hours subtract breaks and a running entry counts up to now', () => {
  const closed = entry({ break_minutes: 30 })
  assert.equal(tc.workedMinutes(closed, 0), 8 * 60) // 8.5 h between punches, minus 30 min
  assert.equal(tc.hoursFor(closed.clock_in, closed.clock_out, 30), 8)
  assert.equal(tc.hoursFor('2026-10-14T13:00:00.000Z', '2026-10-14T13:20:00.000Z'), 0.33)
  const now = Date.parse('2026-10-14T16:00:00.000Z')
  const open = entry({ clock_out: null, break_minutes: 15, break_started_at: '2026-10-14T15:30:00.000Z' })
  assert.equal(tc.onBreak(open), true)
  assert.equal(tc.breakMinutes(open, now), 45)
  assert.equal(tc.workedMinutes(open, now), 180 - 45)
  assert.equal(tc.workedMinutes(entry({ clock_in: 'junk' }), now), 0)
})

test('a forgotten clock-out counts as nothing until it is fixed', () => {
  const now = Date.parse('2026-10-14T16:00:00.000Z')
  const forgotten = entry({ id: 9, clock_in: '2026-10-12T13:00:00.000Z', clock_out: null })
  assert.equal(tc.isStale(forgotten, now), true)
  assert.equal(tc.workedMinutes(forgotten, now), 0)
  const longDay = entry({ id: 10, clock_in: '2026-10-14T01:00:00.000Z', clock_out: null }) // 15 hours ago: a long day, not forgotten
  assert.equal(tc.isStale(longDay, now), false)
  assert.equal(tc.workedMinutes(longDay, now), 15 * 60)
  assert.equal(tc.isStale(entry(), now), false) // a closed entry is never stale
  assert.equal(tc.isOverlong(forgotten, now), true) // two days on the clock: it can only be fixed
  assert.equal(tc.isOverlong(longDay, now), false) // fifteen hours is long but still a shift
  assert.equal(tc.isOverlong(entry(), now), false)
  assert.equal(tc.statusOf([forgotten], { id: 7, name: 'Marco Reyes' }, now).overlong, true)
  assert.equal(tc.statusOf([longDay], { id: 7, name: 'Marco Reyes' }, now).overlong, false)
  assert.equal(tc.minutesInDays([forgotten], tc.weekKeys('2026-10-12'), now), 0)
})

test('durations read like a person would say them', () => {
  assert.equal(tc.fmtDuration(0), '0m')
  assert.equal(tc.fmtDuration(42), '42m')
  assert.equal(tc.fmtDuration(120), '2h')
  assert.equal(tc.fmtDuration(462), '7h 42m')
  assert.equal(tc.fmtClock(462), '7:42')
  assert.equal(tc.fmtClock(5), '0:05')
  assert.equal(tc.decimalHours(462), 7.7)
  assert.equal(tc.overtimeMinutes(41 * 60), 60)
  assert.equal(tc.overtimeMinutes(39 * 60), 0)
})

test('old entries that only have a name still match the person', () => {
  const marco = { id: 7, name: 'Marco Reyes' }
  const list = [
    entry({ id: 1, staff_id: 7 }),
    entry({ id: 2, staff_id: null, staff_name: ' marco reyes ' }),
    entry({ id: 3, staff_id: 9, staff_name: 'Marco Reyes' }), // someone else who shares the name
    entry({ id: 4, staff_id: null, staff_name: 'Tasha Lee' }),
  ]
  assert.deepEqual(tc.entriesFor(list, marco).map(e => e.id), [1, 2])
})

test('status: in, on break, out, and a forgotten clock-out', () => {
  const marco = { id: 7, name: 'Marco Reyes' }
  const now = Date.parse('2026-10-14T16:00:00.000Z')
  assert.equal(tc.statusOf([entry()], marco, now).state, 'out')
  const working = entry({ id: 5, clock_out: null })
  assert.equal(tc.statusOf([working], marco, now).state, 'in')
  assert.equal(tc.statusOf([working], marco, now).stale, false)
  assert.equal(tc.statusOf([{ ...working, break_started_at: '2026-10-14T15:50:00.000Z' }], marco, now).state, 'break')
  const old = entry({ id: 6, clock_in: '2026-10-12T13:00:00.000Z', clock_out: null })
  assert.equal(tc.statusOf([old], marco, now).stale, true)
  assert.equal(tc.openEntry([old, working], marco)?.id, 5) // the newest open entry wins
})

test('week totals count each entry on the day it started', () => {
  const night = entry({ id: 8, clock_in: '2026-10-14T23:00:00.000Z', clock_out: '2026-10-15T07:00:00.000Z' }) // 6 PM to 2 AM
  const now = Date.parse('2026-10-20T00:00:00.000Z')
  assert.equal(tc.minutesOnDay([night], '2026-10-14', now), 480)
  assert.equal(tc.minutesOnDay([night], '2026-10-15', now), 0)
  assert.equal(tc.minutesInDays([night, entry()], tc.weekKeys('2026-10-12'), now), 480 + 510)
})

test('an entry is checked the same way in the browser and on the server', () => {
  const now = Date.parse('2026-10-14T18:00:00.000Z')
  const ok = { clock_in: '2026-10-14T13:00:00.000Z', clock_out: '2026-10-14T17:00:00.000Z' }
  assert.equal(tc.validateEntry(ok, { nowMs: now, others: [] }), '')
  assert.match(tc.validateEntry({ clock_in: 'x', clock_out: null }, { nowMs: now, others: [] }), /valid clock-in/)
  assert.match(tc.validateEntry({ ...ok, clock_out: 'x' }, { nowMs: now, others: [] }), /valid clock-out/)
  assert.match(tc.validateEntry({ ...ok, clock_out: null }, { nowMs: now, others: [] }), /Enter a clock-out/)
  assert.equal(tc.validateEntry({ ...ok, clock_out: null }, { nowMs: now, others: [], allowOpen: true }), '')
  assert.match(tc.validateEntry({ clock_in: ok.clock_out, clock_out: ok.clock_in }, { nowMs: now, others: [] }), /must be after/)
  assert.match(tc.validateEntry({ clock_in: '2026-10-14T19:00:00.000Z', clock_out: '2026-10-14T20:00:00.000Z' }, { nowMs: now, others: [] }), /future/)
  assert.match(tc.validateEntry({ clock_in: '2026-10-13T01:00:00.000Z', clock_out: '2026-10-14T03:00:00.000Z' }, { nowMs: now, others: [] }), /24 hours/)
})

test('two entries for one person cannot overlap, but back to back is fine', () => {
  const now = Date.parse('2026-10-14T23:00:00.000Z')
  const other = { id: 1, clock_in: '2026-10-14T13:00:00.000Z', clock_out: '2026-10-14T17:00:00.000Z' }
  const clash = { clock_in: '2026-10-14T16:00:00.000Z', clock_out: '2026-10-14T20:00:00.000Z' }
  assert.match(tc.validateEntry(clash, { nowMs: now, others: [other] }), /overlaps another entry \(Wed, Oct 14, 8:00 AM to 12:00 PM\)/)
  assert.equal(tc.validateEntry(clash, { nowMs: now, others: [other], selfId: 1 }), '') // editing that same entry
  assert.equal(tc.validateEntry({ clock_in: other.clock_out, clock_out: '2026-10-14T21:00:00.000Z' }, { nowMs: now, others: [other] }), '')
  const running = { id: 2, clock_in: '2026-10-14T20:00:00.000Z', clock_out: null }
  assert.match(tc.validateEntry({ clock_in: '2026-10-14T21:00:00.000Z', clock_out: '2026-10-14T22:00:00.000Z' }, { nowMs: now, others: [running] }), /to now/)
})

test('roles from older screens are understood', () => {
  assert.equal(tc.normalizeRole('service_advisor'), 'advisor')
  assert.equal(tc.normalizeRole(' Service Advisor '), 'advisor')
  assert.equal(tc.normalizeRole('Technician'), 'technician')
  assert.equal(tc.normalizeRole('astronaut'), '')
  assert.equal(tc.roleLabel('service_advisor'), 'Service advisor')
  assert.equal(tc.roleLabel('employee'), 'Other')
  assert.equal(tc.roleLabel('shop_dog'), 'Shop dog')
  assert.equal(tc.roleLabel(null), 'Team member')
  assert.equal(tc.isTechnician('technician'), true)
  assert.equal(tc.isTechnician('manager'), false)
})

test('initials', () => {
  assert.equal(tc.initials('Marco Reyes'), 'MR')
  assert.equal(tc.initials('tasha'), 'T')
  assert.equal(tc.initials('Mary Ann De La Cruz'), 'MC')
  assert.equal(tc.initials('   '), '?')
})

test('why an entry changed is kept in the note and read back', () => {
  const n = tc.stampNote('edited', '  forgot to clock out  ')
  assert.equal(n, 'Edited: forgot to clock out')
  assert.equal(tc.noteKind(n), 'edited')
  assert.equal(tc.noteText(n), 'forgot to clock out')
  assert.equal(tc.noteKind(tc.stampNote('manual', 'phone died')), 'manual')
  assert.equal(tc.noteKind('plain note'), null)
  assert.equal(tc.noteText('plain note'), 'plain note')
  assert.equal(tc.noteKind(null), null)
})

test('datetime-local values round trip on local time', () => {
  const iso = '2026-10-14T13:02:00.000Z'
  assert.equal(tc.toLocalInput(iso), '2026-10-14T08:02')
  assert.equal(tc.fromLocalInput('2026-10-14T08:02'), iso)
  assert.equal(tc.fromLocalInput('2026-10-14'), null)
  assert.equal(tc.fromLocalInput(''), null)
  assert.equal(tc.toLocalInput(null), '')
})

test('the payroll file is safe to open in a spreadsheet', () => {
  const people = [{ id: 7, name: '=cmd|calc', role: 'technician', active: true }, { id: 8, name: 'Tasha "TJ" Lee', role: 'advisor', active: true }]
  const rows = [
    entry({ id: 1, staff_id: 7, staff_name: '=cmd|calc', note: 'Edited: left, early' }),
    entry({ id: 2, staff_id: 8, staff_name: 'Tasha "TJ" Lee', clock_out: null, break_minutes: 0 }),
  ]
  const csv = tc.timesheetCsv(people, rows, Date.parse('2026-10-14T15:00:00.000Z'))
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'Name,Role,Date,Clock in,Clock out,Break minutes,Hours,Note')
  assert.ok(lines[1].startsWith("'=cmd|calc,Technician,2026-10-14,8:00 AM,4:30 PM,0,8.50,\"left, early\""), lines[1])
  assert.ok(lines[2].startsWith('"Tasha ""TJ"" Lee",Service advisor,2026-10-14,8:00 AM,Still clocked in,0,2.00,'), lines[2])
})

test('rows from the API are made safe to do math on', () => {
  const e = tc.normalizeEntry({ id: '12', staff_id: '7', staff_name: 'Marco', clock_in: '2026-10-14T13:00:00Z', clock_out: '', hours_worked: null, note: null })
  assert.equal(e.id, 12)
  assert.equal(e.staff_id, 7)
  assert.equal(e.clock_out, null)
  assert.equal(e.break_minutes, undefined)
  assert.equal(tc.normalizeEntry({ id: 1, staff_id: null, clock_in: 'x' }).staff_id, null)
})
