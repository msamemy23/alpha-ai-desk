'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import { Field } from '@/components/forms/Field'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, Pill, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { Segmented } from '@/components/ScreenParts'
import Sheet from '@/components/Sheet'
import { getJson, newKey, postJson } from '@/lib/client-api'
import { COMPARE_OPTIONS, RANGE_OPTIONS } from '@/lib/report-ranges'
import type { CompareMode, RangeKey } from '@/lib/report-ranges'
import type { SendLogEntry } from '@/lib/report-delivery'
import { MAX_RECIPIENTS, REPORT_KINDS, nextSendDay, parseRecipients } from '@/lib/saved-reports'
import type { ReportKind, SavedReport, Schedule } from '@/lib/saved-reports'
import { Block } from './parts'

interface Listing { state: 'ok' | 'needs-update' | 'error'; reports: SavedReport[]; log: SendLogEntry[]; error: string }
type Load = { status: 'loading' } | { status: 'forbidden' } | { status: 'failed'; message: string } | { status: 'ready'; list: Listing }

interface Form { id: string; name: string; kind: ReportKind; period: RangeKey; from: string; to: string; compare: CompareMode; cfrom: string; cto: string; schedule: Schedule; recipients: string; enabled: boolean }
const blank = (): Form => ({ id: '', name: '', kind: 'summary', period: 'lastweek', from: '', to: '', compare: 'previous', cfrom: '', cto: '', schedule: 'none', recipients: '', enabled: false })
const formOf = (r: SavedReport): Form => ({ id: r.id, name: r.name, kind: r.kind, period: r.range.key, from: r.range.from || '', to: r.range.to || '', compare: r.compare.mode, cfrom: r.compare.from || '', cto: r.compare.to || '', schedule: r.schedule, recipients: r.recipients.join(', '), enabled: r.enabled })
const draftOf = (f: Form) => ({
  name: f.name, kind: f.kind, schedule: f.schedule, recipients: f.recipients, enabled: f.enabled,
  range: f.period === 'custom' ? { key: f.period, from: f.from, to: f.to } : { key: f.period },
  compare: f.compare === 'custom' ? { mode: f.compare, from: f.cfrom, to: f.cto } : { mode: f.compare },
})
const when = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const periodWords = (r: SavedReport) => (r.range.key === 'custom' ? `${r.range.from} to ${r.range.to}` : RANGE_OPTIONS.find(o => o.key === r.range.key)?.label || 'Last 30 days')
const kindLabel = (k: ReportKind) => REPORT_KINDS.find(x => x.key === k)?.label || 'Report'
const scheduleWords = (r: SavedReport, today: string) => (r.schedule === 'none' ? 'Not scheduled. Sent only when you press send.' : r.enabled ? `${r.schedule === 'weekly' ? 'Every week, about the week that just ended' : 'Every month, about the month that just ended'}. Next: ${new Date(`${nextSendDay(r.schedule, today)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` : `Paused. ${r.schedule === 'weekly' ? 'Weekly' : 'Monthly'} once you turn it on.`)
const TRIGGER: Record<SendLogEntry['trigger'], string> = { schedule: 'Scheduled', manual: 'Sent by hand', test: 'Test to yourself' }
const STATUS: Record<SendLogEntry['status'], { lamp: 'green' | 'amber' | 'red'; text: string }> = {
  sent: { lamp: 'green', text: 'Sent' }, failed: { lamp: 'red', text: 'Not delivered' }, unknown: { lamp: 'amber', text: 'May not have been delivered' }, claimed: { lamp: 'amber', text: 'Sending' },
}

/**
 * Reports emailed to the people you choose. A scheduled report always goes to the addresses you typed, never to customers,
 * and you see the exact email before anything is turned on or sent.
 */
export default function EmailedTab({ today }: { today: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [flash, setFlash] = useState<Flash | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<SavedReport | null>(null)
  const [deleting, setDeleting] = useState<SavedReport | null>(null)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    const r = await getJson<Listing>('/api/reports/saved')
    if (mine !== seq.current) return
    if (r.ok) setLoad({ status: 'ready', list: r.data })
    else if (r.forbidden) setLoad({ status: 'forbidden' })
    else setLoad({ status: 'failed', message: r.message })
  }, [])
  useEffect(() => { void reload(); const stop = () => { seq.current += 1 }; return stop }, [reload])

  const patch = (p: Partial<Form>) => setForm(f => (f ? { ...f, ...p } : f))
  const save = async () => {
    if (!form) return
    setBusy(true); setError(''); setErrors({})
    const r = await postJson<{ report: SavedReport }>('/api/reports/saved', { action: 'save', id: form.id, report: draftOf(form) })
    setBusy(false)
    if (r.ok) {
      setForm(null); await reload()
      setFlash({ kind: 'success', text: form.schedule === 'none' ? `${form.name.trim()} saved.` : `${form.name.trim()} saved and paused. Preview it, then turn it on.` })
      if (!form.id && form.schedule !== 'none') setTarget(r.data.report)
    } else {
      setErrors(r.fields)
      setError(r.needsUpdate ? 'Emailed reports need a one-time update to your Alpha Desk database before they can be saved.' : r.message)
    }
  }
  const remove = async () => {
    if (!deleting) return
    setBusy(true); setError('')
    const r = await postJson('/api/reports/saved', { action: 'delete', id: deleting.id })
    setBusy(false)
    if (r.ok) { setFlash({ kind: 'success', text: `${deleting.name} deleted. Emails already sent stay in the history.` }); setDeleting(null); await reload() } else setError(r.message)
  }

  if (load.status === 'loading') return <RowsSkeleton rows={3} label="Loading emailed reports" />
  if (load.status === 'forbidden') return <Notice kind="info"><p className="font-bold">Emailed reports are for owners and managers</p><p className="mt-0.5 text-text-secondary">Ask an owner or manager to set them up.</p></Notice>
  if (load.status === 'failed') return <ErrorCard title="Emailed reports did not load" message={load.message} onRetry={reload} />
  const { list } = load
  if (list.state === 'error') return <ErrorCard title="Emailed reports did not load" message={list.error || 'Try again.'} onRetry={reload} />
  if (list.state === 'needs-update') {
    return <Notice kind="info"><p className="font-bold">Emailed reports need a database update</p><p className="mt-0.5 text-text-secondary">This is a one-time update to your Alpha Desk database. It does not change your invoices or payments. Ask whoever looks after your Alpha Desk setup to apply the accounting update, and this turns on. The rest of Reports works without it.</p></Notice>
  }

  return (
    <div className="space-y-4">
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} className="" />}
      <Notice kind="info">Emailed reports go only to the addresses you type here, never to customers. You see the exact email first, you can send yourself a test, and a pause switch stops it.</Notice>
      <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={() => { setErrors({}); setError(''); setForm(blank()) }}><Icon name="plus" className="h-5 w-5" />New emailed report</button></div>

      {list.reports.length === 0 ? (
        <EmptyBlock icon="mail" title="No emailed reports yet" action={<button type="button" className="btn btn-primary" onClick={() => setForm(blank())}>Set up your first</button>}>A Monday summary of what changed, or a monthly profit and loss for your accountant, arrives in your inbox without you opening Alpha Desk.</EmptyBlock>
      ) : (
        <ul className="space-y-3">
          {list.reports.map(r => (
            <li key={r.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-text-primary">{r.name}</p>
                  <p className="text-[0.9375rem] text-text-secondary">{kindLabel(r.kind)}. Covers {periodWords(r)}.</p>
                </div>
                <Pill lamp={r.schedule === 'none' ? 'off' : r.enabled ? 'green' : 'amber'}>{r.schedule === 'none' ? 'By hand' : r.enabled ? 'On' : 'Paused'}</Pill>
              </div>
              <p className="mt-2 text-[0.9375rem] text-text-secondary">{scheduleWords(r, today)}</p>
              <p className="mt-1 break-words text-[0.9375rem] text-text-secondary">To: {r.recipients.length ? r.recipients.join(', ') : 'nobody yet'}{r.last_sent_at ? `. Last sent ${when(r.last_sent_at)}.` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setTarget(r)}>Preview and send</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setErrors({}); setError(''); setForm(formOf(r)) }}>Change</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); setDeleting(r) }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Block title="What was sent">
        {list.error && <Notice kind="warn" className="mb-3">{list.error} Try again in a moment.</Notice>}
        {list.log.length === 0 ? <p className="text-text-secondary">Nothing has been sent yet.</p> : (
          <ul className="divide-y divide-border">
            {list.log.map(l => {
              const st = STATUS[l.status]
              return (
                <li key={l.id} className="py-3">
                  <p className="flex items-start gap-2 font-bold text-text-primary"><span className={`lamp lamp-${st.lamp} mt-[0.4rem] shrink-0`} aria-hidden="true" /><span className="min-w-0 break-words">{l.report_name}{l.period_title ? `, ${l.period_title}` : ''}</span></p>
                  <p className="ml-5 text-[0.9375rem] text-text-secondary">{st.text}. {TRIGGER[l.trigger]}, {when(l.sent_at || l.created_at)}.</p>
                  <p className="ml-5 break-words text-[0.875rem] text-text-secondary">To: {l.recipients.join(', ') || 'nobody'}</p>
                  {l.error && <p className="ml-5 break-words text-[0.875rem] text-red">{l.error}</p>}
                  {l.status === 'unknown' && <p className="ml-5 text-[0.875rem] text-text-secondary">The email service did not confirm. Check the inbox before sending it again.</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Block>

      <Sheet open={!!form} onClose={() => { if (!busy) setForm(null) }} title={form?.id ? 'Change emailed report' : 'New emailed report'} dirty>
        {form && (
          <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-3">
            <Field id="er-name" label="Name" error={errors.name} hint="Shown in the email subject."><input id="er-name" className="form-input" value={form.name} maxLength={80} placeholder="Monday summary" onChange={e => patch({ name: e.target.value })} /></Field>
            <Field id="er-kind" label="Report" error={errors.kind} hint={REPORT_KINDS.find(k => k.key === form.kind)?.help}>
              <select id="er-kind" className="form-select" value={form.kind} onChange={e => patch({ kind: e.target.value as ReportKind })}>{REPORT_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
            </Field>
            <Field id="er-schedule" label="When it is sent" hint={form.schedule === 'none' ? 'Sent only when you press send.' : 'A schedule always covers the week or month that just ended, so the same period is never sent twice.'}>
              <Segmented label="Schedule" idPrefix="er-schedule" value={form.schedule} onChange={k => patch({ schedule: k })} columns="grid-cols-3" options={[{ key: 'none', label: 'By hand' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }]} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="er-period" label={form.schedule === 'none' ? 'Dates' : 'Dates when sent by hand'} error={errors.range}>
                <select id="er-period" className="form-select" value={form.period} onChange={e => patch({ period: e.target.value as RangeKey })}>{RANGE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
              </Field>
              <Field id="er-compare" label="Compare with" error={errors.compare}>
                <select id="er-compare" className="form-select" value={form.compare} onChange={e => patch({ compare: e.target.value as CompareMode })}>{COMPARE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
              </Field>
            </div>
            {form.period === 'custom' && <div className="grid grid-cols-2 gap-3"><Field id="er-from" label="First day"><input id="er-from" type="date" className="form-input" value={form.from} onChange={e => patch({ from: e.target.value })} /></Field><Field id="er-to" label="Last day"><input id="er-to" type="date" className="form-input" value={form.to} onChange={e => patch({ to: e.target.value })} /></Field></div>}
            {form.compare === 'custom' && <div className="grid grid-cols-2 gap-3"><Field id="er-cfrom" label="Compare: first day"><input id="er-cfrom" type="date" className="form-input" value={form.cfrom} onChange={e => patch({ cfrom: e.target.value })} /></Field><Field id="er-cto" label="Compare: last day"><input id="er-cto" type="date" className="form-input" value={form.cto} onChange={e => patch({ cto: e.target.value })} /></Field></div>}
            <Field id="er-to-who" label={`Send to (up to ${MAX_RECIPIENTS} addresses)`} error={errors.recipients} hint="Separate addresses with a comma or a new line. These are the only people who get it.">
              <textarea id="er-to-who" className="form-textarea" rows={3} value={form.recipients} onChange={e => patch({ recipients: e.target.value })} placeholder="owner@yourshop.com, accountant@example.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </Field>
            <p className="text-[0.875rem] text-text-secondary">{parseRecipients(form.recipients).good.length} {parseRecipients(form.recipients).good.length === 1 ? 'address' : 'addresses'} so far.{form.schedule !== 'none' ? ' A new schedule is saved paused. You preview it and turn it on next.' : ''}</p>
            {error && <FormError>{error}</FormError>}
            <FormActions>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : form.id ? 'Save changes' : 'Save report'}</button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
            </FormActions>
          </form>
        )}
      </Sheet>

      <PreviewSheet report={target} today={today} onClose={() => setTarget(null)} onChanged={async (text) => { await reload(); if (text) setFlash({ kind: 'success', text }) }} />

      <ConfirmSheet open={!!deleting} title="Delete this emailed report?" confirmLabel="Delete report" busyLabel="Deleting" cancelLabel="Keep it" busy={busy} error={error} onConfirm={remove} onCancel={() => setDeleting(null)}>
        <p>{deleting?.name} will stop being sent. The history of what was already sent is kept.</p>
      </ConfirmSheet>
    </div>
  )
}

/** Shows exactly what would be sent and to whom, then sends a test, sends it now, or turns the schedule on. */
function PreviewSheet({ report, today, onClose, onChanged }: { report: SavedReport | null; today: string; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const [which, setWhich] = useState<'send-now' | 'next-scheduled'>('send-now')
  const [preview, setPreview] = useState<{ to: string[]; subject: string; text: string; periodTitle: string; empty: boolean } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<'send' | 'on' | null>(null)
  const [key, setKey] = useState('')
  const id = report?.id || ''
  const scheduled = !!report && report.schedule !== 'none'

  useEffect(() => { if (id) { setWhich(scheduled ? 'next-scheduled' : 'send-now'); setResult(null); setConfirm(null); setKey(newKey('send')) } }, [id, scheduled])
  useEffect(() => {
    if (!id) return
    let live = true
    setState('loading'); setPreview(null)
    void postJson<{ preview: { to: string[]; subject: string; text: string; periodTitle: string; empty: boolean } }>('/api/reports/saved', { action: 'preview', id, which }).then(r => {
      if (!live) return
      if (r.ok) { setPreview(r.data.preview); setState('ready') } else { setMessage(r.message); setState('failed') }
    })
    return () => { live = false }
  }, [id, which])

  if (!report) return <Sheet open={false} onClose={onClose} title="Preview"><span /></Sheet>

  const run = async (mode: 'test' | 'manual') => {
    setBusy(mode); setResult(null)
    const r = await postJson<{ status: string; sentTo?: string[]; earlier?: { status: string } }>('/api/reports/saved', { action: 'send', id: report.id, mode, send_key: key })
    setBusy(''); setConfirm(null)
    if (r.ok) {
      setKey(newKey('send'))
      if (r.data.status === 'duplicate') setResult({ kind: 'ok', text: 'That email was already sent a moment ago, so it was not sent again.' })
      else setResult({ kind: 'ok', text: mode === 'test' ? `Test sent to ${(r.data.sentTo || []).join(', ')}.` : `Sent to ${(r.data.sentTo || []).join(', ')}.` })
      void onChanged()
    } else {
      const partial = r.extra.partial as { sentTo?: string[] } | undefined
      setResult({ kind: 'bad', text: `${r.message}${partial?.sentTo?.length ? ` It did reach ${partial.sentTo.join(', ')}, so do not send it to them again.` : ' Nothing reached anyone, so it is safe to try again.'}` })
      setKey(newKey('send'))
      void onChanged()
    }
  }
  const toggle = async (on: boolean) => {
    setBusy('toggle'); setResult(null)
    const r = await postJson('/api/reports/saved', { action: 'enable', id: report.id, enabled: on })
    setBusy(''); setConfirm(null)
    if (r.ok) { await onChanged(on ? `${report.name} is on. The first email goes out ${new Date(`${nextSendDay(report.schedule, today)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` : `${report.name} is paused. Nothing will be sent until you turn it on.`); onClose() }
    else setResult({ kind: 'bad', text: r.message })
  }

  const to = preview?.to ?? report.recipients
  return (
    <Sheet open onClose={() => { if (!busy) onClose() }} title={report.name} wide>
      <div className="space-y-3">
        {scheduled && (
          <Segmented label="Which email" idPrefix="pv" value={which} onChange={setWhich} columns="grid-cols-2" options={[{ key: 'next-scheduled', label: 'The scheduled email' }, { key: 'send-now', label: 'If I press send now' }]} />
        )}
        {state === 'loading' && <div className="skeleton h-48" role="status" aria-label="Building the preview" />}
        {state === 'failed' && <Notice kind="error"><p className="font-bold">The preview could not be built</p><p className="mt-0.5 text-text-secondary">{message}</p></Notice>}
        {state === 'ready' && preview && (
          <>
            <dl className="rounded-md border border-border bg-bg-chrome p-3 text-[0.9375rem]">
              <div className="flex gap-2"><dt className="w-16 shrink-0 text-text-secondary">To</dt><dd className="min-w-0 break-words font-bold">{to.length ? to.join(', ') : 'Nobody yet. Add an address first.'}</dd></div>
              <div className="mt-1 flex gap-2"><dt className="w-16 shrink-0 text-text-secondary">Subject</dt><dd className="min-w-0 break-words font-bold">{preview.subject}</dd></div>
              <div className="mt-1 flex gap-2"><dt className="w-16 shrink-0 text-text-secondary">Covers</dt><dd className="min-w-0 break-words">{preview.periodTitle}</dd></div>
            </dl>
            {preview.empty && <Notice kind="warn">There are no invoices at all yet, so this email would be nearly empty.</Notice>}
            <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-card p-3 text-[0.875rem] leading-relaxed">{preview.text}</pre>
            <p className="text-[0.875rem] text-text-secondary">This is the plain-text version. The email also has the same tables laid out as a page. It is built from the same numbers as the Reports screen.</p>
          </>
        )}
        {result && <Notice kind={result.kind === 'ok' ? 'success' : 'error'}>{result.text}</Notice>}
        {confirm === 'send' && (
          <Notice kind="warn"><p className="font-bold">Send this to {to.length} {to.length === 1 ? 'person' : 'people'} now?</p><p className="mt-0.5 break-words text-text-secondary">{to.join(', ')}</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run('manual')}>{busy === 'manual' ? 'Sending' : 'Send it'}</button><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(null)}>Not now</button></div></Notice>
        )}
        {confirm === 'on' && (
          <Notice kind="warn"><p className="font-bold">Turn on {report.schedule} emails to {to.length} {to.length === 1 ? 'person' : 'people'}?</p><p className="mt-0.5 break-words text-text-secondary">{to.join(', ')}. The first one goes out {new Date(`${nextSendDay(report.schedule, today)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. It is sent once a day by a scheduled job, so it arrives that day, not at a set hour. You can pause it here at any time.</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => toggle(true)}>{busy === 'toggle' ? 'Turning on' : 'Turn on'}</button><button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(null)}>Not now</button></div></Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" disabled={!!busy || state !== 'ready'} onClick={() => run('test')}>{busy === 'test' ? 'Sending' : 'Send me a test'}</button>
          <button type="button" className="btn btn-secondary" disabled={!!busy || state !== 'ready' || to.length === 0} onClick={() => setConfirm('send')}>Send now to {to.length || 'no one'}</button>
          {scheduled && !report.enabled && <button type="button" className="btn btn-primary" disabled={!!busy || to.length === 0} onClick={() => setConfirm('on')}>Turn on {report.schedule} emails</button>}
          {scheduled && report.enabled && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => toggle(false)}>{busy === 'toggle' ? 'Pausing' : 'Pause emails'}</button>}
        </div>
        <p className="text-[0.875rem] text-text-secondary">A test goes only to the email address you are signed in with.</p>
      </div>
    </Sheet>
  )
}
