/**
 * Reports as files and pages: one small table model (a "block") that becomes a CSV for the bookkeeper, a print page the browser
 * saves as a PDF, an email, and plain text. The screen, the download and the emailed copy are made from the same blocks,
 * so a number cannot differ between them.
 *
 * Nothing here reads or writes the database. Text from the shop's own data is always escaped before it goes into a page.
 */
import { csvCell, money2 } from './reports.ts'

export type ColKind = 'text' | 'money' | 'int' | 'pct' | 'hours'
export interface Col { label: string; kind: ColKind }
/** A number that formats differently from its column, for tables that mix dollars and counts in one column. */
export interface Typed { n: number; kind: ColKind }
export type Cell = string | number | null | undefined | Typed

export interface Block {
  id: string
  heading: string
  /** One plain sentence under the heading: what the table counts or what is missing from it. */
  note?: string
  columns: Col[]
  rows: Cell[][]
  /** A totals row. */
  footer?: Cell[]
  /** What to say when there are no rows. */
  empty?: string
}

export interface ReportBundle {
  title: string
  /** "Oct 1 to Oct 14, 2026". */
  subtitle: string
  shopName: string
  /** "Generated Oct 14, 2026". */
  generated: string
  headline?: string
  bullets: string[]
  blocks: Block[]
  /** Things to know before relying on the numbers. */
  notes: string[]
}

/* ---------- cells ---------- */

const isTyped = (v: Cell): v is Typed => typeof v === 'object' && v !== null && 'n' in v
const num = (v: Cell): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : isTyped(v) && Number.isFinite(v.n) ? v.n : null)

/** A cell as the screen and the print page show it. */
export function formatCell(v: Cell, colKind: ColKind): string {
  if (v === null || v === undefined || v === '') return colKind === 'text' ? '' : '–'
  const kind = isTyped(v) ? v.kind : colKind
  const n = num(v)
  if (n === null) return String(v)
  switch (kind) {
    case 'money': return n < 0 ? `-${money2(-n)}` : money2(n)
    case 'int': return Math.round(n).toLocaleString('en-US')
    case 'pct': return `${Math.round(n * 10) / 10}%`
    case 'hours': return `${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
    default: return String(n)
  }
}

/** A cell as a spreadsheet wants it: plain numbers, no dollar signs or commas. */
export function csvValue(v: Cell, colKind: ColKind): string | number {
  if (v === null || v === undefined) return ''
  const kind = isTyped(v) ? v.kind : colKind
  const n = num(v)
  if (n === null) return String(v)
  if (kind === 'money') return n.toFixed(2)
  if (kind === 'hours') return Math.round(n * 100) / 100
  if (kind === 'pct') return Math.round(n * 10) / 10
  return n
}

// A plain number written as text ("-5.00") must stay a number in the spreadsheet, so only other text gets the formula guard.
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/
const line = (cells: (string | number)[]) => cells.map(c => (typeof c === 'string' && NUMBER_TEXT.test(c) ? c : csvCell(c))).join(',')

/** One table as a CSV file's text. Opens in any spreadsheet. */
export function blockCsv(b: Block): string {
  const out = [line(b.columns.map(c => c.label))]
  for (const r of b.rows) out.push(line(b.columns.map((c, i) => csvValue(r[i], c.kind))))
  if (b.footer) out.push(line(b.columns.map((c, i) => csvValue(b.footer?.[i], c.kind))))
  return out.join('\r\n') + '\r\n'
}

/** Several tables in one file, each under its heading with a blank line between. */
export function blocksCsv(blocks: Block[]): string {
  return blocks.map(b => `${line([b.heading])}\r\n${blockCsv(b)}`).join('\r\n')
}

/** A file name that is safe on every system: "sales-2026-10-01-to-2026-10-14.csv". */
export function fileName(base: string, range: { from: string; to: string }, ext: 'csv' | 'iif' | 'html' | 'txt'): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report'
  return `${slug}-${range.from}${range.from === range.to ? '' : `-to-${range.to}`}.${ext}`
}

/* ---------- text ---------- */

export function plainText(b: ReportBundle): string {
  const out: string[] = [b.title, b.subtitle, b.shopName ? `For ${b.shopName}` : '', '']
  if (b.headline) out.push(b.headline, '')
  for (const p of b.bullets) out.push(`- ${p}`)
  if (b.bullets.length) out.push('')
  for (const blk of b.blocks) {
    out.push(blk.heading.toUpperCase())
    if (blk.note) out.push(blk.note)
    if (!blk.rows.length) out.push(blk.empty || 'Nothing to show.')
    for (const r of blk.rows) out.push(blk.columns.map((c, i) => formatCell(r[i], c.kind)).filter(Boolean).join('  |  '))
    if (blk.footer) out.push(blk.columns.map((c, i) => formatCell(blk.footer?.[i], c.kind)).filter(Boolean).join('  |  '))
    out.push('')
  }
  for (const n of b.notes) out.push(n)
  out.push(b.generated)
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim() + '\n'
}

/* ---------- pages ---------- */

export const esc = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Printed pages and emails cannot read the app's colour variables, so they carry their own plain, high-contrast colours.
const INK = '#1a1a1a', MUTED = '#555555', RULE = '#d4d4d4', SOFT = '#f4f4f4'

function tableHtml(b: Block, inline: boolean): string {
  const cellStyle = (right: boolean, head = false) =>
    inline ? `padding:6px 8px;border-bottom:1px solid ${RULE};text-align:${right ? 'right' : 'left'};font-size:13px;${head ? `font-weight:600;color:${MUTED};` : ''}` : ''
  const cls = (right: boolean) => (right ? ' class="r"' : '')
  const head = b.columns.map(c => `<th${cls(c.kind !== 'text')} style="${cellStyle(c.kind !== 'text', true)}">${esc(c.label)}</th>`).join('')
  const body = b.rows.map(r => `<tr>${b.columns.map((c, i) => `<td${cls(c.kind !== 'text')} style="${cellStyle(c.kind !== 'text')}">${esc(formatCell(r[i], c.kind))}</td>`).join('')}</tr>`).join('')
  const foot = b.footer ? `<tr class="total">${b.columns.map((c, i) => `<td${cls(c.kind !== 'text')} style="${cellStyle(c.kind !== 'text')}font-weight:700;">${esc(formatCell(b.footer?.[i], c.kind))}</td>`).join('')}</tr>` : ''
  const empty = !b.rows.length ? `<p style="margin:6px 0;color:${MUTED};font-size:13px;">${esc(b.empty || 'Nothing to show.')}</p>` : ''
  return `<h2 style="font-size:15px;margin:22px 0 4px;color:${INK};">${esc(b.heading)}</h2>${b.note ? `<p style="margin:0 0 6px;color:${MUTED};font-size:12.5px;">${esc(b.note)}</p>` : ''}${
    b.rows.length ? `<table style="border-collapse:collapse;width:100%;"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>` : empty}`
}

function bodyHtml(b: ReportBundle, inline: boolean): string {
  const bullets = b.bullets.length ? `<ul style="margin:10px 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.5;">${b.bullets.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
  const notes = b.notes.length ? `<div style="margin-top:22px;padding:10px 12px;background:${SOFT};border-radius:6px;font-size:12.5px;color:${MUTED};line-height:1.5;">${b.notes.map(n => `<p style="margin:0 0 4px;">${esc(n)}</p>`).join('')}</div>` : ''
  return `<h1 style="font-size:20px;margin:0;color:${INK};">${esc(b.title)}</h1>
<p style="margin:2px 0 0;color:${MUTED};font-size:13px;">${esc(b.subtitle)}${b.shopName ? ` &middot; ${esc(b.shopName)}` : ''}</p>
${b.headline ? `<p style="margin:14px 0 0;font-size:16px;font-weight:600;color:${INK};">${esc(b.headline)}</p>` : ''}${bullets}
${b.blocks.map(x => tableHtml(x, inline)).join('\n')}${notes}
<p style="margin:18px 0 0;color:${MUTED};font-size:12px;">${esc(b.generated)}</p>`
}

/** A whole page for printing. The browser's print dialog can save it as a PDF. */
export function printableHtml(b: ReportBundle): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.title)} - ${esc(b.subtitle)}</title>
<style>
@page{margin:16mm 14mm}
*{box-sizing:border-box}
body{margin:0 auto;max-width:820px;padding:20px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:${INK};background:#fff}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 8px;border-bottom:1px solid ${RULE};font-size:13px;text-align:left;vertical-align:top}
th{font-weight:600;color:${MUTED}}
.r{text-align:right;font-variant-numeric:tabular-nums}
.total td{border-top:2px solid ${INK};font-weight:700}
tr{page-break-inside:avoid}
h2{page-break-after:avoid}
</style></head><body>${bodyHtml(b, false)}</body></html>`
}

/** The same report for an email: inline styles, no scripts, no remote images. */
export function emailHtml(b: ReportBundle): string {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:${INK};">${bodyHtml(b, true)}</div>`
}
