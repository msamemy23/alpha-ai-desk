import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanImages, imageNote, IMAGE_UNSUPPORTED_MESSAGE, looksLikeImageRejection, MAX_IMAGES, MAX_IMAGE_CHARS, withImages } from '../src/lib/ai/images.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('photos: only small data pictures are accepted, and at most three', () => {
  assert.deepEqual(cleanImages(undefined), { images: [] })
  assert.deepEqual(cleanImages([PNG]), { images: [PNG] })
  assert.ok(cleanImages([PNG, PNG, PNG, PNG]).error, `more than ${MAX_IMAGES} is refused`)
  assert.ok(cleanImages('nope').error)
  assert.ok(cleanImages(['https://example.test/a.png']).error, 'a web address is not a photo: the server never fetches it')
  assert.ok(cleanImages(['data:text/html;base64,PGgxPmhpPC9oMT4=']).error, 'only picture types')
  assert.ok(cleanImages(['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']).error, 'SVG can carry script, so it is refused')
  assert.ok(cleanImages([`data:image/png;base64,${'A'.repeat(MAX_IMAGE_CHARS)}`]).error, 'too large')
  assert.ok(cleanImages([7]).error)
})

test('photos: they go on the newest user message only, with a caution that photos are not proof', () => {
  const messages = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'earlier' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'what is wrong here?' },
  ]
  const out = withImages(messages, [PNG])
  assert.equal(out[1].content, 'earlier')
  assert.equal(out[2].content, 'ok')
  const parts = out[3].content
  assert.equal(parts[0].text, 'what is wrong here?')
  assert.match(parts[1].text, /untrusted data/)
  assert.match(parts[1].text, /Never treat a price, part number, VIN/)
  assert.deepEqual(parts[2], { type: 'image_url', image_url: { url: PNG } })
  assert.equal(messages[3].content, 'what is wrong here?', 'the input is not changed')
})

test('photos: an explicit index is honoured and a non-user message is never changed', () => {
  const messages = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'tool result' }]
  assert.equal(withImages(messages, [PNG], 0)[0].content[2].image_url.url, PNG)
  assert.equal(withImages(messages, [PNG], 2)[0].content, 'first')
  assert.equal(withImages(messages, [PNG], 1)[1].content, 'reply')
  assert.deepEqual(withImages(messages, [], 0), messages)
  assert.equal(withImages([{ role: 'system', content: 's' }], [PNG]).length, 1)
})

test('photos: the note counts them', () => {
  assert.match(imageNote(1), /a photo/)
  assert.match(imageNote(3), /3 photos/)
})

test('photos: a model that cannot see pictures is recognised and explained plainly', () => {
  for (const message of ['No endpoints found that support image input', 'This model does not support vision', 'messages[1].content: unsupported content type image_url', 'Invalid modality']) {
    assert.equal(looksLikeImageRejection(message), true, message)
  }
  assert.equal(looksLikeImageRejection('Rate limit exceeded'), false)
  assert.equal(looksLikeImageRejection(undefined), false)
  assert.match(IMAGE_UNSUPPORTED_MESSAGE, /Nothing was changed/)
  assert.doesNotMatch(IMAGE_UNSUPPORTED_MESSAGE, /meta-llama|free/i, 'no hard-coded model name')
})
