'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { apiJson } from '@/lib/ai/client-api'

type Preview =
  | { state: 'loading' }
  | { state: 'pending' }
  | { state: 'available'; entryId: string; summary: string; canUndo: boolean }
  | { state: 'undone' }
  | { state: 'cannot' | 'unavailable'; reason: string }
  | { state: 'error'; message: string }

type Phase = 'idle' | 'confirm' | 'working' | 'done' | 'failed'

/**
 * "Undo" for something the assistant just did. It looks up the saved undo copy for that
 * change, says in plain words exactly what will be put back, and only runs after a second,
 * explicit tap. Undo is a compensating change: it never overwrites newer edits, and if the
 * record has moved on it stops and says so.
 *
 * Give either `entryId` (an Activity entry) or `operationKey` (the key the change was sent with,
 * for example `workflow:<review id>`).
 */
export default function UndoBar({ operationKey, entryId, label, onChange }: { operationKey?: string; entryId?: string; label?: string; onChange?: (state: 'undone' | 'available') => void }) {
  const [preview, setPreview] = useState<Preview>({ state: 'loading' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const tries = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    const result = await apiJson<{ state?: string; entryId?: string; summary?: string; canUndo?: boolean; reason?: string }>(entryId ? `/api/ai-undo?id=${encodeURIComponent(entryId)}` : `/api/ai-undo?operationKey=${encodeURIComponent(operationKey || '')}`)
    if (!alive.current) return
    if (!result.ok) {
      setPreview({ state: 'error', message: result.data.error || 'Could not check whether this can be undone.' })
      return
    }
    const data = result.data
    if (data.state === 'pending') {
      // The record of the change is written a moment after the change itself.
      if (tries.current < 5) {
        tries.current += 1
        timer.current = setTimeout(load, 1200)
        setPreview({ state: 'pending' })
      } else {
        setPreview({ state: 'unavailable', reason: 'The record of this change is not ready yet. Find it in Activity in a minute.' })
      }
      return
    }
    if (data.state === 'available') setPreview({ state: 'available', entryId: String(data.entryId), summary: String(data.summary || 'Put it back the way it was.'), canUndo: data.canUndo !== false })
    else if (data.state === 'undone') setPreview({ state: 'undone' })
    else setPreview({ state: data.state === 'cannot' ? 'cannot' : 'unavailable', reason: String(data.reason || 'There is no undo for this one.') })
  }, [operationKey, entryId])

  useEffect(() => {
    alive.current = true
    tries.current = 0
    void load()
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current) }
  }, [load])

  const run = async () => {
    if (preview.state !== 'available') return
    setPhase('working')
    const result = await apiJson<{ message?: string; undone?: boolean }>('/api/ai-undo', { method: 'POST', body: { id: preview.entryId }, headers: { 'x-ai-approval': 'confirm' } })
    if (!alive.current) return
    if (result.ok && result.data.undone) {
      setPhase('done')
      setMessage(result.data.message || 'Put back.')
      onChange?.('undone')
    } else {
      setPhase('failed')
      setMessage(result.data.error || 'Undo did not run. Nothing was changed.')
    }
  }

  if (preview.state === 'loading' || preview.state === 'pending') {
    return <p data-testid="undo-bar" role="status" className="flex max-w-[40rem] items-center gap-2 text-[0.875rem] text-text-secondary"><span className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />Checking whether this can be undone…</p>
  }
  if (preview.state === 'undone' || phase === 'done') {
    return <p data-testid="undo-bar" role="status" className="flex max-w-[40rem] items-start gap-2 text-[0.9375rem]"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span><span className="font-bold">Undone.</span> {phase === 'done' && message ? message : 'This change was put back.'}</span></p>
  }
  if (preview.state === 'cannot' || preview.state === 'unavailable') {
    return <p data-testid="undo-bar" className="flex max-w-[40rem] items-start gap-2 text-[0.875rem] text-text-secondary"><Icon name={preview.state === 'cannot' ? 'alert' : 'info'} className="mt-0.5 h-4 w-4 shrink-0" /><span>{preview.state === 'cannot' ? <span className="font-bold">Cannot be undone. </span> : null}{preview.reason}</span></p>
  }
  if (preview.state === 'error') {
    return <p data-testid="undo-bar" role="alert" className="flex max-w-[40rem] flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-text-secondary"><span>{preview.message}</span><button type="button" className="min-h-[44px] font-bold text-blue underline underline-offset-4" onClick={() => { tries.current = 0; setPreview({ state: 'loading' }); void load() }}>Check again</button></p>
  }
  if (preview.state !== 'available') return null
  if (!preview.canUndo) {
    return <p data-testid="undo-bar" className="flex max-w-[40rem] items-start gap-2 text-[0.875rem] text-text-secondary"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />Only an owner or manager can undo this.</p>
  }

  return <section aria-label={`Undo ${label || 'this change'}`} data-testid="undo-bar" className="max-w-[40rem] rounded-lg border border-line bg-bg-card p-3 sm:p-4">
    {phase === 'idle' && <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Icon name="undo" className="h-5 w-5 shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 basis-48 text-[0.9375rem] text-text-secondary">Changed your mind? You can put this back.</span>
      <button type="button" className="btn btn-secondary" onClick={() => setPhase('confirm')}>Undo</button>
    </div>}
    {(phase === 'confirm' || phase === 'working' || phase === 'failed') && <div>
      <p className="font-bold">Put it back?</p>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">{preview.summary}</p>
      <p className="mt-1 text-[0.8125rem] text-text-secondary">If it has been changed again since, Undo stops and changes nothing.</p>
      {phase === 'failed' && <p role="alert" className="mt-2 rounded-md bg-red/[0.12] px-3 py-2 text-[0.9375rem]">{message}</p>}
      <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary w-full sm:w-auto" disabled={phase === 'working'} onClick={() => { setPhase('idle'); setMessage('') }}>Keep it</button>
        <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={phase === 'working'} onClick={run} aria-busy={phase === 'working'}>{phase === 'working' ? 'Putting it back…' : phase === 'failed' ? 'Try undo again' : 'Yes, undo it'}</button>
      </div>
    </div>}
  </section>
}
