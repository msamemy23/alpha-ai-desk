import test from 'node:test'
import assert from 'node:assert/strict'
import { MIN_BOX, boxFromDrag, fitSize, stripBox } from '../src/lib/posts-cover.ts'

test('fitSize shrinks the long side to 1600 and keeps the shape', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1600, height: 1200 })
  assert.deepEqual(fitSize(3000, 4000), { width: 1200, height: 1600 })
})

test('fitSize never enlarges and never returns zero', () => {
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 })
  assert.deepEqual(fitSize(0, 0), { width: 1, height: 1 })
  assert.deepEqual(fitSize(10000, 1), { width: 1600, height: 1 })
})

test('boxFromDrag works in any drag direction', () => {
  assert.deepEqual(boxFromDrag(10, 20, 110, 70, 400, 300), { x: 10, y: 20, w: 100, h: 50 })
  assert.deepEqual(boxFromDrag(110, 70, 10, 20, 400, 300), { x: 10, y: 20, w: 100, h: 50 })
})

test('boxFromDrag keeps the box inside the photo', () => {
  assert.deepEqual(boxFromDrag(-50, -50, 100, 100, 400, 300), { x: 0, y: 0, w: 100, h: 100 })
  assert.deepEqual(boxFromDrag(300, 200, 900, 900, 400, 300), { x: 300, y: 200, w: 100, h: 100 })
})

test('boxFromDrag ignores a stray touch and bad numbers', () => {
  assert.equal(boxFromDrag(10, 10, 10 + MIN_BOX - 1, 100, 400, 300), null)
  assert.equal(boxFromDrag(10, 10, 100, 10 + MIN_BOX - 1, 400, 300), null)
  assert.equal(boxFromDrag(Number.NaN, 0, 100, 100, 400, 300), null)
  assert.equal(boxFromDrag(0, 0, 100, 100, 0, 300), null)
})

test('stripBox covers a full-width third', () => {
  assert.deepEqual(stripBox('top', 300, 300), { x: 0, y: 0, w: 300, h: 100 })
  assert.deepEqual(stripBox('middle', 300, 300), { x: 0, y: 100, w: 300, h: 100 })
  assert.deepEqual(stripBox('bottom', 300, 300), { x: 0, y: 200, w: 300, h: 100 })
})
