'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Customer { id: string; name: string; phone: string; email: string; address: string; preferred_contact: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_plate: string; vehicle_mileage: string; notes: string; created_at: string; sentiment?: string }

const SENTIMENT_COLORS: Record<string, string> = {
  happy: 'tag-green',
  neutral: 'tag-gray',
  unhappy: 'tag-red',
  vip: 'tag-blue',
  'at-risk': 'tag-amber',
}

const SENTIMENT_LABELS: Record<string, string> = {
  happy: '😊 Happy',
  neutral: '😐 Neutral',
  unhappy: '😞 Unhappy',
  vip: '⭐ VIP',
  'at-risk': '⚠️ At Risk',
}

const SENTIMENT_OPTIONS = ['happy', 'neutral', 'unhappy', 'vip', 'at-risk'] as const

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Customer>>({})
  const [search, setSearch] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<string>('all')
  const [sendModal, setSendModal] = useState<{ customer: Customer; channel: 'sms'|'email' } | null>(null)
  const [sendBody, setSendBody] = useState(''); const [sending, setSending] = useState(false)
  const [jobCounts, setJobCounts] = useState<Record<string,number>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('customers').select('*').order('name')
    setCustomers((data || []) as Customer[])
    const { data: jobs } = await supabase.from('jobs').select('customer_id')
    const counts: Record<string,number> = {}
    ;(jobs || []).forEach((j: Record<string,string>) => { counts[j.customer_id] = (counts[j.customer_id]||0) + 1 })
    setJobCounts(counts)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('customers_page').on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const save = async () => {
    if (!form.name) return alert('Name required')
    const data = { ...form, updated_at: new Date().toISOString() }
    if (editing === 'new') await supabase.from('customers').insert({ ...data, created_at: new Date().toISOString() })
    else if (editing) await supabase.from('customers').update(data).eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this customer?')) return
    await supabase.from('customers').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const f = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const sendMsg = async () => {
    if (!sendModal || !sendBody) return
    setSending(true)
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: sendModal.channel === 'sms' ? sendModal.customer.phone : sendModal.customer.email,
          body: sendBody,
          channel: sendModal.channel,
          customerId: sendModal.customer.id,
        })
      })
      if (!res.ok) throw new Error('Failed')
      setSendModal(null); setSendBody('')
    } catch (e: unknown) { alert((e as Error).message) }
    finally { setSending(false) }
  }

  const filtered = customers.filter(c => {
    if (search && ![c.name, c.phone, c.email].some(v => (v||'').toLowerCase().includes(search.toLowerCase()))) return false
    if (sentimentFilter !== 'all' && (c.sentiment || 'neutral') !== sentimentFilter) return false
    return true
  })
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {editing !== null ? (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Customer' : 'Edit Customer'}</h1>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => { setEditing(null); setForm({}) }}>← Back</button>
              <button className="btn btn-primary" onClick={save}>Save Customer</button>
              {editing !== 'new' && <button className="btn btn-danger" onClick={del}>Delete</button>}
            </div>
          </div>
          <div className="max-w-2xl space-y-6">
            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Contact Info</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="form-label">Name *</label><input className="form-input" value={form.name||''} onChange={f('name')} /></div>
                <div><label className="form-label">Phone</label><input className="form-input" value={form.phone||''} onChange={f('phone')} /></div>
                <div><label className="form-label">Email</label><input className="form-input" type="email" value={form.email||''} onChange={f('email')} /></div>
                <div><label className="form-label">Preferred Contact</label>
                  <select className="form-select" value={form.preferred_contact||'Call'} onChange={f('preferred_contact')}>
                    {['Call','Text','Email'].map(v=><option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="form-label">Address</label><input className="form-input" value={form.address||''} onChange={f('address')} /></div>
              <div>
                <label className="form-label">Customer Sentiment</label>
                <select className="form-select" value={form.sentiment||'neutral'} onChange={f('sentiment')}>
                  {SENTIMENT_OPTIONS.map(s => <option key={s} value={s}>{SENTIMENT_LABELS[s]}</option>)}
                </select>
              </div>
            </div>
            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Vehicle Info</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(['vehicle_year','vehicle_make','vehicle_model'] as const).map(k => (
                  <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={form[k]||''} onChange={f(k)} /></div>
                ))}
                {(['vehicle_vin','vehicle_plate','vehicle_mileage'] as const).map(k => (
                  <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={form[k]||''} onChange={f(k)} /></div>
                ))}
              </div>
            </div>
            <div className="card">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" rows={3} value={form.notes||''} onChange={f('notes')} />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold">Customers <span className="text-text-muted text-lg font-normal ml-2">{customers.length}</span></h1>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input className="form-input w-full sm:w-56" placeholder="Search name, phone, email..." value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-primary whitespace-nowrap" onClick={() => { setForm({ preferred_contact: 'Call', sentiment: 'neutral' }); setEditing('new') }}>+ New Customer</button>
            </div>
          </div>

          {/* Sentiment filter */}
          <div className="flex gap-2 mb-4 flex-wrap overflow-x-auto pb-1">
            <button onClick={() => setSentimentFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentimentFilter === 'all' ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
              All
            </button>
            {SENTIMENT_OPTIONS.map(s => (
              <button key={s} onClick={() => setSentimentFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${sentimentFilter === s ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
                {SENTIMENT_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <div className="col-span-3 text-center py-16 text-text-muted">
                <div className="text-5xl mb-4">👤</div>
                <p className="text-lg">No customers yet</p>
              </div>
            )}
            {filtered.map(c => (
              <div key={c.id} className="card hover:border-blue/40 transition-colors cursor-pointer group" onClick={() => { setForm(c); setEditing(c.id) }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-text-primary flex items-center gap-2">
                      {c.name}
                      {c.sentiment && c.sentiment !== 'neutral' && (
                        <span className={`tag text-xs ${SENTIMENT_COLORS[c.sentiment] || 'tag-gray'}`}>{SENTIMENT_LABELS[c.sentiment] || c.sentiment}</span>
                      )}
                    </div>
                    <div className="text-sm text-text-muted mt-0.5">{c.phone || 'No phone'}{c.email ? ` · ${c.email}` : ''}</div>
                  </div>
                  <span className="tag tag-blue text-xs">{c.preferred_contact || 'Call'}</span>
                </div>
                {(c.vehicle_make || c.vehicle_model) && (
                  <div className="text-sm text-text-secondary mb-3">{[c.vehicle_year,c.vehicle_make,c.vehicle_model].filter(Boolean).join(' ')}</div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">{jobCounts[c.id] || 0} jobs · Added {fmtDate(c.created_at)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {c.phone && (
                      <button className="btn btn-sm btn-secondary" title="Call" onClick={async (e) => { e.stopPropagation(); try { await fetch('/api/make-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: c.phone, name: c.name }) }) } catch {} }}>📞</button>
                    )}
                    {c.phone && <button className="btn btn-sm btn-secondary" onClick={() => { setSendModal({ customer: c, channel: 'sms' }); setSendBody('') }}>💬</button>}
                    {c.email && <button className="btn btn-sm btn-secondary" onClick={() => { setSendModal({ customer: c, channel: 'email' }); setSendBody('') }}>📧</button>}
                    {c.email && <button className="btn btn-sm btn-secondary" onClick={() => { setSendModal({ customer: c, channel: 'email' }); setSendBody('') }}>📧</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick send modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-1">{sendModal.channel === 'sms' ? '💬 Send SMS' : '📧 Send Email'}</h2>
            <p className="text-sm text-text-muted mb-4">To: <strong>{sendModal.customer.name}</strong> · {sendModal.channel === 'sms' ? sendModal.customer.phone : sendModal.customer.email}</p>
            <textarea className="form-textarea w-full mb-4" rows={4} value={sendBody} onChange={e => setSendBody(e.target.value)} placeholder="Your message..." />
            <div className="flex gap-3">
              <button className="btn btn-primary flex-1" onClick={sendMsg} disabled={sending || !sendBody}>{sending ? 'Sending…' : 'Send'}</button>
              <button className="btn btn-secondary" onClick={() => setSendModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

