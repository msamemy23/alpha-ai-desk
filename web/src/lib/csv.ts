/**
 * Reading and writing CSV files: payroll, the customer export and the customer import.
 * It imports nothing, so the same code runs in the browser, on the server and under `node --test`.
 * Keep it to plain TypeScript (no enums, no parameter properties) so node can run it directly.
 */

/**
 * One cell, safe to open in a spreadsheet. A text cell that starts with = + - @ or a tab would run as a formula,
 * so a leading quote keeps it as text. Real numbers are written as they are (a negative number is not a formula).
 */
export function csvCell(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(',')

/** Rows to a file body. Lines end with CRLF, which every spreadsheet reads. */
export const toCsv = (rows: unknown[][]): string => rows.map(csvLine).join('\r\n') + '\r\n'

export interface ParsedCsv {
  rows: string[][]
  /** The separator that was found: comma, semicolon or tab. */
  delimiter: string
  /** True when the file had more rows than were read. */
  truncated: boolean
}

function guessDelimiter(text: string): string {
  // Look at the first line only, ignoring anything inside quotes.
  let inQuotes = false
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break
    else if (!inQuotes && ch in counts) counts[ch] += 1
  }
  let best = ','
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d
  return best
}

/**
 * Reads CSV text (RFC 4180): quoted cells, doubled quotes, commas and line breaks inside quotes.
 * A byte-order mark is dropped, blank lines are skipped, and a leading quote that was added to guard a formula is removed.
 */
export function parseCsv(input: string, opts: { maxRows?: number } = {}): ParsedCsv {
  const maxRows = opts.maxRows && opts.maxRows > 0 ? opts.maxRows : Infinity
  const text = String(input ?? '').replace(/^﻿/, '')
  const delimiter = guessDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let truncated = false
  let seenAny = false

  const endCell = () => {
    row.push(/^'[=+\-@]/.test(cell) ? cell.slice(1) : cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    // A line with nothing in it is not a row.
    if (row.some(c => c.trim() !== '')) {
      if (rows.length >= maxRows) truncated = true
      else rows.push(row)
    }
    row = []
    seenAny = false
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; seenAny = true; continue }
    if (ch === delimiter) { endCell(); seenAny = true; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
      continue
    }
    cell += ch
    seenAny = true
  }
  if (seenAny || cell !== '' || row.length > 0) endRow()
  return { rows, delimiter, truncated }
}
