import test from 'node:test'
import assert from 'node:assert/strict'
import * as e from '../src/lib/posts-engine.ts'
import { emptyFacts } from '../src/lib/posts-facts.ts'

const NOW = Date.parse('2026-10-15T15:00:00Z')
const HOUR = 3_600_000
const SHOP = 'shop1'
const clone = x => JSON.parse(JSON.stringify(x))

const facts = (over = {}) => ({ ...emptyFacts({ shopName: 'Joe’s Auto', shopPhone: '(713) 555-0100', city: 'Houston' }), car: '2018 Toyota Camry', engine: '2.5L 4-cylinder', engineSource: 'vin', repairs: ['Replace front brake pads and rotors'], finished: true, ...over })
const goodCaption = '2018 Toyota Camry (2.5L 4-cylinder) finished at Joe’s Auto.\n\nWork done:\n- Replace front brake pads and rotors'
const photo = (n, over = {}) => ({ ref: `storage:d1/${n}.jpg`, path: `${SHOP}/${n}.jpg`, covered: false, label: `Part ${n}`, ...over })
const three = () => [photo(1), photo(2), photo(3)]

function fakeStore({ settings, permissions = {} } = {}) {
  const rows = []
  let n = 0
  let tick = 0
  const stamp = () => new Date(NOW + (tick++) * 1000).toISOString()
  return {
    rows,
    permissions,
    settingsValue: settings || { mode: 'suggest', weeklyCap: 3, platforms: ['facebook'] },
    async list(shopId) { return clone(rows.filter(r => r.shop_id === shopId)).reverse() },
    async get(shopId, id) { const r = rows.find(x => x.shop_id === shopId && x.id === id); return r ? clone(r) : null },
    async insert(row) {
      if (row.job_id && rows.some(r => r.job_id === row.job_id && ['needs_review', 'ready', 'scheduled', 'posting'].includes(r.state))) throw new e.DuplicateOpenItem()
      const r = { ...clone(row), id: `q${++n}`, created_at: stamp(), updated_at: stamp() }
      rows.push(r)
      return clone(r)
    },
    async update(shopId, id, patch, from) {
      const r = rows.find(x => x.shop_id === shopId && x.id === id)
      if (!r || !from.includes(r.state)) return null
      Object.assign(r, clone(patch), { updated_at: stamp() })
      return clone(r)
    },
    async settings() { return clone(this.settingsValue) },
    async permission(_shop, job) { return job in this.permissions ? this.permissions[job] : false },
  }
}

function setup({ settings, permissions = { j1: true, j2: true, j3: true }, conns, publish, prepare, jobs = ['j1', 'j2', 'j3'], finished = true, numbers } = {}) {
  const store = fakeStore({ settings, permissions })
  const calls = { publish: [], prepare: [] }
  const ports = {
    store,
    now: () => NOW,
    async connections() { return conns || { facebook: 'connected', instagram: 'not_connected', google: 'unknown' } },
    async publish(shop, item, platforms) {
      calls.publish.push({ id: item.id, platforms: [...platforms], attempt: item.attempt })
      if (publish) return publish(shop, item, platforms)
      return platforms.map(p => ({ platform: p, status: 'posted', id: `${p}-1`, at: new Date(NOW).toISOString() }))
    },
    async prepare(shop, job, platforms) {
      calls.prepare.push(job)
      if (prepare) return prepare(shop, job, platforms)
      return { ok: true, facts: facts(), caption: goodCaption, photos: three(), note: '', aiUsed: false }
    },
    async candidateJobs() { return jobs },
    async jobFinished() { return finished },
    numbers,
  }
  return { ports, store, calls }
}

const create = (ports, over = {}) => e.createItem(ports, SHOP, { jobId: 'j1', caption: goodCaption, facts: facts(), photos: three(), platforms: ['facebook'], madeBy: 'alpha', createdBy: null, ...over })

/* ---------- cleaning ---------- */

test('only this shop’s own cleaned files can be attached to a post', () => {
  const out = e.cleanPhotos([
    { path: `${SHOP}/a.jpg`, ref: 'storage:d1/a.jpg', label: 'A' },
    { path: 'other-shop/b.jpg', ref: null },
    { path: `${SHOP}/../other/c.jpg`, ref: null },
    { path: `${SHOP}/a.jpg` },
    { ref: 'storage:d1/z.jpg', covered: true },
    'junk', null, { nothing: 1 },
  ], SHOP)
  assert.deepEqual(out.map(p => [p.path, p.ref]), [[`${SHOP}/a.jpg`, 'storage:d1/a.jpg'], [null, 'storage:d1/z.jpg']])
  assert.equal(out[1].covered, true)
  assert.equal(e.cleanPhotos(Array.from({ length: 30 }, (_, i) => ({ path: `${SHOP}/${i}.jpg` })), SHOP).length, 10)
  assert.deepEqual(e.cleanPhotos('nope', SHOP), [])
})

test('the state follows what is known: ready only when nothing blocks and the wording is clean', () => {
  const base = { source: 'job', job_id: 'j1', caption: goodCaption, photos: three(), platforms: ['facebook'], flags: [] }
  assert.equal(e.settle(base, true), 'ready')
  assert.equal(e.settle(base, false), 'needs_review')
  assert.equal(e.settle(base, null), 'needs_review')
  assert.equal(e.settle({ ...base, flags: ['x'] }, true), 'needs_review')
  assert.equal(e.settle({ ...base, photos: [photo(1), photo(2, { path: null })] }, true), 'needs_review')
})

test('a result list folds into one honest state', () => {
  const r = (platform, status) => ({ platform, status })
  assert.equal(e.foldState(['facebook'], [r('facebook', 'posted')], 'ready'), 'posted')
  assert.equal(e.foldState(['facebook', 'instagram'], [r('facebook', 'posted'), r('instagram', 'failed')], 'ready'), 'partly_posted')
  assert.equal(e.foldState(['facebook'], [r('facebook', 'unknown')], 'ready'), 'failed')
  assert.equal(e.foldState(['facebook'], [r('facebook', 'failed')], 'ready'), 'failed')
  assert.equal(e.foldState(['facebook'], [r('facebook', 'not_connected')], 'ready'), 'ready')
  assert.equal(e.foldState(['facebook'], [], 'ready'), 'failed')
})

/* ---------- making a post ---------- */

test('a post about a job cannot be made without the customer’s yes', async () => {
  const { ports, store } = setup({ permissions: { j1: false } })
  const out = await create(ports)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'no_permission')
  assert.match(out.error, /Customer OK to post/)
  assert.equal(store.rows.length, 0)
})

test('when the yes cannot be read, nothing is queued and the words say why', async () => {
  const { ports, store } = setup({ permissions: { j1: null } })
  const out = await create(ports)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'permission_unknown')
  assert.equal(store.rows.length, 0)
})

test('with the yes, checked photos and clean words the post is ready', async () => {
  const { ports } = setup()
  const out = await create(ports)
  assert.equal(out.ok, true)
  assert.equal(out.item.state, 'ready')
  assert.equal(out.item.made_by, 'alpha')
  assert.ok(out.item.photos_checked_at)
  assert.equal(out.item.hold_until, null)
})

test('photos the owner has not checked keep the post at needs review', async () => {
  const { ports } = setup()
  const out = await create(ports, { photos: [photo(1), photo(2, { path: null }), photo(3)] })
  assert.equal(out.ok, true)
  assert.equal(out.item.state, 'needs_review')
  assert.equal(out.item.photos_checked_at, null)
})

test('wording that adds a price or a promise is flagged and kept at needs review', async () => {
  const { ports } = setup()
  const out = await create(ports, { caption: '2018 Toyota Camry brakes done for $199 with a lifetime warranty.' })
  assert.equal(out.ok, true)
  assert.equal(out.item.state, 'needs_review')
  assert.ok(out.item.flags.length >= 1)
})

test('one job never has two posts waiting', async () => {
  const { ports } = setup()
  assert.equal((await create(ports)).ok, true)
  const again = await create(ports)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'busy')
})

test('Auto’s posts wait out a review window before they may go', async () => {
  const { ports } = setup()
  const out = await create(ports, { holdForAuto: true })
  assert.equal(out.item.hold_until, new Date(NOW + 12 * HOUR).toISOString())
})

test('a post made from a device photo has no job to ask about', async () => {
  const { ports } = setup({ permissions: {} })
  const out = await create(ports, { jobId: null, facts: null, madeBy: 'owner', caption: 'Fresh brakes today at Joe’s Auto.' })
  assert.equal(out.ok, true)
  assert.equal(out.item.source, 'device')
  assert.equal(out.item.state, 'ready')
})

test('prepare makes a post from the job and posts nothing', async () => {
  const { ports, calls } = setup()
  const out = await e.prepareJobItem(ports, SHOP, 'j1', { madeBy: 'ask_alpha', userId: 'u1', platforms: ['facebook'] })
  assert.equal(out.ok, true)
  assert.equal(out.item.made_by, 'ask_alpha')
  assert.equal(calls.publish.length, 0)
  const none = setup({ permissions: { j1: false } })
  const refused = await e.prepareJobItem(none.ports, SHOP, 'j1', { madeBy: 'owner', userId: 'u1', platforms: ['facebook'] })
  assert.equal(refused.ok, false)
  assert.equal(none.calls.prepare.length, 0, 'nothing is prepared for a job without the yes')
  const thin = setup({ prepare: () => ({ ok: false, reason: 'Check this job’s photos first.' }) })
  const nope = await e.prepareJobItem(thin.ports, SHOP, 'j1', { madeBy: 'owner', userId: 'u1', platforms: ['facebook'] })
  assert.deepEqual([nope.ok, nope.code, nope.error], [false, 'not_enough', 'Check this job’s photos first.'])
})

/* ---------- editing ---------- */

test('changing the photos takes back the check and any approval', async () => {
  const { ports } = setup()
  const made = await create(ports)
  const out = await e.editItem(ports, SHOP, made.item.id, { photos: [photo(1), photo(2), photo(3), { ref: 'storage:d1/4.jpg', path: null, covered: false, label: 'New' }] }, 'u1')
  assert.equal(out.ok, true)
  assert.equal(out.item.state, 'needs_review')
  assert.equal(out.item.photos_checked_at, null)
  const fixed = await e.editItem(ports, SHOP, made.item.id, { photos: [photo(1), photo(2), photo(3), photo(4)] }, 'u1')
  assert.equal(fixed.item.state, 'ready')
  assert.equal(fixed.item.photos_checked_by, 'u1')
})

test('editing the words checks them again', async () => {
  const { ports } = setup()
  const made = await create(ports)
  const bad = await e.editItem(ports, SHOP, made.item.id, { caption: '2018 Toyota Camry brakes for $99' }, 'u1')
  assert.equal(bad.item.state, 'needs_review')
  assert.ok(bad.item.flags.length > 0)
  const good = await e.editItem(ports, SHOP, made.item.id, { caption: goodCaption }, 'u1')
  assert.equal(good.item.state, 'ready')
  assert.deepEqual(good.item.flags, [])
})

test('a post that already went out cannot be edited', async () => {
  const { ports } = setup()
  const made = await create(ports)
  await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  const out = await e.editItem(ports, SHOP, made.item.id, { caption: 'New words' }, 'u1')
  assert.equal(out.ok, false)
  assert.equal(out.code, 'wrong_state')
})

/* ---------- approving and sending ---------- */

test('approving sends through the connector and records who did it', async () => {
  const { ports, calls } = setup()
  const made = await create(ports, { madeBy: 'owner' })
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, true, out.error)
  assert.equal(out.message, 'Posted to Facebook.')
  assert.equal(out.item.state, 'posted')
  assert.equal(out.item.decided_by, 'owner')
  assert.equal(out.item.approved_by, 'u1')
  assert.equal(out.item.attempt, 1)
  assert.ok(out.item.posted_at)
  assert.deepEqual(calls.publish, [{ id: made.item.id, platforms: ['facebook'], attempt: 1 }])
})

test('Ask Alpha’s approvals are recorded as Ask Alpha', async () => {
  const { ports } = setup()
  const made = await create(ports)
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'ask_alpha' })
  assert.equal(out.item.decided_by, 'ask_alpha')
})

test('the yes is read again when the post goes out: taking it back stops the post', async () => {
  const { ports, store, calls } = setup()
  const made = await create(ports)
  store.permissions.j1 = false
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'no_permission')
  assert.equal(calls.publish.length, 0)
})

test('wording flags stop a post until the owner accepts them', async () => {
  const { ports, calls } = setup()
  const made = await create(ports, { caption: '2018 Toyota Camry brakes. Free inspection!' })
  const stopped = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.deepEqual([stopped.ok, stopped.code], [false, 'flags'])
  assert.equal(calls.publish.length, 0)
  // needs_review because of the flag, and blockers do not include flags, so accepting them lets it through.
  const sent = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' }, { acceptFlags: true })
  assert.equal(sent.ok, true)
})

test('photos that were not checked stop a post even when the owner approves', async () => {
  const { ports, calls } = setup()
  const made = await create(ports, { photos: [photo(1), photo(2, { path: null }), photo(3)] })
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, false)
  assert.equal(out.blockers[0].code, 'photos_unchecked')
  assert.equal(calls.publish.length, 0)
})

test('a place that is not connected is shown as Not connected and nothing is faked', async () => {
  const { ports, calls } = setup()
  const made = await create(ports, { platforms: ['instagram'] })
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'not_connected')
  assert.match(out.error, /Instagram is not connected/)
  assert.match(out.error, /Connected apps/)
  assert.equal(calls.publish.length, 0)
  assert.equal(out.item.state, 'ready', 'the post waits; nothing was posted')
  assert.equal(out.item.results[0].status, 'not_connected')
  assert.equal(out.item.posted_at, null)
})

test('posting to two places where one is not connected is a partial post, in plain words', async () => {
  const { ports, calls } = setup()
  const made = await create(ports, { platforms: ['facebook', 'instagram'] })
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, true)
  assert.equal(out.item.state, 'partly_posted')
  assert.match(out.message, /^Posted to Facebook\. Instagram: Not connected/)
  assert.deepEqual(calls.publish[0].platforms, ['facebook'])
})

test('a failure is a failure, and trying again only goes to the place that missed', async () => {
  let fbOk = false
  const { ports, calls } = setup({
    conns: { facebook: 'connected', instagram: 'connected', google: 'unknown' },
    publish: (_s, _i, platforms) => platforms.map(p => (p === 'instagram' && !fbOk ? { platform: p, status: 'failed', error: 'Token expired', at: '' } : { platform: p, status: 'posted', id: 'x', at: '' })),
  })
  const made = await create(ports, { platforms: ['facebook', 'instagram'] })
  const first = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(first.item.state, 'partly_posted')
  assert.match(first.message, /Instagram: Did not post\. Token expired/)
  fbOk = true
  const again = await e.retryItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(again.ok, true)
  assert.equal(again.item.state, 'posted')
  assert.deepEqual(calls.publish.map(c => c.platforms), [['facebook', 'instagram'], ['instagram']])
  assert.deepEqual(calls.publish.map(c => c.attempt), [1, 2], 'each try uses its own key')
})

test('an unclear answer is shown as unclear and blocks a blind retry until the owner says what they saw', async () => {
  const { ports, calls } = setup({ publish: () => { throw new Error('socket hang up') } })
  const made = await create(ports)
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, false)
  assert.equal(out.item.state, 'failed')
  assert.equal(out.item.results[0].status, 'unknown')
  const blocked = await e.retryItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /cannot tell whether it posted to Facebook/)
  assert.equal(calls.publish.length, 1)
  const said = await e.confirmOutcome(ports, SHOP, made.item.id, 'facebook', 'not_posted')
  assert.equal(said.ok, true)
  assert.equal(said.item.results[0].status, 'failed')
  const retried = await e.retryItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(calls.publish.length, 2)
  assert.equal(retried.ok, false) // the publisher still throws
})

test('the owner can say that it did post, and the post is then counted as posted', async () => {
  const { ports } = setup({ publish: () => { throw new Error('timeout') } })
  const made = await create(ports)
  await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  const said = await e.confirmOutcome(ports, SHOP, made.item.id, 'facebook', 'posted')
  assert.equal(said.item.state, 'posted')
  assert.ok(said.item.posted_at)
  const twice = await e.confirmOutcome(ports, SHOP, made.item.id, 'facebook', 'posted')
  assert.equal(twice.ok, false)
})

test('a double tap sends once', async () => {
  const { ports, calls } = setup()
  const made = await create(ports)
  const [a, b] = await Promise.all([
    e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' }),
    e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' }),
  ])
  assert.equal(calls.publish.length, 1)
  assert.equal([a, b].filter(x => x.ok).length, 1)
})

test('a silent publisher is not read as success', async () => {
  const { ports } = setup({ publish: () => [] })
  const made = await create(ports)
  const out = await e.approveItem(ports, SHOP, made.item.id, { id: 'u1', via: 'owner' })
  assert.equal(out.ok, false)
  assert.equal(out.item.results[0].status, 'unknown')
})

/* ---------- skipping and the customer's yes ---------- */

test('a waiting post can be skipped; a scheduled one is cancelled; one that went out cannot be undone here', async () => {
  const { ports } = setup()
  const a = await create(ports)
  const skipped = await e.skipItem(ports, SHOP, a.item.id)
  assert.equal(skipped.item.state, 'skipped')
  const b = await create(ports)
  const later = await e.approveItem(ports, SHOP, b.item.id, { id: 'u1', via: 'owner' }, { postAt: new Date(NOW + 24 * HOUR).toISOString() })
  assert.equal(later.item.state, 'scheduled')
  const cancelled = await e.skipItem(ports, SHOP, b.item.id)
  assert.equal(cancelled.item.state, 'cancelled')
  const c = await create(ports)
  await e.approveItem(ports, SHOP, c.item.id, { id: 'u1', via: 'owner' })
  const no = await e.skipItem(ports, SHOP, c.item.id)
  assert.equal(no.ok, false)
  assert.match(no.error, /cannot be undone/)
  // A post that was skipped or cancelled never went out, and must not be described as public.
  const again = await e.skipItem(ports, SHOP, a.item.id)
  assert.equal(again.ok, false)
  assert.equal(again.code, 'wrong_state')
  assert.match(again.error, /nothing to skip/)
  assert.match(again.error, /Nothing was posted/)
  assert.doesNotMatch(again.error, /public|cannot be undone/)
  const twice = await e.skipItem(ports, SHOP, b.item.id)
  assert.match(twice.error, /nothing to skip/)
  assert.doesNotMatch(twice.error, /public|cannot be undone/)
})

test('taking the yes back cancels every post for the job that has not gone out', async () => {
  const { ports, store } = setup()
  const a = await create(ports)
  const n = await e.cancelForJob(ports, SHOP, 'j1')
  assert.equal(n, 1)
  assert.equal((await ports.store.get(SHOP, a.item.id)).state, 'cancelled')
  const b = await create(ports)
  await e.approveItem(ports, SHOP, b.item.id, { id: 'u1', via: 'owner' })
  assert.equal(await e.cancelForJob(ports, SHOP, 'j1'), 0)
  assert.equal(store.rows.at(-1).state, 'posted')
})

/* ---------- the scheduled run ---------- */

test('with posts Off the run does nothing at all', async () => {
  const { ports, calls } = setup({ settings: { mode: 'off', weeklyCap: 3, platforms: ['facebook'] } })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.prepared + run.posted, 0)
  assert.equal(calls.prepare.length, 0)
  assert.equal(calls.publish.length, 0)
})

test('Suggest prepares posts for the owner and never sends one', async () => {
  const { ports, calls, store } = setup()
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.prepared, 2, 'two per run')
  assert.equal(calls.publish.length, 0)
  assert.ok(store.rows.every(r => r.made_by === 'alpha' && r.state === 'ready' && r.hold_until === null))
  const next = await e.runShop(ports, SHOP)
  assert.equal(next.prepared, 1, 'no more than three wait at once')
  const last = await e.runShop(ports, SHOP)
  assert.equal(last.prepared, 0)
  assert.match(last.notes.join(' '), /already waiting/)
})

test('a run does not prepare anything until the owner has chosen where posts go', async () => {
  const { ports, calls } = setup({ settings: { mode: 'suggest', weeklyCap: 3, platforms: [] } })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.prepared, 0)
  assert.equal(calls.prepare.length, 0)
  assert.match(run.notes.join(' '), /Choose where posts go/)
})

test('a job that already has a post, or whose yes was taken back, is not prepared again', async () => {
  const { ports, calls } = setup({ permissions: { j1: true, j2: false, j3: true } })
  const first = await create(ports, { jobId: 'j1' })
  assert.equal(first.ok, true)
  await e.runShop(ports, SHOP)
  assert.deepEqual(calls.prepare, ['j3'], 'j1 already has one and j2 has no yes (prepare is never called for it)')
})

test('Auto prepares posts with a review window and does not send them in the same run', async () => {
  const { ports, calls, store } = setup({ settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] } })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.prepared, 2)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
  assert.ok(store.rows.every(r => r.hold_until === new Date(NOW + 12 * HOUR).toISOString()))
})

const readyAlpha = (store, over = {}) => store.insert({
  shop_id: SHOP, job_id: 'j1', source: 'job', state: 'ready', caption: goodCaption, facts: facts(), photos: three(), platforms: ['facebook'], flags: [], made_by: 'alpha',
  photos_checked_at: new Date(NOW - 20 * HOUR).toISOString(), photos_checked_by: 'u1', approved_by: null, approved_at: null, decided_by: null, post_at: null,
  hold_until: new Date(NOW - HOUR).toISOString(), attempt: 0, results: [], metrics: {}, error: null, posted_at: null, created_by: null, ...over,
})

test('Auto sends a ready post once its review window has passed, and records that Auto did it', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] }, jobs: [] })
  await readyAlpha(store)
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 1)
  assert.equal(calls.publish.length, 1)
  assert.equal(store.rows[0].state, 'posted')
  assert.equal(store.rows[0].decided_by, 'auto')
  assert.equal(store.rows[0].approved_by, null)
})

test('Auto waits while the review window is open', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] }, jobs: [] })
  await readyAlpha(store, { hold_until: new Date(NOW + HOUR).toISOString() })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
  assert.match(run.notes.join(' '), /review window/)
})

test('Suggest never sends, even for a post that is ready and old', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'suggest', weeklyCap: 3, platforms: ['facebook'] }, jobs: [] })
  await readyAlpha(store)
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
})

test('Auto never sends a post the owner or Ask Alpha made, or one with unchecked photos or a flag', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 9, platforms: ['facebook'] }, jobs: [], permissions: { j1: true, j2: true, j3: true, j4: true } })
  await readyAlpha(store, { job_id: 'j1', made_by: 'owner' })
  await readyAlpha(store, { job_id: 'j2', made_by: 'ask_alpha' })
  await readyAlpha(store, { job_id: 'j3', photos: [photo(1), photo(2, { path: null })] })
  await readyAlpha(store, { job_id: 'j4', flags: ['The wording has an emoji.'] })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
})

test('Auto stops at the weekly limit, counting posts from any mode', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 2, platforms: ['facebook'] }, jobs: [], permissions: { j1: true, j2: true, j3: true } })
  await readyAlpha(store, { job_id: 'j9', state: 'posted', posted_at: new Date(NOW - 2 * 24 * HOUR).toISOString(), made_by: 'owner' })
  await readyAlpha(store, { job_id: 'j1' })
  await readyAlpha(store, { job_id: 'j2' })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 1, 'one slot left this week')
  assert.equal(calls.publish.length, 1)
  assert.equal(store.rows.filter(r => r.state === 'ready').length, 1)
})

test('Auto does not send for a job whose customer took the yes back, and cancels the post', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] }, jobs: [], permissions: { j1: false } })
  await readyAlpha(store)
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.cancelled, 1)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
  assert.equal(store.rows[0].state, 'cancelled')
})

test('Auto only uses places the owner chose in the settings and that are connected', async () => {
  const { ports, store, calls } = setup({
    settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] }, jobs: [],
    conns: { facebook: 'connected', instagram: 'connected', google: 'connected' },
  })
  await readyAlpha(store, { platforms: ['facebook', 'instagram'] })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 1)
  assert.deepEqual(calls.publish[0].platforms, ['facebook'])
  assert.deepEqual(store.rows[0].platforms, ['facebook'])
})

test('Auto with nothing connected posts nothing and says why', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 3, platforms: ['facebook'] }, jobs: [], conns: { facebook: 'not_connected', instagram: 'not_connected', google: 'not_connected' } })
  await readyAlpha(store)
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 0)
  assert.equal(calls.publish.length, 0)
  assert.match(run.notes.join(' '), /None of the chosen apps is connected/)
  assert.equal(store.rows[0].state, 'ready')
})

test('a post the owner scheduled goes out when it is due, but not while posts are Off', async () => {
  const mk = async mode => {
    const { ports, store, calls } = setup({ settings: { mode, weeklyCap: 3, platforms: ['facebook'] }, jobs: [] })
    await readyAlpha(store, { state: 'scheduled', post_at: new Date(NOW - HOUR).toISOString(), made_by: 'owner', approved_by: 'u1', decided_by: 'owner' })
    const run = await e.runShop(ports, SHOP)
    return { run, calls, store }
  }
  const suggest = await mk('suggest')
  assert.equal(suggest.run.posted, 1)
  assert.equal(suggest.store.rows[0].decided_by, 'owner')
  const off = await mk('off')
  assert.equal(off.run.posted, 0)
  assert.equal(off.calls.publish.length, 0)
})

test('a run sends at most three posts', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'auto', weeklyCap: 14, platforms: ['facebook'] }, jobs: [], permissions: { a: true, b: true, c: true, d: true, e: true } })
  for (const j of ['a', 'b', 'c', 'd', 'e']) await readyAlpha(store, { job_id: j })
  const run = await e.runShop(ports, SHOP)
  assert.equal(run.posted, 3)
  assert.equal(calls.publish.length, 3)
})

/* ---------- numbers ---------- */

test('numbers are only recorded when the app reported them', async () => {
  const none = setup({ numbers: undefined })
  const a = await create(none.ports)
  await e.approveItem(none.ports, SHOP, a.item.id, { id: 'u1', via: 'owner' })
  const said = await e.refreshNumbers(none.ports, SHOP)
  assert.equal(said.updated, 0)
  assert.match(said.message, /did not report/)

  const some = setup({ numbers: async (_s, items) => ({ [items[0].id]: { facebook: { likes: 4, comments: 1, checked_at: 'x' } } }) })
  const b = await create(some.ports)
  await e.approveItem(some.ports, SHOP, b.item.id, { id: 'u1', via: 'owner' })
  const got = await e.refreshNumbers(some.ports, SHOP)
  assert.equal(got.updated, 1)
  assert.deepEqual(some.store.rows[0].metrics.facebook, { likes: 4, comments: 1, checked_at: 'x' })

  const empty = await e.refreshNumbers(setup().ports, SHOP)
  assert.equal(empty.updated, 0)
})

/* ---------- a post whose sender was lost ---------- */

test('a post stuck in "posting" is released as unclear, so nothing is sent twice and the job is not blocked forever', async () => {
  const { ports, store, calls } = setup({ settings: { mode: 'suggest', weeklyCap: 3, platforms: ['facebook'] }, jobs: [] })
  const r = await readyAlpha(store, { state: 'posting', platforms: ['facebook', 'instagram'], results: [{ platform: 'facebook', status: 'posted', id: '1_2', at: '' }] })
  store.rows[0].updated_at = new Date(NOW - 11 * 60_000).toISOString()
  const run = await e.runShop(ports, SHOP)
  assert.match(run.notes.join(' '), /stuck/)
  const row = store.rows.find(x => x.id === r.id)
  assert.equal(row.state, 'partly_posted')
  assert.equal(row.results.find(x => x.platform === 'instagram').status, 'unknown')
  assert.equal(row.results.find(x => x.platform === 'facebook').status, 'posted')
  assert.equal(calls.publish.length, 0)
})

test('a post that started a moment ago is left alone', async () => {
  const { ports, store } = setup({ jobs: [] })
  await readyAlpha(store, { state: 'posting' })
  store.rows[0].updated_at = new Date(NOW - 60_000).toISOString()
  assert.equal(await e.recoverStuck(ports, SHOP), 0)
})
