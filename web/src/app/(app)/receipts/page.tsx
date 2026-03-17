'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatCurrency, calcTotals } from '@/lib/supabase'

interface Receipt {
  id: string; doc_number: string; customer_id: string | null
  document_date: string; status: string; total: number; notes: string
  parts_lines: Record<string,unknown>[]; labor_lines: Record<string,unknown>[]
  tax_rate: number; apply_tax: boolean; shop_supplies: number; sublet: number; deposit: number
  created_at: string; payment_methods: string
  customer_snapshot: { name?: string } | null
  vehicle_snapshot: { year?: string; make?: string; model?: string } | null
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all'|'Paid'|'Draft'>('all')
  const [selected, setSelected] = useState<Receipt | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('type', 'Receipt')
      .order('created_at', { ascending: false })
    setReceipts((data || []) as Receipt[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = receipts.filter(r => {
    const name = r.customer_snapshot?.name || ''
    const doc = r.doc_number || ''
    const matchSearch = !search || [name, doc].some(v => v.toLowerCase().includes(search.toLowerCase()))
    const matchFilter = filter === 'all' || r.status === filter
    return matchSearch && matchFilter
  })

  const totalPaid = receipts.filter(r => r.status === 'Paid').reduce((s, r) => s + calcTotals(r).total, 0)
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

  const printReceipt = (r: Receipt) => {
    const totals = calcTotals(r)
    const vehicle = [r.vehicle_snapshot?.year, r.vehicle_snapshot?.make, r.vehicle_snapshot?.model].filter(Boolean).join(' ')
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt ${r.doc_number}</title>
    <style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;padding:20px}
    h1{font-size:1.5rem;margin:0}table{width:100%;border-collapse:collapse}
    td,th{padding:8px;text-align:left;border-bottom:1px solid #eee}.right{text-align:right}
    .total{font-weight:bold;font-size:1.1rem}@media print{body{margin:0}}</style></head><body>
    <div style="font-size:1.2rem;font-weight:bold">Alpha International Auto Center</div>
    <div style="color:#666;font-size:0.85rem">10710 S Main St, Houston TX 77025 | (713) 663-6979</div>
    <hr><h1>RECEIPT ${r.doc_number || ''}</h1>
    <table><tr><td><b>Customer:</b> ${r.customer_snapshot?.name || ''}</td>
    <td><b>Date:</b> ${fmtDate(r.document_date || r.created_at)}</td></tr>
    ${vehicle ? `<tr><td colspan="2"><b>Vehicle:</b> ${vehicle}</td></tr>` : ''}</table><br>
    <table><tr><th>Description</th><th class="right">Amount</th></tr>
    ${(r.labor_lines||[]).map((l: Record<string,unknown>) => `<tr><td>${l.operation||'Labor'}</td><td class="right">${formatCurrency(Number(l.hours||0)*Number(l.rate||0))}</td></tr>`).join('')}
    ${(r.parts_lines||[]).map((p: Record<string,unknown>) => `<tr><td>${p.name||'Part'}</td><td class="right">${formatCurrency(Number(p.qty||1)*Number(p.unitPrice||0))}</td></tr>`).join('')}
    ${totals.taxAmount>0?`<tr><td>Tax (${r.tax_rate}%)</td><td class="right">${formatCurrency(totals.taxAmount)}</td></tr>`:''}
    ${totals.deposit>0?`<tr><td>Deposit</td><td class="right">-${formatCurrency(totals.deposit)}</td></tr>`:''}
    <tr class="total"><td>TOTAL</td><td class="right">${formatCurrency(totals.balanceDue)}</td></tr></table>
    ${r.notes?`<p style="color:#666;font-size:0.85rem;margin-top:16px">${r.notes}</p>`:''}
    <p style="text-align:center;color:#888;font-size:0.8rem;margin-top:24px">Thank you for your business!</p>
    <script>window.onload=()=>window.print()</script></body></html>`)
    win.document.close()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Receipts</h1>
          <p className="text-text-muted text-sm mt-1">Payment receipts for completed work</p>
        </div>
        <div className="card px-5 py-3 flex items-center gap-3">
          <div className="text-2xl font-bold text-green">{formatCurrency(totalPaid)}</div>
          <div className="text-xs text-text-muted">Total Collected ({receipts.filter(r=>r.status==='Paid').length} receipts)</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input className="form-input w-52" placeholder="Search customer, doc #..." value={search} onChange={e => setSearch(e.target.value)} />
        {(['all','Paid','Draft'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`btn btn-sm ${filter===f?'btn-primary':'btn-secondary'}`}>
            {f==='all'?'All':f}
          </button>
        ))}
      </div>

      {loading ? <div className="text-text-muted py-8 text-center">Loading receipts...</div> : (
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead><tr><th>Doc #</th><th>Customer</th><th>Vehicle</th><th>Date</th><th>Status</th><th>Total</th><th></th></tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-text-muted py-12">
                  <div className="text-4xl mb-3">🧾</div>
                  <p className="font-medium">No receipts found</p>
                  <p className="text-sm mt-1">Receipts are created when invoices are marked as Paid</p>
                </td></tr>
              )}
              {filtered.map(r => {
                const totals = calcTotals(r)
                const vehicle = [r.vehicle_snapshot?.year,r.vehicle_snapshot?.make,r.vehicle_snapshot?.model].filter(Boolean).join(' ')
                return (
                  <tr key={r.id} className={`cursor-pointer hover:bg-bg-hover ${selected?.id===r.id?'bg-bg-hover':''}`} onClick={() => setSelected(selected?.id===r.id?null:r)}>
                    <td className="font-mono text-sm font-medium text-blue">{r.doc_number||'—'}</td>
                    <td className="font-medium">{r.customer_snapshot?.name||'—'}</td>
                    <td className="text-text-secondary text-sm">{vehicle||'—'}</td>
                    <td className="text-text-secondary text-sm">{fmtDate(r.document_date||r.created_at)}</td>
                    <td><span className={`tag ${r.status==='Paid'?'tag-green':'tag-gray'}`}>{r.status}</span></td>
                    <td className="font-bold text-green">{formatCurrency(totals.total)}</td>
                    <td onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-sm btn-secondary" onClick={()=>printReceipt(r)} title="Print">🖨️</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="mt-4 card p-5 border-blue/30 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">Receipt Details — {selected.doc_number}</h2>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={()=>printReceipt(selected)}>🖨️ Print</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setSelected(null)}>✕</button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
            <div><div className="text-xs text-text-muted uppercase tracking-wide mb-1">Customer</div><div className="font-medium">{selected.customer_snapshot?.name||'—'}</div></div>
            <div><div className="text-xs text-text-muted uppercase tracking-wide mb-1">Date</div><div>{fmtDate(selected.document_date||selected.created_at)}</div></div>
            <div><div className="text-xs text-text-muted uppercase tracking-wide mb-1">Payment</div><div>{selected.payment_methods||'—'}</div></div>
            <div><div className="text-xs text-text-muted uppercase tracking-wide mb-1">Total</div><div className="text-xl font-bold text-green">{formatCurrency(calcTotals(selected).total)}</div></div>
          </div>
          {((selected.labor_lines||[]).length > 0 || (selected.parts_lines||[]).length > 0) && (
            <table className="data-table w-full text-sm">
              <thead><tr><th>Item</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {(selected.labor_lines||[]).map((l: Record<string,unknown>,i: number)=>(
                  <tr key={i}><td>{String(l.operation||'Labor')}</td><td className="text-right">{formatCurrency(Number(l.hours||0)*Number(l.rate||0))}</td></tr>
                ))}
                {(selected.parts_lines||[]).map((p: Record<string,unknown>,i: number)=>(
                  <tr key={i}><td>{String(p.name||'Part')}</td><td className="text-right">{formatCurrency(Number(p.qty||1)*Number(p.unitPrice||0))}</td></tr>
                ))}
                {calcTotals(selected).taxAmount>0&&<tr><td className="text-text-muted">Tax</td><td className="text-right text-text-muted">{formatCurrency(calcTotals(selected).taxAmount)}</td></tr>}
                {calcTotals(selected).deposit>0&&<tr><td className="text-text-muted">Deposit</td><td className="text-right text-text-muted">-{formatCurrency(calcTotals(selected).deposit)}</td></tr>}
                <tr className="font-bold border-t-2"><td>Balance Due</td><td className="text-right text-green">{formatCurrency(calcTotals(selected).balanceDue)}</td></tr>
              </tbody>
            </table>
          )}
          {selected.notes&&<p className="mt-3 text-sm text-text-muted italic">{selected.notes}</p>}
        </div>
      )}
    </div>
  )
}