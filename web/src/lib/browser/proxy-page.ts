/**
 * The older "open a page through the app" address (/api/web-proxy), kept safe.
 *
 * It no longer passes a site's own HTML through. It reads the page (see ./reader.ts) and writes a fresh, plain page from the
 * parts it understood: headings, paragraphs, lists, tables and links. Nothing from the site can run, links go back through
 * Alpha's own checked route, and the page loads nothing at all (no pictures, no styles, no fonts): pictures show their
 * description only. The Browser page's reader view is where pictures are shown, through Alpha's authenticated picture route.
 *
 * Imports only sibling pure files, so it runs on the server and under `node --test`.
 */
import type { Block, Inline, ReaderDoc } from './reader.ts'
import { displayHost } from './url.ts'

export const PROXY_LINK_BASE = '/api/web-proxy?url='

/** What the browser is told about the page: nothing may run and nothing may load. `sandbox` with no allowances adds a second wall. */
export const PROXY_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"

export function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
}

export interface ProxyRenderOptions {
  /** Shown after the site name in the header, as plain text. */
  note?: string
}

function href(raw: string | undefined): string | null {
  if (!raw) return null
  if (/^tel:[+\d]{3,30}$/i.test(raw)) return raw
  if (/^https?:\/\//i.test(raw)) return `${PROXY_LINK_BASE}${encodeURIComponent(raw)}`
  return null
}

function runs(items: Inline[]): string {
  return items.map(r => {
    let out = escapeHtml(r.t)
    if (r.code) out = `<code>${out}</code>`
    if (r.b) out = `<strong>${out}</strong>`
    if (r.i) out = `<em>${out}</em>`
    const link = href(r.href)
    if (link) out = `<a href="${escapeHtml(link)}" rel="noreferrer nofollow">${out}</a>`
    return out
  }).join('')
}

function block(b: Block): string {
  switch (b.k) {
    case 'h': return `<h${Math.min(4, Math.max(1, b.level))}>${runs(b.runs)}</h${Math.min(4, Math.max(1, b.level))}>`
    case 'p': return `<p>${runs(b.runs)}</p>`
    case 'li': return `<p class="li" style="margin-left:${Math.min(4, Math.max(0, b.depth)) * 1.25 + 1}rem">${b.ordered ? `${b.index}. ` : '&bull; '}${runs(b.runs)}</p>`
    case 'quote': return `<blockquote>${runs(b.runs)}</blockquote>`
    case 'pre': return `<pre>${escapeHtml(b.text)}</pre>`
    case 'img': return b.alt ? `<p class="muted">Picture: ${escapeHtml(b.alt)}</p>` : ''
    case 'table': {
      const rows = b.rows.slice(0, 200).map((row, i) => `<tr>${row.slice(0, 20).map(c => (b.header && i === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('')
      return `<div class="scroll"><table>${rows}</table></div>`
    }
    case 'form': return `<p class="muted">${escapeHtml(b.summary)}</p>`
    case 'facts': return `<dl><dt class="facts">${escapeHtml(b.title)}</dt>${b.rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`
    case 'hr': return '<hr>'
    default: return ''
  }
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
header{padding:12px 16px;border-bottom:1px solid GrayText;font-size:14px}
header strong{display:block;overflow-wrap:anywhere}
main{max-width:46rem;margin:0 auto;padding:16px}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em}
h1{font-size:1.6rem}h2{font-size:1.3rem}h3{font-size:1.1rem}h4{font-size:1rem}
p{margin:.6em 0;overflow-wrap:anywhere}
a{color:LinkText}
blockquote{margin:.8em 0;padding-left:12px;border-left:3px solid GrayText}
pre{overflow:auto;padding:12px;border:1px solid GrayText;font-size:14px}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}
.scroll{overflow:auto}
table{border-collapse:collapse;font-size:14px}
th,td{border:1px solid GrayText;padding:6px 8px;text-align:left;vertical-align:top}
.muted,.facts{color:GrayText}
dl{margin:.8em 0}dt{font-weight:600;margin-top:.4em}dd{margin:0 0 .2em}
.li{margin-top:.25em;margin-bottom:.25em}
`

/** A complete page for the document, with the site's name and address shown as plain text. */
export function renderProxyPage(doc: ReaderDoc, opts: ProxyRenderOptions): string {
  const title = doc.title || displayHost(doc.url)
  const body = doc.blocks.map(b => block(b)).join('\n')
  return `<!doctype html><html lang="${escapeHtml(doc.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><header><strong>${escapeHtml(title)}</strong>${escapeHtml(displayHost(doc.url))}${opts.note ? ` &middot; ${escapeHtml(opts.note)}` : ''}</header><main>${body || '<p class="muted">There is nothing to read on this page.</p>'}</main></body></html>`
}

/** A page that says why nothing was shown. Plain text only. */
export function renderProxyMessage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
}
