import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAutoZoneCategoryEvidence } from '../src/lib/ai/autozone-category-parser.js'

const categoryUrl = 'https://www.autozone.com/brakes-and-traction-control/brake-rotor/honda/accord/2005'
const allowed = url => url === categoryUrl

test('parses only contiguous AutoZone product blocks with a product, descriptor, and one price', () => {
  const parsed = parseAutoZoneCategoryEvidence([{
    title: 'AutoZone fitment category (Tavily extract)',
    url: categoryUrl,
    content: `Duralast Brake Rotor\nFront\nPart # 31275DL\n$108.99\n\nDuralast Gold Brake Rotor\nRear\nPart # 31312DG\n$119.99`,
  }], allowed)

  assert.equal(parsed.options.length, 1)
  assert.equal(parsed.options[0].parts.length, 2)
  assert.deepEqual(parsed.options[0].parts.map(part => [part.name, part.partNumber, part.position, part.price]), [
    ['Duralast Brake Rotor', '31275DL', 'Front', 108.99],
    ['Duralast Gold Brake Rotor', '31312DG', 'Rear', 119.99],
  ])
  assert.equal(parsed.options[0].parts[0].url, categoryUrl)
  assert.equal(parsed.options[0].parts[0].evidenceQuote.includes('$108.99'), true)
})

test('uses the next explicit product identity as a boundary when blank lines are collapsed', () => {
  const parsed = parseAutoZoneCategoryEvidence([{
    title: 'AutoZone fitment category (Tavily extract)',
    url: categoryUrl,
    content: `Duralast Brake Rotor\nFront\nPart # 31275DL\n$108.99\nDuralast Gold Brake Rotor\nRear\nPart # 31312DG\n$119.99`,
  }], allowed)

  assert.equal(parsed.options[0].parts.length, 2)
  assert.equal(parsed.options[0].parts[1].position, 'Rear')
})

test('rejects ambiguous, flattened, and non-category blocks without inventing positions', () => {
  const parsed = parseAutoZoneCategoryEvidence([
    {
      title: 'AutoZone fitment category',
      url: categoryUrl,
      content: 'Duralast Brake Rotor Front Part # 31275DL $108.99 $119.99',
    },
    {
      title: 'AutoZone fitment category',
      url: categoryUrl,
      content: 'Duralast Brake Rotor\nPart # 31275DL\n$108.99',
    },
    {
      title: 'AutoZone search result',
      url: categoryUrl,
      content: 'Duralast Brake Rotor\nFront\nPart # 31275DL\n$108.99',
    },
  ], allowed)

  assert.equal(parsed.options.length, 1)
  assert.equal(parsed.options[0].parts.length, 1)
  assert.equal(parsed.options[0].parts[0].position, '')
  assert.equal(parsed.options[0].parts[0].name, 'Duralast Brake Rotor')
})
