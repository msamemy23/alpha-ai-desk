'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const STATUSES = ['New', 'Estimate Sent', 'Approved', 'In Repair', 'Supplement', 'Waiting on Customer', 'Ready for Pickup', 'Paid', 'Closed']
const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue-500/20 text-blue-400 border-blue-500/20',
  'Estimate Sent': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/20',
  'Approved': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20',
  'In Repair': 'bg-purple-500/20 text-purple-400 border-purple-500/20',
  'Supplement': 'bg-orange-500/20 text-orange-400 border-orange-500/20',
  'Waiting on Customer': 'bg-amber-500/20 text-amber-400 border-amber-500/20',
  'Ready for Pickup': 'bg-green-500/20 text-green-400 border-green-500/20',
  'Paid': 'bg-gray-500/20 text-gray-400 border-gray-500/20',
  'Closed': 'bg-gray-600/20 text-gray-500 border-gray-600/20',
}
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'supplement', label: 'Supplement' },
  { key: 'deductible', label: 'Deductible Due' },
  { key: 'paid', label: 'Paid/Closed' },
]
const fmt = (n: unknown) => n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'
const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

interface ClaimMsg { role: 'user' | 'assistant'; content: string }
interface NoteEntry { id: string; date: string; type: string; text: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job = Record<string, any>

export default function InsurancePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Job | null>(null)
  const [saving, setSaving] = useState(false)
  // AI Claim Assistant
  const [claimJob, setClaimJob] = useState<Job | null>(null)
  const [claimChat, setClaimChat] = useState<ClaimMsg[]>([])
  const [claimInput, setClaimInput] = useState('')
  const [claimLoading, setClaimLoading] = useState(false)
  // Communication log
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('Call')

  const load = useCallback(async () => {
    const { data } = await supabase.from('jobs').select('*').eq('is_insurance', true).order('created_at', { ascending: false })
    setJobs((data || []) as Job[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('ins_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const filtered = jobs.filter(j => {
    if (search) {
      const s = search.toLowerCase()
      const match = [j.customer_name, j.insurance_company, j.claim_number, j.vehicle_make, j.vehicle_model].some(v => (v || '').toLowerCase().includes(s))
      if (!match) return false
    }
    if (filter === 'open') return !['Paid', 'Closed'].includes(j.status)
    if (filter === 'supplement') return j.supplement_status && j.supplement_status !== 'None'
    if (filter === 'deductible') return j.deductible && Number(j.deductible) > 0 && !j.deductible_collected
    if (filter === 'paid') return ['Paid', 'Closed'].includes(j.status)
    return true
  })

  // KPI calculations
  const openJobs = jobs.filter(j => !['Paid', 'Closed'].includes(j.status))
  const totalApproved = openJobs.reduce((s, j) => s + (Number(j.approved_amount) || 0), 0)
  const totalDeductibleDue = openJobs.filter(j => !j.deductible_collected).reduce((s, j) => s + (Number(j.deductible) || 0), 0)
  const supplementPending = openJobs.filter(j => j.supplement_status && j.supplement_status !== 'None' && j.supplement_status !== 'Approved').length

  const saveJob = async (updates: Partial<Job>) => {
    if (!editing) return
    setSaving(true)
    try {
      await supabase.from('jobs').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', editing.id)
      await load()
      const { data } = await supabase.from('jobs').select('*').eq('id', editing.id).single()
      if (data) setEditing(data as Job)
    } finally { setSaving(false) }
  }

  const addNote = async () => {
    if (!noteText.trim() || !editing) return
    const notes: NoteEntry[] = editing.communication_log || []
    const newNote: NoteEntry = { id: crypto.randomUUID(), date: new Date().toISOString(), type: noteType, text: noteText.trim() }
    await saveJob({ communication_log: [newNote, ...notes] })
    setNoteText('')
  }

  const deleteNote = async (noteId: string) => {
    if (!editing) return
    const notes: NoteEntry[] = (editing.communication_log || []).filter((n: NoteEntry) => n.id !== noteId)
    await saveJob({ communication_log: notes })
  }

  const openClaimAssistant = (job: Job) => {
    setClaimJob(job)
    setClaimChat([{ role: 'assistant', content: `I'm ready to help with the insurance claim for **${job.customer_name || 'this customer'}**'s ${[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(' ') || 'vehicle'}.\n\nClaim #: ${job.claim_number || 'Not set'}\nInsurance: ${job.insurance_company || 'Not set'}\nApproved: ${fmt(job.approved_amount)}\n\nHow can I help? I can:\n- Draft supplement requests\n- Write adjuster emails\n- Explain coverage questions\n- Prepare documentation` }])
    setClaimInput('')
  }

  const sendClaimMsg = async () => {
    if (!claimInput.trim() || !claimJob) return
    const userMsg = claimInput.trim()
    setClaimInput('')
    const updated = [...claimChat, { role: 'user' as const, content: userMsg }]
    setClaimChat(updated)
    setClaimLoading(true)
    try {
      const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = (settings?.ai_api_key as string) || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || ''
      const model = (settings?.ai_model as string) || 'meta-llama/llama-3.3-70b-instruct:free'
      const baseUrl = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'
      if (!apiKey) { setClaimChat([...updated, { role: 'assistant', content: 'Please configure your AI API key in Settings first.' }]); return }
      const jobContext = `Insurance job context: Customer: ${claimJob.customer_name}, Vehicle: ${[claimJob.vehicle_year, claimJob.vehicle_make, claimJob.vehicle_model].filter(Boolean).join(' ')}, Insurance: ${claimJob.insurance_company || 'unknown'}, Claim #: ${claimJob.claim_number || 'N/A'}, Adjuster: ${claimJob.adjuster || 'N/A'}, Adjuster Phone: ${claimJob.adjuster_phone || 'N/A'}, Adjuster Email: ${claimJob.adjuster_email || 'N/A'}, Approved: ${fmt(claimJob.approved_amount)}, Deductible: ${fmt(claimJob.deductible)}, Supplement status: ${claimJob.supplement_status || 'None'}, Supplement requested: ${fmt(claimJob.supplement_amount_requested)}, Status: ${claimJob.status}, Loss date: ${claimJob.loss_date || 'N/A'}, Notes: ${claimJob.inspection_notes || 'none'}`
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `You are an insurance claims assistant for Alpha International Auto Center, an auto body/repair shop in Houston TX. Help with claim documentation, supplement requests, adjuster communications, and coverage questions. Be professional and knowledgeable. ${jobContext}` },
            ...updated.map(m => ({ role: m.role, content: m.content }))
          ],
          max_tokens: 800,
        })
      })
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.'
      setClaimChat([...updated, { role: 'assistant', content: reply }])
    } catch { setClaimChat([...updated, { role: 'assistant', content: 'Error contacting AI. Check settings.' }]) }
    finally { setClaimLoading(false) }
  }

  // === RENDER ===
  if (editing) return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">{editing.customer_name || 'Insurance Claim'}</h1>
          <p className="text-text-muted text-sm">{[editing.vehicle_year, editing.vehicle_make, editing.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>← Back</button>
          <button className="btn btn-primary" onClick={() => openClaimAssistant(editing)}>🤖 AI Assistant</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Claim Details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status Pipeline */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Claim Status</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map(s => (
                <button key={s} onClick={() => saveJob({ status: s })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    editing.status === s
                      ? STATUS_COLORS[s] || 'bg-gray-500/20 text-gray-400 border-gray-500/20'
                      : 'bg-bg-hover text-text-muted border-border hover:border-text-muted'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Insurance & Claim Info */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Insurance Info</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><label className="form-label">Insurance Company</label>
                <input className="form-input" defaultValue={editing.insurance_company || ''} onBlur={e => { if (e.target.value !== (editing.insurance_company || '')) saveJob({ insurance_company: e.target.value }) }} /></div>
              <div><label className="form-label">Claim #</label>
                <input className="form-input" defaultValue={editing.claim_number || ''} onBlur={e => { if (e.target.value !== (editing.claim_number || '')) saveJob({ claim_number: e.target.value }) }} /></div>
              <div><label className="form-label">Loss Date</label>
                <input className="form-input" type="date" defaultValue={editing.loss_date || ''} onChange={e => saveJob({ loss_date: e.target.value })} /></div>
              <div><label className="form-label">Policy #</label>
                <input className="form-input" defaultValue={editing.policy_number || ''} onBlur={e => { if (e.target.value !== (editing.policy_number || '')) saveJob({ policy_number: e.target.value }) }} /></div>
            </div>
          </div>

          {/* Adjuster Info */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Adjuster Contact</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="form-label">Adjuster Name</label>
                <input className="form-input" defaultValue={editing.adjuster || ''} onBlur={e => { if (e.target.value !== (editing.adjuster || '')) saveJob({ adjuster: e.target.value }) }} /></div>
              <div><label className="form-label">Adjuster Phone</label>
                <input className="form-input" type="tel" defaultValue={editing.adjuster_phone || ''} onBlur={e => { if (e.target.value !== (editing.adjuster_phone || '')) saveJob({ adjuster_phone: e.target.value }) }} /></div>
              <div><label className="form-label">Adjuster Email</label>
                <input className="form-input" type="email" defaultValue={editing.adjuster_email || ''} onBlur={e => { if (e.target.value !== (editing.adjuster_email || '')) saveJob({ adjuster_email: e.target.value }) }} /></div>
            </div>
          </div>

          {/* Financial */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Financials</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><label className="form-label">Approved Amount</label>
                <input className="form-input" type="number" step="0.01" defaultValue={editing.approved_amount || ''} onBlur={e => saveJob({ approved_amount: Number(e.target.value) || null })} /></div>
              <div><label className="form-label">Deductible</label>
                <input className="form-input" type="number" step="0.01" defaultValue={editing.deductible || ''} onBlur={e => saveJob({ deductible: Number(e.target.value) || null })} /></div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editing.deductible_collected || false} onChange={e => saveJob({ deductible_collected: e.target.checked })} className="w-4 h-4" />
                  <span className="text-sm font-medium">Deductible Collected</span>
                </label>
              </div>
              <div><label className="form-label">Deductible Payment Method</label>
                <select className="form-select" value={editing.deductible_payment_method || ''} onChange={e => saveJob({ deductible_payment_method: e.target.value })}>
                  <option value="">Select...</option>
                  <option>Cash</option><option>Card</option><option>Zelle</option><option>Cash App</option><option>Check</option>
                </select>
              </div>
            </div>
          </div>

          {/* Supplement */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Supplement</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="form-label">Supplement Status</label>
                <select className="form-select" value={editing.supplement_status || 'None'} onChange={e => saveJob({ supplement_status: e.target.value })}>
                  <option>None</option><option>Requested</option><option>Submitted</option><option>Under Review</option><option>Approved</option><option>Denied</option>
                </select>
              </div>
              <div><label className="form-label">Amount Requested</label>
                <input className="form-input" type="number" step="0.01" defaultValue={editing.supplement_amount_requested || ''} onBlur={e => saveJob({ supplement_amount_requested: Number(e.target.value) || null })} /></div>
              <div><label className="form-label">Amount Approved</label>
                <input className="form-input" type="number" step="0.01" defaultValue={editing.supplement_amount_approved || ''} onBlur={e => saveJob({ supplement_amount_approved: Number(e.target.value) || null })} /></div>
            </div>
          </div>

          {/* Inspection Notes */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Inspection Notes</div>
            <textarea className="form-textarea w-full" rows={4} defaultValue={editing.inspection_notes || ''}
              onBlur={e => { if (e.target.value !== (editing.inspection_notes || '')) saveJob({ inspection_notes: e.target.value }) }}
              placeholder="Damage description, parts needed, repair plan..." />
          </div>
        </div>

        {/* Right column - Communication Log */}
        <div className="space-y-4">
          {/* Quick Info Card */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Summary</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Status</span><span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[editing.status] || ''}`}>{editing.status || 'New'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Insurance</span><span className="font-medium">{editing.insurance_company || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Claim #</span><span className="font-mono text-xs">{editing.claim_number || 'N/A'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Approved</span><span className="font-semibold text-green-400">{fmt(editing.approved_amount)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Deductible</span><span className={editing.deductible_collected ? 'text-text-muted line-through' : 'font-semibold text-red-400'}>{fmt(editing.deductible)}</span></div>
              {editing.supplement_status && editing.supplement_status !== 'None' && (
                <div className="flex justify-between"><span className="text-text-muted">Supplement</span><span className="font-medium text-orange-400">{editing.supplement_status}</span></div>
              )}
            </div>
          </div>

          {/* Communication Log */}
          <div className="card">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">📞 Communication Log</div>
            <div className="flex gap-2 mb-3">
              <select className="form-select text-sm flex-shrink-0 w-24" value={noteType} onChange={e => setNoteType(e.target.value)}>
                <option>Call</option><option>Email</option><option>Fax</option><option>Note</option><option>Text</option>
              </select>
              <input className="form-input text-sm flex-1" placeholder="Add note..." value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNote() }} />
              <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!noteText.trim()}>+</button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(editing.communication_log || []).length === 0 && (
                <p className="text-xs text-text-muted text-center py-4">No communication logged yet</p>
              )}
              {(editing.communication_log || []).map((n: NoteEntry) => (
                <div key={n.id} className="bg-bg-hover rounded-lg p-2.5 text-sm group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-bg-card border border-border">{n.type}</span>
                      <span className="text-xs text-text-muted">{new Date(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(n.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <button className="text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deleteNote(n.id)}>✕</button>
                  </div>
                  <p className="text-text-primary text-sm">{n.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {saving && <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg text-sm shadow-lg animate-pulse">Saving...</div>}
    </div>
  )

  // === MAIN LIST VIEW ===
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="card text-center">
          <div className="text-2xl font-bold text-text-primary">{openJobs.length}</div>
          <div className="text-xs text-text-muted uppercase tracking-wider">Open Claims</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green-400">{fmt(totalApproved)}</div>
          <div className="text-xs text-text-muted uppercase tracking-wider">Total Approved</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-red-400">{fmt(totalDeductibleDue)}</div>
          <div className="text-xs text-text-muted uppercase tracking-wider">Deductible Due</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-orange-400">{supplementPending}</div>
          <div className="text-xs text-text-muted uppercase tracking-wider">Supplements Pending</div>
        </div>
      </div>

      {/* Header + Search + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Insurance Claims</h1>
          <p className="text-text-muted text-sm mt-0.5">{filtered.length} claim{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <input className="form-input w-full sm:w-64" placeholder="Search claims..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f.key ? 'bg-blue-500 text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Claims Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <div className="text-4xl mb-3">🛡️</div>
          <h3 className="font-semibold text-text-primary mb-1">No insurance claims</h3>
          <p className="text-sm">Mark a job as an insurance job to track it here</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))' }}>
          {filtered.map(j => (
            <div key={j.id} onClick={() => setEditing(j)}
              className="card hover:border-blue-500/40 transition-colors cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-text-primary">{j.customer_name || 'Unknown'}</div>
                  <div className="text-sm text-text-muted">{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md font-medium border ${STATUS_COLORS[j.status] || 'bg-gray-500/20 text-gray-400 border-gray-500/20'}`}>
                  {j.status || 'New'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Insurance', value: j.insurance_company },
                  { label: 'Claim #', value: j.claim_number },
                  { label: 'Adjuster', value: j.adjuster },
                  { label: 'Approved', value: fmt(j.approved_amount) },
                  { label: 'Deductible', value: fmt(j.deductible) },
                  { label: 'Supplement', value: j.supplement_status || 'None' },
                ].map(field => (
                  <div key={field.label}>
                    <div className="text-xs text-text-muted uppercase tracking-wide mb-0.5">{field.label}</div>
                    <div className="font-medium">{field.value || 'N/A'}</div>
                  </div>
                ))}
              </div>
              {j.deductible && !j.deductible_collected && (
                <div className="mt-3 pt-2 border-t border-border text-xs text-red-400 font-medium">⚠️ Deductible not collected</div>
              )}
              {j.inspection_notes && (
                <div className="mt-2 pt-2 border-t border-border text-xs text-text-muted truncate">{j.inspection_notes}</div>
              )}
              <div className="flex gap-2 mt-3">
                <button className="btn btn-sm btn-secondary flex-1" onClick={e => { e.stopPropagation(); openClaimAssistant(j) }}>🤖 AI Assistant</button>
                <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setEditing(j) }}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Claim Assistant Modal */}
      {claimJob && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-2xl h-[90vh] sm:h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h2 className="font-bold">🤖 AI Claim Assistant</h2>
                <p className="text-xs text-text-muted">{claimJob.customer_name} — {claimJob.insurance_company || 'Insurance'} #{claimJob.claim_number || 'N/A'}</p>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setClaimJob(null)}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {claimChat.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-bg-hover text-text-primary'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {claimLoading && (
                <div className="flex justify-start">
                  <div className="bg-bg-hover rounded-xl px-4 py-2 text-sm text-text-muted">Thinking...</div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex gap-2">
              <input className="form-input flex-1" placeholder="Ask about this claim..." value={claimInput}
                onChange={e => setClaimInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendClaimMsg() }}} />
              <button className="btn btn-primary" onClick={sendClaimMsg} disabled={claimLoading || !claimInput.trim()}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
