/**
 * Which network addresses the built-in browser may ever connect to.
 *
 * Only globally routable addresses are allowed. Everything else is refused: loopback, private
 * ranges, link-local (this is where cloud metadata services live), carrier-grade NAT, documentation
 * and benchmark ranges, multicast, and every IPv6 form that can carry an IPv4 address inside it
 * (mapped, compatible, translated, NAT64, 6to4, Teredo).
 *
 * It imports nothing, so the same code runs on the server and under `node --test`.
 * Keep it plain TypeScript (no enums, no parameter properties) so node can run it directly.
 */

/** Parse a strict dotted-quad ("1.2.3.4"). Anything else, including 0x7f.1 or 017.0.0.1, is not an address here. */
export function parseIPv4(value: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!m) return null
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (octets.some(o => o > 255)) return null
  // A leading zero ("017") is read as octal by some parsers and decimal by others. Refuse the disagreement.
  if (m.slice(1).some(part => part.length > 1 && part.startsWith('0'))) return null
  return octets
}

/** Parse an IPv6 address into eight 16-bit words. Handles "::", an embedded dotted IPv4 tail, and brackets. */
export function parseIPv6(value: string): number[] | null {
  let text = value.trim().toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  if (!text || text.includes('%') || !/^[0-9a-f:.]+$/.test(text)) return null
  if (text.indexOf(':') === -1) return null

  let tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  const lastPart = text.slice(lastColon + 1)
  if (lastPart.includes('.')) {
    const v4 = parseIPv4(lastPart)
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    text = text.slice(0, lastColon + 1) + '0:0'
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const words: number[] = []
    for (const item of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(item)) return null
      words.push(Number.parseInt(item, 16))
    }
    return words
  }
  const left = parse(halves[0])
  const right = halves.length === 2 ? parse(halves[1]) : []
  if (!left || !right) return null
  let words: number[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 1) return null
    words = [...left, ...Array(missing).fill(0), ...right]
  } else {
    words = left
  }
  if (words.length !== 8) return null
  if (tail.length) { words[6] = tail[0]; words[7] = tail[1] }
  return words
}

export function isIPv4Literal(value: string): boolean { return parseIPv4(value) !== null }
export function isIPv6Literal(value: string): boolean { return parseIPv6(value) !== null }

function blockedIPv4(o: number[]): boolean {
  const [a, b, c] = o
  return a === 0 ||                                   // "this network"
    a === 10 ||                                       // private
    (a === 100 && b >= 64 && b <= 127) ||             // carrier-grade NAT
    a === 127 ||                                      // loopback
    (a === 169 && b === 254) ||                       // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||              // private
    (a === 192 && b === 0 && c === 0) ||              // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||              // documentation
    (a === 192 && b === 88 && c === 99) ||            // 6to4 relay anycast
    (a === 192 && b === 168) ||                       // private
    (a === 198 && (b === 18 || b === 19)) ||          // benchmarking
    (a === 198 && b === 51 && c === 100) ||           // documentation
    (a === 203 && b === 0 && c === 113) ||            // documentation
    a >= 224                                          // multicast, reserved, broadcast
}

/** True when the browser must NOT connect to this address. Anything that is not a clean address is blocked. */
export function isBlockedIp(address: string): boolean {
  const text = String(address || '').trim()
  const v4 = parseIPv4(text)
  if (v4) return blockedIPv4(v4)
  const w = parseIPv6(text)
  if (!w) return true

  // Only global unicast 2000::/3 can be a public destination. This one rule removes ::, ::1, ::ffff:x (mapped),
  // ::x (compatible), 64:ff9b::/96 (NAT64), fc00::/7, fe80::/10, fec0::/10, ff00::/8, 100::/64 and 5f00::/16.
  if ((w[0] & 0xe000) !== 0x2000) return true
  if (w[0] === 0x2001 && w[1] < 0x0200) return true        // 2001::/23: Teredo, protocol assignments, ORCHID
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true      // documentation
  if (w[0] === 0x2002) return true                         // 6to4 carries an IPv4 address; deprecated
  if (w[0] === 0x3fff && w[1] < 0x1000) return true       // 3fff::/20 documentation
  return false
}

/** True for a bare IP literal in any spelling a URL can carry (the URL parser has already normalised it). */
export function isIpLiteralHost(hostname: string): boolean {
  const h = hostname.trim().replace(/^\[|\]$/g, '')
  return parseIPv4(h) !== null || parseIPv6(h) !== null
}
