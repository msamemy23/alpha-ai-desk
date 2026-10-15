import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitWithin, cleanImages, MAX_IMAGES } from '../src/lib/ai/images.ts'
import { finalOf, parseNdjsonChunk, toStreamEvent } from '../src/lib/ai/ndjson.ts'
import { suggestPrompts } from '../src/lib/ai/suggestions.ts'
import { normalizeRules } from '../src/lib/ai/shop-rules.ts'

// ------------------------------------------------------------------ photo sizing
test('photos keep their shape, only shrink, and never grow', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1280), { width: 1280, height: 960 })
  assert.deepEqual(fitWithin(3000, 4000, 1280), { width: 960, height: 1280 })
  assert.deepEqual(fitWithin(800, 600, 1280), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(0, 0, 1280), { width: 1, height: 1 })
  assert.deepEqual(fitWithin(4000, 10, 100), { width: 100, height: 1 })
})

test('only a list of small PNG, JPEG, WebP or GIF data URLs is accepted as photos', () => {
  assert.deepEqual(cleanImages(undefined), { images: [] })
  assert.ok(cleanImages('data:image/png;base64,AAAA').error)
  assert.ok(cleanImages(['data:image/svg+xml;base64,AAAA']).error, 'SVG can carry script and is refused')
  assert.ok(cleanImages(['https://example.test/a.png']).error, 'a remote address is never fetched')
  assert.ok(cleanImages(Array(MAX_IMAGES + 1).fill('data:image/png;base64,AAAA')).error)
  assert.equal(cleanImages(['data:image/jpeg;base64,/9j/4AAQ']).images.length, 1)
})

// ------------------------------------------------------------------ live progress stream
const line = event => `${JSON.stringify(event)}\n`

test('progress lines are read as they arrive and a half line waits for the rest', () => {
  const first = line({ type: 'progress', kind: 'status', label: 'Reading your request' }) + '{"type":"progress","kind":"tool","tool":"searchCus'
  const a = parseNdjsonChunk(first)
  assert.equal(a.events.length, 1)
  assert.deepEqual(a.events[0], { type: 'progress', kind: 'status', label: 'Reading your request' })
  const b = parseNdjsonChunk(a.rest + 'tomers","status":"running"}\n')
  assert.deepEqual(b.events, [{ type: 'progress', kind: 'tool', tool: 'searchCustomers', status: 'running' }])
  assert.equal(b.rest, '')
})

test('a damaged or unknown line is dropped, never guessed at', () => {
  const chunk = parseNdjsonChunk('not json\n{"type":"progress","kind":"tool","tool":"x","status":"nope"}\n{"type":"mystery"}\n[1,2]\n\n' + line({ type: 'final', status: 200, body: { reply: 'ok' } }))
  assert.equal(chunk.events.length, 1)
  assert.equal(chunk.events[0].type, 'final')
})

test('progress text is plain: control characters and long text are cleaned', () => {
  const event = toStreamEvent({ type: 'progress', kind: 'status', label: `Line one\n\u0007Line two ${'x'.repeat(300)}` })
  assert.ok(event && event.label.length <= 120 && !/[\u0000-\u001f]/.test(event.label))
})

test('only a final line is an answer; a stream cut short has none', () => {
  const events = parseNdjsonChunk(line({ type: 'progress', kind: 'status', label: 'Working' })).events
  assert.equal(finalOf(events), null)
  const done = parseNdjsonChunk(line({ type: 'progress', kind: 'status', label: 'Working' }) + line({ type: 'final', status: 503, body: { error: 'down' } })).events
  assert.deepEqual(finalOf(done), { type: 'final', status: 503, body: { error: 'down' } })
})

// ------------------------------------------------------------------ suggested prompts
const MONDAY = new Date(2026, 9, 12, 9, 0) // Mon 12 Oct 2026
const FRIDAY = new Date(2026, 9, 16, 15, 0) // Fri 16 Oct 2026
const MID = new Date(2026, 9, 14, 10, 0) // Wed 14 Oct 2026
const MONTH_END = new Date(2026, 9, 29, 10, 0)

test('suggestions follow the shop and the day', () => {
  assert.equal(suggestPrompts({ now: FRIDAY, openJobs: 3 })[0].id, 'owed', 'money owed leads on a Friday afternoon')
  assert.equal(suggestPrompts({ now: MONDAY, openJobs: 0 }).some(item => item.id === 'winback'), true)
  assert.equal(suggestPrompts({ now: MONTH_END, openJobs: 3 })[0].id, 'month', 'the month numbers lead at month end')
  const jobs = suggestPrompts({ now: MID, openJobs: 4 }).find(item => item.id === 'jobs')
  assert.ok(jobs && /4 open/.test(jobs.hint || ''))
  assert.equal(suggestPrompts({ now: MID, openJobs: 0 }).some(item => item.id === 'jobs'), false, 'no question about open jobs when there are none')
  assert.equal(suggestPrompts({ now: MID, openJobs: 0 }).some(item => item.id === 'new-job'), true)
})

test('nothing is suggested that the shop rules switch off', () => {
  const noContact = normalizeRules({ permissions: { send: 'never' } })
  assert.equal(suggestPrompts({ now: MID, rules: noContact, limit: 8 }).some(item => item.id === 'text'), false)
  const noChanges = normalizeRules({ permissions: { save: 'never' } })
  const ids = suggestPrompts({ now: MID, rules: noChanges, openJobs: 0, limit: 8 }).map(item => item.id)
  assert.equal(ids.includes('estimate'), false)
  assert.equal(ids.includes('new-job'), false)
})

test('the owner\'s own recent questions come back as Ask again, once, and never as a copy of a suggestion', () => {
  const list = suggestPrompts({
    now: MID,
    recentAsks: ['What jobs are open right now?', 'how many oil changes did we do last week', 'how many oil changes did we do last week', 'hi'],
  })
  const again = list.filter(item => item.title === 'Ask again')
  assert.equal(again.length, 1, 'the duplicate, the too-short line and the built-in prompt are skipped')
  assert.equal(again[0].prompt, 'how many oil changes did we do last week')
  assert.ok(list.length <= 6)
})

test('repair mode has its own fixed list', () => {
  const list = suggestPrompts({ repairOnly: true })
  assert.equal(list.length, 5)
  assert.ok(list.every(item => item.id.startsWith('repair-')))
})
