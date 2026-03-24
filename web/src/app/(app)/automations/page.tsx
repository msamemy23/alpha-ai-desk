'use client'
import { useEffect, useState, useCallback } from 'react'

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
  { id: 'retention', label: 'Customer Retention', icon: '🤝' },
  { id: 'operations', label: 'Operations', icon: '🔧' },
  { id: 'growth', label: 'Lead Growth', icon: '📈' },
  { id: 'marketing', label: 'Marketing', icon: '📣' },
]

const PRESETS = [
  { label: '☀️ Morning Post', schedule: '8:00am', prompt: 'Post to Facebook: Good morning Houston! Alpha International Auto Center is open and ready. Expert repairs, fair prices. Call (713) 663-6979' },
  { label: '📊 Weekly Stats', schedule: 'mon 9:00am', prompt: 'Get last week shop stats: revenue, jobs completed, top services. Give me a brief summary.' },
  { label: '🔔 Job Alerts', schedule: '9:00am', prompt: 'List all open jobs pending more than 3 days and flag them for follow-up.' },
  { label: '💰 Revenue Check', schedule: 'fri 5:00pm', prompt: 'Summarize this week revenue vs last week. What were the top 3 services?' },
  { label: '📱 Evening Reminder', schedule: '6:00pm', prompt: 'Check all jobs with status "ready" and text those customers their car is ready for pickup.' },
  { label: '🌐 Lead Scan', schedule: '7:00am', prompt: 'Scan for new leads in Houston and add them to the growth pipeline.' },
]

// ── Main Component ─────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [systemAutomations, setSystemAutomations] = useState<SystemAutomation[]>([])
  const [customItems, setCustomItems] = useState<CustomAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  // New automation form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSchedule, setNewSchedule] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 4000)
  }, [])

  const loadAll = useCallback(async () => {
    const [sysR, custR] = await Promise.all([
      fetch('/api/system-automations').then(r => r.json()).catch(() => ({ ok: false })),
      fetch('/api/automations').then(r => r.json()).catch(() => ({ ok: false })),
    ])
    if (sysR.ok) setSystemAutomations(sysR.automations || [])
    if (custR.ok) setCustomItems(custR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── System automation actions ──────────────────────────────────────

  const toggleSystem = async (id: string, enabled: boolean) => {
    setSystemAutomations(prev => prev.map(a => a.id === id ? { ...a, state: { ...a.state, enabled } } : a))
    try {
      await fetch('/api/system-automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', id, enabled }),
      })
      const name = systemAutomations.find(a => a.id === id)?.name || id
      showToast(enabled ? `${name} turned ON ✅` : `${name} paused ⏸`)
    } catch { showToast('Failed to update', 'error'); loadAll() }
  }

  const runSystem = async (id: string, name: string) => {
    setRunningId(id)
    try {
      const r = await fetch('/api/system-automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_now', id }),
      })
      const d = await r.json()
      if (d.ok) { showToast(`✅ ${name} ran successfully`); loadAll() }
      else showToast(`Error: ${d.error}`, 'error')
    } catch { showToast('Run failed', 'error') }
    setRunningId(null)
  }

  const saveSystemConfig = async (id: string, config: Record<string, unknown>) => {
    await fetch('/api/system-automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'configure', id, config }),
    })
    showToast('Settings saved')
    loadAll()
  }

  // ── Custom automation actions ──────────────────────────────────────

  const createCustom = async () => {
    if (!newName || !newSchedule || !newPrompt) return
    setSaving(true)
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName, description: newDesc, schedule: newSchedule, task_prompt: newPrompt }),
      })
      const d = await r.json()
      if (d.ok) {
        showToast(`"${newName}" added!`)
        setShowNewForm(false); setNewName(''); setNewSchedule(''); setNewPrompt(''); setNewDesc('')
        loadAll()
      } else showToast(`Error: ${d.error}`, 'error')
    } catch { showToast('Failed to create', 'error') }
    setSaving(false)
  }

  const toggleCustom = async (id: string, enabled: boolean) => {
    setCustomItems(prev => prev.map(a => a.id === id ? { ...a, enabled } : a))
    await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id, enabled }),
    })
    const name = customItems.find(a => a.id === id)?.name || id
    showToast(enabled ? `${name} turned ON ✅` : `${name} paused ⏸`)
  }

  const runCustom = async (id: string, name: string) => {
    setRunningId(id)
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_now', id }),
      })
      const d = await r.json()
      if (d.ok) { showToast(`✅ ${name} ran successfully`); loadAll() }
      else showToast(`Error: ${d.error}`, 'error')
    } catch { showToast('Run failed', 'error') }
    setRunningId(null)
  }

  const deleteCustom = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    showToast('Deleted')
    loadAll()
  }

  const fmtTime = (iso: string | null) => {
    if (!iso) return 'Never'
    const d = new Date(iso)
    const diffMins = Math.floor((Date.now() - d.getTime()) / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const systemOn = systemAutomations.filter(a => a.state.enabled).length
  const customOn = customItems.filter(a => a.enabled).length
  const totalOn = systemOn + customOn

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Automation Control</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {totalOn} automation{totalOn !== 1 ? 's' : ''} running — you control everything
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${totalOn > 0 ? 'bg-green-500/15 text-green-400' : 'bg-bg-hover text-text-muted'}`}>
            {totalOn > 0 ? `⚡ ${totalOn} Active` : '⏸ All Paused'}
          </span>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="btn btn-primary text-sm"
          >
            {showNewForm ? 'Cancel' : '+ Add Automation'}
          </button>
        </div>
      </div>

      {/* ── Add Automation Form ── */}
      {showNewForm && (
        <div className="bg-bg-card border border-blue/30 rounded-xl p-5 mb-8">
          <h2 className="text-base font-semibold mb-1">Add Your Own Automation</h2>
          <p className="text-xs text-text-muted mb-4">Tell the AI what to do and when — it runs automatically on your schedule</p>

          {/* Presets */}
          <div className="mb-4">
            <p className="text-xs font-medium text-text-secondary mb-2">Quick presets:</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setNewName(p.label); setNewSchedule(p.schedule); setNewPrompt(p.prompt) }}
                  className="text-xs px-3 py-1.5 bg-bg-hover rounded-lg border border-border hover:border-blue/40 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Name *</label>
              <input
                className="form-input w-full"
                placeholder="Morning Facebook Post"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Schedule *</label>
              <input
                className="form-input w-full"
                placeholder="8:00am · mon 9:00am · every 2h"
                value={newSchedule}
                onChange={e => setNewSchedule(e.target.value)}
              />
              <p className="text-xs text-text-muted mt-1">Daily: "8:00am" · Weekly: "mon 9:00am" · Repeating: "every 2h"</p>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs font-medium text-text-secondary mb-1 block">Description (optional)</label>
            <input className="form-input w-full" placeholder="Brief description" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          <div className="mb-5">
            <label className="text-xs font-medium text-text-secondary mb-1 block">Task — what should AI do? *</label>
            <textarea
              className="form-input w-full"
              rows={3}
              placeholder="Post to Facebook: Good morning Houston! Alpha International is open today. Expert repairs at fair prices. Call (713) 663-6979"
              value={newPrompt}
              onChange={e => setNewPrompt(e.target.value)}
            />
            <p className="text-xs text-text-muted mt-1">Write it exactly like you would type it in the AI chat</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={createCustom}
              disabled={saving || !newName || !newSchedule || !newPrompt}
              className="btn btn-primary"
            >
              {saving ? 'Adding...' : 'Add Automation'}
            </button>
            <button onClick={() => setShowNewForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-bg-card rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-10">

          {/* ── Built-In System Automations ── */}
          {CATEGORIES.map(cat => {
            const catAutomations = systemAutomations.filter(a => a.category === cat.id)
            if (catAutomations.length === 0) return null
            return (
              <section key={cat.id}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{cat.icon}</span>
                  <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-widest">{cat.label}</h2>
                  <div className="flex-1 h-px bg-border ml-2" />
                  <span className="text-xs text-text-muted">
                    {catAutomations.filter(a => a.state.enabled).length}/{catAutomations.length} on
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {catAutomations.map(auto => (
                    <SystemCard
                      key={auto.id}
                      auto={auto}
                      isRunning={runningId === auto.id}
                      isExpanded={expandedId === auto.id}
                      onExpand={() => setExpandedId(expandedId === auto.id ? null : auto.id)}
                      onToggle={toggleSystem}
                      onRun={runSystem}
                      onSaveConfig={saveSystemConfig}
                      fmtTime={fmtTime}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {/* ── Your Custom Automations ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">✏️</span>
              <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Your Custom Automations</h2>
              <div className="flex-1 h-px bg-border ml-2" />
              <span className="text-xs text-text-muted">{customItems.filter(a => a.enabled).length}/{customItems.length} on</span>
            </div>

            {customItems.length === 0 ? (
              <div className="bg-bg-card border border-dashed border-border rounded-xl p-8 text-center text-text-muted">
                <p className="text-2xl mb-2">✏️</p>
                <p className="text-sm font-medium">No custom automations yet</p>
                <p className="text-xs mt-1">Click "+ Add Automation" above to create your first one</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {customItems.map(item => (
                  <CustomCard
                    key={item.id}
                    item={item}
                    isRunning={runningId === item.id}
                    onToggle={toggleCustom}
                    onRun={runCustom}
                    onDelete={deleteCustom}
                    fmtTime={fmtTime}
                  />
                ))}
              </div>
            )}
          </section>

        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-sm font-medium z-50 shadow-lg transition-all ${toastType === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ── System Automation Card ─────────────────────────────────────────────────

interface SystemCardProps {
  auto: SystemAutomation
  isRunning: boolean
  isExpanded: boolean
  onExpand: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRun: (id: string, name: string) => void
  onSaveConfig: (id: string, config: Record<string, unknown>) => void
  fmtTime: (iso: string | null) => string
}

function SystemCard({ auto, isRunning, isExpanded, onExpand, onToggle, onRun, onSaveConfig, fmtTime }: SystemCardProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(auto.state.config || {})

  const setVal = (key: string, val: unknown) => setLocalConfig(prev => ({ ...prev, [key]: val }))

  const statusDot =
    auto.state.last_status === 'ok' ? 'bg-green-400' :
    auto.state.last_status === 'error' ? 'bg-red-400' : 'bg-gray-500'

  return (
    <div className={`bg-bg-card border rounded-xl overflow-hidden transition-all ${auto.state.enabled ? 'border-border' : 'border-border/40 opacity-65'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{auto.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-sm">{auto.name}</span>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} title={`Last status: ${auto.state.last_status}`} />
            </div>
            <p className="text-xs text-text-muted leading-relaxed">{auto.description}</p>
          </div>
          {/* Toggle switch */}
          <button
            onClick={() => onToggle(auto.id, !auto.state.enabled)}
            className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${auto.state.enabled ? 'bg-blue-500' : 'bg-gray-600'}`}
            title={auto.state.enabled ? 'Click to pause' : 'Click to enable'}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${auto.state.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3 text-xs text-text-muted flex-wrap">
          <span>🕐 {auto.schedule}</span>
          <span>·</span>
          <span>Last: {fmtTime(auto.state.last_run)}</span>
          {auto.state.run_count > 0 && <><span>·</span><span>{auto.state.run_count} runs</span></>}
        </div>

        {auto.requires && auto.requires.length > 0 && (
          <div className="mt-2 text-xs text-yellow-400 bg-yellow-400/10 rounded-lg px-2.5 py-1.5">
            ⚠️ Needs account connected in Settings → Integrations
          </div>
        )}

        {auto.state.last_status === 'error' && auto.state.last_result && (
          <div className="mt-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-2.5 py-1.5 truncate">
            ✗ {auto.state.last_result}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onRun(auto.id, auto.name)}
            disabled={isRunning}
            className="text-xs px-3 py-1.5 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 rounded-lg transition-colors disabled:opacity-50"
          >
            {isRunning ? '⏳ Running...' : '▶ Run Now'}
          </button>
          {auto.configFields.length > 0 && (
            <button
              onClick={onExpand}
              className="text-xs px-3 py-1.5 bg-bg-hover text-text-muted hover:text-white rounded-lg transition-colors"
            >
              {isExpanded ? '▲ Close' : '⚙ Settings'}
            </button>
          )}
        </div>
      </div>

      {isExpanded && auto.configFields.length > 0 && (
        <div className="border-t border-border bg-bg-hover px-4 py-4">
          <div className="grid grid-cols-1 gap-3">
            {auto.configFields.map(field => (
              <div key={field.key}>
                <label className="text-xs font-medium text-text-secondary block mb-1">{field.label}</label>
                {field.type === 'boolean' ? (
                  <input type="checkbox" checked={!!(localConfig[field.key] ?? field.default)} onChange={e => setVal(field.key, e.target.checked)} className="w-4 h-4" />
                ) : field.type === 'select' ? (
                  <select value={String(localConfig[field.key] ?? field.default)} onChange={e => setVal(field.key, e.target.value)} className="form-input w-full text-sm">
                    {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea value={String(localConfig[field.key] ?? field.default)} onChange={e => setVal(field.key, e.target.value)} rows={3} className="form-input w-full text-sm" />
                ) : (
                  <input type={field.type === 'number' ? 'number' : 'text'} value={String(localConfig[field.key] ?? field.default)} onChange={e => setVal(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)} className="form-input w-full text-sm" />
                )}
              </div>
            ))}
          </div>
          <button onClick={() => onSaveConfig(auto.id, localConfig)} className="mt-3 text-xs px-4 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            Save Settings
          </button>
        </div>
      )}
    </div>
  )
}

// ── Custom Automation Card ─────────────────────────────────────────────────

interface CustomCardProps {
  item: CustomAutomation
  isRunning: boolean
  onToggle: (id: string, enabled: boolean) => void
  onRun: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  fmtTime: (iso: string | null) => string
}

function CustomCard({ item, isRunning, onToggle, onRun, onDelete, fmtTime }: CustomCardProps) {
  const statusColor =
    item.status === 'completed' ? 'bg-green-400' :
    item.status === 'error' ? 'bg-red-400' :
    item.status === 'running' ? 'bg-yellow-400' : 'bg-gray-500'

  return (
    <div className={`bg-bg-card border rounded-xl overflow-hidden transition-all ${item.enabled ? 'border-border' : 'border-border/40 opacity-65'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5 flex-shrink-0">✏️</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-semibold text-sm">{item.name}</span>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
            </div>
            <p className="text-xs text-text-muted leading-relaxed line-clamp-2">{item.task_prompt}</p>
          </div>
          {/* Toggle switch */}
          <button
            onClick={() => onToggle(item.id, !item.enabled)}
            className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${item.enabled ? 'bg-blue-500' : 'bg-gray-600'}`}
            title={item.enabled ? 'Click to pause' : 'Click to enable'}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${item.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-3 text-xs text-text-muted flex-wrap">
          <span>🕐 {item.schedule}</span>
          <span>·</span>
          <span>Last: {fmtTime(item.last_run)}</span>
          {item.run_count > 0 && <><span>·</span><span>{item.run_count} runs</span></>}
        </div>

        {item.last_result && (
          <div className="mt-2 text-xs text-text-muted bg-bg-hover rounded-lg px-2.5 py-1.5 line-clamp-2">
            {item.last_result}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onRun(item.id, item.name)}
            disabled={isRunning}
            className="text-xs px-3 py-1.5 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 rounded-lg transition-colors disabled:opacity-50"
          >
            {isRunning ? '⏳ Running...' : '▶ Run Now'}
          </button>
          <button
            onClick={() => onDelete(item.id, item.name)}
            className="text-xs px-3 py-1.5 bg-bg-hover text-red-400 hover:bg-red-500/15 rounded-lg transition-colors ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
