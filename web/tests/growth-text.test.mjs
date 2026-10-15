import test from 'node:test'
import assert from 'node:assert/strict'
import * as g from '../src/lib/growth-text.ts'

const day = 86_400_000
const now = Date.parse('2026-10-14T18:00:00Z')
const ago = d => new Date(now - d * day).toISOString()

test('first names: one word, never empty', () => {
  assert.equal(g.firstNameOf('Marcus Bell'), 'Marcus')
  assert.equal(g.firstNameOf('  Priya   Nair '), 'Priya')
  assert.equal(g.firstNameOf(''), 'there')
  assert.equal(g.firstNameOf(null), 'there')
  assert.equal(g.fillName('Hi {name}! Hi {NAME}!', 'Dana Ortiz'), 'Hi Dana! Hi Dana!')
})

test('every marketing text carries the opt-out line exactly once', () => {
  assert.equal(g.withOptOut('Hi there.'), 'Hi there. Reply STOP to opt out.')
  assert.equal(g.withOptOut('Hi there. Reply STOP to opt out.'), 'Hi there. Reply STOP to opt out.')
  assert.equal(g.withOptOut('Text stop to quit'), 'Text stop to quit')
  for (const t of [
    g.followUpTemplate('Southline Auto Repair', '(713) 555-0188'),
    g.reviewTemplate('Southline Auto Repair', 'https://g.page/r/abc/review'),
    g.referralTemplate('Southline Auto Repair', 'MARCUS-K3F9', 10, 25),
    g.leadTextTemplate('Southline Auto Repair', '(713) 555-0188', 'brake noise'),
  ]) {
    assert.equal((t.match(/STOP/g) || []).length, 1, t)
    assert.ok(t.endsWith(g.OPT_OUT_LINE), t)
  }
})

test('templates name the shop given, never a fixed one', () => {
  const t = g.followUpTemplate('Bayou City Garage', '')
  assert.match(t, /Bayou City Garage/)
  assert.match(t, /call us\./)
  assert.doesNotMatch(t, /Alpha|Houston|713/i)
  const r = g.referralTemplate('Bayou City Garage', 'DANA-2XQ7', 15, 0)
  assert.match(r, /15% off\./)
  assert.doesNotMatch(r, /credit/)
  assert.match(g.leadTextTemplate('Bayou City Garage', '', ''), /help with your vehicle\./)
})

test('referral codes are the first name plus four letters', () => {
  const seq = [0, 0.5, 0.99, 0.25]
  let i = 0
  const code = g.referralCode('Marcus Bell', () => seq[i++ % seq.length])
  assert.match(code, /^MARCUS-[A-Z2-9]{4}$/)
  assert.doesNotMatch(g.referralCode('', Math.random), /ALPHA/)
  assert.match(g.referralCode('', Math.random), /^FRIEND-/)
  assert.match(g.referralCode('José 3rd', Math.random), /^JOS-/)
})

test('text length: one part up to 160, two after', () => {
  assert.deepEqual(g.smsParts(''), { chars: 0, parts: 0 })
  assert.equal(g.smsParts('a'.repeat(160)).parts, 1)
  assert.equal(g.smsParts('a'.repeat(161)).parts, 2)
  assert.equal(g.smsParts('a'.repeat(306)).parts, 2)
  assert.equal(g.smsParts('a'.repeat(307)).parts, 3)
  // a curly quote is outside the basic set, so only 70 fit in one part
  assert.equal(g.smsParts('it’s ' + 'a'.repeat(65)).parts, 1)
  assert.equal(g.smsParts('it’s ' + 'a'.repeat(66)).parts, 2)
})

test('who can be texted: opted out and no-number people are set aside', () => {
  const people = [
    { id: 1, name: 'A', phone: '(713) 555-0142' },
    { id: 2, name: 'B', phone: '713-555-0143', sms_opted_out: true },
    { id: 3, name: 'C', phone: '' },
    { id: 4, name: 'D', phone: '555-01' },
    { id: 5, name: 'E', phone: '2815550117', sms_opted_out: false },
    { id: 6, name: 'F', phone: '', sms_opted_out: true },
  ]
  const s = g.splitForText(people)
  assert.deepEqual(s.eligible.map(p => p.id), [1, 5])
  assert.deepEqual(s.noPhone.map(p => p.id), [3, 4])
  assert.deepEqual(s.optedOut.map(p => p.id), [2, 6])
  assert.deepEqual(s.duplicate, [])
})

test('who can be texted: one number gets one text, and STOP covers every record with that number', () => {
  const s = g.splitForText([
    { id: 1, name: 'Walt', phone: '(281) 555-0101' },
    { id: 2, name: 'Walter K', phone: '+1 281 555 0101' },
    { id: 3, name: 'Rosa', phone: '713-555-0109' },
    { id: 4, name: 'Rosa D', phone: '7135550109', sms_opted_out: true },
    { id: 5, name: 'Mei', phone: '346-555-0166' },
  ])
  assert.deepEqual(s.eligible.map(p => p.id), [1, 5])
  assert.deepEqual(s.duplicate.map(p => p.id), [2])
  assert.deepEqual(s.optedOut.map(p => p.id), [3, 4])
  assert.equal(g.phoneKey('+1 (281) 555-0101'), '2815550101')
})

test('quiet customers: a recent invoice keeps someone off the list, even if the customer card is old', () => {
  const visits = g.lastVisits([
    { customer_id: 'c1', created_at: ago(10) },
    { customer_id: 'c1', created_at: ago(300) },
    { customer_id: 'c2', created_at: ago(200) },
    { customer_id: null, customer_name: '  Rosa   Delgado ', doc_date: ago(5) },
  ])
  const old = ago(400)
  assert.equal(g.isQuiet({ id: 'c1', name: 'Marcus', created_at: old }, visits, now), false)
  assert.equal(g.isQuiet({ id: 'c2', name: 'Dana', created_at: old }, visits, now), true)
  assert.equal(g.isQuiet({ id: 'c9', name: 'rosa delgado', created_at: old }, visits, now), false)
  assert.equal(g.isQuiet({ id: 'c9', name: 'No Paper', created_at: old }, visits, now), true)
  assert.equal(g.isQuiet({ id: 'c9', name: 'New Person', created_at: ago(20) }, visits, now), false)
  assert.equal(g.isQuiet({ id: 'c9', name: 'No Dates' }, visits, now), true)
})

test('quiet customers: a text in the last 60 days counts as hearing from you', () => {
  const visits = g.lastVisits([{ customer_id: 'c2', created_at: ago(200) }])
  assert.equal(g.isQuiet({ id: 'c2', last_contact: ago(30) }, visits, now), false)
  assert.equal(g.isQuiet({ id: 'c2', last_contact: ago(61) }, visits, now), true)
  assert.equal(g.isQuiet({ id: 'c2', last_contact: 'not a date' }, visits, now), true)
})

test('last visit is the newest invoice date, and bad dates are ignored', () => {
  const visits = g.lastVisits([
    { customer_id: 'c1', created_at: 'garbage' },
    { customer_id: 'c1', doc_date: '2026-09-01' },
  ])
  assert.equal(g.lastVisitOf({ id: 'c1' }, visits), Date.parse('2026-09-01'))
  assert.equal(g.agoWords(null, now), 'never')
  assert.equal(g.agoWords(now - 3 * day, now), '3 days ago')
  assert.equal(g.agoWords(now - 75 * day, now), '2 months ago')
  assert.equal(g.agoWords(now - 800 * day, now), '2 years ago')
  assert.equal(g.agoWords(now - 20 * 60000, now), 'today')
})

test('the city comes from the shop profile and is never guessed', () => {
  assert.deepEqual(g.cityFromProfile('Houston, TX 77025'), { search: 'Houston TX', label: 'Houston' })
  assert.deepEqual(g.cityFromProfile('Katy, TX'), { search: 'Katy TX', label: 'Katy' })
  assert.deepEqual(g.cityFromProfile('Beaumont TX 77701-1234'), { search: 'Beaumont TX', label: 'Beaumont' })
  assert.equal(g.cityFromProfile(''), null)
  assert.equal(g.cityFromProfile(undefined), null)
  assert.equal(g.cityFromProfile('77025'), null)
})

test('the one-tap win-back message maps old placeholders and never invents a special', () => {
  assert.equal(g.legacyOutreachMessage('Hi {name}, call {phone} at {shopName}.'), 'Hi {name}, call {shop_phone} at {shop}.')
  const plain = g.legacyOutreachMessage('   ')
  assert.match(plain, /\{shop\}/)
  assert.doesNotMatch(plain, /special|discount|\$|%|free/i)
})
