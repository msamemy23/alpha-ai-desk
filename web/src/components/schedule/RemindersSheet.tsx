'use client'
import { useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { inQuietHours, QUIET_WORDS } from '@/lib/dvi-followup'
import { nowIn } from '@/lib/schedule-capacity'
import type { CapacitySettings } from '@/lib/schedule-capacity'
import { nextOpenDay, reminderCandidates, reminderText } from '@/lib/schedule-texts'
import { getShopId, supabase } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import { textProblem } from '@/components/appointments/errors'
import { dayLong, fmtTime, parseYmd } from './types'
import type { Appointment } from './types'

type Result = { id: string; ok: boolean; why: string }

/**
 * Remind the people booked for a day. The shop picks the day, sees who will get a text and who is left out (and why),
 * reads the wording, and sends. Each text is sent on its own with its own key, so a dropped connection never sends one twice,
 * and "reminded" is remembered per booking so the same person is not texted again by mistake.
 */
export default function RemindersSheet({ appts, cap, timezone, shop, isStopped, onDone, onClose }: {
  appts: Appointment[]
  cap: CapacitySettings
  timezone: string | null
  shop: { name: string; phone: string }
  isStopped: (a: Appointment) => boolean
  onDone: () => void
  onClose: () => void
}) {
  const now = nowIn(timezone)
  const [date, setDate] = useState(() => nextOpenDay(cap, now.ymd))
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [stopMsg, setStopMsg] = useState('')
  const running = useRef(false)

  const { send, skipped } = useMemo(() => reminderCandidates(appts, date, isStopped), [appts, date, isStopped])
  const chosen = send.filter(a => !off.has(a.id))
  const quiet = inQuietHours(now.minutes)
  const first = chosen[0]

  const run = async () => {
    if (running.current || chosen.length === 0 || quiet) return
    running.current = true
    setBusy(true); setStopMsg('')
    const out: Result[] = []
    try {
      const shopId = await getShopId()
      for (const a of chosen) {
        const body = reminderText(a, shop, now.ymd)
        let ok = false, why = ''
        try {
          const res = await fetch('/api/send-message', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `appt-reminder-${a.id}-${a.date}-${a.time}` },
            body: JSON.stringify({ to: a.phone, body, channel: 'sms', ...(a.customer_id ? { customerId: a.customer_id } : {}) }),
          })
          const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
          ok = res.ok && d.ok !== false && !d.error
          if (!ok) why = textProblem(res.status, typeof d.error === 'string' ? d.error : '')
          if (res.status === 429 || res.status === 401 || res.status === 503) { out.push({ id: a.id, ok, why }); setStopMsg(why); break }
        } catch { why = textProblem(0, '') }
        if (ok && shopId) {
          const r = await supabase.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', a.id).eq('shop_id', shopId)
          if (r.error) why = 'Sent, but not marked as reminded. Do not send it again.'
        }
        out.push({ id: a.id, ok, why })
      }
    } finally {
      running.current = false
      setBusy(false)
      setResults(out)
      onDone()
    }
  }

  if (results) {
    const okCount = results.filter(r => r.ok).length
    return (
      <div>
        <p className="flex items-center gap-2 font-bold"><span className={`lamp ${okCount === results.length ? 'lamp-green' : 'lamp-amber'}`} aria-hidden="true" />Sent {okCount} of {chosen.length} reminders.</p>
        {stopMsg && <p role="alert" className="form-error">{stopMsg}</p>}
        <ul className="ledger mt-3" aria-label="Results">
          {results.map(r => {
            const a = appts.find(x => x.id === r.id)
            return (
              <li key={r.id}><div className="ledger-row">
                <span className="ledger-main"><span className="ledger-title block">{a?.customer_name}</span><span className="ledger-sub block !whitespace-normal">{r.ok ? `Reminded${r.why ? `. ${r.why}` : ''}` : r.why || 'Not sent.'}</span></span>
                <span className={`tag shrink-0 ${r.ok ? 'tag-green' : 'tag-amber'}`}>{r.ok ? 'Sent' : 'Not sent'}</span>
              </div></li>
            )
          })}
        </ul>
        <button type="button" className="btn btn-primary mt-4 w-full" onClick={onClose}>Done</button>
      </div>
    )
  }

  return (
    <div>
      <label className="form-label" htmlFor="rem-date">Remind people booked on</label>
      <input id="rem-date" type="date" className="form-input" value={date} onChange={e => { setDate(e.target.value); setOff(new Set()) }} />
      <p className="mt-1 text-[0.8125rem] text-text-secondary">{date ? dayLong(parseYmd(date)) : ''}</p>

      {send.length === 0 ? (
        <p className="mt-4 text-[0.9375rem] text-text-secondary">Nobody needs a reminder for this day.{skipped.length > 0 ? ' The ones left out are listed below.' : ''}</p>
      ) : (
        <>
          <h3 className="section-title mt-4">Who gets a text</h3>
          <ul className="ledger mt-1" aria-label="People who will get a reminder">
            {send.map(a => (
              <li key={a.id}>
                <label className="ledger-row cursor-pointer">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={!off.has(a.id)} onChange={e => setOff(s => { const n = new Set(s); if (e.target.checked) n.delete(a.id); else n.add(a.id); return n })} />
                  <span className="ledger-main"><span className="ledger-title block">{a.customer_name}</span><span className="ledger-sub block">{fmtTime(a.time)}{a.service ? ` · ${a.service}` : ''} · {phonePretty(a.phone)}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {first && (
            <>
              <h3 className="section-title mt-4">What {first.customer_name.split(' ')[0] || 'they'} will get</h3>
              <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base px-3 py-3 text-[0.9375rem] leading-relaxed">{reminderText(first, shop, now.ymd)}</p>
              <p className="mt-1 text-[0.8125rem] text-text-secondary">Each text uses that customer’s name, service and time.</p>
            </>
          )}
        </>
      )}

      {skipped.length > 0 && (
        <div className="mt-4">
          <h3 className="section-title">Left out</h3>
          <ul className="mt-1 space-y-1 text-[0.9375rem]">
            {skipped.map(s => <li key={s.appt.id} className="flex items-start gap-2"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" /><span><b>{s.appt.customer_name}</b>: {s.why}</span></li>)}
          </ul>
        </div>
      )}

      {quiet && <Notice kind="warn" className="mt-4">{QUIET_WORDS}</Notice>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy || chosen.length === 0 || quiet}>{busy ? 'Sending…' : `Send ${chosen.length} ${chosen.length === 1 ? 'reminder' : 'reminders'}`}</button>
      </div>
    </div>
  )
}
