const CURRENCY_PRICE_PATTERN = /(?:\$\s*|USD\s+)(\d+)(?:[.\s](\d{2}))?(?![\d.])/gi
const DOLLARS_PRICE_PATTERN = /\b(\d+)\s+dollars?(?:\s+and\s+(\d{1,2})\s+cents?)?\b/gi

function priceValue(dollars, cents) {
  const value = Number(`${dollars}.${cents ? cents.padStart(2, '0') : '00'}`)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Finds only explicit money representations. Bare numbers, part numbers,
 * years, and quantities are deliberately never accepted as prices.
 */
function visiblePriceMatches(value) {
  if (typeof value !== 'string') return []
  const normalized = value.replace(/,/g, '')
  const matches = []
  for (const match of normalized.matchAll(CURRENCY_PRICE_PATTERN)) {
    const price = priceValue(match[1], match[2])
    if (price !== null) matches.push({ value: price, index: match.index || 0, raw: match[0] })
  }
  for (const match of normalized.matchAll(DOLLARS_PRICE_PATTERN)) {
    const price = priceValue(match[1], match[2])
    if (price !== null) matches.push({ value: price, index: match.index || 0, raw: match[0] })
  }
  return matches.sort((left, right) => left.index - right.index)
}

function hasVisiblePrice(value) {
  return visiblePriceMatches(value).length > 0
}

function priceAppearsInEvidence(price, evidence) {
  const expected = typeof price === 'number' ? price : Number(price)
  return Number.isFinite(expected) && expected > 0 && visiblePriceMatches(evidence).some(match => match.value === expected)
}

function hasExactlyOneVisiblePrice(price, evidence) {
  const expected = typeof price === 'number' ? price : Number(price)
  const matches = visiblePriceMatches(evidence)
  return Number.isFinite(expected) && matches.length === 1 && matches[0].value === expected
}

module.exports = { visiblePriceMatches, hasVisiblePrice, priceAppearsInEvidence, hasExactlyOneVisiblePrice }
