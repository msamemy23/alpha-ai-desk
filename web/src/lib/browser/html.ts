/**
 * A small, forgiving HTML reader with no dependencies. It turns text into a tree. It never runs anything:
 * no scripts, no styles, no network. Limits on size, depth and node count keep a hostile page from using up the server.
 * Imports nothing, so it runs on the server and under `node --test`. Plain TypeScript only.
 */

export interface HEl { t: 'el'; tag: string; attrs: Record<string, string>; kids: HNode[]; parent: HEl | null }
export interface HText { t: 'tx'; text: string }
export interface HComment { t: 'cm'; text: string }
export type HNode = HEl | HText | HComment

export interface ParseResult { root: HEl; truncated: boolean }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
// Elements whose content is text, not markup. Their end tag is searched for directly.
const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'plaintext'])
// Real HTML containers: "<div/>" is NOT self-closing in HTML, so do not treat it as such.
const CONTAINERS = new Set(['a', 'b', 'body', 'div', 'em', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'li', 'ol', 'p', 'section', 'span', 'strong', 'table', 'td', 'th', 'tr', 'ul', 'article', 'main', 'nav', 'header', 'footer', 'aside', 'label', 'button', 'select', 'option'])
const BLOCK_CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'])

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', deg: '°', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾', times: '×', divide: '÷', laquo: '«', raquo: '»', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓', check: '✓', infin: '∞',
  micro: 'µ', ohm: 'Ω', sup2: '²', sup3: '³', prime: '′', Prime: '″', thinsp: ' ', ensp: ' ', emsp: ' ', shy: '',
}

export function decodeEntities(input: string): string {
  if (input.indexOf('&') === -1) return input
  return input.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    const hit = NAMED[body] ?? NAMED[body.toLowerCase()]
    return hit === undefined ? whole : hit
  })
}

function closeImpliedFor(open: HEl[], tag: string): void {
  const top = () => open[open.length - 1]
  const popUntil = (names: string[], stopAt: string[]) => {
    for (let i = open.length - 1; i > 0; i--) {
      const name = open[i].tag
      if (stopAt.includes(name)) return
      if (names.includes(name)) { open.length = i; return }
    }
  }
  if (BLOCK_CLOSES_P.has(tag) && top().tag === 'p') open.pop()
  switch (tag) {
    case 'li': popUntil(['li'], ['ul', 'ol', 'menu']); break
    case 'dt': case 'dd': popUntil(['dt', 'dd'], ['dl']); break
    case 'tr': popUntil(['tr'], ['table', 'thead', 'tbody', 'tfoot']); break
    case 'td': case 'th': popUntil(['td', 'th'], ['tr', 'table']); break
    case 'thead': case 'tbody': case 'tfoot': popUntil(['thead', 'tbody', 'tfoot'], ['table']); break
    case 'option': popUntil(['option'], ['select', 'datalist']); break
    default: break
  }
}

export function parseHtml(html: string, limits: { maxNodes?: number; maxDepth?: number } = {}): ParseResult {
  const maxNodes = limits.maxNodes ?? 60000
  const maxDepth = limits.maxDepth ?? 200
  const root: HEl = { t: 'el', tag: '#root', attrs: {}, kids: [], parent: null }
  const open: HEl[] = [root]
  let nodes = 0
  let truncated = false
  let i = 0
  const n = html.length

  const addText = (raw: string, decode: boolean) => {
    if (!raw) return
    if (++nodes > maxNodes) { truncated = true; return }
    const cur = open[open.length - 1]
    cur.kids.push({ t: 'tx', text: decode ? decodeEntities(raw) : raw })
  }

  while (i < n && !truncated) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { addText(html.slice(i), true); break }
    if (lt > i) addText(html.slice(i, lt), true)
    i = lt
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      const body = end === -1 ? html.slice(i + 4) : html.slice(i + 4, end)
      if (++nodes > maxNodes) { truncated = true; break }
      open[open.length - 1].kids.push({ t: 'cm', text: body.slice(0, 2000) })
      i = end === -1 ? n : end + 3
      continue
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i)
      i = end === -1 ? n : end + 3
      continue
    }
    const next = html.charCodeAt(i + 1)
    // "<!doctype ...>", "<?xml ...?>"
    if (next === 33 || next === 63) {
      const end = html.indexOf('>', i)
      i = end === -1 ? n : end + 1
      continue
    }
    // End tag
    if (next === 47) {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>?/.exec(html.slice(i, i + 200))
      if (!m) { addText('<', false); i += 1; continue }
      const name = m[1].toLowerCase()
      for (let k = open.length - 1; k > 0; k--) {
        if (open[k].tag === name) { open.length = k; break }
      }
      i += m[0].length
      continue
    }
    // Start tag
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 80))
    if (!nameMatch) { addText('<', false); i += 1; continue }
    const tag = nameMatch[1].toLowerCase()
    let p = i + nameMatch[0].length
    const attrs: Record<string, string> = {}
    let selfClosing = false
    let closed = false
    let guard = 0
    while (p < n && guard++ < 400) {
      const c = html.charCodeAt(p)
      if (c === 62) { p += 1; closed = true; break }                     // >
      if (c === 47) { if (html.charCodeAt(p + 1) === 62) { selfClosing = true; p += 2; closed = true; break } p += 1; continue } // />
      if (c <= 32) { p += 1; continue }
      const nm = /^[^\s=/>]+/.exec(html.slice(p, p + 200))
      if (!nm) { p += 1; continue }
      const attrName = nm[0].toLowerCase()
      p += nm[0].length
      while (p < n && html.charCodeAt(p) <= 32) p += 1
      let value = ''
      if (html.charCodeAt(p) === 61) {                                    // =
        p += 1
        while (p < n && html.charCodeAt(p) <= 32) p += 1
        const q = html[p]
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1)
          value = end === -1 ? html.slice(p + 1) : html.slice(p + 1, end)
          p = end === -1 ? n : end + 1
        } else {
          const um = /^[^\s>]*/.exec(html.slice(p, p + 2000))
          value = um ? um[0] : ''
          p += value.length
        }
      }
      if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value).slice(0, 4000)
    }
    if (!closed) { i = n; break }
    i = p

    if (++nodes > maxNodes) { truncated = true; break }
    closeImpliedFor(open, tag)
    const parent = open[open.length - 1]
    const el: HEl = { t: 'el', tag, attrs, kids: [], parent }
    parent.kids.push(el)

    if (RAW.has(tag) && !selfClosing) {
      const re = new RegExp(`</${tag}[\\s>/]`, 'ig')
      re.lastIndex = i
      const m = re.exec(html)
      const bodyEnd = m ? m.index : n
      const isData = tag === 'script' && /ld\+json/i.test(attrs.type || '')
      const body = html.slice(i, Math.min(bodyEnd, i + (isData ? 40000 : 20000)))
      if (isData && body) el.kids.push({ t: 'tx', text: body })
      else if (body && (tag === 'title' || tag === 'textarea')) el.kids.push({ t: 'tx', text: decodeEntities(body) })
      else if (body && tag !== 'script' && tag !== 'style' && tag !== 'noscript') el.kids.push({ t: 'tx', text: body })
      if (m) {
        const gt = html.indexOf('>', m.index)
        i = gt === -1 ? n : gt + 1
      } else i = n
      continue
    }
    if (VOID.has(tag) || (selfClosing && !CONTAINERS.has(tag))) continue
    if (open.length >= maxDepth) { truncated = true; break }
    open.push(el)
  }
  return { root, truncated }
}

/** Depth-first walk. Return false from `visit` to skip an element's children. */
export function walk(node: HNode, visit: (n: HNode) => boolean | void): void {
  if (visit(node) === false) return
  if (node.t === 'el') for (const k of node.kids) walk(k, visit)
}

export function findAll(root: HEl, test: (el: HEl) => boolean, limit = 1000): HEl[] {
  const out: HEl[] = []
  walk(root, n => {
    if (out.length >= limit) return false
    if (n.t === 'el' && test(n)) out.push(n)
  })
  return out
}

export function findFirst(root: HEl, test: (el: HEl) => boolean): HEl | null {
  return findAll(root, test, 1)[0] ?? null
}

/** All text under a node, in order, with entities decoded. No whitespace tidying. */
export function textOf(node: HNode, skip?: (el: HEl) => boolean): string {
  if (node.t === 'tx') return node.text
  if (node.t === 'cm') return ''
  if (skip && skip(node)) return ''
  let out = ''
  for (const k of node.kids) out += textOf(k, skip)
  return out
}

export function classTokens(el: HEl): string[] {
  return (el.attrs.class || '').toLowerCase().split(/\s+/).filter(Boolean)
}
