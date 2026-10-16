'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { getJson } from '@/lib/client-api'
import { describeHistory } from '@/lib/inventory-logic'
import type { PartHistory } from '@/lib/inventory-logic'

type Loaded = { state: 'ok' | 'needs-update' | 'error'; value: PartHistory[]; error: string }

const when = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Who changed the numbers on one part, newest first: who, when, from what to what, and why. */
export default function HistorySheet({ partId, partName, onClose }: { partId: string; partName: string; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setFailure('')
    const r = await getJson<{ history: Loaded }>(`/api/inventory?history=${encodeURIComponent(partId)}`)
    setLoading(false)
    if (r.ok) setData(r.data.history)
    else setFailure(r.message)
  }, [partId])
  useEffect(() => { void load() }, [load])

  return (
    <Sheet open onClose={onClose} title={`History: ${partName}`} wide>
      {loading && !data ? (
        <RowsSkeleton rows={4} label="Loading history" />
      ) : failure ? (
        <ErrorCard title="The history did not load" message={failure} onRetry={() => void load()} busy={loading} />
      ) : data?.state === 'needs-update' ? (
        <Notice kind="info"><p className="font-bold">History needs a database update</p><p className="mt-0.5 text-text-secondary">This needs a one-time update to your Alpha Desk database. It does not change your parts counts or invoices.</p></Notice>
      ) : data?.state === 'error' ? (
        <ErrorCard title="The history did not load" message={data.error || 'Try again in a moment.'} onRetry={() => void load()} busy={loading} />
      ) : data && data.value.length === 0 ? (
        <EmptyBlock icon="clock" title="No changes recorded yet">Every change to this part&apos;s counts from now on is written here with who made it and why. Changes made before this was turned on are not in it.</EmptyBlock>
      ) : data && (
        <>
          <p className="mb-2 text-[0.9375rem] text-text-secondary">The newest {data.value.length} {data.value.length === 1 ? 'change' : 'changes'}, newest first.</p>
          <ul className="ledger" aria-label={`Changes to ${partName}`}>
            {data.value.map(h => (
              <li key={h.id}>
                <div className="flex items-start gap-3 py-3">
                  <Icon name="clock" className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{describeHistory(h)}</p>
                    <p className="num text-[0.875rem] text-text-secondary">{when(h.at)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}
