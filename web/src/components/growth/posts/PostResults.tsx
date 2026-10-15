'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { agoWords } from '@/components/automations/model'
import { POSTED_STATES, PLATFORM_LABEL, monthKey } from '@/lib/posts-rules'
import type { PostPlatform } from '@/lib/posts-rules'
import type { JobSummary, PostOverview } from '@/lib/posts-api-types'
import { readJobs } from './postsApi'

interface Props {
  overview: PostOverview
  /** Asks the apps for fresh numbers. Resolves to the sentence to show. */
  onRefresh: () => Promise<string>
}

const heardCounts = (jobs: JobSummary[]): Array<{ name: string; count: number }> => {
  const seen = new Map<string, { name: string; count: number }>()
  for (const j of jobs) {
    const name = j.heard_from.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const row = seen.get(key)
    if (row) row.count += 1
    else seen.set(key, { name, count: 1 })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6)
}

/**
 * What the posts did. The number of posts comes from Alpha's own log. Likes and comments appear only when Facebook or Instagram
 * reported them for a post that Alpha made; nothing is estimated, and anything not recorded is said plainly.
 */
export default function PostResults({ overview, onRefresh }: Props) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [said, setSaid] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void readJobs().then(r => { if (alive.current && r.ok) setJobs(r.data.jobs) })
    return () => { alive.current = false }
  }, [])

  const month = monthKey(Date.now())
  const thisMonth = overview.items.filter(i => POSTED_STATES.includes(i.state) && i.posted_at && monthKey(Date.parse(i.posted_at)) === month)
  const perPlace: Partial<Record<PostPlatform, { likes: number; comments: number; posts: number; latest: string }>> = {}
  for (const item of thisMonth) {
    for (const p of ['facebook', 'instagram'] as const) {
      const m = item.metrics[p]
      if (!m || (m.likes === null && m.comments === null)) continue
      const row = perPlace[p] ?? { likes: 0, comments: 0, posts: 0, latest: m.checked_at }
      row.likes += m.likes ?? 0
      row.comments += m.comments ?? 0
      row.posts += 1
      if (Date.parse(m.checked_at) > Date.parse(row.latest)) row.latest = m.checked_at
      perPlace[p] = row
    }
  }
  const reported = (Object.keys(perPlace) as PostPlatform[])
  const couldCheck = overview.items.some(i => i.results.some(r => r.status === 'posted' && r.id && (r.platform === 'facebook' || r.platform === 'instagram')))
  const heard = jobs ? heardCounts(jobs) : []

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true); setSaid('')
    try { setSaid(await onRefresh()) } finally { if (alive.current) setRefreshing(false) }
  }

  return (
    <section aria-label="Results" className="mt-6">
      <h3 className="section-title mb-1.5">Results</h3>
      <div className="card space-y-3 text-[0.9375rem]">
        <p><span className="display num text-[1.5rem] font-bold">{overview.posts_this_month}</span> {overview.posts_this_month === 1 ? 'post' : 'posts'} went out this month.</p>

        {reported.length > 0 ? (
          <ul className="space-y-1">
            {reported.map(p => {
              const row = perPlace[p]
              if (!row) return null
              return (
                <li key={p}>
                  {PLATFORM_LABEL[p]} reported <span className="num font-bold">{row.likes}</span> {row.likes === 1 ? 'like' : 'likes'} and <span className="num font-bold">{row.comments}</span> {row.comments === 1 ? 'comment' : 'comments'} on {row.posts} {row.posts === 1 ? 'post' : 'posts'}, last checked {agoWords(row.latest)}.
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-text-secondary">No likes, comments or views are recorded for these posts. Alpha shows only what Facebook or Instagram reports back; it never estimates. Google does not report numbers for these posts.</p>
        )}

        {couldCheck && (
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}><Icon name="refresh" className="h-5 w-5" />{refreshing ? 'Asking the apps…' : 'Ask the apps for numbers'}</button>
            {said && <p className="form-hint" role="status">{said}</p>}
          </div>
        )}

        <div>
          <p className="font-bold">How customers heard about you</p>
          {heard.length > 0 ? (
            <ul className="mt-1 space-y-0.5">{heard.map(h => <li key={h.name}>{h.name}: <span className="num font-bold">{h.count}</span> {h.count === 1 ? 'job' : 'jobs'}</li>)}</ul>
          ) : (
            <p className="text-text-secondary">Nothing recorded yet. On a job, fill in How did you hear about us? and the answers add up here. It is optional.</p>
          )}
        </div>
      </div>
      {!overview.available && <Notice kind="info" className="mt-2">Results start after the repair posts database update is applied.</Notice>}
    </section>
  )
}
