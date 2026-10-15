/**
 * The one way the built-in browser reaches the internet from the server.
 *
 * Every request:
 *  - uses a public http or https address on an allowed port (see ./url.ts),
 *  - looks the name up ONCE, checks every address it returned (see ./ip.ts), and connects to the address it checked,
 *    so a site cannot answer "public" to our check and "private" to the connection (DNS rebinding),
 *  - keeps the original name for the Host header and the certificate check,
 *  - never follows a redirect by itself: safeFetchFollow checks every hop against the shop's rules,
 *  - reads at most maxBytes and gives up after timeoutMs,
 *  - sends no cookies and no credentials, and reads no environment secrets.
 *
 * Server only (uses node:dns, node:http, node:https). Plain TypeScript (no enums, no parameter properties) so it can be
 * tested under `node --test`.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { isBlockedIp, parseIPv4 } from './ip.ts'
import { parseTarget } from './url.ts'
import type { ParsedTarget } from './url.ts'

export type SafeFetchCode = 'bad_url' | 'blocked' | 'dns' | 'timeout' | 'too_large' | 'network' | 'tls' | 'redirect' | 'type'

export class SafeFetchError extends Error {
  code: SafeFetchCode
  constructor(code: SafeFetchCode, message: string) {
    super(message)
    this.name = 'SafeFetchError'
    this.code = code
  }
}

export interface SafeFetchInit {
  method?: 'GET' | 'HEAD' | 'POST'
  headers?: Record<string, string>
  body?: string | Uint8Array
  signal?: AbortSignal
  /** Whole-request time limit including connect, default 15 seconds. */
  timeoutMs?: number
  /** Largest response body kept, default 2 MB. */
  maxBytes?: number
}

export interface SafeFetchDeps {
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>
  isBlocked?: (address: string) => boolean
  parse?: (raw: string) => ParsedTarget
  httpRequest?: typeof httpRequest
  httpsRequest?: typeof httpsRequest
}

export const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 AlphaDesk/1.0'

async function defaultLookup(host: string): Promise<Array<{ address: string; family: number }>> {
  const rows = await dnsLookup(host, { all: true, verbatim: true })
  return rows.map(r => ({ address: r.address, family: r.family }))
}

const RETRYABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'EAI_AGAIN'])

function onceRequest(
  url: URL, address: { address: string; family: number }, init: SafeFetchInit, deps: SafeFetchDeps, deadline: AbortSignal,
): Promise<Response> {
  const method = init.method || 'GET'
  const maxBytes = init.maxBytes ?? 2 * 1024 * 1024
  const isHttps = url.protocol === 'https:'
  const bodyBuffer = init.body === undefined ? undefined : Buffer.from(init.body as string | Uint8Array)
  if (bodyBuffer && bodyBuffer.length > 512 * 1024) return Promise.reject(new SafeFetchError('too_large', 'The form data is too large to send.'))
  const headers: Record<string, string> = {
    'user-agent': BROWSER_USER_AGENT,
    accept: '*/*',
    ...Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
    host: url.host,
    'accept-encoding': 'identity',
    connection: 'close',
  }
  delete headers.cookie
  delete headers.authorization
  if (bodyBuffer) headers['content-length'] = String(bodyBuffer.length)
  const options: RequestOptions & { servername?: string } = {
    hostname: address.address,
    family: address.family,
    port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    agent: false,
    ...(isHttps ? { servername: url.hostname } : {}),
  }
  const requestFn = (isHttps ? (deps.httpsRequest ?? httpsRequest) : (deps.httpRequest ?? httpRequest)) as typeof httpRequest

  return new Promise<Response>((resolve, reject) => {
    let settled = false
    let req: ReturnType<typeof httpRequest> | null = null
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      deadline.removeEventListener('abort', onAbort)
      req?.destroy()
      reject(error)
    }
    const onAbort = () => fail(new SafeFetchError('timeout', 'The site took too long to answer.'))
    if (deadline.aborted) return onAbort()
    deadline.addEventListener('abort', onAbort, { once: true })
    req = requestFn(options, (res: IncomingMessage) => {
      const declared = Number(res.headers['content-length'] || 0)
      if (declared > maxBytes && method !== 'HEAD') return fail(new SafeFetchError('too_large', 'That page is too large to open here.'))
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buf.length
        if (size > maxBytes) return fail(new SafeFetchError('too_large', 'That page is too large to open here.'))
        chunks.push(buf)
      })
      res.on('error', e => fail(e instanceof Error ? e : new Error('The site closed the connection.')))
      res.on('aborted', () => fail(new SafeFetchError('network', 'The site closed the connection.')))
      res.on('end', () => {
        if (settled) return
        settled = true
        deadline.removeEventListener('abort', onAbort)
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue
          try {
            if (Array.isArray(value)) responseHeaders.set(key, value.join(', '))
            else responseHeaders.set(key, value)
          } catch { /* a header name or value the platform will not accept: drop it */ }
        }
        const status = res.statusCode || 502
        const nullBody = method === 'HEAD' || [101, 204, 205, 304].includes(status)
        resolve(new Response(nullBody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage || '', headers: responseHeaders }))
      })
    })
    req.on('error', (e: NodeJS.ErrnoException) => {
      const code = e.code || ''
      if (/CERT|SSL|TLS|ERR_TLS|UNABLE_TO_VERIFY|DEPTH_ZERO|HOSTNAME_MISMATCH/i.test(code) || /certificate|tls|ssl/i.test(e.message)) {
        return fail(new SafeFetchError('tls', 'The site’s security certificate could not be trusted, so Alpha did not open it.'))
      }
      const err = new SafeFetchError('network', 'Could not connect to the site.')
      ;(err as SafeFetchError & { retry?: boolean }).retry = RETRYABLE.has(code)
      fail(err)
    })
    if (bodyBuffer) req.write(bodyBuffer)
    req.end()
  })
}

/** One request to a public site. Throws SafeFetchError with a plain-words message. */
export async function safeFetch(target: string | URL, init: SafeFetchInit = {}, deps: SafeFetchDeps = {}): Promise<Response> {
  const parsed = (deps.parse ?? parseTarget)(String(target))
  if (!parsed.ok) throw new SafeFetchError(parsed.code === 'internal' || parsed.code === 'ip_literal' || parsed.code === 'port' ? 'blocked' : 'bad_url', parsed.message)
  const url = parsed.url
  const blocked = deps.isBlocked ?? isBlockedIp
  const method = init.method || 'GET'
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw new SafeFetchError('bad_url', 'That kind of request is not allowed.')

  const timeout = AbortSignal.timeout(init.timeoutMs ?? 15000)
  const signals = init.signal ? [timeout, init.signal] : [timeout]
  const deadline = signals.length === 1 ? timeout : AbortSignal.any(signals)

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await (deps.lookup ?? defaultLookup)(parsed.host)
  } catch {
    throw new SafeFetchError('dns', 'That site could not be found. Check the address.')
  }
  // Every address must be public. One private answer is enough to refuse (a rebinding site mixes them).
  if (!addresses.length || addresses.some(a => blocked(a.address) || (parseIPv4(a.address) === null && !a.address.includes(':')))) {
    throw new SafeFetchError('blocked', 'That site points to a private address, so Alpha will not open it.')
  }
  const ordered = [...addresses.filter(a => a.family === 4), ...addresses.filter(a => a.family !== 4)].slice(0, 3)

  let lastError: unknown = null
  for (const address of ordered) {
    try {
      return await onceRequest(url, address, init, deps, deadline)
    } catch (e) {
      lastError = e
      const retry = (e as { retry?: boolean }).retry
      if (!(e instanceof SafeFetchError) || e.code !== 'network' || !retry || deadline.aborted) break
    }
  }
  if (lastError instanceof SafeFetchError) throw lastError
  throw new SafeFetchError('network', 'Could not connect to the site.')
}

export interface FollowOptions {
  maxRedirects?: number
  /** Called with every address the fetch is about to visit, including each redirect target. Return a reason to stop, or null. */
  check?: (url: URL) => string | null | Promise<string | null>
}

export interface FollowResult { response: Response; finalUrl: URL; hops: string[] }

/** GET (or HEAD) a page, following up to maxRedirects redirects, checking every hop. */
export async function safeFetchFollow(
  target: string | URL, init: Omit<SafeFetchInit, 'method' | 'body'> & { method?: 'GET' | 'HEAD' } = {}, options: FollowOptions = {}, deps: SafeFetchDeps = {},
): Promise<FollowResult> {
  const max = options.maxRedirects ?? 5
  const parse = deps.parse ?? parseTarget
  let current = parse(String(target))
  if (!current.ok) throw new SafeFetchError('bad_url', current.message)
  const hops: string[] = []
  for (let i = 0; i <= max; i++) {
    const url = (current as Extract<ParsedTarget, { ok: true }>).url
    const stop = options.check ? await options.check(url) : null
    if (stop) throw new SafeFetchError('blocked', stop)
    hops.push(url.toString())
    const response = await safeFetch(url, init, deps)
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location')
      if (!location) throw new SafeFetchError('redirect', 'The site sent Alpha somewhere without saying where.')
      if (i === max) throw new SafeFetchError('redirect', 'The site sent Alpha around in circles.')
      let nextHref: string
      try { nextHref = new URL(location.trim().replace(/[\u0000-\u001f\u007f]/g, ''), url).toString() } catch { throw new SafeFetchError('redirect', 'The site sent Alpha to an address that does not make sense.') }
      const next = parse(nextHref)
      if (!next.ok) throw new SafeFetchError('blocked', `The site redirected somewhere Alpha will not open. ${next.message}`)
      current = next
      continue
    }
    return { response, finalUrl: url, hops }
  }
  throw new SafeFetchError('redirect', 'The site sent Alpha around in circles.')
}

/** Turn page bytes into text using the charset the site declared (header first, then a <meta> tag), else UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType = ''): string {
  let label = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1] || ''
  if (!label) {
    const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1')
    label = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(head)?.[1] || ''
  }
  try {
    return new TextDecoder(label || 'utf-8', { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

/** The kinds of response a page view will read. */
export function isReadableType(contentType: string): 'html' | 'text' | null {
  const t = contentType.toLowerCase()
  if (!t || t.startsWith('text/html') || t.startsWith('application/xhtml+xml')) return 'html'
  if (t.startsWith('text/plain')) return 'text'
  return null
}

/** Raster pictures only. SVG can carry script, so it is never passed through. */
export function isSafeImageType(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp)(\s*;|$)/i.test(contentType.trim())
}
