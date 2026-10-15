'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import Notice from '@/components/Notice'
import { callStats, change, fmtSeconds, spanDays } from '@/lib/reports'
import type { Bucket, ReportCall } from '@/lib/reports'
import { CALL_SPLIT_NOTE, callSplit, withAiOnlyCalls } from '@/lib/report-calls'
import type { AiCall } from '@/lib/report-load'
import { BarChart, Block, DeltaLine, Kpi } from './parts'
import type { Ctx } from './types'
import { dayOfStamp } from './useReportData'
import type { Source } from './useReportData'

const hourOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? -1 : d.getHours() }
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const clock = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
const whole = (n: number) => String(Math.round(n))

const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? 'Time unknown' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

export default function CallsTab({ ctx, calls, ai }: { ctx: Ctx; calls: ReportCall[]; ai: Source<AiCall> }) {
  const { range, previous, vs } = ctx
  const aiRows = useMemo(() => (ai.error ? [] : ai.rows), [ai.error, ai.rows])
  // Calls only the AI assistant's log knows about are counted as incoming too, the same way the emailed summary counts them.
  const merged = useMemo(() => withAiOnlyCalls(calls, aiRows), [calls, aiRows])
  const now = useMemo(() => callStats(merged, range, dayOfStamp, hourOf), [merged, range])
  const before = useMemo(() => (previous ? callStats(merged, previous, dayOfStamp, hourOf) : null), [merged, previous])
  const split = useMemo(() => callSplit(calls, aiRows, range), [calls, aiRows, range])
  const splitBefore = useMemo(() => (previous ? callSplit(calls, aiRows, previous) : null), [calls, aiRows, previous])
  const missed = useMemo(() => {
    const ids = new Set(split.missedIds)
    return calls.filter(c => ids.has(c.id)).sort((a, b) => b.start.localeCompare(a.start))
  }, [calls, split.missedIds])
  const days = spanDays(range)

  const weekdays: Bucket[] = useMemo(() => DAYS.map((d, i) => ({ key: d, label: d.slice(0, 3), title: `${d}s`, value: now.weekdays[i] })), [now])
  const hours: Bucket[] = useMemo(() => now.hours.map((v, h) => ({ key: String(h), label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`, title: `${clock(h)} to ${clock((h + 1) % 24)}`, value: v })), [now])
  const busyDay = now.weekdays.indexOf(Math.max(...now.weekdays))
  const busyHour = now.hours.indexOf(Math.max(...now.hours))

  if (calls.length === 0 && aiRows.length === 0) {
    return (
      <div className="empty-state">
        <p className="font-bold text-text-primary">No calls recorded yet</p>
        <p className="mx-auto mt-1 max-w-md">Calls to your shop number show up here once they come in, with the busiest days and hours.</p>
        <Link href="/messages?tab=calls" className="btn btn-primary mt-4">Open calls</Link>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Incoming calls" value={String(now.inbound)} note="Calls to your shop number">
          <DeltaLine change={before ? change(now.inbound, before.inbound) : null} vs={vs} />
        </Kpi>
        <Kpi label="Calls you made" value={String(now.outbound)} note="Outgoing" />
        <Kpi label="Average call" value={fmtSeconds(now.averageSeconds)} note="Calls over 15 seconds" />
        <Kpi label="Hung up fast" value={String(now.short)} note="Incoming, under 15 seconds" />
      </div>
      {ai.error && <Notice kind="warn">The AI assistant&apos;s call log did not load ({ai.error}), so calls it handled may be counted as answered by people. Refresh to try again.</Notice>}
      <Block title="Who answered">
        {split.inbound === 0 ? <p className="text-text-secondary">No incoming calls in these {days} {days === 1 ? 'day' : 'days'}.</p> : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div><p className="display num text-[1.75rem] font-bold">{split.byAi}</p><p className="text-[0.9375rem] font-bold text-text-secondary">AI assistant</p><p className="text-[0.875rem] text-text-secondary">{split.aiPct}% of calls</p></div>
              <div><p className="display num text-[1.75rem] font-bold">{split.byPeople}</p><p className="text-[0.9375rem] font-bold text-text-secondary">A person</p><p className="text-[0.875rem] text-text-secondary">{split.inbound ? Math.round((split.byPeople / split.inbound) * 100) : 0}% of calls</p></div>
              <div><p className="display num text-[1.75rem] font-bold">{split.missed}</p><p className="text-[0.9375rem] font-bold text-text-secondary">Nobody</p><p className="text-[0.875rem] text-text-secondary">{split.missedPct}% of calls</p></div>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-text-primary/10" aria-hidden="true">
              <div className="bg-blue" style={{ width: `${(split.byAi / split.inbound) * 100}%` }} />
              <div className="bg-text-primary/40" style={{ width: `${(split.byPeople / split.inbound) * 100}%` }} />
              <div className="bg-amber" style={{ width: `${(split.missed / split.inbound) * 100}%` }} />
            </div>
            {splitBefore && splitBefore.inbound > 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">{vs ? `Compared with ${vs}: ` : ''}the AI assistant handled {splitBefore.byAi} of {splitBefore.inbound} calls ({splitBefore.aiPct}%) and {splitBefore.missed} went unanswered.</p>}
            <p className="mt-2 text-[0.875rem] text-text-secondary">{CALL_SPLIT_NOTE}</p>
            <p className="mt-1 text-[0.875rem] text-text-secondary">Nobody means the call was marked missed, or ended in under 15 seconds.</p>
            {missed.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="font-bold text-text-primary">Calls nobody answered{missed.length > 8 ? ' (latest 8)' : ''}</p>
                <ul className="mt-1 divide-y divide-border">
                  {missed.slice(0, 8).map(c => <li key={c.id} className="flex justify-between gap-3 py-2 text-[0.9375rem]"><span>{when(c.start)}</span><span className="num text-text-secondary">{c.seconds ? `${c.seconds} seconds` : 'Not answered'}</span></li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Block>
      {now.inbound === 0 ? (
        <p className="text-text-secondary">No incoming calls in these {days} {days === 1 ? 'day' : 'days'}. Pick a longer period to see more.</p>
      ) : (
        <>
          <Block title="Busiest days">
            <BarChart buckets={weekdays} format={whole} unit=" calls" what="Incoming calls by day of the week" whole highlight={busyDay} height={150} />
            <p className="mt-3 text-[0.9375rem] text-text-secondary">{DAYS[busyDay]}s bring the most calls, {now.weekdays[busyDay]} in this period.</p>
          </Block>
          <Block title="Busiest hours">
            <BarChart buckets={hours} format={whole} unit=" calls" what="Incoming calls by hour of the day" whole labelEvery={4} highlight={busyHour} height={150} />
            <p className="mt-3 text-[0.9375rem] text-text-secondary">{clock(busyHour)} to {clock((busyHour + 1) % 24)} is the busiest hour, {now.hours[busyHour]} calls. Have someone on the phone then.</p>
          </Block>
        </>
      )}
    </div>
  )
}
