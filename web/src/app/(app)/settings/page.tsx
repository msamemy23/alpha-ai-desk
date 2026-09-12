'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, updateSettings, getSettings, getShopProfile, getShopId } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'
import { useSignInWithChatGPT } from '@openai-oauth/react'

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch {}
  return addOpenAIOAuthHeaders(headers)
}

function ChatGPTConnection() {
  const auth = useSignInWithChatGPT()

  if (auth.status === 'checking' || auth.status === 'starting' || auth.status === 'redirecting') {
    return <div className="text-sm text-text-muted">Checking ChatGPT connection…</div>
  }

  if (auth.status === 'signed-in') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-green-300">✓ ChatGPT connected in this browser</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void auth.logout()}>Disconnect</button>
      </div>
    )
  }

  if (auth.status === 'needs-extension') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-amber-200">Hosted browser sign-in needs the Sign in with ChatGPT extension.</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-secondary btn-sm" href={auth.installUrl} target="_blank" rel="noreferrer">Install extension</a>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void auth.login()}>Try again</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void auth.login()}>Continue with ChatGPT</button>
      {auth.status === 'error' && <p className="text-sm text-red-300" role="alert">{auth.error.message}</p>}
    </div>
  )
}
import {
  AI_BASE_URLS,
  DEEPSEEK_PRO_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAiBaseUrl,
  normalizeAiModel,
} from '@/lib/ai-config'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string,unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [tab, setTab] = useState<'shop'|'ai'|'comms'|'outreach'|'reviews'>('shop')
  const [outreachFilter, setOutreachFilter] = useState({ days: 90, channel: 'sms' })
  const [outreachTemplate, setOutreachTemplate] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<{sent:number;total:number} | null>(null)

  // Feature 17: Google Review Response state
  const [reviewText, setReviewText] = useState('')
  const [reviewStars, setReviewStars] = useState(5)
  const [reviewDraft, setReviewDraft] = useState('')
  const [reviewLoading, setReviewLoading] = useState(false)

  const load = useCallback(async () => {
    // Load settings filtered by shop_id
    const settingsData = await getSettings()
    if (settingsData) {
      const normalized = { ...(settingsData as Record<string, unknown>) }
      const aiBase = normalizeAiBaseUrl(normalized.ai_base_url || AI_BASE_URLS.OPENROUTER)
      normalized.ai_base_url = aiBase
      normalized.ai_model = normalizeAiModel(normalized.ai_model || DEFAULT_OPENROUTER_MODEL, aiBase)
      setSettings(normalized)
    }
    // Also load shop profile to populate shop info fields
    const profile = await getShopProfile()
    if (profile) {
      setSettings(prev => ({
        ...prev,
        shop_name: prev.shop_name || profile.shop_name || '',
        shop_phone: prev.shop_phone || profile.phone || '',
        shop_address: prev.shop_address || profile.address || '',
        shop_email: prev.shop_email || (profile as any).email || '',
      }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    setSaveError('')
    const settingsResult = await updateSettings(settings)
    if (settingsResult?.error) {
      setSaving(false)
      setSaveError(settingsResult.error.message || 'Settings could not be saved')
      return
    }

    // Keep the tenant profile's display information in sync as well.
    const shopId = await getShopId()
    if (shopId) {
      const { error: profileError } = await supabase.from('shop_profiles').update({
        shop_name: settings.shop_name || '',
        phone: settings.shop_phone || '',
        address: settings.shop_address || '',
      }).eq('id', shopId)
      if (profileError) {
        setSaving(false)
        setSaveError(profileError.message || 'Shop profile could not be saved')
        return
      }
    }
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setSettings(s => ({ ...s, [k]: e.target.value }))

  const launchOutreach = async () => {
    setLaunching(true); setLaunchResult(null)
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          type: 'follow_up_cold',
          filter: { daysSinceLastVisit: outreachFilter.days },
          template: outreachTemplate || undefined,
          channel: outreachFilter.channel,
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Outreach could not be launched')
      setLaunchResult({ sent: data.sent, total: data.total })
    } finally { setLaunching(false) }
  }

  const draftReviewResponse = async () => {
    if (!reviewText.trim()) return
    setReviewLoading(true); setReviewDraft('')
    try {
      const shopName = (settings.shop_name as string) || 'our shop'
      const tone = reviewStars >= 4 ? 'grateful and warm' : reviewStars >= 3 ? 'appreciative and constructive' : 'empathetic, apologetic, and professional'
      const prompt = 'You are responding to a ' + reviewStars + '-star Google review for "' + shopName + '". The review says: "' + reviewText.trim() + '"\n\nWrite a ' + tone + ' response from the business owner. Keep it 2-4 sentences, professional but personable. Do not use generic filler. Address specific points. Return ONLY the response text.'
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ message: prompt, history: [], sessionId: 'review-draft' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'AI request failed')
      setReviewDraft(data.reply || 'Could not generate a response.')
    } catch (error) {
      setReviewDraft(error instanceof Error ? error.message : 'Error contacting AI. Check your API settings.')
    } finally { setReviewLoading(false) }
  }
  const TABS = [
    { id: 'shop', label: '🏪 Shop Info' },
    { id: 'ai', label: '🤖 AI Config' },
    { id: 'comms', label: '📡 Communications' },
    { id: 'outreach', label: '📣 AI Outreach' },
    { id: 'reviews', label: '⭐ Reviews' },
  ] as const

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">Settings</h1>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-sm text-red-400" role="alert">{saveError}</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary border-0'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'shop' && (
        <div className="card space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Shop Information</div>
          {[
            { k: 'shop_name', label: 'Shop Name' },
            { k: 'shop_address', label: 'Address' },
            { k: 'shop_phone', label: 'Phone' },
            { k: 'shop_email', label: 'Email' },
          ].map(({ k, label }) => (
            <div key={k}>
              <label className="form-label">{label}</label>
              <input className="form-input" value={settings[k] as string||''} onChange={sf(k)} />
            </div>
          ))}
          <div>
            <label className="form-label">Google Review URL</label>
            <input className="form-input w-full" placeholder="https://g.page/r/your-shop/review" value={settings.google_review_url as string || ''} onChange={e => setSettings(prev => ({ ...prev, google_review_url: e.target.value }))} />
            <p className="text-xs text-text-muted mt-1">Get this from your Google Business Profile → Get more reviews</p>
          </div>
          <div>
            <label className="form-label">Timezone</label>
            <select className="form-input w-full" value={settings.timezone as string || 'America/Chicago'} onChange={e => setSettings(prev => ({ ...prev, timezone: e.target.value }))}>
              <option value="America/Chicago">Central (Houston)</option>
              <option value="America/New_York">Eastern</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Los_Angeles">Pacific</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="form-label">Labor Rate ($/hr)</label><input className="form-input" type="number" value={(settings.labor_rate as number) ?? 120} onChange={sf('labor_rate')} /></div>
            <div><label className="form-label">Tax Rate (%)</label><input className="form-input" type="number" step="0.01" value={(settings.tax_rate as number) ?? 8.25} onChange={sf('tax_rate')} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="form-label">Warranty (months)</label><input className="form-input" type="number" value={(settings.warranty_months as number) ?? 12} onChange={sf('warranty_months')} /></div>
            <div><label className="form-label">Payment Methods</label><input className="form-input" value={settings.payment_methods as string||''} onChange={sf('payment_methods')} /></div>
          </div>
          <div><label className="form-label">Disclaimer</label><textarea className="form-textarea" rows={2} value={settings.disclaimer as string||''} onChange={sf('disclaimer')} /></div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="card space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">AI Configuration</div>
          <div className="bg-blue/10 border border-blue/30 rounded-lg p-3 text-sm text-blue">
            Get an API key at <strong>openrouter.ai</strong> or DeepSeek. DeepSeek V4 Flash is the default for Alpha AI.
          </div>
          <div className="rounded-lg border border-border bg-bg-hover/60 p-4">
            <div className="text-sm font-bold">Agents, MCP, and Kapture</div>
            <p className="mt-1 text-xs text-text-muted">Check Windows-MCP, Kapture connected tabs, available tools, approval gates, and restart controls.</p>
            <a href="/tools" className="btn btn-secondary btn-sm mt-3 inline-flex">Open Agents & Tools</a>
          </div>
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 space-y-3">
            <div className="text-sm font-bold">Use your ChatGPT plan for Alpha AI</div>
            <p className="text-xs text-text-muted">Connect your ChatGPT account using the third-party openai-oauth adapter. Hosted sign-in requires its Chrome or Firefox extension and does not work inside the embedded browser. This is separate from Alpha sign-in; your connection stays in this browser and your plan's limits still apply. It is not an official OpenAI API integration.</p>
            <ChatGPTConnection />
          </div>
          <div><label className="form-label">AI API Key</label><input className="form-input font-mono" type="password" value={settings.ai_api_key as string||''} onChange={sf('ai_api_key')} placeholder="sk-or-v1-... or sk-..." /></div>
          <div><label className="form-label">Model</label>
            <select className="form-select" value={settings.ai_model as string||''} onChange={sf('ai_model')}>
              <option value={DEFAULT_OPENROUTER_MODEL}>DeepSeek V4 Flash (Latest)</option>
              <option value={DEEPSEEK_PRO_OPENROUTER_MODEL}>DeepSeek V4 Pro</option>
              <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</option>
              <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
              <option value="openai/gpt-4o">GPT-4o</option>
              <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
              <option value="google/gemini-flash-1.5">Gemini Flash 1.5</option>
            </select>
          </div>
          <div><label className="form-label">Base URL</label><input className="form-input font-mono" value={settings.ai_base_url as string||AI_BASE_URLS.OPENROUTER} onChange={sf('ai_base_url')} /></div>
        </div>
      )}

      {tab === 'comms' && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">📱 SMS via Telnyx</div>
            <div className="bg-amber/10 border border-amber/30 rounded-lg p-3 text-sm text-amber">
              After purchasing a Telnyx number, paste your credentials here. Webhook URL: <code className="bg-black/30 px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'}/api/sms</code>
            </div>
            <div><label className="form-label">Telnyx API Key</label><input className="form-input font-mono" type="password" value={settings.telnyx_api_key as string||''} onChange={sf('telnyx_api_key')} placeholder="KEY01..." /></div>
            <div><label className="form-label">Your Telnyx Phone Number</label><input className="form-input" value={settings.telnyx_phone_number as string||''} onChange={sf('telnyx_phone_number')} placeholder="+17135550000" /></div>
            <div><label className="form-label">Telnyx Connection ID</label><input className="form-input font-mono" value={settings.telnyx_connection_id as string||''} onChange={sf('telnyx_connection_id')} placeholder="Your Telnyx connection/application ID" /></div>
             <div><label className="form-label">Outbound Voice Profile ID (optional)</label><input className="form-input font-mono" value={settings.telnyx_outbound_voice_profile_id as string||''} onChange={sf('telnyx_outbound_voice_profile_id')} placeholder="Use your Telnyx account's profile ID" /><p className="text-xs text-text-muted mt-1">Leave blank when your Telnyx account has one default outbound profile; it will be detected automatically.</p></div>
            <div><label className="form-label">Messaging Profile ID (optional)</label><input className="form-input font-mono" value={settings.telnyx_messaging_profile_id as string||''} onChange={sf('telnyx_messaging_profile_id')} /></div>
          </div>
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">📧 Email via Resend</div>
            <div className="bg-blue/10 border border-blue/30 rounded-lg p-3 text-sm text-blue">
              Get a free key at <strong>resend.com</strong> — 100 emails/day free. Add your domain there too.
            </div>
            <div><label className="form-label">Resend API Key</label><input className="form-input font-mono" type="password" value={settings.resend_api_key as string||''} onChange={sf('resend_api_key')} placeholder="re_..." /></div>
            <div><label className="form-label">From Email</label><input className="form-input" type="email" value={settings.from_email as string||''} onChange={sf('from_email')} placeholder="service@yourdomain.com" /></div>
          </div>
        </div>
      )}

      {tab === 'outreach' && (
        <div className="card space-y-5">
          <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">📣 AI Customer Outreach</div>
          <p className="text-sm text-text-muted">Automatically contact customers who haven't been in recently. AI personalizes each message.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Target customers inactive for</label>
              <select className="form-select" value={outreachFilter.days} onChange={e => setOutreachFilter(f => ({ ...f, days: Number(e.target.value) }))}>
                <option value={30}>30+ days</option>
                <option value={60}>60+ days</option>
                <option value={90}>90+ days</option>
                <option value={180}>6+ months</option>
                <option value={365}>1+ year</option>
              </select>
            </div>
            <div>
              <label className="form-label">Send via</label>
              <select className="form-select" value={outreachFilter.channel} onChange={e => setOutreachFilter(f => ({ ...f, channel: e.target.value }))}>
                <option value="sms">SMS (Telnyx)</option>
                <option value="email">Email (Resend)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Custom message template (optional)</label>
            <textarea className="form-textarea" rows={4} value={outreachTemplate} onChange={e => setOutreachTemplate(e.target.value)} placeholder={`Hi {name}! It's been a while since we've seen you at {shopName}. We miss you! Call us at {phone}.`} />
            <p className="text-xs text-text-muted mt-1">Use: {'{name}'}, {'{shopName}'}, {'{phone}'}</p>
          </div>
          <button className="btn btn-primary w-full" onClick={launchOutreach} disabled={launching}>
            {launching ? 'Sending outreach…' : '🚀 Launch Outreach Campaign'}
          </button>
          {launchResult && (
            <div className="bg-green/10 border border-green/30 rounded-lg p-4 text-sm text-green">
              ✅ Sent <strong>{launchResult.sent}</strong> messages out of <strong>{launchResult.total}</strong> eligible customers.
            </div>
          )}
          <div className="bg-red/10 border border-red/30 rounded-lg p-3 text-xs text-red/80">
            ⚠️ Only launch campaigns if Telnyx/Resend are configured. Test with a small batch first.
          </div>
        </div>
      )}

      {tab === 'reviews' && (
        <div className="card space-y-5">
          <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">⭐ Google Review Response Drafts</div>
          <p className="text-sm text-text-muted">Paste a Google review and get an AI-drafted response. Copy and paste the result into your Google Business reply.</p>
          <div>
            <label className="form-label">Star Rating</label>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => setReviewStars(n)} className={`text-2xl transition-transform hover:scale-110 ${n <= reviewStars ? 'opacity-100' : 'opacity-30'}`}>
                  ⭐
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="form-label">Customer Review Text</label>
            <textarea className="form-textarea" rows={4} value={reviewText} onChange={e => setReviewText(e.target.value)} placeholder="Paste the customer's review here..." />
          </div>
          <button className="btn btn-primary w-full" onClick={draftReviewResponse} disabled={reviewLoading || !reviewText.trim()}>
            {reviewLoading ? 'Drafting response…' : '✍️ Draft Response'}
          </button>
          {reviewDraft && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Draft Response</div>
              <div className="bg-bg-hover border border-border rounded-lg p-4 text-sm whitespace-pre-wrap">{reviewDraft}</div>
              <button className="btn btn-sm btn-secondary" onClick={() => { navigator.clipboard.writeText(reviewDraft) }}>
                📋 Copy to Clipboard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
