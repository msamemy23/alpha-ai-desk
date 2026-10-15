'use client'
import { phonePretty } from '@/lib/today'
import { deliveryOf, listTime } from './utils'
import type { Thread } from './utils'

/** One row per person, newest first. Unread rows get a blue lamp, bold type and the word "unread". */
export default function ConversationList({ threads, selectedKey, onSelect }: {
  threads: Thread[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const now = new Date()
  return (
    <ul className="ledger">
      {threads.map(t => {
        const unread = t.unread > 0
        const last = t.last
        const outbound = last.direction !== 'inbound'
        const delivery = deliveryOf(last)
        const selected = selectedKey === t.key
        return (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => onSelect(t.key)}
              aria-current={selected ? 'true' : undefined}
              className={`flex min-h-[4.5rem] w-full items-start gap-3 px-3 py-3 text-left hover:bg-bg-hover ${selected ? 'bg-blue/10' : ''}`}
            >
              <span className="flex h-6 w-3 shrink-0 items-center justify-center" aria-hidden="true">
                {unread && <span className="lamp lamp-blue" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`truncate text-[1.0625rem] leading-snug ${unread ? 'font-bold text-text-primary' : 'font-medium text-text-primary'}`}>
                    {unread && <span className="sr-only">{t.unread === 1 ? 'Unread. ' : `${t.unread} unread. `}</span>}
                    {t.name || phonePretty(t.contact)}
                  </span>
                  <span className={`shrink-0 text-[0.8125rem] ${unread ? 'font-bold text-text-primary' : 'text-text-secondary'}`}>{listTime(last.created_at, now)}</span>
                </span>
                <span className={`mt-0.5 line-clamp-2 break-words text-[0.9375rem] leading-snug ${unread ? 'font-bold text-text-primary' : 'text-text-secondary'}`}>
                  {delivery?.tone === 'fail' && <span className="font-bold text-red">Not delivered. </span>}
                  {outbound && delivery?.tone !== 'fail' && <span className="font-normal">You: </span>}
                  {last.body || 'No text'}
                </span>
              </span>
              {t.unread > 1 && (
                <span className="num mt-0.5 shrink-0 rounded-full bg-blue/[0.14] px-2 text-[0.8125rem] font-bold leading-5 text-blue" aria-hidden="true">{t.unread}</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
