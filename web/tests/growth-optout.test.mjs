import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withOptOut, OPT_OUT_LINE } from '../src/lib/growth-text.ts'

const routes = ['reviews', 'follow-ups', 'estimate-followups', 'service-reminders', 'outreach']

test('every marketing text the server sends goes through withOptOut', () => {
  for (const r of routes) {
    const src = readFileSync(new URL(`../src/app/api/growth/${r}/route.ts`, import.meta.url), 'utf8')
    assert.match(src, /from '@\/lib\/growth-text'/, `${r} imports growth-text`)
    assert.match(src, /withOptOut\(/, `${r} wraps its text with withOptOut`)
  }
})

test('the opt-out line is added once and never doubled', () => {
  assert.equal(withOptOut('Hi Sam! Time for an oil change.'), `Hi Sam! Time for an oil change. ${OPT_OUT_LINE}`)
  assert.equal(withOptOut(`Hi Sam! ${OPT_OUT_LINE}`), `Hi Sam! ${OPT_OUT_LINE}`)
  assert.equal(withOptOut('Reply stop to unsubscribe'), 'Reply stop to unsubscribe')
  assert.equal(withOptOut(withOptOut('Hello')), withOptOut('Hello'))
})

test('appointment reminders stay plain (they are service messages, not marketing)', () => {
  const src = readFileSync(new URL('../src/app/api/growth/service-reminders/route.ts', import.meta.url), 'utf8')
  const appt = src.slice(src.indexOf('Reminder: you have an appointment') - 80, src.indexOf('Reminder: you have an appointment') + 60)
  assert.doesNotMatch(appt, /withOptOut/)
})
