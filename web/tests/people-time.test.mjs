// Time clock rules for the pay week, overtime, time on a job, review and payroll files. Run for real, not read as text.
process.env.TZ = 'America/Chicago'

import test from 'node:test'
import assert from 'node:assert/strict'
import * as tc from '../src/lib/timeclock.ts'
import * as csv from '../src/lib/csv.ts'
import * as tr from '../src/lib/timerules.ts'
import * as jt from '../src/lib/jobtime.ts'
import * as pr from '../src/lib/payroll.ts'

const H = 60
const entry = (over = {}) => ({
  id: 1, staff_id: 7, staff_name: 'Marco Reyes', clock_in: '2026-10-14T13:00:00.000Z', clock_out: '2026-10-14T21:30:00.000Z',
  hours_worked: 8.5, note: null, ...over,
})
const person = { id: 7, name: 'Marco Reyes', role: 'technician', active: true }

/* ---------- csv ---------- */

test('csv cells are quoted and guarded against formulas', () => {
  assert.equal(csv.csvCell('plain'), 'plain')
  assert.equal(csv.csvCell('a,b'), '"a,b"')
  assert.equal(csv.csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csv.csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(csv.csvCell('+1 713'), "'+1 713")
  assert.equal(csv.csvCell('-5 off'), "'-5 off")
  assert.equal(csv.csvCell('@name'), "'@name")
  assert.equal(csv.csvCell(-12.5), '-12.5') // a real negative number is not a formula
  assert.equal(csv.csvCell(null), '')
  assert.equal(csv.csvCell(undefined), '')
  assert.equal(csv.toCsv([['a', 'b'], [1, 'x']]), 'a,b\r\n1,x\r\n')
})

test('csv reads what it writes, including quotes, commas and line breaks', () => {
  const rows = [['Name', 'Note'], ['Dana, Jr.', 'said "ok"'], ['Lee', 'line one\nline two'], ['=cmd', '+1']]
  const back = csv.parseCsv(csv.toCsv(rows)).rows
  assert.deepEqual(back, [['Name', 'Note'], ['Dana, Jr.', 'said "ok"'], ['Lee', 'line one\nline two'], ['=cmd', '+1']])
})

test('csv reads semicolon and tab files, drops the byte-order mark and blank lines', () => {
  assert.deepEqual(csv.parseCsv('﻿a;b\r\n\r\n1;2\r\n').rows, [['a', 'b'], ['1', '2']])
  assert.equal(csv.parseCsv('a;b\n1;2').delimiter, ';')
  assert.equal(csv.parseCsv('a\tb\n1\t2').delimiter, '\t')
  assert.equal(csv.parseCsv('a,b\n1,2').delimiter, ',')
  assert.deepEqual(csv.parseCsv('a,b\r1,2\r').rows, [['a', 'b'], ['1', '2']])
  assert.deepEqual(csv.parseCsv('').rows, [])
  assert.deepEqual(csv.parseCsv('a,"b,c"\n"1",2').rows, [['a', 'b,c'], ['1', '2']])
})

test('csv stops at the row limit and says so', () => {
  const r = csv.parseCsv('a\n1\n2\n3\n4', { maxRows: 3 })
  assert.equal(r.rows.length, 3)
  assert.equal(r.truncated, true)
  assert.equal(csv.parseCsv('a\n1', { maxRows: 3 }).truncated, false)
})

/* ---------- pay week ---------- */

test('the pay week can start on any day', () => {
  const wed = new Date(2026, 9, 14)
  assert.equal(tc.weekStartKey(wed), '2026-10-12') // Monday by default, as before
  assert.equal(tc.weekStartKey(wed, 1), '2026-10-12')
  assert.equal(tc.weekStartKey(wed, 0), '2026-10-11') // Sunday
  assert.equal(tc.weekStartKey(wed, 3), '2026-10-14') // Wednesday is its own week start
  assert.equal(tc.weekStartKey(wed, 4), '2026-10-08') // Thursday before
  assert.equal(tc.weekStartKey(wed, 6), '2026-10-10') // Saturday
  assert.equal(tc.weekStartKey(wed, 99), '2026-10-12') // nonsense falls back to Monday
  assert.equal(tc.weekStartKey(wed, 2.5), '2026-10-12')
})

test('two-week periods count from the anchor', () => {
  const rules = { weekStart: 1, periodDays: 14, periodAnchor: '2026-10-05' }
  assert.equal(tr.periodStartFor('2026-10-05', rules), '2026-10-05')
  assert.equal(tr.periodStartFor('2026-10-14', rules), '2026-10-05')
  assert.equal(tr.periodStartFor('2026-10-19', rules), '2026-10-19')
  assert.equal(tr.periodStartFor('2026-10-25', rules), '2026-10-19')
  assert.equal(tr.periodStartFor('2026-09-30', rules), '2026-09-21') // before the anchor still lines up
  assert.equal(tr.periodStartFor('2026-10-14', { weekStart: 1, periodDays: 7, periodAnchor: '' }), '2026-10-12')
  // An anchor that is not a week start is moved to the week start that holds it.
  assert.equal(tr.periodStartFor('2026-10-08', { weekStart: 1, periodDays: 14, periodAnchor: '2026-10-07' }), '2026-10-05')
})

test('a pay period lists its days and weeks across daylight saving', () => {
  const keys = tr.periodKeys('2026-10-26', 14)
  assert.equal(keys.length, 14)
  assert.equal(keys[6], '2026-11-01')
  assert.equal(keys[7], '2026-11-02')
  assert.deepEqual(tr.weeksIn('2026-10-26', 14), ['2026-10-26', '2026-11-02'])
  assert.deepEqual(tr.weeksIn('2026-10-26', 7), ['2026-10-26'])
  assert.equal(tr.daysBetween('2026-10-26', '2026-11-02'), 7)
  assert.equal(tr.periodLabel('2026-10-12', 7), 'Oct 12 to 18, 2026')
  assert.equal(tr.periodLabel('2026-10-26', 14), 'Oct 26 to Nov 8, 2026')
})

/* ---------- rules ---------- */

test('normalizeRules gives a safe complete rule set from anything', () => {
  assert.deepEqual(tr.normalizeRules(null), tr.DEFAULT_RULES)
  assert.deepEqual(tr.normalizeRules('junk'), tr.DEFAULT_RULES)
  assert.deepEqual(tr.normalizeRules({}), tr.DEFAULT_RULES)
  const r = tr.normalizeRules({ week_start: 0, period_days: 14, period_anchor: '2026-10-04', weekly_ot_min: 2400, daily_ot_min: 480, daily_double_min: 720, state: 'ca' })
  assert.equal(r.weekStart, 0)
  assert.equal(r.periodDays, 14)
  assert.equal(r.periodAnchor, '2026-10-04')
  assert.equal(r.dailyOtMin, 480)
  assert.equal(r.dailyDoubleMin, 720)
  assert.equal(r.state, 'CA')
  // Out of range values do not get through.
  const bad = tr.normalizeRules({ weekStart: 9, periodDays: 10, periodAnchor: '2026-13-45', weeklyOtMin: 5, dailyOtMin: 99999 })
  assert.equal(bad.weekStart, 1)
  assert.equal(bad.periodDays, 7)
  assert.equal(bad.periodAnchor, '')
  assert.equal(bad.dailyOtMin, null)
  assert.equal(bad.weeklyOtMin, 2400)
})

test('double time at or below the overtime line is dropped, and weekly overtime can be switched off', () => {
  assert.equal(tr.normalizeRules({ weeklyOtMin: 2400, dailyOtMin: 600, dailyDoubleMin: 600 }).dailyDoubleMin, null)
  assert.equal(tr.normalizeRules({ weeklyOtMin: 2400, dailyOtMin: null, dailyDoubleMin: 720 }).dailyDoubleMin, null)
  const off = tr.normalizeRules({ weeklyOtMin: null, dailyOtMin: null })
  assert.equal(off.weeklyOtMin, null)
})

test('location checking needs a place to check against and a radius in range', () => {
  assert.equal(tr.normalizeRules({ locationMode: 'require' }).locationMode, 'off')
  const ok = tr.normalizeRules({ locationMode: 'record', geofence: { lat: 29.76, lng: -95.36, radiusM: 10 } })
  assert.equal(ok.locationMode, 'record')
  assert.equal(ok.geofence.radiusM, 30)
  assert.equal(tr.normalizeRules({ locationMode: 'record', geofence_lat: 29.76, geofence_lng: -95.36, geofence_radius_m: 99999 }).geofence.radiusM, 5000)
  assert.equal(tr.normalizeRules({ geofence: { lat: 200, lng: 0, radiusM: 100 } }).geofence, null)
  assert.equal(tr.normalizeRules({ require_pin: false }).requirePin, false)
  assert.equal(tr.normalizeRules({}).requirePin, true)
})

test('a state picks its starting rule, and any other state uses the federal one', () => {
  assert.equal(tr.presetForState('TX').key, 'federal')
  assert.equal(tr.presetForState('tx').key, 'federal')
  assert.equal(tr.presetForState('CA').key, 'daily8dt12')
  assert.equal(tr.presetForState('AK').key, 'daily8')
  assert.equal(tr.presetForState('CO').key, 'daily12')
  assert.equal(tr.presetForState('').key, 'federal')
  assert.equal(tr.presetKeyOf({ weeklyOtMin: 2400, dailyOtMin: null, dailyDoubleMin: null }), 'federal')
  assert.equal(tr.presetKeyOf({ weeklyOtMin: 2100, dailyOtMin: null, dailyDoubleMin: null }), 'custom')
  assert.equal(tr.US_STATES.length, 51)
})

/* ---------- regular, overtime, double ---------- */

const federal = { weeklyOtMin: 2400, dailyOtMin: null, dailyDoubleMin: null }
const daily8 = { weeklyOtMin: 2400, dailyOtMin: 480, dailyDoubleMin: null }
const california = { weeklyOtMin: 2400, dailyOtMin: 480, dailyDoubleMin: 720 }

test('federal overtime begins after 40 hours in the week', () => {
  const w = tr.splitWeek([9 * H, 9 * H, 9 * H, 9 * H, 9 * H, 0, 0], federal)
  assert.equal(w.regular, 2400)
  assert.equal(w.overtime, 300)
  assert.equal(w.double, 0)
  assert.deepEqual(w.days[4], { regular: 4 * H, overtime: 5 * H, double: 0 }) // 36 regular hours before Friday, so only 4 more are regular
  assert.equal(w.days[3].overtime, 0)
})

test('a short week has no overtime and a negative or odd day counts as nothing', () => {
  const w = tr.splitWeek([8 * H, 8 * H, 8 * H, 8 * H, 7 * H, 0, 0], federal)
  assert.equal(w.overtime, 0)
  assert.equal(w.regular, 39 * H)
  assert.equal(tr.splitWeek([-5, NaN, 60], federal).regular, 60)
})

test('daily overtime comes first and is never counted twice with weekly overtime', () => {
  const w = tr.splitWeek([10 * H, 10 * H, 10 * H, 10 * H, 10 * H, 0, 0], daily8)
  // Each day: 8 regular, 2 overtime. Five days of 8 regular is 40, so weekly adds nothing more.
  assert.equal(w.regular, 40 * H)
  assert.equal(w.overtime, 10 * H)
  assert.equal(w.regular + w.overtime + w.double, 50 * H)
  // Six days: the sixth day's regular minutes are past the weekly line, so they become overtime too.
  const six = tr.splitWeek([10 * H, 10 * H, 10 * H, 10 * H, 10 * H, 6 * H, 0], daily8)
  assert.equal(six.regular, 40 * H)
  assert.equal(six.overtime, 10 * H + 6 * H)
  assert.equal(six.regular + six.overtime + six.double, 56 * H)
})

test('double time over 12 hours a day', () => {
  const w = tr.splitWeek([14 * H, 0, 0, 0, 0, 0, 0], california)
  assert.deepEqual(w.days[0], { regular: 8 * H, overtime: 4 * H, double: 2 * H })
  assert.equal(w.regular + w.overtime + w.double, 14 * H)
})

test('no overtime at all when every rule is off', () => {
  const off = { weeklyOtMin: null, dailyOtMin: null, dailyDoubleMin: null }
  const w = tr.splitWeek([12 * H, 12 * H, 12 * H, 12 * H, 12 * H, 12 * H, 12 * H], off)
  assert.equal(w.regular, 84 * H)
  assert.equal(w.overtime, 0)
})

test('a two-week period is split one week at a time', () => {
  const week1 = [10 * H, 10 * H, 10 * H, 10 * H, 10 * H, 0, 0]
  const week2 = [4 * H, 4 * H, 4 * H, 0, 0, 0, 0]
  const p = tr.splitPeriod([...week1, ...week2], federal)
  assert.equal(p.weeks.length, 2)
  assert.equal(p.weeks[0].overtime, 10 * H)
  assert.equal(p.weeks[1].overtime, 0) // 62 hours across two weeks is not 22 hours of overtime
  assert.equal(p.regular, 40 * H + 12 * H)
  assert.equal(p.total, 62 * H)
  assert.equal(p.days.length, 14)
})

test('the rules read back as one plain sentence', () => {
  assert.equal(tr.describeRules(federal), 'Overtime after 40 hours a week.')
  assert.equal(tr.describeRules(daily8), 'Overtime after 40 hours a week and 8 hours a day.')
  assert.equal(tr.describeRules(california), 'Overtime after 40 hours a week and 8 hours a day. Double time after 12 hours a day.')
  assert.equal(tr.describeRules({ weeklyOtMin: null, dailyOtMin: null, dailyDoubleMin: null }), 'No overtime is figured.')
})

/* ---------- undo clock-out ---------- */

test('a clock-out can be undone for fifteen minutes', () => {
  const out = Date.parse('2026-10-14T21:30:00.000Z')
  const e = entry()
  assert.equal(tc.undoableEntry([e], out + 60_000)?.id, 1)
  assert.equal(tc.undoableEntry([e], out + 15 * 60_000)?.id, 1)
  assert.equal(tc.undoableEntry([e], out + 15 * 60_000 + 1), null)
  assert.equal(tc.undoableEntry([e], out - 1000), null) // a clock-out in the future is not something to undo
})

test('undo is only offered when the person is not clocked in again, and picks the latest entry', () => {
  const out = Date.parse('2026-10-14T21:30:00.000Z')
  const earlier = entry({ id: 1, clock_in: '2026-10-14T12:00:00.000Z', clock_out: '2026-10-14T17:00:00.000Z' })
  const later = entry({ id: 2, clock_in: '2026-10-14T18:00:00.000Z', clock_out: '2026-10-14T21:30:00.000Z' })
  assert.equal(tc.undoableEntry([earlier, later], out + 60_000)?.id, 2)
  assert.equal(tc.undoableEntry([later, earlier], out + 60_000)?.id, 2)
  const again = entry({ id: 3, clock_in: '2026-10-14T21:45:00.000Z', clock_out: null })
  assert.equal(tc.undoableEntry([later, again], out + 20 * 60_000), null)
  assert.equal(tc.undoableEntry([], out), null)
})

test('entries carry the location check once the column exists', () => {
  const e = tc.normalizeEntry({ id: 1, staff_id: 7, staff_name: 'A', clock_in: '2026-10-14T13:00:00Z', in_location: 'outside', in_distance_m: '420' })
  assert.equal(e.in_location, 'outside')
  assert.equal(e.in_distance_m, 420)
  const old = tc.normalizeEntry({ id: 1, staff_id: 7, staff_name: 'A', clock_in: '2026-10-14T13:00:00Z' })
  assert.equal(old.in_location, null)
  assert.equal(old.in_distance_m, null)
})

/* ---------- time on a job ---------- */

const seg = (over = {}) => ({
  id: 1, staff_id: 7, staff_name: 'Marco Reyes', entry_id: 1, job_id: 'job-1', job_label: 'RO 1042, 2017 Toyota Camry',
  started_at: '2026-10-14T14:00:00.000Z', ended_at: '2026-10-14T16:00:00.000Z', note: null, ...over,
})
const NOW = Date.parse('2026-10-14T20:00:00.000Z')

test('job segments count their minutes, running ones count to now, forgotten ones count nothing', () => {
  assert.equal(jt.segmentMinutes(seg(), NOW), 120)
  assert.equal(jt.segmentMinutes(seg({ ended_at: null, started_at: '2026-10-14T19:00:00.000Z' }), NOW), 60)
  assert.equal(jt.segmentStale(seg({ ended_at: null, started_at: '2026-10-13T20:00:00.000Z' }), NOW), true)
  assert.equal(jt.segmentMinutes(seg({ ended_at: null, started_at: '2026-10-13T20:00:00.000Z' }), NOW), 0)
  assert.equal(jt.segmentMinutes(seg({ ended_at: '2026-10-14T13:00:00.000Z' }), NOW), 0) // ends before it starts
  assert.equal(jt.segmentMinutes(seg({ started_at: 'junk' }), NOW), 0)
})

test('minutes add up by job and by person, and the running job is found', () => {
  const list = [
    seg({ id: 1 }),
    seg({ id: 2, staff_id: 8, staff_name: 'Dana Fox', started_at: '2026-10-14T15:00:00.000Z', ended_at: '2026-10-14T16:00:00.000Z' }),
    seg({ id: 3, job_id: 'job-2', job_label: 'RO 1043', started_at: '2026-10-14T18:00:00.000Z', ended_at: null }),
    seg({ id: 4, job_id: '' }),
  ]
  const m = jt.minutesByJob(list, NOW)
  assert.equal(m.size, 2)
  assert.equal(m.get('job-1').minutes, 180)
  assert.equal(m.get('job-1').byStaff.get('marco reyes'), 120)
  assert.equal(m.get('job-1').byStaff.get('dana fox'), 60)
  assert.equal(m.get('job-2').minutes, 120)
  assert.equal(jt.runningSegment(list, { id: 7, name: 'Marco Reyes' })?.id, 3)
  assert.equal(jt.runningSegment(list, { id: 8, name: 'Dana Fox' }), null)
  assert.equal(jt.minutesByJob(list, NOW, new Map([[7, 'Marco R.']])).get('job-1').byStaff.get('marco r.'), 120)
})

test('job minutes for a person only count the days asked for', () => {
  const list = [seg({ id: 1 }), seg({ id: 2, started_at: '2026-10-15T14:00:00.000Z', ended_at: '2026-10-15T15:00:00.000Z' })]
  const dayOf = iso => tc.dayKey(new Date(iso))
  assert.equal(jt.jobMinutesFor(list, { id: 7, name: 'Marco Reyes' }, new Set(['2026-10-14']), dayOf, NOW), 120)
  assert.equal(jt.jobMinutesFor(list, { id: 7, name: 'Marco Reyes' }, new Set(['2026-10-14', '2026-10-15']), dayOf, NOW), 180)
  assert.equal(jt.jobMinutesFor(list, { id: 9, name: 'Nobody' }, new Set(['2026-10-14']), dayOf, NOW), 0)
})

/* ---------- what a job billed ---------- */

const doc = (over = {}) => ({
  jobId: 'job-1', type: 'Invoice', status: 'Paid', date: '2026-10-14', laborRevenue: 300, partsRevenue: 200, partsCost: 120, partsCostKnown: true,
  labor: [{ tech: '', hours: 2, amount: 300, flat: false }], ...over,
})

test('the invoice wins over a receipt and an estimate, and drafts and voids are ignored', () => {
  const inv = doc()
  const est = doc({ type: 'Estimate', status: 'Approved', laborRevenue: 100 })
  const rec = doc({ type: 'Receipt', laborRevenue: 250 })
  assert.equal(jt.billedDocFor([est, inv])?.basis, 'invoice')
  assert.equal(jt.billedDocFor([est, rec])?.basis, 'receipt')
  assert.equal(jt.billedDocFor([est])?.basis, 'estimate')
  assert.equal(jt.billedDocFor([doc({ status: 'Draft' }), doc({ status: 'Void' })]), null)
  assert.equal(jt.billedDocFor([]), null)
  assert.equal(jt.billedDocFor([doc({ status: 'Void' }), est])?.basis, 'estimate')
})

test('two invoices on one job are added together', () => {
  const a = doc({ laborRevenue: 300, partsCost: 100, date: '2026-10-14' })
  const b = doc({ laborRevenue: 150, partsRevenue: 50, partsCost: 30, date: '2026-10-16', labor: [{ tech: '', hours: 1, amount: 150, flat: false }] })
  const hit = jt.billedDocFor([a, b])
  assert.equal(hit.doc.laborRevenue, 450)
  assert.equal(hit.doc.partsRevenue, 250)
  assert.equal(hit.doc.partsCost, 130)
  assert.equal(hit.doc.labor.length, 2)
  assert.equal(jt.soldHours(hit.doc.labor), 3)
  const unknown = jt.billedDocFor([a, doc({ partsCostKnown: false })])
  assert.equal(unknown.doc.partsCostKnown, false)
})

test('sold hours skip flat lines without hours and say how many there were', () => {
  const labor = [{ tech: '', hours: 1.5, amount: 150, flat: false }, { tech: '', hours: 0, amount: 80, flat: true }, { tech: '', hours: 2, amount: 200, flat: true }]
  assert.equal(jt.soldHours(labor), 3.5)
  assert.equal(jt.flatWithoutHours(labor), 1)
})

/* ---------- one job result ---------- */

const job = { id: 'job-1', label: 'RO 1042', tech: 'Marco Reyes', status: 'Complete', customer: 'Dana Fox' }

test('efficiency is hours sold over hours worked, and absent with no time', () => {
  assert.equal(jt.efficiencyOf(2, 120), 100)
  assert.equal(jt.efficiencyOf(3, 120), 150)
  assert.equal(jt.efficiencyOf(1, 120), 50)
  assert.equal(jt.efficiencyOf(2, 0), null)
  assert.equal(jt.efficiencyOf(0, 60), 0)
})

test('a job with time, an invoice and known costs shows gross profit', () => {
  const minutes = jt.minutesByJob([seg()], NOW).get('job-1')
  const r = jt.jobResult(job, jt.billedDocFor([doc()]), minutes, new Map([['marco reyes', 25]]))
  assert.equal(r.basis, 'invoice')
  assert.equal(r.soldHours, 2)
  assert.equal(r.workedMinutes, 120)
  assert.equal(r.efficiency, 100)
  assert.equal(r.laborCost, 50) // 2 hours at 25 an hour
  assert.equal(r.partsCost, 120)
  assert.equal(r.grossProfit, 300 + 200 - 120 - 50)
  assert.deepEqual(r.missing, [])
  assert.equal(r.shares.length, 1)
  assert.equal(r.shares[0].soldHours, 2)
})

test('gross profit is never guessed: no pay rate, no part costs or no time says what is missing', () => {
  const minutes = jt.minutesByJob([seg()], NOW).get('job-1')
  const noRate = jt.jobResult(job, jt.billedDocFor([doc()]), minutes, new Map())
  assert.equal(noRate.grossProfit, null)
  assert.equal(noRate.laborCost, null)
  assert.ok(noRate.missing.includes('a pay rate for each technician'))
  const noCost = jt.jobResult(job, jt.billedDocFor([doc({ partsCostKnown: false })]), minutes, new Map([['marco reyes', 25]]))
  assert.equal(noCost.grossProfit, null)
  assert.equal(noCost.partsCost, null)
  assert.ok(noCost.missing.includes('the cost of every part'))
  const noTime = jt.jobResult(job, jt.billedDocFor([doc()]), undefined, new Map([['marco reyes', 25]]))
  assert.equal(noTime.grossProfit, null)
  assert.equal(noTime.efficiency, null)
  assert.equal(noTime.tracked, false)
  assert.ok(noTime.missing.includes('time on the job'))
  const noDoc = jt.jobResult(job, null, minutes, new Map([['marco reyes', 25]]))
  assert.equal(noDoc.basis, 'none')
  assert.equal(noDoc.grossProfit, null)
  assert.equal(noDoc.missing[0], 'an invoice or estimate')
})

test('labor sold is credited to the technician named on the line, else split by time worked, else to the assigned tech', () => {
  const list = [
    seg({ id: 1 }), // Marco 120 min
    seg({ id: 2, staff_id: 8, staff_name: 'Dana Fox', started_at: '2026-10-14T14:00:00.000Z', ended_at: '2026-10-14T16:00:00.000Z' }), // 120 min
  ]
  const minutes = jt.minutesByJob(list, NOW).get('job-1')
  const split = doc({ labor: [{ tech: '', hours: 4, amount: 600, flat: false }], laborRevenue: 600 })
  const a = jt.jobResult(job, jt.billedDocFor([split]), minutes, new Map())
  assert.equal(a.shares.length, 2)
  assert.deepEqual(a.shares.map(s => s.soldHours), [2, 2])
  assert.deepEqual(a.shares.map(s => s.laborRevenue), [300, 300])
  const named = doc({ labor: [{ tech: 'Dana Fox', hours: 3, amount: 450, flat: false }, { tech: '', hours: 1, amount: 150, flat: false }], laborRevenue: 600 })
  const b = jt.jobResult(job, jt.billedDocFor([named]), minutes, new Map())
  const dana = b.shares.find(s => s.tech.toLowerCase() === 'dana fox')
  const marco = b.shares.find(s => s.tech.toLowerCase() === 'marco reyes')
  assert.equal(dana.soldHours, 3.5)
  assert.equal(marco.soldHours, 0.5)
  const untouched = jt.jobResult(job, jt.billedDocFor([split]), undefined, new Map())
  assert.equal(untouched.shares.length, 1)
  assert.equal(untouched.shares[0].tech, 'Marco Reyes')
  assert.equal(untouched.shares[0].soldHours, 4)
})

/* ---------- one technician over a period ---------- */

test('technician numbers use only jobs that have time for efficiency and effective rate', () => {
  const minutes = jt.minutesByJob([seg()], NOW).get('job-1')
  const tracked = jt.jobResult(job, jt.billedDocFor([doc()]), minutes, new Map([['marco reyes', 25]]))
  const untracked = jt.jobResult({ ...job, id: 'job-9', label: 'RO 1050' }, jt.billedDocFor([doc({ jobId: 'job-9', laborRevenue: 150, labor: [{ tech: '', hours: 1, amount: 150, flat: false }] })]), undefined, new Map())
  const t = jt.techPeriod('Marco Reyes', 8 * H, 4 * H, [tracked, untracked])
  assert.equal(t.jobsBilled, 2)
  assert.equal(t.soldHours, 3)
  assert.equal(t.trackedSoldHours, 2)
  assert.equal(t.trackedMinutes, 120)
  assert.equal(t.efficiency, 100)
  assert.equal(t.effectiveRate, 150) // 300 of labor over 2 hours
  assert.equal(t.untrackedJobs, 1)
  assert.equal(t.untrackedSoldHours, 1)
  assert.equal(t.utilization, 50)
  assert.equal(t.laborRevenue, 450)
})

test('utilization is capped at 100 and absent with no clocked time', () => {
  assert.equal(jt.techPeriod('Marco Reyes', 60, 90, []).utilization, 100)
  assert.equal(jt.techPeriod('Marco Reyes', 0, 0, []).utilization, null)
  assert.equal(jt.techPeriod('Marco Reyes', 60, 0, []).efficiency, null)
  assert.equal(jt.techPeriod('Marco Reyes', 60, 0, []).effectiveRate, null)
})

/* ---------- pay estimates ---------- */

test('pay rates are read safely', () => {
  assert.deepEqual(jt.normalizePay({ pay_method: 'flat', flat_rate: '32.5' }), { method: 'flat', hourly: null, flat: 32.5, commissionPct: null })
  assert.equal(jt.normalizePay({ pay_method: 'nonsense' }).method, 'hourly')
  assert.equal(jt.normalizePay({ hourly_rate: -5 }).hourly, null)
  assert.equal(jt.normalizePay({ hourly_rate: 5000 }).hourly, null)
  assert.equal(jt.normalizePay({ commission_pct: 150 }).commissionPct, null)
  assert.equal(jt.normalizePay({ hourly_rate: '' }).hourly, null)
  assert.equal(jt.normalizePay({ hourly_rate: 0 }).hourly, 0)
})

test('pay estimates follow the pay method and say when there is no rate', () => {
  const work = { regularMin: 40 * H, overtimeMin: 5 * H, doubleMin: 2 * H, soldHours: 50, laborRevenue: 6000 }
  const hourly = jt.estimatePay({ method: 'hourly', hourly: 20, flat: null, commissionPct: null }, work)
  assert.equal(hourly.amount, 800 + 150 + 80)
  const flat = jt.estimatePay({ method: 'flat', hourly: null, flat: 30, commissionPct: null }, work)
  assert.equal(flat.amount, 1500)
  const comm = jt.estimatePay({ method: 'commission', hourly: null, flat: null, commissionPct: 25 }, work)
  assert.equal(comm.amount, 1500)
  assert.equal(jt.estimatePay(undefined, work).amount, null)
  assert.equal(jt.estimatePay({ method: 'hourly', hourly: null, flat: null, commissionPct: null }, work).amount, null)
  assert.equal(jt.estimatePay({ method: 'flat', hourly: 20, flat: null, commissionPct: null }, work).amount, null)
})

/* ---------- review and approval ---------- */

const rulesFed = { weeklyOtMin: 2400, dailyOtMin: null, dailyDoubleMin: null }
const ENTRIES = [
  entry({ id: 1, clock_in: '2026-10-12T13:00:00.000Z', clock_out: '2026-10-12T22:00:00.000Z' }), // Mon 8am to 5pm
  entry({ id: 2, clock_in: '2026-10-13T13:00:00.000Z', clock_out: '2026-10-13T22:30:00.000Z', note: 'Edited: forgot to clock out' }),
  entry({ id: 3, clock_in: '2026-10-14T13:00:00.000Z', clock_out: '2026-10-14T22:00:00.000Z', note: 'Manual entry: tablet was dead' }),
  entry({ id: 4, staff_id: 8, staff_name: 'Dana Fox', clock_in: '2026-10-12T14:00:00.000Z', clock_out: '2026-10-12T20:00:00.000Z' }),
]

test('a person period holds their own punches and the day-by-day minutes', () => {
  const v = pr.personPeriod(person, ENTRIES, '2026-10-12', 7, rulesFed, NOW)
  assert.equal(v.entries.length, 3)
  assert.equal(v.perDay.length, 7)
  assert.equal(v.perDay[0], 9 * H)
  assert.equal(v.perDay[1], 9.5 * H)
  assert.equal(v.totalMinutes, 27.5 * H)
  assert.equal(v.split.overtime, 0)
  const empty = pr.personPeriod({ id: 99, name: 'Nobody', role: 'technician', active: true }, ENTRIES, '2026-10-12', 7, rulesFed, NOW)
  assert.equal(empty.totalMinutes, 0)
})

test('review flags separate what must be fixed from what to look at', () => {
  const v = pr.personPeriod(person, ENTRIES, '2026-10-12', 7, rulesFed, NOW)
  const flags = pr.reviewFlags(v, '2026-10-12', 7, '2026-10-14', NOW)
  assert.deepEqual(flags.map(f => f.kind).sort(), ['edited', 'manual'])
  assert.ok(flags.every(f => f.severity === 'check'))
})

test('an open punch from days ago has to be fixed before approval', () => {
  const open = entry({ id: 9, clock_in: '2026-10-12T13:00:00.000Z', clock_out: null })
  const v = pr.personPeriod(person, [open], '2026-10-12', 7, rulesFed, NOW)
  const flags = pr.reviewFlags(v, '2026-10-12', 7, '2026-10-14', NOW)
  const fix = flags.filter(f => f.severity === 'fix')
  assert.equal(fix.length, 1)
  assert.equal(fix[0].kind, 'open')
  // Running right now, inside the period: fine.
  const live = entry({ id: 10, clock_in: '2026-10-14T18:00:00.000Z', clock_out: null })
  const v2 = pr.personPeriod(person, [live], '2026-10-12', 7, rulesFed, NOW)
  assert.equal(pr.reviewFlags(v2, '2026-10-12', 7, '2026-10-14', NOW).filter(f => f.severity === 'fix').length, 0)
  // Still running after the period ended.
  const v3 = pr.personPeriod(person, [live], '2026-10-12', 7, rulesFed, NOW)
  assert.equal(pr.reviewFlags(v3, '2026-10-12', 7, '2026-10-20', NOW).filter(f => f.kind === 'running').length, 1)
})

test('long days and location problems are flagged for a look', () => {
  const long = entry({ id: 5, clock_in: '2026-10-12T11:00:00.000Z', clock_out: '2026-10-13T00:30:00.000Z', in_location: 'outside' })
  const unknown = entry({ id: 6, clock_in: '2026-10-13T13:00:00.000Z', clock_out: '2026-10-13T20:00:00.000Z', in_location: 'unknown' })
  const v = pr.personPeriod(person, [long, unknown], '2026-10-12', 7, rulesFed, NOW)
  const kinds = pr.reviewFlags(v, '2026-10-12', 7, '2026-10-14', NOW).map(f => f.kind).sort()
  assert.deepEqual(kinds, ['location', 'long_day', 'outside'])
})

test('approval is open, approved or changed since it was approved', () => {
  const a = pr.normalizeApproval({ staff_id: 7, period_start: '2026-10-12', period_days: 7, approved_at: '2026-10-19T14:00:00Z', approved_by: 'user-1', minutes_total: 1650 })
  assert.equal(pr.approvalState(undefined, 1650), 'open')
  assert.equal(pr.approvalState(a, 1650), 'approved')
  assert.equal(pr.approvalState(a, 1651), 'approved') // a minute of rounding is not a change
  assert.equal(pr.approvalState(a, 1700), 'changed')
  assert.equal(pr.normalizeApproval({ staff_id: '7', period_start: '2026-10-12T00:00:00Z', period_days: 9 }).period_days, 7)
  assert.equal(pr.normalizeApproval({ staff_id: '7', period_start: '2026-10-12T00:00:00Z' }).period_start, '2026-10-12')
  assert.equal(pr.approvalCovering([a], 7, '2026-10-18')?.staff_id, 7)
  assert.equal(pr.approvalCovering([a], 7, '2026-10-19'), undefined)
  assert.equal(pr.approvalCovering([a], 8, '2026-10-14'), undefined)
})

/* ---------- payroll files ---------- */

test('the payroll summary has one row per person with hours in the period', () => {
  const people = [person, { id: 8, name: 'Dana Fox', role: 'service_writer', active: true }, { id: 9, name: 'Idle Person', role: 'technician', active: true }]
  const approvals = [pr.normalizeApproval({ staff_id: 7, period_start: '2026-10-12', period_days: 7, minutes_total: 27.5 * H })]
  const text = pr.payrollSummaryCsv(people, ENTRIES, { start: '2026-10-12', days: 7 }, rulesFed, approvals, NOW)
  const rows = csv.parseCsv(text).rows
  assert.deepEqual(rows[0], ['Name', 'Role', 'Period start', 'Period end', 'Regular hours', 'Overtime hours', 'Double time hours', 'Total hours', 'Approved'])
  assert.equal(rows.length, 3) // header, Dana, Marco; the idle person is left out
  assert.equal(rows[1][0], 'Dana Fox')
  assert.equal(rows[1][7], '6.00')
  assert.equal(rows[1][8], 'No')
  assert.equal(rows[2][0], 'Marco Reyes')
  assert.equal(rows[2][2], '2026-10-12')
  assert.equal(rows[2][3], '2026-10-18')
  assert.equal(rows[2][7], '27.50')
  assert.equal(rows[2][8], 'Yes')
})

test('overtime shows up in the summary file', () => {
  const days = ['12', '13', '14', '15', '16'].map((d, i) => entry({ id: 20 + i, clock_in: `2026-10-${d}T12:00:00.000Z`, clock_out: `2026-10-${d}T21:00:00.000Z` }))
  const text = pr.payrollSummaryCsv([person], days, { start: '2026-10-12', days: 7 }, rulesFed, [], NOW)
  const row = csv.parseCsv(text).rows[1]
  assert.equal(row[4], '40.00')
  assert.equal(row[5], '5.00')
  assert.equal(row[7], '45.00')
})

test('the payroll detail file lists every punch with its reason and approval', () => {
  const approvals = [pr.normalizeApproval({ staff_id: 7, period_start: '2026-10-12', period_days: 7, minutes_total: 27.5 * H })]
  const text = pr.payrollDetailCsv([person], ENTRIES, { start: '2026-10-12', days: 7 }, approvals, NOW)
  const rows = csv.parseCsv(text).rows
  assert.equal(rows.length, 4)
  assert.equal(rows[2][7], 'forgot to clock out')
  assert.equal(rows[3][7], 'tablet was dead')
  assert.equal(rows[1][8], 'Yes')
  assert.ok(text.endsWith('\r\n'))
})

test('a note that looks like a formula is written as text', () => {
  const nasty = entry({ id: 30, note: 'Edited: =HYPERLINK("http://x")' })
  const text = pr.payrollDetailCsv([person], [nasty], { start: '2026-10-12', days: 7 }, [], NOW)
  assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`))
})

test('payroll file names carry the period', () => {
  assert.equal(pr.payrollFileName('summary', { start: '2026-10-12', days: 7 }), 'payroll-summary-2026-10-12-to-2026-10-18.csv')
  assert.equal(pr.payrollFileName('detail', { start: '2026-10-12', days: 14 }), 'payroll-detail-2026-10-12-to-2026-10-25.csv')
})

test('the older timesheet export and its tests are untouched', () => {
  const text = tc.timesheetCsv([person], ENTRIES, NOW)
  assert.ok(text.startsWith('Name,Role,Date,Clock in,Clock out,Break minutes,Hours,Note\r\n'))
})

/* ---------- productivity from saved documents ---------- */

import * as prod from '../src/lib/productivity.ts'

const invoiceRow = (over = {}) => ({
  id: 'doc-1', job_id: 'job-1', type: 'Invoice', status: 'Paid', doc_date: '2026-10-14', created_at: '2026-10-14T15:00:00Z', tax_rate: 8.25, apply_tax: true,
  labors: [{ operation: 'Brake job', tech: 'Marco Reyes', hours: 2, rate: 150 }, { operation: 'Inspection', tech: '', amount: 40, hours: 0.5 }],
  parts: [{ name: 'Pads', qty: 1, unitPrice: 120, cost: 60 }, { name: 'Rotors', qty: 2, unitPrice: 90, cost: 40 }],
  ...over,
})

test('a saved invoice becomes labor lines, money and parts cost using the shop maths', () => {
  const b = prod.billedFromRow(invoiceRow())
  assert.equal(b.jobId, 'job-1')
  assert.equal(b.date, '2026-10-14')
  assert.equal(b.laborRevenue, 340)
  assert.equal(b.partsRevenue, 300)
  assert.equal(b.partsCost, 140)
  assert.equal(b.partsCostKnown, true)
  assert.deepEqual(b.labor, [
    { tech: 'Marco Reyes', hours: 2, amount: 300, flat: false },
    { tech: '', hours: 0.5, amount: 40, flat: true },
  ])
  assert.equal(prod.billedFromRow({ ...invoiceRow(), job_id: null }), null)
})

test('a part with no cost written down makes the parts cost unknown, not zero', () => {
  const b = prod.billedFromRow(invoiceRow({ parts: [{ name: 'Pads', qty: 1, unitPrice: 120, cost: 60 }, { name: 'Fluid', qty: 1, unitPrice: 20 }] }))
  assert.equal(b.partsCostKnown, false)
  assert.equal(b.partsCost, 60)
  assert.equal(prod.billedFromRow(invoiceRow({ parts: [] })).partsCostKnown, true)
})

test('a pay period lists the jobs billed in it, with and without clocked time', () => {
  const docs = [
    prod.billedFromRow(invoiceRow()),
    prod.billedFromRow(invoiceRow({ id: 'doc-2', job_id: 'job-2', doc_date: '2026-10-15', labors: [{ tech: 'Dana Fox', hours: 1, rate: 150 }], parts: [] })),
    prod.billedFromRow(invoiceRow({ id: 'doc-3', job_id: 'job-3', doc_date: '2026-09-01' })), // billed before the period
    prod.billedFromRow(invoiceRow({ id: 'doc-4', job_id: 'job-4', type: 'Estimate', status: 'Sent' })), // only an estimate
  ]
  const jobs = ['job-1', 'job-2', 'job-3', 'job-4'].map((id, i) => ({ id, ro: `RO-100${i}`, status: 'Complete', tech: 'Marco Reyes', customer: 'Dana Fox', car: '2017 Toyota Camry' }))
  const out = prod.productivityFor({
    jobs, docs, segments: [seg()], costRates: new Map([['marco reyes', 25]]), names: new Map([['marco reyes', 'Marco Reyes']]),
    from: '2026-10-12', to: '2026-10-18', nowMs: NOW,
  })
  assert.deepEqual(out.jobs.map(j => j.jobId), ['job-1', 'job-2'])
  assert.equal(out.untracked, 1)
  assert.equal(out.totals.soldHours, 3.5)
  assert.equal(out.totals.trackedSoldHours, 2.5)
  assert.equal(out.totals.trackedMinutes, 120)
  assert.equal(out.totals.efficiency, 125)
  assert.equal(out.totals.laborRevenue, 490)
  assert.equal(out.totals.effectiveRate, 170) // 340 of labor on the job somebody clocked, over its 2 hours
  assert.equal(out.totals.grossProfit, 450) // 340 labor + 300 parts - 140 parts cost - 50 labor cost
  assert.equal(out.totals.profitJobs, 1)
  const rows = prod.techRows([{ id: 7, name: 'Marco Reyes' }, { id: 8, name: 'Dana Fox' }, { id: 9, name: 'Idle Person' }], new Map([[7, 480], [8, 240]]), new Map([[7, 120]]), out.jobs)
  assert.deepEqual(rows.map(r => r.tech), ['Marco Reyes', 'Dana Fox'])
  assert.equal(rows[0].utilization, 25)
  assert.equal(rows[0].efficiency, 125)
  assert.equal(rows[1].jobsBilled, 1) // sold 1 hour on job 2, which nobody clocked
  assert.equal(rows[1].efficiency, null)
  assert.equal(rows[1].untrackedJobs, 1)
})
