'use client'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { getShopId, supabase } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField } from '@/components/ListKit'

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch {}
  return addOpenAIOAuthHeaders(headers)
}

const STATUSES = ['New', 'Estimate Sent', 'Approved', 'In Repair', 'Supplement', 'Waiting on Customer', 'Ready for Pickup', 'Paid', 'Closed']
type Lamp = 'blue' | 'amber' | 'green' | 'off'
// Blue = in progress, amber = waiting on someone, green = done, grey = closed out.
const STATUS_LAMP: Record<string, Lamp> = {
  'New': 'blue',
  'Estimate Sent': 'blue',
  'Approved': 'blue',
  'In Repair': 'blue',
  'Supplement': 'amber',
  'Waiting on Customer': 'amber',
  'Ready for Pickup': 'green',
  'Paid': 'green',
  'Closed': 'off',
}
const lampOf = (status: string | undefined) => STATUS_LAMP[status || 'New'] || 'off'
const statusLabel = (s: string) => ({ 'Estimate Sent': 'Estimate sent', 'In Repair': 'In repair', 'Waiting on Customer': 'Waiting on customer', 'Ready for Pickup': 'Ready for pickup' } as Record<string, string>)[s] || s

type FilterKey = 'all' | 'open' | 'supplement' | 'deductible' | 'paid'

// Dollar text used inside the Alpha prompt. Kept as before: "N/A" tells the AI the value is missing.
const fmtForAi = (n: unknown) => n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'
const money = (n: unknown) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

interface ClaimMsg { role: 'user' | 'assistant'; content: string }
interface NoteEntry { id: string; date: string; type: string; text: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job = Record<string, any>

const carOf = (j: Job) => [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')

const notEntered = <span className="text-text-muted">Not entered</span>

function Lampword({ status }: { status: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold">
      <span className={`lamp lamp-${lampOf(status)}`} aria-hidden="true" />
      {statusLabel(status || 'New')}
    </span>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header"><h2 className="section-title">{title}</h2></div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export default function InsurancePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Job | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState('')
  const [loadError, setLoadError] = useState('')
  // AI Claim Assistant
  const [claimJob, setClaimJob] = useState<Job | null>(null)
  const [claimChat, setClaimChat] = useState<ClaimMsg[]>([])
  const [claimInput, setClaimInput] = useState('')
  const [claimLoading, setClaimLoading] = useState(false)
  const chatLog = useRef<HTMLDivElement>(null)
  // Communication log
  const [noteText, setNoteText] = useState('')
  const [noteType, setNoteType] = useState('Call')

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setJobs([]); setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      const { data, error } = await supabase.from('jobs').select('*').eq('shop_id', shopId).eq('is_insurance', true).order('created_at', { ascending: false })
      if (error) throw error
      setJobs((data || []) as Job[])
      setLoadError('')
    } catch {
      setLoadError('Your insurance claims could not be loaded. Check your connection and try again.')
    } finally { setLoaded(true) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('ins_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  useEffect(() => { const el = chatLog.current; if (el) el.scrollTop = el.scrollHeight }, [claimChat, claimLoading])
  // Opening or leaving a claim starts at the top of the page, not wherever the list was scrolled.
  useEffect(() => { document.getElementById('main')?.scrollTo(0, 0) }, [editing?.id])

  const isOpen = (j: Job) => !['Paid', 'Closed'].includes(j.status)
  const hasSupplement = (j: Job) => !!j.supplement_status && j.supplement_status !== 'None'
  const owesDeductible = (j: Job) => !!j.deductible && Number(j.deductible) > 0 && !j.deductible_collected

  const q = search.trim().toLowerCase()
  const matchesSearch = useCallback((j: Job) => {
    if (!q) return true
    return [j.customer_name, j.insurance_company, j.claim_number, j.vehicle_make, j.vehicle_model].some(v => (v || '').toLowerCase().includes(q))
  }, [q])

  // Open claims first, newest first within each group (the query already sorts by date).
  const filtered = useMemo(() => jobs.filter(j => {
    if (!matchesSearch(j)) return false
    if (filter === 'open') return isOpen(j)
    if (filter === 'supplement') return hasSupplement(j)
    if (filter === 'deductible') return owesDeductible(j)
    if (filter === 'paid') return !isOpen(j)
    return true
  }).sort((a, b) => (isOpen(b) ? 1 : 0) - (isOpen(a) ? 1 : 0)), [jobs, filter, matchesSearch])

  const counts = useMemo(() => ({
    all: jobs.length,
    open: jobs.filter(isOpen).length,
    supplement: jobs.filter(hasSupplement).length,
    deductible: jobs.filter(owesDeductible).length,
    paid: jobs.filter(j => !isOpen(j)).length,
  }), [jobs])

  // Summary numbers
  const openJobs = jobs.filter(isOpen)
  const totalApproved = openJobs.reduce((s, j) => s + (Number(j.approved_amount) || 0), 0)
  const totalDeductibleDue = openJobs.filter(j => !j.deductible_collected).reduce((s, j) => s + (Number(j.deductible) || 0), 0)
  const supplementPending = openJobs.filter(j => j.supplement_status && j.supplement_status !== 'None' && j.supplement_status !== 'Approved').length

  const saveJob = async (updates: Partial<Job>): Promise<boolean> => {
    if (!editing) return false
    setSaveState('saving')
    setSaveError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const { error } = await supabase.from('jobs').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', editing.id).eq('shop_id', shopId)
      if (error) throw error
      await load()
      const { data, error: reloadError } = await supabase.from('jobs').select('*').eq('id', editing.id).eq('shop_id', shopId).single()
      if (reloadError) throw reloadError
      if (data) setEditing(data as Job)
      setSaveState('saved')
      return true
    } catch (error) {
      setSaveState('idle')
      setSaveError('This change was not saved. ' + (error instanceof Error ? error.message : 'Check your connection and try again.'))
      return false
    }
  }

  const addNote = async () => {
    if (!noteText.trim() || !editing) return
    const notes: NoteEntry[] = editing.communication_log || []
    const newNote: NoteEntry = { id: crypto.randomUUID(), date: new Date().toISOString(), type: noteType, text: noteText.trim() }
    const ok = await saveJob({ communication_log: [newNote, ...notes] })
    if (ok) setNoteText('')
  }

  const deleteNote = async (noteId: string) => {
    if (!editing) return
    const notes: NoteEntry[] = (editing.communication_log || []).filter((n: NoteEntry) => n.id !== noteId)
    await saveJob({ communication_log: notes })
  }

  const openClaimAssistant = (job: Job) => {
    setClaimJob(job)
    setClaimChat([{ role: 'assistant', content: `I'm ready to help with the insurance claim for ${job.customer_name || 'this customer'}'s ${carOf(job) || 'vehicle'}.\n\nClaim number: ${job.claim_number || 'Not set'}\nInsurance: ${job.insurance_company || 'Not set'}\nApproved: ${fmtForAi(job.approved_amount)}\n\nHow can I help? I can:\n- Draft supplement requests\n- Write adjuster emails\n- Explain coverage questions\n- Prepare documentation` }])
    setClaimInput('')
  }
  const closeClaimAssistant = useCallback(() => setClaimJob(null), [])

  const sendClaimMsg = async () => {
    if (!claimInput.trim() || !claimJob) return
    const userMsg = claimInput.trim()
    setClaimInput('')
    const updated = [...claimChat, { role: 'user' as const, content: userMsg }]
    setClaimChat(updated)
    setClaimLoading(true)
    try {
      const jobContext = 'Insurance job context: Customer: ' + claimJob.customer_name +
        ', Vehicle: ' + carOf(claimJob) +
        ', Insurance: ' + (claimJob.insurance_company || 'unknown') +
        ', Claim #: ' + (claimJob.claim_number || 'N/A') +
        ', Adjuster: ' + (claimJob.adjuster || claimJob.adjuster_name || 'N/A') +
        ', Adjuster Phone: ' + (claimJob.adjuster_phone || 'N/A') +
        ', Approved: ' + fmtForAi(claimJob.approved_amount) +
        ', Deductible: ' + fmtForAi(claimJob.deductible) +
        ', Supplement status: ' + (claimJob.supplement_status || 'None') +
        ', Status: ' + (claimJob.status || 'N/A') +
        ', Notes: ' + (claimJob.inspection_notes || 'none')
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          message: jobContext + '\n\nUser request: ' + userMsg,
          history: claimChat.slice(-10),
          sessionId: 'insurance-' + claimJob.id,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'AI request failed')
      setClaimChat([...updated, { role: 'assistant', content: data.reply || 'Alpha could not write a reply. Try asking again.' }])
    } catch (error) {
      setClaimChat([...updated, { role: 'assistant', content: error instanceof Error ? error.message : 'Alpha could not be reached. Check your AI settings and try again.' }])
    } finally { setClaimLoading(false) }
  }

  const assistantSheet = (
    <Sheet open={!!claimJob} onClose={closeClaimAssistant} title="Ask Alpha about this claim" wide>
      {claimJob && (
        <div className="flex flex-col gap-3">
          <p className="-mt-2 text-text-secondary">{claimJob.customer_name || 'Customer'} · {claimJob.insurance_company || 'Insurance not entered'}{claimJob.claim_number ? ` · claim ${claimJob.claim_number}` : ''}</p>
          <div ref={chatLog} className="h-[min(55dvh,28rem)] space-y-3 overflow-y-auto rounded-md border border-border bg-bg-base p-3" role="log" aria-live="polite" aria-label="Conversation">
            {claimChat.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 ${m.role === 'user' ? 'bg-blue text-[rgb(var(--c-on-blue))]' : 'border border-border bg-bg-card text-text-primary'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {claimLoading && (
              <div className="flex justify-start">
                <div className="rounded-lg border border-border bg-bg-card px-3.5 py-2.5 text-text-secondary">Alpha is thinking…</div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <label htmlFor="claim-input" className="sr-only">Ask about this claim</label>
            <input id="claim-input" className="form-input flex-1" placeholder="Ask about this claim" value={claimInput}
              onChange={e => setClaimInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendClaimMsg() } }} />
            <button className="btn btn-primary" onClick={sendClaimMsg} disabled={claimLoading || !claimInput.trim()}><Icon name="send" className="h-5 w-5" />Send</button>
          </div>
        </div>
      )}
    </Sheet>
  )

  // ============ Claim detail ============
  if (editing) {
    const dedDue = owesDeductible(editing)
    return (
      <div className="page-container animate-fade-in">
        <button className="btn btn-ghost -ml-3 mb-1" onClick={() => { setEditing(null); setSaveError(''); setSaveState('idle') }}><Icon name="back" className="h-5 w-5" />All claims</button>
        <header className="page-header">
          <div className="min-w-0">
            <h1 className="page-title">{editing.customer_name || 'Insurance claim'}</h1>
            <p className="page-subtitle">{carOf(editing) || 'No vehicle on this claim'}</p>
          </div>
          <div className="toolbar">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[0.9375rem] text-text-secondary" role="status" aria-live="polite">
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? <><span className="lamp lamp-green" aria-hidden="true" />Saved</> : 'Changes save when you leave a field'}
            </span>
            <button className="btn btn-primary" onClick={() => openClaimAssistant(editing)}><Icon name="alpha" className="h-5 w-5" />Ask Alpha</button>
          </div>
        </header>

        {saveError && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red/60 bg-red/[0.08] p-3">
            <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
            <p className="flex-1">{saveError}</p>
            <button className="btn-icon -m-2" onClick={() => setSaveError('')} aria-label="Dismiss message"><Icon name="close" className="h-5 w-5" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-5">
            <Panel title="Claim status">
              <label htmlFor="claim-status" className="sr-only">Claim status</label>
              <select id="claim-status" className="form-select md:hidden" value={editing.status || 'New'} onChange={e => saveJob({ status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
              <div className="hidden md:block">
                <FilterChips label="Claim status" value={editing.status || 'New'} onChange={s => { if (s !== editing.status) saveJob({ status: s }) }} options={STATUSES.map(s => ({ key: s, label: statusLabel(s) }))} />
              </div>
            </Panel>

            <Panel title="Insurance and claim">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label className="form-label" htmlFor="f-ins">Insurance company</label>
                  <input id="f-ins" className="form-input" defaultValue={editing.insurance_company || ''} onBlur={e => { if (e.target.value !== (editing.insurance_company || '')) saveJob({ insurance_company: e.target.value }) }} /></div>
                <div><label className="form-label" htmlFor="f-claim">Claim number</label>
                  <input id="f-claim" className="form-input" defaultValue={editing.claim_number || ''} onBlur={e => { if (e.target.value !== (editing.claim_number || '')) saveJob({ claim_number: e.target.value }) }} /></div>
                <div><label className="form-label" htmlFor="f-loss">Loss date</label>
                  <input id="f-loss" className="form-input" type="date" defaultValue={editing.loss_date || ''} onChange={e => saveJob({ loss_date: e.target.value })} /></div>
                <div><label className="form-label" htmlFor="f-policy">Policy number</label>
                  <input id="f-policy" className="form-input" defaultValue={editing.policy_number || ''} onBlur={e => { if (e.target.value !== (editing.policy_number || '')) saveJob({ policy_number: e.target.value }) }} /></div>
              </div>
            </Panel>

            <Panel title="Adjuster">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div><label className="form-label" htmlFor="f-adj">Name</label>
                  <input id="f-adj" className="form-input" defaultValue={editing.adjuster || ''} onBlur={e => { if (e.target.value !== (editing.adjuster || '')) saveJob({ adjuster: e.target.value }) }} /></div>
                <div><label className="form-label" htmlFor="f-adjph">Phone</label>
                  <input id="f-adjph" className="form-input" type="tel" defaultValue={editing.adjuster_phone || ''} onBlur={e => { if (e.target.value !== (editing.adjuster_phone || '')) saveJob({ adjuster_phone: e.target.value }) }} /></div>
                <div><label className="form-label" htmlFor="f-adjem">Email</label>
                  <input id="f-adjem" className="form-input" type="email" defaultValue={editing.adjuster_email || ''} onBlur={e => { if (e.target.value !== (editing.adjuster_email || '')) saveJob({ adjuster_email: e.target.value }) }} /></div>
              </div>
            </Panel>

            <Panel title="Money">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label className="form-label" htmlFor="f-appr">Approved amount</label>
                  <input id="f-appr" className="form-input num" type="number" inputMode="decimal" step="0.01" defaultValue={editing.approved_amount || ''} onBlur={e => saveJob({ approved_amount: Number(e.target.value) || null })} /></div>
                <div><label className="form-label" htmlFor="f-ded">Deductible</label>
                  <input id="f-ded" className="form-input num" type="number" inputMode="decimal" step="0.01" defaultValue={editing.deductible || ''} onBlur={e => saveJob({ deductible: Number(e.target.value) || null })} /></div>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 sm:self-end">
                  <input type="checkbox" checked={editing.deductible_collected || false} onChange={e => saveJob({ deductible_collected: e.target.checked })} className="h-5 w-5 accent-blue" />
                  <span className="font-bold">Deductible collected</span>
                </label>
                <div><label className="form-label" htmlFor="f-dedpm">How the deductible was paid</label>
                  <select id="f-dedpm" className="form-select" value={editing.deductible_payment_method || ''} onChange={e => saveJob({ deductible_payment_method: e.target.value })}>
                    <option value="">Choose a method</option>
                    <option>Cash</option><option>Card</option><option>Zelle</option><option>Cash App</option><option>Check</option>
                  </select>
                </div>
              </div>
            </Panel>

            <Panel title="Supplement">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div><label className="form-label" htmlFor="f-sup">Supplement status</label>
                  <select id="f-sup" className="form-select" value={editing.supplement_status || 'None'} onChange={e => saveJob({ supplement_status: e.target.value })}>
                    <option>None</option><option>Requested</option><option>Submitted</option><option>Under Review</option><option>Approved</option><option>Denied</option>
                  </select>
                </div>
                <div><label className="form-label" htmlFor="f-supreq">Amount requested</label>
                  <input id="f-supreq" className="form-input num" type="number" inputMode="decimal" step="0.01" defaultValue={editing.supplement_amount_requested || ''} onBlur={e => saveJob({ supplement_amount_requested: Number(e.target.value) || null })} /></div>
                <div><label className="form-label" htmlFor="f-supappr">Amount approved</label>
                  <input id="f-supappr" className="form-input num" type="number" inputMode="decimal" step="0.01" defaultValue={editing.supplement_amount_approved || ''} onBlur={e => saveJob({ supplement_amount_approved: Number(e.target.value) || null })} /></div>
              </div>
            </Panel>

            <Panel title="Damage and repair notes">
              <label htmlFor="f-notes" className="sr-only">Damage and repair notes</label>
              <textarea id="f-notes" className="form-textarea" rows={4} defaultValue={editing.inspection_notes || ''}
                onBlur={e => { if (e.target.value !== (editing.inspection_notes || '')) saveJob({ inspection_notes: e.target.value }) }}
                placeholder="Damage description, parts needed, repair plan" />
            </Panel>
          </div>

          <div className="space-y-5">
            <section className="panel">
              <div className="panel-header"><h2 className="section-title">Summary</h2></div>
              <dl className="divide-y divide-border px-4 sm:px-5">
                {[
                  { k: 'Status', v: <Lampword status={editing.status} /> },
                  { k: 'Insurance', v: editing.insurance_company || notEntered },
                  { k: 'Claim number', v: editing.claim_number ? <span className="num">{editing.claim_number}</span> : notEntered },
                  { k: 'Loss date', v: editing.loss_date ? fmtDate(editing.loss_date) : notEntered },
                  { k: 'Approved', v: editing.approved_amount ? <span className="num font-bold">{money(editing.approved_amount)}</span> : notEntered },
                  { k: 'Deductible', v: editing.deductible
                    ? <span className="num inline-flex flex-wrap items-center justify-end gap-x-2"><span className="font-bold">{money(editing.deductible)}</span>{dedDue ? <span className="inline-flex items-center gap-1.5 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Not collected</span> : <span className="inline-flex items-center gap-1.5 font-bold text-green"><span className="lamp lamp-green" aria-hidden="true" />Collected</span>}</span>
                    : notEntered },
                  ...(hasSupplement(editing) ? [{ k: 'Supplement', v: <span className="font-bold">{editing.supplement_status}</span> }] : []),
                ].map(r => (
                  <div key={r.k} className="flex items-start justify-between gap-4 py-2.5">
                    <dt className="text-text-secondary">{r.k}</dt>
                    <dd className="text-right">{r.v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="panel">
              <div className="panel-header"><h2 className="section-title">Calls and notes</h2></div>
              <div className="panel-body">
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                  <div>
                    <label className="sr-only" htmlFor="note-type">Type of note</label>
                    <select id="note-type" className="form-select" value={noteType} onChange={e => setNoteType(e.target.value)}>
                      <option>Call</option><option>Email</option><option>Fax</option><option>Note</option><option>Text</option>
                    </select>
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="note-text">Note</label>
                    <input id="note-text" className="form-input" placeholder="Add a note" value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addNote() }} />
                  </div>
                </div>
                <button className="btn btn-secondary mt-2 w-full" onClick={addNote} disabled={!noteText.trim() || saveState === 'saving'}><Icon name="plus" className="h-5 w-5" />Add note</button>
                <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto">
                  {(editing.communication_log || []).length === 0 && (
                    <li className="py-3 text-center text-text-secondary">Nothing logged yet. Add each call or email with the adjuster so you can show what was agreed.</li>
                  )}
                  {(editing.communication_log || []).map((n: NoteEntry) => (
                    <li key={n.id} className="rounded-md border border-border bg-bg-base p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tag tag-gray !text-[0.8125rem]">{n.type}</span>
                          <span className="num text-[0.875rem] text-text-secondary">{new Date(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {new Date(n.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                        <button className="btn-icon -my-2 -mr-2.5" onClick={() => deleteNote(n.id)} aria-label={`Delete ${n.type.toLowerCase()} note`}><Icon name="trash" className="h-5 w-5" /></button>
                      </div>
                      <p className="mt-1">{n.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
        {assistantSheet}
      </div>
    )
  }

  // ============ Claims list ============
  const filtering = filter !== 'all' || !!q
  const firstLoad = !loaded && !loadError

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Insurance claims</h1>
          <p className="page-subtitle">Claims, adjusters, deductibles and supplements in one place.</p>
        </div>
        <SearchField className="w-full sm:w-80" label="Search claims" placeholder="Search claims" value={search} onChange={setSearch} />
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Claims could not load" message={loadError} onRetry={load} />}

      {loaded && !(loadError && jobs.length === 0) && jobs.length > 0 && (
        <>
          <dl className="panel mb-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4" aria-label="Claims summary">
            <div className="flex flex-col justify-center border-b border-r border-border px-4 py-3 sm:border-b-0">
              <dt className="text-[0.875rem] font-bold text-text-secondary">Open claims</dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{openJobs.length}</dd>
            </div>
            <div className="flex flex-col justify-center border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
              <dt className="text-[0.875rem] font-bold text-text-secondary">Approved on open claims</dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{money(totalApproved)}</dd>
            </div>
            <div className={`flex flex-col justify-center border-r border-border px-4 py-3 ${totalDeductibleDue > 0 ? 'bg-amber/[0.14]' : ''}`}>
              <dt className={`flex items-center gap-2 text-[0.875rem] font-bold ${totalDeductibleDue > 0 ? 'text-amber' : 'text-text-secondary'}`}>
                <span className={`lamp ${totalDeductibleDue > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Deductibles to collect
              </dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{money(totalDeductibleDue)}</dd>
            </div>
            <div className="flex flex-col justify-center px-4 py-3">
              <dt className="flex items-center gap-2 text-[0.875rem] font-bold text-text-secondary">
                <span className={`lamp ${supplementPending > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Supplements pending
              </dt>
              <dd className="display num mt-0.5 text-[1.5rem] font-bold leading-tight">{supplementPending}</dd>
            </div>
          </dl>

          <div className="mb-4">
            <FilterChips<FilterKey> scroll label="Show claims" value={filter} onChange={setFilter} options={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'open', label: 'Open', count: counts.open },
              { key: 'supplement', label: 'Supplement', count: counts.supplement },
              { key: 'deductible', label: 'Deductible due', count: counts.deductible },
              { key: 'paid', label: 'Paid or closed', count: counts.paid },
            ]} />
          </div>
        </>
      )}

      {firstLoad ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading claims" role="status">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-52" />)}
        </div>
      ) : loadError && jobs.length === 0 ? null : jobs.length === 0 ? (
        <EmptyBlock icon="shield" title="No insurance claims yet" action={<Link href="/jobs" className="btn btn-primary">Go to jobs</Link>}>
          A claim shows up here once a repair order is marked as an insurance job. Then you can track the adjuster, claim number, deductible and supplements.
        </EmptyBlock>
      ) : filtered.length === 0 ? (
        <EmptyBlock icon="search" title="No claims match" action={<button className="btn btn-secondary" onClick={() => { setFilter('all'); setSearch('') }}>Show all claims</button>}>
          {filter === 'deductible' ? 'No deductible is waiting to be collected.' : filter === 'supplement' ? 'No claim has a supplement right now.' : 'Try a different name or claim number.'}
        </EmptyBlock>
      ) : (
        <>
          {filtering && <p className="mb-2 text-[0.9375rem] text-text-secondary" aria-live="polite"><span className="num font-bold text-text-primary">{filtered.length}</span> {filtered.length === 1 ? 'claim' : 'claims'} shown</p>}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(j => (
              <li key={j.id} className={`rotag lamp-${lampOf(j.status) === 'off' ? 'off' : lampOf(j.status)}`}>
                <button type="button" className="block w-full text-left" onClick={() => setEditing(j)} aria-label={`Open claim for ${j.customer_name || 'unknown customer'}`}>
                  <span className="block min-w-0">
                    <span className="display block text-[1.125rem] font-bold leading-tight">{j.customer_name || 'Unknown customer'}</span>
                    <span className="block text-text-secondary">{carOf(j) || 'No vehicle'}</span>
                    <span className="mt-1 block"><Lampword status={j.status} /></span>
                  </span>
                  <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                    {[
                      { label: 'Insurance', value: j.insurance_company, none: 'Not entered' },
                      { label: 'Claim number', value: j.claim_number, none: 'Not entered' },
                      { label: 'Adjuster', value: j.adjuster, none: 'Not entered' },
                      { label: 'Supplement', value: hasSupplement(j) ? j.supplement_status : 'None', none: 'None' },
                    ].map(f => (
                      <span key={f.label} className="block min-w-0">
                        <span className="block text-[0.8125rem] text-text-secondary">{f.label}</span>
                        <span className={`block truncate ${f.value ? 'font-bold' : 'text-text-muted'}`}>{f.value || f.none}</span>
                      </span>
                    ))}
                    <span className="block">
                      <span className="block text-[0.8125rem] text-text-secondary">Approved</span>
                      <span className={`num block ${j.approved_amount ? 'font-bold' : 'text-text-muted'}`}>{j.approved_amount ? money(j.approved_amount) : 'Not entered'}</span>
                    </span>
                    <span className="block">
                      <span className="block text-[0.8125rem] text-text-secondary">Deductible</span>
                      <span className={`num block ${j.deductible ? 'font-bold' : 'text-text-muted'}`}>{j.deductible ? money(j.deductible) : 'None'}</span>
                    </span>
                  </span>
                  {owesDeductible(j) && (
                    <span className="mt-3 flex items-center gap-2 border-t border-border pt-2 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Deductible not collected</span>
                  )}
                  {j.inspection_notes && (
                    <span className="mt-2 block truncate text-[0.9375rem] text-text-secondary">{j.inspection_notes}</span>
                  )}
                </button>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-secondary flex-1 whitespace-nowrap px-3" onClick={() => openClaimAssistant(j)}><Icon name="alpha" className="h-5 w-5" />Ask Alpha</button>
                  <button className="btn btn-secondary flex-1 whitespace-nowrap px-3" onClick={() => setEditing(j)}>Open claim</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {assistantSheet}
    </div>
  )
}
