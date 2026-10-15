import test from 'node:test'
import assert from 'node:assert/strict'
import { simulateTurn } from '../src/lib/voice/simulate.ts'
import { normalizeRules } from '../src/lib/voice/rules.ts'
import { shopFromSettings } from '../src/lib/voice/prompt.ts'

const SHOP = shopFromSettings({ shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', timezone: 'America/Chicago' })
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, { open: true, from: '08:00', to: '17:00' }]).concat([['sat', { open: false, from: '09:00', to: '13:00' }], ['sun', { open: false, from: '09:00', to: '13:00' }]]))
const OPEN = new Date('2026-10-14T15:00:00Z') // Wednesday 10:00 Chicago
const CLOSED = new Date('2026-10-15T03:00:00Z') // Wednesday 22:00 Chicago
const rules = (over = {}) => normalizeRules({ hours, handoff: [{ name: 'Sam', phone: '7135550111' }], notify_email: 'owner@example.com', ...over })
const sim = (over) => simulateTurn({ channel: 'sms', text: '', rules: rules(), shop: SHOP, now: OPEN, model: null, priorAi: 0, ...over })

test('a call that just connected starts with the AI notice and the recording notice', async () => {
  const r = await sim({ channel: 'call' })
  assert.match(r.say, /AI/)
  assert.match(r.say, /recorded/)
  assert.ok(r.rulesFired.includes('ai_disclosure'))
  assert.ok(r.effects.length >= 1)
})

test('after hours the greeting says the shop is closed and effects explain the message-taking', async () => {
  const r = await sim({ channel: 'call', now: CLOSED })
  assert.match(r.say, /closed/i)
  assert.ok(r.effects.some(e => /closed now/.test(e)))
})

test('switching calls off is explained, not hidden', async () => {
  const r = await sim({ channel: 'call', rules: rules({ calls_enabled: false }) })
  assert.ok(r.effects.some(e => /switched off for calls/.test(e)))
})

test('a text reply carries the AI notice and the STOP line on the first message only', async () => {
  const first = await sim({ text: 'my brakes are grinding' })
  assert.match(first.say, /AI/)
  assert.match(first.say, /Reply STOP/)
  assert.ok(first.effects.some(e => /sent as a text/.test(e)))
  const later = await sim({ text: 'John Smith', priorAi: 1, state: first.state })
  assert.doesNotMatch(later.say, /Reply STOP/)
})

test('quiet hours, draft mode and text-off are shown as what would really happen', async () => {
  const quiet = await sim({ text: 'hello there', now: CLOSED })
  assert.equal(quiet.say, '')
  assert.ok(quiet.effects.some(e => /quiet hours/.test(e)))
  const draft = await sim({ text: 'my brakes are grinding', rules: rules({ texts_mode: 'draft' }) })
  assert.ok(draft.say)
  assert.ok(draft.effects.some(e => /draft/.test(e)))
  const off = await sim({ text: 'my brakes are grinding', rules: rules({ texts_mode: 'off' }) })
  assert.equal(off.say, '')
  assert.ok(off.effects.some(e => /switched off/.test(e)))
})

test('a safety problem alerts a person and says who gets the email', async () => {
  const r = await sim({ text: 'my brakes failed and I crashed into a pole', channel: 'call' })
  assert.ok(r.effects.some(e => /alerted/.test(e) && /owner@example\.com/.test(e)))
})

test('asking for a person on a call during open hours transfers to the first handoff number', async () => {
  const r = await sim({ channel: 'call', text: 'let me talk to a real person please' })
  assert.ok(r.effects.some(e => /transferred to Sam/.test(e) && /555-0111/.test(e)))
  assert.equal(r.ended, true)
})

test('the same request after hours takes a message instead of transferring', async () => {
  const r = await sim({ channel: 'call', text: 'let me talk to a real person please', now: CLOSED })
  assert.ok(!r.effects.some(e => /transferred to/.test(e)))
})

test('asking for a price never produces a price', async () => {
  const r = await sim({ channel: 'call', text: 'how much for a brake job' })
  assert.doesNotMatch(r.say, /\$\s*\d|\d+\s*dollars/i)
})

test('a booking request is saved for approval, never put straight on the schedule', async () => {
  let state; let effects = []
  const r = rules({ booking_mode: 'request' })
  for (const t of ['I need an appointment for my brakes', 'tomorrow morning', 'Maria Lopez', '2018 Honda Civic']) {
    const out = await sim({ text: t, state, priorAi: state ? 1 : 0, rules: r })
    state = out.state
    effects = effects.concat(out.effects)
  }
  const saved = effects.filter(e => /booking request would be saved/.test(e))
  assert.equal(saved.length, 1)
  assert.match(saved[0], /Nothing goes on your schedule until you approve it/)
  assert.equal(state.booking.kind, 'request')
})

test('the simulation is pure: no database or network object is needed', async () => {
  const r = await sim({ text: 'stop texting me' })
  assert.ok(r.effects.some(e => /opted out/.test(e)))
})
