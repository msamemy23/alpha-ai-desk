import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runPostsTool, summarizeQueue, summarizePhotos, approveBlocked, POSTS_ACTION_ID } from '../src/lib/ai/posts-tools.ts'
import { getActionInfo } from '../src/lib/ai/action-risk.ts'
import { buildActionReview } from '../src/lib/ai/review.ts'
import { ASK_ALPHA_TOOLS } from '../src/lib/posts-api-types.ts'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

const POST_ID = '11111111-1111-4111-8111-111111111111'
const JOB_ID = '22222222-2222-4222-8222-222222222222'

const item = (extra = {}) => ({
  id: POST_ID, state: 'needs_review', state_word: 'Needs your look', title: '2018 Toyota Camry', caption: 'New front brakes on this Camry. Call us for a brake check.',
  platforms: ['facebook', 'google'], photos: [{ ref: 'storage:a/1.jpg', path: 'shop/1.jpg', covered: false, label: 'Front' }, { ref: 'storage:a/2.jpg', path: null, covered: false, label: 'Rear' }],
  flags: [], blockers: [], made_by_words: 'Made by Ask Alpha', post_at: null, ...extra,
})
const queue = (items, settings = {}) => ({ ok: true, available: true, can_edit: true, settings: { mode: 'suggest', weeklyCap: 3, platforms: ['facebook', 'google'], ...settings }, used_this_week: 1, posts_this_month: 4, connections: { facebook: 'connected', instagram: 'not_connected', google: 'connected' }, items, notes: [] })
const brief = (extra = {}) => ({ ok: true, available: true, can_edit: true, job: { job_id: JOB_ID, title: '2018 Toyota Camry', customer: 'Private Name', status: 'Done', finished: true, customer_ok: true, customer_ok_known: true, photo_count: 5, cleared_count: 3, heard_from: '', open_item_id: null, updated_at: '2026-10-14T00:00:00Z', ...extra } })

/** A fake page: answers each route from a table and remembers what was asked. */
function fake(table) {
  const asked = []
  const get = async url => {
    asked.push(url)
    const hit = table[url]
    return hit ? { ok: true, status: 200, data: hit } : { ok: false, status: 404, data: { ok: false, error: 'Not found.' } }
  }
  return { get, asked }
}

test('status reads the queue and tells the model each post id, state and words', async () => {
  const { get, asked } = fake({ '/api/growth/post-queue': queue([item()]) })
  const out = await runPostsTool({ tool: 'posts', action: 'status' }, get)
  assert.equal(out.kind, 'answer')
  assert.deepEqual(asked, ['/api/growth/post-queue'])
  assert.match(out.text, new RegExp(POST_ID))
  assert.match(out.text, /Posting mode: suggest/)
  assert.match(out.text, /Facebook, Google Business Profile/)
  assert.match(out.text, /New front brakes/)
})

test('looking never reaches a customer name or a picture address', () => {
  const photos = summarizePhotos({
    available: true, job: brief().job, caption: 'New brakes.', caption_flags: [], problems: [], proposal_note: '',
    photos: [{ ref: 'storage:a/1.jpg', label: 'Front', url: 'https://signed.example/secret-token', rating: 'green', cleared: { path: 'shop/1.jpg', url: 'https://signed.example/other' }, proposed: true, reason: 'Clear shot' }],
  })
  assert.doesNotMatch(photos, /signed\.example|secret-token/)
  assert.doesNotMatch(photos, /Private Name/)
  assert.match(photos, /picked for the post/)
})

test('a database that is not updated is said plainly, not guessed around', async () => {
  const { get } = fake({ '/api/growth/post-queue': { ok: true, available: false, items: [], settings: {} } })
  const out = await runPostsTool({ action: 'status' }, get)
  assert.equal(out.kind, 'answer')
  assert.match(out.text, /database update/)
})

test('a lookup that fails comes back as a stop with the reason', async () => {
  const { get } = fake({})
  const out = await runPostsTool({ action: 'status' }, get)
  assert.equal(out.kind, 'stop')
  assert.match(out.text, /Not found/)
})

test('an id the model made up is refused before anything is asked', async () => {
  const { get, asked } = fake({})
  for (const call of [{ action: 'approve', id: 'abc' }, { action: 'skip' }, { action: 'prepare', job_id: '1 or 1=1' }, { action: 'photos', job_id: '../../x' }, { action: 'customer_ok_off', job_id: '' }]) {
    const out = await runPostsTool(call, get)
    assert.equal(out.kind, 'stop', JSON.stringify(call))
    assert.match(out.text, /exact .* id/)
  }
  assert.deepEqual(asked, [])
})

test('approve shows the exact words, places and photos, and changes nothing', async () => {
  const { get, asked } = fake({ '/api/growth/post-queue': queue([item()]) })
  const out = await runPostsTool({ action: 'approve', id: POST_ID }, get)
  assert.equal(out.kind, 'review')
  assert.equal(out.actionId, 'posts.approve')
  assert.deepEqual(out.body, { action: 'approve', id: POST_ID })
  assert.equal(out.blocked, '')
  const byLabel = Object.fromEntries(out.rows.map(r => [r.label, r]))
  assert.equal(byLabel['The words'].value, item().caption)
  assert.equal(byLabel['The words'].kind, 'words')
  assert.equal(byLabel['Posts to'].value, 'Facebook, Google Business Profile')
  assert.equal(byLabel.Photos.value, '2 photos, 1 checked by you')
  // Only reads were made: the only route asked was the queue GET.
  assert.deepEqual(asked, ['/api/growth/post-queue'])
})

test('a post with a wording flag, a blocker or the wrong state cannot be approved from the chat', async () => {
  assert.match(approveBlocked(item({ flags: ['mentions a price'] })), /wording check flagged: mentions a price/)
  assert.match(approveBlocked(item({ blockers: [{ code: 'no_permission', words: 'The customer has not said yes.' }] })), /Not ready to post: The customer has not said yes/)
  assert.match(approveBlocked(item({ state: 'posted', state_word: 'Posted' })), /"Posted", so it cannot be sent/)
  assert.equal(approveBlocked(item()), '')
  const { get } = fake({ '/api/growth/post-queue': queue([item({ flags: ['mentions a price'] })]) })
  const out = await runPostsTool({ action: 'approve', id: POST_ID }, get)
  assert.equal(out.kind, 'review')
  assert.notEqual(out.blocked, '')
})

test('a post that is not in the queue is not approved', async () => {
  const { get } = fake({ '/api/growth/post-queue': queue([]) })
  const out = await runPostsTool({ action: 'approve', id: POST_ID }, get)
  assert.equal(out.kind, 'stop')
  assert.match(out.text, /not in the queue/)
})

test('skip shows the post and cannot skip one that already went out', async () => {
  const { get } = fake({ '/api/growth/post-queue': queue([item(), item({ id: '33333333-3333-4333-8333-333333333333', state: 'posted', state_word: 'Posted' })]) })
  const ok = await runPostsTool({ action: 'skip', id: POST_ID }, get)
  assert.equal(ok.kind, 'review')
  assert.deepEqual(ok.body, { action: 'skip', id: POST_ID })
  assert.equal(ok.blocked, '')
  const done = await runPostsTool({ action: 'skip', id: '33333333-3333-4333-8333-333333333333' }, get)
  assert.match(done.blocked, /nothing to skip/)
})

test('Auto can never be turned on from the chat; Off and Suggest go to a card', async () => {
  const { get, asked } = fake({ '/api/growth/post-queue': queue([]) })
  const auto = await runPostsTool({ action: 'mode', mode: 'auto' }, get)
  assert.equal(auto.kind, 'stop')
  assert.match(auto.text, /Only the owner can turn Auto on/)
  const junk = await runPostsTool({ action: 'mode', mode: 'always' }, get)
  assert.equal(junk.kind, 'stop')
  assert.deepEqual(asked, [])
  const off = await runPostsTool({ action: 'mode', mode: 'off', weekly_cap: 2 }, get)
  assert.equal(off.kind, 'review')
  assert.deepEqual(off.body, { action: 'set_settings', mode: 'off', weekly_cap: 2 })
  assert.equal(off.actionId, 'posts.mode')
  const bad = await runPostsTool({ action: 'mode', mode: 'suggest', weekly_cap: 99 }, get)
  assert.equal(bad.kind, 'stop')
})

test('prepare needs the customer yes, and says so on the card instead of trying', async () => {
  const url = `/api/growth/post-photos?job_id=${JOB_ID}&brief=1`
  const yes = await runPostsTool({ action: 'prepare', job_id: JOB_ID }, fake({ [url]: brief() }).get)
  assert.equal(yes.kind, 'review')
  assert.deepEqual(yes.body, { action: 'prepare_job', job_id: JOB_ID })
  assert.equal(yes.blocked, '')
  const no = await runPostsTool({ action: 'prepare', job_id: JOB_ID }, fake({ [url]: brief({ customer_ok: false }) }).get)
  assert.match(no.blocked, /has not said yes/)
  const unknown = await runPostsTool({ action: 'prepare', job_id: JOB_ID }, fake({ [url]: brief({ customer_ok_known: false }) }).get)
  assert.match(unknown.blocked, /database update/)
})

test('the card never carries the customer name', async () => {
  const url = `/api/growth/post-photos?job_id=${JOB_ID}&brief=1`
  const out = await runPostsTool({ action: 'prepare', job_id: JOB_ID }, fake({ [url]: brief() }).get)
  assert.doesNotMatch(JSON.stringify(out), /Private Name/)
})

test('only taking a customer yes away is possible; recording one is not a tool', async () => {
  const url = `/api/growth/post-photos?job_id=${JOB_ID}&brief=1`
  const out = await runPostsTool({ action: 'customer_ok_off', job_id: JOB_ID }, fake({ [url]: brief() }).get)
  assert.equal(out.kind, 'review')
  assert.deepEqual(out.body, { action: 'set_permission', job_id: JOB_ID, ok: false })
  const sneaky = await runPostsTool({ action: 'customer_ok_on', job_id: JOB_ID }, fake({ [url]: brief() }).get)
  assert.equal(sneaky.kind, 'stop')
  assert.match(sneaky.text, /Unknown posts action/)
})

test('a job that is not in the shop is a stop, not a card', async () => {
  const url = `/api/growth/post-photos?job_id=${JOB_ID}&brief=1`
  const out = await runPostsTool({ action: 'prepare', job_id: JOB_ID }, fake({ [url]: { ok: true, available: true, job: {} } }).get)
  assert.equal(out.kind, 'stop')
  assert.match(out.text, /not in your shop/)
})

test('every change is rated in the risk table and only approving a post is irreversible and public', () => {
  for (const id of Object.values(POSTS_ACTION_ID)) assert.notEqual(getActionInfo(id).area, 'Other', id)
  const approve = getActionInfo('posts.approve')
  assert.equal(approve.permission, 'send')
  assert.equal(approve.reversibility, 'irreversible')
  assert.equal(approve.customerFacing, true)
  for (const id of ['posts.prepare', 'posts.skip', 'posts.mode', 'posts.customerOkOff']) assert.equal(getActionInfo(id).permission, 'save', id)
  assert.equal(getActionInfo('posts').permission, 'read')
})

test('the review card uses the looked-up rows and the reason it is blocked', () => {
  const card = buildActionReview({ action: 'posts.approve', kind: 'posts', payload: { action: 'approve', id: POST_ID }, review: { title: 'Post this to the public?', effect: 'Sends it.', rows: [{ label: 'The words', value: 'New brakes.', kind: 'words' }], blocked: 'Not ready.' } })
  assert.equal(card.title, 'Post this to the public?')
  assert.equal(card.rows.length, 1)
  assert.equal(card.rows[0].value, 'New brakes.')
  assert.equal(card.blockedReason, 'Not ready.')
  assert.equal(card.editable, false)
  assert.equal(card.irreversible, true)
  assert.match(card.approveLabel, /post it/)
})

test('every Ask Alpha tool in the posts API contract has a matching branch', () => {
  const names = ASK_ALPHA_TOOLS.map(t => t.name).sort()
  assert.deepEqual(names, ['posts_approve', 'posts_customer_ok_off', 'posts_job', 'posts_jobs', 'posts_photos', 'posts_prepare', 'posts_set_mode', 'posts_skip', 'posts_status'].sort())
})

test('the chat screen wires posts through the review card and the approval header, never straight to the route', () => {
  const page = read('../src/app/(app)/ai/page.tsx')
  assert.match(page, /import \{ runPostsTool \} from '@\/lib\/ai\/posts-tools'/)
  assert.match(page, /parsed\.tool === 'posts'/)
  // A change becomes a pending action; the route is only called from confirmAction.
  assert.match(page, /kind: 'posts', endpoint: '\/api\/growth\/post-queue'/)
  assert.equal((page.match(/\/api\/growth\/post-queue/g) || []).length, 2, 'the route appears once for the card and once in confirmAction')
  assert.match(page, /mode === 'posts'[\s\S]{0,200}requestBody = pendingAction\.payload/)
  assert.match(page, /headers\['X-AI-Approval'\] = 'confirm'/)
  // The social media switch turns the tool off for the assistant.
  assert.match(page, /parsed\.tool === 'posts' && !activeFeatures\.socialMedia/)
  // The model is told what it cannot do.
  assert.match(page, /cannot turn Auto on, record that a customer said yes, or accept a wording flag/)
})

test('the queue summary stays short when the log is long', () => {
  const many = Array.from({ length: 30 }, (_, i) => item({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))
  const text = summarizeQueue(queue(many))
  assert.equal(text.split('\n').filter(l => l.startsWith('- id')).length, 12)
  assert.match(text, /18 older posts not listed/)
})
