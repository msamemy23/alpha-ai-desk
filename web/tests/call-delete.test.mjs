import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CAN_DELETE_CALLS, deleteCallRecord, isLiveCall, loadDeletedCallIds, parseTarget, startedMs, withoutDeleted } from '../src/lib/call-delete.ts'
import { fakeDb } from './helpers/leads-fake-db.mjs'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const root = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const SHOP = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const LOG1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const LOG2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const LOG3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const NOW = new Date('2026-10-16T18:00:00Z')

const seed = () => ({
  call_history: [
    { id: LOG1, shop_id: SHOP, call_id: 'rec-100', from_number: '+17135550142' },
    { id: LOG2, shop_id: SHOP, call_id: 'ai-abc', from_number: '+17135550143' },
    { id: LOG3, shop_id: OTHER, call_id: 'rec-100', from_number: '+12815550000' },
  ],
  ai_calls: [
    { id: 'abc', shop_id: SHOP, status: 'ended', started_at: Date.parse('2026-10-16T10:00:00Z') },
    { id: 'live1', shop_id: SHOP, status: 'ringing', started_at: Date.parse('2026-10-16T17:55:00Z') },
    { id: 'zzz', shop_id: SHOP, status: 'ended', started_at: Date.parse('2026-10-15T10:00:00Z') },
  ],
  deleted_calls: [],
})

test('the id the Inbox sends is understood, and nothing else is', () => {
  assert.deepEqual(parseTarget('ai-abc'), { kind: 'ai', aiId: 'abc' })
  assert.deepEqual(parseTarget('ai-v3:Abc_12-x.y'), { kind: 'ai', aiId: 'v3:Abc_12-x.y' })
  assert.deepEqual(parseTarget(LOG1), { kind: 'log', logId: LOG1 })
  for (const bad of ['', '  ', null, undefined, 5, {}, 'ai-', 'ai-../x', 'ai-a b', "ai-x'; drop", 'rec-100', 'not-a-uuid', 'ai-' + 'x'.repeat(300)]) assert.equal(parseTarget(bad), null, String(bad))
})

test('a call is live while the assistant is on it, and a stuck row stops counting after a few hours', () => {
  const now = NOW.getTime()
  assert.equal(isLiveCall('ended', now - 60_000, now), false)
  assert.equal(isLiveCall('completed', now - 60_000, now), false)
  assert.equal(isLiveCall('ringing', now - 5 * 60_000, now), true)
  assert.equal(isLiveCall('active', String(now - 5 * 60_000), now), true)
  assert.equal(isLiveCall('active', Math.floor((now - 5 * 60_000) / 1000), now), true, 'seconds are read as seconds')
  assert.equal(isLiveCall('ringing', now - 5 * 3_600_000, now), false, 'a row nobody finished must still be removable')
  assert.equal(isLiveCall('ringing', null, now), false)
  assert.equal(startedMs('2026-10-16T10:00:00Z'), Date.parse('2026-10-16T10:00:00Z'))
  assert.equal(startedMs('nonsense'), null)
})

test('delete a recording: it goes on the do-not-bring-back list first, then the log row goes, and only this shop is touched', async () => {
  const db = fakeDb(seed())
  const r = await deleteCallRecord(db, SHOP, USER, LOG1, NOW)
  assert.deepEqual(r, { ok: true, removed: { log: 1, ai: 0 }, already: false })
  assert.deepEqual(db.tables.deleted_calls.map(x => [x.shop_id, x.call_id, x.deleted_by]), [[SHOP, 'rec-100', USER]])
  assert.equal(db.tables.call_history.some(x => x.id === LOG1), false)
  assert.equal(db.tables.call_history.some(x => x.id === LOG3), true, 'another shop\'s call with the same id is untouched')
  const order = db.log.filter(l => ['deleted_calls', 'call_history'].includes(l.table) && l.op !== 'select').map(l => `${l.table}.${l.op}`)
  assert.deepEqual(order, ['deleted_calls.upsert', 'call_history.delete'], 'the list is written before anything is removed')
})

test('delete a call only the assistant knows (ai-…): the AI record goes and the id is listed', async () => {
  const db = fakeDb(seed())
  const r = await deleteCallRecord(db, SHOP, USER, 'ai-zzz', NOW)
  assert.deepEqual(r, { ok: true, removed: { log: 0, ai: 1 }, already: false })
  assert.equal(db.tables.ai_calls.some(x => x.id === 'zzz'), false)
  assert.equal(db.tables.ai_calls.length, 2)
  assert.deepEqual(db.tables.deleted_calls.map(x => x.call_id), ['ai-zzz'])
})

test('a log row that is a copy of an AI call takes the AI call with it, so it cannot come back from that side', async () => {
  const db = fakeDb(seed())
  const r = await deleteCallRecord(db, SHOP, USER, LOG2, NOW)
  assert.deepEqual(r, { ok: true, removed: { log: 1, ai: 1 }, already: false })
  assert.equal(db.tables.ai_calls.some(x => x.id === 'abc'), false)
  assert.equal(db.tables.call_history.some(x => x.id === LOG2), false)
  assert.deepEqual(db.tables.deleted_calls.map(x => x.call_id), ['ai-abc'])
})

test('a call the assistant is still on is not deleted, and nothing is written', async () => {
  const db = fakeDb(seed())
  const r = await deleteCallRecord(db, SHOP, USER, 'ai-live1', NOW)
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
  assert.equal(r.code, 'live')
  assert.match(r.error, /still on this call/i)
  assert.equal(db.tables.ai_calls.length, 3)
  assert.equal(db.tables.deleted_calls.length, 0)
})

test('if the do-not-bring-back list cannot be written, nothing is deleted and the owner is told why', async () => {
  const missing = fakeDb(seed(), { fail: { 'deleted_calls.upsert': { code: '42P01', message: 'relation "public.deleted_calls" does not exist' } } })
  const a = await deleteCallRecord(missing, SHOP, USER, LOG1, NOW)
  assert.equal(a.ok, false); assert.equal(a.code, 'needs_update'); assert.equal(a.status, 503)
  assert.match(a.error, /database update/i); assert.match(a.error, /nothing was deleted/i)
  assert.equal(missing.tables.call_history.length, 3)

  const broken = fakeDb(seed(), { fail: { 'deleted_calls.upsert': { code: '57014', message: 'timeout' } } })
  const b = await deleteCallRecord(broken, SHOP, USER, 'ai-zzz', NOW)
  assert.equal(b.ok, false); assert.equal(b.code, 'failed'); assert.equal(b.status, 500)
  assert.equal(broken.tables.ai_calls.length, 3)
  assert.doesNotMatch(b.error, /timeout|57014/)
})

test('a failed delete after the list was written is retryable and says so plainly', async () => {
  const db = fakeDb(seed(), { fail: { 'call_history.delete': { code: 'XX000', message: 'boom' } } })
  const r = await deleteCallRecord(db, SHOP, USER, LOG1, NOW)
  assert.equal(r.ok, false); assert.equal(r.status, 500)
  assert.match(r.error, /try again/i); assert.doesNotMatch(r.error, /boom/)
  // Trying again after the fault clears finishes the job: the list write is idempotent.
  const again = fakeDb({ ...seed(), deleted_calls: [{ shop_id: SHOP, call_id: 'rec-100' }] })
  assert.equal((await deleteCallRecord(again, SHOP, USER, LOG1, NOW)).ok, true)
  assert.equal(again.tables.deleted_calls.length, 1, 'no second entry')
})

test('a call that is already gone, or belongs to another shop, is a quiet success that changes nothing', async () => {
  const db = fakeDb(seed())
  const gone = await deleteCallRecord(db, SHOP, USER, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NOW)
  assert.deepEqual(gone, { ok: true, removed: { log: 0, ai: 0 }, already: true })
  const theirs = await deleteCallRecord(db, SHOP, USER, LOG3, NOW)
  assert.equal(theirs.already, true)
  assert.equal(db.tables.call_history.some(x => x.id === LOG3), true)
  assert.equal(db.tables.deleted_calls.length, 0)
  const bad = await deleteCallRecord(db, SHOP, USER, 'x; drop table', NOW)
  assert.equal(bad.ok, false); assert.equal(bad.status, 400)
})

test('after a delete, the sync skips the call: the log does not fill itself again', async () => {
  const db = fakeDb(seed())
  await deleteCallRecord(db, SHOP, USER, LOG1, NOW)
  const gone = await loadDeletedCallIds(db, SHOP)
  assert.deepEqual([...gone], ['rec-100'])
  const incoming = [{ call_id: 'rec-100' }, { call_id: 'rec-101' }, { call_id: 'activity-7' }]
  assert.deepEqual(withoutDeleted(incoming, gone).map(r => r.call_id), ['rec-101', 'activity-7'])
  assert.equal(withoutDeleted(incoming, new Set()).length, 3)
  assert.deepEqual([...await loadDeletedCallIds(db, OTHER)], [], 'another shop\'s list is separate')
  const unreadable = fakeDb(seed(), { fail: { 'deleted_calls.select': { code: '42P01', message: 'missing' } } })
  assert.equal((await loadDeletedCallIds(unreadable, SHOP)).size, 0)
})

test('the route: only people who run the shop, a capability check for the screen, an audit line without numbers or names', () => {
  const route = src('app/api/delete-call/route.ts')
  assert.deepEqual(CAN_DELETE_CALLS, ['owner', 'admin', 'manager'])
  assert.match(route, /CAN_DELETE_CALLS\.includes\(auth\.role\)\) return forbidden\(\)/)
  assert.match(route, /export async function GET/)
  assert.match(route, /canDelete/)
  assert.match(route, /action: 'call\.delete'/)
  assert.doesNotMatch(route.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), /from_number|to_number|transcript|phone/)
})

test('every place that copies calls into the log skips the deleted ones', () => {
  const sync = src('app/api/telnyx/sync-calls/route.ts')
  assert.equal((sync.match(/loadDeletedCallIds\(db, shopId\)/g) || []).length, 3, 'activities, recordings and AI calls')
  assert.equal((sync.match(/withoutDeleted\(/g) || []).length, 3)
  // No other code writes new rows into call_history.
  const writers = ['app/api/telnyx/sync-recordings/route.ts', 'app/api/telnyx/transcribe-calls/route.ts', 'app/api/growth/import-past-calls/route.ts', 'lib/customers/merge.ts']
  for (const w of writers) assert.doesNotMatch(src(w), /from\('call_history'\)\s*\.(insert|upsert)\(/, w)
})

test('the screen: a Delete button only when allowed, a confirm that says what stays, the row leaves the list at once', () => {
  const detail = src('components/inbox/CallDetail.tsx')
  assert.match(detail, /\{onDelete && \(/)
  assert.match(detail, /Delete this call/)
  const page = src('app/(app)/messages/page.tsx')
  assert.match(page, /fetch\('\/api\/delete-call', \{ headers/)
  assert.match(page, /onDelete=\{canDelete \?/)
  assert.match(page, /method: 'DELETE'/)
  assert.match(page, /setCalls\(prev => prev\.filter\(c => c\.id !== target\.id\)\)/)
  assert.match(page, /<ConfirmSheet/)
  assert.match(page, /This cannot be undone/)
  assert.match(page, /A recording kept by your phone company is not deleted there/)
})

test('the migration adds one closed table and touches nothing else', () => {
  const sql = root('supabase/migrations/061_deleted_calls.sql')
  assert.match(sql, /create table if not exists public\.deleted_calls/)
  assert.match(sql, /primary key \(shop_id, call_id\)/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on table public\.deleted_calls from public, anon, authenticated/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /alter table public\.(?!deleted_calls)|drop |delete from|update public\./i)
})
