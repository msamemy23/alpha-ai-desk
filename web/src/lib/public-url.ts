import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

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
      (a === 192 && (b === 0 || b === 168)) ||
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
  const isLinkLocal = first === 0xfe80 && (second & 0xc000) === 0x8000
  const isDocumentation = first === 0x2001 && second === 0x0db8
  const isMulticast = (first & 0xff00) === 0xff00
  return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isDocumentation || isMulticast
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return true
  if (isIP(host)) return isPrivateIp(host)
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

  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error('Only public http(s) URLs are allowed')
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

export async function tryPublicUrl(raw: string, base?: URL): Promise<URL | null> {
  try {
    return await assertPublicUrl(raw, base)
  } catch {
    return null
  }
}
