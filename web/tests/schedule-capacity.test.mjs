import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/lib/schedule-capacity.ts'

const S = (over = {}) => c.cleanCapacity({ techCount: 2, bays: 2, hoursPerTech: 7, ...over })
const A = (id, time, duration, extra = {}) => ({ id, date: '2026-10-19', time, duration, status: 'Scheduled', tech: '', kind: 'dropoff', ...extra })
const MON = '2026-10-19' // a Monday

test('dates and clock times are plain strings with safe arithmetic', () => {
  assert.equal(c.dayKeyOf(MON), 'mon')
  assert.equal(c.dayKeyOf('2026-10-25'), 'sun')
  assert.equal(c.addDaysYmd('2026-12-31', 1), '2027-01-01')
  assert.equal(c.addDaysYmd('2026-03-01', -1), '2026-02-28')
  assert.equal(c.daysApart('2026-10-15', '2026-10-19'), 4)
  assert.equal(c.minutesOf('09:30:00'), 570)
  assert.equal(c.timeOf(570), '09:30')
  assert.equal(c.timeOf(9999), '23:59')
  assert.equal(c.isYmd('2026-02-30'), false) // Date.UTC rolls over, so check it is rejected
})

test('the shop clock comes from the time zone, not the machine', () => {
  const at = new Date('2026-10-19T03:30:00Z') // still Sunday evening in Houston (CDT, UTC-5)
  assert.deepEqual(c.nowIn('America/Chicago', at), { ymd: '2026-10-18', minutes: 22 * 60 + 30 })
  assert.deepEqual(c.nowIn('Asia/Tokyo', at), { ymd: '2026-10-19', minutes: 12 * 60 + 30 })
  assert.equal(typeof c.nowIn('Not/AZone', at).ymd, 'string') // falls back, never throws
})

test('settings are cleaned: bad hours reset, numbers clamped, services deduplicated', () => {
  const s = c.cleanCapacity({
    hours: { mon: { open: true, start: '18:00', end: '09:00' }, tue: { open: false, start: '07:00', end: '12:00' }, wed: 'x' },
    closedDates: ['2026-12-25', 'nope', '2026-12-25', '2026-01-01'],
    bays: 999, techCount: -3, hoursPerTech: 40, arrivalMinutes: 20, noShowGraceMinutes: 1,
    services: [{ label: ' Oil  change ', minutes: 5, kind: 'wait' }, { label: 'oil change' }, { label: '' }, null, { label: 'Brakes', minutes: 9999, online: false }],
  })
  assert.deepEqual(s.hours.mon, { open: true, start: '08:00', end: '17:00' }) // end before start: back to the default
  assert.deepEqual(s.hours.tue, { open: false, start: '07:00', end: '12:00' })
  assert.equal(s.hours.wed.start, '08:00')
  assert.deepEqual(s.closedDates, ['2026-01-01', '2026-12-25'])
  assert.deepEqual([s.bays, s.techCount, s.hoursPerTech, s.arrivalMinutes, s.noShowGraceMinutes], [40, 0, 12, 30, 5])
  assert.deepEqual(s.services.map(x => [x.label, x.minutes, x.kind, x.online]), [['Oil change', 15, 'wait', true], ['Brakes', 600, 'dropoff', false]])
  assert.equal(c.cleanCapacity(undefined).services.length, c.DEFAULT_SERVICES.length)
  assert.equal(c.cleanCapacity(null).bays, 0)
})

test('a day is open, busy, nearly full or over by how much technician time is booked', () => {
  const s = S() // 2 techs x 7 h = 14 h = 840 min
  assert.equal(c.dayCapacityMinutes(s, MON), 840)
  assert.equal(c.dayCapacityMinutes(s, '2026-10-24'), 0) // Saturday is closed
  assert.equal(c.dayCapacityMinutes(S({ techCount: 0 }), MON), null)
  const L = list => c.dayLoad(s, list, MON)
  assert.equal(L([]).level, 'open')
  assert.equal(L([A('a', '08:00', 300)]).level, 'open') // 36%
  assert.equal(L([A('a', '08:00', 300), A('b', '08:00', 240)]).level, 'busy') // 64%
  assert.equal(L([A('a', '08:00', 400), A('b', '08:00', 400)]).level, 'full') // 95%
  assert.equal(L([A('a', '08:00', 400), A('b', '08:00', 400), A('c', '08:00', 60)]).level, 'over')
  assert.equal(L([A('a', '08:00', 400), A('b', '08:00', 400, { status: 'Cancelled' })]).level, 'open')
  assert.equal(c.dayLoad(s, [], '2026-10-24').level, 'closed')
  const l = L([A('a', '08:00', 330, { kind: 'wait' }), A('b', '09:00', 60)])
  assert.equal(c.loadText(l), '6 h 30 min booked of 14 h')
  assert.deepEqual([l.count, l.waiters, l.dropoffs], [2, 1, 1])
  assert.equal(c.loadText(c.dayLoad(S({ techCount: 0 }), [A('a', '08:00', 90)], MON)), '1 h 30 min booked')
  assert.equal(c.dayLoad(S({ techCount: 0 }), [A('a', '08:00', 90)], MON).level, 'open') // no number of techs: never claims "full"
})

test('a booking that is the only thing at that time has no warnings', () => {
  assert.deepEqual(c.bookingWarnings(S(), [], { date: MON, time: '09:00', duration: 60, kind: 'dropoff', tech: 'Marco' }), [])
})

test('closed days, hours, and times that have passed are called out in plain words', () => {
  const s = S({ closedDates: ['2026-10-20'] })
  const w = (date, time, duration, now) => c.bookingWarnings(s, [], { date, time, duration }, { now }).map(x => x.code)
  assert.deepEqual(w('2026-10-20', '09:00', 60), ['closed'])
  assert.deepEqual(w('2026-10-24', '09:00', 60), ['closed']) // Saturday
  assert.deepEqual(w(MON, '07:00', 60), ['hours'])
  assert.deepEqual(w(MON, '16:30', 60), ['hours'])
  assert.deepEqual(w(MON, '09:00', 60, { ymd: MON, minutes: 10 * 60 }), ['past'])
  assert.deepEqual(w(MON, '09:00', 60, { ymd: '2026-10-18', minutes: 10 * 60 }), [])
  assert.match(c.bookingWarnings(s, [], { date: '2026-10-24', time: '09:00', duration: 60 })[0].text, /closed on Saturdays/)
})

test('a technician with a booking at that time is named, and the booking being edited does not clash with itself', () => {
  const list = [A('a', '09:00', 60, { tech: 'Marco Reyes' })]
  const clash = c.bookingWarnings(S(), list, { date: MON, time: '09:30', duration: 60, tech: ' marco reyes ' })
  assert.deepEqual(clash.map(x => x.code), ['tech'])
  assert.equal(clash[0].text, 'marco reyes already has a booking at this time.')
  assert.deepEqual(c.bookingWarnings(S(), list, { id: 'a', date: MON, time: '09:30', duration: 60, tech: 'Marco Reyes' }), [])
  assert.deepEqual(c.bookingWarnings(S(), list, { date: MON, time: '10:00', duration: 60, tech: 'Marco Reyes' }), []) // back to back is fine
})

test('bays, waiting customers, drop-offs and arrivals each have their own warning', () => {
  const s = S({ bays: 2, techCount: 3, maxWaiters: 1, maxDropoffs: 2, maxArrivals: 1 })
  const list = [A('a', '09:00', 60, { kind: 'wait' }), A('b', '09:00', 120, { kind: 'dropoff' })]
  const codes = (cand) => c.bookingWarnings(s, list, { date: MON, ...cand }).map(x => x.code)
  assert.deepEqual(codes({ time: '09:15', duration: 30, kind: 'wait' }), ['bay', 'waiters', 'arrivals'])
  // a drop-off later in the day: no bay clash, but the day already holds two drop-offs
  const later = [A('a', '09:00', 60, { kind: 'dropoff' }), A('b', '13:00', 60, { kind: 'dropoff' })]
  assert.deepEqual(c.bookingWarnings(s, later, { date: MON, time: '15:00', duration: 60, kind: 'dropoff' }).map(x => x.code), ['dropoffs'])
  // two arrivals in the same half hour
  assert.deepEqual(c.bookingWarnings(s, [A('a', '09:00', 30, { kind: 'dropoff' })], { date: MON, time: '09:15', duration: 30, kind: 'wait' }).map(x => x.code), ['arrivals'])
  // unlimited when the numbers are 0
  assert.deepEqual(c.bookingWarnings(S({ bays: 0, techCount: 0 }), list, { date: MON, time: '09:15', duration: 30, kind: 'wait' }), [])
})

test('a day with more booked than the technicians can do says so', () => {
  const s = S({ techCount: 1, hoursPerTech: 7 }) // 420 minutes
  const list = [A('a', '08:00', 240), A('b', '12:00', 120)]
  const w = c.bookingWarnings(s, list, { date: MON, time: '14:00', duration: 90, kind: 'dropoff' })
  assert.ok(w.some(x => x.code === 'day-full'))
  assert.match(w.find(x => x.code === 'day-full').text, /7 h 30 min is booked and the day has 7 h/)
})

test('peak overlap counts cars at the same moment, and a car leaving frees its place for one arriving', () => {
  const list = [A('a', '09:00', 60), A('b', '10:00', 60), A('c', '09:30', 60)]
  assert.equal(c.peakOverlap(list, 540, 660), 2)
  assert.equal(c.peakOverlap([A('a', '09:00', 60), A('b', '10:00', 60)], 540, 660), 1)
  assert.equal(c.peakOverlap(list, 700, 800), 0)
  assert.equal(c.peakOverlap(list, 540, 660, a => a.id === 'a'), 1)
})

test('the public page only offers times that fit', () => {
  const s = S({ bays: 1, techCount: 1 })
  const now = { ymd: '2026-10-15', minutes: 8 * 60 }
  const q = { date: MON, minutes: 60, kind: 'dropoff', now, leadMinutes: 120, step: 60 }
  assert.deepEqual(c.freeSlots(s, [], q), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'])
  assert.deepEqual(c.freeSlots(s, [A('a', '10:00', 120)], q), ['08:00', '09:00', '12:00', '13:00', '14:00', '15:00', '16:00'])
  assert.deepEqual(c.freeSlots(s, [], { ...q, date: '2026-10-24' }), []) // Saturday: closed
  assert.deepEqual(c.freeSlots(s, [], { ...q, date: '2026-10-14' }), []) // yesterday
  // the same day: nothing sooner than the lead time
  const sameDay = c.freeSlots(s, [], { ...q, date: '2026-10-15', now: { ymd: '2026-10-15', minutes: 9 * 60 + 10 } })
  assert.equal(sameDay[0], '12:00') // 9:10 + 2 h = 11:10, next step is 12:00 on the hour
  // tomorrow morning when it is late today: the lead time rolls over midnight
  const tomorrow = c.freeSlots(s, [], { ...q, date: '2026-10-16', now: { ymd: '2026-10-15', minutes: 22 * 60 }, leadMinutes: 14 * 60 })
  assert.equal(tomorrow[0], '12:00')
  // a long job needs room before closing
  assert.equal(c.freeSlots(s, [], { ...q, minutes: 240 }).at(-1), '13:00')
  // cancelled bookings free their time
  assert.equal(c.freeSlots(s, [A('a', '10:00', 120, { status: 'Cancelled' })], q).length, 9)
  // a request waiting for an answer holds its time
  assert.equal(c.freeSlots(s, [A('a', '10:00', 120, { status: 'Requested' })], q).includes('10:00'), false)
})

test('the public page never offers a slot when the shop has not said how many technicians it has: it assumes one', () => {
  const s = S({ bays: 0, techCount: 0 })
  assert.equal(c.freeSlots(s, [A('a', '09:00', 60)], { date: MON, minutes: 60, kind: 'dropoff', now: { ymd: '2026-10-15', minutes: 0 }, leadMinutes: 0, step: 60 }).includes('09:00'), false)
})

test('waiters, drop-offs and arrival windows limit what the public page offers', () => {
  const now = { ymd: '2026-10-15', minutes: 0 }
  const base = { date: MON, minutes: 30, now, leadMinutes: 0, step: 30 }
  const s = S({ bays: 5, techCount: 5, maxWaiters: 1, maxDropoffs: 1, maxArrivals: 1 })
  const list = [A('a', '09:00', 60, { kind: 'wait' })]
  const wait = c.freeSlots(s, list, { ...base, kind: 'wait' })
  assert.equal(wait.includes('09:00'), false); assert.equal(wait.includes('09:30'), false); assert.equal(wait.includes('10:00'), true)
  const drop = c.freeSlots(s, list, { ...base, kind: 'dropoff' })
  assert.equal(drop.includes('09:30'), true) // arrives a different window
  assert.equal(drop.includes('09:00'), false) // same arrival window
  assert.deepEqual(c.freeSlots(s, [A('a', '09:00', 60, { kind: 'dropoff' })], { ...base, kind: 'dropoff' }), []) // one drop-off a day, already booked
  // the day's technician time runs out
  const tight = S({ techCount: 1, hoursPerTech: 1 })
  assert.deepEqual(c.freeSlots(tight, [A('a', '08:00', 40)], { ...base, minutes: 30, kind: 'dropoff' }), [])
})

test('how long a job takes: the shop\'s own canned job first, then the nearest service type', () => {
  const s = S()
  const canned = [{ name: 'Front brake pads', labor_hours: 1.6 }, { name: 'Zero', labor_hours: 0 }]
  assert.deepEqual(c.minutesFor('front brake pads', s, canned), { minutes: 105, kind: null, from: 'canned job' })
  assert.equal(c.minutesFor('Zero', s, canned), null)
  assert.deepEqual(c.minutesFor('oil change', s, []), { minutes: 45, kind: 'wait', from: 'service type' })
  assert.equal(c.minutesFor('Synthetic Oil Change and filter', s, []).minutes, 45)
  assert.equal(c.minutesFor('brakes squeal', s, []).minutes, 150)
  assert.equal(c.minutesFor('', s, []), null)
  assert.equal(c.minutesFor('zzz', s, []), null)
  assert.equal(c.serviceFor('A/C service', s.services).key, 'ac')
})

test('a car that has not shown up is flagged only after the grace time', () => {
  const a = { date: MON, time: '09:00', status: 'Confirmed' }
  assert.equal(c.isOverdueArrival(a, { ymd: MON, minutes: 9 * 60 + 29 }, 30), false)
  assert.equal(c.isOverdueArrival(a, { ymd: MON, minutes: 9 * 60 + 30 }, 30), true)
  assert.equal(c.isOverdueArrival({ ...a, status: 'In Progress' }, { ymd: MON, minutes: 12 * 60 }, 30), false)
  assert.equal(c.isOverdueArrival({ ...a, status: 'No Show' }, { ymd: MON, minutes: 12 * 60 }, 30), false)
  assert.equal(c.isOverdueArrival({ ...a, status: 'Scheduled' }, { ymd: '2026-10-20', minutes: 1 }, 30), true) // yesterday's booking still open
  assert.equal(c.isOverdueArrival({ ...a, date: '2026-10-21' }, { ymd: MON, minutes: 23 * 60 }, 30), false)
})

test('missed bookings are counted against bookings that were meant to happen', () => {
  const h = ['Completed', 'No Show', 'Completed', 'Cancelled', 'No Show', 'Requested', 'Declined'].map(status => ({ status }))
  assert.deepEqual(c.missRate(h), { missed: 2, total: 4 })
  assert.deepEqual(c.missRate([]), { missed: 0, total: 0 })
})
