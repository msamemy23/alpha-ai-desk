import test from 'node:test'
import assert from 'node:assert/strict'
import { isVerifiedRetailerPricePage, retailerOf, verifyRetailerLeads, visiblePrice } from '../src/lib/browser/price-evidence.ts'

test('only the three parts stores count, and only over https', () => {
  assert.equal(retailerOf('https://www.autozone.com/brakes/p/123'), 'AutoZone')
  assert.equal(retailerOf('https://www.oreillyauto.com/detail/c/x'), "O'Reilly")
  assert.equal(retailerOf('https://www.napaonline.com/en/p/ABC'), 'NAPA')
  assert.equal(retailerOf('http://www.autozone.com/x'), null)
  assert.equal(retailerOf('https://autozone.com.evil.example/x'), null)
  assert.equal(retailerOf('https://notautozone.com/x'), null)
  assert.equal(retailerOf('not a url'), null)
})

test('a price is the part\'s own price, not a coupon, a shipping threshold or a was-price', () => {
  assert.equal(visiblePrice('Save $10 on orders over $35. Duralast Gold Brake Pads $54.99 In stock')?.price, 54.99)
  assert.equal(visiblePrice('Was $80.00 Now $64.50 Add to cart')?.price, 64.5)
  assert.equal(visiblePrice('Free shipping on orders over $35 · $20 off $100 · Earn $5 in rewards'), null)
  assert.equal(visiblePrice('Starter motor 1,249.99 dollars'), null, 'no dollar sign means no verified price')
  assert.equal(visiblePrice('Price $1,249.99 each')?.price, 1249.99)
  assert.equal(visiblePrice('No results found for "brake pads" $12.00 suggested'), null)
  assert.equal(visiblePrice('Core charge $0.00'), null)
  assert.equal(visiblePrice(''), null)
})

test('a page is verified only when it is a parts store and shows a price', () => {
  assert.equal(isVerifiedRetailerPricePage('https://www.autozone.com/p/1', 'Brake pad set $54.99'), true)
  assert.equal(isVerifiedRetailerPricePage('https://www.autozone.com/p/1', 'Brake pad set. Sign in to see price'), false)
  assert.equal(isVerifiedRetailerPricePage('https://example.com/p/1', 'Brake pad set $54.99'), false)
})

test('search snippets are never read as prices; only store pages that show a price come back', async () => {
  const leads = [
    { title: 'Forum: best pads', url: 'https://forum.example.com/t/1', snippet: 'I paid $40' },
    { title: 'AutoZone pads', url: 'https://www.autozone.com/p/1', snippet: '$54.99' },
    { title: 'AutoZone pads again', url: 'https://www.autozone.com/p/1', snippet: 'same page' },
    { title: 'NAPA pads', url: 'https://www.napaonline.com/p/2', snippet: '' },
    { title: 'Oreilly pads', url: 'https://www.oreillyauto.com/p/3', snippet: '' },
  ]
  const opened = []
  const read = async (url) => {
    opened.push(url)
    if (url.includes('autozone')) return { ok: true, title: 'Duralast Brake Pads', finalUrl: url, text: 'Duralast Gold $54.99 In stock' }
    if (url.includes('napaonline')) return { ok: true, title: 'NAPA pads', finalUrl: url, text: 'Sign in to see your price' }
    throw new Error('boom')
  }
  const found = await verifyRetailerLeads(leads, read, 3)
  assert.deepEqual(found.map(f => [f.store, f.price]), [['AutoZone', 54.99]])
  assert.equal(found[0].url, 'https://www.autozone.com/p/1')
  assert.deepEqual(opened.sort(), ['https://www.autozone.com/p/1', 'https://www.napaonline.com/p/2', 'https://www.oreillyauto.com/p/3'], 'the forum is never opened and no page is read twice')
})

test('a redirect off the parts store proves nothing', async () => {
  const found = await verifyRetailerLeads([{ title: 't', url: 'https://www.autozone.com/p/1', snippet: '' }], async () => ({ ok: true, title: 'x', finalUrl: 'https://elsewhere.example/p', text: 'Pads $19.99' }))
  assert.deepEqual(found, [])
})

test('no leads and unreadable pages give an empty answer, never a guess', async () => {
  assert.deepEqual(await verifyRetailerLeads([], async () => ({ ok: false })), [])
  assert.deepEqual(await verifyRetailerLeads([{ title: 't', url: 'https://www.napaonline.com/p/2', snippet: '$9.99' }], async () => ({ ok: false })), [])
})
