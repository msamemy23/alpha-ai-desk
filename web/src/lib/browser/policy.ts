/**
 * Which sites the built-in browser may open, for this shop.
 *
 * Order of checks, first match wins:
 *  1. Hard blocks. Private networks, odd schemes and ports, and Alpha's own services. Nobody can change these.
 *  2. The shop's own block list.
 *  3. If the shop chose "only sites I allow": the site must be on the allow list or in the quick sites.
 *  4. The default block list (banking, payments, sign-in hubs, webmail, adult, gambling, piracy), unless the shop allowed that site.
 *  5. Everything else is allowed.
 *
 * Imports only ./url.ts, so it runs in the browser, on the server and under `node --test`.
 */
import { hostMatches, normalizeHost, parseTarget } from './url.ts'

export type Actor = 'user' | 'ai'
export type BrowseMode = 'open' | 'allowlist'

export interface BrowserSettings {
  /** "open": any public site except the block lists. "allowlist": only sites the shop allowed or saved as quick sites. */
  mode: BrowseMode
  /** Master switch. When false, Alpha (the AI) cannot use the browser at all. People still can. */
  aiEnabled: boolean
  /** Show pictures in reader view. They are fetched through Alpha, never straight from the site. */
  readerImages: boolean
}

export const DEFAULT_SETTINGS: BrowserSettings = { mode: 'open', aiEnabled: true, readerImages: true }

export interface SiteRule { host: string; rule: 'allow' | 'block'; note?: string }

export interface DefaultBlock { host: string; why: string }

/** Sites blocked unless the shop allows them. Not a complete category filter: shops add their own. */
export const DEFAULT_BLOCKED: DefaultBlock[] = [
  // Banks and card companies
  ...['chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'usbank.com', 'capitalone.com', 'pnc.com', 'truist.com', 'tdbank.com', 'regions.com', 'ally.com', 'discover.com', 'americanexpress.com', 'synchrony.com', 'navyfederal.org']
    .map(host => ({ host, why: 'Banking and cards. Alpha never handles bank sign-ins.' })),
  // Payments, investing, crypto
  ...['paypal.com', 'venmo.com', 'cash.app', 'zellepay.com', 'dashboard.stripe.com', 'squareup.com', 'wise.com', 'coinbase.com', 'binance.com', 'kraken.com', 'robinhood.com', 'schwab.com', 'fidelity.com', 'vanguard.com']
    .map(host => ({ host, why: 'Payments and investing. Alpha never handles payment sign-ins.' })),
  // Accounting and tax sign-ins
  ...['accounts.intuit.com', 'quickbooks.intuit.com', 'turbotax.intuit.com']
    .map(host => ({ host, why: 'Accounting sign-in. Use the connected app instead.' })),
  // Identity providers and webmail
  ...['accounts.google.com', 'mail.google.com', 'login.microsoftonline.com', 'login.live.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'appleid.apple.com', 'icloud.com', 'mail.yahoo.com', 'login.yahoo.com', 'login.gov', 'id.me']
    .map(host => ({ host, why: 'Account sign-in or email. Open these in your own browser.' })),
]

/** Whole-name patterns for categories that have no short list. A label must match exactly, so "essex.com" is not caught. */
const CATEGORY_LABELS: Array<{ labels: string[]; why: string }> = [
  { labels: ['porn', 'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'onlyfans', 'chaturbate', 'xxx', 'sex', 'adult'], why: 'Adult content.' },
  { labels: ['casino', 'sportsbook', 'bet365', 'draftkings', 'fanduel', 'betway', 'poker', 'pokerstars', 'slots'], why: 'Gambling.' },
  { labels: ['thepiratebay', 'piratebay', '1337x', 'torrent', 'torrents', 'rarbg'], why: 'Pirated content.' },
]

/** Hosts that belong to Alpha itself (its own site and database), supplied by the server. Never browsable. */
export interface PolicyContext {
  settings: BrowserSettings
  rules: SiteRule[]
  /** Hosts of the shop's saved quick sites. In "allowlist" mode these count as allowed. */
  quickHosts: string[]
  /** Alpha's own hosts. */
  ownHosts?: string[]
}

export type PolicyCode =
  | 'invalid' | 'own_service' | 'ai_off' | 'shop_blocked' | 'not_allowed' | 'default_blocked'

export type PolicyDecision =
  | { allowed: true; via: 'shop_allowed' | 'quick_site' | 'open' }
  | { allowed: false; code: PolicyCode; reason: string; /** The shop can turn this block off by allowing the site. */ overridable: boolean }

export function defaultBlockFor(host: string): DefaultBlock | null {
  const h = normalizeHost(host)
  for (const d of DEFAULT_BLOCKED) if (hostMatches(h, d.host)) return d
  const labels = h.split('.')
  for (const c of CATEGORY_LABELS) {
    if (labels.some(l => c.labels.includes(l))) return { host: h, why: c.why }
  }
  return null
}

export function evaluateUrl(raw: string | URL, actor: Actor, ctx: PolicyContext): PolicyDecision {
  const parsed = parseTarget(String(raw))
  if (!parsed.ok) return { allowed: false, code: 'invalid', reason: parsed.message, overridable: false }
  const host = parsed.host

  for (const own of ctx.ownHosts || []) {
    if (own && hostMatches(host, own)) return { allowed: false, code: 'own_service', reason: 'That is part of Alpha Desk itself, so the browser will not open it.', overridable: false }
  }
  if (actor === 'ai' && !ctx.settings.aiEnabled) {
    return { allowed: false, code: 'ai_off', reason: 'Alpha is switched off for the browser in this shop. Turn it on in the browser settings.', overridable: false }
  }
  // Most specific rule wins (a rule for shop.example.com beats one for example.com).
  const matching = ctx.rules.filter(r => hostMatches(host, r.host)).sort((a, b) => normalizeHost(b.host).length - normalizeHost(a.host).length)
  const best = matching[0]
  if (best && best.rule === 'block') {
    return { allowed: false, code: 'shop_blocked', reason: 'Your shop blocked this site.', overridable: true }
  }
  if (ctx.settings.mode === 'allowlist') {
    if (best && best.rule === 'allow') return { allowed: true, via: 'shop_allowed' }
    if (ctx.quickHosts.some(q => hostMatches(host, q))) return { allowed: true, via: 'quick_site' }
    return { allowed: false, code: 'not_allowed', reason: 'Your shop only allows the sites on its list. Add this site to the allow list to open it.', overridable: true }
  }
  if (best && best.rule === 'allow') return { allowed: true, via: 'shop_allowed' }
  const dflt = defaultBlockFor(host)
  if (dflt) return { allowed: false, code: 'default_blocked', reason: `${dflt.why} Allow the site in the browser settings if you need it.`, overridable: true }
  return { allowed: true, via: ctx.quickHosts.some(q => hostMatches(host, q)) ? 'quick_site' : 'open' }
}

/** A short list of the policy for people: used by the settings sheet and by tests. */
export function describeMode(mode: BrowseMode): string {
  return mode === 'allowlist' ? 'Only sites on your allow list and quick sites' : 'Any public site except blocked ones'
}
