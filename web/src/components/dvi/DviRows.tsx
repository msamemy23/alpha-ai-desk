'use client'
import Icon from '@/components/Icon'
import { STATE_WORD, summaryWords } from '@/lib/dvi'
import type { Counts, DviState } from '@/lib/dvi'
import { dayKey, fmtTimeOfDay } from '@/lib/timeclock'
import type { DviListRow } from './types'

export function listState(r: DviListRow): DviState {
  if (r.customer_approved || Object.keys(r.customer_decisions).length > 0) return 'answered'
  if (r.sent_to_customer) return 'sent'
  const rated = r.summary?.rated
  if (typeof rated === 'number' ? rated > 0 : r.overall_status !== 'pending' && r.overall_status !== '') return 'checking'
  return 'new'
}

const LAMP: Record<string, 'red' | 'amber' | 'green' | 'off'> = { red: 'red', yellow: 'amber', green: 'green' }
export const lampOf = (overall: string) => LAMP[overall] || 'off'

/** "2:14 PM" for today, "Oct 13" for any other day. */
export function whenLabel(iso: string | null, todayKey: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  if (dayKey(d) === todayKey) return fmtTimeOfDay(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function StateTag({ r, state }: { r: DviListRow; state: DviState }) {
  if (state === 'answered') {
    const v = Object.values(r.customer_decisions)
    const a = v.filter(x => x === 'approved').length, d = v.filter(x => x === 'declined').length
    return <span className="tag tag-green">{a > 0 ? `${a} approved` : `${d} declined`}{a > 0 && d > 0 ? `, ${d} declined` : ''}</span>
  }
  if (state === 'sent') return <span className="tag tag-amber">{r.viewed_at ? 'Customer looked' : 'Waiting on customer'}</span>
  if (state === 'checking') return <span className="tag tag-blue">{STATE_WORD.checking}</span>
  return <span className="tag tag-gray">{STATE_WORD.new}</span>
}

export default function DviRows({ rows, todayKey, onOpen }: { rows: DviListRow[]; todayKey: string; onOpen: (r: DviListRow) => void }) {
  return (
    <ul className="ledger" aria-label="Inspections">
      {rows.map(r => {
        const state = listState(r)
        const s = r.summary
        const c: Pick<Counts, 'red' | 'yellow' | 'green' | 'rated'> | null = s && typeof s.rated === 'number'
          ? { red: s.red ?? 0, yellow: s.yellow ?? 0, green: s.green ?? 0, rated: s.rated }
          : null
        return (
          <li key={r.id}>
            <button type="button" className="ledger-row" onClick={() => onOpen(r)} aria-label={`Open the inspection for ${r.customer_name || 'no name'}`}>
              <span className={`lamp lamp-${lampOf(r.overall_status)} shrink-0`} aria-hidden="true" />
              <span className="ledger-main">
                <span className="ledger-title block">{r.customer_name || 'No name'}</span>
                <span className="ledger-sub block !whitespace-normal">{r.vehicle || 'No vehicle noted'}{r.tech ? ` · ${r.tech}` : ''}</span>
                <span className="ledger-sub block !whitespace-normal">
                  {c ? `${summaryWords(c)}${c.green > 0 && (c.red > 0 || c.yellow > 0) ? `, ${c.green} good` : ''}${typeof s?.total === 'number' && s.total > 0 ? ` · ${c.rated} of ${s.total} checked` : ''}` : lampWords(r.overall_status)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                <StateTag r={r} state={state} />
                <span className="num text-[0.8125rem] text-text-secondary">{whenLabel(state === 'answered' ? r.customer_decided_at || r.updated_at : state === 'sent' ? r.sent_at || r.updated_at : r.updated_at || r.created_at, todayKey)}</span>
              </span>
              <Icon name="chevronRight" className="hidden h-5 w-5 shrink-0 text-text-muted sm:block" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function lampWords(overall: string): string {
  return overall === 'red' ? 'Something needs work' : overall === 'yellow' ? 'Something to watch' : overall === 'green' ? 'Everything checked is good' : 'Nothing checked yet'
}
