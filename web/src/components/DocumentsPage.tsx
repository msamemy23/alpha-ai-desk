'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, calcTotals, formatCurrency } from '@/lib/supabase'

interface Customer { id: string; name: string; phone: string; email: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_plate: string; vehicle_mileage: string }
interface Doc { id: string; type: string; doc_number: string; status: string; doc_date: string; customer_name: string; customer_id: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; parts: Record<string,unknown>[]; labors: Record<string,unknown>[]; tax_rate: number; apply_tax: boolean; shop_supplies: number; deposit: number; notes: string; warranty_type: string; payment_terms: string; payment_methods: string; amount_paid: number; payment_method: string; created_at: string }

function getStatuses(type: string) {
  if (type === 'Receipt') return ['Draft','Paid']
  if (type === 'Invoice') return ['Draft','Sent','Unpaid','Partial','Paid']
  return ['Draft','Sent','Approved']
}

export default function DocumentsPage({ type }: { type: 'Estimate'|'Invoice'|'Receipt' }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Doc>>({})
  const [search, setSearch] = useState('')
  const [sendModal, setSendModal] = useState<Doc | null>(null)

  const load = useCallback(async () => {
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from('documents').select('*').eq('type', type).order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,phone,email,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_plate,vehicle_mileage').order('name')
    ])
    setDocs((d || []) as Doc[]); setCustomers((c || []) as Customer[])
  }, [type])

  useEffect(() => {
    load()
    const ch = supabase.channel(`docs_${type}`).on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load, type])

  const genDocNumber = async () => {
    const prefix = type === 'Estimate' ? 'EST' : type === 'Invoice' ? 'INV' : 'REC'
    const year = new Date().getFullYear()
    const { data } = await supabase.from('documents').select('doc_number').eq('type', type).like('doc_number', `${prefix}-${year}-%`)
    const nums = (data || []).map((d: Record<string,string>) => parseInt(d.doc_number.split('-').pop() || '0'))
    const next = Math.max(0, ...nums) + 1
    return `${prefix}-${year}-${String(next).padStart(4,'0')}`
  }

  const openNew = async () => {
    const docNumber = await genDocNumber()
    setForm({ type, doc_number: docNumber, doc_date: new Date().toISOString().split('T')[0], status: 'Draft', tax_rate: 8.25, apply_tax: true, warranty_type: 'No Warranty', parts: [], labors: [] })
    setEditing('new')
  }

  const save = async () => {
    const data = { ...form, type, updated_at: new Date().toISOString() }
    if (editing === 'new') await supabase.from('documents').insert({ ...data, created_at: new Date().toISOString() })
    else if (editing) await supabase.from('documents').update(data).eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete?')) return
    await supabase.from('documents').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id)
    if (c) setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, vehicle_year: c.vehicle_year, vehicle_make: c.vehicle_make, vehicle_model: c.vehicle_model, vehicle_vin: c.vehicle_vin, vehicle_plate: c.vehicle_plate, vehicle_mileage: c.vehicle_mileage }))
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const filtered = docs.filter(d => !search || [d.doc_number, d.customer_name, d.status].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))
  const totals = form ? calcTotals(form as Record<string,unknown>) : null
  const fmt = (d: string) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'

  const statusColor: Record<string,string> = { Draft:'tag-gray', Sent:'tag-blue', Approved:'tag-green', Unpaid:'tag-red', Partial:'tag-amber', Paid:'tag-green' }

  const sendDoc = async (channel: 'sms'|'email') => {
    if (!sendModal) return
    const customer = customers.find(c => c.id === sendModal.customer_id)
    const to = channel === 'sms' ? customer?.phone : customer?.email
    if (!to) return alert(`No ${channel === 'sms' ? 'phone' : 'email'} on file`)
    await fetch('/api/send-document', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: sendModal.id, channel, [channel === 'sms' ? 'phone' : 'email']: to })
    })
    setSendModal(null); load()
  }

  return (
    <div className="p-8 animate-fade-in">
      {editing !== null ? (
        /* ─── Doc Form ─── */
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">{editing === 'new' ? `New ${type}` : `Edit ${type}`}</h1>
              <div className="flex gap-2">
                <button className="btn btn-secondary" onClick={()=>{setEditing(null);setForm({})}}>← Back</button>
                <button className="btn btn-primary" onClick={save}>Save {type}</button>
                {editing !== 'new' && <button className="btn btn-danger" onClick={del}>Delete</button>}
                {editing !== 'new' && <button className="btn btn-secondary" onClick={() => setSendModal(form as Doc)}>📤 Send</button>}
              </div>
            </div>

            {/* Header fields */}
            <div className="card grid grid-cols-3 gap-4">
              <div><label className="form-label">Doc #</label><input className="form-input opacity-60" readOnly value={form.doc_number||''} /></div>
              <div><label className="form-label">Status</label>
                <select className="form-select" value={form.status||'Draft'} onChange={sf('status')}>
                  {getStatuses(type).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="form-label">Date</label><input className="form-input" type="date" value={form.doc_date||''} onChange={sf('doc_date')} /></div>
              <div className="col-span-2"><label className="form-label">Customer</label>
                <select className="form-select" value={(form as Record<string,string>).customer_id||''} onChange={e => selectCustomer(e.target.value)}>
                  <option value="">Select customer...</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">Tax Rate %</label><input className="form-input" type="number" step="0.01" value={form.tax_rate||8.25} onChange={sf('tax_rate')} /></div>
            </div>

            {/* Vehicle */}
            <div className="card grid grid-cols-3 gap-4">
              <div className="col-span-3 text-xs font-bold uppercase tracking-wider text-text-secondary">Vehicle</div>
              {['vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage'].map(k => (
                <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={(form as Record<string,string>)[k]||''} onChange={sf(k)} /></div>
              ))}
            </div>

            {/* Parts */}
            <div className="card">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Parts</div>
              <div className="space-y-2">
                {((form.parts||[]) as Record<string,unknown>[]).map((p,i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="form-input col-span-4" placeholder="Part name" value={p.name as string||''} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],name:e.target.value}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-2" placeholder="Brand" value={p.brand as string||''} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],brand:e.target.value}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-1" type="number" placeholder="Qty" value={p.qty as number||1} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],qty:Number(e.target.value)}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-2" type="number" step="0.01" placeholder="Price" value={p.unitPrice as number||0} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],unitPrice:Number(e.target.value)}; setForm(f=>({...f,parts:p2})) }} />
                    <div className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={p.taxable !== false} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],taxable:e.target.checked}; setForm(f=>({...f,parts:p2})) }} /><span className="text-xs">Tax</span></div>
                    <div className="col-span-1 text-right text-sm">{formatCurrency((Number(p.qty)||1)*(Number(p.unitPrice)||0))}</div>
                    <button className="col-span-1 btn btn-danger btn-sm" onClick={() => setForm(f=>({...f,parts:((f.parts||[]) as Record<string,unknown>[]).filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm mt-2" onClick={() => setForm(f=>({...f,parts:[...((f.parts||[]) as Record<string,unknown>[]),{name:'',brand:'',qty:1,unitPrice:0,taxable:true,status:'Ordered'}]}))}>+ Add Part</button>
              </div>
            </div>

            {/* Labor */}
            <div className="card">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Labor</div>
              <div className="space-y-2">
                {((form.labors||[]) as Record<string,unknown>[]).map((l,i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="form-input col-span-5" placeholder="Operation" value={l.operation as string||''} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],operation:e.target.value}; setForm(f=>({...f,labors:l2})) }} />
                    <select className="form-select col-span-2" value={l.tech as string||''} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],tech:e.target.value}; setForm(f=>({...f,labors:l2})) }}>
                      <option value="">—</option>{['Paul','Devin','Luis','Louie'].map(t=><option key={t}>{t}</option>)}
                    </select>
                    <input className="form-input col-span-1" type="number" step="0.5" placeholder="Hrs" value={l.hours as number||0} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],hours:Number(e.target.value)}; setForm(f=>({...f,labors:l2})) }} />
                    <input className="form-input col-span-2" type="number" step="0.01" placeholder="Rate" value={l.rate as number||120} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],rate:Number(e.target.value)}; setForm(f=>({...f,labors:l2})) }} />
                    <div className="col-span-1 text-right text-sm">{formatCurrency((Number(l.hours)||0)*(Number(l.rate)||0))}</div>
                    <button className="col-span-1 btn btn-danger btn-sm" onClick={() => setForm(f=>({...f,labors:((f.labors||[]) as Record<string,unknown>[]).filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm mt-2" onClick={() => setForm(f=>({...f,labors:[...((f.labors||[]) as Record<string,unknown>[]),{operation:'',tech:'',hours:0,rate:120}]}))}>+ Add Labor</button>
              </div>
            </div>

            <div className="card grid grid-cols-2 gap-4">
              <div><label className="form-label">Shop Supplies $</label><input className="form-input" type="number" step="0.01" value={form.shop_supplies||0} onChange={sf('shop_supplies')} /></div>
              <div><label className="form-label">Deposit $</label><input className="form-input" type="number" step="0.01" value={form.deposit||0} onChange={sf('deposit')} /></div>
              <div className="col-span-2"><label className="form-label">Notes</label><textarea className="form-textarea" rows={3} value={form.notes||''} onChange={sf('notes')} /></div>
            </div>
          </div>

          {/* Preview */}
          <div className="col-span-2">
            <div className="sticky top-4 bg-white text-gray-900 rounded-xl p-8 shadow-2xl text-sm" style={{fontFamily:'Arial,sans-serif'}}>
              <h2 className="text-lg font-bold text-center">Alpha International Auto Center</h2>
              <p className="text-xs text-gray-500 text-center">10710 S Main St, Houston TX 77025 · (713) 663-6979</p>
              <div className="mt-4 text-center">
                <span className="inline-block bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">{type}</span>
                <div className="text-xs text-gray-500 mt-1">#{form.doc_number} · {form.doc_date}</div>
                <div className="font-semibold mt-1">{form.customer_name || 'No customer'}</div>
                <div className="text-xs text-gray-500">{[form.vehicle_year,form.vehicle_make,form.vehicle_model].filter(Boolean).join(' ')}</div>
              </div>
              {totals && (
                <div className="mt-6 border-t pt-4 space-y-1">
                  <div className="flex justify-between text-xs"><span>Parts:</span><span>{formatCurrency(totals.partsTotal)}</span></div>
                  <div className="flex justify-between text-xs"><span>Labor:</span><span>{formatCurrency(totals.laborTotal)}</span></div>
                  <div className="flex justify-between text-xs"><span>Tax:</span><span>{formatCurrency(totals.taxAmount)}</span></div>
                  <div className="flex justify-between font-bold text-base border-t mt-2 pt-2"><span>Total:</span><span>{formatCurrency(totals.total)}</span></div>
                  <div className="flex justify-between font-bold text-red-600"><span>Balance Due:</span><span>{formatCurrency(totals.balanceDue)}</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ─── Doc List ─── */
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">{type}s</h1>
            <div className="flex gap-3">
              <input className="form-input w-56" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-primary" onClick={openNew}>+ New {type}</button>
            </div>
          </div>
          <div className="card p-0 overflow-hidden">
            <table className="data-table w-full">
              <thead><tr><th>Doc #</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} className="text-center text-text-muted py-8">No {type.toLowerCase()}s yet</td></tr>}
                {filtered.map(d => {
                  const t = calcTotals(d as unknown as Record<string,unknown>)
                  return (
                    <tr key={d.id} className="cursor-pointer" onClick={() => { setForm(d as Partial<Doc>); setEditing(d.id) }}>
                      <td className="font-mono text-sm text-blue">{d.doc_number}</td>
                      <td className="font-medium">{d.customer_name || '—'}</td>
                      <td className="text-text-secondary">{fmt(d.doc_date)}</td>
                      <td><span className={`tag ${statusColor[d.status]||'tag-gray'}`}>{d.status}</span></td>
                      <td className="font-semibold">{formatCurrency(t.total)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setSendModal(d)}>📤 Send</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Send modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-4">Send {sendModal.type} #{sendModal.doc_number}</h2>
            <div className="space-y-3">
              <button className="btn btn-primary w-full" onClick={() => sendDoc('email')}>📧 Send via Email</button>
              <button className="btn btn-secondary w-full" onClick={() => sendDoc('sms')}>💬 Send via SMS</button>
              <button className="btn btn-secondary w-full" onClick={() => setSendModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
