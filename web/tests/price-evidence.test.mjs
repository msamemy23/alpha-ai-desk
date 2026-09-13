import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasExactlyOneVisiblePrice, hasVisiblePrice, priceAppearsInEvidence, visiblePriceMatches } from '../src/lib/ai/price-evidence.js'
import { parseAutoZoneCategoryEvidence } from '../src/lib/ai/autozone-category-parser.js'

test('recognizes explicit currency and AutoZone dollars-and-cents prices, but not naked numbers', () => {
  assert.deepEqual([
    visiblePriceMatches('$52.99')[0].value,
    visiblePriceMatches('$52 99')[0].value,
    visiblePriceMatches('USD 52.99')[0].value,
    visiblePriceMatches('52 dollars and 99 cents')[0].value,
    visiblePriceMatches('52 dollars')[0].value,
  ], [52.99, 52.99, 52.99, 52.99, 52])
  assert.equal(hasVisiblePrice('Part 31275DL fits 2005 Honda Accord'), false)
  assert.equal(priceAppearsInEvidence(52.99, 'THE PRICE OF THIS ITEM IS: 52 DOLLARS AND 99 CENTS'), true)
  assert.equal(hasExactlyOneVisiblePrice(52, 'THE PRICE OF THIS ITEM IS: 52 DOLLARS'), true)
})

test('deduplicates adjacent worded and accessibility renderings of the same price', () => {
  const evidence = 'The price of this item is: 52 dollars and 99 cents\n$\n52\n99'
  assert.deepEqual(visiblePriceMatches(evidence).map(match => match.value), [52.99])
  assert.equal(hasExactlyOneVisiblePrice(52.99, evidence), true)

  const differentPrices = 'The price of this item is: 52 dollars and 99 cents\nThe price of this item is: 53 dollars and 99 cents'
  assert.deepEqual(visiblePriceMatches(differentPrices).map(match => match.value), [52.99, 53.99])
  assert.equal(hasExactlyOneVisiblePrice(52.99, differentPrices), false)
})

test('worded AutoZone prices remain bound to one contiguous product block', () => {
  const url = 'https://www.autozone.com/brakes-and-traction-control/brake-rotor/honda/accord/2005'
  const parsed = parseAutoZoneCategoryEvidence([{
    title: 'AutoZone fitment category (Tavily extract)',
    url,
    content: 'Duralast Brake Rotor\nFront\nPart # 31275DL\nTHE PRICE OF THIS ITEM IS: 52 DOLLARS AND 99 CENTS',
  }], candidate => candidate === url)
  assert.equal(parsed.options[0].parts[0].price, 52.99)
  assert.equal(parsed.options[0].parts[0].evidenceQuote.includes('52 DOLLARS AND 99 CENTS'), true)

  const ambiguous = parseAutoZoneCategoryEvidence([{
    title: 'AutoZone fitment category (Tavily extract)',
    url,
    content: 'Duralast Brake Rotor\nFront\nPart # 31275DL\n52 DOLLARS AND 99 CENTS\n53 DOLLARS AND 99 CENTS',
  }], candidate => candidate === url)
  assert.equal(ambiguous.options.length, 0)
})

