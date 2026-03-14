'use client'
import { useEffect, useState, useCallback } from 'react'

interface Automation {
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

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSchedule, setNewSchedule] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadAutomations = useCallback(async () => {
    try {
      const r = await fetch('/api/automations')
      const d = await r.json()
      if (d.ok) setItems(d.data || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadAutomations() }, [loadAutomations])

  // Poll for due automations every 60 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await fetch('/api/automations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_due' }),
        })
        loadAutomations()
      } catch { /* ignore */ }
    }, 60000)
    return () => clearInterval(interval)
  }, [loadAutomations])

  const createAutomation = async () => {
    if (!newName || !newSchedule || !newPrompt) return
    setSaving(true)
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: newName,
          description: newDesc,
          schedule: newSchedule,
          task_prompt: newPrompt,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        showToast('Automation created!')
        setShowNew(false)
        setNewName(''); setNewSchedule(''); setNewPrompt(''); setNewDesc('')
        loadAutomations()
      } else {
        showToast(`Error: ${d.error}`)
      }
    } catch { showToast('Failed to create') }
    setSaving(false)
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id, enabled }),
    })
    loadAutomations()
  }

  const deleteAutomation = async (id: string) => {
    if (!confirm('Delete this automation?')) return
    await fetch('/api/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    showToast('Deleted')
    loadAutomations()
  }

  const runNow = async (id: string) => {
    setRunningId(id)
    try {
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_now', id }),
      })
      const d = await r.json()
      if (d.ok) {
        showToast('Automation executed!')
      } else {
        showToast(`Error: ${d.error}`)
      }
      loadAutomations()
    } catch { showToast('Run failed') }
    setRunningId(null)
  }

  const fmtTime = (iso: string | null) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const statusColor = (s: string) => {
    if (s === 'completed') return 'text-green-400'
    if (s === 'error') return 'text-red-400'
    if (s === 'running') return 'text-yellow-400'
    return 'text-text-muted'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="text-sm text-text-muted">Schedule tasks to run automatically — posts, lookups, messages, and more</p>
        </div>
        <button onClick={() => setShowNew(!showNew)} className="btn btn-primary">
          {showNew ? 'Cancel' : '+ New Automation'}
        </button>
      </div>

      {/* Create form */}
      {showNew && (
        <div className="bg-bg-card border border-border rounded-xl p-5 mb-6">
          <h2 className="text-lg font-semibold mb-4">Create Automation</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1 block">Name</label>
              <input className="form-input w-full" placeholder="Morning Facebook Post" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-text-secondary mb-1 block">Schedule</label>
              <input className="form-input w-full" placeholder="5:00am, mon 9:00, every 2h" value={newSchedule} onChange={e => setNewSchedule(e.target.value)} />
              <p className="text-xs text-text-muted mt-1">Examples: 5:00am (daily), mon 9:00am (weekly), every 2h (repeating)</p>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium text-text-secondary mb-1 block">Description (optional)</label>
            <input className="form-input w-full" placeholder="Brief description" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium text-text-secondary mb-1 block">Task Prompt</label>
            <textarea className="form-input w-full" rows={3} placeholder="What should Alpha AI do? e.g. 'Post to Facebook: Good morning Houston! Alpha International is open for business today...'" value={newPrompt} onChange={e => setNewPrompt(e.target.value)} />
            <p className="text-xs text-text-muted mt-1">Write exactly what you want AI to do, as if you were typing it in the AI chat</p>
          </div>
          <button onClick={createAutomation} disabled={saving || !newName || !newSchedule || !newPrompt} className="btn btn-primary">
            {saving ? 'Creating...' : 'Create Automation'}
          </button>
        </div>
      )}

      {/* Schedule presets */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Morning Post', schedule: '5:00am', prompt: 'Post to Facebook: Good morning Houston! Alpha International Auto Center is open and ready to serve you. Expert auto repair at fair prices. Call (713) 663-6979' },
          { label: 'Evening Reminder', schedule: '7:00pm', prompt: 'Check all open jobs and send a text reminder to customers whose cars are ready for pickup' },
          { label: 'Weekly Review', schedule: 'mon 8:00am', prompt: 'Get shop stats for last week and summarize revenue, jobs completed, and top services performed' },
          { label: 'Daily Check-In', schedule: '9:00am', prompt: 'List all open jobs and their current status. Flag any that have been pending for more than 3 days' },
        ].map(preset => (
          <button key={preset.label} onClick={() => {
            setShowNew(true)
            setNewName(preset.label)
            setNewSchedule(preset.schedule)
            setNewPrompt(preset.prompt)
          }} className="text-left p-3 rounded-xl border border-border bg-bg-card hover:border-blue/40 transition-all">
            <div className="text-sm font-medium">{preset.label}</div>
            <div className="text-xs text-text-muted mt-1">{preset.schedule}</div>
          </button>
        ))}
      </div>

      {/* Automation list */}
      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-bg-card rounded-xl animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p className="text-4xl mb-3">&#9201;</p>
          <p className="text-lg font-medium">No automations yet</p>
          <p className="text-sm">Create your first scheduled task above</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className={`bg-bg-card border border-border rounded-xl p-4 ${!item.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{item.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${item.enabled ? 'bg-green-500/15 text-green-400' : 'bg-bg-hover text-text-muted'}`}>
                      {item.enabled ? 'Active' : 'Paused'}
                    </span>
                    <span className={`text-xs ${statusColor(item.status)}`}>{item.status}</span>
                  </div>
                  <p className="text-sm text-text-muted mb-2 truncate">{item.task_prompt}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                    <span>Schedule: <span className="text-text-secondary font-medium">{item.schedule}</span></span>
                    <span>Next: <span className="text-text-secondary">{fmtTime(item.next_run)}</span></span>
                    <span>Last: <span className="text-text-secondary">{fmtTime(item.last_run)}</span></span>
                    <span>Runs: <span className="text-text-secondary">{item.run_count}</span></span>
                  </div>
                  {item.last_result && (
                    <p className="text-xs text-text-muted mt-2 bg-bg-hover rounded-lg p-2 line-clamp-2">{item.last_result}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => runNow(item.id)} disabled={runningId === item.id} className="btn btn-secondary btn-sm text-xs">
                    {runningId === item.id ? 'Running...' : 'Run Now'}
                  </button>
                  <button onClick={() => toggleEnabled(item.id, !item.enabled)} className="btn btn-secondary btn-sm text-xs">
                    {item.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => deleteAutomation(item.id)} className="btn btn-secondary btn-sm text-xs text-red-400 hover:bg-red-500/10">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green/90 text-white px-4 py-2 rounded-lg text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
