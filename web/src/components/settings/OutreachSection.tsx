'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { Group, useSettings } from './fields'
import { ButtonSpinner, StatusLine, getAuthJsonHeaders } from './shared'

const OUTREACH_DAYS = [
  { value: 30, label: '30 days or more' },
  { value: 60, label: '60 days or more' },
  { value: 90, label: '90 days or more' },
  { value: 180, label: '6 months or more' },
  { value: 365, label: '1 year or more' },
]

interface Outcome { sent: number; total: number; failed: string[] }

export default function OutreachSection() {
  const { settings } = useSettings()
  const [days, setDays] = useState(90)
  const [channel, setChannel] = useState<'sms' | 'email'>('sms')
  const [template, setTemplate] = useState('')
  const [launching, setLaunching] = useState(false)
  const [result, setResult] = useState<Outcome | null>(null)
  const [error, setError] = useState('')

  // Settings arrive with a "saved" flag for each key. Until they have loaded, the server decides.
  const loaded = 'telnyx_api_key_configured' in settings
  const textsReady = settings.telnyx_api_key_configured === true && Boolean(String(settings.telnyx_phone_number || '').trim())
  const emailReady = settings.resend_api_key_configured === true && Boolean(String(settings.from_email || '').trim())
  const ready = !loaded || (channel === 'sms' ? textsReady : emailReady)
  const via = channel === 'sms' ? 'text' : 'email'

  const shopName = String(settings.shop_name || '').trim() || 'your shop'
  const shopPhone = String(settings.shop_phone || '').trim() || 'your phone number'
  const preview = template.trim()
    .replace(/\{name\}/g, 'Maria')
    .replace(/\{shopName\}/g, shopName)
    .replace(/\{phone\}/g, shopPhone)

  const launch = async () => {
    const since = OUTREACH_DAYS.find(d => d.value === days)?.label.toLowerCase() ?? `${days} days`
    const what = template.trim() ? 'your message' : 'the standard message'
    if (!window.confirm(`Send ${what} by ${via} to every customer who has not visited in ${since}? Up to 500 customers are contacted. Messages go out right away and cannot be recalled.`)) return
    setLaunching(true); setResult(null); setError('')
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          type: 'follow_up_cold',
          filter: { daysSinceLastVisit: days },
          template: template || undefined,
          channel,
        }),
      })
      const data = await res.json().catch(() => ({}))
      // The server answers with an error status when some messages failed, but still says how many went out.
      if (typeof data.sent === 'number') {
        setResult({ sent: data.sent, total: Number(data.total) || 0, failed: Array.isArray(data.errors) ? data.errors.map(String) : [] })
      } else {
        throw new Error(data.error || 'Outreach could not be launched')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outreach could not be launched')
    } finally { setLaunching(false) }
  }

  return (
    <div className="space-y-4">
      <Group title="Win back past customers" description="Send one message to customers who have not been in for a while. You choose how long, and whether it goes by text or email.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="out-days" className="form-label">Customers who have not visited in</label>
            <select id="out-days" className="form-select" value={days} onChange={e => setDays(Number(e.target.value))}>
              {OUTREACH_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <p className="form-hint !text-text-secondary">Counted from the last job for that customer.</p>
          </div>
          <div>
            <label htmlFor="out-channel" className="form-label">Send by</label>
            <select id="out-channel" className="form-select" value={channel} onChange={e => { setChannel(e.target.value as 'sms' | 'email'); setResult(null); setError('') }}>
              <option value="sms">Text (Telnyx)</option>
              <option value="email">Email (Resend)</option>
            </select>
          </div>
        </div>

        {loaded && (ready
          ? <StatusLine lamp="green">{channel === 'sms' ? 'Texts are set up' : 'Email is set up'}</StatusLine>
          : (
            <Notice kind="warn">
              <p className="font-bold">{channel === 'sms' ? 'Texts are not set up yet.' : 'Email is not set up yet.'}</p>
              <p>Add your {channel === 'sms' ? 'Telnyx key and number' : 'Resend key and From email'} under Communications and save, then come back.</p>
              <a href="#comms" className="btn btn-secondary mt-2 no-underline">Open Communications</a>
            </Notice>
          ))}

        <div>
          <label htmlFor="out-template" className="form-label">Your own message (optional)</label>
          <textarea
            id="out-template"
            className="form-textarea"
            rows={4}
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder="Hi {name}! It’s been a while since we’ve seen you at {shopName}. Call us at {phone} to book your next visit."
            aria-describedby="out-template-hint"
          />
          <p id="out-template-hint" className="form-hint !text-text-secondary">
            You can use {'{name}'}, {'{shopName}'} and {'{phone}'}. Texts over 160 characters go out as more than one text.
            {!template.trim() && ' If you leave this empty, a standard message goes out. It says it has been a while, mentions this week’s specials on oil changes, brakes and inspections, and asks them to call you. Write your own if you are not running specials.'}
          </p>
        </div>

        {preview && (
          <div className="rounded-md border border-border bg-bg-base p-3">
            <p className="text-[0.8125rem] font-bold text-text-secondary">Preview for a customer named Maria</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem]">{preview}</p>
            <p className="num mt-1 text-[0.8125rem] text-text-secondary">{preview.length} characters</p>
          </div>
        )}

        <Notice kind="info">
          Customers who opted out of texts are skipped. Try a small group first, such as customers who have not visited in a year.
        </Notice>

        <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={launch} disabled={launching || !ready} aria-busy={launching}>
          {launching ? <><ButtonSpinner /> Sending…</> : <><Icon name="send" className="h-5 w-5" />Send outreach campaign</>}
        </button>

        {result && (
          <Notice kind={result.failed.length > 0 ? 'warn' : 'success'}>
            <p>
              Sent to <strong className="num">{result.sent}</strong> of <strong className="num">{result.total}</strong> customers.
              {result.failed.length > 0 && <> <strong className="num">{result.failed.length}</strong> could not be sent.</>}
              {result.failed.length === 0 && result.sent < result.total && ' The rest opted out or had no way to be reached.'}
            </p>
            {result.failed.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.failed.slice(0, 3).map((f, i) => <li key={i} className="break-words">{f}</li>)}
                {result.failed.length > 3 && <li>and {result.failed.length - 3} more</li>}
              </ul>
            )}
          </Notice>
        )}
        {error && (
          <Notice kind="error">
            <p className="font-bold">The campaign was not sent.</p>
            <p>{error}</p>
          </Notice>
        )}
      </Group>
    </div>
  )
}
