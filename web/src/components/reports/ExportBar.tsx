'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { blocksCsv, fileName, printableHtml } from '@/lib/report-files'
import type { Block, ReportBundle } from '@/lib/report-files'
import { openPrintable, saveText } from './files'

/**
 * Download the tables on screen as a CSV for a spreadsheet, or print the report (the print window saves it as a PDF).
 * Both are made from the same tables the screen shows, so the file always matches the screen.
 */
export default function ExportBar({ bundle, blocks, base, range, className = '' }: {
  bundle?: ReportBundle
  blocks?: Block[]
  base: string
  range: { from: string; to: string }
  className?: string
}) {
  const [problem, setProblem] = useState('')
  const tables = blocks ?? bundle?.blocks ?? []
  const csv = () => {
    try { saveText(fileName(base, range, 'csv'), blocksCsv(tables)); setProblem('') }
    catch { setProblem('The file could not be made. Try a shorter period.') }
  }
  const print = () => {
    if (!bundle) return
    try { setProblem(openPrintable(printableHtml(bundle)) ? '' : 'Your browser blocked the print window. Allow pop-ups for this site and try again.') }
    catch { setProblem('The print page could not be made. Try again.') }
  }
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={csv} disabled={tables.length === 0}>
          <Icon name="download" className="h-5 w-5" />
          Download CSV
        </button>
        {bundle && (
          <button type="button" className="btn btn-secondary" onClick={print}>
            <Icon name="print" className="h-5 w-5" />
            Print or save as PDF
          </button>
        )}
      </div>
      {problem && <Notice kind="error" className="mt-2">{problem}</Notice>}
    </div>
  )
}
