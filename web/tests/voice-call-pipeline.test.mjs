import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import { handleCallEvent, splitConversation } from '../src/lib/voice/call-pipeline.ts'
import { resetProbeCache } from '../src/lib/voice/sms-pipeline.ts'

const NOW = new Date('2026-10-14T15:00:00Z') // Wednesday 10:00 in Chicago
const NIGHT = new Date('2026-10-15T03:00:00Z') // Wednesday 10:00 pm
const SHOP = { shop_id: 'shop-a', shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', telnyx_phone_number: '+17135550100', shop_email: 'owner@example.com', timezone: 'America/Chicago' }
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, { open: true, from: '08:00', to: '17:00' }]).concat([['sat', { open: false, from: '09:00', to: '13:00' }], ['sun', { open: false, from: '09:00', to: '13:00' }]]))
const UNIQUE = { ai_interactions: [['shop_id', 'channel', 'ref_id']], ai_booking_requests: [['shop_id', 'interaction_id']] }
const CALLER = '+17135550142'

function setup({ rules = {}, now = NOW, model = null, missing = [], tables = {} } = {}) {
  resetProbeCache()
  const db = makeDb({ tables: { voice_rules: [{ shop_id: 'shop-a', rules: { hours, ...rules } }], ai_calls: [], customers: [], messages: [], sms_consents: [], ...tables }, unique: UNIQUE, missing })
  const emails = []
  const texts = []
  const consent = { async isOptedOut(shopId, phone) { const d = String(phone).replace(/\D/g, '').slice(-10); return db.table('sms_consents').some(r => r.phone_digits === d && r.opted_out) } }
  const clock = { now }
  const deps = {
    db, now: () => clock.now, model, appUrl: 'https://app.example.com', consent,
    email: async m => { emails.push(m) },
    sendText: async (to, text, o) => { texts.push({ to, text, key: o.idempotencyKey }) },
    signState: d => `signed:${JSON.stringify(d)}`,
  }
  let n = 0
  const ev = (type, payload = {}, extra = {}) => ({ type, callId: 'call-1', eventId: `e-${++n}`, payload, ...extra })
  const run = (type, payload, extra) => handleCallEvent(deps, SHOP, ev(type, payload, extra))
  const say = (text, track) => run('call.transcription', { transcription_data: { transcript: text, is_final: true, ...(track ? { track } : {}) } })
  const row = () => db.table('ai_calls')[0]
  return { db, deps, emails, texts, run, say, row, clock }
}

async function answer(s) {
  await s.run('call.initiated', { direction: 'incoming', from: CALLER, to: '+17135550100' })
  return s.run('call.answered', { direction: 'incoming', from: CALLER, to: '+17135550100' })
}

const speakText = r => r.commands.find(c => c.type === 'speak')?.text || ''

test('an incoming call is answered and a row is created for the right shop', async () => {
  const s = setup()
  const r = await s.run('call.initiated', { direction: 'incoming', from: CALLER, to: '+17135550100' })
  assert.deepEqual(r.commands, [{ type: 'answer' }])
  assert.equal(s.row().shop_id, 'shop-a')
  assert.match(s.row().task, /^Inbound call from \+17135550142/)
  assert.doesNotMatch(s.row().task, /alpha/i)
})

test('a call from the shop\'s own number is hung up on (no loops)', async () => {
  const s = setup()
  const r = await s.run('call.initiated', { direction: 'incoming', from: '+17135550100', to: '+17135550100' })
  assert.deepEqual(r.commands, [{ type: 'hangup' }])
  assert.equal(s.db.table('ai_calls').length, 0)
})

test('the greeting says it is an AI and gives the recording notice, and recording and transcription start', async () => {
  const s = setup()
  const r = await answer(s)
  const types = r.commands.map(c => c.type)
  assert.deepEqual(types, ['transcription_start', 'record_start', 'speak'])
  const g = speakText(r)
  assert.match(g, /Thanks for calling Test Auto Care/)
  assert.match(g, /AI/)
  assert.match(g, /may be recorded/)
  assert.doesNotMatch(g, /closed right now/)
  const interaction = s.db.table('ai_interactions')[0]
  assert.equal(interaction.channel, 'call')
  assert.ok(interaction.rules_fired.includes('ai_disclosure'))
  assert.ok(interaction.rules_fired.includes('recording_notice'))
  const again = await s.run('call.answered', { direction: 'incoming', from: CALLER })
  assert.deepEqual(again.commands, [], 'a repeated event does nothing')
})

test('after hours the greeting says so', async () => {
  const s = setup({ now: NIGHT })
  const r = await answer(s)
  assert.match(speakText(r), /closed right now/)
})

test('a normal call: details are collected, the call is summarised, the team is emailed, the caller is texted once', async () => {
  const s = setup()
  await answer(s)
  assert.match(speakText(await s.say('my brakes are grinding when I stop')), /name/i)
  assert.match(speakText(await s.say('John Smith')), /year, make and model/i)
  assert.match(speakText(await s.say('2015 Honda Civic')), /ending in 0 1 4 2/)
  const close = speakText(await s.say('yes that is right'))
  assert.match(close, /anything else/i)
  const bye = await s.say('no that is all')
  assert.match(speakText(bye), /Goodbye/)
  const ended = await s.run('call.speak.ended', {})
  assert.deepEqual(ended.commands, [{ type: 'hangup' }])
  const hang = await s.run('call.hangup', {})
  assert.equal(hang.note, 'call wrapped up')
  assert.equal(s.row().status, 'ended')
  assert.match(s.row().summary, /John Smith/)
  const interaction = s.db.table('ai_interactions')[0]
  assert.equal(interaction.outcome, 'message_taken')
  assert.equal(interaction.captured.vehicle, '2015 Honda Civic')
  assert.ok(interaction.ended_at)
  assert.equal(s.emails.length, 1)
  assert.match(s.emails[0].subject, /Call summary/)
  assert.equal(s.emails[0].to, 'owner@example.com')
  assert.equal(s.texts.length, 1)
  assert.match(s.texts[0].text, /virtual assistant/)
  assert.match(s.texts[0].text, /STOP/)
  // the same hangup arriving twice changes nothing
  await s.run('call.hangup', {})
  assert.equal(s.emails.length, 1)
  assert.equal(s.texts.length, 1)
})

test('the assistant\'s own voice and repeated events are not treated as the caller', async () => {
  const s = setup()
  const g = speakText(await answer(s))
  assert.equal((await s.say(g)).note, 'echo of the assistant')
  assert.equal((await s.say('please call me back', 'outbound')).note, 'the assistant\'s own voice')
  const first = await s.run('call.transcription', { transcription_data: { transcript: 'my truck will not start', is_final: true } }, { eventId: 'same' })
  assert.equal(first.note, 'replied')
  const second = await s.run('call.transcription', { transcription_data: { transcript: 'my truck will not start', is_final: true } }, { eventId: 'same' })
  assert.equal(second.note, 'duplicate event')
  assert.equal((await s.run('call.transcription', { transcription_data: { transcript: 'partial words', is_final: false } })).commands.length, 0)
})

test('only one sentence is processed at a time', async () => {
  const s = setup()
  await answer(s)
  s.row().processing = true
  assert.equal((await s.say('my truck will not start')).note, 'still busy with the last sentence')
  s.row().processing = false
  assert.equal((await s.say('my truck will not start')).note, 'replied')
  assert.equal(s.row().processing, false)
})

test('a safety problem during open hours: say so, then transfer after the words finish, with a briefing text', async () => {
  const s = setup({ rules: { handoff: [{ name: 'Sam', phone: '713-555-0199' }, { name: 'Lee', phone: '713-555-0188' }] } })
  await answer(s)
  const r = await s.say('my brakes went to the floor on the freeway')
  const said = speakText(r)
  assert.match(said, /connecting you/)
  assert.match(said, /911/)
  assert.equal(r.commands.some(c => c.type === 'transfer'), false, 'does not cut the sentence short')
  const done = await s.run('call.speak.ended', {})
  const t = done.commands.find(c => c.type === 'transfer')
  assert.equal(t.to, '+17135550199')
  assert.match(t.clientState, /"parent":"call-1"/)
  assert.equal(s.texts.length, 1)
  assert.equal(s.texts[0].to, '+17135550199')
  assert.match(s.texts[0].text, /\(713\) 555-0142/)
  assert.match(s.texts[0].text, /Safety problem/)
  const interaction = s.db.table('ai_interactions')[0]
  assert.equal(interaction.needs_person, true)
  assert.equal(s.emails.length, 1)
  assert.match(s.emails[0].subject, /Needs a person/)
  // nothing more is said by the assistant once a person has the call
  assert.equal((await s.say('hello is anyone there')).note, 'call handed to a person')
  // the first person answers
  await s.run('call.answered', {}, { callId: 'leg-b', transferParent: 'call-1' })
  assert.equal(s.db.table('ai_interactions')[0].outcome, 'transferred')
  await s.run('call.hangup', {})
  assert.equal(s.db.table('ai_interactions')[0].outcome, 'transferred')
})

test('if the first person does not answer, the next one is tried, then the assistant takes over again', async () => {
  const s = setup({ rules: { handoff: [{ name: 'Sam', phone: '713-555-0199' }, { name: 'Lee', phone: '713-555-0188' }] } })
  await answer(s)
  await s.say('I was in an accident and need help')
  await s.run('call.speak.ended', {})
  const next = await s.run('call.hangup', { hangup_cause: 'timeout' }, { callId: 'leg-b', transferParent: 'call-1' })
  assert.equal(next.commands[0].to, '+17135550188')
  const last = await s.run('call.hangup', { hangup_cause: 'timeout' }, { callId: 'leg-c', transferParent: 'call-1' })
  const line = last.commands.find(c => c.type === 'speak')
  assert.equal(line.callId, 'call-1')
  assert.match(line.text, /not able to reach anyone/)
  assert.match(line.text, /Goodbye/)
  const { meta } = splitConversation(s.row().conversation)
  assert.equal(meta.state.transferred, false)
  assert.equal(meta.after, 'hangup')
  assert.equal(s.db.table('ai_interactions')[0].needs_person, true)
})

test('after hours a safety problem is not transferred: a message is taken and the team is emailed', async () => {
  const s = setup({ now: NIGHT, rules: { handoff: [{ name: 'Sam', phone: '713-555-0199' }] } })
  await answer(s)
  const r = await s.say('my brakes went to the floor on the freeway')
  assert.doesNotMatch(speakText(r), /connecting you/)
  assert.match(speakText(r), /marked this as urgent/)
  assert.match(speakText(r), /911/)
  assert.equal(s.emails.length, 1)
  assert.equal((await s.run('call.speak.ended', {})).commands[0].type, 'hangup')
})

test('transfer can be switched off', async () => {
  const s = setup({ rules: { transfer_when_open: false, handoff: [{ name: 'Sam', phone: '713-555-0199' }] } })
  await answer(s)
  const r = await s.say('let me talk to a real person')
  assert.doesNotMatch(speakText(r), /connecting you/)
})

test('sales and spam calls are ended politely', async () => {
  const s = setup()
  await answer(s)
  const r = await s.say('this is about your vehicle extended warranty which is about to expire')
  assert.match(speakText(r), /not interested/)
  assert.equal((await s.run('call.speak.ended', {})).commands[0].type, 'hangup')
  await s.run('call.hangup', {})
  assert.equal(s.db.table('ai_interactions')[0].outcome, 'spam')
  assert.equal(s.emails.length, 0)
  assert.equal(s.texts.length, 0)
})

test('with the assistant switched off, a call goes to the first person, or to a recorded message', async () => {
  const forward = setup({ rules: { calls_enabled: false, handoff: [{ name: 'Sam', phone: '713-555-0199' }] } })
  await forward.run('call.initiated', { direction: 'incoming', from: CALLER })
  const r = await forward.run('call.answered', { direction: 'incoming', from: CALLER })
  assert.equal(r.commands.find(c => c.type === 'transfer').to, '+17135550199')
  assert.equal(r.commands.some(c => c.type === 'speak'), false)
  // nobody answers: it becomes a voicemail
  const fail = await forward.run('call.hangup', { hangup_cause: 'timeout' }, { callId: 'leg-b', transferParent: 'call-1' })
  assert.match(fail.commands[0].text, /leave your name/)
  const after = await forward.run('call.speak.ended', {})
  assert.deepEqual(after.commands, [{ type: 'record_start', beep: true, maxLength: 120, timeoutSecs: 5 }])
  const saved = await forward.run('call.recording.saved', { recording_urls: { mp3: 'https://example.com/a.mp3' } })
  assert.deepEqual(saved.commands, [{ type: 'hangup' }])
  assert.equal(forward.row().recording_url, 'https://example.com/a.mp3')

  const vm = setup({ rules: { calls_enabled: false } })
  await vm.run('call.initiated', { direction: 'incoming', from: CALLER })
  const v = await vm.run('call.answered', { direction: 'incoming', from: CALLER })
  assert.match(speakText(v), /leave your name/)
  assert.doesNotMatch(speakText(v), /AI assistant/)
})

test('a missed call gets one text back, but not to someone who opted out or was just texted', async () => {
  const s = setup()
  await answer(s)
  await s.run('call.hangup', {})
  assert.equal(s.texts.length, 1)
  assert.match(s.texts[0].text, /missed your call/)

  const optedOut = setup({ tables: { sms_consents: [{ shop_id: 'shop-a', phone_digits: '7135550142', opted_out: true }] } })
  await answer(optedOut)
  await optedOut.run('call.hangup', {})
  assert.equal(optedOut.texts.length, 0)

  const recentlyTexted = setup({ tables: { messages: [{ shop_id: 'shop-a', direction: 'inbound', channel: 'sms', from_address: CALLER, to_address: '+17135550100', body: 'hi', created_at: '2026-10-14T14:00:00Z' }] } })
  await answer(recentlyTexted)
  await recentlyTexted.run('call.hangup', {})
  assert.equal(recentlyTexted.texts.length, 0)

  const off = setup({ rules: { text_back_after_calls: false } })
  await answer(off)
  await off.run('call.hangup', {})
  assert.equal(off.texts.length, 0)

  const night = setup({ now: NIGHT })
  await answer(night)
  await night.run('call.hangup', {})
  assert.equal(night.texts.length, 0, 'quiet hours')
})

test('summary email follows the shop\'s setting', async () => {
  const never = setup({ rules: { summary_email: 'never' } })
  await answer(never)
  await never.say('my truck will not start')
  await never.run('call.hangup', {})
  assert.equal(never.emails.length, 0)
  const every = setup({ rules: { summary_email: 'every_call' } })
  await answer(every)
  await every.run('call.hangup', {})
  assert.equal(every.emails.length, 1)
  const custom = setup({ rules: { notify_email: 'dispatch@example.com' } })
  await answer(custom)
  await custom.say('my truck will not start')
  await custom.run('call.hangup', {})
  assert.equal(custom.emails[0].to, 'dispatch@example.com')
})

test('a model is used for the summary, and a broken one falls back to the facts', async () => {
  const good = setup({ model: async (m, o) => (o.json ? '' : '- Caller needs brakes checked.\n- Name: John.') })
  await answer(good)
  await good.say('my brakes are grinding when I stop')
  await good.run('call.hangup', {})
  assert.match(good.row().summary, /Caller needs brakes checked/)
  const bad = setup({ model: async () => { throw new Error('x') } })
  await answer(bad)
  await bad.say('my brakes are grinding when I stop')
  await bad.run('call.hangup', {})
  assert.match(bad.row().summary, /Needs: my brakes are grinding/)
})

test('booking requests made on a call are saved for approval', async () => {
  const s = setup({ rules: { booking_mode: 'request' } })
  await answer(s)
  await s.say('I need to bring my car in for an oil change tomorrow morning')
  const b = s.db.table('ai_booking_requests')
  assert.equal(b.length, 1)
  assert.equal(b[0].kind, 'request')
  assert.equal(b[0].channel, 'call')
  await s.run('call.hangup', {})
  assert.equal(s.db.table('ai_interactions')[0].outcome, 'booking_requested')
})

test('the call still works with the new tables missing', async () => {
  const s = setup({ missing: ['voice_rules', 'ai_interactions', 'ai_booking_requests', 'ai_thread_state'] })
  const r = await answer(s)
  assert.match(speakText(r), /AI/)
  assert.match(speakText(await s.say('my brakes are grinding when I stop')), /name/i)
  await s.run('call.hangup', {})
  assert.equal(s.row().status, 'ended')
  assert.ok(s.row().summary)
})

test('one shop cannot touch another shop\'s call', async () => {
  const s = setup()
  await answer(s)
  const other = { shop_id: 'shop-b', shop_name: 'Other', telnyx_phone_number: '+17135550200' }
  await assert.rejects(handleCallEvent(s.deps, other, { type: 'call.initiated', callId: 'call-1', payload: { direction: 'incoming', from: CALLER } }))
})

test('no shop-specific wording leaks into what is spoken', async () => {
  const s = setup()
  const lines = [speakText(await answer(s))]
  for (const t of ['hello', 'my brakes are grinding', 'Sam Lee', '2012 Toyota Camry', 'yes']) lines.push(speakText(await s.say(t)))
  for (const l of lines) assert.doesNotMatch(l, /alpha|houston/i)
})
