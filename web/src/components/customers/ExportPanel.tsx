'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { exportFileName } from '@/lib/customers/export'
import { asText } from './http'

/** The browser's own date as yyyy-mm-dd, so a file made in the evening is not named for tomorrow. */
function localDay(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Hands a downloaded file to the browser's save step. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; name: string; count: number } | { kind: 'error'; message: string }

/** Customer tools, Export: one button that downloads this shop's customers as a spreadsheet (CSV) file. */
export default function ExportPanel({ customerCount }: { customerCount: number }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const download = async () => {
    if (state.kind === 'busy') return
    setState({ kind: 'busy' })
    try {
      const res = await fetch('/api/customers/export', { cache: 'no-store' })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null)
        const reason = body && typeof body === 'object' ? asText((body as Record<string, unknown>).error) : ''
        setState({ kind: 'error', message: reason || 'The file could not be made. Check your connection and try again.' })
        return
      }
      const blob = await res.blob()
      const count = Number(res.headers.get('X-Customer-Count'))
      const name = exportFileName(localDay())
      saveBlob(name, blob)
      setState({ kind: 'done', name, count: Number.isFinite(count) ? count : customerCount })
    } catch {
      setState({ kind: 'error', message: 'The file could not be downloaded. Check your connection and try again.' })
    }
  }

  const busy = state.kind === 'busy'
  return (
    <div className="space-y-4">
      <div>
        <h3 className="section-title">Download your customer list</h3>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">
          One spreadsheet file (CSV) that opens in Excel, Numbers or Google Sheets. Each row is a customer, with their phone, email, address, vehicle,
          tags, text permission, repair orders, last visit, what they have paid, what they owe and notes.
        </p>
      </div>

      {customerCount === 0 ? (
        <div className="empty-state">
          <Icon name="customers" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-bold text-text-primary">No customers to download yet</p>
          <p className="mx-auto mt-1 max-w-md">Add a customer or import a list, then come back here.</p>
        </div>
      ) : (
        <p className="text-[0.9375rem]">
          Your book has <span className="num font-bold">{customerCount}</span> {customerCount === 1 ? 'customer' : 'customers'}.
        </p>
      )}

      {state.kind === 'error' && (
        <Notice kind="error">
          <p className="font-bold">The file was not downloaded.</p>
          <p className="mt-0.5 break-words">{state.message}</p>
        </Notice>
      )}
      {state.kind === 'done' && (
        <Notice kind="success">
          <p className="break-words"><span className="font-bold">Downloaded {state.name}</span> with <span className="num">{state.count}</span> {state.count === 1 ? 'customer' : 'customers'}. Look in your Downloads.</p>
        </Notice>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => void download()} disabled={busy || customerCount === 0}>
          <Icon name="download" className="h-5 w-5" />{busy ? 'Making the file…' : state.kind === 'error' ? 'Try again' : 'Download customers (CSV)'}
        </button>
      </div>

      <p className="text-[0.9375rem] text-text-secondary">
        The file has your customers&apos; phone numbers and email addresses. Keep it somewhere private and do not send it to anyone you do not trust.
      </p>
    </div>
  )
}
