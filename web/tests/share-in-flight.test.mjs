import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shareInFlight } from '../src/lib/share-in-flight.ts'

test('callers who ask while a load is running share that one load', async () => {
  let runs = 0
  let release
  const gate = new Promise(r => { release = r })
  const get = shareInFlight(async () => { runs += 1; await gate; return { n: runs } })
  const a = get(), b = get(), c = get()
  assert.equal(runs, 1)
  release()
  const [x, y, z] = await Promise.all([a, b, c])
  assert.equal(x, y)
  assert.equal(y, z)
  assert.equal(runs, 1)
})

test('nothing is kept after it answers: the next call loads fresh', async () => {
  let runs = 0
  const get = shareInFlight(async () => ++runs)
  assert.equal(await get(), 1)
  assert.equal(await get(), 2)
  assert.equal(await Promise.all([get(), get()]).then(r => r.join()), '3,3')
})

test('a failed load is shared with the callers who were waiting, then the next call tries again', async () => {
  let runs = 0
  const get = shareInFlight(async () => { runs += 1; if (runs === 1) throw new Error('offline'); return 'ok' })
  const first = [get(), get()]
  const settled = await Promise.allSettled(first)
  assert.deepEqual(settled.map(s => s.status), ['rejected', 'rejected'])
  assert.equal(runs, 1)
  assert.equal(await get(), 'ok')
  assert.equal(runs, 2)
})

test('the shop profile is read through it, so the shell and the page make one set of calls', () => {
  const src = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  assert.match(src, /export const getShopProfile = shareInFlight\(loadShopProfile\)/)
})
