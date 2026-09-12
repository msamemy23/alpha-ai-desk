import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { request as httpRequest } from 'node:http'
import type { RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'

/**
 * Validate a URL before the server fetches it. Hostname text checks alone are
 * not enough because a public hostname can resolve to a private address.
 */
export function isPrivateIp(address: string): boolean {
  const value = address.toLowerCase().replace(/%.+$/, '')
  const family = isIP(value)

  if (family === 4) {
    const octets = value.split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true
    const [a, b] = octets
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(octets[2])))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224
  }

  if (family !== 6) return true
  const parts = value.split('::')
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : []
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : []
  const expanded = parts.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : value.split(':')
  if (expanded.length !== 8) return true
  const words = expanded.map((part) => Number.parseInt(part || '0', 16))
  if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return true

  // IPv4-mapped IPv6 addresses must receive the IPv4 rules above.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const mapped = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
    return isPrivateIp(mapped)
  }

  const first = words[0]
  const second = words[1]
  const isUnspecified = words.every((word) => word === 0)
  const isLoopback = isUnspecified || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)
  const isUniqueLocal = (first & 0xfe00) === 0xfc00
  // fe80::/10 covers fe80 through febf in the first 16-bit word. The old
  // check only matched one small sub-range and allowed link-local addresses
  // such as fe80::1 through the SSRF guard.
  const isLinkLocal = (first & 0xffc0) === 0xfe80
  const isDocumentation = first === 0x2001 && second === 0x0db8
  const isMulticast = (first & 0xff00) === 0xff00
  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isDocumentation || isMulticast
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return true
  const ipLiteral = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (isIP(ipLiteral)) return isPrivateIp(ipLiteral)
  return false
}

export async function assertPublicUrl(raw: string, base?: URL): Promise<URL> {
  let url: URL
  try {
    url = base ? new URL(raw, base) : new URL(raw)
  } catch {
    throw new Error('Valid public URL required')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new Error('Only public http(s) URLs are allowed')
  }

  const ipLiteral = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  if (isIP(ipLiteral)) {
    if (isPrivateIp(ipLiteral)) throw new Error('Only public http(s) URLs are allowed')
    return url
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('The URL hostname could not be resolved')
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Only public http(s) URLs are allowed')
  }
  return url
}

/**
 * Fetch a public URL using the address resolved during validation. Calling
 * fetch(url) after assertPublicUrl(url) would leave a DNS check-to-use race:
 * the hostname could resolve to a different address between those operations.
 */
export async function fetchPublicUrl(
  raw: string | URL,
  init: {
    method?: string
    headers?: HeadersInit
    signal?: AbortSignal
    maxBytes?: number
    base?: URL
  } = {}
): Promise<Response> {
  const url = await assertPublicUrl(String(raw), init.base)
  const ipLiteral = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  let address: { address: string; family: number }
  if (isIP(ipLiteral)) {
    address = { address: ipLiteral, family: isIP(ipLiteral) }
  } else {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    const publicAddresses = addresses.filter(({ address: candidate }) => !isPrivateIp(candidate))
    if (!publicAddresses.length || publicAddresses.length !== addresses.length) {
      throw new Error('Only public http(s) URLs are allowed')
    }
    address = publicAddresses[0]
  }

  const headers = new Headers(init.headers)
  headers.set('host', url.host)
  headers.set('accept-encoding', 'identity')
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, key) => { requestHeaders[key] = value })
  const maxBytes = init.maxBytes ?? 5 * 1024 * 1024
  const hostname = ipLiteral
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, address.address, address.family as 4 | 6)
  }
  const requestOptions: RequestOptions = {
    hostname: address.address,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: init.method || 'GET',
    headers: requestHeaders,
    lookup: pinnedLookup,
    ...(url.protocol === 'https:' && !isIP(hostname) ? { servername: hostname } : {}),
  }
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

  return await new Promise<Response>((resolve, reject) => {
    let settled = false
    const finishError = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const onAbort = () => {
      request.destroy(new Error('Request aborted'))
      finishError(new Error('Request aborted'))
    }
    const request = requestFn(requestOptions, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > maxBytes) {
          request.destroy(new Error('Response too large'))
          finishError(new Error('Response too large'))
          return
        }
        chunks.push(buffer)
      })
      response.on('error', (error) => finishError(error instanceof Error ? error : new Error('Upstream response failed')))
      response.on('end', () => {
        if (settled) return
        settled = true
        init.signal?.removeEventListener('abort', onAbort)
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) responseHeaders.set(key, value.join(', '))
          else if (value !== undefined) responseHeaders.set(key, value)
        }
        resolve(new Response(requestOptions.method === 'HEAD' || [204, 205, 304].includes(response.statusCode || 0) ? null : Buffer.concat(chunks), {
          status: response.statusCode || 502,
          statusText: response.statusMessage || '',
          headers: responseHeaders,
        }))
      })
    })
    init.signal?.addEventListener('abort', onAbort, { once: true })
    request.on('error', (error) => {
      init.signal?.removeEventListener('abort', onAbort)
      finishError(error instanceof Error ? error : new Error('Upstream request failed'))
    })
    request.end()
  })
}

export async function tryPublicUrl(raw: string, base?: URL): Promise<URL | null> {
  try {
    return await assertPublicUrl(raw, base)
  } catch {
    return null
  }
}
