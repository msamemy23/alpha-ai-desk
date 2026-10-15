'use client'
import { useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import { getShopId, supabase } from '@/lib/supabase'
import { hasPhone } from '@/lib/growth-text'
import { LEAD_STATUSES, errText } from './helpers'
import type { Rec } from './helpers'

const SOURCES = [
  { value: 'Walk-in', label: 'Walk-in' },
  { value: 'Phone Call', label: 'Phone call' },
  { value: 'Facebook', label: 'Facebook' },
  { value: 'Google', label: 'Google' },
  { value: 'manual', label: 'Something else' },
]

const tomorrowLocal = () => {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Alpha keeps its research in the notes of leads it finds. That is not text to edit by hand. */
const isStructured = (v: unknown) => typeof v === 'string' && /^\s*[{[]/.test(v)

interface Props {
  lead?: Rec | null
  defaultSource?: string
  onClose: () => void
  onSaved: (message: string) => void
}

/** Adds a lead, or edits one: contact details, status and notes. Input stays put when a save fails. */
export default function LeadSheet({ lead, defaultSource = 'Walk-in', onClose, onSaved }: Props) {
  const editing = !!lead
  const [f, setF] = useState({
    name: String(lead?.name || ''),
    phone: String(lead?.phone || ''),
    email: String(lead?.email || ''),
    service: String(lead?.service_needed || ''),
    source: String(lead?.source || defaultSource),
    status: String(lead?.status || 'new'),
    notes: isStructured(lead?.notes) ? '' : String(lead?.notes || ''),
  })
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))

  const nameErr = !f.name.trim() ? 'Enter a name.' : ''
  const phoneErr = f.phone.trim() && !hasPhone(f.phone) ? 'Enter a 10-digit phone number, or leave it empty.' : ''
  const emailErr = f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? 'Enter an email like name@example.com, or leave it empty.' : ''
  const sources = SOURCES.some(s => s.value === f.source) ? SOURCES : [...SOURCES, { value: f.source, label: f.source.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) }]

  const save = async () => {
    setTried(true)
    if (nameErr || phoneErr || emailErr || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const common = {
        name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null,
        service_needed: f.service.trim() || null, source: f.source,
      }
      if (editing) {
        const patch: Record<string, unknown> = { ...common, status: f.status }
        if (!isStructured(lead?.notes)) patch.notes = f.notes.trim() || null
        const { error: e } = await supabase.from('leads').update(patch).eq('id', lead!.id).eq('shop_id', shopId)
        if (e) throw new Error(e.message)
        onSaved(`${common.name} was updated.`)
      } else {
        const { error: e } = await supabase.from('leads').insert({ ...common, shop_id: shopId, notes: f.notes.trim() || null, status: 'new', follow_up_date: tomorrowLocal() })
        if (e) throw new Error(e.message)
        onSaved(`${common.name} was added to your leads.`)
      }
    } catch (e) {
      setError(`The lead was not saved. ${errText(e, 'Check your connection and try again.')}`)
    } finally { busy.current = false; setSaving(false) }
  }

  return (
    <Sheet open onClose={onClose} title={editing ? 'Edit lead' : 'Add a lead'}>
      <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4" noValidate>
        <div>
          <label htmlFor="lead-name" className="form-label">Name</label>
          <input id="lead-name" className="form-input" autoComplete="off" value={f.name} onChange={e => set('name', e.target.value)} aria-invalid={tried && !!nameErr} aria-describedby={tried && nameErr ? 'lead-name-err' : undefined} />
          {tried && nameErr && <p id="lead-name-err" className="form-error">{nameErr}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="lead-phone" className="form-label">Phone (optional)</label>
            <input id="lead-phone" className="form-input" type="tel" autoComplete="off" value={f.phone} onChange={e => set('phone', e.target.value)} aria-invalid={tried && !!phoneErr} aria-describedby={tried && phoneErr ? 'lead-phone-err' : undefined} />
            {tried && phoneErr && <p id="lead-phone-err" className="form-error">{phoneErr}</p>}
          </div>
          <div>
            <label htmlFor="lead-email" className="form-label">Email (optional)</label>
            <input id="lead-email" className="form-input" type="email" autoComplete="off" value={f.email} onChange={e => set('email', e.target.value)} aria-invalid={tried && !!emailErr} aria-describedby={tried && emailErr ? 'lead-email-err' : undefined} />
            {tried && emailErr && <p id="lead-email-err" className="form-error">{emailErr}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="lead-service" className="form-label">What they need (optional)</label>
          <input id="lead-service" className="form-input" value={f.service} onChange={e => set('service', e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="lead-source" className="form-label">How they found you</label>
            <select id="lead-source" className="form-select" value={f.source} onChange={e => set('source', e.target.value)}>
              {sources.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {editing && (
            <div>
              <label htmlFor="lead-status" className="form-label">Where they are now</label>
              <select id="lead-status" className="form-select" value={f.status} onChange={e => set('status', e.target.value)}>
                {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                {!LEAD_STATUSES.some(s => s.value === f.status) && <option value={f.status}>{f.status}</option>}
              </select>
            </div>
          )}
        </div>
        {!isStructured(lead?.notes) ? (
          <div>
            <label htmlFor="lead-notes" className="form-label">Notes (optional)</label>
            <textarea id="lead-notes" className="form-textarea" rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        ) : <p className="text-[0.875rem] text-text-secondary">Alpha’s research notes on this lead are kept as they are.</p>}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save lead'}</button>
        </div>
      </form>
    </Sheet>
  )
}
