import test from 'node:test'
import assert from 'node:assert/strict'
import { classify, personTopics, smsKeyword, isAutomatedSenderAddress, looksAutomated, isRepeat, isEchoOfAssistant, enforceReplyPolicy, admitsAi, cleanModelText } from '../src/lib/voice/guardrails.ts'

const sig = (t, channel = 'sms', kw = []) => classify(t, { channel, customKeywords: kw })
const allTopics = { angry: true, safety: true, towing: true, accident: true, insurance: true, legal: true }

test('safety, towing, accident, insurance, legal and angry customers are caught', () => {
  assert.equal(sig('my brakes failed on the freeway').safety, true)
  assert.equal(sig('there is smoke coming from the hood').safety, true)
  assert.equal(sig('someone is hurt, call 911').emergency, true)
  assert.equal(sig('I broke down and need a tow truck').towing, true)
  assert.equal(sig('I was rear ended yesterday').accident, true)
  assert.equal(sig('this is for my insurance claim').insurance, true)
  assert.equal(sig('I am going to sue you').legal, true)
  assert.equal(sig('this is ridiculous, I want my money back').angry, true)
  assert.equal(sig('THIS IS THE WORST SERVICE I HAVE EVER HAD').angry, true)
  assert.equal(sig('Hi, can I get an oil change tomorrow?').angry, false)
  assert.equal(sig('Hi, can I get an oil change tomorrow?').safety, false)
})

test('shop switches decide which topics need a person, and keywords always do', () => {
  const s = sig('my car was in an accident and the insurance adjuster called')
  assert.deepEqual(personTopics(s, allTopics), ['accident', 'insurance'])
  assert.deepEqual(personTopics(s, { ...allTopics, accident: false, insurance: false }), [])
  assert.deepEqual(personTopics(sig('is Dave there', 'sms', ['dave']), allTopics), ['keyword'])
  assert.deepEqual(personTopics(sig('let me talk to a real person'), allTopics), ['asked'])
})

test('asking "are you a robot" is recognised', () => {
  for (const t of ['are you a robot?', 'is this a real person', 'am I talking to a bot', 'Are you an AI?', 'is this a recording']) assert.equal(sig(t).askedIfAi, true, t)
  assert.equal(sig('are you open on saturday').askedIfAi, false)
})

test('spam is caught on calls and texts but real customers are not', () => {
  assert.equal(sig('we have been trying to reach you about your car warranty that is about to expire', 'call').spam, true)
  assert.equal(sig('I can help your business with SEO and website design', 'call').spam, true)
  assert.equal(sig('your account has been suspended click here bit.ly/abc').spam, true)
  assert.equal(sig('my car warranty ran out, can you fix my brakes anyway', 'call').spam, false)
  assert.equal(sig('I need my brakes checked', 'call').spam, false)
})

test('STOP, START and HELP are whole-message commands only', () => {
  assert.equal(smsKeyword('STOP'), 'stop')
  assert.equal(smsKeyword(' stop. '), 'stop')
  assert.equal(smsKeyword('Unsubscribe'), 'stop')
  assert.equal(smsKeyword('START'), 'start')
  assert.equal(smsKeyword('help'), 'help')
  assert.equal(smsKeyword('please stop the car from shaking'), null)
  assert.equal(smsKeyword('I need help with my brakes'), null)
  assert.equal(sig('please stop texting me').optOutNatural, true)
  assert.equal(sig('take me off your list').optOutNatural, true)
})

test('automated senders and auto-replies never get an AI reply (no AI-to-AI loops)', () => {
  assert.equal(isAutomatedSenderAddress('12345'), true)
  assert.equal(isAutomatedSenderAddress('AMAZON'), true)
  assert.equal(isAutomatedSenderAddress(''), true)
  assert.equal(isAutomatedSenderAddress('+17135550142'), false)
  assert.equal(isAutomatedSenderAddress('(713) 555-0142'), false)
  assert.equal(looksAutomated('This is an automated message. Do not reply.'), true)
  assert.equal(looksAutomated('Thank you for contacting us. We will respond as soon as possible.'), true)
  assert.equal(looksAutomated('Msg&Data rates may apply. Reply STOP to opt out'), true)
  assert.equal(looksAutomated('I am out of the office until Monday'), true)
  assert.equal(looksAutomated('Can I bring my truck in tomorrow?'), false)
  assert.equal(isRepeat('Thanks! We will help.', ['thanks we will help']), true)
  assert.equal(isRepeat('Different words', ['thanks we will help']), false)
})

test('the assistant\'s own words coming back are recognised as an echo', () => {
  const ai = ['Thanks for calling the shop. This is the virtual assistant. How can I help you today?']
  assert.equal(isEchoOfAssistant('how can I help you today', ai), true)
  assert.equal(isEchoOfAssistant('my brakes are grinding badly when I stop', ai), false)
  assert.equal(isEchoOfAssistant('', ai), false)
})

const ctx = { channel: 'sms', blockedPhrases: ['guarantee'], fallback: { prices: 'PRICE-FALLBACK', timing: 'TIMING-FALLBACK', diagnosis: 'DIAG-FALLBACK', human: 'HUMAN-FALLBACK', generic: 'GENERIC-FALLBACK' } }

test('replies with prices are removed', () => {
  for (const bad of ['An oil change is $79.99.', 'It will cost about 300 dollars.', 'Brakes usually run around $250.', 'We do free estimates.', 'That would be no charge.', 'It costs 150.']) {
    const r = enforceReplyPolicy(bad, ctx)
    assert.ok(r.violations.includes('no_prices'), bad)
    assert.equal(r.text, 'PRICE-FALLBACK', bad)
  }
  const mixed = enforceReplyPolicy('Happy to help. An oil change is $79. What year is your car?', ctx)
  assert.equal(mixed.text, 'Happy to help. What year is your car?')
})

test('promises about timing are removed', () => {
  for (const bad of ['It will be ready by 5pm.', 'We will call you back within 10 minutes.', 'It should be done tomorrow.', 'The tech will text you right away.', 'This takes about 2 hours.']) {
    const r = enforceReplyPolicy(bad, ctx)
    assert.ok(r.violations.includes('no_time_promises'), bad)
  }
  assert.equal(enforceReplyPolicy('Our team will follow up with you.', ctx).changed, false)
})

test('claiming to be a person, diagnosing and blocked phrases are removed', () => {
  assert.ok(enforceReplyPolicy("I'm a real person here to help.", ctx).violations.includes('no_human_claim'))
  assert.ok(enforceReplyPolicy("No, I'm not an AI.", ctx).violations.includes('no_human_claim'))
  assert.ok(enforceReplyPolicy("It's probably the alternator.", ctx).violations.includes('no_diagnosis'))
  assert.ok(enforceReplyPolicy('It is safe to drive for now.', ctx).violations.includes('no_diagnosis'))
  const blocked = enforceReplyPolicy('We guarantee our work. Please come in.', ctx)
  assert.ok(blocked.violations.includes('blocked_phrase'))
  assert.equal(blocked.text, 'Please come in.')
})

test('long replies are shortened at a sentence and the length is capped per channel', () => {
  const long = Array.from({ length: 20 }, (_, i) => `This is sentence number ${i}.`).join(' ')
  const sms = enforceReplyPolicy(long, ctx)
  assert.ok(sms.text.length <= 320)
  assert.ok(sms.violations.includes('too_long'))
  assert.match(sms.text, /\.$/)
  const call = enforceReplyPolicy(long, { ...ctx, channel: 'call' })
  assert.ok(call.text.length <= 420 && call.text.length > sms.text.length - 1)
})

test('admitsAi and cleanModelText', () => {
  assert.equal(admitsAi("Yes, I'm an AI assistant."), true)
  assert.equal(admitsAi('Thanks for calling.'), false)
  assert.equal(cleanModelText('<think>hmm</think>**Hello** there (smiles) [pause]'), 'Hello there')
})
