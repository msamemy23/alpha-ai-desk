'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard, Pill, RowsSkeleton } from '@/components/ListKit'
import { kindWords, screenName, summaryWords, timesWords } from '@/lib/problems'
import type { Problem } from '@/lib/problems'
import { referenceCode } from '@/lib/client-errors'
import { Group } from './fields'
import { getAuthJsonHeaders } from './shared'

type Load = 'loading' | 'ready' | 'error' | 'forbidden' | 'needs-update'

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Screens that broke for someone in the shop in the last 7 days, in plain words. Read only: it shows what the server counted
 * (see lib/problems-store.ts) and changes nothing. The counts hold the screen's name, the kind of error, a short reference and
 * a cleaned message. They never hold a customer's name, phone number, email address or anything someone typed.
 */
export default function ProblemsSection() {
  const [load, setLoad] = useState<Load>('loading')
  const [problems, setProblems] = useState<Problem[]>([])
  const [message, setMessage] = useState('')

  const read = useCallback(async () => {
    setLoad('loading'); setMessage('')
    try {
      const res = await fetch('/api/problems', { cache: 'no-store', headers: await getAuthJsonHeaders() })
      if (res.status === 403) { setLoad('forbidden'); return }
      const body = await res.json().catch(() => ({})) as { ok?: boolean; needsUpdate?: boolean; problems?: Problem[]; error?: string }
      if (!res.ok || body.ok === false) { setMessage(body.error || 'The list did not load.'); setLoad('error'); return }
      if (body.needsUpdate) { setLoad('needs-update'); return }
      setProblems(Array.isArray(body.problems) ? body.problems : [])
      setLoad('ready')
    } catch {
      setMessage('No connection. Check your internet and try again.'); setLoad('error')
    }
  }, [])

  useEffect(() => { void read() }, [read])

  return (
    <div className="space-y-4">
      <Group
        title="Screens that stopped working"
        description="When a screen breaks while someone is signed in, Alpha Desk counts it here. It keeps the screen, the kind of error and a short reference. It never keeps a customer's name, phone number, email address or anything typed."
      >
        {load === 'loading' && <RowsSkeleton rows={3} label="Loading problems" />}

        {load === 'error' && <ErrorCard title="The list did not load" message={message} onRetry={() => void read()} />}

        {load === 'forbidden' && (
          <Notice kind="info">
            <p className="font-bold">Only the owner and admins can see this list.</p>
            <p>Ask the owner to open Settings, then Problems reported.</p>
          </Notice>
        )}

        {load === 'needs-update' && (
          <Notice kind="warn">
            <p className="font-bold">This list needs a one-time update to your Alpha Desk database.</p>
            <p>Until then nothing is counted here. Broken screens are still written to the server log.</p>
          </Notice>
        )}

        {load === 'ready' && problems.length === 0 && (
          <EmptyBlock icon="check" title="No problems reported in the last 7 days">
            If a screen breaks for anyone who is signed in, it will show up here with the screen&apos;s name and how many times it happened.
          </EmptyBlock>
        )}

        {load === 'ready' && problems.length > 0 && (
          <>
            <p className="flex items-center gap-2 text-[0.9375rem] font-bold" role="status">
              <span className="lamp lamp-amber" aria-hidden="true" />
              {summaryWords(problems)}
            </p>
            <ul className="space-y-3" aria-label="Problems reported in the last 7 days">
              {problems.map(p => {
                const ref = referenceCode(p.reference)
                return (
                  <li key={p.key} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{kindWords(p.kind)}</p>
                        <p className="text-text-secondary">On {screenName(p.path)}{p.path ? ` (${p.path})` : ''}</p>
                      </div>
                      <Pill lamp="amber">{timesWords(p.count)}</Pill>
                    </div>
                    {p.message && <p className="mt-2 break-words text-[0.9375rem]">{p.message}</p>}
                    <p className="num mt-2 text-[0.875rem] text-text-secondary">
                      {[ref ? `Reference ${ref}` : '', p.last_seen ? `Last time ${when(p.last_seen)}` : '', p.first_seen && p.first_seen !== p.last_seen ? `First time ${when(p.first_seen)}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {load === 'ready' && (
          <button type="button" className="btn btn-secondary" onClick={() => void read()}>
            <Icon name="refresh" className="h-5 w-5" />Check again
          </button>
        )}
      </Group>
    </div>
  )
}
