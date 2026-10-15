import test from 'node:test'
import assert from 'node:assert/strict'
import { plainError, textProblem, phoneTail } from '../src/components/appointments/errors.ts'

test('plainError turns database and network messages into plain words', () => {
  assert.match(plainError({ message: 'new row violates row-level security policy for table "appointments"' }, 'x'), /not allowed to change the schedule/)
  assert.match(plainError(new Error('Failed to fetch'), 'x'), /No connection/)
  assert.match(plainError(new Error('JWT expired'), 'x'), /signed out/)
  assert.match(plainError(new Error('No shop is associated with the signed-in user'), 'x'), /could not find your shop/i)
  assert.match(plainError({ message: 'null value in column "date" violates not-null constraint' }, 'x'), /not accepted/)
})

test('plainError keeps a short readable message and falls back for the rest', () => {
  assert.equal(plainError(new Error('Appointment is locked'), 'fallback'), 'Appointment is locked.')
  assert.equal(plainError({ message: 'relation "appointments" does not exist' }, 'fallback'), 'fallback')
  assert.equal(plainError(null, 'fallback'), 'fallback')
  assert.equal(plainError('x'.repeat(200), 'fallback'), 'fallback')
})

test('textProblem explains every way a text can fail', () => {
  assert.match(textProblem(409, 'This destination has opted out of SMS'), /replied STOP/)
  assert.match(textProblem(409, 'The recipient phone does not match the selected customer'), /not the one saved/)
  assert.match(textProblem(409, 'More than one customer matches this phone number; select a customer explicitly'), /Two customers share/)
  assert.match(textProblem(503, 'Telnyx SMS is not configured for this shop'), /not set up/)
  assert.match(textProblem(429, 'Too many message requests'), /Too many texts/)
  assert.match(textProblem(401, ''), /signed out/)
  assert.match(textProblem(403, ''), /Ask the shop owner/)
  assert.match(textProblem(0, ''), /Inbox before sending again/)
  assert.match(textProblem(502, 'The SMS outcome is uncertain; reconcile before retrying'), /Inbox before you send it again/)
  assert.match(textProblem(500, ''), /did not send/)
})

test('phoneTail compares numbers whatever the punctuation', () => {
  assert.equal(phoneTail('(713) 555-0109'), '7135550109')
  assert.equal(phoneTail('+1 713-555-0109'), '7135550109')
  assert.equal(phoneTail(null), '')
})
