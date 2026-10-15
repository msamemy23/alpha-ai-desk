import test from 'node:test'
import assert from 'node:assert/strict'
import './helpers-reports.mjs'
import { payrollSummary, payrollSummaryCsv, payrollWeeklyCsv } from '../src/lib/payroll-export.ts'
import { minutesInDays, overtimeMinutes, stampNote, weekKeys, workedMinutes, decimalHours } from '../src/lib/timeclock.ts'

// 2026-10-05 is a Monday. Times are Chicago daylight time (UTC-5), so 13:00Z is 8:00 in the morning.
const shift = (id, who, day, outHour = 22, outMin = 30, extra = {}) => ({
  id, staff_id: who, staff_name: who === 1 ? 'Sam Tech' : who === 2 ? 'Lee Tech' : 'Old Name', clock_in: `2026-10-${day}T13:00:00Z`,
  clock_out: `2026-10-${day}T${String(outHour).padStart(2, '0')}:${String(outMin).padStart(2, '0')}:00Z`, hours_worked: null, note: null, break_minutes: 30, break_started_at: null, ...extra,
})
const people = [
  { id: 1, name: 'Sam Tech', role: 'technician', active: true },
  { id: 2, name: 'Lee Tech', role: 'technician', active: true },
  { id: 3, name: 'Quit Early', role: 'technician', active: false },
]
const NOW = Date.parse('2026-10-14T18:00:00Z')
const WEEK = { from: '2026-10-05', to: '2026-10-11' }
const entries = [
  // Sam: five 9 hour days (9:30 between punches minus a 30 minute break) = 45 hours, 5 of them overtime
  ...['05', '06', '07', '08', '09'].map((d, i) => shift(10 + i, 1, d)),
  // Lee: one normal 8 hour day, one day never clocked out, one edited by a manager
  shift(20, 2, '05', 21, 30),
  { id: 21, staff_id: 2, staff_name: 'Lee Tech', clock_in: '2026-10-06T13:00:00Z', clock_out: null, hours_worked: null, note: null, break_minutes: 0 },
  shift(22, 2, '07', 21, 30, { note: stampNote('edited', 'forgot to punch') }),
  // An old entry that only has a name, no staff id
  { id: 30, staff_id: null, staff_name: 'quit early', clock_in: '2026-10-08T13:00:00Z', clock_out: '2026-10-08T17:00:00Z', hours_worked: 4, note: null, break_minutes: 0 },
]

test('hours match the time clock: time between punches minus breaks, overtime over 40 in a Monday to Sunday week', () => {
  const s = payrollSummary(people, entries, WEEK, NOW)
  const sam = s.rows.find(r => r.name === 'Sam Tech')
  assert.deepEqual([sam.regularHours, sam.overtimeHours, sam.totalHours, sam.breakMinutes, sam.daysWorked, sam.shifts], [40, 5, 45, 150, 5, 5])
  assert.deepEqual(sam.weeks.map(w => [w.weekStart, w.regularMin, w.overtimeMin, w.partial]), [['2026-10-05', 2400, 300, false]])
  // The same number the Team screen shows for that week.
  const mine = entries.filter(e => e.staff_id === 1)
  const teamMinutes = minutesInDays(mine, weekKeys('2026-10-05'), NOW)
  assert.equal(decimalHours(teamMinutes), sam.totalHours)
  assert.equal(overtimeMinutes(teamMinutes), sam.overtimeHours * 60)
  assert.equal(workedMinutes(mine[0], NOW), 540)
})

test('a forgotten clock-out counts as nothing and is flagged by name, an edited shift is flagged too', () => {
  const lee = payrollSummary(people, entries, WEEK, NOW).rows.find(r => r.name === 'Lee Tech')
  assert.equal(lee.totalHours, 16, 'two real shifts of 8 hours; the open one from days ago adds nothing')
  assert.deepEqual(lee.flags.map(f => f.kind).sort(), ['edited', 'forgotten'])
  assert.deepEqual(lee.flags.find(f => f.kind === 'forgotten').entryIds, [21])
  assert.match(lee.flags.find(f => f.kind === 'forgotten').text, /never clocked out and count as zero hours/)
})

test('old entries that only have a name still reach the right person, and people who left appear when they have hours', () => {
  const s = payrollSummary(people, entries, WEEK, NOW)
  assert.equal(s.rows.find(r => r.name === 'Quit Early').totalHours, 4)
  const quiet = payrollSummary(people, entries, { from: '2026-09-01', to: '2026-09-07' }, NOW)
  assert.deepEqual(quiet.rows.map(r => r.name), ['Lee Tech', 'Sam Tech'], 'a person who left and has no hours is not listed')
  assert.equal(quiet.rows[0].totalHours, 0)
})

test('dates that cut into a week say that overtime may be understated', () => {
  const cut = payrollSummary(people, entries, { from: '2026-10-07', to: '2026-10-11' }, NOW)
  const sam = cut.rows.find(r => r.name === 'Sam Tech')
  assert.equal(sam.totalHours, 27); assert.equal(sam.overtimeHours, 0)
  assert.ok(sam.flags.some(f => f.kind === 'partial-week'))
  assert.equal(payrollSummary(people, entries, WEEK, NOW).rows.some(r => r.flags.some(f => f.kind === 'partial-week')), false)
})

test('still clocked in is flagged and counts up to now', () => {
  const live = [{ id: 40, staff_id: 1, staff_name: 'Sam Tech', clock_in: '2026-10-14T13:00:00Z', clock_out: null, hours_worked: null, note: null, break_minutes: 0 }]
  const s = payrollSummary(people, live, { from: '2026-10-12', to: '2026-10-18' }, NOW)
  const sam = s.rows.find(r => r.name === 'Sam Tech')
  assert.equal(sam.totalHours, 5)
  assert.deepEqual(sam.flags.map(f => f.kind), ['open'])
  assert.equal(s.flagged, 1)
})

test('the files are plain csv, one row per person and one row per week', () => {
  const s = payrollSummary(people, entries, WEEK, NOW)
  const a = payrollSummaryCsv(s).trim().split('\r\n')
  assert.equal(a[0], 'Name,Role,Regular hours,Overtime hours,Total hours,Break minutes,Days worked,Needs a look')
  assert.ok(a.includes('Quit Early,Technician,4.00,0.00,4.00,0,1,'))
  assert.ok(a.some(l => l.startsWith('Sam Tech,Technician,40.00,5.00,45.00,150,5,')))
  const b = payrollWeeklyCsv(s).trim().split('\r\n')
  assert.equal(b[0], 'Name,Week starting (Monday),Regular hours,Overtime hours,Total hours,Partial week')
  assert.ok(b.includes('Sam Tech,2026-10-05,40.00,5.00,45.00,No'))
})

test('reading punches never changes them', () => {
  const copy = JSON.stringify(entries)
  payrollSummary(people, entries, WEEK, NOW)
  assert.equal(JSON.stringify(entries), copy)
})
