import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, normalizeRules, validateRules, defaultWeekHours } from '../src/lib/voice/rules.ts'
import { prettyPhone, callGreeting, firstTextIntro, telnyxAssistantInstructions } from '../src/lib/voice/prompt.ts'

const shop = { name: 'Test Auto Care', phone: '+15555550100', address: '1 Main St', email: 'a@b.co', timezone: 'America/Denver' }
const open = { known: true, open: true, reason: 'open', closesAt: '', nextOpen: '' }
const closed = { known: true, open: false, reason: 'after_close', closesAt: '', nextOpen: 'tomorrow at 8:00 AM' }

test('handoff numbers shown the way people type them save back to the same number', () => {
  const stored = normalizeRules({ handoff: [{ name: 'Front desk', phone: '+17135550111' }] })
  const shown = stored.handoff.map(h => ({ name: h.name, phone: prettyPhone(h.phone) }))
  assert.equal(shown[0].phone, '(713) 555-0111')
  const again = normalizeRules({ ...stored, handoff: shown })
  assert.deepEqual(again.handoff, stored.handoff)
})

test('a handoff number that is not a full phone number blocks the save with a plain message', () => {
  const input = { ...DEFAULT_RULES, handoff: [{ name: 'Desk', phone: '555-01' }] }
  const problems = validateRules(normalizeRules(input), input)
  assert.equal(problems.length, 1)
  assert.match(problems[0].message, /10-digit/)
})

test('hours cleared on screen stay cleared, and set hours validate day by day', () => {
  assert.equal(normalizeRules({ ...DEFAULT_RULES, hours: null }).hours, null)
  const hours = defaultWeekHours()
  hours.tue = { open: true, from: '17:00', to: '08:00' }
  const bad = validateRules(normalizeRules({ hours }), { hours })
  assert.ok(bad.some(p => p.field === 'hours.tue'))
})

test('the on-screen preview always says AI and never names another shop', () => {
  const rules = normalizeRules({ greeting_call: 'Welcome to {shop}.', assistant_name: 'Sam' })
  const heard = callGreeting(rules, shop, open)
  assert.match(heard, /Welcome to Test Auto Care/)
  assert.match(heard, /AI/)
  assert.match(heard, /recorded/)
  assert.match(callGreeting(rules, shop, closed), /closed right now/)
  assert.match(firstTextIntro(rules, shop), /AI/)
  assert.doesNotMatch(heard + firstTextIntro(rules, shop), /alpha|houston/i)
})

test('the Telnyx instructions follow the screen: topics, handoff, never lines and no price talk', () => {
  const rules = normalizeRules({
    handoff: [{ name: 'Desk', phone: '+17135550111' }], custom_keywords: ['recall'], never_lines: ['Never offer a discount.'],
    hours: defaultWeekHours(), topics: { towing: false },
  })
  const text = telnyxAssistantInstructions(rules, shop)
  assert.match(text, /You are an AI, not a person/)
  assert.match(text, /Never say or hint at a price/)
  assert.match(text, /\(713\) 555-0111/)
  assert.match(text, /recall/)
  assert.match(text, /Never offer a discount\./)
  assert.doesNotMatch(text, /towing/)
  assert.doesNotMatch(text, /alpha|houston/i)
})
