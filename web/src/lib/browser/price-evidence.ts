/**
 * Price evidence for Ask Alpha's parts lookups.
 *
 * A search result snippet is not a price. A price is only "verified" when Alpha opened a page on a known parts retailer and the
 * page text itself shows a dollar amount for the part. Everything here is plain TypeScript with the page reader passed in, so
 * it is tested without a network. Server code decides what to open (and the shop's browser rules still apply to every read).
 */

export type PriceLead = { title: string; url: string; snippet: string }

export type VerifiedPrice = {
  store: string
  url: string
  title: string
  /** Dollars, as shown on the page. */
  price: number
  /** The text next to the number, so a person can see what it was a price of. */
  shownAs: string
}

export type PageReader = (url: string) => Promise<{ ok: true; title: string; text: string; finalUrl: string } | { ok: false }>

const RETAILERS: Array<[string, RegExp]> = [
  ['NAPA', /(?:^|\.)napaonline\.com$/i],
  ["O'Reilly", /(?:^|\.)oreillyauto\.com$/i],
  ['AutoZone', /(?:^|\.)autozone\.com$/i],
]

/** The store a web address belongs to, or null when it is not one of the parts stores Alpha verifies. https only. */
export function retailerOf(address: string): string | null {
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:') return null
    return RETAILERS.find(([, pattern]) => pattern.test(url.hostname))?.[0] ?? null
  } catch {
    return null
  }
}

// Amounts that are not the part's price: coupons, shipping thresholds, rebates, "was" prices, rewards.
const NOT_A_PRICE_BEFORE = /(?:save|off|was|over|orders?|spend|from|rebate|credit|gift\s*card|rewards?|earn|reg\.?|list|msrp|compare|free\s+shipping|shipping)\W{0,12}$/i
const NOT_A_PRICE_AFTER = /^\s*(?:\+|off\b|rebate|back\b|in\s+rewards|gift\s*card|minimum|min\b)/i
const NO_RESULTS = /\b(?:no\s+(?:results|products)\s+(?:found|match)|0\s+results|we\s+couldn['’]t\s+find|page\s+not\s+found|access\s+denied)\b/i

/** The first dollar amount on the page that looks like the part's own price, with the words around it. */
export function visiblePrice(text: string): { price: number; shownAs: string } | null {
  const source = String(text || '').replace(/\s+/g, ' ')
  if (!source || NO_RESULTS.test(source.slice(0, 600))) return null
  const pattern = /\$\s?(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)(?![\d])/g
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const price = Number(match[1].replace(/,/g, ''))
    if (!Number.isFinite(price) || price < 0.5 || price > 5000) continue
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 24)
    if (NOT_A_PRICE_BEFORE.test(before) || NOT_A_PRICE_AFTER.test(after)) continue
    const shownAs = source.slice(Math.max(0, match.index - 60), match.index + match[0].length + 20).trim()
    return { price, shownAs }
  }
  return null
}

/** True only for a page on a known parts store that shows a price for the part. */
export function isVerifiedRetailerPricePage(address: string, text: string): boolean {
  return Boolean(retailerOf(address) && visiblePrice(text))
}

/**
 * Open up to `max` retailer pages from a search and keep only the ones that really show a price. Pages that cannot be opened or
 * show no price are left out (never guessed), and the same page is never read twice.
 */
export async function verifyRetailerLeads(leads: PriceLead[], read: PageReader, max = 3): Promise<VerifiedPrice[]> {
  const seen = new Set<string>()
  const picked: PriceLead[] = []
  for (const lead of leads) {
    if (!retailerOf(lead.url) || seen.has(lead.url)) continue
    seen.add(lead.url)
    picked.push(lead)
    if (picked.length >= Math.max(1, Math.min(max, 5))) break
  }
  const checked = await Promise.all(picked.map(async (lead): Promise<VerifiedPrice | null> => {
    try {
      const page = await read(lead.url)
      if (!page.ok) return null
      // The page we landed on must still be a parts store: a redirect somewhere else proves nothing.
      const landedStore = retailerOf(page.finalUrl)
      if (!landedStore) return null
      const found = visiblePrice(page.text)
      if (!found) return null
      return { store: landedStore, url: page.finalUrl, title: String(page.title || lead.title || '').slice(0, 160), price: found.price, shownAs: found.shownAs }
    } catch {
      return null
    }
  }))
  return checked.filter((item): item is VerifiedPrice => Boolean(item))
}
