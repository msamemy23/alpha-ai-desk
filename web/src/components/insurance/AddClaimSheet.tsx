'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import { getShopId, supabase } from '@/lib/supabase'
import { readWithoutMissingColumns } from '@/lib/db-missing'
import { reasonOf, roLabel } from '@/lib/list-logic'
import { carOf, fmtDate, lampOf, statusLabel } from './types'
import type { Job } from './types'

/** Turn a repair order that is not a claim yet into one. Nothing else in the app does this. */
export default function AddClaimSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (job: Job) => Promise<string | null> }) {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const { data, error: e } = await readWithoutMissingColumns('id,ro_number,customer_name,concern,status,vehicle_year,vehicle_make,vehicle_model,created_at,is_insurance', ['ro_number'], columns => supabase.from('jobs').select(columns).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(400))
      if (e) throw new Error(e.message)
      setJobs(((data || []) as Job[]).filter(j => !j.is_insurance))
    } catch (e) {
      setError(`Your repair orders could not be loaded. ${reasonOf(e, 'Check your connection.')}`)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (open) { setQ(''); setAddError(''); void load() } }, [open, load])

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (jobs || []).filter(j => {
      if (!words.length) return true
      const hay = [j.customer_name, j.ro_number, j.concern, carOf(j)].join(' ').toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, 50)
  }, [jobs, q])

  const pick = async (j: Job) => {
    if (adding) return
    setAdding(j.id); setAddError('')
    const problem = await onAdd(j)
    setAdding('')
    if (problem) setAddError(problem)
  }

  return (
    <Sheet open={open} onClose={() => { if (!adding) onClose() }} title="Add an insurance claim" wide>
      <p className="mb-3 text-[0.9375rem] text-text-secondary">Pick the repair order this claim belongs to. It then shows up here, where you track the adjuster, deductible and supplements.</p>
      {error ? <ErrorCard title="Repair orders could not load" message={error} onRetry={() => void load()} busy={loading} />
        : jobs === null ? <RowsSkeleton rows={5} label="Loading repair orders" />
        : (
          <>
            <SearchField className="mb-3" label="Search repair orders by customer, number, car or concern" placeholder="Search repair orders" value={q} onChange={setQ} />
            {addError && <p role="alert" className="form-error !text-[0.875rem] mb-2">{addError}</p>}
            {shown.length === 0 ? (
              <EmptyBlock icon="wrench" title={q.trim() ? `No repair orders match “${q.trim()}”` : 'No repair orders to add'} action={<Link href="/jobs?new=1" className="btn btn-primary">Write up a repair order</Link>}>
                {q.trim() ? 'Try a customer name or the repair order number.' : 'Every repair order is already a claim, or none has been written yet. Write up the repair order first, then come back.'}
              </EmptyBlock>
            ) : (
              <ul className="ledger">
                {shown.map(j => (
                  <li key={j.id}>
                    <button type="button" className="ledger-row py-3" onClick={() => void pick(j)} disabled={!!adding}>
                      <span className="ledger-main">
                        <span className="ledger-title block !whitespace-normal">{j.customer_name || 'No customer'}{j.ro_number ? <span className="num font-normal text-text-secondary"> · {roLabel(j.ro_number)}</span> : null}</span>
                        <span className="ledger-sub block !whitespace-normal">{[carOf(j), j.concern].filter(Boolean).join(' · ') || 'No details'}</span>
                        <span className="ledger-sub flex items-center gap-1.5"><span className={`lamp lamp-${lampOf(j.status)}`} aria-hidden="true" />{statusLabel(j.status)}{j.created_at ? ` · ${fmtDate(String(j.created_at).slice(0, 10))}` : ''}</span>
                      </span>
                      <span className="shrink-0 font-bold text-blue">{adding === j.id ? 'Adding…' : 'Add as claim'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!q.trim() && jobs.length > 50 && <p className="mt-2 text-[0.875rem] text-text-secondary">Showing the 50 newest. Search to find an older one.</p>}
            <p className="mt-4 text-[0.9375rem] text-text-secondary">Not written up yet? <Link href="/jobs?new=1" className="inline-flex min-h-[44px] items-center font-bold text-blue underline underline-offset-2">Write up a repair order</Link></p>
          </>
        )}
    </Sheet>
  )
}
