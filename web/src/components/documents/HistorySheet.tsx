'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { describeChange, eventTitle, mergeTimeline, whenLabel } from '@/lib/doc-history'
import type { HistoryEvent } from '@/lib/doc-history'
import Icon from '@/components/Icon'
import { getHistory, getRevision } from './api'
import type { HistoryData, HistoryLinkRow } from './api'
import { ErrorMsg, WarnMsg } from './Dialogs'

const REASONS: Record<string, string> = {
  edited: 'Before an edit', customer_answer: 'Before the customer answered', supplement: 'Before a supplement', voided: 'Before it was voided', restored: 'Before it was restored',
}

const dot = (kind: string) =>
  kind === 'approved' || kind === 'signed' || kind === 'payment' ? 'lamp-green'
    : kind === 'declined' || kind === 'void' || kind === 'deleted' || kind === 'link_revoked' ? 'lamp-red'
      : kind === 'viewed' || kind === 'sent' || kind === 'link_created' ? 'lamp-blue'
        : kind === 'partial' || kind === 'supplement' || kind === 'note' ? 'lamp-amber' : 'lamp-off'

function linkWords(l: HistoryLinkRow, nowMs: number): string {
  const via = l.channel === 'sms' ? 'Texted' : l.channel === 'email' ? 'Emailed' : 'Link made'
  const to = l.channel !== 'copy' && l.sent_to ? ` to ${l.sent_to}` : ''
  const seen = l.view_count && l.last_viewed_at ? `opened ${l.view_count} ${l.view_count === 1 ? 'time' : 'times'}, last ${whenLabel(l.last_viewed_at, nowMs).toLowerCase()}` : 'not opened yet'
  const state = l.revoked_at ? 'turned off' : l.completed_at ? 'answered' : new Date(l.expires_at).getTime() < nowMs ? 'expired' : 'open'
  return `${via}${to} ${whenLabel(l.created_at, nowMs).toLowerCase()}. ${seen[0].toUpperCase()}${seen.slice(1)}. Link ${state}.`
}

/**
 * Everything that happened to one document: edits, sends, what the customer did, payments, and the earlier versions
 * kept each time the lines changed after it was sent. Reading only; the one thing it can do is put an earlier
 * version back into the editor, which still has to be saved.
 */
export default function HistorySheet({ documentId, noun, current, canPutBack, onUseVersion, onClose }: {
  documentId: string
  noun: string
  current: Record<string, unknown>
  /** False when the document is locked by a payment or closed. */
  canPutBack: boolean
  onUseVersion: (snapshot: Record<string, unknown>, label: string) => void
  onClose: () => void
}) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activity' | 'versions'>('activity')
  const [open, setOpen] = useState<string | null>(null)
  const [snap, setSnap] = useState<Record<string, { loading: boolean; error: string; snapshot?: Record<string, unknown> }>>({})
  const nowMs = Date.now()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const r = await getHistory(documentId)
    if (r.ok) setData(r.data)
    else setError(r.error)
    setLoading(false)
  }, [documentId])
  useEffect(() => { void load() }, [load])

  const timeline = useMemo(() => {
    if (!data) return []
    const events: HistoryEvent[] = data.events.map(e => ({ id: e.id, kind: e.kind, actor: e.actor, summary: e.summary, created_at: e.created_at, detail: e.detail }))
    return mergeTimeline(events, data.payments)
  }, [data])

  const openVersion = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (snap[id]?.snapshot) return
    setSnap(s => ({ ...s, [id]: { loading: true, error: '' } }))
    const r = await getRevision(documentId, id)
    setSnap(s => ({ ...s, [id]: r.ok ? { loading: false, error: '', snapshot: r.data.revision.snapshot } : { loading: false, error: r.error } }))
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading the history">
        {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-14" />)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div>
        <ErrorMsg>{error || 'The history did not load.'}</ErrorMsg>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>Try again</button>
        </div>
      </div>
    )
  }

  const links = data.links
  return (
    <div>
      {!data.available.events && <WarnMsg>The activity log needs a database update first, so only payments show here. Ask whoever manages your account to apply it.</WarnMsg>}

      {links.length > 0 && (
        <section aria-labelledby="hist-links" className="mt-3 rounded-md border border-border bg-bg-card px-3 py-2.5">
          <h3 id="hist-links" className="text-[0.9375rem] font-bold">Customer links</h3>
          <ul className="mt-1 space-y-1 text-[0.875rem] text-text-secondary">
            {links.slice(0, 4).map(l => <li key={l.id}>{linkWords(l, nowMs)}{l.channel === 'email' && l.email_opened_at ? ' They opened the email.' : ''}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-4 flex gap-2" role="tablist" aria-label="History views">
        {([['activity', 'Activity', timeline.length], ['versions', 'Earlier versions', data.revisions.length]] as const).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`hist-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`hist-panel-${id}`}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-bold ${tab === id ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card text-text-primary hover:bg-bg-hover'}`}
          >
            {label}<span className="num text-[0.8125rem] text-text-secondary">{n}</span>
          </button>
        ))}
      </div>

      {tab === 'activity' ? (
        <div role="tabpanel" id="hist-panel-activity" aria-labelledby="hist-tab-activity" className="mt-3">
          {timeline.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">Nothing has happened yet</p>
              <p className="mt-1">Sending it, changes after it is sent, what the customer does and payments all show up here.</p>
            </div>
          ) : (
            <ol className="max-h-[52dvh] overflow-y-auto overscroll-contain">
              {timeline.map(e => {
                const changes = (e.detail as { changes?: string[] } | undefined)?.changes
                return (
                  <li key={e.id} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                    <span className={`lamp ${dot(e.kind)} mt-1.5 shrink-0`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-bold">{eventTitle(e.kind)}</span>
                        <span className="text-[0.8125rem] text-text-secondary num">{whenLabel(e.created_at, nowMs)}</span>
                      </p>
                      <p className="break-words text-[0.9375rem]">{e.summary}</p>
                      {Array.isArray(changes) && changes.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.875rem] text-text-secondary">
                          {changes.slice(0, 12).map((c, i) => <li key={i} className="break-words">{c}</li>)}
                        </ul>
                      )}
                      <p className="text-[0.8125rem] text-text-secondary">{e.actor}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="hist-panel-versions" aria-labelledby="hist-tab-versions" className="mt-3">
          {!data.available.revisions ? (
            <WarnMsg>Earlier versions need a database update first. Ask whoever manages your account to apply it.</WarnMsg>
          ) : data.revisions.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">No earlier versions yet</p>
              <p className="mt-1">When you change the lines on a {noun} after it was sent, or the customer answers it, the version before is kept here.</p>
            </div>
          ) : (
            <ul className="max-h-[52dvh] overflow-y-auto overscroll-contain">
              {data.revisions.map(r => {
                const s = snap[r.id]
                const diff = s?.snapshot ? describeChange(s.snapshot, current) : null
                return (
                  <li key={r.id} className="border-b border-border last:border-b-0">
                    <button type="button" className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left" aria-expanded={open === r.id} onClick={() => void openVersion(r.id)}>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">Version {r.revision_no}</span>
                        <span className="block text-[0.875rem] text-text-secondary">{REASONS[r.reason] || 'Earlier version'} · {whenLabel(r.created_at, nowMs)}</span>
                      </span>
                      <span className="num font-bold">{formatCurrency(Number(r.total) || 0)}</span>
                      <Icon name="chevronDown" className={`h-5 w-5 shrink-0 text-text-muted transition-transform ${open === r.id ? 'rotate-180' : ''}`} />
                    </button>
                    {open === r.id && (
                      <div className="pb-3 pl-1">
                        {s?.loading && <div className="skeleton h-16" aria-busy="true" aria-label="Loading this version" />}
                        {s?.error && <ErrorMsg>{s.error}</ErrorMsg>}
                        {diff && (
                          <>
                            <p className="text-[0.9375rem] font-bold">{diff.changed ? 'What is different now' : 'Same as now'}</p>
                            {diff.changed && (
                              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.875rem] text-text-secondary">
                                {diff.changes.slice(0, 14).map((c, i) => <li key={i} className="break-words">{c}</li>)}
                              </ul>
                            )}
                            {diff.changed && (
                              <div className="mt-3">
                                {canPutBack ? (
                                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => s?.snapshot && onUseVersion(s.snapshot, `Version ${r.revision_no}`)}>
                                    <Icon name="undo" className="h-4 w-4" />
                                    Put this version back in the editor
                                  </button>
                                ) : (
                                  <p className="text-[0.875rem] text-text-secondary">This {noun} is locked, so an earlier version cannot be put back.</p>
                                )}
                                {canPutBack && <p className="mt-1 text-[0.8125rem] text-text-secondary">Nothing is saved until you press Save changes. Payments and the number are never touched.</p>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
