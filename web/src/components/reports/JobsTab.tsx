'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import { jobStats, spanDays } from '@/lib/reports'
import type { ReportJob } from '@/lib/reports'
import { Block, Kpi, Rank } from './parts'
import type { Ctx } from './types'

export default function JobsTab({ ctx, jobs }: { ctx: Ctx; jobs: ReportJob[] }) {
  const { range } = ctx
  const stats = useMemo(() => jobStats(jobs, range), [jobs, range])
  const days = spanDays(range)

  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <p className="font-bold text-text-primary">No jobs yet</p>
        <p className="mx-auto mt-1 max-w-md">Jobs you add on the Jobs screen show up here, with how many are open, waiting or finished.</p>
        <Link href="/jobs" className="btn btn-primary mt-4">Open jobs</Link>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Open now" value={String(stats.openNow)} note="Jobs not yet paid or closed. All time." />
        <Kpi label="Opened" value={String(stats.opened)} note={`In these ${days} ${days === 1 ? 'day' : 'days'}`} />
        <Kpi label="Finished" value={String(stats.finished)} note="Of the jobs opened in this period" />
      </div>
      <Block title="Open jobs by status" right={<Link href="/jobs" className="btn btn-secondary btn-sm">Open jobs</Link>}>
        <Rank
          empty="No open jobs. Everything is paid or closed."
          rows={stats.byStatus.map(s => ({ key: s.status, label: s.status, value: s.count, shown: String(s.count) }))}
        />
      </Block>
    </div>
  )
}
