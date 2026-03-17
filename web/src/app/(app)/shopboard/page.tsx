'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue/20 text-blue',
  'Waiting on Parts': 'bg-amber/20 text-amber',
  'In Progress': 'bg-purple/20 text-purple',
  'Waiting on Customer': 'bg-orange-400/20 text-orange-400',
  'Ready for Pickup': 'bg-green/20 text-green',
  'Paid': 'bg-gray-500/20 text-gray-400',
  'Closed': 'bg-gray-500/20 text-gray-400',
}

const TECHS = ['Paul', 'Devin', 'Luis', 'Louie', 'Unassigned']

const EMPLOYEES = [
  { id: 'masoud', name: 'Masoud', emoji: '👨‍🔧' },
  { id: 'omar', name: 'Omar', emoji: '🔧' },
  { id: 'javier', name: 'Javier (Gordo)', emoji: '🛠️' },
]

const MOTIVATIONAL_QUOTES = [
  "Let's get this bread! Time to make moves. 💪",
  "Another day, another opportunity to be great. 🔥",
  "Champions don't take days off. Let's go! 🏆",
  "Hard work beats talent when talent doesn't work hard. 💯",
  "Stay focused, stay hungry. Today is YOUR day! 🚀",
  "Every car you fix is someone's lifeline. You matter. 🙏",
  "Grind now, shine later. Let's eat! 💰",
  "Be the mechanic you'd want working on YOUR car. ⭐",
  "Success is built one repair at a time. Keep pushing! 🔨",
  "You showed up — that's already winning. Now dominate! 👑",
  "The shop doesn't run without you. Let's make it happen! 🏁",
  "Excellence is not an act, it's a habit. Go be excellent! 💎",
]

interface ClockEntry {
  employee: string
  clockIn: string
  clockOut?: string
}

export default function ShopBoardPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [filter, setFilter] = useState<'active' | 'all' | 'today'>('active')
  const [clockEntries, setClockEntries] = useState<ClockEntry[]>([])
  const [clockQuote, setClockQuote] = useState<{ name: string; quote: string } | null>(null)

  // Load clock entries from Supabase (fallback to localStorage)
  useEffect(() => {
    const loadClock = async () => {
      try {
        const today = new Date().toISOString().split('T')[0]
        const { data } = await supabase
          .from('time_clock')
          .select('*')
          .gte('date', today)
          .order('clock_in', { ascending: false })
        if (data && data.length > 0) {
          const entries: ClockEntry[] = data.map((r: Record<string,unknown>) => ({
            employee: String(r.employee),
            clockIn: String(r.clock_in),
            clockOut: r.clock_out ? String(r.clock_out) : undefined,
            id: String(r.id)
          }))
          setClockEntries(entries)
          return
        }
      } catch { /* table may not exist yet */ }
      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('time_clock')
        if (stored) setClockEntries(JSON.parse(stored))
      } catch { /* ignore */ }
    }
    loadClock()
  }, [])

  const saveClockEntries = async (entries: ClockEntry[]) => {
    setClockEntries(entries)
    localStorage.setItem('time_clock', JSON.stringify(entries)) // keep as fallback
  }

  const clockInEmployee = async (empId: string) => {
    const now = new Date().toISOString()
    const today = new Date().toISOString().split('T')[0]
    try {
      await supabase.from('time_clock').insert({ employee: empId, clock_in: now, date: today })
    } catch { /* table may not exist */ }
    const newEntry: ClockEntry = { employee: empId, clockIn: now }
    saveClockEntries([...clockEntries, newEntry])
  }

  const clockOutEmployee = async (empId: string) => {
    const now = new Date().toISOString()
    const today = new Date().toDateString()
    try {
      const { data } = await supabase.from('time_clock').select('id,clock_in').eq('employee', empId).is('clock_out', null).order('clock_in', { ascending: false }).limit(1)
      if (data?.[0]) {
        const hrs = (new Date(now).getTime() - new Date(data[0].clock_in).getTime()) / 3600000
        await supabase.from('time_clock').update({ clock_out: now, hours: Math.round(hrs * 100) / 100 }).eq('id', data[0].id)
      }
    } catch { /* table may not exist */ }
    const updated = clockEntries.map(e =>
      e.employee === empId && !e.clockOut && new Date(e.clockIn).toDateString() === today
        ? { ...e, clockOut: now } : e
    )
    saveClockEntries(updated)
  }

  const getEmployeeStatus = (empId: string) => {
    const today = new Date().toDateString()
    const todayEntries = clockEntries.filter(
      e => e.employee === empId && new Date(e.clockIn).toDateString() === today
    )
    const lastEntry = todayEntries[todayEntries.length - 1]
    if (lastEntry && !lastEntry.clockOut) {
      return { clockedIn: true, since: lastEntry.clockIn, todayEntries }
    }
    return { clockedIn: false, since: null, todayEntries }
  }

  const getTotalHoursToday = (empId: string) => {
    const today = new Date().toDateString()
    const todayEntries = clockEntries.filter(
      e => e.employee === empId && new Date(e.clockIn).toDateString() === today
    )
    let total = 0
    for (const entry of todayEntries) {
      const start = new Date(entry.clockIn).getTime()
      const end = entry.clockOut ? new Date(entry.clockOut).getTime() : Date.now()
      total += (end - start) / 1000 / 60 / 60
    }
    return total
  }

  const handleClockIn = (empId: string, empName: string) => {
    const quote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]
    const newEntry: ClockEntry = { employee: empId, clockIn: new Date().toISOString() }
    saveClockEntries([...clockEntries, newEntry])
    setClockQuote({ name: empName, quote })
    setTimeout(() => setClockQuote(null), 6000)
  }

  const handleClockOut = (empId: string) => {
    const updated = clockEntries.map(e => {
      if (e.employee === empId && !e.clockOut) {
        return { ...e, clockOut: new Date().toISOString() }
      }
      return e
    })
    saveClockEntries(updated)
  }

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
      setJobs(data || [])
    }
    load()
    const ch = supabase.channel('shopboard').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const today = new Date().toDateString()
  const filtered = jobs.filter(j => {
    if (filter === 'active') return !['Paid', 'Closed'].includes(j.status)
    if (filter === 'today') return new Date(j.created_at).toDateString() === today
    return true
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Shop Board</h1>
        <div className="flex gap-2 flex-wrap">
          {(['active', 'all', 'today'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
              {f === 'active' ? 'Active Jobs' : f === 'all' ? 'All Jobs' : 'Today Only'}
            </button>
          ))}
        </div>
      </div>

      {/* ===== EMPLOYEE TIME CLOCK ===== */}
      <div className="mb-6 bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-lg font-bold text-text-primary mb-3">⏰ Employee Time Clock</h2>

        {/* Motivational quote popup */}
        {clockQuote && (
          <div className="mb-4 p-4 rounded-xl bg-green/10 border border-green/30 animate-fade-in">
            <p className="text-sm font-bold text-green">Welcome in, {clockQuote.name}! 🎉</p>
            <p className="text-sm text-text-secondary mt-1 italic">&quot;{clockQuote.quote}&quot;</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {EMPLOYEES.map(emp => {
            const status = getEmployeeStatus(emp.id)
            const hours = getTotalHoursToday(emp.id)
            return (
              <div key={emp.id} className={`rounded-xl border p-4 transition-all ${status.clockedIn ? 'border-green/50 bg-green/5' : 'border-border bg-bg-hover'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{emp.emoji}</span>
                    <span className="font-semibold text-text-primary">{emp.name}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${status.clockedIn ? 'bg-green/20 text-green' : 'bg-gray-500/20 text-gray-400'}`}>
                    {status.clockedIn ? '● Clocked In' : '○ Off'}
                  </span>
                </div>

                {status.clockedIn && status.since && (
                  <p className="text-xs text-text-muted mb-2">
                    Since {new Date(status.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}

                <p className="text-xs text-text-muted mb-3">
                  Today: {hours.toFixed(1)}h
                </p>

                {status.clockedIn ? (
                  <button onClick={() => handleClockOut(emp.id)}
                    className="w-full py-2 rounded-lg text-sm font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors">
                    Clock Out
                  </button>
                ) : (
                  <button onClick={() => handleClockIn(emp.id, emp.name)}
                    className="w-full py-2 rounded-lg text-sm font-semibold bg-green/20 text-green hover:bg-green/30 border border-green/30 transition-colors">
                    Clock In
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== JOBS BY TECH ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 flex-1 overflow-auto">
        {TECHS.map(tech => {
          const techJobs = filtered.filter(j => tech === 'Unassigned' ? !j.tech : j.tech === tech)
          return (
            <div key={tech} className="bg-bg-card border border-border rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-text-primary">{tech}</span>
                <span className="text-xs text-text-muted bg-bg-hover px-2 py-0.5 rounded-full">{techJobs.length}</span>
              </div>
              <div className="space-y-2 flex-1 overflow-auto">
                {techJobs.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-4">No jobs</p>
                ) : techJobs.map(j => (
                  <a key={j.id} href="/jobs" className="block p-2.5 rounded-lg bg-bg-hover border border-border hover:border-blue/30 transition-colors">
                    <p className="text-sm font-medium text-text-primary truncate">{j.customer_name || 'Unknown'}</p>
                    <p className="text-xs text-text-muted truncate">
                      {[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}
                    </p>
                    <p className="text-xs text-text-muted truncate mt-0.5">{j.concern || ''}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[j.status] || 'bg-gray-500/20 text-gray-400'}`}>
                        {j.status || 'New'}
                      </span>
                      {j.promise_date && (
                        <span className="text-xs text-text-muted">
                          Due {new Date(j.promise_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
