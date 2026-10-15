// The shop's browser settings as the screen uses them: reading the answer safely, and explaining a blocked site in plain words.
import { DEFAULT_SETTINGS, defaultBlockFor, evaluateUrl } from '../../lib/browser/policy.ts'
import type { BrowserSettings, PolicyContext } from '../../lib/browser/policy.ts'
import { cleanRuleHost, hostMatches, normalizeHost, parseTarget } from '../../lib/browser/url.ts'

export interface SiteRuleRow { id: string; host: string; rule: 'allow' | 'block'; note: string }
export interface BookmarkRow { id: string; title: string; url: string; kind: 'quick' | 'saved'; position: number; builtin: boolean }
export interface DefaultBlockRow { host: string; why: string }

export interface SettingsPayload {
  settings: BrowserSettings
  rules: SiteRuleRow[]
  bookmarks: BookmarkRow[]
  /** Which saved parts need the one-time setup before they can work. */
  missing: { settings: boolean; rules: boolean; bookmarks: boolean }
  perms: { canAct: boolean; canManage: boolean }
  aiReady: boolean
  defaultBlocked: DefaultBlockRow[]
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** What the screen assumes before the settings arrive, or when they cannot be loaded. Nobody is blocked from reading. */
export const UNKNOWN_PERMS = { canAct: true, canManage: false }

/** Read the settings answer without trusting its shape. Anything odd is dropped, never shown. */
export function cleanSettingsPayload(raw: unknown): SettingsPayload {
  const o = isObj(raw) ? raw : {}
  const s = isObj(o.settings) ? o.settings : {}
  const settings: BrowserSettings = {
    mode: s.mode === 'allowlist' ? 'allowlist' : 'open',
    aiEnabled: s.aiEnabled !== false,
    readerImages: s.readerImages !== false,
  }
  const rules: SiteRuleRow[] = (Array.isArray(o.rules) ? o.rules : []).flatMap(r => {
    if (!isObj(r) || (r.rule !== 'allow' && r.rule !== 'block')) return []
    const host = str(r.host, 253)
    return host ? [{ id: str(r.id, 64), host, rule: r.rule as 'allow' | 'block', note: str(r.note, 200) }] : []
  })
  const bookmarks: BookmarkRow[] = (Array.isArray(o.bookmarks) ? o.bookmarks : []).flatMap(b => {
    if (!isObj(b)) return []
    const url = str(b.url, 2048)
    if (!/^https?:\/\//i.test(url)) return []
    const id = str(b.id, 64)
    return [{
      id, title: str(b.title, 80) || url, url, kind: b.kind === 'saved' ? 'saved' as const : 'quick' as const,
      position: Number.isFinite(Number(b.position)) ? Number(b.position) : 100, builtin: b.builtin === true || id.startsWith('builtin-'),
    }]
  })
  const missing = isObj(o.missing) ? o.missing : {}
  const perms = isObj(o.perms) ? o.perms : {}
  const defaultBlocked: DefaultBlockRow[] = (Array.isArray(o.defaultBlocked) ? o.defaultBlocked : []).flatMap(d => (isObj(d) && str(d.host, 253) ? [{ host: str(d.host, 253), why: str(d.why, 200) }] : []))
  return {
    settings, rules, bookmarks,
    missing: { settings: missing.settings === true, rules: missing.rules === true, bookmarks: missing.bookmarks === true },
    perms: { canAct: perms.canAct !== false, canManage: perms.canManage === true },
    aiReady: o.aiReady === true,
    defaultBlocked,
  }
}

export function defaultPayload(): SettingsPayload {
  return { settings: { ...DEFAULT_SETTINGS }, rules: [], bookmarks: [], missing: { settings: false, rules: false, bookmarks: false }, perms: UNKNOWN_PERMS, aiReady: false, defaultBlocked: [] }
}

export function quickSites(p: SettingsPayload | null): BookmarkRow[] {
  return (p?.bookmarks || []).filter(b => b.kind === 'quick').sort((a, b) => a.position - b.position)
}
export function savedPages(p: SettingsPayload | null): BookmarkRow[] {
  return (p?.bookmarks || []).filter(b => b.kind === 'saved').sort((a, b) => a.position - b.position)
}

/** The same rules the server applies, built from what the settings screen was told. */
export function policyContext(p: SettingsPayload): PolicyContext {
  const quickHosts = quickSites(p).flatMap(b => { try { return [new URL(b.url).hostname] } catch { return [] } })
  return { settings: p.settings, rules: p.rules.map(r => ({ host: r.host, rule: r.rule, note: r.note })), quickHosts, ownHosts: [] }
}

/* ---------- a blocked site, explained ---------- */

export interface BlockExplanation {
  title: string
  /** Each line starts with what it is: "Which rule:" or "Why:" or a plain sentence. */
  lines: string[]
  code: string
  rule: SiteRuleRow | null
  builtin: DefaultBlockRow | null
  /** The shop can change this in the settings. */
  overridable: boolean
}

function bestRule(host: string, rules: SiteRuleRow[], kind: 'allow' | 'block'): SiteRuleRow | null {
  return rules.filter(r => r.rule === kind && hostMatches(host, r.host)).sort((a, b) => normalizeHost(b.host).length - normalizeHost(a.host).length)[0] || null
}

/**
 * Which rule stopped this address, and why, in plain words. Works from the settings the screen already has. When the
 * screen's copy of the rules does not explain it (the block came from a redirect, or the rules changed), the server's own
 * sentence is shown instead.
 */
export function explainBlock(url: string, p: SettingsPayload | null, serverMessage: string): BlockExplanation {
  const fallback: BlockExplanation = { title: 'This page could not be opened', lines: [serverMessage || 'A rule stopped this page.'], code: 'unknown', rule: null, builtin: null, overridable: false }
  const parsed = parseTarget(url)
  if (!parsed.ok) return { ...fallback, title: 'That address cannot be opened', lines: [parsed.message], code: 'invalid' }
  if (!p) return { ...fallback, title: 'This site is blocked' }
  const decision = evaluateUrl(url, 'user', policyContext(p))
  if (decision.allowed) return fallback
  const host = parsed.host
  switch (decision.code) {
    case 'shop_blocked': {
      const rule = bestRule(host, p.rules, 'block')
      return {
        title: 'Your shop blocked this site', code: decision.code, rule, builtin: null, overridable: true,
        lines: [
          rule ? `Which rule: ${rule.host} is on your shop’s block list${rule.note ? ` (note: ${rule.note})` : ''}.` : 'Which rule: your shop’s block list.',
          'Why: someone in your shop blocked it. Blocked sites do not open for people or for Alpha.',
        ],
      }
    }
    case 'not_allowed':
      return {
        title: 'This site is not on your allow list', code: decision.code, rule: null, builtin: null, overridable: true,
        lines: [
          'Which rule: your shop is set to open only sites on its allow list and quick sites.',
          'Why: this site is on neither list. Add it to the allow list to open it.',
        ],
      }
    case 'default_blocked': {
      const builtin = defaultBlockFor(host)
      return {
        title: 'Alpha blocks this kind of site', code: decision.code, rule: null, builtin: builtin ? { host: builtin.host, why: builtin.why } : null, overridable: true,
        lines: [
          `Which rule: Alpha’s built-in block list${builtin ? ` (${builtin.host})` : ''}.`,
          `Why: ${builtin ? builtin.why : decision.reason}`,
          'Your shop can allow this site in the browser settings.',
        ],
      }
    }
    case 'own_service':
      return { ...fallback, title: 'This is part of Alpha Desk', lines: [decision.reason], code: decision.code }
    default:
      return { ...fallback, title: 'This page could not be opened', lines: [decision.reason], code: decision.code }
  }
}

/* ---------- the lists in the settings sheet ---------- */

export interface BlockGroup { why: string; hosts: string[] }

/** The built-in block list, grouped by the reason it gives. */
export function groupDefaultBlocked(list: DefaultBlockRow[]): BlockGroup[] {
  const groups = new Map<string, string[]>()
  for (const d of list) {
    const why = d.why.replace(/\s*Alpha never handles[^.]*\./i, '').replace(/\s*Use the connected app instead\.?/i, '').replace(/\s*Open these in your own browser\.?/i, '').trim() || 'Blocked'
    const hosts = groups.get(why) || []
    hosts.push(d.host)
    groups.set(why, hosts)
  }
  return [...groups.entries()].map(([why, hosts]) => ({ why: why.replace(/\.$/, ''), hosts: hosts.sort() }))
}

export const NAMED_CATEGORIES_NOTE = 'Sites named for adult content, gambling and pirated downloads are blocked too.'

export function sortRules(rules: SiteRuleRow[], kind: 'allow' | 'block'): SiteRuleRow[] {
  return rules.filter(r => r.rule === kind).sort((a, b) => a.host.localeCompare(b.host))
}

export type RuleCheck = { ok: true; host: string; replaces: 'allow' | 'block' | null } | { ok: false; message: string }

/** Check a typed site name before it is sent. A site on the other list is moved, and the person is told so. */
export function checkRuleInput(input: string, kind: 'allow' | 'block', rules: SiteRuleRow[]): RuleCheck {
  const host = cleanRuleHost(input)
  if (!host) return { ok: false, message: 'Type a site name such as example.com.' }
  const same = rules.find(r => normalizeHost(r.host) === host)
  if (same && same.rule === kind) return { ok: false, message: `${host} is already on the ${kind === 'allow' ? 'allow' : 'block'} list.` }
  return { ok: true, host, replaces: same ? same.rule : null }
}

export type SiteCheck = { ok: true; title: string; url: string } | { ok: false; message: string }

/** Check a quick site before it is sent: a name and a web address the browser could open. */
export function checkQuickSite(title: string, address: string): SiteCheck {
  const raw = String(address || '').trim()
  if (!raw) return { ok: false, message: 'Type the web address.' }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  const parsed = parseTarget(withScheme)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || parsed.host.replace(/^www\./, '')
  return { ok: true, title: name, url: parsed.url.toString() }
}
