const PRICE_PATTERN = /(?:\$\s*|USD\s+)(\d+)(?:[.\s](\d{2}))?(?![\d.])/gi
const PRODUCT_PATTERN = /\b(?:brake\s+(?:pads?|rotors?)|pads?|rotors?)\b/i
const DESCRIPTOR_PATTERN = /(?:\b(?:part|sku)\s*(?:#|number|no\.)?\s*[A-Z0-9-]{3,}\b|\b(?:front|rear|left|right)\b|\b(?:set|pair|pack|includes?|hardware)\b)/i

function parsePrice(block) {
  const matches = [...block.replace(/,/g, '').matchAll(PRICE_PATTERN)]
  if (matches.length !== 1) return null
  const price = Number(`${matches[0][1]}${matches[0][2] ? `.${matches[0][2]}` : ''}`)
  return Number.isFinite(price) && price > 0 ? price : null
}

function productNameFromBlock(block) {
  return block
    .split(/\n+/)
    .map(line => line.trim().replace(/^[-*#\s]+/, ''))
    .find(line => line.length >= 5 && line.length <= 180 && PRODUCT_PATTERN.test(line) && !/(?:part|sku)\s*(?:#|number|no\.)?\s*[A-Z0-9-]{3,}/i.test(line) && !/(?:\$|USD\s+)\d/i.test(line)) || ''
}

function partNumberFromBlock(block) {
  const labeled = block.match(/\b(?:part|sku)\s*(?:#|number|no\.)?\s*[:#-]?\s*([A-Z0-9-]{3,})\b/i)
  return labeled ? labeled[1].toUpperCase() : ''
}

function statedPosition(block) {
  const text = block.toLowerCase()
  const front = /\bfront\b/.test(text)
  const rear = /\brear\b/.test(text)
  const left = /\bleft\b/.test(text)
  const right = /\bright\b/.test(text)
  if (front && left && !right) return 'Front Left'
  if (front && right && !left) return 'Front Right'
  if (rear && left && !right) return 'Rear Left'
  if (rear && right && !left) return 'Rear Right'
  if (front && !rear) return 'Front'
  if (rear && !front) return 'Rear'
  return ''
}

function brandFromName(name) {
  const firstWord = name.match(/^[A-Za-z][A-Za-z0-9'-]*/)
  return firstWord ? firstWord[0] : 'AutoZone'
}

function sourceBlocks(content) {
  const paragraphs = content
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\[\.\.\.\]/)
    .map(block => block.split(/\n+/).map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean))
    .filter(lines => lines.length > 0)

  return paragraphs.flatMap(lines => {
    const blocks = []
    let current = []
    let currentHasPrice = false
    for (const line of lines) {
      // Extract output can collapse blank lines. Once a priced product block
      // is complete, the next explicit product identity starts a new block.
      if (current.length && currentHasPrice && PRODUCT_PATTERN.test(line)) {
        blocks.push(current.join('\n'))
        current = []
        currentHasPrice = false
      }
      current.push(line)
      if (parsePrice(line) !== null) currentHasPrice = true
    }
    if (current.length) blocks.push(current.join('\n'))
    return blocks
  })
}

/**
 * Produces only source-backed category items. It intentionally rejects a
 * flattened/multi-price section rather than combining a name from one product
 * row with a price from another.
 */
function parseAutoZoneCategoryEvidence(results, isAllowedCategoryUrl) {
  const parts = []
  const kits = []

  for (const result of results) {
    if (!result || !/^AutoZone fitment category(?: \(Tavily extract\))?$/.test(result.title || '') || !isAllowedCategoryUrl(result.url || '')) continue
    for (const block of sourceBlocks(result.content || '')) {
      const price = parsePrice(block)
      const name = productNameFromBlock(block)
      if (price === null || !name || !DESCRIPTOR_PATTERN.test(block)) continue

      const partNumber = partNumberFromBlock(block)
      const position = statedPosition(block)
      const evidenceQuote = block.replace(/\s+/g, ' ').trim()
      const isKit = /\bkit\b/i.test(name)
      if (isKit) {
        kits.push({
          name,
          brand: brandFromName(name),
          price,
          url: result.url,
          store: 'AutoZone',
          evidenceQuote,
          includes: /\b(?:includes?|with|set|pair|hardware)\b/i.test(block) ? evidenceQuote : '',
          positions: position,
          sourceConfidence: 'search_result_only',
        })
      } else {
        parts.push({
          position,
          name,
          partNumber,
          price,
          url: result.url,
          store: 'AutoZone',
          evidenceQuote,
          inStock: null,
          storeLocation: null,
          quantity: 1,
          sourceConfidence: 'search_result_only',
        })
      }
    }
  }

  const uniqueParts = [...new Map(parts.map(part => [`${part.url}|${part.name}|${part.partNumber}|${part.price}|${part.position}`, part])).values()]
  const uniqueKits = [...new Map(kits.map(kit => [`${kit.url}|${kit.name}|${kit.price}|${kit.positions}`, kit])).values()]
  return {
    options: uniqueParts.length ? [{
      tier: 'mid',
      brand: 'AutoZone',
      parts: uniqueParts,
      partsTotal: uniqueParts.reduce((total, part) => total + part.price * part.quantity, 0),
    }] : [],
    kits: uniqueKits.slice(0, 3),
  }
}

module.exports = { parseAutoZoneCategoryEvidence }
