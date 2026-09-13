const CURRENCY_PRICE_PATTERN = /(?:\$\s*|USD\s+)(\d+)(?:[.\s](\d{2}))?(?![\d.])/gi
const DOLLARS_PRICE_PATTERN = /\b(\d+)\s+dollars?(?:\s+and\s+(\d{1,2})\s+cents?)?\b/gi

function priceValue(dollars, cents) {
  const value = Number(`${dollars}.${cents ? cents.padStart(2, '0') : '00'}`)
  return Number.isFinite(value) && value > 0 ? value : null
}

function priceRepresentationKind(raw) {
  if (/\bdollars?\b|\bcents?\b/i.test(raw)) return 'worded'
  if (/\$|\bUSD\b/i.test(raw)) return 'currency'
  return 'unknown'
}

function collapsedCurrencyValue(raw) {
  if (!/^\s*\$\s*\d{4,}\s*$/i.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return null
  return priceValue(digits.slice(0, -2), digits.slice(-2))
}

function normalizeCollapsedCurrencyRenderings(matches) {
  return matches.map(match => {
    if (priceRepresentationKind(match.raw) !== 'currency') return match
    const collapsedValue = collapsedCurrencyValue(match.raw)
    if (collapsedValue === null) return match
    const adjacentWorded = matches.find(other =>
      priceRepresentationKind(other.raw) === 'worded'
      && other.value === collapsedValue
      && Math.abs(match.index - other.index) <= 96
    )
    return adjacentWorded ? { ...match, value: collapsedValue } : match
  })
}

function deduplicateEquivalentRenderings(matches) {
  const deduplicated = []
  for (const match of matches) {
    const kind = priceRepresentationKind(match.raw)
    const duplicate = deduplicated.some(previous => {
      if (previous.value !== match.value || match.index - previous.index > 96) return false
      const previousKind = priceRepresentationKind(previous.raw)
      return (previousKind === 'worded' && kind === 'currency') || (previousKind === 'currency' && kind === 'worded')
    })
    if (!duplicate) deduplicated.push(match)
  }
  return deduplicated
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
  const sorted = matches.sort((left, right) => left.index - right.index)
  return deduplicateEquivalentRenderings(normalizeCollapsedCurrencyRenderings(sorted))
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

