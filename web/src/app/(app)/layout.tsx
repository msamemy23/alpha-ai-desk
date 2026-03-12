'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase, getUnreadCount } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/briefing', icon: '📅', label: 'Daily Briefing' },
  { href: '/customers', icon: '👤', label: 'Customers' },
  { href: '/vehicles', icon: '🚗', label: 'Vehicles' },
  { href: '/jobs', icon: '🔧', label: 'Jobs' },
  { href: '/shopboard', icon: '📋', label: 'Shop Board' },
  { href: '/estimates', icon: '📄', label: 'Estimates' },
  { href: '/invoices', icon: '🧾', label: 'Invoices' },
  { href: '/receipts', icon: '🧾', label: 'Receipts' },
  { href: '/insurance', icon: '🛡️', label: 'Insurance' },
  { href: '/parts', icon: '🔩', label: 'Parts Lookup' },
  { href: '/messages', icon: '💬', label: 'Calls & Messages' },
  { href: '/ai', icon: '🤖', label: 'Alpha AI' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

interface Notification {
  id: string
  type: string
  title: string
  body: string
  time: string
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [location, setLocation] = useState('main')

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
    return () => { supabase.removeChannel(channel) }
  }, [])

  const loadNotifications = async () => {
    setNotifLoading(true)
    try {
      const res = await fetch('/api/notifications')
      const data = await res.json()
      setNotifications(data.notifications || [])
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
      {/* Sidebar */}
      <aside className="w-60 bg-bg-card border-r border-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-blue/20 flex items-center justify-center text-lg">🔧</div>
          <div>
            <div className="text-sm font-bold text-text-primary leading-tight">Alpha Desktop AI</div>
            <div className="text-xs text-text-muted">Auto Center</div>
          </div>
        </div>

        {/* Feature 20: Location Selector */}
        <div className="px-3 pt-3">
          <select
            className="form-select text-xs w-full"
            value={location}
            onChange={e => switchLocation(e.target.value)}
          >
            <option value="main">Main — 10710 S Main St</option>
            <option value="south">South — Coming Soon</option>
            <option value="north">North — Coming Soon</option>
          </select>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname.startsWith(item.href) ? 'active' : ''}`}
            >
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

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="text-xs text-text-muted text-center">Alpha International Auto Center</div>
          <div className="text-xs text-text-muted text-center">(713) 663-6979</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar with notifications */}
        <div className="h-11 border-b border-border flex items-center justify-end px-4 shrink-0 bg-bg-card">
          <div className="relative">
            <button
              className="relative p-1.5 rounded-lg hover:bg-bg-hover transition-colors"
              onClick={toggleNotif}
            >
              <span className="text-lg">🔔</span>
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-bg-card border border-border rounded-xl shadow-xl z-50 max-h-96 overflow-y-auto">
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
        <main className="flex-1 overflow-y-auto bg-bg-base">
          {children}
        </main>
      </div>
    </div>
  )
}
