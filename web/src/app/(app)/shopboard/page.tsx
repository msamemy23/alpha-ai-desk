'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Employee {
  id: number
  name: string
  role: string
}

interface TimeclockEntry {
  id: number
  staff_name: string
  staff_id?: number
  clock_in: string
  clock_out?: string | null
  hours_worked?: number | null
  note?: string | null
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
  if (h == null) return ''
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`
}

function getMondayOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
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

const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-800 border-yellow-300',
  'in-progress': 'bg-blue-100 text-blue-800 border-blue-300',
  completed:   'bg-green-100 text-green-800 border-green-300',
  waiting:     'bg-orange-100 text-orange-800 border-orange-300',
  cancelled:   'bg-red-100 text-red-800 border-red-300',
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-yellow-400',
  low:    'bg-green-500',
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ShopBoardPage() {
  const [employees, setEmployees]       = useState<Employee[]>([])
  const [entries, setEntries]           = useState<TimeclockEntry[]>([])
  const [weekEntries, setWeekEntries]   = useState<TimeclockEntry[]>([])
  const [jobs, setJobs]                 = useState<Job[]>([])
  const [loading, setLoading]           = useState(true)
  const [clockLoading, setClockLoading] = useState<Record<string, boolean>>({})
  const [error, setError]               = useState<string | null>(null)
  const [weekStart, setWeekStart]       = useState<Date>(() => getMondayOfWeek(new Date()))
  const [activeTab, setActiveTab]       = useState<'clock' | 'board'>('clock')

  // ── Fetch employees ──────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('id, name, role')
      .in('role', ['employee', 'technician', 'tech'])
    setEmployees(data || [])
  }, [])

  // ── Fetch today's clock entries ───────────────────────────────────────────────
  const fetchToday = useCallback(async () => {
    const today = toYMD(new Date())
    try {
      const res = await fetch(`/api/timeclock?date=${today}`)
      const json = await res.json()
      setEntries(json.entries || [])
    } catch {
      setEntries([])
    }
  }, [])

  // ── Fetch week entries ────────────────────────────────────────────────────────
  const fetchWeek = useCallback(async (monday: Date) => {
    const startDate = toYMD(monday)
    const endDate   = toYMD(addDays(monday, 6))
    try {
      const res = await fetch(`/api/timeclock?startDate=${startDate}&endDate=${endDate}`)
      const json = await res.json()
      setWeekEntries(json.entries || [])
    } catch {
      setWeekEntries([])
    }
  }, [])

  // ── Fetch jobs ────────────────────────────────────────────────────────────────
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
  }, [fetchEmployees, fetchToday, fetchWeek, weekStart])

  // ── Clock In / Out ────────────────────────────────────────────────────────────
  const handleClock = useCallback(async (empName: string, action: 'clock_in' | 'clock_out') => {
    setClockLoading(prev => ({ ...prev, [empName]: true }))
    setError(null)
    try {
      const res = await fetch('/api/timeclock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, staff_name: empName }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed')
      await Promise.all([fetchToday(), fetchWeek(weekStart)])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clock action failed')
    } finally {
      setClockLoading(prev => ({ ...prev, [empName]: false }))
    }
  }, [fetchToday, fetchWeek, weekStart])

  // ── Derived: who is clocked in right now ─────────────────────────────────────
  const clockedInNames = new Set(
    entries.filter(e => e.clock_in && !e.clock_out).map(e => e.staff_name)
  )

  // ── Derived: today's totals per employee ─────────────────────────────────────
  function todayHours(name: string) {
    return entries
      .filter(e => e.staff_name === name && e.hours_worked != null)
      .reduce((sum, e) => sum + (e.hours_worked || 0), 0)
  }

  // ── Derived: week grid (employee → day index → entries) ──────────────────────
  function weekGrid(name: string): (TimeclockEntry[] | null)[] {
    return DAY_LABELS.map((_, i) => {
      const day = toYMD(addDays(weekStart, i))
      const dayEntries = weekEntries.filter(e => {
        if (e.staff_name !== name) return false
        const entryDay = e.clock_in.split('T')[0]
        return entryDay === day
      })
      return dayEntries.length > 0 ? dayEntries : null
    })
  }

  // ── Week label ─────────────────────────────────────────────────────────────────
  const weekEndDate = addDays(weekStart, 6)
  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // ── Jobs grouped by tech ───────────────────────────────────────────────────────
  const techs = Array.from(new Set(jobs.map(j => j.assigned_tech || 'Unassigned')))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading Shop Board…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shop Board</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {/* Tab switcher */}
        <div className="inline-flex bg-gray-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setActiveTab('clock')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'clock' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            ⏱ Time Clock
          </button>
          <button
            onClick={() => setActiveTab('board')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'board' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            🔧 Jobs Board
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* ── TIME CLOCK TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'clock' && (
        <div className="space-y-6">

          {/* Clock In / Out Cards */}
          <div>
            <h2 className="text-base font-semibold text-gray-700 mb-3">Today's Status</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.length === 0 && (
                <p className="col-span-3 text-sm text-gray-400 italic">No employees found. Make sure staff are added with role "employee" or "technician".</p>
              )}
              {employees.map(emp => {
                const isClockedIn = clockedInNames.has(emp.name)
                const isLoading   = clockLoading[emp.name]
                const hrs         = todayHours(emp.name)
                // Latest active entry for start time
                const activeEntry = entries.find(e => e.staff_name === emp.name && !e.clock_out)

                return (
                  <div
                    key={emp.id}
                    className={`rounded-xl border-2 p-4 transition-all ${
                      isClockedIn
                        ? 'border-green-400 bg-green-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900 text-base">{emp.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{emp.role}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        isClockedIn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isClockedIn ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                        {isClockedIn ? 'Clocked In' : 'Clocked Out'}
                      </span>
                    </div>

                    {isClockedIn && activeEntry && (
                      <p className="text-xs text-green-700 mb-3">
                        Since {fmt12(activeEntry.clock_in)}
                      </p>
                    )}

                    {hrs > 0 && (
                      <p className="text-xs text-gray-500 mb-3">
                        Today: <span className="font-semibold text-gray-700">{fmtHours(hrs)}</span>
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        disabled={isClockedIn || isLoading}
                        onClick={() => handleClock(emp.name, 'clock_in')}
                        className="flex-1 text-sm font-medium py-2 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isLoading ? '…' : 'Clock In'}
                      </button>
                      <button
                        disabled={!isClockedIn || isLoading}
                        onClick={() => handleClock(emp.name, 'clock_out')}
                        className="flex-1 text-sm font-medium py-2 px-3 rounded-lg bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {isLoading ? '…' : 'Clock Out'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Weekly Attendance */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
              <h2 className="text-base font-semibold text-gray-700">Weekly Attendance</h2>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setWeekStart(prev => {
                    const d = addDays(prev, -7)
                    fetchWeek(d)
                    return d
                  })}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                >
                  ◀
                </button>
                <span className="text-gray-600 min-w-[220px] text-center">{weekLabel}</span>
                <button
                  onClick={() => setWeekStart(prev => {
                    const d = addDays(prev, 7)
                    fetchWeek(d)
                    return d
                  })}
                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                >
                  ▶
                </button>
                <button
                  onClick={() => {
                    const d = getMondayOfWeek(new Date())
                    setWeekStart(d)
                    fetchWeek(d)
                  }}
                  className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
                >
                  This Week
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700 w-32">Employee</th>
                    {DAY_LABELS.map((day, i) => {
                      const date    = addDays(weekStart, i)
                      const isToday = toYMD(date) === toYMD(new Date())
                      return (
                        <th
                          key={day}
                          className={`text-center py-3 px-2 font-semibold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}
                        >
                          <div>{day}</div>
                          <div className={`text-xs font-normal ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>
                            {date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                          </div>
                        </th>
                      )
                    })}
                    <th className="text-center py-3 px-3 font-semibold text-gray-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-gray-400 text-sm italic">No employees found</td>
                    </tr>
                  )}
                  {employees.map((emp, ri) => {
                    const grid     = weekGrid(emp.name)
                    const weekTotal = grid
                      .flat()
                      .filter(Boolean)
                      .reduce((sum, e) => sum + ((e as TimeclockEntry).hours_worked || 0), 0)

                    return (
                      <tr key={emp.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="py-3 px-4 font-medium text-gray-800 whitespace-nowrap">
                          {emp.name}
                        </td>
                        {grid.map((dayEntries, di) => {
                          const date    = addDays(weekStart, di)
                          const isToday = toYMD(date) === toYMD(new Date())
                          if (!dayEntries || dayEntries.length === 0) {
                            return (
                              <td
                                key={di}
                                className={`text-center py-3 px-2 ${isToday ? 'bg-blue-50/40' : ''}`}
                              >
                                <span className="text-gray-300 text-xs">—</span>
                              </td>
                            )
                          }
                          const dayTotal = dayEntries.reduce((sum, e) => sum + (e.hours_worked || 0), 0)
                          return (
                            <td
                              key={di}
                              className={`text-center py-2 px-2 ${isToday ? 'bg-blue-50/40' : ''}`}
                            >
                              {dayEntries.map((e, ei) => (
                                <div key={ei} className="text-xs leading-snug">
                                  <span className="font-medium text-gray-800">{fmt12(e.clock_in)}</span>
                                  {e.clock_out ? (
                                    <>
                                      <span className="text-gray-400"> – </span>
                                      <span className="font-medium text-gray-800">{fmt12(e.clock_out)}</span>
                                    </>
                                  ) : (
                                    <span className="text-green-600 font-medium"> – now</span>
                                  )}
                                </div>
                              ))}
                              {dayTotal > 0 && (
                                <div className="text-xs text-blue-600 font-semibold mt-0.5">
                                  {fmtHours(dayTotal)}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="text-center py-3 px-3">
                          {weekTotal > 0 ? (
                            <span className="text-sm font-bold text-gray-800">{fmtHours(weekTotal)}</span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
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

      {/* ── JOBS BOARD TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'board' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-700">
              Active Jobs <span className="text-gray-400 font-normal text-sm">({jobs.length})</span>
            </h2>
            <button
              onClick={fetchJobs}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
            >
              ↻ Refresh
            </button>
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
              <div key={tech} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="bg-gray-800 text-white px-4 py-2.5 flex items-center gap-2">
                  <span className="text-base">🔧</span>
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
