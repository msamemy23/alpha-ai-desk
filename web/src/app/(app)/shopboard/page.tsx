'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Employee {
  id: number
  name: string
  role: string
  emoji?: string
  active?: boolean
}

interface TimeclockEntry {
  id: number
  staff_name: string
  clock_in: string
  clock_out?: string | null
  hours_worked?: number | null
}

interface Job {
  id: number
  title: string
  customer_name?: string
  status: string
  assigned_tech?: string | null
  year?: string | null
  make?: string | null
  model?: string | null
  license_plate?: string | null
  priority?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt12(iso: string) {
  const d = new Date(iso)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${m}${ampm}`
}

function fmtHours(h: number | null | undefined) {
  if (h == null || h === 0) return ''
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
}

function getMondayOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toYMD(date: Date) {
  return date.toISOString().split('T')[0]
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const ROLE_EMOJIS: Record<string, string> = {
  technician: '🔧',
  employee: '👤',
  manager: '👔',
  advisor: '📋',
}

const STATUS_COLORS: Record<string, string> = {
  pending:       'bg-yellow-100 text-yellow-800 border-yellow-300',
  'in-progress': 'bg-blue-100 text-blue-800 border-blue-300',
  completed:     'bg-green-100 text-green-800 border-green-300',
  waiting:       'bg-orange-100 text-orange-800 border-orange-300',
  cancelled:     'bg-red-100 text-red-800 border-red-300',
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-yellow-400',
  low:    'bg-green-500',
}

// ─── Add Staff Modal ───────────────────────────────────────────────────────────
function AddStaffModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName]     = useState('')
  const [role, setRole]     = useState('technician')
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState('')

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return }
    setLoading(true)
    setErr('')
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: name.trim(), role, emoji: ROLE_EMOJIS[role] || '👤' }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to add')
      onAdded()
      onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add staff')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">Add Employee</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="e.g. Carlos"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="technician">🔧 Technician</option>
              <option value="employee">👤 Employee</option>
              <option value="advisor">📋 Service Advisor</option>
              <option value="manager">👔 Manager</option>
            </select>
          </div>

          {err && <p className="text-red-500 text-sm">{err}</p>}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Adding…' : 'Add Employee'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ShopBoardPage() {
  const [employees, setEmployees]         = useState<Employee[]>([])
  const [entries, setEntries]             = useState<TimeclockEntry[]>([])
  const [weekEntries, setWeekEntries]     = useState<TimeclockEntry[]>([])
  const [jobs, setJobs]                   = useState<Job[]>([])
  const [loading, setLoading]             = useState(true)
  const [clockLoading, setClockLoading]   = useState<Record<string, boolean>>({})
  const [deleteLoading, setDeleteLoading] = useState<Record<number, boolean>>({})
  const [error, setError]                 = useState<string | null>(null)
  const [weekStart, setWeekStart]         = useState<Date>(() => getMondayOfWeek(new Date()))
  const [activeTab, setActiveTab]         = useState<'clock' | 'board'>('clock')
  const [showAddModal, setShowAddModal]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Employee | null>(null)

  // ── Fetch employees ────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    try {
      const res  = await fetch('/api/staff')
      const json = await res.json()
      setEmployees(json.staff || [])
    } catch { setEmployees([]) }
  }, [])

  // ── Fetch today ────────────────────────────────────────────────────────────
  const fetchToday = useCallback(async () => {
    try {
      const res  = await fetch(`/api/timeclock?date=${toYMD(new Date())}`)
      const json = await res.json()
      setEntries(json.entries || [])
    } catch { setEntries([]) }
  }, [])

  // ── Fetch week ─────────────────────────────────────────────────────────────
  const fetchWeek = useCallback(async (monday: Date) => {
    try {
      const res  = await fetch(`/api/timeclock?startDate=${toYMD(monday)}&endDate=${toYMD(addDays(monday, 6))}`)
      const json = await res.json()
      setWeekEntries(json.entries || [])
    } catch { setWeekEntries([]) }
  }, [])

  // ── Fetch jobs ─────────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, customer_name, status, assigned_tech, year, make, model, license_plate, priority')
      .not('status', 'eq', 'completed')
      .order('created_at', { ascending: false })
    setJobs(data || [])
  }, [])

  useEffect(() => {
    Promise.all([fetchEmployees(), fetchToday(), fetchWeek(weekStart), fetchJobs()])
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clock in / out ─────────────────────────────────────────────────────────
  const handleClock = useCallback(async (empName: string, action: 'clock_in' | 'clock_out') => {
    setClockLoading(p => ({ ...p, [empName]: true }))
    setError(null)
    try {
      const res  = await fetch('/api/timeclock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, staff_name: empName }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Clock failed')
      await Promise.all([fetchToday(), fetchWeek(weekStart)])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clock action failed')
    } finally {
      setClockLoading(p => ({ ...p, [empName]: false }))
    }
  }, [fetchToday, fetchWeek, weekStart])

  // ── Delete employee ────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (emp: Employee) => {
    setDeleteLoading(p => ({ ...p, [emp.id]: true }))
    setError(null)
    try {
      const res  = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate', id: emp.id }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Delete failed')
      await fetchEmployees()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteLoading(p => ({ ...p, [emp.id]: false }))
      setConfirmDelete(null)
    }
  }, [fetchEmployees])

  // ── Derived state ──────────────────────────────────────────────────────────
  const clockedInNames = new Set(
    entries.filter(e => e.clock_in && !e.clock_out).map(e => e.staff_name)
  )

  function todayHours(name: string) {
    return entries.filter(e => e.staff_name === name && e.hours_worked != null)
      .reduce((s, e) => s + (e.hours_worked || 0), 0)
  }

  function weekGrid(name: string): (TimeclockEntry[] | null)[] {
    return DAY_LABELS.map((_, i) => {
      const day = toYMD(addDays(weekStart, i))
      const de  = weekEntries.filter(e => e.staff_name === name && e.clock_in.split('T')[0] === day)
      return de.length > 0 ? de : null
    })
  }

  const weekEndDate = addDays(weekStart, 6)
  const weekLabel   = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  const techs       = Array.from(new Set(jobs.map(j => j.assigned_tech || 'Unassigned')))

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Loading Shop Board…</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">

      {/* ── Modals ── */}
      {showAddModal && (
        <AddStaffModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => { fetchEmployees(); fetchToday(); fetchWeek(weekStart) }}
        />
      )}

      {/* ── Confirm Delete Dialog ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Remove Employee?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Remove <span className="font-semibold">{confirmDelete.name}</span> from the board?
              Their time clock history will be kept.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleteLoading[confirmDelete.id]}
                className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading[confirmDelete.id] ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shop Board</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="inline-flex bg-gray-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setActiveTab('clock')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'clock' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'
            }`}
          >⏱ Time Clock</button>
          <button
            onClick={() => setActiveTab('board')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'board' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'
            }`}
          >🔧 Jobs Board</button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">⚠️ {error}</div>
      )}

      {/* ──────────────────────── TIME CLOCK TAB ───────────────────────────── */}
      {activeTab === 'clock' && (
        <div className="space-y-6">

          {/* ── Today's Status + Add Button ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-700">Today&apos;s Status</h2>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <span className="text-base leading-none">+</span> Add Employee
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {employees.length === 0 && (
                <div className="col-span-4 flex flex-col items-center py-10 text-gray-400">
                  <span className="text-4xl mb-2">👥</span>
                  <p className="font-medium">No employees yet</p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-3 text-sm text-blue-600 underline"
                  >+ Add your first employee</button>
                </div>
              )}
              {employees.map(emp => {
                const isClockedIn  = clockedInNames.has(emp.name)
                const isLoading    = clockLoading[emp.name]
                const hrs          = todayHours(emp.name)
                const activeEntry  = entries.find(e => e.staff_name === emp.name && !e.clock_out)

                return (
                  <div
                    key={emp.id}
                    className={`rounded-xl border-2 p-4 transition-all relative ${
                      isClockedIn ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {/* Remove button */}
                    <button
                      onClick={() => setConfirmDelete(emp)}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors text-sm"
                      title={`Remove ${emp.name}`}
                    >✕</button>

                    <div className="flex items-start justify-between mb-3 pr-5">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {emp.emoji || ROLE_EMOJIS[emp.role] || '👤'} {emp.name}
                        </p>
                        <p className="text-xs text-gray-500 capitalize">{emp.role}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        isClockedIn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isClockedIn ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                        {isClockedIn ? 'In' : 'Out'}
                      </span>
                    </div>

                    {isClockedIn && activeEntry && (
                      <p className="text-xs text-green-700 mb-2">Since {fmt12(activeEntry.clock_in)}</p>
                    )}
                    {hrs > 0 && (
                      <p className="text-xs text-gray-500 mb-3">
                        Today: <span className="font-semibold text-gray-700">{fmtHours(hrs)}</span>
                      </p>
                    )}
                    {!isClockedIn && hrs === 0 && <div className="mb-3 h-4" />}

                    <div className="flex gap-2">
                      <button
                        disabled={isClockedIn || isLoading}
                        onClick={() => handleClock(emp.name, 'clock_in')}
                        className="flex-1 text-sm font-medium py-2 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >{isLoading && !isClockedIn ? '…' : 'Clock In'}</button>
                      <button
                        disabled={!isClockedIn || isLoading}
                        onClick={() => handleClock(emp.name, 'clock_out')}
                        className="flex-1 text-sm font-medium py-2 px-3 rounded-lg bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >{isLoading && isClockedIn ? '…' : 'Clock Out'}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Weekly Attendance Grid ── */}
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="text-base font-semibold text-gray-700">Weekly Attendance</h2>
              <div className="flex items-center gap-1.5 text-sm">
                <button onClick={() => { const d = addDays(weekStart,-7); setWeekStart(d); fetchWeek(d) }}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600" title="Previous week">◀</button>
                <span className="text-gray-600 min-w-[220px] text-center font-medium">{weekLabel}</span>
                <button onClick={() => { const d = addDays(weekStart,7); setWeekStart(d); fetchWeek(d) }}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600" title="Next week">▶</button>
                <button onClick={() => { const d = getMondayOfWeek(new Date()); setWeekStart(d); fetchWeek(d) }}
                  className="text-xs px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 ml-1">This Week</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700 w-36">Employee</th>
                    {DAY_LABELS.map((day, i) => {
                      const date    = addDays(weekStart, i)
                      const isToday = toYMD(date) === toYMD(new Date())
                      return (
                        <th key={day} className={`text-center py-3 px-2 font-semibold min-w-[100px] ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                          <div>{day}</div>
                          <div className={`text-xs font-normal ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>
                            {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                          </div>
                        </th>
                      )
                    })}
                    <th className="text-center py-3 px-3 font-semibold text-gray-700 min-w-[70px]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-8 text-gray-400 text-sm italic">No employees</td></tr>
                  )}
                  {employees.map((emp, ri) => {
                    const grid      = weekGrid(emp.name)
                    const weekTotal = grid.flat().filter(Boolean).reduce((s, e) => s + ((e as TimeclockEntry).hours_worked || 0), 0)
                    return (
                      <tr key={emp.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                        <td className="py-3 px-4 font-medium text-gray-800 whitespace-nowrap">{emp.name}</td>
                        {grid.map((dayEntries, di) => {
                          const date    = addDays(weekStart, di)
                          const isToday = toYMD(date) === toYMD(new Date())
                          if (!dayEntries) return (
                            <td key={di} className={`text-center py-3 px-2 ${isToday ? 'bg-blue-50/30' : ''}`}>
                              <span className="text-gray-300 text-xs">—</span>
                            </td>
                          )
                          const dayTotal = dayEntries.reduce((s, e) => s + (e.hours_worked || 0), 0)
                          return (
                            <td key={di} className={`text-center py-2 px-2 ${isToday ? 'bg-blue-50/30' : ''}`}>
                              {dayEntries.map((e, ei) => (
                                <div key={ei} className="text-xs leading-snug whitespace-nowrap">
                                  <span className="font-semibold text-gray-800">{fmt12(e.clock_in)}</span>
                                  {e.clock_out
                                    ? <><span className="text-gray-400"> – </span><span className="font-semibold text-gray-800">{fmt12(e.clock_out)}</span></>
                                    : <span className="text-green-600 font-semibold"> – now</span>}
                                </div>
                              ))}
                              {dayTotal > 0 && <div className="text-xs text-blue-600 font-bold mt-0.5">{fmtHours(dayTotal)}</div>}
                            </td>
                          )
                        })}
                        <td className="text-center py-3 px-3">
                          {weekTotal > 0
                            ? <span className="text-sm font-bold text-gray-800">{fmtHours(weekTotal)}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────── JOBS BOARD TAB ───────────────────────────── */}
      {activeTab === 'board' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-700">
              Active Jobs <span className="text-gray-400 font-normal text-sm">({jobs.length})</span>
            </h2>
            <button onClick={fetchJobs} className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600">↻ Refresh</button>
          </div>

          {jobs.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-medium">All caught up — no active jobs!</p>
            </div>
          )}

          {techs.map(tech => {
            const techJobs = jobs.filter(j => (j.assigned_tech || 'Unassigned') === tech)
            if (techJobs.length === 0) return null
            return (
              <div key={tech} className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
                  <span>🔧</span>
                  <span className="font-semibold">{tech}</span>
                  <span className="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded-full">
                    {techJobs.length} job{techJobs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {techJobs.map(job => (
                    <div key={job.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      {job.priority && PRIORITY_DOT[job.priority] && (
                        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[job.priority]}`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{job.title}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                          {job.customer_name && <span>👤 {job.customer_name}</span>}
                          {(job.year || job.make || job.model) && (
                            <span>🚗 {[job.year, job.make, job.model].filter(Boolean).join(' ')}</span>
                          )}
                          {job.license_plate && <span>🪪 {job.license_plate}</span>}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium capitalize ${
                        STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {job.status.replace('-', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
