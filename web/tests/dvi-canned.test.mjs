import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/lib/dvi-canned.ts'

const job = (id, name, extra = {}) => ({ id, name, category: 'Brakes', description: '', labor_hours: 1, labor_rate: 100, parts: [], total_price: null, active: true, ...extra })
const jobs = [
  job('1', 'Front brake pad replacement', { parts: [{ cost: 60, qty: 1 }] }),
  job('2', 'Rear brake pad replacement', { total_price: 210 }),
  job('3', 'Front brake pads, rotors and fluid flush', { total_price: 640 }),
  job('4', 'Oil change', { category: 'Oil change' }),
  job('5', 'Front rotors resurface', { active: false }),
  job('6', 'Wiper blades', { category: 'Maintenance' }),
]

test('a canned job price is the saved total, or labor plus parts', () => {
  assert.equal(c.cannedPrice(jobs[0]), 160)
  assert.equal(c.cannedPrice(jobs[1]), 210)
  assert.equal(c.cannedPrice(job('x', 'x', { labor_hours: null, labor_rate: null, parts: null })), 0)
  assert.equal(c.cannedPrice(job('x', 'x', { total_price: 99.999 })), 100)
})

test('a checklist line finds the matching jobs, closest first', () => {
  const m = c.suggestCanned('Front brake pads', jobs)
  assert.deepEqual(m.map(x => x.job.id), ['1', '3']) // the rear job is never offered for a front line
  assert.equal(m[0].price, 160)
  assert.deepEqual(c.suggestCanned('Rear brake pads', jobs).map(x => x.job.id)[0], '2')
})

test('wording differences still match, and unrelated lines find nothing', () => {
  assert.equal(c.suggestCanned('Wipers', jobs)[0].job.id, '6')
  assert.equal(c.suggestCanned('Front rotors', jobs).length, 1) // the inactive job is not offered; the combo job names rotors
  assert.equal(c.suggestCanned('Front rotors', jobs)[0].job.id, '3')
  assert.deepEqual(c.suggestCanned('Parking brake', jobs).map(x => x.job.id).includes('4'), false)
  assert.deepEqual(c.suggestCanned('', jobs), [])
  assert.deepEqual(c.suggestCanned('Exhaust', jobs), [])
})

test('the description alone is too weak to price a repair from', () => {
  const d = [job('9', 'Tune-up', { description: 'includes tire rotation and wipers' })]
  assert.deepEqual(c.suggestCanned('Wipers', d), [])
})

test('the search box needs every word, matches word starts, and skips inactive jobs', () => {
  assert.deepEqual(c.searchCanned('brake front', jobs).map(x => x.job.id).sort(), ['1', '3'])
  assert.deepEqual(c.searchCanned('oil', jobs).map(x => x.job.id), ['4'])
  assert.deepEqual(c.searchCanned('rot', jobs).map(x => x.job.id), ['3'])
  assert.equal(c.searchCanned('', jobs).length, 5)
  assert.deepEqual(c.searchCanned('zzz', jobs), [])
})
