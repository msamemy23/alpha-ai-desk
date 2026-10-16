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

// ---- the shop's own pay rules (Team, Rules) decide overtime here too ----
import { readFileSync } from 'node:fs'
import { personPeriod } from '../src/lib/payroll.ts'
import { DEFAULT_RULES, describeRules, splitPeriod } from '../src/lib/timerules.ts'

// 2026-10-04 is a Sunday. Three 10 hour days (Mon to Wed) = 30 hours in the week.
const longDays = ['05', '06', '07'].map((d, i) => shift(60 + i, 1, d, 23, 30))
const SUN_WEEK = { from: '2026-10-04', to: '2026-10-10' }
const daily8 = { ...DEFAULT_RULES, weekStart: 0, weeklyOtMin: 2400, dailyOtMin: 480, dailyDoubleMin: null }

test('daily overtime from the shop rules shows here, and the plain rule shows none for the same 30 hours', () => {
  const plain = payrollSummary(people, longDays, SUN_WEEK, NOW).rows.find(r => r.name === 'Sam Tech')
  assert.deepEqual([plain.regularHours, plain.overtimeHours, plain.totalHours], [30, 0, 30])
  const ruled = payrollSummary(people, longDays, SUN_WEEK, NOW, daily8).rows.find(r => r.name === 'Sam Tech')
  assert.deepEqual([ruled.regularHours, ruled.overtimeHours, ruled.doubleHours, ruled.totalHours], [24, 6, 0, 30])
})

test('this screen and the Team screen give the same split for the same pay week', () => {
  for (const rules of [daily8, { ...daily8, weekStart: 1 }, { ...DEFAULT_RULES, weekStart: 3 }, { ...daily8, dailyDoubleMin: 720 }, { ...DEFAULT_RULES, weeklyOtMin: null }]) {
    const start = rules.weekStart === 0 ? '2026-10-04' : rules.weekStart === 1 ? '2026-10-05' : '2026-10-07'
    const to = start === '2026-10-04' ? '2026-10-10' : start === '2026-10-05' ? '2026-10-11' : '2026-10-13'
    const sam = people[0]
    const mine = [...entries.filter(e => e.staff_id === 1), ...longDays]
    const team = personPeriod(sam, mine, start, 7, rules, NOW).split
    const row = payrollSummary(people, mine, { from: start, to }, NOW, rules).rows.find(r => r.id === 1)
    assert.equal(row.regularHours, decimalHours(team.regular), JSON.stringify(rules))
    assert.equal(row.overtimeHours, decimalHours(team.overtime), JSON.stringify(rules))
    assert.equal(row.doubleHours, decimalHours(team.double), JSON.stringify(rules))
  }
})

test('double time is split out, and its column only appears in the files when someone earned some', () => {
  const rules = { ...daily8, weekStart: 1, dailyDoubleMin: 720 }
  const long = [{ id: 70, staff_id: 1, staff_name: 'Sam Tech', clock_in: '2026-10-06T12:00:00Z', clock_out: '2026-10-07T01:30:00Z', hours_worked: null, note: null, break_minutes: 30, break_started_at: null }]
  const s = payrollSummary(people, long, WEEK, NOW, rules)
  const sam = s.rows.find(r => r.name === 'Sam Tech')
  assert.deepEqual([sam.regularHours, sam.overtimeHours, sam.doubleHours, sam.totalHours], [8, 4, 1, 13])
  assert.equal(s.doubleHours, 1)
  assert.equal(payrollSummaryCsv(s).split('\r\n')[0], 'Name,Role,Regular hours,Overtime hours,Double time hours,Total hours,Break minutes,Days worked,Needs a look')
  assert.equal(payrollWeeklyCsv(s).split('\r\n')[0], 'Name,Week starting (Monday),Regular hours,Overtime hours,Double time hours,Total hours,Partial week')
  // Everyone else keeps the files exactly as before.
  assert.equal(payrollSummaryCsv(payrollSummary(people, entries, WEEK, NOW)).split('\r\n')[0], 'Name,Role,Regular hours,Overtime hours,Total hours,Break minutes,Days worked,Needs a look')
})

test('the week-start name follows the shop rule in the file and in the partial-week warning', () => {
  const s = payrollSummary(people, longDays, { from: '2026-10-06', to: '2026-10-10' }, NOW, daily8)
  assert.equal(payrollWeeklyCsv(s).split('\r\n')[0], 'Name,Week starting (Sunday),Regular hours,Overtime hours,Total hours,Partial week')
  const sam = s.rows.find(r => r.name === 'Sam Tech')
  assert.ok(sam.weeks.every(w => w.weekStart === '2026-10-04'))
  assert.match(sam.flags.find(f => f.kind === 'partial-week').text, /Sunday to Saturday week/)
  assert.match(s.notes[0], /Pay weeks run Sunday to Saturday\. Overtime after 40 hours a week and 8 hours a day\./)
  assert.equal(describeRules(daily8), 'Overtime after 40 hours a week and 8 hours a day.')
  // A week that ends on its last day is not partial.
  assert.equal(payrollSummary(people, longDays, SUN_WEEK, NOW, daily8).rows.some(r => r.flags.some(f => f.kind === 'partial-week')), false)
})

test('the Reports payroll screen reads the shop rules before it shows overtime, and says when it could not', () => {
  const panel = readFileSync(new URL('../src/components/reports/PayrollPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /const payRules = useRules\(\)/)
  assert.match(panel, /payrollSummary\(people, clock\.entries, ctx\.range, clock\.now \|\| Date\.now\(\), payRules\.rules\)/)
  assert.match(panel, /clock\.loading \|\| payRules\.loading/)
  assert.match(panel, /Your pay rules did not load/)
  assert.doesNotMatch(panel, /Overtime is the part of a Monday to Sunday week over 40 hours/)
  // splitPeriod is the same maths the Team screen runs.
  assert.equal(splitPeriod([600, 600, 600, 0, 0, 0, 0], daily8).overtime, 360)
})
