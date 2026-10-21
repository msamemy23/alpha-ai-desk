import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { describeFailure } from '../src/lib/ai/chat-failure.ts'
import { recentAsksFrom, suggestPrompts } from '../src/lib/ai/suggestions.ts'

const MID = new Date(2026, 0, 14, 10, 0)
const chat = (id, ...messages) => ({ id, messages: messages.map(([role, content, extra]) => ({ role, content, ...(extra || {}) })) })
const STOP_NOTICE = 'Stopped by you. Nothing was sent or changed.'
const GREETING = ['assistant', "Hi, I'm Alpha, your shop assistant."]

test('failed turns are told apart from answers, stops and everything else', () => {
  assert.equal(describeFailure('AI error: The model is busy.')?.kind, 'failed')
  assert.equal(describeFailure('Ran into an issue: lookup timed out. Try again.')?.kind, 'failed')
  assert.equal(describeFailure('Repair lookup failed: no results.')?.kind, 'failed')
  assert.equal(describeFailure('Image analysis failed: too large.')?.kind, 'failed')
  assert.equal(describeFailure('Desktop action failed: no window.')?.kind, 'failed')
  assert.equal(describeFailure(STOP_NOTICE)?.kind, 'stopped')
  assert.equal(describeFailure('AI error: AbortError: signal is aborted')?.kind, 'stopped')
  assert.equal(describeFailure('You have 3 open jobs.'), null)
})

test('a question whose answer was an error is not offered again', () => {
  const history = [
    chat('c1', GREETING, ['user', 'How much revenue did we make last week?'], ['assistant', 'AI error: The model is busy right now.']),
    chat('c2', GREETING, ['user', 'Which customers have unpaid invoices?'], ['assistant', 'Three customers owe money.']),
    chat('c3', GREETING, ['user', 'Look up a 2012 Silverado P0300'], ['assistant', 'Repair lookup failed: no sources found. Try again.']),
    chat('c4', GREETING, ['user', 'Text everyone that we are closed Monday'], ['assistant', 'Ran into an issue: texting is not set up.']),
  ]
  assert.deepEqual(recentAsksFrom(history, null), ['Which customers have unpaid invoices?'])
})

test('failed questions never reach the start screen, but the other questions still do', () => {
  const history = [
    chat('c1', GREETING, ['user', 'How much revenue did we make last week?'], ['assistant', 'AI error: The model is busy right now.']),
    chat('c2', GREETING, ['user', 'Which customers have unpaid invoices?'], ['assistant', 'Three customers owe money.']),
    chat('c3', GREETING, ['user', 'Find a brake pad price for a 2016 Camry'], ['assistant', 'Here are the prices I found.']),
  ]
  const list = suggestPrompts({ now: MID, openJobs: 3, recentAsks: recentAsksFrom(history, null) })
  const again = list.filter(item => item.title === 'Ask again').map(item => item.prompt)
  assert.deepEqual(again, ['Which customers have unpaid invoices?', 'Find a brake pad price for a 2016 Camry'])
  assert.equal(list.some(item => item.prompt.includes('revenue did we make last week')), false)
})

test('a stopped question, an unanswered one, and one that was retried and answered are still offered', () => {
  const history = [
    chat('stopped', GREETING, ['user', 'Summarise this month for me please'], ['assistant', STOP_NOTICE]),
    chat('unanswered', GREETING, ['user', 'Who is due for an oil change?']),
    chat('retried', GREETING, ['user', 'List the open estimates'], ['assistant', 'AI error: The model is busy.'], ['assistant', 'There are 4 open estimates.']),
  ]
  assert.deepEqual(recentAsksFrom(history, null), ['Summarise this month for me please', 'Who is due for an oil change?', 'List the open estimates'])
})

test('a later failed question does not hide an earlier question that was answered', () => {
  const history = [chat('c1', GREETING,
    ['user', 'What jobs are open right now?'], ['assistant', 'Five jobs are open.'],
    ['user', 'Text them all'], ['assistant', 'AI error: not allowed.'])]
  assert.deepEqual(recentAsksFrom(history, null), ['What jobs are open right now?'])
  // and the reverse: the first question failed, so that chat offers nothing, even though a later one worked
  const reversed = [chat('c2', GREETING,
    ['user', 'What jobs are open right now?'], ['assistant', 'AI error: busy.'],
    ['user', 'Who owes us money?'], ['assistant', 'Two customers.'])]
  assert.deepEqual(recentAsksFrom(reversed, null), [])
})

test('the open chat is left out, empty chats are skipped, and the list is capped', () => {
  const history = [
    chat('open', GREETING, ['user', 'The question typed in this very chat'], ['assistant', 'Done.']),
    chat('empty', GREETING),
    ...Array.from({ length: 12 }, (_, i) => chat(`c${i}`, GREETING, ['user', `Question number ${i} about the shop`], ['assistant', 'Answer.'])),
  ]
  const asks = recentAsksFrom(history, 'open')
  assert.equal(asks.length, 8)
  assert.equal(asks[0], 'Question number 0 about the shop')
  assert.equal(asks.includes('The question typed in this very chat'), false)
  assert.equal(recentAsksFrom(history, 'open', 3).length, 3)
})

test('an answer that carries a page or repair card is not mistaken for an error', () => {
  const history = [chat('c1', GREETING, ['user', 'Show me the estimate page'], ['assistant', 'Repair lookup failed earlier, but here it is.', { html: '<p>ok</p>' }])]
  assert.deepEqual(recentAsksFrom(history, null), ['Show me the estimate page'])
})

test('Ask Alpha reads its start-screen questions through the helper, and failed chats stay in History', () => {
  const page = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /const recentAsks = recentAsksFrom\(history, chatSessionIdRef\.current\)/)
  assert.match(page, /from '@\/lib\/ai\/chat-failure'/)
  assert.doesNotMatch(page, /const FAILURE_PREFIXES|function describeFailure|const STOP_PATTERN/)
  // the History list still shows every saved chat, failed or not
  assert.match(page, /history\.filter\(h => !needle \|\| h\.preview/)
})
