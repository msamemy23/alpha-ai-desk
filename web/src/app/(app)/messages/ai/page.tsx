'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { Pill } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import AiReview from '@/components/inbox/AiReview'
import { api } from '@/components/inbox/api'
import type { BookingRow, Interaction } from '@/components/inbox/ai-types'
import { BookingsPanel, ResultsPanel, ReviewPanel, WaitingPanel } from '@/components/inbox/assistant/Panels'
import type { Load } from '@/components/inbox/assistant/Panels'
import TestSheet from '@/components/inbox/assistant/TestSheet'
import type { ResultCounts } from '@/lib/voice/results'

interface RulesInfo { rules: { calls_enabled: boolean; texts_mode: 'off' | 'draft' | 'auto'; reviewed: boolean }; shop: { name: string }; unavailable: boolean; canEdit: boolean }

const TEXT_WORDS: Record<string, string> = { auto: 'Replies on its own', draft: 'Writes drafts for you to send', off: 'Off' }

/** The assistant's desk: what it needs from you, the numbers, appointment requests, and a log to check its work. */
export default function AssistantPage() {
  const [days, setDays] = useState(7)
  const [results, setResults] = useState<Load<ResultCounts>>({ status: 'loading' })
  const [activity, setActivity] = useState<Load<Interaction[]>>({ status: 'loading' })
  const [bookings, setBookings] = useState<Load<BookingRow[]>>({ status: 'loading' })
  const [rules, setRules] = useState<RulesInfo | null>(null)
  const [open, setOpen] = useState<Interaction | null>(null)
  const [testing, setTesting] = useState(false)

  const loadResults = useCallback(async (d: number) => {
    setResults({ status: 'loading' })
    const r = await api<{ counts: ResultCounts; unavailable: boolean; failed: boolean }>(`/api/receptionist/results?days=${d}`)
    if (!r.ok || !r.data) { setResults({ status: 'error', message: r.error }); return }
    if (r.data.unavailable) setResults({ status: 'unavailable' })
    else if (r.data.failed) setResults({ status: 'error', message: 'The numbers could not be counted. Try again.' })
    else setResults({ status: 'ready', data: r.data.counts })
  }, [])
  const loadActivity = useCallback(async () => {
    const r = await api<{ items: Interaction[]; unavailable: boolean; failed: boolean }>('/api/receptionist/activity?filter=all&days=30&limit=100')
    if (!r.ok || !r.data) { setActivity({ status: 'error', message: r.error }); return }
    if (r.data.unavailable) setActivity({ status: 'unavailable' })
    else if (r.data.failed) setActivity({ status: 'error', message: 'The list could not be loaded. Try again.' })
    else setActivity({ status: 'ready', data: r.data.items || [] })
  }, [])
  const loadBookings = useCallback(async () => {
    const r = await api<{ items: BookingRow[]; unavailable: boolean; failed: boolean }>('/api/receptionist/bookings?status=open')
    if (!r.ok || !r.data) { setBookings({ status: 'error', message: r.error }); return }
    if (r.data.unavailable) setBookings({ status: 'unavailable' })
    else if (r.data.failed) setBookings({ status: 'error', message: 'Appointments could not be loaded. Try again.' })
    else setBookings({ status: 'ready', data: r.data.items || [] })
  }, [])
  const loadRules = useCallback(async () => {
    const r = await api<RulesInfo>('/api/receptionist/rules')
    if (r.ok && r.data) setRules(r.data)
  }, [])

  useEffect(() => { void loadResults(days) }, [days, loadResults])
  useEffect(() => { void loadActivity(); void loadBookings(); void loadRules() }, [loadActivity, loadBookings, loadRules])

  const all = useMemo(() => (activity.status === 'ready' ? activity.data : []), [activity])
  const pendingBookings = bookings.status === 'ready' ? bookings.data.filter(b => b.status === 'pending').length : 0
  const refreshAll = useCallback(() => { void loadResults(days); void loadActivity(); void loadBookings() }, [days, loadResults, loadActivity, loadBookings])

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <Link href="/messages" className="inline-flex min-h-[44px] items-center gap-1 font-bold text-blue no-underline hover:underline"><Icon name="chevronLeft" className="h-5 w-5" />Inbox</Link>
          <h1 className="page-title">AI assistant</h1>
          <p className="page-subtitle">What it did for your shop, and what it needs from you.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setTesting(true)}><Icon name="play" className="h-5 w-5" />Try it</button>
          <Link href="/settings#receptionist" className="btn btn-secondary no-underline"><Icon name="settings" className="h-5 w-5" />Its rules</Link>
        </div>
      </header>

      <div className="space-y-8">
        {rules && !rules.unavailable && (
          <div className="flex flex-wrap gap-2" aria-label="Current settings">
            <Pill lamp={rules.rules.calls_enabled ? 'green' : 'off'}>Calls: {rules.rules.calls_enabled ? 'Answers' : 'Off'}</Pill>
            <Pill lamp={rules.rules.texts_mode === 'auto' ? 'green' : rules.rules.texts_mode === 'draft' ? 'blue' : 'off'}>Texts: {TEXT_WORDS[rules.rules.texts_mode]}</Pill>
          </div>
        )}
        {rules && !rules.unavailable && !rules.rules.reviewed && (
          <div role="status" className="rounded-lg border border-amber/40 bg-amber/[0.08] p-4">
            <p className="font-bold">Check its rules before you rely on it</p>
            <p className="mt-1 text-[0.9375rem]">The assistant is using general starting rules. Set your hours, who it passes calls to, and what it may say, then save them once.</p>
            <Link href="/settings#receptionist" className="btn btn-primary btn-sm mt-3 no-underline">Open the rules</Link>
          </div>
        )}

        <WaitingPanel items={all} bookingsPending={pendingBookings} onOpen={setOpen} onResolved={refreshAll} />
        <ResultsPanel days={days} onDays={setDays} state={results} onRetry={() => void loadResults(days)} />
        <BookingsPanel state={bookings} shopName={rules?.shop?.name || ''} onChanged={refreshAll} onRetry={() => void loadBookings()} />
        <ReviewPanel state={activity} onOpen={setOpen} onRetry={() => void loadActivity()} />
      </div>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={open.contact_name || (open.contact_phone ? phonePretty(open.contact_phone) : 'Conversation')} wide>
          <AiReview interactionId={open.id} onChanged={refreshAll} />
          {open.channel === 'sms' && (
            <div className="mt-4"><Link href={`/messages?thread=${encodeURIComponent(open.contact_key)}`} className="btn btn-secondary no-underline">Open the text conversation</Link></div>
          )}
        </Sheet>
      )}
      <TestSheet open={testing} onClose={() => setTesting(false)} />
    </div>
  )
}
