'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import UndoBar from '@/components/ai/UndoBar'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField } from '@/components/ListKit'
import { apiJson, authHeaders } from '@/lib/ai/client-api'
import { filterEntries, kindLabel, SOURCE_LABELS, type ActivityEntry, type ActivityFilters, type Source } from '@/lib/ai/audit-view'

type Load = 'loading' | 'ready' | 'error' | 'forbidden'
type Show = 'all' | 'changes' | 'messages' | 'lookups' | 'problems' | 'undone'
type Summary = { changes: number; messages: number; lookups: number; problems: number; undone: number; total: number }

const PERIODS: { key: string; label: string; days: number }[] = [
  { key: '1', label: 'Today', days: 1 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
]

const SHOW_FILTERS: Record<Show, Partial<ActivityFilters>> = {
  all: {},
  changes: { kind: 'changes' },
  messages: { kind: 'send' },
  lookups: { kind: 'read' },
  problems: { outcome: 'problems' },
  undone: { undo: 'undone' },
}

const LAMP: Record<ActivityEntry['outcome'], string> = { done: 'lamp-green', failed: 'lamp-red', uncertain: 'lamp-amber', declined: 'lamp-off', stopped: 'lamp-off' }
const WORD_TONE: Record<ActivityEntry['outcome'], string> = { done: 'text-green', failed: 'text-red', uncertain: 'text-amber', declined: 'text-text-secondary', stopped: 'text-text-secondary' }

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function dayHeading(iso: string): string {
  const day = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (day.toDateString() === today.toDateString()) return 'Today'
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function undoWord(entry: ActivityEntry): { text: string; tone: string } | null {
  if (entry.undo.state === 'undone') return { text: 'Undone', tone: 'tag-gray' }
  if (entry.undo.state === 'available') return { text: 'Can be undone', tone: 'tag-green' }
  if (entry.undo.state === 'cannot') return { text: 'Cannot be undone', tone: 'tag-red' }
  return null
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: number; tone?: string; onClick?: () => void; active?: boolean }) {
  const content = <>
    <span className={`num display block text-[1.5rem] font-bold leading-tight ${tone || ''}`}>{value.toLocaleString('en-US')}</span>
    <span className="block text-[0.8125rem] font-bold text-text-secondary">{label}</span>
  </>
  const base = `rounded-lg border bg-bg-card px-3 py-2.5 text-left ${active ? 'border-blue' : 'border-border'}`
  return onClick
    ? <button type="button" className={`${base} min-h-[44px]`} onClick={onClick} aria-pressed={active}>{content}</button>
    : <div className={base}>{content}</div>
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-[0.8125rem] font-bold text-text-secondary">{label}</dt><dd className="break-words">{children}</dd></div>
}

export default function ActivityPage() {
  const [load, setLoad] = useState<Load>('loading')
  const [error, setError] = useState('')
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [period, setPeriod] = useState('7')
  const [show, setShow] = useState<Show>('all')
  const [source, setSource] = useState<Source | 'all'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<ActivityEntry | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [reloading, setReloading] = useState(false)
  const request = useRef(0)

  const fetchEntries = useCallback(async (days: string, quiet = false) => {
    const mine = ++request.current
    if (quiet) setReloading(true)
    else setLoad('loading')
    const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString()
    const result = await apiJson<{ entries?: ActivityEntry[]; canUndo?: boolean; warnings?: string[]; truncated?: boolean }>(`/api/ai-activity?from=${encodeURIComponent(from)}`)
    if (mine !== request.current) return
    setReloading(false)
    if (result.status === 403) { setLoad('forbidden'); return }
    if (!result.ok) {
      // A failed load is never shown as "nothing happened".
      setError(result.data.error || 'The activity history could not be loaded.')
      if (!quiet) setLoad('error')
      return
    }
    setEntries(result.data.entries || [])
    setCanUndo(result.data.canUndo === true)
    setWarnings(result.data.warnings || [])
    setTruncated(result.data.truncated === true)
    setError('')
    setLoad('ready')
  }, [])

  useEffect(() => { void fetchEntries(period) }, [fetchEntries, period])

  const filters: ActivityFilters = useMemo(() => ({ ...SHOW_FILTERS[show], source, q }), [show, source, q])
  const visible = useMemo(() => filterEntries(entries, filters), [entries, filters])
  const totals = useMemo<Summary>(() => {
    let changes = 0, messages = 0, lookups = 0, problems = 0, undone = 0
    for (const entry of entries) {
      if (entry.undo.state === 'undone') undone += 1
      if (entry.outcome === 'failed' || entry.outcome === 'uncertain') { problems += 1; continue }
      if (entry.outcome !== 'done') continue
      if (entry.kind === 'read' || entry.kind === 'draft') lookups += 1
      else if (entry.kind === 'send') messages += 1
      else changes += 1
    }
    return { changes, messages, lookups, problems, undone, total: entries.length }
  }, [entries])

  const groups = useMemo(() => {
    const out: { label: string; items: ActivityEntry[] }[] = []
    for (const entry of visible) {
      const label = dayHeading(entry.at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(entry)
      else out.push({ label, items: [entry] })
    }
    return out
  }, [visible])

  const clearFilters = () => { setShow('all'); setSource('all'); setQ('') }

  const exportCsv = async () => {
    setExporting(true)
    setExportError('')
    try {
      const from = new Date(Date.now() - Number(period) * 86_400_000).toISOString()
      const params = new URLSearchParams({ format: 'csv', from })
      const f = SHOW_FILTERS[show]
      if (f.kind) params.set('kind', f.kind)
      if (f.outcome) params.set('outcome', f.outcome)
      if (f.undo) params.set('undo', f.undo)
      if (source !== 'all') params.set('source', source)
      if (q.trim()) params.set('q', q.trim())
      const response = await fetch(`/api/ai-activity?${params.toString()}`, { headers: await authHeaders(), cache: 'no-store' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || 'The export could not be made.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `assistant-activity-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      setExportError(e instanceof Error && e.message ? e.message : 'The export could not be made. Check your connection and try again.')
    }
    setExporting(false)
  }

  const chips = [
    { key: 'all' as Show, label: 'Everything', count: totals.total },
    { key: 'changes' as Show, label: 'Changes', count: totals.changes },
    { key: 'messages' as Show, label: 'Messages', count: totals.messages },
    { key: 'lookups' as Show, label: 'Look-ups', count: totals.lookups },
    { key: 'problems' as Show, label: 'Problems', count: totals.problems },
    { key: 'undone' as Show, label: 'Undone', count: totals.undone },
  ]

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="page-subtitle">Everything the assistant and your automations did: who, what, when, who approved it, and how it ended.</p>
        </div>
        {load === 'ready' && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={() => void fetchEntries(period, true)} disabled={reloading} aria-busy={reloading}>
              <Icon name="refresh" className="h-5 w-5" />{reloading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={exportCsv} disabled={exporting || !visible.length} aria-busy={exporting}>
              <Icon name="download" className="h-5 w-5" />{exporting ? 'Preparing…' : 'Export'}
            </button>
          </div>
        )}
      </header>

      {load === 'loading' && <div className="max-w-3xl"><RowsSkeleton rows={7} label="Loading activity" /></div>}

      {load === 'forbidden' && (
        <EmptyBlock icon="lock" title="Only owners and managers can see the activity history">
          Ask the shop owner to give you access, or to check it for you.
        </EmptyBlock>
      )}

      {load === 'error' && <ErrorCard title="Activity did not load" message={`${error} Nothing was changed.`} onRetry={() => void fetchEntries(period)} className="max-w-xl" />}

      {load === 'ready' && (
        <div className="max-w-3xl space-y-4">
          {error && <ErrorCard message={`The latest refresh failed: ${error} Showing what loaded before.`} onRetry={() => void fetchEntries(period, true)} busy={reloading} />}
          {warnings.map(warning => <Notice key={warning} kind="warn">{warning}</Notice>)}
          {exportError && <Notice kind="error">{exportError}</Notice>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Summary for this period">
            <Stat label="Changes" value={totals.changes} onClick={() => setShow(show === 'changes' ? 'all' : 'changes')} active={show === 'changes'} />
            <Stat label="Messages" value={totals.messages} onClick={() => setShow(show === 'messages' ? 'all' : 'messages')} active={show === 'messages'} />
            <Stat label="Look-ups" value={totals.lookups} onClick={() => setShow(show === 'lookups' ? 'all' : 'lookups')} active={show === 'lookups'} />
            <Stat label="Problems" value={totals.problems} tone={totals.problems ? 'text-red' : ''} onClick={() => setShow(show === 'problems' ? 'all' : 'problems')} active={show === 'problems'} />
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchField className="flex-1" value={q} onChange={setQ} label="Search activity" placeholder="Search by name, action or person" />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <div>
                  <label htmlFor="activity-period" className="sr-only">Time period</label>
                  <select id="activity-period" className="form-select" value={period} onChange={e => setPeriod(e.target.value)}>
                    {PERIODS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="activity-source" className="sr-only">Where it came from</label>
                  <select id="activity-source" className="form-select" value={source} onChange={e => setSource(e.target.value as Source | 'all')}>
                    <option value="all">Every source</option>
                    {(Object.keys(SOURCE_LABELS) as Source[]).map(key => <option key={key} value={key}>{SOURCE_LABELS[key]}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <FilterChips label="Show" options={chips} value={show} onChange={setShow} scroll />
          </div>

          {truncated && <Notice kind="info">Showing the newest entries only. Choose a shorter period, or export for the full list.</Notice>}

          {entries.length === 0 && (
            <EmptyBlock icon="list" title="No activity in this period">
              When the assistant looks something up, changes a record, or sends a message, it is listed here with who approved it. Try a longer period if you expected to see something.
            </EmptyBlock>
          )}

          {entries.length > 0 && visible.length === 0 && (
            <EmptyBlock icon="search" title="Nothing matches those filters" action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}>
              {entries.length.toLocaleString('en-US')} {entries.length === 1 ? 'entry is' : 'entries are'} hidden by your search or filters.
            </EmptyBlock>
          )}

          {groups.map(group => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-1 text-[0.8125rem] font-bold text-text-secondary">{group.label}</h2>
              <ul className="ledger" data-testid="activity-list">
                {group.items.map(entry => {
                  const undoTag = undoWord(entry)
                  return (
                    <li key={entry.id}>
                      <button type="button" className="ledger-row w-full text-left" onClick={() => setOpen(entry)} aria-label={`${entry.title}. ${entry.outcomeLabel}. ${timeOf(entry.at)}`}>
                        <span className={`lamp ${LAMP[entry.outcome]} mt-1.5 self-start`} aria-hidden="true" />
                        <span className="ledger-main">
                          <span className="ledger-title block !whitespace-normal">{entry.title}</span>
                          {entry.detail && <span className="ledger-sub block !whitespace-normal">{entry.detail}</span>}
                          <span className="ledger-sub block !whitespace-normal">{entry.who} · {entry.sourceLabel} · <span className="num">{timeOf(entry.at)}</span></span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`block text-[0.875rem] font-bold ${WORD_TONE[entry.outcome]}`}>{entry.outcomeLabel}</span>
                          {undoTag && <span className={`tag ${undoTag.tone} mt-1`}>{undoTag.text}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          <p className="text-[0.875rem] text-text-secondary">Want to change what the assistant is allowed to do? <Link href="/settings#assistant" className="font-bold text-blue underline underline-offset-4">Open the assistant rules</Link>.</p>
        </div>
      )}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.title || 'Activity'}>
        {open && (
          <div className="space-y-5">
            <p className="flex items-center gap-2 font-bold"><span className={`lamp ${LAMP[open.outcome]}`} aria-hidden="true" /><span className={WORD_TONE[open.outcome]}>{open.outcomeLabel}</span></p>
            {open.detail && <p className="text-[1.0625rem] leading-snug">{open.detail}</p>}
            {open.error && <p role="alert" className="rounded-md bg-red/[0.12] px-3 py-2 text-[0.9375rem]"><span className="font-bold">What went wrong: </span>{open.error}</p>}
            <dl className="space-y-3 text-[0.9375rem]">
              <Detail label="When">{fullTime(open.at)}</Detail>
              <Detail label="Who">{open.who}</Detail>
              <Detail label="Came from">{open.sourceLabel}</Detail>
              <Detail label="Type">{kindLabel(open.kind)}</Detail>
              <Detail label="Approval">{open.approvedLabel}</Detail>
              {open.target && <Detail label="Record">{open.target}</Detail>}
              {open.undo.state === 'undone' && <Detail label="Undone">{fullTime(open.undo.undoneAt)} by {open.undo.undoneBy}</Detail>}
            </dl>
            {open.undo.state === 'available' && !open.id.startsWith('op:') && (
              canUndo
                ? <UndoBar entryId={open.id} label={open.title} onChange={state => { if (state === 'undone') void fetchEntries(period, true) }} />
                : <p className="text-[0.9375rem] text-text-secondary">This can be undone by an owner or manager.</p>
            )}
            {open.undo.state === 'cannot' && <p className="flex items-start gap-2 text-[0.9375rem]"><Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" /><span><span className="font-bold text-red">Cannot be undone. </span>{open.undo.reason}</span></p>}
            {open.undo.state === 'unavailable' && <p className="flex items-start gap-2 text-[0.9375rem] text-text-secondary"><Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />{open.undo.reason}</p>}
            {open.outcome === 'uncertain' && <p className="text-[0.9375rem] text-text-secondary">The assistant could not confirm this finished. Check the record before you ask again. Asking again checks the same operation, so it is not done twice.</p>}
          </div>
        )}
      </Sheet>
    </div>
  )
}
