/**
 * Reader view: turn a web page into plain blocks that Alpha draws itself.
 *
 * The site's own HTML is never shown or run. We read it into a tree, keep headings, paragraphs, lists, tables,
 * links and picture addresses, and drop everything else (scripts, styles, menus, cookie banners, hidden text).
 * Text that a person cannot see is not shown, but it is checked for words aimed at an AI (see ./untrusted.ts).
 *
 * Imports only sibling pure files, so it runs on the server and under `node --test`. Plain TypeScript only.
 */
import { classTokens, findAll, findFirst, parseHtml, textOf, walk } from './html.ts'
import type { HEl, HNode } from './html.ts'
import { cleanPageText, inspectPageText, stripInvisible } from './untrusted.ts'
import type { InjectionReport } from './untrusted.ts'
import { displayHost, parseTarget } from './url.ts'

export interface Inline { t: string; href?: string; n?: number; b?: boolean; i?: boolean; code?: boolean }

export type Block =
  | { k: 'h'; level: 1 | 2 | 3 | 4; runs: Inline[] }
  | { k: 'p'; runs: Inline[] }
  | { k: 'li'; depth: number; ordered: boolean; index: number; runs: Inline[] }
  | { k: 'quote'; runs: Inline[] }
  | { k: 'pre'; text: string }
  | { k: 'img'; src: string; alt: string }
  | { k: 'table'; rows: string[][]; header: boolean }
  | { k: 'form'; summary: string }
  | { k: 'facts'; title: string; rows: Array<[string, string]> }
  | { k: 'hr' }

export interface ReaderLink { n: number; text: string; href: string }
export interface ReaderForm { method: string; action: string; fields: Array<{ label: string; type: string; name: string }>; summary: string }

export interface ReaderDoc {
  url: string
  title: string
  siteName: string
  description: string
  lang: string
  blocks: Block[]
  links: ReaderLink[]
  forms: ReaderForm[]
  /** Plain text for an AI. Links are marked [L1], [L2]... and listed in `links`. Already cleaned of invisible characters. */
  text: string
  truncated: boolean
  signInRequired: boolean
  /** The page has boxes to type into (search, part number, zip). Live view can fill them in. */
  hasFields: boolean
  injection: InjectionReport
  chars: number
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'link', 'meta', 'svg', 'canvas', 'iframe', 'object', 'embed', 'audio', 'video', 'map', 'datalist', 'frame', 'frameset'])
const FORM_CONTROL_TAGS = new Set(['button', 'select', 'textarea', 'input', 'option', 'optgroup', 'label', 'fieldset', 'legend'])
const INLINE_TAGS = new Set(['a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr'])
const CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside'])
const HIDDEN_CLASSES = new Set(['sr-only', 'sr_only', 'visually-hidden', 'visuallyhidden', 'screen-reader-text', 'screenreader', 'offscreen', 'a11y-hidden', 'hidden', 'd-none', 'is-hidden', 'u-hidden', 'hide', 'invisible'])
const NOISE_TOKENS = new Set(['cookie', 'cookies', 'cookie-banner', 'cookie-consent', 'cookiebanner', 'consent', 'gdpr', 'popup', 'modal', 'newsletter', 'advert', 'advertisement', 'ad', 'ads', 'adsbygoogle', 'sponsored', 'skip-link', 'skiplink'])
const CHROME_TOKENS = new Set(['sidebar', 'breadcrumb', 'breadcrumbs', 'share', 'social', 'navbar', 'nav', 'menu', 'footer', 'header', 'topbar', 'masthead'])

const MAX_BLOCKS = 900
const MAX_CHARS = 70000

function styleHides(style: string): boolean {
  const s = style.toLowerCase().replace(/\s+/g, '')
  if (!s) return false
  return /display:none|visibility:hidden|visibility:collapse|opacity:0(?:\.0+)?(?![\d.])|font-size:0(?:px|pt|em|rem|%)?(?![\d.])|font-size:[0-3]px|color:transparent|text-indent:-\d{3,}|(?:left|top|right|bottom):-\d{3,}px|clip:rect\(0|clip-path:inset\(50%|height:0(?:px)?;(?:[^;]*;)*?overflow:hidden|max-height:0(?:px)?;(?:[^;]*;)*?overflow:hidden|width:0(?:px)?;(?:[^;]*;)*?overflow:hidden|transform:scale\(0\)/.test(s + ';')
}

function isHidden(el: HEl): boolean {
  if (el.attrs.hidden !== undefined) return true
  if ((el.attrs['aria-hidden'] || '').toLowerCase() === 'true') return true
  if (el.tag === 'input' && (el.attrs.type || '').toLowerCase() === 'hidden') return true
  if (el.tag === 'dialog' && el.attrs.open === undefined) return true
  if (el.attrs.style && styleHides(el.attrs.style)) return true
  const tokens = classTokens(el)
  return tokens.some(t => HIDDEN_CLASSES.has(t))
}

function hasToken(el: HEl, set: Set<string>): boolean {
  const tokens = classTokens(el)
  const id = (el.attrs.id || '').toLowerCase()
  if (id && set.has(id)) return true
  return tokens.some(t => set.has(t) || (set === NOISE_TOKENS && (t.startsWith('cookie') || t.startsWith('ad-') || t.startsWith('ads-') || t.startsWith('modal') || t.startsWith('popup'))))
}

function collapse(s: string): string {
  return s.replace(/[\s ]+/g, ' ')
}

function resolve(href: string | undefined, base: URL | null): string | null {
  if (!href) return null
  const raw = stripInvisible(href).trim()
  if (/^tel:[+\d\s().-]{3,30}$/i.test(raw)) return raw.replace(/[\s().-]/g, '')
  const h = raw.replace(/\s/g, '%20')
  if (!h || h.startsWith('#')) return null
  if (!base) return null
  const parsed = parseTarget(h, base)
  return parsed.ok ? parsed.url.toString() : null
}

function firstSrcset(srcset: string): string {
  const first = srcset.split(',')[0] || ''
  return first.trim().split(/\s+/)[0] || ''
}

function metaContent(root: HEl, key: string): string {
  const el = findFirst(root, e => e.tag === 'meta' && ((e.attrs.name || '').toLowerCase() === key || (e.attrs.property || '').toLowerCase() === key) && !!e.attrs.content)
  return el ? collapse(el.attrs.content).trim() : ''
}

interface ProductFacts { name?: string; sku?: string; mpn?: string; brand?: string; price?: string; currency?: string; availability?: string }

function readStructuredProducts(root: HEl, hiddenSink: string[]): ProductFacts[] {
  const out: ProductFacts[] = []
  const scripts = findAll(root, e => e.tag === 'script' && /ld\+json/i.test(e.attrs.type || ''), 12)
  const str = (v: unknown, max = 160): string | undefined => (typeof v === 'string' || typeof v === 'number') ? stripInvisible(String(v)).replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 6 || out.length >= 6) return
    if (Array.isArray(value)) { value.slice(0, 40).forEach(v => visit(v, depth + 1)); return }
    const o = value as Record<string, unknown>
    const type = ([] as unknown[]).concat(o['@type'] as unknown).map(t => String(t)).join(' ')
    if (/(^|\s)(Product|AutoPart|Vehicle|IndividualProduct)(\s|$)/i.test(type)) {
      const offersRaw = o.offers
      const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as Record<string, unknown> | undefined
      const brand = typeof o.brand === 'object' && o.brand ? str((o.brand as Record<string, unknown>).name) : str(o.brand)
      const facts: ProductFacts = {
        name: str(o.name), sku: str(o.sku, 60), mpn: str(o.mpn, 60), brand,
        price: str(offer?.price ?? (offer as Record<string, unknown> | undefined)?.lowPrice, 20), currency: str(offer?.priceCurrency, 6),
        availability: str(offer?.availability, 80)?.replace(/^https?:\/\/schema\.org\//i, ''),
      }
      if (facts.name || facts.price) out.push(facts)
      if (typeof o.description === 'string') hiddenSink.push(o.description.slice(0, 600))
    }
    for (const key of Object.keys(o).slice(0, 40)) if (key !== 'offers' && key !== 'brand') visit(o[key], depth + 1)
  }
  for (const s of scripts) {
    const raw = textOf(s).trim()
    if (!raw) continue
    try { visit(JSON.parse(raw), 0) } catch { /* not valid JSON: ignore */ }
  }
  return out
}

export function extractReader(html: string, pageUrl: string): ReaderDoc {
  const { root, truncated: parseTruncated } = parseHtml(html)
  let base: URL | null = null
  const pageParsed = parseTarget(pageUrl)
  if (pageParsed.ok) base = pageParsed.url
  const baseTag = findFirst(root, e => e.tag === 'base' && !!e.attrs.href)
  if (baseTag && base) {
    const b = parseTarget(baseTag.attrs.href, base)
    if (b.ok) base = b.url
  }

  const htmlEl = findFirst(root, e => e.tag === 'html')
  const lang = (htmlEl?.attrs.lang || '').slice(0, 10)
  const titleEl = findFirst(root, e => e.tag === 'title')
  const ogTitle = metaContent(root, 'og:title')
  const h1 = findFirst(root, e => e.tag === 'h1')
  const title = cleanPageText(collapse(titleEl ? textOf(titleEl) : '') || ogTitle || (h1 ? collapse(textOf(h1)) : ''), 200) || (pageParsed.ok ? displayHost(pageParsed.url) : 'Untitled page')
  const siteName = cleanPageText(metaContent(root, 'og:site_name'), 80) || (pageParsed.ok ? displayHost(pageParsed.url) : '')
  const description = cleanPageText(metaContent(root, 'description') || metaContent(root, 'og:description'), 300)

  // Text a person cannot see, kept only to check it for words aimed at an AI.
  const hiddenParts: string[] = []
  const hiddenBudget = { left: 30000 }
  const sinkHidden = (s: string) => {
    if (hiddenBudget.left <= 0) return
    const t = s.trim().slice(0, hiddenBudget.left)
    if (t) { hiddenParts.push(t); hiddenBudget.left -= t.length }
  }

  // Page-level facts
  const hasPassword = findFirst(root, e => e.tag === 'input' && (e.attrs.type || '').toLowerCase() === 'password') !== null
  const products = readStructuredProducts(root, hiddenParts)

  // Choose the part of the page to read.
  const bodyEl = findFirst(root, e => e.tag === 'body') || root
  const candidates = findAll(bodyEl, e => (e.tag === 'main' || e.tag === 'article' || (e.attrs.role || '').toLowerCase() === 'main') && !isHidden(e), 8)
  let container: HEl = bodyEl
  let usingMain = false
  let bestLen = 0
  for (const c of candidates) {
    const len = textOf(c, e => SKIP_TAGS.has(e.tag)).length
    if (len > bestLen) { bestLen = len; container = c }
  }
  if (bestLen >= 200) usingMain = true
  else container = bodyEl

  const links: ReaderLink[] = []
  const linkIndex = new Map<string, number>()
  const forms: ReaderForm[] = []
  const blocks: Block[] = []
  let chars = 0
  let truncated = parseTruncated
  let runs: Inline[] = []
  let current: { k: 'p' | 'h' | 'li' | 'quote'; level?: 1 | 2 | 3 | 4; depth?: number; ordered?: boolean; index?: number } = { k: 'p' }
  let images = 0
  let visibleFields = 0
  const listStack: Array<{ ordered: boolean; count: number }> = []
  let bold = 0
  let italic = 0
  let codeDepth = 0
  let anchor: { href: string; n: number } | null = null

  const full = () => blocks.length >= MAX_BLOCKS || chars >= MAX_CHARS

  const pushBlock = (b: Block, size: number) => {
    if (full()) { truncated = true; return }
    blocks.push(b)
    chars += size
  }

  const flush = () => {
    if (!runs.length) return
    // Tidy: trim the ends, merge neighbours with the same style.
    const merged: Inline[] = []
    for (const r of runs) {
      if (!r.t) continue
      const last = merged[merged.length - 1]
      if (last && last.href === r.href && last.n === r.n && !!last.b === !!r.b && !!last.i === !!r.i && !!last.code === !!r.code) last.t += r.t
      else merged.push({ ...r })
    }
    runs = []
    if (merged.length) {
      merged[0].t = merged[0].t.replace(/^\s+/, '')
      merged[merged.length - 1].t = merged[merged.length - 1].t.replace(/\s+$/, '')
    }
    const clean = merged.filter(r => r.t.length > 0)
    const size = clean.reduce((n, r) => n + r.t.length, 0)
    if (!size) return
    if (current.k === 'h') pushBlock({ k: 'h', level: current.level || 2, runs: clean }, size)
    else if (current.k === 'li') pushBlock({ k: 'li', depth: current.depth || 0, ordered: !!current.ordered, index: current.index || 0, runs: clean }, size)
    else if (current.k === 'quote') pushBlock({ k: 'quote', runs: clean }, size)
    else pushBlock({ k: 'p', runs: clean }, size)
  }

  const addText = (raw: string) => {
    const text = stripInvisible(raw)
    if (!text) return
    const t = collapse(text)
    if (!t.trim() && !runs.length) return
    const run: Inline = { t }
    if (anchor) { run.href = anchor.href; run.n = anchor.n }
    if (bold) run.b = true
    if (italic) run.i = true
    if (codeDepth) run.code = true
    runs.push(run)
  }

  const linkNumber = (text: string, href: string): number => {
    const key = href
    const hit = linkIndex.get(key)
    if (hit) return hit
    const n = links.length + 1
    if (n > 150) return 0
    links.push({ n, text: cleanPageText(collapse(text), 120) || displayHost(href) || href, href })
    linkIndex.set(key, n)
    return n
  }

  const labelFor = (el: HEl, form: HEl): string => {
    const aria = el.attrs['aria-label'] || el.attrs.title || el.attrs.placeholder || ''
    if (aria) return cleanPageText(collapse(aria), 60)
    const id = el.attrs.id
    if (id) {
      const lab = findFirst(form, e => e.tag === 'label' && e.attrs.for === id)
      if (lab) return cleanPageText(collapse(textOf(lab)), 60)
    }
    return el.attrs.name ? cleanPageText(el.attrs.name.replace(/[_-]+/g, ' '), 40) : ''
  }

  const describeForm = (form: HEl): ReaderForm => {
    const fields: ReaderForm['fields'] = []
    for (const f of findAll(form, e => (e.tag === 'input' || e.tag === 'select' || e.tag === 'textarea'), 60)) {
      const type = (f.attrs.type || (f.tag === 'input' ? 'text' : f.tag)).toLowerCase()
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type) || isHidden(f)) continue
      fields.push({ label: labelFor(f, form), type, name: (f.attrs.name || '').slice(0, 40) })
    }
    const method = (form.attrs.method || 'get').toLowerCase() === 'post' ? 'post' : 'get'
    const action = resolve(form.attrs.action, base) || ''
    const kind = fields.some(f => f.type === 'password') ? 'Sign-in form' : fields.some(f => f.type === 'search') ? 'Search form' : 'Form'
    const names = fields.map(f => f.label || f.name || f.type).filter(Boolean).slice(0, 5)
    return { method, action, fields: fields.slice(0, 20), summary: `${kind}${names.length ? `: ${names.join(', ')}` : ''}` }
  }

  const tableRows = (table: HEl): { rows: string[][]; header: boolean; layout: boolean } => {
    const rows: string[][] = []
    let header = false
    let nested = false
    const trs = findAll(table, e => e.tag === 'tr', 80)
    for (const tr of trs) {
      const cells = tr.kids.filter((k): k is HEl => k.t === 'el' && (k.tag === 'td' || k.tag === 'th'))
      if (!cells.length) continue
      if (cells.some(c => findFirst(c, e => e.tag === 'table'))) nested = true
      if (rows.length === 0 && cells.every(c => c.tag === 'th')) header = true
      rows.push(cells.slice(0, 12).map(c => cleanPageText(collapse(textOf(c, e => SKIP_TAGS.has(e.tag) || isHidden(e))), 220)))
    }
    const wide = rows.filter(r => r.length >= 2).length
    const avg = rows.length ? rows.reduce((n, r) => n + r.join('').length, 0) / rows.length : 0
    return { rows, header, layout: nested || rows.length < 2 || wide < Math.max(2, rows.length * 0.6) || avg > 400 }
  }

  const skipEl = (el: HEl): boolean => {
    if (SKIP_TAGS.has(el.tag)) return true
    if (el.tag === 'dialog' && el.attrs.open === undefined) return true
    if (isHidden(el)) return true
    if (hasToken(el, NOISE_TOKENS)) return true
    if (!usingMain) {
      if (CHROME_TAGS.has(el.tag)) return true
      if (hasToken(el, CHROME_TOKENS) && textOf(el).length < 3000) return true
    } else if (el.tag === 'aside' || el.tag === 'nav') {
      return true
    }
    return false
  }

  const handleHidden = (el: HEl) => {
    if (el.tag === 'script' || el.tag === 'style' || el.tag === 'noscript' || el.tag === 'template') return
    if (isHidden(el) || hasToken(el, NOISE_TOKENS)) {
      if (el.tag !== 'head') sinkHidden(textOf(el, e => SKIP_TAGS.has(e.tag)))
    }
  }

  const visit = (node: HNode): void => {
    if (full()) { truncated = true; return }
    if (node.t === 'tx') { addText(node.text); return }
    if (node.t === 'cm') { sinkHidden(node.text); return }
    const el = node
    const tag = el.tag

    if (skipEl(el)) { handleHidden(el); return }

    if (FORM_CONTROL_TAGS.has(tag)) {
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const t = (el.attrs.type || 'text').toLowerCase()
        if (!['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(t)) visibleFields++
      }
      // Labels sometimes hold real text next to a control. Keep their words.
      if (tag === 'label') { for (const k of el.kids) visit(k) }
      return
    }

    if (tag === 'form') {
      flush()
      const f = describeForm(el)
      if (forms.length < 8) forms.push(f)
      if (f.fields.length) pushBlock({ k: 'form', summary: f.summary }, f.summary.length)
      return
    }

    if (tag === 'br') { runs.push({ t: ' ' }); return }
    if (tag === 'hr') { flush(); pushBlock({ k: 'hr' }, 1); return }

    if (tag === 'img') {
      flush()
      const alt = cleanPageText(collapse(el.attrs.alt || ''), 160)
      if (alt) sinkHidden(alt)
      const w = Number(el.attrs.width), h = Number(el.attrs.height)
      if ((Number.isFinite(w) && w > 0 && w <= 3) || (Number.isFinite(h) && h > 0 && h <= 3)) return
      const src = resolve(el.attrs.src || el.attrs['data-src'] || firstSrcset(el.attrs.srcset || el.attrs['data-srcset'] || ''), base)
      if (src && /^https?:/i.test(src) && images < 40) {
        images++
        pushBlock({ k: 'img', src, alt }, 40)
      }
      return
    }

    if (tag === 'pre') {
      flush()
      const text = cleanPageText(textOf(el, e => SKIP_TAGS.has(e.tag) || isHidden(e)).replace(/\r/g, ''), 4000)
      if (text) pushBlock({ k: 'pre', text }, text.length)
      return
    }

    if (tag === 'table') {
      flush()
      const info = tableRows(el)
      if (!info.layout) {
        const size = info.rows.reduce((n, r) => n + r.join('').length, 0)
        pushBlock({ k: 'table', rows: info.rows, header: info.header }, size)
        return
      }
      for (const k of el.kids) visit(k)
      flush()
      return
    }

    if (tag === 'a') {
      const href = resolve(el.attrs.href, base)
      if (href) {
        const label = collapse(textOf(el, e => SKIP_TAGS.has(e.tag) || isHidden(e))) || collapse(el.attrs['aria-label'] || el.attrs.title || '')
        const n = linkNumber(label, href)
        const prev = anchor
        anchor = { href, n }
        for (const k of el.kids) visit(k)
        anchor = prev
        // A link with only a picture in it still deserves a name.
        if (!label.trim()) addText(displayHost(href))
        return
      }
      for (const k of el.kids) visit(k)
      return
    }

    if (INLINE_TAGS.has(tag)) {
      const isB = tag === 'b' || tag === 'strong'
      const isI = tag === 'i' || tag === 'em' || tag === 'cite'
      const isC = tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt'
      if (isB) bold++
      if (isI) italic++
      if (isC) codeDepth++
      for (const k of el.kids) visit(k)
      if (isB) bold--
      if (isI) italic--
      if (isC) codeDepth--
      return
    }

    if (/^h[1-6]$/.test(tag)) {
      flush()
      const saved = current
      current = { k: 'h', level: Math.min(4, Number(tag[1])) as 1 | 2 | 3 | 4 }
      for (const k of el.kids) visit(k)
      flush()
      current = saved
      return
    }

    if (tag === 'ul' || tag === 'ol' || tag === 'menu') {
      flush()
      listStack.push({ ordered: tag === 'ol', count: 0 })
      for (const k of el.kids) visit(k)
      flush()
      listStack.pop()
      return
    }

    if (tag === 'li') {
      flush()
      const list = listStack[listStack.length - 1]
      if (list) list.count++
      const saved = current
      current = { k: 'li', depth: Math.min(4, Math.max(0, listStack.length - 1)), ordered: !!list?.ordered, index: list?.count || 0 }
      for (const k of el.kids) visit(k)
      flush()
      current = saved
      return
    }

    if (tag === 'blockquote') {
      flush()
      const saved = current
      current = { k: 'quote' }
      for (const k of el.kids) visit(k)
      flush()
      current = saved
      return
    }

    if (tag === 'dt' || tag === 'summary' || tag === 'caption' || tag === 'figcaption') {
      flush()
      bold++
      for (const k of el.kids) visit(k)
      bold--
      flush()
      return
    }

    // Every other element is a block-level container: div, p, section, article, main, dd, details, figure, ...
    flush()
    for (const k of el.kids) visit(k)
    flush()
  }

  // Count boxes to type into anywhere on the page, even in a header that reader view leaves out.
  walk(bodyEl, n => {
    if (n.t !== 'el') return
    if (SKIP_TAGS.has(n.tag) || isHidden(n)) return false
    if (n.tag === 'input' || n.tag === 'textarea' || n.tag === 'select') {
      const t = (n.attrs.type || 'text').toLowerCase()
      if (!['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(t)) visibleFields = Math.max(visibleFields, 1)
    }
  })
  // Product facts from the page's own structured data come first, labelled as the page's claim.
  if (products.length) {
    for (const p of products.slice(0, 3)) {
      const rows: Array<[string, string]> = []
      if (p.name) rows.push(['Name', p.name])
      if (p.brand) rows.push(['Brand', p.brand])
      if (p.sku) rows.push(['SKU', p.sku])
      if (p.mpn) rows.push(['Part number', p.mpn])
      if (p.price) rows.push(['Price shown', `${p.currency === 'USD' || !p.currency ? '$' : `${p.currency} `}${p.price}`])
      if (p.availability) rows.push(['Availability', p.availability])
      if (rows.length) pushBlock({ k: 'facts', title: 'Product details the page lists', rows }, 80)
    }
  }

  visit(container)
  flush()

  // Forms anywhere on the page, even in a header that reader view leaves out. A form already listed is not added twice.
  for (const f of findAll(bodyEl, e => e.tag === 'form' && !isHidden(e), 8)) {
    const d = describeForm(f)
    const seen = forms.some(x => x.action === d.action && x.summary === d.summary)
    if (d.fields.length && !seen && forms.length < 8) forms.push(d)
  }

  // Text for an AI.
  const lines: string[] = []
  const runText = (rs: Inline[]) => rs.map(r => (r.href && r.n ? `${r.t} [L${r.n}]` : r.t)).join('')
  for (const b of blocks) {
    switch (b.k) {
      case 'h': lines.push(`\n${'#'.repeat(b.level)} ${runText(b.runs)}`); break
      case 'p': lines.push(runText(b.runs)); break
      case 'li': lines.push(`${'  '.repeat(b.depth)}${b.ordered ? `${b.index}.` : '-'} ${runText(b.runs)}`); break
      case 'quote': lines.push(`> ${runText(b.runs)}`); break
      case 'pre': lines.push(b.text); break
      case 'img': if (b.alt) lines.push(`[picture: ${b.alt}]`); break
      case 'table': for (const row of b.rows) lines.push(row.join(' | ')); break
      case 'form': lines.push(`[${b.summary}]`); break
      case 'facts': lines.push(`${b.title}: ${b.rows.map(([k, v]) => `${k} ${v}`).join('; ')}`); break
      case 'hr': lines.push('---'); break
    }
  }
  const text = cleanPageText(lines.join('\n'), 14000)
  const visibleForCheck = text + '\n' + links.map(l => l.text).join('\n')
  const injection = inspectPageText(visibleForCheck, hiddenParts.join('\n'), html.slice(0, 200000))

  return {
    url: pageUrl,
    title,
    siteName,
    description,
    lang,
    blocks,
    links,
    forms,
    text,
    truncated,
    signInRequired: hasPassword,
    hasFields: visibleFields > 0 || forms.some(f => f.fields.length > 0),
    injection,
    chars,
  }
}

/** A search result as shown in the browser. */
export interface SearchHit { title: string; url: string; snippet: string; host: string }

/** Read the plain-HTML search page of DuckDuckGo. Returns an empty list (not an error) when the page is a bot check. */
export function parseSearchResults(html: string): { hits: SearchHit[]; blocked: boolean } {
  const { root } = parseHtml(html, { maxNodes: 40000 })
  const bodyText = textOf(root).slice(0, 4000).toLowerCase()
  const blocked = /unusual traffic|verify you are human|are you a robot|anomaly|captcha|bots use duckduckgo|complete the following challenge/.test(bodyText) && !findFirst(root, e => classTokens(e).includes('result__a'))
  const hits: SearchHit[] = []
  for (const a of findAll(root, e => e.tag === 'a' && classTokens(e).includes('result__a'), 20)) {
    let href = a.attrs.href || ''
    if (href.startsWith('//')) href = `https:${href}`
    let target = href
    try {
      const u = new URL(href, 'https://duckduckgo.com')
      const uddg = u.searchParams.get('uddg')
      if (uddg) target = uddg
    } catch { continue }
    const parsed = parseTarget(target)
    if (!parsed.ok) continue
    if (/(^|\.)duckduckgo\.com$/i.test(parsed.host)) continue
    let container: HEl | null = a.parent
    for (let depth = 0; container && depth < 5; depth++, container = container.parent) {
      if (classTokens(container).some(t => t === 'result' || t === 'results_links' || t === 'web-result')) break
    }
    const snip = container ? findFirst(container, e => classTokens(e).includes('result__snippet')) : null
    hits.push({
      title: cleanPageText(collapse(textOf(a)), 160) || parsed.host,
      url: parsed.url.toString(),
      snippet: snip ? cleanPageText(collapse(textOf(snip)), 300) : '',
      host: displayHost(parsed.url),
    })
    if (hits.length >= 10) break
  }
  return { hits, blocked }
}
