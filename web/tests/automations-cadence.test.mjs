import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DAILY_CHECK_MINUTES, cannotKeepCadence, checkEveryOf, checkedWords, scheduleWords, schedulerWords,
} from '../src/components/automations/model.ts'
import * as catalog from '../src/lib/automation-catalog.ts'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const vercel = JSON.parse(read('../vercel.json'))

test('the repo schedules one daily job, so that is how often Alpha checks until it has measured otherwise', () => {
  assert.equal(vercel.crons.length, 1)
  assert.equal(vercel.crons[0].schedule, '0 0 * * *')
  assert.equal(DAILY_CHECK_MINUTES, 1440)
  assert.equal(checkEveryOf(null), 1440)
  assert.equal(checkEveryOf(undefined), 1440)
  assert.equal(checkEveryOf({ every_minutes: null }), 1440)
  assert.equal(checkEveryOf({ every_minutes: 5 }), 5)
})

test('a schedule closer together than Alpha checks reads "Checked once a day", not "Every 15 minutes"', () => {
  assert.equal(scheduleWords('every 15 minutes', 1440), 'Checked once a day')
  assert.equal(scheduleWords('every 1 hour', 1440), 'Checked once a day')
  assert.equal(scheduleWords('every 2 hours', 1440), 'Checked once a day')
  assert.equal(scheduleWords('every 15 minutes', 180), 'Checked about every 3 hours')
  assert.equal(scheduleWords('every 15 minutes', 60), 'Checked about every 60 minutes')
  for (const text of ['every 15 minutes', 'every 1 hour', 'every 2 hours']) assert.doesNotMatch(scheduleWords(text, 1440), /^Every/, text)
})

test('wording stays as it was when Alpha really can keep the schedule, or when nothing is said about how often it checks', () => {
  assert.equal(scheduleWords('every 15 minutes', 5), 'Every 15 minutes')
  assert.equal(scheduleWords('every 1 hour', 15), 'Every hour')
  assert.equal(scheduleWords('every 24 hours', 1440), 'Every 24 hours')
  assert.equal(scheduleWords('every 15 minutes'), 'Every 15 minutes')
  assert.equal(scheduleWords('Daily at 9am', 1440), 'Every day at 9:00 AM')
  assert.equal(scheduleWords('Weekly on Monday at 10am', 1440), 'Every Monday at 10:00 AM')
  assert.equal(scheduleWords('whenever', 1440), 'whenever')
})

test('cannotKeepCadence is true only for "every ..." schedules shorter than the gap between checks', () => {
  assert.equal(cannotKeepCadence('every 15 minutes', 1440), true)
  assert.equal(cannotKeepCadence('every 15 minutes', 5), false)
  assert.equal(cannotKeepCadence('every 2 hours', 60), false)
  assert.equal(cannotKeepCadence('every 2 hours', 180), true)
  assert.equal(cannotKeepCadence('Daily at 9am', 1440), false)
  assert.equal(cannotKeepCadence('Weekly on Friday at 10am', 1440), false)
  assert.equal(cannotKeepCadence('nonsense', 1440), false)
})

test('checkedWords and the scheduler line say it the same way', () => {
  assert.equal(checkedWords(1440), 'once a day')
  assert.equal(checkedWords(360), 'about every 6 hours')
  assert.equal(checkedWords(5), 'about every 5 minutes')
  const now = Date.parse('2026-10-15T16:00:00Z')
  const last = new Date(now - 600 * 60_000).toISOString()
  assert.match(schedulerWords({ last_tick_at: last, every_minutes: 1440, status: 'ok' }, now).text, /Alpha checks once a day, so/)
  assert.match(schedulerWords({ last_tick_at: last, every_minutes: 360, status: 'ok' }, now).text, /Alpha checks about every 6 hours, so/)
  assert.match(schedulerWords({ last_tick_at: last, every_minutes: 5, status: 'ok' }, now).text, /Alpha checks about every 5 minutes\./)
})

test('the built-in "every 15 minutes" and "every hour" automations read truthfully on a once-a-day scheduler', () => {
  const fast = catalog.CATALOG.filter(d => d.kind === 'engine' && cannotKeepCadence(d.schedule, 1440))
  assert.deepEqual(fast.map(d => d.id).sort(), ['appointment_reminders', 'car_ready'])
  for (const d of fast) assert.equal(scheduleWords(d.schedule, checkEveryOf(null)), 'Checked once a day', d.id)
})

test('no wording promises the moment, or suggests a cadence a daily scheduler cannot keep', () => {
  assert.doesNotMatch(catalog.CATALOG_BY_ID.car_ready.blurb, /the moment|immediately|instantly/i)
  const problem = catalog.configProblems(catalog.CATALOG_BY_ID.estimate_followups, { schedule: 'sometimes' }).join(' ')
  assert.match(problem, /Daily at 9am/)
  assert.doesNotMatch(problem, /every 2 hours/i)
  // the typed-schedule hint in the settings sheet
  assert.doesNotMatch(read('../src/components/automations/EditSheet.tsx'), /every 2 hours/i)
})

test('every screen that shows a schedule is told how often Alpha really checks', () => {
  const page = read('../src/app/(app)/automations/page.tsx')
  assert.match(page, /const checkEvery = checkEveryOf\(overview\?\.scheduler\)/)
  for (const tag of ['AutomationCard', 'UpcomingPanel', 'EditSheet']) assert.match(page, new RegExp(`<${tag}[\\s\\S]*?checkEvery=\\{checkEvery\\}`), tag)
  assert.match(page, /<PreviewSheet[\s\S]*?checkEvery=\{checkEvery\}/)
  for (const file of ['AutomationCard', 'PreviewSheet', 'EditSheet']) assert.match(read(`../src/components/automations/${file}.tsx`), /scheduleWords\(.*checkEvery\)/, file)
  // a time promised for a schedule that cannot be kept is left out
  assert.match(read('../src/components/automations/AutomationCard.tsx'), /const keeps = !cannotKeepCadence\(card\.schedule, checkEvery\)/)
  assert.match(read('../src/components/automations/UpcomingPanel.tsx'), /cannotKeepCadence\(c\.schedule, checkEvery\)/)
})
