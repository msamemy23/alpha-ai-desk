'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'
import ChatGPTConnection from '@/components/ChatGPTConnection'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import {
  AI_BASE_URLS,
  DEEPSEEK_PRO_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_MODEL,
} from '@/lib/ai-config'
import ShopLogoTile from '@/components/ShopLogoTile'
import { logoFromFile, saveShopLogo, useShopLogo } from '@/lib/shop-logo'
import { Group, SelectField, TextAreaField, TextField } from './fields'

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch {}
  return addOpenAIOAuthHeaders(headers)
}

function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

/* ---------- Shop logo ---------- */
/** Saves on its own as soon as a picture is chosen, so it does not wait for the Save button below. */
function LogoGroup() {
  const { logo, available, ready } = useShopLogo()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function choose(file: File | undefined) {
    if (!file) return
    setError(''); setDone(''); setBusy(true)
    try {
      const small = await logoFromFile(file)
      const res = await saveShopLogo(small)
      if (res.error) setError(res.error); else setDone('Logo saved. It now shows in the app and on your estimates and invoices.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That picture could not be used.')
    }
    setBusy(false)
  }

  async function remove() {
    setError(''); setDone(''); setBusy(true)
    const res = await saveShopLogo(null)
    if (res.error) setError(res.error); else setDone('Logo removed.')
    setBusy(false)
  }

  return (
    <Group title="Logo" description="Shows in the app next to your shop name, and at the top of every estimate and invoice you print or save as a PDF.">
      <div className="flex items-center gap-4">
        {!ready ? (
          <div className="skeleton h-24 w-24 shrink-0 rounded-lg" aria-hidden="true" />
        ) : logo ? (
          <ShopLogoTile src={logo} size={96} alt="Your shop logo" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-text-muted" aria-hidden="true">
            <Icon name="image" className="h-8 w-8" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[0.9375rem] text-text-secondary">{logo ? 'This is the logo customers see.' : 'No logo yet. A square picture works best. PNG, JPG or WebP.'}</p>
          <div className="flex flex-wrap gap-2">
            <label className={`btn btn-secondary ${busy || !available ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
              <Icon name="upload" className="h-5 w-5" />
              {busy ? 'Saving…' : logo ? 'Replace logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy || !available}
                onChange={e => { void choose(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
            {logo && <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy}>Remove</button>}
          </div>
        </div>
      </div>
      {!available && <Notice kind="warn">Logos are not switched on for this account yet. Everything else here still works.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="success">{done}</Notice>}
    </Group>
  )
}

/* ---------- Shop info ---------- */
export function ShopSection() {
  return (
    <div className="space-y-4">
      <LogoGroup />
      <Group title="Shop details" description="Customers see these on the estimates, invoices and signing links you send.">
        <TextField k="shop_name" label="Shop name" autoComplete="organization" />
        <TextField k="shop_address" label="Address" hint="Street, city, state and ZIP." />
        <TextField k="shop_phone" label="Phone" type="text" inputMode="tel" hint="The number customers call." />
        <TextField k="shop_email" label="Email" type="email" inputMode="email" hint="Replies to emailed estimates come here, and so does the note when a customer signs." />
      </Group>

      <Group title="Rates and paperwork">
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <TextField k="labor_rate" label="Labor rate (dollars per hour)" type="number" inputMode="decimal" fallback={120} />
          <TextField k="tax_rate" label="Tax rate (percent)" type="number" inputMode="decimal" step="0.01" fallback={8.25} hint="For example 8.25." />
        </div>
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <TextField k="warranty_months" label="Warranty (months)" type="number" inputMode="numeric" fallback={12} />
          <TextField k="payment_methods" label="Payment methods" hint="For example Cash, Card, Zelle." />
        </div>
        <TextAreaField k="disclaimer" label="Disclaimer" rows={3} hint="Fine print for your paperwork, such as storage fees or your parts policy." />
      </Group>

      <Group title="Reviews and time zone">
        <TextField k="google_review_url" label="Google review link" type="url" inputMode="url" placeholder="https://g.page/r/your-shop/review" hint="Find this in your Google Business Profile under Get more reviews." />
        <SelectField
          k="timezone"
          label="Time zone"
          fallback="America/Chicago"
          hint="Used for reminders and automations."
          options={[
            { value: 'America/Chicago', label: 'Central (Houston)' },
            { value: 'America/New_York', label: 'Eastern' },
            { value: 'America/Denver', label: 'Mountain' },
            { value: 'America/Los_Angeles', label: 'Pacific' },
          ]}
        />
      </Group>
    </div>
  )
}

/* ---------- AI assistant ---------- */
export function AiSection() {
  return (
    <div className="space-y-4">
      <Notice kind="info">
        Alpha needs an AI key to answer questions and draft estimates and texts. Get one at <strong>openrouter.ai</strong> or from DeepSeek. DeepSeek V4 Flash is the default.
      </Notice>

      <Group title="Your AI key">
        <TextField k="ai_api_key" label="AI API key" type="password" mono secret placeholder="sk-or-v1-... or sk-..." />
        <SelectField
          k="ai_model"
          label="Model"
          options={[
            { value: DEFAULT_OPENROUTER_MODEL, label: 'DeepSeek V4 Flash (latest)' },
            { value: DEEPSEEK_PRO_OPENROUTER_MODEL, label: 'DeepSeek V4 Pro' },
            { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
            { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
            { value: 'openai/gpt-4o', label: 'GPT-4o' },
            { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
            { value: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5' },
          ]}
        />
        <TextField k="ai_base_url" label="Base URL" type="url" inputMode="url" mono fallback={AI_BASE_URLS.OPENROUTER} hint="Leave this as it is unless your AI provider gave you a different address." />
      </Group>

      <Group
        title="Use your ChatGPT plan"
        description="Approve a one-time code on OpenAI’s sign-in page. No extension is needed. Your connection is encrypted, stored on Alpha’s server, and used only for your account’s chat requests. This third-party integration uses your plan’s Codex access and limits; it is separate from Alpha sign-in and the billed OpenAI API. Disconnect here at any time."
      >
        <ChatGPTConnection />
      </Group>

      <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h3 className="section-title">Agents and tools</h3>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">Check Windows-MCP, Kapture connected tabs, available tools, approval gates, and restart controls.</p>
        </div>
        <Link href="/tools" className="btn btn-secondary shrink-0">
          Open agents and tools
          <Icon name="arrowRight" className="h-5 w-5" />
        </Link>
      </section>
    </div>
  )
}

/* ---------- Communications ---------- */
export function CommsSection() {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const webhook = `${origin || 'https://your-app.vercel.app'}/api/sms`

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhook)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the field is selectable, so it can be copied by hand */ }
  }

  return (
    <div className="space-y-4">
      <Group title="Texts and calls (Telnyx)" description="After you buy a Telnyx number, paste its details here.">
        <div>
          <label htmlFor="set-webhook" className="form-label">Webhook address</label>
          <div className="flex gap-2">
            <input id="set-webhook" className="form-input min-w-0 flex-1 font-mono" readOnly value={webhook} onFocus={e => e.currentTarget.select()} aria-describedby="set-webhook-hint" />
            <button type="button" className="btn btn-secondary shrink-0" onClick={copyWebhook}>
              <Icon name={copied ? 'check' : 'copy'} className="h-5 w-5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p id="set-webhook-hint" className="form-hint">Paste this into Telnyx so incoming texts reach Alpha Desk.</p>
        </div>
        <TextField k="telnyx_api_key" label="Telnyx API key" type="password" mono secret placeholder="KEY01..." />
        <TextField k="telnyx_phone_number" label="Your Telnyx phone number" type="text" inputMode="tel" placeholder="+17135550000" hint="Include the country code, like +1." />
        <TextField k="telnyx_connection_id" label="Telnyx connection ID" mono placeholder="Your Telnyx connection or application ID" />
        <TextField k="telnyx_outbound_voice_profile_id" label="Outbound voice profile ID (optional)" mono placeholder="Your Telnyx account’s profile ID" hint="Leave blank when your Telnyx account has one default outbound profile. It is found automatically." />
        <TextField k="telnyx_messaging_profile_id" label="Messaging profile ID (optional)" mono />
      </Group>

      <Group title="Email (Resend)" description={<>Get a free key at <strong>resend.com</strong>, which includes 100 emails a day. Add your domain there too.</>}>
        <TextField k="resend_api_key" label="Resend API key" type="password" mono secret placeholder="re_..." />
        <TextField k="from_email" label="From email" type="email" inputMode="email" placeholder="service@yourdomain.com" hint="Emails to customers are sent from this address." />
      </Group>
    </div>
  )
}

/* ---------- AI outreach ---------- */
const OUTREACH_DAYS = [
  { value: 30, label: '30 days or more' },
  { value: 60, label: '60 days or more' },
  { value: 90, label: '90 days or more' },
  { value: 180, label: '6 months or more' },
  { value: 365, label: '1 year or more' },
]

export function OutreachSection() {
  const [days, setDays] = useState(90)
  const [channel, setChannel] = useState('sms')
  const [template, setTemplate] = useState('')
  const [launching, setLaunching] = useState(false)
  const [result, setResult] = useState<{ sent: number; total: number } | null>(null)
  const [error, setError] = useState('')

  const launch = async () => {
    const since = OUTREACH_DAYS.find(d => d.value === days)?.label.toLowerCase() ?? `${days} days`
    const via = channel === 'sms' ? 'text' : 'email'
    if (!window.confirm(`Send this message by ${via} to every customer who has not visited in ${since}? Messages go out right away and cannot be recalled.`)) return
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
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Outreach could not be launched')
      setResult({ sent: data.sent, total: data.total })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outreach could not be launched')
    } finally { setLaunching(false) }
  }

  return (
    <div className="space-y-4">
      <Group title="Win back past customers" description="Contact customers who have not been in for a while. Alpha personalizes each message.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="out-days" className="form-label">Customers who have not visited in</label>
            <select id="out-days" className="form-select" value={days} onChange={e => setDays(Number(e.target.value))}>
              {OUTREACH_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="out-channel" className="form-label">Send by</label>
            <select id="out-channel" className="form-select" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="sms">Text (Telnyx)</option>
              <option value="email">Email (Resend)</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="out-template" className="form-label">Your own message (optional)</label>
          <textarea
            id="out-template"
            className="form-textarea"
            rows={4}
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder={`Hi {name}! It's been a while since we've seen you at {shopName}. We miss you! Call us at {phone}.`}
            aria-describedby="out-template-hint"
          />
          <p id="out-template-hint" className="form-hint">You can use {'{name}'}, {'{shopName}'} and {'{phone}'}. Leave it empty and Alpha writes it.</p>
        </div>

        <Notice kind="warn">
          Only send a campaign after Telnyx or Resend is set up under Communications. Try a small group first.
        </Notice>

        <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={launch} disabled={launching} aria-busy={launching}>
          {launching ? <><ButtonSpinner /> Sending…</> : <><Icon name="send" className="h-5 w-5" />Send outreach campaign</>}
        </button>

        {result && (
          <Notice kind="success">
            Sent <strong className="num">{result.sent}</strong> messages to <strong className="num">{result.total}</strong> eligible customers.
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

/* ---------- Reviews ---------- */
export function ReviewsSection({ shopName }: { shopName: string }) {
  const [text, setText] = useState('')
  const [stars, setStars] = useState(5)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const draftResponse = async () => {
    if (!text.trim()) return
    setLoading(true); setDraft(''); setError(''); setCopied(false)
    try {
      const name = shopName || 'our shop'
      const tone = stars >= 4 ? 'grateful and warm' : stars >= 3 ? 'appreciative and constructive' : 'empathetic, apologetic, and professional'
      const prompt = 'You are responding to a ' + stars + '-star Google review for "' + name + '". The review says: "' + text.trim() + '"\n\nWrite a ' + tone + ' response from the business owner. Keep it 2-4 sentences, professional but personable. Do not use generic filler. Address specific points. Return ONLY the response text.'
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ message: prompt, history: [], sessionId: 'review-draft' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'AI request failed')
      setDraft(data.reply || 'Could not generate a response.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alpha could not reach the AI. Check your AI settings.')
    } finally { setLoading(false) }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the text is selectable, so it can be copied by hand */ }
  }

  return (
    <div className="space-y-4">
      <Group title="Reply to a Google review" description="Paste a review and Alpha drafts a reply. Copy it into your Google Business reply.">
        <div>
          <span id="stars-label" className="form-label">Star rating</span>
          <div role="group" aria-labelledby="stars-label" className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                aria-pressed={n === stars}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="btn-icon"
              >
                <Icon name="star" className={`h-7 w-7 ${n <= stars ? 'fill-current text-amber' : 'text-text-muted'}`} />
              </button>
            ))}
            <span className="num ml-2 text-[0.9375rem] text-text-secondary">{stars} of 5</span>
          </div>
        </div>
        <div>
          <label htmlFor="rev-text" className="form-label">What the customer wrote</label>
          <textarea id="rev-text" className="form-textarea" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the review here" />
        </div>
        <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={draftResponse} disabled={loading || !text.trim()} aria-busy={loading}>
          {loading ? <><ButtonSpinner /> Drafting reply…</> : 'Draft reply'}
        </button>

        {error && (
          <Notice kind="error">
            <p className="font-bold">The reply could not be drafted.</p>
            <p>{error}</p>
          </Notice>
        )}
      </Group>

      {draft && (
        <section className="panel p-4 sm:p-5" aria-labelledby="draft-h">
          <h3 id="draft-h" className="section-title">Your draft reply</h3>
          <p className="mt-3 whitespace-pre-wrap leading-relaxed">{draft}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} className="h-5 w-5" />
            {copied ? 'Copied' : 'Copy reply'}
          </button>
        </section>
      )}
    </div>
  )
}
