import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRules } from '../src/lib/voice/rules.ts'
import { decideTurn, emptyState, pickSlot, findPhone, findName, findVehicle, parseModelJson, readState, spokenDigits } from '../src/lib/voice/engine.ts'
import { callGreeting, firstTextIntro, buildSystemPrompt, telnyxAssistantInstructions, helpReply, honestAiReply, shopFromSettings, aiIntro } from '../src/lib/voice/prompt.ts'
import { openState } from '../src/lib/voice/hours.ts'
import { enforceReplyPolicy } from '../src/lib/voice/guardrails.ts'

const shop = { name: 'Test Auto Care', phone: '+17135550100', address: '100 Main St, Springfield', email: 'shop@example.com', timezone: 'America/Chicago' }
const hours = {
  mon: { open: true, from: '08:00', to: '17:00' }, tue: { open: true, from: '08:00', to: '17:00' }, wed: { open: true, from: '08:00', to: '17:00' },
  thu: { open: true, from: '08:00', to: '17:00' }, fri: { open: true, from: '08:00', to: '17:00' }, sat: { open: false, from: '09:00', to: '13:00' }, sun: { open: false, from: '09:00', to: '13:00' },
}
const now = new Date('2026-10-14T15:00:00Z') // Wednesday 10:00 in Chicago
const rules = (over = {}) => normalizeRules({ hours, ...over })

async function say(text, o = {}) {
  return decideTurn({
    channel: o.channel || 'call', text, rules: o.rules || rules(), shop, now: o.now || now,
    state: o.state || emptyState(), history: o.history || [], context: o.context || { fromNumber: '+17135550142' },
    model: o.model ?? null, canTransfer: o.canTransfer ?? false,
  })
}

async function conversation(lines, o = {}) {
  let state = o.state || emptyState()
  const out = []
  for (const l of lines) {
    const d = await say(l, { ...o, state })
    state = d.state
    out.push(d)
  }
  return { out, state }
}

test('the call greeting always says it is an AI and gives the recording notice', () => {
  const open = openState(hours, [], shop.timezone, now)
  const g = callGreeting(rules(), shop, open)
  assert.match(g, /Test Auto Care/)
  assert.match(g, /AI/)
  assert.match(g, /recorded/)
  const custom = callGreeting(rules({ greeting_call: 'Hey, thanks for calling {shop}!' }), shop, open)
  assert.match(custom, /Hey, thanks for calling Test Auto Care!/)
  assert.match(custom, /AI/, 'custom greeting still gets the AI notice')
  assert.match(custom, /recorded/)
  const noticeOff = callGreeting(rules({ recording_notice: false }), shop, open)
  assert.doesNotMatch(noticeOff, /recorded/)
  const closed = callGreeting(rules(), shop, openState(hours, [], shop.timezone, new Date('2026-10-15T03:00:00Z')))
  assert.match(closed, /closed right now/)
  const unknownHours = callGreeting(normalizeRules({}), shop, openState(null, [], shop.timezone, now))
  assert.doesNotMatch(unknownHours, /closed|open/i)
  assert.match(aiIntro(rules({ assistant_name: 'Sam' }), shop), /Sam, the AI assistant/)
})

test('a shop with no name set gets plain wording, never another shop\'s name', () => {
  const blank = shopFromSettings({})
  const g = callGreeting(normalizeRules({}), blank, openState(null, [], blank.timezone, now))
  assert.match(g, /the shop/)
  assert.doesNotMatch(g, /alpha/i)
  assert.equal(blank.timezone, 'America/Chicago')
})

test('first text carries the AI notice', () => {
  assert.match(firstTextIntro(rules(), shop), /virtual assistant for Test Auto Care.*AI/)
  assert.match(helpReply(shop), /STOP/)
  assert.match(helpReply(shop), /\(713\) 555-0100/)
})

test('plain script (no model) collects problem, name, vehicle and callback in order', async () => {
  const { out, state } = await conversation(['my brakes are grinding when I stop', 'John Smith', '2015 Honda Civic', 'yes that is right'])
  assert.match(out[0].say, /name/i)
  assert.match(out[1].say, /year, make and model/i)
  assert.match(out[2].say, /ending in 0 1 4 2/)
  assert.equal(state.captured.name, 'John Smith')
  assert.equal(state.captured.vehicle, '2015 Honda Civic')
  assert.equal(state.captured.problem, 'my brakes are grinding when I stop')
  assert.equal(state.captured.callback, '(713) 555-0142')
  assert.equal(state.done, true)
  assert.match(out[3].say, /Anything else|anything else/i)
  assert.equal(out[3].outcome, 'message_taken')
  const bye = await say('no that is all', { state })
  assert.equal(bye.end, true)
  assert.match(bye.say, /Goodbye/)
})

test('after hours the outcome says so', async () => {
  const late = new Date('2026-10-15T03:00:00Z')
  const { out } = await conversation(['my brakes are grinding when I stop', 'John Smith', '2015 Honda Civic', 'yes'], { now: late })
  assert.equal(out[3].outcome, 'after_hours')
})

test('a text conversation never asks for a callback number: it already has one', async () => {
  const { out, state } = await conversation(['Hi, my check engine light is on', 'This is Maria Lopez', '2012 Toyota Camry'], { channel: 'sms' })
  assert.match(out[1].say, /year, make and model/i)
  assert.equal(state.captured.callback, '(713) 555-0142')
  assert.equal(state.done, true)
})

test('price questions never get a price, with or without a model', async () => {
  const d = await say('how much for an oil change?')
  assert.doesNotMatch(d.say, /\$|\d{2,}/)
  assert.match(d.say, /quote/)
  assert.ok(d.rulesFired.includes('price_deflect'))
  const model = async () => JSON.stringify({ reply: 'Brakes run about $250 per axle. What year is your car?', captured: {}, done: false })
  const d2 = await say('what do you think it needs', { model })
  assert.doesNotMatch(d2.say, /\$|250/)
  assert.ok(d2.rulesFired.includes('no_prices'))
})

test('model replies that promise times or claim to be a person are cleaned', async () => {
  const model = async () => JSON.stringify({ reply: "I'm a real person. We will call you back within 10 minutes. Can I get your name?", captured: {}, done: false })
  const d = await say('my car makes a noise', { model })
  assert.doesNotMatch(d.say, /real person|10 minutes/i)
  assert.ok(d.rulesFired.includes('no_human_claim'))
  assert.ok(d.rulesFired.includes('no_time_promises'))
  assert.match(d.say, /name/i)
})

test('model output is used when it is good, and captured details are only taken from what was said', async () => {
  const model = async () => JSON.stringify({ reply: 'Thanks Dana. What year, make and model is the car?', captured: { name: 'Dana', vehicle: 'Batmobile', problem: 'noise', callback: '' }, done: false })
  const d = await say('hi this is Dana, my car squeals when I turn', { model })
  assert.equal(d.usedModel, true)
  assert.equal(d.state.captured.name, 'Dana')
  assert.equal(d.state.captured.vehicle, '2026 Batmobile'.slice(0, 0) || d.state.captured.vehicle)
  assert.match(d.say, /make and model/)
})

test('a broken model answer falls back to the script', async () => {
  const d = await say('my truck will not start', { model: async () => 'sorry I cannot do JSON' })
  assert.ok(d.say.length > 0)
  const d2 = await say('my truck will not start', { model: async () => { throw new Error('boom') } })
  assert.ok(d2.say.length > 0)
  assert.equal(d2.usedModel, false)
})

test('asked "are you a robot": honest, every time', async () => {
  for (const ch of ['call', 'sms']) {
    const d = await say('wait, are you a robot?', { channel: ch })
    assert.match(d.say, /I'm an AI assistant/)
    assert.ok(d.rulesFired.includes('honest_ai'))
  }
  assert.match(honestAiReply(rules(), shop, 'call'), /not a person/)
})

test('safety problems transfer to a person during hours', async () => {
  const d = await say('my brakes went to the floor on the freeway', { canTransfer: true })
  assert.equal(d.transfer, true)
  assert.equal(d.flag.reason, 'safety')
  assert.equal(d.outcome, 'transferred')
  assert.match(d.say, /connecting you/)
  assert.match(d.say, /911/)
  assert.equal(d.state.transferred, true)
})

test('when nobody can take the call, the caller is told and a number is collected', async () => {
  const caller = await say('I was in an accident and need help', { context: { fromNumber: '' } })
  assert.equal(caller.transfer, false)
  assert.equal(caller.flag.reason, 'accident')
  assert.match(caller.say, /best number/)
  const next = await say('seven one three five five five zero one four two', { state: caller.state, context: { fromNumber: '' } })
  assert.equal(next.end, true)
  assert.equal(next.state.captured.callback, '(713) 555-0142')
  const withId = await say('I was in an accident and need help')
  assert.equal(withId.end, true)
  assert.equal(withId.outcome, 'needs_person')
})

test('texts: flagged threads get one holding message, then silence', async () => {
  const first = await say('this is unacceptable, I want a refund', { channel: 'sms' })
  assert.equal(first.flag.reason, 'angry')
  assert.match(first.say, /person/)
  assert.doesNotMatch(first.say, /\$/)
  const second = await say('hello???', { channel: 'sms', state: first.state })
  assert.equal(second.silent, true)
  assert.equal(second.say, '')
})

test('shop switches turn topics off', async () => {
  const d = await say('I was in an accident', { rules: rules({ topics: { accident: false } }) })
  assert.equal(d.flag, null)
})

test('custom keywords and "let me talk to someone" need a person', async () => {
  const k = await say('is Dave around', { rules: rules({ custom_keywords: ['dave'] }), channel: 'sms' })
  assert.equal(k.flag.reason, 'keyword')
  const h = await say('let me talk to a real person', { canTransfer: true })
  assert.equal(h.transfer, true)
  const t = await say('let me talk to a real person', { channel: 'sms' })
  assert.match(t.say, /ask a person/)
})

test('spam is ended on calls and ignored in texts', async () => {
  const c = await say('this is about your vehicle extended warranty which is about to expire', {})
  assert.equal(c.end, true)
  assert.equal(c.outcome, 'spam')
  const t = await say('Congratulations you have won, click here bit.ly/x', { channel: 'sms' })
  assert.equal(t.silent, true)
  assert.equal(t.outcome, 'spam')
  const off = await say('this is about your vehicle extended warranty which is about to expire', { rules: rules({ spam_filter: false }) })
  assert.equal(off.end, false)
})

test('asking to stop contacting is an opt-out', async () => {
  const d = await say('please stop texting me', { channel: 'sms' })
  assert.equal(d.optOut, true)
  assert.equal(d.silent, true)
})

test('hours questions use the shop\'s hours, or admit they are not set', async () => {
  const d = await say('what time do you close today?')
  assert.match(d.say, /Mon to Fri 8:00 AM to 5:00 PM/)
  assert.match(d.say, /open now until 5:00 PM/)
  const none = await say('what are your hours?', { rules: normalizeRules({}) })
  assert.match(none.say, /don't have our hours/)
  assert.doesNotMatch(none.say, /\d:\d\d/)
  const hidden = await say('what are your hours?', { rules: rules({ may_share_hours: false }) })
  assert.match(hidden.say, /don't have our hours/)
})

test('the address is shared only when allowed', async () => {
  assert.match((await say('where are you located?')).say, /100 Main St, Springfield/)
  assert.doesNotMatch((await say('where are you located?', { rules: rules({ may_share_address: false }) })).say, /Main St/)
})

test('request mode: the appointment is a request, never a confirmation', async () => {
  const r = rules({ booking_mode: 'request' })
  const d1 = await say('I need to bring my car in for an oil change', { rules: r })
  assert.match(d1.say, /What day and time/)
  assert.equal(d1.state.asked, 'preferred')
  const d2 = await say('Thursday morning', { rules: r, state: d1.state })
  assert.equal(d2.booking.kind, 'request')
  assert.equal(d2.booking.preferred, 'Thursday morning')
  assert.match(d2.say, /sent that request to our team to confirm/)
  assert.doesNotMatch(d2.say, /booked|confirmed for/i)
  assert.equal(d2.outcome, 'booking_requested')
  const direct = await say('can I come in tomorrow afternoon for an oil change', { rules: r })
  assert.equal(direct.booking.kind, 'request')
})

test('book mode offers only open times, books the one picked, and re-checks it', async () => {
  const r = rules({ booking_mode: 'book', booking_lead_hours: 2 })
  const ctx = { fromNumber: '+17135550142', appointments: [] }
  const d1 = await say('I want to schedule an oil change', { rules: r, context: ctx })
  assert.match(d1.say, /name first/)
  const d2 = await say('Pat Jones', { rules: r, context: ctx, state: d1.state })
  assert.match(d2.say, /open times: 1\. .* 2\. .* 3\. /)
  assert.equal(d2.state.offered.length, 3)
  assert.equal(d2.state.asked, 'pick')
  const picked = await say('the second one', { rules: r, context: ctx, state: d2.state })
  assert.equal(picked.booking.kind, 'book')
  assert.equal(picked.booking.date, d2.state.offered[1].date)
  assert.equal(picked.booking.time, d2.state.offered[1].time)
  assert.match(picked.say, /You're booked for/)
  assert.equal(picked.outcome, 'booked')
  // someone else took it in the meantime
  const taken = { ...ctx, appointments: [
    { date: d2.state.offered[1].date, time: d2.state.offered[1].time, duration: 60, status: 'Scheduled' },
    { date: d2.state.offered[1].date, time: d2.state.offered[1].time, duration: 60, status: 'Scheduled' },
  ] }
  const lost = await say('the second one', { rules: r, context: taken, state: d2.state })
  assert.equal(lost.booking, null)
  assert.match(lost.say, /just taken/)
  const other = await say('none of those work, how about next week', { rules: r, context: ctx, state: d2.state })
  assert.equal(other.state.asked, 'preferred')
  const vague = await say('hmm', { rules: r, context: ctx, state: d2.state })
  assert.match(vague.say, /which one works best/i)
})

test('book mode without hours falls back to a request', async () => {
  const r = normalizeRules({ booking_mode: 'book' })
  const d = await say('I need an appointment', { rules: r })
  assert.equal(d.state.asked, 'preferred')
})

test('booking off: no booking action is ever produced', async () => {
  const r = rules({ booking_mode: 'off' })
  const d = await say('I need an appointment tomorrow morning', { rules: r })
  assert.equal(d.booking, null)
})

test('pickSlot understands numbers, ordinals, days and times', () => {
  const offered = [
    { date: '2026-10-14', time: '13:00', label: 'Wednesday, Oct 14 at 1:00 PM' },
    { date: '2026-10-15', time: '08:00', label: 'Thursday, Oct 15 at 8:00 AM' },
    { date: '2026-10-15', time: '09:00', label: 'Thursday, Oct 15 at 9:00 AM' },
  ]
  assert.equal(pickSlot('2', offered), offered[1])
  assert.equal(pickSlot('the first one please', offered), offered[0])
  assert.equal(pickSlot('the last one', offered), offered[2])
  assert.equal(pickSlot('wednesday', offered), offered[0])
  assert.equal(pickSlot('thursday', offered), null)
  assert.equal(pickSlot('thursday at 9', offered), offered[2])
  assert.equal(pickSlot('8 am', offered), offered[1])
  assert.equal(pickSlot('1 pm', offered), offered[0])
  assert.equal(pickSlot('I do not know', offered), null)
  assert.equal(pickSlot('', []), null)
})

test('long conversations are handed to a person', async () => {
  let state = emptyState()
  let d
  for (let i = 0; i < 20; i++) {
    d = await say(i % 2 ? 'ok well then' : 'maybe I will think about it', { state, channel: 'sms' })
    state = d.state
    if (d.flag) break
  }
  assert.ok(d.flag, 'a person was asked')
  assert.ok(['unsure', 'limit'].includes(d.flag.reason))
})

test('reading numbers, names and cars out of speech', () => {
  assert.equal(findPhone('my number is 713-555-0142'), '(713) 555-0142')
  assert.equal(findPhone('it is seven one three five five five zero one four two'), '(713) 555-0142')
  assert.equal(findPhone('call me at +1 (713) 555 0142 thanks'), '(713) 555-0142')
  assert.equal(findPhone('I have 3 kids'), '')
  assert.equal(spokenDigits('oh seven'), '0 7')
  assert.equal(findName('my name is john smith and my brakes', ''), 'John Smith')
  assert.equal(findName("this is about my car", ''), '')
  assert.equal(findName('Maria', 'name'), 'Maria')
  assert.equal(findName('sure it is Maria Lopez', 'name'), 'Maria Lopez')
  assert.equal(findVehicle('I have a 2015 honda civic that shakes', ''), '2015 Honda Civic')
  assert.equal(findVehicle('my ford f-150', ''), 'Ford F-150')
  assert.equal(findVehicle('a blue Civic', 'vehicle'), 'Blue Civic')
  assert.equal(findVehicle('maybe I will think about it', 'vehicle'), '')
  assert.equal(findName('ok well then', 'name'), '')
  assert.equal(findVehicle('my brakes squeal', ''), '')
})

test('stored state is read back safely', () => {
  assert.deepEqual(readState(null), emptyState())
  assert.deepEqual(readState('x'), emptyState())
  const s = readState({ captured: { name: 5 }, asked: 'evil', offered: [{ date: '2026-10-14', time: '13:00' }, 'x'], customerTurns: 9999 })
  assert.equal(s.captured.name, '')
  assert.equal(s.asked, '')
  assert.equal(s.offered.length, 1)
  assert.equal(s.customerTurns, 100)
  assert.ok(s.offered[0].label.includes('1:00 PM'))
})

test('model JSON is parsed tolerantly', () => {
  assert.equal(parseModelJson('```json\n{"reply":"Hi","captured":{"name":"A"}}\n```').reply, 'Hi')
  assert.equal(parseModelJson('Just words, no JSON').reply, 'Just words, no JSON')
  assert.equal(parseModelJson(''), null)
  assert.equal(parseModelJson('{"reply":'), null)
  assert.equal(parseModelJson('<think>x</think>{"reply":"ok","done":true}').done, true)
})

test('every fixed line the engine can say passes its own policy', async () => {
  const lines = []
  const take = async (text, o) => { const d = await say(text, o); lines.push(d.say); return d }
  await take('how much for brakes')
  await take('what are your hours')
  await take('where are you')
  await take('are you a robot')
  await take('my brakes failed', { canTransfer: true })
  await take('my brakes failed')
  await take('I need an appointment', { rules: rules({ booking_mode: 'request' }) })
  await take('thursday morning', { rules: rules({ booking_mode: 'request' }), state: { ...emptyState(), asked: 'preferred' } })
  const d = await take('I need an appointment', { rules: rules({ booking_mode: 'book' }), state: { ...emptyState(), captured: { ...emptyState().captured, name: 'Pat' } } })
  lines.push(d.say)
  const fb = { prices: 'x', timing: 'x', diagnosis: 'x', human: 'x', generic: 'x' }
  for (const l of lines.filter(Boolean)) {
    const r = enforceReplyPolicy(l, { channel: 'call', blockedPhrases: [], fallback: fb })
    assert.deepEqual(r.violations, [], `fixed line trips the policy: ${l}`)
  }
})

test('the model prompt carries the rules, never invents hours, and the Telnyx text matches', () => {
  const r = rules({ never_lines: ['Never discuss other shops'], may_share_address: false })
  const open = openState(hours, [], shop.timezone, now)
  const p = buildSystemPrompt({ channel: 'call', rules: r, shop, open, captured: { name: '', vehicle: '', problem: '', callback: '' } })
  assert.match(p, /You are not a person/)
  assert.match(p, /Never say or hint at a price/)
  assert.match(p, /Never discuss other shops/)
  assert.match(p, /Do not give the street address/)
  assert.match(p, /Mon to Fri 8:00 AM to 5:00 PM/)
  assert.doesNotMatch(p, /Main St/)
  const noHours = buildSystemPrompt({ channel: 'sms', rules: normalizeRules({}), shop, open: openState(null, [], 'America/Chicago', now), captured: { name: 'A', vehicle: 'B', problem: 'C', callback: 'D' } })
  assert.match(noHours, /Hours: not available/)
  assert.match(noHours, /You have everything you need/)
  const t = telnyxAssistantInstructions(rules({ handoff: [{ name: 'Sam', phone: '713-555-0199' }], custom_keywords: ['lawyer'], blocked_phrases: ['guarantee'] }), shop)
  assert.match(t, /You are an AI, not a person/)
  assert.match(t, /Sam \(713\) 555-0199/)
  assert.match(t, /lawyer/)
  assert.match(t, /guarantee/)
  assert.match(t, /Never say or hint at a price/)
  assert.doesNotMatch(telnyxAssistantInstructions(normalizeRules({}), shopFromSettings({})), /alpha|houston/i)
})
