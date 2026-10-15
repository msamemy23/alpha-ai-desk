import test from 'node:test'
import assert from 'node:assert/strict'
import * as m from '../src/lib/social-media-publish.ts'
import * as c from '../src/lib/posts-connector.ts'

const AT = '2026-10-15T15:00:00.000Z'

/** A fake provider: records every call and answers from a script. */
function provider(answer) {
  const calls = []
  const f = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    const a = answer(url, body, calls.length)
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.json }
  }
  return { f, calls }
}

/* ---------- photo addresses ---------- */

test('only https addresses are used, without repeats, at most ten', () => {
  assert.deepEqual(m.cleanMediaUrls(['https://a.example/1.jpg', 'http://a.example/2.jpg', 'https://a.example/1.jpg', 7, 'javascript:alert(1)', 'data:image/png;base64,AAA']), ['https://a.example/1.jpg'])
  assert.deepEqual(m.cleanMediaUrls(undefined, 'https://a.example/one.jpg'), ['https://a.example/one.jpg'])
  assert.deepEqual(m.cleanMediaUrls(['https://a.example/2.jpg'], 'https://a.example/1.jpg'), ['https://a.example/1.jpg', 'https://a.example/2.jpg'])
  assert.equal(m.cleanMediaUrls(Array.from({ length: 30 }, (_, i) => `https://a.example/${i}.jpg`)).length, 10)
  assert.deepEqual(m.cleanMediaUrls('nope'), [])
  const given = ['https://a.example/2.jpg']
  m.cleanMediaUrls(given, 'https://a.example/1.jpg')
  assert.deepEqual(given, ['https://a.example/2.jpg'], 'the caller’s list is not changed')
})

/* ---------- Facebook, several photos ---------- */

test('Facebook: each photo is uploaded unpublished, then one post attaches them all', async () => {
  const p = provider((url, body) => (url.endsWith('/photos') ? { status: 200, json: { id: `ph${body.url.slice(-5, -4)}` } } : { status: 200, json: { id: 'PAGE_123' } }))
  const out = await m.fbPostWithPhotos(p.f, 'https://graph.example/v21.0', 'PAGE', 'TOKEN', 'Words', ['https://a.example/1.jpg', 'https://a.example/2.jpg', 'https://a.example/3.jpg'])
  assert.equal(out.ok, true)
  assert.equal(out.data.id, 'PAGE_123')
  assert.equal(p.calls.length, 4)
  assert.deepEqual(p.calls.slice(0, 3).map(x => [x.url, x.body.published]), Array(3).fill(['https://graph.example/v21.0/PAGE/photos', false]))
  const feed = p.calls[3]
  assert.equal(feed.url, 'https://graph.example/v21.0/PAGE/feed')
  assert.deepEqual(feed.body.attached_media, [{ media_fbid: 'ph1' }, { media_fbid: 'ph2' }, { media_fbid: 'ph3' }])
  assert.equal(feed.body.message, 'Words')
})

test('Facebook: if an upload fails nothing is posted', async () => {
  const p = provider((url, _b, n) => (n === 2 ? { status: 400, json: { error: { message: 'Bad image' } } } : { status: 200, json: { id: `ph${n}` } }))
  const out = await m.fbPostWithPhotos(p.f, 'https://g', 'PAGE', 'T', 'Words', ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'])
  assert.equal(out.ok, false)
  assert.equal(out.data.uploaded, 1)
  assert.equal(p.calls.some(x => x.url.endsWith('/feed')), false)
  assert.equal(p.calls.length, 2, 'it stops at the first failure')
})

test('Facebook: an upload that answers without an id is a failure, not a post', async () => {
  const p = provider(() => ({ status: 200, json: {} }))
  const out = await m.fbPostWithPhotos(p.f, 'https://g', 'PAGE', 'T', 'Words', ['https://a/1.jpg', 'https://a/2.jpg'])
  assert.equal(out.ok, false)
  assert.equal(p.calls.some(x => x.url.endsWith('/feed')), false)
})

/* ---------- Instagram carousel ---------- */

test('Instagram: every photo becomes a carousel item, then one carousel holds them', async () => {
  const p = provider((_u, body) => (body.is_carousel_item ? { status: 200, json: { id: `item${p.calls.length}` } } : { status: 200, json: { id: 'CAROUSEL' } }))
  const out = await m.igCreateCarousel(p.f, 'https://g', 'IG', 'T', 'Words', ['https://a/1.jpg', 'https://a/2.jpg'])
  assert.equal(out.ok, true)
  assert.equal(out.data.id, 'CAROUSEL')
  assert.deepEqual(p.calls.slice(0, 2).map(x => x.body.is_carousel_item), [true, true])
  assert.deepEqual(p.calls[2].body, { media_type: 'CAROUSEL', children: ['item1', 'item2'], caption: 'Words', access_token: 'T' })
})

test('Instagram: a failed item stops the carousel', async () => {
  const p = provider((_u, _b, n) => (n === 2 ? { status: 400, json: { error: { message: 'Bad' } } } : { status: 200, json: { id: 'x' } }))
  const out = await m.igCreateCarousel(p.f, 'https://g', 'IG', 'T', 'Words', ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'])
  assert.equal(out.ok, false)
  assert.equal(p.calls.length, 2)
})

test('Google takes one photo', () => {
  assert.deepEqual(m.googleMedia(['https://a/1.jpg', 'https://a/2.jpg']), [{ mediaFormat: 'PHOTO', sourceUrl: 'https://a/1.jpg' }])
  assert.equal(m.googleMedia([]), undefined)
})

/* ---------- the request each connector wants ---------- */

const base = { itemId: 'q1', attempt: 2, shopId: 'shop1', caption: 'Words' }

test('Facebook posts go to the shop’s Page only, never a personal profile', () => {
  const one = c.connectorRequest('facebook', { ...base, photoUrls: ['https://a/1.jpg'] })
  assert.equal(one.path, '/api/connectors/facebook')
  assert.deepEqual(one.body, { action: 'post', message: 'Words', target: 'page', photo_url: 'https://a/1.jpg', shop_id: 'shop1' })
  const many = c.connectorRequest('facebook', { ...base, photoUrls: ['https://a/1.jpg', 'https://a/2.jpg'] })
  assert.equal(many.body.target, 'page')
  assert.deepEqual(many.body.photo_urls, ['https://a/1.jpg', 'https://a/2.jpg'])
  assert.equal('photo_url' in many.body, false)
})

test('Instagram and Google requests use their own field names', () => {
  const ig = c.connectorRequest('instagram', { ...base, photoUrls: ['https://a/1.jpg', 'https://a/2.jpg'] })
  assert.equal(ig.path, '/api/connectors/instagram')
  assert.deepEqual(ig.body.image_urls, ['https://a/1.jpg', 'https://a/2.jpg'])
  assert.equal(ig.body.caption, 'Words')
  const igOne = c.connectorRequest('instagram', { ...base, photoUrls: ['https://a/1.jpg'] })
  assert.equal(igOne.body.image_url, 'https://a/1.jpg')
  const g = c.connectorRequest('google', { ...base, photoUrls: ['https://a/1.jpg', 'https://a/2.jpg'] })
  assert.equal(g.path, '/api/connectors/google-business')
  assert.deepEqual(g.body, { action: 'post', summary: 'Words', photo_url: 'https://a/1.jpg', shop_id: 'shop1' })
})

test('each try has its own key, and the same try always has the same key', () => {
  assert.equal(c.idempotencyKey('q1', 'facebook', 1), 'repair-post:q1:facebook:1')
  assert.notEqual(c.idempotencyKey('q1', 'facebook', 1), c.idempotencyKey('q1', 'facebook', 2))
  assert.notEqual(c.idempotencyKey('q1', 'facebook', 1), c.idempotencyKey('q1', 'instagram', 1))
  assert.equal(c.connectorRequest('facebook', { ...base, photoUrls: [] }).key, 'repair-post:q1:facebook:2')
})

test('Instagram cannot post without a photo', () => {
  assert.match(c.cannotPost('instagram', 0), /at least one photo/)
  assert.equal(c.cannotPost('instagram', 1), null)
  assert.equal(c.cannotPost('facebook', 0), null)
})

/* ---------- reading the answers ---------- */

test('a post is only posted when the connector said ok and gave back an id', () => {
  const fb = { ok: true, data: { page: { ok: true, status: 200, data: { id: '1_2', post_id: '1_2' } }, success: true } }
  assert.deepEqual(c.parseConnectorResult('facebook', 200, fb, AT), { platform: 'facebook', status: 'posted', id: '1_2', at: AT })
  assert.deepEqual(c.parseConnectorResult('instagram', 200, { ok: true, data: { id: '178' } }, AT), { platform: 'instagram', status: 'posted', id: '178', at: AT })
  assert.deepEqual(c.parseConnectorResult('google', 200, { ok: true, data: { name: 'accounts/1/locations/2/localPosts/3' } }, AT).status, 'posted')
  // A replayed answer carries the same result.
  assert.equal(c.parseConnectorResult('google', 200, { ok: true, data: { result: { name: 'x/y' }, replayed: true } }, AT).id, 'x/y')
  assert.equal(c.parseConnectorResult('facebook', 200, { ok: true, replayed: true, data: fb.data }, AT).status, 'posted')
})

test('an ok answer with no id is unclear, not a success', () => {
  const r = c.parseConnectorResult('facebook', 200, { ok: true, data: { page: { ok: true, data: {} } } }, AT)
  assert.equal(r.status, 'unknown')
  assert.match(r.error, /did not return an id/)
  assert.equal(c.parseConnectorResult('instagram', 200, { ok: true, data: {} }, AT).status, 'unknown')
  assert.equal(c.parseConnectorResult('instagram', 200, 'not json', AT).status, 'unknown')
  assert.equal(c.parseConnectorResult('instagram', 200, null, AT).status, 'unknown')
})

test('a connector that is not connected or needs reconnecting says so', () => {
  const r = c.parseConnectorResult('facebook', 401, { ok: false, error: 'Facebook not connected' }, AT)
  assert.deepEqual([r.status, r.platform], ['not_connected', 'facebook'])
  assert.match(r.error, /Connected apps/)
  assert.equal(c.parseConnectorResult('google', 401, { ok: false, error: 'Failed to refresh Google token. Please reconnect Google.' }, AT).status, 'not_connected')
  assert.equal(c.parseConnectorResult('instagram', 400, { ok: false, error: 'Instagram account not configured — please reconnect Facebook/Instagram' }, AT).status, 'not_connected')
})

test('uncertain answers stay uncertain and block a blind retry', () => {
  for (const error of [
    'Facebook request outcome is uncertain; reconcile the provider result before retrying',
    'This publishing action is already in progress',
    'Instagram accepted publication without a confirmed media id',
    'The external action outcome is uncertain because its durable status could not be saved',
    'Idempotency key was used for different publish content',
  ]) assert.equal(c.parseConnectorResult('facebook', 502, { ok: false, error }, AT).status, 'unknown', error)
  assert.equal(c.parseConnectorResult('facebook', 503, { ok: false }, AT).status, 'unknown')
})

test('a clear refusal is a failure with the platform’s own words', () => {
  const error = JSON.stringify({ summary: 'No post was confirmed by Facebook', page: { ok: false, status: 400, data: { error: { message: 'Invalid image URL' } } } })
  const r = c.parseConnectorResult('facebook', 502, { ok: false, error }, AT)
  assert.deepEqual([r.status, r.error], ['failed', 'Invalid image URL'])
  assert.equal(c.parseConnectorResult('google', 400, { ok: false, error: 'summary required' }, AT).error, 'summary required')
  assert.match(c.parseConnectorResult('instagram', 429, { ok: false }, AT).error, /slow down/)
})

test('a request that got no answer may or may not have posted, and says to check', () => {
  const r = c.noAnswer('facebook', 'The request timed out.', AT)
  assert.equal(r.status, 'unknown')
  assert.match(r.error, /Check Facebook before trying again/)
})

/* ---------- is a place connected? ---------- */

test('a place counts as connected only when the connector route would have what it needs', () => {
  assert.equal(c.connectorReady('facebook', { enabled: true, page_id: 'p', page_access_token: 't' }), true)
  assert.equal(c.connectorReady('facebook', { enabled: true, page_id: 'p', page_access_token: null }), false)
  assert.equal(c.connectorReady('facebook', { enabled: false, page_id: 'p', page_access_token: 't' }), false)
  assert.equal(c.connectorReady('instagram', { enabled: true, page_id: 'ig', access_token: 't' }), true)
  assert.equal(c.connectorReady('instagram', { enabled: true, page_id: null, access_token: 't' }), false)
  assert.equal(c.connectorReady('google', { enabled: true, refresh_token: 'r' }), true)
  assert.equal(c.connectorReady('google', { enabled: true }), false)
  assert.equal(c.connectorReady('google', null), false)
})

/* ---------- numbers ---------- */

test('numbers are taken only for posts Alpha sent and only when the app reported them', () => {
  const fb = { ok: true, data: { data: [
    { id: '1_2', likes: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } },
    { id: '1_9', likes: { summary: { total_count: 99 } } },
    { id: '1_3' },
  ] } }
  const got = c.numbersFrom('facebook', fb, ['1_2', '1_3', '1_404'], AT)
  assert.deepEqual(got['1_2'], { likes: 7, comments: 2, checked_at: AT })
  assert.deepEqual(got['1_3'], { likes: null, comments: null, checked_at: AT })
  assert.equal('1_9' in got, false, 'not one of ours')
  assert.equal('1_404' in got, false, 'not listed by the app, so not recorded')
  const ig = { ok: true, data: { data: [{ id: '178', like_count: 12, comments_count: 3 }] } }
  assert.deepEqual(c.numbersFrom('instagram', ig, ['178'], AT)['178'], { likes: 12, comments: 3, checked_at: AT })
  assert.deepEqual(c.numbersFrom('google', ig, ['178'], AT), {}, 'Google does not report numbers')
  assert.deepEqual(c.numbersFrom('facebook', null, ['1_2'], AT), {})
})
