'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue/20 text-blue border-blue/20',
  'In Progress': 'bg-purple/20 text-purple border-purple/20',
  'Waiting on Customer': 'bg-amber/20 text-amber border-amber/20',
  'Ready for Pickup': 'bg-green/20 text-green border-green/20',
  'Paid': 'bg-gray-500/20 text-gray-400 border-gray-500/20',
}

const fmt = (n: unknown) => n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open Only' },
  { key: 'supplement', label: 'Supplement Pending' },
  { key: 'deductible', label: 'Deductible Outstanding' },
]

interface ClaimMsg { role: 'user' | 'assistant'; content: string }

export default function InsurancePage() {
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([])
  const [filter, setFilter] = useState('all')
  const [claimJob, setClaimJob] = useState<Record<string, unknown> | null>(null)
  const [claimChat, setClaimChat] = useState<ClaimMsg[]>([])
  const [claimInput, setClaimInput] = useState('')
  const [claimLoading, setClaimLoading] = useState(false)

  useEffect(() => {
    supabase.from('jobs').select('*').eq('is_insurance', true).order('created_at', { ascending: false })
      .then(({ data }) => setJobs((data || []) as Record<string, unknown>[]))
  }, [])

  const filtered = jobs.filter(j => {
    if (filter === 'open') return !['Paid', 'Closed'].includes(j.status as string)
    if (filter === 'supplement') return j.supplement_status && j.supplement_status !== 'None'
    if (filter === 'deductible') return j.deductible && Number(j.deductible) > 0
    return true
  })

  const openClaimAssistant = (job: Record<string, unknown>) => {
    setClaimJob(job)
    setClaimChat([{ role: 'assistant', content: `I'm ready to help with the insurance claim for **${job.customer_name || 'this customer'}**'s ${[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(' ') || 'vehicle'}.\n\nClaim #: ${job.claim_number || 'Not set'}\nInsurance: ${job.insurance_company || 'Not set'}\nApproved: ${fmt(job.approved_amount)}\n\nHow can I help? I can assist with:\n- Drafting supplement requests\n- Composing adjuster communications\n- Explaining coverage questions\n- Preparing documentation` }])
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
      const apiKey = (settings?.ai_api_key as string) || ''
      const model = (settings?.ai_model as string) || 'meta-llama/llama-3.3-70b-instruct:free'
      const baseUrl = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'
      if (!apiKey) { setClaimChat([...updated, { role: 'assistant', content: 'Please configure your AI API key in Settings first.' }]); return }

      const jobContext = `Insurance job context: Customer: ${claimJob.customer_name}, Vehicle: ${[claimJob.vehicle_year, claimJob.vehicle_make, claimJob.vehicle_model].filter(Boolean).join(' ')}, Insurance: ${claimJob.insurance_company || 'unknown'}, Claim #: ${claimJob.claim_number || 'N/A'}, Adjuster: ${claimJob.adjuster || 'N/A'}, Approved amount: ${fmt(claimJob.approved_amount)}, Deductible: ${fmt(claimJob.deductible)}, Supplement status: ${claimJob.supplement_status || 'None'}, Job status: ${claimJob.status}, Notes: ${claimJob.inspection_notes || 'none'}`

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `You are an insurance claims assistant for an auto body/repair shop. Help with claim documentation, supplement requests, adjuster communications, and coverage questions. Be professional and knowledgeable about auto insurance processes. ${jobContext}` },
            ...updated.map(m => ({ role: m.role, content: m.content }))
          ],
          max_tokens: 600,
        })
      })
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.'
      setClaimChat([...updated, { role: 'assistant', content: reply }])
    } catch { setClaimChat([...updated, { role: 'assistant', content: 'Error contacting AI. Check your settings.' }]) }
    finally { setClaimLoading(false) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Insurance Jobs</h1>
          <p className="text-text-muted text-sm mt-0.5">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f.key ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <div className="text-4xl mb-3">🛡️</div>
          <h3 className="font-semibold text-text-primary mb-1">No insurance jobs</h3>
          <p className="text-sm">Mark a job as an insurance job to track it here</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {filtered.map(j => (
            <div key={j.id as string} className="card hover:border-blue/40 transition-colors cursor-pointer block">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold">{(j.customer_name as string) || 'Unknown'}</div>
                  <div className="text-sm text-text-muted">{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md font-medium border ${STATUS_COLORS[j.status as string] || 'bg-gray-500/20 text-gray-400 border-gray-500/20'}`}>
                  {(j.status as string) || 'New'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Insurance', value: j.insurance_company as string },
                  { label: 'Claim #', value: j.claim_number as string },
                  { label: 'Adjuster', value: j.adjuster as string },
                  { label: 'Approved', value: fmt(j.approved_amount) },
                  { label: 'Deductible', value: fmt(j.deductible) },
                  { label: 'Supplement', value: (j.supplement_status as string) || 'None' },
                ].map(field => (
                  <div key={field.label}>
                    <div className="text-xs text-text-muted uppercase tracking-wide mb-0.5">{field.label}</div>
                    <div className="font-medium">{field.value || 'N/A'}</div>
                  </div>
                ))}
              </div>
              {j.inspection_notes && (
                <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">{j.inspection_notes as string}</div>
              )}
              <button className="btn btn-sm btn-secondary mt-3 w-full" onClick={(e) => { e.stopPropagation(); openClaimAssistant(j) }}>
                🤖 AI Claim Assistant
              </button>
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
                <p className="text-xs text-text-muted">{(claimJob.customer_name as string)} — {(claimJob.insurance_company as string) || 'Insurance'} #{(claimJob.claim_number as string) || 'N/A'}</p>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setClaimJob(null)}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {claimChat.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-blue text-white' : 'bg-bg-hover text-text-primary'}`}>
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
