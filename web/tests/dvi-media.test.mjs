import test from 'node:test'
import assert from 'node:assert/strict'
import * as m from '../src/lib/dvi-media.ts'

test('only photos, short videos and voice notes are accepted, within size', () => {
  assert.deepEqual(m.checkUpload('image/jpeg', 200_000), { ok: true, kind: 'photo', ext: 'jpg' })
  assert.deepEqual(m.checkUpload('video/mp4', 9_000_000), { ok: true, kind: 'video', ext: 'mp4' })
  assert.deepEqual(m.checkUpload('audio/webm;codecs=opus', 90_000), { ok: true, kind: 'audio', ext: 'webm' })
  for (const bad of ['text/html', 'image/svg+xml', 'application/pdf', 'image/gif', '', undefined]) assert.equal(m.checkUpload(bad, 1000).ok, false, String(bad))
  assert.equal(m.checkUpload('image/jpeg', 0).ok, false)
  assert.equal(m.checkUpload('image/jpeg', 'abc').ok, false)
  assert.match(m.checkUpload('image/jpeg', 9_000_000).error, /too large/)
  assert.match(m.checkUpload('video/mp4', 90_000_000).error, /25 MB/)
  assert.equal(m.baseType('Audio/WEBM; codecs=opus'), 'audio/webm')
})

test('names are long, plain and different every time', () => {
  const a = m.newMediaName(), b = m.newMediaName()
  assert.match(a, /^[a-z0-9]{20}$/)
  assert.notEqual(a, b)
  assert.equal(m.newMediaName(() => 0), '00000000000000000000')
})

test('a recording length reads like a clock', () => {
  assert.equal(m.clockText(7), '0:07')
  assert.equal(m.clockText(75.4), '1:15')
  assert.equal(m.clockText(-4), '0:00')
})

test('the recorder picks the best format the phone can write', () => {
  const only = (...ok) => t => ok.includes(t)
  assert.equal(m.pickRecorderType('video', only('video/mp4', 'video/webm')), 'video/mp4')
  assert.equal(m.pickRecorderType('video', only('video/webm')), 'video/webm')
  assert.equal(m.pickRecorderType('audio', only('audio/webm;codecs=opus')), 'audio/webm;codecs=opus')
  assert.equal(m.pickRecorderType('audio', () => false), '')
  assert.equal(m.pickRecorderType('audio', () => { throw new Error('nope') }), '')
  // everything it can pick is something the server accepts
  for (const kind of ['video', 'audio']) for (const t of m.RECORDER_TYPES[kind]) assert.equal(m.checkUpload(t, 1000).ok, true, t)
  assert.ok(m.MAX_SECONDS.video < m.MAX_SECONDS.audio)
})
