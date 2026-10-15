import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, normalizeRules, validateRules, toE164US, phoneKey } from '../src/lib/voice/rules.ts'
import { openState, inQuietHours, findOpenSlots, isSlotOpen, hoursSummary, wallClock, fmt12 } from '../src/lib/voice/hours.ts'

const weekHours = {
  mon: { open: true, from: '08:00', to: '17:00' }, tue: { open: true, from: '08:00', to: '17:00' },
  wed: { open: true, from: '08:00', to: '17:00' }, thu: { open: true, from: '08:00', to: '17:00' },
  fri: { open: true, from: '08:00', to: '17:00' }, sat: { open: true, from: '09:00', to: '13:00' },
  sun: { open: false, from: '09:00', to: '13:00' },
}
const TZ = 'America/Chicago'
// 2026-10-14 is a Wednesday. 15:00 UTC = 10:00 in Chicago (CDT, UTC-5).
const wedMorning = new Date('2026-10-14T15:00:00Z')

test('defaults are generic: no shop name, no hours, a recording notice, calls on', () => {
  const r = normalizeRules(undefined)
  assert.equal(r.hours, null)
  assert.equal(r.reviewed, false)
  assert.equal(r.calls_enabled, true)
  assert.equal(r.texts_mode, 'auto')
  assert.equal(r.assistant_name, '')
  assert.ok(r.recording_notice)
  assert.doesNotMatch(JSON.stringify(r), /alpha|houston|713|832/i)
  assert.deepEqual(normalizeRules(DEFAULT_RULES), DEFAULT_RULES)
})

test('normalizeRules never throws and fixes bad input', () => {
  for (const bad of [null, 5, 'x', [], { hours: 7, handoff: 'x', topics: 3, quiet_hours: 'no', booking_slot_minutes: 'abc' }]) {
    const r = normalizeRules(bad)
    assert.equal(r.version, 1)
    assert.ok(r.booking_slot_minutes > 0)
  }
  const r = normalizeRules({ texts_mode: 'robot', tone: 'angry', booking_mode: 'yes', booking_capacity: 999, takeover_hours: -4, notify_email: 'nope', handoff: [{ name: 'A', phone: '12' }, { name: 'Sam', phone: '(713) 555-0142' }] })
  assert.equal(r.texts_mode, 'auto')
  assert.equal(r.tone, 'friendly')
  assert.equal(r.booking_mode, 'request')
  assert.equal(r.booking_capacity, 10)
  assert.equal(r.takeover_hours, 1)
  assert.equal(r.notify_email, '')
  assert.deepEqual(r.handoff, [{ name: 'Sam', phone: '+17135550142' }])
})

test('validateRules explains problems in plain words', () => {
  const input = { handoff: [{ name: 'A', phone: '555' }], notify_email: 'bad', booking_mode: 'book' }
  const r = normalizeRules(input)
  const problems = validateRules(r, input).map(p => p.field)
  assert.ok(problems.includes('handoff'))
  assert.ok(problems.includes('notify_email'))
  assert.ok(problems.includes('booking_mode'))
  const ok = normalizeRules({ hours: weekHours, booking_mode: 'book' })
  assert.deepEqual(validateRules(ok, { hours: weekHours, booking_mode: 'book' }), [])
  const backwards = normalizeRules({ hours: { ...weekHours, mon: { open: true, from: '17:00', to: '08:00' } } })
  assert.ok(validateRules(backwards).some(p => p.field === 'hours.mon'))
})

test('phone helpers', () => {
  assert.equal(toE164US('(713) 555-0142'), '+17135550142')
  assert.equal(toE164US('1-713-555-0142'), '+17135550142')
  assert.equal(toE164US('555-0142'), null)
  assert.equal(phoneKey('+17135550142'), phoneKey('(713) 555-0142'))
})

test('open state follows the shop clock, not the server clock', () => {
  assert.equal(wallClock(wedMorning, TZ).weekday, 'wed')
  assert.equal(wallClock(wedMorning, TZ).minutes, 600)
  const open = openState(weekHours, [], TZ, wedMorning)
  assert.equal(open.open, true)
  assert.equal(open.closesAt, '5:00 PM')
  const night = openState(weekHours, [], TZ, new Date('2026-10-15T03:00:00Z')) // Wed 10pm Chicago
  assert.equal(night.open, false)
  assert.equal(night.reason, 'after_close')
  assert.equal(night.nextOpen, 'tomorrow at 8:00 AM')
  const sunday = openState(weekHours, [], TZ, new Date('2026-10-18T17:00:00Z'))
  assert.equal(sunday.open, false)
  assert.equal(sunday.reason, 'closed_day')
  assert.equal(sunday.nextOpen, 'tomorrow at 8:00 AM')
  const holiday = openState(weekHours, ['2026-10-14'], TZ, wedMorning)
  assert.equal(holiday.open, false)
  assert.equal(holiday.reason, 'closed_date')
  assert.equal(holiday.nextOpen, 'tomorrow at 8:00 AM')
  const early = openState(weekHours, [], TZ, new Date('2026-10-14T11:00:00Z')) // 6am
  assert.equal(early.nextOpen, 'today at 8:00 AM')
})

test('unset hours are reported as unknown so the assistant never guesses', () => {
  const s = openState(null, [], TZ, wedMorning)
  assert.equal(s.known, false)
  assert.equal(s.open, false)
  const none = openState({ ...weekHours, mon: { ...weekHours.mon, open: false }, tue: { ...weekHours.tue, open: false }, wed: { ...weekHours.wed, open: false }, thu: { ...weekHours.thu, open: false }, fri: { ...weekHours.fri, open: false }, sat: { ...weekHours.sat, open: false } }, [], TZ, wedMorning)
  assert.equal(none.known, false)
})

test('hours summary groups days', () => {
  assert.equal(hoursSummary(weekHours), 'Mon to Fri 8:00 AM to 5:00 PM, Sat 9:00 AM to 1:00 PM, Sun closed')
  assert.equal(hoursSummary(null), '')
  assert.equal(fmt12('00:30'), '12:30 AM')
  assert.equal(fmt12('12:00'), '12:00 PM')
})

test('quiet hours wrap past midnight', () => {
  const quiet = { enabled: true, from: '21:00', to: '08:00' }
  assert.equal(inQuietHours(quiet, TZ, new Date('2026-10-15T03:00:00Z')), true) // 10pm
  assert.equal(inQuietHours(quiet, TZ, new Date('2026-10-15T11:00:00Z')), true) // 6am
  assert.equal(inQuietHours(quiet, TZ, wedMorning), false)
  assert.equal(inQuietHours({ ...quiet, enabled: false }, TZ, new Date('2026-10-15T03:00:00Z')), false)
  assert.equal(inQuietHours({ enabled: true, from: '13:00', to: '15:00' }, TZ, wedMorning), false)
})

const slotRules = { hours: weekHours, closed_dates: [], booking_slot_minutes: 60, booking_capacity: 1, booking_lead_hours: 2 }

test('open times respect hours, lead time, closed days and booked appointments', () => {
  const now = new Date('2026-10-14T15:00:00Z') // Wed 10:00
  const slots = findOpenSlots({ rules: slotRules, tz: TZ, now, appointments: [], limit: 3, perDay: 2 })
  assert.equal(slots.length, 3)
  assert.equal(slots[0].date, '2026-10-14')
  assert.equal(slots[0].time, '12:00') // 10:00 + 2h lead
  assert.equal(slots[1].time, '13:00')
  assert.equal(slots[2].date, '2026-10-15') // perDay 2 spreads to the next day
  const busy = [{ date: '2026-10-14', time: '12:00', duration: 60, status: 'Scheduled' }]
  const next = findOpenSlots({ rules: slotRules, tz: TZ, now, appointments: busy, limit: 2, perDay: 5 })
  assert.equal(next[0].time, '13:00')
  const cancelled = [{ date: '2026-10-14', time: '12:00', duration: 60, status: 'Cancelled' }]
  assert.equal(findOpenSlots({ rules: slotRules, tz: TZ, now, appointments: cancelled, limit: 1 })[0].time, '12:00')
  const twoCap = { ...slotRules, booking_capacity: 2 }
  assert.equal(findOpenSlots({ rules: twoCap, tz: TZ, now, appointments: busy, limit: 1 })[0].time, '12:00')
  const holiday = findOpenSlots({ rules: { ...slotRules, closed_dates: ['2026-10-14'] }, tz: TZ, now, appointments: [], limit: 1 })
  assert.equal(holiday[0].date, '2026-10-15')
  assert.deepEqual(findOpenSlots({ rules: { ...slotRules, hours: null }, tz: TZ, now, appointments: [] }), [])
})

test('slots never fall on a closed Sunday and the last slot ends by closing time', () => {
  const now = new Date('2026-10-17T20:00:00Z') // Sat 3pm Chicago, after Saturday closing
  const slots = findOpenSlots({ rules: slotRules, tz: TZ, now, appointments: [], limit: 3, perDay: 3 })
  assert.ok(slots.every(s => s.date !== '2026-10-18'))
  assert.equal(slots[0].date, '2026-10-19')
  const sat = findOpenSlots({ rules: slotRules, tz: TZ, now: new Date('2026-10-17T13:00:00Z'), appointments: [], limit: 10, perDay: 10 }).filter(s => s.date === '2026-10-17')
  assert.ok(sat.every(s => Number(s.time.slice(0, 2)) < 13))
})

test('isSlotOpen re-checks a time right before booking', () => {
  const now = new Date('2026-10-14T15:00:00Z')
  const opts = { rules: slotRules, tz: TZ, now, appointments: [] }
  assert.equal(isSlotOpen(opts, '2026-10-14', '13:00'), true)
  assert.equal(isSlotOpen({ ...opts, appointments: [{ date: '2026-10-14', time: '13:00', duration: 60, status: 'Scheduled' }] }, '2026-10-14', '13:00'), false)
  assert.equal(isSlotOpen(opts, '2026-10-14', '07:00'), false)
  assert.equal(isSlotOpen(opts, '2026-10-18', '10:00'), false)
})
