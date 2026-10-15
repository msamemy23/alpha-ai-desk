import test from 'node:test'
import assert from 'node:assert/strict'
import * as ic from '../src/lib/schedule-ical.ts'

const appt = (over = {}) => ({ id: 'a1', customer_name: 'Dana Ruiz', vehicle: '2018 Toyota Camry', service: 'Oil change', tech: 'Marco', date: '2026-10-19', time: '09:00', duration: 45, status: 'Confirmed', notes: 'Rattle, left side', ...over })

test('the feed is a valid calendar with one event per live booking', () => {
  const out = ic.toIcal("Joe's Auto", [appt(), appt({ id: 'a2', status: 'Cancelled' }), appt({ id: 'a3', status: 'Declined' }), appt({ id: 'a4', date: 'bad' })], new Date('2026-10-15T12:00:00Z'))
  assert.ok(out.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(out.endsWith('END:VCALENDAR\r\n'))
  assert.equal((out.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.match(out, /DTSTART:20261019T090000\r\n/)
  assert.match(out, /DTEND:20261019T094500\r\n/)
  assert.match(out, /UID:a1@shop-schedule/)
  assert.match(out, /DTSTAMP:20261015T120000Z/)
  assert.match(out, /SUMMARY:Dana: Oil change\r\n/)
  assert.match(out, /X-WR-CALNAME:Joe's Auto schedule/)
})

test('text values are escaped and the customer phone is never included', () => {
  const out = ic.toIcal('Shop', [appt({ phone: '+17135550142', notes: 'a;b,c\nline two' })])
  assert.match(out, /Notes: a\\;b\\,c\\nline two/)
  assert.equal(out.includes('7135550142'), false)
})

test('a booking that crosses midnight rolls to the next day, and requests are tentative', () => {
  const out = ic.toIcal('Shop', [appt({ time: '23:30', duration: 120, status: 'Requested' })])
  assert.match(out, /DTEND:20261020T013000/)
  assert.match(out, /STATUS:TENTATIVE/)
  assert.match(out, /SUMMARY:Dana: Oil change \(request\)/)
})

test('long lines are folded at 75 bytes without splitting a character', () => {
  const out = ic.toIcal('Shop', [appt({ notes: 'é'.repeat(200) })])
  for (const line of out.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line.length + ' ' + line.slice(0, 20))
  assert.equal(ic.fold('short'), 'short')
  const unfolded = ic.fold('x'.repeat(200)).split('\r\n ').join('')
  assert.equal(unfolded, 'x'.repeat(200))
})

test('walk-in names show the person, defaults are polite', () => {
  assert.match(ic.toIcal('', [appt({ customer_name: 'Walk-in: Eddie Lee', service: '' })]), /SUMMARY:Eddie\r\n/)
  assert.match(ic.toIcal('', []), /X-WR-CALNAME:Shop schedule/)
  assert.match(ic.toIcal('', [appt({ customer_name: '', duration: null })]), /SUMMARY:Customer: Oil change/)
})
