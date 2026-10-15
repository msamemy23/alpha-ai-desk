import test from 'node:test'
import assert from 'node:assert/strict'
import { isFoundLead, leadOutreachCheck, subjectProblem } from '../src/lib/lead-compliance.ts'

const shop = { name: 'Bayou City Garage', address: '1200 Main St, Houston, TX 77002', timeZone: 'America/Chicago' }
const afternoon = new Date('2026-10-14T20:00:00Z') // Wednesday 3pm in Houston
const lateNight = new Date('2026-10-15T03:30:00Z') // Wednesday 10:30pm in Houston
const walkIn = { id: '1', name: 'Dana Ruiz', phone: '(713) 555-0142', email: 'dana@example.com', status: 'new', source: 'walk-in' }
const found = { ...walkIn, id: '2', source: 'ai-fleet-scan' }

test('a lead that came in by itself can be emailed, texted or called during the day', () => {
  for (const channel of ['email', 'sms', 'ai_call']) {
    const r = leadOutreachCheck({ lead: walkIn, channel, shop, now: afternoon })
    assert.equal(r.ok, true, channel)
  }
})

test('a lead Alpha found on the web can be emailed but never texted or auto-called', () => {
  assert.equal(isFoundLead(found), true)
  assert.equal(isFoundLead(walkIn), false)
  assert.equal(leadOutreachCheck({ lead: found, channel: 'email', shop, now: afternoon }).ok, true)
  for (const channel of ['sms', 'ai_call']) {
    const r = leadOutreachCheck({ lead: found, channel, shop, now: afternoon })
    assert.equal(r.ok, false, channel)
    assert.equal(r.code, 'needs_permission')
    assert.match(r.reason, /written permission/)
  }
})

test('every marketing email needs the shop name and mailing address, because the law requires them', () => {
  const noAddress = leadOutreachCheck({ lead: walkIn, channel: 'email', shop: { ...shop, address: '  ' }, now: afternoon })
  assert.equal(noAddress.ok, false)
  assert.equal(noAddress.code, 'no_address')
  assert.match(noAddress.reason, /mailing address/)
  const noName = leadOutreachCheck({ lead: walkIn, channel: 'email', shop: { ...shop, name: '' }, now: afternoon })
  assert.equal(noName.code, 'no_name')
})

test('someone who unsubscribed or said stop is never contacted', () => {
  assert.equal(leadOutreachCheck({ lead: walkIn, channel: 'email', shop, now: afternoon, emailOptedOut: true }).code, 'opted_out')
  assert.equal(leadOutreachCheck({ lead: walkIn, channel: 'sms', shop, now: afternoon, smsOptedOut: true }).code, 'opted_out')
  assert.equal(leadOutreachCheck({ lead: walkIn, channel: 'ai_call', shop, now: afternoon, smsOptedOut: true }).code, 'opted_out')
})

test('a lead marked not interested, lost or already a customer is left alone on every channel', () => {
  for (const status of ['not_interested', 'do_not_contact', 'unsubscribed', 'converted', 'lost']) {
    for (const channel of ['email', 'sms', 'ai_call']) {
      assert.equal(leadOutreachCheck({ lead: { ...walkIn, status }, channel, shop, now: afternoon }).code, 'stopped', `${status} ${channel}`)
    }
  }
})

test('texts and calls wait for calling hours in the lead\'s own time, but email does not', () => {
  const sms = leadOutreachCheck({ lead: walkIn, channel: 'sms', shop, now: lateNight })
  assert.equal(sms.ok, false)
  assert.equal(sms.code, 'quiet_hours')
  assert.ok(sms.retryAt && sms.retryAt.getTime() > lateNight.getTime())
  assert.match(sms.reason, /calling hours/)
  assert.equal(leadOutreachCheck({ lead: walkIn, channel: 'ai_call', shop, now: lateNight }).code, 'quiet_hours')
  assert.equal(leadOutreachCheck({ lead: walkIn, channel: 'email', shop, now: lateNight }).ok, true)
})

test('a lead on the West Coast is judged by their clock, not the shop\'s', () => {
  // 9:30pm in Houston is 7:30pm in Los Angeles, but the shop's own quiet hours (9pm) still apply to the shop.
  const la = { ...walkIn, phone: '(310) 555-0100' }
  const r = leadOutreachCheck({ lead: la, channel: 'sms', shop, now: new Date('2026-10-15T02:30:00Z') })
  assert.equal(r.ok, false)
  // 5:30pm in Houston is 3:30pm in LA: fine for both.
  assert.equal(leadOutreachCheck({ lead: la, channel: 'sms', shop, now: new Date('2026-10-14T22:30:00Z') }).ok, true)
})

test('a missing address or number is reported plainly', () => {
  assert.equal(leadOutreachCheck({ lead: { ...walkIn, email: '' }, channel: 'email', shop, now: afternoon }).code, 'no_contact')
  assert.equal(leadOutreachCheck({ lead: { ...walkIn, phone: '12' }, channel: 'sms', shop, now: afternoon }).code, 'no_contact')
})

test('a subject line must be honest and plain', () => {
  assert.equal(subjectProblem(''), '')
  assert.equal(subjectProblem('A note from Bayou City Garage'), '')
  assert.match(subjectProblem('Re: your car'), /pretends/)
  assert.match(subjectProblem('FWD: invoice'), /pretends/)
  assert.match(subjectProblem('Oil change \u{1F697}'), /emoji/)
  assert.match(subjectProblem('x'.repeat(151)), /150/)
  assert.match(subjectProblem('one\ntwo'), /single line/)
})
