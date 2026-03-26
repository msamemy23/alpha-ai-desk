'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface DVIItem {
  name: string
  status: 'green' | 'yellow' | 'red' | null
  note: string
  photo?: string
}
interface DVISection {
  title: string
  items: DVIItem[]
}
interface DVI {
  id: string
  job_id: string | null
  customer_name: string
  vehicle: string
  tech: string
  sections: DVISection[]
  overall_status: string
  tech_notes: string
  sent_to_customer: boolean
  sent_at: string | null
  customer_approved: boolean
  created_at: string
  updated_at: string
}

const DEFAULT_SECTIONS: DVISection[] = [
  {
    title: 'Underhood',
    items: [
      { name: 'Engine Oil Level & Condition', status: null, note: '' },
      { name: 'Coolant Level & Condition', status: null, note: '' },
      { name: 'Brake Fluid Level', status: null, note: '' },
      { name: 'Power Steering Fluid', status: null, note: '' },
      { name: 'Transmission Fluid', status: null, note: '' },
      { name: 'Air Filter', status: null, note: '' },
      { name: 'Drive Belts', status: null, note: '' },
      { name: 'Battery & Cables', status: null, note: '' },
      { name: 'Hoses & Clamps', status: null, note: '' },
    ]
  },
  {
    title: 'Brakes',
    items: [
      { name: 'Front Brake Pads', status: null, note: '' },
      { name: 'Rear Brake Pads', status: null, note: '' },
      { name: 'Front Rotors', status: null, note: '' },
      { name: 'Rear Rotors', status: null, note: '' },
      { name: 'Brake Lines', status: null, note: '' },
      { name: 'Parking Brake', status: null, note: '' },
    ]
  },
  {
    title: 'Tires & Wheels',
    items: [
      { name: 'Left Front Tire', status: null, note: '' },
      { name: 'Right Front Tire', status: null, note: '' },
      { name: 'Left Rear Tire', status: null, note: '' },
      { name: 'Right Rear Tire', status: null, note: '' },
      { name: 'Tire Pressure', status: null, note: '' },
      { name: 'Wheel Condition', status: null, note: '' },
    ]
  },
  {
    title: 'Suspension & Steering',
    items: [
      { name: 'Shocks / Struts', status: null, note: '' },
      { name: 'Ball Joints', status: null, note: '' },
      { name: 'Tie Rods', status: null, note: '' },
      { name: 'CV Axles / Boots', status: null, note: '' },
      { name: 'Alignment Condition', status: null, note: '' },
    ]
  },
  {
    title: 'Exterior & Lights',
    items: [
      { name: 'Headlights', status: null, note: '' },
      { name: 'Taillights & Brake Lights', status: null, note: '' },
      { name: 'Turn Signals', status: null, note: '' },
      { name: 'Wipers', status: null, note: '' },
      { name: 'Exhaust', status: null, note: '' },
    ]
  },
]

const STATUS_STYLE: Record<string, string> = {
  green: 'bg-green/20 border-green text-green',
  yellow: 'bg-amber/20 border-amber text-amber',
  red: 'bg-red/20 border-red text-red',
}

export default function DVIPage() {
  const [inspections, setInspections] = useState<DVI[]>([])
  const [customers, setCustomers] = useState<{id:string;name:string;phone:string;vehicle_year:string;vehicle_make:string;vehicle_model:string}[]>([])
  const [jobs, setJobs] = useState<{id:string;customer_name:string;vehicle_year:string;vehicle_make:string;vehicle_model:string;ro_number:string}[]>([])
  const [techs, setTechs] = useState<string[]>(['Unassigned'])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<DVI>>({})
  const [sections, setSections] = useState<DVISection[]>([])
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activePhotoItem, setActivePhotoItem] = useState<{secIdx:number;itemIdx:number}|null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('dvi').select('*').order('created_at', { ascending: false })
      setInspections((data || []) as DVI[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r=>r.json()).then(d=>{ if(d.ok&&d.staff) setTechs(['Unassigned',...d.staff.map((s:{name:string})=>s.name)]) }).catch(()=>{})
    supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model').order('name').then(({data})=>setCustomers((data||[]) as typeof customers))
    supabase.from('jobs').select('id,customer_name,vehicle_year,vehicle_make,vehicle_model,ro_number').order('created_at',{ascending:false}).limit(200).then(({data})=>setJobs((data||[]) as typeof jobs))
  }, [load])

  const openNew = () => {
    setForm({ overall_status: 'pending', sent_to_customer: false, customer_approved: false })
    setSections(JSON.parse(JSON.stringify(DEFAULT_SECTIONS)))
    setEditing('new')
  }

  const openEdit = (d: DVI) => {
    setForm(d)
    setSections(Array.isArray(d.sections) ? JSON.parse(JSON.stringify(d.sections)) : JSON.parse(JSON.stringify(DEFAULT_SECTIONS)))
    setEditing(d.id)
  }

  const updateItemStatus = (secIdx: number, itemIdx: number, status: DVIItem['status']) => {
    setSections(prev => prev.map((sec, si) => si !== secIdx ? sec : {
      ...sec,
      items: sec.items.map((item, ii) => ii !== itemIdx ? item : { ...item, status })
    }))
  }

  const updateItemNote = (secIdx: number, itemIdx: number, note: string) => {
    setSections(prev => prev.map((sec, si) => si !== secIdx ? sec : {
      ...sec,
      items: sec.items.map((item, ii) => ii !== itemIdx ? item : { ...item, note })
    }))
  }

  const handlePhoto = (secIdx: number, itemIdx: number) => {
    setActivePhotoItem({ secIdx, itemIdx })
    fileInputRef.current?.click()
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activePhotoItem || !e.target.files?.[0]) return
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = (ev) => {
      const { secIdx, itemIdx } = activePhotoItem
      setSections(prev => prev.map((sec, si) => si !== secIdx ? sec : {
        ...sec,
        items: sec.items.map((item, ii) => ii !== itemIdx ? item : { ...item, photo: ev.target?.result as string })
      }))
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const save = async () => {
    if (!form.customer_name) return alert('Customer name required')
    setSaving(true)
    try {
      let hasRed = false, hasYellow = false
      for (const sec of sections) {
        for (const item of sec.items) {
          if (item.status === 'red') hasRed = true
          if (item.status === 'yellow') hasYellow = true
        }
      }
      const overall_status = hasRed ? 'red' : hasYellow ? 'yellow' : 'green'
      const data = { ...form, sections, overall_status, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        await supabase.from('dvi').insert({ ...data, sent_to_customer: false, customer_approved: false, created_at: new Date().toISOString() })
      } else if (editing) {
        await supabase.from('dvi').update(data).eq('id', editing)
      }
      setEditing(null); setForm({}); setSections([]); load()
    } finally { setSaving(false) }
  }

  const sendToCustomer = async (dvi: DVI) => {
    setSending(true)
    try {
      const cust = customers.find(c => c.name?.toLowerCase() === dvi.customer_name?.toLowerCase())
      const phone = cust?.phone
      if (!phone) { alert('No phone number found for this customer. Please link to a customer first.'); return }

      const reds = dvi.sections?.flatMap(s => s.items.filter(i => i.status === 'red').map(i => i.name)) || []
      const yellows = dvi.sections?.flatMap(s => s.items.filter(i => i.status === 'yellow').map(i => i.name)) || []
      const smsBody = `Hi ${dvi.customer_name}, your vehicle inspection is complete!\n\n` +
        (reds.length ? `🔴 Needs Attention:\n${reds.map(r=>`• ${r}`).join('\n')}\n\n` : '') +
        (yellows.length ? `⚠️ Monitor:\n${yellows.map(y=>`• ${y}`).join('\n')}\n\n` : '') +
        (!reds.length && !yellows.length ? `✅ Everything looks great!\n\n` : '') +
        `Please call us at (713) 663-6979 to discuss.\n\n— Alpha International Auto Center`

      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, body: smsBody, channel: 'sms' })
      })

      await supabase.from('dvi').update({ sent_to_customer: true, sent_at: new Date().toISOString() }).eq('id', dvi.id)
      load()
      alert('Inspection sent to customer via SMS!')
    } catch (err) {
      alert('Failed to send: ' + (err as Error).message)
    } finally { setSending(false) }
  }

  const reds = sections.flatMap(s => s.items.filter(i => i.status === 'red')).length
  const yellows = sections.flatMap(s => s.items.filter(i => i.status === 'yellow')).length
  const greens = sections.flatMap(s => s.items.filter(i => i.status === 'green')).length

  const filtered = inspections.filter(d => !search || [d.customer_name, d.vehicle, d.tech].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))

  if (editing !== null) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Inspection' : 'Edit Inspection'}</h1>
            {(reds > 0 || yellows > 0) && (
              <div className="flex gap-2 mt-1 text-xs">
                {reds > 0 && <span className="text-red font-semibold">🔴 {reds} issues</span>}
                {yellows > 0 && <span className="text-amber font-semibold">⚠️ {yellows} to monitor</span>}
                {greens > 0 && <span className="text-green font-semibold">✅ {greens} good</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}); setSections([]) }}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>

        <div className="card space-y-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="form-label">Customer Name</label>
              <input className="form-input" value={form.customer_name||''} onChange={e=>setForm(f=>({...f,customer_name:e.target.value}))} placeholder="Customer name" />
            </div>
            <div>
              <label className="form-label">Vehicle</label>
              <input className="form-input" value={form.vehicle||''} onChange={e=>setForm(f=>({...f,vehicle:e.target.value}))} placeholder="2018 Toyota Camry" />
            </div>
            <div>
              <label className="form-label">Technician</label>
              <select className="form-select" value={form.tech||''} onChange={e=>setForm(f=>({...f,tech:e.target.value}))}>
                {techs.map(t=><option key={t} value={t==='Unassigned'?'':t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Linked Job</label>
              <select className="form-select" value={form.job_id||''} onChange={e=>setForm(f=>({...f,job_id:e.target.value}))}>
                <option value="">None</option>
                {jobs.map(j=><option key={j.id} value={j.id}>{j.ro_number ? `${j.ro_number} — ` : ''}{j.customer_name} {[j.vehicle_year,j.vehicle_make,j.vehicle_model].filter(Boolean).join(' ')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Tech Notes</label>
            <textarea className="form-input" rows={2} value={form.tech_notes||''} onChange={e=>setForm(f=>({...f,tech_notes:e.target.value}))} placeholder="Overall technician notes for this inspection…" />
          </div>
        </div>

        <div className="space-y-4">
          {sections.map((section, secIdx) => (
            <div key={section.title} className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-bg-hover flex items-center justify-between">
                <span className="font-semibold text-sm">{section.title}</span>
                <span className="text-xs text-text-muted">
                  {section.items.filter(i=>i.status==='red').length > 0 && <span className="text-red mr-2">🔴 {section.items.filter(i=>i.status==='red').length}</span>}
                  {section.items.filter(i=>i.status==='yellow').length > 0 && <span className="text-amber mr-2">⚠️ {section.items.filter(i=>i.status==='yellow').length}</span>}
                  {section.items.filter(i=>i.status==='green').length} / {section.items.length} inspected
                </span>
              </div>
              <div className="divide-y divide-border">
                {section.items.map((item, itemIdx) => (
                  <div key={item.name} className={`p-3 ${item.status ? STATUS_STYLE[item.status].split(' ')[0] : ''}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 text-sm font-medium">{item.name}</div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {(['green','yellow','red'] as const).map(s => (
                          <button
                            key={s}
                            onClick={() => updateItemStatus(secIdx, itemIdx, item.status === s ? null : s)}
                            className={`px-2.5 py-1 rounded text-xs font-semibold border transition-all ${
                              item.status === s ? STATUS_STYLE[s] : 'border-border text-text-muted hover:border-text-muted'
                            }`}
                          >
                            {s === 'green' ? '✅' : s === 'yellow' ? '⚠️' : '🔴'}
                          </button>
                        ))}
                        <button
                          className="px-2 py-1 rounded text-xs border border-border text-text-muted hover:text-blue hover:border-blue transition-colors"
                          onClick={() => handlePhoto(secIdx, itemIdx)}
                          title="Add photo"
                        >
                          {item.photo ? '📷✓' : '📷'}
                        </button>
                      </div>
                    </div>
                    {(item.status === 'yellow' || item.status === 'red') && (
                      <input
                        className="form-input mt-2 text-sm"
                        placeholder="Describe the issue…"
                        value={item.note}
                        onChange={e => updateItemNote(secIdx, itemIdx, e.target.value)}
                      />
                    )}
                    {item.photo && (
                      <div className="mt-2">
                        <img src={item.photo} alt="Inspection photo" className="h-24 w-auto rounded border border-border object-cover" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Digital Vehicle Inspections</h1>
          <p className="text-sm text-text-muted mt-0.5">{inspections.length} total · {inspections.filter(d=>d.sent_to_customer).length} sent to customers</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ New Inspection</button>
      </div>

      <div className="mb-4">
        <input className="form-input max-w-sm" placeholder="Search by customer, vehicle, tech…" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="card p-8 text-center text-text-muted animate-pulse">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-text-muted">
          <div className="text-5xl mb-4">🔍</div>
          <div className="text-xl font-bold mb-2">No inspections yet</div>
          <div className="text-sm mb-4 max-w-sm mx-auto">DVI lets your techs photograph issues and mark them red/yellow/green. Send the inspection to the customer for approval with one tap.</div>
          <button className="btn btn-primary" onClick={openNew}>Start First Inspection</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => {
            const allItems = d.sections?.flatMap(s=>s.items)||[]
            const reds = allItems.filter(i=>i.status==='red').length
            const yellows = allItems.filter(i=>i.status==='yellow').length
            const greens = allItems.filter(i=>i.status==='green').length
            return (
              <div key={d.id} className="card p-4 hover:border-blue/40 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 cursor-pointer" onClick={() => openEdit(d)}>
                    <div className="flex items-center gap-3 mb-1">
                      <div className={`w-3 h-3 rounded-full ${d.overall_status==='red'?'bg-red':d.overall_status==='yellow'?'bg-amber':d.overall_status==='green'?'bg-green':'bg-border'}`} />
                      <span className="font-semibold">{d.customer_name}</span>
                      {d.sent_to_customer && <span className="tag tag-green text-xs">Sent ✓</span>}
                      {d.customer_approved && <span className="tag tag-blue text-xs">Approved</span>}
                    </div>
                    <div className="text-sm text-text-muted">{d.vehicle || '—'} · Tech: {d.tech||'—'}</div>
                    <div className="flex gap-3 mt-1 text-xs">
                      {reds > 0 && <span className="text-red">🔴 {reds} issues</span>}
                      {yellows > 0 && <span className="text-amber">⚠️ {yellows} monitor</span>}
                      {greens > 0 && <span className="text-green">✅ {greens} good</span>}
                      {allItems.length === 0 && <span className="text-text-muted">No items inspected</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(d)}>Edit</button>
                    {!d.sent_to_customer ? (
                      <button className="btn btn-primary btn-sm" disabled={sending} onClick={() => sendToCustomer(d)}>
                        {sending ? '…' : '📱 Send to Customer'}
                      </button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => sendToCustomer(d)}>Resend</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
