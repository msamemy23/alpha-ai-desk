import test from 'node:test'
import assert from 'node:assert/strict'
import * as s from '../src/lib/schedules.ts'

const CT = 'America/Chicago'
const z = v => new Date(v)

test('previous scheduled run is the latest stated time at or before now, in the shop clock', () => {
  assert.equal(s.previousScheduledRun('Daily at 6pm', CT, z('2026-10-14T20:00:00Z')).toISOString(), '2026-10-13T23:00:00.000Z')
  assert.equal(s.previousScheduledRun('Daily at 6pm', CT, z('2026-10-14T23:30:00Z')).toISOString(), '2026-10-14T23:00:00.000Z')
  assert.equal(s.previousScheduledRun('Daily at 6pm', CT, z('2026-10-14T23:00:00Z')).toISOString(), '2026-10-14T23:00:00.000Z')
  // Wednesday 2026-10-14. Weekly Monday 10am CDT is 15:00Z on the 12th.
  assert.equal(s.previousScheduledRun('Weekly on Monday at 10am', CT, z('2026-10-14T20:00:00Z')).toISOString(), '2026-10-12T15:00:00.000Z')
  assert.equal(s.previousScheduledRun('Weekly on Wednesday at 10am', CT, z('2026-10-14T14:00:00Z')).toISOString(), '2026-10-07T15:00:00.000Z')
  assert.equal(s.previousScheduledRun('Weekly on Wednesday at 10am', CT, z('2026-10-14T16:00:00Z')).toISOString(), '2026-10-14T15:00:00.000Z')
  assert.equal(s.previousScheduledRun('every 2 hours', CT, z('2026-10-14T16:00:00Z')), null)
  assert.equal(s.previousScheduledRun('whenever', CT, z('2026-10-14T16:00:00Z')), null)
})

test('daylight saving: 9am stays 9am local when the clocks go back and forward', () => {
  // Fall back, Sunday 2026-11-01: 9am CST is 15:00Z, the day before 9am CDT was 14:00Z.
  assert.equal(s.previousScheduledRun('Daily at 9am', CT, z('2026-11-01T15:30:00Z')).toISOString(), '2026-11-01T15:00:00.000Z')
  assert.equal(s.previousScheduledRun('Daily at 9am', CT, z('2026-11-01T14:30:00Z')).toISOString(), '2026-10-31T14:00:00.000Z')
  // Spring forward, Sunday 2026-03-08: 9am CDT is 14:00Z, the day before 9am CST was 15:00Z.
  assert.equal(s.previousScheduledRun('Daily at 9am', CT, z('2026-03-08T14:30:00Z')).toISOString(), '2026-03-08T14:00:00.000Z')
  assert.equal(s.previousScheduledRun('Daily at 9am', CT, z('2026-03-08T13:30:00Z')).toISOString(), '2026-03-07T15:00:00.000Z')
  // Another zone entirely: Los Angeles shop, 6pm PDT is 01:00Z next day.
  assert.equal(s.previousScheduledRun('Daily at 6pm', 'America/Los_Angeles', z('2026-10-15T02:00:00Z')).toISOString(), '2026-10-15T01:00:00.000Z')
})

test('due when the stated time has passed since the last run or since it was switched on', () => {
  const base = { schedule: 'Daily at 6pm', timeZone: CT }
  // 6:07pm, never run, switched on a week ago: due.
  assert.equal(s.isScheduleDueSince({ ...base, enabledAt: '2026-10-07T12:00:00Z', now: z('2026-10-14T23:07:00Z') }), true)
  // Already ran at 6:07pm: the 6:22pm check does nothing.
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-14T23:07:00Z', now: z('2026-10-14T23:22:00Z') }), false)
  // Next day at 6:00pm it is due again.
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-14T23:07:00Z', now: z('2026-10-15T23:00:00Z') }), true)
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-14T23:07:00Z', now: z('2026-10-15T22:59:00Z') }), false)
  // A missed run still happens, late, at the next check.
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-13T23:05:00Z', now: z('2026-10-15T03:00:00Z') }), true)
})

test('switching an automation on at 3pm does not fire this morning\'s 9am run', () => {
  const base = { schedule: 'Daily at 9am', timeZone: CT, enabledAt: '2026-10-14T20:00:00Z' } // 3pm
  assert.equal(s.isScheduleDueSince({ ...base, now: z('2026-10-14T20:05:00Z') }), false)
  assert.equal(s.isScheduleDueSince({ ...base, now: z('2026-10-15T13:59:00Z') }), false) // 8:59am
  assert.equal(s.isScheduleDueSince({ ...base, now: z('2026-10-15T14:05:00Z') }), true) // 9:05am
})

test('with no history at all it is due once, so older settings are not stuck', () => {
  assert.equal(s.isScheduleDueSince({ schedule: 'Daily at 9am', timeZone: CT, now: z('2026-10-14T20:00:00Z') }), true)
  assert.equal(s.isScheduleDueSince({ schedule: 'every 15 minutes', timeZone: CT, now: z('2026-10-14T20:00:00Z') }), true)
  assert.equal(s.isScheduleDueSince({ schedule: 'not a schedule', lastRun: '2026-10-01T00:00:00Z', timeZone: CT, now: z('2026-10-14T20:00:00Z') }), false)
})

test('every N minutes schedules wait that long since the last run', () => {
  const base = { schedule: 'every 15 minutes', timeZone: CT }
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-14T19:44:00Z', now: z('2026-10-14T20:00:00Z') }), true)
  assert.equal(s.isScheduleDueSince({ ...base, lastRun: '2026-10-14T19:50:00Z', now: z('2026-10-14T20:00:00Z') }), false)
  assert.equal(s.intervalMs('every 30 minutes'), 1_800_000)
  assert.equal(s.intervalMs('every 2 hours'), 7_200_000)
  assert.equal(s.intervalMs('Daily at 9am'), null)
})

test('occurrence key is the same all through one scheduled run and changes for the next', () => {
  const a = s.occurrenceKey('Daily at 6pm', CT, z('2026-10-14T23:01:00Z'))
  const b = s.occurrenceKey('Daily at 6pm', CT, z('2026-10-15T01:30:00Z'))
  const c = s.occurrenceKey('Daily at 6pm', CT, z('2026-10-15T23:01:00Z'))
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(s.occurrenceKey('every 15 minutes', CT, z('2026-10-14T23:01:00Z')), s.occurrenceKey('every 15 minutes', CT, z('2026-10-14T23:16:00Z')))
})

test('schedule text is checked before it is saved', () => {
  for (const ok of ['Daily at 9am', 'daily 6pm', 'Weekly on Monday at 10am', 'mon 9:30am', 'every 15 minutes', 'every 2 hours', '17:30']) assert.equal(s.isValidSchedule(ok), true, ok)
  for (const bad of ['', 'sometimes', 'Daily at 25pm', 'every 0 minutes']) assert.equal(s.isValidSchedule(bad), false, bad)
})

test('older helpers keep their behaviour', () => {
  assert.equal(s.isScheduleDue('Daily at 9am', null, CT, z('2026-10-14T20:00:00Z')), true)
  assert.equal(s.nextScheduledRun('Daily at 9am', CT, z('2026-10-14T20:00:00Z')).toISOString(), '2026-10-15T14:00:00.000Z')
  assert.equal(s.scheduleWindowKey('Daily at 9am', CT, z('2026-10-14T20:00:00Z')), '2026-10-14')
})
