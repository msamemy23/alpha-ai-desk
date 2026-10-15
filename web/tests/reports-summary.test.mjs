import test from 'node:test'
import assert from 'node:assert/strict'
import { PAYMENTS, THIS_MONTH, TODAY, allDocs, RAW } from './helpers-reports.mjs'
import { docFrom } from '../src/lib/report-docs.ts'
import { whatChanged } from '../src/lib/report-summary.ts'

const docs = allDocs()
const prevMonth = { from: '2026-09-01', to: '2026-09-14' }
const base = { docs, payments: PAYMENTS, range: THIS_MONTH, previous: prevMonth, todayKey: TODAY, phrase: 'this month', vs: 'the same days last month' }

test('the summary opens with the money in and reads in plain sentences', () => {
  const s = whatChanged(base)
  assert.equal(s.headline, 'You collected $637 this month.', 'nothing to compare with in the earlier days, so no percentage is invented')
  const text = s.points.map(p => p.text)
  assert.ok(text.includes('You billed $637 on 4 invoices, $159 each on average.'), text.join('\n'))
  assert.ok(text.includes('3 cars serviced, 1 from new customers.'))
  assert.ok(text.includes('Your best day was Friday, with $427 collected.'))
  assert.ok(text.includes('$451 is still owed across 1 invoice.'))
  assert.ok(s.points.length <= 7)
  for (const p of s.points) assert.ok(p.text.length < 200, 'short enough to read in seconds')
})

test('things to watch come before the rest', () => {
  const s = whatChanged(base)
  assert.equal(s.points[0].tone, 'watch')
  assert.match(s.points[0].text, /1 part line has no cost written down/)
})

test('it compares with the earlier period when that had money in it', () => {
  const s = whatChanged({ ...base, range: { from: '2026-09-15', to: '2026-09-30' }, previous: { from: '2026-10-01', to: '2026-10-14' }, phrase: 'in September', vs: 'October' })
  assert.match(s.headline, /^You collected \$281 in September, down 56% from October\.$/)
})

test('an invoice marked Paid with no payment is called out and not counted as collected', () => {
  const s = whatChanged({ ...base, range: { from: '2026-08-01', to: '2026-08-31' }, previous: null, phrase: 'in August', vs: '' })
  assert.equal(s.headline, 'You collected $0 in August.')
  assert.ok(s.points.some(p => p.tone === 'watch' && /1 invoice is marked Paid with no payment recorded \(\$186\.81\)\. They are not counted as collected\./.test(p.text)), JSON.stringify(s.points))
})

test('an empty period says so instead of showing zeros as success', () => {
  const s = whatChanged({ ...base, docs: [], payments: [], phrase: 'today', vs: 'yesterday', previous: { from: '2026-10-13', to: '2026-10-13' }, range: { from: TODAY, to: TODAY } })
  assert.equal(s.headline, 'No money came in today.')
  assert.deepEqual(s.points.map(p => p.text), ['Nothing was billed today.'])
})

test('when everything is paid it says nothing is owed', () => {
  const paid = docs.filter(d => d.id !== 'd-1003')
  const s = whatChanged({ ...base, docs: paid })
  assert.ok(s.points.some(p => p.tone === 'good' && p.text === 'Every invoice is paid. Nothing is owed.'))
})

test('invoices over 30 days old are flagged with their total', () => {
  const old = docFrom({ ...RAW.alternator, id: 'old1', doc_number: 'INV-0001', doc_date: '2026-08-01', amount_paid: 0 })
  const s = whatChanged({ ...base, docs: [...docs, old] })
  const owed = s.points.find(p => /still owed/.test(p.text))
  assert.equal(owed.tone, 'watch')
  assert.match(owed.text, /1 invoice is over 30 days old \(\$551\)/)
})

test('calls are included when the call log loaded', () => {
  const s = whatChanged({ ...base, calls: { now: 12, before: 8 }, vs: 'last month' })
  assert.ok(s.points.some(p => p.text === '12 incoming calls, up 50% from last month (8 before).'), JSON.stringify(s.points))
  const none = whatChanged({ ...base, calls: null })
  assert.ok(!none.points.some(p => /incoming call/.test(p.text)))
})
