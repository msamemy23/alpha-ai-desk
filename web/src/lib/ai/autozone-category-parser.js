const { visiblePriceMatches } = require('./price-evidence.js')
const PRODUCT_PATTERN = /\b(?:brake\s+(?:pads?|rotors?)|pads?|rotors?)\b/i
const DESCRIPTOR_PATTERN = /(?:\b(?:part|sku)\s*(?:#|number|no\.)?\s*[A-Z0-9-]{3,}\b|\b(?:front|rear|left|right)\b|\b(?:set|pair|pack|includes?|hardware)\b)/i
const PRODUCT_FILLER_WORDS = new Set(['and', 'brake', 'brakes', 'cents', 'disc', 'discs', 'dollars', 'for', 'front', 'left', 'of', 'pad', 'pads', 'rear', 'right', 'rotor', 'rotors', 'set', 'the', 'type', 'with'])

function isSpecificProductLine(line) {
  if (!PRODUCT_PATTERN.test(line) || /\b(?:part|sku)\s*(?:#|number|no\.)?/i.test(line)) return false
  const tokens = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  return tokens.some(token => !PRODUCT_FILLER_WORDS.has(token))
}

function normalizedProductIdentity(line) {
  return line.replace(/^[-*#\s]+/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isSameProductIdentity(left, right) {
  const a = normalizedProductIdentity(left)
  const b = normalizedProductIdentity(right)
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)))
}

function parsePrice(block) {
  const matches = visiblePriceMatches(block)
  if (matches.length !== 1) return null
  return matches[0].value
}

function productNameFromBlock(block) {
  return block
    .split(/\n+/)
    .map(line => line.trim().replace(/^[-*#\s]+/, ''))
    .find(line => line.length >= 5 && line.length <= 180 && isSpecificProductLine(line) && !/(?:\$|USD\s+)\d/i.test(line)) || ''
}

function partNumberFromBlock(block) {
  const part = block.match(/(?:^|\n)\s*[+*-]?\s*part\s*(?:#|number|no\.)?\s*[:#-]?\s*([A-Z0-9-]{3,})\b/im)
  if (part) return part[1].toUpperCase()
  const sku = block.match(/(?:^|\n)\s*[+*-]?\s*sku\s*(?:#|number|no\.)?\s*[:#-]?\s*([A-Z0-9-]{3,})\b/im)
  return sku ? sku[1].toUpperCase() : ''
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
    let currentHasSpecificProduct = false
    let currentProductIdentity = ''
    for (const line of lines) {
      const lineHasPrice = parsePrice(line) !== null
      const lineHasSpecificProduct = isSpecificProductLine(line)
      const lineHasGenericProduct = PRODUCT_PATTERN.test(line) && !lineHasSpecificProduct
      const isDuplicateProductIdentity = lineHasSpecificProduct
        && currentProductIdentity
        && isSameProductIdentity(currentProductIdentity, line)
      // AutoZone extraction can put a product's price before its title. Keep a
      // price-first block open until its specific product identity arrives,
      // then start a new block at the next product row. For title-first
      // output, the same boundary closes when the next product begins.
      if (current.length && currentHasPrice && currentHasSpecificProduct && (lineHasGenericProduct || (lineHasSpecificProduct && !isDuplicateProductIdentity))) {
        blocks.push(current.join('\n'))
        current = []
        currentHasPrice = false
        currentHasSpecificProduct = false
        currentProductIdentity = ''
      }
      current.push(line)
      if (lineHasPrice) currentHasPrice = true
      if (lineHasSpecificProduct) {
        currentHasSpecificProduct = true
        if (!currentProductIdentity) currentProductIdentity = line
      }
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

