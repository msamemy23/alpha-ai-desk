'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import { ScreenToast, Switch, sentenceCase, useToast } from '@/components/ScreenParts'

// ── Types ──────────────────────────────────────────────────────────────────

interface ConfigField {
  key: string
  label: string
  type: 'number' | 'text' | 'boolean' | 'textarea' | 'select'
  default: unknown
  options?: string[]
}

interface SystemAutomation {
  id: string
  name: string
  description: string
  category: string
  schedule: string
  icon: string
  requires?: string[]
  configFields: ConfigField[]
  state: {
    enabled: boolean
    config: Record<string, unknown>
    last_run: string | null
    run_count: number
    last_result: string | null
    last_status: 'ok' | 'error' | 'never'
  }
}

interface CustomAutomation {
  id: string
  name: string
  description: string
  schedule: string
  task_prompt: string
  enabled: boolean
  last_run: string | null
  next_run: string | null
  run_count: number
  status: string
  last_result?: string
  created_at: string
}

const CATEGORIES = [
  { id: 'retention', label: 'Keep customers coming back', icon: 'repeat' },
  { id: 'operations', label: 'Run the shop', icon: 'wrench' },
  { id: 'growth', label: 'Find new customers', icon: 'growth' },
  { id: 'marketing', label: 'Get the word out', icon: 'send' },
]

// The server sends an emoji for each built-in automation. We show a plain icon instead.
const AUTO_ICON: Record<string, string> = {
  review_requests: 'star',
  estimate_followups: 'doc',
  re_engagement: 'repeat',
  service_reminders: 'wrench',
  lead_discovery: 'search',
  lead_outreach: 'mail',
  sms_blast: 'send',
  social_posts: 'image',
  review_responses: 'thumbsUp',
  appointment_reminders: 'calendar',
}

// These contact customers or leads when they run, so "Run now" asks first.
const CONTACTS_PEOPLE = new Set([
  'review_requests', 'estimate_followups', 're_engagement', 'service_reminders',
  'lead_outreach', 'sms_blast', 'appointment_reminders',
])

const SELECT_LABEL: Record<string, string> = { both: 'Both', alpha_ai: 'Alpha AI', competitors: 'Competitors' }

const PRESETS = [
  { label: 'Morning post', schedule: '8:00am', prompt: 'Post to Facebook: a short, friendly good-morning post saying our shop is open and ready, with our shop name and phone number.' },
  { label: 'Weekly stats', schedule: 'mon 9:00am', prompt: 'Get last week shop stats: revenue, jobs completed, top services. Give me a brief summary.' },
  { label: 'Job alerts', schedule: '9:00am', prompt: 'List all open jobs pending more than 3 days and flag them for follow-up.' },
  { label: 'Revenue check', schedule: 'fri 5:00pm', prompt: 'Summarize this week revenue vs last week. What were the top 3 services?' },
  { label: 'Evening reminder', schedule: '6:00pm', prompt: 'Check all jobs with status "ready" and text those customers their car is ready for pickup.' },
  { label: 'Lead scan', schedule: '7:00am', prompt: 'Scan for new leads near our shop and add them to the growth pipeline.' },
]

const jsonHeaders = () => ({ 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() })

const fmtTime = (iso: string | null) => {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hr ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

// ── Main Component ─────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [systemAutomations, setSystemAutomations] = useState<SystemAutomation[]>([])
  const [customItems, setCustomItems] = useState<CustomAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [sysFailed, setSysFailed] = useState(false)
  const [custFailed, setCustFailed] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [settingsFor, setSettingsFor] = useState<SystemAutomation | null>(null)
  const [showNew, setShowNew] = useState(false)
  const { toast, notify, dismiss } = useToast()

  const loadAll = useCallback(async () => {
    const [sysR, custR] = await Promise.all([
      fetch('/api/system-automations').then(r => r.json()).catch(() => ({ ok: false })),
      fetch('/api/automations').then(r => r.json()).catch(() => ({ ok: false })),
    ])
    if (sysR.ok) setSystemAutomations(sysR.automations || [])
    if (custR.ok) setCustomItems(custR.data || [])
    setSysFailed(!sysR.ok)
    setCustFailed(!custR.ok)
    setLoading(false)
  }, [])

  const reload = useCallback(() => { setLoading(true); void loadAll() }, [loadAll])

  useEffect(() => { void loadAll() }, [loadAll])

  const closeSettings = useCallback(() => setSettingsFor(null), [])
  const closeNew = useCallback(() => setShowNew(false), [])

  // ── System automation actions ──────────────────────────────────────

  const toggleSystem = async (id: string, enabled: boolean) => {
    const name = sentenceCase(systemAutomations.find(a => a.id === id)?.name || id)
    setSystemAutomations(prev => prev.map(a => a.id === id ? { ...a, state: { ...a.state, enabled } } : a))
    try {
      const r = await fetch('/api/system-automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'toggle', id, enabled }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) throw new Error(d.error || 'The change was not saved')
      notify(enabled ? `${name} is on.` : `${name} is paused.`, 'success')
    } catch (e) {
      notify(`${name} was not changed: ${e instanceof Error ? e.message : 'something went wrong'}.`, 'error')
      void loadAll()
    }
  }

  const runSystem = async (auto: SystemAutomation) => {
    const name = sentenceCase(auto.name)
    if (CONTACTS_PEOPLE.has(auto.id) && !window.confirm(`Run "${name}" now?\n\n${auto.description}.\n\nThis can send real texts or emails to customers.`)) return
    setRunningId(auto.id)
    try {
      const r = await fetch('/api/system-automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'run_now', id: auto.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.ok) { notify(`${name} ran.`, 'success'); void loadAll() }
      else notify(`${name} did not run: ${d.error || 'something went wrong'}.`, 'error')
    } catch { notify(`${name} did not run. Check your connection and try again.`, 'error') }
    setRunningId(null)
  }

  const saveSystemConfig = async (id: string, config: Record<string, unknown>): Promise<boolean> => {
    try {
      const r = await fetch('/api/system-automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'configure', id, config }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) throw new Error(d.error || 'The settings were not saved')
      notify('Settings saved.', 'success')
      void loadAll()
      return true
    } catch (e) {
      notify(`Settings were not saved: ${e instanceof Error ? e.message : 'something went wrong'}.`, 'error')
      return false
    }
  }

  // ── Custom automation actions ──────────────────────────────────────

  const createCustom = async (input: { name: string; description: string; schedule: string; prompt: string }): Promise<boolean> => {
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'create', name: input.name, description: input.description, schedule: input.schedule, task_prompt: input.prompt }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.ok) {
        notify(`"${input.name}" was added.`, 'success')
        void loadAll()
        return true
      }
      notify(`The automation was not added: ${d.error || 'something went wrong'}.`, 'error')
    } catch { notify('The automation was not added. Check your connection and try again.', 'error') }
    return false
  }

  const toggleCustom = async (id: string, enabled: boolean) => {
    const name = customItems.find(a => a.id === id)?.name || 'Automation'
    setCustomItems(prev => prev.map(a => a.id === id ? { ...a, enabled } : a))
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'toggle', id, enabled }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) throw new Error(d.error || 'The change was not saved')
      notify(enabled ? `${name} is on.` : `${name} is paused.`, 'success')
    } catch (e) {
      notify(`${name} was not changed: ${e instanceof Error ? e.message : 'something went wrong'}.`, 'error')
      void loadAll()
    }
  }

  const runCustom = async (id: string, name: string) => {
    if (!window.confirm(`Run "${name}" now?\n\nAlpha will follow the task you wrote. That can include sending texts or posting for you.`)) return
    setRunningId(id)
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'run_now', id }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.ok) { notify(`${name} ran.`, 'success'); void loadAll() }
      else notify(`${name} did not run: ${d.error || 'something went wrong'}.`, 'error')
    } catch { notify(`${name} did not run. Check your connection and try again.`, 'error') }
    setRunningId(null)
  }

  const deleteCustom = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ action: 'delete', id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) throw new Error(d.error || 'It was not deleted')
      notify(`"${name}" was deleted.`, 'success')
    } catch (e) {
      notify(`"${name}" was not deleted: ${e instanceof Error ? e.message : 'something went wrong'}.`, 'error')
    }
    void loadAll()
  }

  const systemOn = systemAutomations.filter(a => a.state.enabled).length
  const customOn = customItems.filter(a => a.enabled).length
  const totalOn = systemOn + customOn
  const bothFailed = sysFailed && custFailed

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Automations</h1>
          <p className="page-subtitle">Jobs Alpha does for you on a schedule, like review requests and reminders.</p>
        </div>
        <div className="toolbar sm:justify-end">
          {!loading && !bothFailed && (
            <p className="mr-2 flex items-center gap-2 font-bold">
              <span className={`lamp ${totalOn > 0 ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
              {totalOn > 0 ? `${totalOn} on` : 'All paused'}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" className="h-5 w-5" />
            New automation
          </button>
        </div>
      </header>

      <p className="mb-6 flex max-w-2xl items-start gap-2 text-[0.9375rem] text-text-secondary">
        <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
        <span>Automations are checked once a day. To run one right now, tap Run now.</span>
      </p>

      {loading ? (
        <div className="space-y-8" aria-busy="true" role="status" aria-label="Loading automations">
          {[0, 1].map(s => (
            <div key={s}>
              <div className="skeleton mb-3 h-6 w-48" />
              <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map(i => <div key={i} className="skeleton h-44" />)}</div>
            </div>
          ))}
        </div>
      ) : bothFailed ? (
        <ErrorCard title="Automations did not load" message="Check your connection and try again." onRetry={reload} className="max-w-xl" />
      ) : (
        <div className="space-y-10">
          {sysFailed ? (
            <ErrorCard title="The built-in automations did not load" message="Check your connection and try again. Your own automations are below." onRetry={reload} className="max-w-xl" />
          ) : CATEGORIES.map(cat => {
            const catAutomations = systemAutomations.filter(a => a.category === cat.id)
            if (catAutomations.length === 0) return null
            return (
              <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Icon name={cat.icon} className="h-5 w-5 shrink-0 text-text-secondary" />
                  <h2 id={`cat-${cat.id}`} className="section-title">{cat.label}</h2>
                  <span className="ml-auto text-[0.9375rem] text-text-secondary">
                    {catAutomations.filter(a => a.state.enabled).length} of {catAutomations.length} on
                  </span>
                </div>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {catAutomations.map(auto => (
                    <li key={auto.id}>
                      <SystemCard
                        auto={auto}
                        isRunning={runningId === auto.id}
                        onOpenSettings={() => setSettingsFor(auto)}
                        onToggle={toggleSystem}
                        onRun={runSystem}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <section aria-labelledby="cat-custom">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="pen" className="h-5 w-5 shrink-0 text-text-secondary" />
              <h2 id="cat-custom" className="section-title">Your own automations</h2>
              {!custFailed && customItems.length > 0 && (
                <span className="ml-auto text-[0.9375rem] text-text-secondary">{customOn} of {customItems.length} on</span>
              )}
            </div>

            {custFailed ? (
              <ErrorCard title="Your own automations did not load" message="Check your connection and try again." onRetry={reload} className="max-w-xl" />
            ) : customItems.length === 0 ? (
              <EmptyBlock
                icon="pen"
                title="You have not added any automations yet"
                action={<button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" className="h-5 w-5" />New automation</button>}
              >
                Tell Alpha what to do and when, for example &quot;Post a good-morning message on Facebook at 8am&quot;.
              </EmptyBlock>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {customItems.map(item => (
                  <li key={item.id}>
                    <CustomCard
                      item={item}
                      isRunning={runningId === item.id}
                      onToggle={toggleCustom}
                      onRun={runCustom}
                      onDelete={deleteCustom}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {settingsFor && <ConfigSheet key={settingsFor.id} auto={settingsFor} onClose={closeSettings} onSave={saveSystemConfig} />}
      {showNew && <NewSheet onClose={closeNew} onCreate={createCustom} />}

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}

// ── Shared card pieces ─────────────────────────────────────────────────────

function OnOff({ enabled, name, onChange }: { enabled: boolean; name: string; onChange: (next: boolean) => void }) {
  return (
    <div className="-mr-1 flex shrink-0 flex-col items-center">
      <Switch checked={enabled} onChange={onChange} label={name} />
      <span className="-mt-1 text-[0.8125rem] font-bold text-text-secondary" aria-hidden="true">{enabled ? 'On' : 'Paused'}</span>
    </div>
  )
}

function Meta({ schedule, lamp, status, runs }: { schedule: string; lamp: Lamp; status: string; runs: number }) {
  return (
    <div className="mt-3 space-y-1 text-[0.9375rem]">
      <p className="flex items-center gap-2 text-text-secondary"><Icon name="clock" className="h-4 w-4 shrink-0" />{schedule}</p>
      <p className="flex items-start gap-2">
        <span className={`lamp lamp-${lamp} mt-[0.4rem]`} aria-hidden="true" />
        <span>{status}{runs > 0 ? <span className="text-text-secondary"> · {runs} {runs === 1 ? 'run' : 'runs'} so far</span> : null}</span>
      </p>
    </div>
  )
}

// ── System Automation Card ─────────────────────────────────────────────────

interface SystemCardProps {
  auto: SystemAutomation
  isRunning: boolean
  onOpenSettings: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRun: (auto: SystemAutomation) => void
}

function SystemCard({ auto, isRunning, onOpenSettings, onToggle, onRun }: SystemCardProps) {
  const name = sentenceCase(auto.name)
  const s = auto.state
  const lamp: Lamp = s.last_status === 'ok' ? 'green' : s.last_status === 'error' ? 'red' : 'off'
  const status = s.last_status === 'ok' ? `Last run worked, ${fmtTime(s.last_run)}`
    : s.last_status === 'error' ? `Last run failed, ${fmtTime(s.last_run)}`
    : 'Has not run yet'

  return (
    <article className="card h-full">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name={AUTO_ICON[auto.id] || 'clock'} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-tight">{name}</h3>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">{auto.description}</p>
        </div>
        <OnOff enabled={s.enabled} name={name} onChange={next => onToggle(auto.id, next)} />
      </div>

      <Meta schedule={auto.schedule} lamp={lamp} status={status} runs={s.run_count} />

      {auto.requires && auto.requires.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber/[0.16] px-3 py-2 text-[0.9375rem] text-text-primary">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
          <span>Needs an account connected first. <Link href="/connectors" className="font-bold text-blue underline underline-offset-2">Open connected apps</Link></span>
        </p>
      )}

      {s.last_status === 'error' && s.last_result && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-red/[0.12] px-3 py-2 text-[0.9375rem] text-text-primary">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
          <span className="min-w-0 break-words"><span className="font-bold">What went wrong: </span>{s.last_result}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => onRun(auto)} disabled={isRunning} aria-label={`Run ${name} now`}>
          <Icon name="play" className="h-4 w-4" />
          {isRunning ? 'Running…' : 'Run now'}
        </button>
        {auto.configFields.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={onOpenSettings} aria-label={`Settings for ${name}`}>
            <Icon name="settings" className="h-5 w-5" />
            Settings
          </button>
        )}
      </div>
    </article>
  )
}

// ── Settings sheet for a built-in automation ───────────────────────────────

function ConfigSheet({ auto, onClose, onSave }: { auto: SystemAutomation; onClose: () => void; onSave: (id: string, config: Record<string, unknown>) => Promise<boolean> }) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(auto.state.config || {})
  const [saving, setSaving] = useState(false)
  const setVal = (key: string, val: unknown) => setLocalConfig(prev => ({ ...prev, [key]: val }))
  const name = sentenceCase(auto.name)

  const save = async () => {
    setSaving(true)
    const ok = await onSave(auto.id, localConfig)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Sheet open onClose={onClose} title={`${name} settings`}>
      <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4">
        {auto.configFields.map(field => {
          const id = `cfg-${auto.id}-${field.key}`
          const value = localConfig[field.key] ?? field.default
          const label = sentenceCase(field.label)
          return (
            <div key={field.key}>
              {field.type === 'boolean' ? (
                <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-3 font-bold">
                  <input id={id} type="checkbox" checked={!!value} onChange={e => setVal(field.key, e.target.checked)} className="h-5 w-5 accent-[rgb(var(--c-blue))]" />
                  {label}
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="form-label">{label}</label>
                  {field.type === 'select' ? (
                    <select id={id} value={String(value)} onChange={e => setVal(field.key, e.target.value)} className="form-select">
                      {field.options?.map(opt => <option key={opt} value={opt}>{SELECT_LABEL[opt] || opt}</option>)}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea id={id} value={String(value)} onChange={e => setVal(field.key, e.target.value)} rows={4} className="form-textarea" />
                  ) : (
                    <input
                      id={id}
                      type={field.type === 'number' ? 'number' : 'text'}
                      inputMode={field.type === 'number' ? 'decimal' : undefined}
                      value={String(value)}
                      onChange={e => setVal(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                      className="form-input"
                    />
                  )}
                </>
              )}
            </div>
          )
        })}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>
    </Sheet>
  )
}

// ── New automation sheet ───────────────────────────────────────────────────

function NewSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; description: string; schedule: string; prompt: string }) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [prompt, setPrompt] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)

  const submit = async () => {
    setTried(true)
    if (!name.trim() || !schedule.trim() || !prompt.trim()) return
    setSaving(true)
    const ok = await onCreate({ name: name.trim(), description: desc.trim(), schedule: schedule.trim(), prompt: prompt.trim() })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Sheet open onClose={onClose} title="New automation">
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-4" noValidate>
        <p className="-mt-1 text-[0.9375rem] text-text-secondary">Tell Alpha what to do and when. It is checked once a day, and every run is saved as a proposal for you to approve.</p>

        <div>
          <p className="form-label">Start from an idea</p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setName(p.label); setSchedule(p.schedule); setPrompt(p.prompt) }}
                className="btn btn-secondary justify-start !px-3 text-left"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="new-auto-name" className="form-label">Name</label>
          <input id="new-auto-name" className="form-input" placeholder="Morning Facebook post" value={name} onChange={e => setName(e.target.value)} aria-invalid={tried && !name.trim()} aria-describedby={tried && !name.trim() ? 'new-auto-name-err' : undefined} />
          {tried && !name.trim() && <p id="new-auto-name-err" className="form-error">Give it a name.</p>}
        </div>
        <div>
          <label htmlFor="new-auto-schedule" className="form-label">When</label>
          <input id="new-auto-schedule" className="form-input" placeholder="8:00am or mon 9:00am" value={schedule} onChange={e => setSchedule(e.target.value)} aria-invalid={tried && !schedule.trim()} aria-describedby="new-auto-schedule-hint" />
          {tried && !schedule.trim() && <p className="form-error">Say when it should run.</p>}
          <p id="new-auto-schedule-hint" className="form-hint">Every day: 8:00am. Once a week: mon 9:00am.</p>
        </div>
        <div>
          <label htmlFor="new-auto-prompt" className="form-label">What should Alpha do?</label>
          <textarea id="new-auto-prompt" className="form-textarea" rows={4} placeholder="Post to Facebook: a short good-morning post saying we are open today, with our shop name and phone number" value={prompt} onChange={e => setPrompt(e.target.value)} aria-invalid={tried && !prompt.trim()} aria-describedby="new-auto-prompt-hint" />
          {tried && !prompt.trim() && <p className="form-error">Describe the job.</p>}
          <p id="new-auto-prompt-hint" className="form-hint">Write it the way you would type it in Ask Alpha.</p>
        </div>
        <div>
          <label htmlFor="new-auto-desc" className="form-label">Note to yourself (optional)</label>
          <input id="new-auto-desc" className="form-input" value={desc} onChange={e => setDesc(e.target.value)} />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add automation'}</button>
        </div>
      </form>
    </Sheet>
  )
}

// ── Custom Automation Card ─────────────────────────────────────────────────

interface CustomCardProps {
  item: CustomAutomation
  isRunning: boolean
  onToggle: (id: string, enabled: boolean) => void
  onRun: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
}

function CustomCard({ item, isRunning, onToggle, onRun, onDelete }: CustomCardProps) {
  const lamp: Lamp = item.status === 'completed' ? 'green' : item.status === 'error' ? 'red' : item.status === 'running' ? 'blue' : 'off'
  const word = item.status === 'completed' ? `Last run worked, ${fmtTime(item.last_run)}`
    : item.status === 'error' ? `Last run failed, ${fmtTime(item.last_run)}`
    : item.status === 'running' ? 'Running now'
    : item.last_run ? `Last ran ${fmtTime(item.last_run)}`
    : 'Has not run yet'

  return (
    <article className="card h-full">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name="pen" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-tight">{item.name}</h3>
          <p className="mt-1 line-clamp-3 text-[0.9375rem] text-text-secondary">{item.task_prompt}</p>
        </div>
        <OnOff enabled={item.enabled} name={item.name} onChange={next => onToggle(item.id, next)} />
      </div>

      <Meta schedule={item.schedule} lamp={lamp} status={word} runs={item.run_count} />

      {item.last_result && (
        <p className="mt-3 line-clamp-3 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem] text-text-secondary">{item.last_result}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => onRun(item.id, item.name)} disabled={isRunning} aria-label={`Run ${item.name} now`}>
          <Icon name="play" className="h-4 w-4" />
          {isRunning ? 'Running…' : 'Run now'}
        </button>
        <button type="button" className="btn btn-danger sm:ml-auto" onClick={() => onDelete(item.id, item.name)} aria-label={`Delete ${item.name}`}>
          <Icon name="trash" className="h-5 w-5" />
          Delete
        </button>
      </div>
    </article>
  )
}
