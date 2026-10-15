'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { SearchField } from '@/components/ListKit'
import Sheet from '@/components/Sheet'
import { fmtMoney } from '@/lib/dvi'
import { cannedPrice, searchCanned, suggestCanned } from '@/lib/dvi-canned'
import type { CannedLike } from '@/lib/dvi-canned'

/**
 * Price a finding from the shop's own canned jobs. The best matches for this line sit under the price box as one-tap
 * buttons; "Find a canned job" opens the whole list with a search. The price is the canned job's price, never a guess.
 */
export default function CannedPicker({ itemName, jobs, loaded, current, onPick }: {
  itemName: string
  jobs: CannedLike[]
  loaded: boolean
  current: { id: string; name: string } | undefined
  onPick: (job: CannedLike, price: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const top = useMemo(() => suggestCanned(itemName, jobs, 2), [itemName, jobs])
  const all = useMemo(() => searchCanned(q, jobs, 40), [q, jobs])
  if (!loaded) return null

  if (jobs.length === 0) {
    return <p className="mt-1.5 text-[0.8125rem] text-text-secondary">No canned jobs yet. <Link href="/canned-jobs" className="font-bold text-blue underline underline-offset-4">Add some</Link> and findings can be priced in one tap.</p>
  }

  return (
    <div className="mt-1.5">
      {current && <p className="mb-1 text-[0.8125rem] text-text-secondary">Priced from <b className="text-text-primary">{current.name}</b>.</p>}
      <div className="flex flex-wrap gap-1.5">
        {top.filter(m => m.job.id !== current?.id).map(m => (
          <button key={m.job.id} type="button" className="btn btn-secondary btn-sm !h-auto !min-h-[44px] max-w-full !whitespace-normal py-1 text-left" onClick={() => onPick(m.job, m.price)}>
            <Icon name="tag" className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">Use {m.job.name}: <span className="num">{fmtMoney(m.price)}</span></span>
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setOpen(true) }}><Icon name="search" className="h-4 w-4" />Find a canned job</button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Price from a canned job">
        <SearchField value={q} onChange={setQ} label="Search canned jobs" placeholder={`Try “${itemName.split(' ').slice(0, 2).join(' ')}”`} />
        {all.length === 0 ? (
          <p className="mt-3 text-[0.9375rem] text-text-secondary">{q.trim() ? `No canned job matches “${q.trim()}”.` : 'No active canned jobs.'}</p>
        ) : (
          <ul className="ledger mt-2 max-h-[50vh] overflow-y-auto" aria-label="Canned jobs">
            {all.map(m => (
              <li key={m.job.id}>
                <button type="button" className="ledger-row" onClick={() => { onPick(m.job, m.price); setOpen(false) }}>
                  <span className="ledger-main">
                    <span className="ledger-title block !whitespace-normal">{m.job.name}</span>
                    {m.job.category && <span className="ledger-sub block">{m.job.category}</span>}
                  </span>
                  <span className="ledger-amt shrink-0">{fmtMoney(cannedPrice(m.job))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  )
}
