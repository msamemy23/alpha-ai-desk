'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { stamp } from './utils'
import type { CallRecord } from './utils'

/** What the sheet starts with: the caller's number, what the AI heard them need, and when they called. All of it can be changed before saving. */
export function leadDraft(call: CallRecord, number: string) {
  const service = call.service_needed && call.service_needed !== 'unknown' ? call.service_needed : ''
  const heard = [call.lead_reasoning, call.key_quotes ? `They said: “${call.key_quotes}”` : ''].filter(Boolean).join(' ')
  const notes = `Called ${stamp(call.start_time)}.${heard ? ` ${heard}` : ''}`.slice(0, 600)
  return { phone: number, service, notes }
}

/**
 * Save the person on a call as a lead. It goes through the same server step as a lead taken at the counter, so the same number is never
 * saved twice: calling again adds to the first lead. Nothing is sent to the caller.
 */
export default function LeadFromCallSheet({ call, number, authHeaders, onClose, onDone }: {
  call: CallRecord
  number: string
  authHeaders: () => Promise<Record<string, string>>
  onClose: () => void
  onDone: (message: string, name: string) => void
}) {
  const draft = leadDraft(call, number)
  const [name, setName] = useState('')
  const [service, setService] = useState(draft.service)
  const [notes, setNotes] = useState(draft.notes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const busy = useRef(false)

  const save = async () => {
    if (busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const res = await fetch('/api/growth/capture', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ action: 'capture', name: name.trim(), phone: number, source: 'Phone Call', service: service.trim(), notes: notes.trim() }),
      })
      const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
      if (!res.ok) { setError(`The lead was not saved. ${data.error || 'Check your connection and try again.'}`); return }
      setSaved(data.message || 'Saved as a lead.')
    } catch {
      setError('The lead was not saved. Check your connection and try again.')
    } finally { busy.current = false; setSaving(false) }
  }

  if (saved) {
    return (
      <Sheet open onClose={() => onDone(saved, name.trim())} title="Lead saved">
        <div className="space-y-4">
          <p className="flex items-start gap-2 font-bold text-green"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0" />{saved}</p>
          <p className="text-[0.9375rem] text-text-secondary">You will find it in Get more customers, under Leads. Nothing was sent to the caller.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => onDone(saved, name.trim())}>Done</button>
            <Link href="/growth?tab=leads" className="btn btn-primary no-underline">Open Leads</Link>
          </div>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title="Save as a lead">
      <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4" noValidate>
        <p className="text-[0.9375rem] text-text-secondary">Keep this caller on your Leads list so you can follow up. Calling again later adds to the same lead.</p>
        <div className="rounded-lg border border-border bg-bg-base px-4 py-3">
          <p className="text-[0.8125rem] text-text-secondary">Number</p>
          <p className="num font-bold">{phonePretty(number) || number}</p>
        </div>
        <div>
          <label htmlFor="lfc-name" className="form-label">Name (optional)</label>
          <input id="lfc-name" className="form-input" autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="If you got it on the call" />
        </div>
        <div>
          <label htmlFor="lfc-service" className="form-label">What they need (optional)</label>
          <input id="lfc-service" className="form-input" value={service} onChange={e => setService(e.target.value)} />
        </div>
        <div>
          <label htmlFor="lfc-notes" className="form-label">Notes (optional)</label>
          <textarea id="lfc-notes" className="form-textarea" rows={4} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save lead'}</button>
        </div>
      </form>
    </Sheet>
  )
}
