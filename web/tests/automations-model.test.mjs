import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agoWords, buildSchedule, cardStatus, dayLabel, groupCards, hourLabel, messageStatus, needsFrequentChecks, outcomeParts,
  parseSchedule, quietWords, scheduleWords, schedulerWords, whenWords,
} from '../src/components/automations/model.ts'
import { isValidSchedule } from '../src/lib/schedules.ts'

const card = (over = {}, state = {}) => ({
  id: 'car_ready', name: 'Car is ready', category: 'reminders', kind: 'engine', setup: null, next_run: null,
  state: { enabled: true, enabled_at: null, last_run: '2026-10-15T15:00:00Z', run_count: 3, last_result: 'Sent 2.', last_status: 'ok', ...state }, ...over,
})
const NOW = Date.parse('2026-10-15T16:00:00Z') // 11:00 in Houston

test('hours read the way a person says them', () => {
  assert.equal(hourLabel(0), '12 AM')
  assert.equal(hourLabel(8), '8 AM')
  assert.equal(hourLabel(12), 'noon')
  assert.equal(hourLabel(21), '9 PM')
  assert.equal(quietWords({ quiet_start_hour: 21, quiet_end_hour: 8, skip_sundays: false }), 'No texts from 9 PM until 8 AM, by each customer’s own clock')
  assert.match(quietWords({ quiet_start_hour: 20, quiet_end_hour: 9, skip_sundays: true }), /8 PM until 9 AM.*none on Sundays/)
})

test('schedule text round-trips through the form pieces and the server accepts every result', () => {
  const samples = ['Daily at 9am', 'Daily at 6pm', 'Weekly on Monday at 10am', 'Weekly on Friday at 10:30am', 'every 15 minutes', 'every 2 hours', 'every 1 hour']
  for (const text of samples) {
    const p = parseSchedule(text)
    assert.ok(p, text)
    const built = buildSchedule(p)
    assert.ok(isValidSchedule(built), `${text} -> ${built}`)
    assert.deepEqual(parseSchedule(built), p, `${text} -> ${built}`)
  }
  assert.equal(buildSchedule({ kind: 'daily', amount: 1, unit: 'hours', hour: 12, minute: 0, weekday: 1 }), 'Daily at 12pm')
  assert.equal(buildSchedule({ kind: 'daily', amount: 1, unit: 'hours', hour: 0, minute: 5, weekday: 1 }), 'Daily at 12:05am')
  assert.equal(buildSchedule({ kind: 'every', amount: 1, unit: 'minutes', hour: 9, minute: 0, weekday: 1 }), 'every 1 minute')
  assert.equal(parseSchedule('whenever'), null)
})

test('schedules are described in plain words', () => {
  assert.equal(scheduleWords('Daily at 9am'), 'Every day at 9:00 AM')
  assert.equal(scheduleWords('Weekly on Monday at 10am'), 'Every Monday at 10:00 AM')
  assert.equal(scheduleWords('every 15 minutes'), 'Every 15 minutes')
  assert.equal(scheduleWords('every 1 hour'), 'Every hour')
  assert.equal(needsFrequentChecks('every 15 minutes'), true)
  assert.equal(needsFrequentChecks('Daily at 9am'), false)
})

test('times are told in the shop clock, relative to now', () => {
  const tz = 'America/Chicago'
  assert.equal(whenWords('2026-10-15T20:30:00Z', tz, NOW), 'today at 3:30 PM')
  assert.equal(whenWords('2026-10-16T14:00:00Z', tz, NOW), 'tomorrow at 9:00 AM')
  assert.match(whenWords('2026-10-20T14:00:00Z', tz, NOW), /Tue, Oct 20 at 9:00 AM/)
  // 11 PM Houston on the 15th is already the 16th in UTC: it is still "today" for the shop.
  assert.equal(whenWords('2026-10-16T04:00:00Z', tz, NOW), 'today at 11:00 PM')
  assert.equal(whenWords(null, tz, NOW), 'not scheduled')
  assert.equal(dayLabel('2026-10-15', tz, NOW), 'Today')
  assert.equal(dayLabel('2026-10-16', tz, NOW), 'Tomorrow')
  assert.match(dayLabel('2026-10-19', tz, NOW), /Monday, Oct 19/)
})

test('ago words', () => {
  assert.equal(agoWords(null, NOW), 'never')
  assert.equal(agoWords('2026-10-15T15:59:40Z', NOW), 'just now')
  assert.equal(agoWords('2026-10-15T15:55:00Z', NOW), '5 min ago')
  assert.equal(agoWords('2026-10-15T13:00:00Z', NOW), '3 hr ago')
  assert.equal(agoWords('2026-10-14T13:00:00Z', NOW), 'yesterday')
  assert.equal(agoWords('2026-10-16T13:00:00Z', NOW), 'soon')
})

test('a card gets one honest status, and the master switch beats everything', () => {
  const on = { master_enabled: true }
  assert.deepEqual([cardStatus(card(), on, NOW).lamp, cardStatus(card(), on, NOW).word], ['green', 'On'])
  assert.deepEqual([cardStatus(card({}, { enabled: false }), on, NOW).lamp, cardStatus(card({}, { enabled: false }), on, NOW).word], ['off', 'Paused'])
  assert.equal(cardStatus(card({ setup: 'Add your Google review link in Settings first.' }), on, NOW).lamp, 'amber')
  assert.equal(cardStatus(card({}, { last_status: 'error', last_result: 'Could not send 2.' }), on, NOW).lamp, 'red')
  assert.equal(cardStatus(card({}, { last_status: 'never', last_run: null }), on, NOW).lamp, 'blue')
  const off = cardStatus(card(), { master_enabled: false }, NOW)
  assert.deepEqual([off.lamp, off.word], ['off', 'Switched off'])
  // A paused card that cannot run is just paused. The problem is shown as a hint, not a warning.
  assert.equal(cardStatus(card({ setup: 'Write the message first.' }, { enabled: false }), on, NOW).word, 'Paused')
})

test('cards group by category in a fixed order and nothing is dropped', () => {
  const g = groupCards([card({ id: 'a', category: 'marketing' }), card({ id: 'b', category: 'reminders' }), card({ id: 'c', category: 'mystery' }), card({ id: 'd', category: 'leads' })])
  assert.deepEqual(g.map(x => x.id), ['reminders', 'marketing', 'leads', 'other'])
  assert.equal(g.reduce((n, x) => n + x.cards.length, 0), 4)
})

test('message status says what the phone company reported', () => {
  assert.equal(messageStatus({ status: 'sent', delivery: 'delivered', held: false }).word, 'Delivered')
  assert.equal(messageStatus({ status: 'sent', delivery: 'undelivered', held: false }).lamp, 'red')
  assert.equal(messageStatus({ status: 'sent', delivery: null, held: false }).word, 'Sent')
  assert.equal(messageStatus({ status: 'queued', delivery: null, held: true }).word, 'Held until morning')
  assert.equal(messageStatus({ status: 'skipped', delivery: null, held: false }).word, 'Left out')
  assert.equal(messageStatus({ status: 'unknown', delivery: null, held: false }).lamp, 'amber')
})

test('results are listed in plain numbers, and money only where an automation can claim it', () => {
  const o = { sent: 22, delivered: 20, replied: 7, booked: 5, revenue: 1284.5 }
  assert.deepEqual(outcomeParts(o, { delivery: true, revenue: true }), ['22 sent', '20 delivered', '7 replied', '5 booked', '$1,284.50 paid'])
  assert.deepEqual(outcomeParts(o, { delivery: false, revenue: false }), ['22 sent', '7 replied'])
  assert.deepEqual(outcomeParts(o, { delivery: false, revenue: true, paid: false }), ['22 sent', '7 replied', '5 booked'])
})

test('the scheduler line is honest about how often Alpha really checks', () => {
  const t = (mins) => new Date(NOW - mins * 60_000).toISOString()
  assert.equal(schedulerWords({ last_tick_at: null, every_minutes: null, status: 'unknown' }, NOW).lamp, 'amber')
  const fast = schedulerWords({ last_tick_at: t(2), every_minutes: 5, status: 'ok' }, NOW)
  assert.equal(fast.lamp, 'green')
  assert.match(fast.text, /about every 5 minutes/)
  const daily = schedulerWords({ last_tick_at: t(600), every_minutes: 1440, status: 'ok' }, NOW)
  assert.equal(daily.lamp, 'amber')
  assert.match(daily.text, /once a day/)
  assert.match(daily.text, /every 5 minutes/)
  assert.equal(schedulerWords({ last_tick_at: t(120), every_minutes: 5, status: 'late' }, NOW).lamp, 'red')
})
