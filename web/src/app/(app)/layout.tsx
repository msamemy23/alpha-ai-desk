'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase, getUnreadCount } from '@/lib/supabase'
import PhoneWidget from '@/components/PhoneWidget'

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/briefing', icon: '📅', label: 'Daily Briefing' },
  { href: '/appointments', icon: '🗓️', label: 'Appointments' },
  { href: '/customers', icon: '👤', label: 'Customers' },
  { href: '/vehicles', icon: '🚗', label: 'Vehicles' },
  { href: '/jobs', icon: '🔧', label: 'Jobs' },
  { href: '/shopboard', icon: '📋', label: 'Shop Board' },
  { href: '/estimates', icon: '📄', label: 'Estimates' },
  { href: '/invoices', icon: '🧾', label: 'Invoices' },
  { href: '/canned-jobs', icon: '⚡', label: 'Canned Jobs' },
  { href: '/insurance', icon: '🛡️', label: 'Insurance' },
  { href: '/parts', icon: '🔩', label: 'Parts Lookup' },
  { href: '/inventory', icon: '📦', label: 'Inventory' },
  { href: '/dvi', icon: '🔍', label: 'Inspections (DVI)' },
  { href: '/messages', icon: '💬', label: 'Calls & Messages' },
  { href: '/ai', icon: '🤖', label: 'Alpha AI' },
  { href: '/growth', icon: '📈', label: 'Growth' },
  { href: '/automations', icon: '⏰', label: 'Automations' },
  { href: '/reports', icon: '📉', label: 'Reports' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

interface Notification { id: string; type: string; title: string; body: string; time: string }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [location, setLocation] = useState('main')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [lightMode, setLightMode] = useState(false)

  useEffect(() => {
    getUnreadCount().then(setUnread)
    const channel = supabase
      .channel('messages_unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        getUnreadCount().then(setUnread)
      })
      .subscribe()
    const saved = localStorage.getItem('alpha_location')
    if (saved) setLocation(saved)
    const savedMode = localStorage.getItem('alpha_light_mode')
    if (savedMode === 'true') {
      setLightMode(true)
      document.documentElement.classList.add('light')
    }
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  const toggleLightMode = () => {
    const next = !lightMode
    setLightMode(next)
    localStorage.setItem('alpha_light_mode', String(next))
    if (next) {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
  }

  const loadNotifications = async () => {
    setNotifLoading(true)
    try {
      const [{ data: msgs }, { data: calls }] = await Promise.all([
        supabase.from('messages').select('id,body,from_address,created_at').eq('direction','inbound').eq('read',false).order('created_at',{ascending:false}).limit(5),
        supabase.from('calls').select('id,from_number,start_time').eq('direction','inbound').lt('duration_secs',15).order('start_time',{ascending:false}).limit(5)
      ])
      const items: Notification[] = []
      for (const m of (msgs||[])) {
        items.push({ id: m.id, type:'sms', title:'New SMS from ' + (m.from_address||'Unknown'), body: (m.body||'').slice(0,80), time: new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) })
      }
      for (const c of (calls||[])) {
        items.push({ id: c.id, type:'call', title:'Missed call from ' + (c.from_number||'Unknown'), body: 'Short call — likely needs callback', time: new Date(c.start_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) })
      }
      setNotifications(items)
    } catch { setNotifications([]) }
    finally { setNotifLoading(false) }
  }

  const toggleNotif = () => {
    if (!notifOpen) loadNotifications()
    setNotifOpen(!notifOpen)
  }

  const switchLocation = (loc: string) => {
    setLocation(loc)
    localStorage.setItem('alpha_location', loc)
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-bg-card border-r border-border flex flex-col shrink-0
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:static lg:translate-x-0 lg:w-60
      `}>
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-blue/20 flex items-center justify-center text-lg">🔧</div>
          <div>
            <div className="text-sm font-bold text-text-primary leading-tight">Alpha Desktop AI</div>
            <div className="text-xs text-text-muted">Auto Center</div>
          </div>
          <button className="ml-auto p-1 rounded-lg hover:bg-bg-hover lg:hidden" onClick={() => setSidebarOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-3 pt-3">
          <select className="form-select text-xs w-full" value={location} onChange={e => switchLocation(e.target.value)}>
            <option value="main">Main — 10710 S Main St</option>
            <option value="south">South — Coming Soon</option>
            <option value="north">North — Coming Soon</option>
          </select>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className={`nav-item ${pathname.startsWith(item.href) ? 'active' : ''}`}>
              <span>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.href === '/messages' && unread > 0 && (
                <span className="bg-red text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="text-xs text-text-muted text-center">Alpha International Auto Center</div>
          <div className="text-xs text-text-muted text-center">(713) 663-6979</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <div className="h-12 border-b border-border flex items-center justify-between px-3 sm:px-4 shrink-0 bg-bg-card">
          <button className="p-2 rounded-lg hover:bg-bg-hover transition-colors lg:hidden" onClick={() => setSidebarOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-sm font-semibold lg:hidden">Alpha AI</span>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            {/* Light/Dark mode toggle */}
            <button
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
              onClick={toggleLightMode}
              title={lightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {lightMode ? '🌙' : '☀️'}
            </button>

            {/* Sign Out */}
            <button
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
              title="Sign Out"
              onClick={async () => {
                try {
                  const { createClient } = await import('@supabase/supabase-js')
                  const sb = createClient('https://fztnsqrhjesqcnsszqdb.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dG5zcXJoamVzcWNuc3N6cWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMTM3MDIsImV4cCI6MjA1ODU4OTcwMn0.4_MNwSmqTU_dlPWtqY9HGqFlrxL_50y0_C1e3KeQ4Fo')
                  await sb.auth.signOut()
                } catch {}
                document.cookie = 'alpha_authed=; max-age=0; path=/'
                window.location.href = '/login'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button className="relative p-1.5 rounded-lg hover:bg-bg-hover transition-colors" onClick={toggleNotif}>
                <span className="text-lg">🔔</span>
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {notifications.length > 9 ? '9+' : notifications.length}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-bg-card border border-border rounded-xl shadow-xl z-50 max-h-96 overflow-y-auto">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-bold">Notifications</span>
                    <button className="text-xs text-text-muted hover:text-text-primary" onClick={() => setNotifOpen(false)}>Close</button>
                  </div>
                  {notifLoading ? (
                    <div className="p-4 text-sm text-text-muted text-center">Loading…</div>
                  ) : notifications.length === 0 ? (
                    <div className="p-4 text-sm text-text-muted text-center">All caught up!</div>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className="px-4 py-3 border-b border-border last:border-0 hover:bg-bg-hover">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-xs text-text-muted mt-0.5">{n.body}</div>
                        <div className="text-xs text-text-muted mt-1 opacity-60">{n.time}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto bg-bg-base">
          {children}
          <PhoneWidget />
        </main>
      </div>
    </div>
  )
}

