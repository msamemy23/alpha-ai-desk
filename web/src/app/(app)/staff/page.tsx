'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface ClockEntry {
  id: string
  staff_id: string
  staff_name: string
  clock_in: string
  clock_out: string | null
  break_start: string | null
  break_end: string | null
  break_minutes: number
  total_minutes: number | null
  notes: string
  date: string
}
interface StaffMember {
  id: string
  name: string
  role: string
  phone: string
  active: boolean
}

function fmt(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtHours(min: number | null) {
  if (!min) return '0h 0m'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
function minsWorked(entry: ClockEntry): number {
  if (!entry.clock_in) return 0
  const end = entry.clock_out ? new Date(entry.clock_out) : new Date()
  const start = new Date(entry.clock_in)
  const total = Math.round((end.getTime() - start.getTime()) / 60000)
  return Math.max(0, total - (entry.break_minutes || 0))
}

export default function StaffPage() {
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'today'|'week'|'manage'>('today')
  const [clockingId, setClockingId] = useState<string|null>(null)
  const [editStaff, setEditStaff] = useState<Partial<StaffMember>|null>(null)
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
      const [{ data: tc }, { data: sm }] = await Promise.all([
        supabase.from('timeclock').select('*').gte('date', weekAgo.toISOString().slice(0,10)).order('clock_in', { ascending: false }),
        supabase.from('staff').select('*').order('name')
      ])
      setEntries((tc || []) as ClockEntry[])
      setStaff((sm || []) as StaffMember[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('timeclock_ch').on('postgres_changes', { event: '*', schema: 'public', table: 'timeclock' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const clockAction = async (staffName: string, action: string) => {
    setClockingId(staffName)
    try {
      await fetch('/api/timeclock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, staff_name: staffName })
      })
      setTimeout(load, 500)
    } finally { setClockingId(null) }
  }

  const saveStaff = async () => {
    if (!editStaff?.name) return alert('Name is required')
    setSaving(true)
    try {
      const data = { ...editStaff, updated_at: new Date().toISOString() }
      if (editStaff.id) {
        await supabase.from('staff').update(data).eq('id', editStaff.id)
      } else {
        await supabase.from('staff').insert({ ...data, active: true, created_at: new Date().toISOString() })
      }
      setEditStaff(null); load()
    } finally { setSaving(false) }
  }

  const todayEntries = entries.filter(e => e.date === today)
  const activeEntry = (name: string) => todayEntries.find(e => e.staff_name === name && !e.clock_out)

  const todaySummary = staff.filter(s => s.active !== false).map(s => {
    const active = activeEntry(s.name)
    const allToday = todayEntries.filter(e => e.staff_name === s.name)
    const totalMins = allToday.reduce((sum, e) => sum + minsWorked(e), 0)
    const onBreak = active && active.break_start && !active.break_end
    return { staff: s, active, allToday, totalMins, onBreak }
  })

  const weekEntries = entries.slice(0, 200)
  const grouped: Record<string, ClockEntry[]> = {}
  for (const e of weekEntries) {
    const key = e.date || e.clock_in?.slice(0,10) || '?'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(e)
  }
  const sortedDays = Object.keys(grouped).sort().reverse()

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Staff & Time Tracking</h1>
          <p className="text-sm text-text-muted mt-0.5">{todaySummary.filter(s => s.active).length} clocked in today</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="text-lg font-mono text-text-muted">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
          {tab === 'manage' && <button className="btn btn-primary btn-sm" onClick={() => setEditStaff({ role: 'technician', active: true })}>+ Add Staff</button>}
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-bg-card border border-border rounded-lg p-1 w-fit">
        {(['today','week','manage'] as const).map(t => (
          <button key={t} className={`px-4 py-1.5 rounded text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setTab(t)}>
            {t === 'today' ? "Today's Status" : t === 'week' ? 'Weekly Hours' : 'Manage Staff'}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div className="space-y-3">
          {todaySummary.length === 0 ? (
            <div className="card p-8 text-center text-text-muted">
              <div className="text-4xl mb-3">👥</div>
              <div className="text-lg font-semibold mb-1">No active staff</div>
              <div className="text-sm">Add staff members in the Manage Staff tab</div>
            </div>
          ) : todaySummary.map(({ staff: s, active, totalMins, onBreak }) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${active ? (onBreak ? 'bg-amber/20 text-amber' : 'bg-green/20 text-green') : 'bg-bg-hover text-text-muted'}`}>
                    {s.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-text-muted capitalize">{s.role || 'Staff'}</div>
                  </div>
                  <span className={`tag text-xs ${active ? (onBreak ? 'tag-amber' : 'tag-green') : 'tag-gray'}`}>
                    {active ? (onBreak ? 'On Break' : 'Clocked In') : 'Off'}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-bold text-lg">{fmtHours(totalMins)}</div>
                  <div className="text-xs text-text-muted">{active ? `In: ${fmt(active.clock_in)}` : 'Today total'}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                {!active ? (
                  <button className="btn btn-success btn-sm flex-1" disabled={clockingId === s.name} onClick={() => clockAction(s.name, 'clock_in')}>
                    {clockingId === s.name ? '…' : '🟢 Clock In'}
                  </button>
                ) : (
                  <>
                    {!onBreak ? (
                      <button className="btn btn-secondary btn-sm flex-1" disabled={clockingId === s.name} onClick={() => clockAction(s.name, 'start_break')}>☕ Start Break</button>
                    ) : (
                      <button className="btn btn-secondary btn-sm flex-1" disabled={clockingId === s.name} onClick={() => clockAction(s.name, 'end_break')}>▶ End Break</button>
                    )}
                    <button className="btn btn-danger btn-sm flex-1" disabled={clockingId === s.name} onClick={() => clockAction(s.name, 'clock_out')}>🔴 Clock Out</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'week' && (
        <div className="space-y-4">
          {loading ? (
            <div className="card p-8 text-center text-text-muted">Loading…</div>
          ) : sortedDays.map(day => {
            const dayEntries = grouped[day]
            const dayTotals: Record<string, number> = {}
            for (const e of dayEntries) {
              dayTotals[e.staff_name] = (dayTotals[e.staff_name] || 0) + minsWorked(e)
            }
            return (
              <div key={day} className="card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-bg-hover">
                  <span className="font-semibold text-sm">
                    {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    {day === today && <span className="ml-2 tag tag-blue text-xs">Today</span>}
                  </span>
                </div>
                <table className="data-table">
                  <thead><tr><th>Employee</th><th>Clock In</th><th>Clock Out</th><th>Break</th><th>Hours</th></tr></thead>
                  <tbody>
                    {dayEntries.map(e => (
                      <tr key={e.id}>
                        <td className="font-medium">{e.staff_name}</td>
                        <td>{fmt(e.clock_in)}</td>
                        <td>{e.clock_out ? fmt(e.clock_out) : <span className="tag tag-green text-xs">Active</span>}</td>
                        <td className="text-text-muted text-sm">{e.break_minutes ? `${e.break_minutes}m` : '—'}</td>
                        <td className="font-semibold">{fmtHours(minsWorked(e))}</td>
                      </tr>
                    ))}
                    <tr className="bg-bg-hover font-semibold">
                      <td colSpan={4} className="text-right text-sm text-text-muted">Day Total:</td>
                      <td>{fmtHours(Object.values(dayTotals).reduce((a,b) => a+b, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })}
          {sortedDays.length === 0 && <div className="card p-8 text-center text-text-muted">No time entries this week</div>}
        </div>
      )}

      {tab === 'manage' && (
        <div>
          {editStaff !== null && (
            <div className="card p-5 mb-5 max-w-md">
              <h3 className="font-bold mb-4">{editStaff.id ? 'Edit' : 'Add'} Staff Member</h3>
              <div className="space-y-3">
                <div>
                  <label className="form-label">Name *</label>
                  <input className="form-input" value={editStaff.name || ''} onChange={e => setEditStaff(s => ({ ...s!, name: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Role</label>
                  <select className="form-select" value={editStaff.role || 'technician'} onChange={e => setEditStaff(s => ({ ...s!, role: e.target.value }))}>
                    <option value="technician">Technician</option>
                    <option value="service_advisor">Service Advisor</option>
                    <option value="manager">Manager</option>
                    <option value="parts">Parts</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={editStaff.phone || ''} onChange={e => setEditStaff(s => ({ ...s!, phone: e.target.value }))} placeholder="(713) 000-0000" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="active" checked={editStaff.active !== false} onChange={e => setEditStaff(s => ({ ...s!, active: e.target.checked }))} className="w-4 h-4" />
                  <label htmlFor="active" className="text-sm">Active employee</label>
                </div>
                <div className="flex gap-2 pt-2">
                  <button className="btn btn-primary btn-sm" onClick={saveStaff} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditStaff(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td className="capitalize text-sm text-text-muted">{(s.role || '').replace('_', ' ')}</td>
                    <td className="text-sm text-text-muted">{s.phone || '—'}</td>
                    <td><span className={`tag ${s.active !== false ? 'tag-green' : 'tag-gray'}`}>{s.active !== false ? 'Active' : 'Inactive'}</span></td>
                    <td><button className="text-xs text-blue hover:underline" onClick={() => setEditStaff(s)}>Edit</button></td>
                  </tr>
                ))}
                {staff.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-text-muted">No staff members added yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
