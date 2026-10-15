import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActionReview, buildMessageReview, buildWorkflowReview, formatValue, labelFor, payloadRows, smsSegments } from '../src/lib/ai/review.ts'
import { normalizeRules } from '../src/lib/ai/shop-rules.ts'

const tagText = model => model.tags.map(tag => tag.text)

test('review: an email says who, what, and that it cannot be undone, before anything is approved', () => {
  const model = buildWorkflowReview({ action: 'sendEstimateEmail', payload: { doc_number: 'INV-12', email: 'jo@example.test' } })
  assert.equal(model.title, 'Email a document')
  assert.deepEqual(model.rows.slice(0, 2), [{ label: 'To', value: 'jo@example.test' }, { label: 'Document', value: 'INV-12' }])
  assert.ok(tagText(model).includes('Reaches a customer'))
  assert.ok(tagText(model).includes('Cannot be undone'))
  assert.match(model.undoLine, /^Cannot be undone/)
  assert.equal(model.irreversible, true)
  assert.equal(model.approveLabel, 'Approve and send email')
  assert.equal(model.blockedReason, '')
})

test('review: a follow-up shows the exact words, the time, the channel and the length', () => {
  const model = buildWorkflowReview({
    action: 'scheduleFollowUp',
    payload: { customer_id: 'cust-1', customer_name: 'Maya Chen', channel: 'sms', scheduled_for: '2030-01-02T15:00:00.000Z', message_body: 'Hi Maya, how is the car running?' },
  }, { timeZone: 'UTC' })
  const byLabel = Object.fromEntries(model.rows.map(row => [row.label, row]))
  assert.equal(byLabel.To.value, 'Maya Chen')
  assert.equal(byLabel.How.value, 'Text message')
  assert.match(byLabel.When.value, /Wed, Jan 2, 2030/)
  assert.match(byLabel.When.value, /3:00 PM/)
  assert.equal(byLabel.Message.value, 'Hi Maya, how is the car running?')
  assert.equal(byLabel.Message.kind, 'words')
  assert.match(byLabel.Length.value, /32 characters, 1 text/)
  assert.equal(byLabel['Customer ID'].kind, 'minor', 'opaque ids sit in small print')
  assert.match(model.undoLine, /undo this later from Activity/i)
})

test('review: the shop rules can block a review before it is shown as approvable', () => {
  const noSend = buildWorkflowReview({ action: 'sendEstimateEmail', payload: { doc_number: 'A', email: 'a@example.test' } }, { rules: normalizeRules({ permissions: { send: 'never' } }) })
  assert.match(noSend.blockedReason, /do not let the assistant/i)

  const noSay = normalizeRules({ neverSay: ['guaranteed lowest price'] })
  const message = buildMessageReview({ channel: 'sms', to: '5551230000', body: 'We have the Guaranteed Lowest Price in town.' }, { rules: noSay })
  assert.match(message.blockedReason, /"guaranteed lowest price"/)
  const clean = buildMessageReview({ channel: 'sms', to: '5551230000', body: 'Your car is ready.' }, { rules: noSay })
  assert.equal(clean.blockedReason, '')

  const switchedOff = buildActionReview({ action: 'voidDocument', payload: { id: 'd1' } }, { rules: normalizeRules({ actionOverrides: { voidDocument: 'never' } }) })
  assert.match(switchedOff.blockedReason, /block "void a document"/i)
})

test('review: a payment can never be approved from here', () => {
  const model = buildActionReview({ action: 'payment.charge', payload: { amount: 50 } }, { rules: normalizeRules({}) })
  assert.match(model.blockedReason, /never takes payments/i)
})

test('review: undoable and risky changes are told apart', () => {
  const status = buildWorkflowReview({ action: 'updateJobStatus', payload: { id: 'job-1', status: 'In Progress' } })
  assert.ok(tagText(status).includes('Can be undone'))
  assert.equal(status.danger, false)
  assert.equal(status.rows[0].label, 'Status')
  assert.equal(status.rows.at(-1).label, 'Record ID')

  const del = buildWorkflowReview({ action: 'deleteRecord', payload: { id: 'x', table: 'customers' } })
  assert.ok(tagText(del).includes('Cannot be undone'))
  assert.equal(del.danger, true)

  const voided = buildWorkflowReview({ action: 'voidDocument', payload: { id: 'd1' } })
  assert.ok(tagText(voided).includes('Can be undone'), 'a void is a status change and can be put back')
  assert.equal(voided.danger, true)
})

test('review: a document draft says nothing is sent or charged', () => {
  const model = buildWorkflowReview({ action: 'createInvoice', payload: { type: 'Estimate', customer_name: 'Jo' } })
  assert.equal(model.title, 'Save this estimate as a draft')
  assert.match(model.effect, /Nothing is emailed, texted, charged or marked paid/)
  assert.equal(model.approveLabel, 'Approve and save draft')
})

test('review: a drafted text shows the recipient, the words and how many texts it will be', () => {
  const model = buildMessageReview({ channel: 'sms', to: '(555) 123-0000', body: 'x'.repeat(200), customerName: 'Maya Chen' })
  assert.equal(model.title, 'Send this text to Maya Chen?')
  assert.equal(model.rows[0].value, 'Maya Chen, (555) 123-0000')
  assert.match(model.rows.find(row => row.label === 'Length').value, /200 characters, 2 texts/)
  assert.match(model.effect, /reaches Maya Chen right away/)
  assert.ok(tagText(model).includes('Cannot be undone'))

  const email = buildMessageReview({ channel: 'email', to: 'jo@example.test', subject: 'Your estimate', body: 'Hello' })
  assert.equal(email.title, 'Send this email?')
  assert.ok(email.rows.some(row => row.label === 'Subject' && row.value === 'Your estimate'))
  assert.ok(!email.rows.some(row => row.label === 'Length'))
  assert.match(email.effect, /reaches the recipient right away/)
})

test('review: connected apps, automations and browser actions are named plainly', () => {
  const post = buildActionReview({ action: 'google_business.reply_review', kind: 'connector', payload: { action: 'reply_review', comment: 'Thank you!', idempotency_key: 'abc' } })
  assert.equal(post.title, 'Google business: reply review')
  assert.ok(tagText(post).includes('Cannot be undone'))
  assert.ok(!post.rows.some(row => row.label === 'Idempotency key'), 'internal keys are never shown')
  assert.equal(post.rows.find(row => row.label === 'Comment').kind, 'words')
  assert.equal(post.editable, false)

  const automation = buildActionReview({ action: 'scheduleTask', kind: 'automation', payload: { name: 'Weekly follow-up', schedule: 'Mondays 9am' } })
  assert.equal(automation.title, 'Schedule an automation')
  assert.ok(tagText(automation).includes('Undo by hand'))

  const browser = buildActionReview({ action: 'webAutomation.browser', kind: 'browser', payload: { url: 'https://example.test' } })
  assert.ok(tagText(browser).includes('Cannot be undone'))
  assert.match(browser.effect, /hosted browser/)

  const shop = buildActionReview({ action: 'createCustomer', payload: { name: 'Maya' } })
  assert.equal(shop.editable, true)
})

test('review: an action nobody has described is treated as the riskiest kind', () => {
  const model = buildActionReview({ action: 'launchRocket', payload: {} })
  assert.ok(tagText(model).includes('Cannot be undone'))
  assert.equal(model.title, 'Launch rocket')
})

test('review: values are shown the way a person reads them', () => {
  assert.equal(formatValue('retail_price', 12.5), '$12.50')
  assert.equal(formatValue('tax_rate', 8.25), '8.25%')
  assert.equal(formatValue('labor_rate', 120), '$120.00 per hour')
  assert.equal(formatValue('qty_on_hand', 4), '4')
  assert.equal(formatValue('apply_tax', false), 'No')
  assert.equal(formatValue('email', null), 'Not provided')
  assert.equal(formatValue('tags', ['vip', 'fleet']), 'vip, fleet')
  assert.equal(formatValue('scheduled_for', '2030-01-02T15:00:00.000Z', 'UTC'), 'Wed, Jan 2, 2030, 3:00 PM')
  assert.equal(formatValue('scheduled_for', 'tomorrow'), 'tomorrow')
  assert.equal(labelFor('vehicle_year'), 'Vehicle year')
  assert.equal(labelFor('docNumber'), 'Doc number')
  assert.deepEqual(payloadRows({ shop_id: 's', approval: 'confirm', name: 'A' }), [{ label: 'Name', value: 'A', kind: 'text' }])
})

test('review: text length counts plain and special-letter messages differently', () => {
  assert.deepEqual(smsSegments(''), { characters: 0, texts: 0, unicode: false })
  assert.deepEqual(smsSegments('a'.repeat(160)), { characters: 160, texts: 1, unicode: false })
  assert.deepEqual(smsSegments('a'.repeat(161)), { characters: 161, texts: 2, unicode: false })
  assert.equal(smsSegments('Ready \u{1F697}').unicode, true)
  assert.equal(smsSegments('a'.repeat(71) + '\u{1F697}').texts, 2)
  assert.equal(smsSegments('Price is €40').unicode, false, 'the euro sign is in the plain set')
})
