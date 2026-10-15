'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { api } from '@/components/inbox/api'
import TestSheet from '@/components/inbox/assistant/TestSheet'
import { BOOKING_MODES, DEFAULT_RULES, TEXT_MODES, TONES, normalizeRules } from '@/lib/voice/rules'
import type { VoiceRules } from '@/lib/voice/rules'
import { OPT_OUT_LINE, callGreeting, firstTextIntro, prettyPhone, telnyxAssistantInstructions } from '@/lib/voice/prompt'
import type { ShopProfile } from '@/lib/voice/prompt'
import { hoursSummary } from '@/lib/voice/hours'
import { ClosedDates, Choice, HoursGrid, ListEditor, Panel, Switch, defaultWeekHours } from './receptionist-bits'

interface Payload {
  rules: VoiceRules; saved: boolean; unavailable: boolean; failed: boolean
  shop: ShopProfile; hasAiKey: boolean; hasTelnyx: boolean; canEdit: boolean
}
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Payload }

const TOPICS: Array<{ key: keyof VoiceRules['topics']; label: string; hint: string }> = [
  { key: 'angry', label: 'An upset customer', hint: 'Raised voice, complaints, threats to leave a review.' },
  { key: 'safety', label: 'A safety problem', hint: 'Brakes gone, smoke, fire, anyone hurt. It also tells them to call 911 if someone is in danger.' },
  { key: 'towing', label: 'Towing or stranded', hint: 'Broken down on the road or needs a tow.' },
  { key: 'accident', label: 'An accident', hint: 'Collision, wreck or body damage.' },
  { key: 'insurance', label: 'Insurance', hint: 'Claims, adjusters and who pays.' },
  { key: 'legal', label: 'A legal matter or dispute', hint: 'Lawyers, police, chargebacks, complaints to the state.' },
]
const SLOT_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240, 480]
const LEAD_HOURS = [0, 1, 2, 4, 8, 12, 24, 48, 72]
const WINDOW_HOURS = [1, 6, 12, 24, 48, 72]
const TAKEOVER_HOURS = [1, 4, 12, 24, 48, 72, 168]
const hourWords = (h: number) => (h === 168 ? '1 week' : h % 24 === 0 && h >= 24 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`)
const minuteWords = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`)

/** What the form edits: the stored rules with the handoff numbers shown the way people type them. */
function toForm(r: VoiceRules): VoiceRules {
  return { ...r, handoff: r.handoff.map(h => ({ name: h.name, phone: prettyPhone(h.phone) })) }
}

export default function ReceptionistSection() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [saved, setSaved] = useState<VoiceRules>(toForm(DEFAULT_RULES))
  const [draft, setDraft] = useState<VoiceRules>(toForm(DEFAULT_RULES))
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [testing, setTesting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)

  const read = useCallback(async () => {
    setLoad({ status: 'loading' })
    const r = await api<Payload>('/api/receptionist/rules')
    if (!r.ok || !r.data) { setLoad({ status: 'error', message: r.error }); return }
    if (r.data.failed) { setLoad({ status: 'error', message: 'Your rules could not be read. Try again.' }); return }
    const form = toForm(normalizeRules(r.data.rules))
    setSaved(form); setDraft(form)
    setLoad({ status: 'ready', data: r.data })
  }, [])
  useEffect(() => { void read() }, [read])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const edit = (patch: Partial<VoiceRules>) => { setDraft(d => ({ ...d, ...patch })); if (save === 'saved') setSave('idle') }

  // Leaving the page with unsaved rules would lose them.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (load.status === 'loading') {
    return <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading the receptionist rules"><div className="skeleton h-24" /><div className="skeleton h-48" /><div className="skeleton h-64" /></div>
  }
  if (load.status === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
        <p className="font-bold text-red">The receptionist rules did not load</p>
        <p className="mt-1 text-text-secondary">{load.message || 'Check your connection and try again.'}</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => void read()}>Try again</button>
      </div>
    )
  }

  const { shop, hasAiKey, hasTelnyx, unavailable, canEdit } = load.data
  const locked = !canEdit || unavailable

  const submit = async () => {
    setSave('saving'); setSaveError('')
    const r = await api<{ rules: VoiceRules }>('/api/receptionist/rules', { method: 'PUT', body: { rules: draft } })
    if (!r.ok || !r.data) { setSave('error'); setSaveError(r.error || 'The rules could not be saved. Try again.'); return }
    const form = toForm(normalizeRules(r.data.rules))
    setSaved(form); setDraft(form); setSave('saved')
    setLoad(l => (l.status === 'ready' ? { status: 'ready', data: { ...l.data, saved: true, rules: r.data!.rules } } : l))
  }

  // The save bar rides along at the bottom of the screen only while there is something to save or say about saving.
  const pinBar = dirty || save === 'saving' || save === 'error'
  const openNow = { known: true, open: true, reason: 'open' as const, closesAt: '', nextOpen: '' }
  const closedNow = { known: true, open: false, reason: 'after_close' as const, closesAt: '', nextOpen: '' }
  const greetingOpen = callGreeting(draft, shop, openNow)
  const greetingClosed = draft.hours ? callGreeting(draft, shop, closedNow) : ''
  const firstText = `${firstTextIntro(draft, shop)} [its answer] ${OPT_OUT_LINE}`
  const instructions = telnyxAssistantInstructions(normalizeRules(draft), shop)

  const copyInstructions = async () => {
    try { await navigator.clipboard.writeText(instructions); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setShowInstructions(true) }
  }

  const setHandoff = (i: number, patch: Partial<{ name: string; phone: string }>) =>
    edit({ handoff: draft.handoff.map((h, j) => (j === i ? { ...h, ...patch } : h)) })

  return (
    <div className="space-y-4">
      {unavailable && (
        <div role="status" className="rounded-lg border border-amber/40 bg-amber/[0.08] p-4">
          <p className="font-bold">Saving these rules needs a one-time database update</p>
          <p className="mt-1 text-[0.9375rem]">Until your admin applies it, the assistant keeps using the starting rules shown here. Everything below is read only.</p>
        </div>
      )}
      {!unavailable && !load.data.saved && (
        <div role="status" className="rounded-lg border border-amber/40 bg-amber/[0.08] p-4">
          <p className="font-bold">Check these rules, then save them once</p>
          <p className="mt-1 text-[0.9375rem]">The assistant is using general starting rules. It tells every caller it is an AI, never gives a price and never promises a time. Set your hours and who it passes calls to.</p>
        </div>
      )}
      {!locked && !hasAiKey && (
        <p className="rounded-lg border border-border bg-bg-card p-3 text-[0.9375rem]">
          <span className="font-bold">No AI key is saved yet.</span> Until you add one in <Link href="/settings#ai" className="font-bold text-blue underline underline-offset-4">AI assistant settings</Link>, replies and calls use the assistant&apos;s plain built-in script instead.
        </p>
      )}
      {!locked && !hasTelnyx && (
        <p className="rounded-lg border border-border bg-bg-card p-3 text-[0.9375rem]">
          <span className="font-bold">Texts and calls are not connected yet.</span> Add your Telnyx key and number under <Link href="/settings#comms" className="font-bold text-blue underline underline-offset-4">Communications</Link>. You can still practice here.
        </p>
      )}
      {!canEdit && <p className="rounded-lg border border-border bg-bg-card p-3 text-[0.9375rem]">Only an owner, admin or manager can change these rules. You can read them and practice.</p>}

      <Panel id="rx-switch" title="Turn it on or off" description="Each one has its own switch. You can stop either at any time.">
        <Switch label="Answer phone calls" on={draft.calls_enabled} disabled={locked} onChange={v => edit({ calls_enabled: v })}
          hint={draft.calls_enabled ? 'Answers when you cannot, tells callers it is an AI, and takes their details.' : draft.handoff.length ? `Off. Calls go straight to ${draft.handoff[0].name || 'your first handoff number'}.` : 'Off. Callers hear a short recorded message and can leave a voicemail.'} />
        <Choice legend="Text replies" name="rx-texts" value={draft.texts_mode} options={TEXT_MODES} disabled={locked} onChange={v => edit({ texts_mode: v })} />
      </Panel>

      <Panel id="rx-voice" title="How it sounds" description="It always says it is an AI at the start of a call and in its first text. You choose the rest.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rx-name" className="form-label">Name it goes by (optional)</label>
            <input id="rx-name" className="form-input" value={draft.assistant_name} maxLength={30} disabled={locked} onChange={e => edit({ assistant_name: e.target.value })} placeholder="For example: Sam" aria-describedby="rx-name-hint" />
            <p id="rx-name-hint" className="form-hint !text-text-secondary">Leave empty and it says it is the virtual assistant for {shop.name || 'your shop'}.</p>
          </div>
          <div>
            <label htmlFor="rx-tone" className="form-label">Tone</label>
            <select id="rx-tone" className="form-select" value={draft.tone} disabled={locked} onChange={e => edit({ tone: e.target.value as VoiceRules['tone'] })}>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="rx-greet-call" className="form-label">What it says when it answers a call (optional)</label>
          <textarea id="rx-greet-call" className="form-textarea" rows={2} maxLength={400} value={draft.greeting_call} disabled={locked} onChange={e => edit({ greeting_call: e.target.value })}
            placeholder="Thanks for calling {shop}." aria-describedby="rx-greet-call-hint" />
          <p id="rx-greet-call-hint" className="form-hint !text-text-secondary">Use {'{shop}'} for your shop name. The AI notice and recording notice are added for you if you leave them out.</p>
        </div>
        <div>
          <label htmlFor="rx-greet-text" className="form-label">What it adds at the start of a first text (optional)</label>
          <textarea id="rx-greet-text" className="form-textarea" rows={2} maxLength={320} value={draft.greeting_text} disabled={locked} onChange={e => edit({ greeting_text: e.target.value })}
            placeholder="Thanks for texting {shop}!" aria-describedby="rx-greet-text-hint" />
          <p id="rx-greet-text-hint" className="form-hint !text-text-secondary">The first text always says it is an AI and ends with how to stop texts.</p>
        </div>
        <Switch label="Say that calls may be recorded" on={draft.recording_notice} disabled={locked} onChange={v => edit({ recording_notice: v })}
          hint="Recommended. Say this early in every call. Ask your own advisor what your state requires." />
        {draft.recording_notice && (
          <div>
            <label htmlFor="rx-rec-text" className="form-label">Recording notice wording</label>
            <input id="rx-rec-text" className="form-input" maxLength={200} value={draft.recording_notice_text} disabled={locked} onChange={e => edit({ recording_notice_text: e.target.value })} />
          </div>
        )}
        <div className="rounded-lg border border-border bg-bg-base p-3 text-[0.9375rem]" aria-label="Preview of what customers hear and read">
          <p className="font-bold">What a caller hears</p>
          <p className="mt-1 whitespace-pre-wrap text-text-secondary">{greetingOpen}</p>
          {greetingClosed && <><p className="mt-3 font-bold">When you are closed</p><p className="mt-1 whitespace-pre-wrap text-text-secondary">{greetingClosed}</p></>}
          <p className="mt-3 font-bold">What the first text looks like</p>
          <p className="mt-1 whitespace-pre-wrap text-text-secondary">{firstText}</p>
        </div>
      </Panel>

      <Panel id="rx-hours" title="Shop hours" description={<>Times are in your shop&apos;s time zone ({shop.timezone}). Change the time zone under <Link href="/settings#shop" className="font-bold text-blue underline underline-offset-4">Shop info</Link>.</>}>
        {draft.hours ? (
          <>
            <HoursGrid hours={draft.hours} disabled={locked} onChange={h => edit({ hours: h })} />
            <p className="text-[0.9375rem] text-text-secondary">Customers are told: {hoursSummary(draft.hours) || 'closed every day'}.</p>
            <ClosedDates dates={draft.closed_dates} disabled={locked} onChange={d => edit({ closed_dates: d })} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => edit({ hours: null })}>Clear my hours</button>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4">
            <p className="font-bold">Your hours are not set</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Until you set them, the assistant never states your hours, never says you are closed and cannot book times by itself.</p>
            <button type="button" className="btn btn-primary mt-3" disabled={locked} onClick={() => edit({ hours: defaultWeekHours() })}>Set my hours</button>
          </div>
        )}
        <Switch label="It may tell customers your hours" on={draft.may_share_hours} disabled={locked} onChange={v => edit({ may_share_hours: v })} />
        <Switch label="Text the caller back after a missed call or a message" on={draft.text_back_after_calls} disabled={locked} onChange={v => edit({ text_back_after_calls: v })}
          hint="A short text saying the team got their message. Never sent to a number that has said STOP." />
      </Panel>

      <Panel id="rx-handoff" title="Passing calls to a person" description="Who answers when the assistant hands a call over. Numbers are tried in order, during your open hours.">
        {draft.handoff.length === 0 && <p className="text-[0.9375rem] text-text-secondary">No one added yet. Without a number, the assistant takes a message instead of passing the call on.</p>}
        <ul className="space-y-3">
          {draft.handoff.map((h, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor={`rx-h-name-${i}`} className="form-label">Name</label>
                <input id={`rx-h-name-${i}`} className="form-input" value={h.name} maxLength={60} disabled={locked} onChange={e => setHandoff(i, { name: e.target.value })} placeholder="Front desk" />
              </div>
              <div>
                <label htmlFor={`rx-h-phone-${i}`} className="form-label">Phone</label>
                <input id={`rx-h-phone-${i}`} className="form-input" type="tel" inputMode="tel" autoComplete="off" value={h.phone} disabled={locked} onChange={e => setHandoff(i, { phone: e.target.value })} placeholder="(555) 555-0100" />
              </div>
              <button type="button" className="btn-icon" disabled={locked} onClick={() => edit({ handoff: draft.handoff.filter((_, j) => j !== i) })} aria-label={`Remove ${h.name || 'this person'}`} title="Remove"><Icon name="trash" className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
        {draft.handoff.length < 5 && (
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => edit({ handoff: [...draft.handoff, { name: '', phone: '' }] })}><Icon name="plus" className="h-5 w-5" />Add a person</button>
        )}
        <Switch label="Pass the call to a person during open hours" on={draft.transfer_when_open} disabled={locked} onChange={v => edit({ transfer_when_open: v })}
          hint="When the caller asks for a person or one of the topics below comes up. After hours it takes a message instead." />
        <Switch label="Text the person a short briefing first" on={draft.transfer_briefing} disabled={locked} onChange={v => edit({ transfer_briefing: v })}
          hint="Who is calling, the vehicle and what they need, so no one has to ask again." />
      </Panel>

      <Panel id="rx-person" title="When it must get a person" description="For these, the assistant stops, flags the conversation as needing a person and emails your team. It does not try to handle them.">
        <div className="space-y-1">
          {TOPICS.map(t => (
            <Switch key={t.key} label={t.label} hint={t.hint} on={draft.topics[t.key]} disabled={locked} onChange={v => edit({ topics: { ...draft.topics, [t.key]: v } })} />
          ))}
        </div>
        <ListEditor id="rx-keywords" label="Your own words that need a person" hint="For example: recall, lawsuit, warranty claim." placeholder="warranty claim" items={draft.custom_keywords} max={20} length={40} disabled={locked}
          onChange={items => edit({ custom_keywords: items })} />
        <p className="text-[0.875rem] text-text-secondary">A caller who asks for a person, or who the assistant is unsure about, is always passed on.</p>
      </Panel>

      <Panel id="rx-says" title="What it may and may not say">
        <div className="rounded-lg border border-border bg-bg-base p-3">
          <p className="font-bold">Always, and not changeable</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.9375rem] text-text-secondary">
            <li>It says it is an AI, and never claims to be a person.</li>
            <li>It never gives a price, an estimate or a range. It says the team gives a quote after looking at the vehicle.</li>
            <li>It never promises when a vehicle will be ready or when someone will call back.</li>
            <li>It never diagnoses a problem or says a vehicle is safe to drive.</li>
            <li>It stops texting a number that says STOP, and answers HELP and START.</li>
          </ul>
        </div>
        <div className="space-y-1">
          <Switch label="It may give your address" on={draft.may_share_address} disabled={locked} onChange={v => edit({ may_share_address: v })} />
          <Switch label="It may say where a customer's repair stands" on={draft.may_share_job_status} disabled={locked} onChange={v => edit({ may_share_job_status: v })} hint="Only for a customer it can match by phone number, and only the status your team recorded." />
          <Switch label="Hang up on sales calls and spam" on={draft.spam_filter} disabled={locked} onChange={v => edit({ spam_filter: v })} hint="Warranty offers, marketing, loans and robocalls. They are logged but do not reach your team." />
        </div>
        <ListEditor id="rx-never" label="Your own rules for what it must never do" hint="One rule at a time, in plain words. For example: never offer a discount." placeholder="Never offer a discount" items={draft.never_lines} max={10} length={200} disabled={locked}
          onChange={items => edit({ never_lines: items })} />
        <ListEditor id="rx-blocked" label="Words it must never use" hint="A reply with one of these is changed before it goes out." placeholder="guaranteed" items={draft.blocked_phrases} max={20} length={60} disabled={locked}
          onChange={items => edit({ blocked_phrases: items })} />
      </Panel>

      <Panel id="rx-book" title="Appointments" description="The assistant never confirms a time unless it came from your schedule or you approved it.">
        <Choice legend="When a customer wants an appointment" name="rx-booking" value={draft.booking_mode} options={BOOKING_MODES} disabled={locked} onChange={v => edit({ booking_mode: v })} />
        {draft.booking_mode !== 'off' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="rx-slot" className="form-label">Length of a visit</label>
              <select id="rx-slot" className="form-select" value={draft.booking_slot_minutes} disabled={locked} onChange={e => edit({ booking_slot_minutes: Number(e.target.value) })}>
                {SLOT_MINUTES.map(m => <option key={m} value={m}>{minuteWords(m)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rx-cap" className="form-label">Cars at the same time</label>
              <select id="rx-cap" className="form-select" value={draft.booking_capacity} disabled={locked} onChange={e => edit({ booking_capacity: Number(e.target.value) })}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rx-lead" className="form-label">Earliest booking from now</label>
              <select id="rx-lead" className="form-select" value={draft.booking_lead_hours} disabled={locked} onChange={e => edit({ booking_lead_hours: Number(e.target.value) })}>
                {LEAD_HOURS.map(h => <option key={h} value={h}>{h === 0 ? 'Right away' : hourWords(h)}</option>)}
              </select>
            </div>
          </div>
        )}
      </Panel>

      <Panel id="rx-limits" title="Quiet hours and limits" description="Texts only. Calls follow your shop hours.">
        <Switch label="Quiet hours for text replies" on={draft.quiet_hours.enabled} disabled={locked} onChange={v => edit({ quiet_hours: { ...draft.quiet_hours, enabled: v } })}
          hint="No automatic texts go out in this window. Early messages wait and your team sees them first." />
        {draft.quiet_hours.enabled && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div>
              <label htmlFor="rx-quiet-from" className="form-label">From</label>
              <input id="rx-quiet-from" type="time" className="form-input" value={draft.quiet_hours.from} disabled={locked} onChange={e => edit({ quiet_hours: { ...draft.quiet_hours, from: e.target.value } })} />
            </div>
            <div>
              <label htmlFor="rx-quiet-to" className="form-label">Until</label>
              <input id="rx-quiet-to" type="time" className="form-input" value={draft.quiet_hours.to} disabled={locked} onChange={e => edit({ quiet_hours: { ...draft.quiet_hours, to: e.target.value } })} />
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="rx-max" className="form-label">Most replies to one number</label>
            <select id="rx-max" className="form-select" value={draft.max_replies.count} disabled={locked} onChange={e => edit({ max_replies: { ...draft.max_replies, count: Number(e.target.value) } })}>
              {Array.from({ length: 20 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rx-window" className="form-label">Within</label>
            <select id="rx-window" className="form-select" value={draft.max_replies.window_hours} disabled={locked} onChange={e => edit({ max_replies: { ...draft.max_replies, window_hours: Number(e.target.value) } })}>
              {WINDOW_HOURS.map(h => <option key={h} value={h}>{hourWords(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rx-takeover" className="form-label">Stay quiet after your team replies</label>
            <select id="rx-takeover" className="form-select" value={draft.takeover_hours} disabled={locked} onChange={e => edit({ takeover_hours: Number(e.target.value) })}>
              {TAKEOVER_HOURS.map(h => <option key={h} value={h}>{hourWords(h)}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[0.875rem] text-text-secondary">After the limit, the assistant stops answering that number and your team is told. When your team replies to a customer, the assistant pauses for that conversation. It also never answers another automated system, so two machines cannot talk to each other forever.</p>
      </Panel>

      <Panel id="rx-notify" title="Who hears about it" description="You always see everything in the AI assistant page of the Inbox. Email is on top of that and never depends on texting.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rx-email" className="form-label">Send emails to</label>
            <input id="rx-email" type="email" className="form-input" autoComplete="off" value={draft.notify_email} disabled={locked} maxLength={200} onChange={e => edit({ notify_email: e.target.value })} placeholder={shop.email || 'owner@yourshop.com'} aria-describedby="rx-email-hint" />
            <p id="rx-email-hint" className="form-hint !text-text-secondary">Leave empty to use your shop email.</p>
          </div>
          <div>
            <label htmlFor="rx-summary" className="form-label">Call summary emails</label>
            <select id="rx-summary" className="form-select" value={draft.summary_email} disabled={locked} onChange={e => edit({ summary_email: e.target.value as VoiceRules['summary_email'] })}>
              <option value="follow_up">Only calls that need a follow up</option>
              <option value="every_call">Every call it answers</option>
              <option value="never">Never, I will read them in the app</option>
            </select>
          </div>
        </div>
        <Switch label="Email me when a customer texts and it did not answer" on={draft.email_new_texts} disabled={locked} onChange={v => edit({ email_new_texts: v })} />
        <p className="text-[0.875rem] text-text-secondary">A conversation that needs a person is always emailed.</p>
      </Panel>

      <Panel id="rx-try" title="Try it before customers do" description="Practice a call or a text with the rules on this screen, even if you have not saved them. Nothing is sent, saved or dialed.">
        <button type="button" className="btn btn-secondary" onClick={() => setTesting(true)}><Icon name="play" className="h-5 w-5" />Try the assistant</button>
      </Panel>

      <Panel id="rx-instr" title="Instructions for a Telnyx AI assistant" description="If you also build an AI assistant inside your Telnyx account, paste this into its instructions so it follows the same rules. This app enforces the same rules on its own side, so the two cannot disagree.">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void copyInstructions()}><Icon name={copied ? 'check' : 'copy'} className="h-5 w-5" />{copied ? 'Copied' : 'Copy instructions'}</button>
          <button type="button" className="btn btn-ghost" aria-expanded={showInstructions} onClick={() => setShowInstructions(s => !s)}>{showInstructions ? 'Hide the text' : 'Read the text'}</button>
        </div>
        {showInstructions && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base p-3 font-sans text-[0.9375rem] leading-snug" tabIndex={0} aria-label="Instructions text">{instructions}</pre>}
        <p className="text-[0.875rem] text-text-secondary">Written from the rules on screen. Save your rules first if you want the copy to match what customers get.</p>
      </Panel>

      {!locked && (
        <div className={`no-print flex flex-wrap items-center gap-3 ${pinBar ? 'sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-bg-chrome px-4 py-2 sm:mx-0 sm:rounded-lg sm:border lg:bottom-3' : 'py-1'}`} data-testid="rx-save">
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={save === 'saving' || !dirty} aria-busy={save === 'saving'}>Save rules</button>
          {dirty && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(saved); setSave('idle'); setSaveError('') }} disabled={save === 'saving'}>Undo changes</button>}
          <p aria-live="polite" className="min-w-0 flex-1 basis-40 text-[0.9375rem]">
            {save === 'error' ? <span role="alert" className="flex items-start gap-2"><span className="lamp lamp-red mt-1.5" aria-hidden="true" /><span><strong>Not saved.</strong> {saveError}</span></span>
              : save === 'saving' ? <span className="flex items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" />Saving...</span>
              : dirty ? <span className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><strong>Unsaved changes</strong></span>
              : save === 'saved' ? <span className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />Saved. The assistant follows these from its next call or text.</span>
              : <span className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />No changes to save</span>}
          </p>
        </div>
      )}
      <TestSheet open={testing} onClose={() => setTesting(false)} rules={draft} />
    </div>
  )
}
