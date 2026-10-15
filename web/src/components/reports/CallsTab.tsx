'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { callStats, change, fmtSeconds, spanDays, vsLabel } from '@/lib/reports'
import type { Bucket, ReportCall } from '@/lib/reports'
import { BarChart, Block, DeltaLine, Kpi } from './parts'
import type { Ctx } from './types'
import { dayOfStamp } from './useReportData'

const hourOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? -1 : d.getHours() }
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const clock = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
const whole = (n: number) => String(Math.round(n))

export default function CallsTab({ ctx, calls }: { ctx: Ctx; calls: ReportCall[] }) {
  const { range, previous, period } = ctx
  const now = useMemo(() => callStats(calls, range, dayOfStamp, hourOf), [calls, range])
  const before = useMemo(() => callStats(calls, previous, dayOfStamp, hourOf), [calls, previous])
  const days = spanDays(range)

  const weekdays: Bucket[] = useMemo(() => DAYS.map((d, i) => ({ key: d, label: d.slice(0, 3), title: `${d}s`, value: now.weekdays[i] })), [now])
  const hours: Bucket[] = useMemo(() => now.hours.map((v, h) => ({ key: String(h), label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`, title: `${clock(h)} to ${clock((h + 1) % 24)}`, value: v })), [now])
  const busyDay = now.weekdays.indexOf(Math.max(...now.weekdays))
  const busyHour = now.hours.indexOf(Math.max(...now.hours))

  if (calls.length === 0) {
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
          <DeltaLine change={change(now.inbound, before.inbound)} vs={vsLabel(period)} />
        </Kpi>
        <Kpi label="Calls you made" value={String(now.outbound)} note="Outgoing" />
        <Kpi label="Average call" value={fmtSeconds(now.averageSeconds)} note="Calls over 15 seconds" />
        <Kpi label="Hung up fast" value={String(now.short)} note="Incoming, under 15 seconds" />
      </div>
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
