'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Customer { id: string; name: string; phone: string; email: string; address: string; preferred_contact: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_plate: string; vehicle_mileage: string; notes: string; created_at: string; sentiment?: string }
interface TimelineEntry { id: string; type: 'sms'|'call'|'job'|'invoice'; direction?: string; body?: string; duration_secs?: number; status?: string; concern?: string; created_at: string; amount?: number }

const SENTIMENT_COLORS: Record<string,string> = { happy:'tag-green', neutral:'tag-gray', unhappy:'tag-red', vip:'tag-blue', 'at-risk':'tag-amber' }
const SENTIMENT_LABELS: Record<string,string> = { happy:'😊 Happy', neutral:'😐 Neutral', unhappy:'😞 Unhappy', vip:'⭐ VIP', 'at-risk':'⚠️ At Risk' }
const SENTIMENT_OPTIONS = ['happy','neutral','unhappy','vip','at-risk'] as const

function toTitleCase(str: string) {
  return str.replace(/\b\w/g, c => c.toUpperCase())
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<Customer>>({})
  const [search, setSearch] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [sendModal, setSendModal] = useState<{ customer: Customer; channel: 'sms'|'email' }|null>(null)
  const [sendBody, setSendBody] = useState('')
  const [sending, setSending] = useState(false)
  const [jobCounts, setJobCounts] = useState<Record<string,number>>({})
  const [activeTab, setActiveTab] = useState<'info'|'timeline'>('info')
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('customers').select('*').order('name')
      setCustomers((data || []) as Customer[])
      const { data: jobs } = await supabase.from('jobs').select('customer_id')
      const counts: Record<string,number> = {}
      ;(jobs || []).forEach((j: Record<string,string>) => { counts[j.customer_id] = (counts[j.customer_id]||0) + 1 })
      setJobCounts(counts)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('customers_page').on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const loadTimeline = useCallback(async (customer: Customer) => {
    setTimelineLoading(true)
    try {
      const phone = customer.phone?.replace(/\D/g,'')
      const name = customer.name?.toLowerCase()
      const results: TimelineEntry[] = []

      const [{ data: msgs }, { data: calls }, { data: jobs }, { data: invoices }] = await Promise.all([
        customer.phone
          ? supabase.from('messages').select('id,body,direction,created_at').or(`from_address.ilike.%${phone}%,to_address.ilike.%${phone}%`).order('created_at',{ascending:false}).limit(50)
          : Promise.resolve({ data: [] }),
        customer.phone
          ? supabase.from('call_history').select('id,direction,duration_secs,start_time,status').or(`from_number.ilike.%${phone}%,to_number.ilike.%${phone}%`).order('start_time',{ascending:false}).limit(30)
          : Promise.resolve({ data: [] }),
        supabase.from('jobs').select('id,concern,status,created_at').or(`customer_id.eq.${customer.id},customer_name.ilike.%${name}%`).order('created_at',{ascending:false}).limit(20),
        supabase.from('invoices').select('id,total,amount_paid,status,created_at').eq('customer_id',customer.id).order('created_at',{ascending:false}).limit(20)
      ])

      for (const m of (msgs||[])) results.push({ id: m.id, type: 'sms', direction: m.direction, body: m.body, created_at: m.created_at })
      for (const c of (calls||[])) results.push({ id: c.id, type: 'call', direction: c.direction, duration_secs: c.duration_secs, status: c.status, created_at: c.start_time })
      for (const j of (jobs||[])) results.push({ id: j.id, type: 'job', concern: j.concern, status: j.status, created_at: j.created_at })
      for (const inv of (invoices||[])) results.push({ id: inv.id, type: 'invoice', amount: inv.total, status: inv.status, created_at: inv.created_at })

      results.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setTimeline(results)
    } finally { setTimelineLoading(false) }
  }, [])

  const save = async () => {
    if (!form.name) return alert('Name required')
    const safeFields = ['name','phone','email','address','notes','preferred_contact','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage']
    const data: Record<string,unknown> = { updated_at: new Date().toISOString() }
    for (const k of safeFields) { if ((form as Record<string,string>)[k] !== undefined) data[k] = (form as Record<string,string>)[k] }
    const extended = ['sentiment','vehicle_color','vehicle_engine','last_contact','review_requested']
    for (const k of extended) { if ((form as Record<string,string>)[k] !== undefined) data[k] = (form as Record<string,string>)[k] }
    if (editing === 'new') {
      const { error } = await supabase.from('customers').insert({ ...data, created_at: new Date().toISOString() })
      if (error) { alert('Save failed: ' + error.message); return }
    } else if (editing) {
      const { error } = await supabase.from('customers').update(data).eq('id', editing)
      if (error) { alert('Save failed: ' + error.message); return }
    }
    setEditing(null); setForm({}); setActiveTab('info'); load()
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this customer?')) return
    await supabase.from('customers').delete().eq('id', editing)
    setEditing(null); setForm({}); setActiveTab('info'); load()
  }

  const openEdit = (c: Customer) => {
    setForm(c)
    setEditing(c.id)
    setActiveTab('info')
    loadTimeline(c)
  }

  const sendMsg = async () => {
    if (!sendModal || !sendBody) return
    setSending(true)
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendModal.channel === 'sms' ? sendModal.customer.phone : sendModal.customer.email, body: sendBody, channel: sendModal.channel, customerId: sendModal.customer.id })
      })
      if (!res.ok) throw new Error('Failed')
      setSendModal(null); setSendBody('')
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setSending(false) }
  }

  const filtered = customers.filter(c => {
    if (search && ![c.name, c.phone, c.email, c.vehicle_make, c.vehicle_model, c.vehicle_plate].some(v => (v||'').toLowerCase().includes(search.toLowerCase()))) return false
    if (sentimentFilter !== 'all' && (c.sentiment||'neutral') !== sentimentFilter) return false
    return true
  })

  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''
  const fmtTime = (d: string) => d ? new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : ''

  if (loading && customers.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-5 w-32 bg-bg-hover rounded mb-2" />
              <div className="h-3 w-48 bg-bg-hover rounded mb-4" />
              <div className="h-3 w-24 bg-bg-hover rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {editing !== null ? (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Customer' : form.name || 'Edit Customer'}</h1>
              {editing !== 'new' && <div className="text-sm text-text-muted mt-0.5">{jobCounts[editing]||0} jobs · Added {fmtDate((customers.find(c=>c.id===editing)?.created_at)||'')}</div>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}); setActiveTab('info') }}>← Back</button>
              <button className="btn btn-primary btn-sm" onClick={save}>Save Customer</button>
              {editing !== 'new' && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
            </div>
          </div>

          {editing !== 'new' && (
            <div className="flex gap-1 mb-6 bg-bg-card border border-border rounded-lg p-1 w-fit">
              <button className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'info' ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setActiveTab('info')}>Info</button>
              <button className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${activeTab === 'timeline' ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setActiveTab('timeline')}>
                Communication Timeline {timeline.length > 0 && <span className="ml-1 text-xs opacity-70">({timeline.length})</span>}
              </button>
            </div>
          )}

          {activeTab === 'info' ? (
            <div className="max-w-2xl space-y-6">
              <div className="card space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Contact Info</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Name *</label>
                    <input className="form-input" value={form.name||''} onChange={e => setForm(f=>({...f,name:toTitleCase(e.target.value)}))} placeholder="Full name" />
                  </div>
                  <div>
                    <label className="form-label">Phone</label>
                    <input className="form-input" value={form.phone||''} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="(713) 000-0000" />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email||''} onChange={e => setForm(f=>({...f,email:e.target.value}))} />
                  </div>
                  <div>
                    <label className="form-label">Preferred Contact</label>
                    <select className="form-select" value={form.preferred_contact||'Call'} onChange={e => setForm(f=>({...f,preferred_contact:e.target.value}))}>
                      {['Call','Text','Email'].map(v=><option key={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Address</label>
                  <input className="form-input" value={form.address||''} onChange={e => setForm(f=>({...f,address:e.target.value}))} />
                </div>
                <div>
                  <label className="form-label">Customer Sentiment</label>
                  <select className="form-select" value={form.sentiment||'neutral'} onChange={e => setForm(f=>({...f,sentiment:e.target.value}))}>
                    {SENTIMENT_OPTIONS.map(s=><option key={s} value={s}>{SENTIMENT_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
              <div className="card space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Vehicle Info</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {(['vehicle_year','vehicle_make','vehicle_model'] as const).map(k=>(
                    <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={form[k]||''} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} /></div>
                  ))}
                  {(['vehicle_vin','vehicle_plate','vehicle_mileage'] as const).map(k=>(
                    <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={form[k]||''} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} /></div>
                  ))}
                </div>
              </div>
              <div className="card">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
              </div>
            </div>
          ) : (
            /* Communication Timeline */
            <div className="max-w-2xl">
              {timelineLoading ? (
                <div className="card p-8 text-center text-text-muted animate-pulse">Loading timeline…</div>
              ) : timeline.length === 0 ? (
                <div className="card p-8 text-center text-text-muted">
                  <div className="text-4xl mb-3">📋</div>
                  <div className="text-lg font-semibold mb-1">No history yet</div>
                  <div className="text-sm">Messages, calls, and jobs will appear here</div>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />
                  <div className="space-y-4">
                    {timeline.map(entry => (
                      <div key={entry.id} className="relative flex gap-4 pl-12">
                        <div className={`absolute left-3 w-5 h-5 rounded-full flex items-center justify-center text-xs border-2 border-bg-base ${
                          entry.type === 'sms' ? 'bg-blue text-white' :
                          entry.type === 'call' ? 'bg-green text-white' :
                          entry.type === 'job' ? 'bg-amber text-white' :
                          'bg-purple-500 text-white'
                        }`}>
                          {entry.type === 'sms' ? '💬' : entry.type === 'call' ? '📞' : entry.type === 'job' ? '🔧' : '🧾'}
                        </div>
                        <div className="card flex-1 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                              {entry.type === 'sms' ? `SMS ${entry.direction || ''}` :
                               entry.type === 'call' ? `Call ${entry.direction || ''}` :
                               entry.type === 'job' ? 'Job' : 'Invoice'}
                            </div>
                            <div className="text-xs text-text-muted">{fmtTime(entry.created_at)}</div>
                          </div>
                          {entry.type === 'sms' && <div className="text-sm">{entry.body || '—'}</div>}
                          {entry.type === 'call' && (
                            <div className="text-sm text-text-muted">
                              {entry.duration_secs ? `${Math.round(entry.duration_secs)}s` : 'No duration'} · {entry.status || ''}
                            </div>
                          )}
                          {entry.type === 'job' && (
                            <div className="text-sm">
                              <span className="text-text-primary">{entry.concern || 'No concern noted'}</span>
                              {entry.status && <span className={`ml-2 tag text-xs tag-gray`}>{entry.status}</span>}
                            </div>
                          )}
                          {entry.type === 'invoice' && (
                            <div className="text-sm">
                              <span className="font-semibold">${(entry.amount||0).toFixed(2)}</span>
                              {entry.status && <span className={`ml-2 tag text-xs ${entry.status === 'Paid' ? 'tag-green' : 'tag-amber'}`}>{entry.status}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold">Customers <span className="text-text-muted text-lg font-normal ml-2">{customers.length}</span></h1>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input className="form-input w-full sm:w-64" placeholder="Search name, phone, vehicle…" value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-primary whitespace-nowrap" onClick={() => { setForm({ preferred_contact: 'Call', sentiment: 'neutral' }); setEditing('new') }}>+ New Customer</button>
            </div>
          </div>

          <div className="flex gap-2 mb-4 flex-wrap overflow-x-auto pb-1">
            <button onClick={() => setSentimentFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentimentFilter === 'all' ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>All</button>
            {SENTIMENT_OPTIONS.map(s => (
              <button key={s} onClick={() => setSentimentFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentimentFilter === s ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
                {SENTIMENT_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <div className="col-span-3 text-center py-16 text-text-muted">
                <div className="text-5xl mb-4">👤</div>
                <div className="text-lg font-semibold mb-2">{customers.length === 0 ? 'No customers yet' : 'No customers match your search'}</div>
                {customers.length === 0 && (
                  <button className="btn btn-primary mt-1" onClick={() => { setForm({ preferred_contact: 'Call', sentiment: 'neutral' }); setEditing('new') }}>+ Add First Customer</button>
                )}
              </div>
            )}
            {filtered.map(c => (
              <div key={c.id} className="card hover:border-blue/40 transition-colors cursor-pointer group" onClick={() => openEdit(c)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-text-primary flex items-center gap-2">
                      {c.name}
                      {c.sentiment && c.sentiment !== 'neutral' && (
                        <span className={`tag text-xs ${SENTIMENT_COLORS[c.sentiment]||'tag-gray'}`}>{SENTIMENT_LABELS[c.sentiment]||c.sentiment}</span>
                      )}
                    </div>
                    <div className="text-sm text-text-muted mt-0.5">{c.phone || 'No phone'}{c.email ? ` · ${c.email}` : ''}</div>
                  </div>
                  <span className="tag tag-blue text-xs">{c.preferred_contact||'Call'}</span>
                </div>
                {(c.vehicle_make||c.vehicle_model) && (
                  <div className="text-sm text-text-secondary mb-3">{[c.vehicle_year,c.vehicle_make,c.vehicle_model].filter(Boolean).join(' ')}</div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">{jobCounts[c.id]||0} jobs · Added {fmtDate(c.created_at)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {c.phone && <button className="btn btn-sm btn-secondary" onClick={async e => { e.stopPropagation(); try { await fetch('/api/make-call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:c.phone,name:c.name})}) } catch {} }}>📞</button>}
                    {c.phone && <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setSendModal({customer:c,channel:'sms'}); setSendBody('') }}>💬</button>}
                    {c.email && <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); setSendModal({customer:c,channel:'email'}); setSendBody('') }}>📧</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sendModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">{sendModal.channel === 'sms' ? '💬 Send SMS' : '📧 Send Email'}</h2>
            <p className="text-sm text-text-muted mb-4">To: <strong>{sendModal.customer.name}</strong> · {sendModal.channel === 'sms' ? sendModal.customer.phone : sendModal.customer.email}</p>
            <textarea className="form-input w-full mb-4" rows={4} value={sendBody} onChange={e => setSendBody(e.target.value)} placeholder="Your message..." />
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={sendMsg} disabled={sending||!sendBody}>{sending ? 'Sending…' : 'Send'}</button>
              <button className="btn btn-secondary" onClick={() => setSendModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
