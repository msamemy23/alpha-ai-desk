import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_MODES, DEFAULT_RULES, decideAction, defaultRules, findNeverSay, hasCustomRules, normalizeRules, rulesPromptBlock, RULE_LIMITS,
} from '../src/lib/ai/shop-rules.ts'
import { ACTIONS, getActionInfo, permissionClassOf, reviewTags, undoSentence } from '../src/lib/ai/action-risk.ts'

test('defaults ask before changing records or contacting anyone, and never charge', () => {
  const rules = defaultRules()
  assert.deepEqual(rules.permissions, { read: 'auto', draft: 'auto', save: 'ask', send: 'ask', charge: 'never' })
  assert.equal(hasCustomRules(rules), false)
  assert.notEqual(defaultRules(), DEFAULT_RULES, 'defaults are copied, not shared')
  defaultRules().neverDo.push('x')
  assert.deepEqual(DEFAULT_RULES.neverDo, [])
})

test('normalizeRules repairs damaged input instead of throwing', () => {
  for (const bad of [null, undefined, 'x', 7, [], { permissions: 'no' }, { permissions: null, neverDo: 'x' }]) {
    assert.deepEqual(normalizeRules(bad), defaultRules())
  }
})

test('a mode that is not allowed for its class falls back to the safe default', () => {
  const rules = normalizeRules({ permissions: { read: 'ask', draft: 'ask', save: 'auto', send: 'auto', charge: 'auto' } })
  assert.deepEqual(rules.permissions, defaultRules().permissions)
  assert.deepEqual(ALLOWED_MODES.send, ['ask', 'never'])
  assert.deepEqual(ALLOWED_MODES.charge, ['never'])
})

test('lists are trimmed, de-duplicated, capped and stripped of control characters', () => {
  const rules = normalizeRules({
    neverDo: ['  Quote an engine swap\u0007 ', 'quote an engine swap', '', 5, 'x'.repeat(500)],
    neverSay: Array.from({ length: 40 }, (_, i) => `phrase ${i}`),
    facts: ['Closed Sundays', 'closed sundays'],
    toneNotes: 'Short sentences.\nNo jargon.',
  })
  assert.equal(rules.neverDo[0], 'Quote an engine swap')
  assert.equal(rules.neverDo[1].length, RULE_LIMITS.neverDo.length)
  assert.equal(rules.neverDo.length, 2)
  assert.equal(rules.neverSay.length, RULE_LIMITS.neverSay.count)
  assert.deepEqual(rules.facts, ['Closed Sundays'])
  assert.equal(rules.toneNotes, 'Short sentences. No jargon.')
})

test('action overrides accept only never and sane ids', () => {
  const rules = normalizeRules({ actionOverrides: { deleteRecord: 'never', sendEstimateEmail: 'auto', 'bad id!': 'never' } })
  assert.deepEqual(rules.actionOverrides, { deleteRecord: 'never' })
})

test('decideAction: reads run alone, changes and messages need approval', () => {
  const rules = defaultRules()
  assert.deepEqual([decideAction(rules, 'searchCustomers').allowed, decideAction(rules, 'searchCustomers').needsApproval], [true, false])
  for (const id of ['updateJobStatus', 'createInvoice', 'sendEstimateEmail', 'message.sms', 'scheduleFollowUp', 'deleteRecord']) {
    const decision = decideAction(rules, id)
    assert.equal(decision.allowed, true, id)
    assert.equal(decision.needsApproval, true, id)
  }
})

test('decideAction: the owner can switch a whole class or one action off', () => {
  const rules = normalizeRules({ permissions: { send: 'never' }, actionOverrides: { deleteRecord: 'never' } })
  assert.equal(decideAction(rules, 'sendEstimateEmail').allowed, false)
  assert.match(decideAction(rules, 'sendEstimateEmail').reason, /contact customers/)
  assert.equal(decideAction(rules, 'message.sms').allowed, false)
  assert.equal(decideAction(rules, 'deleteRecord').allowed, false)
  assert.match(decideAction(rules, 'deleteRecord').reason, /delete a record/)
  assert.equal(decideAction(rules, 'updateCustomer').allowed, true)
  const readsOff = normalizeRules({ permissions: { read: 'never' } })
  assert.equal(decideAction(readsOff, 'getShopStats').allowed, false)
})

test('payments are never allowed, whatever the stored rules say', () => {
  const rules = { ...defaultRules(), permissions: { read: 'auto', draft: 'auto', save: 'ask', send: 'ask', charge: 'auto' } }
  const decision = decideAction(rules, 'payment.charge')
  assert.equal(decision.allowed, false)
  assert.equal(permissionClassOf('recordPayment'), 'charge')
})

test('unknown actions are treated as risky, never waved through', () => {
  const info = getActionInfo('someNewThing')
  assert.equal(info.permission, 'save')
  assert.equal(info.reversibility, 'irreversible')
  assert.equal(decideAction(defaultRules(), 'someNewThing').needsApproval, true)
  assert.equal(getActionInfo('myConnector.postUpdate').permission, 'send')
  assert.equal(getActionInfo('desktopPrint').permission, 'save')
  assert.equal(getActionInfo('automationControl.pause').reversibility, 'manual')
})

test('every action the engines can run is classified, and sends are labelled before approval', () => {
  const writes = ['createCustomer', 'createJob', 'createInvoice', 'updateJobStatus', 'updateCustomer', 'voidDocument', 'deleteRecord', 'scheduleFollowUp', 'sendEstimateEmail', 'convertEstimateToInvoice', 'addStaff', 'removeStaff', 'updateDocument', 'createAppointment', 'deleteAppointment', 'updateAppointment', 'updateInventory']
  for (const id of writes) assert.ok(ACTIONS[id], `${id} is classified`)
  const email = reviewTags(getActionInfo('sendEstimateEmail')).map(tag => tag.text)
  assert.ok(email.includes('Cannot be undone') && email.includes('Reaches a customer'))
  assert.match(undoSentence(getActionInfo('sendEstimateEmail')), /^Cannot be undone/)
  assert.ok(reviewTags(getActionInfo('updateJobStatus')).some(tag => tag.text === 'Can be undone'))
  assert.match(undoSentence(getActionInfo('updateJobStatus')), /undo this later from Activity/)
  assert.equal(getActionInfo('deleteRecord').reversibility, 'irreversible')
})

test('the prompt block carries the owner words and never names a shop', () => {
  const rules = normalizeRules({
    tone: 'professional', toneNotes: 'Say ma\'am and sir.', permissions: { send: 'never' },
    neverDo: ['Quote an engine swap without a teardown'], neverSay: ['guarantee'], facts: ['We close at 6 pm on weekdays'],
  })
  const block = rulesPromptBlock(rules)
  assert.match(block, /Polite, courteous/)
  assert.match(block, /Say ma'am and sir/)
  assert.match(block, /Contact customers/)
  assert.match(block, /Quote an engine swap without a teardown/)
  assert.match(block, /"guarantee"/)
  assert.match(block, /We close at 6 pm on weekdays/)
  assert.match(block, /never take payments/)
  assert.doesNotMatch(block, /Alpha|Houston/)
  assert.match(rulesPromptBlock(rules, { shopName: 'Test Auto Care' }), /SHOP RULES for Test Auto Care/)
  assert.equal(hasCustomRules(rules), true)
})

test('findNeverSay is case-insensitive and returns only phrases that appear', () => {
  const rules = normalizeRules({ neverSay: ['Guarantee', 'cheapest in town'] })
  assert.deepEqual(findNeverSay(rules, 'We GUARANTEE this repair.'), ['Guarantee'])
  assert.deepEqual(findNeverSay(rules, 'See you Friday'), [])
  assert.deepEqual(findNeverSay(rules, ''), [])
})
