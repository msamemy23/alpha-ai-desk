import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTelnyxDelivery, recordDelivery } from '../src/lib/automation-delivery.ts'

const notice = (status, extra = {}) => ({ data: { event_type: 'message.finalized', payload: { id: 'msg-1', direction: 'outbound', to: [{ phone_number: '+17135550142', status }], ...extra } } })

test('a delivered text is read from the carrier notice', () => {
  assert.deepEqual(parseTelnyxDelivery(notice('delivered')), { providerMessageId: 'msg-1', status: 'delivered', error: '' })
})

test('a text that did not arrive says why in the carrier\'s words, or a plain default', () => {
  const failed = parseTelnyxDelivery(notice('delivery_failed', { errors: [{ detail: 'Destination is a landline' }] }))
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'Destination is a landline')
  assert.equal(parseTelnyxDelivery(notice('sending_failed')).status, 'failed')
  const unconfirmed = parseTelnyxDelivery(notice('delivery_unconfirmed'))
  assert.equal(unconfirmed.status, 'undelivered')
  assert.match(unconfirmed.error, /could not confirm/)
})

test('inbound texts, other events and junk are ignored', () => {
  assert.equal(parseTelnyxDelivery({ data: { event_type: 'message.received', payload: { id: 'x', direction: 'inbound' } } }), null)
  assert.equal(parseTelnyxDelivery({ data: { event_type: 'message.finalized', payload: { id: 'x', direction: 'inbound', to: [{ status: 'delivered' }] } } }), null)
  assert.equal(parseTelnyxDelivery({ data: { event_type: 'message.finalized', payload: { direction: 'outbound', to: [{ status: 'delivered' }] } } }), null)
  assert.equal(parseTelnyxDelivery(notice('queued')), null)
  assert.equal(parseTelnyxDelivery(null), null)
  assert.equal(parseTelnyxDelivery('nope'), null)
})

function fakeDb({ rows = [], error = null } = {}) {
  const calls = []
  return {
    calls,
    from: () => {
      const f = {}
      const api = {
        update: patch => { calls.push(patch); return api },
        eq: (k, v) => { f[k] = v; return api },
        select: async () => (error ? { data: null, error } : { data: rows.filter(r => r.provider_message_id === f.provider_message_id), error: null }),
      }
      return api
    },
  }
}

test('the carrier answer is written onto the matching message', async () => {
  const db = fakeDb({ rows: [{ id: 'a', provider_message_id: 'msg-1' }] })
  const n = await recordDelivery(db, { providerMessageId: 'msg-1', status: 'delivered', error: '' }, new Date('2026-10-14T20:00:05Z'))
  assert.equal(n, 1)
  assert.equal(db.calls[0].delivery_status, 'delivered')
  assert.equal(db.calls[0].delivered_at, '2026-10-14T20:00:05.000Z')
  const failed = fakeDb({ rows: [{ id: 'a', provider_message_id: 'msg-1' }] })
  await recordDelivery(failed, { providerMessageId: 'msg-1', status: 'failed', error: 'Landline' })
  assert.equal(failed.calls[0].last_error, 'Landline')
  assert.equal(failed.calls[0].delivered_at, undefined)
})

test('a text the shop sent some other way matches nothing and is not an error', async () => {
  assert.equal(await recordDelivery(fakeDb({ rows: [] }), { providerMessageId: 'other', status: 'delivered', error: '' }), 0)
})

test('the history table not existing yet is quiet, any other database error is not', async () => {
  assert.equal(await recordDelivery(fakeDb({ error: { code: '42P01', message: 'missing' } }), { providerMessageId: 'm', status: 'delivered', error: '' }), 0)
  await assert.rejects(recordDelivery(fakeDb({ error: { code: '500', message: 'boom' } }), { providerMessageId: 'm', status: 'delivered', error: '' }), /boom/)
})

test('the text webhook records carrier delivery notices after the signature check, and leaves inbound texts alone', async () => {
  const { readFileSync } = await import('node:fs')
  const route = readFileSync(new URL('../src/app/api/sms/route.ts', import.meta.url), 'utf8')
  const signature = route.indexOf('verifyTelnyxSignature(rawBody')
  const delivery = route.indexOf('parseTelnyxDelivery(body)')
  const inbound = route.indexOf("event.event_type !== 'message.received'")
  assert.ok(signature > 0 && delivery > signature, 'delivery notices are read only after the signature check')
  assert.ok(inbound > delivery, 'the inbound-text path comes after, unchanged')
  assert.match(route, /await recordDelivery\(getServiceClient\(\), delivery\)/)
  // A failure while recording must not turn into an error answer to the carrier.
  assert.match(route, /catch \(e\) \{\s*console\.error\('SMS delivery record error:'[\s\S]*?\}\s*return NextResponse\.json\(\{ ok: true \}\)/)
  assert.match(route, /handleInboundSms\(\{ from, body: text, messageId, toNumber, media, autoResponded \}\)/)
})
