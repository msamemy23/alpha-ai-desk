import test from 'node:test'
import assert from 'node:assert/strict'
import { checkRedemption, looksLikeCode, normalizeCode, paidAmount, summarize } from '../src/lib/growth-referrals.ts'

const base = () => ({
  referral: { id: 'r1', code: 'MARCUS-7KQ2', customer_id: 'c1', customer_name: 'Marcus Bell', active: true },
  referrer: { id: 'c1', name: 'Marcus Bell', phone: '7135550101', email: 'marcus@example.com' },
  referred: { id: 'c2', name: 'Dana Ruiz', phone: '7135550102', email: 'dana@example.com' },
  document: { id: 'd1', type: 'Invoice', customer_id: 'c2' },
  earlierInvoices: 0,
  documentAlreadyCredited: false,
  customerAlreadyReferred: false,
})

test('a new customer on a real invoice can be credited to the code', () => {
  assert.deepEqual(checkRedemption(base()), { ok: true })
})

test('the owner of a code cannot refer themselves, by id, phone or email', () => {
  assert.equal(checkRedemption({ ...base(), referred: { id: 'c1', name: 'Marcus Bell' } }).code, 'self')
  assert.equal(checkRedemption({ ...base(), referred: { id: 'c9', name: 'Marcus B', phone: '(713) 555-0101' } }).code, 'self')
  assert.equal(checkRedemption({ ...base(), referred: { id: 'c9', name: 'M Bell', email: 'MARCUS@example.com' } }).code, 'self')
})

test('an invoice is credited once, and a customer is referred once', () => {
  assert.equal(checkRedemption({ ...base(), documentAlreadyCredited: true }).code, 'doc_credited')
  assert.equal(checkRedemption({ ...base(), customerAlreadyReferred: true }).code, 'already_referred')
})

test('only a new customer counts', () => {
  const out = checkRedemption({ ...base(), earlierInvoices: 2 })
  assert.equal(out.code, 'not_new')
  assert.match(out.error, /new customer/)
})

test('a missing, switched-off or invoice-less code is refused in plain words', () => {
  assert.equal(checkRedemption({ ...base(), referral: null }).code, 'no_code')
  assert.equal(checkRedemption({ ...base(), referral: { ...base().referral, active: false } }).code, 'inactive')
  assert.equal(checkRedemption({ ...base(), document: null }).code, 'no_invoice')
  assert.equal(checkRedemption({ ...base(), document: { id: 'd1', type: 'Estimate', customer_id: 'c2' } }).code, 'no_invoice')
  assert.equal(checkRedemption({ ...base(), referred: null }).code, 'no_customer')
})

test('codes are compared without case or spaces and must look like a code', () => {
  assert.equal(normalizeCode(' marcus-7kq2 '), 'MARCUS-7KQ2')
  assert.equal(looksLikeCode('marcus-7kq2'), true)
  assert.equal(looksLikeCode('a'), false)
  assert.equal(looksLikeCode('DROP TABLE; --'), false)
})

test('what a referral brought in is what was actually paid', () => {
  assert.equal(paidAmount({ total: 300, amountPaid: 0 }, 'Draft'), 0)
  assert.equal(paidAmount({ total: 300, amountPaid: 120 }, 'Partial'), 120)
  assert.equal(paidAmount({ total: 300, amountPaid: 0 }, 'Paid'), 300)
  assert.equal(paidAmount({ total: 300, amountPaid: 900 }, 'Paid'), 300)
})

test('the summary counts codes, referrals, money and rewards still owed', () => {
  const rows = [
    { id: '1', code: 'MARCUS-7KQ2', referrer_name: 'Marcus Bell', referred_name: 'Dana', document_id: 'd1', reward_given: true, reward_note: null, created_at: 'x', paid: 100, invoice_total: 100 },
    { id: '2', code: 'MARCUS-7KQ2', referrer_name: 'Marcus Bell', referred_name: 'Lee', document_id: 'd2', reward_given: false, reward_note: null, created_at: 'x', paid: 50.5, invoice_total: 80 },
    { id: '3', code: 'ANA-2222', referrer_name: 'Ana', referred_name: 'Sam', document_id: 'd3', reward_given: false, reward_note: null, created_at: 'x', paid: 0, invoice_total: 40 },
  ]
  const s = summarize([{ code: 'MARCUS-7KQ2' }, { code: 'ANA-2222' }, { code: 'NEW-1111' }], rows)
  assert.equal(s.codes, 3)
  assert.equal(s.redeemed, 3)
  assert.equal(s.revenue, 150.5)
  assert.equal(s.rewards_owed, 2)
  assert.equal(s.rewards_given, 1)
  assert.equal(s.top[0].referrer, 'Marcus Bell')
  assert.equal(s.top[0].redeemed, 2)
})
