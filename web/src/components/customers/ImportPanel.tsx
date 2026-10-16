'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import { importTemplateCsv } from '@/lib/customers/import'
import { COMMIT_ROW_CAP, previewSentence } from '@/lib/customers/import-flow'
import type { SlimRow } from '@/lib/customers/import-flow'
import { JSON_HEADERS, asText, fetchJson } from './http'
import { saveBlob } from './ExportPanel'
import { phonePretty } from '@/lib/today'

const MAX_FILE_BYTES = 1_500_000
const FIRST_ROWS = 10

interface Counts { total: number; new: number; duplicate: number; invalid: number }
interface Preview {
  /** The exact text this preview was made from. The Confirm import button works only while the box still holds it. */
  text: string
  fingerprint: string
  counts: Counts
  rows: SlimRow[]
  used: { field: string; label: string; header: string }[]
  ignored: string[]
}
interface Result { added: number; skipped: number; invalid: number; tagsSaved: number; tagsNote: string }

type Show = 'all' | 'new' | 'duplicate' | 'invalid'
type Phase = 'idle' | 'previewing' | 'saving'

const readCounts = (v: unknown): Counts => {
  const c = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : 0)
  return { total: n('total'), new: n('new'), duplicate: n('duplicate'), invalid: n('invalid') }
}

const STATUS_WORD: Record<SlimRow['status'], { word: string; lamp: string }> = {
  new: { word: 'Will be added', lamp: 'lamp-green' },
  duplicate: { word: 'Skipped', lamp: 'lamp-amber' },
  invalid: { word: 'Problem', lamp: 'lamp-red' },
}

function Tile({ lamp, label, value }: { lamp: string; label: string; value: number }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <dt className="flex items-center gap-1.5 text-[0.875rem] font-bold text-text-secondary"><span className={`lamp ${lamp}`} aria-hidden="true" />{label}</dt>
      <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{value}</dd>
    </div>
  )
}

/**
 * Customer tools, Import. Choose a CSV file or paste the list, look at the preview, then confirm. The preview changes nothing.
 * Import only adds new customers: anyone who matches a customer already in the book (same phone, email or name) is skipped,
 * never updated. The Confirm import button is on only while the preview matches what is in the box right now.
 */
export default function ImportPanel({ onImported, onDirty }: { onImported: (added: number) => void; onDirty: (dirty: boolean) => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [shown, setShown] = useState(FIRST_ROWS)
  const fileInput = useRef<HTMLInputElement>(null)
  const previewTop = useRef<HTMLElement>(null)
  const seq = useRef(0)

  const current = preview !== null && preview.text === text
  // A new preview is below the box on a phone, so bring it into view.
  const [previewSeq, setPreviewSeq] = useState(0)
  useEffect(() => { if (previewSeq > 0) previewTop.current?.scrollIntoView({ block: 'start' }) }, [previewSeq])
  useEffect(() => { onDirty(text.trim() !== '' && result === null) }, [text, result, onDirty])

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_FILE_BYTES) { setError({ title: 'The file was not opened.', message: 'That file is bigger than 1.5 MB. Split it into smaller files of 500 customers or fewer.' }); return }
    try {
      const body = await file.text()
      setText(body); setFileName(file.name); setResult(null)
    } catch {
      setError({ title: 'The file was not opened.', message: 'That file could not be read. Try saving it as a CSV file again.' })
    }
  }

  const runPreview = async () => {
    if (phase !== 'idle' || text.trim() === '') return
    const mine = ++seq.current
    const sent = text
    setPhase('previewing'); setError(null); setResult(null)
    try {
      const r = await fetchJson('/api/customers/import/preview', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text: sent }) }, 60000)
      if (mine !== seq.current) return
      const d = r.data
      if (!r.ok || !d || d.ok !== true) {
        setPreview(null)
        setError({ title: 'The list was not read.', message: asText(d?.error) || 'The list could not be read. Nothing was changed. Check your connection and try again.' })
        return
      }
      setPreview({
        text: sent,
        fingerprint: asText(d.fingerprint),
        counts: readCounts(d.counts),
        rows: Array.isArray(d.rows) ? (d.rows as SlimRow[]) : [],
        used: Array.isArray(d.used) ? (d.used as Preview['used']) : [],
        ignored: Array.isArray(d.ignored) ? (d.ignored as string[]).filter(x => typeof x === 'string') : [],
      })
      setShow('all'); setShown(FIRST_ROWS); setPreviewSeq(n => n + 1)
    } catch {
      if (mine === seq.current) { setPreview(null); setError({ title: 'The list was not read.', message: 'We could not reach the server. Nothing was changed. Check your connection and try again.' }) }
    } finally {
      if (mine === seq.current) setPhase('idle')
    }
  }

  const confirmImport = async () => {
    if (phase !== 'idle' || !preview || !current || preview.counts.new === 0) return
    setPhase('saving'); setError(null)
    try {
      const r = await fetchJson('/api/customers/import/commit', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ text: preview.text, confirm: true, fingerprint: preview.fingerprint, file_name: fileName }),
      }, 120000)
      const d = r.data
      if (!r.ok || !d || d.ok !== true) {
        // A changed book means the preview is out of date: drop it so the button cannot be pressed on it again.
        if (r.status === 409) setPreview(null)
        setError({ title: 'The import did not go through.', message: asText(d?.error) || 'The import did not finish. Check your customer list before you try again.' })
        return
      }
      const added = typeof d.added === 'number' ? d.added : 0
      setResult({ added, skipped: typeof d.skipped === 'number' ? d.skipped : 0, invalid: typeof d.invalid === 'number' ? d.invalid : 0, tagsSaved: typeof d.tags_saved === 'number' ? d.tags_saved : 0, tagsNote: asText(d.tags_note) })
      setPreview(null)
      onImported(added)
    } catch {
      setError({ title: 'Check your customer list.', message: 'We could not tell whether the import finished. Close this and look at your customer list before you try again.' })
    } finally { setPhase('idle') }
  }

  const reset = () => {
    seq.current += 1
    setText(''); setFileName(''); setPreview(null); setError(null); setResult(null); setPhase('idle'); setShow('all'); setShown(FIRST_ROWS)
  }

  const rows = useMemo(() => (preview ? preview.rows.filter(r => show === 'all' || r.status === show) : []), [preview, show])
  const visible = rows.slice(0, shown)

  if (result) {
    return (
      <div className="space-y-4">
        <Notice kind={result.added > 0 ? 'success' : 'info'}>
          <p className="font-bold">{result.added > 0 ? `Added ${result.added} ${result.added === 1 ? 'customer' : 'customers'}.` : 'No customers were added.'}</p>
          <p className="mt-0.5 break-words">
            {result.skipped > 0 && <>{result.skipped} skipped (already in your book, or repeated in the file). </>}
            {result.invalid > 0 && <>{result.invalid} {result.invalid === 1 ? 'row had a problem and was' : 'rows had problems and were'} not added. </>}
            Nobody who was already a customer was changed.
          </p>
          {result.tagsSaved > 0 && <p className="mt-0.5">Tags were saved on {result.tagsSaved} {result.tagsSaved === 1 ? 'customer' : 'customers'}.</p>}
          {result.tagsNote && <p className="mt-0.5 break-words">{result.tagsNote}</p>}
        </Notice>
        <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={reset}>Import another list</button>
      </div>
    )
  }

  const busy = phase !== 'idle'
  return (
    <div className="space-y-4">
      <div>
        <h3 className="section-title">Add customers from a list</h3>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">
          Import only adds new customers. It never changes anyone who is already in your book: a row with the same phone number, email or name as a customer you
          have is skipped. Up to {COMMIT_ROW_CAP} customers at a time. You see a full preview first, and nothing is saved until you press Confirm import.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input ref={fileInput} id="import-file" type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" tabIndex={-1} onChange={e => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Icon name="upload" className="h-5 w-5" />Choose a CSV file
          </button>
          <button type="button" className="btn btn-ghost w-full sm:w-auto" onClick={() => saveBlob('customer-import-template.csv', new Blob([`﻿${importTemplateCsv()}`], { type: 'text/csv;charset=utf-8' }))}>
            <Icon name="download" className="h-5 w-5" />Download a blank template
          </button>
        </div>
        {fileName && <p className="break-words text-[0.9375rem] text-text-secondary">File: <span className="font-bold text-text-primary">{fileName}</span></p>}
        <div>
          <label htmlFor="import-text" className="form-label">Or paste your list here</label>
          <textarea
            id="import-text" className="form-textarea" rows={6} value={text} disabled={busy}
            placeholder={'Name,Phone,Email\nJane Smith,(713) 555-0142,jane@example.com'}
            onChange={e => { setText(e.target.value); setFileName(''); setError(null) }}
            spellCheck={false}
          />
          <p className="form-hint">The first row must be the column names. Name is required. Phone, email, address, vehicle, notes and tags are read when they are there.</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => void runPreview()} disabled={busy || text.trim() === ''}>
          {phase === 'previewing' ? 'Reading the list…' : preview ? 'Preview again' : 'Preview import'}
        </button>
      </div>

      {error && (
        <Notice kind="error">
          <p className="font-bold">{error.title}</p>
          <p className="mt-0.5 break-words">{error.message}</p>
        </Notice>
      )}

      {phase === 'previewing' && (
        <div className="space-y-2" aria-busy="true" aria-label="Reading the list" role="status">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}</div>
      )}

      {preview && phase !== 'previewing' && (
        <section ref={previewTop} aria-labelledby="import-preview" className="scroll-mt-2 space-y-3">
          <h3 id="import-preview" className="section-title">Preview</h3>
          {!current && (
            <Notice kind="warn">
              <p className="font-bold">The list changed after this preview.</p>
              <p className="mt-0.5">Press Preview again. Confirm import turns back on when the preview matches the list.</p>
            </Notice>
          )}
          <dl className="panel grid grid-cols-3 overflow-hidden">
            <Tile lamp="lamp-green" label="Added" value={preview.counts.new} />
            <div className="border-l border-border"><Tile lamp="lamp-amber" label="Skipped" value={preview.counts.duplicate} /></div>
            <div className="border-l border-border"><Tile lamp="lamp-red" label="Problems" value={preview.counts.invalid} /></div>
          </dl>
          <p className="break-words text-[0.9375rem]">{previewSentence(preview.counts)}</p>
          {preview.used.length > 0 && (
            <p className="break-words text-[0.9375rem] text-text-secondary">
              Columns read: {preview.used.map(u => u.label).join(', ')}.
              {preview.ignored.length > 0 && <> Not used: {preview.ignored.join(', ')}.</>}
            </p>
          )}

          <FilterChips<Show>
            scroll label="Show rows" value={show} onChange={k => { setShow(k); setShown(FIRST_ROWS) }}
            options={[
              { key: 'all', label: 'All', count: preview.counts.total },
              { key: 'new', label: 'Added', count: preview.counts.new },
              { key: 'duplicate', label: 'Skipped', count: preview.counts.duplicate },
              { key: 'invalid', label: 'Problems', count: preview.counts.invalid },
            ]}
          />

          {rows.length === 0 ? (
            <div className="empty-state"><p className="font-bold text-text-primary">No rows in this group</p></div>
          ) : (
            <>
              <ul className="ledger" aria-label="Rows in your list">
                {visible.map(r => {
                  const s = STATUS_WORD[r.status]
                  const detail = [r.phone ? phonePretty(r.phone) : '', r.email, r.vehicle].filter(Boolean).join(' · ')
                  return (
                    <li key={r.line} className="px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-bold">{r.name || 'No name'}</p>
                          {detail && <p className="break-words text-[0.9375rem] text-text-secondary">{detail}</p>}
                          {r.tags.length > 0 && <p className="break-words text-[0.9375rem] text-text-secondary">Tags: {r.tags.join(', ')}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="flex items-center justify-end gap-1.5 text-[0.9375rem] font-bold"><span className={`lamp ${s.lamp}`} aria-hidden="true" />{s.word}</p>
                          <p className="num text-[0.875rem] text-text-secondary">Line {r.line}</p>
                        </div>
                      </div>
                      {r.reason && <p className="mt-1 break-words text-[0.9375rem]">{r.reason}</p>}
                      {r.notes.map((n, i) => <p key={i} className="mt-1 break-words text-[0.9375rem] text-text-secondary">{n}</p>)}
                    </li>
                  )
                })}
              </ul>
              {rows.length > shown && (
                <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => setShown(n => n + 25)}>
                  Show more ({rows.length - shown} more)
                </button>
              )}
            </>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => void confirmImport()} disabled={busy || !current || preview.counts.new === 0}>
              {phase === 'saving' ? 'Adding customers…' : 'Confirm import'}
            </button>
            <p className="text-[0.9375rem] text-text-secondary">
              {preview.counts.new === 0
                ? 'There is nothing new to add from this list.'
                : `Adds ${preview.counts.new} new ${preview.counts.new === 1 ? 'customer' : 'customers'}. Nobody already in your book is changed.`}
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
