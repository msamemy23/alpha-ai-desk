import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../src/lib/posts-rules.ts'

const NOW = Date.parse('2026-10-15T15:00:00Z')
const DAY = 86_400_000

const photo = (over = {}) => ({ ref: 'storage:d1/a.jpg', path: 'shop1/a.jpg', covered: false, label: 'Front brake pads', ...over })
const item = (over = {}) => ({
  id: 'q1', shop_id: 'shop1', job_id: 'j1', source: 'job', state: 'ready', caption: '2018 Toyota Camry finished at Joe’s Auto.', facts: null,
  photos: [photo(), photo({ ref: 'storage:d1/b.jpg', path: 'shop1/b.jpg' }), photo({ ref: 'storage:d1/c.jpg', path: 'shop1/c.jpg' })],
  platforms: ['facebook'], flags: [], made_by: 'alpha', photos_checked_at: '2026-10-14T10:00:00Z', photos_checked_by: 'u1', approved_by: null, approved_at: null,
  decided_by: null, post_at: null, hold_until: '2026-10-15T10:00:00Z', attempt: 0, results: [], metrics: {}, error: null, posted_at: null, created_by: null,
  created_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z', ...over,
})
const autoSettings = (over = {}) => ({ mode: 'auto', weeklyCap: 3, platforms: ['facebook', 'instagram'], ...over })
const autoCtx = (over = {}) => ({ settings: autoSettings(), item: item(), permission: true, jobFinished: true, connected: { facebook: 'connected' }, used: 0, now: NOW, ...over })

/* ---------- settings and modes ---------- */

test('the default is Off with a small weekly limit, and nothing is chosen', () => {
  assert.deepEqual(r.DEFAULT_POST_SETTINGS, { mode: 'off', weeklyCap: 3, platforms: [] })
  assert.deepEqual(r.cleanSettings(null), r.DEFAULT_POST_SETTINGS)
  assert.deepEqual(r.cleanSettings('auto'), r.DEFAULT_POST_SETTINGS)
})

test('settings are cleaned: unknown modes fall back to Off, the limit is kept between 1 and 14, places are checked', () => {
  assert.equal(r.cleanSettings({ mode: 'always' }).mode, 'off')
  assert.equal(r.cleanSettings({ mode: 'auto' }).mode, 'auto')
  assert.equal(r.cleanSettings({ weeklyCap: 0 }).weeklyCap, 1)
  assert.equal(r.cleanSettings({ weeklyCap: 99 }).weeklyCap, 14)
  assert.equal(r.cleanSettings({ weekly_cap: 5 }).weeklyCap, 5)
  assert.equal(r.cleanSettings({ weeklyCap: 'lots' }).weeklyCap, 3)
  assert.deepEqual(r.cleanSettings({ platforms: ['facebook', 'tiktok', 'facebook', 'google', 7] }).platforms, ['facebook', 'google'])
  assert.deepEqual(r.cleanSettings({ platforms: 'facebook' }).platforms, [])
})

test('anything that reaches the public starts in Suggest, and Auto needs a clear yes', () => {
  assert.deepEqual(r.resolveMode('off', 'auto', true), { mode: 'suggest', changed: true, needsConfirm: false, note: 'Posts start in Suggest. Check and approve a few, then switch to Auto.' })
  const ask = r.resolveMode('suggest', 'auto', false)
  assert.deepEqual([ask.mode, ask.changed, ask.needsConfirm], ['suggest', false, true])
  const yes = r.resolveMode('suggest', 'auto', true)
  assert.deepEqual([yes.mode, yes.changed, yes.needsConfirm], ['auto', true, false])
  assert.equal(r.resolveMode('auto', 'auto', false).changed, false)
  assert.equal(r.resolveMode('auto', 'off', false).mode, 'off')
  assert.equal(r.resolveMode('auto', 'suggest', false).mode, 'suggest')
  assert.deepEqual(r.resolveMode('suggest', 'bogus', true), { mode: 'suggest', changed: false, needsConfirm: false, note: '' })
})

test('every mode has plain words and a lamp that is paired with them', () => {
  for (const m of r.POST_MODES) {
    assert.ok(r.MODE_WORDS[m].word && r.MODE_WORDS[m].help && r.MODE_WORDS[m].lamp)
    assert.doesNotMatch(r.MODE_WORDS[m].help, /[\u{1F300}-\u{1FAFF}]/u)
  }
})

/* ---------- what stops a post ---------- */

test('a job post cannot go without the customer’s yes', () => {
  const none = r.blockers(item(), { permission: false })
  assert.deepEqual(none.map(b => b.code), ['no_permission'])
  assert.match(none[0].words, /Customer OK to post/)
  assert.deepEqual(r.blockers(item(), { permission: true }), [])
})

test('when the yes cannot be read, the post is blocked and the words say why', () => {
  const b = r.blockers(item(), { permission: null })
  assert.deepEqual(b.map(x => x.code), ['permission_unknown'])
  assert.match(b[0].words, /database update/)
})

test('a post from a device photo has no job to ask about', () => {
  assert.deepEqual(r.blockers(item({ source: 'device', job_id: null }), { permission: false }), [])
})

test('photos must exist and every one must have been checked', () => {
  assert.deepEqual(r.blockers(item({ photos: [] }), { permission: true }).map(b => b.code), ['no_photos'])
  const half = r.blockers(item({ photos: [photo(), photo({ path: null }), photo({ path: null })] }), { permission: true })
  assert.deepEqual(half.map(b => b.code), ['photos_unchecked'])
  assert.match(half[0].words, /^2 photos still need your check/)
  assert.match(r.blockers(item({ photos: [photo({ path: null })] }), { permission: true })[0].words, /^1 photo still needs/)
  assert.equal(r.photosChecked([]), false)
})

test('words and a place are required, and the words must fit the places chosen', () => {
  assert.deepEqual(r.blockers(item({ caption: '   ' }), { permission: true }).map(b => b.code), ['no_caption'])
  assert.deepEqual(r.blockers(item({ platforms: [] }), { permission: true }).map(b => b.code), ['no_platform'])
  const long = r.blockers(item({ caption: 'a'.repeat(1600), platforms: ['google'] }), { permission: true })
  assert.deepEqual(long.map(b => b.code), ['too_long'])
  assert.deepEqual(r.blockers(item({ caption: 'a'.repeat(1600), platforms: ['facebook'] }), { permission: true }), [])
})

test('only chosen places that are connected can be reached', () => {
  assert.deepEqual(r.reachable(['facebook', 'instagram', 'google'], { facebook: 'connected', instagram: 'not_connected', google: 'unknown' }), ['facebook'])
  assert.deepEqual(r.reachable(['facebook'], {}), [])
})

/* ---------- the weekly limit ---------- */

test('the weekly limit counts posts that went out in the last seven days, from any mode', () => {
  const rows = [
    { state: 'posted', posted_at: new Date(NOW - 1 * DAY).toISOString(), updated_at: '' },
    { state: 'partly_posted', posted_at: new Date(NOW - 6 * DAY).toISOString(), updated_at: '' },
    { state: 'posted', posted_at: new Date(NOW - 8 * DAY).toISOString(), updated_at: '' },
    { state: 'failed', posted_at: null, updated_at: new Date(NOW - 1 * DAY).toISOString() },
    { state: 'skipped', posted_at: null, updated_at: new Date(NOW - 1 * DAY).toISOString() },
    { state: 'posting', posted_at: null, updated_at: new Date(NOW - 60_000).toISOString() },
  ]
  assert.equal(r.usedThisWeek(rows, NOW), 3)
  assert.equal(r.usedThisWeek([], NOW), 0)
})

test('posts this month use the shop’s own calendar month', () => {
  const rows = [
    { state: 'posted', posted_at: '2026-10-02T12:00:00Z' },
    { state: 'posted', posted_at: '2026-09-30T12:00:00Z' },
    { state: 'partly_posted', posted_at: '2026-10-14T12:00:00Z' },
    { state: 'failed', posted_at: null },
    { state: 'posted', posted_at: '2026-11-01T02:00:00Z' }, // 9pm on October 31 in Houston
  ]
  assert.equal(r.postsThisMonth(rows, NOW), 3)
  assert.equal(r.monthKey(Date.parse('2026-11-01T02:00:00Z')), '2026-10')
})

/* ---------- when Auto may post ---------- */

test('Auto posts when every rule holds', () => {
  const d = r.autoDecision(autoCtx())
  assert.deepEqual(d, { ok: true, reasons: [], platforms: ['facebook'] })
})

test('Auto never posts when it is Off or only Suggest', () => {
  for (const mode of ['off', 'suggest']) {
    const d = r.autoDecision(autoCtx({ settings: autoSettings({ mode }) }))
    assert.equal(d.ok, false)
    assert.ok(d.reasons.includes('Auto is not turned on.'))
  }
})

test('Auto needs the customer’s yes, read fresh, and a finished job', () => {
  assert.equal(r.autoDecision(autoCtx({ permission: false })).ok, false)
  assert.equal(r.autoDecision(autoCtx({ permission: null })).ok, false)
  const open = r.autoDecision(autoCtx({ jobFinished: false }))
  assert.equal(open.ok, false)
  assert.ok(open.reasons.includes('The job is not finished yet.'))
})

test('Auto never sends a photo the owner has not checked', () => {
  const d = r.autoDecision(autoCtx({ item: item({ photos: [photo(), photo({ path: null })] }) }))
  assert.equal(d.ok, false)
  assert.match(d.reasons.join(' '), /still needs your check/)
})

test('Auto only sends what Alpha prepared, never an item the owner or Ask Alpha made by hand', () => {
  for (const made_by of ['owner', 'ask_alpha']) assert.equal(r.autoDecision(autoCtx({ item: item({ made_by }) })).ok, false, made_by)
  assert.equal(r.autoDecision(autoCtx({ item: item({ source: 'device', job_id: null }) })).ok, false)
})

test('Auto waits out the review window and holds posts whose wording has flags', () => {
  const early = r.autoDecision(autoCtx({ item: item({ hold_until: new Date(NOW + 3_600_000).toISOString() }) }))
  assert.equal(early.ok, false)
  assert.match(early.reasons.join(' '), /review window/)
  assert.equal(r.autoDecision(autoCtx({ item: item({ flags: ['The wording has an emoji.'] }) })).ok, false)
  assert.equal(r.autoDecision(autoCtx({ item: item({ state: 'needs_review' }) })).ok, false)
})

test('Auto posts only to chosen, connected places', () => {
  const none = r.autoDecision(autoCtx({ connected: { facebook: 'not_connected' } }))
  assert.equal(none.ok, false)
  assert.match(none.reasons.join(' '), /None of the chosen apps is connected/)
  // Instagram is on the post but not in the settings, so it is not used even though it is connected.
  const some = r.autoDecision(autoCtx({ item: item({ platforms: ['facebook', 'google'] }), connected: { facebook: 'connected', google: 'connected' } }))
  assert.deepEqual(some.platforms, ['facebook'])
  assert.equal(some.ok, true)
})

test('Auto stops at the weekly limit', () => {
  assert.equal(r.autoDecision(autoCtx({ used: 2 })).ok, true)
  const d = r.autoDecision(autoCtx({ used: 3 }))
  assert.equal(d.ok, false)
  assert.match(d.reasons.join(' '), /limit of 3 posts is used/)
  assert.match(r.autoDecision(autoCtx({ used: 1, settings: autoSettings({ weeklyCap: 1 }) })).reasons.join(' '), /limit of 1 post is used/)
})

test('the review window is twelve hours from now', () => {
  assert.equal(r.holdUntil(NOW), new Date(NOW + 12 * 3_600_000).toISOString())
})

/* ---------- words for the screen ---------- */

test('every state has a lamp and words', () => {
  const states = ['needs_review', 'ready', 'scheduled', 'posting', 'posted', 'partly_posted', 'failed', 'skipped', 'cancelled']
  for (const state of states) for (const mode of r.POST_MODES) {
    const w = r.stateWords({ state, post_at: null }, mode)
    assert.ok(w.lamp && w.word, `${state}/${mode}`)
  }
  assert.equal(r.stateWords({ state: 'ready' }, 'auto').word, 'Ready, waiting for the review window')
  assert.equal(r.stateWords({ state: 'scheduled' }, 'off').word, 'Scheduled, paused while posts are off')
})

test('a platform result says what happened in plain words', () => {
  assert.deepEqual(r.resultWords({ platform: 'facebook', status: 'posted' }), { lamp: 'green', word: 'Posted to Facebook' })
  assert.deepEqual(r.resultWords({ platform: 'instagram', status: 'not_connected' }), { lamp: 'amber', word: 'Instagram: Not connected' })
  assert.equal(r.resultWords({ platform: 'google', status: 'failed', error: 'Token expired' }).word, 'Google Business Profile: Did not post. Token expired')
  assert.equal(r.resultWords({ platform: 'facebook', status: 'unknown' }).lamp, 'amber')
})

test('who made it and who sent it are always said', () => {
  assert.equal(r.madeByWords('owner'), 'Made by you')
  assert.equal(r.madeByWords('alpha'), 'Prepared by Alpha')
  assert.equal(r.decidedByWords('auto'), 'Sent automatically by your Auto rules')
  assert.equal(r.decidedByWords('owner'), 'Sent after you approved it')
  assert.equal(r.decidedByWords(null), '')
})

/* ---------- undo ---------- */

test('before it goes out a post can be skipped; after, it cannot be undone and the words say how to take it down', () => {
  assert.equal(r.undoInfo({ state: 'ready', results: [], platforms: ['facebook'] }).can, true)
  assert.equal(r.undoInfo({ state: 'scheduled', results: [], platforms: ['facebook'] }).can, true)
  const posted = r.undoInfo({ state: 'posted', platforms: ['facebook', 'instagram'], results: [{ platform: 'facebook', status: 'posted' }, { platform: 'instagram', status: 'posted' }] })
  assert.equal(posted.can, false)
  assert.match(posted.words, /cannot be undone from Alpha/)
  assert.match(posted.words, /Facebook/)
  assert.match(posted.words, /Instagram does not let apps delete/)
  const part = r.undoInfo({ state: 'partly_posted', platforms: ['facebook', 'google'], results: [{ platform: 'facebook', status: 'posted' }, { platform: 'google', status: 'failed' }] })
  assert.doesNotMatch(part.words, /Google Business Profile, find/)
  assert.equal(r.undoInfo({ state: 'failed', results: [{ platform: 'facebook', status: 'unknown' }], platforms: ['facebook'] }).can, false)
  assert.match(r.undoInfo({ state: 'failed', results: [{ platform: 'facebook', status: 'unknown' }], platforms: ['facebook'] }).words, /could not confirm/)
  assert.equal(r.undoInfo({ state: 'failed', results: [{ platform: 'facebook', status: 'failed' }], platforms: ['facebook'] }).words, 'Nothing was posted.')
})

test('the limit sentence reads plainly', () => {
  assert.equal(r.capWords(2, 3), '2 of 3 posts used in the last 7 days.')
  assert.equal(r.capWords(0, 1), '0 of 1 post used in the last 7 days.')
})
