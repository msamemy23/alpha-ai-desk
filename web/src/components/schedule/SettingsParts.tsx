'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { DAY_KEYS, DAY_LABEL, KIND_HELP, KIND_WORD, isYmd } from '@/lib/schedule-capacity'
import type { CapacitySettings, DayKey, JobKind, ServiceType } from '@/lib/schedule-capacity'
import type { OnlineSettings } from '@/lib/booking'
import NumberField from './NumberField'

type SetCap = (fn: (c: CapacitySettings) => CapacitySettings) => void

const longDate = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/* ---------- hours and closed days ---------- */

export function HoursTab({ cap, setCap }: { cap: CapacitySettings; setCap: SetCap }) {
  const [date, setDate] = useState('')
  const [problem, setProblem] = useState('')
  const setDay = (k: DayKey, patch: Partial<CapacitySettings['hours'][DayKey]>) => setCap(c => ({ ...c, hours: { ...c.hours, [k]: { ...c.hours[k], ...patch } } }))
  const addClosed = () => {
    setProblem('')
    if (!isYmd(date)) { setProblem('Choose a date.'); return }
    if (cap.closedDates.includes(date)) { setProblem('That day is already on the list.'); return }
    setCap(c => ({ ...c, closedDates: [...c.closedDates, date].sort() }))
    setDate('')
  }
  return (
    <div>
      <p className="text-[0.9375rem] text-text-secondary">When the shop takes cars. Bookings outside these hours get a warning, and the public booking page never offers them.</p>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border" aria-label="Opening hours">
        {DAY_KEYS.map(k => {
          const h = cap.hours[k]
          return (
            <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <label className="flex min-h-[44px] w-36 items-center gap-2.5 font-bold">
                <input type="checkbox" className="h-5 w-5" checked={h.open} onChange={e => setDay(k, { open: e.target.checked })} />{DAY_LABEL[k]}
              </label>
              {h.open ? (
                <span className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`h-${k}-s`}>{DAY_LABEL[k]} opens</label>
                  <input id={`h-${k}-s`} type="time" className="form-input !w-[8.5rem]" value={h.start} onChange={e => e.target.value && setDay(k, { start: e.target.value })} />
                  <span aria-hidden="true">to</span>
                  <label className="sr-only" htmlFor={`h-${k}-e`}>{DAY_LABEL[k]} closes</label>
                  <input id={`h-${k}-e`} type="time" className="form-input !w-[8.5rem]" value={h.end} onChange={e => e.target.value && setDay(k, { end: e.target.value })} />
                </span>
              ) : <span className="text-[0.9375rem] text-text-secondary">Closed</span>}
            </li>
          )
        })}
      </ul>

      <h3 className="section-title mt-5">Days the shop is closed</h3>
      <p className="mt-0.5 text-[0.875rem] text-text-secondary">Holidays and other days off. Nothing can be booked online on these days.</p>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="form-label" htmlFor="closed-date">Add a day</label>
          <input id="closed-date" type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary shrink-0" onClick={addClosed}><Icon name="plus" className="h-5 w-5" />Add</button>
      </div>
      {problem && <p role="alert" className="form-error">{problem}</p>}
      {cap.closedDates.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Closed days">
          {cap.closedDates.map(d => (
            <li key={d} className="flex items-center gap-1 rounded-full border border-line bg-bg-card py-0.5 pl-3 pr-1 text-[0.9375rem]">
              <span className="num">{longDate(d)}</span>
              <button type="button" className="btn-icon !h-9 !w-9" aria-label={`Open ${longDate(d)} again`} onClick={() => setCap(c => ({ ...c, closedDates: c.closedDates.filter(x => x !== d) }))}><Icon name="close" className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------- how much fits ---------- */

export function CapacityTab({ cap, setCap }: { cap: CapacitySettings; setCap: SetCap }) {
  const set = <K extends keyof CapacitySettings>(k: K, v: CapacitySettings[K]) => setCap(c => ({ ...c, [k]: v }))
  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] text-text-secondary">How much work fits in a day. In the shop these only warn you, and you can still book over them. On the public booking page they decide which times are offered.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="cap-techs" label="Technicians on a normal day" help="Leave at 0 if you have not decided. Online booking needs at least 1." value={cap.techCount} min={0} max={60} onChange={n => set('techCount', n)} />
        <NumberField id="cap-bays" label="Bays and lifts" help="Cars that can be worked on at once. 0 means as many as you have technicians." value={cap.bays} min={0} max={40} onChange={n => set('bays', n)} />
        <NumberField id="cap-hours" label="Billable hours per technician" help="Hours of real work one technician gets done in a day, after breaks and waiting." value={cap.hoursPerTech} min={1} max={12} step={0.25} suffix="hours" onChange={n => set('hoursPerTech', n)} />
        <NumberField id="cap-drop" label="Most drop-offs in a day" help="Cars customers leave for the day. 0 means no limit." value={cap.maxDropoffs} min={0} max={200} onChange={n => set('maxDropoffs', n)} />
        <NumberField id="cap-wait" label="Most customers waiting at once" help="How many can sit in the waiting room. 0 means no limit." value={cap.maxWaiters} min={0} max={40} onChange={n => set('maxWaiters', n)} />
        <NumberField id="cap-arr" label="Most cars arriving together" help="Cars due in the same arrival window. 0 means no limit." value={cap.maxArrivals} min={0} max={40} onChange={n => set('maxArrivals', n)} />
        <div>
          <label className="form-label" htmlFor="cap-win">Arrival window</label>
          <select id="cap-win" className="form-select" value={cap.arrivalMinutes} onChange={e => set('arrivalMinutes', Number(e.target.value))}>
            <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
          </select>
        </div>
        <NumberField id="cap-grace" label="Late arrivals are flagged after" help="A booked car that has not arrived this long after its time is shown as late." value={cap.noShowGraceMinutes} min={5} max={240} step={5} suffix="min" onChange={n => set('noShowGraceMinutes', n)} />
      </div>
    </div>
  )
}

/* ---------- service types ---------- */

export function ServicesTab({ cap, setCap }: { cap: CapacitySettings; setCap: SetCap }) {
  const setService = (i: number, patch: Partial<ServiceType>) => setCap(c => ({ ...c, services: c.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const add = () => setCap(c => ({ ...c, services: [...c.services, { key: `s${Date.now().toString(36).slice(-6)}`, label: '', minutes: 60, kind: 'dropoff' as JobKind, online: true }].slice(0, 30) }))
  return (
    <div>
      <p className="text-[0.9375rem] text-text-secondary">The kinds of work you book, how long each takes, and whether the customer usually waits or leaves the car. A new booking fills in its length from this list, or from your canned job when the name matches.</p>
      <ul className="mt-3 space-y-3" aria-label="Services">
        {cap.services.map((s, i) => (
          <li key={s.key} className="rounded-md border border-border p-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="form-label" htmlFor={`sv-l-${i}`}>Name</label>
                <input id={`sv-l-${i}`} className="form-input" maxLength={60} value={s.label} onChange={e => setService(i, { label: e.target.value })} placeholder="For example: Brake service" autoComplete="off" />
              </div>
              <button type="button" className="btn-icon shrink-0" aria-label={`Remove ${s.label || 'this service'}`} onClick={() => setCap(c => ({ ...c, services: c.services.filter((_, j) => j !== i) }))}><Icon name="trash" className="h-5 w-5" /></button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <NumberField id={`sv-m-${i}`} label="Takes" value={s.minutes} min={15} max={600} step={5} suffix="min" onChange={n => setService(i, { minutes: n })} />
              <div>
                <label className="form-label" htmlFor={`sv-k-${i}`}>Usually</label>
                <select id={`sv-k-${i}`} className="form-select" value={s.kind} onChange={e => setService(i, { kind: e.target.value === 'wait' ? 'wait' : 'dropoff' })}>
                  {(['dropoff', 'wait'] as const).map(k => <option key={k} value={k}>{KIND_WORD[k]}</option>)}
                </select>
              </div>
            </div>
            <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-[0.9375rem]"><input type="checkbox" className="h-5 w-5" checked={s.online} onChange={e => setService(i, { online: e.target.checked })} />Offer on the public booking page</label>
            <p className="text-[0.8125rem] text-text-secondary">{KIND_HELP[s.kind]}.</p>
          </li>
        ))}
      </ul>
      {cap.services.length < 30 && <button type="button" className="btn btn-secondary mt-3" onClick={add}><Icon name="plus" className="h-5 w-5" />Add a service</button>}
    </div>
  )
}

/* ---------- public booking page ---------- */

export function OnlineTab({ cap, online, setOnline, origin, canTurnOn }: {
  cap: CapacitySettings
  online: OnlineSettings
  setOnline: (fn: (o: OnlineSettings) => OnlineSettings) => void
  origin: string
  canTurnOn: boolean
}) {
  const [copied, setCopied] = useState(false)
  const set = <K extends keyof OnlineSettings>(k: K, v: OnlineSettings[K]) => setOnline(o => ({ ...o, [k]: v }))
  const hasTechs = cap.techCount >= 1
  const hasService = cap.services.some(s => s.online && s.label.trim())
  const hasOpen = DAY_KEYS.some(k => cap.hours[k].open)
  const ready = hasTechs && hasService && hasOpen
  const url = online.slug ? `${origin}/book/${online.slug}` : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* the address is on screen to copy by hand */ }
  }
  const check = (ok: boolean, text: string) => (
    <li className="flex items-start gap-2 text-[0.9375rem]"><span className={`lamp mt-1.5 shrink-0 ${ok ? 'lamp-green' : 'lamp-amber'} !h-2.5 !w-2.5`} aria-hidden="true" /><span><span className="font-bold">{ok ? 'Done: ' : 'Needed: '}</span>{text}</span></li>
  )
  return (
    <div className="space-y-4">
      <p className="text-[0.9375rem] text-text-secondary">A page your customers open without signing in, to ask for a time. It shows only your hours and the services you pick. Nobody sees who else is booked.</p>
      {!canTurnOn && <Notice kind="warn">Schedule settings need a database update before online booking can be turned on. Your changes cannot be saved until then.</Notice>}
      <ul className="space-y-1.5" aria-label="Before you turn it on">
        {check(hasTechs, 'Say how many technicians work on a normal day (Capacity tab).')}
        {check(hasService, 'Offer at least one service on the booking page (Services tab).')}
        {check(hasOpen, 'Open at least one day (Hours tab).')}
      </ul>
      <label className="flex min-h-[48px] items-center gap-3 rounded-md border border-border px-3 font-bold">
        <input type="checkbox" className="h-5 w-5" checked={online.enabled} disabled={!canTurnOn || (!online.enabled && !ready)} onChange={e => set('enabled', e.target.checked)} />
        Take bookings on the public page
      </label>
      <label className="flex min-h-[48px] items-start gap-3 rounded-md border border-border px-3 py-2.5">
        <input type="checkbox" className="mt-0.5 h-5 w-5" checked={online.quotes} disabled={!canTurnOn || !online.enabled} onChange={e => set('quotes', e.target.checked)} />
        <span><span className="block font-bold">Let visitors ask for a price</span><span className="block text-[0.875rem] font-normal text-text-secondary">Adds an &ldquo;Ask for a price&rdquo; link to the page, for people who are not ready to pick a time. Their request shows up on Get more customers, Leads. Nothing is texted or emailed to them by itself.{!online.enabled ? ' Turn on booking first.' : ''}</span></span>
      </label>
      {url && online.enabled && (
        <div className="rounded-md border border-border bg-bg-base px-3 py-2.5">
          <p className="text-[0.8125rem] text-text-secondary">Your booking page</p>
          <p className="break-all font-bold">{url}</p>
          {online.quotes && <p className="mt-1 break-all text-[0.875rem]"><span className="text-text-secondary">Ask for a price: </span><span className="font-bold">{url}/quote</span></p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}><Icon name="copy" className="h-4 w-4" />{copied ? 'Copied' : 'Copy the link'}</button>
            <a className="btn btn-secondary btn-sm no-underline" href={url} target="_blank" rel="noopener noreferrer"><Icon name="openExternal" className="h-4 w-4" />Open it</a>
          </div>
          <p className="mt-2 text-[0.8125rem] text-text-secondary">Put this link on your website, your Google Business Profile and your texts. Nothing is texted to the customer by itself; you answer requests from the Schedule.</p>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="section-title">When someone books</legend>
        {([
          ['review', 'I confirm each request first', 'It shows in Requests. Nothing is on your calendar until you accept.'],
          ['auto', 'Put it on the calendar right away', 'Only times that fit are offered. Numbers that missed earlier bookings still wait for you.'],
        ] as const).map(([v, label, help]) => (
          <label key={v} className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${online.approval === v ? 'border-blue bg-blue/10' : 'border-line bg-bg-card'}`}>
            <input type="radio" name="approval" className="mt-1 h-5 w-5" checked={online.approval === v} onChange={() => set('approval', v)} />
            <span><span className="block font-bold">{label}</span><span className="block text-[0.875rem] text-text-secondary">{help}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="on-lead" label="Earliest booking" help="Hours from now. Stops someone booking the next ten minutes." value={online.leadHours} min={0} max={72} suffix="hours" onChange={n => set('leadHours', n)} />
        <NumberField id="on-days" label="How far ahead" help="Days ahead a customer may book." value={online.daysAhead} min={1} max={90} suffix="days" onChange={n => set('daysAhead', n)} />
        <div>
          <label className="form-label" htmlFor="on-step">Gap between times</label>
          <select id="on-step" className="form-select" value={online.stepMinutes} onChange={e => set('stepMinutes', Number(e.target.value) === 15 ? 15 : Number(e.target.value) === 60 ? 60 : 30)}>
            <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
          </select>
        </div>
        <NumberField id="on-hold" label="Hold a phone number after missed bookings" help="After this many no-shows in a year, requests from that number always wait for you. 0 turns it off." value={online.holdAfterNoShows} min={0} max={5} onChange={n => set('holdAfterNoShows', n)} />
      </div>
      <div>
        <label className="form-label" htmlFor="on-intro">A line at the top of the page (optional)</label>
        <input id="on-intro" className="form-input" maxLength={240} value={online.intro} onChange={e => set('intro', e.target.value)} placeholder="For example: Family owned since 1998. Free shuttle within 5 miles." autoComplete="off" />
      </div>
      <div>
        <label className="form-label" htmlFor="on-notice">What the customer is told after they send</label>
        <input id="on-notice" className="form-input" maxLength={240} value={online.notice} onChange={e => set('notice', e.target.value)} autoComplete="off" />
      </div>
    </div>
  )
}

/* ---------- calendar feed ---------- */

export function FeedTab({ icalOn, token, origin, canChange, busy, onChange }: {
  icalOn: boolean
  token: string | null
  origin: string
  canChange: boolean
  busy: boolean
  onChange: (a: 'on' | 'off' | 'reset') => void
}) {
  const [copied, setCopied] = useState(false)
  const url = token ? `${origin}/api/book/ical?token=${encodeURIComponent(token)}` : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* shown on screen */ }
  }
  return (
    <div className="space-y-3">
      <p className="text-[0.9375rem] text-text-secondary">See your schedule inside Google Calendar, Apple Calendar or Outlook, on your own phone. It updates by itself, and it is read only. Customer phone numbers are never in it.</p>
      {!icalOn ? (
        <button type="button" className="btn btn-primary" disabled={!canChange || busy} onClick={() => onChange('on')}><Icon name="calendar" className="h-5 w-5" />{busy ? 'Turning on…' : 'Turn on the calendar link'}</button>
      ) : (
        <>
          {url ? (
            <div className="rounded-md border border-border bg-bg-base px-3 py-2.5">
              <p className="text-[0.8125rem] text-text-secondary">Your calendar link</p>
              <p className="break-all text-[0.9375rem] font-bold">{url}</p>
              <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void copy()}><Icon name="copy" className="h-4 w-4" />{copied ? 'Copied' : 'Copy the link'}</button>
            </div>
          ) : <Notice kind="info">Only owners, admins and managers can see the link.</Notice>}
          <ol className="list-decimal space-y-1 pl-5 text-[0.9375rem]">
            <li>Copy the link above.</li>
            <li>In Google Calendar choose Other calendars, then From URL, and paste it. In Apple Calendar choose File, then New Calendar Subscription.</li>
            <li>Calendars check for changes every few hours, so a new booking can take a while to show up there.</li>
          </ol>
          <Notice kind="warn">Anyone who has this link can read your schedule. If it goes to the wrong person, make a new one. The old link stops working.</Notice>
          {canChange && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onChange('reset')}>Make a new link</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onChange('off')}>Turn it off</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
