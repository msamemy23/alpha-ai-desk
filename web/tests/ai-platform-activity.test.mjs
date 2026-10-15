import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEntries, csvCell, entriesToCsv, filterEntries, summarizeEntries } from '../src/lib/ai/audit-view.ts'
import { undoForUpdate } from '../src/lib/ai/undo.ts'
import { describeUsage, monthRange } from '../src/lib/ai/usage.ts'

const OWNER = 'user-owner'
const names = { 'user-writer': 'Dana Writer' }
const undoText = undoForUpdate({
  table: 'jobs', id: 'job-1', fields: ['status'],
  before: { status: 'Pending', updated_at: 'a' }, after: { status: 'In Progress', updated_at: 'b' }, label: 'Changed',
}).undo

const rows = [
  { id: 'a1', created_at: '2026-10-15T15:00:00Z', user_id: OWNER, action: 'ai.updateJobStatus', target_type: 'job', target_id: 'job-1', permission: 'write', approved: true, metadata: { payload: { id: 'job-1', status: 'In Progress' }, undo: undoText, subject: 'Maria Lopez - 2016 Honda Civic' } },
  { id: 'a2', created_at: '2026-10-15T14:00:00Z', user_id: 'user-writer', action: 'ai.sendEstimateEmail', target_type: 'document', target_id: 'd1', permission: 'write', approved: true, metadata: { payload: { doc_number: '1042', email: 'maria@example.test' } } },
  { id: 'a3', created_at: '2026-10-15T13:00:00Z', user_id: OWNER, action: 'ai.searchCustomers', target_type: null, target_id: null, permission: 'read', approved: true, metadata: { payload: { query: 'lopez' }, result: { customers: [{ name: 'SECRET RESULT BLOB' }] }, success: true } },
  { id: 'a4', created_at: '2026-10-14T13:00:00Z', user_id: null, action: 'automation.update', target_type: 'automation', target_id: 'x', permission: 'write', approved: true, metadata: { automationAction: 'update' } },
  { id: 'a5', created_at: '2026-10-14T12:00:00Z', user_id: OWNER, action: 'sms.send', target_type: 'message', target_id: 'm1', permission: 'external', approved: true, metadata: { to: '+17135550100', length: 82 } },
  { id: 'a6', created_at: '2026-10-14T11:00:00Z', user_id: OWNER, action: 'ai.review.declined', target_type: null, target_id: null, permission: 'write', approved: false, metadata: { summary: 'Declined: Email a document' } },
  { id: 'a7', created_at: '2026-10-13T11:00:00Z', user_id: OWNER, action: 'ai.updateJobStatus', target_type: 'job', target_id: 'job-2', permission: 'write', approved: true, metadata: { payload: { id: 'job-2', status: 'Complete' }, undo: undoText } },
  { id: 'u1', created_at: '2026-10-13T12:00:00Z', user_id: 'user-writer', action: 'ai.undo', target_type: 'job', target_id: 'job-2', permission: 'write', approved: true, metadata: { undoOf: 'a7', summary: 'Put status back to Pending' } },
  { id: 'a8', created_at: '2026-10-12T11:00:00Z', user_id: OWNER, action: 'parts.lookup', target_type: 'parts', target_id: null, permission: 'read', approved: true, metadata: { query: 'front brake pads 2016 Civic' } },
]
const operations = [
  { id: 'op1', user_id: OWNER, action: 'createInvoice', status: 'failed', error: 'Document numbering failed', created_at: '2026-10-15T16:00:00Z' },
  { id: 'op2', user_id: OWNER, action: 'updateInventory', status: 'unknown', error: 'AI action outcome is uncertain', created_at: '2026-10-15T16:30:00Z' },
  { id: 'op3', user_id: OWNER, action: 'createJob', status: 'succeeded', error: null, created_at: '2026-10-15T16:40:00Z' },
]
const entries = buildEntries({ rows, operations, names, ownerId: OWNER, now: Date.parse('2026-10-15T17:00:00Z') })
const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]))

test('every row becomes a plain entry with who, what, when, approval and outcome', () => {
  const entry = byId.a1
  assert.equal(entry.title, 'Changed a job status')
  assert.equal(entry.who, 'Shop owner')
  assert.equal(entry.detail, 'Status set to "In Progress"')
  assert.equal(entry.approvedBy, 'you')
  assert.equal(entry.outcome, 'done')
  assert.equal(entry.sourceLabel, 'Ask assistant')
  assert.equal(byId.a2.who, 'Dana Writer')
  assert.equal(byId.a2.detail, 'Document #1042 to maria@example.test')
  assert.equal(byId.a3.approvedBy, 'not_required')
  assert.equal(byId.a4.source, 'automation')
  assert.equal(byId.a4.approvedBy, 'rule')
  assert.equal(byId.a5.title, 'Sent a text message')
  assert.equal(byId.a5.detail, 'To +17135550100, 82 characters')
  assert.equal(byId.a8.source, 'research')
})

test('entries are newest first and failed or uncertain operations are included', () => {
  const times = entries.map(entry => entry.at)
  assert.deepEqual(times, [...times].sort().reverse())
  assert.equal(byId['op:op1'].outcome, 'failed')
  assert.equal(byId['op:op1'].error, 'Document numbering failed')
  assert.equal(byId['op:op2'].outcome, 'uncertain')
  assert.equal(byId['op:op3'], undefined, 'a succeeded operation already has its audit row')
})

test('undo state: available, undone, cannot', () => {
  assert.equal(byId.a1.undo.state, 'available')
  assert.match(byId.a1.undo.summary, /status back to Pending/)
  assert.equal(byId.a7.undo.state, 'undone')
  assert.equal(byId.a7.undo.undoneBy, 'Dana Writer')
  assert.equal(byId.a2.undo.state, 'cannot')
  assert.match(byId.a2.undo.reason, /email cannot be taken back/i)
  assert.equal(byId.a5.undo.state, 'cannot')
  assert.equal(byId.a3.undo.state, 'none')
})

test('declined reviews are recorded as declined, not done', () => {
  assert.equal(byId.a6.outcome, 'declined')
  assert.equal(byId.a6.approvedBy, 'declined')
})

test('a look-up never exposes the data it read', () => {
  const dump = JSON.stringify(entries)
  assert.doesNotMatch(dump, /SECRET RESULT BLOB/)
})

test('filters: changes only, source, problems, text search, date range', () => {
  assert.equal(filterEntries(entries, { kind: 'changes' }).some(entry => entry.kind === 'read'), false)
  assert.deepEqual(filterEntries(entries, { source: 'automation' }).map(entry => entry.id), ['a4'])
  assert.deepEqual(filterEntries(entries, { outcome: 'problems' }).map(entry => entry.id).sort(), ['op:op1', 'op:op2'])
  assert.deepEqual(filterEntries(entries, { q: 'maria@example' }).map(entry => entry.id), ['a2'])
  assert.deepEqual(filterEntries(entries, { q: 'dana', undo: 'cannot' }).map(entry => entry.id), ['a2'])
  const range = filterEntries(entries, { from: '2026-10-14T00:00:00Z', to: '2026-10-14T23:59:59Z' }).map(entry => entry.id).sort()
  assert.deepEqual(range, ['a4', 'a5', 'a6'])
  assert.equal(filterEntries(entries, {}).length, entries.length)
})

test('summary counts changes, messages and look-ups separately', () => {
  const summary = summarizeEntries(entries)
  assert.equal(summary.problems, 2)
  assert.equal(summary.undone, 1)
  assert.ok(summary.lookups >= 2 && summary.messages >= 2 && summary.changes >= 2)
})

test('csv export quotes cells, blocks spreadsheet formulas and starts with a BOM', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(csvCell('+1 713'), "'+1 713")
  const csv = entriesToCsv(entries)
  assert.ok(csv.startsWith('﻿When (UTC),Who,Source'))
  assert.equal(csv.trimEnd().split('\r\n').length, entries.length + 1)
  assert.match(csv, /Changed a job status/)
  assert.doesNotMatch(csv, /SECRET RESULT BLOB/)
})

test('usage: month range and plain wording', () => {
  const range = monthRange(new Date('2026-10-15T12:00:00Z'))
  assert.equal(range.from, '2026-10-01T00:00:00.000Z')
  assert.equal(range.to, '2026-11-01T00:00:00.000Z')
  assert.equal(range.label, 'October 2026')
  assert.equal(monthRange(new Date('2026-12-31T23:59:59Z')).to, '2027-01-01T00:00:00.000Z')
  const usage = describeUsage({ changes: 12, messages: 1, lookups: 40 })
  assert.equal(usage.total, 53)
  assert.equal(usage.headline, '53 assistant actions')
  assert.equal(usage.breakdown, '12 changes, 1 message and 40 look-ups')
  assert.equal(describeUsage({ changes: 0, messages: 0, lookups: 0 }).breakdown, 'Nothing yet')
  assert.equal(describeUsage({ changes: 1, messages: 0, lookups: 0 }).headline, '1 assistant action')
})
