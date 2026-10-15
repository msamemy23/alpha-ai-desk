/**
 * Reading a page and searching the web, for every route that needs it (the Browser page, Ask Alpha, the older proxy).
 *
 * One safe fetch for the whole thing: public addresses only, every redirect checked against the shop's rules, size and time
 * limits, no cookies. What comes back is Alpha's own reading of the page (see ./reader.ts), never the site's HTML.
 *
 * Server only (network). Plain TypeScript; the network and name lookup can be replaced for tests.
 */
import { decodeBody, isReadableType, safeFetchFollow, SafeFetchError } from './safe-fetch.ts'
import type { SafeFetchDeps } from './safe-fetch.ts'
import { extractReader, parseSearchResults } from './reader.ts'
import type { ReaderDoc, SearchHit } from './reader.ts'
import { evaluateUrl } from './policy.ts'
import type { Actor, PolicyContext } from './policy.ts'
import { makeCheck } from './guard.ts'
import { parseTarget } from './url.ts'

export type ReadResult =
  | { ok: true; doc: ReaderDoc; finalUrl: string; status: number }
  | { ok: false; code: 'blocked' | 'not_found' | 'unreadable' | 'too_large' | 'timeout' | 'network' | 'type' | 'bad_url'; message: string; status?: number; contentType?: string }

const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2'
const MAX_PAGE_BYTES = 3 * 1024 * 1024

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function mapError(e: unknown): Extract<ReadResult, { ok: false }> {
  if (e instanceof SafeFetchError) {
    const code = e.code === 'blocked' ? 'blocked' : e.code === 'too_large' ? 'too_large' : e.code === 'timeout' ? 'timeout' : e.code === 'bad_url' ? 'bad_url' : 'network'
    return { ok: false, code, message: e.message }
  }
  return { ok: false, code: 'network', message: 'The page could not be opened.' }
}

/** Open a page and read it. The shop's rules apply to the address and to every redirect. */
export async function readPage(url: string, ctx: PolicyContext, actor: Actor, deps: SafeFetchDeps = {}): Promise<ReadResult> {
  const parsed = parseTarget(url)
  if (!parsed.ok) return { ok: false, code: 'bad_url', message: parsed.message }
  const check = makeCheck(ctx, actor)
  const first = check(parsed.url.toString(), { navigation: true })
  if (first) return { ok: false, code: 'blocked', message: first }
  try {
    const { response, finalUrl } = await safeFetchFollow(parsed.url, { headers: { accept: ACCEPT, 'accept-language': 'en-US,en;q=0.9' }, maxBytes: MAX_PAGE_BYTES, timeoutMs: 15_000 }, {
      maxRedirects: 5,
      check: u => check(u.toString(), { navigation: true }),
    }, deps)
    const status = response.status
    if (status === 404 || status === 410) return { ok: false, code: 'not_found', message: 'That page was not found on the site.', status }
    const type = response.headers.get('content-type') || ''
    const kind = isReadableType(type)
    if (!kind) {
      const label = /pdf/i.test(type) ? 'a PDF' : /^image\//i.test(type) ? 'a picture' : 'a file'
      return { ok: false, code: 'type', message: `That address is ${label}, not a web page, so there is nothing to read. Downloading it needs your approval.`, status, contentType: type.slice(0, 80) }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = decodeBody(bytes, type)
    const doc = extractReader(kind === 'text' ? `<pre>${escapeHtml(text.slice(0, 200_000))}</pre>` : text, finalUrl.toString())
    if (status >= 400 && doc.blocks.length === 0) return { ok: false, code: 'unreadable', message: `The website answered with an error (${status}) and no page to show.`, status }
    return { ok: true, doc, finalUrl: finalUrl.toString(), status }
  } catch (e) {
    return mapError(e)
  }
}

export interface SearchResult {
  ok: true
  query: string
  hits: SearchHit[]
  /** How many results were left out because the shop's rules do not allow those sites. */
  hidden: number
}
export type SearchOutcome = SearchResult | { ok: false; code: 'blocked_by_provider' | 'network' | 'empty_query'; message: string }

const SEARCH_HOST = 'https://html.duckduckgo.com/html/'

/** A web search. Only the words typed are sent, to one fixed provider, and nothing else about the shop. */
export async function searchWeb(query: string, ctx: PolicyContext, actor: Actor, deps: SafeFetchDeps = {}): Promise<SearchOutcome> {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) return { ok: false, code: 'empty_query', message: 'Type what to look for.' }
  try {
    const { response } = await safeFetchFollow(`${SEARCH_HOST}?q=${encodeURIComponent(q)}&kl=us-en`, { headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' }, maxBytes: 1.5 * 1024 * 1024, timeoutMs: 12_000 }, { maxRedirects: 2 }, deps)
    if (!response.ok) return { ok: false, code: 'network', message: 'The search site did not answer. Try again in a moment.' }
    const html = decodeBody(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type') || '')
    const parsed = parseSearchResults(html)
    if (parsed.blocked) return { ok: false, code: 'blocked_by_provider', message: 'The search site is asking for a human check right now. Try again later, or type a site address.' }
    let hidden = 0
    const hits = parsed.hits.filter(h => {
      const allowed = evaluateUrl(h.url, actor, ctx).allowed
      if (!allowed) hidden++
      return allowed
    }).slice(0, 10)
    return { ok: true, query: q, hits, hidden }
  } catch (e) {
    const mapped = mapError(e)
    return { ok: false, code: 'network', message: mapped.message }
  }
}
