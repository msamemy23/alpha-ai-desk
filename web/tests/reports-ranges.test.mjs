import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRange, scheduledPeriod, yearBefore, rangeFromParams, rangeToParams, isDayKey, periodPhrase, DEFAULT_RANGE, RANGE_OPTIONS, isRangeKey } from '../src/lib/report-ranges.ts'
import { spanDays } from '../src/lib/reports.ts'

const TODAY = '2026-10-14' // a Wednesday
const prev = { mode: 'previous' }

test('presets cover the days people ask for, with weeks running Monday to Sunday', () => {
  const at = (key, cmp = prev, earliest) => resolveRange({ key }, cmp, TODAY, earliest)
  assert.deepEqual(at('today').range, { from: '2026-10-14', to: '2026-10-14' })
  assert.deepEqual(at('yesterday').range, { from: '2026-10-13', to: '2026-10-13' })
  assert.deepEqual(at('week').range, { from: '2026-10-12', to: '2026-10-14' })
  assert.deepEqual(at('week').previous, { from: '2026-10-05', to: '2026-10-07' }, 'compared with the same days last week')
  assert.deepEqual(at('lastweek').range, { from: '2026-10-05', to: '2026-10-11' })
  assert.deepEqual(at('lastweek').previous, { from: '2026-09-28', to: '2026-10-04' })
  assert.deepEqual(at('quarter').range, { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual(at('quarter').previous, { from: '2026-07-01', to: '2026-07-14' })
  assert.deepEqual(at('lastquarter').range, { from: '2026-07-01', to: '2026-09-30' })
  assert.deepEqual(at('lastquarter').previous, { from: '2026-04-01', to: '2026-06-30' })
  assert.deepEqual(at('lastyear').range, { from: '2025-01-01', to: '2025-12-31' })
  assert.deepEqual(at('lastyear').previous, { from: '2024-01-01', to: '2024-12-31' })
  assert.deepEqual(at('month').range, { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual(at('7d').previous, { from: '2026-10-01', to: '2026-10-07' })
})

test('all time starts at the oldest record and has nothing to compare with', () => {
  const r = resolveRange({ key: 'all' }, prev, TODAY, '2025-03-02')
  assert.deepEqual(r.range, { from: '2025-03-02', to: TODAY })
  assert.equal(r.previous, null)
  // with no records at all, a year back
  assert.equal(spanDays(resolveRange({ key: 'all' }, prev, TODAY).range), 365)
})

test('the day before the first of the year is handled in quarters and weeks', () => {
  const r = resolveRange({ key: 'lastquarter' }, prev, '2026-01-10')
  assert.deepEqual(r.range, { from: '2025-10-01', to: '2025-12-31' })
  assert.deepEqual(resolveRange({ key: 'week' }, prev, '2026-01-01').range, { from: '2025-12-29', to: '2026-01-01' })
})

test('a custom range is compared with the same number of days before it', () => {
  const r = resolveRange({ key: 'custom', from: '2026-09-01', to: '2026-09-10' }, prev, TODAY)
  assert.deepEqual(r.range, { from: '2026-09-01', to: '2026-09-10' })
  assert.deepEqual(r.previous, { from: '2026-08-22', to: '2026-08-31' })
  assert.equal(r.vs, 'the 10 days before')
  assert.equal(r.problem, '')
  assert.equal(r.title, 'Sep 1 to Sep 10, 2026')
})

test('a bad custom range falls back to 30 days and says why', () => {
  const missing = resolveRange({ key: 'custom', from: '2026-09-01' }, prev, TODAY)
  assert.deepEqual(missing.range, { from: '2026-09-15', to: '2026-10-14' })
  assert.match(missing.problem, /both a first and a last day/)
  const backwards = resolveRange({ key: 'custom', from: '2026-09-10', to: '2026-09-01' }, prev, TODAY)
  assert.match(backwards.problem, /after the last day/)
  const notReal = resolveRange({ key: 'custom', from: '2026-02-30', to: '2026-03-05' }, prev, TODAY)
  assert.match(notReal.problem, /both a first and a last day/)
  const huge = resolveRange({ key: 'custom', from: '1995-01-01', to: '2026-01-01' }, prev, TODAY)
  assert.match(huge.problem, /ten years/)
})

test('comparison choices: same dates last year, two dates picked by hand, none', () => {
  const ly = resolveRange({ key: 'month' }, { mode: 'lastyear' }, TODAY)
  assert.deepEqual(ly.previous, { from: '2025-10-01', to: '2025-10-14' })
  assert.equal(ly.vs, 'the same dates last year')
  const hand = resolveRange({ key: 'month' }, { mode: 'custom', from: '2026-08-01', to: '2026-08-14' }, TODAY)
  assert.deepEqual(hand.previous, { from: '2026-08-01', to: '2026-08-14' })
  assert.equal(hand.problem, '')
  const none = resolveRange({ key: 'month' }, { mode: 'none' }, TODAY)
  assert.equal(none.previous, null); assert.equal(none.vs, '')
  const overlap = resolveRange({ key: 'month' }, { mode: 'custom', from: '2026-10-05', to: '2026-10-08' }, TODAY)
  assert.match(overlap.problem, /overlap/)
  const half = resolveRange({ key: 'month' }, { mode: 'custom', from: '2026-08-01' }, TODAY)
  assert.match(half.problem, /Pick both days for the comparison/)
  assert.deepEqual(half.previous, { from: '2026-09-01', to: '2026-09-14' }, 'the usual comparison stays')
})

test('a leap day maps to the last day of February a year earlier', () => {
  assert.equal(yearBefore('2028-02-29'), '2027-02-28')
  assert.equal(yearBefore('2026-10-14'), '2025-10-14')
})

test('days must be real calendar days', () => {
  assert.equal(isDayKey('2026-02-28'), true)
  assert.equal(isDayKey('2026-02-30'), false)
  assert.equal(isDayKey('2026-2-3'), false)
  assert.equal(isDayKey('1980-01-01'), false)
  assert.equal(isDayKey(20261014), false)
  assert.equal(isDayKey(null), false)
})

test('the address bar round-trips and ignores nonsense', () => {
  assert.deepEqual(rangeFromParams(new URLSearchParams('')), DEFAULT_RANGE)
  assert.deepEqual(rangeFromParams(new URLSearchParams('period=banana&compare=never')), DEFAULT_RANGE)
  const state = { spec: { key: 'custom', from: '2026-09-01', to: '2026-09-10' }, cmp: { mode: 'custom', from: '2026-08-01', to: '2026-08-10' } }
  const params = rangeToParams(state)
  assert.deepEqual(rangeFromParams(new URLSearchParams(params)), state)
  assert.deepEqual(rangeToParams(DEFAULT_RANGE), { period: '30d' })
  assert.deepEqual(rangeFromParams(new URLSearchParams('period=custom&from=nope&to=2026-09-10')).spec, { key: 'custom', to: '2026-09-10' })
  assert.deepEqual(rangeFromParams(new URLSearchParams('period=month&from=2026-09-01')).spec, { key: 'month' }, 'dates only matter for a custom range')
  for (const o of RANGE_OPTIONS) assert.equal(isRangeKey(o.key), true)
})

test('a scheduled report covers the week or month that just ended, and always has the same key for it', () => {
  const w = scheduledPeriod('weekly', '2026-10-14')
  assert.equal(w.key, 'week-2026-10-05')
  assert.deepEqual(w.range, { from: '2026-10-05', to: '2026-10-11' })
  assert.deepEqual(w.previous, { from: '2026-09-28', to: '2026-10-04' })
  assert.equal(w.title, 'Week of October 5')
  // any day that week lands on the same period, so a retry on Thursday never makes a second report
  assert.equal(scheduledPeriod('weekly', '2026-10-12').key, w.key)
  assert.equal(scheduledPeriod('weekly', '2026-10-18').key, w.key)
  assert.notEqual(scheduledPeriod('weekly', '2026-10-19').key, w.key)
  const m = scheduledPeriod('monthly', '2026-10-01')
  assert.equal(m.key, 'month-2026-09'); assert.equal(m.title, 'September 2026')
  assert.equal(scheduledPeriod('monthly', '2026-10-31').key, 'month-2026-09')
  assert.equal(scheduledPeriod('monthly', '2026-01-02').key, 'month-2025-12')
})

test('periods read naturally in a sentence', () => {
  assert.equal(periodPhrase({ key: 'week' }, { from: '2026-10-12', to: '2026-10-14' }), 'this week')
  assert.equal(periodPhrase({ key: '30d' }, { from: '2026-09-15', to: '2026-10-14' }), 'in the last 30 days')
  assert.equal(periodPhrase({ key: 'custom' }, { from: '2026-09-01', to: '2026-09-10' }), 'from Sep 1 to Sep 10, 2026')
})
