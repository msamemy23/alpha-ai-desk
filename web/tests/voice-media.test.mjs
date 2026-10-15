import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import {
  checkUpload, isCarrierMediaUrl, isMediaType, isOutgoingMediaType, mediaLabel, newMediaToken, parseCarrierMedia, tokensMatch, MAX_MEDIA_BYTES,
} from '../src/lib/voice/media.ts'
import {
  attachOutgoing, mediaForMessages, outgoingLinks, readByToken, readMedia, saveInboundMedia, storeOutgoing,
} from '../src/lib/voice/media-store.ts'
import { processInboundSms, resetProbeCache } from '../src/lib/voice/sms-pipeline.ts'

const B64 = Buffer.from('fake picture bytes').toString('base64')
const okFetch = (bytes = 'abc') => async () => ({ ok: true, status: 200, headers: { get: n => (n === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => Buffer.from(bytes) })
const badFetch = async () => { throw new Error('network down') }

test('only carrier-hosted https addresses are fetched', () => {
  assert.equal(isCarrierMediaUrl('https://media.telnyx.com/abc.jpg'), true)
  assert.equal(isCarrierMediaUrl('https://telnyx-mms-user-media-prod.s3.amazonaws.com/x.jpg'), true)
  assert.equal(isCarrierMediaUrl('https://s3.amazonaws.com/telnyx-mms-user-media-prod/x.jpg'), true)
  assert.equal(isCarrierMediaUrl('http://media.telnyx.com/abc.jpg'), false)
  assert.equal(isCarrierMediaUrl('https://evil.example.com/telnyx.com/abc.jpg'), false)
  assert.equal(isCarrierMediaUrl('https://telnyx.com.evil.example/abc.jpg'), false)
  assert.equal(isCarrierMediaUrl('https://user:pw@media.telnyx.com/a.jpg'), false)
  assert.equal(isCarrierMediaUrl('https://media.telnyx.com:8443/a.jpg'), false)
  assert.equal(isCarrierMediaUrl('https://s3.amazonaws.com/other-bucket/x.jpg'), false)
  assert.equal(isCarrierMediaUrl('file:///etc/passwd'), false)
  assert.equal(isCarrierMediaUrl(undefined), false)
})

test('carrier media lists are cleaned and capped', () => {
  const raw = [
    { url: 'https://media.telnyx.com/a.jpg', content_type: 'image/jpeg', size: 1200 },
    { url: 'https://media.telnyx.com/b.txt', content_type: 'text/plain' },
    { content_type: 'image/png' },
    null,
    { url: 'https://media.telnyx.com/c.mp4', content_type: 'video/mp4; codecs=avc1', size: 'x' },
    ...Array.from({ length: 10 }, (_, i) => ({ url: `https://media.telnyx.com/${i}.jpg`, content_type: 'image/jpeg' })),
  ]
  const out = parseCarrierMedia(raw)
  assert.equal(out.length, 5)
  assert.deepEqual(out[0], { url: 'https://media.telnyx.com/a.jpg', contentType: 'image/jpeg', sizeBytes: 1200 })
  assert.equal(out[1].contentType, 'video/mp4')
  assert.equal(out[1].sizeBytes, null)
  assert.deepEqual(parseCarrierMedia('nope'), [])
})

test('labels and types', () => {
  assert.equal(mediaLabel(['image/jpeg']), 'Picture')
  assert.equal(mediaLabel(['image/jpeg', 'image/png', 'video/mp4']), '2 pictures and Video')
  assert.equal(isMediaType('image/jpeg'), true)
  assert.equal(isMediaType('application/pdf'), false)
  assert.equal(isOutgoingMediaType('image/svg+xml'), false)
  assert.equal(isOutgoingMediaType('image/jpeg'), true)
})

test('uploads are checked before they are stored', () => {
  assert.equal(checkUpload('image/jpeg', B64).ok, true)
  assert.match(checkUpload('image/svg+xml', B64).error, /cannot be texted/)
  assert.match(checkUpload('image/jpeg', '').error, /empty/)
  assert.match(checkUpload('image/jpeg', 'not base64!!').error, /could not be read/)
  const big = 'A'.repeat(Math.ceil((MAX_MEDIA_BYTES * 4) / 3) + 8)
  assert.match(checkUpload('image/jpeg', big).error, /too big/)
})

test('link tokens are random, long and compared exactly', () => {
  const a = newMediaToken(); const b = newMediaToken()
  assert.notEqual(a, b)
  assert.match(a, /^[0-9a-f]{48}$/)
  assert.equal(tokensMatch(a, a), true)
  assert.equal(tokensMatch(a, b), false)
  assert.equal(tokensMatch(a, a.slice(1)), false)
  assert.equal(tokensMatch('', ''), false)
})

test('inbound pictures: a copy is kept when small, the link is kept when the download fails, other hosts are skipped', async () => {
  const db = makeDb({ tables: { message_media: [] } })
  const media = [
    { url: 'https://media.telnyx.com/a.jpg', contentType: 'image/jpeg', sizeBytes: 3 },
    { url: 'https://evil.example.com/b.jpg', contentType: 'image/jpeg', sizeBytes: 3 },
  ]
  assert.equal(await saveInboundMedia(db, 'shop-a', 'msg-1', '7135550142', media, okFetch('abc')), 1)
  let rows = db.table('message_media')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].data, Buffer.from('abc').toString('base64'))
  assert.equal(rows[0].shop_id, 'shop-a')

  const db2 = makeDb({ tables: { message_media: [] } })
  assert.equal(await saveInboundMedia(db2, 'shop-a', 'msg-2', 'k', [media[0]], badFetch), 1)
  assert.equal(db2.table('message_media')[0].data, null)
  assert.equal(db2.table('message_media')[0].source_url, media[0].url)

  const db3 = makeDb({ tables: {}, missing: ['message_media'] })
  assert.equal(await saveInboundMedia(db3, 'shop-a', 'msg-3', 'k', [media[0]], okFetch()), 0)
})

test('outgoing pictures: stored with a token, linked once, attached to the message, and served only with the exact token', async () => {
  const db = makeDb({ tables: { message_media: [] } })
  const stored = await storeOutgoing(db, 'shop-a', { contentType: 'image/jpeg', base64: B64, contactKey: '7135550142' })
  assert.equal(stored.ok, true)
  const links = await outgoingLinks(db, 'shop-a', [stored.id], 'https://app.example.com')
  assert.equal(links.ok, true)
  assert.match(links.urls[0], new RegExp(`^https://app\\.example\\.com/api/sms/media/${stored.id}\\?t=[0-9a-f]{48}$`))
  const token = new URL(links.urls[0]).searchParams.get('t')
  assert.ok(await readByToken(db, stored.id, token))
  assert.equal(await readByToken(db, stored.id, token.replace(/.$/, c => (c === 'a' ? 'b' : 'a'))), null)
  assert.equal(await readByToken(db, stored.id, ''), null)

  // another shop cannot use it
  const other = await outgoingLinks(db, 'shop-b', [stored.id], 'https://app.example.com')
  assert.equal(other.ok, false)
  // plain http app addresses are refused: carriers need https
  assert.equal((await outgoingLinks(db, 'shop-a', [stored.id], 'http://app.example.com')).ok, false)

  await attachOutgoing(db, 'shop-a', [stored.id], 'msg-9')
  assert.equal(db.table('message_media')[0].message_id, 'msg-9')
  // already attached: cannot be used for a second text
  assert.equal((await outgoingLinks(db, 'shop-a', [stored.id], 'https://app.example.com')).ok, false)

  const listed = await mediaForMessages(db, 'shop-a', ['msg-9'])
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].direction, 'outbound')
  assert.equal((await mediaForMessages(db, 'shop-b', ['msg-9'])).items.length, 0)
})

test('staff can read only their own shop pictures; carrier-hosted ones are fetched from the allowlisted host', async () => {
  const db = makeDb({ tables: { message_media: [
    { id: 'm1', shop_id: 'shop-a', content_type: 'image/jpeg', data: B64, source_url: null, direction: 'inbound' },
    { id: 'm2', shop_id: 'shop-a', content_type: 'image/jpeg', data: null, source_url: 'https://media.telnyx.com/x.jpg', direction: 'inbound' },
    { id: 'm3', shop_id: 'shop-a', content_type: 'image/jpeg', data: null, source_url: 'https://evil.example.com/x.jpg', direction: 'inbound' },
  ] } })
  assert.ok(await readMedia(db, 'shop-a', 'm1', badFetch))
  assert.equal(await readMedia(db, 'shop-b', 'm1', badFetch), null)
  assert.ok(await readMedia(db, 'shop-a', 'm2', okFetch('zz')))
  assert.equal(await readMedia(db, 'shop-a', 'm3', okFetch('zz')), null)
})

/* ---- the text pipeline with pictures ---- */

const NOW = new Date('2026-10-14T15:00:00Z')
const SHOP = { shop_id: 'shop-a', shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', telnyx_phone_number: '+17135550100', shop_email: 'owner@example.com', timezone: 'America/Chicago' }
function pipe({ saveMedia } = {}) {
  resetProbeCache()
  const db = makeDb({ tables: { voice_rules: [], customers: [], messages: [], sms_consents: [] }, missing: ['ai_interactions', 'ai_booking_requests', 'ai_thread_state'] })
  const sent = []
  const deps = {
    db, now: () => NOW, model: null, appUrl: 'https://app.example.com', saveMedia,
    consent: { isOptedOut: async () => false, optOut: async () => {}, optIn: async () => {} },
    send: async (to, text) => { sent.push({ to, text }) }, email: async () => {},
  }
  return { db, deps, sent }
}

test('a picture with no words is saved, answered once, and left for a person', async () => {
  const saved = []
  const { deps, sent, db } = pipe({ saveMedia: async (shopId, messageId, key, media) => { saved.push({ shopId, messageId, key, media }) } })
  const media = [{ url: 'https://media.telnyx.com/a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }]
  const r = await processInboundSms(deps, SHOP, { from: '+17135550142', body: '', messageId: 'p1', media })
  assert.equal(r.reason, 'media_only')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].key, '7135550142')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /got your picture/)
  assert.match(sent[0].text, /AI/)
  assert.equal(db.table('messages').filter(m => m.direction === 'inbound').length, 1)
  // a second picture does not get a second "got your picture"
  await processInboundSms(deps, SHOP, { from: '+17135550142', body: '', messageId: 'p2', media })
  assert.equal(sent.length, 1)
})

test('a failure saving a picture never stops the text from being recorded', async () => {
  const { deps, db } = pipe({ saveMedia: async () => { throw new Error('disk full') } })
  const r = await processInboundSms(deps, SHOP, { from: '+17135550142', body: 'see this', messageId: 'p3', media: [{ url: 'https://media.telnyx.com/a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }] })
  assert.notEqual(r.action, 'ignored')
  assert.equal(db.table('messages').filter(m => m.direction === 'inbound').length, 1)
})
