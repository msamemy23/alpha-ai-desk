/** Saving and printing from the browser. Text only; nothing is uploaded anywhere. */

/** Gives the browser a file to save. A byte-order mark is added to CSV so Excel reads dollar signs and accents correctly. */
export function saveText(name: string, text: string, kind: 'csv' | 'iif' | 'html' | 'txt' = 'csv'): void {
  const type = kind === 'html' ? 'text/html;charset=utf-8' : kind === 'iif' ? 'application/octet-stream' : kind === 'txt' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8'
  const url = URL.createObjectURL(new Blob([kind === 'csv' ? '﻿' : '', text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Opens a print-ready page in a new tab. The browser's print dialog saves it as a PDF.
 * Returns false when the browser blocked the new tab, so the screen can say so.
 */
export function openPrintable(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const w = window.open(url, '_blank')
  if (!w) { URL.revokeObjectURL(url); return false }
  const go = () => { try { w.focus(); w.print() } catch { /* the person can still press print in the new tab */ } }
  w.addEventListener('load', () => setTimeout(go, 250))
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
  return true
}

/** Copies text. Falls back quietly (returns false) when the browser does not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
