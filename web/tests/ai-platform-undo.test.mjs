import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeChange, MAX_DESCRIPTOR_CHARS, parseUndo, planUndo, sameValue, subjectOf,
  undoForCreate, undoForCreatedDocument, undoForDelete, undoForScheduledMessage, undoForUpdate,
} from '../src/lib/ai/undo.ts'

const job = { id: 'job-1', status: 'Pending', customer_name: 'Maria Lopez', vehicle_year: '2016', vehicle_make: 'Honda', vehicle_model: 'Civic', updated_at: '2026-10-15T10:00:00+00:00' }
const jobAfter = { ...job, status: 'In Progress', updated_at: '2026-10-15T10:05:00+00:00' }

test('an update becomes a restore with the old value, the new value and a guard', () => {
  const { undo } = undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: job, after: jobAfter, label: 'Changed job status' })
  const d = parseUndo(undo)
  assert.equal(d.kind, 'restore')
  assert.deepEqual(d.set, { status: 'Pending' })
  assert.deepEqual(d.expect, { status: 'In Progress' })
  assert.deepEqual(d.guard, { column: 'updated_at', value: '2026-10-15T10:05:00+00:00' })
  assert.match(d.summary, /status back to Pending/)
})

test('no undo when nothing changed or the before copy is missing', () => {
  assert.equal(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: job, after: job, label: 'x' }).undo, null)
  assert.match(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: null, after: jobAfter, label: 'x' }).reason, /not saved/)
})

test('only whitelisted fields can ever be restored', () => {
  const before = { id: 'c1', name: 'A', pin: '1234', email: 'a@x.test' }
  const after = { id: 'c1', name: 'B', pin: '9999', email: 'b@x.test' }
  const d = parseUndo(undoForUpdate({ table: 'customers', id: 'c1', fields: ['name', 'pin', 'email'], before, after, label: 'x' }).undo)
  assert.deepEqual(Object.keys(d.set).sort(), ['email', 'name'])
  const forged = JSON.stringify({ v: 1, kind: 'restore', table: 'customers', id: 'c1', set: { shop_id: 'other' }, expect: {}, summary: 's', label: 'l' })
  assert.equal(parseUndo(forged), null)
  assert.equal(parseUndo(JSON.stringify({ v: 1, kind: 'restore', table: 'shop_profiles', id: 'x', set: { a: 1 }, expect: {}, summary: 's', label: 'l' })), null)
  assert.equal(parseUndo('not json'), null)
  assert.equal(parseUndo(null), null)
})

test('a paid document status is never restored, and a text opt-out is never reversed', () => {
  const paid = undoForUpdate({ table: 'documents', id: 'd1', fields: ['status'], before: { status: 'Paid' }, after: { status: 'Void' }, label: 'x' })
  assert.equal(paid.undo, null)
  assert.match(paid.reason, /paid/i)
  const optOut = undoForUpdate({ table: 'customers', id: 'c1', fields: ['sms_opted_out'], before: { sms_opted_out: false }, after: { sms_opted_out: true }, label: 'x' })
  assert.equal(optOut.undo, null)
  const reOptIn = undoForUpdate({ table: 'customers', id: 'c1', fields: ['sms_opted_out'], before: { sms_opted_out: true }, after: { sms_opted_out: false }, label: 'x' })
  assert.ok(reOptIn.undo, 'putting an opt-out back is fine')
  const d = parseUndo(reOptIn.undo)
  assert.equal(planUndo(d, { sms_opted_out: false }).ok, true)
  const forged = parseUndo(JSON.stringify({ ...d, set: { sms_opted_out: false }, expect: { sms_opted_out: true } }))
  assert.equal(planUndo(forged, { sms_opted_out: true }).ok, false)
})

test('a descriptor that is too large is not saved', () => {
  const big = 'x'.repeat(MAX_DESCRIPTOR_CHARS)
  const result = undoForUpdate({ table: 'documents', id: 'd1', fields: ['notes'], before: { notes: big }, after: { notes: 'short' }, label: 'x' })
  assert.equal(result.undo, null)
  assert.match(result.reason, /Too large/)
})

test('planUndo restores when the record is still as the assistant left it', () => {
  const d = parseUndo(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: job, after: jobAfter, label: 'x' }).undo)
  const plan = planUndo(d, jobAfter)
  assert.equal(plan.ok, true)
  assert.equal(plan.op, 'update')
  assert.deepEqual(plan.values, { status: 'Pending' })
  assert.deepEqual(plan.guard, d.guard)
})

test('planUndo refuses to overwrite newer work', () => {
  const d = parseUndo(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: job, after: jobAfter, label: 'x' }).undo)
  const plan = planUndo(d, { ...jobAfter, status: 'Complete' })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'changed')
  assert.deepEqual(plan.fields, ['status'])
  assert.match(plan.message, /newer work/)
})

test('planUndo is safe to repeat: already restored is reported, not repeated', () => {
  const d = parseUndo(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: job, after: jobAfter, label: 'x' }).undo)
  const plan = planUndo(d, { ...job })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'already')
  assert.equal(planUndo(d, null).code, 'missing')
})

test('a created record is removed only while untouched', () => {
  const customer = { id: 'cust-1', name: 'Test Customer', updated_at: '2026-10-15T09:00:00+00:00' }
  const d = parseUndo(undoForCreate({ table: 'customers', row: customer, label: 'Added a customer' }).undo)
  assert.equal(d.kind, 'remove')
  assert.equal(planUndo(d, customer).op, 'delete')
  const edited = planUndo(d, { ...customer, updated_at: '2026-10-15T09:30:00+00:00' })
  assert.equal(edited.ok, false)
  assert.equal(edited.code, 'changed')
  assert.equal(planUndo(d, null).code, 'already')
  assert.equal(undoForCreate({ table: 'documents', row: { id: 'd' }, label: 'x' }).undo, null, 'documents are voided, never deleted')
  assert.equal(undoForCreate({ table: 'inventory', row: { id: 'i' }, label: 'x' }).undo, null)
})

test('a created draft document is voided, keeping its number on record', () => {
  const doc = { id: 'doc-1', type: 'Invoice', doc_number: '1042', customer_name: 'Maria Lopez', status: 'Draft', updated_at: '2026-10-15T09:00:00+00:00' }
  const d = parseUndo(undoForCreatedDocument({ row: doc, label: 'Saved a draft' }).undo)
  assert.deepEqual(d.set, { status: 'Void' })
  assert.match(d.summary, /Invoice #1042 for Maria Lopez/)
  assert.equal(planUndo(d, doc).ok, true)
  assert.equal(planUndo(d, { ...doc, status: 'Paid' }).ok, false)
  assert.equal(planUndo(d, { ...doc, status: 'Partial' }).code, 'changed')
  assert.equal(undoForCreatedDocument({ row: { ...doc, status: 'Sent' }, label: 'x' }).undo, null)
})

test('voiding a document can be put back, but never to a paid status', () => {
  const before = { id: 'd1', status: 'Sent', updated_at: 'a' }
  const after = { id: 'd1', status: 'Void', updated_at: 'b' }
  const d = parseUndo(undoForUpdate({ table: 'documents', id: 'd1', fields: ['status'], before, after, label: 'Voided' }).undo)
  assert.equal(planUndo(d, after).ok, true)
  assert.equal(planUndo(d, { ...after, locked: true }).code, 'blocked')
})

test('a cancelled follow-up only cancels while it is still waiting', () => {
  const d = parseUndo(undoForScheduledMessage({ row: { id: 'sm1', customer_name: 'Maria Lopez', status: 'pending' }, label: 'Scheduled' }).undo)
  assert.equal(planUndo(d, { id: 'sm1', status: 'pending' }).ok, true)
  assert.equal(planUndo(d, { id: 'sm1', status: 'sent' }).code, 'changed')
  assert.equal(planUndo(d, { id: 'sm1', status: 'cancelled' }).code, 'already')
})

test('a deleted appointment is put back from the saved copy, once', () => {
  const row = { id: 'ap1', customer_name: 'Maria Lopez', date: '2026-10-20', time: '09:00', shop_id: 'shop-a' }
  const d = parseUndo(undoForDelete({ table: 'appointments', row, label: 'Deleted' }).undo)
  const plan = planUndo(d, null)
  assert.equal(plan.ok, true)
  assert.equal(plan.op, 'insert')
  assert.equal(planUndo(d, row).code, 'already')
  assert.equal(undoForDelete({ table: 'customers', row, label: 'x' }).undo, null)
})

test('helpers: comparison ignores key order, names read like people talk', () => {
  assert.equal(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true)
  assert.equal(sameValue(null, undefined), true)
  assert.equal(sameValue('1', 1), false)
  assert.equal(subjectOf('jobs', job), 'Maria Lopez - 2016 Honda Civic')
  assert.equal(describeChange(['status'], job, jobAfter), 'status Pending to In Progress')
})
