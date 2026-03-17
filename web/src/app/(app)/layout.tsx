'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback, useRef } from 'react'
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
    { href: '/growth', icon: '📈', label: 'Growth' },
{ href: '/automations', icon: '⏰', label: 'Automations' },   { href: '/settings', icon: '⚙️', label: 'Settings' },
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{type:string;label:string;sub:string;href:string}[]>([])
  const [searchIdx, setSearchIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

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

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-bg-card border-r border-border flex flex-col shrink-0
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:static lg:translate-x-0 lg:w-60
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-blue/20 flex items-center justify-center text-lg">🔧</div>
          <div>
            <div className="text-sm font-bold text-text-primary leading-tight">Alpha Desktop AI</div>
            <div className="text-xs text-text-muted">Auto Center</div>
          </div>
          {/* Close button on mobile */}
          <button
            className="ml-auto p-1 rounded-lg hover:bg-bg-hover lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Location Selector */}
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
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Top bar */}
        <div className="h-12 border-b border-border flex items-center justify-between px-3 sm:px-4 shrink-0 bg-bg-card">
          {/* Hamburger button - mobile only */}
          <button
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {/* App name on mobile */}
          <span className="text-sm font-semibold lg:hidden">Alpha AI</span>
          {/* Spacer for desktop */}
          <div className="hidden lg:block" />
          {/* Notifications */}
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
        {/* Global Ctrl+K Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-start justify-center pt-24 px-4" onClick={() => setSearchOpen(false)}>
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <span className="text-text-muted">🔍</span>
              <input ref={searchRef} className="flex-1 bg-transparent outline-none text-sm placeholder-text-muted"
                placeholder="Search customers, jobs, pages..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); runSearch(e.target.value) }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx(i => Math.min(i+1,searchResults.length-1)) }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx(i => Math.max(i-1,0)) }
                  if (e.key === 'Enter' && searchResults[searchIdx]) { router.push(searchResults[searchIdx].href); setSearchOpen(false) }
                }} />
              <span className="text-xs text-text-muted bg-bg-hover px-1.5 py-0.5 rounded border border-border">ESC</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {searchQuery && searchResults.length === 0 && (
                <div className="text-center text-text-muted text-sm py-6">No results for &quot;{searchQuery}&quot;</div>
              )}
              {!searchQuery && (
                <div className="text-center text-text-muted text-sm py-6">Start typing to search customers, jobs, and pages…</div>
              )}
              {searchResults.map((r, i) => (
                <button key={i} className={w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors border-b border-border last:border-0 }
                  onClick={() => { router.push(r.href); setSearchOpen(false) }}>
                  <span className={	ag text-xs shrink-0 }>{r.type}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{r.label}</div>
                    {r.sub && <div className="text-xs text-text-muted truncate">{r.sub}</div>}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-muted">↑↓ navigate · Enter select · Esc close</span>
              <span className="text-xs text-text-muted font-mono bg-bg-hover px-2 py-0.5 rounded">Ctrl+K</span>
            </div>
          </div>
        </div>
      )}
      <main className=""flex-1 overflow-y-auto bg-bg-base">
          {children}
        </main>
      </div>
    </div>
  )
}

